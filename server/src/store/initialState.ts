import {
  DEFAULT_STAT_MILESTONES,
  type BeatArena,
  type Character,
  type Deity,
  type FloorConfig,
  type GameState,
  type MechanicsConfig,
  type Spell,
  type StoryBeat,
} from '../../../shared';

export function createDefaultBeatArena(
  cols = 20,
  rows = 20,
  charsMap: Record<string, Character> = {},
): BeatArena {
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

export function ensureBeatArena(beat: StoryBeat, charsMap: Record<string, Character> = {}): BeatArena {
  if (!beat.arena) {
    beat.arena = createDefaultBeatArena(20, 20, charsMap);
  }
  beat.arena.chests = beat.arena.chests || [];
  beat.arena.terrain = beat.arena.terrain || [];
  beat.arena.tokens = beat.arena.tokens || [];
  beat.arena.biome = beat.arena.biome || 'obsidian';
  return beat.arena;
}

export function getInitialState(): GameState {
  const floors: FloorConfig[] = [
    {
      number: 1,
      title: '1F • Gate of Trials (Safe Zone)',
      theme: 'forest',
      rowStart: 0,
      rowEnd: 4,
      safeZone: true,
      portalRow: 0,
      portalCol: 5,
      description: 'Base camp for newly awakened tower climbers.',
    },
  ];

  const defaultMechanics: MechanicsConfig = {
    presetName: 'Tower System Reactive Hybrid',
    combatMode: 'reactive',
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

  const grimoire: Spell[] = [
    {
      id: 'sp-shinsu-lance',
      name: 'Azure Shinsu Lance',
      element: 'Water',
      mpCost: 6,
      damageDice: '3d8+4',
      damageType: 'Water',
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
      element: 'Dark',
      mpCost: 4,
      damageDice: '2d8+4',
      damageType: 'Dark',
      rangeSpaces: 3,
      areaText: '1 Enemy within 3 Spaces (Reaction)',
      actionType: 'Reaction',
      explanation: 'Triggered immediately when a monster strikes you! Blink through shadows up to 3 spaces and slash back with a dark blade before recovering stance.',
    },
    {
      id: 'sp-aegis-pulse',
      name: 'System Aegis Ward',
      element: 'Earth',
      mpCost: 5,
      damageDice: '1d10+3',
      damageType: 'Earth',
      rangeSpaces: 1,
      areaText: 'Self + Adjacent 1-Space Shockwave (Reaction)',
      actionType: 'Reaction',
      explanation: 'Projects an emergency geometric Earth barrier that absorbs half incoming impact and blasts adjacent monsters 1 space back.',
    },
    {
      id: 'sp-tempest-arrow',
      name: 'Gale Piercer Volley',
      element: 'Wind',
      mpCost: 5,
      damageDice: '2d10+3',
      damageType: 'Wind',
      rangeSpaces: 10,
      areaText: 'Long Range (Up to 10 Spaces)',
      actionType: 'Action',
      explanation: 'Fires hyper-accelerated wind bolts across the floor up to 10 spaces away. Ignores partial cover and shocks armored foes.',
    },
    {
      id: 'sp-sanctuary-ray',
      name: 'Constellation Dawn Ray',
      element: 'Light',
      mpCost: 6,
      damageDice: '2d8+4',
      damageType: 'Light',
      rangeSpaces: 6,
      areaText: '6 Spaces (Also restores 1d8 HP to caster)',
      actionType: 'Action',
      explanation: 'Channels patron starlight onto a foe within 6 spaces, searing monsters with radiant fire while knitting minor wounds.',
    },
  ];

  const deities: Deity[] = [
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

  const characters: Record<string, Character> = {};
  const nowIso = new Date().toISOString();

  return {
    version: 1,
    schemaVersion: 2,
    session: {
      status: 'active',
      sessionNumber: 1,
      title: 'Tower of the Crimson Sovereign — Climb 1F–5F',
      pausedMessage: 'Waiting for the Dungeon Master to start the session...',
      startedAt: nowIso,
    },
    mechanics: defaultMechanics,
    grimoire,
    deities,
    characters,
    playerAccounts: {},
    dmAccount: {
      email: 'jairusjimenez@live.com',
      username: '',
      activated: false,
      salt: null,
      passwordHash: null,
    },
    monsters: [],
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
      fog: [],
      tokens: [],
      pings: [],
    },
    combat: {
      active: true,
      round: 1,
      turnIndex: 0,
      combatants: [],
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
        timestamp: nowIso,
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
        timestamp: nowIso,
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
        timestamp: nowIso,
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
