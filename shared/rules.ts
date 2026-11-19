import { evaluateFormula } from './formulas';
import type {
  Character,
  EquipmentItem,
  MechanicsConfig,
  Spell,
  SpellCraftLimits,
  SpellElement,
  StatMilestone,
} from './types';

export const SPELL_ELEMENTS: SpellElement[] = ['Fire', 'Earth', 'Wind', 'Water', 'Light', 'Dark'];

export function normalizeSpellElement(raw: unknown): SpellElement {
  const val = String(raw || '').trim().toLowerCase();
  if (val.includes('fire') || val.includes('flame') || val.includes('crimson')) return 'Fire';
  if (val.includes('earth') || val.includes('stone') || val.includes('barrier') || val.includes('force')) return 'Earth';
  if (val.includes('wind') || val.includes('gale') || val.includes('air') || val.includes('lightning')) return 'Wind';
  if (val.includes('water') || val.includes('ice') || val.includes('shinsu') || val.includes('aqua')) return 'Water';
  if (val.includes('light') || val.includes('radiant') || val.includes('holy') || val.includes('dawn')) return 'Light';
  if (val.includes('dark') || val.includes('shadow') || val.includes('necrotic') || val.includes('abyss')) return 'Dark';
  return 'Fire';
}

export function getMaxSpellsForLevel(level: number): number {
  const lv = Math.max(1, Number(level || 1));
  return Math.min(10, 1 + Math.floor(lv / 3));
}

export function getSpellCraftLimits(floorLevel: number): SpellCraftLimits {
  const fl = Math.max(1, Number(floorLevel || 1));
  const maxDice = Math.min(8, 1 + Math.floor((fl + 1) / 2));
  const maxSides = Math.min(12, 8 + Math.floor((fl - 1) / 2) * 2);
  const maxBonus = 2 + (fl - 1) * 2;
  const maxRange = Math.min(16, 4 + (fl - 1) * 2);
  return { floor: fl, maxDice, maxSides, maxBonus, maxRange };
}

export function clampSpellToFloor(
  sp: Partial<Spell>,
  floorLevel: number,
): { damageDice: string; rangeSpaces: number; mpCost: number; limits: SpellCraftLimits; minMp: number } {
  const lim = getSpellCraftLimits(floorLevel);
  const rawDice = String(sp.damageDice || '1d8+2').trim();
  const m = rawDice.match(/^(\d+)\s*d\s*(\d+)(?:\s*([+-])\s*(\d+))?$/i);
  let count = m ? Math.max(1, Number(m[1])) : 1;
  let sides = m ? Math.max(4, Number(m[2])) : 8;
  let bonus = m && m[4] ? (m[3] === '-' ? -Number(m[4]) : Number(m[4])) : 0;

  count = Math.min(count, lim.maxDice);
  sides = Math.min(sides, lim.maxSides);
  bonus = Math.max(0, Math.min(bonus, lim.maxBonus));
  const clampedDice = `${count}d${sides}${bonus > 0 ? `+${bonus}` : ''}`;
  const avgDmg = count * ((sides + 1) / 2) + bonus;
  const minMp = Math.max(2, Math.ceil(avgDmg / 3));
  const rangeSpaces = Math.max(1, Math.min(lim.maxRange, Number(sp.rangeSpaces || lim.maxRange)));
  const mpCost = Math.max(minMp, Number(sp.mpCost || minMp));
  return { damageDice: clampedDice, rangeSpaces, mpCost, limits: lim, minMp };
}

export function isStatsAndEquipmentLocked(src: {
  session?: { status?: string };
  storyBeats?: Array<{ presented?: boolean; status?: string }>;
}): boolean {
  return src.session?.status === 'active'
    && (src.storyBeats || []).some((b) => Boolean(b.presented) && b.status === 'active');
}

export function getMaxAttacksForFloor(floor: number): number {
  return 1 + Math.floor(Math.max(0, Number(floor || 1) - 1) / 4);
}

export function getWeaponAttackInfo(character?: Partial<Character> | null): { isRanged: boolean; maxRange: number } {
  const wep = character?.equipment?.mainHand;
  const isRanged = Boolean(
    wep && (
      Number(wep.rangeSpaces || 1) >= 3
      || /bow|crossbow|shortbow|longbow|arrow|gun|rifle/i.test(wep.name || '')
      || /ranged/i.test(wep.damageType || '')
    ),
  );
  const maxRange = isRanged ? Math.max(3, Number(wep?.rangeSpaces || 3)) : 1;
  return { isRanged, maxRange };
}

export function getEquippedTotals(character?: Partial<Character> | null): {
  attackBonus: number;
  armorAc: number;
  armorDr: number;
  mainWeapon: EquipmentItem | null;
} {
  const eq: Record<string, EquipmentItem | null | undefined> = character?.equipment || {};
  let attackBonus = 0;
  let armorAc = 0;
  let armorDr = 0;
  let mainWeapon: EquipmentItem | null = null;

  for (const [slot, item] of Object.entries(eq)) {
    if (!item) continue;
    attackBonus += Number(item.attackBonus || 0);
    armorAc += Number(item.acBonus || 0);
    armorDr += Number(item.drBonus || 0);
    if (slot === 'mainHand') mainWeapon = item;
  }
  return { attackBonus, armorAc, armorDr, mainWeapon };
}

export const DEFAULT_STAT_MILESTONES: StatMilestone[] = [
  { id: 'ms-str-20', statKey: 'STR', threshold: 20, abilityName: 'Titan Cleave', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+4 melee damage & ignores 2 DR on heavy strikes.' },
  { id: 'ms-str-40', statKey: 'STR', threshold: 40, abilityName: 'Earthshaker Blow', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+8 melee damage & shockwave knockback.' },
  { id: 'ms-str-60', statKey: 'STR', threshold: 60, abilityName: 'Mountain Splitter', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+14 melee damage & ignores 5 DR.' },
  { id: 'ms-str-80', statKey: 'STR', threshold: 80, abilityName: 'Sovereign Might', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+22 melee damage & crushes shields/barriers.' },
  { id: 'ms-str-100', statKey: 'STR', threshold: 100, abilityName: 'Worldbreaker Apex', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+35 melee damage & guaranteed guard-crush.' },
  { id: 'ms-agi-20', statKey: 'AGI', threshold: 20, abilityName: 'Phantom Step', bonusHp: 0, bonusMp: 0, bonusAc: 2, bonusDr: 0, description: '+2 AC, +3 Initiative, and evasive dash.' },
  { id: 'ms-agi-40', statKey: 'AGI', threshold: 40, abilityName: 'Shadow Afterimage', bonusHp: 0, bonusMp: 0, bonusAc: 3, bonusDr: 0, description: '+3 AC, +2 Spaces speed, auto-evade 1/round.' },
  { id: 'ms-agi-60', statKey: 'AGI', threshold: 60, abilityName: 'Flashstep Mirage', bonusHp: 0, bonusMp: 0, bonusAc: 4, bonusDr: 0, description: '+4 AC, +5 Initiative, counter-dash.' },
  { id: 'ms-agi-80', statKey: 'AGI', threshold: 80, abilityName: 'Temporal Blur', bonusHp: 0, bonusMp: 0, bonusAc: 5, bonusDr: 0, description: '+5 AC, +3 Spaces speed, double reaction.' },
  { id: 'ms-agi-100', statKey: 'AGI', threshold: 100, abilityName: 'Godspeed Ascension', bonusHp: 0, bonusMp: 0, bonusAc: 7, bonusDr: 0, description: '+7 AC, +10 Initiative, untargetable dash.' },
  { id: 'ms-vit-20', statKey: 'VIT', threshold: 20, abilityName: 'Immortal Vessel', bonusHp: 20, bonusMp: 0, bonusAc: 0, bonusDr: 2, description: '+20 Max HP & +2 Damage Reduction (DR).' },
  { id: 'ms-vit-40', statKey: 'VIT', threshold: 40, abilityName: 'Adamantine Flesh', bonusHp: 40, bonusMp: 0, bonusAc: 0, bonusDr: 3, description: '+40 Max HP & +3 DR.' },
  { id: 'ms-vit-60', statKey: 'VIT', threshold: 60, abilityName: 'Undying Core', bonusHp: 70, bonusMp: 0, bonusAc: 0, bonusDr: 4, description: '+70 Max HP, +4 DR, survive lethal hit at 1 HP (1/battle).' },
  { id: 'ms-vit-80', statKey: 'VIT', threshold: 80, abilityName: 'Regenerating Titan', bonusHp: 110, bonusMp: 0, bonusAc: 0, bonusDr: 6, description: '+110 Max HP, +6 DR, heal 10 HP per turn.' },
  { id: 'ms-vit-100', statKey: 'VIT', threshold: 100, abilityName: 'Eternal Sovereign Body', bonusHp: 160, bonusMp: 0, bonusAc: 0, bonusDr: 10, description: '+160 Max HP, +10 DR, status immunity.' },
  { id: 'ms-int-20', statKey: 'INT', threshold: 20, abilityName: 'Archmage Resonance', bonusHp: 0, bonusMp: 15, bonusAc: 0, bonusDr: 0, description: '+15 Max MP & +4 spell power.' },
  { id: 'ms-int-40', statKey: 'INT', threshold: 40, abilityName: 'Shinsu Overdrive', bonusHp: 0, bonusMp: 30, bonusAc: 0, bonusDr: 0, description: '+30 Max MP & +8 spell power.' },
  { id: 'ms-int-60', statKey: 'INT', threshold: 60, abilityName: 'Astral Domain', bonusHp: 0, bonusMp: 50, bonusAc: 0, bonusDr: 0, description: '+50 Max MP, +14 spell power, -2 MP spell cost.' },
  { id: 'ms-int-80', statKey: 'INT', threshold: 80, abilityName: 'Grand Sovereign Grimoire', bonusHp: 0, bonusMp: 80, bonusAc: 0, bonusDr: 0, description: '+80 Max MP, +22 spell power, dual-cast spells.' },
  { id: 'ms-int-100', statKey: 'INT', threshold: 100, abilityName: 'Omniscient Origin', bonusHp: 0, bonusMp: 120, bonusAc: 0, bonusDr: 0, description: '+120 Max MP, +35 spell power, half MP costs.' },
  { id: 'ms-per-20', statKey: 'PER', threshold: 20, abilityName: 'True Sight', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+3 Accuracy & +2 Range Spaces to spot weakpoints.' },
  { id: 'ms-per-40', statKey: 'PER', threshold: 40, abilityName: 'Weakpoint Lock', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+5 Accuracy & +3 Range Spaces.' },
  { id: 'ms-per-60', statKey: 'PER', threshold: 60, abilityName: 'Eagle Horizon', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+7 Accuracy, +5 Range Spaces, pierces stealth.' },
  { id: 'ms-per-80', statKey: 'PER', threshold: 80, abilityName: 'Fatal Foresight', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+10 Accuracy & +2 reaction parry.' },
  { id: 'ms-per-100', statKey: 'PER', threshold: 100, abilityName: 'All-Seeing Eye', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: '+14 Accuracy, ignores cover & stealth.' },
  { id: 'ms-luck-20', statKey: 'LUCK', threshold: 20, abilityName: 'Fatebreaker', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: 'Critical hits trigger on 18-20 & +25% treasure luck.' },
  { id: 'ms-luck-40', statKey: 'LUCK', threshold: 40, abilityName: "Gambler's Miracle", bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: 'Reroll any d20 or d100 roll (1/battle).' },
  { id: 'ms-luck-60', statKey: 'LUCK', threshold: 60, abilityName: 'Golden Providence', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: 'Crits on 17-20 & +50% gold/loot luck.' },
  { id: 'ms-luck-80', statKey: 'LUCK', threshold: 80, abilityName: 'Karma Reversal', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: 'Turn an incoming crit into a miss (1/battle).' },
  { id: 'ms-luck-100', statKey: 'LUCK', threshold: 100, abilityName: 'Sovereign of Fortune', bonusHp: 0, bonusMp: 0, bonusAc: 0, bonusDr: 0, description: 'Crits on 15-20 & guaranteed rare treasure drops.' },
];

export function buildCharacterVarScope(
  character?: Partial<Character> | null,
  mechanics?: Partial<MechanicsConfig> | null,
  extra: Record<string, number> = {},
): Record<string, number> {
  const totals = getEquippedTotals(character);
  const vars: Record<string, number> = {
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

export function computeStatModifier(
  score: number,
  mechanics?: Partial<MechanicsConfig> | null,
  character?: Partial<Character> | null,
): number {
  const formula = mechanics?.statFormula || 'floor((SCORE - 10) / 2)';
  const scope = buildCharacterVarScope(character, mechanics, { SCORE: Number(score || 0) });
  return Math.trunc(evaluateFormula(formula, scope));
}
