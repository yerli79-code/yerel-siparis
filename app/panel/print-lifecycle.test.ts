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
  timeoutDelay: number | null = null;
  timeoutWasCleared = false;

  private readonly listeners = {
    afterprint: new Set<() => void>(),
    focus: new Set<() => void>(),
    printMedia: new Set<(matches: boolean) => void>(),
    visibility: new Set<() => void>(),
  };
  private timeoutListener: (() => void) | null = null;

  print = () => {
    this.printCalls += 1;
    if (this.printError) throw this.printError;
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

test("sipariş yazdırma hedefini ve kağıt genişliğini ekler", () => {
  const { runtime, runPanelPrint } = createTestRunner();

  runPanelPrint({ target: "order-receipt", orderPaperWidth: "58mm" });

  assert.equal(
    runtime.root.getAttribute("data-panel-print-target"),
    "order-receipt",
  );
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), "58mm");
});

test("print hemen dönse bile metadata'yı korur", () => {
  const { runtime, runPanelPrint } = createTestRunner();

  runPanelPrint({ target: "order-receipt", orderPaperWidth: "80mm" });

  assert.equal(runtime.printCalls, 1);
  assert.equal(
    runtime.root.getAttribute("data-panel-print-target"),
    "order-receipt",
  );
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), "80mm");
});

test("senkron print hatasında metadata'yı temizler", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runtime.printError = new Error("print failed");

  assert.throws(
    () => runPanelPrint({ target: "order-receipt", orderPaperWidth: "80mm" }),
    /print failed/,
  );
  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), null);
});

test("afterprint sonrasında metadata'yı temizler", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  runtime.emitAfterPrint();

  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
});

test("print media girişinde metadata'yı korur", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  runtime.emitPrintMedia(true);

  assert.equal(
    runtime.root.getAttribute("data-panel-print-target"),
    "customer-qr",
  );
});

test("print media çıkışında metadata'yı temizler", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  runtime.emitPrintMedia(false);

  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
});

test("cleanup bütün listener'ları ve timeout'u kaldırır", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  runtime.emitAfterPrint();

  assert.equal(runtime.countListeners("afterprint"), 0);
  assert.equal(runtime.countListeners("printMedia"), 0);
  assert.equal(runtime.countListeners("visibility"), 0);
  assert.equal(runtime.countListeners("focus"), 0);
  assert.equal(runtime.timeoutWasCleared, true);
});

test("ikinci print eski lifecycle'ı temizleyip yeni modu kurar", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "order-receipt", orderPaperWidth: "58mm" });

  runPanelPrint({ target: "customer-qr" });

  assert.equal(
    runtime.root.getAttribute("data-panel-print-target"),
    "customer-qr",
  );
  assert.equal(runtime.root.getAttribute("data-order-print-paper-width"), null);
  assert.equal(runtime.countListeners("afterprint"), 1);
});

test("focus ancak sayfa gizlenip görünür olduktan sonra cleanup yapar", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  runtime.emitFocus();
  assert.equal(
    runtime.root.getAttribute("data-panel-print-target"),
    "customer-qr",
  );

  runtime.emitVisibility("hidden");
  runtime.visibilityState = "visible";
  runtime.emitFocus();
  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
});

test("gizlilik hidden-visible dönüşünde cleanup yapar", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  runtime.emitVisibility("hidden");
  runtime.emitVisibility("visible");

  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
});

test("30 dakikalık güvenlik fallback'i stale metadata'yı temizler", () => {
  const { runtime, runPanelPrint } = createTestRunner();
  runPanelPrint({ target: "customer-qr" });

  assert.equal(runtime.timeoutDelay, PANEL_PRINT_CLEANUP_FALLBACK_MS);
  runtime.emitTimeout();

  assert.equal(runtime.root.getAttribute("data-panel-print-target"), null);
});
