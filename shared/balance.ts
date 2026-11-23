import { PASSIVE_GACHA_ODDS, PASSIVE_SKILL_POOL } from './passiveSkills';
import type {
  ActiveUnitEffect,
  AttackArea,
  BestiaryEntry,
  BestiaryLootDrop,
  Character,
  ChestLootSummary,
  ChestPassiveTrigger,
  ChestTier,
  ChestTierConfig,
  GameState,
  MapChest,
  MonsterAttackArea,
  MonsterSkill,
  PassiveTier,
  TreasureEntry,
  UnitEffectKind,
  UnitEffectSpec,
} from './types';

/**
 * "Tower-Hard Ascent" balance curve.
 *
 * Design intent: Climbers start fragile and every early fight is tense, but power compounds as they
 * climb: level-ups grant HP/MP and bonus stat points, damage gains a level-based bonus, stat
 * modifiers swing bigger at high scores, and passive-gacha odds improve with floor depth.
 * All tuning numbers live here so the server (enforcement) and client (previews) stay in sync.
 */
export const BALANCE = {
  start: {
    maxHp: 24,
    maxMp: 15,
    speedSpaces: 3,
    unspentStatPoints: 6,
    defaultStat: 10,
    gold: 60,
    manaStones: 1,
    potionHeal: 8,
    potionQty: 2,
  },
  /** Each point invested in VIT / INT directly raises max HP / MP so early stat choices matter. */
  perVitPointHp: 2,
  perIntPointMp: 1,
  levelUp: {
    baseHp: 5,
    baseMp: 2,
    statPoints: 2,
    bonusStatPointEveryLevels: 3,
  },
  xp: {
    base: 100,
    perLevel: 60,
  },
  /** Spell MP floor = ceil(avgDamage / divisor). Lower divisor = pricier spells. */
  spellMpDivisor: 2,
  /** DM-granted Rest Spots restore a percentage of max HP/MP and only work outside combat. */
  restSpot: {
    name: 'Sanctuary Rest Spot',
    hpPct: 0.5,
    mpPct: 0.5,
  },
  /** Passive gacha: percentage points shifted out of `Normal` per floor climbed (capped). */
  gacha: {
    shiftPerFloor: 0.9,
    maxFloorsCounted: 20,
  },
  monster: {
    hpPerFloorPct: 0.22,
    acEveryFloors: 2,
    drEveryFloors: 3,
    attackBonusPerFloor: 0.8,
    damageBonusPerFloor: 1.5,
    baseXp: 10,
    xpPerFloor: 5,
  },
} as const;

/** Flatter modifiers early (+1 per 3 points), bigger swings late (+1 extra every 30 points). */
export const TOWER_STAT_FORMULA = 'floor((SCORE - 10) / 3) + floor(SCORE / 30)';
/** Damage grows with character level: +1 every 3 levels on top of stat modifier. */
export const TOWER_DAMAGE_FORMULA = 'max(1, (RAW_DMG * CRIT_MULT) + STAT_MOD + floor(LEVEL / 3) - TARGET_DR)';
/** Attacks roll d20 + this vs monster AC; +1 accuracy every 4 levels keeps pace with floor-scaled AC. */
export const TOWER_HIT_FORMULA = 'ROLL + STAT_MOD + WEAPON_BONUS + floor(LEVEL / 4)';
export const TOWER_PRESET_NAME = 'Tower-Hard Ascent';

export function restSpotRestore(maxHp: number, maxMp: number): { hp: number; mp: number } {
  return {
    hp: Math.ceil(Math.max(0, Number(maxHp) || 0) * BALANCE.restSpot.hpPct),
    mp: Math.ceil(Math.max(0, Number(maxMp) || 0) * BALANCE.restSpot.mpPct),
  };
}

/** +1 Space per +4 AGI above 10 (capped at +8). */
export function computeAgiMoveBonus(agi: number): number {
  return Math.max(0, Math.min(8, Math.floor((Number(agi ?? 10) - 10) / 4)));
}

/** +0 on 1F-4F, +1 at 5F, +2 at 15F, ... up to +8 at 75F-100F. */
export function computeFloorMoveBonus(floor: number): number {
  const f = Math.max(1, Math.trunc(Number(floor) || 1));
  if (f < 5) return 0;
  return Math.min(8, 1 + Math.floor((f - 5) / 10));
}

export function computeCharacterMoveSpaces(opts: {
  agi?: number;
  floor?: number;
  passiveSpeedBonus?: number;
  round1Bonus?: number;
  effectSpeedDelta?: number;
}): {
  base: number;
  agiBonus: number;
  floorBonus: number;
  passiveBonus: number;
  total: number;
} {
  const base = BALANCE.start.speedSpaces;
  const agiBonus = computeAgiMoveBonus(Number(opts.agi ?? 10));
  const floorBonus = computeFloorMoveBonus(Number(opts.floor ?? 1));
  const passiveBonus = Math.max(0, Math.trunc(Number(opts.passiveSpeedBonus || 0)));
  const round1Bonus = Math.trunc(Number(opts.round1Bonus || 0));
  const effectSpeedDelta = Math.trunc(Number(opts.effectSpeedDelta || 0));
  return {
    base,
    agiBonus,
    floorBonus,
    passiveBonus,
    total: Math.max(1, base + agiBonus + floorBonus + passiveBonus + round1Bonus + effectSpeedDelta),
  };
}

export function xpToNextForLevel(level: number): number {
  const lv = Math.max(1, Math.trunc(Number(level) || 1));
  return BALANCE.xp.base + (lv - 1) * BALANCE.xp.perLevel;
}

export function statPointsForLevelUp(newLevel: number): number {
  const lv = Math.max(1, Math.trunc(Number(newLevel) || 1));
  const bonus = lv % BALANCE.levelUp.bonusStatPointEveryLevels === 0 ? 1 : 0;
  return BALANCE.levelUp.statPoints + bonus;
}

export function levelUpGrowth(vitMod: number, intMod: number): { hp: number; mp: number } {
  return {
    hp: BALANCE.levelUp.baseHp + Math.max(0, Math.trunc(vitMod)),
    mp: BALANCE.levelUp.baseMp + Math.max(0, Math.floor(Math.trunc(intMod) / 2)),
  };
}

/** Highest floor of any live (presented, unresolved) story beat; falls back to 1. */
export function getPartyFloor(state: Pick<GameState, 'storyBeats'> | { storyBeats?: GameState['storyBeats'] }): number {
  const beats = state.storyBeats || [];
  const live = beats.filter((b) => b.presented && b.status !== 'resolved');
  const pool = live.length > 0 ? live : beats.filter((b) => b.presented);
  return Math.max(1, ...pool.map((b) => Math.trunc(Number(b.floor) || 1)));
}

/** Passive gacha odds improve as the party climbs: weight moves from Normal into higher tiers. */
export function getPassiveOddsForFloor(floor: number): Record<PassiveTier, number> {
  const floorsClimbed = Math.min(BALANCE.gacha.maxFloorsCounted, Math.max(0, Math.trunc(Number(floor) || 1) - 1));
  const shift = floorsClimbed * BALANCE.gacha.shiftPerFloor;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const o = PASSIVE_GACHA_ODDS;
  return {
    Normal: r2(o.Normal - shift),
    Advanced: r2(o.Advanced + shift * 0.3),
    Rare: r2(o.Rare + shift * 0.3),
    'Super Rare': r2(o['Super Rare'] + shift * 0.2),
    'Super Super Rare': r2(o['Super Super Rare'] + shift * 0.1),
    Legendary: r2(o.Legendary + shift * 0.07),
    Mythic: r2(o.Mythic + shift * 0.03),
  };
}

const TIER_ROLL_ORDER: PassiveTier[] = [
  'Mythic',
  'Legendary',
  'Super Super Rare',
  'Super Rare',
  'Rare',
  'Advanced',
  'Normal',
];

/** `roll01` is a uniform number in [0, 1). */
export function pickPassiveTier(odds: Record<PassiveTier, number>, roll01: number): PassiveTier {
  const total = TIER_ROLL_ORDER.reduce((sum, t) => sum + Math.max(0, odds[t] || 0), 0) || 100;
  let cursor = roll01 * total;
  for (const tier of TIER_ROLL_ORDER) {
    cursor -= Math.max(0, odds[tier] || 0);
    if (cursor < 0) return tier;
  }
  return 'Normal';
}

/** Adds a flat bonus to the `+N` tail of a dice formula like `1d8+3` -> `1d8+5`. */
export function scaleDiceFormula(formula: string, extraFlat: number): string {
  const clean = String(formula || '').replace(/\s+/g, '');
  const m = clean.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m || !extraFlat) return formula;
  const flat = Number(m[3] || 0) + Math.trunc(extraFlat);
  const flatText = flat === 0 ? '' : flat > 0 ? `+${flat}` : `${flat}`;
  return `${m[1] || '1'}d${m[2]}${flatText}`;
}

export interface MonsterBaseStats {
  maxHp: number;
  ac: number;
  dr: number;
  attackFormula: string;
  damageFormula: string;
}

/** Bestiary presets are floor-1 baselines; this scales them up for deeper floors. */
export function scaleMonsterForFloor<T extends MonsterBaseStats>(base: T, floor: number): T {
  const f = Math.max(1, Math.trunc(Number(floor) || 1));
  const climbed = f - 1;
  const M = BALANCE.monster;
  return {
    ...base,
    maxHp: Math.max(1, Math.round(base.maxHp * (1 + M.hpPerFloorPct * climbed))),
    ac: base.ac + Math.floor(climbed / M.acEveryFloors),
    dr: base.dr + Math.floor(climbed / M.drEveryFloors),
    attackFormula: scaleDiceFormula(base.attackFormula, Math.floor(climbed * M.attackBonusPerFloor)),
    damageFormula: scaleDiceFormula(base.damageFormula, Math.floor(climbed * M.damageBonusPerFloor)),
  };
}

export function getMonsterXpReward(floor: number): number {
  const f = Math.max(1, Math.trunc(Number(floor) || 1));
  return BALANCE.monster.baseXp + BALANCE.monster.xpPerFloor * f;
}

export function formatItemCategory(category: string): string {
  const clean = String(category || 'relic').trim().toLowerCase();
  if (clean === 'skill_book' || clean === 'skill book') return 'Skill Book';
  if (clean === 'weapon') return 'Weapon';
  if (clean === 'armor') return 'Armor';
  if (clean === 'relic') return 'Relic';
  if (clean === 'consumable') return 'Consumable';
  if (clean === 'material') return 'Material';
  return clean.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getItemCategoryTagClass(category: string): string {
  const clean = String(category || 'relic').trim().toLowerCase();
  if (clean === 'weapon') return 'tag-crimson';
  if (clean === 'armor') return 'tag-cyan';
  if (clean === 'relic') return 'tag-purple';
  if (clean === 'skill_book' || clean === 'skill book') return 'tag-gold';
  if (clean === 'consumable') return 'tag-green';
  if (clean === 'material') return 'tag-copper';
  return 'tag-cyan';
}

export function getItemTierTagClass(tier?: string): string {
  const clean = String(tier || 'Common').trim().toLowerCase();
  if (clean === 'uncommon') return 'tag-item-uncommon';
  if (clean === 'rare') return 'tag-item-rare';
  if (clean === 'epic') return 'tag-item-epic';
  if (clean === 'legendary') return 'tag-item-legendary';
  if (clean === 'mythic') return 'tag-item-mythic';
  return 'tag-item-common';
}

export function inferItemTier(
  item: {
    tier?: ChestTier;
    minFloor?: number;
    floorLevel?: number;
    baseGold?: number;
    dropChancePct?: number;
    category?: string;
  },
  fallbackTier?: ChestTier,
): ChestTier {
  if (item.tier && ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'].includes(item.tier)) {
    return item.tier;
  }
  if (fallbackTier && ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'].includes(fallbackTier)) {
    return fallbackTier;
  }
  const fl = Number(item.minFloor || item.floorLevel || 1);
  const gold = Number(item.baseGold || 0);
  const chance = Number(item.dropChancePct || 100);
  if (fl >= 5 || gold >= 160) return 'Mythic';
  if (fl >= 4 || gold >= 110) return 'Legendary';
  if (fl >= 3 || gold >= 65) return 'Epic';
  if (fl >= 2 || gold >= 35 || chance <= 35) return 'Rare';
  if (gold >= 18 || chance <= 55 || item.category === 'relic' || item.category === 'skill_book') return 'Uncommon';
  return 'Common';
}

export interface FloorLootProfile {
  dropChanceMult: number;
  maxItems: number;
  goldMult: number;
  baseKillGold: number;
  manaStoneDropChancePct: number;
}

export function getFloorLootProfile(floor: number, isBoss = false): FloorLootProfile {
  const f = Math.max(1, Math.trunc(Number(floor) || 1));
  const baseDropMult = f === 1 ? 0.35 : Math.min(1.0, 0.35 + Math.sqrt(f - 1) * 0.16);
  const dropChanceMult = isBoss ? Math.min(1.0, baseDropMult + 0.25) : baseDropMult;
  const maxItems = isBoss
    ? f <= 3 ? 2 : f <= 10 ? 3 : 4
    : f <= 2 ? 1 : f <= 15 ? 2 : 3;
  const goldMult = f === 1 ? 0.35 : 0.35 + (f - 1) * 0.22;
  const baseKillGold = Math.round((4 + f * 3) * (isBoss ? 2.5 : 1));
  const manaStoneDropChancePct = isBoss
    ? 100
    : f === 1 ? 20 : f === 2 ? 30 : f <= 5 ? 45 : f <= 10 ? 65 : 85;
  return {
    dropChanceMult,
    maxItems,
    goldMult,
    baseKillGold,
    manaStoneDropChancePct,
  };
}

export function scaleLootDropForFloor(
  drop: BestiaryLootDrop,
  floor: number,
  isBoss = false,
): BestiaryLootDrop & {
  tier: ChestTier;
  scaledGold: number;
  scaledManaStones: number;
  scaledDropChancePct: number;
  unlocked: boolean;
} {
  const f = Math.max(1, Math.trunc(Number(floor) || 1));
  const climbed = f - 1;
  const minFloor = Math.max(1, Number(drop.minFloor || 1));
  const profile = getFloorLootProfile(f, isBoss);
  const rawStones = Number(drop.baseManaStones || 0);
  const scaledManaStones =
    rawStones <= 0
      ? 0
      : !isBoss && f <= 2
        ? rawStones >= 2 ? 1 : 0
        : Math.max(1, Math.round(rawStones * (f >= 6 ? 1 : 0.5)) + Math.floor(climbed / 4));
  return {
    ...drop,
    tier: inferItemTier(drop),
    scaledGold: Math.max(0, Math.round(Number(drop.baseGold || 0) * profile.goldMult)),
    scaledManaStones,
    scaledDropChancePct: Math.max(5, Math.min(100, Math.round(Number(drop.dropChancePct || 50) * profile.dropChanceMult))),
    unlocked: f >= minFloor,
  };
}

const ICONIC_LOOT_BY_ID: Record<string, BestiaryLootDrop[]> = {
  'best-goblin': [
    { itemName: 'Goblin Rusty Dagger', category: 'weapon', dropChancePct: 45, baseGold: 12, baseManaStones: 0, notes: '1d6+1 Piercing' },
    { itemName: 'Gatekeeper Coin Pouch', category: 'relic', dropChancePct: 70, baseGold: 22, baseManaStones: 1 },
  ],
  'best-kasaka': [
    { itemName: "Kasaka's Venom Gland", category: 'consumable', dropChancePct: 50, baseGold: 18, baseManaStones: 1, notes: 'Grants +15 HP or poison coating' },
    { itemName: "Kasaka's Venom Fang", category: 'weapon', dropChancePct: 22, baseGold: 35, baseManaStones: 2, minFloor: 2, notes: '2d6 Piercing + Bleed' },
  ],
  'best-steel-lycan': [
    { itemName: 'Steel-Fanged Pelt', category: 'armor', dropChancePct: 45, baseGold: 16, baseManaStones: 1, notes: '+1 AC Light Armor' },
    { itemName: 'Lycan Claw', category: 'material', dropChancePct: 65, baseGold: 20, baseManaStones: 1 },
  ],
  'best-white-eel': [
    { itemName: 'Shinsu Pearl', category: 'relic', dropChancePct: 35, baseGold: 24, baseManaStones: 2, notes: '+5 Max MP when held' },
    { itemName: 'Eel Scale', category: 'material', dropChancePct: 70, baseGold: 15, baseManaStones: 1 },
  ],
  'best-shinsu-bull': [
    { itemName: 'Shinsu-Infused Horn', category: 'weapon', dropChancePct: 30, baseGold: 38, baseManaStones: 2, minFloor: 2 },
    { itemName: 'Concentrated Shinsu Core', category: 'consumable', dropChancePct: 60, baseGold: 28, baseManaStones: 2, notes: 'Restores +15 MP' },
  ],
  'best-ice-bear': [
    { itemName: 'Frostbeast Fur Cloak', category: 'armor', dropChancePct: 32, baseGold: 32, baseManaStones: 2, minFloor: 2, notes: '+2 AC, Cold Resist' },
    { itemName: 'Glacial Essence', category: 'material', dropChancePct: 65, baseGold: 24, baseManaStones: 1 },
  ],
  'best-high-orc': [
    { itemName: 'High Orc Cleaver', category: 'weapon', dropChancePct: 35, baseGold: 42, baseManaStones: 2, minFloor: 2, notes: '2d8+2 Slashing' },
    { itemName: 'Red Gate War Talisman', category: 'relic', dropChancePct: 55, baseGold: 30, baseManaStones: 2 },
  ],
  'best-red-ant': [
    { itemName: 'Crimson Chitin Plate', category: 'armor', dropChancePct: 35, baseGold: 26, baseManaStones: 1, minFloor: 2, notes: '+1 AC, +1 DR' },
    { itemName: 'Jeju Mana Fragment', category: 'material', dropChancePct: 70, baseGold: 20, baseManaStones: 2 },
  ],
  'best-stone-statue': [
    { itemName: 'Cartenon Rune Tablet', category: 'relic', dropChancePct: 30, baseGold: 55, baseManaStones: 3, minFloor: 3 },
    { itemName: 'Monolith Core Stone', category: 'material', dropChancePct: 65, baseGold: 35, baseManaStones: 2 },
  ],
  'best-igris': [
    { itemName: "Blood-Red Commander's Helm", category: 'armor', dropChancePct: 45, baseGold: 90, baseManaStones: 4, minFloor: 3, notes: '+3 AC, +2 DR' },
    { itemName: 'Demon King Longsword', category: 'weapon', dropChancePct: 30, baseGold: 110, baseManaStones: 5, minFloor: 4, notes: '3d8+4 Slashing' },
  ],
  'best-beru': [
    { itemName: "Ant King's Crown", category: 'relic', dropChancePct: 45, baseGold: 130, baseManaStones: 6, minFloor: 4, notes: '+2 Initiative & Lifesteal' },
    { itemName: 'Monarch Essence Crystal', category: 'consumable', dropChancePct: 80, baseGold: 95, baseManaStones: 5, notes: 'Full HP/MP surge' },
  ],
  'best-dnd-goblin': [
    { itemName: 'Goblin Shortbow', category: 'weapon', dropChancePct: 40, baseGold: 10, baseManaStones: 0, notes: '1d6 Piercing (Range 4)' },
    { itemName: 'Tattered Coin Sack', category: 'material', dropChancePct: 75, baseGold: 16, baseManaStones: 0 },
  ],
  'best-kobold': [
    { itemName: 'Kobold Trap Kit', category: 'relic', dropChancePct: 45, baseGold: 12, baseManaStones: 0 },
    { itemName: 'Shiny Dragon Trinket', category: 'material', dropChancePct: 65, baseGold: 18, baseManaStones: 1 },
  ],
  'best-skeleton': [
    { itemName: 'Ancient Bone Shield', category: 'armor', dropChancePct: 40, baseGold: 22, baseManaStones: 1, notes: '+2 AC Off-Hand' },
    { itemName: 'Soul Dust', category: 'material', dropChancePct: 70, baseGold: 18, baseManaStones: 1 },
  ],
  'best-zombie': [
    { itemName: 'Minor Healing Potion', category: 'consumable', dropChancePct: 45, baseGold: 14, baseManaStones: 0, notes: 'Restores +12 HP' },
    { itemName: 'Gravekeeper Ring', category: 'relic', dropChancePct: 35, baseGold: 20, baseManaStones: 1 },
  ],
  'best-dire-wolf': [
    { itemName: 'Dire Wolf Mantle', category: 'armor', dropChancePct: 40, baseGold: 20, baseManaStones: 1, notes: '+1 AC Light Armor' },
    { itemName: 'Alpha Fang', category: 'material', dropChancePct: 65, baseGold: 18, baseManaStones: 1 },
  ],
  'best-orc-brute': [
    { itemName: 'Orcish Greataxe', category: 'weapon', dropChancePct: 40, baseGold: 26, baseManaStones: 1, notes: '1d12+2 Slashing' },
    { itemName: 'Raider Pouch', category: 'material', dropChancePct: 70, baseGold: 22, baseManaStones: 1 },
  ],
  'best-bugbear': [
    { itemName: 'Spiked Morningstar', category: 'weapon', dropChancePct: 38, baseGold: 28, baseManaStones: 1, notes: '2d6+2 Bludgeoning' },
    { itemName: 'Shadowstep Boots', category: 'armor', dropChancePct: 25, baseGold: 36, baseManaStones: 2, minFloor: 2 },
  ],
  'best-owlbear': [
    { itemName: 'Owlbear Feathered Hide', category: 'armor', dropChancePct: 40, baseGold: 36, baseManaStones: 2, minFloor: 2, notes: '+2 AC, +1 DR' },
    { itemName: 'Owlbear Beak Trophy', category: 'relic', dropChancePct: 65, baseGold: 32, baseManaStones: 1 },
  ],
  'best-lycan': [
    { itemName: 'Moon-Touched Fang', category: 'weapon', dropChancePct: 35, baseGold: 38, baseManaStones: 2, minFloor: 2, notes: '2d8+2 Slashing' },
    { itemName: 'Silvered Blood Vial', category: 'consumable', dropChancePct: 60, baseGold: 28, baseManaStones: 2 },
  ],
  'best-gelatinous-cube': [
    { itemName: 'Dissolved Adventurer Purse', category: 'relic', dropChancePct: 65, baseGold: 45, baseManaStones: 2 },
    { itemName: 'Acidic Slime Core', category: 'material', dropChancePct: 50, baseGold: 30, baseManaStones: 2 },
  ],
  'best-mimic': [
    { itemName: 'Bag of Holding Shard', category: 'relic', dropChancePct: 35, baseGold: 55, baseManaStones: 2, minFloor: 2 },
    { itemName: 'Mimic Treasure Cache', category: 'consumable', dropChancePct: 80, baseGold: 48, baseManaStones: 2 },
  ],
  'best-gargoyle': [
    { itemName: 'Stonewing Pauldrons', category: 'armor', dropChancePct: 35, baseGold: 34, baseManaStones: 2, minFloor: 2, notes: '+2 DR' },
    { itemName: 'Gargoyle Heartstone', category: 'material', dropChancePct: 65, baseGold: 28, baseManaStones: 1 },
  ],
  'best-minotaur': [
    { itemName: 'Labyrinth Greataxe', category: 'weapon', dropChancePct: 35, baseGold: 48, baseManaStones: 2, minFloor: 3, notes: '2d10+3 Slashing' },
    { itemName: 'Minotaur Nose-Ring of Might', category: 'relic', dropChancePct: 45, baseGold: 40, baseManaStones: 2 },
  ],
  'best-displacer': [
    { itemName: 'Cloak of Displacement', category: 'armor', dropChancePct: 28, baseGold: 55, baseManaStones: 3, minFloor: 3, notes: '+3 AC Light Armor' },
    { itemName: 'Feywild Tentacle Hide', category: 'material', dropChancePct: 65, baseGold: 36, baseManaStones: 2 },
  ],
  'best-mind-flayer': [
    { itemName: 'Psionic Mind Crystal', category: 'relic', dropChancePct: 40, baseGold: 62, baseManaStones: 4, minFloor: 3, notes: '+15 Max MP' },
    { itemName: 'Illithid Elder Elixir', category: 'consumable', dropChancePct: 65, baseGold: 45, baseManaStones: 3 },
  ],
  'best-golem': [
    { itemName: 'Obsidian Bastion Plate', category: 'armor', dropChancePct: 40, baseGold: 68, baseManaStones: 3, minFloor: 2, notes: '+3 AC, +3 DR' },
    { itemName: 'Guardian Mana Core', category: 'material', dropChancePct: 80, baseGold: 50, baseManaStones: 3 },
  ],
  'best-shadow': [
    { itemName: 'Shadow Monarch Greaves', category: 'armor', dropChancePct: 40, baseGold: 82, baseManaStones: 4, minFloor: 3, notes: '+2 Move, +2 AC' },
    { itemName: 'Abyssal Edge Blade', category: 'weapon', dropChancePct: 30, baseGold: 95, baseManaStones: 4, minFloor: 4, notes: '3d6+4 Dark' },
  ],
  'best-red-dragon': [
    { itemName: 'Flame Tongue Ember Blade', category: 'weapon', dropChancePct: 40, baseGold: 120, baseManaStones: 5, minFloor: 4, notes: '3d10+5 Fire' },
    { itemName: 'Red Dragon Scale Mail', category: 'armor', dropChancePct: 50, baseGold: 110, baseManaStones: 5, minFloor: 4, notes: '+4 AC, Fire Resist' },
  ],
  'best-wyrm': [
    { itemName: 'Crimson Wyrm Heart', category: 'relic', dropChancePct: 60, baseGold: 140, baseManaStones: 6, minFloor: 4 },
    { itemName: 'Dragonfang Tower Spear', category: 'weapon', dropChancePct: 35, baseGold: 150, baseManaStones: 6, minFloor: 5, notes: '4d8+5 Piercing' },
  ],
};

export const BLACKSMITH_CRAFTING_MATERIALS: BestiaryLootDrop[] = [
  { itemName: 'Tough Monster Leather', category: 'material', dropChancePct: 45, baseGold: 6, baseManaStones: 0, notes: 'Blacksmith material: Light/Medium armor & grips' },
  { itemName: 'Monster Bone', category: 'material', dropChancePct: 45, baseGold: 5, baseManaStones: 0, notes: 'Blacksmith material: Bone blades, bows & reinforcement' },
  { itemName: 'Tower Iron Ore', category: 'material', dropChancePct: 40, baseGold: 8, baseManaStones: 0, notes: 'Blacksmith material: Forging weapons & heavy plate' },
  { itemName: 'Beast Sinew', category: 'material', dropChancePct: 40, baseGold: 5, baseManaStones: 0, notes: 'Blacksmith material: Bowstrings & weapon bindings' },
  { itemName: 'Cracked Mana Crystal', category: 'material', dropChancePct: 35, baseGold: 10, baseManaStones: 1, notes: 'Blacksmith/Manhwa material: Magic-infused forging core' },
  { itemName: 'Chitin Carapace', category: 'material', dropChancePct: 35, baseGold: 9, baseManaStones: 0, notes: 'Blacksmith material: Light high-DR armor plating' },
  { itemName: 'Runic Mithril Scrap', category: 'material', dropChancePct: 35, baseGold: 22, baseManaStones: 1, minFloor: 3, notes: 'D&D/Manhwa material: Masterwork weapon & armor alloy' },
  { itemName: 'Abyssal Shadow Ash', category: 'material', dropChancePct: 38, baseGold: 18, baseManaStones: 1, minFloor: 3, notes: 'Blacksmith material: Dark-forged weapon tempering' },
  { itemName: 'Dragonbone Shard', category: 'material', dropChancePct: 35, baseGold: 32, baseManaStones: 2, minFloor: 4, notes: 'D&D/Manhwa material: Legendary dragonbone forging' },
];

export function getCommonCraftingDropsForMonster(entry: Partial<BestiaryEntry>): BestiaryLootDrop[] {
  const n = String(entry.name || '').toLowerCase();
  const isBoss = entry.category === 'Boss' || Number(entry.maxHp || 0) >= 90;

  if (/dragon|wyrm/.test(n)) {
    return [BLACKSMITH_CRAFTING_MATERIALS[8], BLACKSMITH_CRAFTING_MATERIALS[1], BLACKSMITH_CRAFTING_MATERIALS[4]];
  }
  if (/ant|bug|cube|ooze|eel|serpent|kasaka/.test(n)) {
    return [BLACKSMITH_CRAFTING_MATERIALS[5], BLACKSMITH_CRAFTING_MATERIALS[4]];
  }
  if (/skeleton|bone|zombie|undead|statue|golem|gargoyle/.test(n)) {
    return [BLACKSMITH_CRAFTING_MATERIALS[1], BLACKSMITH_CRAFTING_MATERIALS[2]];
  }
  if (/shadow|knight|igris|mind flayer|illithid/.test(n)) {
    return [BLACKSMITH_CRAFTING_MATERIALS[7], BLACKSMITH_CRAFTING_MATERIALS[6], BLACKSMITH_CRAFTING_MATERIALS[2]];
  }
  if (/wolf|lycan|bear|owlbear|displacer|bull|minotaur/.test(n)) {
    return [BLACKSMITH_CRAFTING_MATERIALS[0], BLACKSMITH_CRAFTING_MATERIALS[1], BLACKSMITH_CRAFTING_MATERIALS[3]];
  }
  if (isBoss) {
    return [BLACKSMITH_CRAFTING_MATERIALS[6], BLACKSMITH_CRAFTING_MATERIALS[4], BLACKSMITH_CRAFTING_MATERIALS[1]];
  }
  return [BLACKSMITH_CRAFTING_MATERIALS[0], BLACKSMITH_CRAFTING_MATERIALS[1], BLACKSMITH_CRAFTING_MATERIALS[2]];
}

export function getDefaultLootTableForMonster(entry: Partial<BestiaryEntry>): BestiaryLootDrop[] {
  const signature: BestiaryLootDrop[] =
    Array.isArray(entry.lootTable) && entry.lootTable.length > 0
      ? entry.lootTable
      : entry.id && ICONIC_LOOT_BY_ID[entry.id]
        ? ICONIC_LOOT_BY_ID[entry.id]
        : (() => {
            const cleanName = String(entry.name || 'Monster').trim();
            const isBoss = entry.category === 'Boss' || Number(entry.maxHp || 0) >= 90;
            return [
              {
                itemName: `${cleanName} Core`,
                category: 'material' as const,
                dropChancePct: isBoss ? 85 : 65,
                baseGold: isBoss ? 65 : 20,
                baseManaStones: isBoss ? 3 : 1,
              },
              {
                itemName: isBoss ? `${cleanName} Relic` : `${cleanName} Trophy`,
                category: (isBoss ? 'relic' : 'consumable') as BestiaryLootDrop['category'],
                dropChancePct: isBoss ? 45 : 30,
                baseGold: isBoss ? 90 : 28,
                baseManaStones: isBoss ? 4 : 1,
                minFloor: isBoss ? 3 : 1,
              },
            ];
          })();

  const seen = new Set(signature.map((d) => d.itemName.toLowerCase()));
  const crafting = getCommonCraftingDropsForMonster(entry).filter((d) => !seen.has(d.itemName.toLowerCase()));
  return [...signature, ...crafting];
}

export function scaleMonsterSkillForFloor(
  skill: Partial<MonsterSkill> & { name: string },
  floor: number,
): MonsterSkill & { unlocked: boolean; attackFormula: string } {
  const f = Math.max(1, Math.trunc(Number(floor) || 1));
  const climbed = f - 1;
  const minFloor = Math.max(1, Math.trunc(Number(skill.minFloor || 1)));
  const baseUses = Math.max(1, Math.trunc(Number(skill.baseUsesPerCombat || skill.maxUsesPerCombat || 1)));
  // Limited uses per combat scale with floor level (+1 use every 2 floors climbed)
  const maxUses = baseUses + Math.floor(climbed / 2);
  const baseAtkBonus = Math.trunc(Number(skill.attackBonus ?? 6)) + Math.floor(climbed * BALANCE.monster.attackBonusPerFloor);
  const baseDmg = String(skill.damageFormula || '2d6+3').trim();
  const scaledDmg = scaleDiceFormula(baseDmg, Math.floor(climbed * BALANCE.monster.damageBonusPerFloor * 1.3));
  const atkSign = baseAtkBonus >= 0 ? `+${baseAtkBonus}` : `${baseAtkBonus}`;

  return {
    id: skill.id || `msk-${skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: skill.name,
    damageFormula: scaledDmg,
    attackBonus: baseAtkBonus,
    baseUsesPerCombat: baseUses,
    maxUsesPerCombat: maxUses,
    usesRemaining: skill.usesRemaining !== undefined ? Math.min(maxUses, Math.max(0, Number(skill.usesRemaining))) : maxUses,
    minFloor,
    description: skill.description || `Deals ${scaledDmg} damage (Limited to ${maxUses} use${maxUses === 1 ? '' : 's'}/combat on ${f}F).`,
    ...(skill.attackArea ? { attackArea: skill.attackArea } : {}),
    ...(skill.attackAreaModifier !== undefined && skill.attackAreaModifier !== 0
      ? { attackAreaModifier: clampAttackAreaModifier(skill.attackAreaModifier) }
      : {}),
    ...(skill.healFormula ? { healFormula: skill.healFormula } : {}),
    ...(skill.effectSpec
      ? {
          effectSpec: {
            ...skill.effectSpec,
            potency:
              skill.effectSpec.kind === 'stun'
                ? 1
                : Math.max(1, Number(skill.effectSpec.potency || 1) + Math.floor(climbed / 3)),
          },
        }
      : {}),
    unlocked: f >= minFloor,
    attackFormula: `1d20${atkSign}`,
  };
}

export const UNIT_EFFECT_KINDS: UnitEffectKind[] = [
  'shield',
  'empower',
  'haste',
  'regen',
  'burn',
  'poison',
  'armor_break',
  'weaken',
  'slow',
  'stun',
];

export const UNIT_EFFECT_META: Record<
  UnitEffectKind,
  {
    label: string;
    category: 'buff' | 'debuff';
    defaultPotency: number;
    defaultDuration: number;
    defaultTarget: 'enemy' | 'self';
  }
> = {
  shield: { label: 'Shield (+AC/DR)', category: 'buff', defaultPotency: 2, defaultDuration: 2, defaultTarget: 'self' },
  empower: { label: 'Empower (+Hit/Dmg)', category: 'buff', defaultPotency: 3, defaultDuration: 2, defaultTarget: 'self' },
  haste: { label: 'Haste (+Speed)', category: 'buff', defaultPotency: 2, defaultDuration: 2, defaultTarget: 'self' },
  regen: { label: 'Regen (+HP/Turn)', category: 'buff', defaultPotency: 5, defaultDuration: 3, defaultTarget: 'self' },
  burn: { label: 'Burn (Fire DoT)', category: 'debuff', defaultPotency: 4, defaultDuration: 3, defaultTarget: 'enemy' },
  poison: { label: 'Poison (Venom DoT)', category: 'debuff', defaultPotency: 4, defaultDuration: 3, defaultTarget: 'enemy' },
  armor_break: { label: 'Armor Break (-AC/DR)', category: 'debuff', defaultPotency: 2, defaultDuration: 2, defaultTarget: 'enemy' },
  weaken: { label: 'Weaken (-Hit/Dmg)', category: 'debuff', defaultPotency: 2, defaultDuration: 2, defaultTarget: 'enemy' },
  slow: { label: 'Slow (-Speed)', category: 'debuff', defaultPotency: 2, defaultDuration: 2, defaultTarget: 'enemy' },
  stun: { label: 'Stun (Skip Turn)', category: 'debuff', defaultPotency: 1, defaultDuration: 1, defaultTarget: 'enemy' },
};

export function computeActiveEffectModifiers(effects?: ActiveUnitEffect[]): {
  acDelta: number;
  drDelta: number;
  hitDelta: number;
  dmgDelta: number;
  speedDelta: number;
  regenPerTurn: number;
  dotPerTurn: number;
  stunned: boolean;
} {
  let acDelta = 0;
  let drDelta = 0;
  let hitDelta = 0;
  let dmgDelta = 0;
  let speedDelta = 0;
  let regenPerTurn = 0;
  let dotPerTurn = 0;
  let stunned = false;
  for (const eff of effects || []) {
    const pot = Math.max(0, Number(eff.potency || 0));
    if (eff.kind === 'shield') {
      acDelta += pot;
      drDelta += Math.max(1, Math.floor(pot / 2));
    } else if (eff.kind === 'empower') {
      hitDelta += Math.max(1, Math.ceil(pot / 2));
      dmgDelta += pot;
    } else if (eff.kind === 'haste') {
      speedDelta += pot;
    } else if (eff.kind === 'regen') {
      regenPerTurn += pot;
    } else if (eff.kind === 'burn' || eff.kind === 'poison') {
      dotPerTurn += pot;
    } else if (eff.kind === 'armor_break') {
      acDelta -= pot;
      drDelta -= Math.max(1, Math.floor(pot / 2));
    } else if (eff.kind === 'weaken') {
      hitDelta -= Math.max(1, Math.ceil(pot / 2));
      dmgDelta -= pot;
    } else if (eff.kind === 'slow') {
      speedDelta -= pot;
    } else if (eff.kind === 'stun') {
      stunned = true;
    }
  }
  return { acDelta, drDelta, hitDelta, dmgDelta, speedDelta, regenPerTurn, dotPerTurn, stunned };
}

export function formatUnitEffectSpec(spec?: UnitEffectSpec | null): string {
  if (!spec) return '';
  const meta = UNIT_EFFECT_META[spec.kind];
  if (!meta) return '';
  const potStr = spec.kind === 'stun' ? '' : ` ${spec.potency}`;
  return `${meta.label}${potStr} (${spec.duration}t)`;
}

export function formatActiveUnitEffect(eff: ActiveUnitEffect): string {
  const meta = UNIT_EFFECT_META[eff.kind];
  const base = meta ? meta.label.split(' (')[0] : eff.name;
  const pot = eff.kind === 'stun' ? '' : ` ${eff.potency}`;
  return `${base}${pot} (${eff.turnsRemaining}t)`;
}

export const MONSTER_ATTACK_AREAS: MonsterAttackArea[] = [
  'single',
  'around_1',
  'line_3',
  'cleave_3',
  'cone_3',
  'around_2',
  'ranged_aoe',
];

export const PLAYER_ATTACK_AREAS: AttackArea[] = [
  'single',
  'around_1',
  'line_3',
  'cleave_3',
  'cone_3',
  'around_2',
  'ranged_aoe',
];

export function clampAttackAreaModifier(mod?: unknown): number {
  const n = Math.trunc(Number(mod ?? 0));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-2, Math.min(4, n));
}

export function formatMonsterAttackArea(area?: AttackArea, modifier = 0): string {
  const mod = clampAttackAreaModifier(modifier);
  let base: string;
  switch (area) {
    case 'single':
      base = 'Single Target';
      break;
    case 'line_3':
      base = '3 Spaces Ahead (Line AoE)';
      break;
    case 'cleave_3':
      base = '3-Space Front Cleave (AoE)';
      break;
    case 'cone_3':
      base = '3-Space Breath Cone (AoE)';
      break;
    case 'around_2':
      base = '2 Spaces Around (Shockwave AoE)';
      break;
    case 'ranged_aoe':
      base = 'Ranged Burst (3×3 Impact AoE)';
      break;
    case 'around_1':
    default:
      base = '1 Space Around (Adjacent)';
      break;
  }
  return mod !== 0 ? `${base} (${mod > 0 ? `+${mod}` : mod} Sp)` : base;
}

export const formatAttackArea = formatMonsterAttackArea;

export function inferDefaultAttackAreaForMonster(entry: {
  id?: string;
  name?: string;
  category?: string;
  maxHp?: number | null;
  rangeSpaces?: number;
  attackArea?: MonsterAttackArea;
}): MonsterAttackArea {
  if (entry.attackArea && MONSTER_ATTACK_AREAS.includes(entry.attackArea)) {
    return entry.attackArea;
  }
  const n = String(entry.name || '').toLowerCase();
  const hp = Number(entry.maxHp || 30);
  const range = Number(entry.rangeSpaces || 1);
  const isBoss = entry.category === 'Boss' || hp >= 90;

  if (/dragon|wyrm/.test(n)) return 'cone_3';
  if (/mind flayer|scout|trapper|archer/.test(n) || range >= 4) return 'ranged_aoe';
  if (/igris|beru|shadow knight|commander/.test(n)) return 'line_3';
  if (/golem|statue|sentinel|cube|bear|owlbear/.test(n)) {
    return hp >= 65 ? 'around_2' : 'cleave_3';
  }
  if (/bull|minotaur|kasaka|eel|serpent|displacer/.test(n)) return 'line_3';
  if (/high orc|orc brute|bugbear/.test(n)) return 'cleave_3';
  if (isBoss) return 'line_3';
  if (hp >= 50) return 'line_3';
  return 'around_1';
}

export function computeMonsterAttackCells(params: {
  monsterX: number;
  monsterY: number;
  targetX?: number | null;
  targetY?: number | null;
  attackArea?: AttackArea;
  areaModifier?: number;
  rangeSpaces?: number;
  cols: number;
  rows: number;
  isSkill?: boolean;
}): {
  allReachableCells: Array<{ x: number; y: number }>;
  affectedCells: Array<{ x: number; y: number }>;
} {
  const {
    monsterX,
    monsterY,
    targetX = null,
    targetY = null,
    attackArea = 'around_1',
    areaModifier = 0,
    rangeSpaces = 1,
    cols,
    rows,
    isSkill = false,
  } = params;

  const mod = clampAttackAreaModifier(areaModifier);
  const inBounds = (x: number, y: number) => x >= 0 && x < cols && y >= 0 && y < rows && !(x === monsterX && y === monsterY);
  const addUnique = (list: Array<{ x: number; y: number }>, seen: Set<string>, x: number, y: number) => {
    if (!inBounds(x, y)) return;
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ x, y });
  };

  // Determine facing unit vector (fx, fy) toward target (defaults to +Y South toward players if no target)
  let fx = 0;
  let fy = 1;
  if (targetX !== null && targetY !== null && !(targetX === monsterX && targetY === monsterY)) {
    const dx = targetX - monsterX;
    const dy = targetY - monsterY;
    if (Math.abs(dx) > Math.abs(dy)) {
      fx = dx > 0 ? 1 : -1;
      fy = 0;
    } else {
      fx = 0;
      fy = dy > 0 ? 1 : -1;
    }
  }
  // Perpendicular vector
  const px = -fy;
  const py = fx;

  const effectiveArea: AttackArea = isSkill && attackArea === 'around_1' ? 'line_3' : attackArea;
  const allList: Array<{ x: number; y: number }> = [];
  const allSeen = new Set<string>();
  const affList: Array<{ x: number; y: number }> = [];
  const affSeen = new Set<string>();

  if (effectiveArea === 'single') {
    const maxR = Math.max(1, Number(rangeSpaces || 1));
    for (let dy = -maxR; dy <= maxR; dy++) {
      for (let dx = -maxR; dx <= maxR; dx++) {
        if (dx === 0 && dy === 0) continue;
        addUnique(allList, allSeen, monsterX + dx, monsterY + dy);
      }
    }
    if (targetX !== null && targetY !== null) {
      const splashRad = Math.max(0, mod);
      for (let dy = -splashRad; dy <= splashRad; dy++) {
        for (let dx = -splashRad; dx <= splashRad; dx++) {
          addUnique(affList, affSeen, targetX + dx, targetY + dy);
        }
      }
    }
  } else if (effectiveArea === 'around_1') {
    const rad = Math.max(1, 1 + mod);
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx === 0 && dy === 0) continue;
        addUnique(allList, allSeen, monsterX + dx, monsterY + dy);
        addUnique(affList, affSeen, monsterX + dx, monsterY + dy);
      }
    }
  } else if (effectiveArea === 'around_2') {
    const rad = Math.max(1, (isSkill ? 3 : 2) + mod);
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx === 0 && dy === 0) continue;
        addUnique(allList, allSeen, monsterX + dx, monsterY + dy);
        addUnique(affList, affSeen, monsterX + dx, monsterY + dy);
      }
    }
  } else if (effectiveArea === 'line_3') {
    const len = Math.max(1, (isSkill ? 4 : 3) + mod);
    const dirs = [
      { vx: 0, vy: 1 },
      { vx: 0, vy: -1 },
      { vx: 1, vy: 0 },
      { vx: -1, vy: 0 },
    ];
    for (const d of dirs) {
      for (let step = 1; step <= len; step++) {
        addUnique(allList, allSeen, monsterX + d.vx * step, monsterY + d.vy * step);
      }
    }
    for (let step = 1; step <= len; step++) {
      addUnique(affList, affSeen, monsterX + fx * step, monsterY + fy * step);
    }
  } else if (effectiveArea === 'cleave_3') {
    const depth = Math.max(1, (isSkill ? 2 : 1) + mod);
    const halfW = 1 + Math.max(0, Math.floor(mod / 2));
    const dirs = [
      { vx: 0, vy: 1, wx: 1, wy: 0 },
      { vx: 0, vy: -1, wx: 1, wy: 0 },
      { vx: 1, vy: 0, wx: 0, wy: 1 },
      { vx: -1, vy: 0, wx: 0, wy: 1 },
    ];
    for (const d of dirs) {
      for (let step = 1; step <= depth; step++) {
        for (let side = -halfW; side <= halfW; side++) {
          addUnique(allList, allSeen, monsterX + d.vx * step + d.wx * side, monsterY + d.vy * step + d.wy * side);
        }
      }
    }
    for (let step = 1; step <= depth; step++) {
      for (let side = -halfW; side <= halfW; side++) {
        addUnique(affList, affSeen, monsterX + fx * step + px * side, monsterY + fy * step + py * side);
      }
    }
  } else if (effectiveArea === 'cone_3') {
    const len = Math.max(1, (isSkill ? 4 : 3) + mod);
    const dirs = [
      { vx: 0, vy: 1, wx: 1, wy: 0 },
      { vx: 0, vy: -1, wx: 1, wy: 0 },
      { vx: 1, vy: 0, wx: 0, wy: 1 },
      { vx: -1, vy: 0, wx: 0, wy: 1 },
    ];
    for (const d of dirs) {
      for (let step = 1; step <= len; step++) {
        const halfWidth = Math.min(3, step - 1);
        for (let side = -halfWidth; side <= halfWidth; side++) {
          addUnique(allList, allSeen, monsterX + d.vx * step + d.wx * side, monsterY + d.vy * step + d.wy * side);
        }
      }
    }
    for (let step = 1; step <= len; step++) {
      const halfWidth = Math.min(3, step - 1);
      for (let side = -halfWidth; side <= halfWidth; side++) {
        addUnique(affList, affSeen, monsterX + fx * step + px * side, monsterY + fy * step + py * side);
      }
    }
  } else if (effectiveArea === 'ranged_aoe') {
    const maxR = Math.max(2, Number(rangeSpaces || 4) + (isSkill ? 1 : 0) + Math.max(0, mod));
    const impactRad = Math.max(0, 1 + Math.floor(mod / 2));
    for (let dy = -maxR; dy <= maxR; dy++) {
      for (let dx = -maxR; dx <= maxR; dx++) {
        if (dx === 0 && dy === 0) continue;
        addUnique(allList, allSeen, monsterX + dx, monsterY + dy);
      }
    }
    const cx = targetX !== null ? targetX : monsterX + fx * Math.min(3, maxR);
    const cy = targetY !== null ? targetY : monsterY + fy * Math.min(3, maxR);
    for (let dy = -impactRad; dy <= impactRad; dy++) {
      for (let dx = -impactRad; dx <= impactRad; dx++) {
        addUnique(affList, affSeen, cx + dx, cy + dy);
      }
    }
  }

  return {
    allReachableCells: allList,
    affectedCells: affList,
  };
}

export const computeAttackAreaCells = computeMonsterAttackCells;

export function getDefaultSkillsForMonster(entry: Partial<BestiaryEntry>): MonsterSkill[] {
  if (Array.isArray(entry.skills) && entry.skills.length > 0) {
    return entry.skills.map((s, idx) => ({
      id: s.id || `msk-${idx}`,
      name: s.name,
      damageFormula: s.damageFormula || '2d6+3',
      attackBonus: Number(s.attackBonus ?? 6),
      baseUsesPerCombat: Math.max(1, Number(s.baseUsesPerCombat || s.maxUsesPerCombat || 1)),
      maxUsesPerCombat: Math.max(1, Number(s.maxUsesPerCombat || s.baseUsesPerCombat || 1)),
      usesRemaining: Math.max(0, Number(s.usesRemaining ?? s.maxUsesPerCombat ?? s.baseUsesPerCombat ?? 1)),
      minFloor: Math.max(1, Number(s.minFloor || 1)),
      description: s.description || '',
      ...(s.healFormula ? { healFormula: s.healFormula } : {}),
      ...(s.effectSpec ? { effectSpec: s.effectSpec } : {}),
      ...(s.attackArea ? { attackArea: s.attackArea } : {}),
      ...(s.attackAreaModifier !== undefined ? { attackAreaModifier: s.attackAreaModifier } : {}),
    }));
  }

  const n = String(entry.name || 'Monster').toLowerCase();
  const isBoss = entry.category === 'Boss' || Number(entry.maxHp || 0) >= 90;

  if (/dragon|wyrm/.test(n)) {
    return [
      {
        id: 'msk-dragon-breath',
        name: 'Cataclysmic Dragon Breath',
        damageFormula: '3d8+5',
        attackBonus: 8,
        baseUsesPerCombat: 1,
        maxUsesPerCombat: 1,
        usesRemaining: 1,
        minFloor: 1,
        description: 'Unleashes a torrent of searing dragonfire across the arena (inflicts Burn).',
        effectSpec: { kind: 'burn', potency: 5, duration: 3, target: 'enemy' },
      },
      {
        id: 'msk-wing-tempest',
        name: 'Sovereign Wing Tempest',
        damageFormula: '2d10+4',
        attackBonus: 7,
        baseUsesPerCombat: 2,
        maxUsesPerCombat: 2,
        usesRemaining: 2,
        minFloor: 2,
        description: 'Crushing shockwave that batters climbers back and empowers the dragon.',
        effectSpec: { kind: 'empower', potency: 3, duration: 2, target: 'self' },
      },
    ];
  }
  if (/kasaka|serpent|eel/.test(n)) {
    return [
      {
        id: 'msk-venom-fang',
        name: 'Paralyzing Venom Strike',
        damageFormula: '2d6+3',
        attackBonus: 6,
        baseUsesPerCombat: 2,
        maxUsesPerCombat: 2,
        usesRemaining: 2,
        minFloor: 1,
        description: 'Injects corrosive Tower venom (inflicts Poison DoT).',
        effectSpec: { kind: 'poison', potency: 4, duration: 3, target: 'enemy' },
      },
      {
        id: 'msk-coil-crush',
        name: 'Abyssal Coil Crush',
        damageFormula: '2d8+4',
        attackBonus: 7,
        baseUsesPerCombat: 1,
        maxUsesPerCombat: 1,
        usesRemaining: 1,
        minFloor: 2,
        description: 'Constricts the target with bone-shattering Shinsu pressure (Slows target).',
        effectSpec: { kind: 'slow', potency: 2, duration: 2, target: 'enemy' },
      },
    ];
  }
  if (/igris|knight|shadow/.test(n)) {
    return [
      {
        id: 'msk-crimson-cleave',
        name: "Commander's Execution Cleave",
        damageFormula: '2d10+4',
        attackBonus: 7,
        baseUsesPerCombat: 2,
        maxUsesPerCombat: 2,
        usesRemaining: 2,
        minFloor: 1,
        description: 'A blindingly fast overhead greatsword slash (inflicts Armor Break).',
        effectSpec: { kind: 'armor_break', potency: 2, duration: 2, target: 'enemy' },
      },
      {
        id: 'msk-monarch-dominion',
        name: 'Telekinetic Blade Storm',
        damageFormula: '3d8+5',
        attackBonus: 8,
        baseUsesPerCombat: 1,
        maxUsesPerCombat: 1,
        usesRemaining: 1,
        minFloor: 3,
        description: 'Calls floating shadow blades while empowering the knight.',
        effectSpec: { kind: 'empower', potency: 3, duration: 2, target: 'self' },
      },
    ];
  }
  if (/beru|ant/.test(n)) {
    return [
      {
        id: 'msk-predator-shriek',
        name: "Apex Predator's Shriek",
        damageFormula: '2d8+4',
        attackBonus: 7,
        baseUsesPerCombat: 2,
        maxUsesPerCombat: 2,
        usesRemaining: 2,
        minFloor: 1,
        description: 'Paralyzing royal screech that Stuns the target.',
        effectSpec: { kind: 'stun', potency: 1, duration: 1, target: 'enemy' },
      },
      {
        id: 'msk-gluttony-rush',
        name: 'Gluttonous Acid Barrage',
        damageFormula: '3d8+5',
        attackBonus: 8,
        baseUsesPerCombat: 1,
        maxUsesPerCombat: 1,
        usesRemaining: 1,
        minFloor: 3,
        description: 'Corrosive acid volley that melts armor (inflicts Poison).',
        effectSpec: { kind: 'poison', potency: 5, duration: 3, target: 'enemy' },
      },
    ];
  }
  if (/ice|frost/.test(n)) {
    return [
      {
        id: 'msk-glacial-roar',
        name: 'Glacial Frostbite Roar',
        damageFormula: '2d6+3',
        attackBonus: 6,
        baseUsesPerCombat: 2,
        maxUsesPerCombat: 2,
        usesRemaining: 2,
        minFloor: 1,
        description: 'Freezing gale that Slows climbers.',
        effectSpec: { kind: 'slow', potency: 2, duration: 2, target: 'enemy' },
      },
      {
        id: 'msk-ice-carapace',
        name: 'Permafrost Carapace',
        damageFormula: '2d8+3',
        attackBonus: 6,
        baseUsesPerCombat: 1,
        maxUsesPerCombat: 1,
        usesRemaining: 1,
        minFloor: 2,
        description: 'Hardens frost armor (+AC/DR Shield).',
        effectSpec: { kind: 'shield', potency: 2, duration: 2, target: 'self' },
      },
    ];
  }
  if (/goblin|orc|bugbear|kobold|minotaur/.test(n)) {
    return [
      {
        id: 'msk-frenzied-cleave',
        name: 'Frenzied War Cleave',
        damageFormula: '2d6+2',
        attackBonus: 5,
        baseUsesPerCombat: 2,
        maxUsesPerCombat: 2,
        usesRemaining: 2,
        minFloor: 1,
        description: 'Reckless heavy swing that cracks guard (Armor Break).',
        effectSpec: { kind: 'armor_break', potency: 2, duration: 2, target: 'enemy' },
      },
      {
        id: 'msk-bloodlust-charge',
        name: 'Bloodlust Ambush Rush',
        damageFormula: '2d8+3',
        attackBonus: 6,
        baseUsesPerCombat: 1,
        maxUsesPerCombat: 1,
        usesRemaining: 1,
        minFloor: 2,
        description: 'Brutal strike that Weakens the target.',
        effectSpec: { kind: 'weaken', potency: 2, duration: 2, target: 'enemy' },
      },
    ];
  }

  return [
    {
      id: 'msk-feral-burst',
      name: isBoss ? 'Sovereign Calamity Strike' : 'Shinsu Overdrive Strike',
      damageFormula: isBoss ? '3d8+4' : '2d6+3',
      attackBonus: isBoss ? 7 : 5,
      baseUsesPerCombat: isBoss ? 2 : 1,
      maxUsesPerCombat: isBoss ? 2 : 1,
      usesRemaining: isBoss ? 2 : 1,
      minFloor: 1,
      description: 'Concentrates ambient floor mana into a signature technique.',
      ...(isBoss ? { healFormula: '2d6+4', effectSpec: { kind: 'empower', potency: 3, duration: 2, target: 'self' } } : { effectSpec: { kind: 'weaken', potency: 2, duration: 2, target: 'enemy' } }),
    },
    {
      id: 'msk-abyssal-roar',
      name: isBoss ? 'Cataclysmic Floor Judgment' : 'Apex Predator Rampage',
      damageFormula: isBoss ? '3d10+5' : '2d8+4',
      attackBonus: isBoss ? 8 : 6,
      baseUsesPerCombat: 1,
      maxUsesPerCombat: 1,
      usesRemaining: 1,
      minFloor: 2,
      description: 'Unlocks on deeper floors; unleashes full destructive power.',
      effectSpec: { kind: 'armor_break', potency: 2, duration: 2, target: 'enemy' },
    },
  ];
}

export function scaleTreasureForFloor(
  t: TreasureEntry,
  floor: number,
): TreasureEntry & { tier: ChestTier; scaledGold: number; scaledManaStones: number } {
  const f = Math.max(1, Math.trunc(Number(floor) || t.floorLevel || 1));
  const baseFloor = Math.max(1, Number(t.floorLevel || 1));
  const delta = f - baseFloor;
  const step = Math.floor(delta / 2);
  return {
    ...t,
    tier: inferItemTier(t),
    floorLevel: f,
    attackBonus: t.attackBonus > 0 ? Math.max(1, t.attackBonus + Math.floor(delta / 2)) : 0,
    acBonus: t.acBonus > 0 ? Math.max(1, t.acBonus + Math.floor(delta / 3)) : 0,
    drBonus: t.drBonus > 0 ? Math.max(1, t.drBonus + Math.floor(delta / 4)) : 0,
    damageDice: t.damageDice && delta !== 0 ? scaleDiceFormula(t.damageDice, step) : t.damageDice,
    scaledGold: Math.max(0, Math.round(Number(t.baseGold || 0) * Math.max(0.5, 1 + delta * 0.35))),
    scaledManaStones: Math.max(0, Number(t.baseManaStones || 0) + Math.max(0, Math.floor(delta / 2))),
  };
}

export const CHEST_TIERS: ChestTier[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];

export const CHEST_TIER_LOOT_TABLES: Record<
  ChestTier,
  { minItems: number; maxItems: number; baseGold: number; baseManaStones: number; pool: BestiaryLootDrop[] }
> = {
  Common: {
    minItems: 1,
    maxItems: 2,
    baseGold: 25,
    baseManaStones: 0,
    pool: [
      { itemName: 'Minor Healing Potion', category: 'consumable', dropChancePct: 100, baseGold: 10, baseManaStones: 0, notes: 'Restores +12 HP' },
      { itemName: 'Tough Monster Leather', category: 'material', dropChancePct: 100, baseGold: 8, baseManaStones: 0, notes: 'Blacksmith crafting material' },
      { itemName: 'Monster Bone', category: 'material', dropChancePct: 100, baseGold: 6, baseManaStones: 0, notes: 'Blacksmith crafting material' },
      { itemName: 'Tower Iron Ore', category: 'material', dropChancePct: 100, baseGold: 10, baseManaStones: 0, notes: 'Blacksmith crafting material' },
      { itemName: 'Goblin Rusty Dagger', category: 'weapon', dropChancePct: 100, baseGold: 15, baseManaStones: 0, notes: '1d6+1 Piercing' },
    ],
  },
  Uncommon: {
    minItems: 1,
    maxItems: 2,
    baseGold: 55,
    baseManaStones: 1,
    pool: [
      { itemName: 'Greater Healing Potion', category: 'consumable', dropChancePct: 100, baseGold: 20, baseManaStones: 0, notes: 'Restores +24 HP' },
      { itemName: 'Cracked Mana Crystal', category: 'material', dropChancePct: 100, baseGold: 18, baseManaStones: 1, notes: 'Blacksmith/Manhwa forging core' },
      { itemName: 'Ring of Protection', category: 'relic', dropChancePct: 100, baseGold: 35, baseManaStones: 1, notes: '+1 AC, +1 DR' },
      { itemName: 'Cloak of Elvenkind', category: 'armor', dropChancePct: 100, baseGold: 40, baseManaStones: 1, notes: '+2 AC Light Armor' },
      { itemName: 'Skill Book: Shadow Step', category: 'consumable', dropChancePct: 100, baseGold: 30, baseManaStones: 1, notes: 'Teaches Shadow Step' },
    ],
  },
  Rare: {
    minItems: 2,
    maxItems: 2,
    baseGold: 110,
    baseManaStones: 2,
    pool: [
      { itemName: "Kasaka's Venom Fang", category: 'weapon', dropChancePct: 100, baseGold: 45, baseManaStones: 1, notes: '1d8+2 Piercing + Bleed' },
      { itemName: 'Green April (Ignition Hook)', category: 'weapon', dropChancePct: 100, baseGold: 60, baseManaStones: 2, notes: '2d8+2 Whip-Hook' },
      { itemName: 'Mithral Sentinel Shield', category: 'armor', dropChancePct: 100, baseGold: 55, baseManaStones: 1, notes: '+2 AC, +2 DR Off-Hand' },
      { itemName: 'Skill Book: Action Surge', category: 'consumable', dropChancePct: 100, baseGold: 50, baseManaStones: 1, notes: 'Teaches Fighter Action Surge' },
      { itemName: 'Runic Mithril Scrap', category: 'material', dropChancePct: 100, baseGold: 35, baseManaStones: 1, notes: 'Masterwork forging alloy' },
    ],
  },
  Epic: {
    minItems: 2,
    maxItems: 3,
    baseGold: 190,
    baseManaStones: 4,
    pool: [
      { itemName: 'Knight Killer Dagger', category: 'weapon', dropChancePct: 100, baseGold: 75, baseManaStones: 2, notes: '2d8+4 Armor-Piercing' },
      { itemName: 'Sunfire Longsword', category: 'weapon', dropChancePct: 100, baseGold: 80, baseManaStones: 2, notes: '2d8+3 Radiant' },
      { itemName: 'High Orc Warplate', category: 'armor', dropChancePct: 100, baseGold: 70, baseManaStones: 2, notes: '+3 AC, +2 DR Heavy Plate' },
      { itemName: 'Skill Book: Shinsu Black-Hole Sphere', category: 'consumable', dropChancePct: 100, baseGold: 90, baseManaStones: 2, notes: 'Irregular Shinsu burst' },
      { itemName: 'Abyssal Shadow Ash', category: 'material', dropChancePct: 100, baseGold: 45, baseManaStones: 1, notes: 'Dark-forged tempering material' },
    ],
  },
  Legendary: {
    minItems: 2,
    maxItems: 3,
    baseGold: 320,
    baseManaStones: 6,
    pool: [
      { itemName: "Demon King's Daggers", category: 'weapon', dropChancePct: 100, baseGold: 120, baseManaStones: 3, notes: '3d8+5 Lightning Dual Blades' },
      { itemName: 'Staff of the Archmage', category: 'weapon', dropChancePct: 100, baseGold: 115, baseManaStones: 3, notes: '3d6+4 Arcane Focus' },
      { itemName: 'Black March (13-Month Needle)', category: 'weapon', dropChancePct: 100, baseGold: 110, baseManaStones: 3, notes: 'Tower of God Ignition Needle' },
      { itemName: 'Dragonbone Shard', category: 'material', dropChancePct: 100, baseGold: 80, baseManaStones: 2, notes: 'Legendary dragonbone forging' },
      { itemName: 'Monarch Essence Crystal', category: 'consumable', dropChancePct: 100, baseGold: 95, baseManaStones: 2, notes: 'Full HP/MP surge' },
    ],
  },
  Mythic: {
    minItems: 3,
    maxItems: 3,
    baseGold: 550,
    baseManaStones: 10,
    pool: [
      { itemName: "Kamish's Wrath", category: 'weapon', dropChancePct: 100, baseGold: 220, baseManaStones: 5, notes: '4d10+6 Dragon-Fang Twin Daggers' },
      { itemName: 'Vorpal Tower Greatsword', category: 'weapon', dropChancePct: 100, baseGold: 200, baseManaStones: 4, notes: '4d8+6 Decapitating Blade' },
      { itemName: 'Armor of the First Climber', category: 'armor', dropChancePct: 100, baseGold: 190, baseManaStones: 4, notes: '+5 AC, +4 DR Mythic Plate' },
      { itemName: "Skill Book: Monarch's Domain", category: 'consumable', dropChancePct: 100, baseGold: 180, baseManaStones: 4, notes: 'Awakens Sovereign Aura' },
      { itemName: 'Dragonbone Shard', category: 'material', dropChancePct: 100, baseGold: 120, baseManaStones: 3, notes: 'Legendary dragonbone forging' },
    ],
  },
};

export function rollChestLoot(
  tier: ChestTier = 'Common',
  floor = 1,
  rand01: () => number = Math.random,
  customCatalog?: Partial<Record<ChestTier, ChestTierConfig>> | null,
): { gold: number; manaStones: number; items: BestiaryLootDrop[] } {
  const cfg = customCatalog?.[tier] || CHEST_TIER_LOOT_TABLES[tier] || CHEST_TIER_LOOT_TABLES.Common;
  const f = Math.max(1, Math.trunc(Number(floor) || 1));
  const scale = 1 + (f - 1) * 0.3;
  const count = cfg.minItems + Math.floor(rand01() * (cfg.maxItems - cfg.minItems + 1));
  const poolCopy = [...(cfg.pool || [])];
  const items: BestiaryLootDrop[] = [];
  for (let i = 0; i < count && poolCopy.length > 0; i++) {
    const idx = Math.floor(rand01() * poolCopy.length);
    const picked = poolCopy.splice(idx, 1)[0];
    items.push({ ...picked, tier: picked.tier || tier });
  }
  return {
    gold: Math.round(cfg.baseGold * scale),
    manaStones: cfg.baseManaStones + Math.floor((f - 1) / 3),
    items,
  };
}

export function getChestDefaultsForFloor(
  tier: ChestTier = 'Common',
  floor = 1,
  customCatalog?: Partial<Record<ChestTier, ChestTierConfig>> | null,
): { name: string; gold: number; manaStones: number } {
  const cfg = customCatalog?.[tier] || CHEST_TIER_LOOT_TABLES[tier] || CHEST_TIER_LOOT_TABLES.Common;
  const f = Math.max(1, Math.trunc(Number(floor) || 1));
  const scale = 1 + (f - 1) * 0.3;
  return {
    name: `${tier} Chest`,
    gold: Math.round(cfg.baseGold * scale),
    manaStones: cfg.baseManaStones + Math.floor((f - 1) / 3),
  };
}

export function buildChestLootPreview(
  chest: Partial<MapChest> & { id: string; name: string },
  floor = 1,
  openerChar?: Partial<Character> | null,
  openerLabel = 'DM',
  customCatalog?: Partial<Record<ChestTier, ChestTierConfig>> | null,
): ChestLootSummary {
  const chestTier = (chest.tier && CHEST_TIERS.includes(chest.tier) ? chest.tier : 'Common') as ChestTier;
  if (chest.lastLootSummary && !customCatalog) {
    return {
      ...chest.lastLootSummary,
      openerName: openerLabel === 'DM' ? 'DM' : chest.lastLootSummary.openerName,
      items: (chest.lastLootSummary.items || []).map((it) => ({
        ...it,
        tier: it.tier || chestTier,
      })),
    };
  }

  const rolled = rollChestLoot(chestTier, floor, Math.random, customCatalog);
  const baseGold = Number(chest.gold || 0) > 0 ? Number(chest.gold) : rolled.gold;
  const baseManaStones = Number(chest.manaStones || 0) > 0 ? Number(chest.manaStones) : rolled.manaStones;
  const items: ChestLootSummary['items'] = [
    ...(chest.itemName ? [{ name: chest.itemName, category: chest.itemCategory || 'relic', tier: chestTier, notes: `Found in ${chest.name}` }] : []),
    ...rolled.items.map((r) => ({ name: r.itemName, category: r.category, tier: r.tier || chestTier, notes: r.notes || `${chestTier} Chest (${floor}F)` })),
  ];

  const passiveTriggers: ChestPassiveTrigger[] = [];
  let bonusGoldTotal = 0;
  if (openerChar?.passives?.length) {
    const passiveById = new Map(PASSIVE_SKILL_POOL.map((p) => [p.id, p]));
    for (const rawP of openerChar.passives) {
      const canonical = passiveById.get(rawP.id);
      const fx = canonical?.effects || rawP.effects;
      if (!fx) continue;
      const mult = Number(rawP.multiplierPct || 100) / 100;
      const pct = fx.bonusGoldPct ? Math.round(fx.bonusGoldPct * mult) : 0;
      const flat = fx.chestBonusGold ? Math.round(fx.chestBonusGold * mult) : 0;
      if (pct > 0 || flat > 0) {
        const added = Math.round((baseGold * pct) / 100) + flat;
        bonusGoldTotal += added;
        passiveTriggers.push({
          skillName: canonical?.name || rawP.name,
          tier: String(canonical?.tier || rawP.tier || 'Normal'),
          effectText: canonical?.description || rawP.description,
          bonusGold: added,
        });
      }
    }
  }

  return {
    chestId: chest.id,
    chestName: chest.name || `${chestTier} Chest`,
    tier: chestTier,
    openerName: openerChar?.name || openerLabel,
    baseGold,
    passiveBonusGold: bonusGoldTotal,
    goldGained: baseGold + bonusGoldTotal,
    manaStonesGained: baseManaStones,
    items,
    passiveTriggers,
  };
}

export const DEFAULT_COMBAT_MAX_ROUNDS = 20;

export const COMBAT_DEFEAT_PENALTIES = {
  hpPct: 0.25,
  mpPct: 0.25,
  goldPct: 0.20,
  xpPct: 0.15,
} as const;

export function clampCombatMaxRounds(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_COMBAT_MAX_ROUNDS;
  return Math.max(1, Math.min(100, Math.round(n)));
}
