// ── sim/cb-report.mjs ──────────────────────────────────────────────────────
// Summarises sim/cb-grid.mjs: node sim/cb-report.mjs [results/screen/cb]
// Per team: win rate under each policy (95% Wilson), the CB user's KOs,
// turns locked into a resist and faints while locked. Then each CB user
// averaged over the 15 support pairs, each pair averaged over the CB
// users, and every CB user vs Metagross with the SAME pair on the same
// battles (paired: battles only one of them won, exact sign test).
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? "results/screen/cb");
const grid = JSON.parse(fs.readFileSync(path.join(dir, "grid.json"), "utf8"));
const load = (f) => fs.readFileSync(f, "utf8").trim().split("\n").map(JSON.parse);
function wilson(k, n, z = 1.96) {
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}
const pct = (x) => (100 * x).toFixed(1);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function signP(a, b) { // two-sided exact sign test on a vs b discordant counts
  const n = a + b, k = Math.min(a, b);
  // in logs: 2 ** n overflows past n = 1023 (the pooled counts here are ~2000)
  let t = 0, lc = 0; for (let j = 0; j <= k; j++) { if (j) lc += Math.log(n - j + 1) - Math.log(j); t += Math.exp(lc - n * Math.LN2); }
  return n ? Math.min(1, 2 * t) : 1;
}

const rows = grid.rows.map((r) => {
  const out = { ...r };
  for (const pol of ["stay", "type"]) {
    const ls = load(r[pol]).filter((l) => l.result !== "error");
    const w = ls.filter((l) => l.result === "win").length;
    out[pol + "W"] = w / ls.length; out[pol + "CI"] = wilson(w, ls.length); out[pol + "L"] = ls;
    out[pol + "Err"] = load(r[pol]).length - ls.length;
    out[pol + "Cb"] = { kos: mean(ls.map((l) => l.c[0].kos)), bad: mean(ls.map((l) => l.c[0].lockedBadTurns)), fl: mean(ls.map((l) => l.c[0].faintedLocked)) };
  }
  out.both = (out.stayW + out.typeW) / 2;
  return out;
});
rows.sort((a, b) => b.both - a.both);

console.log(`${grid.battles} battles a run, seed ${grid.seed}. Support items used: ${Object.entries(grid.pairItems).map(([k, v]) => `${k} = ${v.join(" / ")}`).join("; ")}\n`);
console.log("rank  team                                              stay              type              CB: KOs  resisted-turns  fainted-locked (type policy)");
rows.forEach((r, i) => {
  const t = `${r.cb} + ${r.x} + ${r.y}`;
  console.log(`${String(i + 1).padStart(3)}.  ${t.padEnd(48)} ${pct(r.stayW).padStart(5)} [${pct(r.stayCI[0])}-${pct(r.stayCI[1])}]  ${pct(r.typeW).padStart(5)} [${pct(r.typeCI[0])}-${pct(r.typeCI[1])}]  ${r.typeCb.kos.toFixed(2)}  ${r.typeCb.bad.toFixed(2)}  ${r.typeCb.fl.toFixed(2)}${r.stayErr + r.typeErr ? `  (${r.stayErr + r.typeErr} errors)` : ""}`);
});

const group = (key) => {
  const g = new Map();
  for (const r of rows) for (const k of [].concat(key(r))) { if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  return [...g.entries()].map(([k, rs]) => ({ k, stay: mean(rs.map((r) => r.stayW)), type: mean(rs.map((r) => r.typeW)), best: rs[0] })).sort((a, b) => b.stay + b.type - a.stay - a.type);
};
console.log("\nCB user, averaged over the 15 support pairs (its best pair):");
for (const g of group((r) => r.cb)) console.log(`  ${g.k.padEnd(11)} stay ${pct(g.stay)}  type ${pct(g.type)}   best: ${g.best.x} + ${g.best.y} (${pct(g.best.both)})`);
console.log("\nSupport mon, averaged over every team it is in:");
for (const g of group((r) => [r.x, r.y])) console.log(`  ${g.k.padEnd(11)} stay ${pct(g.stay)}  type ${pct(g.type)}`);
console.log(`\nSupport pair, averaged over the ${new Set(rows.map((r) => r.cb)).size} CB users:`);
for (const g of group((r) => `${r.x} + ${r.y}`)) console.log(`  ${g.k.padEnd(22)} stay ${pct(g.stay)}  type ${pct(g.type)}`);

console.log("\nEach CB user vs Metagross with the same pair (type policy; battles only one won; sign test):");
for (const cb of [...new Set(rows.map((r) => r.cb))].filter((c) => c !== "Metagross")) {
  let a = 0, b = 0;
  for (const r of rows.filter((x) => x.cb === cb)) {
    const m = rows.find((x) => x.cb === "Metagross" && x.x === r.x && x.y === r.y);
    const mBy = new Map(m.typeL.map((l) => [l.i, l.result]));
    for (const l of r.typeL) { const o = mBy.get(l.i); if (o == null) continue; if (l.result === "win" && o !== "win") a++; else if (l.result !== "win" && o === "win") b++; }
  }
  console.log(`  ${cb.padEnd(11)} only ${cb} won ${a}, only Metagross won ${b}  -> p = ${signP(a, b).toFixed(4)}`);
}
