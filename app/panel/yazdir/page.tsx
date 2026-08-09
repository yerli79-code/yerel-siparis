"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import OrderPrintReceipt from "../OrderPrintReceipt";
import {
  PRINT_DOCUMENT_READY_MESSAGE,
  isPrintDocumentPayload,
  type PrintDocumentPayload,
} from "../print-document";
import styles from "./print-document.module.css";

const PRINT_RECOVERY_DELAY_MS = 4_000;

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForPrintBoundary() {
  await nextAnimationFrame();
  await nextAnimationFrame();
}

export default function PrintDocumentPage() {
  const [payload, setPayload] = useState<PrintDocumentPayload | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const acceptedPayloadRef = useRef(false);
  const autoPrintRequestedRef = useRef(false);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const qrImageRef = useRef<HTMLImageElement | null>(null);
  const printInProgressRef = useRef(false);
  const printCallMadeRef = useRef(false);
  const printLifecycleSeenRef = useRef(false);
  const recoveryTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const clearRecoveryTimers = useCallback(() => {
    if (recoveryTimerRef.current !== null) {
      window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const restoreControls = useCallback(() => {
    if (!printInProgressRef.current) return;

    clearRecoveryTimers();
    printInProgressRef.current = false;
    printCallMadeRef.current = false;
    printLifecycleSeenRef.current = false;
    controlsRef.current?.removeAttribute("hidden");

    if (mountedRef.current) {
      setControlsHidden(false);
      setIsPrinting(false);
    }
  }, [clearRecoveryTimers]);

  useEffect(() => {
    const opener = window.opener;
    if (!opener || opener === window) return;

    function handleMessage(event: MessageEvent<unknown>) {
      if (
        event.origin !== window.location.origin ||
        event.source !== opener ||
        acceptedPayloadRef.current ||
        !isPrintDocumentPayload(event.data)
      ) {
        return;
      }

      acceptedPayloadRef.current = true;
      window.removeEventListener("message", handleMessage);
      setPayload(event.data);
    }

    window.addEventListener("message", handleMessage);
    opener.postMessage(PRINT_DOCUMENT_READY_MESSAGE, window.location.origin);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  useEffect(() => {
    function noteBeforePrint() {
      if (printInProgressRef.current) {
        printLifecycleSeenRef.current = true;
      }
    }

    function handleFocus() {
      if (printCallMadeRef.current) restoreControls();
    }

    window.addEventListener("beforeprint", noteBeforePrint);
    window.addEventListener("afterprint", restoreControls);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("beforeprint", noteBeforePrint);
      window.removeEventListener("afterprint", restoreControls);
      window.removeEventListener("focus", handleFocus);
    };
  }, [restoreControls]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearRecoveryTimers();
    };
  }, [clearRecoveryTimers]);

  const printDocument = useCallback(async () => {
    if (!payload || printInProgressRef.current) return;

    printInProgressRef.current = true;
    printCallMadeRef.current = false;
    printLifecycleSeenRef.current = false;
    setIsPrinting(true);

    if (payload.type === "customer-qr") {
      try {
        await qrImageRef.current?.decode();
      } catch {
        // A decoded data URL is expected; the render boundary remains the fallback.
      }
    }

    if (!mountedRef.current) return;

    controlsRef.current?.setAttribute("hidden", "");
    setControlsHidden(true);
    await waitForPrintBoundary();

    if (!mountedRef.current) return;

    try {
      printCallMadeRef.current = true;
      window.print();
    } catch {
      restoreControls();
      return;
    }

    if (!printInProgressRef.current) return;

    recoveryTimerRef.current = window.setTimeout(() => {
      if (!printLifecycleSeenRef.current) {
        restoreControls();
      }
    }, PRINT_RECOVERY_DELAY_MS);
  }, [payload, restoreControls]);

  useEffect(() => {
    if (!payload || autoPrintRequestedRef.current) return;

    autoPrintRequestedRef.current = true;
    void printDocument();
  }, [payload, printDocument]);

  const paperWidth =
    payload?.type === "order-receipt" ? payload.receipt.paperWidth : null;

  return (
    <main
      aria-busy={!payload}
      className={`${styles.root} ${
        controlsHidden ? styles.rootPreparing : ""
      }`}
      data-paper-width={paperWidth ?? undefined}
      data-print-kind={payload?.type ?? "waiting"}
    >
      <div className={styles.content}>
        {!payload ? (
          <p className={styles.waiting} role="status" aria-live="polite">
            Yazdırma verisi bekleniyor.
          </p>
        ) : payload.type === "order-receipt" ? (
          <div
            className={`${styles.receiptFrame} ${
              payload.receipt.paperWidth === "58mm"
                ? styles.receiptFrame58
                : styles.receiptFrame80
            }`}
          >
            <OrderPrintReceipt
              mode="print-document"
              receipt={payload.receipt}
            />
          </div>
        ) : (
          <section
            className={styles.qrDocument}
            aria-labelledby="print-qr-business-name"
            data-print-document-content="customer-qr"
          >
            <h1 id="print-qr-business-name">{payload.businessName}</h1>
            <p className={styles.qrInstruction}>
              Sipariş için QR kodu okutun
            </p>
            <div className={styles.qrImageFrame}>
              <Image
                ref={qrImageRef}
                alt="Müşteri sipariş sayfası QR kodu"
                className={styles.qrImage}
                height={560}
                loading="eager"
                src={payload.qrDataUrl}
                unoptimized
                width={560}
              />
            </div>
            <p className={styles.qrUrl}>{payload.orderUrl}</p>
          </section>
        )}
      </div>

      <div
        aria-label="Yazdırma kontrolleri"
        className={styles.controls}
        data-print-document-controls
        hidden={controlsHidden}
        ref={controlsRef}
        role="group"
      >
        <button
          className={styles.primaryButton}
          disabled={!payload || isPrinting}
          onClick={() => void printDocument()}
          type="button"
        >
          Yazdır
        </button>
        <button
          className={styles.secondaryButton}
          onClick={() => window.close()}
          type="button"
        >
          Kapat
        </button>
      </div>
    </main>
  );
}
