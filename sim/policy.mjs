// ── sim/policy.mjs ─────────────────────────────────────────────────────────
// The streak sim's choices: the shared rules live in engine/policy.js (the
// page uses them too); this adds the first-turn numbers against the
// opponent's REAL team (engine/battle.js: its switches and replacement).
import * as Bt from "../engine/battle.js";
import { turnStats } from "../engine/policy.js";

export { chooseLever, BAND, W_LOST, W_LOW, trade, tiedWithBest, tieBreak } from "../engine/policy.js";

// The first turn after sending mon j in at position s (your mon fainted):
// the chance the mon in front is KO'd before it acts, the expected damage
// dealt to it and lost by j (shares of max HP), and the chance j ends the
// turn alive in the Palace low-HP row. Exact rolls, no sampling.
export function firstTurnStats(B, s, j) {
  const B2 = { ...B, rollSample: null, exactRoll: true, labels: true };
  const sIn = Bt.replaceYours(B2, s, j);
  const slot = sIn.oppActive;
  const oppHpAfter = (st) => (st.oppActive === slot ? st.oppHpPct : (st.oppBench[slot]?.hpPct ?? 0));
  return { j, ...turnStats(Bt.battleTurn(B2, sIn, "stay"), sIn, B.team[j], oppHpAfter) };
}
