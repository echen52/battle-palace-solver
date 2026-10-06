// The page (site/), in a real headless Chromium, against the engine.
//
// Serves palace-solver/ over http (the page imports ../engine/*.js as ES
// modules and runs Web Workers, so file:// will not do), and drives the page
// through its own controls: paste the user's team, pick the opponent, press
// Solve. The expected answer is solveFight run here in Node on the same
// position (ui-logic.js buildFight) -- a page that builds the position
// differently, or whose workers solve differently, fails. Plus: the "this
// turn" bars equal turnChoices, a saved team survives a reload, and no page
// error at any point.
//
// Playwright comes from the Arena solver's install (battle_arena_assistant/
// battle_arena_sim/node_modules), whose Chromium is already downloaded.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const require = createRequire(path.resolve(ROOT, "../battle_arena_assistant/battle_arena_sim/package.json"));
const { chromium } = require("playwright");
const U = await import(pathToFileURL(path.join(ROOT, "site/ui-logic.js")).href);
const MP = await import(pathToFileURL(path.join(ROOT, "engine/montecarlo-parallel.js")).href);
const N = await import(pathToFileURL(path.join(ROOT, "engine/next-in.js")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] ?? "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const TEAM = fs.readFileSync(path.join(ROOT, "teams/user-test-team.txt"), "utf8");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${base}/site/index.html`);
  ok(errors.length === 0, `loads with no error (${errors.join("; ")})`);

  // Your team, the opponent, the bracket.
  await page.fill("#teamText", TEAM);
  await page.click("#parseTeam");
  ok(await page.locator(".mon-card").count() === 3, "three mon cards after 'Use team'");
  await page.selectOption("#challenge", "3");
  await page.selectOption("#battle", "7");
  ok(await page.inputValue("#brain") === "Spenser Silver", "challenge 3 battle 7 picks Spenser Silver by default");
  await page.selectOption("#brain", ""); // a normal trainer (as when you hold Silver but not Gold)
  await page.fill("#oppSet", "Salamence 1");
  await page.dispatchEvent("#oppSet", "change");
  await page.waitForTimeout(400);
  ok(await page.locator("#oppCard").isVisible() && (await page.textContent("#oppCard")).includes("Salamence 1"), "the set card shows the picked set");
  ok((await page.locator("#oppIv option").first().textContent()).startsWith("12"), "IVs default to the bracket's tier (12 for challenge 3, battle 7)");
  ok(await page.locator("#oppAbilityRow").isHidden(), "one-ability set: no ability picker");

  // The set dropdown: focus lists the bracket's sets, typing narrows (names
  // starting with the text first), Enter takes the top match, arrows move,
  // junk text is put back to the last set on leaving.
  await page.click("h1"); await page.waitForTimeout(300); // leave the box fill() typed into
  await page.click("#oppSet");
  const listed = await page.locator("#oppSetList .combo-item").count();
  ok(listed === U.setChoices({ challenge: 3, battle: 7 }).length, `focus lists the bracket's ${listed} sets`);
  // search text: the first 4 letters of a species with 2+ sets in this bracket
  const labels = U.setChoices({ challenge: 3, battle: 7 }).map(U.setLabel);
  const q = labels.map((l) => l.slice(0, 4)).find((p4, _, all) => all.filter((x) => x === p4).length >= 2);
  await page.keyboard.type(q.toLowerCase());
  const narrowed = await page.$$eval("#oppSetList .combo-item", (e) => e.map((x) => x.textContent));
  ok(narrowed.length > 0 && narrowed.length >= 2 && narrowed.every((t) => t.toLowerCase().includes(q.toLowerCase())) && narrowed[0].startsWith(q), `typing "${q.toLowerCase()}" narrows: ${narrowed.join(", ")}`);
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  ok(await page.inputValue("#oppSet") === narrowed[1] && (await page.textContent("#oppCard")).includes(narrowed[1]) && await page.locator("#oppSetList.open").count() === 0, `arrows + Enter pick ${narrowed[1]}, card follows, list closes`);
  await page.click("#oppSet"); await page.keyboard.type("zzz");
  ok((await page.textContent("#oppSetList")).includes("No matches"), "no match says so");
  await page.click("h1"); await page.waitForTimeout(300);
  ok(await page.inputValue("#oppSet") === narrowed[1], "leaving with junk puts the last set back");
  await page.click("#oppSet"); await page.keyboard.type("salamence 1"); await page.keyboard.press("Enter"); await page.waitForTimeout(400); // the bars redraw 120 ms after a change
  ok(await page.inputValue("#oppSet") === "Salamence 1" && (await page.textContent("#oppCard")).includes("Salamence 1"), "Enter alone takes the top match");

  // This turn's bars = turnChoices on the same position.
  const zero = Object.fromEntries(U.STAGE_KEYS.map((k) => [k, 0]));
  const cfgs = U.parseTeam(TEAM);
  const form = { team: cfgs, active: 0, mons: cfgs.map(() => ({ hpPct: 100, status: "", toxicTurns: 1, sleep: { rest: false, slept: 0 }, itemGone: false })),
    you: { stages: zero, confused: 0, subPct: 0, lowHp: null },
    opp: { setKey: "Salamence 1", ability: null, ivTier: 12, hpPct: 100, status: "", toxicTurns: 1, sleep: { rest: false, slept: 0 }, itemGone: false, stages: zero, confused: 0, firstTurn: true, lowHp: null },
    field: { weather: "", weatherTurns: null, you: { spikes: 0 }, opp: { spikes: 0 } }, run: { challenge: 3, battle: 7, oppIndex: 1 } };
  const fight = U.buildFight(form);
  const ch = U.turnChoices(fight.tctx, fight.start);
  const bars = await page.$$eval("#oppChoices .cb-row", (rows) => rows.map((r) => [r.querySelector("span").textContent, r.querySelector(".cb-p").textContent]));
  ok(bars.length > 0 && bars.every(([m, p], i) => m === ch.opp[i].move && p === U.pct(ch.opp[i].p)), `opponent's bars = turnChoices (${bars.map((b) => b.join(" ")).join(", ")})`);

  // Solve in the page vs solveFight in Node.
  await page.selectOption("#budget", "30000");
  await page.click("#solveBtn");
  await page.waitForFunction(() => /playouts · /.test(document.getElementById("progress").textContent) && !document.getElementById("solveBtn").disabled, null, { timeout: 120000 });
  ok(errors.length === 0, `the solve ran with no error (${errors.join("; ")})`);
  const rows = await page.$$eval("#optionsTable tbody tr", (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
  const verdict = await page.textContent("#verdict");
  const nodeRun = await MP.solveFight({ ...fight.tctx, nextIn: N.makeNextIn(fight.tctx.nextInSpec) }, fight.start, { budgetMs: 30000 });
  const nodeRows = U.resultRows(nodeRun.levers, fight.labels);
  ok(rows.length === 3 && rows[0][0].replace("★ ", "").replace(" *", "") === nodeRows[0].label, `page's best (${rows[0][0]}) = Node's best (${nodeRows[0].label}); verdict "${verdict}"`);
  const pageScore = (r) => Number(r[1].split(" ")[0]), pageMargin = (r) => Number(r[1].split("±")[1]);
  const agree = nodeRows.every((nr) => {
    const pr = rows.find((r) => r[0].includes(nr.label));
    return pr && Math.abs(pageScore(pr) - nr.score) <= pageMargin(pr) + nr.margin + 0.002;
  });
  ok(agree, `every choice's score agrees within the two margins (page ${rows.map((r) => r[1]).join(" | ")}; node ${nodeRows.map((r) => `${r.score.toFixed(3)}±${r.margin.toFixed(3)}`).join(" | ")})`);

  // Stop works mid-solve.
  await page.selectOption("#budget", "120000");
  await page.click("#solveBtn");
  await page.waitForFunction(() => /playouts · .*s…/.test(document.getElementById("progress").textContent), null, { timeout: 60000 });
  await page.click("#stopBtn");
  await page.waitForFunction(() => /stopped/.test(document.getElementById("progress").textContent), null, { timeout: 30000 });
  ok(true, "Stop ends a running solve");

  // Spenser: challenge 6, battle 7 is his Gold battle -- picked for you, his
  // lead filled in, his IVs fixed; the page's solve (his team's next-in in the
  // workers) agrees with Node's on the same position.
  await page.selectOption("#challenge", "6"); await page.selectOption("#battle", "7"); await page.waitForTimeout(400);
  ok(await page.inputValue("#brain") === "Spenser Gold" && await page.inputValue("#oppSet") === "Spenser Gold Arcanine"
    && (await page.textContent("#oppIv")).startsWith("31 (fixed") && await page.locator("#bracketRow").isHidden(), "challenge 6 battle 7: Spenser Gold, Arcanine, IV 31 fixed");
  await page.click("#oppSet");
  ok((await page.$$eval("#oppSetList .combo-item", (e) => e.map((x) => x.textContent))).join() === "Spenser Gold Arcanine,Spenser Gold Slaking,Spenser Gold Suicune", "the list is his three");
  await page.click("h1");
  await page.selectOption("#oppAbility", "Intimidate"); await page.selectOption("#budget", "30000");
  await page.click("#solveBtn");
  await page.waitForFunction(() => /playouts · /.test(document.getElementById("progress").textContent) && !document.getElementById("solveBtn").disabled, null, { timeout: 120000 });
  const bRows = await page.$$eval("#optionsTable tbody tr", (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
  const bForm = { ...form, opp: { ...form.opp, setKey: "Spenser Gold Arcanine", ability: "Intimidate", ivTier: 31 }, run: { challenge: 6, battle: 7, oppIndex: 1, brain: "Spenser Gold" } };
  const bFight = U.buildFight(bForm);
  const bNode = U.resultRows((await MP.solveFight({ ...bFight.tctx, nextIn: N.makeNextIn(bFight.tctx.nextInSpec) }, bFight.start, { budgetMs: 30000 })).levers, bFight.labels);
  ok(bRows.length === 3 && bNode.every((nr) => { const pr = bRows.find((r) => r[0].includes(nr.label)); return pr && Math.abs(pageScore(pr) - nr.score) <= pageMargin(pr) + nr.margin + 0.002; }),
    `vs Spenser's Arcanine the page agrees with Node (page ${bRows.map((r) => `${r[0]} ${r[1]}`).join(" | ")}; node ${bNode.map((r) => `${r.label} ${r.score.toFixed(3)}±${r.margin.toFixed(3)}`).join(" | ")})`);
  await page.selectOption("#battle", "6"); await page.waitForTimeout(400);
  ok(await page.inputValue("#brain") === "" && await page.inputValue("#oppSet") === "" && await page.locator("#bracketRow").isVisible(), "battle 6: Brain off, his set cleared");

  // A saved team survives a reload.
  await page.fill("#teamName", "test team");
  await page.click("#saveTeam");
  await page.reload();
  ok(await page.locator('#savedTeams option[value="test team"]').count() === 1, "the saved team is listed after a reload");
  await page.selectOption("#savedTeams", "test team");
  ok(await page.locator(".mon-card").count() === 3, "picking it loads the team");
  ok(errors.length === 0, `no page error at any point (${errors.join("; ")})`);
} finally {
  await browser.close();
  server.close();
}
console.log(`test-site-browser: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
