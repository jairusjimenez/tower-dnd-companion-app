import type {
  EquipmentSlot,
  SettlementBuildingType,
  SettlementNpcRole,
} from './types';

export interface BuildingLevelSpec {
  level: number;
  requiredGold: number;
  requiredManaStones: number;
  beatsRequired: number;
  unlockNote: string;
}

export interface BuildingBlueprint {
  type: SettlementBuildingType;
  name: string;
  roleRequired: SettlementNpcRole;
  roleLabel: string;
  summary: string;
  lockedByDefault?: boolean;
  levels: BuildingLevelSpec[];
}

export const BUILDING_BLUEPRINTS: Record<SettlementBuildingType, BuildingBlueprint> = {
  forge: {
    type: 'forge',
    name: 'Blacksmith Forge',
    roleRequired: 'blacksmith',
    roleLabel: 'Blacksmith',
    summary: 'Forge melee & ranged weapons, shields, and armor from Tower monster materials.',
    levels: [
      { level: 1, requiredGold: 60, requiredManaStones: 1, beatsRequired: 1, unlockNote: 'Tier 1 Iron & Bone Gear' },
      { level: 2, requiredGold: 160, requiredManaStones: 3, beatsRequired: 2, unlockNote: 'Tier 2 Runic Mithril & Chitin Gear' },
      { level: 3, requiredGold: 340, requiredManaStones: 6, beatsRequired: 3, unlockNote: 'Tier 3 Dragonbone & Abyssal Masterworks' },
    ],
  },
  alchemy_lab: {
    type: 'alchemy_lab',
    name: 'Alchemist Lab',
    roleRequired: 'alchemist',
    roleLabel: 'Alchemist',
    summary: 'Brew restorative HP potions, MP elixirs, and combat tonics.',
    levels: [
      { level: 1, requiredGold: 50, requiredManaStones: 1, beatsRequired: 1, unlockNote: 'Basic Healing & Mana Vials' },
      { level: 2, requiredGold: 140, requiredManaStones: 3, beatsRequired: 2, unlockNote: 'Greater Elixirs & Battle Tonics' },
      { level: 3, requiredGold: 300, requiredManaStones: 5, beatsRequired: 3, unlockNote: 'Sovereign Restoration Flasks' },
    ],
  },
  arcane_study: {
    type: 'arcane_study',
    name: 'Arcane Study',
    roleRequired: 'enchanter',
    roleLabel: 'Enchanter',
    summary: 'Enchant equipped weapons & armor (+1 to +3) with Mana Stones & Crystals.',
    levels: [
      { level: 1, requiredGold: 70, requiredManaStones: 2, beatsRequired: 1, unlockNote: '+1 Equipment Enchanting' },
      { level: 2, requiredGold: 180, requiredManaStones: 4, beatsRequired: 2, unlockNote: '+2 Equipment Enchanting' },
      { level: 3, requiredGold: 360, requiredManaStones: 7, beatsRequired: 3, unlockNote: '+3 Sovereign Enchanting' },
    ],
  },
  inn: {
    type: 'inn',
    name: 'Sanctuary Inn',
    roleRequired: 'innkeeper',
    roleLabel: 'Innkeeper',
    summary: 'Rest between beats for full HP/MP recovery and Well-Rested Temp HP.',
    levels: [
      { level: 1, requiredGold: 45, requiredManaStones: 0, beatsRequired: 1, unlockNote: 'Full Rest + 5 Temp HP' },
      { level: 2, requiredGold: 120, requiredManaStones: 2, beatsRequired: 2, unlockNote: 'Full Rest + 10 Temp HP' },
      { level: 3, requiredGold: 250, requiredManaStones: 4, beatsRequired: 3, unlockNote: 'Full Rest + 15 Temp HP' },
    ],
  },
  shrine: {
    type: 'shrine',
    name: 'Shrine of the Spire',
    roleRequired: 'oracle',
    roleLabel: 'Oracle',
    summary: 'Offer Mana Stones & Gold to deepen Patron Deity Favor.',
    lockedByDefault: true,
    levels: [
      { level: 1, requiredGold: 100, requiredManaStones: 3, beatsRequired: 1, unlockNote: 'Deity Prayer & +1 Favor Offerings' },
      { level: 2, requiredGold: 240, requiredManaStones: 6, beatsRequired: 2, unlockNote: 'Greater +2 Favor Offerings' },
      { level: 3, requiredGold: 450, requiredManaStones: 10, beatsRequired: 3, unlockNote: 'Ascendant Spire Altar' },
    ],
  },
};

export interface CraftingRecipe {
  id: string;
  buildingType: 'forge' | 'alchemy_lab';
  minBuildingLevel: number;
  name: string;
  category: 'weapon' | 'armor' | 'consumable';
  slot?: EquipmentSlot;
  goldCost: number;
  manaStoneCost: number;
  materials: Array<{ name: string; qty: number }>;
  attackBonus?: number;
  damageDice?: string;
  damageType?: string;
  rangeSpaces?: number;
  acBonus?: number;
  drBonus?: number;
  healHp?: number;
  healMp?: number;
  notes: string;
}

export const CRAFTING_RECIPES: CraftingRecipe[] = [
  // Forge Lv 1
  {
    id: 'craft-iron-longsword',
    buildingType: 'forge',
    minBuildingLevel: 1,
    name: 'Tower-Forged Longsword',
    category: 'weapon',
    slot: 'mainHand',
    goldCost: 25,
    manaStoneCost: 0,
    materials: [{ name: 'Tower Iron Ore', qty: 1 }],
    attackBonus: 4,
    damageDice: '1d8+3',
    damageType: 'Slashing',
    rangeSpaces: 1,
    notes: 'Crafted Melee Blade (+4 Hit, 1d8+3 Slashing)',
  },
  {
    id: 'craft-bone-shortbow',
    buildingType: 'forge',
    minBuildingLevel: 1,
    name: 'Reinforced Bone Shortbow',
    category: 'weapon',
    slot: 'mainHand',
    goldCost: 25,
    manaStoneCost: 0,
    materials: [
      { name: 'Monster Bone', qty: 1 },
      { name: 'Beast Sinew', qty: 1 },
    ],
    attackBonus: 4,
    damageDice: '1d6+3',
    damageType: 'Piercing (Ranged)',
    rangeSpaces: 4,
    notes: 'Crafted Ranged Bow (+4 Hit, 1d6+3 Piercing, 4 Sp)',
  },
  {
    id: 'craft-iron-shield',
    buildingType: 'forge',
    minBuildingLevel: 1,
    name: 'Tower Iron Buckler',
    category: 'armor',
    slot: 'offHand',
    goldCost: 20,
    manaStoneCost: 0,
    materials: [{ name: 'Tower Iron Ore', qty: 1 }],
    acBonus: 2,
    drBonus: 1,
    notes: 'Crafted Off-Hand Shield (+2 AC, +1 DR)',
  },
  {
    id: 'craft-leather-brigandine',
    buildingType: 'forge',
    minBuildingLevel: 1,
    name: 'Hardened Hunter Brigandine',
    category: 'armor',
    slot: 'body',
    goldCost: 25,
    manaStoneCost: 0,
    materials: [{ name: 'Tough Monster Leather', qty: 2 }],
    acBonus: 3,
    drBonus: 2,
    notes: 'Crafted Body Armor (+3 AC, +2 DR)',
  },
  // Forge Lv 2
  {
    id: 'craft-mithril-halberd',
    buildingType: 'forge',
    minBuildingLevel: 2,
    name: 'Runic Mithril Greatsword',
    category: 'weapon',
    slot: 'mainHand',
    goldCost: 75,
    manaStoneCost: 1,
    materials: [
      { name: 'Runic Mithril Scrap', qty: 1 },
      { name: 'Tower Iron Ore', qty: 1 },
    ],
    attackBonus: 6,
    damageDice: '2d6+4',
    damageType: 'Slashing',
    rangeSpaces: 1,
    notes: 'Masterwork Melee Blade (+6 Hit, 2d6+4 Slashing)',
  },
  {
    id: 'craft-mithril-longbow',
    buildingType: 'forge',
    minBuildingLevel: 2,
    name: 'Runic Sniper Longbow',
    category: 'weapon',
    slot: 'mainHand',
    goldCost: 75,
    manaStoneCost: 1,
    materials: [
      { name: 'Runic Mithril Scrap', qty: 1 },
      { name: 'Beast Sinew', qty: 1 },
    ],
    attackBonus: 6,
    damageDice: '1d10+4',
    damageType: 'Piercing (Ranged)',
    rangeSpaces: 5,
    notes: 'Masterwork Ranged Bow (+6 Hit, 1d10+4 Piercing, 5 Sp)',
  },
  {
    id: 'craft-chitin-plate',
    buildingType: 'forge',
    minBuildingLevel: 2,
    name: 'Chitin Carapace Plate',
    category: 'armor',
    slot: 'body',
    goldCost: 70,
    manaStoneCost: 1,
    materials: [
      { name: 'Chitin Carapace', qty: 2 },
      { name: 'Tough Monster Leather', qty: 1 },
    ],
    acBonus: 4,
    drBonus: 3,
    notes: 'Reinforced Armor (+4 AC, +3 DR)',
  },
  // Forge Lv 3
  {
    id: 'craft-dragonbone-blade',
    buildingType: 'forge',
    minBuildingLevel: 3,
    name: 'Abyssal Dragonbone Edge',
    category: 'weapon',
    slot: 'mainHand',
    goldCost: 160,
    manaStoneCost: 2,
    materials: [
      { name: 'Dragonbone Shard', qty: 1 },
      { name: 'Abyssal Shadow Ash', qty: 1 },
    ],
    attackBonus: 8,
    damageDice: '2d8+6',
    damageType: 'Slashing',
    rangeSpaces: 1,
    notes: 'Legendary Melee Weapon (+8 Hit, 2d8+6 Slashing)',
  },
  {
    id: 'craft-dragonbone-crossbow',
    buildingType: 'forge',
    minBuildingLevel: 3,
    name: 'Dragonbone Repeating Crossbow',
    category: 'weapon',
    slot: 'mainHand',
    goldCost: 160,
    manaStoneCost: 2,
    materials: [
      { name: 'Dragonbone Shard', qty: 1 },
      { name: 'Beast Sinew', qty: 1 },
    ],
    attackBonus: 8,
    damageDice: '2d6+6',
    damageType: 'Piercing (Ranged)',
    rangeSpaces: 5,
    notes: 'Legendary Ranged Crossbow (+8 Hit, 2d6+6 Piercing, 5 Sp)',
  },
  // Alchemist Lab Lv 1–3
  {
    id: 'brew-hp-potion',
    buildingType: 'alchemy_lab',
    minBuildingLevel: 1,
    name: 'Crimson Healing Potion',
    category: 'consumable',
    goldCost: 18,
    manaStoneCost: 0,
    materials: [],
    healHp: 18,
    notes: 'Restores +18 HP when consumed.',
  },
  {
    id: 'brew-mp-elixir',
    buildingType: 'alchemy_lab',
    minBuildingLevel: 1,
    name: 'Shinsu Mana Elixir',
    category: 'consumable',
    goldCost: 18,
    manaStoneCost: 1,
    materials: [],
    healMp: 14,
    notes: 'Restores +14 MP when consumed.',
  },
  {
    id: 'brew-greater-tonic',
    buildingType: 'alchemy_lab',
    minBuildingLevel: 2,
    name: 'Greater Spire Tonic',
    category: 'consumable',
    goldCost: 45,
    manaStoneCost: 1,
    materials: [{ name: 'Cracked Mana Crystal', qty: 1 }],
    healHp: 35,
    healMp: 20,
    notes: 'Restores +35 HP & +20 MP when consumed.',
  },
  {
    id: 'brew-sovereign-flask',
    buildingType: 'alchemy_lab',
    minBuildingLevel: 3,
    name: 'Sovereign Revival Flask',
    category: 'consumable',
    goldCost: 90,
    manaStoneCost: 2,
    materials: [{ name: 'Abyssal Shadow Ash', qty: 1 }],
    healHp: 75,
    healMp: 40,
    notes: 'Restores +75 HP & +40 MP when consumed.',
  },
];

export function inferSettlementRoleFromLabel(role?: string): SettlementNpcRole {
  const r = String(role || '').trim().toLowerCase();
  if (/blacksmith|smith|forger|armorer|weaponsmith/.test(r)) return 'blacksmith';
  if (/alchem|potion|brewer|herbal/.test(r)) return 'alchemist';
  if (/enchant|arcane|scholar|mage|runesmith/.test(r)) return 'enchanter';
  if (/inn|tavern|barkeep|cook|chef|healer/.test(r)) return 'innkeeper';
  if (/oracle|priest|cleric|shrine|deity/.test(r)) return 'oracle';
  return 'villager';
}
