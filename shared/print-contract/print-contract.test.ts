import assert from "node:assert/strict";
import { test } from "node:test";
import {
  printContractV1Fixture,
  printContractV1InputFixture,
} from "./fixtures";
import {
  canonicalizePrintContract,
  hashPrintContract,
} from "./hash";
import { materializePrintContractV1 } from "./materialize";
import { sanitizePrintText } from "./sanitize";
import type { PrintContractV1 } from "./types";
import {
  PRINT_CONTRACT_LIMITS,
  validatePrintContractV1,
} from "./validate";

function cloneFixture(): PrintContractV1 {
  return structuredClone(printContractV1Fixture);
}

function assertInvalid(value: unknown, issuePattern?: RegExp) {
  const result = validatePrintContractV1(value);
  assert.equal(result.ok, false);
  if (!result.ok && issuePattern) {
    assert.match(result.issues.join("\n"), issuePattern);
  }
}

test("schemaVersion 1 contract is valid", () => {
  assert.equal(validatePrintContractV1(cloneFixture()).ok, true);
});

test("58 mm paper profile is valid", () => {
  const value = cloneFixture();
  value.printProfile.paperWidthMm = 58;
  assert.equal(validatePrintContractV1(value).ok, true);
});

test("80 mm paper profile is valid", () => {
  assert.equal(printContractV1Fixture.printProfile.paperWidthMm, 80);
  assert.equal(validatePrintContractV1(cloneFixture()).ok, true);
});

test("copies 1 is valid and other copy counts are rejected", () => {
  const value = cloneFixture();
  (value.printProfile as { copies: number }).copies = 2;
  assertInvalid(value, /printProfile\.copies/);
});

test("unsupported paper width is invalid", () => {
  const value = cloneFixture();
  (value.printProfile as { paperWidthMm: number }).paperWidthMm = 76;
  assertInvalid(value, /printProfile\.paperWidthMm/);
});

test("unsupported print mode is invalid", () => {
  const value = cloneFixture();
  (value.printProfile as { mode: string }).mode = "escpos";
  assertInvalid(value, /printProfile\.mode/);
});

test("negative monetary values are invalid", () => {
  const value = cloneFixture();
  value.receipt.items[0].unitPrice = -1;
  assertInvalid(value, /unitPrice/);
});

test("NaN and Infinity monetary values are invalid", () => {
  const nanValue = cloneFixture();
  nanValue.receipt.totalAmount = Number.NaN;
  assertInvalid(nanValue, /totalAmount/);

  const infinityValue = cloneFixture();
  infinityValue.receipt.items[0].lineTotal = Number.POSITIVE_INFINITY;
  assertInvalid(infinityValue, /lineTotal/);
});

test("quantity zero is invalid", () => {
  const value = cloneFixture();
  value.receipt.items[0].quantity = 0;
  assertInvalid(value, /quantity/);
});

test("missing required keys are invalid", () => {
  const value = cloneFixture() as Partial<PrintContractV1>;
  delete value.receipt;
  assertInvalid(value, /receipt/);
});

test("unknown additive fields are tolerated within schema version 1", () => {
  const value = cloneFixture() as PrintContractV1 & {
    futureOptional?: { label: string };
  };
  value.futureOptional = { label: "future" };
  assert.equal(validatePrintContractV1(value).ok, true);
});

test("control characters are removed by sanitizer and rejected by validator", () => {
  assert.equal(
    sanitizePrintText("A\u0000B\u001bC\u001dD\u0085E"),
    "ABCDE",
  );
  assert.equal(
    sanitizePrintText("Satır 1\r\nSatır\t2", { allowNewlines: true }),
    "Satır 1\nSatır2",
  );

  const value = cloneFixture();
  value.receipt.customer.name = "Müşteri\u001b";
  assertInvalid(value, /unsafe control/);
});

test("overlong customer name is invalid", () => {
  const value = cloneFixture();
  value.receipt.customer.name = "a".repeat(
    PRINT_CONTRACT_LIMITS.customerName + 1,
  );
  assertInvalid(value, /customer\.name/);
});

test("overlong note is invalid", () => {
  const value = cloneFixture();
  value.receipt.customer.note = "n".repeat(
    PRINT_CONTRACT_LIMITS.customerNote + 1,
  );
  assertInvalid(value, /customer\.note/);
});

test("item count is bounded", () => {
  const value = cloneFixture();
  value.receipt.items = Array.from(
    { length: PRINT_CONTRACT_LIMITS.itemCount + 1 },
    () => structuredClone(value.receipt.items[0]),
  );
  assertInvalid(value, /receipt\.items/);
});

test("materializer is deterministic and locale independent", () => {
  const first = materializePrintContractV1(
    structuredClone(printContractV1InputFixture),
  );
  const second = materializePrintContractV1(
    structuredClone(printContractV1InputFixture),
  );
  assert.deepEqual(first, second);
  assert.equal(first.receipt.totalAmount, 240.5);
  assert.equal(first.receipt.items[0].unitPrice, 120.25);
});

test("canonical serialization and SHA-256 hash are deterministic", async () => {
  const original = cloneFixture();
  const reordered = {
    printProfile: original.printProfile,
    receipt: original.receipt,
    dedupeKey: original.dedupeKey,
    expiresAt: original.expiresAt,
    createdAt: original.createdAt,
    jobType: original.jobType,
    jobId: original.jobId,
    schemaVersion: original.schemaVersion,
  } as PrintContractV1;

  assert.equal(
    canonicalizePrintContract(original),
    canonicalizePrintContract(reordered),
  );
  const firstHash = await hashPrintContract(original);
  const secondHash = await hashPrintContract(reordered);
  assert.equal(firstHash, secondHash);
  assert.match(firstHash, /^[0-9a-f]{64}$/);
});

test("Turkish printable characters are preserved", () => {
  const value = materializePrintContractV1(
    structuredClone(printContractV1InputFixture),
  );
  assert.equal(value.receipt.businessName, "İstanbul Sofrası");
  assert.equal(value.receipt.customer.name, "Çağla Öztürk");
  assert.equal(value.receipt.customer.note, "Soğansız hazırlayın.");
});

test("delivery requires an address", () => {
  const value = cloneFixture();
  value.receipt.customer.address = null;
  assertInvalid(value, /required for delivery/);
});

test("pickup requires a null address", () => {
  const validPickup = cloneFixture();
  validPickup.receipt.orderType = "pickup";
  validPickup.receipt.customer.address = null;
  assert.equal(validatePrintContractV1(validPickup).ok, true);

  validPickup.receipt.customer.address = "Adres";
  assertInvalid(validPickup, /must be null for pickup/);
});

test("order, payment, status, and job enums are validated", () => {
  const orderType = cloneFixture();
  (orderType.receipt as { orderType: string }).orderType = "table";
  assertInvalid(orderType, /orderType/);

  const payment = cloneFixture();
  (payment.receipt as { paymentMethod: string }).paymentMethod = "crypto";
  assertInvalid(payment, /paymentMethod/);

  const status = cloneFixture();
  (status.receipt as { status: string }).status = "deleted";
  assertInvalid(status, /status/);

  const job = cloneFixture();
  (job as { jobType: string }).jobType = "manual";
  assertInvalid(job, /jobType/);
});

test("validation, materialization, and hashing emit no PII logs", async () => {
  const messages: unknown[][] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args: unknown[]) => messages.push(args);
  console.warn = (...args: unknown[]) => messages.push(args);
  console.error = (...args: unknown[]) => messages.push(args);
  try {
    const value = materializePrintContractV1(
      structuredClone(printContractV1InputFixture),
    );
    validatePrintContractV1(value);
    await hashPrintContract(value);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.deepEqual(messages, []);
});
