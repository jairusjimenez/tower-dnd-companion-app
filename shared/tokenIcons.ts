export const MONSTER_ICON_IDS = [
  'goblin',
  'orc',
  'dragon',
  'serpent',
  'spider',
  'undead',
  'knight',
  'beast',
  'slime',
  'demon',
  'golem',
  'insect',
  'boss',
] as const;

export type MonsterIconId = (typeof MONSTER_ICON_IDS)[number];

export const NPC_ICON_IDS = [
  'merchant',
  'quest_giver',
  'skill_master',
  'guard',
  'healer',
  'blacksmith',
  'sage',
  'villager',
] as const;

export type NpcIconId = (typeof NPC_ICON_IDS)[number];

export type TokenIconId = MonsterIconId | NpcIconId;

export interface TokenIconMeta {
  label: string;
  category: 'monster' | 'npc';
  bg: string;
  accent: string;
}

export const TOKEN_ICON_META: Record<TokenIconId, TokenIconMeta> = {
  goblin: { label: 'Goblin / Imp', category: 'monster', bg: '#7f1d1d', accent: '#fca5a5' },
  orc: { label: 'Orc / Ogre / Giant', category: 'monster', bg: '#7c2d12', accent: '#fdba74' },
  dragon: { label: 'Dragon / Wyrm', category: 'monster', bg: '#991b1b', accent: '#fde047' },
  serpent: { label: 'Serpent / Kasaka', category: 'monster', bg: '#1e3a8a', accent: '#7dd3fc' },
  spider: { label: 'Spider / Arachnid', category: 'monster', bg: '#3b0764', accent: '#e9d5ff' },
  undead: { label: 'Undead / Shadow', category: 'monster', bg: '#312e81', accent: '#c7d2fe' },
  knight: { label: 'Armored Knight', category: 'monster', bg: '#881337', accent: '#fda4af' },
  beast: { label: 'Wolf / Beast', category: 'monster', bg: '#713f12', accent: '#fde68a' },
  slime: { label: 'Slime / Elemental', category: 'monster', bg: '#115e59', accent: '#5eead4' },
  demon: { label: 'Demon / Fiend', category: 'monster', bg: '#7f1d1d', accent: '#fb7185' },
  golem: { label: 'Golem / Construct', category: 'monster', bg: '#334155', accent: '#cbd5e1' },
  insect: { label: 'Ant / Insectoid', category: 'monster', bg: '#4c1d95', accent: '#f472b6' },
  boss: { label: 'Floor Boss / Monarch', category: 'monster', bg: '#78350f', accent: '#fbbf24' },

  merchant: { label: 'Merchant / Shop', category: 'npc', bg: '#065f46', accent: '#fcd34d' },
  quest_giver: { label: 'Quest Giver / Elder', category: 'npc', bg: '#047857', accent: '#fde68a' },
  skill_master: { label: 'Skill Master / Trainer', category: 'npc', bg: '#0f766e', accent: '#5eead4' },
  guard: { label: 'Guard / Soldier', category: 'npc', bg: '#1e40af', accent: '#93c5fd' },
  healer: { label: 'Healer / Cleric', category: 'npc', bg: '#065f46', accent: '#86efac' },
  blacksmith: { label: 'Blacksmith / Forger', category: 'npc', bg: '#78350f', accent: '#fdba74' },
  sage: { label: 'Sage / Archmage', category: 'npc', bg: '#4c1d95', accent: '#d8b4fe' },
  villager: { label: 'Villager / Guide', category: 'npc', bg: '#064e3b', accent: '#6ee7b7' },
};

export function inferMonsterIconId(name: string, category?: string): MonsterIconId {
  const n = String(name || '').toLowerCase();
  if (/dragon|wyrm|drake|wyvern|kamish|antares/.test(n)) return 'dragon';
  if (/kasaka|serpent|snake|basilisk|eel|hydra|cobra|viper|naga/.test(n)) return 'serpent';
  if (/spider|arachnid|tarantula|broodmother/.test(n)) return 'spider';
  if (/beru|ant\b|ants\b|insect|mantis|beetle|scarab|hornet/.test(n)) return 'insect';
  if (/igris|knight|paladin|sentinel|guardian|commander|crusader|cavalier/.test(n)) return 'knight';
  if (/skeleton|zombie|lich|undead|wraith|ghost|ghoul|necromancer|shadow|mummy|reaper/.test(n)) return 'undead';
  if (/wolf|lycan|hound|bear|boar|cerberus|beast|tiger|fang|fenrir|lion/.test(n)) return 'beast';
  if (/slime|ooze|elemental|wisp|jelly|blob/.test(n)) return 'slime';
  if (/demon|devil|fiend|baran|vulcan|metus|imp\b|succubus/.test(n)) return 'demon';
  if (/golem|statue|construct|titan|stone|automaton|sentinel/.test(n)) return 'golem';
  if (/orc|troll|ogre|giant|kargalgan|tusk|minotaur|cyclops/.test(n)) return 'orc';
  if (category === 'Boss' || /\b(boss|monarch|king|lord|emperor)\b/.test(n)) return 'boss';
  return 'goblin';
}

export function inferNpcIconId(name: string, npcRole?: string): NpcIconId {
  const text = `${name || ''} ${npcRole || ''}`.toLowerCase();
  if (/merchant|shop|trader|vendor|peddler|broker/.test(text)) return 'merchant';
  if (/quest|elder|guide|chief|mayor|herald/.test(text)) return 'quest_giver';
  if (/skill|master|trainer|sensei|instructor|mentor|dojo/.test(text)) return 'skill_master';
  if (/guard|captain|soldier|knight|warden|watchman|paladin/.test(text)) return 'guard';
  if (/heal|cleric|priest|alchemist|medic|nurse|doctor/.test(text)) return 'healer';
  if (/smith|blacksmith|forge|armorer|artisan|crafter/.test(text)) return 'blacksmith';
  if (/sage|mage|wizard|oracle|scholar|archmage|seer|librarian/.test(text)) return 'sage';
  return 'villager';
}

export function isBossToken(name: string, iconId?: string, category?: string): boolean {
  if (iconId === 'boss' || category === 'Boss') return true;
  return /\b(boss|monarch|king|lord|igris|beru|baran|antares|statue of god|kargalgan|cerberus)\b/i.test(String(name || ''));
}

export function extractTokenNumberBadge(name: string): string | null {
  const m = String(name || '').match(/#(\d+)\s*$/);
  return m ? `#${m[1]}` : null;
}

export function shouldMonsterDropChest(spec: {
  name: string;
  iconId?: string;
  category?: string;
  dropsChest?: boolean;
}): boolean {
  if (spec.dropsChest === true) return true;
  if (spec.dropsChest === false) return false;
  return (
    isBossToken(spec.name, spec.iconId, spec.category) ||
    /\b(mini[\s-]?boss|boss|commander|monarch|king|lord|overlord|warlord)\b/i.test(String(spec.name || ''))
  );
}
