import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import type { BusinessOrder } from "../../lib/supabase-orders";
import { createOrderPrintReceiptModel } from "./order-print";

const panelSource = readFileSync(resolve("app/panel/page.tsx"), "utf8");
const alertSource = readFileSync(resolve("app/panel/NewOrderAlert.tsx"), "utf8");
const panelCss = readFileSync(resolve("app/panel/panel.module.css"), "utf8");

function order(): BusinessOrder {
  return {
    id: "order-id",
    orderNumber: 42,
    status: "new",
    orderType: "pickup",
    paymentMethod: "cash",
    customerName: "Test Müşteri",
    customerPhone: "05550000000",
    customerAddress: null,
    customerNote: null,
    totalAmount: 250,
    currency: "TRY",
    createdAt: "2026-08-10T12:00:00.000Z",
    updatedAt: "2026-08-10T12:00:00.000Z",
    items: [],
  };
}

test("58 ve 80 mm alert yazdırması aynı receipt modelini kullanabilir", () => {
  const business = { name: "İşletme", address: "Adres", whatsappOrderNumber: "0555" };
  assert.equal(createOrderPrintReceiptModel({ business, order: order(), paperWidth: "58mm" }).paperWidth, "58mm");
  assert.equal(createOrderPrintReceiptModel({ business, order: order(), paperWidth: "80mm" }).paperWidth, "80mm");
});

test("ortak printBusinessOrder receipt modelini izole print document'e gönderir", () => {
  const functionSource = panelSource.slice(
    panelSource.indexOf("function printBusinessOrder"),
    panelSource.indexOf("function printOrder"),
  );
  assert.match(functionSource, /createOrderPrintReceiptModel/);
  assert.match(functionSource, /openPrintDocument/);
  assert.match(functionSource, /type:\s*"order-receipt"/);
});

test("alert ve mevcut order detayı ortak printBusinessOrder fonksiyonunu kullanır", () => {
  assert.match(panelSource, /onPrintOrder=\{printBusinessOrder\}/);
  assert.match(panelSource, /printBusinessOrder\(order\)/);
});

test("Siparişi Gör filtreleri temizler, page 1'e gider ve target ID'yi expand eder", () => {
  const functionSource = panelSource.slice(
    panelSource.indexOf("async function viewBusinessOrder"),
    panelSource.indexOf("function resetForm"),
  );
  assert.match(functionSource, /setSelectedOrderStatusFilter\("all"\)/);
  assert.match(functionSource, /setOrderSearchDraft\(""\)/);
  assert.match(functionSource, /setOrderDateFromDraft\(""\)/);
  assert.match(functionSource, /setOrderPage\(1\)/);
  assert.match(functionSource, /order\.id/);
});

test("target ilk sayfada yoksa görünür exact orderNumber araması uygular", () => {
  assert.match(panelSource, /const exactOrderSearch = String\(order\.orderNumber\)/);
  assert.match(panelSource, /setOrderSearchDraft\(exactOrderSearch\)/);
  assert.match(panelSource, /setAppliedOrderSearch\(exactOrderSearch\)/);
});

test("audio locked durumda sessiz kalır ve yalnız yeni batch'te tetiklenir", () => {
  assert.match(panelSource, /!isAudioUnlockedRef\.current/);
  assert.match(panelSource, /if \(completed\.newOrders\.length > 0\) playNewOrderSound\(\)/);
});

test("persistent alert erişilebilir gerçek butonları sunar", () => {
  assert.match(alertSource, /role="alert"/);
  assert.equal((alertSource.match(/type="button"/g) ?? []).length, 3);
  assert.match(alertSource, /Siparişi Gör/);
  assert.match(alertSource, /Yazdır/);
  assert.match(alertSource, /Kapat/);
});

test("400 px görünümünde iki kolonlu dokunulabilir aksiyon düzeni vardır", () => {
  assert.match(panelCss, /@media \(max-width: 460px\)/);
  assert.match(panelCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(panelCss, /min-height: 44px/);
});

test("watcher sorgusu UI filtrelerinden bağımsız sabit page size kullanır", () => {
  assert.match(panelSource, /\{ page: 1, pageSize: NEW_ORDER_WATCHER_PAGE_SIZE \}/);
  assert.doesNotMatch(
    panelSource.slice(
      panelSource.indexOf("const runWatcherCheck"),
      panelSource.indexOf("const controller = createNewOrderPollingController"),
    ),
    /activeOrderQuery/,
  );
});

test("watcher algılama akışı sipariş status mutation çağırmaz", () => {
  const watcherSource = panelSource.slice(
    panelSource.indexOf("const runWatcherCheck"),
    panelSource.indexOf("const controller = createNewOrderPollingController"),
  );
  assert.doesNotMatch(watcherSource, /updateBusinessOrderStatus|PATCH|status:/);
});
