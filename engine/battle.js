// ── battle.js ──────────────────────────────────────────────────────────────
// A whole Palace battle: your team (team.js) against the opponent's THREE.
// team.js plays your side and treats the opponent as one mon; here the
// opponent's team is known (the streak sim draws it), so its side gets the
// same treatment as yours:
//   oppActive  the opponent's party slot out (0-2; slot 0 leads)
//   oppBench   per slot: null for the active mon, else what it carries --
//              the same entry shape as youBench (team.js freshEntry)
// The opponent's switch-in IS your switch-in run on the mirrored position
// (mirror.js swaps every you/opp field), so every carried / cleared field and
// every entry effect is the one already classified and tested for your side.
// The one place the ROM is not symmetric is handled by switchIn's quirkRecord
// (Intimidate / Trace record onto the player, battler 0).
//
//   B = { team: [your mons], oppTeam: [3 opponent mons], oppIds: [their set
//         ids, next-in.js setId] , exactRoll?, rollSample?, rollOutcomeCap? }
//
// Not here yet (stated): the opponent's voluntary switches (ShouldSwitch,
// src/battle_ai_switch_items.c:428-527) -- next.

import * as L from "./logic.js";
import * as T from "./team.js";
import { mirrorState } from "./mirror.js";
import { mostSuitable } from "./next-in.js";

// The battle as it stands when the first turn begins: your lead and their
// slot 0 out, both sides' entry abilities applied (buildStartState).
export function battleStart(B, lead = 0) {
  return {
    ...L.buildStartState({ you: B.team[lead], opp: B.oppTeam[0], yourUsablePartyMons: B.team.length - 1,
      oppUsablePartyMons: B.oppTeam.length - 1 }),
    youPalaceLowHp: false, oppPalaceLowHp: false,
    youActive: lead, oppActive: 0,
    youBench: B.team.map((m, i) => (i === lead ? null : T.freshEntry(m))),
    oppBench: B.oppTeam.map((m, i) => (i === 0 ? null : T.freshEntry(m))),
  };
}
export const aliveOpp = (s) => s.oppBench.map((e, i) => (e && e.hpPct > 0 ? i : -1)).filter((i) => i >= 0);

// The one-opponent view team.js plays on: the mon out, how many healthy
// teammates stand behind it, and the hook that brings one in when Roar /
// Whirlwind drags it out mid-turn.
export function view(B, s) {
  return {
    team: B.team, opp: B.oppTeam[s.oppActive], oppReserves: aliveOpp(s).length, oppSwitchHandled: true,
    ...(B.exactRoll ? { exactRoll: true } : {}), ...(B.rollOutcomeCap ? { rollOutcomeCap: B.rollOutcomeCap } : {}),
    ...(B.rollSample ? { rollSample: B.rollSample } : {}),
    oppDrag: (st) => oppDragIn(B, st),
    oppBaton: (st) => oppBatonIn(B, st),
  };
}

// The opponent's mon in slot j comes in: team.js switchIn on the mirrored
// position. firstTurn as in switchIn (2 mid-turn, true after a faint).
export function oppSwitchIn(B, s, j, { firstTurn, batonPass = false }) {
  const m = mirrorState(s);
  const sw = T.switchIn({ team: B.oppTeam, opp: B.team[s.youActive] }, m, j, { firstTurn, quirkRecord: "opp", batonPass });
  return mirrorState(sw);
}

// Roar / Whirlwind on the opponent: Cmd_forcerandomswitch picks a uniformly
// random healthy teammate (Random() % PARTY_SIZE, rejection-sampled), as for
// yours (team.js dragIn).
function oppDragIn(B, s) {
  const c = aliveOpp(s);
  const left = { ...s, oppDraggedOut: false };
  return c.map((j) => ({ p: 1 / c.length, state: oppSwitchIn(B, left, j, { firstTurn: 2 }), opp: B.oppTeam[j] }));
}

// Its Baton Pass: the script's openpartyscreen asks OpponentHandleChoosePokemon,
// i.e. the same GetMostSuitableMonToSwitchInto as after a faint, here against
// the passer (alive, so excluded as the mon out). Its damage fallback runs with
// gCurrentMove = Baton Pass instead of MOVE_NONE -- both power 0 and Normal,
// so the same base damage 3. The newcomer comes in mid-turn.
function oppBatonIn(B, s) {
  const st = { ...s, oppDraggedOut: false };
  const j = oppReplacementSlot(B, st);
  return [{ p: 1, state: oppSwitchIn(B, st, j, { firstTurn: 2, batonPass: true }), opp: B.oppTeam[j] }];
}

// After its mon faints: OpponentHandleChoosePokemon -> GetMostSuitableMonTo
// SwitchInto (next-in.js mostSuitable, the port), read against your mon out
// NOW (when both fainted, yours has already been replaced: HandleFaintedMon
// Actions runs battler 0's BattleScript_HandleFaintedMon first,
// src/battle_util.c:1938-1950). Returns the slot.
export function oppReplacementSlot(B, s) {
  const eff = L.effectiveCtx({ you: B.team[s.youActive], opp: B.oppTeam[s.oppActive] }, s);
  const you = { types: eff.you.types, ability: eff.you.ability, foresighted: !!s.youForesighted };
  const party = B.oppIds.map((id, i) => (i !== s.oppActive && s.oppBench[i] && s.oppBench[i].hpPct > 0 ? { id } : null));
  const pick = mostSuitable(you, { types: eff.opp.types }, party, s.oppActive);
  if (pick.slot == null) throw new Error("oppReplacementSlot: no healthy teammate");
  return pick.slot;
}
export function oppReplace(B, s) {
  return oppSwitchIn(B, s, oppReplacementSlot(B, s), { firstTurn: true });
}

// One turn of the battle. action: "stay" or { switchTo: j } (yours). Returns
// [{ p, state, outcome }]:
//   null        go on (the opponent's replacement, if its mon fainted, is
//               already in -- unless yours fainted too, see "replace")
//   "replace"   your mon fainted (and the battle goes on): pick a replacement
//               with replaceYours(); the opponent's own replacement, if due,
//               follows inside it
//   "win"       the opponent has no healthy mon left
//   "lose"      you have none (both running out together is a draw, which
//               ends the streak like a loss: B_OUTCOME_DREW ->
//               HandleEndTurn_BattleLost, src/battle_main.c:559)
export function battleTurn(B, s, action) {
  const out = [];
  for (const r of T.teamTurn(view(B, s), s, action)) {
    if (r.outcome === "oppLeft") throw new Error(`battleTurn: the opponent left the field unhandled (${r.label})`);
    out.push({ p: r.p, ...settle(B, r.state) });
  }
  return out;
}
// What a turn's result means for the battle (exported for the tests).
export function settle(B, st) {
  const youDown = st.yourHpPct <= 0, oppDown = st.oppHpPct <= 0;
  const youLeft = T.aliveBench(st).length, oppLeft = aliveOpp(st).length;
  if (youDown && youLeft === 0) return { state: st, outcome: "lose" };
  if (oppDown && oppLeft === 0) return { state: st, outcome: "win" };
  if (youDown) return { state: st, outcome: "replace" };
  if (oppDown) return { state: oppReplace(B, st), outcome: null };
  return { state: st, outcome: null };
}
// Your replacement after a faint; then the opponent's, if its mon fell too.
export function replaceYours(B, s, j) {
  const st = T.replace(view(B, s), s, j);
  return st.oppHpPct <= 0 ? oppReplace(B, st) : st;
}
