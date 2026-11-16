/**
 * tilesAndWall.test.mjs — rebuilt Tasks 9–15: Tile, TileSetGenerator,
 * DeckGenerator, ShuffleService, WallManager, DealingService.
 * Run: node tests/core/tilesAndWall.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { Tile, windFaceId, dragonFaceId } from '../../src/core/Tile.js';
import { generateTileSet, STANDARD_FACE_IDS, BONUS_FACE_IDS } from '../../src/core/TileSetGenerator.js';
import { createDeck } from '../../src/core/DeckGenerator.js';
import { shuffle, createSeededRandom } from '../../src/core/ShuffleService.js';
import { WallManager } from '../../src/core/WallManager.js';
import { dealInitialHands } from '../../src/core/DealingService.js';
import { SUIT, WIND, DRAGON } from '../../src/utils/constants.js';

section('Tile identity and properties', () => {
  const t = new Tile({ suit: SUIT.DOTS, value: 5, copy: 2 });
  assert(t.id === 'dots-5' && t.instanceId === 'dots-5#2', 'face id and instance id');
  assert(t.rank === 5 && t.isSuited && t.isSimple && !t.isTerminal && !t.isHonor, 'suited simple');
  assert(t.label === '5 of Dots', 'label "5 of Dots" (HandRenderer aria wording)');
  assert(Object.isFrozen(t), 'tiles are immutable');
  const e = new Tile({ suit: SUIT.WIND, value: 'east' });
  assert(e.isHonor && e.wind === WIND.EAST && e.label === 'East Wind' && e.rank === null, 'wind tile');
  const r = new Tile({ suit: SUIT.DRAGON, value: 'red' });
  assert(r.label === 'Red Dragon' && r.isTerminalOrHonor, 'dragon tile');
  const one = Tile.fromId('bamboo-1');
  assert(one.isTerminal && one.nextInSuit(1) === 'bamboo-2' && one.nextInSuit(-1) === null, 'terminal + nextInSuit');
  const f = new Tile({ suit: SUIT.FLOWER, value: 3 });
  assert(f.isBonus && !f.isHonor && f.label === 'Flower 3', 'bonus tile');
  assert(windFaceId(WIND.SOUTH) === 'wind-south' && dragonFaceId(DRAGON.WHITE) === 'dragon-white', 'face id helpers');
  assertThrows(() => new Tile({ suit: 'cards', value: 1 }), TypeError, 'unknown suit throws');
  assertThrows(() => new Tile({ suit: SUIT.DOTS, value: 10 }), TypeError, 'rank 10 throws');
  assertThrows(() => new Tile({ suit: SUIT.WIND, value: 'up' }), TypeError, 'bad wind throws');
  assertThrows(() => Tile.fromId('nonsense'), TypeError, 'malformed id throws');
});

section('Tile JSON round-trip and ordering', () => {
  const t = Tile.fromId('characters-9', 'characters-9#4');
  const back = Tile.fromJSON(JSON.parse(JSON.stringify(t)));
  assert(back.id === t.id && back.instanceId === t.instanceId, 'toJSON/fromJSON round-trip {id, instanceId}');
  assert(t.sameFace(Tile.fromId('characters-9')) && !t.sameFace(Tile.fromId('characters-8')), 'sameFace');
  const ids = ['dragon-white', 'wind-north', 'dots-2', 'characters-1', 'bamboo-9', 'wind-east', 'dots-1', 'dragon-red'];
  const sorted = ids.map((id) => Tile.fromId(id)).sort(Tile.compare).map((x) => x.id);
  assert(sorted.join() === 'dots-1,dots-2,bamboo-9,characters-1,wind-east,wind-north,dragon-red,dragon-white', 'Tile.compare: dots, bamboo, characters, winds ESWN, dragons RGW');
});

section('TileSetGenerator', () => {
  assert(STANDARD_FACE_IDS.length === 34 && BONUS_FACE_IDS.length === 8, '34 standard + 8 bonus faces');
  const set = generateTileSet();
  assert(set.length === 136, '136 tiles without bonus');
  assert(new Set(set.map((t) => t.instanceId)).size === 136, 'all instance ids unique');
  const counts = {};
  for (const t of set) counts[t.id] = (counts[t.id] ?? 0) + 1;
  assert(Object.values(counts).every((n) => n === 4), 'four copies of every face');
  assert(generateTileSet({ includeBonus: true }).length === 144, '144 with bonus tiles');
  const reduced = generateTileSet({ excludedFaceIds: ['characters-2', 'characters-3'] });
  assert(reduced.length === 128 && !reduced.some((t) => t.id === 'characters-2'), 'excludedFaceIds removes faces');
  assertThrows(() => generateTileSet({ excludedFaceIds: ['nope-1'] }), TypeError, 'unknown excluded face throws');
});

section('ShuffleService + DeckGenerator', () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8];
  const s1 = shuffle(a, createSeededRandom(5));
  const s2 = shuffle(a, createSeededRandom(5));
  assert(s1.join() === s2.join(), 'same seed → same order');
  assert(a.join() === '1,2,3,4,5,6,7,8', 'input not mutated');
  assert(s1.slice().sort().join() === a.join(), 'permutation of the input');
  const d1 = createDeck({ seed: 9 }); const d2 = createDeck({ seed: 9 }); const d3 = createDeck({ seed: 10 });
  assert(d1.length === 136 && d1.map((t) => t.instanceId).join() === d2.map((t) => t.instanceId).join(), 'seeded deck reproducible');
  assert(d1.map((t) => t.instanceId).join() !== d3.map((t) => t.instanceId).join(), 'different seed → different deck');
  assertThrows(() => shuffle('abc'), TypeError, 'shuffle rejects non-arrays');
});

section('WallManager draws and counts', () => {
  const wall = new WallManager(createDeck({ seed: 1 }));
  assert(wall.remainingCount === 136 && wall.totalCount === 136, 'full wall');
  const next = wall.peekUpcoming(2);
  const t = wall.draw();
  assert(t === next[0] && wall.remainingCount === 135, 'draw takes the next tile');
  assert(wall.peekUpcoming(1)[0] === next[1], 'peekUpcoming does not consume');
  const rep = wall.drawReplacement();
  assert(rep && wall.remainingCount === 134, 'no dead wall: replacement comes off the far end');
  while (wall.draw()) { /* drain */ }
  assert(wall.isExhausted() && wall.draw() === null && wall.drawReplacement() === null, 'exhausted wall returns null');
});

section('WallManager dead wall (Riichi hook)', () => {
  const wall = new WallManager(createDeck({ seed: 2 }));
  wall.reserveDeadWall(14);
  assert(wall.remainingCount === 122 && wall.deadWallSize === 14, 'dead wall excluded from remainingCount');
  assert(wall.getDeadWallTiles().length === 14, 'dead wall tiles readable');
  const rep = wall.drawReplacement();
  assert(rep && wall.remainingCount === 121 && wall.getDeadWallTiles().length === 13, 'replacement from dead wall; live wall shrinks by one');
  assertThrows(() => wall.reserveDeadWall(14), Error, 'cannot reserve after drawing');
});

section('WallManager snapshot + restore', () => {
  const wall = new WallManager(createDeck({ seed: 3 }));
  wall.reserveDeadWall(14);
  for (let i = 0; i < 20; i++) wall.draw();
  wall.drawReplacement();
  const snap = wall.getWallStateSnapshot();
  assert(['tiles', 'drawIndex', 'liveWallEnd', 'deadWallReserved', 'deadWallStart', 'deadWallDrawIndex'].every((k) => k in snap), 'snapshot has all six fields');
  const restored = WallManager.restore(snap);
  assert(restored.remainingCount === wall.remainingCount && restored.totalCount === wall.totalCount, 'counts preserved');
  assert(restored.draw() === wall.draw(), 'next draw identical');
  snap.tiles.length = 0;
  assert(wall.totalCount === 136, 'snapshot tiles are a copy');
  assertThrows(() => WallManager.restore({ ...wall.getWallStateSnapshot(), drawIndex: 999 }), RangeError, 'inconsistent cursor throws');
  assertThrows(() => WallManager.restore({ ...wall.getWallStateSnapshot(), deadWallStart: 3 }), RangeError, 'inconsistent dead wall throws');
});

section('DealingService', () => {
  const wall = new WallManager(createDeck({ seed: 4 }));
  const first4 = wall.peekUpcoming(4);
  const hands = dealInitialHands(wall, 4, { dealerIndex: 2 });
  assert(hands.length === 4 && hands.every((h) => h.length === 13), 'four hands of 13');
  assert(wall.remainingCount === 136 - 52, '52 tiles dealt');
  assert(hands[2].slice(0, 4).every((t, i) => t === first4[i]), 'dealer receives the first block of four');
  const all = hands.flat().map((t) => t.instanceId);
  assert(new Set(all).size === 52, 'no tile dealt twice');
  const w3 = new WallManager(createDeck({ seed: 5 }));
  const h3 = dealInitialHands(w3, 3);
  assert(h3.length === 3 && w3.remainingCount === 136 - 39, '3-player deal');
  assertThrows(() => dealInitialHands(new WallManager([]), 4), RangeError, 'too few tiles throws');
  assertThrows(() => dealInitialHands(wall, 5), RangeError, 'bad player count throws');
  assertThrows(() => dealInitialHands(wall, 4, { dealerIndex: 4 }), RangeError, 'bad dealer throws');
});

summary();
