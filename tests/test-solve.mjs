// Phase C step 2: the exact attempt (engine/solve.js), against a brute-force
// depth-first expansion that merges nothing, on short fights with the user's
// team; the replacement rule; the budget and the open frontier.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const T = await import(E("team.js"));
const S = await import(E("score.js"));
const X = await import(E("solve.js"));
const SD = await import(E("showdown.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const team = SD.buildTeam(fs.readFileSync(path.join(here, "../teams/user-test-team.txt"), "utf8"));
const opp = L.buildMon(getOpponentConfig("Salamence 1", { ability: "Intimidate", ivTier: 12 }));
const tctx = { team, opp };
const start = T.teamStart(tctx, 0);

// Brute force: every path, nothing merged, same policy (stay; the shared
// replacement rule after a faint), cut at `cap` turns -- what is still going
// then is "open".
const dfsCache = new Map(); // its own; keyed by the whole position, so it cannot change an answer
function dfs(s, action, cap, turn = 0) {
  const out = { score: 0, pKO: 0, pOppLeft: 0, pLose: 0, open: 0 };
  if (turn >= cap) { out.open = 1; return out; }
  for (const r of T.teamTurn(tctx, s, action)) {
    let st = r.state;
    if (r.outcome && r.outcome !== "replace") {
      out.score += r.p * S.scoreState(tctx, st, r.outcome).score;
      if (r.outcome === "win") out.pKO += r.p; else if (r.outcome === "oppLeft") out.pOppLeft += r.p; else out.pLose += r.p;
      continue;
    }
    if (r.outcome === "replace") st = T.replace(tctx, st, X.chooseReplacement(tctx, st, undefined, dfsCache));
    const sub = dfs(st, "stay", cap, turn + 1);
    for (const k of Object.keys(out)) out[k] += r.p * sub[k];
  }
  return out;
}
const same = (ex, bf) => near(ex.score, bf.score) && near(ex.pKO, bf.pKO) && near(ex.pLose, bf.pLose) && near(ex.pOppLeft, bf.pOppLeft)
  && near(ex.complete ? 0 : ex.open, bf.open);

// ── exact, against brute force ─────────────────────────────────────────────
{
  // Both sides worn down; 2 turns (unmerged paths grow ~500x a turn), every lever (the switch levers include a
  // switch turn and, after a faint, the replacement rule).
  const s = { ...start, oppHpPct: 12, yourHpPct: 15, youBench: start.youBench.map((e) => e && { ...e, hpPct: 10 }) };
  for (const action of X.rootActions(s)) {
    const ex = X.solveAction(tctx, s, action, { budgetMs: 60000, maxTurns: 2 });
    const bf = dfs(s, action, 2);
    ok(near(ex.pKO + ex.pOppLeft + ex.pLose + (ex.complete ? 0 : ex.open), 1), `${JSON.stringify(action)}: finished + open = 1`);
    ok(same(ex, bf), `${JSON.stringify(action)}, 2 turns: equals brute force (score ${ex.score.toFixed(6)} vs ${bf.score.toFixed(6)}, KO ${ex.pKO.toFixed(6)} vs ${bf.pKO.toFixed(6)}, open ${(ex.open ?? 0).toFixed(6)} vs ${bf.open.toFixed(6)}; ${ex.positions} positions)`);
  }
  // From the real start: 2 turns.
  const ex = X.solveAction(tctx, start, "stay", { budgetMs: 60000, maxTurns: 2 });
  const bf = dfs(start, "stay", 2);
  ok(ex.stoppedBy === "maxTurns" && same(ex, bf), `the real start, 2 turns: equals brute force (open ${ex.open.toFixed(6)}, ${ex.positions} positions)`);
  // A fight that does finish: Salamence (Dragon/Flying) at 1% in a permanent
  // sandstorm faints at the end of turn 1 on every path, whatever happens
  // before. Complete, one turn, and equal to brute force run to the end.
  const sand = { ...start, oppHpPct: 1, weatherType: "sandstorm", weatherTurns: null };
  const c = X.solveAction(tctx, sand, "stay", { budgetMs: 60000 });
  const cb = dfs(sand, "stay", 2);
  ok(c.complete && near(c.turns, 1) && near(cb.open, 0) && same(c, cb), `opponent at 1% in sand: complete in 1 turn, equals brute force (KO ${c.pKO.toFixed(4)}, lose ${c.pLose.toFixed(4)})`);
}

// ── the replacement rule ───────────────────────────────────────────────────
{
  const s = { ...start, yourHpPct: 0 };
  const j = X.chooseReplacement(tctx, s);
  const val = (k) => T.teamTurn(tctx, T.replace(tctx, s, k), "stay").reduce((a, r) => a + r.p * S.scoreState(tctx, r.state, r.outcome).score, 0);
  const vals = T.aliveBench(s).map((k) => [k, val(k)]);
  const bestV = Math.max(...vals.map((v) => v[1]));
  ok(j === vals.find((v) => v[1] === bestV)[0], `the replacement is the best next turn (${vals.map((v) => `${team[v[0]].species} ${v[1].toFixed(4)}`).join(", ")})`);
  const one = { ...s, youBench: s.youBench.map((e, i) => (i === 1 ? { ...e, hpPct: 0 } : e)) };
  ok(X.chooseReplacement(tctx, one) === 2, "one mon left: that one");
  const cache = new Map();
  ok(X.chooseReplacement(tctx, s, undefined, cache) === j && cache.size === 1 && X.chooseReplacement(tctx, s, undefined, cache) === j, "the cache answers the same");
}

// ── the budget and the frontier ────────────────────────────────────────────
{
  const t0 = Date.now();
  const r = X.solveAction(tctx, start, "stay", { budgetMs: 300 });
  const took = Date.now() - t0;
  ok(!r.complete && took < 300 + 500, `a full fight does not finish in 300 ms; it stops (${took} ms, ${r.turnsDone} turns done)`);
  const openP = r.frontier.reduce((a, f) => a + f.p, 0);
  ok(near(openP, r.open) && near(r.open + r.pKO + r.pOppLeft + r.pLose, 1), `finished + open = 1 (open ${r.open.toFixed(4)})`);
  ok(r.frontier.every((f) => f.state.yourHpPct > 0 && f.state.oppHpPct > 0), "the frontier holds live positions only");
  const all = X.solveExact(tctx, start, { budgetMs: 900 });
  ok(all.length === 3 && all.map((a) => JSON.stringify(a.action)).join() === '"stay",{"switchTo":1},{"switchTo":2}', "levers: stay, switch to Latios, switch to Swampert");
  ok(all.every((a) => a.complete || a.ms > 0), "every lever got some of the budget");
}

console.log(`test-solve: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
