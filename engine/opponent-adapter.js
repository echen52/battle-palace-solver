// ── opponent-adapter.js (v2) ───────────────────────────────────────────────
// Converts a named entry from opponent-full-data.js into a config object
// ready for buildMon()/analyzeMatchup(). This version uses the complete
// dataset (converted from EmeraldBattleFrontierComplete.xlsx), which has
// every set's real EVs and precomputed stats built in — no more "EVs not
// known yet" errors for anything already in the spreadsheet.

import { SPECIES } from "./species-data.js";
// B1: the pool is now frontier-pool.js -- the full 928-entry universe keyed by
// (mon, IV tier). opponent-full-data.js is RETIRED and kept only as lineage;
// see arena-solver/docs/pool-provenance.md. The retired pool's 552 sets are
// reproduced exactly by the new one (verified field-for-field; the only
// differences are 12 ability SPELLINGS, "Lightning Rod" vs "Lightningrod",
// which the engine checks neither way).
import { FRONTIER_POOL, IV_TIERS } from "./frontier-pool.js";
import { buildMon } from "./logic.js";

// setName: exact key from opponent-full-data.js, e.g. "Umbreon 4" or
// "Greta Gold Umbreon"
// opts.level: defaults to 50 (Frontier standard mode)
// opts.ability: required only if the set has more than one possible ability
function getOpponentConfig(setName, opts = {}) {
  const level = opts.level ?? 50;

  const entry = FRONTIER_POOL[setName];
  if (!entry) {
    throw new Error(`No entry named "${setName}" found in frontier-pool.js — check spelling/exact name.`);
  }

  const dex = SPECIES[entry.species];
  if (!dex) {
    throw new Error(
      `"${setName}" is species "${entry.species}", which isn't in species-data.js yet. ` +
      `Add its base stats/types/abilities there first.`
    );
  }

  let ability = opts.ability;
  if (!ability) {
    if (entry.abilities.length === 1) {
      ability = entry.abilities[0];
    } else {
      throw new Error(
        `"${setName}" has ${entry.abilities.length} possible abilities ` +
        `(${entry.abilities.join(" / ")}), and Frontier trainers get one at random. ` +
        `Pass { ability: "..." } explicitly to pick which one to analyze.`
      );
    }
  }

  // B1: IVs are a property of the TRAINER, not the mon
  // (GetFrontierTrainerFixedIvs, src/battle_tower.c:3288-3309, applied at
  // :1647): 3/6/9/12/15/18/21/31 by trainer band. The engine used to hardcode
  // 31 for every regular set, which models only the top 80 of 300 trainers.
  //
  // Default is 31 -- the record-streak tier, and the headline catalog slice --
  // so this call stays byte-compatible with every recorded value. Pass
  // { ivTier } to solve a band-scoped position. A tier outside the mon's own
  // `ivTiers` is a HYPOTHETICAL, not a reachable Arena position, and is
  // rejected unless explicitly allowed.
  //
  // Validation applies ONLY to an explicitly requested ivTier. A Frontier
  // Brain's own fixedIV (16 / 20 / 24 / 31) is a per-Brain constant, NOT a
  // trainer band, so policing it against IV_TIERS wrongly rejected all 22
  // Silver Brains -- caught by the sweep dropping 523 -> 507.
  const ivValue = opts.ivTier ?? entry.fixedIV ?? 31;
  if (opts.ivTier != null && !IV_TIERS.includes(opts.ivTier) && !opts.allowUnreachableTier) {
    throw new Error(`"${setName}": ivTier ${opts.ivTier} is not a frontier IV band ` +
      `(${IV_TIERS.join("/")}). Pass { allowUnreachableTier: true } to force it.`);
  }
  if (opts.ivTier != null && entry.ivTiers && !entry.ivTiers.includes(opts.ivTier) && !opts.allowUnreachableTier) {
    throw new Error(`"${setName}" is not reachable at IV tier ${opts.ivTier} — no trainer whose ` +
      `monSet contains it sits in that band. Its reachable tiers are ${entry.ivTiers.join(", ")}. ` +
      `Pass { allowUnreachableTier: true } to solve it anyway as a hypothetical.`);
  }
  const ivs = { hp: ivValue, atk: ivValue, def: ivValue, spa: ivValue, spd: ivValue, spe: ivValue };

  const config = {
    species: entry.species,
    level,
    nature: entry.nature,
    evs: entry.evs,
    ivs,
    ability,
    item: entry.item,
    moves: entry.moves,
  };

  // Sanity check against the spreadsheet's own precomputed stats. Empirically
  // validated (full-dataset sweep across all 552 entries, all 386 species):
  // ~13% of entries have a small, single-stat, off-by-one discrepancy at
  // nature-multiplier rounding boundaries — confirmed to be minor spreadsheet
  // error, not an engine bug (tried alternate rounding formulas against the
  // full dataset; plain floor/truncate, as used here, has by far the fewest
  // mismatches — 73 vs 272+ for the next-best alternative). So: small
  // discrepancies (total abs diff <= 2 across all 6 stats) are logged as a
  // warning and the computed (trusted) value is used; anything larger throws,
  // since that's more likely a real problem (wrong EV/IV/nature data).
  // The spreadsheet's precomputed stats assume IV31, so the cross-check only
  // applies at that tier. (frontier-pool.js carries no lvl50Stats at all; this
  // block is retained for any caller still passing a retired-pool entry.)
  if (level === 50 && entry.lvl50Stats && ivValue === 31) {
    const built = buildMon(config);
    let totalAbsDiff = 0;
    const diffs = [];
    for (const stat of ["hp", "atk", "def", "spa", "spd", "spe"]) {
      const d = built.stats[stat] - entry.lvl50Stats[stat];
      if (d !== 0) { totalAbsDiff += Math.abs(d); diffs.push(`${stat}: computed ${built.stats[stat]} vs sheet ${entry.lvl50Stats[stat]}`); }
    }
    if (totalAbsDiff > 2) {
      throw new Error(
        `Large stat mismatch for "${setName}" at level 50 (${diffs.join(", ")}) — ` +
        `likely a real data problem, not the known minor rounding quirk. Check EV/IV/nature.`
      );
    } else if (totalAbsDiff > 0) {
      console.warn(`[opponent-adapter] "${setName}": minor stat discrepancy vs spreadsheet ` +
        `(${diffs.join(", ")}) — using computed value (trusted; see known-limitations notes).`);
    }
  }

  return config;
}

export { getOpponentConfig };
