import { spaceDistanceBetweenPoints, type FilteredGameState } from '@shared/index';
import { drawTokenAvatar } from './drawPrimitives';

export interface DrawTowerOptions {
  canvas: HTMLCanvasElement;
  state: FilteredGameState;
  isDmView: boolean;
  selectedTokenId?: string | null;
  measureStart?: { x: number; y: number } | null;
  measureEnd?: { x: number; y: number } | null;
  onPortraitLoaded?: () => void;
}

const FLOOR_THEME_COLORS: Record<string, { top: string; bot: string; spine: string; border: string }> = {
  forest: { top: '#11291a', bot: '#09180f', spine: '#4ade80', border: '#22c55e' },
  desert: { top: '#3b2812', bot: '#211508', spine: '#fbbf24', border: '#f59e0b' },
  underworld: { top: '#310d14', bot: '#18060a', spine: '#f87171', border: '#ef4444' },
  plains: { top: '#1f2d14', bot: '#111a0b', spine: '#a3e635', border: '#84cc16' },
  frost: { top: '#0e293d', bot: '#081826', spine: '#7dd3fc', border: '#38bdf8' },
  obsidian: { top: '#0f172a', bot: '#090f1d', spine: '#38bdf8', border: '#38bdf8' },
};

export function drawTowerCanvas({
  canvas,
  state,
  isDmView,
  selectedTokenId = null,
  measureStart = null,
  measureEnd = null,
  onPortraitLoaded,
}: DrawTowerOptions): void {
  if (!state?.map) return;
  const cols = state.map.cols || 10;
  const rows = state.map.rows || 25;
  const cellSize = 48;
  const labelW = 36;
  const totalW = labelW + cols * cellSize;
  const totalH = rows * cellSize;
  if (canvas.width !== totalW || canvas.height !== totalH) {
    canvas.width = totalW;
    canvas.height = totalH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, totalW, totalH);

  for (const fl of state.map.floors || []) {
    const yTop = fl.rowStart * cellSize;
    const flH = (fl.rowEnd - fl.rowStart + 1) * cellSize;
    const thKey = fl.theme || (fl.safeZone ? 'forest' : 'obsidian');
    const th = FLOOR_THEME_COLORS[thKey] || FLOOR_THEME_COLORS.obsidian;
    const grad = ctx.createLinearGradient(0, yTop, 0, yTop + flH);
    grad.addColorStop(0, th.top);
    grad.addColorStop(1, th.bot);
    ctx.fillStyle = grad;
    ctx.fillRect(labelW, yTop, cols * cellSize, flH);

    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, yTop, labelW, flH);
    ctx.fillStyle = th.spine;
    ctx.font = 'bold 13px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${fl.number}F`, labelW / 2, yTop + flH / 2 + 4);

    const floorBeats = (state.storyBeats || []).filter((b) => Number(b.floor) === Number(fl.number) && (isDmView || b.presented));
    const beatNames = floorBeats.length ? ` • Beats: ${floorBeats.map((b) => b.title).join(' | ')}` : '';
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = 'bold 11px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${fl.title} [${thKey.toUpperCase()}]${beatNames}`, labelW + 8, yTop + 15);

    const px = labelW + fl.portalCol * cellSize + cellSize / 2;
    const py = fl.portalRow * cellSize + cellSize / 2;
    ctx.beginPath();
    ctx.arc(px, py, 14, 0, Math.PI * 2);
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.fill();

    ctx.strokeStyle = th.border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, yTop + flH);
    ctx.lineTo(totalW, yTop + flH);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= cols; x++) {
    ctx.beginPath();
    ctx.moveTo(labelW + x * cellSize, 0);
    ctx.lineTo(labelW + x * cellSize, totalH);
    ctx.stroke();
  }
  for (let y = 0; y <= rows; y++) {
    ctx.beginPath();
    ctx.moveTo(labelW, y * cellSize);
    ctx.lineTo(totalW, y * cellSize);
    ctx.stroke();
  }

  const fogSet = new Set(state.map.fog || []);
  for (const key of fogSet) {
    const [fx, fy] = key.split(',').map(Number);
    const xPx = labelW + fx * cellSize;
    const yPx = fy * cellSize;
    ctx.fillStyle = isDmView ? 'rgba(15, 23, 42, 0.48)' : 'rgba(4, 7, 15, 0.96)';
    ctx.fillRect(xPx, yPx, cellSize, cellSize);
    if (isDmView) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.25)';
      ctx.beginPath();
      ctx.moveTo(xPx, yPx);
      ctx.lineTo(xPx + cellSize, yPx + cellSize);
      ctx.stroke();
    }
  }

  for (const tok of state.map.tokens || []) {
    const liveMon = tok.type === 'monster' ? (state.monsters || []).find((m) => m.id === tok.id) : undefined;
    const cx = labelW + tok.x * cellSize + cellSize / 2;
    const cy = tok.y * cellSize + cellSize / 2;
    drawTokenAvatar(ctx, tok, cx, cy, 17, selectedTokenId === tok.id, state.characters, onPortraitLoaded);

    const showHpBar = isDmView || (tok.type === 'monster' && Boolean(liveMon?.observedByViewer));
    const barHp = liveMon?.hp !== undefined ? liveMon.hp : tok.hp;
    const barMaxHp = liveMon?.maxHp !== undefined ? liveMon.maxHp : tok.maxHp;
    if (showHpBar && barMaxHp && barMaxHp > 0 && barHp !== null && barHp !== undefined) {
      const bw = 34;
      const pct = Math.max(0, Math.min(1, barHp / barMaxHp));
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(cx - bw / 2, cy + 16, bw, 5);
      ctx.fillStyle = tok.type === 'monster' ? '#ef4444' : '#22c55e';
      ctx.fillRect(cx - bw / 2, cy + 16, bw * pct, 5);
    }
  }

  const now = Date.now();
  for (const p of state.map.pings || []) {
    if (now - p.createdAt > 10000) continue;
    const px = labelW + p.x * cellSize + cellSize / 2;
    const py = p.y * cellSize + cellSize / 2;
    ctx.beginPath();
    ctx.arc(px, py, 20, 0, Math.PI * 2);
    ctx.strokeStyle = p.color || '#38bdf8';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  if (measureStart && measureEnd) {
    const sx = labelW + measureStart.x * cellSize + cellSize / 2;
    const sy = measureStart.y * cellSize + cellSize / 2;
    const ex = labelW + measureEnd.x * cellSize + cellSize / 2;
    const ey = measureEnd.y * cellSize + cellSize / 2;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    const spaces = spaceDistanceBetweenPoints(measureStart.x, measureStart.y, measureEnd.x, measureEnd.y);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 13px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${spaces} Spaces`, (sx + ex) / 2, (sy + ey) / 2 - 8);
  }
}
