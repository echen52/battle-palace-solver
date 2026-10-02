// PP and the mechanics that hang on it, and the durations the Arena engine had
// capped at its 3-turn horizon -- each against its pokeemerald anchor.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const L = await import(pathToFileURL(path.join(here, "../engine/logic.js")).href);
const P = await import(pathToFileURL(path.join(here, "../engine/palace.js")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b) => Math.abs(a - b) < 1e-12;
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mk = (species, nature, moves, ability, extra = {}) =>
  L.buildMon({ species, level: 50, nature, moves, ability, item: null, ivs: IV, evs: {}, friendship: 255, ...extra });
const pOf = (res, f) => res.filter((r) => f(r.state)).reduce((a, r) => a + r.p, 0);
const all = (res, f) => res.length > 0 && res.every((r) => f(r.state));
const turn = (ctx, s, a, b, opts) => L.resolveTurn({ ...ctx, noLabels: true }, s, a, b, opts);

// ── max PP and the start state ─────────────────────────────────────────────
{
  const m = mk("Snorlax", "Adamant", ["Body Slam", "Curse", "Rest", "Fire Blast"], "Thick Fat", { ppUps: [3, 0, 1, 3] });
  ok(JSON.stringify(m.maxPP) === "[24,10,12,8]", `CalculatePPWithBonus: [24,10,12,8], got ${m.maxPP}`);
  const opp = mk("Slowbro", "Relaxed", ["Splash"], "Oblivious");
  const s = L.buildStartState({ you: m, opp });
  ok(s.youPP.join() === "24,10,12,8" && s.youPartyPP.join() === "24,10,12,8" && s.oppPP.join() === "40", "start state carries battle and party PP");
}

// ── spending ───────────────────────────────────────────────────────────────
const snorlax = mk("Snorlax", "Adamant", ["Body Slam", "Swords Dance", "Counter", "Thrash"], "Thick Fat");
const slowbro = mk("Slowbro", "Relaxed", ["Splash"], "Oblivious");
const zapdos = mk("Zapdos", "Timid", ["Splash"], "Pressure");
{
  const ctx = { you: snorlax, opp: slowbro };
  const s = L.buildStartState({ you: snorlax, opp: slowbro });
  ok(all(turn(ctx, s, "Body Slam", "Splash"), (x) => x.youPP[0] === 14 && x.youPartyPP[0] === 14), "a used move spends 1 (battle and party)");
  const ctxZ = { you: snorlax, opp: zapdos };
  const sZ = L.buildStartState({ you: snorlax, opp: zapdos });
  ok(all(turn(ctxZ, sZ, "Body Slam", "Splash"), (x) => x.youPP[0] === 13), "into Pressure: 2 (Cmd_ppreduce default case)");
  ok(all(turn(ctxZ, sZ, "Swords Dance", "Splash"), (x) => x.youPP[1] === 29), "a MOVE_TARGET_USER move ignores Pressure");
  ok(all(turn(ctxZ, sZ, "Counter", "Splash"), (x) => x.youPP[2] === 19), "Counter ignores Pressure (ppNotAffectedByPressure)");
  // a miss still pays: Zap Cannon's 50% miss branch
  const zc = mk("Snorlax", "Adamant", ["Zap Cannon"], "Thick Fat");
  const r = turn({ you: zc, opp: slowbro }, L.buildStartState({ you: zc, opp: slowbro }), "Zap Cannon", "Splash");
  ok(r.some((b) => b.state.oppHpPct === 100) && all(r, (x) => x.youPP[0] === 4), "a miss spends PP (BattleScript_PrintMoveMissed)");
  // the canceler stops it: asleep, no Sleep Talk -> nothing spent
  const asleep = { ...s, youStatus: "sleep", youSleepTurns: 3 };
  ok(all(turn(ctx, asleep, "Body Slam", "Splash"), (x) => x.youPP[0] === 15), "an action the canceler stops spends nothing");
  // a lock's continuation turn spends nothing
  const locked = { ...s, youLock: { move: "Thrash", kind: "rampage", n: 2 }, youPP: [15, 30, 20, 19] };
  ok(all(turn(ctx, locked, "Thrash", "Splash"), (x) => x.youPP[3] === 19), "Thrash's continuation turn spends nothing");
  ok(all(turn(ctx, s, "Thrash", "Splash"), (x) => x.youPP[3] === 19), "Thrash's first turn spends 1");
  // Struggle spends nothing
  const out = { ...s, youPP: [0, 0, 0, 0] };
  ok(all(turn(ctx, out, "Struggle", "Splash"), (x) => x.youPP.join() === "0,0,0,0"), "Struggle spends nothing");
}
// Sleep Talk pays for itself only
{
  const st = mk("Snorlax", "Adamant", ["Sleep Talk", "Body Slam"], "Thick Fat");
  const s = { ...L.buildStartState({ you: st, opp: slowbro }), youStatus: "sleep", youSleepTurns: 3 };
  ok(all(turn({ you: st, opp: slowbro }, s, "Sleep Talk", "Splash"), (x) => x.youPP[0] === 9 && x.youPP[1] === 15), "Sleep Talk spends its own PP, not the called move's");
}

// ── running out ────────────────────────────────────────────────────────────
{
  const ctx = { you: snorlax, opp: slowbro };
  const s = { ...L.buildStartState({ you: snorlax, opp: slowbro }), youPP: [0, 30, 20, 20] };
  const legal = L.selectableMoves(snorlax.moves, s, "you", slowbro, "you");
  ok(!legal.includes("Body Slam") && legal.length === 3, "a 0-PP move is not selectable (CheckMoveLimitations)");
  const none = { ...s, youPP: [0, 0, 0, 0] };
  const ch = P.palaceChoices(ctx, { ...none, youPalaceLowHp: false, oppPalaceLowHp: false }, "you");
  ok(ch.length === 1 && ch[0].move === "Struggle", "nothing usable: Struggle, no Palace roll (AreAllMovesUnusable)");
  // the chosen slot emptied between selection and the action: it fails
  const r = turn(ctx, s, "Body Slam", "Splash");
  ok(all(r, (x) => x.oppHpPct === 100 && x.youLastMove === null), "a move with no PP left fails (BattleScript_NoPPForMove)");
  // the Palace mask drops 0-PP slots: Adamant's Attack roll with Body Slam and Thrash empty falls back
  const atkOut = { ...L.buildStartState({ you: snorlax, opp: slowbro }), youPP: [0, 30, 20, 0], youPalaceLowHp: false, oppPalaceLowHp: false };
  const c2 = P.palaceChoices(ctx, atkOut, "you").filter((c) => c.group === P.ATTACK);
  ok(c2.length > 0 && c2.every((c) => !c.aiRan) && c2.every((c) => c.loaf || !["Body Slam", "Thrash"].includes(c.move)),
    "an Attack roll with every Attack move at 0 PP falls back (selectedMoves needs PP)");
  // the AI skips a 0-PP slot even inside the rolled group
  const one = { ...L.buildStartState({ you: snorlax, opp: slowbro }), youPP: [0, 30, 20, 20], youPalaceLowHp: false, oppPalaceLowHp: false };
  const c3 = P.palaceChoices(ctx, one, "you").filter((c) => c.group === P.ATTACK);
  ok(c3.every((c) => c.move !== "Body Slam") && near(c3.reduce((a, c) => a + c.p, 0), P.decodeNatureRow("Adamant", false)[P.ATTACK]),
    "the AI never picks a 0-PP slot in the group");
}

// ── Leppa Berry ────────────────────────────────────────────────────────────
{
  const lep = mk("Snorlax", "Adamant", ["Body Slam", "Fire Blast"], "Thick Fat", { item: "Leppa Berry" });
  const s = { ...L.buildStartState({ you: lep, opp: slowbro }), youPP: [15, 1], youPartyPP: [15, 1] };
  const r = turn({ you: lep, opp: slowbro }, s, "Fire Blast", "Splash");
  ok(all(r, (x) => x.youPP[1] === 5 && x.youPartyPP[1] === 5 && x.youBerryConsumed), "Leppa: an emptied slot gets 10, capped at max (5), berry used");
}

// ── Spite ──────────────────────────────────────────────────────────────────
{
  const sp = mk("Misdreavus", "Timid", ["Spite"], "Levitate");
  const foe = mk("Snorlax", "Adamant", ["Body Slam", "Thrash"], "Thick Fat");
  const s = { ...L.buildStartState({ you: sp, opp: foe }), oppLastMove: "Body Slam", oppPP: [10, 20], oppPartyPP: [10, 20] };
  const r = turn({ you: sp, opp: foe }, s, "Spite", "Body Slam");
  const left = (k) => pOf(r, (x) => x.oppPP[0] === k);
  // Snorlax acts after Spite here? Misdreavus is faster: Spite then Body Slam (another -1).
  ok(near(left(7) + left(6) + left(5) + left(4), 1) && near(left(7), 0.25) && near(left(4), 0.25), "Spite: 2-5 PP, 1/4 each (then the Body Slam's own 1)");
  const low = { ...s, oppPP: [3, 20] };
  const r2 = turn({ you: sp, opp: foe }, low, "Spite", "Thrash");
  ok(near(pOf(r2, (x) => x.oppPP[0] === 1), 0.25) && near(pOf(r2, (x) => x.oppPP[0] === 0), 0.75), "Spite is capped at the PP left");
  const one = { ...s, oppPP: [1, 20] };
  ok(all(turn({ you: sp, opp: foe }, one, "Spite", "Thrash"), (x) => x.oppPP[0] === 1), "Spite fails on a move with 1 PP");
}

// ── Grudge ─────────────────────────────────────────────────────────────────
{
  const gr = mk("Banette", "Adamant", ["Grudge"], "Insomnia");
  const foe = mk("Tyranitar", "Adamant", ["Crunch"], "Sand Stream");
  const s = { ...L.buildStartState({ you: gr, opp: foe }), youGrudge: true, yourHpPct: (1 / gr.stats.hp) * 100, weatherType: null };
  const r = turn({ you: gr, opp: foe }, s, "Grudge", "Crunch");
  const ko = r.filter((b) => b.state.yourHpPct <= 0);
  ok(ko.length > 0 && ko.every((b) => b.state.oppPP[0] === 0), "Grudge: the move that KOs the grudger loses all its PP");
}

// ── Transform / Mimic ──────────────────────────────────────────────────────
{
  const ditto = mk("Ditto", "Timid", ["Transform"], "Limber");
  const foe = mk("Snorlax", "Adamant", ["Body Slam", "Fire Blast"], "Thick Fat");
  const r = turn({ you: ditto, opp: foe }, L.buildStartState({ you: ditto, opp: foe }), "Transform", "Body Slam");
  ok(all(r, (x) => x.youPP.join() === "5,5" && x.youPartyPP.join() === "9"), "Transform: every slot min(5, base); party keeps Transform's own PP (10 - 1)");
}

// ── durations with no 3-turn cap ───────────────────────────────────────────
{
  const dis = mk("Gengar", "Timid", ["Disable"], "Levitate");
  const foe = mk("Snorlax", "Adamant", ["Body Slam"], "Thick Fat");
  const s = { ...L.buildStartState({ you: dis, opp: foe }), oppLastMove: "Body Slam", turn: 2 };
  const r = turn({ you: dis, opp: foe }, s, "Disable", "Body Slam");
  const t = (k) => pOf(r, (x) => x.oppDisableTurns === k - 1 || x.oppDisableTurns === k);
  const hit = r.filter((b) => b.state.oppDisabledMove === "Body Slam");
  const timers = new Set(hit.map((b) => b.state.oppDisableTurns));
  ok(timers.size === 4, `Disable: four timer draws on turn 2, no 3-turn cap (got ${[...timers]})`);
  void t;
  const enc = mk("Clefable", "Bold", ["Encore"], "Cute Charm");
  const s2 = { ...L.buildStartState({ you: enc, opp: foe }), oppLastMove: "Body Slam" };
  const timers2 = new Set(turn({ you: enc, opp: foe }, s2, "Encore", "Body Slam").filter((b) => b.state.oppEncoredMove).map((b) => b.state.oppEncoreTurns));
  ok(timers2.size === 4, `Encore: four timer draws (3..6, ticked once) (got ${[...timers2]})`);
  const s3 = { ...L.buildStartState({ you: enc, opp: foe }), oppEncoredMove: "Body Slam", oppEncoreTurns: 4, oppPP: [1] };
  ok(all(turn({ you: enc, opp: foe }, s3, "Encore", "Body Slam"), (x) => x.oppEncoredMove === null), "Encore ends when the encored move runs out of PP");
  const yawner = mk("Slowbro", "Relaxed", ["Yawn"], "Oblivious");
  const s4 = { ...L.buildStartState({ you: yawner, opp: foe }), oppYawnTurns: 1 };
  const sl = new Set(turn({ you: yawner, opp: foe }, s4, "Yawn", "Body Slam").filter((b) => b.state.oppStatus === "sleep").map((b) => b.state.oppSleepTurns));
  ok(sl.size === 4, `Yawn: the sleep draws 2..5 (got ${[...sl]})`);
}

// ── Perish Song ────────────────────────────────────────────────────────────
{
  const ps = mk("Lapras", "Modest", ["Perish Song", "Splash"], "Water Absorb");
  const foe = mk("Snorlax", "Adamant", ["Splash"], "Thick Fat");
  const sp = mk("Exploud", "Modest", ["Splash"], "Soundproof");
  const ctx = { you: ps, opp: foe };
  let s = L.buildStartState({ you: ps, opp: foe });
  s = turn(ctx, s, "Perish Song", "Splash")[0].state;
  ok(s.youPerishCount === 2 && s.oppPerishCount === 2, "Perish Song: 3, ticked to 2 at the end of the turn of use");
  s = turn(ctx, s, "Splash", "Splash")[0].state;
  s = turn(ctx, s, "Splash", "Splash")[0].state;
  ok(s.youPerishCount === 0 && s.yourHpPct > 0, "two turns later: 0, still standing");
  s = turn(ctx, s, "Splash", "Splash")[0].state;
  ok(s.yourHpPct === 0 && s.oppHpPct === 0, "the fourth end-of-turn: both faint");
  const s2 = turn({ you: ps, opp: sp }, L.buildStartState({ you: ps, opp: sp }), "Perish Song", "Splash")[0].state;
  ok(s2.youPerishCount === 2 && s2.oppPerishCount === null, "Soundproof is exempt");
}

console.log(`${fail ? "FAIL" : "ok"}  pp: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
