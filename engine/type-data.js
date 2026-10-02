// ── type-data.js ───────────────────────────────────────────────────────────
// Gen III type chart (17 types, no Fairy), converted from type_chart.json.
// Cross-validated against an independently hand-built version — exact match
// across all 17 attacking rows, so treating this as the canonical source.
//
// NOTE: Only non-neutral matchups stored. Missing = x1.
// NOTE: Foresight removes Ghost immunity to Normal and Fighting.
// NOTE: Levitate: Ground moves have no effect (handled in engine, not here).
// NOTE: Wonder Guard: only super effective moves hit (handled in engine).
// The ability-based interactions (Foresight/Levitate/Wonder Guard) are NOT yet
// implemented in calcDamage/typeEffectiveness — neither mon in any matchup so
// far has had an ability that changes type interactions, so this is an honest
// known gap, not a silent one. Extend typeEffectiveness() to accept ability
// context when a matchup actually needs it.

export const TYPE_CHART = {
  "Normal": {
    "Rock": 0.5,
    "Steel": 0.5,
    "Ghost": 0
  },
  "Fire": {
    "Fire": 0.5,
    "Water": 0.5,
    "Grass": 2,
    "Ice": 2,
    "Bug": 2,
    "Rock": 0.5,
    "Dragon": 0.5,
    "Steel": 2
  },
  "Water": {
    "Fire": 2,
    "Water": 0.5,
    "Grass": 0.5,
    "Ground": 2,
    "Rock": 2,
    "Dragon": 0.5
  },
  "Electric": {
    "Water": 2,
    "Electric": 0.5,
    "Grass": 0.5,
    "Ground": 0,
    "Flying": 2,
    "Dragon": 0.5
  },
  "Grass": {
    "Fire": 0.5,
    "Water": 2,
    "Grass": 0.5,
    "Poison": 0.5,
    "Ground": 2,
    "Flying": 0.5,
    "Bug": 0.5,
    "Rock": 2,
    "Dragon": 0.5,
    "Steel": 0.5
  },
  "Ice": {
    "Water": 0.5,
    "Grass": 2,
    "Ice": 0.5,
    "Ground": 2,
    "Flying": 2,
    "Dragon": 2,
    "Steel": 0.5,
    "Fire": 0.5
  },
  "Fighting": {
    "Normal": 2,
    "Ice": 2,
    "Poison": 0.5,
    "Flying": 0.5,
    "Psychic": 0.5,
    "Bug": 0.5,
    "Rock": 2,
    "Dark": 2,
    "Steel": 2,
    "Ghost": 0
  },
  "Poison": {
    "Grass": 2,
    "Poison": 0.5,
    "Ground": 0.5,
    "Rock": 0.5,
    "Ghost": 0.5,
    "Steel": 0
  },
  "Ground": {
    "Fire": 2,
    "Electric": 2,
    "Grass": 0.5,
    "Poison": 2,
    "Flying": 0,
    "Bug": 0.5,
    "Rock": 2,
    "Steel": 2
  },
  "Flying": {
    "Electric": 0.5,
    "Grass": 2,
    "Fighting": 2,
    "Bug": 2,
    "Rock": 0.5,
    "Steel": 0.5
  },
  "Psychic": {
    "Fighting": 2,
    "Poison": 2,
    "Psychic": 0.5,
    "Dark": 0,
    "Steel": 0.5
  },
  "Bug": {
    "Fire": 0.5,
    "Grass": 2,
    "Fighting": 0.5,
    "Poison": 0.5,
    "Flying": 0.5,
    "Psychic": 2,
    "Ghost": 0.5,
    "Dark": 2,
    "Steel": 0.5
  },
  "Rock": {
    "Fire": 2,
    "Ice": 2,
    "Fighting": 0.5,
    "Ground": 0.5,
    "Flying": 2,
    "Bug": 2,
    "Steel": 0.5
  },
  "Ghost": {
    "Normal": 0,
    "Psychic": 2,
    "Dark": 0.5,
    "Steel": 0.5,
    "Ghost": 2
  },
  "Dragon": {
    "Dragon": 2,
    "Steel": 0.5
  },
  "Dark": {
    "Fighting": 0.5,
    "Psychic": 2,
    "Ghost": 2,
    "Dark": 0.5,
    "Steel": 0.5
  },
  "Steel": {
    "Fire": 0.5,
    "Water": 0.5,
    "Electric": 0.5,
    "Ice": 2,
    "Rock": 2,
    "Steel": 0.5
  }
};

// Gen I-III: damage category is determined by TYPE, not per-move.
export const PHYSICAL_TYPES = [
  "Normal",
  "Fighting",
  "Flying",
  "Poison",
  "Ground",
  "Rock",
  "Bug",
  "Ghost",
  "Steel"
];
export const SPECIAL_TYPES = [
  "Fire",
  "Water",
  "Grass",
  "Electric",
  "Psychic",
  "Ice",
  "Dragon",
  "Dark"
];
