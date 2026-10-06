# CLAUDE.md — palace-solver

Battle Palace engine (and, next, solver) for Pokémon Emerald. Started
2026-10-02. **Mechanics, PP (Phase A) and the team layer (Phase B) are done;
Phase C steps 1-3 (score, exact attempt, Monte Carlo) and the opponent's
replacement after a KO are done (2026-10-05). Next: user decisions below
(damage-roll point estimate; a UI / CLI to run it).**

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

## Tests — `bash tools/run-suite.sh` (13/13, ~4 min, node gets a 4 GB heap)

| test | what it pins |
|---|---|
| test-fork-equivalence | 7,178 probes (AI decisions + resolveTurn) vs the Arena engine, replayed by successor hash. With every ARENA_COMPAT flag set: 7,178/7,178 identical. Palace defaults move 45, every one attributed to a single flag (Protect 16, Disable 10, Yawn 12, Encore 6, Destiny Bond 1) |
| test-mirror | involution + battle symmetry on 1,859 corpus positions (detector caught a planted one-sided Leftovers skip) |
| test-palace | groups 354/354 vs battle_moves.h parsed directly; nature rows vs source comments; fallback + vanilla bug; loafs; limits; latch; history; 602 corpus positions |
| test-engine-fixes | Protect reset, Destiny Bond timing (5/8 fail on the unfixed engine) |
| test-team | 33: classification, carried vs left-behind fields, Toxic/sleep on return, Spikes 1/8 1/6 1/4, Intimidate / Sand Stream / Truant on entry, switch order, Pursuit x2, Roar 50/50 and its blocks, Baton Pass, faint/replace/lose, end of turn after a KO, Perish switch; 300+ random team turns sum to 1 |
| test-score | 46: Showdown reader on the user's team (`teams/user-test-team.txt`; stats by hand, bad lines throw), every score term on hand-built positions, monWeights, outcome chances on a real turn. 5/5 mutations caught |
| test-next-in | 52 (11 Spenser: his 6 sets parsed from the decomp, hand-worked replacements incl. Lapras/Suicune vs a Grass type, errors; 6/6 Spenser mutations caught across next-in/ui-logic/browser): trainer table vs decomp range comments + the Palace Predictor's bracket pools (7/8 agree; challenge 1 differs by exactly the 4 BUG_CATCHER_1_EXTRA macro args the predictor's generator dropped), the literal FillTrainerParty loop simulated (400k) vs the exact teammate distribution, hand-worked GetMostSuitableMonToSwitchInto cases (typing pass, fallback, Levitate, ties, fainted-mon STAB), best-hit share, scorer hook. 8/8 mutations caught |
| test-solve | 17: exact search vs an unmerged brute force at 2 turns (every lever, worn-down position incl. faints/replacements; real start), a rule-decided fight to completion (1% in permanent sand), the replacement rule (best not first), budget + frontier (finished + open = 1). 5/5 mutations caught. ~11 s |
| test-montecarlo | 16: estimator algebra + Wilson margins + separation rule; MC vs exact P(KO/lose within 2 turns) within 3 sd; exact-only levers get no rollouts; a worker's batch equals the main thread's digit for digit (next-in live in it); parallel vs single-thread within margins. 6/6 mutations caught. ~45 s |
| test-rolls | 19: exact rolls through the team layer, a KO threshold the point estimate misses, drawn = enumerated (P(KO), mean HP; multi-hit per-hit draws vs grouped enumeration), rollout() draws the rolls, multi-hit into a Substitute, the root cap + fallback, workers carry the roll mode, solveFight. 5/5 mutations caught |
| test-ui-logic | 46 (+10 Spenser: brainFor, his list/IVs, 1st/2nd/3rd checks): every page input onto its engine field (HP, status, bad poison counter, bench, stages vs switch-in Intimidate, confusion index, Substitute HP, items, first turn, weather + turns, screens + turns, Spikes, low-HP latch auto/manual, sleep mix weights, 1st/2nd/3rd opponent -> next-in + reserves), set list, IV odds, result rows / ties. 6/6 mutations caught |
| test-site-browser | 24 (+ set dropdown, + Spenser Gold auto-pick and page vs Node solve vs his Arcanine): the page in headless Chromium (Playwright from battle_arena_sim/node_modules): team paste, set card, IV default, opponent's bars = turnChoices, page solve vs solveFight in Node (best + every score within margins), Stop, saved team over a reload, no page error |
| test-pp | PP spending rules, running out, Leppa, Spite, Grudge, Transform, uncapped durations, Perish Song (21/31 fail with ARENA_COMPAT set) |

Workflow rule learned the hard way: **commit before any mutation check** —
`git checkout -- file` restores the last commit, not the pre-mutation file.

## Known gaps (stated, not silent)

- DAMAGE ROLL (user chose option 1, 2026-10-05): the solver (solveFight)
  runs EXACT rolls -- the inherited ctx.exactRoll enumerates the 16 rolls in
  the exact first turn; the new ctx.rollSample draws one roll per hit in
  rollouts (same distribution). Measured: at the opponent's 45-66% HP, P(KO
  turn 1) differs from the 92.5% point estimate by up to 10 points. The
  engine default is still the point estimate (fork-equivalence, mirror and
  every older test run on it). Limits: the root refuses 3+ hit moves and
  >4000-outcome actions (rollOutcomeCap) -> that lever is all rollouts; the
  replacement rule's lookahead uses the point estimate (a decision rule).
  Benchmark with exact rolls (user's team x 8 leads x each mon out, challenge
  8): 22/24 separate, median ~6.5 s, exact root <= 2.4 s (deferReplace;
  eager replacements had cost 26 s). One recommendation FLIPPED vs the point
  estimate: Tyranitar 1 vs Latios out -- point: ->Metagross 0.861 vs
  ->Swampert 0.829 (separated); exact: ->Swampert 0.843 vs ->Metagross 0.833
  (budget, not separated).

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
   short fights finish exactly). BUILT 2026-10-05: engine/solve.js. MEASURED
   with the user's team vs 8 Frontier leads: distinct positions grow 50-100x a
   turn (exact HP values from damage rolls do not merge), ~3-8 ms per
   position (teamTurn 300-800 outcomes on turn 1), so 2 s covers ~2 turns and
   0/8 real fights complete; even a worn-down fight did not finish in 60 s
   (Rest / Substitute / miss / loaf tails). So in practice step 2 is the
   exactly enumerated first turn(s) and step 3 does the rest, from the
   frontier solveAction returns. Replacement rule (shared with MC): the bench
   mon with the best one-turn lookahead score -- it tends to SACRIFICE a worn
   mon to take the hit (Latios at 5%, even frozen, beats a full Swampert:
   ~0.3 at risk vs 1.25).
3. **Otherwise Monte Carlo** from the exactly enumerated root outcomes, with
   margins of error. Rollout policy: stay; after a faint send the best-scoring
   mon. Optional 2-turn decision version (measure how often it changes advice).
   Speed-ups to build in: sample one outcome per simulated turn instead of
   enumerating (~3–5x), worker threads (~4x), early stopping when separated.
   BUILT 2026-10-05: engine/montecarlo.js (+ -parallel.js, mc-worker.js).
   Exact turn 1 per lever, rollouts from its frontier (enumerate-then-draw:
   true one-outcome sampling would need branching rewritten across the
   11k-line engine -- not needed: 5-27 ms/game, 16 cores, 12 workers).
   Measured, user's team x 8 leads x 3 own leads (challenge 8): 22/24
   separate in median ~5.7 s, max 20 s; 2 near-ties (gap < 0.01) hit the
   30 s budget -> report those as "too close to call". Tyranitar 1 is
   open-level only (index 860), so its next-in hook is off.

Measured cost (stay policy, full enumeration then sample, 100 games):
Snorlax/Starmie 24 ms/game (12 turns), Metagross/Salamence 44 ms (5),
Gengar/Dusclops 115 ms (44), Blissey/Skarmory 163 ms (99) — ~2–9 ms/turn.
Target after speed-ups: a few seconds typical, ≤~30 s for stall fights.

## The opponent's replacement (engine/next-in.js, 2026-10-05)

User asked for it, decomp-only (no invented switching). When the mon you fight
faints, the opponent sends in GetMostSuitableMonToSwitchInto's pick
(battle_ai_switch_items.c:629) -- ported line by line, incl. the typing pass
that prefers the teammate YOUR types hit hardest (source comment: "possible
bug") and the damage fallback, which runs with gCurrentMove = MOVE_NONE
(HandleAction_ActionFinished, battle_util.c:670) so every move's base is 3.
Teammates: exact distribution from the trainer draw (challenge + battle, or
trainerId) and FillTrainerParty's rules, conditioned on the lead. Score: a win
costs nextIn (0.5, user chose "best hit") x the replacement's expected
best-hit share of your active mon's current HP. Inputs: tctx.nextIn =
makeNextIn({ lead: "<pool key>", challenge, battle }).
Gaps: trainers already fought this challenge are not excluded; no crits /
entry abilities in the best hit; when both mons faint the same turn no
penalty is charged; the opponent's VOLUNTARY switches (ShouldSwitch reasons
other than Perish Song) are in the decomp but still not ported -- user to
decide; Frontier Brain battles (fixed teams) not wired.

## The page (site/, 2026-10-05; user asked for an Arena-solver-like page)

Open it: serve palace-solver/ over http (it imports ../engine as ES modules
and runs module Web Workers -- file:// will not do), e.g.
`python -m http.server 8765` then http://localhost:8765/site/index.html.
Files: index.html, styles.css (Palace family colours, Arena layout), app.js
(DOM), ui-logic.js (pure: form -> buildFight -> { tctx, start mix, actions,
labels, notes }; turnChoices; resultRows/verdict), solver.js + worker.js (the
browser twin of montecarlo-parallel.js; shared engine/solve-core.js +
engine/worker-handler.js). Saved teams: localStorage "palaceSolver.savedTeams"
(all echen52 Pages sites share one origin -- the prefix keeps it apart).
Not on the page yet: score weights (defaults used), PP, Leech Seed / Curse /
Perish / other volatiles, Open Level.
SPENSER (2026-10-05, a1f03a2): the Palace Frontier Brain is on the page and in
next-in (BRAIN_TEAMS from frontier_util.c sFrontierBrainsMons, party order;
lead = slot 0; fixed IV; replacement = GetMostSuitable over his slots 1-2).
Brain control auto-picks Silver at challenge 3 battle 7 and Gold at challenge 6
battle 7 (a default: holding Silver but not Gold, streak 21 is a normal
trainer); his 63/84/... appearances sit inside 8+, picked by hand.
TOOLING: Git Bash `sed -i` rewrites CRLF files to LF -- edit with Python
(normalise, edit, restore CRLF) or the Edit tool.
PUBLISHED 2026-10-05: origin = github.com/echen52/battle-palace-solver (public),
Pages from main / root -> https://echen52.github.io/battle-palace-solver/ (root
index.html forwards to site/). Every push needs the user's OK. Theme: burnt
orange (styles.css header comment lists the roles and computed contrast).

## Phase E: the streak sim (started 2026-10-05; user asked)

Goal: which of the user's teams make longer Palace streaks. User decisions
(2026-10-05): LATE POOL only (they reach it anyway); your switches decided by
the SOLVER (policy b) -- "the whole point ... was to optimize the switch".
Not policy (a) (never switch).

Steps:
1. DONE (72303a6): the opponent's three as a real team -- engine/battle.js
   (battleStart / view / oppSwitchIn via the mirror / Roar on them via
   ctx.onDragOpp / oppReplace = GetMostSuitable vs your mon out / settle:
   draw = loss). tests/test-battle.mjs 19, 6/6 mutations caught.
   Smoke run (user's team, 60 random late battles, always stay): 135 ms a
   battle; 3/60 stopped on the OPPONENT'S BATON PASS -> must be ported.
2. Opponent Baton Pass: SwitchInClearSetData's BP branch (battle_main.c:
   3158-3217: stages, confusion, Focus Energy, Substitute + its HP, escape
   prevention, Curse, Leech Seed, Lock-On, Perish + timer, Ingrain, Mud/Water
   Sport), the AI's pick (OpponentHandleChoosePokemon -> GetMostSuitable with
   gCurrentMove = Baton Pass, not MOVE_NONE), and the rest of the turn (if
   the passer moved first, your move lands on the newcomer).
3. ShouldSwitch (battle_ai_switch_items.c:428-527): runs for every trainer
   action in the Palace (OpponentHandleChooseAction -> AI_TrySwitchOrUseItem,
   only BATTLE_TYPE_TRAINER-gated). Port line by line, incl. its Random()s;
   replaces team.js's perish shortcut (tctx.oppSwitchHandled).
4. Trainer draw for a battle: GetRandomScaledFrontierTrainerId + no repeat
   within a challenge (battle_tower.c:1084-1099); party by FillTrainerParty;
   abilities by personality bit.
5. Policy b: the solver at your decision points, as the page would be used
   (it sees challenge/battle and the mons revealed, not the trainer). Cost is
   the issue (~6 s a decision): measure, then cache (e.g. the first decision
   of a battle depends only on the lead set / IV / ability).
6. Run the user's teams; report per-battle win rate and streak with CIs.

## Side finding

The live Palace Predictor (echen52.github.io/battle-palace-predictor) runs the
pre-Phase-D engine. Turn-1 opponent distributions vs this engine over 1,500
random lv50 matchups: 211 throw in the predictor (status moves with no AI
handler), 1,032/1,289 identical, 98 differ by >10 points, 38 by >25 (largest:
Tentacruel 1's Sludge Bomb into Steelix, Fake Out into Ghosts, Earthquake into
a Traced Levitate).
Also (2026-10-05): the vendored frontier-pool.js carries Mr. Mime twice --
"MR_MIME 1-4" (indexed) and "Mr. Mime 1-4" (index null, brain: true, from the
retired list; arena-solver tools/gen-frontier-pool.mjs brainKeys). Harmless
here (the page lists indexed sets only); a generator fix belongs in
arena-solver.
Also (2026-10-05): its bracket_pools.mjs challenge-1 pool lacks Metapod 1,
Kakuna 1, Silcoon 1, Cascoon 1 -- the FRONTIER_MONS_BUG_CATCHER_1_EXTRA(...)
macro arguments its generator dropped (trainers LEWIS 48, YOSHI 49).
