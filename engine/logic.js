// ── logic.js (v2) ──────────────────────────────────────────────────────────
// Battle Arena optimizer — generalized engine.
//
// Design: two mons are described by plain config objects (species looked up
// from species-data.js, everything else — level/nature/EVs/ability/item/
// moves — supplied by the caller, e.g. from a form or from opponent-sets.js).
// Starting HP% for both sides is also a parameter, not a constant, since a
// Pokémon carries damage forward into its next 1v1 as the team's next mon
// comes in fresh (Body scoring cares about current HP vs current max, not
// "this match's start" in isolation).
//
// Ported from pokeemerald source (src/battle_arena.c, data/battle_ai_scripts.s,
// src/battle_ai_script_commands.c).

import { SPECIES } from "./species-data.js";
import { MOVES } from "./move-data.js";
import { ITEM_DATA, itemData } from "./item-data.js";
import {
  ENCORE_ENCOURAGED_EFFECTS, MIRROR_MOVE_ENCOURAGED,
  // Phase D F12: every other singles-reachable script table, generated too.
  CHANGE_SELF_ABILITY_ENCOURAGED, RECYCLE_ENCOURAGED_ITEMS, TRICK_EFFECTS_TO_ENCOURAGE,
  TRICK_EFFECTS_TO_ENCOURAGE_2, THIEF_ITEMS_TO_STEAL, ATTACK_DOWN_PHYSICAL_TYPES, SP_ATK_DOWN_SPECIAL_TYPES,
} from "./ai-tables.js";
import { moveFlags, secondaryChance, moveTarget } from "./move-flags.js";
import { CRIT_EFFECTS } from "./crit-effects.js";
import { lowKickPower } from "./species-weights.js";
import { TYPE_CHART, PHYSICAL_TYPES, SPECIAL_TYPES } from "./type-data.js";
import { TYPE_EFFECTIVENESS } from "./type-table.js";
import { EFFECT_ACCURACY_CHECK } from "./acc-check.js";
import { EFFECT_DAMAGE_ADJUST } from "./damage-adjust.js";
// Phase D F30: no damage roll for an effect whose script reaches only
// adjustsetdamage (src/battle_script_commands.c:5861-5899 has no roll).
const ROLL_EXEMPT = (effect) => {
  const a = EFFECT_DAMAGE_ADJUST[effect];
  return !!a && a.length === 1 && a[0] === "adjustsetdamage";
};
import { GENDER_RATIO } from "./gender-data.js";
// Phase D F13: the ROM's AI program and its interpreter.
import { AI_CONST } from "./ai-program.js";
import { runAi, chooseFromScores } from "./ai-interpreter.js";

// ─────────────────────────────────────────────────────────────────────────
// 1. STAT CALCULATION
// ─────────────────────────────────────────────────────────────────────────

// Complete Gen III nature table — finite and fully known, no reason to leave
// this incremental like species/moves/EVs (which genuinely require lookup
// work). A partial table here is a silent-wrong-answer risk: an unlisted
// nature previously fell through to "neutral" instead of erroring.
const NATURES = {
  Hardy: {}, Lonely: { boost: "atk", drop: "def" }, Brave: { boost: "atk", drop: "spe" },
  Adamant: { boost: "atk", drop: "spa" }, Naughty: { boost: "atk", drop: "spd" },
  Bold: { boost: "def", drop: "atk" }, Docile: {}, Relaxed: { boost: "def", drop: "spe" },
  Impish: { boost: "def", drop: "spa" }, Lax: { boost: "def", drop: "spd" },
  Timid: { boost: "spe", drop: "atk" }, Hasty: { boost: "spe", drop: "def" }, Serious: {},
  Jolly: { boost: "spe", drop: "spa" }, Naive: { boost: "spe", drop: "spd" },
  Modest: { boost: "spa", drop: "atk" }, Mild: { boost: "spa", drop: "def" },
  Quiet: { boost: "spa", drop: "spe" }, Bashful: {}, Rash: { boost: "spa", drop: "spd" },
  Calm: { boost: "spd", drop: "atk" }, Gentle: { boost: "spd", drop: "def" },
  Sassy: { boost: "spd", drop: "spe" }, Careful: { boost: "spd", drop: "spa" }, Quirky: {},
};

function natureMult(nature, stat) {
  if (!(nature in NATURES)) {
    throw new Error(`Unknown nature "${nature}" — not one of the 25 real Gen III natures. Check spelling.`);
  }
  const n = NATURES[nature];
  if (n.boost === stat) return 1.1;
  if (n.drop === stat) return 0.9;
  return 1.0;
}

function calcStat(base, iv, ev, level, statKey, nature, isHP) {
  const core = Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100);
  if (isHP) return core + level + 10;
  return Math.floor((core + 5) * natureMult(nature, statKey));
}

// config: { species, level, nature, ivs?, evs, ability, item, moves }
// ivs defaults to 31 for every stat (Battle Frontier trainers are always
// flawless IVs — confirmed by reverse-engineering Umbreon 4's speed values).
// For your OWN Pokémon, pass real IVs if they're not perfect.
// Resolves a mon's gender into a probability distribution: [{ p, gender }],
// summing to 1, gender in {"male","female","genderless"}. Fixed-ratio species
// (genderRatio === "male"/"female"/"genderless") are always a single-point
// distribution, regardless of any config override — it isn't a real choice
// for those species. Variable-ratio species (a percent-female number, from
// gender-data.js's PERCENT_FEMALE extraction) use configGender as a concrete
// override when supplied (this is a REAL, already-existing mon with one
// actual gender — e.g. your own Swampert); left unspecified, it's modeled as
// a genuine probability split, matching how a Frontier opponent's gender is
// really undetermined until a personality value is rolled fresh each
// encounter (CreateMonWithEVSpreadNatureOTID only constrains nature, not
// gender bits — confirmed from source). If your own variable-ratio mon needs
// an exact (non-probabilistic) Attract analysis, pass config.gender.
function resolveGenderDist(genderRatio, configGender) {
  if (genderRatio === "male" || genderRatio === "female" || genderRatio === "genderless") {
    return [{ p: 1, gender: genderRatio }];
  }
  if (configGender === "male" || configGender === "female") {
    return [{ p: 1, gender: configGender }];
  }
  const pFemale = genderRatio / 100;
  return [{ p: pFemale, gender: "female" }, { p: 1 - pFemale, gender: "male" }];
}

function buildMon(config) {
  const dex = SPECIES[config.species];
  if (!dex) throw new Error(`Unknown species "${config.species}" — add it to species-data.js first.`);

  const iv = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...(config.ivs || {}) };
  const evs = config.evs || {};
  const { base } = dex;

  const stats = {
    // Phase D F5: CalculateMonStats special-cases Shedinja to max HP 1
    // (src/pokemon.c:2845-2852).
    hp:  config.species === "Shedinja" ? 1 : calcStat(base.hp,  iv.hp,  evs.hp  || 0, config.level, "hp",  config.nature, true),
    atk: calcStat(base.atk, iv.atk, evs.atk || 0, config.level, "atk", config.nature, false),
    def: calcStat(base.def, iv.def, evs.def || 0, config.level, "def", config.nature, false),
    spa: calcStat(base.spa, iv.spa, evs.spa || 0, config.level, "spa", config.nature, false),
    spd: calcStat(base.spd, iv.spd, evs.spd || 0, config.level, "spd", config.nature, false),
    spe: calcStat(base.spe, iv.spe, evs.spe || 0, config.level, "spe", config.nature, false),
  };

  return {
    species: config.species,
    types: dex.types,
    level: config.level,
    nature: config.nature,
    ability: config.ability,
    item: config.item,
    moves: config.moves,
    stats,
    genderDist: resolveGenderDist(GENDER_RATIO[config.species], config.gender),
    // EFFECT_RETURN/EFFECT_FRUSTRATION power (Cmd_friendshiptodamagecalculation,
    // src/battle_script_commands.c:8603-8611) is friendship-dependent, and this
    // dataset tracks no friendship field anywhere — so it's assumed rather than
    // read: a mon built to carry Frustration is assumed built at MIN friendship
    // (0) specifically so Frustration is worth using; anything else (including a
    // Return carrier) defaults to MAX (255), since a player who bothers building
    // around Return keeps happiness maxed by design. `analyzeMatchup` OVERRIDES
    // this to always-255 for the opponent side specifically (Frontier trainer
    // mons are generated at max friendship — real, verified fact, not a
    // convenience default) — which is why an opponent's own Frustration, if it
    // ever carries one, computes to 0 power (see calcDamage), not 102.
    friendship: config.friendship ?? (config.moves.includes("Frustration") ? 0 : 255),
    hiddenPower: resolveHiddenPower(config, iv),
  };
}

// HIDDEN POWER (C2, amendment 16). Cmd_hiddenpowercalc
// (src/battle_script_commands.c:8889-8915) derives the power and type from the
// low two bits of the six IVs:
//   power = 40 * powerBits / 63 + 30        (30..70)
//   type  = 15 * typeBits / 63 + 1, skipping TYPE_MYSTERY (so never Normal)
// For the PLAYER the type and power are ENTERED (`hiddenPower: { type, power }`,
// power defaulting to 70, the maximum): a player knows their Hidden Power, not
// necessarily the IVs behind it. Any mon built from explicit IVs (every
// Frontier mon) derives it, which is what Mimic, Mirror Move and Transform need.
// A mon that carries Hidden Power with neither is refused, never guessed.
// Type ids 0..17 (include/constants/pokemon.h:6-24): the physical types, then
// TYPE_MYSTERY (9), then the special types.
const TYPE_BY_ID = [...PHYSICAL_TYPES, null, ...SPECIAL_TYPES];
const HIDDEN_POWER_TYPES = TYPE_BY_ID.filter((t) => t && t !== "Normal");
function hiddenPowerFromIvs(iv) {
  const order = ["hp", "atk", "def", "spe", "spa", "spd"]; // source's bit order
  let powerBits = 0, typeBits = 0;
  order.forEach((k, i) => { powerBits |= ((iv[k] >> 1) & 1) << i; typeBits |= (iv[k] & 1) << i; });
  let t = Math.floor((15 * typeBits) / 63) + 1;
  if (t >= 9) t++;
  return { type: TYPE_BY_ID[t], power: Math.floor((40 * powerBits) / 63) + 30 };
}
function resolveHiddenPower(config, iv) {
  if (config.hiddenPower) {
    const { type, power = 70 } = config.hiddenPower;
    if (!HIDDEN_POWER_TYPES.includes(type)) {
      throw new Error(`${config.species}: Hidden Power type "${type}" is not one Hidden Power can have (${HIDDEN_POWER_TYPES.join(", ")}).`);
    }
    if (!Number.isInteger(power) || power < 30 || power > 70) {
      throw new Error(`${config.species}: Hidden Power power ${power} is outside 30..70.`);
    }
    return { type, power };
  }
  if (config.ivs) return hiddenPowerFromIvs(iv);
  if (config.moves.includes("Hidden Power")) {
    throw new Error(`"Hidden Power" (effect: EFFECT_HIDDEN_POWER): ${config.species} carries it with no type -- ` +
      `enter it as { hiddenPower: { type, power } } (power defaults to 70); it is not guessed.`);
  }
  return null; // none possible: battleMoveData refuses if it is ever needed
}

// The move data the BATTLE sees for this mon. Only Hidden Power differs: its
// type and power come from the user (GET_MOVE_TYPE, include/battle.h:458-464,
// reads the dynamic type at every battle site), and in Gen 3 the physical /
// special split follows that type (CalculateBaseDamage, src/pokemon.c:3124-3127,
// 3232, 3287). Everything that reads gBattleMoves instead -- the AI's view of a
// move, the Arena's Mind score, the Counter / Mirror Coat record and the fire
// defrost (F_DYNAMIC_TYPE_IGNORE_PHYSICALITY, src/battle_script_commands.c:
// 1851-1860) -- keeps MOVES, the base Normal-type entry.
const _hpMoveData = new WeakMap();
function battleMoveData(mon, moveName) {
  const md = MOVES[moveName];
  if (!md || md.effect !== "EFFECT_HIDDEN_POWER") return md;
  let out = _hpMoveData.get(mon);
  if (!out) {
    const hp = mon.hiddenPower;
    if (!hp) {
      throw new Error(`"Hidden Power" (effect: EFFECT_HIDDEN_POWER): ${mon.species} uses it (drawn or copied) ` +
        `with no Hidden Power type -- build it with { hiddenPower: { type, power } } or explicit IVs.`);
    }
    out = { ...md, type: hp.type, power: hp.power, category: PHYSICAL_TYPES.includes(hp.type) ? "physical" : "special" };
    _hpMoveData.set(mon, out);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. TYPE CHART (imported from type-data.js — see that file for provenance)
// ─────────────────────────────────────────────────────────────────────────

// B2b: `foresighted` is the DEFENDER's STATUS2_FORESIGHT. Foresight removes
// EXACTLY the two type-chart rows that sit AFTER the TYPE_FORESIGHT separator
// in gTypeEffectiveness (src/battle_main.c:445-447): NORMAL vs GHOST and
// FIGHTING vs GHOST, both TYPE_MUL_NO_EFFECT. The scan `break`s at the
// separator when the defender is foresighted (src/battle_script_commands.c:
// 1388-1394, :1447-1453, :1562-1568), so every row BEFORE it -- all of Ghost's
// other interactions -- still applies. Nothing else about the chart changes.
// Phase D F17: the type step as source computes it. TypeCalc / Cmd_typecalc
// (src/battle_script_commands.c:1536-1590, :1355-1400) walk gTypeEffectiveness
// in ROW ORDER (type-table.js, generated and checked against the ROM) and, for
// each row matching the move's type and a defender type (type2 only when it
// differs from type1), apply ModulateDmgByType (:1321-1326):
// dmg = dmg * mul / 10, then 1 if that gave 0 and mul is not 0. The walk stops
// at the TYPE_FORESIGHT row for a foresighted target. So a x0 row followed by
// a matching row leaves 1 (Ground into Skarmory: Flying x0, then Steel x2), and
// each row floors on its own. `noEffect` is whether any x0 row applied -- the
// battle's MOVE_RESULT_DOESNT_AFFECT_FOE; the AI (retail) reads only `dmg`.
// The rows indexed by attacking type, in table order; `past` marks a row after
// the TYPE_FORESIGHT separator (where the walk stops for a foresighted target).
const TYPE_ROWS_BY_ATTACKER = (() => {
  const m = new Map();
  let past = false;
  for (const r of TYPE_EFFECTIVENESS) {
    if (r === "FORESIGHT") { past = true; continue; }
    if (!m.has(r[0])) m.set(r[0], []);
    m.get(r[0]).push({ def: r[1], mul: r[2], past });
  }
  return m;
})();
function typeCalcRows(dmg, moveType, defTypes, foresighted = false) {
  const t1 = defTypes[0], t2 = defTypes[1] ?? defTypes[0];
  let noEffect = false;
  const mod = (m) => {
    dmg = Math.trunc((dmg * m) / 10);
    if (dmg === 0 && m !== 0) dmg = 1;
    if (m === 0) noEffect = true;
  };
  for (const r of TYPE_ROWS_BY_ATTACKER.get(moveType) ?? []) {
    if (r.past && foresighted) break;
    if (r.def === t1) mod(r.mul);
    if (r.def === t2 && t1 !== t2) mod(r.mul);
  }
  return { dmg, noEffect };
}
function typeEffectiveness(moveType, defTypes, foresighted = false) {
  const chart = TYPE_CHART[moveType] || {};
  const piercesGhost = foresighted && (moveType === "Normal" || moveType === "Fighting");
  let mult = 1;
  for (const t of defTypes) {
    if (piercesGhost && t === "Ghost") continue; // the skipped no-effect row
    mult *= (chart[t] !== undefined ? chart[t] : 1);
  }
  return mult;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. MOVE DATA + AI HANDLER REGISTRY
//    MOVES now comes from the full 354-move dex (move-data.js, converted
//    from battle_moves.json). category is DERIVED from type per Gen I-III
//    rules (see move-data.js header) — NOT a per-move field, since that
//    split doesn't exist until Gen IV. accuracy: null means always-hit.
//
//    AI_HANDLERS is keyed by `effect` (e.g. "EFFECT_CONFUSE"), matching how
//    the game's own AI script actually dispatches ("if_effect EFFECT_X,
//    handler") — so a handler ported once automatically covers every move
//    that shares that effect, not just the one move we happened to need it
//    for. Grows one effect at a time, same incremental pattern as before.
// ─────────────────────────────────────────────────────────────────────────

// Each handler receives ctx = { user, target, userHpPct, targetHpPct,
// targetConfused, userEvasionStage, targetTypes } and returns a score delta.
// checkBadMove runs first (AI_CheckBadMove); checkViability runs after
// AI_TryToFaint (which is generic and applied automatically for any
// damaging move — see scoreOpponentMove below).
// B2b batch 7: the OTHER two-turn moves -- charge first, attack second, with no
// invulnerability in between. Every one of them runs the SAME machinery as
// Fly/Dig (BattleScriptFirstChargingTurn, data/battle_scripts_1.s:6-18, setting
// STATUS2_MULTIPLETURNS); they differ only in what the charge turn does on the
// side. So they are handled by the same code path here, with a null invuln bit.
//
//   EFFECT_RAZOR_WIND   nothing extra                    :1200-1205
//   EFFECT_SKY_ATTACK   nothing extra (+ a flinch %)     :2091-2096
//   EFFECT_SKULL_BASH   +1 Defence on the CHARGE turn    :2062-2075
//   EFFECT_SOLAR_BEAM   SKIPS the charge entirely in sun :1207-1217
//
// Solar Beam and Sky Attack were previously in ACCEPTED_UNMODELED_EFFECTS,
// "resolves as a free 1-turn hit" -- which made a 120-power and a 140-power
// move strictly better than they are. Razor Wind was not ledgered at all and
// threw. Both dispositions are replaced by the real mechanic.
const CHARGE_EFFECTS = new Set([
  "EFFECT_RAZOR_WIND", "EFFECT_SKY_ATTACK", "EFFECT_SKULL_BASH", "EFFECT_SOLAR_BEAM",
]);

// Solar Beam's sun check runs BEFORE the charge decision and is explicitly
// nullified by Cloud Nine / Air Lock (:1207-1210 jumpifabilitypresent, both
// abilities, before the weather test) -- which is exactly what effectiveWeather
// already computes for every other weather consumer in this file.
function chargeTurnRequired(moveData, weather) {
  if (!CHARGE_EFFECTS.has(moveData.effect)) return false;
  if (moveData.effect === "EFFECT_SOLAR_BEAM" && weather === "sun") return false;
  return true;
}

// Semi-invulnerable moves (Dive/Fly/Dig/Bounce — all share EFFECT_SEMI_INVULNERABLE)
// map to a specific gStatuses3 invulnerability bit. Bounce additionally
// tries to paralyze on its attack turn (not modeled — none of our current
// movesets include Bounce; flag if it comes up).
// Phase D F25: what Cmd_tryswapitems refuses to move -- ITEM_ENIGMA_BERRY and
// IS_ITEM_MAIL (include/mail.h:6-17; test-d-f25 checks this against the macro).
const TRICK_UNSWAPPABLE = new Set(["ITEM_ENIGMA_BERRY", "ITEM_ORANGE_MAIL", "ITEM_HARBOR_MAIL",
  "ITEM_GLITTER_MAIL", "ITEM_MECH_MAIL", "ITEM_WOOD_MAIL", "ITEM_WAVE_MAIL", "ITEM_BEAD_MAIL",
  "ITEM_SHADOW_MAIL", "ITEM_TROPIC_MAIL", "ITEM_DREAM_MAIL", "ITEM_FAB_MAIL", "ITEM_RETRO_MAIL"]);
const SEMI_INVULN_BIT = { Dive: "underwater", Dig: "underground", Fly: "onair", Bounce: "onair" };

// Moves that bypass a given invulnerability bit, and whether they get the
// accompanying damage-doubling bonus (Thunder/Sky Uppercut bypass Fly/Bounce
// but do NOT get the 2x bonus that Twister/Gust/Surf/Whirlpool/Earthquake do
// — source-confirmed asymmetry).
const INVULN_BYPASS = {
  underwater: { "Surf": 2, "Whirlpool": 2 },
  underground: { "Earthquake": 2 },
  onair: { "Twister": 2, "Gust": 2, "Thunder": 1, "Sky Uppercut": 1 },
};

// Shared shape for AI_CV_AttackUp/AI_CV_SpAtkUp (data/battle_ai_scripts.s:896-984)
// — identical structure, differing only in the mid-HP-band tail roll
// (AttackUp: 40/256, SpAtkUp: 70/256 — verified separately, NOT assumed
// symmetric). stageKey is the ctx field for the user's OWN stage in that stat.
function attackFamilyViability(ctx, stageKey, midBandRollNumerator) {
  let dist = [{ p: 1, delta: 0 }];
  if (ctx[stageKey] >= 3) {
    dist = combineDist(dist, [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: -1 }]);
  } else if (ctx.userHpPct === 100) {
    dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 2 }]);
  }
  if (ctx.userHpPct > 70) {
    // done, no further scoring
  } else if (ctx.userHpPct < 40) {
    dist = combineDist(dist, [{ p: 1, delta: -2 }]);
  } else {
    dist = combineDist(dist, [{ p: midBandRollNumerator / 256, delta: 0 }, { p: (256 - midBandRollNumerator) / 256, delta: -2 }]);
  }
  return dist;
}

// Shared shape for AI_CV_DefenseUp/AI_CV_SpDefUp (data/battle_ai_scripts.s:915-1025)
// — identical thresholds (100/128/200/60/60), differing only in whether a
// physical or non-physical last hit is the "wasted boost" case.
function defenseFamilyTail(ctx, wastedIfPhysical) {
  if (ctx.userHpPct < 40) return [{ p: 1, delta: -2 }];
  if (!ctx.targetLastMoveHadPower) {
    return [{ p: 60 / 256, delta: 0 }, { p: 196 / 256, delta: -2 }]; // Up5: no/status last move
  }
  const wasted = wastedIfPhysical ? ctx.targetLastMoveWasPhysical : !ctx.targetLastMoveWasPhysical;
  if (wasted) return [{ p: 1, delta: -2 }]; // guaranteed, no roll
  // Phase D F8: AI_CV_DefenseUp4's / AI_CV_SpDefUp4's roll (60 / 256 jumps to
  // End) FALLS THROUGH into AI_CV_DefenseUp5's own 60 roll -- two independent
  // rolls, so the -2 lands on (196/256)^2. This used to roll once.
  const pass = 60 / 256 + (196 / 256) * (60 / 256);
  return [{ p: pass, delta: 0 }, { p: 1 - pass, delta: -2 }];
}
function defenseFamilyViability(ctx, stageKey, wastedIfPhysical) {
  let dist = [{ p: 1, delta: 0 }];
  if (ctx[stageKey] >= 3) {
    dist = combineDist(dist, [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: -1 }]);
  } else if (ctx.userHpPct === 100) {
    dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 2 }]);
  }
  if (ctx.userHpPct >= 70) {
    // AI_CV_DefenseUp3 / AI_CV_SpDefUp3: 200/256 fully done. 56/256: still falls into the tail below (source
    // asymmetry vs the attack family — the HP>=70 exemption here is only
    // probabilistic, not guaranteed).
    const tail = defenseFamilyTail(ctx, wastedIfPhysical);
    dist = combineDist(dist, [
      { p: 200 / 256, delta: 0 },
      ...tail.map((d) => ({ p: (56 / 256) * d.p, delta: d.delta })),
    ]);
  } else {
    dist = combineDist(dist, defenseFamilyTail(ctx, wastedIfPhysical));
  }
  return dist;
}

// AI_CV_Toxic (data/battle_ai_scripts.s:1353-1371) — shared verbatim by
// EFFECT_TOXIC and EFFECT_LEECH_SEED per source (:711 routes Leech Seed's
// viability through this same handler). Two independent HP-gated 50/256
// (NOT 50%!) penalties (own HP, then target HP), skipped entirely if the
// opponent has no attacking moves at all; then a bonus roll gated on the
// opponent's OWN moveset containing EFFECT_SPECIAL_DEFENSE_UP or
// EFFECT_PROTECT (literally just those two — NOT the _2 variant, preserved
// as written).
function toxicFamilyViability(ctx) {
  let dist = [{ p: 1, delta: 0 }];
  if (!ctx.userHasNoAttackingMoves) {
    if (ctx.userHpPct > 50) {
      // nothing
    } else {
      dist = combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -3 }]);
    }
    if (ctx.targetHpPct > 50) {
      // nothing
    } else {
      dist = combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -3 }]);
    }
  }
  if (ctx.userHasSpDefUpOrProtectMove) {
    dist = combineDist(dist, [{ p: 60 / 256, delta: 0 }, { p: 196 / 256, delta: 2 }]);
  }
  return dist;
}

// AI_CV_Heal (data/battle_ai_scripts.s:1324-1351) — shared by EFFECT_RESTORE_HP
// and EFFECT_SOFTBOILED verbatim, AND by EFFECT_SYNTHESIS via AI_CV_HealWeather
// (:1315-1320), which in THIS engine reduces to plain AI_CV_Heal since weather
// is never modeled/never active (Sunny/Rain/Sandstorm/Hail are all deferred
// hard effects) — the -2 weather penalty prefix can never fire.
// NOTE: source has an "AI_CV_Heal2" label that is NEVER jumped to from
// anywhere in the file — genuinely unreachable dead code in the decompiled
// ROM. Not ported (only reachable paths are), flagged as a curiosity.
function healFamilyViability(ctx) {
  if (ctx.userHpPct === 100) return [{ p: 1, delta: -3 }]; // Heal3
  if (!ctx.targetFaster) return [{ p: 1, delta: -8 }]; // user faster/tied, not full HP
  // Heal5/Heal6 tail — Snatch not modeled (always "doesn't have"), so always
  // lands on Heal6's roll: 20/256 chance nothing, else 236/256 chance +2.
  const tail = [{ p: 20 / 256, delta: 0 }, { p: 236 / 256, delta: 2 }];
  if (ctx.userHpPct < 70) return tail; // Heal4 -> straight to tail
  return [
    ...tail.map((d) => ({ p: (30 / 256) * d.p, delta: d.delta })),
    { p: 226 / 256, delta: -3 },
  ];
}

// Shared shape for AI_CV_DefenseDown/AI_CV_SpDefDown/AI_CV_EvasionDown
// (data/battle_ai_scripts.s:1124-1134/1186-1196/1235-1245 — identical
// thresholds and rolls, differing only in which of the TARGET's stat stages
// is checked). Raw stat stages are 0-12 (6=neutral) in source; this engine's
// ctx.targetStages use DISPLAY values (-6..+6, 0=neutral) — "raw > 3"
// becomes "display > -3" throughout.
function statDownDefenseFamilyViability(ctx, stageKey) {
  let dist = [{ p: 1, delta: 0 }];
  const skipRoll = ctx.userHpPct >= 70 && ctx.targetStages[stageKey] > -3;
  if (!skipRoll) dist = combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -2 }]);
  if (ctx.targetHpPct <= 70) dist = combineDist(dist, [{ p: 1, delta: -2 }]);
  return dist;
}

// AI_CV_SpeedDown (data/battle_ai_scripts.s:1142-1151) — NOT the same shape
// as the Defense/SpDef/Evasion family above; keyed on relative speed, not HP.
function speedDownFamilyViability(ctx) {
  if (!ctx.targetFaster) return [{ p: 1, delta: -3 }]; // already faster than target — wasted
  return [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: 2 }];
}

// AI_CV_AttackDown (data/battle_ai_scripts.s:1090-1122) — shares the same
// tail shape as the Defense family (skip-roll + flat-if-target-healthy) but
// prefixes it with an "is the target's Attack already neutral" check, and
// appends a further roll gated on whether the target is even a "typically
// physical" type (source comment flags this type list as an apparent bug —
// Flying/Poison/Ghost are left out — preserved as-is, not "corrected", since
// this is real AI behavior, not our own approximation).
// AI_CV_SpAtkDown (data/battle_ai_scripts.s:1153-1180) is AI_CV_AttackDown
// (:1093-1120) with two substitutions and one QUIRK, so the two are built from
// one function here rather than written twice:
//   the mid-chain stage gate reads STAT_SPATK instead of STAT_ATK
//   the type list is the SPECIAL list instead of the physical one
//   THE QUIRK: the FIRST gate reads STAT_ATK in BOTH routines. The Special
//   Attack handler opens by checking the target's ATTACK stage. Reproduced, not
//   corrected -- the same standard as every other preserved oddity here.
// Source's own comment on the physical list notes it "seems likely" to have
// been meant as "is the target a physical type" and that Flying, Poison and
// Ghost were left out; the special list below is the one the ROM ships.
const SP_ATK_DOWN_SPECIAL_TYPICAL_TYPES = [...SP_ATK_DOWN_SPECIAL_TYPES]; // generated (F12)
function statDownOffenseFamilyViability(ctx, stageKey, typicalTypes) {
  let dist = [{ p: 1, delta: 0 }];
  // THE QUIRK: `atk`, deliberately, for both members of this family.
  if (ctx.targetStages.atk !== 0) {
    dist = combineDist(dist, [{ p: 1, delta: -1 }]);
    if (ctx.userHpPct <= 90) dist = combineDist(dist, [{ p: 1, delta: -1 }]);
  }
  const skipRoll = ctx.targetStages[stageKey] > -3;
  if (!skipRoll) dist = combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -2 }]);
  if (ctx.targetHpPct <= 70) dist = combineDist(dist, [{ p: 1, delta: -2 }]);
  const typical = ctx.targetTypes.some((t) => typicalTypes.includes(t));
  if (!typical) dist = combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -2 }]);
  return dist;
}

const ATTACK_DOWN_PHYSICAL_TYPICAL_TYPES = [...ATTACK_DOWN_PHYSICAL_TYPES]; // generated (F12)
function attackDownFamilyViability(ctx) {
  let dist = [{ p: 1, delta: 0 }];
  if (ctx.targetStages.atk !== 0) {
    dist = combineDist(dist, [{ p: 1, delta: -1 }]);
    if (ctx.userHpPct <= 90) dist = combineDist(dist, [{ p: 1, delta: -1 }]);
  }
  const skipRoll = ctx.targetStages.atk > -3;
  if (!skipRoll) dist = combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -2 }]);
  if (ctx.targetHpPct <= 70) dist = combineDist(dist, [{ p: 1, delta: -2 }]);
  const isPhysicalTypical = ctx.targetTypes.some((t) => ATTACK_DOWN_PHYSICAL_TYPICAL_TYPES.includes(t));
  if (!isPhysicalTypical) dist = combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -2 }]);
  return dist;
}

// AI_CV_AccuracyDown (data/battle_ai_scripts.s:1198-1233) — the longest chain
// in this family: an HP-gated -1, an own-accuracy-stage-gated -2, THREE
// independent target-condition +2 bonuses (toxic/leech-seeded/cursed — all
// "the target's already in trouble, lowering accuracy is extra insurance"),
// a user-Ingrain-gated +1, and a final HP/stage-gated -2 tail.
function accuracyDownFamilyViability(ctx) {
  let dist = [{ p: 1, delta: 0 }];
  if (!(ctx.userHpPct >= 70 && ctx.targetHpPct > 70)) {
    dist = combineDist(dist, [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: -1 }]);
  }
  if (!(ctx.userAccStage > -2)) {
    dist = combineDist(dist, [{ p: 80 / 256, delta: 0 }, { p: 176 / 256, delta: -2 }]);
  }
  if (ctx.targetToxicPoisoned) dist = combineDist(dist, [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: 2 }]);
  if (ctx.targetLeechSeeded) dist = combineDist(dist, [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: 2 }]);
  if (ctx.userIngrained) dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }]);
  if (ctx.targetCursed) dist = combineDist(dist, [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: 2 }]);
  const skipFinal = ctx.userHpPct > 70 || ctx.targetStages.accuracy === 0;
  if (!skipFinal) {
    if (ctx.userHpPct < 40 || ctx.targetHpPct < 40) {
      dist = combineDist(dist, [{ p: 1, delta: -2 }]);
    } else {
      dist = combineDist(dist, [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: -2 }]);
    }
  }
  return dist;
}

// AI_CV_HighCrit (data/battle_ai_scripts.s:1449-1460), shared by
// EFFECT_HIGH_CRITICAL/EFFECT_BLAZE_KICK/EFFECT_POISON_TAIL (dispatched at
// :686/:766/:772) — the one real super-effective-move-encouragement branch
// in Frontier AI (see HANDOFF.md §3's FRONTIER AI FLAG SET reference: every
// OTHER effectiveness-gated branch across all 3 active scripts is either a
// resistance penalty or AI_TryToFaint's x4-only DoubleSuperEffective bonus —
// this is the only one that rewards a plain x2 hit). No AI_CBM_HighCrit
// exists in source's CheckBadMove dispatch table, so no checkBadMove here —
// intentional, not an omission.
//   x0.25/x0.5 -> end, no bonus, ever.
//   x2/x4      -> skip straight to the second roll (HighCrit2): 128/256 (50%)
//                 -> nothing, else -> score +1.
//   x1 (or x0, which isn't separately checked in source either) -> first
//                 roll 128/256 (50%) -> end, no bonus; else falls through to
//                 the SAME second roll as the x2/x4 case. Net p(+1) =
//                 (128/256)*(128/256) = 1/4 — both sequential gates must
//                 pass, collapsed into one combined-probability branch, same
//                 convention as AI_CV_EvasionUp's toxic-poison low-HP branch
//                 above (two ANDed rolls -> one multiplied-probability pair).
function highCritViability(ctx) {
  const eff = typeEffectiveness(ctx.moveType, ctx.targetTypes);
  if (eff === 0.5 || eff === 0.25) return [{ p: 1, delta: 0 }];
  if (eff === 2 || eff === 4) {
    return [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }];
  }
  const pPlus1 = (128 / 256) * (128 / 256);
  return [{ p: 1 - pPlus1, delta: 0 }, { p: pPlus1, delta: 1 }];
}

// Shared by AI_CV_Counter (data/battle_ai_scripts.s:1618-1673) and
// AI_CV_MirrorCoat (:2116-2182) — GameFreak wrote this routine twice with a
// flipped type list and a flipped ownership check; every constant below is
// identical between the two, confirmed line-by-line, not assumed from shape
// alone (change #8's trace).
//
// Status short-circuit: Counter :1619-1621 / MirrorCoat :2117-2119 —
// asleep/infatuated/confused target -> flat -1, done. (ctx.targetConfused is
// currently hardcoded false in chooseOpponentMoves — a pre-existing gap
// shared with EFFECT_CONFUSE's own checkBadMove, not something this handler
// fixes.)
//
// Two independent own-HP penalty gates, each conditionally rolled and
// composed additively — HP<=30% clears BOTH thresholds, so both can fire on
// the same evaluation (up to -2 total):
//   Gate A: Counter :1622-1624 / MirrorCoat :2120-2122 — HP<=30% -> 246/256
//   chance of -1, else 0.
//   Gate B: Counter :1626-1628 / MirrorCoat :2124-2126 — HP<=50% -> 156/256
//   chance of -1, else 0.
//
// Terminal branch: Counter :1629-1668 / MirrorCoat :2127-2166. Taunt
// sub-branches are omitted — Taunt has zero representation anywhere in this
// engine, so if_target_not_taunted is always true and those score+1-if-taunted
// paths are unreachable dead code under this engine's current scope, same
// convention as targetSafeguarded/targetCantEscape/etc. defaulting false
// elsewhere in this file.
//
//   Sibling-ownership bypass: Counter :1630 (has Mirror Coat) / MirrorCoat
//   :2128 (has Counter) — reciprocal checks, same target roll either way,
//   skipping straight to the final roll below and ignoring the target's last
//   move entirely.
//
//   Else, fetch the target's last used move (Counter :1631-1633 / MirrorCoat
//   :2129-2131 — gLastMoves[target], the battle-wide last-move tracker, NOT
//   the AI's fog-of-war BATTLE_HISTORY; ctx.targetLastMoveHadPower already
//   threads this exact value for AI_CV_DefenseUp/AI_CV_SpDefUp, reused as-is
//   here):
//
//     Last move had real power (Counter :1637-1643 / MirrorCoat :2135-2141):
//     checks that move's own TYPE against the caller's type list —
//     lastMoveMatchesCategory already encodes this per call site
//     (move-data.js's `category` field is the Gen III type-based split,
//     cross-verified against Dark-type Crunch being stored "special", not
//     the modern per-move split). Non-matching -> flat -1. Matching ->
//     156/256 chance of +1.
//
//     Last move had power 0 — includes a fresh turn-1 root, where
//     gLastMoves[target] is still MOVE_NONE (Counter :1645-1668 / MirrorCoat
//     :2143-2166). This branch checks the TARGET'S OWN SPECIES TYPE(S), not
//     the last move's type. BUGFIX is commented out in this repo
//     (config.h:48), so real cartridges ship the #else branch (Counter
//     :1656-1660 / MirrorCoat :2155-2158) — which each routine's own source
//     comment (:1616-1617 / :2114-2115) calls a bug: it rewards the move
//     against a target with NEITHER type on the caller's list, and gives a
//     target with ANY matching-category type a flat 0 (straight to End, no
//     roll at all). This is a DELIBERATE reproduction of that shipped bug on
//     BOTH routines, not a porting mistake — do not "correct" it to the
//     BUGFIX behavior.
//
//       Target has >=1 matching-category type: 0, unreachable for a bonus,
//       full stop (Counter :1657-1660 / MirrorCoat :2155-2158).
//
//       Target's types are BOTH non-matching-category: two sequential
//       rolls, the pre-filter THEN the final roll (Counter :1662-1666 /
//       MirrorCoat :2160-2164) — NOT independent. The final roll is only
//       even reached on the 206/256 complement of the pre-filter's 50/256
//       skip-to-End. A prior audit computed this as a flat ~61% (156/256,
//       the final roll alone) by dropping the pre-filter entirely, on BOTH
//       routines. The real combined probability of +4 is
//       (206/256)*(156/256) = 32136/65536 ~= 49.04%, not ~61% — collapsed
//       below into a single pair the same way highCritViability collapses
//       its own two sequential 128/256 rolls above, so the derivation stays
//       visible in the code instead of hidden in a nested combineDist call.
function reflectFamilyViability(ctx, { typeList, ownsSiblingMove, lastMoveMatchesCategory }) {
  if (ctx.targetStatus === "sleep" || ctx.targetInfatuated || ctx.targetConfused) {
    return [{ p: 1, delta: -1 }];
  }

  let dist = [{ p: 1, delta: 0 }];
  if (!(ctx.userHpPct > 30)) {
    dist = combineDist(dist, [{ p: 10 / 256, delta: 0 }, { p: 246 / 256, delta: -1 }]);
  }
  if (!(ctx.userHpPct > 50)) {
    dist = combineDist(dist, [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: -1 }]);
  }

  let terminal;
  if (ownsSiblingMove) {
    terminal = [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: 4 }];
  } else if (ctx.targetLastMoveHadPower) {
    terminal = lastMoveMatchesCategory
      ? [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: 1 }]
      : [{ p: 1, delta: -1 }];
  } else if (ctx.targetTypes.some((t) => typeList.includes(t))) {
    terminal = [{ p: 1, delta: 0 }];
  } else {
    const pFinalRollReached = 206 / 256; // 1 - the pre-filter's 50/256 skip-to-End
    const pPlus4 = pFinalRollReached * (156 / 256); // the final roll, gated by the above
    terminal = [{ p: 1 - pPlus4, delta: 0 }, { p: pPlus4, delta: 4 }];
  }
  return combineDist(dist, terminal);
}

// AI_CV_Counter (data/battle_ai_scripts.s:1618-1673) — unique CV dispatch,
// NOT shared with Mirror Coat (which has its own AI_CV_MirrorCoat at :738).
// See reflectFamilyViability's comment above for the full shared trace.
//
// COUNTERINTUITIVE BUT SOURCE-CORRECT — DO NOT "FIX" THIS (same standard as
// change #7's Explosion note): BUGFIX is commented out at config.h:48, so
// the shipped, non-BUGFIX fallback (source's own comment at :1616-1617 calls
// it a bug) rewards Counter against a target with NEITHER type on
// PHYSICAL_TYPES, and gives a target with ANY physical-category type a flat
// 0 — the opposite of what you'd expect from a move that only pays off
// against physical attackers. Reproduced deliberately, not a porting slip.
function counterViability(ctx) {
  return reflectFamilyViability(ctx, {
    typeList: PHYSICAL_TYPES,
    ownsSiblingMove: ctx.userHasMirrorCoat,
    lastMoveMatchesCategory: ctx.targetLastMoveWasPhysical,
  });
}

// AI_CV_MirrorCoat (data/battle_ai_scripts.s:2116-2182) — unique CV dispatch,
// NOT shared with Counter (which has its own AI_CV_Counter at :713). See
// reflectFamilyViability's comment above for the full shared trace — this is
// the same routine as AI_CV_Counter with PHYSICAL_TYPES/SPECIAL_TYPES and
// the sibling-ownership check both flipped.
//
// COUNTERINTUITIVE BUT SOURCE-CORRECT — DO NOT "FIX" THIS (same standard as
// counterViability above, and change #7's Explosion note): BUGFIX is
// commented out at config.h:48, so the shipped, non-BUGFIX fallback
// (source's own comment at :2114-2115 calls it a bug) rewards Mirror Coat
// against a target with NEITHER type on SPECIAL_TYPES, and gives a target
// with ANY special-category type a flat 0 — the opposite of what you'd
// expect from a move that only pays off against special attackers.
// Reproduced deliberately, not a porting slip.
function mirrorCoatViability(ctx) {
  return reflectFamilyViability(ctx, {
    typeList: SPECIAL_TYPES,
    ownsSiblingMove: ctx.userHasCounter,
    lastMoveMatchesCategory: ctx.targetLastMoveWasSpecial,
  });
}

// B2: effects source's AI has NO OPINION about. Both dispatch chains --
// AI_CheckBadMove (data/battle_ai_scripts.s, the `if_effect` list ending in a
// bare `end`) and AI_CheckViability -- are searched linearly and fall through
// to that `end` when no entry matches, leaving the move's score at its 100
// baseline. These ten effects appear in NEITHER chain, verified by parsing both
// lists at a3c551fe, so scoring them at baseline IS the faithful port.
//
// This is NOT the same as "not yet ported": the 31 other unhandled status
// effects in the Lv50 universe DO have dispatch entries and still throw until
// their handlers land. Keeping the two apart is the whole point -- a silent
// baseline for an effect that should have been scored is the defect class
// hard constraint 4 exists to prevent.
//
// Scoring is only half of usability: each still needs an EFFECT_EXECUTORS entry
// or applyMove throws by name, which is the intended loud failure.
const AI_NO_DISPATCH_EFFECTS = new Set([
  "EFFECT_ASSIST", "EFFECT_FOLLOW_ME", "EFFECT_GRUDGE", "EFFECT_METRONOME",
  "EFFECT_MIMIC", "EFFECT_SPITE", "EFFECT_TAUNT", "EFFECT_TEETER_DANCE",
  "EFFECT_TRANSFORM", "EFFECT_WISH",
]);

// Phase D F2a -- what the AI knows of the PLAYER's ability.
//
// get_ability AI_TARGET (Cmd_get_ability, src/battle_ai_script_commands.c:
// 1350-1404) answers from BATTLE_HISTORY->abilities[target] once recorded;
// else the TRUE ability if it is Shadow Tag / Magnet Pull / Arena Trap; else
// the species' ability (gBattleMons[].species -- the transformed species after
// Transform), with a FRESH `Random() & 1` between the two of a two-ability
// species at EVERY execution. So each get_ability site is its own independent
// draw: `taRead` mixes the rest of the routine over the belief, and a path with
// two reads (the head then the Soundproof check; AttackDown / AccDown then
// CheckIfAbilityBlocksStatChange; Magnitude then HighRiskForDamage) nests two
// independent mixtures. There is deliberately no ctx.targetAbility any more.
//
// check_ability (the `if_ability` macro, asm/macros/battle_ai_script.inc:575-
// 578; Cmd_check_ability :1407-1455) is different and deterministic: history,
// else a trapping ability, else for a two-ability species "unable to answer"
// (never a match), else the one species ability. Only AI_CBM_SpeedDown (:289)
// uses it on the target in singles.
const TRAP_ABILITIES = new Set(["Shadow Tag", "Magnet Pull", "Arena Trap"]);
function aiTargetAbilityBelief(record, mon) {
  if (record != null) return [{ p: 1, ability: record }];
  if (TRAP_ABILITIES.has(mon.ability)) return [{ p: 1, ability: mon.ability }];
  const sp = SPECIES[mon.species]?.abilities;
  if (!sp || sp.length === 0) throw new Error(`aiTargetAbilityBelief: no species abilities for "${mon.species}"`);
  return sp.length === 2 ? [{ p: 0.5, ability: sp[0] }, { p: 0.5, ability: sp[1] }] : [{ p: 1, ability: sp[0] }];
}
function aiTargetAbilityCheck(record, mon, ability) {
  if (record != null) return record === ability;
  if (TRAP_ABILITIES.has(mon.ability)) return mon.ability === ability;
  const sp = SPECIES[mon.species].abilities;
  return sp.length === 1 && sp[0] === ability;
}
const asDist = (r) => (Array.isArray(r) ? r : [{ p: 1, delta: r }]);
// One execution of get_ability AI_TARGET: f(ability) is everything the script
// does after it, returning a scalar delta or a [{p, delta}] distribution.
function taRead(ctx, f) {
  const b = ctx.targetAbilityBelief;
  if (!b) throw new Error("taRead: ctx.targetAbilityBelief missing -- build ctx through chooseOpponentMoves");
  if (b.length === 1) return f(b[0].ability);
  const out = [];
  for (const { p, ability } of b) for (const d of asDist(f(ability))) out.push({ p: p * d.p, delta: d.delta });
  return out;
}

// RecordAbilityBattle (src/battle_ai_script_commands.c:643) for the PLAYER --
// BATTLE_HISTORY->abilities[0], the only history this engine's one AI reads.
// The call sites follow source's, event by event (survey: phase-d-log F2).
function recordAbility(s, side, ability) {
  if (side === "you" && ability) s.youAbilityRecord = ability;
}

// The move scripts' own ability checks (jumpifability / jumpifcantmakeasleep /
// tryexplosion / tryinfatuating / tryKO / healpartystatus / the Soundproof
// block at attackcanceler), called once the move has passed the canceler.
// Source's attackcanceler Protect branch only sets MISSED and CONTINUES the
// script (src/battle_script_commands.c:991-1001), so the checks placed before
// accuracycheck record into a Protect and on a miss alike; the ones after it
// need a landed move.
function recordScriptAbilityChecks(ctx, s, actor, moveName, moveData, hit, blockedByProtect) {
  const isYou = actor === "you";
  const self = isYou ? ctx.you : ctx.opp, foe = isYou ? ctx.opp : ctx.you;
  const selfSide = actor, foeSide = isYou ? "opp" : "you";
  const fa = foe.ability;
  const foeSub = s[foeSide + "SubstituteHP"] != null;
  const foeStatus = s[foeSide + "Status"];
  // ABILITYEFFECT_MOVES_BLOCK (bsc.c:932), inside attackcanceler.
  if (fa === "Soundproof" && SOUND_MOVES.has(moveName)) { recordAbility(s, foeSide, fa); return; }
  switch (moveData.effect) {
    case "EFFECT_TOXIC": case "EFFECT_POISON":        // bs:690, :990 -- first check
      if (fa === "Immunity") recordAbility(s, foeSide, fa); break;
    case "EFFECT_PARALYZE":                           // bs:1011 -- first check
      if (fa === "Limber") recordAbility(s, foeSide, fa); break;
    case "EFFECT_CONFUSE": case "EFFECT_TEETER_DANCE": // bs:907, :2580
      if (fa === "Own Tempo") recordAbility(s, foeSide, fa); break;
    case "EFFECT_WILL_O_WISP":                        // bs:2181, after Sub / burned / Fire
      if (!foeSub && foeStatus !== "burn" && !foe.types.includes("Fire") && fa === "Water Veil") recordAbility(s, foeSide, fa);
      break;
    case "EFFECT_YAWN":                               // bs:2455-2456 -- first checks
      if (fa === "Vital Spirit" || fa === "Insomnia") recordAbility(s, foeSide, fa); break;
    case "EFFECT_SLEEP":                              // bs:290 jumpifcantmakeasleep, after Sub / asleep
      if (!foeSub && foeStatus !== "sleep" && !uproarActive(s) && (fa === "Insomnia" || fa === "Vital Spirit")) recordAbility(s, foeSide, fa);
      break;
    case "EFFECT_ROAR":                               // bs:597 -- first check
      if (fa === "Suction Cups") recordAbility(s, foeSide, fa); break;
    case "EFFECT_EXPLOSION":                          // Cmd_tryexplosion (:6560-6575): the first Damp
      if (ctx.you.ability === "Damp") recordAbility(s, "you", "Damp"); // battler from 0 -- the player
      break;
    case "EFFECT_REST":                               // bs:740: target = the user (opponent controller
      if (s[selfSide + "Status"] !== "sleep" && !uproarActive(s)  // sets gBattlerTarget = user)
          && (self.ability === "Insomnia" || self.ability === "Vital Spirit")) recordAbility(s, selfSide, self.ability);
      break;
    case "EFFECT_PERISH_SONG":                        // bs:1578: every battler with Soundproof
      if (ctx.you.ability === "Soundproof") recordAbility(s, "you", "Soundproof"); break;
    case "EFFECT_HEAL_BELL":                          // Cmd_healpartystatus (:8394): Heal Bell only
      if (moveName === "Heal Bell" && self.ability === "Soundproof") recordAbility(s, selfSide, "Soundproof"); break;
    case "EFFECT_OHKO": {                             // accuracycheck NO_ACC_CALC_CHECK_LOCK_ON, typecalc, tryKO
      if (blockedByProtect) break;
      const inv = s[foeSide + "Charging"]?.invulnBit;
      if (inv && s[foeSide + "AlwaysHitTurns"] == null) break;
      if (fa === "Levitate" && moveData.type === "Ground") { recordAbility(s, foeSide, fa); break; } // typecalc :1382
      if (typeEffectiveness(moveData.type, foe.types, s[foeSide + "Foresighted"]) === 0) break;
      if (fa === "Sturdy") recordAbility(s, foeSide, fa);                                          // tryKO :7518
      break;
    }
  }
  if (!hit) return;
  switch (moveData.effect) {
    case "EFFECT_SWAGGER": case "EFFECT_FLATTER":     // bs:1625 / :2168, after the stat raise
      if (!foeSub && !(s[foeSide + "Confused"] && (s[foeSide + "Stages"][moveData.effect === "EFFECT_SWAGGER" ? "atk" : "spa"] >= 6))
          && fa === "Own Tempo") recordAbility(s, foeSide, fa);
      break;
    case "EFFECT_ATTRACT":                            // Cmd_tryinfatuating (:7680) -- its first check
      if (fa === "Oblivious") recordAbility(s, foeSide, fa); break;
  }
}

// CheckWonderGuardAndLevitate (bsc.c:1426-1500), reached only from a MISSED
// accuracy ROLL (Cmd_accuracycheck :1181) -- not from Protect, a semi-
// invulnerable target or a sure hit, which never roll.
function recordMissedTypecalcAbility(ctx, s, actor, moveName, moveData) {
  if (moveData.power === 0 || moveName === "Struggle") return;
  const isYou = actor === "you";
  const foe = isYou ? ctx.opp : ctx.you, foeSide = isYou ? "opp" : "you";
  const inv = s[foeSide + "Charging"]?.invulnBit;
  if (inv && !INVULN_BYPASS[inv]?.[moveName]) return;
  if (foe.ability === "Levitate" && moveData.type === "Ground") recordAbility(s, foeSide, "Levitate");
  if (foe.ability === "Wonder Guard") {
    const { hadSuper, hadNVE } = typeEffectivenessBreakdown(moveData.type, foe.types, s[foeSide + "Foresighted"]);
    if (!(hadSuper && !hadNVE)) recordAbility(s, foeSide, "Wonder Guard");
  }
}

// AI_CBM_Confuse (data/battle_ai_scripts.s:386-391), dispatched for
// EFFECT_CONFUSE and EFFECT_SWAGGER (:169): already confused -5, then its own
// get_ability (Own Tempo -10), then Safeguard -10.
const aiCbmConfuse = (ctx) => {
  if (ctx.targetConfused) return -5;
  return taRead(ctx, (a) => (a === "Own Tempo" || ctx.targetSafeguarded ? -10 : 0));
};

// AI_CBM_Attract's gender tail (data/battle_ai_scripts.s:459-): -10 unless the
// two genders are opposite; either may be uncertain for a variable-ratio species.
function attractGenderDist(ctx) {
  const bucket = new Map();
  for (const u of ctx.userGenderDist) {
    for (const t of ctx.targetGenderDist) {
      const p = u.p * t.p;
      if (p === 0) continue;
      const compatible = u.gender !== "genderless" && t.gender !== "genderless" && u.gender !== t.gender;
      const delta = compatible ? 0 : -10;
      bucket.set(delta, (bucket.get(delta) || 0) + p);
    }
  }
  return [...bucket.entries()].map(([delta, p]) => ({ p, delta }));
}

// CheckIfAbilityBlocksStatChange (data/battle_ai_scripts.s:308-312) -- the
// shared tail every single-stat-lowering AI_CBM_* `goto`s into. Its own read.
const abilityBlocksStatChange = (ctx) =>
  taRead(ctx, (a) => ((a === "Clear Body" || a === "White Smoke") ? -10 : 0));

// AI_CV_DefenseDown (data/battle_ai_scripts.s:1124-1135), shared by
// EFFECT_DEFENSE_DOWN and EFFECT_TICKLE (both if_effect rows name this label).
// Control flow, with the fallthroughs the labels hide: the entry block goes to
// _2 when the user is below 70% HP, to _3 when the target's Defense is above
// -3 stages, and otherwise FALLS THROUGH into _2 (:1127). _2 is a 50/256 skip
// around a -2 and then falls through into _3 (:1130). _3 adds a second -2
// unless the target is above 70% HP.
function defenseDownViability(ctx) {
  const block3 = (d) => (ctx.targetHpPct > 70 ? d : combineDist(d, [{ p: 1, delta: -2 }]));
  if (ctx.userHpPct >= 70 && ctx.targetStages.def > -3) return block3([{ p: 1, delta: 0 }]);
  return block3(combineDist([{ p: 1, delta: 0 }],
    [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -2 }]));
}

// AI_CBM_HighRiskForDamage (data/battle_ai_scripts.s:368-376). ONE routine in
// source, dispatched for ten different effects (:128 Superpower, :151 Recharge,
// :154 LevelDamage, :156, :160 Flail, :175 Magnitude's fallthrough, :182, and
// the batch 5 arrivals Super Fang :129, Psywave :155, Present :172,
// Sonic Boom :177, Endeavor :203, Low Kick :206), so it is ONE function here.
//
// It was ten byte-identical hand-written copies until batch 5 needed a
// eleventh. Ten copies of a clause is how a clause gets fixed in nine places
// (amendments 9 and 10) -- the Hustle and Choice Band shape, before it happens.
//
// -10 if the move is immune outright, or if the target has Wonder Guard and
// this hit is not a clean "x2". AI_EFFECTIVENESS_x2 is an EXACT category match
// in source, not "at least 2x" -- a real, preserved quirk.
const highRiskForDamage = (ctx) => {
  if (typeEffectiveness(ctx.moveType, ctx.targetTypes) === 0) return -10;
  return taRead(ctx, (a) => (a === "Wonder Guard" && typeEffectiveness(ctx.moveType, ctx.targetTypes) !== 2 ? -10 : 0));
};

// AI_CV_Thief_EncourageItemsToSteal (:1860-1867).
const THIEF_ENCOURAGED_HOLD_EFFECTS = THIEF_ITEMS_TO_STEAL; // generated (F12)
// Phase D F12: AI_CV_Recycle_ItemsToEncourage and AI_CV_ChangeSelfAbility_
// AbilitiesToEncourage are GENERATED (ai-tables.js). The hand copies were wrong:
// Recycle had nine hold effects where the script lists three ITEMS (Chesto,
// Lum, Starf Berry); ChangeSelfAbility stopped at 12 of 16 (no Marvel Scale,
// Pure Power, Chlorophyll, Shield Dust).

const AI_HANDLERS = {
  // -- B2b batch 4: support, status-clearing and status-inflicting --------
  EFFECT_HELPING_HAND: {
    // AI_CBM_HelpingHand (data/battle_ai_scripts.s:541-544) is a single
    // `if_not_double_battle Score_Minus10`. The Arena is singles, so this is
    // ALWAYS -10 -- not a state read at all.
    checkBadMove: () => -10,
  },
  EFFECT_SPIKES: {
    // AI_CBM_Spikes (:439-442): -10 once the target's side already has a layer.
    // Source checks the side STATUS, not the count, so a second layer is
    // discouraged even though up to three are legal.
    checkBadMove: (ctx) => (ctx.targetSideHasSpikes ? -10 : 0),
  },
  EFFECT_HEAL_BELL: {
    // AI_CV_HealBell (:1841-1847). VANILLA QUIRK PRESERVED: both checks read
    // AI_TARGET -- the PLAYER's status and the PLAYER's party
    // (Cmd_if_status_in_party resolves AI_TARGET to gBattlerTarget, and
    // GetBattlerSide picks that side's party). So the AI declines its own
    // Heal Bell at -5 unless the PLAYER is statused, which is backwards from
    // the move's purpose. Ported as written, like AI_CV_Foresight's
    // non-BUGFIX arm; correcting it would disagree with the ROM.
    //
    // The player's PARTY status is not modelled (no reserve party in an Arena
    // matchup), so that clause defaults false -- the same stated convention
    // used everywhere else in this file.
    checkViability: (ctx) => (ctx.targetStatus !== null || ctx.targetPartyStatused
      ? [{ p: 1, delta: 0 }]
      : [{ p: 1, delta: -5 }]),
  },
  EFFECT_REFRESH: {
    // AI_CBM_Refresh (:563-566): -10 unless the USER carries poison, burn,
    // paralysis or bad poison. Note sleep and freeze are NOT in that mask --
    // Refresh cannot cure them, and the AI knows it.
    checkBadMove: (ctx) => (["poison", "burn", "paralysis"].includes(ctx.userStatus) ? 0 : -10),
    // AI_CV_Refresh (:2514-2522): -1 while the TARGET is below 50% HP.
    checkViability: (ctx) => [{ p: 1, delta: ctx.targetHpPct < 50 ? -1 : 0 }],
  },
  EFFECT_NIGHTMARE: {
    // AI_CBM_Nightmare (:237-241): -10 if the target already has it, then -8
    // if the target is not asleep. Two different penalties, in that order.
    checkBadMove: (ctx) => {
      if (ctx.targetNightmared) return -10;
      if (ctx.targetStatus !== "sleep") return -8;
      return 0;
    },
  },
  EFFECT_FLATTER: {
    // AI_CBM_Confuse, shared with EFFECT_CONFUSE.
    checkBadMove: (ctx) => (ctx.targetConfused ? -5 : 0),
    // AI_CV_Flatter (:1464-1466) is a 128/256 gate in FRONT of AI_CV_Confuse,
    // and it FALLS THROUGH into it either way -- so the +1 and the confuse
    // block compose rather than alternate.
    checkViability: (ctx) => combineDist(
      [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }],
      AI_HANDLERS.EFFECT_CONFUSE.checkViability(ctx),
    ),
  },
  EFFECT_PAIN_SPLIT: {
    // AI_CV_PainSplit (:1768-1784). No AI_CBM row.
    checkViability: (ctx) => {
      if (ctx.targetHpPct < 80) return [{ p: 1, delta: -1 }];
      if (ctx.targetFaster) return [{ p: 1, delta: ctx.userHpPct > 60 ? -1 : 1 }];
      return [{ p: 1, delta: ctx.userHpPct > 40 ? -1 : 1 }];
    },
  },
  EFFECT_MIRROR_MOVE: {
    // AI_CV_MirrorMove (data/battle_ai_scripts.s:838-853). No AI_CBM row.
    // Reads the target's last move against the 39-move
    // AI_CV_MirrorMove_EncouragedMovesToMirror table, generated into
    // ai-tables.js rather than transcribed.
    checkViability: (ctx) => {
      const encouraged = ctx.targetLastTakenMove != null && MIRROR_MOVE_ENCOURAGED.has(ctx.targetLastTakenMove);
      if (!ctx.targetFaster && encouraged) {
        return [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 2 }];
      }
      // AI_CV_MirrorMove2: an encouraged move here ends with no change;
      // otherwise 176/256 of -1.
      if (encouraged) return [{ p: 1, delta: 0 }];
      return [{ p: 80 / 256, delta: 0 }, { p: 176 / 256, delta: -1 }];
    },
  },
  EFFECT_SLEEP_TALK: {
    // AI_CBM_DamageDuringSleep (data/battle_ai_scripts.s:426-429): -8 unless
    // the USER is asleep. Shared with EFFECT_SNORE.
    checkBadMove: (ctx) => (ctx.userStatus === "sleep" ? 0 : -8),
    // AI_CV_SleepTalk (:1795-1799): +10 while asleep, a flat -5 otherwise.
    // One of the largest single swings in the whole scoring table.
    checkViability: (ctx) => [{ p: 1, delta: ctx.userStatus === "sleep" ? 10 : -5 }],
  },
  // -- B2b batch 2: the move-restriction family ---------------------------
  // Four effects whose if_effect rows exist in the dispatch chains but had no
  // port, so every set carrying one threw at the ai-scoring guard.
  EFFECT_DISABLE: {
    // AI_CBM_Disable (data/battle_ai_scripts.s:418-421).
    checkBadMove: (ctx) => (ctx.targetHasDisabledMove ? -8 : 0),
    // AI_CV_Disable (:1602-1617). `get_last_used_bank_move AI_TARGET` then
    // `get_move_power_from_result`: a target whose last move was a STATUS move
    // (or who has not moved at all, which reads the same on an empty history)
    // falls to AI_CV_Disable2 and is scored DOWN, because disabling a status
    // move is worth little. A damaging last move scores +1.
    checkViability: (ctx) => {
      if (ctx.targetFaster) return [{ p: 1, delta: 0 }];
      if (ctx.targetLastMoveHadPower) return [{ p: 1, delta: 1 }];
      return [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: -1 }];
    },
  },
  EFFECT_ENCORE: {
    // AI_CBM_Encore (:422-425).
    checkBadMove: (ctx) => (ctx.targetHasEncoredMove ? -8 : 0),
    // AI_CV_Encore (:1687-1702). Three ways to reach the +3 block: the target
    // already has a move disabled, or its last move's EFFECT is in
    // AI_CV_Encore_EncouragedMovesToEncore (62 effects, extracted into
    // ai-tables.js rather than transcribed). A faster target, or a last move
    // whose effect is not in that table, scores -2 instead.
    checkViability: (ctx) => {
      const encourage = [{ p: 30 / 256, delta: 0 }, { p: 226 / 256, delta: 3 }];
      if (ctx.targetHasDisabledMove) return encourage;
      if (ctx.targetFaster) return [{ p: 1, delta: -2 }];
      if (!ENCORE_ENCOURAGED_EFFECTS.has(ctx.targetLastMoveEffect)) return [{ p: 1, delta: -2 }];
      return encourage;
    },
  },
  EFFECT_TORMENT: {
    // AI_CBM_Torment (:527-530). No viability row.
    checkBadMove: (ctx) => (ctx.targetTormented ? -10 : 0),
  },
  EFFECT_IMPRISON: {
    // AI_CBM_Imprison (:559-562) -- keyed on the USER's own flag, since
    // STATUS3_IMPRISONED_OTHERS sits on the imprisoner.
    checkBadMove: (ctx) => (ctx.userImprisoning ? -10 : 0),
    // AI_CV_Imprison (:2506-2513): `is_first_turn_for AI_USER` then
    // `if_more_than 0, End` -- so the bonus is withheld ON the user's first
    // turn out and applies afterwards, at 156/256.
    checkViability: (ctx) => (ctx.userPastFirstTurn
      ? [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: 2 }]
      : [{ p: 1, delta: 0 }]),
  },
  // -- B2b batch 1: the stat-stage family -------------------------------
  // Nine effects whose if_effect rows exist in AI_CheckBadMove and/or
  // AI_CheckViability (data/battle_ai_scripts.s:51-214 / :652-776) but had no
  // port here, so every set carrying one threw at the ai-scoring guard.
  //
  // Stage convention: source stores statStages 0..12 with DEFAULT_STAT_STAGE 6,
  // MIN 0, MAX 12; this engine stores -6..+6. So `if_stat_level_more_than X, 8`
  // reads as `stage > 2` and `if_stat_level_less_than X, 4` as `stage < -2`.
  // `if_random_less_than N` is `Random() % 256 < N` (Cmd_if_random_less_than,
  // src/battle_ai_script_commands.c:663-671), i.e. probability N/256 --
  // enumerated as weighted branches, never sampled (hard constraint 3).
  EFFECT_DEFENSE_CURL: {
    // AI_CBM_DefenseUp (:253-256), shared with the already-ported
    // EFFECT_DEFENSE_UP family. EFFECT_DEFENSE_CURL has NO row in the
    // viability chain at all, so viability leaves the score untouched.
    checkBadMove: (ctx) => (ctx.userDefStage >= 6 ? -10 : 0),
  },
  EFFECT_DEFENSE_DOWN: {
    // AI_CBM_DefenseDown (:283-286) -> CheckIfAbilityBlocksStatChange (:308-312).
    checkBadMove: (ctx) => (ctx.targetStages.def <= -6 ? -10 : abilityBlocksStatChange(ctx)),
    checkViability: defenseDownViability,
  },
  EFFECT_SPEED_DOWN: {
    // AI_CBM_SpeedDown (:287-291): min stage, then Speed Boost, then the
    // shared Clear Body / White Smoke tail.
    checkBadMove: (ctx) => {
      if (ctx.targetStages.spe <= -6) return -10;
      if (ctx.targetAbilityIs("Speed Boost")) return -10; // if_ability: check_ability (F2a)
      return abilityBlocksStatChange(ctx);
    },
    // AI_CV_SpeedDown (:1142-1152): if the target already outspeeds the user,
    // 186/256 chance of +2; otherwise a flat -3. `if_target_faster` is
    // `if_user_goes 1` (asm/macros/battle_ai_script.inc:595-597) ->
    // GetWhoStrikesFirst(AI, target, TRUE) == 1, which is ctx.targetFaster.
    checkViability: (ctx) => (ctx.targetFaster
      ? [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: 2 }]
      : [{ p: 1, delta: -3 }]),
  },
  EFFECT_TICKLE: {
    // AI_CBM_Tickle (:571-575) -- note it does NOT fall through to
    // CheckIfAbilityBlocksStatChange the way the single-stat droppers do; it
    // ends on its own `end`, so Clear Body costs Tickle nothing in scoring.
    checkBadMove: (ctx) => {
      if (ctx.targetStages.atk <= -6) return -10;
      if (ctx.targetStages.def <= -6) return -8;
      return 0;
    },
    // Tickle's viability row points at AI_CV_DefenseDown -- literally the same
    // label EFFECT_DEFENSE_DOWN uses, so the two share one function.
    checkViability: defenseDownViability,
  },
  // EFFECT_MINIMIZE's rows in BOTH chains point at the SAME labels as
  // EFFECT_EVASION_UP (AI_CBM_EvasionUp :273-276 / AI_CV_EvasionUp :1037-1073),
  // so the scoring is shared outright rather than duplicated. Resolved at call
  // time because both entries live in this one object literal.
  EFFECT_MINIMIZE: {
    checkBadMove: (ctx) => AI_HANDLERS.EFFECT_EVASION_UP.checkBadMove(ctx),
    checkViability: (ctx) => AI_HANDLERS.EFFECT_EVASION_UP.checkViability(ctx),
  },
  EFFECT_FOCUS_ENERGY: {
    // AI_CBM_FocusEnergy (:382-385). No viability row.
    checkBadMove: (ctx) => (ctx.userFocusEnergy ? -10 : 0),
  },
  EFFECT_BELLY_DRUM: {
    // AI_CBM_BellyDrum (:247-248) and AI_CV_BellyDrum (:2077-2085). Both are
    // pure HP-percentage gates; note the thresholds differ (51 vs 90), so
    // between 51% and 89% the move is not "bad" but is scored -2.
    checkBadMove: (ctx) => (ctx.userHpPct < 51 ? -10 : 0),
    checkViability: (ctx) => [{ p: 1, delta: ctx.userHpPct < 90 ? -2 : 0 }],
  },
  EFFECT_HAZE: {
    // AI_CBM_Haze (:314-330): fourteen if_stat_level checks, each jumping to
    // AI_CBM_Haze_End (score unchanged). Only if ALL fourteen fall through --
    // none of the user's seven stats below default AND none of the target's
    // seven above it -- does it reach `goto Score_Minus10`. So Haze is "bad"
    // exactly when it would undo nothing.
    checkBadMove: (ctx) => {
      const u = [ctx.userAtkStage, ctx.userDefStage, ctx.userSpeStage,
        ctx.userSpAtkStage, ctx.userSpDefStage, ctx.userAccStage, ctx.userEvasionStage];
      if (u.some((v) => v < 0)) return 0;
      const t = ctx.targetStages;
      if ([t.atk, t.def, t.spe, t.spa, t.spd, t.accuracy, t.evasion].some((v) => v > 0)) return 0;
      return -10;
    },
    // AI_CV_Haze (:1247-1283). TWO sequential blocks, and the first FALLS
    // THROUGH into the second (AI_CV_Haze2 ends at :1262, AI_CV_Haze3 begins
    // at :1263), so a -3 and a +3 can both land in one evaluation.
    // Block 1 asks "would Haze throw away MY advantage" -> 206/256 of -3.
    // Block 2 asks the mirror question and is ALWAYS evaluated: either
    // 206/256 of +3 (Haze helps) or 206/256 of -1 (it does nothing either way).
    // The two blocks read DIFFERENT five-stat lists -- the user-side scan
    // includes EVASION and excludes ACC, the target-side scan the reverse --
    // preserved exactly as written.
    checkViability: (ctx) => {
      const t = ctx.targetStages;
      const uBoosted = [ctx.userAtkStage, ctx.userDefStage, ctx.userSpAtkStage,
        ctx.userSpDefStage, ctx.userEvasionStage].some((v) => v > 2);
      const tLowered = [t.atk, t.def, t.spa, t.spd, t.accuracy].some((v) => v < -2);
      const tBoosted = [t.atk, t.def, t.spa, t.spd, t.evasion].some((v) => v > 2);
      const uLowered = [ctx.userAtkStage, ctx.userDefStage, ctx.userSpAtkStage,
        ctx.userSpDefStage, ctx.userAccStage].some((v) => v < -2);
      let dist = [{ p: 1, delta: 0 }];
      if (uBoosted || tLowered) {
        dist = combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -3 }]);
      }
      return combineDist(dist, (tBoosted || uLowered)
        ? [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: 3 }]
        : [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -1 }]);
    },
  },
  EFFECT_FORESIGHT: {
    // AI_CBM_Foresight (:443-446): -10 if the target is already identified.
    checkBadMove: (ctx) => (ctx.targetForesighted ? -10 : 0),
    // AI_CV_Foresight (:1940-1964). VANILLA BUG PRESERVED, NOT CORRECTED: the
    // #ifdef BUGFIX arm checks AI_TARGET's types and evasion -- the side
    // Foresight actually affects -- but the shipped build does not define
    // BUGFIX (include/config.h:48 is a commented-out `#define BUGFIX`, and
    // MODERN is off for the agbcc build), so the live script checks the USER's
    // OWN type1/type2 and the USER's OWN evasion stage. Porting the fixed arm
    // would make this engine disagree with the ROM, which is exactly what
    // Phase D measures. Control flow: AI_CV_Foresight2 (:1957-1958) falls
    // THROUGH into AI_CV_Foresight3 (:1959-1961), so the Ghost path passes two
    // independent 80/256 gates before the +2.
    checkViability: (ctx) => {
      if (ctx.userTypes.includes("Ghost")) {
        const pPlus2 = (176 / 256) * (176 / 256);
        return [{ p: 1 - pPlus2, delta: 0 }, { p: pPlus2, delta: 2 }];
      }
      if (ctx.userEvasionStage > 2) return [{ p: 80 / 256, delta: 0 }, { p: 176 / 256, delta: 2 }];
      return [{ p: 1, delta: -2 }];
    },
  },
  EFFECT_TOXIC: {
    // AI_CBM_Toxic (data/battle_ai_scripts.s:341-352) — completing this now
    // (batch 4) since the Immunity-ability/already-statused/Safeguard ctx
    // fields already exist from earlier batches; previously only had the
    // Steel/Poison type-immunity check.
    checkBadMove: (ctx) => {
      if (ctx.targetTypes.includes("Steel") || ctx.targetTypes.includes("Poison")) return -10;
      return taRead(ctx, (a) => {
        if (a === "Immunity") return -10;
        if (ctx.targetStatus !== null) return -10;
        if (ctx.targetSafeguarded) return -10;
        return 0;
      });
    },
    // AI_CV_Toxic — see toxicFamilyViability above (shared with EFFECT_LEECH_SEED).
    checkViability: toxicFamilyViability,
  },
  EFFECT_ATTRACT: {
    // AI_CBM_Attract (data/battle_ai_scripts.s) — no AI_CV_Attract exists at
    // all (checkViability intentionally omitted). Full source logic:
    //   -10 if target already infatuated (STATUS2_INFATUATION)
    //   -10 if target has Oblivious
    //   else: get_gender(AI_USER) — if male, -10 unless target is female;
    //         if female, -10 unless target is male; if neither (genderless
    //         user), unconditionally -10 (a genderless user can never
    //         land Attract, so the AI always scores it as bad).
    // AI_USER here is the OPPONENT (the one considering the move) and
    // AI_TARGET is the player — so this handler is gated on the OPPONENT'S
    // OWN gender matching up against the player's, not just the player's.
    // Either side's gender may be genuinely uncertain (a variable-ratio
    // species with no fixed personality/config override), so this returns a
    // full distribution over the -10/0 delta rather than a scalar —
    // scoreOpponentMoveDist's checkBadMove consumer was extended (this
    // batch) to accept that, exactly like checkViability already does.
    checkBadMove: (ctx) => {
      if (ctx.targetInfatuated) return [{ p: 1, delta: -10 }];
      return taRead(ctx, (a) => (a === "Oblivious" ? [{ p: 1, delta: -10 }] : attractGenderDist(ctx)));
    },
  },
  EFFECT_CONFUSE: {
    // AI_CBM_Confuse (:386-391). Phase D F2a: this handler had only the
    // "already confused" check -- a half-port; Swagger's copy was whole. Both
    // now share aiCbmConfuse.
    checkBadMove: aiCbmConfuse,
    // AI_CV_Confuse — COMPLETE handler, source-verified (data/battle_ai_scripts.s:1467-1477).
    // Real structure: target HP>70% -> no penalty at all. Else a 50%-chance
    // -1 (the ONLY random roll in this handler), then UNCONDITIONAL further
    // -1 penalties layered on for HP<=50% and again for HP<=30% (not random
    // — my earlier "coin-flip" framing for the (50,70] band was right about
    // that band specifically, but wrong to imply the lower bands were also
    // probabilistic; they're guaranteed once you're in them).
    checkViability: (ctx) => {
      if (ctx.targetHpPct > 70) return [{ p: 1, delta: 0 }];
      const firstRoll = [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: -1 }]; // 50% chance -1
      if (ctx.targetHpPct > 50) return firstRoll;
      const afterSecond = combineDist(firstRoll, [{ p: 1, delta: -1 }]); // unconditional -1
      if (ctx.targetHpPct > 30) return afterSecond;
      return combineDist(afterSecond, [{ p: 1, delta: -1 }]); // another unconditional -1
    },
  },
  EFFECT_EVASION_UP: {
    // AI_CBM_EvasionUp: only penalized if evasion already maxed.
    checkBadMove: (ctx) => (ctx.userEvasionStage >= 6 ? -10 : 0),
    // AI_CV_EvasionUp — COMPLETE handler, source-verified (data/battle_ai_scripts.s:1037-1073).
    // 6 independent scoring blocks, most gated on statuses this engine
    // doesn't model yet (Toxic-poison, Leech Seed, Ingrain, Curse — all
    // default false below; wire in real values once those statuses exist).
    // My earlier approximation (userHpPct < 90 ? +3 : 0) had the HP
    // condition BACKWARDS (real bonus needs HP >= 90%) and only captured
    // 1 of these 6 blocks.
    checkViability: (ctx) => {
      let dist = [{ p: 1, delta: 0 }];

      // Block 1: user HP >= 90% -> 156/256 chance of +3.
      if (ctx.userHpPct >= 90) {
        dist = combineDist(dist, [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: 3 }]);
      }
      // Block 2: user's own evasion already >= +3 stages -> 50% chance of -1.
      if (ctx.userEvasionStage >= 3) {
        dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: -1 }]);
      }
      // Block 3: target badly poisoned (not modeled — always false for now).
      if (ctx.targetToxicPoisoned) {
        if (ctx.userHpPct > 50) {
          dist = combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: 3 }]);
        } else {
          const pPlus3 = (176 / 256) * (206 / 256); // must pass both gates
          dist = combineDist(dist, [{ p: 1 - pPlus3, delta: 0 }, { p: pPlus3, delta: 3 }]);
        }
      }
      // Block 4: target Leech Seeded (not modeled — always false for now).
      if (ctx.targetLeechSeeded) {
        dist = combineDist(dist, [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: 3 }]);
      }
      // Block 5: user Ingrained (not modeled — always false for now).
      if (ctx.userIngrained) {
        dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 2 }]);
      }
      // Block 6: target Cursed (not modeled — always false for now).
      if (ctx.targetCursed) {
        dist = combineDist(dist, [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: 3 }]);
      }
      // Block 7: mutual-low-HP anti-stall check (only relevant once evasion
      // has actually been raised, i.e. after Double Team already landed once).
      if (ctx.userHpPct <= 70 && ctx.userEvasionStage !== 0) {
        if (ctx.userHpPct < 40 || ctx.targetHpPct < 40) {
          dist = combineDist(dist, [{ p: 1, delta: -2 }]); // guaranteed
        } else {
          dist = combineDist(dist, [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: -2 }]);
        }
      }
      return dist;
    },
  },
  EFFECT_ALWAYS_HIT: {
    // AI_CV_AlwaysHit (data/battle_ai_scripts.s:1075-1089). Phase D F9: this
    // returned 0 ("neither condition modeled yet") although both stages are.
    // Raw stages converted to display: evasion > +4 / accuracy < -4 -> +1 then
    // AlwaysHit2; evasion > +2 / accuracy < -2 -> AlwaysHit2 alone.
    // AI_CV_AlwaysHit2: if_random_less_than 100 -> end, else +1 (156/256).
    checkViability: (ctx) => {
      const eva = ctx.targetStages.evasion, acc = ctx.userAccStage;
      const alwaysHit2 = [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: 1 }];
      if (eva > 4 || acc < -4) return combineDist([{ p: 1, delta: 1 }], alwaysHit2);
      if (eva > 2 || acc < -2) return alwaysHit2;
      return 0;
    },
  },
  // EFFECT_OHKO (Horn Drill/Fissure/Guillotine/Sheer Cold) — the first power>0
  // effect ever added to AI_HANDLERS (every other entry here is a power=0
  // status move); see HANDOFF.md §10 for the full bug history. AI_CBM_OneHitKO
  // (data/battle_ai_scripts.s:358-363): type-immune target, target Sturdy, or
  // the AI's own level being LOWER than the target's (an OHKO can never land
  // in that case, see Cmd_tryKO) are each an outright -10. AI_CV_OneHitKO
  // (:1427-1428) is a bare `end` — genuinely contributes nothing, matching
  // this engine's "AI is blind to Arena scoring" model, not an omission.
  EFFECT_OHKO: {
    checkBadMove: (ctx) => {
      if (typeEffectiveness(ctx.moveType, ctx.targetTypes) === 0) return -10;
      return taRead(ctx, (a) => (a === "Sturdy" || ctx.userLevel < ctx.targetLevel ? -10 : 0));
    },
    checkViability: () => 0,
  },
  // AI_CV_HighCrit — see highCritViability's own comment above for the full
  // source citation and branch shape. Karate Chop/Razor Leaf/Crabhammer/
  // Slash/Aeroblast/Cross Chop/Air Cutter/Leaf Blade share EFFECT_HIGH_CRITICAL;
  // Blaze Kick and Poison Tail are their own effects but dispatch to the
  // identical AI_CV_HighCrit routine in source (:766/:772), so they share
  // this same handler function, not a separate copy.
  EFFECT_HIGH_CRITICAL: { checkViability: highCritViability },
  EFFECT_BLAZE_KICK: { checkViability: highCritViability },
  EFFECT_POISON_TAIL: { checkViability: highCritViability },
  // ── Systematic AI-handler port, batch 1 (see HANDOFF.md §7 step 1) ────────
  EFFECT_PARALYZE: {
    // AI_CBM_Paralyze (data/battle_ai_scripts.s:397-403) — fully deterministic,
    // no live randomness anywhere in this handler (true of every AI_CBM_*
    // handler sampled across the whole file; only AI_CV_* ever rolls dice).
    checkBadMove: (ctx) => {
      if (typeEffectiveness(ctx.moveType, ctx.targetTypes) === 0) return -10; // e.g. Electric vs Ground
      return taRead(ctx, (a) => {
        if (a === "Limber") return -10;
        if (ctx.targetStatus !== null) return -10; // STATUS1_ANY — already has a major status
        if (ctx.targetSafeguarded) return -10;
        return 0;
      });
    },
    // AI_CV_Paralyze (data/battle_ai_scripts.s:1524-1534) — the "if_random_less_than
    // roll" shape: a single clean 20/256 dice roll gates the bonus, nested
    // under one deterministic branch (target's speed relative to the user).
    //   if_target_faster -> Paralyze2; else: userHP>70 ? nothing : -1
    //   Paralyze2: 20/256 chance of nothing, else +3
    checkViability: (ctx) => {
      if (ctx.targetFaster) {
        return [{ p: 20 / 256, delta: 0 }, { p: 236 / 256, delta: 3 }];
      }
      return ctx.userHpPct > 70 ? [{ p: 1, delta: 0 }] : [{ p: 1, delta: -1 }];
    },
  },
  EFFECT_ROAR: {
    // AI_CBM_Roar (data/battle_ai_scripts.s:334-339). count_usable_party_mons
    // (src/battle_ai_script_commands.c:1292-1331) reads gPlayerParty/gEnemyParty
    // directly and has NO battle-type awareness at all — it just counts alive,
    // valid-species party slots other than the two currently on-field indices.
    // Frontier trainer parties are always built at FRONTIER_PARTY_SIZE = 3
    // (include/constants/global.h:35) regardless of facility — Arena is no
    // exception (src/battle_tower.c:3350-3352 loads gBattleFrontierMons/
    // gBattleFrontierTrainers for it same as Tower/Dome/Factory). So the
    // player's ACTUAL Emerald party during an Arena round also has 3 slots,
    // 2 of them "benched" reserves that are alive/valid-species but can never
    // be switched to (Arena disables switching elsewhere, NOT here) — the AI
    // is blind to that lock and sees a normal nonzero reserve count, exactly
    // per the user's real-gameplay observation that Roar isn't deprioritized.
    // ctx.targetUsablePartyMons therefore models "how many of the player's
    // OTHER team members are still alive," defaulting to 2 (full team intact)
    // until the team-run workflow can track actual fainted reserves — see
    // ctx wiring in chooseOpponentMoves and the analyzeMatchup option below.
    checkBadMove: (ctx) => {
      if (ctx.targetUsablePartyMons === 0) return -10;
      return taRead(ctx, (a) => (a === "Suction Cups" ? -10 : 0));
    },
    // AI_CV_Roar (data/battle_ai_scripts.s:1290-1303). Control-flow note: the
    // 5 "if_stat_level_more_than ... AI_CV_Roar2" checks JUMP AWAY from the
    // "score -3" fallthrough when true — i.e. a boosted target stat SKIPS the
    // penalty and goes to the 50/50 roll instead. Reading this backwards
    // (penalizing Roar against a boosted target) would repeat the exact class
    // of bug flagged in HANDOFF.md Lesson re: EvasionUp's backwards HP check.
    checkViability: (ctx) => {
      const s = ctx.targetStages;
      const targetHasBoostedStat = s.atk > 2 || s.def > 2 || s.spa > 2 || s.spd > 2 || s.evasion > 2;
      if (!targetHasBoostedStat) return [{ p: 1, delta: -3 }];
      return [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 2 }];
    },
  },
  EFFECT_REST: {
    // No AI_CBM_Rest exists in source — Rest has no checkBadMove at all.
    // AI_CV_Rest (data/battle_ai_scripts.s:1396-1425) — the canonical
    // "HP-conditional branch" shape: a speed check picks one of two HP-tier
    // ladders (40/50 vs 60/70), each tier either a flat penalty or a further
    // random-gated fallthrough into a shared low-HP tail (Rest6/Rest7) that
    // itself has one more (unmodeled-Snatch-gated, so always-taken) roll.
    checkViability: (ctx) => {
      // Rest6/Rest7 tail — reached whenever HP is low enough to actually
      // consider Resting. ctx.targetHasSnatch is always false (not modeled),
      // so the "doesn't have Snatch" branch is always taken, landing
      // straight on the 10/256-vs-246/256 roll.
      const restTail = () => [{ p: 10 / 256, delta: 0 }, { p: 246 / 256, delta: 3 }];

      if (!ctx.targetFaster) {
        if (ctx.userHpPct === 100) return [{ p: 1, delta: -8 }];
        if (ctx.userHpPct < 40) return restTail();
        if (ctx.userHpPct > 50) return [{ p: 1, delta: -3 }];
        // HP in [40, 50]: 70/256 chance of still trying (restTail), else -3.
        return [
          ...restTail().map((d) => ({ p: (70 / 256) * d.p, delta: d.delta })),
          { p: 186 / 256, delta: -3 },
        ];
      }
      // Target faster — note this skips the "user at 100% HP -> -8" check
      // entirely (source asymmetry, not a translation bug: AI_CV_Rest4 is
      // jumped to directly, bypassing the HP-equal-100 test upstream of it).
      if (ctx.userHpPct < 60) return restTail();
      if (ctx.userHpPct > 70) return [{ p: 1, delta: -3 }];
      // HP in [60, 70]: 50/256 chance of still trying (restTail), else -3.
      return [
        ...restTail().map((d) => ({ p: (50 / 256) * d.p, delta: d.delta })),
        { p: 206 / 256, delta: -3 },
      ];
    },
  },
  // ── Batch 2: the stat-boost family (data/battle_ai_scripts.s:249-1025) ───
  // EFFECT_X_UP and EFFECT_X_UP_2 route to the SAME source handler for each
  // stat (e.g. Swords Dance/EFFECT_ATTACK_UP_2 and the hypothetical +1
  // version share AI_CBM_AttackUp/AI_CV_AttackUp) — registered twice here
  // since our dispatch is keyed per JS effect string, not per source label.
  EFFECT_ATTACK_UP: {
    // AI_CBM_AttackUp (:249-251): own stat already at +6 -> -10.
    checkBadMove: (ctx) => (ctx.userAtkStage >= 6 ? -10 : 0),
    checkViability: (ctx) => attackFamilyViability(ctx, "userAtkStage", 40),
  },
  EFFECT_SPECIAL_ATTACK_UP: {
    // AI_CBM_SpAtkUp (:261-263).
    checkBadMove: (ctx) => (ctx.userSpAtkStage >= 6 ? -10 : 0),
    checkViability: (ctx) => attackFamilyViability(ctx, "userSpAtkStage", 70),
  },
  EFFECT_DEFENSE_UP: {
    // AI_CBM_DefenseUp (:253-255).
    checkBadMove: (ctx) => (ctx.userDefStage >= 6 ? -10 : 0),
    // AI_CV_DefenseUp (:915-954): Defense boost wasted if last hit was special.
    checkViability: (ctx) => defenseFamilyViability(ctx, "userDefStage", false),
  },
  EFFECT_SPECIAL_DEFENSE_UP: {
    // AI_CBM_SpDefUp (:265-267).
    checkBadMove: (ctx) => (ctx.userSpDefStage >= 6 ? -10 : 0),
    // AI_CV_SpDefUp (:986-1025): SpDef boost wasted if last hit was physical.
    checkViability: (ctx) => defenseFamilyViability(ctx, "userSpDefStage", true),
  },
  EFFECT_SPEED_UP: {
    // AI_CBM_SpeedUp (:257-259).
    checkBadMove: (ctx) => (ctx.userSpeStage >= 6 ? -10 : 0),
    // AI_CV_SpeedUp (:956-965) — much simpler than the other 4: target
    // already slower -> flat -3 (Agility redundant); target faster -> 70/256
    // chance of nothing, else +3.
    checkViability: (ctx) => {
      if (!ctx.targetFaster) return [{ p: 1, delta: -3 }];
      return [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: 3 }];
    },
  },
  // ── Batch 3: EFFECT_SLEEP (Hypnosis/Spore/Lovely Kiss/Sing/Sleep Powder) ─
  EFFECT_SLEEP: {
    // AI_CBM_Sleep (:216-222) — fully deterministic, mirrors AI_CBM_Paralyze's
    // shape (ability immunity + already-statused + Safeguard), no type check
    // here since sleep-inducing moves aren't type-gated the way Thunder
    // Wave/Stun Spore are (NOTE: does not model the separate "powder moves
    // fail vs Grass-types" exemption relevant to Spore/Sleep Powder — same
    // known gap as flagged on EFFECT_PARALYZE's Stun Spore).
    checkBadMove: (ctx) => {
      return taRead(ctx, (a) => {
        if (a === "Insomnia" || a === "Vital Spirit") return -10;
        if (ctx.targetStatus !== null) return -10;
        if (ctx.targetSafeguarded) return -10;
        return 0;
      });
    },
    // AI_CV_Sleep (:778-787) — ported LITERALLY as written even though it
    // reads unintuitively: it checks whether AI_TARGET (the PLAYER, per
    // every other AI_TARGET-using command verified so far — if_hp_more_than,
    // if_target_faster, count_usable_party_mons) has Dream Eater/Nightmare,
    // not the opponent using Sleep. Preserved as-is rather than "corrected"
    // to check the opponent's own moveset — real AI quirks get kept (see
    // the Foresight AI_CV_Foresight BUG comment in the same source file for
    // another example of this codebase preserving an odd-but-real check).
    checkViability: (ctx) => {
      if (!ctx.targetHasDreamEaterOrNightmare) return [{ p: 1, delta: 0 }];
      return [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }];
    },
  },
  // EFFECT_ABSORB (Absorb / Mega Drain / Leech Life / Giga Drain) — AI_CV_Absorb
  // (data/battle_ai_scripts.s:789-798), dispatched from AI_CheckViability at :655.
  // SCORING side only. The drain-heal is a SEPARATE, still-open gap (no executor,
  // opponent HP understated on every drain hit) — deliberately NOT touched here so
  // this change's blast radius stays attributable; it is change #10.
  //
  // Source discourages a RESISTED drain: if raw type effectiveness is EXACTLY
  // 0.5x or 0.25x, it rolls, and on the COMPLEMENT of the roll applies score -3.
  // The source label is AI_CV_AbsorbEncourageMaybe but its body DISCOURAGES — a
  // source misnomer, called out here so grepping the .s doesn't mislead.
  //
  // PROBABILITY 206/256 (80.47%), NOT 50%: `if_random_less_than 50` is a byte
  // compare (Random() % 256 < 50) and the taken jump SKIPS the score command, so
  // -3 fires on the (256-50)/256 that DON'T jump. Read as a flat 50% by a prior
  // audit — the same misread class as the earlier ~61% Counter-roll error; this
  // note exists to stop a third repeat.
  //
  // EQUALITY, not threshold: source's if_type_effectiveness is an EXACT match
  // against quantized constants (x0_5 == 20, x0_25 == 10). STAB is irrelevant —
  // the command re-quantizes the STAB-inflated 30->20 and 15->10 before comparing,
  // so a raw 0.5/0.25 covers STAB and non-STAB alike. Expressed with the file's
  // standard typeEffectiveness(...) === n idiom; all reachable products are exact
  // binary fractions, so === is safe (same reliance as the existing === 2/=== 4).
  //
  // 0x (immune) is NOT penalized: source has no if_type_effectiveness x0 line, so
  // an immune target falls straight through to score 0. Counterintuitive but
  // source-exact — do NOT "fix" a 0x target into the penalty branch.
  EFFECT_ABSORB: {
    checkViability: (ctx) => {
      const eff = typeEffectiveness(ctx.moveType, ctx.targetTypes);
      if (eff === 0.5 || eff === 0.25) {
        return [{ p: 206 / 256, delta: -3 }, { p: 50 / 256, delta: 0 }];
      }
      return 0;
    },
  },
  // ── Batch 4: Dragon Dance, Curse, Leech Seed, Baton Pass ─────────────────
  EFFECT_DRAGON_DANCE: {
    // AI_CBM_DragonDance (:595-598): own Atk maxed -> -10; else own Speed
    // maxed -> -8 (sequential terminal checks — only the first true one fires).
    checkBadMove: (ctx) => {
      if (ctx.userAtkStage >= 6) return -10;
      if (ctx.userSpeStage >= 6) return -8;
      return 0;
    },
    // AI_CV_DragonDance (:2603-2614): target faster -> 128/256 chance of
    // nothing else +1; else (user faster/tied) -> own HP>50 nothing, else
    // 70/256 chance nothing else -1.
    checkViability: (ctx) => {
      if (ctx.targetFaster) {
        return [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }];
      }
      if (ctx.userHpPct > 50) return [{ p: 1, delta: 0 }];
      return [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: -1 }];
    },
  },
  EFFECT_CURSE: {
    // AI_CBM_Curse (:434-437) — generic regardless of the user's own type
    // (even though the Atk/Def check below is only relevant to the non-Ghost
    // branch; that's how the real script is written, not something to "fix").
    checkBadMove: (ctx) => {
      if (ctx.userAtkStage >= 6) return -10;
      if (ctx.userDefStage >= 6) return -8;
      return 0;
    },
    // AI_CV_Curse (:1870-1892) — genuinely branches on the USER's own type.
    // Ghost: HP>80 -> nothing, else -1 (the HP-sacrifice version is riskier
    // when already hurt). Non-Ghost: 3 independent 50/50 rolls, each +1,
    // gated on successively lower Def-stage thresholds (+3/+1/neutral) — the
    // lower the current Def stage, the more of these stack.
    checkViability: (ctx) => {
      if (ctx.userTypes.includes("Ghost")) {
        return ctx.userHpPct > 80 ? [{ p: 1, delta: 0 }] : [{ p: 1, delta: -1 }];
      }
      let dist = [{ p: 1, delta: 0 }];
      if (ctx.userDefStage <= 3) dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }]);
      if (ctx.userDefStage <= 1) dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }]);
      if (ctx.userDefStage <= 0) dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }]);
      return dist;
    },
  },
  EFFECT_LEECH_SEED: {
    // AI_CBM_LeechSeed (:410-416): already-seeded (not modeled — see
    // targetLeechSeeded, still hardcoded false) + Grass-type immunity.
    checkBadMove: (ctx) => {
      if (ctx.targetLeechSeeded) return -10;
      if (ctx.targetTypes.includes("Grass")) return -10;
      return 0;
    },
    // AI_CV_Toxic — shared with EFFECT_TOXIC, see toxicFamilyViability above.
    checkViability: toxicFamilyViability,
  },
  EFFECT_BATON_PASS: {
    // AI_CBM_BatonPass (:485-488): count_usable_party_mons(AI_USER) — the
    // OPPONENT'S OWN reserves (contrast EFFECT_ROAR, which checks the
    // TARGET's). Same FRONTIER_PARTY_SIZE=3 fact applies from the AI's own
    // side too — see ctx.userUsablePartyMons / analyzeMatchup's oppUsablePartyMons.
    checkBadMove: (ctx) => (ctx.userUsablePartyMons === 0 ? -10 : 0),
    // AI_CV_BatonPass (:1978-2016) — two tiers gated on whether any of the
    // user's 5 raisable stats is significantly boosted (>+2 vs >+1):
    //  - Any stat >+2: HP/speed-gated exemption, else 80/256 chance of
    //    nothing, else +2 (there's real value worth passing on).
    //  - Any stat >+1 (but none >+2): HP/speed-gated -2 penalty, else nothing.
    //  - Nothing boosted at all: flat -2 (nothing worth passing).
    checkViability: (ctx) => {
      const s2 = 2, s1 = 1; // real-stage thresholds (source uses raw 8 and 7 = real +2 and +1)
      const anyAbove2 = ctx.userAtkStage > s2 || ctx.userDefStage > s2 || ctx.userSpAtkStage > s2 || ctx.userSpDefStage > s2 || ctx.userEvasionStage > s2;
      if (anyAbove2) {
        if (ctx.targetFaster) {
          if (ctx.userHpPct > 70) return [{ p: 1, delta: 0 }];
        } else if (ctx.userHpPct > 60) {
          return [{ p: 1, delta: 0 }];
        }
        return [{ p: 80 / 256, delta: 0 }, { p: 176 / 256, delta: 2 }];
      }
      const anyAbove1 = ctx.userAtkStage > s1 || ctx.userDefStage > s1 || ctx.userSpAtkStage > s1 || ctx.userSpDefStage > s1 || ctx.userEvasionStage > s1;
      if (!anyAbove1) return [{ p: 1, delta: -2 }];
      if (ctx.targetFaster) {
        return ctx.userHpPct < 70 ? [{ p: 1, delta: 0 }] : [{ p: 1, delta: -2 }];
      }
      return ctx.userHpPct > 60 ? [{ p: 1, delta: -2 }] : [{ p: 1, delta: 0 }];
    },
  },
  // ── Batch 5: Substitute, Reflect, Light Screen (persistent-state effects) ─
  EFFECT_SUBSTITUTE: {
    // AI_CBM_Substitute: already up -> -8; own HP<26% (can't safely afford
    // the 1/4-max-HP cost) -> -10.
    checkBadMove: (ctx) => {
      if (ctx.userHasSubstitute) return -8;
      if (ctx.userHpPct < 26) return -10;
      return 0;
    },
    // AI_CV_Substitute — cascading independent 100/256-vs-156/256 rolls (each
    // an independent -1 chance), the NUMBER of which depends on the user's HP
    // tier: >90% HP -> 0 rolls; (70,90]% -> 1; (50,70]% -> 2; <=50% -> 3. The
    // lower the HP, the more chances to be penalized — Substitute is riskier
    // when already hurt (higher chance the sub itself gets one-shot for a
    // wasted 1/4-HP cost).
    checkViability: (ctx) => {
      let numRolls;
      if (ctx.userHpPct > 90) numRolls = 0;
      else if (ctx.userHpPct > 70) numRolls = 1;
      else if (ctx.userHpPct > 50) numRolls = 2;
      else numRolls = 3;
      let dist = [{ p: 1, delta: 0 }];
      const roll = [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: -1 }];
      for (let i = 0; i < numRolls; i++) dist = combineDist(dist, roll);
      return dist;
    },
  },
  EFFECT_REFLECT: {
    checkBadMove: (ctx) => (ctx.userHasReflect ? -8 : 0),
    // AI_CV_Reflect: own HP<50 -> flat -2 (don't bother screening while
    // already hurt). Else: if the TARGET's own type suggests it hits
    // physically (PHYSICAL_TYPES — same list as type-data.js, cross-verified
    // against source), Reflect is clearly worth it -> no penalty. Otherwise
    // (target isn't a physical-associated type) 50/256 chance of no penalty,
    // else -2.
    checkViability: (ctx) => {
      if (ctx.userHpPct < 50) return [{ p: 1, delta: -2 }];
      if (ctx.targetTypes.some((t) => PHYSICAL_TYPES.includes(t))) return [{ p: 1, delta: 0 }];
      return [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -2 }];
    },
  },
  EFFECT_LIGHT_SCREEN: {
    checkBadMove: (ctx) => (ctx.userHasLightScreen ? -8 : 0),
    // AI_CV_LightScreen — mirrors AI_CV_Reflect exactly, gated on
    // SPECIAL_TYPES instead of PHYSICAL_TYPES.
    checkViability: (ctx) => {
      if (ctx.userHpPct < 50) return [{ p: 1, delta: -2 }];
      if (ctx.targetTypes.some((t) => SPECIAL_TYPES.includes(t))) return [{ p: 1, delta: 0 }];
      return [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -2 }];
    },
  },
  // ── Batch 6: Calm Mind, Cosmic Power, Bulk Up, Swagger, Destiny Bond ─────
  EFFECT_CALM_MIND: {
    // AI_CBM_CalmMind (:590-593): own SpAtk maxed -10, else own SpDef maxed -8.
    checkBadMove: (ctx) => {
      if (ctx.userSpAtkStage >= 6) return -10;
      if (ctx.userSpDefStage >= 6) return -8;
      return 0;
    },
    // AI_CV_SpDefUp — Calm Mind and Cosmic Power BOTH route to this exact
    // same viability handler per source (data/battle_ai_scripts.s:770/774),
    // already built for EFFECT_SPECIAL_DEFENSE_UP in batch 2.
    checkViability: (ctx) => defenseFamilyViability(ctx, "userSpDefStage", true),
  },
  EFFECT_COSMIC_POWER: {
    // AI_CBM_CosmicPower (:576-579): own Def maxed -10, else own SpDef maxed -8.
    checkBadMove: (ctx) => {
      if (ctx.userDefStage >= 6) return -10;
      if (ctx.userSpDefStage >= 6) return -8;
      return 0;
    },
    checkViability: (ctx) => defenseFamilyViability(ctx, "userSpDefStage", true),
  },
  EFFECT_BULK_UP: {
    // AI_CBM_BulkUp (:581-584): own Atk maxed -10, else own Def maxed -8.
    checkBadMove: (ctx) => {
      if (ctx.userAtkStage >= 6) return -10;
      if (ctx.userDefStage >= 6) return -8;
      return 0;
    },
    // AI_CV_DefenseUp — Bulk Up routes to the exact same handler as plain
    // Defense Up (data/battle_ai_scripts.s:771), already built in batch 2.
    checkViability: (ctx) => defenseFamilyViability(ctx, "userDefStage", false),
  },
  EFFECT_SWAGGER: {
    // AI_CBM_Confuse (:386-391) — Swagger shares this exact CBM per source
    // (:169). Duplicated here (not referencing AI_HANDLERS.EFFECT_CONFUSE
    // directly) since that handler is explicitly off-limits to touch.
    checkBadMove: aiCbmConfuse,
    // AI_CV_Swagger (:1462-1490). If the opponent's OWN moveset has Psych
    // Up, it takes a COMPLETELY different branch gated on the TARGET's OWN
    // Atk stage (real > -3, i.e. NOT heavily lowered, is the COMMON case)
    // -> -5; only when the target's Atk is already crashed (<=-3, rare) does
    // it favor Swagger (+3, or +5 on turn 1 specifically) — this only makes
    // sense once you notice Psych Up lets the AI later COPY that improved
    // stat for itself while the target sits confused. Traced this fully
    // before trusting it; the naive reading (checking direction backwards)
    // would have this exactly inverted. Otherwise (no Psych Up): 50/256
    // chance of +1, THEN falls into the identical HP-tiered logic as
    // AI_CV_Confuse (duplicated below, not referencing the protected
    // EFFECT_CONFUSE handler).
    checkViability: (ctx) => {
      if (ctx.userHasPsychUp) {
        if (ctx.targetStages.atk > -3) return [{ p: 1, delta: -5 }];
        const turnBonus = ctx.isFirstTurn ? 2 : 0;
        return [{ p: 1, delta: 3 + turnBonus }];
      }
      const confuseTail = (() => {
        if (ctx.targetHpPct > 70) return [{ p: 1, delta: 0 }];
        const firstRoll = [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: -1 }];
        if (ctx.targetHpPct > 50) return firstRoll;
        const afterSecond = combineDist(firstRoll, [{ p: 1, delta: -1 }]);
        if (ctx.targetHpPct > 30) return afterSecond;
        return combineDist(afterSecond, [{ p: 1, delta: -1 }]);
      })();
      return combineDist([{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }], confuseTail);
    },
  },
  EFFECT_DESTINY_BOND: {
    // No AI_CBM_DestinyBond exists — CV only.
    // AI_CV_DestinyBond (:1800-1814): unconditional -1 baseline. Target
    // faster -> done. Else own HP>70 -> done. Else a cascade of up to 3
    // independent rolls (each either skipped or adding +1/+2), the number
    // triggered depending on how low the user's own HP is — the lower, the
    // more chances at a bonus (Destiny Bond is a last-resort move).
    checkViability: (ctx) => {
      let dist = [{ p: 1, delta: -1 }];
      if (ctx.targetFaster) return dist;
      if (ctx.userHpPct > 70) return dist;
      dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }]);
      if (ctx.userHpPct > 50) return dist;
      dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }]);
      if (ctx.userHpPct > 30) return dist;
      dist = combineDist(dist, [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: 2 }]);
      return dist;
    },
  },
  // ── Batch 7: Recover/Milk Drink/Synthesis, Endure, Ingrain ───────────────
  EFFECT_RESTORE_HP: { checkViability: healFamilyViability }, // no CBM in source
  EFFECT_SOFTBOILED: { checkViability: healFamilyViability }, // no CBM in source
  EFFECT_SYNTHESIS: { checkViability: healFamilyViability }, // no CBM in source; AI_CV_HealWeather's weather prefix never fires here (see healFamilyViability's comment)
  EFFECT_MOONLIGHT: { checkViability: healFamilyViability }, // same AI_CV_HealWeather routing as Synthesis (data/battle_ai_scripts.s:731-733)
  EFFECT_MORNING_SUN: { checkViability: healFamilyViability }, // ditto
  EFFECT_ENDURE: {
    // No AI_CBM_Endure exists — CV only. The move's actual EXECUTION
    // mechanic (decay counter, 1-HP clamp) was already implemented in an
    // earlier session (see enumerateActionOutcomes/applyMove's dedicated
    // EFFECT_ENDURE branch) — only the AI's own SCORING was missing.
    // AI_CV_Endure (:1965-1976): own HP<4% -> flat -1 (too risky/pointless
    // even at near-death). HP in [4,35) -> the one HP band where it's
    // actually favored: 70/256 chance nothing, else 186/256 chance +1.
    // HP>=35 -> flat -1 (same as the near-death case — Endure isn't worth it
    // unless you're in that narrow "about to die but not yet" window).
    checkViability: (ctx) => {
      if (ctx.userHpPct < 4) return [{ p: 1, delta: -1 }];
      if (ctx.userHpPct < 35) return [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: 1 }];
      return [{ p: 1, delta: -1 }];
    },
  },
  EFFECT_INGRAIN: {
    // AI_CBM_Ingrain (:550-552): already rooted -> -10. No CV in source.
    checkBadMove: (ctx) => (ctx.userIngrained ? -10 : 0),
  },
  // ── Batch 8: Safeguard, Mean Look ────────────────────────────────────────
  EFFECT_SAFEGUARD: {
    // AI_CBM_Safeguard (:478-480): already up -> -8. No CV in source.
    checkBadMove: (ctx) => (ctx.userHasSafeguard ? -8 : 0),
  },
  EFFECT_MEAN_LOOK: {
    // AI_CBM_CantEscape (:430-432): target already escape-prevented -> -10.
    // targetCantEscape is the live youCantEscape flag (Phase D F4).
    checkBadMove: (ctx) => (ctx.targetCantEscape ? -10 : 0),
    // AI_CV_Trap (:1436-1447) — gated on the target already being badly
    // poisoned / cursed / perish-songed / infatuated, all live state.
    checkViability: (ctx) => {
      if (ctx.targetToxicPoisoned || ctx.targetCursed || ctx.targetPerishSonged || ctx.targetInfatuated) {
        return [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }];
      }
      return [{ p: 1, delta: 0 }];
    },
  },
  // ── Protect/Detect ────────────────────────────────────────────────────────
  EFFECT_PROTECT: {
    // No AI_CBM_Protect exists — CV only.
    // AI_CV_Protect (data/battle_ai_scripts.s:1894-1936) — the most elaborate
    // handler ported so far. get_protect_count reads the SAME shared decay
    // counter Endure uses (verified, not assumed — see the executor).
    checkViability: (ctx) => {
      // Used successfully 2+ times already this streak -> flat -2, overuse.
      if (ctx.userProtectCount > 1) return [{ p: 1, delta: -2 }];

      const userBadlyOff = ctx.userToxicPoisoned || ctx.userCursed || ctx.userPerishSonged
        || ctx.userInfatuated || ctx.userSeeded || ctx.userYawnPending;
      if (userBadlyOff || ctx.targetHasRestoreHpOrDefenseCurlMove) {
        // Protect3: scores -2 ONLY if the target's last move was Lock-On;
        // otherwise this path contributes nothing at all (0, not even
        // reaching the shared tail below — a real early "end", not a
        // no-score-then-continue).
        return ctx.targetLastMoveWasLockOn ? [{ p: 1, delta: -2 }] : [{ p: 1, delta: 0 }];
      }

      // +2 fires whenever the target is stuck in some stalling-friendly
      // status (poison/curse/perish song/infatuation/leech seed/yawn), OR
      // — this is the part easy to misread — whenever the target's LAST
      // move WASN'T Lock-On (i.e. +2 is the default; only a target that
      // just used exactly Lock-On skips it and goes straight to the tail
      // with nothing banked yet).
      const targetStalling = ctx.targetToxicPoisoned || ctx.targetCursed || ctx.targetPerishSonged
        || ctx.targetInfatuated || ctx.targetLeechSeeded || ctx.targetYawnPending;
      let dist = (targetStalling || !ctx.targetLastMoveWasLockOn)
        ? [{ p: 1, delta: 2 }]
        : [{ p: 1, delta: 0 }];

      // Protect2/Protect4 shared tail: one 50/50 -1, then (only if this is
      // the user's first Protect-family use this streak, count===0) done;
      // otherwise (count===1, since >1 already excluded above) a GUARANTEED
      // further -1, then one more 50/50 -1.
      dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: -1 }]);
      if (ctx.userProtectCount === 0) return dist;
      dist = combineDist(dist, [{ p: 1, delta: -1 }]);
      dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: -1 }]);
      return dist;
    },
  },
  // ── Weather (Sunny Day / Rain Dance / Sandstorm / Hail) ──────────────────
  EFFECT_SANDSTORM: {
    // AI_CBM_Sandstorm (:451-453): weather already sandstorm -> -8. NO CV in
    // source at all — Sandstorm is the only one of the 4 with no viability
    // handler (real asymmetry, not an omission on my part).
    checkBadMove: (ctx) => (ctx.currentWeather === "sandstorm" ? -8 : 0),
  },
  EFFECT_RAIN_DANCE: {
    checkBadMove: (ctx) => (ctx.currentWeather === "rain" ? -8 : 0),
    // AI_CV_RainDance (:2037-2058) — the one weather move with an ability
    // synergy check (Swift Swim/Rain Dish); Sunny Day/Hail don't get this,
    // a real asymmetry preserved as found. If the user is SLOWER than the
    // target AND has Swift Swim, it skips the HP check entirely (jumps
    // straight to +1) — Rain would let it outspeed despite being naturally
    // slower, so it's unconditionally good regardless of current HP.
    checkViability: (ctx) => {
      const userFaster = !ctx.targetFaster;
      if (!userFaster && ctx.userAbility === "Swift Swim") return [{ p: 1, delta: 1 }];
      if (ctx.userHpPct < 40) return [{ p: 1, delta: -1 }];
      if (["hail", "sun", "sandstorm"].includes(ctx.currentWeather) || ctx.userAbility === "Rain Dish") {
        return [{ p: 1, delta: 1 }];
      }
      return [{ p: 1, delta: 0 }];
    },
  },
  EFFECT_SUNNY_DAY: {
    checkBadMove: (ctx) => (ctx.currentWeather === "sun" ? -8 : 0),
    // AI_CV_SunnyDay (:2060-2075) — no ability check at all (unlike Rain
    // Dance's Swift Swim/Rain Dish synergy — Chlorophyll doesn't get the
    // same treatment here, a real asymmetry, not "fixed" to match).
    checkViability: (ctx) => {
      if (ctx.userHpPct < 40) return [{ p: 1, delta: -1 }];
      if (["hail", "rain", "sandstorm"].includes(ctx.currentWeather)) return [{ p: 1, delta: 1 }];
      return [{ p: 1, delta: 0 }];
    },
  },
  EFFECT_HAIL: {
    checkBadMove: (ctx) => (ctx.currentWeather === "hail" ? -8 : 0),
    // AI_CV_Hail (:2261-2274) — mirrors Sunny Day's shape exactly, no
    // ability check (no Ice Body in Gen III to check anyway).
    checkViability: (ctx) => {
      if (ctx.userHpPct < 40) return [{ p: 1, delta: -1 }];
      if (["sun", "rain", "sandstorm"].includes(ctx.currentWeather)) return [{ p: 1, delta: 1 }];
      return [{ p: 1, delta: 0 }];
    },
  },
  // ── Phase 2 leverage batch (coverage-audit-driven, see HANDOFF.md) ───────
  EFFECT_PSYCH_UP: {
    // AI_CBM_Haze (data/battle_ai_scripts.s:314-329) — shared verbatim with
    // Haze (not modeled — no set carries it). -10 only when BOTH "the user
    // has nothing of its own worth restoring" AND "the target has nothing
    // worth copying" are simultaneously true.
    checkBadMove: (ctx) => {
      const userStages = [ctx.userAtkStage, ctx.userDefStage, ctx.userSpeStage, ctx.userSpAtkStage, ctx.userSpDefStage, ctx.userAccStage, ctx.userEvasionStage];
      if (userStages.some((v) => v < 0)) return 0;
      if (Object.values(ctx.targetStages).some((v) => v > 0)) return 0;
      return -10;
    },
    // AI_CV_PsychUp (:2086-2112).
    checkViability: (ctx) => {
      const targetHighStats = [ctx.targetStages.atk, ctx.targetStages.def, ctx.targetStages.spa, ctx.targetStages.spd, ctx.targetStages.evasion];
      if (!targetHighStats.some((v) => v > 2)) return [{ p: 1, delta: -2 }];
      const userLowStats = [ctx.userAtkStage, ctx.userDefStage, ctx.userSpAtkStage, ctx.userSpDefStage];
      if (userLowStats.some((v) => v <= 0) || ctx.userEvasionStage <= 0) return [{ p: 1, delta: 1 }];
      return [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -2 }];
    },
  },
  // EFFECT_YAWN: no AI_CBM_Yawn/AI_CV_Yawn exists in source at all (confirmed
  // by grep — Yawn gets zero dedicated AI scoring, an empty handler is
  // correct here, not a gap) — registered only so the "status move needs a
  // handler" guard doesn't fire.
  EFFECT_YAWN: {},
  EFFECT_WILL_O_WISP: {
    // AI_CBM_WillOWisp (:531-539). The x0/x0.5/x0.25 check is the AI's OWN
    // heuristic (treating Will-O-Wisp's Fire typing as if it were an attack)
    // — NOT the same code path as the real Fire-type-can't-be-burned
    // execution rule (that's inflictStatus's STATUS_IMMUNITY_TYPES, checked
    // separately in the executor below), just a correlated proxy the AI uses
    // for its own scoring.
    checkBadMove: (ctx) => {
      return taRead(ctx, (a) => {
        if (a === "Water Veil") return -10;
        if (ctx.targetStatus !== null) return -10;
        if (typeEffectiveness("Fire", ctx.targetTypes) <= 0.5) return -10;
        if (ctx.targetSafeguarded) return -10;
        return 0;
      });
      return 0;
    },
  },
  EFFECT_ACCURACY_DOWN: {
    // AI_CBM_AccDown (:300-312): own-stage-at-minimum, Keen Eye, then the
    // shared CheckIfAbilityBlocksStatChange tail (Clear Body/White Smoke).
    checkBadMove: (ctx) => {
      if (ctx.targetStages.accuracy <= -6) return -10;
      return taRead(ctx, (a) => (a === "Keen Eye" ? -10 : abilityBlocksStatChange(ctx)));
    },
    checkViability: accuracyDownFamilyViability,
  },
  EFFECT_ATTACK_DOWN_2: {
    // CORRECTED IN B2b BATCH 8. The comment this replaced said Hyper Cutter is
    // "confirmed absent" from AI_CBM_AttackDown and called the omission a
    // preserved AI blind spot. That was half right and therefore wrong: the
    // shared TAIL (CheckIfAbilityBlocksStatChange, :308-312) does not check it,
    // but AI_CBM_AttackDown itself does, two lines before the goto --
    //
    //   AI_CBM_AttackDown:                              (:277-281)
    //     if_stat_level_equal AI_TARGET, STAT_ATK, MIN_STAT_STAGE, Score_Minus10
    //     get_ability AI_TARGET
    //     if_equal ABILITY_HYPER_CUTTER, Score_Minus10
    //     goto CheckIfAbilityBlocksStatChange
    //
    // So the AI is NOT blind to Hyper Cutter here, and the engine was inventing
    // a blind spot rather than preserving one. Found by the family sweep that
    // opened this batch, not by reading -- which is the amendment 9 argument in
    // one example.
    checkBadMove: (ctx) => {
      if (ctx.targetStages.atk <= -6) return -10;
      return taRead(ctx, (a) => (a === "Hyper Cutter" ? -10 : abilityBlocksStatChange(ctx)));
    },
    checkViability: attackDownFamilyViability,
  },
  EFFECT_SPECIAL_DEFENSE_DOWN_2: {
    checkBadMove: (ctx) => {
      if (ctx.targetStages.spd <= -6) return -10;
      return abilityBlocksStatChange(ctx);
    },
    checkViability: (ctx) => statDownDefenseFamilyViability(ctx, "spd"),
  },
  EFFECT_EVASION_DOWN: {
    checkBadMove: (ctx) => {
      if (ctx.targetStages.evasion <= -6) return -10;
      return abilityBlocksStatChange(ctx);
    },
    checkViability: (ctx) => statDownDefenseFamilyViability(ctx, "evasion"),
  },
  // ── B2b batch 5: the variable-damage family's AI rows ───────────────────
  // Every one of these is a DAMAGING move, so it already reached AI_TryToFaint
  // and the generic path. What was missing is its own AI_CBM_*/AI_CV_* row --
  // and for five of them that row is AI_CBM_HighRiskForDamage, the routine
  // factored out just above.
  EFFECT_SONICBOOM: { checkBadMove: highRiskForDamage },   // dispatched :177
  // B3 batch 7c: EFFECT_MIMIC has NO row in either dispatch table -- checked,
  // not assumed: it appears nowhere in data/battle_ai_scripts.s. So it scores
  // on the defaults alone.
  EFFECT_MIMIC: {},
  // B3 batch 7d: EFFECT_TRANSFORM has NO row in either dispatch table either --
  // absent from data/battle_ai_scripts.s entirely.
  EFFECT_TRANSFORM: {},
  // B3 batch 4c: BIDE. AI_CBM_HighRiskForDamage (dispatched :123) and
  // AI_CV_Bide (:1284-1288, dispatched :675): -2 unless the user is above 90%
  // (`if_hp_more_than AI_USER, 90` -- strictly more). Its membership of the
  // three AI_HPAware discouraged tables comes from the generated ai-tables.js.
  EFFECT_BIDE: {
    checkBadMove: highRiskForDamage,
    checkViability: (ctx) => [{ p: 1, delta: ctx.userHpPct > 90 ? 0 : -2 }],
  },
  EFFECT_PSYWAVE: { checkBadMove: highRiskForDamage },     // dispatched :155
  EFFECT_LOW_KICK: { checkBadMove: highRiskForDamage },    // dispatched :206
  EFFECT_PRESENT: { checkBadMove: highRiskForDamage },     // dispatched :172
  // EFFECT_DRAGON_RAGE has NO row in either dispatch table -- checked, not
  // assumed: it appears nowhere in battle_ai_scripts.s. Absence recorded here
  // so the next reader does not have to re-derive it.
  EFFECT_SUPER_FANG: {
    checkBadMove: highRiskForDamage,                        // dispatched :129
    // AI_CV_SuperFang (:1710-1714): -1 unless the target is ABOVE 50% -- the
    // move halves current HP, so it is worth least when there is least to halve.
    checkViability: (ctx) => [{ p: 1, delta: ctx.targetHpPct > 50 ? 0 : -1 }],
  },
  EFFECT_MAGNITUDE: {
    // AI_CBM_Magnitude (:365-367) adds a Levitate check and then FALLS THROUGH
    // into AI_CBM_HighRiskForDamage -- it does not replace it.
    checkBadMove: (ctx) => taRead(ctx, (a) => (a === "Levitate" ? -10 : highRiskForDamage(ctx))),
  },
  EFFECT_ENDEAVOR: {
    checkBadMove: highRiskForDamage,                        // dispatched :203
    // AI_CV_Endeavor (:2372-2388). Endeavor sets the target to the USER's HP,
    // so the AI wants a healthy target and a hurt user -- and the threshold for
    // "hurt enough" is LOOSER when the AI moves first (40 vs 50), because it
    // does not have to survive a hit before using it.
    checkViability: (ctx) => {
      if (ctx.targetHpPct < 70) return [{ p: 1, delta: -1 }];
      if (ctx.targetFaster) return [{ p: 1, delta: ctx.userHpPct > 50 ? -1 : 1 }];
      return [{ p: 1, delta: ctx.userHpPct > 40 ? -1 : 1 }];
    },
  },
  // EFFECT_ERUPTION's AI row is NOT here: AI_CV_Eruption was already ported
  // (search EFFECT_ERUPTION below). Batch 5 added its DAMAGE mechanic only --
  // the HP-scaled base power -- and a second AI copy was caught by
  // test-no-duplicate-keys.js, which is the test that exists for exactly this.
  // ── B2b batch 6 ─────────────────────────────────────────────────────────
  // EFFECT_SNORE's AI row is NOT here -- it was already ported (search
  // EFFECT_SNORE below: AI_CBM_DamageDuringSleep + AI_CV_Snore). Batch 6 added
  // its two MECHANICS instead: the sleep-lock exemption and the
  // fails-when-awake executor. test-no-duplicate-keys.js caught the second copy,
  // for the second batch running -- the AI rows and the mechanics are ported on
  // different days, and "no handler" is not the same question as "no executor".
  EFFECT_MUD_SPORT: {
    // AI_CBM_MudSport (:2166-2168): -10 if the USER already has it up.
    checkBadMove: (ctx) => (ctx.userMudSport ? -10 : 0),
    // AI_CV_MudSport (:2646-2656): -1 below 50% HP or against a non-Electric
    // target; +1 only when healthy AND the target is Electric-typed.
    checkViability: (ctx) => {
      if (ctx.userHpPct < 50) return [{ p: 1, delta: -1 }];
      return [{ p: 1, delta: ctx.targetTypes.includes("Electric") ? 1 : -1 }];
    },
  },
  EFFECT_WATER_SPORT: {
    // AI_CBM_WaterSport (:2170-2172) / AI_CV_WaterSport (:2658-2668) -- the same
    // shape with Fire in place of Electric. Kept as two entries rather than one
    // shared builder because the two TABLES they read differ, and a future
    // divergence between them should show up as a diff here, not be hidden.
    checkBadMove: (ctx) => (ctx.userWaterSport ? -10 : 0),
    checkViability: (ctx) => {
      if (ctx.userHpPct < 50) return [{ p: 1, delta: -1 }];
      return [{ p: 1, delta: ctx.targetTypes.includes("Fire") ? 1 : -1 }];
    },
  },
  // ── B2b batch 8: the nine stat-stage effects that had no port ───────────
  // Found by sweeping the FAMILY rather than by hitting one of them: 28 of
  // source's stat-stage effects, 19 ported, 9 missing -- Attack Down among
  // them, while Attack Down 2 and every other neighbour was present.
  EFFECT_SPECIAL_ATTACK_DOWN: {
    // AI_CBM_SpAtkDown (:292-294): min-stage, then the shared tail. No
    // ability of its own, unlike Attack Down's Hyper Cutter.
    checkBadMove: (ctx) => {
      if (ctx.targetStages.spa <= -6) return -10;
      return abilityBlocksStatChange(ctx);
    },
    checkViability: (ctx) => statDownOffenseFamilyViability(ctx, "spa", SP_ATK_DOWN_SPECIAL_TYPICAL_TYPES),
  },
  EFFECT_ACCURACY_UP: {
    // AI_CBM_AccUp (:269-271): -10 only at max. AI_CV_AccuracyUp (:1027-1034):
    // a stage-gated -2 roll, then an HP-gated -2.
    checkBadMove: (ctx) => (ctx.userAccStage >= 6 ? -10 : 0),
    checkViability: (ctx) => {
      let dist = [{ p: 1, delta: 0 }];
      if (!(ctx.userAccStage < 3)) {
        dist = combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -2 }]);
      }
      if (ctx.userHpPct <= 70) dist = combineDist(dist, [{ p: 1, delta: -2 }]);
      return dist;
    },
  },
  // ── B2b batch 11 ────────────────────────────────────────────────────────
  // AI_CheckBadMove dispatches EFFECT_TELEPORT straight to Score_Minus10 (:185)
  // with no routine of its own -- the AI will not pick it at all.
  EFFECT_TELEPORT: { checkBadMove: () => -10 },

  EFFECT_MAGIC_COAT: {
    // AI_CV_MagicCoat (:1902-1920). No AI_CBM row. Three blocks, and the middle
    // one keys on is_first_turn_for AI_USER -- which this engine has as real
    // state (ctx.userPastFirstTurn, from state.oppMonFirstTurn) rather than a
    // hardcoded guess -- and it reuses the field that already exists instead of
    // adding a second name for the same fact.
    checkViability: (ctx) => {
      let dist = [{ p: 1, delta: 0 }];
      if (ctx.targetHpPct <= 30) {
        dist = combineDist(dist, [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: -1 }]);
      }
      if (!ctx.userPastFirstTurn) {
        // +1 on the 106/256 that do NOT jump past it.
        return combineDist(dist, [{ p: 150 / 256, delta: 0 }, { p: 106 / 256, delta: 1 }]);
      }
      // Not the user's first turn: -1 on the 226/256 that do not jump.
      return combineDist(dist, [{ p: 30 / 256, delta: 0 }, { p: 226 / 256, delta: -1 }]);
    },
  },

  // ── B2b batch 10 ────────────────────────────────────────────────────────
  EFFECT_TRICK: {
    // AI_CBM_TrickAndKnockOff (:545-548): -10 into Sticky Hold, which is the
    // ability that blocks the swap in execution too.
    checkBadMove: (ctx) => taRead(ctx, (a) => (a === "Sticky Hold" ? -10 : 0)),
    // AI_CV_Trick (:2322-2353). The AI wants to GIVE AWAY a bad item, and the
    // two tables that decide "bad" are generated, not retyped: Choice Band
    // alone in one, plus the confusing berries and Macho Brace in the other.
    checkViability: (ctx) => {
      const mine = ctx.userHoldEffect, theirs = ctx.targetHoldEffect;
      // AI_CV_Trick_EffectsToEncourage2 / _EffectsToEncourage (generated, F12)
      const enc2 = (h) => TRICK_EFFECTS_TO_ENCOURAGE_2.has(h);
      const enc = (h) => TRICK_EFFECTS_TO_ENCOURAGE.has(h);
      if (enc2(mine)) return enc2(theirs) ? [{ p: 1, delta: -3 }] : [{ p: 1, delta: 5 }];
      if (enc(mine)) {
        if (enc(theirs)) return [{ p: 1, delta: -3 }];
        // AI_CV_Trick4 (:2336-2340): if_random_less_than 50 jumps PAST the +2,
        // so +2 on 206/256 (Phase D; was 128/256).
        return [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: 2 }];
      }
      return [{ p: 1, delta: -3 }];
    },
  },
  // Phase D F2b: AI_CV_Thief (data/battle_ai_scripts.s:1848-1858, dispatched
  // :722; no CBM) had no handler -- ai-dispatch-audit's one reachable gap.
  // +1 on 206/256 for a target holding an encouraged item, else -2. The AI
  // believes NONE (see targetHoldEffect), so in play this is a flat -2; the
  // list is kept whole and pinned to the script by the test.
  EFFECT_THIEF: {
    checkViability: (ctx) => (THIEF_ENCOURAGED_HOLD_EFFECTS.has(ctx.targetHoldEffect)
      ? [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: 1 }]
      : [{ p: 1, delta: -2 }]),
  },
  EFFECT_RECYCLE: {
    // AI_CBM_Recycle (:554-557): -10 with nothing used up to recycle.
    checkBadMove: (ctx) => (ctx.userUsedItem ? 0 : -10),
    // AI_CV_Recycle (:2355-2364): +2 on a 206/256 roll for an encouraged item,
    // -2 for anything else.
    checkViability: (ctx) => (RECYCLE_ENCOURAGED_ITEMS.has(ctx.userUsedItemConstant)
      ? [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: 1 }]
      : [{ p: 1, delta: -2 }]),
  },
  // AI_CV_ChangeSelfAbility (:2366-2380), shared by ROLE PLAY and SKILL SWAP
  // (:753 and :762 both dispatch to it) -- so it is one object, aliased below.
  EFFECT_ROLE_PLAY: {
    checkViability: (ctx) => {
      const enc = (a) => CHANGE_SELF_ABILITY_ENCOURAGED.has(a);
      if (enc(ctx.userAbility)) return [{ p: 1, delta: -1 }];
      // AI_CV_ChangeSelfAbility3 (:2367-2369): if_random_less_than 50 jumps PAST
      // the +2, so +2 on 206/256 (Phase D F8; was 128/256).
      return taRead(ctx, (a) => (!enc(a) ? [{ p: 1, delta: -1 }]
        : [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: 2 }]));
    },
  },

  EFFECT_POISON: {
    // AI_CheckBadMove dispatches EFFECT_POISON to AI_CBM_Toxic (:148) -- the
    // SAME routine as Toxic, aliased below rather than copied.
    // AI_CV_Poison (:1592-1598) is its own, and is NOT AI_CV_Toxic: -1 when the
    // user is below half or the target is not above half.
    checkViability: (ctx) => [{ p: 1, delta: (ctx.userHpPct < 50 || ctx.targetHpPct <= 50) ? -1 : 0 }],
  },
  EFFECT_LOCK_ON: {
    // AI_CV_LockOn (:1035-1039): +2 on a 128/256 roll. No AI_CBM row.
    checkViability: () => [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 2 }],
  },

  // ── B2b batch 9: the remaining status/support effects ───────────────────
  EFFECT_MIST: {
    // AI_CBM_Mist (:1830-1832): -8, not -10, when the user's side already has
    // it -- discouraged, not forbidden, like Snore's.
    checkBadMove: (ctx) => (ctx.userSideMisted ? -8 : 0),
  },
  EFFECT_STOCKPILE: {
    // AI_CBM_Stockpile (:2109-2112): -10 at three, the cap.
    checkBadMove: (ctx) => (ctx.userStockpile >= 3 ? -10 : 0),
  },
  EFFECT_SPIT_UP: {
    // AI_CBM_SpitUpAndSwallow (:2114-2118): -10 if the move cannot affect the
    // target at all, and -10 with nothing stockpiled.
    checkBadMove: (ctx) => {
      if (typeEffectiveness(ctx.moveType, ctx.targetTypes) === 0) return -10;
      return ctx.userStockpile === 0 ? -10 : 0;
    },
    // AI_CV_SpitUp (:1740-1746): +2 at two or more stockpiles, on a 176/256
    // roll. `if_random_less_than 80` JUMPS past the score on <80/256.
    checkViability: (ctx) => (ctx.userStockpile < 2
      ? [{ p: 1, delta: 0 }]
      : [{ p: 80 / 256, delta: 0 }, { p: 176 / 256, delta: 2 }]),
  },
  EFFECT_SWALLOW: {
    checkBadMove: (ctx) => {
      if (typeEffectiveness(ctx.moveType, ctx.targetTypes) === 0) return -10;
      return ctx.userStockpile === 0 ? -10 : 0;
    },
    // AI_CV_Heal, shared verbatim with Recover and Soft-Boiled (:745 dispatches
    // EFFECT_SWALLOW straight to it) -- the same function object, not a copy.
    checkViability: healFamilyViability,
  },
  EFFECT_MEMENTO: {
    // AI_CBM_Memento (:2124-2126) FALLS THROUGH into AI_CBM_BatonPass, whose
    // count_usable_party_mons check is about having something to switch to.
    // The Arena has a party (the streak team) but no switching, so the
    // fallthrough's -10 is not reachable from a faint alone; the two stat
    // checks are what matters here.
    checkBadMove: (ctx) => {
      if (ctx.targetStages.atk <= -6) return -10;
      if (ctx.targetStages.spa <= -6) return -8;
      return 0;
    },
    // AI_CV_SelfKO (:2409-2434), shared with Destiny Bond's family.
    checkViability: (ctx) => {
      let dist = [{ p: 1, delta: 0 }];
      if (!(ctx.targetStages.evasion < 1)) {
        dist = combineDist(dist, [{ p: 1, delta: -1 }]);
        if (!(ctx.targetStages.evasion < 4)) {
          dist = combineDist(dist, [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: -1 }]);
        }
      }
      // Encourage1: a hurt user, or one about to be outsped, wants to spend
      // itself; a healthy faster one is discouraged on a 206/256 roll.
      if (ctx.userHpPct >= 80 && !ctx.targetFaster) {
        return combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -3 }]);
      }
      if (ctx.userHpPct > 50) {
        return combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -1 }]);
      }
      dist = combineDist(dist, [{ p: 128 / 256, delta: 1 }, { p: 128 / 256, delta: 0 }]);
      if (ctx.userHpPct <= 30) {
        dist = combineDist(dist, [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: 1 }]);
      }
      return dist;
    },
  },
  EFFECT_PERISH_SONG: {
    // AI_CBM_PerishSong (:447-449) — no AI_CV_PerishSong exists in source.
    checkBadMove: (ctx) => (ctx.targetPerishSonged ? -10 : 0),
  },
  // AI_CBM_HighRiskForDamage (:368-376) — shared by several generic damaging
  // effects, ported here for Return/Frustration specifically (this session's
  // scope). -10 if immune outright, or if the target has Wonder Guard and
  // this hit ISN'T a clean single-type "x2" (AI_EFFECTIVENESS_x2 is an exact
  // category match in source, not "at least 2x" — a real, preserved quirk:
  // Normal-type moves are NEVER super-effective against anything in Gen III,
  // so this always evaluates to -10 against a hypothetical Wonder Guard
  // target, matching Wonder Guard's real block-everything-but-clean-SE rule).
  EFFECT_RETURN: {
    checkBadMove: highRiskForDamage,
  },
  EFFECT_FRUSTRATION: {
    checkBadMove: highRiskForDamage,
  },
  // AI_CBM_HighRiskForDamage (data/battle_ai_scripts.s:154 dispatches
  // EFFECT_LEVEL_DAMAGE here — same routine as EFFECT_RETURN/EFFECT_FRUSTRATION
  // just above; mirrored verbatim, not reinvented). No AI_CV_LevelDamage exists
  // in source's CheckViability dispatch table at all — checkViability
  // intentionally omitted, not a gap.
  EFFECT_LEVEL_DAMAGE: {
    checkBadMove: highRiskForDamage,
  },
  // AI_CBM_HighRiskForDamage (data/battle_ai_scripts.s:156 dispatches
  // EFFECT_COUNTER here — same shared routine as EFFECT_RETURN/
  // EFFECT_FRUSTRATION/EFFECT_LEVEL_DAMAGE above, mirrored verbatim, not
  // reinvented). checkViability is AI_CV_Counter (:713 -> :1618-1673) — see
  // counterViability's own long comment above for the full trace.
  EFFECT_COUNTER: {
    checkBadMove: highRiskForDamage,
    checkViability: counterViability,
  },
  // AI_CBM_HighRiskForDamage (data/battle_ai_scripts.s:182 dispatches
  // EFFECT_MIRROR_COAT here — same shared routine as EFFECT_RETURN/
  // EFFECT_FRUSTRATION/EFFECT_LEVEL_DAMAGE/EFFECT_COUNTER above, mirrored
  // verbatim, not reinvented). checkViability is AI_CV_MirrorCoat
  // (:738 -> :2116-2182) — see mirrorCoatViability's own comment above
  // (and reflectFamilyViability's shared trace) for the full derivation.
  EFFECT_MIRROR_COAT: {
    checkBadMove: highRiskForDamage,
    checkViability: mirrorCoatViability,
  },
  // ── LOCKSTEP PORT CAMPAIGN, BATCH 1 (2026-08-03) ──────────────────────
  // The "silent-generic" class (dispatch-table audit 2026-08-03): damaging
  // effects with dedicated source AI routines that previously scored through
  // the generic path with ZERO handler delta — no throw, no warning. The
  // remainder of the class is pinned by palace_predictor_sim/
  // test_dispatch_coverage.mjs's KNOWN_AI_DISPATCH_GAPS registry. Handler
  // text below is IDENTICAL in battle_arena_sim/logic.js and
  // palace_predictor_sim/ai_engine.mjs (the lockstep invariant, enforced by
  // test_fork_equivalence.mjs).

  // AI_CBM_Explosion (data/battle_ai_scripts.s:224-232, dispatched :106) +
  // AI_CV_SelfKO (:800-826, dispatched :656). EFFECT_MEMENTO also dispatches
  // to AI_CV_SelfKO in source (:747) but is a status effect that still
  // throws unhandled (Palace ledger) — this entry is EFFECT_EXPLOSION only.
  // CBM (:224-232):
  //   if_type_effectiveness AI_EFFECTIVENESS_x0, Score_Minus10
  //   get_ability AI_TARGET / if_equal ABILITY_DAMP, Score_Minus10
  //   count_usable_party_mons AI_USER   / if_not_equal 0, End
  //   count_usable_party_mons AI_TARGET / if_not_equal 0, Score_Minus10
  //   goto Score_Minus1
  // CV (:800-826), stat_level encodings converted to this engine's DISPLAY
  // stage convention (game 6 = display 0, so "less_than 7" = stage < +1,
  // "less_than 10" = stage < +4); if_random_less_than N jumps AWAY with
  // p N/256, so the fall-through score fires with p (256-N)/256:
  //   :800-805  evasion block — target evasion >= +1: score -1; then
  //             evasion >= +4: another -1 with p 128/256
  //   :806-810  user HP >= 80 && user faster-or-tied: -3 with p 206/256
  //   :811-824  otherwise the encouragement chain: HP > 50 (incl. the
  //             HP >= 80 target-faster entry): -1 with p 206/256;
  //             30 < HP <= 50: +1 with p 128/256; HP <= 30: +1 with
  //             p 128/256 AND +1 with p 206/256 (independent rolls).
  // The evasion block and the chain use independent rolls — convolved.
  EFFECT_EXPLOSION: {
    checkBadMove: (ctx) => {
      if (typeEffectiveness(ctx.moveType, ctx.targetTypes) === 0) return -10;
      return taRead(ctx, (a) => {
        if (a === "Damp") return -10;
        if (ctx.userUsablePartyMons !== 0) return 0;
        if (ctx.targetUsablePartyMons !== 0) return -10;
        return -1;
      });
    },
    checkViability: (ctx) => {
      const ev = ctx.targetStages.evasion;
      const evasionPart =
        ev < 1 ? [{ p: 1, delta: 0 }]
        : ev < 4 ? [{ p: 1, delta: -1 }]
        : [{ p: 128 / 256, delta: -1 }, { p: 128 / 256, delta: -2 }];
      let chain;
      if (ctx.userHpPct >= 80 && !ctx.targetFaster) {
        chain = [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -3 }];
      } else if (ctx.userHpPct > 50) {
        chain = [{ p: 50 / 256, delta: 0 }, { p: 206 / 256, delta: -1 }];
      } else if (ctx.userHpPct > 30) {
        chain = [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }];
      } else {
        chain = [
          { p: (128 / 256) * (50 / 256), delta: 0 },
          { p: (128 / 256) * (206 / 256) + (128 / 256) * (50 / 256), delta: 1 },
          { p: (128 / 256) * (206 / 256), delta: 2 },
        ];
      }
      const out = [];
      for (const a of evasionPart) for (const b of chain) out.push({ p: a.p * b.p, delta: a.delta + b.delta });
      return out;
    },
  },

  // AI_CBM_DreamEater (:242-245, dispatched :107) + AI_CV_DreamEater
  // (:828-835, dispatched :657). CBM: `if_not_status AI_TARGET,
  // STATUS1_SLEEP, Score_Minus8` — Score_Minus8 (:616-618) ENDS the script,
  // so the x0 check only ever runs against a sleeping target. CV: -1 on a
  // resisted (x0.25/x0.5) hit. This closes the change-#10 deferral note
  // ("AI_CBM_DreamEater is NOT ported — the AI over-picks Dream Eater vs an
  // awake target") — the -8 awake gate now scores.
  EFFECT_DREAM_EATER: {
    checkBadMove: (ctx) => {
      if (ctx.targetStatus !== "sleep") return -8;
      if (typeEffectiveness(ctx.moveType, ctx.targetTypes) === 0) return -10;
      return 0;
    },
    checkViability: (ctx) => {
      const eff = typeEffectiveness(ctx.moveType, ctx.targetTypes);
      return eff === 0.25 || eff === 0.5 ? -1 : 0;
    },
  },

  // AI_CBM_DamageDuringSleep (:426-428, dispatched :158; source shares the
  // routine with EFFECT_SLEEP_TALK, which remains unhandled/throwing — see
  // the Palace ledger) + AI_CV_Snore (:1785-1787): unconditional score +2.
  // ctx.userStatus (the opponent's OWN major status) added this batch.
  EFFECT_SNORE: {
    checkBadMove: (ctx) => (ctx.userStatus !== "sleep" ? -8 : 0),
    checkViability: () => 2,
  },

  // AI_CBM_FutureSight (:500-504, dispatched :184): -12 if a delayed attack
  // is already queued on EITHER side (SIDE_STATUS_FUTUREATTACK), else +5.
  // No AI_CV_FutureSight exists in source. The two ctx flags read the live
  // youFutureSight / oppFutureSight (B3 batch 5b; wired in Phase D F3 -- they
  // were hardcoded false until then).
  EFFECT_FUTURE_SIGHT: {
    checkBadMove: (ctx) =>
      ctx.futureSightQueuedOnUserSide || ctx.futureSightQueuedOnTargetSide ? -12 : 5,
  },

  // ── LOCKSTEP PORT CAMPAIGN, BATCH 2 (2026-08-03) ──────────────────────
  // Same class, same lockstep rules as batch 1 above.

  // AI_CBM_HighRiskForDamage (:368-376, dispatched for EFFECT_SUPERPOWER at
  // :200 — same shared routine as EFFECT_RETURN/EFFECT_FRUSTRATION/
  // EFFECT_LEVEL_DAMAGE/EFFECT_COUNTER/EFFECT_MIRROR_COAT above, mirrored
  // verbatim) + AI_CV_Superpower (:2392-2404, dispatched :754):
  //   if_type_effectiveness x0_25 / x0_5 -> score -1
  //   if_stat_level_less_than AI_USER, STAT_ATK, DEFAULT_STAT_STAGE -> -1
  //     (game encoding 6 = display 0: "own Atk stage < 0")
  //   if_target_faster -> Superpower2 (:2400): -1 unless user HP < 60
  //   else (user faster-or-tied): -1 if user HP > 40
  // Deterministic — no random splits anywhere in the routine. This is the
  // batch-1 Regirock-probe finding, now landed: at full HP Superpower is
  // discouraged in virtually every state.
  EFFECT_SUPERPOWER: {
    checkBadMove: highRiskForDamage,
    checkViability: (ctx) => {
      const eff = typeEffectiveness(ctx.moveType, ctx.targetTypes);
      if (eff === 0.25 || eff === 0.5) return -1;
      if (ctx.userAtkStage < 0) return -1;
      if (ctx.targetFaster) return ctx.userHpPct < 60 ? 0 : -1;
      return ctx.userHpPct > 40 ? -1 : 0;
    },
  },

  // AI_CBM_HighRiskForDamage (dispatched for EFFECT_RECHARGE at :151) +
  // AI_CV_Recharge (:1588-1599, dispatched :710) — identical shape to
  // AI_CV_Superpower minus the Atk-stage check: resisted (x0_25/x0_5) -> -1;
  // target faster: -1 unless user HP < 60; user faster-or-tied: -1 if user
  // HP > 40. Deterministic. (Hyper Beam & co are discouraged at high HP —
  // the AI saves them for the endgame.)
  EFFECT_RECHARGE: {
    checkBadMove: highRiskForDamage,
    checkViability: (ctx) => {
      const eff = typeEffectiveness(ctx.moveType, ctx.targetTypes);
      if (eff === 0.25 || eff === 0.5) return -1;
      if (ctx.targetFaster) return ctx.userHpPct < 60 ? 0 : -1;
      return ctx.userHpPct > 40 ? -1 : 0;
    },
  },

  // AI_CBM_HighRiskForDamage (dispatched for EFFECT_FLAIL at :160) +
  // AI_CV_Flail (:1817-1838, dispatched :720). SCORING side only — the
  // damage side (the HP-fraction power tiers) is already special-cased in
  // calcDamage. Branch walk (user = the Flail/Reversal user; percent HP):
  //   user faster-or-tied (:1818-1822): HP > 33 -> -1; 20 < HP <= 33 -> 0;
  //     HP < 8 -> +1 then the Flail3 roll; 8 <= HP <= 20 -> Flail3 roll
  //   target faster (:1824-1827): HP > 60 -> -1; 40 < HP <= 60 -> 0;
  //     HP <= 40 -> Flail3 roll
  //   Flail3 roll (:1831-1834): +1 with p 156/256 (if_random_less_than 100
  //   jumps away with p 100/256)
  EFFECT_FLAIL: {
    checkBadMove: highRiskForDamage,
    checkViability: (ctx) => {
      const roll = [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: 1 }];
      const plusOne = roll.map((x) => ({ p: x.p, delta: x.delta + 1 }));
      if (!ctx.targetFaster) {
        if (ctx.userHpPct > 33) return -1;
        if (ctx.userHpPct > 20) return 0;
        if (ctx.userHpPct < 8) return plusOne;
        return roll;
      }
      if (ctx.userHpPct > 60) return -1;
      if (ctx.userHpPct > 40) return 0;
      return roll;
    },
  },

  // AI_CV_Revenge (:2444-2454, dispatched :757). No CBM entry for
  // EFFECT_REVENGE exists in source. Target asleep / infatuated / confused
  // -> -2 (a disrupted target likely won't have hit first, so Revenge stays
  // at base power); otherwise -2 with p 180/256, +2 with p 76/256.
  // ctx.targetInfatuated / ctx.targetConfused are read exactly as every
  // other handler reads them (both are effectively always false today:
  // targetInfatuated via the ctx literal's later duplicate key, and
  // targetConfused hardcoded — preserved engine limitations, not new ones).
  EFFECT_REVENGE: {
    checkViability: (ctx) => {
      if (ctx.targetStatus === "sleep" || ctx.targetInfatuated || ctx.targetConfused) return -2;
      return [{ p: 180 / 256, delta: -2 }, { p: 76 / 256, delta: 2 }];
    },
  },

  // AI_CV_SpeedDownFromChance (:1136-1140, dispatched :706) — the MOVE GATE
  // is source, ported exactly: only three of the six EFFECT_SPEED_DOWN_HIT
  // carriers dispatch onward; the rest hit a bare `end` and score ZERO here:
  //   if_move MOVE_ICY_WIND, AI_CV_SpeedDown    (:1137)
  //   if_move MOVE_ROCK_TOMB, AI_CV_SpeedDown   (:1138)
  //   if_move MOVE_MUD_SHOT, AI_CV_SpeedDown    (:1139)
  //   end                                       (:1140)
  // The handler therefore keys on MOVE IDENTITY via ctx.moveName (added to
  // the per-move ctx this batch), not on the effect alone — Bubble Beam/
  // Bubble/Constrict must stay at zero.
  // AI_CV_SpeedDown (:1142-1151): user faster-or-tied -> -3 deterministic
  // (the speed drop is redundant when already faster); target faster -> +2
  // with p 186/256 (if_random_less_than 70 jumps away with p 70/256).
  EFFECT_SPEED_DOWN_HIT: {
    checkViability: (ctx) => {
      if (ctx.moveName !== "Icy Wind" && ctx.moveName !== "Rock Tomb" && ctx.moveName !== "Mud Shot") return 0;
      if (!ctx.targetFaster) return -3;
      return [{ p: 70 / 256, delta: 0 }, { p: 186 / 256, delta: 2 }];
    },
  },

  // ── LOCKSTEP PORT CAMPAIGN, BATCH 3 (2026-08-04) ──────────────────────
  // Same class, same lockstep rules as batches 1-2 above — the tier-2
  // conditionals from the 2026-08-03 dispatch-table audit. BUGFIX is
  // commented out in this repo (pokeemerald config.h:48), so every #ifdef
  // encountered below ports the #else (vanilla, shipped-cartridge) branch —
  // same standard as the Counter6 note above: reproduce, don't correct.

  // AI_CV_BrickBreak (:2457-2464, dispatched :758): if_side_affecting
  // AI_TARGET, SIDE_STATUS_REFLECT -> +1, else 0. Deterministic. The gate
  // is the player's LIVE Reflect screen (ctx.targetHasReflect, added this
  // batch — the same modeled side-status calcDamage's screenActive halving
  // already consumes), not the mere presence of Reflect in the moveset.
  EFFECT_BRICK_BREAK: {
    checkViability: (ctx) => (ctx.targetHasReflect ? 1 : 0),
  },

  // AI_CV_ChargeUpMove (:2184-2195) — ONE routine dispatched for three live
  // effects: EFFECT_RAZOR_WIND (:683), EFFECT_SKY_ATTACK (:707),
  // EFFECT_SOLAR_BEAM (:740). (EFFECT_SKULL_BASH :739 shares it too — zero
  // carriers in both pools, stays in KNOWN_AI_DISPATCH_GAPS' academic tier,
  // deliberately NOT ported.) Branch walk:
  //   if_type_effectiveness x0_25 / x0_5 (:2185-2186) -> -2
  //   if_has_move_with_effect AI_TARGET, EFFECT_PROTECT (:2187) -> -2
  //     (Cmd_if_has_move_with_effect's AI_TARGET arm reads the target's
  //     BATTLE_HISTORY revealed moves, with a vanilla loop-guard quirk:
  //     each slot's guard checks the AI'S OWN move being nonzero, not the
  //     history entry — src/battle_ai_script_commands.c, the routine's own
  //     BUG comment. Under this engine's full-knowledge convention for the
  //     target's moveset (see targetHasDreamEaterOrNightmare) and 4-move
  //     frontier sets, both quirks collapse to "the target owns a
  //     Protect/Detect-effect move": ctx.targetHasProtectEffectMove,
  //     added this batch.)
  //   if_hp_more_than AI_USER, 38 (:2188) -> end (0); else -1.
  // Deterministic. The checkViability text is duplicated verbatim across
  // the three entries below (same convention as batch 2's triplicated
  // AI_CBM_HighRiskForDamage text) — keep them byte-identical.
  EFFECT_SOLAR_BEAM: {
    checkViability: (ctx) => {
      const eff = typeEffectiveness(ctx.moveType, ctx.targetTypes);
      if (eff === 0.25 || eff === 0.5) return -2;
      if (ctx.targetHasProtectEffectMove) return -2;
      return ctx.userHpPct > 38 ? 0 : -1;
    },
  },

  // EFFECT_RAZOR_WIND: AI_CV_ChargeUpMove (see EFFECT_SOLAR_BEAM above)
  // PLUS AI_CBM_HighRiskForDamage (:368-376, dispatched :128 — the only
  // ChargeUpMove effect with a CheckBadMove entry; SOLAR_BEAM and
  // SKY_ATTACK have none, so checkBadMove lives on this entry alone).
  EFFECT_RAZOR_WIND: {
    checkBadMove: highRiskForDamage,
    checkViability: (ctx) => {
      const eff = typeEffectiveness(ctx.moveType, ctx.targetTypes);
      if (eff === 0.25 || eff === 0.5) return -2;
      if (ctx.targetHasProtectEffectMove) return -2;
      return ctx.userHpPct > 38 ? 0 : -1;
    },
  },

  // EFFECT_SKY_ATTACK: AI_CV_ChargeUpMove only (see EFFECT_SOLAR_BEAM
  // above for the full walk and the duplication convention).
  EFFECT_SKY_ATTACK: {
    checkViability: (ctx) => {
      const eff = typeEffectiveness(ctx.moveType, ctx.targetTypes);
      if (eff === 0.25 || eff === 0.5) return -2;
      if (ctx.targetHasProtectEffectMove) return -2;
      return ctx.userHpPct > 38 ? 0 : -1;
    },
  },

  // AI_CV_SemiInvulnerable (:2197-2241 + AI_CV_SandstormResistantTypes
  // :2243-2247, dispatched :741). No CheckBadMove entry. Branch walk:
  //   Target owns a Protect-effect move (:2198 —
  //   if_doesnt_have_move_with_effect's AI_TARGET arm reads BATTLE_HISTORY
  //   cleanly, no loop-guard quirk this time; same full-knowledge collapse
  //   as ChargeUpMove above: ctx.targetHasProtectEffectMove) -> -1 flat.
  //   Else (:2205-2207): target toxic'd / cursed / leech-seeded ->
  //   TryEncourage.
  //   Else get_weather — VANILLA SWAPPED-WEATHER BUG PRESERVED: source
  //   carries its own comment ("@ BUG: The scripts for checking type-
  //   resistance to weather for semi-invulnerable moves are swapped",
  //   :2201-2202) and an #ifdef BUGFIX (:2208-2215); config.h:48 ships the
  //   #else branch, which is what is ported here:
  //     HAIL (:2213) -> checks the USER against the SANDSTORM-resistant
  //       type list (Ground/Rock/Steel, :2243-2247) -> TryEncourage on hit;
  //     SANDSTORM (:2214) -> checks the USER for TYPE_ICE -> TryEncourage.
  //   (Net effect, per the source comment: the AI is encouraged to stall
  //   in weather it is actually taking chip damage from. Do NOT "fix".)
  //   Miss/no-weather paths fall to AI_CV_SemiInvulnerable5 (:2230-2235):
  //   target faster -> end (0); target's last used move was Lock On
  //   (gLastMoves — ctx.targetLastMoveWasLockOn, the same battle-wide
  //   tracker AI_CV_Counter/MirrorCoat read) -> end (0); else TryEncourage.
  //   TryEncourage (:2237-2239): if_random_less_than 80 -> end, else +1 —
  //   ONE roll, +1 @ 176/256, never stacked across the entry paths.
  EFFECT_SEMI_INVULNERABLE: {
    checkViability: (ctx) => {
      if (ctx.targetHasProtectEffectMove) return -1;
      const tryEncourage = [{ p: 80 / 256, delta: 0 }, { p: 176 / 256, delta: 1 }];
      if (ctx.targetToxicPoisoned || ctx.targetCursed || ctx.targetLeechSeeded) return tryEncourage;
      if (ctx.currentWeather === "hail") {
        if (ctx.userTypes.some((t) => t === "Ground" || t === "Rock" || t === "Steel")) return tryEncourage;
      } else if (ctx.currentWeather === "sandstorm") {
        if (ctx.userTypes.includes("Ice")) return tryEncourage;
      }
      if (ctx.targetFaster) return 0;
      return ctx.targetLastMoveWasLockOn ? 0 : tryEncourage;
    },
  },

  // AI_CV_Facade (:2279-2287, dispatched :749) — VANILLA (non-BUGFIX) form
  // PRESERVED, cited: #ifdef BUGFIX (:2280-2281) checks AI_USER's status
  // (the form matching Facade's actual damage doubling); the shipped #else
  // (:2283) checks AI_TARGET instead — the AI encourages Facade when the
  // TARGET is in the STATUS1_POISON | STATUS1_BURN | STATUS1_PARALYSIS |
  // STATUS1_TOXIC_POISON mask, a real vanilla bug (config.h:48). +1 when
  // the player's status is poison/burn/paralysis, else 0 (sleep and freeze
  // are outside the mask). This engine's status model does not distinguish
  // badly-poisoned from poisoned ("poison" covers both) — exact here,
  // since source fires on regular AND toxic poison alike.
  EFFECT_FACADE: {
    checkViability: (ctx) =>
      ctx.targetStatus === "poison" || ctx.targetStatus === "burn" || ctx.targetStatus === "paralysis" ? 1 : 0,
  },

  // AI_CV_Overheat (:2572-2584, dispatched :768 — Psycho Boost carries
  // EFFECT_OVERHEAT too and scores identically). No CheckBadMove entry.
  //   if_type_effectiveness x0_25 / x0_5 (:2573-2574) -> -1
  //   target faster (:2578-2579): user HP > 80 -> 0, else -1
  //   user faster-or-tied (:2575-2577): user HP > 60 -> 0, else -1
  // Deterministic — the self-nerfing nuke is penalized once the USER is
  // already weakened (note the keying: own HP, vs Eruption's target-HP
  // keying just below).
  EFFECT_OVERHEAT: {
    checkViability: (ctx) => {
      const eff = typeEffectiveness(ctx.moveType, ctx.targetTypes);
      if (eff === 0.25 || eff === 0.5) return -1;
      if (ctx.targetFaster) return ctx.userHpPct > 80 ? 0 : -1;
      return ctx.userHpPct > 60 ? 0 : -1;
    },
  },

  // AI_CV_Eruption (:2492-2504, dispatched :761 — Water Spout carries
  // EFFECT_ERUPTION too). No CheckBadMove entry.
  //   if_type_effectiveness x0_25 / x0_5 (:2493-2494) -> -1
  //   user faster-or-tied (:2495-2497): TARGET HP > 50 -> 0, else -1
  //   target faster (:2499-2500): TARGET HP > 70 -> 0, else -1
  // Deterministic — keyed on the TARGET's remaining HP (the family's power
  // scales with the user's own HP; the AI just avoids spending it on a
  // nearly-KO'd target), unlike Overheat's own-HP keying above.
  EFFECT_ERUPTION: {
    checkViability: (ctx) => {
      const eff = typeEffectiveness(ctx.moveType, ctx.targetTypes);
      if (eff === 0.25 || eff === 0.5) return -1;
      if (ctx.targetFaster) return ctx.targetHpPct > 70 ? 0 : -1;
      return ctx.targetHpPct > 50 ? 0 : -1;
    },
  },

  // AI_CV_SmellingSalt (:2313-2320, dispatched :751): target paralyzed ->
  // +1, else 0. Deterministic. Scoring side only — the damage-doubling and
  // paralysis-curing execution mechanics are not this handler's concern.
  EFFECT_SMELLINGSALT: {
    checkViability: (ctx) => (ctx.targetStatus === "paralysis" ? 1 : 0),
  },

  // AI_CV_FocusPunch (:2289-2311, dispatched :750) + AI_CBM_HighRiskForDamage
  // (:368-376, dispatched :196 — same shared routine as batch 2's
  // SUPERPOWER/RECHARGE/FLAIL, mirrored verbatim). ALL branches ported:
  //   if_type_effectiveness x0_25 / x0_5 (:2290-2291) -> -1 flat
  //   target asleep (:2292) -> +1 flat
  //   target infatuated or confused (:2293-2294) -> AI_CV_FocusPunch3
  //     (:2305-2307): if_random_less_than 100 -> end (0); else user behind
  //     a Substitute -> +5 (Score_Plus5, :644-646), no Substitute -> +1
  //     (falls into ScoreUp1) — ONE 156/256 roll picking the payout size.
  //   else (:2295-2298): is_first_turn_for(AI_USER) != 0 -> end (0);
  //     NOT first turn -> +1 @ 156/256 (if_random_less_than 100 -> end).
  // That last branch keys on ctx.userPastFirstTurn — a REAL state input
  // since batch 4 (state.oppMonFirstTurn + the search's decay); the
  // batch-3 partial registry entry is retired. Every branch is live.
  EFFECT_FOCUS_PUNCH: {
    checkBadMove: highRiskForDamage,
    checkViability: (ctx) => {
      const eff = typeEffectiveness(ctx.moveType, ctx.targetTypes);
      if (eff === 0.25 || eff === 0.5) return -1;
      if (ctx.targetStatus === "sleep") return 1;
      if (ctx.targetInfatuated || ctx.targetConfused) {
        return [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: ctx.userHasSubstitute ? 5 : 1 }];
      }
      if (!ctx.userPastFirstTurn) return 0;
      return [{ p: 100 / 256, delta: 0 }, { p: 156 / 256, delta: 1 }];
    },
  },

  // AI_CV_KnockOff (:2466-2473, dispatched :759) + AI_CBM_TrickAndKnockOff
  // (:545-548, dispatched :202): target's ability Sticky Hold -> -10.
  //   if_hp_less_than AI_TARGET, 30 (:2467) -> end (0)
  //   is_first_turn_for(AI_USER) > 0 (:2468-2469) -> end (0)
  //   else +1 @ 76/256 (:2470-2471, if_random_less_than 180 -> end).
  // The encouragement keys on ctx.userPastFirstTurn — a real state input
  // since batch 4, same as FOCUS_PUNCH above (partial entry retired); the
  // Sticky Hold discouragement and the target-HP gate were always live.
  EFFECT_KNOCK_OFF: {
    checkBadMove: (ctx) => taRead(ctx, (a) => (a === "Sticky Hold" ? -10 : 0)),
    checkViability: (ctx) => {
      if (ctx.targetHpPct < 30) return 0;
      if (!ctx.userPastFirstTurn) return 0;
      return [{ p: 180 / 256, delta: 0 }, { p: 76 / 256, delta: 1 }];
    },
  },

  // AI_CV_Pursuit (:2018-2035, dispatched :730). No CheckBadMove entry.
  //   is_first_turn_for(AI_USER) != 0 (:2019-2020) -> end (0) — NOTE the
  //   polarity: the encouragement fires on turns AFTER the user's first
  //   turn out, never on the first turn itself (same gate direction as
  //   FocusPunch/KnockOff above).
  //   NOT first turn + target type1 or type2 Ghost or Psychic (:2021-2028)
  //   -> +1 @ 128/256 (:2031-2033, if_random_less_than 128 -> end).
  // The WHOLE routine sits behind ctx.userPastFirstTurn — a real state
  // input since batch 4 (partial entry retired): scores 0 on the mon's
  // first turn out, rolls on every later simulated turn.
  EFFECT_PURSUIT: {
    checkViability: (ctx) => {
      if (!ctx.userPastFirstTurn) return 0;
      if (ctx.targetTypes.includes("Ghost") || ctx.targetTypes.includes("Psychic")) {
        return [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }];
      }
      return 0;
    },
  },

  // AI_CV_Trap (:1436-1447, dispatched :685 — EFFECT_MEAN_LOOK :723 runs
  // the SAME routine; this checkViability mirrors EFFECT_MEAN_LOOK's entry
  // above exactly, keep the two in lockstep). Target already badly
  // poisoned / cursed / perish-songed / infatuated -> +1 @ 128/256
  // (if_random_less_than 128 -> end), else 0. Gate liveness (same honest-
  // default convention as everywhere else in this file):
  // targetPerishSonged is REAL state (Perish Song's resolution sets it);
  // targetToxicPoisoned (badly-poisoned not distinguished from poisoned),
  // targetCursed (Ghost-Curse not modeled) and targetInfatuated (the ctx
  // literal's later duplicate key pins it false) are honest always-false
  // defaults today — those branches activate the moment the inputs get
  // built, same pattern as EFFECT_FUTURE_SIGHT's queued-state flags.
  EFFECT_TRAP: {
    checkViability: (ctx) => {
      if (ctx.targetToxicPoisoned || ctx.targetCursed || ctx.targetPerishSonged || ctx.targetInfatuated) {
        return [{ p: 128 / 256, delta: 0 }, { p: 128 / 256, delta: 1 }];
      }
      return 0;
    },
  },

  // ── LOCKSTEP PORT CAMPAIGN, BATCH 4 (2026-08-04) — CAMPAIGN FINAL ─────
  // The per-mon first-turn state input exists now (state.oppMonFirstTurn ->
  // ctx.userPastFirstTurn, decayed by the Arena search's turn advance —
  // see the ctx comment in chooseOpponentMoves), so the batch-1 STOP is
  // lifted: Fake Out ports, and the batch-3 partials' first-turn branches
  // (FOCUS_PUNCH/KNOCK_OFF/PURSUIT above) run live off the real flag.

  // AI_CV_FakeOut (:2249-2251, dispatched :743): unconditional score +2 —
  // the CV routine itself has NO gate. The first-turn discipline lives
  // entirely in AI_CBM_FakeOut (:506-509, dispatched :187):
  // is_first_turn_for(AI_USER) == FALSE -> Score_Minus10. Net effect:
  // +2 on the user's first turn out, -10 + 2 = -8 net on every later turn
  // (the CV +2 still runs — CBM and CV are separate phases, both fire).
  EFFECT_FAKE_OUT: {
    checkBadMove: (ctx) => (ctx.userPastFirstTurn ? -10 : 0),
    checkViability: () => 2,
  },

  // Every other effect: no handler yet. Fine for YOUR moves (no AI scoring
  // needed). If an OPPONENT ever carries one, chooseOpponentMoves will throw
  // naming the exact effect — port its AI_CV_*/AI_CBM_* handler from
  // data/battle_ai_scripts.s before using it as an opponent move.
};

// The "_2" (raises 2 stages) moves share the exact same AI handler as their
// "_1" counterpart per source (if_effect EFFECT_ATTACK_UP_2, AI_CBM_AttackUp,
// data/battle_ai_scripts.s:133-146) — same object, second key.
AI_HANDLERS.EFFECT_ATTACK_UP_2 = AI_HANDLERS.EFFECT_ATTACK_UP;
AI_HANDLERS.EFFECT_SPECIAL_ATTACK_UP_2 = AI_HANDLERS.EFFECT_SPECIAL_ATTACK_UP;
AI_HANDLERS.EFFECT_DEFENSE_UP_2 = AI_HANDLERS.EFFECT_DEFENSE_UP;
AI_HANDLERS.EFFECT_SPECIAL_DEFENSE_UP_2 = AI_HANDLERS.EFFECT_SPECIAL_DEFENSE_UP;
AI_HANDLERS.EFFECT_SPEED_UP_2 = AI_HANDLERS.EFFECT_SPEED_UP;

// B2b batch 8 extends that to every OTHER pair source dispatches to one
// routine. Verified row by row in both tables rather than assumed from the
// naming: AI_CheckBadMove :113-146 and AI_CheckViability :664-701 each list the
// "_2" variant against the SAME label as its base. Aliases, not copies -- a
// copy is how a clause lands in one member of a family and not the other.
AI_HANDLERS.EFFECT_ATTACK_DOWN = AI_HANDLERS.EFFECT_ATTACK_DOWN_2;               // AI_CBM_AttackDown / AI_CV_AttackDown
AI_HANDLERS.EFFECT_SPECIAL_ATTACK_DOWN_2 = AI_HANDLERS.EFFECT_SPECIAL_ATTACK_DOWN; // AI_CBM_SpAtkDown / AI_CV_SpAtkDown
AI_HANDLERS.EFFECT_SPECIAL_DEFENSE_DOWN = AI_HANDLERS.EFFECT_SPECIAL_DEFENSE_DOWN_2; // AI_CBM_SpDefDown / AI_CV_SpDefDown
AI_HANDLERS.EFFECT_ACCURACY_DOWN_2 = AI_HANDLERS.EFFECT_ACCURACY_DOWN;           // AI_CBM_AccDown / AI_CV_AccuracyDown
AI_HANDLERS.EFFECT_EVASION_DOWN_2 = AI_HANDLERS.EFFECT_EVASION_DOWN;             // AI_CBM_EvasionDown / AI_CV_EvasionDown
AI_HANDLERS.EFFECT_ACCURACY_UP_2 = AI_HANDLERS.EFFECT_ACCURACY_UP;               // AI_CBM_AccUp / AI_CV_AccuracyUp
AI_HANDLERS.EFFECT_EVASION_UP_2 = AI_HANDLERS.EFFECT_EVASION_UP;                 // AI_CBM_EvasionUp / AI_CV_EvasionUp
// These last two were already ported TWICE -- EFFECT_DEFENSE_DOWN_2 and
// EFFECT_SPEED_DOWN_2 existed as separately hand-written objects, using
// DIFFERENT viability functions from their bases for what source dispatches to
// one routine. Measured across 2,250 contexts each (every combination of stage,
// both HP axes, speed order, three abilities and three type lines): 0
// disagreements, so the copies were equivalent -- this time. Collapsed to
// aliases so they cannot stop being equivalent.
AI_HANDLERS.EFFECT_DEFENSE_DOWN_2 = AI_HANDLERS.EFFECT_DEFENSE_DOWN;             // AI_CBM_DefenseDown / AI_CV_DefenseDown
AI_HANDLERS.EFFECT_SPEED_DOWN_2 = AI_HANDLERS.EFFECT_SPEED_DOWN;                 // AI_CBM_SpeedDown / AI_CV_SpeedDown
// B2b batch 10: EFFECT_POISON shares AI_CBM_Toxic (:148) but has its OWN
// AI_CV_Poison, so only the checkBadMove half is aliased.
AI_HANDLERS.EFFECT_POISON.checkBadMove = AI_HANDLERS.EFFECT_TOXIC.checkBadMove;
// AI_CV_ChangeSelfAbility is dispatched for BOTH Role Play and Skill Swap.
AI_HANDLERS.EFFECT_SKILL_SWAP = AI_HANDLERS.EFFECT_ROLE_PLAY;

// ─────────────────────────────────────────────────────────────────────────
// 4. DAMAGE CALCULATION (Gen III formula)
// ─────────────────────────────────────────────────────────────────────────

// Standard stat-stage multiplier table (identical across all generations for
// non-accuracy/evasion stats). Accuracy/evasion use a different table
// (3/3 at 0 up to 9/3 and 3/9) — not implemented yet since nothing in any
// matchup so far has needed evasion to actually affect hit chance (Double
// Team's stage is tracked for AI-scoring purposes but not yet wired into
// resolveTurn's accuracy math — known gap, flagged rather than silent).
const STAT_STAGE_MULT = {
  "-6": 2/8, "-5": 2/7, "-4": 2/6, "-3": 2/5, "-2": 2/4, "-1": 2/3,
  "0": 1, "1": 3/2, "2": 4/2, "3": 5/2, "4": 6/2, "5": 7/2, "6": 8/2,
};
function stageMult(stage) { return STAT_STAGE_MULT[String(stage)] ?? 1; }

// B7: gStatStageRatios as the INTEGER pairs source stores, applied the way
// APPLY_STAT_MOD applies them (src/pokemon.c:3100-3104): `stat * r0 / r1` in
// truncating s32.
//
// MEASURED INERT, and said plainly because an earlier draft of this comment
// claimed otherwise: over stat 1..20000 x all 13 stages (260,000 pairs) the
// integer form and the float form `floor(stat * STAT_STAGE_MULT[stage])` agree
// on EVERY pair. The float multiply is exact here -- 3 * (2/3) is 2 in IEEE754,
// not 1.9999999999999998 -- so there is no one-ULP bug of the sim-audit.md §3.3
// class hiding in the old form. This is adopted because it is source's literal
// arithmetic and Phase D compares against the ROM, not because it fixes a
// measured error. What DOES change the numbers is the ORDER: source applies
// this AFTER the item/ability modifiers, and this engine applied it before.
// STAT_STAGE_MULT is retained for speed(), which mirrors
// src/battle_main.c:4625-4626's own use of the same table.
const STAT_STAGE_RATIO = {
  "-6": [2, 8], "-5": [2, 7], "-4": [2, 6], "-3": [2, 5], "-2": [2, 4], "-1": [2, 3],
  "0": [1, 1], "1": [3, 2], "2": [4, 2], "3": [5, 2], "4": [6, 2], "5": [7, 2], "6": [8, 2],
};
function applyStatStage(stat, stage) {
  const [n, d] = STAT_STAGE_RATIO[String(stage)] ?? [1, 1];
  return Math.floor((stat * n) / d);
}

// sHoldEffectToType (src/pokemon.c:1919-1938), restricted to the hold effects
// the Lv50 pool actually carries. Each gives (param + 100)% of the attacking
// stat for its own type; every one of them has param 10, i.e. 1.1x.
const HOLD_EFFECT_BOOSTED_TYPE = {
  HOLD_EFFECT_BUG_POWER: "Bug", HOLD_EFFECT_STEEL_POWER: "Steel",
  HOLD_EFFECT_GROUND_POWER: "Ground", HOLD_EFFECT_ROCK_POWER: "Rock",
  HOLD_EFFECT_GRASS_POWER: "Grass", HOLD_EFFECT_DARK_POWER: "Dark",
  HOLD_EFFECT_FIGHTING_POWER: "Fighting", HOLD_EFFECT_ELECTRIC_POWER: "Electric",
  HOLD_EFFECT_WATER_POWER: "Water", HOLD_EFFECT_FLYING_POWER: "Flying",
  HOLD_EFFECT_POISON_POWER: "Poison", HOLD_EFFECT_ICE_POWER: "Ice",
  HOLD_EFFECT_GHOST_POWER: "Ghost", HOLD_EFFECT_PSYCHIC_POWER: "Psychic",
  HOLD_EFFECT_FIRE_POWER: "Fire", HOLD_EFFECT_DRAGON_POWER: "Dragon",
  HOLD_EFFECT_NORMAL_POWER: "Normal",
};

// The four pinch abilities (src/pokemon.c:3219-3226) -- 1.5x POWER for their
// own type at hp <= floor(maxHP / 3).
const PINCH_ABILITY_TYPE = {
  Overgrow: "Grass", Blaze: "Fire", Torrent: "Water", Swarm: "Bug",
};

// Cloud Nine / Air Lock suppress EVERY weather effect (damage multiplier,
// chip damage, speed doubling, accuracy changes) while on the field, WITHOUT
// touching the underlying weatherType/weatherTurns state — the counter keeps
// ticking in the background (include/battle_util.h:47-48, WEATHER_HAS_EFFECT).
// One shared helper so every consumption site (damage, speed, accuracy,
// end-of-turn chip) agrees on whether weather actually does anything.
function effectiveWeather(state, you, opp) {
  if (you.ability === "Cloud Nine" || you.ability === "Air Lock") return null;
  if (opp.ability === "Cloud Nine" || opp.ability === "Air Lock") return null;
  return state.weatherType;
}

// Turn-order speed check, shared by resolveTurn (actual resolution) and
// chooseOpponentMoves (the AI's own "will I go first" belief when scoring
// if_target_faster/if_user_faster checks) — kept as ONE function so the two
// can never silently diverge. Applies the Speed stat-stage multiplier THEN
// quarters for paralysis, matching GetWhoStrikesFirst's real order of
// operations (src/battle_main.c:4624-4626 applies gStatStageRatios; :4650-4651
// divides by 4 for STATUS1_PARALYSIS, strictly after the stage ratio).
// weather: the EFFECTIVE weather (already Cloud-Nine/Air-Lock-checked by the
// caller) — Swift Swim doubles Speed in rain, Chlorophyll doubles it in sun
// (src/battle_main.c:4606-4616), applied at the SAME stage as the stat-stage
// ratio (both multiply the raw base Speed, computed together before any
// floor). Does NOT model badge speed boost, Macho Brace, or Quick Claw (none
// modeled elsewhere in this engine either — out of scope here).
function effSpeed(mon, status, speedStage = 0, weather = null) {
  const weatherMult = (mon.ability === "Swift Swim" && weather === "rain") || (mon.ability === "Chlorophyll" && weather === "sun") ? 2 : 1;
  const raw = Math.floor(mon.stats.spe * weatherMult * stageMult(speedStage));
  return status === "paralysis" ? Math.floor(raw / 4) : raw;
}

// Accuracy/evasion stage multiplier table — DIFFERENT from the main stat
// stage table above. Well-established, stable across generations, same
// confidence tier as the main stage table and type chart (no source
// research needed). The two stages combine into a SINGLE effective stage
// (attacker's accuracy stage minus target's evasion stage, clamped to
// -6..+6) before one lookup — not two separate multiplications.
// A1: source's accuracy stage table is a table of INTEGER RATIOS, and it is
// applied with INTEGER arithmetic:
//     calc = sAccuracyStageRatios[buff].dividend * moveAcc;
//     calc /= sAccuracyStageRatios[buff].divisor;
// (table src/battle_script_commands.c:588-603, applied :1149-1150). The u32
// division truncates.
//
// This engine used exact rationals (3/8, 4/3, ...) and no truncation. Six of
// the thirteen entries are not the same number as source's -- source stores
// 33/100, 36/100, 43/100, 133/100, 166/100, 233/100 and 133/50, which are
// truncated decimal approximations of 1/3, 3/8, 3/7, 4/3, 5/3, 7/3 and 8/3 --
// and the missing truncation moved every non-integer product. sim-audit.md §4.2
// measured 56 of 143 (accuracy, stage) pairs diverging, 22 of 77 within the
// range a fresh 3-turn round can reach, worst 2.00pp.
const ACC_EVASION_STAGE_RATIO = {
  "-6": [33, 100], "-5": [36, 100], "-4": [43, 100], "-3": [50, 100],
  "-2": [60, 100], "-1": [75, 100], "0": [1, 1], "1": [133, 100],
  "2": [166, 100], "3": [2, 1], "4": [233, 100], "5": [133, 50], "6": [3, 1],
};
// B7c: the WHOLE accuracy chain, in source's order and UNCAPPED
// (src/battle_script_commands.c:1128-1174). Returns `calc`, which the caller
// turns into a hit probability -- source never caps it either, it just compares
// `Random() % 100 + 1 > calc`, so any calc >= 100 is a guaranteed hit.
//
// CAPPING EARLY WAS A BUG. The old version capped at 100 inside this function
// and the caller then multiplied Sand Veil's 0.8 onto the CAPPED value. Source
// multiplies onto the raw calc and only compares at the end, so a calc of 130
// against a Sand Veil holder is 104 in source (still a guaranteed hit) but was
// 80 here. Every multiplier below now lands before any cap.
//
// Two of these were missing entirely: Compound Eyes (4 sets, 5 cells) and
// HUSTLE'S ACCURACY PENALTY -- B7a ported Hustle's 1.5x Attack and not the 0.8x
// accuracy that pays for it, which made Hustle a pure buff. Half a port is
// worse than none, so it is completed here.
// POSITIONAL, not an options object: this runs on every accuracy evaluation in
// the search, and the options-object form measured a 15% throughput regression
// (95.2 -> 80.5 solves/sec) purely from the per-call allocation. `defenderItem`
// takes an already-resolved itemData() record OR a name; callers in the hot
// path pass the record so the lookup happens once per action, not once per
// evaluation.
function accuracyCalc(baseAccuracy, attackerAccStage, targetEvasionStage,
  attackerAbility = null, defenderAbility = null, defenderItem = null,
  weather = null, physical = false) {
  const combined = Math.max(-6, Math.min(6, attackerAccStage - targetEvasionStage));
  const [dividend, divisor] = ACC_EVASION_STAGE_RATIO[String(combined)];
  let calc = Math.floor((dividend * baseAccuracy) / divisor);
  // :1152-1153 Compound Eyes, 1.3x.
  if (attackerAbility === "Compound Eyes") calc = Math.floor((calc * 130) / 100);
  // :1154-1155 Sand Veil, 0.8x, and ONLY while sandstorm is actually in effect.
  if (weather === "sandstorm" && defenderAbility === "Sand Veil") calc = Math.floor((calc * 80) / 100);
  // :1156-1157 Hustle, 0.8x, physical moves only.
  if (attackerAbility === "Hustle" && physical) calc = Math.floor((calc * 80) / 100);
  // :1172-1173 BrightPowder, (100 - param)% -- param 10, so 0.9x.
  const di = typeof defenderItem === "string" || defenderItem == null ? itemData(defenderItem) : defenderItem;
  if (di && di.holdEffect === "HOLD_EFFECT_EVASION_UP") {
    calc = Math.floor((calc * (100 - di.param)) / 100);
  }
  return calc;
}

// Flail/Reversal (EFFECT_FLAIL) exact power table, source-confirmed.
// hpFraction = floor(hp * 48 / maxHP), floored to 1 minimum whenever hp > 0.
// Table breaks at the FIRST threshold >= hpFraction (so exactly 4/48 gets 150,
// not 100). Uses CURRENT hp at the moment the move executes, not turn-start.
const FLAIL_POWER_TABLE = [[1, 200], [4, 150], [9, 100], [16, 80], [32, 40], [48, 20]];
function getFlailPower(hpPct) {
  const hpFraction = Math.max(1, Math.floor((hpPct / 100) * 48));
  for (const [threshold, power] of FLAIL_POWER_TABLE) {
    if (hpFraction <= threshold) return power;
  }
  return 20;
}

// EFFECT_RETURN/EFFECT_FRUSTRATION (Cmd_friendshiptodamagecalculation,
// src/battle_script_commands.c:8603-8611): power = trunc(10 * friendship / 25)
// for Return, trunc(10 * (255 - friendship) / 25) for Frustration — integer
// truncation, matching Math.floor since friendship is always non-negative.
// At max friendship (255): Return = 102 (confirmed against source, NOT 104).
function getFriendshipPower(effect, friendship) {
  return effect === "EFFECT_RETURN"
    ? Math.floor((10 * friendship) / 25)
    : Math.floor((10 * (255 - friendship)) / 25);
}

// ── B2b batch 5: the effects whose DAMAGE NUMBER is not power-based ────────
// Two different shapes, and they are kept apart because source keeps them apart:
//
//   SET_DAMAGE_EFFECTS       the script decides gBattleMoveDamage itself and
//                            never runs the formula (handled inside calcDamage)
//   variablePowerFor()       the script substitutes gDynamicBasePower and then
//                            runs the ORDINARY formula, so STAB, type, crit,
//                            the roll and every modifier still apply
//
// Both were in SILENT_FALLTHROUGH_EFFECTS, which threw rather than quietly
// computing a number off a placeholder power. This is what they were waiting
// for; the guard entries come out in the same commit.
// Phase D F21: the effects whose script runs `bicbyte gMoveResultFlags,
// MOVE_RESULT_SUPER_EFFECTIVE | MOVE_RESULT_NOT_VERY_EFFECTIVE` after typecalc
// (data/battle_scripts_1.s:815, 825, 1201, 1212, 1726, 2488; Bide's unleash at
// 3300), so the Arena's Skill never sees an effectiveness flag for them.
// test-d-f21 derives the set from the scripts and fails if either side drifts.
const EFFECTIVENESS_CLEARED_EFFECTS = new Set([
  "EFFECT_SUPER_FANG", "EFFECT_DRAGON_RAGE", "EFFECT_LEVEL_DAMAGE", "EFFECT_PSYWAVE",
  "EFFECT_SONICBOOM", "EFFECT_ENDEAVOR", "EFFECT_BIDE",
]);
const SET_DAMAGE_EFFECTS = new Set([
  // B3 batch 4c: Bide's unleash -- `copyword gBattleMoveDamage, sBIDE_DMG` then
  // adjustsetdamage (data/battle_scripts_1.s:3292-3303), after a typecalc whose
  // SE/NVE flags it clears. Twice the stored damage, arriving from applyMove.
  "EFFECT_BIDE",
  "EFFECT_SONICBOOM", "EFFECT_DRAGON_RAGE", "EFFECT_PSYWAVE",
  "EFFECT_SUPER_FANG", "EFFECT_ENDEAVOR",
  // Phase D F27: Counter / Mirror Coat -- counterdamagecalculator fixes the
  // number, adjustsetdamage follows; no roll, no STAB, no crit.
  "EFFECT_COUNTER", "EFFECT_MIRROR_COAT",
]);

// Magnitude's own distribution (Cmd_magnitudedamagecalculation,
// src/battle_script_commands.c:8670-8708). `Random() % 100` against seven
// cutoffs -- NOT uniform over the seven, which is the whole character of the
// move: magnitude 4 is 5% and magnitude 7 is 30%.
const MAGNITUDE_DRAWS = [
  { power: 10, p: 5 / 100 },    // rand < 5     magnitude 4
  { power: 30, p: 10 / 100 },   // rand < 15    magnitude 5
  { power: 50, p: 20 / 100 },   // rand < 35    magnitude 6
  { power: 70, p: 30 / 100 },   // rand < 65    magnitude 7
  { power: 90, p: 20 / 100 },   // rand < 85    magnitude 8
  { power: 110, p: 10 / 100 },  // rand < 95    magnitude 9
  { power: 150, p: 5 / 100 },   // else         magnitude 10
];

// Present (Cmd_presentdamagecalculation, :9111-9147). `Random() & 0xFF` against
// 102 / 178 / 204 out of 256 -- and the fourth arm does not attack at all, it
// HEALS the target for maxHP/4. That arm is carried as the sentinel "heal"
// rather than a power, because it is a different kind of outcome and collapsing
// it into a 0-power hit would silently lose the heal.
const PRESENT_DRAWS = [
  { power: 40, p: 102 / 256 },
  { power: 80, p: 76 / 256 },   // 178 - 102
  { power: 120, p: 26 / 256 },  // 204 - 178
  { power: "heal", p: 52 / 256 }, // 256 - 204
];

// Psywave's rejection sample (:7934). `while ((r = Random() % 16) > 10);` keeps
// drawing until r <= 10, so the reachable set is 0..10 UNIFORMLY -- 1/11 each,
// not 1/16 with a fat tail. The engine enumerates the OUTCOME distribution, so
// the rejected draws simply do not exist as branches.
const PSYWAVE_DRAWS = Array.from({ length: 11 }, (_, r) => ({ power: r, p: 1 / 11 }));

// The table the enumerator reads. Keyed by effect, same shape as
// MULTI_HIT_DISTRIBUTION, and deliberately the ONLY place these lists live.
const VARIABLE_DAMAGE_DRAWS = {
  EFFECT_MAGNITUDE: MAGNITUDE_DRAWS,
  EFFECT_PRESENT: PRESENT_DRAWS,
  EFFECT_PSYWAVE: PSYWAVE_DRAWS,
};

function variablePowerFor(move, attacker, defender, attackerHpPct, variablePower, moveName) {
  switch (move.effect) {
    // Cmd_weightdamagecalculation (:9467-9482): power is a pure function of the
    // TARGET's dex weight. The weights are generated, never transcribed --
    // arena-solver/tools/gen-species-weights.mjs.
    case "EFFECT_LOW_KICK":
      return lowKickPower(defender.species);
    // Cmd_scaledamagebyhealthratio (:9379-9389): gDynamicBasePower =
    // hp * power / maxHP, minimum 1. Eruption and Water Spout.
    case "EFFECT_ERUPTION": {
      const maxHp = attacker.stats.hp;
      const curHp = Math.round((attackerHpPct / 100) * maxHp);
      return Math.max(1, Math.floor((curHp * move.power) / maxHp));
    }
    // Fury Cutter's escalating power is computed in applyMove, where the
    // counter lives, and arrives here the same way Magnitude's draw does.
    case "EFFECT_FURY_CUTTER":
    // B3 batch 3: Rollout's doubling power is computed in applyMove from its
    // timer, the same way. Without this case the timer ran and the damage
    // stayed at base power -- caught by the characterization test's 53/53/53.
    case "EFFECT_ROLLOUT":
    // B3 batch 6: Triple Kick's per-hit power (10, 20, 30), from applyMove's loop.
    case "EFFECT_TRIPLE_KICK":
      if (variablePower === null) {
        throw new Error(`calcDamage: ${moveName} (${move.effect}) needs its counter-derived power ` +
          `from applyMove and got none.`);
      }
      return variablePower;
    case "EFFECT_MAGNITUDE":
    case "EFFECT_PRESENT": {
      // An enumerated draw, never a live one. Present's heal arm never reaches
      // the damage formula at all (applyMove handles it), so seeing it here is
      // a routing bug worth failing on rather than defaulting.
      if (variablePower === null || variablePower === "heal") {
        throw new Error(`calcDamage: ${moveName} (${move.effect}) needs an enumerated power draw ` +
          `and got ${JSON.stringify(variablePower)} -- the caller must branch it.`);
      }
      return variablePower;
    }
    default:
      return move.power;
  }
}

function calcDamage(attacker, defender, moveName, {
  rollFrac = 0.925, rollPercent = null, crit = false, atkStage = 0, defStage = 0,
  attackerBurned = false, attackerFlashFireActive = false, attackerHpPct = 100,
  screenActive = false, weather = null, defenderForesighted = false,
  attackerStatus = null, defenderStatus = null,
  mudSportActive = false, waterSportActive = false,
  defenderHpPct = 100, variablePower = null, aiEstimate = false, baseMultiplier = 1,
  // B3 batch 5b: CalculateBaseDamage's output alone -- no STAB, no type chart.
  // Future Sight fixes its damage this way and never runs typecalc.
  untyped = false,
} = {}) {
  // The AI's estimate reads the base entry: AI_CalcDmg runs with the dynamic
  // type cleared (src/battle_ai_script_commands.c:1470-1474).
  const move = aiEstimate ? MOVES[moveName] : battleMoveData(attacker, moveName);
  if (move.power === 0) return 0;
  // Phase D F42: Cmd_typecalc returns at once for MOVE_STRUGGLE
  // (src/battle_script_commands.c:1360-1364) -- no STAB, no type chart.
  if (moveName === "Struggle") untyped = true;
  // EFFECT_LEVEL_DAMAGE (Night Shade/Seismic Toss): damage is EXACTLY the
  // user's level — bypasses Atk/Def/STAB/power/the formula entirely, and
  // (unlike every other damaging move) has NO 0.85-1.0 roll either, since
  // it's a flat fixed value in source, not a formula output. Type IMMUNITY
  // still applies (Night Shade=Ghost does 0 to Normal-types, Seismic
  // Toss=Fighting does 0 to Ghost-types) — checked directly here since this
  // branch returns before the formula's own `eff`/type-effectiveness
  // handling further down even runs. Normal resist/weak (0.5x/2x) is
  // deliberately NOT applied — only the binary immune/not-immune gate.
  if (move.effect === "EFFECT_LEVEL_DAMAGE") {
    return typeEffectiveness(move.type, defender.types, defenderForesighted) === 0 ? 0 : attacker.level;
  }

  // ── B2b batch 5: the SET-DAMAGE family ──────────────────────────────────
  // Sonic Boom, Dragon Rage, Psywave, Super Fang and Endeavor decide
  // gBattleMoveDamage outright and never enter the formula. Every one of their
  // scripts runs `typecalc` and then bics MOVE_RESULT_SUPER_EFFECTIVE |
  // MOVE_RESULT_NOT_VERY_EFFECTIVE (data/battle_scripts_1.s:1936 Sonic Boom,
  // :1946 Dragon Rage, :2116 Psywave, :1926 Super Fang, :3684 Endeavor), so the
  // 0.5x/2x multipliers are DISCARDED while a type IMMUNITY still zeroes the
  // move. No roll, no STAB, no crit -- exactly EFFECT_LEVEL_DAMAGE's shape,
  // which is why it sits beside it rather than inside the formula below.
  //
  // The returned number still flows through applyMove's substitute, Endure and
  // Focus Band handling, because in source those live in Cmd_adjustsetdamage
  // (src/battle_script_commands.c:5861-5899) AFTER the number is fixed.
  if (!aiEstimate && SET_DAMAGE_EFFECTS.has(move.effect)) {
    if (typeEffectiveness(move.type, defender.types, defenderForesighted) === 0) return 0;
    const defHp = Math.round((defenderHpPct / 100) * defender.stats.hp);
    const atkHp = Math.round((attackerHpPct / 100) * attacker.stats.hp);
    switch (move.effect) {
      // setword gBattleMoveDamage, 20 / 40 -- literally that, level-independent.
      case "EFFECT_SONICBOOM": return 20;
      case "EFFECT_BIDE":
        if (variablePower === null) {
          throw new Error(`calcDamage: ${moveName} (EFFECT_BIDE) needs its stored damage from applyMove and got none.`);
        }
        return variablePower;
      case "EFFECT_DRAGON_RAGE": return 40;
      case "EFFECT_COUNTER": case "EFFECT_MIRROR_COAT": // F27: twice what was received, from applyMove
        // Outside the hit (the search's tie-break, Transform / Mimic probes)
        // there is no reflected number: keep what those callers always got,
        // the power-1 formula below.
        if (variablePower === null) break;
        return variablePower;
      // Cmd_damagetohalftargethp (:9505-9512): hp / 2, floored, minimum 1.
      case "EFFECT_SUPER_FANG": return Math.max(1, Math.floor(defHp / 2));
      // Cmd_setdamagetohealthdifference (:9366-9377): target hp - user hp, and
      // the script FAILS outright when the target is not above the user. The
      // fail branch is applyMove's, since it is a move result, not a number.
      case "EFFECT_ENDEAVOR": return Math.max(0, defHp - atkHp);
      // Cmd_psywavedamageeffect (:7932-7941): `while ((r = Random() % 16) > 10);`
      // -- a rejection sample, so r is UNIFORM over 0..10, not a 16-way draw.
      // damage = level * (10r + 50) / 100. The draw is enumerated by the caller
      // (VARIABLE_DAMAGE_DRAWS); reaching here without one is a bug, not a
      // reason to pick a number.
      case "EFFECT_PSYWAVE": {
        if (variablePower === null) {
          throw new Error(`calcDamage: ${moveName} (EFFECT_PSYWAVE) needs an enumerated draw ` +
            `(0-10, uniform after rejection) and got none -- the caller must branch it.`);
        }
        return Math.floor((attacker.level * (variablePower * 10 + 50)) / 100);
      }
      default: break;
    }
  }
  // Phase D F10: EVERY AI estimate reads the table power -- source clears
  // gDynamicBasePower first (src/battle_ai_script_commands.c:1188-1189,
  // 1471-1474), so Return / Frustration / Flail / Reversal are power 1 to the
  // AI, exactly as its power > 1 gates expect.
  const effectivePower = aiEstimate ? move.power
    : moveName === "Flail" || moveName === "Reversal" ? getFlailPower(attackerHpPct)
    : (move.effect === "EFFECT_RETURN" || move.effect === "EFFECT_FRUSTRATION") ? getFriendshipPower(move.effect, attacker.friendship)
    : variablePowerFor(move, attacker, defender, attackerHpPct, variablePower, moveName);

  const atkStatKey = move.category === "physical" ? "atk" : "spa";
  const defStatKey = move.category === "physical" ? "def" : "spd";
  // Crits ignore negative attack stages and positive defense stages (Gen III rule).
  const effAtkStage = crit ? Math.max(0, atkStage) : atkStage;
  const effDefStage = crit ? Math.min(0, defStage) : defStage;
  // ── CalculateBaseDamage's modifier chain (src/pokemon.c:3158-3231) ───────
  // ORDER IS THE POINT. Source applies every flat item/ability modifier to the
  // RAW stat and only then folds in the stat stage, via APPLY_STAT_MOD
  // (:3100-3104). This engine used to do the opposite -- stage first -- which is
  // a different integer as soon as any modifier is present: for a Choice Band
  // holder with raw Attack 200 at stage -1, source gives 200 and stage-first
  // gives 199. With NO modifier present the two orders are identical, which is
  // why the 106 cells this class moved are exactly the cells carrying a modelled
  // item or ability and not one cell more.
  const physical = move.category === "physical";
  const atkItem = itemData(attacker.item) || null;
  const defItem = itemData(defender.item) || null;
  let attack = attacker.stats[atkStatKey];
  let defense = defender.stats[defStatKey];
  let power = effectivePower;

  // :3158-3159 Huge Power / Pure Power -- `attack *= 2`, so physical only.
  if (physical && (attacker.ability === "Huge Power" || attacker.ability === "Pure Power")) {
    attack *= 2;
  }
  // :3170-3182 the type-boost hold items. Source picks `attack` when the MOVE'S
  // TYPE is physical and `spAttack` otherwise -- which in Gen III is the same
  // question as this engine's move.category, since the split is by type.
  if (atkItem && HOLD_EFFECT_BOOSTED_TYPE[atkItem.holdEffect] === move.type) {
    attack = Math.floor((attack * (atkItem.param + 100)) / 100);
  }
  // :3185 Choice Band -- `attack = (150 * attack) / 100`, attack only.
  if (physical && atkItem && atkItem.holdEffect === "HOLD_EFFECT_CHOICE_BAND") {
    attack = Math.floor((150 * attack) / 100);
  }
  // :3199-3200 Thick Club -- doubles Attack, and ONLY for Cubone and Marowak.
  if (physical && atkItem && atkItem.holdEffect === "HOLD_EFFECT_THICK_CLUB"
      && (attacker.species === "Cubone" || attacker.species === "Marowak")) {
    attack *= 2;
  }
  // :3187-3190 Soul Dew is EXPLICITLY DISABLED in the Frontier -- source gates
  // it on `!(gBattleTypeFlags & BATTLE_TYPE_FRONTIER)`, and BATTLE_TYPE_ARENA
  // sits inside that composite mask (include/constants/battle.h:91). So it is
  // inert here BY SOURCE, not by omission: it is the one modifier in this block
  // that must NOT be ported, and porting it would be the bug.
  // :3191-3192 Deep Sea Tooth -- 2x SpAttack, Clamperl only.
  if (!physical && atkItem && atkItem.holdEffect === "HOLD_EFFECT_DEEP_SEA_TOOTH"
      && attacker.species === "Clamperl") {
    attack *= 2;
  }
  // :3195-3196 Light Ball -- 2x SpAttack, Pikachu only.
  if (!physical && atkItem && atkItem.holdEffect === "HOLD_EFFECT_LIGHT_BALL"
      && attacker.species === "Pikachu") {
    attack *= 2;
  }
  // :3193-3194 Deep Sea Scale -- 2x SpDefense, Clamperl only.
  if (!physical && defItem && defItem.holdEffect === "HOLD_EFFECT_DEEP_SEA_SCALE"
      && defender.species === "Clamperl") {
    defense *= 2;
  }
  // :3197-3198 Metal Powder -- 2x Defense, Ditto only.
  if (physical && defItem && defItem.holdEffect === "HOLD_EFFECT_METAL_POWDER"
      && defender.species === "Ditto") {
    defense *= 2;
  }
  // :3203-3204 Thick Fat -- halves the attacker's SpAttack against Fire/Ice.
  // Source touches spAttack only; every Fire and Ice move is special in Gen III,
  // so the category gate is redundant in practice and kept for exactness.
  if (!physical && defender.ability === "Thick Fat" && (move.type === "Fire" || move.type === "Ice")) {
    attack = Math.floor(attack / 2);
  }
  // :3205-3206 Hustle -- 1.5x Attack, unconditionally (its accuracy penalty
  // lives in the accuracy path, not here).
  if (physical && attacker.ability === "Hustle") {
    attack = Math.floor((150 * attack) / 100);
  }
  // :3211-3212 Guts -- 1.5x Attack while the user carries ANY major status.
  // Note this is separate from, and stacks with, Guts exempting the holder from
  // the burn halving further down.
  if (physical && attacker.ability === "Guts" && attackerStatus !== null) {
    attack = Math.floor((150 * attack) / 100);
  }
  // :3213-3214 Marvel Scale -- 1.5x Defense while the DEFENDER carries any
  // major status. Source modifies `defense`, so physical only.
  if (physical && defender.ability === "Marvel Scale" && defenderStatus !== null) {
    defense = Math.floor((150 * defense) / 100);
  }
  // :3215-3218 Mud Sport halves Electric power, Water Sport halves Fire power.
  // Both are set by EFFECT_MUD_SPORT / EFFECT_WATER_SPORT, which are still
  // unported (they sit in B2b's remaining list), so no reachable state can set
  // these yet -- default false, same stated convention as every other
  // not-yet-reachable flag in this file, and wired here so porting those two
  // effects is a state change rather than a hunt through the damage formula.
  if (mudSportActive && move.type === "Electric") power = Math.floor(power / 2);
  if (waterSportActive && move.type === "Fire") power = Math.floor(power / 2);
  // :3219-3226 Overgrow / Blaze / Torrent / Swarm -- 1.5x POWER (not the stat)
  // at hp <= floor(maxHP / 3), for their own type only.
  const pinchAbility = PINCH_ABILITY_TYPE[attacker.ability];
  if (pinchAbility === move.type) {
    const maxHp = attacker.stats.hp;
    const curHp = Math.round((attackerHpPct / 100) * maxHp);
    if (curHp <= Math.floor(maxHp / 3)) power = Math.floor((150 * power) / 100);
  }
  // :3229-3230 Explosion / Self-Destruct halve the DEFENDER's Defense. Keyed on
  // the effect, not the move name (the name check this replaced was hyphenated
  // and never matched -- see the note kept below).
  if (move.effect === "EFFECT_EXPLOSION") defense = Math.floor(defense / 2);

  // APPLY_STAT_MOD last, on the modified stats. Crits ignore a negative attack
  // stage and a positive defense stage (:3235-3243 / :3250-3258) -- the gate is
  // on the STAGE, which is why it is resolved here and not earlier.
  const atkStat = applyStatStage(attack, effAtkStage);
  const effDef = Math.max(1, applyStatStage(defense, effDefStage));
  // Phase D F32: `2 * attacker->level / 5` is INTEGER division in source
  // (src/pokemon.c:3246 / :3301); this used a float, so any level that is not a
  // multiple of 5 hit harder (Lv27: 12.8 for 12). Lv50 is unaffected.
  const levelTerm = Math.floor((2 * attacker.level) / 5) + 2;
  let preFinal = Math.floor(
    Math.floor(levelTerm * power * atkStat / effDef) / 50
  );

  // Burn: physical damage halved, UNLESS attacker has Guts (source-confirmed
  // ordering: this happens here, before the +2 and before STAB/type-calc,
  // and DOES apply to crits — nothing exempts crits from it).
  if (attackerBurned && physical && attacker.ability !== "Guts") {
    preFinal = Math.floor(preFinal / 2);
  }
  // Reflect/Light Screen: halves damage at this same pre-+2 stage (src/pokemon.c:3267-3273
  // physical, :3318-3324 special — same position in the formula for both,
  // right after burn/before the defending side's other computations). Crits
  // BYPASS this entirely (gCritMultiplier == 1 gate in source) — the caller
  // is responsible for only passing screenActive=true when !crit.
  if (screenActive) {
    preFinal = Math.floor(preFinal / 2);
  }
  // Rain/Sun: applies at this SAME pre-+2 stage, immediately after screen
  // halving (src/pokemon.c:3330-3362 — confirmed the weather block sits
  // right after the Light Screen/double-battle halving, before anything
  // else). Rain weakens Fire (/2) and boosts Water (x1.5); Sun boosts Fire
  // (x1.5) and weakens Water (/2). Only ever matters for Fire/Water moves,
  // which are always special-category in Gen III, so no separate category
  // gate is needed. `weather` here is the EFFECTIVE weather (already
  // Cloud-Nine/Air-Lock-checked by the caller via effectiveWeather()).
  if (weather === "rain") {
    if (move.type === "Fire") preFinal = Math.floor(preFinal / 2);
    else if (move.type === "Water") preFinal = Math.floor((15 * preFinal) / 10);
  } else if (weather === "sun") {
    if (move.type === "Fire") preFinal = Math.floor((15 * preFinal) / 10);
    else if (move.type === "Water") preFinal = Math.floor(preFinal / 2);
  }
  // Flash Fire: 1.5x the holder's own Fire-type damage, applied at this same
  // pre-STAB stage per source (inside CalculateBaseDamage, before the +2).
  if (attackerFlashFireActive && move.type === "Fire") {
    preFinal = Math.floor((15 * preFinal) / 10);
  }

  // B2b batch 9: Spit Up multiplies CalculateBaseDamage's OUTPUT by the
  // stockpile counter (Cmd_stockpiletobasedamage, src/battle_script_commands.c
  // :9002-9022) and only THEN runs typecalc, so the multiplier goes here --
  // after the +2, before STAB and type. Multiplying the final number instead
  // would floor in the wrong order and lose a few HP.
  // B6-2: Cmd_damagecalc (src/battle_script_commands.c:1296) multiplies by
  // gCritMultiplier HERE -- on CalculateBaseDamage's output, BEFORE typecalc
  // floors STAB and the type multipliers. This engine used to apply it after
  // those floors, which is a different integer whenever a floor bites.
  const critMult = crit ? 2 : 1;
  let base = (preFinal + 2) * baseMultiplier * critMult;

  const stab = untyped ? 1 : attacker.types.includes(move.type) ? 1.5 : 1;

  let dmg = Math.floor(base * stab);
  // F17: the type step row by row, as TypeCalc / Cmd_typecalc do (typeCalcRows).
  let noEffect = false;
  if (!untyped) ({ dmg, noEffect } = typeCalcRows(dmg, move.type, defender.types, defenderForesighted));
  // A2: `rollPercent`, when supplied, applies the roll as INTEGER arithmetic —
  // floor(dmg * r / 100) — matching source exactly. The AI's own damage
  // estimate does `gBattleMoveDamage * simulatedRNG[i] / 100` in u32 math
  // (src/battle_ai_script_commands.c:1211/:1760/:1789), so the engine must not
  // route it through a float fraction: 0.85 and friends are not exactly
  // representable, and Math.floor(dmg * (r/100)) can land one below
  // floor(dmg*r/100). (Same one-ULP class as the Body truncation in
  // sim-audit.md §3.3.) The float `rollFrac` path is UNCHANGED and remains what
  // the battle-damage path uses: 0.925, a LABELLED point estimate of the
  // 85-100 roll (amendment 15 -- enumerating it cost ~10x on top of crits).
  // Phase D F30: only a script that reaches adjustnormaldamage(2) rolls; one
  // that reaches adjustsetdamage alone does not (damage-adjust.js, generated).
  // Spit Up was the formula move rolled here without a roll in source. The
  // AI's estimate always takes simulatedRNG (AI_CalcDmg's callers).
  if (aiEstimate || !ROLL_EXEMPT(move.effect)) {
    dmg = rollPercent != null
      ? Math.floor((dmg * rollPercent) / 100)
      : Math.floor(dmg * rollFrac);
  }
  // F17: the AI's estimate is gBattleMoveDamage * simulatedRNG / 100 as TypeCalc
  // left it -- a x0 row followed by another leaves 1, so not 0 -- and every
  // consumer applies its own min-1 (Cmd_get_how_powerful_move_is :1212-1213,
  // Cmd_if_can_faint :1762-1764). The battle: a x0 row is
  // MOVE_RESULT_DOESNT_AFFECT_FOE, no damage; otherwise at least 1.
  if (aiEstimate) return dmg;
  if (noEffect) return 0;
  return Math.max(1, dmg);
}

// The bare-stats formula the engine used for the confusion self-hit until
// Phase D F19; kept (exported) as the record of that behaviour. The self-hit is
// confusionSelfHitDamage below.
function calcConfusionDamage(mon, rollFrac = 0.925) {
  const base = Math.floor(
    Math.floor(Math.floor((2 * mon.level / 5 + 2) * 40 * mon.stats.atk / mon.stats.def) / 50) + 2
  );
  return Math.max(1, Math.floor(base * rollFrac));
}

// Phase D F19: the confusion self-hit is CalculateBaseDamage(attacker,
// attacker, MOVE_POUND, sideStatus 0, power 40, type 0) (src/battle_util.c:2173)
// -- the WHOLE base chain on the mon's own numbers: its Attack stage against
// its own Defense stage, burn, Choice Band, Huge Power / Hustle / Guts, Marvel
// Scale on its own status, Silk Scarf (Pound is Normal). sideStatus 0: no
// Reflect. No typecalc runs, so no STAB and no type chart (untyped), and no
// critcalc. Then adjustnormaldamage2 (src/battle_script_commands.c:1701-1741):
// the 85-100 roll -- this engine's labelled 92.5% point estimate, as for every
// battle hit (amendment 15) -- and the mon's own Focus Band (below).
function confusionSelfHitDamage(ctx, s, actor) {
  const isYou = actor === "you";
  const mon = isYou ? ctx.you : ctx.opp;
  const stages = isYou ? s.youStages : s.oppStages;
  const status = s[isYou ? "youStatus" : "oppStatus"];
  return calcDamage(mon, mon, "Pound", {
    untyped: true, crit: false, screenActive: false,
    atkStage: stages.atk, defStage: stages.def,
    attackerStatus: status, defenderStatus: status, attackerBurned: status === "burn",
    attackerFlashFireActive: isYou ? s.youFlashFireActive : s.oppFlashFireActive,
    attackerHpPct: isYou ? s.yourHpPct : s.oppHpPct, defenderHpPct: isYou ? s.yourHpPct : s.oppHpPct,
    weather: effectiveWeather(s, ctx.you, ctx.opp),
    mudSportActive: vf(s, "youMudSport") || vf(s, "oppMudSport"),
    waterSportActive: vf(s, "youWaterSport") || vf(s, "oppWaterSport"),
    ...(typeof ctx.rollPercent === "number" ? { rollPercent: ctx.rollPercent } : {}), // F31
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 5. OPPONENT AI MOVE SELECTION (generic — works for any opponent mon as
//    long as every move in its set has an AI_HANDLERS entry, or is a plain
//    damaging move with no special effect)
//
//    IMPORTANT: several real AI_CV_* handlers (confirmed via source) contain
//    genuine internal randomness (if_random_less_than rolls) that affects
//    the SCORE ITSELF, not just whether the move gets picked afterward. The
//    real game rolls these dice once, computes concrete scores for all
//    candidate moves, THEN takes the argmax — so "which move wins" is a
//    random variable over the JOINT outcome of every candidate's internal
//    rolls, not just a tie-break over deterministic scores. checkViability
//    handlers therefore return a DISTRIBUTION — an array of
//    { p, delta } summing to 1 — instead of a single number. Handlers with
//    no live randomness just return a single-point distribution.
// ─────────────────────────────────────────────────────────────────────────

// Convolves two independent score-delta distributions into one (cross
// product of outcomes, probabilities multiplied, deltas summed).
function combineDist(a, b) {
  const out = [];
  for (const x of a) for (const y of b) out.push({ p: x.p * y.p, delta: x.delta + y.delta });
  return out;
}

// sIgnoredPowerfulMoveEffects (src/battle_ai_script_commands.c:266-281) — moves
// whose real table-stored power is a fixed placeholder (charge/recharge/self-
// KO/HP-cost moves with dynamically-computed real power). get_how_powerful_
// move_is exempts these on BOTH sides of its comparison: such a move is never
// penalized for "not being the strongest" itself, and never counts when
// checking whether some OTHER move in the set outguns the one being scored.
const IGNORED_POWERFUL_MOVE_EFFECTS = new Set([
  "EFFECT_EXPLOSION", "EFFECT_DREAM_EATER", "EFFECT_RAZOR_WIND", "EFFECT_SKY_ATTACK",
  "EFFECT_RECHARGE", "EFFECT_SKULL_BASH", "EFFECT_SOLAR_BEAM", "EFFECT_SPIT_UP",
  "EFFECT_FOCUS_PUNCH", "EFFECT_SUPERPOWER", "EFFECT_ERUPTION", "EFFECT_OVERHEAT",
]);

// Cmd_get_how_powerful_move_is's own eligibility gate: power > 1 (excludes
// status moves and the whole "power stored as 1, real power computed
// dynamically" family — Flail/Reversal/Counter/Mirror Coat/etc, matching
// real source's static table value) AND not on the ignored-effects list above.
function isPowerfulMoveEligible(moveName) {
  const m = MOVES[moveName];
  return !!m && m.power > 1 && !IGNORED_POWERFUL_MOVE_EFFECTS.has(m.effect);
}

// Phase D F1 -- the generic head of AI_CheckBadMove (data/battle_ai_scripts.s:
// 51-100), found by the emulator differential (Blaziken's Earthquake into a
// Levitate Latios: P 1 in the sim, never in the ROM). Two parts:
//
// AI_CBM_CheckIfNegatesType (:57-88), reached by Fissure and Horn Drill
// (if_move, :53-54) and by every move get_how_powerful_move_is does not call
// MOVE_POWER_OTHER -- its own power > 1 and sIgnoredPowerfulMoveEffects gate
// (src/battle_ai_script_commands.c:1174-1187), i.e. isPowerfulMoveEligible:
//   - if_type_effectiveness x0 -> -10. Cmd_if_type_effectiveness (:1515-1556)
//     reads TypeCalc's DAMAGE, not its flags (the non-BUGFIX build), so x0 is
//     exactly a zero type product: Levitate only sets flags in TypeCalc
//     (src/battle_script_commands.c:1554-1557) and is NOT x0 here -- it has its
//     own line below. Foresight lifts the Ghost row (the TYPE_FORESIGHT break).
//   - target Volt Absorb / Water Absorb / Flash Fire and the move's BASE type
//     (get_curr_move_type reads gBattleMoves) Electric / Water / Fire -> -12.
//   - target Wonder Guard unless if_type_effectiveness x2 -> -10. An EXACT
//     category: STAB SE (120) is requantised to x2 and passes, x4 does not.
//   - target Levitate and a Ground move -> -10.
// AI_CheckBadMove_CheckSoundproof (:89-100), reached by EVERY move: target
//   Soundproof and one of the nine moves the script lists -> -10. (Nine: the
//   battle's sSoundMovesTable also has Hyper Voice, which the AI list omits.)
//
// Score_Minus10 / Score_Minus12 (:620-626) end with `end`, which ends
// AI_CheckBadMove for this move (Cmd_end, :2209-2213; the processing loop moves
// on to the next script, :602-611) -- so a nonzero head result means the
// effect's own AI_CBM_* is never reached. TryToFaint and CheckViability are
// separate scripts and still run.
//
// targetAbility is what get_ability AI_TARGET returns; see finding F2.
const AI_SOUNDPROOF_MOVES = new Set([
  "Growl", "Roar", "Sing", "Supersonic", "Screech", "Snore", "Uproar", "Metal Sound", "GrassWhistle",
]);
for (const m of AI_SOUNDPROOF_MOVES) if (!MOVES[m]) throw new Error(`AI_SOUNDPROOF_MOVES names unknown move "${m}"`);
const AI_ABSORB_TYPE = { "Volt Absorb": "Electric", "Water Absorb": "Water", "Flash Fire": "Fire" };
// F2a: the whole of AI_CheckBadMove as one distribution -- the head's read,
// the Soundproof check's own read, then `rest()` (the effect's own AI_CBM_*,
// reached only on paths where neither ended the script).
function checkBadMoveChain(moveName, ctx, rest) {
  const soundproof = () => taRead(ctx, (a) =>
    (a === "Soundproof" && AI_SOUNDPROOF_MOVES.has(moveName) ? -10 : rest()));
  if (moveName === "Fissure" || moveName === "Horn Drill" || isPowerfulMoveEligible(moveName)) {
    const type = MOVES[moveName].type;
    const eff = typeEffectiveness(type, ctx.targetTypes, ctx.targetForesighted);
    if (eff === 0) return -10;
    return taRead(ctx, (ability) => {
      if (AI_ABSORB_TYPE[ability] !== undefined) {
        if (AI_ABSORB_TYPE[ability] === type) return -12;
      } else if (ability === "Wonder Guard") {
        if (eff !== 2) return -10;
      } else if (ability === "Levitate") {
        if (type === "Ground") return -10;
      }
      return soundproof();
    });
  }
  return soundproof();
}

// Returns the move's full score distribution: [{ p, score }], summing to 1.
// B7c-4. SOURCE CHECK FIRST, and it changed the disposition.
//
// The AI's `if_target_faster` is `if_user_goes 1`
// (asm/macros/battle_ai_script.inc:595-597), which is Cmd_if_user_goes
// (src/battle_ai_script_commands.c:1268-1274) calling
// GetWhoStrikesFirst(sBattler_AI, gBattlerTarget, TRUE) -- THE SAME FUNCTION
// the battle's own turn order uses, uncached, once per instruction executed.
//
// With ignoreChosenMoves = TRUE both moves are MOVE_NONE, whose priority is 0
// (src/data/battle_moves.h), so it takes the both-priorities-zero arm at
// src/battle_main.c:4744-4750 -- which is `if (speedBattler1 == speedBattler2
// && Random() & 1) strikesFirst = 2`. So on an EXACT tie the AI's own belief is
// a coin flip in the real game too.
//
// That makes this a FIX, not a Cloud-Nine-style asymmetry to preserve: the
// engine was deterministic where source rolls. But the asymmetry it produces IS
// real and IS preserved -- the AI's draw and the battle's order draw are
// SEPARATE Random() calls, so on a tie the AI can believe it moves first and
// then move second. Those two must stay independent, and they do: this branch
// lives in the scoring, and resolveTurn's tie branch is its own.
//
// Independence per MOVE is also source-exact. Each executed if_target_faster is
// its own roll, no handler in this engine executes more than one per call
// (EFFECT_BATON_PASS has two reads but in mutually exclusive arms), and
// chooseOpponentMoves already takes the Cartesian product across the four
// moves' distributions -- so four independent rolls fall out of the existing
// structure rather than needing to be arranged.
function scoreOpponentMoveDist(user, target, moveName, ctx) {
  if (ctx.speedTied) {
    const base = { ...ctx, speedTied: false };
    const faster = scoreOpponentMoveDist(user, target, moveName, { ...base, targetFaster: true });
    const slower = scoreOpponentMoveDist(user, target, moveName, { ...base, targetFaster: false });
    return [
      ...faster.map((d) => ({ ...d, p: d.p * 0.5 })),
      ...slower.map((d) => ({ ...d, p: d.p * 0.5 })),
    ];
  }
  const move = MOVES[moveName];
  if (!move) throw new Error(`Move "${moveName}" not in MOVES — add its data before using it.`);
  const handler = AI_HANDLERS[move.effect];

  if (move.power === 0 && !handler && !AI_NO_DISPATCH_EFFECTS.has(move.effect)) {
    throw new Error(`"${moveName}" (effect: ${move.effect}) is a status move with no AI handler — port its ` +
      `AI_CBM_*/AI_CV_* logic from battle_ai_scripts.s before an opponent can use it.`);
  }
  if (SILENT_FALLTHROUGH_EFFECTS.has(move.effect) && !handler) {
    throw new Error(`"${moveName}" (effect: ${move.effect}) has a non-generic damage mechanic with no ` +
      `dedicated AI handler yet — scoring it via the generic power-based path (AI_TryToFaint's simDmg check ` +
      `included) would silently use a near-meaningless damage estimate off its move-data.js placeholder power ` +
      `(same bug class as the historical EFFECT_OHKO bug, see HANDOFF.md §10). Port it before an opponent can use it.`);
  }

  let dist = [{ p: 1, delta: 100 }]; // baseline

  // Per-move ctx: same shared ctx object, plus the current move's type (needed
  // by handlers like EFFECT_PARALYZE that run a real type-chart check against
  // the move actually being scored — ctx itself is built once per opponent
  // moveset in chooseOpponentMoves, so it can't carry a single move's type).
  // moveName added in batch 2 for AI_CV_SpeedDownFromChance's if_move gate
  // (EFFECT_SPEED_DOWN_HIT is the first handler that must key on move
  // identity, not effect — see its handler comment).
  const moveCtx = { ...ctx, moveType: move.type, moveName };

  // AI_CheckBadMove as one distribution (Phase D F1 head, F2a reads): the
  // head and the Soundproof check each end the script on a hit, so the
  // effect's own AI_CBM_* runs only on the paths that reach it. A handler may
  // return a scalar or a [{p, delta}] distribution (Attract's gender, every
  // get_ability read over a two-ability species).
  dist = combineDist(dist, asDist(checkBadMoveChain(moveName, moveCtx,
    () => (handler?.checkBadMove ? handler.checkBadMove(moveCtx) : 0))));

  // AI_TryToFaint — generic, applies to any damaging move (data/battle_ai_scripts.s:2616-2622).
  if (move.power > 0) {
    // A2: the AI's simulated damage uses THIS DECISION'S roll for THIS move
    // slot, not a fixed midpoint. `ctx.aiRolls` is the enumerated assignment
    // supplied by chooseOpponentMoves (see AI_SIM_ROLLS). Missing it is a hard
    // error, never a silent fallback to the old 0.925 collapse — constraint 4.
    if (!ctx.aiRolls) {
      throw new Error(`scoreOpponentMoveDist requires ctx.aiRolls (the enumerated AI damage-roll ` +
        `assignment) for damaging move "${moveName}". Call it through chooseOpponentMoves, which ` +
        `enumerates the rolls; scoring a damaging move against a single collapsed roll is the ` +
        `A2 defect and is no longer reachable.`);
    }
    const myRoll = ctx.aiRolls[moveName];
    const aiState = requireAiDamageState(ctx, "scoreOpponentMoveDist");
    // LAZY, and that is source-exact rather than an optimisation. Both consumers
    // of this estimate are gated on power > 1 -- Cmd_if_can_faint returns the
    // non-KO branch for `power < 2` BEFORE calling AI_CalcDmg
    // (src/battle_ai_script_commands.c:1743-1750), and
    // Cmd_get_how_powerful_move_is has the same eligibility gate -- so source
    // never computes it for a power-1 move at all. Computing it eagerly was
    // harmless until batch 5: the variable-damage family is power 1 and now
    // demands an enumerated draw that the AI, correctly, has no way to supply.
    let simDmgMemo;
    const simDmg = () => (simDmgMemo === undefined
      ? (simDmgMemo = aiCalcDamage(user, target, moveName, aiState, myRoll))
      : simDmgMemo);
    const targetHp = ctx.targetHp ?? Math.round((ctx.targetHpPct / 100) * target.stats.hp);
    // Cmd_if_can_faint (src/battle_ai_script_commands.c:1743-1750) opens with
    // `if (power < 2) { /* always take the non-KO branch */ }`, BEFORE ever
    // calling AI_CalcDmg — a move whose STATIC TABLE power is the 1-placeholder
    // (Counter/Mirror Coat/Flail/Reversal/Night Shade/Seismic Toss/OHKO/etc.)
    // never gets a real damage computation here, no matter how lethal its true
    // dynamically-computed damage would be. `move.power > 1` is the exact
    // complement of `power < 2` for integers — no off-by-one.
    //
    // This gate belongs HERE, on the KO check specifically, and must NOT be
    // hoisted onto the enclosing `if (move.power > 0)` block above. Source's
    // power<2 exemption is local to Cmd_if_can_faint alone — the sibling
    // AI_TryToFaint_DoubleSuperEffective x4-effectiveness bonus just below
    // (battle_ai_scripts.s:2624-2627) runs completely ungated by power, and
    // Cmd_get_how_powerful_move_is's own power>1 gate (mirrored by
    // isPowerfulMoveEligible above) only suppresses the -1 "not most
    // powerful" penalty, never the x4 bonus check. Gating the outer block
    // instead of this inner condition would silently suppress a bonus source
    // actually grants to power-1 moves — a real divergence a prior proposal
    // in this series would have introduced by "simplifying" the fix upward.
    if (move.power > 1 && Math.max(1, simDmg()) >= targetHp /* Cmd_if_can_faint clamps first, :1762-1764 */) {
      // AI_TryToFaint_TryToEncourageQuickAttack (battle_ai_scripts.s:2629-2636).
      if (move.effect === "EFFECT_EXPLOSION") {
        // :2630 `if_effect EFFECT_EXPLOSION, AI_TryToFaint_End` jumps straight
        // past BOTH the +2 Quick-Attack stack and the +4 ScoreUp4, landing on a
        // bare `end` — no score command ever runs. Intentionally NOT a
        // combineDist({p:1,delta:0}) call: source doesn't score a zero here, it
        // skips the scoring construct entirely, and the two are behaviorally
        // identical in this dist model anyway, so there's nothing to gain by
        // manufacturing a fake branch.
        //
        // COUNTERINTUITIVE BUT SOURCE-CORRECT — DO NOT "FIX" THIS: a guaranteed
        // kill via Explosion scores WORSE from AI_TryToFaint than a non-lethal
        // one. The KO branch and the non-KO branch (x4-effectiveness roll,
        // :2624-2627) are mutually exclusive — once if_can_faint is true for
        // Explosion, it can NEVER reach the x4 roll either, even if the hit is
        // also x4-effective. A merely-x4-effective, non-lethal Explosion can
        // still land +2; a lethal one gets nothing. This is a real asymmetry in
        // the shipped AI, not an oversight in this port — same standard as the
        // non-BUGFIX Counter6 note in change #5: reproduce it, don't correct it.
      } else if (move.effect === "EFFECT_QUICK_ATTACK") {
        // :2631-2634 falls through score+2 THEN score+4 (ScoreUp4) with no
        // jump between them — additive, +6 total, not a +2-vs-+4 alternative.
        dist = combineDist(dist, [{ p: 1, delta: 6 }]);
      } else {
        // Everything else lands on ScoreUp4 directly (either via :2631's jump,
        // or having never been Explosion in the first place): the plain +4.
        dist = combineDist(dist, [{ p: 1, delta: 4 }]);
      }
    } else {
      // Move can't already secure the KO — get_how_powerful_move_is, THEN
      // (mutually exclusive with the penalty below) the x4-effectiveness
      // bonus. Real source reaches the x4 check whenever the considered move
      // is NOT flagged MOVE_NOT_MOST_POWERFUL — which includes both "is
      // eligible and truly the strongest (or tied)" AND "was never eligible
      // to begin with" (power<=1 or an ignored effect) — so the penalty is
      // gated on eligibility but the bonus check never is.
      let notMostPowerful = false;
      if (isPowerfulMoveEligible(moveName)) {
        // Cmd_get_how_powerful_move_is floors a 0 (type-immune) simulated
        // damage up to 1 for THIS comparison specifically — a distinct
        // quirk from the real battle-damage 0-floor bug already fixed
        // elsewhere in this file (see calcDamage's own eff===0 early
        // return, which must NOT be touched) — replicated here on top of
        // calcDamage's real number, not as a separate proxy calculation.
        const myDmg = Math.max(1, simDmg());
        notMostPowerful = user.moves.some((rivalMove) => {
          if (rivalMove === moveName || !isPowerfulMoveEligible(rivalMove)) return false;
          // A2: each rival is compared at ITS OWN slot's roll — source indexes
          // simulatedRNG[checkedMove] inside the comparison loop
          // (src/battle_ai_script_commands.c:1211), so the four estimates in one
          // decision are drawn independently but each is fixed for that decision.
          const rivalDmg = Math.max(1, aiCalcDamage(user, target, rivalMove, aiState, ctx.aiRolls[rivalMove]));
          return rivalDmg > myDmg;
        });
      }
      if (notMostPowerful) {
        dist = combineDist(dist, [{ p: 1, delta: -1 }]);
      } else {
        // AI_TryToFaint_DoubleSuperEffective: if_random_less_than 80 jumps
        // AWAY (no bonus) when the roll is < 80/256 — so the +2 actually
        // fires on the complementary (256-80)/256 ≈ 68.75% of rolls, not
        // 80/256 (confirmed against Cmd_if_random_less_than's real
        // semantics: jumps on TRUE, `if_random_less_than 80` fires <80/256
        // of the time, so scoring code that falls through without jumping
        // runs the other ~176/256) — corrects §4's stale "80/256" note.
        const eff = typeEffectiveness(move.type, target.types);
        if (eff === 4) {
          dist = combineDist(dist, [{ p: 80 / 256, delta: 0 }, { p: 176 / 256, delta: 2 }]);
        }
      }
    }
  }

  if (handler?.checkViability) {
    const result = handler.checkViability(moveCtx);
    const viabilityDist = Array.isArray(result) ? result : [{ p: 1, delta: result }];
    dist = combineDist(dist, viabilityDist);
  }

  // Merge identical scores (keeps the distribution small after convolution).
  const bucketed = new Map();
  for (const { p, delta } of dist) {
    bucketed.set(delta, (bucketed.get(delta) || 0) + p);
  }
  return [...bucketed.entries()].map(([score, p]) => ({ p, score }));
}

// Backward-compatible scalar version (expected value) — used only where a
// single representative number is genuinely fine (e.g. debug printouts),
// NEVER for move selection (see chooseOpponentMoves).
function scoreOpponentMove(user, target, moveName, ctx) {
  // A2: a damaging move has no single score any more — it depends on the
  // decision's roll assignment. Average over the enumerated classes rather than
  // picking a representative roll, so this stays a faithful expectation instead
  // of quietly reintroducing the collapse it exists downstream of. Callers that
  // already hold an assignment can pass it in ctx.aiRolls and skip the mixture.
  if (ctx.aiRolls) {
    const dist = scoreOpponentMoveDist(user, target, moveName, ctx);
    return dist.reduce((sum, { p, score }) => sum + p * score, 0);
  }
  let expected = 0;
  for (const { p: rollP, rolls } of enumerateAiRollOutcomes(user, target, ctx)) {
    const dist = scoreOpponentMoveDist(user, target, moveName, { ...ctx, aiRolls: rolls });
    expected += rollP * dist.reduce((sum, { p, score }) => sum + p * score, 0);
  }
  return expected;
}


// ── A2: the AI's simulated-damage roll ──────────────────────────────────────
// BattleAI_SetupAIData (src/battle_ai_script_commands.c:312) draws, ONCE PER AI
// DECISION and independently PER MOVE SLOT:
//     AI_THINKING_STRUCT->simulatedRNG[i] = 100 - (Random() % 16);   // :341
// i.e. four iid draws uniform over {85..100}. Every consumer inside that one
// decision reads the SAME array:
//   * Cmd_get_how_powerful_move_is   :1211  simulatedRNG[checkedMove]
//   * Cmd_if_can_faint               :1760  simulatedRNG[movesetIndex]
//   * Cmd_if_cant_faint              :1789  simulatedRNG[movesetIndex]
// and it is applied AFTER type effectiveness (AI_CalcDmg ->
// src/battle_script_commands.c:1306 computes the base damage, TypeCalc scales
// it, then the AI multiplies by simulatedRNG/100), which is where calcDamage's
// own roll sits too — so the placement matches; only the VALUE was collapsed.
//
// The engine previously hardcoded the 0.925 midpoint at both sites. That is the
// A2 defect: the KO verdict it drives is worth +4, the single largest delta in
// the whole AI, so collapsing it turned a coin-flip into a certainty.
const AI_SIM_ROLLS = [85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100];

// Enumerates the roll assignments as weighted classes (constraint 3: chance is
// enumerated, never sampled). Returns [{ p, rolls }] where `rolls` maps every
// move name to an integer roll and the entries' p sum to 1.
//
// Two exact reductions keep this affordable:
//
//  1. Only power>1 moves can change anything. A move's roll is read for its own
//     KO check (gated `power > 1`, mirroring Cmd_if_can_faint's `if (power < 2)`
//     early-out) and for the get_how_powerful comparison (gated by
//     isPowerfulMoveEligible). A power<=1 move's roll is drawn in source and
//     never read, so it collapses out exactly; it is pinned to 85 here.
//
//  2. Damage is monotone non-decreasing in the roll — the roll enters as a
//     single floor(dmg * r / 100) at the very end — so evaluating r=85 and
//     r=100 BRACKETS every value. If, for every relevant move, both the KO
//     verdict and the "is this the most powerful move" verdict are the same at
//     both ends, they are the same for all 16^k assignments and one
//     representative assignment reproduces them exactly (fast path).
//
// Otherwise the assignments are enumerated and BUCKETED by the resulting
// (KO, notMostPowerful) vector, so the handler machinery downstream runs once
// per distinct outcome class rather than once per assignment.
// Memo for enumerateAiRollOutcomes. The expensive part is the bucketing loop,
// and its inputs barely move inside one matchup: the AI's damage estimate is a
// pure function of (attacker, defender, move, roll), so the whole 16-roll damage
// table is constant for a matchup and only `targetHp` varies.
//
// KNOWN DEFECT THE KEY DEFENDS AGAINST (found while building this memo, not yet
// assigned a phase item — see arena-solver/docs/fidelity-log.md A2 flags):
// source's AI damage estimate DOES see stat stages. AI_CalcDmg
// (src/battle_script_commands.c:1306) passes &gBattleMons[attacker] /
// [defender] into CalculateBaseDamage, which applies APPLY_STAT_MOD from
// mon->statStages (src/pokemon.c:3237-3257). This engine's AI call sites pass no
// stage/weather/burn arguments, so its estimate is state-blind. That is a real
// fidelity gap, orthogonal to A2 (A2 is about the ROLL, not the inputs).
// The cache key therefore includes the state a CORRECTED damage model would
// read, so this memo stays exact after that gap is closed rather than silently
// baking in the current blindness. Extra key fields only cost cache misses.
const _aiRollClassCache = new WeakMap();

// A9: the state the AI's own damage estimate is entitled to see. Source's
// AI_CalcDmg (src/battle_script_commands.c:1306) passes the LIVE
// &gBattleMons[attacker] / [defender] and the DEFENDER's gSideStatuses into
// CalculateBaseDamage, so the AI's estimate is subject to:
//   * stat stages   — APPLY_STAT_MOD, src/pokemon.c:3243 (physical) / :3293
//                     (special). The `> DEFAULT_STAT_STAGE` conditionals at
//                     :3237/:3251 are CRIT-ONLY, and the AI always evaluates
//                     non-crit: gCritMultiplier = 1 is set immediately before
//                     every AI damage call (battle_ai_script_commands.c:1192
//                     get_how_powerful_move_is, :1755 if_can_faint, :1784
//                     if_cant_faint). So the unconditional branch is the one
//                     that applies here.
//   * burn          — src/pokemon.c:3263-3264, Guts-exempt.
//   * Reflect/Light Screen — :3267 / the special-branch mirror, both gated on
//                     `gCritMultiplier == 1`, i.e. live for the AI. It is the
//                     DEFENDER's side status, so the player's screens.
//   * weather       — :3331 WEATHER_HAS_EFFECT2. NOTE the asymmetry this
//                     creates and which is faithfully preserved: the AI's
//                     DAMAGE respects Cloud Nine / Air Lock suppression, while
//                     the AI's `get_weather` SCORING command does not (it reads
//                     gBattleWeather raw — see ctx.currentWeather). Damage uses
//                     effectiveWeather; the handlers keep the raw value.
//   * Flash Fire    — :3366.
// The engine previously passed NONE of this, so the modelled AI mis-estimated
// its own damage exactly after a Double Team / Calm Mind / screen sequence.
// Exported (see the export block below) so tools cannot hand-build this object:
// a hand-built ctx is what silently broke bench-a2's fast/slow accounting when
// A9 added it (amendment 10).
function buildAiDamageState(state, opp, you) {
  return {
    atkStage: state.oppStages.atk, spaStage: state.oppStages.spa,
    defStage: state.youStages.def, spdStage: state.youStages.spd,
    attackerBurned: state.oppStatus === "burn",
    attackerFlashFireActive: state.oppFlashFireActive,
    attackerHpPct: state.oppHpPct,
    targetReflect: state.youReflectTurns != null,
    targetLightScreen: state.youLightScreenTurns != null,
    targetForesighted: state.youForesighted, // B2b: the AI's own damage estimate sees it too (A9 defect class)
    // B7: Guts / Marvel Scale read status1 on either side. Same A9 reasoning --
    // an AI whose damage estimate cannot see a modifier the battle applies is
    // wrong in exactly the direction that matters.
    attackerStatus: state.oppStatus, defenderStatus: state.youStatus,
    weather: effectiveWeather(state, you, opp),
  };
}

// The single damage call the AI model uses, everywhere. Category picks which
// stage pair and which screen apply, exactly as the battle path does in
// applyMove.
function aiCalcDamage(user, target, moveName, st, rollPercent) {
  const physical = MOVES[moveName].category === "physical";
  return calcDamage(user, target, moveName, {
    rollPercent,
    atkStage: physical ? st.atkStage : st.spaStage,
    defStage: physical ? st.defStage : st.spdStage,
    attackerBurned: st.attackerBurned,
    attackerFlashFireActive: st.attackerFlashFireActive,
    attackerHpPct: st.attackerHpPct,
    screenActive: physical ? st.targetReflect : st.targetLightScreen,
    weather: st.weather,
    defenderForesighted: st.targetForesighted,
    attackerStatus: st.attackerStatus, defenderStatus: st.defenderStatus,
    // SOURCE-EXACT, and an asymmetry worth naming: during AI evaluation
    // gDynamicBasePower is 0 (src/battle_ai_script_commands.c:1188, :1472,
    // :1519, :1751, :1780), and every dynamic-power command -- magnitudedamage-
    // calculation, weightdamagecalculation, scaledamagebyhealthratio,
    // presentdamagecalculation -- runs in the BATTLE SCRIPT, never in the AI.
    // CalculateBaseDamage therefore falls back to the move table's own power for
    // the estimate. The visible consequence is Eruption: the AI values it at a
    // flat 150 no matter how hurt the user is, while the battle scales it with
    // HP. Preserved, like the Cloud Nine and speed-tie asymmetries, not "fixed".
    aiEstimate: true,
  });
}

function requireAiDamageState(ctx, where) {
  if (!ctx.aiDamageState) {
    throw new Error(`${where} requires ctx.aiDamageState (the live state the AI's damage estimate ` +
      `sees — stages/burn/screens/weather, see buildAiDamageState). A state-blind AI damage ` +
      `estimate is the A9 defect and is no longer reachable.`);
  }
  return ctx.aiDamageState;
}

function aiRollCacheKey(st, targetHp, hpRelevant, pinch = false) {
  // Every field the damage table can depend on. attackerHpPct is included ONLY
  // when a tabulated move actually reads it (Flail/Reversal, via
  // getFlailPower) — today never, since the table is power>1 and both are
  // power 1 — because HP changes on almost every branch and would otherwise
  // reduce the memo to a no-op. The flag keeps this correct if that ever
  // changes rather than relying on the coincidence.
  // C2 (found by the full grid): the key must name EVERY field
  // buildAiDamageState hands aiCalcDamage. B2b added targetForesighted and B7
  // added the two statuses (Guts, Marvel Scale) to the state without adding
  // them here, so a position differing only in those reused another's table --
  // and the AI's choice depended on which position the search reached first.
  return [targetHp, st.atkStage, st.spaStage, st.defStage, st.spdStage,
    st.attackerBurned, st.attackerFlashFireActive, st.targetReflect,
    st.targetLightScreen, st.weather, hpRelevant ? st.attackerHpPct : 0,
    st.targetForesighted, st.attackerStatus, st.defenderStatus,
    // ...and the pinch abilities (Blaze/Torrent/Overgrow/Swarm), which read the
    // attacker's HP: only whether it is at or below maxHP/3 matters.
    pinch].join("|");
}

const HP_DEPENDENT_POWER_MOVES = new Set(["Flail", "Reversal"]); // getFlailPower's only readers

// B2: Taunt removes status moves from the SELECTION set for its duration
// (CheckMoveLimitations' MOVE_LIMITATION_TAUNT, consulted by
// BattleAI_SetupAIData at src/battle_ai_script_commands.c:334-340 and by the
// player's own move menu). A battler with nothing legal left uses Struggle,
// which this engine does not model at all -- so that case throws by name rather
// than silently letting a taunted mon keep using status moves.
// B2b batch 2: CheckMoveLimitations (src/battle_util.c:1095-1122), in source's
// own order. This replaces tauntLegalMoves, which was one clause of it.
//
// Source checks, in this order, and a move failing ANY of them is unselectable:
//   PP == 0                     NOT modelled -- PP is not tracked and 3 turns
//                               cannot exhaust it (stated, not silently skipped)
//   :1104 Disable               moves[i] == disabledMove
//   :1107 Torment               moves[i] == gLastMoves[battler] && STATUS2_TORMENT
//   :1110 Taunt                 tauntTimer && power == 0
//   :1113 Imprison              GetImprisonedMovesCount -- the OPPOSING side has
//                               STATUS3_IMPRISONED_OTHERS and knows this move
//   :1116 Encore                encoreTimer && encoredMove != moves[i]
//   :1119 Choice Band           choicedMove set && != moves[i]
//
// If everything is unusable source falls back to Struggle (AreAllMovesUnusable,
// :1125-1140). Struggle is not modelled, so that throws with the CAUSE named --
// silently returning an empty list would make the position quietly unsolvable.
function selectableMoves(moves, s, side, foeMon, who) {
  const isYou = side === "you";
  const disabled = isYou ? s.youDisabledMove : s.oppDisabledMove;
  const encored = isYou ? s.youEncoredMove : s.oppEncoredMove;
  const tormented = isYou ? s.youTormented : s.oppTormented;
  const lastMove = isYou ? s.youLastMove : s.oppLastMove;
  const tauntTurns = isYou ? s.youTauntTurns : s.oppTauntTurns;
  const choiceLock = isYou ? s.youChoiceLock : s.oppChoiceLock;
  // Imprison is asymmetric: the FOE holds the flag and it blocks moves the FOE
  // knows. GetImprisonedMovesCount walks the other side's moveset, not ours.
  const foeImprisoning = isYou ? s.oppImprisoning : s.youImprisoning;
  const foeKnows = foeImprisoning ? new Set(foeMon.moves) : null;

  const reasons = [];
  const legal = moves.filter((m) => {
    const md = MOVES[m];
    if (!md) return false;
    if (disabled && m === disabled) { reasons.push(`${m}: disabled`); return false; }
    if (tormented && lastMove && m === lastMove) { reasons.push(`${m}: tormented`); return false; }
    if (tauntTurns != null && md.power === 0) { reasons.push(`${m}: taunted`); return false; }
    if (foeKnows && foeKnows.has(m)) { reasons.push(`${m}: imprisoned`); return false; }
    if (encored && m !== encored) { reasons.push(`${m}: encored into ${encored}`); return false; }
    if (choiceLock && m !== choiceLock) { reasons.push(`${m}: Choice-locked into ${choiceLock}`); return false; }
    return true;
  });

  if (legal.length === 0) {
    // B2b batch 11: STRUGGLE. Source falls back to it when every move is
    // unusable (AreAllMovesUnusable, src/battle_util.c:1125-1140), and this
    // engine used to throw here instead. It became REACHABLE in batch 10: Trick
    // can hand the PLAYER a Choice Band, and a mon Choice-locked into a move
    // that is then disabled or tormented has nothing else. 23 cells.
    //
    // Struggle is already in the move table (50 power, Normal, EFFECT_RECOIL),
    // so the fallback is the selection rule, not a new move.
    return ["Struggle"];
  }
  return legal;
}

function enumerateAiRollOutcomes(opp, you, ctx) {
  const st = requireAiDamageState(ctx, "enumerateAiRollOutcomes");
  const targetHp = ctx.targetHp ?? Math.round((ctx.targetHpPct / 100) * you.stats.hp);
  const relevant = opp.moves.filter((m) => MOVES[m] && MOVES[m].power > 1);
  const hpRelevant = relevant.some((m) => HP_DEPENDENT_POWER_MOVES.has(m));
  let byYou = _aiRollClassCache.get(opp);
  if (!byYou) { byYou = new WeakMap(); _aiRollClassCache.set(opp, byYou); }
  let byKey = byYou.get(you);
  if (!byKey) { byKey = new Map(); byYou.set(you, byKey); }
  const pinch = PINCH_ABILITY_TYPE[opp.ability] != null
    && Math.round((st.attackerHpPct / 100) * opp.stats.hp) <= Math.floor(opp.stats.hp / 3);
  const cacheKey = aiRollCacheKey(st, targetHp, hpRelevant, pinch);
  const cached = byKey.get(cacheKey);
  if (cached) return cached;
  const computed = computeAiRollOutcomes(opp, you, st, targetHp, relevant);
  byKey.set(cacheKey, computed);
  return computed;
}

function computeAiRollOutcomes(opp, you, st, targetHp, relevant) {
  const pin = (r) => Object.fromEntries(opp.moves.map((m) => [m, r]));

  if (relevant.length === 0) return [{ p: 1, rolls: pin(85) }];

  // Per-move damage at every roll (monotone, so [0] is the min and [15] the max).
  const dmg = new Map();
  for (const m of relevant) {
    dmg.set(m, AI_SIM_ROLLS.map((r) => aiCalcDamage(opp, you, m, st, r)));
  }
  const eligible = relevant.filter((m) => isPowerfulMoveEligible(m));
  const D = (m, i) => Math.max(1, dmg.get(m)[i]);

  // --- fast-path test -------------------------------------------------------
  let invariant = true;
  for (const m of relevant) {
    const lo = dmg.get(m)[0], hi = dmg.get(m)[AI_SIM_ROLLS.length - 1];
    if ((Math.max(1, lo) >= targetHp) !== (Math.max(1, hi) >= targetHp)) { invariant = false; break; }
  }
  if (invariant) {
    for (const m of eligible) {
      const myLo = D(m, 0), myHi = D(m, AI_SIM_ROLLS.length - 1);
      const others = eligible.filter((j) => j !== m);
      const alwaysNotMost = others.some((j) => D(j, 0) > myHi);
      const neverNotMost = others.every((j) => D(j, AI_SIM_ROLLS.length - 1) <= myLo);
      if (!alwaysNotMost && !neverNotMost) { invariant = false; break; }
    }
  }
  if (invariant) return [{ p: 1, rolls: pin(85) }];

  // --- exact enumeration, bucketed by outcome class -------------------------
  const n = AI_SIM_ROLLS.length;
  const total = n ** relevant.length;
  const buckets = new Map();
  const idx = new Array(relevant.length).fill(0);
  for (let a = 0; a < total; a++) {
    let rem = a;
    for (let k = 0; k < relevant.length; k++) { idx[k] = rem % n; rem = (rem - idx[k]) / n; }

    // notMostPowerful_m is exactly "D_m is below the max over the eligible set"
    // — a strict `>` comparison, so ties count as most-powerful.
    let maxD = -Infinity;
    for (const m of eligible) {
      const v = D(m, idx[relevant.indexOf(m)]);
      if (v > maxD) maxD = v;
    }
    let key = "";
    for (let k = 0; k < relevant.length; k++) {
      const m = relevant[k];
      const ko = Math.max(1, dmg.get(m)[idx[k]]) >= targetHp ? 1 : 0;
      const notMost = eligible.includes(m) && D(m, idx[k]) < maxD ? 1 : 0;
      key += ko + "" + notMost;
    }
    let b = buckets.get(key);
    if (!b) {
      b = { count: 0, rolls: pin(85) };
      for (let k = 0; k < relevant.length; k++) b.rolls[relevant[k]] = AI_SIM_ROLLS[idx[k]];
      buckets.set(key, b);
    }
    b.count++;
  }
  return [...buckets.values()].map((b) => ({ p: b.count / total, rolls: b.rolls }));
}

// Returns [{ move, prob }] — the real probability distribution over which
// move the AI ends up picking, accounting for each candidate's own internal
// scoring randomness (see scoreOpponentMoveDist). Replaces the old
// "just take the deterministic argmax" approach, which silently assumed
// away real randomness that's actually part of several handlers.
// B6-1b: the AI reads HP as source's `(u32)(100 * hp / maxHP)` -- an INTEGER,
// truncated (Cmd_if_hp_less_than / _more_than / _equal / _not_equal,
// src/battle_ai_script_commands.c:713-780). The engine used to hand it the
// float percentage, so a mon on 70.5% was "above 70" here and at 70 in the ROM.
function aiHpPercent(pct, maxHp) {
  const hp = Math.round((pct * maxHp) / 100);
  return Math.floor((100 * hp) / maxHp);
}
// ── Phase D F13: the AI as the ROM runs it ──────────────────────────────────
// buildAiView renders engine state as the numbers the ROM's AI reads (ids from
// ai-program.js's AI_CONST: moves, effects, types, abilities, items, and the
// STATUS1/2/3 / SIDE_STATUS / B_WEATHER bits the scripts test);
// chooseOpponentMovesInterp runs ai-interpreter.js over it for every A2 roll
// class. `knowledge.history` selects what the AI knows of the player's moves:
// "moveset" (the handlers' assumption, for the parity check) or the real
// BATTLE_HISTORY once F2c lands.
const AIK = AI_CONST;
const aiNorm = (s) => String(s).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const AI_MOVE_ID = new Map(Object.entries(AIK).filter(([k]) => k.startsWith("MOVE_") && !k.startsWith("MOVE_RESULT_")
  && !k.startsWith("MOVE_POWER_") && !k.startsWith("MOVE_TARGET_") && !k.startsWith("MOVE_MOST") && !k.startsWith("MOVE_NOT")
  && !k.startsWith("MOVE_EFFECT_") && !k.startsWith("MOVE_LIMITATION")).map(([k, v]) => [aiNorm(k.slice(5)), v]));
const AI_ABILITY_ID = new Map(Object.entries(AIK).filter(([k]) => k.startsWith("ABILITY_")).map(([k, v]) => [aiNorm(k.slice(8)), v]));
const aiMoveId = (name) => {
  if (name == null) return 0;
  const v = AI_MOVE_ID.get(aiNorm(name));
  if (v === undefined) throw new Error(`buildAiView: no MOVE_* id for "${name}"`);
  return v;
};
const aiAbilityId = (name) => {
  if (name == null || name === "") return 0;
  const v = AI_ABILITY_ID.get(aiNorm(name));
  if (v === undefined) throw new Error(`buildAiView: no ABILITY_* id for "${name}"`);
  return v;
};
const aiTypeId = (t) => {
  const v = AIK["TYPE_" + String(t).toUpperCase()];
  if (v === undefined) throw new Error(`buildAiView: no TYPE_* id for "${t}"`);
  return v;
};
const aiItemId = (name) => (name ? AIK[(itemData(name) || {}).constant] ?? (() => { throw new Error(`buildAiView: no ITEM_* id for "${name}"`); })() : 0);
const aiHoldEffectId = (name) => {
  const h = name ? (itemData(name) || {}).holdEffect : null;
  if (!h || h === "HOLD_EFFECT_NONE") return 0;
  const v = AIK[h];
  if (v === undefined) throw new Error(`buildAiView: no id for ${h}`);
  return v;
};
// gBattleMoves as ids -> { effect, power, type }; the engine's table equals the
// ROM's (move-data-audit.mjs), and slot 0 (MOVE_NONE) is all zeros.
const AI_MOVE_TABLE = (() => {
  const t = { 0: { effect: 0, power: 0, type: 0 } };
  for (const [name, m] of Object.entries(MOVES)) {
    t[aiMoveId(name)] = { effect: AIK[m.effect], power: m.power, type: aiTypeId(m.type) };
  }
  return t;
})();
const AI_GENDER = { male: AIK.MON_MALE, female: AIK.MON_FEMALE, genderless: AIK.MON_GENDERLESS };

function aiStatus1(state, side) {
  const st = state[side + "Status"];
  if (st == null) return 0;
  if (st === "sleep") return Math.max(1, Math.min(7, state[side + "SleepTurns"] ?? 1)) & AIK.STATUS1_SLEEP;
  if (st === "poison") {
    const c = state[side + "ToxicCounter"];
    return c != null ? (AIK.STATUS1_TOXIC_POISON | ((Math.min(15, c) << 8) & AIK.STATUS1_TOXIC_COUNTER)) : AIK.STATUS1_POISON;
  }
  if (st === "burn") return AIK.STATUS1_BURN;
  if (st === "freeze") return AIK.STATUS1_FREEZE;
  if (st === "paralysis") return AIK.STATUS1_PARALYSIS;
  throw new Error(`aiStatus1: unknown status ${st}`);
}
function aiStatus2(state, side) {
  let s = 0;
  const lock = state[side + "Lock"];
  if (state[side + "Confused"]) s |= 1;                                        // any STATUS2_CONFUSION turns
  if (lock?.kind === "uproar") s |= 1 << 4;
  if (lock?.kind === "bide") s |= 1 << 8;
  if (lock?.kind === "rampage") s |= 1 << 10;
  if (state[side + "Charging"] || lock) s |= AIK.STATUS2_MULTIPLETURNS;
  if (state[side + "Wrapped"] != null) s |= 1 << 13;
  if (state[side + "Attracted"]) s |= 1 << (16 + (side === "you" ? 1 : 0));  // INFATUATED_WITH(the other battler)
  if (vf(state, side + "FocusEnergy")) s |= AIK.STATUS2_FOCUS_ENERGY;
  if (state[side + "Transform"]) s |= AIK.STATUS2_TRANSFORMED;
  if (state[side + "Recharge"]) s |= AIK.STATUS2_RECHARGE;
  if (state[side + "Raging"]) s |= AIK.STATUS2_RAGE;
  if (state[side + "SubstituteHP"] != null) s |= AIK.STATUS2_SUBSTITUTE;
  if (state[side + "DestinyBondActive"]) s |= AIK.STATUS2_DESTINY_BOND;
  if (vf(state, side + "CantEscape")) s |= AIK.STATUS2_ESCAPE_PREVENTION;
  if (state[side + "Nightmared"]) s |= AIK.STATUS2_NIGHTMARE;
  if (state[side + "Cursed"]) s |= AIK.STATUS2_CURSED;
  if (state[side + "Foresighted"]) s |= AIK.STATUS2_FORESIGHT;
  if (vf(state, side + "DefenseCurled")) s |= AIK.STATUS2_DEFENSE_CURL;
  if (state[side + "Tormented"]) s |= AIK.STATUS2_TORMENT;
  return s >>> 0;
}
function aiStatus3(state, side) {
  let s = 0;
  if (state[side + "Seeded"]) s |= AIK.STATUS3_LEECHSEED | (side === "you" ? 1 : 0); // + the battler receiving HP
  if (state[side + "AlwaysHitTurns"] != null) s |= 1 << 3;
  if (vf(state, side + "PerishSonged")) s |= AIK.STATUS3_PERISH_SONG;
  const inv = state[side + "Charging"]?.invulnBit;
  if (inv === "air") s |= AIK.STATUS3_ON_AIR;
  if (inv === "underground") s |= AIK.STATUS3_UNDERGROUND;
  if (inv === "underwater") s |= AIK.STATUS3_UNDERWATER;
  if (vf(state, side + "Minimized")) s |= AIK.STATUS3_MINIMIZED;
  if (state[side + "Ingrained"]) s |= AIK.STATUS3_ROOTED;
  const yawn = state[side + "YawnTurns"];
  if (yawn != null) s |= (yawn << 11) & AIK.STATUS3_YAWN;
  if (state[side + "Imprisoning"]) s |= AIK.STATUS3_IMPRISONED_OTHERS;
  if (vf(state, side + "MudSport")) s |= AIK.STATUS3_MUDSPORT;
  if (vf(state, side + "WaterSport")) s |= AIK.STATUS3_WATERSPORT;
  return s >>> 0;
}
function aiSideStatus(state, side) {
  let s = 0;
  if (state[side + "ReflectTurns"] != null) s |= AIK.SIDE_STATUS_REFLECT;
  if (state[side + "LightScreenTurns"] != null) s |= AIK.SIDE_STATUS_LIGHTSCREEN;
  if (state[side + "SpikesLayers"] > 0) s |= AIK.SIDE_STATUS_SPIKES;
  if (state[side + "SafeguardTurns"] != null) s |= AIK.SIDE_STATUS_SAFEGUARD;
  if (state[side + "FutureSight"] != null) s |= AIK.SIDE_STATUS_FUTUREATTACK;
  if (state[side + "MistTurns"] != null) s |= AIK.SIDE_STATUS_MIST;
  return s;
}
function aiWeatherBits(state) {
  const w = state.weatherType; // RAW: get_weather is blind to Cloud Nine / Air Lock
  if (w == null) return 0;
  return w === "rain" ? AIK.B_WEATHER_RAIN_TEMPORARY : w === "sandstorm" ? AIK.B_WEATHER_SANDSTORM_TEMPORARY
    : w === "sun" ? AIK.B_WEATHER_SUN_TEMPORARY : w === "hail" ? AIK.B_WEATHER_HAIL_TEMPORARY
    : (() => { throw new Error(`aiWeatherBits: unknown weather ${w}`); })();
}
function aiMonView(mon, state, side) {
  const stages = side === "you" ? state.youStages : state.oppStages;
  const hp = Math.round(((side === "you" ? state.yourHpPct : state.oppHpPct) / 100) * mon.stats.hp);
  const sp = SPECIES[mon.species]?.abilities ?? [];
  const types = mon.types.length === 1 ? [mon.types[0], mon.types[0]] : mon.types;
  return {
    hp: Math.max(0, hp), maxHP: mon.stats.hp, level: mon.level,
    ability: aiAbilityId(mon.ability),
    speciesAbilities: [aiAbilityId(sp[0]), aiAbilityId(sp[1])],
    types: types.map(aiTypeId),
    // statStages[8]: HP ATK DEF SPEED SPATK SPDEF ACC EVASION, stored +6
    stages: [6, stages.atk + 6, stages.def + 6, stages.spe + 6, stages.spa + 6, stages.spd + 6, stages.accuracy + 6, stages.evasion + 6],
    status1: aiStatus1(state, side), status2: aiStatus2(state, side), status3: aiStatus3(state, side),
    item: aiItemId(mon.item), holdEffect: aiHoldEffectId(mon.item),
    moves: [0, 1, 2, 3].map((i) => aiMoveId(mon.moves[i] ?? null)),
    lastMove: aiMoveId(state[side + "LastMove"] ?? null),
    isFirstTurn: state[side + "MonFirstTurn"] ? 1 : 0,
    protectUses: state[side + "ProtectUses"] ?? 0,
    stockpile: state[side + "Stockpile"] ?? 0,
    disabledMove: aiMoveId(state[side + "DisabledMove"] ?? null),
    encoredMove: aiMoveId(state[side + "EncoredMove"] ?? null),
    tauntTimer: state[side + "TauntTurns"] ?? 0,
    usedHeldItem: aiItemId(state[side + "UsedItem"]) & 0xff,
    flashFired: !!state[side + "FlashFireActive"],
    genders: (mon.genderDist ?? []).map(({ p, gender }) => ({ p, gender: AI_GENDER[gender] })),
  };
}
// Quick Claw in GetWhoStrikesFirst reads gRandomTurnNumber, drawn ONCE at the
// start of the turn, before action selection (src/battle_main.c:3923, :4013),
// and the battle's own order reads the same value -- so it is an input here,
// shared with resolveTurn (F14), never a per-call coin. `qc`: true = the draw
// fired, false = it did not.
function aiQuickClawHolders(opp, you) {
  const q = (m) => { const d = itemData(m.item); return d && d.holdEffect === "HOLD_EFFECT_QUICK_CLAW" ? d : null; };
  return { opp: q(opp), you: q(you) };
}
// ── Phase D F2c: what the AI knows of the player's moves ───────────────────
// BATTLE_HISTORY->usedMoves[target] is fed ONLY by RecordLastUsedMoveByTarget
// (src/battle_ai_script_commands.c:618-633), at the top of every AI decision
// (:403): the target's gLastMoves goes into the first free slot unless it is
// already there (MOVE_NONE matches a free slot and so records nothing). It is
// cleared when a mon enters (ClearBattlerMoveHistory, src/battle_main.c:3260,
// :3353). So on turn 1 the AI knows NONE of the player's moves; the engine
// handed it all four.
//
// MOVE_UNAVAILABLE (0xFFFF, a prevented move -- :4412) is recorded too. This
// engine stores it as null, like MOVE_NONE, which is exact for every read:
// gBattleMoves[0xFFFF], past the table at 0x083DC88C in the ROM, reads effect
// 0, power 0, type 0 -- the same as row 0 -- and every if_has_move* /
// get_last_used_bank_move consumer in data/battle_ai_scripts.s reads only
// those or compares the id against lists holding neither. What it does not
// capture is that 0xFFFF OCCUPIES a slot, which can matter only once three
// entries exist; a three-turn search records at most two, and a third throws.
function recordTargetMoveHistory(state) {
  const h = state.youMoveHistory ?? [];
  const last = state.youLastMove ?? null;
  if (last === null || h.includes(last)) return h;
  if (h.length >= 2) {
    throw new Error(`recordTargetMoveHistory: a third recorded move (${[...h, last].join(", ")}) -- ` +
      `MOVE_UNAVAILABLE's slot occupancy is not modelled past two entries (Phase D F2c)`);
  }
  return [...h, last];
}
// The state the AI decides in: the history recorded -- but only when the ROM
// runs the AI at all. A charging / recharging / rampaging mon is forced before
// action selection, and so is an Encored one (src/battle_main.c:4192-4198 sets
// the move and never calls the controller), so neither records.
function aiDecisionState(state) {
  const forced = state.oppCharging || state.oppRecharge || state.oppLock || state.oppEncoredMove;
  if (forced) return state;
  const h = recordTargetMoveHistory(state);
  return h === state.youMoveHistory ? state : { ...state, youMoveHistory: h };
}
function buildAiView(opp, you, state, { history = "battle", qc = false, debug = null } = {}) {
  const weather = effectiveWeather(state, you, opp);
  const holders = aiQuickClawHolders(opp, you);
  const INF = Number.MAX_SAFE_INTEGER;
  const su = qc && holders.opp ? INF : effSpeed(opp, state.oppStatus, state.oppStages.spe, weather);
  const st = qc && holders.you ? INF : effSpeed(you, state.youStatus, state.youStages.spe, weather);
  const legal = new Set(selectableMoves(opp.moves, state, "opp", you, "the opponent"));
  const aiState = buildAiDamageState(state, opp, you);
  const view = {
    mon: [aiMonView(you, state, "you"), aiMonView(opp, state, "opp")], // indexed AI_TARGET (0), AI_USER (1)
    side: [aiSideStatus(state, "you"), aiSideStatus(state, "opp")],
    weather: aiWeatherBits(state),
    turnCounter: Math.max(0, (state.turn ?? 1) - 1),
    usablePartyMons: [state.yourUsablePartyMons ?? 0, state.oppUsablePartyMons ?? 0],
    party: [[{ hp: 1, status: aiStatus1(state, "you") }], [{ hp: 1, status: aiStatus1(state, "opp") }]],
    speedCompare: su > st ? "user" : su < st ? "target" : "tie",
    limited: [0, 1, 2, 3].map((i) => opp.moves[i] != null && !legal.has(opp.moves[i])),
    history: {
      ability: aiAbilityId(state.youAbilityRecord),
      // F2c: "battle" is BATTLE_HISTORY (recorded as at this decision -- the
      // record is idempotent, so a state already recorded gives the same);
      // "moveset" is the old all-four assumption, kept for the parity tool.
      usedMoves: history === "moveset" ? [0, 1, 2, 3].map((i) => aiMoveId(you.moves[i] ?? null))
        : history === "battle" ? [0, 1, 2, 3].map((i) => aiMoveId(recordTargetMoveHistory(state)[i] ?? null)) : null,
      targetHoldEffect: 0, // F2b: GetItemHoldEffect(itemEffects[target]) is NONE in every reachable state
      itemEffects: 0,
    },
    moveTable: AI_MOVE_TABLE,
    aiDamage: (slot, roll) => (opp.moves[slot] ? aiCalcDamage(opp, you, opp.moves[slot], aiState, roll) : 0),
    typeEffDamageVar: (moveId) => aiTypeEffDamageVar(moveId, opp, you, state),
    debug,
  };
  if (!view.history.usedMoves) throw new Error(`buildAiView: history "${history}" is not implemented yet`);
  return view;
}
// Cmd_if_type_effectiveness's damage variable (src/battle_ai_script_commands.c:
// 1515-1556): TypeCalc on 40 -- STAB x1.5, then the rows in gTypeEffectiveness
// order (typeCalcRows, F17); Levitate vs Ground skips the rows (flags only,
// src/battle_script_commands.c:1554-1557) -- then the requantisation (120 -> 80,
// 240 -> 160, 30 -> 20, 15 -> 10). The retail build never reads the flags, so a
// x0 row followed by another matching row gives 1, which is no category at all.
function aiTypeEffDamageVar(moveId, opp, you, state) {
  const row = AI_MOVE_TABLE[moveId];
  const moveType = Object.keys(TYPE_CHART).find((t) => aiTypeId(t) === row.type);
  let d = 40;
  if (opp.types.map(aiTypeId).includes(row.type)) d = Math.floor((d * 15) / 10);
  if (!(you.ability === "Levitate" && moveType === "Ground")) d = typeCalcRows(d, moveType, you.types, !!state.youForesighted).dmg;
  if (d === 120) d = 80;
  if (d === 240) d = 160;
  if (d === 30) d = 20;
  if (d === 15) d = 10;
  return d;
}
// With `opts.qc` given, the decision for that Quick Claw outcome; without it,
// the mixture over the draw (for callers that do not condition the turn on it).
function chooseOpponentMovesInterp(opp, you, state, opts = {}) {
  if (opts.qc === undefined) {
    const h = aiQuickClawHolders(opp, you);
    const holder = h.opp || h.you;
    if (!holder) return chooseOpponentMovesInterp(opp, you, state, { ...opts, qc: false });
    const pFire = quickClawThreshold(holder.param) / QUICK_CLAW_RANDOM_SPACE;
    const mix = new Map();
    for (const [p, qc] of [[pFire, true], [1 - pFire, false]]) {
      for (const { move, prob } of chooseOpponentMovesInterp(opp, you, state, { ...opts, qc })) mix.set(move, (mix.get(move) ?? 0) + p * prob);
    }
    return [...mix.entries()].map(([move, prob]) => ({ move, prob })).sort((a, b) => b.prob - a.prob);
  }
  const view = buildAiView(opp, you, state, opts);
  const ctx = { aiDamageState: buildAiDamageState(state, opp, you), targetHp: view.mon[0].hp,
    targetHpPct: aiHpPercent(state.yourHpPct, you.stats.hp) };
  // Memo over EVERYTHING the interpreter can read: the view's data, and what
  // its two functions read -- the damage state (aiDamage) and the target's
  // Foresight (typeEffDamageVar; types and ability are in the view). Two
  // positions equal in all of it get the same answer; the transposition table
  // cannot see that, since they differ elsewhere (Mind / Skill, the player's
  // own PP-free counters, ...). Keyed per (opponent, player) mon objects.
  const { aiDamage, typeEffDamageVar, moveTable, ...viewData } = view; // moveTable is the constant AI_MOVE_TABLE
  const memoKey = JSON.stringify([viewData, ctx.aiDamageState, !!state.youForesighted]);
  let byYou = _aiInterpMemo.get(opp);
  if (!byYou) { byYou = new WeakMap(); _aiInterpMemo.set(opp, byYou); }
  let memo = byYou.get(you);
  if (!memo) { memo = new Map(); byYou.set(you, memo); }
  const hit = memo.get(memoKey);
  if (hit) return hit;
  const out = new Map();
  for (const { p: rollP, rolls } of enumerateAiRollOutcomes(opp, you, ctx)) {
    const slotRolls = [0, 1, 2, 3].map((i) => (opp.moves[i] ? rolls[opp.moves[i]] ?? 100 : 100));
    const runs = runAi(view, slotRolls);
    for (const [slot, p] of chooseFromScores(view, runs)) {
      const m = opp.moves[slot];
      out.set(m, (out.get(m) ?? 0) + rollP * p);
    }
  }
  const result = [...out.entries()].map(([move, prob]) => ({ move, prob })).sort((a, b) => b.prob - a.prob);
  memo.set(memoKey, result);
  return result;
}
const _aiInterpMemo = new WeakMap();

// Phase D F13: the opponent AI IS the script interpreter (ai-interpreter.js over
// ai-program.js, generated from data/battle_ai_scripts.s and checked byte for
// byte against the ROM). Against the ROM's own AI_THINKING_STRUCT scores it
// reproduces 3,872 of 3,873 decisions in 1,698 emulator battles, every turn,
// at the ROM's simulatedRNG and Quick Claw draw (the miss is a harness anomaly,
// traces-given/battle-00117). It replaces the hand-ported handlers below, which
// the parity run (arena-solver/tools/ai-parity.mjs) found wrong in four classes
// the scripts get right by construction: get_weather's stale funcResult,
// Counter's misaligned if_has_move, TryToFaint's x4 bonus on status moves, and
// Mirror Move reading gLastMoves. Phase D F14: `opts.qc` conditions on the
// turn's Quick Claw draw; without it the result is the mixture over the draw.
// The search does not use the mixture -- see aiTurnPlans.
function chooseOpponentMoves(opp, you, state, opts = {}) {
  return chooseOpponentMovesInterp(opp, you, state, opts);
}

// Phase D F14: ONE gRandomTurnNumber decides Quick Claw for the AI's speed
// read AND for the turn order (src/battle_main.c:3923 draws it before action
// selection; :4653 / :4687 compare against it in GetWhoStrikesFirst, which
// Cmd_if_user_goes and the turn order both call). The two are correlated, so
// the turn cannot be the AI's mixture times resolveTurn's own mixture: it is,
// per draw outcome, P(outcome) x the AI given it x resolveTurn given it.
// Returns [{ p, qc, cands }]; qc undefined means the draw cannot change the
// AI's choice here (no holder, or both outcomes give the same distribution),
// so resolveTurn marginalises it itself -- exactly, and without splitting a
// subtree it would only duplicate.
function aiTurnPlans(ec, state) {
  const h = aiQuickClawHolders(ec.opp, ec.you);
  const holder = h.opp || h.you;
  if (!holder) return [{ p: 1, qc: undefined, cands: chooseOpponentMoves(ec.opp, ec.you, state, { qc: false }) }];
  const fired = chooseOpponentMoves(ec.opp, ec.you, state, { qc: true });
  const not = chooseOpponentMoves(ec.opp, ec.you, state, { qc: false });
  const same = fired.length === not.length && fired.every((x, i) => x.move === not[i].move && x.prob === not[i].prob);
  if (same) return [{ p: 1, qc: undefined, cands: not }];
  const pFire = quickClawThreshold(holder.param) / QUICK_CLAW_RANDOM_SPACE;
  return [{ p: pFire, qc: true, cands: fired }, { p: 1 - pFire, qc: false, cands: not }];
}

// The hand-ported handlers (A2 through F12), superseded by F13 and kept only
// as the parity tool's reference.
function chooseOpponentMovesHandlers(opp, you, state) {
  const ctx = {
    userHpPct: aiHpPercent(state.oppHpPct, opp.stats.hp),
    targetHpPct: aiHpPercent(state.yourHpPct, you.stats.hp),
    // The target's ABSOLUTE HP, for the two damage-vs-HP comparisons
    // (if_can_faint and the roll enumeration) -- which read gBattleMons[].hp
    // itself, not the truncated percentage.
    targetHp: Math.round((state.yourHpPct / 100) * you.stats.hp),
    // A6: targetConfused was hardcoded false. It was written when only Confuse
    // Ray could confuse and the flag was called metagrossConfused; it then
    // stayed false through every later change, so four handler branches that
    // read it (EFFECT_CONFUSE :572, EFFECT_SWAGGER :1047, EFFECT_REVENGE :1600,
    // EFFECT_FOCUS_PUNCH :1819, plus reflectFamilyViability :451 shared by
    // Counter/Mirror Coat) could never fire. Now real.
    targetConfused: state.youConfused,
    targetTypes: you.types,
    userEvasionStage: state.oppStages.evasion,
    // targetToxicPoisoned/targetCursed still not modeled (regular-vs-badly-
    // poisoned isn't distinguished; non-Ghost Curse doesn't set any "cursed"
    // status, and Ghost-Curse throws) — left false. Ingrain and Leech Seed
    // ARE now real (this batch/batch 4) — wired to actual state below.
    // A3: targetToxicPoisoned is now REAL. It was hardcoded false because Toxic
    // had no executor, so bad poison could never exist; with A3 it can, and six
    // handler branches read it (AI_CV_Toxic's shared tail :333, EFFECT_ATTRACT
    // :611, EFFECT_MEAN_LOOK :1142, EFFECT_PROTECT :1174, EFFECT_SUBSTITUTE
    // :1728, EFFECT_TRAP :1878). Leaving it false after implementing the
    // mechanic would be the A9 defect class again: a model that applies an
    // effect its own AI cannot see. targetCursed stays false -- Ghost-Curse is
    // still unmodelled and throws, so no reachable state sets it.
    targetToxicPoisoned: state.youToxicCounter != null,
    // B2: targetCursed is real now that Ghost-Curse is implemented. It was
    // hardcoded false because no reachable state could set it.
    targetCursed: state.youCursed,
    // B2b batch 1. targetForesighted feeds AI_CBM_Foresight's already-identified
    // check; userForesighted is here for symmetry with the executor's two-sided
    // flag (AI_CV_Foresight reads the USER's TYPES and EVASION, not this -- see
    // the vanilla bug preserved in that handler).
    targetForesighted: state.youForesighted,
    userForesighted: state.oppForesighted,
    userFocusEnergy: vf(state, "oppFocusEnergy"), // AI_CBM_FocusEnergy's STATUS2_FOCUS_ENERGY check
    userIngrained: state.oppIngrained,
    targetLeechSeeded: state.youSeeded,
    // Added for EFFECT_PARALYZE/EFFECT_ROAR/EFFECT_REST (this batch):
    // Phase D F2a: what get_ability / check_ability AI_TARGET answer -- the
    // recorded ability (youAbilityRecord), else a trapping ability, else the
    // species guess. Never the true ability as such.
    targetAbilityBelief: aiTargetAbilityBelief(state.youAbilityRecord, you),
    targetAbilityIs: (ability) => aiTargetAbilityCheck(state.youAbilityRecord, you, ability),
    targetStatus: state.youStatus, // null | "paralysis" | "freeze" | "burn" | "poison" — real STATUS1_ANY gate
    // Phase D F3: the player side's LIVE Safeguard (if_side_affecting AI_TARGET,
    // SIDE_STATUS_SAFEGUARD). Was hardcoded false after B3 had built Safeguard.
    targetSafeguarded: state.youSafeguardTurns != null,
    // EFFECT_ATTRACT (this batch): AI_USER is the opponent itself, AI_TARGET
    // is the player — each mon's genderDist was computed once in buildMon.
    // targetInfatuated mirrors STATUS2_INFATUATION — doesn't matter WHO the
    // player is infatuated with, only whether Attract would be a no-op.
    userGenderDist: opp.genderDist,
    targetGenderDist: you.genderDist,
    targetInfatuated: state.youAttracted,
    targetStages: state.youStages, // needed by EFFECT_ROAR's "is any of the target's stats boosted" check
    // "will the opponent (user) act before the player (target) if it picks
    // this move" — same formula resolveTurn will actually use (see effSpeed).
    targetFaster: effSpeed(you, state.youStatus, state.youStages.spe, effectiveWeather(state, you, opp)) > effSpeed(opp, state.oppStatus, state.oppStages.spe, effectiveWeather(state, you, opp)),
    // B7c-4: an EXACT tie makes the AI's own if_target_faster a coin flip in
    // source (see scoreOpponentMoveDist's header). Flagged here so the scoring
    // can enumerate it; `targetFaster` above stays the deterministic value for
    // the non-tied case, which is every cell but ~1.5% of them.
    speedTied: effSpeed(you, state.youStatus, state.youStages.spe, effectiveWeather(state, you, opp))
      === effSpeed(opp, state.oppStatus, state.oppStages.spe, effectiveWeather(state, you, opp)),
    // EFFECT_ROAR's count_usable_party_mons(AI_TARGET) check — source-confirmed
    // NONZERO in real Arena play (see the long comment on EFFECT_ROAR above):
    // the AI sees the player's other FRONTIER_PARTY_SIZE=3 team slots same as
    // in Battle Tower, oblivious to Arena's switch-lock. Defaults to 2 (full
    // reserve team alive); threaded from analyzeMatchup's yourUsablePartyMons
    // option once the team-run workflow needs to reflect earlier-round faints.
    targetUsablePartyMons: state.yourUsablePartyMons,
    targetHasSnatch: false, // Snatch not modeled yet — used by EFFECT_REST's shared tail
    // Added for the stat-boost family (EFFECT_ATTACK_UP/_2, DEFENSE_UP/_2,
    // SPEED_UP/_2, SPECIAL_ATTACK_UP/_2, SPECIAL_DEFENSE_UP/_2) — this batch:
    userAtkStage: state.oppStages.atk, userDefStage: state.oppStages.def,
    userSpeStage: state.oppStages.spe, userSpAtkStage: state.oppStages.spa,
    userSpDefStage: state.oppStages.spd,
    // AI_CV_AccuracyDown's own-accuracy-stage check, AI_CBM_Haze/AI_CV_PsychUp's
    // 7-stat "is anything of mine already lowered" scan.
    userAccStage: state.oppStages.accuracy,
    // gLastMoves[gBattlerTarget] equivalent (state.youLastMove) — used by
    // AI_CV_DefenseUp/AI_CV_SpDefUp's "was the last hit physical or special"
    // check. null on turn 1 (no prior move) reads the same as a status move
    // (power 0), matching get_move_power_from_result on an empty history.
    targetLastMoveHadPower: state.youLastMove != null && MOVES[state.youLastMove].power > 0,
    targetLastMoveWasPhysical: state.youLastMove != null && MOVES[state.youLastMove].category === "physical",
    // AI_CV_MirrorCoat's own last-move-category check (:2136-2138) — the
    // exact mirror of targetLastMoveWasPhysical above, checked against
    // SPECIAL_TYPES instead of PHYSICAL_TYPES via move-data.js's `category`
    // field (same Gen III type-based split, not the modern per-move split).
    targetLastMoveWasSpecial: state.youLastMove != null && MOVES[state.youLastMove].category === "special",
    // AI_CV_Sleep's has_move_with_effect(AI_TARGET, ...) check — the player's
    // ("you") KNOWN moveset, not the current turn's chosen move.
    // B2b batch 2 -- the move-restriction family's ctx reads.
    targetHasDisabledMove: (state.youDisabledMove != null),
    targetHasEncoredMove: (state.youEncoredMove != null),
    targetTormented: state.youTormented,
    userImprisoning: state.oppImprisoning,
    // AI_CV_Encore's `get_move_effect_from_result` on the target's last move.
    targetLastMoveEffect: state.youLastMove != null ? MOVES[state.youLastMove]?.effect : null,
    // AI_CV_MirrorMove reads the move the TARGET last took, the same field
    // Mirror Move itself copies.
    targetLastTakenMove: state.youLastTakenMove,
    // B2b batch 4.
    targetSideHasSpikes: state.youSpikesLayers > 0,
    userMudSport: vf(state, "oppMudSport"),
    userSideMisted: state.oppMistTurns != null,
    // B2b batch 10. The AI reads hold EFFECTS, not item names, and it reads
    // them through the same generated table the battle does.
    userHoldEffect: (itemData(opp.item) || {}).holdEffect ?? null,
    // Phase D F2b: get_hold_effect AI_TARGET is GetItemHoldEffect(BATTLE_HISTORY->
    // itemEffects[target]) (src/battle_ai_script_commands.c:2032-2047), and
    // itemEffects holds a HOLD EFFECT read back as an ITEM ID. The only effects
    // ever recorded are Focus Band (39) and Leftovers (43); items 39 and 43 are
    // the Blue and White Flutes, which have no hold effect (src/data/items.h).
    // So the AI sees NONE in every reachable singles state -- it never learns
    // the player's item. This used to be the TRUE hold effect.
    targetHoldEffect: null,
    userUsedItem: state.oppUsedItem != null,
    userUsedHoldEffect: state.oppUsedItem ? ((itemData(state.oppUsedItem) || {}).holdEffect ?? null) : null,
    // F12: Cmd_get_used_held_item answers with the ITEM, which Recycle's table lists.
    userUsedItemConstant: state.oppUsedItem ? ((itemData(state.oppUsedItem) || {}).constant ?? null) : null,
    userStockpile: state.oppStockpile,
    userWaterSport: vf(state, "oppWaterSport"),
    targetNightmared: state.youNightmared,
    // AI_CV_HealBell's second clause reads the TARGET's PARTY status. An Arena
    // matchup has no reserve party here, so it defaults false -- same stated
    // convention as targetCantEscape and friends.
    targetPartyStatused: false,
    targetHasDreamEaterOrNightmare: you.moves.some((m) => ["EFFECT_DREAM_EATER", "EFFECT_NIGHTMARE"].includes(MOVES[m]?.effect)),
    // Added for batch 4 (Dragon Dance/Curse/Leech Seed/Baton Pass):
    userTypes: opp.types, // EFFECT_CURSE's Ghost-type branch check
    // AI_CBM_BatonPass's count_usable_party_mons(AI_USER) — the OPPONENT'S
    // OWN reserves, mirrored from ctx.targetUsablePartyMons's reasoning (same
    // FRONTIER_PARTY_SIZE=3 fact) but for the AI's own side this time.
    userUsablePartyMons: state.oppUsablePartyMons,
    // AI_CV_Toxic (shared by EFFECT_TOXIC and EFFECT_LEECH_SEED)'s two
    // has-move checks — both examine the OPPONENT's ("user"'s) OWN known
    // moveset, not the target's. NOTE: literally EFFECT_SPECIAL_DEFENSE_UP
    // only (data/battle_ai_scripts.s:1363) — NOT the _2 variant (Amnesia) —
    // preserved as written, not "fixed" to include it.
    // Guarded (matches the sibling check just below) — a moveset entry
    // missing from move-data.js must not crash this; treated conservatively
    // as "might have power" rather than assumed status-only.
    userHasNoAttackingMoves: opp.moves.every((m) => MOVES[m]?.power === 0),
    userHasSpDefUpOrProtectMove: opp.moves.some((m) => ["EFFECT_SPECIAL_DEFENSE_UP", "EFFECT_PROTECT"].includes(MOVES[m]?.effect)),
    // Batch 5 (Substitute/Reflect/Light Screen) — all about the OPPONENT'S
    // ("user"'s) own persistent state, not the target's.
    userHasSubstitute: state.oppSubstituteHP != null,
    userHasReflect: state.oppReflectTurns != null,
    userHasLightScreen: state.oppLightScreenTurns != null,
    // Batch 6 (Swagger): AI_CV_Swagger's if_has_move(AI_USER, MOVE_PSYCH_UP)
    // and get_turn_count checks — both about the OPPONENT's own moveset/the
    // battle's turn counter, not the target.
    userHasPsychUp: opp.moves.includes("Psych Up"),
    // AI_CV_Counter's if_has_move(AI_USER, MOVE_MIRROR_COAT) check
    // (data/battle_ai_scripts.s:1630) — the OPPONENT'S own moveset, same
    // convention as userHasPsychUp just above.
    userHasMirrorCoat: opp.moves.includes("Mirror Coat"),
    // AI_CV_MirrorCoat's reciprocal if_has_move(AI_USER, MOVE_COUNTER) check
    // (data/battle_ai_scripts.s:2128) — the OPPONENT'S own moveset, same
    // convention as userHasMirrorCoat just above, flipped.
    userHasCounter: opp.moves.includes("Counter"),
    isFirstTurn: state.turn === 1,
    // Batch 8 (Safeguard/Mean Look):
    userHasSafeguard: state.oppSafeguardTurns != null,
    // Phase D F4: STATUS2_ESCAPE_PREVENTION on the player (was hardcoded false).
    targetCantEscape: vf(state, "youCantEscape"), targetPerishSonged: vf(state, "youPerishSonged"),
    // A6: `targetInfatuated: false` USED TO BE REPEATED HERE, ~74 lines after
    // the real assignment above. In a JS object literal the later key wins, so
    // the live wiring at the earlier line was dead and the flag was always
    // false -- measured inert in sim-audit.md §2.3. The duplicate is deleted;
    // the real one is the only one. See test-a6-dead-context.js, and the
    // no-duplicate-keys check that now guards the whole file.
    // Protect/Detect (AI_CV_Protect) — reuses the shared decay counter; every
    // status it reads on either side is live state (Phase D F3 wired the last
    // three: the user's Perish Song and both sides' Yawn).
    userProtectCount: state.oppProtectUses,
    userToxicPoisoned: state.oppToxicCounter != null, // A3: mirrored for the opponent's own side
    // A6: userInfatuated is the opponent's OWN infatuation. It was false
    // because only the player could be infatuated; A5 made oppAttracted real.
    // Phase D F3: userPerishSonged and the two Yawn flags were hardcoded false
    // after B3 built Perish Song and Yawn (STATUS3_PERISH_SONG / STATUS3_YAWN,
    // read by AI_CV_Protect :1899, :1902, :1910).
    userCursed: state.oppCursed, userPerishSonged: vf(state, "oppPerishSonged"), userInfatuated: state.oppAttracted,
    userSeeded: state.oppSeeded, // real — the opponent itself currently seeded by Leech Seed
    userYawnPending: state.oppYawnTurns != null, targetYawnPending: state.youYawnTurns != null,
    targetHasRestoreHpOrDefenseCurlMove: you.moves.some((m) => ["EFFECT_RESTORE_HP", "EFFECT_DEFENSE_CURL"].includes(MOVES[m]?.effect)),
    targetLastMoveWasLockOn: state.youLastMove != null && MOVES[state.youLastMove].effect === "EFFECT_LOCK_ON",
    // Weather (Sunny Day/Rain Dance/Sandstorm/Hail). get_weather
    // (src/battle_ai_script_commands.c:1644-1665) reads gBattleWeather
    // DIRECTLY with no WEATHER_HAS_EFFECT check at all — a real, confirmed
    // vanilla quirk: the AI's own scoring is blind to Cloud Nine/Air Lock
    // suppression (it "sees" weather that isn't actually doing anything).
    // So this is deliberately the RAW weatherType, NOT effectiveWeather() —
    // preserving that quirk, not correcting it.
    currentWeather: state.weatherType,
    userAbility: opp.ability,
    // AI_CBM_OneHitKO's if_level_cond check (EFFECT_OHKO) — the only handler
    // that needs either mon's raw level.
    userLevel: opp.level, targetLevel: you.level,
    // Batch-1 lockstep additions: the opponent's OWN major status
    // (AI_CBM_DamageDuringSleep's `if_not_status AI_USER, STATUS1_SLEEP`
    // check for EFFECT_SNORE), and the Future Sight queued-state flags.
    // Phase D F3: these were hardcoded false ("delayed attacks are not
    // modelled") and stayed so after B3 built Future Sight -- the AI chose it
    // again with P 1 while one was pending, which the ROM never does.
    // SIDE_STATUS_FUTUREATTACK is set on the target's side by
    // Cmd_trysetfutureattack (src/battle_script_commands.c:8937) and cleared
    // when the attack lands (src/battle_util.c:1818-1823): exactly the
    // lifetime of youFutureSight / oppFutureSight.
    userStatus: state.oppStatus,
    futureSightQueuedOnUserSide: state.oppFutureSight != null,
    futureSightQueuedOnTargetSide: state.youFutureSight != null,
    // Batch-3 lockstep additions:
    // if_side_affecting AI_TARGET, SIDE_STATUS_REFLECT (AI_CV_BrickBreak) —
    // the player's own LIVE Reflect screen, the same modeled side-status
    // calcDamage's screenActive halving consumes.
    targetHasReflect: state.youReflectTurns != null,
    // if_has_move_with_effect / if_doesnt_have_move_with_effect AI_TARGET,
    // EFFECT_PROTECT (AI_CV_ChargeUpMove / AI_CV_SemiInvulnerable) — the
    // player's KNOWN moveset, same full-knowledge convention as
    // targetHasDreamEaterOrNightmare above (see the EFFECT_SOLAR_BEAM
    // handler comment for the vanilla revealed-moves quirks this collapses).
    targetHasProtectEffectMove: you.moves.some((m) => MOVES[m]?.effect === "EFFECT_PROTECT"),
    // is_first_turn_for(AI_USER) — PER-MON first-turn-out state
    // (gDisableStructs.isFirstTurn: set to 2 at switch-in, decremented at
    // each turn end, so nonzero exactly through the mon's first action
    // turn). BATCH 4: now a REAL state input (state.oppMonFirstTurn,
    // default true = just sent out, UI-settable in both tools) replacing
    // batch 3's conservative always-false placeholder. NOT derived from
    // state.turn (the ROUND turn — the forbidden global-turn proxy); the
    // Arena search's lookahead decays it instead: resolveTurn clears
    // oppMonFirstTurn on every simulated turn advance, so this derivation
    // yields past-first for lookahead turns 2+ automatically. The Palace
    // predictor's single-turn call maps the input straight through.
    // Consumers: EFFECT_FAKE_OUT (batch 4) and the batch-3 ex-partials
    // FOCUS_PUNCH/KNOCK_OFF/PURSUIT, whose first-turn branches are live
    // off this flag now.
    userPastFirstTurn: !state.oppMonFirstTurn,
    // A9: the live state the AI's own damage estimate sees. Distinct from
    // `currentWeather` above, which is deliberately the RAW weather because the
    // AI's get_weather SCORING command is blind to Cloud Nine/Air Lock; the
    // DAMAGE path is not (src/pokemon.c:3331 WEATHER_HAS_EFFECT2), so
    // buildAiDamageState uses effectiveWeather. Both quirks are real and they
    // point opposite ways — see buildAiDamageState's comment.
    aiDamageState: buildAiDamageState(state, opp, you),
  };

  // A2: mix over the enumerated AI damage-roll assignments (see
  // enumerateAiRollOutcomes). Each entry is one class of assignments that all
  // produce the SAME AI_TryToFaint outcome, so the per-move scoring below runs
  // once per class rather than once per assignment.
  const rollOutcomes = enumerateAiRollOutcomes(opp, you, ctx);

  const outcomeProb = new Map();
  for (const { p: rollP, rolls } of rollOutcomes) {
    const rollCtx = { ...ctx, aiRolls: rolls };
      const legal = selectableMoves(opp.moves, state, "opp", you, "the opponent");
    const perMoveDist = legal.map((m) => ({ move: m, dist: scoreOpponentMoveDist(opp, you, m, rollCtx) }));

    // Cartesian product across all moves' distributions — each combination is
    // one "what if these specific dice all landed this way" world.
    let combos = [{ p: 1, scores: {} }];
    for (const { move, dist } of perMoveDist) {
      const next = [];
      for (const c of combos) {
        for (const d of dist) {
          next.push({ p: c.p * d.p, scores: { ...c.scores, [move]: d.score } });
        }
      }
      combos = next;
    }

    for (const combo of combos) {
      const maxScore = Math.max(...Object.values(combo.scores));
      const winners = Object.entries(combo.scores).filter(([, s]) => s === maxScore).map(([m]) => m);
      for (const w of winners) {
        outcomeProb.set(w, (outcomeProb.get(w) || 0) + (rollP * combo.p) / winners.length);
      }
    }
  }

  return [...outcomeProb.entries()].map(([move, prob]) => ({ move, prob })).sort((a, b) => b.prob - a.prob);
}

// ─────────────────────────────────────────────────────────────────────────
// 6. ARENA JUDGE SCORING
// ─────────────────────────────────────────────────────────────────────────

function mindDelta(moveName) {
  return MOVES[moveName]?.mindRating ?? 0;
}

// A7: every value here is now DERIVED from the two source mechanisms via
// arenaSkillDelta, not typed in. The outcome names are this engine's; the map
// to BattleArena_AddSkillPoints' branches is stated per case.
//
// The five paths sim-audit.md §3.2 called "correct by coincidence of coverage"
// are the ones that reach `noEffect` with no matching printed string, and they
// are now derived rather than coincidental:
//   Clear Body / White Smoke stat-block : +1 fallthrough -3 string  = -2
//   Limber (and the other ability status immunities) : +1 -3        = -2
//   already-statused                    : alreadyStatused branch    = -2
//   type-immune status                  : ButItFailed -> noEffect   = -2
//   Safeguard                           : +1 -3 string              = -2
// They all land on -2, which is why one "failed" return value was faithful to
// all five; the difference is that the engine can now say WHY for each.
function skillDelta(outcome) {
  switch (outcome) {
    case "landedSuperEffective": return arenaSkillDelta("superEffective");
    case "landedMixed": return arenaSkillDelta("mixed");
    case "landed": return arenaSkillDelta("landed");
    case "landedNVE": return arenaSkillDelta("notVeryEffective");
    // A miss sets MOVE_RESULT_MISSED, which composites into NO_EFFECT
    // (include/constants/battle.h:227); MISS_TYPE is not B_MSG_PROTECTED for an
    // ordinary accuracy miss, so the -2 fires.
    case "miss": return arenaSkillDelta("noEffect");
    case "noEffect": return arenaSkillDelta("noEffect");
    // "blocked" REMOVED (was a flat -3) — ability/item blocks do not share a
    // single Skill delta in source. See ABILITY_BLOCK_SKILL_DELTA below;
    // resolveAbilityInteraction() attaches the correct per-ability value
    // directly rather than routing through this generic outcome dispatch.
    default: return 0;
  }
}

function classifyOutcome(hit, eff) {
  if (!hit) return "miss";
  if (eff === 0) return "noEffect";
  if (eff > 1) return "landedSuperEffective";
  if (eff < 1) return "landedNVE";
  return "landed";
}

// ─────────────────────────────────────────────────────────────────────────
// 7. TURN RESOLUTION + BACKTRACKING SEARCH
//    `you` and `opp` are now parameters threaded through every function
//    instead of hardcoded globals.
// ─────────────────────────────────────────────────────────────────────────

// Starting HP is a parameter — carries forward from a prior 1v1 in the same
// team run (a mon that already won a judged round keeps its damage; the
// opponent's next mon coming in fresh defaults to 100).
// Permanent-weather abilities (Sand Stream/Drought/Drizzle) activate on
// switch-in — src/battle_util.c:2532-2558 (ABILITYEFFECT_ON_SWITCHIN). Since
// Arena is a fresh 1v1 with no reserves, this only ever matters at the very
// start of the match (both mons "switch in" simultaneously; no later
// switch-in can ever happen). If BOTH sides somehow had one (not possible in
// this dataset — only Sand Stream appears, on Tyranitar), real activation
// order would follow speed; not modeled since it never actually arises here.
function permanentWeatherFromAbility(mon) {
  if (mon.ability === "Sand Stream") return "sandstorm";
  if (mon.ability === "Drought") return "sun";
  if (mon.ability === "Drizzle") return "rain";
  return null;
}

// `overrides`: an optional flat object applied ON TOP OF the fresh-match
// defaults below — for starting a solve from an arbitrary OBSERVED mid-match
// state (the live coaching UI's use case), not just a fresh 100/100 match
// start. Deliberately a GENERIC shallow merge (not a hand-maintained
// allowlist of "supported" override fields) so every field already in this
// state object — including ones added by future mechanics — is override-able
// for free, matching Lesson 7's "finite known things get filled completely"
// spirit applied to the state shape itself. The ONE exception is `youStages`/
// `oppStages`: those are nested 7-key objects (atk/def/spa/spd/spe/evasion/
// accuracy), so a naive shallow merge on TOP of the outer object would let a
// PARTIAL override (e.g. just `{ atk: 2 }`) silently wipe the other 6 keys to
// `undefined` instead of leaving them at their fresh default of 0 — merged
// one level deeper specifically for those two fields. `turn` is deliberately
// override-able too (not just HP/stages/status) since it feeds real logic
// (`isFirstTurn` in chooseOpponentMoves's ctx, used by AI_CV_Swagger) — a
// mid-match override that forgets to set `turn` would silently make the AI
// think it's still turn 1.
//
// The no-overrides call path is UNCHANGED byte-for-byte from before this was
// added (see the early return below) — this is a strict additive capability,
// not a replacement of the default path.
// yourHpPctAtStart/oppHpPctAtStart: the Body-scoring baseline pokeemerald
// calls hpAtStart — HP at SWITCH-IN for this specific 1v1, not max HP
// (BattleArena_InitPoints, src/battle_arena.c:569-581, sets hpAtStart[i] =
// gBattleMons[i].hp; called from two sites, both firing only when a mon is
// freshly placed on the field: Cmd_switchinanim, src/battle_script_
// commands.c:4696-4697, and the battle-intro send-out, src/battle_main.c:
// 3485-3486). Never re-baselined mid-round — UpdateHPAtStart
// (battle_arena.c:654-661) is confirmed dead code (zero callers anywhere in
// source), and Arena confirmed disallows switching while the active mon is
// still alive (VARIOUS_ARENA_*_MON_LOST handlers, battle_script_commands.c:
// 6408-6431, only trigger a switch after a forced faint) — so the baseline
// is fixed for a mon's entire active stint BY DESIGN, not by accident of
// what this port happens to call once.
//
// Default (when the caller supplies only yourHpPct/oppHpPct): silently set
// to the SAME value. This is exactly correct whenever the caller's
// yourHpPct/oppHpPct genuinely IS the round's true starting HP — which is
// every current caller of this function (a fresh 100/100 match, and the
// carry-forward case where a mon's carried-in HP IS what this new round
// starts at, e.g. test-team-workflow.js). It is the CALLER's responsibility
// to pass yourHpPctAtStart/oppHpPctAtStart explicitly whenever yourHpPct/
// oppHpPct instead represents an OBSERVED MID-ROUND value (HP already past
// the round's true start) — this function has no way to distinguish the two
// cases from a bare number. RESOLVED (was a KNOWN GAP): the live coaching UI
// now HAS a dedicated round-start HP input per side -- site/index.html:73-74
// and :391-392, wired at site/app.js:342/:344 -- and
// test-ui-state-reachability.js PART 2 asserts the baseline reaches the engine.
// Corrected at Phase A exit under CLAUDE.md amendment 6 (phase-exit docs
// hygiene); the old text described the pre-fix state and had been stale for
// several sessions.
function buildStartState({ yourHpPct = 100, oppHpPct = 100, yourHpPctAtStart = yourHpPct, oppHpPctAtStart = oppHpPct, yourUsablePartyMons = 2, oppUsablePartyMons = 2, you = null, opp = null, overrides = null } = {}) {
  const freshStages = () => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, evasion: 0, accuracy: 0 });
  // weatherType: null | "rain" | "sun" | "sandstorm" | "hail" — a single
  // GLOBAL condition, not per-side (src/battle_main.c:695, one gBattleWeather
  // variable). weatherTurns: null means either "no weather" (weatherType
  // also null) OR "permanent" (weatherType set, never decrements/expires —
  // Sand Stream etc.); a number means turns remaining (starts at 5 for any
  // of the 4 weather-setting MOVES, src/battle_script_commands.c:6681-6694
  // and siblings — confirmed identical for all 4).
  // Phase D F41: two DIFFERENT setters are not "the player's wins".
  // TryDoEventsBeforeFirstTurn (src/battle_main.c:3850-3879) runs switch-in
  // abilities fastest first -- GetWhoStrikesFirst, Quick Claw draw and a random
  // tie included -- and each overwrites the weather, so the slower setter's
  // stays. Unreachable in the Frontier (Drizzle / Drought are Kyogre's and
  // Groudon's, banned; the pool's one is Tyranitar's Sand Stream), so it
  // throws by name rather than being modelled.
  const wYou = you ? permanentWeatherFromAbility(you) : null, wOpp = opp ? permanentWeatherFromAbility(opp) : null;
  if (wYou && wOpp && wYou !== wOpp) {
    throw new Error(`buildStartState: ${you.species}'s ${you.ability} and ${opp.species}'s ${opp.ability} set different ` +
      `weathers at switch-in; the ROM keeps the SLOWER setter's (TryDoEventsBeforeFirstTurn, speed order with the Quick ` +
      `Claw draw and a random tie) and that order is not modelled -- unreachable in the Frontier (Phase D F41).`);
  }
  const initialWeather = you && opp ? (wYou || wOpp) : null;
  const base = {
    turn: 1,
    yourHpPct, oppHpPct,
    // Captured once here, frozen for the rest of this state's lifetime — no
    // write site anywhere else in this file touches yourHpPctAtStart/
    // oppHpPctAtStart (mirrors hpAtStart never being re-baselined mid-round
    // in source, see the doc comment on this function's signature above).
    yourHpPctAtStart, oppHpPctAtStart,
    weatherType: initialWeather, weatherTurns: null, // null turns = permanent when weatherType is set from an ability

    yourUsablePartyMons, oppUsablePartyMons, // PER-MATCHUP inputs like yourHpPct/oppHpPct, not constants — see analyzeMatchup's comment
    // A5: confusion and infatuation are now tracked on BOTH sides. They used to
    // be you-side only (the field was literally called metagrossConfused),
    // which meant the player could not be given Confuse Ray, Swagger, Attract
    // or Double Team at all — four effects that appear on 127 of the 552
    // opponent sets. A two-sided simulator cannot have one-directional status.
    youConfused: false, oppConfused: false,
    // B2: Taunt (2-turn status-move lock, Cmd_settaunt sets tauntTimer = 2),
    // Wish (heals maxHP/2 when the counter ticks to 0 -- Cmd_trywish sets 2,
    // ENDTURN_WISH decrements, src/battle_util.c:1319-1338), and Ghost-Curse
    // (STATUS2_CURSED, maxHP/4 per end-of-turn, src/battle_util.c:1581-1590).
    youTauntTurns: null, oppTauntTurns: null,
    // B2b batch 2 -- the rest of CheckMoveLimitations (src/battle_util.c:1095-1122).
    // Disable: the locked move plus its timer. Cmd_disablelastusedattack sets
    // (Random() & 3) + 2, enumerated as branches -- see disableTimerBranches.
    youDisabledMove: null, oppDisabledMove: null,
    youDisableTurns: null, oppDisableTurns: null,
    // Encore: Cmd_trysetencore sets (Random() & 3) + 3, i.e. 3..6. PROVEN inert
    // inside a 3-turn round -- a mon is encored on turn t+j while timer > j, and
    // j can only reach 2, so every draw in 3..6 behaves identically. No branch.
    youEncoredMove: null, oppEncoredMove: null,
    youEncoreTurns: null, oppEncoreTurns: null,
    youTormented: false, oppTormented: false,
    // B2b batch 3: what Mirror Move actually copies. NOT gLastMoves -- source
    // reads gBattleStruct->lastTakenMove, written only for a move that is
    // FLAG_MIRROR_MOVE_AFFECTED, hit, had an effect, and came from someone
    // ELSE (MOVEEND_MIRROR_MOVE, src/battle_script_commands.c:4438-4452). A
    // self-targeting boost therefore does NOT become mirrorable, which
    // gLastMoves would have wrongly offered.
    youLastTakenMove: null, oppLastTakenMove: null,
    // B2b batch 4. Spikes layers are laid faithfully (max 3) and can never
    // bite: the damage is a SWITCH-IN effect and the Arena has no switching.
    youSpikesLayers: 0, oppSpikesLayers: 0,
    // B2b batch 6. STATUS3_MUDSPORT / STATUS3_WATERSPORT sit on the USER and
    // halve Electric / Fire POWER for everyone (src/pokemon.c:3215-3218), which
    // calcDamage has read since B7a -- these are the flags that were missing.
    // (folded into volFlags -- B3 batch 7a)
    // B2b batch 7. gDisableStructs.furyCutterCounter, 0..5. In an Arena match
    // the ONLY thing that resets it is a Fury Cutter that misses or has no
    // effect -- source's other two reset sites are item use and a failed run
    // (src/battle_util.c:317, :518), neither of which exists here, and
    // CancelMultiTurnMoves (:887) needs a switch. Notably using a DIFFERENT
    // move does NOT reset it, which is the Gen III behaviour, not an omission.
    youFuryCutter: 0, oppFuryCutter: 0,
    // B2b batch 9. gSideTimers.mistTimer (5 turns, src/battle_script_commands.c
    // :7734-7748) and gDisableStructs.stockpileCounter (0-3).
    youMistTurns: null, oppMistTurns: null,
    // B2b batch 10: STATUS3_ALWAYS_HITS. The flag sits on the TARGET and means
    // the mon that locked on cannot miss it; 1v1 makes "who locked on" implicit.
    youAlwaysHitTurns: null, oppAlwaysHitTurns: null,
    // B2b batch 10: null means "no override". For items, `undefined` means no
    // override and `null` means "overridden to no item at all" -- Trick can
    // legitimately leave a mon holding nothing, and that is different from
    // never having been tricked.
    // gBattleStruct->usedHeldItems: WHAT was consumed, not just that something
    // was. Recycle restores from this, and inferring it from the built mon does
    // not work once the mon's effective item has already been cleared.
    youUsedItem: null, oppUsedItem: null,
    // B2b batch 11: STATUS2_RAGE. Set by a landed Rage, cleared the moment its
    // user picks anything else (src/battle_util.c:1974-1980).
    youRaging: false, oppRaging: false,
    // B3 batch 1: STATUS2_RECHARGE, carried as the LOCKED MOVE rather than a
    // flag, because source keeps one: MOVE_EFFECT_RECHARGE writes
    // gLockedMoves[battler] = gCurrentMove (src/battle_script_commands.c:
    // 2728-2731). The recharging mon is given NO action menu (src/battle_main.c:
    // 4160-4165) and "uses" that move again (src/battle_util.c:107-110), which
    // is what the Mind judge scores (:289). Spent on that attempt, which it
    // forfeits entirely (CANCELER_RECHARGE, src/battle_util.c:2098-2108).
    // `timer` is gDisableStructs.rechargeTimer: 2 when set, decremented in
    // TurnValuesCleanUp (src/battle_main.c:4878-4883), and STATUS2_RECHARGE is
    // dropped when it reaches 0 -- so a recharge that SLEEP or FREEZE pre-empts
    // (both sit above CANCELER_RECHARGE) is not carried into a third turn.
    //   null | { move, timer }        (replaced, never mutated)
    // Deliberately NOT part of `xLock`: CancelMultiTurnMoves does not clear
    // STATUS2_RECHARGE, and a freeze inflicted between the beam and the
    // recharge turn would otherwise wipe it.
    youRecharge: null, oppRecharge: null,
    // B3 batch 4b: the per-turn flags, as one bitmask (TF_* below). All four
    // are cleared together at the end of every turn by advanceTurn.
    //   TF_YOU_FLINCHED / TF_OPP_FLINCHED -- STATUS2_FLINCHED, set by a
    //     flinching hit, consumed by CANCELER_FLINCH, cleared for everyone at
    //     turn end (src/battle_main.c:3943).
    //   TF_YOU_UNABLE / TF_OPP_UNABLE -- the subset of WasUnableToUseMove
    //     (src/battle_util.c:890-904) that does NOT already cancel at its
    //     canceler: full paralysis, a confusion self-hit, a target not
    //     affected. ENDTURN_THRASH reads it.
    // One field instead of four because of the 128-key limit (test-state-
    // shape.js): batch 3 left one key of headroom.
    turnFlags: 0,
    // B3 batch 7a: six permanent-until-cleared volatile flags per side, as one
    // bitmask (VF below): Mud Sport, Water Sport, Focus Energy, Minimize,
    // Defense Curl, Perish Song. Read and written through vf()/setVf(); a
    // legacy override key (e.g. youDefenseCurled: true) is translated by
    // buildStartState. One field instead of twelve: the 128-key limit.
    volFlags: 0,
    // B3 batch 3: the LOCKED-MOVE family, as ONE field per side:
    //   null | { move, kind: "rampage" | "rollout" | "bide" | "uproar", n, dmg? }
    // `move` is gLockedMoves under STATUS2_MULTIPLETURNS (the two-turn charge
    // keeps its own `xCharging`, recharge its own `xRecharge`); a locked mon
    // gets no action menu (src/battle_main.c:4160-4165) and re-uses it. `n` is
    // STATUS2_LOCK_CONFUSE's counter for Rampage (2 or 3 when set,
    // src/battle_script_commands.c:2851-2862) and gDisableStructs.rolloutTimer
    // for Rollout (5 on the first landed hit, -1 per hit, :8536-8569).
    // B3 batch 4d: for Uproar, `n` is STATUS2_UPROAR's counter, (Random() & 3)
    // + 2 when set (src/battle_script_commands.c:2568-2582).
    // B3 batch 4c: for Bide, `n` is STATUS2_BIDE's counter (2 at setbide,
    // src/battle_script_commands.c:7121-7129) and `dmg` is gBideDmg -- the HP
    // it has lost to actions since, accumulated in resolveTurnWithOrder.
    // It is REPLACED, never mutated, so cloneState's shallow copy stays safe --
    // the same discipline as `xCharging`.
    //
    // WHY ONE FIELD AND NOT THREE: this state object is copied on every branch,
    // and V8's object-spread fast path ends at 128 properties. Three scalar
    // fields per side took it from 123 to 131 and made the whole engine 2.9x
    // slower (cloneState 0.6 s -> 19 s of a 55 s profile). See
    // test-state-shape.js, which now fails past 128.
    youLock: null, oppLock: null,
    // B3 batch 5: STATUS2_WRAPPED on this side, with its counter:
    //   null | { move, n }        (replaced, never mutated)
    // Set by a landed Wrap/Bind/Fire Spin/Clamp/Whirlpool/Sand Tomb hit, n =
    // (Random() & 3) + 3 (src/battle_script_commands.c:2611-2635). One field
    // per side, per the 128-key limit.
    youWrapped: null, oppWrapped: null,
    // B3 batch 5b: a pending Future Sight / Doom Desire AIMED AT this side --
    // source indexes gWishFutureKnock by the TARGET (src/battle_script_
    // commands.c:8929-8955):
    //   null | { move, n, dmg }     (replaced, never mutated)
    // n = futureSightCounter (3 when set); dmg = futureSightDmg, fixed at USE
    // time by CalculateBaseDamage -- no STAB, no type chart. The attacker is the
    // other side (1v1).
    youFutureSight: null, oppFutureSight: null,
    // B3 batch 2: gDisableStructs.isFirstTurn for the PLAYER's mon, the
    // counterpart of oppMonFirstTurn below. Fake Out's jumpifnotfirstturn
    // (src/battle_script_commands.c:6786-6794) reads it for whoever uses it.
    // Set to 2 at battle start (src/battle_main.c:3051), decremented once in
    // TryDoEventsBeforeFirstTurn (:3901) and again at the end of turn 1
    // (:3974), so it is nonzero for exactly the first turn.
    youMonFirstTurn: true,
    youAbilityOverride: null, oppAbilityOverride: null,
    // B3 batch 7c: a MOVESET override (Mimic), null | [4 moves], replaced never
    // mutated -- resolved by effectiveMon like the ability and item overrides.
    youMoves: null, oppMoves: null,
    // B3 batch 7d: STATUS2_TRANSFORMED, carrying what Cmd_transformdataexecution
    // copied (every BattlePokemon byte before `pp`, include/pokemon.h:260-281):
    //   null | { species, types, ability, stats, moves, genderDist }
    // `stats` are the five non-HP stats (HP, level, item, status are NOT copied).
    // Resolved by effectiveMon UNDER the ability / moveset / item overrides.
    youTransform: null, oppTransform: null,
    // B8d: a TYPE override (Color Change's SET_BATTLER_TYPE), null | [types],
    // resolved by effectiveMon above Transform.
    youTypes: null, oppTypes: null,
    youItemOverride: undefined, oppItemOverride: undefined,
    // B2b batch 9: gProtectStructs.bounceMove -- Magic Coat, for this turn only.
    youBouncing: false, oppBouncing: false,
    youStockpile: 0, oppStockpile: 0,
    // (folded into volFlags -- B3 batch 7a)
    // STATUS2_NIGHTMARE -- maxHP/4 per end-of-turn, and only while asleep.
    youNightmared: false, oppNightmared: false,
    // STATUS3_IMPRISONED_OTHERS sits on the USER and blocks the FOE from moves
    // the user knows -- asymmetric, hence the separate flag rather than a
    // "cannot use" list on the victim.
    youImprisoning: false, oppImprisoning: false,
    // Choice Band locks its holder into the first move it uses (:1119). Its
    // 1.5x Attack landed in B7a; the LOCK is a selection limitation and belongs
    // here, in the same source function as the rest of this batch.
    youChoiceLock: null, oppChoiceLock: null,
    youWishTurns: null, oppWishTurns: null,
    youCursed: false, oppCursed: false,
    // B2b batch 1 -- the stat-stage family's persistent bits.
    // Foresight (STATUS2_FORESIGHT, Cmd_setforesight src/battle_script_commands.c:
    // 8502-8506): the side that HAS been identified. Two live consequences,
    // both wired: its evasion stage drops out of the accuracy calc (:1127-1131)
    // and Normal/Fighting stop being no-effect against its Ghost typing.
    youForesighted: false, oppForesighted: false,
    // STATUS2_FOCUS_ENERGY -- raises the crit stage by 2. Crits are enumerated
    // in B6, so this is recorded state whose damage consumer arrives there; it
    // already has a live consumer in AI_CBM_FocusEnergy's already-set check.
    // (folded into volFlags -- B3 batch 7a)
    // STATUS2_MINIMIZE -- doubles EFFECT_FLINCH_MINIMIZE_HIT (Stomp/
    // Extrasensory) into this mon; consumed since B4c (sDMG_MULTIPLIER).
    // (folded into volFlags -- B3 batch 7a)
    // STATUS2_DEFENSE_CURL -- doubles EFFECT_ROLLOUT's power; Rollout is still
    // in ACCEPTED_UNMODELED (B3). Tracked so porting Rollout does not have to
    // rediscover it, and so nothing here fails silently.
    // (folded into volFlags -- B3 batch 7a)
    youAttracted: false, oppAttracted: false,
    youStages: freshStages(), oppStages: freshStages(),
    youStatus: null, oppStatus: null, // null | "paralysis" | "freeze" | "burn" | "poison" | "sleep"
    // A3: bad poison (Toxic) is STATUS1_TOXIC_POISON in source, a DIFFERENT
    // status bit from STATUS1_POISON with its own escalating residual
    // (src/battle_util.c:1536-1548 vs :1525-1535). Modelled as the "poison"
    // status plus a counter: null = ordinary poison, a number = bad poison
    // with that many ticks already taken. Kept as a side field rather than a
    // sixth status string so every existing `status === "poison"` check
    // (immunity, berry cure, AI ctx, Facade, etc.) keeps working unchanged.
    youToxicCounter: null, oppToxicCounter: null,
    youSleepTurns: null, oppSleepTurns: null, // turns-remaining counter, rolled ONCE at infliction (see enumerateActionOutcomes)
    youSeeded: false, oppSeeded: false, // Leech Seed — true means THIS side is seeded and drains into the other every end-of-turn
    youMoveHistory: [], // Phase D F2c: BATTLE_HISTORY->usedMoves[player], as the AI has recorded it
    youLastMove: null, oppLastMove: null, // gLastMoves[battler] equivalent — set unconditionally whenever that actor acts (src/battle_script_commands.c:4407, gLastMoves[gBattlerAttacker] = gChosenMove), regardless of hit/prevented. Needed by e.g. AI_CV_DefenseUp/AI_CV_SpDefUp's "was I just hit by a physical/special move" check.
    // Substitute: null = no sub. A number = the sub's REMAINING HP pool
    // (starts at floor(maxHP/4), min 1 — src/battle_script_commands.c:7808-7833).
    // Damage redirects here instead of the real mon's HP until it hits 0
    // (Cmd_datahpupdate, :1865-1892) — see the redirect logic in applyMove.
    youSubstituteHP: null, oppSubstituteHP: null,
    // Reflect/Light Screen: null = inactive, else turns REMAINING (starts at
    // 5, src/battle_script_commands.c:6707/7478). Decremented once per FULL
    // turn (not per-battler — a separate end-of-turn tracker from Leech
    // Seed/poison/burn, src/battle_util.c:1221-1245/1246-1264).
    youReflectTurns: null, oppReflectTurns: null,
    youLightScreenTurns: null, oppLightScreenTurns: null,
    // Safeguard: null = inactive, else turns remaining (starts at 5 — same
    // shape as Reflect/Light Screen). Blocks major-status infliction AND
    // confusion for the protected side. Added ahead of EFFECT_SAFEGUARD's
    // own port so EFFECT_SWAGGER's executor (this batch) can check it
    // correctly now rather than defaulting to a stale always-false value.
    youSafeguardTurns: null, oppSafeguardTurns: null,
    youDestinyBondActive: false, oppDestinyBondActive: false, // single-turn — cleared at the start of that mon's own next turn
    youIngrained: false, oppIngrained: false, // STATUS3_ROOTED — 1/16 max HP heal each end-of-turn, BEFORE Leftovers
    youFlashFireActive: false, oppFlashFireActive: false,
    youCharging: null, oppCharging: null, // null | { move, invulnBit } — semi-invulnerable moves (Dive/Fly/Dig/Bounce)
    youEndureActive: false, oppEndureActive: false, // only true for the turn Endure was used
    youProtected: false, oppProtected: false, // only true for the turn Protect/Detect was used (mirrors youEndureActive — a SEPARATE flag from it, per source: :6521-6524 sets .endured vs .protected distinctly)
    youProtectUses: 0, oppProtectUses: 0, // shared Protect/Endure/Detect consecutive-use decay counter
    youBerryConsumed: false, oppBerryConsumed: false, // status-curing berry (Lum/Cheri/Chesto/etc.) — one-time use, match-long (NOT reset per-turn, see tryCureWithBerry)
    // Yawn: null = not drowsy, else turns until real sleep infliction is
    // attempted (starts at 2 — src/battle_util.c ENDTURN_YAWN, :1753-1771).
    youYawnTurns: null, oppYawnTurns: null,
    // Phase D F2a: BATTLE_HISTORY->abilities[player] -- what the AI has seen of
    // the player's ability (null = nothing recorded). Only the AI reads it.
    youAbilityRecord: null,
    // Perish Song: whether this side has ever been perish-songed this match
    // (Soundproof/already-set exempts a side at cast time — see
    // EFFECT_EXECUTORS.EFFECT_PERISH_SONG for why no countdown/faint field
    // is needed here at all).
    // (folded into volFlags -- B3 batch 7a)
    // Batch 4: the opponent mon's PER-MON first-turn-out state
    // (gDisableStructs.isFirstTurn, the input the batch-1 STOP was blocked
    // on). true = the mon was just sent out / switched in this turn —
    // matches a fresh 1v1's reality, hence the default. Consumed ONLY by
    // the AI-scoring ctx (userPastFirstTurn) — no execution mechanic reads
    // it. DECAY: resolveTurn clears it at every simulated turn advance, so
    // lookahead turns 2+ always score as past-first regardless of input.
    oppMonFirstTurn: true,
    mindYou: 0, mindOpp: 0,
    skillYou: 0, skillOpp: 0,
    // Per-turn damage received, for Counter/Mirror Coat. Reset at the start
    // of each turn (see resolveTurn) — only reflects damage taken THIS turn,
    // matching real mechanics (Counter/Mirror Coat fail if the user acted
    // first, since there's nothing to reflect yet).
    youDamageTaken: null, oppDamageTaken: null, // { amount, category } | null
  };
  // Intimidate fires at SWITCH-IN, which in a 1v1 Arena match is turn 0 of
  // every battle -- before the state this function returns. So it is applied to
  // `base` here, BEFORE overrides are spread, which leaves an explicit
  // caller-supplied stage free to win as it always has.
  applyIntimidateOnSwitchIn(base, you, opp);
  // B8c: TRACE (ABILITYEFFECT_TRACE, src/battle_util.c:3017-3040, run from
  // TryDoEventsBeforeFirstTurn, src/battle_main.c:3882): each Trace holder
  // takes the foe's ability at the start of the match. It runs AFTER the
  // switch-in abilities, so a traced Intimidate does not fire (the tracer never
  // got STATUS3_INTIMIDATE_POKES), and BattleScript_TraceActivates is a plain
  // end3. Two Trace holders both stay Trace.
  if (you.ability === "Trace" && opp.ability) base.youAbilityOverride = opp.ability;
  if (opp.ability === "Trace" && you.ability) base.oppAbilityOverride = you.ability === "Trace" ? "Trace" : you.ability;
  recordBattleStartAbilities(base, you, opp); // Phase D F2a
  // Phase D F16: then the switch-in items, fastest first (src/battle_main.c:
  // 3884-3894). ITEMEFFECT_ON_SWITCH_IN (src/battle_util.c:3305-3330) has one
  // case that can matter here, White Herb, which restores what Intimidate just
  // lowered and is consumed (BattleScript_WhiteHerbEnd2 -> removeitem,
  // data/battle_scripts_1.s:4345-4354) -- the same restore as the end-of-turn
  // case, so it is that code. Each side restores only its own stages, so the
  // order between the two cannot matter. (HOLD_EFFECT_DOUBLE_PRIZE is prize
  // money.) The engine used to leave the drop until the end of turn 1.
  applySwitchInItems(base, you, opp);
  if (!overrides) return snapStartHp(base, you, opp); // unchanged path otherwise
  // B3 batch 7a: a legacy per-flag key becomes its volFlags bit instead of an
  // undeclared property (which would also break the state's shape).
  if (Object.keys(overrides).some((k) => k in VF)) {
    const rest = { ...overrides };
    let bits = rest.volFlags ?? base.volFlags;
    for (const k of Object.keys(VF)) {
      if (!(k in rest)) continue;
      bits = rest[k] ? (bits | VF[k]) : (bits & ~VF[k]);
      delete rest[k];
    }
    overrides = { ...rest, volFlags: bits };
  }
  return snapStartHp({
    ...base,
    ...overrides,
    youStages: { ...base.youStages, ...(overrides.youStages || {}) },
    oppStages: { ...base.oppStages, ...(overrides.oppStages || {}) },
  }, you, opp);
}

// B6 step 1 (amendment 14): HP IS AN INTEGER. The game stores gBattleMons[].hp
// as a u16; this engine stores a percentage, and every damage and heal it
// applies is an integer amount -- but float arithmetic lets the same integer HP,
// reached by two paths, land on two different percentages. That splits one game
// state into several (fatal to a transposition table) and can leave a fainted
// mon at 1e-14% "alive". So the percentage is SNAPPED to its integer HP after
// every action and at every turn end, and at the start: a UI percentage that
// is not a whole HP (50% of an odd max HP) is rounded to the nearest one, as
// the game would never hold anything else.
// B6-1d (found while building B6-2's crit overkill check): the SUBTRACTION itself must be in
// integer HP, not only the snap after it. An exactly lethal hit taken as a float
// percentage left 3.5e-15% behind INSIDE the action, so every in-action "did it
// faint?" test -- Destiny Bond, the secondary-effect gates, the contact
// abilities, Rage -- saw a living target; the snap after the action then set
// it to 0, too late. hpSub / hpAdd take the whole HP, apply the whole amount,
// and write the canonical percentage back.
function hpSub(pct, amt, maxHp) {
  const hp = Math.round((pct * maxHp) / 100) - amt;
  return hp <= 0 ? 0 : (hp * 100) / maxHp;
}
function hpAdd(pct, amt, maxHp) {
  const hp = Math.min(maxHp, Math.round((pct * maxHp) / 100) + amt);
  return (hp * 100) / maxHp;
}
function canonHpPct(pct, maxHp) {
  const hp = Math.round((pct * maxHp) / 100);
  return hp <= 0 ? 0 : (hp * 100) / maxHp;
}
function snapHp(ctx, s) {
  const raw = ctx.raw ?? ctx;
  s.yourHpPct = canonHpPct(s.yourHpPct, raw.you.stats.hp);
  s.oppHpPct = canonHpPct(s.oppHpPct, raw.opp.stats.hp);
}
function snapStartHp(st, you, opp) {
  if (!you || !opp) return st;
  st.yourHpPct = canonHpPct(st.yourHpPct, you.stats.hp);
  st.oppHpPct = canonHpPct(st.oppHpPct, opp.stats.hp);
  st.yourHpPctAtStart = canonHpPct(st.yourHpPctAtStart, you.stats.hp);
  st.oppHpPctAtStart = canonHpPct(st.oppHpPctAtStart, opp.stats.hp);
  return st;
}

// Intimidate. ABILITYEFFECT_ON_SWITCHIN sets STATUS3_INTIMIDATE_POKES
// (src/battle_util.c:2559-2564); ABILITYEFFECT_INTIMIDATE1 (:3003-3016) then
// runs BattleScript_IntimidateActivates (data/battle_scripts_1.s:4024-4048),
// which is `setstatchanger STAT_ATK, 1, TRUE` against the opposing side.
//
// Blocked by, in the script's own order: Substitute (:4029), Clear Body
// (:4030), Hyper Cutter (:4031), White Smoke (:4032). NOT blocked by Protect --
// the stat change carries STAT_CHANGE_NOT_PROTECT_AFFECTED (:4033).
//
// BOTH sides fire if both carry it: each mon is sent out at battle start, so
// each intimidates the other, and the two drops are independent.
//
// The Substitute check is unreachable at turn 0 (a fresh state has no
// substitute up) and is kept anyway rather than dropped, so that the guard
// reads the same as source if this is ever called from a later position.
function intimidateBlocked(mon, state, side) {
  if (mon.ability === "Clear Body" || mon.ability === "Hyper Cutter" || mon.ability === "White Smoke") return true;
  return state[side === "you" ? "youSubstituteHP" : "oppSubstituteHP"] != null;
}
// Phase D F2a: what TryDoEventsBeforeFirstTurn (src/battle_main.c:3862-3883)
// writes to the player's ability history, in its order -- the switch-in
// weather abilities (fastest first; the second of two equal ones does not
// fire), then ABILITYEFFECT_INTIMIDATE1, then ABILITYEFFECT_TRACE. The last two
// are called with battler 0 and the shared record line (src/battle_util.c:3195)
// uses that argument: EVERY Intimidate at the start -- the AI's included --
// records INTIMIDATE as the PLAYER's ability; the AI's Intimidate script then
// records the player's Clear Body / Hyper Cutter / White Smoke if it has one
// (data/battle_scripts_1.s:4030-4032). Trace records the traced ability onto
// battler 0 -- which is the player's resulting ability whichever side traced.
// A speed tie between two equal weather abilities would be a coin flip; every
// weather-ability species has that one ability only (test-d-f2a checks it), so
// the record cannot change the AI's belief and the tie is not branched.
function recordBattleStartAbilities(base, you, opp) {
  if (!you || !opp) return;
  if (permanentWeatherFromAbility(you) && (opp.ability !== you.ability || you.stats.spe > opp.stats.spe)) {
    recordAbility(base, "you", you.ability);
  }
  if (you.ability === "Intimidate" || opp.ability === "Intimidate") recordAbility(base, "you", "Intimidate");
  if (opp.ability === "Intimidate" && base.youSubstituteHP == null
      && ["Clear Body", "Hyper Cutter", "White Smoke"].includes(you.ability)) recordAbility(base, "you", you.ability);
  if (you.ability === "Trace" && opp.ability) recordAbility(base, "you", opp.ability);
  else if (opp.ability === "Trace" && you.ability) recordAbility(base, "you", you.ability);
}
function applySwitchInItems(base, you, opp) {
  if (!you || !opp) return;
  for (const [side, mon] of [["you", you], ["opp", opp]]) {
    if (itemData(mon.item)?.holdEffect === "HOLD_EFFECT_RESTORE_STATS") tryEndOfTurnItem(base, side, mon);
  }
}
function applyIntimidateOnSwitchIn(base, you, opp) {
  if (!you || !opp) return; // stateless callers (some tests) build without mons
  if (you.ability === "Intimidate" && !intimidateBlocked(opp, base, "opp")) {
    bumpStage(base.oppStages, "atk", -1);
  }
  if (opp.ability === "Intimidate" && !intimidateBlocked(you, base, "you")) {
    bumpStage(base.youStages, "atk", -1);
  }
}

function freshTurnDamageTracking(s) {
  // Destiny Bond cleared here too — same "reset at the top of the turn,
  // re-armed within the turn if used again" shape as Endure (CANCELER_FLAGS,
  // src/battle_util.c:2010-2011, clears STATUS2_DESTINY_BOND at the start of
  // the mon's own next action attempt).
  return {
    ...s,
    youDamageTaken: null, oppDamageTaken: null, youEndureActive: false, oppEndureActive: false,
    youProtected: false, oppProtected: false,
    youDestinyBondActive: false, oppDestinyBondActive: false,
  };
}

function cloneState(s) {
  return { ...s, youStages: { ...s.youStages }, oppStages: { ...s.oppStages } };
}

function describeAction(actor, moveName, hit, selfHit, statusPrevented, attractPrevented = false, hitCount = null, calledMove = null, cancelReason = null) {
  const who = actor === "you" ? "You" : "Opp";
  // B2b batch 3: a move-calling move shows BOTH names. Reading "Opp uses Sleep
  // Talk" when the damage came from Earthquake makes every trace ambiguous.
  if (calledMove) {
    const inner = describeAction(actor, calledMove, hit, selfHit, statusPrevented, attractPrevented, hitCount);
    return `${inner.replace(`${who} uses `, `${who} uses ${moveName} -> `)}`;
  }
  // B3 batches 1-2: the single-cause cancelers are prevented turns too, and
  // must not read as paralysis.
  if (cancelReason === "recharge") return `${who} must recharge`;
  if (cancelReason === "truant") return `${who} is loafing around`;
  if (cancelReason === "bideStore") return `${who} is storing energy`;
  if (cancelReason === "flinch") return `${who} flinches`;
  if (cancelReason === "disabled") return `${who} can't use the disabled ${moveName}`;
  if (cancelReason === "taunted") return `${who} can't use ${moveName} after the taunt`;
  if (cancelReason === "imprisoned") return `${who} can't use the sealed ${moveName}`;
  if (statusPrevented) return `${who} is fully paralyzed/frozen and can't move`;
  if (attractPrevented) return `${who} is immobilized by love and can't move`;
  if (selfHit) return `${who} hits itself in confusion`;
  const moveData = MOVES[moveName];
  if (moveData.power === 0) return `${who} uses ${moveName}`;
  if (hit && hitCount != null) return `${who} uses ${moveName} (hits ${hitCount}x)`;
  return `${who} uses ${moveName} (${hit ? "hits" : "MISSES"})`;
}

// B4: the chance secondaries. The CHANCE is battle_moves.h's
// secondaryEffectChance, GENERATED into move-flags.js (`secondaryChance`) --
// this replaces a hand table that knew three moves (Meteor Mash, Ice Beam,
// Thunderbolt), so every other move's secondary was silently never rolled.
//
// SECONDARY_SPEC says WHAT each effect's script queues (`setmoveeffect ...`
// before `goto BattleScript_EffectHit`, data/battle_scripts_1.s), in this
// engine's terms. `status` goes to the target; `self` is a stat change with
// MOVE_EFFECT_AFFECTS_USER; `tri` is MOVE_EFFECT_TRI_ATTACK.
//   Secret Power: Cmd_getsecretpowereffect (:9619-9652) reads
//   gBattleEnvironment, and the Battle Arena's rooms are MAP_TYPE_INDOOR
//   (data/maps/BattleFrontier_BattleArenaBattleRoom/map.json) -> BUILDING
//   (src/battle_setup.c:663-665) -> the default case, PARALYSIS.
//   Bounce: EFFECT_SEMI_INVULNERABLE, but its release queues
//   MOVE_EFFECT_PARALYSIS (`jumpifnotmove MOVE_BOUNCE`, :2003) -- keyed by
//   move, not effect, in secondarySpecFor.
const SECONDARY_SPEC = {
  EFFECT_PARALYZE_HIT: { status: "paralysis" },
  EFFECT_THUNDER: { status: "paralysis" },
  EFFECT_SECRET_POWER: { status: "paralysis" },
  EFFECT_BURN_HIT: { status: "burn" },
  EFFECT_BLAZE_KICK: { status: "burn" },
  EFFECT_THAW_HIT: { status: "burn" },
  EFFECT_FREEZE_HIT: { status: "freeze" },
  EFFECT_POISON_HIT: { status: "poison" },
  EFFECT_POISON_TAIL: { status: "poison" },
  EFFECT_POISON_FANG: { status: "toxic" },
  // Phase D F29: TWINEEDLE sets sMULTIHIT_EFFECT = MOVE_EFFECT_POISON
  // (data/battle_scripts_1.s:1078) and BattleScript_MultiHitLoop copies it into
  // cEFFECT_CHOOSER on EVERY hit (:619), each followed by the move end up to
  // MOVEEND_NEXT_TARGET (:637) -- which includes ITEM_EFFECTS_ALL, so a berry
  // cures between the hits. Its poison was "deliberately not modelled"
  // because no opponent set carried it; B1's 850-set pool does (emulator:
  // traces-given/00800 and 01126, Beedrill poisoning the lead).
  EFFECT_TWINEEDLE: { status: "poison", perHit: 2 },
  EFFECT_TRI_ATTACK: { tri: true },
  EFFECT_ATTACK_UP_HIT: { self: { atk: 1 } },
  // B4b: the stat changes (data/battle_scripts_1.s:1041-1061, :1765, :1773).
  // `foeStat` is MOVE_EFFECT_*_MINUS_1 on the target; `self` carries
  // MOVE_EFFECT_AFFECTS_USER.
  EFFECT_SPECIAL_DEFENSE_DOWN_HIT: { foeStat: "spd" },
  EFFECT_SPEED_DOWN_HIT: { foeStat: "spe" },
  EFFECT_DEFENSE_DOWN_HIT: { foeStat: "def" },
  EFFECT_ATTACK_DOWN_HIT: { foeStat: "atk" },
  EFFECT_ACCURACY_DOWN_HIT: { foeStat: "accuracy" },
  EFFECT_SPECIAL_ATTACK_DOWN_HIT: { foeStat: "spa" },
  EFFECT_DEFENSE_UP_HIT: { self: { def: 1 } },
  // MOVE_EFFECT_ALL_STATS_UP -> BattleScript_AllStatsUp (:3452-3485): skipped
  // outright when all five sit at +6, otherwise each of the five is raised in
  // turn, a stat already at +6 simply not moving. Never accuracy or evasion.
  EFFECT_ALL_STATS_UP_HIT: { self: { atk: 1, def: 1, spe: 1, spa: 1, spd: 1 } },
  // B4c: MOVE_EFFECT_FLINCH (data/battle_scripts_1.s:669, :1272 Snore, :792
  // Sky Attack's release, :1831 Twister and Stomp's BattleScript_FlinchEffect).
  EFFECT_FLINCH_HIT: { flinch: true },
  EFFECT_FLINCH_MINIMIZE_HIT: { flinch: true },
  EFFECT_SNORE: { flinch: true },
  EFFECT_SKY_ATTACK: { flinch: true },
  EFFECT_TWISTER: { flinch: true },
  // B4d: MOVE_EFFECT_CONFUSION (data/battle_scripts_1.s, EffectConfuseHit).
  EFFECT_CONFUSE_HIT: { confuse: true },
};
// B4c: can a flinch change anything? MOVE_EFFECT_FLINCH (:2547-2565) sets
// STATUS2_FLINCHED only while the target's turn is still to come
// (`GetBattlerTurnOrderNum(gEffectBattler) > gCurrentTurnActionNumber`), so a
// SECOND mover flinches nothing -- not branched at all. Inner Focus stops a
// non-certain flinch silently (the certain case is handled by the caller).
// Shield Dust and a Substitute are SetMoveEffect's head, tested by the caller.
function flinchCanLand(foe, isLastToAct) {
  return !isLastToAct && foe.ability !== "Inner Focus";
}
// B4c: KING'S ROCK (ItemBattleEffects ITEMEFFECT_KINGSROCK_SHELLBELL, src/
// battle_util.c:3769-3786, from MOVEEND_KINGSROCK_SHELLBELL): a SECOND,
// independent flinch roll, `Random() % 100 < holdEffectParam` (10), on a move
// with FLAG_KINGS_ROCK_AFFECTED that did not come back NO_EFFECT, damaged the
// target ITSELF (TARGET_TURN_DAMAGED -- a Substitute absorbing it does not
// count) and left it alive. It goes through SetMoveEffect(FALSE, 0): Shield
// Dust, a Substitute and Inner Focus stop it silently, and a second mover
// flinches nothing. Returns the chance, 0 when nothing could land.
function kingsRockChance(ctx, state, actor, moveName, moveData, isLastToAct) {
  const isYou = actor === "you";
  const item = itemData((isYou ? ctx.you : ctx.opp).item);
  if (!item || item.holdEffect !== "HOLD_EFFECT_FLINCH") return 0;
  if (moveData.power === 0 || !moveFlags(moveName).kingsRockAffected) return 0;
  const foe = isYou ? ctx.opp : ctx.you;
  if (!flinchCanLand(foe, isLastToAct) || foe.ability === "Shield Dust") return 0;
  if (state[isYou ? "oppSubstituteHP" : "youSubstituteHP"] != null) return 0;
  if (typeEffectiveness(moveData.type, foe.types, isYou ? state.oppForesighted : state.youForesighted) === 0) return 0;
  return item.param / 100;
}
// B4b: a SECONDARY stat drop goes through ChangeStatBuffs (:6937-7075) with
// flags = 0 -- never MOVE_EFFECT_CERTAIN (so Mist and Clear Body block even a
// 100% drop) and never STAT_CHANGE_ALLOW_PTR (so a block prints nothing and
// costs no Skill). In source order: Mist (:6962), Clear Body / White Smoke
// (:6991), Keen Eye on accuracy (:7009), Hyper Cutter on Attack (:7021), Shield
// Dust (:7033). A stat already at -6 "changes" to -6: nothing to observe.
function secondaryStatDropBlocked(state, side, mon, stat) {
  if (state[side === "you" ? "youMistTurns" : "oppMistTurns"] != null) return true;
  const ab = mon.ability;
  if (ab === "Clear Body" || ab === "White Smoke" || ab === "Shield Dust") return true;
  if (ab === "Keen Eye" && stat === "accuracy") return true;
  if (ab === "Hyper Cutter" && stat === "atk") return true;
  return false;
}
const BOUNCE_SPEC = { status: "paralysis" };
function secondarySpecFor(moveName, moveData) {
  if (moveName === "Bounce") return BOUNCE_SPEC;
  return SECONDARY_SPEC[moveData.effect];
}
// The abilities whose block PRINTS on a CERTAIN status secondary (the
// `primary == TRUE || certain == MOVE_EFFECT_CERTAIN` arms of SetMoveEffect,
// :2300/:2344/:2410/:2440): Immunity, Water Veil, Limber. The string lands in
// DeductSkillPoints. Magma Armor has no such arm -- it only `break`s.
const SECONDARY_PREVENT_ABILITY = { poison: "Immunity", burn: "Water Veil", paralysis: "Limber" };
const SECONDARY_PREVENT_STRING = {
  poison: "STRINGID_PKMNPREVENTSPOISONINGWITH", burn: "STRINGID_PKMNSXPREVENTSBURNS",
  paralysis: "STRINGID_PKMNPREVENTSPARALYSISWITH",
};
// Tri Attack's draw: `Random() % 3 + 3` -> MOVE_EFFECT_BURN / FREEZE / PARALYSIS.
const TRI_ATTACK_STATUSES = ["burn", "freeze", "paralysis"];

// Could this status secondary change the target at all, judged on the state
// BEFORE the action? A NECESSARY condition only -- the dispatch re-checks
// everything -- so the enumerator branches only where the roll is observable
// (the Focus Band collapse rule). Substitute, Shield Dust and type immunity to
// the move itself are tested by the caller.
function secondaryStatusCanLand(ctx, state, side, mon, status) {
  const base = status === "toxic" ? "poison" : status;
  if (state[side === "you" ? "youStatus" : "oppStatus"] != null) return false;
  if (state[side === "you" ? "youSafeguardTurns" : "oppSafeguardTurns"] != null) return false;
  if (STATUS_IMMUNITY_TYPES[base].some((t) => mon.types.includes(t))) return false;
  if (STATUS_IMMUNITY_ABILITIES[base] && mon.ability === STATUS_IMMUNITY_ABILITIES[base]) return false;
  if (base === "freeze" && effectiveWeather(state, ctx.you, ctx.opp) === "sun") return false;
  return true;
}

// The enumerator's half: the weighted outcomes of the roll, or null when there
// is nothing to branch. Each outcome is { q, trig } -- `trig` is true, or for
// Tri Attack the drawn status.
//   percentChance = secondaryEffectChance, doubled by SERENE GRACE (:2912-2915)
//   success: Random() % 100 < percentChance, on a hit that is not NO_EFFECT
//   percentChance >= 100 -> SetMoveEffect(..., MOVE_EFFECT_CERTAIN)
function secondaryOutcomes(ctx, state, actor, moveName, moveData, isLastToAct = false) {
  const own = secondaryOutcomesOwn(ctx, state, actor, moveName, moveData, isLastToAct);
  const kr = kingsRockChance(ctx, state, actor, moveName, moveData, isLastToAct);
  if (kr === 0) return own;
  // King's Rock is independent of the move's own roll. Where the move's own
  // effect IS a flinch, the two collapse into one flinch outcome.
  const spec = secondarySpecFor(moveName, moveData);
  if (spec?.flinch && own) {
    const q = own[0].q;
    return [{ q: 1 - (1 - q) * (1 - kr), trig: own[0].trig }];
  }
  const out = [];
  let rest = 1;
  for (const o of own ?? []) {
    out.push({ q: o.q * kr, trig: { sec: o.trig, kr: true } });
    out.push({ q: o.q * (1 - kr), trig: o.trig });
    rest -= o.q;
  }
  out.push({ q: rest * kr, trig: { sec: false, kr: true } });
  return out;
}
function secondaryOutcomesOwn(ctx, state, actor, moveName, moveData, isLastToAct) {
  const spec = secondarySpecFor(moveName, moveData);
  if (!spec) return null;
  const chance = secondaryChance(moveName);
  if (!chance) return null;
  const isYou = actor === "you";
  const self = isYou ? ctx.you : ctx.opp;
  const foe = isYou ? ctx.opp : ctx.you;
  const pct = self.ability === "Serene Grace" ? chance * 2 : chance;
  const q = Math.min(1, pct / 100);
  if (typeEffectiveness(moveData.type, foe.types, isYou ? state.oppForesighted : state.youForesighted) === 0) return null;
  if (spec.self) {
    const st = isYou ? state.youStages : state.oppStages;
    return Object.keys(spec.self).some((k) => st[k] < 6) ? [{ q, trig: true }] : null;
  }
  // SetMoveEffect's head (:2253-2267): Shield Dust (byte <= 9) and a
  // Substitute stop every target-side secondary here.
  if (foe.ability === "Shield Dust") return null;
  if (state[isYou ? "oppSubstituteHP" : "youSubstituteHP"] != null) return null;
  const foeSide = isYou ? "opp" : "you";
  if (spec.confuse) {
    // MOVE_EFFECT_CONFUSION is byte 7: Safeguard stops it at SetMoveEffect's
    // head (:2257); its own case (:2533-2545) then skips Own Tempo and an
    // existing confusion SILENTLY -- no string, certain or not.
    if (state[isYou ? "oppSafeguardTurns" : "youSafeguardTurns"] != null) return null;
    if (foe.ability === "Own Tempo" || state[isYou ? "oppConfused" : "youConfused"]) return null;
    return [{ q, trig: true }];
  }
  if (spec.flinch) {
    if (flinchCanLand(foe, isLastToAct)) return [{ q, trig: true }];
    // A CERTAIN flinch into Inner Focus prints PKMNSXPREVENTSFLINCHING: Skill.
    return pct >= 100 && foe.ability === "Inner Focus" ? [{ q: 1, trig: true }] : null;
  }
  if (spec.foeStat) {
    if (secondaryStatDropBlocked(state, foeSide, foe, spec.foeStat)) return null;
    return (isYou ? state.oppStages : state.youStages)[spec.foeStat] > -6 ? [{ q, trig: true }] : null;
  }
  if (spec.tri) {
    // MOVE_EFFECT_TRI_ATTACK (:2605-2615): nothing on a statused target, else
    // a uniform draw re-entering SetMoveEffect with every normal check.
    if (state[isYou ? "oppStatus" : "youStatus"] != null) return null;
    const out = [];
    for (const st of TRI_ATTACK_STATUSES) {
      if (secondaryStatusCanLand(ctx, state, foeSide, foe, st)) out.push({ q: q / 3, trig: st });
    }
    return out.length ? out : null;
  }
  if (spec.perHit && secondaryStatusCanLand(ctx, state, foeSide, foe, spec.status)) {
    // F29: one draw per hit; `trig` is the per-hit vector. Nothing observes
    // the order unless the target can cure poison between the hits (a
    // move-end berry) or Synchronize it back, so without those the three
    // "at least one" vectors are one outcome.
    const cures = BERRY_CURE[foe.item]?.includes("poison");
    if (!cures && foe.ability !== "Synchronize") return [{ q: 1 - (1 - q) * (1 - q), trig: [true, false] }];
    return [{ q: q * q, trig: [true, true] }, { q: q * (1 - q), trig: [true, false] }, { q: (1 - q) * q, trig: [false, true] }];
  }
  if (secondaryStatusCanLand(ctx, state, foeSide, foe, spec.status)) return [{ q, trig: true }];
  // A CERTAIN roll into a printing ability is observable through Skill even
  // though nothing lands (Safeguard comes first and prints nothing).
  const base = spec.status === "toxic" ? "poison" : spec.status;
  if (pct >= 100 && foe.ability === SECONDARY_PREVENT_ABILITY[base]
      && state[isYou ? "oppSafeguardTurns" : "youSafeguardTurns"] == null) return [{ q: 1, trig: true }];
  return null;
}

// MOVE_EFFECT_FLINCH through SetMoveEffect: Shield Dust / Substitute / a
// fainted target first (silent), then Inner Focus -- which PRINTS on a certain
// flinch (BattleScript_FlinchPrevention, PKMNSXPREVENTSFLINCHING as the
// attacker: -3 Skill) and is silent otherwise. Setting the flag on a target
// that already acted is harmless: it is cleared at every turn end.
function applyFlinch(ctx, s, actor, foeHadSubstitute, certain) {
  const isYou = actor === "you";
  const foe = isYou ? ctx.opp : ctx.you;
  if (foe.ability === "Shield Dust" || foeHadSubstitute || (isYou ? s.oppHpPct : s.yourHpPct) <= 0) return;
  if (foe.ability === "Inner Focus") {
    if (certain) {
      s[isYou ? "skillYou" : "skillOpp"] -= 3;
      recordAbility(s, isYou ? "opp" : "you", "Inner Focus"); // F2a
    }
    return;
  }
  s.turnFlags |= isYou ? TF_OPP_FLINCHED : TF_YOU_FLINCHED;
}

// The dispatch half, called from applyMoveCore right after the damage and
// BEFORE the fire defrost (seteffectwithchance precedes MOVEEND_DEFROST, so a
// frozen target hit by Fire Punch sees itself still frozen and is not burned).
function applySecondary(ctx, s, actor, moveName, moveData, trig, foeHadSubstitute) {
  if (typeof trig === "object") {
    // { sec, kr }: the move's own outcome, then King's Rock at MOVEEND.
    if (trig.sec) applySecondary(ctx, s, actor, moveName, moveData, trig.sec, foeHadSubstitute);
    applyFlinch(ctx, s, actor, foeHadSubstitute, false);
    return;
  }
  const spec = secondarySpecFor(moveName, moveData);
  const isYou = actor === "you";
  const self = isYou ? ctx.you : ctx.opp;
  const foe = isYou ? ctx.opp : ctx.you;
  if (spec.self) {
    if ((isYou ? s.yourHpPct : s.oppHpPct) <= 0) return; // gEffectBattler hp == 0 (:2261)
    // Increases pass no ability check in ChangeStatBuffs (:6964-7075).
    for (const [k, d] of Object.entries(spec.self)) bumpStage(isYou ? s.youStages : s.oppStages, k, d);
    return;
  }
  if (foe.ability === "Shield Dust") return;          // :2253
  if (foeHadSubstitute) return;                       // :2266 -- still set, even if this hit broke it
  if ((isYou ? s.oppHpPct : s.yourHpPct) <= 0) return; // :2261
  const foeSide = isYou ? "opp" : "you";
  if (spec.confuse) {
    if (s[isYou ? "oppSafeguardTurns" : "youSafeguardTurns"] != null) return;
    const key = isYou ? "oppConfused" : "youConfused";
    if (foe.ability === "Own Tempo" || s[key]) return;
    s[key] = true; // fresh: its first CANCELER_CONFUSED check is check 1
    return;
  }
  if (spec.flinch) {
    const pct = secondaryChance(moveName) * (self.ability === "Serene Grace" ? 2 : 1);
    applyFlinch(ctx, s, actor, foeHadSubstitute, pct >= 100);
    return;
  }
  if (spec.foeStat) {
    // Safeguard does not reach here: the stat bytes are above 7.
    if (secondaryStatDropBlocked(s, foeSide, foe, spec.foeStat)) return;
    bumpStage(isYou ? s.oppStages : s.youStages, spec.foeStat, -1);
    return;
  }
  if (s[isYou ? "oppSafeguardTurns" : "youSafeguardTurns"] != null) return; // :2257, bytes <= 7
  const status = spec.tri ? trig : spec.status;
  const base = status === "toxic" ? "poison" : status;
  const chance = secondaryChance(moveName) * (self.ability === "Serene Grace" ? 2 : 1);
  // Tri Attack's inner SetMoveEffect is called with certain = 0.
  if (!spec.tri && chance >= 100 && foe.ability === SECONDARY_PREVENT_ABILITY[base]) {
    // BattleScript_*Prevention prints through printfromtable, as the ATTACKER
    // (PrepareStringBattle(..., gBattlerAttacker), :2187) -- a flat -3.
    s[isYou ? "skillYou" : "skillOpp"] -= 3;
    return;
  }
  if (base === "freeze" && effectiveWeather(s, ctx.you, ctx.opp) === "sun") return; // :2389-2390
  if (!inflictStatus(s, foeSide, base, foe.types, foe.ability)) return;
  if (status === "toxic") s[isYou ? "oppToxicCounter" : "youToxicCounter"] = 0;
}

// Cmd_setmultihitcounter (src/battle_script_commands.c:7139-7155) — a real
// TWO-ROLL mechanism, not a flat lookup: r = Random()&3; r<=1 -> hits=r+2
// (2 or 3 hits, 25% each); r>1 -> a SECOND independent Random()&3+2 roll,
// uniform over {2,3,4,5} (so 12.5% each, gated behind the 50% chance of
// reaching this branch at all). Collapses to the well-known 3/8, 3/8, 1/8,
// 1/8 distribution for 2/3/4/5 hits — verified via the arithmetic, not
// assumed. EFFECT_DOUBLE_HIT/EFFECT_TWINEEDLE pass a literal instruction
// operand (2) instead of rolling, so they're always exactly 2 hits.
// EFFECT_TWINEEDLE's poison secondary (independent per hit, per source) was
// left out while no opponent set carried Twineedle; Phase D F29 models it
// (SECONDARY_SPEC.EFFECT_TWINEEDLE.perHit).
const MULTI_HIT_DISTRIBUTION = {
  EFFECT_MULTI_HIT: [{ hits: 2, p: 3 / 8 }, { hits: 3, p: 3 / 8 }, { hits: 4, p: 1 / 8 }, { hits: 5, p: 1 / 8 }],
  EFFECT_DOUBLE_HIT: [{ hits: 2, p: 1 }],
  EFFECT_TWINEEDLE: [{ hits: 2, p: 1 }],
};

// Executors ACTUALLY APPLY a move's effect to the state, as opposed to
// AI_HANDLERS which only score the opponent's move *choice*. Two calling
// conventions, matching real game structure:
//  - power === 0 (status moves): called unconditionally on a successful,
//    non-blocked use — the effect IS the move, no separate chance roll.
//  - power > 0: a damaging move's CHANCE secondary no longer runs through
//    this table. Since B4 it is SECONDARY_SPEC -> applySecondary, rolled at
//    battle_moves.h's chance after a confirmed, non-NO_EFFECT hit, exactly
//    where Cmd_seteffectwithchance runs.
// Each executor: (state, actor) => mutates state's stat stages/status directly.
function bumpStage(stages, key, delta) {
  stages[key] = Math.max(-6, Math.min(6, stages[key] + delta));
}

// Cmd_tryhealhalfhealth (src/battle_script_commands.c:6615-6631) — shared by
// EFFECT_RESTORE_HP and EFFECT_SOFTBOILED, always exactly 1/2 max HP,
// regardless of weather. EFFECT_SYNTHESIS/MOONLIGHT/MORNING_SUN instead use
// recoverbasedonsunlight (src/battle_script_commands.c:8867-8875), which
// reads the fraction from weather: no weather (or Cloud-Nine/Air-Lock
// suppressed) -> 1/2 (same as Recover); sun -> 2/3; anything else (rain/
// sandstorm/hail) -> 1/4. Fails ONLY if current HP is EXACTLY at max.
function healHalfMaxHp(s, actor, ctx, moveData) {
  const isYou = actor === "you";
  const selfMon = isYou ? ctx.you : ctx.opp;
  const selfHpKey = isYou ? "yourHpPct" : "oppHpPct";
  // Phase D F37: at full HP both commands jump to BattleScript_AlreadyAtFullHp
  // (data/battle_scripts_1.s:2042-2046), which sets no MOVE_RESULT flag and
  // prints STRINGID_PKMNHPFULL, not a DeductSkillPoints string: +1, as Rest
  // (B3 batch 4d). This returned "failed" (-2).
  if (s[selfHpKey] >= 100) return;
  const isWeatherVariant = ["EFFECT_SYNTHESIS", "EFFECT_MOONLIGHT", "EFFECT_MORNING_SUN"].includes(moveData?.effect);
  let heal;
  if (isWeatherVariant) {
    const weather = effectiveWeather(s, ctx.you, ctx.opp);
    if (weather === "sun") heal = Math.floor((20 * selfMon.stats.hp) / 30);
    else if (weather === "rain" || weather === "sandstorm" || weather === "hail") heal = Math.floor(selfMon.stats.hp / 4);
    else heal = Math.floor(selfMon.stats.hp / 2);
  } else {
    heal = Math.floor(selfMon.stats.hp / 2);
  }
  heal = Math.max(1, heal);
  s[selfHpKey] = hpAdd(s[selfHpKey], heal, selfMon.stats.hp);
}

// Type-based status immunities. Confirmed stable Gen I+ mechanics — NOT
// including Electric-immune-to-paralysis, which is a Gen VI+ change and does
// not apply here (source-confirmed: no such check exists in this codebase).
const STATUS_IMMUNITY_TYPES = {
  poison: ["Poison", "Steel"],
  burn: ["Fire"],
  freeze: ["Ice"],
  paralysis: [],
  sleep: [], // no type has innate sleep immunity in Gen III
};

// Ability-based status immunities — distinct from the type-based table
// above (a mon can be immune via EITHER route independently). Confirmed gap
// caught while pre-flighting Snorlax's Immunity ability: EFFECT_PARALYZE
// (Thunder Wave) already had its OWN inline Limber check, but every OTHER
// status-inflicting path (the secondary-effect _HIT executors, Sleep) had
// no ability check at all — meaning e.g. a poison-secondary move (Sludge
// Bomb, Twineedle) could still poison an Immunity-ability holder. Centralized
// here (same "fix it once, every caller benefits" pattern as the existing
// Substitute/Safeguard checks) rather than duplicated per-executor.
const STATUS_IMMUNITY_ABILITIES = {
  poison: "Immunity",
  paralysis: "Limber",
  burn: "Water Veil",
  freeze: "Magma Armor",
  sleep: null, // Insomnia/Vital Spirit block SLEEP specifically but not via this path (Rest doesn't route through inflictStatus at all, and no opponent secondary-sleep move is modeled yet) — left unmapped rather than guessed
};

// Status-curing berries — HOLD_EFFECT_CURE_PAR/PSN/BRN/FRZ/SLP (single-status
// berries) and HOLD_EFFECT_CURE_STATUS (Lum Berry: all five major statuses
// PLUS confusion). Source-confirmed (src/battle_util.c:3499-3591): Lum Berry
// does NOT cure infatuation/Attract — that's a SEPARATE hold effect
// (HOLD_EFFECT_CURE_ATTRACT, Mental Herb), not modeled since nothing in the
// current roster holds it. Persim Berry (confusion-only) included for
// completeness even though nothing currently holds it either.
const BERRY_CURE = {
  "Cheri Berry": ["paralysis"],
  "Chesto Berry": ["sleep"],
  "Pecha Berry": ["poison"],
  "Rawst Berry": ["burn"],
  "Aspear Berry": ["freeze"],
  "Persim Berry": ["confusion"],
  "Lum Berry": ["paralysis", "sleep", "poison", "burn", "freeze", "confusion"],
};

// Timing -- CORRECTED by Phase D F28: the cure ALSO runs at every move end
// (MOVEEND_ITEM_EFFECTS_ALL -> ITEMEFFECT_MOVE_END, src/battle_script_commands.c:
// 4330-4335; src/battle_util.c:3625-3740), from applyMove; the paragraph below
// described only the end-of-turn call, and its "a status inflicted early in a
// turn still fully applies to that turn's OWN action" is wrong: the berry cures
// it before the holder acts.
// (Original note:) Timing (confirmed from source, both ENDTURN_ITEMS1 and ENDTURN_ITEMS2 call
// the SAME ItemBattleEffects(ITEMEFFECT_NORMAL, ...) switch, gated on nothing
// but "does this status exist right now" — no moveTurn check on any cure
// case): this is an END-OF-TURN check, NOT immediate-on-infliction. ITEMS1
// sits BEFORE LEECH_SEED/POISON/BAD_POISON/BURN in the per-battler ENDTURN_*
// sequence (src/battle_util.c:1442-1460), so a berry cure fires before that
// same turn's poison/burn residual tick — a Cheri/Lum holder poisoned THIS
// turn does NOT take that turn's poison damage. But since curing only
// happens at THIS point (after both sides have already acted this turn), a
// status inflicted early in a turn still fully applies to that turn's OWN
// action (e.g. the 25% full-paralysis roll) if the afflicted mon hasn't
// acted yet — only guaranteed gone starting the FOLLOWING turn. One-time
// consumption tracked via youBerryConsumed/oppBerryConsumed (buildStartState) —
// NOT reset per-turn (unlike youEndureActive etc.), since it's a match-long,
// single-use flag.
function tryCureWithBerry(s, side, mon) {
  const consumedKey = side === "you" ? "youBerryConsumed" : "oppBerryConsumed";
  const statusKey = side === "you" ? "youStatus" : "oppStatus";
  const sleepTurnsKey = side === "you" ? "youSleepTurns" : "oppSleepTurns";
  const toxicKey = side === "you" ? "youToxicCounter" : "oppToxicCounter";
  if (s[consumedKey]) return;
  // F28: the item HELD now (a Trick may have moved one), as ItemBattleEffects
  // reads gBattleMons[battler].item
  const itemKey = side === "you" ? "youItemOverride" : "oppItemOverride";
  const held = s[itemKey] !== undefined ? s[itemKey] : mon.item;
  const cures = BERRY_CURE[held];
  if (!cures) return;
  let used = false;
  if (s[statusKey] && cures.includes(s[statusKey])) {
    const wasAsleep = s[statusKey] === "sleep";
    s[statusKey] = null;
    s[sleepTurnsKey] = null;
    s[toxicKey] = null; // A3: curing the poison clears the bad-poison counter with it
    // Every sleep-clearing site in source clears STATUS2_NIGHTMARE with it —
    // HOLD_EFFECT_CURE_SLP at src/battle_util.c:3546 and :3692,
    // HOLD_EFFECT_CURE_STATUS at :3570 and :3725. A Chesto/Lum cure is one of
    // those sites.
    if (wasAsleep) s[side === "you" ? "youNightmared" : "oppNightmared"] = false;
    used = true;
  }
  // Confusion is STATUS2 (volatile), tracked separately from the major-status
  // field above — only "you" can currently be confused (see youConfused's
  // existing one-directional limitation), so this only ever matters for the
  // player's own side.
  const confKey = side === "you" ? "youConfused" : "oppConfused";
  if (s[confKey] && cures.includes("confusion")) {
    s[confKey] = false;
    used = true;
  }
  if (used) {
    s[consumedKey] = true;
    s[side === "you" ? "youUsedItem" : "oppUsedItem"] = held;
    // B2b batch 10: a consumed berry now also clears the HELD ITEM, because
    // items became state-mutable in this batch and "consumed" has to mean
    // "not held any more" for Recycle and Trick to be right. Before the
    // override existed there was nowhere to write this, and the consumed flag
    // alone carried the meaning.
    s[side === "you" ? "youItemOverride" : "oppItemOverride"] = null;
  }
}

// B7: EVERY battle hold effect in the ROM, each in EXACTLY ONE bucket. There
// are 66 of them (src/data/items.h at a3c551fe); the Lv50 opponent pool uses 29
// and the player side can hold any of the rest, so a table that only covered
// the pool is how a player-held Pecha Berry ended up tripping the end-of-turn
// exhaustiveness throw during B7b.
//
// Buckets:
//   damage-chain   applied inside calcDamage (B7a)
//   end-of-turn    applied by tryEndOfTurnItem below (B7b)
//   cure-berry     applied by tryCureWithBerry (pre-existing)
//   leftovers      applied inline in applyEndOfTurnEffects (pre-existing)
//   deferred       real in battle, PORTED IN A NAMED LATER PHASE, counted not hidden
//   inert          genuinely does nothing in an Arena battle, with the reason
//   unmodelled     real in battle, NOT ported -> tryEndOfTurnItem THROWS on it
//
// The test asserts this table covers all 66 with no effect in two buckets and
// none missing, so a new item can never quietly do nothing.
const HOLD_EFFECT_DISPOSITION = new Map([
  // -- damage-chain (B7a) -------------------------------------------------
  ["HOLD_EFFECT_CHOICE_BAND", ["damage-chain", "1.5x Attack"]],
  ["HOLD_EFFECT_THICK_CLUB", ["damage-chain", "2x Attack, Cubone/Marowak"]],
  ["HOLD_EFFECT_DEEP_SEA_TOOTH", ["damage-chain", "2x SpAttack, Clamperl"]],
  ["HOLD_EFFECT_DEEP_SEA_SCALE", ["damage-chain", "2x SpDefense, Clamperl"]],
  ["HOLD_EFFECT_LIGHT_BALL", ["damage-chain", "2x SpAttack, Pikachu"]],
  ["HOLD_EFFECT_METAL_POWDER", ["damage-chain", "2x Defense, Ditto"]],
  // -- end-of-turn (B7b) --------------------------------------------------
  ["HOLD_EFFECT_RESTORE_HP", ["end-of-turn", "Sitrus/Oran/Berry Juice"]],
  ["HOLD_EFFECT_RESTORE_STATS", ["end-of-turn", "White Herb"]],
  ["HOLD_EFFECT_ATTACK_UP", ["end-of-turn", "Liechi"]],
  ["HOLD_EFFECT_DEFENSE_UP", ["end-of-turn", "Ganlon"]],
  ["HOLD_EFFECT_SPEED_UP", ["end-of-turn", "Salac"]],
  ["HOLD_EFFECT_SP_ATTACK_UP", ["end-of-turn", "Petaya"]],
  ["HOLD_EFFECT_SP_DEFENSE_UP", ["end-of-turn", "Apicot"]],
  ["HOLD_EFFECT_CRITICAL_UP", ["end-of-turn", "Lansat — sets STATUS2_FOCUS_ENERGY"]],
  ["HOLD_EFFECT_CURE_ATTRACT", ["end-of-turn", "Mental Herb"]],
  ["HOLD_EFFECT_SHELL_BELL", ["end-of-turn", "applied at damage time in applyMove, not here"]],
  // -- cure berries (pre-existing) ----------------------------------------
  ["HOLD_EFFECT_CURE_STATUS", ["cure-berry", "Lum"]],
  ["HOLD_EFFECT_CURE_PAR", ["cure-berry", "Cheri"]],
  ["HOLD_EFFECT_CURE_SLP", ["cure-berry", "Chesto"]],
  ["HOLD_EFFECT_CURE_PSN", ["cure-berry", "Pecha"]],
  ["HOLD_EFFECT_CURE_BRN", ["cure-berry", "Rawst"]],
  ["HOLD_EFFECT_CURE_FRZ", ["cure-berry", "Aspear"]],
  ["HOLD_EFFECT_CURE_CONFUSION", ["cure-berry", "Persim"]],
  ["HOLD_EFFECT_LEFTOVERS", ["leftovers", "applied inline just above the cure berries"]],
  // -- deferred to a named phase ------------------------------------------
  ["HOLD_EFFECT_SCOPE_LENS", ["move-time", "B6-2 — a crit-stage term in critChanceFor"]],
  ["HOLD_EFFECT_LUCKY_PUNCH", ["move-time", "B6-2 — a crit-stage term in critChanceFor"]],
  ["HOLD_EFFECT_STICK", ["move-time", "B6-2 — a crit-stage term in critChanceFor"]],
  ["HOLD_EFFECT_FLINCH", ["move-time", "B4c — King's Rock's roll, in secondaryOutcomes / kingsRockChance; its flinch goes through applyFlinch"]],
  ["HOLD_EFFECT_QUICK_CLAW", ["deferred", "B7c — turn order"]],
  ["HOLD_EFFECT_EVASION_UP", ["deferred", "B7c — BrightPowder, the accuracy path"]],
  ["HOLD_EFFECT_FOCUS_BAND", ["deferred", "B7c — a per-hit survival roll"]],
  // -- inert in an Arena battle, each with its reason ----------------------
  ["HOLD_EFFECT_SOUL_DEW", ["inert", "source DISABLES it under BATTLE_TYPE_FRONTIER (src/pokemon.c:3187) and BATTLE_TYPE_ARENA is inside that mask"]],
  ["HOLD_EFFECT_RESTORE_PP", ["inert", "Leppa — PP is not modelled and 3 turns cannot exhaust it"]],
  ["HOLD_EFFECT_MACHO_BRACE", ["inert", "EV training, not a battle effect"]],
  ["HOLD_EFFECT_EXP_SHARE", ["inert", "experience, not a battle effect"]],
  ["HOLD_EFFECT_LUCKY_EGG", ["inert", "experience, not a battle effect"]],
  ["HOLD_EFFECT_FRIENDSHIP_UP", ["inert", "friendship growth, not a battle effect"]],
  ["HOLD_EFFECT_DOUBLE_PRIZE", ["inert", "prize money, not a battle effect"]],
  ["HOLD_EFFECT_REPEL", ["inert", "overworld encounters"]],
  ["HOLD_EFFECT_PREVENT_EVOLVE", ["inert", "evolution, not a battle effect"]],
  ["HOLD_EFFECT_CAN_ALWAYS_RUN", ["inert", "fleeing, which the Arena forbids anyway"]],
  ["HOLD_EFFECT_DRAGON_SCALE", ["inert", "trade evolution, not a battle effect"]],
  ["HOLD_EFFECT_UP_GRADE", ["inert", "trade evolution, not a battle effect"]],
  // -- unmodelled: real in battle, NOT ported, THROWS ----------------------
  ["HOLD_EFFECT_CONFUSE_SPICY", ["unmodelled", "Figy — pinch heal + nature-flavour confusion"]],
  ["HOLD_EFFECT_CONFUSE_DRY", ["unmodelled", "Wiki — pinch heal + nature-flavour confusion"]],
  ["HOLD_EFFECT_CONFUSE_SWEET", ["unmodelled", "Mago — pinch heal + nature-flavour confusion"]],
  ["HOLD_EFFECT_CONFUSE_BITTER", ["unmodelled", "Aguav — pinch heal + nature-flavour confusion"]],
  ["HOLD_EFFECT_CONFUSE_SOUR", ["unmodelled", "Iapapa — pinch heal + nature-flavour confusion"]],
  ["HOLD_EFFECT_RANDOM_STAT_UP", ["unmodelled", "Starf — +2 to a RANDOM stat, needs its own weighted branches"]],
]);
// The 17 type-boost effects are damage-chain too, and are listed by
// HOLD_EFFECT_BOOSTED_TYPE rather than repeated here.
for (const eff of Object.keys(HOLD_EFFECT_BOOSTED_TYPE)) {
  HOLD_EFFECT_DISPOSITION.set(eff, ["damage-chain", `1.1x ${HOLD_EFFECT_BOOSTED_TYPE[eff]} damage`]);
}

// B7b: the ITEMEFFECT_NORMAL end-of-turn cases that are NOT status cures (those
// are tryCureWithBerry) — src/battle_util.c:3336-3455. A mon holds exactly one
// item, so every case here is mutually exclusive with every other AND with the
// cure berries, which is why they share one single-use flag.
function tryEndOfTurnItem(s, side, mon) {
  // itemData() returns null for "no item" (null, "" or the literal "None") and
  // undefined for a name the ROM data does not have -- which is a real error,
  // not an absent item, so the two cases are kept apart deliberately.
  const d = itemData(mon.item);
  if (d === null) return;
  if (d === undefined) {
    throw new Error(`Held item "${mon.item}" is not in item-data.js — regenerate it with ` +
      `arena-solver/tools/gen-item-table.mjs, or fix the spelling, before this position can be solved.`);
  }
  const consumedKey = side === "you" ? "youBerryConsumed" : "oppBerryConsumed";
  const hpKey = side === "you" ? "yourHpPct" : "oppHpPct";
  const stages = side === "you" ? s.youStages : s.oppStages;
  const maxHp = mon.stats.hp;
  const curHp = Math.round((s[hpKey] / 100) * maxHp);

  switch (d.holdEffect) {
    // Sitrus Berry. At hp <= maxHP/2, restore a FLAT `param` HP (30) capped at
    // max — a flat number, NOT a fraction of max HP (:3336-3345).
    case "HOLD_EFFECT_RESTORE_HP": {
      if (s[consumedKey] || curHp > Math.floor(maxHp / 2)) return;
      s[hpKey] = hpAdd(s[hpKey], d.param, maxHp);
      s[consumedKey] = true;
      s[side === "you" ? "youUsedItem" : "oppUsedItem"] = mon.item;
      s[side === "you" ? "youItemOverride" : "oppItemOverride"] = null;
      return;
    }
    // White Herb. Every stage BELOW default goes back to default; stages ABOVE
    // it are untouched, so a mon that is +2/-1 keeps the +2. Consumed only if it
    // actually restored something — source sets `effect` inside the loop and
    // only runs the script when `effect != 0` (:3383-3397).
    case "HOLD_EFFECT_RESTORE_STATS": {
      if (s[consumedKey]) return;
      let restored = false;
      for (const k of Object.keys(stages)) {
        if (stages[k] < 0) { stages[k] = 0; restored = true; }
      }
      if (restored) {
        s[consumedKey] = true;
        s[side === "you" ? "youUsedItem" : "oppUsedItem"] = mon.item;
        s[side === "you" ? "youItemOverride" : "oppItemOverride"] = null;
      }
      return;
    }
    // Liechi / Salac / Petaya. At hp <= maxHP/param (param is 4, so a quarter),
    // +1 to their own stat, and only while that stat is below MAX_STAT_STAGE
    // (:3429-3455). Note the threshold divisor is the PARAM, not a constant.
    case "HOLD_EFFECT_ATTACK_UP":
    case "HOLD_EFFECT_DEFENSE_UP":
    case "HOLD_EFFECT_SPEED_UP":
    case "HOLD_EFFECT_SP_ATTACK_UP":
    case "HOLD_EFFECT_SP_DEFENSE_UP": {
      if (s[consumedKey]) return;
      const stat = PINCH_BERRY_STAT[d.holdEffect];
      if (curHp > Math.floor(maxHp / d.param)) return;
      if (stages[stat] >= 6) return;
      bumpStage(stages, stat, 1);
      s[consumedKey] = true;
      return;
    }
    // Lansat Berry. At the same quarter-HP threshold, sets STATUS2_FOCUS_ENERGY
    // instead of a stat stage, and only if it is not already set (:3457-3465).
    // The flag itself is real state from B2b batch 1; its damage consumer is B6.
    case "HOLD_EFFECT_CRITICAL_UP": {
      if (s[consumedKey]) return;
      const feKey = side === "you" ? "youFocusEnergy" : "oppFocusEnergy";
      if (curHp > Math.floor(maxHp / d.param) || vf(s, feKey)) return;
      setVf(s, feKey, true);
      s[consumedKey] = true;
      return;
    }
    // Mental Herb. Clears infatuation; no HP threshold (src/battle_util.c:3312).
    // Reachable since A5 made either side infatuable.
    case "HOLD_EFFECT_CURE_ATTRACT": {
      if (s[consumedKey]) return;
      const attKey = side === "you" ? "youAttracted" : "oppAttracted";
      if (!s[attKey]) return;
      s[attKey] = false;
      s[consumedKey] = true;
      return;
    }
    default: {
      const disp = HOLD_EFFECT_DISPOSITION.get(d.holdEffect);
      if (disp && disp[0] !== "unmodelled") return; // handled elsewhere, deferred with a name, or inert with a reason
      if (disp) {
        throw new Error(`"${mon.item}" carries ${d.holdEffect} (${disp[1]}), which is real in battle and ` +
          `NOT ported. It is on the unmodelled list deliberately -- port it before this position can be solved.`);
      }
      throw new Error(`"${mon.item}" carries ${d.holdEffect}, which is in NO bucket of ` +
        `HOLD_EFFECT_DISPOSITION at all — classify it there before this position can be solved. ` +
        `Silently doing nothing is the exact failure B7 exists to remove.`);
    }
  }
}

const PINCH_BERRY_STAT = {
  HOLD_EFFECT_ATTACK_UP: "atk",       // Liechi
  HOLD_EFFECT_DEFENSE_UP: "def",      // Ganlon
  HOLD_EFFECT_SPEED_UP: "spe",        // Salac
  HOLD_EFFECT_SP_ATTACK_UP: "spa",    // Petaya
  HOLD_EFFECT_SP_DEFENSE_UP: "spd",   // Apicot
};

function inflictStatus(s, targetSide, statusType, targetTypes, targetAbility = null) {
  const statusKey = targetSide === "you" ? "youStatus" : "oppStatus";
  const subKey = targetSide === "you" ? "youSubstituteHP" : "oppSubstituteHP";
  const safeguardKey = targetSide === "you" ? "youSafeguardTurns" : "oppSafeguardTurns";
  // Substitute blocks major-status infliction entirely (well-established
  // Gen I-III rule — the sub "takes the hit" instead of the real mon).
  // Centralized here so every status-inflicting executor gets this for
  // free, including the pre-existing EFFECT_PARALYZE_HIT/FREEZE_HIT/
  // BURN_HIT/POISON_HIT secondary effects that funnel through this same
  // function — this was a real gap before Substitute existed at all.
  if (s[subKey]) return false;
  // Safeguard blocks status inflicted BY THE OPPONENT (self-inflicted status
  // like Rest's sleep still works — Rest doesn't route through this
  // function at all, so that distinction falls out for free).
  if (s[safeguardKey] != null) return false;
  if (s[statusKey]) return false; // major statuses don't stack
  // B3 batch 4d: an uproar blocks sleep for anything not Soundproof.
  if (statusType === "sleep" && uproarActive(s) && targetAbility !== "Soundproof") return false;
  if (STATUS_IMMUNITY_TYPES[statusType].some((t) => targetTypes.includes(t))) return false;
  if (targetAbility != null && targetAbility === STATUS_IMMUNITY_ABILITIES[statusType]) return false;
  s[statusKey] = statusType;
  // B3 batch 2: SetMoveEffect calls CancelMultiTurnMoves when it inflicts
  // SLEEP (src/battle_script_commands.c:2296) or FREEZE (:2392), and for no
  // other status.
  if (statusType === "sleep" || statusType === "freeze") cancelMultiTurnMoves(s, targetSide);
  return true;
}

// B3 batch 2: CancelMultiTurnMoves (src/battle_util.c:877-888), ported as ONE
// function called from every site source calls it from that this engine can
// reach -- the recharge, flinch, disabled, taunted, imprisoned and in-love
// cancelers, a Protect-blocked attack, and sleep/freeze infliction. Of what it
// clears, this engine models two things: STATUS2_MULTIPLETURNS together with
// STATUS3_SEMI_INVULNERABLE (a two-turn move's pending release, `xCharging`)
// and furyCutterCounter. LOCK_CONFUSE, UPROAR, BIDE and rolloutTimer belong to
// effects that were still ledgered then; B3 batch 3 added Rampage's and
// Rollout's. Uproar and Bide must add theirs when they land.
function cancelMultiTurnMoves(s, side) {
  const isYou = side === "you";
  s[isYou ? "youCharging" : "oppCharging"] = null;
  s[isYou ? "youFuryCutter" : "oppFuryCutter"] = 0;
  // B3 batch 3: STATUS2_MULTIPLETURNS for the locked family, with its
  // LOCK_CONFUSE counter or rolloutTimer.
  s[isYou ? "youLock" : "oppLock"] = null;
}

// B3 batch 4d: UproarWakeUpCheck (src/battle_script_commands.c:6801-6826) --
// TRUE when ANY battler is in an uproar and the battler asked about is not
// Soundproof. It gates every way into sleep: SetMoveEffect's sleep case
// (:2274-2285), jumpifcantmakeasleep (:6828-6846, used by sleep moves, Rest and
// Yawn), ENDTURN_YAWN (src/battle_util.c:1759) -- and it WAKES a sleeper at
// CANCELER_ASLEEP (:2017-2025).
function uproarActive(s) {
  return s.youLock?.kind === "uproar" || s.oppLock?.kind === "uproar";
}
function uproarKeepsAwake(s, mon) {
  return uproarActive(s) && mon.ability !== "Soundproof";
}

// IsTwoTurnsMove (src/battle_script_commands.c:8196-8207).
const TWO_TURN_EFFECTS = new Set(["EFFECT_SKULL_BASH", "EFFECT_RAZOR_WIND", "EFFECT_SKY_ATTACK",
  "EFFECT_SOLAR_BEAM", "EFFECT_SEMI_INVULNERABLE", "EFFECT_BIDE"]);

// Shared executor shape for the whole stat-DECREASE family (Sand-Attack/
// Flash/SmokeScreen/Screech/Scary Face/Charm/Fake Tears/Sweet Scent) —
// BattleScript_EffectStatDown (data/battle_scripts_1.s:534-554): Substitute
// blocks entirely; Clear Body/White Smoke block EVERY stat decrease; Keen
// Eye blocks accuracy-decreases specifically and Hyper Cutter blocks
// Attack-decreases specifically (src/battle_script_commands.c:4142-4145) —
// note EXECUTION checks Hyper Cutter but the AI's own SCORING (AI_CBM_AttackDown)
// does not, a real asymmetry preserved in AI_HANDLERS above, not "fixed" here.
// A5: the side an opponent-targeting confusion effect lands on. Confusion,
// Swagger and Attract all target the FOE of whoever used the move.
function confusionTarget(s, actor, ctx) {
  const isYou = actor === "you";
  return {
    mon: isYou ? ctx.opp : ctx.you,
    confKey: isYou ? "oppConfused" : "youConfused",
    subKey: isYou ? "oppSubstituteHP" : "youSubstituteHP",
    safeguardKey: isYou ? "oppSafeguardTurns" : "youSafeguardTurns",
    stages: isYou ? s.oppStages : s.youStages,
  };
}

// BattleScript_EffectSwagger (data/battle_scripts_1.s:1608-1628) and
// BattleScript_EffectFlatter (:2151-2171) are the SAME SCRIPT with a different
// (stat, amount): substitute check, jumpifconfusedandstatmaxed, the raise, then
// a shared TryConfuse tail. They are built from one function here for that
// reason — two hand-written copies is how a clause gets ported into one and not
// the other (amendments 9 and 10).
function raiseThenConfuseExecutor(stageKey, amount) {
  return (s, actor, ctx) => {
    const t = confusionTarget(s, actor, ctx);
    // ONE substitute check gates the ENTIRE move (both the raise AND the
    // confusion) — misses outright if the target has an active sub.
    if (s[t.subKey] != null) return "failed";
    // Also fails outright (jumpifconfusedandstatmaxed) if the target is
    // ALREADY confused AND the stat is already maxed — a narrower, separate
    // fail condition from the substitute one. Either alone still works.
    if (s[t.confKey] && t.stages[stageKey] >= 6) return "failed";
    // The raise ALWAYS lands (silently capped) regardless of what happens to
    // the confusion attempt below — source gates these two parts
    // INDEPENDENTLY, not as a single all-or-nothing effect.
    bumpStage(t.stages, stageKey, amount);
    // Confusion is separately blocked by Own Tempo/Safeguard (but does NOT
    // fail the move as a whole — the raise above still landed either way),
    // and does not restack on an already-confused target.
    if (t.mon.ability !== "Own Tempo" && s[t.safeguardKey] == null) {
      if (!s[t.confKey]) s[t.confKey] = true;
    }
  };
}

function statDownExecutor(stageKey, amount, blockingAbility) {
  return (s, actor, ctx) => {
    const foeMon = actor === "you" ? ctx.opp : ctx.you;
    const foeSubKey = actor === "you" ? "oppSubstituteHP" : "youSubstituteHP";
    if (s[foeSubKey]) return "failed";
    // B2b batch 9: Mist. Cmd_statbuffchange (:6958-6968) blocks a stat DECREASE
    // while the target's side has mistTimer running, unless the change is
    // `certain` or the move is Curse. Every stat-lowering MOVE in this engine
    // routes through this one function, which is why the check belongs here.
    // Phase D F36: and it is NOT a failure. BattleScript_MistProtected
    // (data/battle_scripts_1.s:3343-3347) sets no MOVE_RESULT flag and its
    // STRINGID_PKMNPROTECTEDBYMIST is not a deducting string
    // (src/battle_arena.c:628-651): AddSkillPoints' final else, +1.
    if (s[actor === "you" ? "oppMistTurns" : "youMistTurns"] != null) return;
    const foeSideRec = actor === "you" ? "opp" : "you";
    if (foeMon.ability === "Clear Body" || foeMon.ability === "White Smoke"
        || (blockingAbility && foeMon.ability === blockingAbility)) {
      recordAbility(s, foeSideRec, foeMon.ability); // F2a: ChangeStatBuffs :7003 / :7018 / :7031
      return "failed";
    }
    const foeStages = actor === "you" ? s.oppStages : s.youStages;
    bumpStage(foeStages, stageKey, -amount);
  };
}

// Exact 10-move Soundproof block list (src/battle_util.c sSoundMovesTable) —
// this is Gen III's move pool specifically; later games add more sound moves.
const SOUND_MOVES = new Set([
  "Growl", "Roar", "Sing", "Supersonic", "Screech", "Snore",
  "Uproar", "Metal Sound", "GrassWhistle", "Hyper Voice",
]);

// Like typeEffectiveness, but also reports whether any individual defending
// type contributed a super-effective or not-very-effective component —
// needed for Wonder Guard's "both SE and NVE simultaneously still blocks"
// rule on dual-typed defenders, which the single combined multiplier loses.
function typeEffectivenessBreakdown(moveType, defTypes, foresighted = false) {
  const chart = TYPE_CHART[moveType] || {};
  const piercesGhost = foresighted && (moveType === "Normal" || moveType === "Fighting");
  let hadSuper = false, hadNVE = false;
  for (const t of defTypes) {
    if (piercesGhost && t === "Ghost") continue; // same skipped row as typeEffectiveness
    const m = chart[t] !== undefined ? chart[t] : 1;
    if (m > 1) hadSuper = true;
    if (m < 1 && m > 0) hadNVE = true;
  }
  return { hadSuper, hadNVE };
}

// Ability-block Skill deltas — deliberately NOT one flat number. Two
// INDEPENDENT pokeemerald mechanisms both write to arenaSkillPoints for the
// same move: BattleArena_AddSkillPoints (src/battle_arena.c:588-622, fired
// from Cmd_end, src/battle_script_commands.c:3950-3957 — once per move,
// branches on gMoveResultFlags) and BattleArena_DeductSkillPoints
// (src/battle_arena.c:624-652, fired from PlayerHandlePrintString /
// OpponentHandlePrintString — src/battle_controller_player.c:2543-2555,
// src/battle_controller_opponent.c:1522-1533 — once per matching printed
// string, mid-script, well before Cmd_end runs). Neither gates the other, so
// both fire for every ability block; the two mechanisms disagree on which
// abilities cost what, and the combined total is per-ability, not a shared
// constant:
//
// Wonder Guard / Levitate — both scored -2, DeductSkillPoints contributes 0:
//   Cmd_typecalc (src/battle_script_commands.c:1409-1419 Wonder Guard,
//   1375-1383 Levitate) sets MOVE_RESULT_MISSED (Levitate also sets
//   MOVE_RESULT_DOESNT_AFFECT_FOE), MISS_TYPE = B_MSG_AVOIDED_DMG /
//   B_MSG_GROUND_MISS. AddSkillPoints' NO_EFFECT branch fires (-2,
//   battle_arena.c:600-604: `!(MISSED) || MISS_TYPE != B_MSG_PROTECTED` is
//   true either way, since MISS_TYPE is neither case B_MSG_PROTECTED here).
//   The miss-strings this prints (STRINGID_AVOIDEDDAMAGE,
//   STRINGID_PKMNMAKESGROUNDMISS — src/battle_message.c:895-896) are NOT
//   among the 18 strings DeductSkillPoints matches (battle_arena.c:630-649),
//   so it contributes 0. Net: -2 + 0 = -2.
//   CAVEAT: verified for ordinary power-based attacks routing through the
//   standard Cmd_typecalc immunity block; NOT exhaustively re-checked
//   against OHKO/fixed-damage move variants, which may resolve
//   effectiveness through a different path.
//
// Soundproof / Flash Fire — both scored -2, via the OPPOSITE split (+1 / -3):
//   Soundproof blocks at Cmd_attackcanceler (AbilityBattleEffects
//   ABILITYEFFECT_MOVES_BLOCK, src/battle_util.c:2659-2674); Flash Fire
//   blocks at the accuracycheck-adjacent ABILITYEFFECT_ABSORBING check
//   (src/battle_util.c:2703-2727, reached via JumpIfMoveFailed,
//   src/battle_script_commands.c:1009-1025). Both happen BEFORE typecalc,
//   so no MOVE_RESULT_* flag is ever set — AddSkillPoints' whole branch
//   chain falls through to the final fallback (+1, battle_arena.c:617-620).
//   But the printed string IS in DeductSkillPoints' list: STRINGID_
//   PKMNSXBLOCKSY for Soundproof (data/battle_scripts_1.s:4162, matched at
//   battle_arena.c:637); STRINGID_PKMNRAISEDFIREPOWERWITH or STRINGID_
//   PKMNSXMADEYINEFFECTIVE for Flash Fire (src/battle_message.c:1242-1246,
//   matched at battle_arena.c:645/635) — both -3. Net: +1 + -3 = -2.
//
// Volt Absorb / Water Absorb — scored -5, both mechanisms penalize:
//   BattleScript_MoveHPDrain (data/battle_scripts_1.s:4078-4089) sets
//   MOVE_RESULT_DOESNT_AFFECT_FOE (line 4088) — AddSkillPoints' NO_EFFECT
//   branch fires (-2, battle_arena.c:600-604: MISSED is NOT set here, so
//   `!(MISSED)` alone is true). It also prints STRINGID_PKMNRESTOREDHPUSING
//   (line 4086), which IS in DeductSkillPoints' list (battle_arena.c:640):
//   -3. Net: -2 + -3 = -5.
// ── A7: Arena Skill as the TWO SOURCE MECHANISMS, not hand-netted constants ──
//
// Source writes arenaSkillPoints from two independent places, neither gating
// the other:
//   1. BattleArena_AddSkillPoints (src/battle_arena.c:588-622), once per move
//      from Cmd_end (src/battle_script_commands.c:3951-3953), branching on
//      gMoveResultFlags.
//   2. BattleArena_DeductSkillPoints (src/battle_arena.c:624-652), a flat -3
//      per MATCHING PRINTED STRING, fired from PlayerHandlePrintString /
//      OpponentHandlePrintString (src/battle_controller_player.c:2554,
//      src/battle_controller_opponent.c:1532).
//
// This engine used to model (1) only, and paper over (2) with six hand-computed
// NET values. Those six numbers were right, and five further block paths were
// right by coincidence of coverage -- but nothing derived them, so any new
// mechanic had to have its Skill re-derived by hand. Now both mechanisms exist
// and every net falls out of them.
//
// CORRECTION TO THE RECORD: this file previously said "the 18 strings
// DeductSkillPoints matches", and sim-audit.md §3.2 repeated it. The switch has
// NINETEEN cases (src/battle_arena.c:630-649, counted). Off by one, corrected
// here and in the audit.
const ARENA_DEDUCT_STRINGS = new Set([
  "STRINGID_PKMNSXMADEYUSELESS", "STRINGID_PKMNSXMADEITINEFFECTIVE",
  "STRINGID_PKMNSXPREVENTSFLINCHING", "STRINGID_PKMNSXBLOCKSY2",
  "STRINGID_PKMNSXPREVENTSYLOSS", "STRINGID_PKMNSXMADEYINEFFECTIVE",
  "STRINGID_PKMNSXPREVENTSBURNS", "STRINGID_PKMNSXBLOCKSY",
  "STRINGID_PKMNPROTECTEDBY", "STRINGID_PKMNPREVENTSUSAGE",
  "STRINGID_PKMNRESTOREDHPUSING", "STRINGID_PKMNPREVENTSPARALYSISWITH",
  "STRINGID_PKMNPREVENTSROMANCEWITH", "STRINGID_PKMNPREVENTSPOISONINGWITH",
  "STRINGID_PKMNPREVENTSCONFUSIONWITH", "STRINGID_PKMNRAISEDFIREPOWERWITH",
  "STRINGID_PKMNANCHORSITSELFWITH", "STRINGID_PKMNPREVENTSSTATLOSSWITH",
  "STRINGID_PKMNSTAYEDAWAKEUSING",
]);

// BattleArena_AddSkillPoints' branch chain (src/battle_arena.c:588-622), as a
// pure function of which branch the move result lands on.
//   alreadyStatused  :595-599  the setalreadystatusedmoveattempt bit
//   noEffect         :600-604  NO_EFFECT and NOT (MISSED with MISS_TYPE==PROTECTED)
//   protectedBlock   :600-604  NO_EFFECT but the inner condition is false, so 0
//   mixed            :605-608  SUPER_EFFECTIVE && NOT_VERY_EFFECTIVE
//   superEffective   :609-612
//   notVeryEffective :613-616
//   landed           :617-620  the final else, when the attacker is not itself protected
//   selfProtected    :617-620  ...and 0 when it is
const ARENA_ADD_SKILL = {
  alreadyStatused: -2, noEffect: -2, protectedBlock: 0, mixed: 1,
  superEffective: 2, notVeryEffective: -1, landed: 1, selfProtected: 0,
  // Phase D F22: AddSkillPoints is gated on HITMARKER_OBEYS (src/battle_arena.c:
  // 592), which Cmd_attackcanceler sets only at :960 -- AFTER the
  // ABILITYEFFECT_MOVES_BLOCK return at :932. A move blocked there scores
  // nothing at `end`.
  beforeObeys: 0,
};

// The composite. `printed` is the list of source string IDs this resolution
// would print; each one that DeductSkillPoints matches costs a further -3.
function arenaSkillDelta(addBranch, printed = []) {
  if (!(addBranch in ARENA_ADD_SKILL)) throw new Error(`arenaSkillDelta: unknown AddSkillPoints branch "${addBranch}"`);
  let d = ARENA_ADD_SKILL[addBranch];
  for (const s of printed) {
    if (!s.startsWith("STRINGID_")) throw new Error(`arenaSkillDelta: "${s}" is not a STRINGID_* constant`);
    if (ARENA_DEDUCT_STRINGS.has(s)) d -= 3;
  }
  return d;
}

// The six ability blocks, now expressed as what source actually does rather
// than as a net number. Each entry is (AddSkillPoints branch, printed strings);
// the delta is derived. The per-ability reasoning and its anchors are in the
// long comment that used to sit above the hand-netted table, retained below.
//
// Wonder Guard / Levitate: Cmd_typecalc (src/battle_script_commands.c:1409-1419
//   / 1375-1383) sets MOVE_RESULT_MISSED (Levitate also DOESNT_AFFECT_FOE) with
//   MISS_TYPE = B_MSG_AVOIDED_DMG / B_MSG_GROUND_MISS -- neither is
//   B_MSG_PROTECTED, so the NO_EFFECT branch's -2 fires. The strings it prints
//   (STRINGID_AVOIDEDDAMAGE / STRINGID_PKMNMAKESGROUNDMISS,
//   src/battle_message.c:895-896) are NOT in DeductSkillPoints' switch.
// Soundproof / Flash Fire: both block BEFORE typecalc (src/battle_util.c:
//   2659-2674 ABILITYEFFECT_MOVES_BLOCK; :2703-2727 ABILITYEFFECT_ABSORBING),
//   so no MOVE_RESULT_* is ever set and their strings ARE matched, for -3.
//   Flash Fire's AddSkillPoints then falls through to +1; Soundproof's never
//   runs (Phase D F22: the block precedes HITMARKER_OBEYS).
// Volt Absorb / Water Absorb: BattleScript_MoveHPDrain
//   (data/battle_scripts_1.s:4078-4089) sets MOVE_RESULT_DOESNT_AFFECT_FOE
//   (line 4088) -> -2, AND prints STRINGID_PKMNRESTOREDHPUSING (line 4086) ->
//   -3. Both mechanisms penalise; this is the only pair where they do.
const ABILITY_BLOCK_SOURCE = {
  "Wonder Guard": { addBranch: "noEffect", printed: ["STRINGID_AVOIDEDDAMAGE"] },
  "Levitate": { addBranch: "noEffect", printed: ["STRINGID_PKMNMAKESGROUNDMISS"] },
  // F22: Soundproof is ABILITYEFFECT_MOVES_BLOCK, before HITMARKER_OBEYS (see
  // ARENA_ADD_SKILL.beforeObeys): -3 alone, not -3 +1. Flash Fire's
  // ABSORBING check is after it (:1021), so its +1 stands.
  "Soundproof": { addBranch: "beforeObeys", printed: ["STRINGID_PKMNSXBLOCKSY"] },
  "Flash Fire": { addBranch: "landed", printed: ["STRINGID_PKMNRAISEDFIREPOWERWITH"] },
  "Volt Absorb": { addBranch: "noEffect", printed: ["STRINGID_PKMNRESTOREDHPUSING"] },
  "Water Absorb": { addBranch: "noEffect", printed: ["STRINGID_PKMNRESTOREDHPUSING"] },
};

const ABILITY_BLOCK_SKILL_DELTA = Object.fromEntries(
  Object.entries(ABILITY_BLOCK_SOURCE).map(([ability, { addBranch, printed }]) =>
    [ability, arenaSkillDelta(addBranch, printed)]),
);

// Resolves ability-based interactions that override normal damage/type
// resolution. Called before normal damage calc for any power>0 move, and
// before status-effect application for power===0 moves (Soundproof blocks
// both). Returns one of:
//   { type: "normal" }                                          — proceed as usual
//   { type: "blocked", skillDelta }                              — ability/item block (see ABILITY_BLOCK_SKILL_DELTA above)
//   { type: "absorb", healFraction: 0.25, skillDelta }           — Volt/Water Absorb: heal defender instead
//   { type: "flashFireTrigger", skillDelta }                     — Flash Fire: no damage, sets standing boost flag
function resolveAbilityInteraction(moveName, moveData, attacker, defender, defenderForesighted = false) {
  if (defender.ability === "Soundproof" && SOUND_MOVES.has(moveName)) {
    return { type: "blocked", skillDelta: ABILITY_BLOCK_SKILL_DELTA["Soundproof"] };
  }
  if (moveData.power === 0) return { type: "normal" };

  if (defender.ability === "Levitate" && moveData.type === "Ground") {
    return { type: "blocked", skillDelta: ABILITY_BLOCK_SKILL_DELTA["Levitate"] };
  }
  if (defender.ability === "Volt Absorb" && moveData.type === "Electric") {
    return { type: "absorb", healFraction: 0.25, skillDelta: ABILITY_BLOCK_SKILL_DELTA["Volt Absorb"] };
  }
  if (defender.ability === "Water Absorb" && moveData.type === "Water") {
    return { type: "absorb", healFraction: 0.25, skillDelta: ABILITY_BLOCK_SKILL_DELTA["Water Absorb"] };
  }
  if (defender.ability === "Flash Fire" && moveData.type === "Fire") {
    return { type: "flashFireTrigger", skillDelta: ABILITY_BLOCK_SKILL_DELTA["Flash Fire"] };
  }
  // Phase D F42: CheckWonderGuardAndLevitate returns at once for Struggle
  // (src/battle_script_commands.c:1432).
  if (defender.ability === "Wonder Guard" && moveName !== "Struggle") {
    const { hadSuper, hadNVE } = typeEffectivenessBreakdown(moveData.type, defender.types, defenderForesighted);
    if (!(hadSuper && !hadNVE)) return { type: "blocked", skillDelta: ABILITY_BLOCK_SKILL_DELTA["Wonder Guard"] }; // only a CLEAN super-effective hit gets through
  }
  return { type: "normal" };
}

// The OHKO bug's exact shape, generalized (HANDOFF.md §5 item 4 / §10 task 2):
// these effects all carry move-data.js's placeholder "power": 1 (real power
// is fixed/level/HP-based, computed dynamically, never a flat base — same as
// OHKO's now-fixed Horn Drill/Fissure/Guillotine/Sheer Cold) and, unlike
// EFFECT_FLAIL/EFFECT_COUNTER/EFFECT_MIRROR_COAT/EFFECT_OHKO, have NO special-
// case damage logic anywhere yet. Left un-special-cased, `power === 1` slips
// past the "status move needs a handler" guard exactly like EFFECT_OHKO did,
// and generic calcDamage silently produces a near-1-damage hit instead of the
// real mechanic (flat/level/HP-based damage, occasionally much larger). This
// set converts that from a silent wrong number into a loud, explicit throw —
// coverage audit findings, not yet ported (deliberately NOT fixed here, see
// HANDOFF.md §10 task 2).
const SILENT_FALLTHROUGH_EFFECTS = new Set([
  // B2b batch 5 REMOVED nine of these -- they now have their real mechanic:
  // EFFECT_SONICBOOM, EFFECT_DRAGON_RAGE, EFFECT_PSYWAVE, EFFECT_SUPER_FANG and
  // EFFECT_ENDEAVOR through SET_DAMAGE_EFFECTS, and EFFECT_LOW_KICK,
  // EFFECT_MAGNITUDE, EFFECT_PRESENT and EFFECT_ERUPTION through
  // variablePowerFor(). What is left is what is genuinely still unported.
  // B3 batch 4c REMOVED EFFECT_BIDE: modelled (lock, storing, unleash).
  // C2 REMOVED EFFECT_HIDDEN_POWER: modelled (battleMoveData, amendment 16).
  // EFFECT_RETURN/EFFECT_FRUSTRATION REMOVED from this set — now correctly
  // handled via calcDamage's friendship-based effectivePower (see
  // getFriendshipPower/buildMon's `friendship` field).
  // EFFECT_LEVEL_DAMAGE REMOVED (this session) — now correctly handled via
  // calcDamage's own EFFECT_LEVEL_DAMAGE branch (flat user.level, immunity-
  // gated) plus an AI_HANDLERS["EFFECT_LEVEL_DAMAGE"] checkBadMove entry
  // (AI_CBM_HighRiskForDamage, mirrors EFFECT_RETURN/EFFECT_FRUSTRATION above).
  //
  // KNOWN INCOMPLETE — conditional-multiplier power. This set catches fixed/
  // level/HP-based power, but NOT effects that deal ordinary power-based damage
  // multiplied by a runtime condition: EFFECT_FACADE (2x if user statused, 16
  // sets), EFFECT_PURSUIT (2x on a switching target, 2 sets), EFFECT_REVENGE
  // (2x if user was hit first, 1 set) — 19 sets under-computing their damage
  // today (calcDamage has no branch for any of them, so they use raw base
  // power). These are the SAME axis as this set ("the damage number is wrong"),
  // NOT the change #11 mandatory-mechanic axis, so they are deliberately NOT in
  // the #11 guard. Folding them in here would drop the sweep by 19 and needs
  // the same accepted-unmodeled ledger treatment — queued as a SEPARATE change.
]);

// Recoil (src/battle_script_commands.c:2636-2643/2843-2850, dispatched via
// MOVE_EFFECT_RECOIL_25/MOVE_EFFECT_RECOIL_33 — a DIFFERENT, finer-grained
// constant than the move's own .effect field, but the two recoil-tagged
// effects in this engine's move-data.js map 1:1 onto them): recoil damage =
// floor(damage actually dealt this hit / divisor), FLOORED TO 1 EVEN WHEN
// THE DEALT DAMAGE WAS 0 (source's `if (gBattleMoveDamage == 0)
// gBattleMoveDamage = 1` doesn't check WHY it was zero) — confirmed this
// means a recoil move used against a type-immune target still costs the
// user 1 HP-equivalent of recoil, a real, surprising-but-correct mechanic
// (Lesson 5's pattern), not a bug to "fix" toward 0. Based on "damage
// actually dealt" (gHpDealt), which is the Substitute-absorbed amount when a
// sub is up, not the theoretical raw number — matches this engine's existing
// `absorbed`/`hitDmg` distinction in the per-hit loop below. Rock Head negates
// ALL of it (BattleScript_MoveEffectRecoil's own ability check) EXCEPT
// Struggle, which always recoils even through Rock Head (source-confirmed,
// checked first via an unconditional `jumpifmove MOVE_STRUGGLE` before the
// Rock Head check even runs) — moot here since no set in this pool carries
// Struggle, but preserved as a comment in case that ever changes.
const RECOIL_FRACTION = { EFFECT_RECOIL: 4, EFFECT_DOUBLE_EDGE: 3 };

// Drain moves (Absorb/Mega Drain/Leech Life/Giga Drain share EFFECT_ABSORB;
// Dream Eater is EFFECT_DREAM_EATER) heal the USER for half the HP actually
// removed from the target. Handled inline in the damage path alongside
// RECOIL_FRACTION — a mandatory on-hit HP side effect, structurally identical
// to recoil — NOT via EFFECT_EXECUTORS, whose dispatch is gated behind
// secondaryTriggered and would be permanently dead code for a move with no
// secondaryEffect chance (that gate's power=0-only throw is exactly what hid
// this bug; see change #10). Both effects heal on the same half divisor, so
// one set covers both. Dream Eater additionally has a sleep gate (see below).
const DRAIN_EFFECTS = new Set(["EFFECT_ABSORB", "EFFECT_DREAM_EATER"]);

const EFFECT_EXECUTORS = {
  // A4: BattleScript_EffectConfuse (data/battle_scripts_1.s:903-917) gates the
  // confusion on, in this order: Own Tempo (-> BattleScript_OwnTempoPrevents,
  // :4152, prints STRINGID_PKMNPREVENTSCONFUSIONWITH and sets no MOVE_RESULT_*),
  // Substitute (-> ButItFailed, MOVE_RESULT_FAILED), already-confused
  // (-> AlreadyConfused), the accuracy roll, then Safeguard
  // (-> SafeguardProtected). Every one of those was missing here: the executor
  // set the flag unconditionally, so Confuse Ray went through Own Tempo, through
  // a Substitute and through Safeguard, and banked +1 Skill for doing it.
  //
  // EFFECT_SWAGGER's executor already had all three checks and its comment
  // flagged this one as the known hole; the two now agree. Accuracy is handled
  // upstream in enumerateActionOutcomes, as for every other status move.
  EFFECT_CONFUSE: (s, actor, ctx) => {
    const t = confusionTarget(s, actor, ctx);
    if (t.mon.ability === "Own Tempo") return "failed";
    if (s[t.subKey] != null) return "failed";
    if (s[t.safeguardKey] != null) return "failed";
    if (s[t.confKey]) return "failed"; // AlreadyConfused — no restack
    s[t.confKey] = true;
  },
  // Cmd_tryinfatuating (src/battle_script_commands.c:7654+) — fails (routes
  // to BattleScript_ButItFailed, MOVE_RESULT_FAILED — scored as a real "no
  // effect" via applyMove's power===0 "failed" convention, NOT a silent
  // no-op) if the target has Oblivious, is already infatuated (no stack),
  // or the two genders are incompatible (same gender, or either genderless).
  // NOTABLY: no Safeguard check anywhere in source — Attract genuinely
  // bypasses Safeguard (unlike major status/confusion), and also has no
  // Substitute check in its script or command — bypasses Substitute too.
  // Gender compatibility, when either side is genuinely uncertain (a
  // variable-ratio species with no fixed personality/config override), was
  // already resolved into a concrete branch upstream in
  // enumerateActionOutcomes (Lesson 1 — never re-roll here).
  EFFECT_ATTRACT: (s, actor, ctx, moveData, sleepDuration, attractGenderCompatible) => {
    const isYou = actor === "you";
    const foeMon = isYou ? ctx.opp : ctx.you;
    const attrKey = isYou ? "oppAttracted" : "youAttracted";
    if (s[attrKey]) return "failed";
    if (foeMon.ability === "Oblivious") return "failed";
    if (!attractGenderCompatible) return "failed";
    s[attrKey] = true;
  },
  // A5: evasion was refused on the player side, but the accuracy machinery was
  // ALREADY symmetric — enumerateActionOutcomes picks attackerAccStage and
  // targetEvasionStage per actor (see its accuracy branch). So the throw was
  // the only thing standing between the player and Double Team; nothing else
  // needed to change for it.
  EFFECT_EVASION_UP: (s, actor) => {
    bumpStage(actor === "you" ? s.youStages : s.oppStages, "evasion", 1);
  },
  EFFECT_CALM_MIND: (s, actor) => {
    // Well-documented, generation-stable: +1 SpA and +1 SpD simultaneously.
    // No ability/immunity interactions to worry about (self-targeted boost,
    // same "increase path has no ability checks" logic confirmed for
    // EFFECT_ATTACK_UP_HIT applies here too).
    const stages = actor === "you" ? s.youStages : s.oppStages;
    bumpStage(stages, "spa", 1);
    bumpStage(stages, "spd", 1);
  },
  EFFECT_COSMIC_POWER: (s, actor) => {
    // Well-documented, generation-stable: +1 Def and +1 SpDef simultaneously.
    const stages = actor === "you" ? s.youStages : s.oppStages;
    bumpStage(stages, "def", 1);
    bumpStage(stages, "spd", 1);
  },
  EFFECT_BULK_UP: (s, actor) => {
    // Well-documented, generation-stable: +1 Atk and +1 Def simultaneously.
    const stages = actor === "you" ? s.youStages : s.oppStages;
    bumpStage(stages, "atk", 1);
    bumpStage(stages, "def", 1);
  },
  // Stat-boost family (batch 2) — same "increase path has no ability checks,
  // silently caps at +6" convention as EFFECT_ATTACK_UP_HIT/EFFECT_CALM_MIND
  // above. "_2" variants raise 2 stages (well-established Gen III move
  // mechanics — Swords Dance/Amnesia/Agility/Barrier-Acid Armor-Iron Defense
  // all raise 2 stages; same confidence tier as the type chart/nature table,
  // no additional source dive needed).
  EFFECT_ATTACK_UP: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "atk", 1),
  EFFECT_ATTACK_UP_2: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "atk", 2),
  EFFECT_DEFENSE_UP: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "def", 1),
  EFFECT_DEFENSE_UP_2: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "def", 2),
  EFFECT_SPEED_UP: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "spe", 1),
  EFFECT_SPEED_UP_2: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "spe", 2),
  EFFECT_SPECIAL_ATTACK_UP: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "spa", 1),
  EFFECT_SPECIAL_ATTACK_UP_2: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "spa", 2),
  EFFECT_SPECIAL_DEFENSE_UP: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "spd", 1),
  EFFECT_SPECIAL_DEFENSE_UP_2: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "spd", 2),
  // Batch 4:
  EFFECT_DRAGON_DANCE: (s, actor) => {
    // Well-established, generation-stable: +1 Atk and +1 Speed simultaneously.
    const stages = actor === "you" ? s.youStages : s.oppStages;
    bumpStage(stages, "atk", 1);
    bumpStage(stages, "spe", 1);
  },
  EFFECT_CURSE: (s, actor, ctx) => {
    // Non-Ghost branch only (data/battle_scripts_1.s:1482-1510): -1 Speed,
    // +1 Atk, +1 Def to self, each independently silently capped (matches
    // the same "increase/decrease path has no extra checks" convention as
    // every other stat-boost executor — real "But it failed" only triggers
    // if Speed is at -6 AND Atk at +6 AND Def at +6 simultaneously, which
    // bumpStage's clamping already reproduces for free).
    // Ghost branch (HP-sacrifice self-damage + persistent per-turn curse
    // status on the target, :1511-1530) is implemented below as of B2.
    const isYou = actor === "you";
    const selfMon = isYou ? ctx.you : ctx.opp;
    if (selfMon.types.includes("Ghost")) {
      // B2: Ghost-Curse. BattleScript_GhostCurse (data/battle_scripts_1.s:
      // 1511-1530): fails through a Substitute, then cursetarget
      // (Cmd_cursetarget) fails if the target is ALREADY cursed, else sets
      // STATUS2_CURSED and costs the USER maxHP/2 (min 1) -- which can faint it,
      // hence the tryfaintmon that follows. The residual is maxHP/4 per
      // end-of-turn on the cursed side (src/battle_util.c:1581-1590).
      const foeSubKey = isYou ? "oppSubstituteHP" : "youSubstituteHP";
      const foeCursedKey = isYou ? "oppCursed" : "youCursed";
      if (s[foeSubKey] != null) return "failed";
      if (s[foeCursedKey]) return "failed";
      s[foeCursedKey] = true;
      const selfHp = isYou ? "yourHpPct" : "oppHpPct";
      const cost = Math.max(1, Math.floor(selfMon.stats.hp / 2));
      s[selfHp] = hpSub(s[selfHp], cost, selfMon.stats.hp);
      return;
    }
    const stages = isYou ? s.youStages : s.oppStages;
    bumpStage(stages, "spe", -1);
    bumpStage(stages, "atk", 1);
    bumpStage(stages, "def", 1);
  },
  EFFECT_LEECH_SEED: (s, actor, ctx) => {
    // BattleScript_EffectLeechSeed explicitly checks substitute BEFORE even
    // the accuracy roll (data/battle_scripts_1.s:1157-1163 — jumpifstatus2
    // BS_TARGET, STATUS2_SUBSTITUTE, ButItFailed). Cmd_setseeded itself
    // (src/battle_script_commands.c:6718-6738) then fails (no-stack) if
    // already seeded, or if the target is Grass-type — otherwise sets the
    // seeded flag. Actual per-turn drain happens in applyEndOfTurnEffects
    // (maxHP/8 of the SEEDED mon, capped at its current HP, transferred as
    // healing to whoever planted it — capped at their max HP, skipped if
    // they have Liquid Ooze — src/battle_scripts_1.s:3265-3280).
    const isYou = actor === "you";
    const foeMon = isYou ? ctx.opp : ctx.you;
    const foeSeededKey = isYou ? "oppSeeded" : "youSeeded";
    const foeSubKey = isYou ? "oppSubstituteHP" : "youSubstituteHP";
    if (s[foeSubKey]) return "failed";
    if (s[foeSeededKey]) return "failed";
    if (foeMon.types.includes("Grass")) return "failed";
    s[foeSeededKey] = true;
  },
  EFFECT_BATON_PASS: () => "failed", // Arena has no reserve party to switch into (see AI_HANDLERS.EFFECT_BATON_PASS comment) — always a no-op, Skill scores noEffect, regardless of the AI's Tower-blind scoring.
  // Batch 5 — persistent-state effects (Substitute/Reflect/Light Screen).
  EFFECT_SUBSTITUTE: (s, actor, ctx) => {
    // data/battle_scripts_1.s:1090 jumpifstatus2 ... AlreadyHasSubstitute —
    // fails outright (no-stack) if one's already up. Otherwise
    // Cmd_setsubstitute (src/battle_script_commands.c:7808-7833): cost =
    // floor(maxHP/4), min 1. Fails (no HP paid, no sub created) if current
    // HP <= cost — note the <=, not <, so being exactly at the threshold
    // still fails (you'd be left at exactly 0 after paying, which isn't
    // allowed — matches the real check literally).
    const isYou = actor === "you";
    const selfMon = isYou ? ctx.you : ctx.opp;
    const selfHpKey = isYou ? "yourHpPct" : "oppHpPct";
    const selfSubKey = isYou ? "youSubstituteHP" : "oppSubstituteHP";
    if (s[selfSubKey] != null) return "failed";
    const cost = Math.max(1, Math.floor(selfMon.stats.hp / 4));
    const currentHp = Math.round((s[selfHpKey] / 100) * selfMon.stats.hp);
    if (currentHp <= cost) return "failed";
    s[selfHpKey] = hpSub(s[selfHpKey], cost, selfMon.stats.hp);
    s[selfSubKey] = cost;
    // B3 batch 5: and it frees the user from a wrap (:7826).
    s[isYou ? "youWrapped" : "oppWrapped"] = null;
  },
  EFFECT_REFLECT: (s, actor) => {
    // Cmd_setreflect (src/battle_script_commands.c:6697-6714): fails
    // (no-stack) if already up; otherwise sets a 5-turn counter.
    const key = actor === "you" ? "youReflectTurns" : "oppReflectTurns";
    if (s[key] != null) return "failed";
    s[key] = 5;
  },
  EFFECT_LIGHT_SCREEN: (s, actor) => {
    // Cmd_setlightscreen (src/battle_script_commands.c:7478 region) — same
    // shape as Reflect: fails if already up, else 5-turn counter.
    const key = actor === "you" ? "youLightScreenTurns" : "oppLightScreenTurns";
    if (s[key] != null) return "failed";
    s[key] = 5;
  },
  // Batch 6:
  EFFECT_SWAGGER: raiseThenConfuseExecutor("atk", 2),
  EFFECT_DESTINY_BOND: (s, actor) => {
    // setdestinybond: always succeeds unconditionally, no fail condition in
    // source. Cleared at the start of the user's OWN next turn (see
    // resolveTurn) — protects only through the rest of THIS turn.
    const key = actor === "you" ? "youDestinyBondActive" : "oppDestinyBondActive";
    s[key] = true;
  },
  // Batch 7:
  EFFECT_RESTORE_HP: healHalfMaxHp,
  EFFECT_SOFTBOILED: healHalfMaxHp,
  EFFECT_SYNTHESIS: healHalfMaxHp, // see healHalfMaxHp's comment re: weather never being active here
  EFFECT_MOONLIGHT: healHalfMaxHp,
  EFFECT_MORNING_SUN: healHalfMaxHp,
  EFFECT_INGRAIN: (s, actor) => {
    // Cmd_trysetroots (src/battle_script_commands.c:9326-9337): fails
    // (no-stack) if already rooted, else sets the flag. Real per-turn heal
    // (1/16 max HP, skipped at full/0 HP) happens in applyEndOfTurnEffects,
    // BEFORE Leftovers (ENDTURN_INGRAIN is index 0 of the per-battler
    // end-of-turn tracker, src/battle_util.c:1440-1462).
    const key = actor === "you" ? "youIngrained" : "oppIngrained";
    if (s[key]) return "failed";
    s[key] = true;
  },
  // Batch 8:
  EFFECT_SAFEGUARD: (s, actor) => {
    // Cmd_setsafeguard (src/battle_script_commands.c:8650-8668): fails
    // (no-stack) if already up, else 5-turn counter — same shape as
    // Reflect/Light Screen, decremented in the same end-of-turn block.
    const key = actor === "you" ? "youSafeguardTurns" : "oppSafeguardTurns";
    if (s[key] != null) return "failed";
    s[key] = 5;
  },
  EFFECT_MEAN_LOOK: (s, actor) => {
    // Phase D F4. This was a no-op ("no switching in Arena"), but the flag
    // matters inside one battle. BattleScript_EffectMeanLook (data/
    // battle_scripts_1.s:1444-1457) fails (ButItFailed, -2) if the target is
    // already escape-prevented or behind a Substitute, else sets
    // STATUS2_ESCAPE_PREVENTION (src/battle_script_commands.c:622, :2806) --
    // which AI_CBM_CantEscape reads, and which only the trapper leaving the
    // field clears (src/battle_main.c:3164-3165, :3277-3278): never, here.
    const foe = actor === "you" ? "opp" : "you";
    if (vf(s, foe + "CantEscape")) return "failed";
    if (s[foe + "SubstituteHP"] != null) return "failed";
    setVf(s, foe + "CantEscape", true);
  },
  // Weather — all 4 share the identical fail condition (same type already
  // active, temp OR permanent — checked via a bitmask in source, but a
  // straight equality check here since we only ever track one type at a
  // time) and, on success, UNCONDITIONALLY OVERWRITE whatever was active
  // before (including a permanent ability-set weather of a DIFFERENT type —
  // Cmd_set{rain,sunny,sandstorm,hail} all do a straight assignment, not an
  // OR, src/battle_script_commands.c:6681-6694 and siblings). Always 5 turns
  // — a move can never SET permanent weather, only an ability can.
  EFFECT_SANDSTORM: (s) => {
    if (s.weatherType === "sandstorm") return "failed";
    s.weatherType = "sandstorm";
    s.weatherTurns = 5;
  },
  EFFECT_RAIN_DANCE: (s) => {
    if (s.weatherType === "rain") return "failed";
    s.weatherType = "rain";
    s.weatherTurns = 5;
  },
  EFFECT_SUNNY_DAY: (s) => {
    if (s.weatherType === "sun") return "failed";
    s.weatherType = "sun";
    s.weatherTurns = 5;
  },
  EFFECT_HAIL: (s) => {
    if (s.weatherType === "hail") return "failed";
    s.weatherType = "hail";
    s.weatherTurns = 5;
  },
  // ── Executor backfill for the batch-1 AI_HANDLERS (Paralyze/Roar/Rest) ───
  EFFECT_PARALYZE: (s, actor, ctx, moveData) => {
    // Direct status-only paralysis (Thunder Wave/Stun Spore) — distinct from
    // EFFECT_PARALYZE_HIT above (secondary-effect paralysis on a damaging
    // move, e.g. Body Slam), which always executes via inflictStatus with no
    // type check since Normal-type carriers have no relevant immunity.
    // Thunder Wave/Stun Spore DO carry a real type (Electric/Grass) that
    // gates the effect through the general type chart — e.g. Ground blocks
    // Thunder Wave — checked independently of the accuracy roll, matching
    // AI_CBM_Paralyze's own AI_EFFECTIVENESS_x0 check. NOTE: does not model
    // Stun Spore's real "powder moves fail vs Grass-types" exemption — that's
    // a hardcoded category immunity outside the general type chart, separate
    // from this check and not yet modeled anywhere in this engine.
    const isYou = actor === "you";
    const foeMon = isYou ? ctx.opp : ctx.you;
    const foeSide = isYou ? "opp" : "you";
    if (typeEffectiveness(moveData.type, foeMon.types) === 0) return "failed";
    // Limber check now lives centrally in inflictStatus (STATUS_IMMUNITY_ABILITIES)
    // — this used to be a standalone inline check here, now redundant with
    // that centralized version; removed to avoid the two silently drifting.
    if (!inflictStatus(s, foeSide, "paralysis", foeMon.types, foeMon.ability)) return "failed"; // already-statused/Limber no-stack gate
  },
  // A3: Toxic. BattleScript_EffectToxic (data/battle_scripts_1.s:686-702) gates on
  // Immunity, Substitute, already-poisoned (either kind), any other major
  // status, Poison type, Steel type, the accuracy roll, then Safeguard -- every
  // one of which inflictStatus already models, so the gating is shared rather
  // than duplicated here. What is NEW is the status BIT: source applies
  // MOVE_EFFECT_TOXIC -> STATUS1_TOXIC_POISON (src/battle_script_commands.c:615),
  // which is a different bit from STATUS1_POISON and ticks on a different,
  // escalating schedule (see applyEndOfTurnEffects). The counter starts at 0 and
  // is first incremented by the end-of-turn handler, so infliction sets 0, not 1.
  EFFECT_TOXIC: (s, actor, ctx) => {
    const isYou = actor === "you";
    const foeMon = isYou ? ctx.opp : ctx.you;
    const foeSide = isYou ? "opp" : "you";
    if (!inflictStatus(s, foeSide, "poison", foeMon.types, foeMon.ability)) return "failed";
    s[foeSide === "you" ? "youToxicCounter" : "oppToxicCounter"] = 0;
  },
  // ── B2: the no-dispatch class ────────────────────────────────────────────
  // Three of these are MECHANICALLY INERT in this ruleset, for reasons that are
  // properties of the Arena rather than shortcuts. Each returns undefined
  // ("landed"), not "failed", because source's script succeeds -- it is the
  // consequence that cannot materialise here.
  //
  // Grudge (Cmd_trysetgrudge): strips all PP from the move that KOs the user.
  // PP is not modelled and a 3-turn match cannot exhaust it, so the flag would
  // never be read. Sets nothing.
  EFFECT_GRUDGE: () => {},
  // Follow Me: redirects the opponents' attacks to the user. It is a
  // double-battle mechanic (MOVE_TARGET_BOTH redirection); the Arena is
  // singles, so there is nothing to redirect.
  EFFECT_FOLLOW_ME: () => {},
  // Spite (Cmd_trysetspite): removes 2-5 PP from the target's last move. Same
  // reason as Grudge -- no PP model, and 3 turns cannot run a move dry.
  EFFECT_SPITE: () => {},

  // Taunt: Cmd_settaunt (src/battle_script_commands.c) sets tauntTimer = 2 on
  // the TARGET, and fails outright if a taunt is already running
  // (BattleScript_EffectTaunt -> ButItFailed, data/battle_scripts_1.s:2308-2318).
  // While it runs the target cannot select a status move.
  EFFECT_TAUNT: (s, actor) => {
    const key = actor === "you" ? "oppTauntTurns" : "youTauntTurns";
    if (s[key] != null) return "failed"; // already taunted -- no restack
    s[key] = 2;
  },

  // Teeter Dance (data/battle_scripts_1.s:2571-2583): confuses EVERY battler
  // except the user, looping over targets. In singles that is exactly the foe,
  // gated on Own Tempo, Substitute and already-confused -- the same three
  // checks EFFECT_CONFUSE uses (A4), so it shares confusionTarget.
  // Phase D F40: resolved whole in applyMoveCore (its Skill depends on the
  // loop's last pass, which an executor cannot see); reaching here is a
  // routing bug.
  EFFECT_TEETER_DANCE: () => {
    throw new Error("EFFECT_TEETER_DANCE reached its executor -- applyMoveCore resolves it (Phase D F40)");
  },

  // Wish: Cmd_trywish case 0 sets wishCounter = 2 and fails if one is already
  // pending. ENDTURN_WISH decrements it and heals maxHP/2 when it reaches 0
  // (src/battle_util.c:1319-1338), i.e. at the END OF THE FOLLOWING TURN.
  // In a 3-turn Arena round a Wish cast on turn 3 can never resolve; that falls
  // out of the counter rather than being special-cased.
  EFFECT_WISH: (s, actor) => {
    const key = actor === "you" ? "youWishTurns" : "oppWishTurns";
    if (s[key] != null) return "failed";
    s[key] = 2;
  },

  EFFECT_ROAR: () => "failed", // Arena has no reserve party to switch into (see AI_HANDLERS.EFFECT_ROAR comment for why the AI's SCORING doesn't know this) — always a no-op, Skill scores noEffect.
  EFFECT_REST: (s, actor, ctx) => {
    // Cmd_trysetrest (src/battle_script_commands.c:6762-6784): fails outright
    // (failJump, no heal, no sleep) if already at full HP -- see below for the
    // checks the SCRIPT makes first, and what each scores. Current status is
    // otherwise irrelevant (Rest clears
    // and overwrites unconditionally otherwise). Duration is a FIXED 3
    // (STATUS1_SLEEP_TURN(3), :6779) — NOT the random 2-5 rolled by direct
    // sleep-inducing moves (EFFECT_SLEEP, src/battle_util.c:1762) — that
    // random roll is irrelevant for Rest and is built separately whenever
    // EFFECT_SLEEP itself gets ported.
    const selfHpKey = actor === "you" ? "yourHpPct" : "oppHpPct";
    const selfStatusKey = actor === "you" ? "youStatus" : "oppStatus";
    const selfSleepTurnsKey = actor === "you" ? "youSleepTurns" : "oppSleepTurns";
    // B3 batch 4d: the comment above said full HP was the ONLY precondition.
    // BattleScript_EffectRest (data/battle_scripts_1.s:735-743) checks two
    // things BEFORE trysetrest: `jumpifstatus STATUS1_SLEEP` (a sleeping mon
    // that reaches Rest through Sleep Talk) and `jumpifcantmakeasleep` --
    // an uproar, Insomnia or Vital Spirit, on the user (Rest targets itself).
    //
    // And the SKILL each failure scores differs, because only one of them sets
    // a result flag BattleArena_AddSkillPoints reads:
    //   already asleep  RestIsAlreadyAsleep: setalreadystatusedmoveattempt -> -2
    //   uproar          RestCantSleep: no flag -> +1, and nothing happens
    //   Insomnia / VS   RestCantSleep prints STAYEDAWAKEUSING, one of the
    //                   BattleArena_DeductSkillPoints strings (-3), on top of
    //                   the +1 -> -2 net
    //   full HP         BattleScript_AlreadyAtFullHp (:2042-2046): no flag -> +1.
    //                   This engine scored it -2 until B3 batch 4d; the "failed"
    //                   it returned was a reading of the message, not of source.
    // An undefined return is the executor's "landed" (+1) with no effect.
    const selfMon = actor === "you" ? ctx.you : ctx.opp;
    if (s[selfStatusKey] === "sleep") return "failed";
    if (uproarKeepsAwake(s, selfMon)) return;
    if (selfMon.ability === "Insomnia" || selfMon.ability === "Vital Spirit") return "failed";
    if (s[selfHpKey] >= 100) return;
    s[selfHpKey] = 100;
    s[selfStatusKey] = "sleep";
    s[selfSleepTurnsKey] = 3;
    // Phase D F18: status1 = STATUS1_SLEEP_TURN(3) (:6779) OVERWRITES it, so a
    // badly poisoned rester's toxic bits and counter go too. The engine left
    // the counter, which read as bad poison to anything keyed on it -- and
    // made a later plain poison tick as Toxic.
    s[actor === "you" ? "youToxicCounter" : "oppToxicCounter"] = null;
  },
  // Batch 3: direct sleep-inducing status moves (Hypnosis/Spore/Lovely Kiss/
  // Sing/Sleep Powder) — targets the FOE, unlike Rest which targets self.
  // Duration comes from the enumerated 2-5 roll in enumerateActionOutcomes
  // (sleepDuration param), NOT a fixed value like Rest's.
  EFFECT_SLEEP: (s, actor, ctx, moveData, sleepDuration) => {
    const isYou = actor === "you";
    const foeMon = isYou ? ctx.opp : ctx.you;
    const foeSide = isYou ? "opp" : "you";
    const foeSleepTurnsKey = isYou ? "oppSleepTurns" : "youSleepTurns";
    if (foeMon.ability === "Insomnia" || foeMon.ability === "Vital Spirit") return "failed";
    if (!inflictStatus(s, foeSide, "sleep", foeMon.types, foeMon.ability)) return "failed"; // already-statused no-stack gate (Insomnia/Vital Spirit handled above; STATUS_IMMUNITY_ABILITIES.sleep is null since no other sleep-inflicting path exists yet)
    s[foeSleepTurnsKey] = sleepDuration;
  },
  // ── Phase 2 leverage batch ────────────────────────────────────────────
  EFFECT_PSYCH_UP: (s, actor) => {
    // Cmd_copyfoestats (src/battle_script_commands.c:8809-8819) — literally
    // unconditional, no fail branch is ever actually reachable (the "failed"
    // jump target in BattleScript_EffectPsychUp is dead code per the
    // source's own comment). Copies all 7 stat stages FROM the target TO
    // the user, overwriting whatever the user had.
    const userStages = actor === "you" ? s.youStages : s.oppStages;
    const targetStages = actor === "you" ? s.oppStages : s.youStages;
    Object.assign(userStages, targetStages);
  },
  EFFECT_WILL_O_WISP: (s, actor, ctx) => {
    const foeSide = actor === "you" ? "opp" : "you";
    const foeMon = actor === "you" ? ctx.opp : ctx.you;
    if (!inflictStatus(s, foeSide, "burn", foeMon.types, foeMon.ability)) return "failed"; // Fire-type/Water Veil/already-statused/sub/safeguard all funnel through inflictStatus already
  },
  EFFECT_YAWN: (s, actor, ctx) => {
    // Cmd_setyawn (src/battle_script_commands.c:9352-9364) — fails if
    // already drowsy OR already has ANY major status; Insomnia/Vital Spirit
    // and Substitute/Safeguard are checked earlier in the real script
    // (BattleScript_EffectYawn) before setyawn is even reached. The actual
    // sleep infliction (2-turn delay) happens in applyEndOfTurnEffects.
    const foeSide = actor === "you" ? "opp" : "you";
    const foeMon = actor === "you" ? ctx.opp : ctx.you;
    const foeSubKey = foeSide === "you" ? "youSubstituteHP" : "oppSubstituteHP";
    const foeSafeguardKey = foeSide === "you" ? "youSafeguardTurns" : "oppSafeguardTurns";
    const foeYawnKey = foeSide === "you" ? "youYawnTurns" : "oppYawnTurns";
    const foeStatusKey = foeSide === "you" ? "youStatus" : "oppStatus";
    if (foeMon.ability === "Insomnia" || foeMon.ability === "Vital Spirit") return "failed";
    // B3 batch 4d: jumpifcantmakeasleep checks the uproar first (data/
    // battle_scripts_1.s:2460).
    if (uproarKeepsAwake(s, foeMon)) return "failed";
    if (s[foeSubKey]) return "failed";
    if (s[foeSafeguardKey] != null) return "failed";
    if (s[foeYawnKey] != null || s[foeStatusKey] != null) return "failed";
    s[foeYawnKey] = 2;
  },
  EFFECT_PERISH_SONG: (s, actor, ctx) => {
    // Cmd_trysetperishsong (src/battle_script_commands.c:8508-8534): affects
    // BOTH battlers simultaneously (not just the target) — Soundproof or
    // already-perish-songed exempts that one side; the move only fails
    // outright if BOTH sides are exempt. Real mechanic also has a 3-turn
    // countdown ending in an HP-independent faint (HandleWishPerishSongOnTurnEnd,
    // src/battle_util.c:1834-1861) — traced through the actual turn-processing
    // order and confirmed this NEVER completes within Arena's fixed 3-turn
    // window: the "timer reached 0" check only fires at the START of a LATER
    // end-of-turn pass than the one that ticks it to 0, and turn 3's
    // end-of-turn pass is immediately followed by Arena judgment in the SAME
    // pass, with no 4th pass ever occurring. So the faint is mechanically
    // inert here regardless of which turn it's used on — verified, not a
    // shortcut — and only the "already perish-songed" flag needs tracking.
    const { you, opp } = ctx;
    const youEligible = !vf(s, "youPerishSonged") && you.ability !== "Soundproof";
    const oppEligible = !vf(s, "oppPerishSonged") && opp.ability !== "Soundproof";
    if (!youEligible && !oppEligible) return "failed";
    if (youEligible) setVf(s, "youPerishSonged", true);
    if (oppEligible) setVf(s, "oppPerishSonged", true);
  },
  EFFECT_ACCURACY_DOWN: statDownExecutor("accuracy", 1, "Keen Eye"),
  // ── B2b batch 8: the nine the family sweep found missing ────────────────
  // Amounts and blocking abilities from the same two source sites as their
  // ported siblings: the stat and stage come from each move's script
  // (setstatchanger), and the ability blocks from Cmd_statbuffchange
  // (src/battle_script_commands.c:4142-4145 -- Hyper Cutter for Attack, Keen
  // Eye for accuracy, Clear Body / White Smoke for all of them, which
  // statDownExecutor already applies to every member).
  EFFECT_ATTACK_DOWN: statDownExecutor("atk", 1, "Hyper Cutter"),
  EFFECT_ACCURACY_DOWN_2: statDownExecutor("accuracy", 2, "Keen Eye"),
  EFFECT_EVASION_DOWN_2: statDownExecutor("evasion", 2, null),
  EFFECT_SPECIAL_ATTACK_DOWN: statDownExecutor("spa", 1, null),
  EFFECT_SPECIAL_ATTACK_DOWN_2: statDownExecutor("spa", 2, null),
  EFFECT_SPECIAL_DEFENSE_DOWN: statDownExecutor("spd", 1, null),
  EFFECT_ACCURACY_UP: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "accuracy", 1),
  EFFECT_ACCURACY_UP_2: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "accuracy", 2),
  EFFECT_EVASION_UP_2: (s, actor) => bumpStage(actor === "you" ? s.youStages : s.oppStages, "evasion", 2),
  EFFECT_DEFENSE_DOWN_2: statDownExecutor("def", 2, null),
  EFFECT_SPEED_DOWN_2: statDownExecutor("spe", 2, null),
  EFFECT_ATTACK_DOWN_2: statDownExecutor("atk", 2, "Hyper Cutter"),
  EFFECT_SPECIAL_DEFENSE_DOWN_2: statDownExecutor("spd", 2, null),
  // -- B2b batch 1 executors: the stat-stage family ---------------------
  // B2b batch 3. This executor is only reached when Sleep Talk resolves AS
  // ITSELF -- i.e. the user was not asleep, or every one of its moves was
  // excluded or limited out. Both are failures in source
  // (data/battle_scripts_1.s:1311-1316 for the sleep gate, and the
  // all-unusable branch of Cmd_trychoosesleeptalkmove). When it DOES call a
  // move, the enumeration substitutes that move and this never runs.
  EFFECT_SLEEP_TALK: () => "failed",
  // Reached only when there was nothing to mirror; source's own failure path.
  EFFECT_MIRROR_MOVE: () => "failed",
  // Unreachable in practice -- Metronome always calls something, since its pool
  // is never empty -- but present so the no-executor guard cannot fire on it.
  EFFECT_METRONOME: () => "failed",
  // -- B2b batch 11 executors ---------------------------------------------
  EFFECT_TELEPORT: () => "failed",
  // BattleScript_EffectTeleport (data/battle_scripts_1.s:1120-1133) fails
  // IMMEDIATELY on `jumpifbattletype BATTLE_TYPE_TRAINER`. Every Arena battle is
  // a trainer battle, so Teleport can never do anything here -- the same
  // "inert by ruleset, not unported" shape as Helping Hand and Follow Me, and
  // stated rather than left to look like an omission.

  // -- B2b batch 10 executors ---------------------------------------------
  EFFECT_SKILL_SWAP: (s, actor, ctx) => {
    // Cmd_tryswapabilities (src/battle_script_commands.c:9392-9412): fails when
    // BOTH sides have no ability, or EITHER has Wonder Guard. Note it does NOT
    // fail merely because the two abilities are identical.
    const isYou = actor === "you";
    const self = isYou ? ctx.you : ctx.opp;
    const foe = isYou ? ctx.opp : ctx.you;
    if (!self.ability && !foe.ability) return "failed";
    if (self.ability === "Wonder Guard" || foe.ability === "Wonder Guard") return "failed";
    s[isYou ? "youAbilityOverride" : "oppAbilityOverride"] = foe.ability;
    s[isYou ? "oppAbilityOverride" : "youAbilityOverride"] = self.ability;
  },
  EFFECT_ROLE_PLAY: (s, actor, ctx) => {
    // Cmd_trycopyability (:9414-9428): copies the TARGET's ability onto the
    // user; fails if the target has none or has Wonder Guard. One-directional.
    const isYou = actor === "you";
    const foe = isYou ? ctx.opp : ctx.you;
    if (!foe.ability || foe.ability === "Wonder Guard") return "failed";
    s[isYou ? "youAbilityOverride" : "oppAbilityOverride"] = foe.ability;
  },
  EFFECT_TRICK: (s, actor, ctx) => {
    // Cmd_tryswapitems (:9189-9260). THE ARENA IS ONE OF THE BATTLE TYPES THAT
    // ALLOWS IT: the "opponent can't swap items with the player" guard is gated
    // on NOT being LINK | E_READER | FRONTIER | SECRET_BASE | RECORDED_LINK,
    // and BATTLE_TYPE_ARENA sits inside BATTLE_TYPE_FRONTIER. So an Arena
    // opponent's Trick works, which is exactly the case that matters here.
    // Fails when neither side holds anything, and Sticky Hold blocks it.
    const isYou = actor === "you";
    const self = isYou ? ctx.you : ctx.opp;
    const foe = isYou ? ctx.opp : ctx.you;
    // Phase D F25: BattleScript_EffectTrick checks the TARGET's Substitute
    // first (`jumpifstatus2 BS_TARGET, STATUS2_SUBSTITUTE, ButItFailed`,
    // data/battle_scripts_1.s:2335); the engine let Trick through a
    // Substitute (emulator: traces/00306, ROM -2, sim +1).
    if ((isYou ? s.oppSubstituteHP : s.youSubstituteHP) != null) return "failed";
    if (!self.item && !foe.item) return "failed";
    // ...and an Enigma Berry or mail on either side fails it (:9217-9222).
    if ([self.item, foe.item].some((it) => it && TRICK_UNSWAPPABLE.has(itemData(it)?.constant))) return "failed";
    if (foe.ability === "Sticky Hold") { recordAbility(s, isYou ? "opp" : "you", "Sticky Hold"); return "failed"; } // F2a :9233
    s[isYou ? "youItemOverride" : "oppItemOverride"] = foe.item ?? null;
    s[isYou ? "oppItemOverride" : "youItemOverride"] = self.item ?? null;
    _changedItemsActor = actor; // F26: the attacker's new item waits in changedItems (:9240)
    // ...and a swap clears BOTH battlers' choicedMove (:9254-9258).
    s.youChoiceLock = null;
    s.oppChoiceLock = null;
  },
  EFFECT_RECYCLE: (s, actor, ctx) => {
    // Cmd_tryrecycleitem (:9430-9452): restores the user's USED item, and only
    // when the user is currently holding nothing. The one consumable this
    // engine tracks is the status-curing berry (youBerryConsumed), so that is
    // what can be recycled; any other consumption is not modelled and the move
    // correctly fails rather than inventing an item.
    const isYou = actor === "you";
    const self = isYou ? ctx.you : ctx.opp;
    const usedKey = isYou ? "youUsedItem" : "oppUsedItem";
    const consumedKey = isYou ? "youBerryConsumed" : "oppBerryConsumed";
    const itemKey = isYou ? "youItemOverride" : "oppItemOverride";
    // Read the HELD item from the state, not from the mon: whether ctx carries
    // effective mons depends on the caller, and this must be right either way.
    const held = s[itemKey] !== undefined ? s[itemKey] : self.item;
    if (!s[usedKey]) return "failed";
    if (held) return "failed";
    s[itemKey] = s[usedKey];
    s[usedKey] = null;
    s[consumedKey] = false;
  },

  EFFECT_POISON: (s, actor, ctx) => {
    // BattleScript_EffectPoison (data/battle_scripts_1.s:1010-1029) is
    // BattleScript_EffectToxic's script minus the bad-poison counter: Immunity,
    // Substitute, already-poisoned, Poison/Steel types, any other status,
    // accuracy, Safeguard. inflictStatus already applies that whole chain,
    // which is why EFFECT_TOXIC is one line too -- the ONLY difference between
    // them is the counter, and this is the sibling that never got ported.
    const isYou = actor === "you";
    const foeMon = isYou ? ctx.opp : ctx.you;
    const foeSide = isYou ? "opp" : "you";
    if (!inflictStatus(s, foeSide, "poison", foeMon.types, foeMon.ability)) return "failed";
  },
  EFFECT_LOCK_ON: (s, actor) => {
    // Cmd_setalwayshitflag (src/battle_script_commands.c:8120-8127) puts a
    // 2-turn STATUS3_ALWAYS_HITS on the TARGET, meaning "attacks from the user
    // against THIS mon cannot miss". Two turns because it is decremented at the
    // end of the turn it is set (src/battle_util.c:1739-1740), so it covers
    // this turn and the next one.
    s[actor === "you" ? "oppAlwaysHitTurns" : "youAlwaysHitTurns"] = 2;
  },

  // -- B2b batch 9 executors ----------------------------------------------
  EFFECT_MAGIC_COAT: (s, actor) => {
    // gProtectStructs.bounceMove, set for the rest of THIS turn only. The
    // failure case (the user moves last) is decided in enumerateActionOutcomes.
    s[actor === "you" ? "youBouncing" : "oppBouncing"] = true;
  },
  EFFECT_MIST: (s, actor) => {
    // Cmd_setmist (:7734-7748): fails if already up, else a 5-turn side timer.
    const key = actor === "you" ? "youMistTurns" : "oppMistTurns";
    if (s[key] != null) return "failed";
    s[key] = 5;
  },
  EFFECT_STOCKPILE: (s, actor) => {
    // Cmd_stockpile (:6850-6866): at three it sets MOVE_RESULT_MISSED -- a
    // MISS, not a FAILURE, which is a different Skill outcome. Preserved.
    const key = actor === "you" ? "youStockpile" : "oppStockpile";
    if (s[key] === 3) return "missed";
    s[key] += 1;
  },
  EFFECT_SWALLOW: (s, actor, ctx) => {
    // Cmd_stockpiletohpheal (:6894-6923): maxHP / (1 << (3 - counter)) --
    // a quarter, a half, then everything -- and the counter is spent either
    // way. Fails with nothing stored, and fails at full HP WITHOUT healing
    // while still clearing the counter.
    // Phase D F37: both failures jump to BattleScript_SwallowFail
    // (data/battle_scripts_1.s:2126-2130), which sets no MOVE_RESULT flag and
    // prints from gSwallowFailStringIds -- neither a DeductSkillPoints string:
    // +1, not the "failed" (-2) these returned.
    const isYou = actor === "you";
    const key = isYou ? "youStockpile" : "oppStockpile";
    const hpKey = isYou ? "yourHpPct" : "oppHpPct";
    const mon = isYou ? ctx.you : ctx.opp;
    if (s[key] === 0) return;
    const count = s[key];
    s[key] = 0;
    if (s[hpKey] >= 100) return;
    const heal = Math.max(1, Math.floor(mon.stats.hp / (1 << (3 - count))));
    s[hpKey] = hpAdd(s[hpKey], heal, mon.stats.hp);
  },
  EFFECT_MEMENTO: (s, actor, ctx) => {
    // Cmd_trymemento (:9265-9283): fails only when the target is ALREADY at
    // minimum in BOTH Attack and Special Attack. Otherwise the user's HP goes
    // to zero and the target drops 2 in each.
    const isYou = actor === "you";
    const foeStages = isYou ? s.oppStages : s.youStages;
    const foeMon = isYou ? ctx.opp : ctx.you;
    if (foeStages.atk <= -6 && foeStages.spa <= -6) return "failed";
    s[isYou ? "yourHpPct" : "oppHpPct"] = 0;
    // The drops themselves still go through the normal blocks -- Substitute,
    // Clear Body / White Smoke and Mist -- because statbuffchange is what
    // applies them, and Memento passes STAT_CHANGE_ALLOW_PTR, not `certain`.
    if (s[isYou ? "oppSubstituteHP" : "youSubstituteHP"] != null) return;
    // F2a: ChangeStatBuffs checks Mist before the abilities, so a record needs no Mist.
    const mistUp = s[isYou ? "oppMistTurns" : "youMistTurns"] != null;
    if (!mistUp && ["Clear Body", "White Smoke", "Hyper Cutter"].includes(foeMon.ability)) recordAbility(s, isYou ? "opp" : "you", foeMon.ability);
    if (foeMon.ability === "Clear Body" || foeMon.ability === "White Smoke") return;
    if (mistUp) return;
    if (foeMon.ability !== "Hyper Cutter") bumpStage(foeStages, "atk", -2);
    bumpStage(foeStages, "spa", -2);
  },
  // -- B2b batch 6 executors ----------------------------------------------
  EFFECT_SPLASH: () => undefined,
  // BattleScript_EffectSplash (data/battle_scripts_1.s:1830-1839) prints
  // STRINGID_BUTNOTHINGHAPPENED and gotos MoveEnd -- it sets NO MOVE_RESULT
  // flag, so it is a LANDED move that does nothing, not a failure. Returning
  // "failed" here would wrongly cost the user its Skill point. Splash appears
  // in AI_CV's "encouraged when target is asleep" table but has no CBM or CV
  // row of its own, which is why it needs no AI handler.
  // EFFECT_SNORE has no executor ENTRY on purpose: a damaging move's executor
  // only ever runs through the secondary-chance dispatch, so a "fails while
  // awake" rule written here would be dead code. It lives inline in the damage
  // path instead, beside Dream Eater's sleep gate, which is the same shape.
  EFFECT_MUD_SPORT: (s, actor) => {
    // Cmd_settypebasedhalvers (src/battle_script_commands.c:9760-9780): fails
    // if the user already has the flag, otherwise sets it for the rest of the
    // battle -- there is no timer. src/battle_main.c:3176 keeps it across a
    // switch, which is moot here.
    const key = actor === "you" ? "youMudSport" : "oppMudSport";
    if (vf(s, key)) return "failed";
    setVf(s, key, true);
  },
  EFFECT_WATER_SPORT: (s, actor) => {
    const key = actor === "you" ? "youWaterSport" : "oppWaterSport";
    if (vf(s, key)) return "failed";
    setVf(s, key, true);
  },
  // -- B2b batch 4 executors ----------------------------------------------
  EFFECT_HELPING_HAND: () => "failed",
  // Cmd_trysethelpinghand (src/battle_script_commands.c) is gated on
  // BATTLE_TYPE_DOUBLE. The Arena is singles, so it ALWAYS takes the failure
  // branch -- inert by ruleset, not unported, and the same shape as Follow Me.
  EFFECT_SPIKES: (s, actor) => {
    // Cmd_trysetspikes (:8485-8500): fails at three layers, otherwise adds one
    // to the TARGET's side.
    //
    // The layers are laid faithfully and can never bite: the damage is applied
    // in Cmd_switchineffects (:5229-5240), on SWITCH-IN, and an Arena matchup
    // has no switching. So Spikes is a move that reliably succeeds and reliably
    // does nothing here. Tracked rather than collapsed to a no-op, because the
    // AI scores the second layer differently from the first.
    const key = actor === "you" ? "oppSpikesLayers" : "youSpikesLayers";
    if (s[key] >= 3) return "failed";
    s[key] += 1;
  },
  EFFECT_HEAL_BELL: (s, actor, ctx) => {
    // healpartystatus: clears the user's side's major status. Only the active
    // mon is modelled (an Arena matchup has no reserve party), so this clears
    // the user's own status and nothing else. Source does not fail when there
    // is nothing to cure -- the script has no ButItFailed branch at all.
    const isYou = actor === "you";
    const statusKey = isYou ? "youStatus" : "oppStatus";
    s[statusKey] = null;
    s[isYou ? "youSleepTurns" : "oppSleepTurns"] = null;
    s[isYou ? "youToxicCounter" : "oppToxicCounter"] = null;
    s[isYou ? "youNightmared" : "oppNightmared"] = false; // a cured sleep takes the nightmare with it
    void ctx;
  },
  EFFECT_REFRESH: (s, actor) => {
    // cureifburnedparalyzedorpoisoned: exactly those three, and it FAILS when
    // the user carries none of them. Sleep and freeze are untouched.
    const isYou = actor === "you";
    const statusKey = isYou ? "youStatus" : "oppStatus";
    if (!["poison", "burn", "paralysis"].includes(s[statusKey])) return "failed";
    s[statusKey] = null;
    s[isYou ? "youToxicCounter" : "oppToxicCounter"] = null;
  },
  EFFECT_NIGHTMARE: (s, actor, ctx) => {
    // BattleScript_EffectNightmare (data/battle_scripts_1.s:1459-1466): fails
    // through a Substitute, fails if already nightmared, and REQUIRES the
    // target to be asleep. The residual is maxHP/4 per end-of-turn.
    const isYou = actor === "you";
    const foeSubKey = isYou ? "oppSubstituteHP" : "youSubstituteHP";
    const foeNightKey = isYou ? "oppNightmared" : "youNightmared";
    const foeStatusKey = isYou ? "oppStatus" : "youStatus";
    if (s[foeSubKey] != null) return "failed";
    if (s[foeNightKey]) return "failed";
    if (s[foeStatusKey] !== "sleep") return "failed";
    s[foeNightKey] = true;
    void ctx;
  },
  // Flatter IS Swagger with (SpAtk, +1) -- same script, shared builder.
  EFFECT_FLATTER: raiseThenConfuseExecutor("spa", 1),
  EFFECT_PAIN_SPLIT: (s, actor, ctx) => {
    // Cmd_painsplitdmgcalc: fails through a Substitute, otherwise both sides
    // end on floor((hpA + hpB) / 2), each capped at its own max HP.
    const isYou = actor === "you";
    const selfMon = isYou ? ctx.you : ctx.opp;
    const foeMon = isYou ? ctx.opp : ctx.you;
    const selfHpKey = isYou ? "yourHpPct" : "oppHpPct";
    const foeHpKey = isYou ? "oppHpPct" : "yourHpPct";
    if (s[isYou ? "oppSubstituteHP" : "youSubstituteHP"] != null) return "failed";
    const selfHp = Math.round((s[selfHpKey] / 100) * selfMon.stats.hp);
    const foeHp = Math.round((s[foeHpKey] / 100) * foeMon.stats.hp);
    const shared = Math.floor((selfHp + foeHp) / 2);
    s[selfHpKey] = (Math.min(shared, selfMon.stats.hp) * 100) / selfMon.stats.hp;
    s[foeHpKey] = (Math.min(shared, foeMon.stats.hp) * 100) / foeMon.stats.hp;
  },
  // -- B2b batch 2 executors: the move-restriction family ----------------
  EFFECT_DISABLE: (s, actor, ctx, moveData, sleepDuration, attractGenderCompatible, disableTimer) => {
    // Cmd_disablelastusedattack. Fails unless the target's LAST move is still
    // in its moveset AND it has no disabled move already. On turn 1 gLastMoves
    // is empty, so Disable simply fails -- which is why Disable is so often a
    // wasted turn-1 move and why AI_CV_Disable scores it down.
    // PP != 0 is also required in source; PP is not modelled and three turns
    // cannot exhaust it, so that clause is inert here (stated, not skipped).
    const isYou = actor === "you";
    const foeMon = isYou ? ctx.opp : ctx.you;
    const foeDisabledKey = isYou ? "oppDisabledMove" : "youDisabledMove";
    const foeLast = isYou ? s.oppLastMove : s.youLastMove;
    if (s[foeDisabledKey]) return "failed";
    if (!foeLast || !foeMon.moves.includes(foeLast)) return "failed";
    s[foeDisabledKey] = foeLast;
    s[isYou ? "oppDisableTurns" : "youDisableTurns"] = disableTimer;
  },
  EFFECT_ENCORE: (s, actor, ctx) => {
    // Cmd_trysetencore. Fails if the target is already encored, if its last
    // move is Struggle / Encore / Mirror Move, or if that move is no longer in
    // its set (which includes having no last move at all).
    //
    // THE TIMER IS PROVEN INERT and is therefore not branched. Source sets
    // (Random() & 3) + 3, i.e. 3..6. A mon is encored on turn t+j while the
    // timer exceeds j, the timer decrements once per end-of-turn, and j can
    // only reach 2 inside a 3-turn round -- so every draw in 3..6 behaves
    // identically here. The minimum, 3, is stored as the representative.
    const isYou = actor === "you";
    const foeMon = isYou ? ctx.opp : ctx.you;
    const foeEncoredKey = isYou ? "oppEncoredMove" : "youEncoredMove";
    const foeLast = isYou ? s.oppLastMove : s.youLastMove;
    if (s[foeEncoredKey]) return "failed";
    if (!foeLast || !foeMon.moves.includes(foeLast)) return "failed";
    if (foeLast === "Struggle" || foeLast === "Encore" || foeLast === "Mirror Move") return "failed";
    s[foeEncoredKey] = foeLast;
    s[isYou ? "oppEncoreTurns" : "youEncoreTurns"] = 3;
  },
  EFFECT_TORMENT: (s, actor) => {
    // Cmd_settorment: fails outright if STATUS2_TORMENT is already set.
    const key = actor === "you" ? "oppTormented" : "youTormented";
    if (s[key]) return "failed";
    s[key] = true;
  },
  EFFECT_IMPRISON: (s, actor, ctx) => {
    // Cmd_tryimprison: fails if the USER is already imprisoning, and otherwise
    // requires at least one move shared with the foe -- "In Generation 3 games,
    // Imprison fails if the user doesn't share any moves with any of the foes",
    // source's own comment. The flag then sits on the USER and blocks the FOE.
    const isYou = actor === "you";
    const selfKey = isYou ? "youImprisoning" : "oppImprisoning";
    if (s[selfKey]) return "failed";
    const selfMon = isYou ? ctx.you : ctx.opp;
    const foeMon = isYou ? ctx.opp : ctx.you;
    if (!selfMon.moves.some((m) => foeMon.moves.includes(m))) return "failed";
    s[selfKey] = true;
  },
  EFFECT_DEFENSE_CURL: (s, actor) => {
    // BattleScript_EffectDefenseCurl (data/battle_scripts_1.s:2014-2025):
    // setdefensecurlbit, then STAT_DEF +1 on the USER. Cannot fail -- at +6 it
    // takes the B_MSG_STAT_WONT_INCREASE branch, which still ends the move
    // normally (no MOVE_RESULT_FAILED), which is what bumpStage's silent clamp
    // already reproduces. The curl bit only feeds EFFECT_ROLLOUT's power
    // doubling, still in ACCEPTED_UNMODELED (B3) -- tracked, not dropped.
    setVf(s, actor === "you" ? "youDefenseCurled" : "oppDefenseCurled", true);
    bumpStage(actor === "you" ? s.youStages : s.oppStages, "def", 1);
  },
  EFFECT_DEFENSE_DOWN: statDownExecutor("def", 1, null),
  EFFECT_SPEED_DOWN: statDownExecutor("spe", 1, null),
  EFFECT_TICKLE: (s, actor, ctx) => {
    // BattleScript_EffectTickle (data/battle_scripts_1.s:2652-2677): Atk -1
    // then Def -1, both on the TARGET, as two separate statbuffchange calls.
    // The move fails outright ONLY when Atk is already at MIN_STAT_STAGE AND
    // Def is too -- the jumpifstat pair at :2656-2657 routes exactly that case
    // to BattleScript_CantLowerMultipleStats. Because the two drops are
    // independent statbuffchanges, Hyper Cutter blocks the Atk half ALONE and
    // the Def half still lands -- which is why this cannot reuse
    // statDownExecutor, whose blockingAbility fails the whole move.
    //
    // Phase D F36: the script has NO Substitute check (BattleScript_EffectStatDown
    // has one at :536; this one does not) and ChangeStatBuffs has none, so
    // Tickle goes through a Substitute. Mist stops both statbuffchanges first
    // (src/battle_script_commands.c:6962-6980): nothing lands, no flag, +1.
    // Hyper Cutter stops the Attack half with STRINGID_PKMNSXPREVENTSYLOSS
    // (:7022-7034), a deducting string: +1 -3, and the Defense half lands.
    const isYou = actor === "you";
    const foeMon = isYou ? ctx.opp : ctx.you;
    const foeStages = isYou ? s.oppStages : s.youStages;
    if (foeStages.atk <= -6 && foeStages.def <= -6) return "failed";
    if (s[isYou ? "oppMistTurns" : "youMistTurns"] != null) return;
    // F2a: ChangeStatBuffs records the blocking ability (:7003, :7031).
    if (["Clear Body", "White Smoke", "Hyper Cutter"].includes(foeMon.ability)) recordAbility(s, isYou ? "opp" : "you", foeMon.ability);
    if (foeMon.ability === "Clear Body" || foeMon.ability === "White Smoke") return "failed";
    bumpStage(foeStages, "def", -1);
    if (foeMon.ability === "Hyper Cutter") return { printed: ["STRINGID_PKMNSXPREVENTSYLOSS"] };
    bumpStage(foeStages, "atk", -1);
  },
  EFFECT_MINIMIZE: (s, actor) => {
    // BattleScript_EffectMinimize (data/battle_scripts_1.s:1476-1480):
    // setminimize, then STAT_EVASION +1 -- Gen III raises it by ONE, not the
    // two of later generations. The minimize bit doubles
    // EFFECT_FLINCH_MINIMIZE_HIT (Stomp/Extrasensory) into this mon -- its
    // consumer landed in B4c.
    setVf(s, actor === "you" ? "youMinimized" : "oppMinimized", true);
    bumpStage(actor === "you" ? s.youStages : s.oppStages, "evasion", 1);
  },
  EFFECT_FOCUS_ENERGY: (s, actor) => {
    // BattleScript_EffectFocusEnergy (data/battle_scripts_1.s:885-895): fails
    // outright (jumpifstatus2 -> ButItFailed) when STATUS2_FOCUS_ENERGY is
    // already set, else setfocusenergy. The flag raises the crit stage by 2;
    // its damage consumer is critChanceFor (B6-2), and AI_CBM_FocusEnergy's
    // own check reads it too.
    const key = actor === "you" ? "youFocusEnergy" : "oppFocusEnergy";
    if (vf(s, key)) return "failed";
    setVf(s, key, true);
  },
  EFFECT_BELLY_DRUM: (s, actor, ctx) => {
    // Cmd_maxattackhalvehp (src/battle_script_commands.c): halfHp =
    // floor(maxHP/2), floored to 1. Succeeds only when the user's Atk stage is
    // BELOW MAX_STAT_STAGE and its current HP is STRICTLY GREATER than halfHp;
    // otherwise it branches to ButItFailed. On success Atk is ASSIGNED
    // MAX_STAT_STAGE outright (not incremented) and the user pays halfHp.
    const isYou = actor === "you";
    const selfMon = isYou ? ctx.you : ctx.opp;
    const selfHpKey = isYou ? "yourHpPct" : "oppHpPct";
    const stages = isYou ? s.youStages : s.oppStages;
    const halfHp = Math.max(1, Math.floor(selfMon.stats.hp / 2));
    const currentHp = Math.round((s[selfHpKey] / 100) * selfMon.stats.hp);
    if (stages.atk >= 6 || currentHp <= halfHp) return "failed";
    stages.atk = 6;
    s[selfHpKey] = hpSub(s[selfHpKey], halfHp, selfMon.stats.hp);
  },
  EFFECT_HAZE: (s) => {
    // Cmd_normalisebuffs (src/battle_script_commands.c): loops over EVERY
    // battler and every one of NUM_BATTLE_STATS, writing DEFAULT_STAT_STAGE --
    // so it resets BOTH sides, not just the foe, and it is side-agnostic
    // (hence no `actor` parameter). It cannot fail: the script
    // (data/battle_scripts_1.s:562-571) has no ButItFailed branch at all,
    // so Haze into a completely unmodified board still scores as landed.
    for (const k of ["atk", "def", "spa", "spd", "spe", "evasion", "accuracy"]) {
      s.youStages[k] = 0;
      s.oppStages[k] = 0;
    }
  },
  EFFECT_FORESIGHT: (s, actor) => {
    // Cmd_setforesight (src/battle_script_commands.c:8502-8506) sets
    // STATUS2_FORESIGHT on the TARGET unconditionally -- no substitute check,
    // no already-set check, and BattleScript_EffectForesight
    // (data/battle_scripts_1.s:1555-1565) has no ButItFailed path, so the only
    // way it misses is the accuracycheck the caller already resolved.
    // Both consequences are wired live: the target's evasion stage drops out
    // of the accuracy calc, and Normal/Fighting stop being no-effect against
    // its Ghost typing.
    s[actor === "you" ? "oppForesighted" : "youForesighted"] = true;
  },
  EFFECT_EVASION_DOWN: statDownExecutor("evasion", 1, null),
  // Other effects (e.g. EFFECT_SPECIAL_DEFENSE_DOWN_HIT on Shadow Ball):
  // no executor yet. For power>0 moves this just means the secondary effect
  // is silently skipped (damage still applies normally) until ported — an
  // intentional simplification, not a silent correctness bug, since it only
  // affects the rare chance-triggered bonus, not the move's main function.
};

// ── Mandatory-mechanic guard (engine change #11) ─────────────────────────────
// AXIS DISTINCTION — this guard is ORTHOGONAL to SILENT_FALLTHROUGH_EFFECTS,
// and there is deliberately no overlap between the two sets:
//   * SILENT_FALLTHROUGH_EFFECTS: "the damage NUMBER is meaningless" — fixed/
//     level/HP-based moves whose real power isn't power-based, so the generic
//     power formula computes garbage off a move-data.js placeholder.
//   * This guard:                 "the damage number is FINE, but a mandatory
//     on-hit/on-use MECHANIC is missing" — the move deals correct generic
//     damage but silently drops an always-happens side effect (self stat-drop,
//     recharge, charge, lock-in, guaranteed flinch, delayed damage, ...).
// The bug this closed (at the time): for power>0 moves the executor at the
// bottom of the damage path was gated on `secondaryTriggered`, true ONLY for
// three hand-listed moves (B4 has since replaced that gate). Every power>0 move whose effect
// carries a mandatory mechanic falls straight through to plain damage with no
// throw — the same class of silent degradation that hid EFFECT_ABSORB (29
// sets) and EFFECT_DREAM_EATER (5) until changes #9/#10.
//
// DESIGN: fail CLOSED. Rather than blocklisting "effects with mandatory
// mechanics" (which rots — the next unported effect won't be on it), we derive
// the set of effects whose execution is COMPLETE from the tables that already
// encode that, and throw on anything power>1 that is neither handled nor on an
// explicit, shrinking allowlist of known-unmodeled effects. A brand-new,
// unclassified effect therefore stops here loudly instead of degrading.

// PURE_DAMAGE: power>1 effects whose ONLY consequence is damage (any accuracy/
// priority/charge-bypass quirk they have is already modeled elsewhere), so a
// generic damage hit is the complete, correct behavior — no executor needed.
const PURE_DAMAGE_EFFECTS = new Set([
  "EFFECT_HIT",            // plain damage
  "EFFECT_EARTHQUAKE",     // Dig double-damage bypass handled via INVULN_BYPASS
  "EFFECT_ALWAYS_HIT",     // accuracy bypass handled (accuracy: null)
  "EFFECT_QUICK_ATTACK",   // +1 priority handled in turn-order resolution
  "EFFECT_HIGH_CRITICAL",  // the +1 crit stage is critChanceFor's (B6-2); AI scoring ported #9
  "EFFECT_RETURN",         // friendship-based power handled in calcDamage
  "EFFECT_FRUSTRATION",    // friendship-based power handled in calcDamage
  "EFFECT_HIDDEN_POWER",   // hiddenpowercalc then BattleScript_EffectHit (data/battle_scripts_1.s:1740-1742); type/power via battleMoveData
  "EFFECT_SKY_UPPERCUT",   // hits-through-Fly bypass; inert here (target never Flies)
  // B2b batch 5. Eruption and Water Spout carry NO on-hit mechanic at all --
  // their whole specialness is the HP-scaled base power, which calcDamage now
  // computes (Cmd_scaledamagebyhealthratio, src/battle_script_commands.c:9379).
  // They reach this guard, unlike the rest of batch 5, because their table
  // power is 150 rather than the 1-placeholder.
  "EFFECT_ERUPTION",
  // B2b batch 6. Pay Day's only consequence is gPaydayMoney, and only when the
  // attacker is the PLAYER (src/battle_script_commands.c:2583-2592). It is
  // money picked up after the battle -- it touches no battler, no status and no
  // judging category. Genuinely pure damage here, with nothing ledgered.
  "EFFECT_PAY_DAY",
]);

// INLINE_HANDLED: mandatory-mechanic effects whose consequence is applied
// INLINE in applyMove's damage path (not via EFFECT_EXECUTORS), so they are
// fully modeled despite never dispatching through the secondaryTriggered gate.
const INLINE_HANDLED_EFFECTS = new Set([
  "EFFECT_EXPLOSION",         // self-faint, applied unconditionally (l.~2996)
  "EFFECT_SEMI_INVULNERABLE", // 2-turn charge/invuln (l.~3117-3132)
  "EFFECT_COUNTER",           // physical reflect (l.~3056) — power=1, but list for completeness
  "EFFECT_MIRROR_COAT",       // special reflect (l.~3056) — power=1
  "EFFECT_DREAM_EATER",       // drain + sleep gate (DRAIN_EFFECTS + l.~3176)
  // B2b batch 6. Gust and Twister's mandatory mechanic is the semi-invulnerable
  // bypass AND the 2x bonus against a target in the air -- both already applied
  // inline from INVULN_BYPASS in the damage path. Nothing was missing but the
  // classification, which is why this entry adds no behaviour.
  "EFFECT_GUST",
  // B2b batch 7: the two-turn charge family, handled by the same two blocks as
  // EFFECT_SEMI_INVULNERABLE (see CHARGE_EFFECTS). Solar Beam and Sky Attack
  // LEFT the accepted-unmodelled ledger in this commit; Razor Wind was never on
  // it and simply threw.
  "EFFECT_RAZOR_WIND", "EFFECT_SKULL_BASH", "EFFECT_SOLAR_BEAM",
  // B2b batch 9. Rapid Spin's MOVE_EFFECT_RAPIDSPIN is CERTAIN, not a chance
  // secondary, and is applied inline in the damage path.
  "EFFECT_RAPID_SPIN",
  // Spit Up: the stockpile multiplier is applied inline through calcDamage's
  // baseMultiplier, and the counter is spent there too.
  "EFFECT_SPIT_UP",
  // B2b batch 10: Thief's steal is a CERTAIN on-hit effect, applied inline.
  "EFFECT_THIEF",
  // B2b batch 11: Rage's flag and its MOVEEND_RAGE Attack raise, both inline.
  "EFFECT_RAGE",
  // ── B3 batch 1: six that LEFT the accepted-unmodelled ledger ────────────
  // Each was ledgered for a reason that had expired. Knock Off needed mutable
  // items (batch 10). Smelling Salt needed a damage multiplier (batch 9's Spit
  // Up). The other four needed nothing but the work.
  "EFFECT_BRICK_BREAK",    // clears both screens BEFORE its own damage
  "EFFECT_OVERHEAT",       // user SpAtk -2, CERTAIN
  "EFFECT_SUPERPOWER",     // user Atk -1 and Def -1, CERTAIN
  "EFFECT_KNOCK_OFF",      // removes the target's item, blocked by Sticky Hold
  "EFFECT_SMELLINGSALT",   // 2x into paralysis, and cures it
  "EFFECT_RECOIL_IF_MISS", // crash damage on a miss, capped at target maxHP/2
  // B3 batch 1 continued: the two that cost their user a TURN rather than HP.
  "EFFECT_FOCUS_PUNCH",    // priority -3, and loses focus if damaged first
  "EFFECT_RECHARGE",       // the user forfeits its next action entirely
  // B3 batch 2: the flinch is modelled now (CANCELER_FLINCH), so Fake Out is too.
  "EFFECT_FAKE_OUT",       // turn-1-only, and a CERTAIN flinch
  // B3 batch 3: the locked-move family, first half.
  "EFFECT_RAMPAGE",        // 2-3 turn lock, then self-confusion
  "EFFECT_ROLLOUT",        // 5-hit lock, doubling power
  // B3 batch 4d: the locked-move family, complete.
  "EFFECT_UPROAR",         // 2-5 turn lock, a battle-wide sleep block and wake
  // B3 batch 5: the residual. Its switch-block is inert here -- the Arena has
  // no switching -- so the wrap is only its damage and its counter.
  "EFFECT_TRAP",           // 3-6 turn wrap, maxHP/16 per turn
  // B3 batch 5b: the delayed hit, released at turn end before the judges.
  "EFFECT_FUTURE_SIGHT",   // fixed at use, lands 2 turn-ends later
  // B3 batch 6: the ledger's last entry.
  "EFFECT_TRIPLE_KICK",    // 10/20/30, each hit re-checks accuracy
  // Fury Cutter's escalating power, counter and resets, applied inline in the
  // damage path (Cmd_furycuttercalc, src/battle_script_commands.c:8580-8602).
  "EFFECT_FURY_CUTTER",
]);

// CHANCE_SECONDARY: the class of effects whose only consequence beyond damage
// is a PROBABILISTIC secondary. Until B4 these were deliberately never rolled
// (a hand table knew three moves); B4a-d ported the whole class -- status,
// stat changes, flinch (with King's Rock) and confusion -- into
// SECONDARY_SPEC, whose keys are part of HANDLED below. What remains here is
// the empty set, which is the class's closing record.
const CHANCE_SECONDARY_EFFECTS = new Set([
  // EMPTY SINCE B4 (a-d). Every effect that used to sit here -- a chance
  // secondary that was deliberately never rolled -- now rolls through
  // SECONDARY_SPEC / applySecondary. The set is kept, empty, so the guard's
  // derivation and the tools that read it keep their shape.
]);

// DAMAGE_MAGNITUDE_ONLY: power>1 effects that deal ordinary power-based damage
// multiplied by a runtime CONDITION the engine does not yet apply — EFFECT_FACADE
// (2x if user statused), EFFECT_PURSUIT (2x on a switching target), EFFECT_REVENGE
// (2x if user was hit first). They drop NO mandatory mechanic, so from THIS
// guard's axis they proceed cleanly; their gap is a wrong damage NUMBER, which
// is the SILENT_FALLTHROUGH axis (see that set's "conditional-multiplier"
// comment). Listed here only so the fail-closed guard does not throw on them —
// their real fix is a SEPARATE queued change, deliberately not folded into #11.
const DAMAGE_MAGNITUDE_ONLY_EFFECTS = new Set([
  "EFFECT_FACADE", "EFFECT_PURSUIT", "EFFECT_REVENGE",
]);

// HANDLED: the set of power>0 effects for which reaching the damage path with
// NO secondary executor is legitimate — either execution is complete, or the
// only thing dropped is an accepted probabilistic secondary / a damage-magnitude
// condition tracked on another axis. Derived from the tables that actually
// implement effects (plus the curated PURE/CHANCE/DMG-MAGNITUDE sets), so it
// cannot drift out of sync with the implementation it summarizes. Anything
// power>1 NOT in here and NOT in ACCEPTED_UNMODELED_EFFECTS fails closed.
const HANDLED_EFFECTS = new Set([
  ...Object.keys(EFFECT_EXECUTORS),
  ...Object.keys(SECONDARY_SPEC),  // B4: dispatched by applySecondary
  ...DRAIN_EFFECTS,
  ...Object.keys(RECOIL_FRACTION),
  ...Object.keys(MULTI_HIT_DISTRIBUTION),
  ...INLINE_HANDLED_EFFECTS,
  ...PURE_DAMAGE_EFFECTS,
  ...CHANCE_SECONDARY_EFFECTS,
  ...DAMAGE_MAGNITUDE_ONLY_EFFECTS,
]);

// ACCEPTED_UNMODELED: power>1 effects with a MANDATORY mechanic that is known
// to be unported and is, for now, deliberately allowed to degrade to plain
// damage. This list is the honest debt ledger: each fix-change deletes its
// entry and moves the effect into HANDLED, shrinking this set toward empty.
// Firing on one of these WARNS ONCE (deduped by effect) and proceeds, so the
// sweep and every P(win) stay exactly as they were — the guard adds no
// computed-output change, only visibility. Set counts are the current pool
// (552 sets); see change #11 report §2.
const ACCEPTED_UNMODELED_EFFECTS = {
  // B2b batch 7 LEDGERED these two rather than porting them, with the reason
  // named and the cost counted, because both need machinery that does not exist
  // yet and neither is cheap:
};

// Warn-once dedup — module-scoped so a full 552-set sweep prints at most one
// line per accepted-unmodeled effect, not one per set/turn/branch.
const _warnedUnmodeledEffects = new Set();
function warnUnmodeledMechanicOnce(effect, moveName) {
  if (_warnedUnmodeledEffects.has(effect)) return;
  _warnedUnmodeledEffects.add(effect);
  console.warn(`[mandatory-mechanic] "${moveName}" (${effect}): ${ACCEPTED_UNMODELED_EFFECTS[effect]} ` +
    `— degrading to plain damage (change #11 accepted-unmodeled ledger).`);
}

// B7c: the battle path's calcDamage ARGUMENTS, in one place.
//
// This exists so the Focus Band lethality probe can ask "would this hit kill?"
// by calling THE SAME calcDamage with THE SAME inputs the battle path uses. The
// alternative -- a second, probe-only damage estimate -- is exactly the drift
// anti-pattern this project exists downstream of, and it would be wrong the
// moment either copy gained a modifier the other lacked.
// The script's damage multiplier (gBattleScripting.dmgMultiplier), from the
// state BEFORE the move: Smelling Salt x2 into an unsubstituted paralysed
// target (BattleScript_EffectSmellingsalt -> SmellingsaltDoubleDmg), Stomp's
// family x2 into STATUS3_MINIMIZED (data/battle_scripts_1.s:1898-1901), Spit
// Up x the stockpile (0 = nothing stored, and the move fails). Phase D F39: one
// function, read by applyMove's damage AND by Focus Band's lethality probe, so
// the probe cannot ask about a different hit than the one that lands.
function scriptDamageMultiplier(state, actor, moveData) {
  const isYou = actor === "you";
  if (moveData.effect === "EFFECT_SMELLINGSALT" && state[isYou ? "oppStatus" : "youStatus"] === "paralysis"
      && state[isYou ? "oppSubstituteHP" : "youSubstituteHP"] == null) return 2;
  if (moveData.effect === "EFFECT_FLINCH_MINIMIZE_HIT" && vf(state, isYou ? "oppMinimized" : "youMinimized")) return 2;
  if (moveData.effect === "EFFECT_SPIT_UP") return state[isYou ? "youStockpile" : "oppStockpile"];
  return 1;
}

function battleDamageOptions(ctx, s, actor, moveData, variablePower = null, baseMultiplier = 1, crit = false) {
  const { you, opp } = ctx;
  const isYou = actor === "you";
  const selfMon = isYou ? you : opp;
  const foeMon = isYou ? opp : you;
  const atkStatKey = moveData.category === "physical" ? "atk" : "spa";
  const defStatKey = moveData.category === "physical" ? "def" : "spd";
  const selfStages = isYou ? s.youStages : s.oppStages;
  const foeStages = isYou ? s.oppStages : s.youStages;
  const selfStatusKey = isYou ? "youStatus" : "oppStatus";
  const foeStatusKey = isYou ? "oppStatus" : "youStatus";
  // Reflect/Light Screen: halves damage of the matching category, gated on the
  // DEFENDER'S side having it up (src/pokemon.c:3267-3273 / 3318-3324). Crits
  // bypass this (the gCritMultiplier == 1 gate): `crit` below turns it off.
  const foeReflect = isYou ? s.oppReflectTurns : s.youReflectTurns;
  const foeLightScreen = isYou ? s.oppLightScreenTurns : s.youLightScreenTurns;
  return {
    defenderForesighted: isYou ? s.oppForesighted : s.youForesighted,
    attackerStatus: s[selfStatusKey],
    defenderStatus: s[foeStatusKey],
    atkStage: selfStages[atkStatKey],
    defStage: foeStages[defStatKey],
    attackerBurned: s[selfStatusKey] === "burn",
    attackerFlashFireActive: isYou ? s.youFlashFireActive : s.oppFlashFireActive,
    attackerHpPct: isYou ? s.yourHpPct : s.oppHpPct,
    // B6-2: a crit ignores Reflect / Light Screen (the gCritMultiplier == 1
    // gate on each halving, src/pokemon.c:3267-3273 / 3318-3324).
    crit,
    screenActive: !crit && (moveData.category === "physical" ? foeReflect != null : foeLightScreen != null),
    weather: effectiveWeather(s, you, opp),
    // B2b batch 5. Super Fang and Endeavor read the DEFENDER's current HP, which
    // no other damage path needed; the enumerated draw reaches Magnitude,
    // Present and Psywave the same way hitCount reaches the multi-hit loop.
    defenderHpPct: isYou ? s.oppHpPct : s.yourHpPct,
    variablePower,
    // Either side's sport halves that type for EVERYONE (the flag is read off
    // gStatuses3 for both battlers in CalculateBaseDamage), so this is an OR
    // across the two sides, not the attacker's own flag.
    baseMultiplier,
    mudSportActive: vf(s, "youMudSport") || vf(s, "oppMudSport"),
    waterSportActive: vf(s, "youWaterSport") || vf(s, "oppWaterSport"),
    ...(typeof ctx.rollPercent === "number" ? { rollPercent: ctx.rollPercent } : {}), // F31
  };
}

// ── B6-2: CRITICAL HITS (Cmd_critcalc, src/battle_script_commands.c:1253-1288).
// Only effects whose script reaches `critcalc` can crit -- CRIT_EFFECTS,
// generated from the scripts by arena-solver/tools/gen-crit-effects.mjs (the
// set-damage family, Counter/Mirror Coat, Bide, Future Sight, Spit Up and the
// OHKO moves cannot). The stage index sums Focus Energy (+2), a high-crit
// effect (+1: HIGH_CRITICAL, SKY_ATTACK, BLAZE_KICK, POISON_TAIL), Scope Lens
// (+1), Lucky Punch on Chansey (+2) and Stick on Farfetch'd (+2), capped at 4;
// the crit lands on `!(Random() % sCriticalHitChance[stage])`, i.e.
// 1/16, 1/8, 1/4, 1/3, 1/2. Battle Armor and Shell Armor block it.
const CRIT_CHANCE = [1 / 16, 1 / 8, 1 / 4, 1 / 3, 1 / 2];
const HIGH_CRIT_EFFECTS = new Set(["EFFECT_HIGH_CRITICAL", "EFFECT_SKY_ATTACK", "EFFECT_BLAZE_KICK", "EFFECT_POISON_TAIL"]);
function critChanceFor(ctx, state, actor, moveData) {
  if (!CRIT_EFFECTS.has(moveData.effect)) return 0;
  const isYou = actor === "you";
  const self = isYou ? ctx.you : ctx.opp;
  const foe = isYou ? ctx.opp : ctx.you;
  if (foe.ability === "Battle Armor" || foe.ability === "Shell Armor") return 0;
  if (typeEffectiveness(moveData.type, foe.types, isYou ? state.oppForesighted : state.youForesighted) === 0) return 0;
  const hold = itemData(self.item)?.holdEffect;
  let stage = 2 * (vf(state, isYou ? "youFocusEnergy" : "oppFocusEnergy") ? 1 : 0)
    + (HIGH_CRIT_EFFECTS.has(moveData.effect) ? 1 : 0)
    + (hold === "HOLD_EFFECT_SCOPE_LENS" ? 1 : 0)
    + (hold === "HOLD_EFFECT_LUCKY_PUNCH" && self.species === "Chansey" ? 2 : 0)
    + (hold === "HOLD_EFFECT_STICK" && self.species === "Farfetch'd" ? 2 : 0);
  return CRIT_CHANCE[Math.min(stage, CRIT_CHANCE.length - 1)];
}
// Each landed damaging hit (`dmgHit`) splits into crit / no crit. `crit` is a
// per-hit bit mask, because a multi-hit move runs critcalc on EVERY hit
// (BattleScript_MultiHitLoop); a single hit is bit 0.
function popcount(x) { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; }
//
// A multi-hit move's 2^n masks are EXACT but mostly redundant: where the order
// of the crits cannot be observed, only (how many crit, did the LAST hit crit)
// matters -- the count fixes the total damage, and the last hit is what
// Counter / Mirror Coat record (physicalDmg is overwritten per hit). Order is
// observable when the target has a Substitute (it breaks mid-sequence), Endure
// or a Focus Band (they clamp a particular hit), when the attacker holds a
// Shell Bell (it heals off the FIRST hit), or when the sequence could KO (the
// faint stops it). There the full masks are kept; elsewhere 2^n becomes <= 2n.
function binom(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }
function critOrderObservable(ctx, state, actor, moveData, n) {
  const isYou = actor === "you";
  const self = isYou ? ctx.you : ctx.opp;
  const foe = isYou ? ctx.opp : ctx.you;
  if (state[isYou ? "oppSubstituteHP" : "youSubstituteHP"] != null) return true;
  if (state[isYou ? "oppEndureActive" : "youEndureActive"]) return true;
  if (itemData(foe.item)?.holdEffect === "HOLD_EFFECT_FOCUS_BAND") return true;
  if (itemData(self.item)?.holdEffect === "HOLD_EFFECT_SHELL_BELL") return true;
  // Every hit a crit: n hits of the same damage, or Triple Kick's 10/20/30.
  let allCrit = 0;
  for (let i = 0; i < n; i++) {
    const power = moveData.effect === "EFFECT_TRIPLE_KICK" ? 10 * (i + 1) : null;
    allCrit += calcDamage(self, foe, moveData.name ?? null, battleDamageOptions(ctx, state, actor, moveData, power, 1, true));
  }
  const foeHp = Math.round(((isYou ? state.oppHpPct : state.yourHpPct) / 100) * foe.stats.hp);
  return allCrit >= foeHp;
}
// The last-hit dimension is only read by Counter / Mirror Coat (the recorded
// physicalDmg / specialDmg). A target whose moveset cannot produce either --
// directly, or through a move that calls or copies another -- never reads it,
// so the classes collapse again, to the crit COUNT alone.
const LAST_HIT_READERS = new Set(["Counter", "Mirror Coat", "Mimic", "Metronome", "Assist", "Mirror Move", "Sketch"]);
// A single hit whose NON-crit damage already takes all the target's HP is a KO
// either way, so the crit changes nothing observable and is not branched --
// unless something makes the overkill matter: a Substitute (it absorbs, not
// the target), Endure or a Focus Band (they clamp the KO), or a recoil or
// drain effect (which this engine computes off the uncapped damage).
const COUNTER_POWER_EFFECTS = new Set(["EFFECT_FURY_CUTTER", "EFFECT_ROLLOUT", "EFFECT_TRIPLE_KICK"]);
function critCannotMatter(ctx, state, actor, moveData, moveName, variablePower) {
  const isYou = actor === "you";
  const self = isYou ? ctx.you : ctx.opp;
  const foe = isYou ? ctx.opp : ctx.you;
  if (state[isYou ? "oppSubstituteHP" : "youSubstituteHP"] != null) return false;
  if (state[isYou ? "oppEndureActive" : "youEndureActive"]) return false;
  if (itemData(foe.item)?.holdEffect === "HOLD_EFFECT_FOCUS_BAND") return false;
  if (moveData.effect in RECOIL_FRACTION || DRAIN_EFFECTS.has(moveData.effect)) return false;
  // Fury Cutter, Rollout and Triple Kick take a power only applyMoveCore can
  // derive (from their counters) -- not decidable here, so they branch.
  if (COUNTER_POWER_EFFECTS.has(moveData.effect)) return false;
  const d0 = calcDamage(self, foe, moveName, battleDamageOptions(ctx, state, actor, moveData, variablePower ?? null));
  const foeHp = Math.round(((isYou ? state.oppHpPct : state.yourHpPct) / 100) * foe.stats.hp);
  return d0 >= foeHp;
}
function critSplit(ctx, state, actor, moveData, results, moveName) {
  const pc = critChanceFor(ctx, state, actor, moveData);
  if (pc === 0) return results;
  const out = [];
  for (const r of results) {
    if (!r.dmgHit || r.variablePower === "heal") { out.push(r); continue; }
    const n = r.hitCount ?? 1;
    if (n === 1 && moveData.effect !== "EFFECT_TRIPLE_KICK"
        && critCannotMatter(ctx, state, actor, moveData, moveName, r.variablePower)) { out.push(r); continue; }
    if (n > 1 && !critOrderObservable(ctx, state, actor, { ...moveData, name: moveName }, n)) {
      const foeMoves = (actor === "you" ? ctx.opp : ctx.you).moves;
      if (!foeMoves.some((m) => LAST_HIT_READERS.has(m))) {
        // k crits -> the canonical mask with the first k hits critting
        for (let k = 0; k <= n; k++) out.push({ ...r, p: r.p * binom(n, k) * pc ** k * (1 - pc) ** (n - k), crit: (1 << k) - 1 });
        continue;
      }
      // (k crits, last hit crit?) -> a canonical mask with that shape
      for (let k = 0; k <= n; k++) {
        for (const lastCrit of [false, true]) {
          const ways = lastCrit ? (k >= 1 ? binom(n - 1, k - 1) : 0) : (k <= n - 1 ? binom(n - 1, k) : 0);
          if (ways === 0) continue;
          const mask = lastCrit ? ((1 << (k - 1)) - 1) | (1 << (n - 1)) : (1 << k) - 1;
          out.push({ ...r, p: r.p * ways * pc ** k * (1 - pc) ** (n - k), crit: mask });
        }
      }
      continue;
    }
    for (let mask = 0; mask < (1 << n); mask++) {
      const k = popcount(mask);
      out.push({ ...r, p: r.p * pc ** k * (1 - pc) ** (n - k), crit: mask });
    }
  }
  return out;
}

// Focus Band. Cmd_adjustnormaldamage (src/battle_script_commands.c:1658-1690)
// rolls `(Random() % 100) < holdEffectParam` -- param 10, so EXACTLY 10/100 --
// and on a proc clamps a would-be-lethal hit to leave 1 HP, the same clamp
// Endure uses. It is gated on the target NOT having a Substitute.
//
// The roll sits INSIDE BattleScript_MultiHitLoop (data/battle_scripts_1.s:624),
// so a multi-hit move rolls once PER HIT, independently. That chain is not
// modelled: see the throw in enumerateActionOutcomes.
const FOCUS_BAND_SPACE = 100;

// ── B8b: SYNCHRONIZE (ABILITYEFFECT_SYNCHRONIZE / _ATK_SYNCHRONIZE, src/
// battle_util.c:2971-3002), as a thin wrapper around the action. SetMoveEffect
// ARMS it whenever it lands poison, toxic, paralysis or burn (src/battle_script_
// commands.c:2501-2511) -- a status move, a secondary, a contact-ability proc --
// and two move-end steps FIRE it, in this order:
//   MOVEEND_SYNCHRONIZE_TARGET   a Synchronize TARGET that was just statused
//                                passes it to the attacker (AFFECTS_USER: no
//                                Substitute check on the receiver)
//   MOVEEND_SYNCHRONIZE_ATTACKER a Synchronize ATTACKER that was just statused
//                                (by a contact ability, say) passes it to the
//                                target -- whose Substitute DOES block it
// Toxic passes as ordinary poison. Both go through seteffectprimary, so
// Safeguard and Shield Dust do not stop them; type and ability immunities do,
// and a fainted receiver cannot take one. "Just statused" is read as a status
// that appeared during this action -- every psn/par/brn an action can land goes
// through SetMoveEffect, and sleep/freeze are not synchronized.
const SYNC_STATUSES = new Set(["poison", "paralysis", "burn"]);
function applyMove(ctx, s, actor, ...rest) {
  const isYou = actor === "you";
  const selfKey = isYou ? "youStatus" : "oppStatus";
  const foeKey = isYou ? "oppStatus" : "youStatus";
  const selfPre = s[selfKey], foePre = s[foeKey];
  const itemOvKey = isYou ? "youItemOverride" : "oppItemOverride";
  _changedItemsActor = null;
  // F31 (opt-in exact roll): the drawn roll(s) ride on this action's ctx --
  // a number for one hit, an array per hit -- read by battleDamageOptions and
  // the confusion self-hit. Without ctx.exactRoll no outcome carries one.
  const roll = rest[23]; // after crit (rest[22]); applyMoveCore takes 23 after actor
  applyMoveCore(roll != null ? { ...ctx, rollPercent: roll } : ctx, s, actor, ...rest.slice(0, 23));
  snapHp(ctx, s); // B6 step 1: the action's HP changes, as integer HP
  // Phase D F26: MOVEEND_CHOICE_MOVE (src/battle_script_commands.c:4296-4308)
  // runs at the end of EVERY move that obeyed -- hit, miss, fail or blocked by
  // Protect -- and reads the attacker's hold effect as it is THEN (after a
  // Trick). It locks onto gChosenMove if nothing is locked yet. Not obeyed:
  // the AtkCanceler_UnableToUseMove cancels (full paralysis, sleep, freeze,
  // confusion self-hit, love, flinch, disabled / taunted / imprisoned, recharge,
  // Truant, Bide's storing turns) and the Soundproof block, which all return
  // before Cmd_attackcanceler sets HITMARKER_OBEYS (:932 vs :960).
  {
    const [chosen, , selfHit, , statusPrevented, , , , , , , attractPrevented] = rest;
    const executed = rest[16] ?? chosen; // calledMove (Sleep Talk's pick), else the chosen move
    const selfMon0 = isYou ? ctx.you : ctx.opp, foeMon0 = isYou ? ctx.opp : ctx.you;
    const soundproofed = foeMon0.ability === "Soundproof" && SOUND_MOVES.has(executed);
    if (!selfHit && !statusPrevented && !attractPrevented && !soundproofed) {
      let held = s[itemOvKey] !== undefined ? s[itemOvKey] : selfMon0.item;
      // An item the ATTACKER gains from Trick or Thief goes through
      // gBattleStruct->changedItems and reaches it only at MOVEEND_CHANGED_ITEMS
      // (:4318), AFTER this step; until then it holds nothing (tryswapitems
      // :9240-9244; the steal :2785-2787). Emulator: traces/00035, a Choice
      // Band Trick user that the ROM did not lock.
      if (_changedItemsActor === actor) held = null;
      const lockKey = isYou ? "youChoiceLock" : "oppChoiceLock";
      // `gChosenMove != MOVE_STRUGGLE` (:4299) -- Phase D F42; this comment's
      // older twin below called that clause inert while Struggle was unmodelled.
      if (itemData(held)?.holdEffect === "HOLD_EFFECT_CHOICE_BAND" && s[lockKey] == null && chosen !== "Struggle") s[lockKey] = chosen;
    }
  }
  const self = isYou ? ctx.you : ctx.opp;
  const foe = isYou ? ctx.opp : ctx.you;
  if (self.ability === "Synchronize" || foe.ability === "Synchronize") applySynchronize(s, isYou, self, foe, selfKey, foeKey, selfPre, foePre);
  // Phase D F28: MOVEEND_ITEM_EFFECTS_ALL (src/battle_script_commands.c:4330-
  // 4335) runs ItemBattleEffects(ITEMEFFECT_MOVE_END) for EVERY battler after
  // EVERY action, cancelled ones included (src/battle_util.c:3625-3740): the
  // status berries (Cheri, Pecha, Rawst, Aspear, Chesto, Persim, Lum) cure
  // right after the move that inflicted the status -- not only at the end of
  // the turn, as the engine had it. A Thunder-Waved Cheri holder acts
  // unparalysed that same turn (emulator: traces-given/00832).
  tryCureWithBerry(s, "you", ctx.you);
  tryCureWithBerry(s, "opp", ctx.opp);
}
// F26: set by a successful Trick / Thief during the current action (whose
// attacker then holds nothing until MOVEEND_CHANGED_ITEMS); read and reset by
// applyMove. Module-level because it must not enter the state.
let _changedItemsActor = null;
function applySynchronize(s, isYou, self, foe, selfKey, foeKey, selfPre, foePre) {
  const selfSide = isYou ? "you" : "opp", foeSide = isYou ? "opp" : "you";
  const hpOf = (side) => (side === "you" ? s.yourHpPct : s.oppHpPct);
  const give = (side, mon, st) => {
    if (hpOf(side) <= 0 || !canTakeContactStatus(s, side, st, mon)) return;
    s[side === "you" ? "youStatus" : "oppStatus"] = st;
    if (st === "poison") s[side === "you" ? "youToxicCounter" : "oppToxicCounter"] = null; // toxic passes as poison
  };
  // MOVEEND_SYNCHRONIZE_TARGET (records on the trigger, landed or not -- F2a)
  if (foe.ability === "Synchronize" && foePre == null && SYNC_STATUSES.has(s[foeKey])) {
    recordAbility(s, foeSide, "Synchronize");
    give(selfSide, self, s[foeKey]);
  }
  // MOVEEND_SYNCHRONIZE_ATTACKER
  if (self.ability === "Synchronize" && selfPre == null && SYNC_STATUSES.has(s[selfKey])
      && s[isYou ? "oppSubstituteHP" : "youSubstituteHP"] == null) {
    recordAbility(s, selfSide, "Synchronize");
    give(foeSide, foe, s[selfKey]);
  }
}

function applyMoveCore(ctx, s, actor, moveName, hit, selfHit, secondaryTriggered = false, statusPrevented = false, thawed = false, endureTriggered = false, sleepRemaining = null, sleepDuration = null, protectTriggered = false, blockedByProtect = false, attractPrevented = false, attractGenderCompatible = null, hitCount = null, focusBanded = false, disableTimer = null, calledMove = null, variablePower = null, cancelReason = null, lockTurns = null, contactProc = null, contactSleep = null, crit = 0) {
  const { you, opp } = ctx;
  // B2b batch 3: a move-calling move (Sleep Talk today) resolves as the move it
  // CALLED. Everything below therefore works on `moveName` after substitution --
  // damage, accuracy, executors, Arena scoring. The ONE exception is Choice
  // Band's lock, which source keys on gChosenMove, the move SELECTED; see the
  // wholeness note at that site. `chosenMoveName` keeps it available.
  const chosenMoveName = moveName;
  if (calledMove) moveName = calledMove;
  // B3 batch 1: a recharging mon's attempt IS its locked move, whatever the
  // caller passed -- source reads gLockedMoves here, not a selection
  // (src/battle_util.c:107-110), and the Mind judge scores that (:289).
  // search() already forces it; this makes a direct resolveTurn caller agree.
  if (statusPrevented && s[actor === "you" ? "youRecharge" : "oppRecharge"]) {
    moveName = s[actor === "you" ? "youRecharge" : "oppRecharge"].move;
  }
  // B3 batch 2: MIND IS SCORED ON THE SELECTED MOVE, not the called one.
  // BattleArena_AddMindPoints runs in HandleAction_UseMove (src/battle_util.c:
  // 289) with gCurrentMove still the move the mon chose -- Metronome, Mirror
  // Move, Sleep Talk -- because the substitution happens later, inside that
  // move's script. The note above had Arena scoring following the called move;
  // for Mind that was wrong (Metronome rates 0, a called Earthquake rates 1).
  // Skill is read off the RESULT flags at Cmd_end, so it does follow the call.
  const mindMove = calledMove ? chosenMoveName : moveName;
  // B3 batch 2: whether the foe had a Substitute BEFORE this move. Source keeps
  // STATUS2_SUBSTITUTE set until the end of the turn even after the doll breaks
  // (it is cleared in TurnValuesCleanUp, src/battle_main.c:4887-4888), and
  // SetMoveEffect's gate reads that flag -- so a sub broken by this very hit
  // still blocks its flinch. This engine nulls a broken sub immediately.
  const foeHadSubstitute = s[actor === "you" ? "oppSubstituteHP" : "youSubstituteHP"] != null;
  const isYou = actor === "you";
  const selfMon = isYou ? you : opp;
  const foeMon = isYou ? opp : you;
  // B2b: the DEFENDER's STATUS2_FORESIGHT, read once and threaded into every
  // type-chart and damage call below (Normal/Fighting stop being no-effect
  // against its Ghost typing -- see typeEffectiveness).
  const foeForesighted = isYou ? s.oppForesighted : s.youForesighted;
  const moveData = battleMoveData(selfMon, moveName);
  const mindKey = isYou ? "mindYou" : "mindOpp";
  const skillKey = isYou ? "skillYou" : "skillOpp";
  const selfHpKey = isYou ? "yourHpPct" : "oppHpPct";
  const foeHpKey = isYou ? "oppHpPct" : "yourHpPct";
  const selfStages = isYou ? s.youStages : s.oppStages;
  const foeStages = isYou ? s.oppStages : s.youStages;
  const selfStatusKey = isYou ? "youStatus" : "oppStatus";
  const foeStatusKey = isYou ? "oppStatus" : "youStatus";
  const selfSleepTurnsKey = isYou ? "youSleepTurns" : "oppSleepTurns";
  const selfLastMoveKey = isYou ? "youLastMove" : "oppLastMove";
  const selfFlashFireKey = isYou ? "youFlashFireActive" : "oppFlashFireActive";

  // gLastMoves (MOVEEND_UPDATE_LAST_MOVES, src/battle_script_commands.c:
  // 4389-4414) is `HITMARKER_OBEYS ? gChosenMove : MOVE_UNAVAILABLE`.
  // B3 batch 7b corrected BOTH halves of what this line used to say:
  //  - it is the move SELECTED, not the move called: Sleep Talk and Assist use
  //    `jumptocalledmove TRUE`, which leaves gChosenMove alone, and Metronome /
  //    Mirror Move only ever set gCurrentMove. So a Metronome user's last move
  //    is Metronome. (FALSE, which overwrites it, is only in the disobedience
  //    script.) It used to record the called move.
  //  - an attempt the canceler chain STOPPED never sets HITMARKER_OBEYS, so it
  //    records MOVE_UNAVAILABLE. It used to record the move.
  // UNAVAILABLE is stored as null: every consumer treats the two alike --
  // Disable, Encore and Mimic fail on either, Torment restricts nothing. The
  // AI reads gBattleMoves[0xFFFF] (past the table), whose effect / power /
  // type bytes equal row 0's in the ROM -- so "no last move" is exact there
  // too (Phase D F2c, recordTargetMoveHistory).
  s[selfLastMoveKey] = (statusPrevented || attractPrevented || selfHit) ? null : chosenMoveName;

  if (thawed && s[selfStatusKey] === "freeze") s[selfStatusKey] = null;

  // The sleep counter decrements at CANCELER_ASLEEP (src/battle_util.c:2029-2038),
  // BEFORE the decision to act, so it is banked whether or not the mon then
  // moves. B2b batch 3 moved this out of the statusPrevented block below: Snore
  // and Sleep Talk act while asleep, and leaving the write-back inside that
  // block meant their counter never ticked and they could sleep forever.
  if (sleepRemaining !== null) {
    // Counter reached 0 this turn — the mon wakes up (still forfeiting THIS
    // turn's move, per enumerateActionOutcomes) but is available from the NEXT
    // turn onward. Otherwise just bank the decremented counter.
    if (sleepRemaining <= 0) {
      s[selfStatusKey] = null;
      s[selfSleepTurnsKey] = null;
      // Waking clears the nightmare HERE, at CANCELER_ASLEEP
      // (src/battle_util.c:2049), not at the end-of-turn residual. The
      // difference is observable: a mon that wakes on its own turn and then
      // Rests is asleep again by ENDTURN_NIGHTMARES, so a flag cleared only
      // there would survive a wake it should not have.
      s[isYou ? "youNightmared" : "oppNightmared"] = false;
    } else {
      s[selfSleepTurnsKey] = sleepRemaining;
    }
  }

  if (statusPrevented && cancelReason === "bideStore") {
    const lk = isYou ? "youLock" : "oppLock";
    s[lk] = { ...s[lk], n: s[lk].n - 1 };
    s[mindKey] += mindDelta(mindMove);
    return;
  }
  if (statusPrevented) {
    if (cancelReason === "recharge") {
      // B3 batch 1: the recharge is SPENT here -- CANCELER_RECHARGE clears
      // STATUS2_RECHARGE and the timer on the very attempt it blocks.
      s[isYou ? "youRecharge" : "oppRecharge"] = null;
    }
    // B3 batch 2: CANCELER_FLINCH clears the flag it acts on (:2113).
    if (cancelReason === "flinch") s.turnFlags &= ~(isYou ? TF_YOU_FLINCHED : TF_OPP_FLINCHED);
    // RECHARGE, FLINCH, DISABLED, TAUNTED and IMPRISONED all call
    // CancelMultiTurnMoves (src/battle_util.c:2103/:2115/:2127/:2138/:2149).
    // Sleep and freeze do NOT. Full paralysis's C call is commented out in
    // Emerald (:2192-2193) -- but Phase D F24: its SCRIPT,
    // BattleScript_MoveUsedIsParalyzed, runs `cancelmultiturnmoves BS_ATTACKER`
    // (data/battle_scripts_1.s:3777). A Fly paralysed on its strike turn lands
    // (emulator: traces/00376, where the sim kept it in the air).
    if (cancelReason) cancelMultiTurnMoves(s, actor);
    if (!cancelReason && s[selfStatusKey] === "paralysis") cancelMultiTurnMoves(s, actor);
    // B3 batch 3: full paralysis does not cancel at its canceler, but it is in
    // WasUnableToUseMove (prlzImmobility), which ENDTURN_THRASH reads.
    if (!cancelReason && s[selfStatusKey] === "paralysis") s.turnFlags |= isYou ? TF_YOU_UNABLE : TF_OPP_UNABLE;
    // Paralysis full-para / still-frozen: Mind scores off selection
    // regardless (unconditional), no Skill (HITMARKER_OBEYS unset), no
    // damage or effect happens at all.
    s[mindKey] += mindDelta(mindMove);
    return;
  }

  if (attractPrevented) {
    // CANCELER_IN_LOVE (src/battle_util.c:2200-2218): immobilized by love —
    // Mind scores off selection same as any other prevented turn; no self-
    // damage (unlike confusion's self-hit branch) and no Skill change.
    // B3 batch 2: and it cancels multi-turn moves (src/battle_util.c:2213).
    cancelMultiTurnMoves(s, actor);
    s[mindKey] += mindDelta(mindMove);
    return;
  }

  if (selfHit) {
    s.turnFlags |= isYou ? TF_YOU_UNABLE : TF_OPP_UNABLE; // confusionSelfDmg (B3 batch 3)
    // Phase D F24: BattleScript_DoSelfConfusionDmg opens with
    // `cancelmultiturnmoves BS_ATTACKER` (data/battle_scripts_1.s:3802).
    cancelMultiTurnMoves(s, actor);
    let dmg = confusionSelfHitDamage(ctx, s, actor); // F19
    // adjustnormaldamage2's hang-on: the mon's own Focus Band (the branch was
    // drawn in enumerateActionOutcomes) leaves it at 1
    const curHp = Math.round((s[selfHpKey] / 100) * selfMon.stats.hp);
    if (focusBanded && dmg >= curHp) dmg = curHp - 1;
    s[selfHpKey] = hpSub(s[selfHpKey], dmg, selfMon.stats.hp);
    s[mindKey] += mindDelta(mindMove);
    return;
  }

  s[mindKey] += mindDelta(mindMove);
  recordScriptAbilityChecks(ctx, s, actor, moveName, moveData, hit, blockedByProtect); // Phase D F2a

  // Explosion/Self Destruct (effect: "EFFECT_EXPLOSION"): the user's HP is
  // set to 0 UNCONDITIONALLY, confirmed from the real move script
  // (BattleScript_EffectExplosion, data/battle_scripts_1.s:374-381) —
  // `setatkhptozero` runs right after the Damp-ability check (not modeled;
  // no opponent in scope carries Damp) and BEFORE the accuracy check, BEFORE
  // Protect even enters the picture. This must happen here — before the
  // blockedByProtect early-return below — not gated behind hit/miss/protect
  // at all. A PREVIOUS fix (this session) added the self-faint only inside
  // the power>0 hit-resolution block further down, which is unreachable
  // whenever blockedByProtect returns early — meaning a Protect-blocked
  // Self Destruct silently never fainted its user. Caught while auditing an
  // anomalous grid result (Snorlax scored identically across ALL 4 moves,
  // including Self Destruct, against a Protect-heavy opponent — a real tell
  // that Self Destruct was being treated as a "safe, no-cost" move whenever
  // protected against).
  // Phase D F6: DAMP. Cmd_tryexplosion (src/battle_script_commands.c:6556-)
  // scans EVERY battler, the user included; any Damp stops the move BEFORE
  // setatkhptozero -- the user survives, nothing is hit, and
  // BattleScript_DampStopsExplosion prints STRINGID_PKMNPREVENTSUSAGE with no
  // result flag (+1 - 3). After attackcanceler, so into a Protect too.
  if (moveData.effect === "EFFECT_EXPLOSION" && (ctx.you.ability === "Damp" || ctx.opp.ability === "Damp")) {
    s[skillKey] += arenaSkillDelta("landed", ["STRINGID_PKMNPREVENTSUSAGE"]);
    return;
  }
  if (moveData.effect === "EFFECT_EXPLOSION") s[selfHpKey] = 0;

  // Phase D F40: TEETER DANCE decides its own Skill, in its loop's order
  // (data/battle_scripts_1.s:2571-2621). Each pass opens with
  // movevaluescleanup (src/battle_script_commands.c:3621-3630: result flags
  // and MISS_TYPE zeroed) and skips the user AFTER it; AddSkillPoints runs at
  // `end` on the last pass. The player is battler 0 and the opponent battler 1,
  // so the player's dance ends on the foe's pass (its flags stand) and the
  // opponent's ends on its own (a miss or a Protect-block is wiped: +1). The
  // attackcanceler's Protect flag (:992-1001) is wiped by the first cleanup, so
  // on the foe's pass Own Tempo, a Substitute and already-confused come first;
  // Protect and accuracy only at its accuracycheck; Safeguard after that.
  if (moveData.effect === "EFFECT_TEETER_DANCE") {
    const t = confusionTarget(s, actor, ctx);
    const lastPassIsOwn = !isYou;
    // the attackcanceler still cancels the user's multi-turn moves into Protect
    if (blockedByProtect) cancelMultiTurnMoves(s, actor);
    let outcome;
    if (t.mon.ability === "Own Tempo") outcome = arenaSkillDelta("landed", ["STRINGID_PKMNPREVENTSCONFUSIONWITH"]);
    else if (s[t.subKey] != null) outcome = arenaSkillDelta("landed", ["STRINGID_BUTITFAILED"]);
    else if (s[t.confKey]) outcome = arenaSkillDelta("alreadyStatused");
    else if (blockedByProtect) outcome = lastPassIsOwn ? arenaSkillDelta("landed") : arenaSkillDelta("protectedBlock");
    else if (!hit) outcome = lastPassIsOwn ? arenaSkillDelta("landed") : skillDelta("miss");
    else if (s[t.safeguardKey] != null) outcome = arenaSkillDelta("landed", ["STRINGID_PKMNUSEDSAFEGUARD"]);
    else { s[t.confKey] = true; outcome = arenaSkillDelta("landed"); }
    s[skillKey] += outcome;
    return;
  }

  if (blockedByProtect) {
    // Attacker's move blocked by opponent's active Protect/Detect. Verified
    // from BattleArena_AddSkillPoints (src/battle_arena.c:588-621): a
    // Protect-block sets MOVE_RESULT_MISSED (which composites into the
    // NO_EFFECT check, include/constants/battle.h:227) with
    // MISS_TYPE=B_MSG_PROTECTED specifically — and the -2 penalty's own
    // condition explicitly EXCLUDES that exact case
    // (!(MISSED) || MISS_TYPE != B_MSG_PROTECTED both false, so the -2
    // never fires). Skill is genuinely UNCHANGED here — NOT -2 like a
    // normal miss, and NOT +1 like a normal hit. Mind already applied above
    // (unconditional, as always — HITMARKER_OBEYS doesn't gate Mind).
    // B3 batch 2: Cmd_attackcanceler's Protect branch also calls
    // CancelMultiTurnMoves (src/battle_script_commands.c:992-996), unless this
    // is a two-turn move on its CHARGING turn: `!IsTwoTurnsMove(move) ||
    // STATUS2_MULTIPLETURNS`. So a Fury Cutter chain ends in a Protect.
    // STATUS2_MULTIPLETURNS is `xCharging` OR a `xLock` here -- a Bide unleash
    // carries the lock, so a Protect-blocked unleash cancels it (B3 batch 4c).
    const selfChargingNow = s[isYou ? "youCharging" : "oppCharging"] || s[isYou ? "youLock" : "oppLock"];
    if (!TWO_TURN_EFFECTS.has(moveData.effect) || selfChargingNow) cancelMultiTurnMoves(s, actor);
    return;
  }

  // B3 batch 2: FAKE OUT fails after its user's first turn. The check is
  // `jumpifnotfirstturn` (src/battle_script_commands.c:6786-6794) and it sits
  // AFTER attackcanceler in BattleScript_EffectFakeOut (data/battle_scripts_1.s:
  // 2048-2052) -- so a late Fake Out into Protect reads as PROTECTED (handled
  // just above), and only otherwise as FAILED, from attackstring.
  if (moveData.effect === "EFFECT_FAKE_OUT" && !s[isYou ? "youMonFirstTurn" : "oppMonFirstTurn"]) {
    s[skillKey] += skillDelta("noEffect");
    return;
  }

  // B3 batch 7d: TRANSFORM (Cmd_transformdataexecution, src/battle_script_
  // commands.c:7764-7806). Fails (MOVE_RESULT_FAILED, -2) if the target is
  // already transformed or semi-invulnerable. Otherwise the user takes the
  // target's species, types, ability, non-HP stats, moves AND CURRENT STAT
  // STAGES, and loses its own Disable and mimicked moves. It also sets
  // gChosenMove = MOVE_UNAVAILABLE, so the user's LAST MOVE is unavailable:
  // a Disable, Encore or Mimic aimed at it next finds nothing. +1.
  if (moveData.effect === "EFFECT_TRANSFORM") {
    const foeTf = s[isYou ? "oppTransform" : "youTransform"];
    const foeCharging = s[isYou ? "oppCharging" : "youCharging"];
    if (foeTf || foeCharging?.invulnBit) { s[skillKey] += skillDelta("noEffect"); return; }
    const { hp: _hp, ...nonHp } = foeMon.stats;
    s[isYou ? "youTransform" : "oppTransform"] = {
      species: foeMon.species, types: [...foeMon.types], ability: foeMon.ability,
      stats: nonHp, moves: [...foeMon.moves], genderDist: foeMon.genderDist,
      // the IVs are copied too: they sit before `pp` in struct BattlePokemon
      // (include/pokemon.h:260-283), the span Cmd_transformdataexecution copies
      // (src/battle_script_commands.c:7790) -- so Hidden Power is the TARGET's
      hiddenPower: foeMon.hiddenPower,
    };
    const foeSt = isYou ? s.oppStages : s.youStages;
    if (isYou) s.youStages = { ...foeSt }; else s.oppStages = { ...foeSt };
    s[isYou ? "youDisabledMove" : "oppDisabledMove"] = null;
    s[isYou ? "youDisableTurns" : "oppDisableTurns"] = null;
    s[isYou ? "youMoves" : "oppMoves"] = null;           // mimickedMoves = 0
    s[isYou ? "youAbilityOverride" : "oppAbilityOverride"] = null; // the copied ability replaces any swap
    s[selfLastMoveKey] = null;                          // gChosenMove = MOVE_UNAVAILABLE
    s[skillKey] += skillDelta("landed");
    return;
  }

  // B3 batch 7c: MIMIC (data/battle_scripts_1.s:1134-1145, Cmd_mimicattackcopy
  // src/battle_script_commands.c:7844-7883), in the script's order, every
  // failure through ButItFailed (-2): a Substitute on the target; the accuracy
  // step (a semi-invulnerable target); then the copy itself, which fails if the
  // target's gLastMoves is none/UNAVAILABLE, is one of the four moves before
  // MIMIC_FORBIDDEN_END (Metronome, Struggle, Sketch, Mimic), or is already
  // known. Otherwise it REPLACES the slot of the move the user SELECTED
  // (gCurrMovePos -- Metronome's slot if Metronome called it) for the rest of
  // the battle; the Arena has no switching to undo it. +1.
  if (moveData.effect === "EFFECT_MIMIC") {
    const copy = s[isYou ? "oppLastMove" : "youLastMove"];
    const known = selfMon.moves;
    if (foeHadSubstitute || !hit || copy == null || s[isYou ? "youTransform" : "oppTransform"]
        || ["Metronome", "Struggle", "Sketch", "Mimic"].includes(copy) || known.includes(copy)) {
      s[skillKey] += skillDelta("noEffect");
      return;
    }
    const slot = known.indexOf(chosenMoveName);
    if (slot < 0) {
      throw new Error(`Mimic: the selected move "${chosenMoveName}" is not in ${selfMon.species}'s moveset ` +
        `(${known.join("/")}) -- there is no gCurrMovePos to copy into.`);
    }
    const next = known.slice();
    next[slot] = copy;
    s[isYou ? "youMoves" : "oppMoves"] = next;
    s[skillKey] += skillDelta("landed");
    return;
  }

  // B3 batch 5b: FUTURE SIGHT / DOOM DESIRE -- the SET. trysetfutureattack
  // fails (ButItFailed, -2) if one is already pending on the target; otherwise
  // counter 3 and the damage fixed NOW from CalculateBaseDamage with the
  // target's side statuses (screens) and today's stages. +1 (no result flag).
  if (moveData.effect === "EFFECT_FUTURE_SIGHT") {
    const fsKey = isYou ? "oppFutureSight" : "youFutureSight";
    if (s[fsKey]) { s[skillKey] += skillDelta("noEffect"); return; }
    const base = calcDamage(selfMon, foeMon, moveName,
      { ...battleDamageOptions(ctx, s, actor, moveData), untyped: true, rollFrac: 1 });
    s[fsKey] = { move: moveName, n: 3, dmg: base };
    s[skillKey] += skillDelta("landed");
    return;
  }

  // B3 batch 4c: BIDE.
  let bideUnleash = null;
  if (moveData.effect === "EFFECT_BIDE") {
    const lk = isYou ? "youLock" : "oppLock";
    if (s[lk]?.kind !== "bide") {
      // The SET turn: BattleScript_EffectBide (data/battle_scripts_1.s:573-581)
      // has no accuracycheck, so the enumerator gives it one landed branch;
      // setbide locks the move, zeroes gBideDmg and sets the counter to 2.
      // Skill: obeyed, no result flags, so +1 (BattleArena_AddSkillPoints).
      s[lk] = { move: moveName, kind: "bide", n: 2, dmg: 0 };
      s[skillKey] += skillDelta("landed");
      return;
    }
    // The UNLEASH (the gate let it through at counter 1 -> 0).
    // BattleScript_BideAttack runs `setmoveeffect MOVE_EFFECT_CHARGING` +
    // clearstatusfromeffect first, which drops STATUS2_MULTIPLETURNS whether
    // or not the hit then lands.
    const stored = s[lk].dmg;
    s[lk] = null;
    if (stored === 0) {
      // BattleScript_BideNoEnergyToAttack -> ButItFailed.
      s[skillKey] += skillDelta("noEffect");
      return;
    }
    bideUnleash = stored * 2;
  }

  const selfDamageTakenKey = isYou ? "youDamageTaken" : "oppDamageTaken";
  const foeDamageTakenKey = isYou ? "oppDamageTaken" : "youDamageTaken";

  if (moveData.effect === "EFFECT_OHKO") {
    // Sturdy and the level-gated accuracy roll are both already resolved
    // upstream into `hit` (enumerateActionOutcomes' OHKO-specific accBranches
    // — see the long comment there) — neither needs its own Math.random()
    // call here (Lesson 1). Type immunity still applies normally: typecalc
    // runs BEFORE Cmd_tryKO in real BattleScript_EffectOHKO, so an immune
    // target never even reaches the roll.
    const eff = typeEffectiveness(moveData.type, foeMon.types, foeForesighted);
    if (eff === 0) {
      s[skillKey] += skillDelta("noEffect");
      return;
    }
    if (!hit) {
      s[skillKey] += skillDelta("miss");
      return;
    }
    const foeEndureKey = isYou ? "oppEndureActive" : "youEndureActive";
    const foeDestinyBondKey = isYou ? "oppDestinyBondActive" : "youDestinyBondActive";
    if (s[foeEndureKey]) {
      // Cmd_tryKO's own explicit gProtectStructs[target].endured check
      // (src/battle_script_commands.c:7546-7550) clamps to 1 HP instead of a
      // real KO — sets MOVE_RESULT_FOE_ENDURED, not MOVE_RESULT_ONE_HIT_KO,
      // so this does NOT count as a KO for Destiny Bond purposes below.
      const foeRawHp = Math.round((s[foeHpKey] / 100) * foeMon.stats.hp);
      s[foeHpKey] = (Math.max(0, foeRawHp - 1) * 100) / foeMon.stats.hp;
    } else {
      s[foeHpKey] = 0;
      if (s[foeDestinyBondKey] && s[selfHpKey] > 0) s[selfHpKey] = 0;
    }
    // A successful OHKO's own message handling (Cmd_resultmessage,
    // src/battle_script_commands.c:2095-2099) explicitly STRIPS
    // MOVE_RESULT_SUPER_EFFECTIVE/NOT_VERY_EFFECTIVE before Skill scoring
    // ever runs (BattleArena_AddSkillPoints fires at Cmd_end, strictly
    // after) — so a landed OHKO always scores a flat "landed" (+1),
    // regardless of the move's real type matchup, NEVER the super/not-very-
    // effective ±2/-1 bonus a normal attack of the same type would get.
    // Deliberately NOT classifyOutcome(hit, eff).
    s[skillKey] += skillDelta("landed");
    return;
  }

  // Phase D F27: Counter / Mirror Coat. counterdamagecalculator (src/battle_
  // script_commands.c:7943-7990) takes twice the damage of the matching
  // category received THIS turn, or fails the move (FailedFromAtkString, -2).
  // What follows in BattleScript_EffectCounter (data/battle_scripts_1.s:
  // 1217-1225) is an ordinary set-damage hit: accuracycheck, typecalc2 (a type
  // immunity or Wonder Guard stops it; no SE / NVE flag is ever written),
  // adjustsetdamage (Endure, Focus Band), then BattleScript_HitFromAtkAnimation
  // and the move end -- Substitute, Destiny Bond, the contact abilities, Rage,
  // Color Change, Shell Bell. The engine used to subtract the number and
  // return, skipping all of that (emulator: traces-given/00649, Counter into a
  // Static Electrode). Now the number goes to the generic hit path as set
  // damage (calcDamage's SET_DAMAGE_EFFECTS), exactly as Bide's unleash does.
  let counterReflect = null;
  if (moveData.effect === "EFFECT_COUNTER" || moveData.effect === "EFFECT_MIRROR_COAT") {
    const received = counterReceived(s, actor, moveData);
    if (received === null) {
      s[skillKey] += skillDelta("noEffect");
      return;
    }
    counterReflect = received * 2;
  }

  if (moveData.effect === "EFFECT_ENDURE") {
    const usesKey = isYou ? "youProtectUses" : "oppProtectUses";
    if (endureTriggered) {
      s[isYou ? "youEndureActive" : "oppEndureActive"] = true;
      s[usesKey] += 1;
      // +1 on success — verified this is genuinely asymmetric with Protect's
      // OWN-use scoring (see below), NOT the same "precedent" as previously
      // assumed. Cmd_setprotectlike sets gProtectStructs[attacker].ENDURED
      // = 1 on a successful Endure (src/battle_script_commands.c:6521-6524),
      // a DIFFERENT field from .protected — so the final fallback branch in
      // BattleArena_AddSkillPoints (!gProtectStructs[battler].protected)
      // still evaluates true for Endure, landing on the default +1.
      s[skillKey] += skillDelta("landed");
    } else {
      s[usesKey] = 0;
      s[skillKey] += skillDelta("noEffect"); // failure sets MOVE_RESULT_MISSED, MISS_TYPE=B_MSG_PROTECT_FAILED (not B_MSG_PROTECTED) — scored as a real miss (-2)
    }
    return;
  }
  if (moveData.effect === "EFFECT_PROTECT") {
    // Shares the SAME decay counter as Endure (verified above), but its OWN
    // Skill scoring is NOT symmetric with Endure's: Cmd_setprotectlike sets
    // gProtectStructs[attacker].PROTECTED = 1 on success (a field the final
    // BattleArena_AddSkillPoints fallback branch explicitly EXCLUDES via
    // !gProtectStructs[battler].protected) — so a successful Protect scores
    // Skill 0 (genuinely unchanged), not +1. Failure still scores -2, same
    // as Endure (MISS_TYPE=B_MSG_PROTECT_FAILED either way).
    const usesKey = isYou ? "youProtectUses" : "oppProtectUses";
    const selfProtectedKey = isYou ? "youProtected" : "oppProtected";
    if (protectTriggered) {
      s[selfProtectedKey] = true;
      s[usesKey] += 1;
      // No skillKey change — success is genuinely neutral, see above.
    } else {
      s[usesKey] = 0;
      s[skillKey] += skillDelta("noEffect");
    }
    return;
  }

  const selfChargingKey = isYou ? "youCharging" : "oppCharging";

  // B2b batch 7: the non-invulnerable charge moves take the SAME two blocks as
  // EFFECT_SEMI_INVULNERABLE below -- charge, then attack -- so they are folded
  // into the same condition rather than copied under it.
  const chargesThisTurn = chargeTurnRequired(moveData, effectiveWeather(s, you, opp));
  if (chargesThisTurn && !s[selfChargingKey]) {
    // Charge-initiation turn. No accuracy check, no damage, and no
    // invulnerability -- invulnBit is null, which is the whole difference from
    // Fly and Dig.
    s[selfChargingKey] = { move: moveName, invulnBit: null };
    // Skull Bash raises the user's Defence ON THE CHARGE TURN
    // (data/battle_scripts_1.s:2067-2069), before the hit ever lands.
    if (moveData.effect === "EFFECT_SKULL_BASH") {
      bumpStage(isYou ? s.youStages : s.oppStages, "def", 1);
    }
    s[skillKey] += skillDelta("landed");
    return;
  }
  if (chargesThisTurn && s[selfChargingKey]) {
    s[selfChargingKey] = null;
    // falls through to the normal damage branch below
  }
  if (moveData.effect === "EFFECT_SEMI_INVULNERABLE" && !s[selfChargingKey]) {
    // Charge-initiation turn: no accuracy check, no damage. Mind scores
    // automatically (mindDelta above already ran); Skill falls through to
    // +1, same as a normal successful hit (source-confirmed — the charge
    // turn's gMoveResultFlags stay all-clear, hitting the final +1 branch).
    s[selfChargingKey] = { move: moveName, invulnBit: SEMI_INVULN_BIT[moveName] };
    s[skillKey] += skillDelta("landed");
    return;
  }
  if (moveData.effect === "EFFECT_SEMI_INVULNERABLE" && s[selfChargingKey]) {
    // Attack-completion turn: clear the charge, then resolve as a REAL
    // attack — normal accuracy check (already branched by the caller using
    // this move's real accuracy), normal damage/Skill scoring.
    s[selfChargingKey] = null;
    // falls through to the normal power>0 damage-dealing branch below
  }

  // B2b batch 9: Rapid Spin frees the USER from Spikes, Leech Seed and any
  // binding move (Cmd_rapidspinfree via MOVE_EFFECT_RAPIDSPIN,
  // src/battle_script_commands.c:2818-2821). MOVE_EFFECT_CERTAIN, so it is not
  // a chance secondary -- it happens on every hit. Binding moves are not
  // modelled at all (EFFECT_TRAP is ledgered), so only the two that exist here
  // are cleared, and Spikes never bit in the first place.
  // ── B3 batch 1: six accepted-unmodelled mechanics that became cheap ─────
  // BRICK BREAK. `removelightscreenreflect` (src/battle_script_commands.c:
  // 9695-9713) runs BEFORE `damagecalc` in the script (data/battle_scripts_1.s:
  // 2795-2806), so the screens are gone for BRICK BREAK'S OWN damage too --
  // which is why this sits above the damage branch rather than beside the other
  // on-hit effects. It clears BOTH screens and both timers, and it does so on a
  // hit whether or not the target is immune to the damage.
  if (moveData.effect === "EFFECT_BRICK_BREAK" && hit) {
    s[isYou ? "oppReflectTurns" : "youReflectTurns"] = null;
    s[isYou ? "oppLightScreenTurns" : "youLightScreenTurns"] = null;
  }

  // B2b batch 11: RAGE. Two halves, in two places.
  // (1) The flag. MOVE_EFFECT_RAGE is a primary effect of a LANDED Rage
  //     (data/battle_scripts_1.s:1140-1146 -> src/battle_script_commands.c:2735).
  //     Its CLEAR is not here: it happens at the top of the turn, for a battler
  //     whose chosen move is not Rage (resolveTurnWithOrder).
  if (moveData.effect === "EFFECT_RAGE" && hit) s[isYou ? "youRaging" : "oppRaging"] = true;
  // B3 batch 1: KNOCK OFF removes the target's item outright (
  // MOVE_EFFECT_KNOCK_OFF, :2863-2890). Sticky Hold blocks it. This became a
  // three-line change the moment batch 10 made items mutable -- before that it
  // had nowhere to write the removal, which is why it was ledgered.
  // B3 batch 1: RECHARGE. MOVE_EFFECT_RECHARGE | AFFECTS_USER | CERTAIN on a
  // landed Hyper Beam (src/battle_script_commands.c:2728-2731), which also
  // locks the move. The turn it costs is spent at the START of the user's next
  // action, not here.
  if (moveData.effect === "EFFECT_RECHARGE" && hit) {
    s[isYou ? "youRecharge" : "oppRecharge"] = { move: moveName, timer: 2 };
  }
  if (moveData.effect === "EFFECT_KNOCK_OFF" && hit && foeMon.item && foeMon.ability === "Sticky Hold"
      && !foeHadSubstitute && s[foeHpKey] > 0) recordAbility(s, isYou ? "opp" : "you", "Sticky Hold"); // F2a
  if (moveData.effect === "EFFECT_KNOCK_OFF" && hit && foeMon.item
      && foeMon.ability !== "Sticky Hold") {
    s[isYou ? "oppItemOverride" : "youItemOverride"] = null;
    s[isYou ? "oppUsedItem" : "youUsedItem"] = null; // knocked off, not consumed: Recycle cannot get it back
  }
  if (moveData.effect === "EFFECT_THIEF" && hit) {
    // MOVE_EFFECT_STEAL_ITEM (src/battle_script_commands.c:2738-2790), applied
    // inline because it is a CERTAIN on-hit effect of a damaging move -- the
    // executor table only ever runs on the secondary-chance dispatch.
    //
    // THE ARENA IS A FRONTIER BATTLE, and that decides this: the guard that
    // stops an OPPONENT taking the player's item is gated on NOT being
    // EREADER | FRONTIER | LINK | RECORDED_LINK | SECRET_BASE, and
    // BATTLE_TYPE_ARENA sits inside BATTLE_TYPE_FRONTIER. So here the steal
    // really happens, in both directions. It requires the thief to be holding
    // NOTHING and the target to be holding SOMETHING, and Sticky Hold blocks it.
    const thiefItem = isYou ? s.youItemOverride !== undefined ? s.youItemOverride : ctx.you.item
      : s.oppItemOverride !== undefined ? s.oppItemOverride : ctx.opp.item;
    if (foeMon.item && foeMon.ability === "Sticky Hold" && !foeHadSubstitute) recordAbility(s, isYou ? "opp" : "you", "Sticky Hold"); // F2a
    if (!thiefItem && foeMon.item && foeMon.ability !== "Sticky Hold") {
      _changedItemsActor = actor; // F26: the gain waits in changedItems until MOVEEND_CHANGED_ITEMS
      s[isYou ? "youItemOverride" : "oppItemOverride"] = foeMon.item;
      s[isYou ? "oppItemOverride" : "youItemOverride"] = null;
    }
  }
  if (moveData.effect === "EFFECT_RAPID_SPIN" && hit
      && typeEffectiveness(moveData.type, foeMon.types, foeForesighted) !== 0) {
    // Cmd_rapidspinfree (src/battle_script_commands.c:8821-8862) is an if /
    // else-if chain that pushes the cursor and returns to itself, so it frees
    // ALL of: the wrap (B3 batch 5 -- it was missing), Leech Seed, Spikes.
    // B3 batch 5 also added the type check: MOVE_EFFECT_RAPIDSPIN arrives via
    // seteffectwithchance, which skips a NO_EFFECT hit -- a Rapid Spin into a
    // Ghost frees nothing, and this used to free everything.
    s[isYou ? "youWrapped" : "oppWrapped"] = null;
    s[isYou ? "youSpikesLayers" : "oppSpikesLayers"] = 0;
    s[isYou ? "youSeeded" : "oppSeeded"] = false;
  }

  // ── B2b batch 5: the two non-damage outcomes of a damaging move ─────────
  if (variablePower === "failed") {
    // Endeavor against a target that is not above the user. The script takes
    // `setdamagetohealthdifference`'s ButItFailed branch before the accuracy
    // check ever runs (data/battle_scripts_1.s:3687), so this is a FAILURE, not
    // a miss, and it is enumerated as a single branch upstream.
    s[skillKey] += skillDelta("noEffect");
    return;
  }
  if (variablePower === "heal") {
    // Present's fourth arm (Cmd_presentdamagecalculation, rand >= 204 of 256).
    // It does not attack at all: it heals the TARGET for maxHP/4, and fails
    // with AlreadyAtFullHp if there is nothing to heal.
    //
    // SOURCE QUIRK, deliberately reproduced: the heal arm explicitly clears
    // MOVE_RESULT_DOESNT_AFFECT_FOE (:9140) before jumping to
    // BattleScript_PresentHealTarget, so a Present that would be TYPE-IMMUNE
    // still heals -- a Normal-type move that "does not affect" a Ghost hands it
    // a quarter of its HP. That is why this sits ABOVE the ability/immunity
    // block below rather than after it.
    if (foeMon.ability === "Wonder Guard") {
      // Wonder Guard takes a DIFFERENT flag path in Cmd_typecalc
      // (MOVE_RESULT_MISSED, src/battle_script_commands.c:1409-1419), which the
      // heal arm does NOT clear. Rather than guess how the two interact, this
      // throws with the pair named -- unreachable unless a Wonder Guard mon
      // meets the pool's one Present user.
      throw new Error(`Present's heal arm against a Wonder Guard holder (${foeMon.species}) is ` +
        `unmodelled: the heal arm clears MOVE_RESULT_DOESNT_AFFECT_FOE but Wonder Guard sets ` +
        `MOVE_RESULT_MISSED instead, and the interaction is not established. Port it before solving.`);
    }
    if (s[foeHpKey] >= 100) {
      // BattleScript_AlreadyAtFullHp (src/battle_script_commands.c:8641-8644 ->
      // data/battle_scripts_1.s:2042-2046): no flag, no deducting string, +1.
      // Phase D F37: this scored noEffect (-2).
      s[skillKey] += skillDelta("landed");
      return;
    }
    const heal = Math.max(1, Math.floor(foeMon.stats.hp / 4));
    s[foeHpKey] = hpAdd(s[foeHpKey], heal, foeMon.stats.hp);
    s[skillKey] += skillDelta("landed");
    return;
  }

  // Ability interactions (Soundproof/Levitate/Wonder Guard/Absorb/Flash
  // Fire) checked before normal resolution — Soundproof applies to status
  // moves too, so this check runs regardless of moveData.power.
  // Phase D F2a: a missed roll still runs CheckWonderGuardAndLevitate. (OHKO
  // moves record through recordScriptAbilityChecks: their roll is in tryKO.)
  if (!hit && moveData.effect !== "EFFECT_OHKO") recordMissedTypecalcAbility(ctx, s, actor, moveName, moveData);
  if (hit || moveData.power === 0) {
    const interaction = resolveAbilityInteraction(moveName, moveData, selfMon, foeMon, foeForesighted);
    // F2a: typecalc records Levitate / Wonder Guard (bsc.c:1382, :1418),
    // ABILITYEFFECT_ABSORBING the absorbers (src/battle_util.c:3195 via
    // JumpIfMoveFailed :1021); Soundproof was recorded at the canceler.
    if (interaction.type !== "normal") recordAbility(s, isYou ? "opp" : "you", foeMon.ability);
    if (interaction.type === "blocked") {
      s[skillKey] += interaction.skillDelta;
      return;
    }
    if (interaction.type === "absorb") {
      const healAmount = Math.max(1, Math.floor(foeMon.stats.hp * interaction.healFraction));
      // No-op (not healing over cap) if already at full HP, per source.
      if (s[foeHpKey] < 100) {
        s[foeHpKey] = hpAdd(s[foeHpKey], healAmount, foeMon.stats.hp);
      }
      s[skillKey] += interaction.skillDelta; // still an ability-block for Skill purposes
      return;
    }
    if (interaction.type === "flashFireTrigger") {
      s[isYou ? "oppFlashFireActive" : "youFlashFireActive"] = true;
      s[skillKey] += interaction.skillDelta;
      return;
    }
  }

  if (moveData.power > 0) {
    if (SILENT_FALLTHROUGH_EFFECTS.has(moveData.effect)) {
      throw new Error(`"${moveName}" (effect: ${moveData.effect}) has a non-generic damage mechanic ` +
        `(fixed/level/HP-based, not power-based) with no dedicated implementation yet — the generic ` +
        `power-based path would silently compute a near-meaningless number off its move-data.js ` +
        `placeholder power (same bug class as the historical EFFECT_OHKO bug, see HANDOFF.md §10). ` +
        `Port its real mechanic before using it.`);
    }
    // Dream Eater sleep gate (data/battle_scripts_1.s BattleScript_EffectDreamEater:
    // jumpifstatus2 BS_TARGET, SUBSTITUTE -> NoEffect, then jumpifstatus BS_TARGET,
    // SLEEP -> DreamEaterWorked; otherwise DreamEaterNoEffect -> WasntAffected).
    // Both checks sit BEFORE accuracycheck, so vs an awake (or substituted) target
    // Dream Eater fails outright — no damage, no heal, no accuracy roll. Scored as
    // a real "no effect" (WasntAffected). The accuracy-miss and substitute-fail
    // splits are unreachable here (Dream Eater is 100 acc and Metagross has no
    // evasion move, and Metagross never carries Substitute), so only the awake-hit
    // case matters; not modeling the miss/sub branches is an accepted limitation.
    // B3 batch 1: FOCUS PUNCH. BattleScript_EffectFocusPunch's FIRST
    // instruction after attackcanceler is `jumpifnodamage` (data/
    // battle_scripts_1.s:2258-2265 -> Cmd_jumpifnodamage, src/
    // battle_script_commands.c:9340-9347): if the user took physical OR special
    // damage this turn it loses focus and the move does nothing. Its priority
    // -3 is already in the move table, so it naturally moves last and this
    // check is reachable. The engine already tracks per-turn damage taken
    // (youDamageTaken / oppDamageTaken), which is exactly gProtectStructs'
    // physicalDmg/specialDmg for this purpose.
    // Phase D F20: and the lost-focus branch (ppreduce, "lost its focus",
    // goto BattleScript_MoveEnd) sets NO result flag, so the script's `end`
    // (Cmd_end -> BattleArena_AddSkillPoints, src/battle_script_commands.c:
    // 3950-3953; src/battle_arena.c:588-621) takes the last arm: +1, not the
    // no-effect -2 this scored. (The user cannot be protected: it is using
    // Focus Punch.)
    if (moveData.effect === "EFFECT_FOCUS_PUNCH" && (isYou ? s.youDamageTaken : s.oppDamageTaken)) {
      s[skillKey] += skillDelta("landed");
      return;
    }
    // BattleScript_EffectSnore (data/battle_scripts_1.s:2254-2262): jumpifstatus
    // BS_ATTACKER, STATUS1_SLEEP -> SnoreIsAsleep, otherwise attackstring,
    // ppreduce and `goto BattleScript_ButItFailed`. So an AWAKE Snore is a
    // failure, not a miss and not a no-op. The exemption that lets a SLEEPING
    // mon select it at all is upstream in enumerateActionOutcomes.
    if (moveData.effect === "EFFECT_SNORE" && s[selfStatusKey] !== "sleep") {
      s[skillKey] += skillDelta("noEffect");
      return;
    }
    // Phase D F35: BattleScript_DreamEaterNoEffect -> BattleScript_WasntAffected
    // (data/battle_scripts_1.s:307-311, 429-433) prints PKMNWASNTAFFECTED and
    // sets NO result flag -- unlike ButItFailed (:2060) -- and the string is not
    // one DeductSkillPoints matches. So AddSkillPoints' last arm: +1, not the
    // -2 this scored (emulator: traces-given/00510). Substitute takes the same
    // path.
    if (moveData.effect === "EFFECT_DREAM_EATER" && (s[foeStatusKey] !== "sleep" || s[isYou ? "oppSubstituteHP" : "youSubstituteHP"] != null)) {
      s[skillKey] += skillDelta("landed");
      return;
    }
    const atkStatKey = moveData.category === "physical" ? "atk" : "spa";
    const defStatKey = moveData.category === "physical" ? "def" : "spd";
    // Phase D F42: Struggle skips typecalc -- no immunity, no effectiveness flags.
    const eff = moveName === "Struggle" ? 1 : typeEffectiveness(moveData.type, foeMon.types, foeForesighted);
    const foeEndureKey = isYou ? "oppEndureActive" : "youEndureActive";
    // B2b batch 7: Cmd_furycuttercalc (src/battle_script_commands.c:8580-8602).
    // The counter resets on NO_EFFECT and otherwise climbs to a cap of 5, and
    // the power is base * 2^(counter-1) -- 10/20/40/80/160 for Fury Cutter.
    // Computed here, where the state lives, and handed to the SINGLE damage
    // function as its power override rather than recomputed inside it.
    let furyCutterPower = variablePower;
    // B2b batch 9: Spit Up. The counter multiplies the damage and is SPENT
    // whether or not the move connects meaningfully -- source zeroes it inside
    // Cmd_stockpiletobasedamage, after the damage is computed. With nothing
    // stored the move fails outright.
    // B3 batch 1 (Smelling Salt x2 into paralysis) and B4c (Stomp's family x2
    // into Minimize) reuse the multiplier batch 9 added for Spit Up -- source
    // applies all three at the same point, to CalculateBaseDamage's output.
    // Phase D F39: derived by scriptDamageMultiplier, which Focus Band's probe
    // reads too. Read BEFORE the Spit Up block below spends the stockpile.
    let spitUpMultiplier = scriptDamageMultiplier(s, actor, moveData);
    if (moveData.effect === "EFFECT_SPIT_UP") {
      // NOTE the script ends in `adjustsetdamage`, not `adjustnormaldamage`
      // (data/battle_scripts_1.s:2094-2103), so Spit Up takes NO damage roll.
      // (The "SET_DAMAGE_ROLL_EXEMPT" this used to cite did not exist and Spit
      // Up was rolled; Phase D F30's ROLL_EXEMPT, derived from the scripts.)
      const spKey = isYou ? "youStockpile" : "oppStockpile";
      if (s[spKey] === 0) {
        s[skillKey] += skillDelta("noEffect");
        return;
      }
      s[spKey] = 0;
    }
    if (moveData.effect === "EFFECT_FURY_CUTTER") {
      const fcKey = isYou ? "youFuryCutter" : "oppFuryCutter";
      if (!hit || eff === 0) {
        s[fcKey] = 0;
      } else {
        furyCutterPower = counterHitPower(s, actor, moveData);
        if (s[fcKey] !== 5) s[fcKey] += 1;
      }
    }
    if (bideUnleash !== null) furyCutterPower = bideUnleash;
    if (counterReflect !== null) furyCutterPower = counterReflect; // F27
    // B3 batch 6: Triple Kick's first hit is power 10; the loop raises it.
    if (moveData.effect === "EFFECT_TRIPLE_KICK") furyCutterPower = 10;
    // B3 batch 3: typecalc sets targetNotAffected on a no-effect hit, and it is
    // in WasUnableToUseMove -- so a Thrash into a Ghost breaks its own lock.
    if (hit && eff === 0) s.turnFlags |= isYou ? TF_YOU_UNABLE : TF_OPP_UNABLE;
    // B3 batch 3: ROLLOUT / ICE BALL (Cmd_rolloutdamagecalculation, src/
    // battle_script_commands.c:8536-8569). The script's accuracycheck jumps to
    // the very next instruction on a miss, so a MISS still reaches the command,
    // which sees NO_EFFECT and cancels the chain -- as does a no-effect hit.
    // Otherwise: the first landed hit sets the timer to 5 and locks the move,
    // each hit spends one, and power doubles per hit already spent (30, 60,
    // 120 inside a 3-turn match), doubled again after Defense Curl. There is no
    // end-of-turn step: full paralysis and a confusion self-hit do not break it.
    if (moveData.effect === "EFFECT_ROLLOUT") {
      const lockKey = isYou ? "youLock" : "oppLock";
      if (!hit || eff === 0) {
        cancelMultiTurnMoves(s, actor);
      } else {
        // A first hit is one made without STATUS2_MULTIPLETURNS already set.
        const timer = (s[lockKey]?.kind === "rollout" ? s[lockKey].n : 5) - 1;
        furyCutterPower = counterHitPower(s, actor, moveData);
        s[lockKey] = timer === 0 ? null : { move: moveName, kind: "rollout", n: timer };
      }
    }
    // B3 batch 1: HI JUMP KICK'S CRASH, on the MISS side of the damage path --
    // the first draft put it in the OHKO branch's miss handling, where Hi Jump
    // Kick never goes, and the probe read a 0% crash.
    // BattleScript_MoveMissedDoDamage (data/battle_scripts_1.s:97-112) computes
    // the move's damage anyway and applies DMG_RECOIL_FROM_MISS
    // (src/battle_script_commands.c:6747-6753): half of it, minimum 1, capped at
    // the TARGET's maxHP/2. It is skipped entirely when the target is immune --
    // the script jumps past the crash on MOVE_RESULT_DOESNT_AFFECT_FOE.
    if (!hit && moveData.effect === "EFFECT_RECOIL_IF_MISS" && eff !== 0) {
      const wouldHave = calcDamage(selfMon, foeMon, moveName,
        battleDamageOptions(ctx, s, actor, moveData));
      const crash = Math.min(Math.max(1, Math.floor(wouldHave / 2)), Math.floor(foeMon.stats.hp / 2));
      s[selfHpKey] = hpSub(s[selfHpKey], crash, selfMon.stats.hp);
    }
    if (hit) {
      // Reflect/Light Screen: halves damage of the matching category, gated
      // on the DEFENDER'S side having it up (src/pokemon.c:3267-3273/3318-3324).
      // Crits bypass this (gCritMultiplier==1 gate): battleDamageOptions turns
      // screenActive off for a crit hit (B6-2; critDmg below).
      let dmg = calcDamage(selfMon, foeMon, moveName, battleDamageOptions(ctx, s, actor, moveData, furyCutterPower, spitUpMultiplier));
      // Bypass bonus: moves that ignore semi-invulnerability (Surf/Whirlpool
      // vs Dive, Earthquake vs Dig, Twister/Gust vs Fly) double damage;
      // Thunder/Sky Uppercut bypass without the bonus (source-confirmed).
      const foeChargingKey = isYou ? "oppCharging" : "youCharging";
      if (s[foeChargingKey]) {
        const bypassMult = INVULN_BYPASS[s[foeChargingKey].invulnBit]?.[moveName];
        if (bypassMult) dmg = Math.floor(dmg * bypassMult);
      }

      // Substitute: redirect damage to the sub's HP pool instead of the real
      // mon, capped at the sub's remaining HP (no overflow — Cmd_datahpupdate,
      // src/battle_script_commands.c:1865-1892). Skill scoring is UNAFFECTED
      // (classifyOutcome below still runs off the real type-effectiveness
      // eff, matching source: hitting a sub sets no special MOVE_RESULT flag,
      // it scores exactly like a normal hit on the real mon — confirmed by
      // checking BattleArena_AddSkillPoints, which only branches on
      // NO_EFFECT/SUPER_EFFECTIVE/NOT_VERY_EFFECTIVE, none of which
      // Cmd_datahpupdate's substitute branch ever sets). The real mon's HP
      // is never touched while a sub is up, regardless of how much damage
      // would have been dealt — even a would-be OHKO only breaks the sub.
      const foeSubKey = isYou ? "oppSubstituteHP" : "youSubstituteHP";
      const foeDestinyBondKey = isYou ? "oppDestinyBondActive" : "youDestinyBondActive";

      // Multi-hit (EFFECT_MULTI_HIT/DOUBLE_HIT/TWINEEDLE): `dmg` is computed
      // ONCE above (Reflect/weather/Flash Fire/bypass all already baked in)
      // and re-applied per hit — this engine already treats a single hit's
      // damage as one fixed expected-value number rather than an 85-100%
      // roll, so reusing that same number per hit is the direct extension
      // of the existing model, not a new approximation. `hits` defaults to
      // 1 for every ordinary damaging move, so this loop subsumes the old
      // single-hit code path unchanged (runs its body exactly once).
      const hits = hitCount ?? 1;
      // B6-2: this hit's crit bit, and its damage computed WITH the crit
      // (Cmd_damagecalc's x2 before typecalc; stages and screens per critcalc).
      const critBit = (i) => ((crit | 0) >> i) & 1;
      // F31: a per-hit roll vector recomputes each hit with its own roll.
      const perHitRoll = Array.isArray(ctx.rollPercent) ? (i, power, isCrit) => {
        let d = calcDamage(selfMon, foeMon, moveName, battleDamageOptions({ ...ctx, rollPercent: ctx.rollPercent[i] }, s, actor, moveData, power, spitUpMultiplier, isCrit));
        if (s[foeChargingKey]) {
          const bm = INVULN_BYPASS[s[foeChargingKey].invulnBit]?.[moveName];
          if (bm) d = Math.floor(d * bm);
        }
        return d;
      } : null;
      const critDmg = (power) => {
        let d = calcDamage(selfMon, foeMon, moveName, battleDamageOptions(ctx, s, actor, moveData, power, spitUpMultiplier, true));
        if (s[foeChargingKey]) {
          const bm = INVULN_BYPASS[s[foeChargingKey].invulnBit]?.[moveName];
          if (bm) d = Math.floor(d * bm);
        }
        return d;
      };
      let recoilBasis = 0; // last hit's actual HP removed (sub-absorbed amount, or real damage) — recoil's gHpDealt
      // drainBasis: source's gHpDealt PROPERLY CAPPED at HP actually removed
      // (src/battle_script_commands.c:1880 substitute branch, :1927 real-HP
      // branch), for the drain heal below. Kept SEPARATE from recoilBasis on
      // purpose — see the non-substitute branch note where they diverge.
      let drainBasis = 0;
      // B7b: Shell Bell heals off gSpecialStatuses[target].shellBellDmg, which
      // source assigns ONLY WHILE IT IS STILL ZERO (src/battle_script_commands.c:
      // 1870-1871 substitute, :1932-1933 real HP). It is therefore the FIRST
      // damaging hit of the move, never the total -- a multi-hit move heals off
      // hit one alone. Preserved as the quirk it is, not "fixed" to a sum.
      let shellBellBasis = 0;
      // F29: a per-hit secondary (Twineedle) is drawn per hit (secondaryTriggered
      // is the vector) and applied right after that hit, then that hit's move
      // end cures with a berry (MOVEEND_ITEM_EFFECTS_ALL, before NEXT_TARGET).
      const perHitSecondary = (i, subAtHitStart) => {
        if (!Array.isArray(secondaryTriggered) || eff === 0) return;
        if (secondaryTriggered[i]) applySecondary(ctx, s, actor, moveName, moveData, true, subAtHitStart);
        tryCureWithBerry(s, "you", ctx.you);
        tryCureWithBerry(s, "opp", ctx.opp);
      };
      for (let i = 0; i < hits; i++) {
        if (s[foeHpKey] <= 0) break; // already fainted from an earlier hit this sequence (src: jumpifhasnohp BS_TARGET)
        const subAtHitStart = s[foeSubKey] != null;
        // B3 batch 6: Triple Kick re-runs damagecalc every hit with
        // gDynamicBasePower = sTRIPLE_KICK_POWER, which gains 10 per hit
        // (addbyte ... 10; copyhword gDynamicBasePower, :1399-1401) -- a power
        // VECTOR, not one number repeated, which is why it was ledgered.
        if (moveData.effect === "EFFECT_TRIPLE_KICK" && i > 0) {
          dmg = calcDamage(selfMon, foeMon, moveName, battleDamageOptions(ctx, s, actor, moveData, 10 * (i + 1), spitUpMultiplier));
        }

        if (s[foeSubKey] != null) {
          // Substitute: redirect damage to the sub's HP pool instead of the
          // real mon, capped at the sub's remaining HP (no overflow —
          // Cmd_datahpupdate, src/battle_script_commands.c:1865-1892). Skill
          // scoring is UNAFFECTED (classifyOutcome below still runs off the
          // real type-effectiveness eff — hitting a sub sets no special
          // MOVE_RESULT flag, confirmed via BattleArena_AddSkillPoints).
          // Re-checked EVERY iteration (not cached) — confirmed from source
          // that once a multi-hit sequence breaks the sub partway through,
          // the REMAINING hits in the SAME move fall through to real HP
          // (Cmd_datahpupdate's substitute branch requires substituteHP > 0,
          // which is false the instant it's been zeroed).
          const hitPower = moveData.effect === "EFFECT_TRIPLE_KICK" ? (i > 0 ? 10 * (i + 1) : 10) : furyCutterPower;
          const hitBase = perHitRoll ? perHitRoll(i, hitPower, !!critBit(i))
            : critBit(i) ? critDmg(moveData.effect === "EFFECT_TRIPLE_KICK" ? 10 * (i + 1) : furyCutterPower) : dmg;
          const absorbed = Math.min(s[foeSubKey], hitBase);
          s[foeSubKey] -= absorbed;
          if (s[foeSubKey] <= 0) s[foeSubKey] = null; // sub breaks, fully absorbed regardless of excess
          recoilBasis = absorbed;
          drainBasis = absorbed; // = source gHpDealt (:1880); already capped at sub HP, so identical to recoilBasis here
          if (shellBellBasis === 0) shellBellBasis = absorbed; // source also sets shellBellDmg off the SUB's damage (:1878-1879)
          // NOTE: foeDamageTakenKey deliberately NOT set — the real mon took no
          // direct damage, so Counter/Mirror Coat have nothing to reflect (this
          // specific interaction wasn't chased further in source, but matches
          // the general "the sub takes the hit for you" semantics).
        } else {
          // Endure: clamp to leave exactly 1 HP if this hit would otherwise KO —
          // only intercepts direct move damage, never residual (burn/poison)
          // ticks (those don't flow through this code path at all). Only
          // relevant here since a substitute already fully absorbs otherwise.
          const foeAbsHpBefore = Math.round((s[foeHpKey] / 100) * foeMon.stats.hp);
          let hitDmg = perHitRoll ? perHitRoll(i, moveData.effect === "EFFECT_TRIPLE_KICK" ? (i > 0 ? 10 * (i + 1) : 10) : furyCutterPower, !!critBit(i))
            : critBit(i) ? critDmg(moveData.effect === "EFFECT_TRIPLE_KICK" ? 10 * (i + 1) : furyCutterPower) : dmg;
          let endureTriggeredThisHit = false;
          if (s[foeEndureKey]) {
            const foeRawHp = Math.round((s[foeHpKey] / 100) * foeMon.stats.hp);
            if (hitDmg >= foeRawHp) { hitDmg = Math.max(0, foeRawHp - 1); endureTriggeredThisHit = true; }
          } else if (focusBanded) {
            // B7c: Focus Band procced for this hit. It shares Endure's clamp
            // (src/battle_script_commands.c:1683-1685 is the same expression)
            // but NOT Endure's multi-hit halt: only MOVE_RESULT_FOE_ENDURED
            // stops the loop, and a Focus Band proc does not set it. That
            // distinction is why this is a separate branch and not an `||`.
            const foeRawHp = Math.round((s[foeHpKey] / 100) * foeMon.stats.hp);
            if (hitDmg >= foeRawHp) hitDmg = Math.max(0, foeRawHp - 1);
          }
          s[foeHpKey] = hpSub(s[foeHpKey], hitDmg, foeMon.stats.hp);
          recoilBasis = hitDmg;
          // FINDING (deliberately NOT fixed in change #10 — recoil is checkpointed):
          // recoilBasis is the RAW hitDmg, uncapped. Source's gHpDealt caps at the
          // HP actually removed on an overkill KO (:1927), and source recoil is
          // computed off that capped gHpDealt (Cmd_recoil, :2637 gBattleMoveDamage =
          // gHpDealt / 4). So on an overkill KO, recoil here is taken off raw damage
          // rather than the (smaller) HP removed — a latent overstatement. The drain
          // heal below must NOT inherit this, so it uses the capped drainBasis:
          drainBasis = Math.min(hitDmg, foeAbsHpBefore); // = source gHpDealt (:1927)
          if (shellBellBasis === 0) shellBellBasis = drainBasis;
          // Overwritten each hit, not accumulated — matches source, where
          // gProtectStructs[target].physicalDmg/specialDmg is a plain
          // assignment per hit (Cmd_datahpupdate), so Counter/Mirror Coat
          // can only ever reflect double the FINAL hit of a multi-hit move,
          // never the total.
          // the BASE category: Hidden Power records as Normal, so only Counter
          // answers it (F_DYNAMIC_TYPE_IGNORE_PHYSICALITY, :1851-1860)
          if (eff !== 0) s[foeDamageTakenKey] = { amount: hitDmg, category: MOVES[moveName].category };
          // Destiny Bond: if this hit just KO'd a foe with it armed, the
          // attacker instantly faints too (TrySetDestinyBondToHappen + the
          // faint-check at src/battle_script_commands.c:3020-3026) — only if
          // the attacker is still alive (can't "double-kill" one already at 0).
          // Only reachable here (real HP, not substitute) — a broken sub isn't
          // a faint, so Destiny Bond can't trigger off a hit that only broke it.
          if (s[foeHpKey] <= 0 && s[foeDestinyBondKey] && s[selfHpKey] > 0) {
            s[selfHpKey] = 0;
          }
          // src: the multi-hit loop explicitly halts the instant a hit sets
          // MOVE_RESULT_FOE_ENDURED (jumpifbyte ... BattleScript_MultiHitPrintStrings)
          // — no further hits after the one that gets clamped to 1 HP, unlike
          // a broken substitute (which lets the sequence continue).
          if (endureTriggeredThisHit) { perHitSecondary(i, subAtHitStart); break; }
        }
        perHitSecondary(i, subAtHitStart);
      }
      // B4: seteffectwithchance -- after datahpupdate, before MOVEEND.
      if (secondaryTriggered && !Array.isArray(secondaryTriggered) && eff !== 0) applySecondary(ctx, s, actor, moveName, moveData, secondaryTriggered, foeHadSubstitute);
      // Any damaging Fire-type move thaws a frozen target, regardless of user
      // (and regardless of substitute — thaw wasn't confirmed to be blocked
      // by a sub, kept as a passive reaction to being hit either way).
      // BASE type: Hidden Power Fire does not defrost (:1851-1860).
      if (MOVES[moveName].type === "Fire" && s[foeStatusKey] === "freeze") s[foeStatusKey] = null;

      // Recoil (see RECOIL_FRACTION above): unconditional on any hit (not
      // gated behind secondaryTriggered — MOVE_EFFECT_CERTAIN, no roll at
      // all), floored to 1 even off a 0-damage immune hit, applied AFTER the
      // target-side resolution above (so a Destiny-Bond self-faint from
      // THIS hit already zeroed the user's HP first, matching source's
      // script order — the max(0, ...) clamp below makes stacking a no-op).
      const recoilDivisor = RECOIL_FRACTION[moveData.effect];
      // Struggle recoils through Rock Head: BattleScript_MoveEffectRecoil checks
      // `jumpifmove MOVE_STRUGGLE` UNCONDITIONALLY, before the Rock Head check
      // runs at all. This stopped being moot in batch 11, when Struggle became
      // reachable as the no-legal-move fallback.
      if (recoilDivisor && moveName !== "Struggle" && selfMon.ability === "Rock Head") recordAbility(s, isYou ? "you" : "opp", "Rock Head"); // F2a
      if (recoilDivisor && (moveName === "Struggle" || selfMon.ability !== "Rock Head")) {
        const recoilDmg = Math.max(1, Math.floor(recoilBasis / recoilDivisor));
        s[selfHpKey] = hpSub(s[selfHpKey], recoilDmg, selfMon.stats.hp);
      }

      // B3 batch 1: the CERTAIN self-inflicted stat drops. Both are
      // MOVE_EFFECT_..._AFFECTS_USER | MOVE_EFFECT_CERTAIN, so they are not
      // chance secondaries at all -- they happen on every hit, which is what
      // made "unmodeled" wrong rather than merely incomplete.
      // B3 batch 2: FAKE OUT'S FLINCH. MOVE_EFFECT_FLINCH | MOVE_EFFECT_CERTAIN
      // (data/battle_scripts_1.s:2051) through seteffectwithchance, which needs
      // a hit that did not come back NO_EFFECT, then SetMoveEffect's gates
      // (src/battle_script_commands.c:2253-2270): SHIELD DUST blocks it (the
      // flinch byte is 8, inside the `<= 9` test), a fainted target cannot
      // take it, and neither can one behind a Substitute; then INNER FOCUS
      // blocks it at the flinch case itself (:2547-2560). The "target has not
      // moved yet" test there is implicit here: the flag is cleared at every
      // turn end, so setting it on a mon that already acted changes nothing.
      // B4c: the same path as every other flinch now -- including Inner Focus
      // PRINTING on this certain one (-3 Skill), which batch 2 left out.
      if (moveData.effect === "EFFECT_FAKE_OUT" && dmg > 0) applyFlinch(ctx, s, actor, foeHadSubstitute, true);
      // B3 batch 3: RAMPAGE'S LOCK. confuseifrepeatingattackends queues
      // MOVE_EFFECT_THRASH | AFFECTS_USER only while LOCK_CONFUSE is clear
      // (src/battle_script_commands.c:7131-7137), and seteffectwithchance (100%)
      // applies it only to a hit that was not NO_EFFECT. The length was drawn
      // by the enumerator (rampageSplit).
      if (moveData.effect === "EFFECT_RAMPAGE" && dmg > 0 && s[isYou ? "youLock" : "oppLock"]?.kind !== "rampage") {
        if (lockTurns !== 2 && lockTurns !== 3) {
          throw new Error(`"${moveName}" (effect: EFFECT_RAMPAGE) landed without a drawn lock length -- ` +
            `the enumerator's rampageSplit did not run on this path.`);
        }
        s[isYou ? "youLock" : "oppLock"] = { move: moveName, kind: "rampage", n: lockTurns };
      }
      // B3 batch 5: THE WRAP. MOVE_EFFECT_WRAP (13) through seteffectwithchance
      // (100%) on a hit that was not NO_EFFECT; SetMoveEffect's gates then stop
      // it on a fainted target or one behind a Substitute (the flag holds to
      // turn end, hence the snapshot). 13 > 9, so Shield Dust does NOT block
      // it. A target already wrapped keeps its existing counter.
      if (moveData.effect === "EFFECT_TRAP" && dmg > 0 && s[foeHpKey] > 0 && !foeHadSubstitute
          && !s[isYou ? "oppWrapped" : "youWrapped"]) {
        if (![3, 4, 5, 6].includes(lockTurns)) {
          throw new Error(`"${moveName}" (effect: EFFECT_TRAP) landed without a drawn wrap length -- ` +
            `the enumerator's rampageSplit did not run on this path.`);
        }
        s[isYou ? "oppWrapped" : "youWrapped"] = { move: moveName, n: lockTurns };
      }
      // B3 batch 4d: UPROAR'S LOCK. setmoveeffect MOVE_EFFECT_UPROAR |
      // AFFECTS_USER, applied by seteffectwithchance (100%) to a hit that was
      // not NO_EFFECT, only if the user is not already in an uproar.
      if (moveData.effect === "EFFECT_UPROAR" && dmg > 0 && s[isYou ? "youLock" : "oppLock"]?.kind !== "uproar") {
        if (![2, 3, 4, 5].includes(lockTurns)) {
          throw new Error(`"${moveName}" (effect: EFFECT_UPROAR) landed without a drawn lock length -- ` +
            `the enumerator's rampageSplit did not run on this path.`);
        }
        s[isYou ? "youLock" : "oppLock"] = { move: moveName, kind: "uproar", n: lockTurns };
      }
      if (moveData.effect === "EFFECT_OVERHEAT" && dmg > 0) {
        bumpStage(isYou ? s.youStages : s.oppStages, "spa", -2);
      }
      if (moveData.effect === "EFFECT_SUPERPOWER" && dmg > 0) {
        const selfStages = isYou ? s.youStages : s.oppStages;
        bumpStage(selfStages, "atk", -1);
        bumpStage(selfStages, "def", -1);
      }
      // SMELLING SALT cures the target's paralysis, and it is CERTAIN too
      // (MOVE_EFFECT_REMOVE_PARALYSIS | MOVE_EFFECT_CERTAIN, :2822-2841). The
      // doubling against a paralysed target is handled in the damage options.
      if (moveData.effect === "EFFECT_SMELLINGSALT" && dmg > 0 && s[foeStatusKey] === "paralysis") {
        s[foeStatusKey] = null;
      }

      // B8d: COLOR CHANGE (ABILITYEFFECT_ON_DAMAGE, src/battle_util.c:2751-
      // 2765): a damaging, non-Struggle move that affected and damaged the
      // holder ITSELF turns it into that move's type (both type slots), unless
      // it already has that type or has fainted. No contact needed.
      if (foeMon.ability === "Color Change" && moveData.power > 0 && moveName !== "Struggle"
          && eff !== 0 && dmg > 0 && !foeHadSubstitute && s[foeHpKey] > 0
          && !foeMon.types.includes(moveData.type)) {
        s[isYou ? "oppTypes" : "youTypes"] = [moveData.type];
        recordAbility(s, isYou ? "opp" : "you", "Color Change"); // F2a
      }
      // B8: THE CONTACT ABILITIES, applied to the ATTACKER after the hit. The
      // conditions match contactAbilityBranches; the attacker must still be up
      // (recoil has already been taken by now).
      if (moveData.power > 0 && moveFlags(moveName).makesContact && eff !== 0 && dmg > 0
          && !foeHadSubstitute && s[selfHpKey] > 0 && (hitCount ?? 1) === 1) {
        // F2a: ABILITYEFFECT_ON_DAMAGE records on the trigger itself, whether or
        // not the status then lands (src/battle_util.c:2767-2866 -> :3195).
        if (foeMon.ability === "Rough Skin" || contactProc) recordAbility(s, isYou ? "opp" : "you", foeMon.ability);
        if (foeMon.ability === "Rough Skin") {
          // :2767-2781 -- no roll: 1/16 of the ATTACKER's max HP, min 1.
          const rs = Math.max(1, Math.floor(selfMon.stats.hp / 16));
          s[selfHpKey] = hpSub(s[selfHpKey], rs, selfMon.stats.hp);
        }
        if (contactProc === "attract") {
          s[isYou ? "youAttracted" : "oppAttracted"] = true;
        } else if (contactProc && contactProc !== "record") {
          const side = isYou ? "you" : "opp";
          if (canTakeContactStatus(s, side, contactProc, selfMon)) {
            s[selfStatusKey] = contactProc;
            if (contactProc === "sleep") {
              s[selfSleepTurnsKey] = contactSleep;
              cancelMultiTurnMoves(s, side); // SetMoveEffect's sleep case (:2296)
            }
          }
        }
      } else if (contactProc === "record" && (hitCount ?? 1) > 1 && eff !== 0 && dmg > 0 && !foeHadSubstitute) {
        recordAbility(s, isYou ? "opp" : "you", foeMon.ability); // F2a: a record-only multi-hit trigger
      } else if (moveData.power > 0 && moveFlags(moveName).makesContact && foeMon.ability === "Rough Skin"
                 && (hitCount ?? 1) > 1 && eff !== 0 && !foeHadSubstitute) {
        throw new Error(`"${moveName}" is a multi-hit contact move into Rough Skin (${foeMon.species}): ` +
          `ABILITYEFFECT_ON_DAMAGE runs after EVERY hit, which is not modelled.`);
      }

      // (2) B2b batch 11: RAGE'S ATTACK RAISE, at MOVEEND_RAGE
      // (src/battle_script_commands.c:4240-4255). It belongs to the TARGET, not
      // the attacker: a raging mon that is damaged by a damaging move from the
      // other side gains +1 Attack, capped at +6, and only when the hit
      // actually did something (TARGET_TURN_DAMAGED and not NO_EFFECT).
      {
        const foeRagingKey = isYou ? "oppRaging" : "youRaging";
        const foeStagesForRage = isYou ? s.oppStages : s.youStages;
        if (s[foeRagingKey] && moveData.power > 0 && eff !== 0 && dmg > 0
            && s[foeHpKey] > 0 && foeStagesForRage.atk < 6) {
          bumpStage(foeStagesForRage, "atk", 1);
        }
      }

      // Drain heal (see DRAIN_EFFECTS above): the USER recovers half the HP
      // actually removed from the target. Cmd_negativedamage (src/battle_script_
      // commands.c:6924-6928): gBattleMoveDamage = -(gHpDealt / 2), then if the
      // halved value is 0 it is floored to 1 (min 1 heal). Integer /2 truncates
      // toward zero (gHpDealt >= 0), and the floor-to-1 applies to the HALVED
      // value — so drainBasis == 1 halves to 0 then floors to a 1-HP heal. Gated
      // on eff !== 0: a type-immune hit never reaches negativedamage in source
      // (MOVE_RESULT_NO_EFFECT skips it), and without this gate the min-1 floor
      // would wrongly heal 1 off a 0 basis. Capped at full HP, mirroring the
      // Volt/Water-Absorb heal above. Liquid Ooze is modelled just below (Phase
      // D F7; it was an "accepted limitation" while only Metagross was ever the
      // target -- the full player grid ended that).
      if (DRAIN_EFFECTS.has(moveData.effect) && eff !== 0) {
        const heal = Math.max(1, Math.floor(drainBasis / 2));
        // Phase D F7: a Liquid Ooze TARGET flips the heal into damage to the
        // attacker (BattleScript_EffectAbsorb, bs:345-349). Dream Eater's script
        // (bs:453-461) has no such check: it always heals, and records nothing.
        if (moveData.effect === "EFFECT_ABSORB" && foeMon.ability === "Liquid Ooze") {
          recordAbility(s, isYou ? "opp" : "you", "Liquid Ooze"); // F2a
          s[selfHpKey] = hpSub(s[selfHpKey], heal, selfMon.stats.hp);
        } else {
          s[selfHpKey] = hpAdd(s[selfHpKey], heal, selfMon.stats.hp);
        }
      }
      // B7b: Shell Bell (src/battle_util.c:3787-3806). Heals the ATTACKER
      // floor(dmg / param) with param 8, min 1, but ONLY when the move had an
      // effect, the attacker is alive and NOT already at full HP, and attacker
      // is not its own target. Never consumed.
      const selfItemData = itemData(selfMon.item);
      if (selfItemData && selfItemData.holdEffect === "HOLD_EFFECT_SHELL_BELL"
          && eff !== 0 && shellBellBasis > 0 && s[selfHpKey] > 0 && s[selfHpKey] < 100) {
        const heal = Math.max(1, Math.floor(shellBellBasis / selfItemData.param));
        s[selfHpKey] = hpAdd(s[selfHpKey], heal, selfMon.stats.hp);
      }
    }
    // B2b batch 2: Choice Band locks its holder into the first move it uses.
    //
    // MECHANIC-WHOLENESS (amendment 9). Choice Band is referenced from FIVE
    // source functions; every clause is accounted for here:
    //   src/pokemon.c:3185          CalculateBaseDamage, 1.5x Attack  -> B7a
    //   src/battle_util.c:1119      CheckMoveLimitations, the lock    -> selectableMoves
    //   src/battle_util.c:1051      TrySetCantSelectMoveBattleScript  -> same rule, the
    //                               per-move selection guard; equivalent, nothing extra
    //   src/battle_script_commands.c:4296  MOVEEND_CHOICE_MOVE, which SETS the lock -> applyMove (F26)
    //   include/constants/hold_effects.h:33  the constant itself
    //
    // MOVEEND_CHOICE_MOVE's own clauses, each ported or ledgered:
    //   HITMARKER_OBEYS            NOT always true (Phase D F26): unset for a move
    //                              cancelled in AtkCanceler_UnableToUseMove or
    //                              blocked by Soundproof, both before
    //                              Cmd_attackcanceler sets it (:932 / :960)
    //   gChosenMove != MOVE_STRUGGLE  ported (Phase D F42) in the applyMove wrapper
    //   choicedMove not already set   ported, the `== null` guard below
    //   Baton Pass that did NOT fail skips the assignment: EFFECT_BATON_PASS
    //     always fails here (the Arena has no reserve party), so source would
    //     take the assigning path too -- consistent, and stated rather than
    //     assumed
    //   gChosenMove, i.e. the move SELECTED, not the one executed. Identical
    //     today; it will DIVERGE once Sleep Talk / Metronome / Mirror Move land
    //     in batch 3, which call a different move than the one chosen. Flagged
    //     here so that batch does not have to rediscover it.
    // (Phase D F26: the lock itself is set in applyMove, after the move, for
    // EVERY move that obeyed -- it used to be set only here, at the end of the
    // damaging path, so a Choice Band holder's status move never locked.)
    // B2b batch 3: MOVEEND_MIRROR_MOVE records what the TARGET just took, so
    // Mirror Move has something to copy. Gated exactly as source gates it
    // (src/battle_script_commands.c:4438-4445): the move must be
    // FLAG_MIRROR_MOVE_AFFECTED, must have obeyed, must not have come from the
    // target itself, must not have fainted it, and must not have been a
    // no-effect hit. Keyed on the CHOSEN move, like the Choice lock.
    if (hit && eff !== 0 && moveFlags(chosenMoveName).mirrorMoveAffected && s[foeHpKey] > 0) {
      s[isYou ? "oppLastTakenMove" : "youLastTakenMove"] = chosenMoveName;
    }
    // B3 batch 4c: Bide's unleash clears MOVE_RESULT_SUPER_EFFECTIVE and
    // NOT_VERY_EFFECTIVE after typecalc (data/battle_scripts_1.s:3300), so a
    // landed unleash always scores as a plain hit. Phase D F21: so do six more
    // scripts (EFFECTIVENESS_CLEARED_EFFECTS) -- Seismic Toss scored +2 into a
    // Normal type where the ROM gives +1. A x0 still scores -2: the bicbyte
    // leaves MOVE_RESULT_DOESNT_AFFECT_FOE.
    // (F27: Counter / Mirror Coat run typecalc2, which never writes SE / NVE
    // either -- src/battle_script_commands.c:4500-4591.)
    const flagsCleared = bideUnleash !== null || EFFECTIVENESS_CLEARED_EFFECTS.has(moveData.effect)
      || moveData.effect === "EFFECT_COUNTER" || moveData.effect === "EFFECT_MIRROR_COAT";
    s[skillKey] += skillDelta(classifyOutcome(hit, flagsCleared && eff > 0 ? 1 : eff));
    // (EFFECT_EXPLOSION's self-faint is applied unconditionally much earlier
    // now — see the comment above the blockedByProtect check — since it must
    // fire even when Protect blocks the move entirely, which returns before
    // ever reaching this point.)

    // B4: secondaries dispatch in the damage path (applySecondary), so this
    // is now the guard alone, for every power>1 move.
    if (moveData.power > 1) {
      // Mandatory-mechanic guard (change #11). Covers every power>1 move; its
      // chance secondary, if any, already ran in applySecondary. Damage is already
      // applied above; here we only assert that dropping the executor was
      // legitimate. See the HANDLED / ACCEPTED_UNMODELED definitions above for
      // the axis distinction vs SILENT_FALLTHROUGH_EFFECTS.
      //
      // Scope is power>1 (matching the coverage test and get_how_powerful's own
      // eligibility gate). power===1 is the placeholder-power family — Flail/
      // Reversal (EFFECT_FLAIL) and Seismic Toss/Night Shade (EFFECT_LEVEL_
      // DAMAGE) reach this path but get their real damage from calcDamage's own
      // branches and carry no secondary mechanic; Counter/Mirror Coat/OHKO
      // early-return before ever reaching here. None need this guard.
      const effect = moveData.effect;
      if (!HANDLED_EFFECTS.has(effect)) {
        if (effect in ACCEPTED_UNMODELED_EFFECTS) {
          // Known, tracked, deliberately-unported mandatory mechanic: warn once
          // (deduped by effect) and proceed — no computed-output change.
          warnUnmodeledMechanicOnce(effect, moveName);
        } else {
          // Fail closed: an unclassified power>0 effect. Either it is pure
          // damage (add it to PURE_DAMAGE_EFFECTS), it is handled by a table
          // this guard doesn't yet consult (add it to HANDLED's derivation),
          // or it carries an unported mandatory mechanic (add it to
          // ACCEPTED_UNMODELED_EFFECTS with a citation and queue the fix).
          throw new Error(`"${moveName}" (effect: ${effect}) reached the power>0 damage path with no ` +
            `secondary executor and is not classified as handled or accepted-unmodeled — it may be ` +
            `silently dropping a mandatory on-hit mechanic (change #11 guard). Classify it: add to ` +
            `PURE_DAMAGE_EFFECTS, wire its executor/inline handler into HANDLED, or register it in ` +
            `ACCEPTED_UNMODELED_EFFECTS.`);
        }
      }
    }
  } else if (moveData.effect === "EFFECT_SLEEP" && s[isYou ? "oppSubstituteHP" : "youSubstituteHP"] == null
             && s[foeStatusKey] !== "sleep" && uproarKeepsAwake(s, foeMon)) {
    // B3 batch 4d: BattleScript_EffectSleep (data/battle_scripts_1.s:284-298)
    // runs jumpifcantmakeasleep BEFORE its accuracycheck, and the uproar branch
    // (BattleScript_CantMakeAsleep, :313-317) sets no result flag: +1, and
    // nothing happens -- on the branches that would have missed, too. The
    // earlier checks (Substitute, already asleep) and the later ones fail -2
    // either way, which the paths below already give.
    s[skillKey] += skillDelta("landed");
  } else if (!hit) {
    // A genuine accuracy miss on a power=0 status move (e.g. Attract, whose
    // 100 base accuracy CAN miss once evasion/accuracy stages are involved
    // — most already-ported status moves use accuracy:null so this path was
    // previously unreachable for them). Pre-existing gap, caught while
    // wiring Attract: this branch used to fall into the executor dispatch
    // below UNCONDITIONALLY, regardless of hit, which would have run e.g.
    // Attract's infatuation-infliction logic even on a miss. Scored as a
    // real miss, no executor call, no state changes.
    s[skillKey] += skillDelta("miss");
  } else {
    const executor = EFFECT_EXECUTORS[moveData.effect];
    let outcome = "landed";
    // Phase D F36: an executor that lands but prints a DeductSkillPoints
    // string returns { printed: [...] } (Tickle into Hyper Cutter).
    let printed = [];
    if (executor) {
      // Status-move executors can report "failed" (e.g. Rest at full HP,
      // Roar with nothing to switch into, paralysis blocked by type/ability)
      // — those score Skill as noEffect instead of the default landed/+1.
      const result = executor(s, actor, ctx, moveData, sleepDuration, attractGenderCompatible, disableTimer);
      if (result === "failed") outcome = "noEffect";
      // B2b batch 9: "missed" is a THIRD outcome an executor can report, and
      // the distinction is real in the Arena's Skill scoring. Cmd_stockpile at
      // three sets MOVE_RESULT_MISSED (src/battle_script_commands.c:6854),
      // not MOVE_RESULT_FAILED -- a miss, which BattleArena_AddSkillPoints
      // scores differently from a failure.
      else if (result === "missed") outcome = "miss";
      else if (result && typeof result === "object") printed = result.printed ?? [];
    } else {
      // A3: the EFFECT_TOXIC exemption that used to live on this branch is GONE.
      // It let Toxic land, score +1 Skill and apply nothing whenever the target
      // was not Steel/Poison -- the silent-failure class hard constraint 4
      // forbids. Toxic now has a real executor above.
      // Toxic is intentionally exempt: it's locked out of the AI's move pool
      // by the Steel/Poison immunity check before it would ever be chosen,
      // so it never reaches execution in any matchup so far.
      // B2b batch 11: the four that are left, and why they still throw rather
      // than degrading. ACCEPTED_UNMODELED_EFFECTS is consulted ONLY by the
      // power>1 damage-path guard, so a status move cannot be "accepted" into
      // it -- and degrading a status move means doing NOTHING, which is the
      // silent-failure class hard constraint 4 forbids. Phase B's acceptance
      // criterion is "solves OR fails loud with a named cause", and these fail
      // loud with named causes:
      //
      //   EFFECT_MIMIC     2 cells. Replaces Mimic itself with the target's
      //                    last move for the battle (Cmd_mimicattackcopy).
      //                    Needs a MOVE-LIST override -- a third mutation axis
      //                    beside batch 10's ability and item ones.
      //   EFFECT_ASSIST    1 cell. Calls a random move from the user's PARTY
      //                    members' movesets (:9484-9520). This engine models
      //                    one mon per side; the party's moves are not state at
      //                    all, so there is nothing to draw from.
      //   EFFECT_TRANSFORM 1 cell. Copies species, stats, types, ability and
      //                    moves at once, and stats are computed at buildMon.
      //   EFFECT_BIDE      1 cell (and it throws from the damage guard, not
      //                    here). A multi-turn lock plus a damage accumulator.
      //
      // 5 cells of 1392, all four queued for B3.
      throw new Error(`"${moveName}" (effect: ${moveData.effect}) has no execution logic yet — port it into EFFECT_EXECUTORS.`);
    }
    s[skillKey] += printed.length ? arenaSkillDelta("landed", printed) : skillDelta(outcome);
  }
}

// End-of-turn effects: Leftovers healing runs FIRST (ENDTURN_ITEMS1), THEN
// burn/poison residual damage (ENDTURN_POISON/ENDTURN_BURN) — source-confirmed
// ordering. A burned/poisoned Leftovers-holder still nets damage overall
// (1/16 heal vs 1/8 damage) but the heal genuinely banks first.
// Sandstorm/Hail chip damage immunity checks (src/battle_script_commands.c:7602-7646).
function isWeatherChipImmune(weatherType, mon, charging) {
  const underground = charging?.invulnBit === "underground";
  const underwater = charging?.invulnBit === "underwater";
  if (weatherType === "sandstorm") {
    return mon.types.some((t) => ["Rock", "Steel", "Ground"].includes(t))
      || mon.ability === "Sand Veil" || underground || underwater;
  }
  if (weatherType === "hail") {
    return mon.types.includes("Ice") || underground || underwater;
  }
  return true; // rain/sun/no-weather never chip
}

function applyEndOfTurnEffects(ctx, s, shedSkinCure = null) {
  const { you, opp } = ctx;

  // Phase D F34: WISH is a FIELD end-turn step -- DoFieldEndTurnEffects runs
  // ENDTURN_REFLECT, LIGHT_SCREEN, MIST, SAFEGUARD, WISH, then RAIN, SANDSTORM,
  // SUN, HAIL (src/battle_util.c:1168-1178), all before DoBattlerEndTurnEffects
  // (src/battle_main.c:3963-3966). The engine healed the wisher AFTER the
  // poison / burn / Leech Seed ticks, which let a full-HP wisher's heal undo
  // that turn's residual (emulator: traces/00182, Espeon's Toxic tick). It now
  // runs first, before the weather damage too.
  // B2: Wish. ENDTURN_WISH (src/battle_util.c:1319-1338) decrements the counter
  // and, when it reaches 0, heals the wisher maxHP/2 (min 1). Set to 2 on use,
  // so it lands at the end of the FOLLOWING turn — a Wish cast on turn 3 of a
  // 3-turn round never resolves, which falls out of the counter rather than
  // being special-cased.
  for (const [k, hpKey, mon] of [["youWishTurns", "yourHpPct", you], ["oppWishTurns", "oppHpPct", opp]]) {
    if (s[k] == null) continue;
    s[k] -= 1;
    if (s[k] > 0) continue;
    s[k] = null;
    if (s[hpKey] > 0) {
      const heal = Math.max(1, Math.floor(mon.stats.hp / 2));
      s[hpKey] = hpAdd(s[hpKey], heal, mon.stats.hp);
    }
  }

  // Weather chip damage + duration housekeeping runs FIRST, before EVERYTHING
  // else in this function — DoFieldEndTurnEffects() runs to completion
  // entirely before DoBattlerEndTurnEffects() even starts (src/battle_main.c:3963-3966),
  // and Ingrain/Leftovers/Leech Seed/poison/burn all live in the latter. This
  // matters for real edge cases: a mon that would've survived via Leftovers/
  // Ingrain healing first could otherwise be wrongly fainted by weather chip
  // if the order were reversed. 1/16 max HP (floor, min 1), non-immune types
  // only; skipped entirely if Cloud Nine/Air Lock suppresses weather.
  const weather = effectiveWeather(s, you, opp);
  if ((weather === "sandstorm" || weather === "hail")) {
    if (s.yourHpPct > 0 && !isWeatherChipImmune(weather, you, s.youCharging)) {
      const chip = Math.max(1, Math.floor(you.stats.hp / 16));
      s.yourHpPct = hpSub(s.yourHpPct, chip, you.stats.hp);
    }
    if (s.oppHpPct > 0 && !isWeatherChipImmune(weather, opp, s.oppCharging)) {
      const chip = Math.max(1, Math.floor(opp.stats.hp / 16));
      s.oppHpPct = hpSub(s.oppHpPct, chip, opp.stats.hp);
    }
  }

  // Ingrain: 1/16 max HP, comes BEFORE Leftovers in the real per-battler
  // order (ENDTURN_INGRAIN is index 0, ENDTURN_ITEMS1 is index 2 —
  // src/battle_util.c:1440-1462). No-op at full HP or 0 HP.
  if (s.youIngrained && s.yourHpPct > 0 && s.yourHpPct < 100) {
    const heal = Math.max(1, Math.floor(you.stats.hp / 16));
    s.yourHpPct = hpAdd(s.yourHpPct, heal, you.stats.hp);
  }
  if (s.oppIngrained && s.oppHpPct > 0 && s.oppHpPct < 100) {
    const heal = Math.max(1, Math.floor(opp.stats.hp / 16));
    s.oppHpPct = hpAdd(s.oppHpPct, heal, opp.stats.hp);
  }

  // Rain Dish: 1/16 max HP in rain, comes right after Ingrain and before
  // Leftovers (ENDTURN_ABILITIES is index 1, right between ENDTURN_INGRAIN=0
  // and ENDTURN_ITEMS1=2 — src/battle_util.c:2601-2619).
  if (weather === "rain") {
    if (you.ability === "Rain Dish" && s.yourHpPct > 0 && s.yourHpPct < 100) {
      recordAbility(s, "you", "Rain Dish"); // F2a
      const heal = Math.max(1, Math.floor(you.stats.hp / 16));
      s.yourHpPct = hpAdd(s.yourHpPct, heal, you.stats.hp);
    }
    if (opp.ability === "Rain Dish" && s.oppHpPct > 0 && s.oppHpPct < 100) {
      const heal = Math.max(1, Math.floor(opp.stats.hp / 16));
      s.oppHpPct = hpAdd(s.oppHpPct, heal, opp.stats.hp);
    }
  }
  // B8c: the rest of ENDTURN_ABILITIES (src/battle_util.c:2620-2655), at the
  // same checkpoint -- so a Shed Skin cure comes BEFORE this turn's poison or
  // burn tick. Its 1/3 roll was drawn by the caller (shedSkinBranches).
  // SHED SKIN clears the whole major status and STATUS2_NIGHTMARE.
  for (const side of ["you", "opp"]) {
    if (!shedSkinCure?.[side]) continue;
    recordAbility(s, side, "Shed Skin"); // F2a: ENDTURN_ABILITIES records the cure
    s[side === "you" ? "youStatus" : "oppStatus"] = null;
    s[side === "you" ? "youSleepTurns" : "oppSleepTurns"] = null;
    s[side === "you" ? "youToxicCounter" : "oppToxicCounter"] = null;
    s[side === "you" ? "youNightmared" : "oppNightmared"] = false;
  }
  // TRUANT flips its counter every end of turn.
  if (you.ability === "Truant" && s.yourHpPct > 0) setVf(s, "youTruantLoaf", !vf(s, "youTruantLoaf"));
  if (opp.ability === "Truant" && s.oppHpPct > 0) setVf(s, "oppTruantLoaf", !vf(s, "oppTruantLoaf"));
  // Phase D F6: SPEED BOOST, the same ENDTURN_ABILITIES pass (src/battle_util.c:
  // 2642-2652): +1 Speed below +6 unless isFirstTurn == 2 -- which a lead never
  // is here: TryDoEventsBeforeFirstTurn's TurnValuesCleanUp(FALSE) takes it 2 -> 1
  // before turn 1 (src/battle_main.c:3051, :3901, :4875-4876). So every turn end.
  for (const [side, mon, hpKey] of [["you", you, "yourHpPct"], ["opp", opp, "oppHpPct"]]) {
    const st = side === "you" ? s.youStages : s.oppStages;
    if (mon.ability === "Speed Boost" && s[hpKey] > 0 && st.spe < 6) {
      if (side === "you") s.youStages = { ...st, spe: st.spe + 1 }; else s.oppStages = { ...st, spe: st.spe + 1 };
      recordAbility(s, side, "Speed Boost"); // F2a: ENDTURN records on the holder
    }
  }

  // Leftovers: 1/16 max HP, no-op at full HP, never overheals past max.
  if (s.yourHpPct > 0 && s.yourHpPct < 100 && you.item === "Leftovers") {
    const heal = Math.max(1, Math.floor(you.stats.hp / 16));
    s.yourHpPct = hpAdd(s.yourHpPct, heal, you.stats.hp);
  }
  if (s.oppHpPct > 0 && s.oppHpPct < 100 && opp.item === "Leftovers") {
    const heal = Math.max(1, Math.floor(opp.stats.hp / 16));
    s.oppHpPct = hpAdd(s.oppHpPct, heal, opp.stats.hp);
  }

  // Status-curing berries (Lum/Cheri/Chesto/etc.) — same ITEMS1/ITEMS2
  // checkpoint as Leftovers above, so it belongs at this same relative
  // position: BEFORE Leech Seed/poison/burn residual (see tryCureWithBerry's
  // comment for why that ordering specifically matters).
  if (s.yourHpPct > 0) tryCureWithBerry(s, "you", you);
  if (s.oppHpPct > 0) tryCureWithBerry(s, "opp", opp);

  // B7b: the rest of the ITEMEFFECT_NORMAL switch -- Sitrus, White Herb and the
  // Liechi/Salac/Petaya pinch berries. Same checkpoint as the cure berries
  // because they are literally cases of the same switch (src/battle_util.c:3331).
  if (s.yourHpPct > 0) tryEndOfTurnItem(s, "you", you);
  if (s.oppHpPct > 0) tryEndOfTurnItem(s, "opp", opp);

  // Leech Seed: comes right after Leftovers (ITEMS1) and before poison/burn
  // in the real ENDTURN_* order (src/battle_util.c:1440-1462 — INGRAIN,
  // ABILITIES, ITEMS1, LEECH_SEED, POISON, BAD_POISON, BURN, ...). Drains
  // maxHP/8 of the seeded mon (floored, min 1, capped at its CURRENT hp — you
  // can't drain more than you have), transfers that SAME raw amount as
  // healing to whoever planted it (capped at their max HP), skipped entirely
  // if either side has already fainted.
  // Phase D F7: Liquid Ooze is the SEEDED mon's (jumpifability BS_ATTACKER,
  // data/battle_scripts_1.s:3271), and it turns the heal into DAMAGE to the
  // seeder (the DMG_CHANGE_SIGN is skipped). This used to check the seeder and
  // only withhold the heal.
  if (s.youSeeded && s.yourHpPct > 0 && s.oppHpPct > 0) {
    if (you.ability === "Liquid Ooze") recordAbility(s, "you", "Liquid Ooze"); // F2a: bs:3271 (see F7)
    const maxDrain = Math.max(1, Math.floor(you.stats.hp / 8));
    const currentHp = Math.round((s.yourHpPct / 100) * you.stats.hp);
    const drain = Math.min(maxDrain, currentHp);
    s.yourHpPct = hpSub(s.yourHpPct, drain, you.stats.hp);
    // Phase D F7: the SEEDED mon's Liquid Ooze (jumpifability BS_ATTACKER,
    // bs:3271) skips the sign flip -- the seeder takes the drain as damage.
    if (you.ability === "Liquid Ooze") s.oppHpPct = hpSub(s.oppHpPct, drain, opp.stats.hp);
    else s.oppHpPct = hpAdd(s.oppHpPct, drain, opp.stats.hp);
  }
  if (s.oppSeeded && s.oppHpPct > 0 && s.yourHpPct > 0) {
    const maxDrain = Math.max(1, Math.floor(opp.stats.hp / 8));
    const currentHp = Math.round((s.oppHpPct / 100) * opp.stats.hp);
    const drain = Math.min(maxDrain, currentHp);
    s.oppHpPct = hpSub(s.oppHpPct, drain, opp.stats.hp);
    if (opp.ability === "Liquid Ooze") s.yourHpPct = hpSub(s.yourHpPct, drain, you.stats.hp); // F7
    else s.yourHpPct = hpAdd(s.yourHpPct, drain, you.stats.hp);
  }

  // Burn/poison residual: maxHP/8 (Gen III — NOT 1/16 as in later generations).
  //
  // A3: BAD poison (Toxic) is a separate case with a separate divisor and an
  // escalating multiplier — src/battle_util.c:1536-1548:
  //     gBattleMoveDamage = maxHP / 16;  if (0) -> 1;
  //     if (counter != TOXIC_TURN(15)) counter += 1;      // capped at 15
  //     gBattleMoveDamage *= counter;                     // AFTER the increment
  // so the FIRST tick after infliction is maxHP/16 * 1, the second * 2, and so
  // on. The min-1 floor applies to the per-turn base, before the multiply.
  // Ordinary poison keeps the flat maxHP/8 (:1525-1535).
  const toxicTick = (hpKey, counterKey, mon) => {
    const dmg = Math.max(1, Math.floor(mon.stats.hp / 16));
    const next = Math.min(15, (s[counterKey] ?? 0) + 1);
    s[counterKey] = next;
    s[hpKey] = hpSub(s[hpKey], (dmg * next), mon.stats.hp);
  };
  if (s.yourHpPct > 0 && (s.youStatus === "burn" || s.youStatus === "poison")) {
    if (s.youStatus === "poison" && s.youToxicCounter != null) {
      toxicTick("yourHpPct", "youToxicCounter", you);
    } else {
      const dmg = Math.max(1, Math.floor(you.stats.hp / 8));
      s.yourHpPct = hpSub(s.yourHpPct, dmg, you.stats.hp);
    }
  }
  if (s.oppHpPct > 0 && (s.oppStatus === "burn" || s.oppStatus === "poison")) {
    if (s.oppStatus === "poison" && s.oppToxicCounter != null) {
      toxicTick("oppHpPct", "oppToxicCounter", opp);
    } else {
      const dmg = Math.max(1, Math.floor(opp.stats.hp / 8));
      s.oppHpPct = hpSub(s.oppHpPct, dmg, opp.stats.hp);
    }
  }

  // B2: Ghost-Curse residual — maxHP/4, min 1, on the cursed side
  // (src/battle_util.c:1581-1590). ENDTURN_CURSE sits after poison/burn in the
  // per-battler chain (:1450), which is where this block already is.
  if (s.yourHpPct > 0 && s.youCursed) {
    const d = Math.max(1, Math.floor(you.stats.hp / 4));
    s.yourHpPct = hpSub(s.yourHpPct, d, you.stats.hp);
  }
  if (s.oppHpPct > 0 && s.oppCursed) {
    const d = Math.max(1, Math.floor(opp.stats.hp / 4));
    s.oppHpPct = hpSub(s.oppHpPct, d, opp.stats.hp);
  }

  // B3 batch 5: ENDTURN_WRAP (src/battle_util.c:1592-1624), right after CURSE.
  // The counter drops FIRST; while it is still above 0 the wrapped mon takes
  // maxHP/16 (min 1), and the turn it reaches 0 it breaks free with no damage.
  // So a counter of n deals n-1 ticks. BattleScript_WrapTurnDmg sets
  // HITMARKER_IGNORE_BIDE like every residual (Bide never sees it).
  if (s.youWrapped && s.yourHpPct > 0) {
    const n = s.youWrapped.n - 1;
    if (n > 0) {
      s.youWrapped = { ...s.youWrapped, n };
      const d = Math.max(1, Math.floor(you.stats.hp / 16));
      s.yourHpPct = hpSub(s.yourHpPct, d, you.stats.hp);
    } else {
      s.youWrapped = null;
    }
  }
  if (s.oppWrapped && s.oppHpPct > 0) {
    const n = s.oppWrapped.n - 1;
    if (n > 0) {
      s.oppWrapped = { ...s.oppWrapped, n };
      const d = Math.max(1, Math.floor(opp.stats.hp / 16));
      s.oppHpPct = hpSub(s.oppHpPct, d, opp.stats.hp);
    } else {
      s.oppWrapped = null;
    }
  }

  // B2: Taunt decay. Cmd_settaunt sets 2; the timer decrements per end-of-turn
  // (ENDTURN_TAUNT, src/battle_util.c:1187) and the lock lifts at 0.
  for (const k of ["youTauntTurns", "oppTauntTurns"]) {
    if (s[k] != null) { s[k] -= 1; if (s[k] <= 0) s[k] = null; }
  }
  // B2b batch 9: the per-turn Magic Coat flag. Cleared here as well as at the
  // start of resolveTurn so that a stored state never carries a stale bounce.
  s.youBouncing = false;
  s.oppBouncing = false;

  // B2b batch 9: Mist's 5-turn side timer (src/battle_util.c:1277-1280,
  // ENDTURN_MIST -- it clears SIDE_STATUS_MIST when the counter reaches 0).
  for (const k of ["youMistTurns", "oppMistTurns"]) {
    if (s[k] != null) { s[k] -= 1; if (s[k] <= 0) s[k] = null; }
  }
  // B2b batch 10: Lock On's 2-turn window (src/battle_util.c:1739-1740 --
  // ENDTURN_LOCK_ON decrements it, so it covers the turn it was set and one
  // more).
  for (const k of ["youAlwaysHitTurns", "oppAlwaysHitTurns"]) {
    if (s[k] != null) { s[k] -= 1; if (s[k] <= 0) s[k] = null; }
  }

  // B2b batch 4: Nightmare, maxHP/4 per end-of-turn and ONLY while asleep --
  // source clears STATUS2_NIGHTMARE the moment the mon wakes, so a woken mon
  // must stop taking it rather than keep bleeding.
  for (const [flag, statusKey, hpKey, mon] of [
    ["youNightmared", "youStatus", "yourHpPct", you],
    ["oppNightmared", "oppStatus", "oppHpPct", opp],
  ]) {
    if (!s[flag]) continue;
    if (s[statusKey] !== "sleep") { s[flag] = false; continue; }
    if (s[hpKey] <= 0) continue;
    const d = Math.max(1, Math.floor(mon.stats.hp / 4));
    s[hpKey] = hpSub(s[hpKey], d, mon.stats.hp);
  }

  // B3 batch 4d: ENDTURN_UPROAR (src/battle_util.c:1625-1672), just before
  // THRASH. For an uproaring battler: first EVERY sleeping, non-Soundproof
  // battler wakes (the case returns effect 2 without advancing the tracker, so
  // it re-runs until nobody is left asleep); then the counter drops, and the
  // uproar is cancelled on WasUnableToUseMove or when the counter hits 0.
  if (s.youLock?.kind === "uproar" && s.yourHpPct > 0) endTurnUproar(s, "you", you, opp);
  if (s.oppLock?.kind === "uproar" && s.oppHpPct > 0) endTurnUproar(s, "opp", you, opp);

  // B3 batch 3: ENDTURN_THRASH (src/battle_util.c:1674-1695), between UPROAR
  // and DISABLE. The counter drops; a mon that was unable to use its move this
  // turn (WasUnableToUseMove) loses the lock outright; otherwise a counter that
  // reaches 0 ends the lock and the user confuses ITSELF -- SetMoveEffect(TRUE)
  // as a primary effect, so Safeguard does not stop it, but Own Tempo and an
  // existing confusion do.
  // Written out per side, not as a loop over [side, mon] pairs: this runs at
  // every node, and the pair array was a per-call allocation.
  if (s.youLock?.kind === "rampage" && s.yourHpPct > 0) endTurnThrash(s, "you", you);
  if (s.oppLock?.kind === "rampage" && s.oppHpPct > 0) endTurnThrash(s, "opp", opp);

  // B2b batch 2: Disable and Encore decay, each at its own ENDTURN slot
  // (ENDTURN_DISABLE src/battle_util.c:1696-1716, ENDTURN_ENCORE :1718-1735).
  // Both clear the locked move when the timer reaches 0.
  for (const [timerKey, moveKey] of [["youDisableTurns", "youDisabledMove"], ["oppDisableTurns", "oppDisabledMove"]]) {
    if (s[timerKey] == null) continue;
    s[timerKey] -= 1;
    if (s[timerKey] <= 0) { s[timerKey] = null; s[moveKey] = null; }
  }
  for (const [timerKey, moveKey] of [["youEncoreTurns", "youEncoredMove"], ["oppEncoreTurns", "oppEncoredMove"]]) {
    if (s[timerKey] == null) continue;
    s[timerKey] -= 1;
    if (s[timerKey] <= 0) { s[timerKey] = null; s[moveKey] = null; }
  }

  // Reflect/Light Screen duration: a SEPARATE end-of-turn tracker from the
  // per-battler ENDTURN_* one above (src/battle_util.c:1221-1264 —
  // ENDTURN_REFLECT/ENDTURN_LIGHT_SCREEN, ticks once per FULL turn, not per
  // battler). Decrements unconditionally whenever active, clearing at 0 —
  // no special-casing for "just set this turn" (matches the same literal
  // reading applied to Leech Seed's same-turn drain). Within this engine's
  // 3-turn match cap, a screen set on turn 1 (starting at 5) can never
  // reach 0 by turn 3 — natural expiry is untestable end-to-end here, only
  // via a direct low-level test that ticks the counter down manually.
  if (s.youReflectTurns != null && --s.youReflectTurns <= 0) s.youReflectTurns = null;
  if (s.oppReflectTurns != null && --s.oppReflectTurns <= 0) s.oppReflectTurns = null;
  if (s.youLightScreenTurns != null && --s.youLightScreenTurns <= 0) s.youLightScreenTurns = null;
  if (s.oppLightScreenTurns != null && --s.oppLightScreenTurns <= 0) s.oppLightScreenTurns = null;
  // Safeguard — same 5-turn side-status shape (src/battle_script_commands.c:8650-8668).
  if (s.youSafeguardTurns != null && --s.youSafeguardTurns <= 0) s.youSafeguardTurns = null;
  if (s.oppSafeguardTurns != null && --s.oppSafeguardTurns <= 0) s.oppSafeguardTurns = null;
  // Weather: decrements once per FULL turn (not per-side — it's a single
  // global condition), UNLESS permanent (weatherTurns stays null forever in
  // that case — src/battle_util.c:1340-1424, the `!(PERMANENT) && --counter`
  // short-circuit). Reaching 0 clears BOTH weatherType and weatherTurns.
  if (s.weatherType != null && s.weatherTurns != null && --s.weatherTurns <= 0) {
    s.weatherType = null;
    s.weatherTurns = null;
  }
  // Yawn: 2-turn drowsy counter (src/battle_util.c ENDTURN_YAWN, :1753-1771)
  // ticks down regardless of what else happens; when it reaches 0, the
  // target falls asleep for real IF it's still status-free and doesn't have
  // Insomnia/Vital Spirit at THAT moment (re-checked, not just at initial
  // use — a different status landing in between silently cancels the yawn).
  // The real duration re-roll ({2,3,4,5}) is genuinely inconsequential in
  // THIS engine's fixed 3-turn match — Yawn only ever completes at the end
  // of turn 2 (used turn 1), which uses up the match's very last turn
  // regardless of which value would've been rolled, and used on turn 2+ it
  // can never complete before the match ends at all — so a fixed
  // placeholder duration is used rather than fanning out a pointless branch
  // (same reasoning already applied to the direct sleep-duration enumeration
  // in enumerateActionOutcomes).
  if (s.youYawnTurns != null) {
    s.youYawnTurns--;
    if (s.youYawnTurns <= 0) {
      s.youYawnTurns = null;
      if (s.youStatus == null && you.ability !== "Insomnia" && you.ability !== "Vital Spirit" && !uproarKeepsAwake(s, you)) {
        s.youStatus = "sleep";
        s.youSleepTurns = 2;
        cancelMultiTurnMoves(s, "you"); // ENDTURN_YAWN calls it explicitly (src/battle_util.c:1761) -- not via SetMoveEffect, as batch 2's note said
      }
    }
  }
  if (s.oppYawnTurns != null) {
    s.oppYawnTurns--;
    if (s.oppYawnTurns <= 0) {
      s.oppYawnTurns = null;
      if (s.oppStatus == null && opp.ability !== "Insomnia" && opp.ability !== "Vital Spirit" && !uproarKeepsAwake(s, opp)) {
        s.oppStatus = "sleep";
        s.oppSleepTurns = 2;
        cancelMultiTurnMoves(s, "opp"); // ENDTURN_YAWN calls it explicitly (src/battle_util.c:1761) -- not via SetMoveEffect, as batch 2's note said
      }
    }
  }
}

// Enumerates every possible outcome of ONE actor using ONE move, as a list
// of { p, hit, selfHit, secondaryTriggered, statusPrevented, thawed }
// branches with probabilities summing to 1. This is the single place new
// branching sources get composed, instead of hand-nesting more for-loops in
// resolveTurn every time. Layering order matches real mechanics: major
// status (paralysis/freeze) prevention is checked first — if prevented,
// nothing else (confusion, accuracy) matters this turn; only if the mon
// gets to act at all do confusion/accuracy/secondary-effect branches apply.
// B2b batch 3: moves that CALL another move.
//
// Sleep Talk (Cmd_trychoosesleeptalkmove, src/battle_script_commands.c:8240-8275)
// picks uniformly at random among the user's own moves, after removing:
//   IsInvalidForSleepTalkOrAssist (:8209-8219) -- Sleep Talk, Assist,
//     Mirror Move, Metronome, and the empty slot
//   Focus Punch and Uproar, named individually
//   IsTwoTurnsMove (:8221-8233) -- Skull Bash, Razor Wind, Sky Attack,
//     Solar Beam, Semi-Invulnerable, Bide
// and THEN `CheckMoveLimitations(attacker, bits, ~MOVE_LIMITATION_PP)` -- the
// very function selectableMoves implements, reused here rather than re-derived.
// If every slot is unusable the move fails; otherwise the pick is uniform over
// the usable ones, which enumerates as 1/k weighted branches.
//
// The script (data/battle_scripts_1.s:1311-1316) fails the move outright unless
// the user is asleep.
// Cmd_metronome (src/battle_script_commands.c) picks uniformly over move IDs
// 1..MOVES_COUNT-1, retrying while the pick is in sMovesForbiddenToCopy (:725-745,
// scanned to METRONOME_FORBIDDEN_END). A retry loop over a uniform draw with
// rejection is just a uniform draw over the survivors, which is what this is.
const METRONOME_FORBIDDEN = new Set([
  "Metronome", "Struggle", "Sketch", "Mimic", "Counter", "Mirror Coat",
  "Protect", "Detect", "Endure", "Destiny Bond", "Sleep Talk", "Thief",
  "Follow Me", "Snatch", "Helping Hand", "Covet", "Trick", "Focus Punch",
]);
let _metronomePool = null;
function metronomePool() {
  if (!_metronomePool) _metronomePool = Object.keys(MOVES).filter((m) => !METRONOME_FORBIDDEN.has(m));
  return _metronomePool;
}

const SLEEP_TALK_EXCLUDED_MOVES = new Set(["Sleep Talk", "Assist", "Mirror Move", "Metronome", "Focus Punch", "Uproar"]);
const SLEEP_TALK_EXCLUDED_EFFECTS = new Set([
  "EFFECT_SKULL_BASH", "EFFECT_RAZOR_WIND", "EFFECT_SKY_ATTACK",
  "EFFECT_SOLAR_BEAM", "EFFECT_SEMI_INVULNERABLE", "EFFECT_BIDE",
]);

function sleepTalkCandidates(ctx, state, actor) {
  const isYou = actor === "you";
  const selfMon = isYou ? ctx.you : ctx.opp;
  const foeMon = isYou ? ctx.opp : ctx.you;
  const eligible = selfMon.moves.filter((m) => {
    const md = MOVES[m];
    if (!md) return false;
    if (SLEEP_TALK_EXCLUDED_MOVES.has(m)) return false;
    if (SLEEP_TALK_EXCLUDED_EFFECTS.has(md.effect)) return false;
    return true;
  });
  if (eligible.length === 0) return [];
  // The same limitations the selection filter applies, minus PP, which source
  // explicitly masks off here.
  try {
    return selectableMoves(eligible, state, actor, foeMon, `${actor} (via Sleep Talk)`);
  } catch {
    return []; // every candidate is limited out -> the move fails, as in source
  }
}

// ── B3 batch 2: THE CANCELER CHAIN, resolved ONCE, on the SELECTED move ──
// AtkCanceler_UnableToUseMove (src/battle_util.c:2003-2270) runs its checks in
// a fixed order and stops at the first one that fires:
//   ASLEEP -> FROZEN -> TRUANT -> RECHARGE -> FLINCH -> DISABLED -> TAUNTED ->
//   IMPRISONED -> CONFUSED -> PARALYZED -> IN_LOVE -> BIDE -> THAW
// and it runs ONCE per action. gBattleStruct->atkCancelerTracker is reset only
// in HandleAction_UseMove, so when Mirror Move, Metronome or Sleep Talk jumps
// into a called move's script, that script's own attackcanceler resumes at
// CANCELER_END and checks nothing.
//
// Before this batch the chain lived INSIDE the move body, AFTER a set of early
// returns (Mirror Move, Metronome, Sleep Talk, Magic Coat, Endeavor), and those
// returns skipped sleep and freeze entirely: a Mirror Move user asleep for three
// turns acted, and its sleep counter never ticked. Hoisting the chain in front
// of the body fixes every such return at once. It also gives the cancelers this
// engine never ported somewhere to live: FLINCH, and the CANCEL-time halves of
// Disable, Taunt and Imprison, which were enforced only at selection -- so a
// faster foe's Disable never stopped the move it had just disabled. Truant is
// ledgered for B8. Bide is ledgered (throws) for B3.
//
// Returns [{ p, outcome }] for an action that is cancelled (the outcome is
// final) or [{ p, pass: true, thawed, sleepRemaining }] for one that proceeds.
// The common case -- nothing in the chain can fire -- returned as ONE shared
// object, so the caller can skip the merge entirely. Measured: without this the
// hoist cost 12.4% over the Metagross column, spread evenly over sets carrying
// none of these mechanics, i.e. pure per-node allocation.
// B4d-pre: CONFUSION'S DURATION. Every source draws it the same way --
// STATUS2_CONFUSION_TURN((Random() % 4) + 2) for MOVE_EFFECT_CONFUSION
// (:2539), `(Random() & 3) + 2` for a rampage's end -- uniform over {2,3,4,5},
// and CANCELER_CONFUSED decrements it before testing. So the mon snaps out at
// its N-th check. Drawn LAZILY, which is exact because the counter is observed
// nowhere but here: at check j, given it is still confused,
// P(snap) = P(N = j) / P(N >= j). The state holds the next check's j: `true`
// for a fresh confusion (j = 1, so every infliction site and override is
// unchanged), then 2..5.
const CONFUSION_SNAP = [0, 0, 1 / 4, 1 / 3, 1 / 2, 1];
function confusionCheck(v) { return v === true ? 1 : v; }
function applyConfusionTick(s, side, tick) {
  const key = side === "you" ? "youConfused" : "oppConfused";
  if (!s[key]) return;
  s[key] = tick === "snap" ? false : confusionCheck(s[key]) + 1;
}

const PASS_GATE = Object.freeze([Object.freeze({ p: 1, pass: true, thawed: false, sleepRemaining: null })]);
function cancelerGates(ctx, state, actor, moveName, moveData) {
  {
    const isYou = actor === "you";
    const st = state[isYou ? "youStatus" : "oppStatus"];
    if (st !== "sleep" && st !== "freeze" && st !== "paralysis"
        && !state[isYou ? "youConfused" : "oppConfused"]
        && !state[isYou ? "youAttracted" : "oppAttracted"]
        && state[isYou ? "youLock" : "oppLock"]?.kind !== "bide"
        && !singleCauseCancel(ctx, state, actor, moveName, moveData)) return PASS_GATE;
  }

  const statusKey = actor === "you" ? "youStatus" : "oppStatus";
  const status = state[statusKey];

  // Paralysis is NOT handled in this outer switch (see below) — it moved
  // into the unified confusion/paralysis/love priority chain to match its
  // real position in the CANCELER_* sequence (a pre-existing ordering bug,
  // fixed alongside Attract — see the long comment further down).
  let statusBranches;
  if (status === "freeze") {
    if (moveData.effect === "EFFECT_THAW_HIT") {
      // B2b batch 6. A frozen user of Flame Wheel or Sacred Fire is NOT stopped:
      // CANCELER_FROZEN explicitly skips its own block for EFFECT_THAW_HIT
      // (src/battle_util.c:2064-2074, comment and all), and CANCELER_THAW then
      // unfreezes the user unconditionally (:2249-2258). So there is no 20%
      // roll here at all -- it acts, and it thaws, every time. One branch.
      statusBranches = [{ p: 1, prevented: false, thawed: true }];
    } else {
      // Random() % 5 == 0 → 20% thaw (then acts normally), else stays frozen
      // and fully prevented. Re-rolled every turn (no duration counter).
      statusBranches = [{ p: 0.2, prevented: false, thawed: true }, { p: 0.8, prevented: true, thawed: false }];
    }
  } else if (status === "sleep") {
    // Duration was rolled ONCE at infliction (state.<x>SleepTurns) — NOT
    // re-rolled every turn like paralysis/freeze above. Decrement happens
    // here, at the start of the sleeping mon's own action attempt
    // (src/battle_util.c CANCELER_ASLEEP, :2029-2038). Early Bird doubles
    // the decrement (2/turn instead of 1, :2030-2033).
    //
    // B3 batch 4a: A MON THAT WAKES UP ACTS THAT SAME TURN. This comment used
    // to say the opposite -- that BattleScript_MoveUsedWokeUp was "not a
    // fallthrough into the chosen move". It is one: the waking branch calls
    // BattleScriptPushCursor() first (:2049), and BattleScript_MoveUsedWokeUp
    // ends in `return` (data/battle_scripts_1.s:3723-3728), which pops back to
    // the same attackcanceler; the chain then resumes at the canceler AFTER
    // ASLEEP. Only the STILL-asleep branch ends the action (MoveUsedIsAsleep,
    // with HITMARKER_UNABLE_TO_USE_MOVE, :2040-2045). So a 2-turn sleep, an
    // Early Bird, or any counter that reaches 0 had been costing one turn too
    // many.
    const mon = actor === "you" ? ctx.you : ctx.opp;
    const turnsKey = actor === "you" ? "youSleepTurns" : "oppSleepTurns";
    const toSub = mon.ability === "Early Bird" ? 2 : 1;
    // B3 batch 4d: an uproar wakes the sleeper outright (UproarWakeUpCheck,
    // src/battle_util.c:2017-2025), no decrement -- and with the same
    // BattleScriptPushCursor, so it acts (batch 4a).
    const sleepRemaining = uproarKeepsAwake(state, mon) ? 0 : Math.max(0, state[turnsKey] - toSub);
    // B2b batch 3: Snore and Sleep Talk are EXEMPT from the sleep lock while
    // the mon is still asleep -- source gates the "can't move" on
    // `gCurrentMove != MOVE_SNORE && gCurrentMove != MOVE_SLEEP_TALK`
    // (:2040). A mon that wakes up is simply awake, and uses its move.
    const sleepExempt = sleepRemaining > 0
      && (moveData.effect === "EFFECT_SLEEP_TALK" || moveData.effect === "EFFECT_SNORE");
    statusBranches = [{ p: 1, prevented: sleepRemaining > 0 && !sleepExempt, thawed: false, sleepRemaining }];
  } else {
    statusBranches = [{ p: 1, prevented: false, thawed: false }];
  }

  const gates = [];
  for (const stb of statusBranches) {
    if (stb.prevented) {
      gates.push({ p: stb.p, outcome: { hit: null, selfHit: false, secondaryTriggered: false, statusPrevented: true, thawed: false, sleepRemaining: stb.sleepRemaining ?? null } });
      continue;
    }
    // Carried onto every outcome below: a thaw or a sleep-counter tick has
    // already happened by the time any later canceler fires.
    const carryBase = { thawed: stb.thawed, sleepRemaining: stb.sleepRemaining ?? null };
    const carry = carryBase;

    // RECHARGE -> FLINCH -> DISABLED -> TAUNTED -> IMPRISONED. Each is decided
    // by state alone, and each ends the chain.
    const cause = singleCauseCancel(ctx, state, actor, moveName, moveData);
    if (cause) {
      gates.push({ p: stb.p, outcome: { hit: null, selfHit: false, secondaryTriggered: false, statusPrevented: true, cancelReason: cause, ...carry } });
      continue;
    }

    // Real priority chain (src/battle_util.c AtkCanceler_UnableToUseMove:
    // CANCELER_CONFUSED -> CANCELER_PARALYZED -> CANCELER_IN_LOVE). The
    // do-while loop there stops at the FIRST canceler that reports
    // effect=1, so at most ONE of these three ever fires per turn — they
    // are NOT independent rolls. Confusion is special: BOTH of its own
    // outcomes (self-hit AND "acts normally this turn") set effect=1, so
    // being confused means paralysis/love are never even ROLLED that turn,
    // regardless of which way the confusion coin flip goes. Paralysis and
    // love, by contrast, only short-circuit on their OWN "prevented"
    // outcome — their "you're fine, go ahead" outcome falls through to the
    // next check in line (confirmed: CANCELER_PARALYZED only sets effect=1
    // inside the branch that includes its own 25% roll succeeding).
    // Previously this engine modeled paralysis as the OUTER gate ahead of
    // confusion (backwards from source) — a pre-existing bug caught while
    // wiring Attract in, since Attract's own prevention has to slot into
    // this exact same chain as the third/last check.
    const confusable = actor === "you" ? state.youConfused : state.oppConfused; // A5: both sides
    const paralyzed = status === "paralysis";
    const attracted = actor === "you" ? state.youAttracted : state.oppAttracted; // A5: both sides

    // Phase D F33: the paragraph above is wrong about confusion. Its two
    // non-self-hit outcomes -- "acts anyway" (Random() & 1) and snapping out --
    // call BattleScriptPushCursor() (src/battle_util.c:2166-2168, :2181), so the
    // confusion script RETURNS into the move's attackcanceler, which re-enters
    // AtkCanceler_UnableToUseMove with atkCancelerTracker already past
    // CANCELER_CONFUSED (it steps past at :2186 and is reset only per action, :92): paralysis and love ARE
    // rolled next. Only the self-hit ends the chain. Emulator: traces/00395, a
    // confused, paralysed Suicune fully paralysed in the ROM.
    const paraLoveSplit = (branches) => {
      let out = branches;
      if (paralyzed) {
        out = out.flatMap((b) => (b.kind !== "normal" ? [b]
          : [{ ...b, p: b.p * 0.25, kind: "paraBlocked" }, { ...b, p: b.p * 0.75 }]));
      }
      if (attracted) {
        out = out.flatMap((b) => (b.kind !== "normal" ? [b]
          : [{ ...b, p: b.p * 0.5, kind: "loveBlocked" }, { ...b, p: b.p * 0.5 }]));
      }
      return out;
    };
    let actionBranches;
    if (confusable) {
      // B4d-pre: CANCELER_CONFUSED (src/battle_util.c:2156-2187) DECREMENTS the
      // 2-5 counter first. A counter that reaches 0 SNAPS OUT and the mon acts;
      // otherwise the 50% self-hit. Either way effect = 1, so paralysis and
      // love are not rolled. The duration is drawn lazily here -- see
      // CONFUSION_SNAP -- and `confTick` carries the counter update to the
      // action (resolveTurnWithOrder applies it).
      const pSnap = CONFUSION_SNAP[confusionCheck(confusable)];
      actionBranches = [];
      if (pSnap > 0) actionBranches.push({ p: pSnap, kind: "normal", confTick: "snap" });
      if (pSnap < 1) {
        actionBranches.push({ p: (1 - pSnap) / 2, kind: "confuseSelfHit", confTick: "tick" });
        actionBranches.push({ p: (1 - pSnap) / 2, kind: "normal", confTick: "tick" });
      }
      actionBranches = paraLoveSplit(actionBranches); // F33
    } else {
      actionBranches = [{ p: 1, kind: "normal" }];
      if (paralyzed) {
        actionBranches = [{ p: 0.25, kind: "paraBlocked" }, { p: 0.75, kind: "normal" }];
      }
      if (attracted) {
        const next = [];
        for (const b of actionBranches) {
          if (b.kind !== "normal") { next.push(b); continue; }
          next.push({ p: b.p * 0.5, kind: "loveBlocked" });
          next.push({ p: b.p * 0.5, kind: "normal" });
        }
        actionBranches = next;
      }
    }

    for (const acb of actionBranches) {
      const p = stb.p * acb.p;
      const carry = acb.confTick ? { ...carryBase, confTick: acb.confTick } : carryBase;
      if (acb.kind === "confuseSelfHit") {
        // F19: adjustnormaldamage2 rolls the mon's OWN Focus Band against a
        // lethal self-hit, unless it is behind a Substitute
        // (src/battle_script_commands.c:1718-1727). The confusion tick has
        // already run, so it is applied to a probe copy before measuring.
        const fbItem = itemData((actor === "you" ? ctx.you : ctx.opp).item);
        // F31: in exact-roll mode the self-hit's adjustnormaldamage2 roll is
        // drawn here, and the Focus Band check uses each roll's damage.
        for (const [pr, roll] of ctx.exactRoll ? ROLL_VALUES.map((v) => [1 / 16, v]) : [[1, null]]) {
          const selfHitOutcome = { hit: null, selfHit: true, secondaryTriggered: false, statusPrevented: false, ...carry, ...(roll != null ? { roll } : {}) };
          let banded = false;
          if (fbItem && fbItem.holdEffect === "HOLD_EFFECT_FOCUS_BAND"
              && state[actor === "you" ? "youSubstituteHP" : "oppSubstituteHP"] == null) {
            const probe = cloneState(state);
            if (carry.confTick) applyConfusionTick(probe, actor, carry.confTick);
            const selfMonP = actor === "you" ? ctx.you : ctx.opp;
            const hpNow = Math.round(((actor === "you" ? probe.yourHpPct : probe.oppHpPct) / 100) * selfMonP.stats.hp);
            banded = confusionSelfHitDamage(roll != null ? { ...ctx, rollPercent: roll } : ctx, probe, actor) >= hpNow;
          }
          if (banded) {
            const pb = fbItem.param / FOCUS_BAND_SPACE;
            gates.push({ p: p * pr * pb, outcome: { ...selfHitOutcome, focusBanded: true } });
            gates.push({ p: p * pr * (1 - pb), outcome: { ...selfHitOutcome, focusBanded: false } });
          } else {
            gates.push({ p: p * pr, outcome: selfHitOutcome });
          }
        }
      } else if (acb.kind === "paraBlocked") {
        gates.push({ p, outcome: { hit: null, selfHit: false, secondaryTriggered: false, statusPrevented: true, ...carry } });
      } else if (acb.kind === "loveBlocked") {
        gates.push({ p, outcome: { hit: null, selfHit: false, secondaryTriggered: false, statusPrevented: false, attractPrevented: true, ...carry } });
      } else if (state[actor === "you" ? "youLock" : "oppLock"]?.kind === "bide"
                 && state[actor === "you" ? "youLock" : "oppLock"].n > 1) {
        // B3 batch 4c: CANCELER_BIDE (src/battle_util.c:2220-2249), AFTER
        // confusion, paralysis and love. Counter 2 -> 1: still storing, so the
        // action is BattleScript_BideStoringEnergy -- a spent turn that is not a
        // cancel (no CancelMultiTurnMoves) and scores no Skill (attackcanceler
        // returned before HITMARKER_OBEYS). At 1 -> 0 it passes to the body and
        // unleashes.
        gates.push({ p, outcome: { hit: null, selfHit: false, secondaryTriggered: false, statusPrevented: true, cancelReason: "bideStore", ...carry } });
      } else {
        gates.push({ p, pass: true, ...carry });
      }
    }
  }
  return gates;
}

// The five single-cause cancelers between FROZEN and CONFUSED, in source order.
function singleCauseCancel(ctx, state, actor, moveName, moveData) {
  const isYou = actor === "you";
  // B8c: CANCELER_TRUANT (src/battle_util.c:2086-2097), between FROZEN and
  // RECHARGE: a Truant mon with its counter set loafs -- the turn is lost and
  // multi-turn moves are cancelled.
  if ((isYou ? ctx.you : ctx.opp).ability === "Truant" && vf(state, isYou ? "youTruantLoaf" : "oppTruantLoaf")) return "truant";
  // CANCELER_RECHARGE (src/battle_util.c:2098-2108).
  if (state[isYou ? "youRecharge" : "oppRecharge"]) return "recharge";
  // CANCELER_FLINCH (:2110-2120). Set by the foe's hit earlier this same turn.
  if (state.turnFlags & (isYou ? TF_YOU_FLINCHED : TF_OPP_FLINCHED)) return "flinch";
  // CANCELER_DISABLED (:2122-2132): disabledMove == gCurrentMove. Reachable
  // only when a FASTER foe disabled the move after it was selected.
  const disabled = state[isYou ? "youDisabledMove" : "oppDisabledMove"];
  if (disabled && disabled === moveName) return "disabled";
  // CANCELER_TAUNTED (:2134-2143): tauntTimer && power == 0 -- the same test
  // selectableMoves applies at selection, now also at the moment of use.
  if (state[isYou ? "youTauntTurns" : "oppTauntTurns"] != null && moveData.power === 0) return "taunted";
  // CANCELER_IMPRISONED (:2145-2154): GetImprisonedMovesCount walks the FOE's
  // moveset, and the foe holds the flag.
  const foeMon = isYou ? ctx.opp : ctx.you;
  if (state[isYou ? "oppImprisoning" : "youImprisoning"] && foeMon.moves.includes(moveName)) return "imprisoned";
  return null;
}

// B3 batch 3: MOVE_EFFECT_THRASH draws the lock length (Random() & 1) + 2 --
// 2 or 3, equally -- on a Rampage move's first LANDED hit. Split every hit
// outcome of an unlocked Rampage move in two; applyMove only reads the length
// when the hit actually affected the target. Applied to CALLED moves too: a
// Metronome that draws Thrash locks into Thrash (gLockedMoves = gCurrentMove).
// B3 batch 4d: and MOVE_EFFECT_UPROAR draws (Random() & 3) + 2 -- 2 to 5,
// equally -- the same way, for an Uproar that is not already running.
const LOCK_DRAWS = { EFFECT_RAMPAGE: ["rampage", [2, 3]], EFFECT_UPROAR: ["uproar", [2, 3, 4, 5]] };
function rampageSplit(state, actor, moveData, outs) {
  // B3 batch 5: MOVE_EFFECT_WRAP draws (Random() & 3) + 3 -- 3 to 6, equally
  // -- for a TARGET not already wrapped. It rides the same split; applyMove
  // reads the length only when the wrap actually lands.
  if (moveData.effect === "EFFECT_TRAP") {
    if (state[actor === "you" ? "oppWrapped" : "youWrapped"]) return outs;
    const split = [];
    for (const o of outs) {
      if (o.hit !== true) { split.push(o); continue; }
      for (const n of [3, 4, 5, 6]) split.push({ ...o, p: o.p * 0.25, lockTurns: n });
    }
    return split;
  }
  const draw = LOCK_DRAWS[moveData.effect];
  if (!draw || state[actor === "you" ? "youLock" : "oppLock"]?.kind === draw[0]) return outs;
  const share = 1 / draw[1].length;
  const split = [];
  for (const o of outs) {
    if (o.hit !== true) { split.push(o); continue; }
    for (const n of draw[1]) split.push({ ...o, p: o.p * share, lockTurns: n });
  }
  return split;
}

function enumerateActionOutcomes(ctx, state, actor, moveName, moveData, targetCharging, isLastToAct = false, skipStatusGates = false) {
  // A CALLED move (Mirror Move, Metronome, Sleep Talk) inherits its caller's
  // canceler result and runs no chain of its own -- see cancelerGates.
  if (skipStatusGates) return rampageSplit(state, actor, moveData, enumerateMoveBody(ctx, state, actor, moveName, moveData, targetCharging, isLastToAct, true));
  const gates = cancelerGates(ctx, state, actor, moveName, moveData);
  if (gates === PASS_GATE) return rampageSplit(state, actor, moveData, enumerateMoveBody(ctx, state, actor, moveName, moveData, targetCharging, isLastToAct, false));
  const out = [];
  for (const g of gates) {
    if (g.outcome) { out.push({ ...g.outcome, p: g.p }); continue; }
    for (const o of rampageSplit(state, actor, moveData, enumerateMoveBody(ctx, state, actor, moveName, moveData, targetCharging, isLastToAct, false))) {
      out.push({ ...o, p: o.p * g.p, thawed: g.thawed || o.thawed, sleepRemaining: o.sleepRemaining ?? g.sleepRemaining, confTick: g.confTick });
    }
  }
  return out;
}

function enumerateMoveBody(ctx, state, actor, moveName, moveData, targetCharging, isLastToAct = false, skipStatusGates = false) {
  if (moveData.effect === "EFFECT_MIRROR_MOVE" && !skipStatusGates) {
    // Deterministic: whatever was last used AGAINST this mon, if anything.
    const taken = state[actor === "you" ? "youLastTakenMove" : "oppLastTakenMove"];
    if (taken && MOVES[taken]) {
      return enumerateActionOutcomes(ctx, state, actor, taken, battleMoveData(actor === "you" ? ctx.you : ctx.opp, taken), targetCharging, isLastToAct, true)
        .map((o) => ({ ...o, calledMove: taken }));
    }
    // Nothing to mirror: resolves as itself and fails.
  }
  if (moveData.effect === "EFFECT_METRONOME" && !skipStatusGates) {
    // MODELLED EXACTLY, not approximated: a uniform draw over every non-
    // forbidden move in the dex. That reaches effects this engine has not
    // ported yet, and those cells THROW with the called move named -- which is
    // the agreed steady state, not a defect. See the Metronome ledger entry in
    // arena-solver/docs/phase-b-log.md; the throwing count shrinks as effects
    // land, and reaches zero when effect coverage reaches the called-move
    // universe.
    const pool = metronomePool();
    const share = 1 / pool.length;
    const out = [];
    for (const called of pool) {
      for (const o of enumerateActionOutcomes(ctx, state, actor, called, battleMoveData(actor === "you" ? ctx.you : ctx.opp, called), targetCharging, isLastToAct, true)) {
        out.push({ ...o, p: o.p * share, calledMove: called });
      }
    }
    return out;
  }
  if (moveData.effect === "EFFECT_TRANSFORM") {
    // B3 batch 7d: BattleScript_EffectTransform (data/battle_scripts_1.s:947-956)
    // has no accuracycheck and the move's flags are 0 -- one branch.
    return [{ p: 1, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: false }];
  }
  if (moveData.effect === "EFFECT_MIMIC") {
    // B3 batch 7c: `accuracycheck ..., NO_ACC_CALC_CHECK_LOCK_ON` (src/
    // battle_script_commands.c:1103-1110): no accuracy roll at all. A Lock-On
    // lands it; a semi-invulnerable target makes it fail; and its Protect check
    // is JumpIfMoveAffectedByProtect(0) -- move 0's flags, which are empty -- so
    // Protect NEVER stops Mimic.
    const tgtCharging = state[actor === "you" ? "oppCharging" : "youCharging"];
    const lockedOn = state[actor === "you" ? "oppAlwaysHitTurns" : "youAlwaysHitTurns"] != null;
    const hitIt = lockedOn || !tgtCharging?.invulnBit;
    return [{ p: 1, hit: hitIt, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: false }];
  }
  if (moveData.effect === "EFFECT_FUTURE_SIGHT") {
    // B3 batch 5b: BattleScript_EffectFutureSight (data/battle_scripts_1.s:
    // 1881-1889) has no accuracycheck -- the accuracy check comes at RELEASE --
    // and the move's flags are 0, so Protect does not stop it either.
    return [{ p: 1, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: false }];
  }
  if (moveData.effect === "EFFECT_BIDE" && state[actor === "you" ? "youLock" : "oppLock"]?.kind !== "bide") {
    // B3 batch 4c: Bide's SET turn has no accuracycheck and no Protect check
    // that applies (IsTwoTurnsMove + no MULTIPLETURNS yet, src/
    // battle_script_commands.c:992-996). One branch.
    return [{ p: 1, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: false }];
  }
  if (moveData.effect === "EFFECT_MAGIC_COAT" && isLastToAct) {
    // Cmd_trysetmagiccoat (src/battle_script_commands.c:9085-9098) fails when
    // `gCurrentTurnActionNumber == gBattlersCount - 1` -- the user is the last
    // battler to act this turn, so there is nothing left to bounce. In singles
    // that is exactly "moves second", which only the enumerator knows, so the
    // failure is decided here rather than in the executor.
    return [{ p: 1, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: false, variablePower: "failed" }];
  }
  if (moveData.effect === "EFFECT_ENDEAVOR") {
    // BattleScript_EffectEndeavor (data/battle_scripts_1.s:3684-3695) runs
    // `setdamagetohealthdifference BattleScript_ButItFailed` BEFORE
    // `accuracycheck`, so a target that is not above the user makes the move
    // FAIL -- it does not miss, and no accuracy branch is taken at all. Order
    // matters here because "failed" and "missed" are different Skill outcomes,
    // so this cannot be left to applyMove after the accuracy split.
    const isYou = actor === "you";
    const selfMon = isYou ? ctx.you : ctx.opp;
    const foeMon = isYou ? ctx.opp : ctx.you;
    const selfHp = Math.round(((isYou ? state.yourHpPct : state.oppHpPct) / 100) * selfMon.stats.hp);
    const foeHp = Math.round(((isYou ? state.oppHpPct : state.yourHpPct) / 100) * foeMon.stats.hp);
    if (foeHp <= selfHp) {
      return [{ p: 1, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: false, variablePower: "failed" }];
    }
  }
  if (moveData.effect === "EFFECT_SLEEP_TALK" && !skipStatusGates) {
    const statusNow = state[actor === "you" ? "youStatus" : "oppStatus"];
    if (statusNow === "sleep") {
      // CANCELER_ASLEEP (src/battle_util.c:2015-2053) in order: DECREMENT
      // first, then decide. Only a mon that is STILL asleep afterwards gets
      // the Snore / Sleep Talk exemption from the lock. B3 batch 4a: a mon that
      // WAKES UP is awake by the time Sleep Talk's script runs, so the script's
      // own sleep check (data/battle_scripts_1.s:1311-1316) fails it -- it used
      // to be modelled as a forfeited turn, which is a different Skill result.
      const mon = actor === "you" ? ctx.you : ctx.opp;
      const turnsKey = actor === "you" ? "youSleepTurns" : "oppSleepTurns";
      const toSub = mon.ability === "Early Bird" ? 2 : 1;
      const sleepRemaining = uproarKeepsAwake(state, mon) ? 0 : Math.max(0, state[turnsKey] - toSub);
      if (sleepRemaining === 0) {
        return [{ p: 1, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: false, sleepRemaining }];
      }
      const candidates = sleepTalkCandidates(ctx, state, actor);
      if (candidates.length > 0) {
        // Each candidate is equally likely, and each then resolves with its OWN
        // accuracy roll and secondary chance -- the called move's whole outcome
        // tree, not just its name. The status gates are SKIPPED on the recursion
        // because they were just resolved here, for the Sleep Talk action.
        const out = [];
        const share = 1 / candidates.length;
        for (const called of candidates) {
          for (const o of enumerateActionOutcomes(ctx, state, actor, called, battleMoveData(actor === "you" ? ctx.you : ctx.opp, called), targetCharging, isLastToAct, true)) {
            out.push({ ...o, p: o.p * share, calledMove: called, sleepRemaining });
          }
        }
        return out;
      }
      // Still asleep but nothing callable: resolves as itself and fails, while
      // the counter it just ticked still has to be written back.
      return [{ p: 1, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: false, sleepRemaining }];
    }
    // Awake: falls through and resolves as itself, which fails (the script's
    // own sleep gate, data/battle_scripts_1.s:1311-1316).
  }
  // B3 batch 2: the canceler chain that used to start here now runs in
  // cancelerGates(), in front of this body, exactly once per action. What is
  // left is the move itself, so both branch lists are single pass-through
  // entries; the loop shape is kept so the per-move code beneath is unchanged.
  const statusBranches = [{ p: 1, thawed: false }];
  const results = [];
  for (const stb of statusBranches) {
    const actionBranches = [{ p: 1, kind: "normal" }];
    for (const acb of actionBranches) {
      const p = stb.p * acb.p;
      if (moveData.effect === "EFFECT_ENDURE" || moveData.effect === "EFFECT_PROTECT") {
        // Endure AND Protect/Detect share the EXACT SAME success-rate roll —
        // both funnel through Cmd_setprotectlike (src/battle_script_commands.c:6503-6536),
        // never a normal accuracy check. Two things verified from source,
        // not assumed: (1) it's genuinely the same shared decay counter
        // (protectUses resets to 0 if the LAST move wasn't Protect/Detect/
        // Endure); (2) an UNCONDITIONAL extra fail condition — the move
        // ALWAYS fails, regardless of the decay roll, if the user is the
        // LAST to act this turn (gCurrentTurnActionNumber == gBattlersCount-1,
        // "notLastTurn" gate, :6511-6514). This barely ever matters in
        // practice since Protect/Detect/Endure all carry priority 3 in this
        // engine's move data — whoever uses one almost always acts FIRST —
        // but it's a real, correct constraint for the rare case where BOTH
        // sides use a priority-3+ move in the same turn and this one loses
        // the speed tiebreak. NOT previously implemented for Endure either
        // (a real pre-existing gap, caught while verifying Protect shares
        // the mechanic).
        const usesKey = actor === "you" ? "youProtectUses" : "oppProtectUses";
        const successRates = [1, 0.5, 0.25, 0.125];
        const rate = isLastToAct ? 0 : successRates[Math.min(state[usesKey], successRates.length - 1)];
        const triggerFlag = moveData.effect === "EFFECT_ENDURE" ? "endureTriggered" : "protectTriggered";
        if (rate > 0) {
          results.push({ p: p * rate, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, [triggerFlag]: true });
        }
        if (rate < 1) {
          results.push({ p: p * (1 - rate), hit: false, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, [triggerFlag]: false });
        }
        continue;
      }

      // Protect/Detect blocking: checked BEFORE any accuracy roll (source
      // gates this in Cmd_attackcanceler, which runs before Cmd_accuracycheck
      // entirely — a protect-blocked move never rolls for accuracy at all).
      // Gated on the move actually carrying FLAG_PROTECT_AFFECTED (most do;
      // notable exceptions confirmed in this engine's own move data — e.g.
      // Perish Song does NOT carry it, matching real mechanics). Does not
      // special-case the Ghost-Curse-bypasses-protect exception (Curse's
      // Ghost branch already throws as unmodeled) or the semi-invulnerable
      // charge-turn exception (moot — that branch below already exits before
      // reaching this check, so this only ever runs on a real attack attempt).
      //
      // Phase D F38: and only when the protected battler IS the move's target,
      // on a turn the move actually strikes. DEFENDER_IS_PROTECTED reads
      // gBattlerTarget (src/battle_script_commands.c:57), which for a
      // MOVE_TARGET_USER move is the user itself (GetMoveTarget,
      // src/battle_util.c:3902-3905): Haze, Milk Drink, Hail, Wish, Imprison,
      // Grudge go through. And the attackcanceler exempts a two-turn move's
      // charging turn (:992-994, IsTwoTurnsMove :8196-8207); its strike --
      // or SolarBeam in sun, which never charges -- is stopped at accuracycheck.
      // Bide is MOVE_TARGET_USER too, but its UNLEASH retargets: CANCELER_BIDE
      // sets gBattlerTarget = gBideTarget (src/battle_util.c:2236) before the
      // check, with STATUS2_MULTIPLETURNS set (Cmd_setbide, :7123) -- so the
      // unleash is blocked. (Its storing turns stop at CANCELER_BIDE and never
      // get here; its set turn targets the user.)
      const foeProtectedKey = actor === "you" ? "oppProtected" : "youProtected";
      const chargingTurn = !state[actor === "you" ? "youCharging" : "oppCharging"]
        && (moveData.effect === "EFFECT_SEMI_INVULNERABLE" || chargeTurnRequired(moveData, effectiveWeather(state, ctx.you, ctx.opp)));
      const bideUnleashing = moveData.effect === "EFFECT_BIDE" && state[actor === "you" ? "youLock" : "oppLock"]?.kind === "bide";
      const targetsSelf = moveTarget(moveName) === "MOVE_TARGET_USER" && !bideUnleashing;
      if (state[foeProtectedKey] && moveData.flags.includes("FLAG_PROTECT_AFFECTED") && !targetsSelf && !chargingTurn) {
        results.push({ p: p, hit: false, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, blockedByProtect: true });
        continue;
      }

      const alreadyCharging = state[actor === "you" ? "youCharging" : "oppCharging"];
      if (chargeTurnRequired(moveData, effectiveWeather(state, ctx.you, ctx.opp)) && !alreadyCharging) {
        // B2b batch 7. Same as the semi-invulnerable case below: source's
        // charge turn has no accuracy check at all.
        results.push({ p: p, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, endureTriggered: false });
        continue;
      }
      if (moveData.effect === "EFFECT_SEMI_INVULNERABLE" && !alreadyCharging) {
        // Charge-initiation turn: no accuracy check at all in source — always
        // "succeeds" in starting the charge (barring the status-prevention
        // already handled above).
        results.push({ p: p, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, endureTriggered: false });
        continue;
      }

      const attackerAccStage = (actor === "you" ? state.youStages : state.oppStages).accuracy;
      // B2b: Foresight (src/battle_script_commands.c:1127-1131) -- when the
      // TARGET is foresighted the accuracy calc uses the attacker's accuracy
      // stage ALONE; the target's evasion stage is dropped from the comparison
      // entirely (source literally assigns buff = acc in that branch).
      const targetForesightedForAcc = actor === "you" ? state.oppForesighted : state.youForesighted;
      const targetEvasionStage = targetForesightedForAcc
        ? 0 : (actor === "you" ? state.oppStages : state.youStages).evasion;
      const foeMonForAcc = actor === "you" ? ctx.opp : ctx.you;
      // Resolved ONCE per action rather than once per accuracy evaluation.
      const foeItemForAcc = itemData(foeMonForAcc.item);
      const selfMonForAcc = actor === "you" ? ctx.you : ctx.opp;
      const weatherForAcc = effectiveWeather(state, ctx.you, ctx.opp);

      const accBranches = (() => {
        // Target invulnerable (mid-charge on Dive/Fly/Dig/Bounce) and this
        // move doesn't bypass it: forced miss, no accuracy roll at all
        // (source-confirmed — MOVE_RESULT_MISSED set unconditionally,
        // scored as a normal -2 miss, NOT the Protect exemption).
        // B3 batch 2: only a charge that IS semi-invulnerable. SolarBeam, Skull
        // Bash, Razor Wind and Sky Attack also leave `xCharging` set, with
        // invulnBit null -- they set STATUS2_MULTIPLETURNS but no STATUS3
        // semi-invulnerable bit (only EFFECT_SEMI_INVULNERABLE's
        // Cmd_setsemiinvulnerablebit does), so AccuracyCalcHelper's ON_AIR /
        // UNDERGROUND / UNDERWATER test cannot fire against them. This gate
        // used to test `targetCharging` alone, so every such charger was
        // unhittable for its charge turn.
        // Phase D F23: and not only a move with power -- any move whose script
        // runs accuracycheck (acc-check.js, generated) misses there: both the
        // ACC_CURR_MOVE and the NO_ACC_CALC branches send an invulnerable target
        // to the miss path (src/battle_script_commands.c:1054-1111). Sweet Scent
        // into Fly used to land.
        if ((moveData.power > 0 || EFFECT_ACCURACY_CHECK[moveData.effect] != null)
            && targetCharging?.invulnBit && !INVULN_BYPASS[targetCharging.invulnBit]?.[moveName]) {
          return [{ p: 1, hit: false }];
        }
        // EFFECT_OHKO (Horn Drill/Fissure/Guillotine/Sheer Cold): Cmd_tryKO
        // (src/battle_script_commands.c:7490-7574) completely bypasses the
        // normal accuracy/evasion-stage system below — AccuracyCalcHelper is
        // never called for this effect (confirmed via the move's own
        // BattleScript_EffectOHKO, which routes through accuracycheck's
        // NO_ACC_CALC_CHECK_LOCK_ON branch: only a Protect/semi-invulnerable
        // gate, no real roll there). Sturdy blocks the move OUTRIGHT in Gen
        // III (unconditional, not the modern "only at full HP" version) —
        // checked first in source, before the roll is even computed. The
        // real roll: chance% = move's own accuracy (30 for all 4 moves) +
        // (attacker level - target level), hit if Random()%100+1 < chance —
        // i.e. P(hit) = clamp((chance-1)/100, 0, 1) — AND an explicit extra
        // AND-condition that makes the move fail OUTRIGHT whenever the
        // attacker's level is LOWER than the target's, regardless of the
        // roll (both branches of the source if/else repeat this same check).
        if (moveData.effect === "EFFECT_OHKO") {
          if (foeMonForAcc.ability === "Sturdy") return [{ p: 1, hit: false }];
          if (selfMonForAcc.level < foeMonForAcc.level) return [{ p: 1, hit: false }];
          const chance = moveData.accuracy + (selfMonForAcc.level - foeMonForAcc.level);
          const pHit = Math.max(0, Math.min(1, (chance - 1) / 100));
          return pHit > 0 ? [{ p: pHit, hit: true }, { p: 1 - pHit, hit: false }] : [{ p: 1, hit: false }];
        }
        // Thunder's weather interaction (src/battle_script_commands.c:1089-1094,
        // :1146-1147): Rain makes it bypass the accuracy check entirely (same
        // treatment as EFFECT_ALWAYS_HIT); Sun forces its BASE accuracy to
        // exactly 50 (overriding the move's own 70) — stage modifiers still
        // apply normally on top of that, it's not a hard 50% floor.
        let baseAccuracy = moveData.accuracy;
        if (moveData.effect === "EFFECT_THUNDER") {
          if (weatherForAcc === "rain") baseAccuracy = null;
          else if (weatherForAcc === "sun") baseAccuracy = 50;
        }
        // accuracy === null means "always hits" (e.g. Faint Attack, Swift) —
        // these bypass the accuracy check ENTIRELY, including evasion.
        if (baseAccuracy === null) return [{ p: 1, hit: true }];
        // B2b batch 10: LOCK ON. Cmd_accuracycheck (:1056-1060) returns a
        // guaranteed hit while the TARGET carries STATUS3_ALWAYS_HITS from this
        // attacker -- checked BEFORE the accuracy chain, so evasion, Sand Veil
        // and BrightPowder are all skipped, not merely outweighed.
        if (state[actor === "you" ? "oppAlwaysHitTurns" : "youAlwaysHitTurns"] != null) {
          return [{ p: 1, hit: true }];
        }
        // B7c: one call, whole chain, uncapped -- Sand Veil is inside it now
        // rather than multiplied onto an already-capped number here.
        const effAcc = accuracyCalc(baseAccuracy, attackerAccStage, targetEvasionStage,
          selfMonForAcc.ability, foeMonForAcc.ability, foeItemForAcc,
          weatherForAcc, moveData.category === "physical");
        return effAcc < 100
          ? [{ p: effAcc / 100, hit: true }, { p: 1 - effAcc / 100, hit: false }]
          : [{ p: 1, hit: true }];
      })();

      for (const ab of accBranches) {
        if (!ab.hit) {
          results.push({ p: p * ab.p, hit: false, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed });
          continue;
        }
        if (moveData.effect === "EFFECT_SLEEP") {
          // Duration rolled ONCE at infliction: (Random() & 3) + 2 -> uniform
          // over {2,3,4,5}, 25% each (src/battle_script_commands.c:2481,
          // src/battle_util.c:1762 — same roll, two different infliction
          // sites). Enumerated fully per Lesson 1 even though, within this
          // engine's fixed 3-turn match, every value in {2,3,4,5} produces an
          // identical outcome (the minimum, 2, already exceeds the most
          // turns a victim could ever need to act again post-infliction) —
          // not collapsed as a shortcut, kept complete and source-faithful.
          for (const duration of [2, 3, 4, 5]) {
            results.push({ p: p * ab.p * 0.25, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, sleepDuration: duration });
          }
          continue;
        }
        if (moveData.effect === "EFFECT_ATTRACT") {
          // Cmd_tryinfatuating's gender-compatibility check (see
          // EFFECT_EXECUTORS.EFFECT_ATTRACT) depends on each side's gender,
          // which for a variable-ratio mon with no fixed/config gender is
          // genuinely uncertain — enumerated here as its own branch (Lesson
          // 1: never re-roll it live in the executor) rather than resolved
          // as a single probability the way a chance secondary's fixed
          // percentage is (secondaryOutcomes).
          const targetMon = actor === "you" ? ctx.opp : ctx.you;
          const userMon = actor === "you" ? ctx.you : ctx.opp;
          let pCompatible = 0;
          for (const u of userMon.genderDist) {
            for (const t of targetMon.genderDist) {
              if (u.gender !== "genderless" && t.gender !== "genderless" && u.gender !== t.gender) pCompatible += u.p * t.p;
            }
          }
          if (pCompatible > 0) {
            results.push({ p: p * ab.p * pCompatible, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, attractGenderCompatible: true });
          }
          if (pCompatible < 1) {
            results.push({ p: p * ab.p * (1 - pCompatible), hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, attractGenderCompatible: false });
          }
          continue;
        }
        // B2b batch 5: the variable-damage draws, enumerated exactly like the
        // hit-count draw below -- resolved ONCE per move use, never re-rolled,
        // and carried on the outcome rather than drawn inside applyMove.
        const powerDist = VARIABLE_DAMAGE_DRAWS[moveData.effect];
        if (powerDist) {
          for (const { power, p: pp } of powerDist) {
            if (pp > 0) results.push({ p: p * ab.p * pp, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, variablePower: power, dmgHit: true });
          }
          continue;
        }
        if (moveData.effect === "EFFECT_TRIPLE_KICK") {
          // B3 batch 6: TRIPLE KICK (data/battle_scripts_1.s:1384-1437). Up to
          // three hits, and EVERY hit re-runs `accuracycheck` -- the first miss
          // ends the move (TripleKickNoMoreHits). Given that hit 1 landed with
          // per-hit probability q (this branch), the count is 1 w.p. (1-q), 2
          // w.p. q(1-q), 3 w.p. q^2. Stages cannot change mid-move, so q is the
          // same for every hit; a Lock-On makes it 1 for every hit.
          const q = ab.p;
          for (const [hits, w] of [[1, 1 - q], [2, q * (1 - q)], [3, q * q]]) {
            if (w > 0) results.push({ p: p * ab.p * w, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, hitCount: hits, dmgHit: true });
          }
          continue;
        }
        const hitDist = MULTI_HIT_DISTRIBUTION[moveData.effect];
        if (hitDist && kingsRockChance(ctx, state, actor, moveName, moveData, isLastToAct) > 0) {
          throw new Error(`"${moveName}" is a multi-hit move with FLAG_KINGS_ROCK_AFFECTED, used with King's Rock. ` +
            `Source rolls it once at MOVEEND off the last hit's damage; the multi-hit path does not reach that ` +
            `roll yet. Port it before this position can be solved.`);
        }
        if (hitDist) {
          // Hit-count resolved ONCE per move use (never re-rolled per hit —
          // Cmd_setmultihitcounter runs a single time, before the loop even
          // starts). The per-hit damage/substitute/Endure mechanics live in
          // applyMove's loop; this branch only fixes how many iterations it runs.
          // F29: a per-hit secondary (Twineedle, always 2 hits) is drawn here too.
          const perHit = secondarySpecFor(moveName, moveData)?.perHit
            ? secondaryOutcomes(ctx, state, actor, moveName, moveData, isLastToAct) : null;
          for (const { hits, p: hp } of hitDist) {
            if (hp <= 0) continue;
            if (perHit) {
              let rest = 1;
              for (const o of perHit) {
                results.push({ p: p * ab.p * hp * o.q, hit: true, selfHit: false, secondaryTriggered: o.trig, statusPrevented: false, thawed: stb.thawed, hitCount: hits, dmgHit: true });
                rest -= o.q;
              }
              if (rest > 1e-12) results.push({ p: p * ab.p * hp * rest, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, hitCount: hits, dmgHit: true });
            } else {
              results.push({ p: p * ab.p * hp, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, hitCount: hits, dmgHit: true });
            }
          }
          continue;
        }
        // B4: the chance secondary, drawn once per landed hit.
        const sec = moveData.power > 0 ? secondaryOutcomes(ctx, state, actor, moveName, moveData, isLastToAct) : null;
        if (sec) {
          let rest = 1;
          for (const o of sec) {
            results.push({ p: p * ab.p * o.q, hit: true, selfHit: false, secondaryTriggered: o.trig, statusPrevented: false, thawed: stb.thawed, dmgHit: true });
            rest -= o.q;
          }
          if (rest > 1e-12) results.push({ p: p * ab.p * rest, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, dmgHit: true });
        } else {
          results.push({ p: p * ab.p, hit: true, selfHit: false, secondaryTriggered: false, statusPrevented: false, thawed: stb.thawed, dmgHit: true });
        }
      }
    }
  }
  return disableTimerBranches(ctx, state, actor, moveData,
    contactAbilityBranches(ctx, state, actor, moveName, moveData,
      focusBandBranches(ctx, state, actor, moveName, moveData, rollSplit(ctx, state, actor, moveName, moveData, critSplit(ctx, state, actor, moveData, results, moveName)))));
}

// ── B8: THE CONTACT ABILITIES (ABILITYEFFECT_ON_DAMAGE, src/battle_util.c:
// 2749-2872). Every one needs a contact move that affected its holder and
// damaged the holder ITSELF (TARGET_TURN_DAMAGED -- a Substitute absorbing it
// does not count), a live attacker, and no confusion self-hit. The chances, read
// from source rather than from the "30%" folklore in ability-enumeration.md:
//   Static / Poison Point / Flame Body / Cute Charm   Random() % 3 == 0  -> 1/3
//   Effect Spore   Random() % 10 == 0, then `Random() & 3` re-rolled until
//                  non-zero and BURN remapped to PARALYSIS: sleep, poison and
//                  paralysis at 1/30 each (and sleep's own 2-5 duration)
//   Rough Skin     no roll -- applyMove handles it
// The statuses go through SetMoveEffect with HITMARKER_STATUS_ABILITY_EFFECT
// (Shield Dust and Safeguard are SKIPPED) and AFFECTS_USER (no Substitute
// check); type and ability immunities still apply, so a proc that could not
// land is not branched at all -- the same collapse rule as Focus Band.
const CONTACT_STATUS_ABILITY = { "Static": "paralysis", "Poison Point": "poison", "Flame Body": "burn" };
function canTakeContactStatus(state, side, status, mon) {
  if (state[side === "you" ? "youStatus" : "oppStatus"] != null) return false;
  if (STATUS_IMMUNITY_TYPES[status].some((t) => mon.types.includes(t))) return false;
  if (STATUS_IMMUNITY_ABILITIES[status] && mon.ability === STATUS_IMMUNITY_ABILITIES[status]) return false;
  if (status === "sleep") {
    if (mon.ability === "Insomnia" || mon.ability === "Vital Spirit") return false;
    if (uproarKeepsAwake(state, mon)) return false;
  }
  return true;
}
function contactAbilityBranches(ctx, state, actor, moveName, moveData, results) {
  const isYou = actor === "you";
  const holder = isYou ? ctx.opp : ctx.you;      // the TARGET holds the ability
  const attacker = isYou ? ctx.you : ctx.opp;
  const ab = holder.ability;
  if (!(ab in CONTACT_STATUS_ABILITY) && ab !== "Effect Spore" && ab !== "Cute Charm") return results;
  if (moveData.power === 0 || !moveFlags(moveName).makesContact) return results;
  if ((isYou ? state.oppSubstituteHP : state.youSubstituteHP) != null) return results; // no TARGET_TURN_DAMAGED
  if (typeEffectiveness(moveData.type, holder.types, isYou ? state.oppForesighted : state.youForesighted) === 0) return results;
  const selfSide = isYou ? "you" : "opp";
  // Each proc: [probability, outcome fields]. Unobservable ones are dropped.
  const procs = [];
  // Phase D F2a: a trigger that cannot land is no longer unobservable when the
  // HOLDER is the player -- it records the ability for the AI. Those triggers
  // become a "record" branch; for the AI's own holder they stay dropped.
  const recordable = !isYou;
  if (ab in CONTACT_STATUS_ABILITY) {
    const st = CONTACT_STATUS_ABILITY[ab];
    if (canTakeContactStatus(state, selfSide, st, attacker)) procs.push([1 / 3, { contactProc: st }]);
    else if (recordable) procs.push([1 / 3, { contactProc: "record" }]);
  } else if (ab === "Effect Spore") {
    let landed = 0;
    if (canTakeContactStatus(state, selfSide, "poison", attacker)) { procs.push([1 / 30, { contactProc: "poison" }]); landed += 1 / 30; }
    if (canTakeContactStatus(state, selfSide, "paralysis", attacker)) { procs.push([1 / 30, { contactProc: "paralysis" }]); landed += 1 / 30; }
    if (canTakeContactStatus(state, selfSide, "sleep", attacker)) {
      for (const d of [2, 3, 4, 5]) procs.push([1 / 120, { contactProc: "sleep", contactSleep: d }]);
      landed += 1 / 30;
    }
    if (recordable && landed < 1 / 10) procs.push([1 / 10 - landed, { contactProc: "record" }]);
  } else if (ab === "Cute Charm") {
    // Gender uses the engine's Attract treatment: a per-use compatibility
    // probability from each species' gender distribution.
    if (attacker.ability !== "Oblivious" && !state[isYou ? "youAttracted" : "oppAttracted"]) {
      let pCompat = 0;
      for (const u of attacker.genderDist) for (const t of holder.genderDist) {
        if (u.gender !== "genderless" && t.gender !== "genderless" && u.gender !== t.gender) pCompat += u.p * t.p;
      }
      if (pCompat > 0) procs.push([pCompat / 3, { contactProc: "attract" }]);
    }
  }
  if (procs.length === 0) return results;
  // F2a: when EVERY trigger is record-only nothing changes between hits, so a
  // multi-hit move records with 1 - (1 - q)^hits -- exact, no per-hit chain.
  if (procs.every(([, f]) => f.contactProc === "record")) {
    const q = procs.reduce((a, [p]) => a + p, 0);
    const out = [];
    for (const r of results) {
      if (r.hit !== true || r.variablePower === "heal" || r.variablePower === "failed") { out.push(r); continue; }
      const pRec = 1 - Math.pow(1 - q, r.hitCount ?? 1);
      out.push({ ...r, p: r.p * pRec, contactProc: "record" });
      out.push({ ...r, p: r.p * (1 - pRec) });
    }
    return out;
  }
  if (results.some((r) => r.hit && (r.hitCount ?? 1) > 1)) {
    throw new Error(`"${moveName}" is a multi-hit contact move into ${ab} (${holder.species}). Source rolls ` +
      `ABILITYEFFECT_ON_DAMAGE after EVERY hit; the per-hit chain is not modelled. Port it before this ` +
      `position can be solved.`);
  }
  const pAny = procs.reduce((a, [q]) => a + q, 0);
  const out = [];
  for (const r of results) {
    if (r.hit !== true || r.variablePower === "heal" || r.variablePower === "failed") { out.push(r); continue; }
    for (const [q, fields] of procs) out.push({ ...r, p: r.p * q, ...fields });
    out.push({ ...r, p: r.p * (1 - pAny) });
  }
  return out;
}

// Disable's timer, enumerated as weighted branches -- and COLLAPSED by the same
// rule as Quick Claw and Focus Band: branch only where the draws differ in
// anything the round can observe.
//
// Cmd_disablelastusedattack sets `(Random() & 3) + 2`, i.e. {2,3,4,5} at 1/4
// each. The timer decrements once per end-of-turn and the lock lifts at 0, so a
// mon disabled on turn t is still locked on turn t+j exactly while timer > j.
// Inside a 3-turn round j can only reach 3 - t, so the OBSERVABLE value is
// min(T, 4 - t):
//   used on turn 1 -> min(T,3): {2 at 1/4, 3 at 3/4}   TWO classes
//   used on turn 2 -> min(T,2): every draw gives 2      one class
//   used on turn 3 -> min(T,1): nothing left to observe one class
// So the four draws cost at most a 2-way split, and only on a turn-1 Disable.
const DISABLE_TIMER_DRAWS = [2, 3, 4, 5]; // (Random() & 3) + 2, uniform
function disableTimerBranches(ctx, state, actor, moveData, results) {
  if (moveData.effect !== "EFFECT_DISABLE") return results;
  const isYou = actor === "you";
  const foeMon = isYou ? ctx.opp : ctx.you;
  // If the executor is going to fail anyway, the timer is never read.
  if (isYou ? state.oppDisabledMove : state.youDisabledMove) return results;
  const foeLast = isYou ? state.oppLastMove : state.youLastMove;
  if (!foeLast || !foeMon.moves.includes(foeLast)) return results;

  const observableCap = Math.max(1, 4 - state.turn);
  const buckets = new Map();
  for (const draw of DISABLE_TIMER_DRAWS) {
    const observable = Math.min(draw, observableCap);
    buckets.set(observable, (buckets.get(observable) || 0) + 1 / DISABLE_TIMER_DRAWS.length);
  }
  if (buckets.size === 1) {
    const only = [...buckets.keys()][0];
    return results.map((r) => (r.hit ? { ...r, disableTimer: only } : r));
  }
  const out = [];
  for (const r of results) {
    if (!r.hit) { out.push(r); continue; }
    for (const [timer, p] of buckets) out.push({ ...r, p: r.p * p, disableTimer: timer });
  }
  return out;
}

// Focus Band's per-hit roll, enumerated as weighted branches -- and PRUNED by
// the same collapse rule Quick Claw uses: branch only where the proc and the
// no-proc outcome actually DIFFER. Focus Band does nothing to a hit that would
// not have reduced the target to 0, so a non-lethal hit stays one branch.
//
// Lethality is asked of THE SAME calcDamage the battle path uses, through the
// same battleDamageOptions builder. A second, probe-only damage estimate would
// be the drift anti-pattern this project exists downstream of, and would go
// wrong the moment either copy gained a modifier the other lacked.
// C2 (found by the full grid): the power a LANDED hit of a counter-driven move
// takes, from the state BEFORE the action -- Cmd_furycuttercalc
// (src/battle_script_commands.c:8580-8602) and Cmd_rolloutdamagecalculation
// (:8536-8569). applyMoveCore takes its power from here too, so the Focus Band
// probe below cannot drift from the hit it is probing.
function counterHitPower(state, actor, moveData) {
  const isYou = actor === "you";
  if (moveData.effect === "EFFECT_FURY_CUTTER") {
    const c = state[isYou ? "youFuryCutter" : "oppFuryCutter"];
    return moveData.power * Math.pow(2, (c === 5 ? 5 : c + 1) - 1);
  }
  if (moveData.effect === "EFFECT_ROLLOUT") {
    const lock = state[isYou ? "youLock" : "oppLock"];
    const timer = (lock?.kind === "rollout" ? lock.n : 5) - 1;
    return moveData.power * Math.pow(2, 5 - timer - 1)
      * (vf(state, isYou ? "youDefenseCurled" : "oppDefenseCurled") ? 2 : 1);
  }
  return null;
}

// Phase D F27: what Counter / Mirror Coat reflect -- the damage of the
// matching category the user took THIS turn (gProtectStructs physicalDmg /
// specialDmg), or null when there is none (the move fails).
function counterReceived(state, actor, moveData) {
  const received = state[actor === "you" ? "youDamageTaken" : "oppDamageTaken"];
  const needed = moveData.effect === "EFFECT_COUNTER" ? "physical" : "special";
  return received && received.category === needed && received.amount > 0 ? received.amount : null;
}
// Phase D F31: the damage roll, EXACT and OPT-IN (ctx.exactRoll; amendment 15
// kept it available "if Phase D's replay needs it" -- it does: 39 emulator
// traces diverge only on the roll). Each landed damaging hit whose script
// rolls (adjustnormaldamage: ApplyRandomDmgMultiplier, 100 - Random() % 16)
// branches over 85..100, 1/16 each. A two-hit move draws a roll per hit;
// more hits are refused by name rather than approximated.
const ROLL_VALUES = Array.from({ length: 16 }, (_, k) => 85 + k);
function rollSplit(ctx, state, actor, moveName, moveData, results) {
  if (!ctx.exactRoll) return results;
  if (moveData.power === 0 || SET_DAMAGE_EFFECTS.has(moveData.effect) || ROLL_EXEMPT(moveData.effect)
      || moveData.effect === "EFFECT_LEVEL_DAMAGE" || moveData.effect === "EFFECT_OHKO"
      || moveData.effect === "EFFECT_FUTURE_SIGHT") return results;
  const out = [];
  for (const r of results) {
    if (!r.hit || !r.dmgHit || r.variablePower === "heal" || r.variablePower === "failed") { out.push(r); continue; }
    const hits = r.hitCount ?? 1;
    if (hits === 1) {
      for (const v of ROLL_VALUES) out.push({ ...r, p: r.p / 16, roll: v });
    } else if (hits === 2) {
      for (const a of ROLL_VALUES) for (const b of ROLL_VALUES) out.push({ ...r, p: r.p / 256, roll: [a, b] });
    } else {
      // 16^hits vectors grouped EXACTLY: with no Substitute, Endure or Focus
      // Band on the target, the hit loop's outcome depends on the total, the
      // first hit (Shell Bell's basis) and the last (what Counter reflects),
      // so one representative vector per (first, total, last) carries that
      // group's whole weight.
      const isYou = actor === "you";
      const foeSub = isYou ? state.oppSubstituteHP : state.youSubstituteHP;
      const foeEndure = isYou ? state.oppEndureActive : state.youEndureActive;
      const fb = itemData((isYou ? ctx.opp : ctx.you).item);
      if (foeSub != null || foeEndure || (fb && fb.holdEffect === "HOLD_EFFECT_FOCUS_BAND")) {
        throw new Error(`exact roll: "${moveName}" hits ${hits} times into a Substitute, Endure or Focus Band; ` +
          `the per-hit roll vector is not grouped for those.`);
      }
      const selfMon = isYou ? ctx.you : ctx.opp, foeMon = isYou ? ctx.opp : ctx.you;
      const charging = isYou ? state.oppCharging : state.youCharging;
      const dmgAt = (i, v) => {
        const power = moveData.effect === "EFFECT_TRIPLE_KICK" ? 10 * (i + 1) : null;
        let d = calcDamage(selfMon, foeMon, moveName, battleDamageOptions({ ...ctx, rollPercent: v }, state, actor, moveData, power, 1, !!(((r.crit | 0) >> i) & 1)));
        const bm = charging ? INVULN_BYPASS[charging.invulnBit]?.[moveName] : null;
        if (bm) d = Math.floor(d * bm);
        return d;
      };
      let groups = new Map([["", { n: 1, vec: [], first: null, total: 0, last: null }]]);
      for (let i = 0; i < hits; i++) {
        const next = new Map();
        for (const g of groups.values()) {
          for (const v of ROLL_VALUES) {
            const d = dmgAt(i, v);
            const first = i === 0 ? d : g.first, total = g.total + d;
            const k = `${first}|${total}|${d}`;
            const e = next.get(k);
            if (e) e.n += g.n; else next.set(k, { n: g.n, vec: [...g.vec, v], first, total, last: d });
          }
        }
        groups = next;
      }
      const all = 16 ** hits;
      for (const g of groups.values()) out.push({ ...r, p: (r.p * g.n) / all, roll: g.vec });
    }
  }
  return out;
}
function focusBandBranches(ctx, state, actor, moveName, moveData, results) {
  const isYou = actor === "you";
  const foeMon = isYou ? ctx.opp : ctx.you;
  const fb = itemData(foeMon.item);
  if (!fb || fb.holdEffect !== "HOLD_EFFECT_FOCUS_BAND") return results;
  if (moveData.power === 0) return results;
  // Source gates the clamp on the target NOT having a Substitute (:1681).
  if ((isYou ? state.oppSubstituteHP : state.youSubstituteHP) != null) return results;
  // B3 batch 6: Triple Kick is multi-hit with a per-hit power, and Focus Band
  // rolls per hit inside its loop -- the same unmodelled chain as the throw
  // below. Say so here, before the lethality probe asks calcDamage for a power
  // this path does not carry.
  if (moveData.effect === "EFFECT_TRIPLE_KICK") {
    throw new Error(`"${moveName}" is a multi-hit move used against a Focus Band holder ` +
      `(${foeMon.species}). Source rolls Focus Band once per hit inside the multi-hit loop and a ` +
      `proc can be followed by another lethal hit; that chain is not modelled. Port it before this ` +
      `position can be solved.`);
  }

  const selfMon = isYou ? ctx.you : ctx.opp;
  const foeHp = Math.round(((isYou ? state.oppHpPct : state.yourHpPct) / 100) * foeMon.stats.hp);
  // B2b batch 5: the lethality probe is now PER RESULT, because a variable-damage
  // move's branches differ in exactly the thing being probed -- a magnitude 4 may
  // not KO where a magnitude 10 does, so "can this hit kill?" has no single
  // answer for the move any more. Branches that cannot kill keep the collapse
  // rule's single branch; only the lethal ones split.
  // C2: Fury Cutter / Rollout / Ice Ball carry no drawn power -- theirs comes
  // from their counters (counterHitPower). Bide's body is reached only on the
  // unleash (storing turns stop at CANCELER_BIDE) or the set turn: the unleash
  // deals twice the stored damage, the set turn deals none.
  const bideLock = state[isYou ? "youLock" : "oppLock"];
  const probePower = moveData.effect === "EFFECT_BIDE"
    ? (bideLock?.kind === "bide" ? bideLock.dmg * 2 : 0)
    : (moveData.effect === "EFFECT_COUNTER" || moveData.effect === "EFFECT_MIRROR_COAT") // F27
      ? (counterReceived(state, actor, moveData) ?? 0) * 2
      : counterHitPower(state, actor, moveData);
  // Phase D F39: the probe asks about the hit that lands -- its crit (single-hit
  // mask bit 0; multi-hit throws below) and the script's dmgMultiplier.
  const mult = scriptDamageMultiplier(state, actor, moveData);
  const lethal = (r) => (probePower === 0 ? false : calcDamage(selfMon, foeMon, moveName,
    battleDamageOptions(r.roll != null && !Array.isArray(r.roll) ? { ...ctx, rollPercent: r.roll } : ctx, state, actor, moveData,
      r.variablePower ?? probePower, mult, !!((r.crit | 0) & 1))) >= foeHp);
  if (!results.some((r) => r.hit && r.variablePower !== "heal" && lethal(r))) {
    return results; // no branch can KO, so the proc is unobservable in any of them
  }

  // The roll sits inside BattleScript_MultiHitLoop (data/battle_scripts_1.s:624),
  // so each hit of a multi-hit move rolls independently and a proc can be
  // followed by ANOTHER lethal hit that rolls again. That chain is not modelled.
  // It is unreachable with the current lead panel -- no panel lead carries a
  // multi-hit move -- so this throws loudly instead of quietly approximating.
  if (results.some((r) => (r.hitCount ?? 1) > 1)) {
    throw new Error(`"${moveName}" is a multi-hit move used against a Focus Band holder ` +
      `(${foeMon.species}). Source rolls Focus Band once per hit inside the multi-hit loop and a ` +
      `proc can be followed by another lethal hit; that chain is not modelled. Port it before this ` +
      `position can be solved.`);
  }

  const p = fb.param / FOCUS_BAND_SPACE;
  const out = [];
  for (const r of results) {
    if (!r.hit || r.variablePower === "heal" || !lethal(r)) { out.push(r); continue; }
    out.push({ ...r, p: r.p * p, focusBanded: true });
    out.push({ ...r, p: r.p * (1 - p), focusBanded: false });
  }
  return out;
}

// B7c: Quick Claw draws ONE gRandomTurnNumber PER TURN (src/battle_main.c:3140,
// :3923, :4013) and BOTH battlers compare against that SAME value (:4653 and
// :4687): `gRandomTurnNumber < (0xFFFF * holdEffectParam) / 100`.
//
// With param 20 the threshold is floor(0xFFFF * 20 / 100) = floor(1310700/100)
// = 13107. gRandomTurnNumber is a u16 uniform over 0..65535, i.e. 65536 values,
// so the probability is EXACTLY 13107 / 65536 = 0.1999969482421875 -- NOT 20%,
// and NOT 13107/65535 either. The threshold divides by 0xFFFF (65535) while the
// draw ranges over 65536 values, and that off-by-one is the whole difference.
// The source-exact constant is kept rather than rounded to 0.2, because Phase D
// compares against the ROM turn by turn.
const QUICK_CLAW_RANDOM_SPACE = 65536; // gRandomTurnNumber is a u16
const quickClawThreshold = (param) => Math.floor((0xFFFF * param) / 100);

// ── B2b batch 10: state-level mutable abilities and items ─────────────────
// Trick, Skill Swap, Role Play, Recycle and Thief all change something the
// engine had treated as immutable: a mon's ability or its held item, which live
// on the BUILT mon and are read from ~70 and ~16 places respectively.
//
// Patching those 86 sites would be the wrong shape. The override lives in the
// STATE (where a per-branch change belongs -- ctx is shared across every branch
// of the search and must never be mutated), and it is resolved at the two choke
// points every read flows through: the top of resolveTurn, and the AI's own
// move choice. Downstream code keeps reading mon.ability and mon.item and is
// simply handed the effective mon.
//
// Identity is preserved when nothing is overridden -- the same object comes
// back, so the common case costs one property read and allocates nothing.
// MEMOISED BY (mon, ability, item), and that is load-bearing, not tidiness.
// A2's roll-class cache is a WeakMap keyed on the mon OBJECTS
// (_aiRollClassCache), so handing the search a freshly-built clone every turn
// missed that cache on every lookup. Measured: throughput fell 42.9 -> 16.8
// solves/sec, concentrated in the sets that consume a berry (a consumed berry
// now writes an item override, which is what started cloning). With the clones
// interned per distinct override the identity is stable again and the memo
// works. The lesson is cheap to state and was expensive to find: introducing a
// new object identity anywhere upstream of an identity-keyed cache silently
// disables it.
const _effectiveMonCache = new WeakMap();
function effectiveMon(mon, state, side) {
  const ability = state[side === "you" ? "youAbilityOverride" : "oppAbilityOverride"];
  const item = state[side === "you" ? "youItemOverride" : "oppItemOverride"];
  const moves = state[side === "you" ? "youMoves" : "oppMoves"];
  const tf = state[side === "you" ? "youTransform" : "oppTransform"];
  const types = state[side === "you" ? "youTypes" : "oppTypes"];
  if (ability == null && item === undefined && moves == null && tf == null && types == null) return mon;
  // C2: the key names EVERY field the Transform snapshot contributes (stats and
  // Hidden Power joined it) -- one mon object meeting two same-species foes
  // must not reuse the first one's copy.
  let byKey = _effectiveMonCache.get(mon);
  if (!byKey) { byKey = new Map(); _effectiveMonCache.set(mon, byKey); }
  const key = `${ability ?? ""}|${item === undefined ? " " : item ?? ""}|${moves ? moves.join(",") : ""}|${tf ? tf.species + ":" + tf.moves.join(",") + ":" + tf.ability + ":" + Object.values(tf.stats).join(",") + ":" + (tf.hiddenPower ? tf.hiddenPower.type + tf.hiddenPower.power : "") : ""}|${types ? types.join(",") : ""}`;
  let out = byKey.get(key);
  if (!out) {
    out = { ...mon };
    // B3 batch 7d: Transform first -- the later overrides sit on top of it.
    if (tf) {
      out.species = tf.species; out.types = tf.types; out.ability = tf.ability;
      out.moves = tf.moves; out.genderDist = tf.genderDist; out.hiddenPower = tf.hiddenPower;
      out.stats = { ...tf.stats, hp: mon.stats.hp };
    }
    if (types != null) out.types = types;  // B8d: Color Change, over Transform
    if (ability != null) out.ability = ability;
    if (item !== undefined) out.item = item;
    if (moves != null) out.moves = moves;
    byKey.set(key, out);
  }
  return out;
}

// B8d: FORECAST, as a DERIVED rule. CastformDataTypeChange (src/battle_util.c:
// 2396-2429) re-runs at every action's end and at turn end
// (HandleFaintedMonActions case 6, :1958-1963), at switch-in and after a
// Cloud Nine / Air Lock switch-in -- so between actions a Forecast Castform's
// type is ALWAYS the current effective weather's: sun Fire, rain Water, hail
// Ice, anything else (sandstorm, none, suppressed) Normal. Nothing inside an
// action observes the stale type, so no state is kept.
const _forecastCache = new WeakMap();
function forecastMon(mon, weather) {
  if (mon.species !== "Castform" || mon.ability !== "Forecast") return mon;
  const t = weather === "sun" ? "Fire" : weather === "rain" ? "Water" : weather === "hail" ? "Ice" : "Normal";
  if (mon.types.length === 1 && mon.types[0] === t) return mon;
  let byT = _forecastCache.get(mon);
  if (!byT) { byT = new Map(); _forecastCache.set(mon, byT); }
  let out = byT.get(t);
  if (!out) { out = { ...mon, types: [t] }; byT.set(t, out); }
  return out;
}
function effectiveCtx(ctx, state) {
  let you = effectiveMon(ctx.you, state, "you");
  let opp = effectiveMon(ctx.opp, state, "opp");
  if (you.species === "Castform" || opp.species === "Castform") {
    const w = effectiveWeather(state, you, opp);
    you = forecastMon(you, w);
    opp = forecastMon(opp, w);
  }
  if (you === ctx.you && opp === ctx.opp) return ctx;
  return { ...ctx, you, opp, raw: ctx.raw ?? ctx };
}

// B8d: re-resolve from the RAW context. An action can change what the NEXT one
// sees -- Trick, Skill Swap, Knock Off, Thief, Mimic, Transform, Color Change,
// a weather move under Forecast -- and the second action and the end of turn
// used to read the turn-start resolution, so a faster Ditto's Transform was
// invisible to the slower foe's hit on it in the same turn. Resolving from the
// raw mons keeps the interned identities the identity-keyed caches rely on.
function reResolve(ctx, state) {
  const r = effectiveCtx(ctx.raw ?? ctx, state);
  // F31: the action's drawn roll is not on the raw ctx; keep it
  return ctx.rollPercent != null && r.rollPercent !== ctx.rollPercent ? { ...r, rollPercent: ctx.rollPercent } : r;
}
// Overrides can only change DURING an action, and re-resolving on every branch
// measured +5-9% (effectiveCtx went from once per turn to twice per branch). So
// re-resolve only when something that feeds the resolution actually moved --
// by identity, since every override is replaced, never mutated.
function resolutionChanged(a, b) {
  return a.youAbilityOverride !== b.youAbilityOverride || a.oppAbilityOverride !== b.oppAbilityOverride
    || a.youItemOverride !== b.youItemOverride || a.oppItemOverride !== b.oppItemOverride
    || a.youMoves !== b.youMoves || a.oppMoves !== b.oppMoves
    || a.youTransform !== b.youTransform || a.oppTransform !== b.oppTransform
    || a.youTypes !== b.youTypes || a.oppTypes !== b.oppTypes
    || a.weatherType !== b.weatherType; // Forecast reads the weather
}

function resolveTurn(ctx, state, yourMove, oppMove, { qc } = {}) {
  // Resolve the overrides ONCE per turn, here, so that every downstream read of
  // mon.ability / mon.item sees the swapped values without any of them knowing
  // the swap exists.
  ctx = effectiveCtx(ctx, state);
  const { you, opp } = ctx;
  const yourMoveData = battleMoveData(you, yourMove);
  const oppMoveData = battleMoveData(opp, oppMove);
  // Priority beats Speed outright; only tie on priority falls back to Speed.
  // Paralysis quarters EFFECTIVE speed for this comparison only (source-
  // confirmed: applied at the turn-order comparison site, never permanently
  // altering the stored Speed stat) — status here is BEFORE either mon acts
  // this turn, which is the correct timing (order is locked in first).
  const weatherForSpeed = effectiveWeather(state, you, opp);
  const yourEffSpeed = effSpeed(you, state.youStatus, state.youStages.spe, weatherForSpeed);
  const oppEffSpeed = effSpeed(opp, state.oppStatus, state.oppStages.spe, weatherForSpeed);
  const yourPriority = yourMoveData.priority;
  const oppPriority = oppMoveData.priority;
  // B7c-3: an EXACT speed tie is broken by `Random() & 1` in source
  // (src/battle_main.c:4728 and :4749 -- the same expression appears in both the
  // priority-nonzero and priority-zero arms). Callers test GetWhoStrikesFirst
  // truthily, so its `strikesFirst = 2` means battler 2 goes first: the tie is a
  // clean 0.5 / 0.5. This engine used to resolve ties deterministically in the
  // player's favour (`ySpeed >= oSpeed`), which is a real divergence and is why
  // ties now enumerate as two weighted branches.
  //
  // Same collapse rule as Quick Claw and Focus Band: only an EXACT tie under
  // EQUAL priority branches. A priority gap, or any speed difference at all,
  // stays a single branch.
  const orderBranches = (ySpeed, oSpeed) => {
    if (yourPriority !== oppPriority) {
      return [{ p: 1, order: yourPriority > oppPriority ? ["you", "opp"] : ["opp", "you"] }];
    }
    if (ySpeed === oSpeed) {
      return [{ p: 0.5, order: ["you", "opp"] }, { p: 0.5, order: ["opp", "you"] }];
    }
    return [{ p: 1, order: ySpeed > oSpeed ? ["you", "opp"] : ["opp", "you"] }];
  };
  const runBranches = (branches) => {
    if (branches.length === 1) return resolveTurnWithOrder(ctx, state, yourMove, oppMove, branches[0].order);
    const acc = [];
    for (const b of branches) {
      for (const r of resolveTurnWithOrder(ctx, state, yourMove, oppMove, b.order)) {
        acc.push({ ...r, p: r.p * b.p });
      }
    }
    return acc;
  };
  const baseBranches = orderBranches(yourEffSpeed, oppEffSpeed);

  const youItem = itemData(you.item);
  const oppItem = itemData(opp.item);
  const youQC = youItem && youItem.holdEffect === "HOLD_EFFECT_QUICK_CLAW" ? youItem : null;
  const oppQC = oppItem && oppItem.holdEffect === "HOLD_EFFECT_QUICK_CLAW" ? oppItem : null;
  if (!youQC && !oppQC) return runBranches(baseBranches);

  // A successful draw sets the holder's speed to UINT_MAX. If BOTH sides hold
  // one, the single shared draw sets BOTH, so the speeds tie again and the
  // existing tie rule decides -- which is why this is computed through the same
  // orderFor() rather than special-cased.
  const INF = Number.MAX_SAFE_INTEGER;
  const firedBranches = orderBranches(youQC ? INF : yourEffSpeed, oppQC ? INF : oppEffSpeed);

  // EXACT collapse, not an approximation: when the draw would not change who
  // moves first, both branches are the same subtree, so enumerating them
  // separately would only duplicate work and split probabilities that re-sum to
  // the same thing. Priority differences land here too -- Quick Claw cannot beat
  // priority, so a priority gap makes firedOrder === baseOrder automatically.
  const sameShape = firedBranches.length === baseBranches.length
    && firedBranches.every((b, i) => b.order[0] === baseBranches[i].order[0] && b.p === baseBranches[i].p);
  // F14: a caller that already conditioned on the draw (the search, via
  // aiTurnPlans) gets that outcome's order only.
  if (qc === true) return runBranches(firedBranches);
  if (qc === false) return runBranches(baseBranches);
  if (sameShape) return runBranches(baseBranches);

  const pFire = quickClawThreshold((youQC || oppQC).param) / QUICK_CLAW_RANDOM_SPACE;
  const out = [];
  for (const [p, branches] of [[pFire, firedBranches], [1 - pFire, baseBranches]]) {
    for (const r of runBranches(branches)) out.push({ ...r, p: r.p * p });
  }
  return out;
}

function resolveTurnWithOrder(ctx, state, yourMove, oppMove, order) {
  const { you, opp } = ctx;
  const yourMoveData = battleMoveData(you, yourMove);
  const oppMoveData = battleMoveData(opp, oppMove);
  const results = [];
  state = freshTurnDamageTracking(state);
  // B2b batch 9: bounceMove is a PER-TURN flag (gProtectStructs is cleared each
  // turn), so it never survives into the next one.
  state = { ...state, youBouncing: false, oppBouncing: false };
  // RAGE'S FLAG is cleared by TryClearRageStatuses (src/battle_util.c:1973-
  // 1981), called ONCE at the top of the turn (src/battle_main.c:4925), before
  // any action, for every battler whose CHOSEN move is not Rage -- whether or
  // not that battler then gets to act. It used to be cleared inside the action,
  // which a fully paralysed, flinched or sleeping rager never reaches, so its
  // flag survived a turn it had chosen something else.
  if ((state.youRaging && yourMove !== "Rage") || (state.oppRaging && oppMove !== "Rage")) {
    state = { ...state, youRaging: state.youRaging && yourMove === "Rage", oppRaging: state.oppRaging && oppMove === "Rage" };
  }

  const firstMove = order[0] === "you" ? yourMove : oppMove;
  const firstMoveData = order[0] === "you" ? yourMoveData : oppMoveData;
  const firstTargetCharging = order[0] === "you" ? state.oppCharging : state.youCharging;
  const firstOutcomes = enumerateActionOutcomes(ctx, state, order[0], firstMove, firstMoveData, firstTargetCharging, false);

  for (const fo of firstOutcomes) {
    let s = cloneState(state);
    if (fo.confTick) applyConfusionTick(s, order[0], fo.confTick);
    const bidePre1 = (s.youLock?.kind === "bide" || s.oppLock?.kind === "bide") ? bideSnapshot(s) : null; // only while someone is biding: accumulation needs the lock BEFORE the action
    applyMove(ctx, s, order[0], firstMove, fo.hit, fo.selfHit, fo.secondaryTriggered, fo.statusPrevented, fo.thawed, fo.endureTriggered, fo.sleepRemaining ?? null, fo.sleepDuration ?? null, fo.protectTriggered ?? false, fo.blockedByProtect ?? false, fo.attractPrevented ?? false, fo.attractGenderCompatible ?? null, fo.hitCount ?? null, fo.focusBanded ?? false, fo.disableTimer ?? null, fo.calledMove ?? null, fo.variablePower ?? null, fo.cancelReason ?? null, fo.lockTurns ?? null, fo.contactProc ?? null, fo.contactSleep ?? null, fo.crit ?? 0, fo.roll ?? null);
    if (bidePre1) bideAccumulate(ctx, s, bidePre1);
    const firstLabel = ctx.noLabels ? "" : describeAction(order[0], firstMove, fo.hit, fo.selfHit, fo.statusPrevented, fo.attractPrevented, fo.hitCount ?? null, fo.calledMove ?? null, fo.cancelReason ?? null);

    const firstActorHp = order[0] === "you" ? s.yourHpPct : s.oppHpPct;
    const secondActorHp = order[0] === "you" ? s.oppHpPct : s.yourHpPct;
    if (firstActorHp <= 0 || secondActorHp <= 0) {
      snapHp(ctx, s);
      advanceTurn(s);
      results.push({ p: fo.p, state: s, label: `${firstLabel} (opp never acts — KO)` });
      continue;
    }

    let secondMove = order[1] === "you" ? yourMove : oppMove;
    let secondMoveData = order[1] === "you" ? yourMoveData : oppMoveData;
    // B2b batch 9: MAGIC COAT'S BOUNCE. If the FIRST actor set bounceMove this
    // turn and the second actor then uses a magic-coat-affected status move,
    // the move is reflected: it resolves with the second actor as BOTH user and
    // target (BattleScript_MagicCoatBounce, via the MOVE_TARGET check in
    // Cmd_attackcanceler). Only FLAG_MAGIC_COAT_AFFECTED moves bounce, which is
    // a generated flag (move-flags.js), not a hand-kept list.
    let bounced = false;
    if (s[order[0] === "you" ? "youBouncing" : "oppBouncing"]
        && secondMoveData.power === 0
        && moveFlags(secondMove).magicCoatAffected) {
      bounced = true;
    }
    const secondTargetCharging = order[1] === "you" ? s.oppCharging : s.youCharging;
    // B8d: what the first action changed is visible to the second.
    const ctx2 = resolutionChanged(state, s) ? reResolve(ctx, s) : ctx;
    const secondOutcomes = enumerateActionOutcomes(ctx2, s, order[1], secondMove, secondMoveData, secondTargetCharging, true);

    for (const so of secondOutcomes) {
      let s2 = cloneState(s);
      if (so.confTick) applyConfusionTick(s2, order[1], so.confTick);
      // A bounced move is applied with the BOUNCER as the actor -- which in this
      // engine is exactly "it landed on the original user", since every executor
      // targets the actor's foe. The judging then has to be put back where it
      // belongs: the move was still USED by the second actor, so its Mind and
      // Skill deltas are transferred below rather than credited to the bouncer.
      const applyAs = bounced ? order[0] : order[1];
      const judgeBefore = bounced
        ? { mindYou: s2.mindYou, mindOpp: s2.mindOpp, skillYou: s2.skillYou, skillOpp: s2.skillOpp }
        : null;
      const bidePre2 = (s2.youLock?.kind === "bide" || s2.oppLock?.kind === "bide") ? bideSnapshot(s2) : null; // only while someone is biding: accumulation needs the lock BEFORE the action
      applyMove(ctx2, s2, applyAs, secondMove, so.hit, so.selfHit, so.secondaryTriggered, so.statusPrevented, so.thawed, so.endureTriggered, so.sleepRemaining ?? null, so.sleepDuration ?? null, so.protectTriggered ?? false, so.blockedByProtect ?? false, so.attractPrevented ?? false, so.attractGenderCompatible ?? null, so.hitCount ?? null, so.focusBanded ?? false, so.disableTimer ?? null, so.calledMove ?? null, so.variablePower ?? null, so.cancelReason ?? null, so.lockTurns ?? null, so.contactProc ?? null, so.contactSleep ?? null, so.crit ?? 0, so.roll ?? null);
      if (bidePre2) bideAccumulate(ctx2, s2, bidePre2);
      if (bounced) {
        // Move the judging back onto the mon that actually chose the move.
        const dMind = order[0] === "you" ? s2.mindYou - judgeBefore.mindYou : s2.mindOpp - judgeBefore.mindOpp;
        const dSkill = order[0] === "you" ? s2.skillYou - judgeBefore.skillYou : s2.skillOpp - judgeBefore.skillOpp;
        if (order[0] === "you") { s2.mindYou -= dMind; s2.skillYou -= dSkill; s2.mindOpp += dMind; s2.skillOpp += dSkill; }
        else { s2.mindOpp -= dMind; s2.skillOpp -= dSkill; s2.mindYou += dMind; s2.skillYou += dSkill; }
      }
      const secondLabel = ctx.noLabels ? "" : (bounced ? "bounced: " : "") + describeAction(order[1], secondMove, so.hit, so.selfHit, so.statusPrevented, so.attractPrevented, so.hitCount ?? null, so.calledMove ?? null, so.cancelReason ?? null);
      // B8c: Shed Skin's 1/3 is drawn HERE, before the end-of-turn effects,
      // because it acts at their ABILITIES checkpoint -- ahead of the residuals.
      const bothUp = s2.yourHpPct > 0 && s2.oppHpPct > 0;
      const ctx3 = resolutionChanged(s, s2) ? reResolve(ctx2, s2) : ctx2; // B8d: and the end of turn sees both actions' changes
      const eot = bothUp ? shedSkinBranches(ctx3, s2) : NO_SHED_SKIN;
      for (const eb of eot) {
        const s3 = eot.length > 1 ? cloneState(s2) : s2;
        if (bothUp) applyEndOfTurnEffects(ctx3, s3, eb.cure);
        // B3 batch 5b: Future Sight releases AFTER the end-of-turn effects
        // (HandleWishPerishSongOnTurnEnd, case 0) and BEFORE the Arena judges
        // (case 2 of the same function) -- so a turn-1 Future Sight lands before
        // turn 3 is judged. Its accuracy roll and Focus Band are real branches.
        for (const fb of futureSightRelease(ctx3, s3)) {
          snapHp(ctx, fb.state); // end-of-turn residuals and Future Sight
          advanceTurn(fb.state);
          results.push({ p: fo.p * so.p * eb.p * fb.p, state: fb.state, label: `${firstLabel}; ${secondLabel}${eb.label ?? ""}${fb.label}` });
        }
      }
    }
  }

  return results;
}

// B3 batch 4d: ENDTURN_UPROAR for one side whose lock is an Uproar.
function endTurnUproar(s, side, you, opp) {
  for (const [sd, mon] of [["you", you], ["opp", opp]]) {
    const stKey = sd === "you" ? "youStatus" : "oppStatus";
    if (s[stKey] === "sleep" && mon.ability !== "Soundproof") {
      s[stKey] = null;
      s[sd === "you" ? "youSleepTurns" : "oppSleepTurns"] = null;
      s[sd === "you" ? "youNightmared" : "oppNightmared"] = false; // :1634
    }
  }
  const lockKey = side === "you" ? "youLock" : "oppLock";
  const n = s[lockKey].n - 1;
  if (s.turnFlags & (side === "you" ? TF_YOU_UNABLE : TF_OPP_UNABLE) || n === 0) {
    cancelMultiTurnMoves(s, side);
  } else {
    s[lockKey] = { ...s[lockKey], n };
  }
}

// B3 batch 3: ENDTURN_THRASH for one side whose lock is a Rampage.
function endTurnThrash(s, side, mon) {
  const lockKey = side === "you" ? "youLock" : "oppLock";
  const n = s[lockKey].n - 1;
  if (s.turnFlags & (side === "you" ? TF_YOU_UNABLE : TF_OPP_UNABLE)) {
    cancelMultiTurnMoves(s, side);
  } else if (n === 0) {
    s[lockKey] = null;
    const confKey = side === "you" ? "youConfused" : "oppConfused";
    if (!s[confKey] && mon.ability !== "Own Tempo") s[confKey] = true;
  } else {
    s[lockKey] = { ...s[lockKey], n };
  }
}

// B8c: SHED SKIN (src/battle_util.c:2620-2640): a holder with ANY major status
// cures it with `Random() % 3 == 0`, each end of turn. Drawn per side; a side
// with nothing to cure is not branched.
// The common case is returned as ONE shared object: this runs at every node's
// turn end, and a fresh array there is a per-node allocation (measured +5.9%).
const NO_SHED_SKIN = Object.freeze([Object.freeze({ p: 1, cure: null })]);
function shedSkinBranches(ctx, s) {
  const y = ctx.you.ability === "Shed Skin" && s.youStatus != null && s.yourHpPct > 0;
  const o = ctx.opp.ability === "Shed Skin" && s.oppStatus != null && s.oppHpPct > 0;
  if (!y && !o) return NO_SHED_SKIN;
  const out = [];
  for (const yc of y ? [true, false] : [false]) {
    for (const oc of o ? [true, false] : [false]) {
      const p = (y ? (yc ? 1 / 3 : 2 / 3) : 1) * (o ? (oc ? 1 / 3 : 2 / 3) : 1);
      out.push({ p, cure: { you: yc, opp: oc }, label: (yc ? " (You shed its status)" : "") + (oc ? " (Opp sheds its status)" : "") });
    }
  }
  return out;
}

// B3 batch 5b: the Future Sight release (src/battle_util.c:1796-1826 +
// BattleScript_MonTookFutureAttack, data/battle_scripts_1.s:3508-3545), for
// each target side in battler order. The counter drops every turn end; at 0,
// on a target still standing:
//   accuracycheck with TODAY's stages (90 Future Sight, 85 Doom Desire) --
//     a semi-invulnerable target dodges, a Lock-On lands
//   adjustnormaldamage2: the roll, and Focus Band (Endure was cleared by
//     TurnValuesCleanUp(TRUE) before this runs)
//   datahpupdate: a Substitute takes it; HITMARKER_IGNORE_BIDE is set
//   MOVEEND_RAGE, then the item move-end checks
// It ends in `end2`, not Cmd_end, so NO Arena Skill is scored for it.
// No typecalc anywhere, so it hits Dark types.
function futureSightRelease(ctx, s) {
  let out = [{ p: 1, state: s, label: "" }];
  if (!(s.youFutureSight || s.oppFutureSight)) return out;
  for (const side of ["you", "opp"]) {
    const next = [];
    for (const br of out) next.push(...futureSightReleaseSide(ctx, br, side));
    out = next;
  }
  return out;
}
function futureSightReleaseSide(ctx, br, side) {
  const s = br.state;
  const fsKey = side === "you" ? "youFutureSight" : "oppFutureSight";
  const fs = s[fsKey];
  if (!fs) return [br];
  const n = fs.n - 1;
  if (n > 0) { s[fsKey] = { ...fs, n }; return [br]; }
  s[fsKey] = null;
  const hpKey = side === "you" ? "yourHpPct" : "oppHpPct";
  if (s[hpKey] <= 0) return [br];

  const target = side === "you" ? ctx.you : ctx.opp;
  const attacker = side === "you" ? ctx.opp : ctx.you;
  const tStages = side === "you" ? s.youStages : s.oppStages;
  const aStages = side === "you" ? s.oppStages : s.youStages;
  const charging = side === "you" ? s.youCharging : s.oppCharging;
  let pHit;
  if (charging?.invulnBit) pHit = 0;
  else if (s[side === "you" ? "youAlwaysHitTurns" : "oppAlwaysHitTurns"] != null) pHit = 1;
  else {
    const foresighted = side === "you" ? s.youForesighted : s.oppForesighted;
    const acc = accuracyCalc(MOVES[fs.move].accuracy, aStages.accuracy, foresighted ? 0 : tStages.evasion,
      attacker.ability, target.ability, itemData(target.item), effectiveWeather(s, ctx.you, ctx.opp), false);
    pHit = Math.min(1, acc / 100);
  }
  const res = [];
  if (pHit < 1) res.push({ p: br.p * (1 - pHit), state: s, label: `${br.label} (${fs.move} misses)` });
  // F31: exact-roll mode draws adjustnormaldamage2's roll here too.
  const rollArms = ctx.exactRoll
    ? ROLL_VALUES.map((v) => [1 / 16, Math.max(1, Math.floor((fs.dmg * v) / 100))])
    : [[1, Math.max(1, Math.floor(fs.dmg * 0.925))]]; // the battle path's point-estimate roll
  if (pHit > 0) for (const [pr, dmg] of rollArms) {
    const subKey = side === "you" ? "youSubstituteHP" : "oppSubstituteHP";
    const hpNow = Math.round((s[hpKey] / 100) * target.stats.hp);
    const fb = itemData(target.item);
    const bandable = s[subKey] == null && dmg >= hpNow && fb && fb.holdEffect === "HOLD_EFFECT_FOCUS_BAND";
    const arms = bandable
      ? [[fb.param / FOCUS_BAND_SPACE, true], [1 - fb.param / FOCUS_BAND_SPACE, false]]
      : [[1, false]];
    for (const [pa, banded] of arms) {
      const t = cloneState(s);
      if (t[subKey] != null) {
        t[subKey] -= dmg;
        if (t[subKey] <= 0) t[subKey] = null;
      } else {
        const hit = banded ? Math.max(0, hpNow - 1) : dmg;
        t[hpKey] = hpSub(t[hpKey], hit, target.stats.hp);
        // MOVEEND_RAGE (src/battle_script_commands.c:4240-4255) runs for it.
        if (t[side === "you" ? "youRaging" : "oppRaging"] && t[hpKey] > 0 && tStages.atk < 6) {
          bumpStage(side === "you" ? t.youStages : t.oppStages, "atk", 1);
        }
        // MOVEEND_ITEM_EFFECTS_ALL: the HP-threshold items get their check now.
        if (t[hpKey] > 0) tryEndOfTurnItem(t, side, target);
      }
      res.push({ p: br.p * pHit * pr * pa, state: t, label: `${br.label} (${fs.move} hits${banded ? ", Focus Band" : ""})` });
    }
  }
  return res;
}

// B3 batch 4c: gBideDmg. Cmd_datahpupdate adds every HP loss a battler takes
// to its Bide total (src/battle_script_commands.c:1903-1916) -- hits, recoil,
// crash damage, a confusion self-hit -- EXCEPT under HITMARKER_IGNORE_BIDE,
// which end-of-turn residuals (src/battle_util.c:1468), Wish/Perish/Future
// Sight (:1787) and weather (BattleScript_DamagingWeatherLoop) all set. So it
// is measured around each ACTION here, never at end of turn. It counts only
// while the mon was already biding before the action and still is after it:
// damage taken before setbide on the set turn does not count (setbide zeroes
// it), and the unleash itself clears the lock.
function bideSnapshot(s) {
  return { yh: s.yourHpPct, oh: s.oppHpPct, yb: s.youLock?.kind === "bide", ob: s.oppLock?.kind === "bide" };
}
function bideAccumulate(ctx, s, pre) {
  if (pre.yb && s.youLock?.kind === "bide") {
    const lost = Math.round((pre.yh / 100) * ctx.you.stats.hp) - Math.round((s.yourHpPct / 100) * ctx.you.stats.hp);
    if (lost > 0) s.youLock = { ...s.youLock, dmg: s.youLock.dmg + lost };
  }
  if (pre.ob && s.oppLock?.kind === "bide") {
    const lost = Math.round((pre.oh / 100) * ctx.opp.stats.hp) - Math.round((s.oppHpPct / 100) * ctx.opp.stats.hp);
    if (lost > 0) s.oppLock = { ...s.oppLock, dmg: s.oppLock.dmg + lost };
  }
}

// B3 batch 7a: the bits of state.volFlags, keyed by the field names they
// replace so call sites and overrides read the same way they always did.
const VF = {
  youMudSport: 1, oppMudSport: 2, youWaterSport: 4, oppWaterSport: 8,
  youFocusEnergy: 16, oppFocusEnergy: 32, youMinimized: 64, oppMinimized: 128,
  youDefenseCurled: 256, oppDefenseCurled: 512, youPerishSonged: 1024, oppPerishSonged: 2048,
  // B8c: gDisableStructs.truantCounter -- set means "loafs on its next action".
  youTruantLoaf: 4096, oppTruantLoaf: 8192,
  // Phase D F4: STATUS2_ESCAPE_PREVENTION (Mean Look / Block / Spider Web).
  youCantEscape: 16384, oppCantEscape: 32768,
};
function vf(s, name) {
  const bit = VF[name];
  if (bit === undefined) throw new Error(`vf: "${name}" is not a volFlags bit`);
  return (s.volFlags & bit) !== 0;
}
function setVf(s, name, on) {
  const bit = VF[name];
  if (bit === undefined) throw new Error(`setVf: "${name}" is not a volFlags bit`);
  s.volFlags = on ? (s.volFlags | bit) : (s.volFlags & ~bit);
}

// B3 batch 4b: the bits of state.turnFlags (see buildStartState).
const TF_YOU_FLINCHED = 1, TF_OPP_FLINCHED = 2, TF_YOU_UNABLE = 4, TF_OPP_UNABLE = 8;

// The bookkeeping every successor state needs, in one place (B3 batch 2; the
// two call sites used to repeat the first two lines by hand).
function advanceTurn(s) {
  s.turn += 1;
  // batch-4 decay: any successor turn is past the mon's first turn (see
  // buildStartState). B3 batch 2 adds the player's side of the same counter.
  s.oppMonFirstTurn = false;
  s.youMonFirstTurn = false;
  // STATUS2_FLINCHED is cleared for every battler at the end of the turn
  // (src/battle_main.c:3943).
  s.turnFlags = 0;
  // rechargeTimer (src/battle_main.c:4878-4883). Written out per side on
  // purpose: this runs on every successor state, and a loop building the key
  // by string concatenation measured 26 ms of self time on one heavy set.
  if (s.youRecharge) s.youRecharge = s.youRecharge.timer > 1 ? { ...s.youRecharge, timer: s.youRecharge.timer - 1 } : null;
  if (s.oppRecharge) s.oppRecharge = s.oppRecharge.timer > 1 ? { ...s.oppRecharge, timer: s.oppRecharge.timer - 1 } : null;
}

function evaluateTerminal(state) {
  if (state.yourHpPct <= 0 && state.oppHpPct <= 0) return 0.5;
  if (state.yourHpPct <= 0) return 0;
  if (state.oppHpPct <= 0) return 1;

  const mindWin = state.mindYou > state.mindOpp ? 2 : state.mindYou < state.mindOpp ? 0 : 1;
  const skillWin = state.skillYou > state.skillOpp ? 2 : state.skillYou < state.skillOpp ? 0 : 1;
  // Body is judged on TRUNCATED INTEGER percentages RELATIVE TO EACH SIDE'S
  // OWN ROUND-START HP in source, not raw floats and not relative to max HP:
  // ShowJudgmentSprite's ARENA_CATEGORY_BODY branch (src/battle_arena.c:
  // 530-533) computes `(gBattleMons[battler].hp * 100) / hpAtStart[battler]`
  // as C integer division (hp/hpAtStart are both u16 -> promoted to int),
  // truncating toward zero BEFORE the two sides are ever compared
  // (battle_arena.c:536-557). hpAtStart is HP at SWITCH-IN for this specific
  // 1v1 (BattleArena_InitPoints, battle_arena.c:569-581), NOT max HP — see
  // the long comment on buildStartState's yourHpPctAtStart/oppHpPctAtStart
  // parameters for the full trace (both InitPoints call sites, why it's
  // never re-baselined mid-round, and the known UI gap). A mon that starts a
  // round below max HP and heals during it can legitimately push this ratio
  // ABOVE 100 — capping at 100 (as this engine's yourHpPct/oppHpPct tracking
  // correctly does for "% of max HP" purposes elsewhere) would UNDER-state
  // that recovery relative to what pokeemerald actually judges. So the ratio
  // is computed HERE, at judgment time only — yourHpPct/oppHpPct themselves
  // stay exactly as tracked (% of max HP, still capped at 100 by their own
  // write sites) for every other purpose (damage calc, Flail/Reversal power,
  // etc.), and only this comparison rescales.
  //
  // Math.floor here is deliberately NOT Math.trunc and NOT removable as
  // "redundant": it's only equivalent to trunc-toward-zero because both
  // ratios are non-negative (guaranteed by the <= 0 early returns above,
  // which route fainted-side cases to a win/loss/draw before bodyWin is ever
  // computed, and by yourHpPctAtStart/oppHpPctAtStart never being 0 in any
  // reachable state) — do not simplify this away.
  // A8: source compares INTEGER HP -- (hp * 100) / hpAtStart in C integer
  // division (src/battle_arena.c:531-532). This engine carries HP as a float
  // percentage of max HP, and the percentage always encodes an exact integer HP
  // (every delta is an integer amount converted to a percentage; measured max
  // representation error 8.5e-14 over 1,075,339 leaves). But the DIVISION is
  // not exact: 88/176 comes out as 49.99999999999999, and Math.floor turns a
  // Body of 50 into 49. sim-audit.md §3.3 measured 4,262 such wrong Body
  // numbers across 2,150,678 computations -- collapsing to 3 flipped Body
  // categories and 0 flipped match verdicts, so the defect was real and its
  // measured impact was zero. Fixed anyway: it stays harmless only until an
  // exhaustive enumeration reaches the position where it is not.
  //
  // Rounding to 1e-9 before flooring removes the ULP noise without changing any
  // genuine value -- the true ratios are integers divided by integers well
  // inside that tolerance.
  const bodyPct = (hp, atStart) => Math.floor(Math.round((hp / atStart) * 100 * 1e9) / 1e9);
  const yourBody = bodyPct(state.yourHpPct, state.yourHpPctAtStart);
  const oppBody = bodyPct(state.oppHpPct, state.oppHpPctAtStart);
  const bodyWin = yourBody > oppBody ? 2 : yourBody < oppBody ? 0 : 1;
  const total = mindWin + skillWin + bodyWin;
  if (total > 3) return 1;
  if (total < 3) return 0;
  return 0.5;
}

// Secondary sort key for search()'s move ranking, used ONLY to break ties
// (see below) — never to override a genuine winProb difference. Estimates
// how much raw damage "you" would deal RIGHT NOW with this move, using the
// actual current stages/weather/status, the same calcDamage function used
// everywhere else. Status moves (power=0, e.g. Destiny Bond/Calm Mind) score
// 0 here — correct for tie-breaking purposes, since among moves that are
// ALL win-guaranteed (or all loss-guaranteed), an attacking move is always
// at least as informative a recommendation as a non-damaging one.
function moveTiebreakScore(ctx, state, moveName) {
  const moveData = battleMoveData(ctx.you, moveName);
  if (moveData.power === 0) return 0;
  const atkStatKey = moveData.category === "physical" ? "atk" : "spa";
  const defStatKey = moveData.category === "physical" ? "def" : "spd";
  const screenActive = moveData.category === "physical" ? state.oppReflectTurns != null : state.oppLightScreenTurns != null;
  const opts = {
    atkStage: state.youStages[atkStatKey], defStage: state.oppStages[defStatKey],
    attackerBurned: state.youStatus === "burn",
    attackerFlashFireActive: state.youFlashFireActive,
    attackerHpPct: state.yourHpPct,
    screenActive,
    weather: effectiveWeather(state, ctx.you, ctx.opp),
    defenderForesighted: state.oppForesighted,
    attackerStatus: state.youStatus, defenderStatus: state.oppStatus,
  };
  // C2 (found by the full grid): a move whose power is an ENUMERATED draw
  // (Magnitude, Present, Psywave) or a counter the action derives (Fury
  // Cutter, Rollout, Triple Kick) cannot be priced without one. This is only a
  // tie-break between equal P(win)s, so it takes the draws' expected damage
  // (Present's heal arm counting 0) and the counter moves' first-hit power --
  // deterministic, and nothing here reaches a P(win). Reachable once the
  // player holds such a move, e.g. through Mimic.
  const draws = VARIABLE_DAMAGE_DRAWS[moveData.effect];
  if (draws) {
    return draws.reduce((a, d) => a + (d.power === "heal" ? 0 : d.p * calcDamage(ctx.you, ctx.opp, moveName, { ...opts, variablePower: d.power })), 0);
  }
  if (COUNTER_POWER_EFFECTS.has(moveData.effect)) return calcDamage(ctx.you, ctx.opp, moveName, { ...opts, variablePower: moveData.power });
  // Bide deals twice what it stored, and has stored nothing unless it is biding.
  if (moveData.effect === "EFFECT_BIDE") return state.youLock?.kind === "bide" ? 2 * state.youLock.dmg : 0;
  return calcDamage(ctx.you, ctx.opp, moveName, opts);
}

// C1 (amendment 13): `retain` = false is the HEADLESS mode. The search is the
// same expectimax, in the same order, with the same sort and tie-break -- so the
// winProb and the move are bit-identical -- but no node keeps its branches,
// their states or their subtrees. A retained tree for a heavy cell held
// gigabytes (Gengar vs Hariyama 2: 2.8 GB after the call, B4b); headless, the
// live set is one root-to-leaf path of transient resolveTurn arrays. Batch
// tools use it; the site and team-workflow, which read the tree, keep the
// default.
// B6 step 1 (amendment 14): the TRANSPOSITION TABLE. search(ctx, state, turns)
// is a pure function of the state -- the AI's choice, the player's options and
// every roll read nothing else -- so a state reached by two different paths has
// one value, computed once. `tt` is a Map scoped to one analyzeMatchup call.
// Headless it stores the result; RETAINED (B6-2) it stores the node itself,
// so a position reached by two paths is ONE shared subtree -- the tree becomes
// a DAG, which every reader (printTree, team-workflow's leaf walk) already
// handles, since each multiplies by its own branch probability. B6-2's crits
// roughly doubled retained trees and pushed the heaviest past the default heap;
// sharing brings them back. Terminal nodes are not stored: evaluateTerminal is
// cheaper than a key.
//
// The key is the state with its turn-scoped fields dropped: the damage-taken
// records, Endure, Protect, Destiny Bond and Magic Coat's bounce are reset by
// resolveTurnWithOrder before anything reads them (freshTurnDamageTracking),
// and nothing between here and there -- move selection, the AI, turn order --
// reads them. Two states differing only in those are the same position.
function ttKey(turnsRemaining, state) {
  const { youDamageTaken, oppDamageTaken, youEndureActive, oppEndureActive, youProtected, oppProtected,
    youDestinyBondActive, oppDestinyBondActive, youBouncing, oppBouncing, ...rest } = state;
  return turnsRemaining + "|" + JSON.stringify(rest);
}
function search(ctx, state, turnsRemaining, retain = true, tt = null, prune = false) {
  if (turnsRemaining === 0 || state.yourHpPct <= 0 || state.oppHpPct <= 0) {
    const winProb = evaluateTerminal(state);
    return retain ? { winProb, move: null, isTerminal: true, state } : { winProb, move: null, isTerminal: true };
  }
  let key = null;
  if (tt) {
    key = ttKey(turnsRemaining, state);
    const hit = tt.get(key);
    if (hit) return hit;
  }

  // A charging mon (mid-Dive/Fly/Dig) has no real choice — the game forces
  // the same move again automatically (source-confirmed, no action menu).
  // B3 batch 1: so does a RECHARGING one, through the same branch of source
  // (STATUS2_MULTIPLETURNS || STATUS2_RECHARGE, src/battle_main.c:4160-4165 and
  // src/battle_util.c:107-110). The AI is not consulted and the player has no
  // menu; without this the recharge turn's Mind score followed whatever move
  // the search or the AI happened to pick.
  // B3 batch 3: and so does a mon locked into Rampage or Rollout
  // (STATUS2_MULTIPLETURNS, the same branch again).
  const oppForced = state.oppCharging ? state.oppCharging.move : (state.oppRecharge?.move || state.oppLock?.move);
  const youForced = state.youCharging ? state.youCharging.move : (state.youRecharge?.move || state.youLock?.move);
  // F14: the opponent's choice per Quick Claw outcome (aiTurnPlans). A forced
  // move asks no AI, so its turn marginalises the draw in resolveTurn.
  // F2c: the AI's decision records the player's last move into its history.
  state = aiDecisionState(state);
  const plans = oppForced
    ? [{ p: 1, qc: undefined, cands: [{ move: oppForced, prob: 1 }] }]
    : aiTurnPlans(effectiveCtx(ctx, state), state);
  const yourMoveChoices = youForced ? [youForced]
    : (() => { const ec = effectiveCtx(ctx, state); return selectableMoves(ec.you.moves, state, "you", ec.opp, "you"); })();

  // C2: PRUNING (opt-in, headless only). P(win) is at most 1, so while an
  // option's expectation is being summed, `expected + (1 - weight seen)` bounds
  // it from above; once that bound is below the best option found by more than
  // the tie epsilon, the option can neither win nor tie and its remaining
  // branches are skipped. The winning option is always evaluated in full, so
  // the returned winProb and move are unchanged (the pick below is independent
  // of evaluation order); only the LOSING options' values become bounds.
  // Pruning is strongest when the best option comes first, so the player's
  // moves are tried in descending estimated damage.
  const options = [];
  let best = -Infinity;
  const tryOrder = prune && yourMoveChoices.length > 1
    ? yourMoveChoices.map((m) => [m, moveTiebreakScore(ctx, state, m)]).sort((x, y) => y[1] - x[1]).map((x) => x[0])
    : yourMoveChoices;
  for (const yourMove of tryOrder) {
    let expected = 0;
    let seen = 0;
    let cut = false;
    const branches = [];
    for (const { move: oppMove, prob: oppProb, planP, qc } of plans.flatMap((pl) => pl.cands.map((c) => ({ ...c, planP: pl.p, qc: pl.qc })))) {
      const raw = resolveTurn(ctx, state, yourMove, oppMove, { qc });
      for (const b of raw) {
        const weight = b.p * oppProb * planP;
        const sub = search(ctx, b.state, turnsRemaining - 1, retain, tt, prune);
        expected += weight * sub.winProb;
        seen += weight;
        if (retain) branches.push({ prob: weight, label: b.label, state: b.state, subtree: sub });
        if (prune && expected + Math.max(0, 1 - seen) + 1e-9 < best - 1e-6) { cut = true; break; }
      }
      if (cut) break;
    }
    if (cut) { options.push({ move: yourMove, winProb: expected + Math.max(0, 1 - seen), pruned: true }); continue; }
    if (expected > best) best = expected;
    if (retain) {
      branches.sort((a, b) => b.prob - a.prob);
      options.push({ move: yourMove, winProb: expected, branches });
    } else {
      options.push({ move: yourMove, winProb: expected });
    }
  }
  // Primary key: winProb (descending) — the real decision criterion, never
  // overridden. Secondary key (ONLY within floating-point-noise distance,
  // e.g. two branches of a guaranteed win/loss that differ by ~1e-16 from
  // summation order): raw current damage, descending. Without this, a
  // stable sort on exactly-tied winProbs falls back to whatever order the
  // mon's moves happen to be listed in, which can surface a 0-damage
  // immune-type move as "the" recommendation purely by coincidence — a real
  // coaching-quality bug, not a scoring bug (the winProb itself was correct;
  // it's genuinely a guaranteed win/loss regardless of move, but the tool
  // must still recommend something sensible rather than something arbitrary).
  const WINPROB_TIE_EPSILON = 1e-6;
  // The pick, as a well-defined rule (C2): the maximum P(win) among the
  // options evaluated in full; every option within WINPROB_TIE_EPSILON of it is
  // tied, and a tie goes to the higher damage estimate, then the earlier move
  // in selection order. The in-place sort this replaces used the same keys, but
  // an epsilon comparator is not transitive, so its answer could depend on the
  // input order -- which pruning and move ordering change. Pruned options never
  // take part; the rest follow the pick by P(win).
  const full = options.filter((o) => !o.pruned);
  const maxV = Math.max(...full.map((o) => o.winProb));
  const idx = (m) => yourMoveChoices.indexOf(m);
  const pick = full.filter((o) => o.winProb >= maxV - WINPROB_TIE_EPSILON)
    .sort((a, b) => (moveTiebreakScore(ctx, state, b.move) - moveTiebreakScore(ctx, state, a.move)) || (idx(a.move) - idx(b.move)))[0];
  options.sort((a, b) => (a === pick ? -1 : b === pick ? 1 : (b.winProb - a.winProb) || (idx(a.move) - idx(b.move))));

  if (!retain) {
    const res = { move: options[0].move, winProb: options[0].winProb, isTerminal: false, allOptions: options };
    if (tt) tt.set(key, res);
    return res;
  }
  const node = {
    move: options[0].move,
    winProb: options[0].winProb,
    isTerminal: false,
    allOptions: options,
    branches: options[0].branches,
  };
  if (tt) tt.set(key, node);
  return node;
}

function printTree(node, indent = "", turnLabel = "Turn", minProb = 0.02) {
  if (node.isTerminal) {
    const s = node.state;
    console.log(`${indent}[end] you ${s.yourHpPct.toFixed(1)}% / opp ${s.oppHpPct.toFixed(1)}% ` +
      `| Mind ${s.mindYou}-${s.mindOpp} | Skill ${s.skillYou}-${s.skillOpp} ` +
      `| P(win)=${node.winProb.toFixed(2)}`);
    return;
  }
  console.log(`${indent}${turnLabel}: play ${node.move}  [P(win)=${node.winProb.toFixed(3)}]`);
  for (const branch of node.branches) {
    if (branch.prob < minProb) continue;
    console.log(`${indent}  ├─ (${(branch.prob * 100).toFixed(0)}%) ${branch.label}`);
    printTree(branch.subtree, indent + "  │    ", "then", minProb);
  }
}

// Public entry point: run a full 1v1 analysis given two mon configs and
// starting HP percentages. This is what a UI / another module would call.
// yourUsablePartyMons: a PER-MATCHUP INPUT, not a fixed constant — exactly
// like yourHpPct/oppHpPct above. It's how many of the player's OTHER 2 team
// slots are still alive going into THIS SPECIFIC matchup. Defaults to 2
// because a standalone analyzeMatchup() call has no run context and "fresh
// team, nothing fainted yet" is the only sane default — but a real 3-matchup
// Arena run must pass 2 for the first matchup, then 1 or 0 for later ones as
// earlier reserves faint (mirroring how yourHpPct carries a mon's damage
// forward). The team-workflow builder (HANDOFF §7 step 5) MUST decrement
// this across chained matchups, or every matchup after the first will silently
// score Roar/phazing moves as if the team were still fully healthy. Feeds
// EFFECT_ROAR's scoring (see chooseOpponentMoves) — the AI sees this real
// count, Arena-blind (see the source citation on AI_HANDLERS.EFFECT_ROAR).
// oppUsablePartyMons: the SAME per-matchup concept, mirrored for the
// opponent's own reserves — feeds AI_CBM_BatonPass's count_usable_party_mons
// (AI_USER) check. Defaults to 2 for the same reason; we don't currently
// model the opponent's full 3-mon Frontier roster (only the one named set
// being analyzed), so this is a simplifying assumption until that's tracked.
// C1: `tree: false` runs the search headless (see search) -- the result
// carries move, winProb and allOptions[{move, winProb}], and no branches.
// Phase D F11: a Frontier trainer's mon is built as FillTrainerParty builds it
// (src/battle_tower.c:1739-1748): friendship MAX_FRIENDSHIP (255), but 0 if the
// set carries Frustration. This used to force 255 on every opponent, so an
// opponent's Frustration hit at power 0 in every solved cell.
function buildFrontierOpponent(oppConfig) {
  return buildMon({ ...oppConfig, friendship: (oppConfig.moves ?? []).includes("Frustration") ? 0 : 255 });
}

function analyzeMatchup(youConfig, oppConfig, { yourHpPct = 100, oppHpPct = 100, yourHpPctAtStart = yourHpPct, oppHpPctAtStart = oppHpPct, yourUsablePartyMons = 2, oppUsablePartyMons = 2, tree = true, transposition = true, prune = false } = {}) {
  const you = buildMon(youConfig);
  const opp = buildFrontierOpponent(oppConfig);
  // C2: headless, nothing reads a branch's label, so none are built.
  const ctx = tree ? { you, opp } : { you, opp, noLabels: true };
  const state = buildStartState({ yourHpPct, oppHpPct, yourHpPctAtStart, oppHpPctAtStart, yourUsablePartyMons, oppUsablePartyMons, you, opp });
  // `transposition: false` exists for MEASUREMENT only (test-c1-headless's
  // memory control); every caller uses the default.
  const result = search(ctx, state, 3, tree, transposition ? new Map() : null, prune && !tree);
  return { you, opp, result };
}

export {
  buildMon, calcDamage, calcConfusionDamage, typeEffectiveness,
  // amendment 16: the site's Hidden Power type picker lists exactly these
  HIDDEN_POWER_TYPES,
  // Phase D: the differential harness asks the AI exactly as search() does
  effectiveCtx,
  // B7a: surfaced so the test can pin the stage arithmetic to source's integer
  // form directly, instead of inferring it through damage.
  applyStatStage,
  // Intimidate: surfaced so its Substitute guard can be unit-tested directly.
  // That branch is UNREACHABLE from buildStartState (Intimidate is applied to
  // the base state before overrides, and a fresh state has no substitute), so
  // asserting it through the integration path would be asserting nothing.
  intimidateBlocked,
  // B7c: the accuracy chain, surfaced so the test can pin each multiplier and
  // the UNCAPPED ordering directly rather than inferring them from hit rates.
  accuracyCalc,
  scoreOpponentMove, scoreOpponentMoveDist, chooseOpponentMoves,
  // Phase D F13: the interpreter path, and the view it reads.
  chooseOpponentMovesInterp, chooseOpponentMovesHandlers, buildAiView, selectableMoves,
  aiDecisionState, recordTargetMoveHistory, // Phase D F2c
  typeCalcRows, // F17
  aiTurnPlans, // F14
  EFFECTIVENESS_CLEARED_EFFECTS, // F21
  TRICK_UNSWAPPABLE, // F25
  // Phase D F2b: pinned to the script's list by its test.
  THIEF_ENCOURAGED_HOLD_EFFECTS,
  // A2: the AI damage-roll enumeration, surfaced so tests and solver tools can
  // assert on the roll classes directly instead of re-deriving them.
  enumerateAiRollOutcomes, AI_SIM_ROLLS, buildAiDamageState,
  buildStartState, resolveTurn, search, printTree,
  // B3 batch 7a: the volFlags accessor, for tests that inspect a folded flag.
  vf, VF,
  analyzeMatchup, MOVES, AI_HANDLERS, evaluateTerminal,
  // Phase D F11: the opponent as the ROM builds it (friendship by Frustration).
  buildFrontierOpponent,
  // the site's Attract-pair gate reads the engine's own gender rule
  resolveGenderDist,
  // Change #11 guard tables — exported so the coverage test pins them to the
  // live pool rather than duplicating them.
  HANDLED_EFFECTS, ACCEPTED_UNMODELED_EFFECTS,
  // Arena-judge scoring primitives — surfaced (pure functions, no logic
  // change) so the DRIVE-model scorekeeper (scorekeeper.js) can bank a
  // reported turn's Mind/Skill by calling the ENGINE'S OWN scoring, never a
  // reimplementation. applyMove is exported for the equivalence test's
  // ground-truth branch deltas (it is the sole Mind/Skill banker resolveTurn
  // uses — see logic.js:4068/4086; end-of-turn effects never touch score).
  mindDelta, skillDelta, classifyOutcome, resolveAbilityInteraction, applyMove,
  // A10: surfaced so scorekeeper.js derives a two-turn move's invulnerability
  // bit from the same table the engine does, instead of hard-coding one.
  SEMI_INVULN_BIT,
  // A7: the two Arena Skill mechanisms, surfaced so tests assert on the source
  // structure rather than on hand-netted constants.
  arenaSkillDelta, ARENA_DEDUCT_STRINGS, ARENA_ADD_SKILL, ABILITY_BLOCK_SOURCE, ABILITY_BLOCK_SKILL_DELTA,
  // B7: the hold-effect classification, surfaced so the test can assert that
  // every battle hold effect in the ROM sits in exactly one bucket.
  HOLD_EFFECT_DISPOSITION,
};