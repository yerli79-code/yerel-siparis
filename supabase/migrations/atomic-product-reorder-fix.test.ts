import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const historicalBytes = readFileSync(new URL("./20260829061343_atomic_product_reorder.sql", import.meta.url));
const historical = historicalBytes.toString("utf8").replace(/\r\n/g, "\n");
const corrected = readFileSync(new URL("./20260921125217_fix_atomic_product_reorder_json_validation.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("historical reorder migration content remains immutable across Git line endings", () => {
  assert.equal(createHash("sha256").update(historical).digest("hex"), "ac34b08fba03eebad3ba9d50a80c0a2277d6b9e4e743f8c5688258096bcc219e");
});

test("forward migration only replaces the unsupported object-length expression", () => {
  assert.equal(corrected, historical.replace(
    "jsonb_object_length(requested.item) <> 3",
    "(\n        select count(*)\n        from jsonb_object_keys(requested.item)\n      ) <> 3",
  ));
});

test("forward migration preserves required keys and rejects additional keys using built-ins", () => {
  assert.doesNotMatch(corrected, /jsonb_object_length/);
  assert.match(corrected, /jsonb_typeof\(requested\.item\) <> 'object'/);
  assert.match(corrected, /not requested\.item \?& array\[\s*'productId',\s*'sortOrder',\s*'expectedUpdatedAt'\s*\]/);
  assert.match(corrected, /\(\s*select count\(\*\)\s*from jsonb_object_keys\(requested\.item\)\s*\) <> 3/);
});
