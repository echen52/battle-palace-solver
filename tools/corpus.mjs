// tools/corpus.mjs — the fork-equivalence corpus.
//
// Walks a deterministic set of Frontier-vs-Frontier positions through an
// engine directory and returns one hash per probe. A probe is either the AI's
// decision at a position (aiTurnPlans) or one resolveTurn call. Run against the
// ORIGINAL Arena engine it produces the golden file; run against this repo's
// engine it must reproduce every hash, except for fields the fork removed on
// purpose (STRIP_KEYS -- the Arena's Mind / Skill judging state).
//
// Usage: node tools/corpus.mjs <engineDir> [--out file.json]

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

// The Arena judging state. The fork deletes it; everything else must match.
export const STRIP_KEYS = new Set(["mindYou", "mindOpp", "skillYou", "skillOpp",
  // Fields the fork ADDS (the player's AI's knowledge of the opponent). The
  // Arena engine has no such state; its absence there is not a difference.
  "oppAbilityRecord", "oppMoveHistory"]);
// The fork records MOVE_UNAVAILABLE into the AI's move history where the Arena
// engine recorded nothing (slot occupancy, engine/logic.js
// recordTargetMoveHistory). Dropped here; the AI probes still compare every
// decision made from those histories, which is what proves the reads equal.
const UNAVAILABLE = "(unavailable)";

function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canon = (v) => JSON.stringify(v, (k, x) => (STRIP_KEYS.has(k) ? undefined
  : k === "youMoveHistory" && Array.isArray(x) ? x.filter((m) => m !== UNAVAILABLE) : x));
// Rounded in BINARY: the probabilities are mostly dyadic (1/2, 1/16, 1/256...),
// which a decimal rounding can land exactly on the boundary of -- one merged
// sum 1 ULP off then flips the last digit. 2^-40 holds any dyadic up to that
// depth exactly and snaps float noise back onto it.
const round = (p) => Math.round(p * 2 ** 40) / 2 ** 40;
// A turn's result as a distribution over canonical states: labels dropped,
// branches that end in the same state merged. Returns [[p, stateString, state]]
// sorted by stateString, so the walk below cannot see how a result was split.
function mergeTurn(res) {
  const m = new Map();
  for (const r of res) {
    const k = canon(r.state);
    const e = m.get(k);
    if (e) e[0] += r.p; else m.set(k, [r.p, k, r.state]);
  }
  return [...m.values()].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
}
const md5 = (s) => createHash("md5").update(s).digest("hex");

export async function runCorpus(engineDir, { pairs = 1500, depth = 3, seed = 20261002 } = {}) {
  const url = (f) => pathToFileURL(path.resolve(engineDir, f)).href;
  const L = await import(url("logic.js"));
  const { FRONTIER_POOL } = await import(url("frontier-pool.js"));
  const { getOpponentConfig } = await import(url("opponent-adapter.js"));
  const names = Object.keys(FRONTIER_POOL).filter((n) => FRONTIER_POOL[n].lv50Legal);
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const cfg = (name) => {
    const e = FRONTIER_POOL[name];
    return getOpponentConfig(name, { ability: pick(e.abilities) });
  };
  const probes = [];
  const rec = (kind, id, fn, view = canon) => {
    let out;
    try { out = view(fn()); } catch (e) { out = "THROW:" + String(e.message).slice(0, 200); }
    if (process.env.CORPUS_DUMP && id === process.env.CORPUS_DUMP) console.log(out); // debugging: the probe's canonical output
    probes.push({ kind, id, h: md5(out), t: out.startsWith("THROW:") ? 1 : 0 });
  };
  for (let i = 0; i < pairs; i++) {
    const yName = pick(names), oName = pick(names);
    const you = L.buildMon(cfg(yName));
    const opp = L.buildMon({ ...cfg(oName), friendship: 255 });
    const ctx = { you, opp, noLabels: false };
    let state;
    try { state = L.buildStartState({ you, opp }); } catch (e) { probes.push({ kind: "start", id: `${i}`, h: md5("THROW:" + e.message) }); continue; }
    for (let d = 0; d < depth && state.yourHpPct > 0 && state.oppHpPct > 0; d++) {
      const id = `${i}:${yName}|${oName}:t${d + 1}`;
      let dec;
      try { dec = L.aiDecisionState(state); globalThis.__corpusDecision?.(dec); } catch (e) { rec("dec", id, () => { throw e; }); break; }
      let plans;
      rec("ai", id, () => (plans = L.aiTurnPlans(L.effectiveCtx(ctx, dec), dec)),
        (ps) => JSON.stringify(ps.map((pl) => [round(pl.p), pl.qc ?? null, pl.cands.map((c) => [c.move, round(c.prob)])])));
      if (!plans) break;
      const ec = L.effectiveCtx(ctx, dec);
      const yMoves = L.selectableMoves(ec.you.moves, dec, "you", ec.opp, "you");
      const forcedY = dec.youCharging?.move || dec.youRecharge?.move || dec.youLock?.move;
      const forcedO = dec.oppCharging?.move || dec.oppRecharge?.move || dec.oppLock?.move;
      const yMove = forcedY || pick(yMoves);
      const cands = plans.flatMap((p) => p.cands.map((c) => ({ ...c, qc: p.qc })));
      const oc = forcedO ? { move: forcedO, qc: undefined } : pick(cands);
      let res;
      rec("turn", `${id}:${yMove}/${oc.move}`, () => (res = mergeTurn(L.resolveTurn(ctx, dec, yMove, oc.move, { qc: oc.qc }))),
        (ms) => JSON.stringify(ms.map(([p, k]) => [round(p), k])));
      if (!res || res.length === 0) break;
      state = pick(res)[2];
    }
  }
  return probes;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: node tools/corpus.mjs <engineDir> [--out file]"); process.exit(2); }
  const oi = process.argv.indexOf("--out");
  const t0 = Date.now();
  const probes = await runCorpus(dir);
  const kinds = probes.reduce((m, p) => ((m[p.kind] = (m[p.kind] || 0) + 1), m), {});
  const throws = probes.filter((p) => p.t).length;
  console.log(`${probes.length} probes ${JSON.stringify(kinds)}, ${throws} named throws, in ${Date.now() - t0} ms`);
  if (oi > 0) writeFileSync(process.argv[oi + 1], JSON.stringify(probes, null, 0));
}
