import type { ArenaBiome, ArenaTerrainTile } from './types';

export function hashSeedStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeSeededRng(seed: number): () => number {
  let s = (seed || 1) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Deterministic arena terrain generator shared between DM draft preview and server-side
 * story-beat creation so previews match persisted tactical maps 1:1.
 */
export function generateArenaTerrainFromPrompt(
  promptText: string,
  cols = 20,
  rows = 20,
  explicitBiome = '',
  occupiedSet: Set<string> = new Set(),
): { biome: ArenaBiome; terrain: ArenaTerrainTile[] } {
  const lower = String(promptText || '').toLowerCase();
  let biome: ArenaBiome = ['obsidian', 'forest', 'plains', 'desert'].includes(explicitBiome)
    ? (explicitBiome as ArenaBiome)
    : 'obsidian';

  if (!explicitBiome || explicitBiome === 'obsidian') {
    if (/\b(forest|wood|woods|grove|jungle|glade|thicket|canopy|trees?)\b/.test(lower)) biome = 'forest';
    else if (/\b(desert|sand|dune|oasis|arid|canyon|wasteland|sunbaked)\b/.test(lower)) biome = 'desert';
    else if (/\b(plain|plains|meadow|grass|steppe|field|prairie|savanna)\b/.test(lower)) biome = 'plains';
  }

  const rng = makeSeededRng(hashSeedStr(`${lower}|${cols}x${rows}|${biome}`));
  const terrain: ArenaTerrainTile[] = [];
  const seen = new Set(occupiedSet);

  const addTile = (x: number, y: number, type: ArenaTerrainTile['type']) => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    terrain.push({ x, y, type });
  };

  const wantsWater = /\b(river|stream|water|creek|brook|lake|pond|ford|moat|flood|oasis|marsh)\b/.test(lower);
  const wantsRocks = /\b(rock|rocks|boulder|boulders|crag|cliff|stone|ruin|ruins|rubble|canyon|pillar|spire|ridge)\b/.test(lower);
  const wantsTrees = /\b(tree|trees|forest|wood|woods|grove|jungle|thicket|timber|canopy|bush)\b/.test(lower) || biome === 'forest';

  if (wantsWater) {
    const horizontal = rng() < 0.65;
    const ford1 = Math.floor((horizontal ? cols : rows) * (0.28 + rng() * 0.14));
    const ford2 = Math.floor((horizontal ? cols : rows) * (0.66 + rng() * 0.14));
    let pos = Math.floor((horizontal ? rows : cols) * (0.35 + rng() * 0.3));
    const len = horizontal ? cols : rows;
    for (let i = 0; i < len; i++) {
      if (i === ford1 || i === ford1 + 1 || i === ford2) continue;
      if (horizontal) {
        addTile(i, pos, 'water');
        if (rng() < 0.35) addTile(i, pos + 1, 'water');
      } else {
        addTile(pos, i, 'water');
        if (rng() < 0.35) addTile(pos + 1, i, 'water');
      }
      if (rng() < 0.4) pos += rng() < 0.5 ? -1 : 1;
      pos = Math.max(2, Math.min((horizontal ? rows : cols) - 3, pos));
    }
  }

  const area = cols * rows;
  const rockCount = wantsRocks
    ? Math.max(5, Math.round(area * 0.055))
    : biome === 'desert' || biome === 'obsidian'
      ? Math.max(4, Math.floor(area / 36))
      : Math.max(2, Math.round(area * 0.02));
  for (let i = 0; i < rockCount; i++) {
    const rx = Math.floor(rng() * cols);
    const ry = Math.floor(rng() * rows);
    addTile(rx, ry, 'rock');
    if (wantsRocks && rng() < 0.35) addTile(rx + (rng() < 0.5 ? 1 : -1), ry, 'rock');
  }

  if (wantsTrees || biome === 'forest' || biome === 'plains') {
    const treeDensity = biome === 'forest' ? 0.09 : biome === 'plains' ? 0.03 : 0.015;
    const treeCount = Math.round(area * (wantsTrees ? Math.max(treeDensity, 0.06) : treeDensity));
    for (let i = 0; i < treeCount; i++) {
      addTile(Math.floor(rng() * cols), Math.floor(rng() * rows), 'tree');
    }
  }

  return { biome, terrain };
}
