import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import ts from "typescript";
import {
  BusinessProductMutationError,
  ProductImageValidationError,
  fetchPublicProductsByBusinessId,
  uploadProductImage,
  type BusinessProduct,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "../../lib/supabase-business.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { isStandardProductCategory } from "../../lib/product-categories.ts";

const panelSource = ts.createSourceFile(
  "page.tsx",
  readFileSync(new URL("./page.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

// Execute the actual private functions, including their closure dependencies,
// without exporting page internals or duplicating validation logic in tests.
function panelFunction<T>(name: string, dependencies: Record<string, unknown> = {}): T {
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(panelSource);
  assert.ok(declaration, `${name} exists in the panel`);
  const javascript = ts.transpileModule(declaration.getText(panelSource), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${javascript}; return ${name};`)(
    ...Object.values(dependencies),
  ) as T;
}

function validate(overrides: Record<string, string>) {
  return panelFunction<() => string>("validateForm", {
    form: { name: "Ürün", price: "10", sortOrder: "", category: "Genel", ...overrides },
    editingProductId: "",
    originalProductCategory: "",
    isProductCategoryChanged: false,
    isStandardProductCategory,
  })();
}

for (const price of ["", "   "]) {
  test(`panel rejects blank price ${JSON.stringify(price)} with a specific message`, () => {
    assert.equal(validate({ price }), "Fiyat boş olamaz.");
  });
}
for (const price of ["NaN", "Infinity", "-Infinity", "-1", "invalid"]) {
  test(`panel rejects invalid price ${price}`, () => {
    assert.equal(validate({ price }), "Fiyat geçerli bir sayı olmalıdır.");
  });
}
for (const price of ["0", "10", "10.5", " 10.5 "]) {
  test(`panel accepts explicit numeric price ${JSON.stringify(price)}`, () => {
    assert.equal(validate({ price }), "");
  });
}
for (const name of ["", "   "]) {
  test(`panel rejects blank name ${JSON.stringify(name)}`, () => {
    assert.equal(validate({ name }), "Ürün adı boş olamaz.");
  });
}
test("panel checks name length after trimming: 180 accepted, 181 rejected", () => {
  assert.equal(validate({ name: "x".repeat(180) }), "");
  assert.equal(validate({ name: `  ${"x".repeat(180)}  ` }), "");
  assert.equal(validate({ name: `  ${"x".repeat(181)}  ` }), "Ürün adı en fazla 180 karakter olabilir.");
});

const safeGenericError = "Ürün işleminin sonucu doğrulanamadı. Güncel bilgileri yükleyin.";
function displayedError(error: unknown) {
  let message = "";
  const handler = panelFunction<(error: unknown, ids: string[]) => void>(
    "handleProductMutationFailure",
    {
      BusinessProductMutationError,
      ProductImageValidationError,
      getProductMutationErrorMessage: panelFunction("getProductMutationErrorMessage"),
      setProductOperationError: (value: string) => { message = value; },
    },
  );
  handler(error, []);
  return message;
}

const previousEnv = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
after(() => {
  if (previousEnv.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousEnv.url;
  if (previousEnv.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousEnv.key;
});

async function withFetch(mock: typeof fetch, run: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = previousFetch; }
}

for (const [file, code, message] of [
  [new File(["image"], "test.gif", { type: "image/gif" }), "PRODUCT_IMAGE_UNSUPPORTED_TYPE", "Sadece JPG, PNG veya WEBP görsel yükleyebilirsiniz."],
  [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "test.png", { type: "image/png" }), "PRODUCT_IMAGE_TOO_LARGE", "Ürün görseli en fazla 5 MB olabilir."],
] as const) {
  test(`image ${code} reaches the panel safely without uploading`, async () => {
    let requests = 0;
    await withFetch(async () => { requests++; throw new Error("Unexpected upload"); }, async () => {
      await assert.rejects(uploadProductImage("business-id", file, "user-token"), (error: unknown) => {
        assert.ok(error instanceof ProductImageValidationError);
        assert.equal(error.code, code);
        // Even a modified message must never be used for display.
        error.message = "raw internal detail";
        assert.equal(displayedError(error), message);
        return true;
      });
    });
    assert.equal(requests, 0);
  });
}

test("arbitrary errors and lookalike image errors never expose their messages", () => {
  for (const error of [
    new Error("raw internal detail"),
    { name: "ProductImageValidationError", code: "PRODUCT_IMAGE_TOO_LARGE", message: "raw detail" },
    Object.assign(new Error("raw detail"), { code: "PRODUCT_IMAGE_UNSUPPORTED_TYPE" }),
  ]) assert.equal(displayedError(error), safeGenericError);
});

for (const failure of ["network", "storage"]) {
  test(`${failure} image failure stays generic in the panel`, async () => {
    await withFetch(async () => {
      if (failure === "network") throw new Error("raw network internal detail");
      return Response.json({ message: "raw storage internal detail" }, { status: 500 });
    }, async () => {
      const file = new File(["image"], "test.png", { type: "image/png" });
      await assert.rejects(uploadProductImage("business-id", file, "user-token"), (error: unknown) => {
        assert.equal(displayedError(error), safeGenericError);
        return true;
      });
    });
  });
}

test("supported image at exactly 5 MB preserves the authenticated business storage path", async () => {
  let requests = 0;
  await withFetch(async (input, init) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(url.origin, "https://supabase.example.test");
    assert.match(url.pathname, /^\/storage\/v1\/object\/product-images\/business-id\//);
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer user-token");
    return Response.json({});
  }, async () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024)], "test.webp", { type: "image/webp" });
    const url = await uploadProductImage("business-id", file, "user-token");
    assert.match(url, /\/public\/product-images\/business-id\//);
  });
  assert.equal(requests, 1);
});

const sortProducts = panelFunction<(products: BusinessProduct[]) => BusinessProduct[]>("sortProducts");
test("ties use ID ascending regardless of creation date or name; unique sort orders stay primary", () => {
  const products = [
    { id: "b", sortOrder: 2, name: "A", createdAt: "2020-01-01" },
    { id: "c", sortOrder: 1, name: "B", createdAt: "2021-01-01" },
    { id: "a", sortOrder: 2, name: "Z", createdAt: "2022-01-01" },
  ] as BusinessProduct[];
  assert.deepEqual(sortProducts(products).map(({ id }) => id), ["c", "a", "b"]);
  assert.deepEqual(products.map(({ id }) => id), ["b", "c", "a"]);
});

test("public active-only query uses the same sort order and ID contract as the panel", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true, value: { setTimeout, clearTimeout },
  });
  const rows = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"].map((id) => ({
    id, name: id, price: 10, description: "", category: "Genel", image_url: null,
    is_active: true, sort_order: 1,
  }));
  try {
    await withFetch(async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("business_id"), "eq.business-id");
      assert.equal(url.searchParams.get("is_active"), "eq.true");
      assert.equal(url.searchParams.get("order"), "sort_order.asc,id.asc");
      assert.equal(new Headers(init?.headers).has("Authorization"), false);
      return Response.json(rows);
    }, async () => {
      const publicProducts = await fetchPublicProductsByBusinessId("business-id");
      const panelProducts = rows.map((row) => ({ id: row.id, sortOrder: row.sort_order })) as BusinessProduct[];
      assert.deepEqual(sortProducts(panelProducts.reverse()).map(({ id }) => id), publicProducts.map(({ id }) => id));
    });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
