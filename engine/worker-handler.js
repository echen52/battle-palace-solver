// ── worker-handler.js ──────────────────────────────────────────────────────
// What a solve worker does, whatever thread API carries it (mc-worker.js for
// Node, site/worker.js for the page). Messages in:
//   { type: "init", team, opp, oppReserves, exactRoll, nextInSpec, weights, start }
//   { type: "root", lever, action }        -> { type: "root", lever, root }
//   { type: "frontiers", frontiers, firstActions }
//   { type: "batch", lever, n, seed }      -> { type: "batch", lever, tally }
// Any failure comes back as { type: "error", error } (a named engine throw
// reaches the page instead of a silent hang).

import { rollout, rng, newTally, addTo, frontierSampler, rootCtx } from "./montecarlo.js";
import { solveAction } from "./solve.js";
import { makeNextIn } from "./next-in.js";
import { asMix, mergeRoots } from "./solve-core.js";

export function makeHandler(post) {
  let tctx = null, weights, start = null, samplers = null, firstActions = null;
  const replCache = new Map();
  return (msg) => {
    try {
      if (msg.type === "init") {
        weights = msg.weights;
        tctx = { team: msg.team, opp: msg.opp, oppReserves: msg.oppReserves ?? 2, exactRoll: !!msg.exactRoll, ...(msg.nextInSpec ? { nextIn: makeNextIn(msg.nextInSpec, msg.nextInWarm ?? null) } : {}) };
        start = asMix(msg.start);
      } else if (msg.type === "root") {
        const parts = start.map(({ p, state }) => ({ p, root: solveAction(rootCtx(tctx), state, msg.action,
          { weights, budgetMs: Infinity, maxTurns: 1, replCache, deferReplace: true }) }));
        const root = parts.length === 1 ? parts[0].root : mergeRoots(parts);
        post({ type: "root", lever: msg.lever, root });
      } else if (msg.type === "frontiers") {
        samplers = msg.frontiers.map((f) => (f ? frontierSampler({ frontier: f }) : null));
        firstActions = msg.firstActions;
      } else if (msg.type === "batch") {
        const rand = rng(msg.seed), tally = newTally();
        for (let i = 0; i < msg.n; i++) {
          addTo(tally, rollout(tctx, samplers[msg.lever](rand()), rand, { weights, replCache, firstAction: firstActions[msg.lever] }));
        }
        post({ type: "batch", lever: msg.lever, tally });
      }
    } catch (e) {
      post({ type: "error", error: e.message });
    }
  };
}
