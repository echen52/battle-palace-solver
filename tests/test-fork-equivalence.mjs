// The fork must reproduce the Arena engine (04ee03b) on the golden corpus:
// every AI decision and every resolveTurn result, hashed with the Arena's
// Mind / Skill fields stripped (tools/corpus.mjs STRIP_KEYS). Changes that
// deliberately move a probe are listed in INTENDED with the reason; nothing
// else may move.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runCorpus } from "../tools/corpus.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(path.join(here, "golden-arena-04ee03b.json"), "utf8"));

// id -> reason. Empty: no intended divergence yet.
const INTENDED = {};

const probes = await runCorpus(path.join(here, "../engine"));
let fail = 0, intended = 0;
if (probes.length !== golden.length) { console.log(`FAIL probe count ${probes.length} != golden ${golden.length}`); process.exit(1); }
for (let i = 0; i < golden.length; i++) {
  const g = golden[i], p = probes[i];
  if (g.id !== p.id || g.kind !== p.kind) { console.log(`FAIL walk diverged at #${i}: ${g.id} vs ${p.id}`); process.exit(1); }
  if (g.h === p.h) continue;
  if (INTENDED[g.id]) { intended++; continue; }
  if (fail++ < 10) console.log(`FAIL ${g.kind} ${g.id}`);
}
console.log(`${fail ? "FAIL" : "ok"}  fork equivalence: ${golden.length - fail - intended}/${golden.length} identical, ${intended} intended, ${fail} unexplained`);
process.exit(fail ? 1 : 0);
