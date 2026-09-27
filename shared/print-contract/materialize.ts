import type { BusinessOrder } from "../../lib/supabase-orders";
import { sanitizePrintText } from "./sanitize";
import type {
  PrintContractV1,
  PrintJobType,
  PrintProfileV1,
} from "./types";
import { validatePrintContractV1 } from "./validate";

export type ReceiptBusinessSource = {
  name: string;
  address: string | null;
  whatsapp: string | null;
};

export type MaterializePrintContractV1Input = {
  jobId: string;
  jobType: PrintJobType;
  createdAt: string;
  expiresAt: string;
  dedupeKey: string;
  business: ReceiptBusinessSource;
  order: BusinessOrder;
  printProfile: PrintProfileV1;
};

export class PrintContractMaterializationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super("Print contract materialization failed validation.");
    this.name = "PrintContractMaterializationError";
    this.issues = [...issues];
  }
}

function optionalText(value: string | null, allowNewlines = false) {
  if (value === null) return null;
  const sanitized = sanitizePrintText(value, { allowNewlines });
  return sanitized || null;
}

function normalizedIso(value: string, path: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new PrintContractMaterializationError([
      `${path}: must be an ISO timestamp`,
    ]);
  }
  return date.toISOString();
}

/**
 * Deterministically creates the normalized v1 receipt snapshot. It performs no
 * I/O, reads no clock/locale state, and never includes source values in errors.
 */
export function materializePrintContractV1(
  input: MaterializePrintContractV1Input,
): PrintContractV1 {
  const contract: PrintContractV1 = {
    schemaVersion: 1,
    jobId: sanitizePrintText(input.jobId),
    jobType: input.jobType,
    createdAt: normalizedIso(input.createdAt, "createdAt"),
    expiresAt: normalizedIso(input.expiresAt, "expiresAt"),
    dedupeKey: sanitizePrintText(input.dedupeKey),
    receipt: {
      orderId: sanitizePrintText(input.order.id),
      businessName: sanitizePrintText(input.business.name),
      businessAddress: optionalText(input.business.address, true),
      businessWhatsapp: optionalText(input.business.whatsapp),
      orderNumber: input.order.orderNumber,
      createdAt: normalizedIso(input.order.createdAt, "receipt.createdAt"),
      status: input.order.status,
      orderType: input.order.orderType,
      paymentMethod: input.order.paymentMethod,
      customer: {
        name: sanitizePrintText(input.order.customerName),
        phone: sanitizePrintText(input.order.customerPhone),
        address: optionalText(input.order.customerAddress, true),
        note: optionalText(input.order.customerNote, true),
      },
      items: input.order.items.map((item) => ({
        name: sanitizePrintText(item.productName),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      totalAmount: input.order.totalAmount,
      currency: sanitizePrintText(input.order.currency).toUpperCase(),
    },
    printProfile: { ...input.printProfile },
  };

  const validation = validatePrintContractV1(contract);
  if (!validation.ok) {
    throw new PrintContractMaterializationError(validation.issues);
  }
  return validation.value;
}
