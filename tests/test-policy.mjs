// The streak sim's choices and inputs added 2026-10-07 after the user read the
// loss traces: the stay-unless-clearly-better rule (sim/policy.mjs), genders
// fixed once per battle from the decomp (sim/gender.mjs), and the trace
// labels (misses, crits, which status stopped a move).
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const U = (f) => pathToFileURL(path.join(here, "..", f)).href;
const { chooseLever } = await import(U("sim/policy.mjs"));
const G = await import(U("sim/gender.mjs"));
const L = await import(U("engine/logic.js"));
const T = await import(U("engine/team.js"));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

// ── stay unless a switch is clearly better ─────────────────────────────────
{
  const A = ["stay", { switchTo: 1 }, { switchTo: 2 }];
  // the loss-trace cases: battle 109 turn 4 and 141 turn 28 (ties) -> stay
  let r = chooseLever([{ score: 0.351, margin: 0.052 }, { score: 0.352, margin: 0.031 }, { score: 0.339, margin: 0.05 }], A);
  ok(r.index === 0 && r.top === 1 && r.held, "a switch inside the noise is held: stay (Zapdos, 0.352 vs 0.351)");
  r = chooseLever([{ score: 0.614, margin: 0.046 }, { score: 0.647, margin: 0.047 }, { score: 0.524, margin: 0.047 }], A);
  ok(r.index === 0 && r.held, "0.647 +- 0.047 vs stay 0.614 +- 0.046: held");
  // battle 141 turn 32: separated -> the switch is played
  r = chooseLever([{ score: 0.353, margin: 0.016 }, { score: 0.396, margin: 0.021 }, { score: 0.284, margin: 0.02 }], A);
  ok(r.index === 1 && !r.held, "a clearly better switch is played (0.396 +- 0.021 vs 0.353 +- 0.016)");
  // exactly on the boundary: not clearly better
  r = chooseLever([{ score: 0.5, margin: 0.01 }, { score: 0.52, margin: 0.01 }], A.slice(0, 2));
  ok(r.index === 0 && r.held, "best - margin == stay + margin is not clearly better");
  // exact levers (margin 0): any gap counts
  r = chooseLever([{ score: 0.5, margin: 0 }, { score: 0.5001, margin: 0 }], A.slice(0, 2));
  ok(r.index === 1, "exact levers: any gap");
  // stay already best; no stay lever; the old rule
  r = chooseLever([{ score: 0.7, margin: 0.1 }, { score: 0.6, margin: 0 }], A.slice(0, 2));
  ok(r.index === 0 && !r.held, "stay on top is just stay");
  r = chooseLever([{ score: 0.3, margin: 0.1 }, { score: 0.31, margin: 0.1 }], [{ switchTo: 1 }, { switchTo: 2 }]);
  ok(r.index === 1 && !r.held, "no stay lever (after a faint): the best");
  r = chooseLever([{ score: 0.351, margin: 0.052 }, { score: 0.352, margin: 0.031 }], A.slice(0, 2), { stayBias: false });
  ok(r.index === 1 && !r.held, "stayBias off: the old highest-average rule");
  // an unestimated margin (Infinity) never lets a switch through
  r = chooseLever([{ score: 0.2, margin: 0.01 }, { score: 0.9, margin: Infinity }], A.slice(0, 2));
  ok(r.index === 0 && r.held, "a switch with no margin yet is held");
}

// ── genders: thresholds from species_info.h, drawn once per battle ─────────
{
  // PERCENT_FEMALE(x) = min(254, (x * 255) / 100), truncated (species_info.h:3)
  ok(G.genderThreshold("Machamp") === 63 && G.genderThreshold("Charizard") === 31 && G.genderThreshold("Gardevoir") === 127
    && G.genderThreshold("Snorlax") === 31, "thresholds: 25% -> 63, 12.5% -> 31, 50% -> 127");
  ok(G.genderThreshold("Latios") === "male" && G.genderThreshold("Latias") === "female" && G.genderThreshold("Metagross") === "genderless"
    && G.genderThreshold("Nidoran F") === "female", "fixed genders (incl. a punctuated name)");
  let threw = false; try { G.genderThreshold("Notamon"); } catch { threw = true; }
  ok(threw, "an unknown species throws");
  // the exact odds, by counting the low bytes the draw maps to
  const count = (bit) => { let f = 0, n = bit == null ? 256 : 128; for (let k = 0; k < n; k++) { const low = bit == null ? k : bit + 2 * k; if (63 > low) f++; } return f / n; };
  ok(count(null) === 63 / 256 && count(0) === 32 / 128 && count(1) === 31 / 128, "Machamp: 63/256 female; ability bit 0 -> 32/128, bit 1 -> 31/128");
  let f = 0; const N = 20000; for (let n = 0; n < N; n++) if (G.genderOf(7, n, "opp", 2, "Machamp") === "female") f++;
  ok(Math.abs(f / N - 63 / 256) < 0.01, `drawn rate ${(f / N).toFixed(4)} ~ 63/256`);
  f = 0; for (let n = 0; n < N; n++) if (G.genderOf(7, n, "opp", 2, "Machamp", 1) === "female") f++;
  ok(Math.abs(f / N - 31 / 128) < 0.01, "with ability bit 1 ~ 31/128");
  ok(G.genderOf(3, 99, "opp", 1, "Gardevoir") === G.genderOf(3, 99, "opp", 1, "Gardevoir"), "the same battle, the same gender");
  ok(G.genderOf(3, 99, "opp", 1, "Latios") === "male", "a fixed-gender species ignores the draw");
  const m = L.buildMon({ species: "Machamp", level: 50, nature: "Adamant", moves: ["Attract"], ability: "Guts", item: null, ivs: {}, evs: {}, friendship: 255 });
  ok(m.genderDist.length === 2 && G.withGender(m, "female").genderDist.length === 1 && m.genderDist.length === 2, "withGender fixes a copy");
}

// ── labels: the trace's view of a turn ─────────────────────────────────────
{
  const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const P = (species, moves, extra = {}) => T.buildPlayerMon({ species, level: 50, nature: "Hardy", moves, ability: null, item: null, ivs: IV, evs: {}, ...extra });
  const machampF = G.withGender(L.buildMon({ species: "Machamp", level: 50, nature: "Adamant", moves: ["Attract"], ability: "Guts", item: null, ivs: IV, evs: {}, friendship: 255 }), "female");
  const machampM = G.withGender(machampF, "male");
  const latios = P("Latios", ["Psychic"], { ability: "Levitate" });
  const sw = P("Swampert", ["Earthquake"], { ability: "Torrent" });
  for (const [opp, works, what] of [[machampF, true, "female"], [machampM, false, "male"]]) {
    const tctx = { team: [latios, sw], opp, labels: true };
    const rs = T.teamTurn(tctx, T.teamStart(tctx, 0), "stay");
    const used = rs.filter((r) => /Opp uses Attract/.test(r.label)), pUsed = used.reduce((a, r) => a + r.p, 0);
    ok(pUsed > 0.5 && used.every((r) => r.state.youAttracted === works),
      `a ${what} Machamp's Attract on (male) Latios ${works ? "always works" : "never works"} -- fixed gender, no per-use split`);
  }
  // labels on: misses and crits appear; off: empty
  const tctx = { team: [sw, latios], opp: machampM, labels: true };
  const rs = T.teamTurn(tctx, T.teamStart(tctx, 0), "stay");
  ok(rs.some((r) => /\(critical hit\)/.test(r.label)) && rs.some((r) => /MISSES|hits/.test(r.label)), "labels show hits / misses and crits");
  const off = T.teamTurn({ team: [sw, latios], opp: machampM }, T.teamStart({ team: [sw, latios], opp: machampM }, 0), "stay");
  ok(off.every((r) => !/critical/.test(r.label ?? "")), "labels off by default");
  ok(Math.abs(rs.reduce((a, r) => a + r.p, 0) - off.reduce((a, r) => a + r.p, 0)) < 1e-12 && rs.length === off.length, "labels change no outcome");
  // which status stopped the move
  const s0 = T.teamStart(tctx, 0);
  const asleep = T.teamTurn(tctx, { ...s0, youStatus: "sleep", youSleepTurns: 3 }, "stay");
  ok(asleep.some((r) => /You is asleep/.test(r.label)) && !asleep.some((r) => /paralyzed\/frozen/.test(r.label)), "a sleeping mon's label says asleep");
  const para = T.teamTurn(tctx, { ...s0, youStatus: "paralysis" }, "stay");
  ok(para.some((r) => /You is fully paralyzed/.test(r.label)), "a paralysed mon's label says fully paralyzed");
}

console.log(`test-policy: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
