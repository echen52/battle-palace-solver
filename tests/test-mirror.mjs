// The Palace runs the ROM's AI for BOTH battlers, and the player's decision is
// made by mirroring the position (engine/mirror.js). That is only sound if the
// battle engine is side-symmetric, so this test checks it on real positions:
//
//   1. INVOLUTION   mirrorState(mirrorState(s)) equals s, for every state.
//   2. BATTLE       resolveTurn(ctx, s, a, b), and the mirror image of
//                   resolveTurn(mirrorCtx(ctx), mirrorState(s), b, a), are the
//                   same distribution over states (labels ignored, equal end
//                   states merged, |dp| <= 1e-9).
//   3. AI           the opponent's AI on mirrorState(s), deciding for the
//                   player's mon, gives the same answer as the player-side
//                   entry point (palace layer) -- checked in test-palace.
//
// Known source-backed asymmetries are listed in KNOWN with their anchor; any
// other difference fails.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const { mirrorState, mirrorCtx } = await import(E("mirror.js"));
const { FRONTIER_POOL } = await import(E("frontier-pool.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

// Source-backed asymmetries (pair key -> anchor). None found yet.
const KNOWN = {};

let x = 99;
const r = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(r() * a.length)];
const names = Object.keys(FRONTIER_POOL).filter((n) => FRONTIER_POOL[n].lv50Legal);
const mk = (n) => L.buildMon({ ...getOpponentConfig(n, { ability: pick(FRONTIER_POOL[n].abilities) }), friendship: 255 });

const canon = (v) => JSON.stringify(v);
function dist(res, swap) {
  const m = new Map();
  for (const b of res) {
    const k = canon(swap ? mirrorState(b.state) : b.state);
    m.set(k, (m.get(k) ?? 0) + b.p);
  }
  return m;
}
function sameDist(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, p] of a) if (!b.has(k) || Math.abs(b.get(k) - p) > 1e-9) return false;
  return true;
}

let inv = 0, invFail = 0, turns = 0, asym = 0, known = 0, throwsBoth = 0, throwOne = 0;
const fails = [];
for (let i = 0; i < 600; i++) {
  const yName = pick(names), oName = pick(names);
  const you = mk(yName), opp = mk(oName);
  const ctx = { you, opp, noLabels: true };
  let s;
  try { s = L.buildStartState({ you, opp }); } catch { continue; }
  for (let d = 0; d < 4 && s.yourHpPct > 0 && s.oppHpPct > 0; d++) {
    inv++;
    if (canon(mirrorState(mirrorState(s))) !== canon(s)) { invFail++; break; }
    const ec = L.effectiveCtx(ctx, s);
    const forcedY = s.youCharging?.move || s.youRecharge?.move || s.youLock?.move;
    const forcedO = s.oppCharging?.move || s.oppRecharge?.move || s.oppLock?.move;
    let a, b;
    try {
      a = forcedY || pick(L.selectableMoves(ec.you.moves, s, "you", ec.opp, "you"));
      b = forcedO || pick(L.selectableMoves(ec.opp.moves, s, "opp", ec.you, "the opponent"));
    } catch { break; }
    let r1, r2, e1, e2;
    try { r1 = L.resolveTurn(ctx, s, a, b); } catch (e) { e1 = e.message; }
    try { r2 = L.resolveTurn(mirrorCtx(ctx), mirrorState(s), b, a); } catch (e) { e2 = e.message; }
    turns++;
    const id = `${yName} vs ${oName} t${d + 1}: ${a} / ${b}`;
    if (e1 || e2) {
      if (e1 && e2) throwsBoth++;
      else { throwOne++; fails.push(`${id}: throws on one side only: ${e1 ?? e2}`); }
      break;
    }
    if (!sameDist(dist(r1, false), dist(r2, true))) {
      if (KNOWN[`${a}|${b}`]) known++;
      else { asym++; fails.push(id); }
    }
    s = pick(r1).state;
  }
}
for (const f of fails.slice(0, 15)) console.log("FAIL", f);
const bad = invFail + asym + throwOne;
console.log(`${bad ? "FAIL" : "ok"}  mirror: involution ${inv - invFail}/${inv}; battle symmetric ${turns - asym - known - throwOne}/${turns} ` +
  `(${known} known-asymmetric, ${throwsBoth} throw on both sides, ${asym} ASYMMETRIC, ${throwOne} one-sided throws)`);
process.exit(bad ? 1 : 0);
