// The cheap screen (sim/screen-core.mjs): repeatable, the same battles as the
// solver sim's draw, KO accounting, counters credited to the mon that acted
// (a Roar case), the type policy on hand-built positions, Destiny Bond and
// Choice Band counters.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const imp = (p) => import(pathToFileURL(path.join(here, p)).href);
const S = await imp("../sim/screen-core.mjs");
const D = await imp("../sim/draw.mjs");
const L = await imp("../engine/logic.js");
const Bt = await imp("../engine/battle.js");
const N = await imp("../engine/next-in.js");
const { getOpponentConfig } = await imp("../engine/opponent-adapter.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const read = (f) => fs.readFileSync(path.join(here, "..", f), "utf8");
const strip = ({ ms, ...rest }) => rest;

const swamp = S.makeScreen({ teamText: read("teams/user-test-team.txt"), seed: 1 });
const suic = S.makeScreen({ teamText: read("teams/mlsuicune.txt"), seed: 1 });

// ── repeatable, and the solver sim's battles ──
{
  const a = swamp.playBattle(7, "stay"), b = S.makeScreen({ teamText: read("teams/user-test-team.txt"), seed: 1 }).playBattle(7, "stay");
  ok(JSON.stringify(strip(a)) === JSON.stringify(strip(b)), "the same (seed, battle) plays the same battle");
  const d = D.makeDraw(1).drawBattle(D.FIRST_LATE + 7);
  ok(a.n === 57 && a.keys.join() === d.keys.join() && a.abilities.join() === d.abilities.join() && a.iv === d.iv, `battle 7 = battle n 57, the draw's party (${a.keys.join("/")})`);
}

// ── KO accounting: a win credits exactly 3 KOs, a loss fewer (battle 38: a
// Golem's Explosion fells both mons -- its own faint must still count) ──
{
  let good = true, wins = 0, losses = 0, koNull = true;
  for (let i = 0; i < 150; i++) {
    for (const [sc, pol] of [[swamp, "stay"], [suic, "type"]]) {
      const l = sc.playBattle(i, pol);
      const kos = l.c.reduce((a, x) => a + x.kos, 0);
      if (l.result === "win") { wins++; if (kos !== 3) good = false; } else { losses++; if (kos > 2) good = false; }
      if (l.c.some((x) => (x.kos === 0) !== (x.boostAtFirstKO === null))) koNull = false;
    }
  }
  ok(good && wins > 0 && losses > 0, `300 battles: every win credits 3 KOs, every loss at most 2 (${wins} wins, ${losses} losses)`);
  ok(koNull, "boostAtFirstKO is null exactly when the mon scored no KO");
}

// ── credit goes to the mon that acted: battle 659, Suicune's Toxic then Roar ──
{
  let sawRoar = false;
  const l = suic.playBattle(659, "stay", { log: (e) => { if (e.turn === 11 && e.chose?.you === "Toxic" && e.chose?.opp === "Roar" && e.after.youActive !== e.before.youActive) sawRoar = true; } });
  ok(sawRoar, "battle 659 turn 11: Suicune's Toxic, then a Roar drags Latios in");
  ok(l.c[2].status.some((e) => e.status === "poison") && l.c[1].status.length === 0, `the poisoning is Suicune's, not Latios' (${JSON.stringify(l.c.map((x) => x.status))})`);
}

// ── the type policy ──
{
  const keys = ["Arcanine 1", "Snorlax 1", "Electrode 1"];
  const B = { team: swamp.team, oppTeam: keys.map((k) => L.buildFrontierOpponent(getOpponentConfig(k, { ability: N.poolEntry(N.setId(k)).abilities[0], ivTier: 31, allowUnreachableTier: true }))) };
  B.oppIds = keys.map(N.setId);
  const s = Bt.battleStart(B, 0); // Metagross vs Arcanine
  ok(S.threat(B.oppTeam[0], B.team[0]) >= 2 && JSON.stringify(S.POLICIES.type(B, s)) === JSON.stringify({ switchTo: 2 }), "Metagross vs a Fire-type: switch to Swampert");
  const noSwamp = { ...s, youBench: s.youBench.map((e, i) => (i === 2 ? { ...e, hpPct: 0 } : e)) };
  ok(S.POLICIES.type(B, noSwamp) === "stay" || S.threat(B.oppTeam[0], B.team[1]) < S.threat(B.oppTeam[0], B.team[0]), "...with Swampert down, only a mon facing less is taken");
  const B2 = { ...B, oppTeam: [B.oppTeam[1], B.oppTeam[0], B.oppTeam[2]] };
  ok(S.POLICIES.type(B2, Bt.battleStart(B2, 0)) === "stay", "Metagross vs Snorlax (no super-effective threat): stay");
  ok(S.POLICIES.stay(B, s) === "stay", "the stay policy never switches");
  ok(S.effOf("Ground", { types: ["Dragon", "Psychic"], ability: "Levitate" }) === 0 && S.effOf("Fire", { types: ["Steel", "Psychic"], ability: "Clear Body" }) === 2
    && S.effOf("Electric", { types: ["Water", "Ground"], ability: "Torrent" }) === 0 && S.effOf("Ice", { types: ["Dragon", "Flying"], ability: "Intimidate" }) === 4,
    "effectiveness: Levitate, Fire on Steel/Psychic, Electric on Ground, Ice on Dragon/Flying");
}

// ── Destiny Bond and Choice Band counters ──
{
  const dbTeam = `Gengar @ Leftovers
Ability: Levitate
Level: 50
EVs: 252 SpA / 252 Spe
Brave Nature
- Destiny Bond
- Thunderbolt
- Ice Punch
- Psychic

Metagross @ Choice Band
Ability: Clear Body
Level: 50
EVs: 252 Atk / 252 Spe
Adamant Nature
- Meteor Mash
- Earthquake
- Shadow Ball
- Aerial Ace

Swampert @ Leftovers
Ability: Torrent
Level: 50
EVs: 252 HP / 252 SpD
Brave Nature
- Earthquake
- Rock Slide
- Curse
- Rest`;
  const sc = S.makeScreen({ teamText: dbTeam, seed: 3 });
  let used = 0, kos = 0, lockBad = 0, lockFaint = 0, metaFaints = 0, dbOk = true, skipped = 0, noChoiceOk = true;
  for (let i = 0; i < 200; i++) {
    let dbKoTurns = 0, l;
    // (a battle whose Metronome calls an unported move throws by name -- Clefable 1,
    // the only late-pool set that can; the screen CLI records it as an error)
    try { l = sc.playBattle(i, "stay", { log: (e) => {
      const oppFell = e.outcome === "win" || (e.after.oppActive === e.before.oppActive ? e.after.oppHpPct <= 0 : e.after.oppBench[e.before.oppActive]?.hpPct <= 0);
      if (e.before.youActive === 0 && e.after.yourHpPct <= 0 && e.after.youActive === 0 && oppFell
        && (e.chose?.you === "Destiny Bond" || e.before.youDestinyBondActive)) dbKoTurns++;
      if (e.before.youActive === 1 && e.after.youActive === 1 && e.after.yourHpPct <= 0) metaFaints++;
    } }); } catch (err) { if (!/no execution logic|no secondary executor/.test(err.message)) throw err; skipped++; continue; }
    const trick = l.keys.some((k) => N.poolEntry(N.setId(k)).moves.includes("Trick")); // a Trick can hand them a Choice Band (battle 10: MR_MIME 3)
    if (!trick && (l.c[0].faintedLocked || l.c[2].faintedLocked || l.c[0].lockedBadTurns || l.c[2].lockedBadTurns)) noChoiceOk = false;
    used += l.c[0].dbUsed; kos += l.c[0].dbKOs; lockBad += l.c[1].lockedBadTurns; lockFaint += l.c[1].faintedLocked;
    if (l.c[0].dbKOs !== dbKoTurns || l.c[0].dbKOs > 1) dbOk = false;
  }
  ok(used > 0 && kos > 0 && dbOk, `Brave Gengar: Destiny Bond picked ${used} times, ${kos} KOs, each matching a turn it fell with the bond up (${skipped} battles skipped: unported Metronome call)`);
  ok(noChoiceOk, "Gengar and Swampert (no Choice item) never count as Choice-locked, unless an opponent could Trick one onto them");
  ok(skipped <= 2, "at most 2 of 200 battles hit an unported Metronome call");
  ok(lockBad > 0 && lockFaint > 0 && lockFaint <= metaFaints, `CB Metagross: ${lockBad} turns locked into a resist; ${lockFaint} faints while locked (of ${metaFaints} faints)`);
}

console.log(`test-screen: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
