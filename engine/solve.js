// ── solve.js ───────────────────────────────────────────────────────────────
// Phase C step 2: the exact attempt. For each lever you have at the start of
// the round -- stay, or switch to a healthy bench mon -- the exact expected
// team score (score.js) and the outcome chances, under the agreed continuation
// policy (CLAUDE.md "Phase C plan", 2026-10-02):
//   every later turn   stay (the Palace picks your moves)
//   after your faint   send the "best-scoring" mon: the one whose next turn
//                      (one more enumerated "stay" turn) has the highest
//                      expected score. Ties: the lower team index.
// Damage rolls: with tctx.exactRoll (solveFight, montecarlo-parallel.js, sets it by default)
// every landed hit branches over the 16 rolls; without, the inherited 92.5%
// point estimate.
// The fight is enumerated turn by turn; equal positions are merged (keyed by
// the whole state), so long fights grow by distinct positions, not paths.
// Every fight ends (PP runs out, then Struggle), but long ones are too big: the
// search stops at its time budget and says so (complete: false) -- step 3's
// Monte Carlo takes over there.

import { teamTurn, replace, aliveBench } from "./team.js";
import { scoreState } from "./score.js";

const keyOf = (s) => JSON.stringify(s);

// The replacement rule, shared with the Monte Carlo. `cache` maps a position
// key to the chosen index.
// The lookahead runs on the 92.5% point estimate whatever the solve's roll
// mode: it is a decision rule, not a measurement, and 16 rolls per hit would
// make every faint cost a second. Exact search and rollouts share it.
export function chooseReplacement(tctx, s, weights, cache = null) {
  const k = cache ? keyOf(s) : null;
  if (cache?.has(k)) return cache.get(k);
  if (tctx.exactRoll || tctx.rollSample) tctx = { ...tctx, exactRoll: false, rollSample: null };
  let best = -Infinity, bestJ = null;
  for (const j of aliveBench(s)) {
    const sIn = replace(tctx, s, j);
    let v = 0;
    for (const r of teamTurn(tctx, sIn, "stay")) v += r.p * scoreState(tctx, r.state, r.outcome, weights).score;
    if (v > best + 1e-12) { best = v; bestJ = j; }
  }
  cache?.set(k, bestJ);
  return bestJ;
}

// The levers at a position: "stay" and { switchTo: j } for each healthy bench mon.
export function rootActions(s) {
  return ["stay", ...aliveBench(s).map((j) => ({ switchTo: j }))];
}

// One lever, exactly. Returns { action, complete, score, pKO, pOppLeft, pLose,
// turns (expected, over finished fights), positions, ms }. When the budget
// runs out mid-search: complete false, the same sums over the fights that DID
// finish, `open` (the probability still in play), the turns fully done and
// `frontier` -- [{ p, state }], the open positions after the last full turn,
// which is where step 3's Monte Carlo picks up. The budget is checked before
// every position (one teamTurn can take ~75 ms, so it can overrun by that).
// maxTurns stops after that many full turns the same way (stoppedBy says which).
export function solveAction(tctx, s0, action, { weights, budgetMs = 2000, deadline = null, replCache = new Map(), maxTurns = Infinity } = {}) {
  const t0 = Date.now();
  const stopAt = deadline ?? t0 + budgetMs;
  const acc = { score: 0, pKO: 0, pOppLeft: 0, pLose: 0, turnSum: 0 };
  let positions = 0;
  let frontier = new Map([[keyOf(s0), { p: 1, state: s0 }]]);
  let turn = 0;
  const finish = (a, p, state, outcome, t) => {
    a.score += p * scoreState(tctx, state, outcome, weights).score;
    if (outcome === "win") a.pKO += p; else if (outcome === "oppLeft") a.pOppLeft += p; else if (outcome === "lose") a.pLose += p;
    a.turnSum += p * t;
  };
  const partial = () => ({ action, complete: false, ...strip(acc), open: [...frontier.values()].reduce((a, x) => a + x.p, 0),
    turnsDone: turn, frontier: [...frontier.values()], positions, ms: Date.now() - t0 });
  while (frontier.size > 0) {
    if (turn >= maxTurns) return { ...partial(), stoppedBy: "maxTurns" };
    // This turn's finishes go to a scratch tally, kept only if the turn completes.
    const scratch = { score: 0, pKO: 0, pOppLeft: 0, pLose: 0, turnSum: 0 };
    const next = new Map();
    for (const { p, state } of frontier.values()) {
      if (Date.now() > stopAt) return { ...partial(), stoppedBy: "budget" };
      positions++;
      for (const r of teamTurn(tctx, state, turn === 0 ? action : "stay")) {
        const pr = p * r.p;
        let st = r.state;
        if (r.outcome === "replace") st = replace(tctx, st, chooseReplacement(tctx, st, weights, replCache));
        else if (r.outcome) { finish(scratch, pr, st, r.outcome, turn + 1); continue; }
        const k = keyOf(st);
        const cur = next.get(k);
        if (cur) cur.p += pr; else next.set(k, { p: pr, state: st });
      }
    }
    for (const f of Object.keys(acc)) acc[f] += scratch[f];
    turn++;
    frontier = next;
  }
  const done = acc.pKO + acc.pOppLeft + acc.pLose;
  return { action, complete: true, ...strip(acc), turns: acc.turnSum / done, positions, ms: Date.now() - t0 };
}
const strip = ({ turnSum, ...rest }) => rest;

// Every lever. The budget is shared fairly: each lever gets an equal slice of
// what is left when its turn comes (a lever that finishes early hands its
// remainder on).
export function solveExact(tctx, s0, { weights, budgetMs = 2000 } = {}) {
  const end = Date.now() + budgetMs;
  const replCache = new Map();
  const actions = rootActions(s0);
  return actions.map((a, i) => {
    const slice = (end - Date.now()) / (actions.length - i);
    return solveAction(tctx, s0, a, { weights, deadline: Date.now() + Math.max(0, slice), replCache });
  });
}
