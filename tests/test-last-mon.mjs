// The score on the opponent's last mon (engine/score.js lastMonWin; user,
// 2026-10-08), end to end on the position that prompted it: streak battle 120
// (Blissey team, seed 1) turn 14 -- Salamence 93/170 locked into Earthquake vs
// Heracross 1/155 (+1 Spe, Salac), its last mon; Blissey 330/330 behind.
// Played out (4,000 games a line): staying won 40%, switching to Blissey and
// leaving it in (Salamence back unlocked after it falls) 89%. The old score
// valued the HP left and picked stay (0.185 vs 0.101); P(win) picks Blissey.
// Solved as a sim worker does (tctx = team, opp, oppReserves, exactRoll).
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const Bt = await import(E("battle.js"));
const MC = await import(E("montecarlo.js"));
const { buildTeam } = await import(E("showdown.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

const D = JSON.parse(fs.readFileSync(path.join(here, "fixtures/b120-turn14.json"), "utf8"));
const team = buildTeam(fs.readFileSync(path.join(here, "../teams/cb/salamence-suicune-blissey.txt"), "utf8"));
const oppTeam = D.keys.map((k, i) => L.buildFrontierOpponent(getOpponentConfig(k, { ability: D.abilities[i], ivTier: 31, allowUnreachableTier: true })));
const B = { team, oppTeam };
// JSON drops undefined fields; put them back from a fresh battle's keys
const s = { ...Object.fromEntries(Object.keys(Bt.battleStart(B, 0)).map((k) => [k, undefined])), ...D.s };
ok(team[s.youActive].species === "Salamence" && oppTeam[s.oppActive].species === "Heracross" && Bt.aliveOpp(s).length === 0, "the position: Salamence vs Heracross, its last mon");

const tctx = { team, opp: oppTeam[s.oppActive], oppReserves: 0, exactRoll: true };
const actions = (await import(E("solve.js"))).rootActions(s);
const iStay = actions.indexOf("stay"), iBli = actions.findIndex((a) => a.switchTo === 2);
for (const [weights, name, want] of [[undefined, "P(win) (default)", iBli], [{ lastMonWin: false }, "old HP-keeping score", iStay]]) {
  const r = MC.solveMC(tctx, s, { weights, budgetMs: 8000, seed: 3 });
  const [st, bl] = [r.levers[iStay], r.levers[iBli]];
  const other = want === iBli ? st : bl, best = r.levers[want];
  ok(best.score - best.margin > other.score + other.margin,
    `${name}: ${want === iBli ? "switch to Blissey" : "stay"} clearly ahead (stay ${st.score.toFixed(3)}±${st.margin.toFixed(3)}, Blissey ${bl.score.toFixed(3)}±${bl.margin.toFixed(3)}; ${r.stoppedBy})`);
  if (!weights) ok(bl.score > 0.8 && st.score < 0.55, `P(win) levers near the played-out 89% / 40% (Blissey ${bl.score.toFixed(3)}, stay ${st.score.toFixed(3)})`);
}

console.log(`test-last-mon: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
