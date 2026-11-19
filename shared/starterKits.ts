import type { EquipmentItem, EquipmentSlot, StarterWeaponDef } from './types';

export const STARTER_WOODEN_WEAPONS: { melee: StarterWeaponDef[]; ranged: StarterWeaponDef[] } = {
  melee: [
    {
      id: 'wood-shortsword',
      name: 'Wooden Shortsword',
      damageDice: '1d6+1',
      damageType: 'Slashing',
      attackBonus: 3,
      rangeSpaces: 1,
      body: { name: 'Trainee Brigandine', acBonus: 2, drBonus: 1 },
      offHand: { name: 'Wooden Buckler', acBonus: 1, drBonus: 1 },
    },
    {
      id: 'wood-greatsword',
      name: 'Wooden Greatsword',
      damageDice: '1d8+2',
      damageType: 'Slashing',
      attackBonus: 2,
      rangeSpaces: 1,
      body: { name: 'Vanguard Scale Vest', acBonus: 2, drBonus: 2 },
    },
    {
      id: 'wood-spear',
      name: 'Wooden Spear',
      damageDice: '1d6+2',
      damageType: 'Piercing',
      attackBonus: 3,
      rangeSpaces: 1,
      body: { name: 'Skirmisher Leather Armor', acBonus: 2, drBonus: 1 },
      boots: { name: 'Traveler Boots', acBonus: 1, drBonus: 0 },
    },
    {
      id: 'wood-mace',
      name: 'Wooden Mace',
      damageDice: '1d6+2',
      damageType: 'Bludgeoning',
      attackBonus: 3,
      rangeSpaces: 1,
      body: { name: 'Acolyte Padded Mail', acBonus: 2, drBonus: 2 },
      offHand: { name: 'Wooden Buckler', acBonus: 1, drBonus: 0 },
    },
    {
      id: 'wood-dagger',
      name: 'Wooden Dagger',
      damageDice: '1d4+2',
      damageType: 'Piercing',
      attackBonus: 4,
      rangeSpaces: 1,
      body: { name: 'Shadow Apprentice Cloak', acBonus: 2, drBonus: 1 },
      boots: { name: 'Silent Cloth Boots', acBonus: 1, drBonus: 0 },
    },
  ],
  ranged: [
    {
      id: 'wood-shortbow',
      name: 'Wooden Shortbow',
      damageDice: '1d6+1',
      damageType: 'Piercing (Ranged)',
      attackBonus: 3,
      rangeSpaces: 3,
      body: { name: 'Scout Leather Tunic', acBonus: 2, drBonus: 1 },
      boots: { name: 'Agile Scout Boots', acBonus: 1, drBonus: 0 },
    },
    {
      id: 'wood-longbow',
      name: 'Wooden Longbow',
      damageDice: '1d8+1',
      damageType: 'Piercing (Ranged)',
      attackBonus: 2,
      rangeSpaces: 4,
      body: { name: 'Ranger Hooded Jerkin', acBonus: 2, drBonus: 1 },
      head: { name: 'Ranger Sight Hood', acBonus: 1, drBonus: 0 },
    },
    {
      id: 'wood-crossbow',
      name: 'Wooden Light Crossbow',
      damageDice: '1d8+2',
      damageType: 'Piercing (Ranged)',
      attackBonus: 2,
      rangeSpaces: 3,
      body: { name: 'Marksman Studded Vest', acBonus: 2, drBonus: 1 },
    },
    {
      id: 'wood-slingshot',
      name: 'Wooden Slingshot',
      damageDice: '1d4+2',
      damageType: 'Bludgeoning (Ranged)',
      attackBonus: 4,
      rangeSpaces: 3,
      body: { name: 'Nimble Climber Coat', acBonus: 2, drBonus: 1 },
      boots: { name: 'Swift Stride Boots', acBonus: 1, drBonus: 0 },
    },
  ],
};

export const STARTER_EQUIPMENT_KITS: Record<string, Record<EquipmentSlot, EquipmentItem | null>> = {
  archer: {
    mainHand: { id: 'st-archer-bow', name: 'Oak Shortbow', slot: 'mainHand', type: 'weapon', attackBonus: 3, damageDice: '1d6+2', damageType: 'Piercing (Ranged)', rangeSpaces: 4, drBonus: 0, acBonus: 0 },
    offHand: null,
    head: null,
    body: { id: 'st-archer-body', name: 'Scout Leather Tunic', slot: 'body', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 1, acBonus: 2 },
    boots: null,
    relic: null,
  },
  swordsman: {
    mainHand: { id: 'st-swordsman-wep', name: 'Iron Longsword', slot: 'mainHand', type: 'weapon', attackBonus: 4, damageDice: '1d8+3', damageType: 'Slashing', rangeSpaces: 1, drBonus: 0, acBonus: 0 },
    offHand: null,
    head: null,
    body: { id: 'st-swordsman-body', name: 'Trainee Brigandine', slot: 'body', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 1, acBonus: 2 },
    boots: null,
    relic: null,
  },
  sword_shield: {
    mainHand: { id: 'st-sns-wep', name: 'Iron Broadsword', slot: 'mainHand', type: 'weapon', attackBonus: 3, damageDice: '1d8+2', damageType: 'Slashing', rangeSpaces: 1, drBonus: 0, acBonus: 0 },
    offHand: { id: 'st-sns-shd', name: 'Oak Kite Shield', slot: 'offHand', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 1, acBonus: 2 },
    head: null,
    body: { id: 'st-sns-body', name: 'Initiate Leather Coat', slot: 'body', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 1, acBonus: 2 },
    boots: null,
    relic: null,
  },
  mage: {
    mainHand: { id: 'st-mage-wep', name: 'Apprentice Mana Staff', slot: 'mainHand', type: 'weapon', attackBonus: 4, damageDice: '1d6+2', damageType: 'Arcane', rangeSpaces: 2, drBonus: 0, acBonus: 0 },
    offHand: null,
    head: null,
    body: { id: 'st-mage-body', name: 'Scholar Mana Robes', slot: 'body', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 1, acBonus: 1 },
    boots: null,
    relic: { id: 'st-mage-rel', name: 'Cracked Shinsu Focus', slot: 'relic', type: 'relic', attackBonus: 1, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 0, acBonus: 1 },
  },
};

export function findStarterWeapon(weaponId?: string, style: 'melee' | 'ranged' = 'melee'): StarterWeaponDef | null {
  const pool = [...STARTER_WOODEN_WEAPONS.melee, ...STARTER_WOODEN_WEAPONS.ranged];
  if (weaponId) {
    const match = pool.find((w) => w.id === weaponId);
    if (match) return match;
  }
  return STARTER_WOODEN_WEAPONS[style]?.[0] || STARTER_WOODEN_WEAPONS.melee[0] || null;
}

export function buildStarterEquipment(
  kitKey: string,
  characterId: string,
  customCategory?: 'melee' | 'ranged',
  customWeaponId?: string,
): { equipment: Record<EquipmentSlot, EquipmentItem | null>; label: string } {
  if (kitKey === 'custom') {
    const cat = customCategory === 'ranged' ? 'ranged' : 'melee';
    const list = STARTER_WOODEN_WEAPONS[cat];
    const picked = list.find((w) => w.id === customWeaponId) || list[0];
    const makeArmor = (slot: EquipmentSlot, spec?: { name: string; acBonus: number; drBonus: number }): EquipmentItem | null =>
      spec
        ? {
            id: `st-custom-${slot}-${characterId}`,
            name: spec.name,
            slot,
            type: 'armor',
            attackBonus: 0,
            damageDice: '',
            damageType: '',
            rangeSpaces: 0,
            drBonus: Number(spec.drBonus || 0),
            acBonus: Number(spec.acBonus || 0),
          }
        : null;

    return {
      equipment: {
        mainHand: {
          id: picked.id,
          name: picked.name,
          slot: 'mainHand',
          type: 'weapon',
          attackBonus: Number(picked.attackBonus || 0),
          damageDice: picked.damageDice,
          damageType: picked.damageType,
          rangeSpaces: Number(picked.rangeSpaces || 1),
          drBonus: 0,
          acBonus: 0,
        },
        offHand: makeArmor('offHand', picked.offHand),
        head: makeArmor('head', picked.head),
        body: makeArmor('body', picked.body || { name: 'Initiate Leather Coat', acBonus: 2, drBonus: 1 }),
        boots: makeArmor('boots', picked.boots),
        relic: null,
      },
      label: picked.name,
    };
  }

  const kit = STARTER_EQUIPMENT_KITS[kitKey] || STARTER_EQUIPMENT_KITS.swordsman;
  return {
    equipment: JSON.parse(JSON.stringify(kit)) as Record<EquipmentSlot, EquipmentItem | null>,
    label: kitKey,
  };
}
