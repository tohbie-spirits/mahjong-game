/**
 * handAndPlayers.test.mjs — rebuilt Tasks 16–18 + Task 42 helper:
 * Hand, Meld, createHandViewWithExtraTile, DiscardPile, PlayerManager.
 * Run: node tests/core/handAndPlayers.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { Tile } from '../../src/core/Tile.js';
import { Hand, Meld, createHandViewWithExtraTile } from '../../src/core/Hand.js';
import { DiscardPile } from '../../src/core/DiscardPile.js';
import { PlayerManager } from '../../src/core/PlayerManager.js';
import { MELD_TYPE, KONG_TYPE, SEAT_KIND, AI_DIFFICULTY, WIND, ACTION_TYPE } from '../../src/utils/constants.js';

const T = (id, copy = 1) => Tile.fromId(id, `${id}#${copy}`);

section('Meld validation', () => {
  const chi = new Meld({ type: MELD_TYPE.CHI, tiles: [T('dots-5'), T('dots-3'), T('dots-4')], calledFrom: 1, calledTile: undefined ?? null });
  assert(chi.tiles.map((t) => t.id).join() === 'dots-3,dots-4,dots-5', 'chi tiles sorted');
  const called = T('bamboo-7', 2);
  const pon = new Meld({ type: MELD_TYPE.PON, tiles: [T('bamboo-7'), called, T('bamboo-7', 3)], calledFrom: 2, calledTile: called });
  assert(pon.isPon && pon.faceId === 'bamboo-7' && pon.calledTile === called && !pon.concealed, 'pon');
  const ck = new Meld({ type: MELD_TYPE.KONG, tiles: [1, 2, 3, 4].map((c) => T('wind-east', c)), concealed: true });
  assert(ck.kongType === KONG_TYPE.CONCEALED && ck.concealed, 'concealed kong inferred');
  const added = pon.upgradeToKong(T('bamboo-7', 4));
  assert(added.isKong && added.kongType === KONG_TYPE.ADDED && added.tiles.length === 4, 'pon upgraded to added kong');
  assertThrows(() => new Meld({ type: MELD_TYPE.CHI, tiles: [T('dots-1'), T('dots-2'), T('bamboo-3')] }), TypeError, 'mixed-suit chi throws');
  assertThrows(() => new Meld({ type: MELD_TYPE.CHI, tiles: [T('wind-east'), T('wind-south'), T('wind-west')] }), TypeError, 'honour chi throws');
  assertThrows(() => new Meld({ type: MELD_TYPE.PON, tiles: [T('dots-1'), T('dots-1', 2), T('dots-2')] }), TypeError, 'mismatched pon throws');
  assertThrows(() => new Meld({ type: MELD_TYPE.KONG, tiles: [T('dots-1'), T('dots-1', 2), T('dots-1', 3)] }), TypeError, 'three-tile kong throws');
  assertThrows(() => new Meld({ type: MELD_TYPE.PON, tiles: [T('dots-1'), T('dots-1', 2), T('dots-1', 3)], calledTile: T('dots-1', 4) }), TypeError, 'calledTile outside meld throws');
  const back = Meld.fromJSON(JSON.parse(JSON.stringify(pon)));
  assert(back.type === 'pon' && back.calledTile.instanceId === called.instanceId && back.calledFrom === 2, 'meld JSON round-trip (calledTile by instanceId)');
});

section('Hand', () => {
  const h = new Hand([T('dots-9'), T('dots-1'), T('wind-east')]);
  assert(h.concealedCount === 3 && h.isConcealed, 'construct + count');
  const copy = h.concealedTiles; copy.pop();
  assert(h.concealedCount === 3, 'concealedTiles is a copy');
  h.sortConcealed();
  assert(h.concealedTiles[0].id === 'dots-1', 'sortConcealed');
  h.addConcealedTile(T('dots-1', 2));
  assert(h.countFace('dots-1') === 2 && h.hasFace('wind-east') && h.findByFace('dots-9'), 'countFace / hasFace / findByFace');
  const removed = h.removeConcealedByFace('dots-1', 2);
  assert(removed.length === 2 && h.countFace('dots-1') === 0, 'removeConcealedByFace');
  assertThrows(() => h.addConcealedTile(T('dots-9')), Error, 'duplicate instance rejected');
  assertThrows(() => h.removeConcealedTile('nope#1'), Error, 'removing a missing tile throws');
  const pon = new Meld({ type: MELD_TYPE.PON, tiles: [T('dots-2'), T('dots-2', 2), T('dots-2', 3)] });
  h.addMeld(pon);
  assert(h.meldCount === 1 && !h.isConcealed && h.effectiveSize === h.concealedCount + 3, 'melds + concealment + effective size');
  h.replaceMeld(0, pon.upgradeToKong(T('dots-2', 4)));
  assert(h.melds[0].isKong && h.allTiles.length === h.concealedCount + 4, 'replaceMeld + allTiles');
  const json = h.toJSON();
  assert(json.concealedTiles.length === h.concealedCount && json.melds[0].type === 'kong', 'toJSON');
});

section('createHandViewWithExtraTile (Task 42)', () => {
  const h = new Hand([T('dots-1'), T('dots-2')]);
  const view = createHandViewWithExtraTile(h, T('dots-3'));
  assert(view.concealedCount === 3 && h.concealedCount === 2, 'view has the extra tile; real hand untouched');
  assert(view !== h && view instanceof Hand, 'returns a new Hand');
  assertThrows(() => createHandViewWithExtraTile({}, T('dots-3')), TypeError, 'non-Hand throws');
});

section('DiscardPile', () => {
  const p = new DiscardPile();
  const e1 = p.discard(T('dots-5'));
  p.discard(T('wind-north'));
  assert(p.length === 2 && p.tiles[0].id === 'dots-5' && p.last.tile.id === 'wind-north', 'oldest first');
  p.markLastClaimed(2, ACTION_TYPE.PON);
  assert(p.last.claimed && p.last.claimedBy === 2 && p.last.claimedAction === 'pon', 'markLastClaimed');
  assertThrows(() => p.markLastClaimed(1, 'pon'), Error, 'cannot claim twice');
  e1.markClaimed(3, 'chi');
  assert(e1.toJSON().claimed && e1.toJSON().instanceId === 'dots-5#1', 'entry JSON form');
  assert(p.containsFace('wind-north') && !p.containsFace('dots-6'), 'containsFace');
  const entries = p.entries; entries.length = 0;
  assert(p.length === 2, 'entries is a copy');
});

section('PlayerManager', () => {
  const human = new PlayerManager({ seatIndex: 0, displayName: 'You', seatKind: SEAT_KIND.HUMAN });
  const ai = new PlayerManager({ seatIndex: 1, displayName: 'AI 1', seatKind: SEAT_KIND.AI, aiDifficulty: AI_DIFFICULTY.BASIC });
  assert(human.isHuman && human.aiDifficulty === null && ai.isAI && ai.aiDifficulty === 'basic', 'seat kinds');
  assert(human.seatWind === null, 'seatWind null before deal');
  human.seatWind = WIND.EAST;
  assert(human.seatWind === WIND.EAST, 'seatWind settable');
  assertThrows(() => { human.seatWind = { id: 'east' }; }, TypeError, 'non-WIND seatWind rejected');
  assert(human.score === 0 && human.addScore(16) === 16 && human.addScore(-4) === 12, 'addScore');
  const t = T('dots-5');
  human.addTileToHand(t); human.addTileToHand(T('dots-6'));
  const entry = human.discardTile(t);
  assert(entry.tile === t && human.getHand().concealedCount === 1 && human.getDiscardPile().length === 1, 'discardTile moves hand → pile');
  human.addMeld(new Meld({ type: MELD_TYPE.PON, tiles: [T('wind-west'), T('wind-west', 2), T('wind-west', 3)] }));
  human.resetForNewHand();
  assert(human.getHand().concealedCount === 0 && human.getHand().meldCount === 0 && human.getDiscardPile().length === 0 && human.score === 12, 'resetForNewHand keeps score');
  assert(JSON.stringify(ai.toConfig()) === JSON.stringify({ seatIndex: 1, displayName: 'AI 1', seatKind: 'ai', aiDifficulty: 'basic' }), 'toConfig');
  assertThrows(() => new PlayerManager({ seatIndex: 4 }), RangeError, 'bad seat index');
  assertThrows(() => new PlayerManager({ seatIndex: 1, seatKind: SEAT_KIND.AI }), TypeError, 'AI without difficulty');
  assertThrows(() => human.addScore(NaN), TypeError, 'NaN score delta');
});

summary();
