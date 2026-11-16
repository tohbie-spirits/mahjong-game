/**
 * statisticsScreen.test.mjs
 *
 * Task 69 — StatisticsScreen.js headless tests.
 *
 * Tests:
 *   1. Guard — invalid container throws TypeError
 *   2. Guard — invalid statisticsManager throws TypeError
 *   3. Guard — missing onBack throws TypeError
 *   4. DOM structure — .statistics-screen card created inside container
 *   5. Container isolation — container's className is NOT modified
 *   6. Header — h1.statistics-screen-title with text "Statistics"
 *   7. Sections — four .statistics-screen-section elements rendered
 *   8. Section headings — "Games", "Hands", "Streaks", "Fan Records"
 *   9. Stat values — zero stats render as "0"
 *  10. Win rate — displays "—" when gamesPlayed is 0
 *  11. Win rate — displays formatted percentage when gamesPlayed > 0
 *  12. Win rate — rounds correctly (50%)
 *  13. Stat values — non-zero stats render correctly after recording
 *  14. Actions — .statistics-screen-actions present
 *  15. Back button — rendered, text "Back", primary class
 *  16. Back callback — fired when Back button clicked
 *  17. Reset button — rendered, text "Reset Statistics", danger class
 *  18. Reset confirmation — first click changes text, adds --confirm class
 *  19. Reset confirmation — second click calls resetAll() and re-renders
 *  20. Reset confirmation — single click does NOT call resetAll()
 *  21. Re-render — subsequent renderStatisticsScreen call replaces content
 *  22. Leaderboard button (Task 72) — absent without onLeaderboard, present
 *      with it (text, --secondary class, order before Back), click fires
 *      callback, survives a Reset re-render
 *
 * Uses an inline minimal DOM mock rather than jsdom, so the test runs
 * under plain `node` with no additional packages.
 *
 * Run with:
 *   node tests/ui/components/statisticsScreen.test.mjs
 */

// -------------------------------------------------------------------------
// Minimal DOM mock (no jsdom needed)
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

import { renderStatisticsScreen } from '../../../src/ui/components/StatisticsScreen.js';
import { StatisticsManager } from '../../../src/persistence/StatisticsManager.js';
import { StorageManager, MemoryStorage } from '../../../src/persistence/StorageManager.js';

// -------------------------------------------------------------------------
// Test helpers
// -------------------------------------------------------------------------

/** Returns a fresh StatisticsManager backed by in-memory storage. */
function freshStats() {
  const storage = new StorageManager({ storage: new MemoryStorage() });
  return new StatisticsManager(storage);
}

/** Returns a fresh MinimalElement to use as container. */
function mkContainer() {
  return new MinimalElement('div');
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
    const full = `[${currentSection}] ${message}`;
    failures.push(full);
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertThrows(fn, expectedType, message) {
  let threw = false;
  let thrownError = null;
  try { fn(); } catch (e) { threw = true; thrownError = e; }
  if (!threw) {
    assert(false, `${message} — expected throw, nothing thrown`);
  } else if (expectedType && !(thrownError instanceof expectedType)) {
    assert(false, `${message} — wrong error type: ${thrownError?.constructor?.name}`);
  } else {
    assert(true, message);
  }
}

// -------------------------------------------------------------------------
// 1. Guards
// -------------------------------------------------------------------------

section('Guards', () => {
  const stats = freshStats();
  const container = mkContainer();
  const onBack = () => {};

  // 1. invalid container
  assertThrows(
    () => renderStatisticsScreen({}, stats, { onBack }),
    TypeError,
    'throws TypeError for non-Element container'
  );

  // 2. invalid statisticsManager
  assertThrows(
    () => renderStatisticsScreen(container, {}, { onBack }),
    TypeError,
    'throws TypeError for non-StatisticsManager statisticsManager'
  );

  // 3. missing onBack
  assertThrows(
    () => renderStatisticsScreen(container, stats, {}),
    TypeError,
    'throws TypeError when onBack is missing'
  );
});

// -------------------------------------------------------------------------
// 2. DOM structure
// -------------------------------------------------------------------------

section('DOM structure', () => {
  const stats = freshStats();
  const container = mkContainer();
  container.className = 'my-container';
  renderStatisticsScreen(container, stats, { onBack: () => {} });

  // 4. .statistics-screen panel inside container
  const panel = container.querySelector('.statistics-screen');
  assert(panel !== null, '.statistics-screen card is rendered inside container');

  // 5. container.className is NOT modified
  assert(container.className === 'my-container', 'container.className is not modified');
});

// -------------------------------------------------------------------------
// 3. Header
// -------------------------------------------------------------------------

section('Header', () => {
  const stats = freshStats();
  const container = mkContainer();
  renderStatisticsScreen(container, stats, { onBack: () => {} });

  const title = container.querySelector('.statistics-screen-title');

  // 6. h1 with text "Statistics"
  assert(title !== null, '.statistics-screen-title element exists');
  assert(title?.tagName === 'H1', '.statistics-screen-title is an H1');
  assert(title?.textContent === 'Statistics', '.statistics-screen-title text is "Statistics"');
});

// -------------------------------------------------------------------------
// 4. Stat sections
// -------------------------------------------------------------------------

section('Stat sections', () => {
  const stats = freshStats();
  const container = mkContainer();
  renderStatisticsScreen(container, stats, { onBack: () => {} });

  const sections = container.querySelectorAll('.statistics-screen-section');

  // 7. exactly four sections
  assert(sections.length === 4, 'four .statistics-screen-section elements rendered');

  // 8. section headings
  const headings = container.querySelectorAll('.statistics-screen-section-heading');
  const headingTexts = headings.map((h) => h.textContent);
  assert(headingTexts.includes('Games'),      'Games section heading present');
  assert(headingTexts.includes('Hands'),      'Hands section heading present');
  assert(headingTexts.includes('Streaks'),    'Streaks section heading present');
  assert(headingTexts.includes('Fan Records'), 'Fan Records section heading present');
});

// -------------------------------------------------------------------------
// 5. Stat values
// -------------------------------------------------------------------------

section('Stat values', () => {
  const stats = freshStats();
  const container = mkContainer();
  renderStatisticsScreen(container, stats, { onBack: () => {} });

  const values = container.querySelectorAll('.statistics-screen-value');

  // 9. zero stats render as "0"
  //    There are 13 value cells: 5 (Games) + 4 (Hands) + 2 (Streaks) + 2 (Fan) = 13
  //    but the Win Rate cell shows "—" not "0". So 12 cells show "0", 1 shows "—".
  const zeroValues = values.filter((v) => v.textContent === '0');
  assert(zeroValues.length === 12, '12 stat value cells show "0" for a fresh install');

  // 10. win rate — "—" when gamesPlayed is 0
  const dashValues = values.filter((v) => v.textContent === '—');
  assert(dashValues.length === 1, 'win rate shows "—" when gamesPlayed is 0');
});

section('Win rate calculation', () => {
  // 11. 25% win rate (1 of 4)
  {
    const stats = freshStats();
    stats.recordGameResult({ won: true });
    stats.recordGameResult({ won: false, drawn: false });
    stats.recordGameResult({ won: false, drawn: false });
    stats.recordGameResult({ won: false, drawn: false });
    const container = mkContainer();
    renderStatisticsScreen(container, stats, { onBack: () => {} });
    const winRateCell = container.querySelectorAll('.statistics-screen-value').find(
      (v) => v.textContent.endsWith('%')
    );
    assert(winRateCell?.textContent === '25.0%', 'win rate is 25.0% (1 of 4)');
  }

  // 12. 50% win rate — 1 win, 1 loss
  {
    const stats = freshStats();
    stats.recordGameResult({ won: true });
    stats.recordGameResult({ won: false, drawn: false });
    const container = mkContainer();
    renderStatisticsScreen(container, stats, { onBack: () => {} });
    const winRateCell = container.querySelectorAll('.statistics-screen-value').find(
      (v) => v.textContent.endsWith('%')
    );
    assert(winRateCell?.textContent === '50.0%', 'win rate is 50.0% (1 of 2)');
  }

  // 13. non-zero stat values render correctly
  {
    const stats = freshStats();
    stats.recordHandPlayed();
    stats.recordHandPlayed();
    stats.recordHandWin({ winType: 'tsumo', fan: 3 });
    const container = mkContainer();
    renderStatisticsScreen(container, stats, { onBack: () => {} });
    const allValues = container.querySelectorAll('.statistics-screen-value').map((v) => v.textContent);
    assert(allValues.includes('2'), 'handsPlayed = 2 shown in values');
    assert(allValues.includes('1'), 'handsWon = 1 shown in values');
    assert(allValues.includes('3'), 'totalFanEarned = 3 shown in values');
  }
});

// -------------------------------------------------------------------------
// 6. Action buttons
// -------------------------------------------------------------------------

section('Actions', () => {
  const stats = freshStats();
  const container = mkContainer();
  let backCalled = false;
  renderStatisticsScreen(container, stats, { onBack: () => { backCalled = true; } });

  // 14. actions container exists
  const actions = container.querySelector('.statistics-screen-actions');
  assert(actions !== null, '.statistics-screen-actions is rendered');

  // 15. Back button — rendered with correct text and primary class
  const buttons = container.querySelectorAll('.statistics-screen-btn');
  const backBtn = buttons.find((b) => b.textContent === 'Back');
  assert(backBtn !== null, 'Back button rendered');
  assert(
    backBtn?.className.split(' ').includes('statistics-screen-btn--primary'),
    'Back button has --primary class'
  );

  // 16. Back callback fires
  backBtn?.click();
  assert(backCalled, 'onBack callback fired when Back is clicked');

  // 17. Reset button — rendered with correct text and danger class
  const resetBtn = buttons.find((b) => b.textContent === 'Reset Statistics');
  assert(resetBtn !== null, 'Reset Statistics button rendered');
  assert(
    resetBtn?.className.split(' ').includes('statistics-screen-btn--danger'),
    'Reset button has --danger class'
  );
});

// -------------------------------------------------------------------------
// 7. Reset confirmation flow
// -------------------------------------------------------------------------

section('Reset confirmation', () => {
  // 18. First click changes text and adds --confirm class
  {
    const stats = freshStats();
    const container = mkContainer();
    renderStatisticsScreen(container, stats, { onBack: () => {} });

    const buttons = container.querySelectorAll('.statistics-screen-btn');
    const resetBtn = buttons.find((b) => b.textContent === 'Reset Statistics');

    resetBtn?.click(); // first click

    assert(
      resetBtn?.textContent === 'Tap again to confirm reset',
      'first click changes Reset button text to confirmation prompt'
    );
    assert(
      resetBtn?.className.split(' ').includes('statistics-screen-btn--confirm'),
      'first click adds --confirm class to Reset button'
    );
  }

  // 19. Second click calls resetAll() and re-renders
  {
    const stats = freshStats();
    stats.recordHandPlayed();
    stats.recordHandPlayed();
    // Confirm handsPlayed is non-zero before we start
    const container = mkContainer();
    renderStatisticsScreen(container, stats, { onBack: () => {} });

    const buttons = container.querySelectorAll('.statistics-screen-btn');
    const resetBtn = buttons.find((b) => b.textContent === 'Reset Statistics');

    resetBtn?.click(); // first click (confirmation)
    resetBtn?.click(); // second click (confirm reset)

    // After re-render, all values should be "0" again
    const valuesAfterReset = container.querySelectorAll('.statistics-screen-value');
    const zeroCount = valuesAfterReset.filter((v) => v.textContent === '0').length;
    assert(
      zeroCount === 12,
      'after confirmed reset all 12 stat values return to "0"'
    );

    // And the Reset button text should be back to the default
    const newButtons = container.querySelectorAll('.statistics-screen-btn');
    const newResetBtn = newButtons.find((b) => b.textContent === 'Reset Statistics');
    assert(newResetBtn !== null, 'after re-render Reset button shows default text again');
  }

  // 20. Single click does NOT reset
  {
    const stats = freshStats();
    stats.recordHandPlayed();
    const container = mkContainer();
    renderStatisticsScreen(container, stats, { onBack: () => {} });

    const buttons = container.querySelectorAll('.statistics-screen-btn');
    const resetBtn = buttons.find((b) => b.textContent === 'Reset Statistics');

    resetBtn?.click(); // only one click

    // Stats object should still have handsPlayed = 1
    // (re-render hasn't happened — container still has original panel)
    // We verify via a fresh render into a sibling container
    const checkContainer = mkContainer();
    renderStatisticsScreen(checkContainer, stats, { onBack: () => {} });
    const checkValues = checkContainer.querySelectorAll('.statistics-screen-value');
    const hasOne = checkValues.some((v) => v.textContent === '1');
    assert(hasOne, 'single click does not reset statistics');
  }
});

// -------------------------------------------------------------------------
// 8. Re-render
// -------------------------------------------------------------------------

section('Re-render', () => {
  // 21. Second call replaces previous content
  const stats = freshStats();
  const container = mkContainer();
  renderStatisticsScreen(container, stats, { onBack: () => {} });
  const firstChild = container._children[0];

  renderStatisticsScreen(container, stats, { onBack: () => {} });
  const secondChild = container._children[0];

  assert(container._children.length === 1, 'only one child after re-render');
  assert(firstChild !== secondChild, 're-render replaces previous panel element');
});


// -------------------------------------------------------------------------
// 22. Leaderboard button (Task 72)
// -------------------------------------------------------------------------

section('Leaderboard button (Task 72)', () => {
  const c1 = mkContainer();
  renderStatisticsScreen(c1, freshStats(), { onBack: () => {} });
  assert(c1.querySelector('.statistics-screen-btn--secondary') === null, 'no Leaderboard button without onLeaderboard');
  assert(c1.querySelectorAll('.statistics-screen-btn').length === 2, 'still exactly two buttons without onLeaderboard');

  let calls = 0;
  const stats = freshStats();
  const c2 = mkContainer();
  renderStatisticsScreen(c2, stats, { onBack: () => {}, onLeaderboard: () => { calls++; } });
  const btn = c2.querySelector('.statistics-screen-btn--secondary');
  assert(btn !== null && btn.textContent === 'Leaderboard', 'Leaderboard button rendered with text');
  const buttons = c2.querySelectorAll('.statistics-screen-btn');
  assert(buttons.length === 3, 'three buttons with onLeaderboard');
  assert(buttons.indexOf(btn) < buttons.indexOf(c2.querySelector('.statistics-screen-btn--primary')), 'Leaderboard sits before Back');
  btn.click();
  assert(calls === 1, 'click fires onLeaderboard');

  const reset = c2.querySelector('.statistics-screen-btn--danger');
  reset.click(); reset.click();
  assert(c2.querySelector('.statistics-screen-btn--secondary') !== null, 'Leaderboard button survives a Reset re-render');
});

// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`✓ All ${passed} assertions passed.`);
} else {
  console.log(`${passed} passed, ${failed} FAILED.`);
  for (const f of failures) {
    console.error(`  ✗ ${f}`);
  }
  process.exit(1);
}
