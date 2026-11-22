/* Chord library: 45 guitar shapes, 30 ukulele shapes.
   Frets run low string → high string; -1 = muted, 0 = open. */

import { midiToFreq } from './tuner-data.js';

const SUFFIX = {
  maj: '',
  min: 'm',
  dom7: '7',
  maj7: 'maj7',
  m7: 'm7',
  sus2: 'sus2',
  sus4: 'sus4',
  five: '5'
};

const PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11
};

export const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const TUNINGS = {
  guitar: [40, 45, 50, 55, 59, 64],
  ukulele: [67, 60, 64, 69]
};

function parse(shape) {
  return [...shape].map((ch) => (ch === 'x' ? -1 : Number(ch)));
}

function chord(root, quality, shape) {
  return { root, quality, name: root + SUFFIX[quality], frets: parse(shape) };
}

export const CHORDS = {
  guitar: [
    /* ── open + barre majors ── */
    chord('C', 'maj', 'x32010'),
    chord('D', 'maj', 'xx0232'),
    chord('E', 'maj', '022100'),
    chord('F', 'maj', '133211'),
    chord('G', 'maj', '320003'),
    chord('A', 'maj', 'x02220'),
    chord('B', 'maj', 'x24442'),
    chord('Bb', 'maj', 'x13331'),
    chord('Eb', 'maj', 'x65343'),
    chord('Ab', 'maj', '466544'),
    chord('Db', 'maj', 'x46664'),
    chord('F#', 'maj', '244322'),

    /* ── minors ── */
    chord('A', 'min', 'x02210'),
    chord('E', 'min', '022000'),
    chord('D', 'min', 'xx0231'),
    chord('B', 'min', 'x24432'),
    chord('F#', 'min', '244222'),
    chord('C', 'min', 'x35543'),
    chord('G', 'min', '355333'),
    chord('F', 'min', '133111'),
    chord('C#', 'min', 'x46654'),
    chord('Bb', 'min', 'x13321'),
    chord('Eb', 'min', 'x68876'),
    chord('G#', 'min', '466444'),

    /* ── dominant sevenths ── */
    chord('A', 'dom7', 'x02020'),
    chord('D', 'dom7', 'xx0212'),
    chord('G', 'dom7', '320001'),
    chord('E', 'dom7', '020100'),
    chord('B', 'dom7', 'x21202'),
    chord('C', 'dom7', 'x32310'),
    chord('F', 'dom7', '131211'),
    chord('Bb', 'dom7', 'x13131'),

    /* ── major sevenths ── */
    chord('C', 'maj7', 'x32000'),
    chord('F', 'maj7', 'xx3210'),
    chord('G', 'maj7', '320002'),
    chord('A', 'maj7', 'x02120'),
    chord('D', 'maj7', 'xx0222'),

    /* ── minor sevenths ── */
    chord('A', 'm7', 'x02010'),
    chord('D', 'm7', 'xx0211'),
    chord('E', 'm7', '020000'),
    chord('B', 'm7', 'x20202'),

    /* ── suspended ── */
    chord('D', 'sus4', 'xx0233'),
    chord('A', 'sus2', 'x02200'),
    chord('A', 'sus4', 'x02230'),
    chord('E', 'sus4', '022200')
  ],

  ukulele: [
    chord('C', 'maj', '0003'),
    chord('A', 'min', '2000'),
    chord('F', 'maj', '2010'),
    chord('G', 'maj', '0232'),
    chord('E', 'min', '0432'),
    chord('D', 'maj', '2220'),
    chord('D', 'min', '2210'),
    chord('A', 'maj', '2100'),
    chord('E', 'maj', '4442'),
    chord('Bb', 'maj', '3211'),
    chord('B', 'min', '4222'),
    chord('B', 'dom7', '2322'),
    chord('C', 'dom7', '0001'),
    chord('G', 'dom7', '0212'),
    chord('A', 'dom7', '0100'),
    chord('D', 'dom7', '2223'),
    chord('E', 'dom7', '1202'),
    chord('F', 'dom7', '2310'),
    chord('C', 'maj7', '0002'),
    chord('F', 'maj7', '2413'),
    chord('G', 'maj7', '0222'),
    chord('A', 'maj7', '1100'),
    chord('A', 'm7', '0000'),
    chord('E', 'm7', '0202'),
    chord('D', 'm7', '2213'),
    chord('F#', 'min', '2120'),
    chord('C#', 'min', '1104'),
    chord('C', 'min', '0333'),
    chord('G', 'min', '0231'),
    chord('C', 'sus4', '0013')
  ]
};

export function transposeRoot(root, semitones) {
  const base = PC[root];
  if (base == null) return root;
  return KEY_NAMES[((base + semitones) % 12 + 12) % 12];
}

export function soundingName(entry, capo) {
  if (!capo) return entry.name;
  return transposeRoot(entry.root, capo) + SUFFIX[entry.quality];
}

export function rootPitchClass(entry, capo) {
  return (PC[entry.root] + capo) % 12;
}

export function chordNotes(entry, instrument, capo) {
  const tuning = TUNINGS[instrument];
  if (!tuning) return [];
  return entry.frets
    .map((f, i) => (f < 0 ? null : tuning[i] + capo + f))
    .filter((n) => n != null);
}

export function chordFrequency(entry, instrument, capo) {
  return chordNotes(entry, instrument, capo).map((m) => midiToFreq(m));
}
