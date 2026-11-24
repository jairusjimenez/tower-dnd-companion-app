export type UserRole = 'dm' | 'player';
export type CombatMode = 'reactive' | 'turn_based';
export type SessionStatus = 'active' | 'stopped' | 'paused';
export type SpellElement = 'Fire' | 'Earth' | 'Wind' | 'Water' | 'Light' | 'Dark';
export type EquipmentSlot = 'mainHand' | 'offHand' | 'head' | 'body' | 'boots' | 'relic';
export type ArenaBiome = string;
export type TerrainType = 'tree' | 'rock' | 'boulder' | 'water' | 'crystal' | 'pillar' | 'lava' | 'ice';
export const VALID_TERRAIN_TYPES: TerrainType[] = ['tree', 'rock', 'boulder', 'water', 'crystal', 'pillar', 'lava', 'ice'];
export type PassiveTier =
  | 'Normal'
  | 'Advanced'
  | 'Rare'
  | 'Super Rare'
  | 'Super Super Rare'
  | 'Legendary'
  | 'Mythic';

export type UnitEffectKind =
  | 'shield'
  | 'empower'
  | 'haste'
  | 'regen'
  | 'burn'
  | 'poison'
  | 'bleed'
  | 'armor_break'
  | 'weaken'
  | 'slow'
  | 'stun';

import type { TokenIconId } from './tokenIcons';

export interface UnitEffectSpec {
  kind: UnitEffectKind;
  potency: number;
  duration: number;
  target?: 'enemy' | 'self' | 'ally' | 'all_allies';
}

export interface ActiveUnitEffect {
  id: string;
  kind: UnitEffectKind;
  category: 'buff' | 'debuff';
  name: string;
  potency: number;
  turnsRemaining: number;
  sourceName?: string;
  sourceCharacterId?: string;
}

export interface EquipmentItem {
  id: string;
  name: string;
  slot: EquipmentSlot | '';
  type: 'weapon' | 'armor' | 'relic' | string;
  attackBonus: number;
  damageDice: string;
  damageType: string;
  rangeSpaces: number;
  attackArea?: AttackArea;
  attackAreaModifier?: number;
  healFormula?: string;
  effectSpec?: UnitEffectSpec | null;
  drBonus: number;
  acBonus: number;
  artUrl?: string;
  notes?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: 'consumable' | 'weapon' | 'armor' | 'relic' | 'skill_book' | 'material' | string;
  type?: string;
  qty: number;
  healHp?: number;
  healMp?: number;
  grantXp?: number;
  slot?: EquipmentSlot | '';
  attackBonus?: number;
  damageDice?: string;
  damageType?: string;
  rangeSpaces?: number;
  attackArea?: AttackArea;
  attackAreaModifier?: number;
  healFormula?: string;
  effectSpec?: UnitEffectSpec | null;
  drBonus?: number;
  acBonus?: number;
  artUrl?: string;
  notes?: string;
}

export interface Spell {
  id: string;
  name: string;
  element: SpellElement;
  mpCost: number;
  damageDice: string;
  damageType: string;
  rangeSpaces: number;
  areaText: string;
  attackArea?: AttackArea;
  attackAreaModifier?: number;
  healFormula?: string;
  effectSpec?: UnitEffectSpec | null;
  spellCategory?: 'damage' | 'utility';
  scalesWithLevel?: boolean;
  actionType: 'Action' | 'Reaction' | string;
  explanation: string;
}

export interface SpellCraftLimits {
  floor: number;
  maxDice: number;
  maxSides: number;
  maxBonus: number;
  maxRange: number;
}

export interface CharacterSkill {
  id?: string;
  name: string;
  stat?: string;
  bonus?: number;
  rank?: string;
  mpCost?: number;
  cooldown?: string;
  description?: string;
  unlockedByStat?: string;
  attackArea?: AttackArea;
  attackAreaModifier?: number;
  healFormula?: string;
  effectSpec?: UnitEffectSpec | null;
}

export interface PassiveEffects {
  // Conditional AC / DR
  requiresShieldDr?: number;
  requiresLightArmorHp?: number;
  requiresLightArmorInit?: number;
  requiresBodyArmorAc?: number;
  requiresBodyArmorDr?: number;
  requiresUnarmoredAc?: number;
  rangedAndSpellAc?: number;
  critDamageReduction?: number;
  // Initiative & Attributes
  bonusInitiative?: number;
  actFirstInInitiative?: boolean;
  allAttributesInCombat?: number;
  // Hit & Crit
  bonusAttackHit?: number;
  bonusMeleeHit?: number;
  bonusRangedHit?: number;
  bonusSpellHit?: number;
  bonusReactionSpellHit?: number;
  round1HitBonus?: number;
  critThreshold?: number;
  critMultiplier?: number;
  bonusCritDamage?: number;
  bonusCritDice?: string;
  rerollNat1PerCombat?: boolean;
  turnMissToHitPerCombat?: boolean;
  // Damage
  bonusWeaponDamage?: number;
  bonusMeleeDamage?: number;
  bonusRangedDamage?: number;
  bonusSpellPower?: number;
  bonusElementalSpellDamage?: number;
  elementalBonusDamage?: Record<string, number>;
  elementalBonusDice?: Record<string, string>;
  bonusWeaponDice?: string;
  bonusSpellDice?: string;
  ignoreEnemyDr?: number;
  ignoreAllEnemyDr?: boolean;
  shredEnemyDr?: number;
  secondAttackBonusDamage?: number;
  round1DamageBonus?: number;
  lowHpDamageBonus?: number;
  lowHpThresholdPct?: number;
  executeBonusDice?: string;
  moveChargeBonusDice?: string;
  damageBonusVsLowLevel?: number;
  damageBonusVsHighDr?: number;
  damageBonusVsBossPct?: number;
  bonusWeaponAttackOnCrit?: boolean;
  hitAdditionalNearbyFoe?: boolean;
  // Range & Movement
  bonusRangedRangeSpaces?: number;
  bonusSpellRangeSpaces?: number;
  bonusObserveRangeSpaces?: number;
  round1MoveBonus?: number;
  ignoreDifficultTerrain?: boolean;
  // Spell Economy & Casting
  spellMpDiscount?: number;
  zeroCostFirstSpell?: boolean;
  zeroCostAllSpells?: boolean;
  spellEchoPct?: number;
  spellHealOnCast?: Record<string, number>;
  spellMpOnHit?: Record<string, number>;
  spellTempDrOnCast?: Record<string, number>;
  spellMoveOnCast?: Record<string, number>;
  spellLifestealHp?: Record<string, number>;
  spellLifestealPct?: number;
  bonusReactionSpellDice?: string;
  aoeAllEnemiesWithin4Spaces?: boolean;
  // Regen, Defense, Survival & Reactions
  hpRegenPerTurn?: number;
  mpRegenPerTurn?: number;
  evasionPct?: number;
  firstHitHalved?: boolean;
  reflectDamageOnHit?: number;
  reflectOneAttackPerCombat?: boolean;
  bonusParryRoll?: number;
  parryReflectPct?: number;
  bonusCounterDamage?: number;
  extraReactionPerRound?: number;
  surviveFatalPerCombat?: boolean;
  undyingLegendPerCombat?: boolean;
  revivePerCombatPct?: number;
  reviveMpAlso?: boolean;
  elementalResists?: Record<string, number>;
  allElementalResist?: number;
  spellDmgResist?: number;
  slashingResist?: number;
  adaptiveWardDr?: number;
  lifestealMeleePct?: number;
  lifestealAllPct?: number;
  hpOnKill?: number;
  mpOnKill?: number;
  tempHpOnKill?: number;
  // Rest Spots, Consumables, Gold & Deities
  restSpotBonusHp?: number;
  restSpotBonusMp?: number;
  restSpotTempHp?: number;
  consumableBonusHp?: number;
  consumableBonusMp?: number;
  healingReceivedBonus?: number;
  bonusGoldPct?: number;
  chestBonusGold?: number;
  deityFavorDiscount?: number;
  // Auras & Checks
  auraAllyHitBonus?: number;
  auraAllyDmgBonus?: number;
  auraAllyAcDr?: number;
  auraEnemyHitPenalty?: number;
  perCheckBonus?: number;
  statusImmune?: boolean;
  knockbackImmune?: boolean;
  skillCheckNote?: string;
}

export interface PassiveSkill {
  id: string;
  name: string;
  tier: PassiveTier;
  description: string;
  bonusAc?: number;
  bonusDr?: number;
  bonusHp?: number;
  bonusMp?: number;
  bonusSpeedSpaces?: number;
  effects?: PassiveEffects;
  stacks?: number;
  multiplierPct?: number;
  acquiredAt?: string;
  lastUpgradedAt?: string;
  levelAcquired?: number;
}

export interface PendingPassiveDraw {
  id: string;
  tier: PassiveTier;
  skill: PassiveSkill;
  duplicate: boolean;
  nextStacks: number;
  extraPct: number;
  multiplierPct: number;
  floorLevel: number;
  declineGold: number;
  declineXp: number;
}

export interface ObservedWeakSpot {
  monsterId: string;
  monsterName: string;
  floor: number;
  bonusDamage: number;
  bonusCritDamage: number;
  discoveredAt: string;
}

export interface StatMilestone {
  id: string;
  statKey: string;
  threshold: number;
  abilityName: string;
  bonusHp: number;
  bonusMp: number;
  bonusAc: number;
  bonusDr: number;
  description: string;
}

export interface ArtHistoryEntry {
  id: string;
  prompt: string;
  style: string;
  engine?: string;
  url: string;
  createdAt: string;
}

export interface PlayerHistoryEntry {
  id: string;
  timestamp: string;
  characterId: string | null;
  characterName: string;
  category: string;
  summary: string;
}

export interface Character {
  id: string;
  name: string;
  race: string;
  className: string;
  rank: string;
  level: number;
  xp: number;
  xpToNext: number;
  unspentStatPoints: number;
  statsConfirmed?: boolean;
  passiveTickets: number;
  passives: PassiveSkill[];
  pendingPassiveDraw?: PendingPassiveDraw | null;
  awakenings?: string[];
  hp: number;
  maxHp: number;
  tempHp: number;
  mp: number;
  maxMp: number;
  ac: number;
  dr: number;
  speed: number;
  speedSpaces: number;
  currentFloor?: number;
  patronDeityId: string;
  favor: number;
  inspiration: boolean;
  stats: Record<string, number>;
  skills: CharacterSkill[];
  spells: Spell[];
  starterEquipmentChosen?: boolean;
  equipment: Record<EquipmentSlot, EquipmentItem | null>;
  inventory: InventoryItem[];
  currency: { gold: number; manaStones: number };
  conditions: string[];
  notes: string;
  portraitPrompt: string;
  portraitStyle: string;
  portraitUrl: string;
  artHistory: ArtHistoryEntry[];
  history?: PlayerHistoryEntry[];
  observedWeakSpots?: Record<string, ObservedWeakSpot>;
  observedMonsterIds?: string[];
  activeEffects?: ActiveUnitEffect[];
  combatPassiveFlags?: {
    lastDamageType?: string;
    hitsTakenThisRound?: number;
    spellsCastThisCombat?: number;
    revivedThisCombat?: boolean;
    survivedFatalThisCombat?: boolean;
    rerolledNat1ThisCombat?: boolean;
    luckyStarUsedThisCombat?: boolean;
    divineMirrorUsedThisCombat?: boolean;
    undyingLegendRounds?: number;
    undyingLegendUsedThisCombat?: boolean;
    tempDrBonus?: number;
  };
}

export interface MonsterDefeatSummary {
  id?: string;
  monsterId: string;
  monsterName: string;
  floor: number;
  killerName: string;
  killerCharacterId?: string;
  defeatCause?: string;
  xpGained: number;
  goldGained: number;
  manaStonesGained: number;
  manaStoneDroppedOnMap?: boolean;
  chestDropped?: { name: string; tier: ChestTier; x: number; y: number } | null;
  items: Array<{ name: string; category: string; tier?: ChestTier; notes?: string }>;
  leveledUp?: boolean;
  newLevel?: number;
}

export interface MonsterLoot {
  itemName: string;
  itemCategory: string;
  gold: number;
  manaStones: number;
  xp: number;
  dropped: boolean;
}

export type MonsterAttackArea =
  | 'single'
  | 'around_1'
  | 'line_3'
  | 'cleave_3'
  | 'cone_3'
  | 'around_2'
  | 'ranged_aoe';

export type AttackArea = MonsterAttackArea;

export interface MonsterSkill {
  id: string;
  name: string;
  damageFormula: string;
  attackBonus: number;
  baseUsesPerCombat: number;
  maxUsesPerCombat: number;
  usesRemaining: number;
  minFloor?: number;
  description?: string;
  attackArea?: MonsterAttackArea;
  attackAreaModifier?: number;
  healFormula?: string;
  effectSpec?: UnitEffectSpec | null;
}

export interface Monster {
  id: string;
  name: string;
  floor: number;
  hp: number | null;
  maxHp: number | null;
  ac: number;
  dr: number;
  agi?: number;
  rangeSpaces: number;
  iconId?: TokenIconId;
  attackArea?: MonsterAttackArea;
  attackAreaModifier?: number;
  healFormula?: string;
  effectSpec?: UnitEffectSpec | null;
  activeEffects?: ActiveUnitEffect[];
  attackFormula: string;
  damageFormula: string;
  hiddenFromPlayers: boolean;
  conditions: string[];
  notes: string;
  healthTier?: string;
  dropsChest?: boolean;
  chestTier?: ChestTier;
  loot: MonsterLoot;
  skills?: MonsterSkill[];
  observedByViewer?: boolean;
  hpPct?: number;
  hpBarTicks?: Array<{ pct: number; major: boolean }>;
}

export type ChestTier = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';

export interface ChestTierConfig {
  tier: ChestTier;
  minItems: number;
  maxItems: number;
  baseGold: number;
  baseManaStones: number;
  pool: BestiaryLootDrop[];
}

export interface ChestPassiveTrigger {
  skillName: string;
  tier: string;
  effectText: string;
  bonusGold: number;
}

export interface ChestLootSummary {
  chestId: string;
  chestName: string;
  tier: ChestTier;
  openerName: string;
  baseGold?: number;
  passiveBonusGold?: number;
  goldGained: number;
  manaStonesGained: number;
  items: Array<{ name: string; category: string; tier?: ChestTier; notes?: string }>;
  passiveTriggers?: ChestPassiveTrigger[];
}

export interface TreasureEntry {
  id: string;
  name: string;
  category: 'weapon' | 'armor' | 'relic' | 'skill_book' | 'consumable';
  tier?: ChestTier;
  origin?: 'Manhwa' | 'D&D' | 'Custom';
  floorLevel: number;
  slot?: EquipmentSlot | '';
  attackBonus: number;
  damageDice: string;
  acBonus: number;
  drBonus: number;
  baseGold: number;
  baseManaStones: number;
  notes?: string;
}

export interface NpcAppearance {
  floor: number;
  beatTitle: string;
  beatId?: string;
}

export interface NpcEntry {
  id: string;
  name: string;
  role: string;
  origin?: 'Manhwa' | 'D&D' | 'Custom';
  level: number;
  firstAppearedFloor: number;
  stats: Record<string, number>;
  maxHp: number;
  ac: number;
  story: string;
  dialogue: string;
  appearances?: NpcAppearance[];
}

export interface BestiaryLootDrop {
  itemName: string;
  category: 'weapon' | 'armor' | 'consumable' | 'relic' | 'material';
  tier?: ChestTier;
  dropChancePct: number;
  baseGold: number;
  baseManaStones: number;
  minFloor?: number;
  notes?: string;
}

export interface BestiaryEntry {
  id: string;
  name: string;
  category?: 'Manhwa' | 'D&D' | 'Boss' | 'Custom';
  maxHp: number;
  ac: number;
  dr: number;
  attackFormula: string;
  damageFormula: string;
  rangeSpaces: number;
  iconId?: TokenIconId;
  attackArea?: MonsterAttackArea;
  attackAreaModifier?: number;
  healFormula?: string;
  effectSpec?: UnitEffectSpec | null;
  notes?: string;
  lootTable?: BestiaryLootDrop[];
  skills?: MonsterSkill[];
  dropsChest?: boolean;
  chestTier?: ChestTier;
}

export interface MapToken {
  id: string;
  name: string;
  x: number;
  y: number;
  color: string;
  type: 'player' | 'monster' | 'npc' | string;
  hp: number | null;
  maxHp: number | null;
  hiddenFromPlayers?: boolean;
  label?: string;
  iconId?: TokenIconId;
  hasMovedThisTurn?: boolean;
  hasObservedThisTurn?: boolean;
  hasUsedConsumableThisTurn?: boolean;
  hasCastSpellThisTurn?: boolean;
  attacksUsedThisTurn?: number;
  activeEffects?: ActiveUnitEffect[];
  // NPC-specific metadata
  npcRole?: string;
  dialogue?: string;
  rewardType?: string;
  rewardItemName?: string;
  rewardItemCategory?: string;
  rewardSkillDesc?: string;
  rewardXp?: number;
  rewardGold?: number;
  rewardClaimed?: boolean;
}

export interface MapChest {
  id: string;
  name: string;
  tier?: ChestTier;
  x: number;
  y: number;
  gold: number;
  manaStones: number;
  itemName: string;
  itemCategory: string;
  opened: boolean;
  lastLootSummary?: ChestLootSummary;
}

export interface ArenaManaStone {
  id: string;
  x: number;
  y: number;
  qty: number;
  droppedFrom?: string;
}

export interface ArenaTerrainTile {
  x: number;
  y: number;
  type: TerrainType;
  w?: number;
  h?: number;
  featureId?: string;
  isAnchor?: boolean;
}

export interface ArenaRestSpot {
  id: string;
  name: string;
  x: number;
  y: number;
  hpPct: number;
  mpPct: number;
  usedBy?: string[];
}

export interface BeatArena {
  cols: number;
  rows: number;
  biome: ArenaBiome | string;
  terrain: ArenaTerrainTile[];
  tokens: MapToken[];
  chests: MapChest[];
  manaStones?: ArenaManaStone[];
  restSpots?: ArenaRestSpot[];
  startPositions?: Record<string, { x: number; y: number }>;
}

export interface BeatEncounterSpec {
  name: string;
  maxHp: number;
  ac: number;
  dr: number;
  rangeSpaces?: number;
  iconId?: TokenIconId;
  attackArea?: MonsterAttackArea;
  attackAreaModifier?: number;
  attackFormula: string;
  damageFormula: string;
  hiddenFromPlayers?: boolean;
  floor?: number;
  startX?: number | string | null;
  startY?: number | string | null;
  dropsChest?: boolean;
  chestTier?: ChestTier;
  skills?: MonsterSkill[];
}

export interface BeatTreasureSpec {
  id: string;
  name: string;
  category: string;
  qty: number;
  gold: number;
  manaStones: number;
  healHp?: number;
  healMp?: number;
  grantXp?: number;
  slot?: EquipmentSlot | '';
  attackBonus?: number;
  damageDice?: string;
  damageType?: string;
  rangeSpaces?: number;
  drBonus?: number;
  acBonus?: number;
  notes?: string;
}

export interface StoryBeatPromptAnswer {
  id: string;
  characterId: string;
  characterName: string;
  answer: string;
  answeredAt: string;
}

export interface StoryPromptStatCheckResult {
  characterId: string;
  characterName: string;
  statKey: string;
  statScore: number;
  statMod: number;
  floorBonus: number;
  roll: number;
  total: number;
  dc: number;
  passed: boolean;
  rewardSummary?: string;
}

export interface StoryPromptBranch {
  option: string;
  scenario: string;
  dmNote?: string;
  nextQuestion?: string;
  nextOptions?: string[];
  // Stat Check (triggers bonuses relative to floor level)
  statCheckStat?: string;
  statCheckDc?: number;
  // Reward: Treasure or Treasure Chest
  rewardType?: 'none' | 'treasure' | 'chest';
  rewardTreasureId?: string;
  rewardItemName?: string;
  rewardItemCategory?: string;
  rewardChestTier?: ChestTier;
  rewardGold?: number;
  rewardManaStones?: number;
  // Ends in a Combat Story Beat (auto-generates combat beat & resolves current beat)
  endsInCombat?: boolean;
  combatMonsterPresetId?: string;
  combatMonsterQty?: number;
}

export interface StoryBeatPrompt {
  id: string;
  question: string;
  target: 'all' | string;
  targetName: string;
  options?: string[];
  branches?: StoryPromptBranch[];
  triggeredOption?: string;
  triggeredScenario?: string;
  triggeredStatCheckResults?: StoryPromptStatCheckResult[];
  triggeredRewardSummary?: string;
  spawnedCombatBeatId?: string;
  spawnedCombatBeatTitle?: string;
  isFollowUp?: boolean;
  askedAt: string;
  answers: StoryBeatPromptAnswer[];
}

export interface CombatDefeatPenaltyEntry {
  characterId: string;
  characterName: string;
  hpLost: number;
  mpLost: number;
  goldLost: number;
  xpLost: number;
}

export interface CombatDefeatRecord {
  roundExceeded: number;
  maxRounds: number;
  timestamp: string;
  penalties: CombatDefeatPenaltyEntry[];
}

export interface CombatVictoryRecord {
  timestamp: string;
  roundsTaken: number;
  monstersDefeated: number;
  defeatedMonsterNames: string[];
  totalXpGained: number;
  totalGoldGained: number;
  totalManaStonesGained: number;
  itemsLooted: Array<{ name: string; category: string; tier?: string }>;
}

export interface StoryBeat {
  id: string;
  order: number;
  floor: number;
  beatType?: 'narration' | 'combat';
  title: string;
  narration: string;
  dmSecret: string | null;
  presented: boolean;
  status: 'upcoming' | 'active' | 'resolved' | 'failed' | string;
  xpReward: number;
  maxRounds?: number;
  aiDmEnabled?: boolean;
  defeatSummary?: CombatDefeatRecord | null;
  defeatedLog?: MonsterDefeatSummary[];
  victorySummary?: CombatVictoryRecord | null;
  arena: BeatArena;
  encounters: BeatEncounterSpec[];
  treasures: BeatTreasureSpec[];
  prompts?: StoryBeatPrompt[];
}

export interface Deity {
  id: string;
  name: string;
  title: string;
  domain: string;
  alignment: string;
  tenets: string;
  blessingName: string;
  blessingDescription: string;
  boonFormula: string;
  miracleRangeSpaces: number;
  favorCost: number;
  sourceDocUrl?: string;
}

export interface FloorConfig {
  number: number;
  title: string;
  theme: string;
  rowStart: number;
  rowEnd: number;
  safeZone: boolean;
  portalRow: number;
  portalCol: number;
  description: string;
}

export interface MapPing {
  id: string;
  x: number;
  y: number;
  color: string;
  createdAt: number;
}

export interface TowerMapState {
  cols: number;
  rows: number;
  theme: string;
  currentFloor?: number;
  floors: FloorConfig[];
  fog: string[];
  tokens: MapToken[];
  pings: MapPing[];
}

export interface Combatant {
  id: string;
  name: string;
  type: 'player' | 'monster' | string;
  initiative: number;
  initMod?: number;
  hp: number;
  maxHp: number;
  ac: number;
  hiddenFromPlayers?: boolean;
}

export interface PendingReaction {
  id: string;
  createdAt: string;
  monsterId: string;
  monsterName: string;
  skillName?: string;
  targetCharacterId: string;
  targetCharacterName: string;
  targetAc?: number;
  attackNatural?: number;
  attackTotal: number;
  attackFormula?: string;
  attackHit?: boolean;
  attackModifier?: number;
  attackEffectDelta?: number;
  attackAuraPenalty?: number;
  attackCrit?: boolean;
  incomingDamage: number;
  formula: string;
  damageRolls?: number[];
  damageSides?: number;
  damageModifier?: number;
  damageEffectDelta?: number;
  counterDamageRoll?: {
    formula: string;
    rolls: number[];
    sides: number;
    modifier: number;
    total: number;
  } | null;
  // Resolution fields once Player rolls their reaction die (or DM resolves)
  resolved?: boolean;
  resolvedAt?: string;
  playerChoice?: 'react' | 'block' | 'dodge' | 'parry' | 'counter' | 'spell' | 'accept' | string;
  reactionStyle?: 'parry' | 'block' | 'counter';
  spellName?: string;
  spellAccuracyRoll?: {
    natural: number;
    mod: number;
    total: number;
    targetAc: number;
    hit: boolean;
    crit: boolean;
  } | null;
  spellDamageRoll?: {
    formula: string;
    rolls: number[];
    total: number;
  } | null;
  playerRollNatural?: number;
  playerRollMod?: number;
  playerRollTotal?: number;
  playerRollFormula?: string;
  playerSuccess?: boolean;
  dmgTaken?: number;
  counterDamageDealt?: number;
  stunnedEnemy?: boolean;
  bleedApplied?: boolean;
  mitigationPct?: number;
  resolutionSummary?: string;
}

export interface CombatLogEntry {
  id: string;
  timestamp: string;
  attacker: string;
  target: string;
  targetId?: string;
  rawDamage: number;
  finalDamage: number;
  damageType: string;
  isCrit?: boolean;
  rollDetails?: unknown;
  remainingHp: number | null;
  maxHp?: number | null;
  summary: string;
}

export interface MechanicsStatDef {
  key: string;
  name: string;
  defaultValue: number;
}

export interface MechanicsConfig {
  presetName: string;
  combatMode: CombatMode;
  reactionRule: string;
  distanceUnit: string;
  stats: MechanicsStatDef[];
  statFormula: string;
  hitFormula: string;
  damageFormula: string;
  critMultiplier: number;
  critThreshold: number;
  resourceName: string;
  showExactMonsterHpToPlayers: boolean;
  statMilestones: StatMilestone[];
}

export interface RollLogEntry {
  id: string;
  timestamp: string;
  rollerName: string;
  rollerRole: UserRole;
  label: string;
  formula: string;
  count?: number;
  sides?: number;
  rolls: number[];
  dropped: number[];
  modifier: number;
  diceTotal?: number;
  total: number;
  dc?: number;
  passed?: boolean;
  rewardSummary?: string;
  breakdown?: string;
  mode: string;
  isCrit: boolean;
  isFumble: boolean;
  isSecret: boolean;
}

export interface SessionState {
  status: SessionStatus;
  sessionNumber: number;
  title: string;
  pausedMessage: string;
  startedAt: string;
}

export interface PlayerAccountRecord {
  id: string;
  email: string;
  username: string;
  characterId: string;
  activated: boolean;
  salt: string | null;
  passwordHash: string | null;
  invitedAt: string;
  lastLoginAt: string | null;
}

export interface DmAccountRecord {
  email: string;
  username: string;
  activated: boolean;
  salt: string | null;
  passwordHash: string | null;
}

export interface SanitizedPlayerAccount {
  id: string;
  email: string;
  username: string;
  characterId: string;
  activated: boolean;
  invitedAt: string;
  lastLoginAt: string | null;
}

export interface ToastMessage {
  id: string;
  timestamp: string;
  category: string;
  title: string;
  message: string;
  target: string;
  sender: string;
  isDmBroadcast?: boolean;
}

export interface GameNotes {
  dmPrivate: string | null;
  sharedQuests: string;
}

export interface GameState {
  version: number;
  schemaVersion?: number;
  session: SessionState;
  mechanics: MechanicsConfig;
  grimoire: Spell[];
  deities: Deity[];
  characters: Record<string, Character>;
  playerAccounts: Record<string, PlayerAccountRecord>;
  dmAccount: DmAccountRecord;
  monsters: Monster[];
  pendingReactions: PendingReaction[];
  lastResolvedClash?: PendingReaction | null;
  recentMonsterDefeats?: MonsterDefeatSummary[];
  bestiary: BestiaryEntry[];
  npcRoster?: NpcEntry[];
  treasureCatalog?: TreasureEntry[];
  chestCatalog?: Record<ChestTier, ChestTierConfig>;
  map: TowerMapState;
  combat: {
    active: boolean;
    round: number;
    turnIndex: number;
    combatants: Combatant[];
  };
  notes: GameNotes;
  storyBeats: StoryBeat[];
  systemMessages: ToastMessage[];
  combatLog: CombatLogEntry[];
  playerHistory: PlayerHistoryEntry[];
  rollLog: RollLogEntry[];
}

export interface FilteredGameState {
  version: number;
  schemaVersion?: number;
  session: SessionState;
  mechanics: MechanicsConfig;
  passiveGacha: {
    odds: Record<PassiveTier, number>;
    pool: PassiveSkill[];
  };
  grimoire: Spell[];
  deities: Deity[];
  characters: Record<string, Character>;
  playerAccounts: Record<string, SanitizedPlayerAccount>;
  dmAccount: {
    email: string;
    username: string;
    activated: boolean;
  };
  monsters: Monster[];
  pendingReactions: PendingReaction[];
  lastResolvedClash?: PendingReaction | null;
  recentMonsterDefeats?: MonsterDefeatSummary[];
  bestiary: BestiaryEntry[];
  npcRoster?: NpcEntry[];
  treasureCatalog?: TreasureEntry[];
  chestCatalog?: Record<ChestTier, ChestTierConfig>;
  map: TowerMapState;
  combat: GameState['combat'];
  notes: GameNotes;
  storyBeats: StoryBeat[];
  systemMessages: ToastMessage[];
  combatLog: CombatLogEntry[];
  playerHistory: PlayerHistoryEntry[];
  rollLog: RollLogEntry[];
}

export interface SessionIdentity {
  role: UserRole;
  email: string;
  username: string;
  characterId: string | null;
  name?: string;
}

export interface StarterWeaponDef {
  id: string;
  name: string;
  damageDice: string;
  damageType: string;
  attackBonus: number;
  rangeSpaces: number;
  body: { name: string; acBonus: number; drBonus: number };
  offHand?: { name: string; acBonus: number; drBonus: number };
  boots?: { name: string; acBonus: number; drBonus: number };
  head?: { name: string; acBonus: number; drBonus: number };
}
