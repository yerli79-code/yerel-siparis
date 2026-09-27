import {
  PRINT_JOB_TYPES,
  RECEIPT_ORDER_STATUSES,
  RECEIPT_ORDER_TYPES,
  RECEIPT_PAYMENT_METHODS,
  type PrintContractV1,
} from "./types";
import { hasUnsafePrintControlCharacters } from "./sanitize";

export const PRINT_CONTRACT_LIMITS = {
  dedupeKey: 300,
  businessName: 180,
  businessAddress: 600,
  businessWhatsapp: 40,
  customerName: 120,
  customerPhone: 40,
  customerAddress: 600,
  customerNote: 600,
  itemName: 180,
  itemCount: 50,
  quantity: 99,
} as const;

export type PrintContractValidationResult =
  | { ok: true; value: PrintContractV1 }
  | { ok: false; issues: string[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function checkText(
  issues: string[],
  path: string,
  value: unknown,
  options: {
    maxLength: number;
    nullable?: boolean;
    allowNewlines?: boolean;
  },
) {
  if (value === null && options.nullable) return;
  if (typeof value !== "string") {
    issues.push(`${path}: must be a string${options.nullable ? " or null" : ""}`);
    return;
  }
  if (!value.trim()) issues.push(`${path}: must not be blank`);
  if (value.length > options.maxLength) {
    issues.push(`${path}: exceeds ${options.maxLength} characters`);
  }
  if (
    hasUnsafePrintControlCharacters(value, {
      allowNewlines: options.allowNewlines,
    })
  ) {
    issues.push(`${path}: contains unsafe control characters`);
  }
}

function checkUuid(issues: string[], path: string, value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    issues.push(`${path}: must be a UUID`);
  }
}

function checkIsoDate(issues: string[], path: string, value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 35 ||
    !ISO_DATE_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    issues.push(`${path}: must be an ISO timestamp`);
  }
}

function checkMoney(issues: string[], path: string, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    issues.push(`${path}: must be a finite non-negative number`);
  }
}

export function validatePrintContractV1(
  value: unknown,
): PrintContractValidationResult {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: ["contract: must be an object"] };
  }

  if (value.schemaVersion !== 1) {
    issues.push("schemaVersion: must equal 1");
  }
  checkUuid(issues, "jobId", value.jobId);
  if (!isOneOf(value.jobType, PRINT_JOB_TYPES)) {
    issues.push("jobType: unsupported value");
  }
  checkIsoDate(issues, "createdAt", value.createdAt);
  checkIsoDate(issues, "expiresAt", value.expiresAt);
  if (
    typeof value.createdAt === "string" &&
    typeof value.expiresAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    Number.isFinite(Date.parse(value.expiresAt)) &&
    Date.parse(value.expiresAt) <= Date.parse(value.createdAt)
  ) {
    issues.push("expiresAt: must be later than createdAt");
  }
  checkText(issues, "dedupeKey", value.dedupeKey, {
    maxLength: PRINT_CONTRACT_LIMITS.dedupeKey,
  });

  if (!isRecord(value.receipt)) {
    issues.push("receipt: must be an object");
  } else {
    const receipt = value.receipt;
    checkUuid(issues, "receipt.orderId", receipt.orderId);
    checkText(issues, "receipt.businessName", receipt.businessName, {
      maxLength: PRINT_CONTRACT_LIMITS.businessName,
    });
    checkText(issues, "receipt.businessAddress", receipt.businessAddress, {
      maxLength: PRINT_CONTRACT_LIMITS.businessAddress,
      nullable: true,
      allowNewlines: true,
    });
    checkText(issues, "receipt.businessWhatsapp", receipt.businessWhatsapp, {
      maxLength: PRINT_CONTRACT_LIMITS.businessWhatsapp,
      nullable: true,
    });
    if (
      typeof receipt.orderNumber !== "number" ||
      !Number.isSafeInteger(receipt.orderNumber) ||
      receipt.orderNumber < 1
    ) {
      issues.push("receipt.orderNumber: must be a positive safe integer");
    }
    checkIsoDate(issues, "receipt.createdAt", receipt.createdAt);
    if (!isOneOf(receipt.status, RECEIPT_ORDER_STATUSES)) {
      issues.push("receipt.status: unsupported value");
    }
    if (!isOneOf(receipt.orderType, RECEIPT_ORDER_TYPES)) {
      issues.push("receipt.orderType: unsupported value");
    }
    if (
      receipt.paymentMethod !== null &&
      !isOneOf(receipt.paymentMethod, RECEIPT_PAYMENT_METHODS)
    ) {
      issues.push("receipt.paymentMethod: unsupported value");
    }

    if (!isRecord(receipt.customer)) {
      issues.push("receipt.customer: must be an object");
    } else {
      checkText(issues, "receipt.customer.name", receipt.customer.name, {
        maxLength: PRINT_CONTRACT_LIMITS.customerName,
      });
      checkText(issues, "receipt.customer.phone", receipt.customer.phone, {
        maxLength: PRINT_CONTRACT_LIMITS.customerPhone,
      });
      checkText(
        issues,
        "receipt.customer.address",
        receipt.customer.address,
        {
          maxLength: PRINT_CONTRACT_LIMITS.customerAddress,
          nullable: true,
          allowNewlines: true,
        },
      );
      checkText(issues, "receipt.customer.note", receipt.customer.note, {
        maxLength: PRINT_CONTRACT_LIMITS.customerNote,
        nullable: true,
        allowNewlines: true,
      });

      if (
        receipt.orderType === "delivery" &&
        (typeof receipt.customer.address !== "string" ||
          !receipt.customer.address.trim())
      ) {
        issues.push("receipt.customer.address: required for delivery");
      }
      if (
        receipt.orderType === "pickup" &&
        receipt.customer.address !== null
      ) {
        issues.push("receipt.customer.address: must be null for pickup");
      }
    }

    if (
      !Array.isArray(receipt.items) ||
      receipt.items.length < 1 ||
      receipt.items.length > PRINT_CONTRACT_LIMITS.itemCount
    ) {
      issues.push(
        `receipt.items: must contain 1-${PRINT_CONTRACT_LIMITS.itemCount} items`,
      );
    } else {
      receipt.items.forEach((item, index) => {
        const path = `receipt.items[${index}]`;
        if (!isRecord(item)) {
          issues.push(`${path}: must be an object`);
          return;
        }
        checkText(issues, `${path}.name`, item.name, {
          maxLength: PRINT_CONTRACT_LIMITS.itemName,
        });
        if (
          typeof item.quantity !== "number" ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > PRINT_CONTRACT_LIMITS.quantity
        ) {
          issues.push(
            `${path}.quantity: must be an integer between 1 and ${PRINT_CONTRACT_LIMITS.quantity}`,
          );
        }
        checkMoney(issues, `${path}.unitPrice`, item.unitPrice);
        checkMoney(issues, `${path}.lineTotal`, item.lineTotal);
      });
    }

    checkMoney(issues, "receipt.totalAmount", receipt.totalAmount);
    if (
      typeof receipt.currency !== "string" ||
      !CURRENCY_PATTERN.test(receipt.currency)
    ) {
      issues.push("receipt.currency: must be a three-letter uppercase code");
    }
  }

  if (!isRecord(value.printProfile)) {
    issues.push("printProfile: must be an object");
  } else {
    const profile = value.printProfile;
    if (profile.profileVersion !== 1) {
      issues.push("printProfile.profileVersion: must equal 1");
    }
    if (profile.mode !== "system") {
      issues.push("printProfile.mode: unsupported value");
    }
    if (profile.paperWidthMm !== 58 && profile.paperWidthMm !== 80) {
      issues.push("printProfile.paperWidthMm: must equal 58 or 80");
    }
    if (profile.copies !== 1) {
      issues.push("printProfile.copies: must equal 1");
    }
    if (profile.cutEnabled !== false) {
      issues.push("printProfile.cutEnabled: must be false");
    }
  }

  return issues.length
    ? { ok: false, issues }
    : { ok: true, value: value as PrintContractV1 };
}

export function isPrintContractV1(value: unknown): value is PrintContractV1 {
  return validatePrintContractV1(value).ok;
}
