#!/usr/bin/env node
/**
 * ai-benchmark.mjs — Task 80: run an AI benchmark from the command line.
 *
 *   node tools/ai-benchmark.mjs                                   (Advanced vs Basic, 2v2, 100 walls)
 *   node tools/ai-benchmark.mjs --lineup advanced,basic,basic --seeds 200
 *   node tools/ai-benchmark.mjs --lineup advanced-no-defense,basic,advanced-no-defense,basic --min-fan 1
 *   node tools/ai-benchmark.mjs --json /tmp/report.json
 *
 * Options:
 *   --lineup a,b,c[,d]   agents per seat (3 or 4). Agents: basic, advanced,
 *                        advanced-no-defense, advanced-fan-blind, advanced-speed-only,
 *                        advanced-task77-defense (pre-80b defence, Task 80b)
 *   --seeds N            walls to play; each is played in every distinct seat rotation (default 100)
 *   --seed-base N        first wall seed (default 20000)
 *   --min-fan N          Hong Kong minimum fan (default 3)
 *   --compare a,b        paired comparison to print (default: the first two distinct agents)
 *   --json PATH          also write the full report (minus raw timings) as JSON
 *
 * The engine lives in tests/_helpers/aiBenchmark.mjs. Exit code 1 when any
 * engine invariant was violated (errors, tile conservation, zero-sum, a win
 * under the minimum fan).
 */
import { writeFileSync } from 'node:fs';
import { runBenchmark, formatReport, summarize, compareAgents, AGENTS } from '../tests/_helpers/aiBenchmark.mjs';

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2);
    if (key === 'help') { o.help = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`--${key} needs a value`);
    o[key] = v;
  }
  return o;
}

let args;
try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
if (args.help) {
  console.log(`Agents: ${Object.keys(AGENTS).join(', ')}\nSee the header of tools/ai-benchmark.mjs for options.`);
  process.exit(0);
}

const lineup = (args.lineup ?? 'advanced,basic,advanced,basic').split(',').map((s) => s.trim());
const int = (v, d, name) => {
  if (v === undefined) return d;
  const n = Number(v);
  if (!Number.isInteger(n)) { console.error(`--${name} must be an integer`); process.exit(2); }
  return n;
};
const seeds = int(args.seeds, 100, 'seeds');
const seedBase = int(args['seed-base'], 20000, 'seed-base');
const minimumFan = int(args['min-fan'], 3, 'min-fan');
const distinct = [...new Set(lineup)];
const compare = args.compare ? args.compare.split(',') : (distinct.length >= 2 ? distinct.slice(0, 2) : undefined);

let report;
try {
  report = runBenchmark({ lineup, seeds, seedBase, minimumFan });
} catch (e) { console.error(e.message); process.exit(2); }
console.log(formatReport(report, { compare }));

if (args.json) {
  const { groups, ...rest } = report;
  const stats = Object.fromEntries(Object.entries(report.stats).map(([k, v]) => [k, { ...v, decisionMs: undefined }]));
  writeFileSync(args.json, JSON.stringify({ ...rest, stats, groups, summary: summarize(report), comparison: compare ? compareAgents(report, ...compare) : null }, null, 2));
  console.log(`JSON written to ${args.json}`);
}

const inv = report.invariants;
process.exit(inv.errors + inv.conservationFailures + inv.zeroSumFailures + inv.underMinimumWins > 0 ? 1 : 0);
