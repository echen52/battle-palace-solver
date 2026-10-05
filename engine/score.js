// ── score.js ───────────────────────────────────────────────────────────────
// Phase C step 1: how good a position is for YOUR team, after (or during) the
// fight with the one opponent mon in front. Agreed with the user 2026-10-02
// (CLAUDE.md "Phase C plan"); every number below is a weight the caller can
// replace (scoreState(tctx, s, outcome, { ...DEFAULT_WEIGHTS, ... })).
//
// Per mon i of your team, weighted by monWeights[i] (equal by default):
//   fainted   0
//   alive     alive + hp * HP fraction
//             - status penalty (the mon's major status; Toxic counts apart)
//             - pp * (PP spent / max PP, over all its moves)
//             - itemLost (its held item consumed or knocked off)
// The ACTIVE mon -- the one that faces the opponent's next mon -- also gets:
//             + boost * (sum of its stat stages, all 7, negative ones count)
//             - lowHp when the Palace low-HP check holds (it would start the
//               next fight on the low-HP nature row)
//             - carry-over volatiles: confusion 0.05, Leech Seed 0.05,
//               Curse 0.10, a Perish Song count 0.30 (user OK 2026-10-05)
// The field:  + spikes per layer on the opponent's side
//             + screen per remaining turn of your Reflect / Light Screen
//             + koBonus when the outcome is "win"
// The sum is divided by sum(monWeights) * (alive + hp): an untouched team
// scores 1.0, boosts and field bonuses can push it above. "lose" scores 0.
// "oppLeft" is scored like the position (no KO bonus) -- neutral, as agreed.

import { lowHpCheck } from "./palace.js";

export const DEFAULT_WEIGHTS = Object.freeze({
  alive: 0.25,
  hp: 1.0,
  status: Object.freeze({ poison: 0.10, toxic: 0.15, burn: 0.15, paralysis: 0.20, sleep: 0.30, freeze: 0.40 }),
  pp: 0.10,
  itemLost: 0.05,
  boost: 0.05,
  lowHp: 0.05,
  carry: Object.freeze({ confused: 0.05, seeded: 0.05, cursed: 0.10, perish: 0.30 }),
  spikes: 0.05,
  screen: 0.01,
  koBonus: 0,
  monWeights: null, // null = 1 per team member
});

const STAGES = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];

// One team member's line: { species, active, alive, hpFrac, status, ppSpent,
// itemLost, value } -- value before the team weight.
function monLine(w, mon, active, d) {
  const line = { species: mon.species, active, alive: d.hpPct > 0, hpFrac: Math.max(0, d.hpPct) / 100,
    status: d.status ?? null, toxic: !!d.toxic, ppSpent: 0, itemLost: false, value: 0, parts: {} };
  if (!line.alive) return line;
  const max = mon.maxPP.reduce((a, b) => a + b, 0);
  const left = d.partyPP.reduce((a, b) => a + b, 0);
  line.ppSpent = max > 0 ? (max - left) / max : 0;
  line.itemLost = mon.item != null && (d.itemOverride === null || !!d.berryConsumed);
  const statusKey = line.status === "poison" && line.toxic ? "toxic" : line.status;
  const p = line.parts;
  p.alive = w.alive;
  p.hp = w.hp * line.hpFrac;
  p.status = statusKey ? -(w.status[statusKey] ?? 0) : 0;
  if (statusKey && !(statusKey in w.status)) throw new Error(`score: no penalty for status "${statusKey}"`);
  p.pp = -w.pp * line.ppSpent;
  p.item = line.itemLost ? -w.itemLost : 0;
  line.value = p.alive + p.hp + p.status + p.pp + p.item;
  return line;
}

// The position's score and its breakdown. `outcome` is teamTurn's outcome
// (null while the fight goes on). `s` must be a team-layer state (teamStart).
export function scoreState(tctx, s, outcome = null, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const team = tctx.team;
  const mw = w.monWeights ?? team.map(() => 1);
  if (mw.length !== team.length) throw new Error(`score: monWeights has ${mw.length} entries for ${team.length} mons`);
  const denom = mw.reduce((a, b) => a + b, 0) * (w.alive + w.hp);
  if (outcome === "lose") return { score: 0, outcome, mons: [], field: {} };

  const mons = team.map((mon, i) => {
    if (i === s.youActive) {
      return monLine(w, mon, true, { hpPct: s.yourHpPct, status: s.youStatus,
        toxic: s.youStatus === "poison" && s.youToxicCounter != null, partyPP: s.youPartyPP,
        itemOverride: s.youItemOverride, berryConsumed: s.youBerryConsumed });
    }
    const e = s.youBench[i];
    return monLine(w, mon, false, e);
  });

  // The active mon's carry-over into the next fight.
  const act = mons[s.youActive];
  const field = {};
  if (act.alive) {
    const net = STAGES.reduce((a, k) => a + (s.youStages[k] ?? 0), 0);
    field.boost = w.boost * net;
    field.lowHp = lowHpCheck(team[s.youActive], s.yourHpPct, s.youStatus) ? -w.lowHp : 0;
    field.carry = -((s.youConfused ? w.carry.confused : 0) + (s.youSeeded ? w.carry.seeded : 0)
      + (s.youCursed ? w.carry.cursed : 0) + (s.youPerishCount != null ? w.carry.perish : 0));
    act.parts.boost = field.boost; act.parts.lowHp = field.lowHp; act.parts.carry = field.carry;
    act.value += field.boost + field.lowHp + field.carry;
  }
  field.spikes = w.spikes * (s.oppSpikesLayers ?? 0);
  field.screen = w.screen * ((s.youReflectTurns ?? 0) + (s.youLightScreenTurns ?? 0));
  field.koBonus = outcome === "win" ? w.koBonus : 0;

  const teamPart = mons.reduce((a, m, i) => a + mw[i] * m.value, 0);
  // Field bonuses are worth as much as one average-weighted mon's would be.
  const fieldPart = (field.spikes + field.screen + field.koBonus) * (mw.reduce((a, b) => a + b, 0) / mw.length);
  return { score: (teamPart + fieldPart) / denom, outcome, mons, field };
}

// The expectation over a distribution of finished (or cut-off) positions:
// [{ p, state, outcome }] as teamTurn returns them. Also the chances the
// user wants beside the score: P(KO), P(opponent left), P(your team lost).
export function expectedScore(tctx, results, weights = DEFAULT_WEIGHTS) {
  let score = 0, pKO = 0, pOppLeft = 0, pLose = 0, pOpen = 0, total = 0;
  for (const r of results) {
    total += r.p;
    score += r.p * scoreState(tctx, r.state, r.outcome, weights).score;
    if (r.outcome === "win") pKO += r.p;
    else if (r.outcome === "oppLeft") pOppLeft += r.p;
    else if (r.outcome === "lose") pLose += r.p;
    else pOpen += r.p;
  }
  if (Math.abs(total - 1) > 1e-9) throw new Error(`expectedScore: probabilities sum to ${total}`);
  return { score, pKO, pOppLeft, pLose, pOpen };
}
