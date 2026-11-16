/**
 * PauseMenu.js — renderPauseMenu(container, { onResume, onRestart, onQuit })
 * (Task 66): Resume (primary, always), Restart (only with onRestart), Quit to
 * Menu (secondary, always). role="dialog", aria-modal. Re-render safe; the
 * container's className is never modified.
 * Task 114: Rules (only with onRules) — the current ruleset's reference.
 * Task 115: options.shortcuts ([[keys, what], …]) lists the keyboard shortcuts.
 * REBUILT (after Task 77).
 */
import { h, button, assertContainer } from './_screenKit.js';

export function renderPauseMenu(container, options = {}) {
  assertContainer(container, 'PauseMenu');
  container.innerHTML = '';
  const card = h('div', 'pause-menu');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Game paused');
  card.appendChild(h('h2', 'pause-menu-title', 'Paused'));
  const actions = h('div', 'pause-menu-actions');
  const resume = button('pause-menu-btn pause-menu-btn--primary', 'Resume', () => options.onResume?.());
  actions.appendChild(resume);
  if (typeof options.onRules === 'function') actions.appendChild(button('pause-menu-btn pause-menu-btn--secondary', 'Rules', () => options.onRules()));
  if (typeof options.onRestart === 'function') actions.appendChild(button('pause-menu-btn pause-menu-btn--secondary', 'Restart Game', () => options.onRestart()));
  actions.appendChild(button('pause-menu-btn pause-menu-btn--secondary', 'Quit to Menu', () => options.onQuit?.()));
  card.appendChild(actions);
  if (Array.isArray(options.shortcuts) && options.shortcuts.length) {
    const box = h('section', 'pause-menu-keys');
    box.appendChild(h('h3', 'pause-menu-keys-title', 'Keyboard'));
    const dl = h('dl', 'pause-menu-keys-list');
    for (const [keys, what] of options.shortcuts) {
      const dt = h('dt');
      String(keys).split(' / ').forEach((k, i) => { if (i) dt.appendChild(document.createTextNode(' / ')); dt.appendChild(h('kbd', '', k)); });
      dl.append(dt, h('dd', '', what));
    }
    box.appendChild(dl);
    card.appendChild(box);
  }
  container.appendChild(card);
  try { resume.focus(); } catch { /* headless */ }
  return card;
}
