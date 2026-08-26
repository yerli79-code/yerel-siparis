import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const panel = source("app/panel/page.tsx");
const orders = source("app/panel/PanelOrders.tsx");
const alert = source("app/panel/NewOrderAlert.tsx");
const focusTrap = source("app/panel/useModalFocusTrap.ts");
const css = source("app/panel/panel.module.css");
const orderContract = source("lib/supabase-orders.ts");
const businessContract = source("lib/supabase-business.ts");

test("real business identity and browser auth remain authoritative", () => {
  assert.match(panel, /getCurrentUserBusiness\(token\)/);
  assert.match(panel, /getValidAccessToken\(getBusinessAuthConfig\(\)\)/);
  assert.match(panel, /clearBrowserAuthSession\(sessionKey\)/);
  assert.match(panel, /router\.replace\("\/giris"\)/);
  assert.match(panel, /business\.name/);
  assert.doesNotMatch(panel, /Ahmet Y\.|Hazar Döner|hazar-doner/);
});

test("product CRUD, upload, availability and reorder wiring is preserved", () => {
  for (const marker of [
    "fetchProductsByBusinessId",
    "createProduct",
    "updateProduct",
    "deleteProduct",
    "uploadProductImage",
    "setProductActiveStatus",
    "reorderProducts",
  ]) {
    assert.match(panel, new RegExp(marker));
  }
  assert.match(panel, /Satışta/);
  assert.match(panel, /Satış Dışı/);
});

test("profile, business images, payment contract and open state stay wired", () => {
  assert.match(panel, /updateBusinessProfile/);
  assert.match(panel, /uploadBusinessImage/);
  assert.match(panel, /PAYMENT_METHOD_MODES\.map/);
  assert.match(panel, /getPaymentMethodDisplayLabel/);
  assert.match(panel, /profileForm\.isOpen/);
  assert.match(panel, /business\.isOpen/);
  assert.match(panel, /Kart seçeneği,[\s\S]*fiziksel POS/);
});

test("orders retain search, dates, real statuses, pagination, mutation and retry", () => {
  for (const marker of [
    "fetchBusinessOrders",
    "fetchBusinessOrdersPage",
    "updateBusinessOrderStatus",
    "orderSearchDraft",
    "orderDateFromDraft",
    "orderDateToDraft",
    "orderPageSize",
    "refreshActiveOrders",
  ]) {
    assert.match(panel, new RegExp(marker));
  }
  assert.match(panel, /Object\.entries\(orderStatusLabels\)/);
  assert.match(orders, /orderStatusOptions\.map/);
  assert.match(orders, /Tekrar dene/);
  assert.match(orders, /Sayfa \{pagination\.page\}/);
  assert.match(orderContract, /export type OrderStatus =[\s\S]*"cancelled"/);
});

test("order drawer is accessible, responsive and pickup-safe", () => {
  assert.match(orders, /className="panel-order-detail-overlay"/);
  assert.match(orders, /aria-modal="true"/);
  assert.match(orders, /role="dialog"/);
  assert.match(orders, /useModalFocusTrap\(\{/);
  assert.match(orders, /initialFocusRef: closeButtonRef/);
  assert.match(orders, /returnFocusRef:[\s\S]*orderTriggerRef/);
  assert.match(orders, /orderTriggerRef\.current = event\.currentTarget/);
  assert.match(orders, /ref=\{dialogRef\}/);
  assert.match(focusTrap, /event\.key === "Escape"/);
  assert.match(
    orders,
    /selectedOrder\.orderType === "delivery" \? \([\s\S]*panel-order-address[\s\S]*\) : null/,
  );
  assert.doesNotMatch(orders, /Gel-al[\s\S]{0,80}customerAddress/);
  assert.match(css, /panel-order-detail\) \{[\s\S]*width: 100%[\s\S]*height: 100dvh/);
  assert.match(css, /@media screen and \(min-width: 700px\)[\s\S]*panel-order-detail\) \{[\s\S]*width: 430px/);
});

test("modal focus trap contains Tab in both directions and cleans up safely", () => {
  assert.match(focusTrap, /event\.key !== "Tab"/);
  assert.match(focusTrap, /event\.shiftKey/);
  assert.match(focusTrap, /lastFocusable\.focus\(\{ preventScroll: true \}\)/);
  assert.match(focusTrap, /firstFocusable\.focus\(\{ preventScroll: true \}\)/);
  assert.match(focusTrap, /document\.addEventListener\("keydown", handleKeyDown\)/);
  assert.match(focusTrap, /document\.removeEventListener\("keydown", handleKeyDown\)/);
  assert.match(focusTrap, /document\.body\.style\.overflow = "hidden"/);
  assert.match(
    focusTrap,
    /document\.body\.style\.overflow = previousBodyOverflow/,
  );
  assert.match(focusTrap, /returnTarget\?\.isConnected/);
  assert.match(focusTrap, /returnTarget\.focus\(\{ preventScroll: true \}\)/);
});

test("mobile menu is a contained modal and restores its exact opening trigger", () => {
  assert.match(panel, /useModalFocusTrap\(\{[\s\S]*isOpen: isMobileMenuOpen/);
  assert.match(panel, /dialogRef: mobileMenuDialogRef/);
  assert.match(panel, /initialFocusRef: mobileMenuCloseRef/);
  assert.match(panel, /returnFocusRef: mobileMenuTriggerRef/);
  assert.match(panel, /mobileMenuTriggerRef\.current = event\.currentTarget/);
  assert.match(panel, /ref=\{mobileMenuDialogRef\}/);
  assert.match(panel, /ref=\{mobileMenuCloseRef\}/);
  assert.match(panel, /onClick=\{openMobileMenu\}/);
  assert.match(panel, /setExpandedOrderId\(""\)[\s\S]*setIsMobileMenuOpen\(true\)/);
  assert.match(panel, /setIsMobileMenuOpen\(false\)[\s\S]*setExpandedOrderId/);
});

test("existing receipt and isolated print flow remain the only print path", () => {
  assert.match(panel, /createOrderPrintReceiptModel/);
  assert.match(panel, /openPrintDocument/);
  assert.match(panel, /orderPrintPaperWidth/);
  assert.match(panel, /onPrintOrder=\{printBusinessOrder\}/);
  assert.match(orders, /onPrintOrder\(selectedOrder\.id\)/);
  assert.doesNotMatch(orders, /window\.print/);
});

test("new-order watcher, visual alert, audio and queue behavior remain connected", () => {
  for (const marker of [
    "createNewOrderPollingController",
    "establishNewOrderBaseline",
    "ingestNewOrderWatcherPage",
    "completeNewOrderPoll",
    "dismissPendingNewOrder",
    "playNewOrderSound",
  ]) {
    assert.match(panel, new RegExp(marker));
  }
  assert.match(panel, /if \(completed\.newOrders\.length > 0\) playNewOrderSound\(\)/);
  assert.match(panel, /<NewOrderAlert/);
  assert.match(alert, /role="alert"/);
});

test("header has no fake notification control while real order alerts remain", () => {
  assert.doesNotMatch(panel, /aria-label="Bildirimler"/);
  assert.doesNotMatch(panel, /className="business-panel-header-icon"/);
  assert.match(panel, /<NewOrderAlert/);
  assert.match(panel, /pendingNewOrders\.length/);
  assert.match(panel, /playNewOrderSound/);
});

test("overview metrics and recent orders come only from production data", () => {
  assert.match(panel, /fetchBusinessDashboardSummary/);
  assert.match(panel, /dashboardSummary\?\.orders\.total/);
  assert.match(panel, /dashboardSummary\?\.orders\.pending/);
  assert.match(panel, /dashboardSummary\?\.orders\.delivered/);
  assert.match(panel, /dashboardSummary\.revenue\.delivered/);
  assert.match(panel, /overviewOrders\.slice\(0, 3\)/);
  assert.doesNotMatch(panel, /Düne göre|Bugün teslim edildi|value="12"/);
});

test("desktop sidebar and four-item mobile navigation use client-side sections", () => {
  for (const label of [
    "Genel Bakış",
    "Siparişler",
    "Ürünler",
    "Kategoriler",
    "İşletme Bilgileri",
    "QR Kod",
    "Abonelik",
  ]) {
    assert.match(panel, new RegExp(label));
  }
  assert.match(panel, /business-panel-desktop-nav/);
  assert.match(panel, /business-panel-mobile-nav/);
  assert.match(panel, />Genel</);
  assert.match(panel, />Menü</);
  assert.match(panel, /setIsMobileMenuOpen\(true\)/);
  assert.match(css, /@media screen and \(min-width: 1024px\)/);
  assert.match(css, /grid-template-columns: 238px minmax\(0, 1fr\)/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
});

test("mobile targets, safe areas and normal quick-action wrapping are guarded", () => {
  assert.match(css, /business-panel-mobile-nav button\) \{[\s\S]*min-height: 56px/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /overflow-x: clip/);
  assert.match(css, /grid-template-columns: 36px minmax\(0, 1fr\) auto/);
  const quickRule = css.slice(
    css.lastIndexOf(".business-panel-quick-actions button > span"),
    css.lastIndexOf(".business-panel-quick-actions strong"),
  );
  assert.match(quickRule, /min-width: 0/);
  assert.match(quickRule, /overflow-wrap: normal/);
  assert.match(quickRule, /word-break: normal/);
  assert.doesNotMatch(quickRule, /overflow-wrap:\s*anywhere|word-break:\s*break-all/);
});

test("QR, subscription and category views reuse current production contracts", () => {
  assert.match(panel, /QRCode\.toCanvas\(canvas, nextCustomerOrderUrl/);
  assert.match(panel, /window\.location\.origin/);
  assert.match(panel, /safeQrFileSlug\(business\.slug\)/);
  assert.match(panel, /isBusinessSubscriptionActive\(business\)/);
  assert.match(panel, /showRenewalInfo/);
  assert.match(panel, /categorySummaries\.map/);
  assert.match(panel, /openCategoryProducts/);
  assert.doesNotMatch(panel, /mock-qr|mockQr|fakeQr/);
});

test("P6.1A introduces no backend, schema, admin or dependency changes", () => {
  const changedFiles = execFileSync(
    "git",
    ["diff", "--name-only", "2f988d0ab82f7fe56d7653dfe0208bdd42475a98", "--"],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  assert.equal(changedFiles.some((path) => path.startsWith("app/api/")), false);
  assert.equal(changedFiles.some((path) => path.startsWith("supabase/")), false);
  assert.equal(changedFiles.some((path) => path.startsWith("app/admin/")), false);
  assert.equal(changedFiles.some((path) => path.startsWith("lib/admin/")), false);
  assert.equal(changedFiles.includes("package.json"), false);
  assert.equal(changedFiles.includes("package-lock.json"), false);
  assert.match(businessContract, /export async function updateBusinessProfile/);
});
