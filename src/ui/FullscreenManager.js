/**
 * FullscreenManager.js — Task 111: fullscreen for the whole app.
 *
 * A thin wrapper over the Fullscreen API that smooths over its browser
 * differences (standard and webkit-prefixed — Safari on iPad / older macOS),
 * never throws or rejects (a refused request — no user gesture, a policy
 * block — resolves false), and tells listeners when the state changes for ANY
 * reason, including the user pressing Esc.
 *
 *   const fs = new FullscreenManager();          // the whole page (<html>)
 *   fs.isSupported(); fs.isActive();
 *   await fs.enter(); await fs.exit(); await fs.toggle();   // → boolean: active afterwards
 *   const off = fs.subscribe((active) => …);
 *
 * Used by the toolbar button (F) and the Settings row (AppToolbar.js,
 * SettingsMenu.js). While fullscreen, <html> carries `data-fullscreen` so CSS
 * can use the extra room. iPhone Safari has no element fullscreen at all:
 * isSupported() is false there and the controls are simply not shown (the
 * page already fills the screen when added to the home screen — viewport-fit).
 *
 * `doc` is injectable so the manager is unit-tested in Node.
 */

export class FullscreenManager {
  /**
   * @param {Object} [options]
   * @param {Document} [options.doc=document]
   * @param {Element} [options.element=doc.documentElement] what goes fullscreen
   */
  constructor({ doc = typeof document !== 'undefined' ? document : null, element } = {}) {
    this._doc = doc;
    this._el = element ?? doc?.documentElement ?? null;
    this._listeners = new Set();
    this._onChange = () => {
      const active = this.isActive();
      if (this._el?.dataset) { if (active) this._el.dataset.fullscreen = ''; else delete this._el.dataset.fullscreen; }
      for (const fn of [...this._listeners]) { try { fn(active); } catch { /* a listener can't break it */ } }
    };
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('fullscreenchange', this._onChange);
      doc.addEventListener('webkitfullscreenchange', this._onChange);
    }
  }

  /** The browser can put the app fullscreen (and the page is allowed to). */
  isSupported() {
    const d = this._doc; const el = this._el;
    if (!d || !el) return false;
    const enabled = d.fullscreenEnabled ?? d.webkitFullscreenEnabled;
    const can = typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
    return can && enabled !== false;
  }

  /** Something (normally the app) is fullscreen right now. */
  isActive() {
    const d = this._doc;
    return !!(d && (d.fullscreenElement ?? d.webkitFullscreenElement));
  }

  /** @returns {Promise<boolean>} active afterwards */
  enter() {
    if (!this.isSupported()) return Promise.resolve(false);
    if (this.isActive()) return Promise.resolve(true);
    const el = this._el;
    try {
      const r = typeof el.requestFullscreen === 'function' ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen();
      return Promise.resolve(r).then(() => this.isActive(), () => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  /** @returns {Promise<boolean>} active afterwards */
  exit() {
    const d = this._doc;
    if (!this.isActive()) return Promise.resolve(false);
    try {
      const r = typeof d.exitFullscreen === 'function' ? d.exitFullscreen() : d.webkitExitFullscreen?.();
      return Promise.resolve(r).then(() => this.isActive(), () => this.isActive());
    } catch {
      return Promise.resolve(this.isActive());
    }
  }

  /** @returns {Promise<boolean>} active afterwards */
  toggle() { return this.isActive() ? this.exit() : this.enter(); }

  /** Called with (active) on every change. Returns an unsubscribe. */
  subscribe(fn) {
    if (typeof fn !== 'function') throw new TypeError('[FullscreenManager] subscribe needs a function.');
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  destroy() {
    this._listeners.clear();
    this._doc?.removeEventListener?.('fullscreenchange', this._onChange);
    this._doc?.removeEventListener?.('webkitfullscreenchange', this._onChange);
  }
}
