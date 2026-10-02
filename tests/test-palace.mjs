// The Palace layer (engine/palace.js) and the engine's Palace hooks.
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const E = (f) => pathToFileURL(path.join(here, "../engine", f)).href;
const L = await import(E("logic.js"));
const P = await import(E("palace.js"));
const { mirrorState, mirrorCtx } = await import(E("mirror.js"));
const { FRONTIER_POOL } = await import(E("frontier-pool.js"));
const { getOpponentConfig } = await import(E("opponent-adapter.js"));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log("FAIL", msg); } };
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;
const IV = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mk = (species, nature, moves, { ability, item = null, evs = {} } = {}) =>
  L.buildMon({ species, level: 50, nature, moves, ability, item, ivs: IV, evs, friendship: 255 });
const sum = (xs) => xs.reduce((a, x) => a + x.p, 0);

// ── 1. Groups: every move, against battle_moves.h directly ─────────────────
{
  const fx = JSON.parse(readFileSync(path.join(here, "fixtures/palace-groups.json"), "utf8"));
  let bad = 0;
  for (const [move, g] of Object.entries(fx)) if (P.GROUP_NAMES[P.palaceMoveGroup(move)] !== g) { bad++; if (bad < 5) console.log("  group", move, g); }
  ok(bad === 0 && Object.keys(fx).length === 354, `groups: ${354 - bad}/354 equal to battle_moves.h`);
}

// ── 2. Nature rows: support share equals source's comment column ───────────
// src/battle_script_commands.c:859-883, "// 32% support >= 50% HP, 32% support < 50% HP".
{
  const SUPPORT_COMMENT = { Hardy: [32, 32], Lonely: [55, 8], Brave: [15, 8], Adamant: [31, 15], Naughty: [10, 8],
    Bold: [50, 10], Docile: [22, 22], Relaxed: [60, 10], Impish: [25, 17], Lax: [55, 65], Timid: [28, 50],
    Hasty: [5, 6], Serious: [55, 60], Jolly: [60, 5], Naive: [22, 22], Modest: [20, 6], Mild: [6, 60],
    Quiet: [22, 22], Bashful: [12, 12], Rash: [57, 67], Calm: [10, 13], Gentle: [12, 5], Sassy: [6, 58],
    Careful: [8, 53], Quirky: [22, 22] };
  let bad = 0;
  for (const [n, [hi, lo]] of Object.entries(SUPPORT_COMMENT)) {
    const a = P.decodeNatureRow(n, false), b = P.decodeNatureRow(n, true);
    if (Math.round(a[2] * 100) !== hi || Math.round(b[2] * 100) !== lo || !near(a[0] + a[1] + a[2], 1)) { bad++; console.log("  nature", n, a, b); }
  }
  ok(bad === 0, `nature rows: 25/25 support shares match source comments (${bad} off)`);
}

// ── 3. The fallback, with its vanilla bug ──────────────────────────────────
// A Hasty mon (Support 5% high-HP) with no Support move: the 5% Support roll
// falls back. Moves Attack x1, Defense x2: exactly one multi-move group
// (Defense), so the pick is uniform over the two Defense moves, then 50% loaf.
{
  const you = mk("Snorlax", "Hasty", ["Body Slam", "Amnesia", "Rest", "Earthquake"], { ability: "Thick Fat" });
  // groups: Body Slam A, Amnesia D, Rest D, Earthquake A  -> Attack 2, Defense 2: TWO multi groups -> uniform over all 4
  const opp = mk("Starmie", "Hardy", ["Surf"], { ability: "Natural Cure" });
  const s = P.palaceStartState({ you, opp });
  const ch = P.palaceChoices({ you, opp }, s, "you");
  const fb = ch.filter((c) => c.group === P.SUPPORT);
  const pSup = P.decodeNatureRow("Hasty", false)[P.SUPPORT];
  ok(fb.every((c) => !c.aiRan) && near(sum(fb), pSup), "fallback: the empty Support roll runs no AI and keeps its mass");
  const loaf = fb.find((c) => c.loaf);
  ok(loaf && loaf.move === "Body Slam" && loaf.loaf === "escape" && near(loaf.p, pSup * 0.5), "fallback: 50% loaf, returning slot 0, escape script");
  const picks = fb.filter((c) => !c.loaf);
  ok(picks.length === 4 && picks.every((c) => near(c.p, pSup * 0.5 / 4)), "fallback: two multi-move groups -> uniform over the 4 usable moves");

  // Support x2 + Attack x2, rolling Defense: the buggy Support comparison never
  // counts Support, so Attack is the ONE multi group and Support moves are
  // never picked (BUGFIX would make it uniform over all four).
  const you2 = mk("Snorlax", "Hasty", ["Body Slam", "Yawn", "Earthquake", "Lovely Kiss"].slice(0, 4), { ability: "Thick Fat" });
  const ok2 = ["Body Slam", "Yawn", "Earthquake", "Lovely Kiss"].every((m) => L.MOVES[m]);
  if (ok2) {
    const s2 = P.palaceStartState({ you: you2, opp });
    const fb2 = P.palaceChoices({ you: you2, opp }, s2, "you").filter((c) => c.group === P.DEFENSE && !c.loaf);
    ok(fb2.length === 2 && fb2.every((c) => P.palaceMoveGroup(c.move) === P.ATTACK), "fallback bug: Support never forms the multi-move group");
  }
}

// ── 4. The AI runs over the rolled group only ──────────────────────────────
{
  const you = mk("Snorlax", "Adamant", ["Body Slam", "Curse", "Rest", "Earthquake"], { ability: "Thick Fat", evs: { hp: 252, atk: 252 } });
  const opp = mk("Starmie", "Timid", ["Surf", "Psychic", "Recover", "Thunderbolt"], { ability: "Natural Cure", evs: { spa: 252, spe: 252 } });
  const ctx = { you, opp };
  const s = P.palaceStartState({ you, opp });
  const ch = P.palaceChoices(ctx, s, "opp");
  ok(near(sum(ch), 1), "choices sum to 1");
  const def = ch.filter((c) => c.group === P.DEFENSE);
  ok(def.length === 1 && def[0].move === "Recover" && near(def[0].p, P.decodeNatureRow("Timid", false)[P.DEFENSE]),
    "the Defense roll with one Defense move picks it (masked AI: the others start at 0)");
  const atk = ch.filter((c) => c.group === P.ATTACK);
  ok(atk.every((c) => P.palaceMoveGroup(c.move) === P.ATTACK && c.aiRan), "the Attack roll picks only Attack moves, AI ran");
}

// ── 5. The loaf: escape vs plain, sleep, freeze, last move, priority ───────
{
  const you = mk("Snorlax", "Adamant", ["Quick Attack", "Body Slam", "Rest", "Curse"], { ability: "Thick Fat" });
  const opp = mk("Starmie", "Timid", ["Surf", "Psychic", "Recover", "Thunderbolt"], { ability: "Natural Cure", evs: { spe: 252 } });
  const ctx = { you, opp, noLabels: true };
  const base = P.palaceStartState({ you, opp }, {});
  const asleep = { ...base, youStatus: "sleep", youSleepTurns: 3, youLastMove: "Body Slam" };
  const esc = L.resolveTurn(ctx, asleep, "Quick Attack", "Recover", { loaf: { you: "escape", opp: null } });
  ok(esc.every((r) => r.state.youSleepTurns === 2 && r.state.youLastMove === null), "escape loaf: the sleep counter ticks; last move is UNAVAILABLE");
  const plain = L.resolveTurn(ctx, asleep, "Quick Attack", "Recover", { loaf: { you: "plain", opp: null } });
  ok(plain.every((r) => r.state.youSleepTurns === 3), "plain loaf (Disabled/Taunt/... script): no status escape, the counter stays");
  const wake = L.resolveTurn(ctx, { ...asleep, youSleepTurns: 1 }, "Quick Attack", "Recover", { loaf: { you: "escape", opp: null } });
  ok(wake.every((r) => r.state.youStatus === null), "escape loaf: a counter at 1 wakes (and does not act)");
  const frozen = { ...base, youStatus: "freeze" };
  const fz = L.resolveTurn(ctx, frozen, "Quick Attack", "Recover", { loaf: { you: "escape", opp: null } });
  const pThaw = fz.filter((r) => r.state.youStatus === null).reduce((a, r) => a + r.p, 0);
  ok(near(pThaw, 0.2), `escape loaf: a frozen mon thaws 1 in 5 (got ${pThaw})`);
  // Priority: the loafing slot's move orders the turn. Quick Attack (+1) beats a faster Starmie.
  const pr = L.resolveTurn({ ...ctx, noLabels: false }, base, "Quick Attack", "Surf", { loaf: { you: "escape", opp: null } });
  ok(pr.every((r) => r.label.startsWith("You loafs")), "a loaf returning a +1 slot acts first");
  const pr2 = L.resolveTurn({ ...ctx, noLabels: false }, base, "Body Slam", "Surf", { loaf: { you: "escape", opp: null } });
  ok(pr2.every((r) => !r.label.startsWith("You loafs")), "a loaf returning a 0-priority slot acts at its speed");
  ok(pr.every((r) => r.state.yourHpPct < 100), "the foe still acts into a loaf");
}

// ── 6. Selection limits make a loaf of the right kind ──────────────────────
{
  const you = mk("Snorlax", "Calm", ["Body Slam", "Curse", "Yawn", "Rest"], { ability: "Thick Fat" });
  const opp = mk("Starmie", "Timid", ["Surf"], { ability: "Natural Cure" });
  const ctx = { you, opp };
  // Taunted: the Support roll's only member (Yawn) is limited; the AI's scores
  // are all 0 and the pick is uniform over the 4 slots: a limited pick loafs
  // "plain", an unlimited one (Body Slam) is used.
  const s = { ...P.palaceStartState({ you, opp }), youTauntTurns: 2 };
  const ch = P.palaceChoices(ctx, s, "you").filter((c) => c.group === P.SUPPORT);
  const plain = ch.filter((c) => c.loaf === "plain");
  ok(plain.length > 0 && plain.every((c) => L.MOVES[c.move].power === 0), "Taunt: a limited AI pick loafs with the plain script");
  ok(ch.some((c) => !c.loaf && c.move === "Body Slam"), "Taunt: the zeroed AI can still pick an unlimited off-group move");
  // Choice-locked into another move: escape-script loaf.
  const youCB = mk("Snorlax", "Calm", ["Body Slam", "Curse", "Yawn", "Rest"], { ability: "Thick Fat", item: "Choice Band" });
  const s2 = { ...P.palaceStartState({ you: youCB, opp }), youChoiceLock: "Body Slam" };
  const ch2 = P.palaceChoices({ you: youCB, opp }, s2, "you");
  ok(ch2.filter((c) => c.move !== "Body Slam").every((c) => c.loaf === "escape"), "Choice lock: a pick other than the locked move loafs (escape)");
}

// ── 7. Low-HP latch ─────────────────────────────────────────────────────────
{
  const you = mk("Snorlax", "Lonely", ["Body Slam"], { ability: "Thick Fat" });
  const opp = mk("Starmie", "Timid", ["Surf"], { ability: "Natural Cure" });
  const ctx = { you, opp };
  const half = Math.floor(you.stats.hp / 2);
  const pct = (hp) => (hp / you.stats.hp) * 100;
  const s = P.palaceStartState({ you, opp });
  ok(P.updateLowHpLatches(ctx, { ...s, yourHpPct: pct(half) }).youPalaceLowHp === true, "latch: hp == maxHP/2 sets it");
  ok(P.updateLowHpLatches(ctx, { ...s, yourHpPct: pct(half + 1) }).youPalaceLowHp === false, "latch: one above half does not");
  ok(P.updateLowHpLatches(ctx, { ...s, yourHpPct: pct(10), youStatus: "sleep" }).youPalaceLowHp === false, "latch: not while asleep");
  ok(P.updateLowHpLatches(ctx, { ...s, youPalaceLowHp: true }).youPalaceLowHp === true, "latch: healing never clears it");
  const hi = P.palaceChoices(ctx, s, "you"), lo = P.palaceChoices(ctx, { ...s, youPalaceLowHp: true }, "you");
  const g = (cs, k) => cs.filter((c) => c.group === k).reduce((a, c) => a + c.p, 0);
  ok(near(g(hi, P.ATTACK), 0.20) && near(g(lo, P.ATTACK), 0.84), "latch: Lonely's Attack share 20% -> 84% on the low row");
}

// ── 8. History is recorded only where the AI ran ───────────────────────────
{
  const you = mk("Snorlax", "Hasty", ["Body Slam", "Earthquake"], { ability: "Thick Fat" }); // no Defense / Support
  const opp = mk("Starmie", "Timid", ["Surf", "Recover"], { ability: "Natural Cure" });
  const ctx = { you, opp, noLabels: true };
  const s = { ...P.palaceStartState({ you, opp }), turn: 2, youMonFirstTurn: false, oppMonFirstTurn: false, oppLastMove: "Surf", youLastMove: "Body Slam" };
  const res = P.palaceTurn(ctx, s);
  const ran = res.filter((r) => r.you.aiRan), fell = res.filter((r) => !r.you.aiRan);
  ok(ran.length > 0 && ran.every((r) => r.state.oppMoveHistory.includes("Surf")), "player's AI ran: it recorded the opponent's last move");
  ok(fell.length > 0 && fell.every((r) => !r.state.oppMoveHistory.includes("Surf")), "player's roll fell back: no AI, no record");
  ok(near(sum(res), 1), "a Palace turn's successors sum to 1");
}

// ── 9. Corpus: mirror agreement of the choice, totals, throws ──────────────
{
  let x = 7;
  const r = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const names = Object.keys(FRONTIER_POOL).filter((n) => FRONTIER_POOL[n].lv50Legal);
  const mkF = (n) => L.buildMon({ ...getOpponentConfig(n, { ability: pick(FRONTIER_POOL[n].abilities) }), friendship: 255 });
  let pos = 0, mirrorBad = 0, sumBad = 0, throws = 0;
  const throwKinds = new Map();
  for (let i = 0; i < 200; i++) {
    const you = mkF(pick(names)), opp = mkF(pick(names));
    const ctx = { you, opp, noLabels: true };
    let s = P.palaceStartState({ you, opp });
    for (let d = 0; d < 4 && s.yourHpPct > 0 && s.oppHpPct > 0; d++) {
      pos++;
      let res;
      try {
        const a = P.palaceChoices(ctx, s, "you");
        const b = P.palaceChoices(mirrorCtx(ctx), mirrorState(s), "opp");
        const key = (cs) => JSON.stringify(cs.map((c) => [c.move, c.loaf, c.aiRan, c.group, Math.round(c.p * 2 ** 40)]).sort());
        if (key(a) !== key(b)) mirrorBad++;
        res = P.palaceTurn(ctx, s);
      } catch (e) {
        throws++;
        const k = e.message.slice(0, 70);
        throwKinds.set(k, (throwKinds.get(k) ?? 0) + 1);
        break;
      }
      if (!near(sum(res), 1, 1e-9)) sumBad++;
      s = pick(res).state;
    }
  }
  ok(mirrorBad === 0, `corpus: player-side choice == mirrored opponent-side choice (${pos - mirrorBad}/${pos})`);
  ok(sumBad === 0, `corpus: every Palace turn sums to 1 (${sumBad} off)`);
  console.log(`  corpus: ${pos} positions, ${throws} named throws${throws ? ": " + [...throwKinds].map(([k, n]) => `${n}x ${k}`).join(" | ") : ""}`);
}

console.log(`${fail ? "FAIL" : "ok"}  palace: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
