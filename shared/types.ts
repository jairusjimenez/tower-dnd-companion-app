export type UserRole = 'dm' | 'player';
export type CombatMode = 'reactive' | 'turn_based';
export type SessionStatus = 'active' | 'stopped' | 'paused';
export type SpellElement = 'Fire' | 'Earth' | 'Wind' | 'Water' | 'Light' | 'Dark';
export type EquipmentSlot = 'mainHand' | 'offHand' | 'head' | 'body' | 'boots' | 'relic';
export type ArenaBiome = 'obsidian' | 'forest' | 'plains' | 'desert';
export type TerrainType = 'tree' | 'rock' | 'water';
export type PassiveTier =
  | 'Normal'
  | 'Advanced'
  | 'Rare'
  | 'Super Rare'
  | 'Super Super Rare'
  | 'Legendary'
  | 'Mythic';

export interface EquipmentItem {
  id: string;
  name: string;
  slot: EquipmentSlot | '';
  type: 'weapon' | 'armor' | 'relic' | string;
  attackBonus: number;
  damageDice: string;
  damageType: string;
  rangeSpaces: number;
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
  slot?: EquipmentSlot | '';
  attackBonus?: number;
  damageDice?: string;
  damageType?: string;
  rangeSpaces?: number;
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
}

export interface MonsterLoot {
  itemName: string;
  itemCategory: string;
  gold: number;
  manaStones: number;
  xp: number;
  dropped: boolean;
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
  attackFormula: string;
  damageFormula: string;
  hiddenFromPlayers: boolean;
  conditions: string[];
  notes: string;
  healthTier?: string;
  loot: MonsterLoot;
}

export interface BestiaryEntry {
  id: string;
  name: string;
  maxHp: number;
  ac: number;
  dr: number;
  attackFormula: string;
  damageFormula: string;
  rangeSpaces: number;
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
  hasMovedThisTurn?: boolean;
  hasObservedThisTurn?: boolean;
  attacksUsedThisTurn?: number;
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
  x: number;
  y: number;
  gold: number;
  manaStones: number;
  itemName: string;
  itemCategory: string;
  opened: boolean;
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
}

export interface BeatArena {
  cols: number;
  rows: number;
  biome: ArenaBiome | string;
  terrain: ArenaTerrainTile[];
  tokens: MapToken[];
  chests: MapChest[];
  manaStones?: ArenaManaStone[];
  startPositions?: Record<string, { x: number; y: number }>;
}

export interface BeatEncounterSpec {
  name: string;
  maxHp: number;
  ac: number;
  dr: number;
  rangeSpaces?: number;
  attackFormula: string;
  damageFormula: string;
  hiddenFromPlayers?: boolean;
  floor?: number;
  startX?: number | string | null;
  startY?: number | string | null;
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
  slot?: EquipmentSlot | '';
  attackBonus?: number;
  damageDice?: string;
  damageType?: string;
  rangeSpaces?: number;
  drBonus?: number;
  acBonus?: number;
  notes?: string;
}

export interface StoryBeat {
  id: string;
  order: number;
  floor: number;
  title: string;
  narration: string;
  dmSecret: string | null;
  presented: boolean;
  status: 'upcoming' | 'active' | 'resolved' | string;
  xpReward: number;
  arena: BeatArena;
  encounters: BeatEncounterSpec[];
  treasures: BeatTreasureSpec[];
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
  targetCharacterId: string;
  targetCharacterName: string;
  attackTotal: number;
  incomingDamage: number;
  formula: string;
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
  bestiary: BestiaryEntry[];
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
  bestiary: BestiaryEntry[];
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
