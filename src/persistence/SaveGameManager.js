/**
 * SaveGameManager.js
 *
 * Single-slot mid-game save (Task 64) in a 'savegame' child namespace. Pure
 * persistence: validates the snapshot's anchor fields, stamps schemaVersion
 * and savedAt on a SHALLOW COPY, and refuses to load newer-schema or
 * structurally broken saves.
 *
 * REBUILT (after Task 77) from the plan's Task 64 description.
 */

import { StorageManager } from './StorageManager.js';

export const SAVEGAME_SCHEMA_VERSION = 1;

const SLOT_KEY = 'slot';

function _isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function _hasAnchors(snap) {
  return _isPlainObject(snap) &&
    typeof snap.rulesetId === 'string' && snap.rulesetId !== '' &&
    Array.isArray(snap.playerConfigs) && snap.playerConfigs.length > 0;
}

export class SaveGameManager {
  /** @param {StorageManager} rootStorage */
  constructor(rootStorage) {
    if (!(rootStorage instanceof StorageManager)) throw new TypeError('[SaveGameManager] constructor requires a StorageManager instance.');
    this._ns = rootStorage.namespace('savegame');
    this._ns.migrate({});
  }

  /**
   * @param {Object} snapshot  must have a non-empty `rulesetId` and `playerConfigs`
   * @returns {boolean}
   */
  save(snapshot) {
    if (!_hasAnchors(snapshot)) {
      throw new TypeError('[SaveGameManager] save() needs a plain object with a non-empty rulesetId string and a non-empty playerConfigs array.');
    }
    const copy = { ...snapshot, schemaVersion: SAVEGAME_SCHEMA_VERSION, savedAt: new Date().toISOString() };
    return this._ns.set(SLOT_KEY, copy);
  }

  /** @returns {Object|null} */
  load() {
    const snap = this._ns.get(SLOT_KEY);
    if (!_hasAnchors(snap)) return null;
    const version = Number.isInteger(snap.schemaVersion) ? snap.schemaVersion : 0;
    if (version > SAVEGAME_SCHEMA_VERSION) return null;
    return snap;
  }

  hasSave() {
    return this._ns.get(SLOT_KEY) !== null;
  }

  clear() {
    this._ns.remove(SLOT_KEY);
    return true;
  }

  getNamespace() { return this._ns; }
}
