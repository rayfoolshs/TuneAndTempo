# Contributing

This is a small, no-build-step app — plain HTML/CSS/JS, no frameworks, no
tooling required. Contributions are welcome and are best kept small and
focused.

## How to help

- Open an issue before starting large changes. Small, self-contained fixes
  (typos, small bugs) are fine to submit directly.
- Keep changes inside the file map in `README.md` (`index.html`,
  `styles/app.css`, `js/`, `sw.js`). There is deliberately no build step.
- After changing any file, bump `VERSION` in `sw.js`. The offline cache serves
  the old copy otherwise and your fix only shows up on the second launch.
- Verify the tuner with a real microphone on a real phone — terminal tests
  cannot cover mic latency or iOS Safari behavior.

## Pull requests

- One change per PR.
- Update `README.md` if the user-facing behavior changes.
- There is no automated test suite; a manual smoke pass (tuner → metronome →
  chords, then both running simultaneously where allowed) is the gate.

## Code style

- Plain ES modules, no imports from a framework.
- Comments explain *why*, not *what* — the code stays readable without them.
- Prefer small functions with one job. The tuner screens are plain DOM, no
  virtual DOM, no build.
