import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const panelSource = readFileSync(resolve("app/panel/page.tsx"), "utf8");
const panelCss = readFileSync(resolve("app/panel/panel.module.css"), "utf8");
const headerSource = panelSource.slice(
  panelSource.indexOf('<header className="business-panel-header">'),
  panelSource.indexOf("</header>") + "</header>".length,
);

test("panel header renders the optional business logo with accessible copy", () => {
  assert.match(panelSource, /if \(!business\.logoUrl \|\| failedLogoUrl === business\.logoUrl\) return null/);
  assert.match(headerSource, /<BusinessIdentityLogo business=\{business\}/);
  assert.match(panelSource, /alt=\{`\$\{business\.name\} logosu`\}/);
  assert.match(panelSource, /src=\{business\.logoUrl\}/);
});

test("failed business logos hide without leaving a broken image container", () => {
  assert.match(panelSource, /onError=\{\(\) => setFailedLogoUrl\(business\.logoUrl\)\}/);
  assert.match(panelSource, /failedLogoUrl === business\.logoUrl/);
});

test("platform brand stays primary and cover image stays out of the panel header", () => {
  assert.match(headerSource, /<PlatformBrand[^>]*publicVariant/);
  assert.doesNotMatch(headerSource, /coverImageUrl/);
});

test("business identity logo keeps contained responsive dimensions", () => {
  const logoRule = panelCss.match(/\.business-panel-identity-logo\) \{([^}]*)\}/)?.[1];
  const imageRule = panelCss.match(/\.business-panel-identity-logo img\) \{([^}]*)\}/)?.[1];
  const mobileRule = panelCss.match(
    /@media \(max-width: 767px\)[^]*?\.business-panel-identity-logo\) \{([^}]*)\}/,
  )?.[1];

  assert.ok(logoRule);
  assert.match(logoRule, /width: 56px/);
  assert.match(logoRule, /height: 56px/);
  assert.match(logoRule, /flex-shrink: 0/);
  assert.ok(imageRule);
  assert.match(imageRule, /object-fit: contain/);
  assert.match(panelCss, /business-panel-header-copy h1\) \{[^}]*min-width: 0/);
  assert.ok(mobileRule);
  assert.match(mobileRule, /width: 46px/);
  assert.match(mobileRule, /height: 46px/);
});
