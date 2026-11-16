/**
 * run-all.mjs — runs every *.test.mjs suite under tests/ in its own Node
 * process and prints a one-line result per suite.
 *   node tests/run-all.mjs            (all suites)
 *   node tests/run-all.mjs --fast     (skips the long AI benchmark suites)
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const SLOW = ['regressionMatrix', 'chineseOfficialFullGameSimulation', 'chineseOfficialAI', 'riichiFullGameSimulation', 'riichiAI', 'defenseTuning', 'aiBenchmark', 'handValuePlanner', 'advancedIntegration', 'advancedStrategyDiscard', 'advancedStrategyClaim', 'advancedStrategyDefense', 'defensivePlayEvaluator', 'handEfficiencyEvaluator'];
const fast = process.argv.includes('--fast');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name.startsWith('_') ? [] : walk(p);
    return name.endsWith('.test.mjs') ? [p] : [];
  });
}

let failures = 0;
for (const file of walk(root).sort()) {
  const rel = relative(root, file);
  if (fast && SLOW.some((s) => rel.includes(s))) { console.log(`- ${rel} (skipped: --fast)`); continue; }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  const out = `${r.stdout}\n${r.stderr}`;
  const line = out.split('\n').reverse().find((l) => /assertions passed|passed,|FAILED|✓ StatisticsManager|Error/.test(l)) ?? '';
  const ok = r.status === 0;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${rel} — ${line.trim()} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log(failures ? `\n${failures} suite(s) FAILED` : '\nAll suites passed.');
process.exit(failures ? 1 : 0);
