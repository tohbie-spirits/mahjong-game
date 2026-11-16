/**
 * leaderboardUpdateLogic.test.mjs
 *
 * Task 71 — Leaderboard update logic (highest score, fastest win, streaks).
 *
 * Covers LeaderboardManager's Task 71 surface:
 *   1.  Exports — RECORD_KEYS frozen with the three record ids
 *   2.  getRecords — defaults for an unseen ruleset; validation
 *   3.  recordGameResult — validation (entry fields + won/drawn), nothing written on throw
 *   4.  recordGameResult — adds a score-table entry (handsPlayed passed through)
 *   5.  Highest score — first game sets it; strictly higher replaces; equal/lower keeps
 *   6.  Fastest win — wins only; needs handsPlayed >= 1; strictly fewer replaces
 *   7.  Win streaks — increments on win, resets on loss AND draw, longest kept
 *   8.  newRecords reporting — exactly the records this game set
 *   9.  Per-ruleset isolation — records and streaks never cross rulesets
 *  10.  Per-ruleset capacity — one ruleset can't push another off the table
 *  11.  getEntries / getTopEntries rulesetId filter + filter validation
 *  12.  getAllRecords + defensive copies
 *  13.  Corrupt stored records — normalised to safe defaults
 *  14.  clearAll removes records too; persistence across re-construction
 *
 * Run with:
 *   node tests/persistence/leaderboardUpdateLogic.test.mjs
 */

import {
  LeaderboardManager,
  LEADERBOARD_MAX_ENTRIES,
  RECORD_KEYS,
} from '../../src/persistence/LeaderboardManager.js';
import { StorageManager, MemoryStorage } from '../../src/persistence/StorageManager.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function freshManager() {
  return new LeaderboardManager(new StorageManager({ storage: new MemoryStorage() }));
}

const HK = 'hong_kong';
const RIICHI = 'riichi';

/** A minimal valid recordGameResult() payload. */
function game(overrides = {}) {
  return {
    score: 1000,
    rulesetId: HK,
    difficulty: 'basic',
    playerCount: 4,
    ...overrides,
  };
}

let passed = 0;
let failed = 0;
const failures = [];
let currentSection = '';

function section(name, fn) {
  currentSection = name;
  console.log(`\n▸ ${name}`);
  return fn();
}

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    failures.push(`[${currentSection}] ${message}`);
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertThrows(fn, expectedType, message) {
  let thrownError = null;
  let threw = false;
  try { fn(); } catch (e) { threw = true; thrownError = e; }
  if (!threw) assert(false, `${message} — expected throw, nothing thrown`);
  else if (expectedType && !(thrownError instanceof expectedType)) {
    assert(false, `${message} — wrong error type: ${thrownError?.constructor?.name}`);
  } else assert(true, message);
}

// ---------------------------------------------------------------------------
// 1. Exports
// ---------------------------------------------------------------------------

section('Exports', () => {
  assert(Object.isFrozen(RECORD_KEYS), 'RECORD_KEYS is frozen');
  assert(RECORD_KEYS.HIGHEST_SCORE === 'highestScore', 'HIGHEST_SCORE = highestScore');
  assert(RECORD_KEYS.FASTEST_WIN === 'fastestWin', 'FASTEST_WIN = fastestWin');
  assert(RECORD_KEYS.LONGEST_WIN_STREAK === 'longestWinStreak', 'LONGEST_WIN_STREAK = longestWinStreak');
  assert(typeof LeaderboardManager.prototype.recordGameResult === 'function', 'recordGameResult is a method');
});

// ---------------------------------------------------------------------------
// 2. getRecords defaults + validation
// ---------------------------------------------------------------------------

section('getRecords — defaults and validation', () => {
  const lm = freshManager();
  const rec = lm.getRecords(HK);
  assert(rec.highestScore === null, 'highestScore defaults to null');
  assert(rec.fastestWin === null, 'fastestWin defaults to null');
  assert(rec.currentWinStreak === 0, 'currentWinStreak defaults to 0');
  assert(rec.longestWinStreak === 0, 'longestWinStreak defaults to 0');
  assertThrows(() => lm.getRecords(''), TypeError, 'throws for empty rulesetId');
  assertThrows(() => lm.getRecords(undefined), TypeError, 'throws for missing rulesetId');
  assertThrows(() => lm.getRecords(42), TypeError, 'throws for non-string rulesetId');
});

// ---------------------------------------------------------------------------
// 3. recordGameResult validation
// ---------------------------------------------------------------------------

section('recordGameResult — validation', () => {
  const lm = freshManager();
  assertThrows(() => lm.recordGameResult(null), TypeError, 'throws for null');
  assertThrows(() => lm.recordGameResult('x'), TypeError, 'throws for a string');
  assertThrows(() => lm.recordGameResult(game({ score: NaN })), TypeError, 'throws for NaN score');
  assertThrows(() => lm.recordGameResult(game({ rulesetId: '' })), TypeError, 'throws for empty rulesetId');
  assertThrows(() => lm.recordGameResult(game({ difficulty: undefined })), TypeError, 'throws for missing difficulty');
  assertThrows(() => lm.recordGameResult(game({ playerCount: 1 })), TypeError, 'throws for playerCount 1');
  assertThrows(() => lm.recordGameResult(game({ handsPlayed: 2.5 })), TypeError, 'throws for fractional handsPlayed');
  assertThrows(() => lm.recordGameResult(game({ won: 'yes' })), TypeError, 'throws for non-boolean won');
  assertThrows(() => lm.recordGameResult(game({ drawn: 1 })), TypeError, 'throws for non-boolean drawn');
  assertThrows(() => lm.recordGameResult(game({ won: true, drawn: true })), TypeError, 'throws when both won and drawn');

  // Error message names the right method.
  let msg = '';
  try { lm.recordGameResult(null); } catch (e) { msg = e.message; }
  assert(msg.includes('recordGameResult'), 'error message names recordGameResult');

  assert(lm.getEntries().length === 0, 'no entry written by any failed call');
  assert(lm.getRecords(HK).highestScore === null, 'no record written by any failed call');
});

// ---------------------------------------------------------------------------
// 4. recordGameResult adds a score-table entry
// ---------------------------------------------------------------------------

section('recordGameResult — score-table entry', () => {
  const lm = freshManager();
  const { entry } = lm.recordGameResult(game({ score: 500, handsPlayed: 8, won: true }));
  assert(entry.score === 500, 'returned entry has the score');
  assert(entry.handsPlayed === 8, 'returned entry carries handsPlayed');
  assert(typeof entry.addedAt === 'string', 'returned entry stamped with addedAt');
  assert(!('won' in entry) && !('drawn' in entry), 'outcome flags are not stored on the entry');
  const entries = lm.getEntries();
  assert(entries.length === 1 && entries[0].score === 500, 'entry is persisted');

  const { entry: e2 } = lm.recordGameResult(game({ score: 100 }));
  assert(!('handsPlayed' in e2), 'handsPlayed omitted when not supplied');
});

// ---------------------------------------------------------------------------
// 5. Highest score
// ---------------------------------------------------------------------------

section('Highest score', () => {
  const lm = freshManager();
  let r = lm.recordGameResult(game({ score: -200, difficulty: 'basic', playerCount: 3 }));
  assert(r.records.highestScore.value === -200, 'first game sets highest score even if negative');
  assert(r.records.highestScore.difficulty === 'basic', 'record stores difficulty');
  assert(r.records.highestScore.playerCount === 3, 'record stores playerCount');
  assert(r.records.highestScore.achievedAt === r.entry.addedAt, 'achievedAt matches the entry timestamp');

  r = lm.recordGameResult(game({ score: 300 }));
  assert(r.records.highestScore.value === 300, 'strictly higher score replaces the record');

  const holder = r.records.highestScore.achievedAt;
  r = lm.recordGameResult(game({ score: 300, difficulty: 'advanced' }));
  assert(r.records.highestScore.achievedAt === holder, 'equal score keeps the original holder');
  assert(r.records.highestScore.difficulty === 'basic', 'equal score does not overwrite difficulty');

  r = lm.recordGameResult(game({ score: 50 }));
  assert(r.records.highestScore.value === 300, 'lower score leaves the record unchanged');
  assert(lm.getRecords(HK).highestScore.value === 300, 'record persisted');
});

// ---------------------------------------------------------------------------
// 6. Fastest win
// ---------------------------------------------------------------------------

section('Fastest win', () => {
  const lm = freshManager();
  let r = lm.recordGameResult(game({ handsPlayed: 4, won: false }));
  assert(r.records.fastestWin === null, 'a loss never sets fastest win');

  r = lm.recordGameResult(game({ handsPlayed: 4, drawn: true }));
  assert(r.records.fastestWin === null, 'a drawn game never sets fastest win');

  r = lm.recordGameResult(game({ won: true }));
  assert(r.records.fastestWin === null, 'a win with unknown handsPlayed is not eligible');

  r = lm.recordGameResult(game({ won: true, handsPlayed: 0 }));
  assert(r.records.fastestWin === null, 'a win with handsPlayed 0 is not eligible');

  r = lm.recordGameResult(game({ won: true, handsPlayed: 10, score: 900, playerCount: 3 }));
  assert(r.records.fastestWin?.value === 10, 'first eligible win sets fastest win');
  assert(r.records.fastestWin.score === 900, 'fastest win stores the game score');
  assert(r.records.fastestWin.playerCount === 3, 'fastest win stores playerCount');

  r = lm.recordGameResult(game({ won: true, handsPlayed: 12 }));
  assert(r.records.fastestWin.value === 10, 'slower win leaves the record');

  r = lm.recordGameResult(game({ won: true, handsPlayed: 10, score: 1 }));
  assert(r.records.fastestWin.score === 900, 'equal hands keeps the original holder');

  r = lm.recordGameResult(game({ won: true, handsPlayed: 7 }));
  assert(r.records.fastestWin.value === 7, 'strictly fewer hands replaces the record');
});

// ---------------------------------------------------------------------------
// 7. Win streaks
// ---------------------------------------------------------------------------

section('Win streaks', () => {
  const lm = freshManager();
  lm.recordGameResult(game({ won: true }));
  lm.recordGameResult(game({ won: true }));
  let rec = lm.getRecords(HK);
  assert(rec.currentWinStreak === 2, 'two wins → current streak 2');
  assert(rec.longestWinStreak === 2, 'two wins → longest streak 2');

  lm.recordGameResult(game({ won: false }));
  rec = lm.getRecords(HK);
  assert(rec.currentWinStreak === 0, 'a loss resets the current streak');
  assert(rec.longestWinStreak === 2, 'a loss keeps the longest streak');

  lm.recordGameResult(game({ won: true }));
  lm.recordGameResult(game({ drawn: true }));
  rec = lm.getRecords(HK);
  assert(rec.currentWinStreak === 0, 'a drawn game also resets the current streak');

  lm.recordGameResult(game({ won: true }));
  lm.recordGameResult(game({ won: true }));
  lm.recordGameResult(game({ won: true }));
  rec = lm.getRecords(HK);
  assert(rec.currentWinStreak === 3, 'new run of three wins → current 3');
  assert(rec.longestWinStreak === 3, 'longest raised to 3 once beaten');

  lm.recordGameResult(game({}));
  assert(lm.getRecords(HK).currentWinStreak === 0, 'omitted won/drawn counts as a loss');
});

// ---------------------------------------------------------------------------
// 8. newRecords reporting
// ---------------------------------------------------------------------------

section('newRecords reporting', () => {
  const lm = freshManager();
  let r = lm.recordGameResult(game({ score: 100, won: true, handsPlayed: 8 }));
  assert(Array.isArray(r.newRecords), 'newRecords is an array');
  assert(r.newRecords.length === 3, 'first winning game sets all three records');
  assert(
    r.newRecords.includes(RECORD_KEYS.HIGHEST_SCORE) &&
    r.newRecords.includes(RECORD_KEYS.FASTEST_WIN) &&
    r.newRecords.includes(RECORD_KEYS.LONGEST_WIN_STREAK),
    'newRecords lists highestScore, fastestWin, longestWinStreak'
  );

  r = lm.recordGameResult(game({ score: 50, won: false }));
  assert(r.newRecords.length === 0, 'a worse losing game sets no records');

  r = lm.recordGameResult(game({ score: 50, won: true, handsPlayed: 9 }));
  assert(r.newRecords.length === 0, 'streak 1 after reset does not beat longest 1 — no records');

  r = lm.recordGameResult(game({ score: 60, won: true, handsPlayed: 9 }));
  assert(
    r.newRecords.length === 1 && r.newRecords[0] === RECORD_KEYS.LONGEST_WIN_STREAK,
    'only longestWinStreak reported when only the streak is beaten'
  );

  r = lm.recordGameResult(game({ score: 5000, won: false }));
  assert(
    r.newRecords.length === 1 && r.newRecords[0] === RECORD_KEYS.HIGHEST_SCORE,
    'a high-scoring loss reports only highestScore'
  );
});

// ---------------------------------------------------------------------------
// 9. Per-ruleset isolation
// ---------------------------------------------------------------------------

section('Per-ruleset isolation', () => {
  const lm = freshManager();
  lm.recordGameResult(game({ rulesetId: HK, score: 800, won: true, handsPlayed: 6 }));
  lm.recordGameResult(game({ rulesetId: HK, score: 700, won: true, handsPlayed: 6 }));
  lm.recordGameResult(game({ rulesetId: RIICHI, score: 100, won: false }));

  const hk = lm.getRecords(HK);
  const ri = lm.getRecords(RIICHI);
  assert(hk.currentWinStreak === 2, 'a Riichi loss does not break the Hong Kong streak');
  assert(hk.highestScore.value === 800, 'Hong Kong highest score unaffected by Riichi');
  assert(ri.highestScore.value === 100, 'Riichi has its own highest score');
  assert(ri.fastestWin === null, 'Riichi has no fastest win yet');
  assert(ri.currentWinStreak === 0, 'Riichi streak is 0');
  assert(lm.getRecords('chinese_official').highestScore === null, 'untouched ruleset still has defaults');
});

// ---------------------------------------------------------------------------
// 10. Per-ruleset capacity
// ---------------------------------------------------------------------------

section('Per-ruleset capacity', () => {
  const lm = freshManager();
  lm.addEntry(game({ rulesetId: RIICHI, score: 1 })); // low-scoring Riichi entry
  for (let i = 0; i < LEADERBOARD_MAX_ENTRIES + 5; i++) {
    lm.addEntry(game({ rulesetId: HK, score: 1000 + i }));
  }
  const hk = lm.getEntries({ rulesetId: HK });
  const ri = lm.getEntries({ rulesetId: RIICHI });
  assert(hk.length === LEADERBOARD_MAX_ENTRIES, `Hong Kong trimmed to ${LEADERBOARD_MAX_ENTRIES}`);
  assert(hk[hk.length - 1].score === 1005, 'Hong Kong kept its top scores (lowest kept = 1005)');
  assert(ri.length === 1, 'the low Riichi entry survives a burst of Hong Kong games');
  assert(lm.getEntries().length === LEADERBOARD_MAX_ENTRIES + 1, 'whole table = 20 HK + 1 Riichi');

  const all = lm.getEntries();
  const sorted = all.every((e, i) => i === 0 || all[i - 1].score >= e.score);
  assert(sorted, 'unfiltered table stays globally sorted by score');
});

// ---------------------------------------------------------------------------
// 11. Filters
// ---------------------------------------------------------------------------

section('getEntries / getTopEntries filters', () => {
  const lm = freshManager();
  lm.addEntry(game({ rulesetId: HK, score: 300 }));
  lm.addEntry(game({ rulesetId: RIICHI, score: 900 }));
  lm.addEntry(game({ rulesetId: HK, score: 500 }));

  const hk = lm.getEntries({ rulesetId: HK });
  assert(hk.length === 2 && hk.every((e) => e.rulesetId === HK), 'getEntries filters by rulesetId');
  assert(hk[0].score === 500, 'filtered result stays sorted');
  assert(lm.getEntries({}).length === 3, 'empty filter returns everything');
  assert(lm.getEntries({ rulesetId: 'nope' }).length === 0, 'unknown ruleset returns []');

  const top = lm.getTopEntries(1, { rulesetId: HK });
  assert(top.length === 1 && top[0].score === 500, 'getTopEntries applies the filter before slicing');
  assert(lm.getTopEntries(1)[0].score === 900, 'getTopEntries without filter unchanged');

  assertThrows(() => lm.getEntries('hong_kong'), TypeError, 'getEntries throws for a non-object filter');
  assertThrows(() => lm.getEntries({ rulesetId: '' }), TypeError, 'getEntries throws for empty filter.rulesetId');
  assertThrows(() => lm.getTopEntries(2, []), TypeError, 'getTopEntries throws for an array filter');
});

// ---------------------------------------------------------------------------
// 12. getAllRecords + defensive copies
// ---------------------------------------------------------------------------

section('getAllRecords and defensive copies', () => {
  const lm = freshManager();
  assert(Object.keys(lm.getAllRecords()).length === 0, 'getAllRecords is {} before any game');

  lm.recordGameResult(game({ rulesetId: HK, score: 400, won: true, handsPlayed: 5 }));
  lm.recordGameResult(game({ rulesetId: RIICHI, score: 200 }));
  const all = lm.getAllRecords();
  assert(Object.keys(all).sort().join(',') === [HK, RIICHI].sort().join(','), 'getAllRecords keyed by played rulesets');
  assert(all[HK].highestScore.value === 400, 'getAllRecords carries record values');

  all[HK].highestScore.value = 999999;
  all[HK].currentWinStreak = 50;
  assert(lm.getRecords(HK).highestScore.value === 400, 'mutating getAllRecords result does not affect storage');

  const rec = lm.getRecords(HK);
  rec.fastestWin.value = 1;
  assert(lm.getRecords(HK).fastestWin.value === 5, 'mutating getRecords result does not affect storage');

  const r = lm.recordGameResult(game({ rulesetId: HK, score: 1 }));
  r.records.highestScore.value = -1;
  assert(lm.getRecords(HK).highestScore.value === 400, 'mutating returned records does not affect storage');

  const entries = lm.getEntries();
  entries[0].score = -5;
  assert(lm.getEntries()[0].score !== -5, 'mutating an entry object from getEntries does not affect storage');
});

// ---------------------------------------------------------------------------
// 13. Corrupt stored records
// ---------------------------------------------------------------------------

section('Corrupt stored records are normalised', () => {
  const lm = freshManager();
  const ns = lm.getNamespace();

  ns.set('records', 'garbage');
  assert(lm.getRecords(HK).highestScore === null, 'non-object records blob → defaults');
  assert(Object.keys(lm.getAllRecords()).length === 0, 'non-object records blob → getAllRecords {}');

  ns.set('records', [1, 2, 3]);
  assert(Object.keys(lm.getAllRecords()).length === 0, 'array records blob → getAllRecords {}');

  ns.set('records', {
    [HK]: {
      highestScore: { value: 'lots' },
      fastestWin: { value: 0 },
      currentWinStreak: -3,
      longestWinStreak: 1.5,
    },
  });
  let rec = lm.getRecords(HK);
  assert(rec.highestScore === null, 'non-numeric highestScore.value → null');
  assert(rec.fastestWin === null, 'fastestWin.value < 1 → null');
  assert(rec.currentWinStreak === 0, 'negative streak → 0');
  assert(rec.longestWinStreak === 0, 'fractional longest streak → 0');

  ns.set('records', { [HK]: { currentWinStreak: 4, longestWinStreak: 2 } });
  rec = lm.getRecords(HK);
  assert(rec.longestWinStreak === 4, 'longest streak raised to at least current streak');

  // Updating on top of corrupt data recovers cleanly.
  ns.set('records', { [HK]: 'broken' });
  const r = lm.recordGameResult(game({ score: 10, won: true, handsPlayed: 3 }));
  assert(r.records.highestScore.value === 10 && r.records.currentWinStreak === 1, 'recordGameResult recovers from a corrupt ruleset record');
});

// ---------------------------------------------------------------------------
// 14. clearAll + persistence
// ---------------------------------------------------------------------------

section('clearAll and persistence', () => {
  const mem = new MemoryStorage();
  const lm1 = new LeaderboardManager(new StorageManager({ storage: mem }));
  lm1.recordGameResult(game({ score: 700, won: true, handsPlayed: 6 }));
  lm1.recordGameResult(game({ score: 650, won: true, handsPlayed: 9 }));

  const lm2 = new LeaderboardManager(new StorageManager({ storage: mem }));
  const rec = lm2.getRecords(HK);
  assert(rec.highestScore.value === 700, 'highest score survives re-construction');
  assert(rec.fastestWin.value === 6, 'fastest win survives re-construction');
  assert(rec.currentWinStreak === 2, 'current streak survives re-construction');

  lm2.recordGameResult(game({ won: true }));
  assert(lm1.getRecords(HK).currentWinStreak === 3, 'streak continues across instances on the same storage');

  lm2.clearAll();
  assert(lm2.getEntries().length === 0, 'clearAll removes entries');
  const cleared = lm2.getRecords(HK);
  assert(cleared.highestScore === null && cleared.currentWinStreak === 0, 'clearAll removes records');
  assert(Object.keys(lm2.getAllRecords()).length === 0, 'getAllRecords is {} after clearAll');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} assertions passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
