/**
 * LeaderboardManager.js
 *
 * Task 70: Per-ruleset leaderboard data model — stores and retrieves the top
 * game-session entries so the player can see their personal best scores over
 * time.
 *
 * Task 71: Leaderboard update logic — per-ruleset personal RECORDS (highest
 * score, fastest win, win streaks) maintained alongside the score table, plus
 * a single `recordGameResult()` entry point that updates both in one call.
 *
 * Built on top of StorageManager (Task 61).  Follows the same injection
 * pattern as SettingsManager (Task 62), SaveGameManager (Task 64), and
 * StatisticsManager (Task 67): the caller passes a root StorageManager and
 * LeaderboardManager derives a `'leaderboard'` child namespace from it.
 *
 *   const root = new StorageManager();
 *   const leaderboard = new LeaderboardManager(root);
 *
 * What it tracks (per score-table entry):
 *
 *   score        — the human player's final score for the game session (number)
 *   rulesetId    — which ruleset was played (string; one of RULESET_ID values)
 *   difficulty   — AI difficulty tier (string; one of AI_DIFFICULTY values)
 *   playerCount  — number of players in the session (number)
 *   handsPlayed  — how many hands were dealt during the session (number, optional)
 *   addedAt      — ISO 8601 timestamp when the entry was recorded (string)
 *
 * What it tracks (per-ruleset records, Task 71):
 *
 *   highestScore      — best final score in any game of this ruleset
 *                       `{ value, difficulty, playerCount, achievedAt } | null`
 *   fastestWin        — fewest hands needed to WIN a game of this ruleset
 *                       `{ value, score, difficulty, playerCount, achievedAt } | null`
 *                       (only games with a known `handsPlayed` are eligible)
 *   currentWinStreak  — consecutive won games right now (number)
 *   longestWinStreak  — best-ever consecutive won games (number)
 *
 *   These are deliberately separate from StatisticsManager's own global
 *   streak counters (Task 67): statistics are lifetime totals across every
 *   ruleset, whereas leaderboard records are per-ruleset bests — a Riichi
 *   streak shouldn't be broken by a Hong Kong loss.
 *
 * Public API:
 *
 *   recordGameResult(result)  — Task 71: THE update entry point; adds a score
 *                               entry AND updates the ruleset's records;
 *                               returns `{ entry, newRecords, records }`
 *   addEntry(entryData)       — validates + stores a score-table entry only
 *   getEntries([filter])      — all stored entries (sorted best-first),
 *                               optionally `{ rulesetId }`-filtered
 *   getTopEntries(n, [filter])— at most n top entries, optionally filtered
 *   getRecords(rulesetId)     — Task 71: the ruleset's records (defaults when none)
 *   getAllRecords()           — Task 71: records for every ruleset seen so far
 *   clearAll()                — removes all stored entries AND records
 *   getNamespace()            — returns the child StorageManager (testing)
 *
 * Storage strategy:
 *   Entries are stored as a single JSON array under the key `'entries'`, and
 *   (Task 71) records as a single JSON object keyed by rulesetId under the key
 *   `'records'`, both within the `'leaderboard'` child namespace.  Adding the
 *   `'records'` key doesn't change the format of anything Task 70 stored, so
 *   LEADERBOARD_SCHEMA_VERSION stays at 1 — a namespace without `'records'`
 *   simply reads as "no records yet".
 *
 * Sort order:
 *   Entries are sorted by `score` descending (highest first).  When two
 *   entries share the same score the one added more recently appears first
 *   (lexicographically later `addedAt` ISO string — newer entries naturally
 *   win ties without a secondary comparator).
 *
 * Capacity (Task 71 change):
 *   LEADERBOARD_MAX_ENTRIES now applies PER RULESET rather than across the
 *   whole table, so a burst of games in one ruleset can never push another
 *   ruleset's entries off the leaderboard.  For a single-ruleset table this is
 *   identical to Task 70's behaviour.
 *
 * Record tie rules:
 *   A record only changes when it is strictly beaten (higher score, fewer
 *   hands, longer streak).  Equalling a record keeps the original holder —
 *   the first player to reach a mark keeps it.
 *
 * Schema versioning:
 *   The constructor runs `this._ns.migrate({})` immediately so the
 *   `__schemaVersion__` marker is written on first use.  Future tasks that
 *   change the entry/record shape will increment LEADERBOARD_SCHEMA_VERSION
 *   and add migration handlers here.
 *
 * Key design decisions:
 *
 *   - `addEntry()`/`recordGameResult()` stamp timestamps automatically —
 *     callers never supply them.
 *   - Read accessors return defensive copies so callers cannot accidentally
 *     mutate stored data.
 *   - Required fields are validated at call time (not silently coerced) to
 *     surface integration errors during development.
 *   - Corrupt stored records (wrong types, non-object) are normalised back to
 *     safe defaults on read rather than throwing — a damaged localStorage
 *     value should never break the end-of-game flow.
 */

import { StorageManager } from './StorageManager.js';

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Schema version for the leaderboard namespace.  Bump when the data model
 *  changes and add a migration handler in the `migrate()` call below. */
export const LEADERBOARD_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of entries kept PER RULESET in the leaderboard (Task 71;
 * Task 70 applied it to the whole table).
 */
export const LEADERBOARD_MAX_ENTRIES = 20;

/** Storage key for the entries array within the leaderboard namespace. */
const ENTRIES_KEY = 'entries';

/** Storage key for the per-ruleset records object (Task 71). */
const RECORDS_KEY = 'records';

/**
 * Required fields for a leaderboard entry.
 * `addEntry()` validates that all of these are present and have the correct type.
 */
export const LEADERBOARD_ENTRY_KEYS = Object.freeze({
  SCORE:        'score',
  RULESET_ID:   'rulesetId',
  DIFFICULTY:   'difficulty',
  PLAYER_COUNT: 'playerCount',
  HANDS_PLAYED: 'handsPlayed',
  ADDED_AT:     'addedAt',
});

/**
 * Task 71: per-ruleset record identifiers.  `recordGameResult()` reports
 * which of these were newly set via its `newRecords` array.
 * (`currentWinStreak` is tracked but is never itself a "record".)
 */
export const RECORD_KEYS = Object.freeze({
  HIGHEST_SCORE:      'highestScore',
  FASTEST_WIN:        'fastestWin',
  LONGEST_WIN_STREAK: 'longestWinStreak',
});

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Validates an entry object before it is stored.
 * Throws `TypeError` on the first failed validation.
 * @param {Object} entryData — the caller-supplied entry fields
 * @param {string} [fnName] — public method name used in error messages
 */
function _assertValidEntry(entryData, fnName = 'addEntry') {
  if (entryData === null || typeof entryData !== 'object') {
    throw new TypeError(
      `[LeaderboardManager] ${fnName} requires a plain object; got ` +
      (entryData === null ? 'null' : typeof entryData) + '.'
    );
  }

  const { score, rulesetId, difficulty, playerCount } = entryData;

  if (typeof score !== 'number' || !Number.isFinite(score)) {
    throw new TypeError(
      `[LeaderboardManager] entry.score must be a finite number; got ${score}.`
    );
  }

  if (typeof rulesetId !== 'string' || rulesetId.trim() === '') {
    throw new TypeError(
      `[LeaderboardManager] entry.rulesetId must be a non-empty string; got ${JSON.stringify(rulesetId)}.`
    );
  }

  if (typeof difficulty !== 'string' || difficulty.trim() === '') {
    throw new TypeError(
      `[LeaderboardManager] entry.difficulty must be a non-empty string; got ${JSON.stringify(difficulty)}.`
    );
  }

  if (typeof playerCount !== 'number' || !Number.isInteger(playerCount) || playerCount < 2) {
    throw new TypeError(
      `[LeaderboardManager] entry.playerCount must be an integer >= 2; got ${playerCount}.`
    );
  }

  // handsPlayed is optional — but if supplied it must be a valid number.
  if (entryData.handsPlayed !== undefined) {
    const hp = entryData.handsPlayed;
    if (typeof hp !== 'number' || !Number.isInteger(hp) || hp < 0) {
      throw new TypeError(
        `[LeaderboardManager] entry.handsPlayed must be a non-negative integer when supplied; got ${hp}.`
      );
    }
  }
}

/**
 * Task 71: validates the extra outcome fields `recordGameResult()` accepts on
 * top of the regular entry fields.
 * @param {Object} result
 */
function _assertValidOutcome(result) {
  const { won, drawn } = result;
  if (won !== undefined && typeof won !== 'boolean') {
    throw new TypeError(`[LeaderboardManager] result.won must be a boolean when supplied; got ${won}.`);
  }
  if (drawn !== undefined && typeof drawn !== 'boolean') {
    throw new TypeError(`[LeaderboardManager] result.drawn must be a boolean when supplied; got ${drawn}.`);
  }
  if (won === true && drawn === true) {
    throw new TypeError('[LeaderboardManager] result cannot be both won and drawn.');
  }
}

/** Sort comparator: score descending, newer `addedAt` first on ties. */
function _compareEntries(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  // ISO strings are lexicographically comparable — later date > earlier.
  return b.addedAt < a.addedAt ? -1 : b.addedAt > a.addedAt ? 1 : 0;
}

/** @returns {{highestScore: null, fastestWin: null, currentWinStreak: number, longestWinStreak: number}} */
function _defaultRecord() {
  return {
    highestScore:     null,
    fastestWin:       null,
    currentWinStreak: 0,
    longestWinStreak: 0,
  };
}

function _isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function _isNonNegInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Normalises a possibly-corrupt stored record into a well-formed one.
 * Any field that fails its shape check falls back to its default.
 * Always returns a fresh object (safe to mutate / hand to callers).
 */
function _normalizeRecord(raw) {
  const rec = _defaultRecord();
  if (!_isPlainObject(raw)) return rec;

  const hs = raw.highestScore;
  if (_isPlainObject(hs) && typeof hs.value === 'number' && Number.isFinite(hs.value)) {
    rec.highestScore = { ...hs };
  }

  const fw = raw.fastestWin;
  if (_isPlainObject(fw) && Number.isInteger(fw.value) && fw.value >= 1) {
    rec.fastestWin = { ...fw };
  }

  if (_isNonNegInt(raw.currentWinStreak)) rec.currentWinStreak = raw.currentWinStreak;
  if (_isNonNegInt(raw.longestWinStreak)) rec.longestWinStreak = raw.longestWinStreak;
  // The longest streak can never be shorter than the current one.
  if (rec.longestWinStreak < rec.currentWinStreak) rec.longestWinStreak = rec.currentWinStreak;

  return rec;
}

/** Optional `{ rulesetId }` filter validation shared by the read accessors. */
function _assertValidFilter(filter, fnName) {
  if (filter === undefined) return;
  if (!_isPlainObject(filter)) {
    throw new TypeError(`[LeaderboardManager] ${fnName} filter must be an object when supplied.`);
  }
  if (filter.rulesetId !== undefined && (typeof filter.rulesetId !== 'string' || filter.rulesetId.trim() === '')) {
    throw new TypeError(`[LeaderboardManager] ${fnName} filter.rulesetId must be a non-empty string when supplied.`);
  }
}

// ---------------------------------------------------------------------------
// LeaderboardManager
// ---------------------------------------------------------------------------

export class LeaderboardManager {
  /**
   * @param {StorageManager} rootStorage
   *   A root StorageManager instance.  LeaderboardManager derives its own
   *   `'leaderboard'` child namespace from it.
   * @throws {TypeError} If `rootStorage` is not a StorageManager.
   */
  constructor(rootStorage) {
    if (!(rootStorage instanceof StorageManager)) {
      throw new TypeError(
        '[LeaderboardManager] constructor requires a StorageManager instance as its first argument.'
      );
    }

    /** @private — the 'leaderboard' child namespace */
    this._ns = rootStorage.namespace('leaderboard');

    // Stamp / migrate the leaderboard namespace schema version.
    this._ns.migrate(/* migrations = */ {
      // No v0→v1 data transformations needed: a fresh namespace returns null
      // for 'entries'/'records', which all accessors treat as empty.
      // Future tasks that change the entry shape will add handlers here.
    });
  }

  // -------------------------------------------------------------------------
  // Update API (Task 71)
  // -------------------------------------------------------------------------

  /**
   * Records the outcome of one finished game session: adds a score-table
   * entry (exactly as `addEntry()` would) AND updates the ruleset's
   * personal records.  This is the method the router calls at game end.
   *
   * Record update rules:
   *   - highestScore:     set when `score` strictly beats the stored value
   *                       (or none is stored yet).
   *   - fastestWin:       only when `won` is true AND `handsPlayed` is a
   *                       positive integer; set when `handsPlayed` is strictly
   *                       fewer than the stored value (or none is stored yet).
   *   - currentWinStreak: +1 on a win; reset to 0 on a loss or a draw.
   *   - longestWinStreak: raised when currentWinStreak strictly exceeds it.
   *
   * @param {Object}  result
   * @param {number}  result.score        — the human player's final score
   * @param {string}  result.rulesetId    — which ruleset was played
   * @param {string}  result.difficulty   — AI difficulty tier
   * @param {number}  result.playerCount  — number of players (>= 2)
   * @param {number}  [result.handsPlayed] — total hands dealt in the session
   * @param {boolean} [result.won=false]   — the human finished sole leader
   * @param {boolean} [result.drawn=false] — the human tied for the lead
   * @returns {{ entry: Object, newRecords: string[], records: Object }}
   *   `entry` — the stored score-table entry;
   *   `newRecords` — RECORD_KEYS values newly set by this game (may be empty);
   *   `records` — a copy of the ruleset's records after the update.
   * @throws {TypeError} On any invalid field (nothing is written in that case).
   */
  recordGameResult(result) {
    _assertValidEntry(result, 'recordGameResult');
    _assertValidOutcome(result);

    const won = result.won === true;
    const entry = this.addEntry({
      score:       result.score,
      rulesetId:   result.rulesetId,
      difficulty:  result.difficulty,
      playerCount: result.playerCount,
      ...(result.handsPlayed !== undefined ? { handsPlayed: result.handsPlayed } : {}),
    });

    const allRecords = this._loadRecords();
    const rec = _normalizeRecord(allRecords[result.rulesetId]);
    const newRecords = [];
    const achievedAt = entry.addedAt;

    // Highest score.
    if (rec.highestScore === null || result.score > rec.highestScore.value) {
      rec.highestScore = {
        value:       result.score,
        difficulty:  result.difficulty,
        playerCount: result.playerCount,
        achievedAt,
      };
      newRecords.push(RECORD_KEYS.HIGHEST_SCORE);
    }

    // Fastest win (fewest hands).  handsPlayed of 0 is meaningless for a win
    // (no hand was dealt), so a win needs at least one hand to qualify.
    const hp = result.handsPlayed;
    if (won && Number.isInteger(hp) && hp >= 1) {
      if (rec.fastestWin === null || hp < rec.fastestWin.value) {
        rec.fastestWin = {
          value:       hp,
          score:       result.score,
          difficulty:  result.difficulty,
          playerCount: result.playerCount,
          achievedAt,
        };
        newRecords.push(RECORD_KEYS.FASTEST_WIN);
      }
    }

    // Win streaks.
    if (won) {
      rec.currentWinStreak += 1;
      if (rec.currentWinStreak > rec.longestWinStreak) {
        rec.longestWinStreak = rec.currentWinStreak;
        newRecords.push(RECORD_KEYS.LONGEST_WIN_STREAK);
      }
    } else {
      rec.currentWinStreak = 0;
    }

    allRecords[result.rulesetId] = rec;
    this._ns.set(RECORDS_KEY, allRecords);

    return { entry, newRecords, records: _normalizeRecord(rec) };
  }

  // -------------------------------------------------------------------------
  // Write API
  // -------------------------------------------------------------------------

  /**
   * Records a new game session entry in the score table only (does NOT
   * touch records — use `recordGameResult()` for the full update).
   *
   * The entry is validated, stamped with the current UTC timestamp, appended
   * to the stored entries, re-sorted by score (descending), and trimmed to
   * `LEADERBOARD_MAX_ENTRIES` per ruleset.
   *
   * @param {Object} entryData
   * @param {number} entryData.score        — the human player's final score
   * @param {string} entryData.rulesetId    — which ruleset was played
   * @param {string} entryData.difficulty   — AI difficulty tier
   * @param {number} entryData.playerCount  — number of players (>= 2)
   * @param {number} [entryData.handsPlayed] — total hands dealt in the session
   * @returns {Object} The stored entry object (including `addedAt`).
   * @throws {TypeError} If any required field is missing or has the wrong type.
   */
  addEntry(entryData) {
    _assertValidEntry(entryData);

    const entry = {
      score:       entryData.score,
      rulesetId:   entryData.rulesetId,
      difficulty:  entryData.difficulty,
      playerCount: entryData.playerCount,
      addedAt:     new Date().toISOString(),
    };
    // Include optional fields only when supplied.
    if (entryData.handsPlayed !== undefined) {
      entry.handsPlayed = entryData.handsPlayed;
    }

    const existing = this._loadEntries();
    existing.push(entry);
    existing.sort(_compareEntries);

    // Trim to capacity PER RULESET (Task 71).  Walking the already-sorted
    // array and keeping the first N of each ruleset drops exactly each
    // ruleset's lowest scores while preserving the global sort order.
    const keptPerRuleset = new Map();
    const trimmed = existing.filter((e) => {
      const kept = keptPerRuleset.get(e.rulesetId) ?? 0;
      if (kept >= LEADERBOARD_MAX_ENTRIES) return false;
      keptPerRuleset.set(e.rulesetId, kept + 1);
      return true;
    });
    this._ns.set(ENTRIES_KEY, trimmed);

    return { ...entry };
  }

  // -------------------------------------------------------------------------
  // Read API
  // -------------------------------------------------------------------------

  /**
   * Returns stored leaderboard entries, sorted by score descending.
   * Returns an empty array when no entries have been recorded or after
   * `clearAll()`.
   *
   * @param {{rulesetId?: string}} [filter] — Task 71: limit to one ruleset.
   * @returns {Object[]} Defensive copies of the stored entries.
   */
  getEntries(filter) {
    _assertValidFilter(filter, 'getEntries');
    return this._loadFiltered(filter);
  }

  /**
   * Returns at most the top `n` leaderboard entries, sorted by score descending.
   *
   * @param {number} n — maximum number of entries to return; must be a
   *   positive integer.  Values greater than the number of stored entries simply
   *   return all stored entries.
   * @param {{rulesetId?: string}} [filter] — Task 71: limit to one ruleset.
   * @returns {Object[]}
   * @throws {TypeError} If `n` is not a positive integer.
   */
  getTopEntries(n, filter) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
      throw new TypeError(
        `[LeaderboardManager] getTopEntries(n) requires a positive integer; got ${n}.`
      );
    }
    _assertValidFilter(filter, 'getTopEntries');
    return this._loadFiltered(filter).slice(0, n);
  }

  /**
   * Task 71: returns the personal records for one ruleset.  A ruleset with no
   * games recorded yet returns the defaults (`null` records, 0 streaks).
   *
   * @param {string} rulesetId
   * @returns {{highestScore: Object|null, fastestWin: Object|null, currentWinStreak: number, longestWinStreak: number}}
   * @throws {TypeError} If `rulesetId` is not a non-empty string.
   */
  getRecords(rulesetId) {
    if (typeof rulesetId !== 'string' || rulesetId.trim() === '') {
      throw new TypeError(
        `[LeaderboardManager] getRecords(rulesetId) requires a non-empty string; got ${JSON.stringify(rulesetId)}.`
      );
    }
    return _normalizeRecord(this._loadRecords()[rulesetId]);
  }

  /**
   * Task 71: returns records for every ruleset that has at least one game
   * recorded, keyed by rulesetId.
   * @returns {Object<string, Object>}
   */
  getAllRecords() {
    const all = this._loadRecords();
    const out = {};
    for (const rulesetId of Object.keys(all)) {
      out[rulesetId] = _normalizeRecord(all[rulesetId]);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  /**
   * Removes all stored leaderboard entries AND (Task 71) all records.
   */
  clearAll() {
    this._ns.remove(ENTRIES_KEY);
    this._ns.remove(RECORDS_KEY);
  }

  // -------------------------------------------------------------------------
  // Diagnostics / testing
  // -------------------------------------------------------------------------

  /**
   * Returns the underlying child StorageManager namespace.
   * Intended for testing and diagnostic tooling only — production code
   * should use the public API above.
   *
   * @returns {StorageManager}
   */
  getNamespace() {
    return this._ns;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Reads and parses the stored entries array.
   * Returns an empty array when nothing is stored or the stored value is not
   * an array (e.g. corrupted data from a schema mismatch).
   * @returns {Object[]}
   * @private
   */
  _loadEntries() {
    const stored = this._ns.get(ENTRIES_KEY);
    return Array.isArray(stored) ? stored : [];
  }

  /**
   * Loaded entries, optionally filtered by rulesetId, as defensive copies.
   * @private
   */
  _loadFiltered(filter) {
    const rulesetId = filter?.rulesetId;
    return this._loadEntries()
      .filter((e) => rulesetId === undefined || e?.rulesetId === rulesetId)
      .map((e) => ({ ...e }));
  }

  /**
   * Reads the stored records object.  Returns `{}` for missing or corrupt
   * (non-plain-object) data.
   * @returns {Object<string, Object>}
   * @private
   */
  _loadRecords() {
    const stored = this._ns.get(RECORDS_KEY);
    return _isPlainObject(stored) ? stored : {};
  }
}
