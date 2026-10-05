// ── showdown.js ────────────────────────────────────────────────────────────
// Reads a team in Pokémon Showdown's export format into buildPlayerMon
// configs. A line it does not understand throws by name; it never guesses.
//
//   Metagross @ Choice Band
//   Ability: Clear Body
//   Level: 50
//   EVs: 36 HP / 252 Atk / 220 Spe
//   Sassy Nature
//   IVs: 30 HP / 0 Atk
//   - Meteor Mash
//
// Missing IVs are 31, missing EVs 0, a missing level 50 (the Palace's open
// level). Stat names: Showdown's HP / Atk / Def / SpA / SpD / Spe, plus the
// long forms people type by hand (SpAtk, SpDef, ...).

import { buildPlayerMon } from "./team.js";

const STAT = {
  hp: "hp", atk: "atk", attack: "atk", def: "def", defense: "def",
  spa: "spa", spatk: "spa", spattack: "spa", spd: "spd", spdef: "spd", spdefense: "spd", spe: "spe", speed: "spe",
};
function statSpread(text, line) {
  const out = {};
  for (const part of text.split("/")) {
    const m = part.trim().match(/^(\d+)\s+([A-Za-z. ]+)$/);
    const key = m && STAT[m[2].replace(/[. ]/g, "").toLowerCase()];
    if (!key) throw new Error(`showdown: cannot read "${part.trim()}" in "${line}"`);
    out[key] = Number(m[1]);
  }
  return out;
}

export function parseShowdownTeam(text) {
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const head = lines[0].match(/^(.+?)(?:\s*\((M|F)\))?(?:\s*@\s*(.+))?$/);
    // "Nickname (Species)" is not handled: refuse rather than misread it.
    if (/\(.+\)/.test(head[1])) throw new Error(`showdown: nicknames are not supported: "${lines[0]}"`);
    const cfg = { species: head[1].trim(), item: head[3]?.trim() ?? null, level: 50, ivs: {}, evs: {}, moves: [] };
    if (head[2]) cfg.gender = head[2] === "M" ? "male" : "female";
    for (const line of lines.slice(1)) {
      let m;
      if ((m = line.match(/^Ability:\s*(.+)$/))) cfg.ability = m[1].trim();
      else if ((m = line.match(/^Level:\s*(\d+)$/))) cfg.level = Number(m[1]);
      else if ((m = line.match(/^EVs:\s*(.+)$/))) cfg.evs = statSpread(m[1], line);
      else if ((m = line.match(/^IVs:\s*(.+)$/))) cfg.ivs = statSpread(m[1], line);
      else if ((m = line.match(/^(\w+)\s+Nature$/))) cfg.nature = m[1];
      else if ((m = line.match(/^-\s*(.+)$/))) cfg.moves.push(m[1].trim());
      else throw new Error(`showdown: cannot read line "${line}" (${cfg.species})`);
    }
    if (!cfg.ability) throw new Error(`showdown: ${cfg.species} has no Ability line`);
    if (!cfg.nature) throw new Error(`showdown: ${cfg.species} has no Nature line`);
    if (cfg.moves.length < 1 || cfg.moves.length > 4) throw new Error(`showdown: ${cfg.species} has ${cfg.moves.length} moves`);
    return cfg;
  });
}

export const buildTeam = (text) => parseShowdownTeam(text).map((cfg) => buildPlayerMon(cfg));
