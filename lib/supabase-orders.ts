import type { PaymentMethod } from "./payment-methods";

export type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export type OrderType = "delivery" | "pickup";

export type PublicOrderItemInput = {
  productId: string;
  quantity: number;
};

export type PublicOrderCustomerInput = {
  fullName: string;
  phone: string;
  address: string | null;
  note: string;
};

export type PublicOrderCreateInput = {
  businessSlug: string;
  orderType: OrderType;
  paymentMethod: PaymentMethod;
  customer: PublicOrderCustomerInput;
  items: PublicOrderItemInput[];
  idempotencyKey: string;
};

export type PublicOrderCreateResult = {
  orderNumber: number;
  totalAmount: number;
  orderType: OrderType;
};

export type PublicOrderErrorKind = "definitive" | "uncertain";

export class PublicOrderRequestError extends Error {
  kind: PublicOrderErrorKind;
  code: string;
  status: number | null;

  constructor(
    kind: PublicOrderErrorKind,
    code: string,
    status: number | null = null,
  ) {
    super(
      kind === "uncertain"
        ? "Siparis sonucu dogrulanamadi."
        : "Siparis istegi tamamlanamadi.",
    );
    this.name = "PublicOrderRequestError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export type BusinessOrderItem = {
  id: string;
  productId: string | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type BusinessOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  orderType: OrderType;
  paymentMethod: PaymentMethod | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  customerNote: string | null;
  totalAmount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  items: BusinessOrderItem[];
};

const publicOrderTimeoutMs = 20000;

async function parsePublicOrderResponse(response: Response) {
  let body: unknown = null;
  try {
    const text = await response.text();
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    if ([400, 403, 404, 409].includes(response.status)) {
      throw new PublicOrderRequestError(
        "definitive",
        response.status === 409
          ? "IDEMPOTENCY_CONFLICT"
          : `HTTP_${response.status}`,
        response.status,
      );
    }
    throw new PublicOrderRequestError(
      "uncertain",
      "INVALID_SERVER_RESPONSE",
      response.status,
    );
  }

  if (!response.ok) {
    const errorBody =
      body && typeof body === "object"
        ? (body as { code?: unknown })
        : null;
    const code =
      response.status === 409
        ? "IDEMPOTENCY_CONFLICT"
        : typeof errorBody?.code === "string"
        ? errorBody.code
        : `HTTP_${response.status}`;
    throw new PublicOrderRequestError(
      response.status >= 500 ? "uncertain" : "definitive",
      code,
      response.status,
    );
  }

  if (
    !body ||
    typeof body !== "object" ||
    !Number.isFinite(Number((body as PublicOrderCreateResult).orderNumber)) ||
    !Number.isFinite(Number((body as PublicOrderCreateResult).totalAmount)) ||
    !["delivery", "pickup"].includes(
      String((body as PublicOrderCreateResult).orderType),
    )
  ) {
    throw new PublicOrderRequestError(
      "uncertain",
      "INVALID_SERVER_RESPONSE",
      response.status,
    );
  }

  return body as PublicOrderCreateResult;
}

async function parseApiResponse(response: Response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const errorBody = body as { error?: string; message?: string } | null;
    throw new Error(
      errorBody?.error || errorBody?.message || "Istek tamamlanamadi.",
    );
  }

  return body;
}

export async function createPublicOrder(input: PublicOrderCreateInput) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    publicOrderTimeoutMs,
  );

  try {
    const response = await fetch("/api/public/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    return await parsePublicOrderResponse(response);
  } catch (error) {
    if (error instanceof PublicOrderRequestError) throw error;
    throw new PublicOrderRequestError(
      "uncertain",
      error instanceof DOMException && error.name === "AbortError"
        ? "REQUEST_TIMEOUT"
        : "NETWORK_ERROR",
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchBusinessOrders(
  accessToken: string,
  status?: OrderStatus,
) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);

  const response = await fetch(
    `/api/business/orders${params.toString() ? `?${params}` : ""}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const body = (await parseApiResponse(response)) as { orders?: BusinessOrder[] };

  return Array.isArray(body.orders) ? body.orders : [];
}

export async function updateBusinessOrderStatus(
  orderId: string,
  status: OrderStatus,
  accessToken: string,
) {
  const response = await fetch(`/api/business/orders/${orderId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
  const body = (await parseApiResponse(response)) as { order?: BusinessOrder };

  if (!body.order) {
    throw new Error("Siparis guncellendi ancak kayit bilgisi donmedi.");
  }

  return body.order;
}
