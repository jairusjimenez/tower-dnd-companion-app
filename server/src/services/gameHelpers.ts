import crypto from 'node:crypto';
import {
  DEFAULT_STAT_MILESTONES,
  computeStatModifier,
  getEquippedTotals,
  type BeatArena,
  type Character,
  type EquipmentSlot,
  type FloorConfig,
  type GameState,
  type InventoryItem,
  type Monster,
  type ToastMessage,
} from '../../../shared';
import type { ActionRequestContext } from '../actions/types';
import { generateSvgPortraitDataUri } from './art';
import { rollSingleDie } from './dice';

const VALID_BIOME_THEMES = ['forest', 'desert', 'underworld', 'plains', 'frost', 'obsidian'];

export function defaultThemeForFloor(n: number): string {
  return n === 1 ? 'forest' : n === 2 ? 'desert' : n === 3 ? 'underworld' : n === 4 ? 'frost' : 'obsidian';
}

export function getFloorCenterRow(state: GameState, floorNum: number): number {
  const floor = state.map.floors.find((f) => Number(f.number) === Number(floorNum));
  if (!floor) return Math.max(0, state.map.rows - 3);
  return Math.floor((floor.rowStart + floor.rowEnd) / 2);
}

export function pushSystemToast(
  ctx: { state: GameState; sseHub: ActionRequestContext['sseHub'] },
  {
    title,
    message,
    category = 'info',
    target = 'all',
    sender = 'SYSTEM / DM',
  }: { title?: string; message: string; category?: string; target?: string; sender?: string },
): ToastMessage {
  const rawMsg = String(message || '').trim();
  const formattedMsg = /^SYSTEM:/i.test(rawMsg) ? rawMsg : `SYSTEM: ${rawMsg}`;
  const entry: ToastMessage = {
    id: `sys-${Date.now()}-${crypto.randomInt(100, 999)}`,
    timestamp: new Date().toISOString(),
    category,
    title: String(title || 'SYSTEM NOTICE').slice(0, 80),
    message: formattedMsg.slice(0, 500),
    target: target || 'all',
    sender,
  };
  ctx.state.systemMessages.unshift(entry);
  ctx.state.systemMessages = ctx.state.systemMessages.slice(0, 40);
  ctx.sseHub.broadcast('toast', entry);
  return entry;
}

export function logPlayerHistory(state: GameState, charId: string | null, category: string, summary: string) {
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

export function commitState(ctx: ActionRequestContext): void {
  ctx.state.version = Number(ctx.state.version || 0) + 1;
  ctx.repo.save(ctx.state);
  ctx.sseHub.broadcast('state');
}

export function resolveAuthorizedCharacter(
  ctx: ActionRequestContext,
  requestedCharId?: string | null,
  actionLabel = 'perform this action',
): { ch?: Character; error?: { status: number; error: string } } {
  const targetId = requestedCharId || ctx.characterId;
  const ch = targetId ? ctx.state.characters[targetId] : undefined;
  if (!ch) return { error: { status: 404, error: 'Character not found.' } };
  if (ctx.role !== 'dm' && ctx.characterId && ctx.characterId !== ch.id) {
    return { error: { status: 403, error: `Players can only ${actionLabel} on their own character.` } };
  }
  return { ch };
}

export function createInventoryItem(spec: Partial<InventoryItem> & { name: string }): InventoryItem {
  const category = String(spec.category || 'relic');
  const defaultSlot: EquipmentSlot = category === 'weapon' ? 'mainHand' : category === 'armor' ? 'body' : 'relic';
  return {
    id: `inv-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
    name: String(spec.name).slice(0, 80),
    category,
    qty: Math.max(1, Number(spec.qty || 1)),
    healHp: Number(spec.healHp || 0),
    healMp: Number(spec.healMp || 0),
    slot: (spec.slot ?? defaultSlot) as EquipmentSlot | '',
    attackBonus: Number(spec.attackBonus || 0),
    damageDice: String(spec.damageDice || ''),
    damageType: String(spec.damageType || 'Physical'),
    rangeSpaces: Number(spec.rangeSpaces || 2),
    drBonus: Number(spec.drBonus || 0),
    acBonus: Number(spec.acBonus || 0),
    ...(spec.artUrl ? { artUrl: spec.artUrl } : {}),
    notes: String(spec.notes || ''),
  };
}

export function grantXpToCharacter(state: GameState, ch: Character, xpAmount: number) {
  const gained = Math.max(0, Math.round(Number(xpAmount || 0)));
  ch.level = Math.max(1, Number(ch.level || 1));
  ch.xp = Number(ch.xp || 0) + gained;
  ch.xpToNext = Number(ch.xpToNext || ch.level * 100);
  ch.unspentStatPoints = Number(ch.unspentStatPoints || 0);
  ch.passiveTickets = Number(ch.passiveTickets || 0);

  if (gained > 0) {
    logPlayerHistory(state, ch.id, 'xp', `Gained +${gained} XP (${ch.xp}/${ch.xpToNext} XP)`);
  }
  return {
    gained,
    levelsGained: 0,
    level: ch.level,
    xp: ch.xp,
    xpToNext: ch.xpToNext,
    unspentStatPoints: ch.unspentStatPoints,
    passiveTickets: ch.passiveTickets,
  };
}

export function removeMonsterTokensFromMaps(state: GameState, monsterId: string): void {
  if (!monsterId) return;
  if (state.map?.tokens) {
    state.map.tokens = state.map.tokens.filter((t) => t.id !== monsterId);
  }
  for (const b of state.storyBeats || []) {
    if (b.arena?.tokens) {
      b.arena.tokens = b.arena.tokens.filter((t) => t.id !== monsterId);
    }
  }
}

export function resetArenaTurnFlags(state: GameState, targetIds?: string[] | null): void {
  const idSet = targetIds && targetIds.length ? new Set(targetIds.filter(Boolean)) : null;
  for (const b of state.storyBeats || []) {
    for (const t of b.arena?.tokens || []) {
      if (!idSet || idSet.has(t.id)) {
        t.hasMovedThisTurn = false;
        t.hasObservedThisTurn = false;
        t.attacksUsedThisTurn = 0;
      }
    }
  }
}

export function clampArenaEntitiesToBounds(arena: BeatArena, cols: number, rows: number): void {
  arena.cols = cols;
  arena.rows = rows;
  for (const tok of arena.tokens || []) {
    tok.x = Math.max(0, Math.min(cols - 1, tok.x));
    tok.y = Math.max(0, Math.min(rows - 1, tok.y));
  }
  for (const ch of arena.chests || []) {
    ch.x = Math.max(0, Math.min(cols - 1, ch.x));
    ch.y = Math.max(0, Math.min(rows - 1, ch.y));
  }
  arena.terrain = (arena.terrain || []).filter((t) => t.x < cols && t.y < rows);
}

export function pushNewFloorToTowerMap(
  state: GameState,
  opts: { title?: string; theme?: string; safeZone?: boolean; description?: string; startFogged?: boolean } = {},
): FloorConfig {
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
  const floorTheme = opts.theme && VALID_BIOME_THEMES.includes(opts.theme) ? opts.theme : defaultThemeForFloor(nextNum);
  const newFloor: FloorConfig = {
    number: nextNum,
    title: String(opts.title || `${nextNum}F • ${floorTheme.charAt(0).toUpperCase() + floorTheme.slice(1)} Realm`).slice(0, 60),
    theme: floorTheme,
    rowStart: 0,
    rowEnd: 4,
    safeZone: Boolean(opts.safeZone),
    portalRow: 4,
    portalCol: 5,
    description: String(opts.description || `Floor ${nextNum} of the Tower.`),
  };
  state.map.floors.unshift(newFloor);
  if (opts.startFogged) {
    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x < state.map.cols; x++) state.map.fog.push(`${x},${y}`);
    }
  }
  return newFloor;
}

export function recalculateCharacterAcAndDr(state: GameState, ch: Character): void {
  const totals = getEquippedTotals(ch);
  const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;

  let passiveAc = 0;
  let passiveDr = 0;
  for (const p of ch.passives || []) {
    const mult = Number(p.multiplierPct || 100) / 100;
    if (p.bonusAc) passiveAc += Math.round(Number(p.bonusAc) * mult);
    if (p.bonusDr) passiveDr += Math.round(Number(p.bonusDr) * mult);
  }

  const milestones = state.mechanics?.statMilestones || DEFAULT_STAT_MILESTONES;
  const awakeningSet = new Set(ch.awakenings || []);
  let awkAc = 0;
  let awkDr = 0;
  for (const ms of milestones) {
    if (awakeningSet.has(ms.id)) {
      awkAc += Number(ms.bonusAc || 0);
      awkDr += Number(ms.bonusDr || 0);
    }
  }

  ch.ac = 10 + Math.max(0, computeStatModifier(agiScore, state.mechanics, ch)) + totals.armorAc + passiveAc + awkAc;
  ch.dr = totals.armorDr + passiveDr + awkDr;
}

export function syncCharacterDerived(ctx: ActionRequestContext, charId: string): void {
  const ch = ctx.state.characters[charId];
  if (!ch) return;
  const milestones = ctx.state.mechanics?.statMilestones || DEFAULT_STAT_MILESTONES;
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
      pushSystemToast(ctx, {
        title: `STAT AWAKENING: ${ms.abilityName.toUpperCase()}`,
        message: `${ch.name} reached ${ms.statKey} ${ms.threshold} and unlocked ${ms.abilityName}! (${ms.description})`,
        category: 'loot',
        target: ch.id,
      });
      logPlayerHistory(ctx.state, ch.id, 'awakening', `Unlocked ${ms.abilityName} (${ms.statKey} ${ms.threshold})`);
    }
  }

  const tok = ctx.state.map.tokens.find((t) => t.id === charId);
  if (tok) {
    tok.name = ch.name.split(' ')[0];
    tok.hp = ch.hp;
    tok.maxHp = ch.maxHp;
  }
  for (const beat of ctx.state.storyBeats || []) {
    const btok = beat.arena?.tokens?.find((t) => t.id === charId);
    if (btok) {
      btok.name = ch.name.split(' ')[0];
      btok.hp = ch.hp;
      btok.maxHp = ch.maxHp;
    }
  }
  const cb = ctx.state.combat.combatants.find((c) => c.id === charId);
  if (cb) {
    cb.name = ch.name;
    cb.hp = ch.hp;
    cb.maxHp = ch.maxHp;
    cb.ac = ch.ac;
  }
}

export function syncMonsterDerived(ctx: ActionRequestContext, monsterId: string): void {
  const mon: Monster | undefined = ctx.state.monsters.find((m) => m.id === monsterId);
  if (!mon) return;
  const monHp = Number(mon.hp ?? 0);
  const monMaxHp = Number(mon.maxHp ?? 0);

  const tok = ctx.state.map.tokens.find((t) => t.id === monsterId);
  if (tok) {
    tok.name = mon.name;
    tok.hp = monHp;
    tok.maxHp = monMaxHp;
    tok.hiddenFromPlayers = Boolean(mon.hiddenFromPlayers);
  }
  for (const beat of ctx.state.storyBeats || []) {
    const btok = beat.arena?.tokens?.find((t) => t.id === monsterId);
    if (btok) {
      btok.name = mon.name;
      btok.hp = monHp;
      btok.maxHp = monMaxHp;
      btok.hiddenFromPlayers = Boolean(mon.hiddenFromPlayers);
    }
  }
  const cb = ctx.state.combat.combatants.find((c) => c.id === monsterId);
  if (cb) {
    cb.name = mon.name;
    cb.hp = monHp;
    cb.maxHp = monMaxHp;
    cb.ac = mon.ac;
    cb.hiddenFromPlayers = Boolean(mon.hiddenFromPlayers);
  }

  if (monHp <= 0 && mon.loot && !mon.loot.dropped) {
    const hasDrop = Boolean(mon.loot.itemName || mon.loot.gold > 0 || mon.loot.manaStones > 0 || mon.loot.xp > 0);
    if (hasDrop) {
      mon.loot.dropped = true;
      if (mon.loot.xp > 0) {
        for (const ch of Object.values(ctx.state.characters)) {
          grantXpToCharacter(ctx.state, ch, mon.loot.xp);
        }
      }
      let droppedOnArena = false;
      for (const beat of ctx.state.storyBeats || []) {
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
        for (const ch of Object.values(ctx.state.characters)) {
          ch.currency = ch.currency || { gold: 0, manaStones: 0 };
          ch.currency.gold = Number(ch.currency.gold || 0) + Number(mon.loot.gold || 0);
          ch.currency.manaStones = Number(ch.currency.manaStones || 0) + Number(mon.loot.manaStones || 0);
          if (mon.loot.itemName) {
            ch.inventory = ch.inventory || [];
            ch.inventory.push(
              createInventoryItem({
                name: mon.loot.itemName,
                category: mon.loot.itemCategory || 'relic',
                notes: `Dropped by ${mon.name}`,
              }),
            );
          }
        }
      }
      const dropParts = [
        mon.loot.itemName || '',
        mon.loot.gold ? `${mon.loot.gold}G` : '',
        mon.loot.manaStones ? `${mon.loot.manaStones} Stones` : '',
        mon.loot.xp ? `+${mon.loot.xp} XP` : '',
      ].filter(Boolean).join(', ');
      pushSystemToast(ctx, {
        title: 'MONSTER LOOT DROPPED!',
        message: `${mon.name} was defeated and dropped: ${dropParts}${droppedOnArena ? ' (Tap loot chest on arena!)' : ''}`,
        category: 'loot',
      });
    }
  }
}

export function createNewCharacterRecord(
  state: GameState,
  { name, race, className, level = 1 }: { name: string; race?: string; className?: string; level?: number },
): Character {
  const id = `char-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`;
  const stats: Record<string, number> = {};
  for (const s of state.mechanics.stats) {
    stats[s.key] = Number(s.defaultValue ?? 12);
  }
  const cleanName = String(name || 'New Climber').trim().slice(0, 50);
  const prompt = `${race || 'Human'} ${className || 'Tower Climber'} named ${cleanName} in dark fantasy gear, Korean manhwa webtoon style`;
  const char: Character = {
    id,
    name: cleanName,
    race: String(race || 'Human').trim(),
    className: String(className || 'Challenger').trim(),
    rank: 'E-Rank',
    level: Math.max(1, Number(level) || 1),
    xp: 0,
    xpToNext: Math.max(1, Number(level) || 1) * 100,
    unspentStatPoints: 10,
    passiveTickets: 0,
    passives: [],
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
    spells: [],
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
  const startRow = getFloorCenterRow(state, 1);
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

  // Add player arena token to all non-resolved story beats so newly invited players can immediately act on the grid
  for (const beat of state.storyBeats || []) {
    if (beat.status === 'resolved' || !beat.arena) continue;
    beat.arena.tokens = beat.arena.tokens || [];
    if (beat.arena.tokens.some((t) => t.id === id)) continue;
    const cols = Math.max(5, Number(beat.arena.cols || 20));
    const rows = Math.max(5, Number(beat.arena.rows || 20));
    const occupied = new Set([
      ...(beat.arena.tokens || []).map((t) => `${t.x},${t.y}`),
      ...(beat.arena.terrain || []).map((t) => `${t.x},${t.y}`),
    ]);
    const preferredY = Math.max(0, rows - 4);
    const centerCol = Math.floor(cols / 2);
    let placeX = Math.min(cols - 1, Math.max(0, centerCol));
    let placeY = preferredY;
    let placed = false;
    for (let radius = 0; radius < Math.max(cols, rows) && !placed; radius++) {
      const candidates = [
        { x: centerCol + radius, y: preferredY },
        { x: centerCol - radius, y: preferredY },
        { x: centerCol + radius, y: Math.max(0, preferredY - 1) },
        { x: centerCol - radius, y: Math.max(0, preferredY - 1) },
      ];
      for (const c of candidates) {
        if (c.x >= 0 && c.x < cols && c.y >= 0 && c.y < rows && !occupied.has(`${c.x},${c.y}`)) {
          placeX = c.x;
          placeY = c.y;
          placed = true;
          break;
        }
      }
    }
    beat.arena.tokens.push({
      id,
      name: cleanName.split(' ')[0],
      type: 'player',
      x: placeX,
      y: placeY,
      color: '#38bdf8',
      hp: char.hp,
      maxHp: char.maxHp,
      hiddenFromPlayers: false,
      label: initials,
    });
  }

  return char;
}

export { VALID_BIOME_THEMES };
