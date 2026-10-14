import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { POST,
  // @ts-expect-error The existing tsx runner resolves source extensions.
} from "../../app/api/public/orders/route.ts";
import { createPublicOrder, PublicOrderRequestError,
  // @ts-expect-error The existing tsx runner resolves source extensions.
} from "../../lib/supabase-orders.ts";
import * as receiptHelpers from "../../lib/public-order-receipt";
import * as paymentHelpers from "../../lib/payment-methods";
import * as addressHelpers from "../../lib/public-order-address";

const productId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const key = "11111111-1111-4111-8111-111111111111";
const source = readFileSync(new URL("../../app/isletme/[slug]/PublicBusinessPageClient.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("client.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions: string[] = [];
let reopen = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && ["submitOrder", "retryPendingOrder", "createMessage"].includes(node.name?.text ?? "")) {
    functions.push(node.getText(ast));
  }
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onSendVerifiedWhatsApp" &&
      node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
    reopen = `const reopenWhatsApp = ${node.initializer.expression.getText(ast)};`;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(functions.length, 3);
assert.ok(reopen);
const compiled = ts.transpileModule(functions.join("\n") + "\n" + reopen, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

type ScenarioOptions = {
  price?: number; otherPrice?: number; multiple?: boolean; whatsappOpens?: boolean;
  dropFirstResponse?: boolean; failFirstReceiptRead?: boolean;
  orderType?: "pickup" | "delivery"; paymentMethod?: "cash" | "card";
};
async function scenario(options: ScenarioOptions, run: (s: {
  context: Record<string, any>; state: Record<string, any>; saved: Map<string, any>;
  inventory: Map<string, any>; requests: any[]; counts: { rpc: number; reads: number; created: number; whatsapp: number; popupClosed: number };
}) => Promise<void>) {
  const envNames = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVER_SECRET_KEY"];
  const oldEnv = envNames.map(name => process.env[name]);
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_synthetic_fixture";
  process.env.SUPABASE_SERVER_SECRET_KEY = "synthetic_server_secret";
  const inventory = new Map([
    [productId, { name: "Recorded kebap", price: options.price ?? 125 }],
    [otherId, { name: "Recorded ayran", price: options.otherPrice ?? 10.25 }],
  ]);
  const saved = new Map<string, any>();
  const requests: any[] = [];
  const counts = { rpc: 0, reads: 0, created: 0, whatsapp: 0, popupClosed: 0 };
  let drop = options.dropFirstResponse ?? false;
  let failRead = options.failFirstReceiptRead ?? false;
  const quotedCart = [
    { id: productId, name: "Stale cart name", price: 125, quantity: 2 },
    ...(options.multiple ? [{ id: otherId, name: "Old ayran", price: 10.25, quantity: 3 }] : []),
  ];
  const state: Record<string, any> = { mode: "none", message: "", warning: "", storageClears: 0 };
  const context: Record<string, any> = {
    createPublicOrder, PublicOrderRequestError, ...receiptHelpers, ...paymentHelpers, ...addressHelpers,
    pendingOrderAttemptRef: { current: null }, activeOrderRequestRef: { current: null },
    isRecordingOrderRef: { current: false }, crypto: { randomUUID: () => key },
    currentBusiness: { slug: "synthetic-pilot", name: "Synthetic only", whatsappOrderNumber: "905550000000" },
    customer: { fullName: "Synthetic Customer", phone: "05550000000", note: "No production data" },
    deliveryAddress: { district: "", neighborhood: "", streetAddress: "Test street", building: "", floorUnit: "", directions: "" },
    cart: quotedCart, total: quotedCart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    orderType: options.orderType ?? "pickup", paymentMethod: options.paymentMethod ?? "cash",
    slug: "synthetic-pilot", orderRecoveryMode: "none", verifiedWhatsAppMessage: "",
    isOrderingOpen: true, minimumOrderWarning: "",
    normalizeWhatsAppPhone: (value: string) => value, isMobileDevice: () => false,
    window: { open: () => ({ close() { counts.popupClosed++; }, opener: null }), localStorage: {} },
    clearPublicCart: () => state.storageClears++,
    sendWhatsAppMessage: () => { counts.whatsapp++; return options.whatsappOpens ?? true; },
    setOrderRecoveryMode: (value: string) => { state.mode = value; context.orderRecoveryMode = value; },
    setVerifiedWhatsAppMessage: (value: string) => { state.message = value; context.verifiedWhatsAppMessage = value; },
    setOrderRecordWarning: (value: string) => { state.warning = value; },
    setWarning() {}, setPaymentMethodError() {}, setIsRecordingOrder() {},
    setCart: (value: unknown) => { context.cart = value; },
  };
  globalThis.window = { setTimeout, clearTimeout } as unknown as Window & typeof globalThis;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) === "/api/public/orders") {
      const request = JSON.parse(String(init.body)); requests.push(request);
      const response = await POST(new Request("https://orders.example.test/api/public/orders", {
        method: "POST", headers: { "Content-Type": "application/json", "x-vercel-forwarded-for": "127.0.0.1" },
        body: JSON.stringify(request),
      }));
      if (drop && response.status === 200) { drop = false; throw new Error("Synthetic response loss after commit"); }
      return response;
    }
    const url = new URL(String(input));
    assert.equal(url.origin, "https://supabase.example.test", "Every non-fixture network request is denied");
    assert.equal(new Headers(init.headers).get("apikey"), "synthetic_server_secret");
    if (url.pathname.endsWith("/rpc/check_public_order_rate_limit")) {
      return Response.json([{ allowed: true, blocked_dimension: null, retry_after_seconds: 0 }]);
    }
    if (url.pathname.endsWith("/rpc/create_order_with_items")) {
      counts.rpc++;
      const p = JSON.parse(String(init.body));
      const boundKey = `${p.p_business_slug}:${p.p_idempotency_key}`;
      const existing = saved.get(boundKey);
      if (existing && existing.original !== JSON.stringify(p)) {
        return Response.json({ message: "idempotency_key_reused_with_different_payload" }, { status: 400 });
      }
      if (!existing) {
        const items = p.p_items.map((item: any) => {
          const product = inventory.get(item.product_id);
          assert.ok(product);
          return { product_id: item.product_id, product_name: product.name, unit_price: product.price,
            quantity: item.quantity, line_total: product.price * item.quantity };
        });
        saved.set(boundKey, { original: JSON.stringify(p), row: {
          business_order_number: 42, total_amount: items.reduce((sum: number, item: any) => sum + item.line_total, 0),
          order_type: p.p_order_type, payment_method: p.p_payment_method, currency: "TRY",
          businesses: { slug: p.p_business_slug }, order_items: items,
        } });
        counts.created++;
      }
      const row = saved.get(boundKey).row;
      return Response.json([{ order_number: row.business_order_number, total_amount: row.total_amount, order_type: row.order_type }]);
    }
    if (url.pathname === "/rest/v1/orders") {
      counts.reads++; assert.equal(init.method, "GET");
      if (failRead) { failRead = false; return Response.json({}, { status: 500 }); }
      const slug = url.searchParams.get("businesses.slug")!.slice(3);
      const idempotencyKey = url.searchParams.get("idempotency_key")!.slice(3);
      const stored = saved.get(`${slug}:${idempotencyKey}`);
      assert.equal(url.searchParams.get("business_order_number"), `eq.${stored.row.business_order_number}`);
      return Response.json([stored.row]);
    }
    throw new Error(`Unexpected fixture path: ${url.pathname}`);
  };
  vm.createContext(context); vm.runInContext(compiled, context);
  try { await run({ context, state, saved, inventory, requests, counts }); }
  finally {
    globalThis.fetch = oldFetch; globalThis.window = oldWindow;
    envNames.forEach((name, i) => { if (oldEnv[i] === undefined) delete process.env[name]; else process.env[name] = oldEnv[i]; });
  }
}
const submit = (context: Record<string, any>) => context.submitOrder({ preventDefault() {} });

test("normal order uses stored snapshot and repeated submit cannot create a second saved order", async () => {
  await scenario({}, async ({ context, state, counts, requests }) => {
    await submit(context); assert.equal(counts.created, 1); assert.equal(counts.whatsapp, 1);
    assert.match(state.message, /Recorded kebap/); assert.doesNotMatch(state.message, /Stale cart name/);
    assert.match(state.message, /Genel Toplam: 250,00 TL/); assert.match(state.warning, /250,00 TL/);
    assert.equal(context.cart.length, 0); assert.equal(state.mode, "saved");
    await submit(context); assert.equal(requests.length, 1); assert.equal(counts.created, 1);
  });
});
test("price change shows committed amount before WhatsApp navigation; reopen performs no POST", async () => {
  await scenario({ price: 130 }, async ({ context, state, counts, requests }) => {
    await submit(context);
    assert.equal(counts.created, 1); assert.equal(counts.whatsapp, 0); assert.equal(counts.popupClosed, 1);
    assert.match(state.warning, /Fiyatlar güncellendi.*260,00 TL/);
    assert.match(state.message, /130,00 TL/); assert.match(state.message, /Genel Toplam: 260,00 TL/);
    assert.doesNotMatch(state.message, /125,00 TL|250,00 TL/);
    vm.runInContext("reopenWhatsApp(); reopenWhatsApp();", context);
    assert.equal(counts.whatsapp, 2); assert.equal(requests.length, 1); assert.equal(counts.created, 1);
    assert.match(state.warning, /260,00 TL/);
  });
});
test("multiple products/quantities use each stored line and the stored total", async () => {
  await scenario({ multiple: true, price: 130 }, async ({ context, state, counts }) => {
    await submit(context); assert.equal(counts.created, 1);
    assert.match(state.message, /Recorded kebap x 2 \(130,00 TL\) = 260,00 TL/);
    assert.match(state.message, /Recorded ayran x 3 \(10,25 TL\) = 30,75 TL/);
    assert.match(state.message, /Genel Toplam: 290,75 TL/);
  });
});
test("blocked WhatsApp keeps the saved panel order and the verified retry message", async () => {
  await scenario({ whatsappOpens: false }, async ({ context, state, counts, saved }) => {
    await submit(context); assert.equal(state.mode, "saved"); assert.equal(saved.size, 1);
    assert.match(state.message, /250,00 TL/); assert.equal(context.pendingOrderAttemptRef.current, null);
    vm.runInContext("reopenWhatsApp();", context); assert.equal(counts.created, 1); assert.equal(counts.rpc, 1);
  });
});
for (const failure of ["dropFirstResponse", "failFirstReceiptRead"] as const) {
  test(`${failure}: recovery uses the same key and original snapshot after another price change`, async () => {
    await scenario({ [failure]: true }, async ({ context, state, counts, requests, inventory, saved }) => {
      await submit(context);
      assert.equal(state.mode, "uncertain"); assert.equal(state.message, ""); assert.equal(counts.created, 1);
      assert.equal(state.storageClears, 0); assert.equal(context.pendingOrderAttemptRef.current.idempotencyKey, key);
      inventory.get(productId).price = 900;
      await context.retryPendingOrder();
      assert.equal(counts.created, 1); assert.equal(saved.size, 1); assert.equal(state.mode, "saved");
      assert.deepEqual(requests[0], requests[1]); assert.match(state.message, /250,00 TL/);
      assert.doesNotMatch(state.message, /900,00 TL|1.800,00 TL/);
      assert.equal(context.pendingOrderAttemptRef.current, null); assert.equal(context.cart.length, 0);
    });
  });
}
test("changed payload under a committed idempotency key is rejected without another order", async () => {
  await scenario({ dropFirstResponse: true }, async ({ context, state, counts }) => {
    await submit(context); context.pendingOrderAttemptRef.current.payload.items[0].quantity = 3;
    await context.retryPendingOrder(); assert.equal(state.mode, "conflict");
    assert.equal(state.message, ""); assert.equal(counts.created, 1);
  });
});
for (const orderType of ["pickup", "delivery"] as const) {
  for (const paymentMethod of ["cash", "card"] as const) {
    test(`client/API preserves ${orderType} and ${paymentMethod}`, async () => {
      await scenario({ orderType, paymentMethod }, async ({ context, state, requests }) => {
        await submit(context);
        assert.equal(state.message.includes("Adres: Adres: Test street"), orderType === "delivery");
        assert.equal(state.message.includes("Kart (fiziksel POS)"), paymentMethod === "card");
        assert.equal(requests[0].customer.address === null, orderType === "pickup");
      });
    });
  }
}
