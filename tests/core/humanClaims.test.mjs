/**
 * humanClaims.test.mjs — Task 118: the human seat calls Chi / Pon / Kong on
 * other players' discards (found by the regression QA pass: until now the
 * engine silently passed them for the human).
 *
 * Sections:
 *   1. Off by default — the pre-Task-118 rule (no prompt; Ron automatic)
 *   2. Pon — the discard waits on the human; everything else refused meanwhile; the call lands
 *   3. Pass — the discard stays in the pile and play moves on as if never asked
 *   4. Who may call what — Chi only from the left; an AI's better call makes the human's moot; Ron stays automatic
 *   5. Kong — the claimer draws a replacement next
 *   6. Riichi — in riichi no Pon / Chi is offered; a riichi discard you call still takes the stick
 *   7. Hints — claimHint picks one of the offered calls (the same object) or a pass; its context carries the discard
 *   8. The prompt — names the discard in its heading, and the buttons use the ruleset's words (Pung / Chow / Kan)
 *
 * Run: node tests/core/humanClaims.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { GameManager } from '../../src/core/GameManager.js';
import { WallManager } from '../../src/core/WallManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { Tile } from '../../src/core/Tile.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { AIManager } from '../../src/ai/AIManager.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { HintAdvisor } from '../../src/ai/HintAdvisor.js';
import { buildSnapshot } from '../../src/persistence/GameSnapshot.js';
import { SEAT_KIND, TURN_PHASE, ACTION_TYPE } from '../../src/utils/constants.js';
import { installFakeDom } from '../_helpers/fakeDom.mjs';
import { renderClaimPrompt, describeAction } from '../../src/ui/dialogs/ClaimPromptDialog.js';

const { document } = installFakeDom();

let n = 0;
const t = (id) => Tile.fromId(id, `${id}#q${++n}`);
const S = { d: 'dots', b: 'bamboo', c: 'characters' };
const H = { E: 'wind-east', S: 'wind-south', W: 'wind-west', N: 'wind-north', R: 'dragon-red', G: 'dragon-green', P: 'dragon-white' };
const tl = (spec) => spec.split(' ').filter(Boolean).flatMap((p) => (H[p[0]] ? [...p].map((ch) => t(H[ch])) : [...p.slice(0, -1)].map((d) => t(`${S[p.at(-1)]}-${d}`))));

/** Seat 0 human with `human`; seats 1–3 AI with the given hands; `discarder` holds `tile` and must discard. */
function table({ rules = new HongKongRules(), human, ai, discarder, tile, draw = null, prompts = true, wall = '1c 2c 3c 4c 5c 6c 7c 8c 9c 5d 6d 7d 1b 1b 1b 2b 2b 2b 3b 3b 3b 4b 4b 4b 6b 6b 6b 7b 7b 7b', claimAll = false }) {
  const cfg = [0, 1, 2, 3].map((i) => ({ seatIndex: i, displayName: i ? `AI ${i}` : 'You', seatKind: i ? SEAT_KIND.AI : SEAT_KIND.HUMAN, aiDifficulty: i ? 'basic' : null }));
  const basic = new BasicStrategy({ random: () => 0.5 });
  if (!claimAll) basic.chooseClaim = () => ({ type: ACTION_TYPE.PASS }); // the AIs stay out of the way unless a case needs them
  const bus = new EventBus();
  const gm = new GameManager({ ruleEngine: rules, playerConfigs: cfg, aiManager: new AIManager({ strategies: [basic] }), eventBus: bus, seed: 1, dealerIndex: 0 });
  const hands = [human, ...ai];
  gm.getPlayers().forEach((p, i) => { p.resetForNewHand(); for (const x of tl(hands[i])) p.addTileToHand(x); });
  const w = new WallManager(tl(`${draw ?? ''} ${wall}`));
  if (rules.getRulesetId() === 'riichi') w.reserveDeadWall(14);
  gm._wall = w;
  gm.getTurnFlow()?.onHandStart();
  gm.getTurnManager().forceSetTurn(discarder, draw ? TURN_PHASE.AWAITING_DRAW : TURN_PHASE.AWAITING_DISCARD);
  if (draw) gm.performDraw();
  if (prompts) gm.setHumanClaimPrompts(true);
  const discard = gm.getPlayer(discarder).getHand().concealedTiles.find((x) => x.id === tile);
  const events = [];
  for (const e of ['game:claim', 'game:tile-discarded']) bus.on(e, (d) => events.push([e, d]));
  return { gm, discard, events };
}
const IDLE = ['147b 147c 9b 9c 2d SWN', '258b 258c 369b 3c 4d', '369c 8b 8c 1d E RGP 2c'];
/** Every tile on the table, once each (the rig isn't a full set, so count against the rig's own start). */
const census = (gm) => { const ids = []; for (const p of gm.getPlayers()) { ids.push(...p.getHand().concealedTiles.map((x) => x.instanceId)); for (const m of p.getHand().melds) ids.push(...m.tiles.map((x) => x.instanceId)); } for (const p of gm.getPlayers()) for (const e of p.getDiscardPile().entries) if (!e.claimed) ids.push(e.tile.instanceId); return { total: ids.length + gm.getWall().remainingCount, unique: new Set(ids).size === ids.length }; };
// Seat 0 holds a pair of 5 Dots; seat 1 discards a 5 of Dots (it also holds IDLE[0]'s tiles).
const PON = () => table({ human: '55d 123b 456c 789b EW', ai: ['5d 147b 147c 9b 9c SWN EE', IDLE[1], IDLE[2]], discarder: 1, tile: 'dots-5' });

// ---------------------------------------------------------------------------
section('1. Off by default', () => {
  const { gm, discard } = table({ human: '55d 123b 456c 789b EW', ai: ['5d 147b 147c 9b 9c SWN EE', IDLE[1], IDLE[2]], discarder: 1, tile: 'dots-5', prompts: false });
  assert(gm.getHumanClaimPrompts() === false, 'a new GameManager does not prompt (AI-only tables and older tests unchanged)');
  const r = gm.performDiscard(discard);
  assert(r.type === 'discarded' && !r.claim && gm.getPendingClaim() === null, 'the human’s Pon is not taken (the pre-Task-118 rule)');
});

// ---------------------------------------------------------------------------
section('2. Pon', () => {
  const { gm, discard, events } = PON();
  const before = census(gm).total;
  const r = gm.performDiscard(discard);
  assert(r.type === 'awaiting-claim' && r.claimSeat === 0 && r.seatIndex === 1 && r.tile === discard, 'an AI discard the human can call stops for the human');
  assert(r.options.length === 1 && r.options[0].type === ACTION_TYPE.PON, `offered: ${r.options.map((a) => a.type)}`);
  const pend = gm.getPendingClaim();
  assert(pend.seatIndex === 0 && pend.fromSeat === 1 && pend.options[0] === r.options[0], 'getPendingClaim describes it (the same action objects)');
  assert(gm.getPlayer(1).getDiscardPile().tiles?.at?.(-1) === discard || events.some(([e, d]) => e === 'game:tile-discarded' && d.tile === discard), 'the discard is already on the table (announced)');
  assertThrows(() => gm.performDraw(), Error, 'drawing is refused meanwhile');
  assertThrows(() => gm.performDiscard(discard), Error, 'discarding is refused meanwhile');
  assert(gm.playAITurn().reason === 'awaiting-claim', 'playAITurn waits too (not-applicable: awaiting-claim)');
  assertThrows(() => buildSnapshot(gm, { rulesetId: 'hong_kong' }), Error, 'no save of a half-finished discard');
  assert(gm.getDecisionContext(0).discard?.tile === discard, 'the human’s decision context carries the discard');
  assertThrows(() => gm.resolveHumanClaim({ type: ACTION_TYPE.PON }), Error, 'only an offered action object is accepted');
  const res = gm.resolveHumanClaim(r.options[0]);
  const me = gm.getPlayer(0);
  assert(res.type === 'discarded' && res.claim?.action === r.options[0] && me.getHand().melds.length === 1 && me.getHand().concealedTiles.length === 11, 'the Pon lands: one meld, 11 tiles in hand');
  assert(gm.getTurnManager().getCurrentPlayerIndex() === 0 && gm.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DISCARD, 'and it is the human’s discard');
  assert(events.some(([e, d]) => e === 'game:claim' && d.seatIndex === 0 && d.type === ACTION_TYPE.PON), 'game:claim emitted (sound, announcer)');
  assert(gm.getPendingClaim() === null && census(gm).total === before && census(gm).unique, 'nothing pending; every tile still in exactly one place');
  assertThrows(() => gm.resolveHumanClaim({ type: ACTION_TYPE.PASS }), Error, 'nothing left to resolve');
});

// ---------------------------------------------------------------------------
section('3. Pass', () => {
  const { gm, discard } = PON();
  gm.performDiscard(discard);
  const res = gm.resolveHumanClaim({ type: ACTION_TYPE.PASS });
  assert(res.type === 'discarded' && !res.claim && !res.winners, 'pass: an ordinary discard');
  assert(gm.getTurnManager().getCurrentPlayerIndex() === 2 && gm.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DRAW, 'the next seat draws');
  assert(gm.getPlayer(0).getHand().melds.length === 0 && gm.playAITurn().type !== 'not-applicable', 'your hand untouched; play goes on');
});

// ---------------------------------------------------------------------------
section('4. Who may call what', () => {
  // Chi: seat 3 is the human's left (previous seat); seat 1 is not.
  const left = table({ human: '46d 123b 456c 789b EEW', ai: [IDLE[0] + ' 5c', IDLE[1], '5d 369c 8b 8c 1d E RGP 2c 3c'], discarder: 3, tile: 'dots-5' });
  const r = left.gm.performDiscard(left.discard);
  assert(r.type === 'awaiting-claim' && r.options.map((a) => a.type).join() === 'chi', 'Chi on the left player’s discard is offered');
  const right = table({ human: '46d 123b 456c 789b EEW', ai: ['5d 147b 147c 9b 9c SWN EE', IDLE[1], IDLE[2]], discarder: 1, tile: 'dots-5' });
  assert(right.gm.performDiscard(right.discard).type === 'discarded', 'from the right: no Chi, no prompt');
  // An AI's Pon outranks the human's Chi: no prompt, the AI takes it.
  const out = table({ human: '46d 123b 456c 789b EEW', ai: [IDLE[0] + ' 5c', '55d 258b 258c 369b', '5d 369c 8b 8c 1d E RGP 2c 3c'], discarder: 3, tile: 'dots-5', claimAll: true });
  const r2 = out.gm.performDiscard(out.discard);
  assert(r2.type === 'discarded' && r2.claim?.action.seatIndex === 2 && r2.claim.action.type === ACTION_TYPE.PON, 'an AI’s Pon beats the human’s Chi — the human isn’t asked');
  // Ron stays automatic.
  const ron = table({ human: '111d 222b 333c RRR 5d', ai: ['5d 147b 147c 9b 9c SWN EE', IDLE[1], IDLE[2]], discarder: 1, tile: 'dots-5' });
  const r3 = ron.gm.performDiscard(ron.discard);
  assert(r3.type === 'discarded' && r3.winners?.[0]?.seatIndex === 0 && ron.gm.getPendingClaim() === null, 'a legal Ron is still taken automatically');
});

// ---------------------------------------------------------------------------
section('5. Kong', () => {
  const { gm, discard } = table({ human: '555d 123b 456c 78b EW', ai: ['5d 147b 147c 9b 9c SWN EE', IDLE[1], IDLE[2]], discarder: 1, tile: 'dots-5' });
  const before = census(gm).total;
  const r = gm.performDiscard(discard);
  const kong = r.options.find((a) => a.type === ACTION_TYPE.KONG);
  assert(r.type === 'awaiting-claim' && kong && r.options.some((a) => a.type === ACTION_TYPE.PON), `Kong and Pon both offered (${r.options.map((a) => a.type)})`);
  gm.resolveHumanClaim(kong);
  assert(gm.getTurnManager().getCurrentPlayerIndex() === 0 && gm.getTurnManager().getPhase() === TURN_PHASE.AWAITING_DRAW, 'after the Kong you draw');
  const d = gm.performDraw();
  assert(d.type !== 'exhausted' && gm.getPlayer(0).getHand().concealedTiles.length === 11 && census(gm).total === before && census(gm).unique, 'a replacement tile: 4 in the Kong + 11 in hand');
});

// ---------------------------------------------------------------------------
section('6. Riichi', () => {
  const rules = new RiichiRules();
  const inR = table({ rules, human: '55d 123b 456c 789b EW', ai: ['5d 147b 147c 9b 9c SWN EE', IDLE[1], IDLE[2]], discarder: 1, tile: 'dots-5' });
  inR.gm.getTurnFlow()._hand.riichi[0] = { double: false, ippatsu: false }; // seat 0 already in riichi
  assert(inR.gm.performDiscard(inR.discard).type === 'discarded', 'in riichi the human is offered no Pon');
  // An AI declares riichi with a tile the human can Pon: the call is offered, and the stick is still taken.
  const ar = table({ rules: new RiichiRules(), human: '55d 123b 456c 789b EW', ai: ['123c 456c 789c 11b 23b', IDLE[1], IDLE[2]], discarder: 1, tile: 'dots-5', draw: '5d' });
  const act = ar.gm.getSelfActions().find((a) => a.type === ACTION_TYPE.RIICHI);
  const sticksBefore = ar.gm.getTurnFlow().riichiSticks ?? 0;
  const r = ar.gm.declareRiichi(act.allowedTiles.find((x) => x.id === 'dots-5'));
  assert(r.type === 'awaiting-claim' && r.riichi === true, 'an AI’s riichi discard you can Pon stops for you (riichi: true)');
  const res = ar.gm.resolveHumanClaim(r.options[0]);
  assert(res.riichi === true && ar.gm.getTurnFlow().isRiichi(1) && (ar.gm.getTurnFlow().riichiSticks ?? 0) === sticksBefore + 1, 'after your Pon the riichi stands and its stick is on the table');
});

// ---------------------------------------------------------------------------
section('7. Hints', () => {
  const adv = new HintAdvisor();
  const { gm, discard } = PON();
  const r = gm.performDiscard(discard);
  const h = adv.claimHint(gm.getPlayer(0), r.options, gm.getDecisionContext(0));
  assert(h.kind === 'claim' && (h.reason === 'pass-claim' ? h.action.type === ACTION_TYPE.PASS : r.options.includes(h.action)) && h.faceId === 'dots-5', `claimHint: ${h.reason} (an offered call or a pass)`);
  // A Pung of a valuable dragon that leaves the hand ready → call it.
  const dr = table({ human: 'RR 123b 456b 78b 11b W', ai: ['R 147b 147c 9b 9c SWN EE', IDLE[1], '369c 8b 8c 1d E GP 2c 4d'], discarder: 1, tile: 'dragon-red' });
  const r2 = dr.gm.performDiscard(dr.discard);
  const h2 = adv.claimHint(dr.gm.getPlayer(0), r2.options, dr.gm.getDecisionContext(0));
  assert(h2.reason === 'claim' && h2.type === ACTION_TYPE.PON && r2.options.includes(h2.action), 'a Red Dragon Pung that makes a one-suit hand ready (well over 3 fan) → call it');
  assertThrows(() => adv.claimHint(dr.gm.getPlayer(0), [], {}), TypeError, 'needs the offered calls');
});

// ---------------------------------------------------------------------------
section('8. The prompt', () => {
  const { gm, discard } = table({ human: '555d 46d 123b 456c EW', ai: ['5d 147b 147c 9b 9c SWN EE', IDLE[1], IDLE[2]], discarder: 1, tile: 'dots-5' });
  const r = gm.performDiscard(discard);
  const el = document.createElement('div');
  let picked = null;
  renderClaimPrompt(el, r.options, (a) => { picked = a; }, { title: 'AI 1 discards 5 of Dots', terms: { chi: 'Chow', pon: 'Pung', kong: 'Kong' } });
  const title = el.querySelector('.claim-prompt-title');
  const labels = el.querySelectorAll('.claim-prompt-btn').map((b) => b.textContent);
  assert(title.textContent === 'AI 1 discards 5 of Dots' && el.querySelector('.claim-prompt').getAttribute('aria-label') === 'AI 1 discards 5 of Dots', 'the heading (and the dialog\u2019s name) say whose discard');
  assert(labels.includes('Kong — 5 of Dots') && labels.includes('Pung — 5 of Dots') && labels.at(-1) === 'Pass', `Hong Kong words (${labels.join(' / ')})`);
  assert(describeAction({ type: ACTION_TYPE.PON, tile: t('dots-5') }, { terms: { pon: 'Pon' } }) === 'Pon — 5 of Dots' && describeAction({ type: ACTION_TYPE.KONG, kongType: 'exposed', faceId: 'dots-5' }, { terms: { kong: 'Kan' } }) === 'Kan — 5 of Dots', 'Riichi words (Pon / Kan)');
  assert(describeAction({ type: ACTION_TYPE.PON, tile: t('dots-5') }) === 'Pon — 5 of Dots', 'no terms: the old labels');
  const kongBtn = el.querySelectorAll('.claim-prompt-btn').find((b) => b.textContent.startsWith('Kong'));
  kongBtn.click?.() ?? kongBtn.dispatchEvent?.({ type: 'click' });
  assert(picked === r.options.find((a) => a.type === ACTION_TYPE.KONG), 'a button hands back the offered action object itself');
});

summary();
