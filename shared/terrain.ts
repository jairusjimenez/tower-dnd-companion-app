import { getFloorThemeLabel } from './rules';
import type { ArenaBiome, ArenaTerrainTile, TerrainType } from './types';

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

interface ThemeTerrainProfile {
  primary: TerrainType;
  secondary: TerrainType;
  tertiary?: TerrainType;
  water?: boolean;
  density: number;
}

const THEME_PROFILES: Record<string, ThemeTerrainProfile> = {
  forest: { primary: 'tree', secondary: 'boulder', tertiary: 'rock', density: 0.14 },
  feywild: { primary: 'tree', secondary: 'crystal', tertiary: 'boulder', water: true, density: 0.14 },
  plains: { primary: 'tree', secondary: 'rock', tertiary: 'boulder', density: 0.08 },
  murim_peaks: { primary: 'boulder', secondary: 'tree', tertiary: 'pillar', density: 0.12 },
  desert: { primary: 'boulder', secondary: 'rock', tertiary: 'pillar', density: 0.1 },
  frost: { primary: 'ice', secondary: 'boulder', tertiary: 'rock', density: 0.12 },
  red_gate: { primary: 'ice', secondary: 'tree', tertiary: 'boulder', density: 0.14 },
  shinsu_sea: { primary: 'crystal', secondary: 'pillar', tertiary: 'boulder', water: true, density: 0.11 },
  elemental_water: { primary: 'crystal', secondary: 'ice', tertiary: 'rock', water: true, density: 0.11 },
  sunken_temple: { primary: 'pillar', secondary: 'boulder', tertiary: 'crystal', water: true, density: 0.12 },
  hidden_floor: { primary: 'crystal', secondary: 'pillar', tertiary: 'rock', density: 0.11 },
  star_stream: { primary: 'crystal', secondary: 'pillar', tertiary: 'boulder', density: 0.1 },
  clockwork_aegis: { primary: 'pillar', secondary: 'boulder', tertiary: 'crystal', density: 0.12 },
  demon_castle: { primary: 'lava', secondary: 'pillar', tertiary: 'boulder', density: 0.12 },
  nine_hells: { primary: 'lava', secondary: 'boulder', tertiary: 'pillar', density: 0.13 },
  elemental_fire: { primary: 'lava', secondary: 'rock', tertiary: 'boulder', density: 0.13 },
  dragon_lair: { primary: 'lava', secondary: 'boulder', tertiary: 'crystal', density: 0.12 },
  obsidian: { primary: 'rock', secondary: 'boulder', tertiary: 'lava', density: 0.1 },
  double_dungeon: { primary: 'pillar', secondary: 'boulder', tertiary: 'crystal', density: 0.12 },
  arcane_library: { primary: 'pillar', secondary: 'crystal', tertiary: 'rock', density: 0.12 },
  floor_of_tests: { primary: 'pillar', secondary: 'boulder', tertiary: 'rock', density: 0.1 },
  hell_train: { primary: 'pillar', secondary: 'rock', tertiary: 'lava', density: 0.11 },
  floor_of_death: { primary: 'boulder', secondary: 'crystal', tertiary: 'lava', water: true, density: 0.12 },
  jeju_nest: { primary: 'boulder', secondary: 'rock', tertiary: 'crystal', density: 0.13 },
  shadow_monarch: { primary: 'crystal', secondary: 'pillar', tertiary: 'boulder', density: 0.12 },
  underworld: { primary: 'boulder', secondary: 'rock', tertiary: 'lava', density: 0.11 },
  underdark: { primary: 'crystal', secondary: 'boulder', tertiary: 'rock', density: 0.13 },
  shadowfell: { primary: 'tree', secondary: 'boulder', tertiary: 'pillar', density: 0.12 },
  necropolis: { primary: 'pillar', secondary: 'boulder', tertiary: 'rock', density: 0.12 },
  astral_sea: { primary: 'crystal', secondary: 'pillar', tertiary: 'boulder', density: 0.09 },
  sky_citadel: { primary: 'pillar', secondary: 'crystal', tertiary: 'boulder', density: 0.1 },
};

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
  seedSalt: string | number = '',
): { biome: ArenaBiome; terrain: ArenaTerrainTile[] } {
  const lower = String(promptText || '').toLowerCase();
  let biome: ArenaBiome = explicitBiome && explicitBiome.trim() ? explicitBiome.trim() : 'obsidian';

  if (!explicitBiome || explicitBiome === 'obsidian') {
    if (/\b(forest|wood|woods|grove|jungle|glade|thicket|canopy|trees?)\b/.test(lower)) biome = 'forest';
    else if (/\b(desert|sand|dune|oasis|arid|canyon|wasteland|sunbaked)\b/.test(lower)) biome = 'desert';
    else if (/\b(plain|plains|meadow|grass|steppe|field|prairie|savanna)\b/.test(lower)) biome = 'plains';
    else if (/\b(frost|ice|frozen|snow|glacier|blizzard|red gate)\b/.test(lower)) biome = 'frost';
    else if (/\b(lava|magma|volcan|hell|inferno|demon)\b/.test(lower)) biome = 'demon_castle';
    else if (/\b(shinsu|ocean|sea|temple|sunken|river|lake)\b/.test(lower)) biome = 'shinsu_sea';
    else if (/\b(crystal|arcane|library|dungeon|ruin|pillar)\b/.test(lower)) biome = 'double_dungeon';
  }

  const profile = THEME_PROFILES[biome] || THEME_PROFILES.obsidian;
  const rng = makeSeededRng(hashSeedStr(`${lower}|${cols}x${rows}|${biome}${seedSalt !== '' ? `|${seedSalt}` : ''}`));
  const terrain: ArenaTerrainTile[] = [];
  const seen = new Set(occupiedSet);

  let featCounter = 0;

  const addTile = (x: number, y: number, type: TerrainType) => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    terrain.push({ x, y, type });
  };

  const tryPlaceRectFeature = (x: number, y: number, w: number, h: number, type: TerrainType): boolean => {
    if (x < 0 || y < 0 || x + w > cols || y + h > rows) return false;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (seen.has(`${x + dx},${y + dy}`)) return false;
      }
    }
    const featureId = `feat-${++featCounter}-${type}-${w}x${h}`;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        seen.add(`${cx},${cy}`);
        const isAnchor = dx === 0 && dy === 0;
        terrain.push({
          x: cx,
          y: cy,
          type,
          featureId,
          isAnchor,
          ...(isAnchor ? { w, h } : {}),
        });
      }
    }
    return true;
  };

  const placeRandomRectFeatures = (count: number, w: number, h: number, type: TerrainType) => {
    let placed = 0;
    const minM = cols >= 12 ? 1 : 0;
    const maxX = Math.max(minM + 1, cols - w - minM + 1);
    const maxY = Math.max(minM + 1, rows - h - minM + 1);
    for (let attempt = 0; attempt < count * 18 && placed < count; attempt++) {
      const rx = minM + Math.floor(rng() * Math.max(1, maxX - minM));
      const ry = minM + Math.floor(rng() * Math.max(1, maxY - minM));
      if (tryPlaceRectFeature(rx, ry, w, h, type)) {
        placed++;
      }
    }
  };

  const tryPlaceOrganicBody = (cx: number, cy: number, rx: number, ry: number, type: TerrainType) => {
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        const norm = (dx * dx) / Math.max(1, rx * rx) + (dy * dy) / Math.max(1, ry * ry);
        const jitter = (rng() - 0.5) * 0.28;
        if (norm + jitter <= 1.0) {
          addTile(cx + dx, cy + dy, type);
        }
      }
    }
  };

  const placeMeanderingRiver = (type: TerrainType, width = 2) => {
    const horizontal = rng() < 0.65;
    const ford1 = Math.floor((horizontal ? cols : rows) * (0.26 + rng() * 0.14));
    const ford2 = Math.floor((horizontal ? cols : rows) * (0.66 + rng() * 0.14));
    let pos = Math.floor((horizontal ? rows : cols) * (0.35 + rng() * 0.3));
    const len = horizontal ? cols : rows;
    for (let i = 0; i < len; i++) {
      if (i === ford1 || i === ford1 + 1 || i === ford2 || i === ford2 + 1) continue;
      for (let wIdx = 0; wIdx < width; wIdx++) {
        if (horizontal) addTile(i, pos + wIdx, type);
        else addTile(pos + wIdx, i, type);
      }
      if (rng() < 0.42) pos += rng() < 0.5 ? -1 : 1;
      pos = Math.max(2, Math.min((horizontal ? rows : cols) - 3 - width, pos));
    }
  };

  const wantsWater = Boolean(profile.water) || /\b(river|stream|water|creek|brook|lake|pond|ford|moat|flood|oasis|marsh)\b/.test(lower);
  const wantsLava = /\b(lava|magma|molten|inferno|eruption)\b/.test(lower);
  const wantsIce = /\b(ice|frozen|glacier|frost|snow)\b/.test(lower);
  const wantsCrystal = /\b(crystal|shinsu|mana|shard|gem|arcane)\b/.test(lower);
  const wantsPillar = /\b(pillar|column|temple|ruin|shrine|statue|castle|library)\b/.test(lower);
  const wantsRocks = /\b(rock|rocks|boulder|boulders|crag|cliff|stone|rubble|canyon)\b/.test(lower);
  const wantsTrees = /\b(tree|trees|forest|wood|woods|grove|jungle|thicket|timber|canopy|bush)\b/.test(lower);

  // 1. Theme-specific multi-tile D&D & Manhwa landmarks
  const isWoodland = ['forest', 'feywild', 'plains', 'shadowfell'].includes(biome);
  const isTempleOrCitadel = ['double_dungeon', 'arcane_library', 'floor_of_tests', 'necropolis', 'sky_citadel', 'clockwork_aegis'].includes(biome);
  const isFrost = ['frost', 'red_gate'].includes(biome);
  const isInfernal = ['demon_castle', 'nine_hells', 'elemental_fire', 'dragon_lair', 'hell_train'].includes(biome);
  const isAquatic = ['shinsu_sea', 'sunken_temple', 'elemental_water', 'floor_of_death'].includes(biome);

  if (isWoodland) {
    placeRandomRectFeatures(biome === 'plains' ? 2 : 3, 2, 2, 'tree');
    placeRandomRectFeatures(biome === 'plains' ? 1 : 2, 3, 2, 'boulder');
    if (wantsWater || (biome === 'forest' && rng() < 0.6)) {
      if (rng() < 0.55) {
        placeMeanderingRiver('water', 2);
      } else {
        const lx = Math.floor(cols * (0.3 + rng() * 0.4));
        const ly = Math.floor(rows * (0.32 + rng() * 0.36));
        tryPlaceOrganicBody(lx, ly, 3, 2, 'water');
      }
    }
  } else if (isTempleOrCitadel) {
    // Cartenon Double Dungeon / Temple Colonnade: symmetrical 2x2 stone pillars flanking the main aisle
    const leftX = Math.max(2, Math.floor(cols * 0.25) - 1);
    const rightX = Math.min(cols - 4, Math.floor(cols * 0.75) - 1);
    const rowStep = Math.max(4, Math.floor(rows / 4));
    for (let ry = 3; ry <= rows - 5; ry += rowStep) {
      tryPlaceRectFeature(leftX, ry, 2, 2, 'pillar');
      tryPlaceRectFeature(rightX, ry, 2, 2, 'pillar');
    }
    placeRandomRectFeatures(1, 2, 2, biome === 'arcane_library' || biome === 'sky_citadel' ? 'crystal' : 'boulder');
    if (wantsWater) {
      tryPlaceOrganicBody(Math.floor(cols / 2), Math.floor(rows / 2), 2, 2, 'water');
    }
  } else if (isFrost) {
    placeRandomRectFeatures(2, 3, 2, 'ice');
    placeRandomRectFeatures(2, 2, 2, 'tree');
    placeRandomRectFeatures(1, 2, 2, 'boulder');
    if (rng() < 0.65 || wantsWater) {
      const lx = Math.floor(cols * (0.35 + rng() * 0.3));
      const ly = Math.floor(rows * (0.35 + rng() * 0.3));
      tryPlaceOrganicBody(lx, ly, 3, 2, 'water');
    }
  } else if (isInfernal) {
    if (rng() < 0.5 || wantsLava) {
      placeMeanderingRiver('lava', 2);
    } else {
      const lx = Math.floor(cols * (0.3 + rng() * 0.4));
      const ly = Math.floor(rows * (0.35 + rng() * 0.3));
      tryPlaceOrganicBody(lx, ly, 3, 2, 'lava');
    }
    placeRandomRectFeatures(2, 3, 2, 'boulder');
    placeRandomRectFeatures(2, 2, 2, 'pillar');
  } else if (isAquatic) {
    const lx = Math.floor(cols * (0.3 + rng() * 0.4));
    const ly = Math.floor(rows * (0.35 + rng() * 0.3));
    tryPlaceOrganicBody(lx, ly, 3, 2, 'water');
    if (rng() < 0.65) {
      placeMeanderingRiver('water', 2);
    }
    placeRandomRectFeatures(2, 2, 2, 'crystal');
    placeRandomRectFeatures(2, 2, 2, 'pillar');
  } else {
    // Desert, Murim Peaks, Jeju Nest, Underdark, Obsidian, etc.
    placeRandomRectFeatures(2, 3, 2, 'boulder');
    placeRandomRectFeatures(2, 2, 2, biome === 'underdark' || biome === 'astral_sea' || biome === 'shadow_monarch' ? 'crystal' : 'pillar');
    if (biome === 'desert') {
      const ox = Math.floor(cols * (0.3 + rng() * 0.4));
      const oy = Math.floor(rows * (0.35 + rng() * 0.3));
      tryPlaceOrganicBody(ox, oy, 2, 2, 'water');
      addTile(ox - 2, oy - 1, 'tree');
      addTile(ox + 2, oy + 1, 'tree');
    } else if (wantsWater) {
      placeMeanderingRiver('water', 2);
    }
  }

  // 2. Lighter 1x1 tactical cover scatter around the landmarks
  const area = cols * rows;
  const totalCount = Math.max(4, Math.round(area * profile.density * 0.45));
  const primaryType: TerrainType = wantsTrees ? 'tree' : wantsIce ? 'ice' : wantsLava ? 'lava' : wantsCrystal ? 'crystal' : wantsPillar ? 'pillar' : profile.primary;
  const secondaryType: TerrainType = wantsRocks ? 'boulder' : profile.secondary;
  const tertiaryType: TerrainType = profile.tertiary || 'rock';

  for (let i = 0; i < totalCount; i++) {
    const roll = rng();
    const tType = roll < 0.5 ? primaryType : roll < 0.82 ? secondaryType : tertiaryType;
    const rx = Math.floor(rng() * cols);
    const ry = Math.floor(rng() * rows);
    addTile(rx, ry, tType);
  }

  return { biome, terrain };
}

export interface GeneratedStoryBeatDraft {
  title: string;
  narration: string;
  dmSecret: string;
  xpReward: number;
  biome: string;
  terrainPrompt: string;
}

const THEME_BEAT_TEMPLATES: Record<string, { title: string; narration: string; secret: string; prompt: string }> = {
  forest: {
    title: 'Ambush in the Whispering Canopy',
    narration: 'Dense emerald foliage closes in around moss-covered boulders and ancient roots. Shadows shift between the trunks as Tower predators circle the clearing.',
    secret: 'Perception DC 13 spots tripwires strung between the northern trees; boulders grant half-cover.',
    prompt: 'dense forest clearing with ancient trees, moss boulders, and scattered rocks',
  },
  feywild: {
    title: 'Trial of the Enchanted Glade',
    narration: 'Luminous blossoms drift over a crystal-lined brook while gnarled feywood trees hum with wild magic. Every step echoes with alluring, treacherous whispers.',
    secret: 'Arcana/INT DC 14 reveals an illusionary path across the stream; glowing crystals pulse with wild mana.',
    prompt: 'enchanted feywild glade with glowing crystals, trees, boulders, and a winding stream',
  },
  desert: {
    title: 'Crossfire at the Sunbaked Dunes',
    narration: 'Blistering winds whip golden sand around jagged sandstone boulders and buried ruins. Heat shimmer hides whatever stalks behind the rocks.',
    secret: 'Survival DC 13 uncovers a buried supply cache near the central boulder cluster.',
    prompt: 'arid desert canyon with sandstone boulders, jagged rocks, and ancient pillars',
  },
  frost: {
    title: 'Crossing the Frozen Glacier',
    narration: 'Razor-sharp ice spires jut from slick frostbound stone as freezing gales howl across the pass. Frost-rimed boulders offer the only shelter from the storm.',
    secret: 'AGI save DC 13 on rapid sprints near ice spires or slip 1 space.',
    prompt: 'frozen glacier pass with jagged ice spires, frost boulders, and rocks',
  },
  red_gate: {
    title: 'Trapped Inside the Red Gate',
    narration: 'Crimson light bleeds through a snow-choked forest sealed off from the outside world. Frozen pines and towering ice shards box in the hunting ground.',
    secret: 'Gate Boss lurks behind the northern ice ridge; defeating it shatters the Red Gate seal.',
    prompt: 'red gate frozen snowfield with pine trees, jagged ice shards, and boulders',
  },
  shinsu_sea: {
    title: 'Surge of the Shinsu Sea',
    narration: 'Dense aquatic Shinsu swirls around radiant mana crystals and submerged stone pillars. Stepping stones bridge the roaring currents across the arena.',
    secret: 'High Shinsu pressure slows unadapted climbers near water; crystals amplify Wind/Water spells.',
    prompt: 'shinsu sea arena with glowing mana crystals, stone pillars, and rushing water channels',
  },
  demon_castle: {
    title: 'Siege of the 100F Demon Spire',
    narration: 'Molten magma fissures split the obsidian floor between scorched citadel pillars. Ash rains from the vaulted ceiling as demonic sentries emerge.',
    secret: 'Lava fissures deal 1d6 Fire damage if knocked onto an adjacent tile; pillars block ranged lines.',
    prompt: 'demon castle spire with molten lava fissures, obsidian pillars, and boulders',
  },
  double_dungeon: {
    title: 'Commandments of Cartenon Temple',
    narration: 'Colossal carved pillars tower over a silent stone sanctum lit by eerie blue crystals. Ancient runes flare along the walls as the temple doors slam shut.',
    secret: 'Observe the central altar or pillars (PER DC 14) to spot the hidden safe zone before the statues awaken.',
    prompt: 'ancient temple sanctum with towering stone pillars, blue crystals, and boulders',
  },
  underdark: {
    title: 'Echoes of the Fungal Abyss',
    narration: 'Bioluminescent crystal clusters cast violet light across jagged cavern boulders. Deep chasms echo with the skittering of subterranean horrors.',
    secret: 'Darkvision or Torchbearer reveals ambushers perched behind the crystal formations.',
    prompt: 'underdark cavern with glowing crystal clusters, boulders, and jagged rocks',
  },
  nine_hells: {
    title: 'Pact of the Avernus Crucible',
    narration: 'Rivers of hellfire carve through blackened iron pillars and brimstone boulders. The air tastes of sulfur and broken oaths.',
    secret: 'Devils gain +1 Attack Hit near lava vents unless lured toward the central pillars.',
    prompt: 'avernus battlefield with lava vents, iron pillars, and brimstone boulders',
  },
};

export function generateThemedStoryBeat(floorNum: number, themeId: string): GeneratedStoryBeatDraft {
  const fl = Math.max(1, Math.trunc(Number(floorNum || 1)));
  const cleanTheme = String(themeId || 'forest').trim() || 'forest';
  const label = getFloorThemeLabel(cleanTheme);
  const tpl = THEME_BEAT_TEMPLATES[cleanTheme];
  const xpReward = 60 + fl * 40;

  if (tpl) {
    return {
      title: `${fl}F • ${tpl.title}`,
      narration: tpl.narration,
      dmSecret: tpl.secret,
      xpReward,
      biome: cleanTheme,
      terrainPrompt: tpl.prompt,
    };
  }

  return {
    title: `${fl}F • Trial of ${label.split(' (')[0]}`,
    narration: `Climbers step onto Floor ${fl}F (${label}). Obstacles and treacherous terrain shape the battlefield ahead as hostile forces close in.`,
    dmSecret: `Floor ${fl}F hazard (DC ${11 + Math.min(8, fl)}): Watch for ambushers using the terrain for cover.`,
    xpReward,
    biome: cleanTheme,
    terrainPrompt: `${label.toLowerCase()} arena with boulders, rocks, and obstacles`,
  };
}

export function computeReachableMoveCells(params: {
  startX: number;
  startY: number;
  maxSpaces: number;
  cols: number;
  rows: number;
  terrain?: Array<{ x: number; y: number }>;
}): {
  cells: Array<{ x: number; y: number; dist: number }>;
  distByKey: Map<string, number>;
} {
  const { startX, startY, maxSpaces, cols, rows, terrain = [] } = params;
  const maxDist = Math.max(0, Math.trunc(Number(maxSpaces) || 0));
  const blockedSet = new Set(terrain.map((t) => `${t.x},${t.y}`));
  const cells: Array<{ x: number; y: number; dist: number }> = [];
  const distByKey = new Map<string, number>();

  if (maxDist <= 0 || startX < 0 || startX >= cols || startY < 0 || startY >= rows) {
    return { cells, distByKey };
  }

  const visited = new Set<string>([`${startX},${startY}`]);
  const queue: Array<{ x: number; y: number; dist: number }> = [{ x: startX, y: startY, dist: 0 }];
  let head = 0;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (head < queue.length) {
    const cur = queue[head++];
    if (cur.dist >= maxDist) continue;
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key) || blockedSet.has(key)) continue;
      visited.add(key);
      const nextDist = cur.dist + 1;
      distByKey.set(key, nextDist);
      cells.push({ x: nx, y: ny, dist: nextDist });
      queue.push({ x: nx, y: ny, dist: nextDist });
    }
  }

  return { cells, distByKey };
}
