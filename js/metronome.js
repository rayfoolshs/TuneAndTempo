/* Metronome: sample-accurate scheduling with a 25 ms lookahead.
   Nothing here uses setInterval for timing — only for waking up. */

import * as audio from './audio.js';
import { get } from './state.js';
import { GROOVES, buildGroove } from './grooves.js';

export const SIGNATURES = [
  { id: '2/4', num: 2, den: 4 },
  { id: '3/4', num: 3, den: 4 },
  { id: '4/4', num: 4, den: 4 },
  { id: '5/4', num: 5, den: 4 },
  { id: '6/8', num: 6, den: 8 },
  { id: '7/8', num: 7, den: 8 },
  { id: '9/8', num: 9, den: 8 },
  { id: '12/8', num: 12, den: 8 },
  { id: 'custom', num: 4, den: 4 }
];

export function signatureOf(state = get()) {
  const m = state.metronome;
  if (m.signature === 'custom') {
    return { id: 'custom', num: m.customNum, den: m.customDen };
  }
  return SIGNATURES.find((s) => s.id === m.signature) || SIGNATURES[2];
}

export function isCompound(sig) {
  return sig.den === 8 && sig.num > 3 && sig.num % 3 === 0;
}

/* BPM is always the quarter-note reference. Compound 6/8, 9/8 and 12/8
   read it as the dotted-quarter pulse, which is how players count them. */
export function barUnitSeconds(bpm, sig) {
  const quarter = 60 / bpm;
  if (sig.den === 2) return quarter * 2;
  if (sig.den === 8) return isCompound(sig) ? quarter / 3 : quarter / 2;
  if (sig.den === 16) return quarter / 4;
  return quarter;
}

export function shuffleAvailable(subdivision) {
  return subdivision === 2 || subdivision === 4;
}

export class Metronome {
  constructor({ onBeat, onStop } = {}) {
    this.onBeat = onBeat || (() => {});
    this.onStop = onStop || (() => {});
    this.running = false;
    this.timer = null;
    this.raf = 0;
    this.queue = [];
    this.beatIndex = 0;
    this.nextBeatTime = 0;
    this.cfg = null;
  }

  configure(state = get()) {
    const m = state.metronome;
    const sig = signatureOf(state);
    const beats = Math.min(16, Math.max(1, Math.round(sig.num)));
    const unit = barUnitSeconds(m.bpm, sig);
    const groove = GROOVES[m.groove] || GROOVES.click;

    this.cfg = {
      bpm: m.bpm,
      beats,
      sig,
      subdivision: m.subdivision,
      shuffle: m.shuffle,
      sound: m.sound,
      volume: m.volume,
      beatSeconds: unit,
      secondaryEvery: isCompound(sig) ? 3 : 0,
      groove: groove.id,
      grooveSpb: groove.spb,
      grooveHits: groove.id === 'click' ? null : buildGroove(groove, beats)
    };
    return this.cfg;
  }

  async start() {
    if (this.running) return;
    this.configure();
    await audio.unlock();
    audio.setMode('metronome');
    this.beatIndex = 0;
    this.queue = [];
    this.nextBeatTime = audio.now() + 0.08;
    this.running = true;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
    this.loopVisuals();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.queue = [];
    audio.setMode('off');
    this.onStop();
  }

  tick() {
    if (!this.running) return;
    const ctx = audio.context();
    let guard = 0;
    while (this.nextBeatTime < ctx.currentTime + 0.14 && guard < 40) {
      guard += 1;
      const cfg = this.cfg;
      const beat = this.beatIndex % cfg.beats;
      this.scheduleBeat(beat, this.nextBeatTime);
      this.nextBeatTime += cfg.beatSeconds;
      this.beatIndex = (this.beatIndex + 1) % cfg.beats;
    }
  }

  scheduleBeat(beatIndex, time) {
    const cfg = this.cfg;

    /* Groove mode: drums only, scheduled one beat at a time so Stop cuts
       off within a beat instead of letting a whole bar ring out. */
    if (cfg.grooveHits) {
      const hits = cfg.grooveHits[beatIndex] || [];
      const slot = cfg.beatSeconds / cfg.grooveSpb;
      for (const h of hits) {
        let when = time + h.o * slot;
        if (h.swing) when += (cfg.shuffle / 100) * (2 / 3) * slot;
        audio.drum(h.v, when, cfg.volume * h.g);
      }
      this.queue.push({ time, beat: beatIndex, sub: 0, accent: beatIndex === 0 });
      return;
    }

    const sub = cfg.subdivision;
    const slot = cfg.beatSeconds / sub;
    const swing = shuffleAvailable(sub)
      ? (cfg.shuffle / 100) * (2 / 3) * slot
      : 0;

    for (let s = 0; s < sub; s++) {
      const when = time + s * slot + (s % 2 === 1 ? swing : 0);
      const accent = s === 0 && (
        beatIndex === 0 ||
        (cfg.secondaryEvery > 0 && beatIndex % cfg.secondaryEvery === 0)
      );
      audio.scheduleClick(when, { accent, sound: cfg.sound, volume: cfg.volume });
      this.queue.push({ time: when, beat: beatIndex, sub: s, accent });
    }
  }

  loopVisuals() {
    const step = () => {
      if (!this.running) return;
      const t = audio.now();
      let fired = null;
      while (this.queue.length && this.queue[0].time <= t) {
        if (this.queue[0].time < t - 0.25) this.queue.shift();
        else { fired = this.queue.shift(); }
      }
      if (fired) this.onBeat(fired);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}

export const SUBDIVISION_LABELS = {
  1: 'Quarters',
  2: 'Eighths',
  3: 'Triplets',
  4: 'Sixteenths'
};
