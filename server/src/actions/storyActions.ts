import crypto from 'node:crypto';
import {
  computeStatModifier,
  generateArenaTerrainFromPrompt,
  type BeatEncounterSpec,
  type BeatTreasureSpec,
  type EquipmentSlot,
  type MapToken,
  type Monster,
  type StoryBeat,
  type TerrainType,
} from '../../../shared';
import {
  clampArenaEntitiesToBounds,
  commitState,
  createInventoryItem,
  grantXpToCharacter,
  logPlayerHistory,
  pushSystemToast,
} from '../services/gameHelpers';
import { createDefaultBeatArena, ensureBeatArena } from '../store/initialState';
import { maskMonsterForRole } from '../store/filterState';
import { spawnMonsterAction } from './combatActions';
import type { ActionRequestContext, ActionResult } from './types';

function createNpcArenaToken(n: Record<string, unknown>, idx: number, gridCols: number, gridRows: number): MapToken {
  const npcName = String(n.name || 'NPC').trim().slice(0, 50) || 'NPC';
  const npcId = `npc-${Date.now().toString(36)}-${idx}-${crypto.randomInt(10, 99)}`;
  const nx = n.startX !== undefined && n.startX !== '' && n.startX !== null
    ? Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(n.startX)) - 1))
    : Math.min(gridCols - 1, 2 + idx * 2);
  const ny = n.startY !== undefined && n.startY !== '' && n.startY !== null
    ? Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(n.startY)) - 1))
    : Math.min(gridRows - 1, Math.floor(gridRows / 2));

  return {
    id: npcId,
    name: npcName,
    npcRole: String(n.npcRole || n.role || 'NPC').slice(0, 40),
    dialogue: String(n.dialogue || `Greetings, Climber. Speak with ${npcName}.`).slice(0, 300),
    rewardType: ['none', 'item', 'skill_book', 'xp'].includes(String(n.rewardType)) ? String(n.rewardType) : 'none',
    rewardItemName: String(n.rewardItemName || '').slice(0, 60),
    rewardItemCategory: String(n.rewardItemCategory || 'relic'),
    rewardSkillDesc: String(n.rewardSkillDesc || '').slice(0, 160),
    rewardXp: Math.max(0, Number(n.rewardXp || 0)),
    rewardGold: Math.max(0, Number(n.rewardGold || 0)),
    rewardClaimed: false,
    type: 'npc',
    x: nx,
    y: ny,
    color: '#10b981',
    hp: null,
    maxHp: null,
    hiddenFromPlayers: Boolean(n.hiddenFromPlayers),
    label: npcName.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'NP',
  };
}

export function storyAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const isDm = ctx.role === 'dm';
  ctx.state.storyBeats = ctx.state.storyBeats || [];
  const sub = String(payload.subAction || '');

  if (!isDm && !['move_beat_token', 'open_beat_chest', 'talk_beat_npc', 'observe_beat_cell'].includes(sub)) {
    return { status: 403, error: 'Only the Dungeon Master can orchestrate story beats.' };
  }

  if (sub === 'add_beat') {
    const title = String(payload.title || '').trim();
    if (!title) return { status: 400, error: 'Story beat title is required.' };
    const encounters = Array.isArray(payload.encounters) ? (payload.encounters as BeatEncounterSpec[]) : [];
    const treasures = Array.isArray(payload.treasures) ? (payload.treasures as BeatTreasureSpec[]) : [];
    const npcs = Array.isArray(payload.npcs) ? (payload.npcs as Array<Record<string, unknown>>) : [];
    const gridCols = Math.max(5, Math.min(100, Number(payload.gridCols || payload.gridSize || 20)));
    const gridRows = Math.max(5, Math.min(100, Number(payload.gridRows || payload.gridSize || 20)));
    const arena = createDefaultBeatArena(gridCols, gridRows, ctx.state.characters);

    if (typeof payload.biome === 'string' && ['forest', 'plains', 'desert', 'obsidian'].includes(payload.biome)) {
      arena.biome = payload.biome;
    }
    if (payload.playerPositions && typeof payload.playerPositions === 'object') {
      const positions = payload.playerPositions as Record<string, { x?: number; y?: number }>;
      arena.startPositions = {};
      for (const tok of arena.tokens) {
        const pos = positions[tok.id];
        if (pos && pos.x !== undefined && pos.y !== undefined) {
          tok.x = Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(pos.x))));
          tok.y = Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(pos.y))));
        }
        arena.startPositions[tok.id] = { x: tok.x, y: tok.y };
      }
    }
    if (npcs.length > 0) {
      arena.startPositions = arena.startPositions || {};
      npcs.forEach((n, idx) => {
        const npcTok = createNpcArenaToken(n, idx, gridCols, gridRows);
        arena.tokens.push(npcTok);
        arena.startPositions![npcTok.id] = { x: npcTok.x, y: npcTok.y };
      });
    }
    if (Array.isArray(payload.chests)) {
      arena.chests = (payload.chests as Array<Record<string, unknown>>).map((c, i) => ({
        id: `chest-${Date.now().toString(36)}-${i}-${crypto.randomInt(10, 99)}`,
        name: String(c.name || 'Treasure Chest').slice(0, 50),
        x: Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(c.x || 0)))),
        y: Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(c.y || 0)))),
        gold: Math.max(0, Number(c.gold || 0)),
        manaStones: Math.max(0, Number(c.manaStones || 0)),
        itemName: String(c.itemName || '').slice(0, 50),
        itemCategory: String(c.itemCategory || 'relic'),
        opened: false,
      }));
    }
    if (Array.isArray(payload.terrain) && payload.terrain.length > 0) {
      arena.terrain = (payload.terrain as Array<{ x?: number; y?: number; type?: string }>)
        .filter((t) => ['tree', 'rock', 'water'].includes(String(t.type)))
        .map((t) => ({
          x: Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(t.x || 0)))),
          y: Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(t.y || 0)))),
          type: t.type as TerrainType,
        }));
    } else if (payload.arenaPrompt) {
      const occ = new Set([
        ...arena.tokens.map((t) => `${t.x},${t.y}`),
        ...arena.chests.map((c) => `${c.x},${c.y}`),
      ]);
      const gen = generateArenaTerrainFromPrompt(String(payload.arenaPrompt), gridCols, gridRows, arena.biome, occ);
      arena.biome = gen.biome;
      arena.terrain = gen.terrain;
    }

    const beat: StoryBeat = {
      id: `beat-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      order: ctx.state.storyBeats.length + 1,
      floor: Math.max(1, Number(payload.floor || 1)),
      title: title.slice(0, 80),
      narration: String(payload.narration || '').slice(0, 800),
      dmSecret: String(payload.dmSecret || '').slice(0, 500),
      presented: Boolean(payload.presentNow),
      status: payload.presentNow ? 'active' : 'upcoming',
      xpReward: Math.max(0, Number(payload.xpReward ?? 0)),
      arena,
      encounters,
      treasures,
    };
    ctx.state.storyBeats.push(beat);
    if (beat.presented) {
      pushSystemToast(ctx, {
        title: `STORY: ${beat.title}`,
        message: beat.narration || `New scene unlocked on ${beat.floor}F.`,
        category: 'info',
      });
    }
    commitState(ctx);
    return { ok: true, beat };
  }

  const beat = ctx.state.storyBeats.find((b) => b.id === payload.beatId);
  if (!beat) return { status: 404, error: 'Story beat not found.' };
  const arena = ensureBeatArena(beat, ctx.state.characters);

  if (sub === 'present_beat') {
    beat.presented = true;
    beat.status = 'active';
    pushSystemToast(ctx, {
      title: `STORY: ${beat.title}`,
      message: beat.narration || `The Dungeon Master revealed ${beat.title}.`,
      category: 'info',
    });
  } else if (sub === 'hide_beat') {
    beat.presented = false;
  } else if (sub === 'set_status') {
    if (typeof payload.status === 'string' && ['upcoming', 'active', 'resolved'].includes(payload.status)) {
      beat.status = payload.status;
    }
  } else if (sub === 'set_beat_grid') {
    const cols = Math.max(5, Math.min(100, Number(payload.cols || 20)));
    const rows = Math.max(5, Math.min(100, Number(payload.rows || cols)));
    clampArenaEntitiesToBounds(arena, cols, rows);
  } else if (sub === 'set_beat_biome') {
    if (typeof payload.biome === 'string' && ['forest', 'plains', 'desert', 'obsidian'].includes(payload.biome)) {
      arena.biome = payload.biome;
    }
  } else if (sub === 'toggle_beat_terrain') {
    const tx = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x || 0))));
    const ty = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y || 0))));
    const tType = (['tree', 'rock', 'water'].includes(String(payload.terrainType)) ? String(payload.terrainType) : 'rock') as TerrainType;
    arena.terrain = arena.terrain || [];
    const existingIdx = arena.terrain.findIndex((t) => t.x === tx && t.y === ty);
    if (existingIdx >= 0 && arena.terrain[existingIdx].type === tType) arena.terrain.splice(existingIdx, 1);
    else if (existingIdx >= 0) arena.terrain[existingIdx].type = tType;
    else arena.terrain.push({ x: tx, y: ty, type: tType });
  } else if (sub === 'generate_beat_terrain') {
    const occ = new Set([
      ...(arena.tokens || []).map((t) => `${t.x},${t.y}`),
      ...(arena.chests || []).map((c) => `${c.x},${c.y}`),
    ]);
    const gen = generateArenaTerrainFromPrompt(
      String(payload.prompt || beat.narration || beat.title),
      arena.cols,
      arena.rows,
      String(payload.biome || ''),
      occ,
    );
    arena.biome = gen.biome;
    arena.terrain = gen.terrain;
  } else if (sub === 'add_beat_chest') {
    arena.chests.push({
      id: `chest-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name: String(payload.name || 'Treasure Chest').slice(0, 50),
      x: Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x || 0)))),
      y: Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y || 0)))),
      gold: Math.max(0, payload.gold !== undefined && payload.gold !== '' ? Number(payload.gold) : 50),
      manaStones: Math.max(0, payload.manaStones !== undefined && payload.manaStones !== '' ? Number(payload.manaStones) : 1),
      itemName: String(payload.itemName || '').slice(0, 50),
      itemCategory: String(payload.itemCategory || 'relic'),
      opened: false,
    });
  } else if (sub === 'remove_beat_chest') {
    arena.chests = arena.chests.filter((c) => c.id !== payload.chestId);
  } else if (sub === 'add_beat_npc') {
    const nx = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x || 0))));
    const ny = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y || 0))));
    const npcTok = createNpcArenaToken(payload, 0, arena.cols, arena.rows);
    npcTok.x = nx;
    npcTok.y = ny;
    arena.tokens.push(npcTok);
    arena.startPositions = arena.startPositions || {};
    arena.startPositions[npcTok.id] = { x: nx, y: ny };
  } else if (sub === 'talk_beat_npc') {
    const tok = (arena.tokens || []).find((t) => t.id === payload.tokenId && t.type === 'npc');
    if (!tok) return { status: 404, error: 'NPC not found in this arena.' };
    const cid = isDm && payload.characterId && ctx.state.characters[String(payload.characterId)]
      ? String(payload.characterId)
      : (ctx.characterId && ctx.state.characters[ctx.characterId] ? ctx.characterId : Object.keys(ctx.state.characters)[0]);
    const ch = cid ? ctx.state.characters[cid] : null;
    const rewardNotes: string[] = [];

    if (ch && !tok.rewardClaimed && tok.rewardType && tok.rewardType !== 'none') {
      tok.rewardClaimed = true;
      if (tok.rewardType === 'xp' && (tok.rewardXp || 0) > 0) {
        grantXpToCharacter(ctx.state, ch, Number(tok.rewardXp || 0));
        rewardNotes.push(`+${tok.rewardXp} XP`);
      } else if (tok.rewardType === 'item' && tok.rewardItemName) {
        ch.inventory = ch.inventory || [];
        ch.inventory.push(
          createInventoryItem({
            name: tok.rewardItemName,
            category: tok.rewardItemCategory || 'relic',
            notes: `Gifted by ${tok.name}`,
          }),
        );
        rewardNotes.push(`Item: ${tok.rewardItemName}`);
      } else if (tok.rewardType === 'skill_book' && tok.rewardItemName) {
        const cleanSkillName = tok.rewardItemName.replace(/^skill\s*book:\s*/i, '').trim() || tok.rewardItemName;
        ch.inventory = ch.inventory || [];
        ch.inventory.push(
          createInventoryItem({
            name: `Skill Book: ${cleanSkillName}`,
            category: 'skill_book',
            slot: 'relic',
            notes: tok.rewardSkillDesc || `Skill Book gifted by ${tok.name}`,
          }),
        );
        ch.skills = ch.skills || [];
        if (!ch.skills.some((s) => s.name.toLowerCase() === cleanSkillName.toLowerCase())) {
          ch.skills.push({
            id: `sk-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
            name: cleanSkillName,
            rank: 'E',
            mpCost: 5,
            cooldown: '1 turn',
            description: tok.rewardSkillDesc || `Learned from ${tok.name}'s Skill Book.`,
          });
        }
        rewardNotes.push(`Skill Book: ${cleanSkillName}`);
      }
      if ((tok.rewardGold || 0) > 0) {
        ch.currency = ch.currency || { gold: 0, manaStones: 0 };
        ch.currency.gold = Number(ch.currency.gold || 0) + Number(tok.rewardGold || 0);
        rewardNotes.push(`${tok.rewardGold}G`);
      }
    }

    const dialogue = tok.dialogue || `Greetings, Climber.`;
    const rewardSummary = rewardNotes.join(', ');
    pushSystemToast(ctx, {
      title: `${tok.name.toUpperCase()} (${tok.npcRole || 'NPC'})`,
      message: rewardSummary ? `"${dialogue}" — Received: ${rewardSummary}` : `"${dialogue}"`,
      category: rewardSummary ? 'loot' : 'info',
      target: ch ? ch.id : 'all',
    });
    if (ch) {
      logPlayerHistory(ctx.state, ch.id, 'npc', `Spoke with ${tok.name}${rewardSummary ? ` (Received: ${rewardSummary})` : ''}`);
    }
  } else if (sub === 'remove_beat_npc') {
    arena.tokens = arena.tokens.filter((t) => !(t.type === 'npc' && t.id === payload.tokenId));
  } else if (sub === 'open_beat_chest') {
    const chest = (arena.chests || []).find((c) => c.id === payload.chestId);
    if (!chest) return { status: 404, error: 'Treasure chest not found.' };
    if (chest.opened) return { status: 400, error: 'Treasure chest already opened.' };
    chest.opened = true;
    const recipientIds = isDm && payload.characterId && ctx.state.characters[String(payload.characterId)]
      ? [String(payload.characterId)]
      : (ctx.characterId && ctx.state.characters[ctx.characterId] ? [ctx.characterId] : Object.keys(ctx.state.characters));

    for (const cid of recipientIds) {
      const ch = ctx.state.characters[cid];
      if (!ch) continue;
      ch.currency = ch.currency || { gold: 0, manaStones: 0 };
      ch.currency.gold = Number(ch.currency.gold || 0) + Number(chest.gold || 0);
      ch.currency.manaStones = Number(ch.currency.manaStones || 0) + Number(chest.manaStones || 0);
      if (chest.itemName) {
        ch.inventory = ch.inventory || [];
        ch.inventory.push(
          createInventoryItem({
            name: chest.itemName,
            category: chest.itemCategory || 'relic',
            notes: `Found in ${chest.name}`,
          }),
        );
      }
    }
    const rewards = [chest.gold ? `${chest.gold}G` : '', chest.manaStones ? `${chest.manaStones} Stones` : '', chest.itemName || ''].filter(Boolean).join(', ');
    pushSystemToast(ctx, {
      title: 'TREASURE CHEST OPENED!',
      message: `${chest.name} opened! Rewards: ${rewards || 'Empty'}`,
      category: 'loot',
    });
    for (const cid of recipientIds) {
      logPlayerHistory(ctx.state, cid, 'loot', `Opened ${chest.name}${rewards ? `: ${rewards}` : ''}`);
    }
  } else if (sub === 'toggle_beat_player') {
    const cid = String(payload.characterId || '');
    const ch = ctx.state.characters[cid];
    if (!ch) return { status: 404, error: 'Player character not found.' };
    const existingIdx = arena.tokens.findIndex((t) => t.id === cid);
    if (existingIdx >= 0) {
      arena.tokens.splice(existingIdx, 1);
    } else {
      arena.tokens.push({
        id: ch.id,
        name: ch.name.split(' ')[0],
        type: 'player',
        x: Math.floor(arena.cols / 2),
        y: Math.max(0, arena.rows - 4),
        color: '#38bdf8',
        hp: ch.hp,
        maxHp: ch.maxHp,
        hiddenFromPlayers: false,
        label: ch.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'PL',
      });
    }
  } else if (sub === 'move_beat_token') {
    const tok = arena.tokens.find((t) => t.id === payload.tokenId);
    if (!tok) return { status: 404, error: 'Arena token not found.' };
    if (!isDm && tok.type !== 'player') return { status: 403, error: 'Players cannot move monster tokens.' };
    if (!isDm && ctx.characterId && tok.id !== ctx.characterId) {
      return { status: 403, error: 'Players can only move their own token.' };
    }
    const nx = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x))));
    const ny = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y))));
    if (!isDm) {
      if (tok.hasMovedThisTurn) {
        return { status: 400, error: 'You have already moved this turn! Wait until your next turn.' };
      }
      const ch = ctx.state.characters[tok.id];
      const maxSpaces = Math.max(1, Number(ch?.speedSpaces || 6));
      const dist = Math.abs(nx - Number(tok.x || 0)) + Math.abs(ny - Number(tok.y || 0));
      if (dist === 0) return { status: 400, error: 'You are already on that space.' };
      if (dist > maxSpaces) {
        return { status: 400, error: `Out of movement range! You can move up to ${maxSpaces} Spaces (attempted ${dist}).` };
      }
    }
    const blocked = (arena.terrain || []).find((t) => t.x === nx && t.y === ny);
    if (blocked) {
      return { status: 400, error: `Impassable terrain (${blocked.type}) blocks that space!` };
    }
    tok.x = nx;
    tok.y = ny;
    if (!isDm) tok.hasMovedThisTurn = true;
    if (tok.type === 'player' && Array.isArray(arena.manaStones) && arena.manaStones.length > 0) {
      const pickedIdx = arena.manaStones.findIndex((s) => s.x === nx && s.y === ny);
      if (pickedIdx !== -1) {
        const [stone] = arena.manaStones.splice(pickedIdx, 1);
        const ch = ctx.state.characters[tok.id];
        if (ch) {
          const qty = Number(stone.qty || 1);
          ch.currency = ch.currency || { gold: 0, manaStones: 0 };
          ch.currency.manaStones = Number(ch.currency.manaStones || 0) + qty;
          logPlayerHistory(ctx.state, ch.id, 'loot', `Picked up +${qty} Mana Stone from the arena`);
          pushSystemToast(ctx, {
            title: 'MANA STONE PICKED UP!',
            message: `${ch.name} collected +${qty} Mana Stone!`,
            category: 'loot',
            target: ch.id,
          });
        }
      }
    }
  } else if (sub === 'observe_beat_cell') {
    const targetTokId = isDm && payload.tokenId ? String(payload.tokenId) : String(ctx.characterId || payload.tokenId || '');
    const tok = arena.tokens.find((t) => t.id === targetTokId);
    if (!tok) return { status: 404, error: 'Arena token not found.' };
    if (!isDm && tok.hasObservedThisTurn) {
      return { status: 400, error: 'You have already used Observe this turn! Wait until your next turn.' };
    }
    const ox = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x))));
    const oy = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y))));
    const dist = Math.max(Math.abs(ox - Number(tok.x || 0)), Math.abs(oy - Number(tok.y || 0)));
    if (!isDm && dist > 3) {
      return { status: 400, error: `Out of Observe range! Max 3 Spaces (selected ${dist}).` };
    }
    if (!isDm) tok.hasObservedThisTurn = true;
    const monTok = arena.tokens.find((t) => t.x === ox && t.y === oy && t.type === 'monster');
    if (monTok) {
      const ch = ctx.state.characters[tok.id];
      const mon = ctx.state.monsters.find((m) => m.id === monTok.id);
      const floor = Math.max(1, Number(beat.floor || ch?.currentFloor || ctx.state.map?.currentFloor || 1));
      const perScore = Number(ch?.stats?.PER ?? 10);
      const perMod = computeStatModifier(perScore, ctx.state.mechanics, ch);
      const successChancePct = Math.max(15, Math.min(90, 35 + perMod * 8 - (floor - 1) * 3));
      const rollPct = crypto.randomInt(1, 101);
      const weakSpotFound = rollPct <= successChancePct;
      const bonusDamage = 2 + Math.floor(floor * 1.5);
      const bonusCritDamage = 4 + floor * 2;
      if (weakSpotFound && ch) {
        ch.observedWeakSpots = ch.observedWeakSpots || {};
        ch.observedWeakSpots[monTok.id] = {
          monsterId: monTok.id,
          monsterName: monTok.name,
          floor,
          bonusDamage,
          bonusCritDamage,
          discoveredAt: new Date().toISOString(),
        };
        logPlayerHistory(ctx.state, ch.id, 'combat', `Observed weak spot on ${monTok.name} (Floor ${floor}F): +${bonusDamage} dmg, +${bonusCritDamage} crit dmg`);
        pushSystemToast(ctx, {
          title: `WEAK SPOT FOUND: ${monTok.name}!`,
          message: `${ch.name} spotted a weak point (+${bonusDamage} Damage, +${bonusCritDamage} Crit Damage)!`,
          category: 'combat',
          target: ch.id,
        });
      }
      commitState(ctx);
      return {
        ok: true,
        observedMonster: true,
        weakSpotFound,
        successChancePct,
        rollPct,
        floor,
        bonusDamage,
        bonusCritDamage,
        monster: mon ? maskMonsterForRole(mon, ctx.state, ctx.role) : null,
        beat,
      };
    }
  } else if (sub === 'save_beat_starts') {
    arena.startPositions = arena.startPositions || {};
    for (const tok of arena.tokens) {
      arena.startPositions[tok.id] = { x: tok.x, y: tok.y };
    }
  } else if (sub === 'reset_beat_starts') {
    const starts = arena.startPositions || {};
    for (const tok of arena.tokens) {
      if (starts[tok.id]) {
        tok.x = Math.max(0, Math.min(arena.cols - 1, starts[tok.id].x));
        tok.y = Math.max(0, Math.min(arena.rows - 1, starts[tok.id].y));
      }
    }
  } else if (sub === 'spawn_beat_monsters') {
    if (!beat.encounters?.length) return { status: 400, error: 'No monsters attached to this story beat.' };
    const spawned: Monster[] = [];
    const startX = Math.max(0, Math.floor(arena.cols / 2) - Math.floor(beat.encounters.length / 2));
    for (let idx = 0; idx < beat.encounters.length; idx++) {
      const enc = beat.encounters[idx];
      const res = spawnMonsterAction(ctx, {
        ...enc,
        floor: enc.floor || beat.floor || 2,
      });
      const spawnedMon = res.monster as Monster | undefined;
      if (spawnedMon) {
        spawned.push(spawnedMon);
        const mx = enc.startX !== undefined && enc.startX !== '' && enc.startX !== null
          ? Math.max(0, Math.min(arena.cols - 1, Number(enc.startX) - 1))
          : Math.min(arena.cols - 1, startX + idx * 2);
        const my = enc.startY !== undefined && enc.startY !== '' && enc.startY !== null
          ? Math.max(0, Math.min(arena.rows - 1, Number(enc.startY) - 1))
          : Math.min(arena.rows - 1, 3);
        arena.tokens.push({
          id: spawnedMon.id,
          name: spawnedMon.name,
          type: 'monster',
          x: mx,
          y: my,
          color: '#ef4444',
          hp: spawnedMon.hp,
          maxHp: spawnedMon.maxHp,
          hiddenFromPlayers: Boolean(spawnedMon.hiddenFromPlayers),
          label: spawnedMon.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'MN',
        });
      }
    }
    commitState(ctx);
    return { ok: true, spawned };
  } else if (sub === 'award_beat_treasure') {
    if (!beat.treasures?.length) return { status: 400, error: 'No treasures attached to this story beat.' };
    const targetIds = payload.characterId && payload.characterId !== 'all'
      ? [String(payload.characterId)]
      : Object.keys(ctx.state.characters);
    for (const cid of targetIds) {
      const ch = ctx.state.characters[cid];
      if (!ch) continue;
      ch.currency = ch.currency || { gold: 0, manaStones: 0 };
      ch.inventory = ch.inventory || [];
      for (const tr of beat.treasures) {
        ch.currency.gold = Number(ch.currency.gold || 0) + Number(tr.gold || 0);
        ch.currency.manaStones = Number(ch.currency.manaStones || 0) + Number(tr.manaStones || 0);
        if (tr.name) {
          ch.inventory.push(
            createInventoryItem({
              name: tr.name,
              category: tr.category || 'relic',
              qty: Math.max(1, Number(tr.qty || 1)),
              healHp: Number(tr.healHp || 0),
              healMp: Number(tr.healMp || 0),
              slot: (tr.slot || undefined) as EquipmentSlot | '' | undefined,
              attackBonus: Number(tr.attackBonus || 0),
              damageDice: String(tr.damageDice || ''),
              damageType: String(tr.damageType || 'Physical'),
              rangeSpaces: Number(tr.rangeSpaces || 2),
              drBonus: Number(tr.drBonus || 0),
              acBonus: Number(tr.acBonus || 0),
              notes: String(tr.notes || `Reward from ${beat.title}`),
            }),
          );
        }
      }
    }
    const lootSummary = beat.treasures.map((t) => `${t.name}${t.gold ? ` + ${t.gold}G` : ''}`).join(', ');
    pushSystemToast(ctx, {
      title: 'TREASURE AWARDED!',
      message: `From "${beat.title}": ${lootSummary}`,
      category: 'loot',
      target: payload.characterId && payload.characterId !== 'all' ? String(payload.characterId) : 'all',
    });
  } else if (sub === 'award_beat_xp') {
    const xpAmt = Math.max(0, Number(payload.xpReward ?? beat.xpReward ?? 0));
    if (!xpAmt) return { status: 400, error: 'This story beat has no XP reward.' };
    const targetIds = payload.characterId && payload.characterId !== 'all'
      ? [String(payload.characterId)]
      : Object.keys(ctx.state.characters);
    for (const cid of targetIds) {
      const ch = ctx.state.characters[cid];
      if (!ch) continue;
      grantXpToCharacter(ctx.state, ch, xpAmt);
    }
    pushSystemToast(ctx, {
      title: 'XP AWARDED!',
      message: `+${xpAmt} XP awarded from "${beat.title}"!`,
      category: 'loot',
      target: payload.characterId && payload.characterId !== 'all' ? String(payload.characterId) : 'all',
    });
  } else if (sub === 'update_beat') {
    if (payload.title !== undefined && String(payload.title).trim()) {
      beat.title = String(payload.title).trim().slice(0, 80);
    }
    if (payload.floor !== undefined) beat.floor = Math.max(1, Number(payload.floor || 1));
    if (payload.xpReward !== undefined) beat.xpReward = Math.max(0, Number(payload.xpReward || 0));
    if (payload.narration !== undefined) beat.narration = String(payload.narration || '').slice(0, 800);
    if (payload.dmSecret !== undefined) beat.dmSecret = String(payload.dmSecret || '').slice(0, 500);
    if (payload.presented !== undefined) {
      beat.presented = Boolean(payload.presented);
      if (beat.presented && beat.status === 'upcoming') beat.status = 'active';
    }
    if (typeof payload.status === 'string' && ['upcoming', 'active', 'resolved'].includes(payload.status)) {
      beat.status = payload.status;
    }
    if (payload.gridSize || payload.gridCols || payload.gridRows) {
      const cols = Math.max(5, Math.min(100, Number(payload.gridCols || payload.gridSize || arena.cols)));
      const rows = Math.max(5, Math.min(100, Number(payload.gridRows || payload.gridSize || arena.rows)));
      clampArenaEntitiesToBounds(arena, cols, rows);
    }
    if (Array.isArray(payload.encounters)) beat.encounters = payload.encounters as BeatEncounterSpec[];
    if (Array.isArray(payload.treasures)) beat.treasures = payload.treasures as BeatTreasureSpec[];
  } else if (sub === 'delete_beat') {
    ctx.state.storyBeats = ctx.state.storyBeats.filter((b) => b.id !== beat.id);
  }

  commitState(ctx);
  return { ok: true, beat, storyBeats: ctx.state.storyBeats };
}
