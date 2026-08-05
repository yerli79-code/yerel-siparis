import { getPaymentMethodDisplayLabel } from "../../lib/payment-methods";
import type {
  BusinessOrder,
  OrderStatus,
} from "../../lib/supabase-orders";

export type OrderPrintPaperWidth = "58mm" | "80mm";

export type OrderPrintBusiness = {
  name: string;
  address: string;
  whatsappOrderNumber: string;
};

export type OrderPrintReceiptItem = {
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  formattedUnitPrice: string;
  formattedLineTotal: string;
};

export type OrderPrintReceiptModel = {
  businessName: string;
  businessAddress: string | null;
  businessWhatsapp: string | null;
  orderNumber: number;
  formattedCreatedAt: string;
  statusLabel: string;
  orderTypeLabel: string;
  paymentMethodLabel: string;
  customerName: string;
  customerPhone: string;
  customerAddressOrPickupMessage: string;
  customerNote: string | null;
  items: OrderPrintReceiptItem[];
  totalAmount: number;
  formattedTotal: string;
  paperWidth: OrderPrintPaperWidth;
};

export const orderStatusLabels: Record<OrderStatus, string> = {
  new: "Yeni",
  preparing: "Hazırlanıyor",
  ready: "Hazır",
  delivered: "Teslim edildi",
  cancelled: "İptal edildi",
};

const pickupMessage = "Müşteri siparişi işletmeden teslim alacak.";
const missingDeliveryAddress = "Adres belirtilmedi.";
const fallbackCurrency = "TRY";

const istanbulDateTimeFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getOptionalText(value: string | null | undefined) {
  return value?.trim() ? value : null;
}

export function getOrderTypeLabel(orderType: BusinessOrder["orderType"]) {
  return orderType === "delivery" ? "Teslimat" : "Gel-al";
}

export function formatOrderPrintDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";

  const parts = new Map(
    istanbulDateTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const day = parts.get("day");
  const month = parts.get("month");
  const year = parts.get("year");
  const hour = parts.get("hour");
  const minute = parts.get("minute");
  if (!day || !month || !year || !hour || !minute) return "-";

  return `${day}.${month}.${year} ${hour}:${minute}`;
}

function tryFormatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatOrderPrintCurrency(amount: number, currency: string) {
  const normalizedCurrency = currency.trim().toUpperCase();

  try {
    return tryFormatCurrency(amount, normalizedCurrency);
  } catch {
    return tryFormatCurrency(amount, fallbackCurrency);
  }
}

type CreateOrderPrintReceiptModelInput = {
  business: OrderPrintBusiness;
  order: BusinessOrder;
  paperWidth: OrderPrintPaperWidth;
};

export function createOrderPrintReceiptModel({
  business,
  order,
  paperWidth,
}: CreateOrderPrintReceiptModelInput): OrderPrintReceiptModel {
  const formatCurrency = (amount: number) =>
    formatOrderPrintCurrency(amount, order.currency);

  return {
    businessName: business.name.trim() || "-",
    businessAddress: getOptionalText(business.address),
    businessWhatsapp: getOptionalText(business.whatsappOrderNumber),
    orderNumber: order.orderNumber,
    formattedCreatedAt: formatOrderPrintDate(order.createdAt),
    statusLabel: orderStatusLabels[order.status],
    orderTypeLabel: getOrderTypeLabel(order.orderType),
    paymentMethodLabel: getPaymentMethodDisplayLabel(order.paymentMethod),
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerAddressOrPickupMessage:
      order.orderType === "pickup"
        ? pickupMessage
        : getOptionalText(order.customerAddress) ?? missingDeliveryAddress,
    customerNote: getOptionalText(order.customerNote),
    items: order.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      formattedUnitPrice: formatCurrency(item.unitPrice),
      formattedLineTotal: formatCurrency(item.lineTotal),
    })),
    totalAmount: order.totalAmount,
    formattedTotal: formatCurrency(order.totalAmount),
    paperWidth,
  };
}
