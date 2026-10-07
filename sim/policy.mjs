// ── sim/policy.mjs ─────────────────────────────────────────────────────────
// Which lever the streak sim plays from a solve's levers, and which mon it
// sends in after a faint.
//
// Stay unless a switch is CLEARLY better (user, 2026-10-07, after reading the
// loss traces): a switch gives the opponent a free hit and drops your mon's
// boosts, so the best switch must beat stay by more than both 95% margins
// (best.score - best.margin > stay.score + stay.margin); a tie inside the
// noise stays. stayBias false: the old rule (highest average, ties included).
//
// levers: [{ score, margin }] in the order of actions; returns
// { index, top, held } -- held: the top lever was a switch overruled by stay.
import * as Bt from "../engine/battle.js";

export function chooseLever(levers, actions, { stayBias = true } = {}) {
  const top = levers.reduce((bi, l, i) => (l.score > levers[bi].score ? i : bi), 0);
  const stayI = actions.indexOf("stay");
  if (!stayBias || stayI < 0 || top === stayI) return { index: top, top, held: false };
  const b = levers[top], st = levers[stayI];
  const clearly = b.score - (b.margin ?? 0) > st.score + (st.margin ?? 0);
  return clearly ? { index: top, top, held: false } : { index: stayI, top, held: true };
}

// ── the replacement after a faint (user, 2026-10-07) ───────────────────────
// Each candidate is solved; one whose score beats every other by both margins
// is sent in. The rest -- the candidates whose range overlaps the best's --
// are re-solved with more time (the caller), and if still tied, decided by
// the first turn, in the user's order:
//   a. the chance to KO the mon in front before it acts (speed, the moves the
//      Palace actually picks, accuracy, rolls, crits -- the exact turn);
//      candidates within KO_BAND of the best stay in;
//   b. when none of those can KO (best chance < KO_BAND): expected damage
//      dealt this turn (share of its max HP), within KO_BAND of the best;
//   c. a mon without a Choice item over one with (it won't be locked in for
//      the next opponent);
//   d. the least expected HP lost (share of its own max HP);
//   then the higher solver score.
export const KO_BAND = 0.05;

// cands: [{ j, value, margin }] -> the j's tied with the best (ranges overlap)
export function tiedWithBest(cands) {
  const best = cands.reduce((a, c) => (c.value > a.value ? c : a));
  return cands.filter((c) => c === best || c.value + (c.margin ?? 0) >= best.value - (best.margin ?? 0)).map((c) => c.j);
}

// stats: [{ j, value, pKO, dmg, lost, choice }] (the tied candidates) ->
// { j, step } -- step: the rule that decided ("a" .. "d", or "score")
export function tieBreak(stats) {
  let pool = stats.slice();
  const keep = (key, hi) => {
    const top = Math.max(...pool.map((x) => (hi ? x[key] : -x[key])));
    pool = pool.filter((x) => (hi ? x[key] : -x[key]) >= top - (key === "lost" ? 1e-9 : KO_BAND));
  };
  const one = (step) => (pool.length === 1 ? { j: pool[0].j, step } : null);
  const maxKO = Math.max(...pool.map((x) => x.pKO));
  keep("pKO", true);
  let r = one("a"); if (r) return r;
  if (maxKO < KO_BAND) { keep("dmg", true); r = one("b"); if (r) return r; }
  if (pool.some((x) => !x.choice) && pool.some((x) => x.choice)) { pool = pool.filter((x) => !x.choice); r = one("c"); if (r) return r; }
  keep("lost", false);
  r = one("d"); if (r) return r;
  return { j: pool.reduce((a, x) => (x.value > a.value ? x : a)).j, step: "score" };
}

// The first turn after sending mon j in at position s (your mon fainted),
// enumerated exactly with the opponent's real team (engine/battle.js): the
// chance the mon in front is KO'd before it acts, the expected damage dealt
// to it and lost by j (shares of max HP). Exact rolls, no sampling.
export function firstTurnStats(B, s, j) {
  const B2 = { ...B, rollSample: null, exactRoll: true, labels: true };
  const sIn = Bt.replaceYours(B2, s, j);
  const slot = sIn.oppActive, oppHp0 = sIn.oppHpPct, myHp0 = sIn.yourHpPct;
  let pKO = 0, dmg = 0, lost = 0;
  for (const r of Bt.battleTurn(B2, sIn, "stay")) {
    const st = r.state;
    const oppHp = st.oppActive === slot ? st.oppHpPct : (st.oppBench[slot]?.hpPct ?? 0);
    if (oppHp <= 0 && /opp never acts/.test(r.label ?? "")) pKO += r.p;
    dmg += (r.p * (oppHp0 - Math.max(0, oppHp))) / 100;
    lost += (r.p * Math.max(0, myHp0 - Math.max(0, st.yourHpPct))) / 100;
  }
  return { j, pKO, dmg, lost, choice: /^Choice /.test(B.team[j].item ?? "") };
}
