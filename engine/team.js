// ── team.js ────────────────────────────────────────────────────────────────
// Your whole team against ONE opponent mon. The position is a single engine
// state: the active mon is the engine's `you`, and two team-layer fields ride
// along (opaque to the engine):
//   youActive  the team index of the mon out
//   youBench   per team index: null for the active mon, else what that mon
//              carries -- { hpPct, status, sleepTurns, toxic, partyPP,
//              itemOverride, berryConsumed }
// (oppActive / oppBench are null: the opponent's team is unknown, and the
// opponent mon is the one being solved for.)
//
//   tctx = { team: [mon, ...], opp, oppReserves }   oppReserves: how many
//   healthy teammates the opponent has behind it (unknown; default 2) -- it
//   decides whether Roar / Baton Pass / Perish Song can take it off the field.
//
// Every engine-state field is classified below (MON / SIDE / VOLATILE, plus the
// opponent fields that point at the leaving mon); an unclassified `you*` field
// throws, so a new engine field cannot be carried or dropped by accident.

import * as L from "./logic.js";
import { lowHpCheck, palaceChoices, palaceTurn, quickClawDraws, updateLowHpLatches } from "./palace.js";

// Your mons default to max PP Ups (3 per move) -- user decision 2026-10-02.
// The opponent's Frontier mons have none (engine buildMon default).
export function buildPlayerMon(config) {
  return L.buildMon({ ppUps: 3, ...config });
}

// ── field classification ───────────────────────────────────────────────────
// MON: party data, kept on the bench and brought back in. Cmd_switchindataupdate
// copies the party struct into the battle slot (src/battle_script_commands.c:
// 4612-4632): HP, status1 (incl. the sleep counter, written back by the
// canceler -- src/battle_util.c:2270-2275), PP, the held item.
const MON = new Set(["yourHpPct", "youStatus", "youSleepTurns", "youToxicCounter", "youPP", "youPartyPP",
  "youItemOverride", "youBerryConsumed"]);
// SIDE: the field, not the mon -- side timers and the slot's pending effects.
//   Spikes / Mist / screens / Safeguard: gSideStatuses / gSideTimers.
//   Wish and Future Sight: gWishFutureKnock, by battler slot (they land on
//   whoever stands there). usedHeldItems: by battler slot (Recycle's memory).
//   yourHpPctAtStart: Arena bookkeeping, unread here. yourUsablePartyMons and
//   the team fields: rewritten by switchIn.
const SIDE = new Set(["youSpikesLayers", "youMistTurns", "youReflectTurns", "youLightScreenTurns", "youSafeguardTurns",
  "youWishTurns", "youFutureSight", "youUsedItem", "yourHpPctAtStart", "yourUsablePartyMons", "youActive", "youBench"]);
// VOLATILE: cleared by SwitchInClearSetData (src/battle_main.c:3200-3290):
// stat stages, status2 (confusion, substitute, locks, Focus Energy, Curse,
// Nightmare, Foresight, Torment, infatuation, recharge, escape prevention),
// status3 (Leech Seed, Ingrain, Yawn, Perish Song, Mud/Water Sport, Minimize,
// Lock-On, Imprison, Grudge), the whole disable struct (Disable, Encore,
// Taunt, Stockpile, Fury Cutter, Protect uses, Perish timer, Truant), the last
// moves, the Choice lock, the resources flags (Flash Fire), the AI's history
// of this battler (ClearBattlerMoveHistory / ClearBattlerAbilityHistory) and
// the Palace latch; plus Transform, Mimic and ability / type overrides, which
// live in the battle struct the party copy replaces.
const VOLATILE = new Set(["youConfused", "youTauntTurns", "youDisabledMove", "youDisableTurns", "youEncoredMove",
  "youEncoreTurns", "youTormented", "youLastTakenMove", "youFuryCutter", "youAlwaysHitTurns", "youRaging", "youRecharge",
  "youLock", "youWrapped", "youMonFirstTurn", "youAbilityOverride", "youMoves", "youTransform", "youTypes", "youBouncing",
  "youStockpile", "youNightmared", "youImprisoning", "youChoiceLock", "youCursed", "youForesighted", "youAttracted",
  "youStages", "youSeeded", "youMoveHistory", "youLastMove", "youSubstituteHP", "youDestinyBondActive", "youIngrained",
  "youFlashFireActive", "youCharging", "youEndureActive", "youProtected", "youProtectUses", "youYawnTurns",
  "youAbilityRecord", "youDamageTaken", "youLastResultingMove", "youGrudge", "youPerishCount", "youPalaceLowHp",
  "youDraggedOut"]);

export function classifyKey(k) {
  if (MON.has(k)) return "mon";
  if (SIDE.has(k)) return "side";
  if (VOLATILE.has(k)) return "volatile";
  if (/^(you|your)[A-Z]/.test(k)) return null; // unclassified: an error
  return "other";
}

// The fresh values of every VOLATILE field: a battle start between two plain
// mons whose ability does nothing on entry, so no field depends on who is out.
const PLAIN = L.buildMon({ species: "Snorlax", level: 50, nature: "Hardy", moves: ["Splash"], ability: "Thick Fat", item: null, evs: {} });
const DEFAULTS = { ...L.buildStartState({ you: PLAIN, opp: PLAIN }), youPalaceLowHp: false, oppPalaceLowHp: false };
const YOU_VF_MASK = Object.entries(L.VF).filter(([k]) => k.startsWith("you")).reduce((m, [, b]) => m | b, 0);

// ── start ──────────────────────────────────────────────────────────────────
function freshEntry(mon) {
  return { hpPct: 100, status: null, sleepTurns: null, toxic: false, partyPP: mon.maxPP.slice(), itemOverride: undefined, berryConsumed: false };
}
// The battle as it stands when the first turn begins: your lead and the
// opponent out, both sides' entry abilities applied (buildStartState).
export function teamStart(tctx, lead = 0) {
  return {
    ...L.buildStartState({ you: tctx.team[lead], opp: tctx.opp, yourUsablePartyMons: tctx.team.length - 1,
      oppUsablePartyMons: tctx.oppReserves ?? 2 }),
    youPalaceLowHp: false, oppPalaceLowHp: false,
    youActive: lead, oppActive: null,
    youBench: tctx.team.map((m, i) => (i === lead ? null : freshEntry(m))), oppBench: null,
  };
}
export const aliveBench = (s) => s.youBench.map((e, i) => (e && e.hpPct > 0 ? i : -1)).filter((i) => i >= 0);

// The engine context for a position: the active mon, and the team layer's
// hooks -- how many healthy teammates each side has behind (Roar, Baton Pass)
// and how to bring your replacement in when Roar drags your mon out.
export function engineCtx(tctx, s, { noLabels = true } = {}) {
  return {
    you: tctx.team[s.youActive], opp: tctx.opp, noLabels,
    // The damage roll: tctx.exactRoll enumerates the 16 rolls of every landed
    // hit; tctx.rollSample (a () => [0,1) source) draws one per hit instead,
    // for rollouts. Neither: the inherited 92.5% point estimate.
    ...(tctx.exactRoll ? { exactRoll: true, ...(tctx.rollOutcomeCap ? { rollOutcomeCap: tctx.rollOutcomeCap } : {}) } : {}),
    ...(tctx.rollSample ? { rollSample: tctx.rollSample } : {}),
    reserves: { you: aliveBench(s).length, opp: tctx.oppReserves ?? 2 },
    onDrag: (st) => dragIn(tctx, st),
  };
}

// ── switching out ──────────────────────────────────────────────────────────
// What the leaving mon takes to the bench. Natural Cure clears its status on
// the way out (Cmd_switchoutabilities, src/battle_script_commands.c:6276-6288),
// read on its CURRENT ability. The Toxic counter lives only in battle data
// (ENDTURN_BAD_POISON writes no party copy, src/battle_util.c:1536-1546), so
// it comes back at the start.
export function benchEntry(tctx, s) {
  const eff = L.effectiveCtx({ you: tctx.team[s.youActive], opp: tctx.opp }, s).you;
  const cured = eff.ability === "Natural Cure";
  return {
    hpPct: Math.max(0, s.yourHpPct),
    status: cured ? null : s.youStatus,
    sleepTurns: cured ? null : s.youSleepTurns,
    toxic: !cured && s.youStatus === "poison" && s.youToxicCounter != null,
    partyPP: s.youPartyPP.slice(),
    itemOverride: s.youItemOverride,
    berryConsumed: s.youBerryConsumed,
  };
}

// ── switching in ───────────────────────────────────────────────────────────
// Returns the new state. `firstTurn`: 2 when the switch happens during a turn
// (that turn's end decrements gDisableStructs.isFirstTurn, so the mon's NEXT
// turn is its first), true when it comes in at a turn's end after a faint
// (TurnValuesCleanUp has already run for that turn).
export function switchIn(tctx, old, j, { firstTurn }) {
  if (j === old.youActive) throw new Error("switchIn: that mon is already out");
  const entry = old.youBench[j];
  if (!entry) throw new Error(`switchIn: no bench entry ${j}`);
  if (entry.hpPct <= 0) throw new Error(`switchIn: team member ${j} has fainted`);
  const mon = tctx.team[j];
  const bench = old.youBench.slice();
  bench[old.youActive] = benchEntry(tctx, old);
  bench[j] = null;

  const s = {};
  for (const k of Object.keys(old)) {
    const c = classifyKey(k);
    if (c === null) throw new Error(`switchIn: state field "${k}" is not classified (engine/team.js MON / SIDE / VOLATILE)`);
    s[k] = c === "volatile" ? DEFAULTS[k] : old[k];
  }
  s.youStages = { ...DEFAULTS.youStages };
  s.youMoveHistory = [];
  // the mon's own data
  s.yourHpPct = entry.hpPct;
  s.youStatus = entry.status;
  s.youSleepTurns = entry.sleepTurns;
  s.youToxicCounter = entry.toxic ? 0 : null;
  s.youPP = entry.partyPP.slice();
  s.youPartyPP = entry.partyPP.slice();
  s.youItemOverride = entry.itemOverride;
  s.youBerryConsumed = entry.berryConsumed;
  s.youActive = j;
  s.youBench = bench;
  s.yourUsablePartyMons = bench.filter((e) => e && e.hpPct > 0).length;
  s.youMonFirstTurn = firstTurn;
  // your volatile bits off; the opponent's untouched ...
  s.volFlags = old.volFlags & ~YOU_VF_MASK;
  // ... except what pointed at the mon that left (SwitchInClearSetData's loops):
  // escape prevention it caused, a Lock-On aimed at it, an infatuation with
  // it, a Wrap it held, and the opponent's Mirror Move memory of it.
  s.oppAlwaysHitTurns = null;
  s.oppAttracted = false;
  s.oppWrapped = null;
  s.oppLastTakenMove = null;
  s.oppStages = { ...old.oppStages };

  // Cmd_switchindataupdate's Palace latch check (src/battle_script_commands.c:4659-4665).
  s.youPalaceLowHp = lowHpCheck(mon, s.yourHpPct, s.youStatus);

  // Cmd_switchineffects (:5230-5265): Spikes first -- maxHP / ((5 - layers) * 2),
  // at least 1, not for a Flying type or Levitate.
  const layers = s.youSpikesLayers ?? 0;
  if (layers > 0 && !mon.types.includes("Flying") && mon.ability !== "Levitate") {
    const hp = Math.round((s.yourHpPct / 100) * mon.stats.hp);
    const dmg = Math.max(1, Math.floor(mon.stats.hp / ((5 - layers) * 2)));
    s.yourHpPct = (Math.max(0, hp - dmg) * 100) / mon.stats.hp;
  }
  if (s.yourHpPct > 0) {
    // Truant: switch-in sets truantCounter = 1 (src/battle_script_commands.c:
    // 5258-5261) and the end of every turn toggles it (src/battle_util.c:2653-
    // 2654). A mid-turn entry is toggled to 0 that same turn and acts next turn;
    // a replacement after a faint comes in after the toggle and loafs first.
    if (mon.ability === "Truant") L.setVf(s, "youTruantLoaf", true);
    // ABILITYEFFECT_ON_SWITCHIN: a weather ability (Sand Stream is the only one
    // a Frontier battle can hold) sets its permanent weather and records itself.
    const w = L.permanentWeatherFromAbility(mon);
    if (w && !(s.weatherType === w && s.weatherTurns == null)) {
      s.weatherType = w;
      s.weatherTurns = null;
      L.recordAbility(s, "you", mon.ability);
    }
    // HandleFaintedMonActions state 6 (src/battle_util.c:1959-1960), after the
    // switch: ABILITYEFFECT_INTIMIDATE1 / _TRACE, both called with battler 0, so
    // both record onto the PLAYER (the battle-start quirk, Phase D F2a).
    const foe = L.effectiveCtx({ you: mon, opp: tctx.opp }, s).opp;
    if (mon.ability === "Intimidate") {
      L.recordAbility(s, "you", "Intimidate");
      if (!L.intimidateBlocked(foe, s, "opp")) L.bumpStage(s.oppStages, "atk", -1);
      else if (s.oppSubstituteHP == null) L.recordAbility(s, "opp", foe.ability);
    }
    if (mon.ability === "Trace" && foe.ability) { s.youAbilityOverride = foe.ability; L.recordAbility(s, "you", foe.ability); }
  }
  return s;
}

// Roar / Whirlwind on your mon: a uniformly random healthy teammate comes in
// at once (Cmd_forcerandomswitch's Random() % PARTY_SIZE, rejection-sampled),
// mid-turn. Its own switch-out effects (Natural Cure) apply to the leaver.
function dragIn(tctx, s) {
  const c = aliveBench(s);
  const left = { ...s, youDraggedOut: false };
  return c.map((j) => {
    const st = switchIn(tctx, left, j, { firstTurn: 2 });
    return { p: 1 / c.length, state: st, you: tctx.team[j] };
  });
}

// ── the opponent leaving on its own ────────────────────────────────────────
// ShouldSwitch (src/battle_ai_switch_items.c:428-527), at the opponent's
// action selection. Only the Perish Song case can be decided without knowing
// the opponent's team: a perish timer at 0 switches it out (ShouldSwitchIfPerishSong)
// unless it is trapped or has no one to switch to. Its other reasons all read
// its teammates (absorbers, super-effective moves, Natural Cure's targets)
// and are not modelled -- the solve treats the opponent as staying in.
function oppLeavesOnPerish(tctx, s, ctx) {
  if (s.oppPerishCount !== 0 || s.oppHpPct <= 0 || !((tctx.oppReserves ?? 2) > 0)) return false;
  if (s.oppWrapped || L.vf(s, "oppCantEscape") || s.oppIngrained) return false;
  const a = ctx.you.ability;
  if (a === "Shadow Tag" || a === "Arena Trap") return false;
  if (a === "Magnet Pull" && ctx.opp.types.includes("Steel")) return false;
  return true;
}

// ── one turn ───────────────────────────────────────────────────────────────
// action: "stay", or { switchTo: j }. Returns [{ p, state, outcome, label }]:
//   outcome  null       the battle goes on (choose again next turn)
//            "replace"  your mon fainted; choose a replacement (replace())
//            "win"      the opponent mon fainted
//            "oppLeft"  the opponent mon left the field (Roar, Baton Pass,
//                       Perish Song) -- not a KO; scored as neutral
//            "lose"     your whole team has fainted
export function teamTurn(tctx, s, action) {
  const ctx = engineCtx(tctx, s);
  if (oppLeavesOnPerish(tctx, s, ctx)) return [{ p: 1, state: s, outcome: "oppLeft", label: "the opponent switches out (Perish Song at 0)" }];
  let res;
  if (action === "stay") {
    res = palaceTurn(ctx, s, { ctxOf: (st) => engineCtx(tctx, st) });
  } else if (action && Number.isInteger(action.switchTo)) {
    res = switchTurn(tctx, s, action.switchTo, ctx);
  } else {
    throw new Error(`teamTurn: action must be "stay" or { switchTo: j }, got ${JSON.stringify(action)}`);
  }
  return res.map((r) => ({ p: r.p, state: r.state, label: r.label, outcome: outcomeOf(r.state) }));
}
function outcomeOf(s) {
  if (s.oppDraggedOut) return "oppLeft";
  if (s.oppHpPct <= 0) return "win";
  if (s.yourHpPct <= 0) return aliveBench(s).length > 0 ? "replace" : "lose";
  return null;
}

// Your switch as the turn's action. The opponent chose its move against the
// mon that was out (its Palace roll and AI ran before the switch). The switch
// goes first; Pursuit, if that was its choice, hits the leaving mon at double
// power and is its whole turn (BattleScript_ActionSwitch with
// jumpifnopursuitswitchdmg, src/battle_script_commands.c:8723-8760: it reads
// the CHOSEN move, so a Palace loaf on Pursuit still strikes -- the loaf flag is
// only read in HandleAction_UseMove). Otherwise its move lands on the newcomer.
function switchTurn(tctx, s, j, ctx) {
  const out = [];
  for (const draw of quickClawDraws(ctx, s)) {
    for (const o of palaceChoices(ctx, s, "opp", { qc: draw.qc })) {
      const s0 = o.aiRan ? L.aiDecisionState(s, "opp") : s;
      const pursuit = o.move === "Pursuit" && s0.oppHpPct > 0 && s0.oppStatus !== "sleep" && s0.oppStatus !== "freeze"
        && !L.vf(s0, "oppTruantLoaf");
      const before = pursuit ? L.resolveSingleAction(ctx, s0, "opp", "Pursuit", { pursuitSwitch: true }) : [{ p: 1, state: s0 }];
      for (const b of before) {
        if (b.state.oppHpPct <= 0) { out.push({ p: draw.p * o.p * b.p, state: b.state, label: "Pursuit -- and the opponent fell" }); continue; }
        const sIn = switchIn(tctx, b.state, j, { firstTurn: 2 });
        const ctxIn = engineCtx(tctx, sIn);
        const oppActs = !pursuit && sIn.yourHpPct > 0;
        const loaf = { you: "switched", opp: oppActs ? o.loaf : "switched" };
        const oppMove = oppActs ? o.move : tctx.opp.moves[0];
        for (const r of L.resolveTurn(ctxIn, sIn, tctx.team[j].moves[0], oppMove, { qc: draw.resolveQc, loaf, order: ["you", "opp"] })) {
          const next = r.state.yourHpPct > 0 && r.state.oppHpPct > 0 ? updateLowHpLatches(engineCtx(tctx, r.state), r.state) : r.state;
          out.push({ p: draw.p * o.p * b.p * r.p, state: next, label: `switch to ${tctx.team[j].species}${pursuit ? " (Pursuit)" : ""}; ${r.label}` });
        }
      }
    }
  }
  return out;
}

// A replacement after a faint, at the end of the turn: no attack on entry.
export function replace(tctx, s, j) {
  return switchIn(tctx, s, j, { firstTurn: true });
}
