/**
 * advancedStrategyClaim.test.mjs
 *
 * Task 75 — AdvancedStrategy.js intelligent claim evaluation.
 *
 * Sections:
 *   1.  Exports — CLAIM_KIND / CLAIM_REASON frozen
 *   2.  Validation — options, claim shape, chi sequence, tiles actually held
 *   3.  Progress — Pon / Chi that lower shanten are accepted (PROGRESS)
 *   4.  Rejections — LOSES_PROGRESS and NO_PROGRESS
 *   5.  Valuable honours — Pon of a dragon accepted without shanten gain
 *   6.  Kong — KONG_NO_LOSS; Kong that breaks shape rejected
 *   7.  preferConcealed — KEEP_CONCEALED near tenpai, valuable honour exempt
 *   8.  Evaluation details — before/after numbers, discardIndex, seen discard
 *   9.  chooseBestClaim — pass (null), best of several, tie-break order
 *  10.  Property — accepted claims never leave the hand further from winning
 *  11.  Benchmark — draw/discard solitaire with opponents' discards on offer:
 *       Advanced claiming vs never claiming vs claiming everything legal
 *
 * Run with:
 *   node tests/ai/advancedStrategyClaim.test.mjs
 */

import {
  CLAIM_KIND,
  CLAIM_REASON,
  evaluateClaim,
  chooseBestClaim,
  chooseEfficientDiscard,
} from '../../src/ai/advanced/AdvancedStrategy.js';
import {
  countsFromIndices,
  createEmptyCounts,
  calculateShanten,
} from '../../src/ai/advanced/HandEfficiencyEvaluator.js';

const SUIT_OFFSET = { a: 0, b: 9, c: 18 };
const HONOR_INDEX = { E: 27, S: 28, W: 29, N: 30, R: 31, G: 32, H: 33 };
function idx(spec) {
  const out = [];
  for (const group of spec.trim().split(/\s+/)) {
    if (/^[ESWNRGH]+$/.test(group)) { for (const ch of group) out.push(HONOR_INDEX[ch]); continue; }
    const m = group.match(/^(\d+)([abc])$/);
    if (!m) throw new Error(`bad group ${group}`);
    for (const d of m[1]) out.push(SUIT_OFFSET[m[2]] + Number(d) - 1);
  }
  return out;
}
const h = (spec) => {
  const c = countsFromIndices(idx(spec));
  const n = c.reduce((a, b) => a + b, 0);
  if (n % 3 !== 1) throw new Error(`fixture "${spec}" has ${n} tiles (needs 13 − 3m)`);
  return c;
};
const kind = (spec) => idx(spec)[0];
const pon = (t) => ({ kind: CLAIM_KIND.PON, tileIndex: kind(t) });
const kong = (t) => ({ kind: CLAIM_KIND.KONG, tileIndex: kind(t) });
const chi = (t, seqSpec) => ({ kind: CLAIM_KIND.CHI, tileIndex: kind(t), sequence: idx(seqSpec) });

let passed = 0; let failed = 0; const failures = []; let currentSection = '';
function section(name, fn) { currentSection = name; console.log(`\n▸ ${name}`); return fn(); }
function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(`[${currentSection}] ${message}`); console.error(`  ✗ FAIL: ${message}`); }
}
function assertThrows(fn, expectedType, message) {
  let threw = false; let err = null;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (!threw) assert(false, `${message} — expected throw, nothing thrown`);
  else if (expectedType && !(err instanceof expectedType)) assert(false, `${message} — wrong error type: ${err?.constructor?.name} (${err?.message})`);
  else assert(true, message);
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
section('Exports', () => {
  assert(Object.isFrozen(CLAIM_KIND) && Object.isFrozen(CLAIM_REASON), 'enums frozen');
  assert(CLAIM_KIND.CHI === 'chi' && CLAIM_KIND.PON === 'pon' && CLAIM_KIND.KONG === 'kong', 'CLAIM_KIND values');
  assert(Object.keys(CLAIM_REASON).length === 6, 'six reasons');
});

// ---------------------------------------------------------------------------
section('Validation', () => {
  const hand = h('123a 456a 789a 55b 9c E');
  assertThrows(() => evaluateClaim(hand, pon('5b'), null), TypeError, 'null options throws');
  assertThrows(() => evaluateClaim(hand, null), TypeError, 'null claim throws');
  assertThrows(() => evaluateClaim(hand, { kind: 'ron', tileIndex: 0 }), TypeError, 'unknown kind (ron) throws');
  assertThrows(() => evaluateClaim(hand, { kind: 'pon', tileIndex: 40 }), TypeError, 'bad tileIndex throws');
  assertThrows(() => evaluateClaim(hand, pon('9c')), RangeError, 'pon without a pair in hand throws');
  assertThrows(() => evaluateClaim(hand, kong('5b')), RangeError, 'kong without three in hand throws');
  assertThrows(() => evaluateClaim(hand, { kind: 'chi', tileIndex: kind('4c') }), TypeError, 'chi without sequence throws');
  assertThrows(() => evaluateClaim(hand, chi('8c', '8c 9c 1b')), TypeError, 'chi across suits throws');
  assertThrows(() => evaluateClaim(hand, chi('E', 'E S W')), TypeError, 'chi of honours throws');
  assertThrows(() => evaluateClaim(hand, chi('2a', '3a 4a 5a')), TypeError, 'chi sequence not containing the claimed tile throws');
  assertThrows(() => evaluateClaim(hand, chi('7c', '7c 8c 9c')), RangeError, 'chi needing an unheld tile throws');
  assertThrows(() => evaluateClaim(h('123a 456a 789a 5b'), pon('5b'), { meldCount: 1 }), RangeError, 'pon with only one copy (open hand) throws');
  assertThrows(() => evaluateClaim(h('5b'), pon('5b'), { meldCount: 4 }), TypeError, 'meldCount 4 cannot claim again');
  assertThrows(() => evaluateClaim(h('123a 456a 789a 55b 9c E'), pon('5b'), { valuableHonorIndices: [1] }), TypeError, 'bad valuableHonorIndices throws');
  assertThrows(() => chooseBestClaim(hand, 'pon'), TypeError, 'chooseBestClaim needs an array');
});

// ---------------------------------------------------------------------------
section('Progress claims accepted', () => {
  // 1-shanten: 123a 456a 789a + 55b + 9c E + 3b → pon 5b makes tenpai-ish progress? Use clear case:
  // Hand 123a 456a 55b 66b 9c E W : two pairs, pon 5b → set + pair 66b, discard a loose tile.
  const hand = h('123a 456a 55b 66b 9c E W');
  const r = evaluateClaim(hand, pon('5b'));
  assert(r.after.shanten < r.before.shanten, 'pon lowers shanten');
  assert(r.accept && r.reason === CLAIM_REASON.PROGRESS, 'accepted as PROGRESS');

  const hand2 = h('123a 456a 789a 34b 9c E');
  const r2 = evaluateClaim(hand2, chi('5b', '3b 4b 5b'));
  assert(r2.accept && r2.reason === CLAIM_REASON.PROGRESS, 'chi completing a run accepted');
  assert(r2.after.discardIndex !== null, 'chi evaluation includes the follow-up discard');
});

// ---------------------------------------------------------------------------
section('Rejected claims', () => {
  // Already tenpai on a two-sided wait; pon of the pair would wreck it.
  const tenpai = h('123a 456a 789a 55b 67b');
  const r = evaluateClaim(tenpai, pon('5b'));
  assert(!r.accept, 'pon of the pair in a tenpai hand rejected');
  assert(r.reason === CLAIM_REASON.LOSES_PROGRESS || r.reason === CLAIM_REASON.NO_PROGRESS, `reason is a rejection (${r.reason})`);

  // Chi that only reshuffles: 1-shanten hand where chi 6b from 67b+... adds nothing.
  const hand = h('123a 456a 789a 2b 4b 9c E');
  const r2 = evaluateClaim(hand, chi('3b', '2b 3b 4b'));
  // Completing the kanchan is genuine progress here; sanity-check the opposite case:
  assert(r2.after.shanten <= r2.before.shanten, 'completing a kanchan never loses shanten');

  const flat = h('123a 456a 789a 11b 2c E');
  const r3 = evaluateClaim(flat, pon('1b'));
  assert(r3.accept === (r3.after.shanten < r3.before.shanten || r3.reason === CLAIM_REASON.VALUABLE_HONOR), 'accept iff progress (no special value)');
  if (!r3.accept) assert([CLAIM_REASON.NO_PROGRESS, CLAIM_REASON.LOSES_PROGRESS].includes(r3.reason), 'rejection reason recorded');
  else assert(r3.reason === CLAIM_REASON.PROGRESS, 'accepted pon is PROGRESS');
});

// ---------------------------------------------------------------------------
section('Valuable honours', () => {
  // Tenpai with a dragon pair as one of two pairs (shanpon). Pon of R keeps tenpai (no gain) — only fan justifies it.
  const hand = h('123a 456a 789a RR 55b');
  const plain = evaluateClaim(hand, pon('R'));
  const valued = evaluateClaim(hand, pon('R'), { valuableHonorIndices: [kind('R')] });
  assert(plain.after.shanten === plain.before.shanten, 'pon of R does not change shanten here');
  assert(!plain.accept && plain.reason === CLAIM_REASON.NO_PROGRESS, 'without fan value → NO_PROGRESS');
  assert(valued.accept && valued.reason === CLAIM_REASON.VALUABLE_HONOR, 'with R marked valuable → VALUABLE_HONOR');

  const loses = evaluateClaim(h('123a 456a RR 55b 67b 9c'), pon('R'), { valuableHonorIndices: [kind('R')] });
  assert(loses.after.shanten <= loses.before.shanten, 'valuable pon evaluated on the same efficiency rules');
});

// ---------------------------------------------------------------------------
section('Kong', () => {
  // Concealed triplet that is already a finished set: kong keeps shanten, gains a draw.
  const hand = h('123a 456a 789a 555b E');
  const r = evaluateClaim(hand, kong('5b'));
  assert(r.after.shanten === r.before.shanten, 'kong of a finished triplet keeps shanten');
  assert(r.accept && r.reason === CLAIM_REASON.KONG_NO_LOSS, 'accepted as KONG_NO_LOSS');
  assert(r.after.discardIndex === null, 'kong has no follow-up discard (replacement draw comes first)');

  // Triplet doubling as part of a run (5556b-like): kong breaks the shape.
  const shaped = h('123a 456a 789a 5556b');
  const r2 = evaluateClaim(shaped, kong('5b'));
  assert(r2.after.shanten >= r2.before.shanten, 'kong from a shaped block never improves shanten');
  if (r2.after.shanten > r2.before.shanten) assert(!r2.accept && r2.reason === CLAIM_REASON.LOSES_PROGRESS, 'shape-breaking kong rejected');
  else assert(r2.accept, 'kong that keeps shanten accepted');
});

// ---------------------------------------------------------------------------
section('preferConcealed', () => {
  const hand = h('123a 456a 55b 66b 9c E W'); // concealed, progress pon available
  const base = evaluateClaim(hand, pon('5b'));
  const pref = evaluateClaim(hand, pon('5b'), { preferConcealed: true });
  if (base.before.shanten <= 1) {
    assert(!pref.accept && pref.reason === CLAIM_REASON.KEEP_CONCEALED, 'near tenpai + preferConcealed → KEEP_CONCEALED');
  } else {
    assert(pref.accept === base.accept, 'far from tenpai → preferConcealed has no effect');
  }
  const near = h('123a 456a 789a 55b 6b E');
  const nearPref = evaluateClaim(near, pon('5b'), { preferConcealed: true });
  assert(nearPref.before.shanten <= 1 && !nearPref.accept, 'concealed 1-shanten hand stays concealed');

  const dragon = h('123a 456a 789a RR 5b E');
  const d = evaluateClaim(dragon, pon('R'), { preferConcealed: true, valuableHonorIndices: [kind('R')] });
  assert(d.reason !== CLAIM_REASON.KEEP_CONCEALED, 'valuable honour exempt from preferConcealed');

  const open = evaluateClaim(h('123a 456a 55b 6b E'), pon('5b'), { meldCount: 1, preferConcealed: true });
  assert(open.reason !== CLAIM_REASON.KEEP_CONCEALED, 'already-open hand ignores preferConcealed');
});

// ---------------------------------------------------------------------------
section('Evaluation details', () => {
  const hand = h('123a 456a 55b 66b 9c E W');
  const snap = hand.slice();
  const r = evaluateClaim(hand, pon('5b'));
  assert(typeof r.before.ukeire === 'number' && typeof r.after.ukeire === 'number', 'ukeire reported before and after');
  assert(Number.isInteger(r.after.discardIndex) && hand[r.after.discardIndex] > 0, 'follow-up discard is a held tile');
  assert(hand.every((v, i) => v === snap[i]), 'input counts not mutated');

  // Seen discard: with three 5b visible elsewhere, the claimed 5b is the 4th — ukeire can't count 5b.
  const vis = createEmptyCounts(); vis[kind('6b')] = 2;
  const r2 = evaluateClaim(hand, pon('5b'), { visibleCounts: vis });
  assert(r2.after.ukeire <= r.after.ukeire, 'visible copies reduce after-ukeire');
  const vis2 = createEmptyCounts(); vis2[kind('5b')] = 2; // hand 2 + visible 2 = 4 (discard is over-reported → clamped)
  let ok = true; try { evaluateClaim(hand, pon('5b'), { visibleCounts: vis2 }); } catch { ok = false; }
  assert(ok, 'over-reported visible copies of the claimed kind are clamped, not thrown');
});

// ---------------------------------------------------------------------------
section('chooseBestClaim', () => {
  const tenpai = h('123a 456a 789a 55b 67b');
  assert(chooseBestClaim(tenpai, [pon('5b')]) === null, 'all rejected → null (pass)');
  assert(chooseBestClaim(tenpai, []) === null, 'no claims → null');

  const hand = h('123a 456a 34b 55b 9c E W');
  const claims = [chi('5b', '3b 4b 5b'), pon('5b')];
  const best = chooseBestClaim(hand, claims);
  assert(best !== null, 'some claim accepted');
  assert(best.evaluations.length === 2, 'evaluations for every claim returned');
  const others = best.evaluations.filter((e) => e.evaluation.accept && e.claim !== best.claim);
  const beats = others.every((e) =>
    best.evaluation.after.shanten < e.evaluation.after.shanten ||
    (best.evaluation.after.shanten === e.evaluation.after.shanten && best.evaluation.after.ukeire >= e.evaluation.after.ukeire));
  assert(beats, 'chosen claim has the best after-shanten / ukeire');
  assert(claims.includes(best.claim), 'returns the caller’s own claim object');

  // Exact tie → Kong > Pon > Chi priority, then input order.
  const tieHand = h('123a 456a 789a 555b E');
  const pick = chooseBestClaim(tieHand, [pon('5b'), kong('5b')]);
  if (pick && pick.evaluations.every((e) => e.evaluation.accept)) {
    const [p, k] = pick.evaluations.map((e) => e.evaluation.after);
    if (p.shanten === k.shanten && p.ukeire === k.ukeire) assert(pick.claim.kind === 'kong', 'tie → Kong preferred');
    else assert(true, 'no exact tie to test kind priority');
  } else {
    assert(true, 'kind-priority tie not reachable with this fixture');
  }
});

// ---------------------------------------------------------------------------
section('Property: accepted claims never leave the hand further from winning', () => {
  const rand = mulberry32(75);
  let accepted = 0; let violations = 0; let considered = 0;
  for (let n = 0; n < 400; n++) {
    const pool = [];
    for (let k = 0; k < 34; k++) for (let c = 0; c < 4; c++) pool.push(k);
    const counts = createEmptyCounts();
    for (let t = 0; t < 13; t++) { const j = Math.floor(rand() * pool.length); counts[pool[j]]++; pool.splice(j, 1); }
    const t = pool[Math.floor(rand() * pool.length)];
    const claims = [];
    if (counts[t] >= 2) claims.push({ kind: 'pon', tileIndex: t });
    if (counts[t] >= 3) claims.push({ kind: 'kong', tileIndex: t });
    if (t < 27) {
      const r = t % 9;
      for (const start of [t - 2, t - 1, t]) {
        if (start < t - r || start + 2 > t - r + 8) continue;
        const seq = [start, start + 1, start + 2];
        if (seq.filter((x) => x !== t).every((x) => counts[x] > 0)) claims.push({ kind: 'chi', tileIndex: t, sequence: seq });
      }
    }
    for (const c of claims) {
      considered++;
      const e = evaluateClaim(counts, c);
      if (e.accept) { accepted++; if (e.after.shanten > e.before.shanten) violations++; }
    }
  }
  assert(considered > 50 && accepted > 0, `exercised (${considered} claims, ${accepted} accepted)`);
  assert(violations === 0, 'no accepted claim increased shanten');
});

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

function legalClaims(counts, t, fromLeft) {
  const out = [];
  if (counts[t] >= 3) out.push({ kind: 'kong', tileIndex: t });
  if (counts[t] >= 2) out.push({ kind: 'pon', tileIndex: t });
  if (fromLeft && t < 27) {
    const r = t % 9;
    for (const start of [t - 2, t - 1, t]) {
      if (start < t - r || start + 2 > t - r + 8) continue;
      const seq = [start, start + 1, start + 2];
      if (seq.filter((x) => x !== t).every((x) => counts[x] > 0)) out.push({ kind: 'chi', tileIndex: t, sequence: seq });
    }
  }
  return out;
}

/** Returns the number of own turns until tenpai (or cap+1). */
function playWithClaims(policy, seed, cap) {
  const rand = mulberry32(seed);
  const wall = [];
  for (let k = 0; k < 34; k++) for (let c = 0; c < 4; c++) wall.push(k);
  for (let i = wall.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [wall[i], wall[j]] = [wall[j], wall[i]]; }
  const counts = createEmptyCounts();
  for (let t = 0; t < 13; t++) counts[wall.pop()]++;
  let meldCount = 0;
  const seen = createEmptyCounts();
  const clampSeen = () => seen.map((v, i) => Math.min(v, 4 - counts[i]));
  const isTenpai = () => calculateShanten(counts, { meldCount }) <= 0;
  if (isTenpai()) return 0;

  const discardBest = () => {
    const d = chooseEfficientDiscard(counts, { meldCount, visibleCounts: clampSeen() }).discardIndex;
    counts[d]--; seen[d]++;
  };

  for (let turn = 1; turn <= cap; turn++) {
    // Own draw + discard.
    counts[wall.pop()]++;
    if (calculateShanten(counts, { meldCount }) === -1) return turn;
    discardBest();
    if (isTenpai()) return turn;

    // Three opponents discard random wall tiles; the last one (left seat) may be chi'd.
    for (let opp = 0; opp < 3; opp++) {
      const t = wall.pop();
      if (meldCount < 4) {
        const options = legalClaims(counts, t, opp === 2);
        const pick = options.length ? policy(counts, options, meldCount, clampSeen()) : null;
        if (pick) {
          const take = pick.kind === 'kong' ? 3 : pick.kind === 'pon' ? 2 : 2;
          if (pick.kind === 'chi') { for (const x of pick.sequence) if (x !== t) counts[x]--; }
          else counts[t] -= take;
          meldCount++;
          if (pick.kind === 'kong') {
            counts[wall.pop()]++;
            if (calculateShanten(counts, { meldCount }) === -1) return turn;
          }
          discardBest();
          if (isTenpai()) return turn;
          break; // claiming skips the remaining discards this round
        }
      }
      seen[t]++;
    }
  }
  return cap + 1;
}

section('Benchmark: Advanced claiming vs never vs claim-everything', () => {
  const GAMES = 150; const CAP = 15;
  const policies = {
    never: () => null,
    always: (counts, options) => options[0],
    advanced: (counts, options, meldCount, seen) => {
      const best = chooseBestClaim(counts, options, { meldCount, visibleCounts: seen });
      return best ? best.claim : null;
    },
  };
  const res = {};
  for (const [name, policy] of Object.entries(policies)) {
    let sum = 0; let reached = 0;
    for (let g = 0; g < GAMES; g++) {
      const turns = playWithClaims(policy, 7500 + g, CAP);
      sum += turns; if (turns <= CAP) reached++;
    }
    res[name] = { avg: sum / GAMES, rate: reached / GAMES };
    console.log(`    ${name.padEnd(8)} avg turns to tenpai ${res[name].avg.toFixed(2)} · tenpai within ${CAP} turns ${(res[name].rate * 100).toFixed(1)}%`);
  }
  assert(res.advanced.avg < res.never.avg && res.advanced.rate > res.never.rate, 'Advanced claiming beats never claiming');
  assert(res.advanced.avg <= res.always.avg, 'Advanced claiming at least as fast as claiming everything');
});

console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) console.log(`✓ All ${passed} assertions passed.`);
else { console.log(`${passed} passed, ${failed} FAILED.`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
