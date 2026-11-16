/**
 * PacingController.js
 *
 * Configurable async turn-timing hooks for AI play (Task 40). Named pacing
 * "moments" map to delays in ms; the default profile is INSTANT (every delay
 * 0) so headless tests and simulations never wait. A UI can switch to the
 * watchable profile and scale it with a speed multiplier.
 *
 * REBUILT (after Task 77) from the project plan.
 */

export const PACING_MOMENT = Object.freeze({
  BEFORE_DISCARD: 'beforeDiscard',
  BEFORE_CLAIM: 'beforeClaim',
  BEFORE_WIN: 'beforeWin',
});

export const INSTANT_PACING_PROFILE = Object.freeze({
  [PACING_MOMENT.BEFORE_DISCARD]: 0,
  [PACING_MOMENT.BEFORE_CLAIM]: 0,
  [PACING_MOMENT.BEFORE_WIN]: 0,
});

export const DEFAULT_WATCHABLE_PACING_PROFILE = Object.freeze({
  [PACING_MOMENT.BEFORE_DISCARD]: 450,
  [PACING_MOMENT.BEFORE_CLAIM]: 300,
  [PACING_MOMENT.BEFORE_WIN]: 600,
});

export class PacingController {
  /**
   * @param {Object} [options]
   * @param {Object} [options.profile=INSTANT_PACING_PROFILE]
   * @param {number} [options.speed=1]  >1 faster, <1 slower
   * @param {function(number): Promise<void>} [options.sleep]  injectable timer
   */
  constructor({ profile = INSTANT_PACING_PROFILE, speed = 1, sleep } = {}) {
    this.setProfile(profile);
    this.setSpeed(speed);
    this._sleep = typeof sleep === 'function' ? sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  }

  setProfile(profile) {
    if (!profile || typeof profile !== 'object') throw new TypeError('[PacingController] profile must be an object.');
    for (const m of Object.values(PACING_MOMENT)) {
      const v = profile[m];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new TypeError(`[PacingController] profile.${m} must be a non-negative number.`);
    }
    this._profile = { ...profile };
  }

  getProfile() { return { ...this._profile }; }

  setSpeed(speed) {
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) throw new TypeError('[PacingController] speed must be a positive number.');
    this._speed = speed;
  }

  getSpeed() { return this._speed; }

  /** Delay in ms for a moment after the speed multiplier. */
  delayFor(moment) {
    if (!(Object.values(PACING_MOMENT).includes(moment))) throw new TypeError(`[PacingController] unknown moment: ${moment}`);
    return Math.round(this._profile[moment] / this._speed);
  }

  /** Waits for a moment's delay (resolves immediately at 0). */
  async wait(moment) {
    const ms = this.delayFor(moment);
    if (ms > 0) await this._sleep(ms);
  }
}
