// The damage roll (user decision 2026-10-05, option 1): the inherited exact
// mode (ctx.exactRoll, the 16 rolls of every landed hit) and the PALACE FORK
// sampled mode (ctx.rollSample, one drawn roll per hit) that rollouts use.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { Worker } from "node:worker_threads";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const T = await import(E("team.js"));
const X = await import(E("solve.js"));
const M = await import(E("montecarlo.js"));
const MP = await import(E("montecarlo-parallel.js"));
const SD = await import(E("showdown.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const throws = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };

const team = SD.buildTeam(fs.readFileSync(path.join(here, "../teams/user-test-team.txt"), "utf8"));
const opp = L.buildMon(getOpponentConfig("Salamence 1", { ability: "Intimidate", ivTier: 12 }));
const tctx = { team, opp };
const start = T.teamStart(tctx, 0);
const pKO = (rs) => rs.filter((r) => r.outcome === "win").reduce((a, r) => a + r.p, 0);
const meanOpp = (rs) => rs.reduce((a, r) => a + r.p * r.state.oppHpPct, 0);

// ── the exact mode, through the team layer ─────────────────────────────────
{
  const point = T.teamTurn(tctx, start, "stay");
  const exact = T.teamTurn({ ...tctx, exactRoll: true }, start, "stay");
  ok(near(exact.reduce((a, r) => a + r.p, 0), 1), `16 rolls: one turn sums to 1 (${exact.length} outcomes vs ${point.length})`);
  const dPoint = new Set(point.map((r) => r.state.oppHpPct)).size, dExact = new Set(exact.map((r) => r.state.oppHpPct)).size;
  ok(dExact > dPoint, `more distinct opponent HP values (${dExact} vs ${dPoint})`);
  // At a KO threshold the point estimate is wrong: scan the opponent's HP for
  // a value where the 92.5% roll never KOs on turn 1 but the top rolls do.
  let found = null;
  for (let hp = 30; hp <= 100 && !found; hp++) {
    const s = { ...start, oppHpPct: hp };
    const a = pKO(T.teamTurn(tctx, s, "stay")), b = pKO(T.teamTurn({ ...tctx, exactRoll: true }, s, "stay"));
    if (b > a + 0.01) found = { hp, a, b };
  }
  ok(found, `a KO threshold the point estimate misses: opponent at ${found?.hp}% -- P(KO turn 1) point ${found?.a.toFixed(3)}, 16 rolls ${found?.b.toFixed(3)}`);
}

// ── sampled = enumerated, in distribution ──────────────────────────────────
{
  const exact = T.teamTurn({ ...tctx, exactRoll: true }, start, "stay");
  const rand = M.rng(2024);
  const n = 3000;
  let ko = 0, sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const rs = T.teamTurn({ ...tctx, rollSample: rand }, start, "stay");
    // the two-stage draw: rolls drawn inside, one branch drawn by probability
    let u = rand(), acc = 0, r = rs[rs.length - 1];
    for (const x of rs) { acc += x.p; if (u < acc) { r = x; break; } }
    if (r.outcome === "win") ko++;
    sum += r.state.oppHpPct; sumSq += r.state.oppHpPct ** 2;
  }
  const q = ko / n, se = Math.sqrt((pKO(exact) * (1 - pKO(exact))) / n);
  ok(Math.abs(q - pKO(exact)) < 3 * se, `P(KO turn 1): drawn ${q.toFixed(4)} vs enumerated ${pKO(exact).toFixed(4)} (3 sd ${(3 * se).toFixed(4)})`);
  const m = sum / n, sd = Math.sqrt(sumSq / n - m * m);
  ok(Math.abs(m - meanOpp(exact)) < 3 * sd / Math.sqrt(n), `mean opponent HP after turn 1: drawn ${m.toFixed(3)} vs enumerated ${meanOpp(exact).toFixed(3)}`);
  // rollout() itself, in the exact roll mode, cut at one turn: at the opponent
  // HP where the point estimate is furthest off (60%: 74.5% vs 66.7%), it
  // must reproduce the 16-roll answer.
  {
    const s60 = { ...start, oppHpPct: 60 };
    const ex = pKO(T.teamTurn({ ...tctx, exactRoll: true }, s60, "stay")), pt = pKO(T.teamTurn(tctx, s60, "stay"));
    const rr = M.rng(77); let k = 0; const N2 = 3000;
    for (let i = 0; i < N2; i++) if (M.rollout({ ...tctx, exactRoll: true }, s60, rr, { turnCap: 1 }).outcome === "win") k++;
    const se2 = Math.sqrt((ex * (1 - ex)) / N2);
    ok(Math.abs(k / N2 - ex) < 3 * se2 && Math.abs(k / N2 - pt) > 3 * se2, `rollout() draws the rolls: P(KO) ${(k / N2).toFixed(4)} vs 16 rolls ${ex.toFixed(4)}, not the point estimate's ${pt.toFixed(4)}`);
  }
  const rs = T.teamTurn({ ...tctx, rollSample: M.rng(1) }, start, "stay");
  ok(rs.length === T.teamTurn(tctx, start, "stay").length && near(rs.reduce((a, r) => a + r.p, 0), 1), "a drawn turn has the point estimate's branch count and sums to 1");
}

// ── multi-hit into a Substitute ────────────────────────────────────────────
{
  // Geodude 1's Rock Blast (2-5 hits) into Latios behind a Substitute: the
  // grouped exact path refuses it by name; the drawn path rolls each hit.
  const geo = L.buildMon(getOpponentConfig("Geodude 1", { ability: "Rock Head", ivTier: 3 }));
  const tg = { team, opp: geo };
  const s = { ...T.teamStart(tg, 1), youSubstituteHP: 40 };
  ok(throws(() => T.teamTurn({ ...tg, exactRoll: true }, s, "stay"), /Substitute, Endure or Focus Band/), "exact: Rock Blast into a Substitute is refused by name");
  const rs = T.teamTurn({ ...tg, rollSample: M.rng(3) }, s, "stay");
  ok(near(rs.reduce((a, r) => a + r.p, 0), 1), "drawn: it runs, and sums to 1");
  // Per-hit draws match the grouped enumeration where both run: a Geodude
  // that knows only Rock Blast, into Latios with no Substitute -- the mean of
  // Latios's HP after one turn.
  {
    const rb = L.buildMon({ ...getOpponentConfig("Geodude 1", { ability: "Rock Head", ivTier: 3 }), moves: ["Rock Blast"] });
    const tr = { team, opp: rb };
    const s1 = T.teamStart(tr, 1);
    const ex = T.teamTurn({ ...tr, exactRoll: true }, s1, "stay");
    const exMean = ex.reduce((a, r) => a + r.p * r.state.yourHpPct, 0);
    const rr = M.rng(55), N3 = 3000; let sum = 0, sq = 0;
    for (let i = 0; i < N3; i++) {
      const rs = T.teamTurn({ ...tr, rollSample: rr }, s1, "stay");
      let u = rr(), acc = 0, r = rs[rs.length - 1];
      for (const x of rs) { acc += x.p; if (u < acc) { r = x; break; } }
      sum += r.state.yourHpPct; sq += r.state.yourHpPct ** 2;
    }
    const m = sum / N3, sd = Math.sqrt(sq / N3 - m * m);
    ok(Math.abs(m - exMean) < 3 * sd / Math.sqrt(N3), `Rock Blast into Latios: drawn per hit ${m.toFixed(3)}% vs grouped enumeration ${exMean.toFixed(3)}% (3 se ${(3 * sd / Math.sqrt(N3)).toFixed(3)})`);
  }
  const r = M.rollout({ ...tg, exactRoll: true }, s, M.rng(4));
  ok(["win", "lose", "oppLeft", "capped"].includes(r.outcome) || r.outcome === "win", `a whole rollout from there finishes (${r.outcome} in ${r.turns} turns)`);
}

// ── the solver's roll mode, end to end ─────────────────────────────────────
{
  const tx = { ...tctx, exactRoll: true };
  const root = X.solveAction(tx, start, "stay", { budgetMs: 60000, maxTurns: 1 });
  const rootPoint = X.solveAction(tctx, start, "stay", { budgetMs: 60000, maxTurns: 1 });
  ok(root.frontier.length > rootPoint.frontier.length, `the exact first turn enumerates the rolls (${root.frontier.length} open positions vs ${rootPoint.frontier.length})`);
  // A worker with the roll mode reproduces the main thread digit for digit.
  const seed = 11, n = 25;
  const rand = M.rng(seed), sample = M.frontierSampler(root), mine = M.newTally();
  for (let i = 0; i < n; i++) M.addTo(mine, M.rollout(tx, sample(rand()), rand, {}));
  const w = new Worker(new URL(E("mc-worker.js")), { workerData: { team, opp, exactRoll: true, nextInSpec: null, nextInWarm: null, weights: undefined, frontiers: [root.frontier] } });
  const theirs = await new Promise((res, rej) => { w.on("message", (m) => res(m.tally)); w.on("error", rej); w.postMessage({ lever: 0, n, seed }); });
  await w.terminate();
  ok(JSON.stringify(theirs) === JSON.stringify(mine), "a worker draws the same rolls as the main thread");
  const r = await MP.solveFight(tctx, start, { budgetMs: 15000, workers: 4 });
  ok(r.levers.length === 3 && r.levers.every((l) => l.exactOpen === 0 || l.rollouts >= 100), `solveFight (exact rolls by default): ${r.stoppedBy} in ${r.ms} ms`);
  ok(throws(() => MP.solveFight(tctx, start, { rolls: "rough" }), /rolls must be/), "an unknown roll mode throws");
  // The replacement rule ignores the roll mode (point-estimate lookahead).
  const dead = { ...start, yourHpPct: 0 };
  ok(X.chooseReplacement(tx, dead) === X.chooseReplacement(tctx, dead), "the replacement rule is the same in either roll mode");
}

console.log(`test-rolls: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
