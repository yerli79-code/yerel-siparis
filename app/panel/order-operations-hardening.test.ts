import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const panel = readFileSync(resolve("app/panel/page.tsx"), "utf8");
const orders = readFileSync(resolve("app/panel/PanelOrders.tsx"), "utf8");
const css = readFileSync(resolve("app/panel/panel.module.css"), "utf8");
const watcher = readFileSync(resolve("app/panel/new-order-watcher.ts"), "utf8");
const printDocument = readFileSync(resolve("app/panel/print-document.ts"), "utf8");

function sourceBetween(source: string, start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

const mutationSource = sourceBetween(
  panel,
  "async function changeOrderStatus",
  "function changeOrderStatusFilter",
);
const refreshSource = sourceBetween(
  panel,
  "async function refreshOrders",
  "async function changeOrderStatus",
);

test("mutation uses the currently loaded authoritative updatedAt", () => {
  assert.match(mutationSource, /ordersRef\.current\.find/);
  assert.match(mutationSource, /authoritativeOrder\.updatedAt/);
  assert.doesNotMatch(mutationSource, /new Date\(|Date\.now\(/);
});

test("same-status selection is a client no-op", () => {
  assert.match(mutationSource, /authoritativeOrder\.status === status/);
  assert.match(orders, /if \(nextStatus === selectedOrder\.status\) return/);
});

test("same order has a synchronous in-flight duplicate guard", () => {
  assert.match(panel, /inFlightOrderMutationsRef = useRef\(new Set<string>\(\)\)/);
  assert.match(mutationSource, /inFlightOrderMutationsRef\.current\.has\(orderId\)/);
  assert.match(mutationSource, /inFlightOrderMutationsRef\.current\.add\(orderId\)/);
  assert.match(mutationSource, /finally[\s\S]*inFlightOrderMutationsRef\.current\.delete\(orderId\)/);
});

test("successful mutation merges the authoritative order without synthesizing fields", () => {
  const mergeSource = sourceBetween(
    panel,
    "function mergeAuthoritativeOrder",
    "async function refreshOrders",
  );
  assert.match(mutationSource, /mergeAuthoritativeOrder\(updatedOrder\)/);
  assert.match(mergeSource, /order\.id === updatedOrder\.id \? updatedOrder : order/);
  assert.match(mergeSource, /setOverviewOrders/);
  assert.match(mergeSource, /pendingNewOrders:/);
  assert.doesNotMatch(mergeSource, /updatedAt:\s*|status:\s*updatedOrder\.status/);
});

test("successful mutation refreshes the list only when the active status filter ejects the row", () => {
  assert.match(
    mutationSource,
    /activeOrderQuery\.status[\s\S]*activeOrderQuery\.status !== updatedOrder\.status[\s\S]*refreshOrders\(activeOrderQuery\)/,
  );
  assert.equal((mutationSource.match(/refreshOrders\(activeOrderQuery\)/g) ?? []).length, 1);
});

test("conflict is controlled, never retried, and locks the stale order", () => {
  assert.match(mutationSource, /mutationError\.code === "ORDER_CONFLICT"/);
  assert.match(mutationSource, /conflictedOrderIdsRef\.current = next/);
  assert.equal((mutationSource.match(/updateBusinessOrderStatus\(/g) ?? []).length, 1);
  assert.match(orders, /selectedOrderHasConflict/);
  assert.match(orders, /disabled=\{[\s\S]*selectedOrderHasConflict/);
});

test("conflict copy and explicit authoritative refresh action are visible in the drawer", () => {
  assert.match(panel, /Sipariş başka bir oturumda güncellendi\. Güncel bilgileri yükleyin\./);
  assert.match(orders, /role="alert"/);
  assert.match(orders, /Güncel Bilgileri Yükle/);
  assert.match(orders, /onRefreshOrders\(\)/);
});

test("a successful refresh clears conflict locks and mutation messages", () => {
  assert.match(refreshSource, /conflictedOrderIdsRef\.current = new Set\(\)/);
  assert.match(refreshSource, /setConflictedOrderIds\(conflictedOrderIdsRef\.current\)/);
  assert.match(refreshSource, /setOrderMutationMessages\(\{\}\)/);
});

test("mutation failures preserve the authoritative order and never show success", () => {
  const catchSource = mutationSource.slice(mutationSource.indexOf("} catch"));
  assert.doesNotMatch(catchSource, /setOrders|mergeAuthoritativeOrder|setMessage\("Sipariş durumu güncellendi/);
  assert.match(catchSource, /setOrderMutationMessages/);
});

test("401 keeps the established session-expiry behavior", () => {
  assert.match(mutationSource, /ORDER_UNAUTHORIZED[\s\S]*endBusinessSession\(\)/);
  assert.match(panel, /router\.replace\("\/giris"\)/);
});

test("403, 404, unavailable and invalid failures have controlled Turkish copy", () => {
  for (const marker of [
    "ORDER_FORBIDDEN",
    "ORDER_NOT_FOUND",
    "ORDER_UNAVAILABLE",
    "INVALID_ORDER_MUTATION",
  ]) {
    assert.match(panel, new RegExp(marker));
  }
  assert.doesNotMatch(mutationSource, /caughtError\.message|caughtError\.stack/);
});

test("older list requests are aborted and generation-gated", () => {
  assert.match(refreshSource, /orderListAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(refreshSource, /requestGeneration !== orderListRequestGenerationRef\.current/);
  assert.match(refreshSource, /signal: abortController\.signal/);
});

test("status mutation invalidates related list work at both mutation boundaries", () => {
  assert.match(panel, /function cancelActiveOrderListRequest\(\)/);
  assert.ok(
    (mutationSource.match(/cancelActiveOrderListRequest\(\)/g) ?? []).length >= 3,
  );
  assert.match(orders, /orderControlsDisabled = isLoadingOrders \|\| Boolean\(updatingOrderId\)/);
});

test("superseded AbortError never becomes a visible order-list error", () => {
  assert.match(refreshSource, /isAbortError\(caughtError\)/);
  const abortBranch = refreshSource.slice(
    refreshSource.indexOf("isAbortError(caughtError)"),
    refreshSource.indexOf("setOrdersError(businessOrdersLoadErrorMessage)"),
  );
  assert.match(abortBranch, /return null/);
  assert.doesNotMatch(abortBranch, /setOrdersError/);
});

test("unmount aborts list work and releases local mutation guards", () => {
  assert.match(panel, /orderListRequestGenerationRef\.current \+= 1/);
  assert.match(panel, /orderListAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(panel, /inFlightOrderMutationsRef\.current\.clear\(\)/);
});

test("refresh keeps an attached drawer open and closes a detached drawer", () => {
  assert.match(
    refreshSource,
    /result\.orders\.some\(\(order\) => order\.id === currentOrderId\)[\s\S]*\? currentOrderId[\s\S]*: ""/,
  );
  assert.match(orders, /const selectedOrder = orders\.find/);
  assert.match(orders, /useModalFocusTrap/);
});

test("print remains read-only and available during conflict", () => {
  const printDisabled = orders.match(
    /aria-label=\{`#\$\{selectedOrder\.orderNumber\} numaralı siparişi yazdır`\}[\s\S]*?disabled=\{([^}]*)\}/,
  );
  assert.ok(printDisabled);
  assert.match(printDisabled[1], /updatingOrderId === selectedOrder\.id/);
  assert.doesNotMatch(printDisabled[1], /selectedOrderHasConflict/);
  assert.match(panel, /createOrderPrintReceiptModel/);
});

test("print document busy guard and both receipt widths are untouched", () => {
  assert.match(printDocument, /if \(!activePrintDocument\.popup\.closed\) return "busy"/);
  assert.match(orders, /<option value="58mm">58 mm<\/option>/);
  assert.match(orders, /<option value="80mm">80 mm<\/option>/);
});

test("watcher remains a single independent polling controller", () => {
  assert.match(panel, /createNewOrderPollingController/);
  assert.match(panel, /NEW_ORDER_WATCHER_PAGE_SIZE/);
  assert.equal((panel.match(/createNewOrderPollingController\(\{/g) ?? []).length, 1);
  assert.match(watcher, /NEW_ORDER_POLL_INTERVAL_MS = 20_000/);
});

test("watcher alert queue and audio behavior remain operational", () => {
  assert.match(panel, /setPendingNewOrders\(completed\.state\.pendingNewOrders\)/);
  assert.match(panel, /if \(completed\.newOrders\.length > 0\) playNewOrderSound\(\)/);
  assert.match(panel, /<NewOrderAlert/);
});

test("390px drawer keeps status, refresh and print actions reachable without overflow", () => {
  assert.match(css, /height: 100dvh/);
  assert.match(css, /overflow-y: auto/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /panel-order-mutation-message button\)[\s\S]*min-height: 44px/);
  assert.match(css, /overflow-x: clip/);
});
