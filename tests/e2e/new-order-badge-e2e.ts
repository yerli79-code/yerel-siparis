import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BrowserCDPClient } from "./browser-cdp-helper";

// Reuses the existing isolated loopback harness and pre-network egress gate.
export type BadgeRegressionCase = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
export async function runNewOrderBadgeRegression(
  onPass: (id: BadgeRegressionCase, evidence: string, browserExecuted: boolean) => void =
    (id, evidence) => console.log(`PASS BADGE.${id}: ${evidence}`),
) {
const client = new BrowserCDPClient();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression: string, timeout = 35_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await client.evaluate<boolean>(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function inject(status = "new", name = "Badge regression") {
  const response = await fetch("http://127.0.0.1:4010/__e2e/inject-order", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, customer_name: name }),
  });
  assert.equal(response.status, 201);
}
const badges = (count: number) => `(() => {
  const desktop = document.querySelector('.business-panel-nav-badge');
  const mobile = document.querySelector('.business-panel-mobile-badge');
  return desktop?.textContent === '${count}' && mobile?.textContent === '${count}';
})()`;
async function button(text: string) {
  await client.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(e => e.textContent?.replace(/\\s/g, '') === ${JSON.stringify(text.replace(/\s/g, ""))});
    if (!b) throw new Error('Missing button: ' + ${JSON.stringify(text)});
    b.click();
  })()`);
}

try {
  await client.launch();
  assert.equal((await fetch("http://127.0.0.1:4010/__e2e/reset", { method: "POST" })).status, 200);
  // Fixture has one New order; two injected before login form the silent baseline.
  await inject("new", "Baseline 2");
  await inject("new", "Baseline 3");
  await client.navigate("http://127.0.0.1:3100/giris");
  await client.type("#email", "e2e-business@example.invalid");
  await client.type("#password", "SafeE2ELocalOnly2026!");
  await client.click("button[type='submit']");
  await until(badges(3));
  await client.setViewport(390, 844);
  await until(badges(3));
  await client.setViewport(1366, 768);
  onPass("A", "Baseline 3 New orders; mobile and desktop badges both 3", true);
  await button("Siparişler3");
  await until("document.querySelectorAll('.panel-order-card').length === 7");
  // Establishment GET must have completed before injecting the live batch.
  await sleep(1000);
  await inject("new", "Polling badge order");
  await until("document.querySelector('.new-order-alert')?.textContent.includes('Polling badge order') && " + badges(4));
  await until("[...document.querySelectorAll('.panel-order-card')].some(e => e.textContent.includes('Polling badge order'))");
  onPass("B", "Polling alone produces alert, both badges 4 and new list row; no manual refresh/reload", true);
  await sleep(21_000);
  assert.equal(await client.evaluate(badges(4)), true);
  assert.equal(await client.evaluate("document.querySelector('.new-order-alert')?.textContent.includes('Diğer')"), false);
  onPass("C", "Repeated poll stays at 4, no duplicate alert queue entry", true);
  await client.click(".new-order-alert-dismiss");
  await until("!document.querySelector('.new-order-alert') && " + badges(4));
  onPass("D", "Alert dismissal leaves both counts at 4", true);
  // Put all New orders beyond the limited overview's first twenty rows.
  for (let i = 0; i < 22; i++) await inject("delivered", `Delivered ${i}`);
  await button("Listeyi Yenile");
  await until(badges(4));
  await button("Teslim edildi");
  await until("document.querySelectorAll('.panel-order-card').length === 20 && " + badges(4));
  await button("Sonraki");
  await until("document.querySelectorAll('.panel-order-card').length > 0 && document.querySelectorAll('.panel-order-card').length < 20 && " + badges(4));
  // Polling revalidation must retain the current filtered page and attached drawer.
  await client.click(".panel-order-row");
  await until("Boolean(document.querySelector('.panel-order-detail'))");
  const drawerBefore = await client.evaluate<string>("document.querySelector('.panel-order-detail')?.textContent || ''");
  await inject("new", "Filtered polling order");
  await until(badges(5));
  assert.equal(await client.evaluate<string>("document.querySelector('.panel-order-detail')?.textContent || ''"), drawerBefore);
  assert.equal(await client.evaluate("[...document.querySelectorAll('.panel-order-card')].some(e => e.textContent.includes('Filtered polling order'))"), false);
  onPass("E", "Filtered page 2 retains global count; polling preserves filter, page and attached drawer", true);
  // Reuse the existing race regression tests; do not copy their assertions.
  const race = await promisify(execFile)(process.execPath,
    [...process.execArgv, "--test", "app/panel/new-order-count.test.ts"],
    { timeout: 30_000 });
  assert.match(race.stdout, /older count cannot overwrite a newer response/);
  onPass("F", "Existing count request unit regressions passed: older response cannot overwrite newer count", false);
  for (let i = 0; i < 20; i++) await inject("new", `Global New ${i}`);
  await until(badges(25));
  onPass("G", "Global count 25 exceeds overview's 20-record limit", true);
  // Independent fixture/document: hold watcher reads before they reach the mock.
  // Count reads have status=new; list reads have pageSize=20 and stay enabled.
  assert.equal((await fetch("http://127.0.0.1:4010/__e2e/reset", { method: "POST" })).status, 200);
  for (let i = 0; i < 22; i++) await inject("new", `Manual baseline ${i}`);
  await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname === '/api/business/orders' && url.searchParams.get('pageSize') === '10' && !url.searchParams.get('status')) {
        return new Promise((_, reject) => {
          const signal = init?.signal;
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        });
      }
      return originalFetch(input, init);
    };
  ` });
  await client.navigate("http://127.0.0.1:3100/panel");
  await until(badges(23));
  await button("Siparişler23");
  await until("document.querySelectorAll('.panel-order-card').length === 20");
  await button("Yeni");
  await until("document.querySelector('.business-panel-workspace')?.textContent.includes('23 kayıt') && [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Sonraki' && !b.disabled)");
  await button("Sonraki");
  await until("document.querySelectorAll('.panel-order-card').length === 3 && document.querySelector('.panel-order-pagination')?.textContent.includes('Sayfa 2 / 2')");
  await client.click(".panel-order-row");
  await until("Boolean(document.querySelector('.panel-order-detail'))");
  const manualDrawer = await client.evaluate<string>("document.querySelector('.panel-order-detail')?.textContent || ''");
  const beforeRefresh = client.networkLogs.length;
  await inject("new", "Manual refresh only order");
  assert.equal(await client.evaluate(badges(23)), true);
  await button("Listeyi Yenile");
  await until(badges(24) + " && document.querySelectorAll('.panel-order-card').length === 4 && document.querySelector('.panel-order-pagination')?.textContent.includes('Sayfa 2 / 2')");
  assert.equal(await client.evaluate<string>("document.querySelector('.panel-order-detail')?.textContent || ''"), manualDrawer);
  assert.equal(await client.evaluate("Boolean(document.querySelector('.new-order-alert'))"), false);
  const countReads = client.networkLogs.slice(beforeRefresh).filter(log => {
    const url = new URL(log.url);
    return url.pathname === "/api/business/orders" && url.searchParams.get("status") === "new" && url.searchParams.get("pageSize") === "10";
  });
  assert.equal(countReads.length, 1);
  await button("Önceki");
  await until("[...document.querySelectorAll('.panel-order-card')].some(e => e.textContent.includes('Manual refresh only order')) && " + badges(24));
  onPass("H", "Manual refresh alone updates both global badges 23→24 and list; New filter/page 2/drawer retained, one count GET, watcher held", true);
  assert.equal(client.egressViolation, false);
  assert.equal(client.blockedRequests.length, 0);
  console.log("PASS: isolated browser egress gate; production access 0");
} finally {
  await client.close();
}
}
if (process.argv[1]?.endsWith("new-order-badge-e2e.ts")) {
  runNewOrderBadgeRegression().catch(error => { console.error(error); process.exitCode = 1; });
}
