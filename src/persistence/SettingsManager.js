/**
 * SettingsManager.js
 *
 * Persisted user settings (Task 62) in a 'settings' child namespace:
 *   theme ('dark'|'light', default dark) · volume (0–1, default 1) ·
 *   animationsEnabled (boolean, default true).
 * Task 108: sfxVolume (0–1, default 0.8) · musicVolume (0–1, default 0.35) ·
 *   muted (boolean, default false) — read by src/audio/AudioManager.js.
 *   `volume` stays the master level. Older saves simply get the defaults.
 * Task 116: hints (boolean, default true) — the in-game Hint button.
 *
 * get() re-validates on read and falls back to the default on corrupt data;
 * set() validates and throws TypeError on unknown keys or invalid values.
 *
 * REBUILT (after Task 77) from the plan's Task 62 description.
 */

import { StorageManager } from './StorageManager.js';
import { THEME } from '../utils/constants.js';

export const SETTINGS_SCHEMA_VERSION = 1;

export const SETTING_KEYS = Object.freeze({
  THEME: 'theme',
  VOLUME: 'volume',
  ANIMATIONS_ENABLED: 'animationsEnabled',
  SFX_VOLUME: 'sfxVolume',       // Task 108
  MUSIC_VOLUME: 'musicVolume',   // Task 108
  MUTED: 'muted',                // Task 108
  HINTS: 'hints',                // Task 116
});

export const DEFAULTS = Object.freeze({
  [SETTING_KEYS.THEME]: THEME.DARK,
  [SETTING_KEYS.VOLUME]: 1.0,
  [SETTING_KEYS.ANIMATIONS_ENABLED]: true,
  [SETTING_KEYS.SFX_VOLUME]: 0.8,
  [SETTING_KEYS.MUSIC_VOLUME]: 0.35,
  [SETTING_KEYS.MUTED]: false,
  [SETTING_KEYS.HINTS]: true,
});

const VALIDATORS = Object.freeze({
  [SETTING_KEYS.THEME]: (v) => Object.values(THEME).includes(v),
  [SETTING_KEYS.VOLUME]: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1,
  [SETTING_KEYS.ANIMATIONS_ENABLED]: (v) => typeof v === 'boolean',
  [SETTING_KEYS.SFX_VOLUME]: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1,
  [SETTING_KEYS.MUSIC_VOLUME]: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1,
  [SETTING_KEYS.MUTED]: (v) => typeof v === 'boolean',
  [SETTING_KEYS.HINTS]: (v) => typeof v === 'boolean',
});

export class SettingsManager {
  /** @param {StorageManager} rootStorage */
  constructor(rootStorage) {
    if (!(rootStorage instanceof StorageManager)) throw new TypeError('[SettingsManager] constructor requires a StorageManager instance.');
    this._ns = rootStorage.namespace('settings');
    this._ns.migrate({});
  }

  /** @private */
  _assertKey(key) {
    if (!Object.values(SETTING_KEYS).includes(key)) throw new TypeError(`[SettingsManager] unknown setting: ${key}`);
  }

  get(key) {
    this._assertKey(key);
    const v = this._ns.get(key);
    return VALIDATORS[key](v) ? v : DEFAULTS[key];
  }

  set(key, value) {
    this._assertKey(key);
    if (!VALIDATORS[key](value)) throw new TypeError(`[SettingsManager] invalid value for ${key}: ${JSON.stringify(value)}`);
    return this._ns.set(key, value);
  }

  reset(key) {
    this._assertKey(key);
    this._ns.remove(key);
    return DEFAULTS[key];
  }

  getAll() {
    return Object.fromEntries(Object.values(SETTING_KEYS).map((k) => [k, this.get(k)]));
  }

  resetAll() {
    for (const k of Object.values(SETTING_KEYS)) this._ns.remove(k);
  }

  getDefault(key) {
    this._assertKey(key);
    return DEFAULTS[key];
  }

  getNamespace() { return this._ns; }
}
