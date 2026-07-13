import { NextResponse } from "next/server";
import { isPaymentMethod } from "../../../../lib/payment-methods";
import {
  OrderRpcError,
  UUID_PATTERN,
  createOrderWithItemsRpc,
  getSupabaseServerConfig,
  isOrderType,
  isPlainObject,
  jsonError,
} from "../../business/orders/_utils";

type NormalizedItem = {
  productId: string;
  quantity: number;
};

class PublicOrderValidationError extends Error {}

function publicOrderError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
) {
  const allowed = new Set(allowedKeys);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new PublicOrderValidationError("Istek bilgileri gecersiz.");
  }
}

function readText(
  value: unknown,
  options: { label: string; maxLength: number; required?: boolean },
) {
  if (value === undefined && !options.required) return "";
  if (typeof value !== "string") {
    throw new PublicOrderValidationError(`${options.label} gecersiz.`);
  }

  const trimmed = value.trim();
  if (options.required && !trimmed) {
    throw new PublicOrderValidationError(`${options.label} zorunludur.`);
  }
  if (trimmed.length > options.maxLength) {
    throw new PublicOrderValidationError(
      `${options.label} en fazla ${options.maxLength} karakter olabilir.`,
    );
  }

  return trimmed;
}

function parseItems(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new PublicOrderValidationError(
      "Siparis icin 1 ile 50 arasinda urun satiri gonderilmelidir.",
    );
  }

  const quantities = new Map<string, number>();
  value.forEach((item) => {
    if (!isPlainObject(item)) {
      throw new PublicOrderValidationError("Siparis urunleri gecersiz.");
    }
    assertOnlyKeys(item, ["productId", "quantity"]);

    if (
      typeof item.productId !== "string" ||
      !UUID_PATTERN.test(item.productId.trim())
    ) {
      throw new PublicOrderValidationError("Siparis urunleri gecersiz.");
    }
    if (
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 99
    ) {
      throw new PublicOrderValidationError(
        "Urun adedi 1 ile 99 arasinda olmalidir.",
      );
    }

    const productId = item.productId.trim();
    const nextQuantity = (quantities.get(productId) ?? 0) + item.quantity;
    if (nextQuantity > 99) {
      throw new PublicOrderValidationError(
        "Urun adedi 1 ile 99 arasinda olmalidir.",
      );
    }
    quantities.set(productId, nextQuantity);
  });

  return Array.from(quantities.entries())
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((first, second) => first.productId.localeCompare(second.productId));
}

export async function POST(request: Request) {
  try {
    const { url, serviceRoleKey } = getSupabaseServerConfig();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Gecersiz istek govdesi.", 400);
    }
    if (!isPlainObject(body)) {
      return jsonError("Gecersiz istek govdesi.", 400);
    }
    assertOnlyKeys(body, [
      "businessSlug",
      "orderType",
      "paymentMethod",
      "customer",
      "items",
      "idempotencyKey",
    ]);

    const businessSlug = readText(body.businessSlug, {
      label: "Isletme bilgisi",
      maxLength: 140,
      required: true,
    });
    if (!isOrderType(body.orderType)) {
      return jsonError("Siparis turu gecersiz.", 400);
    }
    const orderType = body.orderType;
    if (!isPaymentMethod(body.paymentMethod)) {
      return jsonError("Odeme yontemi gecersiz.", 400);
    }
    const paymentMethod = body.paymentMethod;

    if (!isPlainObject(body.customer)) {
      return jsonError("Musteri bilgileri eksik.", 400);
    }
    assertOnlyKeys(body.customer, ["fullName", "phone", "address", "note"]);

    const customerName = readText(body.customer.fullName, {
      label: "Ad Soyad",
      maxLength: 120,
      required: true,
    });
    const customerPhone = readText(body.customer.phone, {
      label: "Telefon",
      maxLength: 40,
      required: true,
    });
    const customerAddress =
      orderType === "delivery"
        ? readText(body.customer.address, {
            label: "Teslimat adresi",
            maxLength: 600,
            required: true,
          })
        : null;
    const customerNote = readText(body.customer.note, {
      label: "Siparis notu",
      maxLength: 600,
    });

    if (
      typeof body.idempotencyKey !== "string" ||
      !UUID_PATTERN.test(body.idempotencyKey.trim())
    ) {
      return jsonError("Siparis deneme anahtari gecersiz.", 400);
    }
    const idempotencyKey = body.idempotencyKey.trim();
    const items = parseItems(body.items);

    const order = await createOrderWithItemsRpc(url, serviceRoleKey, {
      p_business_slug: businessSlug,
      p_order_type: orderType,
      p_customer_name: customerName,
      p_customer_phone: customerPhone,
      p_customer_address: customerAddress,
      p_customer_note: customerNote || null,
      p_items: items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
      p_idempotency_key: idempotencyKey,
      p_payment_method: paymentMethod,
    });

    return NextResponse.json({
      orderNumber: Number(order.order_number),
      totalAmount: Number(order.total_amount),
      orderType: order.order_type,
    });
  } catch (error) {
    if (error instanceof OrderRpcError) {
      if (error.reason === "idempotency_conflict") {
        return publicOrderError(
          "Ayni siparis denemesi farkli bilgilerle tekrar kullanilamaz.",
          "IDEMPOTENCY_CONFLICT",
          409,
        );
      }
      if (
        error.reason === "business_not_found" ||
        error.reason === "products_not_available"
      ) {
        return publicOrderError(
          "Isletme veya siparis urunleri artik bulunamiyor.",
          "ORDER_RESOURCE_NOT_FOUND",
          404,
        );
      }
      if (error.reason === "business_not_available") {
        return publicOrderError(
          "Isletme su anda siparis alamiyor.",
          "BUSINESS_NOT_AVAILABLE",
          403,
        );
      }
      if (error.reason === "payment_method_not_available") {
        return publicOrderError(
          "Seçilen ödeme yöntemi bu işletmede kullanılamıyor. Lütfen ödeme yöntemini kontrol edin.",
          "PAYMENT_METHOD_NOT_AVAILABLE",
          400,
        );
      }
      if (error.reason === "validation") {
        return publicOrderError(
          "Siparis bilgileri gecersiz veya minimum siparis kosulu saglanmiyor.",
          "ORDER_VALIDATION_FAILED",
          400,
        );
      }

      return publicOrderError(
        "Siparis sonucu su anda dogrulanamadi.",
        "ORDER_RESULT_UNCERTAIN",
        500,
      );
    }
    if (error instanceof PublicOrderValidationError) {
      return publicOrderError(error.message, "ORDER_VALIDATION_FAILED", 400);
    }
    return publicOrderError(
      "Siparis sonucu su anda dogrulanamadi.",
      "ORDER_RESULT_UNCERTAIN",
      500,
    );
  }
}
