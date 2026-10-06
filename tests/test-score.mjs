// Phase C step 1: the team score (engine/score.js) and the Showdown team
// reader (engine/showdown.js), on the user's test team (teams/user-test-team.txt).
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const T = await import(E("team.js"));
const S = await import(E("score.js"));
const SD = await import(E("showdown.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const throws = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };

// ── the team reader ────────────────────────────────────────────────────────
const text = fs.readFileSync(path.join(here, "../teams/user-test-team.txt"), "utf8");
const cfgs = SD.parseShowdownTeam(text);
const team = SD.buildTeam(text);
const [meta, latios, swampert] = team;
{
  // "Hidden Power [Type]" (Gen 3: the type comes from the IVs)
  const reg = (ivs) => `Registeel @ Leftovers
Ability: Clear Body
Level: 50
EVs: 252 HP / 252 Atk
Brave Nature
${ivs}- Hidden Power [Steel]
- Rest
- Amnesia
- Curse`;
  const entered = SD.buildTeam(reg(""))[0];
  ok(entered.moves[0] === "Hidden Power" && entered.hiddenPower.type === "Steel" && entered.hiddenPower.power === 70, "Hidden Power [Steel] with no IVs: entered as Steel 70");
  const fromIvs = SD.buildTeam(reg("IVs: 30 SpD\n"))[0];
  ok(fromIvs.hiddenPower.type === "Steel" && fromIvs.hiddenPower.power === 70, "...with IVs 30 SpD (the rest 31): those IVs give Steel 70 (Cmd_hiddenpowercalc)");
  let threw = null; try { SD.buildTeam(reg("IVs: 30 Atk\n")); } catch (e) { threw = e.message; }
  // IVs 30 Atk: typeBits 61 -> 15*61/63 = 14, +1 = 15, past TYPE_MYSTERY -> 16 = Dragon
  ok(/give Hidden Power Dragon 70, not Steel/.test(threw ?? ""), `...IVs that give another type are refused (${threw})`);
}
{
  ok(team.map((m) => m.species).join() === "Metagross,Latios,Swampert", "three mons, in order");
  ok(meta.item === "Choice Band" && latios.item === "Lum Berry" && swampert.item === "Leftovers", "items");
  ok(cfgs[1].ivs.atk === 0 && cfgs[1].ivs.spd === 27 && cfgs[0].ivs.atk === undefined, "IVs given / defaulted to 31");
  ok(cfgs[2].evs.spd === 236, '"SpDef" read as Sp. Def');
  // Stats by hand (Gen 3 formula, lv50): Metagross 80/135/130/95/90/70, Sassy +SpD -Spe
  //   HP  (160+31+9)/2 +60 = 160;  Spe ((140+31+55)/2 +5) * 0.9 = 106;  Atk (270+31+63)/2 +5 = 187
  ok(JSON.stringify(meta.stats) === '{"hp":160,"atk":187,"def":150,"spa":115,"spd":121,"spe":106}', `Metagross stats ${JSON.stringify(meta.stats)}`);
  // Latios 80/90/80/110/130/110, Hasty +Spe -Def, IVs 30/0/29/31/27/30
  //   HP (160+30+10)/2+60 = 160; Atk (180+0)/2+5 = 95; Def ((160+29+17)/2+5)*0.9 = 97; Spe ((220+30+56)/2+5)*1.1 = 173
  ok(latios.stats.hp === 160 && latios.stats.atk === 95 && latios.stats.def === 97 && latios.stats.spe === 173, `Latios stats ${JSON.stringify(latios.stats)}`);
  // Swampert 100/110/90/85/90/60, Brave +Atk -Spe: HP (200+31+63)/2+60 = 207; SpD (180+31+59)/2+5 = 140
  ok(swampert.stats.hp === 207 && swampert.stats.spd === 140, `Swampert stats ${JSON.stringify(swampert.stats)}`);
  ok(meta.maxPP.join() === "16,16,24,32", "max PP Ups (Meteor Mash 10 -> 16, Aerial Ace 20 -> 32)");
  ok(throws(() => SD.parseShowdownTeam("Metagross\nAbility: Clear Body\nAdamant Nature\nShiny: Yes\n- Earthquake"), /cannot read line "Shiny: Yes"/), "an unknown line throws by name");
  // Showdown's spellings of Gen 3 moves read as the engine's (Gen 3) names.
  const mv = (n) => SD.parseShowdownTeam(`Snorlax\nAbility: Thick Fat\nHardy Nature\n- ${n}`)[0].moves[0];
  ok(mv("Thunder Punch") === "ThunderPunch" && mv("Extreme Speed") === "ExtremeSpeed" && mv("Soft-Boiled") === "Softboiled"
    && mv("Feint Attack") === "Faint Attack" && mv("High Jump Kick") === "Hi Jump Kick" && mv("Vise Grip") === "Vice Grip"
    && mv("Smelling Salts") === "SmellingSalt" && mv("Lock-On") === "Lock On" && mv("Double-Edge") === "Double-Edge", "Showdown move spellings -> Gen 3 names");
  ok(throws(() => SD.buildTeam("Snorlax\nAbility: Thick Fat\nHardy Nature\n- U-turn"), /no base PP for "U-turn"/), "a move Gen 3 does not have still throws by name");
  ok(throws(() => SD.parseShowdownTeam("Metagross\nAbility: Clear Body\nEVs: 252 Atak\nAdamant Nature\n- Earthquake"), /cannot read "252 Atak"/), "an unknown stat throws");
  ok(throws(() => SD.parseShowdownTeam("Meta (Metagross)\nAbility: Clear Body\nAdamant Nature\n- Earthquake"), /nicknames/), "nicknames are refused, not misread");
}

// ── the score, on hand-built positions ─────────────────────────────────────
const opp = L.buildMon({ species: "Salamence", level: 50, nature: "Adamant", moves: ["Dragon Claw", "Earthquake", "Rock Slide", "Dragon Dance"],
  ability: "Intimidate", item: null, ivs: {}, evs: { atk: 252, spe: 252 }, friendship: 255 });
const tctx = { team, opp };
const W = S.DEFAULT_WEIGHTS;
const D = 3 * (W.alive + W.hp); // 3.75: an untouched team's raw sum
const start = T.teamStart(tctx, 0);
const sc = (s, o = null, w) => S.scoreState(tctx, s, o, w).score;
{
  ok(near(sc(start), 1), "an untouched team scores 1.0");
  ok(sc(start, "lose") === 0, "lose scores 0");
  ok(near(sc({ ...start, yourHpPct: 60 }), (D - 0.4) / D), "the active mon at 60% loses 0.40 of 3.75");
  // 60% Metagross = 96/160 HP: not <= 80, so no low-HP latch. 50% = 80: the latch holds.
  ok(near(sc({ ...start, yourHpPct: 50 }), (D - 0.5 - W.lowHp) / D), "at half HP the Palace low-HP check costs lowHp too");
  const bench = (i, e) => ({ ...start, youBench: start.youBench.map((x, k) => (k === i ? { ...x, ...e } : x)) });
  ok(near(sc(bench(1, { hpPct: 0, status: "burn" })), (D - 1.25) / D), "a fainted bench mon scores 0 (its status is moot)");
  ok(near(sc(bench(2, { hpPct: 0 }), "win"), (D - 1.25) / D), "a win is the team's score (koBonus 0 by default)");
  ok(near(sc(bench(2, { hpPct: 0 }), "oppLeft"), sc(bench(2, { hpPct: 0 }), "win")), "oppLeft is neutral: same as win with no KO bonus");
  ok(near(sc(start, "win", { koBonus: 0.3 }) - sc(start, "oppLeft", { koBonus: 0.3 }), 0.3 / D), "koBonus counts only on a win");
  for (const [st, pen] of [["poison", 0.10], ["burn", 0.15], ["paralysis", 0.20], ["sleep", 0.30], ["freeze", 0.40]]) {
    ok(near(sc(bench(1, { status: st })), (D - pen) / D), `bench ${st}: -${pen}`);
  }
  ok(near(sc(bench(1, { status: "poison", toxic: true })), (D - 0.15) / D), "bench Toxic: -0.15, apart from regular poison");
  ok(near(sc({ ...start, youStatus: "poison", youToxicCounter: 2 }), (D - 0.15) / D), "active Toxic is read off the counter");
  // Rest: full HP but asleep -- the sleep penalty only; asleep is not "low HP"
  ok(near(sc({ ...start, yourHpPct: 30, youStatus: "sleep", youSleepTurns: 2 }), (D - 0.7 - 0.3) / D), "asleep at 30%: no low-HP penalty (the latch skips sleepers)");
  ok(near(sc({ ...start, youStages: { ...start.youStages, atk: 2, spe: 1 } }), (D + 0.15) / D), "+2 Atk +1 Spe on the active mon: +0.15");
  ok(near(sc({ ...start, youStages: { ...start.youStages, def: -1 } }), (D - 0.05) / D), "a drop costs the same per stage");
  ok(near(sc({ ...bench(1, { hpPct: 40 }), youStages: { ...start.youStages, atk: 2 } }), (D - 0.6 + 0.1) / D), "boosts count on the active mon only");
  ok(near(sc({ ...start, oppSpikesLayers: 2 }), (D + 0.10) / D), "Spikes x2 on their side: +0.10");
  ok(near(sc({ ...start, youReflectTurns: 3, youLightScreenTurns: 1 }), (D + 0.04) / D), "screens: +0.01 per turn left");
  ok(near(sc({ ...start, youBerryConsumed: true, youItemOverride: null }), (D - 0.05) / D), "an item used up: -0.05");
  ok(near(sc(bench(1, { berryConsumed: true })), (D - 0.05) / D), "Latios's Lum Berry used: -0.05");
  ok(near(sc({ ...start, youPartyPP: [8, 16, 24, 32] }), (D - 0.10 * 8 / 88) / D), "8 of 88 PP spent: -0.10 * 8/88");
  ok(near(sc({ ...start, youConfused: true, youPerishCount: 2 }), (D - 0.35) / D), "confused + Perish count on the active mon: -0.05 -0.30");
  ok(near(sc({ ...start, youSeeded: true, youCursed: true }), (D - 0.15) / D), "Leech Seed + Curse: -0.05 -0.10");
  ok(near(sc({ ...start, youConfused: true, youPerishCount: 2 }, null, { carry: { ...W.carry, confused: 0, perish: 0 } }), 1), "...and their weights can be turned off");
  ok(near(sc({ ...bench(1, { hpPct: 50 }), youConfused: true, youStages: { ...start.youStages, atk: 1 }, oppSpikesLayers: 0 }), (D - 0.5 - 0.05 + 0.05) / D), "carry-over is read off the active mon only");
  // Unequal weights: Metagross counts double. An untouched team is still 1.0.
  const mw = { monWeights: [2, 1, 1] };
  ok(near(sc(start, null, mw), 1), "monWeights: an untouched team is still 1.0");
  ok(near(sc({ ...start, yourHpPct: 60 }, null, mw), (5 - 0.8) / 5), "monWeights [2,1,1]: Metagross's lost 40% counts double");
  ok(throws(() => sc(start, null, { monWeights: [1, 1] }), /monWeights has 2/), "a wrong-length monWeights throws");
  // The breakdown names what it scored.
  const b = S.scoreState(tctx, { ...start, yourHpPct: 50, oppSpikesLayers: 1 }, "win");
  ok(b.mons[0].active && b.mons[0].parts.lowHp === -W.lowHp && b.field.spikes === 0.05 && b.mons[1].value === 1.25, "the breakdown has the per-mon parts and field");
}

// ── on real engine turns ───────────────────────────────────────────────────
{
  const rs = T.teamTurn(tctx, start, "stay");
  const ex = S.expectedScore(tctx, rs);
  ok(near(ex.pKO + ex.pOppLeft + ex.pLose + ex.pOpen, 1), "the outcome chances sum to 1");
  ok(ex.score < 1 && ex.score > 0.5, `after one Metagross/Salamence turn: expected score ${ex.score.toFixed(4)}, P(KO) ${ex.pKO.toFixed(4)}`);
  // Only a boost can lift a position above an untouched team: here Meteor Mash's
  // 20% +1 Atk (+0.05) outweighs its 1 PP (-0.10/88).
  const above = rs.filter((r) => S.scoreState(tctx, r.state, r.outcome).score > 1 + 1e-12);
  ok(above.length > 0 && above.every((r) => r.state.youStages.atk === 1), "only the Meteor Mash +1 Atk outcomes score above 1.0");
  const spent = rs.filter((r) => r.state.youPartyPP.reduce((a, b) => a + b, 0) < 88);
  ok(spent.length > 0 && spent.every((r) => S.scoreState(tctx, r.state, r.outcome).mons[0].ppSpent > 0), "a move used shows up as PP spent");
  ok(throws(() => S.expectedScore(tctx, rs.slice(1)), /sum to/), "a partial distribution is refused");
}

console.log(`test-score: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
