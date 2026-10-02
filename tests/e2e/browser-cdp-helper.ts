import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { redactEvidenceText, redactNetworkHeaders, stringifyRedactedEvidence } from "./network-evidence-redaction";

export interface NetworkLogEntry {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  type?: string;
  host: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  initiatorRequestId?: string;
  finished?: boolean;
  failure?: NetworkFailureEntry;
}

export interface NetworkFailureEntry {
  requestId: string;
  errorText: string;
  canceled: boolean;
  blockedReason?: string;
  corsErrorStatus?: { corsError: string; failedParameter: string };
}

export interface BrowserLogEntry {
  level: string;
  text: string;
  source: string;
  url?: string;
  timestamp: number;
}

export interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp: number;
}

export interface BlockedRequestEntry {
  url: string;
  method: string;
  timestamp: number;
}

export function isAllowedUrl(url: string): boolean {
  if (url === "about:blank") return true;
  if (url.startsWith("data:")) return true;
  if (url.startsWith("blob:")) {
    return url.startsWith("blob:http://127.0.0.1:3100/") || url.startsWith("blob:http://127.0.0.1:4010/");
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:") {
      if (parsed.hostname === "127.0.0.1" && (parsed.port === "3100" || parsed.port === "4010")) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function shouldRewriteAdminOrigin(url: string, method: string, origin: string): boolean {
  if (origin !== "http://127.0.0.1:3100" || !["POST", "PATCH", "PUT", "DELETE"].includes(method)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && parsed.port === "3100" && parsed.pathname.startsWith("/api/admin/");
  } catch {
    return false;
  }
}

export class BrowserCDPClient {
  private chromeProc: ChildProcess | null = null;
  private tempProfileDir: string | null = null;
  private ws: WebSocket | null = null;
  private nextMsgId = 1;
  private requestHeaderFingerprints = new WeakMap<NetworkLogEntry, Map<string, string>>();
  private pendingRequests = new Map<
    number,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >();
  public networkLogs: NetworkLogEntry[] = [];
  public consoleLogs: ConsoleLogEntry[] = [];
  public loadingFailures: NetworkFailureEntry[] = [];
  public browserLogs: BrowserLogEntry[] = [];
  public observedHosts = new Set<string>();
  public blockedRequests: BlockedRequestEntry[] = [];
  public egressViolation = false;
  public egressViolationUrl: string | null = null;

  private recordNetworkRequest(request: NetworkLogEntry) {
    const captured: NetworkLogEntry = {
      ...request,
      requestHeaders: redactNetworkHeaders(request.requestHeaders),
      responseHeaders: redactNetworkHeaders(request.responseHeaders),
    };
    // CDP reuses requestId across redirect hops; bind credentials to each record.
    this.requestHeaderFingerprints.set(captured, new Map(
      Object.entries(request.requestHeaders ?? {}).map(([name, value]) => [
        name.toLowerCase(), createHash("sha256").update(value).digest("hex"),
      ]),
    ));
    this.networkLogs.push(captured);
  }

  public requestHeaderMatches(request: NetworkLogEntry, headerName: string, expectedValue: string): boolean {
    const actual = this.requestHeaderFingerprints.get(request)?.get(headerName.toLowerCase());
    return actual !== undefined && actual === createHash("sha256").update(expectedValue).digest("hex");
  }

  public resetEgressViolation() {
    this.egressViolation = false;
    this.egressViolationUrl = null;
  }

  async launch(options: { port?: number } = {}) {
    const port = options.port ?? 9222;
    const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    this.tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-cdp-profile-"));

    this.chromeProc = spawn(chromePath, [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${this.tempProfileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--window-size=1280,800",
      "about:blank",
    ]);

    // Poll for remote debugging port
    let wsUrl: string | null = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          const data = (await res.json()) as { webSocketDebuggerUrl?: string };
          if (data.webSocketDebuggerUrl) {
            wsUrl = data.webSocketDebuggerUrl;
            break;
          }
        }
      } catch {}
    }

    if (!wsUrl) {
      throw new Error(`Failed to connect to Chrome remote debugging port ${port}`);
    }

    // Now get the first page target
    const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
    const pages = (await listRes.json()) as Array<{ webSocketDebuggerUrl: string; type: string }>;
    const pageTarget = pages.find((p) => p.type === "page") || pages[0];
    const targetWsUrl = pageTarget?.webSocketDebuggerUrl || wsUrl;

    this.ws = new WebSocket(targetWsUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => resolve();
      this.ws!.onerror = (e) => reject(e);
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());

      // Response to a command
      if (msg.id && this.pendingRequests.has(msg.id)) {
        const { resolve, reject } = this.pendingRequests.get(msg.id)!;
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          reject(new Error(redactEvidenceText(msg.error.message || stringifyRedactedEvidence(msg.error))));
        } else {
          resolve(msg.result);
        }
        return;
      }

      // Event: Fetch.requestPaused (pre-network interception gate)
      if (msg.method === "Fetch.requestPaused") {
        const { requestId, request } = msg.params;
        const url = request.url as string;
        if (isAllowedUrl(url)) {
          let headers: Array<{ name: string; value: string }> | undefined;
          if (request.headers) {
            let modified = false;
            headers = Object.entries(request.headers).map(([name, value]) => {
              const strVal = String(value);
              if (name.toLowerCase() === "origin" && shouldRewriteAdminOrigin(url, request.method, strVal)) {
                modified = true;
                return { name, value: "http://localhost:3100" };
              }
              return { name, value: strVal };
            });
            if (!modified) {
              headers = undefined;
            }
          }
          this.send("Fetch.continueRequest", headers ? { requestId, headers } : { requestId }).catch(() => {});
        } else {
          this.egressViolation = true;
          this.egressViolationUrl = url;
          this.blockedRequests.push({
            url,
            method: request.method,
            timestamp: Date.now(),
          });
          console.error(redactEvidenceText(`[CDP Egress Interceptor] Pre-network BLOCKED external request: ${request.method} ${url}`));
          this.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
        }
        return;
      }

      // Event: Network.requestWillBeSent (second-layer audit & logging)
      if (msg.method === "Network.requestWillBeSent") {
        const req = msg.params.request;
        const url = req.url as string;
        try {
          if (!url.startsWith("data:") && !url.startsWith("blob:")) {
            const parsed = new URL(url);
            this.observedHosts.add(parsed.host);
            if (!isAllowedUrl(url)) {
              this.egressViolation = true;
              this.egressViolationUrl = url;
              console.error(redactEvidenceText(`CRITICAL SAFETY ABORT: External egress detected to ${url}`));
            }
          }
        } catch {}
        this.recordNetworkRequest({
          requestId: msg.params.requestId,
          url,
          method: req.method,
          requestHeaders: req.headers,
          initiatorRequestId: msg.params.initiator?.requestId,
          host: url.startsWith("data:") ? "data:" : url.startsWith("blob:") ? "blob:" : new URL(url).host,
        });
      }

      // Event: Network.responseReceived
      if (msg.method === "Network.responseReceived") {
        const resp = msg.params.response;
        const entry = this.networkLogs.findLast((n) => n.requestId === msg.params.requestId);
        if (entry) {
          entry.status = resp.status;
          entry.type = resp.mimeType;
          entry.responseHeaders = redactNetworkHeaders(resp.headers);
        }
      }

      if (msg.method === "Network.loadingFinished") {
        const entry = this.networkLogs.findLast((n) => n.requestId === msg.params.requestId);
        if (entry) entry.finished = true;
      }

      if (msg.method === "Network.loadingFailed") {
        const { requestId, errorText, canceled, blockedReason, corsErrorStatus } = msg.params;
        const failure: NetworkFailureEntry = { requestId, errorText: redactEvidenceText(errorText), canceled: Boolean(canceled), blockedReason, corsErrorStatus };
        this.loadingFailures.push(failure);
        const entry = this.networkLogs.findLast((n) => n.requestId === requestId);
        if (entry) entry.failure = failure;
        console.error("[CDP Network.loadingFailed]", stringifyRedactedEvidence(failure));
      }

      if (msg.method === "Log.entryAdded") {
        const { level, text, source, url, timestamp } = msg.params.entry;
        const entry: BrowserLogEntry = { level, text: redactEvidenceText(text), source, url: url && redactEvidenceText(url), timestamp };
        this.browserLogs.push(entry);
        console.log("[CDP Log.entryAdded]", stringifyRedactedEvidence(entry));
      }

      // Event: Runtime.consoleAPICalled
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = msg.params.args.map((a: any) => typeof a.value === "object" && a.value !== null
          ? stringifyRedactedEvidence(a.value)
          : redactEvidenceText(String(a.value ?? a.description ?? stringifyRedactedEvidence(a)))).join(" ");
        this.consoleLogs.push({
          type: msg.params.type,
          text,
          timestamp: Date.now(),
        });
      }

      // Event: Runtime.exceptionThrown
      if (msg.method === "Runtime.exceptionThrown") {
        const text = redactEvidenceText(msg.params.exceptionDetails?.text || "Unhandled exception");
        this.consoleLogs.push({
          type: "exception",
          text,
          timestamp: Date.now(),
        });
      }
    };

    // Enable necessary domains including pre-network Fetch interception
    await this.send("Fetch.enable");
    await this.send("Network.enable");
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
    await this.send("DOM.enable");
  }

  async send(method: string, params: any = {}): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected to Chrome CDP");
    }

    if (this.egressViolation && method !== "Fetch.failRequest" && method !== "Fetch.continueRequest") {
      throw new Error(`E2E SAFETY ABORT — EXTERNAL EGRESS DETECTED: ${this.egressViolationUrl}`);
    }

    const id = this.nextMsgId++;
    const promise = new Promise<any>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });

    this.ws.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async setViewport(width: number, height: number) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await this.send("Emulation.setVisibleSize", { width, height });
  }

  async navigate(url: string, waitForReady = true) {
    if (this.egressViolation) {
      throw new Error(`E2E SAFETY ABORT — EXTERNAL EGRESS DETECTED: ${this.egressViolationUrl}`);
    }
    await this.send("Page.navigate", { url });
    if (waitForReady) {
      // Wait for load event or readyState interactive/complete
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const readyState = await this.evaluate("document.readyState");
        if (readyState === "complete" || readyState === "interactive") break;
      }
    }
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(`CDP Evaluation Error: ${stringifyRedactedEvidence(res.exceptionDetails)}`);
    }
    return res?.result?.value;
  }

  async waitForSelector(selector: string, timeoutMs = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await this.evaluate<boolean>(
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`
      );
      if (exists) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  async click(selector: string) {
    const found = await this.waitForSelector(selector, 5000);
    if (!found) throw new Error(`Element not found to click: ${selector}`);
    await this.evaluate(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
        el.scrollIntoView({ block: "center", inline: "center" });
        el.click();
      })()`
    );
  }

  async type(selector: string, text: string) {
    const found = await this.waitForSelector(selector, 5000);
    if (!found) throw new Error(`Element not found to type: ${selector}`);
    await this.evaluate(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
        el.focus();
        const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, ${JSON.stringify(text)});
        } else {
          el.value = ${JSON.stringify(text)};
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      })()`
    );
  }

  async select(selector: string, value: string) {
    const found = await this.waitForSelector(selector, 5000);
    if (!found) throw new Error(`Element not found to select: ${selector}`);
    await this.evaluate(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
        el.focus();
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, ${JSON.stringify(value)});
        } else {
          el.value = ${JSON.stringify(value)};
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
      })()`
    );
  }

  async pressKey(key: string, code: string, keyCode: number) {
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  }

  async close() {
    try {
      if (this.ws) {
        this.ws.close();
      }
    } catch {}
    try {
      if (this.chromeProc) {
        this.chromeProc.kill();
      }
    } catch {}
    try {
      if (this.tempProfileDir) {
        fs.rmSync(this.tempProfileDir, { recursive: true, force: true });
      }
    } catch {}
  }
}
