// Phase C step 3: the Monte Carlo (engine/montecarlo.js, montecarlo-parallel.js,
// mc-worker.js): the estimator's algebra and margins, agreement with the exact
// search where both can run, the stop rules, and the worker threads
// reproducing the main thread's rollouts exactly.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { Worker } from "node:worker_threads";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const T = await import(E("team.js"));
const X = await import(E("solve.js"));
const M = await import(E("montecarlo.js"));
const MP = await import(E("montecarlo-parallel.js"));
const N = await import(E("next-in.js"));
const SD = await import(E("showdown.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const team = SD.buildTeam(fs.readFileSync(path.join(here, "../teams/user-test-team.txt"), "utf8"));
const opp = L.buildMon(getOpponentConfig("Salamence 1", { ability: "Intimidate", ivTier: 12 }));
const tctx = { team, opp };
const start = T.teamStart(tctx, 0);

// ── the estimator ──────────────────────────────────────────────────────────
{
  const a = M.rng(5), b = M.rng(5), c = M.rng(6);
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  ok(sa.join() === sb.join() && sa[0] !== c() && sa.every((x) => x >= 0 && x < 1), "seeded generator: repeatable, seed-dependent, in [0,1)");
  // root: 60% finished on turn 1 (score 0.5, KO 0.45, lose 0.15), 40% open.
  const root = { action: "stay", complete: false, open: 0.4, score: 0.5, pKO: 0.45, pOppLeft: 0, pLose: 0.15 };
  const t = M.newTally();
  for (const [score, outcome] of [[1, "win"], [0.5, "win"], [0, "lose"], [0.5, "win"]]) M.addTo(t, { score, outcome, turns: 2 });
  const e = M.estimate(root, t);
  // mean 0.5, sd sqrt(((.5)^2 + 0 + (.5)^2 + 0) / 3) = sqrt(1/6)
  ok(near(e.score, 0.5 + 0.4 * 0.5) && near(e.margin, (1.96 * 0.4 * Math.sqrt(1 / 6)) / 2), `score and its 95% margin (${e.score}, ${e.margin.toFixed(4)})`);
  ok(near(e.pKO, 0.45 + 0.4 * 0.75) && near(e.pLose, 0.15 + 0.4 * 0.25) && near(e.turns, 3), "outcome chances and turns (1 exact + rollout)");
  const all = M.newTally();
  for (let i = 0; i < 100; i++) M.addTo(all, { score: 1, outcome: "win", turns: 1 });
  const ea = M.estimate({ ...root, open: 1, score: 0, pKO: 0, pLose: 0 }, all);
  ok(ea.pKOMargin > 0.017 && ea.pKOMargin < 0.02, `100/100 KOs still carry a margin (Wilson, ${ea.pKOMargin.toFixed(4)})`);
  ok(M.estimate({ ...root, complete: true, open: 0 }, M.newTally()).margin === 0, "a complete lever has no margin");
  // separated(): the best lever's lower bound above every other upper bound.
  const mk = (score, margin, rollouts = 200) => ({ score, margin, rollouts, exactOpen: 1 });
  ok(M.separated([mk(0.8, 0.02), mk(0.7, 0.03)]) && !M.separated([mk(0.8, 0.06), mk(0.7, 0.05)]), "separation: 0.78 > 0.73 yes; 0.74 < 0.75 no");
  ok(!M.separated([mk(0.9, 0.001, 50), mk(0.1, 0.001)]), "never before minRollouts");
}

// ── against the exact search ───────────────────────────────────────────────
{
  // P(the fight is decided within 2 turns): exact (solveAction, maxTurns 2) vs
  // the exact first turn + 1-turn rollouts from its frontier.
  const exact2 = X.solveAction(tctx, start, "stay", { budgetMs: 60000, maxTurns: 2 });
  const root = X.solveAction(tctx, start, "stay", { budgetMs: 60000, maxTurns: 1 });
  const sample = M.frontierSampler(root), rand = M.rng(42), t = M.newTally();
  const n = 1500;
  for (let i = 0; i < n; i++) M.addTo(t, M.rollout(tctx, sample(rand()), rand, { turnCap: 1 }));
  const est = M.estimate(root, t);
  const q = t.ko / n, se = root.open * Math.sqrt((q * (1 - q)) / n);
  ok(Math.abs(est.pKO - exact2.pKO) < 3 * se, `P(KO within 2 turns): Monte Carlo ${est.pKO.toFixed(4)} vs exact ${exact2.pKO.toFixed(4)} (3 sd = ${(3 * se).toFixed(4)})`);
  const ql = t.lose / n, sel = root.open * Math.sqrt((ql * (1 - ql)) / n) || 1e-9;
  ok(Math.abs(est.pLose - exact2.pLose) <= 3 * sel + 1e-12, `P(lose within 2 turns): ${est.pLose.toFixed(4)} vs ${exact2.pLose.toFixed(4)}`);
  // A fight the exact search finishes: no rollouts at all.
  const sand = { ...start, oppHpPct: 1, weatherType: "sandstorm", weatherTurns: null };
  const r = M.solveMC(tctx, sand, { budgetMs: 5000 });
  ok(r.levers.every((l) => l.rollouts === 0 || l.exactOpen > 0) && r.levers[0].exactOpen === 0 && r.levers[0].margin === 0, "1% in sand: 'stay' is exact, no rollouts");
  const rp = await MP.solveMCParallel(tctx, { ...sand }, { budgetMs: 5000, workers: 2 });
  ok(near(rp.levers[0].score, r.levers[0].score) && rp.levers[0].rollouts === 0, "...the parallel solve agrees");
}

// ── a deferred replacement in a rollout ────────────────────────────────────
{
  // A rollout from a fainted position (solveAction deferReplace leaves those
  // in the frontier) is a rollout from the replaced one: the choice draws no
  // random numbers, so with one seed the two agree digit for digit.
  const down = { ...start, yourHpPct: 0 };
  const j = X.chooseReplacement(tctx, down);
  let same = true;
  for (const seed of [1, 2, 3, 4, 5]) {
    const a = M.rollout(tctx, down, M.rng(seed)), b = M.rollout(tctx, T.replace(tctx, down, j), M.rng(seed));
    if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
  }
  ok(same, `rollouts from a fainted position replace first (${team[j].species} in)`);
}

// ── the worker reproduces the main thread exactly ──────────────────────────
{
  const nextIn = N.makeNextIn({ lead: "Salamence 1", challenge: 3, battle: 7 });
  const tn = { ...tctx, nextIn };
  const root = X.solveAction(tn, start, "stay", { budgetMs: 60000, maxTurns: 1 });
  const seed = 99, n = 30;
  const rand = M.rng(seed), sample = M.frontierSampler(root), mine = M.newTally();
  for (let i = 0; i < n; i++) M.addTo(mine, M.rollout(tn, sample(rand()), rand, {}));
  const w = new Worker(new URL(E("mc-worker.js")));
  const theirs = await new Promise((res, rej) => {
    w.on("message", (m) => (m.type === "batch" ? res(m.tally) : rej(new Error(m.error))));
    w.on("error", rej);
    w.postMessage({ type: "init", team, opp, nextInSpec: nextIn.spec, weights: undefined, start: start });
    w.postMessage({ type: "frontiers", frontiers: [root.frontier], firstActions: ["stay"] });
    w.postMessage({ type: "batch", lever: 0, n, seed });
  });
  await w.terminate();
  ok(JSON.stringify(theirs) === JSON.stringify(mine), `a worker's batch equals the main thread's, digit for digit (sum ${mine.sum.toFixed(6)}, ${mine.ko} KOs)`);
  // ...and the next-in hook is live in it: without it the same rollouts score higher.
  const rand2 = M.rng(seed), plain = M.newTally();
  for (let i = 0; i < n; i++) M.addTo(plain, M.rollout(tctx, sample(rand2()), rand2, {}));
  ok(plain.sum > mine.sum && plain.ko === mine.ko, `the next-in penalty is applied in the worker (with ${mine.sum.toFixed(3)} < without ${plain.sum.toFixed(3)})`);
}

// ── the parallel solve, end to end ─────────────────────────────────────────
{
  const r = await MP.solveMCParallel(tctx, start, { budgetMs: 20000, workers: 4 });
  ok(r.levers.length === 3 && r.levers.every((l) => l.exactOpen === 0 || l.rollouts >= 100), `every open lever got >= 100 rollouts (${r.levers.map((l) => l.rollouts)}) -- ${r.stoppedBy} in ${r.ms} ms`);
  ok(r.levers.every((l) => near(l.pKO + l.pOppLeft + l.pLose + l.pCapped, 1, 1e-9)), "each lever's chances sum to 1");
  const s = M.solveMC(tctx, start, { budgetMs: 20000, seed: 3 });
  const agree = r.levers.every((l, i) => Math.abs(l.score - s.levers[i].score) <= l.margin + s.levers[i].margin);
  ok(agree, `parallel and single-thread agree within margins (${r.levers.map((l, i) => `${l.score.toFixed(3)}/${s.levers[i].score.toFixed(3)}`).join(", ")})`);
}

// ── the shared core: a mixed start, progress, stop ─────────────────────────
{
  const C = await import(E("solve-core.js"));
  // Two start positions (the opponent at 100% or 50%), half each: the merged
  // root is the weighted sum of the two roots.
  const a = { ...start }, b = { ...start, oppHpPct: 50 };
  const ra = X.solveAction(tctx, a, "stay", { budgetMs: 1e9, maxTurns: 1, deferReplace: true });
  const rb = X.solveAction(tctx, b, "stay", { budgetMs: 1e9, maxTurns: 1, deferReplace: true });
  const m = C.mergeRoots([{ p: 0.5, root: ra }, { p: 0.5, root: rb }]);
  ok(near(m.pKO, (ra.pKO + rb.pKO) / 2) && near(m.score, (ra.score + rb.score) / 2) && near(m.open, (ra.open + rb.open) / 2)
    && m.frontier.length === ra.frontier.length + rb.frontier.length && near(m.frontier.reduce((x, f) => x + f.p, 0), m.open), "mergeRoots: weighted sums and a weighted frontier");
  let calls = 0, sawLevers = 0;
  const ctrl = new AbortController();
  const r = await MP.solveMCParallel(tctx, [{ p: 0.5, state: a }, { p: 0.5, state: b }], { budgetMs: 60000, workers: 3,
    onProgress: (levers, info) => { calls++; sawLevers = levers.length; if (calls === 6) ctrl.abort(); }, signal: ctrl.signal });
  ok(r.stoppedBy === "stopped" && calls >= 6 && sawLevers === 3, `a mixed start runs; progress reported (${calls} calls); stop() stops it (${r.stoppedBy})`);
  ok(r.levers.every((l) => near(l.pKO + l.pOppLeft + l.pLose + l.pCapped, 1, 1e-9)), "...and its chances still sum to 1");
}

console.log(`test-montecarlo: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
