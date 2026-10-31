import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  authGenerationKey, clearBrowserAuthSession, getValidAccessToken,
  readBrowserAuthSession, saveBrowserAuthSession, signInWithPassword,
  signOutBrowserSession,
} from "./browser-auth-session";

// Deterministic storage-boundary interleavings, not a real two-tab browser test.
// The other tab owns its own sessionStorage and shares only localStorage.
function storage() {
  const data = new Map<string, string>();
  const faults = { read: false, write: false, remove: false };
  const hooks: {
    afterGet?: (key: string, value: string | null) => void;
    beforeSet?: (key: string, value: string) => void;
    afterSet?: (key: string, value: string) => void;
  } = {};
  return { data, faults, hooks,
    getItem(key: string) {
      if (faults.read) throw new Error("Synthetic storage read failure");
      const value = data.get(key) ?? null;
      hooks.afterGet?.(key, value);
      return value;
    },
    setItem(key: string, value: string) {
      if (faults.write) throw new Error("Synthetic storage write failure");
      hooks.beforeSet?.(key, value);
      data.set(key, value);
      hooks.afterSet?.(key, value);
    },
    removeItem(key: string) {
      if (faults.remove) throw new Error("Synthetic storage removal failure");
      data.delete(key);
    },
  };
}

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousFetch = globalThis.fetch;
let local: ReturnType<typeof storage>, tab: ReturnType<typeof storage>;
let config: { url: string; publishableKey: string; sessionKey: string };
let serial = 0;
function tokens(owner = "A", expired = false) {
  return { access_token: `synthetic-access-${owner}-${++serial}`,
    refresh_token: `synthetic-refresh-${owner}-${serial}`,
    expires_at: expired ? 1 : Math.floor(Date.now() / 1000) + 3600,
    user: { id: owner } };
}
function seed(owner = "A", expired = false) {
  saveBrowserAuthSession(config.sessionKey, tokens(owner, expired));
  assert.equal(readBrowserAuthSession(config.sessionKey)?.user?.id, owner);
}
async function run(operation: "login" | "refresh") {
  return operation === "login"
    ? signInWithPassword(config, "synthetic@example.invalid", "Synthetic!Password42")
    : getValidAccessToken(config);
}
beforeEach(() => {
  local = storage(); tab = storage();
  config = { url: "http://127.0.0.1:47123", publishableKey: "sb_publishable_synthetic_only",
    sessionKey: `phase23ib-synthetic-${++serial}` };
  Object.defineProperty(globalThis, "window", { configurable: true,
    value: { localStorage: local, sessionStorage: tab } });
  globalThis.fetch = async input => {
    assert.equal(new URL(String(input)).origin, config.url, "No external Auth transport");
    return Response.json(tokens());
  };
});
afterEach(() => {
  globalThis.fetch = previousFetch;
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

for (const operation of ["login", "refresh"] as const) {
  for (const boundary of ["after generation read", "before token write", "after token write"] as const) {
    for (const effect of ["logout", "account change", "generation update"] as const) {
      test(`${operation}: ${effect} ${boundary} rejects old result and preserves the other tab`, async () => {
        seed("A", true);
        const otherTab = storage();
        let fired = false;
        let armed = false;
        const next = `other-tab-${effect}-${++serial}`;
        const intervene = () => {
          if (!armed || fired) return;
          fired = true;
          local.data.set(authGenerationKey(config.sessionKey), next);
          if (effect === "account change") {
            otherTab.data.set(config.sessionKey, JSON.stringify({ ...tokens("B"), generation: next }));
          }
        };
        if (boundary === "after generation read") {
          local.hooks.afterGet = key => { if (key === authGenerationKey(config.sessionKey)) intervene(); };
        } else {
          const writeHook = (key: string) => { if (key === config.sessionKey) intervene(); };
          if (boundary === "before token write") tab.hooks.beforeSet = writeHook;
          else tab.hooks.afterSet = writeHook;
        }
        globalThis.fetch = async () => { armed = true; return Response.json(tokens()); };
        const result = await run(operation);
        assert.equal(fired, true, "The storage-boundary race must actually execute");
        assert.equal(result, null, "The stale operation must not return authentication");
        assert.equal(readBrowserAuthSession(config.sessionKey), null);
        assert.equal(local.data.get(authGenerationKey(config.sessionKey)), next,
          "A stale operation must not invalidate the replacement generation");
        if (effect === "account change") {
          assert.equal(JSON.parse(otherTab.data.get(config.sessionKey)!).user.id, "B");
        }
      });
    }
  }
}

test("saving an explicitly old generation cannot overwrite a newer same-tab account", () => {
  seed();
  const stale = readBrowserAuthSession(config.sessionKey)!;
  clearBrowserAuthSession(config.sessionKey);
  seed("B");
  saveBrowserAuthSession(config.sessionKey, stale);
  assert.equal(readBrowserAuthSession(config.sessionKey)?.user?.id, "B");
});

test("a valid access token is not returned when its read races another tab's invalidation", async () => {
  seed();
  let fired = false;
  local.hooks.afterGet = key => {
    if (key !== authGenerationKey(config.sessionKey) || fired) return;
    fired = true;
    local.data.set(key, "other-tab-after-read");
  };
  assert.equal(await getValidAccessToken(config), null);
});

test("an unavailable localStorage object never creates a memory-only authenticated session", async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: tab } });
  assert.equal(await signInWithPassword(config, "synthetic@example.invalid", "Synthetic!Password42"), null);
  assert.equal(await getValidAccessToken(config), null);
});

for (const operation of ["login", "refresh"] as const) {
  test(`${operation}: a replacement written after the old write is preserved`, async () => {
    seed("A", true);
    let fired = false;
    tab.hooks.afterSet = key => {
      if (key !== config.sessionKey || fired) return;
      fired = true;
      const next = `replacement-${++serial}`;
      local.data.set(authGenerationKey(config.sessionKey), next);
      tab.data.set(config.sessionKey, JSON.stringify({ ...tokens("B"), generation: next }));
    };
    assert.equal(await run(operation), null);
    assert.equal(readBrowserAuthSession(config.sessionKey)?.user?.id, "B");
  });

  test(`${operation}: invalidation at the async result handoff returns no authentication`, async () => {
    seed("A", true);
    let queued = false;
    tab.hooks.afterSet = key => {
      if (key !== config.sessionKey || queued) return;
      queued = true;
      queueMicrotask(() => local.data.set(authGenerationKey(config.sessionKey), `handoff-${++serial}`));
    };
    assert.equal(await run(operation), null);
    assert.equal(readBrowserAuthSession(config.sessionKey), null);
  });
}

test("all callers of a shared refresh revalidate its result after logout", async () => {
  seed("A", true);
  let finish!: (response: Response) => void;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = getValidAccessToken(config), second = getValidAccessToken(config);
  tab.hooks.afterSet = () => queueMicrotask(() =>
    local.data.set(authGenerationKey(config.sessionKey), "other-tab-logout"));
  finish(Response.json(tokens()));
  assert.deepEqual(await Promise.all([first, second]), [null, null]);
  assert.equal(calls, 1);
});

for (const failure of ["http", "malformed", "network"] as const) {
  test(`refresh ${failure} failure removes only its local session without publishing a new generation`, async () => {
    seed("A", true);
    const before = local.data.get(authGenerationKey(config.sessionKey));
    let writes = 0;
    local.hooks.beforeSet = () => { writes++; };
    globalThis.fetch = async () => {
      if (failure === "network") throw new Error("Synthetic network failure");
      return Response.json({}, { status: failure === "http" ? 401 : 200 });
    };
    assert.equal(await getValidAccessToken(config), null);
    assert.equal(readBrowserAuthSession(config.sessionKey), null);
    assert.equal(writes, 0, "An async failure must never overwrite another tab's generation");
    assert.equal(local.data.get(authGenerationKey(config.sessionKey)), before);
  });
}

for (const area of ["local", "tab"] as const) {
  for (const fault of ["read", "write", "remove"] as const) {
    test(`${area}Storage ${fault} failure fails closed and permits fresh login after recovery`, async () => {
      seed("A", true);
      const store = area === "local" ? local : tab;
      store.faults[fault] = true;
      if (fault === "remove" && area === "local") {
        // Logout requires publication via setItem, not removal of the shared key.
        await signOutBrowserSession(config);
        assert.equal(readBrowserAuthSession(config.sessionKey), null);
      } else {
        assert.equal(await signInWithPassword(config, "synthetic@example.invalid", "Synthetic!Password42"), null);
        assert.equal(await getValidAccessToken(config), null);
      }
      store.faults[fault] = false;
      assert.equal((await signInWithPassword(config, "synthetic@example.invalid", "Synthetic!Password42"))?.user?.id, "A");
    });
  }
}

test("a pending refresh cannot survive a failed shared-generation logout write", async () => {
  seed("A", true);
  let finish!: (response: Response) => void;
  globalThis.fetch = async () => new Promise(resolve => { finish = resolve; });
  const pending = getValidAccessToken(config);
  local.faults.write = true;
  clearBrowserAuthSession(config.sessionKey);
  finish(Response.json(tokens()));
  assert.equal(await pending, null);
  assert.equal(readBrowserAuthSession(config.sessionKey), null);
});

test("normal login, fresh read, shared refresh, account switch and offline logout work", async () => {
  const signedIn = await signInWithPassword(config, "synthetic@example.invalid", "Synthetic!Password42");
  assert.ok(signedIn);
  assert.equal(await getValidAccessToken(config), signedIn.access_token);
  seed("A", true);
  let calls = 0;
  let owner = "A";
  globalThis.fetch = async () => { calls++; return Response.json(tokens(owner)); };
  const refreshed = await Promise.all([getValidAccessToken(config), getValidAccessToken(config)]);
  assert.equal(calls, 1);
  assert.ok(refreshed[0]); assert.equal(refreshed[0], refreshed[1]);
  owner = "B";
  assert.equal((await signInWithPassword(config, "synthetic@example.invalid", "Synthetic!Password42"))?.user?.id, "B");
  globalThis.fetch = async () => { throw new Error("Synthetic offline logout"); };
  await assert.doesNotReject(signOutBrowserSession(config));
  assert.equal(await getValidAccessToken(config), null);
});
