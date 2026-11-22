/* Basic drum grooves for the metronome.

   Each pattern is written over a fixed number of beats on a 16th grid
   (`spb: 4`) or a triplet grid (`spb: 3`), then tiled to whatever bar
   length the time signature has. Step numbers are absolute from the
   start of the pattern.

   `swingable` means the shuffle slider applies: every hit that lands on
   the off-8th is pushed late. Triplet grooves are already swung, so the
   slider leaves them alone. */

const hit = (v, s, g) => ({ v, s, g });

export const GROOVES = {
  click: {
    id: 'click',
    label: 'Click',
    beats: 4,
    spb: 4,
    swingable: true,
    hits: [],
    hint: 'A plain metronome click on the subdivision you choose.'
  },

  rock: {
    id: 'rock',
    label: 'Rock',
    beats: 4,
    spb: 4,
    swingable: true,
    hint: 'Eighth-note hats, kick on 1 and 3, snare on 2 and 4.',
    hits: [
      hit('kick', 0), hit('kick', 8),
      hit('snare', 4), hit('snare', 12),
      hit('hat', 0), hit('hat', 2), hit('hat', 4), hit('hat', 6),
      hit('hat', 8), hit('hat', 10), hit('hat', 12), hit('hat', 14)
    ]
  },

  swing: {
    id: 'swing',
    label: 'Swing',
    beats: 4,
    spb: 3,
    swingable: false,
    hint: 'Ride on the quarter plus the “a” of 2 and 4. Hat foot on the backbeat.',
    hits: [
      hit('ride', 0), hit('ride', 3), hit('ride', 5), hit('ride', 6),
      hit('ride', 9), hit('ride', 11),
      hit('hat', 3, 0.8), hit('hat', 9, 0.8),
      hit('kick', 0, 0.4), hit('kick', 3, 0.4), hit('kick', 6, 0.4), hit('kick', 9, 0.4)
    ]
  },

  jazz: {
    id: 'jazz',
    label: 'Jazz',
    beats: 4,
    spb: 3,
    swingable: false,
    hint: 'Ride pattern with a soft comp on the “a” of 3 and feathered feet.',
    hits: [
      hit('ride', 0), hit('ride', 3), hit('ride', 5), hit('ride', 6),
      hit('ride', 9), hit('ride', 11),
      hit('hat', 3, 0.85), hit('hat', 9, 0.85),
      hit('snare', 8, 0.45),
      hit('kick', 0, 0.35), hit('kick', 6, 0.35)
    ]
  },

  shuffle: {
    id: 'shuffle',
    label: 'Shuffle',
    beats: 4,
    spb: 3,
    swingable: false,
    hint: 'The 12/8 shuffle: hats on the triplet grid, snare on 2 and 4.',
    hits: [
      hit('hat', 0), hit('hat', 2), hit('hat', 3), hit('hat', 5),
      hit('hat', 6), hit('hat', 8), hit('hat', 9), hit('hat', 11),
      hit('kick', 0), hit('kick', 6),
      hit('snare', 3), hit('snare', 9)
    ]
  },

  blues: {
    id: 'blues',
    label: 'Blues',
    beats: 4,
    spb: 3,
    swingable: false,
    hint: 'Slow triplet feel: shuffle ride with rim accents on the “a” of 2 and 4.',
    hits: [
      hit('ride', 0), hit('ride', 2), hit('ride', 3), hit('ride', 5),
      hit('ride', 6), hit('ride', 8), hit('ride', 9), hit('ride', 11),
      hit('kick', 0), hit('kick', 6),
      hit('snare', 3), hit('snare', 9),
      hit('rim', 5, 0.6), hit('rim', 11, 0.6)
    ]
  },

  bossa: {
    id: 'bossa',
    label: 'Bossa Nova',
    beats: 4,
    spb: 4,
    swingable: true,
    hint: 'Clave on the rim, straight shaker, kick on 1, 3 and the “and” of 4.',
    hits: [
      hit('kick', 0), hit('kick', 8), hit('kick', 14),
      hit('rim', 0, 0.9), hit('rim', 3, 0.85), hit('rim', 6, 0.8),
      hit('rim', 10, 0.9), hit('rim', 12, 0.85),
      hit('shaker', 0, 0.7), hit('shaker', 2, 0.45), hit('shaker', 4, 0.7),
      hit('shaker', 6, 0.45), hit('shaker', 8, 0.7), hit('shaker', 10, 0.45),
      hit('shaker', 12, 0.7), hit('shaker', 14, 0.45)
    ]
  }
};

export const GROOVE_ORDER = ['click', 'rock', 'swing', 'jazz', 'shuffle', 'blues', 'bossa'];

/* Bucket each pattern hit into the beat it belongs to, tiled across the
   bar so a 3/4 bar gets the first three beats of a four-beat pattern. */
export function buildGroove(groove, beatsPerBar) {
  const bars = Math.max(1, Math.round(beatsPerBar));
  const out = Array.from({ length: bars }, () => []);
  if (!groove || groove.id === 'click' || !groove.hits.length) return out;

  const patternSteps = groove.beats * groove.spb;
  const swingStep = groove.spb / 2;
  const reps = Math.ceil(bars / groove.beats);

  for (let rep = 0; rep < reps; rep += 1) {
    for (const h of groove.hits) {
      const abs = h.s + rep * patternSteps;
      const beat = Math.floor(abs / groove.spb);
      if (beat >= bars) continue;
      const offset = abs % groove.spb;
      out[beat].push({
        v: h.v,
        o: offset,
        g: h.g == null ? 1 : h.g,
        swing: groove.swingable !== false && offset === swingStep
      });
    }
  }

  return out;
}
