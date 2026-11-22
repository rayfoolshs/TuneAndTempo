import * as audio from './audio.js';
import { detectPitch, PitchSmoother } from './pitch.js';
import { INSTRUMENTS, stringsFor, midiToFreq, noteName } from './tuner-data.js';
import { get, update } from './state.js';

const IN_TUNE = 5;
const STRING_WINDOW = 180;

export function mountTuner({ beforeStart } = {}) {
  const el = {
    segment: document.getElementById('instrumentSegment'),
    card: document.querySelector('.tuner-card'),
    note: document.getElementById('noteName'),
    octave: document.getElementById('noteOctave'),
    cents: document.getElementById('centsText'),
    needle: document.getElementById('needle'),
    ticks: document.getElementById('gaugeTicks'),
    status: document.getElementById('tunerStatus'),
    strip: document.getElementById('stringStrip'),
    micBtn: document.getElementById('micBtn'),
    micLabel: document.getElementById('micBtnLabel'),
    toneBtn: document.getElementById('toneBtn'),
    calOut: document.getElementById('calOut'),
    lowGRow: document.getElementById('lowGRow'),
    lowG: document.getElementById('lowG')
  };

  let stream = null;
  let source = null;
  let analyser = null;
  let buf = null;
  let raf = 0;
  let running = false;
  let targetIndex = -1;
  let lastDetect = 0;
  let suspendUntil = 0;
  const smoother = new PitchSmoother(3);

  buildTicks();

  /* ── gauge ─────────────────────────────────────────────── */

  function buildTicks() {
    const cx = 150;
    const cy = 142;
    const r = 128;
    let html = '';
    for (let c = -50; c <= 50; c += 5) {
      const t = (c + 50) / 100;
      const ang = Math.PI * (1 - t);
      const major = c % 25 === 0;
      const r1 = r - (major ? 13 : 7);
      const r2 = r - 3;
      const x1 = cx + r1 * Math.cos(ang);
      const y1 = cy - r1 * Math.sin(ang);
      const x2 = cx + r2 * Math.cos(ang);
      const y2 = cy - r2 * Math.sin(ang);
      html += `<line class="gauge-tick${major ? ' major' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      if (c === -50 || c === 50) {
        const lr = r - 26;
        const lx = cx + lr * Math.cos(ang);
        const ly = cy - lr * Math.sin(ang) + 3;
        html += `<text class="gauge-tick-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">${c > 0 ? '+' + c : c}</text>`;
      }
    }
    el.ticks.innerHTML = html;
  }

  /* ── rendering ─────────────────────────────────────────── */

  function setStatus(text, warn = false) {
    el.status.textContent = text;
    el.status.classList.toggle('warn', Boolean(warn));
  }

  function setCentsClass(cents) {
    el.card.classList.toggle('on-pitch', Math.abs(cents) <= IN_TUNE);
    el.card.classList.toggle('flat', cents < -IN_TUNE);
    el.card.classList.toggle('sharp', cents > IN_TUNE);
  }

  function idle() {
    el.note.textContent = '';
    el.octave.textContent = '';
    el.cents.textContent = running ? 'listening…' : '';
    el.needle.style.transform = 'rotate(0deg)';
    el.card.classList.remove('on-pitch', 'flat', 'sharp');
    for (const b of el.strip.children) b.classList.remove('hit');
  }

  function paint(freq) {
    const a4 = get().calibration;
    const list = strings();

    let midi = 69;
    let cents = 0;
    let hitIndex = -1;

    if (list.length && targetIndex >= 0 && list[targetIndex]) {
      midi = list[targetIndex].midi;
      cents = 1200 * Math.log2(freq / midiToFreq(midi, a4));
      hitIndex = targetIndex;
    } else if (list.length) {
      let bestCents = Infinity;
      let bestIndex = -1;
      list.forEach((s, i) => {
        const c = 1200 * Math.log2(freq / midiToFreq(s.midi, a4));
        if (Math.abs(c) < Math.abs(bestCents)) {
          bestCents = c;
          bestIndex = i;
        }
      });
      if (Math.abs(bestCents) <= STRING_WINDOW) {
        cents = bestCents;
        midi = list[bestIndex].midi;
        hitIndex = bestIndex;
      } else {
        const exact = 69 + 12 * Math.log2(freq / a4);
        midi = Math.round(exact);
        cents = (exact - midi) * 100;
      }
    } else {
      const exact = 69 + 12 * Math.log2(freq / a4);
      midi = Math.round(exact);
      cents = (exact - midi) * 100;
    }

    const nm = noteName(midi);
    el.note.textContent = nm.name;
    el.octave.textContent = String(nm.octave);

    if (Math.abs(cents) < 0.5) {
      el.cents.textContent = 'in tune';
    } else {
      el.cents.textContent = `${cents > 0 ? '+' : ''}${cents.toFixed(0)}¢`;
    }

    const clamped = Math.max(-50, Math.min(50, cents));
    el.needle.style.transform = `rotate(${(clamped / 50) * 90}deg)`;
    setCentsClass(cents);

    if (Math.abs(cents) <= IN_TUNE) {
      setStatus(`In tune · ${nm.name}${nm.octave}`);
    } else if (cents < 0) {
      setStatus(`Tune up · ${Math.abs(cents).toFixed(0)}¢ flat`);
    } else {
      setStatus(`Tune down · ${cents.toFixed(0)}¢ sharp`);
    }

    [...el.strip.children].forEach((b, i) => {
      b.classList.toggle('hit', i === hitIndex && Math.abs(cents) <= 30);
    });
  }

  /* ── string strip ──────────────────────────────────────── */

  function strings() {
    return stringsFor(get().instrument, get().lowG);
  }

  function buildStrip() {
    const list = strings();
    el.strip.innerHTML = '';
    if (!list.length) return;

    list.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const oct = noteName(s.midi).octave;
      b.innerHTML = `${s.label}<span class="str-num">${oct}</span>`;
      b.setAttribute('aria-label', `${s.label}${oct}`);
      b.classList.toggle('target', targetIndex === i);
      b.addEventListener('click', () => {
        targetIndex = targetIndex === i ? -1 : i;
        buildStrip();
      });
      el.strip.append(b);
    });
  }

  /* ── detection loop ────────────────────────────────────── */

  function loop(ts) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (ts < suspendUntil) return;
    if (ts - lastDetect < 45) return;
    lastDetect = ts;

    analyser.getFloatTimeDomainData(buf);
    const spec = INSTRUMENTS[get().instrument] || INSTRUMENTS.guitar;
    const result = detectPitch(buf, audio.context().sampleRate, {
      minHz: spec.minHz,
      maxHz: spec.maxHz
    });

    const stable = smoother.push(result ? result.freq : null);
    if (stable == null) { idle(); return; }
    paint(stable);
  }

  /* ── start / stop ──────────────────────────────────────── */

  async function start() {
    if (running) return;

    if (!window.isSecureContext) {
      setStatus('The microphone needs HTTPS. Serve the app over https:// or localhost.', true);
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('This browser has no microphone access. Try Safari on iOS 14.5 or newer.', true);
      return;
    }

    if (beforeStart) beforeStart();
    setStatus('Requesting microphone…');

    try {
      await audio.unlock();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        }
      });
    } catch (err) {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      setStatus(denied
        ? 'Microphone blocked. In Safari tap the “aA” button → Website Settings → Microphone → Allow, then reload.'
        : `Could not open the microphone (${err && err.name ? err.name : 'unknown'}).`, true);
      return;
    }

    const ctx = audio.context();
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    buf = new Float32Array(analyser.fftSize);

    running = true;
    audio.setMode('tuner');
    smoother.reset();
    lastDetect = 0;
    el.micBtn.classList.add('recording');
    el.micLabel.textContent = 'Stop listening';
    setStatus('Listening… play a string.');
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
    if (source) { try { source.disconnect(); } catch { /* gone */ } }
    if (stream) stream.getTracks().forEach((track) => track.stop());
    source = null;
    stream = null;
    analyser = null;
    audio.setMode('off');
    el.micBtn.classList.remove('recording');
    el.micLabel.textContent = 'Start listening';
    setStatus('Microphone off. Nothing is being recorded.');
    idle();
  }

  async function playReference() {
    const list = strings();
    const a4 = get().calibration;
    const index = targetIndex >= 0 ? targetIndex : 0;
    await audio.unlock();

    const midi = list.length ? list[index].midi : 69;
    suspendUntil = performance.now() + 1900;
    smoother.reset();
    audio.playTone(midiToFreq(midi, a4), { duration: 1.7, gain: 0.2 });

    const nm = noteName(midi);
    setStatus(`Reference tone · ${nm.name}${nm.octave}`);
  }

  /* ── wiring ────────────────────────────────────────────── */

  el.segment.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-instrument]');
    if (!btn) return;
    update((s) => { s.instrument = btn.dataset.instrument; });
    targetIndex = -1;
    smoother.reset();
    idle();
  });

  el.lowG.addEventListener('change', () => {
    update((s) => { s.lowG = el.lowG.checked; });
    targetIndex = -1;
    smoother.reset();
    idle();
  });

  document.querySelectorAll('[data-cal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = Number(btn.dataset.cal);
      update((s) => { s.calibration = Math.min(445, Math.max(435, s.calibration + delta)); });
    });
  });

  el.micBtn.addEventListener('click', () => {
    if (running) stop();
    else start();
  });

  el.toneBtn.addEventListener('click', () => { playReference(); });

  /* ── refresh from state ────────────────────────────────── */

  function refresh() {
    const s = get();
    for (const btn of el.segment.querySelectorAll('[data-instrument]')) {
      btn.setAttribute('aria-selected', String(btn.dataset.instrument === s.instrument));
    }
    el.calOut.textContent = String(s.calibration);
    el.lowGRow.hidden = s.instrument !== 'ukulele';
    el.lowG.checked = s.lowG;
    el.toneBtn.disabled = false;
    buildStrip();
  }

  refresh();

  return {
    start,
    stop,
    refresh,
    get running() { return running; }
  };
}
