/* s4calc.js -- SPARC4 timing model.
 *
 * Pure functions. No DOM. Direct port of s4calc.py / sparc4.py so the two can
 * be checked against each other.
 *
 * Sources: SPARC4 Observer Guide (rev. 21-06-2025), sec. 5.4-5.7.
 */

export const BANDS = ["g", "r", "i", "z"];
export const CH_OF = { g: 1, r: 2, i: 3, z: 4 };

// Guide 5.7: read time == minimum t_exp with frame transfer, set by readout
// rate alone.
export const READ_TIME = {
  0.1: 10.93,   // conventional
  1.0: 1.11,    // conventional  <- the common default
  10.0: 0.11,   // EM
  20.0: 0.057,  // EM
  30.0: 0.039,  // EM
};

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
 * The anchor is physical: the channel with the LONGEST exposure cannot be
 * subdivided. Its single frame takes what it takes, and that is the shortest
 * sequence in which every channel gets at least one exposure. It sets the
 * floor; the faster channels pack in as many frames as fit underneath.
 *
 * Minimising ABSOLUTE dead time is degenerate -- a 300 s sequence always beats
 * a 6 s one because the fixed spread gets amortised. So the objective is dead
 * time as a FRACTION of the sequence, which is scale-free.
 */
export function solveNexp(tExp, tRead, ft) {
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
    const nexp = {};
    for (const b of BANDS) {
      let n = 1;
      while (n < MAX_NEXP && seqTime(tExp[b], n + 1, tRead, ft) <= ceiling + 1e-9) n++;
      nexp[b] = n;
    }
    const walls = {};
    for (const b of BANDS) walls[b] = seqTime(tExp[b], nexp[b], tRead, ft);
    const cadence = Math.max(...BANDS.map((b) => walls[b]));
    const dead = BANDS.reduce((s, b) => s + (cadence - walls[b]), 0);
    const key = [Number((dead / cadence).toFixed(5)), cadence];
    if (best === null || key[0] < best.key[0] ||
        (key[0] === best.key[0] && key[1] < best.key[1])) {
      best = { key, nexp, walls, cadence };
    }
  }
  return { nexp: best.nexp, walls: best.walls, cadence: best.cadence };
}

/* With NEXP already fixed: the t_exp that would exactly fill the leftover gap.
 * Optional, second-order, and it DOES move you relative to saturation. */
export function suggestTexp(tExp, nexp, tRead, ft, cadence) {
  const out = {};
  for (const b of BANDS) {
    const n = nexp[b];
    const tNew = ft
      ? (cadence - tRead - (n - 1) * DT_FT) / n
      : cadence / n - tRead;
    const r = Number(tNew.toFixed(2));
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

/* Instrument limits (Guide 5.5). Returns a list of warnings. */
export function checkLimits(cfg) {
  const { tExp, nexp, tRead, ft } = cfg;
  const out = [];
  for (const b of BANDS) {
    if (ft && tExp[b] < tRead - 1e-9) {
      out.push({
        level: "error", band: b,
        msg: `${b}: t_exp ${tExp[b]} s is below the ${tRead} s FT minimum. S4ACS will reject the acquisition.`,
      });
    }
    if (!ft && tExp[b] < 1e-5) {
      out.push({ level: "error", band: b, msg: `${b}: t_exp below the 1e-5 s minimum.` });
    }
    if (nexp[b] > MAX_NEXP) {
      out.push({
        level: "error", band: b,
        msg: `${b}: NEXP ${nexp[b]} exceeds the hard limit of ${MAX_NEXP}.`,
      });
    } else if (tExp[b] < 1.0 && nexp[b] > MAX_NEXP_SHORT) {
      out.push({
        level: "warn", band: b,
        msg: `${b}: NEXP ${nexp[b]} with t_exp < 1 s. Guide 5.5 recommends at most ${MAX_NEXP_SHORT}; use more cycles instead.`,
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
