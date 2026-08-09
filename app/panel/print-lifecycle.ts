import type { OrderPrintPaperWidth } from "./order-print";

export const PANEL_PRINT_CLEANUP_FALLBACK_MS = 30 * 60 * 1000;

type PanelPrintOptions =
  | {
      target: "customer-qr";
    }
  | {
      target: "order-receipt";
      orderPaperWidth: OrderPrintPaperWidth;
    };

type PanelPrintAttributeRoot = Pick<
  HTMLElement,
  "removeAttribute" | "setAttribute"
>;

export type PanelPrintRuntime = {
  root: PanelPrintAttributeRoot;
  print: () => void;
  getVisibilityState: () => DocumentVisibilityState;
  subscribeAfterPrint: (listener: () => void) => () => void;
  subscribePrintMediaChange: (
    listener: (matches: boolean) => void,
  ) => () => void;
  subscribeVisibilityChange: (listener: () => void) => () => void;
  subscribeFocus: (listener: () => void) => () => void;
  setCleanupTimeout: (listener: () => void, timeoutMs: number) => number;
  clearCleanupTimeout: (timeoutId: number) => void;
};

function clearPanelPrintMetadata(root: PanelPrintAttributeRoot) {
  root.removeAttribute("data-panel-print-target");
  root.removeAttribute("data-order-print-paper-width");
}

function createBrowserPrintRuntime(): PanelPrintRuntime {
  return {
    root: document.documentElement,
    print: () => window.print(),
    getVisibilityState: () => document.visibilityState,
    subscribeAfterPrint(listener) {
      window.addEventListener("afterprint", listener);
      return () => window.removeEventListener("afterprint", listener);
    },
    subscribePrintMediaChange(listener) {
      if (typeof window.matchMedia !== "function") return () => undefined;

      const printMedia = window.matchMedia("print");
      const handlePrintMediaChange = (event: MediaQueryListEvent) => {
        listener(event.matches);
      };

      if (typeof printMedia.addEventListener === "function") {
        printMedia.addEventListener("change", handlePrintMediaChange);
        return () =>
          printMedia.removeEventListener("change", handlePrintMediaChange);
      }

      printMedia.addListener(handlePrintMediaChange);
      return () => printMedia.removeListener(handlePrintMediaChange);
    },
    subscribeVisibilityChange(listener) {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    subscribeFocus(listener) {
      window.addEventListener("focus", listener);
      return () => window.removeEventListener("focus", listener);
    },
    setCleanupTimeout: (listener, timeoutMs) =>
      window.setTimeout(listener, timeoutMs),
    clearCleanupTimeout: (timeoutId) => window.clearTimeout(timeoutId),
  };
}

export function createPanelPrintRunner(
  getRuntime: () => PanelPrintRuntime = createBrowserPrintRuntime,
) {
  let cleanupActivePrint: (() => void) | null = null;

  return (options: PanelPrintOptions) => {
    cleanupActivePrint?.();

    const runtime = getRuntime();
    clearPanelPrintMetadata(runtime.root);
    runtime.root.setAttribute("data-panel-print-target", options.target);

    if (options.target === "order-receipt") {
      runtime.root.setAttribute(
        "data-order-print-paper-width",
        options.orderPaperWidth,
      );
    }

    let cleanupTimeoutId: number | null = null;
    let didBecomeHidden = false;
    let isCleanedUp = false;
    const unsubscribeCallbacks: Array<() => void> = [];

    const cleanup = () => {
      if (isCleanedUp) return;

      isCleanedUp = true;
      for (const unsubscribe of unsubscribeCallbacks.splice(0)) {
        unsubscribe();
      }

      if (cleanupTimeoutId !== null) {
        runtime.clearCleanupTimeout(cleanupTimeoutId);
      }

      clearPanelPrintMetadata(runtime.root);
      if (cleanupActivePrint === cleanup) cleanupActivePrint = null;
    };

    const handleVisibilityChange = () => {
      const visibilityState = runtime.getVisibilityState();
      if (visibilityState === "hidden") {
        didBecomeHidden = true;
        return;
      }

      if (didBecomeHidden && visibilityState === "visible") cleanup();
    };

    const handleFocus = () => {
      if (didBecomeHidden && runtime.getVisibilityState() === "visible") {
        cleanup();
      }
    };

    cleanupActivePrint = cleanup;

    try {
      unsubscribeCallbacks.push(runtime.subscribeAfterPrint(cleanup));
      unsubscribeCallbacks.push(
        runtime.subscribePrintMediaChange((matches) => {
          if (!matches) cleanup();
        }),
      );
      unsubscribeCallbacks.push(
        runtime.subscribeVisibilityChange(handleVisibilityChange),
      );
      unsubscribeCallbacks.push(runtime.subscribeFocus(handleFocus));
      cleanupTimeoutId = runtime.setCleanupTimeout(
        cleanup,
        PANEL_PRINT_CLEANUP_FALLBACK_MS,
      );
      runtime.print();
    } catch (error) {
      cleanup();
      throw error;
    }
  };
}

export const runPanelPrint = createPanelPrintRunner();
