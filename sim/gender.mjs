// ── sim/gender.mjs ─────────────────────────────────────────────────────────
// Each mon's gender, drawn ONCE per battle (user, 2026-10-07: the engine
// splits every Attract use by the gender odds, so within one battle a mon's
// gender could differ from one Attract to the next).
//
// Decomp: every Frontier mon (trainers: CreateMonWithEVSpreadNatureOTID,
// src/pokemon.c:2570-2573; Frontier Brains: src/frontier_util.c:2524-2527)
// gets a random personality, re-drawn until its nature matches. Its gender is
// female when species_info.h's genderRatio byte is above the personality's
// low byte (GetGenderFromSpeciesAndPersonality, src/pokemon.c:3471-3485), and
// genderRatio = PERCENT_FEMALE(x) = min(254, (x * 255) / 100) truncated to a
// u8 (src/data/pokemon/species_info.h:3): 12.5% -> 31, 25 -> 63, 50 -> 127,
// 75 -> 191; P(female) = byte / 256. The ability bit is bit 0 of the same
// personality (draw.mjs), so for a two-ability species the low byte's parity
// is that bit.
//
// The thresholds are read from the decomp next door (../pokeemerald), not
// engine/gender-data.js, whose values round 63.75 -> 64 and divide by 255.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rng } from "../engine/montecarlo.js";
import { seedOf } from "./draw.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SPECIES_INFO = path.join(here, "../../pokeemerald/src/data/pokemon/species_info.h");
const speciesConst = (name) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/_$/, "");

let RATIO = null; // SPECIES const -> "male" | "female" | "genderless" | threshold byte
function load() {
  if (RATIO) return RATIO;
  RATIO = new Map();
  const src = fs.readFileSync(SPECIES_INFO, "utf8");
  for (const m of src.matchAll(/\[SPECIES_(\w+)\]\s*=\s*\{([\s\S]*?)\n\s{4}\},/g)) {
    const g = m[2].match(/\.genderRatio\s*=\s*(MON_MALE|MON_FEMALE|MON_GENDERLESS|PERCENT_FEMALE\(([\d.]+)\))/);
    if (!g) continue;
    RATIO.set(m[1], g[1] === "MON_MALE" ? "male" : g[1] === "MON_FEMALE" ? "female" : g[1] === "MON_GENDERLESS" ? "genderless"
      : Math.min(254, Math.floor((Number(g[2]) * 255) / 100)));
  }
  return RATIO;
}

export function genderThreshold(species) {
  const r = load().get(speciesConst(species));
  if (r === undefined) throw new Error(`gender: no genderRatio for ${species}`);
  return r;
}

// "male" | "female" | "genderless" for one mon of battle n. side: "you" or
// "opp"; slot: its party slot; abilityBit: 0/1 for a two-ability species (the
// personality's bit 0), null otherwise.
export function genderOf(seed, n, side, slot, species, abilityBit = null) {
  const t = genderThreshold(species);
  if (typeof t === "string") return t;
  return genderFromLow(t, lowByte(rng(seedOf(seed, "gender", side, n, slot))(), abilityBit));
}
// The personality's low byte from a [0,1) draw: uniform, or with bit 0 fixed
// to the ability bit.
export const lowByte = (u, abilityBit = null) => (abilityBit == null ? Math.floor(u * 256) : abilityBit + 2 * Math.floor(u * 128));
// GetGenderFromSpeciesAndPersonality (src/pokemon.c:3481): female iff
// genderRatio > low byte.
export const genderFromLow = (threshold, low) => (threshold > low ? "female" : "male");

// A built mon with its gender fixed (the engine reads genderDist).
export const withGender = (mon, gender) => ({ ...mon, genderDist: [{ p: 1, gender }] });
