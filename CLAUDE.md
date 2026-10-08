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
2. DONE (12ac281): opponent Baton Pass -- switchIn's batonPass option
   (battle_main.c:3158-3217 carry list), its pick = GetMostSuitable (BP vs
   MOVE_NONE: same power-0 Normal fallback), passing first -> your move lands on
   the newcomer (resolveTurnWithOrder's second action is now a function).
   Fixed on the way: a leaver's trap on its foe is lifted (oppCantEscape).
3. DONE (e933868, d7fff96): ShouldSwitch -> engine/should-switch.js, every
   Random() as odds; AI_TypeCalc in next-in.js; new engine field
   you/oppLastLanded (gLastLandedMoves; corpus.mjs strips it, fork equivalence
   still 7178/7178); locked mons choose nothing. test-should-switch 35;
   mutations 10/10 caught (after added cases).
4. DONE (4b4713f): sim/draw.mjs (late-pool trainer/party draw per (seed, n),
   Spenser Gold at 63/84/...) + sim/streak.mjs (solver every turn on a
   persistent worker pool; replacements by solving each candidate).
   test-sim-draw 8. User team files: teams/user-test-team.txt (Swampert),
   teams/mlsuicune.txt (Suicune). User: ~1000 battles per team (not 3000).
   Pilot (budget 3 s, 12 workers): ~4.4 s a solve (exact root ~0.6 s; half
   the solves stop at the budget), 150 s a battle (one 85-turn stall battle).
   Plan: budget 2 s, both teams at once, 7 workers each.
5. Policy b: the solver at your decision points, as the page would be used
   (it sees challenge/battle and the mons revealed, not the trainer). Cost is
   the issue (~6 s a decision): measure, then cache (e.g. the first decision
   of a battle depends only on the lead set / IV / ability).
6. Run the user's teams; report per-battle win rate and streak with CIs.
   FIRST RUN (2026-10-05/06, budget 2 s, 7 workers each; stopped by the
   user at Swampert 822 / Suicune 803): 95.98% vs 96.63%, paired 20 vs 25
   (p 0.55). INVALID -- made before the budget fix below; to be rerun (user:
   not yet, 2026-10-06). The Swampert process hit its 4 GB heap at ~820
   battles (solveCache grows without bound; resume works).
   BUDGET BUG (fixed 7b93135): when the exact first turn alone outran the
   budget (~3 s root vs 2 s), runSolve stopped before any rollout and every
   open lever scored root.score + open x 0 (Latios vs Spenser Suicune: 0.009
   vs 0.000). Now the budget never stops an open lever below minRollouts
   (solve-core.js and solveMC). test-montecarlo covers it.
   TRACING: streak.mjs --only <n,...|spenser> --trace <file>; DUMP_LOW=<x>
   dumps states scoring below x; sim/debug-dump.mjs re-solves one.

Open notes (user, 2026-10-06; several more teams to come):
- (b) The user's Spenser Gold line, to script for Spenser battles only (not
  built): turn 1 switch to the water mon; beat Arcanine (Roar -> switch back
  to the water mon); take Slaking's first move; switch to Latios on a
  Truant (loaf) turn; Metagross on Slaking's active turn if Latios is not
  behind a Sub; back to Latios on the loaf turn; Suicune faced by Latios.
  Open question to the user: Latios switched in on a loaf turn faces an
  ACTING Slaking next with no Sub up -- when does "see what Latios does"
  happen? Decomp: a Truant mon replacing a fainted one LOAFS its first turn
  (battle_script_commands.c:5258-5261 sets the counter on entry; the
  end-turn toggle, battle_util.c:2654, already ran).
- (c) Two-decision lookahead: rollouts now assume "stay" after the lever's
  first turn, so pivot cycles (Latios <-> Metagross vs Slaking) are only
  found one switch at a time. Needs no opponent team knowledge (the fight is
  vs the mon in front); cost is choosing turn 2 at every turn-1 outcome
  (hundreds to tens of thousands) -- cheap version: a few dozen rollouts per
  option there, ~3-10x slower. Not started.

## Phase F: strategy questions (user, 2026-10-06)

The user's four questions, in their order: (1) crippler + late setup sweeper,
(2) low-HP Destiny Bond users, (3) Dragon Dance / Swords Dance vs Curse /
Calm Mind, (4) Choice Band users beyond Metagross / Salamence / Heracross and
their teammates. Agreed plan: a CHEAP SCREEN (no solver) for many variants,
then the solver sim on finalists. Sets: Emerald-legal sources only (level-up,
TM, tutor, egg -- from the decomp's learnsets). Order: build the screen, then
CB (4), then DD vs Curse (3) and DB (2), crippler (1) last with a scripted
policy. Palace facts used (palace.js, from battle_moves.h and
gBattlePalaceNatureToMoveGroupLikelihood): DD / SD / CM / Bulk Up / Agility /
Belly Drum / Destiny Bond / Sub / Rest / Protect are DEFENSE; Curse, status
moves, Leech Seed, Spikes are SUPPORT; Reversal / Flail / Explosion ATTACK.
Naughty 20/70/10 -> 70/22/8 (setup healthy, attack low); Brave 70/15/15 ->
32/60/8 (DB when low).

STEP 1 DONE (801839a + tests): sim/screen-core.mjs + sim/screen.mjs. Same
battles as the solver sim (draw.mjs, (seed, i)); policies stay / type;
replacement = chooseReplacement. 1000 battles ~40 s (worker threads).
Counters per slot, credited to the mon that ACTED: KOs, max boost, boost at
1st KO, statuses dealt, DB picks / KOs, turns Choice-locked into a resist,
faints while locked. compare.mjs prints them. test-screen 15, mutations 7/7.
First screen (seed 1, 1000 each): Swampert team 92.4% stay / 91.7% type;
Suicune team 95.4% / 96.0%; paired sign test p 0.003 / <0.001 (Suicune).
NOT yet validated against the solver sim (the only solver run is the invalid
pre-fix one) -- a post-fix paired solver sample is needed to check the
screen ranks teams the same way.
Engine gap found: 10 of 336 Metronome-callable moves have no executor
(Conversion, Conversion 2, False Swipe, Vital Throw, Beat Up, Nature Power,
Charge, Assist, Camouflage, Weather Ball); only Clefable 1 reaches them in
the late pool; the screen records such a battle as an error.

STEP 2 DONE (CB grid, 2026-10-06): sim/cb-grid.mjs + sim/cb-report.mjs;
results in results/screen/cb (gitignored; grid.json = all 7, grid-6cb.json =
before Salamence). 7 CB leads (Metagross + the user's Salamence, Heracross,
Ursaring, Aerodactyl, Slaking, Tauros in teams/cb/all-sets.txt) x 15 pairs of
Swampert / Latios / Suicune / Snorlax / Registeel / Regice x {stay, type},
1000 battles each, seed 1, 0 errors. Clashing items settled in stage 1 with
Metagross leading (a small edge to Metagross). Averages over the 15 pairs
(stay / type): Salamence 90.5 / 91.5, Metagross 90.1 / 90.2, Heracross
89.9 / 90.1, Aerodactyl 89.7 / 90.2, Tauros 88.1 / 87.0, Ursaring 87.6 /
86.3, Slaking 87.1 / 85.7. Paired vs Metagross, same pair, pooled: Salamence
+0.43pp stay (p 0.18), +1.33pp type (p <0.0001); Heracross and Aerodactyl
within 0.5pp (n.s.); Ursaring / Slaking / Tauros -2.0 to -4.6pp (p <0.0001).
Best pair for every CB user: Latios + Suicune or Latios + Snorlax; worst
Registeel + Regice. Top team: Metagross + Latios + Suicune 95.7 / 96.7.
faintedLocked = the CB user fainted (always locked after its first move):
~0.2 per battle for the top four, ~0.6 for the three Normal types.
cb-report's sign test overflowed past n = 1023 (NaN) -- now in logs.

SOLVER ON FINALISTS (user, 2026-10-06; first block 250 battles, seed 1,
budget 2 s; results/solver-cb, gitignored; run.sh / watch.sh there). Team 4
(Salamence + Latios + Suicune) dropped by the user for the original
Metagross + Latios + Swampert. Wins / 250 (screen type-policy wins on the
same battles): Salamence + Suicune + Snorlax 247 (239); Aerodactyl + Latios
+ Suicune 246 (243); Metagross + Latios + Suicune 244 (243); Metagross +
Latios + Swampert 243 (233). 0 errors. All pairs n.s. (discordant 3-7 a
side, p >= 0.34). The solver helps the Swampert team most (+10) -- the
screen's type rule handicaps it; solver and screen lose mostly DIFFERENT
battles. ~40 s a battle machine-wide; Salamence + Snorlax slowest (stalls,
one 54-min battle). teams/mlsuicune.txt has Lum on both Latios and Suicune
-- not enterable (frontier_util.c AppendIfValid, 1994-2000 rejects a
repeated held item); the runs use Suicune Leftovers.
LOSS LOGS (user asked, 2026-10-07): results/solver-cb/loss-logs/<team>-losses.txt
(all 20 losses, replayed with --trace; trace now prints HP in points, both
benches, weather, items used, Choice lock, screens, Spikes, the Palace
low-HP row, and every set). Every replay matches the original's result /
turns / switches / decisions. REPLAYS ARE LOAD-DEPENDENT: the solver stops
on wall-clock budget, so near-ties flip with machine load -- 17/20 matched
first time; 264 and 299 on a retry; Spenser battle 126 (Swampert team) WINS
21/21 replayed alone and LOSES 8/8 with 4 replays at once (turn 8: switch
to Metagross 0.541 vs stay 0.540). Its loss: Latios left in on Slaking's
ACTING turn (stay 0.638 vs Metagross 0.531) and Hyper Beamed -- the same
pattern as streak battle 441 (open note (b)). Not shown in traces: crits
and misses (no label; read off the HP change).
USER REVIEW OF THE LOSS LOGS (2026-10-07) -> fixes A, B, D (fc64bc3 + tests):
A sim/policy.mjs chooseLever: stay unless the best switch beats stay by both
  95% margins (--stay-bias off = old rule). B sim/gender.mjs: genders fixed
  once per battle (engine split EVERY Attract use by gender odds,
  logic.js:10303-10313; also engine/gender-data.js rounds PERCENT_FEMALE and
  divides by 255 -- Machamp 25.1% vs the game's 63/256 = 24.6%; engine table
  NOT changed); opponent's from the battle seed + ability-bit parity, yours
  from (M)/(F) or drawn; solver told both; cache keyed on them. D tctx.labels
  (trace only): crit, asleep/frozen/paralyzed. Also confirmed for the user:
  Palace opponents DO switch (AI_TrySwitchOrUseItem, battle_controller_
  opponent.c:1540; Slowking->Lapras = FindMonThatAbsorbsOpponentsMove);
  Focus Punch loses focus when hit first (logic.js:8580); the "Choice Band
  used" trace text was a label bug (usedHeldItems is per slot).
REPLAY of the 20 losses: A+B+D 10 wins / 20; control (B+D, old rule) 4 / 20
(same battles, same load) -> 6 battles turned by A. Switches 19 vs 39.
Biased sample (losses only): the paired 250-battle block is the real test.
Logs: results/solver-cb/loss-logs-v2/.
REPLACEMENT AFTER A FAINT (user, 2026-10-07; b2cfb57): each candidate solved;
clearly better (ranges don't overlap) goes in; tied ones re-solved with +2 s;
still tied -> first turn, exact (sim/policy.mjs tieBreak): a KO before it
acts (5-pt band), b damage dealt (only if no candidate reaches 5% KO), c no
Choice item, d least HP lost, then score. --repl best = old rule. Battle
211's pick was NOT a tie (Aerodactyl 0.550+-0.002 vs Latios 0.536+-0.005;
Aerodactyl KOs before being hit 89.4% vs Latios 55.8% -- Latios picks Sub
37%). Replay of the 20 losses with everything: 11/20 wins; 15 multi-
candidate send-ins, 8 tied, 6 decided by the rule (5 by b, 1 by a).
REORDERED (user, 478f754): a (KO before it acts, 5-pt band), then the trade
dmg - 1.5 x HP lost - 0.2 x P(ends the turn in the Palace low-HP row,
palace.js:117) within 5 pts ("HP is more valuable"), then no Choice item,
then score. Of the 6 rule-decided picks above, 2 change: Metagross ->
Swampert (vs Salamence), Salamence -> Suicune (vs Armaldo, the user's pick).
PAGE UPDATED (user asked, b55232f; not pushed yet): engine/policy.js = the
shared rules (sim/policy.mjs re-exports). (1) the recommendation (star +
verdict) is chooseLever: stay unless a switch is clearly better ("switching
isn't clearly better (X leads by less than the noise)"); the table still
sorts by score. (2) opponent Gender picker (only for two-gender species;
cleared on a new set), your mons' gender on their cards from (M)/(F), a note
when Attract / Cute Charm is in play and a needed gender is unknown. (3)
"Just fainted: who goes in?" (#youFainted): buildSendIn (fresh entry; the
newcomer's Intimidate added on top of the entered opp stages via
form.entering) + decideSendIn (each solved with budget/n, tied re-solved,
then firstTurnStatsTeam vs the mon in front -> tieBreak). test-ui-logic 67,
test-site-browser 31; 7/7 mutations caught.
TRAINER NAMES ON LOGS (user, 2026-10-07; 72dc4a5): sim/trainer-name.mjs --
facility class -> gFacilityClassToTrainerClass (trainer_class_lookups.h) ->
gTrainerClassNames, title case ("225 Cooltrainer Miriam", "Palace Maven
Spenser (Gold)"); streak.mjs trace header + record field trainerName;
compare.mjs loss list. test-trainer-name 9; mutations 4/5 caught (the 5th,
first-vs-last mapping, is equivalent: each facility class maps once).
SECOND BLOCK, NEW RULES (user, 2026-10-07 -> 08 01:00; results/solver-cb2,
gitignored; watch.sh; paused once for heat, resumed -- streak.mjs skips done
battles). 250 each, seed 1, budget 2 s, traced. Aerodactyl team swapped for
Salamence + Latios + Suicune. Wins: Salamence + Suicune + Snorlax 248
(losses 120 Black Belt Raul, 274 Pkmn Breeder Oscar); Metagross + Latios +
Swampert 245; Metagross + Latios + Suicune 244; Salamence + Latios + Suicune
243. Paired vs Snorlax team: 6-2 (p 0.29), 5-2 (p 0.45), 7-2 (p 0.18).
Old vs new rules, same team, paired: Metagross+Suicune 2-2, Swampert 3-5,
Snorlax 2-3 (pooled 7-10, n.s.). Held switches ~150-210 a team; tied
send-ins re-solved 19-34, rule-decided 13-23 a team (mostly a and b).
Snorlax team ~34 turns a battle (vs 13-20): ~22 battles/h on 12 workers.
Loss logs (with trainer names): results/solver-cb2/loss-logs/.
THIRD BLOCK (user, 2026-10-08; results/solver-cb3, gitignored): variants of
Salamence + Suicune + Snorlax, 100 battles (150 more later: raise N in
watch.sh), seed 1 = battles 50-149 of solver-cb2. Blissey (Leftovers; Bold,
Ice Beam / Thunderbolt / CM / Rest) for Snorlax: 97/100 (95 Psychic Karlee
lose, 120 Black Belt Raul lose, 74 turn cap); original team 99/100 on the
same battles (2-0 discordant, p 0.5). Calm Mind Latios (Lum) for Salamence,
Suicune on Chesto (two Lums not enterable): STOPPED by the user at 30
(28-2: 52, 66). TURN-CAP FINDING (battle 74): Blissey +6/+6 and Umbreon
+6 evasion both out of PP, Struggle forever; the solver scored stay 0.79 vs
switch to a full-HP CB Salamence (Aerial Ace never misses) 0.55 every turn
-- the score cannot see a battle that never ends. Not changed (user to
decide). Loss logs: results/solver-cb3/loss-logs/.
LAST-MON SCORE (user, 2026-10-08; 42db68c): battle 120 (Blissey team) lost
with Salamence locked into Earthquake vs Heracross, its last mon. Played out
(4,000 games a line, scratch sack.mjs): turn 12 stay 70% / switch to Blissey
and leave it in 97% / Blissey then straight back 96%; turn 13 50 / 90 / 71;
turn 14 40 / 89 / 61. The solver's Blissey lever already plays the sack line
(rollouts stay, Salamence comes back unlocked after Blissey falls) -- the
SCORE hid it: a win was worth the HP left (worn win ~0.1, lose 0), so 40% x
0.47 beat 89% x 0.11. The party is healed and items restored after every
Palace battle (BattleFrontier_BattlePalaceBattleRoom/scripts.inc:276-281),
so engine/score.js now scores every win on the opponent's LAST mon
(oppReserves 0) as 1 = P(win); with teammates behind it the HP-keeping score
stands (user: more HP is better against the unknown mons in the back).
weights.lastMonWin false / streak --last-mon off = old. The page gets it
too (opponent "3rd" -> oppReserves 0). test-last-mon: solveMC on the
fixture gives Blissey 0.880 / stay 0.406 (played out 89 / 40); old score
stay 0.182 / Blissey 0.087. Mutations 6/7 (the 7th, oppLeft counted as a
win, is unreachable: no reserves -> the opponent cannot leave).
Loss replay with / without it (results/lastmon-replay/; run.sh stopped for
low memory after 4 teams, run2.sh did the last 2 with 3 workers): all 25
non-wins of solver-cb2 + solver-cb3, fix and --last-mon off side by side.
Fix only: 157 (Salamence + Latios + Suicune), Blissey team 74 (the turn-cap
stalemate: won in 45 turns) and 120 (turn 12 switch to Blissey 0.973 vs
stay 0.700; Salamence back unlocked, won turn 14). Old only: none. Both
won (load variance): 138, 204, Snorlax team 120. 3-0 discordant (p 0.25).
Quirk seen in 74: once every lever scores 1.000 (a sure win) the pick
can switch back and forth -- harmless (Intimidate on each Salamence entry).

CB TESTING CLOSED (user, 2026-10-08, after the last-mon push 76df3d1).
QUESTION 2 CHANGED (user, 2026-10-08): Perish Song instead of Destiny Bond
("timing Perish Song is easier"). Not started -- brainstorm with the user
first. Facts gathered: Perish Song is DEFENSE in the Palace (palace-groups),
Mean Look / Block / Spider Web SUPPORT. The opponent AI switches out when
its perish timer is 0 (ShouldSwitchIfPerishSong, battle_ai_switch_items.c:
20-34; engine/should-switch.js:73, team.js oppLeavesOnPerish) unless trapped
(ShouldSwitch :439-453: wrapped / escape prevention, Shadow Tag, Arena Trap,
Magnet Pull) or out of teammates -> on its LAST mon Perish Song is a sure KO
in 3 turns if your side outlasts it. Emerald-legal learners (sim/legal.mjs):
level-up Lapras, Politoed, Misdreavus, Jynx, Altaria, Absol (Celebi: banned
from the Frontier); egg Gengar, Dewgong, Wigglytuff, Marowak, Azumarill,
Murkrow. Perish + Mean Look on one mon: Misdreavus, Jynx (level-up), Gengar,
Murkrow (egg + level-up). Modelling risk: rollouts assume stay after the
first turn, so a perished mon of yours dies in them (no timed switch-out at
count 1) -- open note (c); a scripted rollout rule may be needed.

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
