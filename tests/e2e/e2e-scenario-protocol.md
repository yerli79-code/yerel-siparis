# BUSINESS PANEL AUTHENTICATED E2E SCENARIO PROTOCOL

**Document Version:** 1.1.0
**Target Environment:** Local Mock Harness (`http://127.0.0.1:3100` via Next.js + `http://127.0.0.1:4010` Mock Supabase)
**Security Posture:**
- Synthetic isolated Supabase configuration (mock Auth, REST, RPC, Storage).
- Explicit child-env allowlist (only essential system variables inherited; parent credentials stripped).
- Browser main-target external requests are intercepted/blocked pre-network via CDP Fetch domain.
- Observed external requests = 0.
- Single-target CDP limitation on popup-target window inspection remains documented (S4.3).
**Status:** VERIFIED SPECIFICATION (Harness fully implemented and executed locally: 47 PASS, 0 FAIL, 1 SKIP — TOOL LIMITATION).

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

## 3. Scenario Suites Overview (48 Scenarios across 10 Suites)

### Suite 1: Authentication & Session Management (5 Scenarios)
- **S1.2 Invalid Credentials Handling:** Fill invalid password. Verify error message `Giriş başarısız. E-posta veya şifreyi kontrol edin.` is displayed; no navigation occurs.
- **S1.1 Valid Password Login:** Navigate to `/giris`, fill email and password, submit. Verify session token saved in `sessionStorage` (`yerel-siparis-business-session`) and redirect to `/panel`.
- **S1.3 Direct /panel Navigation:** Refresh `/panel` while valid session exists. Verify panel mounts directly without redirecting to `/giris`.
- **S1.4 Explicit Logout:** Click "Çıkış Yap" in header. Verify `sessionStorage` is cleared, state resets, and browser redirects to `/giris`.
- **S1.5 Expired/Invalid Session Handling:** Tamper session token in `sessionStorage` and reload. Verify panel immediately clears token and redirects to `/giris`.

### Suite 2: Viewport & Responsive Design (9 Scenarios)
- **S2.1.VP390 Mobile Portrait (390 x 844):** Verify responsive layout, mobile header, hamburger button, stacked orders layout.
- **S2.2.VP768 Tablet Portrait (768 x 1024):** Verify grid adjustment, order filter pill container, and modal margins.
- **S2.3.VP1024 Small Desktop (1024 x 768):** Verify dual-column balance and navigation bar expansion.
- **S2.4.VP1100 Intermediate Desktop (1100 x 800):** Verify intermediate grid layout before dense breakpoint.
- **S2.5.VP1199 Pre-Threshold Desktop (1199 x 800):** Verify layout stability right below dense threshold.
- **S2.6.VP1200 Dense Desktop Breakpoint (1200 x 800):** Verify activation of dense 7-column order layout.
- **S2.7.VP1366 Standard Desktop (1366 x 768):** Verify standard desktop dashboard summary metrics and grids.
- **S2.8.VP1440 Large Desktop (1440 x 900):** Verify max-width container constraints and centered aesthetic alignment.
- **PHASE4.F1 Intermediate Desktop Transition:** Verify dense orders layout activates strictly at >=1200px and does not trigger prematurely at 1024-1199px.

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

### Suite 4: Receipt Printing (4 Scenarios)
- **S4.1 58mm Thermal Print Selection:** Select 58mm option and verify state binding.
- **S4.2 80mm Print Selection:** Select 80mm option and verify state binding.
- **S4.3 Print Popup Window Launch & postMessage Inspection:** Explicitly recorded as **SKIP — TOOL LIMITATION** (single-target headless Chrome CDP attaches to the primary page target; child popup window DOM and cross-window `postMessage` inspection requires multi-target session management).
- **S4.4 Direct Print Route Rendering:** Navigate to `/panel/yazdir`. Verify print document template and styles load cleanly on dedicated print route.

### Suite 5: Product Management (7 Scenarios)
- **S5.1 Category Filter Navigation:** Switch between "Tüm ürünler", "Dürümler", "Porsiyonlar", "İçecekler", "Tatlılar". Verify filtered lists match categories.
- **S5.3 Product Form Validation:** Submit empty name. Verify inline validation error blocks submission.
- **S5.2 Product Creation:** Open "Yeni Ürün Ekle", enter name, price, and submit. Verify item appears in product list.
- **S5.4 Active/Passive Status Toggle:** Toggle product availability. Verify badge updates to "Satış Dışı" and backend is persisted.
- **S5.5 Product Reordering:** Move product down via sort button. Verify reorder RPC dispatches and product positions shift.
- **S5.6 Concurrency Conflict (409 PRODUCT_CONFLICT):** Attempt reorder with stale timestamp. Verify conflict alert appears and reloads authoritative state.
- **S5.7 Long Product Name Wrapping (Phase 4 F5):** Inspect product with long unbroken title. Verify CSS overflow-wrap prevents card overflow.

### Suite 6: Storage & Image Upload (1 Scenario)
- **S6.1 Real Browser Storage Image Upload:** Real file upload dispatched via CDP `DOM.setFileInputFiles` strictly to local mock storage (`127.0.0.1:4010`).

### Suite 7: Business Profile Management (5 Scenarios)
- **S7.1 Form Population & Backend Fidelity Check:** Open Profile tab. Verify all 6 profile fields populate with fixture values (`E2E Test Kebap Salonu`, Moda Cad., etc.).
- **S7.2 Profile Save:** Update preparation time and save. Verify success notification and persistence.
- **S7.3 In-Flight Submit Guard (Phase 4 F2):** Rapid consecutive save clicks; verify button enters disabled loading state and duplicate is blocked.
- **S7.4 120-Character Name Boundary (Phase 4 F4):** Enter 121 characters for business name. Verify client validation warning blocks save.
- **S7.5 30-Character WhatsApp Boundary (Phase 4 F4):** Enter 31 characters for WhatsApp phone. Verify client validation warning blocks save.

### Suite 8: Subscription Gating (1 Scenario)
- **S8.1 Subscription Gating:** Mutation controls disabled when business subscription is `expired`, and restored automatically when `active`.

### Suite 9: Accessibility & Keyboard Navigation (5 Scenarios)
- **S9.1 Mobile Menu Focus Trap (Phase 4 F3):** Open mobile menu; verify focus is trapped within the drawer (`useModalFocusTrap`).
- **S9.2 Focus Restoration on Drawer Close (Phase 4 F3):** Close mobile drawer; verify focus returns to the hamburger button.
- **S9.3 Modal ESC Key Handling:** Open modal; press `Escape`. Verify modal closes cleanly.
- **S9.4 Modal Tab Key Trapping:** Tab through open modal fields; verify focus cycles exclusively inside modal boundaries.
- **S9.5 Responsive Resize Dismissal (Phase 4 F3):** Open mobile drawer at 390px, then resize browser to 1024px desktop. Verify drawer closes automatically, body scroll unlocks, and hidden trigger safely unfocuses.

### Suite 10: Network & Console Integrity (2 Scenarios)
- **S10.1 Hard Egress Gate:** 100% of HTTP, HTTPS, and WebSocket network requests strictly constrained to `127.0.0.1:3100` and `127.0.0.1:4010`. Pre-network CDP `Fetch.enable` interception blocks external attempts; zero external requests observed.
- **S10.2 Console Audit:** Clean runtime execution with zero unexpected browser console errors and zero unhandled rejections.

---

## 4. Execution Workflow

The local E2E harness is executed in two steps:

1. **Start isolated dev and mock backend servers:**
```bash
npx tsx tests/e2e/run-e2e.ts
```
*(Runs loopback mock Supabase on `127.0.0.1:4010` and Next.js dev server on `127.0.0.1:3100` with child-env allowlist sanitization).*

2. **Execute the automated browser test runner in a separate terminal:**
```bash
npx tsx tests/e2e/browser-e2e-runner.ts
```
*(Controls headless Google Chrome via zero-dependency native Node.js WebSocket CDP with pre-network Fetch interception, running all 48 scenarios and outputting `business-panel-browser-e2e-report.txt`).*
