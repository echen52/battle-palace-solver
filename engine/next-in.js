// ── next-in.js ─────────────────────────────────────────────────────────────
// Who the opponent sends in when the mon you are fighting faints, and how hard
// it hits the mon you have out. Two decomp pieces:
//
// 1. WHO THE TEAMMATES CAN BE. The trainer: GetRandomScaledFrontierTrainerId
//    (src/battle_tower.c:1102-1129) -- uniform over sFrontierTrainerIdRanges
//    [challenge] for battles 1-6, ...Hard[challenge] for battle 7, the last
//    range from challenge 8 on. Its party: FillTrainerParty (:1633-1735) draws
//    monSet[Random() % n] until 3 are kept, rejecting a high-tier mon at level 50
//    (monId > FRONTIER_MONS_HIGH_TIER = 849), a species already in the party, a
//    held item already in the party (ITEM_NONE never clashes) and a repeated
//    index -- so each slot is uniform over the entries still valid, and the lead
//    is party slot 0. Conditioning on the lead you see gives each trainer weight
//    P(trainer) * P(lead | trainer) and each ordered (slot 1, slot 2) pair its
//    draw probability. The trainer's fixed IVs (GetFrontierTrainerFixedIvs)
//    ride along -- they set the replacement's stats.
//    NOT modelled: "trainer not already fought this challenge" (:1083-1091 --
//    needs your challenge history; pass trainerId when you know who it is).
//
// 2. WHICH ONE COMES IN. OpponentHandleChoosePokemon
//    (src/battle_controller_opponent.c:1620-1660) -> GetMostSuitableMonToSwitchInto
//    (src/battle_ai_switch_items.c:629-789), ported line by line:
//    a. typing pass: of the living teammates, take the one YOUR active mon's
//       battle types hit hardest (ModulateByTypeEffectiveness, both of your
//       types in turn, strict >, party order breaks ties -- the source comment
//       notes it picks the type that TAKES the most damage); if it has a move
//       TypeCalc flags super effective against your mon it comes in, else it
//       is struck off and the pass repeats. A teammate your types cannot touch
//       (product 0) is never picked here.
//    b. fallback: the most "damage" over every move of every living teammate:
//       AI_CalcDmg(fainted mon -> your mon) with gCurrentMove, then TypeCalc
//       with the CANDIDATE's move (STAB read off the FAINTED mon's types). The
//       replacement is asked for at the turn's end, after
//       HandleAction_ActionFinished (src/battle_util.c:670) has set gCurrentMove
//       = MOVE_NONE, so CalculateBaseDamage runs with power 0: 0 -> "at least 1"
//       -> +2 = 3 for everyone (src/pokemon.c:3264-3371). Moves of power 1 are
//       skipped (0); status moves still score 3 x STAB x chart. bestDmg is a u8.
//    c. nobody (all 0): the first living teammate in party order.
//    The fresh "openpartyscreen" reset of monToSwitchIntoId
//    (src/battle_script_commands.c:5117) guarantees the pass runs.

import * as L from "./logic.js";
import { FRONTIER_POOL } from "./frontier-pool.js";
import { FRONTIER_TRAINERS, TRAINER_ID_RANGES, TRAINER_ID_RANGES_HARD } from "./frontier-trainers.js";
import { TYPE_EFFECTIVENESS } from "./type-table.js";
import { SPECIES } from "./species-data.js";

const HIGH_TIER = 849; // FRONTIER_MONS_HIGH_TIER, include/constants/battle_frontier_mons.h
const POOL_BY_ID = [];
for (const [key, e] of Object.entries(FRONTIER_POOL)) if (Number.isInteger(e.index)) POOL_BY_ID[e.index] = { key, ...e };
export const poolEntry = (id) => POOL_BY_ID[id];

// The Palace's Frontier Brain, Spenser: a fixed team per symbol, in party
// order (sFrontierBrainsMons[FRONTIER_FACILITY_PALACE], src/frontier_util.c:
// 213-269). CreateFrontierBrainPokemon (frontier_util.c:2497-2547) creates all
// three in that order, every one at the Brain's fixedIV, so slot 0 always
// leads. He comes at win streak 21 (Silver) and 42 (Gold), and with both
// symbols at 21 and every 21 after 42 (sFrontierBrainStreakAppearances
// [PALACE] = {21, 42, 21, 1}, frontier_util.c:90; GetFrontierBrainStatus
// :1656). His battle runs the same AI flags as any Frontier battle
// (BattleAI_SetupFlags, battle_ai_script_commands.c:371).
// Brain sets have no frontier index; they get ids from BRAIN_ID_BASE here.
export const BRAIN_TEAMS = {
  "Spenser Silver": ["Spenser Silver Crobat", "Spenser Silver Slaking", "Spenser Silver Lapras"],
  "Spenser Gold": ["Spenser Gold Arcanine", "Spenser Gold Slaking", "Spenser Gold Suicune"],
};
const BRAIN_ID_BASE = 10000;
// A set's id for mostSuitable / buildReplacement: its frontier index, or the
// id given to a Brain set below.
export const setId = (key) => BRAIN_ID.get(key) ?? FRONTIER_POOL[key].index;
const BRAIN_ID = new Map();
for (const team of Object.values(BRAIN_TEAMS)) for (const key of team) {
  const e = FRONTIER_POOL[key];
  if (!e?.brain) throw new Error(`next-in: Brain set "${key}" missing from frontier-pool.js`);
  const id = BRAIN_ID_BASE + BRAIN_ID.size;
  BRAIN_ID.set(key, id);
  POOL_BY_ID[id] = { key, ...e, index: id };
}

// GetFrontierTrainerFixedIvs (src/battle_tower.c:3288-3309).
export function fixedIvs(id) {
  if (id <= 99) return 3;
  if (id <= 119) return 6;
  if (id <= 139) return 9;
  if (id <= 159) return 12;
  if (id <= 179) return 15;
  if (id <= 199) return 18;
  if (id <= 219) return 21;
  return 31;
}

// ── 1. the trainer and the teammates ───────────────────────────────────────
// challenge: 1-based (the game's challengeNum = winStreak / 7, plus 1);
// battle: 1-7 within the challenge. Or trainerId when you know the trainer.
export function trainerPrior({ challenge, battle, trainerId } = {}) {
  if (trainerId != null) {
    if (!FRONTIER_TRAINERS[trainerId]) throw new Error(`next-in: no Frontier trainer ${trainerId}`);
    return [{ id: trainerId, p: 1 }];
  }
  if (!(Number.isInteger(challenge) && challenge >= 1)) throw new Error(`next-in: challenge must be 1, 2, ... (got ${challenge})`);
  if (!(Number.isInteger(battle) && battle >= 1 && battle <= 7)) throw new Error(`next-in: battle must be 1-7 (got ${battle})`);
  const c = challenge - 1;
  const [lo, hi] = c <= 7 ? (battle === 7 ? TRAINER_ID_RANGES_HARD[c] : TRAINER_ID_RANGES[c]) : TRAINER_ID_RANGES[7];
  const out = [];
  for (let id = lo; id <= hi; id++) out.push({ id, p: 1 / (hi - lo + 1) });
  return out;
}

// FillTrainerParty's rejection rules: may `id` join the party `chosen`?
function canJoin(id, chosen) {
  if (id > HIGH_TIER) return false;
  const e = POOL_BY_ID[id];
  for (const c of chosen) {
    const o = POOL_BY_ID[c];
    if (o.species === e.species) return false;
    if (o.item != null && o.item === e.item) return false;
    if (c === id) return false;
  }
  return true;
}

// [{ p, ivs, slots: [slot1Id, slot2Id] }] given the lead's frontier mon id,
// summing to 1 (pairs from different trainers at the same IVs merged). Throws when no trainer in the prior can lead with it.
export function teammateDist(prior, leadId) {
  const raw = [];
  for (const { id: tid, p: pt } of prior) {
    const set = FRONTIER_TRAINERS[tid].monSet;
    const lv50 = set.filter((m) => m <= HIGH_TIER);
    const leadCount = lv50.filter((m) => m === leadId).length;
    if (leadCount === 0) continue;
    const pLead = leadCount / lv50.length;
    const first = set.filter((m) => canJoin(m, [leadId]));
    for (const a of first) {
      const second = set.filter((m) => canJoin(m, [leadId, a]));
      for (const b of second) raw.push({ p: pt * pLead * (1 / first.length) * (1 / second.length), trainerId: tid, slots: [a, b] });
    }
  }
  const total = raw.reduce((x, r) => x + r.p, 0);
  if (total === 0) throw new Error(`next-in: no trainer in this bracket can lead with ${POOL_BY_ID[leadId]?.key ?? leadId}`);
  // Merge what the replacement cannot tell apart: the same ordered pair at the
  // same IVs from different trainers (only the IVs carry the trainer).
  const merged = new Map();
  for (const r of raw) {
    const ivs = fixedIvs(r.trainerId), k = `${r.slots}|${ivs}`;
    const cur = merged.get(k);
    if (cur) cur.p += r.p / total; else merged.set(k, { p: r.p / total, slots: r.slots, ivs });
  }
  return [...merged.values()];
}

// ── 2. GetMostSuitableMonToSwitchInto ──────────────────────────────────────
const ROWS = TYPE_EFFECTIVENESS; // ROM row order; "FORESIGHT" marks the Ghost rows
const MUL_NO_EFFECT = 0, MUL_NORMAL = 10;
const SE = 2, NVE = 4, NO_EFFECT = 8, MISSED = 1; // MOVE_RESULT_* bits used here

// ModulateByTypeEffectiveness (:605-627): skips the FORESIGHT marker and walks on.
function modulateByType(atkType, def1, def2, v) {
  for (const r of ROWS) {
    if (r === "FORESIGHT") continue;
    if (r[0] !== atkType) continue;
    if (r[1] === def1) v = Math.trunc((v * r[2]) / MUL_NORMAL);
    if (r[1] === def2 && def1 !== def2) v = Math.trunc((v * r[2]) / MUL_NORMAL);
  }
  return v & 0xff;
}

// TypeCalc (src/battle_script_commands.c:1536-1592) with ModulateDmgByType2:
// returns { flags, dmg } for `move` used BY the battler whose types are
// `atkTypes` (STAB) AGAINST `def` = { types, ability, foresighted }.
function typeCalc(move, atkTypes, def, dmg) {
  if (move === "Struggle") return { flags: 0, dmg };
  const m = L.MOVES[move];
  const moveType = m.type; // gBattleMoves[move].type: Hidden Power is Normal here
  let flags = 0;
  if (atkTypes.includes(moveType)) dmg = Math.trunc((dmg * 15) / 10);
  const [t1, t2] = [def.types[0], def.types[1] ?? def.types[0]];
  const mod2 = (mul) => {
    dmg = Math.trunc((dmg * mul) / 10);
    if (dmg === 0 && mul !== 0) dmg = 1;
    if (mul === 0) { flags |= NO_EFFECT; flags &= ~NVE; flags &= ~SE; }
    else if (mul === 5 && m.power && !(flags & (MISSED | NO_EFFECT))) { if (flags & SE) flags &= ~SE; else flags |= NVE; }
    else if (mul === 20 && m.power && !(flags & (MISSED | NO_EFFECT))) { if (flags & NVE) flags &= ~NVE; else flags |= SE; }
  };
  if (def.ability === "Levitate" && moveType === "Ground") {
    flags |= MISSED | NO_EFFECT;
  } else {
    for (const r of ROWS) {
      if (r === "FORESIGHT") { if (def.foresighted) break; continue; }
      if (r[0] !== moveType) continue;
      if (r[1] === t1) mod2(r[2]);
      if (r[1] === t2 && t1 !== t2) mod2(r[2]);
    }
  }
  // Wonder Guard (:1584-1590) only adds MISSED to a non-super-effective hit;
  // the flag this port reads (SE) is untouched, so it is not modelled further.
  return { flags, dmg };
}

// AI_TypeCalc (src/battle_script_commands.c:1594-1636): the AI's flags for a
// move into a SPECIES (its base types, not the battler's current ones) with
// an ability. Unlike TypeCalc it never stops at the Foresight marker (Ghost
// immunities always apply), and Wonder Guard adds "doesn't affect" to any
// non-super-effective damaging move. Struggle: 0. Bits: MISSED 1, SE 2,
// NVE 4, DOESNT_AFFECT_FOE 8 (MOVE_RESULT_*).
export const AI_FLAG = { MISSED, SE, NVE, DOESNT_AFFECT: NO_EFFECT };
export function aiTypeCalc(move, targetSpecies, targetAbility) {
  if (move === "Struggle") return 0;
  const m = L.MOVES[move];
  const moveType = m.type;
  const [t1, t2] = speciesTypes(targetSpecies);
  let flags = 0;
  const mod2 = (mul) => {
    if (mul === 0) { flags |= NO_EFFECT; flags &= ~NVE; flags &= ~SE; }
    else if (mul === 5 && m.power && !(flags & (MISSED | NO_EFFECT))) { if (flags & SE) flags &= ~SE; else flags |= NVE; }
    else if (mul === 20 && m.power && !(flags & (MISSED | NO_EFFECT))) { if (flags & NVE) flags &= ~NVE; else flags |= SE; }
  };
  if (targetAbility === "Levitate" && moveType === "Ground") {
    flags = MISSED | NO_EFFECT;
  } else {
    for (const r of ROWS) {
      if (r === "FORESIGHT") continue;
      if (r[0] !== moveType) continue;
      if (r[1] === t1) mod2(r[2]);
      if (r[1] === t2 && t1 !== t2) mod2(r[2]);
    }
  }
  if (targetAbility === "Wonder Guard" && (!(flags & SE) || (flags & (SE | NVE)) === (SE | NVE)) && m.power) flags |= NO_EFFECT;
  return flags;
}

const speciesTypes = (species) => {
  const t = SPECIES[species].types;
  return [t[0], t[1] ?? t[0]];
};

// you:   { types: [t1, t2], ability, foresighted } -- your active battler as the
//        ROM sees it (battle types, current ability).
// fainted: { types } -- the opponent mon that just fell (its battle types).
// party: the opponent's party slots in order, each null (empty / fainted /
//        the fainted one itself) or { id: frontier mon id }. activeSlot: the
//        fainted mon's slot.
// Returns the chosen slot index.
export function mostSuitable(you, fainted, party, activeSlot = 0) {
  const PARTY_SIZE = 6, ALL = (1 << PARTY_SIZE) - 1;
  const slot = (i) => (i !== activeSlot ? party[i] ?? null : null);
  const yt = [you.types[0], you.types[1] ?? you.types[0]];
  let invalid = 0;
  while (invalid !== ALL) {
    let best = MUL_NO_EFFECT, bestId = PARTY_SIZE;
    for (let i = 0; i < PARTY_SIZE; i++) {
      const c = slot(i);
      if (c && !(invalid & (1 << i))) {
        const [d1, d2] = speciesTypes(POOL_BY_ID[c.id].species);
        let v = MUL_NORMAL;
        v = modulateByType(yt[0], d1, d2, v);
        v = modulateByType(yt[1], d1, d2, v);
        if (best < v) { best = v; bestId = i; }
      } else {
        invalid |= 1 << i;
      }
    }
    if (bestId !== PARTY_SIZE) {
      const moves = POOL_BY_ID[slot(bestId).id].moves;
      if (moves.some((mv) => typeCalc(mv, fainted.types, you, 0).flags & SE)) return { slot: bestId, by: "typing" };
      invalid |= 1 << bestId;
    } else {
      invalid = ALL;
    }
  }
  // fallback: gCurrentMove = MOVE_NONE -> AI_CalcDmg gives 3 for every move.
  let bestDmg = 0, bestId = PARTY_SIZE;
  for (let i = 0; i < PARTY_SIZE; i++) {
    const c = slot(i);
    if (!c) continue;
    for (const mv of POOL_BY_ID[c.id].moves) {
      let dmg = 0;
      if (L.MOVES[mv].power !== 1) dmg = typeCalc(mv, fainted.types, you, 3).dmg;
      if (bestDmg < dmg) { bestDmg = dmg & 0xff; bestId = i; }
    }
  }
  if (bestId !== PARTY_SIZE) return { slot: bestId, by: "damage" };
  for (let i = 0; i < PARTY_SIZE; i++) if (slot(i)) return { slot: i, by: "first" };
  return { slot: null, by: "none" };
}

// ── putting them together ──────────────────────────────────────────────────
// The replacement distribution when the lead (`leadId`) faints with your mon
// `you` out: [{ p, id, ivs, by }] merged by (id, ivs).
export function replacementDist(dist, you, fainted) {
  const out = new Map();
  for (const d of dist) {
    const party = [null, { id: d.slots[0] }, { id: d.slots[1] }];
    const pick = mostSuitable(you, fainted, party, 0);
    const id = d.slots[pick.slot - 1];
    const k = `${id}|${d.ivs}`;
    const cur = out.get(k);
    if (cur) { cur.p += d.p; cur.by[pick.by] = (cur.by[pick.by] ?? 0) + d.p; }
    else out.set(k, { p: d.p, id, ivs: d.ivs, by: { [pick.by]: d.p } });
  }
  return [...out.values()].sort((a, b) => b.p - a.p);
}

// The replacement mon as the engine builds an opponent. Two-ability species
// get each ability half the time (CreateMonWithEVSpreadNatureOTID rolls the
// personality; the ability bit is personality & 1).
const builtCache = new Map();
export function buildReplacement(id, ivs) {
  const k = `${id}|${ivs}`;
  if (builtCache.has(k)) return builtCache.get(k);
  const e = POOL_BY_ID[id];
  const iv = { hp: ivs, atk: ivs, def: ivs, spa: ivs, spd: ivs, spe: ivs };
  const mons = e.abilities.map((ability) => ({ p: 1 / e.abilities.length,
    mon: L.buildMon({ species: e.species, level: 50, nature: e.nature, evs: e.evs, ivs: iv, ability, item: e.item, moves: e.moves,
      friendship: 255 }) }));
  builtCache.set(k, mons);
  return mons;
}

// Its best hit on your mon: the largest expected damage over its moves (mean
// of the 16 rolls x accuracy x hits), capped at your current HP, as a share of
// that HP. Approximations, stated: no crits; multi-hit moves count their mean
// hits (2-5 -> 3, Double Kick-type 2, Triple Kick 10+20+30); one-hit KO moves
// count accuracy x your HP; Magnitude its mean power (71), Psywave its mean
// (level x 1.0), Fury Cutter / Rollout their first-use power; Present and
// Bide (its damage is what it absorbed) 0;
// entry abilities (Intimidate, Drizzle, ...) not applied.
//
// Split in two so a search can cache: hitTable() reads everything but your
// current HP; shareOf() applies the HP.
const VARIABLE_POWER = { EFFECT_MAGNITUDE: 71, EFFECT_FURY_CUTTER: 10, EFFECT_ROLLOUT: 30, EFFECT_TRIPLE_KICK: 10, EFFECT_PSYWAVE: 5 };
const HITS = { EFFECT_DOUBLE_HIT: 2, EFFECT_TWINEEDLE: 2, EFFECT_MULTI_HIT: 3, EFFECT_TRIPLE_KICK: 6 };
const groundImmune = (mon, type) => type === "Ground" && mon.ability === "Levitate";
export function hitTable(atk, youMon, s) {
  const cloud = (m) => m.ability === "Cloud Nine" || m.ability === "Air Lock";
  const weather = cloud(atk) || cloud(youMon) ? null : s.weatherType;
  return atk.moves.map((mv) => {
    const m = L.MOVES[mv];
    const acc = m.accuracy > 0 ? Math.min(100, m.accuracy) / 100 : 1;
    const immune = L.typeEffectiveness(m.type, youMon.types, s.youForesighted) === 0 || groundImmune(youMon, m.type);
    if (m.effect === "EFFECT_OHKO") return { acc, kind: immune ? "none" : "ohko" };
    if (m.effect === "EFFECT_SUPER_FANG") return { acc, kind: immune ? "none" : "half" };
    if (m.effect === "EFFECT_ENDEAVOR") return { acc, kind: immune ? "none" : "endeavor", atkHp: atk.stats.hp };
    if (!(m.power > 0) || m.effect === "EFFECT_PRESENT" || m.effect === "EFFECT_BIDE" || immune) return { acc, kind: "none" };
    const physical = m.category === "physical";
    let sum = 0;
    for (let roll = 85; roll <= 100; roll++) {
      sum += L.calcDamage(atk, youMon, mv, {
        rollPercent: roll, defStage: physical ? s.youStages.def : s.youStages.spd,
        screenActive: physical ? s.youReflectTurns != null : s.youLightScreenTurns != null,
        weather, defenderForesighted: s.youForesighted, defenderStatus: s.youStatus,
        variablePower: VARIABLE_POWER[m.effect] ?? null,
      });
    }
    return { acc, kind: "dmg", dmg: (sum / 16) * (HITS[m.effect] ?? 1) };
  });
}
export function shareOf(table, curHp) {
  if (curHp <= 0) return 0;
  let best = 0;
  for (const h of table) {
    const d = h.kind === "dmg" ? h.dmg : h.kind === "ohko" ? curHp : h.kind === "half" ? Math.max(1, Math.floor(curHp / 2))
      : h.kind === "endeavor" ? Math.max(0, curHp - h.atkHp) : 0;
    best = Math.max(best, Math.min(curHp, d) * h.acc);
  }
  return best / curHp;
}

// The scorer's hook. Built once per solve from the lead you face and where you
// are in the challenge; then expectedHitShare(team, opp, s) is the average,
// over who comes in, of its best hit's share of your active mon's current HP.
//   lead: the FRONTIER_POOL key of the mon you are fighting ("Salamence 1")
//   challenge + battle, or trainerId
// `warm`: a previous instance's exportCache() (plain data, crosses threads),
// so worker threads skip the ~1-2 s of building replacement odds and tables.
//
// second: when you are fighting the opponent's SECOND mon, its pool key. Then
// only one teammate is left and it is the replacement whoever you have out;
// its distribution is the pairs (lead, second, third) the draw allows, the
// third's weight summed over both slot orders. Stated limit: which mon came
// in second also tells something about the third (GetMostSuitable chose it
// over the third against your mon at the time) -- that evidence is not used.
// (Fighting the THIRD mon: no replacement; do not build a next-in.)
//
// brain: "Spenser Silver" / "Spenser Gold" -- his team is known, so the
// teammates are his slots 1 and 2 with certainty (lead must be his slot 0);
// challenge / battle / trainerId are not used.
export function makeNextIn({ lead, second = null, challenge, battle, trainerId, brain = null } = {}, warm = null) {
  const e = FRONTIER_POOL[lead];
  if (!e) throw new Error(`next-in: no frontier set named "${lead}"`);
  const e2 = second != null ? FRONTIER_POOL[second] : null;
  if (second != null && !e2) throw new Error(`next-in: no frontier set named "${second}"`);
  const idOf = (key) => BRAIN_ID.get(key) ?? FRONTIER_POOL[key].index;
  let dist;
  if (brain) {
    const team = BRAIN_TEAMS[brain];
    if (!team) throw new Error(`next-in: no Frontier Brain team "${brain}"`);
    if (lead !== team[0]) throw new Error(`${brain.split(" ")[0]} always sends out ${FRONTIER_POOL[team[0]].species} first`);
    if (second != null && !team.slice(1).includes(second)) throw new Error(`${second} is not one of ${brain}'s other two (${team.slice(1).join(", ")})`);
    dist = [{ p: 1, slots: [idOf(team[1]), idOf(team[2])], ivs: FRONTIER_POOL[team[0]].fixedIV }];
  } else {
    if (e.brain) throw new Error(`next-in: ${lead} is a Frontier Brain set -- pass brain`);
    dist = warm?.dist ?? teammateDist(trainerPrior({ challenge, battle, trainerId }), e.index);
  }
  let thirdDist = null;
  if (e2) {
    const m = new Map();
    for (const d of dist) {
      const i = d.slots.indexOf(idOf(second));
      if (i < 0) continue;
      const third = d.slots[1 - i], k = `${third}|${d.ivs}`;
      const cur = m.get(k);
      if (cur) cur.p += d.p; else m.set(k, { p: d.p, id: third, ivs: d.ivs, by: { last: 0 } });
    }
    const total = [...m.values()].reduce((a, x) => a + x.p, 0);
    if (total === 0) throw new Error(`next-in: ${second} cannot be ${lead}'s teammate in this bracket`);
    thirdDist = [...m.values()].map((x) => ({ ...x, p: x.p / total, by: { last: x.p / total } })).sort((a, b) => b.p - a.p);
  }
  const replCache = new Map(warm?.repl ?? []), tableCache = new Map(warm?.tables ?? []);
  function replacements(you, fainted) {
    if (thirdDist) return thirdDist;
    const k = `${you.types}|${you.ability}|${you.foresighted}|${fainted.types}`;
    if (!replCache.has(k)) replCache.set(k, replacementDist(dist, you, fainted));
    return replCache.get(k);
  }
  function expectedHitShare(team, opp, s) {
    const eff = L.effectiveCtx({ you: team[s.youActive], opp }, s);
    const you = { types: eff.you.types, ability: eff.you.ability, foresighted: !!s.youForesighted };
    const reps = replacements(you, { types: eff.opp.types });
    const k = [second ?? "", s.youActive, eff.you.types, eff.you.ability, eff.you.stats.def, eff.you.stats.spd, s.youStages.def, s.youStages.spd,
      s.youReflectTurns != null, s.youLightScreenTurns != null, s.weatherType, s.youStatus, !!s.youForesighted].join("|");
    let tables = tableCache.get(k);
    if (!tables) {
      tables = reps.map((r) => ({ p: r.p, forms: buildReplacement(r.id, r.ivs).map((f) => ({ p: f.p, table: hitTable(f.mon, eff.you, s) })) }));
      tableCache.set(k, tables);
    }
    const curHp = Math.round((s.yourHpPct / 100) * eff.you.stats.hp);
    let share = 0;
    for (const r of tables) for (const f of r.forms) share += r.p * f.p * shareOf(f.table, curHp);
    return share;
  }
  const exportCache = () => ({ dist, repl: [...replCache], tables: [...tableCache] });
  return { spec: { lead, second, challenge, battle, trainerId, brain }, lead, leadId: idOf(lead), dist, replacements, expectedHitShare, exportCache };
}
