// The opponent's voluntary switch (engine/should-switch.js, the port of
// ShouldSwitch) on hand-worked cases, one per reason, with the odds worked out
// from the source's Random() tests; the gates; gLastLandedMoves as the engine
// now tracks it; and the turn where it switches (engine/battle.js).
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const T = await import(E("team.js"));
const Bt = await import(E("battle.js"));
const N = await import(E("next-in.js"));
const SS = await import(E("should-switch.js"));
const SD = await import(E("showdown.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b, e = 1e-12) => Math.abs(a - b) <= e;

const mons = (txt) => SD.parseShowdownTeam(txt).map((c) => T.buildPlayerMon(c));
const opp = (key) => { const e = N.poolEntry(N.setId(key)); return L.buildFrontierOpponent(getOpponentConfig(key, { ability: e.abilities[0], allowUnreachableTier: true })); };
const battle = (team, keys) => ({ team, oppTeam: keys.map(opp), oppIds: keys.map(N.setId) });
const odds = (B, s) => Object.fromEntries(SS.oppSwitchOdds(B, s).map((o) => [String(o.slot), o.p]));
const show = (o) => Object.entries(o).map(([k, p]) => `${k}:${p.toFixed(4)}`).join(" ");

const META = mons(`Metagross @ Choice Band
Ability: Clear Body
Level: 50
EVs: 252 Atk / 252 HP
Adamant Nature
- Meteor Mash
- Earthquake
- Shadow Ball
- Aerial Ace`);
const SUI = mons(`Suicune @ Lum Berry
Ability: Pressure
Level: 50
EVs: 252 HP / 252 Def
Modest Nature
- Surf
- Rest
- Calm Mind
- Toxic`);
const SHED = mons(`Shedinja @ Lum Berry
Ability: Wonder Guard
Level: 50
Adamant Nature
- Shadow Ball
- Aerial Ace`);

// ── AI_TypeCalc ────────────────────────────────────────────────────────────
{
  const F = N.AI_FLAG, f = N.aiTypeCalc;
  ok((f("Return", "Dusclops", "Pressure") & F.DOESNT_AFFECT) && (f("Brick Break", "Gengar", "Levitate") & F.DOESNT_AFFECT),
    "Normal / Fighting into a Ghost: doesn't affect (the rows after the Foresight marker always apply)");
  ok(f("Earthquake", "Gengar", "Levitate") === (F.MISSED | F.DOESNT_AFFECT), "Ground into Levitate: missed + doesn't affect");
  ok(f("Earthquake", "Metagross", "Clear Body") === F.SE && f("Surf", "Vaporeon", "Water Absorb") === F.NVE, "plain super effective / not very effective");
  ok(f("Earthquake", "Shedinja", "Wonder Guard") === (F.NVE | F.DOESNT_AFFECT) && f("Aerial Ace", "Shedinja", "Wonder Guard") === F.SE,
    "Wonder Guard: a non-super-effective damaging move gets doesn't-affect; a super-effective one passes");
  ok(f("Toxic", "Metagross", "Clear Body") === F.DOESNT_AFFECT && f("Struggle", "Gengar", "Levitate") === 0, "a status move only carries immunity; Struggle is 0");
}

// ── 7. the last landed move: a teammate it would not affect / resist ──────
{
  // Magikarp out (Flail: no super-effective move on Metagross); Pidgeot 1 is
  // immune to Earthquake and has Mud-Slap (super effective); Feebas has neither.
  const B = battle(META, ["Magikarp 1", "Pidgeot 1", "Feebas 1"]);
  const s = { ...Bt.battleStart(B, 0), oppLastLanded: "Earthquake" };
  const o = odds(B, s);
  ok(near(o["1"], 1 / 2) && near(o["null"], 1 / 2), `your Earthquake landed: to Pidgeot 1/2 (FindMonWithFlagsAndSuperEffective(DOESNT_AFFECT, 2)) -- ${show(o)}`);
  ok(near(odds(B, { ...s, oppLastLanded: null })["null"], 1), "nothing landed on it: it stays");
  ok(near(odds(B, { ...s, oppLastLanded: "Meteor Mash" })["null"], 1), "Meteor Mash landed: only Feebas resists it, and Feebas has no super-effective move -> stays");
  // AreStatsRaised: +4 in total keeps it in
  ok(near(odds(B, { ...s, oppStages: { ...s.oppStages, atk: 2, spe: 2 } })["null"], 1) && near(odds(B, { ...s, oppStages: { ...s.oppStages, atk: 2, spe: 1 } })["1"], 1 / 2),
    "more than 3 stages up keeps it in (+4 yes, +3 no)");
  // HasSuperEffectiveMoveAgainstOpponents: one SE move keeps it 9 in 10 first
  const B2 = battle(META, ["Pidgeot 2", "Pidgeot 1", "Feebas 1"]); // Pidgeot 2 has Mud-Slap too (and is itself immune -- irrelevant to its own stay)
  const s2 = { ...Bt.battleStart(B2, 0), oppLastLanded: "Earthquake" };
  const o2 = odds(B2, s2);
  ok(near(o2["1"], (1 / 10) * (1 / 2)), `with its own super-effective move: 1/10 x 1/2 = 0.05 -- ${show(o2)}`);
}

// ── the gates ──────────────────────────────────────────────────────────────
{
  const B = battle(META, ["Magikarp 1", "Pidgeot 1", "Feebas 1"]);
  const s = { ...Bt.battleStart(B, 0), oppLastLanded: "Earthquake" };
  const stays = (st, m) => ok(near(odds(B, st)["null"], 1), m);
  const trapped = { ...s }; L.setVf(trapped, "oppCantEscape", true);
  stays(trapped, "trapped (Mean Look): no switch");
  stays({ ...s, oppIngrained: true }, "Ingrained: no switch");
  stays({ ...s, oppWrapped: { turns: 2 } }, "wrapped: no switch");
  stays({ ...s, oppRecharge: true }, "recharging: no action chosen at all");
  stays({ ...s, oppLock: { kind: "rampage", turns: 1 } }, "locked into a rampage: no action chosen");
  stays({ ...s, oppBench: [null, { ...s.oppBench[1], hpPct: 0 }, { ...s.oppBench[2], hpPct: 0 }] }, "no healthy teammate: no switch");
}

// ── 1. Perish Song at 0 ────────────────────────────────────────────────────
{
  const B = battle(META, ["Magikarp 1", "Pidgeot 1", "Feebas 1"]);
  const s = { ...Bt.battleStart(B, 0), oppPerishCount: 0 }; L.setVf(s, "oppPerishSonged", true);
  const o = odds(B, s);
  const slot = Object.keys(o).filter((k) => k !== "null");
  ok(slot.length === 1 && near(o[slot[0]], 1), `perish count 0: it switches for certain, to GetMostSuitable's pick (slot ${slot[0]})`);
}

// ── 2. Wonder Guard ────────────────────────────────────────────────────────
{
  // Your Shedinja; Magikarp has nothing super effective; Pidgeot 1 has two
  // (Aerial Ace, Faint Attack): 2/3, then 2/3 of the rest.
  const B = battle(SHED, ["Magikarp 1", "Pidgeot 1", "Feebas 1"]);
  const o = odds(B, Bt.battleStart(B, 0));
  ok(near(o["1"], 2 / 3 + (1 / 3) * (2 / 3)) && near(o["null"], 1 / 9), `vs Wonder Guard: to Pidgeot 8/9 -- ${show(o)}`);
  // its own mon out has a super-effective move (Pidgeot 2: Aerial Ace): no Wonder Guard switch
  const BW = battle(SHED, ["Pidgeot 2", "Pidgeot 1", "Feebas 1"]);
  ok(near(odds(BW, Bt.battleStart(BW, 0))["null"], 1), "vs Wonder Guard with a super-effective move of its own: it stays");
}

// ── 3. a teammate that absorbs the last landed move ───────────────────────
{
  // Your Surf landed on Magikarp; Vaporeon (Water Absorb) behind: 1/2.
  const B = battle(SUI, ["Magikarp 1", "Vaporeon 1", "Feebas 1"]);
  const s = { ...Bt.battleStart(B, 0), oppLastLanded: "Surf" };
  const o = odds(B, s);
  const vapSE = B.oppTeam[1].moves.some((m) => N.aiTypeCalc(m, "Suicune", "Pressure") & 2);
  ok(near(o["1"], 1 / 2) && !vapSE, `your Surf landed: to Vaporeon 1/2 (Random() & 1); its later checks add nothing (no super-effective move) -- ${show(o)}`);
  ok(near(odds(B, { ...s, oppLastLanded: "Toxic" })["null"], 1), "a status move landed (power 0): no absorber check");
}

// ── 4. Natural Cure while asleep ───────────────────────────────────────────
{
  const B = battle(META, ["Altaria 1", "Magikarp 1", "Feebas 1"]);
  const s = { ...Bt.battleStart(B, 0), oppStatus: "sleep", oppSleepTurns: 2, oppLastLanded: null };
  const o = odds(B, s);
  const sw = 1 - (o["null"] ?? 0);
  // nothing landed: 1/2, else (power 0) 1/2, flags (nothing landed) none, else 1/2 -> 7/8
  ok(near(sw, 7 / 8), `asleep with Natural Cure, nothing landed: switches 7/8 -- ${show(o)}`);
  ok(near(1 - (odds(B, { ...s, oppLastLanded: "Toxic" })["null"] ?? 0), 1 - (1 / 2) * (1 / 2)), "a status move landed: 1/2, then 1/2 -> 3/4");
  const low = odds(B, { ...s, oppHpPct: 40 });
  ok(near(low["null"], 1), `below half HP: the Natural Cure reason is off (${show(low)})`);
}

// ── gLastLandedMoves, as the engine tracks it ──────────────────────────────
{
  const B = battle(META, ["Snorlax 1", "Baltoy 1", "Skarmory 1"]);
  const s = Bt.battleStart(B, 0);
  const ctx = T.engineCtx(Bt.view(B, s), s);
  const oppMove = B.oppTeam[0].moves[0];
  const second = L.resolveTurn(ctx, s, "Earthquake", oppMove, { order: ["opp", "you"] }).filter((r) => r.state.oppHpPct > 0);
  ok(second.length > 0 && second.every((r) => r.state.oppLastLanded === "Earthquake" && r.state.youLastLanded === null),
    "you move second and Earthquake lands: it is their last landed move");
  const first = L.resolveTurn(ctx, s, "Earthquake", oppMove, { order: ["you", "opp"] }).filter((r) => r.state.oppHpPct > 0);
  ok(first.every((r) => r.state.oppLastLanded === null), "you move first: their own action clears it (HandleAction_ActionFinished)");
  // Levitate: no effect -> unavailable
  const sB = Bt.oppSwitchIn(B, s, 1, { firstTurn: true });
  const ctxB = T.engineCtx(Bt.view(B, sB), sB);
  const lev = L.resolveTurn(ctxB, sB, "Earthquake", B.oppTeam[1].moves[0], { order: ["opp", "you"] });
  ok(lev.every((r) => r.state.oppLastLanded === null), "Earthquake into Levitate: not landed");
  // a move aimed at yourself leaves the foe's entry alone
  const sd = L.resolveSingleAction(ctx, { ...s, oppLastLanded: "Surf" }, "you", "Swords Dance", {});
  ok(sd.every((r) => r.state.oppLastLanded === "Surf"), "Swords Dance (aimed at the user) does not touch their entry");
  // a failed status move: Toxic into Skarmory (Steel)
  const sS = Bt.oppSwitchIn(B, s, 2, { firstTurn: true });
  const ctxS = T.engineCtx(Bt.view(B, sS), sS);
  const tox = L.resolveSingleAction(ctxS, sS, "you", "Toxic", {});
  ok(tox.every((r) => r.state.oppLastLanded === null), "Toxic into a Steel type fails: not landed");
  const BK = battle(META, ["Magikarp 1", "Baltoy 1", "Skarmory 1"]), sK = Bt.battleStart(BK, 0);
  const toxN = L.resolveSingleAction(T.engineCtx(Bt.view(BK, sK), sK), sK, "you", "Toxic", {});
  ok(toxN.some((r) => r.state.oppStatus === "poison" && r.state.oppLastLanded === "Toxic") && toxN.every((r) => (r.state.oppStatus === "poison") === (r.state.oppLastLanded === "Toxic")),
    "Toxic into Magikarp: landed exactly when it poisons (Snorlax 1 would be Immunity)");
  ok(Bt.oppSwitchIn(B, { ...s, oppLastLanded: "Surf" }, 1, { firstTurn: 2 }).oppLastLanded === null, "a switch-in clears it");
}

// ── the turn it switches ───────────────────────────────────────────────────
{
  const B = battle(META, ["Magikarp 1", "Pidgeot 1", "Feebas 1"]);
  const s = { ...Bt.battleStart(B, 0), oppPerishCount: 0 }; L.setVf(s, "oppPerishSonged", true);
  const to = Number(Object.keys(odds(B, s)).find((k) => k !== "null"));
  const res = Bt.battleTurn(B, s, "stay");
  // (when your hit knocks the newcomer out, their pick after the faint comes in instead)
  const hpOf = (st, i) => (st.oppActive === i ? st.oppHpPct : st.oppBench[i].hpPct);
  ok(near(res.reduce((a, r) => a + r.p, 0), 1) && res.every((r) => r.state.oppActive === to || hpOf(r.state, to) <= 0), `perish 0: slot ${to} comes in (or has fainted to your hit)`);
  ok(res.every((r) => hpOf(r.state, 0) === 100), "the leaver goes untouched (you have no Pursuit)");
  const hit = res.filter((r) => hpOf(r.state, to) < 100).reduce((a, r) => a + r.p, 0);
  // Shadow Ball and Earthquake cannot touch Pidgeot (Normal/Flying); Meteor
  // Mash hits 85/100, Aerial Ace always -- your Palace odds, chosen against Magikarp.
  const P = await import(E("palace.js"));
  const ch = P.palaceChoices(T.engineCtx(Bt.view(B, s), s), s, "you").filter((c) => !c.loaf);
  const want = ch.filter((c) => c.move === "Meteor Mash").reduce((a, c) => a + c.p, 0) * 0.85 + ch.filter((c) => c.move === "Aerial Ace").reduce((a, c) => a + c.p, 0);
  ok(near(hit, want, 1e-9), `your move lands on the newcomer: P(hurt) ${hit.toFixed(4)} = P(Meteor Mash) x 0.85 + P(Aerial Ace) = ${want.toFixed(4)}`);
  // you switch the same turn: yours first, then theirs, no moves
  const both = Bt.battleTurn({ ...B, team: [...META, ...SUI] }, { ...s, youBench: [null, T.freshEntry(SUI[0])] }, { switchTo: 1 });
  ok(both.every((r) => r.state.youActive === 1 && r.state.oppActive === to && r.state.oppHpPct === 100), "both switch: both newcomers in, untouched");
}

console.log(`test-should-switch: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
