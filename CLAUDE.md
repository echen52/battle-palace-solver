# CLAUDE.md — palace-solver

Battle Palace engine (and, next, solver) for Pokémon Emerald. Started
2026-10-02. **Mechanics, PP (Phase A) and the team layer (Phase B) are done;
Phase C step 1 (score) is done (2026-10-05); next: step 2, the exact attempt.**

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

## Tests — `bash tools/run-suite.sh` (7/7)

| test | what it pins |
|---|---|
| test-fork-equivalence | 7,178 probes (AI decisions + resolveTurn) vs the Arena engine, replayed by successor hash. With every ARENA_COMPAT flag set: 7,178/7,178 identical. Palace defaults move 45, every one attributed to a single flag (Protect 16, Disable 10, Yawn 12, Encore 6, Destiny Bond 1) |
| test-mirror | involution + battle symmetry on 1,859 corpus positions (detector caught a planted one-sided Leftovers skip) |
| test-palace | groups 354/354 vs battle_moves.h parsed directly; nature rows vs source comments; fallback + vanilla bug; loafs; limits; latch; history; 602 corpus positions |
| test-engine-fixes | Protect reset, Destiny Bond timing (5/8 fail on the unfixed engine) |
| test-team | 33: classification, carried vs left-behind fields, Toxic/sleep on return, Spikes 1/8 1/6 1/4, Intimidate / Sand Stream / Truant on entry, switch order, Pursuit x2, Roar 50/50 and its blocks, Baton Pass, faint/replace/lose, end of turn after a KO, Perish switch; 300+ random team turns sum to 1 |
| test-score | 46: Showdown reader on the user's team (`teams/user-test-team.txt`; stats by hand, bad lines throw), every score term on hand-built positions, monWeights, outcome chances on a real turn. 5/5 mutations caught |
| test-pp | PP spending rules, running out, Leppa, Spite, Grudge, Transform, uncapped durations, Perish Song (21/31 fail with ARENA_COMPAT set) |

Workflow rule learned the hard way: **commit before any mutation check** —
`git checkout -- file` restores the last commit, not the pre-mutation file.

## Known gaps (stated, not silent)

- PP (Phase A, 2026-10-02) is modelled: battle + party PP, ppreduce rules,
  Pressure, Struggle, the Palace mask / AI / loaf hooks, Leppa, Spite, Grudge,
  Transform/Mimic, and the Arena-horizon durations (Disable, Encore, Yawn,
  Perish Song) un-capped. Known edge left: a "no PP left" failure still lets a
  Choice item lock (needs Spite into a Choice holder).
- Team layer (Phase B, engine/team.js): your 3-mon team vs one opponent mon,
  the position is one state (youActive / youBench). Switching by choice (goes
  first; the opponent's move, chosen vs the old mon, hits the newcomer; Pursuit
  x2 on the leaver, even from a Palace loaf), after a faint (free, end of turn)
  and by Roar/Whirlwind (random healthy teammate, mid-turn). Every state field
  classified MON / SIDE / VOLATILE. Opponent leaving = "oppLeft" (your Roar,
  its Baton Pass, its Perish Song at 0). NOT modelled: your own Baton Pass
  (named throw), Assist (named throw), the opponent's other ShouldSwitch reasons
  (they read its unknown team), Sleep Talk/Snore turns' sleep-counter desync.
- Multi-hit contact moves into Static / Cute Charm / etc. throw by name (user
  decision 2026-09-30, kept); the player's AI now picks such moves too.
- No emulator validation of the Palace layer yet (arena-solver/emu has the
  harness; Palace would need BATTLE_TYPE_PALACE battles).

## Phase C plan (agreed with the user 2026-10-02; step 1 built 2026-10-05)

Goal: knock out the ONE opponent mon in front with minimal damage/status/PP
cost to your team, without knowing its 2 teammates. Levers once the round
starts: stay (attack) or switch. Opponent leaving = neutral "oppLeft", shown
with its probability.

1. **Score** (expected team score, weights editable, equal default): per mon
   alive +0.25 + HP fraction − status (psn −0.10, brn −0.15, par −0.20,
   slp −0.30, frz −0.40 proposed) − PP penalty; bonuses for boosts on the
   final active mon (+0.05/stage), Spikes on their side (+0.05/layer),
   screens; penalty for a low-HP active mon at the end. lose = 0; oppLeft =
   team score with no KO bonus (optional koBonus). Show P(KO) alongside.
   Cases the user wants covered: boosting setups, draining the opponent's
   key-move PP, and the "no good switch vs a strong opponent" case.
2. **Exact attempt** within a ~2 s budget (positions grow x20–50/turn, so only
   short fights finish exactly).
3. **Otherwise Monte Carlo** from the exactly enumerated root outcomes, with
   margins of error. Rollout policy: stay; after a faint send the best-scoring
   mon. Optional 2-turn decision version (measure how often it changes advice).
   Speed-ups to build in: sample one outcome per simulated turn instead of
   enumerating (~3–5x), worker threads (~4x), early stopping when separated.

Measured cost (stay policy, full enumeration then sample, 100 games):
Snorlax/Starmie 24 ms/game (12 turns), Metagross/Salamence 44 ms (5),
Gengar/Dusclops 115 ms (44), Blissey/Skarmory 163 ms (99) — ~2–9 ms/turn.
Target after speed-ups: a few seconds typical, ≤~30 s for stall fights.

## Side finding

The live Palace Predictor (echen52.github.io/battle-palace-predictor) runs the
pre-Phase-D engine. Turn-1 opponent distributions vs this engine over 1,500
random lv50 matchups: 211 throw in the predictor (status moves with no AI
handler), 1,032/1,289 identical, 98 differ by >10 points, 38 by >25 (largest:
Tentacruel 1's Sludge Bomb into Steelix, Fake Out into Ghosts, Earthquake into
a Traced Levitate).
