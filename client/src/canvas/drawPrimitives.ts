import {
  TOKEN_ICON_META,
  extractTokenNumberBadge,
  inferMonsterIconId,
  inferNpcIconId,
  isBossToken,
  type ArenaTerrainTile,
  type Character,
  type MapChest,
  type MapToken,
  type TokenIconId,
} from '@shared/index';
import { drawBossCrown, drawNumberPip, drawVectorTokenIcon } from './drawTokenIcons';

interface CachedPortrait {
  img: HTMLImageElement;
  loaded: boolean;
}

const portraitCache = new Map<string, CachedPortrait>();

export function getPortraitImage(url: string | undefined, onLoaded?: () => void): HTMLImageElement | null {
  if (!url) return null;
  const existing = portraitCache.get(url);
  if (existing) {
    return existing.loaded ? existing.img : null;
  }
  const img = new Image();
  const record: CachedPortrait = { img, loaded: false };
  portraitCache.set(url, record);
  img.onload = () => {
    record.loaded = true;
    onLoaded?.();
  };
  img.src = url;
  return null;
}

export function drawChestIcon(
  ctx: CanvasRenderingContext2D,
  chest: Pick<MapChest, 'opened' | 'tier'>,
  cx: number,
  cy: number,
  size: number,
): void {
  const half = Math.max(7, Math.floor(size * 0.36));
  const tierColors: Record<string, { body: string; trim: string; glow?: string }> = {
    Common: { body: '#78350f', trim: '#d97706' },
    Uncommon: { body: '#065f46', trim: '#34d399', glow: 'rgba(52, 211, 153, 0.5)' },
    Rare: { body: '#075985', trim: '#38bdf8', glow: 'rgba(56, 189, 248, 0.6)' },
    Epic: { body: '#581c87', trim: '#c084fc', glow: 'rgba(192, 132, 252, 0.7)' },
    Legendary: { body: '#b45309', trim: '#fbbf24', glow: 'rgba(251, 191, 36, 0.8)' },
    Mythic: { body: '#881337', trim: '#fb7185', glow: 'rgba(251, 113, 133, 0.85)' },
  };
  const pal = tierColors[chest.tier || 'Common'] || tierColors.Common;
  ctx.save();
  if (chest.opened) ctx.globalAlpha = 0.45;
  else if (pal.glow) {
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = 8;
  }
  ctx.fillStyle = pal.body;
  ctx.strokeStyle = pal.trim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cx - half, cy - half * 0.75, half * 2, half * 1.5, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = pal.trim;
  ctx.fillRect(cx - half, cy - 2, half * 2, 3);
  ctx.fillRect(cx - 2.5, cy - 3.5, 5, 6);
  ctx.restore();
}

export function drawManaStoneCrystal(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const r = Math.max(7, Math.floor(size * 0.36));
  ctx.save();
  ctx.shadowColor = 'rgba(56, 189, 248, 0.85)';
  ctx.shadowBlur = 10;
  const grad = ctx.createLinearGradient(cx - r * 0.6, cy - r, cx + r * 0.6, cy + r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.45, '#bae6fd');
  grad.addColorStop(1, '#0284c7');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#e0f2fe';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r * 0.62, cy - r * 0.25);
  ctx.lineTo(cx + r * 0.48, cy + r * 0.65);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r * 0.48, cy + r * 0.65);
  ctx.lineTo(cx - r * 0.62, cy - r * 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.92);
  ctx.lineTo(cx - r * 0.5, cy - r * 0.2);
  ctx.lineTo(cx, cy + r * 0.15);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(56, 189, 248, 0.5)';
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.15);
  ctx.lineTo(cx + r * 0.54, cy - r * 0.2);
  ctx.lineTo(cx + r * 0.4, cy + r * 0.58);
  ctx.lineTo(cx, cy + r * 0.92);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawTokenAvatar(
  ctx: CanvasRenderingContext2D,
  tok: Pick<MapToken, 'id' | 'name' | 'type' | 'color' | 'label' | 'hiddenFromPlayers' | 'iconId' | 'npcRole'> & { isBoss?: boolean },
  cx: number,
  cy: number,
  r: number,
  selected: boolean,
  characters: Record<string, Character> | undefined,
  onPortraitLoaded?: () => void,
): void {
  const ch = tok.type === 'player' ? characters?.[tok.id] : null;
  const img = ch?.portraitUrl ? getPortraitImage(ch.portraitUrl, onPortraitLoaded) : null;
  const isMonster = tok.type === 'monster';
  const isNpc = tok.type === 'npc';
  const resolvedIcon: TokenIconId | null = isMonster
    ? tok.iconId || inferMonsterIconId(tok.name)
    : isNpc
      ? tok.iconId || inferNpcIconId(tok.name, tok.npcRole)
      : null;
  const boss = isMonster && (tok.isBoss ?? isBossToken(tok.name, tok.iconId));
  const numBadge = isMonster ? extractTokenNumberBadge(tok.name) : null;

  ctx.save();
  if (tok.hiddenFromPlayers) ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();

  if (img) {
    ctx.save();
    ctx.clip();
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  } else if (resolvedIcon) {
    const meta = TOKEN_ICON_META[resolvedIcon];
    const grad = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.1, cx, cy, r);
    grad.addColorStop(0, meta?.bg || (isMonster ? '#7f1d1d' : '#065f46'));
    grad.addColorStop(1, '#090d16');
    ctx.fillStyle = grad;
    ctx.fill();
    drawVectorTokenIcon(ctx, resolvedIcon, cx, cy, r);
  } else {
    ctx.fillStyle = tok.color || '#38bdf8';
    ctx.fill();
    ctx.fillStyle = '#020617';
    ctx.font = `bold ${Math.max(9, Math.floor(r * 0.72))}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(tok.label || tok.name.slice(0, 2).toUpperCase(), cx, cy + Math.floor(r * 0.25));
  }

  ctx.lineWidth = selected ? 3 : boss ? 2.5 : 2;
  ctx.strokeStyle = selected
    ? '#fbbf24'
    : boss
      ? '#fbbf24'
      : isMonster
        ? '#fca5a5'
        : isNpc
          ? '#6ee7b7'
          : '#7dd3fc';
  ctx.stroke();

  if (boss) {
    drawBossCrown(ctx, cx, cy, r);
  }
  if (numBadge) {
    drawNumberPip(ctx, numBadge, cx, cy, r);
  }
  ctx.restore();
}

export function drawArenaBackground(
  ctx: CanvasRenderingContext2D,
  biome: string,
  axisPad: number,
  cols: number,
  rows: number,
  cellPx: number,
  w: number,
  h: number,
): void {
  const palettes: Record<string, { bg: string; alt: string; grid: string; axis: string }> = {
    obsidian: { bg: '#070b14', alt: 'rgba(56, 189, 248, 0.03)', grid: 'rgba(56, 189, 248, 0.2)', axis: '#64748b' },
    forest: { bg: '#102116', alt: 'rgba(74, 222, 128, 0.05)', grid: 'rgba(74, 222, 128, 0.18)', axis: '#86efac' },
    feywild: { bg: '#131b26', alt: 'rgba(45, 212, 191, 0.06)', grid: 'rgba(45, 212, 191, 0.2)', axis: '#5eead4' },
    plains: { bg: '#1e2b15', alt: 'rgba(163, 230, 53, 0.05)', grid: 'rgba(163, 230, 53, 0.18)', axis: '#bef264' },
    murim_peaks: { bg: '#132024', alt: 'rgba(148, 163, 184, 0.06)', grid: 'rgba(148, 163, 184, 0.2)', axis: '#cbd5e1' },
    desert: { bg: '#2b1e10', alt: 'rgba(251, 191, 36, 0.06)', grid: 'rgba(251, 191, 36, 0.18)', axis: '#fcd34d' },
    frost: { bg: '#0c1d2e', alt: 'rgba(186, 230, 253, 0.06)', grid: 'rgba(125, 211, 252, 0.2)', axis: '#bae6fd' },
    red_gate: { bg: '#1b1322', alt: 'rgba(248, 113, 113, 0.06)', grid: 'rgba(125, 211, 252, 0.2)', axis: '#fca5a5' },
    shinsu_sea: { bg: '#071b2b', alt: 'rgba(56, 189, 248, 0.06)', grid: 'rgba(56, 189, 248, 0.24)', axis: '#7dd3fc' },
    elemental_water: { bg: '#071b2b', alt: 'rgba(56, 189, 248, 0.06)', grid: 'rgba(56, 189, 248, 0.24)', axis: '#7dd3fc' },
    sunken_temple: { bg: '#091f24', alt: 'rgba(45, 212, 191, 0.05)', grid: 'rgba(45, 212, 191, 0.2)', axis: '#5eead4' },
    demon_castle: { bg: '#1f0b10', alt: 'rgba(239, 68, 68, 0.06)', grid: 'rgba(248, 113, 113, 0.2)', axis: '#fca5a5' },
    nine_hells: { bg: '#220a0a', alt: 'rgba(249, 115, 22, 0.06)', grid: 'rgba(239, 68, 68, 0.22)', axis: '#fdba74' },
    elemental_fire: { bg: '#261009', alt: 'rgba(251, 146, 60, 0.06)', grid: 'rgba(251, 146, 60, 0.22)', axis: '#fdba74' },
    dragon_lair: { bg: '#1c1012', alt: 'rgba(245, 158, 11, 0.06)', grid: 'rgba(245, 158, 11, 0.2)', axis: '#fcd34d' },
    double_dungeon: { bg: '#0d1322', alt: 'rgba(99, 102, 241, 0.05)', grid: 'rgba(129, 140, 248, 0.2)', axis: '#a5b4fc' },
    arcane_library: { bg: '#141126', alt: 'rgba(168, 85, 247, 0.05)', grid: 'rgba(192, 132, 252, 0.2)', axis: '#d8b4fe' },
    underworld: { bg: '#140e1c', alt: 'rgba(168, 85, 247, 0.05)', grid: 'rgba(148, 163, 184, 0.18)', axis: '#c4b5fd' },
    underdark: { bg: '#110d1f', alt: 'rgba(192, 132, 252, 0.06)', grid: 'rgba(168, 85, 247, 0.22)', axis: '#d8b4fe' },
    shadowfell: { bg: '#11131a', alt: 'rgba(148, 163, 184, 0.05)', grid: 'rgba(100, 116, 139, 0.22)', axis: '#94a3b8' },
    necropolis: { bg: '#121518', alt: 'rgba(74, 222, 128, 0.04)', grid: 'rgba(148, 163, 184, 0.18)', axis: '#a7f3d0' },
    shadow_monarch: { bg: '#090916', alt: 'rgba(139, 92, 246, 0.07)', grid: 'rgba(139, 92, 246, 0.24)', axis: '#c4b5fd' },
    astral_sea: { bg: '#090d1f', alt: 'rgba(125, 211, 252, 0.06)', grid: 'rgba(125, 211, 252, 0.2)', axis: '#bae6fd' },
    sky_citadel: { bg: '#0f1b2e', alt: 'rgba(224, 242, 254, 0.05)', grid: 'rgba(125, 211, 252, 0.22)', axis: '#e0f2fe' },
  };
  const pal = palettes[biome] || palettes.obsidian;
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = pal.alt;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if ((x * 13 + y * 29) % 7 === 0) {
        ctx.fillRect(axisPad + x * cellPx, axisPad + y * cellPx, cellPx, cellPx);
      }
    }
  }

  ctx.fillStyle = pal.axis;
  ctx.font = `bold ${cellPx >= 36 ? 10 : 9}px Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  for (let x = 0; x < cols; x++) ctx.fillText(String(x + 1), axisPad + x * cellPx + cellPx / 2, axisPad - 8);
  for (let y = 0; y < rows; y++) ctx.fillText(String(y + 1), Math.floor(axisPad / 2), axisPad + y * cellPx + cellPx / 2 + 3);

  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= cols; x++) {
    ctx.beginPath();
    ctx.moveTo(axisPad + x * cellPx, axisPad);
    ctx.lineTo(axisPad + x * cellPx, h);
    ctx.stroke();
  }
  for (let y = 0; y <= rows; y++) {
    ctx.beginPath();
    ctx.moveTo(axisPad, axisPad + y * cellPx);
    ctx.lineTo(w, axisPad + y * cellPx);
    ctx.stroke();
  }
}

export function drawTerrainTile(
  ctx: CanvasRenderingContext2D,
  tile: ArenaTerrainTile,
  cx: number,
  cy: number,
  cellPx: number,
  biome: string,
): void {
  const half = cellPx / 2;
  const x0 = cx - half;
  const y0 = cy - half;
  if (tile.type === 'water') {
    ctx.fillStyle = biome === 'shinsu_sea' ? '#0284c7' : '#0369a1';
    ctx.fillRect(x0 + 1, y0 + 1, cellPx - 2, cellPx - 2);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(1, cellPx * 0.06);
    ctx.beginPath();
    ctx.moveTo(x0 + cellPx * 0.2, cy - cellPx * 0.14);
    ctx.quadraticCurveTo(cx, cy - cellPx * 0.24, x0 + cellPx * 0.8, cy - cellPx * 0.14);
    ctx.moveTo(x0 + cellPx * 0.22, cy + cellPx * 0.16);
    ctx.quadraticCurveTo(cx, cy + cellPx * 0.06, x0 + cellPx * 0.78, cy + cellPx * 0.16);
    ctx.stroke();
  } else if (tile.type === 'lava') {
    ctx.fillStyle = '#7c2d12';
    ctx.fillRect(x0 + 1, y0 + 1, cellPx - 2, cellPx - 2);
    ctx.fillStyle = '#ea580c';
    ctx.beginPath();
    ctx.roundRect(x0 + cellPx * 0.12, y0 + cellPx * 0.14, cellPx * 0.76, cellPx * 0.72, 4);
    ctx.fill();
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = Math.max(1.2, cellPx * 0.06);
    ctx.beginPath();
    ctx.moveTo(x0 + cellPx * 0.22, cy - cellPx * 0.12);
    ctx.lineTo(cx, cy + cellPx * 0.05);
    ctx.lineTo(x0 + cellPx * 0.78, cy - cellPx * 0.1);
    ctx.stroke();
  } else if (tile.type === 'ice') {
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath();
    ctx.moveTo(cx, cy - cellPx * 0.4);
    ctx.lineTo(cx + cellPx * 0.3, cy + cellPx * 0.08);
    ctx.lineTo(cx + cellPx * 0.18, cy + cellPx * 0.34);
    ctx.lineTo(cx - cellPx * 0.22, cy + cellPx * 0.34);
    ctx.lineTo(cx - cellPx * 0.32, cy + cellPx * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - cellPx * 0.34);
    ctx.lineTo(cx - cellPx * 0.14, cy + cellPx * 0.05);
    ctx.lineTo(cx, cy + cellPx * 0.2);
    ctx.closePath();
    ctx.fill();
  } else if (tile.type === 'crystal') {
    ctx.save();
    ctx.shadowColor = biome === 'shadow_monarch' ? 'rgba(167, 139, 250, 0.75)' : 'rgba(56, 189, 248, 0.75)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = biome === 'shadow_monarch' || biome === 'underdark' ? '#8b5cf6' : '#06b6d4';
    ctx.beginPath();
    ctx.moveTo(cx, cy - cellPx * 0.38);
    ctx.lineTo(cx + cellPx * 0.26, cy - cellPx * 0.05);
    ctx.lineTo(cx + cellPx * 0.18, cy + cellPx * 0.32);
    ctx.lineTo(cx - cellPx * 0.18, cy + cellPx * 0.32);
    ctx.lineTo(cx - cellPx * 0.26, cy - cellPx * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  } else if (tile.type === 'pillar') {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy + cellPx * 0.28, cellPx * 0.32, cellPx * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#64748b';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.3;
    ctx.fillRect(cx - cellPx * 0.22, cy - cellPx * 0.26, cellPx * 0.44, cellPx * 0.54);
    ctx.strokeRect(cx - cellPx * 0.22, cy - cellPx * 0.26, cellPx * 0.44, cellPx * 0.54);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(cx - cellPx * 0.28, cy - cellPx * 0.32, cellPx * 0.56, cellPx * 0.11);
    ctx.fillRect(cx - cellPx * 0.28, cy + cellPx * 0.22, cellPx * 0.56, cellPx * 0.11);
  } else if (tile.type === 'boulder') {
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.beginPath();
    ctx.ellipse(cx + 1, cy + cellPx * 0.28, cellPx * 0.38, cellPx * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = biome === 'desert' ? '#b45309' : biome === 'frost' || biome === 'red_gate' ? '#475569' : '#52525b';
    ctx.beginPath();
    ctx.arc(cx, cy + cellPx * 0.02, cellPx * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = biome === 'desert' ? '#fbbf24' : '#a1a1aa';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = biome === 'forest' || biome === 'feywild' ? 'rgba(34, 197, 94, 0.35)' : 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(cx - cellPx * 0.1, cy - cellPx * 0.08, cellPx * 0.16, 0, Math.PI * 2);
    ctx.fill();
  } else if (tile.type === 'rock') {
    ctx.fillStyle = biome === 'desert' ? '#92400e' : '#475569';
    ctx.beginPath();
    ctx.moveTo(cx - cellPx * 0.34, cy + cellPx * 0.26);
    ctx.lineTo(cx - cellPx * 0.38, cy - cellPx * 0.08);
    ctx.lineTo(cx - cellPx * 0.08, cy - cellPx * 0.34);
    ctx.lineTo(cx + cellPx * 0.32, cy - cellPx * 0.2);
    ctx.lineTo(cx + cellPx * 0.36, cy + cellPx * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = biome === 'desert' ? '#f59e0b' : '#94a3b8';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.arc(cx - cellPx * 0.08, cy - cellPx * 0.12, cellPx * 0.12, 0, Math.PI * 2);
    ctx.fill();
  } else if (tile.type === 'tree') {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(cx + 1, cy + cellPx * 0.26, cellPx * 0.28, cellPx * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#78350f';
    ctx.fillRect(cx - cellPx * 0.08, cy + cellPx * 0.05, cellPx * 0.16, cellPx * 0.24);
    ctx.fillStyle = biome === 'red_gate' || biome === 'frost' ? '#0f766e' : biome === 'shadowfell' ? '#334155' : biome === 'desert' ? '#65a30d' : '#15803d';
    ctx.beginPath();
    ctx.arc(cx, cy - cellPx * 0.05, cellPx * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = biome === 'red_gate' || biome === 'frost' ? '#bae6fd' : biome === 'feywild' ? '#2dd4bf' : biome === 'shadowfell' ? '#64748b' : biome === 'desert' ? '#84cc16' : '#22c55e';
    ctx.beginPath();
    ctx.arc(cx - cellPx * 0.07, cy - cellPx * 0.12, cellPx * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMultiTileTerrainFeature(
  ctx: CanvasRenderingContext2D,
  tile: ArenaTerrainTile,
  axisPad: number,
  cellPx: number,
  biome: string,
): void {
  const w = Math.max(1, Number(tile.w || 1));
  const h = Math.max(1, Number(tile.h || 1));
  const x0 = axisPad + tile.x * cellPx;
  const y0 = axisPad + tile.y * cellPx;
  const fw = w * cellPx;
  const fh = h * cellPx;
  const cx = x0 + fw / 2;
  const cy = y0 + fh / 2;

  ctx.save();
  if (tile.type === 'tree') {
    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
    ctx.beginPath();
    ctx.ellipse(cx + fw * 0.04, cy + fh * 0.18, fw * 0.44, fh * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    // Gnarled trunk & roots
    ctx.fillStyle = '#5c2d0c';
    ctx.fillRect(cx - fw * 0.1, cy + fh * 0.04, fw * 0.2, fh * 0.34);

    // Multi-lobed Great Tree canopy
    const darkLeaf = biome === 'red_gate' || biome === 'frost' ? '#0f766e' : biome === 'shadowfell' ? '#334155' : biome === 'desert' ? '#4d7c0f' : '#14532d';
    const midLeaf = biome === 'red_gate' || biome === 'frost' ? '#0284c7' : biome === 'feywild' ? '#0d9488' : biome === 'shadowfell' ? '#475569' : '#15803d';
    const hiLeaf = biome === 'red_gate' || biome === 'frost' ? '#bae6fd' : biome === 'feywild' ? '#2dd4bf' : biome === 'shadowfell' ? '#94a3b8' : '#22c55e';

    const lobes = [
      { ox: -0.2, oy: -0.05, r: 0.26, col: darkLeaf },
      { ox: 0.2, oy: -0.04, r: 0.26, col: darkLeaf },
      { ox: 0, oy: -0.18, r: 0.29, col: midLeaf },
      { ox: -0.1, oy: 0.08, r: 0.24, col: midLeaf },
      { ox: 0.12, oy: 0.08, r: 0.23, col: midLeaf },
      { ox: -0.04, oy: -0.14, r: 0.18, col: hiLeaf },
    ];
    const minDim = Math.min(fw, fh);
    for (const l of lobes) {
      ctx.fillStyle = l.col;
      ctx.beginPath();
      ctx.arc(cx + fw * l.ox, cy + fh * l.oy, minDim * l.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy - fh * 0.08, minDim * 0.34, Math.PI * 1.05, Math.PI * 1.85);
    ctx.stroke();
  } else if (tile.type === 'boulder') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(cx + fw * 0.03, cy + fh * 0.22, fw * 0.45, fh * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    const baseCol = biome === 'desert' ? '#92400e' : biome === 'frost' || biome === 'red_gate' ? '#475569' : biome === 'demon_castle' || biome === 'dragon_lair' ? '#3f3f46' : '#52525b';
    const edgeCol = biome === 'desert' ? '#f59e0b' : biome === 'demon_castle' ? '#f97316' : '#a1a1aa';

    ctx.fillStyle = baseCol;
    ctx.strokeStyle = edgeCol;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x0 + fw * 0.08, y0 + fh * 0.72);
    ctx.lineTo(x0 + fw * 0.14, y0 + fh * 0.28);
    ctx.lineTo(x0 + fw * 0.38, y0 + fh * 0.12);
    ctx.lineTo(x0 + fw * 0.68, y0 + fh * 0.16);
    ctx.lineTo(x0 + fw * 0.9, y0 + fh * 0.38);
    ctx.lineTo(x0 + fw * 0.86, y0 + fh * 0.8);
    ctx.lineTo(x0 + fw * 0.45, y0 + fh * 0.88);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Ridge fracture & moss/frost accent
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.26)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0 + fw * 0.38, y0 + fh * 0.14);
    ctx.lineTo(x0 + fw * 0.48, y0 + fh * 0.52);
    ctx.lineTo(x0 + fw * 0.24, y0 + fh * 0.72);
    ctx.moveTo(x0 + fw * 0.48, y0 + fh * 0.52);
    ctx.lineTo(x0 + fw * 0.78, y0 + fh * 0.62);
    ctx.stroke();
    if (biome === 'forest' || biome === 'feywild') {
      ctx.fillStyle = 'rgba(34, 197, 94, 0.32)';
      ctx.beginPath();
      ctx.ellipse(x0 + fw * 0.32, y0 + fh * 0.34, fw * 0.14, fh * 0.12, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tile.type === 'pillar') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.fillRect(x0 + fw * 0.14, y0 + fh * 0.16, fw * 0.78, fh * 0.78);

    // Stepped temple plinth
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = biome === 'double_dungeon' ? '#60a5fa' : biome === 'demon_castle' ? '#f59e0b' : '#94a3b8';
    ctx.lineWidth = 1.8;
    ctx.fillRect(x0 + fw * 0.1, y0 + fh * 0.1, fw * 0.8, fh * 0.8);
    ctx.strokeRect(x0 + fw * 0.1, y0 + fh * 0.1, fw * 0.8, fh * 0.8);

    // Inner column / statue pedestal
    ctx.fillStyle = '#64748b';
    ctx.fillRect(x0 + fw * 0.22, y0 + fh * 0.22, fw * 0.56, fh * 0.56);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.3;
    ctx.strokeRect(x0 + fw * 0.22, y0 + fh * 0.22, fw * 0.56, fh * 0.56);

    // Glowing rune core
    ctx.fillStyle = biome === 'demon_castle' ? 'rgba(249, 115, 22, 0.55)' : 'rgba(56, 189, 248, 0.45)';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(fw, fh) * 0.14, 0, Math.PI * 2);
    ctx.fill();
  } else if (tile.type === 'crystal') {
    ctx.shadowColor = biome === 'shadow_monarch' ? 'rgba(167, 139, 250, 0.8)' : 'rgba(56, 189, 248, 0.8)';
    ctx.shadowBlur = 10;
    const col = biome === 'shadow_monarch' || biome === 'underdark' ? '#7c3aed' : '#0284c7';
    const shards = [
      { ox: -0.18, oy: 0.08, s: 0.55 },
      { ox: 0.18, oy: 0.1, s: 0.52 },
      { ox: 0, oy: -0.06, s: 0.78 },
    ];
    const minDim = Math.min(fw, fh);
    for (const sh of shards) {
      const sx = cx + fw * sh.ox;
      const sy = cy + fh * sh.oy;
      const r = minDim * 0.34 * sh.s;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r * 0.58, sy - r * 0.12);
      ctx.lineTo(sx + r * 0.42, sy + r * 0.72);
      ctx.lineTo(sx - r * 0.42, sy + r * 0.72);
      ctx.lineTo(sx - r * 0.58, sy - r * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  } else if (tile.type === 'ice') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + fh * 0.24, fw * 0.44, fh * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0284c7';
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x0 + fw * 0.08, y0 + fh * 0.78);
    ctx.lineTo(x0 + fw * 0.24, y0 + fh * 0.22);
    ctx.lineTo(x0 + fw * 0.46, y0 + fh * 0.42);
    ctx.lineTo(x0 + fw * 0.64, y0 + fh * 0.14);
    ctx.lineTo(x0 + fw * 0.9, y0 + fh * 0.68);
    ctx.lineTo(x0 + fw * 0.74, y0 + fh * 0.84);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    drawTerrainTile(ctx, tile, cx, cy, Math.min(fw, fh), biome);
  }
  ctx.restore();
}

export function drawArenaTerrainLayer(
  ctx: CanvasRenderingContext2D,
  terrain: ArenaTerrainTile[],
  axisPad: number,
  cellPx: number,
  biome: string,
  maxCols = 100,
  maxRows = 100,
): void {
  const visible = (terrain || []).filter((t) => t.x >= 0 && t.y >= 0 && t.x < maxCols && t.y < maxRows);
  const waterSet = new Set<string>();
  const lavaSet = new Set<string>();
  for (const t of visible) {
    if (t.type === 'water') waterSet.add(`${t.x},${t.y}`);
    else if (t.type === 'lava') lavaSet.add(`${t.x},${t.y}`);
  }

  // Pass 1: Connected Water & Lava bodies with seamless interior & shoreline borders
  for (const t of visible) {
    if (t.type !== 'water' && t.type !== 'lava') continue;
    const isWater = t.type === 'water';
    const set = isWater ? waterSet : lavaSet;
    const x0 = axisPad + t.x * cellPx;
    const y0 = axisPad + t.y * cellPx;
    const hasN = set.has(`${t.x},${t.y - 1}`);
    const hasS = set.has(`${t.x},${t.y + 1}`);
    const hasW = set.has(`${t.x - 1},${t.y}`);
    const hasE = set.has(`${t.x + 1},${t.y}`);

    ctx.save();
    ctx.fillStyle = isWater ? 'rgba(14, 116, 144, 0.82)' : 'rgba(185, 28, 28, 0.88)';
    ctx.fillRect(x0, y0, cellPx, cellPx);

    // Deeper core tint
    ctx.fillStyle = isWater ? 'rgba(3, 105, 161, 0.45)' : 'rgba(234, 88, 12, 0.42)';
    ctx.fillRect(x0 + (hasW ? 0 : 2), y0 + (hasN ? 0 : 2), cellPx - (hasW ? 0 : 2) - (hasE ? 0 : 2), cellPx - (hasN ? 0 : 2) - (hasS ? 0 : 2));

    // Exposed shoreline / magma bank strokes
    ctx.strokeStyle = isWater ? '#7dd3fc' : '#fde047';
    ctx.lineWidth = Math.max(1.4, cellPx * 0.08);
    ctx.beginPath();
    if (!hasN) {
      ctx.moveTo(x0, y0 + 1);
      ctx.lineTo(x0 + cellPx, y0 + 1);
    }
    if (!hasS) {
      ctx.moveTo(x0, y0 + cellPx - 1);
      ctx.lineTo(x0 + cellPx, y0 + cellPx - 1);
    }
    if (!hasW) {
      ctx.moveTo(x0 + 1, y0);
      ctx.lineTo(x0 + 1, y0 + cellPx);
    }
    if (!hasE) {
      ctx.moveTo(x0 + cellPx - 1, y0);
      ctx.lineTo(x0 + cellPx - 1, y0 + cellPx);
    }
    ctx.stroke();

    // Organic ripple / lava vein
    ctx.strokeStyle = isWater ? 'rgba(186, 230, 253, 0.45)' : 'rgba(254, 240, 138, 0.65)';
    ctx.lineWidth = Math.max(1, cellPx * 0.05);
    ctx.beginPath();
    if ((t.x + t.y) % 2 === 0) {
      ctx.moveTo(x0 + cellPx * 0.2, y0 + cellPx * 0.45);
      ctx.quadraticCurveTo(x0 + cellPx * 0.5, y0 + cellPx * 0.32, x0 + cellPx * 0.8, y0 + cellPx * 0.45);
    } else {
      ctx.moveTo(x0 + cellPx * 0.25, y0 + cellPx * 0.65);
      ctx.quadraticCurveTo(x0 + cellPx * 0.55, y0 + cellPx * 0.78, x0 + cellPx * 0.82, y0 + cellPx * 0.6);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Pass 2: Multi-tile anchor landmarks (2x2 Trees, 3x2 Boulders, 2x2 Pillars, etc.)
  for (const t of visible) {
    if (t.isAnchor && ((t.w && t.w > 1) || (t.h && t.h > 1))) {
      drawMultiTileTerrainFeature(ctx, t, axisPad, cellPx, biome);
    }
  }

  // Pass 3: Single 1x1 obstacles (skip water/lava and covered sub-tiles)
  for (const t of visible) {
    if (t.type === 'water' || t.type === 'lava') continue;
    if (t.isAnchor === false) continue;
    if (t.isAnchor && ((t.w && t.w > 1) || (t.h && t.h > 1))) continue;
    const cx = axisPad + t.x * cellPx + cellPx / 2;
    const cy = axisPad + t.y * cellPx + cellPx / 2;
    drawTerrainTile(ctx, t, cx, cy, cellPx, biome);
  }
}
