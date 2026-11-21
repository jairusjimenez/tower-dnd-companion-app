import type { Character, PassiveEffects, PassiveSkill, PassiveTier } from './types';

export const PASSIVE_GACHA_ODDS: Record<PassiveTier, number> = {
  Normal: 55,
  Advanced: 22,
  Rare: 12,
  'Super Rare': 6,
  'Super Super Rare': 3,
  Legendary: 1.5,
  Mythic: 0.5,
};

type PassiveDefTuple = [
  string,
  string,
  Partial<Pick<PassiveSkill, 'bonusAc' | 'bonusDr' | 'bonusHp' | 'bonusMp' | 'bonusSpeedSpaces'>>,
  PassiveEffects?,
];

const TIER_DEFS: Array<{ tier: PassiveTier; prefix: string; items: PassiveDefTuple[] }> = [
  {
    tier: 'Normal',
    prefix: 'n',
    items: [
      ['Iron Skin', '+2 Max HP and +1 Damage Reduction vs Critical Hits.', { bonusHp: 2 }, { critDamageReduction: 1 }],
      ['Grit Guard', 'Permanently grants +1 Damage Reduction.', { bonusDr: 1 }],
      ['Vital Spark', 'Increases Max HP by +3.', { bonusHp: 3 }],
      ['Mana Wellspring', 'Increases Max MP by +3.', { bonusMp: 3 }],
      ['Fleet Footwork', 'Increases Movement by +1 Space.', { bonusSpeedSpaces: 1 }],
      ['Keen Instinct', '+1 to Initiative rolls.', {}, { bonusInitiative: 1 }],
      ['Steady Grip', '+1 to Melee Attack Hit rolls.', {}, { bonusMeleeHit: 1 }],
      ['True Aim', '+1 to Ranged Attack Hit rolls.', {}, { bonusRangedHit: 1 }],
      ['Focused Mind', '+1 to Spell Attack Hit rolls.', {}, { bonusSpellHit: 1 }],
      ['Hardy Constitution', '+1 to Poison and Disease saves.', {}, { skillCheckNote: '+1 Poison & Disease saves' }],
      ['Tower Scavenger', '+5% bonus Gold from monster loot & chests.', {}, { bonusGoldPct: 5 }],
      ['Quick Recovery', 'Rest Spots restore +3 extra HP.', {}, { restSpotBonusHp: 3 }],
      ['Mana Sipper', 'Rest Spots restore +2 extra MP.', {}, { restSpotBonusMp: 2 }],
      ['Light Step', '+1 to Stealth and Acrobatics checks.', {}, { skillCheckNote: '+1 Stealth & Acrobatics' }],
      ['Brawler Stance', '+1 Unarmed and Melee damage.', {}, { bonusMeleeDamage: 1 }],
      ['Shield Brace', '+1 DR while holding an Off-Hand shield.', {}, { requiresShieldDr: 1 }],
      ['Leather Familiarity', '+2 Max HP and +1 Initiative while wearing Light Armor.', {}, { requiresLightArmorHp: 2, requiresLightArmorInit: 1 }],
      ['Apprentice Focus', '+1 Spell Damage on spells.', {}, { bonusSpellPower: 1 }],
      ['Alert Sentry', '+1 Perception checks & cannot be surprised while conscious.', {}, { perCheckBonus: 1, skillCheckNote: 'Cannot be surprised' }],
      ['Torchbearer', '+1 Range Space on Observe & 4 Spaces of low-light vision.', {}, { bonusObserveRangeSpaces: 1, skillCheckNote: '4 Spaces low-light vision' }],
      ['Thick Hide', '+2 Max HP and reduces incoming Slashing damage by 1.', { bonusHp: 2 }, { slashingResist: 1 }],
      ['Fireproof Cloak', 'Reduces incoming Fire damage by 1.', {}, { elementalResists: { Fire: 1 } }],
      ['Frost Ward', 'Reduces incoming Water/Ice damage by 1.', {}, { elementalResists: { Water: 1 } }],
      ['Grounding Boots', 'Reduces incoming Earth damage by 1.', {}, { elementalResists: { Earth: 1 } }],
      ['Windbreaker', 'Reduces incoming Wind damage by 1.', {}, { elementalResists: { Wind: 1 } }],
      ['Dawn Mantle', 'Reduces incoming Light damage by 1.', {}, { elementalResists: { Light: 1 } }],
      ['Dusk Veil', 'Reduces incoming Dark damage by 1.', {}, { elementalResists: { Dark: 1 } }],
      ['Pack Mule', '+20% carrying capacity & +1 Athletics / STR checks.', {}, { skillCheckNote: '+1 Athletics & STR checks' }],
      ['Sharp Eyes', '+1 Range Space on ranged weapons.', {}, { bonusRangedRangeSpaces: 1 }],
      ['Battle Cry', '+1 Intimidation & +1 Attack Hit on Round 1.', {}, { round1HitBonus: 1, skillCheckNote: '+1 Intimidation' }],
      ['Herbalist Touch', 'Consumables restore +2 extra HP.', {}, { consumableBonusHp: 2 }],
      ['Alchemist Sip', 'Consumables restore +1 extra MP.', {}, { consumableBonusMp: 1 }],
      ['Nimble Dodge', '+1 to AGI saving throws.', {}, { skillCheckNote: '+1 AGI saves' }],
      ['Stoic Resolve', '+1 to VIT saving throws.', {}, { skillCheckNote: '+1 VIT saves' }],
      ['Arcane Literacy', '+1 to INT knowledge checks.', {}, { skillCheckNote: '+1 INT checks' }],
      ['Fortune Coin', '+1 to LUCK checks once per floor.', {}, { skillCheckNote: '+1 LUCK checks (1/floor)' }],
      ['Climber Grip', '+1 Move Space on Round 1 & no climbing penalty.', {}, { round1MoveBonus: 1 }],
      ['Stone Footing', '+2 vs Knockback and Prone effects.', {}, { skillCheckNote: '+2 vs Knockback & Prone' }],
      ['Quick Draw', '+1 Initiative on Round 1 & free weapon draw.', {}, { bonusInitiative: 1 }],
      ['Sparring Habit', '+1 damage against lvl 1-10 monsters.', {}, { damageBonusVsLowLevel: 1 }],
      ['Guard Breaker', '+1 damage against enemies with DR >= 2.', {}, { damageBonusVsHighDr: 1 }],
      ['Enduring Breath', '+2 Max HP & hold breath twice as long underwater.', { bonusHp: 2 }],
      ['Night Watch', 'Rest Spots grant +1 Temp HP.', {}, { restSpotTempHp: 1 }],
      ['Copper Magnet', 'Find +5 extra Gold in Tower chests.', {}, { chestBonusGold: 5 }],
      ['Field Medic', '+2 to stabilizing downed allies.', {}, { skillCheckNote: '+2 Stabilize allies' }],
      ['Calm Breathing', '+1 to Concentration checks.', {}, { skillCheckNote: '+1 Concentration' }],
      ['Swift Reload', '+1 Hit with crossbows/bows & ignore loading.', {}, { bonusRangedHit: 1 }],
      ['Serrated Edge', '+2 bonus damage on Critical Hits.', {}, { bonusCritDamage: 2 }],
      ['Blunt Impact', '+1 weapon damage vs armored foes (DR >= 2).', {}, { damageBonusVsHighDr: 1 }],
      ['Tower Initiate', '+2 Max HP and +2 Max MP.', { bonusHp: 2, bonusMp: 2 }],
    ],
  },
  {
    tier: 'Advanced',
    prefix: 'a',
    items: [
      ['Tempered Scales', '+1 Armor Class and +1 Damage Reduction.', { bonusAc: 1, bonusDr: 1 }],
      ['Bastion Shell', '+1 Damage Reduction and +6 Max HP.', { bonusDr: 1, bonusHp: 6 }],
      ['Shinsu Reservoir', '+8 Max MP and +1 Spell Power.', { bonusMp: 8 }, { bonusSpellPower: 1 }],
      ['Predator Edge', '+1 Attack Hit and +2 Weapon Damage.', {}, { bonusAttackHit: 1, bonusWeaponDamage: 2 }],
      ['Battlefield Rhythm', '+1 Space Movement and +2 Initiative.', { bonusSpeedSpaces: 1 }, { bonusInitiative: 2 }],
      ['Twin Strike Cadence', '+2 damage on your 2nd+ attack each turn.', {}, { secondAttackBonusDamage: 2 }],
      ['Arcane Conduit', '+2 Spell Damage on Elemental spells.', {}, { bonusElementalSpellDamage: 2 }],
      ['Vampiric Fang', 'Heal 3 HP whenever you defeat an enemy.', {}, { hpOnKill: 3 }],
      ['Mana Siphon', 'Recover 2 MP whenever you defeat an enemy.', {}, { mpOnKill: 2 }],
      ['Iron Will', '+2 to all Mental and Fear saving throws.', {}, { skillCheckNote: '+2 Mental & Fear saves' }],
      ['Evasive Roll', 'Opportunity attacks against you have -2 Hit.', {}, { skillCheckNote: '-2 Opportunity Hit vs you' }],
      ['Pyromancer Spark', 'Fire spells deal +2 bonus Fire damage.', {}, { elementalBonusDamage: { Fire: 2 } }],
      ['Terra Anchor', 'Earth spells grant +2 temporary DR for 1 turn.', {}, { spellTempDrOnCast: { Earth: 2 } }],
      ['Zephyr Stride', 'Wind spells increase your Move by +1 Space.', {}, { spellMoveOnCast: { Wind: 1 } }],
      ['Tidal Flow', 'Water spells restore +2 MP on hit.', {}, { spellMpOnHit: { Water: 2 } }],
      ['Radiant Halo', 'Light spells heal you for 3 HP on cast.', {}, { spellHealOnCast: { Light: 3 } }],
      ['Shadow Tendril', 'Dark spells ignore 2 points of enemy DR.', {}, { ignoreEnemyDr: 2 }],
      ['Counter Stance', '+2 damage on Counter-attack Reactions.', {}, { bonusCounterDamage: 2 }],
      ['Parry Mastery', '+2 Parry roll when using the Parry Reaction.', {}, { bonusParryRoll: 2 }],
      ['Spellweaver', '+2 Hit on Reaction Spells.', {}, { bonusReactionSpellHit: 2 }],
      ['Bloodied Fury', '+3 Attack Damage when below 50% HP.', {}, { lowHpDamageBonus: 3, lowHpThresholdPct: 50 }],
      ['Adrenaline Rush', 'Gain +2 Spaces Move on Round 1 of combat.', {}, { round1MoveBonus: 2 }],
      ['Heavy Cleave', '+2 damage with melee weapons.', {}, { bonusMeleeDamage: 2 }],
      ['Dual Wield Tempo', '+1 Attack Hit and +1 Parry roll.', {}, { bonusAttackHit: 1, bonusParryRoll: 1 }],
      ['Treasure Hunter', '+15% Gold from monster loot and chests.', {}, { bonusGoldPct: 15 }],
      ['Fortified Core', '+8 Max HP permanently.', { bonusHp: 8 }],
      ['Deep Well', '+9 Max MP permanently.', { bonusMp: 9 }],
      ['Tower Veteran', '+1 AC, +1 DR, and +4 Max HP.', { bonusAc: 1, bonusDr: 1, bonusHp: 4 }],
      ['Sniper Sight', '+1 Range Space on spells and ranged attacks.', {}, { bonusRangedRangeSpaces: 1, bonusSpellRangeSpaces: 1 }],
      ['Ambush Instinct', '+3 damage on Round 1 against unacted foes.', {}, { round1DamageBonus: 3 }],
      ['Status Resistance', '+3 to saves vs Stun, Bleed, and Burn.', {}, { skillCheckNote: '+3 vs Stun/Bleed/Burn' }],
      ['Armor Proficiency+', '+1 AC and +1 DR while wearing Body armor.', {}, { requiresBodyArmorAc: 1, requiresBodyArmorDr: 1 }],
      ['Unarmored Grace', '+2 AC when wearing no body armor.', {}, { requiresUnarmoredAc: 2 }],
      ['Overcharge Casting', 'Spend +2 MP to add +1d4 spell damage (or +2 spell dmg).', {}, { bonusSpellPower: 2 }],
      ['Potent Alchemy', 'Consumable healing items restore +4 extra HP.', {}, { consumableBonusHp: 4 }],
      ['Tactical Retreat', 'Disengage does not provoke opportunity hits.', {}, { skillCheckNote: 'Safe Disengage' }],
      ['Crushing Blow', 'Ignores 2 points of enemy DR on melee hits.', {}, { ignoreEnemyDr: 2 }],
      ['Mana Shielding', 'Reduce incoming spell damage by 2.', {}, { spellDmgResist: 2 }],
      ['Quickened Reflex', '+2 Initiative and +1 AGI checks.', {}, { bonusInitiative: 2 }],
      ['Ranker Grit', '+5 Max HP and +5 Max MP.', { bonusHp: 5, bonusMp: 5 }],
    ],
  },
  {
    tier: 'Rare',
    prefix: 'r',
    items: [
      ['Sovereign Aegis', '+2 Armor Class and +2 Damage Reduction.', { bonusAc: 2, bonusDr: 2 }],
      ['Immortal Heart', '+14 Max HP and +8 Max MP.', { bonusHp: 14, bonusMp: 8 }],
      ['Void Piercer', 'Attacks & Spells ignore 3 DR; +2 Attack Hit.', {}, { ignoreEnemyDr: 3, bonusAttackHit: 2 }],
      ["Fatebreaker's Gaze", 'Critical hits trigger on rolls of 19-20.', {}, { critThreshold: 19 }],
      ['Arcane Overflow', 'Spells cost -1 MP (min 1) and deal +3 damage.', {}, { spellMpDiscount: 1, bonusSpellPower: 3 }],
      ['Regenerating Vessel', 'Restore 2 HP at the start of each turn.', {}, { hpRegenPerTurn: 2 }],
      ['Shinsu Circulation', 'Restore 2 MP at the start of each turn.', {}, { mpRegenPerTurn: 2 }],
      ['Phantom Step', '+2 Spaces Move and ignore difficult terrain.', { bonusSpeedSpaces: 2 }, { ignoreDifficultTerrain: true }],
      ['Executioner Mark', 'Deal +1d6 damage to enemies below 50% HP.', {}, { executeBonusDice: '1d6' }],
      ['Elemental Resonance', 'All 6 elemental spells deal +3 bonus damage.', {}, { bonusElementalSpellDamage: 3 }],
      ['Aegis Reflex', '+2 AC against ranged and spell attacks.', {}, { rangedAndSpellAc: 2 }],
      ['Dragonscale Hide', '+2 Damage Reduction and +4 Max HP permanently.', { bonusDr: 2, bonusHp: 4 }],
      ['Warlord Presence', 'Allies within 3 Spaces gain +1 Attack Hit & +1 dmg.', {}, { auraAllyHitBonus: 1, auraAllyDmgBonus: 1 }],
      ['Shadow Blink', 'Teleport 2 Spaces after using a Reaction.', {}, { skillCheckNote: 'Teleport 2 Spaces post-Reaction' }],
      ['Spell Echo', '20% chance for a cast spell to refund half MP (min 1).', {}, { spellEchoPct: 20 }],
      ['Titan Strength', '+4 Melee Damage on all weapon strikes.', {}, { bonusMeleeDamage: 4 }],
      ['Eagle Horizon', '+2 Range Spaces on all attacks and spells.', {}, { bonusRangedRangeSpaces: 2, bonusSpellRangeSpaces: 2 }],
      ['Soul Harvest', 'Gain +5 HP and +4 MP per enemy defeated.', {}, { hpOnKill: 5, mpOnKill: 4 }],
      ['Unbreakable Stance', 'Immune to Knockback and +2 vs Stun.', {}, { knockbackImmune: true, skillCheckNote: '+2 vs Stun' }],
      ['Adaptive Ward', 'Gain +3 DR against the last damage type taken.', {}, { adaptiveWardDr: 3 }],
      ['Crimson Thirst', 'Heal 20% of melee damage dealt (min 2 HP).', {}, { lifestealMeleePct: 20 }],
      ['Lethal Precision', '+2 Attack Hit and +3 Critical Damage.', {}, { bonusAttackHit: 2, bonusCritDamage: 3 }],
      ['Mana Battery', '+15 Max MP permanently.', { bonusMp: 15 }],
      ['Juggernaut Frame', '+16 Max HP permanently.', { bonusHp: 16 }],
      ['Twin Reaction', 'May use 1 extra Reaction per round.', {}, { extraReactionPerRound: 1 }],
      ['Elemental Barrier', 'Reduce all elemental damage taken by 3.', {}, { allElementalResist: 3 }],
      ['Blessed Fortune', 'Reroll one natural 1 per combat encounter.', {}, { rerollNat1PerCombat: true }],
      ['Piercing Nova', 'AoE spells deal +4 damage & ignore 2 DR.', {}, { bonusSpellPower: 4, ignoreEnemyDr: 2 }],
      ['Iron Bastion', '+3 Armor Class permanently.', { bonusAc: 3 }],
      ['Flashstep', '+2 Spaces Movement and +2 Initiative.', { bonusSpeedSpaces: 2 }, { bonusInitiative: 2 }],
      ['Vanguard Charge', '+1d8 bonus damage if you moved 3+ Spaces.', {}, { moveChargeBonusDice: '1d8' }],
      ['Runic Inscription', 'Equipped weapon gains +2 Attack Hit and +2 damage.', {}, { bonusWeaponDamage: 2, bonusAttackHit: 2 }],
      ['Sacred Vessel', 'Healing from consumables and Rest Spots is +5 higher.', {}, { healingReceivedBonus: 5 }],
      ['Frostbite Aura', 'Adjacent enemies suffer -2 Attack Hit.', {}, { auraEnemyHitPenalty: 2 }],
      ['High Ranker Instinct', '+2 AC, +1 DR, +10 Max HP.', { bonusAc: 2, bonusDr: 1, bonusHp: 10 }],
    ],
  },
  {
    tier: 'Super Rare',
    prefix: 'sr',
    items: [
      ['Abyssal Plate', '+3 Armor Class and +2 Damage Reduction.', { bonusAc: 3, bonusDr: 2 }],
      ['Leviathan Core', '+22 Max HP and +14 Max MP.', { bonusHp: 22, bonusMp: 14 }],
      ['Critical Mastery', 'Critical hits trigger on 18-20 and add +1d8.', {}, { critThreshold: 18, bonusCritDice: '1d8' }],
      ['Spell Sovereign', 'Spells cost -2 MP (min 1) and deal +5 damage.', {}, { spellMpDiscount: 2, bonusSpellPower: 5 }],
      ['Phantom Afterimage', '20% chance to evade incoming weapon strikes.', {}, { evasionPct: 20 }],
      ['Armor Shredder', 'Attacks permanently reduce target DR by 1.', {}, { shredEnemyDr: 1 }],
      ['Undying Will', 'Survive a lethal hit at 1 HP once per battle.', {}, { surviveFatalPerCombat: true }],
      ['Tempest Velocity', '+3 Spaces Movement and +4 Initiative.', { bonusSpeedSpaces: 3 }, { bonusInitiative: 4 }],
      ['Shinsu Overload', 'Restore 3 MP at the start of every turn.', {}, { mpRegenPerTurn: 3 }],
      ['Bloodmoon Pact', 'Restore 4 HP at the start of every turn.', {}, { hpRegenPerTurn: 4 }],
      ['Elemental Mastery: Fire', 'Fire spells deal +1d8 bonus damage & burn.', {}, { elementalBonusDice: { Fire: '1d8' } }],
      ['Elemental Mastery: Earth', 'Earth spells grant +4 DR & +1d6 damage.', {}, { elementalBonusDice: { Earth: '1d6' }, spellTempDrOnCast: { Earth: 4 } }],
      ['Elemental Mastery: Wind', 'Wind spells ignore cover & deal +1d8.', {}, { elementalBonusDice: { Wind: '1d8' } }],
      ['Elemental Mastery: Water', 'Water spells heal +5 HP and deal +1d6.', {}, { elementalBonusDice: { Water: '1d6' }, spellHealOnCast: { Water: 5 } }],
      ['Elemental Mastery: Light', 'Light spells blind foes & deal +1d8.', {}, { elementalBonusDice: { Light: '1d8' } }],
      ['Elemental Mastery: Dark', 'Dark spells drain 4 HP and deal +1d8.', {}, { elementalBonusDice: { Dark: '1d8' }, spellLifestealHp: { Dark: 4 } }],
      ['Colossus Might', '+6 Weapon Damage and ignore 4 enemy DR.', {}, { bonusWeaponDamage: 6, ignoreEnemyDr: 4 }],
      ['Deadeye Horizon', '+4 Attack Hit on ranged & spell attacks.', {}, { bonusRangedHit: 4, bonusSpellHit: 4 }],
      ['System Overclock', '+2 to all 6 Attribute modifiers in combat.', {}, { allAttributesInCombat: 2 }],
      ['Reflective Carapace', 'Attackers take 5 damage when hitting you.', {}, { reflectDamageOnHit: 5 }],
      ['Arcane Counter', 'Reaction spells deal +1d10 bonus damage.', {}, { bonusReactionSpellDice: '1d10' }],
      ['Vampiric Aura', 'Heal 25% of all damage dealt with attacks.', {}, { lifestealAllPct: 25 }],
      ['Mana Font', '+24 Max MP permanently.', { bonusMp: 24 }],
      ['Titan Vitality', '+28 Max HP permanently.', { bonusHp: 28 }],
      ['Guardian Sanctuary', 'Allies within 2 Spaces gain +2 AC and +2 DR.', {}, { auraAllyAcDr: 2 }],
      ['Relentless Assault', 'Gain a bonus weapon strike on a critical hit.', {}, { bonusWeaponAttackOnCrit: true }],
      ['Miracle Catalyst', 'Deity Blessings cost 1 less Favor (min 1).', {}, { deityFavorDiscount: 1 }],
      ['Dragonborn Resilience', '+3 Damage Reduction permanently.', { bonusDr: 3 }],
      ['Astral Step', 'Ignore all obstacles when moving up to 4 Spaces.', {}, { ignoreDifficultTerrain: true }],
      ['Tower Conqueror', '+3 AC, +2 DR, +14 Max HP, +10 Max MP.', { bonusAc: 3, bonusDr: 2, bonusHp: 14, bonusMp: 10 }],
    ],
  },
  {
    tier: 'Super Super Rare',
    prefix: 'ssr',
    items: [
      ['Monarch Armor', '+4 Armor Class and +3 Damage Reduction.', { bonusAc: 4, bonusDr: 3 }],
      ['Eternal Spring', '+36 Max HP and +22 Max MP.', { bonusHp: 36, bonusMp: 22 }],
      ['Fateweaver Eye', 'Critical hits trigger on 17-20 and deal 2.5x.', {}, { critThreshold: 17, critMultiplier: 2.5 }],
      ['Zero-Cost Arcana', 'First spell cast each combat costs 0 MP.', {}, { zeroCostFirstSpell: true }],
      ['Shadow Extraction', 'Defeating a monster grants +10 Temp HP & +5 MP.', {}, { tempHpOnKill: 10, mpOnKill: 5 }],
      ['Godspeed Dash', '+4 Spaces Move & immune to opportunity hits.', { bonusSpeedSpaces: 4 }],
      ['Absolute Defense', 'Halve the damage of the first hit each round.', {}, { firstHitHalved: true }],
      ['Worldsplitter Blow', 'Melee strikes deal +2d6 damage & ignore 6 DR.', {}, { bonusWeaponDice: '2d6', ignoreEnemyDr: 6 }],
      ['Cataclysmic Cast', 'Spells deal +2d6 damage and +2 Range Spaces.', {}, { bonusSpellDice: '2d6', bonusSpellRangeSpaces: 2 }],
      ['Phoenix Rebirth', 'Revive once per combat with 50% HP on KO.', {}, { revivePerCombatPct: 50 }],
      ['Crimson Sovereign', 'Deal +10 damage when below 60% HP.', {}, { lowHpDamageBonus: 10, lowHpThresholdPct: 60 }],
      ['Shinsu Domain', 'Restore 5 MP & 5 HP at the start of each turn.', {}, { mpRegenPerTurn: 5, hpRegenPerTurn: 5 }],
      ['Dimensional Parry', 'Successful Parry reflects 50% damage back.', {}, { parryReflectPct: 50 }],
      ['Omnislash', 'Weapon Strike hits an additional nearby foe.', {}, { hitAdditionalNearbyFoe: true }],
      ['Grand Archmage', 'Spells cost -3 MP (min 1) and +8 Spell Power.', {}, { spellMpDiscount: 3, bonusSpellPower: 8 }],
      ['True Invulnerability', '+4 Damage Reduction permanently.', { bonusDr: 4 }],
      ['Celestial Halo', '+4 Armor Class and +2 Parry permanently.', { bonusAc: 4 }, { bonusParryRoll: 2 }],
      ['Abyssal Drain', 'All spells heal you for 25% of damage dealt.', {}, { spellLifestealPct: 25 }],
      ['Lucky Star', 'Automatically turn 1 missed attack into a hit/battle.', {}, { turnMissToHitPerCombat: true }],
      ['Sovereign Ascension', '+3 AC, +3 DR, +22 Max HP, +18 Max MP.', { bonusAc: 3, bonusDr: 3, bonusHp: 22, bonusMp: 18 }],
    ],
  },
  {
    tier: 'Legendary',
    prefix: 'l',
    items: [
      ['Aegis of the First Climber', '+5 Armor Class and +4 Damage Reduction.', { bonusAc: 5, bonusDr: 4 }],
      ['Heart of the Tower', '+55 Max HP and +35 Max MP.', { bonusHp: 55, bonusMp: 35 }],
      ['Irregular Authority', 'Ignore all enemy Damage Reduction completely.', {}, { ignoreAllEnemyDr: true }],
      ['Sovereign Critical', 'Crits trigger on 16-20 and deal triple damage.', {}, { critThreshold: 16, critMultiplier: 3 }],
      ['Infinite Shinsu Loop', 'Recover 8 MP at the start of every turn.', {}, { mpRegenPerTurn: 8 }],
      ['Immortal Sovereign Body', 'Restore 8 HP/turn and immune to status effects.', {}, { hpRegenPerTurn: 8, statusImmune: true }],
      ['Starfall Casting', 'Cast two spells in a single Action once/battle.', {}, { skillCheckNote: 'Dual-cast 1/battle' }],
      ['Blade of Ruin', '+7 Attack Hit and +2d10 Weapon Damage.', {}, { bonusAttackHit: 7, bonusWeaponDice: '2d10' }],
      ['Temporal Step', '+5 Spaces Move and act first in Initiative.', { bonusSpeedSpaces: 5 }, { actFirstInInitiative: true }],
      ['Divine Mirror', 'Reflect 100% of one enemy attack once/battle.', {}, { reflectOneAttackPerCombat: true }],
      ['Apex Predator', 'Deal +50% damage to Boss and Elite monsters.', {}, { damageBonusVsBossPct: 50 }],
      ['Archon Resonance', 'All elemental spells deal +3d6 bonus damage.', {}, { elementalBonusDice: { Fire: '3d6', Earth: '3d6', Wind: '3d6', Water: '3d6', Light: '3d6', Dark: '3d6' } }],
      ['Undying Legend', 'Cannot drop below 1 HP for 1 round when fatal.', {}, { undyingLegendPerCombat: true }],
      ['Worldbreaker Aura', '+4 AC, +4 DR, and +5 Attack Hit.', { bonusAc: 4, bonusDr: 4 }, { bonusAttackHit: 5 }],
      ['Transcendent Mastery', '+35 Max HP, +30 Max MP, +4 AC, +4 DR.', { bonusHp: 35, bonusMp: 30, bonusAc: 4, bonusDr: 4 }],
    ],
  },
  {
    tier: 'Mythic',
    prefix: 'm',
    items: [
      ['Administrator Privilege', '+7 AC, +6 DR, and ignore all enemy DR.', { bonusAc: 7, bonusDr: 6 }, { ignoreAllEnemyDr: true }],
      ['Origin of the Tower', '+85 Max HP, +55 Max MP, +10 HP/MP regen.', { bonusHp: 85, bonusMp: 55 }, { hpRegenPerTurn: 10, mpRegenPerTurn: 10 }],
      ['Absolute Zero-Cost', 'All spells cost 0 MP and deal +4d8 damage.', {}, { zeroCostAllSpells: true, bonusSpellDice: '4d8' }],
      ['Mythic Fatebreaker', 'Every roll of 15-20 is a guaranteed Critical Hit.', {}, { critThreshold: 15 }],
      ['Omnipotent Strike', 'Weapon Strikes deal +4d10 damage & stun.', {}, { bonusWeaponDice: '4d10' }],
      ['Godspeed Ascension', '+6 Spaces Move and 50% physical evasion.', { bonusSpeedSpaces: 6 }, { evasionPct: 50 }],
      ['Eternal Monarch', 'Revive 100% HP & MP (1/combat).', {}, { revivePerCombatPct: 100, reviveMpAlso: true }],
      ['Genesis Barrier', 'Reduce all incoming damage by 7 permanently.', { bonusDr: 7 }],
      ['Cosmic Singularity', 'Spells hit all enemies within 4 Spaces of target.', {}, { aoeAllEnemiesWithin4Spaces: true }],
      ['True Irregular', '+60 Max HP, +50 Max MP, +6 AC, +5 DR, +5 Move.', { bonusHp: 60, bonusMp: 50, bonusAc: 6, bonusDr: 5, bonusSpeedSpaces: 5 }],
    ],
  },
];

export const PASSIVE_SKILL_POOL: PassiveSkill[] = TIER_DEFS.flatMap(({ tier, prefix, items }) =>
  items.map(([name, description, bonuses, effects], idx) => ({
    id: `pas-${prefix}-${String(idx + 1).padStart(2, '0')}`,
    name,
    tier,
    description,
    ...bonuses,
    ...(effects ? { effects } : {}),
  })),
);

const PASSIVE_BY_ID = new Map<string, PassiveSkill>(PASSIVE_SKILL_POOL.map((p) => [p.id, p]));

export interface ComputedPassiveModifiers {
  bonusHp: number;
  bonusMp: number;
  bonusAc: number;
  bonusDr: number;
  bonusSpeedSpaces: number;
  bonusInitiative: number;
  actFirstInInitiative: boolean;
  allAttributesInCombat: number;
  bonusAttackHit: number;
  bonusMeleeHit: number;
  bonusRangedHit: number;
  bonusSpellHit: number;
  bonusReactionSpellHit: number;
  round1HitBonus: number;
  critThreshold: number | null;
  critMultiplier: number | null;
  bonusCritDamage: number;
  bonusCritDice: string[];
  rerollNat1PerCombat: boolean;
  turnMissToHitPerCombat: boolean;
  bonusWeaponDamage: number;
  bonusMeleeDamage: number;
  bonusRangedDamage: number;
  bonusSpellPower: number;
  bonusElementalSpellDamage: number;
  elementalBonusDamage: Record<string, number>;
  elementalBonusDice: Record<string, string[]>;
  bonusWeaponDice: string[];
  bonusSpellDice: string[];
  ignoreEnemyDr: number;
  ignoreAllEnemyDr: boolean;
  shredEnemyDr: number;
  secondAttackBonusDamage: number;
  round1DamageBonus: number;
  lowHpDamageBonus: number;
  lowHpThresholdPct: number;
  executeBonusDice: string[];
  moveChargeBonusDice: string[];
  damageBonusVsLowLevel: number;
  damageBonusVsHighDr: number;
  damageBonusVsBossPct: number;
  bonusWeaponAttackOnCrit: boolean;
  hitAdditionalNearbyFoe: boolean;
  bonusRangedRangeSpaces: number;
  bonusSpellRangeSpaces: number;
  bonusObserveRangeSpaces: number;
  round1MoveBonus: number;
  ignoreDifficultTerrain: boolean;
  spellMpDiscount: number;
  zeroCostFirstSpell: boolean;
  zeroCostAllSpells: boolean;
  spellEchoPct: number;
  spellHealOnCast: Record<string, number>;
  spellMpOnHit: Record<string, number>;
  spellTempDrOnCast: Record<string, number>;
  spellMoveOnCast: Record<string, number>;
  spellLifestealHp: Record<string, number>;
  spellLifestealPct: number;
  bonusReactionSpellDice: string[];
  aoeAllEnemiesWithin4Spaces: boolean;
  hpRegenPerTurn: number;
  mpRegenPerTurn: number;
  evasionPct: number;
  firstHitHalved: boolean;
  reflectDamageOnHit: number;
  reflectOneAttackPerCombat: boolean;
  bonusParryRoll: number;
  parryReflectPct: number;
  bonusCounterDamage: number;
  extraReactionPerRound: number;
  surviveFatalPerCombat: boolean;
  undyingLegendPerCombat: boolean;
  revivePerCombatPct: number;
  reviveMpAlso: boolean;
  rangedAndSpellAc: number;
  critDamageReduction: number;
  elementalResists: Record<string, number>;
  allElementalResist: number;
  spellDmgResist: number;
  slashingResist: number;
  adaptiveWardDr: number;
  lifestealMeleePct: number;
  lifestealAllPct: number;
  hpOnKill: number;
  mpOnKill: number;
  tempHpOnKill: number;
  restSpotBonusHp: number;
  restSpotBonusMp: number;
  restSpotTempHp: number;
  consumableBonusHp: number;
  consumableBonusMp: number;
  healingReceivedBonus: number;
  bonusGoldPct: number;
  chestBonusGold: number;
  deityFavorDiscount: number;
  auraAllyHitBonus: number;
  auraAllyDmgBonus: number;
  auraAllyAcDr: number;
  auraEnemyHitPenalty: number;
  perCheckBonus: number;
  statusImmune: boolean;
  knockbackImmune: boolean;
  specialNotes: string[];
}

export function computePassiveModifiers(
  passivesOrChar: PassiveSkill[] | Partial<Character> | null | undefined,
  character?: Partial<Character> | null,
): ComputedPassiveModifiers {
  const ch = Array.isArray(passivesOrChar) ? character : passivesOrChar;
  const passives = Array.isArray(passivesOrChar) ? passivesOrChar : passivesOrChar?.passives || [];

  const eq = ch?.equipment;
  const hasShield = Boolean(eq?.offHand);
  const bodyArmor = eq?.body;
  const hasBodyArmor = Boolean(bodyArmor);
  const isLightArmor = Boolean(bodyArmor && (/light|leather|robe|cloth|cloak/i.test(bodyArmor.name || '') || Number(bodyArmor.acBonus || 0) <= 2));

  const out: ComputedPassiveModifiers = {
    bonusHp: 0,
    bonusMp: 0,
    bonusAc: 0,
    bonusDr: 0,
    bonusSpeedSpaces: 0,
    bonusInitiative: 0,
    actFirstInInitiative: false,
    allAttributesInCombat: 0,
    bonusAttackHit: 0,
    bonusMeleeHit: 0,
    bonusRangedHit: 0,
    bonusSpellHit: 0,
    bonusReactionSpellHit: 0,
    round1HitBonus: 0,
    critThreshold: null,
    critMultiplier: null,
    bonusCritDamage: 0,
    bonusCritDice: [],
    rerollNat1PerCombat: false,
    turnMissToHitPerCombat: false,
    bonusWeaponDamage: 0,
    bonusMeleeDamage: 0,
    bonusRangedDamage: 0,
    bonusSpellPower: 0,
    bonusElementalSpellDamage: 0,
    elementalBonusDamage: {},
    elementalBonusDice: {},
    bonusWeaponDice: [],
    bonusSpellDice: [],
    ignoreEnemyDr: 0,
    ignoreAllEnemyDr: false,
    shredEnemyDr: 0,
    secondAttackBonusDamage: 0,
    round1DamageBonus: 0,
    lowHpDamageBonus: 0,
    lowHpThresholdPct: 0,
    executeBonusDice: [],
    moveChargeBonusDice: [],
    damageBonusVsLowLevel: 0,
    damageBonusVsHighDr: 0,
    damageBonusVsBossPct: 0,
    bonusWeaponAttackOnCrit: false,
    hitAdditionalNearbyFoe: false,
    bonusRangedRangeSpaces: 0,
    bonusSpellRangeSpaces: 0,
    bonusObserveRangeSpaces: 0,
    round1MoveBonus: 0,
    ignoreDifficultTerrain: false,
    spellMpDiscount: 0,
    zeroCostFirstSpell: false,
    zeroCostAllSpells: false,
    spellEchoPct: 0,
    spellHealOnCast: {},
    spellMpOnHit: {},
    spellTempDrOnCast: {},
    spellMoveOnCast: {},
    spellLifestealHp: {},
    spellLifestealPct: 0,
    bonusReactionSpellDice: [],
    aoeAllEnemiesWithin4Spaces: false,
    hpRegenPerTurn: 0,
    mpRegenPerTurn: 0,
    evasionPct: 0,
    firstHitHalved: false,
    reflectDamageOnHit: 0,
    reflectOneAttackPerCombat: false,
    bonusParryRoll: 0,
    parryReflectPct: 0,
    bonusCounterDamage: 0,
    extraReactionPerRound: 0,
    surviveFatalPerCombat: false,
    undyingLegendPerCombat: false,
    revivePerCombatPct: 0,
    reviveMpAlso: false,
    rangedAndSpellAc: 0,
    critDamageReduction: 0,
    elementalResists: {},
    allElementalResist: 0,
    spellDmgResist: 0,
    slashingResist: 0,
    adaptiveWardDr: 0,
    lifestealMeleePct: 0,
    lifestealAllPct: 0,
    hpOnKill: 0,
    mpOnKill: 0,
    tempHpOnKill: 0,
    restSpotBonusHp: 0,
    restSpotBonusMp: 0,
    restSpotTempHp: 0,
    consumableBonusHp: 0,
    consumableBonusMp: 0,
    healingReceivedBonus: 0,
    bonusGoldPct: 0,
    chestBonusGold: 0,
    deityFavorDiscount: 0,
    auraAllyHitBonus: 0,
    auraAllyDmgBonus: 0,
    auraAllyAcDr: 0,
    auraEnemyHitPenalty: 0,
    perCheckBonus: 0,
    statusImmune: false,
    knockbackImmune: false,
    specialNotes: [],
  };

  for (const raw of passives) {
    const canonical = PASSIVE_BY_ID.get(raw.id);
    const mult = Number(raw.multiplierPct || 100) / 100;
    const scale = (n?: number) => (n ? Math.round(Number(n) * mult) : 0);

    out.bonusHp += scale(canonical?.bonusHp ?? raw.bonusHp);
    out.bonusMp += scale(canonical?.bonusMp ?? raw.bonusMp);
    out.bonusAc += scale(canonical?.bonusAc ?? raw.bonusAc);
    out.bonusDr += scale(canonical?.bonusDr ?? raw.bonusDr);
    out.bonusSpeedSpaces += scale(canonical?.bonusSpeedSpaces ?? raw.bonusSpeedSpaces);

    const fx = canonical?.effects || raw.effects;
    if (!fx) continue;

    if (fx.requiresShieldDr && hasShield) out.bonusDr += scale(fx.requiresShieldDr);
    if (fx.requiresLightArmorHp && isLightArmor) out.bonusHp += scale(fx.requiresLightArmorHp);
    if (fx.requiresLightArmorInit && isLightArmor) out.bonusInitiative += scale(fx.requiresLightArmorInit);
    if (fx.requiresBodyArmorAc && hasBodyArmor) out.bonusAc += scale(fx.requiresBodyArmorAc);
    if (fx.requiresBodyArmorDr && hasBodyArmor) out.bonusDr += scale(fx.requiresBodyArmorDr);
    if (fx.requiresUnarmoredAc && !hasBodyArmor) out.bonusAc += scale(fx.requiresUnarmoredAc);

    out.rangedAndSpellAc += scale(fx.rangedAndSpellAc);
    out.critDamageReduction += scale(fx.critDamageReduction);
    out.bonusInitiative += scale(fx.bonusInitiative);
    if (fx.actFirstInInitiative) out.actFirstInInitiative = true;
    out.allAttributesInCombat += scale(fx.allAttributesInCombat);

    out.bonusAttackHit += scale(fx.bonusAttackHit);
    out.bonusMeleeHit += scale(fx.bonusMeleeHit);
    out.bonusRangedHit += scale(fx.bonusRangedHit);
    out.bonusSpellHit += scale(fx.bonusSpellHit);
    out.bonusReactionSpellHit += scale(fx.bonusReactionSpellHit);
    out.round1HitBonus += scale(fx.round1HitBonus);
    if (fx.critThreshold) {
      out.critThreshold = out.critThreshold === null ? fx.critThreshold : Math.min(out.critThreshold, fx.critThreshold);
    }
    if (fx.critMultiplier) {
      out.critMultiplier = out.critMultiplier === null ? fx.critMultiplier : Math.max(out.critMultiplier, fx.critMultiplier);
    }
    out.bonusCritDamage += scale(fx.bonusCritDamage);
    if (fx.bonusCritDice) out.bonusCritDice.push(fx.bonusCritDice);
    if (fx.rerollNat1PerCombat) out.rerollNat1PerCombat = true;
    if (fx.turnMissToHitPerCombat) out.turnMissToHitPerCombat = true;

    out.bonusWeaponDamage += scale(fx.bonusWeaponDamage);
    out.bonusMeleeDamage += scale(fx.bonusMeleeDamage);
    out.bonusRangedDamage += scale(fx.bonusRangedDamage);
    out.bonusSpellPower += scale(fx.bonusSpellPower);
    out.bonusElementalSpellDamage += scale(fx.bonusElementalSpellDamage);
    if (fx.elementalBonusDamage) {
      for (const [el, val] of Object.entries(fx.elementalBonusDamage)) {
        out.elementalBonusDamage[el] = (out.elementalBonusDamage[el] || 0) + scale(val);
      }
    }
    if (fx.elementalBonusDice) {
      for (const [el, dice] of Object.entries(fx.elementalBonusDice)) {
        out.elementalBonusDice[el] = out.elementalBonusDice[el] || [];
        out.elementalBonusDice[el].push(dice);
      }
    }
    if (fx.bonusWeaponDice) out.bonusWeaponDice.push(fx.bonusWeaponDice);
    if (fx.bonusSpellDice) out.bonusSpellDice.push(fx.bonusSpellDice);
    out.ignoreEnemyDr += scale(fx.ignoreEnemyDr);
    if (fx.ignoreAllEnemyDr) out.ignoreAllEnemyDr = true;
    out.shredEnemyDr += scale(fx.shredEnemyDr);
    out.secondAttackBonusDamage += scale(fx.secondAttackBonusDamage);
    out.round1DamageBonus += scale(fx.round1DamageBonus);
    if (fx.lowHpDamageBonus) {
      out.lowHpDamageBonus += scale(fx.lowHpDamageBonus);
      out.lowHpThresholdPct = Math.max(out.lowHpThresholdPct, Number(fx.lowHpThresholdPct || 50));
    }
    if (fx.executeBonusDice) out.executeBonusDice.push(fx.executeBonusDice);
    if (fx.moveChargeBonusDice) out.moveChargeBonusDice.push(fx.moveChargeBonusDice);
    out.damageBonusVsLowLevel += scale(fx.damageBonusVsLowLevel);
    out.damageBonusVsHighDr += scale(fx.damageBonusVsHighDr);
    out.damageBonusVsBossPct += scale(fx.damageBonusVsBossPct);
    if (fx.bonusWeaponAttackOnCrit) out.bonusWeaponAttackOnCrit = true;
    if (fx.hitAdditionalNearbyFoe) out.hitAdditionalNearbyFoe = true;

    out.bonusRangedRangeSpaces += scale(fx.bonusRangedRangeSpaces);
    out.bonusSpellRangeSpaces += scale(fx.bonusSpellRangeSpaces);
    out.bonusObserveRangeSpaces += scale(fx.bonusObserveRangeSpaces);
    out.round1MoveBonus += scale(fx.round1MoveBonus);
    if (fx.ignoreDifficultTerrain) out.ignoreDifficultTerrain = true;

    out.spellMpDiscount += scale(fx.spellMpDiscount);
    if (fx.zeroCostFirstSpell) out.zeroCostFirstSpell = true;
    if (fx.zeroCostAllSpells) out.zeroCostAllSpells = true;
    out.spellEchoPct = Math.min(80, out.spellEchoPct + scale(fx.spellEchoPct));
    if (fx.spellHealOnCast) {
      for (const [el, val] of Object.entries(fx.spellHealOnCast)) {
        out.spellHealOnCast[el] = (out.spellHealOnCast[el] || 0) + scale(val);
      }
    }
    if (fx.spellMpOnHit) {
      for (const [el, val] of Object.entries(fx.spellMpOnHit)) {
        out.spellMpOnHit[el] = (out.spellMpOnHit[el] || 0) + scale(val);
      }
    }
    if (fx.spellTempDrOnCast) {
      for (const [el, val] of Object.entries(fx.spellTempDrOnCast)) {
        out.spellTempDrOnCast[el] = (out.spellTempDrOnCast[el] || 0) + scale(val);
      }
    }
    if (fx.spellMoveOnCast) {
      for (const [el, val] of Object.entries(fx.spellMoveOnCast)) {
        out.spellMoveOnCast[el] = (out.spellMoveOnCast[el] || 0) + scale(val);
      }
    }
    if (fx.spellLifestealHp) {
      for (const [el, val] of Object.entries(fx.spellLifestealHp)) {
        out.spellLifestealHp[el] = (out.spellLifestealHp[el] || 0) + scale(val);
      }
    }
    out.spellLifestealPct += scale(fx.spellLifestealPct);
    if (fx.bonusReactionSpellDice) out.bonusReactionSpellDice.push(fx.bonusReactionSpellDice);
    if (fx.aoeAllEnemiesWithin4Spaces) out.aoeAllEnemiesWithin4Spaces = true;

    out.hpRegenPerTurn += scale(fx.hpRegenPerTurn);
    out.mpRegenPerTurn += scale(fx.mpRegenPerTurn);
    out.evasionPct = Math.min(75, out.evasionPct + scale(fx.evasionPct));
    if (fx.firstHitHalved) out.firstHitHalved = true;
    out.reflectDamageOnHit += scale(fx.reflectDamageOnHit);
    if (fx.reflectOneAttackPerCombat) out.reflectOneAttackPerCombat = true;
    out.bonusParryRoll += scale(fx.bonusParryRoll);
    out.parryReflectPct = Math.max(out.parryReflectPct, scale(fx.parryReflectPct));
    out.bonusCounterDamage += scale(fx.bonusCounterDamage);
    out.extraReactionPerRound += scale(fx.extraReactionPerRound);
    if (fx.surviveFatalPerCombat) out.surviveFatalPerCombat = true;
    if (fx.undyingLegendPerCombat) out.undyingLegendPerCombat = true;
    out.revivePerCombatPct = Math.max(out.revivePerCombatPct, Number(fx.revivePerCombatPct || 0));
    if (fx.reviveMpAlso) out.reviveMpAlso = true;

    if (fx.elementalResists) {
      for (const [el, val] of Object.entries(fx.elementalResists)) {
        out.elementalResists[el] = (out.elementalResists[el] || 0) + scale(val);
      }
    }
    out.allElementalResist += scale(fx.allElementalResist);
    out.spellDmgResist += scale(fx.spellDmgResist);
    out.slashingResist += scale(fx.slashingResist);
    out.adaptiveWardDr += scale(fx.adaptiveWardDr);
    out.lifestealMeleePct += scale(fx.lifestealMeleePct);
    out.lifestealAllPct += scale(fx.lifestealAllPct);
    out.hpOnKill += scale(fx.hpOnKill);
    out.mpOnKill += scale(fx.mpOnKill);
    out.tempHpOnKill += scale(fx.tempHpOnKill);

    out.restSpotBonusHp += scale(fx.restSpotBonusHp);
    out.restSpotBonusMp += scale(fx.restSpotBonusMp);
    out.restSpotTempHp += scale(fx.restSpotTempHp);
    out.consumableBonusHp += scale(fx.consumableBonusHp);
    out.consumableBonusMp += scale(fx.consumableBonusMp);
    out.healingReceivedBonus += scale(fx.healingReceivedBonus);
    out.bonusGoldPct += scale(fx.bonusGoldPct);
    out.chestBonusGold += scale(fx.chestBonusGold);
    out.deityFavorDiscount += scale(fx.deityFavorDiscount);

    out.auraAllyHitBonus += scale(fx.auraAllyHitBonus);
    out.auraAllyDmgBonus += scale(fx.auraAllyDmgBonus);
    out.auraAllyAcDr += scale(fx.auraAllyAcDr);
    out.auraEnemyHitPenalty += scale(fx.auraEnemyHitPenalty);
    out.perCheckBonus += scale(fx.perCheckBonus);
    if (fx.statusImmune) out.statusImmune = true;
    if (fx.knockbackImmune) out.knockbackImmune = true;
    if (fx.skillCheckNote && !out.specialNotes.includes(fx.skillCheckNote)) {
      out.specialNotes.push(fx.skillCheckNote);
    }
  }

  return out;
}

export function sampleWeightedPassive(pool: PassiveSkill[] = PASSIVE_SKILL_POOL): PassiveSkill {
  const byTier: Record<string, PassiveSkill[]> = {};
  for (const p of pool) {
    if (!byTier[p.tier]) byTier[p.tier] = [];
    byTier[p.tier].push(p);
  }
  const entries = Object.entries(PASSIVE_GACHA_ODDS).filter(([t]) => byTier[t]?.length);
  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * totalWeight;
  let pickedTier = entries[0]?.[0] || 'Normal';
  for (const [tier, w] of entries) {
    r -= w;
    if (r <= 0) {
      pickedTier = tier;
      break;
    }
  }
  const tierList = byTier[pickedTier] || pool;
  return tierList[Math.floor(Math.random() * tierList.length)] || pool[0];
}

export function summarizePassiveBonuses(passives: PassiveSkill[] = []): {
  bonusHp: number;
  bonusMp: number;
  bonusAc: number;
  bonusDr: number;
  bonusSpeedSpaces: number;
} {
  const mods = computePassiveModifiers(passives);
  return {
    bonusHp: mods.bonusHp,
    bonusMp: mods.bonusMp,
    bonusAc: mods.bonusAc,
    bonusDr: mods.bonusDr,
    bonusSpeedSpaces: mods.bonusSpeedSpaces,
  };
}
