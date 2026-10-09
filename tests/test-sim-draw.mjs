// The streak sim's draw (sim/draw.mjs) against the decomp's rules: trainers
// from range 7 with no repeat in a challenge, Spenser Gold at 63 / 84 / 105,
// parties by FillTrainerParty's rejections from the trainer's own set list,
// fixed IVs, abilities from each set's list, the same draw for the same
// (seed, n), and the draw against a literal simulation of the loop.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const D = await import(pathToFileURL(path.join(here, "../sim/draw.mjs")).href);
const N = await import(pathToFileURL(path.join(here, "../engine/next-in.js")).href);
const { FRONTIER_TRAINERS, TRAINER_ID_RANGES } = await import(pathToFileURL(path.join(here, "../engine/frontier-trainers.js")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

ok(D.challengeOf(50) === 8 && D.stageOf(50) === 1 && D.challengeOf(56) === 8 && D.stageOf(56) === 7 && D.challengeOf(57) === 9, "battle 50 = challenge 8 battle 1; 56 its 7th; 57 starts challenge 9");
ok([63, 84, 105, 126].every(D.isSpenser) && ![21, 42, 50, 56, 62, 64, 70, 77].some(D.isSpenser), "Spenser Gold at 63, 84, 105, ... only (21 / 42 are before the late pool)");

const draw = D.makeDraw(1);
const [lo, hi] = TRAINER_ID_RANGES[7];
let trainersOk = true, partiesOk = true, ivOk = true, abOk = true;
const counts = new Map();
for (let c = 8; c < 8 + 300; c++) {
  const ids = draw.challengeTrainers(c);
  const real = ids.filter((x) => x !== null);
  if (new Set(real).size !== real.length || real.some((t) => t < lo || t > hi)) trainersOk = false;
  if (ids.length !== 7 || ids.some((x, b) => (x === null) !== D.isSpenser(7 * (c - 1) + b + 1))) trainersOk = false;
  for (const t of real) counts.set(t, (counts.get(t) ?? 0) + 1);
}
ok(trainersOk, `300 challenges: 7 slots, trainers ${lo}-${hi}, no repeat within a challenge, Spenser's slot empty`);
const exp = (300 * 7 - 100) / (hi - lo + 1);
const maxDev = Math.max(...[...counts.values()].map((v) => Math.abs(v - exp)));
ok(counts.size === hi - lo + 1 && maxDev < 6 * Math.sqrt(exp), `every trainer drawn, about evenly (expected ${exp.toFixed(1)} each, max deviation ${maxDev.toFixed(1)})`);

for (let n = 50; n < 50 + 1500; n++) {
  const d = draw.drawBattle(n);
  if (d.trainer === "Spenser Gold") {
    if (d.keys.join() !== N.BRAIN_TEAMS["Spenser Gold"].join() || d.iv !== null) partiesOk = false;
    continue;
  }
  const set = FRONTIER_TRAINERS[d.trainer].monSet;
  const es = d.keys.map((k) => N.poolEntry(N.setId(k)));
  if (es.length !== 3 || es.some((e) => !set.includes(e.index) || e.index > 849)) partiesOk = false;
  if (new Set(es.map((e) => e.species)).size !== 3) partiesOk = false;
  const items = es.map((e) => e.item).filter((x) => x != null);
  if (new Set(items).size !== items.length) partiesOk = false;
  if (d.iv !== N.fixedIvs(d.trainer)) ivOk = false;
  if (d.abilities.some((a, i) => !es[i].abilities.includes(a))) abOk = false;
}
ok(partiesOk, "1,500 parties: 3 sets from the trainer's own list, level-50 only, no repeated species or item");
ok(ivOk && abOk, "the trainer's fixed IVs; each ability from its set's list");
const again = D.makeDraw(1);
ok(JSON.stringify(again.drawBattle(77)) === JSON.stringify(draw.drawBattle(77)) && JSON.stringify(D.makeDraw(2).drawBattle(77)) !== JSON.stringify(draw.drawBattle(77)),
  "the same (seed, n) draws the same battle; another seed another");

// Lead odds: the draw's slot-0 frequencies for one trainer vs the exact
// FillTrainerParty odds (next-in.js teammateDist's lead weighting: a lead is a
// uniform pick among the set list's level-50 entries).
{
  const tid = 250, set = FRONTIER_TRAINERS[tid].monSet.filter((m) => m <= 849);
  const freq = new Map();
  let total = 0;
  const d2 = D.makeDraw(9);
  // reuse the party loop on a fixed trainer by drawing many battles and keeping this trainer's
  for (let n = 50; total < 3000 && n < 50 + 400000; n++) {
    if (D.isSpenser(n)) continue;
    if (d2.challengeTrainers(D.challengeOf(n))[D.stageOf(n) - 1] !== tid) continue;
    const lead = N.setId(d2.drawBattle(n).keys[0]);
    freq.set(lead, (freq.get(lead) ?? 0) + 1); total++;
  }
  const pOf = (m) => set.filter((x) => x === m).length / set.length; // a set listed twice is twice as likely
  const worst = Math.max(...[...new Set(set)].map((m) => Math.abs((freq.get(m) ?? 0) / total - pOf(m)) / Math.sqrt(pOf(m) * (1 - pOf(m)) / total)));
  ok(total >= 3000 && worst < 4.5, `trainer ${tid}'s leads: each level-50 entry of its list equally likely (${total} battles, worst z ${worst.toFixed(2)})`);
}

// Open Level (makeDraw(seed, { open: true })): the high-tier rejection
// (src/battle_tower.c:1696) is off, nothing else changes.
{
  const d50 = D.makeDraw(1), dOpen = D.makeDraw(1, { open: true });
  let sameTrainers = true, rulesOk = true, hiSeen = 0, hiAt50 = 0, hiFromList = true, sameWhenNoHi = true, noHiTrainers = 0;
  for (let n = 50; n < 50 + 3000; n++) {
    const a = d50.drawBattle(n), b = dOpen.drawBattle(n);
    if (a.trainer !== b.trainer) sameTrainers = false;
    if (a.trainer === "Spenser Gold") continue;
    const ids = b.keys.map(N.setId), es = ids.map(N.poolEntry);
    if (new Set(es.map((e) => e.species)).size !== 3 || new Set(ids).size !== 3) rulesOk = false;
    const items = es.map((e) => e.item).filter((x) => x != null);
    if (new Set(items).size !== items.length) rulesOk = false;
    const list = FRONTIER_TRAINERS[b.trainer].monSet;
    if (ids.some((m) => !list.includes(m))) hiFromList = false;
    hiSeen += ids.filter((m) => m > 849).length;
    hiAt50 += a.keys.map(N.setId).filter((m) => m > 849).length;
    if (!list.some((m) => m > 849)) { noHiTrainers++; if (JSON.stringify(a) !== JSON.stringify(b)) sameWhenNoHi = false; }
  }
  ok(sameTrainers, "Open Level: the same trainers as level 50 for the same (seed, n)");
  ok(rulesOk && hiFromList, "Open Level parties: 3 species, no repeated item or set, every set from the trainer's own list");
  ok(hiSeen > 0 && hiAt50 === 0, `high-tier sets (850+) drawn at Open Level (${hiSeen} in 3000 battles), never at level 50`);
  ok(noHiTrainers > 1000 && sameWhenNoHi, `a trainer with no high-tier sets draws the identical party in both modes (${noHiTrainers} battles)`);
}
// Open Level lead odds: uniform over the WHOLE list (high-tier entries too).
{
  const tid = 263, set = FRONTIER_TRAINERS[tid].monSet;
  const freq = new Map(); let total = 0;
  const d3 = D.makeDraw(9, { open: true });
  for (let n = 50; total < 3000 && n < 50 + 400000; n++) {
    if (D.isSpenser(n)) continue;
    if (d3.challengeTrainers(D.challengeOf(n))[D.stageOf(n) - 1] !== tid) continue;
    const lead = N.setId(d3.drawBattle(n).keys[0]);
    freq.set(lead, (freq.get(lead) ?? 0) + 1); total++;
  }
  const pOf = (m) => set.filter((x) => x === m).length / set.length;
  const hiShare = [...freq].filter(([m]) => m > 849).reduce((a, [, c]) => a + c, 0) / total, hiExp = set.filter((m) => m > 849).length / set.length;
  const worst = Math.max(...[...new Set(set)].map((m) => Math.abs((freq.get(m) ?? 0) / total - pOf(m)) / Math.sqrt(pOf(m) * (1 - pOf(m)) / total)));
  ok(total >= 3000 && worst < 4.5, `Open Level, trainer ${tid}'s leads: every entry equally likely, high-tier ones included (high-tier ${(100 * hiShare).toFixed(1)}% vs ${(100 * hiExp).toFixed(1)}% expected, worst z ${worst.toFixed(2)})`);
}

console.log(`test-sim-draw: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
