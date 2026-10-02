# Final acceptance regression harness

These tests exercise local fixtures and checked-in application code. They do not
require a hosted Supabase project, production credentials, or a deployment.
Application and migration files are inputs, not files the harness changes.

## Local prerequisites and execution

- Tested locally with Node.js 24 and an already installed `tsx` 4 runner. This
  repository has no npm test script or declared `tsx` dependency. Supply an
  existing runner; dependency/package changes are outside this cleanup.
- The browser helper currently uses Windows Google Chrome at
  `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- App/mock ports are fixed at loopback `3100` and `4010`. CDP ports are `9222`
  (Business E2E), `9224` (upload tests), and `9233`/`9234` (two-browser isolation).
  All must be free before starting. Browser suites share resettable mock state;
  execute them sequentially against a harness owned by the current test run.
- Start `tests/e2e/run-e2e.ts` first and wait for `E2E_LOCAL_ENV_READY` before
  running the browser commands. The harness supplies synthetic Supabase values
  and a sanitized child environment. Use a disposable source copy without
  `.env.local`, `.vercel`, or other local configuration when validating builds
  and browser tests. Do not reuse production servers or existing evidence files.
- Set `E2E_REPORT_PATH` to a new output filename outside the source tree for
  Business E2E; the runner refuses to overwrite it. Set the process temporary
  directory to a new validation directory for browser profiles and other new
  evidence. Preserve previous reports/evidence.

Using an existing `tsx` executable from the repository/source-copy root:

```text
tsx --test tests/e2e/mock-supabase-server.test.ts tests/e2e/business-browser-fixtures.test.ts tests/e2e/network-evidence-redaction.test.ts tests/e2e/browser-e2e-report.test.ts
tsx --test tests/e2e/business-two-account-isolation.test.ts
tsx tests/e2e/run-e2e.ts
```

Once the harness is ready, run each command separately, in order:

```text
tsx --test tests/e2e/upload-network.test.ts
tsx tests/e2e/browser-e2e-runner.ts
tsx tests/e2e/business-browser-isolation.ts
```

Stop only the servers and browser processes owned by that validation run.

For `next build`, stop the Next dev process first because both use `.next` in
the source copy. Keep only a run-owned mock on loopback `4010` available and
use the same synthetic Supabase environment values: sitemap prerendering reads
the public business slug endpoint during the build. A refused connection after
stopping the mock is an unmet local build prerequisite. A mock-only process can
be started with the existing runner:

```text
tsx -e "import { createMockSupabaseServer } from './tests/e2e/mock-supabase-server'; void createMockSupabaseServer(4010).then(() => console.log('Build mock ready'));"
```

## Disposable PostgreSQL tests

Both integration tests require Docker and the already present image
`supabase/postgres:17.6.1.127`, with image ID
`sha256:be60aee15997daca475b710b734bc6bfe52cd544dcd7e9fd2ff58210b6747d83`.
This exact local image prerequisite is intentional and may differ across
platforms. The tests use `--pull=never`, `--network none`, no published ports,
no host mounts, and uniquely named containers removed in their own cleanup.
Without explicit opt-in they are skipped, not passed.

PowerShell:

```powershell
$env:RUN_BUSINESS_ISOLATION_PG_INTEGRATION='1'
tsx --test supabase/tests/business-two-account-rls.integration.test.ts
$env:RUN_CHECKOUT_RESPONSE_LOSS_PG='1'
node --test supabase/tests/checkout-response-loss.integration.test.cjs
```

The RLS test loads actual authorization migrations over minimal prerequisites;
it does not reconstruct the entire release schema. Eligible active catalogs
are intentionally public to anonymous/authenticated readers. Owner management
APIs and private orders are checked separately. Rollback-only ACL grants expose
dormant RLS behavior without changing the release ACL contract.

The response-loss test commits through actual order SQL and exercises real
route/client functions. Its small HTTP-to-psql adapter replaces PostgREST, and
AST extraction/injected client state replaces React rendering. These are local
test boundaries, not complete browser checkout coverage.

## Evidence boundaries

CDP records retain methods, URLs, request IDs, completion/failure state and CORS
contract headers. Credential-bearing header values and credential text are
redacted even for synthetic fixtures. Private fingerprints support strict
own/foreign token comparisons without exposing credential values in evidence.

S10.1 reports captured HTTP/resource requests on the main browser target.
WebSocket observation and egress remain UNVERIFIED because the helper has no
WebSocket event capture. Server-process egress and popup targets are separately
UNVERIFIED. Zero external requests refers only to the captured HTTP/resource
traffic within that main-target audit.

The repository tests do not export HAR. Historical full-HAR artifacts and the
notification-sound browser probe remain external evidence, outside this PR.
Existing notification tests cover watcher/controller integration; audible human
listening was not established by the historical browser probe.

Report statuses must derive from observations/assertions. A missing or
unexecuted control is unverified/skipped; a failed assertion is a failure.
