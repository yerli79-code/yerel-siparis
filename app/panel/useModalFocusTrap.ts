"use client";

import { useEffect, useRef, type RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type ModalFocusTrapOptions = {
  isOpen: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
};

function getFocusableElements(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

export function useModalFocusTrap({
  isOpen,
  dialogRef,
  initialFocusRef,
  returnFocusRef,
  onClose,
}: ModalFocusTrapOptions) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const activeElement = document.activeElement;
    const fallbackReturnTarget =
      activeElement instanceof HTMLElement ? activeElement : null;
    const returnTarget = returnFocusRef?.current ?? fallbackReturnTarget;
    const previousBodyOverflow = document.body.style.overflow;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const focusedElement = document.activeElement;
      const focusIsOutsideDialog =
        !(focusedElement instanceof Node) || !dialog.contains(focusedElement);

      if (
        event.shiftKey &&
        (focusedElement === firstFocusable || focusIsOutsideDialog)
      ) {
        event.preventDefault();
        lastFocusable.focus({ preventScroll: true });
      } else if (
        !event.shiftKey &&
        (focusedElement === lastFocusable || focusIsOutsideDialog)
      ) {
        event.preventDefault();
        firstFocusable.focus({ preventScroll: true });
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    (initialFocusRef.current ?? dialog).focus({ preventScroll: true });

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      if (returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true });
      }
    };
  }, [dialogRef, initialFocusRef, isOpen, returnFocusRef]);
}
