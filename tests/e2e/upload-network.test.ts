import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserCDPClient } from "./browser-cdp-helper";
import { assessUpload, type UploadEvidence } from "./upload-network-assertion";

const url = "http://127.0.0.1:4010/storage/v1/object/product-images/fixture/image.png";
const pathname = new URL(url).pathname;

function validEvidence(): UploadEvidence {
  return {
    network: [
      { requestId: "preflight", initiatorRequestId: "post", url, method: "OPTIONS", host: "127.0.0.1:4010", status: 204, finished: true,
        requestHeaders: { "Access-Control-Request-Headers": "apikey,authorization,content-type,x-upsert" },
        responseHeaders: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "apikey,authorization,content-type,x-upsert" } },
      { requestId: "post", url, method: "POST", host: "127.0.0.1:4010", status: 200, finished: true },
    ],
    serverRequests: [{ method: "OPTIONS", pathname }, { method: "POST", pathname }],
    formSuccess: true,
    publicImageUrl: url.replace("/object/", "/object/public/"),
  };
}

test("assertion: intentional missing-request fixture correctly FAILS before positive fixture", () => {
  const missing = validEvidence();
  missing.network = [];
  assert.equal(assessUpload(missing).status, "FAIL");
  console.log("Intentional missing upload fixture: FAIL (expected)");
  assert.equal(assessUpload(validEvidence()).status, "PASS");
});

test("assertion: every required upload condition rejects incomplete, CORS and HTTP failure evidence", () => {
  const mutations: Array<[string, (e: UploadEvidence) => void]> = [
    ["wrong bucket", e => { e.network[1].url = url.replace("product-images", "business-images"); }],
    ["wrong method", e => { e.network[1].method = "PUT"; }],
    ["preflight HTTP failure", e => { e.network[0].status = 403; }],
    ["missing preflight", e => { e.network.shift(); }],
    ["unrelated preflight", e => { e.network[0].initiatorRequestId = "unrelated"; }],
    ["missing x-upsert", e => { e.network[0].responseHeaders!["Access-Control-Allow-Headers"] = "apikey,authorization,content-type"; }],
    ["wrong origin", e => { e.network[0].responseHeaders!["Access-Control-Allow-Origin"] = "http://other.invalid"; }],
    ["wrong allowed method", e => { e.network[0].responseHeaders!["Access-Control-Allow-Methods"] = "GET"; }],
    ["POST not received", e => { e.serverRequests.pop(); }],
    ["POST before OPTIONS", e => { e.serverRequests.reverse(); }],
    ["no HTTP response", e => { delete e.network[1].status; }],
    ["status zero", e => { e.network[1].status = 0; }],
    ["4xx", e => { e.network[1].status = 403; }],
    ["5xx", e => { e.network[1].status = 503; }],
    ["not completed", e => { delete e.network[1].finished; }],
    ["loadingFailed despite HTTP 200", e => { e.network[1].failure = { requestId: "post", errorText: "net::ERR_FAILED", canceled: false }; }],
    ["form not successful", e => { e.formSuccess = false; }],
    ["wrong public URL", e => { e.publicImageUrl = ""; }],
  ];
  for (const [name, mutate] of mutations) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.equal(assessUpload(evidence).status, "FAIL", name);
  }
});

test("browser: CORS failure, loadingFailed, Log.entryAdded, HTTP 4xx/5xx and corrected upload", async () => {
  const client = new BrowserCDPClient();
  async function fixture(mode: string) {
    const res = await fetch("http://127.0.0.1:4010/__e2e/storage-fixture", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }),
    });
    assert.equal(res.status, 200);
  }
  try {
    await client.launch({ port: 9224 });
    await client.navigate("http://127.0.0.1:3100/giris");
    await client.evaluate("console.warn('network-harness-runtime-sentinel')");
    await client.evaluate("setTimeout(() => { throw new Error('network-harness-exception-sentinel'); }, 0)");
    for (const mode of ["preflight-failure", "upload-4xx", "upload-5xx", "none"]) {
      await fixture(mode);
      const requestUrl = url.replace("image.png", `${mode}-${Date.now()}.png`);
      const start = client.networkLogs.length;
      const response = await client.evaluate<{ status?: number; error?: string }>(`fetch(${JSON.stringify(requestUrl)}, {
        method: 'POST', headers: { apikey: 'dummy', Authorization: 'Bearer local-fixture', 'Content-Type': 'image/png', 'x-upsert': 'true' },
        body: new Uint8Array([137,80,78,71])
      }).then(r => r.text().then(() => ({ status: r.status }))).catch(e => ({ error: e.message }))`);
      for (let i = 0; i < 40; i++) {
        const upload = client.networkLogs.slice(start).find(n => n.method === "POST" && n.url === requestUrl);
        if (upload?.finished || upload?.failure) break;
        await new Promise(r => setTimeout(r, 50));
      }
      const network = client.networkLogs.slice(start);
      const { requests } = await (await fetch("http://127.0.0.1:4010/__e2e/requests")).json();
      const assessment = assessUpload({ network, serverRequests: requests, formSuccess: false, publicImageUrl: "" });
      // A fetch-only probe cannot prove form success, even when HTTP is 200.
      assert.equal(assessment.status, "FAIL");
      if (mode === "preflight-failure") {
        assert(response.error);
        assert(assessment.failures.includes("Preflight CORS origin/method/headers invalid"));
        assert(assessment.failures.includes("Final upload did not complete with a successful HTTP response"));
        assert(!requests.some((r: { method: string; pathname: string }) => r.method === "POST" && r.pathname === new URL(requestUrl).pathname));
        assert(network.some(n => n.failure?.corsErrorStatus && n.failure.errorText && n.failure.canceled === false));
        assert(client.browserLogs.some(l => l.level === "error" && l.source === "javascript" && l.text.includes("CORS") && l.url));
        assert(client.browserLogs.some(l => l.level === "error" && l.source === "network" && l.url === requestUrl));
      } else {
        assert.equal(response.status, mode === "upload-4xx" ? 403 : mode === "upload-5xx" ? 503 : 200);
        assert.equal(assessment.preflight?.status, 204);
        assert(assessment.preflight?.finished);
        assert.equal(assessment.upload?.status, response.status);
        assert(assessment.upload?.finished);
        if (mode !== "none") assert(assessment.failures.includes("Final upload did not complete with a successful HTTP response"));
        if (mode === "none") assert.deepEqual(assessment.failures, ["Form did not reach success with the uploaded public image URL"]);
      }
      console.log(JSON.stringify({ mode, response, assertion: assessment.status, failures: assessment.failures, network }));
    }
    assert(client.consoleLogs.some(l => l.text.includes("network-harness-runtime-sentinel")));
    assert(client.consoleLogs.some(l => l.type === "exception"));
    assert.equal(client.egressViolation, false);
  } finally {
    try {
      await fixture("none");
    } finally {
      await client.close();
    }
  }
});
