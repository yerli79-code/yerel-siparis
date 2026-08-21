import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

type DeliveryAddress = {
  district: string;
  neighborhood: string;
  streetAddress: string;
  building: string;
  floorUnit: string;
  directions: string;
};

type AddressHelpers = {
  emptyPublicOrderDeliveryAddress: DeliveryAddress;
  composePublicOrderDeliveryAddress: (address: DeliveryAddress) => string;
  parsePublicOrderDeliveryAddress: (value: string) => DeliveryAddress;
};

const moduleSource = readFileSync(
  new URL("./public-order-address.ts", import.meta.url),
  "utf8",
);
const javascript = ts.transpileModule(moduleSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const loaded = { exports: {} as Record<string, unknown> };
Function("exports", "module", javascript)(loaded.exports, loaded);
const {
  composePublicOrderDeliveryAddress,
  emptyPublicOrderDeliveryAddress,
  parsePublicOrderDeliveryAddress,
} = loaded.exports as AddressHelpers;

test("structured delivery fields compose into the existing address string deterministically", () => {
  assert.equal(
    composePublicOrderDeliveryAddress({
      district: " Kadıköy ",
      neighborhood: "Caferağa",
      streetAddress: "Moda Caddesi No: 10",
      building: "Güneş Apartmanı",
      floorUnit: "3 / 7",
      directions: "Parkın karşısı",
    }),
    [
      "İlçe: Kadıköy",
      "Mahalle: Caferağa",
      "Adres: Moda Caddesi No: 10",
      "Bina: Güneş Apartmanı",
      "Kat/Daire: 3 / 7",
      "Tarif: Parkın karşısı",
    ].join("\n"),
  );
});

test("composed delivery addresses round-trip without duplicating labels", () => {
  const address = {
    district: "Beşiktaş",
    neighborhood: "Abbasağa",
    streetAddress: "Yıldız Caddesi 12",
    building: "Yıldız Apartmanı",
    floorUnit: "2 / 5",
    directions: "Bahçe kapısını kullanın",
  };
  const composed = composePublicOrderDeliveryAddress(address);

  assert.deepEqual(parsePublicOrderDeliveryAddress(composed), address);
  assert.equal(
    composePublicOrderDeliveryAddress(parsePublicOrderDeliveryAddress(composed)),
    composed,
  );
});

test("multiline freeform legacy addresses remain intact after parse and compose", () => {
  const legacyAddress = [
    "Gül Sokak No: 15",
    "Zil 7",
    "Arka girişten gelin",
  ].join("\n");
  const parsedAddress = parsePublicOrderDeliveryAddress(legacyAddress);

  assert.deepEqual(parsedAddress, {
    ...emptyPublicOrderDeliveryAddress,
    streetAddress: legacyAddress,
  });
  assert.equal(
    composePublicOrderDeliveryAddress(parsedAddress),
    `Adres: ${legacyAddress}`,
  );
});

test("mixed recognized and unrecognized lines preserve every legacy line", () => {
  const mixedAddress = [
    "İlçe: Kadıköy",
    "Moda Caddesi No: 10",
    "Mavi kapının yanı",
  ].join("\n");
  const parsedAddress = parsePublicOrderDeliveryAddress(mixedAddress);
  const recomposedAddress = composePublicOrderDeliveryAddress(parsedAddress);

  assert.equal(parsedAddress.district, "Kadıköy");
  assert.equal(
    parsedAddress.streetAddress,
    ["Moda Caddesi No: 10", "Mavi kapının yanı"].join("\n"),
  );
  assert.equal(
    recomposedAddress,
    [
      "İlçe: Kadıköy",
      "Adres: Moda Caddesi No: 10",
      "Mavi kapının yanı",
    ].join("\n"),
  );
  assert.equal(
    composePublicOrderDeliveryAddress(
      parsePublicOrderDeliveryAddress(recomposedAddress),
    ),
    recomposedAddress,
  );
});

test("recognized address plus delivery instructions stays lossless", () => {
  const mixedAddress = [
    "Adres: Gül Sokak No: 15",
    "Zil 7",
    "Arka girişten gelin",
  ].join("\n");
  const parsedAddress = parsePublicOrderDeliveryAddress(mixedAddress);

  assert.equal(
    parsedAddress.streetAddress,
    ["Gül Sokak No: 15", "Zil 7", "Arka girişten gelin"].join("\n"),
  );
  assert.equal(composePublicOrderDeliveryAddress(parsedAddress), mixedAddress);
});

test("legacy saved single-string addresses remain backward compatible", () => {
  assert.deepEqual(parsePublicOrderDeliveryAddress("Eski kayıtlı açık adres"), {
    ...emptyPublicOrderDeliveryAddress,
    streetAddress: "Eski kayıtlı açık adres",
  });
  assert.deepEqual(
    parsePublicOrderDeliveryAddress("  "),
    emptyPublicOrderDeliveryAddress,
  );
});
