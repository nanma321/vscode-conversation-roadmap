import * as React from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Moves focus into a modal, traps Tab within it, closes on Escape, and restores
 * focus to the invoking control when the modal unmounts.
 */
export function useModalFocus<T extends HTMLElement>(onCancel: () => void): React.RefObject<T | null> {
  const dialogRef = React.useRef<T>(null);
  const cancelRef = React.useRef(onCancel);
  cancelRef.current = onCancel;

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusableElements = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true"
      );

    const timer = window.setTimeout(() => {
      (focusableElements()[0] ?? dialog).focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      dialog.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return dialogRef;
}
