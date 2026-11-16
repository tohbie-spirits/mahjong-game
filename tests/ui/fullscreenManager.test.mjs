/**
 * fullscreenManager.test.mjs — Task 111: src/ui/FullscreenManager.js against
 * fake documents (standard API, webkit-prefixed API, none, a refusing browser).
 * The real browser path is exercised in tests/browser/smoke.py.
 *
 * Sections:
 *   1. Standard API — enter / exit / toggle, state, data-fullscreen, listeners
 *   2. Esc — a change the browser makes on its own reaches the listeners
 *   3. webkit-prefixed (Safari)
 *   4. Unsupported / disabled / refused — never throws or rejects
 *
 * Run: node tests/ui/fullscreenManager.test.mjs
 */
import { section, sectionAsync, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { FullscreenManager } from '../../src/ui/FullscreenManager.js';

function fakeDoc({ prefix = '', enabled = true, refuse = false, api = true } = {}) {
  const listeners = new Map();
  const doc = {
    listeners,
    addEventListener: (t, f) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); },
    removeEventListener: (t, f) => listeners.get(t)?.delete(f),
    fire(t) { for (const f of listeners.get(t) ?? []) f({ type: t }); },
  };
  const el = { dataset: {}, requests: [] };
  doc.documentElement = el;
  const change = prefix ? 'webkitfullscreenchange' : 'fullscreenchange';
  const elKey = prefix ? 'webkitFullscreenElement' : 'fullscreenElement';
  doc[prefix ? 'webkitFullscreenEnabled' : 'fullscreenEnabled'] = enabled;
  doc[elKey] = null;
  if (api) {
    el[prefix ? 'webkitRequestFullscreen' : 'requestFullscreen'] = (opts) => {
      el.requests.push(opts);
      if (refuse) return prefix ? undefined : Promise.reject(new TypeError('Permissions check failed'));
      doc[elKey] = el; doc.fire(change);
      return prefix ? undefined : Promise.resolve();
    };
    doc[prefix ? 'webkitExitFullscreen' : 'exitFullscreen'] = () => { doc[elKey] = null; doc.fire(change); return prefix ? undefined : Promise.resolve(); };
  }
  doc.esc = () => { doc[elKey] = null; doc.fire(change); };
  return { doc, el };
}

// ---------------------------------------------------------------------------
await sectionAsync('1. Standard API', async () => {
  const { doc, el } = fakeDoc();
  const fs = new FullscreenManager({ doc });
  const seen = [];
  fs.subscribe((a) => seen.push(a));
  assert(fs.isSupported() && !fs.isActive(), 'supported, not active');
  assert((await fs.enter()) === true && fs.isActive() && el.requests.length === 1 && el.requests[0].navigationUI === 'hide', 'enter → the whole page (<html>) goes fullscreen, browser UI hidden');
  assert('fullscreen' in el.dataset && seen.join() === 'true', '<html data-fullscreen> set; listeners told');
  assert((await fs.enter()) === true && el.requests.length === 1, 'entering again does nothing');
  assert((await fs.exit()) === false && !fs.isActive() && !('fullscreen' in el.dataset) && seen.join() === 'true,false', 'exit');
  assert((await fs.exit()) === false, 'exit when not fullscreen → false, no error');
  assert((await fs.toggle()) === true && (await fs.toggle()) === false, 'toggle');
  assertThrows(() => fs.subscribe(null), TypeError, 'subscribe needs a function');
});

// ---------------------------------------------------------------------------
await sectionAsync('2. Esc', async () => {
  const { doc } = fakeDoc();
  const fs = new FullscreenManager({ doc });
  const seen = [];
  const off = fs.subscribe((a) => seen.push(a));
  fs.subscribe(() => { throw new Error('bad listener'); });
  await fs.enter();
  doc.esc();
  assert(!fs.isActive() && seen.join() === 'true,false', 'the browser leaving fullscreen (Esc) reaches the listeners — a throwing one can’t stop them');
  off();
  await fs.enter();
  assert(seen.length === 2, 'unsubscribed');
  fs.destroy();
  assert((doc.listeners.get('fullscreenchange')?.size ?? 0) === 0, 'destroy removes the document listeners');
});

// ---------------------------------------------------------------------------
await sectionAsync('3. webkit-prefixed', async () => {
  const { doc, el } = fakeDoc({ prefix: 'webkit' });
  const fs = new FullscreenManager({ doc });
  const seen = [];
  fs.subscribe((a) => seen.push(a));
  assert(fs.isSupported(), 'Safari’s prefixed API is supported');
  assert((await fs.enter()) === true && fs.isActive() && el.requests.length === 1, 'webkitRequestFullscreen (returns no promise) works');
  assert((await fs.exit()) === false && seen.join() === 'true,false', 'webkitExitFullscreen + webkitfullscreenchange');
});

// ---------------------------------------------------------------------------
await sectionAsync('4. Unsupported / disabled / refused', async () => {
  const none = new FullscreenManager({ doc: fakeDoc({ api: false }).doc });
  assert(!none.isSupported() && (await none.enter()) === false && (await none.toggle()) === false, 'no API (iPhone Safari) → unsupported, enter resolves false');
  const disabled = new FullscreenManager({ doc: fakeDoc({ enabled: false }).doc });
  assert(!disabled.isSupported(), 'fullscreenEnabled false (an iframe without allowfullscreen) → unsupported');
  const { doc } = fakeDoc({ refuse: true });
  const refused = new FullscreenManager({ doc });
  let rejected = false;
  const r = await refused.enter().catch(() => { rejected = true; });
  assert(r === false && !rejected && !refused.isActive(), 'a refused request (no user gesture) resolves false, never rejects');
  const thrower = fakeDoc();
  thrower.el.requestFullscreen = () => { throw new Error('sync throw'); };
  assert((await new FullscreenManager({ doc: thrower.doc }).enter()) === false, 'a request that throws → false');
  const noDoc = new FullscreenManager({ doc: null });
  assert(!noDoc.isSupported() && !noDoc.isActive(), 'no document (Node) → unsupported');
});

summary();
