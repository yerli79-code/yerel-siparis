import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPanelPrintRunner,
  PANEL_PRINT_CLEANUP_FALLBACK_MS,
  type PanelPrintRuntime,
} from "./print-lifecycle";

type ListenerName = "afterprint" | "focus" | "printMedia" | "visibility";

class FakeAttributeRoot {
  private readonly attributes = new Map<string, string>();

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

class FakePanelPrintRuntime implements PanelPrintRuntime {
  readonly root = new FakeAttributeRoot();
  visibilityState: DocumentVisibilityState = "visible";
  printCalls = 0;
  printError: Error | null = null;
  requestFrameError: Error | null = null;
  timeoutDelay: number | null = null;
  timeoutWasCleared = false;
  canceledFrameIds: number[] = [];

  private readonly listeners = {
    afterprint: new Set<() => void>(),
    focus: new Set<() => void>(),
    printMedia: new Set<(matches: boolean) => void>(),
    visibility: new Set<() => void>(),
  };
  private readonly frames = new Map<number, () => void>();
  private nextFrameId = 1;
  private timeoutListener: (() => void) | null = null;

  print = () => {
    this.printCalls += 1;
    if (this.printError) throw this.printError;
  };

  requestFrame = (listener: () => void) => {
    if (this.requestFrameError) throw this.requestFrameError;

    const frameId = this.nextFrameId;
    this.nextFrameId += 1;
    this.frames.set(frameId, listener);
    return frameId;
  };

  cancelFrame = (frameId: number) => {
    this.canceledFrameIds.push(frameId);
    this.frames.delete(frameId);
  };

  getVisibilityState = () => this.visibilityState;

  subscribeAfterPrint = (listener: () => void) =>
    this.subscribe("afterprint", listener);

  subscribePrintMediaChange = (listener: (matches: boolean) => void) =>
    this.subscribe("printMedia", listener);

  subscribeVisibilityChange = (listener: () => void) =>
    this.subscribe("visibility", listener);

  subscribeFocus = (listener: () => void) =>
    this.subscribe("focus", listener);

  setCleanupTimeout = (listener: () => void, timeoutMs: number) => {
    this.timeoutListener = listener;
    this.timeoutDelay = timeoutMs;
    return 1;
  };

  clearCleanupTimeout = () => {
    this.timeoutWasCleared = true;
    this.timeoutListener = null;
  };

  runNextFrame() {
    const nextFrame = [...this.frames.entries()].sort(([a], [b]) => a - b)[0];
    assert.ok(nextFrame, "a pending animation frame was expected");
    const [frameId, listener] = nextFrame;
    this.frames.delete(frameId);
    listener();
  }

  runPreparationFrames() {
    this.runNextFrame();
    this.runNextFrame();
  }

  get pendingFrameCount() {
    return this.frames.size;
  }

  emitAfterPrint() {
    for (const listener of [...this.listeners.afterprint]) listener();
  }

  emitFocus() {
    for (const listener of [...this.listeners.focus]) listener();
  }

  emitPrintMedia(matches: boolean) {
    for (const listener of [...this.listeners.printMedia]) listener(matches);
  }

  emitVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;
    for (const listener of [...this.listeners.visibility]) listener();
  }

  emitTimeout() {
    this.timeoutListener?.();
  }

  countListeners(name: ListenerName) {
    return this.listeners[name].size;
  }

  private subscribe<T extends ListenerName>(
    name: T,
    listener: T extends "printMedia" ? (matches: boolean) => void : () => void,
  ) {
    const listeners = this.listeners[name] as Set<typeof listener>;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
}

function createTestRunner() {
  const runtime = new FakePanelPrintRuntime();
  return {
    runtime,
    runPanelPrint: createPanelPrintRunner(() => runtime),
  };
}

test("sets preparation, order target, and 58mm width before printing", () => {
  const { runtime, runPanelPrint } = createTestRunner();

  assert.equal(
    runPanelPrint({ target: "order-receipt", orderPaperWidth: "58mm" }),
    true,
  );
  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), "true");
  assert.equal(
    runtime.root.getAttribute("data-panel-print-target"),
    "order-receipt",
  );
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), "58mm");
  assert.equal(runtime.printCalls, 0);
});

test("waits for two animation frames before invoking print", () => {
  const { runtime, runPanelPrint } = createTestRunner();

  runPanelPrint({ target: "order-receipt", orderPaperWidth: "80mm" });
  assert.equal(runtime.pendingFrameCount, 1);
  assert.equal(runtime.printCalls, 0);

  runtime.runNextFrame();
  assert.equal(runtime.pendingFrameCount, 1);
  assert.equal(runtime.printCalls, 0);

  runtime.runNextFrame();
  assert.equal(runtime.pendingFrameCount, 0);
  assert.equal(runtime.printCalls, 1);
  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), "true");
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), "80mm");
});

test("sets QR preparation without leaking a stale order width", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runtime.root.setAttribute("data-panel-print-target", "order-receipt");
  runtime.root.setAttribute("data-order-print-paper-width", "58mm");

  runPanelPrint({ target: "customer-qr" });

  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), "true");
  assert.equal(runtime.root.getAttribute("data-panel-print-target"), "customer-qr");
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), null);
});

test("blocks duplicate print requests while a lifecycle is active", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "order-receipt", orderPaperWidth: "58mm" });

  assert.equal(runPanelPrint({ target: "customer-qr" }), false);
  assert.equal(
    runtime.root.getAttribute("data-panel-print-target"),
    "order-receipt",
  );
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), "58mm");
  assert.equal(runtime.pendingFrameCount, 1);
  assert.equal(runtime.countListeners("afterprint"), 1);
});

test("allows a new print after the previous lifecycle is cleaned", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "order-receipt", orderPaperWidth: "58mm" });
  runtime.emitAfterPrint();

  assert.equal(runPanelPrint({ target: "customer-qr" }), true);
  assert.equal(runtime.root.getAttribute("data-panel-print-target"), "customer-qr");
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), null);
  assert.equal(runtime.countListeners("afterprint"), 1);
});

test("cleans metadata and handles when frame scheduling fails", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runtime.requestFrameError = new Error("frame failed");

  assert.throws(
    () => runPanelPrint({ target: "order-receipt", orderPaperWidth: "80mm" }),
    /frame failed/,
  );
  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), null);
  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), null);
  assert.equal(runtime.countListeners("afterprint"), 0);
  assert.equal(runtime.timeoutWasCleared, true);
});

test("cleans metadata when print throws on the second frame", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runtime.printError = new Error("print failed");
  runPanelPrint({ target: "order-receipt", orderPaperWidth: "80mm" });
  runtime.runNextFrame();

  assert.throws(() => runtime.runNextFrame(), /print failed/);
  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), null);
  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), null);
  assert.equal(runtime.pendingFrameCount, 0);
});

test("afterprint cleans metadata, listeners, timeout, and a pending frame", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  runtime.emitAfterPrint();

  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), null);
  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
  assert.equal(runtime.countListeners("afterprint"), 0);
  assert.equal(runtime.countListeners("printMedia"), 0);
  assert.equal(runtime.countListeners("visibility"), 0);
  assert.equal(runtime.countListeners("focus"), 0);
  assert.equal(runtime.timeoutWasCleared, true);
  assert.equal(runtime.pendingFrameCount, 0);
  assert.deepEqual(runtime.canceledFrameIds, [1]);
});

test("cleanup cancels the second frame after the first frame has run", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });
  runtime.runNextFrame();

  runtime.emitAfterPrint();

  assert.equal(runtime.pendingFrameCount, 0);
  assert.deepEqual(runtime.canceledFrameIds, [2]);
  assert.equal(runtime.printCalls, 0);
});

test("keeps preparation metadata while entering print media", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  runtime.emitPrintMedia(true);

  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), "true");
  assert.equal(runtime.root.getAttribute("data-panel-print-target"), "customer-qr");
});

test("cleans metadata when leaving print media", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  runtime.emitPrintMedia(false);

  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), null);
  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
  assert.equal(runtime.pendingFrameCount, 0);
});

test("focus only cleans after the page has become hidden", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  runtime.emitFocus();
  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), "true");

  runtime.emitVisibility("hidden");
  runtime.visibilityState = "visible";
  runtime.emitFocus();
  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), null);
});

test("cleans on a hidden-to-visible visibility transition", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  runtime.emitVisibility("hidden");
  runtime.emitVisibility("visible");

  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), null);
  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
});

test("30-minute fallback cleans stale preparation state", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  assert.equal(runtime.timeoutDelay, PANEL_PRINT_CLEANUP_FALLBACK_MS);
  runtime.emitTimeout();

  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), null);
  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
  assert.equal(runtime.pendingFrameCount, 0);
});

test("metadata survives an immediately returning print until lifecycle cleanup", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "order-receipt", orderPaperWidth: "80mm" });

  runtime.runPreparationFrames();

  assert.equal(runtime.printCalls, 1);
  assert.equal(runtime.root.getAttribute("data-panel-print-preparing"), "true");
  assert.equal(
    runtime.root.getAttribute("data-panel-print-target"),
    "order-receipt",
  );
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), "80mm");
});
