// ── montecarlo.js ──────────────────────────────────────────────────────────
// Phase C step 3: the fight beyond what the exact search covers. For each
// lever, the first turn is enumerated exactly (solve.js, maxTurns 1); each
// rollout then starts from one of those open positions, drawn by its
// probability, and plays to the end under the same policy as the exact
// search (stay; after a faint the mon with the best one-turn lookahead,
// chooseReplacement), drawing ONE outcome of each turn by its probability.
//
//   estimate = (exact sum over the fights that ended on turn 1)
//            + (open probability) x (mean over rollouts)
//   margin   = 1.96 x (open probability) x (sample sd / sqrt(n))   (95%)
//
// for the score and for each outcome chance. A rollout that reaches the
// turn cap (default 400; PP runs out long before in practice) is scored where
// it stands and counted in `capped`.

import { teamTurn, replace } from "./team.js";
import { scoreState } from "./score.js";
import { solveAction, chooseReplacement, rootActions } from "./solve.js";

// mulberry32: small, seedable, good enough for sampling.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (items, u) => {
  let acc = 0;
  for (const it of items) { acc += it.p; if (u < acc) return it; }
  return items[items.length - 1]; // float slack
};

// One fight from `s` (a live position, your turn to choose "stay"), to the end.
// Returns { score, outcome, turns }.
// With tctx.exactRoll set, each hit's damage roll is DRAWN (rollSample) rather
// than enumerated -- the same distribution, one branch per hit.
export function rollout(tctx, s, rand, { weights, replCache = null, turnCap = 400 } = {}) {
  if (tctx.exactRoll) tctx = { ...tctx, exactRoll: false, rollSample: rand };
  let st = s;
  for (let turn = 1; turn <= turnCap; turn++) {
    const r = pick(teamTurn(tctx, st, "stay"), rand());
    if (r.outcome === "replace") { st = replace(tctx, r.state, chooseReplacement(tctx, r.state, weights, replCache)); continue; }
    if (r.outcome) return { score: scoreState(tctx, r.state, r.outcome, weights).score, outcome: r.outcome, turns: turn };
    st = r.state;
  }
  return { score: scoreState(tctx, st, null, weights).score, outcome: "capped", turns: turnCap };
}

// Running sums for one lever's rollouts.
export function newTally() {
  return { n: 0, sum: 0, sumSq: 0, ko: 0, left: 0, lose: 0, capped: 0, turns: 0 };
}
export function addTo(t, r) {
  t.n++; t.sum += r.score; t.sumSq += r.score * r.score; t.turns += r.turns;
  if (r.outcome === "win") t.ko++; else if (r.outcome === "oppLeft") t.left++; else if (r.outcome === "lose") t.lose++; else if (r.outcome === "capped") t.capped++;
}
export function mergeTally(a, b) {
  for (const k of Object.keys(a)) a[k] += b[k];
  return a;
}

// The lever's estimate from its exact first turn and its rollout tally.
export function estimate(root, t) {
  const open = root.complete ? 0 : root.open;
  const mean = t.n ? t.sum / t.n : 0;
  const sd = t.n > 1 ? Math.sqrt(Math.max(0, (t.sumSq - t.n * mean * mean) / (t.n - 1))) : Infinity;
  const prop = (k) => (t.n ? t[k] / t.n : 0);
  // Wilson score half-width: an all-KO tally still carries a margin
  // (n = 100, q = 1 -> ~1.9 points before the open-share factor).
  const pm = (q) => {
    if (open === 0) return 0;
    if (t.n < 2) return Infinity;
    const z = 1.96, n = t.n;
    return (open * z * Math.sqrt((q * (1 - q)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  };
  return {
    action: root.action,
    score: root.score + open * mean,
    margin: open === 0 ? 0 : t.n > 1 ? (1.96 * open * sd) / Math.sqrt(t.n) : Infinity,
    pKO: root.pKO + open * prop("ko"), pKOMargin: pm(prop("ko")),
    pOppLeft: root.pOppLeft + open * prop("left"),
    pLose: root.pLose + open * prop("lose"),
    pCapped: open * prop("capped"),
    turns: t.n ? 1 + t.turns / t.n : 1, // the exact first turn + the rollout's
    rollouts: t.n, exactOpen: open,
  };
}

// Draws a frontier position by probability.
export function frontierSampler(root) {
  const items = root.frontier ?? [];
  const total = items.reduce((a, f) => a + f.p, 0);
  return (u) => pick(items, u * total).state;
}

// Single-thread solve: every lever, exact first turn, then rounds of rollouts
// until the budget runs out or the best lever is separated from the rest
// (its lower 95% bound above every other's upper bound).
export function solveMC(tctx, s0, { weights, budgetMs = 10000, seed = 1, round = 20, minRollouts = 100, targetMargin = 0 } = {}) {
  const t0 = Date.now();
  const replCache = new Map();
  const levers = rootActions(s0).map((a) => {
    const root = solveAction(tctx, s0, a, { weights, budgetMs: Infinity, maxTurns: 1, replCache });
    return { root, tally: newTally(), sample: root.complete ? null : frontierSampler(root) };
  });
  const rand = rng(seed);
  let stoppedBy = "budget";
  for (;;) {
    for (const L of levers) {
      if (!L.sample) continue;
      for (let i = 0; i < round; i++) addTo(L.tally, rollout(tctx, L.sample(rand()), rand, { weights, replCache }));
    }
    const ests = levers.map((L) => estimate(L.root, L.tally));
    if (separated(ests, minRollouts)) { stoppedBy = "separated"; break; }
    if (targetMargin > 0 && ests.every((e) => e.margin <= targetMargin)) { stoppedBy = "margin"; break; }
    if (Date.now() - t0 > budgetMs) break;
  }
  return { levers: levers.map((L) => estimate(L.root, L.tally)), stoppedBy, ms: Date.now() - t0 };
}

export function separated(ests, minRollouts = 100) {
  if (ests.length < 2) return true;
  if (ests.some((e) => e.exactOpen > 0 && e.rollouts < minRollouts)) return false;
  const best = ests.reduce((a, b) => (b.score > a.score ? b : a));
  return ests.every((e) => e === best || best.score - best.margin > e.score + e.margin);
}
