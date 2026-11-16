/**
 * tiles.mjs — test helpers for building hands from compact specs.
 *   tiles('123d 456b 789c EE RR')  → Tile[] (d=dots, b=bamboo, c=characters,
 *   honours: E S W N winds, R G H = red, green, white dragons).
 * Copies get unique instance ids automatically.
 */
import { Tile } from '../../src/core/Tile.js';
import { Hand, Meld } from '../../src/core/Hand.js';

const SUITS = { d: 'dots', b: 'bamboo', c: 'characters' };
const HONORS = { E: 'wind-east', S: 'wind-south', W: 'wind-west', N: 'wind-north', R: 'dragon-red', G: 'dragon-green', H: 'dragon-white' };

export function faceIds(spec) {
  const out = [];
  for (const group of spec.trim().split(/\s+/).filter(Boolean)) {
    if (/^[ESWNRGH]+$/.test(group)) { for (const ch of group) out.push(HONORS[ch]); continue; }
    const m = group.match(/^(\d+)([dbc])$/);
    if (!m) throw new Error(`bad tile group "${group}"`);
    for (const d of m[1]) out.push(`${SUITS[m[2]]}-${d}`);
  }
  return out;
}

export function makeTileFactory() {
  const used = new Map();
  return (faceId) => {
    const n = (used.get(faceId) ?? 0) + 1;
    used.set(faceId, n);
    return Tile.fromId(faceId, `${faceId}#${n}`);
  };
}

/** tiles(spec, factory?) */
export function tiles(spec, factory = makeTileFactory()) {
  return faceIds(spec).map(factory);
}

/** hand('concealed spec', [meldSpecs], factory?) — meldSpec: { type, spec, concealed? } */
export function hand(concealedSpec, meldSpecs = [], factory = makeTileFactory()) {
  const melds = meldSpecs.map((m) => {
    const ts = tiles(m.spec, factory);
    return new Meld({ type: m.type, tiles: ts, concealed: m.concealed === true, calledTile: m.concealed ? null : ts[0], calledFrom: m.concealed ? null : 1 });
  });
  return new Hand(concealedSpec ? tiles(concealedSpec, factory) : [], melds);
}
