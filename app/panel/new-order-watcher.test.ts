import assert from "node:assert/strict";
import { test } from "node:test";
import type { BusinessOrder } from "../../lib/supabase-orders";
import {
  beginNewOrderWatcherRequest,
  completeNewOrderPoll,
  createInitialNewOrderWatcherState,
  createNewOrderPollingController,
  createNewOrderPollSession,
  dismissPendingNewOrder,
  establishNewOrderBaseline,
  finishNewOrderWatcherRequest,
  getNewOrderRetryDelayMs,
  ingestNewOrderWatcherPage,
  mergePendingNewOrders,
  NEW_ORDER_POLL_INTERVAL_MS,
  NEW_ORDER_WATCHER_MAX_PAGES,
  NEW_ORDER_WATCHER_PAGE_SIZE,
  recordNewOrderWatcherFailure,
  type NewOrderPollingRuntime,
} from "./new-order-watcher";

function order(
  id: string,
  createdAt: string,
  orderNumber = Number(id.replace(/\D/g, "")) || 1,
): BusinessOrder {
  return {
    id,
    orderNumber,
    status: "new",
    orderType: "delivery",
    paymentMethod: "cash",
    customerName: `Müşteri ${id}`,
    customerPhone: "05550000000",
    customerAddress: "Test adresi",
    customerNote: null,
    totalAmount: 100,
    currency: "TRY",
    createdAt,
    updatedAt: createdAt,
    items: [],
  };
}

function baseline() {
  return establishNewOrderBaseline(createInitialNewOrderWatcherState(), [
    order("known", "2026-08-10T10:00:00.000Z", 10),
  ]).state;
}

function pageOrders(prefix: string, startMinute: number, count = 10) {
  return Array.from({ length: count }, (_, index) =>
    order(
      `${prefix}-${index}`,
      `2026-08-10T10:${String(startMinute - index).padStart(2, "0")}:00.000Z`,
      100 + index,
    ),
  );
}

test("ilk başarılı fetch baseline kurar ve bildirim üretmez", () => {
  const result = establishNewOrderBaseline(createInitialNewOrderWatcherState(), [
    order("a", "2026-08-10T10:00:00.000Z"),
  ]);
  assert.equal(result.state.baselineEstablished, true);
  assert.deepEqual(result.newOrders, []);
});

test("baseline sipariş ID'lerini seen kümesine ekler", () => {
  const result = establishNewOrderBaseline(createInitialNewOrderWatcherState(), [
    order("a", "2026-08-10T10:00:00.000Z"),
    order("b", "2026-08-10T09:59:00.000Z"),
  ]);
  assert.deepEqual([...result.state.seenOrderIds].sort(), ["a", "b"]);
});

test("baseline en yeni createdAt değerini watermark yapar", () => {
  assert.equal(baseline().latestCreatedAt, "2026-08-10T10:00:00.000Z");
});

test("watermark sonrasındaki yeni ID bildirim üretir", () => {
  const state = baseline();
  const ingested = ingestNewOrderWatcherPage(createNewOrderPollSession(state), {
    orders: [order("new", "2026-08-10T10:01:00.000Z")],
    pagination: { page: 1, hasNextPage: false },
  });
  assert.deepEqual(completeNewOrderPoll(state, ingested.session).newOrders.map(({ id }) => id), ["new"]);
});

test("aynı ID tekrar geldiğinde duplicate bildirim üretmez", () => {
  const state = { ...baseline(), seenOrderIds: new Set(["known", "new"]) };
  const ingested = ingestNewOrderWatcherPage(createNewOrderPollSession(state), {
    orders: [order("new", "2026-08-10T10:01:00.000Z")],
    pagination: { page: 1, hasNextPage: false },
  });
  assert.deepEqual(completeNewOrderPoll(state, ingested.session).newOrders, []);
});

test("dedupe orderNumber yerine order.id kullanır", () => {
  const state = baseline();
  const ingested = ingestNewOrderWatcherPage(createNewOrderPollSession(state), {
    orders: [order("different-id", "2026-08-10T10:01:00.000Z", 10)],
    pagination: { page: 1, hasNextPage: false },
  });
  assert.equal(completeNewOrderPoll(state, ingested.session).newOrders.length, 1);
});

test("bir batch içindeki birden fazla yeni siparişi toplar", () => {
  const state = baseline();
  const ingested = ingestNewOrderWatcherPage(createNewOrderPollSession(state), {
    orders: [
      order("one", "2026-08-10T10:01:00.000Z"),
      order("two", "2026-08-10T10:02:00.000Z"),
    ],
    pagination: { page: 1, hasNextPage: false },
  });
  assert.equal(completeNewOrderPoll(state, ingested.session).newOrders.length, 2);
});

test("yeni siparişleri newest-first sıralar", () => {
  const state = baseline();
  const ingested = ingestNewOrderWatcherPage(createNewOrderPollSession(state), {
    orders: [
      order("older", "2026-08-10T10:01:00.000Z"),
      order("newer", "2026-08-10T10:02:00.000Z"),
    ],
    pagination: { page: 1, hasNextPage: false },
  });
  assert.deepEqual(completeNewOrderPoll(state, ingested.session).newOrders.map(({ id }) => id), ["newer", "older"]);
});

test("tamamen yeni dolu page 1 için catch-up page 2 ister", () => {
  const ingested = ingestNewOrderWatcherPage(createNewOrderPollSession(baseline()), {
    orders: pageOrders("p1", 20),
    pagination: { page: 1, hasNextPage: true },
  });
  assert.equal(ingested.shouldFetchNextPage, true);
});

test("bilinen ID'ye ulaşınca catch-up durur ama önündeki yenileri toplar", () => {
  const state = baseline();
  const ingested = ingestNewOrderWatcherPage(createNewOrderPollSession(state), {
    orders: [order("new", "2026-08-10T10:01:00.000Z"), order("known", "2026-08-10T10:00:00.000Z")],
    pagination: { page: 1, hasNextPage: true },
  });
  assert.equal(ingested.shouldFetchNextPage, false);
  assert.deepEqual(completeNewOrderPoll(state, ingested.session).newOrders.map(({ id }) => id), ["new"]);
});

test("catch-up üst sınırında sonraki sayfayı istemez", () => {
  const ingested = ingestNewOrderWatcherPage(createNewOrderPollSession(baseline()), {
    orders: pageOrders("last", 20),
    pagination: { page: NEW_ORDER_WATCHER_MAX_PAGES, hasNextPage: true },
  });
  assert.equal(ingested.shouldFetchNextPage, false);
});

test("eksik dolu sayfada catch-up yapmaz", () => {
  const ingested = ingestNewOrderWatcherPage(createNewOrderPollSession(baseline()), {
    orders: pageOrders("short", 20, NEW_ORDER_WATCHER_PAGE_SIZE - 1),
    pagination: { page: 1, hasNextPage: true },
  });
  assert.equal(ingested.shouldFetchNextPage, false);
});

test("sayfalar arasında aynı ID'yi batch'e iki kez eklemez", () => {
  const state = baseline();
  const first = ingestNewOrderWatcherPage(createNewOrderPollSession(state), {
    orders: [order("new", "2026-08-10T10:01:00.000Z")],
    pagination: { page: 1, hasNextPage: true },
  });
  const second = ingestNewOrderWatcherPage(first.session, {
    orders: [order("new", "2026-08-10T10:01:00.000Z")],
    pagination: { page: 2, hasNextPage: false },
  });
  assert.equal(completeNewOrderPoll(state, second.session).newOrders.length, 1);
});

test("watermark öncesindeki görülmemiş kayıt alarm üretmez", () => {
  const state = baseline();
  const ingested = ingestNewOrderWatcherPage(createNewOrderPollSession(state), {
    orders: [order("old-unseen", "2026-08-10T09:00:00.000Z")],
    pagination: { page: 1, hasNextPage: false },
  });
  assert.deepEqual(completeNewOrderPoll(state, ingested.session).newOrders, []);
});

test("network failure seen ve pending state'ini bozmaz", () => {
  const state = { ...baseline(), pendingNewOrders: [order("pending", "2026-08-10T10:01:00.000Z")] };
  const failed = recordNewOrderWatcherFailure(state);
  assert.deepEqual([...failed.seenOrderIds], [...state.seenOrderIds]);
  assert.equal(failed.pendingNewOrders, state.pendingNewOrders);
});

test("failure counter artar", () => {
  assert.equal(recordNewOrderWatcherFailure(recordNewOrderWatcherFailure(baseline())).consecutiveFailures, 2);
});

test("success failure counter ve backoff'u 20 saniyeye resetler", () => {
  const state = { ...baseline(), consecutiveFailures: 4 };
  const completed = completeNewOrderPoll(state, createNewOrderPollSession(state)).state;
  assert.equal(completed.consecutiveFailures, 0);
  assert.equal(getNewOrderRetryDelayMs(completed.consecutiveFailures), NEW_ORDER_POLL_INTERVAL_MS);
});

test("backoff 20, 40, 80, 160 ve capped 300 saniyedir", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 8].map(getNewOrderRetryDelayMs), [20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
});

test("inFlight duplicate guard ikinci isteği reddeder", () => {
  const first = beginNewOrderWatcherRequest(baseline());
  const second = beginNewOrderWatcherRequest(first.state);
  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(finishNewOrderWatcherRequest(first.state).inFlight, false);
});

test("pending queue yeni batch'i newest-first ve dedupe ederek ekler", () => {
  const pending = order("pending", "2026-08-10T10:01:00.000Z");
  const result = mergePendingNewOrders([pending], [pending, order("new", "2026-08-10T10:02:00.000Z")]);
  assert.deepEqual(result.map(({ id }) => id), ["new", "pending"]);
});

test("dismiss sonrasında sıradaki sipariş aktif kalır", () => {
  const state = { ...baseline(), pendingNewOrders: [order("one", "2026-08-10T10:02:00.000Z"), order("two", "2026-08-10T10:01:00.000Z")] };
  assert.equal(dismissPendingNewOrder(state, "one").pendingNewOrders[0]?.id, "two");
});

class FakePollingRuntime implements NewOrderPollingRuntime {
  visible = true;
  online = true;
  timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = [];
  isVisible = () => this.visible;
  isOnline = () => this.online;
  setTimeout = (callback: () => void, delay: number) => {
    const timer = { callback, delay, cleared: false };
    this.timers.push(timer);
    return timer;
  };
  clearTimeout = (timer: unknown) => {
    (timer as { cleared: boolean }).cleared = true;
  };
  activeTimers() {
    return this.timers.filter((timer) => !timer.cleared);
  }
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

test("hidden başlangıçta fetch planlanmaz, visible dönüşte immediate check olur", async () => {
  const runtime = new FakePollingRuntime();
  runtime.visible = false;
  let checks = 0;
  const controller = createNewOrderPollingController({ runtime, runCheck: async () => { checks += 1; return "success"; } });
  controller.start();
  assert.equal(checks, 0);
  assert.equal(runtime.activeTimers().length, 0);
  runtime.visible = true;
  controller.handleVisibilityChange();
  await flushAsync();
  assert.equal(checks, 1);
});

test("online dönüş visible tab'de immediate check yapar", async () => {
  const runtime = new FakePollingRuntime();
  runtime.online = false;
  let checks = 0;
  const controller = createNewOrderPollingController({ runtime, runCheck: async () => { checks += 1; return "success"; } });
  controller.start();
  runtime.online = true;
  controller.handleOnline();
  await flushAsync();
  assert.equal(checks, 1);
});

test("scheduler inFlight sırasında overlap üretmez", async () => {
  const runtime = new FakePollingRuntime();
  let resolveCheck: ((value: "success") => void) | undefined;
  let checks = 0;
  const controller = createNewOrderPollingController({
    runtime,
    runCheck: () => {
      checks += 1;
      return new Promise((resolve) => { resolveCheck = resolve; });
    },
  });
  controller.start();
  await controller.checkNow();
  assert.equal(checks, 1);
  resolveCheck?.("success");
  await flushAsync();
  assert.equal(checks, 2);
});

test("scheduler cleanup timer'ı temizler ve stale completion planlamaz", async () => {
  const runtime = new FakePollingRuntime();
  const controller = createNewOrderPollingController({ runtime, runCheck: async () => "success" });
  controller.start();
  await flushAsync();
  assert.equal(runtime.activeTimers().length, 1);
  controller.cleanup();
  assert.equal(runtime.activeTimers().length, 0);
  assert.equal(controller.getSnapshot().disposed, true);
});
