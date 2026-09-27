import http from "node:http";
import { URL } from "node:url";
import {
  createInitialFixtures,
  FIXTURE_ACCESS_TOKEN,
  FIXTURE_BUSINESS_ID,
  FIXTURE_REFRESH_TOKEN,
  FIXTURE_USER_EMAIL,
  FIXTURE_USER_ID,
  FIXTURE_USER_PASSWORD,
  type FixtureBusiness,
  type FixtureOrder,
  type FixtureOrderItem,
  type FixtureProduct,
} from "./fixtures";

export type MockServerState = {
  user: ReturnType<typeof createInitialFixtures>["user"];
  business: FixtureBusiness;
  products: FixtureProduct[];
  orders: FixtureOrder[];
  orderItems: FixtureOrderItem[];
};

export type MockSupabaseServerInstance = {
  server: http.Server;
  port: number;
  host: string;
  baseUrl: string;
  getState: () => MockServerState;
  resetState: () => void;
  close: () => Promise<void>;
};

// 1x1 transparent PNG buffer for mock image serving
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createMockSupabaseServer(requestedPort = 0): Promise<MockSupabaseServerInstance> {
  let state = deepClone(createInitialFixtures());

  // Resettable deterministic counters for synthetic UUIDs
  let nextProductCounter = 9001;
  let nextOrderCounter = 8001;
  const recordedRequests: Array<{ method: string; pathname: string; url: string; timestamp: number }> = [];

  function generateProductId(): string {
    const id = `00000000-0000-4000-8000-${String(nextProductCounter).padStart(12, "0")}`;
    nextProductCounter += 1;
    return id;
  }

  function generateOrderId(): string {
    const id = `00000000-0000-4000-8000-${String(nextOrderCounter).padStart(12, "0")}`;
    nextOrderCounter += 1;
    return id;
  }

  function resetState() {
    state = deepClone(createInitialFixtures());
    nextProductCounter = 9001;
    nextOrderCounter = 8001;
    recordedRequests.length = 0;
  }

  function getState() {
    return state;
  }

  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url || "/";
    const hostHeader = req.headers.host || "127.0.0.1";
    const parsedUrl = new URL(rawUrl, `http://${hostHeader}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase() || "GET";

    if (!pathname.startsWith("/__e2e/")) {
      recordedRequests.push({ method, pathname, url: rawUrl, timestamp: Date.now() });
    }

    // Set standard CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, apikey, Prefer, Range, x-client-info",
    );
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Range");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Helper to read JSON body
    async function readBody<T = unknown>(): Promise<T | null> {
      return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          if (chunks.length === 0) {
            resolve(null);
            return;
          }
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(raw) as T);
          } catch {
            resolve(null);
          }
        });
        req.on("error", () => resolve(null));
      });
    }

    function sendJson(status: number, data: unknown, extraHeaders: Record<string, string> = {}) {
      const payload = JSON.stringify(data);
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
        ...extraHeaders,
      });
      res.end(payload);
    }

    // ==========================================
    // TEST-ONLY CONTROL ROUTES
    // ==========================================
    if (pathname === "/__e2e/health" && method === "GET") {
      sendJson(200, { ok: true, timestamp: Date.now() });
      return;
    }

    if (pathname === "/__e2e/reset" && method === "POST") {
      resetState();
      sendJson(200, { reset: true, timestamp: Date.now() });
      return;
    }

    if (pathname === "/__e2e/state" && method === "GET") {
      sendJson(200, {
        business: state.business,
        productsCount: state.products.length,
        ordersCount: state.orders.length,
        orderItemsCount: state.orderItems.length,
      });
      return;
    }

    if (pathname === "/__e2e/requests" && method === "GET") {
      sendJson(200, { requests: [...recordedRequests] });
      return;
    }

    if (pathname === "/__e2e/inject-order" && method === "POST") {
      const body = await readBody<Partial<FixtureOrder>>();
      const nextNumber = state.orders.length + 101;
      const newOrder: FixtureOrder = {
        id: generateOrderId(),
        order_number: nextNumber,
        business_order_number: nextNumber,
        business_id: FIXTURE_BUSINESS_ID,
        status: body?.status || "new",
        order_type: body?.order_type || "pickup",
        payment_method: body?.payment_method || "cash",
        customer_name: body?.customer_name || "Yeni Müşteri",
        customer_phone: body?.customer_phone || "05550009988",
        customer_address: body?.customer_address || null,
        customer_note: body?.customer_note || "Hızlı teslimat",
        total_amount: body?.total_amount || 180,
        currency: "TRY",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.orders.unshift(newOrder);
      sendJson(201, { order: newOrder });
      return;
    }

    // ==========================================
    // SUPABASE AUTH ENDPOINTS
    // ==========================================
    if (pathname === "/auth/v1/token") {
      const grantType = parsedUrl.searchParams.get("grant_type");
      const body = await readBody<{ email?: string; password?: string; refresh_token?: string }>();

      if (grantType === "password") {
        if (
          body?.email?.trim().toLowerCase() === FIXTURE_USER_EMAIL.toLowerCase() &&
          body?.password === FIXTURE_USER_PASSWORD
        ) {
          const nowSeconds = Math.floor(Date.now() / 1000);
          sendJson(200, {
            access_token: FIXTURE_ACCESS_TOKEN,
            token_type: "bearer",
            expires_in: 3600,
            expires_at: nowSeconds + 3600,
            refresh_token: FIXTURE_REFRESH_TOKEN,
            user: state.user,
          });
          return;
        }

        sendJson(400, {
          error: "invalid_grant",
          error_description: "Invalid login credentials",
        });
        return;
      }

      if (grantType === "refresh_token") {
        if (body?.refresh_token === FIXTURE_REFRESH_TOKEN) {
          const nowSeconds = Math.floor(Date.now() / 1000);
          sendJson(200, {
            access_token: FIXTURE_ACCESS_TOKEN,
            token_type: "bearer",
            expires_in: 3600,
            expires_at: nowSeconds + 3600,
            refresh_token: FIXTURE_REFRESH_TOKEN,
            user: state.user,
          });
          return;
        }

        sendJson(400, {
          error: "invalid_grant",
          error_description: "Invalid refresh token",
        });
        return;
      }

      sendJson(400, { error: "unsupported_grant_type" });
      return;
    }

    if (pathname === "/auth/v1/user") {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace(/^Bearer\s+/i, "").trim();

      if (token === FIXTURE_ACCESS_TOKEN) {
        sendJson(200, state.user);
        return;
      }

      sendJson(401, { message: "Invalid JWT token" });
      return;
    }

    // ==========================================
    // SUPABASE STORAGE ENDPOINTS
    // ==========================================
    if (pathname.startsWith("/storage/v1/object/public/")) {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": TRANSPARENT_PNG.length,
        "Cache-Control": "public, max-age=3600",
      });
      res.end(TRANSPARENT_PNG);
      return;
    }

    if (pathname.startsWith("/storage/v1/object/") && method === "POST") {
      const subpath = pathname.replace("/storage/v1/object/", "");
      sendJson(200, { Key: subpath, Id: subpath });
      return;
    }

    // ==========================================
    // POSTGREST REST ENDPOINTS
    // ==========================================

    // --- BUSINESSES ---
    if (pathname === "/rest/v1/businesses") {
      if (method === "GET") {
        const ownerId = parsedUrl.searchParams.get("owner_id");
        const id = parsedUrl.searchParams.get("id");
        const slug = parsedUrl.searchParams.get("slug");

        if (ownerId && ownerId !== `eq.${state.business.owner_id}`) {
          sendJson(200, []);
          return;
        }
        if (id && id !== `eq.${state.business.id}`) {
          sendJson(200, []);
          return;
        }
        if (slug && slug !== `eq.${state.business.slug}`) {
          sendJson(200, []);
          return;
        }

        sendJson(200, [state.business]);
        return;
      }

      if (method === "PATCH") {
        const id = parsedUrl.searchParams.get("id");
        if (id && id !== `eq.${state.business.id}`) {
          sendJson(404, { message: "Business not found" });
          return;
        }

        const body = (await readBody<Partial<FixtureBusiness>>()) || {};
        state.business = {
          ...state.business,
          ...body,
          updated_at: new Date().toISOString(),
        };

        const prefer = req.headers.prefer || "";
        if (prefer.includes("return=representation")) {
          sendJson(200, [state.business]);
          return;
        }
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // --- PRODUCTS ---
    if (pathname === "/rest/v1/products") {
      if (method === "GET") {
        const idParam = parsedUrl.searchParams.get("id");
        if (idParam?.startsWith("eq.")) {
          const targetId = idParam.slice(3);
          const found = state.products.find((p) => p.id === targetId);
          sendJson(200, found ? [found] : []);
          return;
        }

        const sorted = [...state.products].sort((a, b) => {
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          return a.name.localeCompare(b.name, "tr");
        });
        sendJson(200, sorted);
        return;
      }

      if (method === "POST") {
        const body = await readBody<Partial<FixtureProduct> | Array<Partial<FixtureProduct>>>();
        const items = Array.isArray(body) ? body : [body || {}];
        const inserted: FixtureProduct[] = [];

        for (const item of items) {
          const newProduct: FixtureProduct = {
            id: generateProductId(),
            business_id: FIXTURE_BUSINESS_ID,
            client_product_id: item.client_product_id || `cpid-${Date.now()}`,
            name: item.name || "Yeni Ürün",
            price: Number(item.price ?? 0),
            description: item.description || null,
            category: item.category || "Genel",
            image_label: item.image_label || item.name || "",
            image_url: item.image_url || null,
            is_active: typeof item.is_active === "boolean" ? item.is_active : true,
            sort_order: typeof item.sort_order === "number" ? item.sort_order : state.products.length,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          state.products.push(newProduct);
          inserted.push(newProduct);
        }

        const prefer = req.headers.prefer || "";
        if (prefer.includes("return=representation")) {
          sendJson(201, inserted);
          return;
        }
        res.writeHead(201);
        res.end();
        return;
      }

      if (method === "PATCH") {
        const idParam = parsedUrl.searchParams.get("id");
        const targetId = idParam?.startsWith("eq.") ? idParam.slice(3) : null;
        if (!targetId) {
          sendJson(400, { message: "Product id is required" });
          return;
        }

        const businessIdParam = parsedUrl.searchParams.get("business_id");
        const expectedBizId = businessIdParam?.startsWith("eq.") ? businessIdParam.slice(3) : null;

        const updatedAtParam = parsedUrl.searchParams.get("updated_at");
        const expectedUpdatedAt = updatedAtParam?.startsWith("eq.") ? updatedAtParam.slice(3) : null;

        const productIndex = state.products.findIndex((p) => p.id === targetId);
        if (productIndex === -1) {
          sendJson(200, []);
          return;
        }

        const product = state.products[productIndex];
        if (expectedBizId && product.business_id !== expectedBizId) {
          sendJson(200, []);
          return;
        }

        // Conditional update conflict check
        if (expectedUpdatedAt && product.updated_at !== expectedUpdatedAt) {
          sendJson(200, []);
          return;
        }

        const body = (await readBody<Partial<FixtureProduct>>()) || {};
        state.products[productIndex] = {
          ...product,
          ...body,
          updated_at: new Date().toISOString(),
        };

        const updated = state.products[productIndex];
        const prefer = req.headers.prefer || "";
        if (prefer.includes("return=representation")) {
          sendJson(200, [updated]);
          return;
        }
        res.writeHead(204);
        res.end();
        return;
      }

      if (method === "DELETE") {
        const idParam = parsedUrl.searchParams.get("id");
        const targetId = idParam?.startsWith("eq.") ? idParam.slice(3) : null;
        if (!targetId) {
          sendJson(400, { message: "Product id is required" });
          return;
        }

        const businessIdParam = parsedUrl.searchParams.get("business_id");
        const expectedBizId = businessIdParam?.startsWith("eq.") ? businessIdParam.slice(3) : null;

        const updatedAtParam = parsedUrl.searchParams.get("updated_at");
        const expectedUpdatedAt = updatedAtParam?.startsWith("eq.") ? updatedAtParam.slice(3) : null;

        const productIndex = state.products.findIndex((p) => p.id === targetId);
        if (productIndex === -1) {
          sendJson(200, []);
          return;
        }

        const product = state.products[productIndex];
        if (expectedBizId && product.business_id !== expectedBizId) {
          sendJson(200, []);
          return;
        }

        // Conditional delete conflict check
        if (expectedUpdatedAt && product.updated_at !== expectedUpdatedAt) {
          sendJson(200, []);
          return;
        }

        const deleted = state.products.splice(productIndex, 1)[0];
        const prefer = req.headers.prefer || "";
        if (prefer.includes("return=representation")) {
          sendJson(200, [deleted]);
          return;
        }
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // --- REORDER PRODUCTS RPC ---
    if (pathname === "/rest/v1/rpc/reorder_business_products_atomic" && method === "POST") {
      const body = await readBody<{
        p_business_id?: string;
        p_items?: Array<{ productId: string; sortOrder: number; expectedUpdatedAt: string }>;
      }>();

      const businessId = body?.p_business_id;
      const items = body?.p_items || [];

      if (!businessId || businessId !== state.business.id) {
        sendJson(404, { message: "BUSINESS_NOT_FOUND" });
        return;
      }

      if (!Array.isArray(items) || items.length === 0) {
        sendJson(400, { message: "p_items must be a non-empty array" });
        return;
      }

      // Concurrency check: verify expectedUpdatedAt matches each product's updated_at
      for (const item of items) {
        const product = state.products.find((p) => p.id === item.productId);
        if (!product) {
          sendJson(404, { message: "PRODUCT_NOT_FOUND" });
          return;
        }
        if (product.updated_at !== item.expectedUpdatedAt) {
          sendJson(409, { message: "PRODUCT_CONFLICT" });
          return;
        }
      }

      // Apply sort orders atomically
      const nowIso = new Date().toISOString();
      const updatedRows: FixtureProduct[] = [];

      for (const item of items) {
        const p = state.products.find((prod) => prod.id === item.productId)!;
        p.sort_order = item.sortOrder;
        p.updated_at = nowIso;
        updatedRows.push(p);
      }

      sendJson(200, updatedRows);
      return;
    }

    // --- ORDERS ---
    if (pathname === "/rest/v1/orders") {
      if (method === "GET") {
        const idParam = parsedUrl.searchParams.get("id");
        if (idParam?.startsWith("eq.")) {
          const targetId = idParam.slice(3);
          const found = state.orders.find((o) => o.id === targetId);
          sendJson(200, found ? [found] : []);
          return;
        }

        let filtered = [...state.orders];

        const businessIdParam = parsedUrl.searchParams.get("business_id");
        if (businessIdParam?.startsWith("eq.")) {
          const targetBizId = businessIdParam.slice(3);
          filtered = filtered.filter((o) => o.business_id === targetBizId);
        }

        const statusParam = parsedUrl.searchParams.get("status");
        if (statusParam?.startsWith("eq.")) {
          const targetStatus = statusParam.slice(3);
          filtered = filtered.filter((o) => o.status === targetStatus);
        }

        // Support multiple created_at params: created_at=gte.X and created_at=lt.Y
        const createdAtParams = parsedUrl.searchParams.getAll("created_at");
        for (const cap of createdAtParams) {
          if (cap.startsWith("gte.")) {
            const iso = cap.slice(4);
            filtered = filtered.filter((o) => o.created_at >= iso);
          } else if (cap.startsWith("lt.")) {
            const iso = cap.slice(3);
            filtered = filtered.filter((o) => o.created_at < iso);
          } else if (cap.startsWith("lte.")) {
            const iso = cap.slice(4);
            filtered = filtered.filter((o) => o.created_at <= iso);
          } else if (cap.startsWith("gt.")) {
            const iso = cap.slice(3);
            filtered = filtered.filter((o) => o.created_at > iso);
          }
        }

        // Handle or=(...) query from search.ts
        let orParam = parsedUrl.searchParams.get("or");
        if (req.url && req.url.includes("or=")) {
          const rawMatch = req.url.match(/[?&]or=([^&]+)/);
          if (rawMatch) {
            const candidate = rawMatch[1]
              .replace(/%22/g, '"')
              .replace(/%28/g, "(")
              .replace(/%29/g, ")");
            if (!orParam || /[\x00-\x1f]/.test(orParam)) {
              orParam = candidate;
            }
          }
        }
        if (orParam) {
          orParam = orParam.replace(/%22/g, '"');
        }

        if (orParam && orParam.startsWith("(") && orParam.endsWith(")")) {
          const inner = orParam.slice(1, -1);
          const clauses = inner.split(",");
          filtered = filtered.filter((order) => {
            return clauses.some((clause) => {
              // customer_name.ilike."%term%"
              const nameMatch = clause.match(/^customer_name\.ilike\.(?:"%?|%)(.+?)(?:%"|%|")$/);
              if (nameMatch) {
                const term = nameMatch[1].toLowerCase().replace(/^%|%$/g, "");
                return order.customer_name.toLowerCase().includes(term);
              }
              // customer_phone.ilike."%term%"
              const phoneMatch = clause.match(/^customer_phone\.ilike\.(?:"%?|%)(.+?)(?:%"|%|")$/);
              if (phoneMatch) {
                const term = phoneMatch[1].toLowerCase().replace(/^%|%$/g, "");
                return order.customer_phone.toLowerCase().includes(term);
              }
              // business_order_number.eq.101
              const bizNumMatch = clause.match(/^business_order_number\.eq\.(\d+)$/);
              if (bizNumMatch) {
                const num = parseInt(bizNumMatch[1], 10);
                return order.business_order_number === num;
              }
              // order_number.eq.101
              const ordNumMatch = clause.match(/^order_number\.eq\.(\d+)$/);
              if (ordNumMatch) {
                const num = parseInt(ordNumMatch[1], 10);
                return order.order_number === num;
              }
              return false;
            });
          });
        }

        // Sort created_at descending by default
        filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));

        const totalCount = filtered.length;

        // Support limit & offset query params OR Range header
        let startIndex = 0;
        let limit = 20;

        const offsetParam = parsedUrl.searchParams.get("offset");
        if (offsetParam) {
          startIndex = parseInt(offsetParam, 10) || 0;
        }
        const limitParam = parsedUrl.searchParams.get("limit");
        if (limitParam) {
          limit = parseInt(limitParam, 10) || 20;
        }

        const rangeHeader = req.headers.range;
        if (rangeHeader) {
          const m = rangeHeader.match(/^(\d+)-(\d+)$/);
          if (m) {
            startIndex = parseInt(m[1], 10);
            limit = parseInt(m[2], 10) - startIndex + 1;
          }
        }

        const endIndex = totalCount > 0 ? Math.min(startIndex + limit - 1, totalCount - 1) : 0;
        const sliced = totalCount > 0 ? filtered.slice(startIndex, endIndex + 1) : [];
        const contentRange = totalCount > 0 ? `${startIndex}-${endIndex}/${totalCount}` : `*/0`;

        sendJson(200, sliced, {
          "Content-Range": contentRange,
          Preference: "count=exact",
        });
        return;
      }

      if (method === "PATCH") {
        const idParam = parsedUrl.searchParams.get("id");
        const targetId = idParam?.startsWith("eq.") ? idParam.slice(3) : null;
        if (!targetId) {
          sendJson(400, { message: "Order id is required" });
          return;
        }

        const businessIdParam = parsedUrl.searchParams.get("business_id");
        const expectedBizId = businessIdParam?.startsWith("eq.") ? businessIdParam.slice(3) : null;

        const updatedAtParam = parsedUrl.searchParams.get("updated_at");
        const expectedUpdatedAt = updatedAtParam?.startsWith("eq.") ? updatedAtParam.slice(3) : null;

        const orderIndex = state.orders.findIndex((o) => o.id === targetId);
        if (orderIndex === -1) {
          sendJson(200, []);
          return;
        }

        const order = state.orders[orderIndex];
        if (expectedBizId && order.business_id !== expectedBizId) {
          sendJson(200, []);
          return;
        }

        // Conditional update conflict check
        if (expectedUpdatedAt && order.updated_at !== expectedUpdatedAt) {
          sendJson(200, []);
          return;
        }

        const body = (await readBody<Partial<FixtureOrder>>()) || {};
        state.orders[orderIndex] = {
          ...order,
          ...body,
          updated_at: new Date().toISOString(),
        };

        const updated = state.orders[orderIndex];
        const prefer = req.headers.prefer || "";
        if (prefer.includes("return=representation")) {
          sendJson(200, [updated]);
          return;
        }
        res.writeHead(204);
        res.end();
        return;
      }
    }

    // --- ORDER ITEMS ---
    if (pathname === "/rest/v1/order_items" && method === "GET") {
      const orderIdParam = parsedUrl.searchParams.get("order_id");
      let matchedItems: FixtureOrderItem[] = [];

      if (orderIdParam?.startsWith("in.(")) {
        const inside = orderIdParam.slice(4, -1);
        const ids = inside
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        matchedItems = state.orderItems.filter((item) => ids.includes(item.order_id));
      } else if (orderIdParam?.startsWith("eq.")) {
        const id = orderIdParam.slice(3);
        matchedItems = state.orderItems.filter((item) => item.order_id === id);
      } else {
        matchedItems = [...state.orderItems];
      }

      sendJson(200, matchedItems);
      return;
    }

    // --- DASHBOARD SUMMARY RPC ---
    if (pathname === "/rest/v1/rpc/get_business_dashboard_summary" && method === "POST") {
      const body = await readBody<{ p_business_id?: string; p_date?: string }>();
      const pDate = body?.p_date || "2026-09-21";

      const rangeStart = `${pDate}T00:00:00.000Z`;
      // Next day exclusive
      const nextDayDate = new Date(`${pDate}T00:00:00.000Z`);
      nextDayDate.setUTCDate(nextDayDate.getUTCDate() + 1);
      const rangeEndExclusive = nextDayDate.toISOString();

      const newOrdersCount = state.orders.filter((o) => o.status === "new").length;
      const pendingOrdersCount = state.orders.filter(
        (o) => o.status === "new" || o.status === "preparing" || o.status === "ready",
      ).length;
      const deliveredOrdersCount = state.orders.filter((o) => o.status === "delivered").length;
      const cancelledOrdersCount = state.orders.filter((o) => o.status === "cancelled").length;
      const totalOrdersCount = pendingOrdersCount + deliveredOrdersCount + cancelledOrdersCount;

      const deliveredRevenue = state.orders
        .filter((o) => o.status === "delivered")
        .reduce((sum, o) => sum + o.total_amount, 0);

      // Return ARRAY with exactly ONE row
      sendJson(200, [
        {
          range_start: rangeStart,
          range_end_exclusive: rangeEndExclusive,
          total_orders: totalOrdersCount,
          new_orders: newOrdersCount,
          pending_orders: pendingOrdersCount,
          delivered_orders: deliveredOrdersCount,
          cancelled_orders: cancelledOrdersCount,
          all_currency_try: true,
          delivered_revenue: deliveredRevenue,
        },
      ]);
      return;
    }

    // Fallback 404 for unhandled routes
    sendJson(404, { message: `Unhandled route: ${method} ${pathname}` });
  });

  return new Promise<MockSupabaseServerInstance>((resolve, reject) => {
    // Bind strictly to loopback 127.0.0.1
    server.listen(requestedPort, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Unable to obtain server address"));
        return;
      }
      const port = addr.port;
      const host = "127.0.0.1";
      const baseUrl = `http://${host}:${port}`;

      resolve({
        server,
        port,
        host,
        baseUrl,
        getState,
        resetState,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });

    server.on("error", (err) => reject(err));
  });
}
