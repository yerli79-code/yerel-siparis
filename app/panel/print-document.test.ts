import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import type { OrderPrintReceiptModel } from "./order-print";
import {
  createPrintDocumentOpener,
  isOrderPrintReceiptModel,
  isPrintDocumentPayload,
  isPrintDocumentReadyMessage,
  PRINT_DOCUMENT_HANDSHAKE_TIMEOUT_MS,
  PRINT_DOCUMENT_PATH,
  PRINT_DOCUMENT_READY_MESSAGE,
  PRINT_DOCUMENT_WINDOW_FEATURES,
  PRINT_DOCUMENT_WINDOW_NAME,
  type CustomerQrPrintDocumentPayload,
  type OrderReceiptPrintDocumentPayload,
  type PrintDocumentMessageEvent,
  type PrintDocumentOpenerRuntime,
  type PrintDocumentPayload,
  type PrintDocumentWindow,
} from "./print-document";

type PostedMessage = {
  message: unknown;
  targetOrigin: string;
};

class FakePrintDocumentWindow implements PrintDocumentWindow {
  closed = false;
  closeCalls = 0;
  postMessageError: Error | null = null;
  readonly postedMessages: PostedMessage[] = [];

  close = () => {
    this.closeCalls += 1;
    this.closed = true;
  };

  postMessage = (message: unknown, targetOrigin: string) => {
    if (this.postMessageError) throw this.postMessageError;
    this.postedMessages.push({ message, targetOrigin });
  };
}

class FakePrintDocumentRuntime implements PrintDocumentOpenerRuntime {
  readonly origin = "https://panel.example.test";
  readonly openCalls: Array<{
    url: string;
    target: string;
    features: string;
  }> = [];
  readonly clearedTimeoutIds: number[] = [];
  readonly callOrder: string[] = [];
  blockPopup = false;
  openError: Error | null = null;
  subscribeError: Error | null = null;
  timeoutError: Error | null = null;
  lastPopup: FakePrintDocumentWindow | null = null;

  private readonly listeners = new Set<
    (event: PrintDocumentMessageEvent) => void
  >();
  private readonly timeoutListeners = new Map<number, () => void>();
  private nextTimeoutId = 1;

  open = (url: string, target: string, features: string) => {
    this.callOrder.push("open");
    this.openCalls.push({ url, target, features });
    if (this.openError) throw this.openError;
    if (this.blockPopup) return null;

    const popup = new FakePrintDocumentWindow();
    this.lastPopup = popup;
    return popup;
  };

  subscribeMessage = (
    listener: (event: PrintDocumentMessageEvent) => void,
  ) => {
    this.callOrder.push("subscribe");
    if (this.subscribeError) throw this.subscribeError;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setHandshakeTimeout = (listener: () => void, timeoutMs: number) => {
    this.callOrder.push(`timeout:${timeoutMs}`);
    if (this.timeoutError) throw this.timeoutError;

    const timeoutId = this.nextTimeoutId;
    this.nextTimeoutId += 1;
    this.timeoutListeners.set(timeoutId, listener);
    return timeoutId;
  };

  clearHandshakeTimeout = (timeoutId: number) => {
    this.clearedTimeoutIds.push(timeoutId);
    this.timeoutListeners.delete(timeoutId);
  };

  emitMessage({
    data = PRINT_DOCUMENT_READY_MESSAGE,
    origin = this.origin,
    source = this.lastPopup,
  }: Partial<PrintDocumentMessageEvent> = {}) {
    for (const listener of [...this.listeners]) {
      listener({ data, origin, source });
    }
  }

  runTimeout(timeoutId = 1) {
    const listener = this.timeoutListeners.get(timeoutId);
    assert.ok(listener, `timeout ${timeoutId} was expected to be pending`);
    listener();
  }

  get listenerCount() {
    return this.listeners.size;
  }

  get timeoutCount() {
    return this.timeoutListeners.size;
  }
}

function receipt(paperWidth: "58mm" | "80mm"): OrderPrintReceiptModel {
  return {
    businessName: "İstanbul Sofrası",
    businessAddress: "Moda Caddesi No: 12/A",
    businessWhatsapp: "905551112233",
    orderNumber: 123,
    formattedCreatedAt: "10.08.2026 14:30",
    statusLabel: "Hazırlanıyor",
    orderTypeLabel: "Teslimat",
    paymentMethodLabel: "Kart (fiziksel POS)",
    customerName: "Çağla Şen",
    customerPhone: "0555 444 33 22",
    customerAddressOrPickupMessage: "Rasimpaşa Mahallesi No: 8",
    customerNote: "Soğansız olsun.",
    items: [
      {
        productName: "Adana Dürüm",
        quantity: 2,
        unitPrice: 225,
        lineTotal: 450,
        formattedUnitPrice: "225,00 TRY",
        formattedLineTotal: "450,00 TRY",
      },
    ],
    totalAmount: 450,
    formattedTotal: "450,00 TRY",
    paperWidth,
  };
}

function orderPayload(
  paperWidth: "58mm" | "80mm" = "80mm",
): OrderReceiptPrintDocumentPayload {
  return {
    type: "order-receipt",
    receipt: receipt(paperWidth),
  };
}

function qrPayload(): CustomerQrPrintDocumentPayload {
  return {
    type: "customer-qr",
    businessName: "İstanbul Sofrası",
    orderUrl: "https://orders.example.test/istanbul-sofrasi",
    qrDataUrl: "data:image/png;base64,AAAA",
  };
}

function createTestOpener(runtime = new FakePrintDocumentRuntime()) {
  return {
    runtime,
    openPrintDocument: createPrintDocumentOpener(() => runtime),
  };
}

function requirePopup(runtime: FakePrintDocumentRuntime) {
  assert.ok(runtime.lastPopup, "an opened print window was expected");
  return runtime.lastPopup;
}

test("opens the same-origin print-only route synchronously in a named popup", () => {
  const { runtime, openPrintDocument } = createTestOpener();

  assert.equal(openPrintDocument(orderPayload()), "opened");
  assert.deepEqual(runtime.openCalls, [
    {
      url: PRINT_DOCUMENT_PATH,
      target: PRINT_DOCUMENT_WINDOW_NAME,
      features: PRINT_DOCUMENT_WINDOW_FEATURES,
    },
  ]);
  assert.equal(new URL(runtime.openCalls[0].url, runtime.origin).origin, runtime.origin);
  assert.deepEqual(runtime.callOrder, [
    "open",
    "subscribe",
    `timeout:${PRINT_DOCUMENT_HANDSHAKE_TIMEOUT_MS}`,
  ]);
});

test("returns blocked when the browser rejects the popup", () => {
  const runtime = new FakePrintDocumentRuntime();
  runtime.blockPopup = true;
  const { openPrintDocument } = createTestOpener(runtime);

  assert.equal(openPrintDocument(orderPayload()), "blocked");
  assert.equal(runtime.listenerCount, 0);
  assert.equal(runtime.timeoutCount, 0);
});

test("returns blocked deterministically when window.open throws", () => {
  const runtime = new FakePrintDocumentRuntime();
  runtime.openError = new Error("popup failed");
  const { openPrintDocument } = createTestOpener(runtime);

  assert.equal(openPrintDocument(orderPayload()), "blocked");
});

test("does not send the payload before the child sends READY", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  openPrintDocument(orderPayload());

  assert.deepEqual(requirePopup(runtime).postedMessages, []);
});

test("ignores READY from a different origin", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  openPrintDocument(orderPayload());

  runtime.emitMessage({ origin: "https://attacker.example" });

  assert.deepEqual(requirePopup(runtime).postedMessages, []);
  assert.equal(runtime.listenerCount, 1);
});

test("ignores READY from a different source window", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  openPrintDocument(orderPayload());

  runtime.emitMessage({ source: new FakePrintDocumentWindow() });

  assert.deepEqual(requirePopup(runtime).postedMessages, []);
  assert.equal(runtime.listenerCount, 1);
});

test("ignores a malformed READY message", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  openPrintDocument(orderPayload());

  runtime.emitMessage({ data: { type: "print-document-ready", extra: true } });

  assert.deepEqual(requirePopup(runtime).postedMessages, []);
  assert.equal(runtime.listenerCount, 1);
});

test("posts the raw payload only after exact origin, source, and READY match", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  const payload = orderPayload();
  openPrintDocument(payload);

  runtime.emitMessage();

  assert.deepEqual(requirePopup(runtime).postedMessages, [
    { message: payload, targetOrigin: runtime.origin },
  ]);
});

test("uses window.location.origin as the exact postMessage targetOrigin", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  openPrintDocument(qrPayload());
  runtime.emitMessage();

  const [{ targetOrigin }] = requirePopup(runtime).postedMessages;
  assert.equal(targetOrigin, runtime.origin);
  assert.notEqual(targetOrigin, "*");
});

test("never puts order PII or payload data in the popup URL", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  const payload = orderPayload();
  openPrintDocument(payload);

  const [{ url }] = runtime.openCalls;
  assert.equal(url, "/panel/yazdir");
  assert.equal(url.includes("?"), false);
  assert.equal(url.includes("#"), false);
  assert.equal(url.includes(payload.receipt.customerName), false);
  assert.equal(url.includes(payload.receipt.customerPhone), false);
});

test("contains no localStorage or sessionStorage transport", () => {
  const source = readFileSync(
    resolve(process.cwd(), "app/panel/print-document.ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /\blocalStorage\b/);
  assert.doesNotMatch(source, /\bsessionStorage\b/);
});

test("removes the message listener after a valid READY handshake", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  openPrintDocument(orderPayload());
  assert.equal(runtime.listenerCount, 1);

  runtime.emitMessage();

  assert.equal(runtime.listenerCount, 0);
});

test("clears the handshake timer after a valid READY handshake", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  openPrintDocument(orderPayload());
  assert.equal(runtime.timeoutCount, 1);

  runtime.emitMessage();

  assert.equal(runtime.timeoutCount, 0);
  assert.deepEqual(runtime.clearedTimeoutIds, [1]);
});

test("uses a 10-second handshake timeout", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  openPrintDocument(orderPayload());

  assert.equal(PRINT_DOCUMENT_HANDSHAKE_TIMEOUT_MS, 10_000);
  assert.ok(runtime.callOrder.includes("timeout:10000"));
});

test("timeout removes the listener, clears the timer, and closes the popup", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  openPrintDocument(orderPayload());
  const popup = requirePopup(runtime);

  runtime.runTimeout();

  assert.equal(runtime.listenerCount, 0);
  assert.equal(runtime.timeoutCount, 0);
  assert.deepEqual(runtime.clearedTimeoutIds, [1]);
  assert.equal(popup.closeCalls, 1);
  assert.equal(popup.closed, true);
});

test("rejects a duplicate request while the active print window is open", () => {
  const { runtime, openPrintDocument } = createTestOpener();

  assert.equal(openPrintDocument(orderPayload()), "opened");
  assert.equal(openPrintDocument(qrPayload()), "busy");
  assert.equal(runtime.openCalls.length, 1);
  assert.equal(runtime.listenerCount, 1);
  assert.equal(runtime.timeoutCount, 1);
});

test("keeps the duplicate guard after READY until the popup closes", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  openPrintDocument(orderPayload());
  runtime.emitMessage();

  assert.equal(openPrintDocument(qrPayload()), "busy");
  assert.equal(runtime.openCalls.length, 1);
});

test("allows a new print after the previous popup closes", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  openPrintDocument(orderPayload());
  const firstPopup = requirePopup(runtime);
  firstPopup.close();

  assert.equal(openPrintDocument(qrPayload()), "opened");
  assert.equal(runtime.openCalls.length, 2);
  assert.notEqual(requirePopup(runtime), firstPopup);
  assert.equal(runtime.listenerCount, 1);
  assert.equal(runtime.timeoutCount, 1);
});

test("sends an order receipt payload with 58mm paper width", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  const payload = orderPayload("58mm");

  assert.equal(openPrintDocument(payload), "opened");
  runtime.emitMessage();

  assert.deepEqual(requirePopup(runtime).postedMessages[0].message, payload);
  assert.equal(
    (requirePopup(runtime).postedMessages[0].message as PrintDocumentPayload)
      .type,
    "order-receipt",
  );
  assert.equal(payload.receipt.paperWidth, "58mm");
});

test("sends an order receipt payload with 80mm paper width", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  const payload = orderPayload("80mm");

  assert.equal(openPrintDocument(payload), "opened");
  runtime.emitMessage();

  assert.deepEqual(requirePopup(runtime).postedMessages[0].message, payload);
  assert.equal(payload.receipt.paperWidth, "80mm");
});

test("sends the minimal QR payload without customer PII", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  const payload = qrPayload();

  assert.equal(openPrintDocument(payload), "opened");
  runtime.emitMessage();

  assert.deepEqual(requirePopup(runtime).postedMessages[0].message, payload);
  assert.deepEqual(Object.keys(payload).sort(), [
    "businessName",
    "orderUrl",
    "qrDataUrl",
    "type",
  ]);
});

test("accepts a strict, complete child order payload", () => {
  assert.equal(isOrderPrintReceiptModel(receipt("58mm")), true);
  assert.equal(isPrintDocumentPayload(orderPayload("58mm")), true);
  assert.equal(isPrintDocumentPayload(orderPayload("80mm")), true);
});

test("accepts a strict, safe child QR payload", () => {
  assert.equal(isPrintDocumentPayload(qrPayload()), true);
});

test("rejects invalid and extra child payload fields", () => {
  const validOrder = orderPayload();
  const invalidNestedItem = structuredClone(validOrder);
  if (invalidNestedItem.type === "order-receipt") {
    Object.assign(invalidNestedItem.receipt.items[0], { extra: true });
  }

  assert.equal(isPrintDocumentPayload(null), false);
  assert.equal(isPrintDocumentPayload({ type: "unknown" }), false);
  assert.equal(
    isPrintDocumentPayload({ ...validOrder, unexpected: "field" }),
    false,
  );
  assert.equal(isPrintDocumentPayload(invalidNestedItem), false);
  assert.equal(
    isPrintDocumentPayload({ ...qrPayload(), orderUrl: "javascript:alert(1)" }),
    false,
  );
  assert.equal(
    isPrintDocumentPayload({
      ...qrPayload(),
      qrDataUrl: "data:text/html;base64,AAAA",
    }),
    false,
  );
});

test("returns invalid without opening a popup for an invalid payload", () => {
  const { runtime, openPrintDocument } = createTestOpener();

  assert.equal(
    openPrintDocument({ type: "order-receipt", receipt: {} }),
    "invalid",
  );
  assert.equal(runtime.openCalls.length, 0);
  assert.equal(runtime.listenerCount, 0);
  assert.equal(runtime.timeoutCount, 0);
});

test("READY validation accepts only the exact protocol object", () => {
  assert.equal(isPrintDocumentReadyMessage(PRINT_DOCUMENT_READY_MESSAGE), true);
  assert.equal(isPrintDocumentReadyMessage("print-document-ready"), false);
  assert.equal(
    isPrintDocumentReadyMessage({
      type: "print-document-ready",
      payload: "unexpected",
    }),
    false,
  );
});

test("postMessage failure closes and releases the active popup", () => {
  const { runtime, openPrintDocument } = createTestOpener();
  assert.equal(openPrintDocument(orderPayload()), "opened");
  const popup = requirePopup(runtime);
  popup.postMessageError = new Error("postMessage failed");

  runtime.emitMessage();

  assert.equal(popup.closed, true);
  assert.equal(runtime.listenerCount, 0);
  assert.equal(runtime.timeoutCount, 0);
  assert.equal(openPrintDocument(qrPayload()), "opened");
});

test("listener setup failure closes the popup and returns blocked", () => {
  const runtime = new FakePrintDocumentRuntime();
  runtime.subscribeError = new Error("listener failed");
  const { openPrintDocument } = createTestOpener(runtime);

  assert.equal(openPrintDocument(orderPayload()), "blocked");
  assert.equal(requirePopup(runtime).closed, true);
  assert.equal(runtime.listenerCount, 0);
  assert.equal(runtime.timeoutCount, 0);
});

test("timer setup failure removes the listener and closes the popup", () => {
  const runtime = new FakePrintDocumentRuntime();
  runtime.timeoutError = new Error("timer failed");
  const { openPrintDocument } = createTestOpener(runtime);

  assert.equal(openPrintDocument(orderPayload()), "blocked");
  assert.equal(requirePopup(runtime).closed, true);
  assert.equal(runtime.listenerCount, 0);
  assert.equal(runtime.timeoutCount, 0);
});
