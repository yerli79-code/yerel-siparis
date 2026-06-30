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
  jsonError,
  mapOrder,
  updateOrderStatusById,
} from "../_utils";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { orderId } = await context.params;
    if (!UUID_PATTERN.test(orderId)) {
      return jsonError("Gecersiz orderId.", 400);
    }

    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const accessToken = getBearerToken(request);
    if (!accessToken) {
      return jsonError("Oturum bulunamadi.", 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Gecersiz istek govdesi.", 400);
    }
    if (!isPlainObject(body) || Object.keys(body).some((key) => key !== "status")) {
      return jsonError("Yalniz siparis durumu guncellenebilir.", 400);
    }
    if (!isOrderStatus(body.status)) {
      return jsonError("Siparis durumu gecersiz.", 400);
    }

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return jsonError("Gecersiz veya suresi dolmus oturum.", 401);
    }

    const business = getSingleUserBusiness(
      await fetchBusinessesForUser(url, serviceRoleKey, user.id),
    );
    const existingOrder = await fetchOrderById(url, serviceRoleKey, orderId);
    if (!existingOrder || existingOrder.business_id !== business.id) {
      return jsonError("Siparis bulunamadi.", 404);
    }
    if (!isBusinessOperational(business)) {
      return jsonError(
        "Abonelik aktif olmadigi icin siparis durumu guncellenemez.",
        403,
      );
    }

    const updatedOrder = await updateOrderStatusById(
      url,
      serviceRoleKey,
      existingOrder.id,
      business.id,
      body.status,
    );
    const items = await fetchOrderItemsForOrders(url, serviceRoleKey, [
      updatedOrder.id,
    ]);

    return NextResponse.json({ order: mapOrder(updatedOrder, items) });
  } catch {
    return jsonError("Siparis durumu guncellenemedi.", 400);
  }
}
