/**
 * difficultyWiring.test.mjs — Task 79: AI difficulty selection wiring.
 *
 * Sections:
 *   1. StrategyRegistry — factories for Basic + Advanced, availability order,
 *      createStrategy (fresh instances, id check, unknown tier)
 *   2. buildPlayerConfigs — single tier, per-seat tiers, all-AI, validation
 *   3. seatDifficulties / createAIManagerForSeats — one strategy per tier
 *      used, humans ignored, missing factory throws, pacing passed through
 *   4. GameManager coverage check — constructor and restore() refuse an
 *      AIManager that lacks an AI seat's tier; getSeatDifficulties()
 *   5. Routing in real games — on seeded all-AI tables (one tier, and mixed
 *      Basic/Advanced) every AI decision goes to the seat's own tier
 *   6. The main.js path — human seat + Advanced opponents plays hands
 *      through the exact builder calls main.js makes
 *   7. Save / restore — Advanced and mixed tables restore with the right
 *      strategies using the registry's default factories, then finish
 *   8. DifficultySelection — with the registry's availability both cards
 *      are enabled; selectedDifficulty marks the card; click selects
 *
 * Run: node tests/ai/difficultyWiring.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import {
  STRATEGY_FACTORIES, getAvailableDifficulties, isAvailableDifficulty, createStrategy,
  buildPlayerConfigs, seatDifficulties, createAIManagerForSeats,
} from '../../src/ai/StrategyRegistry.js';
import { AIManager } from '../../src/ai/AIManager.js';
import { PacingController } from '../../src/ai/PacingController.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AdvancedStrategy } from '../../src/ai/advanced/AdvancedStrategy.js';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { buildSnapshot, hydrateGameManager } from '../../src/persistence/GameSnapshot.js';
import { AI_DIFFICULTY, SEAT_KIND, RULESET_ID, TURN_PHASE, ACTION_TYPE } from '../../src/utils/constants.js';

const B = AI_DIFFICULTY.BASIC;
const A = AI_DIFFICULTY.ADVANCED;
const RULES = { [RULESET_ID.HONG_KONG]: () => new HongKongRules() };

/** Factories whose strategies count every decision, per tier and per seat. */
function spyFactories() {
  const calls = { [B]: [], [A]: [] };
  const wrap = (id, real) => () => {
    const s = real();
    for (const m of ['chooseDiscard', 'chooseClaim', 'chooseWinDeclaration']) {
      const orig = s[m].bind(s);
      s[m] = (player, ...rest) => { calls[id].push(player.seatIndex); return orig(player, ...rest); };
    }
    return s;
  };
  return { calls, factories: { [B]: wrap(B, () => new BasicStrategy()), [A]: wrap(A, () => new AdvancedStrategy()) } };
}

function makeGame(configs, { factories = STRATEGY_FACTORIES, seed = 1, maxHands = 1 } = {}) {
  return new GameManager({
    ruleEngine: new HongKongRules(), playerConfigs: configs, eventBus: new EventBus(), seed, maxHands,
    aiManager: createAIManagerForSeats(configs, { factories }),
  });
}

/** Plays the current hand to its end; a human seat discards its newest tile and takes any Tsumo. */
function finishHand(gm, maxSteps = 600) {
  for (let i = 0; i < maxSteps && !gm.isRoundOver(); i++) {
    const seat = gm.getTurnManager().getCurrentPlayerIndex();
    if (gm.getPlayer(seat).seatKind === SEAT_KIND.AI) { gm.playAITurn(); continue; }
    if (gm.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DRAW) {
      const d = gm.performDraw();
      if (d.type === 'exhausted') break;
    }
    if (gm.getSelfActions().some((a) => a.type === ACTION_TYPE.WIN)) { gm.declareTsumo(); break; }
    const hand = gm.getPlayer(seat).getHand().concealedTiles;
    gm.performDiscard(hand[hand.length - 1]);
  }
  return gm.isRoundOver();
}

// ---------------------------------------------------------------------------
section('1. StrategyRegistry', () => {
  assert(Object.isFrozen(STRATEGY_FACTORIES), 'STRATEGY_FACTORIES is frozen');
  assert(getAvailableDifficulties().join() === 'basic,advanced', 'both tiers available, Basic first');
  assert(getAvailableDifficulties({ [A]: () => new AdvancedStrategy() }).join() === 'advanced', 'availability follows the factories given');
  assert(getAvailableDifficulties({ [A]: () => 0, [B]: () => 0, expert: () => 0 }).join() === 'basic,advanced', 'AI_DIFFICULTY order; unknown ids ignored');
  assert(isAvailableDifficulty(A) && isAvailableDifficulty(B) && !isAvailableDifficulty('expert'), 'isAvailableDifficulty');
  const a1 = createStrategy(A); const a2 = createStrategy(A);
  assert(a1 instanceof AdvancedStrategy && a1 !== a2, 'createStrategy(advanced) → fresh AdvancedStrategy each call');
  assert(createStrategy(B) instanceof BasicStrategy, 'createStrategy(basic) → BasicStrategy');
  assert(a1.getStrategyId() === A && createStrategy(B).getStrategyId() === B, 'strategies report their tier id');
  assertThrows(() => createStrategy('expert'), Error, 'unknown tier throws');
  assertThrows(() => createStrategy(A, { [A]: () => new BasicStrategy() }), Error, 'a factory building the wrong tier throws');
  assertThrows(() => getAvailableDifficulties(null), TypeError, 'bad factories argument throws');
});

// ---------------------------------------------------------------------------
section('2. buildPlayerConfigs', () => {
  const c4 = buildPlayerConfigs({ playerCount: 4, difficulty: A });
  assert(c4.length === 4 && c4.every((c, i) => c.seatIndex === i), 'four seats in order');
  assert(c4[0].seatKind === SEAT_KIND.HUMAN && c4[0].aiDifficulty === null && c4[0].displayName === 'You', 'seat 0 is the human');
  assert(c4.slice(1).every((c, i) => c.seatKind === SEAT_KIND.AI && c.aiDifficulty === A && c.displayName === `AI ${i + 1}`), 'AI seats get the chosen tier and "AI n" names');
  assert(buildPlayerConfigs({ playerCount: 3, difficulty: B }).length === 3, 'three-player table');
  const mixed = buildPlayerConfigs({ playerCount: 4, seatDifficulties: [null, B, A, B] });
  assert(mixed.map((c) => c.aiDifficulty).join() === ',basic,advanced,basic', 'per-seat tiers');
  const allAi = buildPlayerConfigs({ playerCount: 4, difficulty: A, humanSeatIndex: -1 });
  assert(allAi.every((c) => c.seatKind === SEAT_KIND.AI), 'humanSeatIndex −1 → all-AI table');
  assert(buildPlayerConfigs({ playerCount: 4, seatDifficulties: ['ignored', B, B, B] })[0].aiDifficulty === null, "the human's seatDifficulties entry is ignored");
  assertThrows(() => buildPlayerConfigs({ playerCount: 5, difficulty: A }), RangeError, 'player count 5 throws');
  assertThrows(() => buildPlayerConfigs({ playerCount: 4 }), TypeError, 'neither difficulty nor seatDifficulties throws');
  assertThrows(() => buildPlayerConfigs({ playerCount: 4, difficulty: A, seatDifficulties: [null, A, A, A] }), TypeError, 'both throws');
  assertThrows(() => buildPlayerConfigs({ playerCount: 4, difficulty: 'expert' }), TypeError, 'unknown tier throws');
  assertThrows(() => buildPlayerConfigs({ playerCount: 4, seatDifficulties: [null, A, A] }), RangeError, 'seatDifficulties of the wrong length throws');
  assertThrows(() => buildPlayerConfigs({ playerCount: 3, difficulty: A, humanSeatIndex: 3 }), RangeError, 'human seat out of range throws');
});

// ---------------------------------------------------------------------------
section('3. seatDifficulties / createAIManagerForSeats', () => {
  const mixed = buildPlayerConfigs({ playerCount: 4, seatDifficulties: [null, A, B, A] });
  assert(seatDifficulties(mixed).join() === 'advanced,basic', 'distinct tiers in seat order; human ignored');
  const ai = createAIManagerForSeats(mixed);
  assert(ai instanceof AIManager && ai.getStrategyIds().sort().join() === 'advanced,basic', 'one strategy per tier used');
  assert(ai.getStrategy(A) instanceof AdvancedStrategy && ai.getStrategy(B) instanceof BasicStrategy, 'right classes registered');
  const onlyAdv = createAIManagerForSeats(buildPlayerConfigs({ playerCount: 4, difficulty: A }));
  assert(onlyAdv.getStrategyIds().join() === 'advanced', 'an Advanced table registers only Advanced');
  const players = makeGame(mixed).getPlayers();
  assert(createAIManagerForSeats(players).getStrategyIds().length === 2, 'also accepts PlayerManager objects');
  assertThrows(() => createAIManagerForSeats(mixed, { factories: { [B]: () => new BasicStrategy() } }), Error, 'a used tier with no factory throws');
  const pacing = new PacingController();
  assert(createAIManagerForSeats(mixed, { pacingController: pacing }).getPacingController() === pacing, 'pacingController passed through');
  assertThrows(() => seatDifficulties('nope'), TypeError, 'seatDifficulties validates its input');
});

// ---------------------------------------------------------------------------
section('4. GameManager coverage check', () => {
  const advCfg = buildPlayerConfigs({ playerCount: 4, difficulty: A });
  const basicOnly = new AIManager({ strategies: [new BasicStrategy()] });
  let msg = '';
  try { new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: advCfg, aiManager: basicOnly, eventBus: new EventBus(), seed: 2 }); } catch (e) { msg = e.message; }
  assert(/seat 1 "advanced"/.test(msg) && /seat 3 "advanced"/.test(msg), 'constructor refuses an AIManager missing the seats\' tier, naming the seats');
  const gm = new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: advCfg, aiManager: null, eventBus: new EventBus(), seed: 2 });
  assert(gm.getAIManager() === null, 'a null aiManager is still allowed (Tasks 31–33 behaviour)');
  assert(gm.getSeatDifficulties().join() === ',advanced,advanced,advanced', 'getSeatDifficulties(): null for the human, tier per AI seat');
  assertThrows(() => new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: advCfg, aiManager: {}, eventBus: new EventBus() }), TypeError, 'a non-AIManager aiManager throws');
  const ok = makeGame(advCfg);
  assert(ok.getAIManager().getStrategy(A) instanceof AdvancedStrategy, 'a registry-built AIManager passes');
  const snap = JSON.parse(JSON.stringify(buildSnapshot(ok, { rulesetId: RULESET_ID.HONG_KONG, difficulty: A })));
  assertThrows(() => hydrateGameManager(snap, { RULE_ENGINE_FACTORIES: RULES, STRATEGY_FACTORIES: { [B]: () => new BasicStrategy() } }), Error, 'restore path refuses a missing tier too');
});

// ---------------------------------------------------------------------------
section('5. Routing in real games', () => {
  // One tier: all-Advanced, 6 seeded hands.
  {
    const { calls, factories } = spyFactories();
    let fallbacks = 0; let completed = 0;
    for (let seed = 0; seed < 6; seed++) {
      const gm = makeGame(buildPlayerConfigs({ playerCount: 4, difficulty: A, humanSeatIndex: -1 }), { factories, seed: 7900 + seed });
      gm.playRoundWithAI();
      completed += gm.isRoundOver() ? 1 : 0;
      fallbacks += gm.getAIManager().getStrategy(A).getFallbackCount();
    }
    assert(completed === 6, 'six all-Advanced hands complete');
    assert(calls[A].length > 100 && calls[B].length === 0, `every decision went to Advanced (${calls[A].length} decisions, 0 Basic)`);
    assert(fallbacks === 0, 'no evaluator fallbacks');
  }
  // Mixed: seats 0, 2 Basic; seats 1, 3 Advanced (and swapped), 3-player too.
  for (const tiers of [[B, A, B, A], [A, B, A, B], [A, B, B]]) {
    const { calls, factories } = spyFactories();
    for (let seed = 0; seed < 4; seed++) {
      const gm = makeGame(buildPlayerConfigs({ playerCount: tiers.length, seatDifficulties: tiers, humanSeatIndex: -1 }), { factories, seed: 12000 + seed });
      gm.playRoundWithAI();
    }
    const bSeats = new Set(calls[B]); const aSeats = new Set(calls[A]);
    const expectB = tiers.map((t, i) => (t === B ? i : -1)).filter((i) => i >= 0);
    const expectA = tiers.map((t, i) => (t === A ? i : -1)).filter((i) => i >= 0);
    assert([...bSeats].sort().join() === expectB.join() && [...aSeats].sort().join() === expectA.join(),
      `${tiers.join('/')}: Basic decided only for seats ${expectB}, Advanced only for seats ${expectA}`);
  }
});

// ---------------------------------------------------------------------------
section('6. The main.js path (human seat + Advanced opponents)', () => {
  for (const playerCount of [4, 3]) {
    let hands = 0;
    for (let seed = 0; seed < 3; seed++) {
      // Exactly what main.js _renderGameScreenFor does.
      const playerConfigs = buildPlayerConfigs({ playerCount, difficulty: A, humanSeatIndex: 0 });
      const aiManager = createAIManagerForSeats(playerConfigs, { factories: STRATEGY_FACTORIES });
      const gm = new GameManager({ ruleEngine: new HongKongRules(), playerConfigs, aiManager, eventBus: new EventBus(), seed: 500 + seed, maxHands: 1 });
      if (finishHand(gm)) hands++;
    }
    assert(hands === 3, `${playerCount}-player: three hands with a human seat and Advanced opponents complete`);
  }
});

// ---------------------------------------------------------------------------
section('7. Save / restore with Advanced and mixed tables', () => {
  for (const [label, cfg] of [
    ['Advanced', buildPlayerConfigs({ playerCount: 4, difficulty: A })],
    ['mixed', buildPlayerConfigs({ playerCount: 4, seatDifficulties: [null, A, B, A] })],
  ]) {
    const gm = makeGame(cfg, { seed: 77 });
    // A few turns in, then save on the human's turn.
    const d = gm.performDraw(); gm.performDiscard(d.tile);
    for (let g = 0; g < 20 && !gm.isRoundOver() && gm.getTurnManager().getCurrentPlayerIndex() !== 0; g++) gm.playAITurn();
    const snap = JSON.parse(JSON.stringify(buildSnapshot(gm, { rulesetId: RULESET_ID.HONG_KONG, difficulty: label === 'mixed' ? B : A })));
    // Default STRATEGY_FACTORIES = the registry's (what a restored main.js game uses).
    const back = hydrateGameManager(snap, { RULE_ENGINE_FACTORIES: RULES, eventBus: new EventBus() });
    assert(back.getSeatDifficulties().join() === gm.getSeatDifficulties().join(), `${label}: seat tiers preserved`);
    const ids = back.getAIManager().getStrategyIds().sort().join();
    assert(ids === (label === 'mixed' ? 'advanced,basic' : 'advanced'), `${label}: restored AIManager holds ${ids}`);
    assert(back.getAIManager().getStrategy(A) instanceof AdvancedStrategy, `${label}: Advanced seats restore as AdvancedStrategy`);
    assert(finishHand(back), `${label}: restored game plays to the end of the hand`);
  }
});

// ---------------------------------------------------------------------------
{
  // Minimal DOM (no jsdom): just what _screenKit / _choiceScreen use.
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.className = ''; this.textContent = ''; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.disabled = false; this.focused = false; const self = this; this.classList = { add(c) { self.className = `${self.className} ${c}`.trim(); }, contains(c) { return self.className.split(/\s+/).includes(c); } }; }
    set innerHTML(_) { this.children = []; }
    appendChild(c) { this.children.push(c); return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
    click() { if (!this.disabled) for (const fn of this.listeners.click ?? []) fn(); }
    focus() { this.focused = true; }
    all() { return this.children.flatMap((c) => [c, ...c.all()]); }
    querySelector(sel) { return sel === 'button:not([disabled])' ? this.all().find((n) => n.tagName === 'BUTTON' && !n.disabled) ?? null : null; }
  }
  globalThis.Element = El;
  globalThis.document = { createElement: (t) => new El(t) };
  const { renderDifficultySelection } = await import('../../src/ui/components/DifficultySelection.js');

  section('8. DifficultySelection with the registry', () => {
    const root = new El('div');
    let picked = null;
    renderDifficultySelection(root, { availableDifficulties: getAvailableDifficulties(), selectedDifficulty: A, onSelect: (id) => { picked = id; } });
    const cards = root.all().filter((n) => n.tagName === 'BUTTON' && n.className.includes('difficulty-selection-card'));
    const byValue = Object.fromEntries(cards.map((c) => [c.dataset.value, c]));
    assert(cards.length === 2 && byValue.basic && byValue.advanced, 'Basic and Advanced cards rendered');
    assert(!byValue.basic.disabled && !byValue.advanced.disabled, 'both enabled (no "Coming Soon")');
    assert(!root.all().some((n) => n.className === 'difficulty-selection-card-badge'), 'no Coming Soon badge');
    assert(byValue.advanced.className.includes('difficulty-selection-card--selected') && !byValue.basic.className.includes('--selected'), 'selectedDifficulty marks the Advanced card');
    byValue.advanced.click();
    assert(picked === A, 'clicking Advanced selects "advanced"');
    const root2 = new El('div');
    renderDifficultySelection(root2, { availableDifficulties: getAvailableDifficulties({ [B]: () => new BasicStrategy() }), onSelect: () => {} });
    const adv2 = root2.all().find((n) => n.dataset?.value === 'advanced');
    assert(adv2.disabled === true, 'a tier missing from the registry is disabled');
  });
}

summary();
