// ── montecarlo-parallel.js ─────────────────────────────────────────────────
// solveMC on worker threads: the same estimate (montecarlo.js), the rollouts
// spread over `workers` threads in batches. The main thread does the exact
// first turn per lever, hands each worker the open frontiers, and keeps every
// worker busy, always on the lever with the fewest rollouts; it stops when the
// best lever is separated (after minRollouts each), when every margin is
// under targetMargin, or at the budget. Every batch gets its own seed
// (seed, lever, the lever's batch count); which batches run depends on thread
// timing, so two runs agree within their margins, not to the digit.

import { Worker } from "node:worker_threads";
import os from "node:os";
import { solveAction, rootActions } from "./solve.js";
import { newTally, mergeTally, estimate, separated } from "./montecarlo.js";

const WORKER = new URL("./mc-worker.js", import.meta.url);

export async function solveMCParallel(tctx, s0, {
  weights, budgetMs = 30000, seed = 1, batch = 10, minRollouts = 100, targetMargin = 0,
  workers = Math.max(1, Math.min(12, os.cpus().length - 1)),
} = {}) {
  const t0 = Date.now();
  const replCache = new Map();
  const roots = rootActions(s0).map((a) => solveAction(tctx, s0, a, { weights, budgetMs: Infinity, maxTurns: 1, replCache }));
  const tallies = roots.map(() => newTally());
  const pending = roots.map(() => 0);
  const open = roots.map((r, i) => (!r.complete ? i : -1)).filter((i) => i >= 0);
  const exactMs = Date.now() - t0;
  const ests = () => roots.map((r, i) => estimate(r, tallies[i]));
  if (open.length === 0) return { levers: ests(), stoppedBy: "exact", ms: Date.now() - t0, exactMs, workers: 0 };

  const data = { team: tctx.team, opp: tctx.opp, exactRoll: !!tctx.exactRoll, nextInSpec: tctx.nextIn?.spec ?? null,
    nextInWarm: tctx.nextIn?.exportCache?.() ?? null, weights,
    frontiers: roots.map((r) => (r.complete ? null : r.frontier)) };
  const pool = Array.from({ length: workers }, () => new Worker(WORKER, { workerData: data }));
  const batchNo = roots.map(() => 0);
  let stoppedBy = null;
  const done = () => {
    if (stoppedBy) return true;
    const e = ests();
    if (separated(e, minRollouts)) stoppedBy = "separated";
    else if (targetMargin > 0 && e.every((x) => x.margin <= targetMargin) && e.every((x) => x.exactOpen === 0 || x.rollouts >= minRollouts)) stoppedBy = "margin";
    else if (Date.now() - t0 > budgetMs) stoppedBy = "budget";
    return !!stoppedBy;
  };
  // The lever to feed next: the one with the fewest rollouts done + in flight.
  const nextLever = () => open.reduce((a, b) => (tallies[b].n + pending[b] < tallies[a].n + pending[a] ? b : a));
  try {
    await new Promise((resolve, reject) => {
      let inFlight = 0;
      const feed = (w) => {
        if (done()) { if (inFlight === 0) resolve(); return; }
        const lever = nextLever();
        pending[lever] += batch; inFlight++;
        w.postMessage({ lever, n: batch, seed: (seed * 7919 + lever * 104729 + batchNo[lever]++ * 1299709) >>> 0 });
      };
      for (const w of pool) {
        w.on("message", ({ lever, tally }) => {
          mergeTally(tallies[lever], tally); pending[lever] -= batch; inFlight--;
          feed(w);
        });
        w.on("error", reject);
        feed(w);
      }
    });
  } finally {
    await Promise.all(pool.map((w) => w.terminate()));
  }
  return { levers: ests(), stoppedBy, ms: Date.now() - t0, exactMs, workers };
}

// The entry point: the parallel solve with the solver's defaults. Damage
// rolls are EXACT unless asked otherwise (user decision 2026-10-05: the 16
// rolls, enumerated in the exact first turn, drawn per hit in rollouts);
// rolls: "point" keeps the inherited 92.5% estimate.
export function solveFight(tctx, s0, { rolls = "exact", ...opts } = {}) {
  if (rolls !== "exact" && rolls !== "point") throw new Error(`solveFight: rolls must be "exact" or "point", got ${rolls}`);
  return solveMCParallel({ ...tctx, exactRoll: rolls === "exact" }, s0, opts);
}
