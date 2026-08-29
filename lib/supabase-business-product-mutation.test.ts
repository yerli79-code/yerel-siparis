import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BusinessProductMutationError,
  BusinessProductsRequestError,
  createProduct,
  deleteProduct,
  fetchProductsByBusinessId,
  reorderProducts,
  setProductActiveStatus,
  updateProduct,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./supabase-business.ts";

const productId = "11111111-1111-4111-8111-111111111111";
const productB = "22222222-2222-4222-8222-222222222222";
const businessId = "33333333-3333-4333-8333-333333333333";
const updatedAt = "2026-08-29T06:00:00.000Z";
const nextUpdatedAt = "2026-08-29T06:00:01.000Z";

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: productId,
    business_id: businessId,
    client_product_id: "client-1",
    name: "Test Ürün",
    price: 100,
    description: "",
    category: "Genel",
    image_label: "",
    image_url: null,
    is_active: true,
    sort_order: 1,
    created_at: "2026-08-29T05:00:00.000Z",
    updated_at: updatedAt,
    ...overrides,
  };
}

async function withFetch(
  mock: typeof fetch,
  run: () => Promise<void>,
) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("update sends strict input and the loaded authoritative expectedUpdatedAt", async () => {
  await withFetch(async (_input, init = {}) => {
    assert.equal(init.method, "PATCH");
    assert.deepEqual(JSON.parse(String(init.body)), {
      input: { name: "Yeni Ad" },
      expectedUpdatedAt: updatedAt,
    });
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json({
      product: productRow({ name: "Yeni Ad", updated_at: nextUpdatedAt }),
    });
  }, async () => {
    const product = await updateProduct(
      productId,
      { name: " Yeni Ad " },
      updatedAt,
      "token",
    );
    assert.equal(product.name, "Yeni Ad");
    assert.equal(product.updatedAt, nextUpdatedAt);
  });
});

test("active/passive uses the same protected update contract", async () => {
  await withFetch(async (_input, init = {}) => {
    assert.deepEqual(JSON.parse(String(init.body)), {
      input: { isActive: false },
      expectedUpdatedAt: updatedAt,
    });
    return Response.json({ product: productRow({ is_active: false, updated_at: nextUpdatedAt }) });
  }, async () => {
    const product = await setProductActiveStatus(
      productId,
      false,
      updatedAt,
      "token",
    );
    assert.equal(product.isActive, false);
  });
});

test("delete sends expectedUpdatedAt in a strict JSON body and returns confirmation", async () => {
  await withFetch(async (_input, init = {}) => {
    assert.equal(init.method, "DELETE");
    assert.deepEqual(JSON.parse(String(init.body)), { expectedUpdatedAt: updatedAt });
    return Response.json({ product: productRow() });
  }, async () => {
    const deleted = await deleteProduct(productId, updatedAt, "token");
    assert.equal(deleted.id, productId);
  });
});

test("reorder sends expectedUpdatedAt for every affected product", async () => {
  const items = [
    { productId, sortOrder: 2, expectedUpdatedAt: updatedAt },
    { productId: productB, sortOrder: 1, expectedUpdatedAt: nextUpdatedAt },
  ];
  await withFetch(async (_input, init = {}) => {
    assert.deepEqual(JSON.parse(String(init.body)), { items });
    return Response.json({
      products: [
        productRow({ id: productB, sort_order: 1, updated_at: "2026-08-29T06:00:02.000Z" }),
        productRow({ sort_order: 2, updated_at: "2026-08-29T06:00:02.000Z" }),
      ],
    });
  }, async () => {
    const products = await reorderProducts(items, "token");
    assert.equal(products.length, 2);
  });
});

test("authoritative update version is used by the next mutation", async () => {
  const bodies: unknown[] = [];
  let call = 0;
  await withFetch(async (_input, init = {}) => {
    bodies.push(JSON.parse(String(init.body)));
    call += 1;
    return Response.json({
      product: productRow({
        name: call === 1 ? "Bir" : "İki",
        updated_at: call === 1 ? nextUpdatedAt : "2026-08-29T06:00:02.000Z",
      }),
    });
  }, async () => {
    const first = await updateProduct(productId, { name: "Bir" }, updatedAt, "token");
    await updateProduct(productId, { name: "İki" }, first.updatedAt, "token");
  });
  assert.equal((bodies[1] as { expectedUpdatedAt: string }).expectedUpdatedAt, nextUpdatedAt);
});

test("create returns only a validated authoritative product", async () => {
  await withFetch(async (_input, init = {}) => {
    const body = JSON.parse(String(init.body));
    assert.equal("sortOrder" in body.input, false);
    return Response.json({ product: productRow() });
  }, async () => {
    const product = await createProduct({ name: "Test Ürün", price: 100, category: "Genel" }, "token");
    assert.equal(product.updatedAt, updatedAt);
  });
});

for (const [status, expectedCode] of [
  [409, "PRODUCT_CONFLICT"],
  [404, "PRODUCT_NOT_FOUND"],
  [403, "PRODUCT_FORBIDDEN"],
  [401, "PRODUCT_UNAUTHORIZED"],
  [400, "INVALID_PRODUCT_MUTATION"],
  [500, "PRODUCT_UNAVAILABLE"],
] as const) {
  test(`HTTP ${status} maps to stable ${expectedCode}`, async () => {
    await withFetch(
      async () => Response.json({ message: "raw server detail" }, { status }),
      async () => {
        await assert.rejects(
          () => updateProduct(productId, { name: "X" }, updatedAt, "token"),
          (error: unknown) => {
            assert.ok(error instanceof BusinessProductMutationError);
            assert.equal(error.code, expectedCode);
            assert.equal(error.status, status);
            assert.doesNotMatch(error.message, /raw|server detail/i);
            return true;
          },
        );
      },
    );
  });
}

for (const responseFactory of [
  () => new Response("{", { status: 200 }),
  () => Response.json({ product: { id: productId } }),
  () => Response.json({ product: productRow(), unexpected: true }),
]) {
  test("malformed success payload is controlled unavailable", async () => {
    await withFetch(async () => responseFactory(), async () => {
      await assert.rejects(
        () => updateProduct(productId, { name: "X" }, updatedAt, "token"),
        (error: unknown) =>
          error instanceof BusinessProductMutationError &&
          error.code === "PRODUCT_UNAVAILABLE",
      );
    });
  });
}

test("network failure is controlled unavailable with no retry", async () => {
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    throw new Error("network secret");
  }, async () => {
    await assert.rejects(
      () => createProduct({ name: "X", price: 1, category: "Genel" }, "token"),
      (error: unknown) =>
        error instanceof BusinessProductMutationError &&
        error.code === "PRODUCT_UNAVAILABLE" &&
        error.status === null,
    );
  });
  assert.equal(calls, 1);
});

test("timeout abort is controlled unavailable", async () => {
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: () => void) => {
    callback();
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
  try {
    await withFetch(async (_input, init = {}) => {
      assert.equal(init.signal?.aborted, true);
      throw new DOMException("aborted", "AbortError");
    }, async () => {
      await assert.rejects(
        () => createProduct({ name: "X", price: 1, category: "Genel" }, "token"),
        (error: unknown) =>
          error instanceof BusinessProductMutationError &&
          error.code === "PRODUCT_UNAVAILABLE",
      );
    });
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});

test("business product list validates payload and forwards AbortSignal", async () => {
  const controller = new AbortController();
  await withFetch(async (_input, init = {}) => {
    assert.equal(init.signal, controller.signal);
    return Response.json({ products: [productRow()] });
  }, async () => {
    const products = await fetchProductsByBusinessId(businessId, "token", {
      signal: controller.signal,
    });
    assert.equal(products[0].updatedAt, updatedAt);
  });
});

test("malformed list response is controlled and raw details are hidden", async () => {
  await withFetch(async () => Response.json({ products: [{ id: productId }] }), async () => {
    await assert.rejects(
      () => fetchProductsByBusinessId(businessId, "token"),
      (error: unknown) => error instanceof BusinessProductsRequestError,
    );
  });
});

test("intentional product-list abort remains an AbortError", async () => {
  await withFetch(async () => {
    throw new DOMException("aborted", "AbortError");
  }, async () => {
    await assert.rejects(
      () => fetchProductsByBusinessId(businessId, "token"),
      (error: unknown) =>
        error instanceof DOMException && error.name === "AbortError",
    );
  });
});
