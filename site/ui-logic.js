// ── ui-logic.js ────────────────────────────────────────────────────────────
// The page's "brains": pure functions, no DOM (app.js owns the DOM). Form
// values in, an engine position out; engine results in, render-ready rows
// out. Every number comes from ../engine -- nothing here does battle math.

import * as L from "../engine/logic.js";
import { teamStart } from "../engine/team.js";
import { parseShowdownTeam } from "../engine/showdown.js";
import { buildPlayerMon } from "../engine/team.js";
import { getOpponentConfig } from "../engine/opponent-adapter.js";
import { FRONTIER_POOL } from "../engine/frontier-pool.js";
import { FRONTIER_TRAINERS } from "../engine/frontier-trainers.js";
import { trainerPrior, fixedIvs, makeNextIn, BRAIN_TEAMS } from "../engine/next-in.js";
import { lowHpCheck, palaceChoices, quickClawDraws, GROUP_NAMES } from "../engine/palace.js";
import { rootActions } from "../engine/solve.js";
import { chooseLever, tiedWithBest, tieBreak, trade, firstTurnStatsTeam } from "../engine/policy.js";

export const STAGE_KEYS = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];
const HIGH_TIER = 849;

// ── your team ──────────────────────────────────────────────────────────────
// Showdown text -> buildPlayerMon configs (engine/showdown.js), max 3.
export function parseTeam(text) {
  const cfgs = parseShowdownTeam(text);
  if (cfgs.length < 1 || cfgs.length > 3) throw new Error(`a Palace team is 1-3 Pokémon; this paste has ${cfgs.length}`);
  return cfgs;
}

// ── the Frontier Brain ─────────────────────────────────────────────────────
// Spenser comes at win streak 21 (Silver) and 42 (Gold): the 7th battle of
// challenges 3 and 6 (sFrontierBrainStreakAppearances, see next-in.js). A
// default only: holding Silver but not Gold, streak 21 is a normal trainer
// (GetFrontierBrainStatus with one symbol checks 42 only). With both symbols
// he also comes at 63, 84, ... -- inside "8+", so there the page leaves it to
// you.
export const BRAINS = Object.keys(BRAIN_TEAMS);
export function brainFor({ challenge, battle } = {}) {
  if (battle !== 7) return null;
  return challenge === 3 ? "Spenser Silver" : challenge === 6 ? "Spenser Gold" : null;
}

// ── the opponent's set list ────────────────────────────────────────────────
// Level-50 sets (the solver is a level-50 solver), optionally only those a
// trainer drawn for this challenge and battle can lead with. brain: his three,
// in party order.
export function setChoices({ challenge, battle, bracketOnly = true, brain = null } = {}) {
  if (brain) return [...BRAIN_TEAMS[brain]];
  let ids = null;
  if (bracketOnly && challenge && battle) {
    ids = new Set();
    for (const { id } of trainerPrior({ challenge, battle })) for (const m of FRONTIER_TRAINERS[id].monSet) if (m <= HIGH_TIER) ids.add(m);
  }
  // Integer index only: the pool also carries the 46 Frontier Brain sets and a
  // duplicate "Mr. Mime 1-4" (index null, from the retired list) beside the
  // indexed "MR_MIME 1-4".
  return Object.entries(FRONTIER_POOL)
    .filter(([, e]) => Number.isInteger(e.index) && e.index <= HIGH_TIER && !e.brain && (!ids || ids.has(e.index)))
    .map(([key]) => key)
    .sort((a, b) => setLabel(a).localeCompare(setLabel(b), undefined, { numeric: true }));
}
// A pool key as people write it ("MR_MIME 1" -> "Mr. Mime 1").
export const setLabel = (key) => key.replace(/^MR_MIME /, "Mr. Mime ");

// The trainer IV bands a lead can come with in this bracket, most likely
// first: each trainer weighted by the chance it is drawn and leads with this
// set (next-in.js teammateDist's own weighting).
export function ivTierOdds(setKey, { challenge, battle } = {}) {
  const e = FRONTIER_POOL[setKey];
  if (e?.brain) return [{ iv: e.fixedIV, p: 1 }]; // a Brain's IVs are fixed
  if (!e || !challenge || !battle) return [];
  const by = new Map();
  for (const { id, p } of trainerPrior({ challenge, battle })) {
    const lv = FRONTIER_TRAINERS[id].monSet.filter((m) => m <= HIGH_TIER);
    const n = lv.filter((m) => m === e.index).length;
    if (!n) continue;
    const iv = fixedIvs(id);
    by.set(iv, (by.get(iv) ?? 0) + (p * n) / lv.length);
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  return [...by.entries()].map(([iv, w]) => ({ iv, p: w / total })).sort((a, b) => b.p - a.p);
}

// gender: "male" / "female" as the game shows it, or null (unknown -- the
// engine then splits each Attract by the species' odds). Ignored for a
// species with one gender.
export function buildOpponent({ setKey, ability, ivTier, gender = null }) {
  const e = FRONTIER_POOL[setKey];
  if (!e) throw new Error(`no Frontier set named "${setKey}"`);
  const ab = ability || (e.abilities.length === 1 ? e.abilities[0] : null);
  if (!ab) throw new Error(`${setKey} can have ${e.abilities.join(" or ")} -- pick one`);
  const mon = L.buildFrontierOpponent(getOpponentConfig(setKey, { ability: ab, ivTier, allowUnreachableTier: true }));
  return gender && mon.genderDist.length > 1 ? { ...mon, genderDist: [{ p: 1, gender }] } : mon;
}
// A built mon's gender for display: "male" / "female" / "genderless", or null
// when it can be either and nobody said which.
export const genderOf = (mon) => (mon.genderDist.length === 1 ? mon.genderDist[0].gender : null);

// Attract / Cute Charm are the only effects that read gender: a note when one
// of them is in play and a gender they need is unknown.
const ATTRACTERS = (m) => m.moves.includes("Attract") || m.ability === "Cute Charm";
function genderNote(team, active, opp) {
  const you = team[active];
  if (!ATTRACTERS(opp) && !ATTRACTERS(you)) return null;
  const unknown = [genderOf(you) ? null : `your ${you.species} (add (M) or (F) after its name in the paste)`, genderOf(opp) ? null : `their ${opp.species} (set it in the Opponent panel)`].filter(Boolean);
  return unknown.length ? `Attract / Cute Charm in play and the gender of ${unknown.join(" and ")} is not set: the solve treats each Attract as a fresh coin toss on the species' odds.` : null;
}

// ── sleep ──────────────────────────────────────────────────────────────────
// The game hides a sleep's length. A sleep move rolls the counter 2-5, Rest
// sets 3; each blocked turn takes 1 off (2 with Early Bird) and the mon is
// still asleep only while it is above 0. Every counter still possible,
// equally likely (the same rule as the Arena solver's sleepCounters).
export function sleepCounters({ rest = false, slept = 0 } = {}, mon) {
  const step = mon.ability === "Early Bird" ? 2 : 1;
  const rolls = rest ? [3] : [2, 3, 4, 5];
  const left = rolls.map((r) => r - slept * step).filter((c) => c >= 1);
  return left.length ? left : [1];
}

// ── the position ───────────────────────────────────────────────────────────
// form = {
//   team: [config x1-3], active: index of the mon out,
//   mons: [{ hpPct, status, toxicTurns, sleep: { rest, slept }, itemGone }] per team member,
//   you: { stages, confused (0 = no, else the engine's next-check index 1..5), subPct, lowHp (true/false/null = auto) },
//   opp: { setKey, ability, ivTier, hpPct, status, toxicTurns, sleep, itemGone, stages, confused, firstTurn, lowHp },
//   field: { weather, weatherTurns (null = permanent), you: { reflect, lightScreen, spikes }, opp: { ... } },
//   run: { challenge, battle, oppIndex (1-3), leadKey (when oppIndex is 2), brain (null or a BRAINS name) },
// }
// Returns { tctx (plain data + nextIn spec), start: [{ p, state }], actions, labels, notes }.
const SCREEN_TURNS = 5;
const MAX_SLEEP_VARIANTS = 64;
export function buildFight(form) {
  const notes = [];
  const team = form.team.map((cfg) => buildPlayerMon(cfg));
  const brain = form.run?.brain ?? null;
  if (brain) {
    const bt = BRAIN_TEAMS[brain], who = brain.split(" ")[0], i = bt.indexOf(form.opp.setKey), idx = form.run.oppIndex ?? 1;
    if (i < 0) throw new Error(`${form.opp.setKey} is not on ${brain}'s team (${bt.join(", ")})`);
    if (idx === 1 && i !== 0) throw new Error(`${who} always sends out ${FRONTIER_POOL[bt[0]].species} first`);
    if (idx > 1 && i === 0) throw new Error(`${FRONTIER_POOL[bt[0]].species} is ${who}'s first Pokémon, not his ${idx === 2 ? "2nd" : "3rd"}`);
  } else if (FRONTIER_POOL[form.opp.setKey]?.brain) throw new Error(`${form.opp.setKey} is a Frontier Brain set: pick the Brain battle`);
  const opp = buildOpponent(form.opp);
  const oppReserves = Math.max(0, 3 - (form.run?.oppIndex ?? 1));
  const tbase = { team, opp, oppReserves };
  let s = teamStart(tbase, form.active);

  const statusOf = (st) => (st === "toxic" ? "poison" : st || null);
  const active = form.mons[form.active];
  const ov = {};
  // HP and status
  ov.yourHpPct = active.hpPct; ov.oppHpPct = form.opp.hpPct;
  ov.youStatus = statusOf(active.status); ov.oppStatus = statusOf(form.opp.status);
  if (active.status === "toxic") ov.youToxicCounter = Math.max(1, active.toxicTurns ?? 1);
  if (form.opp.status === "toxic") ov.oppToxicCounter = Math.max(1, form.opp.toxicTurns ?? 1);
  // Stages: all zero keeps the switch-in stages (Intimidate) teamStart applied.
  for (const [side, st] of [["you", form.you.stages], ["opp", form.opp.stages]]) {
    if (st && STAGE_KEYS.some((k) => st[k])) ov[side + "Stages"] = Object.fromEntries(STAGE_KEYS.map((k) => [k, st[k] ?? 0]));
  }
  // form.entering (send-in mode): your mon is coming in now, so its entry
  // effects (Intimidate) land ON TOP of the opponent's stages as entered.
  if (form.entering && ov.oppStages) {
    ov.oppStages = Object.fromEntries(STAGE_KEYS.map((k) => [k, Math.max(-6, Math.min(6, ov.oppStages[k] + (s.oppStages[k] ?? 0)))]));
  }
  if (form.you.confused) ov.youConfused = form.you.confused === 1 ? true : form.you.confused;
  if (form.opp.confused) ov.oppConfused = form.opp.confused === 1 ? true : form.opp.confused;
  if (form.you.subPct > 0) ov.youSubstituteHP = Math.max(1, Math.round((form.you.subPct / 100) * team[form.active].stats.hp));
  if (active.itemGone && team[form.active].item) { ov.youItemOverride = null; ov.youBerryConsumed = true; }
  if (form.opp.itemGone && opp.item) { ov.oppItemOverride = null; ov.oppBerryConsumed = true; }
  ov.oppMonFirstTurn = form.opp.firstTurn !== false;
  // Field
  const f = form.field ?? {};
  if (f.weather) { ov.weatherType = f.weather; ov.weatherTurns = f.weatherTurns ?? null; }
  for (const side of ["you", "opp"]) {
    const sd = f[side] ?? {};
    ov[side + "ReflectTurns"] = sd.reflect ? (sd.reflectTurns ?? SCREEN_TURNS) : null;
    ov[side + "LightScreenTurns"] = sd.lightScreen ? (sd.lightScreenTurns ?? SCREEN_TURNS) : null;
    ov[side + "SpikesLayers"] = Math.max(0, Math.min(3, sd.spikes ?? 0));
  }
  s = { ...s, ...ov, youStages: ov.youStages ?? s.youStages, oppStages: ov.oppStages ?? s.oppStages };
  // Volatile flags set through the engine's own key -> bit mapping
  for (const k of ["youConfused", "oppConfused"]) if (k in ov) s[k] = ov[k];
  // The bench: what each benched mon carries
  s.youBench = s.youBench.map((e, i) => {
    if (!e) return e;
    const m = form.mons[i];
    return { ...e, hpPct: m.hpPct, status: statusOf(m.status), toxic: m.status === "toxic",
      sleepTurns: null, ...(m.itemGone && team[i].item ? { itemOverride: null, berryConsumed: true } : {}) };
  });
  // The Palace low-HP latch: auto = the latch's own check on the HP and
  // status entered (it never clears by healing -- tick it by hand if your
  // mon was at half or below earlier and has healed since).
  const latch = (v, mon, hp, status) => (v == null ? lowHpCheck(mon, hp, status) : !!v);
  s.youPalaceLowHp = latch(form.you.lowHp, team[form.active], s.yourHpPct, s.youStatus);
  s.oppPalaceLowHp = latch(form.opp.lowHp, opp, s.oppHpPct, s.oppStatus);

  // Sleep: one start position per combination of counters still possible.
  let mix = [{ p: 1, state: s }];
  const sleepers = [];
  if (s.youStatus === "sleep") sleepers.push({ key: "youSleepTurns", counters: sleepCounters(active.sleep, team[form.active]) });
  if (s.oppStatus === "sleep") sleepers.push({ key: "oppSleepTurns", counters: sleepCounters(form.opp.sleep, opp) });
  s.youBench.forEach((e, i) => { if (e && e.status === "sleep") sleepers.push({ bench: i, counters: sleepCounters(form.mons[i].sleep, team[i]) }); });
  for (const sl of sleepers) {
    const next = [];
    for (const v of mix) for (const c of sl.counters) {
      const st = sl.key ? { ...v.state, [sl.key]: c }
        : { ...v.state, youBench: v.state.youBench.map((e, i) => (i === sl.bench ? { ...e, sleepTurns: c } : e)) };
      next.push({ p: v.p / sl.counters.length, state: st });
    }
    mix = next;
  }
  if (mix.length > MAX_SLEEP_VARIANTS) throw new Error(`too many unknown sleep lengths at once (${mix.length} combinations)`);
  if (mix.length > 1) notes.push(`Sleep length unknown: averaged over ${mix.length} possible counters.`);

  // The opponent's replacement after a KO (next-in.js)
  let nextInSpec = null;
  const run = form.run ?? {};
  if (run.oppIndex === 3) notes.push("Their last Pokémon: a KO ends the battle (no replacement to face).");
  else if (brain) {
    const spec = { lead: BRAIN_TEAMS[brain][0], second: run.oppIndex === 2 ? form.opp.setKey : null, brain };
    makeNextIn(spec);
    nextInSpec = spec;
  } else if (run.challenge && run.battle) {
    const spec = run.oppIndex === 2
      ? { lead: run.leadKey, second: form.opp.setKey, challenge: run.challenge, battle: run.battle }
      : { lead: form.opp.setKey, challenge: run.challenge, battle: run.battle };
    try {
      if (run.oppIndex === 2 && !run.leadKey) throw new Error("enter their first Pokémon to estimate the last one");
      makeNextIn(spec); // validates; the workers rebuild it from the spec
      nextInSpec = spec;
      if (run.oppIndex === 2) notes.push("Their last Pokémon is estimated from the first two (which one came in second is not used as evidence).");
    } catch (e) {
      notes.push(`Not scoring their next Pokémon: ${e.message}.`);
    }
  }
  const gn = genderNote(team, form.active, opp);
  if (gn) notes.push(gn);
  const actions = rootActions(s);
  const labels = actions.map((a) => (a === "stay" ? `Stay in (${team[form.active].species})` : `Switch to ${team[a.switchTo].species}`));
  return { tctx: { team, opp, oppReserves, nextInSpec }, start: mix, actions, labels, notes };
}

// ── your mon fainted: who goes in ──────────────────────────────────────────
// form as for buildFight, with form.active = the mon that just fainted. One
// position per healthy teammate, sent in fresh (no stages, Substitute or
// confusion; its entry effects applied), the opponent as entered.
export function buildSendIn(form) {
  const mons = form.mons.map((m, i) => (i === form.active ? { ...m, hpPct: 0, status: "" } : m));
  const cands = mons.map((m, i) => i).filter((i) => i !== form.active && mons[i].hpPct > 0);
  if (!cands.length) throw new Error("no healthy teammate left to send in");
  const fresh = { stages: Object.fromEntries(STAGE_KEYS.map((k) => [k, 0])), confused: 0, subPct: 0, lowHp: null };
  return cands.map((j) => ({ j, species: form.team[j].species, fight: buildFight({ ...form, mons, active: j, you: fresh, entering: true }) }));
}

// The first-turn numbers over a fight's start mix (unknown sleep lengths).
export function sendInStats(fight, j) {
  const acc = { pKO: 0, dmg: 0, lost: 0, pLow: 0 };
  let choice = false;
  for (const { p, state } of fight.start) {
    const x = firstTurnStatsTeam(fight.tctx, state, j);
    for (const k of Object.keys(acc)) acc[k] += p * x[k];
    choice = x.choice;
  }
  return { j, ...acc, choice };
}

// The decision, as the streak sim makes it (engine/policy.js): solve each
// candidate (solve(fight, budgetMs) -> { levers }); one clearly better goes
// in; the tied ones are solved again; still tied -> the first turn decides.
// Returns { j, why, rows: [{ j, label, value, margin, row }], tie } where row
// is the candidate's recommended lever and tie the first-turn numbers (when
// used). onProgress(rows) after each solve.
export async function decideSendIn(cands, solve, { budgetMs, onProgress = null } = {}) {
  const rows = [];
  const run = async (c, ms) => {
    const r = await solve(c.fight, ms);
    const rs = resultRows(r.levers, c.fight.labels, c.fight.actions), row = rs.find((x) => x.pick);
    return { j: c.j, label: `Send in ${c.species}`, value: row.score, margin: row.margin, row, levers: rs };
  };
  if (cands.length === 1) return { j: cands[0].j, why: "the only one left", rows: [], tie: null };
  const per = Math.max(1000, Math.round(budgetMs / cands.length));
  for (const c of cands) { rows.push(await run(c, per)); onProgress?.(rows); }
  let tied = tiedWithBest(rows);
  if (tied.length === 1) return { j: tied[0], why: "clearly best", rows, tie: null };
  for (const j of tied) { const i = rows.findIndex((x) => x.j === j); rows[i] = await run(cands.find((c) => c.j === j), per); onProgress?.(rows); }
  tied = tiedWithBest(rows.filter((x) => tied.includes(x.j)));
  if (tied.length === 1) return { j: tied[0], why: "clearly best after a second solve", rows, tie: null };
  const stats = tied.map((j) => ({ ...sendInStats(cands.find((c) => c.j === j).fight, j), value: rows.find((x) => x.j === j).value }));
  const tb = tieBreak(stats);
  const RULE = { a: "the better chance to KO before it acts", b: "damage dealt against HP lost", c: "no Choice item", score: "the higher score" };
  return { j: tb.j, why: `too close to call; decided by ${RULE[tb.step]}`, rows, tie: { step: tb.step, stats: stats.map((x) => ({ ...x, trade: trade(x) })) } };
}

// ── this turn's choices, both sides ────────────────────────────────────────
// What the Palace has each side do this turn (palaceChoices, over the shared
// Quick Claw draw), merged by move: [{ move, p, loaf }] per side.
export function turnChoices(tctx, mix) {
  const out = { you: new Map(), opp: new Map() };
  for (const { p: pv, state } of mix) {
    const ctx = { you: tctx.team[state.youActive], opp: tctx.opp };
    for (const d of quickClawDraws(ctx, state)) {
      for (const side of ["you", "opp"]) {
        for (const c of palaceChoices(ctx, state, side, { qc: d.qc })) {
          // A loaf is the Palace's "won't obey" turn, whatever slot it came from.
          const k = c.loaf ? "Loafs around (does nothing)" : c.move;
          out[side].set(k, (out[side].get(k) ?? 0) + pv * d.p * c.p);
        }
      }
    }
  }
  const rows = (m) => [...m.entries()].map(([move, p]) => ({ move, p })).sort((a, b) => b.p - a.p);
  return { you: rows(out.you), opp: rows(out.opp) };
}

// ── results ────────────────────────────────────────────────────────────────
// Levers (montecarlo.js estimate) -> table rows, best score first, with the
// best marked and any lever whose 95% range overlaps the best's marked as a
// tie. With the actions given, the RECOMMENDATION (pick) follows the streak
// sim's rule (engine/policy.js chooseLever): stay unless a switch is clearly
// better -- a switch whose lead is inside the noise is held (held).
export function resultRows(levers, labels, actions = null) {
  const rows = levers.map((l, i) => ({ ...l, label: labels[i], stay: actions ? actions[i] === "stay" : false }));
  const best = rows.reduce((a, b) => (b.score > a.score ? b : a));
  const choice = actions ? chooseLever(levers, actions) : null;
  rows.forEach((r, i) => {
    r.best = r === best;
    r.tie = !r.best && r.score + r.margin >= best.score - best.margin;
    r.pick = choice ? i === choice.index : r.best;
    r.held = !!(choice?.held && r.pick);
  });
  return rows.sort((a, b) => b.score - a.score);
}
export const pct = (x, digits = 0) => `${(100 * x).toFixed(digits)}%`;
export function verdict(rows, info = {}) {
  const best = rows.find((r) => r.best), pick = rows.find((r) => r.pick) ?? best;
  if (!best) return "";
  const soFar = info.done ? "" : " (so far)";
  if (pick.held) return `${pick.label} -- switching isn't clearly better (${best.label} leads by less than the noise)${soFar}`;
  const ties = rows.filter((r) => r.tie);
  if (ties.length && pick.stay) return `${pick.label} -- no switch is clearly better${soFar}`;
  if (ties.length) return `${best.label} -- too close to call against ${ties.map((t) => t.label).join(", ")}`;
  return `${best.label}${soFar}`;
}
