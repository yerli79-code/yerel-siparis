import type { OrderPrintReceiptModel } from "./order-print";

export const PRINT_DOCUMENT_PATH = "/panel/yazdir";
export const PRINT_DOCUMENT_WINDOW_NAME = "yerel-siparis-print-document";
export const PRINT_DOCUMENT_WINDOW_FEATURES =
  "popup=yes,width=480,height=720,resizable=yes,scrollbars=yes";
export const PRINT_DOCUMENT_HANDSHAKE_TIMEOUT_MS = 10_000;

export const PRINT_DOCUMENT_READY_MESSAGE = {
  type: "print-document-ready",
} as const;

export type OrderReceiptPrintDocumentPayload = {
  type: "order-receipt";
  receipt: OrderPrintReceiptModel;
};

export type CustomerQrPrintDocumentPayload = {
  type: "customer-qr";
  businessName: string;
  orderUrl: string;
  qrDataUrl: string;
};

export type PrintDocumentPayload =
  | OrderReceiptPrintDocumentPayload
  | CustomerQrPrintDocumentPayload;

export type PrintDocumentOpenResult =
  | "opened"
  | "blocked"
  | "busy"
  | "invalid";

export type PrintDocumentMessageEvent = {
  data: unknown;
  origin: string;
  source: unknown;
};

export type PrintDocumentWindow = {
  readonly closed: boolean;
  close: () => void;
  postMessage: (message: unknown, targetOrigin: string) => void;
};

export type PrintDocumentOpenerRuntime = {
  origin: string;
  open: (
    url: string,
    target: string,
    features: string,
  ) => PrintDocumentWindow | null;
  subscribeMessage: (
    listener: (event: PrintDocumentMessageEvent) => void,
  ) => () => void;
  setHandshakeTimeout: (listener: () => void, timeoutMs: number) => number;
  clearHandshakeTimeout: (timeoutId: number) => void;
};

const receiptKeys = [
  "businessName",
  "businessAddress",
  "businessWhatsapp",
  "orderNumber",
  "formattedCreatedAt",
  "statusLabel",
  "orderTypeLabel",
  "paymentMethodLabel",
  "customerName",
  "customerPhone",
  "customerAddressOrPickupMessage",
  "customerNote",
  "items",
  "totalAmount",
  "formattedTotal",
  "paperWidth",
] as const;

const receiptItemKeys = [
  "productName",
  "quantity",
  "unitPrice",
  "lineTotal",
  "formattedUnitPrice",
  "formattedLineTotal",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
) {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOrderPrintReceiptItem(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, receiptItemKeys)) return false;

  return (
    typeof value.productName === "string" &&
    isFiniteNumber(value.quantity) &&
    isFiniteNumber(value.unitPrice) &&
    isFiniteNumber(value.lineTotal) &&
    typeof value.formattedUnitPrice === "string" &&
    typeof value.formattedLineTotal === "string"
  );
}

export function isOrderPrintReceiptModel(
  value: unknown,
): value is OrderPrintReceiptModel {
  if (!isRecord(value) || !hasExactKeys(value, receiptKeys)) return false;

  return (
    typeof value.businessName === "string" &&
    isStringOrNull(value.businessAddress) &&
    isStringOrNull(value.businessWhatsapp) &&
    isFiniteNumber(value.orderNumber) &&
    typeof value.formattedCreatedAt === "string" &&
    typeof value.statusLabel === "string" &&
    typeof value.orderTypeLabel === "string" &&
    typeof value.paymentMethodLabel === "string" &&
    typeof value.customerName === "string" &&
    typeof value.customerPhone === "string" &&
    typeof value.customerAddressOrPickupMessage === "string" &&
    isStringOrNull(value.customerNote) &&
    Array.isArray(value.items) &&
    value.items.every(isOrderPrintReceiptItem) &&
    isFiniteNumber(value.totalAmount) &&
    typeof value.formattedTotal === "string" &&
    (value.paperWidth === "58mm" || value.paperWidth === "80mm")
  );
}

function isSafeOrderUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;

  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function isPngDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

export function isPrintDocumentPayload(
  value: unknown,
): value is PrintDocumentPayload {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "order-receipt") {
    return (
      hasExactKeys(value, ["type", "receipt"]) &&
      isOrderPrintReceiptModel(value.receipt)
    );
  }

  if (value.type === "customer-qr") {
    return (
      hasExactKeys(value, [
        "type",
        "businessName",
        "orderUrl",
        "qrDataUrl",
      ]) &&
      typeof value.businessName === "string" &&
      value.businessName.trim().length > 0 &&
      isSafeOrderUrl(value.orderUrl) &&
      isPngDataUrl(value.qrDataUrl)
    );
  }

  return false;
}

export function isPrintDocumentReadyMessage(
  value: unknown,
): value is typeof PRINT_DOCUMENT_READY_MESSAGE {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["type"]) &&
    value.type === PRINT_DOCUMENT_READY_MESSAGE.type
  );
}

function createBrowserPrintDocumentOpenerRuntime(): PrintDocumentOpenerRuntime {
  return {
    origin: window.location.origin,
    open: (url, target, features) => window.open(url, target, features),
    subscribeMessage(listener) {
      const handleMessage = (event: MessageEvent<unknown>) => listener(event);
      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    },
    setHandshakeTimeout: (listener, timeoutMs) =>
      window.setTimeout(listener, timeoutMs),
    clearHandshakeTimeout: (timeoutId) => window.clearTimeout(timeoutId),
  };
}

type ActivePrintDocument = {
  popup: PrintDocumentWindow;
  release: () => void;
};

export function createPrintDocumentOpener(
  getRuntime: () => PrintDocumentOpenerRuntime =
    createBrowserPrintDocumentOpenerRuntime,
) {
  let activePrintDocument: ActivePrintDocument | null = null;

  return (candidatePayload: unknown): PrintDocumentOpenResult => {
    if (!isPrintDocumentPayload(candidatePayload)) return "invalid";

    if (activePrintDocument) {
      if (!activePrintDocument.popup.closed) return "busy";

      activePrintDocument.release();
      activePrintDocument = null;
    }

    let runtime: PrintDocumentOpenerRuntime;
    let popup: PrintDocumentWindow | null;

    try {
      runtime = getRuntime();
      popup = runtime.open(
        PRINT_DOCUMENT_PATH,
        PRINT_DOCUMENT_WINDOW_NAME,
        PRINT_DOCUMENT_WINDOW_FEATURES,
      );
    } catch {
      return "blocked";
    }

    if (!popup) return "blocked";

    let unsubscribeMessage: (() => void) | null = null;
    let handshakeTimeoutId: number | null = null;
    let handshakeFinished = false;

    const session: ActivePrintDocument = {
      popup,
      release: () => undefined,
    };

    const cleanupHandshake = () => {
      if (handshakeFinished) return;
      handshakeFinished = true;

      unsubscribeMessage?.();
      unsubscribeMessage = null;

      if (handshakeTimeoutId !== null) {
        runtime.clearHandshakeTimeout(handshakeTimeoutId);
        handshakeTimeoutId = null;
      }
    };

    const release = () => {
      cleanupHandshake();
      if (activePrintDocument === session) activePrintDocument = null;
    };

    const closeAndRelease = () => {
      release();
      try {
        popup.close();
      } catch {
        // The session is released even if the browser refuses to close it.
      }
    };

    session.release = release;
    activePrintDocument = session;

    const handleMessage = (event: PrintDocumentMessageEvent) => {
      if (
        handshakeFinished ||
        event.origin !== runtime.origin ||
        event.source !== popup ||
        !isPrintDocumentReadyMessage(event.data)
      ) {
        return;
      }

      cleanupHandshake();

      try {
        popup.postMessage(candidatePayload, runtime.origin);
      } catch {
        closeAndRelease();
      }
    };

    try {
      const unsubscribe = runtime.subscribeMessage(handleMessage);
      if (handshakeFinished) {
        unsubscribe();
      } else {
        unsubscribeMessage = unsubscribe;
      }

      if (!handshakeFinished) {
        const timeoutId = runtime.setHandshakeTimeout(
          closeAndRelease,
          PRINT_DOCUMENT_HANDSHAKE_TIMEOUT_MS,
        );

        if (handshakeFinished) {
          runtime.clearHandshakeTimeout(timeoutId);
        } else {
          handshakeTimeoutId = timeoutId;
        }
      }
    } catch {
      closeAndRelease();
      return "blocked";
    }

    return "opened";
  };
}

export const openPrintDocument = createPrintDocumentOpener();
