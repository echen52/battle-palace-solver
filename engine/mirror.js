// ── mirror.js ──────────────────────────────────────────────────────────────
// The engine's state is written from one point of view: `you` (battler 0, the
// player) and `opp` (battler 1). In the Battle Palace BOTH battlers' moves are
// chosen by the ROM's AI (ChooseMoveAndTargetInBattlePalace is called from the
// player controller too, src/battle_controller_player.c:2631), and the engine's
// AI only knows how to decide for `opp`. So the player's decision is made by
// mirroring the position -- every `you*` / `your*` field trades places with its
// `opp*` partner, and the two packed bit fields swap their per-side bits -- and
// asking the opponent's AI about the mirrored position.
//
// The swap is purely structural: no state value names a side (checked by
// tests/test-mirror.mjs over the corpus), so a key-for-key exchange is exact.
// mirrorState(mirrorState(s)) is s.

import { VF, TF_YOU_FLINCHED, TF_OPP_FLINCHED, TF_YOU_UNABLE, TF_OPP_UNABLE } from "./logic.js";

// Fields with no side. Everything else must belong to a pair, or mirrorState
// throws -- a new one-sided field cannot slip through silently.
const SIDELESS = new Set(["turn", "weatherType", "weatherTurns", "turnFlags", "volFlags"]);

// you* <-> opp*, your* <-> opp*. The partner of an opp* key is whichever of
// you* / your* the state actually has.
function partnerOf(key, state) {
  if (key.startsWith("your")) return "opp" + key.slice(4);
  if (key.startsWith("you")) return "opp" + key.slice(3);
  if (key.startsWith("opp")) {
    const rest = key.slice(3);
    if (("your" + rest) in state) return "your" + rest;
    if (("you" + rest) in state) return "you" + rest;
  }
  return null;
}

// volFlags: each you-bit has its opp partner at the next bit up (logic.js VF).
const VF_PAIRS = Object.entries(VF)
  .filter(([k]) => k.startsWith("you"))
  .map(([k, bit]) => {
    const partner = VF["opp" + k.slice(3)];
    if (partner === undefined) throw new Error(`mirror: VF.${k} has no opp partner`);
    return [bit, partner];
  });
const TF_PAIRS = [[TF_YOU_FLINCHED, TF_OPP_FLINCHED], [TF_YOU_UNABLE, TF_OPP_UNABLE]];

function swapBits(x, pairs) {
  let out = x;
  for (const [a, b] of pairs) {
    const hasA = (x & a) !== 0, hasB = (x & b) !== 0;
    out &= ~(a | b);
    if (hasA) out |= b;
    if (hasB) out |= a;
  }
  return out;
}

export function mirrorState(state) {
  const out = {};
  for (const key of Object.keys(state)) {
    if (SIDELESS.has(key)) continue;
    const p = partnerOf(key, state);
    if (p === null || !(p in state)) throw new Error(`mirrorState: "${key}" has no partner field -- make it two-sided before mirroring`);
    out[p] = state[key];
  }
  out.turn = state.turn;
  out.weatherType = state.weatherType;
  out.weatherTurns = state.weatherTurns;
  out.turnFlags = swapBits(state.turnFlags ?? 0, TF_PAIRS);
  out.volFlags = swapBits(state.volFlags ?? 0, VF_PAIRS);
  // keep the original key order, so a mirrored state hashes like a built one
  const ordered = {};
  for (const key of Object.keys(state)) ordered[key] = out[key];
  return ordered;
}

// The battle context the other way round: the mon objects trade places.
export function mirrorCtx(ctx) {
  return { ...ctx, you: ctx.opp, opp: ctx.you };
}
