// ── sim/cb-grid.mjs ────────────────────────────────────────────────────────
// Phase F question 4 (user, 2026-10-06): which Choice Band users, with which
// two support mons, through the cheap screen (sim/screen.mjs).
//
//   node sim/cb-grid.mjs [--battles 1000] [--seed 1] [--out results/screen/cb]
//
// CB users (lead, slot 0): Metagross (teams/user-test-team.txt, the known
// baseline) + the user's five in teams/cb/all-sets.txt. Supports: Swampert,
// Latios, Suicune (the user's team files) + Snorlax, Registeel, Regice.
// Items: the Frontier forbids two of the same item; when a pair clashes the
// user allowed Leftovers / Lum Berry / Chesto Berry (Chesto only on a Rest
// user). Stage 1 screens every clash-free assignment of a clashing pair (with
// Metagross leading, type policy) and keeps the best; stage 2 runs every CB
// user x support pair under both policies on the same battles.
// Each run's JSONL lands in --out; a run already there is not redone.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseShowdownTeam } from "../engine/showdown.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const BATTLES = Number(args.battles ?? 1000), SEED = Number(args.seed ?? 1);
const OUT = path.resolve(root, args.out ?? "results/screen/cb");
fs.mkdirSync(path.join(OUT, "teams"), { recursive: true });

// Showdown blocks by species, from the user's files.
const blocks = new Map();
for (const f of ["teams/user-test-team.txt", "teams/mlsuicune.txt", "teams/cb/all-sets.txt"]) {
  const txt = fs.readFileSync(path.join(root, f), "utf8").replace(/\r/g, "");
  for (const b of txt.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
    const sp = b.split("\n")[0].split("@")[0].trim();
    if (!blocks.has(sp)) blocks.set(sp, b);
  }
}
const CB = ["Metagross", "Heracross", "Ursaring", "Aerodactyl", "Slaking", "Tauros"];
const SUPPORT = ["Swampert", "Latios", "Suicune", "Snorlax", "Registeel", "Regice"];
for (const sp of [...CB, ...SUPPORT]) if (!blocks.has(sp)) throw new Error(`cb-grid: no set for ${sp}`);
const itemOf = (sp) => blocks.get(sp).split("\n")[0].split("@")[1].trim();
const withItem = (sp, item) => blocks.get(sp).replace(/^(.*?)@.*$/m, `$1@ ${item}`);
const restUser = (sp) => parseShowdownTeam(blocks.get(sp))[0].moves.includes("Rest");
const options = (sp) => ["Leftovers", "Lum Berry", ...(restUser(sp) ? ["Chesto Berry"] : [])];

function screen(name, mons, policy) {
  const out = path.join(OUT, `${name}-${policy}.jsonl`);
  if (fs.existsSync(out)) return out;
  const teamFile = path.join(OUT, "teams", `${name}.txt`);
  fs.writeFileSync(teamFile, mons.join("\n\n") + "\n");
  const msg = execFileSync("node", [path.join(here, "screen.mjs"), "--team", teamFile, "--battles", String(BATTLES), "--seed", String(SEED), "--policy", policy, "--out", out], { encoding: "utf8" });
  process.stdout.write(`  ${msg}`);
  return out;
}
const lines = (f) => fs.readFileSync(f, "utf8").trim().split("\n").map(JSON.parse);
const winRate = (f) => { const ls = lines(f).filter((l) => l.result !== "error"); return ls.filter((l) => l.result === "win").length / ls.length; };
const tag = (sp, item) => `${sp}(${item.replace(" Berry", "").replace("Leftovers", "Lefties")})`;

// ── stage 1: each support pair's items ──
const pairs = [];
for (let a = 0; a < SUPPORT.length; a++) for (let b = a + 1; b < SUPPORT.length; b++) pairs.push([SUPPORT[a], SUPPORT[b]]);
const pairItems = new Map();
console.log(`stage 1: items for the ${pairs.length} support pairs (Metagross leading, type policy)`);
for (const [x, y] of pairs) {
  if (itemOf(x) !== itemOf(y)) { pairItems.set(`${x}+${y}`, [itemOf(x), itemOf(y)]); continue; }
  let best = null;
  for (const ix of options(x)) for (const iy of options(y)) {
    if (ix === iy || ix === "Choice Band" || iy === "Choice Band") continue;
    const name = `Metagross-${tag(x, ix)}-${tag(y, iy)}`;
    const w = winRate(screen(name, [blocks.get("Metagross"), withItem(x, ix), withItem(y, iy)], "type"));
    console.log(`    ${x} ${ix} / ${y} ${iy}: ${(100 * w).toFixed(1)}%`);
    if (!best || w > best.w) best = { w, items: [ix, iy] };
  }
  pairItems.set(`${x}+${y}`, best.items);
  console.log(`  ${x} + ${y}: ${best.items.join(" / ")}`);
}

// ── stage 2: every CB user x pair, both policies ──
console.log(`stage 2: ${CB.length} CB users x ${pairs.length} pairs x 2 policies`);
const rows = [];
for (const cb of CB) for (const [x, y] of pairs) {
  const [ix, iy] = pairItems.get(`${x}+${y}`);
  const name = `${cb}-${tag(x, ix)}-${tag(y, iy)}`;
  const mons = [blocks.get(cb), withItem(x, ix), withItem(y, iy)];
  const r = { cb, x, y, ix, iy, name };
  for (const pol of ["stay", "type"]) r[pol] = screen(name, mons, pol);
  rows.push(r);
}
fs.writeFileSync(path.join(OUT, "grid.json"), JSON.stringify({ battles: BATTLES, seed: SEED, pairItems: Object.fromEntries(pairItems), rows }, null, 1));
console.log(`done: ${rows.length} teams -> ${path.join(OUT, "grid.json")}`);
