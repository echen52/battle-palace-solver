// ── sim/policy.mjs ─────────────────────────────────────────────────────────
// Which lever the streak sim plays from a solve's levers.
//
// Stay unless a switch is CLEARLY better (user, 2026-10-07, after reading the
// loss traces): a switch gives the opponent a free hit and drops your mon's
// boosts, so the best switch must beat stay by more than both 95% margins
// (best.score - best.margin > stay.score + stay.margin); a tie inside the
// noise stays. stayBias false: the old rule (highest average, ties included).
//
// levers: [{ score, margin }] in the order of actions; returns
// { index, top, held } -- held: the top lever was a switch overruled by stay.
export function chooseLever(levers, actions, { stayBias = true } = {}) {
  const top = levers.reduce((bi, l, i) => (l.score > levers[bi].score ? i : bi), 0);
  const stayI = actions.indexOf("stay");
  if (!stayBias || stayI < 0 || top === stayI) return { index: top, top, held: false };
  const b = levers[top], st = levers[stayI];
  const clearly = b.score - (b.margin ?? 0) > st.score + (st.margin ?? 0);
  return clearly ? { index: top, top, held: false } : { index: stayI, top, held: true };
}
