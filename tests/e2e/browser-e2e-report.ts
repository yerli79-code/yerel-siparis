export type ScenarioStatus =
  | "PASS"
  | "FAIL"
  | "SKIP — TOOL LIMITATION"
  | "INCONCLUSIVE"
  | "UNVERIFIED";

export interface ScenarioResult {
  id: string;
  name: string;
  suite: string;
  status: ScenarioStatus;
  browserExecuted: boolean;
  nonBrowserAssertionExecuted?: boolean;
  networkEvidence: string;
  domEvidence: string;
  notes?: string;
}

export const expectedScenarioGroups: ReadonlyArray<{ suite: string; ids: readonly string[] }> = [
  { suite: "Authentication", ids: ["S1.1", "S1.2", "S1.3", "S1.4", "S1.5"] },
  { suite: "Responsive", ids: ["S2.1.VP390", "S2.2.VP768", "S2.3.VP1024", "S2.4.VP1100", "S2.5.VP1199", "S2.6.VP1200", "S2.7.VP1366", "S2.8.VP1440", "PHASE4.F1"] },
  { suite: "Orders", ids: ["S3.1", "S3.2", "S3.3", "S3.4", "S3.5", "S3.6", "S3.7", "S3.8", "S3.9"] },
  { suite: "Printing", ids: ["S4.1", "S4.2", "S4.3", "S4.4"] },
  { suite: "Products", ids: ["S5.1", "S5.2", "S5.3", "S5.4", "S5.5", "S5.6", "S5.7"] },
  { suite: "Storage", ids: ["S6.1"] },
  { suite: "Profile", ids: ["S7.1", "S7.2", "S7.3", "S7.4", "S7.5"] },
  { suite: "Subscription gating", ids: ["S8.1"] },
  { suite: "Accessibility", ids: ["S9.1", "S9.2", "S9.3", "S9.4", "S9.5"] },
  { suite: "Console/network", ids: ["S10.1", "S10.2"] },
  { suite: "Polling badge", ids: ["BADGE.A", "BADGE.B", "BADGE.C", "BADGE.D", "BADGE.E", "BADGE.F", "BADGE.G", "BADGE.H"] },
];

// A missing callback or interrupted suite must remain visible in report totals.
export function completeScenarioResults(results: readonly ScenarioResult[]): ScenarioResult[] {
  const completed = results.map(result => result.status === "PASS" && !result.browserExecuted && !result.nonBrowserAssertionExecuted
    ? { ...result, status: "UNVERIFIED" as const, notes: "A PASS was supplied without executed browser or non-browser assertion evidence." }
    : result);
  for (const { suite, ids } of expectedScenarioGroups) {
    for (const id of ids) {
      if (!results.some(result => result.id === id)) {
        completed.push({
          id, name: "No completed observation", suite, status: "UNVERIFIED",
          browserExecuted: false, networkEvidence: "UNVERIFIED", domEvidence: "UNVERIFIED",
          notes: "No result was recorded for this required scenario; execution and outcome are unverified.",
        });
      }
    }
  }
  return completed;
}

export function summarizeStatus(results: readonly (Pick<ScenarioResult, "status"> & Partial<Pick<ScenarioResult, "browserExecuted" | "nonBrowserAssertionExecuted">>)[]): "PASS" | "FAIL" | "PASS WITH LIMITATIONS" | "UNVERIFIED" {
  if (results.some(result => result.status === "FAIL")) return "FAIL";
  if (!results.length || results.some(result => result.status === "UNVERIFIED" || result.status === "INCONCLUSIVE" || (result.status === "PASS" && result.browserExecuted === false && !result.nonBrowserAssertionExecuted))) return "UNVERIFIED";
  if (!results.some(result => result.status === "PASS")) return "UNVERIFIED";
  if (results.some(result => result.status === "SKIP — TOOL LIMITATION")) return "PASS WITH LIMITATIONS";
  return "PASS";
}

export function summarizeScenarioGroup(results: readonly ScenarioResult[], ids: readonly string[]): string {
  const observations = ids.flatMap<Pick<ScenarioResult, "id" | "status"> & Partial<Pick<ScenarioResult, "browserExecuted" | "nonBrowserAssertionExecuted">>>(id => {
    const found = results.filter(result => result.id === id);
    return found.length ? found : [{ id, status: "UNVERIFIED" as const }];
  });
  return `${summarizeStatus(observations)} (${observations.map(result => `${result.id} ${result.status}`).join(", ")})`;
}

// An expected negative HTTP response is only excluded when its local destination,
// status and captured network response agree. Arbitrary "400"/"CONFLICT" text,
// console exceptions and messages without a URL are never suppressed.
export function isExpectedNegativeHttpLog(log: { text: string; type?: string; url?: string }, network: readonly { url: string; status?: number }[]): boolean {
  if (log.type === "exception" || !log.url) return false;
  const match = /^Failed to load resource: the server responded with a status of (400|409)(?:\s+\([^\n]*\))?$/.exec(log.text.trim());
  if (!match) return false;
  let url: URL;
  try { url = new URL(log.url); } catch { return false; }
  const status = Number(match[1]);
  const expectedDestination = (status === 400 && url.origin === "http://127.0.0.1:4010" && url.pathname === "/auth/v1/token") ||
    (status === 409 && url.origin === "http://127.0.0.1:3100" && (/^\/api\/business\/orders\/[^/]+$/.test(url.pathname) || url.pathname === "/api/business/products/reorder"));
  return expectedDestination && network.some(response => response.url === log.url && response.status === status);
}

export function renderSuiteSummary(results: readonly ScenarioResult[]): string {
  return expectedScenarioGroups.map(({ suite, ids }) => {
    const extraIds = [...new Set(results.filter(result => result.suite === suite && !ids.includes(result.id)).map(result => result.id))];
    return `- ${suite}: ${summarizeScenarioGroup(results, [...ids, ...extraIds])}`;
  }).join("\n");
}

interface ObservedNetworkResponse {
  url: string;
  method: string;
  status?: number;
  // BrowserCDPClient stores Network.responseReceived.response.mimeType here.
  type?: string;
  finished?: boolean;
  failure?: unknown;
  requestHeaders?: Record<string, string>;
}

export function findResponseForMethod<T extends ObservedNetworkResponse>(network: readonly T[], expectedUrl: string, method: string): T | undefined {
  const expected = new URL(expectedUrl);
  return network.findLast(response => {
    if (response.method !== method || response.status === undefined || response.failure) return false;
    try {
      const actual = new URL(response.url);
      return actual.origin === expected.origin && actual.pathname === expected.pathname && (!expected.search || actual.search === expected.search);
    } catch { return false; }
  });
}

export function findCompletedHtmlDocument<T extends ObservedNetworkResponse>(network: readonly T[], expectedUrl: string): T | undefined {
  const expected = new URL(expectedUrl);
  return network.findLast(response => {
    if (response.method !== "GET" || response.status === undefined || !response.finished || response.failure || response.type?.split(";")[0].trim().toLowerCase() !== "text/html") return false;
    try {
      const actual = new URL(response.url);
      if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search !== expected.search) return false;
      const headers = Object.fromEntries(Object.entries(response.requestHeaders ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
      return headers.rsc !== "1" && !headers["next-router-state-tree"] && !headers["next-router-prefetch"] &&
        !headers.purpose?.toLowerCase().includes("prefetch") && !headers["sec-purpose"]?.toLowerCase().includes("prefetch") &&
        (!headers["sec-fetch-dest"] || headers["sec-fetch-dest"] === "document");
    } catch { return false; }
  });
}
