/**
 * StatisticsManager.js
 *
 * Lifetime statistics (Task 67) in a 'statistics' child namespace. Twelve
 * numeric counters, each stored under its own key so new stats never need a
 * migration. Convenience tracking API used by main.js (Task 68).
 *
 * REBUILT (after Task 77) from the plan's Task 67 description and the
 * surviving tests (statisticsIntegration / statisticsScreen).
 */

import { StorageManager } from './StorageManager.js';

export const STATISTICS_SCHEMA_VERSION = 1;

export const STAT_KEYS = Object.freeze({
  GAMES_PLAYED: 'gamesPlayed',
  GAMES_WON: 'gamesWon',
  GAMES_LOST: 'gamesLost',
  GAMES_DRAWN: 'gamesDrawn',
  HANDS_PLAYED: 'handsPlayed',
  HANDS_WON: 'handsWon',
  TSUMO_WINS: 'tsumoWins',
  RON_WINS: 'ronWins',
  CURRENT_WIN_STREAK: 'currentWinStreak',
  LONGEST_WIN_STREAK: 'longestWinStreak',
  TOTAL_FAN_EARNED: 'totalFanEarned',
  HIGHEST_FAN_HAND: 'highestFanHand',
});

export const WIN_TYPE = Object.freeze({ TSUMO: 'tsumo', RON: 'ron' });

const ALL = Object.values(STAT_KEYS);

export class StatisticsManager {
  /** @param {StorageManager} rootStorage */
  constructor(rootStorage) {
    if (!(rootStorage instanceof StorageManager)) throw new TypeError('[StatisticsManager] constructor requires a StorageManager instance.');
    this._ns = rootStorage.namespace('statistics');
    this._ns.migrate({});
  }

  /** @private */
  _assertKey(key) {
    if (!ALL.includes(key)) throw new TypeError(`[StatisticsManager] unknown stat: ${key}`);
  }

  getStat(key) {
    this._assertKey(key);
    const v = this._ns.get(key);
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  }

  getAll() {
    return Object.fromEntries(ALL.map((k) => [k, this.getStat(k)]));
  }

  incrementStat(key, amount = 1) {
    this._assertKey(key);
    if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new TypeError('[StatisticsManager] amount must be a finite number.');
    const next = Math.max(0, this.getStat(key) + amount);
    this._ns.set(key, next);
    return next;
  }

  setStat(key, value) {
    this._assertKey(key);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError('[StatisticsManager] value must be a non-negative finite number.');
    return this._ns.set(key, value);
  }

  resetAll() {
    for (const k of ALL) this._ns.remove(k);
  }

  recordHandPlayed() {
    return this.incrementStat(STAT_KEYS.HANDS_PLAYED);
  }

  /** @param {{ winType?: string, fan?: number }} [data] */
  recordHandWin({ winType, fan } = {}) {
    this.incrementStat(STAT_KEYS.HANDS_WON);
    if (winType === WIN_TYPE.TSUMO) this.incrementStat(STAT_KEYS.TSUMO_WINS);
    else if (winType === WIN_TYPE.RON) this.incrementStat(STAT_KEYS.RON_WINS);
    if (typeof fan === 'number' && Number.isFinite(fan) && fan >= 0) {
      this.incrementStat(STAT_KEYS.TOTAL_FAN_EARNED, fan);
      if (fan > this.getStat(STAT_KEYS.HIGHEST_FAN_HAND)) this.setStat(STAT_KEYS.HIGHEST_FAN_HAND, fan);
    }
  }

  /** @param {{ won?: boolean, drawn?: boolean }} [data] */
  recordGameResult({ won = false, drawn = false } = {}) {
    this.incrementStat(STAT_KEYS.GAMES_PLAYED);
    if (won) {
      this.incrementStat(STAT_KEYS.GAMES_WON);
      const streak = this.incrementStat(STAT_KEYS.CURRENT_WIN_STREAK);
      if (streak > this.getStat(STAT_KEYS.LONGEST_WIN_STREAK)) this.setStat(STAT_KEYS.LONGEST_WIN_STREAK, streak);
    } else {
      this.incrementStat(drawn ? STAT_KEYS.GAMES_DRAWN : STAT_KEYS.GAMES_LOST);
      this.setStat(STAT_KEYS.CURRENT_WIN_STREAK, 0);
    }
  }

  getNamespace() { return this._ns; }
}
