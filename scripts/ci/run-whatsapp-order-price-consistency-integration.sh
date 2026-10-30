#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# Fail closed if any production or external database/API environment variable is present.
FORBIDDEN_ENV_VARS=(
  "SUPABASE_URL"
  "SUPABASE_DB_URL"
  "SUPABASE_SERVICE_ROLE_KEY"
  "SUPABASE_SERVER_SECRET_KEY"
  "SUPABASE_BACKUP_SECRET_KEY"
  "NEXT_PUBLIC_SUPABASE_URL"
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "DATABASE_URL"
)

for var_name in "${FORBIDDEN_ENV_VARS[@]}"; do
  if [ -n "${!var_name:-}" ]; then
    echo "Refusing to run: forbidden environment variable ${var_name} is set." >&2
    exit 1
  fi
  unset "${var_name}" || true
done

PG_BINDIR="${PG_BINDIR:-/usr/lib/postgresql/17/bin}"
POSTGREST_BIN="${POSTGREST_BIN:-$(command -v postgrest || true)}"

for required_bin in "${PG_BINDIR}/initdb" "${PG_BINDIR}/pg_ctl" "${PG_BINDIR}/psql" "${PG_BINDIR}/pg_isready"; do
  if [ ! -x "${required_bin}" ]; then
    echo "Missing required PostgreSQL 17 executable: ${required_bin}" >&2
    exit 1
  fi
done

if [ -z "${POSTGREST_BIN}" ] || [ ! -x "${POSTGREST_BIN}" ]; then
  echo "Missing required PostgREST executable." >&2
  exit 1
fi

# This harness is CI-only and uses a disposable hosted VM, not Docker Desktop.
if [ "${ISOLATED_NETNS_INNER:-0}" != "1" ]; then
  if [ "${GITHUB_ACTIONS:-}" != "true" ] || [ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ] ||
     [ "${GITHUB_EVENT_NAME:-}" != "pull_request" ] ||
     [ "${GITHUB_REPOSITORY:-}" != "yerli79-code/yerel-siparis" ] ||
     [ "${GITHUB_HEAD_REF:-}" != "feat/whatsapp-order-price-consistency" ] ||
     [ "${GITHUB_BASE_REF:-}" != "release/order-management-20260630" ]; then
    echo "Refusing to run outside the authorized GitHub-hosted PR workflow." >&2
    exit 1
  fi
  node -e '
    const event = JSON.parse(require("node:fs").readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (event.number !== 51 || event.pull_request?.head?.repo?.full_name !== process.env.GITHUB_REPOSITORY) process.exit(1);
  '
  TASK_UID="$(id -u)"
  TASK_GID="$(id -g)"
  if [ "${TASK_UID}" -eq 0 ]; then
    echo "Refusing to run as root; PostgreSQL requires an unprivileged user." >&2
    exit 1
  fi

  # Loopback-only network and a PID namespace contain descendants on failure.
  # Pass paths as arguments rather than interpolating them into shell code.
  # Clear the environment: no GitHub tokens, production keys or PG connection overrides.
  exec sudo unshare --net --pid --fork --mount-proc --kill-child=KILL bash -c '
      set -Eeuo pipefail
      ip link set dev lo up
      exec setpriv --reuid="$1" --regid="$2" --init-groups --no-new-privs --bounding-set=-all \
        env -i PATH="$6:/usr/local/bin:/usr/bin:/bin" LANG=C.UTF-8 \
        PG_BINDIR="$4" POSTGREST_BIN="$5" \
        ISOLATED_NETNS_INNER=1 EXPECT_NETNS_ISOLATION=1 bash "$3"
    ' bash "${TASK_UID}" "${TASK_GID}" "${SCRIPT_DIR}/run-whatsapp-order-price-consistency-integration.sh" "${PG_BINDIR}" "${POSTGREST_BIN}" "$(dirname "$(command -v node)")"
fi

# Verify isolation again after dropping privileges, including direct inner entry.
TASK_IPV4_ROUTES="$(ip route show)"
TASK_IPV6_DEFAULT_ROUTES="$(ip -6 route show default)"
if ! ip -j link show | node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { const links=JSON.parse(s); process.exit(links.length === 1 && links[0].ifname === "lo" ? 0 : 1); });' ||
   [ -n "${TASK_IPV4_ROUTES}" ] || [ -n "${TASK_IPV6_DEFAULT_ROUTES}" ]; then
  echo "Refusing to run without loopback-only network isolation." >&2
  exit 1
fi

if [ "$(node --version)" != "v24.16.0" ]; then
  echo "Expected the workflow-pinned Node.js v24.16.0." >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d /tmp/whatsapp-order-pgrst.XXXXXX)"
PGDATA="${TMP_ROOT}/pgdata"
PGSOCKET="${TMP_ROOT}/pgsocket"
PGLOG="${TMP_ROOT}/postgres.log"
PGRST_CONF="${TMP_ROOT}/postgrest.conf"
PGRST_LOG="${TMP_ROOT}/postgrest.log"
PGRST_PID=""
PG_STARTED="0"

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  set +e

  if [ "${exit_code}" -ne 0 ]; then
    echo "=== Integration run failed (exit ${exit_code}); diagnostic logs ===" >&2
    if [ -f "${PGRST_LOG}" ]; then
      echo "--- PostgREST log (last 40 lines) ---" >&2
      tail -n 40 "${PGRST_LOG}" >&2 || true
    fi
    if [ -f "${PGLOG}" ]; then
      echo "--- PostgreSQL log (last 40 lines) ---" >&2
      tail -n 40 "${PGLOG}" >&2 || true
    fi
  fi

  if [ -n "${PGRST_PID}" ] && kill -0 "${PGRST_PID}" 2>/dev/null; then
    kill "${PGRST_PID}" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "${PGRST_PID}" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL "${PGRST_PID}" 2>/dev/null || true
    wait "${PGRST_PID}" 2>/dev/null || true
  fi

  if [ "${PG_STARTED}" = "1" ] && [ -d "${PGDATA}" ]; then
    "${PG_BINDIR}/pg_ctl" -D "${PGDATA}" -m immediate -w -t 10 stop >/dev/null 2>&1 || true
  fi

  if [ -n "${TMP_ROOT}" ] && [ -d "${TMP_ROOT}" ]; then
    rm -rf "${TMP_ROOT}"
  fi

  exit "${exit_code}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "${PGSOCKET}" "${TMP_ROOT}/home"
chmod 700 "${TMP_ROOT}" "${PGSOCKET}"
export HOME="${TMP_ROOT}/home"
export PGPASSFILE=/dev/null
export PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000'

"${PG_BINDIR}/initdb" \
  -D "${PGDATA}" \
  -U postgres \
  --auth=trust \
  --encoding=UTF8 \
  --locale=C.UTF-8 \
  --no-instructions >/dev/null

cat >>"${PGDATA}/postgresql.conf" <<EOF
listen_addresses = ''
unix_socket_directories = '${PGSOCKET}'
unix_socket_permissions = 0700
cluster_name = 'whatsapp-price-consistency-disposable'
shared_preload_libraries = 'pg_cron'
cron.database_name = 'postgres'
cron.launch_active_jobs = off
fsync = off
full_page_writes = off
synchronous_commit = on
EOF

PG_STARTED="1"
"${PG_BINDIR}/pg_ctl" -D "${PGDATA}" -l "${PGLOG}" -w -t 30 start >/dev/null

"${PG_BINDIR}/pg_isready" -h "${PGSOCKET}" -U postgres -d postgres >/dev/null

"${PG_BINDIR}/psql" \
  -X \
  -q \
  -v ON_ERROR_STOP=1 \
  -v WHATSAPP_PRICE_CONSISTENCY_DISPOSABLE=1 \
  -h "${PGSOCKET}" \
  -U postgres \
  -d postgres \
  -f "${REPO_ROOT}/supabase/tests/whatsapp-order-price-consistency-fixture.sql"

DB_URI="postgresql:///postgres?host=${PGSOCKET}&user=authenticator"
authenticator_check="$("${PG_BINDIR}/psql" -X -q -A -t -v ON_ERROR_STOP=1 "${DB_URI}" -c "select current_user;")"
if [ "${authenticator_check}" != "authenticator" ]; then
  echo "Unexpected PostgREST connection user: ${authenticator_check}" >&2
  exit 1
fi

JWT_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
PGRST_PORT="$(node -e "
  const net = require('node:net');
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => process.stdout.write(String(port)));
  });
")"

cat >"${PGRST_CONF}" <<EOF
db-uri = "${DB_URI}"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 10
jwt-secret = "${JWT_SECRET}"
server-host = "127.0.0.1"
server-port = ${PGRST_PORT}
EOF

"${POSTGREST_BIN}" "${PGRST_CONF}" >"${PGRST_LOG}" 2>&1 &
PGRST_PID="$!"

PGRST_READY="0"
for _ in $(seq 1 50); do
  if ! kill -0 "${PGRST_PID}" 2>/dev/null; then
    echo "PostgREST exited prematurely." >&2
    exit 1
  fi
  if node -e "
    fetch('http://127.0.0.1:${PGRST_PORT}/businesses?select=slug&limit=1', { signal: AbortSignal.timeout(1000) })
      .then(async res => {
        const srv = res.headers.get('server') || '';
        const rows = await res.json();
        process.exit(res.status === 200 && /^postgrest\//i.test(srv) && Array.isArray(rows) && rows.length === 1 ? 0 : 1);
      })
      .catch(() => process.exit(1));
  "; then
    PGRST_READY="1"
    break
  fi
  sleep 0.2
done

if [ "${PGRST_READY}" != "1" ]; then
  echo "PostgREST did not become ready in time." >&2
  exit 1
fi

env \
  RUN_WHATSAPP_ORDER_POSTGREST_INTEGRATION="1" \
  EXPECT_NETNS_ISOLATION="1" \
  POSTGREST_BASE_URL="http://127.0.0.1:${PGRST_PORT}" \
  POSTGREST_JWT_SECRET="${JWT_SECRET}" \
  PGHOST="${PGSOCKET}" \
  PGUSER="postgres" \
  PGDATABASE="postgres" \
  PSQL_BIN="${PG_BINDIR}/psql" \
  NEXT_TELEMETRY_DISABLED="1" \
  timeout --signal=TERM --kill-after=15s 180s \
  node --test "${REPO_ROOT}/supabase/tests/whatsapp-order-price-consistency.postgrest.integration.test.cjs"
