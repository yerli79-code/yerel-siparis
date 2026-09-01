import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const privacyPage = source("app/gizlilik/page.tsx");
const homePage = source("app/HomePageClient.tsx");
const sitemap = source("app/sitemap.ts");

test("public privacy page declares canonical metadata and the Drive backup purpose", () => {
  assert.match(privacyPage, /title: "Gizlilik Politikası"/);
  assert.match(privacyPage, /canonical: privacyUrl/);
  assert.match(privacyPage, /https:\/\/yerelsiparis\.com\/gizlilik/);
  assert.match(privacyPage, /Google Drive Yedekleme/);
  assert.match(
    privacyPage,
    /sistem yedeklerini[\s\S]*oluşturmak, yüklemek, yönetmek ve gerektiğinde geri yüklemek/,
  );
});

test("privacy page keeps Google Drive access narrow and credentials confidential", () => {
  assert.match(privacyPage, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
  assert.match(privacyPage, /diğer Google Drive dosyalarına genel veya sınırsız erişim/);

  for (const credential of [
    "OAuth client secret",
    "authorization code",
    "access token",
    "refresh token",
  ]) {
    assert.match(privacyPage, new RegExp(credential));
  }

  assert.match(privacyPage, /herkese açık hale getirilmez/);
  assert.match(privacyPage, /istemci tarafı koda yerleştirilmez/);
});

test("privacy page states the data-use limits and access revocation path", () => {
  assert.match(privacyPage, /reklam amacıyla kullanılmaz ve satılmaz/);
  assert.match(privacyPage, /https:\/\/myaccount\.google\.com\/permissions/);
});

test("privacy policy is discoverable from the homepage and sitemap", () => {
  assert.match(homePage, /href="\/gizlilik"[\s\S]*Gizlilik Politikası/);
  assert.match(sitemap, /`\$\{siteUrl\}\/gizlilik`/);
});
