import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ADMIN_BUSINESS_DETAIL_SELECT,
  ADMIN_ORDER_SUMMARY_SELECT,
  ADMIN_RECENT_ORDER_LIMIT,
  AdminBusinessDetailContractError,
  buildAdminBusinessSafePatchParams,
  isCanonicalUuid,
  normalizeAdminBusinessSlug,
  parseAdminBusinessSafePatch,
  // @ts-expect-error Node's type-stripping test runner requires the source extension.
} from "./business-detail-contract.ts";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const route = source("app/api/admin/businesses/[id]/route.ts");
const dal = source("lib/admin/business-detail.ts");
const contract = source("lib/admin/business-detail-contract.ts");
const client = source("app/admin/isletmeler/[id]/business-detail-client.tsx");
const listPage = source("app/admin/page.tsx");
const adminHttp = source("lib/admin/http.ts");

const businessId = "11111111-1111-4111-8111-111111111111";
const updatedAt = "2026-08-14T10:00:00.000Z";
const expandedPatch = {
  name: "Örnek İşletme",
  slug: "ornek-isletme",
  description: "Açıklama",
  category: "Kebap",
  whatsappOrderNumber: "905551112233",
  city: "İstanbul",
  district: "Kadıköy",
  neighborhood: "Caferağa Mahallesi",
  address: "Moda Caddesi No: 1",
  expectedUpdatedAt: updatedAt,
};

test("canonical business UUID is accepted and slug-like identifiers are rejected", () => {
  assert.equal(isCanonicalUuid(businessId), true);
  assert.equal(isCanonicalUuid("demo-kebap"), false);
  assert.equal(isCanonicalUuid("11111111-1111-1111-1111-111111111111"), false);
});

test("valid expanded safe patch trims profile fields and normalizes Turkish slug characters", () => {
  assert.deepEqual(
    parseAdminBusinessSafePatch({
      ...expandedPatch,
      name: "  Örnek İşletme  ",
      slug: " Örnek İşletme ",
      description: "  Açıklama  ",
      category: "  Kebap  ",
      whatsappOrderNumber: "  905551112233  ",
      city: "  İstanbul  ",
      district: "  Kadıköy  ",
      neighborhood: "  Caferağa Mahallesi  ",
      address: "  Moda Caddesi No: 1  ",
    }),
    expandedPatch,
  );
  assert.equal(normalizeAdminBusinessSlug("ÇĞIÖŞÜ test"), "cgiosu-test");
});

test("safe patch rejects empty names and slugs", () => {
  assert.throws(
    () => parseAdminBusinessSafePatch({ ...expandedPatch, name: " " }),
    AdminBusinessDetailContractError,
  );
  assert.throws(
    () => parseAdminBusinessSafePatch({ ...expandedPatch, slug: "---" }),
    AdminBusinessDetailContractError,
  );
});

test("safe patch rejects missing or invalid concurrency versions", () => {
  assert.throws(
    () => parseAdminBusinessSafePatch({ ...expandedPatch, expectedUpdatedAt: "display date" }),
    AdminBusinessDetailContractError,
  );
});

test("extra isActive is rejected by the exact allowlist", () => {
  assert.throws(
    () => parseAdminBusinessSafePatch({ ...expandedPatch, isActive: true }),
    AdminBusinessDetailContractError,
  );
});

test("extra subscriptionStatus is rejected by the exact allowlist", () => {
  assert.throws(
    () => parseAdminBusinessSafePatch({ ...expandedPatch, subscriptionStatus: "active" }),
    AdminBusinessDetailContractError,
  );
});

test("extra ownerId or email is rejected by the exact allowlist", () => {
  for (const forbidden of ["ownerId", "email"]) {
    assert.throws(
      () => parseAdminBusinessSafePatch({
        ...expandedPatch,
        [forbidden]: "forbidden",
      }),
      AdminBusinessDetailContractError,
    );
  }
});

test("description accepts trimmed empty text and rejects non-string values", () => {
  assert.equal(parseAdminBusinessSafePatch({ ...expandedPatch, description: "   " }).description, "");
  assert.throws(
    () => parseAdminBusinessSafePatch({ ...expandedPatch, description: null }),
    AdminBusinessDetailContractError,
  );
});

test("free-text category is trimmed, may be empty and rejects non-string values", () => {
  assert.equal(parseAdminBusinessSafePatch({ ...expandedPatch, category: "  Fırın  " }).category, "Fırın");
  assert.equal(parseAdminBusinessSafePatch({ ...expandedPatch, category: "  " }).category, "");
  assert.throws(
    () => parseAdminBusinessSafePatch({ ...expandedPatch, category: ["Fırın"] }),
    AdminBusinessDetailContractError,
  );
});

test("WhatsApp is required, trimmed and never echoed in validation errors", () => {
  assert.equal(
    parseAdminBusinessSafePatch({ ...expandedPatch, whatsappOrderNumber: " 905551112233 " })
      .whatsappOrderNumber,
    "905551112233",
  );
  for (const invalid of ["", 905551112233]) {
    assert.throws(
      () => parseAdminBusinessSafePatch({ ...expandedPatch, whatsappOrderNumber: invalid }),
      (error: unknown) =>
        error instanceof AdminBusinessDetailContractError &&
        !error.message.includes("905551112233"),
    );
  }
});

test("location and address fields are trimmed strings and preserve empty legacy values", () => {
  for (const field of ["city", "district", "neighborhood"] as const) {
    assert.equal(parseAdminBusinessSafePatch({ ...expandedPatch, [field]: " " })[field], "");
    assert.throws(
      () => parseAdminBusinessSafePatch({ ...expandedPatch, [field]: null }),
      AdminBusinessDetailContractError,
    );
  }
  assert.equal(parseAdminBusinessSafePatch({ ...expandedPatch, address: "  " }).address, "");
  assert.throws(
    () => parseAdminBusinessSafePatch({ ...expandedPatch, address: 1 }),
    AdminBusinessDetailContractError,
  );
});

test("concurrency filter always contains both UUID and raw updated_at", () => {
  const params = buildAdminBusinessSafePatchParams(businessId, updatedAt);
  assert.equal(params.get("id"), `eq.${businessId}`);
  assert.equal(params.get("updated_at"), `eq.${updatedAt}`);
  assert.equal(
    params.get("select"),
    "id,name,slug,description,category,whatsapp_order_number,city,district,neighborhood,address,updated_at",
  );
});

test("expanded two-tab stale edit cannot overwrite a newer description", () => {
  const row = { description: "İlk", address: "Eski adres", whatsappOrderNumber: "905550000000", updatedAt };
  const apply = (
    expected: string,
    changes: Partial<typeof row>,
    nextUpdatedAt: string,
  ) => {
    const filters = buildAdminBusinessSafePatchParams(businessId, expected);
    if (filters.get("updated_at") !== `eq.${row.updatedAt}`) return false;
    Object.assign(row, changes);
    row.updatedAt = nextUpdatedAt;
    return true;
  };

  const tabA = row.updatedAt;
  const tabB = row.updatedAt;
  assert.equal(apply(tabA, { description: "A güncelledi" }, "2026-08-14T10:01:00.000Z"), true);
  assert.equal(
    apply(
      tabB,
      { address: "B adresi", whatsappOrderNumber: "905559999999" },
      "2026-08-14T10:02:00.000Z",
    ),
    false,
  );
  assert.equal(row.description, "A güncelledi");
  assert.equal(row.address, "Eski adres");
  assert.equal(row.whatsappOrderNumber, "905550000000");
});

test("detail route uses async params, requireAdmin and same-origin CSRF", () => {
  assert.match(route, /params:\s*Promise<\{ id: string \}>/);
  assert.equal((route.match(/requireAdmin\(\)/g) ?? []).length, 2);
  assert.match(route, /assertSameOriginAdminMutation\(request\)/);
  assert.match(route, /isCanonicalUuid/);
});

test("detail route returns controlled invalid, not-found and conflict codes", () => {
  assert.match(route, /invalidAdminRequest/);
  assert.match(route, /"NOT_FOUND"/);
  assert.match(dal, /"CONFLICT"/);
  assert.match(dal, /"DUPLICATE_SLUG"/);
  assert.doesNotMatch(`${route}\n${dal}`, /console\.(log|warn|error)/);
});

test("detail response uses explicit business and no-PII order selects", () => {
  assert.doesNotMatch(ADMIN_BUSINESS_DETAIL_SELECT, /\*/);
  assert.doesNotMatch(ADMIN_ORDER_SUMMARY_SELECT, /customer|address|note|phone/i);
  assert.doesNotMatch(`${contract}\n${dal}`, /select=\*|select\("\*"\)/);
  for (const field of ["customer_name", "customer_phone", "customer_address", "customer_note"]) {
    assert.doesNotMatch(ADMIN_ORDER_SUMMARY_SELECT, new RegExp(field));
  }
});

test("owner query requests email only and detail storage remains ephemeral", () => {
  assert.match(dal, /select:\s*"email"/);
  assert.doesNotMatch(client, /localStorage\.setItem|sessionStorage\.setItem/);
  assert.doesNotMatch(client, /console\.(log|warn|error)/);
});

test("product and order counts use HEAD exact count without row arrays", () => {
  assert.match(dal, /method:\s*"HEAD"/);
  assert.match(dal, /Prefer:\s*"count=exact"/);
  assert.match(dal, /countRows\("products"/);
  assert.match(dal, /countRows\("orders"/);
});

test("last and recent orders use stable PII-free queries with a five-row limit", () => {
  assert.equal(ADMIN_RECENT_ORDER_LIMIT, 5);
  assert.match(dal, /order:\s*"created_at\.desc,id\.desc"/);
  assert.match(dal, /fetchOrders\(businessId, 1\)/);
  assert.match(dal, /fetchOrders\(businessId, ADMIN_RECENT_ORDER_LIMIT\)/);
});

test("safe update explicitly maps only safe camelCase fields to database columns", () => {
  for (const mapping of [
    "name: patch.name",
    "slug: patch.slug",
    "description: patch.description",
    "category: patch.category",
    "whatsapp_order_number: patch.whatsappOrderNumber",
    "city: patch.city",
    "district: patch.district",
    "neighborhood: patch.neighborhood",
    "address: patch.address",
  ]) {
    assert.match(dal, new RegExp(mapping.replace(".", "\\.")));
  }
  assert.doesNotMatch(dal, /JSON\.stringify\(patch\)/);
  assert.match(dal, /fetchBusinessLocation\(businessId\)/);
  assert.match(dal, /hasBusinessLocationChanged\(currentLocation, patch\)/);
  assert.match(dal, /isValidStandardBusinessLocation\(patch\)/);
});

test("safe update success DTO maps every safe profile field and excludes owner data", () => {
  for (const mapping of [
    "id: row.id",
    "name: row.name",
    "slug: row.slug",
    "description: row.description",
    "category: row.category",
    "whatsappOrderNumber: row.whatsapp_order_number",
    "city: row.city",
    "district: row.district",
    "neighborhood: row.neighborhood",
    "address: row.address",
    "updatedAt: row.updated_at",
  ]) {
    assert.match(dal, new RegExp(mapping.replace(".", "\\.")));
  }
  const resultBlock = dal.slice(dal.lastIndexOf("return {"));
  assert.doesNotMatch(resultBlock, /owner_id|ownerId|email/);
});

test("safe update distinguishes duplicate slug, stale update and missing business", () => {
  assert.match(dal, /databaseCode === "23505"/);
  assert.match(dal, /"DUPLICATE_SLUG"/);
  assert.match(dal, /businessExists\(businessId\)/);
  assert.match(dal, /başka bir işlemde güncellendi/);
});

test("detail GET and PATCH inherit private no-store Cookie responses", () => {
  assert.match(route, /adminJson/);
  assert.match(adminHttp, /private, no-store, max-age=0/);
  assert.match(adminHttp, /Vary:\s*"Cookie"/);
});

test("list detail action navigates by immutable business UUID", () => {
  assert.match(listPage, /href=\{`\/admin\/isletmeler\/\$\{business\.id\}`\}/);
  assert.doesNotMatch(listPage, /href=\{`\/admin\/isletmeler\/\$\{business\.slug\}`\}/);
});

test("conflict UX keeps edits and requires an explicit latest-data reload", () => {
  assert.match(client, /setConflict\(error\.code === "CONFLICT"\)/);
  assert.match(client, /Güncel Bilgileri Yükle/);
  assert.match(client, /loadLatestAfterConflict/);
});

test("safe edit form exposes all profile fields but not owner or operational settings", () => {
  const editForm = client.slice(
    client.indexOf("<form className={styles.editForm}"),
    client.indexOf("</form>", client.indexOf("<form className={styles.editForm}")),
  );
  for (const id of [
    "detail-business-name",
    "detail-business-slug",
    "detail-business-category",
    "detail-business-description",
    "detail-business-whatsapp",
    "detailBusinessLocation",
    "detail-business-address",
  ]) {
    assert.match(editForm, new RegExp(id));
  }
  for (const forbidden of [
    "owner.email",
    "ownerId",
    "isActive",
    "isOpen",
    "subscriptionStatus",
    "paymentMethodMode",
    "minimumOrderAmount",
    "preparationTimeMinutes",
    "deliveryStatus",
    "logoUrl",
    "coverImageUrl",
    "orderNote",
  ]) {
    assert.doesNotMatch(editForm, new RegExp(forbidden.replace(".", "\\.")));
  }
});

test("owner email remains read-only outside the safe edit form", () => {
  assert.match(client, /<dt>E-posta<\/dt><dd>\{detail\.owner\.email/);
  assert.match(client, /<dt>Yetki<\/dt><dd>Salt okunur<\/dd>/);
  assert.doesNotMatch(client, /value=\{detail\.owner\.email\}/);
});

test("safe edit waits for PATCH success before changing persistent detail state", () => {
  const save = client.slice(client.indexOf("async function saveEdit"), client.indexOf("async function loadLatestAfterConflict"));
  assert.ok(save.indexOf("await updateAdminBusinessSafely") < save.indexOf("setDetail"));
});

test("legacy access, subscription and delete capabilities remain on the detail page", () => {
  for (const label of [
    "Pasife Al",
    "Aktife Al",
    "Engelle",
    "Aboneliği Sıfırla",
    "Kalıcı Sil",
  ]) {
    assert.match(client, new RegExp(label.replace("+", "\\+")));
  }
  assert.match(client, /const extensionDays = \[30, 60, 90, 180, 365\]/);
  assert.match(client, /updateBusinessSubscriptionInSupabase/);
  assert.match(client, /deleteBusinessInSupabase/);
});

test("detail layout includes all required read-only and operational sections", () => {
  for (const heading of [
    "Temel bilgiler",
    "İşletme sahibi",
    "Erişim ve abonelik",
    "İşletme ayarları",
    "Operasyon özeti",
    "Son siparişler",
    "Kritik işlemler",
  ]) {
    assert.match(client, new RegExp(heading, "i"));
  }
});
