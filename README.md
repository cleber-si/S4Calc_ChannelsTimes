# S4CALC

Exposure calculator and acquisition simulator for **SPARC4** (OPD/LNA).

Two jobs:

1. **Solve NEXP.** You set the exposure times — they follow from the target, the
   sky, the airmass, the moon, and how close to saturation you are willing to
   sit. The calculator does not argue with them. It finds the number of
   exposures per channel that minimises dead time. NEXP does not change the
   counts in a frame, so it cannot saturate anything: it is the safe knob, and
   it is turned first. A t_exp nudge is offered afterwards, clearly marked as
   optional — and it offers the neighbouring NEXP values too, so you can
   choose between fewer/longer frames and more/shorter ones. Every option
   listed reaches zero dead time; they differ only in what they do to
   saturation.

   Any channel's NEXP can be **locked**. A lock says *this number is not
   negotiable* — the science needs 15 frames, or a fixed cadence. The solver
   then stops choosing an anchor for itself and fits every other channel under
   the locked channel's wall time. Lock g at 15 x 3 s and r/i/z at 0.3 s will
   come back with 43 each; the options table will then offer 44 at a slightly
   trimmed exposure, which fills the locked cadence exactly.

   The "closing the gap" options appear for hand-entered NEXP too, not just
   solved ones — a manual NEXP has slack like any other.

2. **Simulate the run.** The progress bars are the ones you will watch in the
   S4GUI. At 1× the clock is real: a 5 s exposure takes 5 seconds. The
   multiplier (up to 120×) scales the clock, not the model.

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

## Solving with locks

The solver minimises dead time as a *fraction* of the cadence. A locked channel
fixes its own NEXP but **not** the cadence: if rounding the fast channels up —
pushing the cadence slightly past the locked channel, so it waits a little —
lowers total dead time, the solver does that. Example: photometric, FT on, g
locked at 15×60 s with r=10 s, i=z=12 s gives **90/75/75**, worst-wait 0.33 s,
not the 89/74/74 (worst-wait 11.7 s) you get from fitting strictly underneath.
A lock pins a number, not a ceiling.

## Frame transfer intent

The FT toggle records what you *want*. FT only engages when every exposure is at
least the read time; below that it stays off and warns, rather than silently
flipping the toggle back. Raise the exposures and it engages on its own.

## Where the numbers come from

Acquisition modes, read times, saturation limits and read noise are taken from
**`Operation_Modes_SPARC4.xlsx`** (OPD/LNA staff), not from the Observer Guide.
The Guide's §5.7 table gives read time as a function of readout rate alone and
warns it is *"overestimated for subframe acquisitions and/or binning"*. The
staff spreadsheet is the real table: read time depends on

    acquisition mode (rate + preamp)  x  sub-image  x  binning

and the spread matters — at 0.1 MHz it runs from 10.93 s (full frame, bin 1)
down to 1.24 s (256x256, bin 2), a factor of nine.

Checked against all 84 rows of that sheet:

| check | result |
|---|---|
| `max FPS == 1 / read_time` | 84/84 |
| FT on: `min t_exp == read_time` | 42/42 |
| FT off: `min t_exp == 1e-5 s` | 42/42 |
| read noise vs the ETC spreadsheet | identical for all conventional modes |

Saturation is **not** a single value: 30 000 ADU for the BRIGHT (gain 1) modes,
60 000 for FAINT (gain 2), and only **15 000** for every EM mode.

The 1400-frames-per-sequence cap (Guide 5.5) is below every camera-buffer limit,
so it is always the binding constraint.

## Timing

Cadence and dead times from the SPARC4 Observer Guide (rev. 21-06-2025), §5.4–5.7.

```
read_time = READ_TIME[acquisition mode][size mode]     <- the staff table

sequence (one channel):
  FT off:  NEXP * (t_exp + read_time)
  FT on :  NEXP * t_exp + (NEXP-1) * 0.0044 + read_time

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
