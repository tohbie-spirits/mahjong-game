/**
 * EventBus.js
 *
 * Minimal synchronous publish/subscribe bus. The core engine emits game
 * events (`game:round-settled`, …) here so UI, audio and animation can react
 * without the engine knowing they exist.
 *
 * REBUILT (after Task 77) from the project plan's description of Task 6 and
 * its uses in main.js (`gameEventBus.once()` returning an unsubscribe
 * function, `emit()`), and in GameManager (isolated buses in tests).
 *
 *   const bus = new EventBus();
 *   const off = bus.on('x', (payload) => …);
 *   bus.emit('x', { … });
 *   off();
 *
 * Listener errors are caught and logged so one broken subscriber can't stop
 * the game loop or other subscribers.
 */

export class EventBus {
  constructor() {
    /** @private @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribes to an event.
   * @param {string} event
   * @param {function(*): void} listener
   * @returns {function(): void} unsubscribe
   */
  on(event, listener) {
    _assertEvent(event);
    if (typeof listener !== 'function') {
      throw new TypeError('[EventBus] listener must be a function.');
    }
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }

  /**
   * Subscribes for a single emission.
   * @param {string} event
   * @param {function(*): void} listener
   * @returns {function(): void} unsubscribe (safe to call after it fired)
   */
  once(event, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('[EventBus] listener must be a function.');
    }
    const wrapper = (payload) => {
      this.off(event, wrapper);
      listener(payload);
    };
    return this.on(event, wrapper);
  }

  /**
   * Removes a listener. No-op if it isn't subscribed.
   * @param {string} event
   * @param {Function} listener
   */
  off(event, listener) {
    const set = this._listeners.get(event);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) this._listeners.delete(event);
  }

  /**
   * Calls every listener for `event` with `payload`, in subscription order.
   * @param {string} event
   * @param {*} [payload]
   * @returns {number} how many listeners were called
   */
  emit(event, payload) {
    _assertEvent(event);
    const set = this._listeners.get(event);
    if (!set) return 0;
    let called = 0;
    for (const listener of [...set]) {
      called++;
      try {
        listener(payload);
      } catch (error) {
        console.error(`[EventBus] listener for "${event}" threw:`, error);
      }
    }
    return called;
  }

  /** @param {string} event @returns {number} */
  listenerCount(event) {
    return this._listeners.get(event)?.size ?? 0;
  }

  /** Removes every listener (or every listener for one event). */
  clear(event) {
    if (event === undefined) this._listeners.clear();
    else this._listeners.delete(event);
  }
}

/** @private */
function _assertEvent(event) {
  if (typeof event !== 'string' || event === '') {
    throw new TypeError('[EventBus] event name must be a non-empty string.');
  }
}

/** The shared application-wide bus. Tests should create their own EventBus. */
export const gameEventBus = new EventBus();
