# BUSINESS PANEL AUTHENTICATED E2E SCENARIO PROTOCOL

**Document Version:** 1.1.0
**Target Environment:** Local Mock Harness (`http://127.0.0.1:3100` via Next.js + `http://127.0.0.1:4010` Mock Supabase)
**Security Posture:**
- Synthetic isolated Supabase configuration (mock Auth, REST, RPC, Storage).
- Explicit child-env allowlist (only essential system variables inherited; parent credentials stripped).
- Browser main-target external requests are intercepted/blocked pre-network via CDP Fetch domain.
- Observed external requests = 0.
- Single-target CDP limitation on popup-target window inspection remains documented (S4.3).
**Status:** PROTOCOL SPECIFICATION ONLY (Execution deferred to dedicated E2E verification step).

---

## 1. Traceability to Phase 4 Readiness Fixes (F1–F5)

The E2E suites specifically validate that the five targeted Phase 4 production readiness fixes function seamlessly in a real authenticated browser session:

- **F1 (Intermediate Desktop Orders Responsiveness):** Between 1024px and 1200px breakpoints, ensure order cards, action controls, and badges layout without overlapping or awkward wrapping.
- **F2 (Profile Duplicate-Submit Guard):** During business profile update, ensure submit button disables, enters loading state, and ignores rapid consecutive clicks.
- **F3 (Mobile Menu Breakpoint & Focus Trap Cleanup):** On mobile viewport (<768px), opening the mobile drawer traps focus (`useModalFocusTrap`), pressing ESC or resizing past the breakpoint closes the drawer and restores focus cleanly to the trigger button.
- **F4 (Profile 120/30 Validation Boundaries):** Validates the 120-character business name constraint and 30-character WhatsApp order phone number limit with localized user feedback.
- **F5 (Long Product Name Wrapping):** Validates that long unbroken product titles (e.g. `ÇokÖzelGelenekselKözdePişirilmişSpesiyalKarışıkKebapTabağıBolGarnitürlüVeİkramlı`) wrap properly without breaking card layouts or overflowing table columns.

*(Note: Audio context unlock was an existing Phase 4 background preparation step, not an F1–F5 audit finding).*

---

## 2. Test Fixture Reference

- **Test User Email:** `e2e-business@example.invalid`
- **Test Password:** `SafeE2ELocalOnly2026!`
- **Business Name:** `E2E Test Kebap Salonu`
- **Initial Products:** 6 items (active, inactive, multiple categories, long unbroken title)
- **Initial Orders:** 5 items (`new`, `preparing`, `ready`, `delivered`, `cancelled`)

---

## 3. Scenario Suites Overview (42 Scenarios)

### Suite 1: Authentication & Session Management (5 Scenarios)
- **S1.1 Valid Password Login:** Navigate to `/giris`, fill email and password, submit. Verify session token saved in `sessionStorage` (`yerel-siparis-business-session`) and redirect to `/panel`.
- **S1.2 Invalid Credentials Handling:** Fill invalid password. Verify error message `Giriş başarısız. E-posta veya şifreyi kontrol edin.` is displayed; no navigation occurs.
- **S1.3 Direct /panel Navigation:** Refresh `/panel` while valid session exists. Verify panel mounts directly without redirecting to `/giris`.
- **S1.4 Explicit Logout:** Click "Çıkış Yap" in header. Verify `sessionStorage` is cleared, state resets, and browser redirects to `/giris`.
- **S1.5 Expired/Invalid Session Handling:** Tamper session token in `sessionStorage` and reload. Verify panel immediately clears token and redirects to `/giris`.

### Suite 2: Viewport & Responsive Design (6 Scenarios)
- **S2.1 Mobile Portrait (390 x 844):** Verify sticky top navigation, hamburger drawer button, stacked orders layout, full-bleed order detail modal.
- **S2.2 Tablet Portrait (768 x 1024):** Verify responsive grid adjustment, order filter pill container, and modal margins.
- **S2.3 Tablet Landscape (1024 x 768):** Verify dual-column balance and navigation bar expansion.
- **S2.4 Intermediate Desktop (1200 x 800 — Phase 4 F1):** Verify intermediate desktop orders grid; confirm action buttons, status pills, and customer info align cleanly without truncation or overlap.
- **S2.5 Standard Desktop (1366 x 768):** Verify full desktop dashboard summary metrics, order search/filter bar, and product management grid.
- **S2.6 Large Desktop (1440 x 900):** Verify max-width container constraints and centered aesthetic alignment.

### Suite 3: Order Management & Workflow (9 Scenarios)
- **S3.1 Order List Rendering:** Verify all 5 fixture orders render with correct badges, total prices in TL, and formatted timestamps.
- **S3.2 Status Filter Pills:** Toggle "Tümü", "Yeni", "Hazırlanıyor", "Hazır", "Teslim edildi", "İptal edildi". Verify filtered subsets update immediately.
- **S3.3 Live Order Search:** Search for customer name "Ahmet", phone "05559876543", or order number "#101". Verify matching orders display.
- **S3.4 Order Detail Expansion:** Click an order card. Verify line items, customer address, customer note, and price breakdowns expand accurately.
- **S3.5 Status Transition Workflow:** Transition order #101 from `new` to `preparing`. Verify status badge updates and persistence call completes.
- **S3.6 Order Cancellation Confirmation Modal:** Click "İptal Et" on an order. Verify confirmation modal appears, traps focus, and confirming cancels the order.
- **S3.7 In-Flight Double-Click Protection:** Double click status action rapidly. Verify only one PATCH mutation is dispatched; duplicate is blocked.
- **S3.8 Concurrency Conflict (409 ORDER_CONFLICT):** Attempt update with stale timestamp. Verify error banner "Sipariş başka bir oturumda güncellendi. Güncel bilgileri yükleyin." appears.
- **S3.9 Live Polling & New Order Alert:** Inject new order via `POST /__e2e/inject-order`. Verify polling detects new order, visual alert banner displays, and dismiss button clears it.

### Suite 4: Receipt Printing (2 Scenarios)
- **S4.1 58mm Thermal Print Dispatch:** Select 58mm option and click "Yazdır". Verify `/panel/yazdir` opens in popup window and `postMessage` delivers model.
- **S4.2 80mm Print Layout & Styles:** Select 80mm option and verify receipt content matches business name, order items, and total amount.

### Suite 5: Product Management (7 Scenarios)
- **S5.1 Category Filter Navigation:** Switch between "Tüm ürünler", "Dürümler", "Porsiyonlar", "İçecekler", "Tatlılar". Verify filtered lists match categories.
- **S5.2 Product Creation:** Open "Yeni Ürün Ekle", enter name, price, description, category, and submit. Verify item appears in product list.
- **S5.3 Product Form Validation:** Submit empty name or negative price. Verify inline validation errors prevent submission.
- **S5.4 Product Edit Modal:** Click "Düzenle" on existing product, update price, and save. Verify price updates immediately.
- **S5.5 Active/Passive Status Toggle:** Toggle product availability. Verify badge toggles between "Satışta" and "Satış Dışı".
- **S5.6 Product Reordering:** Move product up/down via sort buttons. Verify reorder RPC dispatches and updates sort orders.
- **S5.7 Long Product Name Wrapping (Phase 4 F5):** Inspect product `00000000-0000-4000-8000-000000001003` with long unbroken name. Verify CSS word-break and layout stability.

### Suite 6: Business Profile Management (5 Scenarios)
- **S6.1 Form Population:** Open Profile tab. Verify all fields populate with fixture values (`E2E Test Kebap Salonu`, Moda Cad., etc.).
- **S6.2 Profile Save:** Update preparation time and minimum order amount. Save and verify success notification.
- **S6.3 In-Flight Submit Guard (Phase 4 F2):** Click save; verify button enters disabled loading state and ignores subsequent clicks during save.
- **S6.4 120-Character Name Boundary (Phase 4 F4):** Enter 121 characters for business name. Verify validation warning blocks save.
- **S6.5 30-Character WhatsApp Boundary (Phase 4 F4):** Enter 31 characters for WhatsApp phone. Verify validation warning blocks save.

### Suite 7: Accessibility & Keyboard Navigation (5 Scenarios)
- **S7.1 Mobile Menu Focus Trap (Phase 4 F3):** Open mobile menu; verify focus is trapped within the drawer.
- **S7.2 Focus Restoration on Drawer Close (Phase 4 F3):** Close mobile drawer; verify focus returns to the hamburger button.
- **S7.3 Modal ESC Key Handling:** Open product modal or cancel modal; press `Escape`. Verify modal closes cleanly.
- **S7.4 Modal Tab Key Trapping (`useModalFocusTrap`):** Tab through open modal fields; verify focus cycles exclusively inside modal boundaries.
- **S7.5 Responsive Resize Dismissal (Phase 4 F3):** Open mobile drawer at 390px, then resize browser to 1024px. Verify drawer closes automatically and body scroll unlocks.

### Suite 8: Network & Console Integrity (3 Scenarios)
- **S8.1 Zero Console Errors:** Browser console logs must contain zero unhandled exceptions, zero React runtime errors, and zero unhandled rejections.
- **S8.2 Clean Network Traffic:** Network log must contain zero unexpected 4xx or 5xx responses (except intentional conflict tests).
- **S8.3 Zero Egress Audit:** 100% of network requests must target `http://127.0.0.1:3100` or `http://127.0.0.1:4010`. Browser main-target external requests are intercepted and blocked pre-network via CDP Fetch domain; observed external requests = 0.

---

## 4. Execution Command for Later Step

When authorized to run the browser suite, execution will start the harness via:
```bash
npx tsx tests/e2e/run-e2e.ts
```
followed by Antigravity `browser_subagent` running the interactive suites against `http://127.0.0.1:3100`.
