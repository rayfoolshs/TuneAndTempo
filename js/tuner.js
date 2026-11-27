import * as audio from './audio.js';
import { detectPitch, rms, PitchSmoother } from './pitch.js';
import { INSTRUMENTS, stringsFor, midiToFreq, noteName } from './tuner-data.js';
import { get, update } from './state.js';

const IN_TUNE = 5;
const STRING_WINDOW = 180;
const DWELL_MS = 220;
const CONFIDENCE = 0.55;

export function mountTuner({ beforeStart } = {}) {
  const el = {
    segment: document.getElementById('instrumentSegment'),
    card: document.querySelector('.tuner-card'),
    note: document.getElementById('noteName'),
    octave: document.getElementById('noteOctave'),
    freq: document.getElementById('freqText'),
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
  let filter = null;
  let analyser = null;
  let buf = null;
  let raf = 0;
  let running = false;
  let targetIndex = -1;
  let lastDetect = 0;
  let suspendUntil = 0;
  let baselineRms = 0;
  let needleT = 0;
  let inTuneSince = 0;
  let inTuneLatched = false;
  let pulseTimeout = 0;
  let holdToken = 0;
  let holdCtx = null;
  let holdTone = null;
  let holdStartedAt = 0;
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

  /* ── status / rendering helpers ─────────────────────────── */

  function setStatus(text, warn = false) {
    if (el.status.textContent === text && el.status.classList.contains('warn') === Boolean(warn)) return;
    el.status.textContent = text;
    el.status.classList.toggle('warn', Boolean(warn));
  }

  function setCentsClass(cents) {
    el.card.classList.toggle('on-pitch', Math.abs(cents) <= IN_TUNE);
    el.card.classList.toggle('flat', cents < -IN_TUNE);
    el.card.classList.toggle('sharp', cents > IN_TUNE);
  }

  function resetInTune() {
    inTuneSince = 0;
    inTuneLatched = false;
  }

  function clearVisuals() {
    el.note.textContent = '';
    el.octave.textContent = '';
    if (el.freq) el.freq.textContent = '';
    el.cents.textContent = '';
    el.card.classList.remove('on-pitch', 'flat', 'sharp', 'stale', 'tuned-pulse');
    for (const b of el.strip.children) b.classList.remove('hit');
    resetInTune();
  }

  function pulseCard() {
    el.card.classList.remove('tuned-pulse');
    void el.card.offsetWidth; /* restart the animation */
    el.card.classList.add('tuned-pulse');
    if (pulseTimeout) clearTimeout(pulseTimeout);
    pulseTimeout = setTimeout(() => el.card.classList.remove('tuned-pulse'), 650);
  }

  function withLockSuffix(text, locked) {
    if (!locked) return text;
    const oct = noteName(locked.midi).octave;
    return `${text} · locked to ${locked.label}${oct}`;
  }

  /* ── noise floor + filtering ────────────────────────────── */

  function trackBaseline(rmsNow) {
    /* Learn only from quiet frames, never from playing — otherwise a
       loud first frame would pin the floor underneath a pluck. */
    if (rmsNow < 0.02) {
      baselineRms = baselineRms ? baselineRms * 0.92 + rmsNow * 0.08 : rmsNow;
    }
  }

  function applyFilter() {
    if (!filter) return;
    const spec = INSTRUMENTS[get().instrument] || INSTRUMENTS.guitar;
    filter.frequency.value = spec.maxHz * 1.3;
  }

  /* ── string strip ──────────────────────────────────────── */

  function strings() {
    return stringsFor(get().instrument, get().lowG);
  }

  function buildStrip() {
    const list = strings();
    const a4 = get().calibration;
    el.strip.innerHTML = '';
    if (!list.length) return;

    list.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const oct = noteName(s.midi).octave;
      const freq = midiToFreq(s.midi, a4);
      b.innerHTML = `${s.label}<span class="str-num">${oct} · ${freq.toFixed(1)} Hz</span>`;
      b.setAttribute('aria-label', `${s.label}${oct} at ${freq.toFixed(1)} hertz`);
      b.classList.toggle('target', targetIndex === i);
      b.addEventListener('click', () => {
        targetIndex = targetIndex === i ? -1 : i;
        buildStrip();
      });
      el.strip.append(b);
    });
  }

  /* ── rendering ─────────────────────────────────────────── */

  function noteStale() {
    el.card.classList.add('stale');
    el.card.classList.remove('on-pitch', 'flat', 'sharp');
    el.note.textContent = '';
    el.octave.textContent = '';
    if (el.freq) el.freq.textContent = '';
    el.cents.textContent = running ? 'listening…' : '';
    for (const b of el.strip.children) b.classList.remove('hit');
    resetInTune();
    setStatus('Listening… play a string.');
  }

  function paint(freq) {
    const a4 = get().calibration;
    const list = strings();

    const exact = 69 + 12 * Math.log2(freq / a4);
    const detectedMidi = Math.round(exact);
    const detected = noteName(detectedMidi);
    const locked = targetIndex >= 0 && targetIndex < list.length ? list[targetIndex] : null;

    /* What is actually sounding — the strip shows the string in play. */
    let detectedIndex = -1;
    let detectedBestAbs = Infinity;
    if (list.length) {
      list.forEach((s, i) => {
        const c = Math.abs(1200 * Math.log2(freq / midiToFreq(s.midi, a4)));
        if (c < detectedBestAbs) { detectedBestAbs = c; detectedIndex = i; }
      });
      if (detectedBestAbs > STRING_WINDOW) detectedIndex = -1;
    }

    /* Needle target: the locked string, or the string in play, or the exact note. */
    let cents;
    if (locked) {
      cents = 1200 * Math.log2(freq / midiToFreq(locked.midi, a4));
    } else if (detectedIndex >= 0 && detectedBestAbs <= STRING_WINDOW) {
      cents = 1200 * Math.log2(freq / midiToFreq(list[detectedIndex].midi, a4));
    } else {
      cents = (exact - detectedMidi) * 100;
    }

    el.note.textContent = detected.name;
    el.octave.textContent = String(detected.octave);
    if (el.freq) el.freq.textContent = `${freq.toFixed(1)} Hz`;

    if (Math.abs(cents) < 0.5) {
      el.cents.textContent = 'in tune';
    } else {
      el.cents.textContent = `${cents > 0 ? '+' : ''}${cents.toFixed(0)}¢`;
    }

    needleT += (cents - needleT) * 0.4;
    const clamped = Math.max(-50, Math.min(50, needleT));
    el.needle.style.transform = `rotate(${(clamped / 50) * 90}deg)`;
    setCentsClass(cents);
    el.card.classList.remove('stale');

    const within = Math.abs(cents) <= IN_TUNE;
    const now = performance.now();
    if (within) {
      if (!inTuneSince) inTuneSince = now;
      if (!inTuneLatched && now - inTuneSince >= DWELL_MS) {
        inTuneLatched = true;
        setStatus(withLockSuffix(`In tune · ${detected.name}${detected.octave}`, locked));
        audio.ding();
        pulseCard();
        if (!locked && detectedIndex >= 0) {
          targetIndex = detectedIndex;
          buildStrip();
        }
      }
    } else {
      resetInTune();
      const words = cents < 0
        ? `Tune up · ${Math.abs(cents).toFixed(0)}¢ flat`
        : `Tune down · ${cents.toFixed(0)}¢ sharp`;
      setStatus(withLockSuffix(words, locked));
    }

    let idx = 0;
    for (const b of el.strip.children) {
      const i = idx++;
      b.classList.toggle('hit', i === detectedIndex && detectedBestAbs <= 30);
    }
  }

  /* ── detection loop ────────────────────────────────────── */

  function loop(ts) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (ts < suspendUntil) return;
    if (ts - lastDetect < 45) return;
    lastDetect = ts;

    const spec = INSTRUMENTS[get().instrument] || INSTRUMENTS.guitar;
    analyser.getFloatTimeDomainData(buf);

    const rmsNow = rms(buf);
    trackBaseline(rmsNow);
    const minRms = Math.max(0.006, baselineRms * 1.8);

    const result = detectPitch(buf, audio.context().sampleRate, {
      minHz: spec.minHz,
      maxHz: spec.maxHz,
      minRms
    });

    const confident = result && result.clarity >= CONFIDENCE;
    const stable = confident ? smoother.push(result.freq) : smoother.push(null);
    if (stable == null) { noteStale(); return; }
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
    const spec = INSTRUMENTS[get().instrument] || INSTRUMENTS.guitar;
    source = ctx.createMediaStreamSource(stream);
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.maxHz * 1.3;
    filter.Q.value = 0.6;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    source.connect(filter);
    filter.connect(analyser);
    buf = new Float32Array(analyser.fftSize);

    running = true;
    audio.setMode('tuner');
    smoother.reset();
    needleT = 0;
    baselineRms = 0;
    lastDetect = 0;
    resetInTune();
    el.card.classList.remove('stale');
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
    holdToken += 1;
    audio.stopSustainedTone();
    holdTone = null;
    holdCtx = null;
    if (source) { try { source.disconnect(); } catch { /* gone */ } }
    if (filter) { try { filter.disconnect(); } catch { /* gone */ } }
    if (stream) stream.getTracks().forEach((track) => track.stop());
    source = null;
    stream = null;
    filter = null;
    analyser = null;
    audio.setMode('off');
    el.micBtn.classList.remove('recording');
    el.micLabel.textContent = 'Start listening';
    needleT = 0;
    el.needle.style.transform = 'rotate(0deg)';
    if (pulseTimeout) { clearTimeout(pulseTimeout); pulseTimeout = 0; }
    clearVisuals();
    setStatus('Microphone off. Nothing is being recorded.');
  }

  /* ── reference tone (hold to play) ──────────────────────── */

  function playFreqFor() {
    const list = strings();
    const a4 = get().calibration;
    const index = targetIndex >= 0 && targetIndex < list.length ? targetIndex : 0;
    const midi = list.length ? list[index].midi : 69;
    return { midi, a4, nm: noteName(midi) };
  }

  function beginHold() {
    const my = ++holdToken;
    const ctx = playFreqFor();
    holdCtx = ctx;
    holdStartedAt = performance.now();
    suspendUntil = performance.now() + 999999;
    smoother.reset();
    audio.unlock().then(() => {
      if (my !== holdToken || !holdCtx) return;
      holdTone = audio.startSustainedTone(midiToFreq(ctx.midi, ctx.a4), { gain: 0.2 });
      setStatus(`Reference tone · ${ctx.nm.name}${ctx.nm.octave}`);
    }).catch(() => {});
  }

  async function endHold() {
    if (!holdCtx) return;
    const heldMs = performance.now() - holdStartedAt;
    const ctx = holdCtx;
    holdCtx = null;
    holdToken += 1;
    audio.stopSustainedTone();
    holdTone = null;
    suspendUntil = performance.now() + 150;

    if (heldMs < 250) {
      /* Quick tap: one short reference tone after release. */
      await audio.unlock();
      audio.playTone(midiToFreq(ctx.midi, ctx.a4), { duration: 1.15, gain: 0.2 });
      suspendUntil = performance.now() + 1250;
      setStatus(`Reference tone · ${ctx.nm.name}${ctx.nm.octave}`);
    } else {
      setStatus('Listening… play a string.');
    }
  }

  function bindToneButton() {
    el.toneBtn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      beginHold();
    });
    el.toneBtn.addEventListener('pointerup', () => { endHold(); });
    el.toneBtn.addEventListener('pointercancel', () => { endHold(); });
    el.toneBtn.addEventListener('pointerleave', () => { endHold(); });
    el.toneBtn.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }
  bindToneButton();

  /* ── wiring ────────────────────────────────────────────── */

  el.segment.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-instrument]');
    if (!btn) return;
    update((s) => { s.instrument = btn.dataset.instrument; });
    targetIndex = -1;
    smoother.reset();
    clearVisuals();
    applyFilter();
  });

  el.lowG.addEventListener('change', () => {
    update((s) => { s.lowG = el.lowG.checked; });
    targetIndex = -1;
    smoother.reset();
    clearVisuals();
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
    applyFilter();
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
