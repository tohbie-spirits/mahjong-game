/**
 * fakeDom.mjs — Tasks 107+: a small DOM stand-in for UI tests in Node.
 * Enough for the UI modules under test: elements with classes, attributes,
 * dataset (data-* ↔ camelCase), style, children, textContent; selectors
 * with tag / .class / [attr] / [attr="v"] / :not(.class) compounds, the
 * descendant combinator and comma lists; closest / contains / matches;
 * bubbling events (addEventListener / dispatchEvent); a document with
 * createElement and body.
 *
 *   import { installFakeDom } from '../_helpers/fakeDom.mjs';
 *   const { document, El, fire } = installFakeDom();   // sets globalThis.document
 */

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function parseCompound(src) {
  const parts = [];
  const re = /(:not\(([^)]*)\))|(\.[\w-]+)|(\[([\w-]+)(?:="([^"]*)")?\])|(^[a-zA-Z][\w-]*)|(#[\w-]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) parts.push({ not: parseCompound(m[2]) });
    else if (m[3]) parts.push({ cls: m[3].slice(1) });
    else if (m[4]) parts.push({ attr: m[5], value: m[6] });
    else if (m[7]) parts.push({ tag: m[7].toUpperCase() });
    else if (m[8]) parts.push({ id: m[8].slice(1) });
  }
  return parts;
}

function matchCompound(el, parts) {
  return parts.every((p) => {
    if (p.not) return !matchCompound(el, p.not);
    if (p.cls) return el._c?.has(p.cls);
    if (p.tag) return el.tagName === p.tag;
    if (p.id) return el.id === p.id;
    if (p.attr) {
      const v = el.getAttribute(p.attr);
      return v !== null && (p.value === undefined || v === p.value);
    }
    return true;
  });
}

function matchesSelector(el, selector) {
  return selector.split(',').some((sel) => {
    const chain = sel.trim().split(/\s+/).map(parseCompound);
    if (!matchCompound(el, chain.at(-1))) return false;
    let i = chain.length - 2;
    for (let a = el.parent; a && i >= 0; a = a.parent) if (a.tagName && matchCompound(a, chain[i])) i--;
    return i < 0;
  });
}

export class El {
  constructor(tag = 'div', doc = null) {
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parent = null;
    this._c = new Set();
    this._attrs = new Map();
    this.dataset = {};
    this.style = {};
    this._listeners = new Map();
    this._text = '';
    this.hidden = false;
    this.id = '';
  }
  get className() { return [...this._c].join(' '); }
  set className(v) { this._c = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() {
    const c = this._c;
    return {
      add: (...x) => x.forEach((y) => c.add(y)),
      remove: (...x) => x.forEach((y) => c.delete(y)),
      contains: (x) => c.has(x),
      toggle: (x, force) => { const on = force ?? !c.has(x); if (on) c.add(x); else c.delete(x); return on; },
    };
  }
  get parentNode() { return this.parent; }
  get parentElement() { return this.parent; }
  get firstElementChild() { return this.children[0] ?? null; }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === this.ownerDocument?.body || n === this.ownerDocument?.documentElement; }
  setAttribute(k, v) {
    if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v);
    else if (k === 'class') this.className = v;
    else if (k === 'id') this.id = String(v);
    else this._attrs.set(k, String(v));
  }
  getAttribute(k) {
    if (k.startsWith('data-')) { const v = this.dataset[camel(k.slice(5))]; return v === undefined ? null : String(v); }
    if (k === 'class') return this.className;
    if (k === 'id') return this.id || null;
    if (k === 'hidden') return this.hidden ? '' : null;
    if (k === 'tabindex') return this.tabIndex === undefined ? null : String(this.tabIndex);
    return this._attrs.has(k) ? this._attrs.get(k) : null;
  }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) { if (k.startsWith('data-')) delete this.dataset[camel(k.slice(5))]; else this._attrs.delete(k); }
  appendChild(c) { if (c.parent) c.remove(); c.parent = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c); }
  insertBefore(c, ref) { if (c.parent) c.remove(); const i = ref ? this.children.indexOf(ref) : -1; c.parent = this; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
  replaceChildren(...cs) { for (const c of [...this.children]) c.remove(); this.append(...cs); }
  set innerHTML(v) { for (const c of [...this.children]) c.remove(); this._text = ''; }
  get innerHTML() { return ''; }
  set textContent(v) { for (const c of [...this.children]) c.remove(); this._text = String(v ?? ''); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  matches(sel) { return matchesSelector(this, sel); }
  closest(sel) { for (let x = this; x && x.tagName; x = x.parent) if (x.matches(sel)) return x; return null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (c.tagName !== '#TEXT' && c.matches(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  addEventListener(type, fn) { if (!this._listeners.has(type)) this._listeners.set(type, new Set()); this._listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this._listeners.get(type)?.delete(fn); }
  listenerCount(type) { return this._listeners.get(type)?.size ?? 0; }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    for (const fn of [...(this._listeners.get(event.type) ?? [])]) fn(event);
    if (event.bubbles !== false && !event._stopped && this.parent) this.parent.dispatchEvent(event);
    return !event.defaultPrevented;
  }
  click() { this.dispatchEvent(makeEvent('click')); }
  focus() { this.ownerDocument && (this.ownerDocument.activeElement = this); }
  getBoundingClientRect() { return this.rect ?? { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
  /** Task 119: a copy without listeners (like the DOM's), deep when asked. */
  cloneNode(deep = false) {
    const n = new El(this.tagName === '#TEXT' ? '#text' : this.tagName.toLowerCase(), this.ownerDocument);
    n._c = new Set(this._c); n._attrs = new Map(this._attrs); n.dataset = { ...this.dataset }; n.style = { ...this.style };
    n._text = this._text; n.hidden = this.hidden; n.id = this.id;
    if (this.tabIndex !== undefined) n.tabIndex = this.tabIndex;
    if (deep) for (const c of this.children) n.appendChild(c.cloneNode(true));
    return n;
  }
}

export function makeEvent(type, props = {}) {
  return { type, bubbles: true, defaultPrevented: false, _stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stopped = true; }, ...props };
}

export function installFakeDom() {
  const document = {
    activeElement: null,
    createElement: (t) => new El(t, document),
    createElementNS: (ns, t) => new El(t, document),
    createTextNode: (t) => Object.assign(new El('#text', document), { _text: String(t) }),
    _listeners: new Map(),
    addEventListener(type, fn) { if (!this._listeners.has(type)) this._listeners.set(type, new Set()); this._listeners.get(type).add(fn); },
    removeEventListener(type, fn) { this._listeners.get(type)?.delete(fn); },
    dispatchEvent(e) { for (const fn of [...(this._listeners.get(e.type) ?? [])]) fn(e); return true; },
  };
  document.documentElement = new El('html', document);
  document.body = new El('body', document);
  document.documentElement.appendChild(document.body);
  globalThis.document = document;
  if (typeof globalThis.Element === 'undefined') globalThis.Element = El;
  const fire = (el, type, props) => el.dispatchEvent(makeEvent(type, props));
  return { document, El, fire, makeEvent };
}
