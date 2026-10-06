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
import { MOVES, hiddenPowerFromIvs } from "./logic.js";

// Move names: Showdown writes today's spellings ("Thunder Punch", "Extreme
// Speed", "Self-Destruct", "Soft-Boiled"); the engine keeps Gen 3's
// ("ThunderPunch", "ExtremeSpeed", "Selfdestruct", "Softboiled"). Matched
// ignoring case, spaces and punctuation (no two Gen 3 names collide that
// way), plus the four renamed since Gen 3. Anything else is passed through,
// and an unknown move still throws by name in buildMon.
const squash = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
const RENAMED = { feintattack: "Faint Attack", visegrip: "Vice Grip", highjumpkick: "Hi Jump Kick", smellingsalts: "SmellingSalt" };
const BY_KEY = new Map(Object.keys(MOVES).map((n) => [squash(n), n]));
export const gen3MoveName = (name) => (MOVES[name] ? name : RENAMED[squash(name)] ?? BY_KEY.get(squash(name)) ?? name);

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
      else if ((m = line.match(/^-\s*Hidden Power\s*\[\s*(\w+)\s*\]$/i))) { cfg.moves.push("Hidden Power"); cfg.hpType = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(); }
      else if ((m = line.match(/^-\s*(.+)$/))) cfg.moves.push(gen3MoveName(m[1].trim()));
      else throw new Error(`showdown: cannot read line "${line}" (${cfg.species})`);
    }
    if (!cfg.ability) throw new Error(`showdown: ${cfg.species} has no Ability line`);
    if (!cfg.nature) throw new Error(`showdown: ${cfg.species} has no Nature line`);
    if (cfg.moves.length < 1 || cfg.moves.length > 4) throw new Error(`showdown: ${cfg.species} has ${cfg.moves.length} moves`);
    // "Hidden Power [Type]": in Gen 3 the type and power come from the IVs
    // (Cmd_hiddenpowercalc). With an IVs line the type must be the one those
    // IVs give (31 where unstated); without one the type is ENTERED, power 70
    // (logic.js resolveHiddenPower's player convention), stats from 31 IVs.
    if (cfg.hpType) {
      if (Object.keys(cfg.ivs).length) {
        const iv = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...cfg.ivs };
        const got = hiddenPowerFromIvs(iv);
        if (got.type !== cfg.hpType) throw new Error(`showdown: ${cfg.species}'s IVs give Hidden Power ${got.type} ${got.power}, not ${cfg.hpType}`);
      } else {
        cfg.hiddenPower = { type: cfg.hpType, power: 70 };
      }
      delete cfg.hpType;
    }
    return cfg;
  });
}

export const buildTeam = (text) => parseShowdownTeam(text).map((cfg) => buildPlayerMon(cfg));
