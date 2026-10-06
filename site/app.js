// ── app.js ─────────────────────────────────────────────────────────────────
// The page's DOM wiring. All battle logic is in ui-logic.js (pure) and the
// engine; the solve runs in Web Workers (solver.js).

import { parseTeam, setChoices, setLabel, ivTierOdds, buildOpponent, buildFight, turnChoices, resultRows, verdict, pct, STAGE_KEYS, brainFor } from "./ui-logic.js";
import { solveInBrowser } from "./solver.js";
import { FRONTIER_POOL } from "../engine/frontier-pool.js";
import { palaceMoveGroup, GROUP_NAMES } from "../engine/palace.js";
import { buildPlayerMon } from "../engine/team.js";

const $ = (id) => document.getElementById(id);
const STORE = "palaceSolver.savedTeams";
const STAGE_LABEL = { atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe", accuracy: "Acc", evasion: "Eva" };
const STATUS_OPTIONS = [["", "Healthy"], ["poison", "Poison"], ["toxic", "Bad poison"], ["burn", "Burn"], ["paralysis", "Paralysis"], ["sleep", "Sleep"], ["freeze", "Freeze"]];

let teamCfgs = null;      // parsed configs
let monState = [];        // per team member: { hpPct, status, toxicTurns, sleepRest, slept, itemGone }
let active = 0;
let solving = null;       // AbortController while a solve runs
const labelToKey = new Map();

// ── small builders ─────────────────────────────────────────────────────────
const opt = (v, t, sel = false) => `<option value="${v}"${sel ? " selected" : ""}>${t}</option>`;
function stageGrid(el, prefix) {
  el.innerHTML = STAGE_KEYS.map((k) => `<span>${STAGE_LABEL[k]}</span><select class="trigger" id="${prefix}-${k}">${
    Array.from({ length: 13 }, (_, i) => i - 6).map((v) => opt(v, v > 0 ? `+${v}` : `${v}`, v === 0)).join("")}</select>`).join("");
}
const readStages = (prefix) => Object.fromEntries(STAGE_KEYS.map((k) => [k, Number($(`${prefix}-${k}`).value)]));
function statusRows(prefix) {
  return `<div class="field-row"><label for="${prefix}-status">Status</label><select class="trigger" id="${prefix}-status">${
    STATUS_OPTIONS.map(([v, t]) => opt(v, t)).join("")}</select></div>
  <div class="field-row" id="${prefix}-sleepRow" hidden><label title="The game hides how long a sleep lasts; the solve averages over every length still possible.">Asleep</label>
    <select class="trigger" id="${prefix}-sleepFrom">${opt("move", "from a move")}${opt("rest", "from Rest")}</select>
    <select class="trigger" id="${prefix}-slept">${[0, 1, 2, 3].map((n) => opt(n, `${n} turn${n === 1 ? "" : "s"} slept`)).join("")}</select></div>
  <div class="field-row" id="${prefix}-toxicRow" hidden><label>Bad poison</label>
    <select class="trigger" id="${prefix}-toxic">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => opt(n, n === 1 ? "next hit: 1/16" : `next hit: ${n}/16`)).join("")}</select></div>`;
}
function syncStatusRows(prefix) {
  const st = $(`${prefix}-status`).value;
  $(`${prefix}-sleepRow`).hidden = st !== "sleep";
  $(`${prefix}-toxicRow`).hidden = st !== "toxic";
}
function sideRows(el, side) {
  el.innerHTML = `
    <div class="field-row"><input type="checkbox" class="trigger" id="${side}-reflect" /><label for="${side}-reflect" class="chk-label">Reflect</label>
      <select class="trigger" id="${side}-reflectTurns">${[5, 4, 3, 2, 1].map((n) => opt(n, `${n} left`)).join("")}</select></div>
    <div class="field-row"><input type="checkbox" class="trigger" id="${side}-ls" /><label for="${side}-ls" class="chk-label">Light Screen</label>
      <select class="trigger" id="${side}-lsTurns">${[5, 4, 3, 2, 1].map((n) => opt(n, `${n} left`)).join("")}</select></div>
    <div class="field-row"><label for="${side}-spikes">Spikes</label><select class="trigger" id="${side}-spikes">${[0, 1, 2, 3].map((n) => opt(n, n ? `${n} layer${n > 1 ? "s" : ""}` : "None")).join("")}</select></div>`;
}

// ── your team ──────────────────────────────────────────────────────────────
function loadSaved() { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } }
function storeSaved(m) { try { localStorage.setItem(STORE, JSON.stringify(m)); } catch { /* private mode: not kept */ } }
function refreshSaved(select = "") {
  const m = loadSaved();
  $("savedTeams").innerHTML = opt("", "— Select a saved team —") + Object.keys(m).sort().map((k) => opt(k, k, k === select)).join("");
}
function useTeam(text) {
  $("teamError").textContent = "";
  try {
    teamCfgs = parseTeam(text);
    teamCfgs.forEach((c) => buildPlayerMon(c)); // fail on an unknown species / move now
  } catch (e) {
    teamCfgs = null; $("teamError").textContent = e.message; renderTeam(); return;
  }
  monState = teamCfgs.map(() => ({ hpPct: 100, status: "", toxicTurns: 1, sleepRest: false, slept: 0, itemGone: false }));
  active = 0;
  renderTeam();
  refresh();
}
function renderTeam() {
  const box = $("monCards");
  if (!teamCfgs) { box.innerHTML = ""; $("activeBlock").hidden = true; return; }
  box.innerHTML = teamCfgs.map((c, i) => `
    <div class="mon-card${i === active ? " out" : ""}" data-i="${i}">
      <div class="mc-head">
        <input type="radio" name="outMon" class="out-radio" id="out-${i}" value="${i}"${i === active ? " checked" : ""} />
        <label for="out-${i}" class="mc-name">${c.species}</label>
        <span class="mc-meta">${c.item ?? "no item"} · ${c.nature}</span>
      </div>
      <div class="field-row"><label for="m${i}-hp">HP %</label><input type="number" class="trigger" id="m${i}-hp" min="0" max="100" value="${monState[i].hpPct}" /><span class="hp-abs" id="m${i}-hpAbs"></span></div>
      ${statusRows(`m${i}`)}
      <div class="field-row"><input type="checkbox" class="trigger" id="m${i}-itemGone" /><label for="m${i}-itemGone" class="chk-label">Item used up</label></div>
    </div>`).join("");
  teamCfgs.forEach((_, i) => {
    $(`m${i}-status`).value = monState[i].status;
    $(`m${i}-itemGone`).checked = monState[i].itemGone;
    syncStatusRows(`m${i}`);
  });
  $("activeBlock").hidden = false;
  $("activeName").textContent = teamCfgs[active].species;
}
function readMons() {
  return teamCfgs.map((_, i) => ({
    hpPct: Math.max(0, Math.min(100, Number($(`m${i}-hp`).value) || 0)),
    status: $(`m${i}-status`).value,
    toxicTurns: Number($(`m${i}-toxic`).value),
    sleep: { rest: $(`m${i}-sleepFrom`).value === "rest", slept: Number($(`m${i}-slept`).value) },
    itemGone: $(`m${i}-itemGone`).checked,
  }));
}

// ── the opponent ───────────────────────────────────────────────────────────
function runInputs() {
  return { challenge: Number($("challenge").value), battle: Number($("battle").value),
    oppIndex: Number(document.querySelector('input[name="oppIndex"]:checked').value), brain: $("brain").value || null };
}
function refreshSetList() {
  const { challenge, battle, brain } = runInputs();
  const keys = setChoices({ challenge, battle, bracketOnly: $("bracketOnly").checked, brain });
  $("bracketRow").hidden = !!brain;
  labelToKey.clear();
  setLabels = keys.map((k) => { labelToKey.set(setLabel(k), k); return setLabel(k); });
  // keep every set resolvable by name even when filtered out of the list
  for (const k of Object.keys(FRONTIER_POOL)) if (!labelToKey.has(setLabel(k))) labelToKey.set(setLabel(k), k);
}
const keyOf = (label) => labelToKey.get(label.trim()) ?? null;
let setLabels = [];
const combos = {};

// Spenser on/off (by hand, or because the challenge/battle is his): the list
// becomes his three; the set box gets his lead when you face their 1st, and is
// cleared when it holds a set that no longer fits (his lead as 2nd/3rd, or a
// Brain set once the Brain is off).
function brainChanged() {
  const { brain, oppIndex } = runInputs();
  refreshSetList();
  const cur = keyOf($("oppSet").value);
  if (brain && oppIndex === 1) combos.oppSet.set(setLabels[0]); // his lead is always slot 0
  else if (cur && (brain ? setLabels.indexOf(setLabel(cur)) < 1 : FRONTIER_POOL[cur].brain)) combos.oppSet.set("");
  $("leadRow").hidden = oppIndex !== 2 || !!brain;
  renderOppSet();
}

// Filtering dropdown for the set pickers (as on the Arena page): focus shows
// the whole list, typing narrows it (names starting with the text first),
// arrows + Enter or a click pick (Enter alone takes the top match), Escape
// closes. Picking fires a real
// "change" on the input, so the usual listeners run; leaving with text that
// is not a set puts back the last set picked.
function setupCombo(inputId, listId) {
  const input = $(inputId), list = $(listId);
  let hi = -1, last = input.value;
  combos[inputId] = { set: (v) => { input.value = v; last = v; } }; // set from code, no "change"
  const close = () => { list.classList.remove("open"); list.innerHTML = ""; hi = -1; };
  const choose = (v) => { input.value = v; last = v; close(); input.dispatchEvent(new Event("change", { bubbles: true })); };
  const mark = (items) => { items.forEach((el, i) => el.classList.toggle("hi", i === hi)); if (hi >= 0) items[hi].scrollIntoView({ block: "nearest" }); };
  function render(all) {
    const q = all ? "" : input.value.trim().toLowerCase();
    const starts = setLabels.filter((o) => o.toLowerCase().startsWith(q));
    const rest = q ? setLabels.filter((o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q)) : [];
    const matches = starts.concat(rest);
    hi = -1;
    list.innerHTML = matches.length ? matches.map((o) => `<div class="combo-item${o === last ? " cur" : ""}" data-value="${o}">${o}</div>`).join("")
      : '<div class="combo-empty">No matches</div>';
    list.classList.add("open");
    list.querySelectorAll(".combo-item").forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); choose(el.dataset.value); }));
    list.querySelector(".cur")?.scrollIntoView({ block: "nearest" });
  }
  input.addEventListener("focus", () => { input.select(); render(true); });
  input.addEventListener("click", () => { if (!list.classList.contains("open")) { input.select(); render(true); } }); // already focused
  input.addEventListener("input", () => render(false));
  input.addEventListener("keydown", (e) => {
    const items = list.querySelectorAll(".combo-item");
    if (e.key === "ArrowDown") { e.preventDefault(); if (!list.classList.contains("open")) render(true); else { hi = Math.min(hi + 1, items.length - 1); mark(items); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); hi = Math.max(hi - 1, -1); mark(items); }
    else if (e.key === "Enter") { const v = (items[hi] ?? items[0])?.dataset.value; if (v) { e.preventDefault(); choose(v); } }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(() => {
    close();
    if (input.value !== last && !keyOf(input.value)) { input.value = last; input.dispatchEvent(new Event("change", { bubbles: true })); }
    else last = input.value;
  }, 150));
}
function renderOppSet() {
  const key = keyOf($("oppSet").value);
  const e = key ? FRONTIER_POOL[key] : null;
  $("oppCard").hidden = !e; $("oppAbilityRow").hidden = !e || e.abilities.length < 2; $("oppIvRow").hidden = !e;
  if (!e) return;
  $("oppCard").innerHTML = `<div class="sc-title">${setLabel(key)}</div>
    <div class="sc-meta"><b>${e.item ?? "no item"}</b> · <b>${e.nature}</b> · ${e.abilities.join(" / ")}</div>
    <div class="sc-meta">${e.moves.map((m) => `${m} <span class="pm">${GROUP_NAMES[palaceMoveGroup(m)]}</span>`).join(" · ")}</div>`;
  const prevAb = $("oppAbility").value;
  $("oppAbility").innerHTML = e.abilities.map((a) => opt(a, a, a === prevAb)).join("");
  const odds = ivTierOdds(key, runInputs());
  const prevIv = $("oppIv").value;
  if (e.brain) { $("oppIv").innerHTML = opt(e.fixedIV, `${e.fixedIV} (fixed: Frontier Brain)`, true); return; }
  const tiers = odds.length ? odds : (e.ivTiers ?? [31]).map((iv) => ({ iv, p: null }));
  $("oppIv").innerHTML = tiers.map((t, i) => opt(t.iv, `${t.iv}${t.p != null ? ` (${pct(t.p)}${i === 0 ? ", most likely" : ""})` : ""}`, String(t.iv) === prevIv)).join("");
}

// ── the form ───────────────────────────────────────────────────────────────
const tri = (v) => (v === "on" ? true : v === "off" ? false : null);
function readForm() {
  if (!teamCfgs) throw new Error("Paste your team and press “Use team”.");
  const oppKey = keyOf($("oppSet").value);
  if (!oppKey) throw new Error("Pick the opponent's set.");
  const run = runInputs();
  if (run.oppIndex === 2 && !run.brain) run.leadKey = keyOf($("leadSet").value);
  const side = (s) => ({ reflect: $(`${s}-reflect`).checked, reflectTurns: Number($(`${s}-reflectTurns`).value),
    lightScreen: $(`${s}-ls`).checked, lightScreenTurns: Number($(`${s}-lsTurns`).value), spikes: Number($(`${s}-spikes`).value) });
  return {
    team: teamCfgs, active, mons: readMons(),
    you: { stages: readStages("ys"), confused: Number($("youConfused").value), subPct: Number($("youSub").value) || 0, lowHp: tri($("youLowHp").value) },
    opp: { setKey: oppKey, ability: $("oppAbility").value || null, ivTier: Number($("oppIv").value) || 31,
      hpPct: Math.max(1, Math.min(100, Number($("oppHp").value) || 100)),
      status: $("o-status").value, toxicTurns: Number($("o-toxic").value),
      sleep: { rest: $("o-sleepFrom").value === "rest", slept: Number($("o-slept").value) },
      itemGone: $("oppItemGone").checked, stages: readStages("os"), confused: Number($("oppConfused").value),
      firstTurn: $("oppFirstTurn").checked, lowHp: tri($("oppLowHp").value) },
    field: { weather: $("weather").value, weatherTurns: $("weatherTurns").value ? Number($("weatherTurns").value) : null, you: side("you"), opp: side("opp") },
    run,
  };
}

// HP numbers next to the % boxes, and this turn's choices -- cheap, so on every change.
let fight = null;
function refresh() {
  $("solveError").textContent = "";
  if (teamCfgs) teamCfgs.forEach((c, i) => {
    const mon = buildPlayerMon(c);
    const hp = Math.max(0, Math.min(100, Number($(`m${i}-hp`).value) || 0));
    $(`m${i}-hpAbs`).textContent = `${Math.round((hp / 100) * mon.stats.hp)}/${mon.stats.hp}`;
  });
  try {
    const key = keyOf($("oppSet").value);
    if (key) {
      const o = buildOpponent({ setKey: key, ability: $("oppAbility").value || null, ivTier: Number($("oppIv").value) || 31 });
      $("oppHpAbs").textContent = `${Math.round(((Number($("oppHp").value) || 100) / 100) * o.stats.hp)}/${o.stats.hp}`;
    }
    fight = buildFight(readForm());
    const ch = turnChoices(fight.tctx, fight.start);
    for (const side of ["you", "opp"]) {
      $(`${side}Choices`).innerHTML = ch[side].slice(0, 8).map((r) => `<div class="cb-row"><div class="cb-name"><div class="cb-fill" style="width:${(100 * r.p).toFixed(1)}%"></div><span>${r.move}</span></div><div class="cb-p">${pct(r.p)}</div></div>`).join("");
    }
    $("notes").textContent = fight.notes.join(" ");
  } catch (e) {
    fight = null;
    $("youChoices").innerHTML = ""; $("oppChoices").innerHTML = "";
    $("notes").textContent = e.message;
  }
}

// ── solving ────────────────────────────────────────────────────────────────
function renderResults(levers, info) {
  const rows = resultRows(levers, fight.labels);
  const v = verdict(rows, info);
  $("verdict").textContent = v;
  $("verdict").classList.toggle("tie", rows.some((r) => r.tie));
  $("optionsTable").querySelector("tbody").innerHTML = rows.map((r) => `<tr class="${r.best ? "best" : r.tie ? "tie" : ""}">
    <td>${r.best ? "★ " : ""}${r.label}${r.exactFirstTurn ? "" : ' <span class="pm" title="A move that hits 3-5 times, or too many damage rolls: this turn was played out by the playouts too.">*</span>'}</td>
    <td>${r.score.toFixed(3)} <span class="pm">±${Number.isFinite(r.margin) ? r.margin.toFixed(3) : "?"}</span></td>
    <td>${pct(r.pKO)}</td><td>${pct(r.pOppLeft)}</td><td>${pct(r.pLose, 1)}</td><td>${r.turns.toFixed(1)}</td></tr>`).join("");
  const n = rows.reduce((a, r) => a + r.rollouts, 0);
  const why = { separated: "one choice is clearly best", budget: "time limit reached", stopped: "stopped", exact: "solved exactly" }[info.stoppedBy];
  $("progress").textContent = info.done ? `${n.toLocaleString()} playouts · ${why ?? ""}` : `${n.toLocaleString()} playouts · ${(info.ms / 1000).toFixed(1)} s…`;
}
async function solve() {
  refresh();
  if (!fight) { $("solveError").textContent = $("notes").textContent; return; }
  solving = new AbortController();
  $("solveBtn").disabled = true; $("stopBtn").disabled = false;
  $("verdict").textContent = "Solving…"; $("verdict").classList.remove("tie");
  $("progress").textContent = "Working out the first turn exactly…";
  $("optionsTable").querySelector("tbody").innerHTML = "";
  let pending = null;
  try {
    const r = await solveInBrowser(fight, {
      budgetMs: Number($("budget").value), signal: solving.signal,
      onProgress: (levers, info) => {
        if (info.done) { renderResults(levers, info); return; }
        if (!pending) pending = requestAnimationFrame(() => { pending = null; renderResults(levers, info); });
      },
    });
    if (pending) cancelAnimationFrame(pending);
    renderResults(r.levers, { done: true, stoppedBy: r.stoppedBy });
  } catch (e) {
    $("verdict").textContent = "—";
    $("solveError").textContent = `The solve stopped: ${e.message}`;
  } finally {
    solving = null;
    $("solveBtn").disabled = false; $("stopBtn").disabled = true;
  }
}

// ── start ──────────────────────────────────────────────────────────────────
function init() {
  $("challenge").innerHTML = Array.from({ length: 8 }, (_, i) => opt(i + 1, i === 7 ? "8+" : String(i + 1))).join("");
  $("battle").innerHTML = Array.from({ length: 7 }, (_, i) => opt(i + 1, String(i + 1))).join("");
  stageGrid($("youStages"), "ys"); stageGrid($("oppStages"), "os");
  $("oppStatusRows").innerHTML = statusRows("o");
  sideRows($("youSide"), "you"); sideRows($("oppSide"), "opp");
  refreshSaved(); refreshSetList();
  setupCombo("oppSet", "oppSetList"); setupCombo("leadSet", "leadSetList");

  $("parseTeam").addEventListener("click", () => useTeam($("teamText").value));
  $("saveTeam").addEventListener("click", () => {
    const name = $("teamName").value.trim();
    if (!name) { $("teamError").textContent = "Give the team a name to save it."; return; }
    try { parseTeam($("teamText").value); } catch (e) { $("teamError").textContent = e.message; return; }
    const m = loadSaved(); m[name] = $("teamText").value; storeSaved(m); refreshSaved(name);
  });
  $("savedTeams").addEventListener("change", () => {
    const t = loadSaved()[$("savedTeams").value];
    if (t) { $("teamText").value = t; $("teamName").value = $("savedTeams").value; useTeam(t); }
  });
  $("deleteTeam").addEventListener("click", () => {
    const k = $("savedTeams").value; if (!k) return;
    const m = loadSaved(); delete m[k]; storeSaved(m); refreshSaved();
  });
  $("monCards").addEventListener("change", (e) => {
    if (e.target.name === "outMon") {
      monState = readMons().map((m, i) => ({ ...monState[i], ...m, sleepRest: m.sleep.rest, slept: m.sleep.slept }));
      active = Number(e.target.value);
      renderTeam();
      teamCfgs.forEach((_, i) => { $(`m${i}-hp`).value = monState[i].hpPct; $(`m${i}-sleepFrom`).value = monState[i].sleepRest ? "rest" : "move"; $(`m${i}-slept`).value = monState[i].slept; $(`m${i}-toxic`).value = monState[i].toxicTurns; });
    }
    for (let i = 0; teamCfgs && i < teamCfgs.length; i++) syncStatusRows(`m${i}`);
  });
  for (const ev of ["input", "change"]) document.addEventListener(ev, (e) => {
    if (!e.target.classList?.contains("trigger") && e.target.name !== "outMon") return;
    if (e.target.id === "o-status") syncStatusRows("o");
    if (["challenge", "battle"].includes(e.target.id) && e.type === "change") $("brain").value = brainFor(runInputs()) ?? "";
    if (["challenge", "battle", "brain"].includes(e.target.id) || e.target.name === "oppIndex") brainChanged();
    else if (e.target.id === "bracketOnly") refreshSetList();
    if (["oppSet", "challenge", "battle"].includes(e.target.id)) renderOppSet();
    clearTimeout(refresh.t); refresh.t = setTimeout(refresh, 120);
  });
  $("solveBtn").addEventListener("click", solve);
  $("stopBtn").addEventListener("click", () => solving?.abort());
}
init();
