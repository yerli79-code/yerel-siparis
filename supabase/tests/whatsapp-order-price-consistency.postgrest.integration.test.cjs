// Opt-in real PostgREST + PostgreSQL 17 integration test for PR #51.
// Runs in isolated ephemeral CI environment prepared by scripts/ci/run-whatsapp-order-price-consistency-integration.sh.
// Imports the real POST handler and receipt.ts without replacing their SQL/HTTP logic.
// This is a handler/client-function harness, not a Next.js server or browser test.
// The gateway only translates local fixture keys to JWTs; injected 503/socket drops
// are deliberate failures, never synthesized successful SQL responses.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const source = name => readFileSync(path.join(root, name), 'utf8');

const businessId = '33333333-3333-4333-8333-333333333333';
const ownerId = '00000000-0000-4000-8000-000000000001';
const productId = '22222222-2222-4222-8222-222222222222';
const secondProductId = '55555555-5555-4555-8555-555555555555';
const defaultKey = '11111111-1111-4111-8111-111111111111';
const publishableKey = 'sb_publishable_local_postgrest_fixture';
const serverSecretKey = 'sb_secret_local_postgrest_fixture';

const transpile = text =>
  ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

// Scoped to this standalone test process; no application file is modified.
require.extensions['.ts'] = (mod, filename) =>
  mod._compile(transpile(readFileSync(filename, 'utf8')), filename);

function signJwt(payload, secret) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const claims = encode({
    iss: 'local-postgrest-fixture',
    iat: Math.floor(Date.now() / 1000) - 10,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  });
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${claims}`)
    .digest('base64url');
  return `${header}.${claims}.${signature}`;
}

function runPsql(statement) {
  const psqlBin = process.env.PSQL_BIN || 'psql';
  const pgSocket = process.env.PGHOST || '';
  assert.match(pgSocket, /^\/tmp\/whatsapp-order-pgrst\.[^/]+\/pgsocket$/, 'PGHOST must be the disposable CI socket');

  return new Promise((resolve, reject) => {
    const child = execFile(
      psqlBin,
      [
        '-X',
        '-q',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        pgSocket,
        '-U',
        process.env.PGUSER || 'postgres',
        '-d',
        process.env.PGDATABASE || 'postgres',
      ],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      },
    );
    child.stdin.on('error', () => {});
    child.stdin.end(statement);
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function listen(handler) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(error => {
      if (!res.destroyed) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: error.message }));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  );
}

function createClientHarness(createPublicOrder, PublicOrderRequestError, options = {}) {
  const text = source('app/isletme/[slug]/PublicBusinessPageClient.tsx');
  const ast = ts.createSourceFile('client.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(['submitOrder', 'retryPendingOrder', 'createMessage']);
  const functions = [];
  let reopen = '';

  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) {
      functions.push(node.getText(ast));
    }
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(ast) === 'onSendVerifiedWhatsApp' &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression
    ) {
      reopen = `const reopenWhatsApp = ${node.initializer.expression.getText(ast)};`;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(functions.length, 3);
  assert.ok(reopen);

  const cartItems = options.cart ?? [
    { id: productId, name: 'Stale Cart Kebap', price: 125, quantity: 2 },
  ];
  const state = {
    mode: 'none',
    message: '',
    warning: '',
    storageClears: 0,
    whatsappCalls: 0,
    popupClosed: 0,
  };
  const context = {
    createPublicOrder,
    PublicOrderRequestError,
    ...require(path.join(root, 'lib/payment-methods.ts')),
    ...require(path.join(root, 'lib/public-order-address.ts')),
    ...require(path.join(root, 'lib/public-order-receipt.ts')),
    pendingOrderAttemptRef: { current: null },
    activeOrderRequestRef: { current: null },
    isRecordingOrderRef: { current: false },
    crypto: { randomUUID: () => options.idempotencyKey ?? defaultKey },
    currentBusiness: {
      slug: options.businessSlug ?? 'local-postgrest-pilot',
      name: 'Synthetic PostgREST Pilot',
      whatsappOrderNumber: '905550000000',
    },
    customer: {
      fullName: 'Synthetic Customer',
      phone: '05550000000',
      note: 'Synthetic test only',
    },
    deliveryAddress: {
      district: '',
      neighborhood: '',
      streetAddress: 'Synthetic Street 10',
      building: '',
      floorUnit: '',
      directions: '',
    },
    cart: cartItems,
    total: cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
    orderType: options.orderType ?? 'delivery',
    paymentMethod: options.paymentMethod ?? 'cash',
    slug: options.businessSlug ?? 'local-postgrest-pilot',
    isOrderingOpen: true,
    minimumOrderWarning: '',
    orderRecoveryMode: 'none',
    verifiedWhatsAppMessage: '',
    normalizeWhatsAppPhone: value => value,
    isMobileDevice: () => false,
    window: {
      open: () => ({
        close() {
          state.popupClosed++;
        },
        opener: null,
      }),
      localStorage: {},
    },
    clearPublicCart: () => state.storageClears++,
    formatPrice: amount => `${amount} TRY`,
    sendWhatsAppMessage: () => {
      state.whatsappCalls++;
      return options.whatsappOpens ?? true;
    },
    setOrderRecoveryMode: value => {
      state.mode = value;
      context.orderRecoveryMode = value;
    },
    setVerifiedWhatsAppMessage: value => {
      state.message = value;
      context.verifiedWhatsAppMessage = value;
    },
    setOrderRecordWarning: value => {
      state.warning = value;
    },
    setWarning() {},
    setPaymentMethodError() {},
    setIsRecordingOrder() {},
    setCart: value => {
      context.cart = value;
    },
  };

  vm.createContext(context);
  vm.runInContext(transpile(`${functions.join('\n')}\n${reopen}`), context);
  return { context, state };
}

test(
  'public order price consistency, narrow grants, filters, idempotency, and response loss against real PostgREST',
  {
    skip: process.env.RUN_WHATSAPP_ORDER_POSTGREST_INTEGRATION !== '1',
    timeout: 120000,
  },
  async t => {
    const postgrestUrl = process.env.POSTGREST_BASE_URL || '';
    const jwtSecret = process.env.POSTGREST_JWT_SECRET || '';
    assert.ok(postgrestUrl, 'POSTGREST_BASE_URL is required');
    assert.ok(jwtSecret.length >= 32, 'POSTGREST_JWT_SECRET must be at least 32 chars');

    const parsedPostgrestUrl = new URL(postgrestUrl);
    assert.equal(parsedPostgrestUrl.protocol, 'http:');
    assert.equal(parsedPostgrestUrl.hostname, '127.0.0.1');

    assert.equal(process.env.EXPECT_NETNS_ISOLATION, '1', 'Network isolation is mandatory');
    const interfaces = Object.keys(os.networkInterfaces());
    assert.deepEqual(interfaces, ['lo'], 'Only loopback interface may exist inside isolated netns');

    assert.match(await runPsql('show server_version;'), /^17\./);
    assert.equal(await runPsql('show cluster_name;'), 'whatsapp-price-consistency-disposable');
    assert.equal(
      await runPsql('select inet_server_addr() is null and current_database() = \'postgres\';'),
      't',
    );

    const anonJwt = signJwt({ role: 'anon' }, jwtSecret);
    const authenticatedJwt = signJwt({ role: 'authenticated', sub: ownerId }, jwtSecret);
    const serviceRoleJwt = signJwt({ role: 'service_role' }, jwtSecret);

    const savedEnv = { ...process.env };
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;

    const postgrestRequests = [];
    const orderApiRequests = [];
    let failNextReceiptRead = false;
    let dropNextOrderResponse = false;
    let beforeResponseLossSnapshot = null;
    let clientIpCounter = 1;
    let gateway;
    let transport;

    const snapshot = async () =>
      JSON.parse(
        await runPsql(`
          select json_build_object(
            'orders', coalesce((select json_agg(o order by o.business_order_number) from public.orders o where o.business_id = '${businessId}'), '[]'::json),
            'items', coalesce((select json_agg(i order by i.product_id) from public.order_items i join public.orders o on o.id = i.order_id where o.business_id = '${businessId}'), '[]'::json),
            'counters', coalesce((select json_agg(c order by c.business_id) from public.business_order_counters c where c.business_id = '${businessId}'), '[]'::json)
          );
        `),
      );

    const resetOrderState = async () => {
      await runPsql(`
        delete from public.order_items;
        delete from public.orders;
        delete from public.business_order_counters;
        delete from public.public_order_rate_limit_buckets;
        update public.products
           set name = 'Recorded Kebap', price = 125.00, is_active = true
         where id = '${productId}';
        update public.products
           set name = 'Recorded Ayran', price = 10.25, is_active = true
         where id = '${secondProductId}';
      `);
    };

    try {
      const rootProbe = await originalFetch(`${postgrestUrl}/`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      assert.equal(rootProbe.status, 200);
      assert.match(rootProbe.headers.get('server') ?? '', /^postgrest\/12\./i);

      // Thin Supabase REST gateway: strips /rest/v1 and maps apikey to PostgREST role JWTs.
      // No HTTP-to-SQL adapter: successful data responses come unchanged from real PostgREST.
      gateway = await listen(async (req, res) => {
        if (!req.url || !req.url.startsWith('/rest/v1/')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Not found' }));
          return;
        }

        const apiKey = req.headers.apikey;
        let authorization = req.headers.authorization;
        if (apiKey === serverSecretKey) {
          authorization = `Bearer ${serviceRoleJwt}`;
        } else if (apiKey === publishableKey) {
          if (!authorization) {
            authorization = `Bearer ${anonJwt}`;
          }
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Invalid API key' }));
          return;
        }

        const strippedPath = req.url.slice('/rest/v1'.length);
        if (failNextReceiptRead && req.method === 'GET' && strippedPath.startsWith('/orders?')) {
          failNextReceiptRead = false;
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Simulated PostgREST read failure after commit' }));
          return;
        }

        const rawBody = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        const upstreamHeaders = {
          Accept: req.headers.accept || 'application/json',
          Authorization: authorization,
        };
        if (req.headers['content-type']) {
          upstreamHeaders['Content-Type'] = req.headers['content-type'];
        }
        if (req.headers.prefer) {
          upstreamHeaders.Prefer = req.headers.prefer;
        }

        const upstreamResponse = await originalFetch(`${postgrestUrl}${strippedPath}`, {
          method: req.method,
          headers: upstreamHeaders,
          body: rawBody,
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        });

        const serverHeader = upstreamResponse.headers.get('server') ?? '';
        assert.match(serverHeader, /^postgrest\//i, 'Response must originate from real PostgREST');
        const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
        postgrestRequests.push({
          method: req.method,
          path: strippedPath,
          status: upstreamResponse.status,
          server: serverHeader,
          receiptRows: req.method === 'GET' && strippedPath.startsWith('/orders?') && upstreamResponse.ok
            ? JSON.parse(responseBody.toString('utf8')) : undefined,
        });

        const responseHeaders = {};
        upstreamResponse.headers.forEach((value, headerName) => {
          responseHeaders[headerName] = value;
        });
        res.writeHead(upstreamResponse.status, responseHeaders);
        res.end(responseBody);
      });

      process.env.NEXT_PUBLIC_SUPABASE_URL = gateway.url;
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
      process.env.SUPABASE_SERVER_SECRET_KEY = serverSecretKey;

      const { POST } = require(path.join(root, 'app/api/public/orders/route.ts'));
      const { fetchRecordedOrderReceipt } = require(path.join(root, 'app/api/public/orders/receipt.ts'));
      const { createPublicOrder, PublicOrderRequestError } = require(path.join(root, 'lib/supabase-orders.ts'));

      transport = await listen(async (req, res) => {
        assert.equal(req.url, '/api/public/orders');
        const raw = await readBody(req);
        orderApiRequests.push(JSON.parse(raw));
        const clientIp = `192.0.2.${clientIpCounter++}`;
        const response = await POST(
          new Request('http://127.0.0.1/api/public/orders', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-vercel-forwarded-for': clientIp,
            },
            body: raw,
          }),
        );

        if (dropNextOrderResponse) {
          assert.equal(response.status, 200);
          beforeResponseLossSnapshot = await snapshot();
          assert.equal(beforeResponseLossSnapshot.orders.length, 1);
          assert.equal(beforeResponseLossSnapshot.items.length, 1);
          dropNextOrderResponse = false;
          assert.equal(res.headersSent, false);
          res.destroy();
          return;
        }

        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      });

      const allowedOrigins = new Set([parsedPostgrestUrl.origin, gateway.url, transport.url]);
      globalThis.fetch = (input, init) => {
        const resolved = new URL(String(input), transport.url);
        assert.ok(
          allowedOrigins.has(resolved.origin),
          `Non-loopback fetch denied: ${resolved.origin}`,
        );
        return originalFetch(resolved, {
          ...init,
          redirect: 'error',
          signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        });
      };
      globalThis.window = { setTimeout, clearTimeout };

      await t.test('October 30, 2026 narrow GRANT compliance and unauthorized PostgREST access denial', async () => {
        await resetOrderState();

        // Inspect actual ACL contents in global AND per-schema defaults.
        // Restrictive pg_default_acl rows are expected; row count alone proves nothing.
        assert.equal(
          await runPsql(`
            select count(*)
            from pg_default_acl d
            cross join lateral aclexplode(d.defaclacl) acl
            where d.defaclrole = 'postgres'::regrole
              and d.defaclnamespace in (0, 'public'::regnamespace::oid)
              and d.defaclobjtype in ('r', 'S', 'f')
              and (acl.grantee = 0 or acl.grantee in (
                select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')
              ));
          `),
          '0',
        );
        assert.equal(
          await runPsql(`
            select count(*) from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
            where n.nspname = 'public' and acl.grantee = 0 and acl.privilege_type = 'EXECUTE';
          `),
          '0',
        );

        // 2. No broad GRANT ALL privileges (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) on any public table.
        assert.equal(
          await runPsql(`
            select count(*)
            from (values ('businesses'), ('products'), ('orders'), ('order_items'), ('business_order_counters'), ('public_order_rate_limit_buckets')) as t(table_name)
            cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
            cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as p(priv_name)
            where has_table_privilege(r.role_name, format('public.%I', t.table_name), p.priv_name);
          `),
          '0',
        );

        // 3. Missing or invalid apikey is rejected with 401.
        const missingKeyRes = await globalThis.fetch(`${gateway.url}/rest/v1/orders?select=*`);
        assert.equal(missingKeyRes.status, 401);

        // 4. anon role can read eligible public catalog rows via PostgREST.
        const catalogRes = await globalThis.fetch(
          `${gateway.url}/rest/v1/products?select=id,name,price&order=sort_order.asc`,
          { headers: { apikey: publishableKey } },
        );
        assert.equal(catalogRes.status, 200);
        const catalogRows = await catalogRes.json();
        assert.equal(catalogRows.length, 3);

        // SELECT grants alone must not bypass catalog RLS for either client role.
        await runPsql(`update public.products set is_active = false where id = '${secondProductId}';`);
        for (const token of [anonJwt, authenticatedJwt]) {
          const visible = await globalThis.fetch(`${gateway.url}/rest/v1/products?select=id`, {
            headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
          });
          assert.equal(visible.status, 200);
          const rows = await visible.json();
          assert.equal(rows.length, 2);
          assert.ok(rows.every(row => row.id !== secondProductId));
        }
        await runPsql(`update public.products set is_active = true where id = '${secondProductId}';`);

        const deniedOrderRpcBody = JSON.stringify({
          p_business_slug: 'local-postgrest-pilot',
          p_order_type: 'delivery',
          p_customer_name: 'Synthetic Customer',
          p_customer_phone: '05550000000',
          p_customer_address: 'Adres: Synthetic Street 10',
          p_customer_note: 'Synthetic test only',
          p_items: [{ product_id: productId, quantity: 2 }],
          p_idempotency_key: defaultKey,
          p_payment_method: 'cash',
        });
        const deniedLimiterRpcBody = JSON.stringify({
          p_ip_fingerprint: '0'.repeat(64), p_business_slug: 'local-postgrest-pilot',
        });
        const stateBeforeDeniedRequests = await snapshot();

        // Supply valid RPC parameters: {} would fail schema-cache resolution
        // (PGRST202) before PostgreSQL could check EXECUTE permissions.
        // 5. anon and authenticated roles are denied on orders, order_items, counters, rate limits, RPCs, and catalog mutations.
        const unauthorizedCases = [
          ['anon orders read', 'GET', '/rest/v1/orders?select=business_order_number,total_amount,order_items(*),businesses!inner(slug)', { apikey: publishableKey }, undefined],
          ['anon order_items read', 'GET', '/rest/v1/order_items?select=*', { apikey: publishableKey }, undefined],
          ['anon counters read', 'GET', '/rest/v1/business_order_counters?select=*', { apikey: publishableKey }, undefined],
          ['anon rate_limit read', 'GET', '/rest/v1/public_order_rate_limit_buckets?select=*', { apikey: publishableKey }, undefined],
          ['anon create_order RPC', 'POST', '/rest/v1/rpc/create_order_with_items', { apikey: publishableKey, 'Content-Type': 'application/json' }, deniedOrderRpcBody],
          ['anon rate_limit RPC', 'POST', '/rest/v1/rpc/check_public_order_rate_limit', { apikey: publishableKey, 'Content-Type': 'application/json' }, deniedLimiterRpcBody],
          ['anon product price mutation', 'PATCH', `/rest/v1/products?id=eq.${productId}`, { apikey: publishableKey, 'Content-Type': 'application/json' }, JSON.stringify({ price: 1 })],
          ['authenticated orders read', 'GET', '/rest/v1/orders?select=*', { apikey: publishableKey, Authorization: `Bearer ${authenticatedJwt}` }, undefined],
          ['authenticated order_items read', 'GET', '/rest/v1/order_items?select=*', { apikey: publishableKey, Authorization: `Bearer ${authenticatedJwt}` }, undefined],
          ['authenticated create_order RPC', 'POST', '/rest/v1/rpc/create_order_with_items', { apikey: publishableKey, Authorization: `Bearer ${authenticatedJwt}`, 'Content-Type': 'application/json' }, deniedOrderRpcBody],
          ['authenticated product price mutation', 'PATCH', `/rest/v1/products?id=eq.${productId}`, { apikey: publishableKey, Authorization: `Bearer ${authenticatedJwt}`, 'Content-Type': 'application/json' }, JSON.stringify({ price: 1 })],
          ['authenticated business mutation', 'PATCH', `/rest/v1/businesses?id=eq.${businessId}`, { apikey: publishableKey, Authorization: `Bearer ${authenticatedJwt}`, 'Content-Type': 'application/json' }, JSON.stringify({ is_open: false })],
        ];

        for (const [label, method, urlPath, headers, body] of unauthorizedCases) {
          const response = await globalThis.fetch(`${gateway.url}${urlPath}`, { method, headers, body });
          assert.ok(
            response.status === 401 || response.status === 403,
            `Expected 401/403 from PostgREST for ${label}, got ${response.status}`,
          );
          const errorPayload = await response.json();
          assert.equal(errorPayload.code, '42501', `Expected PostgreSQL 42501 ACL denial for ${label}`);
        }
        assert.deepEqual(await snapshot(), stateBeforeDeniedRequests);
        assert.equal(await runPsql(`select price from public.products where id = '${productId}';`), '125.00');
        assert.equal(await runPsql(`select is_open from public.businesses where id = '${businessId}';`), 't');
      });

      await t.test('product price change, committed total, multi-item order lines, and WhatsApp message snapshot via real PostgREST', async () => {
        await resetOrderState();

        // Update catalog prices in PostgreSQL before the customer submits their stale cart.
        await runPsql(`
          update public.products set price = 135.50, name = 'Recorded Kebap' where id = '${productId}';
          update public.products set price = 12.25, name = 'Recorded Ayran' where id = '${secondProductId}';
        `);

        const priceChangeKey = '22222222-1111-4111-8111-111111111111';
        const client = createClientHarness(createPublicOrder, PublicOrderRequestError, {
          idempotencyKey: priceChangeKey,
          orderType: 'delivery',
          paymentMethod: 'card',
          cart: [
            { id: productId, name: 'Stale Cart Kebap', price: 125.0, quantity: 2 },
            { id: secondProductId, name: 'Stale Cart Ayran', price: 10.25, quantity: 3 },
          ],
        });

        await client.context.submitOrder({ preventDefault() {} });

        assert.equal(client.state.mode, 'saved');
        assert.equal(client.state.popupClosed, 1, 'Prepared popup must close when prices changed');
        assert.equal(client.state.whatsappCalls, 0, 'WhatsApp must not auto-navigate before customer sees updated price notice');
        assert.equal(client.state.storageClears, 1);
        assert.equal(client.context.cart.length, 0);

        // Expected committed total: (2 * 135.50) + (3 * 12.25) = 271.00 + 36.75 = 307.75
        assert.match(
          client.state.warning,
          /Fiyatlar güncellendi\. Sipariş #1, 307,75 TL tutarıyla kaydedildi\./,
        );
        assert.match(
          client.state.message,
          /- Recorded Kebap x 2 \(135,50 TL\) = 271,00 TL/,
        );
        assert.match(
          client.state.message,
          /- Recorded Ayran x 3 \(12,25 TL\) = 36,75 TL/,
        );
        assert.match(client.state.message, /Genel Toplam: 307,75 TL/);
        assert.match(client.state.message, /Ödeme Yöntemi: Kart \(fiziksel POS\)/);
        assert.doesNotMatch(
          client.state.message,
          /Stale Cart|125,00 TL|10,25 TL|280,75 TL/,
        );

        const dbState = await snapshot();
        assert.equal(dbState.orders.length, 1);
        assert.equal(Number(dbState.orders[0].total_amount), 307.75);
        assert.equal(dbState.items.length, 2);

        // Inspect the actual response consumed by receipt.ts, not only a second,
        // manually assembled copy of its SELECT query.
        const observedReceipt = postgrestRequests.find(entry =>
          Number(entry.receiptRows?.[0]?.total_amount) === 307.75);
        assert.ok(observedReceipt, 'Actual successful receipt query must be observed');
        const observedQuery = new URL(observedReceipt.path, gateway.url).searchParams;
        assert.equal(observedQuery.get('businesses.slug'), 'eq.local-postgrest-pilot');
        assert.equal(observedQuery.get('idempotency_key'), `eq.${priceChangeKey}`);
        assert.equal(observedQuery.get('business_order_number'), 'eq.1');
        assert.equal(observedQuery.get('limit'), '2');
        assert.deepEqual(Object.keys(observedReceipt.receiptRows[0]).sort(), [
          'business_order_number', 'businesses', 'currency', 'order_items',
          'order_type', 'payment_method', 'total_amount',
        ]);
        for (const item of observedReceipt.receiptRows[0].order_items) {
          assert.deepEqual(Object.keys(item).sort(), ['line_total', 'product_id', 'product_name', 'quantity', 'unit_price']);
        }

        const requestCountBeforeReopen = orderApiRequests.length;
        vm.runInContext('reopenWhatsApp(); reopenWhatsApp();', client.context);
        assert.equal(client.state.whatsappCalls, 2);
        assert.equal(orderApiRequests.length, requestCountBeforeReopen, 'Reopening WhatsApp must not re-POST');
      });

      await t.test('real PostgREST receipt filters (businesses!inner(slug), idempotency_key, business_order_number) and post-commit price immutability', async () => {
        const committedKey = '22222222-1111-4111-8111-111111111111';
        const committedResult = {
          order_number: 1,
          total_amount: '307.75',
          order_type: 'delivery',
        };

        // Mutate product catalog prices and names AFTER the order was already committed.
        await runPsql(`
          update public.products set price = 999.00, name = 'Mutated After Commit Kebap' where id = '${productId}';
          update public.products set price = 888.00, name = 'Mutated After Commit Ayran' where id = '${secondProductId}';
        `);

        // 1. Valid receipt lookup through real PostgREST returns the immutable committed order_items snapshot.
        const receipt = await fetchRecordedOrderReceipt(
          gateway.url,
          serverSecretKey,
          'local-postgrest-pilot',
          committedKey,
          committedResult,
        );
        assert.equal(receipt.orderNumber, 1);
        assert.equal(receipt.totalAmount, 307.75);
        assert.equal(receipt.items.length, 2);
        const kebapLine = receipt.items.find(item => item.productId === productId);
        const ayranLine = receipt.items.find(item => item.productId === secondProductId);
        assert.deepEqual(kebapLine, {
          productId,
          productName: 'Recorded Kebap',
          unitPrice: 135.5,
          quantity: 2,
          lineTotal: 271,
        });
        assert.deepEqual(ayranLine, {
          productId: secondProductId,
          productName: 'Recorded Ayran',
          unitPrice: 12.25,
          quantity: 3,
          lineTotal: 36.75,
        });

        // 2. Foreign business slug filter (businesses!inner(slug)) rejects cross-tenant read.
        await assert.rejects(
          () =>
            fetchRecordedOrderReceipt(
              gateway.url,
              serverSecretKey,
              'foreign-postgrest-pilot',
              committedKey,
              committedResult,
            ),
          /Recorded order receipt not unique/,
        );

        // 3. Mismatched idempotency_key filter rejects read.
        await assert.rejects(
          () =>
            fetchRecordedOrderReceipt(
              gateway.url,
              serverSecretKey,
              'local-postgrest-pilot',
              '99999999-9999-4999-8999-999999999999',
              committedResult,
            ),
          /Recorded order receipt not unique/,
        );

        // 4. Mismatched business_order_number filter rejects read.
        await assert.rejects(
          () =>
            fetchRecordedOrderReceipt(
              gateway.url,
              serverSecretKey,
              'local-postgrest-pilot',
              committedKey,
              { ...committedResult, order_number: 2 },
            ),
          /Recorded order receipt not unique/,
        );

        // 5. Inconsistent committed total fails closed.
        await assert.rejects(
          () =>
            fetchRecordedOrderReceipt(
              gateway.url,
              serverSecretKey,
              'local-postgrest-pilot',
              committedKey,
              { ...committedResult, total_amount: '999.00' },
            ),
          /Recorded order receipt inconsistent/,
        );

        // 6. Direct PostgREST inspection confirms no customer PII columns are returned by the receipt select clause.
        const rawReceiptQuery = new URLSearchParams({
          select:
            'business_order_number,total_amount,order_type,payment_method,currency,order_items(product_id,product_name,unit_price,quantity,line_total),businesses!inner(slug)',
          'businesses.slug': 'eq.local-postgrest-pilot',
          idempotency_key: `eq.${committedKey}`,
          business_order_number: 'eq.1',
          limit: '2',
        });
        const rawRes = await globalThis.fetch(`${gateway.url}/rest/v1/orders?${rawReceiptQuery}`, {
          headers: { apikey: serverSecretKey },
        });
        assert.equal(rawRes.status, 200);
        const rawRows = await rawRes.json();
        assert.equal(rawRows.length, 1);
        assert.deepEqual(
          Object.keys(rawRows[0]).sort(),
          [
            'business_order_number',
            'businesses',
            'currency',
            'order_items',
            'order_type',
            'payment_method',
            'total_amount',
          ],
        );
      });

      await t.test('response loss after DB commit, catalog price change before retry, idempotent duplicate, and 409 conflict', async () => {
        await resetOrderState();

        const lossKey = defaultKey;
        const observedErrors = [];
        const client = createClientHarness(
          async payload => {
            try {
              return await createPublicOrder(payload);
            } catch (error) {
              observedErrors.push({ code: error.code, kind: error.kind });
              throw error;
            }
          },
          PublicOrderRequestError,
          { idempotencyKey: lossKey, whatsappOpens: false },
        );

        dropNextOrderResponse = true;
        const startRequestCount = orderApiRequests.length;

        await client.context.submitOrder({ preventDefault() {} });

        assert.deepEqual(observedErrors, [{ code: 'NETWORK_ERROR', kind: 'uncertain' }]);
        assert.equal(client.state.mode, 'uncertain');
        assert.equal(client.state.storageClears, 0);
        assert.equal(client.context.pendingOrderAttemptRef.current.idempotencyKey, lossKey);
        assert.ok(beforeResponseLossSnapshot);
        assert.equal(beforeResponseLossSnapshot.orders.length, 1);

        // Change product price in PostgreSQL after the first order committed but before the client retries.
        await runPsql(`
          update public.products set price = 900.00 where id = '${productId}';
        `);

        await client.context.retryPendingOrder();

        assert.equal(client.state.mode, 'saved');
        assert.equal(client.state.storageClears, 1);
        assert.equal(client.context.pendingOrderAttemptRef.current, null);
        assert.match(client.state.message, /Sipariş No: #1\b/);
        assert.match(client.state.message, /Genel Toplam: 250,00 TL/);
        assert.doesNotMatch(client.state.message, /900,00 TL|1\.800,00 TL/);

        assert.equal(orderApiRequests.length, startRequestCount + 2);
        assert.deepEqual(
          orderApiRequests[startRequestCount],
          orderApiRequests[startRequestCount + 1],
        );
        assert.deepEqual(await snapshot(), beforeResponseLossSnapshot);

        // Direct duplicate call with the same idempotencyKey returns the committed receipt without inserting a row.
        const duplicateReceipt = await createPublicOrder(orderApiRequests[startRequestCount]);
        assert.equal(duplicateReceipt.orderNumber, 1);
        assert.equal(duplicateReceipt.totalAmount, 250);
        assert.deepEqual(await snapshot(), beforeResponseLossSnapshot);

        // Reusing the same idempotencyKey with a modified payload is rejected with 409 IDEMPOTENCY_CONFLICT.
        const conflictingPayload = structuredClone(orderApiRequests[startRequestCount]);
        conflictingPayload.items[0].quantity = 3;
        await assert.rejects(
          () => createPublicOrder(conflictingPayload),
          error =>
            error instanceof PublicOrderRequestError &&
            error.code === 'IDEMPOTENCY_CONFLICT' &&
            error.status === 409,
        );
        assert.deepEqual(await snapshot(), beforeResponseLossSnapshot);

        // Verify canonical version-2 payload hash persisted in PostgreSQL.
        const committedOrder = beforeResponseLossSnapshot.orders[0];
        const expectedHash = await runPsql(`
          select encode(
            extensions.digest(
              convert_to(
                jsonb_build_object(
                  'version', 2,
                  'business_id', '${businessId}',
                  'order_type', 'delivery',
                  'customer_name', 'Synthetic Customer',
                  'customer_phone', '05550000000',
                  'customer_address', 'Adres: Synthetic Street 10',
                  'customer_note', 'Synthetic test only',
                  'items', jsonb_build_array(jsonb_build_object('product_id', '${productId}', 'quantity', 2)),
                  'payment_method', 'cash'
                )::text,
                'UTF8'
              ),
              'sha256'
            ),
            'hex'
          );
        `);
        assert.equal(committedOrder.idempotency_payload_hash, expectedHash);
      });

      await t.test('post-commit PostgREST receipt read failure returns 503 ORDER_RECEIPT_UNAVAILABLE and recovers idempotently', async () => {
        await resetOrderState();

        const readFailKey = '77777777-7777-4777-8777-777777777777';
        const observedErrors = [];
        const client = createClientHarness(
          async payload => {
            try {
              return await createPublicOrder(payload);
            } catch (error) {
              observedErrors.push({ code: error.code, kind: error.kind, status: error.status });
              throw error;
            }
          },
          PublicOrderRequestError,
          { idempotencyKey: readFailKey, whatsappOpens: false },
        );

        failNextReceiptRead = true;
        await client.context.submitOrder({ preventDefault() {} });

        assert.deepEqual(observedErrors, [
          { code: 'ORDER_RECEIPT_UNAVAILABLE', kind: 'uncertain', status: 503 },
        ]);
        assert.equal(client.state.mode, 'uncertain');
        assert.equal(client.state.message, '');
        assert.equal((await snapshot()).orders.length, 1);

        // Change product price in DB before retry; recovery must still return the committed 250,00 TL snapshot.
        await runPsql(`
          update public.products set price = 777.00 where id = '${productId}';
        `);

        await client.context.retryPendingOrder();
        assert.equal(client.state.mode, 'saved');
        assert.match(client.state.message, /Genel Toplam: 250,00 TL/);
        assert.doesNotMatch(client.state.message, /777,00 TL|1\.554,00 TL/);
        assert.equal((await snapshot()).orders.length, 1);
      });

      await t.test('concurrent same-key retries, conflicting payloads, and distinct order numbers', async () => {
        const payload = key => ({
          businessSlug: 'local-postgrest-pilot', orderType: 'delivery', paymentMethod: 'cash',
          customer: {
            fullName: 'Synthetic Customer', phone: '05550000000',
            address: 'Adres: Synthetic Street 10', note: 'Synthetic test only',
          },
          items: [{ productId, quantity: 2 }], idempotencyKey: key,
        });

        await resetOrderState();
        const same = payload('88888888-8888-4888-8888-888888888888');
        const repeated = await Promise.all([
          createPublicOrder(structuredClone(same)), createPublicOrder(structuredClone(same)),
        ]);
        assert.deepEqual(repeated[0], repeated[1]);
        const single = await snapshot();
        assert.equal(single.orders.length, 1);
        assert.equal(single.items.length, 1);
        assert.equal(Number(single.counters[0].next_order_number), 2);

        await resetOrderState();
        const first = payload('99999999-1111-4111-8111-111111111111');
        const changed = structuredClone(first);
        changed.items[0].quantity = 3;
        const conflict = await Promise.allSettled([
          createPublicOrder(first), createPublicOrder(changed),
        ]);
        assert.equal(conflict.filter(result => result.status === 'fulfilled').length, 1);
        const rejected = conflict.filter(result => result.status === 'rejected');
        assert.equal(rejected.length, 1);
        assert.ok(rejected[0].reason instanceof PublicOrderRequestError);
        assert.equal(rejected[0].reason.code, 'IDEMPOTENCY_CONFLICT');
        assert.equal(rejected[0].reason.status, 409);
        const winner = await snapshot();
        assert.equal(winner.orders.length, 1);
        assert.equal(winner.items.length, 1);
        assert.equal(Number(winner.counters[0].next_order_number), 2);

        await resetOrderState();
        const distinct = await Promise.all([
          createPublicOrder(payload('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
          createPublicOrder(payload('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
        ]);
        assert.deepEqual(distinct.map(receipt => receipt.orderNumber).sort((a, b) => a - b), [1, 2]);
        const two = await snapshot();
        assert.equal(two.orders.length, 2);
        assert.equal(two.items.length, 2);
        assert.equal(Number(two.counters[0].next_order_number), 3);
        // These are overlapping HTTP requests, not a deterministic lock scheduler
        // or a load test; actual PostgreSQL behavior still requires the CI run.
      });

      assert.ok(
        postgrestRequests.length >= 20,
        `Expected at least 20 real PostgREST requests, observed ${postgrestRequests.length}`,
      );
      t.diagnostic(
        JSON.stringify({
          postgrestRequestCount: postgrestRequests.length,
          postgrestServer: postgrestRequests[0]?.server,
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (originalWindow === undefined) delete globalThis.window;
      else globalThis.window = originalWindow;
      for (const name of [
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        'SUPABASE_SERVER_SECRET_KEY',
      ]) {
        if (savedEnv[name] === undefined) delete process.env[name];
        else process.env[name] = savedEnv[name];
      }
      if (transport) await closeServer(transport.server);
      if (gateway) await closeServer(gateway.server);
    }
  },
);
