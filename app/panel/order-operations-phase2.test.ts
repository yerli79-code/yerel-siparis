import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { isBusinessSubscriptionActive } from "../../lib/supabase-business";

const panel = readFileSync(resolve("app/panel/page.tsx"), "utf8");
const orders = readFileSync(resolve("app/panel/PanelOrders.tsx"), "utf8");
const css = readFileSync(resolve("app/panel/panel.module.css"), "utf8");
const watcher = readFileSync(resolve("app/panel/new-order-watcher.ts"), "utf8");
const printDocument = readFileSync(resolve("app/panel/print-document.ts"), "utf8");
const orderUtils = readFileSync(resolve("app/api/business/orders/_utils.ts"), "utf8");
const orderContract = readFileSync(resolve("lib/supabase-orders.ts"), "utf8");
const orderPrint = readFileSync(resolve("app/panel/order-print.ts"), "utf8");

function sourceBetween(source: string, start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

const mutationSource = sourceBetween(
  panel,
  "async function changeOrderStatus",
  "function changeOrderStatusFilter",
);

// ============================================================================
// A. Operational UI / Subscription Guard
// ============================================================================

test("isBusinessSubscriptionActive accurately classifies active, blocked, and expired businesses", () => {
  const futureExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const pastExpiry = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

  assert.equal(
    isBusinessSubscriptionActive({
      isActive: true,
      subscriptionStatus: "active",
      subscriptionStartedAt: "2026-01-01T00:00:00.000Z",
      subscriptionExpiresAt: futureExpiry,
    }),
    true,
  );

  assert.equal(
    isBusinessSubscriptionActive({
      isActive: false,
      subscriptionStatus: "active",
      subscriptionStartedAt: "2026-01-01T00:00:00.000Z",
      subscriptionExpiresAt: futureExpiry,
    }),
    false,
  );

  assert.equal(
    isBusinessSubscriptionActive({
      isActive: true,
      subscriptionStatus: "blocked",
      subscriptionStartedAt: "2026-01-01T00:00:00.000Z",
      subscriptionExpiresAt: futureExpiry,
    }),
    false,
  );

  assert.equal(
    isBusinessSubscriptionActive({
      isActive: true,
      subscriptionStatus: "active",
      subscriptionStartedAt: "2026-01-01T00:00:00.000Z",
      subscriptionExpiresAt: pastExpiry,
    }),
    false,
  );
});

test("canManageOrders is computed from subscription state and passed to PanelOrders", () => {
  assert.match(
    panel,
    /const canManageOrders = canManageProducts;/,
  );
  assert.match(
    panel,
    /<PanelOrders[\s\S]*canManageOrders=\{canManageOrders\}/,
  );
});

test("changeOrderStatus has a client-side canManageOrders guard", () => {
  assert.match(
    mutationSource,
    /if \(!canManageOrders\) return;/,
  );
});

test("PanelOrders status dropdown is disabled when canManageOrders is false", () => {
  assert.match(
    orders,
    /disabled=\{[\s\S]*!canManageOrders/,
  );
});

test("PanelOrders renders clear Turkish explanatory hint when canManageOrders is false", () => {
  assert.match(
    orders,
    /!canManageOrders \? \([\s\S]*panel-order-status-blocked-hint[\s\S]*İşletme aboneliği aktif olmadığından sipariş durumu değiştirilemez\.[\s\S]*\) :/,
  );
  assert.match(
    orders,
    /aria-describedby=\{[\s\S]*!canManageOrders[\s\S]*\? "panel-order-status-blocked-hint"/,
  );
  assert.match(
    css,
    /\.panelScope :global\(\.panel-order-status-blocked-hint\) \{/,
  );
});

test("server-side 403 ORDER_FORBIDDEN enforcement remains authoritative", () => {
  assert.match(orderUtils, /export function isBusinessOperational/);
  assert.match(panel, /ORDER_FORBIDDEN/);
});

// ============================================================================
// B. Cancellation Confirmation Dialog
// ============================================================================

test("selecting cancelled opens the confirmation modal instead of immediately mutating", () => {
  assert.match(
    orders,
    /if \(nextStatus === "cancelled"\) \{\s*setIsCancelConfirmOpen\(true\);\s*return;\s*\}/,
  );
});

test("non-cancelled status selection proceeds directly without confirmation", () => {
  const onChangeBlock = sourceBetween(
    orders,
    "onChange={(event) => {",
    "onUpdateOrderStatus(selectedOrder.id, nextStatus);",
  );
  assert.doesNotMatch(onChangeBlock, /if \(nextStatus === "preparing"\)/);
  assert.doesNotMatch(onChangeBlock, /if \(nextStatus === "ready"\)/);
  assert.doesNotMatch(onChangeBlock, /if \(nextStatus === "delivered"\)/);
  assert.match(
    onChangeBlock,
    /if \(nextStatus === "cancelled"\) \{\s*setIsCancelConfirmOpen\(true\);\s*return;\s*\}/,
  );
});

test("cancel confirmation dialog has accessible markup, modal trap, and safe initial focus", () => {
  assert.match(orders, /role="dialog"/);
  assert.match(orders, /aria-modal="true"/);
  assert.match(orders, /aria-labelledby="panel-order-cancel-title"/);
  assert.match(orders, /aria-describedby="panel-order-cancel-desc"/);
  assert.match(orders, /className="panel-order-cancel-dialog"/);
  assert.match(orders, /className="panel-order-cancel-overlay"/);

  // Focus trap for cancellation dialog with initial focus on Vazgeç and return focus to status select
  assert.match(orders, /isOpen: Boolean\(selectedOrder\) && isCancelConfirmOpen/);
  assert.match(orders, /dialogRef: cancelConfirmDialogRef/);
  assert.match(orders, /initialFocusRef: cancelConfirmAbortButtonRef/);
  assert.match(orders, /returnFocusRef: statusSelectRef/);
});

test("drawer focus trap is paused when cancel confirmation dialog is open to avoid dual escape triggers", () => {
  assert.match(
    orders,
    /isOpen: Boolean\(selectedOrder\) && !isCancelConfirmOpen/,
  );
});

test("aborting cancellation closes modal without mutation and preserves current status", () => {
  assert.match(
    orders,
    /onClick=\{\(\) => setIsCancelConfirmOpen\(false\)\}\s*>[\s\S]*?Vazgeç[\s\S]*?<\/button>/,
  );
});

test("confirming cancellation dispatches mutation exactly once with cancelled status", () => {
  assert.match(
    orders,
    /setIsCancelConfirmOpen\(false\);\s*onUpdateOrderStatus\(selectedOrder\.id, "cancelled"\);/,
  );
});

test("switching orders or closing drawer resets cancel confirmation state", () => {
  assert.match(
    orders,
    /useEffect\(\(\) => \{\s*setIsCancelConfirmOpen\(false\);\s*restoreStatusFocusRef\.current = false;\s*\}, \[expandedOrderId\]\);/,
  );
});

test("closing confirmation restores status focus after drawer trap resumes and mutation settles", () => {
  const focusSource = sourceBetween(
    orders,
    "// Run after both traps:",
    "      aria-busy={isLoadingOrders}",
  );
  assert.ok(orders.indexOf("// Run after both traps:") > orders.indexOf("dialogRef: cancelConfirmDialogRef"));
  assert.match(focusSource, /if \(isCancelConfirmOpen\) \{\s*restoreStatusFocusRef\.current = true;/);
  assert.match(focusSource, /if \(!restoreStatusFocusRef\.current \|\| updatingOrderId === selectedOrder\.id\) return;/);
  assert.match(focusSource, /!statusSelectRef\.current\.disabled/);
  assert.match(focusSource, /statusSelectRef\.current\.focus\(\{ preventScroll: true \}\)/);
  assert.match(focusSource, /\[isCancelConfirmOpen, selectedOrder, updatingOrderId\]/);
  assert.doesNotMatch(focusSource, /onUpdateOrderStatus\(/);
});

// ============================================================================
// C. Concurrency & Regression Safety
// ============================================================================

test("mutation preserves authoritative expectedUpdatedAt for optimistic concurrency", () => {
  assert.match(mutationSource, /authoritativeOrder\.updatedAt/);
  assert.match(
    mutationSource,
    /updateBusinessOrderStatus\(\s*orderId,\s*status,\s*authoritativeOrder\.updatedAt,\s*token,\s*\)/,
  );
});

test("409 ORDER_CONFLICT handling locks stale order and displays refresh action", () => {
  assert.match(mutationSource, /mutationError\.code === "ORDER_CONFLICT"/);
  assert.match(orders, /selectedOrderHasConflict/);
  assert.match(orders, /Güncel Bilgileri Yükle/);
});

test("all standard order status transitions and error cases are preserved", () => {
  for (const status of ["new", "preparing", "ready", "delivered", "cancelled"]) {
    assert.match(orderContract, new RegExp(`"${status}"`));
    assert.match(orderPrint, new RegExp(`${status}:`));
  }
  for (const code of ["ORDER_UNAUTHORIZED", "ORDER_FORBIDDEN", "ORDER_NOT_FOUND", "ORDER_CONFLICT", "ORDER_UNAVAILABLE"]) {
    assert.match(panel, new RegExp(code));
  }
});

test("new order watcher and print contracts remain intact", () => {
  assert.match(watcher, /NEW_ORDER_POLL_INTERVAL_MS = 20_000/);
  assert.match(panel, /playNewOrderSound/);
  assert.match(printDocument, /if \(!activePrintDocument\.popup\.closed\) return "busy"/);
});
