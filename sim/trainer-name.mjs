// ── sim/trainer-name.mjs ───────────────────────────────────────────────────
// A Frontier trainer's in-game title (user, 2026-10-07: the trainer's name on
// the battle logs), e.g. 225 -> "Cooltrainer Miriam". Read from the decomp
// next door (../pokeemerald): the trainer's facility class and name
// (engine/frontier-trainers.js, generated from
// src/data/battle_frontier/battle_frontier_trainers.h), the facility class's
// trainer class (gFacilityClassToTrainerClass,
// src/data/pokemon/trainer_class_lookups.h) and that class's display name
// (gTrainerClassNames, src/data/text/trainer_class_names.h). Shown in title
// case; the game prints both in capitals ("{PKMN}" -> "Pkmn").

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FRONTIER_TRAINERS } from "../engine/frontier-trainers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "../../pokeemerald", f), "utf8");
const title = (s) => s.replace(/\{PKMN\}/g, "PKMN").toLowerCase().replace(/(^|[ -])([a-z])/g, (_, a, b) => a + b.toUpperCase());

let CLASS = null; // FACILITY_CLASS suffix -> display name
function load() {
  if (CLASS) return CLASS;
  const names = new Map();
  for (const m of read("src/data/text/trainer_class_names.h").matchAll(/\[(TRAINER_CLASS_\w+)\]\s*=\s*_\("([^"]*)"\)/g)) names.set(m[1], m[2]);
  CLASS = new Map();
  for (const m of read("src/data/pokemon/trainer_class_lookups.h").matchAll(/\[FACILITY_CLASS_(\w+)\]\s*=\s*(TRAINER_CLASS_\w+)/g)) {
    if (!CLASS.has(m[1]) && names.has(m[2])) CLASS.set(m[1], title(names.get(m[2])));
  }
  return CLASS;
}

// id: a FRONTIER_TRAINER_* index, or "Spenser Gold"/"Spenser Silver"
export function trainerName(id) {
  const brain = typeof id === "string" && id.match(/^Spenser (\w+)$/);
  if (brain) return `Palace Maven Spenser (${brain[1]})`;
  const t = FRONTIER_TRAINERS[id];
  if (!t) return String(id);
  const cls = load().get(t.cls);
  return `${cls ?? title(t.cls.replace(/_/g, " "))} ${title(t.name)}`;
}

// for logs: "225 Cooltrainer Miriam"; a Frontier Brain without the id
export const trainerLabel = (id) => (typeof id === "number" ? `${id} ${trainerName(id)}` : trainerName(id));
