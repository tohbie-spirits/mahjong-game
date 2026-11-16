/**
 * StorageManager.js
 *
 * Versioned, namespaced LocalStorage persistence (Task 61).
 *
 *   1. Namespacing — every key stored as 'mahjong:domain:key'.
 *   2. JSON I/O — set()/get() serialise automatically; get() returns null for
 *      missing or corrupt data.
 *   3. Schema versioning — migrate(map) runs handlers from the stored version
 *      up to CURRENT_SCHEMA_VERSION in order; idempotent; throws on downgrade.
 *   4. Injectable backend — MemoryStorage for Node/tests.
 *   5. namespace(domain) — a child sharing the same backend, isolated to its
 *      own 'prefix:domain:' key-space. remove()/clear() are namespace-scoped.
 *
 * REBUILT (after Task 77) from the plan's Task 61 description.
 */

export const CURRENT_SCHEMA_VERSION = 1;

const VERSION_KEY = '__schemaVersion__';

/** Minimal in-memory Storage (getItem/setItem/removeItem/key/length/clear). */
export class MemoryStorage {
  constructor() { this._map = new Map(); }
  getItem(key) { return this._map.has(key) ? this._map.get(key) : null; }
  setItem(key, value) { this._map.set(String(key), String(value)); }
  removeItem(key) { this._map.delete(key); }
  key(index) { return [...this._map.keys()][index] ?? null; }
  get length() { return this._map.size; }
  clear() { this._map.clear(); }
}

/** @private */
function _defaultStorage() {
  try {
    if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  } catch { /* access can throw in sandboxed browsers */ }
  return new MemoryStorage();
}

export class StorageManager {
  /**
   * @param {Object} [options]
   * @param {Storage} [options.storage]  defaults to localStorage, else MemoryStorage
   * @param {string} [options.prefix='mahjong']
   */
  constructor({ storage, prefix = 'mahjong' } = {}) {
    const backend = storage ?? _defaultStorage();
    for (const m of ['getItem', 'setItem', 'removeItem']) {
      if (typeof backend[m] !== 'function') throw new TypeError(`[StorageManager] storage backend must implement ${m}().`);
    }
    if (typeof prefix !== 'string' || prefix === '' || prefix.includes(' ')) throw new TypeError('[StorageManager] prefix must be a non-empty string without spaces.');
    this._storage = backend;
    this._prefix = prefix;
  }

  /** The full key prefix of this namespace (e.g. 'mahjong:settings'). */
  getPrefix() { return this._prefix; }

  /** @private */
  _key(key) {
    if (typeof key !== 'string' || key === '') throw new TypeError('[StorageManager] key must be a non-empty string.');
    return `${this._prefix}:${key}`;
  }

  /**
   * @param {string} key
   * @param {*} value  JSON-serialisable
   * @returns {boolean} false when the backend refused (quota, private mode)
   */
  set(key, value) {
    const full = this._key(key);
    let json;
    try { json = JSON.stringify(value); } catch (e) { throw new TypeError(`[StorageManager] value for "${key}" is not JSON-serialisable: ${e.message}`); }
    if (json === undefined) throw new TypeError(`[StorageManager] value for "${key}" is not JSON-serialisable.`);
    try {
      this._storage.setItem(full, json);
      return true;
    } catch {
      return false;
    }
  }

  /** @returns {*} parsed value, or null when missing/corrupt */
  get(key) {
    const full = this._key(key);
    let raw;
    try { raw = this._storage.getItem(full); } catch { return null; }
    if (raw === null || raw === undefined) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  /** True when the key exists in this namespace. */
  has(key) {
    try { return this._storage.getItem(this._key(key)) !== null; } catch { return false; }
  }

  remove(key) {
    try { this._storage.removeItem(this._key(key)); } catch { /* ignore */ }
  }

  /** Keys (without prefix) stored directly in this namespace or below it. */
  keys() {
    const out = [];
    const start = `${this._prefix}:`;
    const s = this._storage;
    if (typeof s.key !== 'function' || typeof s.length !== 'number') return out;
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (typeof k === 'string' && k.startsWith(start)) out.push(k.slice(start.length));
    }
    return out;
  }

  /** Removes every key in this namespace (and its children). */
  clear() {
    for (const k of this.keys()) this.remove(k);
  }

  /** A child namespace sharing the same backend. */
  namespace(domain) {
    if (typeof domain !== 'string' || domain === '' || domain.includes(':')) throw new TypeError('[StorageManager] namespace domain must be a non-empty string without ":".');
    return new StorageManager({ storage: this._storage, prefix: `${this._prefix}:${domain}` });
  }

  /** Stored schema version of this namespace (0 when never stamped). */
  getSchemaVersion() {
    const v = this.get(VERSION_KEY);
    return Number.isInteger(v) && v >= 0 ? v : 0;
  }

  /**
   * Runs migrations from the stored version up to CURRENT_SCHEMA_VERSION.
   * @param {Object<number, function(StorageManager): void>} [migrations]
   *        handler keyed by the version it migrates TO
   * @returns {number} the version after migrating
   */
  migrate(migrations = {}) {
    if (migrations === null || typeof migrations !== 'object') throw new TypeError('[StorageManager] migrate() takes an object of handlers.');
    const stored = this.getSchemaVersion();
    if (stored > CURRENT_SCHEMA_VERSION) {
      throw new Error(`[StorageManager] stored schema v${stored} is newer than this app (v${CURRENT_SCHEMA_VERSION}); refusing to downgrade.`);
    }
    for (let v = stored + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      const handler = migrations[v];
      if (typeof handler === 'function') handler(this);
      this.set(VERSION_KEY, v);
    }
    return this.getSchemaVersion();
  }

  /** Probes the backend without leaving a key behind. */
  isAvailable() {
    const probe = `${this._prefix}:__probe__`;
    try {
      this._storage.setItem(probe, '1');
      const ok = this._storage.getItem(probe) === '1';
      this._storage.removeItem(probe);
      return ok;
    } catch {
      return false;
    }
  }
}
