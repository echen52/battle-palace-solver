// Engine fixes the Palace fork makes to the Arena engine, each against its
// pokeemerald anchor.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(path.join(here, "../engine/logic.js")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b) => Math.abs(a - b) < 1e-12;
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mk = (species, nature, moves, ability, evs = {}) =>
  L.buildMon({ species, level: 50, nature, moves, ability, item: null, ivs: IV, evs, friendship: 255 });
const pOf = (res, f) => res.filter((r) => f(r.state)).reduce((a, r) => a + r.p, 0);

// ── Protect decay resets on a non-Protect last resulting move ──────────────
// Cmd_setprotectlike (src/battle_script_commands.c:6494-6501).
{
  const you = mk("Snorlax", "Adamant", ["Protect", "Body Slam"], "Thick Fat", { spe: 252 });
  const opp = mk("Slowbro", "Relaxed", ["Splash"], "Oblivious");
  const ctx = { you, opp, noLabels: true };
  const s0 = L.buildStartState({ you, opp });
  const protectedP = (st) => pOf(L.resolveTurn(ctx, st, "Protect", "Splash"), (x) => x.youProtectUses >= 1 && x.youLastResultingMove === "Protect" && x.youProtected !== undefined);
  // after Protect -> Body Slam, the counter (1) is stale and resets: 100%
  const afterOther = { ...s0, youProtectUses: 1, youLastResultingMove: "Body Slam" };
  const r1 = L.resolveTurn(ctx, afterOther, "Protect", "Splash");
  ok(near(pOf(r1, (x) => x.youProtectUses === 1), 1), "Protect after a non-Protect move: succeeds 100%, counter 0 -> 1");
  // after Protect -> Protect: 50%
  const afterProtect = { ...s0, youProtectUses: 1, youLastResultingMove: "Protect" };
  const r2 = L.resolveTurn(ctx, afterProtect, "Protect", "Splash");
  ok(near(pOf(r2, (x) => x.youProtectUses === 2), 0.5), "Protect after Protect: 50%");
  // Endure shares the chain
  const afterEndure = { ...s0, youProtectUses: 1, youLastResultingMove: "Endure" };
  ok(near(pOf(L.resolveTurn(ctx, afterEndure, "Protect", "Splash"), (x) => x.youProtectUses === 2), 0.5), "Protect after Endure: 50% (shared chain)");
  // a prevented action leaves MOVE_UNAVAILABLE: the chain resets
  const afterPrevented = { ...s0, youProtectUses: 2, youLastResultingMove: null };
  ok(near(pOf(L.resolveTurn(ctx, afterPrevented, "Protect", "Splash"), (x) => x.youProtectUses === 1), 1), "Protect after an UNAVAILABLE turn: 100%");
  // the state records the executed move
  ok(r1.every((r) => r.state.youLastResultingMove === "Protect"), "the last resulting move is recorded");
  void protectedP;
}

// ── Destiny Bond lasts until the bonded mon's own next action ──────────────
// CANCELER_FLAGS (src/battle_util.c:2010-2011).
{
  const ghost = mk("Misdreavus", "Timid", ["Destiny Bond", "Psywave"], "Levitate");             // slow here
  const fast = mk("Jolteon", "Timid", ["Thunderbolt"], "Volt Absorb", { spa: 252, spe: 252 });   // faster
  const ctx = { you: ghost, opp: fast, noLabels: true };
  const s0 = L.buildStartState({ you: ghost, opp: fast });
  // Last turn the slower ghost bonded. This turn the faster foe KOs it before it acts.
  const bonded = { ...s0, youDestinyBondActive: true, yourHpPct: (1 / ghost.stats.hp) * 100 };
  const res = L.resolveTurn(ctx, bonded, "Psywave", "Thunderbolt");
  const pKO = pOf(res, (x) => x.yourHpPct <= 0);
  ok(pKO > 0 && near(pOf(res, (x) => x.yourHpPct <= 0 && x.oppHpPct <= 0), pKO),
    "a bond from last turn takes down a faster foe that KOs before the ghost acts");
  // If the ghost acts first this turn, its canceler clears the bond.
  const slowFoe = mk("Slowbro", "Quiet", ["Psychic"], "Oblivious", { spa: 252 }); // slower, and not a Normal move into a Ghost
  const ctx2 = { you: mk("Misdreavus", "Timid", ["Destiny Bond", "Psywave"], "Levitate", { spe: 252 }), opp: slowFoe, noLabels: true };
  const s2 = { ...L.buildStartState({ you: ctx2.you, opp: slowFoe }), youDestinyBondActive: true, yourHpPct: (1 / ctx2.you.stats.hp) * 100 };
  const res2 = L.resolveTurn(ctx2, s2, "Psywave", "Psychic");
  const pKO2 = pOf(res2, (x) => x.yourHpPct <= 0);
  ok(pKO2 > 0 && pOf(res2, (x) => x.yourHpPct <= 0 && x.oppHpPct <= 0) === 0,
    "acting first clears the bond (CANCELER_FLAGS) before the foe's KO");
  // A Palace loaf never reaches the canceler: the bond survives it.
  const res3 = L.resolveTurn(ctx2, s2, "Psywave", "Psychic", { loaf: { you: "escape", opp: null } });
  const pKO3 = pOf(res3, (x) => x.yourHpPct <= 0);
  ok(pKO3 > 0 && near(pOf(res3, (x) => x.yourHpPct <= 0 && x.oppHpPct <= 0), pKO3), "a loaf keeps the bond up");
}

console.log(`${fail ? "FAIL" : "ok"}  engine fixes: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
