// ── sim/legal.mjs ──────────────────────────────────────────────────────────
// Emerald move legality (user rule 2026-10-06: sets only from Emerald-legal
// sources), read straight from the decomp next door (../pokeemerald):
//   level-up  src/data/pokemon/level_up_learnsets.h (+ _pointers.h)
//   TM / HM   src/data/pokemon/tmhm_learnsets.h
//   tutor     src/data/pokemon/tutor_learnsets.h (Emerald's tutors)
//   egg       src/data/pokemon/egg_moves.h (on the base form)
// and every pre-evolution's lists (src/data/pokemon/evolution.h). Any level-up
// move counts (a higher-level mon is set to 50 in the Frontier, moves kept).
// NOT checked: egg-move COMBINATIONS (chain breeding), event-only moves,
// moves only from other games (FRLG / Colosseum / XD tutors) -- those are not
// Emerald sources and are reported as missing.
//
//   node sim/legal.mjs teams/x.txt     -> each mon's moves with their sources

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, "../../pokeemerald/src/data/pokemon");
const read = (f) => fs.readFileSync(path.join(DATA, f), "utf8");
export const squash = (x) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const speciesConst = (name) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/_$/, "");

let DB = null;
function load() {
  if (DB) return DB;
  const add = (map, sp, mv, src) => { const k = sp; if (!map.has(k)) map.set(k, new Map()); const m = map.get(k); if (!m.has(mv)) m.set(mv, new Set()); m.get(mv).add(src); };
  const own = new Map(); // species const -> squashed move -> sources
  // level-up
  const lists = new Map();
  for (const m of read("level_up_learnsets.h").matchAll(/static const u16 (s\w+LevelUpLearnset)\[\] = \{([\s\S]*?)\};/g)) {
    lists.set(m[1], [...m[2].matchAll(/LEVEL_UP_MOVE\(\s*\d+,\s*MOVE_(\w+)\)/g)].map((x) => squash(x[1])));
  }
  for (const m of read("level_up_learnset_pointers.h").matchAll(/\[SPECIES_(\w+)\]\s*=\s*(s\w+LevelUpLearnset)/g)) {
    for (const mv of lists.get(m[2]) ?? []) add(own, m[1], mv, "level-up");
  }
  // TM / HM
  // written as named fields: [SPECIES_X] = { .learnset = { .EARTHQUAKE = TRUE, ... } }
  for (const m of read("tmhm_learnsets.h").matchAll(/\[SPECIES_(\w+)\]\s*=\s*\{\s*\.learnset\s*=\s*\{([\s\S]*?)\}\s*\}/g)) {
    for (const x of m[2].matchAll(/\.(\w+)\s*=\s*TRUE/g)) add(own, m[1], squash(x[1]), "TM/HM");
  }
  // tutor
  for (const m of read("tutor_learnsets.h").matchAll(/\[SPECIES_(\w+)\]\s*=\s*\(([\s\S]*?)\)\s*,?\s*\n(?=\s*\[SPECIES_|\s*\};|\s*$)/g)) {
    for (const x of m[2].matchAll(/TUTOR\(MOVE_(\w+)\)/g)) add(own, m[1], squash(x[1]), "tutor");
  }
  // egg
  for (const m of read("egg_moves.h").matchAll(/egg_moves\((\w+),([\s\S]*?)\)/g)) {
    for (const x of m[2].matchAll(/MOVE_(\w+)/g)) add(own, m[1], squash(x[1]), "egg");
  }
  // pre-evolutions
  const pre = new Map();
  for (const m of read("evolution.h").matchAll(/\[SPECIES_(\w+)\]\s*=\s*\{([\s\S]*?)\}\},?\n/g)) {
    for (const x of m[2].matchAll(/SPECIES_(\w+)/g)) pre.set(x[1], m[1]);
  }
  DB = { own, pre };
  return DB;
}

// Every source of each move for `species` (its own lists and its
// pre-evolutions'), or [] when none.
export function sourcesOf(species, move) {
  const { own, pre } = load();
  let sp = speciesConst(species);
  if (!own.has(sp)) throw new Error(`legal: no learnset for species "${species}" (${sp})`);
  const out = [];
  for (let s = sp, via = ""; s; via = s, s = pre.get(s)) {
    const srcs = own.get(s)?.get(squash(move));
    if (srcs) for (const x of srcs) out.push(s === sp ? x : `${x} (as ${s})`);
  }
  return out;
}
export function checkMon(species, moves) {
  return moves.map((m) => ({ move: m, sources: sourcesOf(species, m) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const txt = fs.readFileSync(process.argv[2], "utf8");
  let bad = 0;
  for (const block of txt.split(/\r?\n\s*\r?\n/).filter((b) => b.trim())) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const species = lines[0].split("@")[0].replace(/\(.*?\)/g, "").trim();
    const moves = lines.filter((l) => l.startsWith("-")).map((l) => l.slice(1).trim().replace(/\s*\[.*\]$/, ""));
    for (const r of checkMon(species, moves)) {
      if (!r.sources.length) bad++;
      console.log(`${species.padEnd(12)} ${r.move.padEnd(16)} ${r.sources.length ? r.sources.join(", ") : "NOT LEGAL IN EMERALD"}`);
    }
  }
  process.exit(bad ? 1 : 0);
}
