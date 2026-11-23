import type { FilteredGameState, MapToken, StoryBeat, UserRole } from '@shared/index';

export function getScaledCanvasCell(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  axisPad: number,
  cellPx: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const px = (clientX - rect.left) * (canvas.width / (rect.width || 1));
  const py = (clientY - rect.top) * (canvas.height / (rect.height || 1));
  return {
    x: Math.floor((px - axisPad) / cellPx),
    y: Math.floor((py - axisPad) / cellPx),
  };
}

export function getTowerGridCellFromClient(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  state: FilteredGameState | null,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / (rect.width || 1);
  const scaleY = canvas.height / (rect.height || 1);
  const px = (clientX - rect.left) * scaleX;
  const py = (clientY - rect.top) * scaleY;
  const cellX = Math.floor((px - 36) / 48);
  const cellY = Math.floor(py / 48);
  const cols = state?.map?.cols || 10;
  const rows = state?.map?.rows || 25;
  if (cellX < 0 || cellX >= cols || cellY < 0 || cellY >= rows) return null;
  return { x: cellX, y: cellY };
}

export function findTowerTokenAt(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  state: FilteredGameState | null,
): MapToken | null {
  if (!state?.map?.tokens) return null;
  const cell = getTowerGridCellFromClient(canvas, clientX, clientY, state);
  if (!cell) return null;
  return state.map.tokens.find((t) => t.x === cell.x && t.y === cell.y) || null;
}

export function findBeatTokenAt(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  beat: StoryBeat | null | undefined,
  cellPx: number,
  role?: UserRole,
  axisPad = 24,
): Partial<MapToken> | null {
  if (!beat?.arena) return null;
  const { x, y } = getScaledCanvasCell(canvas, clientX, clientY, axisPad, cellPx);
  const tok = (beat.arena.tokens || []).find((t) => t.x === x && t.y === y);
  if (tok) return tok;
  const chest = (beat.arena.chests || []).find((c) => c.x === x && c.y === y);
  if (chest) {
    return {
      id: chest.id,
      type: 'chest',
      name: chest.opened
        ? `${chest.name} (Opened)`
        : `${chest.name}${role === 'dm' && chest.gold ? ` (${chest.gold}G)` : ' — Tap to Open'}`,
      hp: null,
    };
  }
  const restSpot = (beat.arena.restSpots || []).find((r) => r.x === x && r.y === y);
  if (restSpot) {
    return {
      id: restSpot.id,
      type: 'rest',
      name: `${restSpot.name} (+${Math.round(restSpot.hpPct * 100)}% HP/MP after combat)`,
      hp: null,
    };
  }
  const tile = (beat.arena.terrain || []).find((t) => t.x === x && t.y === y);
  if (tile) {
    const labels: Record<string, string> = {
      tree: 'Tree (Impassable)',
      rock: 'Boulder / Rock (Impassable)',
      water: 'Deep Water (Impassable)',
    };
    return { id: `terrain-${x}-${y}`, type: 'terrain', name: labels[tile.type] || 'Impassable Terrain', hp: null };
  }
  return null;
}
