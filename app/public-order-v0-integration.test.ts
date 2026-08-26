import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const serverPage = source("app/isletme/[slug]/page.tsx");
const client = source("app/isletme/[slug]/PublicBusinessPageClient.tsx");
const menu = source("components/PublicOrderMenu.tsx");
const checkout = source("components/PublicOrderCheckout.tsx");
const css = source("app/globals.css");
const productionPublicOrderSource = [serverPage, client, menu, checkout].join("\n");

test("server business page keeps production lookup, metadata, canonical and LocalBusiness JSON-LD", () => {
  assert.match(serverPage, /getPublicBusinessBySlug\(slug\)/);
  assert.match(serverPage, /export async function generateMetadata/);
  assert.match(serverPage, /alternates:\s*\{\s*canonical:/);
  assert.match(serverPage, /"@type": "LocalBusiness"/);
  assert.match(serverPage, /JSON\.stringify\(businessJsonLd\)\.replace\(\/<\/g/);
  assert.match(serverPage, /if \(!business\) notFound\(\)/);
});

test("v0 mock business, phone and direct mock WhatsApp implementation are rejected", () => {
  assert.doesNotMatch(productionPublicOrderSource, /Burger House/);
  assert.doesNotMatch(productionPublicOrderSource, /905551234567/);
  assert.doesNotMatch([menu, checkout].join("\n"), /wa\.me/);
  assert.match(client, /currentBusiness\.whatsappOrderNumber/);
  assert.match(client, /const webLink = `https:\/\/wa\.me\/\$\{phone\}\?text=\$\{encodedMessage\}`/);
});

test("verified order creation, idempotency and recovery remain authoritative", () => {
  assert.match(client, /await createPublicOrder\(attempt\.payload\)/);
  assert.match(client, /crypto\.randomUUID\(\)/);
  assert.match(client, /pendingOrderAttemptRef/);
  assert.match(client, /IDEMPOTENCY_CONFLICT/);
  assert.match(client, /orderRecoveryMode/);
  assert.match(client, /verifiedWhatsAppMessage/);
  const createOrderIndex = client.indexOf("await createPublicOrder(attempt.payload)");
  assert.ok(createOrderIndex >= 0);
  assert.ok(
    client.indexOf("const whatsappOpened = sendWhatsAppMessage", createOrderIndex) >
      createOrderIndex,
  );
});

test("cart persistence, payment, minimum order and closed-order behavior remain wired", () => {
  for (const marker of [
    "getPublicCartStorageKey",
    "readPublicCart",
    "persistPublicCart",
    "clearPublicCart",
    "PUBLIC_CART_MAX_QUANTITY",
    "getPaymentMethodModeOrDefault",
    "getInitialPaymentMethod",
    "minimumOrderWarning",
    "isOrderingOpen",
  ]) {
    assert.match(client, new RegExp(marker));
  }
  assert.match(checkout, /fixedPaymentOption/);
  assert.match(checkout, /PAYMENT_METHODS\.map/);
  assert.match(menu, /Bu işletme şu an sipariş almıyor/);
});

test("search, category filtering and local saved customer details remain available", () => {
  assert.match(client, /normalizeProductSearchValue/);
  assert.match(client, /selectedCategory/);
  assert.match(client, /setSearchQuery/);
  assert.match(menu, /type="search"/);
  assert.match(menu, /public-order-category-tabs/);
  assert.match(client, /yerel-siparis:customer-details:v1/);
  assert.match(checkout, /Bilgilerimi bu cihazda hatırla/);
  assert.match(checkout, /Kaydedilen bilgileri sil/);
});

test("checkout uses structured presentation fields without changing the order contract", () => {
  for (const label of [
    "İlçe",
    "Mahalle",
    "Açık Adres",
    "Apartman / Bina",
    "Kat / Daire",
    "Adres Tarifi",
  ]) {
    assert.match(checkout, new RegExp(label.replace("/", "\\/")));
  }
  assert.match(client, /composePublicOrderDeliveryAddress\(\s*deliveryAddress/);
  assert.match(client, /address: orderType === "delivery" \? normalizedDeliveryAddress : null/);
  assert.match(checkout, /orderType === "delivery" \? \(/);
  assert.match(checkout, /adres gerekmez/);
  assert.equal((checkout.match(/type="checkbox"/g) ?? []).length, 1);
  assert.doesNotMatch(checkout, /KVKK[^\n]*checkbox|consent/i);
});

test("WhatsApp notice and primary CTA use the approved customer wording", () => {
  assert.match(
    checkout,
    /Girdiğiniz iletişim ve sipariş bilgileri,[\s\S]*WhatsApp üzerinden aktarılacaktır/,
  );
  assert.match(checkout, /WhatsApp’ta Devam Et/);
  assert.doesNotMatch(checkout, /WhatsApp ile Sipariş Oluştur/);
});

test("mobile cart rows protect product titles from character-level wrapping", () => {
  assert.match(css, /grid-template-columns: 64px minmax\(0, 1fr\) auto/);
  assert.match(css, /grid-template-columns: 56px minmax\(0, 1fr\)/);
  const titleRule = css.slice(
    css.lastIndexOf(".public-order-cart-item-main > strong"),
    css.lastIndexOf(".public-order-cart-item-main > span"),
  );
  assert.match(titleRule, /word-break: normal/);
  assert.match(titleRule, /overflow-wrap: normal/);
  assert.doesNotMatch(titleRule, /overflow-wrap:\s*anywhere|word-break:\s*break-all/);
  assert.match(css, /\.public-order-cart-actions\s*\{[\s\S]*min-width: max-content/);
});

test("approved compact, responsive and accessible UI primitives are present", () => {
  assert.match(menu, /public-order-status/);
  assert.match(menu, /public-order-desktop-cart/);
  assert.match(menu, /public-order-cart-bar/);
  assert.match(checkout, /role=\{isMobileViewport \? "dialog" : undefined\}/);
  assert.match(css, /\.public-order-category-tab\s*\{[\s\S]*min-height: 44px/);
  assert.match(css, /\.public-order-desktop-cart\s*\{[\s\S]*position: sticky/);
  assert.match(css, /:focus-visible/);
});

test("P6.0A changes stay out of APIs, migrations, RLS, packages and admin security UI", () => {
  const changedFiles = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "972a1317c9ca0d79cf12b8efe99f26489b262600",
      "2f988d0ab82f7fe56d7653dfe0208bdd42475a98",
      "--",
    ],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  assert.equal(changedFiles.some((path) => path.startsWith("app/api/")), false);
  assert.equal(changedFiles.some((path) => path.startsWith("supabase/")), false);
  assert.equal(changedFiles.some((path) => path.startsWith("app/admin/")), false);
  assert.equal(changedFiles.some((path) => path.startsWith("lib/admin/")), false);
  assert.equal(changedFiles.includes("package.json"), false);
  assert.equal(changedFiles.includes("package-lock.json"), false);
});
