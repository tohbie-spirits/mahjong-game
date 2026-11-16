/**
 * rulesetWiring.test.mjs — Task 102: the non-DOM parts of making all three
 * rulesets selectable.
 *
 *   1. Saves of 3-player games restore with a 3-player engine
 *      (hydrateGameManager passes { playerCount } to the engine factory —
 *      found by Task 101: it used to build a 4-player Riichi / Chinese
 *      Official engine for a 3-player table)
 *   2. Claim-prompt wording — Riichi's RIICHI / ABORTIVE_DRAW self-actions,
 *      the win button in each ruleset's unit
 *   (The UI itself — rule selection, table info, riichi declaration, score
 *   panels — is exercised in the browser by tests/browser/smoke.py.)
 *
 * Run: node tests/core/rulesetWiring.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { buildSnapshot, hydrateGameManager } from '../../src/persistence/GameSnapshot.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { describeAction } from '../../src/ui/dialogs/ClaimPromptDialog.js';
import { scoreFormatFor } from '../../src/ui/scoreFormat.js';
import { RULESET_ID, ACTION_TYPE } from '../../src/utils/constants.js';

/** The same factories main.js registers (it can't be imported here: it boots the DOM). */
const FACTORIES = {
  [RULESET_ID.HONG_KONG]: () => new HongKongRules(),
  [RULESET_ID.RIICHI]: ({ playerCount = 4 } = {}) => new RiichiRules({ playerCount }),
  [RULESET_ID.CHINESE_OFFICIAL]: ({ playerCount = 4 } = {}) => new ChineseOfficialRules({ playerCount }),
};

section('1. 3-player saves restore with a 3-player engine', () => {
  for (const id of [RULESET_ID.RIICHI, RULESET_ID.CHINESE_OFFICIAL, RULESET_ID.HONG_KONG]) {
    for (const n of [3, 4]) {
      const cfg = buildPlayerConfigs({ playerCount: n, difficulty: 'basic', humanSeatIndex: 0 });
      const gm = new GameManager({ ruleEngine: FACTORIES[id]({ playerCount: n }), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg), eventBus: new EventBus(), seed: 7 });
      const snap = JSON.parse(JSON.stringify(buildSnapshot(gm, { rulesetId: id, difficulty: 'basic' })));
      let seen = null;
      const spy = { [id]: (opts) => { seen = opts; return FACTORIES[id](opts); } };
      const back = hydrateGameManager(snap, { RULE_ENGINE_FACTORIES: spy, eventBus: new EventBus() });
      assert(seen?.playerCount === n, `${id} ${n}P: the factory is told the table size (${seen?.playerCount})`);
      const opts = typeof back.getRuleEngine().getOptions === 'function' ? back.getRuleEngine().getOptions() : null;
      if (opts && 'playerCount' in opts) assert(opts.playerCount === n, `${id} ${n}P: the restored engine is a ${n}-player engine`);
    }
  }
  const sanma = new GameManager({ ruleEngine: FACTORIES[RULESET_ID.RIICHI]({ playerCount: 3 }), playerConfigs: buildPlayerConfigs({ playerCount: 3, difficulty: 'basic', humanSeatIndex: 0 }), eventBus: new EventBus(), seed: 3 });
  assert(sanma.getWall().totalCount === 108 && sanma.getPlayers().every((p) => p.score === 35000), 'a 3-player Riichi table: 108 tiles, 35000 each');
  const legacy = (opts) => { assert(opts && typeof opts === 'object', 'factories that ignore arguments still work (Hong Kong)'); return new HongKongRules(); };
  const hk = new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: buildPlayerConfigs({ playerCount: 4, difficulty: 'basic', humanSeatIndex: 0 }), eventBus: new EventBus(), seed: 1 });
  hydrateGameManager(JSON.parse(JSON.stringify(buildSnapshot(hk, { rulesetId: RULESET_ID.HONG_KONG, difficulty: 'basic' }))), { RULE_ENGINE_FACTORIES: { [RULESET_ID.HONG_KONG]: legacy }, eventBus: new EventBus() });
});

section('2. Claim-prompt wording', () => {
  assert(describeAction({ type: ACTION_TYPE.RIICHI, allowedTiles: [] }).startsWith('Riichi'), 'RIICHI has a button');
  assert(/Abortive draw/.test(describeAction({ type: ACTION_TYPE.ABORTIVE_DRAW, reason: 'nine-terminals' })), 'ABORTIVE_DRAW has a button');
  const win = { type: ACTION_TYPE.WIN, winType: 'self', score: { fan: 3, han: 3, points: 16 } };
  assert(describeAction(win) === 'Mahjong! (Self-drawn · 3 fan)', 'no format → the original Hong Kong wording');
  assert(describeAction(win, { format: scoreFormatFor(RULESET_ID.RIICHI) }) === 'Mahjong! (Self-drawn · 3 han)', 'Riichi → han');
  assert(describeAction(win, { format: scoreFormatFor(RULESET_ID.CHINESE_OFFICIAL) }) === 'Mahjong! (Self-drawn · 16 pts)', 'Chinese Official → points');
  assertThrows(() => describeAction({ type: 'nope' }), TypeError, 'unknown actions still throw');
});

summary();
