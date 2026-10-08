// Perish Song on your side (user, 2026-10-08): your mon at perish count 0
// (it faints at this turn's end, src/battle_util.c:1843-1856) switches out
// when it can -- engine/solve.js perishSwitch in the rollouts, sim/streak.mjs
// in the sim's decisions -- and the player's switch check
// (src/battle_main.c:4240-4256, team.js youCanSwitch) in rootActions.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const T = await import(E("team.js"));
const X = await import(E("solve.js"));
const MC = await import(E("montecarlo.js"));
const { buildTeam } = await import(E("showdown.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (process.env.V) console.log(c ? "ok  " : "FAIL", m); if (c) pass++; else { fail++; console.log("FAIL", m); } };

const team = buildTeam(fs.readFileSync(path.join(here, "../teams/perish/Gengar-Blissey(BrightPowder)-Suicune(Lefties).txt"), "utf8"));
const opp = L.buildFrontierOpponent(getOpponentConfig("Snorlax 1", { ability: "Immunity", ivTier: 31, allowUnreachableTier: true }));
const tctx = { team, opp, oppReserves: 2 };
const s0 = T.teamStart(tctx, 0); // Gengar out
const sung = (s, you, them) => {
  const t = structuredClone(s);
  if (you != null) { L.setVf(t, "youPerishSonged", true); t.youPerishCount = you; }
  if (them != null) { L.setVf(t, "oppPerishSonged", true); t.oppPerishCount = them; }
  return t;
};
const trap = (s, k) => { const t = structuredClone(s); L.setVf(t, k, true); return t; };
const withAb = (a) => ({ ...tctx, opp: { ...opp, ability: a } });

// youCanSwitch: battle_main.c:4240-4256
ok(T.youCanSwitch(tctx, s0), "a free mon can switch");
ok(!T.youCanSwitch(tctx, trap(s0, "youCantEscape")), "Mean Look / Block / Spider Web: no");
ok(!T.youCanSwitch(tctx, { ...s0, youWrapped: { turns: 3 } }) && !T.youCanSwitch(tctx, { ...s0, youIngrained: true }), "wrapped / Ingrain: no");
ok(!T.youCanSwitch(withAb("Shadow Tag"), s0), "Shadow Tag: no");
ok(T.youCanSwitch(withAb("Arena Trap"), s0), "Arena Trap: Gengar (Levitate) still can");
const s1 = T.teamStart(tctx, 1); // Blissey out
ok(!T.youCanSwitch(withAb("Arena Trap"), s1), "Arena Trap: Blissey cannot");
ok(T.youCanSwitch(withAb("Magnet Pull"), s1), "Magnet Pull: only Steel types are held");
ok(JSON.stringify(X.rootActions(s0, withAb("Shadow Tag"))) === '["stay"]' && X.rootActions(s0, tctx).length === 3 && X.rootActions(s0).length === 3, "rootActions: trapped -> stay only; without tctx as before");

// perishSwitch
ok(X.perishSwitch(tctx, s0) === null, "no Perish Song: null");
ok(X.perishSwitch(tctx, sung(s0, 1, 1)) === null, "count 1: not yet");
ok(X.perishSwitch(tctx, { ...s0, youPerishCount: 0 }) === null, "a count of 0 without the Perish Song flag: null");
const ps = X.perishSwitch(tctx, sung(s0, 0, 0));
ok(ps && (ps.switchTo === 1 || ps.switchTo === 2), `count 0: switch out (${JSON.stringify(ps)})`);
ok(X.perishSwitch(withAb("Shadow Tag"), sung(s0, 0, 0)) === null, "count 0 but trapped: null");
const alone = structuredClone(sung(s0, 0, 0)); alone.youBench = alone.youBench.map((e) => (e ? { ...e, hpPct: 0 } : e));
ok(X.perishSwitch(tctx, alone) === null, "count 0, nobody left: null");
// the countdown itself: count 0 + stay -> Gengar faints at the turn's end
const stayTurn = T.teamTurn(tctx, sung(s0, 0, 2), "stay");
ok(stayTurn.every((r) => r.outcome === "replace" || r.state.yourHpPct <= 0), "count 0 and staying: Gengar faints at the turn's end");

// rollouts: the opponent's LAST mon, both at count 0 (it cannot switch: no
// reserves) -> with the rule your mon switches out and the opponent's dies
const last = { ...tctx, oppReserves: 0 };
let wins = 0, faintedGengar = 0;
const rand = MC.rng ? MC.rng(5) : Math.random;
for (let i = 0; i < 200; i++) {
  const r = MC.rollout(last, sung(s0, 0, 0), rand, { firstAction: "stay" });
  if (r.outcome === "win") wins++;
}
ok(wins >= 196, `last mon, both at count 0: rollouts switch out and win (${wins}/200)`);
// with teammates behind the opponent (Gengar alone at count 0), staying
// throws Gengar away: every switch beats it (and on the last mon above, staying
// would still win -- the opponent falls the same turn, you have mons left)
// (vs Starmie 4: the team holds its own there; vs Snorlax 1 it mostly loses
// and Gengar's survival barely moves the score)
const star = L.buildFrontierOpponent(getOpponentConfig("Starmie 4", { ability: "Illuminate", ivTier: 31, allowUnreachableTier: true }));
const tS = { team, opp: star, oppReserves: 2 }, sS = sung(T.teamStart(tS, 0), 0, null);
const sv = MC.solveMC(tS, sS, { budgetMs: 4000, seed: 2 });
const acts = X.rootActions(sS, tS), iStay = acts.indexOf("stay"), st = sv.levers[iStay];
ok(sv.levers.every((l, i) => i === iStay || l.score - l.margin > st.score + st.margin),
  `solve at count 0: every switch clearly above stay (${sv.levers.map((l) => `${l.score.toFixed(3)}±${l.margin.toFixed(3)}`).join(", ")})`);

// rollouts from that position switch Gengar out: their mean is the switches'
// level, not stay's (a rollout that stayed would sit near stay's 0.589)
let sum = 0; const rr = MC.rng(9);
for (let i = 0; i < 400; i++) sum += MC.rollout(tS, sS, rr, { firstAction: "stay" }).score;
ok(sum / 400 > 0.7, `rollouts at count 0 switch out: mean ${(sum / 400).toFixed(3)} (stay lever ${st.score.toFixed(3)})`);

console.log(`test-perish: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
