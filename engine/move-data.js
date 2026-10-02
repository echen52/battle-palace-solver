// ── move-data.js ───────────────────────────────────────────────────────────
// Full move dex (354 entries), converted from battle_moves.json.
// Phase D F10: checked field by field against the ROM table, src/data/battle_moves.h,
// by arena-solver/tools/move-data-audit.mjs (0 differences). It found Return and
// Frustration at power 102 (the max-friendship value); the ROM has 1 -- the real
// power is computed in battle (getFriendshipPower), and the AI reads the table.
// `category` is DERIVED from type per Gen I-III rules (physical/special is
// determined by the move's type, not per-move — that split starts Gen IV):
//   Physical types: Bug, Fighting, Flying, Ghost, Ground, Normal, Poison, Rock, Steel
//   Special types:  Dark, Dragon, Electric, Fire, Grass, Ice, Psychic, Water
// `accuracy: null` means always-hit (source listed 0, the always-hit convention).
// `mindRating` follows src/battle_arena.c's sMindRatings[]: default is 1 for any
// damaging move, 0 for status moves, with explicit exceptions for Protect/
// Detect/Endure/Fake Out (-1) and Counter/Mirror Coat/Bide (0 despite dealing
// damage — they use a placeholder power value in source data, not real power).

export const MOVES = {
  "Pound": {
    "type": "Normal",
    "category": "physical",
    "power": 40,
    "accuracy": 100,
    "pp": 35,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Karate Chop": {
    "type": "Fighting",
    "category": "physical",
    "power": 50,
    "accuracy": 100,
    "pp": 25,
    "effect": "EFFECT_HIGH_CRITICAL",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Double Slap": {
    "type": "Normal",
    "category": "physical",
    "power": 15,
    "accuracy": 85,
    "pp": 10,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Comet Punch": {
    "type": "Normal",
    "category": "physical",
    "power": 18,
    "accuracy": 85,
    "pp": 15,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Mega Punch": {
    "type": "Normal",
    "category": "physical",
    "power": 80,
    "accuracy": 85,
    "pp": 20,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Pay Day": {
    "type": "Normal",
    "category": "physical",
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_PAY_DAY",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Fire Punch": {
    "type": "Fire",
    "category": "special",
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_BURN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Ice Punch": {
    "type": "Ice",
    "category": "special",
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_FREEZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "ThunderPunch": {
    "type": "Electric",
    "category": "special",
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_PARALYZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Scratch": {
    "type": "Normal",
    "category": "physical",
    "power": 40,
    "accuracy": 100,
    "pp": 35,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Vice Grip": {
    "type": "Normal",
    "category": "physical",
    "power": 55,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Guillotine": {
    "type": "Normal",
    "category": "physical",
    "power": 1,
    "accuracy": 30,
    "pp": 5,
    "effect": "EFFECT_OHKO",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Razor Wind": {
    "type": "Normal",
    "category": "physical",
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_RAZOR_WIND",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Swords Dance": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 30,
    "effect": "EFFECT_ATTACK_UP_2",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Cut": {
    "type": "Normal",
    "category": "physical",
    "power": 50,
    "accuracy": 95,
    "pp": 30,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Gust": {
    "type": "Flying",
    "category": "physical",
    "power": 40,
    "accuracy": 100,
    "pp": 35,
    "effect": "EFFECT_GUST",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Wing Attack": {
    "type": "Flying",
    "category": "physical",
    "power": 60,
    "accuracy": 100,
    "pp": 35,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Whirlwind": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_ROAR",
    "priority": -6,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Fly": {
    "type": "Flying",
    "category": "physical",
    "power": 70,
    "accuracy": 95,
    "pp": 15,
    "effect": "EFFECT_SEMI_INVULNERABLE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Bind": {
    "type": "Normal",
    "category": "physical",
    "power": 15,
    "accuracy": 75,
    "pp": 20,
    "effect": "EFFECT_TRAP",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Slam": {
    "type": "Normal",
    "category": "physical",
    "power": 80,
    "accuracy": 75,
    "pp": 20,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Vine Whip": {
    "type": "Grass",
    "category": "special",
    "power": 35,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Stomp": {
    "type": "Normal",
    "category": "physical",
    "power": 65,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_FLINCH_MINIMIZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Double Kick": {
    "type": "Fighting",
    "category": "physical",
    "power": 30,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_DOUBLE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Mega Kick": {
    "type": "Normal",
    "category": "physical",
    "power": 120,
    "accuracy": 75,
    "pp": 5,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Jump Kick": {
    "type": "Fighting",
    "category": "physical",
    "power": 70,
    "accuracy": 95,
    "pp": 25,
    "effect": "EFFECT_RECOIL_IF_MISS",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Rolling Kick": {
    "type": "Fighting",
    "category": "physical",
    "power": 60,
    "accuracy": 85,
    "pp": 15,
    "effect": "EFFECT_FLINCH_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Sand-Attack": {
    "type": "Ground",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_ACCURACY_DOWN",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Headbutt": {
    "type": "Normal",
    "category": "physical",
    "power": 70,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_FLINCH_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Horn Attack": {
    "type": "Normal",
    "category": "physical",
    "power": 65,
    "accuracy": 100,
    "pp": 25,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Fury Attack": {
    "type": "Normal",
    "category": "physical",
    "power": 15,
    "accuracy": 85,
    "pp": 20,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Horn Drill": {
    "type": "Normal",
    "category": "physical",
    "power": 1,
    "accuracy": 30,
    "pp": 5,
    "effect": "EFFECT_OHKO",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Tackle": {
    "type": "Normal",
    "category": "physical",
    "power": 35,
    "accuracy": 95,
    "pp": 35,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Body Slam": {
    "type": "Normal",
    "category": "physical",
    "power": 85,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_PARALYZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Wrap": {
    "type": "Normal",
    "category": "physical",
    "power": 15,
    "accuracy": 85,
    "pp": 20,
    "effect": "EFFECT_TRAP",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Take Down": {
    "type": "Normal",
    "category": "physical",
    "power": 90,
    "accuracy": 85,
    "pp": 20,
    "effect": "EFFECT_RECOIL",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Thrash": {
    "type": "Normal",
    "category": "physical",
    "power": 90,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_RAMPAGE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Double-Edge": {
    "type": "Normal",
    "category": "physical",
    "power": 120,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_DOUBLE_EDGE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Tail Whip": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_DEFENSE_DOWN",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Poison Sting": {
    "type": "Poison",
    "category": "physical",
    "power": 15,
    "accuracy": 100,
    "pp": 35,
    "effect": "EFFECT_POISON_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Twineedle": {
    "type": "Bug",
    "category": "physical",
    "power": 25,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_TWINEEDLE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Pin Missile": {
    "type": "Bug",
    "category": "physical",
    "power": 14,
    "accuracy": 85,
    "pp": 20,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Leer": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_DEFENSE_DOWN",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Bite": {
    "type": "Dark",
    "category": "special",
    "power": 60,
    "accuracy": 100,
    "pp": 25,
    "effect": "EFFECT_FLINCH_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Growl": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 40,
    "effect": "EFFECT_ATTACK_DOWN",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Roar": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_ROAR",
    "priority": -6,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Sing": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 55,
    "pp": 15,
    "effect": "EFFECT_SLEEP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Supersonic": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 55,
    "pp": 20,
    "effect": "EFFECT_CONFUSE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Sonic Boom": {
    "type": "Normal",
    "category": "physical",
    "power": 1,
    "accuracy": 90,
    "pp": 20,
    "effect": "EFFECT_SONICBOOM",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Disable": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 55,
    "pp": 20,
    "effect": "EFFECT_DISABLE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Acid": {
    "type": "Poison",
    "category": "physical",
    "power": 40,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_DEFENSE_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Ember": {
    "type": "Fire",
    "category": "special",
    "power": 40,
    "accuracy": 100,
    "pp": 25,
    "effect": "EFFECT_BURN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Flamethrower": {
    "type": "Fire",
    "category": "special",
    "power": 95,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_BURN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Mist": {
    "type": "Ice",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 30,
    "effect": "EFFECT_MIST",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Water Gun": {
    "type": "Water",
    "category": "special",
    "power": 40,
    "accuracy": 100,
    "pp": 25,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Hydro Pump": {
    "type": "Water",
    "category": "special",
    "power": 120,
    "accuracy": 80,
    "pp": 5,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Surf": {
    "type": "Water",
    "category": "special",
    "power": 95,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Ice Beam": {
    "type": "Ice",
    "category": "special",
    "power": 95,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_FREEZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Blizzard": {
    "type": "Ice",
    "category": "special",
    "power": 120,
    "accuracy": 70,
    "pp": 5,
    "effect": "EFFECT_FREEZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Psybeam": {
    "type": "Psychic",
    "category": "special",
    "power": 65,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_CONFUSE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Bubble Beam": {
    "type": "Water",
    "category": "special",
    "power": 65,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_SPEED_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Aurora Beam": {
    "type": "Ice",
    "category": "special",
    "power": 65,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_ATTACK_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Hyper Beam": {
    "type": "Normal",
    "category": "physical",
    "power": 150,
    "accuracy": 90,
    "pp": 5,
    "effect": "EFFECT_RECHARGE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Peck": {
    "type": "Flying",
    "category": "physical",
    "power": 35,
    "accuracy": 100,
    "pp": 35,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Drill Peck": {
    "type": "Flying",
    "category": "physical",
    "power": 80,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Submission": {
    "type": "Fighting",
    "category": "physical",
    "power": 80,
    "accuracy": 80,
    "pp": 25,
    "effect": "EFFECT_RECOIL",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Low Kick": {
    "type": "Fighting",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_LOW_KICK",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Counter": {
    "type": "Fighting",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_COUNTER",
    "priority": -5,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Seismic Toss": {
    "type": "Fighting",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_LEVEL_DAMAGE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Strength": {
    "type": "Normal",
    "category": "physical",
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Absorb": {
    "type": "Grass",
    "category": "special",
    "power": 20,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_ABSORB",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Mega Drain": {
    "type": "Grass",
    "category": "special",
    "power": 40,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_ABSORB",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Leech Seed": {
    "type": "Grass",
    "category": "status",
    "power": 0,
    "accuracy": 90,
    "pp": 10,
    "effect": "EFFECT_LEECH_SEED",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Growth": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 40,
    "effect": "EFFECT_SPECIAL_ATTACK_UP",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Razor Leaf": {
    "type": "Grass",
    "category": "special",
    "power": 55,
    "accuracy": 95,
    "pp": 25,
    "effect": "EFFECT_HIGH_CRITICAL",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "SolarBeam": {
    "type": "Grass",
    "category": "special",
    "power": 120,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_SOLAR_BEAM",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Poison Powder": {
    "type": "Poison",
    "category": "status",
    "power": 0,
    "accuracy": 75,
    "pp": 35,
    "effect": "EFFECT_POISON",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Stun Spore": {
    "type": "Grass",
    "category": "status",
    "power": 0,
    "accuracy": 75,
    "pp": 30,
    "effect": "EFFECT_PARALYZE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Sleep Powder": {
    "type": "Grass",
    "category": "status",
    "power": 0,
    "accuracy": 75,
    "pp": 15,
    "effect": "EFFECT_SLEEP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Petal Dance": {
    "type": "Grass",
    "category": "special",
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_RAMPAGE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "String Shot": {
    "type": "Bug",
    "category": "status",
    "power": 0,
    "accuracy": 95,
    "pp": 40,
    "effect": "EFFECT_SPEED_DOWN",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Dragon Rage": {
    "type": "Dragon",
    "category": "special",
    "power": 1,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_DRAGON_RAGE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Fire Spin": {
    "type": "Fire",
    "category": "special",
    "power": 15,
    "accuracy": 70,
    "pp": 15,
    "effect": "EFFECT_TRAP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Thunder Shock": {
    "type": "Electric",
    "category": "special",
    "power": 40,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_PARALYZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Thunderbolt": {
    "type": "Electric",
    "category": "special",
    "power": 95,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_PARALYZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Thunder Wave": {
    "type": "Electric",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_PARALYZE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Thunder": {
    "type": "Electric",
    "category": "special",
    "power": 120,
    "accuracy": 70,
    "pp": 10,
    "effect": "EFFECT_THUNDER",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Rock Throw": {
    "type": "Rock",
    "category": "physical",
    "power": 50,
    "accuracy": 90,
    "pp": 15,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Earthquake": {
    "type": "Ground",
    "category": "physical",
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_EARTHQUAKE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Fissure": {
    "type": "Ground",
    "category": "physical",
    "power": 1,
    "accuracy": 30,
    "pp": 5,
    "effect": "EFFECT_OHKO",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Dig": {
    "type": "Ground",
    "category": "physical",
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_SEMI_INVULNERABLE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Toxic": {
    "type": "Poison",
    "category": "status",
    "power": 0,
    "accuracy": 85,
    "pp": 10,
    "effect": "EFFECT_TOXIC",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Confusion": {
    "type": "Psychic",
    "category": "special",
    "power": 50,
    "accuracy": 100,
    "pp": 25,
    "effect": "EFFECT_CONFUSE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Psychic": {
    "type": "Psychic",
    "category": "special",
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_SPECIAL_DEFENSE_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Hypnosis": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": 60,
    "pp": 20,
    "effect": "EFFECT_SLEEP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Meditate": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 40,
    "effect": "EFFECT_ATTACK_UP",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Agility": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 30,
    "effect": "EFFECT_SPEED_UP_2",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Quick Attack": {
    "type": "Normal",
    "category": "physical",
    "power": 40,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_QUICK_ATTACK",
    "priority": 1,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Rage": {
    "type": "Normal",
    "category": "physical",
    "power": 20,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_RAGE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Teleport": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_TELEPORT",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Night Shade": {
    "type": "Ghost",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_LEVEL_DAMAGE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Mimic": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_MIMIC",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED"
    ],
    "mindRating": 0
  },
  "Screech": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 85,
    "pp": 40,
    "effect": "EFFECT_DEFENSE_DOWN_2",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Double Team": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 15,
    "effect": "EFFECT_EVASION_UP",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Recover": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_RESTORE_HP",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Harden": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 30,
    "effect": "EFFECT_DEFENSE_UP",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Minimize": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_MINIMIZE",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "SmokeScreen": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_ACCURACY_DOWN",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Confuse Ray": {
    "type": "Ghost",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_CONFUSE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Withdraw": {
    "type": "Water",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 40,
    "effect": "EFFECT_DEFENSE_UP",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Defense Curl": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 40,
    "effect": "EFFECT_DEFENSE_CURL",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Barrier": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 30,
    "effect": "EFFECT_DEFENSE_UP_2",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Light Screen": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 30,
    "effect": "EFFECT_LIGHT_SCREEN",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Haze": {
    "type": "Ice",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 30,
    "effect": "EFFECT_HAZE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED"
    ],
    "mindRating": 0
  },
  "Reflect": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_REFLECT",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Focus Energy": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 30,
    "effect": "EFFECT_FOCUS_ENERGY",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Bide": {
    "type": "Normal",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_BIDE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 0
  },
  "Metronome": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_METRONOME",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Mirror Move": {
    "type": "Flying",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_MIRROR_MOVE",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Self Destruct": {
    "type": "Normal",
    "category": "physical",
    "power": 200,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_EXPLOSION",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Egg Bomb": {
    "type": "Normal",
    "category": "physical",
    "power": 100,
    "accuracy": 75,
    "pp": 10,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Lick": {
    "type": "Ghost",
    "category": "physical",
    "power": 20,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_PARALYZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Smog": {
    "type": "Poison",
    "category": "physical",
    "power": 20,
    "accuracy": 70,
    "pp": 20,
    "effect": "EFFECT_POISON_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Sludge": {
    "type": "Poison",
    "category": "physical",
    "power": 65,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_POISON_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Bone Club": {
    "type": "Ground",
    "category": "physical",
    "power": 65,
    "accuracy": 85,
    "pp": 20,
    "effect": "EFFECT_FLINCH_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Fire Blast": {
    "type": "Fire",
    "category": "special",
    "power": 120,
    "accuracy": 85,
    "pp": 5,
    "effect": "EFFECT_BURN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Waterfall": {
    "type": "Water",
    "category": "special",
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Clamp": {
    "type": "Water",
    "category": "special",
    "power": 35,
    "accuracy": 75,
    "pp": 10,
    "effect": "EFFECT_TRAP",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Swift": {
    "type": "Normal",
    "category": "physical",
    "power": 60,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_ALWAYS_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Skull Bash": {
    "type": "Normal",
    "category": "physical",
    "power": 100,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_SKULL_BASH",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Spike Cannon": {
    "type": "Normal",
    "category": "physical",
    "power": 20,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Constrict": {
    "type": "Normal",
    "category": "physical",
    "power": 10,
    "accuracy": 100,
    "pp": 35,
    "effect": "EFFECT_SPEED_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Amnesia": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_SPECIAL_DEFENSE_UP_2",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Kinesis": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": 80,
    "pp": 15,
    "effect": "EFFECT_ACCURACY_DOWN",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Softboiled": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_SOFTBOILED",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Hi Jump Kick": {
    "type": "Fighting",
    "category": "physical",
    "power": 85,
    "accuracy": 90,
    "pp": 20,
    "effect": "EFFECT_RECOIL_IF_MISS",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Glare": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 75,
    "pp": 30,
    "effect": "EFFECT_PARALYZE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Dream Eater": {
    "type": "Psychic",
    "category": "special",
    "power": 100,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_DREAM_EATER",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Poison Gas": {
    "type": "Poison",
    "category": "status",
    "power": 0,
    "accuracy": 55,
    "pp": 40,
    "effect": "EFFECT_POISON",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Barrage": {
    "type": "Normal",
    "category": "physical",
    "power": 15,
    "accuracy": 85,
    "pp": 20,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Leech Life": {
    "type": "Bug",
    "category": "physical",
    "power": 20,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_ABSORB",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Lovely Kiss": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 75,
    "pp": 10,
    "effect": "EFFECT_SLEEP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Sky Attack": {
    "type": "Flying",
    "category": "physical",
    "power": 140,
    "accuracy": 90,
    "pp": 5,
    "effect": "EFFECT_SKY_ATTACK",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Transform": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_TRANSFORM",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Bubble": {
    "type": "Water",
    "category": "special",
    "power": 20,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_SPEED_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Dizzy Punch": {
    "type": "Normal",
    "category": "physical",
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_CONFUSE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Spore": {
    "type": "Grass",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_SLEEP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Flash": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 70,
    "pp": 20,
    "effect": "EFFECT_ACCURACY_DOWN",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Psywave": {
    "type": "Psychic",
    "category": "special",
    "power": 1,
    "accuracy": 80,
    "pp": 15,
    "effect": "EFFECT_PSYWAVE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Splash": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 40,
    "effect": "EFFECT_SPLASH",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Acid Armor": {
    "type": "Poison",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 40,
    "effect": "EFFECT_DEFENSE_UP_2",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Crabhammer": {
    "type": "Water",
    "category": "special",
    "power": 90,
    "accuracy": 85,
    "pp": 10,
    "effect": "EFFECT_HIGH_CRITICAL",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Explosion": {
    "type": "Normal",
    "category": "physical",
    "power": 250,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_EXPLOSION",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Fury Swipes": {
    "type": "Normal",
    "category": "physical",
    "power": 18,
    "accuracy": 80,
    "pp": 15,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Bonemerang": {
    "type": "Ground",
    "category": "physical",
    "power": 50,
    "accuracy": 90,
    "pp": 10,
    "effect": "EFFECT_DOUBLE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Rest": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_REST",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Rock Slide": {
    "type": "Rock",
    "category": "physical",
    "power": 75,
    "accuracy": 90,
    "pp": 10,
    "effect": "EFFECT_FLINCH_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Hyper Fang": {
    "type": "Normal",
    "category": "physical",
    "power": 80,
    "accuracy": 90,
    "pp": 15,
    "effect": "EFFECT_FLINCH_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Sharpen": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 30,
    "effect": "EFFECT_ATTACK_UP",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Conversion": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 30,
    "effect": "EFFECT_CONVERSION",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Tri Attack": {
    "type": "Normal",
    "category": "physical",
    "power": 80,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_TRI_ATTACK",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Super Fang": {
    "type": "Normal",
    "category": "physical",
    "power": 1,
    "accuracy": 90,
    "pp": 10,
    "effect": "EFFECT_SUPER_FANG",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Slash": {
    "type": "Normal",
    "category": "physical",
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_HIGH_CRITICAL",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Substitute": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_SUBSTITUTE",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Struggle": {
    "type": "Normal",
    "category": "physical",
    "power": 50,
    "accuracy": 100,
    "pp": 1,
    "effect": "EFFECT_RECOIL",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Sketch": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 1,
    "effect": "EFFECT_SKETCH",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Triple Kick": {
    "type": "Fighting",
    "category": "physical",
    "power": 10,
    "accuracy": 90,
    "pp": 10,
    "effect": "EFFECT_TRIPLE_KICK",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Thief": {
    "type": "Dark",
    "category": "special",
    "power": 40,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_THIEF",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Spider Web": {
    "type": "Bug",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_MEAN_LOOK",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Mind Reader": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_LOCK_ON",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Nightmare": {
    "type": "Ghost",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_NIGHTMARE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Flame Wheel": {
    "type": "Fire",
    "category": "special",
    "power": 60,
    "accuracy": 100,
    "pp": 25,
    "effect": "EFFECT_THAW_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Snore": {
    "type": "Normal",
    "category": "physical",
    "power": 40,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_SNORE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Curse": {
    "type": "Mystery",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_CURSE",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Flail": {
    "type": "Normal",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_FLAIL",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Conversion 2": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_CONVERSION_2",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Aeroblast": {
    "type": "Flying",
    "category": "physical",
    "power": 100,
    "accuracy": 95,
    "pp": 5,
    "effect": "EFFECT_HIGH_CRITICAL",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Cotton Spore": {
    "type": "Grass",
    "category": "status",
    "power": 0,
    "accuracy": 85,
    "pp": 40,
    "effect": "EFFECT_SPEED_DOWN_2",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Reversal": {
    "type": "Fighting",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_FLAIL",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Spite": {
    "type": "Ghost",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_SPITE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Powder Snow": {
    "type": "Ice",
    "category": "special",
    "power": 40,
    "accuracy": 100,
    "pp": 25,
    "effect": "EFFECT_FREEZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Protect": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_PROTECT",
    "priority": 3,
    "flags": [],
    "mindRating": -1
  },
  "Mach Punch": {
    "type": "Fighting",
    "category": "physical",
    "power": 40,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_QUICK_ATTACK",
    "priority": 1,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Scary Face": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 90,
    "pp": 10,
    "effect": "EFFECT_SPEED_DOWN_2",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Faint Attack": {
    "type": "Dark",
    "category": "special",
    "power": 60,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_ALWAYS_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Sweet Kiss": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 75,
    "pp": 10,
    "effect": "EFFECT_CONFUSE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Belly Drum": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_BELLY_DRUM",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Sludge Bomb": {
    "type": "Poison",
    "category": "physical",
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_POISON_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Mud-Slap": {
    "type": "Ground",
    "category": "physical",
    "power": 20,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_ACCURACY_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Octazooka": {
    "type": "Water",
    "category": "special",
    "power": 65,
    "accuracy": 85,
    "pp": 10,
    "effect": "EFFECT_ACCURACY_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Spikes": {
    "type": "Ground",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_SPIKES",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Zap Cannon": {
    "type": "Electric",
    "category": "special",
    "power": 100,
    "accuracy": 50,
    "pp": 5,
    "effect": "EFFECT_PARALYZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Foresight": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 40,
    "effect": "EFFECT_FORESIGHT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Destiny Bond": {
    "type": "Ghost",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 5,
    "effect": "EFFECT_DESTINY_BOND",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Perish Song": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 5,
    "effect": "EFFECT_PERISH_SONG",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Icy Wind": {
    "type": "Ice",
    "category": "special",
    "power": 55,
    "accuracy": 95,
    "pp": 15,
    "effect": "EFFECT_SPEED_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Detect": {
    "type": "Fighting",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 5,
    "effect": "EFFECT_PROTECT",
    "priority": 3,
    "flags": [],
    "mindRating": -1
  },
  "Bone Rush": {
    "type": "Ground",
    "category": "physical",
    "power": 25,
    "accuracy": 80,
    "pp": 10,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Lock On": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_LOCK_ON",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Outrage": {
    "type": "Dragon",
    "category": "special",
    "power": 90,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_RAMPAGE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Sandstorm": {
    "type": "Rock",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_SANDSTORM",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Giga Drain": {
    "type": "Grass",
    "category": "special",
    "power": 60,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_ABSORB",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Endure": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_ENDURE",
    "priority": 3,
    "flags": [],
    "mindRating": -1
  },
  "Charm": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_ATTACK_DOWN_2",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Rollout": {
    "type": "Rock",
    "category": "physical",
    "power": 30,
    "accuracy": 90,
    "pp": 20,
    "effect": "EFFECT_ROLLOUT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "False Swipe": {
    "type": "Normal",
    "category": "physical",
    "power": 40,
    "accuracy": 100,
    "pp": 40,
    "effect": "EFFECT_FALSE_SWIPE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Swagger": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 90,
    "pp": 15,
    "effect": "EFFECT_SWAGGER",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Milk Drink": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_SOFTBOILED",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Spark": {
    "type": "Electric",
    "category": "special",
    "power": 65,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_PARALYZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Fury Cutter": {
    "type": "Bug",
    "category": "physical",
    "power": 10,
    "accuracy": 95,
    "pp": 20,
    "effect": "EFFECT_FURY_CUTTER",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Steel Wing": {
    "type": "Steel",
    "category": "physical",
    "power": 70,
    "accuracy": 90,
    "pp": 25,
    "effect": "EFFECT_DEFENSE_UP_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Mean Look": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_MEAN_LOOK",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Attract": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_ATTRACT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Sleep Talk": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_SLEEP_TALK",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Heal Bell": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 5,
    "effect": "EFFECT_HEAL_BELL",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Return": {
    "type": "Normal",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_RETURN",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Present": {
    "type": "Normal",
    "category": "physical",
    "power": 1,
    "accuracy": 90,
    "pp": 15,
    "effect": "EFFECT_PRESENT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Frustration": {
    "type": "Normal",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_FRUSTRATION",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Safeguard": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 25,
    "effect": "EFFECT_SAFEGUARD",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Pain Split": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_PAIN_SPLIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Sacred Fire": {
    "type": "Fire",
    "category": "special",
    "power": 100,
    "accuracy": 95,
    "pp": 5,
    "effect": "EFFECT_THAW_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Magnitude": {
    "type": "Ground",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_MAGNITUDE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "DynamicPunch": {
    "type": "Fighting",
    "category": "physical",
    "power": 100,
    "accuracy": 50,
    "pp": 5,
    "effect": "EFFECT_CONFUSE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Megahorn": {
    "type": "Bug",
    "category": "physical",
    "power": 120,
    "accuracy": 85,
    "pp": 10,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "DragonBreath": {
    "type": "Dragon",
    "category": "special",
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_PARALYZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Baton Pass": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 40,
    "effect": "EFFECT_BATON_PASS",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Encore": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_ENCORE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Pursuit": {
    "type": "Dark",
    "category": "special",
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_PURSUIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Rapid Spin": {
    "type": "Normal",
    "category": "physical",
    "power": 20,
    "accuracy": 100,
    "pp": 40,
    "effect": "EFFECT_RAPID_SPIN",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Sweet Scent": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_EVASION_DOWN",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Iron Tail": {
    "type": "Steel",
    "category": "physical",
    "power": 100,
    "accuracy": 75,
    "pp": 15,
    "effect": "EFFECT_DEFENSE_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Metal Claw": {
    "type": "Steel",
    "category": "physical",
    "power": 50,
    "accuracy": 95,
    "pp": 35,
    "effect": "EFFECT_ATTACK_UP_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Vital Throw": {
    "type": "Fighting",
    "category": "physical",
    "power": 70,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_VITAL_THROW",
    "priority": -1,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Morning Sun": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 5,
    "effect": "EFFECT_MORNING_SUN",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Synthesis": {
    "type": "Grass",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 5,
    "effect": "EFFECT_SYNTHESIS",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Moonlight": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 5,
    "effect": "EFFECT_MOONLIGHT",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Hidden Power": {
    "type": "Normal",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_HIDDEN_POWER",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Cross Chop": {
    "type": "Fighting",
    "category": "physical",
    "power": 100,
    "accuracy": 80,
    "pp": 5,
    "effect": "EFFECT_HIGH_CRITICAL",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Twister": {
    "type": "Dragon",
    "category": "special",
    "power": 40,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_TWISTER",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Rain Dance": {
    "type": "Water",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 5,
    "effect": "EFFECT_RAIN_DANCE",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Sunny Day": {
    "type": "Fire",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 5,
    "effect": "EFFECT_SUNNY_DAY",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Crunch": {
    "type": "Dark",
    "category": "special",
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_SPECIAL_DEFENSE_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Mirror Coat": {
    "type": "Psychic",
    "category": "special",
    "power": 1,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_MIRROR_COAT",
    "priority": -5,
    "flags": [
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Psych Up": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_PSYCH_UP",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "ExtremeSpeed": {
    "type": "Normal",
    "category": "physical",
    "power": 80,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_QUICK_ATTACK",
    "priority": 1,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "AncientPower": {
    "type": "Rock",
    "category": "physical",
    "power": 60,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_ALL_STATS_UP_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Shadow Ball": {
    "type": "Ghost",
    "category": "physical",
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_SPECIAL_DEFENSE_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Future Sight": {
    "type": "Psychic",
    "category": "special",
    "power": 80,
    "accuracy": 90,
    "pp": 15,
    "effect": "EFFECT_FUTURE_SIGHT",
    "priority": 0,
    "flags": [],
    "mindRating": 1
  },
  "Rock Smash": {
    "type": "Fighting",
    "category": "physical",
    "power": 20,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_DEFENSE_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Whirlpool": {
    "type": "Water",
    "category": "special",
    "power": 15,
    "accuracy": 70,
    "pp": 15,
    "effect": "EFFECT_TRAP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Beat Up": {
    "type": "Dark",
    "category": "special",
    "power": 10,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_BEAT_UP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Fake Out": {
    "type": "Normal",
    "category": "physical",
    "power": 40,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_FAKE_OUT",
    "priority": 1,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": -1
  },
  "Uproar": {
    "type": "Normal",
    "category": "physical",
    "power": 50,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_UPROAR",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Stockpile": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_STOCKPILE",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Spit Up": {
    "type": "Normal",
    "category": "physical",
    "power": 100,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_SPIT_UP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Swallow": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_SWALLOW",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Heat Wave": {
    "type": "Fire",
    "category": "special",
    "power": 100,
    "accuracy": 90,
    "pp": 10,
    "effect": "EFFECT_BURN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Hail": {
    "type": "Ice",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 10,
    "effect": "EFFECT_HAIL",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED"
    ],
    "mindRating": 0
  },
  "Torment": {
    "type": "Dark",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_TORMENT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Flatter": {
    "type": "Dark",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_FLATTER",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Will-O-Wisp": {
    "type": "Fire",
    "category": "status",
    "power": 0,
    "accuracy": 75,
    "pp": 15,
    "effect": "EFFECT_WILL_O_WISP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Memento": {
    "type": "Dark",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_MEMENTO",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Facade": {
    "type": "Normal",
    "category": "physical",
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_FACADE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Focus Punch": {
    "type": "Fighting",
    "category": "physical",
    "power": 150,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_FOCUS_PUNCH",
    "priority": -3,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED"
    ],
    "mindRating": 1
  },
  "SmellingSalt": {
    "type": "Normal",
    "category": "physical",
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_SMELLINGSALT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Follow Me": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_FOLLOW_ME",
    "priority": 3,
    "flags": [],
    "mindRating": 0
  },
  "Nature Power": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 95,
    "pp": 20,
    "effect": "EFFECT_NATURE_POWER",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Charge": {
    "type": "Electric",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_CHARGE",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Taunt": {
    "type": "Dark",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_TAUNT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED"
    ],
    "mindRating": 0
  },
  "Helping Hand": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_HELPING_HAND",
    "priority": 5,
    "flags": [],
    "mindRating": 0
  },
  "Trick": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_TRICK",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Role Play": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_ROLE_PLAY",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Wish": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_WISH",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED"
    ],
    "mindRating": 0
  },
  "Assist": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_ASSIST",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Ingrain": {
    "type": "Grass",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_INGRAIN",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Superpower": {
    "type": "Fighting",
    "category": "physical",
    "power": 120,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_SUPERPOWER",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Magic Coat": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_MAGIC_COAT",
    "priority": 4,
    "flags": [],
    "mindRating": 0
  },
  "Recycle": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_RECYCLE",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Revenge": {
    "type": "Fighting",
    "category": "physical",
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_REVENGE",
    "priority": -4,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Brick Break": {
    "type": "Fighting",
    "category": "physical",
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_BRICK_BREAK",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Yawn": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_YAWN",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Knock Off": {
    "type": "Dark",
    "category": "special",
    "power": 20,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_KNOCK_OFF",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Endeavor": {
    "type": "Normal",
    "category": "physical",
    "power": 1,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_ENDEAVOR",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Eruption": {
    "type": "Fire",
    "category": "special",
    "power": 150,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_ERUPTION",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Skill Swap": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_SKILL_SWAP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Imprison": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_IMPRISON",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED"
    ],
    "mindRating": 0
  },
  "Refresh": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_REFRESH",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Grudge": {
    "type": "Ghost",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_GRUDGE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Snatch": {
    "type": "Dark",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_SNATCH",
    "priority": 4,
    "flags": [
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Secret Power": {
    "type": "Normal",
    "category": "physical",
    "power": 70,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_SECRET_POWER",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Dive": {
    "type": "Water",
    "category": "special",
    "power": 60,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_SEMI_INVULNERABLE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Arm Thrust": {
    "type": "Fighting",
    "category": "physical",
    "power": 15,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Camouflage": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_CAMOUFLAGE",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Tail Glow": {
    "type": "Bug",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_SPECIAL_ATTACK_UP_2",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Luster Purge": {
    "type": "Psychic",
    "category": "special",
    "power": 70,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_SPECIAL_DEFENSE_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Mist Ball": {
    "type": "Psychic",
    "category": "special",
    "power": 70,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_SPECIAL_ATTACK_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Feather Dance": {
    "type": "Flying",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_ATTACK_DOWN_2",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Teeter Dance": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_TEETER_DANCE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED"
    ],
    "mindRating": 0
  },
  "Blaze Kick": {
    "type": "Fire",
    "category": "special",
    "power": 85,
    "accuracy": 90,
    "pp": 10,
    "effect": "EFFECT_BLAZE_KICK",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Mud Sport": {
    "type": "Ground",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_MUD_SPORT",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Ice Ball": {
    "type": "Ice",
    "category": "special",
    "power": 30,
    "accuracy": 90,
    "pp": 20,
    "effect": "EFFECT_ROLLOUT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Needle Arm": {
    "type": "Grass",
    "category": "special",
    "power": 60,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_FLINCH_MINIMIZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Slack Off": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_RESTORE_HP",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Hyper Voice": {
    "type": "Normal",
    "category": "physical",
    "power": 90,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Poison Fang": {
    "type": "Poison",
    "category": "physical",
    "power": 50,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_POISON_FANG",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Crush Claw": {
    "type": "Normal",
    "category": "physical",
    "power": 75,
    "accuracy": 95,
    "pp": 10,
    "effect": "EFFECT_DEFENSE_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Blast Burn": {
    "type": "Fire",
    "category": "special",
    "power": 150,
    "accuracy": 90,
    "pp": 5,
    "effect": "EFFECT_RECHARGE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Hydro Cannon": {
    "type": "Water",
    "category": "special",
    "power": 150,
    "accuracy": 90,
    "pp": 5,
    "effect": "EFFECT_RECHARGE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Meteor Mash": {
    "type": "Steel",
    "category": "physical",
    "power": 100,
    "accuracy": 85,
    "pp": 10,
    "effect": "EFFECT_ATTACK_UP_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Astonish": {
    "type": "Ghost",
    "category": "physical",
    "power": 30,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_FLINCH_MINIMIZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Weather Ball": {
    "type": "Normal",
    "category": "physical",
    "power": 50,
    "accuracy": 100,
    "pp": 10,
    "effect": "EFFECT_WEATHER_BALL",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Aromatherapy": {
    "type": "Grass",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 5,
    "effect": "EFFECT_HEAL_BELL",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Fake Tears": {
    "type": "Dark",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_SPECIAL_DEFENSE_DOWN_2",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Air Cutter": {
    "type": "Flying",
    "category": "physical",
    "power": 55,
    "accuracy": 95,
    "pp": 25,
    "effect": "EFFECT_HIGH_CRITICAL",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Overheat": {
    "type": "Fire",
    "category": "special",
    "power": 140,
    "accuracy": 90,
    "pp": 5,
    "effect": "EFFECT_OVERHEAT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Odor Sleuth": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 40,
    "effect": "EFFECT_FORESIGHT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Rock Tomb": {
    "type": "Rock",
    "category": "physical",
    "power": 50,
    "accuracy": 80,
    "pp": 10,
    "effect": "EFFECT_SPEED_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Silver Wind": {
    "type": "Bug",
    "category": "physical",
    "power": 60,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_ALL_STATS_UP_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Metal Sound": {
    "type": "Steel",
    "category": "status",
    "power": 0,
    "accuracy": 85,
    "pp": 40,
    "effect": "EFFECT_SPECIAL_DEFENSE_DOWN_2",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "GrassWhistle": {
    "type": "Grass",
    "category": "status",
    "power": 0,
    "accuracy": 55,
    "pp": 15,
    "effect": "EFFECT_SLEEP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Tickle": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_TICKLE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 0
  },
  "Cosmic Power": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_COSMIC_POWER",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Water Spout": {
    "type": "Water",
    "category": "special",
    "power": 150,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_ERUPTION",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Signal Beam": {
    "type": "Bug",
    "category": "physical",
    "power": 75,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_CONFUSE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Shadow Punch": {
    "type": "Ghost",
    "category": "physical",
    "power": 60,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_ALWAYS_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Extrasensory": {
    "type": "Psychic",
    "category": "special",
    "power": 80,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_FLINCH_MINIMIZE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Sky Uppercut": {
    "type": "Fighting",
    "category": "physical",
    "power": 85,
    "accuracy": 90,
    "pp": 15,
    "effect": "EFFECT_SKY_UPPERCUT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Sand Tomb": {
    "type": "Ground",
    "category": "physical",
    "power": 15,
    "accuracy": 70,
    "pp": 15,
    "effect": "EFFECT_TRAP",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Sheer Cold": {
    "type": "Ice",
    "category": "special",
    "power": 1,
    "accuracy": 30,
    "pp": 5,
    "effect": "EFFECT_OHKO",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Muddy Water": {
    "type": "Water",
    "category": "special",
    "power": 95,
    "accuracy": 85,
    "pp": 10,
    "effect": "EFFECT_ACCURACY_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Bullet Seed": {
    "type": "Grass",
    "category": "special",
    "power": 10,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Aerial Ace": {
    "type": "Flying",
    "category": "physical",
    "power": 60,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_ALWAYS_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Icicle Spear": {
    "type": "Ice",
    "category": "special",
    "power": 10,
    "accuracy": 100,
    "pp": 30,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Iron Defense": {
    "type": "Steel",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 15,
    "effect": "EFFECT_DEFENSE_UP_2",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Block": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 5,
    "effect": "EFFECT_MEAN_LOOK",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MAGIC_COAT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 0
  },
  "Howl": {
    "type": "Normal",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 40,
    "effect": "EFFECT_ATTACK_UP",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Dragon Claw": {
    "type": "Dragon",
    "category": "special",
    "power": 80,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_HIT",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Frenzy Plant": {
    "type": "Grass",
    "category": "special",
    "power": 150,
    "accuracy": 90,
    "pp": 5,
    "effect": "EFFECT_RECHARGE",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Bulk Up": {
    "type": "Fighting",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_BULK_UP",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Bounce": {
    "type": "Flying",
    "category": "physical",
    "power": 85,
    "accuracy": 85,
    "pp": 5,
    "effect": "EFFECT_SEMI_INVULNERABLE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Mud Shot": {
    "type": "Ground",
    "category": "physical",
    "power": 55,
    "accuracy": 95,
    "pp": 15,
    "effect": "EFFECT_SPEED_DOWN_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Poison Tail": {
    "type": "Poison",
    "category": "physical",
    "power": 50,
    "accuracy": 100,
    "pp": 25,
    "effect": "EFFECT_POISON_TAIL",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Covet": {
    "type": "Normal",
    "category": "physical",
    "power": 40,
    "accuracy": 100,
    "pp": 40,
    "effect": "EFFECT_THIEF",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED"
    ],
    "mindRating": 1
  },
  "Volt Tackle": {
    "type": "Electric",
    "category": "special",
    "power": 120,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_DOUBLE_EDGE",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Magical Leaf": {
    "type": "Grass",
    "category": "special",
    "power": 60,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_ALWAYS_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Water Sport": {
    "type": "Water",
    "category": "status",
    "power": 0,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_WATER_SPORT",
    "priority": 0,
    "flags": [],
    "mindRating": 0
  },
  "Calm Mind": {
    "type": "Psychic",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_CALM_MIND",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Leaf Blade": {
    "type": "Grass",
    "category": "special",
    "power": 70,
    "accuracy": 100,
    "pp": 15,
    "effect": "EFFECT_HIGH_CRITICAL",
    "priority": 0,
    "flags": [
      "FLAG_MAKES_CONTACT",
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Dragon Dance": {
    "type": "Dragon",
    "category": "status",
    "power": 0,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_DRAGON_DANCE",
    "priority": 0,
    "flags": [
      "FLAG_SNATCH_AFFECTED"
    ],
    "mindRating": 0
  },
  "Rock Blast": {
    "type": "Rock",
    "category": "physical",
    "power": 25,
    "accuracy": 80,
    "pp": 10,
    "effect": "EFFECT_MULTI_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Shock Wave": {
    "type": "Electric",
    "category": "special",
    "power": 60,
    "accuracy": null,
    "pp": 20,
    "effect": "EFFECT_ALWAYS_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Water Pulse": {
    "type": "Water",
    "category": "special",
    "power": 60,
    "accuracy": 100,
    "pp": 20,
    "effect": "EFFECT_CONFUSE_HIT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  },
  "Doom Desire": {
    "type": "Steel",
    "category": "physical",
    "power": 120,
    "accuracy": 85,
    "pp": 5,
    "effect": "EFFECT_FUTURE_SIGHT",
    "priority": 0,
    "flags": [],
    "mindRating": 1
  },
  "Psycho Boost": {
    "type": "Psychic",
    "category": "special",
    "power": 140,
    "accuracy": 90,
    "pp": 5,
    "effect": "EFFECT_OVERHEAT",
    "priority": 0,
    "flags": [
      "FLAG_PROTECT_AFFECTED",
      "FLAG_MIRROR_MOVE_AFFECTED",
      "FLAG_KINGS_ROCK_AFFECTED"
    ],
    "mindRating": 1
  }
};
