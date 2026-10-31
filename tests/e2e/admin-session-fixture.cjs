// Synthetic loopback Auth only. No forwarding, real accounts, emails or SQL.
const http = require('node:http');
const { once } = require('node:events');
const { createHash } = require('node:crypto');

function latch() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

async function createAuthFixture(port = 0) {
  const access = new Map();
  const refresh = new Map();
  const plans = [];
  const calls = [];
  let serial = 0;
  let logoutStatus = 204;
  let recoveryChallenge = '', codeUsed = false;
  function userObject(user) {
    return { id: user, email: `${user.toLowerCase()}@example.invalid`, aud: 'authenticated',
      role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  }
  function issue(user) {
    const id = ++serial;
    const tokens = { access_token: `synthetic-access-${user}-${id}`,
      refresh_token: `synthetic-refresh-${user}-${id}`, expires_in: 3600,
      token_type: 'bearer', user: userObject(user) };
    access.set(tokens.access_token, user);
    refresh.set(tokens.refresh_token, user);
    return tokens;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const user = access.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      calls.push({ path: url.pathname, user }); // Never record credentials.
      const json = (value, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (url.pathname === '/auth/v1/token') {
        if (url.searchParams.get('grant_type') === 'password') {
          if (body.password !== 'Synthetic!Password42') return json({}, 400);
          return json(issue(body.email === 'b@example.invalid' ? 'B' : 'A'));
        }
        if (url.searchParams.get('grant_type') === 'pkce') {
          if (codeUsed || body.auth_code !== 'synthetic-recovery-code' || !body.code_verifier ||
              createHash('sha256').update(body.code_verifier).digest('base64url') !== recoveryChallenge) return json({}, 400);
          codeUsed = true; return json(issue('B'));
        }
        const owner = refresh.get(body.refresh_token);
        const plan = plans.shift();
        // Capture the provider result before suspension, including a successful
        // refresh that races provider revocation or a response still in transit.
        const result = owner ? issue(owner) : {};
        if (plan) { plan.started.resolve(); await plan.release.promise; }
        return json(result, plan?.fail || !owner ? 401 : 200);
      }
      if (url.pathname === '/auth/v1/user') {
        return user ? json(userObject(user)) : json({}, 401);
      }
      if (url.pathname === '/auth/v1/recover') {
        recoveryChallenge = body.code_challenge; codeUsed = false;
        return json({}); // Synthetic transport only; sends no email.
      }
      if (url.pathname === '/auth/v1/logout') {
        if (logoutStatus === 204) {
          for (const [key, owner] of refresh) if (owner === user) refresh.delete(key);
        }
        res.writeHead(logoutStatus); return res.end();
      }
      if (url.pathname === '/rest/v1/admin_users') return json([{ id: 'synthetic-allowlist' }]);
      if (url.pathname === '/rest/v1/businesses') return json([]); // Standard build sitemap.
      json({ error: 'Unexpected synthetic endpoint' }, 404);
    } catch { res.writeHead(500); res.end(); }
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return {
    server, calls, origin: `http://127.0.0.1:${server.address().port}`,
    holdRefresh(fail = false) {
      const plan = { fail, started: latch(), release: latch() };
      plans.push(plan); return plan;
    },
    setLogoutStatus(status) { logoutStatus = status; },
    close() { server.closeAllConnections(); return new Promise(r => server.close(r)); },
  };
}

module.exports = { createAuthFixture, latch };
if (require.main === module) {
  createAuthFixture(Number(process.argv[2] || 47123)).then(fixture => {
    console.log(`Synthetic Auth ready: ${fixture.origin}`);
  });
}
