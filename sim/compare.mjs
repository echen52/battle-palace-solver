// ── sim/compare.mjs ────────────────────────────────────────────────────────
// Two (or more) streak-sim result files side by side, paired by battle:
//   node sim/compare.mjs results/swampert.jsonl results/suicune.jsonl
// Per team: battles, wins, P(win) with a 95% Wilson range, the expected late
// streak 1/(1-p) - 1 battles won before the first loss (with the range from
// p's), mons left after a win, turns, switches; errors and turn caps apart.
// For two files: the battles both finished, and the ones only one won (an
// exact two-sided sign test on those).
import fs from "node:fs";
import path from "node:path";
import { trainerLabel } from "./trainer-name.mjs";

const files = process.argv.slice(2);
if (files.length < 1) throw new Error("usage: node sim/compare.mjs a.jsonl [b.jsonl ...]");
const load = (f) => new Map(fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).map((l) => [l.i, l]));
const runs = files.map((f) => ({ name: path.basename(f, ".jsonl"), by: load(f) }));

function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}
const streak = (p) => (p >= 1 ? Infinity : p / (1 - p)); // battles won before the first loss
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "inf");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

for (const r of runs) {
  const ls = [...r.by.values()];
  const played = ls.filter((l) => l.result === "win" || l.result === "lose" || l.result === "turnCap");
  const wins = played.filter((l) => l.result === "win");
  const [lo, hi] = wilson(wins.length, played.length);
  const p = wins.length / played.length;
  console.log(`${r.name}: ${played.length} battles, ${wins.length} won -> P(win) ${(100 * p).toFixed(2)}% [${(100 * lo).toFixed(2)}, ${(100 * hi).toFixed(2)}]`
    + ` | late streak ~${fmt(streak(p))} [${fmt(streak(lo))}, ${fmt(streak(hi))}]`
    + ` | mons left after a win ${fmt(mean(wins.map((l) => l.youLeft)), 2)} | turns ${fmt(mean(played.map((l) => l.turns)))}`
    + ` | switches/battle ${fmt(mean(played.map((l) => l.switches)), 2)}`
    + ` | turn caps ${ls.filter((l) => l.result === "turnCap").length}, errors ${ls.filter((l) => l.result === "error").length}`);
  const losses = played.filter((l) => l.result !== "win");
  if (losses.length) console.log(`   lost to: ${losses.map((l) => `${l.n} ${trainerLabel(l.trainer)} (${l.keys.join("/")})`).join("; ")}`);
  const errs = ls.filter((l) => l.result === "error");
  if (errs.length) console.log(`   errors: ${[...new Set(errs.map((l) => l.error))].join(" | ")}`);
  // the screen's per-slot counters (sim/screen-core.mjs), per battle played
  if (played.length && played[0].c) {
    played[0].mons.forEach((sp, j) => {
      const cs = played.map((l) => l.c[j]), per = (f) => fmt(mean(cs.map(f)), 2);
      const firstKO = cs.map((x) => x.boostAtFirstKO).filter((x) => x !== null);
      const st = {};
      for (const x of cs) for (const e of x.status) st[e.status] = (st[e.status] ?? 0) + 1;
      const stTxt = Object.entries(st).map(([k, v]) => `${k} ${fmt(v / played.length, 2)}`).join(", ") || "none";
      console.log(`   ${sp}: KOs ${per((x) => x.kos)} | max boost ${per((x) => x.maxBoost)}, at 1st KO ${fmt(mean(firstKO), 2)} | statuses dealt ${stTxt}`
        + ` | Destiny Bond ${per((x) => x.dbUsed)} used, ${per((x) => x.dbKOs)} KOs | Choice-locked into a resist ${per((x) => x.lockedBadTurns)} turns, fainted locked ${per((x) => x.faintedLocked)}`);
    });
  }
}

if (runs.length === 2) {
  const [a, b] = runs;
  const both = [...a.by.keys()].filter((i) => b.by.has(i) && ["win", "lose", "turnCap"].includes(a.by.get(i).result) && ["win", "lose", "turnCap"].includes(b.by.get(i).result));
  const aOnly = both.filter((i) => a.by.get(i).result === "win" && b.by.get(i).result !== "win");
  const bOnly = both.filter((i) => b.by.get(i).result === "win" && a.by.get(i).result !== "win");
  // exact two-sided sign test on the discordant battles
  const n = aOnly.length + bOnly.length, k = Math.min(aOnly.length, bOnly.length);
  let tail = 0;
  for (let j = 0; j <= k; j++) { let c = 1; for (let t = 0; t < j; t++) c = (c * (n - t)) / (t + 1); tail += c / 2 ** n; }
  const pVal = n ? Math.min(1, 2 * tail) : 1;
  console.log(`\npaired over ${both.length} battles both finished: only ${a.name} won ${aOnly.length}, only ${b.name} won ${bOnly.length} -> sign test p = ${pVal.toFixed(3)}`);
  const left = both.filter((i) => a.by.get(i).result === "win" && b.by.get(i).result === "win");
  console.log(`both won ${left.length}: mons left ${a.name} ${fmt(mean(left.map((i) => a.by.get(i).youLeft)), 3)} vs ${b.name} ${fmt(mean(left.map((i) => b.by.get(i).youLeft)), 3)}`);
}
