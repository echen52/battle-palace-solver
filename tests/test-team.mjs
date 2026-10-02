// The team layer (engine/team.js): switching by choice, after a faint and by
// Roar; what a mon carries and what it leaves behind; the turn's outcomes.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const T = await import(E("team.js"));
const { mirrorState } = await import(E("mirror.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const P = (species, nature, moves, ability, extra = {}) =>
  T.buildPlayerMon({ species, level: 50, nature, moves, ability, item: null, ivs: IV, evs: {}, ...extra });
const O = (species, nature, moves, ability, extra = {}) =>
  L.buildMon({ species, level: 50, nature, moves, ability, item: null, ivs: IV, evs: {}, friendship: 255, ...extra });
const sum = (rs) => rs.reduce((a, r) => a + r.p, 0);
const pOf = (rs, f) => rs.filter(f).reduce((a, r) => a + r.p, 0);

const snorlax = P("Snorlax", "Adamant", ["Body Slam", "Curse", "Rest", "Fake Out"], "Thick Fat", { item: "Leftovers" });
const gyara = P("Gyarados", "Adamant", ["Hydro Pump", "Dragon Dance", "Earthquake", "Double-Edge"], "Intimidate");
const ttar = P("Tyranitar", "Adamant", ["Rock Slide", "Crunch", "Earthquake", "Dragon Dance"], "Sand Stream");
const starmie = P("Starmie", "Timid", ["Surf", "Psychic", "Recover", "Thunderbolt"], "Natural Cure");

// ── classification and the start ───────────────────────────────────────────
{
  const tctx = { team: [snorlax, gyara, ttar], opp: O("Slowbro", "Relaxed", ["Splash"], "Oblivious") };
  const s = T.teamStart(tctx, 0);
  const unclassified = Object.keys(s).filter((k) => T.classifyKey(k) === null);
  ok(unclassified.length === 0, `every state field is classified (${unclassified})`);
  ok(s.youPP.join() === "24,16,16,16", "your mons start with max PP Ups (Body Slam 24, Curse 16, Rest 16, Fake Out 16)");
  ok(s.oppPP.join() === "40", "the opponent has none (Splash 40)");
  ok(JSON.stringify(mirrorState(mirrorState(s))) === JSON.stringify(s), "a team position mirrors (team fields pair)");
}

// ── what a mon takes to the bench, and what it leaves ──────────────────────
{
  const foe = O("Slowbro", "Relaxed", ["Splash"], "Oblivious");
  const tctx = { team: [starmie, snorlax, ttar], opp: foe };
  let s = T.teamStart(tctx, 0);
  s = { ...s, yourHpPct: 60, youStatus: "paralysis", youStages: { ...s.youStages, spa: 2 }, youConfused: true,
    youSubstituteHP: 20, youPP: [10, 10, 10, 10], youPartyPP: [10, 10, 10, 10], oppAttracted: true, oppWrapped: { move: "Wrap", n: 3 } };
  s = T.switchIn(tctx, s, 1, { firstTurn: 2 });
  const e = s.youBench[0];
  ok(e.hpPct === 60 && e.status === null && e.partyPP.join() === "10,10,10,10", "Natural Cure clears status on the way out; HP and party PP are kept");
  ok(s.youStages.spa === 0 && !s.youConfused && s.youSubstituteHP == null, "stages, confusion and Substitute stay behind");
  ok(!s.oppAttracted && s.oppWrapped == null, "the foe's infatuation with, and Wrap by, the leaver end");
  ok(s.youActive === 1 && s.youPP.join() === "24,16,16,16", "the newcomer brings its own PP");
  // back in: the carried data returns; the badly poisoned counter resets; sleep keeps its count
  let t = T.teamStart({ team: [snorlax, gyara, ttar], opp: foe }, 0);
  t = { ...t, youStatus: "poison", youToxicCounter: 5 };
  t = T.switchIn({ team: [snorlax, gyara, ttar], opp: foe }, t, 1, { firstTurn: 2 });
  t = T.switchIn({ team: [snorlax, gyara, ttar], opp: foe }, t, 0, { firstTurn: 2 });
  ok(t.youStatus === "poison" && t.youToxicCounter === 0, "Toxic stays, its counter restarts (battle-only data)");
  let u = T.teamStart({ team: [snorlax, gyara, ttar], opp: foe }, 0);
  u = T.switchIn({ team: [snorlax, gyara, ttar], opp: foe }, { ...u, youStatus: "sleep", youSleepTurns: 3 }, 1, { firstTurn: 2 });
  u = T.switchIn({ team: [snorlax, gyara, ttar], opp: foe }, u, 0, { firstTurn: 2 });
  ok(u.youStatus === "sleep" && u.youSleepTurns === 3, "sleep comes back with its counter (the canceler writes it to the party)");
}

// ── entry effects: Spikes, Intimidate, Sand Stream, Truant ─────────────────
{
  const foe = O("Slowbro", "Relaxed", ["Splash"], "Oblivious");
  const slaking = P("Slaking", "Adamant", ["Body Slam"], "Truant");
  const tctx = { team: [snorlax, gyara, ttar, slaking], opp: foe };
  for (const [layers, frac] of [[1, 8], [2, 6], [3, 4]]) {
    const s = T.switchIn(tctx, { ...T.teamStart(tctx, 0), youSpikesLayers: layers }, 2, { firstTurn: 2 });
    const hp = Math.round((s.yourHpPct / 100) * ttar.stats.hp);
    ok(hp === ttar.stats.hp - Math.floor(ttar.stats.hp / frac), `Spikes x${layers}: 1/${frac} of max HP`);
  }
  const fly = T.switchIn(tctx, { ...T.teamStart(tctx, 0), youSpikesLayers: 3 }, 1, { firstTurn: 2 });
  ok(fly.yourHpPct === 100 && fly.oppStages.atk === -1, "a Flying type skips Spikes; Intimidate drops the foe's Attack");
  const tt = T.switchIn(tctx, T.teamStart(tctx, 0), 2, { firstTurn: 2 });
  ok(tt.weatherType === "sandstorm" && tt.weatherTurns == null, "Sand Stream: permanent sandstorm");
  const cb = { team: [snorlax, gyara], opp: O("Metagross", "Adamant", ["Meteor Mash"], "Clear Body") };
  ok(T.switchIn(cb, T.teamStart(cb, 0), 1, { firstTurn: 2 }).oppStages.atk === 0, "Clear Body blocks the switch-in Intimidate");
  ok(L.vf(T.switchIn(tctx, T.teamStart(tctx, 0), 3, { firstTurn: 2 }), "youTruantLoaf"), "Truant: the counter is set on entry");
}

// ── a switch turn ──────────────────────────────────────────────────────────
{
  // the opponent's move -- chosen against the mon that was out -- hits the newcomer; switching beats priority
  const es = O("Arcanine", "Adamant", ["ExtremeSpeed"], "Intimidate", { evs: { atk: 252 } });
  const tctx = { team: [snorlax, gyara, ttar], opp: es };
  const res = T.teamTurn(tctx, T.teamStart(tctx, 0), { switchTo: 2 });
  // (an Arcanine with one move loafs on its empty-group rolls: those branches leave the newcomer alone)
  ok(near(sum(res), 1) && res.every((r) => r.state.youActive === 2 && r.state.youBench[0].hpPct === 100)
    && pOf(res, (r) => r.state.yourHpPct < 100) > 0.4,
    "switching goes before even ExtremeSpeed; the hit lands on the newcomer, the leaver is untouched");
  ok(res.every((r) => r.state.youMonFirstTurn === true), "the newcomer's next turn is its first (isFirstTurn 2 -> 1)");
  // Pursuit: doubled on the leaver, and it is the Pursuer's whole turn
  const purs = O("Tyranitar", "Adamant", ["Pursuit"], "Sand Stream", { evs: { atk: 252 } });
  const tp = { team: [starmie, snorlax, gyara], opp: purs };
  const sw = T.teamTurn(tp, T.teamStart(tp, 0), { switchTo: 1 });
  const st = T.teamTurn(tp, T.teamStart(tp, 0), "stay");
  const lostSw = Math.min(...sw.map((r) => 100 - r.state.youBench[0].hpPct));
  const lostStay = Math.min(...st.filter((r) => r.state.youActive === 0).map((r) => 100 - r.state.yourHpPct).filter((x) => x > 0));
  ok(sw.every((r) => r.state.yourHpPct === 100 || r.state.weatherType === "sandstorm") && lostSw > 1.8 * lostStay,
    `Pursuit hits the leaver at about double (min ${lostSw.toFixed(1)}% vs ${lostStay.toFixed(1)}% staying) and not the newcomer`);
}

// ── Roar and Whirlwind ─────────────────────────────────────────────────────
{
  const roarer = O("Suicune", "Bold", ["Roar"], "Pressure");
  const calm = P("Snorlax", "Adamant", ["Splash"], "Thick Fat"); // does nothing: no flinch, no paralysis to stop the Roar
  const tctx = { team: [calm, gyara, ttar], opp: roarer };
  const res = T.teamTurn(tctx, T.teamStart(tctx, 0), "stay");
  const to1 = pOf(res, (r) => r.state.youActive === 1), to2 = pOf(res, (r) => r.state.youActive === 2);
  // Bold: Support 50% (Roar), else an empty group -> fallback Roar at 50%: 0.75 in all
  ok(near(to1, to2) && near(to1 + to2, 0.75), `Roar drags in a uniformly random healthy teammate (${to1.toFixed(3)} / ${to2.toFixed(3)})`);
  const sc = { team: [P("Octillery", "Modest", ["Octazooka"], "Suction Cups"), gyara], opp: roarer };
  ok(T.teamTurn(sc, T.teamStart(sc, 0), "stay").every((r) => r.state.youActive === 0), "Suction Cups holds");
  const alone = { team: [snorlax], opp: roarer };
  ok(T.teamTurn(alone, T.teamStart(alone, 0), "stay").every((r) => r.state.youActive === 0), "no healthy teammate: Roar fails");
  const mine = { team: [P("Suicune", "Bold", ["Roar"], "Pressure"), gyara], opp: O("Slowbro", "Relaxed", ["Splash"], "Oblivious") };
  const r2 = T.teamTurn(mine, T.teamStart(mine, 0), "stay");
  ok(pOf(r2, (r) => r.outcome === "oppLeft") > 0.5, "your Roar takes the opponent off the field: 'oppLeft'");
  const none = { ...mine, oppReserves: 0 };
  ok(T.teamTurn(none, T.teamStart(none, 0), "stay").every((r) => r.outcome !== "oppLeft"), "...unless it has no one to come in");
  const bp = { team: [calm, gyara], opp: O("Ninjask", "Adamant", ["Baton Pass"], "Speed Boost") };
  ok(pOf(T.teamTurn(bp, T.teamStart(bp, 0), "stay"), (r) => r.outcome === "oppLeft") > 0.5, "the opponent's Baton Pass: 'oppLeft'");
}

// ── fainting, replacing, losing ────────────────────────────────────────────
{
  const hitter = O("Salamence", "Adamant", ["Double-Edge"], "Intimidate", { evs: { atk: 252 } });
  const tctx = { team: [snorlax, gyara, ttar], opp: hitter };
  const low = { ...T.teamStart(tctx, 0), yourHpPct: 1 };
  const res = T.teamTurn(tctx, low, "stay");
  ok(res.some((r) => r.outcome === "replace"), "your mon faints with teammates left: 'replace'");
  const rep = T.replace(tctx, res.find((r) => r.outcome === "replace").state, 1);
  ok(rep.youActive === 1 && rep.youBench[0].hpPct === 0 && rep.youMonFirstTurn === true && rep.yourUsablePartyMons === 1,
    "the replacement comes in free; the fainted mon stays fainted");
  const last = { team: [snorlax], opp: hitter };
  ok(T.teamTurn(last, { ...T.teamStart(last, 0), yourHpPct: 1 }, "stay").some((r) => r.outcome === "lose"), "no one left: 'lose'");
  // the winning turn still ends: Leftovers after the KO
  const frail = O("Shedinja", "Adamant", ["Splash"], "Wonder Guard");
  const w = { team: [P("Snorlax", "Adamant", ["Fake Out"], "Thick Fat", { item: "Leftovers" }), gyara], opp: O("Pikachu", "Timid", ["Splash"], "Static") };
  const wr = T.teamTurn(w, { ...T.teamStart(w, 0), yourHpPct: 50 }, "stay").filter((r) => r.outcome === "win");
  ok(wr.length > 0 && wr.every((r) => r.state.yourHpPct > 50), "a winning turn still ends: Leftovers heal after the KO");
  void frail;
}

// ── the opponent switching out on Perish Song ──────────────────────────────
{
  const tctx = { team: [snorlax, gyara], opp: O("Lapras", "Modest", ["Surf"], "Water Absorb") };
  const s = { ...T.teamStart(tctx, 0), oppPerishCount: 0 };
  ok(T.teamTurn(tctx, s, "stay")[0].outcome === "oppLeft", "perish timer at 0: the opponent switches out");
  ok(T.teamTurn(tctx, { ...s, oppIngrained: true }, "stay").every((r) => r.outcome !== "oppLeft"), "...not when Ingrained (ShouldSwitch's trap checks)");
}

// ── a corpus: every turn sums to 1, every action is legal ──────────────────
{
  const { FRONTIER_POOL } = await import(E("frontier-pool.js"));
  const { getOpponentConfig } = await import(E("opponent-adapter.js"));
  let x = 3;
  const r = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const names = Object.keys(FRONTIER_POOL).filter((n) => FRONTIER_POOL[n].lv50Legal);
  const mk = (n, player) => {
    const c = getOpponentConfig(n, { ability: pick(FRONTIER_POOL[n].abilities) });
    return player ? T.buildPlayerMon(c) : L.buildMon({ ...c, friendship: 255 });
  };
  let turns = 0, bad = 0, throws = 0;
  const kinds = new Map();
  for (let i = 0; i < 120; i++) {
    const tctx = { team: [mk(pick(names), true), mk(pick(names), true), mk(pick(names), true)], opp: mk(pick(names), false) };
    let s = T.teamStart(tctx, 0);
    for (let d = 0; d < 6; d++) {
      const bench = T.aliveBench(s);
      const action = bench.length && r() < 0.3 ? { switchTo: pick(bench) } : "stay";
      let res;
      try { res = T.teamTurn(tctx, s, action); } catch (e) { throws++; const k = e.message.slice(0, 60); kinds.set(k, (kinds.get(k) ?? 0) + 1); break; }
      turns++;
      if (!near(sum(res), 1, 1e-9)) bad++;
      const nx = pick(res);
      if (nx.outcome === "replace") s = T.replace(tctx, nx.state, pick(T.aliveBench(nx.state)));
      else if (nx.outcome) break;
      else s = nx.state;
    }
  }
  ok(bad === 0 && turns > 300, `corpus: ${turns} team turns, every one sums to 1 (${bad} off)`);
  console.log(`  corpus: ${throws} named throws${throws ? ": " + [...kinds].map(([k, n]) => `${n}x ${k}`).join(" | ") : ""}`);
}

console.log(`${fail ? "FAIL" : "ok"}  team: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
