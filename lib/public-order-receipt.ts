import { getPaymentMethodDisplayLabel, isPaymentMethod, type PaymentMethod } from "./payment-methods";

export type PublicOrderReceiptItem = {
  productId: string | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type PublicOrderReceipt = {
  orderNumber: number;
  totalAmount: number;
  orderType: "delivery" | "pickup";
  paymentMethod: PaymentMethod | null;
  currency: "TRY";
  items: PublicOrderReceiptItem[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// PostgreSQL numeric(12,2) is represented in integer kuruş while validating.
export function moneyInKurus(value: unknown): number | null {
  const decimal = typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : typeof value === "string" ? value : "";
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(decimal)) return null;
  if (typeof value === "number" && Number(decimal) !== value) return null;
  const [whole, fraction = ""] = decimal.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount <= 999_999_999_999 ? amount : null;
}

export function parsePublicOrderReceipt(value: unknown): PublicOrderReceipt | null {
  if (!record(value) || !Number.isSafeInteger(value.orderNumber) ||
      Number(value.orderNumber) <= 0 ||
      (value.orderType !== "pickup" && value.orderType !== "delivery") ||
      (value.paymentMethod !== null && !isPaymentMethod(value.paymentMethod)) ||
      value.currency !== "TRY" || !Array.isArray(value.items) ||
      value.items.length < 1 || value.items.length > 50) return null;
  const total = moneyInKurus(value.totalAmount);
  if (total === null) return null;
  let sum = 0;
  const ids = new Set<string>();
  const items: PublicOrderReceiptItem[] = [];
  for (const item of value.items) {
    if (!record(item) || (item.productId !== null &&
        (typeof item.productId !== "string" || !uuid.test(item.productId))) ||
        typeof item.productName !== "string" || !item.productName.trim() ||
        item.productName.length > 180 || !Number.isSafeInteger(item.quantity) ||
        Number(item.quantity) < 1 || Number(item.quantity) > 99) return null;
    if (typeof item.productId === "string") {
      if (ids.has(item.productId)) return null;
      ids.add(item.productId);
    }
    const unit = moneyInKurus(item.unitPrice);
    const line = moneyInKurus(item.lineTotal);
    if (unit === null || line === null || unit * Number(item.quantity) !== line) return null;
    sum += line;
    items.push({ productId: item.productId as string | null,
      productName: item.productName.trim(), unitPrice: unit / 100,
      quantity: Number(item.quantity), lineTotal: line / 100 });
  }
  if (!Number.isSafeInteger(sum) || sum !== total) return null;
  return { orderNumber: Number(value.orderNumber), totalAmount: total / 100,
    orderType: value.orderType, paymentMethod: value.paymentMethod,
    currency: "TRY", items };
}

export function haveOrderPricesChanged(
  receipt: PublicOrderReceipt,
  quotedItems: Array<{ productId: string; quantity: number; unitPrice: number }>,
  quotedTotal: number,
) {
  // Cart totals are JS sums (e.g. 0.1 + 0.2). Normalize only that untrusted
  // display estimate; validation of the persisted receipt stays exact.
  const quotedTotalInKurus = Number.isFinite(quotedTotal)
    ? moneyInKurus(Number(quotedTotal.toFixed(2))) : null;
  return quotedTotalInKurus !== moneyInKurus(receipt.totalAmount) ||
    quotedItems.length !== receipt.items.length || receipt.items.some(item => {
      const quoted = quotedItems.find(row => row.productId === item.productId);
      return !quoted || quoted.quantity !== item.quantity ||
        moneyInKurus(quoted.unitPrice) !== moneyInKurus(item.unitPrice);
    });
}

export function formatRecordedOrderAmount(amount: number) {
  return `${amount.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}

export function buildPublicOrderWhatsAppMessage(
  context: { businessName: string; customer: { fullName: string; phone: string; address: string; note: string } },
  receipt: PublicOrderReceipt,
) {
  // This function cannot accept draft cart prices. All money and product names
  // are taken from the receipt validated after the order RPC commits.
  return [
    "Yeni Sipariş", `Sipariş No: #${receipt.orderNumber}`,
    `İşletme: ${context.businessName}`, "", "Müşteri Bilgileri:",
    `Ad Soyad: ${context.customer.fullName}`, `Telefon: ${context.customer.phone}`,
    `Sipariş Türü: ${receipt.orderType === "delivery" ? "Teslimat" : "Gel-al"}`,
    `Ödeme Yöntemi: ${getPaymentMethodDisplayLabel(receipt.paymentMethod)}`,
    ...(receipt.orderType === "delivery" ? [`Adres: ${context.customer.address}`] : []),
    `Not: ${context.customer.note || "-"}`, "", "Sipariş:",
    ...receipt.items.map(item => `- ${item.productName} x ${item.quantity} (${formatRecordedOrderAmount(item.unitPrice)}) = ${formatRecordedOrderAmount(item.lineTotal)}`),
    "", `Genel Toplam: ${formatRecordedOrderAmount(receipt.totalAmount)}`,
  ].join("\n");
}
