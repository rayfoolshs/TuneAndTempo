import {
  CHORDS, TUNINGS, KEY_NAMES, transposeRoot, soundingName,
  rootPitchClass, chordNotes, chordFrequency
} from './chord-data.js';
import { noteName } from './tuner-data.js';
import * as audio from './audio.js';
import { get, update } from './state.js';

/* ── fretboard diagram ───────────────────────────────────── */

export function chordSVG(entry, {
  instrument = 'guitar',
  capo = 0,
  showFingers = false,
  highlightRoot = true,
  frets = entry.frets,
  label = entry.name
} = {}) {
  const n = frets.length;
  const GX = 15, GY = 19, PL = 14, PR = 9, PT = 24, PB = 12;
  const w = PL + (n - 1) * GX + PR;
  const h = PT + 5 * GY + PB;
  const xOf = (i) => PL + i * GX;
  const lineY = (k) => PT + k * GY;
  const tuning = TUNINGS[instrument];

  const fretted = frets.map((f, i) => ({ i, f })).filter((p) => p.f > 0);
  const maxF = fretted.reduce((m, p) => Math.max(m, p.f), 0);
  const minF = fretted.reduce((m, p) => Math.min(m, p.f), 99);
  const baseFret = maxF <= 5 ? 1 : Math.min(minF, Math.max(1, maxF - 4));

  let out = `<svg class="fb" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label} chord diagram">`;

  for (let i = 0; i < n; i++) {
    out += `<line class="fb-line" x1="${xOf(i)}" y1="${lineY(0)}" x2="${xOf(i)}" y2="${lineY(5)}"/>`;
  }
  for (let k = 1; k < 5; k++) {
    out += `<line class="fb-line" x1="${xOf(0)}" y1="${lineY(k)}" x2="${xOf(n - 1)}" y2="${lineY(k)}"/>`;
  }

  if (baseFret === 1) {
    out += `<line class="fb-nut" x1="${xOf(0)}" y1="${lineY(0)}" x2="${xOf(n - 1)}" y2="${lineY(0)}"/>`;
  } else {
    out += `<line class="fb-line" x1="${xOf(0)}" y1="${lineY(0)}" x2="${xOf(n - 1)}" y2="${lineY(0)}"/>`;
    out += `<text class="fb-fretnum" x="${xOf(0) - 5}" y="${lineY(0) + GY * 0.5 + 3}" text-anchor="end">${baseFret}</text>`;
  }

  /* open / muted markers */
  for (let i = 0; i < n; i++) {
    const f = frets[i];
    const x = xOf(i);
    if (f < 0) {
      out += `<path class="fb-mute" d="M${x - 3.3} ${lineY(0) - 12} l6.6 6.6 M${x + 3.3} ${lineY(0) - 12} l-6.6 6.6"/>`;
    } else if (f === 0) {
      out += `<circle class="fb-open" cx="${x}" cy="${lineY(0) - 8.6}" r="3.3"/>`;
    }
  }

  /* Barre detection: the lowest fret has to cover a span of at least four
     strings and the chord has to keep notes above it. That catches F, Bb,
     Bm, Gm and C#m, and leaves A, D and Esus4 as separate fingers. */
  const groups = new Map();
  for (const p of fretted) {
    if (!groups.has(p.f)) groups.set(p.f, []);
    groups.get(p.f).push(p.i);
  }
  let barre = null;
  const firstGroup = groups.get(minF);
  if (firstGroup && firstGroup.length >= 2) {
    const lo = Math.min(...firstGroup);
    const hi = Math.max(...firstGroup);
    const hasHigher = fretted.some((p) => p.f > minF);
    /* A barre cannot pass over an open string. */
    const solid = frets.slice(lo, hi + 1).every((f) => f > 0);
    if (hi - lo >= 3 && hasHigher && solid) barre = { fret: minF, lo, hi };
  }

  /* finger assignment (hint only) */
  const order = [...fretted].sort((a, b) => a.f - b.f || a.i - b.i);
  const fingers = new Map();
  let nextFinger = barre ? 2 : 1;
  for (const p of order) {
    if (barre && p.f === barre.fret) { fingers.set(p.i, 1); continue; }
    fingers.set(p.i, nextFinger);
    if (nextFinger < 4) nextFinger += 1;
  }

  const rootPc = highlightRoot ? rootPitchClass(entry, capo) : null;

  for (const p of fretted) {
    const r = p.f - baseFret;
    if (r < 0 || r > 4) continue;
    if (barre && p.f === barre.fret) continue;
    const cy = PT + (r + 0.5) * GY;
    const isRoot = rootPc != null && tuning
      ? ((tuning[p.i] + capo + p.f) % 12 + 12) % 12 === rootPc
      : false;
    out += `<circle class="fb-dot${isRoot ? ' accent' : ''}" cx="${xOf(p.i)}" cy="${cy}" r="5.4"/>`;
    if (showFingers) {
      out += `<text class="fb-finger" x="${xOf(p.i)}" y="${cy}">${fingers.get(p.i)}</text>`;
    }
  }

  if (barre) {
    const r = barre.fret - baseFret;
    if (r >= 0 && r <= 4) {
      const cy = PT + (r + 0.5) * GY;
      const x1 = xOf(barre.lo) - 5.4;
      const x2 = xOf(barre.hi) + 5.4;
      out += `<rect class="fb-barre" x="${x1}" y="${cy - 5.4}" width="${x2 - x1}" height="10.8" rx="5.4"/>`;
      if (showFingers) {
        out += `<text class="fb-finger" x="${xOf(barre.lo)}" y="${cy}">1</text>`;
      }
    }
  }

  return out + '</svg>';
}

/* ── the Chords screen ───────────────────────────────────── */

export function mountChords({ beforeAudio } = {}) {
  const seg = document.getElementById('chordInstrumentSegment');
  const capoOut = document.getElementById('capoOut');
  const keySelect = document.getElementById('keySelect');
  const search = document.getElementById('chordSearch');
  const grid = document.getElementById('chordGrid');
  const empty = document.getElementById('chordEmpty');
  const hint = document.getElementById('capoHint');
  const sheet = document.getElementById('chordSheet');
  const sheetBody = document.getElementById('chordSheetBody');
  const sheetTitle = document.getElementById('chordSheetTitle');

  let query = '';

  keySelect.innerHTML = '';
  for (const name of ['Any', ...KEY_NAMES]) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    keySelect.append(opt);
  }

  function inst() { return get().chords.instrument; }
  function capo() { return get().chords.capo[inst()] || 0; }

  function entries() {
    const instrument = inst();
    const shift = capo();
    const key = get().chords.key;
    const q = query.trim().toLowerCase();
    return CHORDS[instrument]
      .map((entry) => ({ entry, sound: soundingName(entry, shift) }))
      .filter(({ entry, sound }) => {
        if (key !== 'Any' && transposeRoot(entry.root, shift) !== key) return false;
        if (!q) return true;
        return entry.name.toLowerCase().includes(q)
          || sound.toLowerCase().includes(q)
          || entry.root.toLowerCase().includes(q);
      });
  }

  function render() {
    const instrument = inst();
    const shift = capo();

    for (const btn of seg.querySelectorAll('[data-chord-instrument]')) {
      btn.setAttribute('aria-selected', String(btn.dataset.chordInstrument === instrument));
    }
    capoOut.textContent = shift === 0 ? 'None' : String(shift);
    keySelect.value = get().chords.key;
    hint.textContent = shift === 0
      ? 'No capo — shapes sound as written.'
      : `Capo ${shift} — shapes sound ${shift} semitone${shift === 1 ? '' : 's'} higher.`;

    const list = entries();
    grid.innerHTML = '';
    empty.hidden = list.length > 0;

    const frag = document.createDocumentFragment();
    for (const { entry, sound } of list) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'chord-card';
      card.setAttribute('aria-label', `${sound}, ${entry.name} shape`);
      card.innerHTML = `
        <span class="cc-name">${shift ? sound : entry.name}</span>
        <span class="cc-sub">${shift ? `${entry.name} shape` : '&nbsp;'}</span>
        ${chordSVG(entry, { instrument, capo: shift, showFingers: get().fingerings, label: sound })}`;
      card.addEventListener('click', () => openSheet(entry));
      frag.append(card);
    }
    grid.append(frag);
  }

  function openSheet(entry) {
    const instrument = inst();
    const shift = capo();
    const sound = soundingName(entry, shift);
    const notes = chordNotes(entry, instrument, shift)
      .map((m) => noteName(m).name)
      .join('  ');

    sheetTitle.textContent = sound;
    sheetBody.innerHTML = `
      <div class="detail-top">
        <div class="detail-figure">${chordSVG(entry, {
          instrument, capo: shift, showFingers: get().fingerings, label: sound
        })}</div>
        <div class="detail-info">
          <div class="detail-name">${sound}</div>
          <div class="detail-sub">${shift
            ? `${entry.name} shape · capo ${shift}`
            : `${entry.name} · open position`}</div>
          <div class="detail-notes">${notes}</div>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn primary" type="button" id="strumBtn">Strum chord</button>
        <button class="btn ghost" type="button" id="closeChord">Done</button>
      </div>
      <div class="detail-list" id="altShapes"></div>`;

    const alts = CHORDS[instrument].filter(
      (c) => c !== entry && soundingName(c, shift) === sound
    );
    const altWrap = sheetBody.querySelector('#altShapes');
    if (alts.length) {
      altWrap.innerHTML = '<span class="hint" style="margin:0 6px 0 0">Other shapes:</span>';
      alts.forEach((alt) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = alt.frets.some((f) => f > 4) ? `${alt.name} (barre)` : alt.name;
        b.addEventListener('click', () => openSheet(alt));
        altWrap.append(b);
      });
    }

    sheetBody.querySelector('#strumBtn').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (beforeAudio) beforeAudio();
      await audio.unlock();
      audio.strum(chordFrequency(entry, instrument, shift));
      btn.textContent = 'Strumming…';
      setTimeout(() => { btn.textContent = 'Strum chord'; }, 900);
    });
    sheetBody.querySelector('#closeChord').addEventListener('click', closeSheet);

    sheet.hidden = false;
    document.body.classList.add('sheet-open');
  }

  function closeSheet() {
    sheet.hidden = true;
    document.body.classList.remove('sheet-open');
  }

  seg.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-chord-instrument]');
    if (!btn) return;
    update((s) => { s.chords.instrument = btn.dataset.chordInstrument; });
  });

  document.querySelectorAll('[data-capo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = Number(btn.dataset.capo);
      update((s) => {
        const key = s.chords.instrument;
        s.chords.capo[key] = Math.min(9, Math.max(0, (s.chords.capo[key] || 0) + delta));
      });
    });
  });

  keySelect.addEventListener('change', () => {
    update((s) => { s.chords.key = keySelect.value; });
  });

  search.addEventListener('input', () => {
    query = search.value;
    render();
  });

  sheet.addEventListener('click', (ev) => {
    if (ev.target === sheet) closeSheet();
  });

  return { render, closeSheet };
}
