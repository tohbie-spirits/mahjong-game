/**
 * _choiceScreen.js — the shared card-picker behind RuleSelection,
 * PlayerCountSelection and DifficultySelection (Tasks 53–55): full-viewport
 * screen, one card per choice, unavailable choices disabled with a
 * "Coming Soon" badge, immediate click-to-advance, optional Back.
 */

import { h, button, assertContainer } from './_screenKit.js';

export function renderChoiceScreen(container, { name, rootClass, title, subtitle, choices, available, selected, onSelect, onBack }) {
  assertContainer(container, name);
  if (typeof onSelect !== 'function') throw new TypeError(`[${name}] options.onSelect is required.`);
  container.innerHTML = '';
  container.classList.add(rootClass);

  const header = h('header', `${rootClass}-header`);
  header.appendChild(h('h1', `${rootClass}-title`, title));
  if (subtitle) header.appendChild(h('p', `${rootClass}-subtitle`, subtitle));
  container.appendChild(header);

  const list = h('div', `${rootClass}-cards`);
  list.setAttribute('role', 'list');
  for (const c of choices) {
    const isAvailable = available.includes(c.value);
    const card = button(`${rootClass}-card${isAvailable ? '' : ` ${rootClass}-card--disabled`}${selected === c.value && isAvailable ? ` ${rootClass}-card--selected` : ''}`);
    card.setAttribute('role', 'listitem');
    card.dataset.value = String(c.value);
    card.disabled = !isAvailable;
    card.appendChild(h('span', `${rootClass}-card-label`, c.label));
    if (c.description) card.appendChild(h('span', `${rootClass}-card-description`, c.description));
    if (!isAvailable) card.appendChild(h('span', `${rootClass}-card-badge`, 'Coming Soon'));
    if (isAvailable) card.addEventListener('click', () => onSelect(c.value));
    list.appendChild(card);
  }
  container.appendChild(list);

  if (typeof onBack === 'function') container.appendChild(button(`${rootClass}-back`, 'Back', () => onBack()));
  try { list.querySelector('button:not([disabled])')?.focus(); } catch { /* headless */ }
  return container;
}
