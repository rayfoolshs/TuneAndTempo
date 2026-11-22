/* Persisted settings. One tiny store, no framework. */

const KEY = 'tunetempo.v1';

export const defaults = {
  instrument: 'guitar',
  lowG: false,
  calibration: 440,
  theme: 'auto',
  fingerings: false,
  metronome: {
    bpm: 100,
    signature: '4/4',
    customNum: 4,
    customDen: 4,
    subdivision: 2,
    shuffle: 0,
    sound: 'wood',
    volume: 0.7,
    groove: 'click'
  },
  chords: {
    instrument: 'guitar',
    capo: { guitar: 0, ukulele: 0 },
    key: 'Any'
  },
  lastView: 'tuner'
};

export const clone = (o) => JSON.parse(JSON.stringify(o));

function merge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  for (const key of Object.keys(base)) {
    if (!(key in patch)) continue;
    const b = base[key];
    const p = patch[key];
    if (b && typeof b === 'object' && !Array.isArray(b) && p && typeof p === 'object' && !Array.isArray(p)) {
      base[key] = merge(b, p);
    } else if (typeof b === typeof p) {
      base[key] = p;
    }
  }
  return base;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(defaults);
    return merge(clone(defaults), JSON.parse(raw));
  } catch {
    return clone(defaults);
  }
}

export const state = read();

const listeners = new Set();

export function get() { return state; }

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

export function emit() {
  for (const fn of listeners) {
    try { fn(state); } catch (err) { console.error(err); }
  }
}

export function update(mutator) {
  mutator(state);
  save();
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ── setup export / import ───────────────────────────────── */

const PREFIX = 'TT1:';

export function exportSetup() {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return PREFIX + btoa(bin);
}

export function importSetup(text) {
  const raw = String(text || '').trim().replace(/\s+/g, '');
  if (!raw.startsWith(PREFIX)) throw new Error('That does not look like a Tune + Tempo setup.');
  const bin = atob(raw.slice(PREFIX.length));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  const next = merge(clone(defaults), parsed);
  Object.assign(state, next);
  save();
  emit();
}
