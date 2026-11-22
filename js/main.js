import * as audio from './audio.js';
import { get, update, subscribe, exportSetup, importSetup } from './state.js';
import { mountTuner } from './tuner.js';
import { mountChords } from './chords.js';
import {
  Metronome, SIGNATURES, signatureOf, isCompound,
  shuffleAvailable, SUBDIVISION_LABELS
} from './metronome.js';
import { GROOVES } from './grooves.js';

/* ── theme ───────────────────────────────────────────────── */

const lightQuery = window.matchMedia('(prefers-color-scheme: light)');

function effectiveTheme() {
  const t = get().theme;
  if (t === 'auto') return lightQuery.matches ? 'light' : 'dark';
  return t;
}

function applyTheme() {
  const theme = effectiveTheme();
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f5f7' : '#0b0d10');
  const chips = document.getElementById('themeChips');
  if (chips) {
    for (const b of chips.querySelectorAll('[data-theme]')) {
      b.setAttribute('aria-pressed', String(b.dataset.theme === get().theme));
    }
  }
}

lightQuery.addEventListener('change', applyTheme);

/* ── elements ────────────────────────────────────────────── */

const views = [...document.querySelectorAll('.view')];
const tabs = [...document.querySelectorAll('.tab')];
const main = document.getElementById('main');
const tempoCard = document.getElementById('tempoCard');
const tempoValue = document.getElementById('tempoValue');
const bpmSlider = document.getElementById('bpmSlider');
const sigBadge = document.getElementById('sigBadge');
const sigOut = document.getElementById('sigOut');
const beatDots = document.getElementById('beatDots');
const sigChips = document.getElementById('sigChips');
const customSig = document.getElementById('customSig');
const customNum = document.getElementById('customNum');
const denChips = document.getElementById('denChips');
const subChips = document.getElementById('subChips');
const subOut = document.getElementById('subOut');
const grooveChips = document.getElementById('grooveChips');
const grooveOut = document.getElementById('grooveOut');
const grooveHint = document.getElementById('grooveHint');
const shuffleSlider = document.getElementById('shuffleSlider');
const shuffleOut = document.getElementById('shuffleOut');
const shuffleHint = document.getElementById('shuffleHint');
const clickSound = document.getElementById('clickSound');
const volumeSlider = document.getElementById('volumeSlider');
const playBtn = document.getElementById('playBtn');
const tapBtn = document.getElementById('tapBtn');
const settingsSheet = document.getElementById('settingsSheet');
const offlineStatus = document.getElementById('offlineStatus');
const exportBox = document.getElementById('exportBox');
const exportMsg = document.getElementById('exportMsg');

let currentView = 'tuner';
let lastSigKey = '';
let tapTimes = [];

/* ── metronome ───────────────────────────────────────────── */

function clearDots() {
  for (const d of beatDots.children) d.classList.remove('on');
}

const metro = new Metronome({
  onBeat(ev) {
    const dots = beatDots.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('on', i === ev.beat);
    }
    if (ev.sub === 0) {
      tempoCard.classList.add('pulse');
      clearTimeout(onBeatPulse);
      onBeatPulse = setTimeout(() => tempoCard.classList.remove('pulse'), 130);
    }
  },
  onStop() {
    clearDots();
    tempoCard.classList.remove('pulse');
    playBtn.classList.remove('running');
    playBtn.querySelector('span').textContent = 'Start';
  }
});

let onBeatPulse = 0;

function buildDots() {
  const sig = signatureOf(get());
  const key = `${sig.num}/${sig.den}`;
  if (key === lastSigKey) return;
  lastSigKey = key;

  const count = Math.min(16, Math.max(1, sig.num));
  const compound = isCompound(sig);
  beatDots.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot' + (i === 0 || (compound && i % 3 === 0) ? ' accent' : '');
    beatDots.append(dot);
  }
}

function refreshTempo() {
  const s = get();
  const m = s.metronome;
  const sig = signatureOf(s);

  tempoValue.innerHTML = `${m.bpm}<span class="bpm">BPM</span>`;
  if (bpmSlider.value !== String(m.bpm)) bpmSlider.value = String(m.bpm);

  sigBadge.textContent = `${sig.num}/${sig.den}`;
  sigOut.textContent = `${sig.num}/${sig.den}`;

  for (const b of sigChips.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.sig === m.signature));
  }
  customSig.hidden = m.signature !== 'custom';
  customNum.textContent = String(m.customNum);
  for (const b of denChips.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.den) === m.customDen));
  }

  const groove = GROOVES[m.groove] || GROOVES.click;
  const grooveOn = groove.id !== 'click';

  for (const b of grooveChips.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.groove === groove.id));
  }
  grooveOut.textContent = groove.label;
  grooveHint.textContent = groove.hint;

  for (const b of subChips.querySelectorAll('button')) {
    b.disabled = grooveOn;
    b.setAttribute('aria-pressed', String(Number(b.dataset.sub) === m.subdivision));
  }
  subOut.textContent = grooveOn ? 'from groove' : (SUBDIVISION_LABELS[m.subdivision] || String(m.subdivision));
  clickSound.disabled = grooveOn;

  shuffleSlider.value = String(m.shuffle);
  shuffleOut.textContent = `${m.shuffle}%`;
  const canShuffle = grooveOn ? groove.swingable !== false : shuffleAvailable(m.subdivision);
  shuffleSlider.disabled = !canShuffle;
  if (!canShuffle) {
    shuffleHint.textContent = grooveOn
      ? 'This groove is already swung — the slider only shapes straight grooves.'
      : 'Shuffle needs eighths or sixteenths — triplets are already swung.';
  } else if (m.shuffle === 0) {
    shuffleHint.textContent = grooveOn
      ? 'Straight — the groove plays exactly as written.'
      : 'Straight. Every subdivision lands evenly.';
  } else if (m.shuffle < 20) {
    shuffleHint.textContent = 'A light lilt on every second subdivision.';
  } else if (m.shuffle < 45) {
    shuffleHint.textContent = 'Around 33% is classic triplet swing.';
  } else if (m.shuffle < 70) {
    shuffleHint.textContent = 'Dotted feel — the second note sits late in the pair.';
  } else {
    shuffleHint.textContent = 'Hard shuffle. The second subdivision is nearly a full slot late.';
  }

  if (clickSound.value !== m.sound) clickSound.value = m.sound;
  if (volumeSlider.value !== String(Math.round(m.volume * 100))) {
    volumeSlider.value = String(Math.round(m.volume * 100));
  }

  buildDots();
  metro.configure(s);
}

/* signature chips */
for (const sig of SIGNATURES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.sig = sig.id;
  b.textContent = sig.id === 'custom' ? 'Custom' : sig.id;
  sigChips.append(b);
}

sigChips.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-sig]');
  if (!b) return;
  update((s) => { s.metronome.signature = b.dataset.sig; });
});

denChips.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-den]');
  if (!b) return;
  update((s) => { s.metronome.customDen = Number(b.dataset.den); });
});

document.querySelectorAll('[data-custom]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const [field, raw] = btn.dataset.custom.split(':');
    const delta = Number(raw);
    update((s) => {
      if (field === 'num') {
        s.metronome.customNum = Math.min(16, Math.max(1, s.metronome.customNum + delta));
      }
    });
  });
});

subChips.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-sub]');
  if (!b) return;
  update((s) => { s.metronome.subdivision = Number(b.dataset.sub); });
});

grooveChips.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-groove]');
  if (!b) return;
  update((s) => { s.metronome.groove = b.dataset.groove; });
});

bpmSlider.addEventListener('input', () => {
  update((s) => { s.metronome.bpm = Number(bpmSlider.value); });
});

document.querySelectorAll('[data-bpm]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const delta = Number(btn.dataset.bpm);
    update((s) => { s.metronome.bpm = Math.min(250, Math.max(30, s.metronome.bpm + delta)); });
  });
});

shuffleSlider.addEventListener('input', () => {
  update((s) => { s.metronome.shuffle = Number(shuffleSlider.value); });
});

clickSound.addEventListener('change', () => {
  update((s) => { s.metronome.sound = clickSound.value; });
});

volumeSlider.addEventListener('input', () => {
  update((s) => { s.metronome.volume = Number(volumeSlider.value) / 100; });
});

function tapTempo() {
  const now = performance.now();
  tapTimes = tapTimes.filter((t) => now - t < 2400);
  tapTimes.push(now);
  if (tapTimes.length >= 2) {
    const gaps = [];
    for (let i = 1; i < tapTimes.length; i++) gaps.push(tapTimes[i] - tapTimes[i - 1]);
    const recent = gaps.slice(-4);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (avg > 120) {
      const bpm = Math.max(30, Math.min(250, Math.round(60000 / avg)));
      update((s) => { s.metronome.bpm = bpm; });
      tapBtn.textContent = `${bpm}`;
      setTimeout(() => { tapBtn.textContent = 'Tap'; }, 900);
    }
  }
}

tapBtn.addEventListener('click', tapTempo);
tempoValue.addEventListener('click', tapTempo);

playBtn.addEventListener('click', async () => {
  if (metro.running) {
    metro.stop();
    return;
  }
  tuner.stop();
  await metro.start();
  playBtn.classList.add('running');
  playBtn.querySelector('span').textContent = 'Stop';
});

/* ── tuner + chords ──────────────────────────────────────── */

const tuner = mountTuner({
  beforeStart() { if (metro.running) metro.stop(); }
});

const chords = mountChords({
  beforeAudio() {
    if (metro.running) metro.stop();
    if (tuner.running) tuner.stop();
  }
});

/* ── routing ─────────────────────────────────────────────── */

function show(view) {
  currentView = view;
  for (const v of views) v.classList.toggle('active', v.id === `view-${view}`);
  for (const t of tabs) {
    t.setAttribute('aria-current', t.dataset.view === view ? 'page' : 'false');
  }
  main.scrollTop = 0;

  if (view !== 'metronome' && metro.running) metro.stop();
  if (view !== 'tuner' && tuner.running) tuner.stop();
  if (view !== 'chords') chords.closeSheet();
  if (view === 'chords') chords.render();

  update((s) => { s.lastView = view; });
}

for (const t of tabs) {
  t.addEventListener('click', () => show(t.dataset.view));
}

/* ── settings ────────────────────────────────────────────── */

function openSettings() {
  settingsSheet.hidden = false;
  document.body.classList.add('sheet-open');
  exportBox.value = '';
  exportMsg.textContent = '';
  refreshOffline();
}

function closeSheet(el) {
  el.hidden = true;
  if (!document.querySelector('.sheet-backdrop:not([hidden])')) {
    document.body.classList.remove('sheet-open');
  }
}

document.getElementById('settingsBtn').addEventListener('click', openSettings);

document.querySelectorAll('[data-close-sheet]').forEach((btn) => {
  btn.addEventListener('click', () => closeSheet(btn.closest('.sheet-backdrop')));
});

for (const sheet of document.querySelectorAll('.sheet-backdrop')) {
  sheet.addEventListener('click', (ev) => {
    if (ev.target === sheet) closeSheet(sheet);
  });
}

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  for (const sheet of document.querySelectorAll('.sheet-backdrop:not([hidden])')) closeSheet(sheet);
});

document.getElementById('themeChips').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-theme]');
  if (!b) return;
  update((s) => { s.theme = b.dataset.theme; });
});

document.getElementById('fingerings').addEventListener('change', (ev) => {
  update((s) => { s.fingerings = ev.target.checked; });
});

document.getElementById('copyBtn').addEventListener('click', async () => {
  const text = exportSetup();
  exportBox.value = text;
  try {
    await navigator.clipboard.writeText(text);
    exportMsg.textContent = 'Setup copied to the clipboard.';
  } catch {
    exportBox.focus();
    exportBox.select();
    exportMsg.textContent = 'Select the text above and copy it manually.';
  }
});

document.getElementById('importBtn').addEventListener('click', () => {
  try {
    importSetup(exportBox.value);
    exportMsg.textContent = 'Setup restored.';
    refreshAll();
    applyTheme();
  } catch (err) {
    exportMsg.textContent = err.message || 'That setup could not be read.';
  }
});

async function refreshOffline() {
  if (!('serviceWorker' in navigator)) {
    offlineStatus.textContent = 'This browser has no offline caching support.';
    return;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const keys = await caches.keys();
    const cached = keys.some((k) => k.startsWith('tune-tempo'));
    if (!reg) {
      offlineStatus.textContent = 'Not registered yet. Reload once while online.';
    } else if (cached) {
      offlineStatus.textContent = 'Ready offline — every file is stored on this device.';
    } else {
      offlineStatus.textContent = 'Registered, cache still warming up. Reload once online.';
    }
  } catch {
    offlineStatus.textContent = 'Could not read the cache status.';
  }
}

/* ── one refresh pass ────────────────────────────────────── */

function refreshAll() {
  tuner.refresh();
  refreshTempo();
  if (currentView === 'chords') chords.render();
  document.getElementById('fingerings').checked = get().fingerings;
  applyTheme();
}

subscribe(refreshAll);

/* ── boot ────────────────────────────────────────────────── */

applyTheme();
refreshTempo();
refreshAll();
show(get().lastView || 'tuner');

/* Stop continuous audio when the app goes to the background. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (metro.running) metro.stop();
    if (tuner.running) tuner.stop();
  }
});

/* The first touch anywhere warms the audio context. */
const warm = () => {
  audio.unlock().catch(() => {});
  document.removeEventListener('pointerdown', warm);
};
document.addEventListener('pointerdown', warm, { once: true });

/* ── service worker ──────────────────────────────────────── */

/* Add ?nosw=1 while editing files so the cache never hides a change. */
const skipWorker = new URLSearchParams(location.search).has('nosw');

if ('serviceWorker' in navigator && !skipWorker) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* Served from file:// — no worker, everything else still works. */
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    refreshOffline();
  });
}
