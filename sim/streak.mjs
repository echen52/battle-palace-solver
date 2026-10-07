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
import { makeDraw, seedOf, challengeOf, stageOf, isSpenser, FIRST_LATE } from "./draw.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const TEAM_FILE = args.team, OUT = args.out;
const BATTLES = Number(args.battles ?? 1000), SEED = Number(args.seed ?? 1), FROM = Number(args.from ?? 0);
const BUDGET = Number(args.budget ?? 3000), WORKERS = Number(args.workers ?? Math.min(12, os.cpus().length - 1));
const TURN_CAP = 400;
// --only 63,84 / --only spenser: play just those battle numbers (n);
// --trace <file>: write each turn (both mons, HP, the levers' scores, what
// happened) as text.
const ONLY = args.only == null ? null : args.only === "spenser" ? "spenser" : new Set(args.only.split(",").map(Number));
const TRACE = args.trace ?? null;
const trace = (line) => { if (TRACE) fs.appendFileSync(TRACE, line + "\n"); };
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
  const out = { action: actions[best], value: r.levers[best].score, levers: r.levers.map((l, i) => [actions[i], l.score, l.margin]), stoppedBy: r.stoppedBy };
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
  const name = (a) => (a === "stay" ? "stay" : `switch to ${B.team[a.switchTo].species}`);
  const extra = (st, side) => {
    const bits = [];
    if (st[side + "Status"]) bits.push(st[side + "Status"]);
    const stg = Object.entries(st[side + "Stages"] ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
    if (stg.length) bits.push(stg.join(" "));
    if (st[side + "SubstituteHP"] > 0) bits.push("Sub");
    return bits.length ? ` [${bits.join(", ")}]` : "";
  };
  // HP in points (the engine keeps HP as a percentage of max HP)
  const hp = (pct, mon) => `${Math.round((pct * mon.stats.hp) / 100)}/${mon.stats.hp}`;
  const where = (st) => `${B.team[st.youActive].species} ${hp(st.yourHpPct, B.team[st.youActive])}${extra(st, "you")} vs ${B.oppTeam[st.oppActive].species} ${hp(st.oppHpPct, B.oppTeam[st.oppActive])}${extra(st, "opp")}`
    + (B.oppTeam[st.oppActive].ability === "Truant" ? (L.vf(st, "oppTruantLoaf") ? " (Slaking loafs next)" : " (Slaking acts next)") : "");
  // the rest of the field, for the trace: both benches, weather, items, side effects
  const field = (st) => {
    const bench = (mons, b) => b.map((x, j) => (x ? `${mons[j].species} ${hp(x.hpPct, mons[j])}${x.status ? ` ${x.status}` : ""}${x.berryConsumed ? " (berry used)" : ""}` : null)).filter(Boolean).join(", ") || "none";
    const bits = [];
    if (st.weatherType) bits.push(`weather ${st.weatherType}${st.weatherTurns ? ` (${st.weatherTurns} turns left)` : ""}`);
    for (const side of ["you", "opp"]) {
      const mon = side === "you" ? B.team[st.youActive] : B.oppTeam[st.oppActive], it = [];
      if (st[side + "BerryConsumed"]) it.push(`${mon.item} consumed`);
      // usedHeldItems is kept per battle SLOT (Recycle's memory), not per mon
      else if (st[side + "UsedItem"]) it.push(`slot used a ${st[side + "UsedItem"]} earlier`);
      if (st[side + "ChoiceLock"] != null) it.push(`locked into ${mon.moves[st[side + "ChoiceLock"]] ?? st[side + "ChoiceLock"]}`);
      if (st[side + "SpikesLayers"]) it.push(`Spikes x${st[side + "SpikesLayers"]}`);
      if (st[side + "ReflectTurns"]) it.push(`Reflect ${st[side + "ReflectTurns"]}`);
      if (st[side + "LightScreenTurns"]) it.push(`Light Screen ${st[side + "LightScreenTurns"]}`);
      if (st[side + "Seeded"]) it.push("Leech Seeded");
      if (st[side + "Confused"]) it.push("confused");
      if (st[side + "Cursed"]) it.push("Cursed");
      if (st[side + "Attracted"]) it.push("infatuated");
      if (st[side + "YawnTurns"]) it.push(`drowsy (Yawn ${st[side + "YawnTurns"]})`);
      if (st[side + "TauntTurns"]) it.push(`Taunted ${st[side + "TauntTurns"]}`);
      if (st[side + "EncoreTurns"]) it.push(`Encored ${st[side + "EncoreTurns"]}`);
      if (st[side + "DisableTurns"]) it.push(`Disabled ${st[side + "DisableTurns"]}`);
      if (st[side + "PerishCount"] != null) it.push(`Perish ${st[side + "PerishCount"]}`);
      if (st[side + "Status"] === "sleep" && st[side + "SleepTurns"] != null) it.push(`sleep counter ${st[side + "SleepTurns"]}`);
      if (st[side + "Status"] === "toxic" || st[side + "ToxicCounter"]) it.push(`toxic counter ${st[side + "ToxicCounter"]}`);
      if (st[side + "PalaceLowHp"]) it.push("Palace low-HP row");
      if (it.length) bits.push(`${side === "you" ? "yours" : "theirs"}: ${it.join(", ")}`);
    }
    return `bench: yours ${bench(B.team, st.youBench)} | theirs ${bench(B.oppTeam, st.oppBench)}${bits.length ? ` | ${bits.join("; ")}` : ""}`;
  };
  const setLine = (m) => `${m.species} @ ${m.item} | ${m.ability} | ${m.nature} | HP ${m.stats.hp} Atk ${m.stats.atk} Def ${m.stats.def} SpA ${m.stats.spa} SpD ${m.stats.spd} Spe ${m.stats.spe} | ${m.moves.join(" / ")}`;
  trace(`\n=== battle ${n}: trainer ${d.trainer} (${d.keys.join(" / ")}; ${d.abilities.join(" / ")}; IVs ${d.iv}) ===`);
  if (TRACE) { for (const m of B.oppTeam) trace(`  theirs: ${setLine(m)}`); for (const m of B.team) trace(`  yours:  ${setLine(m)}`); }
  for (; turn < TURN_CAP && !result; turn++) {
    let action = "stay", levers = null, stopBy = null;
    const before = where(s);
    if (T.aliveBench(s).length > 0) {
      const sv = await solve(B, s, specFor(d, n, s, seen), seedOf(SEED, "solve", n, turn));
      action = sv.action; levers = sv.levers; stopBy = sv.stoppedBy;
      if (process.env.DUMP_LOW && sv.value < Number(process.env.DUMP_LOW)) fs.appendFileSync(TRACE + ".states", JSON.stringify({ n, turn: turn + 1, spec: specFor(d, n, s, seen), abilities: d.abilities, keys: d.keys, s }) + "\n");
      decisions++;
      if (action !== "stay") switches++;
    }
    const r = pick(Bt.battleTurn(B, s, action));
    s = r.state; note();
    trace(`turn ${turn + 1}: ${before} -> ${name(action)}${levers ? `  [${levers.map(([a, v, m]) => `${name(a)} ${v.toFixed(3)}${m ? `±${m.toFixed(3)}` : ""}`).join(", ")}; ${stopBy}]` : ""}`
      + `\n    you: ${r.chose?.you ?? "-"} | they: ${r.chose?.opp ?? "-"}${r.label && r.label.trim() !== ";" ? `  (${r.label.trim()})` : ""}\n    now ${where(s)}\n    ${field(s)}`);
    if (r.outcome === "replace") {
      const cands = T.aliveBench(s);
      let j = cands[0], replVals = null;
      if (cands.length > 1) {
        let bestV = -Infinity;
        replVals = [];
        for (const c of cands) {
          const sc = Bt.replaceYours(B, s, c);
          const v = (await solve(B, sc, specFor(d, n, sc, seen.includes(sc.oppActive) ? seen : [...seen, sc.oppActive]), seedOf(SEED, "repl", n, turn, c))).value;
          replVals.push(`${B.team[c].species} ${v.toFixed(3)}`);
          if (v > bestV) { bestV = v; j = c; }
        }
        decisions++;
      }
      s = Bt.replaceYours(B, s, j); note();
      trace(`    fainted -> send in ${B.team[j].species}${replVals ? ` [${replVals.join(", ")}]` : ""}; now ${where(s)}\n    ${field(s)}`);
    } else if (r.outcome) {
      result = r.outcome;
    }
  }
  trace(`result: ${result ?? "turnCap"}`);
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
    if (ONLY === "spenser" ? !isSpenser(FIRST_LATE + i) : ONLY && !ONLY.has(FIRST_LATE + i)) continue;
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
