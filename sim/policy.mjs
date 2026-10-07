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
// the first turn, in the user's order (revised 2026-10-07: a, then HP lost
// weighed against damage dealt, then the Choice item):
//   a. the chance to KO the mon in front before it acts (speed, the moves the
//      Palace actually picks, accuracy, rolls, crits -- the exact turn);
//      candidates within BAND of the best stay in;
//   b. the trade: damage dealt (share of the foe's max HP) minus W_LOST x HP
//      lost (share of its own) minus W_LOW x the chance it ends the turn in
//      the Palace low-HP row (palace.js lowHpCheck: HP <= max/2, latched --
//      its nature's move odds change for good). HP counts for more than
//      damage (user: "HP is more valuable since the behavior changes at low
//      HP"); within BAND of the best stay in;
//   c. a mon without a Choice item over one with (it won't be locked in for
//      the next opponent);
//   then the higher solver score.
export const BAND = 0.05, W_LOST = 1.5, W_LOW = 0.2;
export const trade = (x, { wLost = W_LOST, wLow = W_LOW } = {}) => x.dmg - wLost * x.lost - wLow * x.pLow;

// cands: [{ j, value, margin }] -> the j's tied with the best (ranges overlap)
export function tiedWithBest(cands) {
  const best = cands.reduce((a, c) => (c.value > a.value ? c : a));
  return cands.filter((c) => c === best || c.value + (c.margin ?? 0) >= best.value - (best.margin ?? 0)).map((c) => c.j);
}

// stats: [{ j, value, pKO, dmg, lost, pLow, choice }] (the tied candidates)
// -> { j, step } -- step: the rule that decided ("a", "b", "c" or "score")
export function tieBreak(stats, weights = {}) {
  let pool = stats.map((x) => ({ ...x, trade: trade(x, weights) }));
  const keep = (key) => { const top = Math.max(...pool.map((x) => x[key])); pool = pool.filter((x) => x[key] >= top - BAND); };
  const one = (step) => (pool.length === 1 ? { j: pool[0].j, step } : null);
  let r;
  keep("pKO"); if ((r = one("a"))) return r;
  keep("trade"); if ((r = one("b"))) return r;
  if (pool.some((x) => !x.choice) && pool.some((x) => x.choice)) { pool = pool.filter((x) => !x.choice); if ((r = one("c"))) return r; }
  return { j: pool.reduce((a, x) => (x.value > a.value ? x : a)).j, step: "score" };
}

// The first turn after sending mon j in at position s (your mon fainted),
// enumerated exactly with the opponent's real team (engine/battle.js): the
// chance the mon in front is KO'd before it acts, the expected damage dealt
// to it and lost by j (shares of max HP), and the chance j ends the turn alive
// in the Palace low-HP row. Exact rolls, no sampling.
export function firstTurnStats(B, s, j) {
  const B2 = { ...B, rollSample: null, exactRoll: true, labels: true };
  const sIn = Bt.replaceYours(B2, s, j);
  const slot = sIn.oppActive, oppHp0 = sIn.oppHpPct, myHp0 = sIn.yourHpPct;
  // already in (or due for) the low-HP row on entry: not this turn's doing
  const lowAlready = !!sIn.youPalaceLowHp || Math.round((myHp0 * B.team[j].stats.hp) / 100) <= Math.floor(B.team[j].stats.hp / 2);
  let pKO = 0, dmg = 0, lost = 0, pLow = 0;
  for (const r of Bt.battleTurn(B2, sIn, "stay")) {
    const st = r.state;
    const oppHp = st.oppActive === slot ? st.oppHpPct : (st.oppBench[slot]?.hpPct ?? 0);
    if (oppHp <= 0 && /opp never acts/.test(r.label ?? "")) pKO += r.p;
    dmg += (r.p * (oppHp0 - Math.max(0, oppHp))) / 100;
    lost += (r.p * Math.max(0, myHp0 - Math.max(0, st.yourHpPct))) / 100;
    if (!lowAlready && st.yourHpPct > 0 && st.youPalaceLowHp) pLow += r.p;
  }
  return { j, pKO, dmg, lost, pLow, choice: /^Choice /.test(B.team[j].item ?? "") };
}
