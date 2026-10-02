// ── ai-interpreter.js ─────────────────────────────────────────────────────
// Phase D F13: the Gen III battle AI, run as the ROM runs it -- an interpreter
// for data/battle_ai_scripts.s, over the program gen-ai-program.mjs generates
// (ai-program.js; byte-identical to the retail ROM, verify-ai-program.mjs).
//
// Why an interpreter. The hand-ported per-effect handlers kept drifting from the
// scripts (Phase D F1-F12), and F13 cannot be ported that way at all: with no
// weather active, `get_weather` leaves funcResult unassigned, so it answers
// with whatever the last command wrote -- anywhere in the AI's run, across
// moves and scripts. Only running the scripts reproduces that.
//
// What runs (BattleAI_SetupAIData + ChooseMoveOrAction_Singles,
// src/battle_ai_script_commands.c:311-440): the AI struct is zeroed (so
// funcResult starts 0); each move's score starts at 100, or 0 when
// CheckMoveLimitations rules it out; then for each AI script flag in order --
// CheckBadMove, TryToFaint, CheckViability (the Frontier flags, :371-372) --
// the script runs once per move slot 0..3 from its root, until `end` with an
// empty call stack (BattleAI_DoAIProcessing :572-613). An empty slot is never
// run and scores 0. Then the best score wins, ties uniformly.
//
// Randomness is ENUMERATED, never sampled (hard constraint 3): every
// if_random_*, get_ability's two-ability guess and GetWhoStrikesFirst's tie coin
// forks the run into weighted threads; a mon's gender (get_gender reads the true
// personality) is drawn once per decision and kept. After each (script, slot)
// pass, threads that agree on everything later commands can read -- scores,
// funcResult, the drawn genders -- are merged.
//
// The engine supplies a VIEW (numbers, as the ROM holds them) -- see
// logic.js buildAiView -- and the per-slot simulatedRNG values.
import { AI_CODE, AI_LABELS, AI_DATA, AI_ROOTS, AI_CONST as K, OOB_MOVE_FFFF } from "./ai-program.js";

const T = K.AI_TARGET, U = K.AI_USER; // 0, 1
const SCRIPTS = [K.AI_SCRIPT_CHECK_BAD_MOVE, K.AI_SCRIPT_TRY_TO_FAINT, K.AI_SCRIPT_CHECK_VIABILITY]
  .map((flag) => AI_ROOTS[Math.log2(flag)]);
for (const r of SCRIPTS) if (!(r in AI_LABELS)) throw new Error(`ai-interpreter: root ${r} missing from the program`);

// sIgnoredPowerfulMoveEffects (src/battle_ai_script_commands.c:266-281)
const IGNORED_POWERFUL = new Set(["EFFECT_EXPLOSION", "EFFECT_DREAM_EATER", "EFFECT_RAZOR_WIND", "EFFECT_SKY_ATTACK",
  "EFFECT_RECHARGE", "EFFECT_SKULL_BASH", "EFFECT_SOLAR_BEAM", "EFFECT_SPIT_UP", "EFFECT_FOCUS_PUNCH",
  "EFFECT_SUPERPOWER", "EFFECT_ERUPTION", "EFFECT_OVERHEAT"].map((e) => K[e]));

// gBattleMoves[id] -> { effect, power, type }, 0xFFFF included (the ROM's bytes).
export function moveRow(view, id) {
  if (id === 0xffff) return OOB_MOVE_FFFF;
  const r = view.moveTable[id];
  if (!r) throw new Error(`ai-interpreter: no gBattleMoves row for move id ${id}`);
  return r;
}

const u8 = (x) => x & 0xff;
const s8 = (x) => ((x & 0xff) ^ 0x80) - 0x80;
const battlerOf = (sel) => (sel === U || sel === K.AI_USER_PARTNER ? U : T);

// One thread: { pc, stack, fr (funcResult), scores[4], g (genders [T,U] or null), p }
// A command returns the successor threads (usually one, the same object advanced).
// One thread: { pc, stack, fr (funcResult), scores[4], g (drawn genders by battler), p }.
// A command returns its successor threads -- usually one, the same object advanced.
// Dispatch is on the MACRO NAME from the verified program (ai-program.js), with
// the macro's own parameter names, so no opcode number is restated here.
// step returns the thread (the common path) or an array of threads (a branch).
// The step helpers live at module level, over the thread being stepped (step
// is never re-entered): allocating them per command was most of step's cost.
let TH = null, VIEW = null;
const next = () => { TH.pc++; return TH; };
const jump = (cond, target) => { TH.pc = cond ? target.pc : TH.pc + 1; return TH; };
const clone = (extra) => ({ ...TH, stack: TH.stack.slice(), scores: TH.scores.slice(), ...extra });
const fork = (pTrue, target) => { // taken with probability pTrue, else falls through
  if (pTrue <= 0) { TH.pc++; return TH; }
  if (pTrue >= 1) { TH.pc = target.pc; return TH; }
  const b = clone({ p: TH.p * pTrue, pc: target.pc });
  TH.p *= 1 - pTrue; TH.pc++;
  return [b, TH];
};
const mon = (sel) => VIEW.mon[battlerOf(sel)];
const hpPct = (m) => Math.floor((100 * m.hp) / m.maxHP);

function step(view, th, slot, rolls) {
  TH = th; VIEW = view;
  const c = AI_CODE[th.pc];
  const a = c.a;
  const moveId = view.mon[U].moves[slot];
  switch (c.op) {
    // Cmd_if_random_less_than: Random() % 256 < N jumps
    case "if_random_less_than": return fork(a.param0 / 256, a.param1);
    case "score": { // Cmd_score: s8 add (wraps), negative flattened to 0
      let s = s8(th.scores[slot] + a.param0);
      if (s < 0) s = 0;
      th.scores[slot] = s;
      return next();
    }
    // Cmd_if_hp_*: (100 * hp / maxHP) in u32 integer arithmetic
    case "if_hp_less_than": return jump(hpPct(mon(a.battler)) < a.param1, a.param2);
    case "if_hp_more_than": return jump(hpPct(mon(a.battler)) > a.param1, a.param2);
    case "if_hp_equal": return jump(hpPct(mon(a.battler)) === a.param1, a.param2);
    case "if_hp_not_equal": return jump(hpPct(mon(a.battler)) !== a.param1, a.param2);
    case "if_status": return jump((mon(a.battler).status1 & a.status1) !== 0, a.param2);
    case "if_not_status": return jump((mon(a.battler).status1 & a.status1) === 0, a.param2);
    case "if_status2": return jump(((mon(a.battler).status2 & a.status2) >>> 0) !== 0, a.param2);
    case "if_not_status2": return jump(((mon(a.battler).status2 & a.status2) >>> 0) === 0, a.param2);
    case "if_status3": return jump((mon(a.battler).status3 & a.status3) !== 0, a.param2);
    case "if_not_status3": return jump((mon(a.battler).status3 & a.status3) === 0, a.param2);
    case "if_side_affecting": return jump((view.side[battlerOf(a.battler)] & a.sidestatus) !== 0, a.param2);
    // the funcResult comparisons (gAIScriptPtr[1] is a u8)
    case "if_less_than": return jump(th.fr < a.param0, a.param1);
    case "if_more_than": return jump(th.fr > a.param0, a.param1);
    case "if_equal": case "if_equal_": return jump(th.fr === a.param0, a.param1);
    case "if_not_equal": return jump(th.fr !== a.param0, a.param1);
    case "if_move": return jump(moveId === a.param0, a.param1);
    case "if_in_bytes": case "if_not_in_bytes": case "if_in_hwords": case "if_not_in_hwords": {
      let hit = false;
      for (const v of AI_DATA[a.param0.table].v) { if (v === -1) break; if (th.fr === v) { hit = true; break; } }
      return jump(c.op.startsWith("if_in") ? hit : !hit, a.param1);
    }
    case "if_user_has_no_attacking_moves": // Cmd_if_user_has_no_attacking_moves: no move with power != 0
      return jump(!view.mon[U].moves.some((m) => m !== 0 && moveRow(view, m).power !== 0), a.param0);
    case "get_turn_count": th.fr = view.turnCounter; return next();
    case "get_type": { // Cmd_get_type
      const sel = a.param0;
      th.fr = sel === K.AI_TYPE1_USER ? view.mon[U].types[0] : sel === K.AI_TYPE1_TARGET ? view.mon[T].types[0]
        : sel === K.AI_TYPE2_USER ? view.mon[U].types[1] : sel === K.AI_TYPE2_TARGET ? view.mon[T].types[1]
        : sel === K.AI_TYPE_MOVE ? moveRow(view, moveId).type : th.fr;
      return next();
    }
    case "get_how_powerful_move_is": { // Cmd_get_how_powerful_move_is
      const row = moveRow(view, moveId);
      if (row.power > 1 && !IGNORED_POWERFUL.has(row.effect)) {
        const dmg = view.mon[U].moves.map((m, k) => {
          if (m === 0) return 0;
          const r = moveRow(view, m);
          if (IGNORED_POWERFUL.has(r.effect) || r.power <= 1) return 0;
          const d = view.aiDamage(k, rolls[k]); // AI_CalcDmg + TypeCalc, x simulatedRNG / 100 (logic.js aiCalcDamage)
          return d === 0 ? 1 : d;
        });
        th.fr = dmg.some((d) => d > dmg[slot]) ? K.MOVE_NOT_MOST_POWERFUL : K.MOVE_MOST_POWERFUL;
      } else th.fr = K.MOVE_POWER_OTHER;
      return next();
    }
    case "get_last_used_bank_move": th.fr = mon(a.battler).lastMove; return next(); // gLastMoves: 0 / id / 0xFFFF
    case "if_user_goes": { // Cmd_if_user_goes: GetWhoStrikesFirst(user, target, TRUE) == N
      // 0 user first, 1 target first, 2 an exact tie whose FRESH coin came up
      // (src/battle_main.c:4744-4750): a tie gives 0 or 2, never 1.
      const cmp = view.speedCompare; // "user" | "target" | "tie"
      const want = a.param0;
      let pEq = cmp === "user" ? (want === 0 ? 1 : 0) : cmp === "target" ? (want === 1 ? 1 : 0) : (want === 0 || want === 2 ? 0.5 : 0);
      if (cmp === "tie" && view.debug?.handlerTie) pEq = want === 0 || want === 1 ? 0.5 : 0; // measurement only: the handlers' old tie
      return fork(pEq, a.param1);
    }
    case "count_usable_party_mons": th.fr = view.usablePartyMons[battlerOf(a.battler)]; return next();
    case "get_considered_move_effect": th.fr = moveRow(view, moveId).effect; return next();
    case "get_ability": { // Cmd_get_ability (:1350-1404)
      const b = battlerOf(a.battler);
      if (b === U) { th.fr = view.mon[U].ability; return next(); } // gActiveBattler == battler: knows its own
      const t = view.mon[T];
      if (view.history.ability !== 0) { th.fr = view.history.ability; return next(); }
      if (TRAPPERS.includes(t.ability)) { th.fr = t.ability; return next(); }
      const [a0, a1] = t.speciesAbilities;
      if (a0 !== 0 && a1 !== 0) { // Random() & 1 -> abilities[0] else abilities[1]
        const other = clone({ p: th.p / 2, fr: a1, pc: th.pc + 1 });
        th.p /= 2; th.fr = a0; th.pc++;
        return [th, other];
      }
      th.fr = a0 !== 0 ? a0 : a1;
      return next();
    }
    case "if_type_effectiveness": // Cmd_if_type_effectiveness: TypeCalc on 40, quantised, flags ignored (retail)
      return jump(u8(view.typeEffDamageVar(moveId)) === a.param0, a.param1);
    case "if_status_in_party": { // any party mon with hp != 0 whose WHOLE status word equals
      const party = view.party[battlerOf(a.battler)];
      return jump(party.some((pm) => pm.hp !== 0 && pm.status === a.status1), a.param2);
    }
    case "get_weather": { // Cmd_get_weather: NO assignment without weather (the retail BUG)
      const w = view.weather;
      if (view.debug?.weatherBugfix) th.fr = 0xffffffff; // measurement only: the BUGFIX build's AI_WEATHER_NONE
      if (w & K.B_WEATHER_RAIN) th.fr = K.AI_WEATHER_RAIN;
      if (w & K.B_WEATHER_SANDSTORM) th.fr = K.AI_WEATHER_SANDSTORM;
      if (w & K.B_WEATHER_SUN) th.fr = K.AI_WEATHER_SUN;
      if (w & K.B_WEATHER_HAIL) th.fr = K.AI_WEATHER_HAIL;
      return next();
    }
    case "if_effect": return jump(moveRow(view, moveId).effect === a.param0, a.param1);
    case "if_not_effect": return jump(moveRow(view, moveId).effect !== a.param0, a.param1);
    case "if_stat_level_less_than": return jump(mon(a.battler).stages[a.stat] < a.param2, a.param3);
    case "if_stat_level_more_than": return jump(mon(a.battler).stages[a.stat] > a.param2, a.param3);
    case "if_stat_level_equal": return jump(mon(a.battler).stages[a.stat] === a.param2, a.param3);
    case "if_can_faint": { // Cmd_if_can_faint (:1743-): power < 2 never; else damage x roll / 100, min 1
      const row = moveRow(view, moveId);
      let can = false;
      if (row.power >= 2) {
        let d = view.aiDamage(slot, rolls[slot]);
        if (d === 0) d = 1;
        can = view.mon[T].hp <= d;
      }
      return jump(can, a.param0);
    }
    case "if_has_move": { // Cmd_if_has_move: the user's moves, or the target's HISTORY
      // The move is read through (u16 *)(gAIScriptPtr + 2) (:1806). The scripts
      // are byte-packed; at an odd address the ARM7TDMI's LDRH returns the
      // aligned halfword rotated right by 8 -- the operand's low byte, with the
      // battler byte (the one before it) in bits 24-31 -- and the compare is on
      // the whole register. Only AI_CV_Counter's check for Mirror Coat
      // (script line 1630) sits odd among the singles-reachable ones: in
      // retail it never finds Mirror Coat (emulator: six decisions, Phase D F13).
      const b = a.battler;
      const want = (c.addr + 2) & 1 && !view.debug?.alignedHasMove // measurement only: the aligned read
        ? ((a.param1 & 0xff) | ((b & 0xff) << 24)) >>> 0 : a.param1;
      const has = b === U ? view.mon[U].moves.includes(want)
        : b === K.AI_USER_PARTNER ? false // singles: the partner has hp 0
        : view.history.usedMoves.includes(want);
      return jump(has, a.param2);
    }
    case "if_has_move_with_effect": case "if_doesnt_have_move_with_effect": {
      const b = a.battler, e = a.param1, want = c.op === "if_has_move_with_effect";
      let has = false;
      for (let i = 0; i < 4 && !has; i++) {
        if (b === U || b === K.AI_USER_PARTNER) {
          const m = view.mon[U].moves[i];
          has = m !== 0 && moveRow(view, m).effect === e;
        } else if (want) {
          // retail BUG (:1909-1914): gated on the AI's OWN slot i, reading the target's history
          has = view.mon[U].moves[i] !== 0 && moveRow(view, view.history.usedMoves[i]).effect === e;
        } else {
          const h = view.history.usedMoves[i];
          has = h !== 0 && moveRow(view, h).effect === e;
        }
      }
      return jump(want ? has : !has, a.param2);
    }
    case "if_any_move_disabled_or_encored": {
      const m = mon(a.battler);
      const ok = a.param1 === 0 ? m.disabledMove !== 0 : a.param1 === 1 ? m.encoredMove !== 0 : false;
      return jump(ok, a.param2);
    }
    case "get_hold_effect": // the user's own item; the target's from BATTLE_HISTORY (F2b: always NONE)
      th.fr = battlerOf(a.battler) === U ? view.mon[U].holdEffect : view.history.targetHoldEffect;
      return next();
    case "get_gender": { // the TRUE gender (personality): drawn once per mon per decision
      const b = battlerOf(a.battler);
      if (th.g && th.g[b] !== undefined) { th.fr = th.g[b]; return next(); }
      const out = [];
      for (const { p, gender } of view.mon[b].genders) {
        if (p > 0) out.push(clone({ g: { ...(th.g ?? {}), [b]: gender }, p: th.p * p, fr: gender, pc: th.pc + 1 }));
      }
      return out;
    }
    case "is_first_turn_for": th.fr = mon(a.battler).isFirstTurn; return next();
    case "get_stockpile_count": th.fr = mon(a.battler).stockpile; return next();
    case "is_double_battle": th.fr = 0; return next();
    case "get_used_held_item": th.fr = mon(a.battler).usedHeldItem; return next(); // *(u8 *)&usedHeldItems
    case "get_move_type_from_result": th.fr = moveRow(view, th.fr).type; return next();
    case "get_move_power_from_result": th.fr = moveRow(view, th.fr).power; return next();
    case "get_move_effect_from_result": th.fr = moveRow(view, th.fr).effect; return next();
    case "get_protect_count": th.fr = mon(a.battler).protectUses; return next();
    case "goto": th.pc = a.param0.pc; return th;
    case "end": th.done = true; return th; // no `call` in the program: the stack is always empty
    case "if_level_cond": { // 0 greater, 1 less, 2 equal (user vs target)
      const lu = view.mon[U].level, lt = view.mon[T].level;
      const ok = a.param0 === 0 ? lu > lt : a.param0 === 1 ? lu < lt : lu === lt;
      return jump(ok, a.param1);
    }
    case "if_target_not_taunted": return jump(view.mon[T].tauntTimer === 0, a.param0);
    case "if_target_is_ally": return next(); // singles: never
    case "is_of_type": { const m = mon(a.battler); th.fr = m.types[0] === a.type || m.types[1] === a.type ? 1 : 0; return next(); }
    case "check_ability": { // Cmd_check_ability (:1407-1455)
      const b = battlerOf(a.battler);
      let ability = a.ability;
      if (b === T) {
        const t = view.mon[T];
        if (view.history.ability !== 0) { ability = view.history.ability; th.fr = ability; }
        else if (TRAPPERS.includes(t.ability)) ability = t.ability;
        else {
          const [a0, a1] = t.speciesAbilities;
          if (a0 !== 0) ability = a1 !== 0 ? (a0 !== a.ability && a1 !== a.ability ? a0 : 0) : a0;
          else ability = a1;
        }
      } else ability = view.mon[U].ability;
      th.fr = ability === 0 ? 2 : ability === a.ability ? 1 : 0;
      return next();
    }
    case "if_flash_fired": return jump(mon(a.battler).flashFired, a.param1);
    case "if_holds_item": { // own side: the item; the other side: BATTLE_HISTORY itemEffects (a byte)
      const b = battlerOf(a.battler);
      const item = b === U ? view.mon[U].item : view.history.itemEffects;
      return jump(u8(a.param1) === item, a.param2);
    }
    default:
      throw new Error(`ai-interpreter: command "${c.op}" (script line ${c.line}) is not implemented -- it should be unreachable from the singles roots`);
  }
}

const TRAPPERS = [K.ABILITY_SHADOW_TAG, K.ABILITY_MAGNET_PULL, K.ABILITY_ARENA_TRAP];

// Run the three scripts over the four slots; returns [{ p, scores }].
export function runAi(view, rolls) {
  let threads = [{ fr: 0, scores: view.mon[U].moves.map((m, i) => (m === 0 ? 0 : view.limited[i] ? 0 : 100)), g: null, p: 1 }];
  for (const root of SCRIPTS) {
    for (let slot = 0; slot < 4; slot++) {
      if (view.mon[U].moves[slot] === 0) { for (const t of threads) t.scores[slot] = 0; continue; }
      const finished = [];
      let live = threads.map((t) => ({ ...t, pc: AI_LABELS[root], stack: [], done: false }));
      let guard = 0;
      while (live.length) {
        if (++guard > 2_000_000) throw new Error("ai-interpreter: runaway script");
        const next = [];
        for (const th of live) {
          // step returns the thread itself, or an array when it branched
          const r = step(view, th, slot, rolls);
          if (r === th) (th.done ? finished : next).push(th);
          else for (const n of r) (n.done ? finished : next).push(n);
        }
        live = next;
      }
      // merge on everything later commands can read
      if (finished.length === 1) { const t = finished[0]; threads = [{ fr: t.fr, scores: t.scores, g: t.g, p: t.p }]; continue; }
      const m = new Map();
      for (const t of finished) {
        const key = t.scores.join(",") + "|" + t.fr + "|" + (t.g ? `${t.g[0]},${t.g[1]}` : "");
        const e = m.get(key);
        if (e) e.p += t.p; else m.set(key, { fr: t.fr, scores: t.scores.slice(), g: t.g, p: t.p });
      }
      threads = [...m.values()];
    }
  }
  return threads.map((t) => ({ p: t.p, scores: t.scores }));
}

// ChooseMoveOrAction_Singles (:420-440): slot 0 seeds the best; later slots
// with a move join on a tie or replace on a higher score; a uniform pick.
export function chooseFromScores(view, runs) {
  const out = new Map();
  for (const { p, scores } of runs) {
    let best = scores[0], picks = [0];
    for (let i = 1; i < 4; i++) {
      if (view.mon[U].moves[i] === 0) continue;
      if (scores[i] === best) picks.push(i);
      if (scores[i] > best) { best = scores[i]; picks = [i]; }
    }
    for (const i of picks) out.set(i, (out.get(i) ?? 0) + p / picks.length);
  }
  return out; // slot -> probability
}
