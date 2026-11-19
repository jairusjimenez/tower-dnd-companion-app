import type { ArenaTerrainTile, Character, MapChest, MapToken } from '@shared/index';

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
  chest: Pick<MapChest, 'opened'>,
  cx: number,
  cy: number,
  size: number,
): void {
  const half = Math.max(7, Math.floor(size * 0.36));
  ctx.save();
  if (chest.opened) ctx.globalAlpha = 0.45;
  ctx.fillStyle = chest.opened ? '#78350f' : '#b45309';
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(cx - half, cy - half * 0.75, half * 2, half * 1.5, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fbbf24';
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
  tok: Pick<MapToken, 'id' | 'name' | 'type' | 'color' | 'label' | 'hiddenFromPlayers'>,
  cx: number,
  cy: number,
  r: number,
  selected: boolean,
  characters: Record<string, Character> | undefined,
  onPortraitLoaded?: () => void,
): void {
  const ch = tok.type === 'player' ? characters?.[tok.id] : null;
  const img = ch?.portraitUrl ? getPortraitImage(ch.portraitUrl, onPortraitLoaded) : null;

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
  } else {
    ctx.fillStyle = tok.type === 'monster' ? '#ef4444' : tok.type === 'npc' ? '#10b981' : (tok.color || '#38bdf8');
    ctx.fill();
    ctx.fillStyle = '#020617';
    ctx.font = `bold ${Math.max(9, Math.floor(r * 0.72))}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(tok.label || tok.name.slice(0, 2).toUpperCase(), cx, cy + Math.floor(r * 0.25));
  }

  ctx.lineWidth = selected ? 3 : 2;
  ctx.strokeStyle = selected
    ? '#fbbf24'
    : tok.type === 'monster'
      ? '#fca5a5'
      : tok.type === 'npc'
        ? '#6ee7b7'
        : '#7dd3fc';
  ctx.stroke();
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
    plains: { bg: '#1e2b15', alt: 'rgba(163, 230, 53, 0.05)', grid: 'rgba(163, 230, 53, 0.18)', axis: '#bef264' },
    desert: { bg: '#2b1e10', alt: 'rgba(251, 191, 36, 0.06)', grid: 'rgba(251, 191, 36, 0.18)', axis: '#fcd34d' },
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
    ctx.fillStyle = '#0369a1';
    ctx.fillRect(x0 + 1, y0 + 1, cellPx - 2, cellPx - 2);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(1, cellPx * 0.06);
    ctx.beginPath();
    ctx.moveTo(x0 + cellPx * 0.2, cy - cellPx * 0.14);
    ctx.quadraticCurveTo(cx, cy - cellPx * 0.24, x0 + cellPx * 0.8, cy - cellPx * 0.14);
    ctx.moveTo(x0 + cellPx * 0.22, cy + cellPx * 0.16);
    ctx.quadraticCurveTo(cx, cy + cellPx * 0.06, x0 + cellPx * 0.78, cy + cellPx * 0.16);
    ctx.stroke();
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
    ctx.fillStyle = biome === 'desert' ? '#65a30d' : '#15803d';
    ctx.beginPath();
    ctx.arc(cx, cy - cellPx * 0.05, cellPx * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = biome === 'desert' ? '#84cc16' : '#22c55e';
    ctx.beginPath();
    ctx.arc(cx - cellPx * 0.07, cy - cellPx * 0.12, cellPx * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
}
