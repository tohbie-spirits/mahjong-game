/**
 * FocusTrap.js — Task 115: keeps keyboard focus inside a modal overlay.
 *
 *   const release = trapFocus(overlayEl, { onEscape, initialFocus, restoreTo });
 *   …
 *   release();   // stops trapping and puts focus back where it was (or on restoreTo())
 *
 * Tab / Shift+Tab wrap around the overlay's focusable elements instead of
 * escaping to the table behind it; Escape calls onEscape (when given). Focus
 * that lands outside (a click on the backdrop, a script) is pulled back in.
 * On release, focus returns to the element that had it before — or, when that
 * element is gone (the table redrew), to `restoreTo()`.
 */

export const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The overlay's focusable elements, in order, ignoring hidden ones. */
export function focusableWithin(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.hidden && el.getAttribute?.('aria-hidden') !== 'true' && !el.closest?.('[hidden]'));
}

export function trapFocus(root, { onEscape = null, initialFocus = null, restoreTo = null, doc = typeof document !== 'undefined' ? document : null } = {}) {
  if (!root || typeof root.addEventListener !== 'function') throw new TypeError('[FocusTrap] trapFocus needs an element.');
  const previous = doc?.activeElement ?? null;
  const focus = (el) => { try { el?.focus?.({ preventScroll: true }); } catch { /* ignore */ } };

  const onKey = (e) => {
    if (e.key === 'Escape' && typeof onEscape === 'function') {
      e.preventDefault?.();
      e.stopPropagation?.();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusableWithin(root);
    if (items.length === 0) { e.preventDefault?.(); return; }
    const first = items[0]; const last = items[items.length - 1];
    const active = doc?.activeElement;
    if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault?.(); focus(last); }
    else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault?.(); focus(first); }
  };
  const onFocusIn = (e) => {
    if (!root.contains(e.target)) focus(focusableWithin(root)[0] ?? root);
  };
  root.addEventListener('keydown', onKey);
  doc?.addEventListener?.('focusin', onFocusIn);
  if (initialFocus !== false) {
    const active = doc?.activeElement;
    if (!active || !root.contains(active)) focus(initialFocus ?? focusableWithin(root)[0] ?? root);
  }

  let released = false;
  return function release() {
    if (released) return;
    released = true;
    root.removeEventListener('keydown', onKey);
    doc?.removeEventListener?.('focusin', onFocusIn);
    const connected = previous && (previous.isConnected ?? true) && previous !== doc?.body;
    const target = connected ? previous : (typeof restoreTo === 'function' ? restoreTo() : null);
    if (target) focus(target);
  };
}
