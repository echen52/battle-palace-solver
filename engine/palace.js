// ── palace.js ──────────────────────────────────────────────────────────────
// The Battle Palace layer over the forked engine: how each battler's move is
// chosen, and one full Palace turn. Every rule carries its pokeemerald anchor.
//
//   1. GROUPS     each move is Attack / Defense / Support (GetBattlePalaceMoveGroup)
//   2. NATURE     the nature's three-way roll, with the latched low-HP row
//   3. CHOICE     per battler: forced turns; the AI over the rolled group; the
//                 off-group fallback; the selection-limit loafs
//   4. TURN       both battlers' choices under one Quick Claw draw, through
//                 resolveTurn, then the end-of-turn low-HP latch
//
// The player's battler is chosen by the same routine as the opponent's
// (ChooseMoveAndTargetInBattlePalace is called from both controllers,
// src/battle_controller_player.c:2624 and battle_controller_opponent.c:1555),
// and its AI runs with the same Frontier flags (BattleAI_SetupAIData,
// src/battle_ai_script_commands.c:370-371: BATTLE_TYPE_FRONTIER). The engine's
// AI decides for `opp` only, so the player's decision is made on the mirrored
// position (mirror.js).
//
// PP: the group mask keeps only slots with PP (:151); the AI skips 0-PP slots
// (logic.js buildAiView ppZero); CheckMoveLimitations' PP bit makes them
// unusable (selectableMoves), so a 0-PP pick loafs with the escape script and
// a mon with nothing usable Struggles (AreAllMovesUnusable).

import * as L from "./logic.js";
import { moveTarget } from "./move-flags.js";
import { mirrorState } from "./mirror.js";
import { itemData } from "./item-data.js";

// ── 1. Groups ──────────────────────────────────────────────────────────────
export const ATTACK = 0, DEFENSE = 1, SUPPORT = 2; // PALACE_MOVE_GROUP_*, constants/battle_palace.h
export const GROUP_NAMES = ["attack", "defense", "support"];

// GetBattlePalaceMoveGroup (src/battle_gfx_sfx_util.c:296-318): a switch on the
// move's ROM target (move-flags.js, generated from battle_moves.h), with the
// zero-power split for the directly-targeted classes. Curse is
// MOVE_TARGET_SELECTED with power 0: Support, for Ghosts too (the Ghost case at
// :265-275 changes its TARGET, not its group).
export function palaceMoveGroup(move) {
  const target = moveTarget(move);
  const data = L.MOVES[move];
  if (target == null || !data) throw new Error(`palaceMoveGroup: no target / move data for "${move}"`);
  switch (target) {
    case "MOVE_TARGET_SELECTED":
    case "MOVE_TARGET_USER_OR_SELECTED":
    case "MOVE_TARGET_RANDOM":
    case "MOVE_TARGET_BOTH":
    case "MOVE_TARGET_FOES_AND_ALLY":
      return data.power === 0 ? SUPPORT : ATTACK;
    case "MOVE_TARGET_DEPENDS":
    case "MOVE_TARGET_OPPONENTS_FIELD":
      return SUPPORT;
    case "MOVE_TARGET_USER":
      return DEFENSE;
    default:
      return ATTACK;
  }
}

// ── 2. Nature ──────────────────────────────────────────────────────────────
// gBattlePalaceNatureToMoveGroupLikelihood (src/battle_script_commands.c:855-
// 884), stored as source stores it: PALACE_STYLE(atk, def, atkLow, defLow) =>
// {atk, atk + def, atkLow, atkLow + defLow}, cumulative thresholds.
const PALACE_STYLE = (atk, def, atkLow, defLow) => [atk, atk + def, atkLow, atkLow + defLow];
export const NATURE_GROUP_THRESHOLDS = {
  Hardy:   PALACE_STYLE(61,  7, 61,  7),
  Lonely:  PALACE_STYLE(20, 25, 84,  8),
  Brave:   PALACE_STYLE(70, 15, 32, 60),
  Adamant: PALACE_STYLE(38, 31, 70, 15),
  Naughty: PALACE_STYLE(20, 70, 70, 22),
  Bold:    PALACE_STYLE(30, 20, 32, 58),
  Docile:  PALACE_STYLE(56, 22, 56, 22),
  Relaxed: PALACE_STYLE(25, 15, 75, 15),
  Impish:  PALACE_STYLE(69,  6, 28, 55),
  Lax:     PALACE_STYLE(35, 10, 29,  6),
  Timid:   PALACE_STYLE(62, 10, 30, 20),
  Hasty:   PALACE_STYLE(58, 37, 88,  6),
  Serious: PALACE_STYLE(34, 11, 29, 11),
  Jolly:   PALACE_STYLE(35,  5, 35, 60),
  Naive:   PALACE_STYLE(56, 22, 56, 22),
  Modest:  PALACE_STYLE(35, 45, 34, 60),
  Mild:    PALACE_STYLE(44, 50, 34,  6),
  Quiet:   PALACE_STYLE(56, 22, 56, 22),
  Bashful: PALACE_STYLE(30, 58, 30, 58),
  Rash:    PALACE_STYLE(30, 13, 27,  6),
  Calm:    PALACE_STYLE(40, 50, 25, 62),
  Gentle:  PALACE_STYLE(18, 70, 90,  5),
  Sassy:   PALACE_STYLE(88,  6, 22, 20),
  Careful: PALACE_STYLE(42, 50, 42,  5),
  Quirky:  PALACE_STYLE(56, 22, 56, 22),
};

// ChooseMoveAndTargetInBattlePalace (src/battle_gfx_sfx_util.c:115-146):
// percent = Random() % 100; i0 = latched ? 2 : 0; the first threshold above
// percent picks Attack or Defense, none picks Support. Decoded by counting the
// 100 integer percents through that exact loop.
export function decodeNatureRow(nature, lowHpLatched) {
  const t = NATURE_GROUP_THRESHOLDS[nature];
  if (!t) throw new Error(`decodeNatureRow: unknown nature "${nature}"`);
  const i0 = lowHpLatched ? 2 : 0;
  const counts = [0, 0, 0];
  for (let percent = 0; percent < 100; percent++) {
    let i = i0;
    for (; i < i0 + 2; i++) if (t[i] > percent) break;
    counts[i === i0 + 2 ? SUPPORT : i - i0]++;
  }
  return counts.map((c) => c / 100);
}

// The low-HP latch (gBattleStruct->palaceFlags bit per battler). Set when
// `maxHP / 2 >= hp && hp != 0 && !asleep` (C integer division), at exactly two
// checkpoints: switch-in (Cmd_switchindataupdate, src/battle_script_commands.c:
// 4659-4665) and the start of every turn after the first
// (BattleScript_PalacePrintFlavorText from BattleTurnPassed, src/battle_main.c:
// 4015 -> VARIOUS_PALACE_FLAVOR_TEXT, :6384-6397). Cleared only at battle start
// (:3138) and on switch-out / faint (:3240, :3335) -- never by healing.
export function lowHpCheck(mon, hpPct, status) {
  const hp = Math.round((hpPct / 100) * mon.stats.hp);
  return Math.floor(mon.stats.hp / 2) >= hp && hp !== 0 && status !== "sleep";
}
export function updateLowHpLatches(ctx, state) {
  const ec = L.effectiveCtx(ctx, state);
  const you = state.youPalaceLowHp || lowHpCheck(ec.you, state.yourHpPct, state.youStatus);
  const opp = state.oppPalaceLowHp || lowHpCheck(ec.opp, state.oppHpPct, state.oppStatus);
  return you === state.youPalaceLowHp && opp === state.oppPalaceLowHp ? state
    : { ...state, youPalaceLowHp: you, oppPalaceLowHp: opp };
}

// A battle-start state with the Palace fields. The latches start clear
// (palaceFlags = 0 at battle start; TryDoEventsBeforeFirstTurn runs no flavor
// check) unless the caller states otherwise for a mid-battle position.
export function palaceStartState(opts, { youLowHp = false, oppLowHp = false } = {}) {
  return { ...L.buildStartState(opts), youPalaceLowHp: youLowHp, oppPalaceLowHp: oppLowHp };
}

// ── 3. One battler's choice ────────────────────────────────────────────────
const other = (side) => (side === "you" ? "opp" : "you");

// TrySetCantSelectMoveBattleScript (src/battle_util.c:975-1080) on the slot the
// controller returned. Disabled / tormented / taunted / imprisoned set a
// gPalaceSelectionBattleScripts entry -> the "plain" loaf; a Choice-locked or
// 0-PP pick sets only palaceUnableToUseMove -> the "escape" loaf.
function plainLimitReason(state, side, foe, move) {
  const md = L.MOVES[move];
  if (state[side + "DisabledMove"] && state[side + "DisabledMove"] === move) return "disabled";
  if (state[side + "Tormented"] && state[side + "LastMove"] && move === state[side + "LastMove"] && move !== "Struggle") return "tormented";
  if (state[side + "TauntTurns"] != null && md.power === 0) return "taunted";
  if (state[other(side) + "Imprisoning"] && foe.moves.includes(move)) return "imprisoned";
  return null;
}
function loafKindForSlot(state, side, foe, move) {
  return plainLimitReason(state, side, foe, move) ? "plain" : "escape";
}

// The AI over a group mask, for either battler.
function aiFor(ctx, state, side, mask, qc) {
  const ec = L.effectiveCtx(ctx, state);
  if (side === "opp") return L.chooseOpponentMoves(ec.opp, ec.you, state, { qc, palaceMask: mask });
  return L.chooseOpponentMoves(ec.you, ec.opp, mirrorState(state), { qc, palaceMask: mask });
}

// ChooseMoveAndTargetInBattlePalace's fallback (src/battle_gfx_sfx_util.c:
// 168-262), when the rolled group has no member with PP. Moves are counted per
// group among the USABLE slots; the third "Support" comparison is the vanilla
// bug (:202, :237: it tests the Defense nibble against 2 << 8 and is never
// true) and is kept. Then a 50% loaf (Random() % 100 >= 50), returning slot 0.
function fallbackChoices(moves, usable, groups) {
  const slots = moves.map((_, i) => i).filter((i) => usable[i]);
  if (slots.length === 0) return { picks: [], pLoaf: 1 }; // :257-262: nothing usable, always loafs
  let n = 0;
  for (const i of slots) n += 1 << (4 * groups[i]);
  let multi = 0;
  if ((n & 0xf) >= 2) multi++;
  if ((n & (0xf << 4)) >= (2 << 4)) multi++;
  if ((n & (0xf << 4)) >= (2 << 8)) multi++; // vanilla bug -- never true
  let cand;
  if (multi !== 1) cand = slots; // :213-221 uniform over usable slots
  else {
    let g;
    if ((n & 0xf) >= 2) g = ATTACK;
    if ((n & (0xf << 4)) >= (2 << 4)) g = DEFENSE;
    if ((n & (0xf << 4)) >= (2 << 8)) g = SUPPORT; // vanilla bug -- never true
    cand = slots.filter((i) => groups[i] === g);
  }
  return { picks: cand.map((i) => ({ slot: i, p: 0.5 / cand.length })), pLoaf: 0.5 };
}

// One battler's decision this turn, as [{ p, move, loaf, aiRan, group }]:
//   move   the move in the slot the controller returned (what the turn order
//          reads, and what resolveTurn executes unless loafing)
//   loaf   null | "escape" | "plain"
//   aiRan  whether BattleAI_ChooseMoveOrAction ran (and so recorded the
//          target's last move, RecordLastUsedMoveByTarget)
//   group  the rolled group, or null on a forced turn
// `qc` conditions the AI's speed read on the turn's Quick Claw draw.
export function palaceChoices(ctx, state, side, { qc = false } = {}) {
  const ec = L.effectiveCtx(ctx, state);
  const self = ec[side], foe = ec[other(side)];
  // Forced before the controller is asked (src/battle_main.c:4160-4165:
  // STATUS2_MULTIPLETURNS / STATUS2_RECHARGE), and Encore (:4192-4198).
  const forced = state[side + "Charging"]?.move || state[side + "Recharge"]?.move || state[side + "Lock"]?.move
    || state[side + "EncoredMove"];
  if (forced) return [{ p: 1, move: forced, loaf: null, aiRan: false, group: null }];
  const legal = L.selectableMoves(self.moves, state, side, foe, side === "you" ? "you" : "the opponent");
  // AreAllMovesUnusable (:4183-4190): Struggle, chosen before ChooseMove.
  if (legal.length === 1 && legal[0] === "Struggle" && !self.moves.includes("Struggle")) {
    return [{ p: 1, move: "Struggle", loaf: null, aiRan: false, group: null }];
  }
  const moves = self.moves;
  const usable = moves.map((m) => legal.includes(m));
  const groups = moves.map(palaceMoveGroup);
  const roll = decodeNatureRow(self.nature, !!state[side + "PalaceLowHp"]);
  const decided = aiDecisionStateFor(state, side);
  const out = [];
  for (const g of [ATTACK, DEFENSE, SUPPORT]) {
    const pg = roll[g];
    if (pg === 0) continue;
    // selectedMoves: the rolled group's slots that still have PP (:149-155)
    const pp = state[side + "PP"];
    const mask = [0, 1, 2, 3].map((i) => i < moves.length && groups[i] === g && (!pp || pp[i] !== 0));
    if (mask.some(Boolean)) {
      // :149-166 -> BattleAI_SetupAIData(selectedMoves); the AI runs.
      for (const { move, prob } of aiFor(ctx, decided, side, mask, qc)) {
        const loaf = usable[moves.indexOf(move)] ? null : loafKindForSlot(state, side, foe, move);
        out.push({ p: pg * prob, move, loaf, aiRan: true, group: g });
      }
    } else {
      const { picks, pLoaf } = fallbackChoices(moves, usable, groups);
      for (const { slot, p } of picks) out.push({ p: pg * p, move: moves[slot], loaf: null, aiRan: false, group: g });
      if (pLoaf > 0) out.push({ p: pg * pLoaf, move: moves[0], loaf: loafKindForSlot(state, side, foe, moves[0]), aiRan: false, group: g });
    }
  }
  return mergeChoices(out);
}
function mergeChoices(list) {
  const m = new Map();
  for (const c of list) {
    const k = `${c.move}|${c.loaf}|${c.aiRan}|${c.group}`;
    const e = m.get(k);
    if (e) e.p += c.p; else m.set(k, { ...c });
  }
  return [...m.values()];
}
// RecordLastUsedMoveByTarget runs at the top of ChooseMoveOrAction_Singles:
// the state the AI reads is the one with the target's last move recorded.
function aiDecisionStateFor(state, side) {
  return L.aiDecisionState(state, side);
}

// ── 4. One Palace turn ─────────────────────────────────────────────────────
// gRandomTurnNumber is drawn once before action selection (src/battle_main.c:
// 4013) and decides Quick Claw for BOTH battlers' AI speed reads and for the
// turn order, so the turn is conditioned on that draw: per outcome,
// P(draw) x choice(you | draw) x choice(opp | draw) x resolveTurn(.. | draw).
// Same detection and threshold as resolveTurn's (GetWhoStrikesFirst:
// gRandomTurnNumber < 0xFFFF * param / 100, out of a u16).
function quickClawDraws(ctx, state) {
  const ec = L.effectiveCtx(ctx, state);
  const qcItem = (mon) => {
    const it = itemData(mon.item);
    return it && it.holdEffect === "HOLD_EFFECT_QUICK_CLAW" ? it : null;
  };
  const holder = qcItem(ec.you) || qcItem(ec.opp);
  if (!holder) return [{ p: 1, qc: false, resolveQc: undefined }];
  const pFire = Math.floor((0xffff * holder.param) / 100) / 65536;
  return [{ p: pFire, qc: true, resolveQc: true }, { p: 1 - pFire, qc: false, resolveQc: false }];
}

// Returns [{ p, state, label, you: choice, opp: choice }] -- every successor of
// one Palace turn, with the low-HP latches updated for the next one.
export function palaceTurn(ctx, state) {
  const out = [];
  for (const draw of quickClawDraws(ctx, state)) {
    const yc = palaceChoices(ctx, state, "you", { qc: draw.qc });
    const oc = palaceChoices(ctx, state, "opp", { qc: draw.qc });
    for (const y of yc) {
      for (const o of oc) {
        // The AI's history record exists only where that battler's AI ran.
        let s = state;
        if (y.aiRan) s = L.aiDecisionState(s, "you");
        if (o.aiRan) s = L.aiDecisionState(s, "opp");
        const loaf = { you: y.loaf, opp: o.loaf };
        for (const r of L.resolveTurn(ctx, s, y.move, o.move, { qc: draw.resolveQc, loaf })) {
          const next = r.state.yourHpPct > 0 && r.state.oppHpPct > 0 ? updateLowHpLatches(ctx, r.state) : r.state;
          out.push({ p: draw.p * y.p * o.p * r.p, state: next, label: r.label, you: y, opp: o });
        }
      }
    }
  }
  return out;
}
