// The opponent's replacement after a KO (engine/next-in.js): the trainer table
// generated from the decomp, FillTrainerParty's draw rules, the port of
// GetMostSuitableMonToSwitchInto on hand-worked cases, the best-hit share,
// and the scorer hook.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const T = await import(E("team.js"));
const S = await import(E("score.js"));
const N = await import(E("next-in.js"));
const SD = await import(E("showdown.js"));
const { FRONTIER_TRAINERS, TRAINER_ID_RANGES, TRAINER_ID_RANGES_HARD } = await import(E("frontier-trainers.js"));
const { FRONTIER_POOL: P } = await import(E("frontier-pool.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const throws = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };
const id = (k) => P[k].index;

// ── the generated trainer table ────────────────────────────────────────────
{
  ok(FRONTIER_TRAINERS.length === 300 && FRONTIER_TRAINERS.every((t, i) => t.id === i), "300 trainers, indexed by id");
  ok(FRONTIER_TRAINERS[0].name === "BRADY" && FRONTIER_TRAINERS[299].name === "GRETEL", "first and last trainer (FRONTIER_TRAINER_BRADY 0, _GRETEL 299)");
  // battle_tower.c's own comments on the two range tables
  ok(JSON.stringify(TRAINER_ID_RANGES) === "[[0,99],[80,119],[100,139],[120,159],[140,179],[160,199],[180,219],[200,299]]", "sFrontierTrainerIdRanges");
  ok(JSON.stringify(TRAINER_ID_RANGES_HARD) === "[[100,119],[120,139],[140,159],[160,179],[180,199],[200,219],[220,239],[200,299]]", "sFrontierTrainerIdRangesHard");
  // A function-like monSet macro: FRONTIER_MONS_BUG_CATCHER_1_EXTRA(METAPOD, KAKUNA)
  const lewis = FRONTIER_TRAINERS.find((t) => t.name === "LEWIS");
  ok(lewis.monSet.includes(id("Metapod 1")) && lewis.monSet.includes(id("Kakuna 1")), "LEWIS's monSet has the macro's arguments (Metapod, Kakuna)");
  // Cross-check: the Palace Predictor's bracket pools were generated separately
  // (from the same decomp tables). Every bracket agrees except challenge 1,
  // which differs by exactly the four BUG_CATCHER_1_EXTRA arguments its
  // generator dropped.
  const bpPath = path.join(here, "../../palace_predictor_sim/bracket_pools.mjs");
  const { BRACKET_POOLS } = await import(pathToFileURL(bpPath).href);
  const union = ([lo, hi]) => { const s = new Set(); for (let i = lo; i <= hi; i++) for (const m of FRONTIER_TRAINERS[i].monSet) if (m <= 849) s.add(m); return s; };
  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  let agree = 0;
  BRACKET_POOLS.forEach((b, c) => {
    const n = union(TRAINER_ID_RANGES[c]), h = union(TRAINER_ID_RANGES_HARD[c]);
    if (same(n, new Set(b.normal)) && same(new Set([...n, ...h]), new Set([...b.normal, ...b.b7Only]))) agree++;
  });
  const c1 = union(TRAINER_ID_RANGES[0]);
  const extra = [...c1].filter((x) => !BRACKET_POOLS[0].normal.includes(x)).sort((a, b) => a - b);
  ok(agree === 7 && JSON.stringify(extra) === JSON.stringify(["Metapod 1", "Kakuna 1", "Silcoon 1", "Cascoon 1"].map(id).sort((a, b) => a - b)),
    `bracket pools: 7/8 agree, challenge 1 differs by the 4 macro arguments (agree ${agree}, extra ${extra})`);
}

// ── the trainer draw ───────────────────────────────────────────────────────
{
  const p1 = N.trainerPrior({ challenge: 1, battle: 1 });
  ok(p1.length === 100 && p1[0].id === 0 && near(p1[0].p, 0.01), "challenge 1, battles 1-6: trainers 0-99");
  const p7 = N.trainerPrior({ challenge: 1, battle: 7 });
  ok(p7.length === 20 && p7[0].id === 100, "challenge 1, battle 7: the hard range 100-119");
  ok(N.trainerPrior({ challenge: 12, battle: 7 }).map((t) => t.id).join() === N.trainerPrior({ challenge: 9, battle: 2 }).map((t) => t.id).join()
    && N.trainerPrior({ challenge: 9, battle: 2 })[0].id === 200, "challenge 8+: always 200-299");
  ok(N.trainerPrior({ trainerId: 42 }).length === 1, "a known trainer");
  ok(throws(() => N.trainerPrior({ challenge: 0, battle: 1 }), /challenge/) && throws(() => N.trainerPrior({ challenge: 1, battle: 8 }), /battle/), "bad inputs throw");
  ok(N.fixedIvs(99) === 3 && N.fixedIvs(100) === 6 && N.fixedIvs(219) === 21 && N.fixedIvs(220) === 31, "GetFrontierTrainerFixedIvs bands");
}

// ── FillTrainerParty's rules, against the literal loop ─────────────────────
{
  // A trainer with a short monSet, simulated with the ROM's own loop
  // (monSet[Random() % n] until 3 are kept), kept only when the lead matches.
  const t = FRONTIER_TRAINERS.find((x) => x.monSet.length <= 14 && x.monSet.every((m) => m <= 849));
  const lead = t.monSet[0];
  const exact = N.teammateDist([{ id: t.id, p: 1 }], lead);
  ok(near(exact.reduce((a, r) => a + r.p, 0), 1), "teammate pairs sum to 1");
  const party = (ids) => ids.map((i) => N.poolEntry(i));
  ok(exact.every((r) => { const ps = party([lead, ...r.slots]); return new Set(ps.map((x) => x.species)).size === 3
    && ps.filter((x) => x.item).length === new Set(ps.filter((x) => x.item).map((x) => x.item)).size; }), "no pair repeats a species or a held item");
  let seed = 12345;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 24691) >>> 0) >>> 8;
  const counts = new Map(); let kept = 0;
  const join = (m, chosen) => { const e = N.poolEntry(m); return m <= 849 && chosen.every((c) => { const o = N.poolEntry(c); return o.species !== e.species && !(o.item && o.item === e.item) && c !== m; }); };
  for (let n = 0; n < 400000; n++) {
    const chosen = [];
    while (chosen.length < 3) { const m = t.monSet[rnd() % t.monSet.length]; if (join(m, chosen)) chosen.push(m); }
    if (chosen[0] !== lead) continue;
    kept++;
    const k = chosen.slice(1).join(); counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let worst = 0;
  for (const r of exact) worst = Math.max(worst, Math.abs((counts.get(r.slots.join()) ?? 0) / kept - r.p));
  ok(counts.size === exact.length && worst < 0.006, `the literal loop (${kept} kept parties, ${t.cls} ${t.name}) matches: ${counts.size} pairs, worst gap ${worst.toFixed(4)}`);
  ok(throws(() => N.teammateDist(N.trainerPrior({ challenge: 1, battle: 1 }), id("Salamence 1")), /no trainer in this bracket/), "a lead the bracket cannot have throws");
}

// ── GetMostSuitableMonToSwitchInto, by hand ────────────────────────────────
{
  const swampert = { types: ["Water", "Ground"], ability: "Torrent", foresighted: false };
  const metagross = { types: ["Steel", "Psychic"], ability: "Clear Body", foresighted: false };
  const pick = (you, faintedTypes, a, b) => N.mostSuitable(you, { types: faintedTypes }, [null, { id: id(a) }, { id: id(b) }], 0);
  // Typing pass vs Swampert. Ninetales (Fire): Water x2 then Ground x2 -> 40.
  // Sceptile (Grass): Water x0.5 -> 5, Ground x0.5 -> 2. Ninetales goes first,
  // has nothing super effective (Flamethrower is resisted), is struck off;
  // Sceptile's Leaf Blade is x4 -> it comes in.
  let r = pick(swampert, ["Fire"], "Ninetales 1", "Sceptile 1");
  ok(r.slot === 2 && r.by === "typing", `typing pass: Ninetales struck off, Sceptile in (${JSON.stringify(r)})`);
  // Fallback. Magcargo (Fire/Rock) 160, Ninetales 40, neither has a super
  // effective move -> by "damage" with gCurrentMove = MOVE_NONE (3), STAB off
  // the FAINTED mon (Fire): Ninetales: Flamethrower 3 -> STAB 4 -> x0.5 = 2;
  // Roar (Normal, power 0) 3 -> neutral = 3. Magcargo: Ember 4 -> 2; Rock
  // Slide 3 -> x0.5 vs Ground = 1; Acid Armor 3 -> x0.5 = 1; Sandstorm 1.
  // Best 3 = Ninetales's Roar: a status move wins it.
  r = pick(swampert, ["Fire"], "Ninetales 1", "Magcargo 1");
  ok(r.slot === 1 && r.by === "damage", `fallback: Ninetales by its Roar's 3 (${JSON.stringify(r)})`);
  ok(pick(swampert, ["Fire"], "Magcargo 1", "Ninetales 1").slot === 2, "...whichever slot it is in");
  // A teammate your types cannot touch is never picked by typing: vs
  // Metagross, Houndoom (Dark/Fire) scores 5 * 0 (Psychic -> Dark) = 0 even
  // though Flamethrower is super effective. Machamp (20) is tried, has
  // nothing super effective (Cross Chop: x2 Steel, x0.5 Psychic) -> fallback,
  // where Houndoom's Flamethrower 3 x2 = 6 beats Machamp's best 2.
  r = pick(metagross, ["Normal"], "Machamp 1", "Houndoom 1");
  ok(r.slot === 2 && r.by === "damage", `Houndoom skipped by typing, picked by damage (${JSON.stringify(r)})`);
  // Levitate. Vs Metagross, Flygon (Ground/Dragon) and Magcargo (Fire/Rock:
  // Steel x0.5 then x2) both score 10; Flygon is first and its Earthquake is
  // super effective -- unless the target levitates (TypeCalc: a miss). Then
  // Flygon is struck off (Faint Attack: x2 Psychic, x0.5 Steel) and Magcargo's
  // Ember (x2 on Steel) brings it in.
  let a = pick(metagross, ["Normal"], "Flygon 1", "Magcargo 1"), b = pick({ ...metagross, ability: "Levitate" }, ["Normal"], "Flygon 1", "Magcargo 1");
  ok(a.slot === 1 && a.by === "typing" && b.slot === 2 && b.by === "typing", `Earthquake counts into Metagross, not into a Levitate one (${JSON.stringify([a, b])})`);
  // Party order breaks ties: Ninetales and Arcanine (Fire) both score 5 vs
  // Metagross and both carry Flamethrower -- the earlier slot comes in.
  ok(pick(metagross, ["Normal"], "Ninetales 1", "Arcanine 1").slot === 1 && pick(metagross, ["Normal"], "Arcanine 1", "Ninetales 1").slot === 1,
    "equal typings: the first slot wins");
  // Breloom (Grass/Fighting) scores like Sceptile vs Swampert but has no Grass move.
  ok(pick(swampert, ["Normal"], "Breloom 1", "Sceptile 1").slot === 2, "Breloom first, struck off; Sceptile in");
}

// ── the best hit, and the score hook ───────────────────────────────────────
const team = SD.buildTeam(fs.readFileSync(path.join(here, "../teams/user-test-team.txt"), "utf8"));
{
  const opp = L.buildMon(getOpponentConfig("Salamence 1", { ability: "Intimidate", ivTier: 12 }));
  const tctx = { team, opp };
  const s = T.teamStart(tctx, 2); // Swampert out
  const sceptile = N.buildReplacement(id("Sceptile 1"), 12)[0].mon;
  const tab = N.hitTable(sceptile, team[2], s);
  let lb = 0; for (let roll = 85; roll <= 100; roll++) lb += L.calcDamage(sceptile, team[2], "Leaf Blade", { rollPercent: roll });
  ok(near(tab[0].dmg, lb / 16), `Leaf Blade into Swampert: the mean of the 16 rolls (${(lb / 16).toFixed(1)})`);
  const hp = team[2].stats.hp;
  ok(near(N.shareOf(tab, hp), Math.min(hp, lb / 16) / hp), "share at full HP");
  ok(N.shareOf(tab, 10) === 1, "a hit bigger than what is left: share 1");
  ok(near(N.shareOf([{ acc: 0.3, kind: "ohko" }], 100), 0.3) && near(N.shareOf([{ acc: 0.9, kind: "half" }], 101), 0.9 * 50 / 101), "one-hit KO and Super Fang");
  ok(N.hitTable(N.buildReplacement(id("Flygon 1"), 12)[0].mon, team[1], T.teamStart(tctx, 1))[0].kind === "none", "Earthquake into Latios (Levitate): nothing");

  const ni = N.makeNextIn({ lead: "Salamence 1", challenge: 3, battle: 7 });
  const tn = { ...tctx, nextIn: ni };
  const won = { ...s, oppHpPct: 0 };
  const share = ni.expectedHitShare(team, opp, won);
  const D = 3 * 1.25;
  ok(share > 0 && share <= 1, `expected share vs Swampert after a Salamence-1 KO: ${share.toFixed(3)}`);
  // (Salamence's Intimidate left Swampert at -1 Atk: the base is not 1.0.)
  const base = S.scoreState(tctx, won, "win").score;
  ok(near(S.scoreState(tn, won, "win").score, base - (0.5 * share) / D), "a win costs nextIn x share");
  ok(near(S.scoreState(tn, won, "oppLeft").score, base), "...not when the opponent left");
  ok(near(S.scoreState(tn, won, "win", { nextIn: 0 }).score, base), "...and nextIn 0 turns it off");
  ok(S.scoreState(tn, won, "win").field.nextInShare === share, "the breakdown carries the share");
  ok(ni.expectedHitShare(team, opp, { ...won, yourHpPct: 30 }) > share, "lower HP: a bigger share");
  // The replacement distribution answers to YOUR active mon's typing.
  const vs = (i) => ni.replacements({ types: team[i].types, ability: team[i].ability, foresighted: false }, { types: opp.types });
  ok(near(vs(2).reduce((a, r) => a + r.p, 0), 1) && vs(2)[0].id === id("Sceptile 1"), `vs Swampert the likeliest replacement is Sceptile 1 (${N.poolEntry(vs(2)[0].id).key})`);
  ok(vs(0)[0].id !== vs(2)[0].id, "...and a different one vs Metagross");
}

console.log(`test-next-in: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
