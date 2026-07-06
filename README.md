# Physica

A collection of 64 interactive physics simulators, built as polished single-file HTML/Canvas apps — no frameworks, no build step, no dependencies beyond Google Fonts.

**Live site:** open `index.html`, or visit the GitHub Pages deployment.

## Fields

| Field | Page | Experiments |
|---|---|---|
| Mechanical | `mechanics.html` | 24 |
| Electromagnetism | `electromagnetism.html` | 11 |
| Optical | `optics.html` | 10 |
| Thermal | `thermal.html` | 9 (+ heat-transfer overview) |
| Modern | `modern.html` | 6 |
| Fluid | `fluids.html` | 4 |

## Highlights

- Real physics: verified numerics (AGM pendulum period, Boris pusher, Cauchy dispersion, N-slit interference, Maxwell-Boltzmann 2D, stochastic radioactive decay), not canned animations.
- Every simulator: interactive sliders with paired number inputs, live stats, a dynamic verdict line, an "About this experiment" explainer with equations, and a slow-motion toggle (1× / 0.5× / 0.25× / 0.1×).
- Glass-morphic dark UI with per-field accent colors; DPR-aware canvas rendering.

## Running locally

No server needed — clone and open `index.html` in any modern browser.

```
git clone https://github.com/<user>/physica.git
```

## Structure

- `index.html` — hub linking all six fields
- `mechanics.html`, `thermal.html`, `electromagnetism.html`, `optics.html`, `modern.html`, `fluids.html` — field landing pages
- `*_simulator.html` and friends — the individual experiments (one self-contained file each)
