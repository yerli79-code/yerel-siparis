import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
writeFileSync('tmp_phase23ic_results.txt', 'FAIL: test execution did not complete.\n');
assert.equal(process.version, 'v24.16.0', 'Use the workflow-pinned Node.js version');
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  assert.equal(existsSync(file), false, 'Refusing to run with production-loadable env files');
}

// No inherited Auth/DB credentials, NODE_OPTIONS, proxies, npm config or CI tokens.
// Each test supplies synthetic configuration; the HTTP harness builds the normal
// production Next bundle while its own loopback Auth fixture is alive.
const env = { NEXT_TELEMETRY_DISABLED: '1' };
for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
  'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'HOME', 'LANG']) {
  if (process.env[key]) env[key] = process.env[key];
}

const groups = [
  { name: 'Existing security / regression', expected: 137, loader: true, files: [
    'app/api/admin/auth/logout/logout.test.ts',
    'app/panel/panel-v0-integration.test.ts',
    'app/panel/phase4-production-readiness.test.ts',
    'lib/admin/admin-auth-foundation.test.ts',
    'lib/password-recovery.test.ts',
    'lib/publishable-key-migration.test.ts',
    'tests/e2e/business-two-account-isolation.test.ts',
  ] },
  { name: 'Business session storage races / failures', expected: 37, loader: true,
    files: ['lib/browser-auth-session.test.ts'] },
  { name: 'Real HTTP / cookies, two Next processes, synthetic loopback Auth', expected: 15,
    files: ['tests/e2e/admin-session-http.test.cjs'] },
];

const rows = [];
let failed = false;
for (const group of groups) {
  console.log(`\n=== ${group.name}: expected ${group.expected} tests ===`);
  const args = [...(group.loader ? ['--import', './tests/register-typescript.mjs'] : []),
    '--test', '--test-reporter=tap', ...group.files];
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true });
    let output = '';
    child.stdout.on('data', data => { output += data; process.stdout.write(data); });
    child.stderr.on('data', data => process.stderr.write(data));
    child.on('error', error => resolve({ output, error: error.message }));
    child.on('close', (code, signal) => resolve({ output, code, signal }));
  });
  const counts = {};
  for (const field of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...result.output.matchAll(new RegExp(`^# ${field} (\\d+)\\r?$`, 'gm'))];
    counts[field] = matches.length === 1 ? Number(matches[0][1]) : null;
  }
  const ok = result.code === 0 && !result.signal && !result.error &&
    counts.tests === group.expected && counts.pass === group.expected &&
    ['fail', 'cancelled', 'skipped', 'todo'].every(field => counts[field] === 0);
  failed ||= !ok;
  rows.push(`| ${group.name} | ${group.expected} | ${counts.tests ?? '?'} | ${counts.pass ?? '?'} | ${counts.fail ?? '?'} | ${counts.cancelled ?? '?'} | ${counts.skipped ?? '?'} | ${counts.todo ?? '?'} | ${ok ? 'PASS' : 'FAIL'} |`);
  if (!ok) console.error('Group failed exit/count/skip checks:', result.code, result.signal, result.error, counts);
}

const report = [
  '| Test group | Expected | Tests | Pass | Fail | Cancelled | Skipped | Todo | Result |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ...rows, '',
  failed ? 'FAIL: at least one group failed its exit/count/skip checks.' : 'PASS: 189/189 tests; no failures, cancellations, skips or TODOs.',
  '', 'Synthetic/local evidence only; no production Auth, accounts or database.', '',
].join('\n');
writeFileSync('tmp_phase23ic_results.txt', report);
console.log(report);
process.exitCode = failed ? 1 : 0;
