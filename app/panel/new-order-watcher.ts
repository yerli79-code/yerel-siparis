import type {
  BusinessOrder,
  BusinessOrderPagination,
} from "../../lib/supabase-orders";

export const NEW_ORDER_POLL_INTERVAL_MS = 20_000;
export const NEW_ORDER_WATCHER_PAGE_SIZE = 10;
export const NEW_ORDER_WATCHER_MAX_PAGES = 5;
export const NEW_ORDER_RETRY_DELAYS_MS = [
  20_000,
  40_000,
  80_000,
  160_000,
  300_000,
] as const;

export type NewOrderWatcherState = {
  baselineEstablished: boolean;
  seenOrderIds: Set<string>;
  pendingNewOrders: BusinessOrder[];
  latestCreatedAt: string | null;
  consecutiveFailures: number;
  inFlight: boolean;
  initialized: boolean;
};

export type NewOrderPollSession = {
  knownOrderIds: Set<string>;
  boundaryCreatedAt: string | null;
  fetchedOrdersById: Map<string, BusinessOrder>;
  newOrdersById: Map<string, BusinessOrder>;
};

export type WatcherPage = {
  orders: BusinessOrder[];
  pagination: Pick<BusinessOrderPagination, "page" | "hasNextPage">;
};

function createdAtTime(order: BusinessOrder) {
  const value = new Date(order.createdAt).getTime();
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

export function sortOrdersNewestFirst(orders: BusinessOrder[]) {
  return [...orders].sort((first, second) => {
    const timeDifference = createdAtTime(second) - createdAtTime(first);
    if (timeDifference !== 0) return timeDifference;
    return second.id.localeCompare(first.id);
  });
}

function latestCreatedAt(
  current: string | null,
  orders: Iterable<BusinessOrder>,
) {
  let latest = current;
  let latestTime = latest ? new Date(latest).getTime() : Number.NEGATIVE_INFINITY;

  for (const order of orders) {
    const orderTime = createdAtTime(order);
    if (orderTime > latestTime) {
      latest = order.createdAt;
      latestTime = orderTime;
    }
  }

  return latest;
}

function isAfterBoundary(order: BusinessOrder, boundary: string | null) {
  if (!boundary) return true;
  const boundaryTime = new Date(boundary).getTime();
  return Number.isFinite(boundaryTime) && createdAtTime(order) > boundaryTime;
}

export function createInitialNewOrderWatcherState(): NewOrderWatcherState {
  return {
    baselineEstablished: false,
    seenOrderIds: new Set(),
    pendingNewOrders: [],
    latestCreatedAt: null,
    consecutiveFailures: 0,
    inFlight: false,
    initialized: false,
  };
}

export function establishNewOrderBaseline(
  state: NewOrderWatcherState,
  orders: BusinessOrder[],
) {
  return {
    state: {
      ...state,
      baselineEstablished: true,
      initialized: true,
      seenOrderIds: new Set([
        ...state.seenOrderIds,
        ...orders.map((order) => order.id),
      ]),
      latestCreatedAt: latestCreatedAt(state.latestCreatedAt, orders),
      consecutiveFailures: 0,
    },
    newOrders: [] as BusinessOrder[],
  };
}

export function createNewOrderPollSession(
  state: NewOrderWatcherState,
): NewOrderPollSession {
  return {
    knownOrderIds: new Set(state.seenOrderIds),
    boundaryCreatedAt: state.latestCreatedAt,
    fetchedOrdersById: new Map(),
    newOrdersById: new Map(),
  };
}

export function ingestNewOrderWatcherPage(
  session: NewOrderPollSession,
  page: WatcherPage,
  maxPages = NEW_ORDER_WATCHER_MAX_PAGES,
) {
  const fetchedOrdersById = new Map(session.fetchedOrdersById);
  const newOrdersById = new Map(session.newOrdersById);

  for (const order of page.orders) {
    if (!fetchedOrdersById.has(order.id)) fetchedOrdersById.set(order.id, order);
    if (
      !session.knownOrderIds.has(order.id) &&
      !newOrdersById.has(order.id) &&
      isAfterBoundary(order, session.boundaryCreatedAt)
    ) {
      newOrdersById.set(order.id, order);
    }
  }

  const everyOrderIsBeyondBoundary =
    page.orders.length === NEW_ORDER_WATCHER_PAGE_SIZE &&
    page.orders.every(
      (order) =>
        !session.knownOrderIds.has(order.id) &&
        !session.fetchedOrdersById.has(order.id) &&
        isAfterBoundary(order, session.boundaryCreatedAt),
    );
  const shouldFetchNextPage =
    page.pagination.hasNextPage &&
    page.pagination.page < maxPages &&
    everyOrderIsBeyondBoundary;

  return {
    session: { ...session, fetchedOrdersById, newOrdersById },
    shouldFetchNextPage,
  };
}

export function mergePendingNewOrders(
  current: BusinessOrder[],
  incoming: BusinessOrder[],
) {
  const byId = new Map(current.map((order) => [order.id, order]));
  for (const order of incoming) {
    if (!byId.has(order.id)) byId.set(order.id, order);
  }
  return sortOrdersNewestFirst([...byId.values()]);
}

export function completeNewOrderPoll(
  state: NewOrderWatcherState,
  session: NewOrderPollSession,
) {
  const fetchedOrders = [...session.fetchedOrdersById.values()];
  const newOrders = sortOrdersNewestFirst([...session.newOrdersById.values()]);
  return {
    state: {
      ...state,
      seenOrderIds: new Set([
        ...state.seenOrderIds,
        ...session.fetchedOrdersById.keys(),
      ]),
      pendingNewOrders: mergePendingNewOrders(
        state.pendingNewOrders,
        newOrders,
      ),
      latestCreatedAt: latestCreatedAt(state.latestCreatedAt, fetchedOrders),
      consecutiveFailures: 0,
    },
    newOrders,
  };
}

export function dismissPendingNewOrder(
  state: NewOrderWatcherState,
  orderId: string,
) {
  return {
    ...state,
    pendingNewOrders: state.pendingNewOrders.filter(
      (order) => order.id !== orderId,
    ),
  };
}

export function recordNewOrderWatcherFailure(state: NewOrderWatcherState) {
  return {
    ...state,
    consecutiveFailures: state.consecutiveFailures + 1,
  };
}

export function beginNewOrderWatcherRequest(state: NewOrderWatcherState) {
  if (state.inFlight) return { started: false, state };
  return { started: true, state: { ...state, inFlight: true } };
}

export function finishNewOrderWatcherRequest(state: NewOrderWatcherState) {
  return { ...state, inFlight: false };
}

export function getNewOrderRetryDelayMs(consecutiveFailures: number) {
  if (consecutiveFailures <= 0) return NEW_ORDER_POLL_INTERVAL_MS;
  return NEW_ORDER_RETRY_DELAYS_MS[
    Math.min(consecutiveFailures - 1, NEW_ORDER_RETRY_DELAYS_MS.length - 1)
  ];
}

export type NewOrderPollingCheckResult = "success" | "failure" | "stop";

export type NewOrderPollingRuntime = {
  isVisible: () => boolean;
  isOnline: () => boolean;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};

type NewOrderPollingControllerOptions = {
  runtime: NewOrderPollingRuntime;
  runCheck: () => Promise<NewOrderPollingCheckResult>;
  onFailureCountChange?: (failureCount: number) => void;
};

export function createNewOrderPollingController({
  runtime,
  runCheck,
  onFailureCountChange = () => undefined,
}: NewOrderPollingControllerOptions) {
  let initialized = false;
  let disposed = false;
  let inFlight = false;
  let consecutiveFailures = 0;
  let timer: unknown = null;
  let immediateCheckRequested = false;

  const clearTimer = () => {
    if (timer === null) return;
    runtime.clearTimeout(timer);
    timer = null;
  };

  const canCheck = () =>
    !disposed && runtime.isVisible() && runtime.isOnline();

  const schedule = () => {
    clearTimer();
    if (!canCheck()) return;
    timer = runtime.setTimeout(() => {
      timer = null;
      void checkNow();
    }, getNewOrderRetryDelayMs(consecutiveFailures));
  };

  const checkNow = async () => {
    clearTimer();
    if (!canCheck()) return false;
    if (inFlight) {
      immediateCheckRequested = true;
      return false;
    }

    inFlight = true;
    let result: NewOrderPollingCheckResult = "failure";
    try {
      result = await runCheck();
    } catch {
      result = "failure";
    } finally {
      inFlight = false;
    }

    if (disposed || result === "stop") return true;
    consecutiveFailures = result === "success" ? 0 : consecutiveFailures + 1;
    onFailureCountChange(consecutiveFailures);

    if (immediateCheckRequested && canCheck()) {
      immediateCheckRequested = false;
      void checkNow();
    } else {
      immediateCheckRequested = false;
      schedule();
    }
    return true;
  };

  return {
    start() {
      if (initialized || disposed) return;
      initialized = true;
      if (canCheck()) void checkNow();
    },
    handleVisibilityChange() {
      if (!runtime.isVisible()) {
        clearTimer();
        immediateCheckRequested = false;
        return;
      }
      if (runtime.isOnline()) void checkNow();
    },
    handleOnline() {
      if (runtime.isVisible() && runtime.isOnline()) void checkNow();
    },
    cleanup() {
      disposed = true;
      immediateCheckRequested = false;
      clearTimer();
    },
    checkNow,
    getSnapshot() {
      return {
        initialized,
        disposed,
        inFlight,
        consecutiveFailures,
        hasTimer: timer !== null,
      };
    },
  };
}
