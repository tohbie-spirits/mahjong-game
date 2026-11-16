/**
 * DifficultySelection.js — renderDifficultySelection(container, options)
 * (Task 55). Options: availableDifficulties (default both), selectedDifficulty,
 * onSelect(id), onBack.
 * REBUILT (after Task 77). Task 79: main.js now passes both tiers as
 * available (from StrategyRegistry) and pre-selects the last tier picked;
 * the Advanced description mentions its fan-aware planning (Task 78b).
 */
import { AI_DIFFICULTY, AI_DIFFICULTY_LABEL } from '../../utils/constants.js';
import { renderChoiceScreen } from './_choiceScreen.js';

const DESCRIPTIONS = Object.freeze({
  [AI_DIFFICULTY.BASIC]: 'Relaxed opponents that keep connected tiles and claim freely.',
  [AI_DIFFICULTY.ADVANCED]: 'Opponents that build scoring hands efficiently, read the table and play defence.',
});

export function renderDifficultySelection(container, options = {}) {
  const ids = [AI_DIFFICULTY.BASIC, AI_DIFFICULTY.ADVANCED];
  return renderChoiceScreen(container, {
    name: 'DifficultySelection',
    rootClass: 'difficulty-selection',
    title: 'Choose opponent difficulty',
    choices: ids.map((id) => ({ value: id, label: AI_DIFFICULTY_LABEL[id], description: DESCRIPTIONS[id] })),
    available: options.availableDifficulties ?? ids,
    selected: options.selectedDifficulty,
    onSelect: options.onSelect,
    onBack: options.onBack,
  });
}
