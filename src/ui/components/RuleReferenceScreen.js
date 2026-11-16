/**
 * RuleReferenceScreen.js — Task 114: the per-ruleset rules reference.
 *
 *   const ref = renderRuleReferenceScreen(container, {
 *     references: [hkRef, riichiRef, mcrRef],   // data from src/rules/<ruleset>/*Reference.js, via main.js
 *     initialRulesetId, onSelect(id), onBack(),
 *     embedded,                                  // inside the game's overlay (Pause → Rules): compact, no page shell
 *   });
 *   ref.select(rulesetId); ref.search('dragon'); ref.destroy();
 *
 * The screen is generic: it renders whatever reference objects it is given
 * (shape documented in src/rules/hongkong/HongKongReference.js) and never
 * imports a ruleset — main.js, the composition root, supplies the data, so
 * the content lives next to the rules it describes and can't drift from them.
 *
 * Per ruleset: a header (name, native name, one-line summary, key facts), an
 * index of its sections, the sections (paragraphs, lists, example tiles drawn
 * by TileRenderer), the scoring table with a live filter (the Chinese Official
 * table has 81 fans) and a glossary. Rulesets are tabs (role="tablist"; ←/→,
 * Home/End move between them); with one reference the tabs are left out.
 */
import { h, button, assertContainer } from './_screenKit.js';
import { createTileElement } from '../TileRenderer.js';
import { Tile } from '../../core/Tile.js';

let instanceSeq = 0;

/** True when a scoring row matches a filter query (name, native name, value, note). */
export function rowMatches(row, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.native, row.value, row.note].some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
}

export function renderRuleReferenceScreen(container, options = {}) {
  assertContainer(container, 'RuleReferenceScreen');
  const refs = Array.isArray(options.references) ? options.references.filter((r) => r && r.rulesetId) : [];
  if (refs.length === 0) throw new TypeError('[RuleReferenceScreen] at least one reference is required.');
  const embedded = options.embedded === true;
  const uid = `rr${++instanceSeq}`;
  let current = refs.find((r) => r.rulesetId === options.initialRulesetId) ?? refs[0];
  let query = '';

  container.innerHTML = '';
  if (!embedded) container.classList.add('rule-reference-screen');
  const root = h('div', `rule-reference${embedded ? ' rule-reference--embedded' : ''}`);
  root.setAttribute('role', embedded ? 'dialog' : 'region');
  root.setAttribute('aria-label', 'Rule reference');

  const head = h('header', 'rule-reference-head');
  head.appendChild(h(embedded ? 'h2' : 'h1', 'rule-reference-title', embedded ? 'Rules' : 'Rule Reference'));
  if (typeof options.onBack === 'function') head.appendChild(button('rule-reference-back', embedded ? 'Back' : 'Back to Menu', () => options.onBack()));
  root.appendChild(head);

  // Tabs
  const tabs = [];
  let tablist = null;
  if (refs.length > 1) {
    tablist = h('div', 'rule-reference-tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Ruleset');
    refs.forEach((r, i) => {
      const t = button('rule-reference-tab', r.title, () => select(r.rulesetId, { focus: false }));
      t.id = `${uid}-tab-${i}`;
      t.dataset.value = r.rulesetId;
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-controls', `${uid}-panel`);
      t.addEventListener('keydown', (e) => {
        const k = e.key;
        const j = k === 'ArrowRight' ? (i + 1) % refs.length : k === 'ArrowLeft' ? (i - 1 + refs.length) % refs.length : k === 'Home' ? 0 : k === 'End' ? refs.length - 1 : -1;
        if (j < 0) return;
        e.preventDefault?.();
        select(refs[j].rulesetId, { focus: true });
      });
      tabs.push(t);
      tablist.appendChild(t);
    });
    root.appendChild(tablist);
  }

  const panel = h('div', 'rule-reference-panel');
  panel.id = `${uid}-panel`;
  if (tablist) panel.setAttribute('role', 'tabpanel');
  panel.tabIndex = -1;
  root.appendChild(panel);
  container.appendChild(root);

  let scoringBody = null;
  let countEl = null;
  let searchInput = null;
  renderPanel();

  return {
    element: root,
    select: (id) => select(id, { focus: false }),
    search: (q) => { if (searchInput) searchInput.value = q; applyFilter(q); },
    current: () => current.rulesetId,
    destroy() { container.innerHTML = ''; },
  };

  // ---------------------------------------------------------------------
  function select(id, { focus }) {
    const next = refs.find((r) => r.rulesetId === id);
    if (!next) return;
    const changed = next !== current;
    current = next;
    query = '';
    renderPanel();
    if (focus) tabs[refs.indexOf(next)]?.focus?.();
    if (changed) options.onSelect?.(id);
  }

  function renderPanel() {
    tabs.forEach((t, i) => {
      const on = refs[i] === current;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('rule-reference-tab--selected', on);
    });
    if (tablist) panel.setAttribute('aria-labelledby', tabs[refs.indexOf(current)].id);
    panel.innerHTML = '';
    panel.dataset.ruleset = current.rulesetId;
    const r = current;

    const hero = h('section', 'rule-reference-hero');
    const t = h('h2', 'rule-reference-ruleset', r.title);
    if (r.native) { const n = h('span', 'rule-reference-native', r.native); n.setAttribute('lang', /[ぁ-んァ-ン]/.test(r.native) ? 'ja' : 'zh'); t.appendChild(n); }
    hero.appendChild(t);
    if (r.summary) hero.appendChild(h('p', 'rule-reference-summary', r.summary));
    if (Array.isArray(r.facts) && r.facts.length) {
      const dl = h('dl', 'rule-reference-facts');
      for (const f of r.facts) {
        const item = h('div', 'rule-reference-fact');
        item.append(h('dt', '', f.label), h('dd', '', f.value));
        dl.appendChild(item);
      }
      hero.appendChild(dl);
    }
    panel.appendChild(hero);

    // Index
    const entries = [...(r.sections ?? []).map((s) => [s.id, s.title]), ...(r.scoring ? [['scoring-table', r.scoring.title]] : []), ...(r.glossary?.length ? [['glossary', 'Glossary']] : [])];
    const nav = h('nav', 'rule-reference-index');
    nav.setAttribute('aria-label', `${r.title} contents`);
    for (const [id, title] of entries) {
      const b = button('rule-reference-index-link', title, () => {
        const target = panel.querySelector(`[data-section="${id}"]`);
        try { target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); } catch { /* old browsers */ }
        try { target?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
      });
      b.dataset.target = id;
      nav.appendChild(b);
    }
    panel.appendChild(nav);

    for (const s of r.sections ?? []) {
      const sec = h('section', 'rule-reference-section');
      sec.dataset.section = s.id;
      sec.tabIndex = -1;
      sec.appendChild(h('h3', 'rule-reference-section-title', s.title));
      for (const b of s.blocks ?? []) sec.appendChild(renderBlock(b));
      panel.appendChild(sec);
    }

    if (r.scoring) panel.appendChild(renderScoring(r.scoring));

    if (r.glossary?.length) {
      const sec = h('section', 'rule-reference-section rule-reference-glossary');
      sec.dataset.section = 'glossary';
      sec.tabIndex = -1;
      sec.appendChild(h('h3', 'rule-reference-section-title', 'Glossary'));
      const dl = h('dl', 'rule-reference-glossary-list');
      for (const g of r.glossary) {
        const dt = h('dt', '', g.term);
        if (g.native) dt.appendChild(h('span', 'rule-reference-native', g.native));
        dl.append(dt, h('dd', '', g.meaning));
      }
      sec.appendChild(dl);
      panel.appendChild(sec);
    }
  }

  function renderBlock(b) {
    if (b.type === 'list') {
      const ul = h('ul', 'rule-reference-list');
      for (const item of b.items ?? []) if (item && String(item).trim()) ul.appendChild(h('li', '', String(item).trim()));
      return ul;
    }
    if (b.type === 'tiles') {
      const fig = h('figure', 'rule-reference-tiles');
      const row = h('div', 'rule-reference-tile-row');
      (b.tiles ?? []).forEach((id, i) => {
        try { row.appendChild(createTileElement(Tile.fromId(id, `${uid}-${id}-${i}`), { size: 'sm' })); } catch { /* an unknown face id is skipped */ }
      });
      fig.appendChild(row);
      if (b.caption) fig.appendChild(h('figcaption', 'rule-reference-caption', b.caption));
      return fig;
    }
    return h('p', 'rule-reference-text', b.text ?? '');
  }

  function renderScoring(scoring) {
    const sec = h('section', 'rule-reference-section rule-reference-scoring');
    sec.dataset.section = 'scoring-table';
    sec.tabIndex = -1;
    sec.appendChild(h('h3', 'rule-reference-section-title', scoring.title));
    if (scoring.intro) sec.appendChild(h('p', 'rule-reference-text', scoring.intro));
    const bar = h('div', 'rule-reference-search');
    const id = `${uid}-search`;
    const label = h('label', 'rule-reference-search-label', 'Filter');
    label.htmlFor = id;
    searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.id = id;
    searchInput.className = 'rule-reference-search-input';
    searchInput.placeholder = 'Search by name, e.g. "dragon"';
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.addEventListener('input', () => applyFilter(searchInput.value));
    countEl = h('span', 'rule-reference-search-count');
    countEl.setAttribute('aria-live', 'polite');
    bar.append(label, searchInput, countEl);
    sec.appendChild(bar);
    scoringBody = h('div', 'rule-reference-scoring-body');
    sec.appendChild(scoringBody);
    applyFilter(query);
    return sec;
  }

  function applyFilter(q) {
    query = q ?? '';
    if (!scoringBody) return;
    scoringBody.innerHTML = '';
    const groups = current.scoring.groups ?? [];
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    let shown = 0;
    for (const g of groups) {
      const rows = g.rows.filter((row) => rowMatches(row, query));
      if (!rows.length) continue;
      shown += rows.length;
      const table = h('table', 'rule-reference-table');
      const cap = h('caption', 'rule-reference-group', g.title);
      table.appendChild(cap);
      const tb = h('tbody');
      for (const row of rows) {
        const tr = h('tr', 'rule-reference-row');
        tr.dataset.id = row.id;
        const name = h('th', 'rule-reference-row-name', row.name);
        name.setAttribute('scope', 'row');
        if (row.native) name.appendChild(h('span', 'rule-reference-native', row.native));
        if (row.note) name.appendChild(h('span', 'rule-reference-note', row.note));
        tr.append(name, h('td', 'rule-reference-row-value', row.value));
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      scoringBody.appendChild(table);
    }
    if (!shown) scoringBody.appendChild(h('p', 'rule-reference-empty', `Nothing matches "${String(query).trim()}".`));
    countEl.textContent = String(query).trim() ? `${shown} of ${total}` : `${total} entries`;
  }
}
