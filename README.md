# Tune + Tempo

A guitar, bass and ukulele tuner with a shuffle-aware metronome and a 75-shape
chord library. One small web app, no build step, no accounts, no network calls
after the first load. Built for an iPhone first and a iPad too.

**Live on GitHub Pages: [https://rayfoolshs.github.io/TuneAndTempo/](https://rayfoolshs.github.io/TuneAndTempo/)**

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)

![Tuner](screenshots/tuner-light.png)

<p align="center">
  <img src="screenshots/metronome-dark.png" alt="Metronome in dark mode" width="31%">
  <img src="screenshots/chords-light.png" alt="Chord library" width="31%">
  <img src="screenshots/ipad-chords.png" alt="Chord library on iPad" width="31%">
</p>

## Run it locally

```bash
cd TuneAndTempo
python3 -m http.server 4173
```

Open <http://localhost:4173>. The microphone needs `localhost` or `https://` —
`file://` will load the interface but not the tuner.

## Put it on the phone

**The live app is served from GitHub Pages** at
[https://rayfoolshs.github.io/TuneAndTempo/](https://rayfoolshs.github.io/TuneAndTempo/) —
no hosting setup, sign-in or app store needed.

1. On the iPhone or iPad open that address **in Safari**.
2. Allow the microphone when the tuner asks. Do this before installing, so the
   permission is remembered for the installed app.
3. Share → **Add to Home Screen**.

After that first load every file is precached by `sw.js`, so the app opens and
runs with no connection at all.

If you want to host your own copy, the same steps work on any static host
(GitHub Pages, Netlify Drop, Cloudflare Pages, Vercel — no configuration
needed): keep the folder structure intact and open the HTTPS address in
Safari.

## What is in it

### Tuner
- Guitar (EADGBE), bass (EADG), ukulele (GCEA, with a low-G switch) and
  chromatic.
- Autocorrelation pitch detection, ~20 reads a second, median-filtered so the
  needle does not twitch. The mic path is lowpass-filtered to the instrument's
  band, and a clarity gate plus an adaptive noise floor ignore doubtful reads
  and background rumble. Tested within ±0.3 cents from 30 Hz to 1047 Hz.
- A ±50 cent needle that glides instead of jumping frame to frame, a colour
  state (flat / in tune / sharp), a Hz readout and the string in play
  highlighted as you play. It only goes green after ~220 ms inside the zone —
  the needle does not blink on a lucky frame — and plays a short ding when
  you land on it.
- Tap a string to lock onto it, tap again to go back to automatic. You also
  land locked automatically when you hit in-tune.
- Press and hold the Tone button to hear the reference pitch, release to
  listen; a quick tap plays a short one-shot instead.
- A4 calibration from 435 to 445 Hz, with the target frequency shown on every
  string.
- The microphone is released the moment you leave the tuner, so the orange
  recording dot goes away.

### Metronome
- 30–250 BPM, slider, ±1/±5 steppers and tap tempo.
- 2/4, 3/4, 4/4, 5/4, 6/8, 7/8, 9/8, 12/8 and a custom signature (1–16 beats
  over 2, 4, 8 or 16).
- Subdivisions: quarters, eighths, triplets, sixteenths.
- **Seven grooves** — Click, Rock, Swing, Jazz, Shuffle, Blues and Bossa Nova.
  Drums are synthesised from oscillators and filtered noise, so there are no
  samples to download. Patterns are written on a 16th or triplet grid and tile
  to the bar, so the four-beat Rock pattern still works in 3/4 or 5/4.
- **Shuffle feel 0–100%.** Every second subdivision is pushed late by up to
  two thirds of a slot. 33% is the classic triplet swing, 50% a dotted feel,
  100% a hard shuffle. With a straight grid groove selected it swings that
  groove's off-8ths; triplet grooves are already swung, so the slider explains
  itself and switches off.
- Drum hits and clicks are scheduled on `AudioContext.currentTime` with a 25 ms
  lookahead, so the grid never drifts, even when the screen is busy. Grooves are
  scheduled one beat at a time, so Stop silences them within a beat. Beat dots
  and a tempo pulse show where you are.
- Three click sounds and a volume control.

![Grooves](screenshots/metronome-grooves.png)

### Chords
- 45 guitar shapes and 30 ukulele shapes, drawn as vector fretboards with
  muted/open markers, barre bars and root notes highlighted.
- **Capo 0–9, stored per instrument.** With a capo the card shows what you
  hear and which shape to finger: capo 2 shows the C shape as "D", with
  "C shape" underneath.
- **Key filter** (any of the 12 keys) shows only the shapes that sound in that
  key at the current capo, which is what makes 45 shapes usable on a phone.
- Tap a chord to open it full size with its notes, alternate shapes, and a
  strum button that plays it through the same audio context at the capo pitch.
- Search by shape name or sounding name.

## One sound at a time

There is a single `AudioContext`. Starting the metronome stops the microphone;
starting the tuner stops the click. Chord strums only sound while both are
stopped. Leaving a screen, or sending the app to the background, stops whatever
was running.

## Files

```
index.html            markup for all three views
styles/app.css        one stylesheet, dark/light, safe-area aware
js/main.js            boot, routing, metronome UI, settings
js/state.js           persisted settings + setup export/import
js/audio.js           shared AudioContext, clicks, tones, plucks
js/pitch.js           autocorrelation detector + smoothing
js/tuner.js           microphone pipeline and tuner screen
js/tuner-data.js      instrument string sets
js/metronome.js       lookahead scheduler and shuffle maths
js/grooves.js         drum patterns and bar tiling
js/chords.js          fretboard renderer and chords screen
js/chord-data.js      the 75 shapes and capo transposition
sw.js                 offline cache
manifest.json         install metadata
icons/                generated PNG icons
tools/make-icons.mjs  regenerates the icons (node tools/make-icons.mjs)
```

## Editing it

- **Bump `VERSION` in `sw.js` after changing any file.** The cache serves the
  old copy instantly and refreshes in the background, so a release only shows
  up on the second launch. Bumping the version is the clean way to ship.
- While editing, open `http://localhost:4173/?nosw=1` to skip the service
  worker entirely.
- Settings → *Back up your setup* turns your tempo, signature, capo and tuning
  into a `TT1:…` string you can paste back later.

## Honest limits

- Microphone access, and every iOS audio API, require HTTPS. That is an iOS
  rule, not a choice here.
- On some iOS versions a home-screen web app cannot open the microphone even
  though the same page works in Safari. If that happens, allow the mic in
  Safari first, then reinstall the home-screen icon.
- Finger numbers are a hint, not a lesson: they are computed from the shape,
  not from a teacher's fingering, and they are off by default.
- Tab-symbol metadata and iOS icon rendering vary; the icons are plain PNGs so
  every version agrees.
- Chord transposition spells notes with sharps. Capo 3 on Bb reads as C#, not
  Db. The pitch is right; only the spelling is opinionated.

## License

MIT — see [LICENSE](LICENSE).
