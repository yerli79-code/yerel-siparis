#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

# CI-only wrapper. Local Windows verification uses the same Node runner, without
# claiming Linux namespace isolation. Never change host firewall/network rules.
if [ "${GITHUB_ACTIONS:-}" != "true" ] || [ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ] ||
   [ "${GITHUB_EVENT_NAME:-}" != "pull_request" ] || [ "$(uname -s)" != "Linux" ]; then
  echo 'This isolation wrapper requires a GitHub-hosted Linux pull_request job.' >&2
  exit 1
fi
for required in node sudo unshare setpriv ip; do
  command -v "${required}" >/dev/null
done
TASK_UID="$(id -u)"
TASK_GID="$(id -g)"
NODE_DIR="$(dirname "$(command -v node)")"
[ "${TASK_UID}" -ne 0 ]

# All test descendants share a fresh network namespace containing only lo.
# PID isolation kills descendants on exit; privilege dropping prevents escape
# through sudo/setuid or network reconfiguration. No fallback to online tests.
exec sudo unshare --net --pid --fork --mount-proc --kill-child=KILL \
  bash -s -- "${TASK_UID}" "${TASK_GID}" "${NODE_DIR}" "${REPO_ROOT}" <<'NAMESPACE'
set -Eeuo pipefail
ip link set dev lo up
task_home="$(mktemp -d /tmp/security-regression.XXXXXX)"
trap 'rm -rf -- "${task_home}"' EXIT
chown "$1:$2" "${task_home}"
setpriv --reuid="$1" --regid="$2" --clear-groups --no-new-privs \
  --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
  env -i PATH="$3:/usr/local/bin:/usr/bin:/bin" HOME="${task_home}" \
    TMPDIR="${task_home}" LANG=C.UTF-8 NEXT_TELEMETRY_DISABLED=1 \
  bash -s -- "$4" <<'TESTS'
set -Eeuo pipefail
cd "$1"
# Verify isolation after dropping privileges, before any project test code.
ip -j link show | node -e '
  let data = "";
  process.stdin.on("data", chunk => data += chunk);
  process.stdin.on("end", () => {
    const links = JSON.parse(data);
    process.exit(links.length === 1 && links[0].ifname === "lo" && links[0].flags.includes("UP") ? 0 : 1);
  });
'
[ -z "$(ip route show)" ]
[ -z "$(ip -6 route show default)" ]
[ "$(id -u)" -ne 0 ]
for commit in 2f988d0ab82f7fe56d7653dfe0208bdd42475a98 a7ec6788d855f0a9d9213dbee24453d42af75c86; do
  git cat-file -e "${commit}^{commit}"
done
exec node scripts/ci/run-security-regression.mjs
TESTS
NAMESPACE
