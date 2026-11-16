/**
 * docs.test.mjs — Task 120: the documentation stays true.
 *
 * Sections:
 *   1. docs/rules-reference.md is exactly what tools/build-docs.mjs generates
 *      from the engines' reference modules (regenerate after a rules change)
 *   2. Every source / test / tool path the docs and README mention exists,
 *      and every relative link points at a real file (and heading)
 *   3. Every source file opens with a header comment
 *
 * Run: node tests/core/docs.test.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { section, assert, summary } from '../_helpers/harness.mjs';
import { renderRulesReference, RULES_REFERENCE_PATH } from '../../tools/build-docs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DOCS = ['docs/architecture.md', 'docs/contributing.md', 'docs/rules-reference.md', 'README.md'];
const slug = (h) => h.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');

section('1. The rules reference is generated', () => {
  const text = existsSync(RULES_REFERENCE_PATH) ? readFileSync(RULES_REFERENCE_PATH, 'utf8') : '';
  assert(text === renderRulesReference(), 'docs/rules-reference.md matches the engines (if not: node tools/build-docs.mjs)');
  for (const t of ['Hong Kong Mahjong', 'Riichi Mahjong', 'Chinese Official']) assert(text.includes(`## ${t}`), `it covers ${t}`);
  assert(!/undefined|NaN|\[object Object\]/.test(text), 'no "undefined" / "NaN" in it');
});

section('2. Paths and links', () => {
  for (const doc of DOCS) {
    const text = readFileSync(join(ROOT, doc), 'utf8');
    const paths = [...new Set([...text.matchAll(/`((?:src|tests|tools|styles|docs)\/[A-Za-z0-9_./<>*-]+)`/g)].map((m) => m[1]))]
      .filter((p) => !/[<>*]|…/.test(p));
    const missing = paths.filter((p) => !existsSync(join(ROOT, p.replace(/\/$/, ''))));
    assert(paths.length > 0 || doc === 'docs/rules-reference.md' || doc === 'README.md', `${doc}: mentions files`);
    assert(missing.length === 0, `${doc}: every file it names exists (${paths.length} checked${missing.length ? '; missing: ' + missing.join(', ') : ''})`);
    const links = [...text.matchAll(/\]\(([^)#\s]*)(#[^)\s]*)?\)/g)].filter((m) => !/^https?:/.test(m[1]));
    const broken = [];
    for (const [, file, hash] of links) {
      const target = file ? join(dirname(join(ROOT, doc)), file) : join(ROOT, doc);
      if (!existsSync(target)) { broken.push(file); continue; }
      if (hash && statSync(target).isFile()) {
        const heads = [...readFileSync(target, 'utf8').matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1]));
        if (!heads.includes(hash.slice(1))) broken.push(`${file}${hash}`);
      }
    }
    assert(broken.length === 0, `${doc}: ${links.length} relative links resolve${broken.length ? ' — broken: ' + broken.join(', ') : ''}`);
  }
});

section('3. File headers', () => {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(join(ROOT, 'src'));
  const bare = files.filter((f) => !/^\s*\/\*/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(ROOT.length + 1));
  assert(files.length > 90 && bare.length === 0, `all ${files.length} source files open with a header comment${bare.length ? ' — missing: ' + bare.join(', ') : ''}`);
});

summary();
