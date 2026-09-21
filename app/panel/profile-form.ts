import {
  isPaymentMethodMode,
  type PaymentMethodMode,
} from "../../lib/payment-methods";
import type {
  BusinessPanelBusiness,
  BusinessProfileInput,
} from "../../lib/supabase-business";
import {
  getDisplayDeliveryStatus,
  normalizeDeliveryStatus,
} from "../../lib/delivery-settings";

export type ProfileForm = {
  name: string;
  description: string;
  whatsappOrderNumber: string;
  city: string;
  district: string;
  neighborhood: string;
  address: string;
  deliveryStatus: string;
  paymentMethodMode: PaymentMethodMode;
  minimumOrderAmount: string;
  preparationTimeMinutes: string;
  isOpen: boolean;
  orderNote: string;
  serviceRadiusKm: string;
  logoUrl: string;
  coverImageUrl: string;
};

export function toProfileForm(business: BusinessPanelBusiness): ProfileForm {
  return {
    name: business.name,
    description: business.description,
    whatsappOrderNumber: business.whatsappOrderNumber,
    city: business.city ?? "",
    district: business.district,
    neighborhood: business.neighborhood,
    address: business.address,
    deliveryStatus: getDisplayDeliveryStatus(business.deliveryStatus),
    paymentMethodMode: business.paymentMethodMode,
    minimumOrderAmount:
      typeof business.minimumOrderAmount === "number"
        ? String(business.minimumOrderAmount)
        : "",
    preparationTimeMinutes:
      typeof business.preparationTimeMinutes === "number"
        ? String(business.preparationTimeMinutes)
        : "",
    isOpen: business.isOpen ?? true,
    orderNote: business.orderNote ?? "",
    serviceRadiusKm:
      typeof business.serviceRadiusKm === "number"
        ? String(business.serviceRadiusKm)
        : "",
    logoUrl: business.logoUrl ?? "",
    coverImageUrl: business.coverImageUrl ?? "",
  };
}

export function toProfileInput(form: ProfileForm): BusinessProfileInput {
  const radius = form.serviceRadiusKm.trim()
    ? Number(form.serviceRadiusKm)
    : null;
  const minimumOrderAmount = form.minimumOrderAmount.trim()
    ? Number(form.minimumOrderAmount)
    : null;
  const preparationTimeMinutes = form.preparationTimeMinutes.trim()
    ? Number(form.preparationTimeMinutes)
    : null;

  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    whatsappOrderNumber: form.whatsappOrderNumber.trim() || null,
    city: form.city.trim() || null,
    district: form.district.trim() || null,
    neighborhood: form.neighborhood.trim() || null,
    address: form.address.trim() || null,
    deliveryStatus: normalizeDeliveryStatus(form.deliveryStatus),
    paymentMethodMode: form.paymentMethodMode,
    minimumOrderAmount,
    preparationTimeMinutes,
    isOpen: form.isOpen,
    orderNote: form.orderNote.trim() || null,
    serviceRadiusKm: radius,
    logoUrl: form.logoUrl.trim() || null,
    coverImageUrl: form.coverImageUrl.trim() || null,
  };
}

export function validateProfileForm(form: ProfileForm): string {
  const radius = form.serviceRadiusKm.trim()
    ? Number(form.serviceRadiusKm)
    : null;
  const minimumOrderAmount = form.minimumOrderAmount.trim()
    ? Number(form.minimumOrderAmount)
    : null;
  const preparationTimeMinutes = form.preparationTimeMinutes.trim()
    ? Number(form.preparationTimeMinutes)
    : null;

  const trimmedName = form.name.trim();
  if (!trimmedName) return "İşletme adı boş olamaz.";
  if (trimmedName.length > 120) {
    return "İşletme adı en fazla 120 karakter olabilir.";
  }

  const trimmedWhatsApp = form.whatsappOrderNumber.trim();
  if (trimmedWhatsApp.length > 30) {
    return "WhatsApp sipariş numarası en fazla 30 karakter olabilir.";
  }

  if (!isPaymentMethodMode(form.paymentMethodMode)) {
    return "Lütfen geçerli bir ödeme kabul yöntemi seçin.";
  }
  if (radius !== null && (!Number.isFinite(radius) || radius < 0)) {
    return "Servis yarıçapı geçerli bir sayı olmalıdır.";
  }
  if (
    minimumOrderAmount !== null &&
    (!Number.isFinite(minimumOrderAmount) || minimumOrderAmount < 0)
  ) {
    return "Minimum sipariş tutarı 0 veya daha büyük bir sayı olmalıdır.";
  }
  if (
    preparationTimeMinutes !== null &&
    (!Number.isInteger(preparationTimeMinutes) ||
      preparationTimeMinutes < 1 ||
      preparationTimeMinutes > 720)
  ) {
    return "Tahmini hazırlık süresi 1 ile 720 dakika arasında tam sayı olmalıdır.";
  }
  if (form.deliveryStatus.trim().length > 120) {
    return "Teslimat / gel-al bilgisi en fazla 120 karakter olabilir.";
  }
  if (form.orderNote.trim().length > 300) {
    return "Kısa sipariş notu en fazla 300 karakter olabilir.";
  }
  return "";
}
