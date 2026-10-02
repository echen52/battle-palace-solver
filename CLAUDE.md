# CLAUDE.md — palace-solver

Battle Palace engine (and, next, solver) for Pokémon Emerald. Started
2026-10-02. **Step 1 (mechanics) is done; the solver design is not started —
the user wants to brainstorm "how to solve beating one opponent mon" first.
Do not build a solver before that conversation.**

## What this is

`engine/` is a fork of the Battle Arena engine (`battle_arena_assistant/
battle_arena_sim` @ 04ee03b — arena-solver Phase D, ROM-differential-tested,
AI interpreter 3,872/3,873 ROM decisions). See `docs/PROVENANCE.md`. The fork:

1. **removes the Arena judging** — Mind/Skill state and tables, the Body
   terminal, the 3-turn search (`d17b5a7`);
2. **makes the AI two-sided** — both battlers' ability records and move
   histories (the ROM's write sites for battler 1 added; Intimidate/Trace stay
   battler-0-only per source), MOVE_UNAVAILABLE slot occupancy (no throw on a
   third entry), `aiDecisionState(state, side)`, and `engine/mirror.js` so the
   player's mon runs the same AI on the mirrored position (`9c076ba`);
3. **adds the Palace hooks** — `resolveTurn(..., { loaf })` (the loafing
   action: "escape" runs BattlePalace_TryEscapeStatus, "plain" is the
   Disabled/Tormented/Taunt/Imprisoned InPalace scripts) and the AI's
   `palaceMask` (BattleAI_SetupAIData's defaultScoreMoves) (`287cce2`);
4. **adds `engine/palace.js`** — move groups, nature rows, the low-HP latch,
   each battler's choice (forced / Encore / Struggle; AI over the rolled group;
   limited picks loaf; the bug-faithful fallback + 50% slot-0 loaf), and
   `palaceTurn` (one shared Quick Claw draw; history recorded only where that
   battler's AI ran; latch updated after the turn) (`48640d0`);
5. **fixes two engine timing bugs** found on the way (`7daa70f`): Protect's
   decay now resets after a non-Protect resulting move (Cmd_setprotectlike);
   Destiny Bond lasts until the user's own next action (CANCELER_FLAGS).

## Tests — `bash tools/run-suite.sh` (4/4)

| test | what it pins |
|---|---|
| test-fork-equivalence | 7,178 probes (AI decisions + resolveTurn) vs the Arena engine, replayed by successor hash. With every ARENA_COMPAT flag set: 7,178/7,178 identical. Palace defaults move 45, every one attributed to a single flag (Protect 16, Disable 10, Yawn 12, Encore 6, Destiny Bond 1) |
| test-mirror | involution + battle symmetry on 1,859 corpus positions (detector caught a planted one-sided Leftovers skip) |
| test-palace | groups 354/354 vs battle_moves.h parsed directly; nature rows vs source comments; fallback + vanilla bug; loafs; limits; latch; history; 602 corpus positions |
| test-engine-fixes | Protect reset, Destiny Bond timing (5/8 fail on the unfixed engine) |
| test-pp | PP spending rules, running out, Leppa, Spite, Grudge, Transform, uncapped durations, Perish Song (21/31 fail with ARENA_COMPAT set) |

Workflow rule learned the hard way: **commit before any mutation check** —
`git checkout -- file` restores the last commit, not the pre-mutation file.

## Known gaps (stated, not silent)

- PP (Phase A, 2026-10-02) is modelled: battle + party PP, ppreduce rules,
  Pressure, Struggle, the Palace mask / AI / loaf hooks, Leppa, Spite, Grudge,
  Transform/Mimic, and the Arena-horizon durations (Disable, Encore, Yawn,
  Perish Song) un-capped. Known edge left: a "no PP left" failure still lets a
  Choice item lock (needs Spite into a Choice holder).
- **No party**: Roar/Whirlwind/Baton Pass always fail ("no reserve"), the
  opponent's AI switching (ShouldSwitch is NOT disabled in the Palace —
  src/battle_ai_switch_items.c:452 exempts only the Arena) and the player's own
  switch option are outside the 1v1 engine.
- Multi-hit contact moves into Static / Cute Charm / etc. throw by name (user
  decision 2026-09-30, kept); the player's AI now picks such moves too.
- No emulator validation of the Palace layer yet (arena-solver/emu has the
  harness; Palace would need BATTLE_TYPE_PALACE battles).

## Brainstorm agenda (for the user)

How to "solve" beating ONE opponent mon when neither side picks moves:
objective (P(KO it first)? HP left after? P(win the 3v3)?), what the player's
levers are (lead/order, team & sets, natures, when to switch), horizon (long
battles → Markov chain with cycles, not a fixed-depth tree), opponent
switching, and the IV tier / pool of the opponent.

## Side finding

The live Palace Predictor (echen52.github.io/battle-palace-predictor) runs the
pre-Phase-D engine. Turn-1 opponent distributions vs this engine over 1,500
random lv50 matchups: 211 throw in the predictor (status moves with no AI
handler), 1,032/1,289 identical, 98 differ by >10 points, 38 by >25 (largest:
Tentacruel 1's Sludge Bomb into Steelix, Fake Out into Ghosts, Earthquake into
a Traced Levitate).
