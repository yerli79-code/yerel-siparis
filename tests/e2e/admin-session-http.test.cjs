// Runs a standard `npm run build` with its own synthetic public configuration.
// Real compiled Next routes, two independent processes, actual HTTP Set-Cookie.
// The only Auth provider is the loopback fixture; no production env is inherited.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { existsSync, writeFileSync } = require('node:fs');
const { createAuthFixture, latch } = require('./admin-session-fixture.cjs');

const root = path.resolve(__dirname, '../..');
const selector = 'yerel-siparis-admin-session';
const children = [];
const origins = [];
const wireHolds = new Map();
let auth, proxy, origin;

async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return server.address().port;
}
async function unusedPort() {
  const server = http.createServer(); const port = await listen(server);
  await new Promise(r => server.close(r)); return port;
}
function deadline(promise) {
  return Promise.race([promise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('HTTP test barrier timed out')), 20000);
    timer.unref();
  })]);
}

class CookieJar {
  values = new Map();
  header() { return [...this.values].map(([k, v]) => `${k}=${v}`).join('; '); }
  apply(response) {
    // Apply separate wire headers in arrival order (same host/path, loopback).
    // Node fetch has no cookie jar: never treat a response DTO as auth state.
    for (const cookie of response.headers.getSetCookie()) {
      assert.match(cookie, /; Path=\//i);
      assert.match(cookie, /; HttpOnly/i);
      assert.match(cookie, /; Secure/i);
      assert.match(cookie, /; SameSite=lax/i);
      const pair = cookie.split(';', 1)[0]; const pos = pair.indexOf('=');
      const name = pair.slice(0, pos), value = pair.slice(pos + 1);
      if (/; Max-Age=0(?:;|$)/i.test(cookie)) this.values.delete(name);
      else this.values.set(name, value);
    }
  }
  async request(endpoint, { instance = 0, body, apply = true, headers = {} } = {}) {
    const response = await fetch(`${origin}/api/admin/auth/${endpoint}`, {
      method: endpoint === 'session' ? 'GET' : 'POST',
      headers: { Origin: origin, Cookie: this.header(), 'Content-Type': 'application/json',
        'x-test-instance': String(instance), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000),
    });
    if (apply) this.apply(response);
    return response;
  }
  async login(user = 'A', instance = 0) {
    const response = await this.request('login', { instance, body: {
      email: `${user.toLowerCase()}@example.invalid`, password: 'Synthetic!Password42',
    } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: true, userId: user });
    return this.values.get(selector);
  }
  async session(expected, instance = 1) {
    const response = await this.request('session', { instance });
    assert.equal(response.status, expected ? 200 : 401);
    if (expected) assert.deepEqual(await response.json(), { authenticated: true, userId: expected });
  }
}

before(async () => {
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    assert.equal(existsSync(path.join(root, file)), false, 'HTTP fixture requires a worktree without env files');
  }
  auth = await createAuthFixture();
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: auth.origin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_phase23e_synthetic',
    SUPABASE_SERVER_SECRET_KEY: 'sb_secret_phase23e_synthetic' });
  // NEXT_PUBLIC values are inlined at build time, including in server bundles.
  // Build while THIS fixture is alive so barriers control the actual provider.
  const build = process.platform === 'win32'
    ? spawn(env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: root, env, windowsHide: true })
    : spawn('npm', ['run', 'build'], { cwd: root, env });
  let buildOutput = '';
  build.stdout.on('data', data => { buildOutput += data; });
  build.stderr.on('data', data => { buildOutput += data; });
  const [buildCode] = await once(build, 'exit');
  writeFileSync(path.join(root, 'tmp_phase23e_http_build.txt'), buildOutput);
  assert.equal(buildCode, 0, buildOutput);
  for (let i = 0; i < 2; i++) {
    const port = await unusedPort();
    const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'),
      'start', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    await deadline(new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (output.includes('Ready in')) { clearInterval(timer); resolve(); }
        else if (child.exitCode !== null) { clearInterval(timer); reject(new Error(output)); }
      }, 50);
      timer.unref();
    }));
    origins.push(`http://127.0.0.1:${port}`);
  }
  proxy = http.createServer(async (req, res) => {
    try {
      const instance = Number(req.headers['x-test-instance'] || 0);
      assert.ok(instance === 0 || instance === 1);
      const upstream = origins[instance];
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers();
      headers.set('Cookie', req.headers.cookie || '');
      headers.set('Content-Type', 'application/json');
      // Preserve foreign/missing origins; translate only this proxy's own origin
      // to the selected local Next origin. CSRF remains enforced by real routes.
      // NextURL normalizes loopback hostnames to localhost (Next 16.3.3).
      if (req.headers.origin) headers.set('Origin', req.headers.origin === origin ? upstream.replace('127.0.0.1', 'localhost') : req.headers.origin);
      const response = await fetch(upstream + req.url, {
        method: req.method, headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const body = Buffer.from(await response.arrayBuffer());
      const hold = wireHolds.get(new URL(req.url, origin).searchParams.get('wire'));
      if (hold) { hold.ready.resolve(); await hold.release.promise; }
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Set-Cookie', response.headers.getSetCookie());
      res.end(body);
    } catch { res.writeHead(502); res.end(); }
  });
  origin = `http://127.0.0.1:${await listen(proxy)}`;
}, { timeout: 120000 });

after(async () => {
  for (const hold of wireHolds.values()) hold.release.resolve();
  for (const child of children) {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  }
  if (proxy) { proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); }
  if (auth) await auth.close();
});

test('normal login and refresh rotate both HttpOnly cookies across two Next instances', async () => {
  const jar = new CookieJar(); const id = await jar.login();
  await jar.session('A');
  jar.values.delete(`yerel-siparis-admin-access-token-${id}`); // Browser access-cookie expiry.
  await jar.session(null);
  const before = jar.header();
  const response = await jar.request('refresh', { instance: 1 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.ok(response.headers.getSetCookie().every(c => !c.startsWith(selector + '=') && !c.includes('admin-gate-')));
  assert.notEqual(jar.header(), before);
  assert.equal(jar.values.get(selector), id);
  await jar.session('A', 0);
});

for (const scope of ['', '?scope=browser']) {
  test(`provider-delayed refresh cannot restore session after logout ${scope}`, async () => {
    const jar = new CookieJar(); await jar.login();
    const hold = auth.holdRefresh();
    const pending = jar.request('refresh', { instance: 1 });
    await deadline(hold.started.promise);
    const logouts = auth.calls.filter(c => c.path === '/auth/v1/logout').length;
    assert.equal((await jar.request('logout' + scope)).status, 200);
    await jar.session(null);
    hold.release.resolve(); assert.equal((await pending).status, 200);
    await jar.session(null, 0);
    assert.equal((await jar.request('refresh')).status, 401);
    assert.equal(auth.calls.filter(c => c.path === '/auth/v1/logout').length, logouts + (scope ? 0 : 1));
  });
}

for (const logoutFirst of [true, false]) {
  test(`completed refresh response delivered ${logoutFirst ? 'after' : 'before'} logout response cannot restore auth`, async () => {
    const jar = new CookieJar(); await jar.login();
    const key = `order-${logoutFirst}`;
    const hold = { ready: latch(), release: latch() }; wireHolds.set(key, hold);
    const pending = jar.request(`refresh?wire=${key}`, { instance: 1 });
    await deadline(hold.ready.promise); // Next already produced its final Set-Cookie.
    if (logoutFirst) {
      await jar.request('logout?scope=browser'); hold.release.resolve(); await pending;
    } else {
      hold.release.resolve(); await pending; await jar.request('logout?scope=browser');
    }
    await jar.session(null);
  });
}

test('admin A / business B recovery cleanup preserves B and other browser sessions', async () => {
  const a = new CookieJar(), other = new CookieJar(); await a.login('A'); await other.login('A');
  const hold = auth.holdRefresh(); const pending = a.request('refresh', { instance: 1 });
  await deadline(hold.started.promise);
  const start = auth.calls.length;
  await import('../register-typescript.mjs');
  const { createPasswordRecovery } = await import('../../lib/password-recovery.ts');
  const { createClient } = require('@supabase/supabase-js');
  const stored = new Map();
  const client = createClient(auth.origin, 'sb_publishable_phase23e_synthetic', { auth: {
    flowType: 'pkce', autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
    storage: { getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
  } });
  try {
    assert.equal((await client.auth.resetPasswordForEmail('b@example.invalid', { redirectTo: `${origin}/sifre-yenile` })).error, null);
    const recovery = createPasswordRecovery(client.auth, async () => {
      assert.equal((await a.request('logout?scope=browser')).status, 200);
    }, () => stored.clear());
    assert.equal(await recovery.open(`${origin}/sifre-yenile?code=synthetic-recovery-code`), true);
    hold.release.resolve(); await pending;
    await a.session(null); await other.session('A');
    assert.equal((await client.auth.getSession()).data.session.user.id, 'B');
    assert.equal(auth.calls.slice(start).some(c => c.path === '/auth/v1/logout'), false);
    recovery.cancel();
  } finally { hold.release.resolve(); await client.auth.dispose(); }
});

for (const fail of [false, true]) {
  test(`old ${fail ? 'failed' : 'successful'} refresh cannot overwrite or clear a replacement login`, async () => {
    const jar = new CookieJar(); const old = await jar.login('A');
    const hold = auth.holdRefresh(fail); const pending = jar.request('refresh', { instance: 1 });
    await deadline(hold.started.promise);
    const current = await jar.login('B'); assert.notEqual(current, old);
    hold.release.resolve(); assert.equal((await pending).status, fail ? 401 : 200);
    assert.equal(jar.values.get(selector), current); await jar.session('B');
  });
}

test('an old logout response delivered after replacement login cannot clear the new session', async () => {
  const jar = new CookieJar(); const old = await jar.login('A');
  const key = 'old-logout';
  const hold = { ready: latch(), release: latch() }; wireHolds.set(key, hold);
  const pending = jar.request(`logout?scope=browser&wire=${key}`, { instance: 1 });
  await deadline(hold.ready.promise);
  const current = await jar.login('B'); assert.notEqual(current, old);
  hold.release.resolve(); assert.equal((await pending).status, 200);
  assert.equal(jar.values.get(selector), current); await jar.session('B');
});

test('failed refresh invalidates the gate even if a concurrent successful refresh arrives later', async () => {
  const jar = new CookieJar(); await jar.login();
  const good = auth.holdRefresh(), bad = auth.holdRefresh(true);
  const first = jar.request('refresh'); await deadline(good.started.promise);
  const second = jar.request('refresh', { instance: 1 }); await deadline(bad.started.promise);
  bad.release.resolve(); assert.equal((await second).status, 401);
  good.release.resolve(); assert.equal((await first).status, 200);
  await jar.session(null);
});

test('eight concurrent refreshes across instances preserve normal authentication', async () => {
  const jar = new CookieJar(); await jar.login();
  const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => jar.request('refresh', { instance: i % 2 })));
  assert.ok(responses.every(r => r.status === 200)); await jar.session('A');
});

test('different cookie jars never mix identities during simultaneous refresh and logout', async () => {
  const a = new CookieJar(), b = new CookieJar(); await a.login('A'); await b.login('B');
  const responses = await Promise.all([a.request('refresh'), b.request('refresh', { instance: 1 })]);
  assert.ok(responses.every(r => r.status === 200));
  await a.session('A'); await b.session('B');
  await a.request('logout?scope=browser'); await a.session(null); await b.session('B');
});

test('normal logout revokes provider refresh; remote failure still clears local capability', async () => {
  for (const status of [204, 503]) {
    const jar = new CookieJar(); await jar.login(); auth.setLogoutStatus(status);
    assert.equal((await jar.request('logout')).status, 200);
    await jar.session(null); assert.equal((await jar.request('refresh')).status, 401);
  }
  auth.setLogoutStatus(204);
});

test('legacy unscoped credentials and credentials without a gate fail closed', async () => {
  const jar = new CookieJar(); const id = await jar.login();
  jar.values.delete(`yerel-siparis-admin-gate-${id}`);
  await jar.session(null); assert.equal((await jar.request('refresh')).status, 401);
  jar.values.set('yerel-siparis-admin-access-token', 'synthetic-legacy');
  jar.values.set('yerel-siparis-admin-refresh-token', 'synthetic-legacy');
  jar.values.delete(selector); await jar.session(null);
});

test('HTTP recovery cleanup rejects foreign or missing Origin without deleting cookies', async () => {
  const jar = new CookieJar(); await jar.login();
  const before = jar.header();
  for (const value of ['', 'https://foreign.example.invalid']) {
    assert.equal((await jar.request('logout?scope=browser', { headers: { Origin: value } })).status, 403);
    assert.equal(jar.header(), before);
  }
  await jar.session('A');
});
