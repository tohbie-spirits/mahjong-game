/**
 * crossRuleset.test.mjs — Task 101: cross-ruleset regression pass.
 *
 * Hong Kong, Riichi and Chinese Official side by side through the shared
 * machinery (RuleEngineInterface, GameManager, the AI tiers, saves), to catch
 * one ruleset's changes leaking into another.
 *
 * Sections:
 *   1. The interface contract — every engine (4P and 3P), ids / labels,
 *      tile sets, terminology keys, score shapes, bad input
 *   2. Isolation — the import graph: no ruleset module imports another
 *      ruleset; core and UI import only the interface; AI reaches ruleset
 *      modules only through its adaptation helpers; only main.js wires all
 *   3. The same tiles, three engines — what each engine accepts (shared
 *      shapes agree; ruleset-specific shapes differ exactly where the rules do)
 *   4. A session per ruleset × player count — mixed Basic / Advanced seats:
 *      no errors, tiles conserved every turn, points conserved every hand,
 *      every win valid for its engine
 *   5. Interleaved — three games advanced turn by turn in one process give
 *      exactly the results each gives alone (no shared state)
 *   6. Saves — a mid-hand snapshot of each ruleset restores to the same
 *      table, actions and turn-flow state; the ruleset id picks the engine
 *
 * Run: node tests/core/crossRuleset.test.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { hand } from '../_helpers/tiles.mjs';
import { tilesConserved } from '../_helpers/aiBenchmark.mjs';
import { isValidRuleEngine } from '../../src/rules/RuleEngineInterface.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { HONG_KONG_TERMINOLOGY } from '../../src/rules/hongkong/HongKongTerminology.js';
import { generateTileSet } from '../../src/core/TileSetGenerator.js';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AdvancedStrategy } from '../../src/ai/advanced/AdvancedStrategy.js';
import { buildSnapshot, hydrateGameManager } from '../../src/persistence/GameSnapshot.js';
import { RULESET_ID, RULESET_LABEL, TURN_PHASE } from '../../src/utils/constants.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINES = {
  [RULESET_ID.HONG_KONG]: (n) => new HongKongRules(),
  [RULESET_ID.RIICHI]: (n) => new RiichiRules({ playerCount: n }),
  [RULESET_ID.CHINESE_OFFICIAL]: (n) => new ChineseOfficialRules({ playerCount: n }),
};
const IDS = Object.keys(ENGINES);
const makeRng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const factoriesFor = (rng) => ({ basic: () => new BasicStrategy({ random: rng }), advanced: () => new AdvancedStrategy({ random: rng }) });

function game(id, n, seed) {
  const cfg = buildPlayerConfigs({ playerCount: n, difficulty: 'basic', humanSeatIndex: -1 });
  cfg.forEach((c, i) => { c.aiDifficulty = i % 2 ? 'advanced' : 'basic'; });
  const rng = makeRng(seed);
  const gm = new GameManager({ ruleEngine: ENGINES[id](n), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg, { factories: factoriesFor(rng) }), eventBus: new EventBus(), seed });
  gm.__rng = rng;
  return gm;
}
/** Points on the table: scores + Riichi deposits. */
const tablePoints = (gm) => gm.getPlayers().reduce((a, p) => a + p.score, 0) + (gm.getTurnFlow()?.riichiSticks ?? 0) * 1000;

// ---------------------------------------------------------------------------
section('1. The interface contract', () => {
  const sizes = { [RULESET_ID.HONG_KONG]: { 4: 136, 3: 136 }, [RULESET_ID.RIICHI]: { 4: 136, 3: 108 }, [RULESET_ID.CHINESE_OFFICIAL]: { 4: 144, 3: 144 } };
  for (const id of IDS) {
    for (const n of [4, 3]) {
      const e = ENGINES[id](n);
      assert(isValidRuleEngine(e) && e.getRulesetId() === id && e.getDisplayName() === RULESET_LABEL[id], `${id} ${n}P: a valid engine with its own id and label`);
      const ts = e.getTileSetOptions();
      assert(generateTileSet(ts).length === sizes[id][n] && Number.isInteger(ts.deadWallSize), `${id} ${n}P: ${sizes[id][n]} tiles`);
      const missing = Object.keys(HONG_KONG_TERMINOLOGY).filter((k) => k !== 'chinese' && k !== 'limit' && typeof e.getTerminology()[k] !== 'string');
      assert(missing.length === 0, `${id}: every shared terminology key (${missing.join(', ') || 'all'})`);
      const h = hand('123d 456b 789c 111d EE');
      const s = e.scoreHand(h, { winType: 'self', winningTile: h.concealedTiles[13], seatWind: null, roundWind: null });
      assert(['fan', 'points', 'meetsMinimum', 'breakdown'].every((k) => k in s) && Array.isArray(s.breakdown), `${id}: scoreHand returns the shared shape`);
      assertThrows(() => e.getLegalActions(null, { getHand: () => h }), TypeError, `${id}: getLegalActions rejects a missing state`);
    }
  }
  assert(new Set(IDS).size === 3 && new Set(IDS.map((id) => RULESET_LABEL[id])).size === 3, 'three distinct rulesets');
});

// ---------------------------------------------------------------------------
section('2. Isolation', () => {
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(join(ROOT, 'src'));
  const importsOf = (file) => [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => relative(ROOT, resolve(dirname(file), m[1])).replace(/\\/g, '/'));
  const rulesetOf = (p) => (p.match(/^src\/rules\/(hongkong|riichi|chineseOfficial)\//) ?? [])[1] ?? null;
  const bad = [];
  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    const own = rulesetOf(rel);
    for (const imp of importsOf(f)) {
      const target = rulesetOf(imp);
      if (!target) continue;
      if (own && target !== own) bad.push(`${rel} → ${imp} (another ruleset)`);
      if (!own && /^src\/(core|ui|persistence|utils)\//.test(rel)) bad.push(`${rel} → ${imp} (shared code importing a ruleset)`);
      if (!own && /^src\/ai\//.test(rel) && !/AIHelpers\.js$/.test(rel)) bad.push(`${rel} → ${imp} (AI outside its adaptation helpers)`);
    }
  }
  assert(files.length > 50, `scanned ${files.length} source files`);
  assert(bad.length === 0, `no ruleset leaks into another or into shared code${bad.length ? ' — ' + bad.slice(0, 4).join(' | ') : ''}`);
  // Task 120 (docs/architecture.md): the core and its shell — game logic never imports the UI or audio.
  const shell = [];
  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    if (!/^src\/(core|rules|ai|persistence|utils)\//.test(rel)) continue;
    for (const imp of importsOf(f)) if (/^src\/(ui|audio)\//.test(imp)) shell.push(`${rel} → ${imp}`);
  }
  assert(shell.length === 0, `core / rules / ai / persistence / utils never import the UI or audio${shell.length ? ' — ' + shell.slice(0, 4).join(' | ') : ''}`);
  const main = importsOf(join(ROOT, 'src/main.js')).filter(rulesetOf);
  assert(main.some((p) => rulesetOf(p) === 'hongkong'), 'main.js (the composition root) wires the rule engines');
});

// ---------------------------------------------------------------------------
section('3. The same tiles, three engines', () => {
  const engines = IDS.map((id) => ENGINES[id](4));
  const complete = (spec) => engines.map((e) => e.checkWin(hand(spec)).isWin);
  assert(complete('123d 456b 789c 111d EE').every(Boolean), 'a standard hand is complete in all three');
  assert(complete('123d 456b 789c 111d ES').every((x) => !x), 'an incomplete hand in none');
  assert(complete('19d 19b 19c ESWNRGH H').every(Boolean), 'Thirteen Orphans everywhere');
  const quadPairs = complete('1111d 55d 77b 99b EE RR');
  assert(quadPairs[IDS.indexOf(RULESET_ID.RIICHI)] === false && quadPairs[IDS.indexOf(RULESET_ID.CHINESE_OFFICIAL)] === true, 'Seven Pairs with a doubled pair: no in Riichi, yes in Chinese Official');
  const knitted = complete('147d 258b 369c ESWRG');
  assert(knitted[IDS.indexOf(RULESET_ID.CHINESE_OFFICIAL)] === true && knitted[IDS.indexOf(RULESET_ID.RIICHI)] === false && knitted[IDS.indexOf(RULESET_ID.HONG_KONG)] === false, 'Honors and Knitted only in Chinese Official');
  const h = hand('123d 456b 789c 111d EE');
  const scores = engines.map((e) => e.scoreHand(h, { winType: 'self', winningTile: h.concealedTiles[13], seatWind: null, roundWind: null }));
  const verdict = Object.fromEntries(IDS.map((id, i) => [id, scores[i].meetsMinimum]));
  assert(verdict[RULESET_ID.HONG_KONG] === false && scores[IDS.indexOf(RULESET_ID.HONG_KONG)].fan === 2, 'that closed Tsumo: Hong Kong 2 fan — below its 3-fan minimum');
  assert(verdict[RULESET_ID.RIICHI] === true && verdict[RULESET_ID.CHINESE_OFFICIAL] === true && scores[IDS.indexOf(RULESET_ID.CHINESE_OFFICIAL)].fan === 16, '…Riichi: a win (Menzen Tsumo); Chinese Official: 16 points');
  assert(new Set(scores.map((s) => JSON.stringify(s.breakdown.map((b) => b.id ?? b.name)))).size === 3, '…scored three different ways (separate scoring systems)');
});

// ---------------------------------------------------------------------------
const reference = {};
section('4. A session per ruleset', () => {
  let seed = 1200;
  for (const id of IDS) {
    for (const n of [4, 3]) {
      const gm = game(id, n, ++seed);
      const start = tablePoints(gm);
      const problems = []; const log = [];
      try {
        for (let h = 0; h < 6 && !gm.isGameComplete(); h++) {
          while (!gm.isRoundOver()) {
            gm.playAITurn();
            if (!gm.isRoundOver() && !tilesConserved(gm)) problems.push(`hand ${h + 1}: tiles`);
          }
          const o = gm.getLastOutcome();
          if (o.type === 'win' && !o.winners.every((w) => w.meetsMinimum)) problems.push(`hand ${h + 1}: invalid win`);
          gm.settleRound();
          if (tablePoints(gm) !== start) problems.push(`hand ${h + 1}: points ${tablePoints(gm)} ≠ ${start}`);
          log.push(`${o.type}|${gm.getPlayers().map((p) => p.score).join(',')}`);
          if (gm.isGameComplete()) break;
          gm.startNextHand();
        }
      } catch (e) { problems.push(`threw ${e.message}`); }
      reference[`${id}/${n}`] = log;
      assert(problems.length === 0 && log.length > 0, `${id} ${n}P: ${log.length} hands, tiles + points conserved, wins valid${problems.length ? ' — ' + problems.slice(0, 3).join(' | ') : ''}`);
    }
  }
});

// ---------------------------------------------------------------------------
section('5. Interleaved', () => {
  let seed = 1200;
  const games = [];
  for (const id of IDS) for (const n of [4, 3]) games.push({ key: `${id}/${n}`, gm: game(id, n, ++seed), log: [], hands: 0, done: false });
  let guard = 0;
  while (games.some((g) => !g.done) && guard++ < 100000) {
    for (const g of games) {
      if (g.done) continue;
      const gm = g.gm;
      if (!gm.isRoundOver()) { gm.playAITurn(); continue; }
      const o = gm.getLastOutcome();
      gm.settleRound();
      g.log.push(`${o.type}|${gm.getPlayers().map((p) => p.score).join(',')}`);
      g.hands++;
      if (gm.isGameComplete() || g.hands >= 6) g.done = true; else gm.startNextHand();
    }
  }
  const same = games.filter((g) => g.log.join('\n') === reference[g.key].join('\n'));
  assert(same.length === games.length, `six games advanced turn by turn together end exactly as each did alone (${same.length}/${games.length})`);
});

// ---------------------------------------------------------------------------
section('6. Saves', () => {
  const RF = Object.fromEntries(IDS.map((id) => [id, () => ENGINES[id](4)]));
  const view = (gm) => JSON.stringify({
    table: gm.getTableView(),
    self: gm.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DISCARD ? gm.getSelfActions().map((a) => `${a.type}:${a.kongType ?? ''}:${a.faceId ?? ''}`) : [],
    wall: gm.getWall().remainingCount,
    flow: gm.getTurnFlow()?.toJSON() ?? null,
    hands: gm.getPlayers().map((p) => p.getHand().concealedTiles.map((t) => t.instanceId).join()),
  }, (k, v) => (v && typeof v === 'object' && 'instanceId' in v && 'id' in v ? v.instanceId : v));
  let seed = 1300;
  for (const id of IDS) {
    const gm = game(id, 4, ++seed);
    for (let i = 0; i < 9 && !gm.isRoundOver(); i++) gm.playAITurn();
    if (!gm.isRoundOver() && gm.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DRAW) gm.performDraw(); // save mid-turn, tile in hand
    const snap = JSON.parse(JSON.stringify(buildSnapshot(gm, { rulesetId: id, difficulty: 'basic' })));
    const back = hydrateGameManager(snap, { RULE_ENGINE_FACTORIES: RF, STRATEGY_FACTORIES: factoriesFor(gm.__rng), eventBus: new EventBus() });
    assert(back.getRuleEngine().getRulesetId() === id, `${id}: the snapshot's ruleset id picks the engine`);
    assert(view(back) === view(gm), `${id}: the restored game shows the same table, actions, wall and turn-flow state`);
    assertThrows(() => hydrateGameManager({ ...snap, rulesetId: 'nope' }, { RULE_ENGINE_FACTORIES: RF, eventBus: new EventBus() }), Error, `${id}: an unknown ruleset id is refused`);
  }
});

summary();
