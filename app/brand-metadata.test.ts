import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const readText = (path: string) => readFileSync(resolve(path), "utf8");

test("browser favicon uses the canonical green public mark", () => {
  const normalizeLines = (value: string) => value.replaceAll("\r\n", "\n");
  assert.equal(
    normalizeLines(readText("app/icon.svg")).trim(),
    normalizeLines(readText("public/brand/yerel-siparis-public-mark.svg")).trim(),
  );
  assert.match(readText("app/icon.svg"), /#095D27/);
});

test("legacy blue favicon sources are removed without duplicate icons", () => {
  assert.equal(existsSync(resolve("app/favicon.ico")), false);
  assert.equal(existsSync(resolve("app/icon.png")), false);
  assert.equal(existsSync(resolve("app/icon.svg")), true);
});

test("apple icon is the checked-in green canonical raster", () => {
  const appleIcon = readFileSync(resolve("app/apple-icon.png"));
  const digest = createHash("sha256").update(appleIcon).digest("hex");

  assert.equal(
    digest,
    "37599142ceb03191cc67d78ddf8e646b9ec3a2aee3abe38e6bedc633c5ac144b",
  );
});

test("root viewport uses the canonical primary green theme color", () => {
  const layout = readText("app/layout.tsx");

  assert.match(layout, /themeColor: "#095D27"/);
  assert.doesNotMatch(layout, /#127C92/);
});
