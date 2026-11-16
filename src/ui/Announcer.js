/**
 * Announcer.js — Task 115: screen-reader announcements (ARIA live regions).
 *
 *   const announcer = createAnnouncer();          // two visually hidden regions on <body>
 *   announcer.announce('AI 2 discards 5 of Dots.');
 *   announcer.announce('You win!', { assertive: true });
 *   announcer.destroy();
 *
 * Messages arriving close together (an opponent's whole turn happens in one
 * tick) are joined into ONE update (`batchMs`), so a screen reader reads them
 * as a sentence instead of cutting each other off. The region is emptied
 * before every update, so the same text twice in a row is still read.
 * Polite messages wait for the user; assertive ones (the hand's result)
 * interrupt. Nothing is shown on screen (.sr-only).
 *
 * `doc` and the timer functions are injectable (Node tests).
 */

export function createAnnouncer({ doc = typeof document !== 'undefined' ? document : null, batchMs = 120, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
  if (!doc?.body || typeof doc.createElement !== 'function') {
    return { announce() {}, flush() {}, history: () => [], destroy() {}, regions: () => [] };
  }
  const make = (politeness) => {
    const el = doc.createElement('div');
    el.className = 'sr-only announcer';
    el.setAttribute('aria-live', politeness);
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status');
    doc.body.appendChild(el);
    return el;
  };
  const polite = make('polite');
  const assertive = make('assertive');
  const pending = { polite: [], assertive: [] };
  const timers = { polite: null, assertive: null };
  const log = [];

  function write(kind) {
    timers[kind] = null;
    const text = pending[kind].splice(0).join(' ');
    if (!text) return;
    const el = kind === 'assertive' ? assertive : polite;
    el.textContent = '';
    // A fresh text node a moment later is announced even if identical to the last one.
    setTimer(() => { el.textContent = text; }, 30);
    log.push({ kind, text });
    if (log.length > 50) log.shift();
  }

  return {
    /** Queues a message. */
    announce(message, { assertive: urgent = false } = {}) {
      const text = String(message ?? '').trim();
      if (!text) return;
      const kind = urgent ? 'assertive' : 'polite';
      pending[kind].push(text);
      if (timers[kind] === null) timers[kind] = setTimer(() => write(kind), batchMs);
    },
    /** Writes anything queued now (tests; before the screen goes away). */
    flush() {
      for (const kind of ['polite', 'assertive']) {
        if (timers[kind] !== null) { clearTimer(timers[kind]); write(kind); }
      }
    },
    /** Recent announcements, oldest first: [{ kind, text }]. */
    history: () => log.slice(),
    regions: () => [polite, assertive],
    destroy() {
      for (const kind of ['polite', 'assertive']) if (timers[kind] !== null) clearTimer(timers[kind]);
      polite.remove?.();
      assertive.remove?.();
    },
  };
}
