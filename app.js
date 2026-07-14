/* app.js -- DOM wiring. All physics lives in s4calc.js, all timing in sim.js. */

import {
  BANDS, CH_OF, READ_TIME, DT_FT, MAX_NEXP,
  solveNexp, suggestTexp, acquisition, checkLimits, seqTime,
  deadTimes, fmtDuration,
} from "./s4calc.js";
import { Sim, PHASE } from "./sim.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const BAND_NAME = { g: "g (Sloan g′)", r: "r (Sloan r′)", i: "i (Sloan i′)", z: "z (Sloan z′)" };

/* ---------------- state ---------------- */
const S = {
  rate: 1.0,
  ft: false,
  mode: "phot",
  trigger: "sync",
  ncyc: 1,
  wp: Array(16).fill(true),      // active waveplate positions
  tExp: { g: 5.0, r: 0.9, i: 0.9, z: 0.5 },   // the AU Mic setup, as a start
  nexp: { g: 1, r: 3, i: 3, z: 4 },
  manual: false,
};

const sim = new Sim();

/* ---------------- derived ---------------- */
const tRead = () => READ_TIME[S.rate];
const nseq = () => (S.mode === "polar" ? Math.max(1, S.wp.filter(Boolean).length) : 1);

function cfg() {
  const [dtSeq, dtCyc] = deadTimes(S.mode, S.trigger);
  return {
    tExp: S.tExp, nexp: S.nexp, tRead: tRead(), ft: S.ft,
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
        <div class="k" style="font-size:10px;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">
          NEXP <span id="nexp-src-${b}"></span>
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
  $("#tread").textContent = `${tRead()} s`;

  const isPolar = S.mode === "polar";
  $("#wpframe").style.opacity = isPolar ? "1" : ".5";
  $$("#wpgrid button, #wave button, .wp-row .mini").forEach((b) => (b.disabled = !isPolar));

  const n = S.wp.filter(Boolean).length;
  $("#wpcount").textContent = isPolar
    ? `${n} position${n === 1 ? "" : "s"} → NSEQ = ${n}`
    : "photometry → NSEQ = 1, no waveplate";

  $$("#wpgrid button").forEach((btn, i) => {
    btn.classList.toggle("on", S.wp[i]);
    btn.setAttribute("aria-pressed", String(S.wp[i]));
  });

  const note = $("#ftnote");
  if (S.ft) {
    note.textContent = `Frame transfer on: every exposure must be at least ${tRead()} s ` +
      `(the read time), and the dead time between exposures drops to ${DT_FT} s.`;
  } else {
    note.textContent = `Frame transfer off: every exposure pays a full ${tRead()} s readout. ` +
      `That is the price of exposures shorter than the read time.`;
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
    $(`#nexp-src-${b}`).textContent = S.manual ? "(manual)" : "(solved)";
  }

  $("#s-cad").textContent = fmtDuration(a.cadence);
  $("#s-cyc").textContent = fmtDuration(a.cycle);
  $("#s-tot").textContent = fmtDuration(a.total);
  $("#s-duty").textContent = `${(a.openFrac * 100).toFixed(0)}%`;

  const totFrames = BANDS.reduce((s, b) => s + a.perCh[b].frames, 0);
  $("#gatenote").textContent =
    `Cadence is set by ${a.gate} (${a.perCh[a.gate].wall.toFixed(2)} s). ` +
    `${a.deadPerSeq.toFixed(2)} s of channel idle per subcycle; the worst channel waits ` +
    `${(a.cadence - Math.min(...BANDS.map((b) => a.perCh[b].wall))).toFixed(2)} s. ` +
    `${a.ncyc} cycle${a.ncyc === 1 ? "" : "s"} × ${a.nseq} subcycle${a.nseq === 1 ? "" : "s"} ` +
    `→ ${totFrames.toLocaleString()} frames total.`;

  // messages
  const msgs = [];
  for (const m of checkLimits(c)) {
    msgs.push(`<div class="msg ${m.level === "error" ? "err" : "warn"}">${m.msg}</div>`);
  }
  if (!S.manual) {
    const sug = suggestTexp(S.tExp, S.nexp, tRead(), S.ft, a.cadence);
    const keys = Object.keys(sug);
    if (a.deadPerSeq > 0.25 && keys.length) {
      const parts = keys.map((b) => {
        const gain = (sug[b] - S.tExp[b]) * S.nexp[b];
        return `${b} ${S.tExp[b]}→${sug[b]} s (+${gain.toFixed(2)} s open)`;
      });
      msgs.push(
        `<div class="msg ok">Optional, if you have room before saturation: ` +
        `${parts.join(", ")}. Same NEXP, same cadence. NEXP is safe to change; this is not.</div>`
      );
    } else if (a.deadPerSeq <= 0.25) {
      msgs.push(`<div class="msg ok">Dead time is already small. Nothing else worth doing.</div>`);
    }
  }
  if (!S.ft && BANDS.some((b) => S.tExp[b] < tRead())) {
    const short = BANDS.filter((b) => S.tExp[b] < tRead());
    msgs.push(
      `<div class="msg">${short.join(", ")} ${short.length === 1 ? "is" : "are"} shorter than the ` +
      `${tRead()} s read time, so frame transfer is impossible at ${S.rate} MHz.</div>`
    );
  }
  $("#msgs").innerHTML = msgs.join("");

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

  // highlight the live waveplate position
  $$("#wpgrid button").forEach((btn, i) => {
    const active = S.wp[i];
    const order = S.wp.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
    btn.classList.toggle("cur",
      st.running && active && order[st.sub.i - 1] === i);
  });

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
  }

  $("#start").disabled = st.running || st.finished;
  $("#pause").disabled = !st.running;
  $("#abort").disabled = !st.running && st.t === 0;
  $("#start").textContent = st.finished ? "DONE" : (st.t > 0 && !st.running ? "RESUME" : "START");
}

/* ---------------- the one place everything is recomputed ---------------- */
function refresh({ resolve = false } = {}) {
  if (resolve && !S.manual) {
    const { nexp } = solveNexp(S.tExp, tRead(), S.ft);
    S.nexp = nexp;
    for (const b of BANDS) $(`[data-n="${b}"]`).value = nexp[b];
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

$("#rate").addEventListener("change", (e) => {
  S.rate = parseFloat(e.target.value);
  sim.abort();
  refresh({ resolve: true });
});

rocker("#ft", (v) => {
  S.ft = v === "1";
  // The instrument rejects FT when any exposure is below the read time.
  if (S.ft && BANDS.some((b) => S.tExp[b] < tRead())) {
    S.ft = false;
    $$("#ft button").forEach((x) => x.classList.toggle("on", x.dataset.v === "0"));
  }
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

$("#texp").addEventListener("input", (e) => {
  const t = e.target.dataset.t, n = e.target.dataset.n;
  if (t) {
    S.tExp[t] = Math.max(0, +e.target.value || 0);
    sim.abort();
    refresh({ resolve: true });
  } else if (n) {
    S.nexp[n] = Math.max(1, Math.min(MAX_NEXP, Math.floor(+e.target.value || 1)));
    sim.abort();
    refresh();
  }
});

$("#solve").addEventListener("click", () => {
  S.manual = false;
  $$(`[data-n]`).forEach((x) => (x.disabled = true));
  $("#solvenote").textContent = "NEXP is the safe knob: it cannot saturate anything.";
  sim.abort();
  refresh({ resolve: true });
});

$("#manual").addEventListener("click", () => {
  S.manual = !S.manual;
  $$(`[data-n]`).forEach((x) => (x.disabled = !S.manual));
  $("#solvenote").textContent = S.manual
    ? "Manual NEXP. The cadence is whatever your numbers make it."
    : "NEXP is the safe knob: it cannot saturate anything.";
  refresh({ resolve: !S.manual });
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
