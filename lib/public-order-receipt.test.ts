import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublicOrderWhatsAppMessage, haveOrderPricesChanged, moneyInKurus, parsePublicOrderReceipt,
  // @ts-expect-error The existing tsx runner resolves source extensions.
} from "./public-order-receipt.ts";

const id = "22222222-2222-4222-8222-222222222222";
const context = { businessName: "Sentetik İşletme", customer: { fullName: "Test", phone: "05550000000", address: "Test adresi", note: "" } };
const receipt = () => ({ orderNumber: 7, totalAmount: 120, orderType: "pickup" as const,
  paymentMethod: "cash" as const, currency: "TRY" as const,
  items: [{ productId: id, productName: "Kaydedilen ürün", unitPrice: 60, quantity: 2, lineTotal: 120 }] });

test("receipt validates database decimal strings with exact kuruş arithmetic", () => {
  assert.equal(moneyInKurus("12.30"), 1230);
  assert.equal(moneyInKurus(0.3), 30);
  assert.equal(parsePublicOrderReceipt({ ...receipt(), totalAmount: "120.00",
    items: [{ ...receipt().items[0], unitPrice: "60.00", lineTotal: "120.00" }] })?.totalAmount, 120);
});
test("old summary-only API response is uncertain, never a verified receipt", () => {
  assert.equal(parsePublicOrderReceipt({ orderNumber: 7, totalAmount: 120, orderType: "pickup" }), null);
});
for (const [name, patch] of [
  ["negative", { totalAmount: -1 }], ["NaN", { totalAmount: NaN }],
  ["null money", { totalAmount: null }], ["fractional order number", { orderNumber: 1.5 }],
  ["unsafe order number", { orderNumber: Number.MAX_SAFE_INTEGER + 1 }],
  ["wrong currency", { currency: "USD" }], ["wrong payment", { paymentMethod: "online" }],
  ["missing items", { items: [] }], ["mismatched total", { totalAmount: 121 }],
  ["fractional kuruş", { totalAmount: 120.001 }],
  ["bad line total", { items: [{ ...receipt().items[0], lineTotal: 119 }] }],
  ["bad quantity", { items: [{ ...receipt().items[0], quantity: 0 }] }],
  ["invalid product ID", { items: [{ ...receipt().items[0], productId: "not-a-uuid" }] }],
] as const) {
  test(`malformed receipt rejects ${name}`, () => assert.equal(parsePublicOrderReceipt({ ...receipt(), ...patch }), null));
}
test("deleted product snapshot and legacy payment remain usable", () => {
  assert.ok(parsePublicOrderReceipt({ ...receipt(), paymentMethod: null,
    items: [{ ...receipt().items[0], productId: null }] }));
});
test("message uses recorded names, unit prices and totals with no draft-price input", () => {
  const message = buildPublicOrderWhatsAppMessage(context, receipt());
  assert.match(message, /Kaydedilen ürün x 2 \(60,00 TL\) = 120,00 TL/);
  assert.match(message, /Genel Toplam: 120,00 TL/);
  assert.doesNotMatch(message, /Adres:/);
});
for (const orderType of ["pickup", "delivery"] as const) {
  for (const paymentMethod of ["cash", "card"] as const) {
    test(`${orderType}/${paymentMethod} preserves address and physical payment meaning`, () => {
      const message = buildPublicOrderWhatsAppMessage(context, { ...receipt(), orderType, paymentMethod });
      assert.equal(message.includes("Adres: Test adresi"), orderType === "delivery");
      assert.equal(message.includes("Kart (fiziksel POS)"), paymentMethod === "card");
    });
  }
}
test("price changes are detected even when offsetting line changes leave the total unchanged", () => {
  const otherId = "33333333-3333-4333-8333-333333333333";
  const saved = { ...receipt(), items: [
    { ...receipt().items[0], quantity: 1, unitPrice: 70, lineTotal: 70 },
    { ...receipt().items[0], productId: otherId, quantity: 1, unitPrice: 50, lineTotal: 50 },
  ] };
  assert.ok(haveOrderPricesChanged(saved, [
    { productId: id, quantity: 1, unitPrice: 60 },
    { productId: otherId, quantity: 1, unitPrice: 60 },
  ], 120));
  assert.equal(haveOrderPricesChanged(receipt(), [{ productId: id, quantity: 2, unitPrice: 60 }], 120), false);
});

test("normal fractional cart totals do not cause a false price-change warning", () => {
  const otherId = "33333333-3333-4333-8333-333333333333";
  const saved = { ...receipt(), totalAmount: 0.3, items: [
    { productId: id, productName: "A", unitPrice: 0.1, quantity: 1, lineTotal: 0.1 },
    { productId: otherId, productName: "B", unitPrice: 0.2, quantity: 1, lineTotal: 0.2 },
  ] };
  assert.ok(parsePublicOrderReceipt(saved));
  assert.equal(haveOrderPricesChanged(saved, [
    { productId: id, quantity: 1, unitPrice: 0.1 },
    { productId: otherId, quantity: 1, unitPrice: 0.2 },
  ], 0.1 + 0.2), false);
});
