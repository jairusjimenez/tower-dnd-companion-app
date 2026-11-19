import {
  getMaxAttacksForFloor,
  getWeaponAttackInfo,
  type FilteredGameState,
  type SessionIdentity,
  type StoryBeat,
} from '@shared/index';
import {
  drawArenaBackground,
  drawChestIcon,
  drawManaStoneCrystal,
  drawTerrainTile,
  drawTokenAvatar,
} from './drawPrimitives';

export type BeatActionMode = 'move' | 'attack' | 'observe' | 'chest' | 'npc' | 'select' | string;

export interface DrawBeatArenaOptions {
  canvas: HTMLCanvasElement;
  beat: StoryBeat;
  cellPx: number;
  selectedTokenId?: string | null;
  beatActionMode?: BeatActionMode;
  session?: SessionIdentity | null;
  state?: FilteredGameState | null;
  onPortraitLoaded?: () => void;
}

export function drawBeatArenaCanvas({
  canvas,
  beat,
  cellPx,
  selectedTokenId = null,
  beatActionMode = 'select',
  session = null,
  state = null,
  onPortraitLoaded,
}: DrawBeatArenaOptions): void {
  const arena = beat.arena || { cols: 20, rows: 20, biome: 'obsidian', terrain: [], tokens: [], chests: [] };
  const cols = arena.cols || 20;
  const rows = arena.rows || 20;
  const axisPad = 24;
  const w = axisPad + cols * cellPx;
  const h = axisPad + rows * cellPx;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const biome = arena.biome || 'obsidian';
  drawArenaBackground(ctx, biome, axisPad, cols, rows, cellPx, w, h);

  if (
    session?.role !== 'dm'
    && session?.characterId
    && (beatActionMode === 'move' || beatActionMode === 'attack' || beatActionMode === 'observe')
  ) {
    const myTok = (arena.tokens || []).find((t) => t.id === session.characterId);
    const me = state?.characters?.[session.characterId];

    if (myTok && me && beatActionMode === 'move' && !myTok.hasMovedThisTurn) {
      const maxSpaces = Math.max(1, Number(me.speedSpaces || 6));
      const blockedSet = new Set((arena.terrain || []).map((t) => `${t.x},${t.y}`));
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1;
      for (let dy = -maxSpaces; dy <= maxSpaces; dy++) {
        for (let dx = -maxSpaces; dx <= maxSpaces; dx++) {
          if ((dx === 0 && dy === 0) || Math.abs(dx) + Math.abs(dy) > maxSpaces) continue;
          const gx = myTok.x + dx;
          const gy = myTok.y + dy;
          if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) continue;
          if (blockedSet.has(`${gx},${gy}`)) continue;
          const px = axisPad + gx * cellPx;
          const py = axisPad + gy * cellPx;
          ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
          ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        }
      }
      ctx.restore();
    } else if (myTok && me && beatActionMode === 'attack') {
      const floor = Math.max(1, Number(beat.floor || me.currentFloor || 1));
      const maxAttacks = getMaxAttacksForFloor(floor);
      if (Number(myTok.attacksUsedThisTurn || 0) < maxAttacks) {
        const { maxRange } = getWeaponAttackInfo(me);
        ctx.save();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.16)';
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
        ctx.lineWidth = 1;
        for (let dy = -maxRange; dy <= maxRange; dy++) {
          for (let dx = -maxRange; dx <= maxRange; dx++) {
            if (dx === 0 && dy === 0) continue;
            const gx = myTok.x + dx;
            const gy = myTok.y + dy;
            if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) continue;
            const px = axisPad + gx * cellPx;
            const py = axisPad + gy * cellPx;
            ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
            ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
          }
        }
        ctx.restore();
      }
    } else if (myTok && me && beatActionMode === 'observe' && !myTok.hasObservedThisTurn) {
      const obsRange = 3;
      ctx.save();
      ctx.fillStyle = 'rgba(34, 197, 94, 0.14)';
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.45)';
      ctx.lineWidth = 1;
      for (let dy = -obsRange; dy <= obsRange; dy++) {
        for (let dx = -obsRange; dx <= obsRange; dx++) {
          if (dx === 0 && dy === 0) continue;
          const gx = myTok.x + dx;
          const gy = myTok.y + dy;
          if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) continue;
          const px = axisPad + gx * cellPx;
          const py = axisPad + gy * cellPx;
          ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
          ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        }
      }
      ctx.restore();
    }
  }

  for (const tile of arena.terrain || []) {
    const cx = axisPad + tile.x * cellPx + cellPx / 2;
    const cy = axisPad + tile.y * cellPx + cellPx / 2;
    drawTerrainTile(ctx, tile, cx, cy, cellPx, biome);
  }

  for (const chest of arena.chests || []) {
    const cx = axisPad + chest.x * cellPx + cellPx / 2;
    const cy = axisPad + chest.y * cellPx + cellPx / 2;
    drawChestIcon(ctx, chest, cx, cy, cellPx);
  }

  for (const stone of arena.manaStones || []) {
    const cx = axisPad + stone.x * cellPx + cellPx / 2;
    const cy = axisPad + stone.y * cellPx + cellPx / 2;
    drawManaStoneCrystal(ctx, cx, cy, cellPx);
  }

  for (const tok of arena.tokens || []) {
    if (tok.type === 'monster') {
      const liveMon = (state?.monsters || []).find((m) => m.id === tok.id);
      if (liveMon && Number(liveMon.hp) <= 0) continue;
    }
    const cx = axisPad + tok.x * cellPx + cellPx / 2;
    const cy = axisPad + tok.y * cellPx + cellPx / 2;
    const r = Math.max(9, Math.floor(cellPx * 0.4));

    drawTokenAvatar(ctx, tok, cx, cy, r, selectedTokenId === tok.id, state?.characters, onPortraitLoaded);

    if (tok.maxHp && tok.maxHp > 0 && tok.hp !== null) {
      const bw = cellPx - 6;
      const pct = Math.max(0, Math.min(1, tok.hp / tok.maxHp));
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(cx - bw / 2, cy + r + 2, bw, 4);
      ctx.fillStyle = tok.type === 'monster' ? '#ef4444' : '#22c55e';
      ctx.fillRect(cx - bw / 2, cy + r + 2, bw * pct, 4);
    }
  }
}
