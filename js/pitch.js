/* Pitch detection: normalised autocorrelation, first-strong-peak search.

   The peak picker descends to the first dip in the correlation curve and
   then takes the earliest peak that is within 10% of the strongest one.
   That is what stops the classic sub-octave error, where a multiple of
   the period wins because it correlates just as well.

   Low instruments are decimated by two first, which keeps the lag search
   cheap enough to run ~20 times a second on a phone. */

export function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export function detectPitch(input, sampleRate, { minHz = 40, maxHz = 1200, minRms = 0.006 } = {}) {
  let buf = input;
  let sr = sampleRate;
  let minLag = Math.max(2, Math.floor(sr / maxHz));
  let maxLag = Math.ceil(sr / minHz);

  /* Decimate low instruments: halves the lag range and the window. */
  if (maxLag > 900) {
    const half = new Float32Array(buf.length >> 1);
    for (let i = 0; i < half.length; i++) half[i] = (buf[i * 2] + buf[i * 2 + 1]) * 0.5;
    buf = half;
    sr = sr / 2;
    minLag = Math.max(2, Math.floor(sr / maxHz));
    maxLag = Math.ceil(sr / minHz);
  }

  const n = buf.length;
  maxLag = Math.min(maxLag, n - 4);
  if (maxLag <= minLag + 8) return null;

  let energy = 0;
  for (let i = 0; i < n; i++) energy += buf[i] * buf[i];
  if (Math.sqrt(energy / n) < minRms) return null;

  const window = Math.min(
    n - maxLag - 1,
    Math.max(256, Math.ceil(2 * sr / minHz))
  );
  if (window < 64) return null;

  let e0 = 0;
  for (let i = 0; i < window; i++) e0 += buf[i] * buf[i];
  if (e0 < 1e-9) return null;

  const corrAt = (lag) => {
    let acc = 0;
    let e2 = 0;
    for (let i = 0; i < window; i++) {
      const b = buf[i + lag];
      acc += buf[i] * b;
      e2 += b * b;
    }
    const den = Math.sqrt(e0 * e2);
    return den > 1e-9 ? acc / den : 0;
  };

  /* Coarse pass, step 2 above a few hundred lags. */
  const step = maxLag > 300 ? 2 : 1;
  const frames = Math.floor(maxLag / step);
  const acf = new Float32Array(frames + 1);
  acf[0] = 1;
  for (let k = 1; k <= frames; k++) acf[k] = corrAt(k * step);

  /* Walk down to the first dip, then find the first strong peak after it. */
  let dip = 0;
  while (dip < frames && acf[dip + 1] <= acf[dip]) dip += 1;

  let globalMax = -1;
  let argMax = dip;
  for (let j = dip; j <= frames; j++) {
    if (acf[j] > globalMax) { globalMax = acf[j]; argMax = j; }
  }
  if (globalMax < 0.45) return null;

  const threshold = globalMax * 0.9;
  let peakK = -1;
  for (let j = Math.max(1, dip + 1); j < frames; j++) {
    if (acf[j] >= threshold && acf[j] >= acf[j - 1] && acf[j] >= acf[j + 1]) {
      peakK = j;
      break;
    }
  }
  if (peakK < 0) peakK = argMax;

  /* Fine pass around the chosen peak. */
  const center = peakK * step;
  let bestLag = center;
  let bestVal = acf[peakK];
  const lo = Math.max(minLag, center - step * 2);
  const hi = Math.min(maxLag, center + step * 2);
  for (let lag = lo; lag <= hi; lag++) {
    const v = corrAt(lag);
    if (v > bestVal) { bestVal = v; bestLag = lag; }
  }

  if (bestVal < 0.5) return null;

  /* Parabolic interpolation for sub-sample period accuracy. */
  let period = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y1 = corrAt(bestLag - 1);
    const y2 = bestVal;
    const y3 = corrAt(bestLag + 1);
    const a = (y1 + y3 - 2 * y2) / 2;
    const b = (y3 - y1) / 2;
    if (Math.abs(a) > 1e-9) period = bestLag - b / (2 * a);
  }

  const freq = sr / period;
  if (!Number.isFinite(freq) || freq <= 0) return null;
  if (freq < minHz * 0.92 || freq > maxHz * 1.08) return null;

  return { freq, clarity: bestVal };
}

/* Median of the last few frames kills single-frame jumps. */
export class PitchSmoother {
  constructor(size = 4) {
    this.size = size;
    this.buf = [];
  }
  push(value) {
    if (value == null) {
      this.buf.length = 0;
      return null;
    }
    this.buf.push(value);
    if (this.buf.length > this.size) this.buf.shift();
    const sorted = [...this.buf].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
  reset() { this.buf.length = 0; }
}
