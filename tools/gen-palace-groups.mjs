// tools/gen-palace-groups.mjs — the Palace group of every move, straight from
// pokeemerald's src/data/battle_moves.h (.target and .power) through
// GetBattlePalaceMoveGroup's switch (src/battle_gfx_sfx_util.c:296-318),
// written as tests/fixtures/palace-groups.json for test-palace.mjs. This path
// does NOT go through the engine's move-flags.js / move-data.js, so the test
// compares two independent derivations.
//
// It also cross-checks against the Palace Predictor's vendored reference data
// (palace_predictor_sim/vendor/pokemon-data.js, PALACE_DATA moveClasses -- the
// 300-move pool verified against source in that project's Phase 1), when that
// repo is present next to this one.
//
// usage: node tools/gen-palace-groups.mjs [pokeemeraldDir]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const emerald = process.argv[2] ?? path.resolve(root, "../pokeemerald");
const src = readFileSync(path.join(emerald, "src/data/battle_moves.h"), "utf8");
const { MOVES } = await import("file:///" + path.join(root, "engine/move-data.js").replace(/\\/g, "/"));

const norm = (s) => String(s).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const byNorm = new Map(Object.keys(MOVES).map((n) => [norm(n), n]));

const GROUP = (target, power) => {
  switch (target) {
    case "MOVE_TARGET_SELECTED": case "MOVE_TARGET_USER_OR_SELECTED": case "MOVE_TARGET_RANDOM":
    case "MOVE_TARGET_BOTH": case "MOVE_TARGET_FOES_AND_ALLY":
      return power === 0 ? "support" : "attack";
    case "MOVE_TARGET_DEPENDS": case "MOVE_TARGET_OPPONENTS_FIELD":
      return "support";
    case "MOVE_TARGET_USER":
      return "defense";
    default:
      return "attack";
  }
};

const out = {};
const unmatched = [];
const re = /\[MOVE_([A-Z0-9_]+)\]\s*=\s*\{([^}]*)\}/g;
for (const m of src.matchAll(re)) {
  const body = m[2];
  const target = body.match(/\.target\s*=\s*(MOVE_TARGET_[A-Z_]+)/)?.[1];
  const power = Number(body.match(/\.power\s*=\s*(\d+)/)?.[1] ?? NaN);
  if (!target || Number.isNaN(power)) throw new Error(`MOVE_${m[1]}: no target/power parsed`);
  const name = byNorm.get(norm(m[1]));
  if (!name) { unmatched.push(m[1]); continue; }
  out[name] = GROUP(target, power);
}

// Cross-check against the predictor's verified pool, if present.
const refPath = path.resolve(root, "../palace_predictor_sim/vendor/pokemon-data.js");
let refChecked = 0;
if (existsSync(refPath)) {
  const refData = JSON.parse(readFileSync(refPath, "utf8").match(/const PALACE_DATA = (\[.*?\]);/s)[1]);
  const L = { ATK: "attack", DEF: "defense", SPT: "support" };
  const seen = new Set();
  for (const e of refData) for (const mc of e.moveClasses) {
    const mm = typeof mc === "string" && mc.match(/^(.*)\s+(ATK|DEF|SPT)$/);
    if (!mm) continue;
    const name = byNorm.get(norm(mm[1]));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (out[name] !== L[mm[2]]) throw new Error(`predictor reference disagrees on ${name}: source ${out[name]}, ref ${L[mm[2]]}`);
    refChecked++;
  }
}

mkdirSync(path.join(root, "tests/fixtures"), { recursive: true });
writeFileSync(path.join(root, "tests/fixtures/palace-groups.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`${Object.keys(out).length} moves grouped from battle_moves.h; unmatched source entries: ${unmatched.join(", ") || "none"}; ` +
  `predictor reference agrees on ${refChecked}/${refChecked}`);
