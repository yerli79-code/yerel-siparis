# Authenticated Admin browser E2E protocol

This harness runs only on the developer machine with synthetic identities and a local mock Supabase server. It does not use production credentials, production auth, a production database, migrations, or deployment. The generated `admin-panel-browser-e2e-report.txt` is local evidence and is not committed.

## Scope and result semantics

The runner executes 51 browser scenarios in 11 suites: Authentication (8), Overview (4), Business List (6), Business Detail (5), Safe Profile Update (4), Critical Operations (7), Phase 1 Regression (4), Responsive Viewports (5), Accessibility (4), Business Creation (1), and Network & Console (3). The final clean run returned 51 PASS, 0 FAIL, 0 SKIP, and 0 INCONCLUSIVE. Business Creation uses an authenticated browser request to create a synthetic owner and business against the local mock, then verifies list/detail visibility and one `business.created` timeline entry with an initial state.

`PASS` means the browser executed the scenario and its asserted result was observed. `FAIL` means an assertion failed or the scenario raised an exception. `SKIP — TOOL LIMITATION` means the runner could not execute a check because of a genuine tool limitation; it is never counted as PASS. `INCONCLUSIVE` means the evidence did not support a determination. The final run had no skips or inconclusive checks.

## Local data and services

- Synthetic active Admin: `admin@example.invalid`; synthetic inactive Admin: `inactive-admin@example.invalid`; synthetic business user: `e2e-business@example.invalid`. Passwords and mock tokens are defined in `fixtures.ts` and have no production use.
- Fixtures contain five synthetic businesses, six products and five orders for the primary business, plus owner profiles and synthetic Admin audit records. Mock mutations are reset at the start of each browser run.
- Next.js binds to `http://127.0.0.1:3100`; mock Supabase binds to `http://127.0.0.1:4010`; Chrome DevTools listens locally on port 9222 for the runner. The browser request gate permits HTTP only to the two application/mock endpoints, along with non-network `about:blank`, `data:` and `blob:` URLs whose embedded origin is one of those loopback endpoints.

`run-e2e.ts` constructs the Next.js child environment from an explicit allowlist of system variables (`PATH`, `PATHEXT`, `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `TEMP`, `TMP`, `TMPDIR`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `APPDATA`, `PROGRAMFILES`, `PROGRAMFILES(X86)`, `PROGRAMW6432`, `COMMONPROGRAMFILES`, `COMMONPROGRAMFILES(X86)`, `COMMONPROGRAMW6432`, `NUMBER_OF_PROCESSORS`, `PROCESSOR_ARCHITECTURE`, `PROCESSOR_IDENTIFIER`, `SYSTEMDRIVE`, `HOME`, `SHELL`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `TERM`). It injects only local/synthetic application values for `NODE_ENV`, `PORT`, `HOSTNAME`, `NO_PROXY`, `NEXT_TELEMETRY_DISABLED`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVER_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_URL`, and `SUPABASE_BACKUP_SECRET_KEY`. Unrelated parent credentials are not passed to the child. `.env.local` is not modified.

The Chrome page target enables CDP `Fetch` interception before navigation; every paused request is allowed only by the exact URL gate or failed before network dispatch. `Network.requestWillBeSent` is a secondary audit. Chrome background networking, sync, and component updates are disabled. For local Admin mutations only, the runner normalizes the exact `Origin: http://127.0.0.1:3100` header to `http://localhost:3100` to match the Next.js dev server's request origin. This does not allow navigation or requests to `localhost`, other hosts, ports, or external HTTP/HTTPS targets. The clean run observed browser host `127.0.0.1:3100`, zero external attempts, zero blocked external attempts, zero production endpoint attempts, and zero unexpected browser console errors or exceptions. This is browser page-target interception and audit, not an OS-level sandbox.

## Reproduce

From the repository root, with ports 3100, 4010, and 9222 free:

```powershell
npx tsx --test tests/e2e/mock-supabase-server.test.ts
npx tsc --noEmit
npx tsx tests/e2e/run-e2e.ts
```

Wait for `E2E_LOCAL_ENV_READY`, then in a separate terminal:

```powershell
npx tsx tests/e2e/admin-e2e-runner.ts
```

The runner writes `admin-panel-browser-e2e-report.txt` in the repository root. Stop the harness after the browser run. Review the report's scenario table and dynamic network/console audit; a failed scenario or external attempt produces a nonzero runner exit.

This is not the final Customer + Business + Admin platform acceptance test.
