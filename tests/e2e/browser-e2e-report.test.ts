import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeScenarioResults,
  expectedScenarioGroups,
  findCompletedHtmlDocument,
  findResponseForMethod,
  isExpectedNegativeHttpLog,
  renderSuiteSummary,
  summarizeScenarioGroup,
  summarizeStatus,
  type ScenarioResult,
} from "./browser-e2e-report";

function observed(id: string, status: ScenarioResult["status"] = "PASS"): ScenarioResult {
  return { id, status, name: id, suite: "fixture", browserExecuted: true, networkEvidence: "fixture observation", domEvidence: "fixture observation" };
}

test("an interrupted run cannot report untouched suites or readiness checks as PASS", () => {
  const complete = completeScenarioResults([observed("S1.1")]);
  assert.equal(summarizeStatus(complete), "UNVERIFIED");
  assert.equal(complete.find(result => result.id === "S9.2")?.status, "UNVERIFIED");
  assert.equal(complete.find(result => result.id === "S9.2")?.browserExecuted, false);
  assert.match(renderSuiteSummary(complete), /Accessibility: UNVERIFIED/);
  assert.match(summarizeScenarioGroup(complete, ["PHASE4.F1"]), /^UNVERIFIED/);
});

test("a failed focus restoration makes both accessibility and the final outcome FAIL", () => {
  const allObserved = expectedScenarioGroups.flatMap(group => group.ids.map(id => observed(id, id === "S9.2" ? "FAIL" : "PASS")));
  assert.equal(summarizeStatus(allObserved), "FAIL");
  assert.match(renderSuiteSummary(allObserved), /Accessibility: FAIL/);
});

test("a badge lifecycle failure cannot leave its suite PASS after all A–H callbacks pass", () => {
  const badgeIds = expectedScenarioGroups.find(group => group.suite === "Polling badge")!.ids;
  const callbacks = badgeIds.map(id => ({ ...observed(id), suite: "Polling badge" }));
  const failure = { ...observed("BADGE.FAILURE", "FAIL"), suite: "Polling badge" };
  const complete = completeScenarioResults([...callbacks, failure]);
  assert.match(renderSuiteSummary(complete), /Polling badge: FAIL \([^\n]*BADGE.FAILURE FAIL/);
  assert.equal(summarizeStatus(complete), "FAIL");
  const interrupted = completeScenarioResults([...callbacks.slice(0, -1), failure]);
  assert.match(renderSuiteSummary(interrupted), /Polling badge: FAIL \([^\n]*BADGE.H UNVERIFIED[^\n]*BADGE.FAILURE FAIL/);
});

test("INCONCLUSIVE has no passing final classification even when every other scenario passed", () => {
  assert.equal(summarizeStatus([observed("S3.1"), observed("S3.7", "INCONCLUSIVE")]), "UNVERIFIED");
  assert.equal(summarizeStatus([]), "UNVERIFIED");
});

test("a known popup limitation is visible while a missing callback remains UNVERIFIED", () => {
  const printing = [observed("S4.1"), observed("S4.2"), observed("S4.3", "SKIP — TOOL LIMITATION"), observed("S4.4")];
  assert.match(summarizeScenarioGroup(printing, ["S4.1", "S4.2", "S4.3", "S4.4"]), /^PASS WITH LIMITATIONS/);
  assert.match(summarizeScenarioGroup(printing.slice(0, 3), ["S4.1", "S4.2", "S4.3", "S4.4"]), /^UNVERIFIED/);
});

test("profile readiness includes both validation boundaries and preserves failures", () => {
  assert.match(summarizeScenarioGroup([observed("S7.4")], ["S7.4", "S7.5"]), /^UNVERIFIED/);
  assert.match(summarizeScenarioGroup([observed("S7.4"), observed("S7.5", "FAIL")], ["S7.4", "S7.5"]), /^FAIL/);
  assert.match(summarizeScenarioGroup([observed("S7.4"), observed("S7.4", "FAIL")], ["S7.4"]), /^FAIL/);
});

test("unexecuted PASS and entirely skipped controls cannot become a passing summary", () => {
  const unexecuted = { ...observed("S4.1"), browserExecuted: false };
  assert.equal(completeScenarioResults([unexecuted]).find(result => result.id === "S4.1")?.status, "UNVERIFIED");
  assert.equal(summarizeStatus([unexecuted]), "UNVERIFIED");
  assert.equal(summarizeStatus([observed("S4.3", "SKIP — TOOL LIMITATION")]), "UNVERIFIED");
  const unitRegression = { ...observed("BADGE.F"), browserExecuted: false, nonBrowserAssertionExecuted: true };
  assert.equal(summarizeStatus([unitRegression]), "PASS");
});

test("console exclusion requires a captured expected local HTTP error, never numeric or conflict text alone", () => {
  const url = "http://127.0.0.1:3100/api/business/products/reorder";
  const log = { url, text: "Failed to load resource: the server responded with a status of 409 (Conflict)" };
  assert.equal(isExpectedNegativeHttpLog(log, [{ url, status: 409 }]), true);
  assert.equal(isExpectedNegativeHttpLog(log, []), false);
  assert.equal(isExpectedNegativeHttpLog({ ...log, type: "exception" }, [{ url, status: 409 }]), false);
  assert.equal(isExpectedNegativeHttpLog({ text: "Unexpected 400 or CONFLICT in component" }, []), false);
  assert.equal(isExpectedNegativeHttpLog({ ...log, url: "https://external.invalid/reorder" }, [{ url: "https://external.invalid/reorder", status: 409 }]), false);
});

test("auth evidence selects the observed POST response rather than an OPTIONS preflight", () => {
  const url = "http://127.0.0.1:4010/auth/v1/token?grant_type=password";
  const preflight = { url, method: "OPTIONS", status: 204 };
  const rejectedLogin = { url, method: "POST", status: 400 };
  assert.equal(findResponseForMethod([preflight, rejectedLogin], "http://127.0.0.1:4010/auth/v1/token", "POST"), rejectedLogin);
  assert.equal(findResponseForMethod([preflight], "http://127.0.0.1:4010/auth/v1/token", "POST"), undefined);
  assert.equal(findResponseForMethod([{ ...rejectedLogin, url: "http://127.0.0.1:4010/auth/v1/token/refresh" }], "http://127.0.0.1:4010/auth/v1/token", "POST"), undefined);
});

test("print-route evidence recognizes completed HTML MIME and rejects RSC, unrelated and failed traffic", () => {
  const url = "http://127.0.0.1:3100/panel/yazdir";
  const document = { url, method: "GET", status: 200, type: "text/html", finished: true, requestHeaders: { "Sec-Fetch-Dest": "document" } };
  const rsc = { ...document, url: `${url}?_rsc=abc`, type: "text/x-component" };
  assert.equal(findCompletedHtmlDocument([rsc, document], url), document);
  assert.equal(findCompletedHtmlDocument([{ ...document, type: "text/html; charset=utf-8" }], url)?.status, 200);
  const invalidResponses: Parameters<typeof findCompletedHtmlDocument>[0] = [
    rsc,
    { ...document, type: "Document" },
    { ...document, url: "http://127.0.0.1:3100/panel" },
    { ...document, url: "https://external.invalid/panel/yazdir" },
    { ...document, method: "POST" },
    { ...document, finished: false },
    { ...document, failure: { errorText: "net::ERR_FAILED" } },
    { ...document, requestHeaders: { RSC: "1" } },
    { ...document, requestHeaders: { "Next-Router-State-Tree": "fixture" } },
    { ...document, requestHeaders: { "Sec-Purpose": "prefetch" } },
    { ...document, requestHeaders: { "Sec-Fetch-Dest": "empty" } },
  ];
  for (const unrelated of invalidResponses) assert.equal(findCompletedHtmlDocument([unrelated], url), undefined);
  // A completed HTML 500 stays observable, but cannot satisfy the caller's 200 assertion.
  assert.equal(findCompletedHtmlDocument([{ ...document, status: 500 }], url)?.status, 500);
});
