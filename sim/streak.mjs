// ── sim/streak.mjs ─────────────────────────────────────────────────────────
// The late-pool streak sim (Phase E). Plays Battle Palace battles from battle
// 50 on (challenge 8+, where every trainer comes from the last range) with
// your team, deciding your switches with the SOLVER every turn (user decision
// 2026-10-05: policy b), and writes one JSON line per battle.
//
//   node sim/streak.mjs --team teams/user-test-team.txt --battles 1000 --seed 1 \
//        --budget 3000 --out results/swampert.jsonl [--from 0] [--workers 12]
//
// The draw: sim/draw.mjs. Battle i's draw depends only on (seed, i), so two
// teams face the same battles; it is resumable (--from, and existing lines are
// skipped).
//
// Your decisions use what the page would be given: your team, the mon in
// front of you (its set, ability and IVs -- as if you identified it right),
// the full position, and the challenge / battle for its teammates' odds -- not
// the trainer. After a faint, each candidate is solved and the best sent in.

import fs from "node:fs";
import os from "node:os";
import { Worker } from "node:worker_threads";
import * as L from "../engine/logic.js";
import * as T from "../engine/team.js";
import * as Bt from "../engine/battle.js";
import * as N from "../engine/next-in.js";
import { buildTeam } from "../engine/showdown.js";
import { getOpponentConfig } from "../engine/opponent-adapter.js";
import { rng } from "../engine/montecarlo.js";
import { rootActions } from "../engine/solve.js";
import { runSolve } from "../engine/solve-core.js";
import { makeDraw, seedOf, challengeOf, stageOf, FIRST_LATE } from "./draw.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const TEAM_FILE = args.team, OUT = args.out;
const BATTLES = Number(args.battles ?? 1000), SEED = Number(args.seed ?? 1), FROM = Number(args.from ?? 0);
const BUDGET = Number(args.budget ?? 3000), WORKERS = Number(args.workers ?? Math.min(12, os.cpus().length - 1));
const TURN_CAP = 400;
if (!TEAM_FILE || !OUT) throw new Error("usage: --team <file> --out <jsonl> [--battles N --seed S --budget ms --from i --workers w]");

const team = buildTeam(fs.readFileSync(TEAM_FILE, "utf8"));
const draw = makeDraw(SEED);
function buildBattle(d, rand) {
  const oppTeam = d.keys.map((k, i) => L.buildFrontierOpponent(getOpponentConfig(k, { ability: d.abilities[i], ivTier: d.iv, allowUnreachableTier: true })));
  return { team, oppTeam, oppIds: d.keys.map(N.setId), rollSample: rand };
}

// ── the solver, on one persistent worker pool ──────────────────────────────
const pool = Array.from({ length: WORKERS }, () => {
  const w = new Worker(new URL("../engine/mc-worker.js", import.meta.url));
  let listener = () => {};
  w.on("message", (m) => listener(m));
  w.on("error", (e) => listener({ type: "error", error: e.message }));
  return { post: (m) => w.postMessage(m), onMessage: (f) => { listener = f; }, terminate: () => w.terminate() };
});
const nextInCache = new Map();
function nextInFor(spec) {
  const k = JSON.stringify(spec);
  if (!nextInCache.has(k)) {
    let v = null;
    try { const ni = N.makeNextIn(spec); v = { spec, warm: ni.exportCache() }; } catch { v = null; }
    nextInCache.set(k, v);
  }
  return nextInCache.get(k);
}
const solveCache = new Map();
let solves = 0, solveMs = 0, cacheHits = 0, exactMsSum = 0; const stopped = {};
async function solve(B, s, spec, seed) {
  const ni = spec ? nextInFor(spec) : null;
  const key = JSON.stringify([s, ni?.spec ?? null]);
  if (solveCache.has(key)) { cacheHits++; return solveCache.get(key); }
  const t0 = Date.now();
  const actions = rootActions(s);
  const r = await runSolve({
    pool, actions, budgetMs: BUDGET, seed,
    init: { team: B.team, opp: B.oppTeam[s.oppActive], oppReserves: Bt.aliveOpp(s).length, exactRoll: true,
      nextInSpec: ni?.spec ?? null, nextInWarm: ni?.warm ?? null, start: [{ p: 1, state: s }] },
  });
  solves++; solveMs += Date.now() - t0; exactMsSum += r.exactMs ?? 0; stopped[r.stoppedBy] = (stopped[r.stoppedBy] ?? 0) + 1;
  const best = r.levers.reduce((bi, l, i) => (l.score > r.levers[bi].score ? i : bi), 0);
  const out = { action: actions[best], value: r.levers[best].score };
  solveCache.set(key, out);
  return out;
}

// What the page would be told about their team: the mon out, and -- when it
// has teammates left -- the first one you saw (its lead) and this one.
function specFor(d, n, s, seen) {
  if (Bt.aliveOpp(s).length === 0) return null;
  const cur = d.keys[s.oppActive], first = d.keys[seen[0]];
  if (d.trainer === "Spenser Gold") return { lead: first, ...(cur !== first ? { second: cur } : {}), brain: "Spenser Gold" };
  const at = { challenge: Math.min(8, challengeOf(n)), battle: stageOf(n) };
  return cur === first ? { lead: cur, ...at } : { lead: first, second: cur, ...at };
}

// ── one battle ─────────────────────────────────────────────────────────────
async function playBattle(i) {
  const n = FIRST_LATE + i;
  const d = draw.drawBattle(n);
  const rand = rng(seedOf(SEED, "play", n));
  const B = buildBattle(d, rand);
  const pick = (xs) => { let u = rand() * xs.reduce((a, x) => a + x.p, 0); for (const x of xs) { u -= x.p; if (u <= 0) return x; } return xs[xs.length - 1]; };
  let s = Bt.battleStart(B, 0);
  const seen = [0];
  const note = () => { if (!seen.includes(s.oppActive)) seen.push(s.oppActive); };
  let result = null, turn = 0, decisions = 0, switches = 0;
  const t0 = Date.now();
  for (; turn < TURN_CAP && !result; turn++) {
    let action = "stay";
    if (T.aliveBench(s).length > 0) {
      action = (await solve(B, s, specFor(d, n, s, seen), seedOf(SEED, "solve", n, turn))).action;
      decisions++;
      if (action !== "stay") switches++;
    }
    const r = pick(Bt.battleTurn(B, s, action));
    s = r.state; note();
    if (r.outcome === "replace") {
      const cands = T.aliveBench(s);
      let j = cands[0];
      if (cands.length > 1) {
        let bestV = -Infinity;
        for (const c of cands) {
          const sc = Bt.replaceYours(B, s, c);
          const v = (await solve(B, sc, specFor(d, n, sc, seen.includes(sc.oppActive) ? seen : [...seen, sc.oppActive]), seedOf(SEED, "repl", n, turn, c))).value;
          if (v > bestV) { bestV = v; j = c; }
        }
        decisions++;
      }
      s = Bt.replaceYours(B, s, j); note();
    } else if (r.outcome) {
      result = r.outcome;
    }
  }
  return { i, n, trainer: d.trainer, keys: d.keys, abilities: d.abilities, iv: d.iv, result: result ?? "turnCap", turns: turn,
    decisions, switches, youLeft: result === "win" ? 1 + T.aliveBench(s).length : 0, ms: Date.now() - t0 };
}

// ── main ───────────────────────────────────────────────────────────────────
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).i) : []);
const tStart = Date.now();
let played = 0;
try {
  for (let i = FROM; i < BATTLES; i++) {
    if (done.has(i)) continue;
    let line;
    try { line = await playBattle(i); }
    catch (e) { line = { i, n: FIRST_LATE + i, result: "error", error: e.message.slice(0, 200) }; }
    fs.appendFileSync(OUT, JSON.stringify(line) + "\n");
    played++;
    if (played % 5 === 0 || process.env.VERBOSE) {
      const mem = (process.memoryUsage().rss / 2 ** 30).toFixed(2);
      console.log(`${i} ${line.result} turns ${line.turns} decisions ${line.decisions} | ${played} played, ${((Date.now() - tStart) / played / 1000).toFixed(1)} s/battle, solves ${solves} (${(solveMs / Math.max(1, solves)).toFixed(0)} ms avg), cache hits ${cacheHits}, exact ${(exactMsSum / Math.max(1, solves)).toFixed(0)} ms avg, stops ${JSON.stringify(stopped)}, rss ${mem} GB`);
    }
  }
} finally {
  await Promise.all(pool.map((p) => p.terminate()));
}
