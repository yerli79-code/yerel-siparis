import assert from "node:assert/strict";
import { test } from "node:test";
import { LEGACY_PAYMENT_METHOD_LABEL } from "../../lib/payment-methods";
import type { BusinessOrder } from "../../lib/supabase-orders";
import {
  createOrderPrintReceiptModel,
  formatOrderPrintCurrency,
  formatOrderPrintDate,
  type OrderPrintBusiness,
} from "./order-print";

const business: OrderPrintBusiness = {
  name: "İstanbul Sofrası",
  address: "Caferağa Mahallesi, Moda Caddesi No: 12/A",
  whatsappOrderNumber: "905551112233",
};

function order(overrides: Partial<BusinessOrder> = {}): BusinessOrder {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    orderNumber: 123,
    status: "preparing",
    orderType: "delivery",
    paymentMethod: "card",
    customerName: "Çağla Şen",
    customerPhone: "0555 444 33 22",
    customerAddress: "Rasimpaşa Mahallesi, Uzunçayır Sokak No: 8",
    customerNote: "Soğansız ve acısız olsun.",
    totalAmount: 515,
    currency: "TRY",
    createdAt: "2026-08-05T09:30:00.000Z",
    updatedAt: "2026-08-05T09:35:00.000Z",
    items: [
      {
        id: "item-1",
        productId: "product-1",
        productName: "Adana Dürüm",
        unitPrice: 225,
        quantity: 2,
        lineTotal: 450,
      },
      {
        id: "item-2",
        productId: "product-2",
        productName: "Şalgam",
        unitPrice: 65,
        quantity: 1,
        lineTotal: 65,
      },
    ],
    ...overrides,
  };
}

function receipt(
  orderOverrides: Partial<BusinessOrder> = {},
  businessOverrides: Partial<OrderPrintBusiness> = {},
) {
  return createOrderPrintReceiptModel({
    business: { ...business, ...businessOverrides },
    order: order(orderOverrides),
    paperWidth: "80mm",
  });
}

test("teslimat siparişini yazdırılabilir modele dönüştürür", () => {
  const result = receipt();
  assert.equal(result.orderTypeLabel, "Teslimat");
  assert.equal(result.customerAddressOrPickupMessage, order().customerAddress);
  assert.equal(result.businessName, business.name);
});

test("gel-al siparişinde teslim alma açıklamasını kullanır", () => {
  assert.equal(
    receipt({ orderType: "pickup", customerAddress: null })
      .customerAddressOrPickupMessage,
    "Müşteri siparişi işletmeden teslim alacak.",
  );
});

test("sipariş numarasını değiştirmeden taşır", () => {
  assert.equal(receipt({ orderNumber: 987 }).orderNumber, 987);
});

test("sipariş durumunu Türkçe etiketle gösterir", () => {
  assert.equal(receipt({ status: "preparing" }).statusLabel, "Hazırlanıyor");
});

test("ödeme yöntemi etiketini mevcut helper üzerinden üretir", () => {
  assert.equal(receipt({ paymentMethod: "card" }).paymentMethodLabel, "Kart (fiziksel POS)");
});

test("null ödeme yönteminde eski sipariş fallback etiketini kullanır", () => {
  assert.equal(
    receipt({ paymentMethod: null }).paymentMethodLabel,
    LEGACY_PAYMENT_METHOD_LABEL,
  );
});

test("tarih ve saati Europe/Istanbul zaman diliminde biçimlendirir", () => {
  assert.equal(formatOrderPrintDate("2026-08-05T09:30:00.000Z"), "05.08.2026 12:30");
});

test("geçerli TRY tutarını biçimlendirir", () => {
  const formatted = formatOrderPrintCurrency(1234.5, "TRY");
  assert.match(formatted, /TRY/);
  assert.match(formatted, /1\.234,50/);
});

test("geçerli farklı para birimini koruyarak biçimlendirir", () => {
  const formatted = formatOrderPrintCurrency(1234.5, "USD");
  assert.match(formatted, /USD/);
  assert.match(formatted, /1\.234,50/);
});

test("geçersiz para biriminde TRY fallback kullanır", () => {
  assert.match(formatOrderPrintCurrency(100, "invalid-currency"), /TRY/);
});

test("müşteri notu varsa değerini korur", () => {
  assert.equal(receipt({ customerNote: "  Zili çalmayın.  " }).customerNote, "  Zili çalmayın.  ");
});

test("müşteri notu yoksa null döndürür", () => {
  assert.equal(receipt({ customerNote: null }).customerNote, null);
  assert.equal(receipt({ customerNote: "   " }).customerNote, null);
});

test("işletme adresi boşsa null döndürür", () => {
  assert.equal(receipt({}, { address: "   " }).businessAddress, null);
});

test("işletme WhatsApp bilgisi boşsa null döndürür", () => {
  assert.equal(
    receipt({}, { whatsappOrderNumber: "   " }).businessWhatsapp,
    null,
  );
});

test("ürün sırasını korur", () => {
  assert.deepEqual(
    receipt().items.map((item) => item.productName),
    ["Adana Dürüm", "Şalgam"],
  );
});

test("adet, birim fiyat ve satır toplamlarını değiştirmez", () => {
  const firstItem = receipt().items[0];
  assert.equal(firstItem.quantity, 2);
  assert.equal(firstItem.unitPrice, 225);
  assert.equal(firstItem.lineTotal, 450);
});

test("genel toplamı değiştirmeden taşır ve biçimlendirir", () => {
  const result = receipt({ totalAmount: 515 });
  assert.equal(result.totalAmount, 515);
  assert.match(result.formattedTotal, /515,00/);
});

test("Türkçe karakterli veriyi korur", () => {
  const result = receipt({ customerName: "Işıl Özçağrı", customerNote: "Çatal gönderin." });
  assert.equal(result.customerName, "Işıl Özçağrı");
  assert.equal(result.customerNote, "Çatal gönderin.");
});

test("uzun ürün adını kesmez", () => {
  const longName = "Çok uzun ürün adı ".repeat(20);
  const source = order();
  source.items[0] = { ...source.items[0], productName: longName };
  const result = receipt({ items: source.items });
  assert.equal(result.items[0].productName, longName);
});

test("uzun teslimat adresini kesmez", () => {
  const longAddress = "Uzun teslimat adresi ".repeat(20);
  assert.equal(
    receipt({ customerAddress: longAddress }).customerAddressOrPickupMessage,
    longAddress,
  );
});

test("geçersiz tarihte kontrollü fallback döndürür", () => {
  assert.equal(formatOrderPrintDate("geçersiz-tarih"), "-");
});

test("kaynak BusinessOrder nesnesini mutate etmez", () => {
  const source = order();
  const snapshot = structuredClone(source);
  createOrderPrintReceiptModel({ business, order: source, paperWidth: "58mm" });
  assert.deepEqual(source, snapshot);
});
