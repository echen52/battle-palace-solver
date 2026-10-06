// ── sim/screen-core.mjs ────────────────────────────────────────────────────
// The cheap screen (user decision 2026-10-06): the same late-pool battles as
// sim/streak.mjs (sim/draw.mjs, battle i depends only on (seed, i)), with NO
// solver -- your switches come from a fixed policy -- so a battle costs ~0.1 s
// instead of ~40-80 s and hundreds of team variants can be screened. The
// finalists then go through the solver sim.
//
// Policies (yours to choose -- player behaviour, not game mechanics):
//   stay  never switch by choice; only a faint brings a new mon in
//   type  switch when the opponent has a super-effective-or-worse threat to
//         your mon out (best damaging move: type effectiveness x STAB >= 2)
//         and a healthy bench mon faces less (lowest threat, then most HP)
// After a faint: chooseReplacement (engine/solve.js -- the best one-turn
// lookahead score), the solver's own replacement rule without the search.
//
// Counters, per your team slot (the mon OUT at the end of the turn gets the
// turn's events -- a switch-in that takes the hit is the one out):
//   kos            opponent mons that fainted on its turns (any cause)
//   maxBoost       highest sum of its positive stat stages
//   boostAtFirstKO that sum on the turn of its first KO (null: no KO)
//   status         [{ slot, status }] -- an opponent mon that went from no
//                  status to one on its turns (the opponent's own Rest excluded)
//   dbUsed / dbKOs Destiny Bond picked (not loafed) / an opponent KO'd on a
//                  turn it fainted with Destiny Bond up or picked
//   lockedBadTurns turns started Choice-locked into a damaging move the
//                  opponent out resists or is immune to
//   faintedLocked  it fainted while Choice-locked

import * as L from "../engine/logic.js";
import * as T from "../engine/team.js";
import * as Bt from "../engine/battle.js";
import { buildTeam } from "../engine/showdown.js";
import { getOpponentConfig } from "../engine/opponent-adapter.js";
import { rng } from "../engine/montecarlo.js";
import { chooseReplacement } from "../engine/solve.js";
import { TYPE_EFFECTIVENESS } from "../engine/type-table.js";
import { makeDraw, seedOf, FIRST_LATE } from "./draw.mjs";
import * as N from "../engine/next-in.js";

export const TURN_CAP = 400;

// Type effectiveness (src/data/battle/type_effectiveness.h via type-table.js;
// the entries after "FORESIGHT" apply only without Foresight -- kept: a
// policy's estimate, not the damage formula).
const EFF = new Map();
for (const e of TYPE_EFFECTIVENESS) if (Array.isArray(e)) EFF.set(`${e[0]}>${e[1]}`, e[2] / 10);
const ABSORB = { Ground: ["Levitate"], Fire: ["Flash Fire"], Water: ["Water Absorb"], Electric: ["Volt Absorb"] };
export function effOf(moveType, mon) {
  if ((ABSORB[moveType] ?? []).includes(mon.ability)) return 0;
  return mon.types.reduce((a, t) => a * (EFF.get(`${moveType}>${t}`) ?? 1), 1);
}
// The opponent's worst damaging-move threat to `mon`: effectiveness x STAB.
export function threat(attacker, mon) {
  let worst = 0;
  for (const mv of attacker.moves) {
    const m = mv && L.MOVES[mv];
    if (!m || !(m.power > 0)) continue;
    worst = Math.max(worst, effOf(m.type, mon) * (attacker.types.includes(m.type) ? 1.5 : 1));
  }
  return worst;
}

export const POLICIES = {
  stay: () => "stay",
  type: (B, s) => {
    const opp = B.oppTeam[s.oppActive];
    const here = threat(opp, B.team[s.youActive]);
    if (here < 2) return "stay";
    let best = null;
    for (const j of T.aliveBench(s)) {
      const t = threat(opp, B.team[j]), hp = s.youBench[j].hpPct;
      if (t >= here) continue;
      if (!best || t < best.t || (t === best.t && hp > best.hp)) best = { j, t, hp };
    }
    return best ? { switchTo: best.j } : "stay";
  },
};

const boostSum = (st) => Object.values(st ?? {}).reduce((a, v) => a + Math.max(0, v), 0);
const newCounters = () => ({ kos: 0, maxBoost: 0, boostAtFirstKO: null, status: [], dbUsed: 0, dbKOs: 0, lockedBadTurns: 0, faintedLocked: 0 });

export function makeScreen({ teamText, seed }) {
  const team = buildTeam(teamText);
  const draw = makeDraw(seed);
  function playBattle(i, policyName, { log = null } = {}) {
    const policy = POLICIES[policyName];
    if (!policy) throw new Error(`screen: unknown policy "${policyName}"`);
    const n = FIRST_LATE + i;
    const d = draw.drawBattle(n);
    const rand = rng(seedOf(seed, "screen", n));
    const oppTeam = d.keys.map((k, x) => L.buildFrontierOpponent(getOpponentConfig(k, { ability: d.abilities[x], ivTier: d.iv, allowUnreachableTier: true })));
    const B = { team, oppTeam, oppIds: d.keys.map(N.setId), rollSample: rand };
    const pick = (xs) => { let u = rand() * xs.reduce((a, x) => a + x.p, 0); for (const x of xs) { u -= x.p; if (u <= 0) return x; } return xs[xs.length - 1]; };
    const c = team.map(newCounters);
    let s = Bt.battleStart(B, 0), result = null, turn = 0, switches = 0;
    const t0 = Date.now();
    for (; turn < TURN_CAP && !result; turn++) {
      const before = s, oppSlot = s.oppActive;
      if (before.youChoiceLock) {
        const m = L.MOVES[before.youChoiceLock];
        if (m && m.power > 0 && effOf(m.type, B.oppTeam[oppSlot]) <= 0.5) c[before.youActive].lockedBadTurns++;
      }
      const action = T.aliveBench(s).length > 0 ? policy(B, s) : "stay";
      if (action !== "stay") switches++;
      const r = pick(Bt.battleTurn(B, s, action));
      s = r.state;
      log?.({ turn: turn + 1, action, chose: r.chose, label: r.label, before, after: s, outcome: r.outcome });
      // actor: the mon that took the turn's action (stay -> the one that was
      // out, even if a Roar then dragged it away; switch -> the newcomer, which
      // took the hit). out: the mon out at the end of the turn.
      const actor = action === "stay" ? before.youActive : s.youActive, out = s.youActive, me = c[actor];
      const outDown = s.yourHpPct <= 0, actorDown = actor === out ? outDown : false;
      // the opponent's mon fell: replaced already (settle), or still out when both
      // fell (its replacement waits for yours -- replaceYours), or the last one
      const oppDown = r.outcome === "win" || (s.oppActive === oppSlot ? s.oppHpPct <= 0 : !!(s.oppBench[oppSlot] && s.oppBench[oppSlot].hpPct <= 0));
      const db = action === "stay" && r.chose?.you === "Destiny Bond";
      if (db) me.dbUsed++;
      if (!outDown) c[out].maxBoost = Math.max(c[out].maxBoost, boostSum(s.youStages));
      if (oppDown) {
        me.kos++;
        if (me.boostAtFirstKO === null) me.boostAtFirstKO = actor === out && !outDown ? boostSum(s.youStages) : boostSum(before.youActive === actor ? before.youStages : null);
        if (actorDown && (db || (before.youActive === actor && before.youDestinyBondActive))) me.dbKOs++;
      } else if (!before.oppStatus && s.oppStatus && s.oppActive === oppSlot && r.chose?.opp !== "Rest") {
        me.status.push({ slot: oppSlot, status: s.oppStatus });
      }
      if (outDown && before.youActive === out && before.youChoiceLock) c[out].faintedLocked++;
      if (r.outcome === "replace") {
        const k = chooseReplacement(Bt.view(B, s), s);
        s = Bt.replaceYours(B, s, k);
      } else if (r.outcome) result = r.outcome;
    }
    return { i, n, trainer: d.trainer, keys: d.keys, abilities: d.abilities, iv: d.iv, policy: policyName,
      result: result ?? "turnCap", turns: turn, switches, youLeft: result === "win" ? 1 + T.aliveBench(s).length : 0,
      mons: team.map((m) => m.species), c, ms: Date.now() - t0 };
  }
  return { team, playBattle };
}
