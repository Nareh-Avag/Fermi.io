// game.js
//
// Fermi estimation game — modes, round flow, UI wiring, and the pure scoring fn.
//
// The scoring function (scoreAnswer) and the spread tiers it shares with the live
// "spread bar" are kept dependency-free at the top so they can be copy/pasted into
// tests, a server, or a Supabase edge function unchanged.
//
// Tech note: vanilla ES modules. Date-seeded RNG drives the Daily mode so everyone
// gets the same questions and the same "how everyone did" distribution. localStorage
// persists Daily streak/history. Upgrade path: port to Vite + React + TS (component
// the question card / spread bar / timer / result strip / calculator, game state in a
// reducer) and add Supabase for real cross-player percentiles — scoreAnswer and
// questions.js port over untouched.

import { QUESTIONS } from "./questions.js";

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  STARTING_SCORE: 500,
  DAILY_COUNT: 3,        // fixed number of questions in a daily run
  EPOCH: "2026-01-01",   // day 1 of "Daily #N" numbering
  DEBUG: false,          // true = run scoreAnswer self-tests in the console on load
};
const STORAGE_KEY = "fermi.daily.v1";

// ─────────────────────────────────────────────────────────────────────────────
//  SPREAD TIERS  (shared by the live spread bar AND scoring)
// ─────────────────────────────────────────────────────────────────────────────
//  spread (a.k.a. spreadWidth) = log10(high / low) — interval width in orders of magnitude.
//    tier 1: ≤0.30  (≤2×)   green        hit ×1.5, miss floor −50
//    tier 2: ≤0.50  (≤3×)   yellow-green hit ×1.2, miss floor −30
//    tier 3: ≤1.00  (≤10×)  yellow       hit ×1.0, miss floor −15
//    tier 4: >1.00  (>10×)  red          hit ×0.8, miss floor −10
const SPREAD_TIERS = [
  { tier: 1, maxSpread: 0.30, hitMult: 1.5, missFloor: -50, mult: "×1.5", range: "≤2× wide" },
  { tier: 2, maxSpread: 0.50, hitMult: 1.2, missFloor: -30, mult: "×1.2", range: "≤3× wide" },
  { tier: 3, maxSpread: 1.00, hitMult: 1.0, missFloor: -15, mult: "×1.0", range: "≤10× wide" },
  { tier: 4, maxSpread: Infinity, hitMult: 0.8, missFloor: -10, mult: "×0.8", range: ">10× wide" },
];
function spreadTier(spread) {
  return SPREAD_TIERS.find((t) => spread <= t.maxSpread);
}

// Base-points tiers from the log10 distance of the geometric mean to the truth.
const BASE_TIERS = [
  { max: 0.05, hit: 100, miss: -50, label: "Near perfect" },
  { max: 0.10, hit: 80,  miss: -40, label: "Excellent" },
  { max: 0.20, hit: 60,  miss: -30, label: "Very close" },
  { max: 0.30, hit: 40,  miss: -20, label: "Good" },
  { max: 0.50, hit: 20,  miss: -10, label: "Ballpark" },
  { max: 1.00, hit: 10,  miss: -10, label: "Right order of magnitude" },
  { max: Infinity, hit: 0, miss: -10, label: "Too far off" },
];

const SKIP_PENALTY = -20; // skip or timeout

// ─────────────────────────────────────────────────────────────────────────────
//  PURE SCORING FUNCTION  (testable, portable — no DOM, no globals)
// ─────────────────────────────────────────────────────────────────────────────
//  scoreAnswer(low, high, trueAnswer)
//    -> { points, isHit, label, logDist, spreadWidth }   (+ spreadMult/spreadTier for UI)
//
//  - Point guess = geometric mean sqrt(low*high), so over/under-estimating by the
//    same FACTOR is the same distance and is penalized equally.
//  - logDist  = |log10(geomean / trueAnswer)|.
//  - isHit    = trueAnswer ∈ [low, high].
//  - spreadWidth = log10(high / low).
//  Hit  => base.hit × spread.hitMult.
//  Miss => the LARGER (less-negative) of base.miss and spread.missFloor.
export function scoreAnswer(low, high, trueAnswer) {
  low = Number(low);
  high = Number(high);
  trueAnswer = Number(trueAnswer);

  // Fermi quantities are positive; log-scale scoring is undefined otherwise.
  if (!(low > 0) || !(high > 0) || !(trueAnswer > 0)) {
    return { points: SKIP_PENALTY, isHit: false, label: "Invalid input",
             logDist: Infinity, spreadWidth: 0, spreadMult: "—", spreadTier: 0 };
  }
  if (low > high) [low, high] = [high, low]; // forgive swapped boxes

  const geomean = Math.sqrt(low * high);
  const logDist = Math.abs(Math.log10(geomean / trueAnswer));
  const spreadWidth = Math.log10(high / low);
  const isHit = trueAnswer >= low && trueAnswer <= high;

  const base = BASE_TIERS.find((t) => logDist <= t.max);
  const sp = spreadTier(spreadWidth);

  let points;
  if (isHit) {
    points = Math.round(base.hit * sp.hitMult);
  } else {
    // "larger penalty between base miss and spread miss floor": both are negative,
    // so Math.min picks the more-negative one. This is what makes a tight, confident
    // interval high-risk — an overconfident miss stings (down to −50), while an
    // honestly wide miss is gentle (−10).
    points = Math.min(base.miss, sp.missFloor);
  }

  return {
    points, isHit, label: base.label, logDist, spreadWidth,
    spreadMult: sp.mult, spreadTier: sp.tier,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  NUMBER PARSING & FORMATTING
// ─────────────────────────────────────────────────────────────────────────────
//  Accepts: 1500000 · 1,500,000 · 1.5e6 · shorthand 1.5k / 1.5M / 2B / 3T.
//  Reminder: when a unit already reads "million apps", the player types 1.8 — keep
//  the question's `unit` and `answer` in the same scale (see questions.js).
function parseInput(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  if (s === "") return NaN;
  const MULT = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  const last = s[s.length - 1];
  let factor = 1;
  if (MULT[last] !== undefined) { factor = MULT[last]; s = s.slice(0, -1); }
  const n = Number(s); // handles plain + scientific ("1.5e6")
  if (!isFinite(n)) return NaN;
  return n * factor;
}

function formatNumber(n) {
  n = Number(n);
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e7 || abs < 1e-3)) {
    return n.toExponential(2).replace(/e\+?/, " × 10^");
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

// ─────────────────────────────────────────────────────────────────────────────
//  SEEDED RNG  (deterministic — same date => same daily for everyone)
// ─────────────────────────────────────────────────────────────────────────────
function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dailyNumber(dateStr) {
  const ms = new Date(dateStr + "T00:00:00") - new Date(CONFIG.EPOCH + "T00:00:00");
  return Math.floor(ms / 86400000) + 1;
}
function prettyDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
//  GAME STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  mode: "practice",   // 'practice' | 'daily'
  questions: [],      // the chosen run, in order
  index: 0,
  score: CONFIG.STARTING_SCORE,
  answered: false,
  history: [],        // { id, question, difficulty, points, isHit, logDist }
  secondsPerQ: 60,
  timerId: null,
  timeLeft: 0,
};

// Practice config (persisted only in memory)
const practiceCfg = { difficulty: "mixed", count: 5, seconds: 60 };

// ─────────────────────────────────────────────────────────────────────────────
//  DOM
// ─────────────────────────────────────────────────────────────────────────────
const el = {};
const ID = [
  "hud", "hud-score", "hud-acc", "hud-timer", "hud-timer-wrap", "delta-chip",
  "calc-toggle", "calc-overlay", "calc", "calc-close", "calc-display", "calc-keys",
  "brand-home",
  "home-view", "mode-practice", "mode-daily",
  "practice-config-view", "cfg-difficulty", "cfg-count", "cfg-count-out",
  "cfg-seconds", "cfg-seconds-out", "cfg-pool-note", "practice-start",
  "daily-landing-view", "daily-title", "daily-date", "daily-dots", "daily-streak", "daily-start",
  "round-view", "timebar", "timebar-fill", "progress", "difficulty", "question",
  "unit-prompt", "input-low", "input-high", "unit-low", "unit-high", "geomean",
  "spread", "spread-mult", "spread-fill", "spread-note", "form-error",
  "submit-btn", "skip-btn", "hint-link", "hint-text",
  "result", "result-flag", "result-headline", "result-points", "result-answer",
  "result-detail", "next-btn",
  "practice-end-view", "pe-score", "pe-sub", "pe-calib", "pe-calib-note",
  "pe-breakdown", "pe-again", "pe-home",
  "daily-results-view", "dr-kicker", "dr-score", "dr-hist", "dr-percentile",
  "dr-qlist", "dr-streak", "dr-share", "dr-home", "dr-toast",
];
function cacheDom() { ID.forEach((id) => (el[id] = document.getElementById(id))); }

const VIEWS = ["home-view", "practice-config-view", "daily-landing-view",
  "round-view", "practice-end-view", "daily-results-view"];
function showView(id) {
  VIEWS.forEach((v) => (el[v].hidden = v !== id));
  el.hud.hidden = id !== "round-view";        // HUD only meaningful mid-run
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─────────────────────────────────────────────────────────────────────────────
//  HOME / NAV
// ─────────────────────────────────────────────────────────────────────────────
function goHome() {
  stopTimer();
  showView("home-view");
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRACTICE CONFIG
// ─────────────────────────────────────────────────────────────────────────────
function poolFor(difficulty) {
  return difficulty === "mixed"
    ? QUESTIONS.slice()
    : QUESTIONS.filter((q) => q.difficulty === difficulty);
}
function refreshPoolNote() {
  const pool = poolFor(practiceCfg.difficulty);
  el["cfg-count"].max = Math.max(1, pool.length);
  if (practiceCfg.count > pool.length) {
    practiceCfg.count = pool.length;
    el["cfg-count"].value = pool.length;
    el["cfg-count-out"].textContent = pool.length;
  }
  el["cfg-pool-note"].textContent =
    `${pool.length} question${pool.length === 1 ? "" : "s"} available at this difficulty. No repeats within a run.`;
}
function openPracticeConfig() {
  refreshPoolNote();
  showView("practice-config-view");
}
function startPractice() {
  const pool = poolFor(practiceCfg.difficulty);
  const n = Math.min(practiceCfg.count, pool.length);
  // random cycle, no repeats within a session
  state.questions = seededShuffle(pool, Math.random).slice(0, n);
  state.mode = "practice";
  state.secondsPerQ = practiceCfg.seconds;
  beginRun();
}

// ─────────────────────────────────────────────────────────────────────────────
//  DAILY
// ─────────────────────────────────────────────────────────────────────────────
function loadDaily() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveDaily(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* private mode */ }
}
function dailyQuestions(dateStr) {
  const rng = mulberry32(hashStr("fermi-" + dateStr));
  return seededShuffle(QUESTIONS, rng).slice(0, CONFIG.DAILY_COUNT);
}

function openDaily() {
  const date = todayStr();
  const store = loadDaily();
  // Already played today => jump straight to results (no replay).
  if (store.today && store.today.date === date) {
    renderDailyResults(store.today, store);
    return;
  }
  // Landing screen
  const num = dailyNumber(date);
  el["daily-title"].textContent = `Daily #${num}`;
  el["daily-date"].textContent = prettyDate(date);
  el["daily-dots"].innerHTML = "";
  for (let i = 0; i < CONFIG.DAILY_COUNT; i++) {
    const d = document.createElement("span");
    d.className = "dot";
    el["daily-dots"].appendChild(d);
  }
  const streak = store.streak || 0;
  const best = store.best != null ? store.best : "—";
  el["daily-streak"].innerHTML =
    `Current streak <strong>🔥 ${streak}</strong> · Best score <strong>${best}</strong>`;
  showView("daily-landing-view");
}
function startDaily() {
  state.questions = dailyQuestions(todayStr());
  state.mode = "daily";
  state.secondsPerQ = 45; // fixed pace for the daily
  beginRun();
}

// ─────────────────────────────────────────────────────────────────────────────
//  RUN FLOW (shared by both modes)
// ─────────────────────────────────────────────────────────────────────────────
function beginRun() {
  state.index = 0;
  state.score = CONFIG.STARTING_SCORE;
  state.answered = false;
  state.history = [];
  updateHud(null);
  showView("round-view");
  renderQuestion();
}

function currentQuestion() { return state.questions[state.index]; }

function renderQuestion() {
  const q = currentQuestion();
  stopTimer();

  el.progress.textContent = `Question ${state.index + 1} of ${state.questions.length}`;
  el.difficulty.textContent = q.difficulty;
  el.difficulty.dataset.level = q.difficulty;
  el.question.textContent = q.question;
  el["unit-prompt"].textContent = q.unit;
  el["unit-low"].textContent = q.unit;
  el["unit-high"].textContent = q.unit;

  // reset inputs / spread / hint / result
  el["input-low"].value = "";
  el["input-high"].value = "";
  el["input-low"].disabled = false;
  el["input-high"].disabled = false;
  el["form-error"].textContent = "";
  el.geomean.hidden = true;
  el.spread.hidden = true;
  el["hint-text"].hidden = true;
  el["hint-link"].hidden = !q.hint;
  el["hint-link"].textContent = "Show hint";
  el.result.hidden = true;
  el["submit-btn"].hidden = false;
  el["skip-btn"].hidden = false;
  state.answered = false;

  el["input-low"].focus();
  startTimer();
}

// Live spread bar + geometric mean as the player types.
function onIntervalInput() {
  if (state.answered) return;
  const low = parseInput(el["input-low"].value);
  const high = parseInput(el["input-high"].value);
  const valid = low > 0 && high > 0;

  if (!valid) {
    el.spread.hidden = true;
    el.geomean.hidden = true;
    return;
  }

  const lo = Math.min(low, high), hi = Math.max(low, high);
  const geomean = Math.sqrt(lo * hi);
  el.geomean.hidden = false;
  el.geomean.innerHTML = `Your point guess (geo-mean): <strong>${formatNumber(geomean)}</strong>`;

  const spread = Math.log10(hi / lo);
  const tier = spreadTier(spread);
  // bar length scales with spread: ~0 => short, large => long. ~2.5 (≈316×) maxes out.
  const pct = Math.max(5, Math.min(100, (spread / 2.5) * 100));
  el.spread.hidden = false;
  el.spread.dataset.tier = tier.tier;
  el["spread-fill"].style.width = pct + "%";
  el["spread-mult"].textContent = tier.mult;
  const factor = Math.pow(10, spread);
  el["spread-note"].textContent =
    `Interval ${factor < 100 ? factor.toFixed(1) : Math.round(factor)}× wide — ${tier.range}. Hit multiplier ${tier.mult}.`;
}

function submitAnswer() {
  if (state.answered) return;
  const low = parseInput(el["input-low"].value);
  const high = parseInput(el["input-high"].value);
  if (!(low > 0) || !(high > 0)) {
    el["form-error"].textContent = "Enter two positive numbers (e.g. 1k, 1.5M, 3e6, or 30,000).";
    return;
  }
  applyResult(scoreAnswer(low, high, currentQuestion().answer), currentQuestion());
}

function skipAnswer(isTimeout = false) {
  if (state.answered) return;
  applyResult({
    points: SKIP_PENALTY, isHit: false,
    label: isTimeout ? "Time's up" : "Skipped",
    logDist: Infinity, spreadWidth: 0, spreadMult: "—", spreadTier: 0,
  }, currentQuestion());
}

function applyResult(result, q) {
  stopTimer();
  state.answered = true;
  state.score += result.points;
  state.history.push({
    id: q.id, question: q.question, difficulty: q.difficulty,
    points: result.points, isHit: result.isHit, logDist: result.logDist,
  });

  updateHud(result.points);

  el["input-low"].disabled = true;
  el["input-high"].disabled = true;
  el.spread.hidden = true;
  el.geomean.hidden = true;
  el["submit-btn"].hidden = true;
  el["skip-btn"].hidden = true;
  el["hint-link"].hidden = true;

  // Result strip
  const pos = result.points > 0;
  const sign = pos ? "+" : "";
  el.result.hidden = false;
  el.result.dataset.outcome = result.isHit ? "hit" : "miss";
  el["result-flag"].textContent = result.isHit ? "HIT" : "MISS";
  el["result-headline"].textContent = result.label;
  el["result-points"].textContent = `${sign}${result.points} pts`;
  el["result-points"].dataset.sign = pos ? "pos" : "neg";
  el["result-answer"].innerHTML = `Answer: <strong>${formatNumber(q.answer)}</strong> ${q.unit}`;

  if (isFinite(result.logDist)) {
    const factor = Math.pow(10, result.logDist);
    el["result-detail"].textContent =
      `Geometric mean off by ${factor.toFixed(2)}× · spread ${result.spreadMult}`;
    el["result-detail"].hidden = false;
  } else {
    el["result-detail"].hidden = true;
  }
  el["next-btn"].textContent =
    state.index + 1 >= state.questions.length ? "See results →" : "Next →";
  el["next-btn"].focus();
}

function nextQuestion() {
  state.index++;
  if (state.index >= state.questions.length) endRun();
  else renderQuestion();
}

function endRun() {
  stopTimer();
  if (state.mode === "daily") finishDaily();
  else finishPractice();
}

// ─────────────────────────────────────────────────────────────────────────────
//  PRACTICE END  (calibration is the headline metric for interview prep)
// ─────────────────────────────────────────────────────────────────────────────
function finishPractice() {
  const total = state.history.length;
  const hits = state.history.filter((h) => h.isHit).length;
  const calib = total ? Math.round((hits / total) * 100) : 0;

  el["pe-score"].textContent = state.score;
  el["pe-sub"].textContent = `${hits}/${total} intervals captured the answer`;
  el["pe-calib"].textContent = calib + "%";
  el["pe-calib-note"].textContent =
    "Aim for ~90% if you're giving 90%-confidence intervals. Lower means over-confident; near 100% means too wide.";

  // Accuracy breakdown by difficulty
  el["pe-breakdown"].innerHTML = "";
  ["easy", "medium", "hard"].forEach((d) => {
    const rows = state.history.filter((h) => h.difficulty === d);
    if (!rows.length) return;
    const h = rows.filter((r) => r.isHit).length;
    const pts = rows.reduce((s, r) => s + r.points, 0);
    const row = document.createElement("div");
    row.className = "bd-row";
    row.innerHTML =
      `<span class="bd-name">${d}</span>` +
      `<span class="bd-val">${h}/${rows.length} hit · ${pts >= 0 ? "+" : ""}${pts} pts</span>`;
    el["pe-breakdown"].appendChild(row);
  });

  showView("practice-end-view");
}

// ─────────────────────────────────────────────────────────────────────────────
//  DAILY END  (persist + distribution + percentile + share)
// ─────────────────────────────────────────────────────────────────────────────
function finishDaily() {
  const date = todayStr();
  const store = loadDaily();

  // Streak: +1 if last play was yesterday, else reset to 1.
  const yesterday = todayStr(new Date(Date.now() - 86400000));
  let streak = 1;
  if (store.lastPlayed === yesterday) streak = (store.streak || 0) + 1;

  const sims = simulatedDailyScores(date, state.questions.length);
  const percentile = percentileOf(state.score, sims);

  const today = {
    date,
    number: dailyNumber(date),
    score: state.score,
    percentile,
    results: state.history.map((h) => ({
      id: h.id, question: h.question, points: h.points, isHit: h.isHit,
    })),
  };

  const best = Math.max(store.best != null ? store.best : -Infinity, state.score);
  const history = (store.history || []).filter((h) => h.date !== date);
  history.push({ date, score: state.score, hits: today.results.filter((r) => r.isHit).length, total: today.results.length });

  const next = { lastPlayed: date, streak, best, history, today };
  saveDaily(next);
  renderDailyResults(today, next);
}

// Stable simulated "how everyone did" — seeded by the date so it's the same for all.
function simulatedDailyScores(dateStr, count, n = 2000) {
  const rng = mulberry32(hashStr("dist-" + dateStr));
  const mean = CONFIG.STARTING_SCORE + count * 35;
  const sd = count * 42 + 40;
  const out = [];
  for (let i = 0; i < n; i++) {
    // Box–Muller for a bell-shaped spread
    const u1 = rng() || 1e-9, u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out.push(Math.round(mean + z * sd));
  }
  return out;
}
function percentileOf(score, sims) {
  const below = sims.filter((s) => s < score).length;
  return Math.max(1, Math.min(99, Math.round((below / sims.length) * 100)));
}

function renderDailyResults(today, store) {
  el["dr-kicker"].textContent = `Daily #${today.number}`;
  el["dr-score"].textContent = today.score;

  // Histogram of the simulated distribution with a YOU marker
  const sims = simulatedDailyScores(today.date, today.results.length);
  drawHistogram(sims, today.score);
  el["dr-percentile"].innerHTML =
    `You beat <strong>~${today.percentile}%</strong> of (simulated) players today.`;

  // Per-question list
  el["dr-qlist"].innerHTML = "";
  today.results.forEach((r) => {
    const li = document.createElement("li");
    li.className = "qrow";
    li.dataset.outcome = r.isHit ? "hit" : "miss";
    li.innerHTML =
      `<span class="qflag">${r.isHit ? "✓" : "✕"}</span>` +
      `<span class="qtext">${r.question}</span>` +
      `<span class="qpts" data-sign="${r.points >= 0 ? "pos" : "neg"}">${r.points >= 0 ? "+" : ""}${r.points}</span>`;
    el["dr-qlist"].appendChild(li);
  });

  el["dr-streak"].innerHTML =
    `🔥 Streak <strong>${store.streak || 1}</strong> · Best <strong>${store.best}</strong>`;
  el["dr-toast"].hidden = true;

  // Stash for the share button
  el["dr-share"].dataset.share = buildShareText(today, store);
  showView("daily-results-view");
}

function drawHistogram(sims, youScore) {
  const BINS = 18;
  const all = sims.concat([youScore]);
  const min = Math.min(...all), max = Math.max(...all);
  const span = (max - min) || 1;
  const counts = new Array(BINS).fill(0);
  const binOf = (v) => Math.min(BINS - 1, Math.floor(((v - min) / span) * BINS));
  sims.forEach((s) => counts[binOf(s)]++);
  const youBin = binOf(youScore);
  const peak = Math.max(...counts) || 1;

  el["dr-hist"].innerHTML = "";
  for (let i = 0; i < BINS; i++) {
    const bar = document.createElement("div");
    bar.className = "hist-bar" + (i === youBin ? " is-you" : "");
    bar.style.height = Math.max(4, (counts[i] / peak) * 100) + "%";
    el["dr-hist"].appendChild(bar);
  }
}

function buildShareText(today, store) {
  const squares = today.results.map((r) => (r.isHit ? "🟩" : "🟥")).join("");
  return [
    `Fermi #${today.number} — ${today.score} pts`,
    squares,
    `Top ${100 - today.percentile}% · 🔥${store.streak || 1}`,
    `fermi estimation trainer`,
  ].join("\n");
}

async function shareDaily() {
  const text = el["dr-share"].dataset.share || "";
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for non-secure contexts / older browsers
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
  }
  el["dr-toast"].hidden = false;
  setTimeout(() => (el["dr-toast"].hidden = true), 2200);
}

// ─────────────────────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────────────────────
function updateHud(delta) {
  el["hud-score"].textContent = state.score;
  const answered = state.history.length;
  const hits = state.history.filter((h) => h.isHit).length;
  el["hud-acc"].textContent = answered ? Math.round((hits / answered) * 100) + "%" : "—";

  const chip = el["delta-chip"];
  if (delta == null || delta === 0) {
    chip.hidden = delta !== 0; // hide on fresh render; show "0" only if truly 0
    if (delta === 0) { chip.textContent = "0"; chip.dataset.sign = "pos"; chip.hidden = false; }
  } else {
    chip.hidden = false;
    chip.textContent = (delta > 0 ? "+" : "") + delta;
    chip.dataset.sign = delta > 0 ? "pos" : "neg";
    chip.classList.remove("flash");
    void chip.offsetWidth; // restart animation
    chip.classList.add("flash");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  TIMER  (drives HUD countdown + draining time bar; timeout = skip = −20)
// ─────────────────────────────────────────────────────────────────────────────
function startTimer() {
  state.timeLeft = state.secondsPerQ;
  el.timebar.hidden = false;
  renderTimer();
  state.timerId = setInterval(() => {
    state.timeLeft--;
    renderTimer();
    if (state.timeLeft <= 0) { stopTimer(); skipAnswer(true); }
  }, 1000);
}
function renderTimer() {
  el["hud-timer"].textContent = state.timeLeft + "s";
  const low = state.timeLeft <= 10;
  el["hud-timer-wrap"].dataset.low = low ? "true" : "false";
  el.timebar.dataset.low = low ? "true" : "false";
  el["timebar-fill"].style.width = (state.timeLeft / state.secondsPerQ) * 100 + "%";
}
function stopTimer() {
  if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CALCULATOR  (self-contained; toggles fully off)
// ─────────────────────────────────────────────────────────────────────────────
const calc = { display: "0", acc: null, op: null, fresh: true };
function calcRender() { el["calc-display"].textContent = calc.display; }
function calcApply(a, op, b) {
  switch (op) {
    case "+": return a + b;
    case "−": return a - b;
    case "×": return a * b;
    case "÷": return b === 0 ? NaN : a / b;
    default:  return b;
  }
}
function calcKey(k) {
  const cur = parseFloat(calc.display);
  if (/^[0-9]$/.test(k)) {
    calc.display = calc.fresh || calc.display === "0" ? k : calc.display + k;
    calc.fresh = false;
  } else if (k === ".") {
    if (calc.fresh) { calc.display = "0."; calc.fresh = false; }
    else if (!calc.display.includes(".")) calc.display += ".";
  } else if (k === "+" || k === "−" || k === "×" || k === "÷") {
    if (calc.op && !calc.fresh) calc.acc = calcApply(calc.acc, calc.op, cur);
    else calc.acc = cur;
    calc.op = k; calc.fresh = true;
    calc.display = trimNum(calc.acc);
  } else if (k === "=") {
    if (calc.op != null) {
      calc.display = trimNum(calcApply(calc.acc, calc.op, cur));
      calc.op = null; calc.acc = null; calc.fresh = true;
    }
  } else if (k === "%") {
    calc.display = trimNum(cur / 100); calc.fresh = true;
  } else if (k === "sqrt") {
    calc.display = cur < 0 ? "Error" : trimNum(Math.sqrt(cur)); calc.fresh = true;
  } else if (k === "back") {
    calc.display = calc.display.length > 1 ? calc.display.slice(0, -1) : "0";
  } else if (k === "clear") {
    calc.display = "0"; calc.acc = null; calc.op = null; calc.fresh = true;
  }
  if (calc.display === "" || calc.display === "NaN") calc.display = "Error";
  calcRender();
}
function trimNum(n) {
  if (!isFinite(n)) return "Error";
  return String(Number(n.toFixed(10)));
}
function toggleCalc(force) {
  const open = force != null ? force : el["calc-overlay"].hidden;
  el["calc-overlay"].hidden = !open;
  el["calc-toggle"].classList.toggle("is-open", open);
}

// ─────────────────────────────────────────────────────────────────────────────
//  WIRING
// ─────────────────────────────────────────────────────────────────────────────
function bindEvents() {
  // nav
  el["brand-home"].addEventListener("click", (e) => { e.preventDefault(); goHome(); });
  el["mode-practice"].addEventListener("click", openPracticeConfig);
  el["mode-daily"].addEventListener("click", openDaily);
  document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", goHome));

  // practice config
  el["cfg-difficulty"].addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    el["cfg-difficulty"].querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    practiceCfg.difficulty = btn.dataset.value;
    refreshPoolNote();
  });
  el["cfg-count"].addEventListener("input", (e) => {
    practiceCfg.count = +e.target.value;
    el["cfg-count-out"].textContent = e.target.value;
  });
  el["cfg-seconds"].addEventListener("input", (e) => {
    practiceCfg.seconds = +e.target.value;
    el["cfg-seconds-out"].textContent = e.target.value;
  });
  el["practice-start"].addEventListener("click", startPractice);

  // daily
  el["daily-start"].addEventListener("click", startDaily);

  // round
  el["submit-btn"].addEventListener("click", submitAnswer);
  el["skip-btn"].addEventListener("click", () => skipAnswer(false));
  el["next-btn"].addEventListener("click", nextQuestion);
  el["input-low"].addEventListener("input", onIntervalInput);
  el["input-high"].addEventListener("input", onIntervalInput);
  [el["input-low"], el["input-high"]].forEach((inp) =>
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !state.answered) submitAnswer();
    }));
  el["hint-link"].addEventListener("click", (e) => {
    e.preventDefault();
    const q = currentQuestion();
    if (!q.hint) return;
    el["hint-text"].textContent = q.hint;
    el["hint-text"].hidden = false;
    el["hint-link"].hidden = true;
  });

  // end screens
  el["pe-again"].addEventListener("click", openPracticeConfig);
  el["pe-home"].addEventListener("click", goHome);
  el["dr-home"].addEventListener("click", goHome);
  el["dr-share"].addEventListener("click", shareDaily);

  // calculator
  el["calc-toggle"].addEventListener("click", () => toggleCalc());
  el["calc-close"].addEventListener("click", () => toggleCalc(false));
  el["calc-overlay"].addEventListener("click", (e) => {
    if (e.target === el["calc-overlay"]) toggleCalc(false); // click outside the panel
  });
  el["calc-keys"].addEventListener("click", (e) => {
    const b = e.target.closest(".ck");
    if (b) calcKey(b.dataset.k);
  });

  // global keys: Esc closes calculator
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el["calc-overlay"].hidden) toggleCalc(false);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  DEV SELF-TESTS for the pure scoring function
// ─────────────────────────────────────────────────────────────────────────────
function runScoringTests() {
  const approx = (a, b, t = 1e-9) => Math.abs(a - b) < t;
  const C = [];
  const over = scoreAnswer(5e9, 2e10, 1e9);   // geomean = 1e10, 10× over
  const under = scoreAnswer(5e7, 2e8, 1e9);    // geomean = 1e8, 10× under
  C.push(["over/under logDist symmetric", approx(over.logDist, under.logDist)]);
  C.push(["over/under points symmetric", over.points === under.points]);
  const perfect = scoreAnswer(95, 105, 100);   // tight hit: base 100 × 1.5
  C.push(["tight perfect hit = 150", perfect.points === 150 && perfect.isHit]);
  const bad = scoreAnswer(-1, 10, 100);
  C.push(["invalid -> -20", bad.points === -20]);
  const miss = scoreAnswer(1, 2, 1e6);
  C.push(["clear miss < 0", miss.points < 0 && !miss.isHit]);
  const pass = C.filter(([, ok]) => ok).length;
  console.group(`scoreAnswer self-tests: ${pass}/${C.length} passed`);
  C.forEach(([n, ok]) => console.log(`${ok ? "✓" : "✗"} ${n}`));
  console.groupEnd();
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────────────────────
// Guarded so the module can be imported in node / a test runner / a server
// (where `window` is undefined) without executing browser-only boot code.
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    cacheDom();
    bindEvents();
    calcRender();
    window.scoreAnswer = scoreAnswer; // expose for console/portability checks
    if (CONFIG.DEBUG) runScoringTests();
    goHome();
  });
}
