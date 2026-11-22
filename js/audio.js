/* One AudioContext for the whole app.
   iOS only allows it to start inside a user gesture, so every entry
   point awaits unlock() first. Exactly one mode runs at a time. */

let ctx = null;
let master = null;
let mode = 'off'; // 'off' | 'tuner' | 'metronome'

export function context() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio is not available on this device.');
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
  }
  return ctx;
}

function masterGain() {
  context();
  return master;
}

export async function unlock() {
  const c = context();
  if (c.state !== 'running') {
    try { await c.resume(); } catch { /* the next gesture will retry */ }
  }
  return c;
}

export function getMode() { return mode; }
export function setMode(next) {
  mode = next;
}

export function now() { return context().currentTime; }

/* ── metronome click ─────────────────────────────────────── */

const CLICKS = {
  wood: { type: 'triangle', base: 900, accent: 1240, dur: 0.052 },
  rim: { type: 'square', base: 1900, accent: 2500, dur: 0.042 },
  beep: { type: 'sine', base: 1000, accent: 1500, dur: 0.075 }
};

export function scheduleClick(when, { accent = false, sound = 'wood', volume = 0.7 } = {}) {
  const c = context();
  const preset = CLICKS[sound] || CLICKS.wood;
  const osc = c.createOscillator();
  const gain = c.createGain();

  const peak = Math.max(0.0002, volume * (accent ? 0.85 : 0.45));
  const dur = preset.dur;

  osc.type = preset.type;
  osc.frequency.setValueAtTime(accent ? preset.accent : preset.base, when);

  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + 0.0015);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);

  osc.connect(gain);
  gain.connect(masterGain());
  osc.start(when);
  osc.stop(when + dur + 0.02);
  osc.onended = () => { try { gain.disconnect(); } catch { /* gone */ } };
}

/* ── sustained reference tone ────────────────────────────── */

let toneNodes = [];

export function stopTones() {
  for (const node of toneNodes) {
    try { node.stop(); } catch { /* already stopped */ }
  }
  toneNodes = [];
}

export function playTone(freq, { duration = 1.6, gain: level = 0.24, type = 'sine' } = {}) {
  const c = context();
  const t0 = c.currentTime + 0.02;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(level, t0 + 0.03);
  gain.gain.setValueAtTime(level, t0 + Math.max(0.05, duration - 0.16));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(gain);
  gain.connect(masterGain());
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
  osc.onended = () => {
    toneNodes = toneNodes.filter((n) => n !== osc);
    try { gain.disconnect(); } catch { /* gone */ }
  };
  toneNodes.push(osc);
  return osc;
}

/* ── plucked string for chord playback ───────────────────── */

export function pluck(freq, when, { gain: level = 0.16, duration = 1.7 } = {}) {
  const c = context();
  const osc = c.createOscillator();
  const osc2 = c.createOscillator();
  const filter = c.createBiquadFilter();
  const gain = c.createGain();
  const t0 = Math.max(when, c.currentTime + 0.005);

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t0);
  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(freq * 2.002, t0);
  osc2.detune.setValueAtTime(4, t0);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.min(6000, freq * 9), t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(340, freq * 2.2), t0 + 0.5);
  filter.Q.value = 0.9;

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(level, t0 + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  const sub = c.createGain();
  sub.gain.value = 0.35;
  osc2.connect(sub);
  sub.connect(filter);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain());

  osc.start(t0);
  osc2.start(t0);
  osc.stop(t0 + duration + 0.03);
  osc2.stop(t0 + duration + 0.03);
  osc.onended = () => {
    try { gain.disconnect(); filter.disconnect(); sub.disconnect(); } catch { /* gone */ }
  };
}

export function strum(freqs, { spacing = 0.032, gain: level = 0.15, duration = 1.8 } = {}) {
  const t0 = context().currentTime + 0.02;
  freqs.forEach((f, i) => pluck(f, t0 + i * spacing, { gain: level, duration }));
}

/* ── drum voices for the grooves ─────────────────────────── */

let noiseCache = null;

function noiseBuffer(c) {
  if (noiseCache && noiseCache.sampleRate === c.sampleRate) return noiseCache;
  const length = Math.floor(c.sampleRate * 0.6);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseCache = buffer;
  return buffer;
}

function noiseBurst(c, when, dur) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.start(when);
  src.stop(when + dur + 0.03);
  return src;
}

function env(c, when, peak, attack, decay) {
  const g = c.createGain();
  const level = Math.max(0.0002, peak);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(level, when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  return g;
}

export function drum(voice, when, volume = 0.7) {
  const c = context();
  const t = Math.max(when, c.currentTime + 0.001);
  const v = Math.max(0.0001, volume);
  const out = masterGain();

  if (voice === 'kick') {
    const osc = c.createOscillator();
    const g = env(c, t, 0.95 * v, 0.005, 0.3);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.1);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + 0.37);
    osc.onended = () => { try { g.disconnect(); } catch { /* gone */ } };

    const n = noiseBurst(c, t, 0.03);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const ng = env(c, t, 0.2 * v, 0.001, 0.018);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(out);
    n.onended = () => { try { ng.disconnect(); hp.disconnect(); } catch { /* gone */ } };
    return;
  }

  if (voice === 'snare') {
    const n = noiseBurst(c, t, 0.22);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2300;
    bp.Q.value = 0.8;
    const ng = env(c, t, 0.5 * v, 0.003, 0.14);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    n.onended = () => { try { ng.disconnect(); bp.disconnect(); } catch { /* gone */ } };

    const osc = c.createOscillator();
    const og = env(c, t, 0.28 * v, 0.002, 0.08);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    osc.connect(og);
    og.connect(out);
    osc.start(t);
    osc.stop(t + 0.13);
    osc.onended = () => { try { og.disconnect(); } catch { /* gone */ } };
    return;
  }

  if (voice === 'hat' || voice === 'openhat') {
    const open = voice === 'openhat';
    const n = noiseBurst(c, t, open ? 0.26 : 0.08);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6800;
    const g = env(c, t, 0.3 * v, 0.001, open ? 0.22 : 0.04);
    n.connect(hp);
    hp.connect(g);
    g.connect(out);
    n.onended = () => { try { g.disconnect(); hp.disconnect(); } catch { /* gone */ } };
    return;
  }

  if (voice === 'ride') {
    const n = noiseBurst(c, t, 0.4);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5200;
    bp.Q.value = 1.2;
    const g = env(c, t, 0.2 * v, 0.002, 0.3);
    n.connect(bp);
    bp.connect(g);
    g.connect(out);
    n.onended = () => { try { g.disconnect(); bp.disconnect(); } catch { /* gone */ } };

    const osc = c.createOscillator();
    const og = env(c, t, 0.06 * v, 0.001, 0.09);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2480, t);
    osc.connect(og);
    og.connect(out);
    osc.start(t);
    osc.stop(t + 0.14);
    osc.onended = () => { try { og.disconnect(); } catch { /* gone */ } };
    return;
  }

  if (voice === 'rim') {
    const osc = c.createOscillator();
    const g = env(c, t, 0.34 * v, 0.001, 0.026);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1720, t);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + 0.05);
    osc.onended = () => { try { g.disconnect(); } catch { /* gone */ } };

    const n = noiseBurst(c, t, 0.03);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 2;
    const ng = env(c, t, 0.16 * v, 0.001, 0.02);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    n.onended = () => { try { ng.disconnect(); bp.disconnect(); } catch { /* gone */ } };
    return;
  }

  if (voice === 'shaker') {
    const n = noiseBurst(c, t, 0.09);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 6800;
    bp.Q.value = 2.5;
    const g = env(c, t, 0.18 * v, 0.006, 0.05);
    n.connect(bp);
    bp.connect(g);
    g.connect(out);
    n.onended = () => { try { g.disconnect(); bp.disconnect(); } catch { /* gone */ } };
  }
}
