// The page's form -> engine position (site/ui-logic.js buildFight), field by
// field, plus the set list, IV odds, sleep counters and the result rows.
// (The browser test compares the page with Node on the SAME buildFight, so a
// wrong mapping here would pass there -- this file is what pins the mapping.)
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const U = await import(pathToFileURL(path.join(here, "../site/ui-logic.js")).href);
const T = await import(pathToFileURL(path.join(here, "../engine/team.js")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const throws = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };

const cfgs = U.parseTeam(fs.readFileSync(path.join(here, "../teams/user-test-team.txt"), "utf8"));
const zero = Object.fromEntries(U.STAGE_KEYS.map((k) => [k, 0]));
const mon = (o = {}) => ({ hpPct: 100, status: "", toxicTurns: 1, sleep: { rest: false, slept: 0 }, itemGone: false, ...o });
const base = (o = {}) => ({
  team: cfgs, active: 0, mons: cfgs.map(() => mon()),
  you: { stages: zero, confused: 0, subPct: 0, lowHp: null },
  opp: { setKey: "Salamence 1", ability: null, ivTier: 12, hpPct: 100, status: "", toxicTurns: 1, sleep: { rest: false, slept: 0 }, itemGone: false, stages: zero, confused: 0, firstTurn: true, lowHp: null },
  field: { weather: "", weatherTurns: null, you: { spikes: 0 }, opp: { spikes: 0 } },
  run: { challenge: 3, battle: 7, oppIndex: 1 }, ...o,
});
const st = (form) => U.buildFight(form).start[0].state;

// ── the team and the opponent ──────────────────────────────────────────────
{
  ok(throws(() => U.parseTeam(""), /1-3/) && throws(() => U.parseTeam(Array(4).fill("Pikachu\nAbility: Static\nHardy Nature\n- Thunderbolt").join("\n\n")), /1-3/), "a team is 1-3 Pokémon");
  const f = U.buildFight(base());
  ok(f.labels.join() === "Stay in (Metagross),Switch to Latios,Switch to Swampert" && f.actions.length === 3, "levers and labels");
  // Salamence 1 at IV 12: built by the engine's own Frontier builder, so it
  // equals buildOpponent's direct output and differs from the 31-IV build.
  const o12 = U.buildOpponent({ setKey: "Salamence 1", ivTier: 12 }), o31 = U.buildOpponent({ setKey: "Salamence 1", ivTier: 31 });
  ok(f.tctx.opp.species === "Salamence" && f.tctx.opp.ability === "Intimidate" && JSON.stringify(f.tctx.opp.stats) === JSON.stringify(o12.stats)
    && o12.stats.hp < o31.stats.hp, `opponent built at the chosen IVs (HP ${o12.stats.hp} at 12, ${o31.stats.hp} at 31)`);
  ok(f.tctx.nextInSpec?.lead === "Salamence 1" && f.tctx.oppReserves === 2, "1st of 3: next-in from the lead, two in reserve");
  const f3 = U.buildFight(base({ run: { challenge: 3, battle: 7, oppIndex: 3 } }));
  ok(f3.tctx.nextInSpec === null && f3.tctx.oppReserves === 0 && /last Pokémon/.test(f3.notes.join()), "3rd of 3: no next-in, none in reserve");
  const f2 = U.buildFight(base({ opp: { ...base().opp, setKey: "Flygon 1", ability: "Levitate" }, run: { challenge: 3, battle: 7, oppIndex: 2, leadKey: "Salamence 1" } }));
  ok(f2.tctx.nextInSpec?.second === "Flygon 1" && f2.tctx.nextInSpec.lead === "Salamence 1" && f2.tctx.oppReserves === 1, "2nd of 3: next-in from lead + second, one in reserve");
  const fx = U.buildFight(base({ run: { challenge: 1, battle: 1, oppIndex: 1 } }));
  ok(fx.tctx.nextInSpec === null && /Not scoring their next/.test(fx.notes.join()), "a lead the bracket cannot have: no next-in, and a note says so");
  ok(throws(() => U.buildFight(base({ opp: { ...base().opp, setKey: "Gardevoir 1", ability: null } })), /pick one/), "two abilities and none picked: refused");
}

// ── each input lands on its engine field ───────────────────────────────────
{
  const s0 = st(base());
  ok(s0.youActive === 0 && s0.yourHpPct === 100 && s0.oppHpPct === 100 && s0.youStatus === null, "the plain start");
  ok(s0.youStages.atk === 0, "Clear Body blocks Salamence's Intimidate (switch-in stages kept when all stages are 0)");
  const sw = st(base({ active: 2 }));
  ok(sw.youActive === 2 && sw.youStages.atk === -1 && sw.youBench[0] && sw.youBench[2] === null, "Swampert out: Intimidate drops its Attack; the others are benched");
  const s1 = st(base({ mons: [mon({ hpPct: 40, status: "burn" }), mon({ hpPct: 55, status: "paralysis", itemGone: true }), mon({ status: "toxic" })] }));
  ok(s1.yourHpPct === 40 && s1.youStatus === "burn", "active HP and status");
  ok(s1.youBench[1].hpPct === 55 && s1.youBench[1].status === "paralysis" && s1.youBench[1].itemOverride === null && s1.youBench[1].berryConsumed, "bench HP, status, item used up");
  ok(s1.youBench[2].status === "poison" && s1.youBench[2].toxic === true, "bench bad poison = poison + the toxic flag");
  const s2 = st(base({ mons: [mon({ status: "toxic", toxicTurns: 3 }), mon(), mon()], opp: { ...base().opp, status: "toxic", toxicTurns: 2 } }));
  ok(s2.youStatus === "poison" && s2.youToxicCounter === 3 && s2.oppToxicCounter === 2, "active bad poison carries its counter");
  const s3 = st(base({ you: { stages: { ...zero, atk: 2, spe: -1 }, confused: 3, subPct: 25, lowHp: null }, opp: { ...base().opp, stages: { ...zero, def: 1 }, confused: 1 } }));
  ok(s3.youStages.atk === 2 && s3.youStages.spe === -1 && s3.oppStages.def === 1, "entered stages replace the switch-in ones");
  ok(s3.youConfused === 3 && s3.oppConfused === true, "confusion: the next-check index, true for 'no turns yet'");
  ok(s3.youSubstituteHP === Math.round(0.25 * 160), "Substitute 25% of Metagross's 160 HP = 40");
  const s4 = st(base({ mons: [mon({ itemGone: true }), mon(), mon()], opp: { ...base().opp, itemGone: true, firstTurn: false } }));
  ok(s4.youItemOverride === null && s4.oppItemOverride === null && s4.oppMonFirstTurn === false, "items used up; not its first turn");
  const s5 = st(base({ field: { weather: "rain", weatherTurns: 3, you: { reflect: true, reflectTurns: 2, spikes: 1 }, opp: { lightScreen: true, spikes: 3 } } }));
  ok(s5.weatherType === "rain" && s5.weatherTurns === 3, "weather and its turns");
  ok(s5.youReflectTurns === 2 && s5.youLightScreenTurns === null && s5.oppLightScreenTurns === 5 && s5.oppReflectTurns === null, "screens with their turns (5 by default)");
  ok(s5.youSpikesLayers === 1 && s5.oppSpikesLayers === 3, "Spikes per side");
  ok(st(base({ field: { weather: "sandstorm", weatherTurns: null, you: {}, opp: {} } })).weatherTurns === null, "weather from an ability never ends");
  // The Palace low-HP latch: auto from HP (half or less, not asleep), or set by hand.
  ok(st(base({ mons: [mon({ hpPct: 50 }), mon(), mon()] })).youPalaceLowHp === true && st(base({ mons: [mon({ hpPct: 51 }), mon(), mon()] })).youPalaceLowHp === false, "auto latch: 80/160 yes, 82/160 no");
  ok(st(base({ mons: [mon({ hpPct: 30, status: "sleep" }), mon(), mon()] })).youPalaceLowHp === false, "auto latch: a sleeping mon is not latched");
  ok(st(base({ you: { stages: zero, confused: 0, subPct: 0, lowHp: true } })).youPalaceLowHp === true && st(base({ opp: { ...base().opp, hpPct: 20, lowHp: false } })).oppPalaceLowHp === false, "the latch set by hand wins");
}

// ── sleep ──────────────────────────────────────────────────────────────────
{
  const meta = T.buildPlayerMon(cfgs[0]);
  ok(U.sleepCounters({ slept: 0 }, meta).join() === "2,3,4,5" && U.sleepCounters({ slept: 2 }, meta).join() === "1,2,3" && U.sleepCounters({ rest: true, slept: 2 }, meta).join() === "1", "counters still possible");
  ok(U.sleepCounters({ slept: 5 }, meta).join() === "1" && U.sleepCounters({ slept: 1 }, { ability: "Early Bird" }).join() === "1,2,3", "none fits -> wakes next; Early Bird counts twice");
  const f = U.buildFight(base({ mons: [mon({ status: "sleep", sleep: { rest: false, slept: 1 } }), mon({ status: "sleep", sleep: { rest: true, slept: 0 } }), mon()],
    opp: { ...base().opp, status: "sleep", sleep: { rest: false, slept: 3 } } }));
  // you 1,2,3,4 (4) x bench Latios Rest 3 (1) x opp 1,2 (2) = 8
  ok(f.start.length === 8 && Math.abs(f.start.reduce((a, v) => a + v.p, 0) - 1) < 1e-12, `sleep mix: 4 x 1 x 2 = ${f.start.length} start positions, weights sum to 1`);
  ok(new Set(f.start.map((v) => `${v.state.youSleepTurns}|${v.state.oppSleepTurns}`)).size === 8 && f.start.every((v) => v.state.youBench[1].sleepTurns === 3), "every combination once; the benched Rest sleeper's counter is 3");
}

// ── the Frontier Brain ─────────────────────────────────────────────────────
{
  ok(U.brainFor({ challenge: 3, battle: 7 }) === "Spenser Silver" && U.brainFor({ challenge: 6, battle: 7 }) === "Spenser Gold"
    && U.brainFor({ challenge: 3, battle: 6 }) === null && U.brainFor({ challenge: 8, battle: 7 }) === null && U.brainFor({ challenge: 1, battle: 7 }) === null,
    "Spenser at streak 21 and 42 (challenge 3 and 6, battle 7); 8+ left to you");
  ok(U.setChoices({ challenge: 3, battle: 7, brain: "Spenser Silver" }).join() === "Spenser Silver Crobat,Spenser Silver Slaking,Spenser Silver Lapras", "his list: his three, lead first");
  ok(JSON.stringify(U.ivTierOdds("Spenser Gold Suicune", { challenge: 6, battle: 7 })) === '[{"iv":31,"p":1}]', "his IVs: fixed");
  const sp = (key, idx, brain = "Spenser Silver", ability = null) => base({ opp: { ...base().opp, setKey: key, ability, ivTier: 16 }, run: { challenge: 3, battle: 7, oppIndex: idx, brain } });
  const f1 = U.buildFight(sp("Spenser Silver Crobat", 1));
  ok(f1.tctx.opp.species === "Crobat" && f1.tctx.opp.stats.hp === 172 && f1.tctx.nextInSpec.brain === "Spenser Silver" && f1.tctx.nextInSpec.lead === "Spenser Silver Crobat"
    && f1.tctx.nextInSpec.second === null && f1.tctx.oppReserves === 2 && f1.notes.length === 0, "vs his lead: Crobat at IV 16 (HP 172), next-in from his team, two in reserve");
  const f2 = U.buildFight(sp("Spenser Silver Lapras", 2, "Spenser Silver", "Water Absorb"));
  ok(f2.tctx.nextInSpec.second === "Spenser Silver Lapras" && f2.tctx.nextInSpec.lead === "Spenser Silver Crobat" && f2.tctx.oppReserves === 1, "vs his 2nd: lead filled in from his team");
  ok(U.buildFight(sp("Spenser Silver Slaking", 3)).tctx.nextInSpec === null, "vs his 3rd: no next-in");
  ok(throws(() => U.buildFight(sp("Spenser Silver Slaking", 1)), /always sends out Crobat first/), "a non-lead as his 1st: refused");
  ok(throws(() => U.buildFight(sp("Spenser Silver Crobat", 2)), /Crobat is Spenser's first/), "his lead as 2nd: refused");
  ok(throws(() => U.buildFight(sp("Spenser Gold Suicune", 2)), /not on Spenser Silver's team/), "a Gold mon in a Silver battle: refused");
  ok(throws(() => U.buildFight(sp("Spenser Silver Crobat", 1, null)), /Frontier Brain set: pick the Brain battle/), "a Brain set with the Brain off: refused");
}

// ── lists and results ──────────────────────────────────────────────────────
{
  const all = U.setChoices({});
  ok(all.length === 850 && all.every((k) => !/^Spenser|^Anabel/.test(k)) && all.filter((k) => /MIME/.test(k)).length === 4, "all level-50 sets: 850, no Brains, Mr. Mime once each");
  ok(U.setLabel("MR_MIME 2") === "Mr. Mime 2" && U.setLabel("Salamence 1") === "Salamence 1", "set labels");
  const c1 = U.setChoices({ challenge: 1, battle: 1 });
  ok(c1.includes("Metapod 1") && !c1.includes("Salamence 1"), "challenge 1's list has the Bug Catchers' macro mons, not Salamence 1");
  const odds = U.ivTierOdds("Salamence 1", { challenge: 8, battle: 1 });
  ok(Math.abs(odds.reduce((a, o) => a + o.p, 0) - 1) < 1e-12 && odds[0].p >= odds[odds.length - 1].p, `IV odds sum to 1, most likely first (${odds.map((o) => `${o.iv}:${(100 * o.p).toFixed(0)}%`).join(" ")})`);
  const lev = (score, margin) => ({ score, margin, pKO: 1, pOppLeft: 0, pLose: 0, turns: 2, rollouts: 100, exactFirstTurn: true });
  const rows = U.resultRows([lev(0.80, 0.01), lev(0.85, 0.01), lev(0.70, 0.01)], ["a", "b", "c"]);
  ok(rows.map((r) => r.label).join() === "b,a,c" && rows[0].best && !rows[1].tie && U.verdict(rows, { done: true }) === "b", "best first, separated: the best is the verdict");
  const tied = U.resultRows([lev(0.80, 0.03), lev(0.82, 0.03)], ["a", "b"]);
  ok(tied[1].tie && /too close to call against a/.test(U.verdict(tied, { done: true })), "overlapping ranges: too close to call");
}

// ── 2026-10-07: the recommendation rule, gender, send-in mode ──────────────
{
  const lev = (score, margin) => ({ score, margin, pKO: 1, pOppLeft: 0, pLose: 0, turns: 2, rollouts: 100, exactFirstTurn: true });
  const A = ["stay", { switchTo: 1 }, { switchTo: 2 }], L3 = ["Stay in (M)", "Switch to L", "Switch to S"];
  // the Zapdos case: a switch ahead by less than the noise is held
  let rows = U.resultRows([lev(0.351, 0.052), lev(0.352, 0.031), lev(0.339, 0.05)], L3, A);
  let v = U.verdict(rows, { done: true });
  ok(rows.find((r) => r.pick).label === "Stay in (M)" && rows[0].label === "Switch to L" && v.startsWith("Stay in (M) -- switching isn't clearly better (Switch to L leads"), `held switch -> stay: "${v}"`);
  rows = U.resultRows([lev(0.36, 0.03), lev(0.35, 0.03), lev(0.2, 0.01)], L3, A);
  v = U.verdict(rows, { done: true });
  ok(rows.find((r) => r.pick).label === "Stay in (M)" && v === "Stay in (M) -- no switch is clearly better", `stay best, a switch within the noise: "${v}"`);
  rows = U.resultRows([lev(0.30, 0.01), lev(0.40, 0.01), lev(0.2, 0.01)], L3, A);
  ok(rows.find((r) => r.pick).label === "Switch to L" && U.verdict(rows, { done: true }) === "Switch to L", "a clearly better switch is the pick");
  rows = U.resultRows([lev(0.30, 0.01), lev(0.40, 0.03), lev(0.39, 0.03)], L3, A);
  ok(rows.find((r) => r.pick).label === "Switch to L" && U.verdict(rows, { done: true }).includes("too close to call against Switch to S"), "two switches tied, both clearly above stay: too close to call");
  ok(U.verdict(U.resultRows([lev(0.351, 0.052), lev(0.352, 0.031)], L3.slice(0, 2), A.slice(0, 2)), { done: false }).endsWith("(so far)"), "(so far) while solving");

  // gender: the opponent's as entered; a one-gender species ignores it
  const m7 = U.buildOpponent({ setKey: "Machamp 7", ivTier: 31 });
  ok(U.genderOf(m7) === null && U.genderOf(U.buildOpponent({ setKey: "Machamp 7", ivTier: 31, gender: "female" })) === "female", "Machamp: unknown unless set");
  ok(U.genderOf(U.buildOpponent({ setKey: "Gardevoir 8", ability: "Trace", ivTier: 31, gender: "male" })) === "male", "Gardevoir set to male");
  ok(U.genderOf(U.buildOpponent({ setKey: "Latios 1", ivTier: 31, gender: "female" })) === "male", "a one-gender species (Latios) ignores the setting");
  const blocks = (f) => fs.readFileSync(path.join(here, f), "utf8").split(/\r?\n\s*\r?\n/).filter((b) => b.trim());
  const latiosOnly = U.parseTeam(blocks("../teams/user-test-team.txt").find((b) => b.trim().startsWith("Latios")));
  const att = (gender) => U.buildFight(base({ team: latiosOnly, mons: [mon()], opp: { ...base().opp, setKey: "Machamp 7", ivTier: 31, gender }, run: { challenge: 8, battle: 1, oppIndex: 1 } }));
  ok(att(null).notes.some((n) => /Attract .*their Machamp/.test(n)), "Attract in play, their gender unknown: a note");
  ok(!att("female").notes.some((n) => /Attract/.test(n)) && att("female").tctx.opp.genderDist.length === 1, "gender set: no note, a fixed gender in the solve");
  ok(!U.buildFight(base()).notes.some((n) => /Attract/.test(n)), "no Attract or Cute Charm: no note");
  const landed = (g) => { const f = att(g); return T.teamTurn(f.tctx, f.start[0].state, "stay").filter((r) => r.chose.opp === "Attract" && r.state.youAttracted).reduce((a, r) => a + r.p, 0); };
  ok(landed("male") === 0 && landed("female") > 0, "a male Machamp's Attract never lands on Latios; a female's does");

  // send-in: candidates, fresh entry, Intimidate on top of the entered stages
  const ut = blocks("../teams/user-test-team.txt");
  const team3 = U.parseTeam([ut.find((b) => b.trim().startsWith("Metagross")), ut.find((b) => b.trim().startsWith("Latios")), blocks("../teams/cb/all-sets.txt").find((b) => b.trim().startsWith("Salamence"))].join("\n\n"));
  const form = base({ team: team3, mons: team3.map(() => mon()), active: 0, you: { stages: { ...zero, spe: 2 }, confused: 2, subPct: 20, lowHp: true },
    opp: { ...base().opp, setKey: "Machamp 5", ability: "Guts", ivTier: 31, stages: { ...zero, atk: 1 } }, run: { challenge: 8, battle: 1, oppIndex: 1 } });
  const cands = U.buildSendIn(form);
  ok(cands.map((c) => c.species).join() === "Latios,Salamence", "candidates: the healthy teammates, not the fainted mon");
  const sIn = (sp) => cands.find((c) => c.species === sp).fight.start[0].state;
  ok(sIn("Latios").youStages.spe === 0 && !sIn("Latios").youSubstituteHP && !sIn("Latios").youConfused, "sent in fresh: no stages, Substitute or confusion");
  ok(sIn("Latios").oppStages.atk === 1 && sIn("Salamence").oppStages.atk === 0, "Salamence's Intimidate lands on top of their +1 Atk (-> 0); Latios leaves it at +1");
  ok(sIn("Salamence").youBench[0].hpPct === 0, "the fainted mon is on the bench at 0 HP");
  ok(throws(() => U.buildSendIn({ ...form, mons: [mon(), mon({ hpPct: 0 }), mon({ hpPct: 0 })] }), /no healthy teammate/), "nobody left: an error");

  // the decision, with a stand-in solve that scores by species
  const nameOf = (fight) => fight.labels[0].slice("Stay in (".length, -1);
  const fake = (byName) => async (fight) => ({ levers: fight.actions.map((a, i) => lev(...(i === 0 ? byName[nameOf(fight)] : [0.1, 0.01]))) });
  let calls = 0; const counted = (f) => async (...a) => { calls++; return f(...a); };
  let d = await U.decideSendIn(cands, counted(fake({ Latios: [0.6, 0.01], Salamence: [0.5, 0.01] })), { budgetMs: 4000 });
  ok(d.j === cands[0].j && d.why === "clearly best" && calls === 2 && !d.tie, "clearly better: in after one solve each");
  calls = 0;
  d = await U.decideSendIn(cands, counted(fake({ Latios: [0.55, 0.03], Salamence: [0.56, 0.03] })), { budgetMs: 4000 });
  ok(calls === 4 && d.tie && d.tie.stats.length === 2 && d.why.includes("decided by"), `tied twice: solved again, then the first turn (${d.why})`);
  const x = d.tie.stats;
  ok(x.every((t) => t.pKO >= 0 && t.pKO <= 1 && t.dmg >= 0 && t.lost >= 0) && x.find((t) => t.j === 2).choice && !x.find((t) => t.j === 1).choice, "first-turn numbers are probabilities / shares; Salamence holds the Choice Band");
  d = await U.decideSendIn([cands[0]], fake({}), { budgetMs: 1000 });
  ok(d.j === cands[0].j && d.why === "the only one left", "one candidate: no solve");
}

console.log(`test-ui-logic: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
