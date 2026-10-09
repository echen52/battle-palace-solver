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
  // STAB in the fallback is read off the FAINTED mon. Houndoom's best is
  // Shadow Ball 3 (neutral); Ninetales's Roar is 3 -- or 4 when the fallen
  // mon was Normal-type. Fainted Normal: Ninetales; fainted Fire: the tie
  // goes to the first slot, Houndoom.
  ok(pick(swampert, ["Normal"], "Houndoom 1", "Ninetales 1").slot === 2 && pick(swampert, ["Fire"], "Houndoom 1", "Ninetales 1").slot === 1,
    "fallback STAB comes from the fainted mon's types");
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

// ── fighting the opponent's second mon ─────────────────────────────────────
{
  const opp = L.buildMon(getOpponentConfig("Salamence 1", { ability: "Intimidate", ivTier: 12 }));
  const first = N.makeNextIn({ lead: "Salamence 1", challenge: 3, battle: 7 });
  const vsMeta = first.replacements({ types: team[0].types, ability: team[0].ability, foresighted: false }, { types: opp.types });
  const secondKey = N.poolEntry(vsMeta[0].id).key; // e.g. the likeliest one to come in second
  const ni = N.makeNextIn({ lead: "Salamence 1", second: secondKey, challenge: 3, battle: 7 });
  const r0 = ni.replacements({ types: team[0].types, ability: team[0].ability, foresighted: false }, { types: ["Normal"] });
  const r2 = ni.replacements({ types: team[2].types, ability: team[2].ability, foresighted: false }, { types: ["Fire"] });
  ok(near(r0.reduce((a, r) => a + r.p, 0), 1) && r0 === r2, `second = ${secondKey}: one third-mon distribution, whoever you have out (${r0.length} candidates)`);
  const sp = (id) => N.poolEntry(id).species, it = (id) => N.poolEntry(id).item;
  ok(r0.every((r) => sp(r.id) !== "Salamence" && sp(r.id) !== sp(N.poolEntry(vsMeta[0].id).index)
    && !(it(r.id) && (it(r.id) === it(N.poolEntry(vsMeta[0].id).index) || it(r.id) === P["Salamence 1"].item))), "the third repeats neither species nor item");
  // Its weight, by hand from the pairs: both slot orders summed.
  const dist = N.teammateDist(N.trainerPrior({ challenge: 3, battle: 7 }), id("Salamence 1"));
  const s2 = id(secondKey), with2 = dist.filter((d) => d.slots.includes(s2));
  const tot = with2.reduce((a, d) => a + d.p, 0);
  const top = r0[0];
  const byHand = with2.filter((d) => d.slots.includes(top.id) && d.ivs === top.ivs).reduce((a, d) => a + d.p, 0) / tot;
  ok(near(top.p, byHand), `the likeliest third (${N.poolEntry(top.id).key}) at ${(100 * top.p).toFixed(1)}%, as summed by hand`);
  ok(throws(() => N.makeNextIn({ lead: "Salamence 1", second: "Sunkern 1", challenge: 3, battle: 7 }), /cannot be/), "an impossible second throws");
}

// ── the Frontier Brain (Spenser) ───────────────────────────────────────────
{
  // His two teams vs sFrontierBrainsMons[FRONTIER_FACILITY_PALACE] parsed from
  // the decomp itself, in party order (evs there: hp atk def spe spa spd).
  const src = fs.readFileSync(path.join(here, "../../pokeemerald/src/frontier_util.c"), "utf8");
  const start = src.search(/\[FRONTIER_FACILITY_PALACE\] =\s*\n/), end = src.indexOf("[FRONTIER_FACILITY_ARENA] =", start);
  const block = src.slice(start, end);
  const word = (w) => w.split("_").map((x) => x[0] + x.slice(1).toLowerCase()).join(" ");
  const ITEM = { BRIGHT_POWDER: "BrightPowder", KINGS_ROCK: "King's Rock" }, MOVE = { EXTREME_SPEED: "ExtremeSpeed" };
  const mons = [...block.matchAll(/\.species = SPECIES_(\w+),\s*\.heldItem = ITEM_(\w+),\s*\.fixedIV = (\w+),\s*\.nature = NATURE_(\w+),\s*\.evs = \{([^}]*)\},\s*\.moves = \{([^}]*)\}/g)]
    .map(([, sp, it, iv, nat, evs, mv]) => {
      const [hp, atk, def, spe, spa, spd] = evs.split(",").map(Number);
      return { species: word(sp), item: ITEM[it] ?? word(it), iv: iv === "MAX_PER_STAT_IVS" ? 31 : Number(iv), nature: word(nat),
        evs: { hp, atk, def, spa, spd, spe }, moves: mv.split(",").map((m) => m.trim().replace("MOVE_", "")).map((m) => MOVE[m] ?? word(m)) };
    });
  const keys = [...N.BRAIN_TEAMS["Spenser Silver"], ...N.BRAIN_TEAMS["Spenser Gold"]];
  const same = mons.length === 6 && keys.every((k, i) => {
    const e = P[k], d = mons[i];
    return e.brain && e.species === d.species && e.item === d.item && e.fixedIV === d.iv && e.nature === d.nature
      && JSON.stringify(e.evs) === JSON.stringify(d.evs) && JSON.stringify(e.moves) === JSON.stringify(d.moves);
  });
  ok(same, `Spenser's 6 sets = the decomp's, in party order (${mons.map((m) => m.species).join(", ")})`);

  // Who comes in when his lead faints: GetMostSuitableMonToSwitchInto over his
  // slots 1-2, worked by hand. The typing pass takes the teammate YOUR types
  // hit hardest, then needs a super-effective move from it.
  const pick = (brain, you, ab = "x") => {
    const t = N.BRAIN_TEAMS[brain], lead = { "Spenser Silver": ["Poison", "Flying"], "Spenser Gold": ["Fire"] }[brain];
    const r = N.makeNextIn({ lead: t[0], brain }).replacements({ types: you, ability: ab, foresighted: false }, { types: lead });
    return r.length === 1 && r[0].p === 1 ? `${N.poolEntry(r[0].id).key} ${Object.keys(r[0].by)} ${r[0].ivs}` : JSON.stringify(r);
  };
  // Metagross: Slaking (10) ties Lapras (Steel x Water/Ice = 0.5 x 2 = 10), first wins; Earthquake is SE.
  ok(pick("Spenser Silver", ["Steel", "Psychic"]) === "Spenser Silver Slaking typing 16", `Silver vs Metagross: ${pick("Spenser Silver", ["Steel", "Psychic"])}`);
  // Swampert: Slaking 10 > Lapras 5, but no SE move; Lapras has none either -> damage fallback, all 3s, first wins.
  ok(pick("Spenser Silver", ["Water", "Ground"]) === "Spenser Silver Slaking damage 16", `Silver vs Swampert: ${pick("Spenser Silver", ["Water", "Ground"])}`);
  // Sceptile: Grass hits Lapras 2x (20) > Slaking 10; Ice Beam is SE.
  ok(pick("Spenser Silver", ["Grass"]) === "Spenser Silver Lapras typing 16", `Silver vs a Grass type: ${pick("Spenser Silver", ["Grass"])}`);
  ok(pick("Spenser Gold", ["Grass"]) === "Spenser Gold Suicune typing 31", `Gold vs a Grass type: ${pick("Spenser Gold", ["Grass"])} (Blizzard)`);
  ok(pick("Spenser Gold", ["Dragon", "Psychic"], "Levitate") === "Spenser Gold Slaking typing 31", `Gold vs Latios: ${pick("Spenser Gold", ["Dragon", "Psychic"], "Levitate")} (Shadow Ball)`);

  const t = N.BRAIN_TEAMS["Spenser Silver"];
  const last = N.makeNextIn({ lead: t[0], second: t[2], brain: "Spenser Silver" }).replacements({ types: ["Grass"], ability: "x" }, { types: ["Water", "Ice"] });
  ok(last.length === 1 && N.poolEntry(last[0].id).key === t[1] && last[0].p === 1, "facing his 2nd: the last one is the other, for certain");
  ok(throws(() => N.makeNextIn({ lead: t[1], brain: "Spenser Silver" }), /always sends out Crobat first/), "his lead is always slot 0");
  ok(throws(() => N.makeNextIn({ lead: t[0], second: t[0], brain: "Spenser Silver" }), /not one of/)
    && throws(() => N.makeNextIn({ lead: t[0], second: "Spenser Gold Suicune", brain: "Spenser Silver" }), /not one of/), "his 2nd must be one of his other two");
  ok(throws(() => N.makeNextIn({ lead: t[0], challenge: 3, battle: 7 }), /Frontier Brain set/), "a Brain set without brain: refused, not drawn from the trainer pool");
  // The replacement is built at his fixed IVs: same stats as the opponent builder.
  const lap = N.makeNextIn({ lead: t[0], brain: "Spenser Silver" }).replacements({ types: ["Grass"], ability: "x" }, { types: ["Poison", "Flying"] })[0];
  const built = N.buildReplacement(lap.id, lap.ivs), direct = L.buildMon(getOpponentConfig("Spenser Silver Lapras", { ability: "Water Absorb" }));
  ok(built.length === 2 && JSON.stringify(built[0].mon.stats) === JSON.stringify(direct.stats) && direct.stats.hp === 198,
    `his Lapras as the replacement: IV 16, both abilities half each, stats as built directly (HP ${direct.stats.hp})`);
}

// Open Level: high-tier teammates and leads, and the replacement built at
// the opponents' level (GetFrontierEnemyMonLevel, src/battle_tower.c:3247).
{
  const prior = N.trainerPrior({ challenge: 8, battle: 1 });
  const lead = P["Salamence 5"].index;
  const d50 = N.teammateDist(prior, lead), dOpen = N.teammateDist(prior, lead, { open: true });
  const sum = (d) => d.reduce((a, x) => a + x.p, 0);
  const hiP = (d) => d.filter((x) => x.slots.some((m) => m > 849)).reduce((a, x) => a + x.p, 0);
  ok(Math.abs(sum(d50) - 1) < 1e-9 && Math.abs(sum(dOpen) - 1) < 1e-9 && hiP(d50) === 0 && hiP(dOpen) > 0.05,
    `Salamence 5 lead: level 50 never pairs it with a high-tier set; Open Level does (${(100 * hiP(dOpen)).toFixed(1)}% of pairs)`);
  let threw = false; try { N.teammateDist(prior, P["Tyranitar 5"].index); } catch { threw = true; }
  ok(threw && Math.abs(sum(N.teammateDist(prior, P["Tyranitar 5"].index, { open: true })) - 1) < 1e-9, "Tyranitar 5 can lead only at Open Level");
  const ni50 = N.makeNextIn({ lead: "Salamence 5", challenge: 8, battle: 1 }), ni100 = N.makeNextIn({ lead: "Salamence 5", challenge: 8, battle: 1, level: 100 });
  ok(!("level" in ni50.spec) && ni100.spec.level === 100, "spec: level left out at 50 (unchanged), carried at Open Level");
  ok(JSON.stringify(N.makeNextIn(ni100.spec, ni100.exportCache()).dist) === JSON.stringify(ni100.dist), "Open Level spec + warm cache rebuild the same teammate odds (as the workers do)");
  let bad = 0; for (const lv of [49, 51, 59, 101, 70.5]) { try { N.makeNextIn({ lead: "Salamence 5", challenge: 8, battle: 1, level: lv }); } catch { bad++; } }
  ok(bad === 5, "level must be 50 or 60-100");
  const dn = P["Dragonite 5"];
  const b100 = N.buildReplacement(dn.index, 31, 100), direct = L.buildMon(getOpponentConfig("Dragonite 5", { level: 100, ivTier: 31, ability: dn.abilities[0] }));
  ok(b100[0].mon.level === 100 && JSON.stringify(b100[0].mon.stats) === JSON.stringify(direct.stats) && N.buildReplacement(dn.index, 31)[0].mon.level === 50,
    `Dragonite 5 as a level-100 replacement: stats as built directly (HP ${direct.stats.hp}); the default is still level 50`);
  const you = { types: ["Water"], ability: "Pressure" }, opp = { types: ["Fire"] };
  const r100 = ni100.replacements(you, opp), r50 = ni50.replacements(you, opp);
  ok(r100.some((r) => r.id > 849) && !r50.some((r) => r.id > 849), "Open Level replacements include high-tier sets; level 50 never");
}

console.log(`test-next-in: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
