// Scratch: re-solve a dumped sim state and print every lever in full.
import fs from "node:fs";
import { Worker } from "node:worker_threads";
import * as L from "../engine/logic.js";
import * as Bt from "../engine/battle.js";
import * as N from "../engine/next-in.js";
import { buildTeam } from "../engine/showdown.js";
import { getOpponentConfig } from "../engine/opponent-adapter.js";
import { rootActions } from "../engine/solve.js";
import { runSolve } from "../engine/solve-core.js";
const [file, idx = "0", teamFile = "teams/user-test-team.txt"] = process.argv.slice(2);
const D = JSON.parse(fs.readFileSync(file, "utf8").trim().split("\n")[Number(idx)]);
const team = buildTeam(fs.readFileSync(teamFile, "utf8"));
const B = { team, oppTeam: D.keys.map((k, i) => L.buildFrontierOpponent(getOpponentConfig(k, { ability: D.abilities[i], ivTier: null, allowUnreachableTier: true }))), oppIds: D.keys.map(N.setId) };
// JSON drops undefined fields; put them back from a fresh battle's keys
const s = { ...Object.fromEntries(Object.keys(Bt.battleStart(B, 0)).map((k) => [k, undefined])), ...D.s };
console.log(`battle ${D.n} turn ${D.turn}; spec ${JSON.stringify(D.spec)}; oppActive ${s.oppActive} reserves ${Bt.aliveOpp(s).length}; you ${s.youActive}`);
const pool = Array.from({ length: 12 }, () => { const w = new Worker(new URL("../engine/mc-worker.js", import.meta.url)); let f = () => {}; w.on("message", (m) => f(m)); return { post: (m) => w.postMessage(m), onMessage: (g) => { f = g; }, terminate: () => w.terminate() }; });
const actions = rootActions(s);
const ni = D.spec ? N.makeNextIn(D.spec) : null;
for (const spec of [D.spec, null]) {
  const r = await runSolve({ pool, actions, budgetMs: 3000, seed: 7, init: { team: B.team, opp: B.oppTeam[s.oppActive], oppReserves: Bt.aliveOpp(s).length, exactRoll: true, nextInSpec: spec, nextInWarm: spec ? ni.exportCache() : null, start: [{ p: 1, state: s }] } });
  console.log(`-- nextIn ${spec ? "on" : "off"}: stoppedBy ${r.stoppedBy}, exact root ${r.exactMs} ms, total ${r.ms} ms`);
  for (const [i, l] of r.levers.entries()) console.log(JSON.stringify(actions[i]), ["score", "pKO", "pLose", "pOppLeft", "turns", "rollouts", "exactOpen"].map((k) => `${k} ${(+l[k]).toFixed(3)}`).join(" "));
}
await Promise.all(pool.map((p) => p.terminate()));
