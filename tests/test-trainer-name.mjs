// The trainer titles on the sim's logs (sim/trainer-name.mjs) against the
// decomp: hand-read examples (battle_frontier_trainers.h -> facility class ->
// gFacilityClassToTrainerClass -> gTrainerClassNames), every one of the 300
// trainers resolved through the class tables (none falls back to its raw
// facility-class name), Spenser, and the log label.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { trainerName, trainerLabel } = await import(pathToFileURL(path.join(here, "../sim/trainer-name.mjs")).href);
const { FRONTIER_TRAINERS } = await import(pathToFileURL(path.join(here, "../engine/frontier-trainers.js")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

// hand-read: FRONTIER_TRAINER_BRADY (YOUNGSTER), MIRIAM (COOLTRAINER_F ->
// TRAINER_CLASS_COOLTRAINER "COOLTRAINER"), NELSON (PKMN_RANGER_M ->
// "{PKMN} RANGER"), JOYCE (SWIMMER_F -> "SWIMMER♀"), MIRANDA (EXPERT_F ->
// "EXPERT"), ABBY (AROMA_LADY)
for (const [id, want] of [[0, "Youngster Brady"], [225, "Cooltrainer Miriam"], [230, "Pkmn Ranger Nelson"],
  [211, "Swimmer♀ Joyce"], [247, "Expert Miranda"], [298, "Aroma Lady Abby"]]) {
  ok(trainerName(id) === want, `trainer ${id}: ${trainerName(id)} (want ${want})`);
}
// a facility class with no entry would print its raw name, e.g. "Cooltrainer F"
const raw = FRONTIER_TRAINERS.filter((t, i) => / [MF] /.test(trainerName(i)) || trainerName(i).includes("_"));
ok(FRONTIER_TRAINERS.length === 300 && raw.length === 0, `all 300 through the class tables (${raw.length} raw)`);
ok(trainerName("Spenser Gold") === "Palace Maven Spenser (Gold)" && trainerName("Spenser Silver") === "Palace Maven Spenser (Silver)", "Spenser");
ok(trainerLabel(225) === "225 Cooltrainer Miriam" && trainerLabel("Spenser Gold") === "Palace Maven Spenser (Gold)", "log label");

console.log(`test-trainer-name: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
