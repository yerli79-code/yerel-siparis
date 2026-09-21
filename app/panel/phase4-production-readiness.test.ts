import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  validateProfileForm,
  type ProfileForm,
} from "./profile-form";

const panelSource = readFileSync(resolve("app/panel/page.tsx"), "utf8");
const cssSource = readFileSync(resolve("app/panel/panel.module.css"), "utf8");
const focusTrapSource = readFileSync(
  resolve("app/panel/useModalFocusTrap.ts"),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  if (startIndex === -1) throw new Error(`Could not find start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  if (endIndex === -1) throw new Error(`Could not find end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function makeValidProfileForm(): ProfileForm {
  return {
    name: "Örnek Kebap Salonu",
    description: "Lezzetli kebaplar",
    whatsappOrderNumber: "905551234567",
    city: "İstanbul",
    district: "Kadıköy",
    neighborhood: "Moda",
    address: "Moda Cad. No: 42",
    deliveryStatus: "Adrese teslimat ve gel-al",
    paymentMethodMode: "cash_or_card",
    minimumOrderAmount: "150",
    preparationTimeMinutes: "30",
    isOpen: true,
    orderNote: "Afiyet olsun",
    serviceRadiusKm: "5",
    logoUrl: "",
    coverImageUrl: "",
  };
}

// ============================================================================
// F1 — Intermediate Desktop Orders Responsiveness (Breakpoint >= 1200px)
// ============================================================================

test("F1: 1024px desktop breakpoint does not activate unsafe dense orders layout", () => {
  const desktop1024Section = sourceBetween(
    cssSource,
    "@media screen and (min-width: 1024px) {",
    "@media screen and (min-width: 1200px) {",
  );

  // Desktop sidebar remains active at 1024px
  assert.match(desktop1024Section, /business-panel-sidebar\)/);
  assert.match(desktop1024Section, /grid-template-columns: 238px minmax\(0, 1fr\)/);

  // Dense orders layout MUST NOT be in the 1024px block
  assert.doesNotMatch(desktop1024Section, /\.panelScope :global\(\.panel-order-row\)/);
  assert.doesNotMatch(desktop1024Section, /\.panelScope :global\(\.panel-order-filter-form\)/);
});

test("F1: dense orders layout activates at safe min-width: 1200px breakpoint", () => {
  const desktop1200Section = sourceBetween(
    cssSource,
    "@media screen and (min-width: 1200px) {",
    "@media screen and (max-width: 370px) {",
  );

  // Filter form dense single-row layout
  assert.match(
    desktop1200Section,
    /\.panelScope :global\(\.panel-order-filter-form\) \{[\s\S]*grid-template-columns: minmax\(240px, 1\.4fr\) minmax\(300px, 1fr\) auto/,
  );
  assert.match(
    desktop1200Section,
    /\.panelScope :global\(\.panel-order-filter-actions\) \{[\s\S]*grid-column: auto/,
  );

  // Dense 7-column order row
  assert.match(
    desktop1200Section,
    /\.panelScope :global\(\.panel-order-row\) \{[\s\S]*grid-template-columns:[\s\S]*82px[\s\S]*minmax\(150px, 1\.4fr\)[\s\S]*100px[\s\S]*minmax\(120px, 1fr\)[\s\S]*90px[\s\S]*110px[\s\S]*22px/,
  );
  assert.match(desktop1200Section, /\.panelScope :global\(\.panel-order-type\)/);
  assert.match(desktop1200Section, /\.panelScope :global\(\.panel-order-payment\)/);
  assert.match(desktop1200Section, /\.panelScope :global\(\.panel-order-meta\)/);
});

// ============================================================================
// F2 — Profile Synchronous Duplicate-Submit Guard
// ============================================================================

test("F2: profile save in flight ref is declared and unmount cleaned", () => {
  assert.match(panelSource, /const profileSaveInFlightRef = useRef\(false\);/);
  const unmountSection = sourceBetween(panelSource, "useEffect(() => {", "const canManageProducts");
  assert.match(unmountSection, /profileSaveInFlightRef\.current = false;/);
});

test("F2: handleProfileSubmit establishes guard and saving state synchronously before first await", () => {
  const submitFnSource = sourceBetween(
    panelSource,
    "async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {",
    "async function handleSubmit(event: FormEvent<HTMLFormElement>) {",
  );

  // 1. Guard check at the very beginning of the function
  const guardCheckIdx = submitFnSource.indexOf("if (profileSaveInFlightRef.current) return;");
  assert.notEqual(guardCheckIdx, -1, "Synchronous guard check must exist");

  // 2. Synchronous validation occurs before locking
  const validationIdx = submitFnSource.indexOf("validateProfileForm();");
  assert.notEqual(validationIdx, -1);
  assert.ok(guardCheckIdx < validationIdx, "Guard check before validation");

  // 3. Lock set and visual saving indicator set BEFORE first await
  const lockSetIdx = submitFnSource.indexOf("profileSaveInFlightRef.current = true;");
  const savingSetIdx = submitFnSource.indexOf("setIsSavingProfile(true);");
  const firstAwaitIdx = submitFnSource.indexOf("await ");

  assert.notEqual(lockSetIdx, -1, "Must set profileSaveInFlightRef.current = true");
  assert.notEqual(savingSetIdx, -1, "Must set setIsSavingProfile(true)");
  assert.ok(lockSetIdx < firstAwaitIdx, "Lock must be set before first await");
  assert.ok(savingSetIdx < firstAwaitIdx, "Saving state must be set before first await");

  // 4. Token acquisition is inside try block
  const tryIdx = submitFnSource.indexOf("try {");
  const tokenIdx = submitFnSource.indexOf("await getFreshAccessToken()");
  assert.ok(tryIdx < tokenIdx, "Token acquisition must be inside try block");

  // 5. Finally block resets lock, saving state, and upload status
  const finallyIdx = submitFnSource.indexOf("} finally {");
  assert.notEqual(finallyIdx, -1);
  const finallySection = submitFnSource.slice(finallyIdx);
  assert.match(finallySection, /profileSaveInFlightRef\.current = false;/);
  assert.match(finallySection, /setIsSavingProfile\(false\);/);
  assert.match(finallySection, /setProfileUploadStatus\(""\);/);
});

test("F2: two immediate submissions cannot enter concurrently (simulation)", async () => {
  let inFlight = false;
  let executionCount = 0;

  async function submitSimulation() {
    if (inFlight) return "blocked";
    inFlight = true;
    try {
      // Simulate async token and profile update
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionCount += 1;
      return "executed";
    } finally {
      inFlight = false;
    }
  }

  const [res1, res2] = await Promise.all([submitSimulation(), submitSimulation()] );
  assert.equal(res1, "executed");
  assert.equal(res2, "blocked");
  assert.equal(executionCount, 1, "Only one execution sequence occurred");
  assert.equal(inFlight, false, "Lock released in finally");
});

// ============================================================================
// F3 — Mobile Menu Breakpoint & Hardened Focus Trap Cleanup
// ============================================================================

test("F3: mobile menu auto-closes upon entering desktop mode at 1024px breakpoint", () => {
  const breakpointEffectSource = sourceBetween(
    panelSource,
    'const mediaQuery = window.matchMedia("(min-width: 1024px)");',
    "if (isLoading || !business) return;",
  );

  assert.match(breakpointEffectSource, /if \(mediaQuery\.matches\) \{\s*setIsMobileMenuOpen\(false\);/);
  assert.match(breakpointEffectSource, /const handleChange = \(event: MediaQueryListEvent\) => \{[\s\S]*if \(event\.matches\) \{\s*setIsMobileMenuOpen\(false\);/);
  assert.match(breakpointEffectSource, /mediaQuery\.addEventListener\("change", handleChange\)/);
  assert.match(breakpointEffectSource, /mediaQuery\.removeEventListener\("change", handleChange\)/);
});

test("F3: useModalFocusTrap cleanup does not return focus to invisible target", () => {
  assert.match(
    focusTrapSource,
    /const isVisible =[\s\S]*returnTarget\?\.isConnected[\s\S]*returnTarget\.getAttribute\("aria-hidden"\) !== "true"[\s\S]*returnTarget\.getClientRects\(\)\.length > 0/,
  );
  assert.match(
    focusTrapSource,
    /if \(returnTarget\?\.isConnected && isVisible\) \{\s*returnTarget\.focus\(\{ preventScroll: true \}\);\s*\}/,
  );
});

test("F3: focus restoration behavior on visible vs hidden targets (simulation)", () => {
  let focusedId = "";

  const createMockElement = (options: {
    id: string;
    isConnected: boolean;
    ariaHidden?: string;
    clientRectCount: number;
  }) => ({
    id: options.id,
    isConnected: options.isConnected,
    getAttribute: (name: string) => (name === "aria-hidden" ? options.ariaHidden ?? null : null),
    getClientRects: () => new Array(options.clientRectCount).fill({ width: 44, height: 44 }),
    focus: () => {
      focusedId = options.id;
    },
  });

  function performCleanup(returnTarget: any) {
    const isVisible =
      returnTarget?.isConnected &&
      returnTarget.getAttribute("aria-hidden") !== "true" &&
      (typeof returnTarget.getClientRects !== "function" ||
        returnTarget.getClientRects().length > 0);
    if (returnTarget?.isConnected && isVisible) {
      returnTarget.focus();
    }
  }

  // 1. Mobile menu button hidden on desktop (display: none -> clientRects = 0)
  focusedId = "";
  const hiddenTrigger = createMockElement({
    id: "menu-trigger",
    isConnected: true,
    clientRectCount: 0,
  });
  performCleanup(hiddenTrigger);
  assert.equal(focusedId, "", "Focus must NOT be returned to hidden trigger");

  // 2. Mobile menu button visible on mobile (clientRects > 0)
  focusedId = "";
  const visibleTrigger = createMockElement({
    id: "menu-trigger",
    isConnected: true,
    clientRectCount: 1,
  });
  performCleanup(visibleTrigger);
  assert.equal(focusedId, "menu-trigger", "Focus MUST be returned to visible trigger");

  // 3. Disconnected trigger
  focusedId = "";
  const disconnectedTrigger = createMockElement({
    id: "menu-trigger",
    isConnected: false,
    clientRectCount: 1,
  });
  performCleanup(disconnectedTrigger);
  assert.equal(focusedId, "", "Focus must NOT be returned to disconnected trigger");
});

// ============================================================================
// F4 — Profile Client Validation Limits (Business Name 120, WhatsApp 30)
// ============================================================================

test("F4: validateProfileForm accepts 120-character trimmed business name", () => {
  const form = makeValidProfileForm();
  form.name = "A".repeat(120);
  assert.equal(validateProfileForm(form), "");
});

test("F4: validateProfileForm preserves business name trimming semantics", () => {
  const form = makeValidProfileForm();
  form.name = "   " + "B".repeat(120) + "   ";
  assert.equal(validateProfileForm(form), "");
});

test("F4: validateProfileForm rejects 121-character business name with exact Turkish error", () => {
  const form = makeValidProfileForm();
  form.name = "A".repeat(121);
  assert.equal(
    validateProfileForm(form),
    "İşletme adı en fazla 120 karakter olabilir.",
  );
});

test("F4: validateProfileForm rejects empty or whitespace business name", () => {
  const form = makeValidProfileForm();
  form.name = "    ";
  assert.equal(validateProfileForm(form), "İşletme adı boş olamaz.");
});

test("F4: validateProfileForm accepts 30-character trimmed WhatsApp number", () => {
  const form = makeValidProfileForm();
  form.whatsappOrderNumber = "9".repeat(30);
  assert.equal(validateProfileForm(form), "");
});

test("F4: validateProfileForm preserves WhatsApp number trimming semantics", () => {
  const form = makeValidProfileForm();
  form.whatsappOrderNumber = "  " + "9".repeat(30) + "  ";
  assert.equal(validateProfileForm(form), "");
});

test("F4: validateProfileForm rejects 31-character WhatsApp number with exact Turkish error", () => {
  const form = makeValidProfileForm();
  form.whatsappOrderNumber = "9".repeat(31);
  assert.equal(
    validateProfileForm(form),
    "WhatsApp sipariş numarası en fazla 30 karakter olabilir.",
  );
});

test("F4: businessName and businessWhatsapp inputs have matching maxLength attributes", () => {
  assert.match(
    panelSource,
    /<input[\s\S]*?id="businessName"[\s\S]*?maxLength=\{120\}/,
  );
  assert.match(
    panelSource,
    /<input[\s\S]*?id="businessWhatsapp"[\s\S]*?maxLength=\{30\}/,
  );
});

// ============================================================================
// F5 — Long Product Name Wrapping (overflow-wrap: anywhere)
// ============================================================================

test("F5: compact product name uses overflow-wrap: anywhere for unbroken names", () => {
  const compactNameStyle = sourceBetween(
    cssSource,
    ".panelScope :global(.panel-compact-main strong) {",
    ".panelScope :global(.panel-compact-meta) {",
  );

  assert.match(compactNameStyle, /overflow-wrap:\s*anywhere;/);
  assert.match(compactNameStyle, /word-break:\s*normal;/);
});
