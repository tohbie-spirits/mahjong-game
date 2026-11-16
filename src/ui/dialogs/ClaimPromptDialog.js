/**
 * ClaimPromptDialog.js
 *
 * renderClaimPrompt(container, legalActions, onChoose) — one button per legal
 * action (Task 51), ordered Win > Kong > Pon > Chi, plus an always-present
 * Pass. Each Chi sequence gets its own button ("Chi 3-4-5 Bamboo"). The
 * callback receives the EXACT action object chosen, or { type: PASS }.
 * Unknown action types throw (callers filter DISCARD pseudo-actions out).
 * Task 102: Riichi's RIICHI ("declare riichi, then pick the discard") and
 * ABORTIVE_DRAW (nine terminals) self-actions; renderClaimPrompt's optional
 * 4th argument { format } (src/ui/scoreFormat.js) words the win button in
 * the ruleset's own unit (fan / han / pts). Task 118: options.title (the
 * heading — a call on a discard names the discard).
 *
 * REBUILT (after Task 77).
 */

import { ACTION_TYPE, KONG_TYPE, SUIT_LABEL } from '../../utils/constants.js';
import { Tile } from '../../core/Tile.js';

const ORDER = Object.freeze({ [ACTION_TYPE.WIN]: 0, [ACTION_TYPE.RIICHI]: 1, [ACTION_TYPE.KONG]: 2, [ACTION_TYPE.PON]: 3, [ACTION_TYPE.CHI]: 4, [ACTION_TYPE.ABORTIVE_DRAW]: 5 });

/** Human-readable button label for an action. */
export function describeAction(action, { format = null, terms = null } = {}) {
  const word = (k, d) => (terms && typeof terms[k] === 'string' && terms[k]) || d; // Task 118: the ruleset's own call names
  switch (action.type) {
    case ACTION_TYPE.WIN: {
      const how = action.winType === 'self' ? 'Self-drawn' : 'On discard';
      const fan = format ? format.winLabel(action.score) : action.score && Number.isFinite(action.score.fan) ? ` · ${action.score.fan} fan` : '';
      return `Mahjong! (${how}${fan})`;
    }
    case ACTION_TYPE.RIICHI:
      return 'Riichi — declare, then choose your discard';
    case ACTION_TYPE.ABORTIVE_DRAW:
      return 'Abortive draw — nine different terminals & honours';
    case ACTION_TYPE.KONG: {
      const face = Tile.fromId(action.faceId).label;
      if (action.kongType === KONG_TYPE.CONCEALED) return `${word('kong', 'Kong')} — ${face} (concealed)`;
      if (action.kongType === KONG_TYPE.ADDED) return `${word('kong', 'Kong')} — add ${face} to your ${word('pon', 'Pung')}`;
      return `${word('kong', 'Kong')} — ${face}`;
    }
    case ACTION_TYPE.PON:
      return `${word('pon', 'Pon')} — ${action.tile.label}`;
    case ACTION_TYPE.CHI: {
      const ranks = action.sequence.map((id) => id.split('-')[1]).join('-');
      return `${word('chi', 'Chi')} ${ranks} ${SUIT_LABEL[action.tile.suit]}`;
    }
    default:
      throw new TypeError(`[ClaimPromptDialog] unsupported action type: ${action?.type}`);
  }
}

export function renderClaimPrompt(container, legalActions, onChoose, options = {}) {
  if (!(container instanceof Element)) throw new TypeError('[ClaimPromptDialog] container must be a DOM Element.');
  if (!Array.isArray(legalActions) || legalActions.length === 0) throw new TypeError('[ClaimPromptDialog] legalActions must be a non-empty array.');
  if (typeof onChoose !== 'function') throw new TypeError('[ClaimPromptDialog] onChoose must be a function.');
  for (const a of legalActions) {
    if (!(a?.type in ORDER)) throw new TypeError(`[ClaimPromptDialog] unsupported action type: ${a?.type}`);
  }
  container.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'claim-prompt';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Choose an action');

  const title = document.createElement('h2');
  title.className = 'claim-prompt-title';
  title.textContent = typeof options.title === 'string' && options.title ? options.title : 'Your move'; // Task 118: "AI 2 discards 5 of Dots"
  if (typeof options.title === 'string' && options.title) card.setAttribute('aria-label', options.title);
  card.appendChild(title);

  const list = document.createElement('div');
  list.className = 'claim-prompt-options';
  const sorted = legalActions.slice().sort((a, b) => ORDER[a.type] - ORDER[b.type]);
  for (const action of sorted) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `claim-prompt-btn claim-prompt-btn--${action.type}`;
    btn.dataset.actionIndex = String(legalActions.indexOf(action)); // Task 116: hints mark the suggested action
    btn.textContent = describeAction(action, options);
    btn.addEventListener('click', () => onChoose(action));
    list.appendChild(btn);
  }
  card.appendChild(list);

  const pass = document.createElement('button');
  pass.type = 'button';
  pass.className = 'claim-prompt-btn claim-prompt-btn--pass';
  pass.dataset.actionIndex = 'pass';
  pass.textContent = 'Pass';
  pass.addEventListener('click', () => onChoose({ type: ACTION_TYPE.PASS }));
  card.appendChild(pass);

  container.appendChild(card);
  try { list.querySelector('button')?.focus(); } catch { /* headless */ }
  return card;
}
