import type { ArenaFxEvent } from '@shared/index';

export interface ArenaFxFrame {
  tokenPositions: Map<string, { x: number; y: number }>;
  tokenOffsets: Map<string, { dx: number; dy: number }>;
  drawOverlay: (ctx: CanvasRenderingContext2D, axisPad: number, cellPx: number) => void;
}

interface ActiveWalk {
  tokenId: string;
  path: Array<{ x: number; y: number }>;
  startTime: number;
  durationMs: number;
}

interface ActiveFx {
  fx: ArenaFxEvent;
  startTime: number;
  durationMs: number;
  sparks: Array<{ angle: number; speed: number; size: number }>;
}

const ELEMENT_PALETTE: Record<string, { core: string; glow: string }> = {
  fire: { core: '#fb923c', glow: '#ef4444' },
  water: { core: '#38bdf8', glow: '#0284c7' },
  wind: { core: '#6ee7b7', glow: '#10b981' },
  earth: { core: '#fbbf24', glow: '#b45309' },
  light: { core: '#fef08a', glow: '#eab308' },
  dark: { core: '#c084fc', glow: '#6366f1' },
};

function getElementColors(element?: string): { core: string; glow: string } {
  const key = String(element || '').toLowerCase();
  for (const [el, pal] of Object.entries(ELEMENT_PALETTE)) {
    if (key.includes(el)) return pal;
  }
  return { core: '#c084fc', glow: '#7c3aed' };
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function computeShortestGridPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  cols: number,
  rows: number,
  terrainSet: Set<string>,
): Array<{ x: number; y: number }> {
  if (start.x === end.x && start.y === end.y) return [start];
  const queue: Array<{ x: number; y: number }> = [start];
  const parent = new Map<string, string | null>();
  parent.set(`${start.x},${start.y}`, null);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  const endKey = `${end.x},${end.y}`;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curKey = `${cur.x},${cur.y}`;
    if (curKey === endKey) {
      const path: Array<{ x: number; y: number }> = [];
      let walkKey: string | null = endKey;
      while (walkKey) {
        const [wx, wy] = walkKey.split(',').map(Number);
        path.unshift({ x: wx, y: wy });
        walkKey = parent.get(walkKey) ?? null;
      }
      return path;
    }
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nk = `${nx},${ny}`;
      if (parent.has(nk)) continue;
      if (nk !== endKey && terrainSet.has(nk)) continue;
      parent.set(nk, curKey);
      queue.push({ x: nx, y: ny });
    }
  }
  return [start, end];
}

export class ArenaFxManager {
  private walks: ActiveWalk[] = [];
  private effects: ActiveFx[] = [];
  private seenFxIds = new Set<string>();

  seedSeenFx(fxList: ArenaFxEvent[]): void {
    for (const fx of fxList) this.seenFxIds.add(fx.id);
  }

  clear(): void {
    this.walks = [];
    this.effects = [];
  }

  queueWalk(
    tokenId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    cols: number,
    rows: number,
    terrainSet: Set<string>,
    now: number,
  ): void {
    if (prefersReducedMotion()) return;
    if (from.x === to.x && from.y === to.y) return;
    const path = computeShortestGridPath(from, to, cols, rows, terrainSet);
    const steps = Math.max(1, path.length - 1);
    const durationMs = Math.min(440, Math.max(140, steps * 110));
    this.walks = this.walks.filter((w) => w.tokenId !== tokenId);
    this.walks.push({ tokenId, path, startTime: now, durationMs });
  }

  queueFx(fx: ArenaFxEvent, now: number): void {
    if (this.seenFxIds.has(fx.id)) return;
    this.seenFxIds.add(fx.id);
    if (this.seenFxIds.size > 60) {
      const first = this.seenFxIds.values().next().value;
      if (first) this.seenFxIds.delete(first);
    }
    if (prefersReducedMotion()) return;
    const durationMs =
      fx.kind === 'spell' ? 540 : fx.kind === 'heal' || fx.kind === 'buff' ? 520 : fx.kind === 'ranged' ? 380 : 340;
    const sparks = Array.from({ length: 10 }, (_, i) => ({
      angle: (Math.PI * 2 * i) / 10 + (i % 2 === 0 ? 0.15 : -0.15),
      speed: 0.45 + (i % 3) * 0.22,
      size: 2.2 + (i % 2) * 1.1,
    }));
    this.effects.push({ fx, startTime: now, durationMs, sparks });
  }

  hasActive(now: number): boolean {
    this.walks = this.walks.filter((w) => now - w.startTime < w.durationMs);
    this.effects = this.effects.filter((e) => now - e.startTime < e.durationMs);
    return this.walks.length > 0 || this.effects.length > 0;
  }

  sample(now: number, cellPx: number): ArenaFxFrame {
    this.hasActive(now);
    const tokenPositions = new Map<string, { x: number; y: number }>();
    const tokenOffsets = new Map<string, { dx: number; dy: number }>();

    for (const w of this.walks) {
      const t = Math.max(0, Math.min(1, (now - w.startTime) / w.durationMs));
      const eased = 1 - Math.pow(1 - t, 2);
      const segCount = Math.max(1, w.path.length - 1);
      const scaled = eased * segCount;
      const idx = Math.min(segCount - 1, Math.floor(scaled));
      const segT = scaled - idx;
      const a = w.path[idx];
      const b = w.path[idx + 1] || a;
      tokenPositions.set(w.tokenId, {
        x: a.x + (b.x - a.x) * segT,
        y: a.y + (b.y - a.y) * segT,
      });
      const hop = -Math.sin(segT * Math.PI) * Math.max(3, cellPx * 0.14);
      tokenOffsets.set(w.tokenId, { dx: 0, dy: hop });
    }

    for (const e of this.effects) {
      const t = Math.max(0, Math.min(1, (now - e.startTime) / e.durationMs));
      const { fx } = e;
      if (fx.kind === 'melee' && fx.attackerId) {
        const lungeT = t < 0.35 ? t / 0.35 : Math.max(0, 1 - (t - 0.35) / 0.35);
        const dx = fx.to.x - fx.from.x;
        const dy = fx.to.y - fx.from.y;
        const len = Math.hypot(dx, dy) || 1;
        const mag = cellPx * 0.36 * lungeT;
        const prev = tokenOffsets.get(fx.attackerId) || { dx: 0, dy: 0 };
        tokenOffsets.set(fx.attackerId, {
          dx: prev.dx + (dx / len) * mag,
          dy: prev.dy + (dy / len) * mag,
        });
      }
      const hitStart = fx.kind === 'melee' ? 0.28 : 0.42;
      if (!fx.miss && fx.targetId && t >= hitStart && t <= hitStart + 0.32) {
        const shakeT = (t - hitStart) / 0.32;
        const amp = (1 - shakeT) * Math.max(2.5, cellPx * 0.1);
        const sx = Math.sin(shakeT * Math.PI * 6) * amp;
        const prev = tokenOffsets.get(fx.targetId) || { dx: 0, dy: 0 };
        tokenOffsets.set(fx.targetId, { dx: prev.dx + sx, dy: prev.dy });
      }
    }

    const activeWalks = [...this.walks];
    const activeEffects = [...this.effects];

    const drawOverlay = (ctx: CanvasRenderingContext2D, axisPad: number, pxSize: number) => {
      // Footstep dust puffs for walking tokens
      for (const w of activeWalks) {
        const t = Math.max(0, Math.min(1, (now - w.startTime) / w.durationMs));
        const pos = tokenPositions.get(w.tokenId);
        if (!pos) continue;
        const cx = axisPad + pos.x * pxSize + pxSize / 2;
        const cy = axisPad + (pos.y + 0.35) * pxSize + pxSize / 2;
        ctx.save();
        ctx.fillStyle = `rgba(226, 232, 240, ${(1 - t) * 0.35})`;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(2, pxSize * 0.12 * (1 - t * 0.4)), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      for (const e of activeEffects) {
        const t = Math.max(0, Math.min(1, (now - e.startTime) / e.durationMs));
        const { fx, sparks } = e;
        const sx = axisPad + fx.from.x * pxSize + pxSize / 2;
        const sy = axisPad + fx.from.y * pxSize + pxSize / 2;
        const tx = axisPad + fx.to.x * pxSize + pxSize / 2;
        const ty = axisPad + fx.to.y * pxSize + pxSize / 2;
        const angle = Math.atan2(ty - sy, tx - sx);

        ctx.save();

        if (fx.kind === 'melee') {
          if (t >= 0.15 && t <= 0.68) {
            const st = (t - 0.15) / 0.53;
            const alpha = Math.sin(st * Math.PI);
            ctx.strokeStyle = fx.crit ? `rgba(250, 204, 21, ${alpha})` : `rgba(248, 113, 113, ${alpha})`;
            ctx.lineWidth = Math.max(2.5, pxSize * 0.1);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(tx, ty, pxSize * 0.42, angle - 1.1, angle + 1.1);
            ctx.stroke();
          }
        } else if (fx.kind === 'ranged') {
          if (t <= 0.48) {
            const pt = t / 0.48;
            const px = sx + (tx - sx) * pt;
            const py = sy + (ty - sy) * pt;
            const tailX = px - Math.cos(angle) * Math.max(10, pxSize * 0.45);
            const tailY = py - Math.sin(angle) * Math.max(10, pxSize * 0.45);
            ctx.strokeStyle = fx.friendlyFire ? '#fb923c' : '#fde047';
            ctx.lineWidth = Math.max(2.2, pxSize * 0.08);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(px, py);
            ctx.stroke();
          }
          if (t >= 0.42 && !fx.miss) {
            const bt = (t - 0.42) / 0.58;
            ctx.fillStyle = fx.friendlyFire
              ? `rgba(251, 146, 60, ${1 - bt})`
              : `rgba(250, 204, 21, ${1 - bt})`;
            for (const sp of sparks) {
              const dist = bt * pxSize * 0.55 * sp.speed;
              ctx.beginPath();
              ctx.arc(tx + Math.cos(sp.angle) * dist, ty + Math.sin(sp.angle) * dist, sp.size * (1 - bt * 0.5), 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else if (fx.kind === 'spell') {
          const pal = getElementColors(fx.element);
          if (t <= 0.42) {
            const pt = t / 0.42;
            const px = sx + (tx - sx) * pt;
            const py = sy + (ty - sy) * pt;
            ctx.fillStyle = pal.glow;
            ctx.globalAlpha = 0.55;
            ctx.beginPath();
            ctx.arc(px, py, Math.max(5, pxSize * 0.22), 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = pal.core;
            ctx.globalAlpha = 0.95;
            ctx.beginPath();
            ctx.arc(px, py, Math.max(3, pxSize * 0.12), 0, Math.PI * 2);
            ctx.fill();
          }
          if (t >= 0.36) {
            const bt = (t - 0.36) / 0.64;
            const cells = fx.affectedCells && fx.affectedCells.length > 0 ? fx.affectedCells : [fx.to];
            ctx.strokeStyle = pal.core;
            ctx.lineWidth = Math.max(2, pxSize * 0.07);
            ctx.globalAlpha = (1 - bt) * 0.9;
            for (const c of cells) {
              const cx = axisPad + c.x * pxSize + pxSize / 2;
              const cy = axisPad + c.y * pxSize + pxSize / 2;
              ctx.beginPath();
              ctx.arc(cx, cy, pxSize * (0.18 + bt * 0.42), 0, Math.PI * 2);
              ctx.stroke();
            }
            ctx.fillStyle = pal.core;
            for (const sp of sparks) {
              const dist = bt * pxSize * 0.7 * sp.speed;
              ctx.beginPath();
              ctx.arc(tx + Math.cos(sp.angle) * dist, ty + Math.sin(sp.angle) * dist, sp.size * (1 - bt * 0.4), 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else if (fx.kind === 'heal' || fx.kind === 'buff') {
          const color = fx.kind === 'heal' ? '#34d399' : '#fbbf24';
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.globalAlpha = (1 - t) * 0.85;
          ctx.beginPath();
          ctx.arc(tx, ty, pxSize * (0.28 + t * 0.32), 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = color;
          for (let i = 0; i < 6; i++) {
            const ox = Math.sin(i * 1.4 + t * 3) * pxSize * 0.28;
            const oy = -t * pxSize * 0.65 - (i % 3) * 4;
            ctx.beginPath();
            ctx.arc(tx + ox, ty + oy, 2.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Floating combat text (damage / heal / CRIT / MISS)
        const textStart = fx.kind === 'melee' ? 0.2 : fx.kind === 'heal' || fx.kind === 'buff' ? 0.05 : 0.38;
        if (t >= textStart) {
          const tt = (t - textStart) / (1 - textStart);
          const floatY = ty - pxSize * 0.35 - tt * pxSize * 0.65;
          const label = fx.miss
            ? 'MISS'
            : fx.friendlyFire
              ? `FF -${fx.damage ?? 0}`
              : fx.damage !== undefined
                ? `${fx.crit ? 'CRIT ' : ''}-${fx.damage}`
                : fx.heal !== undefined
                  ? `+${fx.heal}`
                  : fx.label || '';
          if (label) {
            ctx.globalAlpha = tt < 0.7 ? 1 : Math.max(0, 1 - (tt - 0.7) / 0.3);
            ctx.font = `800 ${Math.max(11, Math.round(pxSize * 0.36))}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(2, 6, 23, 0.92)';
            ctx.strokeText(label, tx, floatY);
            ctx.fillStyle = fx.miss
              ? '#94a3b8'
              : fx.friendlyFire
                ? '#fb923c'
                : fx.heal !== undefined || fx.kind === 'heal'
                  ? '#34d399'
                  : fx.crit
                    ? '#fde047'
                    : '#f87171';
            ctx.fillText(label, tx, floatY);
          }
        }

        ctx.restore();
      }
    };

    return { tokenPositions, tokenOffsets, drawOverlay };
  }
}
