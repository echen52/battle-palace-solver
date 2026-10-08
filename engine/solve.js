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

import { teamTurn, replace, aliveBench, youCanSwitch } from "./team.js";
import { vf } from "./logic.js";
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

// The levers at a position: "stay" and { switchTo: j } for each healthy bench
// mon -- given tctx, none while your mon cannot switch (team.js youCanSwitch).
export function rootActions(s, tctx = null) {
  if (tctx && !youCanSwitch(tctx, s)) return ["stay"];
  return ["stay", ...aliveBench(s).map((j) => ({ switchTo: j }))];
}

// Your mon at perish count 0 -- it faints at this turn's end
// (src/battle_util.c:1843-1856) -- switches out when it can (user,
// 2026-10-08: "our side should also know to switch out on perish song if it is
// 1 turn remaining"), the trigger the opponent's AI uses too
// (ShouldSwitchIfPerishSong, src/battle_ai_switch_items.c:20-34). Returns
// { switchTo: j } -- the switch with the best one-turn lookahead (as
// chooseReplacement, point estimate) -- or null (not counted down, nobody to
// switch to, or trapped).
export function perishSwitch(tctx, s, weights, cache = null) {
  if (s.youPerishCount !== 0 || !vf(s, "youPerishSonged") || s.yourHpPct <= 0) return null;
  const bench = aliveBench(s);
  if (!bench.length || !youCanSwitch(tctx, s)) return null;
  const k = cache ? "perish:" + keyOf(s) : null;
  if (cache?.has(k)) return cache.get(k);
  const t = tctx.exactRoll || tctx.rollSample ? { ...tctx, exactRoll: false, rollSample: null } : tctx;
  let best = -Infinity, bestJ = bench[0];
  for (const j of bench) {
    let v = 0;
    for (const r of teamTurn(t, s, { switchTo: j })) v += r.p * scoreState(t, r.state, r.outcome, weights).score;
    if (v > best + 1e-12) { best = v; bestJ = j; }
  }
  const out = { switchTo: bestJ };
  cache?.set(k, out);
  return out;
}

// One lever, exactly. Returns { action, complete, score, pKO, pOppLeft, pLose,
// turns (expected, over finished fights), positions, ms }. When the budget
// runs out mid-search: complete false, the same sums over the fights that DID
// finish, `open` (the probability still in play), the turns fully done and
// `frontier` -- [{ p, state }], the open positions after the last full turn,
// which is where step 3's Monte Carlo picks up. The budget is checked before
// every position (one teamTurn can take ~75 ms, so it can overrun by that).
// maxTurns stops after that many full turns the same way (stoppedBy says which;
// "rolls" when the exact roll enumeration refused a turn -- see rollOutcomeCap).
// turnsDone 0 means the frontier is the start: rollouts must play `action` first.
// deferReplace: the 16-roll first turn leaves thousands of distinct fainted
// positions, and choosing each one's replacement up front cost 26 s of a 27 s
// root (measured); deferred, a frontier position may be one where your mon
// has fainted and the replacement is still to choose.
export function solveAction(tctx, s0, action, { weights, budgetMs = 2000, deadline = null, replCache = new Map(), maxTurns = Infinity, deferReplace = false } = {}) {
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
      let rs;
      try {
        const live = state.yourHpPct <= 0 ? replace(tctx, state, chooseReplacement(tctx, state, weights, replCache)) : state;
        rs = teamTurn(tctx, live, turn === 0 ? action : "stay");
      } catch (e) {
        // The exact roll enumeration refused a turn (tctx.rollOutcomeCap): stop here, with the last complete turn's frontier
        // -- on turn 1, the start itself, which rollouts then play from the
        // lever's own first action.
        if (!/exact roll: too many outcomes/.test(e.message)) throw e;
        return { ...partial(), stoppedBy: "rolls", rollError: e.message };
      }
      for (const r of rs) {
        const pr = p * r.p;
        let st = r.state;
        // deferReplace: keep the fainted position as it is (yourHpPct 0); the
        // replacement is chosen when it is next played (below, or by a rollout).
        if (r.outcome === "replace") { if (!deferReplace) st = replace(tctx, st, chooseReplacement(tctx, st, weights, replCache)); }
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
  const actions = rootActions(s0, tctx);
  return actions.map((a, i) => {
    const slice = (end - Date.now()) / (actions.length - i);
    return solveAction(tctx, s0, a, { weights, deadline: Date.now() + Math.max(0, slice), replCache });
  });
}
