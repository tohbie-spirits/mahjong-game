/**
 * RuleSelection.js — renderRuleSelection(container, options) (Task 53).
 * Options: availableRulesetIds (default all three), selectedRulesetId,
 * onSelect(rulesetId), onBack. Identities from RULESET_ID / RULESET_LABEL;
 * the short descriptions are UI copy owned here.
 * REBUILT (after Task 77).
 */
import { RULESET_ID, RULESET_LABEL } from '../../utils/constants.js';
import { renderChoiceScreen } from './_choiceScreen.js';

const DESCRIPTIONS = Object.freeze({
  [RULESET_ID.HONG_KONG]: 'Fan-based scoring, a three-fan minimum, Chow from the player on your left.',
  [RULESET_ID.RIICHI]: 'Japanese rules: riichi declarations, yaku, dora and han/fu scoring.',
  [RULESET_ID.CHINESE_OFFICIAL]: 'The international competition rules: 81 scoring patterns, eight-point minimum.',
});

export function renderRuleSelection(container, options = {}) {
  const ids = [RULESET_ID.HONG_KONG, RULESET_ID.RIICHI, RULESET_ID.CHINESE_OFFICIAL];
  return renderChoiceScreen(container, {
    name: 'RuleSelection',
    rootClass: 'rule-selection',
    title: 'Choose a ruleset',
    choices: ids.map((id) => ({ value: id, label: RULESET_LABEL[id], description: DESCRIPTIONS[id] })),
    available: options.availableRulesetIds ?? ids,
    selected: options.selectedRulesetId,
    onSelect: options.onSelect,
    onBack: options.onBack,
  });
}
