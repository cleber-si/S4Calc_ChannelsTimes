# S4CALC

Exposure calculator and acquisition simulator for **SPARC4** (OPD/LNA).

Two jobs:

1. **Solve NEXP.** You set the exposure times — they follow from the target, the
   sky, the airmass, the moon, and how close to saturation you are willing to
   sit. The calculator does not argue with them. It finds the number of
   exposures per channel that minimises dead time. NEXP does not change the
   counts in a frame, so it cannot saturate anything: it is the safe knob, and
   it is turned first. A t_exp nudge is offered afterwards, clearly marked as
   optional.

2. **Simulate the run.** The progress bars are the ones you will watch in the
   S4GUI. At 1× the clock is real: a 5 s exposure takes 5 seconds. The
   multiplier scales the clock, not the model.

In polarimetric mode each active waveplate position is one subcycle, up to 16
per cycle.

## Local Run

`python3 -m http.server` and open `localhost:8000` (ES modules need
a server; `file://` will not work).

## Files

| file | what it is |
|---|---|
| `s4calc.js` | The timing model. Pure functions, no DOM — a direct port of `s4calc.py`, so the two can be checked against each other. |
| `sim.js` | The acquisition clock. Derives all state from a single elapsed time, so speed changes cannot make it drift. |
| `app.js` | DOM wiring. |
| `index.html`, `style.css` | The panel. |

## Timing

Constants from the SPARC4 Observer Guide (rev. 21-06-2025), §5.4–5.7.

```
sequence (one channel):
  FT off:  NEXP * (t_exp + t_read)
  FT on :  NEXP * t_exp + (NEXP-1) * 0.0044 + t_read

subcycle = the slowest channel's sequence (the cadence)
cycle    = NSEQ * subcycle + (NSEQ-1) * dt_seq + dt_cyc
run      = NCYC * cycle
```

`dt_seq` / `dt_cyc` are the SPARC4 team's representative values, not exact:
photometry sync 0 / 0.45 s, photometry async 0 / 0.119 s, polarimetry
1.44 / 1.70 s.

The FT-off model is verified on-sky against a stopwatch (AU Mic, 2026-07-13):
(5.0+1.11)×1 = 6.11 s measured 6.1; (1.0+1.11)×3 = 6.33 s measured 6.3;
(0.5+1.11)×4 = 6.44 s measured 6.4.
