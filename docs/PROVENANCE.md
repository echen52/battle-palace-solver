# Engine provenance

`engine/` is forked from `battle_arena_assistant/battle_arena_sim/` at commit
**04ee03b** (main, 2026-10-01): the Battle Arena engine after arena-solver
Phase D, ROM-differential-tested against the emulator (0 divergences across
the three plans; AI interpreter reproduces 3,872 / 3,873 ROM decisions).

The first commit of this repo is the verbatim copy (md5s in
`docs/vendored-md5.txt`). Every later change to `engine/` is a Palace change
and is reviewable as a diff against that commit.

Files: logic.js, ai-interpreter.js, ai-program.js, ai-tables.js, move-data.js,
species-data.js, item-data.js, move-flags.js, crit-effects.js,
species-weights.js, type-data.js, type-table.js, acc-check.js,
damage-adjust.js, gender-data.js, frontier-pool.js, opponent-adapter.js.
