/**
 * leaderboardScreen.test.mjs
 *
 * Task 72 — LeaderboardScreen.js headless tests.
 *
 * Sections:
 *   1.  Guards — container, leaderboardManager, onBack, rulesets, maxRows
 *   2.  DOM structure + container isolation + return value
 *   3.  Header — title; subtitle only for a single ruleset
 *   4.  Empty state — no rulesets/data; empty ruleset section
 *   5.  Records — defaults show "—"/0; values + details after games
 *   6.  Top scores — order, rank, first-row class, meta, hands, maxRows
 *   7.  Tabs — rendered for >1 ruleset, aria-selected, switching re-renders,
 *       initialRulesetId, unknown initialRulesetId falls back
 *   8.  Rulesets derived from data when options.rulesets omitted
 *   9.  Clear — two-step confirmation, clearAll on second click, label
 *  10.  Back callback
 *  11.  Pure helpers — formatDifficulty, formatEntryDate, buildRecordRows
 *
 * Uses the same inline MinimalElement DOM mock as statisticsScreen.test.mjs.
 *
 * Run with:
 *   node tests/ui/components/leaderboardScreen.test.mjs
 */

// -------------------------------------------------------------------------
// Minimal DOM mock (no jsdom needed) — copied from statisticsScreen.test.mjs
// -------------------------------------------------------------------------

class MinimalElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this._attrs = {};
    this._children = [];
    this._listeners = {};
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.id = '';
    this.hidden = false;
    this.parentElement = null;
  }

  set innerHTML(value) {
    if (value === '') {
      for (const child of this._children) {
        child.parentElement = null;
        child._detachDescendants?.();
      }
      this._children = [];
      this._listeners = {};
    }
  }
  get innerHTML() { return ''; }

  _detachDescendants() {
    for (const child of this._children) {
      child.parentElement = null;
      child._detachDescendants();
    }
    this._children = [];
    this._listeners = {};
  }

  setAttribute(name, value) { this._attrs[name] = String(value); }
  getAttribute(name) {
    if (name in this._attrs) return this._attrs[name];
    if (name === 'id' && this.id) return this.id;
    return null;
  }

  get classList() {
    const el = this;
    return {
      add(cls) {
        const parts = el.className ? el.className.split(' ') : [];
        if (!parts.includes(cls)) {
          parts.push(cls);
          el.className = parts.join(' ');
        }
      },
      contains(cls) {
        return el.className.split(' ').filter(Boolean).includes(cls);
      },
    };
  }

  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  appendChild(child) {
    this._children.push(child);
    child.parentElement = this;
    return child;
  }

  click() {
    (this._listeners['click'] || []).forEach((fn) => fn());
  }

  querySelector(selector) { return this._queryAll(selector)[0] ?? null; }
  querySelectorAll(selector) { return this._queryAll(selector); }

  _queryAll(selector) {
    const results = [];
    const match = _buildMatcher(selector);
    this._traverse(match, results);
    return results;
  }

  _traverse(matchFn, results) {
    for (const child of this._children) {
      if (matchFn(child)) results.push(child);
      child._traverse(matchFn, results);
    }
  }
}

function _buildMatcher(selector) {
  if (selector.startsWith('.')) {
    const cls = selector.slice(1);
    return (el) => el.className.split(' ').filter(Boolean).includes(cls);
  }
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    return (el) => el.id === id || el._attrs['id'] === id;
  }
  const tag = selector.toUpperCase();
  return (el) => el.tagName === tag;
}

const MinimalDocument = {
  createElement(tag) { return new MinimalElement(tag); },
};

global.Element = MinimalElement;
global.document = MinimalDocument;

// -------------------------------------------------------------------------
// Imports
// -------------------------------------------------------------------------

import {
  renderLeaderboardScreen,
  formatDifficulty,
  formatEntryDate,
  buildRecordRows,
} from '../../../src/ui/components/LeaderboardScreen.js';
import { LeaderboardManager } from '../../../src/persistence/LeaderboardManager.js';
import { StorageManager, MemoryStorage } from '../../../src/persistence/StorageManager.js';

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

const HK = 'hong_kong';
const RIICHI = 'riichi';
const RULESETS = [
  { id: HK, label: 'Hong Kong' },
  { id: RIICHI, label: 'Riichi' },
];

function freshLeaderboard() {
  return new LeaderboardManager(new StorageManager({ storage: new MemoryStorage() }));
}
function mkContainer() { return new MinimalElement('div'); }
function game(o = {}) {
  return { score: 1000, rulesetId: HK, difficulty: 'basic', playerCount: 4, ...o };
}
const noop = () => {};
const text = (el) => el?.textContent ?? null;
const recordValue = (container, key) =>
  container.querySelectorAll('.leaderboard-screen-record-value').find((dd) => dd.getAttribute('data-record') === key);

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
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(`[${currentSection}] ${message}`); console.error(`  ✗ FAIL: ${message}`); }
}
function assertThrows(fn, expectedType, message) {
  let threw = false; let err = null;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (!threw) assert(false, `${message} — expected throw, nothing thrown`);
  else if (expectedType && !(err instanceof expectedType)) assert(false, `${message} — wrong error type: ${err?.constructor?.name}`);
  else assert(true, message);
}

// -------------------------------------------------------------------------
// 1. Guards
// -------------------------------------------------------------------------

section('Guards', () => {
  const lm = freshLeaderboard();
  assertThrows(() => renderLeaderboardScreen({}, lm, { onBack: noop }), TypeError, 'non-Element container throws');
  assertThrows(() => renderLeaderboardScreen(mkContainer(), {}, { onBack: noop }), TypeError, 'non-LeaderboardManager throws');
  assertThrows(() => renderLeaderboardScreen(mkContainer(), lm), TypeError, 'missing options throws (onBack required)');
  assertThrows(() => renderLeaderboardScreen(mkContainer(), lm, { onBack: 'x' }), TypeError, 'non-function onBack throws');
  assertThrows(() => renderLeaderboardScreen(mkContainer(), lm, { onBack: noop, rulesets: 'hk' }), TypeError, 'non-array rulesets throws');
  assertThrows(() => renderLeaderboardScreen(mkContainer(), lm, { onBack: noop, rulesets: [{ label: 'x' }] }), TypeError, 'ruleset without id throws');
  assertThrows(() => renderLeaderboardScreen(mkContainer(), lm, { onBack: noop, rulesets: [{ id: HK }, { id: HK }] }), TypeError, 'duplicate ruleset id throws');
  assertThrows(() => renderLeaderboardScreen(mkContainer(), lm, { onBack: noop, maxRows: 0 }), TypeError, 'maxRows 0 throws');
  assertThrows(() => renderLeaderboardScreen(mkContainer(), lm, { onBack: noop, maxRows: 2.5 }), TypeError, 'fractional maxRows throws');
});

// -------------------------------------------------------------------------
// 2. DOM structure
// -------------------------------------------------------------------------

section('DOM structure', () => {
  const c = mkContainer();
  c.className = 'host-slot';
  const panel = renderLeaderboardScreen(c, freshLeaderboard(), { onBack: noop, rulesets: RULESETS });
  assert(c.querySelectorAll('.leaderboard-screen').length === 1, 'one .leaderboard-screen panel inside container');
  assert(panel === c.querySelector('.leaderboard-screen'), 'returns the panel element');
  assert(c.className === 'host-slot', 'container className untouched');
  assert(c.querySelector('.leaderboard-screen-actions') !== null, 'actions container rendered');

  renderLeaderboardScreen(c, freshLeaderboard(), { onBack: noop, rulesets: RULESETS });
  assert(c.querySelectorAll('.leaderboard-screen').length === 1, 're-render replaces rather than appends');
});

// -------------------------------------------------------------------------
// 3. Header
// -------------------------------------------------------------------------

section('Header', () => {
  const c = mkContainer();
  renderLeaderboardScreen(c, freshLeaderboard(), { onBack: noop, rulesets: [{ id: HK, label: 'Hong Kong' }] });
  assert(text(c.querySelector('.leaderboard-screen-title')) === 'Leaderboard', 'title is "Leaderboard"');
  assert(c.querySelector('.leaderboard-screen-title').tagName === 'H1', 'title is an H1');
  assert(text(c.querySelector('.leaderboard-screen-subtitle')) === 'Hong Kong', 'single ruleset → subtitle names it');
  assert(c.querySelector('.leaderboard-screen-tabs') === null, 'single ruleset → no tabs');

  const c2 = mkContainer();
  renderLeaderboardScreen(c2, freshLeaderboard(), { onBack: noop, rulesets: RULESETS });
  assert(c2.querySelector('.leaderboard-screen-subtitle') === null, 'multiple rulesets → no subtitle');
});

// -------------------------------------------------------------------------
// 4. Empty states
// -------------------------------------------------------------------------

section('Empty states', () => {
  const c = mkContainer();
  renderLeaderboardScreen(c, freshLeaderboard(), { onBack: noop }); // no rulesets, no data
  assert(c.querySelector('.leaderboard-screen-empty') !== null, 'no rulesets and no data → empty message');
  assert(c.querySelector('.leaderboard-screen-section') === null, 'no sections when nothing to show');
  assert(c.querySelector('.leaderboard-screen-actions') !== null, 'actions still rendered (Back reachable)');

  const c2 = mkContainer();
  renderLeaderboardScreen(c2, freshLeaderboard(), { onBack: noop, rulesets: [{ id: HK, label: 'Hong Kong' }] });
  const empty = c2.querySelector('.leaderboard-screen-empty');
  assert(text(empty) === 'No Hong Kong games recorded yet.', 'empty ruleset → per-ruleset empty message');
  assert(c2.querySelector('.leaderboard-screen-list') === null, 'empty ruleset → no list');
  const headings = c2.querySelectorAll('.leaderboard-screen-section-heading').map(text);
  assert(headings.join('|') === 'Personal Records|Top Scores', 'both section headings still shown');
});

// -------------------------------------------------------------------------
// 5. Records
// -------------------------------------------------------------------------

section('Records', () => {
  const lm = freshLeaderboard();
  const c = mkContainer();
  renderLeaderboardScreen(c, lm, { onBack: noop, rulesets: [{ id: HK, label: 'Hong Kong' }] });
  const labels = c.querySelectorAll('.leaderboard-screen-record-label').map(text);
  assert(labels.join('|') === 'Highest Score|Fastest Win|Current Win Streak|Longest Win Streak', 'four record labels in order');
  assert(text(recordValue(c, 'highestScore').querySelector('.leaderboard-screen-record-number')) === '—', 'no highest score → "—"');
  assert(text(recordValue(c, 'fastestWin').querySelector('.leaderboard-screen-record-number')) === '—', 'no fastest win → "—"');
  assert(text(recordValue(c, 'currentWinStreak').querySelector('.leaderboard-screen-record-number')) === '0', 'current streak 0');
  assert(recordValue(c, 'highestScore').querySelector('.leaderboard-screen-record-detail') === null, 'no detail when no record');

  lm.recordGameResult(game({ score: 1500, won: true, handsPlayed: 6, playerCount: 3 }));
  lm.recordGameResult(game({ score: 900, won: true, handsPlayed: 1 }));
  renderLeaderboardScreen(c, lm, {
    onBack: noop,
    rulesets: [{ id: HK, label: 'Hong Kong' }],
    difficultyLabels: { basic: 'Basic AI' },
  });
  const hs = recordValue(c, 'highestScore');
  assert(text(hs.querySelector('.leaderboard-screen-record-number')) === '1500', 'highest score value');
  assert(text(hs.querySelector('.leaderboard-screen-record-detail')) === 'Basic AI · 3P', 'highest score detail uses difficulty label + player count');
  const fw = recordValue(c, 'fastestWin');
  assert(text(fw.querySelector('.leaderboard-screen-record-number')) === '1 hand', 'fastest win singular "1 hand"');
  assert(text(fw.querySelector('.leaderboard-screen-record-detail')) === '900 pts · Basic AI · 4P', 'fastest win detail');
  assert(text(recordValue(c, 'currentWinStreak').querySelector('.leaderboard-screen-record-number')) === '2', 'current streak 2');
  assert(text(recordValue(c, 'longestWinStreak').querySelector('.leaderboard-screen-record-number')) === '2', 'longest streak 2');
});

// -------------------------------------------------------------------------
// 6. Top scores
// -------------------------------------------------------------------------

section('Top scores', () => {
  const lm = freshLeaderboard();
  lm.recordGameResult(game({ score: 300 }));
  lm.recordGameResult(game({ score: 800, handsPlayed: 12 }));
  lm.recordGameResult(game({ score: 500, handsPlayed: 1, difficulty: 'advanced', playerCount: 3 }));
  lm.recordGameResult(game({ score: 9999, rulesetId: RIICHI }));

  const c = mkContainer();
  renderLeaderboardScreen(c, lm, { onBack: noop, rulesets: RULESETS });
  const rows = c.querySelectorAll('.leaderboard-screen-row');
  assert(rows.length === 3, 'only the selected ruleset’s entries are listed');
  assert(rows.map((r) => text(r.querySelector('.leaderboard-screen-score'))).join(',') === '800,500,300', 'rows sorted by score desc');
  assert(rows.map((r) => text(r.querySelector('.leaderboard-screen-rank'))).join(',') === '1,2,3', 'ranks 1..n');
  assert(rows[0].classList.contains('leaderboard-screen-row--first'), 'first row has --first class');
  assert(!rows[1].classList.contains('leaderboard-screen-row--first'), 'second row lacks --first class');
  assert(text(rows[0].querySelector('.leaderboard-screen-meta')) === 'Basic · 4P · 12 hands', 'meta with hands (default capitalised difficulty)');
  assert(text(rows[1].querySelector('.leaderboard-screen-meta')) === 'Advanced · 3P · 1 hand', 'meta singular hand');
  assert(text(rows[2].querySelector('.leaderboard-screen-meta')) === 'Basic · 4P', 'meta omits hands when unknown');
  const date = text(rows[0].querySelector('.leaderboard-screen-date'));
  assert(typeof date === 'string' && date !== '—' && date.length > 0, 'date rendered for a valid timestamp');
  assert(c.querySelector('.leaderboard-screen-list').tagName === 'OL', 'list is an ordered list');

  const c2 = mkContainer();
  renderLeaderboardScreen(c2, lm, { onBack: noop, rulesets: RULESETS, maxRows: 2 });
  assert(c2.querySelectorAll('.leaderboard-screen-row').length === 2, 'maxRows limits the list');
});

// -------------------------------------------------------------------------
// 7. Tabs
// -------------------------------------------------------------------------

section('Tabs', () => {
  const lm = freshLeaderboard();
  lm.recordGameResult(game({ score: 100, rulesetId: HK }));
  lm.recordGameResult(game({ score: 777, rulesetId: RIICHI }));

  const c = mkContainer();
  renderLeaderboardScreen(c, lm, { onBack: noop, rulesets: RULESETS });
  const tablist = c.querySelector('.leaderboard-screen-tabs');
  assert(tablist && tablist.getAttribute('role') === 'tablist', 'tablist rendered with role="tablist"');
  let tabs = c.querySelectorAll('.leaderboard-screen-tab');
  assert(tabs.map(text).join('|') === 'Hong Kong|Riichi', 'one tab per ruleset in caller order');
  assert(tabs.every((t) => t.getAttribute('role') === 'tab'), 'each tab has role="tab"');
  assert(tabs[0].getAttribute('aria-selected') === 'true' && tabs[1].getAttribute('aria-selected') === 'false', 'first tab selected by default');
  assert(tabs[0].classList.contains('leaderboard-screen-tab--selected'), 'selected tab has --selected class');
  assert(text(c.querySelector('.leaderboard-screen-score')) === '100', 'Hong Kong data shown initially');

  tabs[1].click();
  tabs = c.querySelectorAll('.leaderboard-screen-tab');
  assert(tabs[1].getAttribute('aria-selected') === 'true', 'clicking Riichi selects it');
  assert(text(c.querySelector('.leaderboard-screen-score')) === '777', 'Riichi data shown after switching');
  assert(c.querySelectorAll('.leaderboard-screen').length === 1, 'switching re-renders in place');

  const c2 = mkContainer();
  renderLeaderboardScreen(c2, lm, { onBack: noop, rulesets: RULESETS, initialRulesetId: RIICHI });
  assert(c2.querySelectorAll('.leaderboard-screen-tab')[1].getAttribute('aria-selected') === 'true', 'initialRulesetId honoured');

  const c3 = mkContainer();
  renderLeaderboardScreen(c3, lm, { onBack: noop, rulesets: RULESETS, initialRulesetId: 'nope' });
  assert(c3.querySelectorAll('.leaderboard-screen-tab')[0].getAttribute('aria-selected') === 'true', 'unknown initialRulesetId falls back to first');
});

// -------------------------------------------------------------------------
// 8. Rulesets derived from data
// -------------------------------------------------------------------------

section('Rulesets derived from data', () => {
  const lm = freshLeaderboard();
  lm.recordGameResult(game({ rulesetId: HK }));
  lm.addEntry(game({ rulesetId: RIICHI })); // entry-only (no records) still appears
  const c = mkContainer();
  renderLeaderboardScreen(c, lm, { onBack: noop });
  const ids = c.querySelectorAll('.leaderboard-screen-tab').map((t) => t.getAttribute('data-ruleset-id')).sort();
  assert(ids.join(',') === [HK, RIICHI].sort().join(','), 'tabs derived from entries + records');
  assert(c.querySelectorAll('.leaderboard-screen-tab').every((t) => text(t) === t.getAttribute('data-ruleset-id')), 'derived tabs labelled by raw id');
});

// -------------------------------------------------------------------------
// 9. Clear
// -------------------------------------------------------------------------

section('Clear with confirmation', () => {
  const lm = freshLeaderboard();
  lm.recordGameResult(game({ score: 400, won: true, handsPlayed: 3 }));
  lm.recordGameResult(game({ score: 200, rulesetId: RIICHI }));

  const c = mkContainer();
  renderLeaderboardScreen(c, lm, { onBack: noop, rulesets: RULESETS });
  let btn = c.querySelector('.leaderboard-screen-btn--danger');
  assert(text(btn) === 'Clear All Leaderboards', 'multi-ruleset label says "Clear All Leaderboards"');

  btn.click();
  assert(text(btn) === 'Tap again to confirm clear', 'first click asks for confirmation');
  assert(btn.classList.contains('leaderboard-screen-btn--confirm'), 'first click adds --confirm class');
  assert(lm.getEntries().length === 2, 'first click does not clear');

  btn.click();
  assert(lm.getEntries().length === 0, 'second click clears entries');
  assert(lm.getRecords(HK).highestScore === null, 'second click clears records');
  btn = c.querySelector('.leaderboard-screen-btn--danger');
  assert(text(btn) === 'Clear All Leaderboards' && !btn.classList.contains('leaderboard-screen-btn--confirm'), 're-rendered with button reset');
  assert(text(c.querySelector('.leaderboard-screen-empty')) === 'No Hong Kong games recorded yet.', 're-render shows empty state');

  const c2 = mkContainer();
  renderLeaderboardScreen(c2, lm, { onBack: noop, rulesets: [{ id: HK, label: 'Hong Kong' }] });
  assert(text(c2.querySelector('.leaderboard-screen-btn--danger')) === 'Clear Leaderboard', 'single-ruleset label says "Clear Leaderboard"');
});

// -------------------------------------------------------------------------
// 10. Back
// -------------------------------------------------------------------------

section('Back', () => {
  let calls = 0;
  const c = mkContainer();
  renderLeaderboardScreen(c, freshLeaderboard(), { onBack: () => { calls++; }, rulesets: RULESETS });
  const back = c.querySelector('.leaderboard-screen-btn--primary');
  assert(text(back) === 'Back', 'Back button text');
  back.click();
  assert(calls === 1, 'Back fires onBack once');
});

// -------------------------------------------------------------------------
// 11. Pure helpers
// -------------------------------------------------------------------------

section('Pure helpers', () => {
  assert(formatDifficulty('basic') === 'Basic', 'formatDifficulty capitalises by default');
  assert(formatDifficulty('basic', { basic: 'Easy' }) === 'Easy', 'formatDifficulty uses supplied label');
  assert(formatDifficulty('') === '—' && formatDifficulty(undefined) === '—', 'formatDifficulty "—" for missing');
  assert(formatEntryDate('not a date') === '—', 'formatEntryDate "—" for invalid');
  assert(formatEntryDate(42) === '—', 'formatEntryDate "—" for non-string');
  assert(formatEntryDate('2026-11-13T12:00:00.000Z').includes('2026'), 'formatEntryDate includes the year');

  const rows = buildRecordRows(null);
  assert(rows.length === 4 && rows[0].value === '—' && rows[2].value === '0', 'buildRecordRows tolerates null records');
  const r2 = buildRecordRows({
    highestScore: { value: -50, difficulty: 'basic', playerCount: 4 },
    fastestWin: { value: 3, score: 10, difficulty: 'basic', playerCount: 4 },
    currentWinStreak: 1,
    longestWinStreak: 4,
  });
  assert(r2[0].value === '-50', 'negative highest score shown as-is');
  assert(r2[1].value === '3 hands', 'plural hands');
  assert(r2[3].value === '4', 'longest streak value');
});

// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} assertions passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
