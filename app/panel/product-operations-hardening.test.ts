import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const panel = readFileSync(resolve("app/panel/page.tsx"), "utf8");
const client = readFileSync(resolve("lib/supabase-business.ts"), "utf8");
const css = readFileSync(resolve("app/panel/panel.module.css"), "utf8");

function sourceBetween(source: string, start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

const submit = sourceBetween(panel, "async function handleSubmit", "function startEdit");
const remove = sourceBetween(panel, "async function removeProduct", "async function toggleProduct");
const toggle = sourceBetween(panel, "async function toggleProduct", "async function moveProduct");
const reorder = sourceBetween(panel, "async function moveProduct", "function logout");
const refresh = sourceBetween(panel, "async function refreshProducts", "function cancelActiveOrderListRequest");

test("edit sends expectedUpdatedAt from the current authoritative product", () => {
  assert.match(submit, /productsRef\.current\.find/);
  assert.match(submit, /authoritativeProduct\.updatedAt/);
  assert.doesNotMatch(submit, /new Date\(|Date\.now\(/);
});

test("toggle and delete send authoritative expectedUpdatedAt", () => {
  assert.match(toggle, /authoritativeProduct\.updatedAt/);
  assert.match(remove, /authoritativeProduct\.updatedAt/);
});

test("reorder sends an expectedUpdatedAt for every affected item", () => {
  assert.match(reorder, /expectedUpdatedAt: item\.updatedAt/);
  assert.match(reorder, /reorderedProducts\.map/);
});

test("create has a synchronous duplicate-submit guard", () => {
  assert.match(panel, /createProductInFlightRef = useRef\(false\)/);
  assert.match(panel, /isCreate && createProductInFlightRef\.current/);
  assert.match(panel, /if \(isCreate\) createProductInFlightRef\.current = true/);
  assert.match(panel, /if \(isCreate\) createProductInFlightRef\.current = false/);
  assert.match(submit, /beginProductMutation\(mutationProductIds, isCreateMutation\)/);
});

test("same product cannot overlap edit, toggle, delete, or reorder", () => {
  assert.match(panel, /inFlightProductMutationsRef = useRef\(new Set<string>\(\)\)/);
  assert.match(panel, /inFlightProductMutationsRef\.current\.has\(productId\)/);
  assert.match(panel, /inFlightProductMutationsRef\.current\.add\(productId\)/);
  assert.match(panel, /inFlightProductMutationsRef\.current\.delete\(productId\)/);
  for (const source of [submit, remove, toggle, reorder]) {
    assert.match(source, /beginProductMutation/);
    assert.match(source, /finally[\s\S]*endProductMutation/);
  }
});

test("successful create, update, toggle, delete and reorder merge authoritative results", () => {
  assert.match(submit, /mergeAuthoritativeProduct\(updatedProduct\)/);
  assert.match(submit, /mergeAuthoritativeProduct\(createdProduct\)/);
  assert.match(toggle, /mergeAuthoritativeProduct\(updatedProduct\)/);
  assert.match(remove, /removeAuthoritativeProduct\(deletedProduct\.id\)/);
  assert.match(reorder, /mergeAuthoritativeProducts\(authoritativeProducts\)/);
});

test("normal mutation success does not reload the full product list", () => {
  for (const source of [submit, remove, toggle, reorder]) {
    assert.doesNotMatch(source, /refreshProducts\(/);
  }
});

test("next mutation reads the newly merged authoritative version", () => {
  const merge = sourceBetween(
    panel,
    "function mergeAuthoritativeProduct",
    "function mergeAuthoritativeProducts",
  );
  assert.match(merge, /product\.id === authoritativeProduct\.id[\s\S]*authoritativeProduct/);
  assert.match(submit, /productsRef\.current\.find/);
  assert.doesNotMatch(merge, /updatedAt:/);
});

test("conflict never retries or applies stale requested state", () => {
  const failure = sourceBetween(
    panel,
    "function handleProductMutationFailure",
    "async function refreshProducts",
  );
  assert.match(failure, /mutationError\.code === "PRODUCT_CONFLICT"/);
  assert.match(failure, /conflictedProductIdsRef\.current = next/);
  assert.doesNotMatch(failure, /setProducts|mergeAuthoritativeProduct|updateProduct\(/);
  assert.equal((submit.match(/updateProduct\(/g) ?? []).length, 1);
  assert.equal((toggle.match(/setProductActiveStatus\(/g) ?? []).length, 1);
  assert.equal((remove.match(/deleteProduct\(/g) ?? []).length, 1);
  assert.equal((reorder.match(/reorderProducts\(/g) ?? []).length, 1);
});

test("stale edit is locked until explicit authoritative refresh", () => {
  assert.match(panel, /isEditingProductConflicted/);
  assert.match(panel, /disabled=\{!canManageProducts \|\| isSaving \|\| isUploadingImage \|\| isEditingProductConflicted\}/);
  assert.match(panel, /Güncel Bilgileri Yükle/);
  assert.match(panel, /refreshProducts\(\{ replaceEditingForm: true \}\)/);
});

test("explicit refresh replaces edit values and clears every conflict lock", () => {
  assert.match(refresh, /setForm\(toForm\(refreshedProduct\)\)/);
  assert.match(refresh, /conflictedProductIdsRef\.current = new Set\(\)/);
  assert.match(refresh, /setConflictedProductIds\(conflictedProductIdsRef\.current\)/);
  assert.match(refresh, /setProductOperationError\(""\)/);
});

test("delete and reorder conflicts preserve the current product list", () => {
  const removeCatch = remove.slice(remove.indexOf("} catch"));
  const reorderCatch = reorder.slice(reorder.indexOf("} catch"));
  assert.doesNotMatch(removeCatch, /removeAuthoritativeProduct/);
  assert.doesNotMatch(reorderCatch, /mergeAuthoritativeProducts/);
});

test("older product requests are aborted and generation-gated", () => {
  assert.match(refresh, /productListAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(refresh, /requestGeneration !== productListRequestGenerationRef\.current/);
  assert.match(refresh, /signal: abortController\.signal/);
  assert.match(panel, /cancelActiveProductListRequest\(\)/);
});

test("intentional superseded product-list abort is silent", () => {
  const abortBranch = refresh.slice(
    refresh.indexOf("isAbortError(caughtError)"),
    refresh.indexOf("caughtError instanceof BusinessProductsRequestError"),
  );
  assert.match(abortBranch, /return null/);
  assert.doesNotMatch(abortBranch, /setProductOperationError/);
});

test("unmount aborts product-list work and releases local mutation guards", () => {
  assert.match(panel, /productListRequestGenerationRef\.current \+= 1/);
  assert.match(panel, /productListAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(panel, /inFlightProductMutationsRef\.current\.clear\(\)/);
  assert.match(panel, /createProductInFlightRef\.current = false/);
});

test("category summaries and filters derive from authoritative products", () => {
  assert.match(panel, /const categorySummaries = useMemo/);
  assert.match(panel, /sortedProducts\.forEach/);
  assert.match(panel, /reconcileProductCategoryFilter\(nextProducts\)/);
  assert.match(panel, /nextProducts\.some[\s\S]*getProductCategory\(product\) === current/);
  assert.match(panel, /: "Tüm ürünler"/);
});

test("legacy category preservation and standard category validation remain", () => {
  assert.match(submit, /hasUntouchedLegacyCategory[\s\S]*delete payload\.category/);
  assert.match(panel, /!isStandardProductCategory\(originalProductCategory\)/);
  assert.match(panel, /!isStandardProductCategory\(form\.category\)/);
  assert.doesNotMatch(submit, /category:\s*"Genel"/);
});

test("filtered reorder remains blocked so global order cannot be corrupted", () => {
  assert.match(panel, /const isProductOrderingFiltered/);
  assert.match(reorder, /if \(!canManageProducts \|\| isProductOrderingFiltered\) return/);
  assert.match(panel, /Ürün sıralamak için arama ve kategori filtresini temizleyin/);
});

test("image validation and non-destructive upload behavior remain", () => {
  assert.match(client, /"image\/jpeg"/);
  assert.match(client, /"image\/png"/);
  assert.match(client, /"image\/webp"/);
  assert.match(client, /5 \* 1024 \* 1024/);
  assert.match(panel, /uploadProductImage/);
  assert.doesNotMatch(panel, /deleteProductImage|removeProductImage/);
});

test("401 keeps the established expired-session flow", () => {
  const failure = sourceBetween(
    panel,
    "function handleProductMutationFailure",
    "async function refreshProducts",
  );
  assert.match(failure, /PRODUCT_UNAUTHORIZED[\s\S]*endBusinessSession\(\)/);
  assert.match(panel, /router\.replace\("\/giris"\)/);
});

test("controlled Turkish product errors never render caught raw messages", () => {
  for (const code of [
    "PRODUCT_CONFLICT",
    "PRODUCT_NOT_FOUND",
    "PRODUCT_FORBIDDEN",
    "PRODUCT_UNAUTHORIZED",
    "PRODUCT_UNAVAILABLE",
    "INVALID_PRODUCT_MUTATION",
  ]) {
    assert.match(panel, new RegExp(code));
  }
  assert.doesNotMatch(submit, /caughtError\.message|caughtError\.stack/);
});

test("conflict alert and refresh control are accessible and mobile reachable", () => {
  assert.match(panel, /className="alert panel-product-mutation-message"[\s\S]*role="alert"/);
  assert.match(panel, /aria-busy=\{isSaving \|\| isUploadingImage\}/);
  assert.match(css, /panel-product-mutation-message button\)[\s\S]*min-height: 44px/);
  assert.match(css, /business-panel-form-actions button\)[\s\S]*min-height: 44px/);
  assert.match(css, /padding: 0 0 calc\(82px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /overflow-x: clip/);
});

test("P6.1A product layout and mobile navigation remain intact", () => {
  assert.match(panel, /business-panel-product-form/);
  assert.match(panel, /business-panel-mobile-nav/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
});

test("all five product mutation types use the shared 20 second retry-free contract", () => {
  assert.match(client, /businessProductMutationTimeoutMs = 20000/);
  assert.equal((client.match(/return runProductMutation\(/g) ?? []).length, 4);
  assert.match(
    client,
    /setProductActiveStatus[\s\S]*return updateProduct\(productId, \{ isActive \}, expectedUpdatedAt, accessToken\)/,
  );
  const runner = sourceBetween(client, "async function runProductMutation", "function mapPublicProduct");
  assert.match(runner, /new AbortController\(\)/);
  assert.match(runner, /controller\.abort\(\)/);
  assert.doesNotMatch(runner, /retry|setInterval/);
});
