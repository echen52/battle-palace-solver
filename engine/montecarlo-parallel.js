// ── montecarlo-parallel.js ─────────────────────────────────────────────────
// The parallel solve in Node: solve-core.js over worker_threads (mc-worker.js).
// Every lever's exact first turn runs on a worker, then rollouts in batches
// until the best lever separates, the budget runs out, or `signal` aborts.
// Every batch gets its own seed; which batches run depends on thread timing,
// so two runs agree within their margins, not to the digit.

import { Worker } from "node:worker_threads";
import os from "node:os";
import { rootActions } from "./solve.js";
import { runSolve, asMix } from "./solve-core.js";

const WORKER = new URL("./mc-worker.js", import.meta.url);

// s0: a position, or a weighted mix [{ p, state }] (the levers come from the first).
export async function solveMCParallel(tctx, s0, {
  weights, budgetMs = 30000, seed = 1, batch = 10, minRollouts = 100, onProgress = null, signal = null,
  workers = Math.max(1, Math.min(12, os.cpus().length - 1)),
} = {}) {
  const start = asMix(s0);
  const pool = Array.from({ length: workers }, () => {
    const w = new Worker(WORKER);
    return { post: (m) => w.postMessage(m), onMessage: (f) => w.on("message", f), terminate: () => w.terminate(), w };
  });
  // A crashed worker reaches the solve as an error message, not a hang.
  pool.forEach((h) => h.w.on("error", (e) => h.w.emit("message", { type: "error", error: e.message })));
  try {
    const r = await runSolve({
      pool, actions: rootActions(start[0].state), budgetMs, seed, batch, minRollouts, onProgress, signal,
      init: { team: tctx.team, opp: tctx.opp, oppReserves: tctx.oppReserves ?? 2, exactRoll: !!tctx.exactRoll, nextInSpec: tctx.nextIn?.spec ?? null,
        nextInWarm: tctx.nextIn?.exportCache?.() ?? null, weights, start },
    });
    return { ...r, workers };
  } finally {
    await Promise.all(pool.map((h) => h.terminate()));
  }
}

// The entry point: the parallel solve with the solver's defaults. Damage
// rolls are EXACT unless asked otherwise (user decision 2026-10-05: the 16
// rolls, enumerated in the exact first turn, drawn per hit in rollouts);
// rolls: "point" keeps the inherited 92.5% estimate.
export function solveFight(tctx, s0, { rolls = "exact", ...opts } = {}) {
  if (rolls !== "exact" && rolls !== "point") throw new Error(`solveFight: rolls must be "exact" or "point", got ${rolls}`);
  return solveMCParallel({ ...tctx, exactRoll: rolls === "exact" }, s0, opts);
}
