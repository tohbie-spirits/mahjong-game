/**
 * gameSoundBridge.test.mjs — Task 109: src/audio/GameSoundBridge.js (game
 * events → sound effects), with a recording audio stand-in. Sections 1–3 use
 * a bare EventBus; sections 4–5 play REAL all-AI hands of all three rulesets
 * through GameManager and check that every event got exactly its sound.
 *
 * Sections:
 *   1. seatPan — opponents come from their side of the table (4 and 3 players)
 *   2. Event → sound, with the animation timing (clacks land with the tiles; claims / Ron follow)
 *   3. Robustness — animations off → no delays; a throwing audio; disconnect; bad arguments
 *   4. Real Hong Kong + Chinese Official hands — one clack per discard, a claim sound per call, flowers, one ending sound per hand
 *   5. Real Riichi hands — the new game:riichi event → a riichi sound per declaration
 *
 * Run: node tests/audio/gameSoundBridge.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { EventBus } from '../../src/core/EventBus.js';
import { GameManager } from '../../src/core/GameManager.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { connectGameSounds, seatPan, CLAIM_SOUNDS } from '../../src/audio/GameSoundBridge.js';
import { getSoundNames } from '../../src/audio/SoundLibrary.js';

function recorder() {
  const plays = [];
  return { plays, play: (name, opts = {}) => { plays.push({ name, ...opts }); return { played: true }; } };
}
const TIMING = { drawMs: 200, discardMs: 230 };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---------------------------------------------------------------------------
section('1. seatPan', () => {
  assert([0, 1, 2, 3].map((s) => seatPan(s, 0, 4)).join() === '0,0.55,0,-0.55', '4 players from seat 0: you centre, right +, across centre, left −');
  assert([0, 1, 2, 3].map((s) => seatPan(s, 2, 4)).join() === '0,-0.55,0,0.55', '…relative to whichever seat is yours');
  assert([0, 1, 2].map((s) => seatPan(s, 0, 3)).join() === '0,0.55,-0.55', '3 players: right, left');
  assert(seatPan(undefined, 0, 4) === 0 && seatPan(1, 0, 1) === 0, 'unknown seat / odd table → centred');
});

// ---------------------------------------------------------------------------
section('2. Event → sound', () => {
  const bus = new EventBus();
  const a = recorder();
  let clock = 1000;
  connectGameSounds(bus, a, { humanSeatIndex: 0, playerCount: 4, timing: () => TIMING, now: () => clock });
  bus.emit('game:tile-drawn', { seatIndex: 0 });
  assert(a.plays.length === 1 && a.plays[0].name === 'draw', 'your draw → "draw"');
  bus.emit('game:tile-drawn', { seatIndex: 1 });
  assert(a.plays.length === 1, 'an opponent’s draw is silent (their discard follows at once)');
  bus.emit('game:tile-discarded', { seatIndex: 1 });
  const d1 = a.plays.at(-1);
  assert(d1.name === 'discard-soft' && near(d1.delay, 0.43) && d1.pan === 0.55 && d1.volume < 1, `opponent's discard right after their draw: soft, on their side, landing after the draw + discard flights (${d1.delay}s)`);
  bus.emit('game:claim', { seatIndex: 2, type: 'pon' });
  const c = a.plays.at(-1);
  assert(c.name === 'claim-pon' && near(c.delay, 0.49) && c.pan === 0, `a Pon on that discard follows its clack (${c.delay}s), from across the table`);
  clock += 2000;
  bus.emit('game:tile-discarded', { seatIndex: 0 });
  assert(a.plays.at(-1).name === 'discard' && near(a.plays.at(-1).delay, 0.23) && !a.plays.at(-1).pan, 'your discard: the full clack, landing with your tile');
  clock += 2000;
  bus.emit('game:claim', { seatIndex: 3, type: 'kong' });
  assert(a.plays.at(-1).name === 'claim-kong' && a.plays.at(-1).delay === 0 && a.plays.at(-1).pan === -0.55, 'a self-declared Kong (no discard just before) sounds at once');
  bus.emit('game:claim', { seatIndex: 3, type: 'chi' });
  assert(a.plays.at(-1).name === 'claim-chi', 'Chi');
  const before = a.plays.length;
  bus.emit('game:claim', { seatIndex: 3, type: 'win' });
  assert(a.plays.length === before, 'a claim type with no sound (a Ron claim — the round-over sound covers it) → nothing');
  bus.emit('game:riichi', { seatIndex: 1 });
  assert(a.plays.at(-1).name === 'riichi' && a.plays.at(-1).pan === 0.55, 'riichi');
  bus.emit('game:bonus-tile', { seatIndex: 0 });
  bus.emit('game:bonus-tile', { seatIndex: 2 });
  assert(a.plays.at(-2).name === 'flower' && a.plays.at(-1).volume < a.plays.at(-2).volume, 'flowers set aside chime (quieter for opponents)');
  bus.emit('game:round-over', { outcome: { type: 'win', winners: [{ seatIndex: 0 }] } });
  assert(a.plays.at(-1).name === 'win', 'you win → the fanfare');
  bus.emit('game:tile-discarded', { seatIndex: 2 });
  bus.emit('game:round-over', { outcome: { type: 'win', winners: [{ seatIndex: 1 }, { seatIndex: 3 }] } });
  assert(a.plays.at(-1).name === 'win-other' && near(a.plays.at(-1).delay, 0.31), `someone else wins (Ron) → "win-other" after the clack (${a.plays.at(-1).delay}s)`);
  clock += 2000;
  bus.emit('game:round-over', { outcome: { type: 'draw', results: [] } });
  bus.emit('game:round-over', { outcome: { type: 'abortive', reason: 'four-winds' } });
  assert(a.plays.slice(-2).every((p) => p.name === 'draw-game' && p.delay === 0), 'an exhausted wall or an abortive draw → "draw-game"');
  const names = new Set(getSoundNames());
  assert(a.plays.every((p) => names.has(p.name)) && Object.values(CLAIM_SOUNDS).every((n) => names.has(n)), 'every sound the bridge plays exists in the library');
});

// ---------------------------------------------------------------------------
section('3. Robustness', () => {
  const bus = new EventBus();
  const a = recorder();
  connectGameSounds(bus, a, { humanSeatIndex: 0, playerCount: 4, timing: () => null });
  bus.emit('game:tile-drawn', { seatIndex: 2 });
  bus.emit('game:tile-discarded', { seatIndex: 2 });
  bus.emit('game:claim', { seatIndex: 1, type: 'chi' });
  assert(a.plays.every((p) => (p.delay ?? 0) === 0), 'animations off → every sound at once');
  const bus2 = new EventBus();
  connectGameSounds(bus2, { play: () => { throw new Error('audio bug'); } }, { humanSeatIndex: 0, playerCount: 4, timing: () => { throw new Error('timing bug'); } });
  let threw = false;
  try { bus2.emit('game:tile-discarded', { seatIndex: 0 }); bus2.emit('game:round-over', { outcome: { type: 'win', winners: [] } }); } catch { threw = true; }
  assert(!threw, 'a throwing audio / timing never reaches the game');
  const bus3 = new EventBus();
  const r = recorder();
  const bridge = connectGameSounds(bus3, r, { humanSeatIndex: 0, playerCount: 3 });
  bridge.disconnect(); bridge.disconnect();
  bus3.emit('game:tile-discarded', { seatIndex: 0 });
  assert(r.plays.length === 0 && !bridge.isConnected(), 'disconnect (twice is fine) → silent');
  assertThrows(() => connectGameSounds(null, r, { humanSeatIndex: 0, playerCount: 4 }), TypeError, 'needs an event bus');
  assertThrows(() => connectGameSounds(bus3, {}, { humanSeatIndex: 0, playerCount: 4 }), TypeError, 'needs an audio player');
  assertThrows(() => connectGameSounds(bus3, r, {}), TypeError, 'needs the seat and table size');
});

// ---------------------------------------------------------------------------
const rng = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** Plays `hands` hands of an all-AI game, recording bus events and bridge sounds. */
function playAndListen(makeRules, playerCount, seed, hands) {
  const bus = new EventBus();
  const cfg = buildPlayerConfigs({ playerCount, difficulty: 'basic', humanSeatIndex: -1 });
  const random = rng(seed);
  const gm = new GameManager({ ruleEngine: makeRules(playerCount), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg, { factories: { basic: () => new BasicStrategy({ random }) } }), eventBus: bus, seed });
  const events = [];
  for (const e of ['game:tile-drawn', 'game:tile-discarded', 'game:claim', 'game:riichi', 'game:bonus-tile', 'game:round-over']) bus.on(e, (p) => events.push({ e, p }));
  const a = recorder();
  connectGameSounds(bus, a, { humanSeatIndex: 0, playerCount, timing: () => TIMING });
  for (let h = 0; h < hands; h++) {
    if (h > 0) { if (gm.isGameComplete()) break; gm.startNextHand(); }
    for (let i = 0; i < 1000 && !gm.isRoundOver(); i++) gm.playAITurn();
    gm.settleRound();
  }
  const count = (name) => a.plays.filter((p) => p.name === name).length;
  const ev = (name, f = () => true) => events.filter((x) => x.e === name && f(x.p)).length;
  return { a, events, count, ev };
}

section('4. Real Hong Kong + Chinese Official hands', () => {
  for (const [label, make, n] of [['Hong Kong 4P', () => new HongKongRules(), 4], ['Chinese Official 3P', (pc) => new ChineseOfficialRules({ playerCount: pc }), 3]]) {
    const { count, ev } = playAndListen(make, n, 77, 4);
    const discards = ev('game:tile-discarded');
    assert(discards > 20 && count('discard') + count('discard-soft') === discards, `${label}: one clack per discard (${discards})`);
    assert(count('discard') === ev('game:tile-discarded', (p) => p.seatIndex === 0), `${label}: the full clack only for seat 0 (yours)`);
    assert(count('draw') === ev('game:tile-drawn', (p) => p.seatIndex === 0), `${label}: a draw sound for each of your draws only (${count('draw')})`);
    const calls = ev('game:claim', (p) => p.type in CLAIM_SOUNDS);
    assert(count('claim-chi') + count('claim-pon') + count('claim-kong') === calls, `${label}: a claim sound per Chi / Pon / Kong (${calls})`);
    assert(count('win') + count('win-other') + count('draw-game') === ev('game:round-over'), `${label}: exactly one ending sound per hand (${ev('game:round-over')})`);
    assert(count('flower') === ev('game:bonus-tile'), `${label}: a chime per flower set aside (${ev('game:bonus-tile')})`);
  }
  const mcr = playAndListen((pc) => new ChineseOfficialRules({ playerCount: pc }), 4, 5, 2);
  assert(mcr.ev('game:bonus-tile') > 0 && mcr.count('flower') === mcr.ev('game:bonus-tile'), `Chinese Official 4P really sets flowers aside (${mcr.ev('game:bonus-tile')}) — each chimes`);
});

section('5. Real Riichi hands', () => {
  let declared = 0; let sounded = 0;
  for (const seed of [3, 11, 19]) {
    const { count, ev } = playAndListen((pc) => new RiichiRules({ playerCount: pc }), 4, seed, 4);
    declared += ev('game:riichi');
    sounded += count('riichi');
  }
  assert(declared > 0 && sounded === declared, `GameManager now emits game:riichi on every declaration (${declared}) — each gets the riichi sound`);
});

summary();
