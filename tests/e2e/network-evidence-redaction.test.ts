import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserCDPClient, type NetworkLogEntry } from "./browser-cdp-helper";
import { REDACTED, redactEvidenceText, redactNetworkHeaders, stringifyRedactedEvidence } from "./network-evidence-redaction";
import { assessUpload } from "./upload-network-assertion";

test("credential header values are redacted regardless of casing or synthetic value shape", () => {
  const sensitive = {
    aUtHoRiZaTiOn: "Bearer synthetic-own-account",
    APIKEY: "synthetic-publishable-key",
    "x-Api-Key": "synthetic-api-key",
    CoOkIe: "session=synthetic-session; theme=dark",
    "sEt-CoOkIe": "session=synthetic-session; HttpOnly; SameSite=Lax",
    "Proxy-Authorization": "Basic synthetic-basic",
    "X-Access-Token": "synthetic-access",
    "X-CSRF-Token": "synthetic-csrf",
    "X-Vercel-Protection-Bypass": "synthetic-bypass",
    "Authentication-Info": "synthetic-auth-info",
    "Access-Control-Secret": "synthetic-custom-secret",
  };
  const benign = {
    Origin: "http://127.0.0.1:3100",
    "Access-Control-Request-Headers": "apikey,authorization,content-type,x-upsert",
    "Access-Control-Allow-Headers": "apikey,authorization,content-type,x-upsert",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "x-upsert": "true",
    "Content-Type": "image/png",
    "X-Request-ID": "request-123",
    "Idempotency-Key": "fixture-upload-123",
  };
  const original = { ...sensitive, ...benign };
  const safe = redactNetworkHeaders(original)!;
  for (const name of Object.keys(sensitive)) assert.equal(safe[name], REDACTED, name);
  for (const [name, value] of Object.entries(benign)) assert.equal(safe[name], value, name);
  assert.deepEqual(original, { ...sensitive, ...benign }, "redaction must not mutate transport headers");
  for (const value of Object.values(sensitive)) assert(!JSON.stringify(safe).includes(value));
  assert.equal(redactNetworkHeaders(undefined), undefined);
});

test("private header comparisons retain own/foreign account checks while public upload evidence stays redacted", () => {
  const client = new BrowserCDPClient();
  const url = "http://127.0.0.1:4010/storage/v1/object/product-images/fixture/image.png";
  const own = "Bearer synthetic-own-account";
  const foreign = "Bearer synthetic-foreign-account";
  const requests: NetworkLogEntry[] = [
    { requestId: "preflight-123", initiatorRequestId: "upload-123", url, method: "OPTIONS", host: "127.0.0.1:4010", status: 204, finished: true,
      requestHeaders: { "Access-Control-Request-Headers": "apikey,authorization,content-type,x-upsert" },
      responseHeaders: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "apikey,authorization,content-type,x-upsert" } },
    { requestId: "upload-123", url, method: "POST", host: "127.0.0.1:4010", status: 200, finished: true,
      requestHeaders: { aUtHoRiZaTiOn: own, apikey: "synthetic-publishable-key", Cookie: "session=synthetic-own-session" },
      responseHeaders: { "sEt-CoOkIe": "session=synthetic-response-session; HttpOnly" } },
  ];
  // Feed the same capture boundary as CDP requestWillBeSent without launching Chrome.
  const capture = client as unknown as { recordNetworkRequest(request: NetworkLogEntry): void };
  for (const request of requests) capture.recordNetworkRequest(request);
  const upload = client.networkLogs[1];
  assert.equal(client.requestHeaderMatches(upload, "AUTHORIZATION", own), true);
  assert.equal(client.requestHeaderMatches(upload, "authorization", foreign), false);
  assert.equal(client.requestHeaderMatches(upload, "Authorization", REDACTED), false);
  assert.equal(client.requestHeaderMatches({ ...upload }, "Authorization", own), false);
  assert.equal(client.requestHeaderMatches(upload, "missing-header", own), false);
  assert.equal(client.networkLogs[1].requestHeaders?.aUtHoRiZaTiOn, REDACTED);
  assert.equal(client.networkLogs[1].responseHeaders?.["sEt-CoOkIe"], REDACTED);
  const output = JSON.stringify(client.networkLogs);
  for (const secret of [own, foreign, "synthetic-publishable-key", "synthetic-own-session", "synthetic-response-session"]) {
    assert(!output.includes(secret));
    assert(!JSON.stringify(client).includes(secret), "client snapshots must not expose plaintext credentials");
  }
  assert.equal(client.networkLogs[0].initiatorRequestId, "upload-123");
  assert.equal(assessUpload({
    network: client.networkLogs,
    serverRequests: [{ method: "OPTIONS", pathname: new URL(url).pathname }, { method: "POST", pathname: new URL(url).pathname }],
    formSuccess: true,
    publicImageUrl: url.replace("/object/", "/object/public/"),
  }).status, "PASS");
});

test("redirect hops sharing a CDP requestId retain independent credential comparisons", () => {
  const client = new BrowserCDPClient();
  const own = "Bearer synthetic-own-redirect-account";
  const foreign = "Bearer synthetic-foreign-redirect-account";
  const capture = client as unknown as { recordNetworkRequest(request: NetworkLogEntry): void };
  capture.recordNetworkRequest({
    requestId: "shared-redirect-id", method: "GET", host: "127.0.0.1:4010",
    url: "http://127.0.0.1:4010/rest/v1/products?business_id=eq.foreign",
    requestHeaders: { Authorization: foreign },
  });
  capture.recordNetworkRequest({
    requestId: "shared-redirect-id", method: "GET", host: "127.0.0.1:4010",
    url: "http://127.0.0.1:4010/rest/v1/products?business_id=eq.own",
    requestHeaders: { authorization: own },
  });
  const [first, second] = client.networkLogs;
  assert.equal(first.requestId, second.requestId);
  assert.equal(client.requestHeaderMatches(first, "Authorization", own), false);
  assert.equal(client.requestHeaderMatches(first, "authorization", foreign), true);
  assert.equal(client.requestHeaderMatches(second, "AUTHORIZATION", own), true);
  assert.equal(client.requestHeaderMatches(second, "Authorization", foreign), false);
  assert.equal(first.requestHeaders?.Authorization, REDACTED);
  assert.equal(second.requestHeaders?.authorization, REDACTED);
  assert(!JSON.stringify(client.networkLogs).includes("synthetic-"));
});

test("report serialization and console text omit credential values but retain useful CORS and failure context", () => {
  const output = stringifyRedactedEvidence({
    requestId: "upload-123",
    headers: [
      { name: "Set-Cookie", value: "session=synthetic-cookie; HttpOnly" },
      { name: "Access-Control-Allow-Headers", value: "apikey,authorization,x-upsert" },
    ],
    requestHeaders: { Authorization: "Bearer synthetic-auth", apikey: "synthetic-key" },
    message: 'CORS failure Authorization="Bearer synthetic-auth" apikey=synthetic-key, status=403',
  });
  for (const secret of ["synthetic-cookie", "synthetic-auth", "synthetic-key"]) assert(!output.includes(secret));
  assert(output.includes("upload-123"));
  assert(output.includes("apikey,authorization,x-upsert"));
  assert(output.includes("status=403"));
  assert(output.includes("Set-Cookie"));
  assert.equal(redactEvidenceText("CORS blocked request net::ERR_FAILED"), "CORS blocked request net::ERR_FAILED");
  assert(!redactEvidenceText('headers {"Authorization":"Bearer synthetic-auth","apikey":"synthetic-key"}').includes("synthetic-"));
  assert(!redactEvidenceText("Cookie: session=synthetic-cookie; other=synthetic-other\nnet::ERR_FAILED").includes("synthetic-"));
  assert(!redactEvidenceText("HTTP 401 Basic synthetic-basic").includes("synthetic-basic"));
});
