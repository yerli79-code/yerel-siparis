import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEGACY_DELIVERY_STATUS_SENTINEL,
  getDisplayDeliveryStatus,
  isLegacyDeliveryStatusSentinel,
  normalizeDeliveryStatus,
} from "./delivery-settings";

test("isLegacyDeliveryStatusSentinel identifies legacy sentinel variants", () => {
  assert.equal(isLegacyDeliveryStatusSentinel("Teslimat bilgisi eklenmedi"), true);
  assert.equal(isLegacyDeliveryStatusSentinel("  Teslimat bilgisi eklenmedi  "), true);
  assert.equal(isLegacyDeliveryStatusSentinel("teslimat bilgisi eklenmedi"), true);
  assert.equal(isLegacyDeliveryStatusSentinel("TESLİMAT BİLGİSİ EKLENMEDİ"), true);

  assert.equal(isLegacyDeliveryStatusSentinel(null), false);
  assert.equal(isLegacyDeliveryStatusSentinel(undefined), false);
  assert.equal(isLegacyDeliveryStatusSentinel(""), false);
  assert.equal(isLegacyDeliveryStatusSentinel("   "), false);
  assert.equal(isLegacyDeliveryStatusSentinel("Paket servis ve gel-al"), false);
  assert.equal(isLegacyDeliveryStatusSentinel("Sadece Gel-Al"), false);
});

test("normalizeDeliveryStatus treats null, empty, whitespace and legacy sentinel as null", () => {
  assert.equal(normalizeDeliveryStatus(null), null);
  assert.equal(normalizeDeliveryStatus(undefined), null);
  assert.equal(normalizeDeliveryStatus(""), null);
  assert.equal(normalizeDeliveryStatus("   "), null);
  assert.equal(normalizeDeliveryStatus("Teslimat bilgisi eklenmedi"), null);
  assert.equal(normalizeDeliveryStatus("  Teslimat bilgisi eklenmedi  "), null);
  assert.equal(normalizeDeliveryStatus("teslimat bilgisi eklenmedi"), null);
});

test("normalizeDeliveryStatus preserves and trims genuine delivery text", () => {
  assert.equal(
    normalizeDeliveryStatus("Paket servis ve gel-al"),
    "Paket servis ve gel-al",
  );
  assert.equal(
    normalizeDeliveryStatus("  Sadece Gel-Al  "),
    "Sadece Gel-Al",
  );
  assert.equal(
    normalizeDeliveryStatus("Belirli mahallelere teslimat"),
    "Belirli mahallelere teslimat",
  );
});

test("getDisplayDeliveryStatus returns clean string for UI rendering", () => {
  assert.equal(getDisplayDeliveryStatus(null), "");
  assert.equal(getDisplayDeliveryStatus(""), "");
  assert.equal(getDisplayDeliveryStatus("   "), "");
  assert.equal(getDisplayDeliveryStatus("Teslimat bilgisi eklenmedi"), "");
  assert.equal(
    getDisplayDeliveryStatus("Paket servis ve gel-al"),
    "Paket servis ve gel-al",
  );
});
