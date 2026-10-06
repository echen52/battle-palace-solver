// sim/legal.mjs against the decomp's learnsets: the user's team files are all
// Emerald-legal, with the sources a hand look-up gives (Swampert's Curse is a
// Mudkip egg move, Registeel's Curse is level-up at 17, Snorlax's an egg move,
// Heracross's Rock Slide a tutor), and an impossible move is refused.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const G = await import(pathToFileURL(path.join(here, "../sim/legal.mjs")).href);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const has = (sp, mv, src) => G.sourcesOf(sp, mv).some((x) => x.startsWith(src));

ok(has("Swampert", "Curse", "egg (as MUDKIP)") && G.sourcesOf("Swampert", "Curse").length === 1, "Swampert's Curse: only as a Mudkip egg move");
ok(has("Registeel", "Curse", "level-up") && has("Snorlax", "Curse", "egg") && has("Heracross", "Rock Slide", "tutor"), "Registeel Curse level-up, Snorlax Curse egg, Heracross Rock Slide tutor");
ok(has("Metagross", "Meteor Mash", "level-up") && has("Metagross", "Earthquake", "TM/HM") && has("Slaking", "Double-Edge", "tutor (as SLAKOTH)"), "level-up, TM and a pre-evolution's tutor");
ok(G.sourcesOf("Snorlax", "Spore").length === 0 && G.sourcesOf("Latios", "Curse").length === 0, "Spore on Snorlax and Curse on Latios: no source");
let threw = false; try { G.sourcesOf("Missingmon", "Tackle"); } catch { threw = true; }
ok(threw, "an unknown species is refused");
for (const f of ["teams/user-test-team.txt", "teams/mlsuicune.txt", "teams/cb/all-sets.txt"]) {
  let code = 0; try { execFileSync("node", [path.join(here, "../sim/legal.mjs"), path.join(here, "..", f)], { stdio: "pipe" }); } catch (e) { code = e.status; }
  ok(code === 0, `${f}: every move Emerald-legal`);
}
console.log(`test-legal: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
