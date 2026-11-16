/**
 * harness.mjs — tiny shared assertion harness for the rebuilt test suites
 * (same output style as the surviving Task 69–77 tests).
 */
let passed = 0;
let failed = 0;
const failures = [];
let currentSection = '';

export function section(name, fn) {
  currentSection = name;
  console.log(`\n▸ ${name}`);
  return fn();
}

export async function sectionAsync(name, fn) {
  currentSection = name;
  console.log(`\n▸ ${name}`);
  return await fn();
}

export function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✓ ${message}`); }
  else { failed++; failures.push(`[${currentSection}] ${message}`); console.error(`  ✗ FAIL: ${message}`); }
}

export function assertThrows(fn, expectedType, message) {
  let threw = false; let err = null;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (!threw) assert(false, `${message} — expected throw, nothing thrown`);
  else if (expectedType && !(err instanceof expectedType)) assert(false, `${message} — wrong error type: ${err?.constructor?.name} (${err?.message})`);
  else assert(true, message);
}

export function summary() {
  console.log(`\n${'─'.repeat(50)}`);
  if (failed === 0) {
    console.log(`✓ All ${passed} assertions passed.`);
  } else {
    console.log(`${passed} passed, ${failed} FAILED.`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
}

/** Deterministic PRNG for tests. */
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
