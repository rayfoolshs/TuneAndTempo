/* Instrument string sets and tuning references. */

export const A4 = 440;

export function midiToFreq(midi, a4 = A4) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/* String order is low → high for guitar and bass (6th → 1st),
   and G → A for ukulele (4th → 1st). */
export const INSTRUMENTS = {
  guitar: {
    label: 'Guitar',
    minHz: 60,
    maxHz: 1100,
    strings: [
      { midi: 40, label: 'E' },
      { midi: 45, label: 'A' },
      { midi: 50, label: 'D' },
      { midi: 55, label: 'G' },
      { midi: 59, label: 'B' },
      { midi: 64, label: 'E' }
    ]
  },
  bass: {
    label: 'Bass',
    minHz: 30,
    maxHz: 420,
    strings: [
      { midi: 28, label: 'E' },
      { midi: 33, label: 'A' },
      { midi: 38, label: 'D' },
      { midi: 43, label: 'G' }
    ]
  },
  ukulele: {
    label: 'Ukulele',
    minHz: 150,
    maxHz: 1200,
    strings: [
      { midi: 67, label: 'G' },
      { midi: 60, label: 'C' },
      { midi: 64, label: 'E' },
      { midi: 69, label: 'A' }
    ]
  },
  chromatic: {
    label: 'Chromatic',
    minHz: 55,
    maxHz: 1300,
    strings: []
  }
};

export function stringsFor(instrument, lowG = false) {
  const spec = INSTRUMENTS[instrument] || INSTRUMENTS.guitar;
  if (instrument === 'ukulele' && lowG) {
    return spec.strings.map((s, i) => (i === 0 ? { ...s, midi: 55 } : s));
  }
  return spec.strings;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi) {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  return { name: NOTE_NAMES[pc], octave, pc };
}
