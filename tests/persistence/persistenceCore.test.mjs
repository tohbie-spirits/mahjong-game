/**
 * persistenceCore.test.mjs — rebuilt Tasks 61, 62, 64, 65, 67:
 * StorageManager, SettingsManager, SaveGameManager, StatisticsManager,
 * GameSnapshot (build + hydrate round-trips, incl. mid-claim state).
 * Run: node tests/persistence/persistenceCore.test.mjs
 */
import { section, assert, assertThrows, summary, mulberry32 } from '../_helpers/harness.mjs';
import { StorageManager, MemoryStorage, CURRENT_SCHEMA_VERSION } from '../../src/persistence/StorageManager.js';
import { SettingsManager, SETTING_KEYS, DEFAULTS } from '../../src/persistence/SettingsManager.js';
import { SaveGameManager, SAVEGAME_SCHEMA_VERSION } from '../../src/persistence/SaveGameManager.js';
import { StatisticsManager, STAT_KEYS, WIN_TYPE } from '../../src/persistence/StatisticsManager.js';
import { buildSnapshot, hydrateGameManager } from '../../src/persistence/GameSnapshot.js';
import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { AIManager } from '../../src/ai/AIManager.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { RULESET_ID, AI_DIFFICULTY, SEAT_KIND, THEME, TURN_PHASE, WIND } from '../../src/utils/constants.js';

const root = () => new StorageManager({ storage: new MemoryStorage() });

section('StorageManager', () => {
  const mem = new MemoryStorage();
  const s = new StorageManager({ storage: mem });
  assert(s.set('a', { x: 1 }) && s.get('a').x === 1, 'JSON round-trip');
  assert(mem.getItem('mahjong:a') !== null, "keys prefixed 'mahjong:'");
  const ns = s.namespace('settings');
  ns.set('theme', 'dark');
  assert(mem.getItem('mahjong:settings:theme') === '"dark"', "child keys 'mahjong:settings:theme'");
  assert(s.get('theme') === null && ns.get('a') === null, 'namespaces isolated');
  mem.setItem('mahjong:bad', '{not json');
  assert(s.get('bad') === null && s.get('missing') === null, 'corrupt/missing → null');
  ns.clear();
  assert(ns.get('theme') === null && s.get('a').x === 1, 'clear() is namespace-scoped');
  assert(s.migrate({}) === CURRENT_SCHEMA_VERSION && s.getSchemaVersion() === 1, 'migrate stamps the version');
  let runs = 0;
  const fresh = root();
  fresh.migrate({ 1: () => { runs++; } });
  fresh.migrate({ 1: () => { runs++; } });
  assert(runs === 1, 'migrate idempotent');
  fresh.set('__schemaVersion__', 99);
  assertThrows(() => fresh.migrate({}), Error, 'refuses to downgrade');
  assert(s.isAvailable() && mem.getItem('mahjong:__probe__') === null, 'isAvailable leaves no key behind');
  const broken = new StorageManager({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} } });
  assert(broken.set('x', 1) === false && broken.isAvailable() === false, 'quota errors → false, not a crash');
  assertThrows(() => new StorageManager({ storage: {} }), TypeError, 'invalid backend');
  assertThrows(() => s.set('', 1), TypeError, 'empty key');
});

section('SettingsManager', () => {
  const r = root();
  const sm = new SettingsManager(r);
  assert(sm.get(SETTING_KEYS.THEME) === THEME.DARK && sm.get(SETTING_KEYS.VOLUME) === 1 && sm.get(SETTING_KEYS.ANIMATIONS_ENABLED) === true, 'defaults');
  sm.set(SETTING_KEYS.THEME, THEME.LIGHT); sm.set(SETTING_KEYS.VOLUME, 0.4); sm.set(SETTING_KEYS.ANIMATIONS_ENABLED, false);
  // Task 108 added sfxVolume / musicVolume / muted (shown here at their defaults).
  assert(JSON.stringify(sm.getAll()) === JSON.stringify({ theme: 'light', volume: 0.4, animationsEnabled: false, sfxVolume: 0.8, musicVolume: 0.35, muted: false, hints: true }), 'set / getAll'); // Task 116: hints
  assert(new SettingsManager(r).get(SETTING_KEYS.VOLUME) === 0.4, 'persists across instances');
  assertThrows(() => sm.set(SETTING_KEYS.VOLUME, 2), TypeError, 'volume out of range');
  assertThrows(() => sm.set('font', 'x'), TypeError, 'unknown key');
  sm.getNamespace().set('theme', 'purple');
  assert(sm.get(SETTING_KEYS.THEME) === DEFAULTS.theme, 'corrupt value falls back to default');
  assert(sm.reset(SETTING_KEYS.VOLUME) === 1 && sm.get(SETTING_KEYS.VOLUME) === 1, 'reset');
  sm.resetAll();
  assert(sm.get(SETTING_KEYS.ANIMATIONS_ENABLED) === true, 'resetAll');
  assert(sm.getNamespace().getSchemaVersion() === 1, 'settings namespace stamped');
  assertThrows(() => new SettingsManager({}), TypeError, 'needs a StorageManager');
});

section('StatisticsManager', () => {
  const st = new StatisticsManager(root());
  assert(Object.values(st.getAll()).every((v) => v === 0) && Object.keys(st.getAll()).length === 12, '12 stats start at 0');
  st.recordHandPlayed(); st.recordHandWin({ winType: WIN_TYPE.TSUMO, fan: 5 }); st.recordHandWin({ winType: WIN_TYPE.RON, fan: 3 });
  assert(st.getStat(STAT_KEYS.HANDS_WON) === 2 && st.getStat(STAT_KEYS.TSUMO_WINS) === 1 && st.getStat(STAT_KEYS.RON_WINS) === 1, 'hand wins by type');
  assert(st.getStat(STAT_KEYS.TOTAL_FAN_EARNED) === 8 && st.getStat(STAT_KEYS.HIGHEST_FAN_HAND) === 5, 'fan totals + record');
  st.recordGameResult({ won: true }); st.recordGameResult({ won: true }); st.recordGameResult({ drawn: true });
  assert(st.getStat(STAT_KEYS.LONGEST_WIN_STREAK) === 2 && st.getStat(STAT_KEYS.CURRENT_WIN_STREAK) === 0 && st.getStat(STAT_KEYS.GAMES_DRAWN) === 1, 'streaks');
  assertThrows(() => st.getStat('nope'), TypeError, 'unknown stat');
  st.resetAll();
  assert(st.getStat(STAT_KEYS.GAMES_PLAYED) === 0, 'resetAll');
});

section('SaveGameManager', () => {
  const sg = new SaveGameManager(root());
  assert(!sg.hasSave() && sg.load() === null, 'empty slot');
  const snap = { rulesetId: 'hong_kong', playerConfigs: [{}], extra: 1 };
  assert(sg.save(snap) === true && !('savedAt' in snap), 'save stamps a copy, caller object untouched');
  const loaded = sg.load();
  assert(loaded.schemaVersion === SAVEGAME_SCHEMA_VERSION && typeof loaded.savedAt === 'string' && loaded.extra === 1, 'load returns stamped snapshot with extra fields');
  for (const bad of [null, 'x', [], { rulesetId: '' , playerConfigs: [{}] }, { rulesetId: 'x', playerConfigs: [] }]) {
    assertThrows(() => sg.save(bad), TypeError, `rejects ${JSON.stringify(bad)}`);
  }
  sg.getNamespace().set('slot', { rulesetId: 'x', playerConfigs: [{}], schemaVersion: 99 });
  assert(sg.load() === null && sg.hasSave(), 'newer schema not loaded (hasSave still true)');
  assert(sg.clear() === true && !sg.hasSave(), 'clear');
});

const configs = (human = 0) => Array.from({ length: 4 }, (_, i) => ({ seatIndex: i, displayName: i === human ? 'You' : `AI ${i}`, seatKind: i === human ? SEAT_KIND.HUMAN : SEAT_KIND.AI, aiDifficulty: i === human ? null : AI_DIFFICULTY.BASIC }));
const FACTORIES = { RULE_ENGINE_FACTORIES: { [RULESET_ID.HONG_KONG]: () => new HongKongRules() }, STRATEGY_FACTORIES: { [AI_DIFFICULTY.BASIC]: () => new BasicStrategy() } };

section('GameSnapshot round-trip', () => {
  const gm = new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: configs(), aiManager: new AIManager({ strategies: [new BasicStrategy({ random: mulberry32(1) })] }), eventBus: new EventBus(), seed: 65 });
  // Human draws + discards, then AIs play until it's the human's turn again (or the round ends).
  const d = gm.performDraw();
  gm.performDiscard(d.tile);
  let guard = 0;
  while (!gm.isRoundOver() && gm.getTurnManager().getCurrentPlayerIndex() !== 0 && guard++ < 20) gm.playAITurn();
  const snap = JSON.parse(JSON.stringify(buildSnapshot(gm, { rulesetId: RULESET_ID.HONG_KONG, difficulty: AI_DIFFICULTY.BASIC })));
  assert(snap.rulesetId === 'hong_kong' && snap.playerConfigs.length === 4, 'anchor fields');
  assert(snap.roundState.roundWind === 'east' && snap.finalRoundWind === 'east' && snap.players.every((p) => typeof p.seatWind === 'string'), 'winds stored as id strings');
  assert(snap.wall.tiles.every((t) => typeof t.id === 'string' && typeof t.instanceId === 'string'), 'tiles stored as {id, instanceId}');
  const sg = new SaveGameManager(root());
  sg.save(snap);
  const back = hydrateGameManager(sg.load(), { ...FACTORIES, eventBus: new EventBus() });
  assert(back instanceof GameManager, 'hydrates to a GameManager');
  assert(back.getWall().remainingCount === gm.getWall().remainingCount && back.getWall().totalCount === 136, 'wall cursor preserved');
  assert(back.getTurnManager().getCurrentPlayerIndex() === gm.getTurnManager().getCurrentPlayerIndex() && back.getTurnManager().getPhase() === gm.getTurnManager().getPhase(), 'turn state preserved');
  assert(back.getRoundWind() === WIND.EAST, 'round wind deserialised to the WIND object');
  const same = gm.getPlayers().every((p, i) => {
    const q = back.getPlayer(i);
    return p.score === q.score && p.seatWind === q.seatWind &&
      p.getHand().concealedTiles.map((t) => t.instanceId).join() === q.getHand().concealedTiles.map((t) => t.instanceId).join() &&
      p.getHand().meldCount === q.getHand().meldCount &&
      p.getDiscardPile().entries.map((e) => `${e.tile.instanceId}${e.claimed}`).join() === q.getDiscardPile().entries.map((e) => `${e.tile.instanceId}${e.claimed}`).join();
  });
  assert(same, 'every hand, meld count, discard (incl. claimed flags), score and seat wind preserved');
  // Restored game keeps playing: finish the hand with AI for every seat by converting the human to AI-like play.
  let steps = 0;
  while (!back.isRoundOver() && steps++ < 400) {
    const seat = back.getTurnManager().getCurrentPlayerIndex();
    if (back.getPlayer(seat).isHuman) {
      if (back.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DRAW) { const r = back.performDraw(); if (r.type === 'exhausted') break; }
      const win = back.getSelfActions().find((a) => a.type === 'win');
      if (win) { back.declareTsumo(); break; }
      const h = back.getPlayer(seat).getHand().concealedTiles;
      back.performDiscard(h[h.length - 1]);
    } else back.playAITurn();
  }
  assert(back.isRoundOver(), 'restored game plays to the end of the hand');
  assertThrows(() => hydrateGameManager({ ...snap, rulesetId: 'riichi' }, FACTORIES), Error, 'unknown ruleset throws');
  // Task 79: strategies are built from each seat's own aiDifficulty; the
  // session label alone no longer decides them, and a seat whose tier has
  // no factory makes hydrate throw (main.js then clears the save).
  const relabelled = hydrateGameManager({ ...snap, difficulty: 'advanced' }, FACTORIES);
  assert(relabelled.getAIManager().getStrategyIds().join() === 'basic', 'strategies follow the seats\' aiDifficulty, not the session label');
  const advSeats = { ...snap, players: snap.players.map((p) => (p.seatKind === SEAT_KIND.AI ? { ...p, aiDifficulty: AI_DIFFICULTY.ADVANCED } : p)) };
  assertThrows(() => hydrateGameManager(advSeats, FACTORIES), Error, 'an AI seat whose difficulty has no strategy factory throws (Task 79; was a warning)');
});

section('GameSnapshot: pending Kong replacement survives', () => {
  const gm = new GameManager({ ruleEngine: new HongKongRules(), playerConfigs: configs(), eventBus: new EventBus(), seed: 3 });
  // Fake a pending replacement on the current seat (as after an AI exposed-Kong claim).
  gm._pendingReplacement = true;
  const snap = buildSnapshot(gm, { rulesetId: RULESET_ID.HONG_KONG, difficulty: AI_DIFFICULTY.BASIC });
  const back = hydrateGameManager(JSON.parse(JSON.stringify(snap)), FACTORIES);
  assert(back.hasPendingReplacement() === true, 'pendingReplacement restored');
  const d = back.performDraw();
  assert(d.isReplacement === true, 'next draw is the replacement');
});

summary();
