export const PAYMENT_METHOD_MODES = [
  { value: "cash", label: "Yalnız nakit" },
  { value: "card", label: "Yalnız kart" },
  { value: "cash_or_card", label: "Nakit veya kart" },
] as const;

export type PaymentMethodMode = (typeof PAYMENT_METHOD_MODES)[number]["value"];

export const DEFAULT_PAYMENT_METHOD_MODE: PaymentMethodMode = "cash";

export const PAYMENT_METHODS = [
  { value: "cash", label: "Nakit", displayLabel: "Nakit" },
  { value: "card", label: "Kart", displayLabel: "Kart (fiziksel POS)" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

export function isPaymentMethodMode(value: unknown): value is PaymentMethodMode {
  return PAYMENT_METHOD_MODES.some((option) => option.value === value);
}

export function getPaymentMethodModeOrDefault(value: unknown): PaymentMethodMode {
  return isPaymentMethodMode(value) ? value : DEFAULT_PAYMENT_METHOD_MODE;
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return PAYMENT_METHODS.some((option) => option.value === value);
}

export function getInitialPaymentMethod(
  mode: PaymentMethodMode,
): PaymentMethod | "" {
  return mode === "cash_or_card" ? "" : mode;
}
