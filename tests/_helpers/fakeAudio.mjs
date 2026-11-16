/**
 * fakeAudio.mjs — Tasks 108–110: a recording stand-in for the Web Audio API.
 * Nodes remember their connections, params their scheduled events, sources
 * their start / stop times. Like the real API, exponential ramps to 0 and
 * stop-before-start throw, so a recipe that would fail in a browser fails here.
 *
 *   const { FakeAudioContext, contexts } = makeFakeAudio({ startState: 'suspended' });
 *   new AudioManager({ AudioContextClass: FakeAudioContext });
 */

class FakeParam {
  constructor(owner, name, value) { this.owner = owner; this.name = name; this.value = value; this.events = []; }
  setValueAtTime(v, t) { this._check(v, t); this.events.push({ kind: 'set', v, t }); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this._check(v, t); this.events.push({ kind: 'linear', v, t }); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) {
    this._check(v, t);
    if (v === 0) throw new RangeError('exponentialRampToValueAtTime: value must not be 0');
    this.events.push({ kind: 'exp', v, t }); this.value = v; return this;
  }
  setTargetAtTime(v, t, c) { this._check(v, t); this.events.push({ kind: 'target', v, t, c }); this.value = v; return this; }
  cancelScheduledValues(t) { this.events.push({ kind: 'cancel', t }); return this; }
  _check(v, t) { if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError(`${this.name}: non-finite value/time (${v}, ${t})`); }
}

class FakeNode {
  constructor(ctx, kind) { this.context = ctx; this.kind = kind; this.outputs = []; this.disconnected = false; ctx.nodes.push(this); }
  connect(dest) { this.outputs.push(dest); return dest; }
  disconnect() { this.outputs = []; this.disconnected = true; }
}

class FakeSource extends FakeNode {
  constructor(ctx, kind) { super(ctx, kind); this.startedAt = null; this.stoppedAt = null; this.onended = null; }
  start(t = 0) { if (this.startedAt !== null) throw new Error('start twice'); this.startedAt = t; }
  stop(t = 0) {
    if (this.startedAt === null) throw new Error('stop before start');
    if (t < this.startedAt) throw new RangeError('stop before its start time');
    this.stoppedAt = t;
  }
}

export function makeFakeAudio({ startState = 'suspended', sampleRate = 8000, failConstruct = false } = {}) {
  const contexts = [];
  class FakeAudioContext {
    constructor() {
      if (failConstruct) throw new Error('no audio device');
      this.state = startState;
      this.currentTime = 0;
      this.sampleRate = sampleRate;
      this.nodes = [];
      this.destination = new FakeNode(this, 'destination');
      this.resumeCalls = 0;
      this.closed = false;
      contexts.push(this);
    }
    resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; this.closed = true; return Promise.resolve(); }
    createGain() { const n = new FakeNode(this, 'gain'); n.gain = new FakeParam(n, 'gain', 1); return n; }
    createStereoPanner() { const n = new FakeNode(this, 'panner'); n.pan = new FakeParam(n, 'pan', 0); return n; }
    createBiquadFilter() { const n = new FakeNode(this, 'filter'); n.type = 'lowpass'; n.frequency = new FakeParam(n, 'frequency', 350); n.Q = new FakeParam(n, 'Q', 1); return n; }
    createOscillator() { const n = new FakeSource(this, 'osc'); n.type = 'sine'; n.frequency = new FakeParam(n, 'frequency', 440); n.detune = new FakeParam(n, 'detune', 0); return n; }
    createBufferSource() { const n = new FakeSource(this, 'buffer'); n.buffer = null; n.playbackRate = new FakeParam(n, 'playbackRate', 1); return n; }
    createBuffer(channels, length, rate) { const data = new Float32Array(length); return { numberOfChannels: channels, length, sampleRate: rate, getChannelData: () => data }; }
    createDelay() { const n = new FakeNode(this, 'delay'); n.delayTime = new FakeParam(n, 'delayTime', 0); return n; }
    createDynamicsCompressor() { const n = new FakeNode(this, 'compressor'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new FakeParam(n, k, 0); return n; }
    /** Test helper: the sources (oscillators + buffer sources) created so far. */
    sources() { return this.nodes.filter((n) => n instanceof FakeSource); }
  }
  return { FakeAudioContext, contexts };
}

/** True when `from` reaches `to` through connections. */
export function reaches(from, to, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return from.outputs.some((o) => reaches(o, to, seen));
}
