// ── solve-core.js ──────────────────────────────────────────────────────────
// The parallel solve, without any thread API: the Node runner
// (montecarlo-parallel.js, worker_threads) and the page (site/solver.js, Web
// Workers) both drive this with a pool of { post(msg), onMessage(fn),
// terminate() } handles running worker-handler.js.
//
//   1. init     every worker gets the fight (team, opponent, roll mode, the
//               next-in spec, weights, the start)
//   2. roots    one job per lever: the exact first turn (solve.js, maxTurns 1,
//               roll cap, deferred replacements) over the start -- a single
//               position, or a weighted mix of them (an unknown sleep
//               counter is a mix)
//   3. batches  rollouts from each lever's open frontier, always feeding the
//               lever with the fewest; stop when the best lever separates,
//               at the time budget, or when stop() is called
// onProgress(levers, info) is called after every batch with the current
// estimates (montecarlo.js estimate()).

import { newTally, mergeTally, estimate, separated, firstActionOf } from "./montecarlo.js";

// The start as a mix: [{ p, state }] (weights summing to 1).
export const asMix = (s0) => (Array.isArray(s0) ? s0 : [{ p: 1, state: s0 }]);

// Several roots (one per start position, each solved for the same lever) into
// one: the finished sums and the frontier weighted by each position's p.
export function mergeRoots(parts) {
  const out = { action: parts[0].root.action, complete: true, score: 0, pKO: 0, pOppLeft: 0, pLose: 0, open: 0, frontier: [], turnsDone: Infinity, positions: 0 };
  for (const { p, root } of parts) {
    out.score += p * root.score; out.pKO += p * root.pKO; out.pOppLeft += p * root.pOppLeft; out.pLose += p * root.pLose;
    out.positions += root.positions;
    if (!root.complete) {
      out.complete = false;
      out.open += p * root.open;
      for (const f of root.frontier) out.frontier.push({ p: p * f.p, state: f.state });
      out.turnsDone = Math.min(out.turnsDone, root.turnsDone);
    }
  }
  // A lever whose start positions disagree (one refused at turn 0, one not)
  // cannot hand its rollouts a single first action: refuse rather than guess.
  if (!out.complete && parts.some(({ root }) => !root.complete && root.turnsDone !== out.turnsDone)) {
    throw new Error("solve: the start positions' exact first turns stopped at different depths");
  }
  if (out.complete) { delete out.frontier; out.turnsDone = 1; }
  return out;
}

export async function runSolve({ pool, init, actions, budgetMs = 30000, seed = 1, batch = 10, minRollouts = 100, onProgress = null, signal = null }) {
  const t0 = Date.now();
  let resolveStep = null;
  const inbox = [];
  pool.forEach((w, i) => w.onMessage((m) => { inbox.push({ i, m }); if (resolveStep) { const r = resolveStep; resolveStep = null; r(); } }));
  const next = async () => { while (!inbox.length) await new Promise((r) => { resolveStep = r; }); return inbox.shift(); };
  const fail = (m) => { throw new Error(`solve worker: ${m.error}`); };

  for (const w of pool) w.post({ type: "init", ...init });

  // Roots: lever i on worker i % pool size.
  const roots = new Array(actions.length);
  let pending = 0;
  actions.forEach((a, i) => { pool[i % pool.length].post({ type: "root", lever: i, action: a }); pending++; });
  while (pending) {
    const { m } = await next();
    if (m.type === "error") fail(m);
    if (m.type === "root") { roots[m.lever] = m.root; pending--; }
  }
  const exactMs = Date.now() - t0;
  const tallies = roots.map(() => newTally());
  const ests = () => roots.map((r, i) => estimate(r, tallies[i]));
  const open = roots.map((r, i) => (r.complete ? -1 : i)).filter((i) => i >= 0);
  if (!open.length) { onProgress?.(ests(), { done: true, stoppedBy: "exact" }); return { levers: ests(), stoppedBy: "exact", ms: Date.now() - t0, exactMs }; }

  const frontiers = roots.map((r) => (r.complete ? null : r.frontier));
  const firstActions = roots.map(firstActionOf);
  for (const w of pool) w.post({ type: "frontiers", frontiers, firstActions });

  const inflight = roots.map(() => 0), batchNo = roots.map(() => 0);
  let stoppedBy = null, busy = 0;
  const check = () => {
    if (stoppedBy) return true;
    const e = ests();
    if (signal?.aborted) stoppedBy = "stopped";
    else if (separated(e, minRollouts)) stoppedBy = "separated";
    else if (Date.now() - t0 > budgetMs) stoppedBy = "budget";
    return !!stoppedBy;
  };
  const feed = (wi) => {
    if (check()) return;
    const lever = open.reduce((a, b) => (tallies[b].n + inflight[b] < tallies[a].n + inflight[a] ? b : a));
    inflight[lever] += batch; busy++;
    pool[wi].post({ type: "batch", lever, n: batch, seed: (seed * 7919 + lever * 104729 + batchNo[lever]++ * 1299709) >>> 0 });
  };
  pool.forEach((_, wi) => feed(wi));
  while (busy) {
    const { i, m } = await next();
    if (m.type === "error") fail(m);
    if (m.type !== "batch") continue;
    mergeTally(tallies[m.lever], m.tally); inflight[m.lever] -= batch; busy--;
    onProgress?.(ests(), { done: false, ms: Date.now() - t0 });
    feed(i);
  }
  const levers = ests();
  onProgress?.(levers, { done: true, stoppedBy });
  return { levers, stoppedBy, ms: Date.now() - t0, exactMs };
}
