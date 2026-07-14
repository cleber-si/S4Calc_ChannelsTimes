/* s4calc.js -- SPARC4 timing model.
 *
 * Pure functions. No DOM. Direct port of s4calc.py / sparc4.py so the two can
 * be checked against each other.
 *
 * Sources: SPARC4 Observer Guide (rev. 21-06-2025), sec. 5.4-5.7.
 */

export const BANDS = ["g", "r", "i", "z"];
export const CH_OF = { g: 1, r: 2, i: 3, z: 4 };

/* ============================================================================
 * ACQUISITION MODES -- Operation_Modes_SPARC4.xlsx (OPD/LNA staff)
 * ============================================================================
 *
 * The staff spreadsheet supersedes the Observer Guide's §5.7 table. The Guide
 * gives read time as a function of READOUT RATE ONLY, and warns that this is
 * "overestimated for subframe acquisitions and/or binning". The spreadsheet is
 * the actual measured table: read time depends on
 *
 *     acquisition mode (rate + preamp)  x  sub-image  x  binning
 *
 * and the spread is large. At 0.1 MHz it runs from 10.93 s (full frame, bin 1)
 * down to 1.24 s (256x256, bin 2) -- a factor of nine. Using the rate alone
 * would overstate the cost of every exposure by up to 9x for a binned observer.
 *
 * Verified against all 84 rows of the sheet:
 *   - FPS == 1 / read_time                       (84/84)
 *   - FT on  : minimum t_exp == read_time        (42/42)
 *   - FT off : minimum t_exp == 1e-5 s           (42/42)
 * so read time is the single governing quantity and the rest follows from it.
 */

export const ACQ_MODES = ["SLOW BRIGHT", "SLOW FAINT", "NORMAL BRIGHT",
                          "NORMAL FAINT", "FAST", "FAST+", "SUPER FAST"];

// Human-readable: what each acquisition mode actually is.
export const ACQ_INFO = {
  "SLOW BRIGHT":   { em: "Conventional", rate: 0.1, preamp: "Gain 1" },
  "SLOW FAINT":    { em: "Conventional", rate: 0.1, preamp: "Gain 2" },
  "NORMAL BRIGHT": { em: "Conventional", rate: 1.0, preamp: "Gain 1" },
  "NORMAL FAINT":  { em: "Conventional", rate: 1.0, preamp: "Gain 2" },
  "FAST":          { em: "EM", rate: 10.0, preamp: "Gain 1", protected: true },
  "FAST+":         { em: "EM", rate: 20.0, preamp: "Gain 1", protected: true },
  "SUPER FAST":    { em: "EM", rate: 30.0, preamp: "Gain 1", protected: true },
};

// Size modes: sub-image + binning + the minimum safe CCD temperature.
export const SIZE_MODES = {
  LARGE_1:  { label: "LARGE 1024×1024 bin 1", fov: "5.6′", pix: "0.3″", tmin: -60 },
  LARGE_2:  { label: "LARGE 1024×1024 bin 2", fov: "5.6′", pix: "0.7″", tmin: -25 },
  MEDIUM_1: { label: "MEDIUM 512×512 bin 1",  fov: "2.8′", pix: "0.3″", tmin: -45 },
  MEDIUM_2: { label: "MEDIUM 512×512 bin 2",  fov: "2.8′", pix: "0.7″", tmin: -25 },
  SMALL_1:  { label: "SMALL 256×256 bin 1",   fov: "1.4′", pix: "0.3″", tmin: -33 },
  SMALL_2:  { label: "SMALL 256×256 bin 2",   fov: "1.4′", pix: "0.7″", tmin: -10 },
};

/* Read time [s] = READ_TIME[acquisition mode][size mode]. Straight from the
 * sheet -- do NOT compute it from pixel counts; the ACS enforces this table. */
export const READ_TIME = {
  "SLOW BRIGHT":   { LARGE_1: 10.93, LARGE_2: 2.97,  MEDIUM_1: 5.53,  MEDIUM_2: 2.14,  SMALL_1: 2.79,  SMALL_2: 1.24 },
  "SLOW FAINT":    { LARGE_1: 10.93, LARGE_2: 2.97,  MEDIUM_1: 5.53,  MEDIUM_2: 2.14,  SMALL_1: 2.79,  SMALL_2: 1.24 },
  "NORMAL BRIGHT": { LARGE_1: 1.11,  LARGE_2: 0.56,  MEDIUM_1: 0.56,  MEDIUM_2: 0.28,  SMALL_1: 0.28,  SMALL_2: 0.14 },
  "NORMAL FAINT":  { LARGE_1: 1.11,  LARGE_2: 0.56,  MEDIUM_1: 0.56,  MEDIUM_2: 0.28,  SMALL_1: 0.28,  SMALL_2: 0.14 },
  "FAST":          { LARGE_1: 0.11,  LARGE_2: 0.057, MEDIUM_1: 0.057, MEDIUM_2: 0.029, SMALL_1: 0.029, SMALL_2: 0.015 },
  "FAST+":         { LARGE_1: 0.057, LARGE_2: 0.029, MEDIUM_1: 0.029, MEDIUM_2: 0.015, SMALL_1: 0.015, SMALL_2: 0.0083 },
  "SUPER FAST":    { LARGE_1: 0.039, LARGE_2: 0.02,  MEDIUM_1: 0.02,  MEDIUM_2: 0.011, SMALL_1: 0.011, SMALL_2: 0.0059 },
};

/* Saturation is NOT a single number. It is set by the preamp gain:
 *   Gain 1 (BRIGHT) -> 30 000 ADU
 *   Gain 2 (FAINT)  -> 60 000 ADU
 *   EM modes        -> 15 000 ADU   <- much lower; easy to overlook
 */
export const SATURATION_ADU = {
  "SLOW BRIGHT": 30000, "SLOW FAINT": 60000,
  "NORMAL BRIGHT": 30000, "NORMAL FAINT": 60000,
  "FAST": 15000, "FAST+": 15000, "SUPER FAST": 15000,
};

/* Read noise [e-] per channel, (g, r, i, z). EM modes are enormously noisier
 * before the EM gain is applied. */
export const READ_NOISE = {
  "SLOW BRIGHT":   { g: 8.87, r: 8.70, i: 8.78, z: 8.43 },
  "SLOW FAINT":    { g: 3.47, r: 3.40, i: 3.46, z: 3.21 },
  "NORMAL BRIGHT": { g: 6.66, r: 6.57, i: 6.67, z: 6.55 },
  "NORMAL FAINT":  { g: 4.82, r: 4.84, i: 4.76, z: 4.65 },
  "FAST":          { g: 77.5, r: 80.0, i: 76.1, z: 78.6 },
  "FAST+":         { g: 141.0, r: 138.0, i: 158.0, z: 148.0 },
  "SUPER FAST":    { g: 197.0, r: 219.0, i: 209.0, z: 188.0 },
};

export function readTime(acq, size) {
  return READ_TIME[acq][size];
}

/* Minimum exposure time the ACS will accept. Confirmed on all 84 rows:
 * with FT on it is exactly the read time; with FT off it is 1e-5 s. */
export const MIN_TEXP_FT_OFF = 1e-5;
export function minTexp(acq, size, ft) {
  return ft ? readTime(acq, size) : MIN_TEXP_FT_OFF;
}

/* Maximum frame rate: the reciprocal of the read time. Holds on all 84 rows. */
export function maxFPS(acq, size) {
  return 1 / readTime(acq, size);
}

export const DT_FT = 0.0044;        // dead time between exposures, FT on
export const MAX_NEXP = 1400;       // Guide 5.5, hard limit
export const MAX_NEXP_SHORT = 200;  // Guide 5.5, recommended when t_exp < 1 s

// Guide 5.7: dead time between sequences and between cycles.
//   "<mode>_<trigger>" -> [dt_seq, dt_cyc]  (seconds)
export const DEAD_TIME = {
  phot_sync: [0.0, 0.45],    // +/- 0.29
  phot_async: [0.0, 0.119],  // +/- 0.005
  polar_sync: [1.44, 1.70],  // +/- 0.03, +/- 0.36
  polar_async: [1.44, 1.70], // not tabulated; assume as sync
};

export function deadTimes(mode, trigger) {
  return DEAD_TIME[`${mode}_${trigger}`] ?? DEAD_TIME.phot_sync;
}

/* Wall-clock time of ONE sequence in ONE channel.
 *
 *   FT ON : NEXP*t_exp + (NEXP-1)*DT_FT + t_read
 *   FT OFF: NEXP*(t_exp + t_read)
 *
 * The FT-off form is verified on-sky (AU Mic, 2026-07-13, stopwatch):
 *   (5.0+1.11)*1 = 6.11 s -> measured 6.1 s
 *   (1.0+1.11)*3 = 6.33 s -> measured 6.3 s
 *   (0.5+1.11)*4 = 6.44 s -> measured 6.4 s
 */
export function seqTime(tExp, nExp, tRead, ft) {
  if (ft) return nExp * tExp + (nExp - 1) * DT_FT + tRead;
  return nExp * (tExp + tRead);
}

/* Choose NEXP per channel to minimise dead time.
 *
 * WITHOUT LOCKS, the anchor is physical: the channel with the LONGEST exposure
 * cannot be subdivided. Its single frame takes what it takes, and that is the
 * shortest sequence in which every channel gets at least one exposure. It sets
 * the floor; the faster channels pack in as many frames as fit underneath.
 *
 * Minimising ABSOLUTE dead time is degenerate -- a 300 s sequence always beats
 * a 6 s one because the fixed spread gets amortised. So the objective is dead
 * time as a FRACTION of the sequence, which is scale-free.
 *
 * WITH LOCKS, the observer has overridden that. A locked channel's NEXP is a
 * given -- maybe the cadence is dictated by the science, maybe a collaborator
 * needs exactly 15 frames -- so its wall time is a hard fact, and the solver's
 * job collapses to a much simpler one: fit everybody else underneath it.
 * The search over candidate ceilings is skipped entirely; the locked wall IS
 * the ceiling. If several channels are locked, the slowest of them wins, since
 * that is the one nobody can finish before.
 *
 *   locks: { g: true, ... } -- channels whose nexp[] must be taken as given
 */
export function solveNexp(tExp, tRead, ft, nexp = null, locks = null) {
  const locked = BANDS.filter((b) => locks?.[b] && nexp?.[b] >= 1);

  if (locked.length) {
    // The ceiling is the slowest locked channel. Everyone else packs under it.
    const ceiling = Math.max(
      ...locked.map((b) => seqTime(tExp[b], nexp[b], tRead, ft))
    );

    const out = {};
    for (const b of BANDS) {
      if (locks?.[b] && nexp?.[b] >= 1) {
        out[b] = nexp[b];                       // untouched, by definition
        continue;
      }
      // Largest n whose wall still fits inside the ceiling. Never overshoot:
      // overshooting would push the cadence out past the lock, which would make
      // the locked channel idle -- the opposite of what the lock is asking for.
      let n = 1;
      while (n < MAX_NEXP && seqTime(tExp[b], n + 1, tRead, ft) <= ceiling + 1e-9) n++;
      out[b] = n;
    }

    const walls = {};
    for (const b of BANDS) walls[b] = seqTime(tExp[b], out[b], tRead, ft);
    return { nexp: out, walls, cadence: Math.max(...BANDS.map((b) => walls[b])) };
  }

  // --- no locks: the original search ---
  const anchor = Math.max(...BANDS.map((b) => seqTime(tExp[b], 1, tRead, ft)));

  const ceilings = new Set([anchor]);
  for (const b of BANDS) {
    for (let n = 1; n <= MAX_NEXP; n++) {
      const w = seqTime(tExp[b], n, tRead, ft);
      if (w > anchor * 1.35) break;
      if (w >= anchor * 0.98) ceilings.add(Number(w.toFixed(6)));
    }
  }

  let best = null;
  for (const ceiling of [...ceilings].sort((a, b) => a - b)) {
    const out = {};
    for (const b of BANDS) {
      let n = 1;
      while (n < MAX_NEXP && seqTime(tExp[b], n + 1, tRead, ft) <= ceiling + 1e-9) n++;
      out[b] = n;
    }
    const walls = {};
    for (const b of BANDS) walls[b] = seqTime(tExp[b], out[b], tRead, ft);
    const cadence = Math.max(...BANDS.map((b) => walls[b]));
    const dead = BANDS.reduce((s, b) => s + (cadence - walls[b]), 0);
    const key = [Number((dead / cadence).toFixed(5)), cadence];
    if (best === null || key[0] < best.key[0] ||
        (key[0] === best.key[0] && key[1] < best.key[1])) {
      best = { key, nexp: out, walls, cadence };
    }
  }
  return { nexp: best.nexp, walls: best.walls, cadence: best.cadence };
}

/* With the cadence fixed, what exposure time exactly fills one channel's slot
 * at a given NEXP? Invert seqTime for t_exp. */
export function fillTexp(n, tRead, ft, cadence) {
  const t = ft
    ? (cadence - tRead - (n - 1) * DT_FT) / n
    : cadence / n - tRead;
  return t;
}

/* Options for closing the leftover gap in each channel.
 *
 * The cadence is set by the gating channel and is not up for negotiation here.
 * Everyone else has slack. There is more than one way to spend it, and the
 * choice belongs to the observer:
 *
 *   NEXP - 1 : fewer, longer frames. Better SNR per frame, worse time
 *              resolution, and it moves you TOWARDS saturation.
 *   NEXP     : same frames, each stretched to fill the slot.
 *   NEXP + 1 : more, shorter frames. Finer time resolution, and it moves you
 *              AWAY from saturation -- often the safe direction.
 *
 * Each option is reported with the t_exp that would exactly fill the cadence,
 * so all of them are dead-time-free by construction. Options needing a t_exp
 * below the instrument minimum are dropped.
 *
 * Returns { band: [ {nexp, tExp, dTexp, integ, dInteg, current, saturation} ] }
 */
export function suggestOptions(tExp, nexp, tRead, ft, cadence, locks = null) {
  const out = {};

  for (const b of BANDS) {
    // A locked channel is not up for negotiation. Offering to change its NEXP
    // would quietly undo the thing the observer just asked us to hold fixed.
    if (locks?.[b]) continue;

    const n0 = nexp[b];
    const t0 = tExp[b];
    const integ0 = t0 * n0;
    const opts = [];

    for (const n of [n0 - 1, n0, n0 + 1]) {
      if (n < 1 || n > MAX_NEXP) continue;

      const t = fillTexp(n, tRead, ft, cadence);
      if (t <= 0) continue;
      // The instrument's floor: read time with FT on, 1e-5 s with it off.
      if (ft && t < tRead - 1e-9) continue;
      if (!ft && t < 1e-5) continue;

      const tR = Number(t.toFixed(2));
      const integ = tR * n;

      // Does a single frame get brighter or darker than what you set? That is
      // the only thing that bears on saturation.
      const saturation =
        tR > t0 + 0.005 ? "up" : tR < t0 - 0.005 ? "down" : "same";

      opts.push({
        nexp: n,
        tExp: tR,
        dTexp: tR - t0,
        integ,
        dInteg: integ - integ0,
        current: n === n0 && Math.abs(tR - t0) < 0.005,
        saturation,
      });
    }

    // Only worth showing if something actually differs from what is set.
    if (opts.some((o) => !o.current)) out[b] = opts;
  }
  return out;
}

/* Kept for parity with s4calc.py: the same-NEXP suggestion only. */
export function suggestTexp(tExp, nexp, tRead, ft, cadence) {
  const out = {};
  for (const b of BANDS) {
    const r = Number(fillTexp(nexp[b], tRead, ft, cadence).toFixed(2));
    if (r > tExp[b] + 0.005) out[b] = r;
  }
  return out;
}

/* Full acquisition summary.
 *
 * Guide 5.4: total images = NCYC * NSEQ * NEXP, with NCYC and NSEQ global and
 * NEXP / t_exp per channel. NSEQ = 1 in photometry, = number of active
 * waveplate positions in polarimetry (each position is a subcycle).
 *
 * Cycle time for one channel:
 *   NSEQ * seq + (NSEQ-1)*dt_seq + dt_cyc
 * The channels run in parallel, so the cycle is set by the slowest.
 */
export function acquisition(cfg) {
  const { tExp, nexp, tRead, ft, mode, trigger, ncyc, nseq } = cfg;
  const [dtSeq, dtCyc] = deadTimes(mode, trigger);

  const walls = {};
  for (const b of BANDS) walls[b] = seqTime(tExp[b], nexp[b], tRead, ft);
  const cadence = Math.max(...BANDS.map((b) => walls[b]));  // one subcycle

  const cycle = nseq * cadence + (nseq - 1) * dtSeq + dtCyc;
  const total = ncyc * cycle;

  const perCh = {};
  for (const b of BANDS) {
    const integ = tExp[b] * nexp[b];
    perCh[b] = {
      tExp: tExp[b],
      nexp: nexp[b],
      integ,
      wall: walls[b],
      idle: cadence - walls[b],
      duty: integ / walls[b],
      frames: ncyc * nseq * nexp[b],
      totalInteg: ncyc * nseq * integ,
    };
  }

  const deadPerSeq = BANDS.reduce((s, b) => s + (cadence - walls[b]), 0);
  const gate = BANDS.reduce((a, b) => (walls[b] > walls[a] ? b : a));

  // Open-shutter fraction over the whole run, averaged across the 4 channels.
  const openFrac =
    BANDS.reduce((s, b) => s + perCh[b].totalInteg, 0) / (4 * total);

  return {
    perCh, cadence, cycle, total, gate, deadPerSeq, openFrac,
    dtSeq, dtCyc, nseq, ncyc,
  };
}

/* Guide 5.5: the camera buffer caps frames per sequence by sub-image + binning.
 *
 * Note: every one of these is ABOVE the 1400-per-sequence hard cap, so in
 * practice the hard cap always binds first and this check never fires. It is
 * kept because the two limits come from different places (buffer size vs. the
 * ACS's own ceiling) and either could move independently in a future revision.
 */
export const MAX_FRAMES_BUFFER = {
  LARGE_1: 1500, LARGE_2: 5500,
  MEDIUM_1: 5500, MEDIUM_2: 22500,
  SMALL_1: 22500, SMALL_2: 91500,
};

/* Instrument limits. Returns a list of warnings. */
export function checkLimits(cfg) {
  const { tExp, nexp, ft, acq, size } = cfg;
  const tRead = readTime(acq, size);
  const tMin = minTexp(acq, size, ft);
  const buf = MAX_FRAMES_BUFFER[size];
  const out = [];

  for (const b of BANDS) {
    if (tExp[b] < tMin - 1e-9) {
      out.push({
        level: "error", band: b,
        msg: ft
          ? `${b}: t_exp ${tExp[b]} s is below the ${tRead} s frame-transfer minimum for ` +
            `${acq} / ${SIZE_MODES[size].label}. S4ACS will reject the acquisition.`
          : `${b}: t_exp ${tExp[b]} s is below the 1e-5 s minimum.`,
      });
    }
    if (nexp[b] > MAX_NEXP) {
      out.push({
        level: "error", band: b,
        msg: `${b}: NEXP ${nexp[b]} exceeds the hard limit of ${MAX_NEXP} (Guide 5.5).`,
      });
    } else if (nexp[b] > buf) {
      out.push({
        level: "error", band: b,
        msg: `${b}: NEXP ${nexp[b]} exceeds the ${buf}-frame camera buffer for ` +
             `${SIZE_MODES[size].label}. S4ACS will reject it.`,
      });
    } else if (tExp[b] < 1.0 && nexp[b] > MAX_NEXP_SHORT) {
      out.push({
        level: "warn", band: b,
        msg: `${b}: NEXP ${nexp[b]} with t_exp under 1 s. Guide 5.5 recommends at most ` +
             `${MAX_NEXP_SHORT} per sequence — use more cycles instead.`,
      });
    }
  }
  return out;
}

export function fmtDuration(s) {
  if (!isFinite(s)) return "--";
  if (s < 60) return `${s.toFixed(2)} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m ${sec.toFixed(0).padStart(2, "0")}s`;
  return `${m}m ${sec.toFixed(1).padStart(4, "0")}s`;
}
