/**
 * PlayerCountSelection.js — renderPlayerCountSelection(container, options)
 * (Task 54). Options: availablePlayerCounts (default [4, 3]), onSelect(n), onBack.
 * REBUILT (after Task 77).
 */
import { PLAYER_COUNT } from '../../utils/constants.js';
import { renderChoiceScreen } from './_choiceScreen.js';

export function renderPlayerCountSelection(container, options = {}) {
  return renderChoiceScreen(container, {
    name: 'PlayerCountSelection',
    rootClass: 'player-count-selection',
    title: 'How many players?',
    choices: [
      { value: PLAYER_COUNT.FOUR, label: '4 Players', description: 'The classic table: you and three AI opponents.' },
      { value: PLAYER_COUNT.THREE, label: '3 Players', description: 'You and two AI opponents with the full tile set; the North seat stays empty.' },
    ],
    available: options.availablePlayerCounts ?? [PLAYER_COUNT.FOUR, PLAYER_COUNT.THREE],
    selected: options.selectedPlayerCount,
    onSelect: options.onSelect,
    onBack: options.onBack,
  });
}
