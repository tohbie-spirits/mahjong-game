/**
 * tutorialAndReference.test.mjs — Tasks 113–114: TutorialScreen and
 * RuleReferenceScreen on the fake DOM, with the REAL Hong Kong engine judging
 * the tutorial and the REAL reference data of all three rulesets.
 *
 * Sections:
 *   1. Tutorial content — every step well formed; every engine-judged exercise is solvable by the engine and its options make sense
 *   2. Tutorial navigation — Next / Back / dots, progress callbacks, resume at a step, Next never blocked
 *   3. Tutorial exercises through the UI — name tiles, build a Chow (right + wrong + show answer), complete, discard (best / ready / not ready), quiz, can-win (engine's breakdown)
 *   4. Tutorial finish — score, callbacks; no engine → refused
 *   5. Rule Reference — tabs (aria, keyboard), sections, scoring table, glossary, example tiles
 *   6. Rule Reference — filter (counts, empty message, reset on tab change), embedded single-ruleset mode, Back
 *   7. Pause menu — the Rules button only when wired
 *
 * Run: node tests/ui/components/tutorialAndReference.test.mjs
 */
import { section, assert, assertThrows, summary } from '../../_helpers/harness.mjs';
import { installFakeDom, makeEvent } from '../../_helpers/fakeDom.mjs';

const { document, fire } = installFakeDom();
const { renderTutorialScreen } = await import('../../../src/ui/components/TutorialScreen.js');
const { TUTORIAL_STEPS, waitsOf, makeTiles, isChow, chowProblem, describeChow } = await import('../../../src/ui/tutorial/TutorialSteps.js');
const { renderRuleReferenceScreen, rowMatches } = await import('../../../src/ui/components/RuleReferenceScreen.js');
const { renderPauseMenu } = await import('../../../src/ui/components/PauseMenu.js');
const { HongKongRules } = await import('../../../src/rules/hongkong/HongKongRules.js');
const { getHongKongReference } = await import('../../../src/rules/hongkong/HongKongReference.js');
const { getRiichiReference } = await import('../../../src/rules/riichi/RiichiReference.js');
const { getChineseOfficialReference } = await import('../../../src/rules/chineseOfficial/ChineseOfficialReference.js');
const { Tile } = await import('../../../src/core/Tile.js');
const { Hand } = await import('../../../src/core/Hand.js');

const engine = new HongKongRules();
const checkHand = (hand) => engine.checkWin(hand).isWin;
const scoreHand = (hand, ctx) => engine.scoreHand(hand, ctx);
const complete = (ids) => checkHand(new Hand(makeTiles(Tile, ids)));
const host = () => { const d = document.createElement('div'); document.body.appendChild(d); return d; };
const step = (root) => root.querySelector('.tutorial-card').dataset.step;
const feedback = (root) => root.querySelector('.tutorial-feedback').textContent;
const tilesIn = (root) => root.querySelectorAll('.tutorial-tile');
const tileOf = (root, id, k = 0) => tilesIn(root).filter((t) => t.dataset.tileId === id)[k];
const clickText = (root, text) => root.querySelectorAll('button').find((b) => b.textContent === text).click();
const ex = (kind) => TUTORIAL_STEPS.find((s) => s.exercise?.kind === kind).exercise;
function tutorial(extra = {}) {
  const calls = { progress: [], finish: [], play: 0, ref: 0, exit: 0 };
  const box = host();
  const t = renderTutorialScreen(box, {
    checkHand, scoreHand,
    onProgress: (p) => calls.progress.push(p), onFinish: (p) => calls.finish.push(p),
    onPlay: () => calls.play++, onRuleReference: () => calls.ref++, onExit: () => calls.exit++, ...extra,
  });
  return { box, t, calls, goto: (id) => t.goTo(TUTORIAL_STEPS.findIndex((s) => s.id === id)) };
}

// ---------------------------------------------------------------------------
section('1. Tutorial content', () => {
  assert(TUTORIAL_STEPS.length === 9 && new Set(TUTORIAL_STEPS.map((s) => s.id)).size === 9, '9 steps, unique ids');
  assert(TUTORIAL_STEPS.every((s) => s.title && (s.paragraphs?.length ?? 0) >= 1), 'every step has a title and explanation');
  const exIds = TUTORIAL_STEPS.filter((s) => s.exercise).map((s) => s.exercise.id);
  assert(exIds.length === 6 && new Set(exIds).size === 6, `6 exercises with unique ids (${exIds})`);
  const c = ex('complete');
  const right = c.options.filter((o) => complete([...c.hand, o]));
  assert(c.hand.length === 13 && right.length === 1, `"complete": exactly one of the options completes the hand for the engine (${right})`);
  const d = ex('discard');
  const ready = d.hand.map((_, i) => waitsOf(d.hand.filter((__, j) => j !== i), complete));
  const most = Math.max(...ready.map((w) => w.length));
  assert(d.hand.length === 14 && ready.filter((w) => w.length === most).every((_, k, arr) => arr.length >= 1) && d.hand[ready.findIndex((w) => w.length === most)] === 'wind-north', 'discard: the engine agrees North is the best discard (most waits)');
  const w = ex('can-win');
  const s = scoreHand(new Hand(makeTiles(Tile, w.hand)), w.context);
  assert(complete(w.hand) && s.meetsMinimum === false && s.fan < engine.getMinimumFan(), `"can-win": complete, but ${s.fan} fan < ${engine.getMinimumFan()} for the engine — the answer is "No"`);
  const pick = ex('pick-set');
  assert(isChow(pick.answer) && !isChow(['dots-3', 'dots-4', 'dots-7']) && !isChow(['wind-south', 'wind-south', 'wind-south']) && !isChow(['dots-3', 'bamboo-4', 'dots-5']), 'isChow');
  assert(/Winds and dragons/.test(chowProblem(['wind-south', 'dots-4', 'dots-5'])) && /one suit/.test(chowProblem(['dots-3', 'bamboo-4', 'dots-5'])) && /Pung/.test(chowProblem(['dots-4', 'dots-4', 'dots-4'])) && /follow on/.test(chowProblem(['dots-3', 'dots-4', 'dots-7'])), 'chowProblem explains each kind of mistake');
  assert(describeChow(['dots-5', 'dots-3', 'dots-4']) === '3-4-5 of Dots', 'describeChow');
});

// ---------------------------------------------------------------------------
section('2. Tutorial navigation', () => {
  const { box, t, calls } = tutorial();
  assert(step(box) === 'welcome' && box.querySelector('.tutorial-progress').textContent === 'Step 1 of 9', 'starts at step 1');
  const back = box.querySelectorAll('.tutorial-nav button')[0];
  const next = box.querySelectorAll('.tutorial-nav button')[1];
  assert(back.disabled === true && next.hidden === false, 'Back disabled on the first step');
  next.click();
  assert(step(box) === 'tiles' && calls.progress.at(-1).step === 1, 'Next → step 2, progress reported');
  next.click(); next.click();
  assert(step(box) === 'winning-hand', 'Next is never blocked by an unsolved exercise');
  back.click();
  assert(step(box) === 'sets', 'Back');
  box.querySelectorAll('.tutorial-dot')[7].click();
  assert(step(box) === 'table' && box.querySelectorAll('.tutorial-dot')[7].getAttribute('aria-current') === 'step', 'the step dots jump (aria-current on the current one)');
  t.goTo(8);
  assert(next.hidden === true, 'no Next on the last step');
  t.goTo(99); t.goTo(-1);
  assert(t.current() === 8, 'out-of-range jumps are ignored');
  const resumed = tutorial({ initialStep: 4, completed: ['name-tiles'] });
  assert(step(resumed.box) === 'turn' && resumed.box.querySelectorAll('.tutorial-dot')[1].classList.contains('tutorial-dot--done'), 'resumes at a saved step, with saved exercises shown as done');
  assert(step(tutorial({ initialStep: 42 }).box) === 'done', 'a saved step past the end is clamped');
});

// ---------------------------------------------------------------------------
section('3. Tutorial exercises', () => {
  const { box, calls, goto } = tutorial();
  goto('tiles');
  tilesIn(box)[0].click();
  assert(feedback(box).startsWith('1 Dot') || feedback(box).includes('of Dots') || feedback(box).length > 3, `a tapped tile is named ("${feedback(box)}")`);
  tilesIn(box)[0].click();
  assert(/2 more/.test(feedback(box)), 'the same tile twice doesn’t count twice');
  tilesIn(box)[6].dispatchEvent(makeEvent('keydown', { key: 'Enter' }));
  tilesIn(box)[9].click();
  assert(/Well done/.test(feedback(box)) && calls.progress.at(-1).completed.includes('name-tiles'), 'three different tiles (keyboard works too) → solved, saved');

  goto('sets');
  const check = box.querySelector('.tutorial-check');
  assert(check.disabled === true, 'Check waits for three tiles');
  ['dots-3', 'bamboo-4', 'dots-5'].forEach((id) => tileOf(box, id).click());
  assert(check.disabled === false, '…then enables');
  check.click();
  assert(/one suit/.test(feedback(box)) && box.querySelector('.tutorial-feedback--wrong'), 'a mixed-suit pick is explained');
  tileOf(box, 'dots-5').click(); // unpick
  assert(check.disabled === true && tileOf(box, 'dots-5').getAttribute('aria-pressed') === 'false', 'clicking again unpicks (aria-pressed follows)');
  tileOf(box, 'bamboo-4').click(); tileOf(box, 'dots-4').click(); tileOf(box, 'dots-5').click();
  check.click();
  assert(feedback(box) === 'Yes — 3-4-5 of Dots is a Chow.' && calls.progress.at(-1).completed.includes('pick-chow'), 'a real Chow → right, solved');

  goto('winning-hand');
  tileOf(box, 'wind-east').click();
  assert(/doesn’t complete/.test(feedback(box)), 'a wrong 14th tile is refused (by the engine)');
  tileOf(box, 'characters-8').click();
  assert(/^Right/.test(feedback(box)) && /5 of Characters or 8 of Characters/.test(feedback(box)), `the right one, and every tile that would do (from the engine): "${feedback(box)}"`);

  goto('turn');
  tileOf(box, 'dots-5').click();
  assert(/aren’t ready/.test(feedback(box)), 'a discard that breaks a set → not ready');
  tileOf(box, 'bamboo-1').click();
  assert(/That works/.test(feedback(box)) && /North Wind/.test(feedback(box)) && /2 kinds/.test(feedback(box)), 'a ready discard with fewer waits → right, and the better one is named');
  tileOf(box, 'wind-north').click();
  assert(/^Best choice/.test(feedback(box)) && /1 of Bamboo or 4 of Bamboo/.test(feedback(box)), 'the best discard → its waits listed');
  clickText(box, 'Show answer');
  assert(/Discard North Wind/.test(feedback(box)), 'Show answer');

  goto('calls');
  clickText(box, 'Only a Chow');
  assert(/^Not quite/.test(feedback(box)), 'quiz: wrong answer explained');
  clickText(box, 'Either a Chow or a Pung');
  assert(/^Right/.test(feedback(box)), 'quiz: right answer');

  goto('scoring');
  clickText(box, 'Yes, it can win');
  assert(/^Not quite/.test(feedback(box)) && /All Chows 1 \+ Concealed Hand 1 = 2 fan; 3 needed/.test(feedback(box)), `can-win: the engine's own breakdown is shown ("${feedback(box)}")`);
  clickText(box, 'No, not enough');
  assert(/^Right/.test(feedback(box)), 'can-win: "No" is right');
  assert(['name-tiles', 'pick-chow', 'complete', 'discard', 'call-quiz', 'can-win'].every((id) => calls.progress.at(-1).completed.includes(id)), 'all six exercises recorded');
});

// ---------------------------------------------------------------------------
section('4. Tutorial finish', () => {
  const { box, calls, goto } = tutorial({ completed: ['complete', 'discard'] });
  goto('done');
  assert(box.querySelector('.tutorial-score').textContent === 'You solved 2 of 6 exercises.', 'the score');
  clickText(box, 'Play a practice game');
  assert(calls.play === 1 && calls.finish.length === 1 && calls.finish[0].completed.length === 2, 'Play → onFinish, then onPlay');
  clickText(box, 'Open the Rule Reference');
  box.querySelector('.tutorial-finish').querySelectorAll('button').find((b) => b.textContent === 'Back to Menu').click();
  assert(calls.ref === 1 && calls.exit >= 1 && calls.finish.length === 3, 'Rule Reference / Back to Menu also finish');
  assertThrows(() => renderTutorialScreen(host(), {}), TypeError, 'without the engine checks the tutorial refuses to render (it must not guess the rules)');
});

// ---------------------------------------------------------------------------
const REFS = [getHongKongReference(), getRiichiReference(), getChineseOfficialReference()];
section('5. Rule Reference', () => {
  const box = host();
  const picks = [];
  const r = renderRuleReferenceScreen(box, { references: REFS, initialRulesetId: 'riichi', onSelect: (id) => picks.push(id), onBack: () => picks.push('back') });
  const tabs = box.querySelectorAll('[role="tab"]');
  assert(tabs.length === 3 && box.querySelector('[role="tablist"]'), 'a tab per ruleset');
  assert(r.current() === 'riichi' && tabs[1].getAttribute('aria-selected') === 'true' && tabs[1].tabIndex === 0 && tabs[0].tabIndex === -1, 'opens on the requested ruleset; roving tabindex');
  const panel = box.querySelector('.rule-reference-panel');
  assert(panel.getAttribute('role') === 'tabpanel' && panel.getAttribute('aria-labelledby') === tabs[1].id && tabs[1].getAttribute('aria-controls') === panel.id, 'tab ↔ panel wired with ARIA');
  assert(box.querySelector('.rule-reference-ruleset').textContent.startsWith('Riichi Mahjong') && box.querySelectorAll('.rule-reference-fact').length === 4, 'header and key facts');
  const sections = box.querySelectorAll('.rule-reference-section').map((s) => s.dataset.section);
  assert(sections.includes('riichi') && sections.includes('scoring-table') && sections.at(-1) === 'glossary', `sections, the scoring table and the glossary (${sections.length})`);
  assert(box.querySelectorAll('.rule-reference-index-link').length === sections.length, 'an index link per section');
  assert(box.querySelectorAll('.rule-reference-row').length === REFS[1].scoring.groups.flatMap((g) => g.rows).length, 'every scoring row rendered');
  assert(box.querySelectorAll('.rule-reference-tiles .tile').length > 10, 'example tiles drawn');
  tabs[1].dispatchEvent(makeEvent('keydown', { key: 'ArrowRight' }));
  assert(r.current() === 'chinese_official' && picks.at(-1) === 'chinese_official', '→ moves to the next tab');
  box.querySelectorAll('[role="tab"]')[2].dispatchEvent(makeEvent('keydown', { key: 'ArrowRight' }));
  assert(r.current() === 'hong_kong', '…wrapping around');
  box.querySelectorAll('[role="tab"]')[0].dispatchEvent(makeEvent('keydown', { key: 'End' }));
  assert(r.current() === 'chinese_official', 'End → last');
  box.querySelectorAll('[role="tab"]')[0].click();
  assert(r.current() === 'hong_kong' && box.querySelectorAll('.rule-reference-row').length === REFS[0].scoring.groups.flatMap((g) => g.rows).length, 'click selects; the panel re-renders for that ruleset');
  clickText(box, 'Back to Menu');
  assert(picks.at(-1) === 'back', 'Back');
  assertThrows(() => renderRuleReferenceScreen(host(), { references: [] }), TypeError, 'no references → refused');
});

// ---------------------------------------------------------------------------
section('6. Filter, embedded', () => {
  const box = host();
  const r = renderRuleReferenceScreen(box, { references: REFS, initialRulesetId: 'chinese_official' });
  assert(box.querySelector('.rule-reference-search-count').textContent === '81 entries', '81 fans listed');
  r.search('dragon');
  const names = box.querySelectorAll('.rule-reference-row').map((x) => x.dataset.id);
  assert(names.length >= 3 && names.length < 81 && names.includes('big-three-dragons') && box.querySelector('.rule-reference-search-count').textContent === `${names.length} of 81`, `"dragon" → ${names.length} of 81 (${names})`);
  const input = box.querySelector('.rule-reference-search-input');
  input.value = '清一色'; fire(input, 'input');
  assert(box.querySelectorAll('.rule-reference-row').map((x) => x.dataset.id).join() === 'full-flush', 'typing in the box filters too — by the Chinese name as well');
  r.search('zzz');
  assert(box.querySelectorAll('.rule-reference-row').length === 0 && /Nothing matches "zzz"/.test(box.querySelector('.rule-reference-empty').textContent), 'no match → a message');
  r.select('hong_kong');
  assert((box.querySelector('.rule-reference-search-input').value ?? '') === '' && box.querySelectorAll('.rule-reference-row').length > 20, 'changing ruleset clears the filter');
  assert(rowMatches({ name: 'Pinfu', native: 'Pinfu · 平和', value: '1 han', note: '' }, '平和') && !rowMatches({ name: 'A' }, 'b') && rowMatches({ name: 'A' }, '  '), 'rowMatches');
  const emb = host();
  let back = 0;
  renderRuleReferenceScreen(emb, { references: [REFS[1]], embedded: true, onBack: () => back++ });
  assert(emb.querySelector('[role="tablist"]') === null && emb.querySelector('.rule-reference--embedded') && emb.querySelector('.rule-reference-panel').getAttribute('role') === null, 'embedded with one ruleset: no tabs, a compact card');
  assert(emb.classList.contains('rule-reference-screen') === false, 'embedded: the host (the game overlay) keeps its own class');
  clickText(emb, 'Back');
  assert(back === 1, 'embedded Back');
});

// ---------------------------------------------------------------------------
section('7. Pause menu', () => {
  const box = host();
  let rules = 0;
  renderPauseMenu(box, { onResume() {}, onRules: () => rules++, onRestart() {}, onQuit() {} });
  const labels = box.querySelectorAll('button').map((b) => b.textContent);
  assert(labels.join('|') === 'Resume|Rules|Restart Game|Quit to Menu', `buttons ${labels}`);
  clickText(box, 'Rules');
  assert(rules === 1, 'Rules calls onRules');
  const b2 = host();
  renderPauseMenu(b2, { onResume() {}, onQuit() {} });
  assert(!b2.querySelectorAll('button').some((b) => b.textContent === 'Rules'), 'no Rules button without onRules');
});

summary();
