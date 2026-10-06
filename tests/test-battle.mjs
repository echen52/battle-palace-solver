// A whole battle (engine/battle.js): the opponent's three as a real team --
// its switch-ins (team.js switchIn on the mirrored position), the Intimidate /
// Trace record quirk, Spikes on its side, what its leaving mon keeps, Roar on
// it mid-turn, its replacement after a faint (GetMostSuitableMonToSwitchInto,
// against your mon out at the time), the order when both faint, the draw rule,
// and full random battles that add up.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const T = await import(E("team.js"));
const Bt = await import(E("battle.js"));
const N = await import(E("next-in.js"));
const SD = await import(E("showdown.js"));
const MC = await import(E("montecarlo.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const mons = (txt) => SD.parseShowdownTeam(txt).map((c) => T.buildPlayerMon(c));
const opp = (key, ability) => L.buildFrontierOpponent(getOpponentConfig(key, { ability, allowUnreachableTier: true }));
const ME = mons(`Swampert @ Leftovers
Ability: Torrent
Level: 50
EVs: 252 HP / 252 Def
Relaxed Nature
- Earthquake
- Surf
- Roar
- Rest

Sceptile @ Lum Berry
Ability: Overgrow
Level: 50
EVs: 252 SpA / 252 Spe
Timid Nature
- Leaf Blade
- Giga Drain
- Thunderpunch
- Earthquake

Metagross @ Choice Band
Ability: Clear Body
Level: 50
EVs: 252 Atk / 252 HP
Adamant Nature
- Meteor Mash
- Earthquake
- Shadow Ball
- Aerial Ace`);
const SILVER = N.BRAIN_TEAMS["Spenser Silver"];
const spenser = () => ({ team: ME, oppTeam: SILVER.map((k) => opp(k, k.includes("Lapras") ? "Water Absorb" : null)), oppIds: SILVER.map(N.setId) });

// ── the start ──────────────────────────────────────────────────────────────
{
  const B = spenser(), s = Bt.battleStart(B, 0);
  ok(s.oppActive === 0 && s.oppBench[0] === null && s.oppBench[1].hpPct === 100 && s.oppBench[2].partyPP.join() === B.oppTeam[2].maxPP.join()
    && s.oppUsablePartyMons === 2 && s.youActive === 0, "start: their slot 0 out, two fresh behind (their PP: no PP Ups)");
}

// ── their switch-in: entry effects, the record quirk, what the leaver keeps ─
{
  // Salamence 1 (Intimidate) coming in after a faint, your Swampert out.
  const B = { team: ME, oppTeam: [opp("Snorlax 1", "Thick Fat"), opp("Salamence 1", "Intimidate"), opp("Starmie 1", "Natural Cure")], oppIds: ["Snorlax 1", "Salamence 1", "Starmie 1"].map(N.setId) };
  const s0 = { ...Bt.battleStart(B, 0), oppHpPct: 0, oppStatus: null, youAbilityRecord: null, oppAbilityRecord: "Thick Fat" };
  const s1 = Bt.oppSwitchIn(B, s0, 1, { firstTurn: true });
  ok(s1.oppActive === 1 && s1.oppBench[0].hpPct === 0 && s1.oppBench[1] === null && s1.oppHpPct === 100 && s1.oppMonFirstTurn === true, "their slot 1 in, the fainted lead on the bench at 0");
  ok(s1.youStages.atk === -1 && s1.youAbilityRecord === "Intimidate", "Intimidate drops your Attack, and records onto YOU (battler 0 quirk)");
  ok(s1.oppAbilityRecord === null, "their newcomer's own record starts empty (ClearBattlerAbilityHistory)");
  // vs Clear Body: blocked, and the script records the target's ability
  const sM = Bt.oppSwitchIn({ ...B }, { ...Bt.battleStart(B, 2), oppHpPct: 0 }, 1, { firstTurn: true });
  ok(sM.youStages.atk === 0 && sM.youAbilityRecord === "Clear Body", "vs Clear Body: no drop; Clear Body recorded on your side");
  // Spikes on their side: 2 layers = maxHP / 6
  const sp = Bt.oppSwitchIn(B, { ...s0, oppSpikesLayers: 2 }, 2, { firstTurn: true });
  const mx = B.oppTeam[2].stats.hp;
  ok(near(sp.oppHpPct, ((mx - Math.floor(mx / 6)) * 100) / mx), `Spikes x2 on their newcomer: ${mx} - ${Math.floor(mx / 6)}`);
  ok(Bt.oppSwitchIn(B, { ...s0, oppSpikesLayers: 3 }, 1, { firstTurn: true }).oppHpPct === 100, "a Flying newcomer ignores Spikes");
  // A mid-turn leaver keeps HP / status / PP; what pointed at it is cleared;
  // Natural Cure cures on the way out.
  const live = { ...Bt.battleStart(B, 0), oppHpPct: 40, oppStatus: "burn", oppPP: B.oppTeam[0].maxPP.map((p, i) => (i === 0 ? p - 3 : p)), oppPartyPP: B.oppTeam[0].maxPP.map((p, i) => (i === 0 ? p - 3 : p)), oppStages: { ...Bt.battleStart(B, 0).oppStages, atk: 2 }, youAttracted: true };
  const out = Bt.oppSwitchIn(B, live, 2, { firstTurn: 2 });
  ok(out.oppBench[0].hpPct === 40 && out.oppBench[0].status === "burn" && out.oppBench[0].partyPP[0] === B.oppTeam[0].maxPP[0] - 3, "the leaver keeps HP, burn, PP spent (the party copy, which ppreduce writes too)");
  ok(out.oppStages.atk === 0 && out.youAttracted === false && out.oppMonFirstTurn === 2, "the newcomer's stages are fresh; your infatuation with the leaver ends");
  const cure = Bt.oppSwitchIn(B, { ...Bt.oppSwitchIn(B, { ...s0, oppHpPct: 0 }, 2, { firstTurn: true }), oppStatus: "paralysis", oppHpPct: 70 }, 1, { firstTurn: 2 });
  ok(cure.oppBench[2].status === null && cure.oppBench[2].hpPct === 70, "Natural Cure (Starmie) leaves cured");
}

// ── Roar on them, mid-turn ─────────────────────────────────────────────────
{
  const B = { team: ME, oppTeam: [opp("Snorlax 1", "Thick Fat"), opp("Salamence 1", "Intimidate"), opp("Starmie 1", "Natural Cure")], oppIds: ["Snorlax 1", "Salamence 1", "Starmie 1"].map(N.setId) };
  const s = Bt.battleStart(B, 0);
  const ctx = T.engineCtx(Bt.view(B, s), s);
  const res = L.resolveTurn(ctx, s, "Roar", B.oppTeam[0].moves[0], { order: ["opp", "you"] });
  const tot = res.reduce((a, r) => a + r.p, 0);
  const by = {}; for (const r of res) by[r.state.oppActive] = (by[r.state.oppActive] ?? 0) + r.p;
  ok(near(tot, 1) && near(by[1] ?? 0, 0.5 * (by[1] + by[2])) && near(by[2] ?? 0, 0.5 * (by[1] + by[2])) && (by[1] + by[2]) > 0.5,
    `your Roar drags in either teammate evenly (slot 1 ${(by[1] ?? 0).toFixed(3)}, slot 2 ${(by[2] ?? 0).toFixed(3)}; rest = Roar failed / missed)`);
  ok(res.every((r) => r.state.oppDraggedOut === false), "the flag is cleared once the newcomer is in");
  ok(res.filter((r) => r.state.oppActive !== 0).every((r) => r.state.oppMonFirstTurn === true), "a mon dragged in mid-turn: its NEXT turn is its first (Fake Out works then)");
}

// ── their replacement after a faint ────────────────────────────────────────
{
  const B = spenser();
  // Crobat down. Your Swampert out -> Slaking (damage fallback); your Sceptile out -> Lapras (typing: Ice Beam).
  const down = (lead) => ({ ...Bt.battleStart(B, lead), oppHpPct: 0 });
  ok(Bt.oppReplacementSlot(B, down(0)) === 1 && Bt.oppReplacementSlot(B, down(1)) === 2, "vs Swampert: Slaking; vs Sceptile: Lapras");
  // Both fall: yours is replaced first, and they pick against the newcomer.
  const both = { ...down(0), yourHpPct: 0 };
  const after = Bt.replaceYours(B, both, 1);
  ok(after.youActive === 1 && after.oppActive === 2, "both fainted: you send Sceptile first, then they pick Lapras against it");
  // The draw: both last mons down -> a loss for the streak.
  const last = { ...Bt.battleStart(B, 0), yourHpPct: 0, oppHpPct: 0,
    youBench: [null, { ...Bt.battleStart(B, 0).youBench[1], hpPct: 0 }, { ...Bt.battleStart(B, 0).youBench[2], hpPct: 0 }],
    oppBench: [null, { ...Bt.battleStart(B, 0).oppBench[1], hpPct: 0 }, { ...Bt.battleStart(B, 0).oppBench[2], hpPct: 0 }] };
  ok(Bt.settle(B, last).outcome === "lose", "both last mons down: a draw, which ends the streak like a loss");
  const theirLast = { ...last, youBench: Bt.battleStart(B, 0).youBench };
  ok(Bt.settle(B, theirLast).outcome === "win", "their last down, yours down with teammates left: a win");
  const yoursOnly = { ...last, oppHpPct: 50 };
  ok(Bt.settle(B, yoursOnly).outcome === "lose", "your last down, theirs standing: a loss");
}

// ── whole battles, outcomes drawn ──────────────────────────────────────────
{
  const B = { ...spenser(), rollSample: MC.rng(3) };
  const rand = MC.rng(11);
  const pickW = (xs) => { let u = rand(); for (const x of xs) { u -= x.p; if (u <= 0) return x; } return xs[xs.length - 1]; };
  let sums = true, done = 0, faints = 0;
  for (let g = 0; g < 12; g++) {
    let s = Bt.battleStart(B, g % 3), end = null;
    for (let t = 0; t < 300 && !end; t++) {
      const rs = Bt.battleTurn(B, s, "stay");
      if (!near(rs.reduce((a, r) => a + r.p, 0), 1, 1e-6)) sums = false;
      const r = pickW(rs); s = r.state;
      if (r.outcome === "replace") { faints++; s = Bt.replaceYours(B, s, T.aliveBench(s)[0]); } else if (r.outcome) end = r.outcome;
    }
    if (end) done++;
  }
  ok(sums && done === 12, `12 battles vs Spenser Silver play to the end, each turn's outcomes summing to 1 (${faints} of your faints replaced)`);
}

console.log(`test-battle: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
