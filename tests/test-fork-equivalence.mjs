// The fork against the Arena engine (04ee03b) on the golden corpus.
//
//  1. COMPAT   every logic.js ARENA_COMPAT flag set: the fork must reproduce the
//              Arena engine on every probe -- every AI decision and every
//              resolveTurn, with the fields the fork adds stripped -- and lose
//              no walk.
//  2. PALACE   the defaults: the probes that move.
//  3. ATTRIBUTION  each Palace change alone (its flag cleared, the others set):
//              the probes IT moves. Every probe moved in (2) must be moved by at
//              least one change alone -- otherwise it is unexplained and fails.
//
// The golden is RECORDED from the Arena engine (tools/corpus.mjs); the fork
// REPLAYS its walk by successor hash, so extra or different outcomes a Palace
// change creates do not move the positions under test.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { runCorpus } from "../tools/corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = path.join(here, "../engine");
const golden = JSON.parse(readFileSync(path.join(here, "golden-arena-04ee03b.json"), "utf8"));
const L = await import(pathToFileURL(path.join(engine, "logic.js")).href);
const FLAGS = Object.keys(L.ARENA_COMPAT);
const setAll = (v) => { for (const k of FLAGS) L.ARENA_COMPAT[k] = v; };

const byId = new Map(golden.map((g) => [g.id, g]));
async function movers() {
  const probes = await runCorpus(engine, { golden });
  const moved = new Set();
  let compared = 0;
  for (const p of probes) {
    const g = byId.get(p.id);
    if (!g) continue; // a walk the recording never took (its predecessor moved)
    compared++;
    if (g.h !== p.h) moved.add(p.id);
  }
  return { moved, compared, lost: probes.lost };
}

let fail = 0;
setAll(true);
const compat = await movers();
const okCompat = compat.moved.size === 0 && compat.lost === 0 && compat.compared === golden.length;
if (!okCompat) { fail++; console.log(`FAIL compat: ${compat.moved.size} moved, ${compat.lost} lost, ${compat.compared}/${golden.length} compared`); for (const id of [...compat.moved].slice(0, 5)) console.log("   ", id); }

setAll(false);
const palace = await movers();
const perFlag = {};
for (const f of FLAGS) {
  setAll(true); L.ARENA_COMPAT[f] = false;
  perFlag[f] = (await movers()).moved;
}
setAll(false);
const explained = new Set(Object.values(perFlag).flatMap((s) => [...s]));
const unexplained = [...palace.moved].filter((id) => !explained.has(id));
if (unexplained.length) { fail++; console.log(`FAIL ${unexplained.length} unexplained movers:`); for (const id of unexplained.slice(0, 10)) console.log("   ", id); }

const classes = FLAGS.map((f) => `${f} ${perFlag[f].size}`).join(", ");
console.log(`${fail ? "FAIL" : "ok"}  fork equivalence: compat ${golden.length - compat.moved.size}/${golden.length} identical (${compat.lost} lost); ` +
  `palace moves ${palace.moved.size} of ${palace.compared} compared (${palace.lost} walks end early), ${unexplained.length} unexplained [${classes}]`);
process.exit(fail ? 1 : 0);
