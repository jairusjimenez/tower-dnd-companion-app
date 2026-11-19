import {
  VALID_BIOME_THEMES,
  commitState,
  defaultThemeForFloor,
  pushNewFloorToTowerMap,
  pushSystemToast,
} from '../services/gameHelpers';
import type { ActionRequestContext, ActionResult } from './types';

export function moveTokenAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const isDm = ctx.role === 'dm';
  const tok = ctx.state.map.tokens.find((t) => t.id === payload.tokenId);
  if (!tok) return { status: 404, error: 'Token not found.' };
  if (!isDm && tok.type !== 'player') return { status: 403, error: 'Players cannot move monster tokens.' };
  if (!isDm && ctx.characterId && tok.id !== ctx.characterId) {
    return { status: 403, error: 'Players can only move their own character token.' };
  }
  tok.x = Math.max(0, Math.min(ctx.state.map.cols - 1, Math.trunc(Number(payload.x))));
  tok.y = Math.max(0, Math.min(ctx.state.map.rows - 1, Math.trunc(Number(payload.y))));
  commitState(ctx);
  return { ok: true, token: tok };
}

export function updateMapAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const isDm = ctx.role === 'dm';
  const sub = String(payload.subAction || '');

  if (sub === 'ping') {
    ctx.state.map.pings.push({
      id: `ping-${Date.now()}`,
      x: Number(payload.x || 0),
      y: Number(payload.y || 0),
      color: isDm ? '#f59e0b' : '#38bdf8',
      createdAt: Date.now(),
    });
    ctx.state.map.pings = ctx.state.map.pings.filter((p) => Date.now() - p.createdAt < 10000);
    commitState(ctx);
    return { ok: true };
  }

  if (!isDm) return { status: 403, error: 'Only the Dungeon Master can edit the Tower map & Fog of War.' };

  if (sub === 'toggle_fog_cell') {
    const key = `${Number(payload.x)},${Number(payload.y)}`;
    const set = new Set(ctx.state.map.fog);
    if (payload.covered === true) set.add(key);
    else if (payload.covered === false) set.delete(key);
    else if (set.has(key)) set.delete(key);
    else set.add(key);
    ctx.state.map.fog = Array.from(set);
  } else if (sub === 'floor_fog') {
    const floor = ctx.state.map.floors.find((f) => Number(f.number) === Number(payload.floorNumber));
    if (floor) {
      const set = new Set(ctx.state.map.fog);
      for (let y = floor.rowStart; y <= floor.rowEnd; y++) {
        for (let x = 0; x < ctx.state.map.cols; x++) {
          const key = `${x},${y}`;
          if (payload.covered) set.add(key);
          else set.delete(key);
        }
      }
      ctx.state.map.fog = Array.from(set);
    }
  } else if (sub === 'set_fog_bulk') {
    if (payload.mode === 'reveal_all') {
      ctx.state.map.fog = [];
    } else if (payload.mode === 'cover_all') {
      const all: string[] = [];
      for (let y = 0; y < ctx.state.map.rows; y++) {
        for (let x = 0; x < ctx.state.map.cols; x++) all.push(`${x},${y}`);
      }
      ctx.state.map.fog = all;
    }
  } else if (sub === 'add_floor') {
    const newFloor = pushNewFloorToTowerMap(ctx.state, {
      title: payload.title ? String(payload.title) : undefined,
      theme: payload.theme ? String(payload.theme) : undefined,
      safeZone: Boolean(payload.safeZone),
      description: payload.description ? String(payload.description) : 'Newly unlocked vertical tower floor.',
      startFogged: payload.startFogged !== false,
    });
    pushSystemToast(ctx, {
      title: `NEW TOWER FLOOR ADDED (${newFloor.number}F)`,
      message: `The Tower expanded vertically! ${newFloor.title} awaits above.`,
      category: 'info',
    });
  } else if (sub === 'set_floor_theme') {
    const fl = ctx.state.map.floors.find((f) => Number(f.number) === Number(payload.floorNumber));
    if (!fl) return { status: 404, error: 'Tower floor not found.' };
    if (typeof payload.theme === 'string' && VALID_BIOME_THEMES.includes(payload.theme)) fl.theme = payload.theme;
    if (payload.title) fl.title = String(payload.title).slice(0, 60);
  } else if (sub === 'apply_tower_themes') {
    const targetCount = Math.max(ctx.state.map.floors.length, Math.min(20, Number(payload.ensureFloors || ctx.state.map.floors.length)));
    while (ctx.state.map.floors.length < targetCount) {
      pushNewFloorToTowerMap(ctx.state, { startFogged: false });
    }
    if (Array.isArray(payload.floors)) {
      for (const item of payload.floors as Array<{ number?: number; theme?: string; title?: string }>) {
        const fl = ctx.state.map.floors.find((f) => Number(f.number) === Number(item.number));
        if (fl && item.theme && VALID_BIOME_THEMES.includes(item.theme)) {
          fl.theme = item.theme;
          if (item.title) fl.title = String(item.title).slice(0, 60);
        }
      }
    } else if (payload.preset) {
      const presetMap: Record<string, (n: number) => string> = {
        classic: (n) => defaultThemeForFloor(n),
        all_forest: () => 'forest',
        all_desert: () => 'desert',
        all_underworld: () => 'underworld',
        all_obsidian: () => 'obsidian',
      };
      const pick = presetMap[String(payload.preset)] || presetMap.classic;
      for (const fl of ctx.state.map.floors) {
        fl.theme = pick(fl.number);
      }
    }
  } else if (sub === 'delete_floor') {
    const floorNum = Number(payload.floorNumber);
    if (ctx.state.map.floors.length <= 1) {
      return { status: 400, error: 'Cannot delete the only remaining floor in the Tower.' };
    }
    const fl = ctx.state.map.floors.find((f) => Number(f.number) === floorNum);
    if (!fl) return { status: 404, error: 'Tower floor not found.' };
    const span = Math.max(1, fl.rowEnd - fl.rowStart + 1);
    ctx.state.map.floors = ctx.state.map.floors.filter((f) => Number(f.number) !== floorNum);
    for (const f of ctx.state.map.floors) {
      if (f.rowStart > fl.rowStart) {
        f.rowStart -= span;
        f.rowEnd -= span;
        f.portalRow -= span;
      }
    }
    ctx.state.map.rows = Math.max(5, ctx.state.map.rows - span);
    const fallbackFloor = ctx.state.map.floors[ctx.state.map.floors.length - 1];
    const nextTokens = [];
    for (const t of ctx.state.map.tokens) {
      if (t.y >= fl.rowStart && t.y <= fl.rowEnd) {
        if (t.type === 'player' && fallbackFloor) {
          t.y = fallbackFloor.portalRow;
          nextTokens.push(t);
        }
      } else {
        if (t.y > fl.rowEnd) t.y -= span;
        nextTokens.push(t);
      }
    }
    ctx.state.map.tokens = nextTokens;
    ctx.state.map.fog = (ctx.state.map.fog || [])
      .filter((k) => {
        const [, y] = k.split(',').map(Number);
        return y < fl.rowStart || y > fl.rowEnd;
      })
      .map((k) => {
        const [x, y] = k.split(',').map(Number);
        return y > fl.rowEnd ? `${x},${y - span}` : k;
      });
    const removedMonsterIds = new Set(
      (ctx.state.monsters || []).filter((m) => Number(m.floor) === floorNum).map((m) => m.id),
    );
    ctx.state.storyBeats = (ctx.state.storyBeats || []).filter((b) => Number(b.floor) !== floorNum);
    ctx.state.monsters = (ctx.state.monsters || []).filter((m) => Number(m.floor) !== floorNum);
    if (removedMonsterIds.size > 0) {
      ctx.state.combat.combatants = ctx.state.combat.combatants.filter((c) => !removedMonsterIds.has(c.id));
      ctx.state.pendingReactions = (ctx.state.pendingReactions || []).filter((r) => !removedMonsterIds.has(r.monsterId));
      if (ctx.state.combat.combatants.length === 0) {
        ctx.state.combat.turnIndex = 0;
      } else if (ctx.state.combat.turnIndex >= ctx.state.combat.combatants.length) {
        ctx.state.combat.turnIndex = ctx.state.combat.turnIndex % ctx.state.combat.combatants.length;
      }
    }
  } else if (sub === 'set_theme') {
    ctx.state.map.theme = String(payload.theme || 'obsidian-spire');
  }

  commitState(ctx);
  return { ok: true, map: ctx.state.map };
}
