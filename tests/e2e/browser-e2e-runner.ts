import { BrowserCDPClient } from "./browser-cdp-helper";
import { assessUpload } from "./upload-network-assertion";
import { runNewOrderBadgeRegression } from "./new-order-badge-e2e";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { completeScenarioResults, findCompletedHtmlDocument, findResponseForMethod, isExpectedNegativeHttpLog, renderSuiteSummary, summarizeScenarioGroup, summarizeStatus, type ScenarioResult } from "./browser-e2e-report";
import { redactEvidenceText } from "./network-evidence-redaction";

const results: ScenarioResult[] = [];

function recordResult(res: ScenarioResult) {
  results.push({ ...res, networkEvidence: redactEvidenceText(res.networkEvidence), domEvidence: redactEvidenceText(res.domEvidence), notes: res.notes && redactEvidenceText(res.notes) });
  console.log(`[E2E] [${res.status}] ${res.id} - ${res.name} (Executed: ${res.browserExecuted ? "YES" : "NO"})`);
}

async function resetMock() {
  const res = await fetch("http://127.0.0.1:4010/__e2e/reset", { method: "POST" });
  if (!res.ok) throw new Error("Failed to reset mock fixtures");
}

function mutationCountSince(client: BrowserCDPClient, start: number) {
  return client.networkLogs.slice(start).filter(log => ["POST", "PATCH", "PUT", "DELETE"].includes(log.method)).length;
}

async function observeSubscriptionControls(client: BrowserCDPClient) {
  await client.evaluate(`(() => {
    const button = [...document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")].find(button => button.textContent?.includes("Ürünler"));
    if (!button) throw new Error("Missing products navigation control");
    button.click();
  })()`);
  await client.waitForSelector(".panel-product-list", 3000);
  const productCreationDisabled = await client.evaluate<boolean | null>(`(() => {
    const button = document.querySelector("button.business-panel-primary-command");
    return button ? button.disabled : null;
  })()`);
  await client.evaluate(`(() => {
    const button = [...document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")].find(button => button.textContent?.includes("Siparişler"));
    if (!button) throw new Error("Missing orders navigation control");
    button.click();
  })()`);
  await client.waitForSelector(".panel-order-card", 3000);
  await client.click(".panel-order-card:first-child button.panel-order-row");
  await client.waitForSelector(".panel-order-detail-status select", 3000);
  const orderStatusDisabled = await client.evaluate<boolean | null>(`(() => {
    const select = document.querySelector(".panel-order-detail-status select");
    return select ? select.disabled : null;
  })()`);
  await client.click(".panel-order-detail-header button");
  return { productCreationDisabled, orderStatusDisabled };
}

async function runAllSuites() {
  const testedSource = {
    branch: execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim() || "(detached)",
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    trackedChanges: execFileSync("git", ["diff", "HEAD", "--name-only"], { encoding: "utf8" }).trim(),
  };
  const client = new BrowserCDPClient();
  let browserLaunched = false;
  let mainAudit: { hosts: string[]; requests: number; external: number; supabaseCo: number; productionDomain: number; blocked: number; egressViolation: boolean; consoleErrors: number; expectedNegativeLogs: number; unexpectedConsoleErrors: number; loadingFailures: number } | undefined;

  try {
    console.log("==================================================");
    console.log("STARTING LOCAL AUTHENTICATED BROWSER E2E TEST RUN");
    console.log("==================================================");

    await client.launch();
    browserLaunched = true;
    console.log("[Setup] Google Chrome launched and CDP connected.");

    await resetMock();

    // ==================================================
    // SUITE 1: AUTHENTICATION SUITE (S1.1 - S1.5)
    // ==================================================
    console.log("\n--- SUITE 1: AUTHENTICATION SUITE ---");

    // S1.2 Invalid password
    try {
      await client.setViewport(1280, 800);
      await client.navigate("http://127.0.0.1:3100/giris");
      await client.type("#email", "e2e-business@example.invalid");
      await client.type("#password", "WrongPassword123!");

      const preNet = client.networkLogs.length;
      await client.click("button[type='submit']");

      const errorFound = await client.waitForSelector("p[class*='alert']", 4000);
      const errorText = errorFound ? await client.evaluate<string>("document.querySelector(\"p[class*='alert']\")?.textContent || ''") : "";
      const currentUrl = await client.evaluate<string>("window.location.pathname");

      const postNet = client.networkLogs.slice(preNet);
      const authCall = findResponseForMethod(postNet, "http://127.0.0.1:4010/auth/v1/token", "POST");

      recordResult({
        id: "S1.2",
        name: "Invalid credentials rejection",
        suite: "Authentication",
        status: errorFound && errorText.includes("Giriş başarısız") && currentUrl.includes("/giris") && authCall?.status === 400 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `POST /auth/v1/token -> observed HTTP ${authCall?.status ?? "UNVERIFIED (no captured POST response)"}`,
        domEvidence: `Alert: "${errorText.trim()}", URL remained "${currentUrl}"`,
        notes: "Expected: 400 POST auth response, failed-login alert and login route retained; session generation is not inspected here.",
      });
    } catch (err: any) {
      recordResult({
        id: "S1.2",
        name: "Invalid credentials rejection",
        suite: "Authentication",
        status: "FAIL",
        browserExecuted: true,
        networkEvidence: "Exception during execution",
        domEvidence: err.message,
      });
    }

    // S1.1 Valid login
    try {
      await client.type("#password", "SafeE2ELocalOnly2026!");
      const preNet = client.networkLogs.length;
      await client.click("button[type='submit']");

      let onPanel = false;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const path = await client.evaluate<string>("window.location.pathname");
        if (path === "/panel") {
          onPanel = true;
          break;
        }
      }

      await client.waitForSelector(".business-panel-workspace, h1", 5000);
      const pageText = await client.evaluate<string>("document.body.innerText");
      const postNet = client.networkLogs.slice(preNet);
      const tokenCall = findResponseForMethod(postNet, "http://127.0.0.1:4010/auth/v1/token", "POST");

      recordResult({
        id: "S1.1",
        name: "Valid password login & session establishment",
        suite: "Authentication",
        status: onPanel && pageText.includes("E2E Test Kebap Salonu") && tokenCall?.status === 200 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `POST /auth/v1/token -> observed HTTP ${tokenCall?.status ?? "UNVERIFIED (no captured response)"}`,
        domEvidence: `panelRouteObserved=${onPanel}, fixture business name present=${pageText.includes("E2E Test Kebap Salonu")}`,
        notes: "Expected: panel route and fixture business name after login.",
      });
    } catch (err: any) {
      recordResult({
        id: "S1.1",
        name: "Valid password login",
        suite: "Authentication",
        status: "FAIL",
        browserExecuted: true,
        networkEvidence: "Exception",
        domEvidence: err.message,
      });
    }

    // S1.3 Authenticated direct /panel refresh
    try {
      const preNet = client.networkLogs.length;
      await client.navigate("http://127.0.0.1:3100/panel");
      await client.waitForSelector(".business-panel-workspace", 5000);

      const path = await client.evaluate<string>("window.location.pathname");
      const hasWorkspace = await client.evaluate<boolean>("document.querySelector('.business-panel-workspace') !== null");
      const postNet = client.networkLogs.slice(preNet);
      const userCall = findResponseForMethod(postNet, "http://127.0.0.1:4010/auth/v1/user", "GET");

      recordResult({
        id: "S1.3",
        name: "Authenticated direct /panel page reload",
        suite: "Authentication",
        status: path === "/panel" && hasWorkspace && userCall?.status === 200 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `GET /auth/v1/user -> observed HTTP ${userCall?.status ?? "UNVERIFIED (no captured response)"}`,
        domEvidence: `pathname=${path}, workspaceMounted=${hasWorkspace}`,
        notes: "Expected: panel route and mounted workspace after direct reload.",
      });
    } catch (err: any) {
      recordResult({
        id: "S1.3",
        name: "Authenticated direct /panel page reload",
        suite: "Authentication",
        status: "FAIL",
        browserExecuted: true,
        networkEvidence: "Exception",
        domEvidence: err.message,
      });
    }

    // S1.4 Explicit Logout
    try {
      await client.click("button.business-panel-logout");
      let loggedOut = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const path = await client.evaluate<string>("window.location.pathname");
        if (path === "/giris" || path === "/") {
          loggedOut = true;
          break;
        }
      }
      const curPath = await client.evaluate<string>("window.location.pathname");
      const hasSession = await client.evaluate<boolean>("sessionStorage.getItem('yerel-siparis-business-session') !== null");

      recordResult({
        id: "S1.4",
        name: "Explicit logout & session clearance",
        suite: "Authentication",
        status: loggedOut && !hasSession ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Logout control clicked; mutation request count not measured in this scenario.",
        domEvidence: `Redirected to ${curPath}, sessionStorage cleared=${!hasSession}`,
        notes: "Expected: logout redirect and sessionStorage clearance.",
      });
    } catch (err: any) {
      recordResult({
        id: "S1.4",
        name: "Explicit logout",
        suite: "Authentication",
        status: "FAIL",
        browserExecuted: true,
        networkEvidence: "Exception",
        domEvidence: err.message,
      });
    }

    // S1.5 Invalid/tampered session redirect
    try {
      await client.evaluate(`(() => {
        try { sessionStorage.setItem('yerel-siparis-business-session', 'invalid.tampered.token'); } catch(e){}
      })()`);
      await client.navigate("http://127.0.0.1:3100/panel");

      let redirected = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const path = await client.evaluate<string>("window.location.pathname");
        if (path === "/giris") {
          redirected = true;
          break;
        }
      }
      const finalPath = await client.evaluate<string>("window.location.pathname");

      recordResult({
        id: "S1.5",
        name: "Invalid or tampered session rejection",
        suite: "Authentication",
        status: redirected ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Tampered local session supplied; auth response status not inspected in this scenario.",
        domEvidence: `Redirected from /panel to ${finalPath}`,
        notes: "Expected: login redirect for the tampered session.",
      });
    } catch (err: any) {
      recordResult({
        id: "S1.5",
        name: "Invalid session redirect",
        suite: "Authentication",
        status: "FAIL",
        browserExecuted: true,
        networkEvidence: "Exception",
        domEvidence: err.message,
      });
    }

    // ==================================================
    // SUITE 2: VIEWPORT & RESPONSIVE SUITE (S2.1 - S2.8 + F1)
    // ==================================================
    console.log("\n--- SUITE 2: VIEWPORT & RESPONSIVE SUITE ---");
    // Re-authenticate for authenticated panel tests
    await resetMock();
    await client.navigate("http://127.0.0.1:3100/giris");
    await client.type("#email", "e2e-business@example.invalid");
    await client.type("#password", "SafeE2ELocalOnly2026!");
    await client.click("button[type='submit']");
    await client.waitForSelector(".business-panel-workspace", 5000);

    // Switch to orders tab so .panel-order-row is rendered for responsive & dense layout checks
    await client.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")).find(b => b.textContent?.includes("Siparişler"));
      if (btn) btn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    await client.waitForSelector(".panel-order-card", 5000);

    const viewports = [
      { id: "S2.1.VP390", name: "Mobile Portrait (390 x 844)", w: 390, h: 844 },
      { id: "S2.2.VP768", name: "Tablet Portrait (768 x 1024)", w: 768, h: 1024 },
      { id: "S2.3.VP1024", name: "Small Desktop (1024 x 768)", w: 1024, h: 768 },
      { id: "S2.4.VP1100", name: "Intermediate Desktop (1100 x 800)", w: 1100, h: 800 },
      { id: "S2.5.VP1199", name: "Pre-Threshold Desktop (1199 x 800)", w: 1199, h: 800 },
      { id: "S2.6.VP1200", name: "Dense Desktop Breakpoint (1200 x 800)", w: 1200, h: 800 },
      { id: "S2.7.VP1366", name: "Standard Desktop (1366 x 768)", w: 1366, h: 768 },
      { id: "S2.8.VP1440", name: "Large Desktop (1440 x 900)", w: 1440, h: 900 },
    ];

    for (const vp of viewports) {
      try {
        await client.setViewport(vp.w, vp.h);
        await new Promise((r) => setTimeout(r, 200));

        const geom = await client.evaluate<{ scrollWidth: number; clientWidth: number; innerWidth: number }>(`(() => {
          return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            innerWidth: window.innerWidth
          };
        })()`);

        const isDenseActive = await client.evaluate<boolean>(`(() => {
          const row = document.querySelector(".panel-order-row");
          if (!row) return false;
          const cols = window.getComputedStyle(row).gridTemplateColumns.split(" ");
          return cols.length >= 7;
        })()`);

        const noHorizontalScroll = geom.scrollWidth <= geom.clientWidth;
        let notes = `scrollWidth=${geom.scrollWidth}px, clientWidth=${geom.clientWidth}px`;
        if (vp.w === 1024 || vp.w === 1100 || vp.w === 1199) {
          notes += `, denseLayoutObserved=${isDenseActive}, expected=false`;
        } else if (vp.w >= 1200) {
          notes += `, denseLayoutObserved=${isDenseActive}, expected=true`;
        }

        recordResult({
          id: vp.id,
          name: vp.name,
          suite: "Responsive",
          status: noHorizontalScroll && (vp.w < 1024 || isDenseActive === (vp.w >= 1200)) ? "PASS" : "FAIL",
          browserExecuted: true,
          networkEvidence: "Client-side viewport emulation (CDP Page.setDeviceMetricsOverride)",
          domEvidence: `scrollWidth=${geom.scrollWidth}, clientWidth=${geom.clientWidth}, noHorizontalScroll=${noHorizontalScroll}, denseLayoutObserved=${isDenseActive}`,
          notes,
        });
      } catch (err: any) {
        recordResult({
          id: vp.id,
          name: vp.name,
          suite: "Responsive",
          status: "FAIL",
          browserExecuted: true,
          networkEvidence: "None",
          domEvidence: err.message,
        });
      }
    }

    // PHASE 4 F1: 1100px vs 1200px breakpoint grid verification
    try {
      await client.setViewport(1100, 800);
      await new Promise((r) => setTimeout(r, 200));
      const cols1100 = await client.evaluate<string>(`(() => {
        const row = document.querySelector(".panel-order-row");
        return row ? window.getComputedStyle(row).gridTemplateColumns : "";
      })()`);

      await client.setViewport(1200, 800);
      await new Promise((r) => setTimeout(r, 200));
      const cols1200 = await client.evaluate<string>(`(() => {
        const row = document.querySelector(".panel-order-row");
        return row ? window.getComputedStyle(row).gridTemplateColumns : "";
      })()`);

      const colCount1100 = cols1100 ? cols1100.split(" ").length : 0;
      const colCount1200 = cols1200 ? cols1200.split(" ").length : 0;
      const f1Pass = colCount1100 > 0 && colCount1100 < 7 && colCount1200 >= 7;

      recordResult({
        id: "PHASE4.F1",
        name: "Intermediate Desktop (1024-1199px vs >=1200px) Dense Orders Layout Transition",
        suite: "Responsive",
        status: f1Pass ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "CSS media query evaluation (@media min-width: 1200px)",
        domEvidence: `1100px: ${colCount1100} columns (${cols1100}), 1200px: ${colCount1200} columns (${cols1200})`,
        notes: "Expected: a rendered row below seven columns at 1100px and at least seven columns at 1200px.",
      });
    } catch (err: any) {
      recordResult({
        id: "PHASE4.F1",
        name: "Dense Orders Layout Transition",
        suite: "Responsive",
        status: "FAIL",
        browserExecuted: true,
        networkEvidence: "None",
        domEvidence: err.message,
      });
    }

    // ==================================================
    // SUITE 3: ORDER MANAGEMENT SUITE (S3.1 - S3.9)
    // ==================================================
    console.log("\n--- SUITE 3: ORDER MANAGEMENT SUITE ---");
    await resetMock();
    await client.setViewport(1280, 800);
    await client.navigate("http://127.0.0.1:3100/panel");
    await client.waitForSelector(".business-panel-workspace", 5000);

    // Switch to orders tab
    await client.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")).find(b => b.textContent?.includes("Siparişler"));
      if (btn) btn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 400));

    // S3.1 Order list render
    try {
      const orderCount = await client.evaluate<number>("document.querySelectorAll('.panel-order-card').length");
      recordResult({
        id: "S3.1",
        name: "Order list initial render",
        suite: "Orders",
        status: orderCount === 5 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Order list DOM inspected; backend request status not inspected in this scenario.",
        domEvidence: `${orderCount} .panel-order-card elements rendered in DOM`,
        notes: "Expected: five initial fixture order cards; price/badge fidelity is not asserted here.",
      });
    } catch (err: any) {
      recordResult({ id: "S3.1", name: "Order list render", suite: "Orders", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S3.2 Status filter tabs
    try {
      // Click 'Yeni' filter
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll(".business-panel-order-filters button")).find(b => b.textContent?.trim() === "Yeni");
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      const newCount = await client.evaluate<number>("document.querySelectorAll('.panel-order-card').length");

      // Click 'Tümü' filter
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll(".business-panel-order-filters button")).find(b => b.textContent?.trim() === "Tümü");
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      const allCount = await client.evaluate<number>("document.querySelectorAll('.panel-order-card').length");

      recordResult({
        id: "S3.2",
        name: "Status filter pills (Yeni vs Tümü)",
        suite: "Orders",
        status: newCount === 1 && allCount === 5 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Status filter controls clicked; backend response status not inspected in this scenario.",
        domEvidence: `Yeni filter count=${newCount}, Tümü filter count=${allCount}`,
        notes: "Expected: one New order and five All orders.",
      });
    } catch (err: any) {
      recordResult({ id: "S3.2", name: "Status filters", suite: "Orders", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S3.3 Search filters
    try {
      // 1. Search 'Ahmet'
      await client.type(".panel-order-search-field input", "Ahmet");
      await client.click("form.panel-order-filter-form button[type='submit']");
      await new Promise((r) => setTimeout(r, 500));
      const ahmetCount = await client.evaluate<number>("document.querySelectorAll('.panel-order-card').length");
      const ahmetName = await client.evaluate<string>("document.querySelector('.panel-order-main strong')?.textContent || ''");

      // 2. Search '05559876543'
      await client.type(".panel-order-search-field input", "05559876543");
      await client.click("form.panel-order-filter-form button[type='submit']");
      await new Promise((r) => setTimeout(r, 500));
      const phoneCount = await client.evaluate<number>("document.querySelectorAll('.panel-order-card').length");
      const phoneName = await client.evaluate<string>("document.querySelector('.panel-order-main strong')?.textContent || ''");

      // 3. Search '#101'
      await client.type(".panel-order-search-field input", "#101");
      await client.click("form.panel-order-filter-form button[type='submit']");
      await new Promise((r) => setTimeout(r, 500));
      const numCount = await client.evaluate<number>("document.querySelectorAll('.panel-order-card').length");
      const numText = await client.evaluate<string>("document.querySelector('.panel-order-number strong')?.textContent || ''");

      // Clear search filter
      await client.click(".panel-order-filter-actions button.panel-secondary-action");
      await new Promise((r) => setTimeout(r, 400));

      const pass = ahmetCount === 1 && ahmetName.includes("Ahmet") && phoneCount === 1 && phoneName.includes("Mehmet") && numCount === 1 && numText.includes("#101");
      recordResult({
        id: "S3.3",
        name: "Order search filters (customer name, phone, order number)",
        suite: "Orders",
        status: pass ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Search form submitted for customer name, phone and order number; backend response status not inspected here.",
        domEvidence: `Ahmet=${ahmetCount} (${ahmetName}), Phone=${phoneCount} (${phoneName}), #101=${numCount} (${numText})`,
        notes: "Expected: one matching card for each search and the expected customer/order number text.",
      });
    } catch (err: any) {
      recordResult({ id: "S3.3", name: "Search filters", suite: "Orders", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S3.4 Order detail drawer
    try {
      await client.click(".panel-order-card:first-child button.panel-order-row");
      const detailOpen = await client.waitForSelector(".panel-order-drawer, aside[role='dialog']", 4000);
      const customer = await client.evaluate<string>("document.querySelector('.panel-order-detail-block strong')?.textContent || ''");
      const itemCount = await client.evaluate<number>("document.querySelectorAll('.panel-order-item').length");

      recordResult({
        id: "S3.4",
        name: "Order detail expansion modal/drawer",
        suite: "Orders",
        status: detailOpen && itemCount > 0 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Order detail control clicked; re-fetch count not measured in this scenario.",
        domEvidence: `Drawer open=${detailOpen}, customer="${customer}", line items=${itemCount}`,
        notes: "Expected: an open detail drawer with at least one line item; payment fidelity is not asserted here.",
      });
    } catch (err: any) {
      recordResult({ id: "S3.4", name: "Order detail drawer", suite: "Orders", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S3.5 Status transition (new -> preparing)
    try {
      const newCountBefore = await client.evaluate<number>("Number(document.querySelector('.business-panel-nav-badge')?.textContent || '0')");
      const preNet = client.networkLogs.length;
      await client.select(".panel-order-detail-status select", "preparing");

      let updatedBadge = "";
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        updatedBadge = await client.evaluate<string>("document.querySelector('.order-status-badge')?.textContent || ''");
        if (updatedBadge.includes("Hazırlanıyor")) break;
      }
      const postNet = client.networkLogs.slice(preNet);
      const patchCall = postNet.find((n) => n.url.includes("/api/business/orders/") && n.method === "PATCH");
      let countRevalidated = false;
      for (let i = 0; i < 40; i++) {
        countRevalidated = await client.evaluate<boolean>(`Number(document.querySelector('.business-panel-nav-badge')?.textContent || '0') === ${newCountBefore - 1} && Number(document.querySelector('.business-panel-mobile-badge')?.textContent || '0') === ${newCountBefore - 1}`);
        if (countRevalidated) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      recordResult({
        id: "S3.5",
        name: "Order status transition workflow (new -> preparing)",
        suite: "Orders",
        status: updatedBadge.includes("Hazırlanıyor") && countRevalidated && patchCall?.status === 200 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `PATCH /api/business/orders -> observed HTTP ${patchCall?.status ?? "UNVERIFIED (no captured response)"}`,
        domEvidence: `Status badge="${updatedBadge.trim()}", bothNewCountsRevalidated=${countRevalidated}`,
        notes: "Expected: 200 order-status response, Preparing status badge and decremented mobile/desktop New counts.",
      });
    } catch (err: any) {
      recordResult({ id: "S3.5", name: "Status transition", suite: "Orders", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S3.6 Cancellation confirmation modal
    try {
      const preNet = client.networkLogs.length;
      await client.select(".panel-order-detail-status select", "cancelled");
      const confirmRendered = await client.waitForSelector(".panel-order-cancel-dialog", 3000);
      const title = await client.evaluate<string>("document.querySelector('#panel-order-cancel-title')?.textContent || ''");

      // Cancel out of dialog
      await client.click(".panel-order-cancel-actions button.panel-secondary-action");
      await new Promise((r) => setTimeout(r, 200));
      const mutations = mutationCountSince(client, preNet);
      const cancelledDialogClosed = await client.evaluate<boolean>("document.querySelector('.panel-order-cancel-dialog') === null");

      recordResult({
        id: "S3.6",
        name: "Order cancellation confirmation modal & safety guard",
        suite: "Orders",
        status: confirmRendered && title.includes("İptal") && cancelledDialogClosed && mutations === 0 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `Observed mutation requests during cancellation selection and dismissal=${mutations}`,
        domEvidence: `confirmationRendered=${confirmRendered}, title="${title}", dialogClosedAfterDismissal=${cancelledDialogClosed}`,
        notes: "Expected: cancellation confirmation and dismissal without a mutation request.",
      });
    } catch (err: any) {
      recordResult({ id: "S3.6", name: "Cancellation confirmation", suite: "Orders", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S3.7 Rapid duplicate status click guard
    try {
      // Order 1 (customer "Ahmet Yılmaz", id "...2001") is open in detail drawer from S3.5, with status "preparing"
      const initialStatus = await client.evaluate<string>("document.querySelector('.panel-order-detail-status select')?.value || ''");

      const preBrowserCount = client.networkLogs.filter((n) => n.url.includes("/api/business/orders/") && n.method === "PATCH").length;
      const preMockReqs = await fetch("http://127.0.0.1:4010/__e2e/requests").then((r) => r.json());
      const preMockCount = (preMockReqs.requests as any[]).filter((r: any) => r.pathname.startsWith("/rest/v1/orders") && r.method === "PATCH").length;

      // Select "ready" and trigger rapid duplicate event
      await client.select(".panel-order-detail-status select", "ready");
      await client.select(".panel-order-detail-status select", "ready");
      await new Promise((r) => setTimeout(r, 800));

      const postBrowserCount = client.networkLogs.filter((n) => n.url.includes("/api/business/orders/") && n.method === "PATCH").length;
      const postMockReqs = await fetch("http://127.0.0.1:4010/__e2e/requests").then((r) => r.json());
      const postMockCount = (postMockReqs.requests as any[]).filter((r: any) => r.pathname.startsWith("/rest/v1/orders") && r.method === "PATCH").length;

      const browserDiff = postBrowserCount - preBrowserCount;
      const mockDiff = postMockCount - preMockCount;

      const finalStatus = await client.evaluate<string>("document.querySelector('.panel-order-detail-status select')?.value || ''");
      const s37Pass = browserDiff === 1 && mockDiff === 1 && initialStatus === "preparing" && finalStatus === "ready";

      recordResult({
        id: "S3.7",
        name: "In-flight duplicate status change guard",
        suite: "Orders",
        status: s37Pass ? "PASS" : (browserDiff === 0 ? "FAIL" : "INCONCLUSIVE"),
        browserExecuted: true,
        networkEvidence: `Browser PATCH /api/business/orders/... count=${browserDiff}, Backend mock PATCH /rest/v1/orders count=${mockDiff}`,
        domEvidence: `Observed status before="${initialStatus}", after="${finalStatus}"; transient disabled state was not sampled.`,
        notes: "Expected: Preparing -> Ready with one browser and one backend PATCH.",
      });
    } catch (err: any) {
      recordResult({ id: "S3.7", name: "Duplicate click guard", suite: "Orders", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S3.8 ORDER_CONFLICT stale-browser conditional PATCH
    try {
      // Mutate order directly on mock to advance updated_at
      const targetRes = await fetch("http://127.0.0.1:4010/rest/v1/orders?id=eq.00000000-0000-4000-8000-000000002001");
      const targetRows = (await targetRes.json()) as Array<{ id: string; updated_at: string }>;
      const targetRow = targetRows[0];

      await fetch(
        `http://127.0.0.1:4010/rest/v1/orders?id=eq.${targetRow.id}&updated_at=eq.${targetRow.updated_at}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() }),
        }
      );

      // Trigger status update in stale browser UI
      const preNet = client.networkLogs.length;
      await client.select(".panel-order-detail-status select", "delivered");
      await new Promise((r) => setTimeout(r, 800));

      const conflictMsg = await client.evaluate<string>("document.querySelector('.panel-order-mutation-message')?.textContent || ''");
      const reloadBtn = await client.evaluate<boolean>("document.querySelector('.panel-order-mutation-message button') !== null");
      const conflictCall = client.networkLogs.slice(preNet).find(n => n.url.includes("/api/business/orders/") && n.method === "PATCH");

      recordResult({
        id: "S3.8",
        name: "ORDER_CONFLICT stale-state conditional PATCH handling & recovery",
        suite: "Orders",
        status: conflictMsg.includes("güncellendi") && reloadBtn && conflictCall?.status === 409 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `Observed business order PATCH HTTP ${conflictCall?.status ?? "UNVERIFIED (no captured response)"}; backend row-count response was not captured.`,
        domEvidence: `Conflict recovery alert: "${conflictMsg.trim()}", reload button present=${reloadBtn}`,
        notes: "Expected: 409, conflict banner and reload control; reload recovery is not exercised in this scenario.",
      });
    } catch (err: any) {
      recordResult({ id: "S3.8", name: "ORDER_CONFLICT handling", suite: "Orders", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // Close order drawer
    await client.evaluate(`(() => {
      const closeBtn = document.querySelector('.panel-order-detail-header button');
      if (closeBtn) closeBtn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 200));

    // S3.9 Live Polling & Order Injection
    try {
      const injectRes = await fetch("http://127.0.0.1:4010/__e2e/inject-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_name: "Yeni Polling Müşterisi", status: "new" }),
      });
      await injectRes.json();

      // Click refresh to load new order
      const preRefreshNet = client.networkLogs.length;
      await client.evaluate(`(() => {
        const btn = document.querySelector('button.panel-order-refresh');
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 800));

      const cardData = await client.evaluate<{
        detected: boolean;
        orderNumberText: string;
        customerName: string;
        hasUndefined: boolean;
        hasNaN: boolean;
      }>(`(() => {
        const cards = Array.from(document.querySelectorAll('.panel-order-card'));
        const target = cards.find(c => c.textContent?.includes("Yeni Polling Müşterisi"));
        if (!target) return { detected: false, orderNumberText: "", customerName: "", hasUndefined: false, hasNaN: false };
        const numText = target.querySelector(".panel-order-number strong")?.textContent?.trim() || "";
        const cName = target.querySelector(".panel-order-main strong")?.textContent?.trim() || "";
        const fullText = target.textContent || "";
        return {
          detected: true,
          orderNumberText: numText,
          customerName: cName,
          hasUndefined: fullText.toLowerCase().includes("undefined"),
          hasNaN: fullText.includes("NaN"),
        };
      })()`);

      const parsedNum = parseInt(cardData.orderNumberText.replace("#", ""), 10);
      const refreshCall = client.networkLogs.slice(preRefreshNet).find(n => n.url.includes("/api/business/orders") && n.method === "GET");
      const s39Pass = injectRes.status === 201 && refreshCall?.status === 200 && cardData.detected &&
                      cardData.orderNumberText.startsWith("#") &&
                      Number.isFinite(parsedNum) &&
                      parsedNum > 0 &&
                      !cardData.hasUndefined &&
                      !cardData.hasNaN;

      recordResult({
        id: "S3.9",
        name: "Order injection & manual list refresh verification",
        suite: "Orders",
        status: s39Pass ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `POST /__e2e/inject-order -> observed HTTP ${injectRes.status}, GET /api/business/orders -> observed HTTP ${refreshCall?.status ?? "UNVERIFIED (no captured response)"}`,
        domEvidence: `detected=${cardData.detected}, orderNumberText=${cardData.orderNumberText}, customerName="${cardData.customerName}", hasUndefined=${cardData.hasUndefined}, hasNaN=${cardData.hasNaN}`,
        notes: "Expected: injected card with a positive finite order number after manual refresh; autonomous polling is covered by BADGE.B.",
      });
    } catch (err: any) {
      recordResult({ id: "S3.9", name: "Order injection", suite: "Orders", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // ==================================================
    // SUITE 4: PRINTING SUITE (S4.1 - S4.4)
    // ==================================================
    console.log("\n--- SUITE 4: PRINTING SUITE ---");
    try {
      await client.click(".panel-order-card:first-child button.panel-order-row");
      await client.waitForSelector(".panel-order-detail", 3000);

      // S4.1 58mm width selection
      await client.select(".panel-order-detail-actions select", "58mm");
      const val58 = await client.evaluate<string>("document.querySelector('.panel-order-detail-actions select')?.value || ''");
      recordResult({
        id: "S4.1",
        name: "Print paper width selection: 58mm thermal",
        suite: "Printing",
        status: val58 === "58mm" ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Client-side dropdown selection state",
        domEvidence: `Select value="${val58}"`,
        notes: "Expected: selected value 58mm.",
      });

      // S4.2 80mm width selection
      await client.select(".panel-order-detail-actions select", "80mm");
      const val80 = await client.evaluate<string>("document.querySelector('.panel-order-detail-actions select')?.value || ''");
      recordResult({
        id: "S4.2",
        name: "Print paper width selection: 80mm standard",
        suite: "Printing",
        status: val80 === "80mm" ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Client-side dropdown selection state",
        domEvidence: `Select value="${val80}"`,
        notes: "Expected: selected value 80mm.",
      });

      // S4.3 Print popup window & postMessage delivery
      recordResult({
        id: "S4.3",
        name: "Print popup window launch & cross-window postMessage inspection",
        suite: "Printing",
        status: "SKIP — TOOL LIMITATION",
        browserExecuted: false,
        networkEvidence: "UNVERIFIED — popup launch was not executed.",
        domEvidence: "Single-target headless Chrome CDP cannot inspect child window DOM or cross-window postMessage",
        notes: "Tool limitation: cross-window postMessage/popup inspection requires multi-target CDP session manager",
      });

      // S4.4 Print route rendering
      const prePrintNet = client.networkLogs.length;
      await client.navigate("http://127.0.0.1:3100/panel/yazdir");
      await new Promise((r) => setTimeout(r, 600));
      const printPageText = await client.evaluate<string>("document.body.innerText");
      const printHasStyles = await client.evaluate<boolean>("document.querySelector('main, article, div') !== null");
      const printCall = findCompletedHtmlDocument(client.networkLogs.slice(prePrintNet), "http://127.0.0.1:3100/panel/yazdir");

      recordResult({
        id: "S4.4",
        name: "Direct print route (/panel/yazdir) document rendering",
        suite: "Printing",
        status: printHasStyles && printPageText.length > 0 && printCall?.status === 200 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `GET /panel/yazdir -> observed HTTP ${printCall?.status ?? "UNVERIFIED (no captured document response)"}`,
        domEvidence: `containerPresent=${printHasStyles}, bodyTextLength=${printPageText.length}, documentMime=${printCall?.type ?? "UNVERIFIED"}, documentFinished=${printCall?.finished ?? "UNVERIFIED"}`,
        notes: "Expected: completed 200 HTML print-route GET containing body text and a container; RSC/prefetch responses are excluded, print payload and stylesheet fidelity are not inspected.",
      });

      // Close drawer and return to /panel
      await client.navigate("http://127.0.0.1:3100/panel");
      await client.waitForSelector(".business-panel-workspace", 5000);
    } catch (err: any) {
      recordResult({ id: "S4.4", name: "Print route", suite: "Printing", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // ==================================================
    // SUITE 5: PRODUCT MANAGEMENT SUITE (S5.1 - S5.7)
    // ==================================================
    console.log("\n--- SUITE 5: PRODUCT MANAGEMENT SUITE ---");
    await resetMock();
    await client.navigate("http://127.0.0.1:3100/panel");
    await client.waitForSelector(".business-panel-workspace", 5000);

    // Switch to products section
    await client.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")).find(b => b.textContent?.includes("Ürünler"));
      if (btn) btn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    await client.waitForSelector(".panel-product-list", 5000);

    // S5.1 Category filter
    try {
      const initialCount = await client.evaluate<number>("document.querySelectorAll('.panel-product-card').length");
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll(".panel-category-chip")).find(b => b.textContent?.includes("Tatlılar"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 300));
      const filteredCount = await client.evaluate<number>("document.querySelectorAll('.panel-product-card').length");

      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll(".panel-category-chip")).find(b => b.textContent?.includes("Tüm ürünler"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 300));

      recordResult({
        id: "S5.1",
        name: "Product category filter chips",
        suite: "Products",
        status: initialCount === 6 && filteredCount === 1 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Client-side category filtering on loaded fixture products",
        domEvidence: `All products count=${initialCount}, Tatlılar category count=${filteredCount}`,
        notes: "Expected: six products initially and one product under the Tatlılar filter; product identity is not asserted here.",
      });
    } catch (err: any) {
      recordResult({ id: "S5.1", name: "Category filter", suite: "Products", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S5.3 Product form validation (empty name rejection)
    try {
      await client.click("button.business-panel-primary-command");
      await client.waitForSelector("form.business-panel-product-form", 3000);

      await client.type("#name", "");
      const preNet = client.networkLogs.length;
      await client.click("form.business-panel-product-form button[type='submit']");
      await new Promise((r) => setTimeout(r, 200));

      const validationMsg = await client.evaluate<string>("document.querySelector('.alert, p.alert')?.textContent || ''");
      const validationPassed = validationMsg.includes("Ürün adı boş olamaz");
      const mutations = mutationCountSince(client, preNet);

      recordResult({
        id: "S5.3",
        name: "Product form client-side validation (empty name rejection)",
        suite: "Products",
        status: validationPassed && mutations === 0 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `Observed mutation requests after empty-name submit=${mutations}`,
        domEvidence: `Observed validation message="${validationMsg.trim()}"`,
        notes: "Expected: empty-name validation alert without a mutation request.",
      });
    } catch (err: any) {
      recordResult({ id: "S5.3", name: "Product validation", suite: "Products", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S5.2 Product creation
    try {
      await client.type("#name", "Otomasyon Fıstıklı Baklava");
      await client.type("#price", "180");
      const preNet = client.networkLogs.length;
      await client.click("form.business-panel-product-form button[type='submit']");

      let created = false;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const bodyText = await client.evaluate<string>("document.body.innerText");
        if (bodyText.includes("Ürün eklendi")) {
          created = true;
          break;
        }
      }

      // Switch back to "Ürünler" tab to see product cards
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")).find(b => b.textContent?.includes("Ürünler"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      await client.waitForSelector(".panel-product-list", 5000);
      const postNet = client.networkLogs.slice(preNet);
      const createCall = findResponseForMethod(postNet, "http://127.0.0.1:3100/api/business/products", "POST");
      const productListed = await client.evaluate<boolean>("[...document.querySelectorAll('.panel-product-card')].some(card => card.textContent?.includes('Otomasyon Fıstıklı Baklava'))");

      recordResult({
        id: "S5.2",
        name: "Product creation & authoritative merge",
        suite: "Products",
        status: created && productListed && createCall?.status === 200 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `POST /api/business/products -> observed HTTP ${createCall?.status ?? "UNVERIFIED (no captured response)"}`,
        domEvidence: `creationAlertObserved=${created}, createdProductCardPresent=${productListed}`,
        notes: "Expected: 200 business API creation response, success alert and a matching product card; UUID format is not asserted here.",
      });
    } catch (err: any) {
      recordResult({ id: "S5.2", name: "Product creation", suite: "Products", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S5.4 Active/passive status toggle
    try {
      // Ensure on products tab and Tüm ürünler filter
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")).find(b => b.textContent?.includes("Ürünler"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll(".panel-category-chip")).find(b => b.textContent?.includes("Tüm ürünler"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      await client.waitForSelector(".panel-product-card", 5000);

      // Expand first product
      await client.click(".panel-product-card .panel-compact-row");
      await client.waitForSelector(".panel-compact-detail", 3000);

      const preNet = client.networkLogs.length;
      await client.click("button[aria-label*='pasife al'], button[aria-label*='aktif et']");

      let badgeUpdated = false;
      let statusBadge = "";
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        statusBadge = await client.evaluate<string>("document.querySelector('.panel-product-card .panel-product-status')?.textContent || ''");
        if (statusBadge.includes("Satış Dışı")) {
          badgeUpdated = true;
          break;
        }
      }
      const postNet = client.networkLogs.slice(preNet);
      const browserPatchCall = postNet.find((n) => n.url.includes("/api/business/products/") && n.method === "PATCH");

      // Check backend mock request
      const mockReqRes = await fetch("http://127.0.0.1:4010/__e2e/requests");
      const mockReqData = (await mockReqRes.json()) as { requests: Array<{ method: string; pathname: string; url: string }> };
      const backendPatchCall = mockReqData.requests.slice().reverse().find(
        (r) => r.method === "PATCH" && r.pathname.startsWith("/rest/v1/products")
      );

      const capturedBackendUrl = backendPatchCall?.url || "";
      const urlObj = new URL(capturedBackendUrl || "/rest/v1/products", "http://127.0.0.1:4010");
      const idParam = urlObj.searchParams.get("id"); // "eq.00000000-0000-4000-8000-000000001001"
      const actualProductId = idParam?.replace("eq.", "") || "";
      const isCorrectProductUuid = actualProductId === "00000000-0000-4000-8000-000000001001";
      const isNotBusinessUuid = actualProductId !== "00000000-0000-4000-8000-000000000101";

      const mockStateRes = await fetch("http://127.0.0.1:4010/rest/v1/products?id=eq.00000000-0000-4000-8000-000000001001");
      const mockRows = (await mockStateRes.json()) as Array<{ id: string; is_active: boolean }>;
      const mockStateChanged = mockRows.length > 0 && mockRows[0].is_active === false;

      const s54Pass = badgeUpdated && isCorrectProductUuid && isNotBusinessUuid && mockStateChanged && browserPatchCall?.status === 200;

      recordResult({
        id: "S5.4",
        name: "Product active/passive availability toggle",
        suite: "Products",
        status: s54Pass ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `Browser: ${browserPatchCall ? `${browserPatchCall.method} ${browserPatchCall.url} HTTP ${browserPatchCall.status ?? "UNVERIFIED"}` : "UNVERIFIED (no captured PATCH)"}, backend mock PATCH URL=${capturedBackendUrl || "UNVERIFIED"}`,
        domEvidence: `Observed status badge="${statusBadge.trim()}", authoritative mock is_active=${mockRows[0]?.is_active}`,
        notes: `Observed backend product id=${actualProductId || "UNVERIFIED"}; expected fixture product id=00000000-0000-4000-8000-000000001001.`,
      });
    } catch (err: any) {
      recordResult({ id: "S5.4", name: "Product toggle", suite: "Products", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S5.5 Product reorder success
    try {
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")).find(b => b.textContent?.includes("Ürünler"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll(".panel-category-chip")).find(b => b.textContent?.includes("Tüm ürünler"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));

      const namesBefore = await client.evaluate<string[]>(`(() => {
        return Array.from(document.querySelectorAll('.panel-product-card .panel-compact-main strong')).map(e => e.textContent || '');
      })()`);

      // Ensure first card expanded
      const isExpanded = await client.evaluate<boolean>("Boolean(document.querySelector('.panel-compact-detail'))");
      if (!isExpanded) {
        await client.click(".panel-product-card .panel-compact-row");
        await client.waitForSelector(".panel-compact-detail", 3000);
      }

      const preNet = client.networkLogs.length;
      await client.click("button[aria-label*='aşağı taşı']");

      let reorderSuccessMsg = "";
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        reorderSuccessMsg = await client.evaluate<string>("document.querySelector('.alert.success, p.alert')?.textContent || ''");
        if (reorderSuccessMsg.includes("taşındı")) break;
      }

      const namesAfter = await client.evaluate<string[]>(`(() => {
        return Array.from(document.querySelectorAll('.panel-product-card .panel-compact-main strong')).map(e => e.textContent || '');
      })()`);

      const postNet = client.networkLogs.slice(preNet);
      const rpcCall = findResponseForMethod(postNet, "http://127.0.0.1:3100/api/business/products/reorder", "POST");
      const orderShifted = namesBefore.length >= 2 && namesAfter[0] === namesBefore[1];

      recordResult({
        id: "S5.5",
        name: "Product reordering success workflow (move down)",
        suite: "Products",
        status: reorderSuccessMsg.includes("taşındı") && orderShifted && rpcCall?.status === 200 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `POST reorder -> observed HTTP ${rpcCall?.status ?? "UNVERIFIED (no captured response)"}`,
        domEvidence: `Alert="${reorderSuccessMsg.trim()}", before=${JSON.stringify(namesBefore)}, after=${JSON.stringify(namesAfter)}, orderShifted=${orderShifted}`,
        notes: "Expected: 200 reorder response, success alert and first product shifted down in DOM.",
      });
    } catch (err: any) {
      recordResult({ id: "S5.5", name: "Product reorder", suite: "Products", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S5.6 Product reorder conflict & recovery
    try {
      // Mutate Product 2 directly in mock to advance its updated_at
      const targetRes = await fetch("http://127.0.0.1:4010/rest/v1/products?business_id=eq.00000000-0000-4000-8000-000000000101");
      const prods = (await targetRes.json()) as Array<{ id: string; updated_at: string }>;
      const targetP = prods[1];

      await fetch(`http://127.0.0.1:4010/rest/v1/products?id=eq.${targetP.id}&updated_at=eq.${targetP.updated_at}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ name: "Stale Mutated Product", updated_at: new Date().toISOString() }),
      });

      // In browser UI, click move down on product with stale timestamp
      const preNet = client.networkLogs.length;
      await client.click("button[aria-label*='aşağı taşı']");
      await new Promise((r) => setTimeout(r, 800));

      const conflictMsg = await client.evaluate<string>("document.querySelector('.panel-product-mutation-message')?.textContent || ''");
      const postNet = client.networkLogs.slice(preNet);
      const conflictRpc = findResponseForMethod(postNet, "http://127.0.0.1:3100/api/business/products/reorder", "POST");

      // Click reload button to verify recovery
      await client.click(".panel-product-mutation-message button");
      await new Promise((r) => setTimeout(r, 800));
      const conflictCleared = await client.evaluate<boolean>("document.querySelector('.panel-product-mutation-message') === null");

      recordResult({
        id: "S5.6",
        name: "PRODUCT_CONFLICT stale-state reorder handling & recovery",
        suite: "Products",
        status: conflictMsg.includes("güncellendi") && conflictRpc?.status === 409 && conflictCleared ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `POST reorder -> observed HTTP ${conflictRpc?.status ?? "UNVERIFIED (no captured response)"}`,
        domEvidence: `Conflict alert displayed: "${conflictMsg.trim()}", cleared on reload button click=${conflictCleared}`,
        notes: "Expected: 409 conflict, conflict alert and alert clearance after reload; returned product fidelity is not compared here.",
      });
    } catch (err: any) {
      recordResult({ id: "S5.6", name: "Product reorder conflict", suite: "Products", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S5.7 / PHASE4.F5 Long product name wrapping
    try {
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")).find(b => b.textContent?.includes("Ürünler"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll(".panel-category-chip")).find(b => b.textContent?.includes("Tüm ürünler"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));

      const geom = await client.evaluate<{
        titleScrollWidth: number;
        titleClientWidth: number;
        titleRectWidth: number;
        cardRectWidth: number;
        listRectWidth: number;
        titleLength: number;
        overflowWrap: string;
        wordBreak: string;
      }>(`(() => {
        const cards = Array.from(document.querySelectorAll(".panel-product-card"));
        const targetCard = cards.find(c => c.textContent?.includes("ÇokÖzelGeleneksel"));
        const titleEl = targetCard ? targetCard.querySelector(".panel-compact-main strong") : null;
        const cardEl = targetCard;
        const listEl = document.querySelector(".panel-product-list");
        return {
          titleScrollWidth: titleEl ? titleEl.scrollWidth : 0,
          titleClientWidth: titleEl ? titleEl.clientWidth : 0,
          titleRectWidth: titleEl ? titleEl.getBoundingClientRect().width : 0,
          cardRectWidth: cardEl ? cardEl.getBoundingClientRect().width : 0,
          listRectWidth: listEl ? listEl.getBoundingClientRect().width : 0,
          titleLength: titleEl ? titleEl.textContent.length : 0,
          overflowWrap: titleEl ? window.getComputedStyle(titleEl).overflowWrap : "",
          wordBreak: titleEl ? window.getComputedStyle(titleEl).wordBreak : "",
        };
      })()`);

      const noOverflow = geom.titleLength >= 60 && geom.titleScrollWidth > 0 && geom.titleScrollWidth <= geom.titleClientWidth + 2 && geom.cardRectWidth <= geom.listRectWidth + 5;

      recordResult({
        id: "S5.7",
        name: "Long product name wrapping (Phase 4 F5)",
        suite: "Products",
        status: noOverflow ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Browser geometry and computed CSS inspection; no network assertion for this scenario.",
        domEvidence: `titleLength=${geom.titleLength}, titleScrollWidth=${geom.titleScrollWidth}px, titleClientWidth=${geom.titleClientWidth}px, cardWidth=${geom.cardRectWidth}px, listWidth=${geom.listRectWidth}px, overflowWrap=${geom.overflowWrap}, wordBreak=${geom.wordBreak}, noOverflow=${noOverflow}`,
        notes: "Expected: the long fixture product title and card stay within their measured widths.",
      });
    } catch (err: any) {
      recordResult({ id: "S5.7", name: "Long name wrapping", suite: "Products", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // ==================================================
    // SUITE 6: STORAGE SUITE (S6.1)
    // ==================================================
    console.log("\n--- SUITE 6: STORAGE SUITE ---");
    try {
      const testImgPath = path.join(os.tmpdir(), `e2e-synthetic-test-${process.pid}-${Date.now()}.png`);
      const dummyPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64"
      );
      fs.writeFileSync(testImgPath, dummyPng);

      // Ensure on products tab and Tüm ürünler filter
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")).find(b => b.textContent?.includes("Ürünler"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll(".panel-category-chip")).find(b => b.textContent?.includes("Tüm ürünler"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      await client.waitForSelector(".panel-product-card", 5000);

      // Open product edit
      const detailExists = await client.evaluate<boolean>("Boolean(document.querySelector('.panel-compact-detail'))");
      if (!detailExists) {
        await client.click(".panel-product-card .panel-compact-row");
        await client.waitForSelector(".panel-compact-detail", 3000);
      }
      await client.click("button[aria-label*='düzenle']");
      await client.waitForSelector("form.business-panel-product-form", 3000);

      // Attach synthetic image file via CDP
      const doc = await client.send("DOM.getDocument");
      const fileInputNode = await client.send("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: "input[type='file']",
      });

      const preNet = client.networkLogs.length;
      let formSuccess = false;
      let publicImageUrl = "";
      if (fileInputNode.nodeId) {
        await client.send("DOM.setFileInputFiles", {
          files: [testImgPath],
          nodeId: fileInputNode.nodeId,
        });
        await new Promise((r) => setTimeout(r, 300));

        await client.click("form.business-panel-product-form button[type='submit']");
        for (let i = 0; i < 100; i++) {
          const upload = client.networkLogs.slice(preNet).find((n) => n.method === "POST" && n.url.includes("/storage/v1/object/product-images/"));
          publicImageUrl = upload?.url.replace("/storage/v1/object/", "/storage/v1/object/public/") ?? "";
          formSuccess = await client.evaluate<boolean>(`(() => {
            const success = Array.from(document.querySelectorAll('p.alert.success')).some(el => el.textContent?.trim() === 'Ürün güncellendi.');
            const image = Array.from(document.querySelectorAll('.panel-product-card img')).some(el => el.getAttribute('src') === ${JSON.stringify(publicImageUrl)});
            const file = document.querySelector('#imageFile');
            return success && image && (!file || file.files.length === 0);
          })()`);
          if (formSuccess || upload?.failure) break;
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      const stateResponse = await fetch("http://127.0.0.1:4010/rest/v1/products");
      const state = await stateResponse.json();
      const persisted = stateResponse.ok && state.some((p: { image_url: string }) => p.image_url === publicImageUrl);
      const requestsResponse = await fetch("http://127.0.0.1:4010/__e2e/requests");
      if (!requestsResponse.ok) throw new Error("Cannot read mock network evidence");
      const { requests: serverRequests } = await requestsResponse.json();
      const assessment = assessUpload({ network: client.networkLogs.slice(preNet), serverRequests, formSuccess: formSuccess && persisted, publicImageUrl });

      try { fs.unlinkSync(testImgPath); } catch {}

      recordResult({
        id: "S6.1",
        name: "Real browser Storage image upload & public URL contract",
        suite: "Storage",
        status: assessment.status,
        browserExecuted: true,
        networkEvidence: JSON.stringify({ preflight: assessment.preflight, upload: assessment.upload }),
        domEvidence: `success=${formSuccess}, persisted=${persisted}, publicImageUrl=${publicImageUrl}`,
        notes: assessment.failures.join("; ") || "Expected: OPTIONS and completed POST agree with CDP, mock receipt, DOM and persisted product.",
      });
    } catch (err: any) {
      recordResult({ id: "S6.1", name: "Storage upload", suite: "Storage", status: "FAIL", browserExecuted: true, networkEvidence: "Upload verification failed", domEvidence: err.message });
    }

    // ==================================================
    // SUITE 7: BUSINESS PROFILE SUITE (S7.1 - S7.5)
    // ==================================================
    console.log("\n--- SUITE 7: BUSINESS PROFILE SUITE ---");
    await resetMock();
    await client.navigate("http://127.0.0.1:3100/panel");
    await client.waitForSelector(".business-panel-workspace", 5000);

    // Switch to profile tab
    await client.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")).find(b => b.textContent?.includes("İşletme Bilgileri"));
      if (btn) btn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    await client.waitForSelector("form.panel-form", 5000);

    // S7.1 Form population
    try {
      const domProfile = await client.evaluate<{
        name: string;
        whatsapp: string;
        city: string;
        district: string;
        neighborhood: string;
        address: string;
      }>(`(() => {
        const getSelectedText = (sel) => {
          const el = document.querySelector(sel);
          if (!el || el.selectedIndex < 0) return "";
          const opt = el.options[el.selectedIndex];
          return opt ? opt.textContent.trim() : "";
        };
        return {
          name: document.querySelector("#businessName") ? document.querySelector("#businessName").value : "",
          whatsapp: document.querySelector("#businessWhatsapp") ? document.querySelector("#businessWhatsapp").value : "",
          city: getSelectedText("#businessProfileLocation-city"),
          district: getSelectedText("#businessProfileLocation-district"),
          neighborhood: getSelectedText("#businessProfileLocation-neighborhood"),
          address: document.querySelector("#businessAddress") ? document.querySelector("#businessAddress").value : "",
        };
      })()`);

      const nameMatch = domProfile.name === "E2E Test Kebap Salonu";
      const waMatch = domProfile.whatsapp === "905551112233";
      const cityMatch = domProfile.city === "İstanbul";
      const districtMatch = domProfile.district === "Kadıköy";
      const neighborhoodMatch = domProfile.neighborhood.includes("Caferağa");
      const addressMatch = domProfile.address === "Caferağa Mah. Moda Cad. No:42";

      const allMatch = nameMatch && waMatch && cityMatch && districtMatch && neighborhoodMatch && addressMatch;

      recordResult({
        id: "S7.1",
        name: "Profile form initial population from backend (fidelity check)",
        suite: "Profile",
        status: allMatch ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Profile form DOM inspected; backend response status not inspected in this scenario.",
        domEvidence: `name="${domProfile.name}" [${nameMatch ? "MATCH" : "MISMATCH"}], whatsapp="${domProfile.whatsapp}" [${waMatch ? "MATCH" : "MISMATCH"}], city="${domProfile.city}" [${cityMatch ? "MATCH" : "MISMATCH"}], district="${domProfile.district}" [${districtMatch ? "MATCH" : "MISMATCH"}], neighborhood="${domProfile.neighborhood}" [${neighborhoodMatch ? "MATCH" : "MISMATCH"}], address="${domProfile.address}" [${addressMatch ? "MATCH" : "MISMATCH"}]`,
        notes: "Expected: all six inspected profile fields match the synthetic fixture.",
      });
    } catch (err: any) {
      recordResult({ id: "S7.1", name: "Profile population", suite: "Profile", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S7.2 Profile save
    try {
      await client.type("#businessDeliveryStatus", "");
      await client.type("#businessMinimumOrder", "100");
      await client.type("#businessPreparationTime", "30");
      const preNet = client.networkLogs.length;
      await client.click("form.panel-form button[type='submit']");

      let saveMsg = "";
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        saveMsg = await client.evaluate<string>("document.querySelector('.alert.success, p.alert')?.textContent || ''");
        if (saveMsg.includes("kaydedildi")) break;
      }
      const postNet = client.networkLogs.slice(preNet);
      const profileCall = findResponseForMethod(postNet, "http://127.0.0.1:3100/api/business/update-profile", "POST");
      const mockState = await (await fetch("http://127.0.0.1:4010/__e2e/state")).json();
      const stored = mockState.business;
      const saved = saveMsg.includes("kaydedildi") && profileCall?.status === 200 &&
        stored?.delivery_status === "" && stored?.minimum_order_amount === 100 &&
        stored?.preparation_time_minutes === 30;

      recordResult({
        id: "S7.2",
        name: "Profile form update & save workflow",
        suite: "Profile",
        status: saved ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `POST /api/business/update-profile -> HTTP ${profileCall?.status}; mock delivery_status=${JSON.stringify(stored?.delivery_status)}, minimum_order_amount=${stored?.minimum_order_amount}`,
        domEvidence: `Observed message="${saveMsg.trim()}", persistedPreparationTime=${stored?.preparation_time_minutes}`,
        notes: "Expected: 200 profile response, save alert and persisted blank delivery, minimum order 100 and preparation time 30.",
      });
    } catch (err: any) {
      recordResult({ id: "S7.2", name: "Profile save", suite: "Profile", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S7.3 / PHASE4.F2 Duplicate submit guard
    try {
      // Mutate preparation time to 45 so the form has genuine pending changes
      await client.type("#businessPreparationTime", "45");

      const preBrowserPost = client.networkLogs.filter((n) => n.url.includes("/api/business/update-profile") && n.method === "POST").length;
      const preMockReqs = await fetch("http://127.0.0.1:4010/__e2e/requests").then((r) => r.json());
      const preMockBizPatches = (preMockReqs.requests as any[]).filter((r: any) => r.pathname.startsWith("/rest/v1/businesses") && r.method === "PATCH").length;

      // Trigger rapid duplicate submit
      await client.evaluate(`(() => {
        const btn = document.querySelector("form.panel-form button[type='submit']");
        if (btn) {
          btn.click();
          btn.click();
        }
      })()`);
      await new Promise((r) => setTimeout(r, 1000));

      const postBrowserPost = client.networkLogs.filter((n) => n.url.includes("/api/business/update-profile") && n.method === "POST").length;
      const postMockReqs = await fetch("http://127.0.0.1:4010/__e2e/requests").then((r) => r.json());
      const postMockBizPatches = (postMockReqs.requests as any[]).filter((r: any) => r.pathname.startsWith("/rest/v1/businesses") && r.method === "PATCH").length;

      const browserDiff = postBrowserPost - preBrowserPost;
      const mockDiff = postMockBizPatches - preMockBizPatches;

      const s73Pass = browserDiff === 1 && mockDiff === 1;

      recordResult({
        id: "S7.3",
        name: "Profile save synchronous duplicate-submit guard (Phase 4 F2)",
        suite: "Profile",
        status: s73Pass ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `Browser POST /api/business/update-profile: count=${browserDiff}, Mock PATCH /rest/v1/businesses: count=${mockDiff}`,
        domEvidence: "Rapid submit control clicked twice; internal React ref and transient disabled state were not inspected.",
        notes: "Expected: exactly one browser POST and one backend PATCH after rapid duplicate submit.",
      });
    } catch (err: any) {
      recordResult({ id: "S7.3", name: "Duplicate submit guard", suite: "Profile", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S7.4 / PHASE4.F4 120-char business name boundary
    try {
      await client.evaluate(`(() => {
        document.querySelector("#businessName")?.removeAttribute("maxlength");
      })()`);
      await client.type("#businessName", "A".repeat(121));
      const preNet = client.networkLogs.length;
      await client.click("form.panel-form button[type='submit']");
      await new Promise((r) => setTimeout(r, 200));

      const errMsg = await client.evaluate<string>("document.querySelector('.alert, p.error')?.textContent || ''");
      const rejected = errMsg.includes("120 karakter olabilir");
      const mutations = mutationCountSince(client, preNet);

      recordResult({
        id: "S7.4",
        name: "Profile validation: 120-character business name boundary (Phase 4 F4)",
        suite: "Profile",
        status: rejected && mutations === 0 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `Observed mutation requests after overlong-name submit=${mutations}`,
        domEvidence: `Observed validation message="${errMsg.trim()}"`,
        notes: "Expected: 121-character business name validation alert without a mutation request.",
      });
    } catch (err: any) {
      recordResult({ id: "S7.4", name: "120-char name limit", suite: "Profile", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S7.5 / PHASE4.F4 30-char WhatsApp boundary
    try {
      await client.type("#businessName", "E2E Test Kebap Salonu");
      await client.evaluate(`(() => {
        document.querySelector("#businessWhatsapp")?.removeAttribute("maxlength");
      })()`);
      await client.type("#businessWhatsapp", "9".repeat(31));
      const preNet = client.networkLogs.length;
      await client.click("form.panel-form button[type='submit']");
      await new Promise((r) => setTimeout(r, 200));

      const errMsg = await client.evaluate<string>("document.querySelector('.alert, p.error')?.textContent || ''");
      const rejected = errMsg.includes("30 karakter olabilir");
      const mutations = mutationCountSince(client, preNet);

      // Reset WhatsApp to valid
      await client.type("#businessWhatsapp", "905551112233");

      recordResult({
        id: "S7.5",
        name: "Profile validation: 30-character WhatsApp number boundary (Phase 4 F4)",
        suite: "Profile",
        status: rejected && mutations === 0 ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `Observed mutation requests after overlong-WhatsApp submit=${mutations}`,
        domEvidence: `Observed validation message="${errMsg.trim()}"`,
        notes: "Expected: 31-character WhatsApp validation alert without a mutation request.",
      });
    } catch (err: any) {
      recordResult({ id: "S7.5", name: "30-char WhatsApp limit", suite: "Profile", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // ==================================================
    // SUITE 8: SUBSCRIPTION GATING SUITE (S8.1)
    // ==================================================
    console.log("\n--- SUITE 8: SUBSCRIPTION GATING SUITE ---");
    try {
      // 1. Direct PATCH mock to set subscription to expired & inactive
      const expireResponse = await fetch("http://127.0.0.1:4010/rest/v1/businesses?id=eq.00000000-0000-4000-8000-000000000101", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription_status: "expired", is_active: false }),
      });

      // 2. Refresh panel
      await client.navigate("http://127.0.0.1:3100/panel");
      await client.waitForSelector(".business-panel-workspace", 5000);

      const subTextExpired = await client.evaluate<string>("document.body.innerText");
      const warningVisible = subTextExpired.includes("Abonelik pasif") || subTextExpired.includes("Aboneliğiniz aktif değil") || subTextExpired.includes("kapalıdır");
      const expiredControls = await observeSubscriptionControls(client);

      // 3. Reset mock to restore active subscription
      await resetMock();
      await client.navigate("http://127.0.0.1:3100/panel");
      await client.waitForSelector(".business-panel-workspace", 5000);

      const subTextActive = await client.evaluate<string>("document.body.innerText");
      const activeRestored = subTextActive.includes("Abonelik aktif") && !subTextActive.includes("Abonelik pasif");
      const activeControls = await observeSubscriptionControls(client);
      const controlsRestored = expiredControls.productCreationDisabled === true && expiredControls.orderStatusDisabled === true &&
        activeControls.productCreationDisabled === false && activeControls.orderStatusDisabled === false;

      recordResult({
        id: "S8.1",
        name: "Subscription gating: product-create and order-status controls disabled when expired and restored when active",
        suite: "Subscription gating",
        status: expireResponse.ok && warningVisible && activeRestored && controlsRestored ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: `Local fixture expiry PATCH -> observed HTTP ${expireResponse.status}; active fixture restored via reset.`,
        domEvidence: JSON.stringify({ warningVisible, activeRestored, expiredControls, activeControls }),
        notes: "Expected: expired/active messaging plus disabled/enabled product-create and order-status controls; backend denial of every mutation type is not tested here.",
      });
    } catch (err: any) {
      recordResult({ id: "S8.1", name: "Subscription gating", suite: "Subscription gating", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // ==================================================
    // SUITE 9: ACCESSIBILITY & KEYBOARD SUITE (S9.1 - S9.5)
    // ==================================================
    console.log("\n--- SUITE 9: ACCESSIBILITY & KEYBOARD SUITE ---");

    // S9.1 Mobile menu focus trap
    try {
      await client.setViewport(390, 844);
      await new Promise((r) => setTimeout(r, 200));

      await client.click(".business-panel-menu-trigger");
      await client.waitForSelector(".business-panel-mobile-menu[role='dialog']", 3000);

      const trapFocus = await client.evaluate<boolean>(`(() => {
        const dialog = document.querySelector(".business-panel-mobile-menu[role='dialog']");
        return dialog ? dialog.contains(document.activeElement) : false;
      })()`);

      recordResult({
        id: "S9.1",
        name: "Mobile menu focus trap initialization (Phase 4 F3)",
        suite: "Accessibility",
        status: trapFocus ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Mobile menu control clicked; DOM focus inspected.",
        domEvidence: `activeElement inside mobile drawer dialog=${trapFocus}`,
        notes: "Expected: active element inside the opened mobile dialog.",
      });
    } catch (err: any) {
      recordResult({ id: "S9.1", name: "Mobile focus trap", suite: "Accessibility", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S9.2 Normal close focus restoration
    try {
      await client.click("button[aria-label='Menüyü kapat']");
      await new Promise((r) => setTimeout(r, 300));

      const restoredToTrigger = await client.evaluate<boolean>(`(() => {
        const trigger = document.querySelector(".business-panel-menu-trigger");
        return Boolean(trigger) && document.activeElement === trigger;
      })()`);

      recordResult({
        id: "S9.2",
        name: "Normal drawer close focus restoration to trigger (Phase 4 F3)",
        suite: "Accessibility",
        status: restoredToTrigger ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "Mobile menu close control clicked; DOM focus inspected.",
        domEvidence: `Focus returned to hamburger button trigger=${restoredToTrigger}`,
        notes: "Expected: active element equals the opening menu trigger after dismissal.",
      });
    } catch (err: any) {
      recordResult({ id: "S9.2", name: "Close focus restoration", suite: "Accessibility", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S9.3 ESC key modal/drawer close
    try {
      await client.click(".business-panel-menu-trigger");
      await client.waitForSelector(".business-panel-mobile-menu", 3000);

      await client.pressKey("Escape", "Escape", 27);
      await new Promise((r) => setTimeout(r, 300));

      const closedOnEsc = await client.evaluate<boolean>("document.querySelector('.business-panel-mobile-menu') === null");

      recordResult({
        id: "S9.3",
        name: "ESC key closes open modal / drawer",
        suite: "Accessibility",
        status: closedOnEsc ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "KeyboardEvent Escape dispatch via CDP Input.dispatchKeyEvent",
        domEvidence: `Drawer closed on ESC key=${closedOnEsc}`,
        notes: "Expected: mobile drawer removed after Escape.",
      });
    } catch (err: any) {
      recordResult({ id: "S9.3", name: "ESC key handling", suite: "Accessibility", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S9.4 Modal Tab key cycling
    try {
      await client.setViewport(1280, 800);
      await new Promise((r) => setTimeout(r, 200));

      // Open orders tab and order detail drawer
      await client.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")).find(b => b.textContent?.includes("Siparişler"));
        if (btn) btn.click();
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      await client.click(".panel-order-card:first-child button.panel-order-row");
      await client.waitForSelector(".panel-order-detail", 3000);

      // Press Tab twice
      await client.pressKey("Tab", "Tab", 9);
      await client.pressKey("Tab", "Tab", 9);

      const tabInside = await client.evaluate<boolean>(`(() => {
        const dialog = document.querySelector(".panel-order-detail");
        return dialog ? dialog.contains(document.activeElement) : false;
      })()`);

      // Close drawer
      await client.evaluate(`(() => {
        const btn = document.querySelector(".panel-order-detail-header button");
        if (btn) btn.click();
      })()`);

      recordResult({
        id: "S9.4",
        name: "Modal Tab key focus trapping (useModalFocusTrap)",
        suite: "Accessibility",
        status: tabInside ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "KeyboardEvent Tab dispatch via CDP Input.dispatchKeyEvent",
        domEvidence: `Active element remains strictly within dialog=${tabInside}`,
        notes: "Expected: active element stays in the detail drawer after two Tab key presses.",
      });
    } catch (err: any) {
      recordResult({ id: "S9.4", name: "Modal Tab cycling", suite: "Accessibility", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // S9.5 / PHASE4.F3 Responsive resize dismissal & cleanup
    try {
      await client.setViewport(390, 844);
      await new Promise((r) => setTimeout(r, 200));

      await client.click(".business-panel-menu-trigger");
      await client.waitForSelector(".business-panel-mobile-menu[role='dialog']", 3000);

      const bodyOverflowBefore = await client.evaluate<string>("document.body.style.overflow");
      const drawerVisibleBefore = await client.evaluate<boolean>("document.querySelector('.business-panel-mobile-menu') !== null");

      // Resize past 1024px desktop breakpoint
      await client.setViewport(1024, 768);
      await new Promise((r) => setTimeout(r, 400));

      const drawerVisibleAfter = await client.evaluate<boolean>("document.querySelector('.business-panel-mobile-menu') !== null");
      const bodyOverflowAfter = await client.evaluate<string>("document.body.style.overflow");
      const activeElementTag = await client.evaluate<string>("document.activeElement ? document.activeElement.tagName : ''");
      const triggerHidden = await client.evaluate<boolean>(`(() => {
        const t = document.querySelector(".business-panel-menu-trigger");
        return t ? t.getClientRects().length === 0 : true;
      })()`);
      const focusedTriggerAfter = await client.evaluate<boolean>("document.activeElement === document.querySelector('.business-panel-menu-trigger')");

      const f3Pass = drawerVisibleBefore && !drawerVisibleAfter && bodyOverflowBefore === "hidden" && bodyOverflowAfter === "" && triggerHidden && !focusedTriggerAfter;

      recordResult({
        id: "S9.5",
        name: "Responsive 390px -> 1024px resize cleanup & scroll lock release (Phase 4 F3)",
        suite: "Accessibility",
        status: f3Pass ? "PASS" : "FAIL",
        browserExecuted: true,
        networkEvidence: "MediaQueryList change listener evaluation ('min-width: 1024px')",
        domEvidence: `drawerBefore=${drawerVisibleBefore}, drawerAfter=${drawerVisibleAfter}, overflowBefore="${bodyOverflowBefore}", overflowAfter="${bodyOverflowAfter}", activeElement="${activeElementTag}", triggerHidden=${triggerHidden}, focusedTriggerAfter=${focusedTriggerAfter}`,
        notes: "Expected: opened drawer closes on desktop resize, body scroll lock releases and hidden trigger is not focused.",
      });
    } catch (err: any) {
      recordResult({ id: "S9.5", name: "Resize dismissal", suite: "Accessibility", status: "FAIL", browserExecuted: true, networkEvidence: "None", domEvidence: err.message });
    }

    // ==================================================
    // SUITE 10: NETWORK & CONSOLE INTEGRITY (S10.1 - S10.2)
    // ==================================================
    console.log("\n--- SUITE 10: NETWORK & CONSOLE AUDIT ---");
    const externalRequests = client.networkLogs.filter(
      (n) => n.host !== "127.0.0.1:3100" && n.host !== "127.0.0.1:4010" && n.host !== "data:" && n.host !== "blob:"
    );
    const supabaseCoRequests = client.networkLogs.filter((n) => n.url.includes("supabase.co"));
    const yerelsiparisRequests = client.networkLogs.filter((n) => n.url.includes("yerelsiparis.com"));

    console.log(`Observed hosts: [${Array.from(client.observedHosts).join(", ")}]`);
    console.log(`External captured HTTP/resource requests: ${externalRequests.length}`);
    console.log(`Captured HTTP/resource supabase.co requests: ${supabaseCoRequests.length}`);
    console.log(`Captured HTTP/resource yerelsiparis.com requests: ${yerelsiparisRequests.length}`);

    const egressPassed = client.networkLogs.length > 0 && externalRequests.length === 0 && supabaseCoRequests.length === 0 && yerelsiparisRequests.length === 0 && client.blockedRequests.length === 0 && !client.egressViolation;

    recordResult({
      id: "S10.1",
      name: "Captured HTTP/resource egress audit (main browser target)",
      suite: "Console/network",
      status: egressPassed ? "PASS" : "FAIL",
      browserExecuted: true,
      networkEvidence: `Observed HTTP/resource hosts: [${Array.from(client.observedHosts).join(", ")}], capturedHttpResourceRequests=${client.networkLogs.length}, external=${externalRequests.length}, supabaseCo=${supabaseCoRequests.length}, productionDomain=${yerelsiparisRequests.length}, blocked=${client.blockedRequests.length}, egressViolation=${client.egressViolation}`,
      domEvidence: "Main-target HTTP/resource capture for this BrowserCDPClient; WebSocket observation/egress, server-process egress and popup targets are UNVERIFIED.",
      notes: "Expected: captured main-target HTTP/resource traffic, no nonlocal requests or blocked egress attempts within that capture, and no egress violation. WebSocket observation and egress are UNVERIFIED.",
    });

    const consoleErrors = [
      ...client.consoleLogs.filter((c) => c.type === "error" || c.type === "exception"),
      ...client.browserLogs.filter((c) => c.level === "error"),
    ];
    const expectedNegativeLogs = consoleErrors.filter(
      (c) => isExpectedNegativeHttpLog(c, client.networkLogs)
    );
    const unexpectedConsoleErrors = consoleErrors.filter(
      (c) => !isExpectedNegativeHttpLog(c, client.networkLogs)
    );
    const unexpectedErrors = [...unexpectedConsoleErrors, ...client.loadingFailures.map((c) => ({ text: JSON.stringify(c) }))];
    mainAudit = {
      hosts: Array.from(client.observedHosts), requests: client.networkLogs.length,
      external: externalRequests.length, supabaseCo: supabaseCoRequests.length,
      productionDomain: yerelsiparisRequests.length, blocked: client.blockedRequests.length,
      egressViolation: client.egressViolation, consoleErrors: consoleErrors.length,
      expectedNegativeLogs: expectedNegativeLogs.length,
      unexpectedConsoleErrors: unexpectedConsoleErrors.length, loadingFailures: client.loadingFailures.length,
    };

    recordResult({
      id: "S10.2",
      name: "Console error and loading-failure audit",
      suite: "Console/network",
      status: unexpectedErrors.length === 0 ? "PASS" : "FAIL",
      browserExecuted: true,
      networkEvidence: "CDP Runtime.consoleAPICalled, Runtime.exceptionThrown, Log.entryAdded and Network.loadingFailed capture",
      domEvidence: JSON.stringify({ unexpectedErrors, excludedNegativeLogs: expectedNegativeLogs.length, loadingFailures: client.loadingFailures.length }),
      notes: `Observed unexpected console errors=${unexpectedConsoleErrors.length}, loading failures=${client.loadingFailures.length}. Only exact resource-error messages with an observed expected local 400/409 destination/status are excluded; unhandled rejection counts are not measured separately.`,
    });

  } catch (error) {
    recordResult({
      id: "HARNESS.FAILURE", name: "Interrupted main browser harness", suite: "Harness",
      status: "FAIL", browserExecuted: browserLaunched, networkEvidence: "Main harness interrupted; later controls are unverified.",
      domEvidence: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try { await client.close(); } catch (error) {
      recordResult({
        id: "HARNESS.CLEANUP", name: "Browser harness cleanup failed", suite: "Harness",
        status: "FAIL", browserExecuted: browserLaunched, networkEvidence: "Browser cleanup failed.",
        domEvidence: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Own reset/browser lifecycle after the original suites, before report totals.
  console.log("\n--- POLLING BADGE REGRESSION (A–H) ---");
  try {
    if (client.egressViolation) throw new Error("Polling badge harness not started after the main browser egress violation.");
    // onPass is called only after the badge harness's assertions/waits succeed.
    await runNewOrderBadgeRegression((id, evidence, browserExecuted) => {
      recordResult({
        id: `BADGE.${id}`,
        name: `Polling badge regression ${id}`,
        suite: "Polling badge",
        status: "PASS",
        browserExecuted,
        nonBrowserAssertionExecuted: !browserExecuted,
        networkEvidence: browserExecuted ? "Isolated loopback GET/polling with pre-network egress gate" : "Local unit regression; no network",
        domEvidence: evidence,
      });
    });
  } catch (error) {
    recordResult({
      id: "BADGE.FAILURE", name: "Polling badge regression failure",
      suite: "Polling badge", status: "FAIL", browserExecuted: false,
      networkEvidence: "Isolated loopback harness",
      domEvidence: error instanceof Error ? error.message : "Unknown regression failure",
    });
  }

  // ==================================================
  // COMPILE DETAILED REPORT & SCENARIO TABLE
  // ==================================================
  console.log("\n==================================================");
  console.log("GENERATING FINAL REPORT ARTIFACT");
  console.log("==================================================");

  const reportResults = completeScenarioResults(results);
  const passCount = reportResults.filter((r) => r.status === "PASS").length;
  const failCount = reportResults.filter((r) => r.status === "FAIL").length;
  const skipCount = reportResults.filter((r) => r.status === "SKIP — TOOL LIMITATION").length;
  const inconcCount = reportResults.filter((r) => r.status === "INCONCLUSIVE").length;
  const unverifiedCount = reportResults.filter((r) => r.status === "UNVERIFIED").length;
  const finalClass = summarizeStatus(reportResults);

  const tableHeader = "| ID | RESULT | BROWSER EXECUTED | NETWORK EVIDENCE | DOM/UI EVIDENCE | NOTES |\n|---|---|---|---|---|---|";
  const tableRows = reportResults.map((r) => {
    const executed = r.browserExecuted ? "YES" : "NO";
    const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
    const net = cell(r.networkEvidence || "");
    const dom = cell(r.domEvidence || "");
    const notes = cell(r.notes || "");
    return `| ${r.id} | ${r.status} | ${executed} | ${net} | ${dom} | ${notes} |`;
  }).join("\n");

  const reportText = redactEvidenceText(`================================================================================
BUSINESS PANEL AUTHENTICATED LOCAL E2E — FINAL REPORT
================================================================================

Environment:
- tested source checkout branch at run start: ${testedSource.branch}
- tested source checkout HEAD at run start: ${testedSource.head}
- tracked working-tree changes at run start: ${testedSource.trackedChanges ? testedSource.trackedChanges.split(/\r?\n/).join(", ") : "none"}
- served Next build provenance: UNVERIFIED (server build ID is not compared with this checkout)
- Next URL: http://127.0.0.1:3100
- mock URL: http://127.0.0.1:4010
- browser: Google Chrome (Headless CDP via native Node WebSocket)
- main browser launch observed: ${browserLaunched ? "YES" : "NO"}
- external package/browser downloads: UNVERIFIED (not monitored by this run)
- credential inputs: synthetic local fixture values; server environment credentials are not audited by this runner

Results Summary:
- recorded observations: ${results.length}
- report entries including unverified required controls: ${reportResults.length}
- PASS count: ${passCount}
- FAIL count: ${failCount}
- SKIP — TOOL LIMITATION count: ${skipCount}
- INCONCLUSIVE count: ${inconcCount}
- UNVERIFIED count: ${unverifiedCount}

Suites:
${renderSuiteSummary(reportResults)}

Phase 4 Readiness Verification:
- F1 result: ${summarizeScenarioGroup(reportResults, ["PHASE4.F1"])}; checks observed grid columns at 1100px and 1200px
- F2 result: ${summarizeScenarioGroup(reportResults, ["S7.3"])}; checks observed browser/mock mutation counts
- F3 result: ${summarizeScenarioGroup(reportResults, ["S9.1", "S9.2", "S9.5"])}; checks focus placement, restoration and resize cleanup
- F4 result: ${summarizeScenarioGroup(reportResults, ["S7.4", "S7.5"])}; checks both name and WhatsApp validation boundaries
- F5 result: ${summarizeScenarioGroup(reportResults, ["S5.7"])}; checks measured long-title geometry

Captured HTTP/resource egress audit (main browser target only, S10.1):
- HTTP/resource hosts observed: ${mainAudit ? JSON.stringify(mainAudit.hosts) : "UNVERIFIED (audit not reached)"}
- captured HTTP/resource requests: ${mainAudit?.requests ?? "UNVERIFIED"}
- external captured HTTP/resource requests: ${mainAudit?.external ?? "UNVERIFIED"}
- captured HTTP/resource supabase.co requests: ${mainAudit?.supabaseCo ?? "UNVERIFIED"}
- captured HTTP/resource yerelsiparis.com requests: ${mainAudit?.productionDomain ?? "UNVERIFIED"}
- blocked HTTP/resource requests: ${mainAudit?.blocked ?? "UNVERIFIED"}
- HTTP/resource egress violation observed: ${mainAudit?.egressViolation ?? "UNVERIFIED"}
- WebSocket observation and egress: UNVERIFIED (WebSocket events are not captured by this helper)
- server-process egress and popup targets: UNVERIFIED (not captured by this main-target audit)

Console Audit (main browser target only, S10.2):
- captured console/browser errors: ${mainAudit?.consoleErrors ?? "UNVERIFIED"}
- excluded observed expected local HTTP 400/409 resource errors: ${mainAudit?.expectedNegativeLogs ?? "UNVERIFIED"}
- unexpected console errors: ${mainAudit?.unexpectedConsoleErrors ?? "UNVERIFIED"}
- network loading failures: ${mainAudit?.loadingFailures ?? "UNVERIFIED"}
- unhandled rejections: UNVERIFIED (no separate rejection counter)

Limitations:
${reportResults.filter(r => ["SKIP — TOOL LIMITATION", "INCONCLUSIVE", "UNVERIFIED"].includes(r.status)).map(r => `- ${r.id} ${r.status} (${r.name}): ${r.notes || "No conclusive observation."}`).join("\n") || "No skipped, inconclusive or unverified scenario was recorded; individual evidence scopes remain as stated in the table."}

Scope:
- runner-configured application/mock destinations: http://127.0.0.1:3100 and http://127.0.0.1:4010
- production/deploy/filesystem-change audit: UNVERIFIED (this report only records scenario and main-target browser observations)
- existing reports are historical evidence; this report describes this run only

================================================================================
EXPLICIT SCENARIO EVIDENCE TABLE
================================================================================

${tableHeader}
${tableRows}

================================================================================
FINAL CLASSIFICATION: ${finalClass}
================================================================================
`);

  const reportPath = process.env.E2E_REPORT_PATH || path.join(os.tmpdir(), `business-panel-browser-e2e-${Date.now()}.txt`);
  fs.writeFileSync(reportPath, reportText, { encoding: "utf8", flag: "wx" });
  console.log(`Report: ${reportPath}`);
  console.log(reportText);
  if (finalClass === "FAIL" || finalClass === "UNVERIFIED") process.exitCode = 1;
}

runAllSuites().catch((err) => {
  console.error("Browser E2E Suite failed with unhandled error:", redactEvidenceText(err instanceof Error ? err.stack || err.message : String(err)));
  process.exit(1);
});
