// ── solver.js ──────────────────────────────────────────────────────────────
// The page's solve: engine/solve-core.js over Web Workers (site/worker.js).
// Same scheduling and estimates as the Node runner (montecarlo-parallel.js);
// damage rolls exact (user decision 2026-10-05).

import { runSolve } from "../engine/solve-core.js";

export const defaultWorkers = () => Math.max(1, Math.min(12, (navigator.hardwareConcurrency || 4) - 1));

// fight: ui-logic.js buildFight(). Resolves to { levers, stoppedBy, ms, exactMs }.
export async function solveInBrowser(fight, { budgetMs = 30000, onProgress = null, signal = null, workers = defaultWorkers(), weights } = {}) {
  const pool = Array.from({ length: workers }, () => {
    const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    let listener = null;
    w.addEventListener("message", (e) => listener?.(e.data));
    // A worker that fails to load or crashes reaches the solve as an error.
    w.addEventListener("error", (e) => { e.preventDefault?.(); listener?.({ type: "error", error: e.message || "a solve worker failed" }); });
    return { post: (m) => w.postMessage(m), onMessage: (f) => { listener = f; }, terminate: () => w.terminate() };
  });
  try {
    const { team, opp, oppReserves, nextInSpec } = fight.tctx;
    return await runSolve({
      pool, actions: fight.actions, budgetMs, onProgress, signal,
      init: { team, opp, oppReserves, exactRoll: true, nextInSpec, weights, start: fight.start },
    });
  } finally {
    pool.forEach((p) => p.terminate());
  }
}
