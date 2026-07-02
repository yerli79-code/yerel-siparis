import {
  fetchOrdersForBusiness,
  fetchOrderItemsForOrders,
  fetchBusinessesForUser,
  getBearerToken,
  getSingleUserBusiness,
  getSupabaseServerConfig,
  getUserFromToken,
  isOrderStatus,
  jsonError,
  mapOrder,
  type OrderStatus,
} from "./_utils";

export async function fetchBusinessOrdersForUser(request: Request) {
  let stage:
    | "config"
    | "auth"
    | "business_lookup"
    | "business_cardinality"
    | "orders"
    | "order_items" = "config";

  try {
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();

    stage = "auth";
    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return { response: jsonError("Oturum bulunamadi.", 401) };
    }

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return { response: jsonError("Gecersiz veya suresi dolmus oturum.", 401) };
    }

    const searchParams = new URL(request.url).searchParams;
    const status = searchParams.get("status");
    const requestedLimit = Number(searchParams.get("limit") || 50);
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 50;

    if (status && !isOrderStatus(status)) {
      return { response: jsonError("Siparis durumu gecersiz.", 400) };
    }

    stage = "business_lookup";
    const businesses = await fetchBusinessesForUser(
      url,
      serviceRoleKey,
      user.id,
    );

    stage = "business_cardinality";
    const business = getSingleUserBusiness(businesses);
    const orderStatus = status ? (status as OrderStatus) : undefined;

    stage = "orders";
    const orders = await fetchOrdersForBusiness(url, serviceRoleKey, business.id, {
      status: orderStatus,
      limit,
    });

    stage = "order_items";
    const orderItems = await fetchOrderItemsForOrders(
      url,
      serviceRoleKey,
      orders.map((order) => order.id),
    );
    const itemsByOrderId = new Map<string, typeof orderItems>();
    orderItems.forEach((item) => {
      itemsByOrderId.set(item.order_id, [
        ...(itemsByOrderId.get(item.order_id) ?? []),
        item,
      ]);
    });

    return {
      orders: orders.map((order) =>
        mapOrder(order, itemsByOrderId.get(order.id) ?? []),
      ),
    };
  } catch (error) {
    console.error("business_orders_read_failed", {
      stage,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { response: jsonError("Siparisler alinamadi.", 400) };
  }
}
