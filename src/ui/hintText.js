/**
 * hintText.js — Tasks 116–117: hint advice (src/ai/HintAdvisor.js) in words.
 *
 *   formatDiscardHint(hint, { labelOf })  → { headline, details: string[] }
 *   formatActionHint(hint, { labelOf })   → { headline, details: string[] }
 *   formatClaimHint(hint, { labelOf, callName }) → { headline, details: string[] }   (Task 118: calls on a discard)
 *
 * Pure (no DOM), so the wording is tested on its own. `labelOf(faceId)` names
 * a tile ("5 of Dots"); the default uses Tile labels.
 */
import { Tile } from '../core/Tile.js';
import { RULESET_ID } from '../utils/constants.js';

const defaultLabel = (faceId) => { try { return Tile.fromId(faceId, `${faceId}#hint-label`).label; } catch { return faceId; } };
const SUIT_NAMES = ['Dots', 'Bamboo', 'Characters'];

/** "A, B or C". */
export function listOf(items, conj = 'or') {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a.join('');
  return `${a.slice(0, -1).join(', ')} ${conj} ${a.at(-1)}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A value route in words ("Mixed One Suit in Bamboo (3 fan)"). */
export function describeRoute(note, labelOf = defaultLabel) {
  const suit = Number.isInteger(note.suit) ? SUIT_NAMES[note.suit] : null;
  const honor = note.honorFaceId ? labelOf(note.honorFaceId) : null;
  const unit = note.ruleset === RULESET_ID.CHINESE_OFFICIAL ? `${note.points} points` : `${note.fan} fan`;
  const names = {
    plain: 'any complete hand',
    'honor-pung': honor ? `a Pung of ${honor}` : 'an honour Pung',
    flush: suit ? `one suit — ${suit} (plus honours)` : 'one suit',
    'all-pungs': 'All Pungs',
    'mixed-straight': 'Mixed Straight (1-2-3, 4-5-6, 7-8-9 in three suits)',
    'pure-straight': suit ? `Pure Straight in ${suit} (1 to 9)` : 'Pure Straight (1 to 9)',
    'mixed-triple-chow': 'Mixed Triple Chow (the same run in all three suits)',
    'full-flush': suit ? `Full Flush in ${suit}` : 'Full Flush',
    'half-flush': suit ? `Half Flush in ${suit}` : 'Half Flush',
    'half-flush-honor': `${suit ? `Half Flush in ${suit}` : 'Half Flush'}${honor ? ` with a Pung of ${honor}` : ''}`,
    'all-pungs-honor': `All Pungs${honor ? ` with a Pung of ${honor}` : ''}`,
    'seven-pairs': 'Seven Pairs',
    'thirteen-orphans': 'Thirteen Orphans',
    'honors-knitted': 'Honors and Knitted Tiles',
    'knitted-straight': 'Knitted Straight',
  };
  return `${names[note.route] ?? note.route} (${unit})`;
}

export function formatDiscardHint(hint, { labelOf = defaultLabel } = {}) {
  if (!hint || hint.kind !== 'discard') throw new TypeError('[hintText] formatDiscardHint needs a discard hint.');
  const tile = labelOf(hint.faceId);
  const details = [];
  const live = (w) => w.reduce((a, x) => a + x.live, 0);
  let headline;

  if (hint.notes.some((n) => n.code === 'riichi-lock')) {
    headline = `You’re in riichi: discard ${tile}, the tile you drew.`;
  } else if (hint.mode === 'fold') {
    headline = `Play safe: discard ${tile}.`;
    details.push('An opponent looks close to winning, and your hand is still far from ready — this is the tile least likely to hand them the win.');
  } else if (hint.waits.length) {
    const winning = hint.waits.filter((w) => w.ron || w.tsumo);
    const shown = winning.length ? winning : hint.waits;
    headline = `Discard ${tile}: you’ll be ready, waiting on ${listOf(shown.map((w) => labelOf(w.faceId)))} (${plural(live(shown), 'tile')} left).`;
  } else if (typeof hint.shanten === 'number') {
    const steps = hint.shanten;
    headline = `Discard ${tile}: you’ll be ${plural(steps, 'tile')} away from ready.`;
    if (hint.usefulCount > 0) {
      const top = hint.useful.slice(0, 4).map((u) => labelOf(u.faceId));
      details.push(`${plural(hint.usefulCount, 'tile')} would help — for example ${listOf(top)}.`);
    }
  } else {
    headline = `Discard ${tile}.`;
  }
  if (hint.mode === 'balance' && typeof hint.danger === 'number' && hint.danger < 0.2 && hint.notes.every((n) => n.code !== 'riichi-lock')) {
    details.push('It’s also a fairly safe tile to let go of while opponents are building up.');
  }

  for (const n of hint.notes) {
    switch (n.code) {
      case 'value-route':
        details.push(`Your hand isn’t worth enough to win yet (${n.ruleset === RULESET_ID.CHINESE_OFFICIAL ? `${n.minimum} points` : `${n.minimum} fan`} needed). The quickest way there: ${describeRoute(n, labelOf)}.`);
        break;
      case 'dead-waits':
        details.push('Careful: none of those tiles would make the hand worth enough to declare — keep building value.');
        break;
      case 'tsumo-only':
        details.push(`${listOf(n.faceIds.map(labelOf))} ${n.faceIds.length === 1 ? 'only counts' : 'only count'} if you draw ${n.faceIds.length === 1 ? 'it' : 'them'} yourself — on a discard the hand would be worth too little.`);
        break;
      case 'furiten':
        details.push(`Furiten: you already discarded ${listOf(n.faceIds.map(labelOf), 'and')}, so you can’t win on anyone’s discard — only by drawing a winning tile yourself.`);
        break;
      case 'no-yaku':
        details.push('Your hand has no yaku yet, so it can’t win on a discard. Declare riichi when you’re offered it — riichi itself is the yaku.');
        break;
      case 'flowers':
        details.push(`Your ${plural(n.count, 'flower')} won’t help here: flowers are added only after the 8-point minimum.`);
        break;
      default:
        break;
    }
  }
  return { headline, details };
}

export function formatActionHint(hint, { labelOf = defaultLabel } = {}) {
  if (!hint || hint.kind !== 'action') throw new TypeError('[hintText] formatActionHint needs an action hint.');
  switch (hint.reason) {
    case 'win':
      return { headline: 'Declare the win — it’s worth enough.', details: [] };
    case 'riichi':
      return { headline: `Declare riichi, discarding ${labelOf(hint.faceId)}.`, details: hint.waits.length ? [`You’ll be waiting on ${listOf(hint.waits.map(labelOf))}. Riichi is a yaku, and the riichi stick comes back with the hand if you win.`] : [] };
    case 'riichi-few-waits':
      return { headline: 'Don’t declare riichi yet.', details: ['Most of the tiles you’d wait on are already visible — once declared you couldn’t change your hand.'] };
    case 'nine-terminals':
      return { headline: 'Call the abortive draw.', details: [`${plural(hint.kinds, 'different terminal or honour', 'different terminals and honours')} — too scattered to build a normal hand; the hand is replayed.`] };
    case 'go-for-orphans':
      return { headline: 'Play on — go for Thirteen Orphans.', details: [`With ${hint.kinds} different terminals and honours already, the yakuman is within reach.`] };
    case 'kong-concealed':
    case 'kong-added':
      return { headline: `Declare the Kong of ${labelOf(hint.faceId)}.`, details: ['It doesn’t slow your hand down, and you draw a replacement tile.'] };
    case 'kong-slows':
      return { headline: 'Pass on the Kong.', details: [`Those ${labelOf(hint.faceId)} are more useful in your hand as they are.`] };
    default:
      return { headline: 'Pass.', details: [] };
  }
}

const DEFAULT_CALL_NAME = { chi: 'Chow', pon: 'Pung', kong: 'Kong' };

/**
 * Task 118: a call on another player's discard, in words. `callName(type)`
 * gives the ruleset's own word (Chi / Pon / Kan in Riichi).
 */
export function formatClaimHint(hint, { labelOf = defaultLabel, callName = (t) => DEFAULT_CALL_NAME[t] ?? t } = {}) {
  if (!hint || hint.kind !== 'claim') throw new TypeError('[hintText] formatClaimHint needs a claim hint.');
  const tile = labelOf(hint.faceId);
  if (hint.reason === 'claim') {
    const what = hint.type === 'chi' && hint.sequence?.length ? `${callName('chi')} ${hint.sequence.map(labelOf).join(' – ')}` : `${callName(hint.type)} on ${tile}`;
    return { headline: `Call ${what}.`, details: ['It brings your hand closer to a winning hand that scores enough.'] };
  }
  return { headline: `Pass on the ${tile}.`, details: [`Calling it wouldn’t bring you closer to a hand that can win — and it would open your hand.`] };
}
