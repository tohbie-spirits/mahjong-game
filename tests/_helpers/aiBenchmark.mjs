/**
 * aiBenchmark.mjs — Task 80: AI behaviour harness / benchmark.
 *
 * Plays AI-only Hong Kong hands on the real engine in DUPLICATE format:
 * every seed (one shuffled wall) is played once per distinct seat rotation
 * of the line-up, so each agent sits in every seat on the same walls and
 * deal luck cancels out. Collects per-agent results, checks engine
 * invariants on every hand, and reports paired statistics with 95%
 * confidence intervals.
 *
 *   const report = runBenchmark({ lineup: ['advanced', 'basic', 'advanced', 'basic'], seeds: 100, seedBase: 20000 });
 *   console.log(formatReport(report));
 *
 * AGENTS — the line-up names agents, not tiers. An agent is
 *   { label, tier, create(random) → strategy }
 * where `tier` is the AI_DIFFICULTY id the strategy registers under. Built-in
 * agents (see AGENTS below) include ablations of the Advanced AI. Agents of
 * the same tier CAN share a table (Task 80b): they sit behind a
 * SeatDispatchStrategy, so ablations can be compared head-to-head on the
 * same deals against the same opponents (much lower variance than pairing
 * two separate runs).
 *
 * Kept under tests/_helpers (not src/) because it is development tooling and
 * never ships with the game. CLI: tools/ai-benchmark.mjs.
 */

import { GameManager } from '../../src/core/GameManager.js';
import { EventBus } from '../../src/core/EventBus.js';
import { AIManager } from '../../src/ai/AIManager.js';
import { AIStrategyInterface } from '../../src/ai/AIStrategyInterface.js';
import { BasicStrategy } from '../../src/ai/basic/BasicStrategy.js';
import { AdvancedStrategy } from '../../src/ai/advanced/AdvancedStrategy.js';
import { HongKongRules } from '../../src/rules/hongkong/HongKongRules.js';
import { AI_DIFFICULTY, SEAT_KIND } from '../../src/utils/constants.js';
import { mulberry32 } from './harness.mjs';

/** Built-in agents. `random` seeds tie-breaks (Basic) and fallbacks (Advanced). */
export const AGENTS = Object.freeze({
  basic: { label: 'basic', tier: AI_DIFFICULTY.BASIC, create: (random) => new BasicStrategy({ random }) },
  advanced: { label: 'advanced', tier: AI_DIFFICULTY.ADVANCED, create: (random) => new AdvancedStrategy({ random }) },
  'advanced-no-defense': { label: 'advanced-no-defense', tier: AI_DIFFICULTY.ADVANCED, create: (random) => new AdvancedStrategy({ random, useDefense: false }) },
  'advanced-fan-blind': { label: 'advanced-fan-blind', tier: AI_DIFFICULTY.ADVANCED, create: (random) => new AdvancedStrategy({ random, useValue: false }) },
  'advanced-speed-only': { label: 'advanced-speed-only', tier: AI_DIFFICULTY.ADVANCED, create: (random) => new AdvancedStrategy({ random, useValue: false, useDefense: false }) },
  // Task 80b: the pre-80b defence (Task 77 weights, unscaled threat), for regression comparison.
  'advanced-task77-defense': { label: 'advanced-task77-defense', tier: AI_DIFFICULTY.ADVANCED, create: (random) => new AdvancedStrategy({ random, threatValueScale: false, defense: { progressWeight: 1, tenpaiProgressWeight: 3 } }) },
  // Task 98: Advanced without the Chinese Official value routes (the generic planner, real-engine tenpai checks only).
  'advanced-mcr-blind': { label: 'advanced-mcr-blind', tier: AI_DIFFICULTY.ADVANCED, create: (random) => new McrBlindAdvancedStrategy({ random }) },
});

/** Task 98 baseline: Advanced that plans Chinese Official hands with the generic (Hong Kong) value routes. */
class McrBlindAdvancedStrategy extends AdvancedStrategy {
  _valueOfWaitingHand(counts, meldDesc, hand, player, context, visible) {
    const rules = context.ruleEngine;
    const blind = rules ? Object.create(rules, { getRulesetId: { value: () => 'mcr-blind' } }) : rules;
    return super._valueOfWaitingHand(counts, meldDesc, hand, player, { ...context, ruleEngine: blind }, visible);
  }
}

/**
 * Registers under one tier and routes each decision to the strategy of the
 * seat asking — lets several agents of the same tier share a table.
 */
export class SeatDispatchStrategy extends AIStrategyInterface {
  constructor(tier, strategyForSeat) {
    super(tier, `dispatch:${tier}`);
    this._forSeat = strategyForSeat;
  }
  chooseDiscard(player, context) { return this._forSeat(player.seatIndex).chooseDiscard(player, context); }
  chooseClaim(player, actions, context) { return this._forSeat(player.seatIndex).chooseClaim(player, actions, context); }
  chooseWinDeclaration(player, winAction, context) { return this._forSeat(player.seatIndex).chooseWinDeclaration(player, winAction, context); }
}

/** Distinct cyclic rotations of a line-up (ABAB → ABAB, BABA; ABBB → 4). */
export function seatRotations(lineup) {
  const out = []; const seen = new Set();
  for (let r = 0; r < lineup.length; r++) {
    const rot = lineup.map((_, i) => lineup[(i + r) % lineup.length]);
    const key = rot.join('|');
    if (!seen.has(key)) { seen.add(key); out.push(rot); }
  }
  return out;
}

function resolveAgent(a, agents) {
  const agent = typeof a === 'string' ? agents[a] : a;
  if (!agent || typeof agent.create !== 'function' || typeof agent.tier !== 'string' || typeof agent.label !== 'string') {
    throw new TypeError(`[aiBenchmark] unknown agent ${JSON.stringify(typeof a === 'string' ? a : a?.label)}.`);
  }
  return agent;
}

function emptyStats() {
  return {
    seatHands: 0, wins: 0, tsumo: 0, ron: 0, dealIns: 0, points: 0, fanTotal: 0, limitWins: 0,
    drawsTenpai: 0, drawsSeen: 0, claims: { chi: 0, pon: 0, kong: 0 }, concealedWins: 0,
    decisions: 0, decisionMs: [], discardModes: {}, fallbacks: 0,
  };
}

/** Wraps a strategy's decision methods to time them and record discard modes. */
function instrument(strategy, statsFor) {
  for (const m of ['chooseDiscard', 'chooseClaim', 'chooseWinDeclaration']) {
    const orig = strategy[m].bind(strategy);
    strategy[m] = (player, ...rest) => {
      const t0 = performance.now();
      const r = orig(player, ...rest);
      const st = statsFor(player.seatIndex);
      st.decisions++; st.decisionMs.push(performance.now() - t0);
      if (m === 'chooseDiscard' && typeof strategy.lastDiscardMode === 'string') {
        st.discardModes[strategy.lastDiscardMode] = (st.discardModes[strategy.lastDiscardMode] ?? 0) + 1;
      }
      return r;
    };
  }
  return strategy;
}

/**
 * Every physical tile is in exactly one place: a hand/meld, a discard pile or
 * the live wall. A discard claimed for a meld sits in the meld AND (marked
 * claimed) in its pile, so it is counted once; a discard claimed for Ron is
 * marked claimed but never joins the winner's hand, so it counts in the pile.
 */
export function tilesConserved(gm) {
  const ids = new Set(); let count = 0;
  const add = (t) => { ids.add(t.instanceId); count++; };
  for (const p of gm.getPlayers()) for (const t of p.getHand().allTiles) add(t);
  for (const p of gm.getPlayers()) {
    for (const e of p.getDiscardPile().entries) if (!(e.claimed && ids.has(e.tile.instanceId))) add(e.tile);
  }
  const w = gm.getWall().getWallStateSnapshot();
  for (const t of w.tiles.slice(w.drawIndex, w.liveWallEnd)) add(t);
  // Task 90 (Riichi): the dead wall's undrawn tiles, and the tiles cut off the
  // live wall's end after each Kan (the dead wall keeps 14 — they are never drawn).
  for (const t of gm.getWall().getDeadWallTiles()) add(t);
  if (w.deadWallReserved > 0) for (const t of w.tiles.slice(w.liveWallEnd, w.deadWallStart)) add(t);
  // Task 98 (Chinese Official): flowers set aside by the turn flow.
  const flow = gm.getTurnFlow?.();
  if (flow && typeof flow.getSetAsideTiles === 'function') for (const t of flow.getSetAsideTiles()) add(t);
  return ids.size === count && count === gm.getWall().totalCount;
}

/**
 * Runs a benchmark.
 * @param {Object} o
 * @param {(string|Object)[]} o.lineup       3 or 4 agents (names from AGENTS, or agent objects)
 * @param {number} o.seeds                   walls to play (each in every distinct rotation)
 * @param {number} [o.seedBase=20000]
 * @param {number} [o.minimumFan=3]
 * @param {Object} [o.agents=AGENTS]
 * @param {number} [o.maxTurns=800]
 * @returns {Object} report — see formatReport()
 */
export function runBenchmark({ lineup, seeds, seedBase = 20000, minimumFan = 3, agents = AGENTS, maxTurns = 800, ruleEngineFactory = null } = {}) {
  if (!Array.isArray(lineup) || (lineup.length !== 3 && lineup.length !== 4)) throw new RangeError('[aiBenchmark] lineup must list 3 or 4 agents.');
  if (!Number.isInteger(seeds) || seeds < 1) throw new RangeError('[aiBenchmark] seeds must be a positive integer.');
  const resolved = lineup.map((a) => resolveAgent(a, agents));
  const seenLabel = new Map();
  for (const a of resolved) {
    if (seenLabel.has(a.label) && seenLabel.get(a.label) !== a) throw new Error(`[aiBenchmark] two different agents are labelled "${a.label}".`);
    seenLabel.set(a.label, a);
  }
  const labels = [...new Set(resolved.map((a) => a.label))];
  const rotations = seatRotations(resolved.map((a) => a.label));
  const agentByLabel = Object.fromEntries(resolved.map((a) => [a.label, a]));

  const stats = Object.fromEntries(labels.map((l) => [l, emptyStats()]));
  const outcomes = { hands: 0, wins: 0, multiWins: 0, draws: 0 };
  const invariants = { errors: 0, errorSamples: [], conservationFailures: 0, zeroSumFailures: 0, underMinimumWins: 0 };
  const groups = []; // per seed: points per label (sum over rotations), seat-hands per label
  const t0 = Date.now();

  for (let s = 0; s < seeds; s++) {
    const seed = seedBase + s;
    const group = Object.fromEntries(labels.map((l) => [l, { points: 0, seatHands: 0, wins: 0, dealIns: 0 }]));
    rotations.forEach((rot, r) => {
      // Same stream in every rotation (Task 80b): mirrored rotations then
      // differ ONLY in which agent sits where, so two identical agents score
      // exactly the same and agent differences are measured exactly paired.
      const rng = mulberry32(seed * 131 + 1);
      const statsFor = (seat) => stats[rot[seat]];
      // One instance per agent label; agents sharing a tier sit behind a
      // seat dispatcher registered under that tier (Task 80b), so e.g. two
      // Advanced variants can play at one table on the same deals.
      const instances = new Map();
      for (const label of new Set(rot)) instances.set(label, instrument(agentByLabel[label].create(rng), statsFor));
      const strategies = new Map();
      for (const tier of new Set(rot.map((l) => agentByLabel[l].tier))) {
        const tierLabels = [...new Set(rot.filter((l) => agentByLabel[l].tier === tier))];
        strategies.set(tier, tierLabels.length === 1 ? instances.get(tierLabels[0]) : new SeatDispatchStrategy(tier, (seat) => instances.get(rot[seat])));
      }
      const playerConfigs = rot.map((label, seatIndex) => ({ seatIndex, displayName: `${label} ${seatIndex}`, seatKind: SEAT_KIND.AI, aiDifficulty: agentByLabel[label].tier }));
      const bus = new EventBus();
      bus.on('game:claim', ({ seatIndex, type }) => { const c = stats[rot[seatIndex]].claims; if (c[type] !== undefined) c[type]++; });
      try {
        // Task 90: any rule engine (default Hong Kong at `minimumFan`).
        const ruleEngine = ruleEngineFactory ? ruleEngineFactory(rot.length) : new HongKongRules({ minimumFan });
        const gm = new GameManager({ ruleEngine, playerConfigs, aiManager: new AIManager({ strategies: [...strategies.values()] }), eventBus: bus, seed, maxHands: 1 });
        const startTotal = gm.getPlayers().reduce((a, p) => a + p.score, 0);
        const startScores = gm.getPlayers().map((p) => p.score);
        const out = gm.playRoundWithAI({ maxTurns });
        if (!tilesConserved(gm)) invariants.conservationFailures++;
        gm.settleRound();
        outcomes.hands++;
        rot.forEach((label) => { stats[label].seatHands++; group[label].seatHands++; });
        if (out.type === 'win') {
          outcomes.wins++;
          if (out.winners.length > 1) outcomes.multiWins++;
          for (const w of out.winners) {
            const st = stats[rot[w.seatIndex]];
            if (!w.meetsMinimum) invariants.underMinimumWins++;
            st.wins++; group[rot[w.seatIndex]].wins++;
            st.fanTotal += w.fan;
            if (w.isLimit) st.limitWins++;
            if (gm.getPlayer(w.seatIndex).getHand().melds.every((m) => m.concealed === true)) st.concealedWins++;
            if (w.winType === 'self') st.tsumo++;
            else { st.ron++; stats[rot[w.calledFrom]].dealIns++; group[rot[w.calledFrom]].dealIns++; }
          }
        } else {
          outcomes.draws++;
          for (const r2 of out.results ?? []) {
            const st = stats[rot[r2.seatIndex]];
            st.drawsSeen++; if (r2.tenpai) st.drawsTenpai++;
          }
        }
        // Points are the change over this hand; riichi sticks left on the table count towards the total.
        let sum = 0;
        gm.getPlayers().forEach((p, i) => { const d = p.score - startScores[i]; stats[rot[i]].points += d; group[rot[i]].points += d; sum += p.score; });
        const sticks = gm.getTurnFlow?.()?.riichiSticks ?? 0;
        const stickValue = gm.getRuleEngine().getOptions?.().riichiStickValue ?? 1000;
        if (sum + sticks * stickValue !== startTotal) invariants.zeroSumFailures++;
      } catch (e) {
        invariants.errors++;
        if (invariants.errorSamples.length < 3) invariants.errorSamples.push(`seed ${seed} rotation ${r}: ${e?.stack ?? e}`);
      }
      for (const [label, st] of instances) {
        if (typeof st.getFallbackCount === 'function') stats[label].fallbacks += st.getFallbackCount();
      }
    });
    groups.push(group);
  }

  return { config: { lineup: resolved.map((a) => a.label), seeds, seedBase, minimumFan, rotations: rotations.length }, labels, stats, outcomes, invariants, groups, elapsedMs: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function meanSe(xs) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const se = Math.sqrt(variance / n);
  return { n, mean, se, lo: mean - 1.96 * se, hi: mean + 1.96 * se };
}

/** Per-agent derived rates (per seat-hand). */
export function summarize(report) {
  const out = {};
  for (const l of report.labels) {
    const s = report.stats[l];
    const ms = s.decisionMs.slice().sort((a, b) => a - b);
    const q = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * (ms.length - 1)))] : 0);
    out[l] = {
      seatHands: s.seatHands,
      winRate: s.wins / s.seatHands,
      tsumoShare: s.wins ? s.tsumo / s.wins : 0,
      dealInRate: s.dealIns / s.seatHands,
      pointsPerHand: s.points / s.seatHands,
      avgFan: s.wins ? s.fanTotal / s.wins : 0,
      concealedWinShare: s.wins ? s.concealedWins / s.wins : 0,
      tenpaiAtDraw: s.drawsSeen ? s.drawsTenpai / s.drawsSeen : 0,
      claimsPerHand: (s.claims.chi + s.claims.pon + s.claims.kong) / s.seatHands,
      claims: { ...s.claims },
      limitWins: s.limitWins,
      discardModes: { ...s.discardModes },
      fallbacks: s.fallbacks,
      decisions: s.decisions,
      decisionMs: { median: q(0.5), p95: q(0.95), max: q(1) },
    };
  }
  return out;
}

/**
 * Paired comparison of two agents over seeds: for each seed, the per-seat-hand
 * difference (a − b) of points, wins and deal-ins. Seeds are independent; the
 * rotations inside a seed are paired, which is what removes deal luck.
 */
export function compareAgents(report, a, b) {
  if (!report.labels.includes(a) || !report.labels.includes(b)) throw new Error(`[aiBenchmark] both agents must be in the report (${a}, ${b}).`);
  const per = (g, l, f) => g[l][f] / g[l].seatHands;
  const valid = report.groups.filter((g) => g[a].seatHands > 0 && g[b].seatHands > 0);
  return {
    points: meanSe(valid.map((g) => per(g, a, 'points') - per(g, b, 'points'))),
    wins: meanSe(valid.map((g) => per(g, a, 'wins') - per(g, b, 'wins'))),
    dealIns: meanSe(valid.map((g) => per(g, a, 'dealIns') - per(g, b, 'dealIns'))),
  };
}

/**
 * Paired comparison ACROSS two runs on the same walls — used for ablations,
 * where two variants of one tier can't share a table. Per seed:
 *   (labelA − opponent in run A) − (labelB − opponent in run B)
 * per seat-hand, for points, wins and deal-ins.
 */
export function compareRuns(reportA, labelA, reportB, labelB, opponent = 'basic') {
  const ca = reportA.config; const cb = reportB.config;
  if (ca.seeds !== cb.seeds || ca.seedBase !== cb.seedBase || ca.rotations !== cb.rotations || ca.minimumFan !== cb.minimumFan) {
    throw new Error('[aiBenchmark] compareRuns needs two runs over the same seeds, rotations and minimum fan.');
  }
  const rel = (g, l, f) => g[l][f] / g[l].seatHands - g[opponent][f] / g[opponent].seatHands;
  const diff = (f) => meanSe(reportA.groups.map((g, i) => rel(g, labelA, f) - rel(reportB.groups[i], labelB, f)));
  return { points: diff('points'), wins: diff('wins'), dealIns: diff('dealIns') };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const pct = (x) => `${(100 * x).toFixed(1)}%`;
const f1 = (x) => x.toFixed(1);
const ci = (c, fmt) => `${fmt(c.mean)} [${fmt(c.lo)}, ${fmt(c.hi)}]`;

export function formatReport(report, { compare } = {}) {
  const sum = summarize(report);
  const { config, outcomes, invariants } = report;
  const lines = [];
  lines.push(`Line-up ${config.lineup.join(' / ')} · ${config.seeds} walls × ${config.rotations} rotations = ${outcomes.hands} hands · minimum ${config.minimumFan} fan · seeds ${config.seedBase}–${config.seedBase + config.seeds - 1} · ${(report.elapsedMs / 1000).toFixed(1)} s`);
  lines.push(`Outcomes: ${outcomes.wins} won (${outcomes.multiWins} multi-Ron), ${outcomes.draws} drawn`);
  const cols = ['agent', 'seat-hands', 'win', 'deal-in', 'pts/hand', 'avg fan', 'tsumo', 'concealed', 'tenpai@draw', 'claims/hand', 'ms p50/p95/max', 'fallbacks'];
  const rows = report.labels.map((l) => {
    const s = sum[l];
    return [l, String(s.seatHands), pct(s.winRate), pct(s.dealInRate), f1(s.pointsPerHand), f1(s.avgFan), pct(s.tsumoShare), pct(s.concealedWinShare), pct(s.tenpaiAtDraw), s.claimsPerHand.toFixed(2),
      `${s.decisionMs.median.toFixed(1)}/${s.decisionMs.p95.toFixed(1)}/${s.decisionMs.max.toFixed(0)}`, String(s.fallbacks)];
  });
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const fmtRow = (r) => r.map((v, i) => v.padEnd(widths[i])).join('  ');
  lines.push(fmtRow(cols)); lines.push(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of rows) lines.push(fmtRow(r));
  for (const l of report.labels) {
    const modes = Object.entries(sum[l].discardModes);
    if (modes.length) lines.push(`${l} discard modes: ${modes.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  if (compare) {
    const [a, b] = compare;
    const c = compareAgents(report, a, b);
    lines.push(`${a} − ${b} per seat-hand, mean [95% CI] over ${c.points.n} walls: points ${ci(c.points, f1)} · wins ${ci(c.wins, pct)} · deal-ins ${ci(c.dealIns, pct)}`);
  }
  const bad = invariants.errors + invariants.conservationFailures + invariants.zeroSumFailures + invariants.underMinimumWins;
  lines.push(`Invariants: ${bad === 0 ? 'all held' : 'VIOLATED'} (errors ${invariants.errors}, tile conservation ${invariants.conservationFailures}, zero-sum ${invariants.zeroSumFailures}, wins under minimum ${invariants.underMinimumWins})`);
  for (const e of invariants.errorSamples) lines.push(`  ${e.split('\n')[0]}`);
  return lines.join('\n');
}
