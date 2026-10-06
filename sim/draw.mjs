// ── sim/draw.mjs ───────────────────────────────────────────────────────────
// Who you face in battle n of a streak (late pool), from the decomp
// (src/battle_tower.c): each challenge's trainers via
// GetRandomScaledFrontierTrainerId -- from challenge 8 on, always range 7 --
// with no repeat within the challenge (SetNextFacilityOpponent :1051-1100);
// each party by FillTrainerParty (:1633-1745: draw from the trainer's set
// list, rejecting a high-tier set, a repeated species, a repeated held item
// (ITEM_NONE exempt) or a repeated set; slot 0 leads; the trainer's fixed IVs);
// each ability by the personality bit (CreateMonWithEVSpreadNatureOTID: 50/50
// for a two-ability species). Spenser Gold at battle 63, 84, ... (both
// symbols held: GetFrontierBrainStatus, src/frontier_util.c:1656-1691).
// Battle n's draw depends only on (seed, n).

import { rng } from "../engine/montecarlo.js";
import * as N from "../engine/next-in.js";
import { FRONTIER_TRAINERS, TRAINER_ID_RANGES } from "../engine/frontier-trainers.js";

const HIGH_TIER = 849;
export const FIRST_LATE = 50; // battle 50 = challenge 8, battle 1
export const seedOf = (...parts) => { let h = 2166136261; for (const c of parts.join("|")) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const challengeOf = (n) => Math.ceil(n / 7);
export const stageOf = (n) => ((n - 1) % 7) + 1;
export const isSpenser = (n) => n > 42 && (n - 42) % 21 === 0;

export function makeDraw(seed) {
  const trainerCache = new Map();
  function challengeTrainers(c) {
    if (c < 8) throw new Error(`draw: challenge ${c} is not the late pool`);
    if (trainerCache.has(c)) return trainerCache.get(c);
    const rand = rng(seedOf(seed, "challenge", c));
    const [lo, hi] = TRAINER_ID_RANGES[7];
    const ids = [];
    for (let b = 1; b <= 7; b++) {
      if (isSpenser(7 * (c - 1) + b)) { ids.push(null); continue; }
      let id;
      do id = lo + Math.floor(rand() * (hi - lo + 1)); while (ids.includes(id));
      ids.push(id);
    }
    trainerCache.set(c, ids);
    return ids;
  }
  function drawBattle(n) {
    const rand = rng(seedOf(seed, "party", n));
    const ability = (key) => { const ab = N.poolEntry(N.setId(key)).abilities; return ab[Math.floor(rand() * ab.length)]; };
    if (isSpenser(n)) {
      const keys = N.BRAIN_TEAMS["Spenser Gold"];
      return { n, trainer: "Spenser Gold", keys, abilities: keys.map(ability), iv: null };
    }
    const tid = challengeTrainers(challengeOf(n))[stageOf(n) - 1];
    const set = FRONTIER_TRAINERS[tid].monSet;
    const ids = [];
    while (ids.length < 3) {
      const m = set[Math.floor(rand() * set.length)];
      if (m > HIGH_TIER) continue;
      const e = N.poolEntry(m);
      if (ids.some((c) => N.poolEntry(c).species === e.species)) continue;
      if (e.item != null && ids.some((c) => N.poolEntry(c).item === e.item)) continue;
      if (ids.includes(m)) continue;
      ids.push(m);
    }
    const keys = ids.map((m) => N.poolEntry(m).key);
    return { n, trainer: tid, keys, abilities: keys.map(ability), iv: N.fixedIvs(tid) };
  }
  return { drawBattle, challengeTrainers };
}
