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

// id -> reason. Each class was attributed by neutralising its fix alone and
// re-running: the listed probes, and only they, return to the golden hash.
const PROTECT_RESET = "Cmd_setprotectlike resets protectUses when the last RESULTING move was not " +
  "Protect/Detect/Endure (src/battle_script_commands.c:6494-6501); the Arena engine never reset it";
const INTENDED = {
  "340:Walrein 1|Cloyster 1:t3:Blizzard/Protect": PROTECT_RESET,
  "439:Porygon2 4|Electrode 1:t3:Psychic/Protect": PROTECT_RESET,
  "688:Regice 2|Golduck 3:t3:Brick Break/Protect": PROTECT_RESET,
  "723:Squirtle 1|Cloyster 1:t3:Protect/Protect": PROTECT_RESET,
  "774:Wailmer 1|Kabuto 1:t3:Rollout/Protect": PROTECT_RESET,
  "931:Armaldo 1|Arcanine 2:t3:Protect/Crunch": PROTECT_RESET,
  "958:Forretress 3|Hitmonchan 2:t3:Zap Cannon/Detect": PROTECT_RESET,
  "967:Hariyama 4|Sceptile 1:t3:Fake Out/Detect": PROTECT_RESET,
  "1002:Blissey 3|Houndour 1:t3:Fire Blast/Protect": PROTECT_RESET,
  "1028:Gardevoir 8|Cloyster 1:t3:Psychic/Protect": PROTECT_RESET,
  "1117:Machamp 1|Salamence 2:t3:Rock Slide/Protect": PROTECT_RESET,
  "1156:Shelgon 1|Wigglytuff 2:t3:Protect/Fake Tears": PROTECT_RESET,
  "1190:Togepi 1|Lairon 2:t3:Yawn/Protect": PROTECT_RESET,
  "1220:Scizor 3|Azumarill 1:t3:Endure/Protect": PROTECT_RESET,
  "1227:Medicham 2|Relicanth 1:t3:Endure/Water Pulse": PROTECT_RESET,
  "1421:Relicanth 2|Articuno 3:t3:Amnesia/Protect": PROTECT_RESET,
};

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
