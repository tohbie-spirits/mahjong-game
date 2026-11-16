/**
 * hintAdvisor.test.mjs — Tasks 116–117: src/ai/HintAdvisor.js, on rigged
 * hands and on whole REAL hands where seat 0 does exactly what the hints say.
 *
 * Sections:
 *   1. Hong Kong — the hint is the Advanced AI's own choice; ready waits checked by the engine; Self-drawn-only waits flagged
 *   2. Hong Kong — a cheap hand: the value route; a fake strategy's fold decision passes through with its danger
 *   3. Choices after a draw — win, Kong / pass on Kong, nothing to do
 *   4. Riichi (Task 117) — riichi declaration advice, the riichi lock, furiten, no yaku (fixed by riichi), nine terminals
 *   5. Chinese Official (Task 117) — the route to 8 points, flowers don't count, dead waits are consistent with the engine
 *   6. The hint bot — whole hands of all three rulesets with seat 0 following every hint:
 *      always a legal tile, every "you can win on X" verified independently, no errors
 *
 * Run: node tests/ai/hintAdvisor.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { GameManager } from '../../src/core/GameManager.js';
import { WallManager } from '../../src/core/WallManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { Tile } from '../../src/core/Tile.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { AIManager } from '../../src/ai/AIManager.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AdvancedStrategy } from '../../src/ai/advanced/AdvancedStrategy.js';
import { buildPlayerConfigs, createAIManagerForSeats } from '../../src/ai/StrategyRegistry.js';
import { HintAdvisor, HINT_NOTE } from '../../src/ai/HintAdvisor.js';
import { SEAT_KIND, TURN_PHASE, ACTION_TYPE, WIN_SOURCE } from '../../src/utils/constants.js';

let n = 0;
const t = (id) => Tile.fromId(id, `${id}#h${++n}`);
const S = { d: 'dots', b: 'bamboo', c: 'characters' };
const H = { E: 'wind-east', S: 'wind-south', W: 'wind-west', N: 'wind-north', R: 'dragon-red', G: 'dragon-green', P: 'dragon-white' };
const tl = (spec) => spec.split(' ').filter(Boolean).flatMap((p) => (H[p[0]] ? [...p].map((ch) => t(H[ch])) : [...p.slice(0, -1)].map((d) => t(`${S[p.at(-1)]}-${d}`))));
const IDLE = ['258b 258c 369b 369c E', '147b 147c 9b 9c SWN', '6b 6c 8b 8c 4b 4c RGP 7c'];

/** A table where seat 0 (human) holds `hand` and must discard (or draw `draw` first). */
function rig(rules, hand, { draw = null, wall = '1c 2c 3c 4c 5c 6c 7c 8c 9c 5d 5d 5d 6d 6d 7d 7d 1b 1b 1b 1b 2b 2b 2b 2b 3b 3b 3b 3b', players = 4, flowStart = false } = {}) {
  const cfg = Array.from({ length: players }, (_, i) => ({ seatIndex: i, displayName: i ? `AI ${i}` : 'You', seatKind: i ? SEAT_KIND.AI : SEAT_KIND.HUMAN, aiDifficulty: i ? 'basic' : null }));
  const gm = new GameManager({ ruleEngine: rules, playerConfigs: cfg, aiManager: new AIManager({ strategies: [new BasicStrategy({ random: () => 0.5 })] }), eventBus: new EventBus(), seed: 1, dealerIndex: 0 });
  gm.getPlayers().forEach((p, i) => { p.resetForNewHand(); for (const x of tl(i === 0 ? hand : IDLE[(i - 1) % 3])) p.addTileToHand(x); });
  const w = new WallManager(tl(`${draw ?? ''} ${wall}`));
  if (rules.getRulesetId() === 'riichi') w.reserveDeadWall(14);
  gm._wall = w;
  if (flowStart) gm.getTurnFlow()?.onHandStart();
  gm.getTurnManager().forceSetTurn(0, draw ? TURN_PHASE.AWAITING_DRAW : TURN_PHASE.AWAITING_DISCARD);
  return gm;
}
const adv = new HintAdvisor();
const hintFor = (gm) => adv.discardHint(gm.getPlayer(0), gm.getDecisionContext(0));
const complete = (rules, hand, faceId) => { const v = hand.clone(); v.addConcealedTile(t(faceId)); return rules.checkWin(v).isWin; };

// ---------------------------------------------------------------------------
section('1. Hong Kong — the AI’s choice, engine-checked waits', () => {
  const gm = rig(new HongKongRules(), '123d 456d 789d 11b 23b N');
  const h = hintFor(gm);
  const own = new AdvancedStrategy({ random: () => 0.5 }).chooseDiscard(gm.getPlayer(0), gm.getDecisionContext(0));
  assert(h.kind === 'discard' && h.faceId === 'wind-north' && own.id === h.faceId, 'the hint is exactly what the Advanced AI would discard (North)');
  assert(h.shanten === 0 && h.waits.map((w) => w.faceId).join() === 'bamboo-1,bamboo-4', `ready, waiting on 1 / 4 of Bamboo (${h.waits.map((w) => w.faceId)})`);
  const kept = gm.getPlayer(0).getHand().clone(); kept.removeConcealedTile(h.tile);
  assert(h.waits.every((w) => complete(gm.getRuleEngine(), kept, w.faceId)), 'every wait really completes the hand (engine)');
  assert(h.waits.every((w) => w.ron === false && w.tsumo === true), 'Hong Kong 3-fan minimum: All Chows + Concealed = 2 on a discard; with Self-drawn = 3 → tsumo only');
  assert(h.notes.some((x) => x.code === HINT_NOTE.TSUMO_ONLY && x.faceIds.length === 2), 'flagged "tsumo-only"');
  assert(h.waits.find((w) => w.faceId === 'bamboo-1').live === 2 && h.waits.find((w) => w.faceId === 'bamboo-4').live === 4, 'live counts: 1-Bamboo has two copies left (you hold two), 4-Bamboo four');
  assert(h.alternatives.length >= 1 && h.alternatives.every((a) => a.faceId !== 'wind-north'), 'the next-best discards are listed');
  assertThrows(() => adv.discardHint(null, {}), TypeError, 'needs a player');
  assertThrows(() => adv.discardHint(gm.getPlayer(0), {}), TypeError, 'needs a decision context');
});

// ---------------------------------------------------------------------------
section('2. Hong Kong — value, defence', () => {
  const gm = rig(new HongKongRules(), '123d 456d 2b 3b 6c 7c RR SS');
  const h = hintFor(gm);
  assert(h.valueShanten > h.shanten, `a hand close to complete but not to 3 fan (shanten ${h.shanten}, value ${h.valueShanten})`);
  const route = h.notes.find((x) => x.code === HINT_NOTE.VALUE_ROUTE);
  assert(route && route.minimum === 3 && route.fan >= 3 && typeof route.route === 'string', `the fastest route that reaches the minimum is named (${JSON.stringify(route)})`);
  const tile = gm.getPlayer(0).getHand().concealedTiles[0];
  const stub = { chooseDiscard: () => tile, lastDiscardMode: 'fold', lastDecision: { mode: 'fold', threat: 0.9, discardIndex: 0, candidates: [{ discardIndex: 0, shanten: 3, ukeire: 10, danger: 0.02 }, { discardIndex: 31, shanten: 2, ukeire: 20, danger: 0.4 }] } };
  const f = new HintAdvisor({ strategy: stub }).discardHint(gm.getPlayer(0), gm.getDecisionContext(0));
  assert(f.mode === 'fold' && f.danger === 0.02 && f.threat === 0.9 && f.alternatives[0].faceId === 'dragon-red', 'the defence layer’s fold decision and its danger numbers pass through');
});

// ---------------------------------------------------------------------------
section('3. Choices after a draw', () => {
  const gm = rig(new HongKongRules(), '111d 222d 333d 777d 5d', { draw: '5d' });
  const d = gm.performDraw();
  const a = adv.actionHint(gm.getPlayer(0), d.actions, gm.getDecisionContext(0));
  assert(a.reason === 'win' && a.action.type === ACTION_TYPE.WIN, 'a winning draw → declare it');
  const g2 = rig(new HongKongRules(), '1111d 234b 567b 99c 5d', { draw: '4c' });
  const d2 = g2.performDraw();
  const kong = d2.actions.filter((x) => x.type === ACTION_TYPE.KONG);
  const a2 = adv.actionHint(g2.getPlayer(0), d2.actions, g2.getDecisionContext(0));
  assert(kong.length === 1 && (a2.reason === 'kong-concealed' || a2.reason === 'kong-slows') && ['kong', 'pass'].includes(a2.action.type), `a concealed Kong is judged by the AI (${a2.reason})`);
  assert(a2.reason !== 'kong-concealed' || a2.action === kong[0], 'the suggested Kong is the offered action object itself (the prompt can mark it)');
  assert(adv.actionHint(g2.getPlayer(0), [{ type: ACTION_TYPE.DISCARD }], g2.getDecisionContext(0)).action.type === ACTION_TYPE.PASS, 'nothing to declare → pass');
  assertThrows(() => adv.actionHint(g2.getPlayer(0), [], {}), TypeError, 'needs actions');
});

// ---------------------------------------------------------------------------
section('4. Riichi (Task 117)', () => {
  // Riichi offered: closed, one away after the draw.
  const gm = rig(new RiichiRules(), '123d 456d 789d 55b 6b 7b', { draw: '9c', flowStart: true });
  const d = gm.performDraw();
  const riichi = d.actions.find((x) => x.type === ACTION_TYPE.RIICHI);
  const a = adv.actionHint(gm.getPlayer(0), d.actions, gm.getDecisionContext(0));
  assert(riichi && a.reason === 'riichi' && a.action === riichi && riichi.allowedTiles.some((x) => x.instanceId === a.tile.instanceId), `riichi offered → declare it, with an allowed discard (${a.faceId}, waits ${a.waits})`);
  assert(a.waits.length >= 1, 'with the waits it leaves');
  // In riichi, the next turn: the lock.
  gm.declareRiichi(a.tile);
  for (let i = 0; i < 20 && gm.getTurnManager().getCurrentPlayerIndex() !== 0 && !gm.isRoundOver(); i++) gm.playAITurn();
  if (!gm.isRoundOver() && gm.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DRAW) {
    const d2 = gm.performDraw();
    if (!d2.actions.some((x) => x.type === ACTION_TYPE.WIN)) {
      const h = hintFor(gm);
      assert(h.mode === 'forced' && h.notes.some((x) => x.code === HINT_NOTE.RIICHI_LOCK) && h.tile.instanceId === gm.getLastDrawnTile().instanceId, 'in riichi: the hint is the drawn tile (riichi lock)');
    } else assert(true, '(won straight away — lock not reached)');
  } else assert(true, '(hand ended before your next turn)');

  // Furiten: waiting on a tile you discarded.
  const f = rig(new RiichiRules(), '123d 456d 789d 55b 6b 7b E', { flowStart: true });
  f.getPlayer(0).getDiscardPile().discard(t('bamboo-8'));
  const hf = hintFor(f);
  const fur = hf.notes.find((x) => x.code === HINT_NOTE.FURITEN);
  assert(hf.faceId === 'wind-east' && fur && fur.faceIds.includes('bamboo-8'), `waiting on 5/8 of Bamboo with an 8 already discarded → furiten (${JSON.stringify(fur)})`);

  // No yaku: closed, kanchan wait with terminals — only riichi (or self-draw) makes it a win.
  const y = rig(new RiichiRules(), '123d 456d 789b 11c 2c 4c N', { flowStart: true });
  const hy = hintFor(y);
  assert(hy.faceId === 'wind-north' && hy.waits.map((w) => w.faceId).join() === 'characters-3', 'ready on a closed wait (3 of Characters)');
  assert(hy.waits[0].ron === false && hy.notes.some((x) => x.code === HINT_NOTE.NO_YAKU && x.fixedByRiichi), 'no yaku for a Ron — the hint says riichi would fix it (checked with the engine)');
  assert(!hy.notes.some((x) => x.code === HINT_NOTE.TSUMO_ONLY || x.code === HINT_NOTE.DEAD_WAITS), '…and doesn’t also call it dead / tsumo-only');

  // Nine terminals on the first draw: 9 kinds → redeal; 12 kinds → play on for Thirteen Orphans (the AI's rule: 11+).
  const firstDraw = (hand, draw) => { const g = rig(new RiichiRules(), hand, { draw, flowStart: true }); const d0 = g.performDraw(); return { d0, a: adv.actionHint(g.getPlayer(0), d0.actions, g.getDecisionContext(0)) }; };
  const nine = firstDraw('19d 19b 9c ESW 23d 56b 7c', 'N');
  assert(nine.d0.actions.some((x) => x.type === ACTION_TYPE.ABORTIVE_DRAW) && nine.a.reason === 'nine-terminals' && nine.a.kinds === 9, `9 different terminals / honours → call the abortive draw (${nine.a.reason}, ${nine.a.kinds})`);
  const twelve = firstDraw('19d 19b 19c ESW RG 56d', 'N');
  assert(twelve.d0.actions.some((x) => x.type === ACTION_TYPE.ABORTIVE_DRAW) && twelve.a.reason === 'go-for-orphans' && twelve.a.kinds === 12, `12 kinds → play on for Thirteen Orphans (${twelve.a.reason}, ${twelve.a.kinds})`);
  const ready13 = firstDraw('19d 19b 19c ESWN RG 5d', 'P');
  assert(ready13.a.reason === 'riichi' && ready13.a.faceId === 'dots-5', `all 13 kinds — already one tile from Thirteen Orphans: declare riichi, throwing the 5 of Dots (${ready13.a.reason} ${ready13.a.faceId})`);
});

// ---------------------------------------------------------------------------
section('5. Chinese Official (Task 117)', () => {
  const gm = rig(new ChineseOfficialRules(), '123d 46d 2b 3b 567c 99b E S');
  const h = hintFor(gm);
  const route = h.notes.find((x) => x.code === HINT_NOTE.VALUE_ROUTE);
  assert(h.valueShanten > h.shanten && route && route.ruleset === 'chinese_official' && route.minimum === 8 && route.points >= 8, `a cheap shape: the fastest MCR route to 8 points is named (${route?.route}, ${route?.points} pts)`);
  const ctx = { ...gm.getDecisionContext(0), table: { ...gm.getDecisionContext(0).table, bonusTiles: [[t('flower-1'), t('season-2')], [], [], []] } };
  const hf = adv.discardHint(gm.getPlayer(0), ctx);
  assert(hf.notes.some((x) => x.code === HINT_NOTE.FLOWERS && x.count === 2), 'with flowers set aside: "flowers don’t count toward 8"');
  const r = rig(new ChineseOfficialRules(), '123d 456d 789b 11c 23c N');
  const hr = hintFor(r);
  const anyWin = hr.waits.some((w) => w.ron || w.tsumo);
  assert(hr.shanten === 0 && hr.waits.length > 0 && hr.notes.some((x) => x.code === HINT_NOTE.DEAD_WAITS) === !anyWin, `ready: "dead waits" exactly when no wait reaches 8 points for the engine (any wins: ${anyWin})`);
});

// ---------------------------------------------------------------------------
section('6. The hint bot', () => {
  const rng = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };
  for (const [name, make] of [['Hong Kong', () => new HongKongRules()], ['Riichi', () => new RiichiRules()], ['Chinese Official', () => new ChineseOfficialRules()]]) {
    let hints = 0; let illegal = 0; let badWaits = 0; let errors = 0; let wins = 0; let hands = 0; let actions = 0;
    for (const seed of [5, 17, 29]) {
      const cfg = buildPlayerConfigs({ playerCount: 4, difficulty: 'basic', humanSeatIndex: 0 });
      const random = rng(seed);
      const gm = new GameManager({ ruleEngine: make(), playerConfigs: cfg, aiManager: createAIManagerForSeats(cfg, { factories: { basic: () => new BasicStrategy({ random }) } }), eventBus: new EventBus(), seed });
      const advisor = new HintAdvisor();
      for (let hand = 0; hand < 3; hand++) {
        if (hand) { if (gm.isGameComplete()) break; gm.startNextHand(); }
        hands++;
        for (let step = 0; step < 600 && !gm.isRoundOver(); step++) {
          const tm = gm.getTurnManager();
          if (tm.getCurrentPlayerIndex() !== 0) { gm.playAITurn(); continue; }
          try {
            if (tm.getPhase() === TURN_PHASE.AWAITING_DRAW) {
              const d = gm.performDraw();
              if (d.type === 'exhausted') break;
              let acts = d.actions;
              for (let k = 0; k < 4; k++) {
                const choices = acts.filter((a) => [ACTION_TYPE.WIN, ACTION_TYPE.KONG, ACTION_TYPE.RIICHI, ACTION_TYPE.ABORTIVE_DRAW].includes(a.type));
                if (!choices.length) break;
                const a = advisor.actionHint(gm.getPlayer(0), acts, gm.getDecisionContext(0));
                actions++;
                if (a.action.type === ACTION_TYPE.WIN) { gm.declareTsumo(); break; }
                if (a.action.type === ACTION_TYPE.ABORTIVE_DRAW) { gm.declareAbortiveDraw(); break; }
                if (a.action.type === ACTION_TYPE.RIICHI) { gm.declareRiichi(a.tile); break; }
                if (a.action.type === ACTION_TYPE.KONG) {
                  const kg = gm.declareKong(a.action);
                  if (kg.robbed || !kg.draw || kg.draw.type === 'exhausted') break;
                  acts = kg.draw.actions; continue;
                }
                break;
              }
              if (gm.isRoundOver() || tm.getCurrentPlayerIndex() !== 0 || tm.getPhase() !== TURN_PHASE.AWAITING_DISCARD) continue;
            }
            const ctx = gm.getDecisionContext(0);
            const h = advisor.discardHint(gm.getPlayer(0), ctx);
            hints++;
            const concealed = gm.getPlayer(0).getHand().concealedTiles;
            const allowed = ctx.allowedDiscards;
            if (!concealed.some((x) => x.instanceId === h.tile.instanceId) || (allowed && !allowed.some((x) => x.instanceId === h.tile.instanceId))) illegal++;
            const kept = gm.getPlayer(0).getHand().clone(); kept.removeConcealedTile(h.tile);
            for (const w of h.waits) {
              const v = kept.clone(); const probe = t(w.faceId); v.addConcealedTile(probe);
              if (!gm.getRuleEngine().checkWin(v).isWin) badWaits++;
              const meetsRon = gm.getRuleEngine().scoreHand(v, { winningTile: probe, winType: WIN_SOURCE.DISCARD, seatWind: ctx.seatWind, roundWind: ctx.roundWind, isLastTile: false, ...((ctx.table.riichiSeats ?? []).includes(0) ? { isRiichi: true } : {}) }).meetsMinimum;
              if (!!meetsRon !== w.ron) badWaits++;
            }
            gm.performDiscard(h.tile);
          } catch (e) { errors++; if (errors < 3) console.error(e); break; }
        }
        if (gm.isRoundOver() && gm.getLastOutcome()?.winners?.some((w) => w.seatIndex === 0)) wins++;
        if (gm.isRoundOver()) gm.settleRound();
      }
    }
    assert(hints > 30 && illegal === 0 && badWaits === 0 && errors === 0, `${name}: ${hands} hands played by following the hints — ${hints} discard hints, ${actions} choices, all legal, every wait verified, no errors (${wins} wins)`);
  }
});

summary();
