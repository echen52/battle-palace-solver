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
export const STRIP_KEYS = new Set(["mindYou", "mindOpp", "skillYou", "skillOpp"]);

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

const canon = (v) => JSON.stringify(v, (k, x) => (STRIP_KEYS.has(k) ? undefined : x));
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
  const rec = (kind, id, fn) => {
    let out;
    try { out = canon(fn()); } catch (e) { out = "THROW:" + String(e.message).slice(0, 200); }
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
      try { dec = L.aiDecisionState(state); } catch (e) { rec("dec", id, () => { throw e; }); break; }
      let plans;
      rec("ai", id, () => (plans = L.aiTurnPlans(L.effectiveCtx(ctx, dec), dec)));
      if (!plans) break;
      const ec = L.effectiveCtx(ctx, dec);
      const yMoves = L.selectableMoves(ec.you.moves, dec, "you", ec.opp, "you");
      const forcedY = dec.youCharging?.move || dec.youRecharge?.move || dec.youLock?.move;
      const forcedO = dec.oppCharging?.move || dec.oppRecharge?.move || dec.oppLock?.move;
      const yMove = forcedY || pick(yMoves);
      const cands = plans.flatMap((p) => p.cands.map((c) => ({ ...c, qc: p.qc })));
      const oc = forcedO ? { move: forcedO, qc: undefined } : pick(cands);
      let res;
      rec("turn", `${id}:${yMove}/${oc.move}`, () => (res = L.resolveTurn(ctx, dec, yMove, oc.move, { qc: oc.qc })));
      if (!res || res.length === 0) break;
      state = pick(res).state;
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
