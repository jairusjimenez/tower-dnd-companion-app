const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3456;
const DM_PASSCODE = process.env.DM_PASSCODE || 'dm123';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Safe Mathematical Formula Evaluator (no eval)
// Supports +, -, *, /, %, parentheses, floor(), ceil(), round(), min(), max(), abs()
// ---------------------------------------------------------------------------
function evaluateFormula(expression, variables = {}) {
  if (typeof expression === 'number' && Number.isFinite(expression)) return expression;
  const src = String(expression || '0').trim();
  if (!src) return 0;

  const env = {};
  for (const [k, v] of Object.entries(variables)) {
    const num = Number(v);
    env[k.toUpperCase()] = Number.isFinite(num) ? num : 0;
  }

  let pos = 0;
  const len = src.length;

  function skipWs() {
    while (pos < len && /\s/.test(src[pos])) pos++;
  }

  function parseExpression() {
    let val = parseTerm();
    while (true) {
      skipWs();
      if (src[pos] === '+') {
        pos++;
        val += parseTerm();
      } else if (src[pos] === '-') {
        pos++;
        val -= parseTerm();
      } else {
        break;
      }
    }
    return val;
  }

  function parseTerm() {
    let val = parseUnary();
    while (true) {
      skipWs();
      if (src[pos] === '*') {
        pos++;
        val *= parseUnary();
      } else if (src[pos] === '/') {
        pos++;
        const denom = parseUnary();
        val = denom === 0 ? 0 : val / denom;
      } else if (src[pos] === '%') {
        pos++;
        const denom = parseUnary();
        val = denom === 0 ? 0 : val % denom;
      } else {
        break;
      }
    }
    return val;
  }

  function parseUnary() {
    skipWs();
    if (src[pos] === '-') {
      pos++;
      return -parseUnary();
    }
    if (src[pos] === '+') {
      pos++;
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary() {
    skipWs();
    if (src[pos] === '(') {
      pos++;
      const val = parseExpression();
      skipWs();
      if (src[pos] === ')') pos++;
      return val;
    }

    const numMatch = src.slice(pos).match(/^\d+(\.\d+)?/);
    if (numMatch) {
      pos += numMatch[0].length;
      return Number(numMatch[0]);
    }

    const idMatch = src.slice(pos).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (idMatch) {
      const name = idMatch[0];
      pos += name.length;
      skipWs();
      if (src[pos] === '(') {
        pos++;
        const args = [];
        skipWs();
        if (src[pos] !== ')') {
          args.push(parseExpression());
          while (true) {
            skipWs();
            if (src[pos] === ',') {
              pos++;
              args.push(parseExpression());
            } else {
              break;
            }
          }
        }
        skipWs();
        if (src[pos] === ')') pos++;
        const fn = name.toLowerCase();
        if (fn === 'floor') return Math.floor(args[0] ?? 0);
        if (fn === 'ceil') return Math.ceil(args[0] ?? 0);
        if (fn === 'round') return Math.round(args[0] ?? 0);
        if (fn === 'abs') return Math.abs(args[0] ?? 0);
        if (fn === 'min') return args.length ? Math.min(...args) : 0;
        if (fn === 'max') return args.length ? Math.max(...args) : 0;
        return 0;
      }
      return env[name.toUpperCase()] ?? 0;
    }

    throw new Error(`Unexpected token near "${src.slice(pos, pos + 10)}"`);
  }

  try {
    const result = parseExpression();
    return Number.isFinite(result) ? Math.round(result * 100) / 100 : 0;
  } catch {
    return 0;
  }
}

function getEquippedTotals(character) {
  const eq = character?.equipment || {};
  let attackBonus = 0;
  let armorAc = 0;
  let armorDr = 0;
  let mainWeapon = null;

  for (const [slot, item] of Object.entries(eq)) {
    if (!item) continue;
    attackBonus += Number(item.attackBonus || 0);
    armorAc += Number(item.acBonus || 0);
    armorDr += Number(item.drBonus || 0);
    if (slot === 'mainHand') mainWeapon = item;
  }
  return { attackBonus, armorAc, armorDr, mainWeapon };
}

const DEFAULT_STAT_MILESTONES = [
  // STR (20, 40, 60, 80, 100)
  { id: 'ms-str-20', statKey: 'STR', threshold: 20, abilityName: 'Titan Cleave', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+4 melee damage & ignores 2 DR on heavy strikes.' },
  { id: 'ms-str-40', statKey: 'STR', threshold: 40, abilityName: 'Earthshaker Blow', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+8 melee damage & shockwave knockback.' },
  { id: 'ms-str-60', statKey: 'STR', threshold: 60, abilityName: 'Mountain Splitter', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+14 melee damage & ignores 5 DR.' },
  { id: 'ms-str-80', statKey: 'STR', threshold: 80, abilityName: 'Sovereign Might', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+22 melee damage & crushes shields/barriers.' },
  { id: 'ms-str-100', statKey: 'STR', threshold: 100, abilityName: 'Worldbreaker Apex', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+35 melee damage & guaranteed guard-crush.' },
  // AGI (20, 40, 60, 80, 100)
  { id: 'ms-agi-20', statKey: 'AGI', threshold: 20, abilityName: 'Phantom Step', bonusHp: 0, bonusMp: 0, bonusAc: 2, bonusDr: 0, description: '+2 AC, +3 Initiative, and evasive dash.' },
  { id: 'ms-agi-40', statKey: 'AGI', threshold: 40, abilityName: 'Shadow Afterimage', bonusHp: 0, bonusMp: 0, bonusAc: 3, bonusDr: 0, description: '+3 AC, +2 Spaces speed, auto-evade 1/round.' },
  { id: 'ms-agi-60', statKey: 'AGI', threshold: 60, abilityName: 'Flashstep Mirage', bonusHp: 0, bonusMp: 0, bonusAc: 4, bonusDr: 0, description: '+4 AC, +5 Initiative, counter-dash.' },
  { id: 'ms-agi-80', statKey: 'AGI', threshold: 80, abilityName: 'Temporal Blur', bonusHp: 0, bonusMp: 0, bonusAc: 5, bonusDr: 0, description: '+5 AC, +3 Spaces speed, double reaction.' },
  { id: 'ms-agi-100', statKey: 'AGI', threshold: 100, abilityName: 'Godspeed Ascension', bonusHp: 0, bonusMp: 0, bonusAc: 7, bonusDr: 0, description: '+7 AC, +10 Initiative, untargetable dash.' },
  // VIT (20, 40, 60, 80, 100)
  { id: 'ms-vit-20', statKey: 'VIT', threshold: 20, abilityName: 'Immortal Vessel', bonusHp: 20, bonusMp: 0, bonusAc: 0, bonusDr: 2, description: '+20 Max HP & +2 Damage Reduction (DR).' },
  { id: 'ms-vit-40', statKey: 'VIT', threshold: 40, abilityName: 'Adamantine Flesh', bonusHp: 40, bonusMp: 0, bonusAc: 0, bonusDr: 3, description: '+40 Max HP & +3 DR.' },
  { id: 'ms-vit-60', statKey: 'VIT', threshold: 60, abilityName: 'Undying Core', bonusHp: 70, bonusMp: 0, bonusAc: 0, bonusDr: 4, description: '+70 Max HP, +4 DR, survive lethal hit at 1 HP (1/battle).' },
  { id: 'ms-vit-80', statKey: 'VIT', threshold: 80, abilityName: 'Regenerating Titan', bonusHp: 110, bonusMp: 0, bonusAc: 0, bonusDr: 6, description: '+110 Max HP, +6 DR, heal 10 HP per turn.' },
  { id: 'ms-vit-100', statKey: 'VIT', threshold: 100, abilityName: 'Eternal Sovereign Body', bonusHp: 160, bonusMp: 0, bonusAc: 0, bonusDr: 10, description: '+160 Max HP, +10 DR, status immunity.' },
  // INT (20, 40, 60, 80, 100)
  { id: 'ms-int-20', statKey: 'INT', threshold: 20, abilityName: 'Archmage Resonance', bonusHp: 0, bonusMp: 15, bonusAc: 0, bonusDr: 0, description: '+15 Max MP & +4 spell power.' },
  { id: 'ms-int-40', statKey: 'INT', threshold: 40, abilityName: 'Shinsu Overdrive', bonusHp: 0, bonusMp: 30, bonusAc: 0, bonusDr: 0, description: '+30 Max MP & +8 spell power.' },
  { id: 'ms-int-60', statKey: 'INT', threshold: 60, abilityName: 'Astral Domain', bonusHp: 0, bonusMp: 50, bonusAc: 0, bonusDr: 0, description: '+50 Max MP, +14 spell power, -2 MP spell cost.' },
  { id: 'ms-int-80', statKey: 'INT', threshold: 80, abilityName: 'Grand Sovereign Grimoire', bonusHp: 0, bonusMp: 80, bonusAc: 0, bonusDr: 0, description: '+80 Max MP, +22 spell power, dual-cast spells.' },
  { id: 'ms-int-100', statKey: 'INT', threshold: 100, abilityName: 'Omniscient Origin', bonusHp: 0, bonusMp: 120, bonusAc: 0, bonusDr: 0, description: '+120 Max MP, +35 spell power, half MP costs.' },
  // PER (20, 40, 60, 80, 100)
  { id: 'ms-per-20', statKey: 'PER', threshold: 20, abilityName: 'True Sight', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+3 Accuracy & +2 Range Spaces to spot weakpoints.' },
  { id: 'ms-per-40', statKey: 'PER', threshold: 40, abilityName: 'Weakpoint Lock', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+5 Accuracy & +3 Range Spaces.' },
  { id: 'ms-per-60', statKey: 'PER', threshold: 60, abilityName: 'Eagle Horizon', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+7 Accuracy, +5 Range Spaces, pierces stealth.' },
  { id: 'ms-per-80', statKey: 'PER', threshold: 80, abilityName: 'Fatal Foresight', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+10 Accuracy & +2 reaction parry.' },
  { id: 'ms-per-100', statKey: 'PER', threshold: 100, abilityName: 'All-Seeing Eye', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+14 Accuracy, ignores cover & stealth.' },
  // LUCK (20, 40, 60, 80, 100)
  { id: 'ms-luck-20', statKey: 'LUCK', threshold: 20, abilityName: 'Fatebreaker', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: 'Critical hits trigger on 18-20 & +25% treasure luck.' },
  { id: 'ms-luck-40', statKey: 'LUCK', threshold: 40, abilityName: "Gambler's Miracle", bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: 'Reroll any d20 or d100 roll (1/battle).' },
  { id: 'ms-luck-60', statKey: 'LUCK', threshold: 60, abilityName: 'Golden Providence', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: 'Crits on 17-20 & +50% gold/loot luck.' },
  { id: 'ms-luck-80', statKey: 'LUCK', threshold: 80, abilityName: 'Karma Reversal', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: 'Turn an incoming crit into a miss (1/battle).' },
  { id: 'ms-luck-100', statKey: 'LUCK', threshold: 100, abilityName: 'Sovereign of Fortune', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: 'Crits on 15-20 & guaranteed rare treasure drops.' },
];

function buildCharacterVarScope(character, mechanics, extra = {}) {
  const totals = getEquippedTotals(character);
  const vars = {
    LEVEL: Number(character?.level || 1),
    HP: Number(character?.hp || 0),
    MAX_HP: Number(character?.maxHp || 1),
    MP: Number(character?.mp || 0),
    MAX_MP: Number(character?.maxMp || 0),
    AC: Number(character?.ac || 10),
    DR: Number(character?.dr || 0),
    SPEED: Number(character?.speed || 30),
    FAVOR: Number(character?.favor || 0),
    WEAPON_BONUS: Number(totals.attackBonus || 0),
    ARMOR_DR: Number(totals.armorDr || 0),
    ARMOR_AC: Number(totals.armorAc || 0),
  };

  for (const s of mechanics?.stats || []) {
    const key = String(s.key || '').toUpperCase();
    if (key) vars[key] = Number(character?.stats?.[key] ?? s.defaultValue ?? 10);
  }
  for (const [k, v] of Object.entries(character?.stats || {})) {
    vars[k.toUpperCase()] = Number(v || 0);
  }
  for (const [k, v] of Object.entries(extra)) {
    vars[k.toUpperCase()] = Number(v || 0);
  }
  return vars;
}

function computeStatModifier(score, mechanics, character) {
  const formula = mechanics?.statFormula || 'floor((SCORE - 10) / 2)';
  const scope = buildCharacterVarScope(character, mechanics, { SCORE: Number(score || 0) });
  return Math.trunc(evaluateFormula(formula, scope));
}

// ---------------------------------------------------------------------------
// Password Hashing (salted scrypt)
// ---------------------------------------------------------------------------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------------------
// Dice Engine (supports d1..d100, formulas like 2d12+4, Adv/Disadv/Exploding)
// ---------------------------------------------------------------------------
function rollSingleDie(sides) {
  const safeSides = Math.max(1, Math.min(100, Math.trunc(Number(sides) || 20)));
  return crypto.randomInt(1, safeSides + 1);
}

function rollDiceServer({ count = 1, sides = 20, modifier = 0, mode = 'normal', formula = '' }) {
  let parsedCount = Math.max(1, Math.min(30, Math.trunc(Number(count) || 1)));
  let parsedSides = Math.max(1, Math.min(100, Math.trunc(Number(sides) || 20)));
  let parsedMod = Math.trunc(Number(modifier) || 0);

  if (formula && typeof formula === 'string') {
    const clean = formula.replace(/\s+/g, '');
    const m = clean.match(/^(\d+)?d(\d+)([+-]\d+)?$/i);
    if (m) {
      parsedCount = Math.max(1, Math.min(30, Number(m[1] || 1)));
      parsedSides = Math.max(1, Math.min(100, Number(m[2])));
      parsedMod = Number(m[3] || 0);
    } else if (/^[+-]?\d+$/.test(clean)) {
      parsedCount = 1;
      parsedSides = 1;
      parsedMod = Number(clean) - 1;
    }
  }

  let rolls = [];
  let dropped = [];
  let diceTotal = 0;

  if ((mode === 'advantage' || mode === 'disadvantage') && parsedCount === 1) {
    const a = rollSingleDie(parsedSides);
    const b = rollSingleDie(parsedSides);
    const keep = mode === 'advantage' ? Math.max(a, b) : Math.min(a, b);
    const drop = mode === 'advantage' ? Math.min(a, b) : Math.max(a, b);
    rolls = [keep];
    dropped = [drop];
    diceTotal = keep;
  } else if (mode === 'exploding' && parsedSides > 1) {
    for (let i = 0; i < parsedCount; i++) {
      let guard = 0;
      let r = rollSingleDie(parsedSides);
      rolls.push(r);
      diceTotal += r;
      while (r === parsedSides && guard < 5) {
        guard++;
        r = rollSingleDie(parsedSides);
        rolls.push(r);
        diceTotal += r;
      }
    }
  } else {
    for (let i = 0; i < parsedCount; i++) {
      const r = rollSingleDie(parsedSides);
      rolls.push(r);
      diceTotal += r;
    }
  }

  const total = diceTotal + parsedMod;
  const modSuffix = parsedMod === 0 ? '' : parsedMod > 0 ? `+${parsedMod}` : `${parsedMod}`;
  const displayFormula = `${parsedCount}d${parsedSides}${modSuffix}`;
  const isCrit = parsedSides >= 20 && parsedCount === 1 && rolls[0] === parsedSides;
  const isFumble = parsedSides >= 20 && parsedCount === 1 && rolls[0] === 1;

  return {
    count: parsedCount,
    sides: parsedSides,
    modifier: parsedMod,
    mode,
    formula: displayFormula,
    rolls,
    dropped,
    diceTotal,
    total,
    isCrit,
    isFumble,
  };
}

// ---------------------------------------------------------------------------
// Prompt-Based AI Character Art Generator (Manhwa / Dark Fantasy SVG Synthesis)
// ---------------------------------------------------------------------------
function analyzeArtPrompt(promptText, style, character) {
  const lower = `${promptText || ''} ${character?.race || ''} ${character?.className || ''}`.toLowerCase();

  let palette = { bg1: '#091529', bg2: '#1e1b4b', accent: '#38bdf8', glow: '#00e5ff', skin: '#f1c29b', armor: '#334155', trim: '#94a3b8' };
  if (/fire|crimson|red|flame|inferno|dragon|blood/.test(lower)) {
    palette = { bg1: '#1a080c', bg2: '#450a0a', accent: '#f97316', glow: '#ef4444', skin: '#eac09d', armor: '#292524', trim: '#fbbf24' };
  } else if (/shadow|void|necromancer|dark|purple|violet|solo|assassin|monarch/.test(lower)) {
    palette = { bg1: '#070612', bg2: '#2e1065', accent: '#a855f7', glow: '#c084fc', skin: '#e2d5e8', armor: '#18181b', trim: '#38bdf8' };
  } else if (/emerald|nature|forest|poison|jade|druid|ranger|elf/.test(lower)) {
    palette = { bg1: '#041b15', bg2: '#064e3b', accent: '#34d399', glow: '#10b981', skin: '#f5d0b5', armor: '#1e293b', trim: '#a7f3d0' };
  } else if (/gold|holy|paladin|sun|light|cleric|angel/.test(lower)) {
    palette = { bg1: '#1c1507', bg2: '#422006', accent: '#fbbf24', glow: '#fde047', skin: '#f3c6a5', armor: '#475569', trim: '#fef08a' };
  } else if (/ice|frost|blue|shinsu|mana|wizard|mage|arcane/.test(lower)) {
    palette = { bg1: '#041225', bg2: '#0c4a6e', accent: '#38bdf8', glow: '#67e8f9', skin: '#f2d3be', armor: '#1e293b', trim: '#7dd3fc' };
  }

  let raceTraits = 'human';
  if (/tiefling|demon|horn/.test(lower)) {
    raceTraits = 'tiefling';
    palette.skin = '#c08497';
  } else if (/elf|elven|high elf/.test(lower)) {
    raceTraits = 'elf';
  } else if (/dwarf|bearded/.test(lower)) {
    raceTraits = 'dwarf';
  } else if (/dragonborn|reptile|draconic/.test(lower)) {
    raceTraits = 'dragonborn';
    palette.skin = '#b91c1c';
  }

  let weapon = 'sword';
  if (/dagger|twin|rogue|assassin|kunai/.test(lower)) weapon = 'daggers';
  else if (/staff|wand|orb|mage|wizard|caster/.test(lower)) weapon = 'staff';
  else if (/hammer|mace|axe|paladin|warrior/.test(lower)) weapon = 'hammer';
  else if (/bow|archer|spear/.test(lower)) weapon = 'bow';

  let hairColor = '#1e293b';
  if (/silver|white|snow/.test(lower)) hairColor = '#e2e8f0';
  else if (/red|crimson|ginger/.test(lower)) hairColor = '#dc2626';
  else if (/blonde|gold/.test(lower)) hairColor = '#facc15';
  else if (/blue|cyan/.test(lower)) hairColor = '#0284c7';
  else if (/purple|violet/.test(lower)) hairColor = '#7e22ce';

  return { palette, raceTraits, weapon, hairColor, style: style || 'Korean Manhwa Webtoon' };
}

function generateSvgPortraitDataUri(promptText, style, character) {
  const { palette, raceTraits, weapon, hairColor, style: artStyle } = analyzeArtPrompt(promptText, style, character);
  const hash = crypto.createHash('md5').update(`${promptText}|${artStyle}|${character?.name || ''}`).digest('hex');
  const seedNum = parseInt(hash.slice(0, 6), 16);
  const runeRotation = seedNum % 360;
  const starOffset = (seedNum % 25) + 10;

  const esc = (s) => String(s || '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

  const hornSvg = raceTraits === 'tiefling'
    ? `<path d="M105 92 C86 64, 88 38, 102 28 C98 48, 104 70, 118 85 Z" fill="#18181b" stroke="${palette.accent}" stroke-width="2"/>
       <path d="M195 92 C214 64, 212 38, 198 28 C202 48, 196 70, 182 85 Z" fill="#18181b" stroke="${palette.accent}" stroke-width="2"/>`
    : '';
  const earSvg = raceTraits === 'elf'
    ? `<polygon points="103,115 78,104 103,130" fill="${palette.skin}"/>
       <polygon points="197,115 222,104 197,130" fill="${palette.skin}"/>`
    : '';
  const beardSvg = raceTraits === 'dwarf'
    ? `<path d="M116 142 Q150 202 184 142 L176 184 Q150 206 124 184 Z" fill="${hairColor}" stroke="#0f172a" stroke-width="2"/>`
    : '';

  let weaponSvg = '';
  if (weapon === 'daggers') {
    weaponSvg = `
      <path d="M62 245 L38 148 L56 172 L74 240 Z" fill="#e2e8f0" stroke="${palette.glow}" stroke-width="2.5"/>
      <path d="M238 245 L262 148 L244 172 L226 240 Z" fill="#e2e8f0" stroke="${palette.glow}" stroke-width="2.5"/>`;
  } else if (weapon === 'staff') {
    weaponSvg = `
      <line x1="238" y1="305" x2="238" y2="75" stroke="#78350f" stroke-width="7" stroke-linecap="round"/>
      <circle cx="238" cy="66" r="18" fill="${palette.glow}" opacity="0.28"/>
      <circle cx="238" cy="66" r="11" fill="${palette.accent}" stroke="#fff" stroke-width="2"/>`;
  } else if (weapon === 'hammer') {
    weaponSvg = `
      <line x1="236" y1="305" x2="226" y2="115" stroke="#78350f" stroke-width="8" stroke-linecap="round"/>
      <rect x="195" y="92" width="62" height="32" rx="5" fill="#64748b" stroke="${palette.trim}" stroke-width="3"/>`;
  } else if (weapon === 'bow') {
    weaponSvg = `
      <path d="M228 85 Q272 180 228 280" fill="none" stroke="${palette.trim}" stroke-width="6"/>
      <line x1="228" y1="85" x2="228" y2="280" stroke="${palette.glow}" stroke-width="1.5"/>`;
  } else {
    weaponSvg = `
      <polygon points="238,72 248,225 228,225" fill="#e2e8f0" stroke="${palette.glow}" stroke-width="2.5"/>
      <rect x="218" y="225" width="40" height="8" rx="3" fill="${palette.trim}"/>
      <rect x="233" y="233" width="10" height="28" fill="#451a03"/>`;
  }

  const pixelOverlay = artStyle.toLowerCase().includes('pixel')
    ? `<pattern id="px" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="1"/></pattern><rect width="300" height="340" fill="url(#px)"/>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 340" width="300" height="340">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%" stop-color="${palette.bg1}"/>
        <stop offset="100%" stop-color="${palette.bg2}"/>
      </linearGradient>
      <radialGradient id="aura" cx="50%" cy="42%" r="52%">
        <stop offset="0%" stop-color="${palette.glow}" stop-opacity="0.48"/>
        <stop offset="70%" stop-color="${palette.accent}" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="${palette.bg1}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="cloak" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${palette.armor}"/>
        <stop offset="100%" stop-color="#090d16"/>
      </linearGradient>
    </defs>
    <rect width="300" height="340" rx="18" fill="url(#bg)"/>
    <rect width="300" height="340" rx="18" fill="url(#aura)"/>
    <polygon points="150,18 192,160 108,160" fill="${palette.accent}" opacity="0.1"/>
    <g transform="translate(150 125) rotate(${runeRotation})">
      <circle r="86" fill="none" stroke="${palette.accent}" stroke-width="1.5" stroke-dasharray="10 6" opacity="0.5"/>
      <circle r="72" fill="none" stroke="${palette.glow}" stroke-width="1" stroke-dasharray="3 8" opacity="0.6"/>
    </g>
    <circle cx="${40 + starOffset}" cy="64" r="2.5" fill="${palette.glow}"/>
    <circle cx="${250 - starOffset}" cy="92" r="3" fill="${palette.accent}"/>
    <circle cx="58" cy="212" r="2" fill="#fff" opacity="0.7"/>
    <circle cx="248" cy="238" r="2.5" fill="${palette.glow}" opacity="0.8"/>
    <path d="M52 340 L72 215 Q150 178 228 215 L248 340 Z" fill="url(#cloak)" stroke="${palette.trim}" stroke-width="2.5"/>
    <path d="M84 220 L150 258 L216 220" fill="none" stroke="${palette.accent}" stroke-width="3"/>
    <polygon points="150,242 162,258 150,274 138,258" fill="${palette.glow}" stroke="#fff" stroke-width="1.5"/>
    <rect x="134" y="160" width="32" height="36" rx="10" fill="${palette.skin}"/>
    ${earSvg}
    <ellipse cx="150" cy="122" rx="45" ry="52" fill="${palette.skin}" stroke="#0f172a" stroke-width="2"/>
    <path d="M100 122 C96 72, 128 54, 150 56 C176 54, 204 72, 200 122 C192 94, 174 84, 150 86 C126 84, 108 94, 100 122 Z" fill="${hairColor}"/>
    ${hornSvg}
    <ellipse cx="132" cy="122" rx="7" ry="4.5" fill="#0f172a"/>
    <ellipse cx="168" cy="122" rx="7" ry="4.5" fill="#0f172a"/>
    <circle cx="133" cy="122" r="3.2" fill="${palette.glow}"/>
    <circle cx="167" cy="122" r="3.2" fill="${palette.glow}"/>
    <path d="M140 144 Q150 149 160 144" fill="none" stroke="#7c2d12" stroke-width="2" stroke-linecap="round"/>
    ${beardSvg}
    ${weaponSvg}
    ${pixelOverlay}
    <rect x="8" y="8" width="284" height="324" rx="14" fill="none" stroke="${palette.accent}" stroke-opacity="0.55" stroke-width="2"/>
    <rect x="14" y="294" width="272" height="30" rx="6" fill="#020617" fill-opacity="0.82" stroke="${palette.accent}" stroke-opacity="0.5"/>
    <text x="150" y="313" text-anchor="middle" fill="${palette.glow}" font-family="Segoe UI, sans-serif" font-size="11" font-weight="700" letter-spacing="1.2">${esc((character?.name || 'CHALLENGER').toUpperCase().slice(0, 22))} • ${esc(artStyle.toUpperCase().slice(0, 14))}</text>
  </svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

async function generateCharacterArt(promptText, style, character) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey && typeof fetch === 'function') {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: `${style || 'Korean manhwa webtoon character portrait'}, ${promptText}` }],
            parameters: { sampleCount: 1, aspectRatio: '3:4' },
          }),
        }
      );
      if (resp.ok) {
        const json = await resp.json();
        const b64 = json?.predictions?.[0]?.bytesBase64Encoded;
        if (b64) {
          return {
            url: `data:image/png;base64,${b64}`,
            engine: 'gemini-imagen-3',
          };
        }
      }
    } catch {
      // Fallback cleanly to deterministic SVG fantasy synthesis
    }
  }
  return {
    url: generateSvgPortraitDataUri(promptText, style, character),
    engine: 'arcane-vector-synth',
  };
}

// ---------------------------------------------------------------------------
// Google Docs Public Importer for Deity System Lore
// ---------------------------------------------------------------------------
function extractGoogleDocId(url) {
  const m = String(url || '').match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function parseDeityTextIntoEntries(rawText, sourceDocUrl = '') {
  const blocks = String(rawText || '')
    .split(/\n{2,}|^---+$|^===+$/m)
    .map((b) => b.trim())
    .filter(Boolean);

  if (!blocks.length) return [];
  const parsed = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    let name = lines[0].replace(/^#+\s*/, '').replace(/^Deity:\s*/i, '').trim();
    let domain = 'Cosmic / Tower Patron';
    let blessingName = 'Divine Resonance';
    let boonFormula = '+2 Damage';
    let rangeSpaces = 6;
    const descLines = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^domain:/i.test(line)) domain = line.replace(/^domain:/i, '').trim();
      else if (/^blessing:/i.test(line)) blessingName = line.replace(/^blessing:/i, '').trim();
      else if (/^boon:/i.test(line)) boonFormula = line.replace(/^boon:/i, '').trim();
      else if (/^range:/i.test(line)) rangeSpaces = Number(line.match(/\d+/)?.[0] || 6);
      else descLines.push(line);
    }

    parsed.push({
      id: `deity-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name: name.slice(0, 60),
      title: domain,
      domain,
      alignment: 'Constellation Patron',
      tenets: descLines.join(' ') || block,
      blessingName,
      blessingDescription: descLines.join(' ') || `Grants ${boonFormula} when invoked.`,
      boonFormula,
      miracleRangeSpaces: rangeSpaces,
      favorCost: 1,
      sourceDocUrl,
    });
  }
  return parsed.slice(0, 12);
}

// ---------------------------------------------------------------------------
// Initial Tower + System Campaign Seed
// ---------------------------------------------------------------------------
function getInitialState() {
  const floors = [
    { number: 1, title: '1F • Gate of Trials (Safe Zone)', theme: 'forest', rowStart: 0, rowEnd: 4, safeZone: true, portalRow: 0, portalCol: 5, description: 'Base camp for newly awakened tower climbers.' },
  ];

  const defaultFog = [];

  const defaultMechanics = {
    presetName: 'Tower System Reactive Hybrid',
    combatMode: 'reactive', // 'reactive' | 'turn_based'
    reactionRule: 'Counter-Strike or Parry/Spell whenever attacked by a monster',
    distanceUnit: 'Spaces',
    stats: [
      { key: 'STR', name: 'Strength', defaultValue: 14 },
      { key: 'AGI', name: 'Agility', defaultValue: 14 },
      { key: 'VIT', name: 'Vitality', defaultValue: 14 },
      { key: 'INT', name: 'Intelligence', defaultValue: 12 },
      { key: 'PER', name: 'Perception', defaultValue: 12 },
      { key: 'LUCK', name: 'Luck', defaultValue: 10 },
    ],
    statFormula: 'floor((SCORE - 10) / 2)',
    hitFormula: 'ROLL + STAT_MOD + WEAPON_BONUS',
    damageFormula: 'max(1, (RAW_DMG * CRIT_MULT) + STAT_MOD - TARGET_DR)',
    critMultiplier: 2,
    critThreshold: 20,
    resourceName: 'Mana (MP)',
    showExactMonsterHpToPlayers: true,
    statMilestones: DEFAULT_STAT_MILESTONES.map((m) => ({ ...m })),
  };

  // Free-Flow Tower Grimoire (available for any player to freely learn or adapt!)
  const grimoire = [
    {
      id: 'sp-shinsu-lance',
      name: 'Azure Shinsu Lance',
      element: 'Arcane / Shinsu',
      mpCost: 6,
      damageDice: '3d8+4',
      damageType: 'Arcane',
      rangeSpaces: 8,
      areaText: 'Single Target (Line up to 8 Spaces)',
      actionType: 'Action',
      explanation: 'Compresses ambient Tower mana into a piercing lance of liquid light. Pierces 1 point of enemy DR and flies up to 8 grid spaces in a straight line.',
    },
    {
      id: 'sp-crimson-nova',
      name: 'Crimson Sovereign Burst',
      element: 'Fire',
      mpCost: 8,
      damageDice: '4d6+3',
      damageType: 'Fire',
      rangeSpaces: 6,
      areaText: '2-Space Radius Blast within 6 Spaces',
      actionType: 'Action',
      explanation: 'Detonates condensed flame at a chosen space within 6 spaces. Scorches targets in a 2-space radius and leaves burning embers for 1 round.',
    },
    {
      id: 'sp-shadow-riposte',
      name: 'Shadow Counter-Fang',
      element: 'Shadow',
      mpCost: 4,
      damageDice: '2d8+4',
      damageType: 'Shadow',
      rangeSpaces: 3,
      areaText: '1 Enemy within 3 Spaces (Reaction)',
      actionType: 'Reaction',
      explanation: 'Triggered immediately when a monster strikes you! Blink through shadows up to 3 spaces and slash back with a necrotic blade before recovering stance.',
    },
    {
      id: 'sp-aegis-pulse',
      name: 'System Aegis Ward',
      element: 'Barrier',
      mpCost: 5,
      damageDice: '1d10+3',
      damageType: 'Force',
      rangeSpaces: 1,
      areaText: 'Self + Adjacent 1-Space Shockwave (Reaction)',
      actionType: 'Reaction',
      explanation: 'Projects an emergency geometric System barrier that absorbs half incoming impact and blasts adjacent monsters 1 space back with Force damage.',
    },
    {
      id: 'sp-tempest-arrow',
      name: 'Gale Piercer Volley',
      element: 'Wind / Lightning',
      mpCost: 5,
      damageDice: '2d10+3',
      damageType: 'Lightning',
      rangeSpaces: 10,
      areaText: 'Long Range (Up to 10 Spaces)',
      actionType: 'Action',
      explanation: 'Fires hyper-accelerated wind bolts across the floor up to 10 spaces away. Ignores partial cover and shocks armored foes.',
    },
    {
      id: 'sp-sanctuary-ray',
      name: 'Constellation Dawn Ray',
      element: 'Radiant',
      mpCost: 6,
      damageDice: '2d8+4',
      damageType: 'Radiant',
      rangeSpaces: 6,
      areaText: '6 Spaces (Also restores 1d8 HP to caster)',
      actionType: 'Action',
      explanation: 'Channels patron starlight onto a foe within 6 spaces, searing monsters with radiant fire while knitting minor wounds.',
    },
  ];

  // Deity & Constellation Patron Framework (supports Google Docs lore sync)
  const deities = [
    {
      id: 'deity-aetherion',
      name: 'Aetherion, Architect of the First Spire',
      title: 'Patron of Shinsu & Arcane Order',
      domain: 'Magic, Knowledge & Tower Law',
      alignment: 'Lawful Neutral',
      tenets: 'Seek hidden truth on every floor; never waste mana without purpose.',
      blessingName: 'Resonant Amplification',
      blessingDescription: 'Spend 1 Divine Favor to empower your next spell with +6 Arcane damage and +2 Spaces of range.',
      boonFormula: '+6 Arcane Damage',
      miracleRangeSpaces: 8,
      favorCost: 1,
      sourceDocUrl: '',
    },
    {
      id: 'deity-nyx',
      name: 'Nyx-Vael, Sovereign of Abyssal Shadows',
      title: 'Constellation of the Silent Fang',
      domain: 'Shadow, Vengeance & Reactive Ambush',
      alignment: 'Chaotic Neutral',
      tenets: 'Strike back twice as hard whenever an enemy dares touch you.',
      blessingName: 'Shadow Retaliation',
      blessingDescription: 'Spend 1 Divine Favor during a monster attack reaction to deal +8 Shadow Counter damage.',
      boonFormula: '+8 Shadow Counter Damage',
      miracleRangeSpaces: 4,
      favorCost: 1,
      sourceDocUrl: '',
    },
    {
      id: 'deity-ignis',
      name: 'Ignis-Rex, Crimson Forgemaster',
      title: 'Lord of Unbroken Steel & Flame',
      domain: 'War, Valor & Armor',
      alignment: 'Neutral Good',
      tenets: 'Stand in the vanguard; shield weaker climbers from floor bosses.',
      blessingName: 'Molten Aegis Strike',
      blessingDescription: 'Spend 1 Divine Favor to gain +10 Temp HP and ignite your weapon for +6 Fire damage.',
      boonFormula: '+10 Temp HP & +6 Fire',
      miracleRangeSpaces: 2,
      favorCost: 1,
      sourceDocUrl: '',
    },
    {
      id: 'deity-verdantia',
      name: 'Verdantia, Keeper of Soul Springs',
      title: 'Goddess of Vitality & Sanctuary',
      domain: 'Life, Healing & Fate',
      alignment: 'Lawful Good',
      tenets: 'Preserve life against the Tower trials and mend fallen allies.',
      blessingName: 'Spring of Awakening',
      blessingDescription: 'Spend 1 Divine Favor to instantly restore 18 HP and 12 MP without consuming an item.',
      boonFormula: 'Heal 18 HP + 12 MP',
      miracleRangeSpaces: 6,
      favorCost: 1,
      sourceDocUrl: '',
    },
  ];

  const characters = {
    'char-1': {
      id: 'char-1',
      name: 'Thalindra Moonwhisper',
      race: 'High Elf',
      className: 'Wave Controller / Mage',
      rank: 'E-Rank',
      level: 1,
      xp: 0,
      xpToNext: 100,
      unspentStatPoints: 10,
      hp: 34,
      maxHp: 34,
      tempHp: 0,
      mp: 45,
      maxMp: 45,
      ac: 14,
      dr: 2,
      speed: 30,
      speedSpaces: 6,
      patronDeityId: 'deity-aetherion',
      favor: 3,
      inspiration: true,
      stats: { STR: 8, AGI: 14, VIT: 12, INT: 18, PER: 14, LUCK: 12 },
      skills: [
        { name: 'Shinsu / Arcana Control', stat: 'INT', bonus: 3 },
        { name: 'Mana Sense', stat: 'PER', bonus: 2 },
        { name: 'Tower Lore', stat: 'INT', bonus: 2 },
      ],
      spells: [grimoire[0], grimoire[1], grimoire[3]],
      equipment: {
        mainHand: { id: 'eq-t1', name: 'Azure Shinsu Staff', slot: 'mainHand', type: 'weapon', attackBonus: 6, damageDice: '2d8+4', damageType: 'Arcane', rangeSpaces: 6, drBonus: 0, acBonus: 0 },
        offHand: { id: 'eq-t2', name: 'Mana Prism Orb', slot: 'offHand', type: 'relic', attackBonus: 1, damageDice: '', damageType: '', rangeSpaces: 1, drBonus: 1, acBonus: 1 },
        head: { id: 'eq-t3', name: 'Circlet of Clear Thought', slot: 'head', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 0, acBonus: 1 },
        body: { id: 'eq-t4', name: 'Starweave Coat', slot: 'body', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 1, acBonus: 2 },
        boots: null,
        relic: null,
      },
      inventory: [
        { id: 'inv-1', name: 'Greater Mana Elixir', category: 'consumable', qty: 3, healHp: 0, healMp: 20, slot: '', attackBonus: 0, damageDice: '', drBonus: 0, acBonus: 0, notes: 'Restores 20 MP' },
        { id: 'inv-2', name: 'Lesser Healing Potion', category: 'consumable', qty: 2, healHp: 14, healMp: 0, slot: '', attackBonus: 0, damageDice: '', drBonus: 0, acBonus: 0, notes: 'Restores 14 HP' },
        { id: 'inv-3', name: 'Tower Return Stone', category: 'relic', qty: 1, healHp: 0, healMp: 0, slot: 'relic', attackBonus: 0, damageDice: '', drBonus: 1, acBonus: 0, notes: 'Teleports to 1F Safe Zone' },
      ],
      currency: { gold: 240, manaStones: 6 },
      conditions: [],
      notes: 'Searching for the Forgotten Grimoire on 5F.',
      portraitPrompt: 'High elf female arcane wave controller mage in blue starweave coat holding a glowing cyan mana staff, Korean manhwa webtoon style',
      portraitStyle: 'Korean Manhwa Webtoon',
      portraitUrl: '',
      artHistory: [],
    },
    'char-2': {
      id: 'char-2',
      name: 'Kaelen Ironheart',
      race: 'Human',
      className: 'Shadow Vanguard / Knight',
      rank: 'E-Rank',
      level: 1,
      xp: 0,
      xpToNext: 100,
      unspentStatPoints: 10,
      hp: 52,
      maxHp: 52,
      tempHp: 4,
      mp: 20,
      maxMp: 20,
      ac: 18,
      dr: 4,
      speed: 30,
      speedSpaces: 6,
      patronDeityId: 'deity-ignis',
      favor: 3,
      inspiration: false,
      stats: { STR: 18, AGI: 12, VIT: 16, INT: 10, PER: 12, LUCK: 11 },
      skills: [
        { name: 'Heavy Blade Mastery', stat: 'STR', bonus: 3 },
        { name: 'Boss Threat Aura', stat: 'VIT', bonus: 2 },
        { name: 'Trap Detection', stat: 'PER', bonus: 1 },
      ],
      spells: [grimoire[3], grimoire[2]],
      equipment: {
        mainHand: { id: 'eq-k1', name: 'Obsidian Greatsword', slot: 'mainHand', type: 'weapon', attackBonus: 7, damageDice: '2d6+4', damageType: 'Slashing', rangeSpaces: 2, drBonus: 0, acBonus: 0 },
        offHand: { id: 'eq-k2', name: 'Aegis Buckler', slot: 'offHand', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 1, drBonus: 2, acBonus: 2 },
        head: null,
        body: { id: 'eq-k3', name: 'Ranker Plate Armor', slot: 'body', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 2, acBonus: 4 },
        boots: { id: 'eq-k4', name: 'Greaves of Iron', slot: 'boots', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 0, acBonus: 1 },
        relic: null,
      },
      inventory: [
        { id: 'inv-k1', name: 'Crimson Healing Vial', category: 'consumable', qty: 3, healHp: 18, healMp: 0, slot: '', attackBonus: 0, damageDice: '', drBonus: 0, acBonus: 0, notes: 'Restores 18 HP' },
        { id: 'inv-k2', name: 'Kasaka Venom Fang', category: 'weapon', qty: 1, healHp: 0, healMp: 0, slot: 'mainHand', attackBonus: 6, damageDice: '1d10+4', damageType: 'Piercing', rangeSpaces: 1, drBonus: 0, acBonus: 0, notes: 'Fast bleed dagger' },
      ],
      currency: { gold: 315, manaStones: 4 },
      conditions: [],
      notes: 'Frontline tank protecting climbers on Floor 2.',
      portraitPrompt: 'Armored human vanguard knight with glowing cyan eyes holding an obsidian greatsword, dark fantasy Solo Leveling manhwa aesthetic',
      portraitStyle: 'Korean Manhwa Webtoon',
      portraitUrl: '',
      artHistory: [],
    },
    'char-3': {
      id: 'char-3',
      name: "Vex'ahlia Shadowstep",
      race: 'Tiefling',
      className: 'Shadow Assassin',
      rank: 'E-Rank',
      level: 1,
      xp: 0,
      xpToNext: 100,
      unspentStatPoints: 10,
      hp: 40,
      maxHp: 40,
      tempHp: 0,
      mp: 28,
      maxMp: 28,
      ac: 16,
      dr: 2,
      speed: 35,
      speedSpaces: 7,
      patronDeityId: 'deity-nyx',
      favor: 4,
      inspiration: true,
      stats: { STR: 10, AGI: 19, VIT: 14, INT: 14, PER: 15, LUCK: 16 },
      skills: [
        { name: 'Shadow Step', stat: 'AGI', bonus: 4 },
        { name: 'Critical Ambush', stat: 'LUCK', bonus: 3 },
        { name: 'Lockpick / Disarm', stat: 'AGI', bonus: 3 },
      ],
      spells: [grimoire[2], grimoire[4]],
      equipment: {
        mainHand: { id: 'eq-v1', name: 'Twin Nightfang Daggers', slot: 'mainHand', type: 'weapon', attackBonus: 8, damageDice: '3d6+4', damageType: 'Shadow', rangeSpaces: 2, drBonus: 0, acBonus: 0 },
        offHand: null,
        head: null,
        body: { id: 'eq-v2', name: 'Midnight Stalker Leather', slot: 'body', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 2, acBonus: 3 },
        boots: { id: 'eq-v3', name: 'Whispering Boots', slot: 'boots', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 0, acBonus: 1 },
        relic: null,
      },
      inventory: [
        { id: 'inv-v1', name: 'Smoke Bomb', category: 'consumable', qty: 4, healHp: 0, healMp: 0, slot: '', attackBonus: 0, damageDice: '', drBonus: 0, acBonus: 0, notes: 'Grants stealth cover' },
        { id: 'inv-v2', name: 'Greater Healing Potion', category: 'consumable', qty: 2, healHp: 20, healMp: 0, slot: '', attackBonus: 0, damageDice: '', drBonus: 0, acBonus: 0, notes: 'Restores 20 HP' },
      ],
      currency: { gold: 410, manaStones: 8 },
      conditions: [],
      notes: 'Scouting ahead for floor guardians.',
      portraitPrompt: 'Tiefling shadow assassin with curved horns and glowing purple twin daggers in midnight leather armor, Korean webtoon portrait',
      portraitStyle: 'Korean Manhwa Webtoon',
      portraitUrl: '',
      artHistory: [],
    },
    'char-4': {
      id: 'char-4',
      name: 'Bramwell Oakshield',
      race: 'Dwarf',
      className: 'Sanctuary Cleric',
      rank: 'E-Rank',
      level: 1,
      xp: 0,
      xpToNext: 100,
      unspentStatPoints: 10,
      hp: 46,
      maxHp: 46,
      tempHp: 0,
      mp: 40,
      maxMp: 40,
      ac: 17,
      dr: 3,
      speed: 25,
      speedSpaces: 5,
      patronDeityId: 'deity-verdantia',
      favor: 4,
      inspiration: false,
      stats: { STR: 14, AGI: 10, VIT: 16, INT: 11, PER: 18, LUCK: 12 },
      skills: [
        { name: 'Divine Restoration', stat: 'PER', bonus: 4 },
        { name: 'Guardian Ward', stat: 'VIT', bonus: 3 },
      ],
      spells: [grimoire[5], grimoire[3]],
      equipment: {
        mainHand: { id: 'eq-b1', name: 'Sunfire Warhammer', slot: 'mainHand', type: 'weapon', attackBonus: 6, damageDice: '1d10+3', damageType: 'Radiant', rangeSpaces: 1, drBonus: 0, acBonus: 0 },
        offHand: { id: 'eq-b2', name: 'Tower Shield of Dawn', slot: 'offHand', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 1, drBonus: 2, acBonus: 2 },
        head: null,
        body: { id: 'eq-b3', name: 'Blessed Scale Mail', slot: 'body', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 1, acBonus: 3 },
        boots: null,
        relic: null,
      },
      inventory: [
        { id: 'inv-b1', name: 'Sacred Water Flask', category: 'consumable', qty: 3, healHp: 16, healMp: 10, slot: '', attackBonus: 0, damageDice: '', drBonus: 0, acBonus: 0, notes: 'Restores 16 HP & 10 MP' },
      ],
      currency: { gold: 195, manaStones: 5 },
      conditions: [],
      notes: 'Keeps party alive through brutal Tower trials.',
      portraitPrompt: 'Bearded dwarf cleric in golden blessed armor wielding a radiant sunfire hammer, dark fantasy portrait',
      portraitStyle: 'Dark Fantasy Concept',
      portraitUrl: '',
      artHistory: [],
    },
  };

  for (const ch of Object.values(characters)) {
    ch.portraitUrl = generateSvgPortraitDataUri(ch.portraitPrompt, ch.portraitStyle, ch);
    ch.artHistory = [{ id: `art-${ch.id}-init`, prompt: ch.portraitPrompt, style: ch.portraitStyle, url: ch.portraitUrl, createdAt: new Date().toISOString() }];
  }

  const playerAccounts = {
    'thalindra@tower.gg': { id: 'acc-1', email: 'thalindra@tower.gg', username: 'thalindra', characterId: 'char-1', activated: false, salt: null, passwordHash: null, invitedAt: new Date().toISOString(), lastLoginAt: null },
    'kaelen@tower.gg': { id: 'acc-2', email: 'kaelen@tower.gg', username: 'kaelen', characterId: 'char-2', activated: false, salt: null, passwordHash: null, invitedAt: new Date().toISOString(), lastLoginAt: null },
    'vex@tower.gg': { id: 'acc-3', email: 'vex@tower.gg', username: 'vex', characterId: 'char-3', activated: false, salt: null, passwordHash: null, invitedAt: new Date().toISOString(), lastLoginAt: null },
    'bramwell@tower.gg': { id: 'acc-4', email: 'bramwell@tower.gg', username: 'bramwell', characterId: 'char-4', activated: false, salt: null, passwordHash: null, invitedAt: new Date().toISOString(), lastLoginAt: null },
  };

  const monsters = [];

  const tokens = [
    { id: 'char-1', name: 'Thalindra', x: 2, y: 2, color: '#38bdf8', type: 'player', hp: 34, maxHp: 34, hiddenFromPlayers: false, label: 'TH' },
    { id: 'char-2', name: 'Kaelen', x: 4, y: 3, color: '#f59e0b', type: 'player', hp: 52, maxHp: 52, hiddenFromPlayers: false, label: 'KA' },
    { id: 'char-3', name: "Vex'ahlia", x: 6, y: 2, color: '#a855f7', type: 'player', hp: 40, maxHp: 40, hiddenFromPlayers: false, label: 'VX' },
    { id: 'char-4', name: 'Bramwell', x: 8, y: 3, color: '#10b981', type: 'player', hp: 46, maxHp: 46, hiddenFromPlayers: false, label: 'BR' },
  ];

  const combatants = [
    { id: 'char-3', name: "Vex'ahlia Shadowstep", type: 'player', initiative: 21, hp: 40, maxHp: 40, ac: 16, hiddenFromPlayers: false },
    { id: 'char-2', name: 'Kaelen Ironheart', type: 'player', initiative: 15, hp: 52, maxHp: 52, ac: 18, hiddenFromPlayers: false },
    { id: 'char-1', name: 'Thalindra Moonwhisper', type: 'player', initiative: 14, hp: 34, maxHp: 34, ac: 14, hiddenFromPlayers: false },
    { id: 'char-4', name: 'Bramwell Oakshield', type: 'player', initiative: 10, hp: 46, maxHp: 46, ac: 17, hiddenFromPlayers: false },
  ].sort((a, b) => b.initiative - a.initiative);

  return {
    version: 1,
    session: {
      status: 'active',
      sessionNumber: 1,
      title: 'Tower of the Crimson Sovereign — Climb 1F–5F',
      pausedMessage: 'Waiting for the Dungeon Master to start the session...',
      startedAt: new Date().toISOString(),
    },
    mechanics: defaultMechanics,
    grimoire,
    deities,
    characters,
    playerAccounts,
    monsters,
    pendingReactions: [],
    bestiary: [
      { id: 'best-goblin', name: 'Goblin Gatekeeper', maxHp: 26, ac: 14, dr: 1, attackFormula: '1d20+5', damageFormula: '1d8+3', rangeSpaces: 2 },
      { id: 'best-skeleton', name: 'Iron Bone Sentinel', maxHp: 42, ac: 15, dr: 2, attackFormula: '1d20+6', damageFormula: '2d6+3', rangeSpaces: 2 },
      { id: 'best-lycan', name: 'Blood-Mane Lycan', maxHp: 64, ac: 15, dr: 2, attackFormula: '1d20+7', damageFormula: '2d8+4', rangeSpaces: 1 },
      { id: 'best-golem', name: 'Obsidian Floor Guardian', maxHp: 95, ac: 17, dr: 5, attackFormula: '1d20+8', damageFormula: '2d10+4', rangeSpaces: 2 },
      { id: 'best-shadow', name: 'High-Ranker Shadow Knight', maxHp: 120, ac: 18, dr: 4, attackFormula: '1d20+9', damageFormula: '3d8+5', rangeSpaces: 3 },
      { id: 'best-wyrm', name: 'Crimson Tower Wyrm', maxHp: 165, ac: 19, dr: 5, attackFormula: '1d20+10', damageFormula: '4d10+5', rangeSpaces: 5 },
    ],
    map: {
      cols: 10,
      rows: 5,
      theme: 'forest',
      floors,
      fog: defaultFog,
      tokens,
      pings: [],
    },
    combat: {
      active: true,
      round: 1,
      turnIndex: 0,
      combatants,
    },
    notes: {
      dmPrivate: 'SECRET DM INTEL:\n• 4F Shadow Guardian ambushes anyone carrying >200g.\n• 5F Crimson Wyrm has 4 DR; weak to Frost/Arcane (+5 bonus if players solve the 3F Shinsu riddle).',
      sharedQuests: 'TOWER TRIAL OBJECTIVE:\n[Main Quest] Ascend from 1F Gate of Trials to 5F and defeat the Crimson Sovereign.\n[Bonus Trial] Inflict real-time damage to clear Floor 2 & Floor 3 guardians.',
    },
    storyBeats: [
      {
        id: 'beat-1',
        order: 1,
        floor: 1,
        title: '1F • Awakening at the Gate',
        narration: 'The obsidian doors slam shut behind you. A translucent cyan System Window flickers to life: "Climb the Crimson Sovereign Tower, or perish on 1F."',
        dmSecret: 'Safe zone intro — let players inspect their Status Window, Equipment, and Patron Deity before ascending.',
        presented: true,
        status: 'active',
        xpReward: 50,
        arena: createDefaultBeatArena(20, 20, characters),
        encounters: [],
        treasures: [
          { id: 'tr-1', name: 'Starter Mana Crystal', category: 'consumable', qty: 1, gold: 50, manaStones: 2, healHp: 0, healMp: 15, damageDice: '', drBonus: 0, acBonus: 0, notes: 'Restores 15 MP' },
        ],
      },
      {
        id: 'beat-2',
        order: 2,
        floor: 2,
        title: '2F • The Goblin Vanguard Ambush',
        narration: 'As you step through the 2F Warp Gate, torchlight glints off jagged blades! Goblin Gatekeepers emerge from behind broken stone pillars.',
        dmSecret: 'Reveal 2F or spawn monsters directly. Award the Vanguard Blade when cleared.',
        presented: false,
        status: 'upcoming',
        xpReward: 100,
        arena: createDefaultBeatArena(20, 20, characters),
        encounters: [
          { name: 'Goblin Gatekeeper', maxHp: 26, ac: 14, dr: 1, rangeSpaces: 2, attackFormula: '1d20+5', damageFormula: '1d8+3', hiddenFromPlayers: false },
          { name: 'Goblin Skirmisher', maxHp: 18, ac: 13, dr: 0, rangeSpaces: 4, attackFormula: '1d20+4', damageFormula: '1d6+2', hiddenFromPlayers: false },
        ],
        treasures: [
          { id: 'tr-2', name: 'Vanguard Blade', category: 'weapon', qty: 1, gold: 120, manaStones: 3, healHp: 0, healMp: 0, damageDice: '2d6+3', damageType: 'Slashing', rangeSpaces: 2, drBonus: 0, acBonus: 0, notes: 'Looted from 2F Vanguard' },
        ],
      },
      {
        id: 'beat-3',
        order: 3,
        floor: 5,
        title: '5F • Throne of the Crimson Sovereign',
        narration: 'The apex chamber trembles as a colossal Crimson Tower Wyrm unfurls its wings above a sea of glowing mana!',
        dmSecret: 'Apex boss encounter. Unfog 5F when ready and trigger reactive boss attacks.',
        presented: false,
        status: 'upcoming',
        xpReward: 300,
        arena: createDefaultBeatArena(20, 20, characters),
        encounters: [
          { name: 'Crimson Tower Wyrm', maxHp: 165, ac: 19, dr: 5, rangeSpaces: 5, attackFormula: '1d20+10', damageFormula: '4d10+5', hiddenFromPlayers: false },
        ],
        treasures: [
          { id: 'tr-3', name: 'Sovereign Crown Relic', category: 'relic', qty: 1, gold: 500, manaStones: 15, healHp: 0, healMp: 0, damageDice: '', drBonus: 3, acBonus: 2, notes: 'Apex 5F Boss Reward' },
        ],
      },
    ],
    systemMessages: [
      {
        id: 'sys-init-1',
        timestamp: new Date().toISOString(),
        category: 'info',
        title: 'SYSTEM INITIALIZED',
        message: 'Welcome, Climbers. Defeat the Floor Guardians to unlock the upper Tower Spire!',
        target: 'all',
        sender: 'SYSTEM / DM',
      },
    ],
    combatLog: [
      {
        id: 'cblog-1',
        timestamp: new Date().toISOString(),
        attacker: 'SYSTEM',
        target: 'Tower 1F–5F',
        rawDamage: 0,
        finalDamage: 0,
        damageType: 'Info',
        remainingHp: null,
        summary: 'Trial Tower generated. Floor 2 & 3 Guardians spotted!',
      },
    ],
    playerHistory: [],
    rollLog: [
      {
        id: 'roll-init-1',
        timestamp: new Date().toISOString(),
        rollerName: 'System',
        rollerRole: 'dm',
        label: 'Tower Gate Resonance',
        formula: '1d100',
        rolls: [88],
        dropped: [],
        modifier: 0,
        total: 88,
        mode: 'normal',
        isCrit: false,
        isFumble: false,
        isSecret: false,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// State Persistence & Role-Filtered Views
// ---------------------------------------------------------------------------
function loadState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.characters && parsed.map && parsed.deities && parsed.grimoire) {
        if (parsed.mechanics && (!Array.isArray(parsed.mechanics.statMilestones) || parsed.mechanics.statMilestones.length <= 6)) {
          parsed.mechanics.statMilestones = DEFAULT_STAT_MILESTONES.map((m) => ({ ...m }));
        }
        if (!Array.isArray(parsed.playerHistory)) parsed.playerHistory = [];
        return parsed;
      }
    }
  } catch {
    // Fall back cleanly to fresh state
  }
  return getInitialState();
}

let state = loadState();

function saveState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // Keep operating in-memory if storage is read-only
  }
}

function sanitizeAccounts(accountsMap) {
  const clean = {};
  for (const [email, acc] of Object.entries(accountsMap || {})) {
    clean[email] = {
      id: acc.id,
      email: acc.email,
      username: acc.username,
      characterId: acc.characterId,
      activated: Boolean(acc.activated),
      invitedAt: acc.invitedAt,
      lastLoginAt: acc.lastLoginAt,
    };
  }
  return clean;
}

function filterStateForRole(srcState, role, characterId = null) {
  const isDm = role === 'dm';
  const fogSet = new Set(srcState.map?.fog || []);
  const showExactHp = srcState.mechanics?.showExactMonsterHpToPlayers !== false;

  const filteredTokens = (srcState.map?.tokens || []).filter((tok) => {
    if (isDm) return true;
    if (tok.hiddenFromPlayers) return false;
    if (tok.type !== 'player' && fogSet.has(`${tok.x},${tok.y}`)) return false;
    return true;
  });

  const filteredMonsters = (srcState.monsters || [])
    .filter((m) => {
      if (isDm) return true;
      if (m.hiddenFromPlayers) return false;
      const tok = (srcState.map?.tokens || []).find((t) => t.id === m.id);
      if (tok && fogSet.has(`${tok.x},${tok.y}`)) return false;
      return true;
    })
    .map((m) => {
      if (isDm || showExactHp) return m;
      const pct = m.maxHp > 0 ? m.hp / m.maxHp : 0;
      return {
        ...m,
        hp: null,
        maxHp: null,
        healthTier: pct <= 0 ? 'Defeated' : pct <= 0.3 ? 'Critical' : pct <= 0.65 ? 'Bloodied' : 'Healthy',
      };
    });

  const filteredCombatants = (srcState.combat?.combatants || []).filter((c) => isDm || !c.hiddenFromPlayers);
  const filteredMessages = (srcState.systemMessages || []).filter((m) => isDm || m.target === 'all' || !m.target || m.target === characterId);
  const filteredReactions = (srcState.pendingReactions || []).filter((r) => isDm || !characterId || r.targetCharacterId === characterId);

  return {
    version: srcState.version,
    session: srcState.session,
    mechanics: srcState.mechanics,
    grimoire: srcState.grimoire || [],
    deities: srcState.deities || [],
    characters: srcState.characters,
    playerAccounts: sanitizeAccounts(srcState.playerAccounts),
    monsters: filteredMonsters,
    pendingReactions: filteredReactions,
    bestiary: isDm ? srcState.bestiary : [],
    map: {
      ...srcState.map,
      tokens: filteredTokens,
    },
    combat: {
      ...srcState.combat,
      combatants: filteredCombatants,
    },
    notes: {
      dmPrivate: isDm ? srcState.notes?.dmPrivate : null,
      sharedQuests: srcState.notes?.sharedQuests || '',
    },
    storyBeats: (srcState.storyBeats || [])
      .filter((b) => isDm || b.presented)
      .map((b) => {
        const arena = b.arena || { cols: 20, rows: 20, tokens: [] };
        const arenaTokens = (arena.tokens || []).filter((t) => isDm || !t.hiddenFromPlayers);
        const mapped = { ...b, arena: { ...arena, tokens: arenaTokens } };
        return isDm ? mapped : { ...mapped, dmSecret: null };
      }),
    systemMessages: filteredMessages,
    combatLog: srcState.combatLog || [],
    playerHistory: srcState.playerHistory || [],
    rollLog: (srcState.rollLog || []).filter((r) => isDm || !r.isSecret),
  };
}

// ---------------------------------------------------------------------------
// SSE Real-Time Broadcaster
// ---------------------------------------------------------------------------
const sseClients = new Set();

function broadcastEvent(eventName = 'state', extraPayload = null) {
  for (const client of sseClients) {
    try {
      const data = eventName === 'state'
        ? filterStateForRole(state, client.role, client.characterId)
        : extraPayload;
      if (eventName === 'toast' && client.role !== 'dm' && extraPayload?.target && extraPayload.target !== 'all' && extraPayload.target !== client.characterId) {
        continue;
      }
      client.res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

setInterval(() => {
  for (const client of sseClients) {
    try {
      client.res.write(': heartbeat\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 20000).unref();

// ---------------------------------------------------------------------------
// Sync Helpers
// ---------------------------------------------------------------------------
function generateArenaTerrainFromPrompt(promptText, cols = 20, rows = 20, explicitBiome = '', occupiedSet = new Set()) {
  const lower = String(promptText || '').toLowerCase();
  let biome = explicitBiome && ['forest', 'plains', 'desert'].includes(explicitBiome) ? explicitBiome : '';
  if (!biome) {
    if (/forest|woods|grove|jungle|timber|canopy|tree/.test(lower)) biome = 'forest';
    else if (/desert|dune|sand|canyon|oasis|arid|wasteland/.test(lower)) biome = 'desert';
    else if (/plain|meadow|grass|field|steppe|valley|pasture/.test(lower)) biome = 'plains';
    else biome = 'obsidian';
  }

  const seedBuf = crypto.createHash('md5').update(`${lower}|${cols}x${rows}|${biome}`).digest();
  let seedIdx = 0;
  const nextByte = () => seedBuf[(seedIdx++) % seedBuf.length];

  const terrainMap = new Map();
  const addTile = (x, y, type) => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const key = `${x},${y}`;
    if (occupiedSet.has(key)) return;
    terrainMap.set(key, { x, y, type });
  };

  const wantsWater = /water|river|stream|creek|flow|brook|oasis|canal|moat|lagoon|flood/.test(lower);
  const wantsTrees = /tree|forest|woods|grove|timber|canopy|bush|thicket/.test(lower) || biome === 'forest';
  const wantsRocks = /rock|boulder|stone|pillar|cliff|ruin|crag|canyon|spire|ridge/.test(lower) || biome === 'desert' || biome === 'obsidian';

  // Winding flow of water across the arena
  if (wantsWater) {
    let wy = Math.floor(rows * 0.45);
    const fordX1 = Math.floor(cols * 0.3);
    const fordX2 = Math.floor(cols * 0.72);
    for (let x = 0; x < cols; x++) {
      const drift = (nextByte() % 3) - 1;
      wy = Math.max(2, Math.min(rows - 3, wy + drift));
      // Leave narrow walkable crossings unless explicitly impassable chasm
      const isCrossing = Math.abs(x - fordX1) <= 0 || Math.abs(x - fordX2) <= 0;
      if (!isCrossing) {
        addTile(x, wy, 'water');
        if (nextByte() % 4 === 0) addTile(x, wy + 1, 'water');
      }
    }
  }

  // Trees
  if (wantsTrees) {
    const treeCount = Math.max(6, Math.floor((cols * rows) / 28));
    for (let i = 0; i < treeCount; i++) {
      const tx = (nextByte() + i * 7) % cols;
      const ty = (nextByte() + i * 11) % rows;
      addTile(tx, ty, 'tree');
      if (nextByte() % 3 === 0) addTile(tx + 1, ty, 'tree');
    }
  }

  // Rocks & boulders
  if (wantsRocks) {
    const rockCount = Math.max(5, Math.floor((cols * rows) / 34));
    for (let i = 0; i < rockCount; i++) {
      const rx = (nextByte() * 3 + i * 5) % cols;
      const ry = (nextByte() * 5 + i * 9) % rows;
      addTile(rx, ry, 'rock');
      if (nextByte() % 4 === 0) addTile(rx, ry + 1, 'rock');
    }
  }

  return { biome, terrain: Array.from(terrainMap.values()) };
}

function createDefaultBeatArena(cols = 20, rows = 20, charsMap = {}) {
  const safeCols = Math.max(5, Math.min(100, Number(cols) || 20));
  const safeRows = Math.max(5, Math.min(100, Number(rows) || 20));
  const charList = Object.values(charsMap || {});
  const startX = Math.max(0, Math.floor(safeCols / 2) - Math.floor(charList.length / 2));
  const startY = Math.max(0, safeRows - 4);
  const tokens = charList.map((ch, idx) => ({
    id: ch.id,
    name: ch.name.split(' ')[0],
    type: 'player',
    x: Math.min(safeCols - 1, startX + idx * 2),
    y: startY,
    color: '#38bdf8',
    hp: ch.hp,
    maxHp: ch.maxHp,
    hiddenFromPlayers: false,
    label: ch.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'PL',
  }));
  return { cols: safeCols, rows: safeRows, biome: 'obsidian', terrain: [], tokens, chests: [] };
}

function ensureBeatArena(beat) {
  if (!beat.arena) {
    beat.arena = createDefaultBeatArena(20, 20, state?.characters || {});
  }
  beat.arena.chests = beat.arena.chests || [];
  beat.arena.terrain = beat.arena.terrain || [];
  beat.arena.biome = beat.arena.biome || 'obsidian';
  return beat.arena;
}

function syncCharacterDerived(charId) {
  const ch = state.characters[charId];
  if (!ch) return;
  const milestones = state.mechanics?.statMilestones || DEFAULT_STAT_MILESTONES;
  ch.awakenings = ch.awakenings || [];
  ch.skills = ch.skills || [];
  for (const ms of milestones) {
    const score = Number(ch.stats?.[ms.statKey] || 0);
    if (score >= Number(ms.threshold || 20) && !ch.awakenings.includes(ms.id)) {
      ch.awakenings.push(ms.id);
      if (ms.bonusHp) {
        ch.maxHp = Number(ch.maxHp || 0) + Number(ms.bonusHp);
        ch.hp = Number(ch.hp || 0) + Number(ms.bonusHp);
      }
      if (ms.bonusMp) {
        ch.maxMp = Number(ch.maxMp || 0) + Number(ms.bonusMp);
        ch.mp = Number(ch.mp || 0) + Number(ms.bonusMp);
      }
      if (ms.bonusAc) ch.ac = Number(ch.ac || 10) + Number(ms.bonusAc);
      if (ms.bonusDr) ch.dr = Number(ch.dr || 0) + Number(ms.bonusDr);
      if (!ch.skills.some((s) => s.name === ms.abilityName)) {
        ch.skills.push({
          id: `awk-${ms.id}`,
          name: ms.abilityName,
          rank: 'Awakened',
          mpCost: 0,
          cooldown: 'Passive / 1/Turn',
          description: ms.description,
          unlockedByStat: `${ms.statKey} ${ms.threshold}`,
        });
      }
      pushSystemToast({
        title: `STAT AWAKENING: ${ms.abilityName.toUpperCase()}`,
        message: `${ch.name} reached ${ms.statKey} ${ms.threshold} and unlocked ${ms.abilityName}! (${ms.description})`,
        category: 'loot',
        target: ch.id,
      });
      logPlayerHistory(ch.id, 'awakening', `Unlocked ${ms.abilityName} (${ms.statKey} ${ms.threshold})`);
    }
  }
  const tok = state.map.tokens.find((t) => t.id === charId);
  if (tok) {
    tok.name = ch.name.split(' ')[0];
    tok.hp = ch.hp;
    tok.maxHp = ch.maxHp;
  }
  for (const beat of state.storyBeats || []) {
    const btok = beat.arena?.tokens?.find((t) => t.id === charId);
    if (btok) {
      btok.name = ch.name.split(' ')[0];
      btok.hp = ch.hp;
      btok.maxHp = ch.maxHp;
    }
  }
  const cb = state.combat.combatants.find((c) => c.id === charId);
  if (cb) {
    cb.name = ch.name;
    cb.hp = ch.hp;
    cb.maxHp = ch.maxHp;
    cb.ac = ch.ac;
  }
}

function syncMonsterDerived(monsterId) {
  const mon = state.monsters.find((m) => m.id === monsterId);
  if (!mon) return;
  const tok = state.map.tokens.find((t) => t.id === monsterId);
  if (tok) {
    tok.name = mon.name;
    tok.hp = mon.hp;
    tok.maxHp = mon.maxHp;
    tok.hiddenFromPlayers = Boolean(mon.hiddenFromPlayers);
  }
  for (const beat of state.storyBeats || []) {
    const btok = beat.arena?.tokens?.find((t) => t.id === monsterId);
    if (btok) {
      btok.name = mon.name;
      btok.hp = mon.hp;
      btok.maxHp = mon.maxHp;
      btok.hiddenFromPlayers = Boolean(mon.hiddenFromPlayers);
    }
  }
  const cb = state.combat.combatants.find((c) => c.id === monsterId);
  if (cb) {
    cb.name = mon.name;
    cb.hp = mon.hp;
    cb.maxHp = mon.maxHp;
    cb.ac = mon.ac;
    cb.hiddenFromPlayers = Boolean(mon.hiddenFromPlayers);
  }
  if (mon.hp <= 0 && mon.loot && !mon.loot.dropped) {
    const hasDrop = Boolean(mon.loot.itemName || mon.loot.gold > 0 || mon.loot.manaStones > 0 || mon.loot.xp > 0);
    if (hasDrop) {
      mon.loot.dropped = true;
      if (mon.loot.xp > 0) {
        for (const ch of Object.values(state.characters)) {
          grantXpToCharacter(ch, mon.loot.xp);
        }
      }
      let droppedOnArena = false;
      for (const beat of state.storyBeats || []) {
        const btok = beat.arena?.tokens?.find((t) => t.id === monsterId);
        if (btok && (mon.loot.itemName || mon.loot.gold > 0 || mon.loot.manaStones > 0)) {
          beat.arena.chests = beat.arena.chests || [];
          beat.arena.chests.push({
            id: `loot-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
            name: `${mon.name} Loot`,
            x: btok.x,
            y: btok.y,
            gold: Number(mon.loot.gold || 0),
            manaStones: Number(mon.loot.manaStones || 0),
            itemName: mon.loot.itemName || '',
            itemCategory: mon.loot.itemCategory || 'relic',
            opened: false,
          });
          droppedOnArena = true;
        }
      }
      if (!droppedOnArena && (mon.loot.itemName || mon.loot.gold > 0 || mon.loot.manaStones > 0)) {
        for (const ch of Object.values(state.characters)) {
          ch.currency = ch.currency || { gold: 0, manaStones: 0 };
          ch.currency.gold = Number(ch.currency.gold || 0) + Number(mon.loot.gold || 0);
          ch.currency.manaStones = Number(ch.currency.manaStones || 0) + Number(mon.loot.manaStones || 0);
          if (mon.loot.itemName) {
            ch.inventory = ch.inventory || [];
            ch.inventory.push({
              id: `inv-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
              name: mon.loot.itemName,
              category: mon.loot.itemCategory || 'relic',
              qty: 1,
              healHp: 0,
              healMp: 0,
              slot: mon.loot.itemCategory === 'weapon' ? 'mainHand' : mon.loot.itemCategory === 'armor' ? 'body' : 'relic',
              attackBonus: 0,
              damageDice: '',
              damageType: 'Physical',
              rangeSpaces: 2,
              drBonus: 0,
              acBonus: 0,
              notes: `Dropped by ${mon.name}`,
            });
          }
        }
      }
      const dropParts = [
        mon.loot.itemName || '',
        mon.loot.gold ? `${mon.loot.gold}G` : '',
        mon.loot.manaStones ? `${mon.loot.manaStones} Stones` : '',
        mon.loot.xp ? `+${mon.loot.xp} XP` : '',
      ].filter(Boolean).join(', ');
      pushSystemToast({
        title: 'MONSTER LOOT DROPPED!',
        message: `${mon.name} was defeated and dropped: ${dropParts}${droppedOnArena ? ' (Tap loot chest on arena!)' : ''}`,
        category: 'loot',
      });
    }
  }
}

function getFloorCenterRow(floorNum) {
  const floor = state.map.floors.find((f) => Number(f.number) === Number(floorNum));
  if (!floor) return Math.max(0, state.map.rows - 3);
  return Math.floor((floor.rowStart + floor.rowEnd) / 2);
}

function pushSystemToast({ title, message, category = 'info', target = 'all', sender = 'SYSTEM / DM' }) {
  const rawMsg = String(message || '').trim();
  const formattedMsg = /^SYSTEM:/i.test(rawMsg) ? rawMsg : `SYSTEM: ${rawMsg}`;
  const entry = {
    id: `sys-${Date.now()}-${crypto.randomInt(100, 999)}`,
    timestamp: new Date().toISOString(),
    category,
    title: String(title || 'SYSTEM NOTICE').slice(0, 80),
    message: formattedMsg.slice(0, 500),
    target: target || 'all',
    sender,
  };
  state.systemMessages.unshift(entry);
  state.systemMessages = state.systemMessages.slice(0, 40);
  broadcastEvent('toast', entry);
  return entry;
}

function logPlayerHistory(charId, category, summary) {
  state.playerHistory = state.playerHistory || [];
  const ch = charId ? state.characters[charId] : null;
  const entry = {
    id: `ph-${Date.now()}-${crypto.randomInt(100, 999)}`,
    timestamp: new Date().toISOString(),
    characterId: charId || null,
    characterName: ch ? ch.name : 'Party',
    category: String(category || 'event'),
    summary: String(summary || '').slice(0, 260),
  };
  state.playerHistory.unshift(entry);
  state.playerHistory = state.playerHistory.slice(0, 200);
  if (ch) {
    ch.history = ch.history || [];
    ch.history.unshift(entry);
    ch.history = ch.history.slice(0, 60);
  }
  return entry;
}

function grantXpToCharacter(ch, xpAmount) {
  const gained = Math.max(0, Math.round(Number(xpAmount || 0)));
  ch.level = Math.max(1, Number(ch.level || 1));
  ch.xp = Number(ch.xp || 0) + gained;
  ch.xpToNext = Number(ch.xpToNext || ch.level * 100);
  ch.unspentStatPoints = Number(ch.unspentStatPoints || 0);

  let levelsGained = 0;
  while (ch.xp >= ch.xpToNext) {
    ch.xp -= ch.xpToNext;
    ch.level += 1;
    ch.xpToNext = ch.level * 100;
    ch.unspentStatPoints += 2;
    levelsGained += 1;
  }
  if (gained > 0) {
    logPlayerHistory(ch.id, 'xp', `Gained +${gained} XP${levelsGained > 0 ? ` and reached Level ${ch.level}!` : ''}`);
  }
  return { gained, levelsGained, level: ch.level, xp: ch.xp, xpToNext: ch.xpToNext, unspentStatPoints: ch.unspentStatPoints };
}

function createNewCharacterRecord({ name, race, className, level = 1 }) {
  const id = `char-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`;
  const stats = {};
  for (const s of state.mechanics.stats) {
    stats[s.key] = Number(s.defaultValue ?? 12);
  }
  const cleanName = String(name || 'New Climber').trim().slice(0, 50);
  const prompt = `${race || 'Human'} ${className || 'Tower Climber'} named ${cleanName} in dark fantasy gear, Korean manhwa webtoon style`;
  const char = {
    id,
    name: cleanName,
    race: String(race || 'Human').trim(),
    className: String(className || 'Challenger').trim(),
    rank: 'E-Rank',
    level: Math.max(1, Number(level) || 1),
    xp: 0,
    xpToNext: Math.max(1, Number(level) || 1) * 100,
    unspentStatPoints: 10,
    hp: 30,
    maxHp: 30,
    tempHp: 0,
    mp: 25,
    maxMp: 25,
    ac: 14,
    dr: 1,
    speed: 30,
    speedSpaces: 6,
    patronDeityId: state.deities[0]?.id || '',
    favor: 2,
    inspiration: false,
    stats,
    skills: [{ name: 'Basic Combat', stat: state.mechanics.stats[0]?.key || 'STR', bonus: 2 }],
    spells: state.grimoire.slice(0, 2),
    equipment: {
      mainHand: { id: `eq-${id}-1`, name: 'Iron Climber Blade', slot: 'mainHand', type: 'weapon', attackBonus: 4, damageDice: '1d8+2', damageType: 'Slashing', rangeSpaces: 1, drBonus: 0, acBonus: 0 },
      offHand: null,
      head: null,
      body: { id: `eq-${id}-2`, name: 'Initiate Leather Coat', slot: 'body', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 1, acBonus: 2 },
      boots: null,
      relic: null,
    },
    inventory: [
      { id: `inv-${id}-1`, name: 'Starter Healing Vial', category: 'consumable', qty: 2, healHp: 12, healMp: 0, slot: '', attackBonus: 0, damageDice: '', drBonus: 0, acBonus: 0, notes: 'Restores 12 HP' },
    ],
    currency: { gold: 100, manaStones: 2 },
    conditions: [],
    notes: 'Newly entered the Tower.',
    portraitPrompt: prompt,
    portraitStyle: 'Korean Manhwa Webtoon',
    portraitUrl: '',
    artHistory: [],
  };
  char.portraitUrl = generateSvgPortraitDataUri(prompt, char.portraitStyle, char);
  char.artHistory = [{ id: `art-${id}-init`, prompt, style: char.portraitStyle, url: char.portraitUrl, createdAt: new Date().toISOString() }];

  state.characters[id] = char;
  const startRow = getFloorCenterRow(1);
  const initials = cleanName.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'PL';
  state.map.tokens.push({
    id,
    name: cleanName.split(' ')[0],
    x: crypto.randomInt(2, 8),
    y: startRow,
    color: '#22d3ee',
    type: 'player',
    hp: char.hp,
    maxHp: char.maxHp,
    hiddenFromPlayers: false,
    label: initials,
  });
  state.combat.combatants.push({
    id,
    name: cleanName,
    type: 'player',
    initiative: rollSingleDie(20) + 2,
    hp: char.hp,
    maxHp: char.maxHp,
    ac: char.ac,
    hiddenFromPlayers: false,
  });
  state.combat.combatants.sort((a, b) => b.initiative - a.initiative);
  return char;
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------
async function handleAction(body) {
  const { type, payload = {}, role = 'player', characterId = null } = body || {};
  const isDm = role === 'dm';

  switch (type) {
    case 'session_control': {
      if (!isDm) return { status: 403, error: 'Only the Dungeon Master can start or stop the session.' };
      const action = payload.action;
      state.session.status = action === 'start' ? 'active' : 'stopped';
      if (payload.title !== undefined) state.session.title = String(payload.title).slice(0, 100);
      if (payload.pausedMessage !== undefined) state.session.pausedMessage = String(payload.pausedMessage).slice(0, 200);
      if (action === 'start') {
        state.session.startedAt = new Date().toISOString();
        if (payload.incrementSession) state.session.sessionNumber = Number(state.session.sessionNumber || 1) + 1;
        pushSystemToast({
          title: `SESSION #${state.session.sessionNumber} STARTED`,
          message: `The Dungeon Master has started the session: "${state.session.title}". Roll initiative and prepare to climb!`,
          category: 'info',
        });
      } else {
        pushSystemToast({
          title: 'SESSION STOPPED / PAUSED',
          message: state.session.pausedMessage || 'The Dungeon Master has paused the session.',
          category: 'warning',
        });
      }
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, session: state.session };
    }

    case 'broadcast_toast': {
      if (!isDm) return { status: 403, error: 'Only the Dungeon Master can broadcast system messages.' };
      const message = String(payload.message || '').trim();
      if (!message) return { status: 400, error: 'Message text is required.' };
      const toast = pushSystemToast({
        title: payload.title || (payload.category === 'combat' ? 'BOSS / COMBAT ALERT' : payload.category === 'loot' ? 'QUEST REWARD' : payload.category === 'warning' ? 'SYSTEM WARNING' : 'SYSTEM MESSAGE'),
        message,
        category: payload.category || 'info',
        target: payload.target || 'all',
        sender: 'SYSTEM / DM',
      });
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, toast };
    }

    case 'dm_manage_invites': {
      if (!isDm) return { status: 403, error: 'Only the Dungeon Master can manage player email invites.' };
      const sub = payload.subAction;
      const email = String(payload.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) return { status: 400, error: 'Valid email address is required.' };

      if (sub === 'add') {
        let assignedCharId = payload.characterId || '';
        if (!assignedCharId || assignedCharId === '__new__' || !state.characters[assignedCharId]) {
          const created = createNewCharacterRecord({
            name: payload.characterName || email.split('@')[0],
            race: payload.race || 'Human',
            className: payload.className || 'Tower Climber',
          });
          assignedCharId = created.id;
        }
        const defaultUser = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'climber';
        state.playerAccounts[email] = {
          id: `acc-${Date.now().toString(36)}`,
          email,
          username: state.playerAccounts[email]?.username || defaultUser,
          characterId: assignedCharId,
          activated: false,
          salt: null,
          passwordHash: null,
          invitedAt: new Date().toISOString(),
          lastLoginAt: null,
        };
      } else if (sub === 'reset_activation') {
        if (!state.playerAccounts[email]) return { status: 404, error: 'Player email not found.' };
        state.playerAccounts[email].activated = false;
        state.playerAccounts[email].salt = null;
        state.playerAccounts[email].passwordHash = null;
      } else if (sub === 'remove') {
        delete state.playerAccounts[email];
      }
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, playerAccounts: sanitizeAccounts(state.playerAccounts) };
    }

    case 'update_mechanics': {
      if (!isDm) return { status: 403, error: 'Only the Dungeon Master can modify custom game mechanics.' };
      const m = payload || {};
      if (Array.isArray(m.stats) && m.stats.length > 0) {
        const cleanStats = [];
        for (const s of m.stats) {
          const key = String(s.key || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 12);
          if (!key) continue;
          cleanStats.push({
            key,
            name: String(s.name || key).trim().slice(0, 32),
            defaultValue: Number(s.defaultValue ?? 10),
          });
        }
        if (cleanStats.length > 0) {
          state.mechanics.stats = cleanStats;
          for (const ch of Object.values(state.characters)) {
            ch.stats = ch.stats || {};
            for (const st of cleanStats) {
              if (ch.stats[st.key] === undefined) ch.stats[st.key] = st.defaultValue;
            }
          }
        }
      }
      if (m.presetName !== undefined) state.mechanics.presetName = String(m.presetName).slice(0, 60);
      if (m.combatMode !== undefined) state.mechanics.combatMode = m.combatMode === 'turn_based' ? 'turn_based' : 'reactive';
      if (m.reactionRule !== undefined) state.mechanics.reactionRule = String(m.reactionRule).slice(0, 140);
      if (m.distanceUnit !== undefined) state.mechanics.distanceUnit = String(m.distanceUnit).slice(0, 24);
      if (m.statFormula !== undefined) state.mechanics.statFormula = String(m.statFormula).slice(0, 160);
      if (Array.isArray(m.statMilestones)) {
        state.mechanics.statMilestones = m.statMilestones.map((ms, i) => ({
          id: String(ms.id || `ms-${i}`),
          statKey: String(ms.statKey || 'STR').toUpperCase().slice(0, 12),
          threshold: Math.max(1, Number(ms.threshold || 20)),
          abilityName: String(ms.abilityName || 'Awakened Power').slice(0, 50),
          bonusHp: Number(ms.bonusHp || 0),
          bonusMp: Number(ms.bonusMp || 0),
          bonusAc: Number(ms.bonusAc || 0),
          bonusDr: Number(ms.bonusDr || 0),
          description: String(ms.description || '').slice(0, 160),
        }));
      }
      for (const cid of Object.keys(state.characters)) {
        syncCharacterDerived(cid);
      }
      if (m.hitFormula !== undefined) state.mechanics.hitFormula = String(m.hitFormula).slice(0, 160);
      if (m.damageFormula !== undefined) state.mechanics.damageFormula = String(m.damageFormula).slice(0, 160);
      if (m.critMultiplier !== undefined) state.mechanics.critMultiplier = Math.max(1, Number(m.critMultiplier) || 2);
      if (m.critThreshold !== undefined) state.mechanics.critThreshold = Math.max(2, Math.min(100, Number(m.critThreshold) || 20));
      if (m.resourceName !== undefined) state.mechanics.resourceName = String(m.resourceName).slice(0, 30);
      if (m.showExactMonsterHpToPlayers !== undefined) state.mechanics.showExactMonsterHpToPlayers = Boolean(m.showExactMonsterHpToPlayers);

      pushSystemToast({
        title: 'SYSTEM RULESET UPDATED',
        message: `DM updated mechanics (${state.mechanics.presetName} • ${state.mechanics.combatMode === 'reactive' ? 'Reactive Combat' : 'Turn-Based'}).`,
        category: 'info',
      });
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, mechanics: state.mechanics };
    }

    case 'spawn_monster': {
      if (!isDm) return { status: 403, error: 'Only the Dungeon Master can add monsters.' };
      const id = `mon-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`;
      const floor = Math.max(1, Math.min(state.map.floors.length, Number(payload.floor || 2)));
      const maxHp = Math.max(1, Number(payload.maxHp || 30));
      const ac = Number(payload.ac || 14);
      const dr = Number(payload.dr || 0);
      const rangeSpaces = Math.max(1, Number(payload.rangeSpaces || 2));
      const hidden = Boolean(payload.hiddenFromPlayers);
      const name = String(payload.name || 'Tower Monster').trim().slice(0, 50);

      const lootSrc = payload.loot || {};
      const monster = {
        id,
        name,
        floor,
        hp: maxHp,
        maxHp,
        ac,
        dr,
        rangeSpaces,
        attackFormula: String(payload.attackFormula || '1d20+5'),
        damageFormula: String(payload.damageFormula || '1d8+3'),
        hiddenFromPlayers: hidden,
        conditions: [],
        notes: String(payload.notes || ''),
        loot: {
          itemName: String(lootSrc.itemName ?? payload.lootItemName ?? '').slice(0, 50),
          itemCategory: String(lootSrc.itemCategory ?? payload.lootCategory ?? 'relic'),
          gold: Math.max(0, Number(lootSrc.gold ?? payload.lootGold ?? 0)),
          manaStones: Math.max(0, Number(lootSrc.manaStones ?? payload.lootManaStones ?? 0)),
          xp: Math.max(0, Number(lootSrc.xp ?? payload.lootXp ?? 0)),
          dropped: false,
        },
      };
      state.monsters.push(monster);

      const row = getFloorCenterRow(floor);
      const col = Math.max(0, Math.min(state.map.cols - 1, Number(payload.x ?? crypto.randomInt(2, 8))));
      state.map.tokens.push({
        id,
        name,
        x: col,
        y: row,
        color: '#ef4444',
        type: 'monster',
        hp: maxHp,
        maxHp,
        hiddenFromPlayers: hidden,
        label: name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'MN',
      });
      state.combat.combatants.push({
        id,
        name,
        type: 'monster',
        initiative: rollSingleDie(20) + 2,
        hp: maxHp,
        maxHp,
        ac,
        hiddenFromPlayers: hidden,
      });
      state.combat.combatants.sort((a, b) => b.initiative - a.initiative);

      state.combatLog.unshift({
        id: `cblog-${Date.now()}`,
        timestamp: new Date().toISOString(),
        attacker: 'DM',
        target: name,
        rawDamage: 0,
        finalDamage: 0,
        damageType: 'Spawn',
        remainingHp: maxHp,
        summary: `DM summoned ${name} on ${floor}F (HP: ${maxHp}/${maxHp}, AC: ${ac}, DR: ${dr})${hidden ? ' [HIDDEN]' : ''}.`,
      });
      state.combatLog = state.combatLog.slice(0, 50);

      if (!hidden) {
        pushSystemToast({
          title: 'MONSTER APPEARED!',
          message: `${name} emerged on Floor ${floor}F (${maxHp} HP)!`,
          category: 'combat',
        });
      }

      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, monster };
    }

    case 'update_monster': {
      if (!isDm) return { status: 403, error: 'Only the Dungeon Master can edit or delete monsters.' };
      const mon = state.monsters.find((m) => m.id === payload.monsterId);
      if (!mon) return { status: 404, error: 'Monster not found.' };
      if (payload.remove) {
        state.monsters = state.monsters.filter((m) => m.id !== mon.id);
        state.map.tokens = state.map.tokens.filter((t) => t.id !== mon.id);
        state.combat.combatants = state.combat.combatants.filter((c) => c.id !== mon.id);
      } else {
        if (payload.hpDelta !== undefined) mon.hp = Math.max(0, Math.min(mon.maxHp, mon.hp + Number(payload.hpDelta)));
        if (payload.hp !== undefined) mon.hp = Math.max(0, Math.min(mon.maxHp, Number(payload.hp)));
        if (payload.maxHp !== undefined) mon.maxHp = Math.max(1, Number(payload.maxHp));
        if (payload.ac !== undefined) mon.ac = Number(payload.ac);
        if (payload.dr !== undefined) mon.dr = Number(payload.dr);
        if (payload.hiddenFromPlayers !== undefined) mon.hiddenFromPlayers = Boolean(payload.hiddenFromPlayers);
        if (payload.floor !== undefined) {
          mon.floor = Number(payload.floor);
          const tok = state.map.tokens.find((t) => t.id === mon.id);
          if (tok) tok.y = getFloorCenterRow(mon.floor);
        }
        syncMonsterDerived(mon.id);
      }
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true };
    }

    case 'monster_attack': {
      if (!isDm) return { status: 403, error: 'Only the Dungeon Master can trigger monster attacks.' };
      const mon = state.monsters.find((m) => m.id === payload.monsterId);
      const targetChar = state.characters[payload.targetCharacterId];
      if (!mon || !targetChar) return { status: 404, error: 'Monster or target player character not found.' };

      const hitRoll = rollDiceServer({ formula: mon.attackFormula || '1d20+5' });
      const dmgRoll = payload.customDamage !== undefined && payload.customDamage !== ''
        ? { total: Math.max(1, Number(payload.customDamage)), formula: 'Direct' }
        : rollDiceServer({ formula: mon.damageFormula || '1d8+3' });

      if (state.mechanics.combatMode === 'reactive') {
        const reaction = {
          id: `react-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
          createdAt: new Date().toISOString(),
          monsterId: mon.id,
          monsterName: mon.name,
          targetCharacterId: targetChar.id,
          targetCharacterName: targetChar.name,
          attackTotal: hitRoll.total,
          incomingDamage: Math.max(1, dmgRoll.total),
          formula: dmgRoll.formula,
        };
        state.pendingReactions.unshift(reaction);
        state.pendingReactions = state.pendingReactions.slice(0, 12);

        pushSystemToast({
          title: 'REACTION TRIGGERED!',
          message: `${mon.name} attacks ${targetChar.name} (${hitRoll.total} to hit, ${reaction.incomingDamage} incoming dmg)! Counter-attack or Parry now!`,
          category: 'combat',
          target: targetChar.id,
        });
        state.combatLog.unshift({
          id: `cblog-${Date.now()}`,
          timestamp: new Date().toISOString(),
          attacker: mon.name,
          target: targetChar.name,
          rawDamage: reaction.incomingDamage,
          finalDamage: reaction.incomingDamage,
          damageType: 'Incoming Strike',
          remainingHp: targetChar.hp,
          summary: `${mon.name} lunges at ${targetChar.name} (Hit ${hitRoll.total}, ${reaction.incomingDamage} dmg) — Waiting for Player Reaction!`,
        });

        state.version++;
        saveState();
        broadcastEvent('state');
        return { ok: true, reaction, reactive: true };
      }

      // Turn-based immediate resolution
      const dmgTaken = Math.max(1, dmgRoll.total - Number(targetChar.dr || 0));
      targetChar.hp = Math.max(0, targetChar.hp - dmgTaken);
      syncCharacterDerived(targetChar.id);
      pushSystemToast({
        title: 'MONSTER HIT',
        message: `${mon.name} hit ${targetChar.name} for ${dmgTaken} damage!`,
        category: 'combat',
        target: targetChar.id,
      });
      state.combatLog.unshift({
        id: `cblog-${Date.now()}`,
        timestamp: new Date().toISOString(),
        attacker: mon.name,
        target: targetChar.name,
        rawDamage: dmgRoll.total,
        finalDamage: dmgTaken,
        damageType: 'Monster Strike',
        remainingHp: targetChar.hp,
        summary: `${mon.name} struck ${targetChar.name} for ${dmgTaken} damage (HP: ${targetChar.hp}/${targetChar.maxHp}).`,
      });
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, dmgTaken, reactive: false };
    }

    case 'resolve_reaction': {
      const idx = state.pendingReactions.findIndex((r) => r.id === payload.reactionId);
      if (idx === -1) return { status: 404, error: 'Reaction window expired or already resolved.' };
      const reaction = state.pendingReactions[idx];
      const ch = state.characters[reaction.targetCharacterId];
      const mon = state.monsters.find((m) => m.id === reaction.monsterId);
      if (!ch) return { status: 404, error: 'Character not found.' };

      const choice = payload.choice || 'counter'; // 'counter' | 'parry' | 'spell' | 'accept'
      let dmgTaken = Math.max(0, reaction.incomingDamage - Number(ch.dr || 0));
      let counterDamageDealt = 0;
      let summary = '';

      if (choice === 'counter') {
        const weapon = getEquippedTotals(ch).mainWeapon;
        const dmgFormula = payload.diceFormula || weapon?.damageDice || '1d8+3';
        const hitRoll = rollDiceServer({ formula: '1d20', modifier: getEquippedTotals(ch).attackBonus });
        const dmgRoll = rollDiceServer({ formula: dmgFormula });
        const agiOrStr = ch.stats?.STR ?? ch.stats?.AGI ?? 12;
        const statMod = computeStatModifier(agiOrStr, state.mechanics, ch);

        if (mon) {
          const scope = buildCharacterVarScope(ch, state.mechanics, {
            RAW_DMG: dmgRoll.total,
            STAT_MOD: statMod,
            TARGET_DR: Number(mon.dr || 0),
            TARGET_AC: Number(mon.ac || 10),
            CRIT_MULT: hitRoll.isCrit ? Number(state.mechanics.critMultiplier || 2) : 1,
          });
          counterDamageDealt = Math.max(1, Math.round(evaluateFormula(state.mechanics.damageFormula, scope)));
          mon.hp = Math.max(0, mon.hp - counterDamageDealt);
          syncMonsterDerived(mon.id);
        }
        // Counter-parry mitigates 50% of incoming monster hit on successful roll >= 10
        if (hitRoll.total >= 12) {
          dmgTaken = Math.floor(dmgTaken / 2);
        }
        ch.hp = Math.max(0, ch.hp - dmgTaken);
        syncCharacterDerived(ch.id);
        summary = `${ch.name} COUNTER-ATTACKED ${reaction.monsterName} (Roll ${hitRoll.total}) for ${counterDamageDealt} damage and took ${dmgTaken} dmg!`;
      } else if (choice === 'parry') {
        const agiScore = ch.stats?.AGI ?? ch.stats?.STR ?? 12;
        const parryMod = computeStatModifier(agiScore, state.mechanics, ch);
        const parryRoll = rollDiceServer({ formula: '1d20', modifier: parryMod });
        if (parryRoll.total >= reaction.attackTotal) {
          dmgTaken = 0;
          summary = `${ch.name} PARRIED ${reaction.monsterName}'s strike cleanly (Roll ${parryRoll.total} vs ${reaction.attackTotal}) — 0 damage taken!`;
        } else {
          dmgTaken = Math.max(1, Math.floor(dmgTaken / 2));
          ch.hp = Math.max(0, ch.hp - dmgTaken);
          syncCharacterDerived(ch.id);
          summary = `${ch.name} partially guarded ${reaction.monsterName}'s strike (${parryRoll.total}) — took halved ${dmgTaken} dmg.`;
        }
      } else if (choice === 'spell' && payload.spellId) {
        const spell = (ch.spells || []).find((s) => s.id === payload.spellId) || state.grimoire.find((s) => s.id === payload.spellId);
        if (spell && mon) {
          ch.mp = Math.max(0, ch.mp - Number(spell.mpCost || 0));
          const spellRoll = rollDiceServer({ formula: spell.damageDice || '2d6' });
          const intMod = computeStatModifier(ch.stats?.INT ?? 12, state.mechanics, ch);
          const scope = buildCharacterVarScope(ch, state.mechanics, {
            RAW_DMG: spellRoll.total,
            STAT_MOD: intMod,
            TARGET_DR: Number(mon.dr || 0),
            TARGET_AC: Number(mon.ac || 10),
            CRIT_MULT: 1,
          });
          counterDamageDealt = Math.max(1, Math.round(evaluateFormula(state.mechanics.damageFormula, scope)));
          mon.hp = Math.max(0, mon.hp - counterDamageDealt);
          syncMonsterDerived(mon.id);
        }
        dmgTaken = Math.floor(dmgTaken / 2);
        ch.hp = Math.max(0, ch.hp - dmgTaken);
        syncCharacterDerived(ch.id);
        summary = `${ch.name} reacted with ${spell?.name || 'Counter Spell'}, dealing ${counterDamageDealt} damage to ${reaction.monsterName} (took ${dmgTaken} dmg)!`;
      } else {
        ch.hp = Math.max(0, ch.hp - dmgTaken);
        syncCharacterDerived(ch.id);
        summary = `${ch.name} took ${dmgTaken} damage from ${reaction.monsterName}.`;
      }

      state.pendingReactions.splice(idx, 1);
      state.combatLog.unshift({
        id: `cblog-${Date.now()}`,
        timestamp: new Date().toISOString(),
        attacker: ch.name,
        target: reaction.monsterName,
        rawDamage: counterDamageDealt,
        finalDamage: counterDamageDealt,
        damageType: `Reaction (${choice})`,
        remainingHp: mon ? mon.hp : null,
        summary,
      });
      state.combatLog = state.combatLog.slice(0, 60);

      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, counterDamageDealt, dmgTaken, monster: mon, character: ch, summary };
    }

    case 'inflict_damage': {
      const monster = state.monsters.find((m) => m.id === payload.monsterId);
      if (!monster) return { status: 404, error: 'Target monster not found.' };

      const attackerChar = payload.attackerId ? state.characters[payload.attackerId] : (characterId ? state.characters[characterId] : null);
      const attackerName = attackerChar?.name || payload.attackerName || (isDm ? 'Dungeon Master' : 'Player');
      const damageType = String(payload.damageType || 'Physical').slice(0, 24);
      const isCrit = Boolean(payload.isCrit);

      let rawDamage = Number(payload.rawDamage ?? 0);
      let rollDetails = null;
      if (payload.diceFormula) {
        rollDetails = rollDiceServer({
          formula: payload.diceFormula,
          mode: payload.mode || 'normal',
        });
        rawDamage = rollDetails.total;
      }
      rawDamage = Math.max(0, Math.round(rawDamage));

      let finalDamage = rawDamage;
      if (!payload.ignoreFormula) {
        const primaryStatKey = state.mechanics.stats[0]?.key || 'STR';
        const statScore = attackerChar?.stats?.[payload.statKey || primaryStatKey] ?? 10;
        const statMod = payload.includeStatMod ? computeStatModifier(statScore, state.mechanics, attackerChar) : 0;
        const scope = buildCharacterVarScope(attackerChar, state.mechanics, {
          RAW_DMG: rawDamage,
          STAT_MOD: statMod,
          TARGET_DR: Number(monster.dr || 0),
          TARGET_AC: Number(monster.ac || 10),
          CRIT_MULT: isCrit ? Number(state.mechanics.critMultiplier || 2) : 1,
        });
        finalDamage = Math.max(0, Math.round(evaluateFormula(state.mechanics.damageFormula, scope)));
      }

      const prevHp = monster.hp;
      monster.hp = Math.max(0, monster.hp - finalDamage);
      if (attackerChar) {
        logPlayerHistory(attackerChar.id, 'combat', `Dealt ${finalDamage} ${damageType} damage to ${monster.name} (${monster.hp}/${monster.maxHp} HP left)`);
      }
      syncMonsterDerived(monster.id);

      const logEntry = {
        id: `cblog-${Date.now()}-${crypto.randomInt(10, 99)}`,
        timestamp: new Date().toISOString(),
        attacker: attackerName,
        target: monster.name,
        targetId: monster.id,
        rawDamage,
        finalDamage,
        damageType,
        isCrit,
        rollDetails,
        remainingHp: monster.hp,
        maxHp: monster.maxHp,
        summary: `${attackerName} inflicted ${finalDamage} ${damageType} damage to ${monster.name} (HP: ${prevHp} -> ${monster.hp}/${monster.maxHp})${monster.hp === 0 ? ' [DEFEATED!]' : ''}`,
      };
      state.combatLog.unshift(logEntry);
      state.combatLog = state.combatLog.slice(0, 60);

      if (rollDetails) {
        state.rollLog.unshift({
          id: `roll-${Date.now()}-${crypto.randomInt(10, 99)}`,
          timestamp: new Date().toISOString(),
          rollerName: attackerName,
          rollerRole: role,
          label: `Damage vs ${monster.name} (${damageType})`,
          formula: rollDetails.formula,
          rolls: rollDetails.rolls,
          dropped: rollDetails.dropped,
          modifier: rollDetails.modifier,
          total: finalDamage,
          mode: rollDetails.mode,
          isCrit: isCrit || rollDetails.isCrit,
          isFumble: rollDetails.isFumble,
          isSecret: false,
        });
        state.rollLog = state.rollLog.slice(0, 50);
      }

      if (monster.hp === 0 && prevHp > 0) {
        pushSystemToast({
          title: 'MONSTER DEFEATED!',
          message: `${attackerName} dealt the finishing blow to ${monster.name}!`,
          category: 'loot',
        });
      }

      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, monster, finalDamage, logEntry };
    }

    case 'spell_action': {
      const ch = state.characters[payload.characterId || characterId];
      const sub = payload.subAction;
      if (sub === 'add_to_grimoire' || sub === 'learn_custom') {
        const sp = payload.spell || {};
        if (!sp.name) return { status: 400, error: 'Spell name is required.' };
        const newSpell = {
          id: `sp-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
          name: String(sp.name).trim().slice(0, 50),
          element: String(sp.element || 'Arcane').slice(0, 30),
          mpCost: Math.max(0, Number(sp.mpCost || 0)),
          damageDice: String(sp.damageDice || '2d6'),
          damageType: String(sp.damageType || sp.element || 'Arcane'),
          rangeSpaces: Math.max(0, Number(sp.rangeSpaces || 6)),
          areaText: String(sp.areaText || `${sp.rangeSpaces || 6} Spaces`).slice(0, 80),
          actionType: sp.actionType === 'Reaction' ? 'Reaction' : 'Action',
          explanation: String(sp.explanation || 'Custom free-flow magic manifestation.').slice(0, 400),
        };
        state.grimoire.unshift(newSpell);
        if (ch) {
          ch.spells = ch.spells || [];
          ch.spells.unshift(newSpell);
        }
        state.version++;
        saveState();
        broadcastEvent('state');
        return { ok: true, spell: newSpell };
      }

      if (!ch) return { status: 404, error: 'Character not found.' };
      if (!isDm && characterId && characterId !== ch.id) {
        return { status: 403, error: 'Cannot modify another player spells.' };
      }
      ch.spells = ch.spells || [];

      if (sub === 'learn_from_grimoire') {
        const sp = state.grimoire.find((g) => g.id === payload.spellId);
        if (!sp) return { status: 404, error: 'Grimoire spell not found.' };
        if (!ch.spells.some((s) => s.id === sp.id)) {
          ch.spells.push({ ...sp });
        }
      } else if (sub === 'forget') {
        ch.spells = ch.spells.filter((s) => s.id !== payload.spellId);
      } else if (sub === 'cast') {
        const sp = ch.spells.find((s) => s.id === payload.spellId) || state.grimoire.find((g) => g.id === payload.spellId);
        if (!sp) return { status: 404, error: 'Spell not found.' };
        const cost = Number(sp.mpCost || 0);
        if (ch.mp < cost) return { status: 400, error: `Not enough ${state.mechanics.resourceName || 'Mana'} (needs ${cost}).` };
        ch.mp = Math.max(0, ch.mp - cost);
        syncCharacterDerived(ch.id);

        if (payload.targetMonsterId) {
          return await handleAction({
            type: 'inflict_damage',
            role,
            characterId: ch.id,
            payload: {
              monsterId: payload.targetMonsterId,
              attackerId: ch.id,
              diceFormula: sp.damageDice,
              damageType: sp.damageType || sp.element,
              includeStatMod: true,
              statKey: 'INT',
            },
          });
        }
        state.combatLog.unshift({
          id: `cblog-${Date.now()}`,
          timestamp: new Date().toISOString(),
          attacker: ch.name,
          target: `${sp.rangeSpaces} Spaces`,
          rawDamage: 0,
          finalDamage: 0,
          damageType: sp.damageType,
          remainingHp: null,
          summary: `${ch.name} cast ${sp.name} (${sp.areaText}, Cost ${cost} MP).`,
        });
      }

      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, character: ch };
    }

    case 'deity_action': {
      const sub = payload.subAction;
      if (sub === 'pledge') {
        const ch = state.characters[payload.characterId || characterId];
        if (!ch) return { status: 404, error: 'Character not found.' };
        const deity = state.deities.find((d) => d.id === payload.deityId);
        if (!deity) return { status: 404, error: 'Deity not found.' };
        ch.patronDeityId = deity.id;
        ch.favor = Math.max(1, Number(ch.favor || 1));
        state.version++;
        saveState();
        broadcastEvent('state');
        return { ok: true, character: ch };
      }
      if (sub === 'invoke_miracle') {
        const ch = state.characters[payload.characterId || characterId];
        if (!ch) return { status: 404, error: 'Character not found.' };
        const deity = state.deities.find((d) => d.id === (payload.deityId || ch.patronDeityId));
        if (!deity) return { status: 404, error: 'Select a Patron Deity first.' };
        const cost = Number(deity.favorCost || 1);
        if (Number(ch.favor || 0) < cost) return { status: 400, error: 'Not enough Divine Favor.' };
        ch.favor -= cost;
        // Apply helpful divine miracle effects
        if (/heal/i.test(deity.boonFormula)) {
          ch.hp = Math.min(ch.maxHp, ch.hp + 18);
          ch.mp = Math.min(ch.maxMp, ch.mp + 12);
        } else if (/temp hp/i.test(deity.boonFormula)) {
          ch.tempHp = Number(ch.tempHp || 0) + 10;
        }
        syncCharacterDerived(ch.id);
        let monsterResult = null;
        if (payload.targetMonsterId && /\+\d+/.test(deity.boonFormula)) {
          const bonusNum = Number(deity.boonFormula.match(/\+(\d+)/)?.[1] || 6);
          monsterResult = await handleAction({
            type: 'inflict_damage',
            role,
            characterId: ch.id,
            payload: {
              monsterId: payload.targetMonsterId,
              attackerId: ch.id,
              rawDamage: bonusNum,
              damageType: 'Divine Miracle',
              ignoreFormula: true,
            },
          });
        }
        pushSystemToast({
          title: `MIRACLE: ${deity.blessingName.toUpperCase()}`,
          message: `${ch.name} invoked ${deity.name}! (${deity.blessingDescription})`,
          category: 'loot',
        });
        state.version++;
        saveState();
        broadcastEvent('state');
        return { ok: true, character: ch, monsterResult };
      }

      if (!isDm) return { status: 403, error: 'Only the DM can add, edit, or import Deities.' };
      if (sub === 'add_deity') {
        const d = payload.deity || {};
        if (!d.name) return { status: 400, error: 'Deity name is required.' };
        const created = {
          id: `deity-${Date.now().toString(36)}`,
          name: String(d.name).slice(0, 60),
          title: String(d.title || 'Tower Constellation').slice(0, 60),
          domain: String(d.domain || 'Fate & Power').slice(0, 60),
          alignment: String(d.alignment || 'Neutral').slice(0, 30),
          tenets: String(d.tenets || '').slice(0, 300),
          blessingName: String(d.blessingName || 'Patron Blessing').slice(0, 60),
          blessingDescription: String(d.blessingDescription || 'Grants divine aid to faithful climbers.').slice(0, 300),
          boonFormula: String(d.boonFormula || '+6 Divine Damage').slice(0, 60),
          miracleRangeSpaces: Math.max(1, Number(d.miracleRangeSpaces || 6)),
          favorCost: Math.max(1, Number(d.favorCost || 1)),
          sourceDocUrl: String(d.sourceDocUrl || ''),
        };
        state.deities.push(created);
      } else if (sub === 'import_google_doc') {
        let rawText = String(payload.rawText || '').trim();
        const docUrl = String(payload.docUrl || '').trim();
        if (!rawText && docUrl) {
          const docId = extractGoogleDocId(docUrl);
          if (!docId) return { status: 400, error: 'Provide a valid Google Docs link (/document/d/<ID>) or paste the doc text directly.' };
          const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
          const resp = await fetch(exportUrl);
          if (!resp.ok) {
            return {
              status: 400,
              error: 'Could not read that Google Doc publicly (make sure "Anyone with the link can view" is enabled, or paste the Google Doc text below).',
            };
          }
          rawText = await resp.text();
        }
        const imported = parseDeityTextIntoEntries(rawText, docUrl);
        if (!imported.length) return { status: 400, error: 'No deity entries found to import.' };
        state.deities.push(...imported);
        pushSystemToast({
          title: 'DEITY LORE IMPORTED',
          message: `DM imported ${imported.length} patron deity record(s) from Google Docs!`,
          category: 'info',
        });
      } else if (sub === 'grant_favor') {
        const ch = state.characters[payload.characterId || characterId];
        if (ch) ch.favor = Math.max(0, Number(ch.favor || 0) + Number(payload.delta || 1));
      } else if (sub === 'remove_deity') {
        state.deities = state.deities.filter((d) => d.id !== payload.deityId);
      }

      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, deities: state.deities };
    }

    case 'roll_dice': {
      const result = rollDiceServer({
        count: payload.count,
        sides: payload.sides,
        modifier: payload.modifier,
        mode: payload.mode || 'normal',
        formula: payload.formula,
      });
      const isSecret = Boolean(isDm && payload.isSecret);
      const entry = {
        id: `roll-${Date.now()}-${crypto.randomInt(10, 99)}`,
        timestamp: new Date().toISOString(),
        rollerName: String(payload.rollerName || (isDm ? 'Dungeon Master' : 'Player')),
        rollerRole: role,
        label: String(payload.label || `${result.formula} Roll`),
        ...result,
        isSecret,
      };
      state.rollLog.unshift(entry);
      state.rollLog = state.rollLog.slice(0, 50);

      let damageOutcome = null;
      if (payload.targetMonsterId) {
        damageOutcome = await handleAction({
          type: 'inflict_damage',
          role,
          characterId,
          payload: {
            monsterId: payload.targetMonsterId,
            attackerId: characterId,
            attackerName: entry.rollerName,
            rawDamage: entry.total,
            damageType: payload.damageType || 'Roll Damage',
            isCrit: entry.isCrit,
            includeStatMod: false,
          },
        });
      } else {
        state.version++;
        saveState();
        broadcastEvent('state');
      }
      return { ok: true, roll: entry, damageOutcome };
    }

    case 'update_character': {
      const ch = state.characters[payload.characterId || characterId];
      if (!ch) return { status: 404, error: 'Character not found.' };
      if (!isDm && characterId && characterId !== ch.id) {
        return { status: 403, error: 'Players can only edit their own character.' };
      }
      const p = payload.updates || {};
      if (p.name !== undefined) ch.name = String(p.name).slice(0, 50);
      if (p.race !== undefined) ch.race = String(p.race).slice(0, 30);
      if (p.className !== undefined) ch.className = String(p.className).slice(0, 40);
      if (p.rank !== undefined) ch.rank = String(p.rank).slice(0, 20);
      if (p.level !== undefined) ch.level = Math.max(1, Math.min(99, Number(p.level) || 1));
      if (p.maxHp !== undefined) ch.maxHp = Math.max(1, Number(p.maxHp));
      if (p.hp !== undefined) ch.hp = Math.max(0, Math.min(ch.maxHp, Number(p.hp)));
      if (p.hpDelta !== undefined) ch.hp = Math.max(0, Math.min(ch.maxHp, ch.hp + Number(p.hpDelta)));
      if (p.tempHp !== undefined) ch.tempHp = Math.max(0, Number(p.tempHp));
      if (p.maxMp !== undefined) ch.maxMp = Math.max(0, Number(p.maxMp));
      if (p.mp !== undefined) ch.mp = Math.max(0, Math.min(ch.maxMp, Number(p.mp)));
      if (p.mpDelta !== undefined) ch.mp = Math.max(0, Math.min(ch.maxMp, ch.mp + Number(p.mpDelta)));
      if (p.ac !== undefined) ch.ac = Math.max(0, Number(p.ac));
      if (p.dr !== undefined) ch.dr = Math.max(0, Number(p.dr));
      if (p.speed !== undefined) ch.speed = Math.max(0, Number(p.speed));
      if (p.favor !== undefined) ch.favor = Math.max(0, Number(p.favor));
      if (p.inspiration !== undefined) ch.inspiration = Boolean(p.inspiration);
      if (p.stats && typeof p.stats === 'object') {
        ch.stats = { ...ch.stats };
        for (const [k, v] of Object.entries(p.stats)) {
          ch.stats[k.toUpperCase()] = Number(v || 0);
        }
      }
      if (Array.isArray(p.skills)) ch.skills = p.skills;
      if (p.currency && typeof p.currency === 'object') ch.currency = { ...ch.currency, ...p.currency };
      if (Array.isArray(p.conditions)) ch.conditions = p.conditions;
      if (p.notes !== undefined) ch.notes = String(p.notes);

      syncCharacterDerived(ch.id);
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, character: ch };
    }

    case 'equipment_action': {
      const ch = state.characters[payload.characterId || characterId];
      if (!ch) return { status: 404, error: 'Character not found.' };
      if (!isDm && characterId && characterId !== ch.id) {
        return { status: 403, error: 'Cannot modify another player equipment.' };
      }
      const { subAction, slot, itemId } = payload;
      ch.equipment = ch.equipment || {};
      ch.inventory = ch.inventory || [];

      if (subAction === 'unequip' && slot && ch.equipment[slot]) {
        const old = ch.equipment[slot];
        ch.equipment[slot] = null;
        ch.inventory.push({
          ...old,
          category: old.type === 'weapon' ? 'weapon' : old.type === 'armor' ? 'armor' : 'relic',
          qty: 1,
        });
      } else if (subAction === 'equip' && itemId) {
        const idx = ch.inventory.findIndex((i) => i.id === itemId);
        if (idx === -1) return { status: 404, error: 'Item not in inventory.' };
        const item = ch.inventory[idx];
        const targetSlot = slot || item.slot || (item.category === 'weapon' ? 'mainHand' : item.category === 'armor' ? 'body' : 'relic');
        if (ch.equipment[targetSlot]) {
          ch.inventory.push({ ...ch.equipment[targetSlot], category: ch.equipment[targetSlot].type || 'relic', qty: 1 });
        }
        ch.equipment[targetSlot] = {
          id: item.id,
          name: item.name,
          slot: targetSlot,
          type: item.category === 'weapon' ? 'weapon' : item.category === 'armor' ? 'armor' : 'relic',
          attackBonus: Number(item.attackBonus || 0),
          damageDice: item.damageDice || (item.category === 'weapon' ? '1d8' : ''),
          damageType: item.damageType || 'Physical',
          rangeSpaces: Number(item.rangeSpaces || (item.category === 'weapon' ? 2 : 0)),
          drBonus: Number(item.drBonus || 0),
          acBonus: Number(item.acBonus || 0),
        };
        if (item.qty > 1) item.qty -= 1;
        else ch.inventory.splice(idx, 1);
      }
      const totals = getEquippedTotals(ch);
      ch.ac = 10 + Math.max(0, computeStatModifier(ch.stats?.AGI ?? ch.stats?.DEX ?? 10, state.mechanics, ch)) + totals.armorAc;
      ch.dr = totals.armorDr;
      syncCharacterDerived(ch.id);

      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, character: ch };
    }

    case 'inventory_action': {
      const ch = state.characters[payload.characterId || characterId];
      if (!ch) return { status: 404, error: 'Character not found.' };
      if (!isDm && characterId && characterId !== ch.id) {
        return { status: 403, error: 'Cannot modify another player inventory.' };
      }
      ch.inventory = ch.inventory || [];
      const { subAction, itemId, item } = payload;

      if (subAction === 'add' && item?.name) {
        ch.inventory.push({
          id: `inv-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
          name: String(item.name).slice(0, 60),
          category: item.category || 'relic',
          qty: Math.max(1, Number(item.qty || 1)),
          healHp: Number(item.healHp || 0),
          healMp: Number(item.healMp || 0),
          slot: item.slot || (item.category === 'weapon' ? 'mainHand' : item.category === 'armor' ? 'body' : 'relic'),
          attackBonus: Number(item.attackBonus || 0),
          damageDice: String(item.damageDice || ''),
          damageType: String(item.damageType || 'Physical'),
          rangeSpaces: Number(item.rangeSpaces || 2),
          drBonus: Number(item.drBonus || 0),
          acBonus: Number(item.acBonus || 0),
          notes: String(item.notes || ''),
        });
      } else if (subAction === 'adjust_qty' && itemId) {
        const found = ch.inventory.find((i) => i.id === itemId);
        if (found) {
          found.qty = Math.max(0, found.qty + Number(payload.delta || 0));
          if (found.qty <= 0) ch.inventory = ch.inventory.filter((i) => i.id !== itemId);
        }
      } else if (subAction === 'use_consumable' && itemId) {
        const found = ch.inventory.find((i) => i.id === itemId);
        if (!found) return { status: 404, error: 'Item not found.' };
        const hpGain = Number(found.healHp || 0);
        const mpGain = Number(found.healMp || 0);
        ch.hp = Math.min(ch.maxHp, ch.hp + hpGain);
        ch.mp = Math.min(ch.maxMp, ch.mp + mpGain);
        found.qty -= 1;
        if (found.qty <= 0) ch.inventory = ch.inventory.filter((i) => i.id !== itemId);
        syncCharacterDerived(ch.id);
        state.combatLog.unshift({
          id: `cblog-${Date.now()}`,
          timestamp: new Date().toISOString(),
          attacker: ch.name,
          target: ch.name,
          rawDamage: 0,
          finalDamage: 0,
          damageType: 'Item',
          remainingHp: ch.hp,
          summary: `${ch.name} used ${found.name}${hpGain ? ` (+${hpGain} HP)` : ''}${mpGain ? ` (+${mpGain} MP)` : ''}.`,
        });
      } else if (subAction === 'remove' && itemId) {
        ch.inventory = ch.inventory.filter((i) => i.id !== itemId);
      }

      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, character: ch };
    }

    case 'generate_character_art': {
      const ch = state.characters[payload.characterId || characterId];
      if (!ch) return { status: 404, error: 'Character not found.' };
      if (!isDm && characterId && characterId !== ch.id) {
        return { status: 403, error: 'Cannot generate art for another character.' };
      }
      const prompt = String(payload.prompt || ch.portraitPrompt || ch.name).trim().slice(0, 400);
      const style = String(payload.style || ch.portraitStyle || 'Korean Manhwa Webtoon');
      const generated = await generateCharacterArt(prompt, style, ch);

      ch.portraitPrompt = prompt;
      ch.portraitStyle = style;
      ch.portraitUrl = generated.url;
      ch.artHistory = ch.artHistory || [];
      ch.artHistory.unshift({
        id: `art-${Date.now()}`,
        prompt,
        style,
        engine: generated.engine,
        url: generated.url,
        createdAt: new Date().toISOString(),
      });
      ch.artHistory = ch.artHistory.slice(0, 8);

      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, portraitUrl: ch.portraitUrl, engine: generated.engine, character: ch };
    }

    case 'move_token': {
      const tok = state.map.tokens.find((t) => t.id === payload.tokenId);
      if (!tok) return { status: 404, error: 'Token not found.' };
      if (!isDm && tok.type !== 'player') return { status: 403, error: 'Players cannot move monster tokens.' };
      if (!isDm && characterId && tok.id !== characterId) {
        return { status: 403, error: 'Players can only move their own character token.' };
      }
      tok.x = Math.max(0, Math.min(state.map.cols - 1, Math.trunc(Number(payload.x))));
      tok.y = Math.max(0, Math.min(state.map.rows - 1, Math.trunc(Number(payload.y))));
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, token: tok };
    }

    case 'update_map': {
      const sub = payload.subAction;
      if (sub === 'ping') {
        state.map.pings.push({
          id: `ping-${Date.now()}`,
          x: Number(payload.x || 0),
          y: Number(payload.y || 0),
          color: isDm ? '#f59e0b' : '#38bdf8',
          createdAt: Date.now(),
        });
        state.map.pings = state.map.pings.filter((p) => Date.now() - p.createdAt < 10000);
        state.version++;
        saveState();
        broadcastEvent('state');
        return { ok: true };
      }
      if (!isDm) return { status: 403, error: 'Only the Dungeon Master can edit the Tower map & Fog of War.' };

      if (sub === 'toggle_fog_cell') {
        const key = `${Number(payload.x)},${Number(payload.y)}`;
        const set = new Set(state.map.fog);
        if (payload.covered === true) set.add(key);
        else if (payload.covered === false) set.delete(key);
        else if (set.has(key)) set.delete(key);
        else set.add(key);
        state.map.fog = Array.from(set);
      } else if (sub === 'floor_fog') {
        const floor = state.map.floors.find((f) => Number(f.number) === Number(payload.floorNumber));
        if (floor) {
          const set = new Set(state.map.fog);
          for (let y = floor.rowStart; y <= floor.rowEnd; y++) {
            for (let x = 0; x < state.map.cols; x++) {
              const key = `${x},${y}`;
              if (payload.covered) set.add(key);
              else set.delete(key);
            }
          }
          state.map.fog = Array.from(set);
        }
      } else if (sub === 'set_fog_bulk') {
        if (payload.mode === 'reveal_all') {
          state.map.fog = [];
        } else if (payload.mode === 'cover_all') {
          const all = [];
          for (let y = 0; y < state.map.rows; y++) {
            for (let x = 0; x < state.map.cols; x++) all.push(`${x},${y}`);
          }
          state.map.fog = all;
        }
      } else if (sub === 'add_floor') {
        const nextNum = state.map.floors.reduce((m, f) => Math.max(m, f.number), 0) + 1;
        for (const f of state.map.floors) {
          f.rowStart += 5;
          f.rowEnd += 5;
          f.portalRow += 5;
        }
        for (const t of state.map.tokens) t.y += 5;
        state.map.fog = state.map.fog.map((k) => {
          const [x, y] = k.split(',').map(Number);
          return `${x},${y + 5}`;
        });
        state.map.rows += 5;
        const defaultThemeForFloor = (n) => (n === 1 ? 'forest' : n === 2 ? 'desert' : n === 3 ? 'underworld' : n === 4 ? 'frost' : 'obsidian');
        const validThemes = ['forest', 'desert', 'underworld', 'plains', 'frost', 'obsidian'];
        const floorTheme = validThemes.includes(payload.theme) ? payload.theme : defaultThemeForFloor(nextNum);
        const newFloor = {
          number: nextNum,
          title: String(payload.title || `${nextNum}F • ${floorTheme.charAt(0).toUpperCase() + floorTheme.slice(1)} Realm`).slice(0, 60),
          theme: floorTheme,
          rowStart: 0,
          rowEnd: 4,
          safeZone: Boolean(payload.safeZone),
          portalRow: 4,
          portalCol: 5,
          description: String(payload.description || 'Newly unlocked vertical tower floor.'),
        };
        state.map.floors.unshift(newFloor);
        if (payload.startFogged !== false) {
          for (let y = 0; y <= 4; y++) {
            for (let x = 0; x < state.map.cols; x++) state.map.fog.push(`${x},${y}`);
          }
        }
        pushSystemToast({
          title: `NEW TOWER FLOOR ADDED (${nextNum}F)`,
          message: `The Tower expanded vertically! ${newFloor.title} awaits above.`,
          category: 'info',
        });
      } else if (sub === 'set_floor_theme') {
        const validThemes = ['forest', 'desert', 'underworld', 'plains', 'frost', 'obsidian'];
        const fl = state.map.floors.find((f) => Number(f.number) === Number(payload.floorNumber));
        if (!fl) return { status: 404, error: 'Tower floor not found.' };
        if (validThemes.includes(payload.theme)) fl.theme = payload.theme;
        if (payload.title) fl.title = String(payload.title).slice(0, 60);
      } else if (sub === 'apply_tower_themes') {
        const validThemes = ['forest', 'desert', 'underworld', 'plains', 'frost', 'obsidian'];
        const targetCount = Math.max(state.map.floors.length, Math.min(20, Number(payload.ensureFloors || state.map.floors.length)));
        while (state.map.floors.length < targetCount) {
          const nextNum = state.map.floors.reduce((m, f) => Math.max(m, f.number), 0) + 1;
          for (const f of state.map.floors) {
            f.rowStart += 5;
            f.rowEnd += 5;
            f.portalRow += 5;
          }
          for (const t of state.map.tokens) t.y += 5;
          state.map.fog = state.map.fog.map((k) => {
            const [x, y] = k.split(',').map(Number);
            return `${x},${y + 5}`;
          });
          state.map.rows += 5;
          const defTheme = nextNum === 1 ? 'forest' : nextNum === 2 ? 'desert' : nextNum === 3 ? 'underworld' : nextNum === 4 ? 'frost' : 'obsidian';
          state.map.floors.unshift({
            number: nextNum,
            title: `${nextNum}F • ${defTheme.charAt(0).toUpperCase() + defTheme.slice(1)} Realm`,
            theme: defTheme,
            rowStart: 0,
            rowEnd: 4,
            safeZone: false,
            portalRow: 4,
            portalCol: 5,
            description: `Floor ${nextNum} of the Tower.`,
          });
        }
        if (Array.isArray(payload.floors)) {
          for (const item of payload.floors) {
            const fl = state.map.floors.find((f) => Number(f.number) === Number(item.number));
            if (fl && validThemes.includes(item.theme)) {
              fl.theme = item.theme;
              if (item.title) fl.title = String(item.title).slice(0, 60);
            }
          }
        } else if (payload.preset) {
          const presetMap = {
            classic: (n) => (n === 1 ? 'forest' : n === 2 ? 'desert' : n === 3 ? 'underworld' : n === 4 ? 'frost' : 'obsidian'),
            all_forest: () => 'forest',
            all_desert: () => 'desert',
            all_underworld: () => 'underworld',
            all_obsidian: () => 'obsidian',
          };
          const pick = presetMap[payload.preset] || presetMap.classic;
          for (const fl of state.map.floors) {
            fl.theme = pick(fl.number);
          }
        }
      } else if (sub === 'delete_floor') {
        const floorNum = Number(payload.floorNumber);
        if (state.map.floors.length <= 1) {
          return { status: 400, error: 'Cannot delete the only remaining floor in the Tower.' };
        }
        const fl = state.map.floors.find((f) => Number(f.number) === floorNum);
        if (!fl) return { status: 404, error: 'Tower floor not found.' };
        const span = Math.max(1, fl.rowEnd - fl.rowStart + 1);
        state.map.floors = state.map.floors.filter((f) => Number(f.number) !== floorNum);
        for (const f of state.map.floors) {
          if (f.rowStart > fl.rowStart) {
            f.rowStart -= span;
            f.rowEnd -= span;
            f.portalRow -= span;
          }
        }
        state.map.rows = Math.max(5, state.map.rows - span);
        const fallbackFloor = state.map.floors[state.map.floors.length - 1];
        const nextTokens = [];
        for (const t of state.map.tokens) {
          if (t.y >= fl.rowStart && t.y <= fl.rowEnd) {
            if (t.type === 'player' && fallbackFloor) {
              t.y = fallbackFloor.portalRow;
              nextTokens.push(t);
            }
          } else {
            if (t.y > fl.rowEnd) t.y -= span;
            nextTokens.push(t);
          }
        }
        state.map.tokens = nextTokens;
        state.map.fog = (state.map.fog || []).filter((k) => {
          const [, y] = k.split(',').map(Number);
          return y < fl.rowStart || y > fl.rowEnd;
        }).map((k) => {
          const [x, y] = k.split(',').map(Number);
          return y > fl.rowEnd ? `${x},${y - span}` : k;
        });
        state.storyBeats = (state.storyBeats || []).filter((b) => Number(b.floor) !== floorNum);
        state.monsters = (state.monsters || []).filter((m) => Number(m.floor) !== floorNum);
      } else if (sub === 'set_theme') {
        state.map.theme = String(payload.theme || 'obsidian-spire');
      }

      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, map: state.map };
    }

    case 'initiative_action': {
      const sub = payload.subAction;
      if (!isDm && sub !== 'player_roll_initiative') {
        return { status: 403, error: 'Only the DM can control turn progression.' };
      }
      if (sub === 'next_turn') {
        if (state.combat.combatants.length > 0) {
          state.combat.turnIndex = (state.combat.turnIndex + 1) % state.combat.combatants.length;
          if (state.combat.turnIndex === 0) state.combat.round += 1;
        }
      } else if (sub === 'prev_turn') {
        if (state.combat.combatants.length > 0) {
          state.combat.turnIndex -= 1;
          if (state.combat.turnIndex < 0) {
            state.combat.turnIndex = state.combat.combatants.length - 1;
            state.combat.round = Math.max(1, state.combat.round - 1);
          }
        }
      } else if (sub === 'roll_all') {
        for (const c of state.combat.combatants) {
          let mod = 2;
          if (c.type === 'player' && state.characters[c.id]) {
            const ch = state.characters[c.id];
            const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
            mod = computeStatModifier(agiScore, state.mechanics, ch);
          } else if (c.type === 'monster') {
            const mon = state.monsters.find((m) => m.id === c.id);
            mod = mon ? Math.floor(((mon.agi ?? mon.ac ?? 12) - 10) / 2) : 2;
          }
          c.initMod = mod;
          c.initiative = rollSingleDie(20) + mod;
        }
        state.combat.combatants.sort((a, b) => b.initiative - a.initiative);
        state.combat.turnIndex = 0;
        state.combat.round = 1;
      } else if (sub === 'player_roll_initiative') {
        const ch = state.characters[payload.characterId || characterId];
        if (ch) {
          const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
          const mod = computeStatModifier(agiScore, state.mechanics, ch);
          const init = rollSingleDie(20) + mod;
          const cb = state.combat.combatants.find((c) => c.id === ch.id);
          if (cb) {
            cb.initMod = mod;
            cb.initiative = init;
          }
          state.combat.combatants.sort((a, b) => b.initiative - a.initiative);
        }
      }
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, combat: state.combat };
    }

    case 'update_notes': {
      if (payload.sharedQuests !== undefined) state.notes.sharedQuests = String(payload.sharedQuests);
      if (payload.dmPrivate !== undefined) {
        if (!isDm) return { status: 403, error: 'Only the DM can edit private DM notes.' };
        state.notes.dmPrivate = String(payload.dmPrivate);
      }
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true };
    }

    case 'story_action': {
      state.storyBeats = state.storyBeats || [];
      const sub = payload.subAction;
      if (!isDm && sub !== 'move_beat_token' && sub !== 'open_beat_chest' && sub !== 'talk_beat_npc') {
        return { status: 403, error: 'Only the Dungeon Master can orchestrate story beats.' };
      }

      if (sub === 'add_beat') {
        const title = String(payload.title || '').trim();
        if (!title) return { status: 400, error: 'Story beat title is required.' };
        const encounters = Array.isArray(payload.encounters) ? payload.encounters : [];
        const treasures = Array.isArray(payload.treasures) ? payload.treasures : [];
        const npcs = Array.isArray(payload.npcs) ? payload.npcs : [];
        const gridCols = Math.max(5, Math.min(100, Number(payload.gridCols || payload.gridSize || 20)));
        const gridRows = Math.max(5, Math.min(100, Number(payload.gridRows || payload.gridSize || 20)));
        const arena = createDefaultBeatArena(gridCols, gridRows, state.characters);
        if (payload.biome && ['forest', 'plains', 'desert', 'obsidian'].includes(payload.biome)) {
          arena.biome = payload.biome;
        }
        if (payload.playerPositions && typeof payload.playerPositions === 'object') {
          arena.startPositions = {};
          for (const tok of arena.tokens) {
            const pos = payload.playerPositions[tok.id];
            if (pos && pos.x !== undefined && pos.y !== undefined) {
              tok.x = Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(pos.x))));
              tok.y = Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(pos.y))));
            }
            arena.startPositions[tok.id] = { x: tok.x, y: tok.y };
          }
        }
        if (npcs.length > 0) {
          arena.startPositions = arena.startPositions || {};
          npcs.forEach((n, idx) => {
            const npcName = String(n.name || 'NPC').trim().slice(0, 50) || 'NPC';
            const npcId = `npc-${Date.now().toString(36)}-${idx}-${crypto.randomInt(10, 99)}`;
            const nx = n.startX !== undefined && n.startX !== '' && n.startX !== null
              ? Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(n.startX)) - 1))
              : Math.min(gridCols - 1, 2 + idx * 2);
            const ny = n.startY !== undefined && n.startY !== '' && n.startY !== null
              ? Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(n.startY)) - 1))
              : Math.min(gridRows - 1, Math.floor(gridRows / 2));
            arena.tokens.push({
              id: npcId,
              name: npcName,
              npcRole: String(n.npcRole || n.role || 'NPC').slice(0, 40),
              dialogue: String(n.dialogue || `Greetings, Climber. Speak with ${npcName}.`).slice(0, 300),
              rewardType: ['none', 'item', 'skill_book', 'xp'].includes(n.rewardType) ? n.rewardType : 'none',
              rewardItemName: String(n.rewardItemName || '').slice(0, 60),
              rewardItemCategory: String(n.rewardItemCategory || 'relic'),
              rewardSkillDesc: String(n.rewardSkillDesc || '').slice(0, 160),
              rewardXp: Math.max(0, Number(n.rewardXp || 0)),
              rewardGold: Math.max(0, Number(n.rewardGold || 0)),
              rewardClaimed: false,
              type: 'npc',
              x: nx,
              y: ny,
              color: '#10b981',
              hp: null,
              maxHp: null,
              hiddenFromPlayers: Boolean(n.hiddenFromPlayers),
              label: npcName.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'NP',
            });
            arena.startPositions[npcId] = { x: nx, y: ny };
          });
        }
        if (Array.isArray(payload.chests)) {
          arena.chests = payload.chests.map((c, i) => ({
            id: `chest-${Date.now().toString(36)}-${i}-${crypto.randomInt(10, 99)}`,
            name: String(c.name || 'Treasure Chest').slice(0, 50),
            x: Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(c.x || 0)))),
            y: Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(c.y || 0)))),
            gold: Math.max(0, Number(c.gold || 0)),
            manaStones: Math.max(0, Number(c.manaStones || 0)),
            itemName: String(c.itemName || '').slice(0, 50),
            itemCategory: String(c.itemCategory || 'relic'),
            opened: false,
          }));
        }
        if (Array.isArray(payload.terrain)) {
          arena.terrain = payload.terrain
            .filter((t) => ['tree', 'rock', 'water'].includes(t.type))
            .map((t) => ({
              x: Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(t.x || 0)))),
              y: Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(t.y || 0)))),
              type: t.type,
            }));
        } else if (payload.arenaPrompt) {
          const occ = new Set([
            ...arena.tokens.map((t) => `${t.x},${t.y}`),
            ...arena.chests.map((c) => `${c.x},${c.y}`),
          ]);
          const gen = generateArenaTerrainFromPrompt(payload.arenaPrompt, gridCols, gridRows, arena.biome, occ);
          arena.biome = gen.biome;
          arena.terrain = gen.terrain;
        }
        const beat = {
          id: `beat-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
          order: state.storyBeats.length + 1,
          floor: Math.max(1, Number(payload.floor || 1)),
          title: title.slice(0, 80),
          narration: String(payload.narration || '').slice(0, 800),
          dmSecret: String(payload.dmSecret || '').slice(0, 500),
          presented: Boolean(payload.presentNow),
          status: payload.presentNow ? 'active' : 'upcoming',
          xpReward: Math.max(0, Number(payload.xpReward ?? 0)),
          arena,
          encounters,
          treasures,
        };
        state.storyBeats.push(beat);
        if (beat.presented) {
          pushSystemToast({
            title: `STORY: ${beat.title}`,
            message: beat.narration || `New scene unlocked on ${beat.floor}F.`,
            category: 'info',
          });
        }
        state.version++;
        saveState();
        broadcastEvent('state');
        return { ok: true, beat };
      }

      const beat = state.storyBeats.find((b) => b.id === payload.beatId);
      if (!beat) return { status: 404, error: 'Story beat not found.' };
      const arena = ensureBeatArena(beat);

      if (sub === 'present_beat') {
        beat.presented = true;
        beat.status = 'active';
        pushSystemToast({
          title: `STORY: ${beat.title}`,
          message: beat.narration || `The Dungeon Master revealed ${beat.title}.`,
          category: 'info',
        });
      } else if (sub === 'hide_beat') {
        beat.presented = false;
      } else if (sub === 'set_status') {
        beat.status = ['upcoming', 'active', 'resolved'].includes(payload.status) ? payload.status : beat.status;
      } else if (sub === 'set_beat_grid') {
        const cols = Math.max(5, Math.min(100, Number(payload.cols || 20)));
        const rows = Math.max(5, Math.min(100, Number(payload.rows || cols)));
        arena.cols = cols;
        arena.rows = rows;
        for (const tok of arena.tokens) {
          tok.x = Math.max(0, Math.min(cols - 1, tok.x));
          tok.y = Math.max(0, Math.min(rows - 1, tok.y));
        }
        for (const ch of arena.chests || []) {
          ch.x = Math.max(0, Math.min(cols - 1, ch.x));
          ch.y = Math.max(0, Math.min(rows - 1, ch.y));
        }
        arena.terrain = (arena.terrain || []).filter((t) => t.x < cols && t.y < rows);
      } else if (sub === 'set_beat_biome') {
        if (['forest', 'plains', 'desert', 'obsidian'].includes(payload.biome)) {
          arena.biome = payload.biome;
        }
      } else if (sub === 'toggle_beat_terrain') {
        const tx = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x || 0))));
        const ty = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y || 0))));
        const tType = ['tree', 'rock', 'water'].includes(payload.terrainType) ? payload.terrainType : 'rock';
        arena.terrain = arena.terrain || [];
        const existingIdx = arena.terrain.findIndex((t) => t.x === tx && t.y === ty);
        if (existingIdx >= 0 && arena.terrain[existingIdx].type === tType) {
          arena.terrain.splice(existingIdx, 1);
        } else if (existingIdx >= 0) {
          arena.terrain[existingIdx].type = tType;
        } else {
          arena.terrain.push({ x: tx, y: ty, type: tType });
        }
      } else if (sub === 'generate_beat_terrain') {
        const occ = new Set([
          ...(arena.tokens || []).map((t) => `${t.x},${t.y}`),
          ...(arena.chests || []).map((c) => `${c.x},${c.y}`),
        ]);
        const gen = generateArenaTerrainFromPrompt(payload.prompt || beat.narration || beat.title, arena.cols, arena.rows, payload.biome || '', occ);
        arena.biome = gen.biome;
        arena.terrain = gen.terrain;
      } else if (sub === 'add_beat_chest') {
        arena.chests.push({
          id: `chest-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
          name: String(payload.name || 'Treasure Chest').slice(0, 50),
          x: Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x || 0)))),
          y: Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y || 0)))),
          gold: Math.max(0, Number(payload.gold || 50)),
          manaStones: Math.max(0, Number(payload.manaStones || 1)),
          itemName: String(payload.itemName || '').slice(0, 50),
          itemCategory: String(payload.itemCategory || 'relic'),
          opened: false,
        });
      } else if (sub === 'remove_beat_chest') {
        arena.chests = arena.chests.filter((c) => c.id !== payload.chestId);
      } else if (sub === 'add_beat_npc') {
        const npcName = String(payload.name || 'NPC').trim().slice(0, 50) || 'NPC';
        const npcId = `npc-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`;
        const nx = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x || 0))));
        const ny = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y || 0))));
        arena.tokens.push({
          id: npcId,
          name: npcName,
          npcRole: String(payload.npcRole || 'NPC').slice(0, 40),
          dialogue: String(payload.dialogue || `Greetings, Climber. Speak with ${npcName}.`).slice(0, 300),
          rewardType: ['none', 'item', 'skill_book', 'xp'].includes(payload.rewardType) ? payload.rewardType : 'none',
          rewardItemName: String(payload.rewardItemName || '').slice(0, 60),
          rewardItemCategory: String(payload.rewardItemCategory || 'relic'),
          rewardSkillDesc: String(payload.rewardSkillDesc || '').slice(0, 160),
          rewardXp: Math.max(0, Number(payload.rewardXp || 0)),
          rewardGold: Math.max(0, Number(payload.rewardGold || 0)),
          rewardClaimed: false,
          type: 'npc',
          x: nx,
          y: ny,
          color: '#10b981',
          hp: null,
          maxHp: null,
          hiddenFromPlayers: Boolean(payload.hiddenFromPlayers),
          label: npcName.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'NP',
        });
        arena.startPositions = arena.startPositions || {};
        arena.startPositions[npcId] = { x: nx, y: ny };
      } else if (sub === 'talk_beat_npc') {
        const tok = (arena.tokens || []).find((t) => t.id === payload.tokenId && t.type === 'npc');
        if (!tok) return { status: 404, error: 'NPC not found in this arena.' };
        const cid = (payload.characterId && state.characters[payload.characterId])
          ? payload.characterId
          : (characterId && state.characters[characterId] ? characterId : Object.keys(state.characters)[0]);
        const ch = cid ? state.characters[cid] : null;
        const rewardNotes = [];
        if (ch && !tok.rewardClaimed && tok.rewardType && tok.rewardType !== 'none') {
          tok.rewardClaimed = true;
          if (tok.rewardType === 'xp' && tok.rewardXp > 0) {
            const xpRes = grantXpToCharacter(ch, tok.rewardXp);
            rewardNotes.push(`+${tok.rewardXp} XP${xpRes.levelsGained > 0 ? ` (Level ${xpRes.level}!)` : ''}`);
          } else if (tok.rewardType === 'item' && tok.rewardItemName) {
            ch.inventory = ch.inventory || [];
            ch.inventory.push({
              id: `inv-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
              name: tok.rewardItemName,
              category: tok.rewardItemCategory || 'relic',
              qty: 1,
              healHp: 0,
              healMp: 0,
              slot: tok.rewardItemCategory === 'weapon' ? 'mainHand' : tok.rewardItemCategory === 'armor' ? 'body' : 'relic',
              attackBonus: 0,
              damageDice: '',
              damageType: 'Physical',
              rangeSpaces: 2,
              drBonus: 0,
              acBonus: 0,
              notes: `Gifted by ${tok.name}`,
            });
            rewardNotes.push(`Item: ${tok.rewardItemName}`);
          } else if (tok.rewardType === 'skill_book' && tok.rewardItemName) {
            const cleanSkillName = tok.rewardItemName.replace(/^skill\s*book:\s*/i, '').trim() || tok.rewardItemName;
            ch.inventory = ch.inventory || [];
            ch.inventory.push({
              id: `inv-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
              name: `Skill Book: ${cleanSkillName}`,
              category: 'skill_book',
              qty: 1,
              healHp: 0,
              healMp: 0,
              slot: 'relic',
              attackBonus: 0,
              damageDice: '',
              damageType: 'Physical',
              rangeSpaces: 2,
              drBonus: 0,
              acBonus: 0,
              notes: tok.rewardSkillDesc || `Skill Book gifted by ${tok.name}`,
            });
            ch.skills = ch.skills || [];
            if (!ch.skills.some((s) => s.name.toLowerCase() === cleanSkillName.toLowerCase())) {
              ch.skills.push({
                id: `sk-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
                name: cleanSkillName,
                rank: 'E',
                mpCost: 5,
                cooldown: '1 turn',
                description: tok.rewardSkillDesc || `Learned from ${tok.name}'s Skill Book.`,
              });
            }
            rewardNotes.push(`Skill Book: ${cleanSkillName}`);
          }
          if (tok.rewardGold > 0) {
            ch.currency = ch.currency || { gold: 0, manaStones: 0 };
            ch.currency.gold = Number(ch.currency.gold || 0) + Number(tok.rewardGold);
            rewardNotes.push(`${tok.rewardGold}G`);
          }
        }
        const dialogue = tok.dialogue || `Greetings, Climber.`;
        const rewardSummary = rewardNotes.join(', ');
        pushSystemToast({
          title: `${tok.name.toUpperCase()} (${tok.npcRole || 'NPC'})`,
          message: rewardSummary ? `"${dialogue}" — Received: ${rewardSummary}` : `"${dialogue}"`,
          category: rewardSummary ? 'loot' : 'info',
          target: ch ? ch.id : 'all',
        });
        if (ch) {
          logPlayerHistory(ch.id, 'npc', `Spoke with ${tok.name}${rewardSummary ? ` (Received: ${rewardSummary})` : ''}`);
        }
      } else if (sub === 'remove_beat_npc') {
        arena.tokens = arena.tokens.filter((t) => !(t.type === 'npc' && t.id === payload.tokenId));
      } else if (sub === 'open_beat_chest') {
        const chest = (arena.chests || []).find((c) => c.id === payload.chestId);
        if (!chest) return { status: 404, error: 'Treasure chest not found.' };
        if (chest.opened) return { status: 400, error: 'Treasure chest already opened.' };
        chest.opened = true;
        const recipientIds = (payload.characterId && state.characters[payload.characterId])
          ? [payload.characterId]
          : (characterId && state.characters[characterId] ? [characterId] : Object.keys(state.characters));
        for (const cid of recipientIds) {
          const ch = state.characters[cid];
          if (!ch) continue;
          ch.currency = ch.currency || { gold: 0, manaStones: 0 };
          ch.currency.gold = Number(ch.currency.gold || 0) + Number(chest.gold || 0);
          ch.currency.manaStones = Number(ch.currency.manaStones || 0) + Number(chest.manaStones || 0);
          if (chest.itemName) {
            ch.inventory = ch.inventory || [];
            ch.inventory.push({
              id: `inv-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
              name: chest.itemName,
              category: chest.itemCategory || 'relic',
              qty: 1,
              healHp: 0,
              healMp: 0,
              slot: chest.itemCategory === 'weapon' ? 'mainHand' : chest.itemCategory === 'armor' ? 'body' : 'relic',
              attackBonus: 0,
              damageDice: '',
              damageType: 'Physical',
              rangeSpaces: 2,
              drBonus: 0,
              acBonus: 0,
              notes: `Found in ${chest.name}`,
            });
          }
        }
        const rewards = [
          chest.gold ? `${chest.gold}G` : '',
          chest.manaStones ? `${chest.manaStones} Stones` : '',
          chest.itemName || '',
        ].filter(Boolean).join(', ');
        pushSystemToast({
          title: 'TREASURE CHEST OPENED!',
          message: `${chest.name} opened! Rewards: ${rewards || 'Empty'}`,
          category: 'loot',
        });
        for (const cid of recipientIds) {
          logPlayerHistory(cid, 'loot', `Opened ${chest.name}${rewards ? `: ${rewards}` : ''}`);
        }
      } else if (sub === 'toggle_beat_player') {
        const cid = payload.characterId;
        const ch = state.characters[cid];
        if (!ch) return { status: 404, error: 'Player character not found.' };
        const existingIdx = arena.tokens.findIndex((t) => t.id === cid);
        if (existingIdx >= 0) {
          arena.tokens.splice(existingIdx, 1);
        } else {
          arena.tokens.push({
            id: ch.id,
            name: ch.name.split(' ')[0],
            type: 'player',
            x: Math.floor(arena.cols / 2),
            y: Math.max(0, arena.rows - 4),
            color: '#38bdf8',
            hp: ch.hp,
            maxHp: ch.maxHp,
            hiddenFromPlayers: false,
            label: ch.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'PL',
          });
        }
      } else if (sub === 'move_beat_token') {
        const tok = arena.tokens.find((t) => t.id === payload.tokenId);
        if (!tok) return { status: 404, error: 'Arena token not found.' };
        if (!isDm && tok.type !== 'player') return { status: 403, error: 'Players cannot move monster tokens.' };
        if (!isDm && characterId && tok.id !== characterId) {
          return { status: 403, error: 'Players can only move their own token.' };
        }
        const nx = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x))));
        const ny = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y))));
        const blocked = (arena.terrain || []).find((t) => t.x === nx && t.y === ny);
        if (blocked) {
          return { status: 400, error: `Impassable terrain (${blocked.type}) blocks that space!` };
        }
        tok.x = nx;
        tok.y = ny;
      } else if (sub === 'save_beat_starts') {
        arena.startPositions = arena.startPositions || {};
        for (const tok of arena.tokens) {
          arena.startPositions[tok.id] = { x: tok.x, y: tok.y };
        }
      } else if (sub === 'reset_beat_starts') {
        const starts = arena.startPositions || {};
        for (const tok of arena.tokens) {
          if (starts[tok.id]) {
            tok.x = Math.max(0, Math.min(arena.cols - 1, starts[tok.id].x));
            tok.y = Math.max(0, Math.min(arena.rows - 1, starts[tok.id].y));
          }
        }
      } else if (sub === 'spawn_beat_monsters') {
        if (!beat.encounters?.length) return { status: 400, error: 'No monsters attached to this story beat.' };
        const spawned = [];
        const startX = Math.max(0, Math.floor(arena.cols / 2) - Math.floor(beat.encounters.length / 2));
        for (let idx = 0; idx < beat.encounters.length; idx++) {
          const enc = beat.encounters[idx];
          const res = await handleAction({
            type: 'spawn_monster',
            role: 'dm',
            payload: {
              ...enc,
              floor: enc.floor || beat.floor || 2,
            },
          });
          if (res.monster) {
            spawned.push(res.monster);
            const mx = enc.startX !== undefined && enc.startX !== '' && enc.startX !== null
              ? Math.max(0, Math.min(arena.cols - 1, Number(enc.startX) - 1))
              : Math.min(arena.cols - 1, startX + idx * 2);
            const my = enc.startY !== undefined && enc.startY !== '' && enc.startY !== null
              ? Math.max(0, Math.min(arena.rows - 1, Number(enc.startY) - 1))
              : Math.min(arena.rows - 1, 3);
            arena.tokens.push({
              id: res.monster.id,
              name: res.monster.name,
              type: 'monster',
              x: mx,
              y: my,
              color: '#ef4444',
              hp: res.monster.hp,
              maxHp: res.monster.maxHp,
              hiddenFromPlayers: Boolean(res.monster.hiddenFromPlayers),
              label: res.monster.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'MN',
            });
          }
        }
        state.version++;
        saveState();
        broadcastEvent('state');
        return { ok: true, spawned };
      } else if (sub === 'award_beat_treasure') {
        if (!beat.treasures?.length) return { status: 400, error: 'No treasures attached to this story beat.' };
        const targetIds = payload.characterId && payload.characterId !== 'all'
          ? [payload.characterId]
          : Object.keys(state.characters);
        for (const cid of targetIds) {
          const ch = state.characters[cid];
          if (!ch) continue;
          ch.currency = ch.currency || { gold: 0, manaStones: 0 };
          ch.inventory = ch.inventory || [];
          for (const tr of beat.treasures) {
            ch.currency.gold = Number(ch.currency.gold || 0) + Number(tr.gold || 0);
            ch.currency.manaStones = Number(ch.currency.manaStones || 0) + Number(tr.manaStones || 0);
            if (tr.name) {
              ch.inventory.push({
                id: `inv-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
                name: tr.name,
                category: tr.category || 'relic',
                qty: Math.max(1, Number(tr.qty || 1)),
                healHp: Number(tr.healHp || 0),
                healMp: Number(tr.healMp || 0),
                slot: tr.slot || (tr.category === 'weapon' ? 'mainHand' : tr.category === 'armor' ? 'body' : 'relic'),
                attackBonus: Number(tr.attackBonus || 0),
                damageDice: String(tr.damageDice || ''),
                damageType: String(tr.damageType || 'Physical'),
                rangeSpaces: Number(tr.rangeSpaces || 2),
                drBonus: Number(tr.drBonus || 0),
                acBonus: Number(tr.acBonus || 0),
                notes: String(tr.notes || `Reward from ${beat.title}`),
              });
            }
          }
        }
        const lootSummary = beat.treasures.map((t) => `${t.name}${t.gold ? ` + ${t.gold}G` : ''}`).join(', ');
        pushSystemToast({
          title: 'TREASURE AWARDED!',
          message: `From "${beat.title}": ${lootSummary}`,
          category: 'loot',
          target: payload.characterId && payload.characterId !== 'all' ? payload.characterId : 'all',
        });
      } else if (sub === 'award_beat_xp') {
        const xpAmt = Math.max(0, Number(payload.xpReward ?? beat.xpReward ?? 0));
        if (!xpAmt) return { status: 400, error: 'This story beat has no XP reward.' };
        const targetIds = payload.characterId && payload.characterId !== 'all'
          ? [payload.characterId]
          : Object.keys(state.characters);
        const leveledNames = [];
        for (const cid of targetIds) {
          const ch = state.characters[cid];
          if (!ch) continue;
          const res = grantXpToCharacter(ch, xpAmt);
          if (res.levelsGained > 0) leveledNames.push(`${ch.name} (Lv ${res.level})`);
        }
        pushSystemToast({
          title: leveledNames.length ? 'XP AWARDED & LEVEL UP!' : 'XP AWARDED!',
          message: leveledNames.length
            ? `+${xpAmt} XP from "${beat.title}"! Level Up (+2 Stat Pts): ${leveledNames.join(', ')}`
            : `+${xpAmt} XP awarded from "${beat.title}"!`,
          category: 'loot',
          target: payload.characterId && payload.characterId !== 'all' ? payload.characterId : 'all',
        });
      } else if (sub === 'update_beat') {
        if (payload.title !== undefined && String(payload.title).trim()) {
          beat.title = String(payload.title).trim().slice(0, 80);
        }
        if (payload.floor !== undefined) beat.floor = Math.max(1, Number(payload.floor || 1));
        if (payload.xpReward !== undefined) beat.xpReward = Math.max(0, Number(payload.xpReward || 0));
        if (payload.narration !== undefined) beat.narration = String(payload.narration || '').slice(0, 800);
        if (payload.dmSecret !== undefined) beat.dmSecret = String(payload.dmSecret || '').slice(0, 500);
        if (payload.presented !== undefined) {
          beat.presented = Boolean(payload.presented);
          if (beat.presented && beat.status === 'upcoming') beat.status = 'active';
        }
        if (payload.status && ['upcoming', 'active', 'resolved'].includes(payload.status)) {
          beat.status = payload.status;
        }
        if (payload.gridSize || payload.gridCols || payload.gridRows) {
          const cols = Math.max(5, Math.min(100, Number(payload.gridCols || payload.gridSize || arena.cols)));
          const rows = Math.max(5, Math.min(100, Number(payload.gridRows || payload.gridSize || arena.rows)));
          arena.cols = cols;
          arena.rows = rows;
          for (const tok of arena.tokens) {
            tok.x = Math.max(0, Math.min(cols - 1, tok.x));
            tok.y = Math.max(0, Math.min(rows - 1, tok.y));
          }
          for (const ch of arena.chests || []) {
            ch.x = Math.max(0, Math.min(cols - 1, ch.x));
            ch.y = Math.max(0, Math.min(rows - 1, ch.y));
          }
          arena.terrain = (arena.terrain || []).filter((t) => t.x < cols && t.y < rows);
        }
        if (Array.isArray(payload.encounters)) beat.encounters = payload.encounters;
        if (Array.isArray(payload.treasures)) beat.treasures = payload.treasures;
      } else if (sub === 'delete_beat') {
        state.storyBeats = state.storyBeats.filter((b) => b.id !== beat.id);
      }

      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, beat, storyBeats: state.storyBeats };
    }

    case 'allocate_stat': {
      const ch = state.characters[payload.characterId || characterId];
      if (!ch) return { status: 404, error: 'Character not found.' };
      if (!isDm && characterId && characterId !== ch.id) {
        return { status: 403, error: 'Players can only allocate points on their own character.' };
      }
      const statKey = String(payload.statKey || '').trim().toUpperCase();
      const amount = Math.max(1, Math.trunc(Number(payload.amount || 1)));
      if (!statKey) return { status: 400, error: 'Stat key is required.' };
      const available = Number(ch.unspentStatPoints || 0);
      if (available < amount) return { status: 400, error: 'Not enough unspent stat points.' };
      ch.stats = ch.stats || {};
      ch.stats[statKey] = Number(ch.stats[statKey] || 0) + amount;
      ch.unspentStatPoints = available - amount;
      logPlayerHistory(ch.id, 'stat', `Allocated +${amount} ${statKey} (now ${ch.stats[statKey]})`);
      syncCharacterDerived(ch.id);
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, character: ch };
    }

    case 'grant_xp': {
      if (!isDm) return { status: 403, error: 'Only the Dungeon Master can grant XP.' };
      const targetIds = payload.characterId && payload.characterId !== 'all'
        ? [payload.characterId]
        : Object.keys(state.characters);
      const xpAmt = Math.max(1, Math.round(Number(payload.xp || 50)));
      const outcomes = {};
      for (const cid of targetIds) {
        const ch = state.characters[cid];
        if (!ch) continue;
        outcomes[cid] = grantXpToCharacter(ch, xpAmt);
      }
      state.version++;
      saveState();
      broadcastEvent('state');
      return { ok: true, outcomes };
    }

    case 'reset_campaign': {
      if (!isDm) return { status: 403, error: 'Only the Dungeon Master can reset campaign state.' };
      state = getInitialState();
      saveState();
      broadcastEvent('state');
      return { ok: true };
    }

    default:
      return { status: 400, error: `Unknown action type: ${type}` };
  }
}

// ---------------------------------------------------------------------------
// HTTP Request Body Helper
// ---------------------------------------------------------------------------
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
function createServer() {
  return http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { ok: true, status: state.session.status });
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      const role = parsedUrl.searchParams.get('role') === 'dm' ? 'dm' : 'player';
      const characterId = parsedUrl.searchParams.get('characterId') || null;
      return sendJson(res, 200, filterStateForRole(state, role, characterId));
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      const role = parsedUrl.searchParams.get('role') === 'dm' ? 'dm' : 'player';
      const characterId = parsedUrl.searchParams.get('characterId') || null;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      const client = { res, role, characterId };
      sseClients.add(client);
      res.write(`event: state\ndata: ${JSON.stringify(filterStateForRole(state, role, characterId))}\n\n`);
      req.on('close', () => sseClients.delete(client));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/check-email') {
      try {
        const body = await readJsonBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const account = state.playerAccounts[email];
        if (!account) {
          return sendJson(res, 404, {
            ok: false,
            error: 'This email is not registered by the Dungeon Master yet. Send your email to your DM first!',
          });
        }
        return sendJson(res, 200, {
          ok: true,
          email: account.email,
          activated: Boolean(account.activated),
          username: account.username,
          characterId: account.characterId,
          characterName: state.characters[account.characterId]?.name || '',
        });
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid request.' });
      }
    }

    if (req.method === 'POST' && pathname === '/api/auth/activate') {
      try {
        const body = await readJsonBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const desiredUsername = String(body.username || '').trim();
        const account = state.playerAccounts[email];

        if (!account) return sendJson(res, 404, { ok: false, error: 'Email is not whitelisted by the Dungeon Master.' });
        if (account.activated) return sendJson(res, 409, { ok: false, error: 'Account already activated. Log in with your username/email and password.' });
        if (password.length < 4) return sendJson(res, 400, { ok: false, error: 'Password must be at least 4 characters.' });

        if (desiredUsername) {
          const conflict = Object.values(state.playerAccounts).find(
            (a) => a.email !== email && a.username.toLowerCase() === desiredUsername.toLowerCase()
          );
          if (conflict) return sendJson(res, 409, { ok: false, error: 'That username is already taken.' });
          account.username = desiredUsername.slice(0, 30);
        }

        if (body.createNewCharacter && body.characterName) {
          const created = createNewCharacterRecord({
            name: body.characterName,
            race: body.race || 'Human',
            className: body.className || 'Tower Climber',
          });
          account.characterId = created.id;
        } else if (body.characterId && state.characters[body.characterId]) {
          account.characterId = body.characterId;
        }

        const { salt, hash } = hashPassword(password);
        account.salt = salt;
        account.passwordHash = hash;
        account.activated = true;
        account.lastLoginAt = new Date().toISOString();

        state.version++;
        saveState();
        broadcastEvent('state');

        return sendJson(res, 200, {
          ok: true,
          session: {
            role: 'player',
            email: account.email,
            username: account.username,
            characterId: account.characterId,
            name: state.characters[account.characterId]?.name || account.username,
          },
        });
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid activation request.' });
      }
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      try {
        const body = await readJsonBody(req);
        const identifier = String(body.identifier || body.email || body.username || '').trim().toLowerCase();
        const password = String(body.password || body.passcode || '');

        if (identifier === 'admin') {
          if (password !== '123456' && password !== DM_PASSCODE) {
            return sendJson(res, 401, { ok: false, error: 'Invalid Dungeon Master password.' });
          }
          return sendJson(res, 200, { ok: true, session: { role: 'dm', name: 'Dungeon Master' } });
        }

        if (identifier === 'player') {
          if (password !== '123456') {
            return sendJson(res, 401, { ok: false, error: 'Invalid player password.' });
          }
          const mockCharId = state.characters['char-2'] ? 'char-2' : Object.keys(state.characters)[0];
          return sendJson(res, 200, {
            ok: true,
            session: {
              role: 'player',
              email: 'kaelen@tower.gg',
              username: 'player',
              characterId: mockCharId,
              name: state.characters[mockCharId]?.name || 'Player',
            },
          });
        }

        if (body.role === 'dm' || ['dm', 'dungeonmaster', 'dm@tower.gg'].includes(identifier)) {
          if (password !== DM_PASSCODE && password !== '123456') {
            return sendJson(res, 401, { ok: false, error: 'Invalid Dungeon Master password.' });
          }
          return sendJson(res, 200, { ok: true, session: { role: 'dm', name: 'Dungeon Master' } });
        }

        const account = Object.values(state.playerAccounts).find(
          (a) => a.email.toLowerCase() === identifier || a.username.toLowerCase() === identifier
        );
        if (!account) return sendJson(res, 401, { ok: false, error: 'Invalid username/email or password.' });

        let firstTimeActivated = false;
        if (!account.activated) {
          if (password.length < 4) {
            return sendJson(res, 400, {
              ok: false,
              requiresActivation: true,
              email: account.email,
              error: 'First-time login: enter a password of at least 4 characters to activate your account.',
            });
          }
          const { salt, hash } = hashPassword(password);
          account.salt = salt;
          account.passwordHash = hash;
          account.activated = true;
          firstTimeActivated = true;
        } else if (!verifyPassword(password, account.salt, account.passwordHash)) {
          return sendJson(res, 401, { ok: false, error: 'Incorrect password.' });
        }

        account.lastLoginAt = new Date().toISOString();
        if (firstTimeActivated) state.version++;
        saveState();
        broadcastEvent('state');

        return sendJson(res, 200, {
          ok: true,
          firstTimeActivated,
          session: {
            role: 'player',
            email: account.email,
            username: account.username,
            characterId: account.characterId,
            name: state.characters[account.characterId]?.name || account.username,
          },
        });
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Invalid login request.' });
      }
    }

    if (req.method === 'POST' && pathname === '/api/auth/update-credentials') {
      try {
        const body = await readJsonBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const account = state.playerAccounts[email];
        if (!account || !account.activated) return sendJson(res, 404, { ok: false, error: 'Active player account not found.' });
        if (!verifyPassword(String(body.currentPassword || ''), account.salt, account.passwordHash)) {
          return sendJson(res, 401, { ok: false, error: 'Current password is incorrect.' });
        }

        const newUsername = String(body.newUsername || '').trim();
        if (newUsername && newUsername.toLowerCase() !== account.username.toLowerCase()) {
          const taken = Object.values(state.playerAccounts).find(
            (a) => a.email !== email && a.username.toLowerCase() === newUsername.toLowerCase()
          );
          if (taken) return sendJson(res, 409, { ok: false, error: 'Username already taken.' });
          account.username = newUsername.slice(0, 30);
        }

        const newPassword = String(body.newPassword || '');
        if (newPassword) {
          if (newPassword.length < 4) return sendJson(res, 400, { ok: false, error: 'New password must be at least 4 characters.' });
          const { salt, hash } = hashPassword(newPassword);
          account.salt = salt;
          account.passwordHash = hash;
        }

        state.version++;
        saveState();
        broadcastEvent('state');
        return sendJson(res, 200, { ok: true, username: account.username, email: account.email });
      } catch {
        return sendJson(res, 400, { ok: false, error: 'Failed to update credentials.' });
      }
    }

    if (req.method === 'POST' && pathname === '/api/action') {
      try {
        const body = await readJsonBody(req);
        const result = await handleAction(body);
        if (result.error) return sendJson(res, result.status || 400, { ok: false, error: result.error });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message || 'Server error' });
      }
    }

    const safePath = pathname === '/' ? '/index.html' : pathname;
    const resolved = path.normalize(path.join(PUBLIC_DIR, safePath));
    if (!resolved.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
    fs.readFile(resolved, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(content);
    });
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Tower System VTT server running at http://localhost:${PORT}`);
  });
}

module.exports = {
  createServer,
  evaluateFormula,
  rollDiceServer,
  getInitialState,
  parseDeityTextIntoEntries,
};
