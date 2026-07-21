/* app.js -- DOM wiring. All physics lives in s4calc.js, all timing in sim.js. */

import {
  BANDS, CH_OF, READ_TIME, DT_FT, MAX_NEXP,
  solveNexp, suggestOptions, acquisition, checkLimits, seqTime,
  deadTimes, fmtDuration, readTime, minTexp, maxFPS,
  ACQ_INFO, SIZE_MODES, SATURATION_ADU, READ_NOISE,
  MAX_FRAMES_BUFFER,
} from "./s4calc.js";
import { Sim, PHASE } from "./sim.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const BAND_NAME = { g: "g (Sloan g′)", r: "r (Sloan r′)", i: "i (Sloan i′)", z: "z (Sloan z′)" };

/* ---------------- state ---------------- */
const S = {
  acq: "NORMAL FAINT",       // the common default
  size: "LARGE_1",           // full frame, no binning
  ftWanted: false,           // observer's frame-transfer INTENT
  mode: "phot",
  trigger: "sync",
  ncyc: 1,
  wp: Array(16).fill(true),      // active waveplate positions
  tExp: { g: 1.0, r: 1.0, i: 1.0, z: 1.0 },   // a neutral starting point
  nexp: { g: 1, r: 1, i: 1, z: 1 },
  lock: { g: false, r: false, i: false, z: false },  // NEXP held fixed by the observer
  manual: false,
};

const sim = new Sim();

/* ---------------- derived ---------------- */
const tRead = () => readTime(S.acq, S.size);
const anyLocked = () => BANDS.some((b) => S.lock[b]);
// FT is only actually engaged if the observer wants it AND every exposure is at
// least the read time. Below that the instrument cannot frame-transfer.
const ftBlocked = () => S.ftWanted && BANDS.some((b) => S.tExp[b] < tRead() - 1e-9);
const ftActive = () => S.ftWanted && !ftBlocked();
const nseq = () => (S.mode === "polar" ? Math.max(1, S.wp.filter(Boolean).length) : 1);

function cfg() {
  const [dtSeq, dtCyc] = deadTimes(S.mode, S.trigger);
  return {
    tExp: S.tExp, nexp: S.nexp, tRead: tRead(), ft: ftActive(),
    acq: S.acq, size: S.size,
    mode: S.mode, trigger: S.trigger,
    ncyc: S.ncyc, nseq: nseq(), dtSeq, dtCyc,
  };
}

/* ---------------- build the channel cards ---------------- */
function buildInputs() {
  $("#texp").innerHTML = BANDS.map((b) => `
    <div class="ch sunken" data-b="${b}">
      <h3><span class="band">CH${CH_OF[b]}</span> ${BAND_NAME[b]}</h3>
      <div>
        <div class="k" style="font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">
          Exposure time (s)
        </div>
        <input type="number" class="sunken" data-t="${b}" min="0" step="0.01"
               value="${S.tExp[b]}" aria-label="${b} exposure time seconds">
      </div>
      <div>
        <div class="k lockrow">
          <span>NEXP <span class="srcflag" id="nexp-src-${b}"></span></span>
          <label class="lockbox" title="Hold this channel's NEXP fixed and fit the others under it">
            <input type="checkbox" data-lock="${b}">
            <span>lock</span>
          </label>
        </div>
        <input type="number" class="sunken" data-n="${b}" min="1" max="${MAX_NEXP}" step="1"
               value="${S.nexp[b]}" disabled aria-label="${b} number of exposures">
      </div>
      <div class="duty" data-info="${b}">&nbsp;</div>
    </div>`).join("");

  $("#mon").innerHTML = BANDS.map((b) => `
    <div class="ch sunken" data-m="${b}">
      <h3><span class="band">CH${CH_OF[b]}</span> ${b}<span class="led" data-led="${b}"></span></h3>
      <div class="status" data-st="${b}">IDLE</div>
      <div class="temprow">
        <span class="led" data-templed="${b}"></span>
        <span class="k">CCD</span>
        <span class="tempval" data-temp="${b}">—</span>
        <span class="k">target</span>
        <span class="tempval" data-ttgt="${b}">—</span>
      </div>
      <div class="bar thin sunken" data-exp="${b}"><span class="fill"></span><span class="txt">—</span></div>
      <div class="bar thin sunken" data-seq="${b}"><span class="fill"></span><span class="txt">—</span></div>
      <div class="row">
        <div class="cell">
          <div class="k">Exposure</div>
          <div class="num sunken" data-eix="${b}">0 / 0</div>
        </div>
        <div class="cell">
          <div class="k">Frames</div>
          <div class="num sunken hi" data-fr="${b}">0</div>
        </div>
      </div>
      <div class="duty" data-idle="${b}">&nbsp;</div>
    </div>`).join("");
}

function buildWP() {
  $("#wpgrid").innerHTML = S.wp.map((_, i) =>
    `<button type="button" data-wp-i="${i}" aria-pressed="true">${i + 1}</button>`
  ).join("");
}

/* ---------------- rendering ---------------- */
function setBar(el, frac, text, ghost = false) {
  el.querySelector(".fill").style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  el.querySelector(".txt").textContent = text;
  el.classList.toggle("ghost", ghost);
}

function renderSetup() {
  const tr = tRead();
  const info = ACQ_INFO[S.acq];
  const sz = SIZE_MODES[S.size];
  const sat = SATURATION_ADU[S.acq];

  $("#tread").textContent = `${tr} s   (max ${maxFPS(S.acq, S.size).toFixed(2)} fps)`;
  $("#tmin").textContent =
    `${ftActive() ? `${tr} s` : "1e-5 s"}  ·  ${sat.toLocaleString()} ADU`;

  // Keep the FT toggle showing the observer's intent, but reflect whether it is
  // actually engaged.
  $$("#ft button").forEach((x) =>
    x.classList.toggle("on", x.dataset.v === (S.ftWanted ? "1" : "0")));
  $("#ft").classList.toggle("blocked", ftBlocked());

  const isPolar = S.mode === "polar";
  $("#wpframe").classList.toggle("inert", !isPolar);
  $("#wpgrid").classList.toggle("off", !isPolar);
  $$("#wpgrid button, #wave button, .wp-row .mini").forEach((b) => (b.disabled = !isPolar));

  const n = S.wp.filter(Boolean).length;
  $("#wpcount").textContent = isPolar
    ? `${n} position${n === 1 ? "" : "s"} → NSEQ = ${n}`
    : "photometry → NSEQ = 1, no waveplate";

  // "on" = armed (dark green). "cur" (bright green) is applied by renderSim,
  // and only while the acquisition is actually running.
  $$("#wpgrid button").forEach((btn, i) => {
    btn.classList.toggle("on", S.wp[i]);
    btn.setAttribute("aria-pressed", String(S.wp[i]));
    btn.title = S.wp[i]
      ? `Position ${i + 1}: in the sequence`
      : `Position ${i + 1}: skipped`;
  });

  const note = $("#ftnote");
  const rn = READ_NOISE[S.acq];
  const base =
    `${info.em}, ${info.rate} MHz, ${info.preamp} · ${sz.label} · CCD at ${sz.tmin} °C or below · ` +
    `read noise g ${rn.g} / r ${rn.r} / i ${rn.i} / z ${rn.z} e⁻. `;

  note.textContent = base + (ftBlocked()
    ? `Frame transfer requested but NOT engaged: ` +
      BANDS.filter((b) => S.tExp[b] < tRead() - 1e-9).join(", ") +
      ` ${BANDS.filter((b) => S.tExp[b] < tRead() - 1e-9).length === 1 ? "is" : "are"} below ` +
      `the ${tr} s read time. Raise those exposures to ${tr} s or larger, or turn FT off.`
    : ftActive()
    ? `Frame transfer on: every exposure must be at least the ${tr} s read time, and the ` +
      `dead time between exposures drops to ${DT_FT} s.`
    : `Frame transfer off: every exposure pays a full ${tr} s readout.`);

  // CCD target temperature is set by the size mode (binning raises the safe
  // minimum). Reflect it on the monitor cards even before a run starts.
  for (const b of BANDS) {
    const tgt = SIZE_MODES[S.size].tmin;
    $(`[data-ttgt="${b}"]`).textContent = `${tgt} °C`;
    // At rest, assume the detector is already parked at target (green).
    if (!sim.running) {
      $(`[data-temp="${b}"]`).textContent = `${tgt} °C`;
      $(`[data-templed="${b}"]`).className = "led on";
    }
  }
}

function renderResult() {
  const c = cfg();
  const a = acquisition(c);

  // per-channel info under the inputs
  for (const b of BANDS) {
    const p = a.perCh[b];
    const el = $(`[data-info="${b}"]`);
    el.textContent =
      `wall ${p.wall.toFixed(2)} s · idle ${p.idle.toFixed(2)} s · ` +
      `duty ${(p.duty * 100).toFixed(0)}% · ${p.frames} frames`;

    const flag = $(`#nexp-src-${b}`);
    const src = S.lock[b] ? "LOCKED" : S.manual ? "MANUAL" : "SOLVED";
    flag.textContent = `— ${src}`;
    flag.className = "srcflag " + src.toLowerCase();

    // A locked channel is always typeable: the lock is HOW you set it. An
    // unlocked one is typeable only in manual mode.
    const nIn = $(`#texp [data-n="${b}"]`);
    nIn.disabled = !(S.lock[b] || S.manual);
    nIn.classList.toggle("locked", S.lock[b]);
    $(`[data-lock="${b}"]`).checked = S.lock[b];
    $(`[data-b="${b}"]`).classList.toggle("islocked", S.lock[b]);
  }

  $("#s-cad").textContent = fmtDuration(a.cadence);
  $("#s-cyc").textContent = fmtDuration(a.cycle);
  $("#s-tot").textContent = fmtDuration(a.total);
  $("#s-duty").textContent = `${(a.openFrac * 100).toFixed(0)}%`;

  // frame counts
  $("#s-fsub").textContent = a.framesPerSubcycle.toLocaleString();
  $("#s-fcyc").textContent = a.framesPerCycle.toLocaleString();
  $("#s-ftot").textContent = a.framesTotal.toLocaleString();

  // Rough data volume. Each frame is (rows*cols/bin^2) px x 2 bytes, x4 channels
  // already counted in the frame totals (framesTotal sums all four channels).
  const px = { LARGE: 1024 * 1024, MEDIUM: 512 * 512, SMALL: 256 * 256 };
  const szKey = S.size.split("_")[0];
  const binsq = S.size.endsWith("_2") ? 4 : 1;
  const bytesPerFrame = (px[szKey] / binsq) * 2;   // 16-bit
  const gb = (a.framesTotal * bytesPerFrame) / 1e9;
  $("#s-vol").textContent = gb >= 1 ? `${gb.toFixed(1)} GB` : `${(gb * 1000).toFixed(0)} MB`;

  // frame breakdown, spelled out for both modes
  const perChSub = BANDS.map((b) => `${b} ${a.framesSubPerCh[b]}`).join(" · ");
  $("#framenote").textContent = S.nseq > 1
    ? `Per subcycle (one waveplate position): ${a.framesPerSubcycle} frames across the four ` +
      `channels (${perChSub}). ${a.nseq} positions → ${a.framesPerCycle} per cycle. ` +
      `× ${a.ncyc} cycle${a.ncyc === 1 ? "" : "s"} → ${a.framesTotal.toLocaleString()} total.`
    : `Photometry, so one subcycle per cycle: ${a.framesPerCycle} frames per cycle across the ` +
      `four channels (${perChSub}). × ${a.ncyc} cycle${a.ncyc === 1 ? "" : "s"} → ` +
      `${a.framesTotal.toLocaleString()} total.`;

  $("#gatenote").textContent =
    `Cadence is set by ${a.gate} (${a.perCh[a.gate].wall.toFixed(2)} s). ` +
    `${a.deadPerSeq.toFixed(2)} s of channel idle per subcycle; the worst channel waits ` +
    `${(a.cadence - Math.min(...BANDS.map((b) => a.perCh[b].wall))).toFixed(2)} s.`;

  // buffer table (rendered once, highlighting the active size mode)
  renderBufferTable();

  // messages
  const msgs = [];
  for (const m of checkLimits(c)) {
    msgs.push(`<div class="msg ${m.level === "error" ? "err" : "warn"}">${m.msg}</div>`);
  }
  if (ftBlocked()) {
    const short = BANDS.filter((b) => S.tExp[b] < tRead() - 1e-9);
    msgs.push(
      `<div class="msg warn">Frame transfer is on but cannot engage: ${short.join(", ")} ` +
      `${short.length === 1 ? "is" : "are"} below the ${tRead()} s read time for ${S.acq} / ` +
      `${SIZE_MODES[S.size].label}. Running FT-off until raised. A smaller size mode or ` +
      `binning would lower the read time.</div>`
    );
  }
  $("#msgs").innerHTML = msgs.join("");

  // ---- step 2: how to spend the leftover slack ----
  // Shown for BOTH solved and manual NEXP. A hand-entered NEXP has slack just
  // like a solved one does, and the observer has no less right to see it.
  const optBox = $("#opts");
  if (a.deadPerSeq <= 0.25) {
    optBox.innerHTML = `<p class="note">Dead time is already small
      (${a.deadPerSeq.toFixed(2)} s per subcycle across all four channels).
      Nothing else worth doing.</p>`;
  } else {
    const opts = suggestOptions(S.tExp, S.nexp, tRead(), ftActive(), a.cadence, S.lock);
    const rows = [];
    for (const b of BANDS) {
      if (!opts[b]) continue;
      opts[b].forEach((o, k) => {
        const sat =
          o.saturation === "up"
            ? `<span class="sat up">↑ brighter frames</span>`
            : o.saturation === "down"
            ? `<span class="sat down">↓ darker frames</span>`
            : `<span class="sat same">unchanged</span>`;
        // first row of each channel gets a rule above it, so the 2-3 options
        // for one band read as a group rather than as one long list
        const cls = [o.current ? "cur" : "", k === 0 && rows.length ? "group" : ""]
          .filter(Boolean).join(" ");
        rows.push(`
          <tr class="${cls}">
            <td class="bcell">${k === 0 ? `<b>${b}</b>` : ""}</td>
            <td class="num">${o.tExp.toFixed(2)}</td>
            <td class="num">${o.nexp}</td>
            <td class="num">${o.integ.toFixed(2)}</td>
            <td class="num ${o.dInteg > 0.005 ? "pos" : o.dInteg < -0.005 ? "neg" : ""}">${
              o.dInteg >= 0 ? "+" : "−"}${Math.abs(o.dInteg).toFixed(2)}</td>
            <td class="scell">${sat}</td>
            <td class="acell">${
              o.current
                ? `<span class="curtag">set now</span>`
                : `<button type="button" class="mini raised" data-apply="${b}"
                     data-opt-t="${o.tExp}" data-opt-n="${o.nexp}">Use</button>`
            }</td>
          </tr>`);
      });
    }

    optBox.innerHTML = rows.length
      ? `<p class="note">
           The cadence is <b>${a.cadence.toFixed(2)} s</b>, set by <b>${a.gate}</b>${
             anyLocked() ? ` (locked)` : ``
           }. Every other channel has slack. Each row below fills that slack exactly — they all
           reach zero dead time — so the choice is only about what you want from the frames.
           <b>Fewer, longer frames</b> give better SNR per frame but push towards saturation;
           <b>more, shorter frames</b> give finer time resolution and pull away from it.
           NEXP is safe. Changing t_exp is not — only you know the counts.${
             anyLocked()
               ? ` Locked channels are not listed: holding them fixed is the whole point.`
               : ``
           }
         </p>
         <table class="opts">
           <thead><tr>
             <th class="b">Ch</th>
             <th class="n">t_exp (s)</th>
             <th class="n">NEXP</th>
             <th class="n" title="t_exp × NEXP — shutter-open time per subcycle">Open (s)</th>
             <th class="n">vs now</th>
             <th class="s">Saturation</th>
             <th class="a"></th>
           </tr></thead>
           <tbody>${rows.join("")}</tbody>
         </table>`
      : `<p class="note">No option closes the gap within the instrument's limits.</p>`;
  }

  // hand the frozen config to the simulator
  sim.load(c);
}

function renderSim(st) {
  if (!st) return;

  const pct = st.total > 0 ? st.t / st.total : 0;
  setBar($("#b-elapsed"), pct,
    `Elapsed ${fmtDuration(st.t)} / ${fmtDuration(st.total)}  (${(pct * 100).toFixed(1)}%)`);

  setBar($("#b-cycle"), st.cycle.frac,
    `#Cycles Done ${st.finished ? st.cycle.n : st.cycle.i - 1} / ${st.cycle.n}`);

  const subLabel = S.mode === "polar" ? "#Pol. Seq. Done" : "#Sequences Done";
  setBar($("#b-sub"), st.sub.frac,
    `${subLabel} ${st.finished ? st.sub.n : st.sub.i - 1} / ${st.sub.n}` +
    (S.mode === "polar" ? `   ·   WP position ${st.sub.i}` : ""),
    st.inSeqGap || st.inCycGap);

  // Light the waveplate position the instrument is actually sitting at. During
  // the 1.44 s inter-sequence gap the plate is in transit between positions, so
  // nothing is lit -- that gap is exactly what the observer is waiting through.
  if (S.mode === "polar") {
    const order = S.wp.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
    const live = st.running && !st.inSeqGap && !st.inCycGap && !st.finished;
    const at = order[st.sub.i - 1];
    $$("#wpgrid button").forEach((btn, i) => {
      btn.classList.toggle("cur", live && i === at);
    });
  } else {
    $$("#wpgrid button").forEach((btn) => btn.classList.remove("cur"));
  }

  for (const b of BANDS) {
    const c = st.ch[b];
    const stEl = $(`[data-st="${b}"]`);
    stEl.textContent = c.phase;
    stEl.className = "status " +
      (c.phase === PHASE.EXPOSING || c.phase === PHASE.READING ? "act"
        : c.phase === PHASE.DONE ? "done"
        : c.phase === PHASE.IDLE ? "" : "wait");

    const led = $(`[data-led="${b}"]`);
    led.className = "led " +
      (c.phase === PHASE.EXPOSING ? "on"
        : c.phase === PHASE.READING ? "amber"
        : c.phase === PHASE.DONE ? "on" : "");

    const ne = S.nexp[b];
    setBar($(`[data-exp="${b}"]`), c.expFrac,
      c.phase === PHASE.IDLE ? "—" : `Exposure ${(c.expFrac * 100).toFixed(0)}%`,
      c.phase === PHASE.WAITING || c.phase === PHASE.SEQ_GAP || c.phase === PHASE.CYC_GAP);

    setBar($(`[data-seq="${b}"]`), c.seqFrac,
      c.phase === PHASE.IDLE ? "—" : `#Exposures Done ${Math.min(c.expIdx, ne)} / ${ne}`,
      c.phase === PHASE.SEQ_GAP || c.phase === PHASE.CYC_GAP);

    $(`[data-eix="${b}"]`).textContent = `${Math.min(c.expIdx, ne)} / ${ne}`;
    $(`[data-fr="${b}"]`).textContent = c.frames.toLocaleString();
    $(`[data-idle="${b}"]`).textContent =
      c.idle > 0.005 ? `idles ${c.idle.toFixed(2)} s per subcycle` : "gates the cadence";

    // CCD held at its target throughout the acquisition -- if it drifted off
    // target the ACS would not be taking science frames.
    const tgt = SIZE_MODES[S.size].tmin;
    $(`[data-temp="${b}"]`).textContent = `${tgt} °C`;
    $(`[data-templed="${b}"]`).className = "led on";
  }

  $("#start").disabled = st.running || st.finished;
  $("#pause").disabled = !st.running;
  $("#abort").disabled = !st.running && st.t === 0;
  $("#start").textContent = st.finished ? "DONE" : (st.t > 0 && !st.running ? "RESUME" : "START");
}

function renderBufferTable() {
  const rows = Object.keys(SIZE_MODES).map((k) => {
    const buf = MAX_FRAMES_BUFFER[k];
    const eff = Math.min(buf, 1400);
    const active = k === S.size;
    return `<tr class="${active ? "cur" : ""}">
      <td class="bcell">${active ? `<b>${SIZE_MODES[k].label}</b>` : SIZE_MODES[k].label}</td>
      <td class="num">${buf.toLocaleString()}</td>
      <td class="num">${eff.toLocaleString()}</td>
    </tr>`;
  }).join("");
  $("#buftable").innerHTML = `
    <table class="opts">
      <thead><tr>
        <th class="b">Size mode</th>
        <th class="n" title="Camera-buffer ceiling on NEXP">Buffer</th>
        <th class="n" title="Effective, after the 1400/sequence hard cap">Effective</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ---------------- the one place everything is recomputed ---------------- */
function refresh({ resolve = false } = {}) {
  // A locked channel keeps its NEXP through every re-solve; the solver fits the
  // others under it. Locks are honoured even in manual mode, because the whole
  // point of a lock is that it survives whatever else changes.
  if (resolve && (!S.manual || anyLocked())) {
    const { nexp } = solveNexp(S.tExp, tRead(), ftActive(), S.nexp, S.lock);
    S.nexp = nexp;
    for (const b of BANDS) $(`#texp [data-n="${b}"]`).value = nexp[b];
  }
  renderSetup();
  renderResult();
  renderSim(sim.state());
}

/* ---------------- events ---------------- */
function rocker(sel, fn) {
  $(sel).addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    $$(`${sel} button`).forEach((x) => x.classList.toggle("on", x === btn));
    fn(btn.dataset.v);
  });
}

function modeChanged() {
  sim.abort();
  refresh({ resolve: true });
}

$("#acq").addEventListener("change", (e) => { S.acq = e.target.value; modeChanged(); });
$("#size").addEventListener("change", (e) => { S.size = e.target.value; modeChanged(); });

rocker("#ft", (v) => {
  // Store the observer's INTENT. Whether FT can actually run depends on the
  // exposures, which they may be about to set. Rather than silently flipping
  // the toggle back (which strands them if they turn FT on before typing
  // exposures), we keep the intent and let renderResult warn if it can't hold.
  S.ftWanted = v === "1";
  sim.abort();
  refresh({ resolve: true });
});

rocker("#mode", (v) => { S.mode = v; sim.abort(); refresh(); });
rocker("#trig", (v) => { S.trigger = v; sim.abort(); refresh(); });
rocker("#wave", () => { /* retarder does not change the timing model */ });

$("#ncyc").addEventListener("input", (e) => {
  S.ncyc = Math.max(1, Math.floor(+e.target.value || 1));
  sim.abort();
  refresh();
});

$("#wpgrid").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || btn.disabled) return;
  const i = +btn.dataset.wpI;
  const n = S.wp.filter(Boolean).length;
  if (S.wp[i] && n === 1) return;      // keep at least one
  S.wp[i] = !S.wp[i];
  sim.abort();
  refresh();
});

$$(".wp-row .mini").forEach((btn) => btn.addEventListener("click", () => {
  const v = btn.dataset.wp;
  const k = v === "all" ? 16 : +v;
  S.wp = S.wp.map((_, i) => i < k);
  sim.abort();
  refresh();
}));

/* Locking a channel re-solves the others under it immediately -- the observer
 * should see the consequence of the lock, not have to press a button to find it. */
$("#texp").addEventListener("change", (e) => {
  const b = e.target.dataset.lock;
  if (!b) return;
  S.lock[b] = e.target.checked;
  sim.abort();
  refresh({ resolve: true });
});

$("#texp").addEventListener("input", (e) => {
  const t = e.target.dataset.t, n = e.target.dataset.n;
  if (t) {
    S.tExp[t] = Math.max(0, +e.target.value || 0);
    sim.abort();
    refresh({ resolve: true });
  } else if (n) {
    const asked = Math.floor(+e.target.value || 1);
    S.nexp[n] = Math.max(1, Math.min(MAX_NEXP, asked));
    // Say so rather than silently truncating: the observer typed a number and
    // deserves to know the instrument will not take it.
    if (asked > MAX_NEXP) {
      e.target.value = S.nexp[n];
      $("#solvenote").textContent =
        `NEXP is capped at ${MAX_NEXP} per sequence (Guide 5.5). Use more cycles instead.`;
    }
    sim.abort();
    // Changing a LOCKED channel's NEXP moves the ceiling, so everyone else has
    // to be refitted underneath it.
    refresh({ resolve: S.lock[n] });
  }
});

$("#solve").addEventListener("click", () => {
  S.manual = false;
  $("#solvenote").textContent = anyLocked()
    ? "Locked channels held fixed; the rest fitted underneath."
    : "NEXP is the safe knob: it cannot saturate anything.";
  sim.abort();
  refresh({ resolve: true });
});

$("#manual").addEventListener("click", () => {
  S.manual = !S.manual;
  $("#solvenote").textContent = S.manual
    ? "Manual NEXP. The cadence is whatever your numbers make it."
    : "NEXP is the safe knob: it cannot saturate anything.";
  refresh({ resolve: !S.manual });
});

/* Applying an option sets BOTH t_exp and NEXP for that channel. NEXP is then
 * pinned: re-solving would just undo the choice. */
$("#opts").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-apply]");
  if (!btn) return;
  const b = btn.dataset.apply;
  S.tExp[b] = +btn.dataset.optT;
  S.nexp[b] = +btn.dataset.optN;
  S.manual = true;
  $(`#texp [data-t="${b}"]`).value = S.tExp[b];
  $(`#texp [data-n="${b}"]`).value = S.nexp[b];
  $("#solvenote").textContent =
    `Applied to ${b}. NEXP is now manual — press Solve NEXP to start over.`;
  sim.abort();
  refresh();
});

$("#start").addEventListener("click", () => sim.start());
$("#pause").addEventListener("click", () => sim.pause());
$("#abort").addEventListener("click", () => sim.abort());

rocker("#speed", (v) => sim.setSpeed(+v));

sim.onTick = renderSim;

/* ---------------- go ---------------- */
buildInputs();
buildWP();
refresh({ resolve: true });
