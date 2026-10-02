// Opt-in, entirely local: RUN_CHECKOUT_RESPONSE_LOSS_PG=1 node --test <this file>
// Real checked-in API/client functions and SQL; a small HTTP-to-psql adapter
// replaces PostgREST. React rendering is outside this regression's scope.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFile } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const source = name => readFileSync(path.join(root, name), 'utf8');
const image = 'supabase/postgres:17.6.1.127';
const imageId = 'sha256:be60aee15997daca475b710b734bc6bfe52cd544dcd7e9fd2ff58210b6747d83';
const businessId = '33333333-3333-4333-8333-333333333333';
const productId = '22222222-2222-4222-8222-222222222222';
const key = '11111111-1111-4111-8111-111111111111';
const transpile = text => ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
}}).outputText;
// Scoped to this standalone test process; no application file is modified.
require.extensions['.ts'] = (mod, filename) => mod._compile(transpile(readFileSync(filename, 'utf8')), filename);
function run(args, stdin) {
  return new Promise(resolve => {
    const child = execFile('docker', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ failed: Boolean(error), stdout: stdout.trim(), stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}
async function succeeds(args, stdin) {
  const result = await run(args, stdin);
  assert.equal(result.failed, false, result.stderr);
  return result.stdout;
}
const quote = value => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}
async function listen(handler) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(error => {
      if (!res.destroyed) { res.writeHead(500); res.end(JSON.stringify({ message: error.message })); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
// Execute original nested functions, extracted by AST (no copied implementation).
// Only React state setters, browser storage/window and display dependencies are fixtures.
function clientHarness(createPublicOrder, PublicOrderRequestError) {
  const text = source('app/isletme/[slug]/PublicBusinessPageClient.tsx');
  const ast = ts.createSourceFile('client.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(['submitOrder', 'retryPendingOrder', 'createMessage']);
  const functions = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) functions.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(functions.length, 3);
  const state = { mode: 'none', message: '', warning: '', storageClears: 0 };
  const context = {
    createPublicOrder, PublicOrderRequestError,
    ...require(path.join(root, 'lib/payment-methods.ts')),
    ...require(path.join(root, 'lib/public-order-address.ts')),
    pendingOrderAttemptRef: { current: null }, activeOrderRequestRef: { current: null },
    isRecordingOrderRef: { current: false },
    crypto: { randomUUID: () => key },
    currentBusiness: { slug: 'local-response-loss', name: 'Local fixture', whatsappOrderNumber: '905550000000' },
    customer: { fullName: 'Local Fixture', phone: '05550000000', note: 'Synthetic only' },
    deliveryAddress: { district: '', neighborhood: '', streetAddress: 'Local Test Street 1', building: '', floorUnit: '', directions: '' },
    cart: [{ id: productId, name: 'Local fixture item', price: 125, quantity: 2 }],
    total: 250, orderType: 'delivery', paymentMethod: 'cash', slug: 'local-response-loss',
    isOrderingOpen: true, minimumOrderWarning: '',
    normalizeWhatsAppPhone: value => value, isMobileDevice: () => false,
    window: { open: () => ({ close() {}, opener: null }), localStorage: {} },
    clearPublicCart: () => state.storageClears++,
    formatPrice: amount => `${amount} TRY`, sendWhatsAppMessage: () => false,
    setOrderRecoveryMode: value => state.mode = value,
    setVerifiedWhatsAppMessage: value => state.message = value,
    setOrderRecordWarning: value => state.warning = value,
    setWarning() {}, setPaymentMethodError() {}, setIsRecordingOrder() {}, setCart() {},
  };
  vm.createContext(context);
  vm.runInContext(transpile(functions.join('\n')), context);
  return { context, state };
}

test('checkout recovers after committed DB order and lost HTTP response without duplicates', {
  skip: process.env.RUN_CHECKOUT_RESPONSE_LOSS_PG !== '1', timeout: 180000,
}, async t => {
  const container = `checkout-response-loss-${process.pid}-${Date.now()}`;
  const sqlArgs = ['exec', '-i', container, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'supabase_admin', '-d', 'postgres'];
  const sql = statement => succeeds(sqlArgs, statement);
  const snapshot = async () => JSON.parse(await sql(`select json_build_object(
    'orders', coalesce((select json_agg(o order by id) from public.orders o), '[]'),
    'items', coalesce((select json_agg(i order by id) from public.order_items i), '[]'),
    'counters', coalesce((select json_agg(c order by business_id) from public.business_order_counters c), '[]'));`));
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let started = false, adapter, transport;
  const requests = [], events = [], errors = [];
  let beforeLoss, dropFirst = true;
  try {
    assert.equal(await succeeds(['image', 'inspect', image, '--format', '{{.Id}}']), imageId);
    await succeeds(['run', '-d', '--rm', '--pull=never', '--name', container, '--network', 'none',
      '--env', 'POSTGRES_PASSWORD=local_fixture_only', image]);
    started = true;
    assert.equal(await succeeds(['inspect', container, '--format',
      '{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{json .HostConfig.Binds}}']), 'none|{}|null');
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!(await run(['exec', container, 'pg_isready', '-U', 'postgres'])).failed) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (!(await run(['exec', container, 'pg_isready', '-U', 'postgres'])).failed) { ready = true; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready);
    assert.match(await sql('show server_version;'), /^17\./);
    await sql(`
      create schema if not exists extensions;
      create extension if not exists pgcrypto schema extensions;
      create extension if not exists pg_cron schema pg_catalog;
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      end $$;
      create table public.businesses(id uuid primary key, slug text unique, minimum_order_amount numeric default 0,
        is_active boolean default true, is_open boolean default true, subscription_status text default 'active',
        subscription_expires_at timestamptz default '2099-01-01');
      create table public.products(id uuid primary key, business_id uuid references public.businesses,
        name text, price numeric, is_active boolean default true);
      grant usage on schema public, extensions to service_role;
      grant select on public.businesses, public.products to service_role;
    `);
    for (const name of ['20260623103000_add_order_management', '20260623104000_add_business_order_numbers',
      '20260713100000_add_business_and_order_payment_methods', '20260901202413_public_order_rate_limit']) {
      await sql(source(`supabase/migrations/${name}.sql`));
    }
    await sql(`insert into public.businesses(id,slug) values('${businessId}','local-response-loss');
      insert into public.products(id,business_id,name,price) values('${productId}','${businessId}','Local fixture item',125);`);
    assert.equal(await sql(`select count(*) from pg_constraint where conrelid='public.orders'::regclass
      and conname='orders_business_idempotency_key_unique' and contype='u';`), '1');
    assert.deepEqual((await snapshot()).orders, []);

    adapter = await listen(async (req, res) => {
      assert.equal(req.headers.apikey, 'local_fixture_secret');
      const p = JSON.parse(await body(req));
      let statement;
      if (req.url === '/rest/v1/rpc/check_public_order_rate_limit') {
        statement = `select row_to_json(r) from public.check_public_order_rate_limit(${quote(p.p_ip_fingerprint)},${quote(p.p_business_slug)}) r;`;
      } else {
        assert.equal(req.url, '/rest/v1/rpc/create_order_with_items');
        statement = `select row_to_json(r) from public.create_order_with_items(
          ${quote(p.p_business_slug)},${quote(p.p_order_type)},${quote(p.p_customer_name)},${quote(p.p_customer_phone)},
          ${quote(p.p_customer_address)},${quote(p.p_customer_note)},${quote(JSON.stringify(p.p_items))}::jsonb,
          ${quote(p.p_idempotency_key)}::uuid,${quote(p.p_payment_method)}) r;`;
      }
      // Explicit COMMIT completes before adapter acknowledges the RPC. Every
      // snapshot uses another psql connection, so uncommitted rows cannot pass.
      const result = await run(sqlArgs, `begin; set local role service_role; ${statement} commit;`);
      res.setHeader('Content-Type', 'application/json');
      if (result.failed) { res.writeHead(400); res.end(JSON.stringify({ message: result.stderr })); return; }
      if (req.url.endsWith('/create_order_with_items')) events.push('rpc-committed');
      res.end(JSON.stringify(result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))));
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = adapter.url;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_local_fixture';
    process.env.SUPABASE_SERVER_SECRET_KEY = 'local_fixture_secret';
    const { POST } = require(path.join(root, 'app/api/public/orders/route.ts'));
    const { createPublicOrder, PublicOrderRequestError } = require(path.join(root, 'lib/supabase-orders.ts'));
    transport = await listen(async (req, res) => {
      assert.equal(req.url, '/api/public/orders');
      const raw = await body(req);
      requests.push(JSON.parse(raw));
      const response = await POST(new Request('http://127.0.0.1/api/public/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vercel-forwarded-for': '127.0.0.1' }, body: raw,
      }));
      if (dropFirst) {
        assert.equal(response.status, 200);
        beforeLoss = await snapshot();
        assert.equal(beforeLoss.orders.length, 1);
        assert.equal(beforeLoss.items.length, 1);
        events.push('independent-connection-sees-committed-order');
        dropFirst = false;
        assert.equal(res.headersSent, false);
        events.push('socket-destroyed-before-response');
        res.destroy();
        return;
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    });
    // Deny every destination except the two freshly created loopback listeners.
    globalThis.fetch = (input, init) => {
      const url = new URL(String(input), transport.url);
      assert.ok([adapter.url, transport.url].includes(url.origin), `Nonlocal fetch denied: ${url.origin}`);
      return originalFetch(url, init);
    };
    globalThis.window = { setTimeout, clearTimeout };
    const client = clientHarness(async payload => {
      try { return await createPublicOrder(payload); }
      catch (error) { errors.push({ code: error.code, kind: error.kind }); throw error; }
    }, PublicOrderRequestError);
    await client.context.submitOrder({ preventDefault() {} });
    assert.deepEqual(errors, [{ code: 'NETWORK_ERROR', kind: 'uncertain' }]);
    assert.equal(client.state.mode, 'uncertain');
    assert.equal(client.state.storageClears, 0);
    const pending = client.context.pendingOrderAttemptRef.current;
    assert.equal(pending.idempotencyKey, key);
    assert.deepEqual(events, ['rpc-committed', 'independent-connection-sees-committed-order', 'socket-destroyed-before-response']);
    events.push('client-recovery-triggered');
    await client.context.retryPendingOrder();
    assert.equal(client.state.mode, 'saved');
    assert.equal(client.state.storageClears, 1);
    assert.equal(client.context.pendingOrderAttemptRef.current, null);
    assert.match(client.state.message, new RegExp(`Sipariş No: #${beforeLoss.orders[0].business_order_number}\\b`));
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.deepEqual(await snapshot(), beforeLoss);
    const duplicate = await createPublicOrder(requests[0]);
    assert.equal(duplicate.orderNumber, beforeLoss.orders[0].business_order_number);
    assert.equal(duplicate.totalAmount, 250);
    assert.deepEqual(await snapshot(), beforeLoss);
    const changed = structuredClone(requests[0]);
    changed.items[0].quantity = 3;
    await assert.rejects(createPublicOrder(changed), error =>
      error instanceof PublicOrderRequestError && error.code === 'IDEMPOTENCY_CONFLICT' && error.status === 409);
    assert.deepEqual(await snapshot(), beforeLoss);
    const order = beforeLoss.orders[0], item = beforeLoss.items[0];
    assert.equal(order.idempotency_key, key);
    assert.match(order.idempotency_payload_hash, /^[a-f0-9]{64}$/);
    assert.equal(order.total_amount, 250);
    assert.equal(order.payment_method, 'cash');
    assert.equal(order.order_type, 'delivery');
    assert.equal(order.customer_address, 'Adres: Local Test Street 1');
    assert.equal(item.order_id, order.id);
    assert.equal(item.product_id, productId);
    assert.equal(item.quantity, 2);
    assert.equal(item.unit_price, 125);
    assert.equal(item.line_total, 250);
    // Independent reconstruction of the version-2 canonical payload hash.
    const hash = await sql(`select encode(extensions.digest(convert_to(jsonb_build_object(
      'version',2,'business_id','${businessId}','order_type','delivery','customer_name','Local Fixture',
      'customer_phone','05550000000','customer_address','Adres: Local Test Street 1','customer_note','Synthetic only',
      'items',jsonb_build_array(jsonb_build_object('product_id','${productId}','quantity',2)),
      'payment_method','cash')::text,'UTF8'),'sha256'),'hex');`);
    assert.equal(order.idempotency_payload_hash, hash);
    t.diagnostic(JSON.stringify({ events, requestCount: requests.length, beforeLoss,
      recoveredOrderNumber: duplicate.orderNumber, conflict: 409, unchangedAfterConflict: true }));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVER_SECRET_KEY']) {
      if (savedEnv[name] === undefined) delete process.env[name]; else process.env[name] = savedEnv[name];
    }
    if (transport) await close(transport.server);
    if (adapter) await close(adapter.server);
    if (started) await succeeds(['rm', '-f', container]);
  }
});
