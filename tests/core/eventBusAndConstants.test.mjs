/**
 * eventBusAndConstants.test.mjs — rebuilt Tasks 6–7: EventBus and constants.
 * Run: node tests/core/eventBusAndConstants.test.mjs
 */
import { section, assert, assertThrows, summary } from '../_helpers/harness.mjs';
import { EventBus, gameEventBus } from '../../src/core/EventBus.js';
import * as C from '../../src/utils/constants.js';

section('EventBus basics', () => {
  const bus = new EventBus();
  const got = [];
  const off = bus.on('a', (p) => got.push(p));
  assert(bus.emit('a', 1) === 1 && got[0] === 1, 'emit calls listener with payload, returns count');
  off();
  assert(bus.emit('a', 2) === 0 && got.length === 1, 'unsubscribe stops delivery');
  assert(bus.listenerCount('a') === 0, 'listener removed');
  const order = [];
  bus.on('b', () => order.push(1)); bus.on('b', () => order.push(2));
  bus.emit('b');
  assert(order.join() === '1,2', 'listeners called in subscription order');
});

section('EventBus once / errors / clear', () => {
  const bus = new EventBus();
  let n = 0;
  const off = bus.once('x', () => n++);
  bus.emit('x'); bus.emit('x');
  assert(n === 1, 'once fires a single time');
  off();
  assert(true, 'unsubscribe after firing is safe');
  const origErr = console.error; console.error = () => {};
  let reached = false;
  bus.on('y', () => { throw new Error('boom'); });
  bus.on('y', () => { reached = true; });
  bus.emit('y');
  console.error = origErr;
  assert(reached, 'a throwing listener does not stop the others');
  bus.clear();
  assert(bus.listenerCount('y') === 0, 'clear() removes everything');
  assertThrows(() => bus.on('', () => {}), TypeError, 'empty event name throws');
  assertThrows(() => bus.on('z', 5), TypeError, 'non-function listener throws');
  assert(gameEventBus instanceof EventBus, 'shared gameEventBus exported');
  // main.js boot smoke test shape
  let received = false;
  const unsub = gameEventBus.once('__boot-smoke-test__', () => { received = true; });
  gameEventBus.emit('__boot-smoke-test__'); unsub();
  assert(received, 'main.js verifyEventBus() pattern works');
});

section('Constants used by surviving files', () => {
  assert(C.RULESET_ID.HONG_KONG === 'hong_kong', "RULESET_ID.HONG_KONG = 'hong_kong' (matches saved tests)");
  assert(C.AI_DIFFICULTY.BASIC === 'basic' && C.AI_DIFFICULTY.ADVANCED === 'advanced', 'AI_DIFFICULTY values');
  assert(C.RULESET_LABEL[C.RULESET_ID.HONG_KONG] && C.AI_DIFFICULTY_LABEL.basic === 'Basic', 'label maps');
  assert(C.SEAT_KIND.HUMAN && C.SEAT_KIND.AI && C.SEAT_KIND.HUMAN !== C.SEAT_KIND.AI, 'SEAT_KIND');
  assert(C.TURN_PHASE.AWAITING_DRAW && C.TURN_PHASE.AWAITING_DISCARD, 'TURN_PHASE');
  assert(['kong', 'pass', 'win', 'chi', 'pon', 'discard'].every((v) => Object.values(C.ACTION_TYPE).includes(v)), 'ACTION_TYPE');
  assert(C.WIND_ORDER.length === 4 && C.WIND_ORDER[0] === C.WIND.EAST && C.WIND.EAST.id === 'east', 'WIND objects + order');
  assert(Object.isFrozen(C.WIND.EAST) && Object.isFrozen(C.ACTION_TYPE), 'enums frozen');
  assert(C.WIND_ORDER.find((w) => w.id === 'south') === C.WIND.SOUTH, 'WIND_ORDER.find(id) hydration pattern works');
  assert(C.THEME.DARK === 'dark', 'THEME.DARK');
  assert(C.PLAYER_COUNT.THREE === 3 && C.PLAYER_COUNT.FOUR === 4, 'PLAYER_COUNT');
});

summary();
