// ── mc-worker.js ───────────────────────────────────────────────────────────
// A worker thread for montecarlo-parallel.js. It is handed the fight once
// (team, opponent, the next-in spec, weights, each lever's open frontier) and
// then runs batches: { lever, n, seed } -> that lever's tally of n rollouts.
// Functions do not cross threads, so the scorer's next-in hook is rebuilt
// here from its spec.

import { parentPort, workerData } from "node:worker_threads";
import { rollout, rng, newTally, addTo, frontierSampler } from "./montecarlo.js";
import { makeNextIn } from "./next-in.js";

const { team, opp, exactRoll, nextInSpec, nextInWarm, weights, frontiers, firstActions } = workerData;
const tctx = { team, opp, exactRoll, ...(nextInSpec ? { nextIn: makeNextIn(nextInSpec, nextInWarm) } : {}) };
const samplers = frontiers.map((f) => (f ? frontierSampler({ frontier: f }) : null));
const replCache = new Map();

parentPort.on("message", ({ lever, n, seed }) => {
  const rand = rng(seed);
  const tally = newTally();
  for (let i = 0; i < n; i++) addTo(tally, rollout(tctx, samplers[lever](rand()), rand, { weights, replCache, firstAction: firstActions?.[lever] ?? "stay" }));
  parentPort.postMessage({ lever, tally });
});
