export const PRINT_CONTRACT_SCHEMA_VERSION = 1 as const;
export const PRINT_PROFILE_VERSION = 1 as const;

export const PRINT_JOB_TYPES = ["auto", "test", "reprint"] as const;
export type PrintJobType = (typeof PRINT_JOB_TYPES)[number];

export const RECEIPT_ORDER_STATUSES = [
  "new",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
] as const;
export type ReceiptOrderStatus = (typeof RECEIPT_ORDER_STATUSES)[number];

export const RECEIPT_ORDER_TYPES = ["delivery", "pickup"] as const;
export type ReceiptOrderType = (typeof RECEIPT_ORDER_TYPES)[number];

export const RECEIPT_PAYMENT_METHODS = ["cash", "card"] as const;
export type ReceiptPaymentMethod =
  | (typeof RECEIPT_PAYMENT_METHODS)[number]
  | null;

export type ReceiptCustomerV1 = {
  name: string;
  phone: string;
  address: string | null;
  note: string | null;
};

export type ReceiptItemV1 = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type ReceiptV1 = {
  orderId: string;
  businessName: string;
  businessAddress: string | null;
  businessWhatsapp: string | null;
  orderNumber: number;
  createdAt: string;
  status: ReceiptOrderStatus;
  orderType: ReceiptOrderType;
  paymentMethod: ReceiptPaymentMethod;
  customer: ReceiptCustomerV1;
  items: ReceiptItemV1[];
  totalAmount: number;
  currency: string;
};

export type PrintProfileV1 = {
  profileVersion: 1;
  mode: "system";
  paperWidthMm: 58 | 80;
  copies: 1;
  cutEnabled: false;
};

export type PrintContractV1 = {
  schemaVersion: 1;
  jobId: string;
  jobType: PrintJobType;
  createdAt: string;
  expiresAt: string;
  dedupeKey: string;
  receipt: ReceiptV1;
  printProfile: PrintProfileV1;
};
