import { NextResponse } from "next/server";
import {
  UUID_PATTERN,
  fetchBusinessesForUser,
  fetchOrderById,
  fetchOrderItemsForOrders,
  getBearerToken,
  getSingleUserBusiness,
  getSupabaseServerConfig,
  getUserFromToken,
  isBusinessOperational,
  isOrderStatus,
  isPlainObject,
  mapOrder,
  updateOrderStatusById,
} from "../_utils";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

const privateMutationHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization",
};

type OrderMutationErrorCode =
  | "INVALID_ORDER_MUTATION"
  | "ORDER_UNAUTHORIZED"
  | "ORDER_FORBIDDEN"
  | "ORDER_NOT_FOUND"
  | "ORDER_CONFLICT"
  | "ORDER_UNAVAILABLE";

function mutationJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: privateMutationHeaders,
  });
}

function mutationError(code: OrderMutationErrorCode, status: number) {
  return mutationJson({ code }, status);
}

export function isValidOrderMutationTimestamp(value: unknown) {
  if (typeof value !== "string" || value !== value.trim()) return false;

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));

  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    Number.isFinite(new Date(value).getTime())
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  let stage:
    | "params"
    | "config"
    | "request"
    | "auth"
    | "business"
    | "ownership"
    | "mutation"
    | "items" = "params";

  try {
    const { orderId } = await context.params;
    if (!UUID_PATTERN.test(orderId)) {
      return mutationError("INVALID_ORDER_MUTATION", 400);
    }

    stage = "config";
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const accessToken = getBearerToken(request);
    if (!accessToken) {
      return mutationError("ORDER_UNAUTHORIZED", 401);
    }

    stage = "request";
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return mutationError("INVALID_ORDER_MUTATION", 400);
    }
    if (
      !isPlainObject(body) ||
      Object.keys(body).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(body, "status") ||
      !Object.prototype.hasOwnProperty.call(body, "expectedUpdatedAt")
    ) {
      return mutationError("INVALID_ORDER_MUTATION", 400);
    }
    if (
      !isOrderStatus(body.status) ||
      !isValidOrderMutationTimestamp(body.expectedUpdatedAt)
    ) {
      return mutationError("INVALID_ORDER_MUTATION", 400);
    }

    stage = "auth";
    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return mutationError("ORDER_UNAUTHORIZED", 401);
    }

    stage = "business";
    const business = getSingleUserBusiness(
      await fetchBusinessesForUser(url, serviceRoleKey, user.id),
    );

    stage = "ownership";
    const existingOrder = await fetchOrderById(url, serviceRoleKey, orderId);
    if (!existingOrder || existingOrder.business_id !== business.id) {
      return mutationError("ORDER_NOT_FOUND", 404);
    }
    if (!isBusinessOperational(business)) {
      return mutationError("ORDER_FORBIDDEN", 403);
    }
    if (existingOrder.updated_at !== body.expectedUpdatedAt) {
      return mutationError("ORDER_CONFLICT", 409);
    }

    if (existingOrder.status === body.status) {
      stage = "items";
      const items = await fetchOrderItemsForOrders(url, serviceRoleKey, [
        existingOrder.id,
      ]);
      return mutationJson({ order: mapOrder(existingOrder, items) });
    }

    stage = "mutation";
    const updatedOrder = await updateOrderStatusById(
      url,
      serviceRoleKey,
      existingOrder.id,
      business.id,
      body.status,
      body.expectedUpdatedAt,
    );
    if (!updatedOrder) {
      return mutationError("ORDER_CONFLICT", 409);
    }

    stage = "items";
    const items = await fetchOrderItemsForOrders(url, serviceRoleKey, [
      updatedOrder.id,
    ]);

    return mutationJson({ order: mapOrder(updatedOrder, items) });
  } catch (error) {
    console.error("business_order_status_update_failed", {
      stage,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return mutationError("ORDER_UNAVAILABLE", 503);
  }
}
