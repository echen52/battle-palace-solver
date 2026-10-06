// ── sim/screen.mjs ─────────────────────────────────────────────────────────
// The cheap screen (sim/screen-core.mjs) over many battles, in parallel:
//   node sim/screen.mjs --team teams/x.txt --battles 1000 --seed 1 \
//        --policy stay|type --out results/screen/x-stay.jsonl [--workers 12]
// Writes one JSON line per battle, in battle order (a fresh file each run).
// Summaries: node sim/compare.mjs a.jsonl b.jsonl (counters included).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { makeScreen } from "./screen-core.mjs";

if (!isMainThread) {
  const { teamText, seed, policy, indices } = workerData;
  const sc = makeScreen({ teamText, seed });
  for (const i of indices) {
    let line;
    try { line = sc.playBattle(i, policy); } catch (e) { line = { i, result: "error", error: e.message.slice(0, 200) }; }
    parentPort.postMessage(line);
  }
} else {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
  if (!args.team || !args.out) throw new Error("usage: --team <file> --out <jsonl> [--battles N --seed S --policy stay|type --workers w]");
  const BATTLES = Number(args.battles ?? 1000), SEED = Number(args.seed ?? 1), POLICY = args.policy ?? "stay";
  const W = Math.min(Number(args.workers ?? Math.max(1, os.cpus().length - 2)), BATTLES);
  const teamText = fs.readFileSync(args.team, "utf8");
  makeScreen({ teamText, seed: SEED }); // read the team once here: a bad file fails before any worker starts
  const t0 = Date.now();
  const lines = new Array(BATTLES);
  await Promise.all(Array.from({ length: W }, (_, w) => new Promise((resolve, reject) => {
    const indices = []; for (let i = w; i < BATTLES; i += W) indices.push(i);
    const wk = new Worker(new URL(import.meta.url), { workerData: { teamText, seed: SEED, policy: POLICY, indices }, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
    wk.on("message", (l) => { lines[l.i] = l; });
    wk.on("error", reject);
    wk.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker ${w} exited ${code}`))));
  })));
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const wins = lines.filter((l) => l.result === "win").length, errs = lines.filter((l) => l.result === "error").length;
  console.log(`${path.basename(args.team)} [${POLICY}]: ${BATTLES} battles, ${wins} won, ${errs} errors, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
