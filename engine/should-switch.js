// ── should-switch.js ───────────────────────────────────────────────────────
// The opponent's voluntary switch: ShouldSwitch (src/battle_ai_switch_items.c:
// 428-527) as AI_TrySwitchOrUseItem (:528-596) runs it for every trainer
// battler at action selection -- in the Palace too: OpponentHandleChooseAction
// (src/battle_controller_opponent.c:1540-1544) is not Palace-gated; only the
// MOVE choice is. Ported line by line, each Random() test as its probability
// (Random() % 3 < 2 -> 2/3, Random() & 1 -> 1/2, Random() % 10 != 0 -> 9/10,
// Random() % n == 0 -> 1/n), in source order.
//
// oppSwitchOdds(B, s) -> [{ p, slot }]: slot null = it uses a move (the Palace
// then picks which); a party slot = it switches to that mon.
//
// Not reached: ShouldUseItem -- Frontier trainers carry no items to use.
// Singles only: the doubles / multi branches are dropped.

import * as L from "./logic.js";
import { aiTypeCalc, AI_FLAG, mostSuitable } from "./next-in.js";

// HandleTurnActionSelectionState (src/battle_main.c:4160-4164): a battler
// locked into its move (STATUS2_MULTIPLETURNS -- a rampage, Rollout, Uproar,
// Bide, a two-turn move's charge -- or STATUS2_RECHARGE) chooses nothing.
const LOCKS = new Set(["rampage", "rollout", "uproar", "bide"]);
function forced(s) {
  if (s.oppLock != null) {
    if (!LOCKS.has(s.oppLock.kind)) throw new Error(`should-switch: unknown lock kind "${s.oppLock.kind}"`);
    return true;
  }
  return !!(s.oppCharging || s.oppRecharge);
}

export function oppSwitchOdds(B, s) {
  if (forced(s)) return [{ p: 1, slot: null }];
  const eff = L.effectiveCtx({ you: B.team[s.youActive], opp: B.oppTeam[s.oppActive] }, s);
  const me = eff.opp, foe = eff.you; // "me" = the opponent deciding
  const active = s.oppActive;
  // party slots it could switch to, in party order
  const bench = B.oppTeam.map((m, i) => (i !== active && s.oppBench[i] && s.oppBench[i].hpPct > 0 ? i : -1)).filter((i) => i >= 0);

  // ── ShouldSwitch's gates (:438-451) ──
  if (s.oppWrapped || L.vf(s, "oppCantEscape")) return [{ p: 1, slot: null }];
  if (s.oppIngrained) return [{ p: 1, slot: null }];
  if (foe.ability === "Shadow Tag") return [{ p: 1, slot: null }];
  if (foe.ability === "Arena Trap") return [{ p: 1, slot: null }]; // "Misses the flying type and Levitate check."
  if ((foe.ability === "Magnet Pull" || me.ability === "Magnet Pull") && me.types.includes("Steel")) return [{ p: 1, slot: null }]; // ABILITY_ON_FIELD2: either battler
  if (bench.length === 0) return [{ p: 1, slot: null }];

  const out = [];
  let rest = 1; // probability still undecided
  const take = (q, slot) => { if (q > 0) { out.push({ p: rest * q, slot }); rest *= 1 - q; } };
  const PICK = "mostSuitable"; // AI_monToSwitchIntoId = PARTY_SIZE

  const foeSpecies = foe.species, foeAbility = foe.ability;
  const myMoves = me.moves.filter((m) => m && m !== "(none)");
  const hasSE = myMoves.some((mv) => aiTypeCalc(mv, foeSpecies, foeAbility) & AI_FLAG.SE);
  const landed = s.oppLastLanded; // null = MOVE_NONE / MOVE_UNAVAILABLE
  const landedPower = landed ? L.MOVES[landed].power : 0; // gBattleMoves[0 / 0xFFFF].power = 0

  // FindMonWithFlagsAndSuperEffective (:328-422): a teammate the last landed
  // move would (not) affect, with a move super effective on the mon that
  // landed it (gLastHitBy -- always yours here); per such move 1/modulo.
  const findFlags = (flag, modulo) => {
    if (!landed || landedPower === 0) return; // (gLastHitBy == 0xFF cannot hold with a landed move)
    for (const i of bench) {
      const mate = B.oppTeam[i];
      if (!(aiTypeCalc(landed, mate.species, mate.ability) & flag)) continue;
      for (const mv of mate.moves) {
        if (!mv) continue;
        if (aiTypeCalc(mv, foeSpecies, foeAbility) & AI_FLAG.SE) take(1 / modulo, i);
      }
    }
  };

  // 1. ShouldSwitchIfPerishSong (:20-32)
  if (L.vf(s, "oppPerishSonged") && s.oppPerishCount === 0) { take(1, PICK); return finish(B, s, out); }

  // 2. ShouldSwitchIfWonderGuard (:34-106)
  if (foeAbility === "Wonder Guard" && !hasSE) {
    for (const i of bench) for (const mv of B.oppTeam[i].moves) {
      if (mv && aiTypeCalc(mv, foeSpecies, foeAbility) & AI_FLAG.SE) take(2 / 3, i);
    }
  }

  // 3. FindMonThatAbsorbsOpponentsMove (:108-209): skipped 2/3 of the time
  //    when it has a super-effective move (noRng: any SE move counts).
  {
    const gate = hasSE ? 1 / 3 : 1;
    const absorbing = landed && landedPower > 0 ? { Fire: "Flash Fire", Water: "Water Absorb", Electric: "Volt Absorb" }[L.MOVES[landed].type] : null;
    if (absorbing && me.ability !== absorbing) {
      // only the `gate` share of the remaining mass runs the loop
      const before = rest;
      let runMass = before * gate;
      for (const i of bench) {
        if (B.oppTeam[i].ability === absorbing) { out.push({ p: runMass / 2, slot: i }); runMass /= 2; }
      }
      rest = before * (1 - gate) + runMass;
    }
  }

  // 4. ShouldSwitchIfNaturalCure (:211-246)
  if (s.oppStatus === "sleep" && me.ability === "Natural Cure") {
    const hp = Math.round((s.oppHpPct / 100) * me.stats.hp);
    if (!(hp < Math.floor(me.stats.hp / 2))) {
      if (landed == null) take(1 / 2, PICK);                // MOVE_NONE / UNAVAILABLE && Random() & 1
      if (landedPower === 0) take(1 / 2, PICK);             // else if power == 0 && Random() & 1
      findFlags(AI_FLAG.DOESNT_AFFECT, 1);
      findFlags(AI_FLAG.NVE, 1);
      take(1 / 2, PICK);
    }
  }

  // 5. HasSuperEffectiveMoveAgainstOpponents(FALSE) (:248-298): each SE move
  //    keeps it in 9 times in 10.
  for (const mv of myMoves) if (aiTypeCalc(mv, foeSpecies, foeAbility) & AI_FLAG.SE) take(9 / 10, null);

  // 6. AreStatsRaised (:300-311): more than 3 stages up in total -> stays.
  const raised = Object.values(s.oppStages).reduce((a, v) => a + Math.max(0, v), 0);
  if (raised > 3) take(1, null);

  // 7. (:516-518)
  findFlags(AI_FLAG.DOESNT_AFFECT, 2);
  findFlags(AI_FLAG.NVE, 3);

  take(1, null);
  return finish(B, s, out);
}

// AI_TrySwitchOrUseItem (:546-590): a switch with AI_monToSwitchIntoId =
// PARTY_SIZE asks GetMostSuitableMonToSwitchInto (against your mon out, the
// switcher's own types for STAB) and, failing that, the first healthy
// teammate. Merged by slot.
function finish(B, s, out) {
  const by = new Map();
  for (const o of out) {
    if (!(o.p > 0)) continue;
    let slot = o.slot;
    if (slot === "mostSuitable") slot = suitable(B, s);
    by.set(slot, (by.get(slot) ?? 0) + o.p);
  }
  return [...by.entries()].map(([slot, p]) => ({ p, slot }));
}
function suitable(B, s) {
  const eff = L.effectiveCtx({ you: B.team[s.youActive], opp: B.oppTeam[s.oppActive] }, s);
  const you = { types: eff.you.types, ability: eff.you.ability, foresighted: !!s.youForesighted };
  const party = B.oppIds.map((id, i) => (i !== s.oppActive && s.oppBench[i] && s.oppBench[i].hpPct > 0 ? { id } : null));
  return mostSuitable(you, { types: eff.opp.types }, party, s.oppActive).slot;
}
