import type { PrintContractV1 } from "./types";

function canonicalizeValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON only supports finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError("Canonical JSON only supports JSON values.");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Canonical JSON does not support cyclic values.");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((item) => canonicalizeValue(item, ancestors))
        .join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON only supports plain objects.");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeValue(record[key], ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Recursive lexicographic key ordering for the contract's JSON value subset. */
export function canonicalizePrintContract(contract: PrintContractV1) {
  return canonicalizeValue(contract, new Set<object>());
}

export async function hashPrintContract(contract: PrintContractV1) {
  const bytes = new TextEncoder().encode(canonicalizePrintContract(contract));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
