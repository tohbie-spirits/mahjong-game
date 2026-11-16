/**
 * ruleReferences.test.mjs — Task 114: the per-ruleset reference data
 * (src/rules/<ruleset>/*Reference.js) against the engines it describes, so
 * the reference can't drift from the rules actually played.
 *
 * Sections:
 *   1. Shape — every reference: ids, facts, sections, blocks, scoring groups, glossary; no undefined / NaN
 *   2. Hong Kong — every scoring pattern listed with its real fan; minimum / limit / Seven Pairs from the defaults; the points table
 *   3. Riichi — every yaku with its real closed / open han; every yakuman (double where the engine doubles); limits
 *   4. Chinese Official — all 81 fans with their real points and exclusions; minimum and payments from the defaults
 *   5. Examples — every tile id is a real face; every 14-tile example hand is complete for ITS engine (and the
 *      captions' claims hold: Tanyao, Pure Straight)
 *   6. Isolation — each reference module imports only its own ruleset
 *
 * Run: node tests/rules/ruleReferences.test.mjs
 */
import { readFileSync } from 'node:fs';
import { section, assert, summary } from '../_helpers/harness.mjs';
import { getHongKongReference } from '../../src/rules/hongkong/HongKongReference.js';
import { getRiichiReference } from '../../src/rules/riichi/RiichiReference.js';
import { getChineseOfficialReference } from '../../src/rules/chineseOfficial/ChineseOfficialReference.js';
import { HONG_KONG_FAN, HONG_KONG_POINTS, DEFAULT_HONG_KONG_SCORING_OPTIONS } from '../../src/rules/hongkong/HongKongScoring.js';
import { RIICHI_YAKU, RIICHI_YAKUMAN, DOUBLE_YAKUMAN } from '../../src/rules/riichi/RiichiYaku.js';
import { MCR_FANS } from '../../src/rules/chineseOfficial/ChineseOfficialScoring.js';
import { DEFAULT_CHINESE_OFFICIAL_OPTIONS } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { RiichiRules } from '../../src/rules/riichi/RiichiRules.js';
import { ChineseOfficialRules } from '../../src/rules/chineseOfficial/ChineseOfficialRules.js';
import { Tile } from '../../src/core/Tile.js';
import { Hand } from '../../src/core/Hand.js';
import { RULESET_ID } from '../../src/utils/constants.js';

const HK = getHongKongReference();
const RI = getRiichiReference();
const CO = getChineseOfficialReference();
const ALL = [HK, RI, CO];
const rowsOf = (ref) => ref.scoring.groups.flatMap((g) => g.rows);
const row = (ref, id) => rowsOf(ref).find((r) => r.id === id);
const text = (ref) => JSON.stringify(ref);

// ---------------------------------------------------------------------------
section('1. Shape', () => {
  assert(HK.rulesetId === RULESET_ID.HONG_KONG && RI.rulesetId === RULESET_ID.RIICHI && CO.rulesetId === RULESET_ID.CHINESE_OFFICIAL, 'one reference per ruleset, with its id');
  for (const r of ALL) {
    const ok = typeof r.title === 'string' && r.title && typeof r.summary === 'string' && r.summary.length > 40
      && r.facts.length >= 3 && r.facts.every((f) => f.label && f.value)
      && r.sections.length >= 4 && r.sections.every((s) => s.id && s.title && s.blocks.length)
      && r.sections.flatMap((s) => s.blocks).every((b) => (b.type === 'p' && b.text) || (b.type === 'list' && b.items.length) || (b.type === 'tiles' && b.tiles.length))
      && new Set(r.sections.map((s) => s.id)).size === r.sections.length
      && r.scoring.groups.length >= 3 && r.scoring.groups.every((g) => g.title && g.rows.length && g.rows.every((x) => x.id && x.name && x.value))
      && r.glossary.length >= 8 && r.glossary.every((g) => g.term && g.meaning);
    assert(ok, `${r.title}: facts, ${r.sections.length} sections, ${rowsOf(r).length} scoring rows, ${r.glossary.length} glossary terms — all filled in`);
    assert(!/undefined|NaN|\[object Object\]/.test(text(r)), `${r.title}: no "undefined" / "NaN" anywhere`);
    assert(new Set(rowsOf(r).map((x) => x.id)).size === rowsOf(r).length, `${r.title}: scoring rows are unique`);
    assert(r.sections.some((s) => s.blocks.some((b) => /asks you/.test(b.text ?? '') && /taken for you automatically/.test(b.text ?? ''))) && !/made for you|don’t claim/.test(text(r)), `${r.title}: says how calls on others' discards work (Task 118: you are asked; Ron is automatic)`);
  }
  assert(getHongKongReference() !== HK && JSON.stringify(getHongKongReference()) === JSON.stringify(HK), 'a fresh, identical object each call (callers may not share state)');
});

// ---------------------------------------------------------------------------
section('2. Hong Kong', () => {
  const ids = Object.keys(HONG_KONG_FAN);
  const missing = ids.filter((id) => !row(HK, id));
  assert(missing.length === 0, `every scoring pattern the engine knows is listed (${ids.length}${missing.length ? ` — missing ${missing}` : ''})`);
  assert(ids.every((id) => row(HK, id).value.startsWith(`${HONG_KONG_FAN[id]} fan`)), 'each with its real fan');
  const { minimumFan, limitFan, allowSevenPairs } = DEFAULT_HONG_KONG_SCORING_OPTIONS;
  assert(HK.facts.some((f) => f.value === `${minimumFan} fan minimum`) && HK.facts.some((f) => f.value === `${limitFan} fan`), `minimum ${minimumFan} and limit ${limitFan} come from the engine defaults`);
  assert(allowSevenPairs === false && /Seven Pairs is not allowed/.test(text(HK)) && /off in this game/.test(row(HK, 'seven-pairs').note), 'Seven Pairs: "not allowed" — matching the engine default');
  const pts = HK.scoring.groups.find((g) => g.title === 'Points by fan').rows;
  assert(pts[0].name === `${minimumFan} fan` && pts.every((p) => p.value === `${HONG_KONG_POINTS[Number.parseInt(p.name, 10)]} pts`), 'the points table is the engine’s, from the minimum up');
  assert(new HongKongRules().getMinimumFan() === minimumFan, 'the reference’s minimum is the live engine’s');
});

// ---------------------------------------------------------------------------
section('3. Riichi', () => {
  const yaku = Object.values(RIICHI_YAKU);
  assert(yaku.every((y) => row(RI, y.id)), `every yaku listed (${yaku.length})`);
  const right = yaku.every((y) => {
    const v = row(RI, y.id).value;
    if (!y.openHan || (y.id === 'tanyao' && false)) return v === `${y.closedHan} han (closed only)`;
    return y.openHan === y.closedHan ? v === `${y.closedHan} han` : v === `${y.closedHan} han (${y.openHan} open)`;
  });
  assert(right, 'each with its real closed han, and open han / "closed only"');
  assert(row(RI, 'tanyao').value === '1 han' && row(RI, 'chinitsu').value === '6 han (5 open)' && row(RI, 'pinfu').value === '1 han (closed only)', 'spot checks: Tanyao 1 (open allowed — kuitan on), Chinitsu 6 / 5 open, Pinfu closed only');
  const ym = Object.values(RIICHI_YAKUMAN);
  assert(ym.every((y) => row(RI, y.id)?.value === (DOUBLE_YAKUMAN.includes(y.id) ? 'Double yakuman' : 'Yakuman')), `every yakuman listed (${ym.length}), double where the engine doubles`);
  assert(ym.every((y) => !y.closedOnly || /closed hand only/.test(row(RI, y.id).note ?? '')), 'closed-only yakuman are marked');
  assert(row(RI, 'limit-mangan').value === '8,000 / 12,000' && row(RI, 'limit-yakuman').value === '32,000 / 48,000', 'limits: Mangan 8,000 / 12,000 … Yakuman 32,000 / 48,000');
  assert(/Red fives are not used/.test(text(RI)) && RI.facts.some((f) => /25,000/.test(f.value)), 'options from the engine defaults: no red fives, 25,000 start');
});

// ---------------------------------------------------------------------------
section('4. Chinese Official', () => {
  const fans = Object.values(MCR_FANS);
  assert(fans.length === 81 && fans.every((f) => row(CO, f.id)?.value === String(f.points)), 'all 81 fans with their real points');
  const values = CO.scoring.groups.map((g) => Number.parseInt(g.title, 10));
  assert(values.every((v, i) => i === 0 || v < values[i - 1]) && CO.scoring.groups.every((g) => g.rows.every((r) => Number(r.value) === Number.parseInt(g.title, 10))), 'grouped by value, highest first');
  assert(fans.filter((f) => f.excludes.length).every((f) => f.excludes.every((x) => row(CO, f.id).note.includes(MCR_FANS[x].name))), 'every exclusion appears in its fan’s "not also" note');
  assert(fans.every((f) => row(CO, f.id).native.includes(f.chinese)), 'every fan shows its Chinese name');
  const o = DEFAULT_CHINESE_OFFICIAL_OPTIONS;
  assert(CO.facts.some((f) => f.value === `${o.minimumPoints} points minimum`) && new RegExp(`discarder pays ${o.basePayment} \\+`).test(text(CO)), `minimum ${o.minimumPoints} and base payment ${o.basePayment} from the engine defaults`);
  assert(/Full Flush already implies No Honors/.test(text(CO)) && MCR_FANS['full-flush'].excludes.includes('no-honors'), 'the worked exclusion example is true of the table');
  assert(/Chicken Hand \(8 points\)/.test(text(CO)) && MCR_FANS['chicken-hand'].points === 8, 'Chicken Hand 8 — as the table says');
});

// ---------------------------------------------------------------------------
section('5. Examples', () => {
  let n = 0;
  const tiles = (ids) => ids.map((id) => Tile.fromId(id, `${id}#ref${++n}`));
  const blocks = (ref) => ref.sections.flatMap((s) => s.blocks).filter((b) => b.type === 'tiles');
  for (const r of ALL) {
    const ids = blocks(r).flatMap((b) => b.tiles);
    let bad = [];
    for (const id of ids) { try { Tile.fromId(id, 'x'); } catch { bad.push(id); } }
    assert(ids.length > 10 && bad.length === 0, `${r.title}: every example tile is a real face (${ids.length})`);
  }
  const engines = { [HK.rulesetId]: new HongKongRules(), [RI.rulesetId]: new RiichiRules(), [CO.rulesetId]: new ChineseOfficialRules() };
  for (const r of ALL) {
    for (const b of blocks(r).filter((x) => x.tiles.length === 14)) {
      const hand = new Hand(tiles(b.tiles));
      assert(engines[r.rulesetId].checkWin(hand).isWin === true, `${r.title}: the example "${b.caption}" is a complete hand for its engine`);
    }
  }
  const ri = blocks(RI).find((b) => /Tanyao/.test(b.caption));
  const riTiles = tiles(ri.tiles);
  const sc = new RiichiRules().scoreHand(new Hand(riTiles), { winType: 'self', winningTile: riTiles[13] });
  assert(sc.breakdown.some((y) => y.id === 'tanyao'), `the Riichi example really has All Simples (${sc.breakdown.map((y) => y.id)})`);
  const co = blocks(CO).find((b) => /Pure Straight/.test(b.caption));
  const s = new ChineseOfficialRules().scoreHand(new Hand(tiles(co.tiles)), { winType: 'self' });
  assert(s.breakdown.some((x) => /Pure Straight/.test(x.name) && (x.points ?? x.fan) === 16), `the Chinese Official example really scores Pure Straight 16 (${s.breakdown.map((x) => x.name)})`);
});

// ---------------------------------------------------------------------------
section('6. Isolation', () => {
  const imports = (f) => [...readFileSync(new URL(`../../src/rules/${f}`, import.meta.url), 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  const hk = imports('hongkong/HongKongReference.js');
  const ri = imports('riichi/RiichiReference.js');
  const co = imports('chineseOfficial/ChineseOfficialReference.js');
  const foreign = (list, own) => list.filter((p) => /^\.\.\/(hongkong|riichi|chineseOfficial)\//.test(p) || (p.startsWith('./') && false) || (p.includes('/rules/') && !p.includes(own)));
  assert(foreign(hk, 'hongkong').length + foreign(ri, 'riichi').length + foreign(co, 'chineseOfficial').length === 0, 'each reference imports only its own ruleset (and shared constants)');
});

summary();
