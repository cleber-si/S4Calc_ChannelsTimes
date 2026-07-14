/* sim.js -- the acquisition clock.
 *
 * The simulation runs on REAL wall-clock time (performance.now), scaled by a
 * speed multiplier. Changing the multiplier mid-run does not distort the past:
 * elapsed instrument-seconds are accumulated, not recomputed. At 1x a 5 s
 * exposure takes 5 real seconds, which is the point -- a student should see
 * what they will actually sit through.
 *
 * TIMELINE (Guide 5.4):
 *
 *   acquisition = NCYC cycles
 *   cycle       = NSEQ subcycles + (NSEQ-1)*dt_seq + dt_cyc
 *   subcycle    = one waveplate position (polarimetry) or the whole thing
 *                 (photometry, NSEQ=1). Its length is the CADENCE: the slowest
 *                 channel's sequence. Faster channels finish and idle.
 *   sequence    = NEXP exposures in one channel
 *
 * Channels run in parallel within a subcycle and are re-synchronised at each
 * subcycle boundary (triggering mode "synchronous by cycle").
 */

import { BANDS, seqTime } from "./s4calc.js";

export const PHASE = {
  IDLE: "IDLE",
  EXPOSING: "ACQUIRING",
  READING: "READING OUT",
  WAITING: "WAITING",     // finished early, held at the subcycle boundary
  SEQ_GAP: "SEQ GAP",     // dt_seq, between waveplate positions
  CYC_GAP: "CYCLE GAP",   // dt_cyc, between cycles
  DONE: "DONE",
};

export class Sim {
  constructor() {
    this.cfg = null;
    this.speed = 1;
    this.t = 0;            // instrument seconds since acquisition start
    this.running = false;
    this.finished = false;
    this._last = null;     // performance.now() of the previous frame
    this._raf = null;
    this.onTick = () => {};
  }

  /* Freeze a configuration and precompute the timeline. */
  load(cfg) {
    const { tExp, nexp, tRead, ft, nseq, ncyc, dtSeq, dtCyc } = cfg;

    const walls = {};
    for (const b of BANDS) walls[b] = seqTime(tExp[b], nexp[b], tRead, ft);
    const cadence = Math.max(...BANDS.map((b) => walls[b]));

    const cycle = nseq * cadence + (nseq - 1) * dtSeq + dtCyc;
    const total = ncyc * cycle;

    this.cfg = { ...cfg, walls, cadence, cycle, total };
    this.reset();
  }

  reset() {
    this.t = 0;
    this.running = false;
    this.finished = false;
    this._last = null;
    this.emit();
  }

  start() {
    if (!this.cfg || this.finished) return;
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._loop();
  }

  pause() {
    this.running = false;
    this._last = null;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.emit();
  }

  abort() {
    this.pause();
    this.reset();
  }

  setSpeed(x) {
    // Accumulate elapsed time at the OLD rate before switching, so the past is
    // not retroactively rescaled.
    if (this.running) this._advance(performance.now());
    this.speed = x;
  }

  _advance(now) {
    if (this._last === null) { this._last = now; return; }
    const dtReal = (now - this._last) / 1000;   // real seconds
    this._last = now;
    this.t += dtReal * this.speed;              // instrument seconds
    if (this.t >= this.cfg.total) {
      this.t = this.cfg.total;
      this.running = false;
      this.finished = true;
    }
  }

  _loop() {
    this._raf = requestAnimationFrame((now) => {
      if (!this.running) return;
      this._advance(now);
      this.emit();
      if (this.running) this._loop();
      else this.emit();
    });
  }

  emit() {
    this.onTick(this.state());
  }

  /* Where are we? Derived purely from this.t -- no accumulated state, so
   * scrubbing and speed changes cannot drift. */
  state() {
    if (!this.cfg) return null;
    const c = this.cfg;
    const { nseq, ncyc, cadence, cycle, dtSeq, dtCyc, tExp, nexp, tRead, ft, walls } = c;

    const t = Math.min(this.t, c.total);
    const done = this.finished;

    // --- cycle ---
    let iCyc = Math.floor(t / cycle);
    if (iCyc >= ncyc) iCyc = ncyc - 1;
    const tInCyc = t - iCyc * cycle;

    // --- subcycle (waveplate position) within the cycle ---
    const subLen = cadence + dtSeq;          // last one has no trailing dt_seq
    let iSub = Math.floor(tInCyc / subLen);
    if (iSub >= nseq) iSub = nseq - 1;
    let tInSub = tInCyc - iSub * subLen;

    let inSeqGap = false;
    let inCycGap = false;

    if (tInSub > cadence) {
      // Past the end of this subcycle's exposures. What comes next depends on
      // whether another waveplate position follows: dt_seq if it does, dt_cyc
      // if this was the last one in the cycle.
      if (iSub < nseq - 1) inSeqGap = true;  // waiting on the waveplate
      else inCycGap = true;                  // trailing dt_cyc
    }

    const tInCadence = Math.min(tInSub, cadence);

    // --- per channel ---
    const ch = {};
    for (const b of BANDS) {
      const te = tExp[b];
      const ne = nexp[b];
      const wall = walls[b];

      let phase, expIdx, expFrac, seqFrac;

      if (inCycGap) {
        phase = PHASE.CYC_GAP;
      } else if (inSeqGap) {
        phase = PHASE.SEQ_GAP;
      } else if (tInCadence >= wall) {
        phase = PHASE.WAITING;               // done early, idling
      } else {
        phase = null;                        // resolved below
      }

      // Position inside this channel's own sequence.
      if (tInCadence >= wall) {
        expIdx = ne;                         // all exposures done
        seqFrac = 1;
        expFrac = 1;
      } else {
        seqFrac = tInCadence / wall;
        if (ft) {
          // FT: exposures back to back, 4.4 ms shift between them, and the whole
          // stack read out ONCE at the end -- that trailing t_read is the only
          // readout the observer waits through.
          const step = te + 0.0044;                    // DT_FT
          const tExposing = ne * te + (ne - 1) * 0.0044;
          if (tInCadence >= tExposing) {
            expIdx = ne;
            expFrac = 1;
            if (phase === null) phase = PHASE.READING; // the trailing readout
          } else {
            expIdx = Math.min(Math.floor(tInCadence / step), ne - 1);
            const tInExp = tInCadence - expIdx * step;
            expFrac = Math.min(1, tInExp / te);
            if (phase === null) phase = PHASE.EXPOSING;
            expIdx += 1;
          }
        } else {
          // FT off: every exposure pays a full readout.
          const step = te + tRead;
          expIdx = Math.min(Math.floor(tInCadence / step), ne - 1);
          const tInExp = tInCadence - expIdx * step;
          if (tInExp < te) {
            expFrac = tInExp / te;
            if (phase === null) phase = PHASE.EXPOSING;
          } else {
            expFrac = 1;
            if (phase === null) phase = PHASE.READING;
          }
          expIdx += 1;
        }
      }

      if (done) { phase = PHASE.DONE; seqFrac = 1; expFrac = 1; expIdx = ne; }
      if (!this.running && this.t === 0) {
        phase = PHASE.IDLE; seqFrac = 0; expFrac = 0; expIdx = 0;
      }

      // Frames acquired so far, this channel.
      //
      // FT off: a frame is complete when its own readout ends, so the counter
      // ticks once per (t_exp + t_read) slot.
      //
      // FT on: the exposures are shifted into the storage area back to back and
      // the whole sequence is read out at the end. The frames still exist one
      // per exposure -- the counter ticks per (t_exp + DT_FT) slot -- they are
      // simply not on disk until the trailing readout completes.
      const step = ft ? te + 0.0044 : te + tRead;
      const inSub = tInCadence >= wall
        ? ne                                          // sequence complete
        : Math.min(ne, Math.max(0, Math.floor(tInCadence / step)));
      const framesDone = (iCyc * nseq + iSub) * ne + inSub;

      ch[b] = {
        phase,
        expIdx,                              // 1-based, current exposure
        expFrac,                             // progress within that exposure
        seqFrac,                             // progress through the sequence
        wall,
        idle: cadence - wall,
        frames: Math.max(0, done ? ncyc * nseq * ne : framesDone),
      };
    }

    return {
      t,
      total: c.total,
      running: this.running,
      finished: done,
      speed: this.speed,
      cycle: { i: done ? ncyc : iCyc + 1, n: ncyc, frac: done ? 1 : tInCyc / cycle },
      sub: { i: done ? nseq : iSub + 1, n: nseq, frac: done ? 1 : tInCadence / cadence },
      inSeqGap,
      inCycGap,
      ch,
    };
  }
}
