import React, { useEffect, useRef, useState } from 'react';
import {
  CHEST_TIERS,
  FLOOR_THEMES,
  NPC_ICON_IDS,
  TOKEN_ICON_META,
  VALID_TERRAIN_TYPES,
  generateArenaTerrainFromPrompt,
  generateThemedStoryBeat,
  getArenaCellPx,
  getChestDefaultsForFloor,
  getFloorThemeLabel,
  scaleMonsterForFloor,
  scaleTreasureForFloor,
  type ArenaTerrainTile,
  type BeatEncounterSpec,
  type BeatTreasureSpec,
  type ChestTier,
  type NpcIconId,
  type StoryPromptBranch,
  type TerrainType,
} from '@shared/index';
import { getScaledCanvasCell } from '../../canvas/coordinates';
import {
  drawArenaBackground,
  drawArenaTerrainLayer,
  drawChestIcon,
  drawTokenAvatar,
} from '../../canvas/drawPrimitives';
import { useVtt } from '../../context/VttContext';
import { StoryFlowchartView } from '../common/StoryFlowchartView';
import { TokenIconSvg } from '../common/TokenIconSvg';

interface StagedNpc {
  name: string;
  npcRole: string;
  iconId?: NpcIconId;
  startX: number | null;
  startY: number | null;
  dialogue: string;
  rewardType: string;
  rewardItemName: string;
  rewardXp: number;
}

interface DraftChest {
  name: string;
  tier: ChestTier;
  gold: number;
  manaStones: number;
  itemName: string;
  x: number;
  y: number;
}

type DraftTool =
  | { kind: 'player'; id: string }
  | { kind: 'monster'; index: number }
  | { kind: 'npc'; index: number }
  | { kind: 'chest' | TerrainType };

const TERRAIN_CHIP_STYLES: Record<TerrainType, { label: string; color: string; border: string }> = {
  tree: { label: 'Tree', color: '#4ade80', border: 'rgba(34,197,94,0.6)' },
  rock: { label: 'Rock', color: '#cbd5e1', border: 'rgba(148,163,184,0.6)' },
  boulder: { label: 'Boulder', color: '#d4d4d8', border: 'rgba(161,161,170,0.7)' },
  water: { label: 'Water', color: '#38bdf8', border: 'rgba(56,189,248,0.6)' },
  crystal: { label: 'Crystal', color: '#67e8f9', border: 'rgba(6,182,212,0.7)' },
  pillar: { label: 'Pillar', color: '#e2e8f0', border: 'rgba(203,213,225,0.65)' },
  lava: { label: 'Lava', color: '#fb923c', border: 'rgba(234,88,12,0.7)' },
  ice: { label: 'Ice', color: '#bae6fd', border: 'rgba(14,165,233,0.7)' },
};

interface DraftBranchConfig {
  scenario: string;
  dmNote: string;
  nextQuestion: string;
  statCheckStat: string;
  statCheckDc: number;
  rewardType: 'none' | 'treasure' | 'chest';
  rewardTreasureId: string;
  rewardItemName: string;
  rewardItemCategory: string;
  rewardChestTier: ChestTier;
  rewardGold: number;
  rewardManaStones: number;
  endsInCombat: boolean;
  combatMonsterPresetId: string;
  combatMonsterQty: number;
}

const DEFAULT_DRAFT_BRANCH: DraftBranchConfig = {
  scenario: '',
  dmNote: '',
  nextQuestion: '',
  statCheckStat: '',
  statCheckDc: 12,
  rewardType: 'none',
  rewardTreasureId: '',
  rewardItemName: '',
  rewardItemCategory: 'relic',
  rewardChestTier: 'Common',
  rewardGold: 50,
  rewardManaStones: 1,
  endsInCombat: false,
  combatMonsterPresetId: '',
  combatMonsterQty: 2,
};

export function DmStoryTab() {
  const { state, sendAction, pushLocalToast, setActiveBeatDetailId, setActiveBeatMapId, setActivePromptModal } = useVtt();

  const [lootTarget, setLootTarget] = useState('all');

  // + New Story Beat (Narration & Player Q&A — No Combat)
  const [narTitle, setNarTitle] = useState('');
  const [narFloor, setNarFloor] = useState(1);
  const [narXpReward, setNarXpReward] = useState(50);
  const [narText, setNarText] = useState('');
  const [narSecret, setNarSecret] = useState('');
  const [narPresentNow, setNarPresentNow] = useState(false);
  const [narQuestion, setNarQuestion] = useState('');
  const [narTarget, setNarTarget] = useState('all');
  const [narOptionDraft, setNarOptionDraft] = useState('');
  const [narOptions, setNarOptions] = useState<string[]>([]);
  const [narBranches, setNarBranches] = useState<Record<string, DraftBranchConfig>>({});
  const [narShowFlowchart, setNarShowFlowchart] = useState(true);
  const [narStagedPrompts, setNarStagedPrompts] = useState<
    Array<{ question: string; target: string; targetName: string; options?: string[]; branches?: StoryPromptBranch[] }>
  >([]);
  const [liveAskInputs, setLiveAskInputs] = useState<Record<string, { question: string; target: string; optionsText: string }>>({});
  const [openFlowchartBeatIds, setOpenFlowchartBeatIds] = useState<Record<string, boolean>>({});

  // + New Combat Story Beat Form
  const [title, setTitle] = useState('');
  const [floor, setFloor] = useState(3);
  const [xpReward, setXpReward] = useState(100);
  const [maxRounds, setMaxRounds] = useState(20);
  const [gridSize, setGridSize] = useState(20);
  const [narration, setNarration] = useState('');
  const [dmSecret, setDmSecret] = useState('');
  const [presentNow, setPresentNow] = useState(false);

  // Staged monsters
  const [stagedMonsters, setStagedMonsters] = useState<BeatEncounterSpec[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [monName, setMonName] = useState('');
  const [monQty, setMonQty] = useState(1);
  const [monFloor, setMonFloor] = useState(1);
  const [monAtk, setMonAtk] = useState('1d20+5');
  const [monDmg, setMonDmg] = useState('1d8+3');
  const [monHp, setMonHp] = useState(26);
  const [monAc, setMonAc] = useState(14);
  const [monDr, setMonDr] = useState(1);
  const [monX, setMonX] = useState('');
  const [monY, setMonY] = useState('');

  const applyMonsterFloorScale = (targetFloor: number, presetId = selectedPresetId) => {
    const f = Math.max(1, Math.min(100, Math.trunc(Number(targetFloor) || 1)));
    const preset = (state?.bestiary || []).find((b) => b.id === presetId);
    const base = preset
      ? { maxHp: preset.maxHp, ac: preset.ac, dr: preset.dr, attackFormula: preset.attackFormula, damageFormula: preset.damageFormula }
      : { maxHp: 26, ac: 14, dr: 1, attackFormula: '1d20+5', damageFormula: '1d8+3' };
    const scaled = scaleMonsterForFloor(base, f);
    setMonFloor(f);
    setMonHp(scaled.maxHp);
    setMonAc(scaled.ac);
    setMonDr(scaled.dr);
    setMonAtk(scaled.attackFormula);
    setMonDmg(scaled.damageFormula);
  };

  const handleAutoGenerateMonsters = () => {
    const pool = (state?.bestiary || []).filter((b) => b.category !== 'Boss');
    const source = pool.length > 0 ? pool : (state?.bestiary || []);
    if (source.length === 0) return;
    const picked = source[Math.floor(Math.random() * source.length)];
    const f = Math.max(1, Math.trunc(Number(monFloor) || floor || 1));
    const scaled = scaleMonsterForFloor(picked, f);
    const qty = Math.max(1, Math.min(20, Math.trunc(Number(monQty) || 1)));
    const batch: BeatEncounterSpec[] = [];
    for (let i = 0; i < qty; i++) {
      batch.push({
        name: qty > 1 ? `${picked.name} #${i + 1}` : picked.name,
        floor: f,
        maxHp: scaled.maxHp,
        ac: scaled.ac,
        dr: scaled.dr,
        attackFormula: scaled.attackFormula,
        damageFormula: scaled.damageFormula,
        startX: monX ? Math.min(gridSize, Number(monX) + i) : null,
        startY: monY ? Number(monY) : null,
      });
    }
    setSelectedPresetId(picked.id);
    setMonHp(scaled.maxHp);
    setMonAc(scaled.ac);
    setMonDr(scaled.dr);
    setMonAtk(scaled.attackFormula);
    setMonDmg(scaled.damageFormula);
    setStagedMonsters((prev) => [...prev, ...batch]);
    pushLocalToast({
      title: 'MONSTERS AUTO-GENERATED',
      message: `Added ${qty}× ${picked.name} (${f}F scaled: ${scaled.maxHp} HP, AC ${scaled.ac}).`,
      category: 'combat',
    });
  };

  const buildMonsterBatch = (): BeatEncounterSpec[] => {
    const qty = Math.max(1, Math.min(20, Math.trunc(Number(monQty) || 1)));
    const baseName = monName.trim();
    const list: BeatEncounterSpec[] = [];
    for (let i = 0; i < qty; i++) {
      list.push({
        name: qty > 1 ? `${baseName} #${i + 1}` : baseName,
        floor: Math.max(1, Math.trunc(Number(monFloor) || 1)),
        maxHp: monHp,
        ac: monAc,
        dr: monDr,
        attackFormula: monAtk.trim() || '1d20+5',
        damageFormula: monDmg.trim() || '1d8+3',
        startX: monX ? Math.min(gridSize, Number(monX) + i) : null,
        startY: monY ? Number(monY) : null,
      });
    }
    return list;
  };

  // Staged NPCs
  const [stagedNpcs, setStagedNpcs] = useState<StagedNpc[]>([]);
  const [npcName, setNpcName] = useState('');
  const [npcRole, setNpcRole] = useState('');
  const [npcIconId, setNpcIconId] = useState<NpcIconId | ''>('');
  const [npcX, setNpcX] = useState('');
  const [npcY, setNpcY] = useState('');
  const [npcDialogue, setNpcDialogue] = useState('');
  const [npcRewardType, setNpcRewardType] = useState('none');
  const [npcRewardName, setNpcRewardName] = useState('');
  const [npcRewardXp, setNpcRewardXp] = useState(50);

  // Staged Treasures
  const [stagedTreasures, setStagedTreasures] = useState<BeatTreasureSpec[]>([]);
  const [trName, setTrName] = useState('');
  const [trCat, setTrCat] = useState('relic');
  const [trGold, setTrGold] = useState(100);
  const [trStones, setTrStones] = useState(2);
  const [trDmg, setTrDmg] = useState('');

  // Draft Arena Designer
  const [draftBiome, setDraftBiome] = useState('obsidian');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftTerrain, setDraftTerrain] = useState<ArenaTerrainTile[]>([]);
  const [draftChests, setDraftChests] = useState<DraftChest[]>([]);
  const [draftChestTier, setDraftChestTier] = useState<ChestTier>('Common');
  const [chestFormName, setChestFormName] = useState('Common Chest');
  const [chestFormGold, setChestFormGold] = useState(25);
  const [chestFormStones, setChestFormStones] = useState(0);
  const [chestFormItem, setChestFormItem] = useState('');
  const [chestFormX, setChestFormX] = useState('');
  const [chestFormY, setChestFormY] = useState('');

  const applyChestTierScale = (tier: ChestTier, targetFloor = floor) => {
    const def = getChestDefaultsForFloor(tier, targetFloor);
    setDraftChestTier(tier);
    setChestFormName(def.name);
    setChestFormGold(def.gold);
    setChestFormStones(def.manaStones);
  };
  const [draftPlayerPositions, setDraftPlayerPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draftTool, setDraftTool] = useState<DraftTool | null>(null);
  const [draftHoverCell, setDraftHoverCell] = useState<{ x: number; y: number } | null>(null);
  const [draftHint, setDraftHint] = useState('Select a player, attached monster, or Treasure Chest above, then tap a grid space below.');
  const draftCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const chars = Object.values(state?.characters || {});
  const unlockedFloors = [...(state?.map?.floors || [])].sort((a, b) => a.number - b.number);
  const activeFloorObj = unlockedFloors.find((f) => Number(f.number) === Number(floor)) || unlockedFloors[0];
  const activeFloorTheme = activeFloorObj?.theme || 'forest';

  useEffect(() => {
    if (unlockedFloors.length > 0 && !unlockedFloors.some((f) => Number(f.number) === Number(floor))) {
      const first = unlockedFloors[0];
      setFloor(first.number);
      setNarFloor(first.number);
      setDraftBiome(first.theme || 'forest');
      applyMonsterFloorScale(first.number);
    }
  }, [unlockedFloors.length]);

  useEffect(() => {
    if (!draftTool && chars[0]) {
      setDraftTool({ kind: 'player', id: chars[0].id });
    }
    if (chars.length > 0) {
      setDraftPlayerPositions((prev) => {
        const next = { ...prev };
        let changed = false;
        const startX = Math.max(0, Math.floor(gridSize / 2) - Math.floor(chars.length / 2));
        const startY = Math.max(0, gridSize - 4);
        chars.forEach((ch, idx) => {
          if (!next[ch.id]) {
            next[ch.id] = { x: Math.min(gridSize - 1, startX + idx * 2), y: startY };
            changed = true;
          } else {
            const cx = Math.min(gridSize - 1, next[ch.id].x);
            const cy = Math.min(gridSize - 1, next[ch.id].y);
            if (cx !== next[ch.id].x || cy !== next[ch.id].y) {
              next[ch.id] = { x: cx, y: cy };
              changed = true;
            }
          }
        });
        return changed ? next : prev;
      });
    }
  }, [chars.length, gridSize]);

  useEffect(() => {
    const canvas = draftCanvasRef.current;
    if (!canvas || !state?.characters) return;
    const cellPx = getArenaCellPx(gridSize, 'draft');
    const axisPad = 22;
    const w = axisPad + gridSize * cellPx;
    const h = axisPad + gridSize * cellPx;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawArenaBackground(ctx, draftBiome, axisPad, gridSize, gridSize, cellPx, w, h);

    if (draftHoverCell && draftHoverCell.x >= 0 && draftHoverCell.x < gridSize && draftHoverCell.y >= 0 && draftHoverCell.y < gridSize) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
      ctx.fillRect(axisPad + draftHoverCell.x * cellPx, axisPad + draftHoverCell.y * cellPx, cellPx, cellPx);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(axisPad + draftHoverCell.x * cellPx + 0.5, axisPad + draftHoverCell.y * cellPx + 0.5, cellPx - 1, cellPx - 1);
    }

    drawArenaTerrainLayer(ctx, draftTerrain, axisPad, cellPx, draftBiome, gridSize, gridSize);

    for (const c of draftChests) {
      drawChestIcon(ctx, { opened: false, tier: c.tier }, axisPad + c.x * cellPx + cellPx / 2, axisPad + c.y * cellPx + cellPx / 2, cellPx);
    }

    const r = Math.max(7, Math.floor(cellPx * 0.4));
    for (const ch of chars) {
      const pos = draftPlayerPositions[ch.id];
      if (!pos) continue;
      drawTokenAvatar(
        ctx,
        { id: ch.id, name: ch.name, type: 'player', label: ch.name.slice(0, 2).toUpperCase(), color: '#38bdf8' },
        axisPad + pos.x * cellPx + cellPx / 2,
        axisPad + pos.y * cellPx + cellPx / 2,
        r,
        draftTool?.kind === 'player' && draftTool.id === ch.id,
        state.characters,
      );
    }

    const startX = Math.max(0, Math.floor(gridSize / 2) - Math.floor(chars.length / 2));
    stagedMonsters.forEach((m, idx) => {
      const mx = m.startX ? Number(m.startX) - 1 : Math.min(gridSize - 1, startX + idx * 2);
      const my = m.startY ? Number(m.startY) - 1 : Math.min(gridSize - 1, 3);
      drawTokenAvatar(
        ctx,
        { id: `draft-mon-${idx}`, name: m.name, type: 'monster', label: m.name.slice(0, 2).toUpperCase(), color: '#ef4444' },
        axisPad + mx * cellPx + cellPx / 2,
        axisPad + my * cellPx + cellPx / 2,
        r,
        draftTool?.kind === 'monster' && draftTool.index === idx,
        state.characters,
      );
    });

    stagedNpcs.forEach((n, idx) => {
      const nx = n.startX ? Number(n.startX) - 1 : Math.min(gridSize - 1, 2 + idx * 2);
      const ny = n.startY ? Number(n.startY) - 1 : Math.min(gridSize - 1, Math.floor(gridSize / 2));
      drawTokenAvatar(
        ctx,
        { id: `draft-npc-${idx}`, name: n.name, type: 'npc', label: n.name.slice(0, 2).toUpperCase(), color: '#10b981' },
        axisPad + nx * cellPx + cellPx / 2,
        axisPad + ny * cellPx + cellPx / 2,
        r,
        draftTool?.kind === 'npc' && draftTool.index === idx,
        state.characters,
      );
    });
  }, [state?.characters, gridSize, draftBiome, draftTerrain, draftChests, draftPlayerPositions, draftTool, draftHoverCell, stagedMonsters, stagedNpcs]);

  if (!state) return null;

  const buildOccupiedSet = () => {
    const occ = new Set<string>();
    Object.values(draftPlayerPositions).forEach((p) => {
      if (p) occ.add(`${p.x},${p.y}`);
    });
    stagedMonsters.forEach((m) => {
      if (m.startX && m.startY) occ.add(`${Number(m.startX) - 1},${Number(m.startY) - 1}`);
    });
    draftChests.forEach((c) => occ.add(`${c.x},${c.y}`));
    return occ;
  };

  const handleGenerateDraftTerrain = (overrideBiome?: string, overridePrompt?: string) => {
    const occ = buildOccupiedSet();
    const targetBiome = overrideBiome ?? draftBiome;
    const targetPrompt = overridePrompt ?? draftPrompt.trim();
    const salt = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const gen = generateArenaTerrainFromPrompt(targetPrompt, gridSize, gridSize, targetBiome, occ, salt);
    setDraftBiome(gen.biome);
    setDraftTerrain(gen.terrain);
    setDraftHint(`Generated ${gen.terrain.length} terrain obstacles (${getFloorThemeLabel(gen.biome)}).`);
  };

  const handleAutoGenerateBeat = () => {
    const generated = generateThemedStoryBeat(floor, activeFloorTheme);
    setTitle(generated.title);
    setNarration(generated.narration);
    setDmSecret(generated.dmSecret);
    setXpReward(generated.xpReward);
    setDraftBiome(generated.biome);
    setDraftPrompt(generated.terrainPrompt);
    handleGenerateDraftTerrain(generated.biome, generated.terrainPrompt);
    pushLocalToast({
      title: 'STORY BEAT GENERATED',
      message: `Generated ${generated.title} with ${getFloorThemeLabel(activeFloorTheme)} terrain.`,
      category: 'info',
    });
  };

  const handleDraftCanvasClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = draftCanvasRef.current;
    if (!canvas || !draftTool) return;
    const cellPx = getArenaCellPx(gridSize, 'draft');
    const { x, y } = getScaledCanvasCell(canvas, ev.clientX, ev.clientY, 22, cellPx);
    if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) return;

    if (draftTool.kind === 'player') {
      setDraftPlayerPositions((prev) => ({ ...prev, [draftTool.id]: { x, y } }));
      setDraftHint(`Set player start to (${x + 1}, ${y + 1}).`);
    } else if (draftTool.kind === 'monster') {
      setStagedMonsters((prev) =>
        prev.map((m, i) => (i === draftTool.index ? { ...m, startX: x + 1, startY: y + 1 } : m)),
      );
      setDraftHint(`Set monster start to (${x + 1}, ${y + 1}).`);
    } else if (draftTool.kind === 'npc') {
      setStagedNpcs((prev) =>
        prev.map((n, i) => (i === draftTool.index ? { ...n, startX: x + 1, startY: y + 1 } : n)),
      );
      setDraftHint(`Set NPC start to (${x + 1}, ${y + 1}).`);
    } else if (VALID_TERRAIN_TYPES.includes(draftTool.kind as TerrainType)) {
      const tileType: ArenaTerrainTile['type'] = draftTool.kind as TerrainType;
      setDraftTerrain((prev) => {
        const idx = prev.findIndex((t) => t.x === x && t.y === y);
        if (idx >= 0 && prev[idx].type === tileType) {
          setDraftHint(`Cleared ${tileType} at (${x + 1}, ${y + 1}).`);
          return prev.filter((_, i) => i !== idx);
        }
        if (idx >= 0) {
          setDraftHint(`Set ${tileType} at (${x + 1}, ${y + 1}).`);
          return prev.map((t, i) => (i === idx ? { ...t, type: tileType } : t));
        }
        setDraftHint(`Placed ${tileType} at (${x + 1}, ${y + 1}).`);
        return [...prev, { x, y, type: tileType }];
      });
    } else if (draftTool.kind === 'chest') {
      setDraftChests((prev) => {
        const idx = prev.findIndex((c) => c.x === x && c.y === y);
        if (idx >= 0) {
          setDraftHint(`Removed chest at (${x + 1}, ${y + 1}).`);
          return prev.filter((_, i) => i !== idx);
        }
        const def = getChestDefaultsForFloor(draftChestTier, floor);
        setDraftHint(`Placed ${draftChestTier} Chest at (${x + 1}, ${y + 1}) [${def.gold}G, ${def.manaStones} Stones]. Click again to remove.`);
        return [
          ...prev,
          { name: `${draftChestTier} Chest`, tier: draftChestTier, gold: def.gold, manaStones: def.manaStones, itemName: '', x, y },
        ];
      });
    }
  };

  const handleAutoGenerateNarrationBeat = () => {
    const flObj = unlockedFloors.find((f) => Number(f.number) === Number(narFloor)) || unlockedFloors[0];
    const themeId = flObj?.theme || 'forest';
    const generated = generateThemedStoryBeat(narFloor, themeId);
    setNarTitle(`${narFloor}F • ${generated.title.replace(/^\d+F\s*•\s*/, '')} (Chronicle)`);
    setNarText(generated.narration);
    setNarSecret(generated.dmSecret);
    setNarXpReward(Math.max(25, Math.round(generated.xpReward * 0.6)));
    const optA = 'Inspect the ancient runes';
    const optB = 'Step forward and challenge the guardian';
    const optC = 'Search the shadows for traps';
    const firstTreasure = (state?.treasureCatalog || [])[0];
    const firstMon = (state?.bestiary || [])[0];
    const chestDef = getChestDefaultsForFloor('Rare', narFloor, state?.chestCatalog);
    setNarQuestion('How do you approach the chamber, and what does your character do first?');
    setNarOptions([optA, optB, optC]);
    setNarBranches({
      [optA]: {
        ...DEFAULT_DRAFT_BRANCH,
        scenario: 'The runes flare with azure Shinsu light, revealing a hidden passage and granting the party a clue about the Floor Guardian’s weakness!',
        dmNote: 'INT Stat Check triggers floor-scaled bonus XP & Gold, plus a Scenario Treasure.',
        nextQuestion: 'Do you enter the newly revealed rune passage or remain in the main hall?',
        statCheckStat: 'INT',
        statCheckDc: 11 + Math.floor(narFloor * 1.2),
        rewardType: 'treasure',
        rewardTreasureId: firstTreasure?.id || '',
        rewardItemName: firstTreasure?.name || `${narFloor}F Rune Relic`,
        rewardItemCategory: firstTreasure?.category || 'relic',
        rewardGold: 30 * narFloor,
        rewardManaStones: Math.max(1, Math.floor(narFloor / 2)),
      },
      [optB]: {
        ...DEFAULT_DRAFT_BRANCH,
        scenario: 'The chamber doors slam shut as the Guardian awakens with a booming challenge! Hostiles emerge to test the climbers in combat!',
        dmNote: 'Resolves this Narration Beat and auto-generates a new Combat Story Beat!',
        nextQuestion: '',
        statCheckStat: 'STR',
        statCheckDc: 11 + Math.floor(narFloor * 1.2),
        endsInCombat: true,
        combatMonsterPresetId: firstMon?.id || '',
        combatMonsterQty: 2,
      },
      [optC]: {
        ...DEFAULT_DRAFT_BRANCH,
        scenario: 'Your careful scouting spots pressure plates along the marble pillars before anyone triggers them, uncovering a Rare Treasure Chest left by previous climbers!',
        dmNote: 'PER Stat Check + Rare Chest reward.',
        nextQuestion: 'Do you disarm the mechanism for resources or slip past silently?',
        statCheckStat: 'PER',
        statCheckDc: 11 + Math.floor(narFloor * 1.2),
        rewardType: 'chest',
        rewardChestTier: 'Rare',
        rewardGold: chestDef.gold,
        rewardManaStones: chestDef.manaStones,
      },
    });
    setNarShowFlowchart(true);
    pushLocalToast({
      title: 'NARRATION & FLOWCHART GENERATED',
      message: `Generated narrative scene, 3 options, Stat Checks, Chest/Treasure rewards & Combat branch for ${narFloor}F.`,
      category: 'info',
    });
  };

  const buildCurrentNarBranches = (opts: string[]): StoryPromptBranch[] => {
    const list: StoryPromptBranch[] = [];
    for (const opt of opts) {
      const cfg = narBranches[opt];
      if (cfg && cfg.scenario.trim()) {
        list.push({
          option: opt,
          scenario: cfg.scenario.trim(),
          ...(cfg.dmNote.trim() ? { dmNote: cfg.dmNote.trim() } : {}),
          ...(cfg.nextQuestion.trim() && !cfg.endsInCombat ? { nextQuestion: cfg.nextQuestion.trim() } : {}),
          ...(cfg.statCheckStat
            ? { statCheckStat: cfg.statCheckStat, statCheckDc: Math.max(5, Number(cfg.statCheckDc || 12)) }
            : {}),
          ...(cfg.rewardType !== 'none'
            ? {
                rewardType: cfg.rewardType,
                rewardTreasureId: cfg.rewardTreasureId || undefined,
                rewardItemName: cfg.rewardItemName.trim() || undefined,
                rewardItemCategory: cfg.rewardItemCategory || 'relic',
                rewardChestTier: cfg.rewardChestTier || 'Common',
                rewardGold: Math.max(0, Number(cfg.rewardGold || 0)),
                rewardManaStones: Math.max(0, Number(cfg.rewardManaStones || 0)),
              }
            : {}),
          ...(cfg.endsInCombat
            ? {
                endsInCombat: true,
                combatMonsterPresetId: cfg.combatMonsterPresetId || undefined,
                combatMonsterQty: Math.max(1, Number(cfg.combatMonsterQty || 2)),
              }
            : {}),
        });
      }
    }
    return list;
  };

  const handleCreateNarrationBeat = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const prompts = [...narStagedPrompts];
    if (narQuestion.trim()) {
      const targetChar = narTarget !== 'all' ? state?.characters?.[narTarget] : undefined;
      const pendingOpts = [...narOptions];
      if (narOptionDraft.trim()) pendingOpts.push(narOptionDraft.trim());
      const branches = buildCurrentNarBranches(pendingOpts);
      prompts.push({
        question: narQuestion.trim(),
        target: narTarget,
        targetName: narTarget === 'all' ? 'All Players (Group)' : (targetChar?.name || 'Player'),
        ...(pendingOpts.length > 0 ? { options: pendingOpts } : {}),
        ...(branches.length > 0 ? { branches } : {}),
      });
    }
    const flObj = unlockedFloors.find((f) => Number(f.number) === Number(narFloor)) || unlockedFloors[0];
    const res = await sendAction<{ beat?: { id: string; prompts?: Array<{ id: string; target: string }> } }>('story_action', {
      subAction: 'add_beat',
      beatType: 'narration',
      title: narTitle.trim(),
      floor: narFloor,
      xpReward: narXpReward,
      gridSize: 20,
      narration: narText.trim(),
      dmSecret: narSecret.trim(),
      presentNow: narPresentNow,
      biome: flObj?.theme || 'obsidian',
      encounters: [],
      prompts,
    });
    if (!res) return;
    setNarTitle('');
    setNarText('');
    setNarSecret('');
    setNarQuestion('');
    setNarTarget('all');
    setNarOptionDraft('');
    setNarOptions([]);
    setNarBranches({});
    setNarStagedPrompts([]);
    setNarPresentNow(false);
    const createdBeat = res.beat;
    const groupPrompt = createdBeat?.prompts?.find((p) => p.target === 'all') || createdBeat?.prompts?.[0];
    if (createdBeat && groupPrompt) {
      setActivePromptModal({ beatId: createdBeat.id, promptId: groupPrompt.id });
    }
    pushLocalToast({
      title: 'STORY BEAT CREATED',
      message: `Added narration story beat "${narTitle.trim()}".`,
      category: 'info',
    });
  };

  const handleCreateBeat = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const encounters = [...stagedMonsters];
    if (monName.trim()) {
      encounters.push(...buildMonsterBatch());
    }

    const npcs = [...stagedNpcs];
    if (npcName.trim()) {
      npcs.push({
        name: npcName.trim(),
        npcRole: npcRole.trim() || 'NPC',
        startX: npcX ? Number(npcX) : null,
        startY: npcY ? Number(npcY) : null,
        dialogue: npcDialogue.trim(),
        rewardType: npcRewardType,
        rewardItemName: npcRewardName.trim(),
        rewardXp: npcRewardXp,
      });
    }

    const treasures = [...stagedTreasures];
    if (trName.trim()) {
      treasures.push({
        id: `tr-${Date.now().toString(36)}`,
        name: trName.trim(),
        category: trCat,
        qty: 1,
        gold: trGold,
        manaStones: trStones,
        damageDice: trDmg.trim(),
      });
    }

    const res = await sendAction('story_action', {
      subAction: 'add_beat',
      beatType: 'combat',
      title: title.trim(),
      floor,
      xpReward,
      maxRounds,
      gridSize,
      narration: narration.trim(),
      dmSecret: dmSecret.trim(),
      presentNow,
      encounters,
      npcs,
      treasures,
      playerPositions: draftPlayerPositions,
      chests: draftChests,
      biome: draftBiome,
      ...(draftTerrain.length > 0 ? { terrain: draftTerrain } : {}),
      arenaPrompt: draftPrompt.trim(),
    });
    if (!res) return;

    setTitle('');
    setNarration('');
    setDmSecret('');
    setPresentNow(false);
    setStagedMonsters([]);
    setStagedNpcs([]);
    setStagedTreasures([]);
    setMonName('');
    setNpcName('');
    setTrName('');
    const nextPositions: Record<string, { x: number; y: number }> = {};
    const startX = Math.max(0, Math.floor(gridSize / 2) - Math.floor(chars.length / 2));
    const startY = Math.max(0, gridSize - 4);
    chars.forEach((c, idx) => {
      nextPositions[c.id] = { x: Math.min(gridSize - 1, startX + idx * 2), y: startY };
    });
    setDraftPlayerPositions(nextPositions);
    setDraftChests([]);
    setDraftBiome('obsidian');
    setDraftTerrain([]);
    setDraftPrompt('');
  };

  return (
    <div className="two-col">
      <div className="col stack">
        <div className="panel card-glow-gold">
          <div className="panel-header">
            <h3>Story Beats</h3>
            <div className="row-inline" style={{ maxWidth: '240px' }}>
              <select id="dm-story-loot-target" title="Treasure Recipient" value={lootTarget} onChange={(e) => setLootTarget(e.target.value)}>
                <option value="all">Treasure -&gt; All Players</option>
                {chars.map((c) => (
                  <option key={c.id} value={c.id}>Treasure -&gt; {c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div id="dm-story-list" className="list-stack">
            {(state.storyBeats || []).length > 0 ? (
              state.storyBeats.map((b) => {
                const monSummary = (b.encounters || []).map((e) => `${e.name} (${e.maxHp} HP)`).join(', ');
                const trSummary = (b.treasures || []).map((t) => `${t.name}${t.gold ? ` + ${t.gold}G` : ''}`).join(', ');
                const unspawnedCount = (() => {
                  const counts = new Map<string, number>();
                  for (const tok of b.arena?.tokens || []) {
                    if (tok.type === 'monster') {
                      const k = String(tok.name || '').trim().toLowerCase();
                      counts.set(k, (counts.get(k) || 0) + 1);
                    }
                  }
                  let rem = 0;
                  for (const enc of b.encounters || []) {
                    const k = String(enc.name || '').trim().toLowerCase();
                    const c = counts.get(k) || 0;
                    if (c > 0) counts.set(k, c - 1);
                    else rem++;
                  }
                  return rem;
                })();
                return (
                  <div
                    key={b.id}
                    className={`story-beat-card ${b.status === 'active' ? 'beat-active' : ''} ${b.presented ? 'beat-presented' : ''}`}
                  >
                    <div className="item-card-top">
                      <strong>{b.title}</strong>
                      <div className="btn-row">
                        <span className={`tag ${b.beatType === 'narration' ? 'tag-purple' : 'tag-crimson'}`}>
                          {b.beatType === 'narration' ? 'NARRATION BEAT' : 'COMBAT BEAT'}
                        </span>
                        {b.beatType !== 'narration' && (
                          <span className="tag tag-gold">MAX {b.maxRounds || 20} ROUNDS</span>
                        )}
                        <span className={`tag ${b.status === 'failed' ? 'tag-crimson' : b.presented ? 'tag-cyan' : 'tag-gold'}`}>
                          {b.status === 'failed' ? 'FAILED' : b.presented ? 'PRESENTED' : String(b.status || 'upcoming').toUpperCase()}
                        </span>
                      </div>
                    </div>
                    {b.narration && <div className="story-narration">{b.narration}</div>}
                    {b.dmSecret && (
                      <div className="story-secret">
                        <strong>DM Secret:</strong> {b.dmSecret}
                      </div>
                    )}
                    {Boolean(b.xpReward) && (
                      <div className="small">
                        <span className="tag tag-purple">XP REWARD</span> +{b.xpReward} XP
                      </div>
                    )}
                    {monSummary && (
                      <div className="small">
                        <span className="tag tag-crimson">MONSTERS</span> {monSummary}
                      </div>
                    )}
                    {trSummary && (
                      <div className="small">
                        <span className="tag tag-gold">TREASURE</span> {trSummary}
                      </div>
                    )}
                    {(b.prompts || []).length > 0 && (
                      <div className="list-stack mt-xs" style={{ background: 'rgba(15, 23, 42, 0.55)', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(168, 85, 247, 0.35)' }}>
                        <div className="item-card-top">
                          <span className="tag tag-purple">DM QUESTIONS ({b.prompts!.length})</span>
                          <button
                            type="button"
                            className="btn btn-xs btn-outline"
                            onClick={() =>
                              setOpenFlowchartBeatIds((prev) => ({
                                ...prev,
                                [b.id]: !prev[b.id],
                              }))
                            }
                          >
                            {openFlowchartBeatIds[b.id] ? 'Hide Flowchart' : 'View Conversation Flowchart'}
                          </button>
                        </div>
                        {openFlowchartBeatIds[b.id] && (
                          <StoryFlowchartView
                            title={b.title}
                            floor={b.floor}
                            narration={b.narration}
                            prompts={b.prompts!}
                            isDm={true}
                            onOpenBeat={(targetId) => setActiveBeatDetailId(targetId)}
                            onTriggerBranch={(promptId, option) =>
                              sendAction('story_action', {
                                subAction: 'trigger_prompt_branch',
                                beatId: b.id,
                                promptId,
                                option,
                              })
                            }
                          />
                        )}
                        {b.prompts!.map((pr) => (
                          <div key={pr.id} className="item-card" style={{ padding: '6px 8px' }}>
                            <div className="item-card-top">
                              <strong className="small">
                                <span className="tag tag-cyan">{pr.target === 'all' ? 'Ask Group' : `Ask ${pr.targetName}`}</span>{' '}
                                &ldquo;{pr.question}&rdquo;
                              </strong>
                              <div className="btn-row">
                                <button
                                  type="button"
                                  className="btn btn-xs btn-gold"
                                  onClick={() => setActivePromptModal({ beatId: b.id, promptId: pr.id })}
                                >
                                  {pr.target === 'all' ? 'Open Poll Modal' : 'View Modal'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-xs btn-danger-outline"
                                  onClick={() =>
                                    sendAction('story_action', {
                                      subAction: 'remove_beat_prompt',
                                      beatId: b.id,
                                      promptId: pr.id,
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                            {(pr.options || []).length > 0 && (
                              <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                                {pr.options!.map((opt, oIdx) => (
                                  <span key={`${opt}-${oIdx}`} className="tag tag-gold">
                                    Option {oIdx + 1}: {opt}
                                  </span>
                                ))}
                              </div>
                            )}
                            {pr.triggeredScenario && (
                              <div
                                className="small mt-xs"
                                style={{
                                  padding: '6px 8px',
                                  borderRadius: '6px',
                                  background: 'rgba(6, 78, 59, 0.35)',
                                  border: '1px solid #10b981',
                                  color: '#ecfdf5',
                                }}
                              >
                                <div>
                                  <span className="tag tag-green">IF &ldquo;{pr.triggeredOption}&rdquo; TRIGGERED</span>{' '}
                                  {pr.triggeredScenario}
                                </div>
                                {(pr.triggeredStatCheckResults || []).map((r) => (
                                  <div key={`${r.characterId}-${r.statKey}`} className="small mt-xs" style={{ color: r.passed ? '#6ee7b7' : '#fca5a5' }}>
                                    • <b>{r.characterName}</b> {r.statKey} Check: {r.total} vs DC {r.dc} [{r.passed ? `PASS: ${r.rewardSummary}` : 'FAIL'}]
                                  </div>
                                ))}
                                {pr.triggeredRewardSummary && (
                                  <div className="small mt-xs" style={{ color: '#fbbf24' }}>
                                    • <b>Reward:</b> {pr.triggeredRewardSummary}
                                  </div>
                                )}
                                {pr.spawnedCombatBeatId && (
                                  <div className="mt-xs">
                                    <button
                                      type="button"
                                      className="btn btn-xs btn-crimson"
                                      onClick={() => setActiveBeatDetailId(pr.spawnedCombatBeatId!)}
                                    >
                                      Go to Generated Combat Beat ({pr.spawnedCombatBeatTitle || 'Combat'}) &rarr;
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                            {(pr.answers || []).length > 0 ? (
                              <div className="list-stack mt-xs">
                                {pr.answers.map((ans) => (
                                  <div key={ans.id} className="small" style={{ color: '#e2e8f0', paddingLeft: '6px', borderLeft: '2px solid #38bdf8' }}>
                                    <b style={{ color: '#38bdf8' }}>{ans.characterName}:</b> &ldquo;{ans.answer}&rdquo;
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="muted small mt-xs">Waiting for response from {pr.target === 'all' ? 'the group' : pr.targetName}...</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <details className="sub-details mt-xs">
                      <summary>+ Ask Players a Question on This Beat</summary>
                      <div className="stack-form mt-xs">
                        <div className="grid-2">
                          <label>
                            <span>Who to Ask</span>
                            <select
                              value={liveAskInputs[b.id]?.target || 'all'}
                              onChange={(e) =>
                                setLiveAskInputs((prev) => ({
                                  ...prev,
                                  [b.id]: {
                                    question: prev[b.id]?.question || '',
                                    target: e.target.value,
                                    optionsText: prev[b.id]?.optionsText || '',
                                  },
                                }))
                              }
                            >
                              <option value="all">Ask the Group (All Players)</option>
                              {chars.map((c) => (
                                <option key={c.id} value={c.id}>Ask {c.name}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Answer Options (Comma-separated, optional)</span>
                            <input
                              type="text"
                              placeholder="e.g. Open the gate, Inspect runes, Fall back"
                              value={liveAskInputs[b.id]?.optionsText || ''}
                              onChange={(e) =>
                                setLiveAskInputs((prev) => ({
                                  ...prev,
                                  [b.id]: {
                                    question: prev[b.id]?.question || '',
                                    target: prev[b.id]?.target || 'all',
                                    optionsText: e.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                        </div>
                        <div className="btn-row" style={{ gap: '6px', alignItems: 'flex-end' }}>
                          <label style={{ flex: 1 }}>
                            <span>Question for Player(s)</span>
                            <input
                              type="text"
                              placeholder="e.g. What do you do when the guardian speaks?"
                              value={liveAskInputs[b.id]?.question || ''}
                              onChange={(e) =>
                                setLiveAskInputs((prev) => ({
                                  ...prev,
                                  [b.id]: {
                                    question: e.target.value,
                                    target: prev[b.id]?.target || 'all',
                                    optionsText: prev[b.id]?.optionsText || '',
                                  },
                                }))
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="btn btn-xs btn-cyan"
                            onClick={async () => {
                              const q = (liveAskInputs[b.id]?.question || '').trim();
                              const t = liveAskInputs[b.id]?.target || 'all';
                              const opts = (liveAskInputs[b.id]?.optionsText || '')
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean);
                              if (!q) {
                                pushLocalToast({ title: 'QUESTION NEEDED', message: 'Type a question to ask.', category: 'warning' });
                                return;
                              }
                              const res = await sendAction<{ beat?: { id: string; prompts?: Array<{ id: string }> } }>('story_action', {
                                subAction: 'ask_beat_prompt',
                                beatId: b.id,
                                question: q,
                                target: t,
                                options: opts,
                              });
                              setLiveAskInputs((prev) => ({ ...prev, [b.id]: { question: '', target: t, optionsText: '' } }));
                              const latestPrompt = res?.beat?.prompts?.[res.beat.prompts.length - 1];
                              if (latestPrompt) {
                                setActivePromptModal({ beatId: b.id, promptId: latestPrompt.id });
                              }
                            }}
                          >
                            Ask &amp; Open Poll
                          </button>
                        </div>
                      </div>
                    </details>
                    <div className="btn-row mt-xs">
                      <button type="button" className="btn btn-xs btn-gold" onClick={() => setActiveBeatDetailId(b.id)}>
                        View Beat
                      </button>
                      {b.beatType !== 'narration' && (
                        <button type="button" className="btn btn-xs btn-outline" onClick={() => setActiveBeatMapId(b.id)}>
                          View Map ({b.arena?.cols || 20}×{b.arena?.rows || 20})
                        </button>
                      )}
                      <button
                        type="button"
                        className={`btn btn-xs ${b.presented ? 'btn-outline' : 'btn-cyan'}`}
                        onClick={() =>
                          sendAction('story_action', {
                            subAction: b.presented ? 'hide_beat' : 'present_beat',
                            beatId: b.id,
                          })
                        }
                      >
                        {b.presented ? 'Hide from Players' : 'Present to Players'}
                      </button>
                      {Boolean(b.xpReward) && (
                        <button
                          type="button"
                          className="btn btn-xs btn-purple"
                          onClick={() =>
                            sendAction('story_action', {
                              subAction: 'award_beat_xp',
                              beatId: b.id,
                              characterId: lootTarget || 'all',
                            })
                          }
                        >
                          Award XP (+{b.xpReward})
                        </button>
                      )}
                      {(b.encounters || []).length > 0 && (
                        <button
                          type="button"
                          className={`btn btn-xs ${unspawnedCount > 0 ? 'btn-crimson' : 'btn-outline'}`}
                          disabled={unspawnedCount === 0}
                          onClick={async () => {
                            const res = await sendAction<{ spawned?: unknown[] }>('story_action', {
                              subAction: 'spawn_beat_monsters',
                              beatId: b.id,
                            });
                            if (!res) return;
                            pushLocalToast({
                              title: 'ENCOUNTER SPAWNED',
                              message: `Spawned ${res?.spawned?.length || 0} monster(s) from Story Beat.`,
                              category: 'combat',
                            });
                          }}
                        >
                          {unspawnedCount > 0 ? 'Spawn Monsters' : 'Monsters Spawned'}
                        </button>
                      )}
                      {(b.treasures || []).length > 0 && (
                        <button
                          type="button"
                          className="btn btn-xs btn-gold"
                          onClick={() =>
                            sendAction('story_action', {
                              subAction: 'award_beat_treasure',
                              beatId: b.id,
                              characterId: lootTarget || 'all',
                            })
                          }
                        >
                          Award Treasure
                        </button>
                      )}
                      {b.status !== 'resolved' && (
                        <button
                          type="button"
                          className="btn btn-xs btn-outline"
                          onClick={() =>
                            sendAction('story_action', { subAction: 'set_status', beatId: b.id, status: 'resolved' })
                          }
                        >
                          Resolve
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-xs btn-danger-outline"
                        onClick={() => sendAction('story_action', { subAction: 'delete_beat', beatId: b.id })}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="muted small">No story beats yet. Create one on the right!</div>
            )}
          </div>
        </div>
      </div>

      <div className="col stack">
        <div className="panel card-glow-gold">
          <div className="panel-header">
            <h3>+ New Story Beat</h3>
            <div className="btn-row">
              <button type="button" className="btn btn-xs btn-gold" onClick={handleAutoGenerateNarrationBeat}>
                Auto-Generate Narration ({narFloor}F Theme)
              </button>
              <span className="tag tag-purple">NARRATION &amp; Q&amp;A</span>
            </div>
          </div>
          <form id="dm-add-narration-beat-form" className="stack-form" onSubmit={handleCreateNarrationBeat}>
            <div className="grid-3">
              <label>
                <span>Story Beat Title</span>
                <input
                  type="text"
                  placeholder="e.g. 1F • Whispers at the Gate"
                  required
                  value={narTitle}
                  onChange={(e) => setNarTitle(e.target.value)}
                />
              </label>
              <label>
                <span>Unlocked Tower Floor</span>
                <select value={narFloor} onChange={(e) => setNarFloor(Number(e.target.value || 1))}>
                  {unlockedFloors.length > 0 ? (
                    unlockedFloors.map((fl) => (
                      <option key={fl.number} value={fl.number}>
                        {fl.number}F • {getFloorThemeLabel(fl.theme)}
                      </option>
                    ))
                  ) : (
                    <option value={1}>1F • Forest (Gate of Trials)</option>
                  )}
                </select>
              </label>
              <label>
                <span>XP Reward</span>
                <input
                  type="number"
                  min={0}
                  value={narXpReward}
                  onChange={(e) => setNarXpReward(Number(e.target.value || 0))}
                />
              </label>
            </div>

            <label>
              <span>DM Narration (No Combat — Read &amp; Presented to Players)</span>
              <textarea
                rows={3}
                placeholder="Describe the scene, lore, or dialogue unfolding before the climbers..."
                value={narText}
                onChange={(e) => setNarText(e.target.value)}
              />
            </label>

            <label>
              <span>DM Secret Note (DM Eyes Only)</span>
              <input
                type="text"
                placeholder="Hidden truth, DC clue, or consequence of their answer..."
                value={narSecret}
                onChange={(e) => setNarSecret(e.target.value)}
              />
            </label>

            <div className="panel" style={{ padding: '10px 12px', background: 'rgba(15, 23, 42, 0.55)', border: '1px solid rgba(168, 85, 247, 0.4)' }}>
              <div className="panel-header" style={{ marginBottom: '6px' }}>
                <h4 style={{ margin: 0 }}>Ask Players a Question</h4>
                <span className="tag tag-cyan">PLAYER PROMPT</span>
              </div>

              {narStagedPrompts.length > 0 && (
                <div className="list-stack mb-xs">
                  {narStagedPrompts.map((p, idx) => (
                    <div key={`${p.question}-${idx}`} className="item-card">
                      <div className="item-card-top">
                        <strong>
                          <span className="tag tag-cyan">{p.target === 'all' ? 'Ask Group' : `Ask ${p.targetName}`}</span>{' '}
                          &ldquo;{p.question}&rdquo;
                        </strong>
                        <button
                          type="button"
                          className="btn btn-xs btn-danger-outline"
                          onClick={() => setNarStagedPrompts((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </button>
                      </div>
                      {(p.options || []).length > 0 && (
                        <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                          {p.options!.map((opt, oIdx) => (
                            <span key={`${opt}-${oIdx}`} className="tag tag-gold">
                              Option {oIdx + 1}: {opt}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid-2">
                <label>
                  <span>Choose Who to Ask</span>
                  <select value={narTarget} onChange={(e) => setNarTarget(e.target.value)}>
                    <option value="all">Ask the Group (All Players)</option>
                    {chars.map((c) => (
                      <option key={c.id} value={c.id}>
                        Ask {c.name} (Lv {c.level})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Question / Decision Prompt</span>
                  <input
                    type="text"
                    placeholder="e.g. Do you drink from the glowing chalice or inspect the runes?"
                    value={narQuestion}
                    onChange={(e) => setNarQuestion(e.target.value)}
                  />
                </label>
              </div>

              <div className="stack-form mt-xs">
                <label>
                  <span>Answer Options for Poll / Choice (Optional — players can pick an option or type their own)</span>
                  <div className="btn-row" style={{ gap: '6px' }}>
                    <input
                      type="text"
                      style={{ flex: 1 }}
                      placeholder="e.g. Drink from the glowing chalice"
                      value={narOptionDraft}
                      onChange={(e) => setNarOptionDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-xs btn-outline"
                      onClick={() => {
                        const clean = narOptionDraft.trim();
                        if (!clean) return;
                        setNarOptions((prev) => [...prev, clean]);
                        setNarOptionDraft('');
                      }}
                    >
                      + Add Option
                    </button>
                  </div>
                </label>

                {narOptions.length > 0 && (
                  <div className="stack-form mt-xs">
                    <div className="btn-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                      {narOptions.map((opt, oIdx) => (
                        <span key={`${opt}-${oIdx}`} className="tag tag-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          Option {oIdx + 1}: {opt}
                          <button
                            type="button"
                            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                            onClick={() => setNarOptions((prev) => prev.filter((_, i) => i !== oIdx))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>

                    <div
                      className="panel"
                      style={{
                        padding: '10px 12px',
                        background: 'rgba(2, 6, 23, 0.72)',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                      }}
                    >
                      <div className="item-card-top" style={{ marginBottom: '8px' }}>
                        <strong>Conditional Scenarios (IF Player/Group Answers Option &rarr; THEN Scenario)</strong>
                        <span className="tag tag-purple">IF / THEN BRANCHES</span>
                      </div>

                      <div className="list-stack">
                        {narOptions.map((opt, oIdx) => {
                          const branchVal: DraftBranchConfig = {
                            ...DEFAULT_DRAFT_BRANCH,
                            ...(narBranches[opt] || {}),
                          };
                          const updateBranch = (patch: Partial<DraftBranchConfig>) =>
                            setNarBranches((prev) => ({
                              ...prev,
                              [opt]: {
                                ...DEFAULT_DRAFT_BRANCH,
                                ...(prev[opt] || {}),
                                ...patch,
                              },
                            }));

                          return (
                            <div
                              key={`branch-${opt}-${oIdx}`}
                              className="item-card"
                              style={{ borderColor: 'rgba(168, 85, 247, 0.45)', padding: '8px 10px' }}
                            >
                              <div className="small" style={{ marginBottom: '6px', color: '#fbbf24', fontWeight: 700 }}>
                                IF Players Answer Option {oIdx + 1}: &ldquo;{opt}&rdquo; &rarr; THEN:
                              </div>
                              <label className="stack" style={{ gap: '4px' }}>
                                <span className="small muted">Scenario Outcome / Narration Revealed</span>
                                <textarea
                                  rows={2}
                                  placeholder={`What happens if they choose "${opt}"?`}
                                  value={branchVal.scenario}
                                  onChange={(e) => updateBranch({ scenario: e.target.value })}
                                />
                              </label>

                              {/* Stat Check relative to Floor Level */}
                              <div className="grid-2 mt-xs">
                                <label>
                                  <span className="small muted">Stat Check (Triggers +{25 * narFloor} XP &amp; +{20 * narFloor}G on {narFloor}F)</span>
                                  <select
                                    value={branchVal.statCheckStat}
                                    onChange={(e) =>
                                      updateBranch({
                                        statCheckStat: e.target.value,
                                        statCheckDc: 11 + Math.floor(narFloor * 1.2),
                                      })
                                    }
                                  >
                                    <option value="">No Stat Check</option>
                                    <option value="STR">STR (Strength Check)</option>
                                    <option value="AGI">AGI (Agility Check)</option>
                                    <option value="VIT">VIT (Vitality Check)</option>
                                    <option value="INT">INT (Intelligence Check)</option>
                                    <option value="PER">PER (Perception Check)</option>
                                    <option value="LUCK">LUCK (Luck Check)</option>
                                  </select>
                                </label>
                                {branchVal.statCheckStat ? (
                                  <label>
                                    <span className="small muted">Difficulty Class (DC • Floor Bonus +{Math.floor(narFloor / 2)})</span>
                                    <input
                                      type="number"
                                      min={5}
                                      max={40}
                                      value={branchVal.statCheckDc}
                                      onChange={(e) => updateBranch({ statCheckDc: Math.max(5, Number(e.target.value || 12)) })}
                                    />
                                  </label>
                                ) : (
                                  <label>
                                    <span className="small muted">DM Note / Consequence (opt.)</span>
                                    <input
                                      type="text"
                                      placeholder="e.g. Guardian respects their resolve"
                                      value={branchVal.dmNote}
                                      onChange={(e) => updateBranch({ dmNote: e.target.value })}
                                    />
                                  </label>
                                )}
                              </div>

                              {/* Scenario Treasure or Treasure Chest Reward */}
                              <div className="grid-2 mt-xs">
                                <label>
                                  <span className="small muted">Grant Scenario Treasure or Chest</span>
                                  <select
                                    value={branchVal.rewardType}
                                    onChange={(e) => {
                                      const rt = e.target.value as 'none' | 'treasure' | 'chest';
                                      if (rt === 'chest') {
                                        const def = getChestDefaultsForFloor(branchVal.rewardChestTier, narFloor, state?.chestCatalog);
                                        updateBranch({ rewardType: rt, rewardGold: def.gold, rewardManaStones: def.manaStones });
                                      } else {
                                        updateBranch({ rewardType: rt });
                                      }
                                    }}
                                  >
                                    <option value="none">No Treasure / Chest</option>
                                    <option value="treasure">Give Treasure / Equipment ({narFloor}F Scaled)</option>
                                    <option value="chest">Give Treasure Chest ({narFloor}F Scaled)</option>
                                  </select>
                                </label>

                                {branchVal.rewardType === 'treasure' && (
                                  <label>
                                    <span className="small muted">Select from Treasures Catalog</span>
                                    <select
                                      value={branchVal.rewardTreasureId}
                                      onChange={(e) => {
                                        const tr = (state?.treasureCatalog || []).find((t) => t.id === e.target.value);
                                        if (tr) {
                                          const sc = scaleTreasureForFloor(tr, narFloor);
                                          updateBranch({
                                            rewardTreasureId: tr.id,
                                            rewardItemName: sc.name,
                                            rewardItemCategory: sc.category,
                                            rewardGold: sc.scaledGold,
                                            rewardManaStones: sc.scaledManaStones,
                                          });
                                        } else {
                                          updateBranch({ rewardTreasureId: '' });
                                        }
                                      }}
                                    >
                                      <option value="">-- Custom Scenario Treasure --</option>
                                      {(state?.treasureCatalog || []).map((t) => (
                                        <option key={t.id} value={t.id}>
                                          [{t.tier || 'Common'} • {t.category}] {t.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )}

                                {branchVal.rewardType === 'chest' && (
                                  <label>
                                    <span className="small muted">Select Treasure Chest Tier</span>
                                    <select
                                      value={branchVal.rewardChestTier}
                                      onChange={(e) => {
                                        const tier = e.target.value as ChestTier;
                                        const def = getChestDefaultsForFloor(tier, narFloor, state?.chestCatalog);
                                        updateBranch({
                                          rewardChestTier: tier,
                                          rewardGold: def.gold,
                                          rewardManaStones: def.manaStones,
                                        });
                                      }}
                                    >
                                      {CHEST_TIERS.map((ct) => {
                                        const def = getChestDefaultsForFloor(ct, narFloor, state?.chestCatalog);
                                        return (
                                          <option key={ct} value={ct}>
                                            {ct} Chest ({def.gold}G • {def.manaStones} Stones)
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </label>
                                )}
                              </div>

                              {branchVal.rewardType === 'treasure' && (
                                <div className="grid-3 mt-xs">
                                  <label>
                                    <span className="small muted">Treasure Name</span>
                                    <input
                                      type="text"
                                      placeholder="e.g. Rune Key"
                                      value={branchVal.rewardItemName}
                                      onChange={(e) => updateBranch({ rewardItemName: e.target.value })}
                                    />
                                  </label>
                                  <label>
                                    <span className="small muted">Gold ({narFloor}F)</span>
                                    <input
                                      type="number"
                                      min={0}
                                      value={branchVal.rewardGold}
                                      onChange={(e) => updateBranch({ rewardGold: Math.max(0, Number(e.target.value || 0)) })}
                                    />
                                  </label>
                                  <label>
                                    <span className="small muted">Mana Stones</span>
                                    <input
                                      type="number"
                                      min={0}
                                      value={branchVal.rewardManaStones}
                                      onChange={(e) => updateBranch({ rewardManaStones: Math.max(0, Number(e.target.value || 0)) })}
                                    />
                                  </label>
                                </div>
                              )}

                              {/* Ends in a Combat Story Beat (Auto-generates combat beat & resolves current beat) */}
                              <div className="mt-xs" style={{ paddingTop: '6px', borderTop: '1px dashed rgba(148, 163, 184, 0.25)' }}>
                                <label className="checkbox-row">
                                  <input
                                    type="checkbox"
                                    checked={branchVal.endsInCombat}
                                    onChange={(e) => updateBranch({ endsInCombat: e.target.checked })}
                                  />
                                  <span style={{ color: branchVal.endsInCombat ? '#f87171' : '#cbd5e1', fontWeight: 600 }}>
                                    Scenario Ends in Combat (Auto-Generates {narFloor}F Combat Story Beat &amp; Resolves This Beat)
                                  </span>
                                </label>

                                {branchVal.endsInCombat ? (
                                  <div className="grid-2 mt-xs">
                                    <label>
                                      <span className="small muted">Combat Monster Preset ({narFloor}F Scaled)</span>
                                      <select
                                        value={branchVal.combatMonsterPresetId}
                                        onChange={(e) => updateBranch({ combatMonsterPresetId: e.target.value })}
                                      >
                                        <option value="">-- Auto-Pick Floor Monster --</option>
                                        {(state?.bestiary || []).map((m) => (
                                          <option key={m.id} value={m.id}>
                                            [{m.category || 'Monster'}] {m.name} (Base {m.maxHp} HP)
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label>
                                      <span className="small muted">Monster Quantity</span>
                                      <input
                                        type="number"
                                        min={1}
                                        max={12}
                                        value={branchVal.combatMonsterQty}
                                        onChange={(e) =>
                                          updateBranch({ combatMonsterQty: Math.max(1, Math.min(12, Number(e.target.value || 2))) })
                                        }
                                      />
                                    </label>
                                  </div>
                                ) : (
                                  <label className="mt-xs">
                                    <span className="small muted">Follow-up Question on This Branch (opt.)</span>
                                    <input
                                      type="text"
                                      placeholder="e.g. Who enters the hidden door first?"
                                      value={branchVal.nextQuestion}
                                      onChange={(e) => updateBranch({ nextQuestion: e.target.value })}
                                    />
                                  </label>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <div className="btn-row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <button
                    type="button"
                    className={`btn btn-xs ${narShowFlowchart ? 'btn-gold' : 'btn-outline'}`}
                    onClick={() => setNarShowFlowchart((v) => !v)}
                  >
                    {narShowFlowchart ? 'Hide Conversation Flowchart' : 'Generate Conversation Flowchart'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-cyan"
                    onClick={() => {
                      if (!narQuestion.trim()) {
                        pushLocalToast({ title: 'QUESTION NEEDED', message: 'Enter a question for the player(s).', category: 'warning' });
                        return;
                      }
                      const targetChar = narTarget !== 'all' ? state?.characters?.[narTarget] : undefined;
                      const pendingOpts = [...narOptions];
                      if (narOptionDraft.trim()) pendingOpts.push(narOptionDraft.trim());
                      const branches = buildCurrentNarBranches(pendingOpts);
                      setNarStagedPrompts((prev) => [
                        ...prev,
                        {
                          question: narQuestion.trim(),
                          target: narTarget,
                          targetName: narTarget === 'all' ? 'All Players (Group)' : (targetChar?.name || 'Player'),
                          ...(pendingOpts.length > 0 ? { options: pendingOpts } : {}),
                          ...(branches.length > 0 ? { branches } : {}),
                        },
                      ]);
                      setNarQuestion('');
                      setNarOptionDraft('');
                      setNarOptions([]);
                      setNarBranches({});
                    }}
                  >
                    + Stage Question &amp; Scenarios
                  </button>
                </div>

                {narShowFlowchart && (narQuestion.trim() || narStagedPrompts.length > 0) && (
                  <StoryFlowchartView
                    title={narTitle.trim() || `${narFloor}F Story Beat`}
                    floor={narFloor}
                    narration={narText.trim()}
                    isDm={true}
                    prompts={[
                      ...narStagedPrompts,
                      ...(narQuestion.trim()
                        ? [
                            {
                              question: narQuestion.trim(),
                              target: narTarget,
                              targetName:
                                narTarget === 'all'
                                  ? 'All Players (Group)'
                                  : state?.characters?.[narTarget]?.name || 'Player',
                              options: narOptions,
                              branches: buildCurrentNarBranches(narOptions),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </div>
            </div>

            <label className="checkbox-row">
              <input type="checkbox" checked={narPresentNow} onChange={(e) => setNarPresentNow(e.target.checked)} />
              <span>Present immediately to Players</span>
            </label>
            <button type="submit" className="btn btn-gold btn-lg btn-glow-gold">
              Add Story Beat
            </button>
          </form>
        </div>

        <div className="panel card-glow-cyan">
          <div className="panel-header">
            <h3>+ New Combat Story Beat</h3>
            <div className="btn-row">
              <button type="button" id="btn-auto-generate-beat" className="btn btn-xs btn-cyan" onClick={handleAutoGenerateBeat}>
                Auto-Generate Beat ({floor}F Theme)
              </button>
              <span className="tag tag-cyan">ORCHESTRATOR</span>
            </div>
          </div>
          <form id="dm-add-beat-form" className="stack-form" onSubmit={handleCreateBeat}>
            <div className="grid-2">
              <label><span>Beat Title</span><input type="text" placeholder="e.g. 3F • Shinsu Bridge" required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label>
                <span>Unlocked Tower Floor</span>
                <select
                  id="dm-beat-floor-select"
                  value={floor}
                  onChange={(e) => {
                    const nextFloor = Number(e.target.value || 1);
                    setFloor(nextFloor);
                    applyMonsterFloorScale(nextFloor);
                    applyChestTierScale(draftChestTier, nextFloor);
                    const flObj = unlockedFloors.find((f) => Number(f.number) === nextFloor);
                    const themeId = flObj?.theme || 'forest';
                    setDraftBiome(themeId);
                    handleGenerateDraftTerrain(themeId, draftPrompt.trim());
                  }}
                >
                  {unlockedFloors.length > 0 ? (
                    unlockedFloors.map((fl) => (
                      <option key={fl.number} value={fl.number}>
                        {fl.number}F • {getFloorThemeLabel(fl.theme)}
                      </option>
                    ))
                  ) : (
                    <option value={1}>1F • Forest (Gate of Trials)</option>
                  )}
                </select>
              </label>
            </div>
            <div className="grid-3">
              <label><span>XP Reward</span><input type="number" min={0} value={xpReward} onChange={(e) => setXpReward(Number(e.target.value || 0))} /></label>
              <label><span>Max Combat Rounds</span><input type="number" min={1} max={100} value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value || 20))} /></label>
              <label>
                <span>Arena Grid Size</span>
                <select value={gridSize} onChange={(e) => setGridSize(Number(e.target.value || 20))}>
                  <option value={20}>20 × 20 Spaces (Default)</option>
                  <option value={25}>25 × 25 Spaces</option>
                  <option value={30}>30 × 30 Spaces</option>
                  <option value={40}>40 × 40 Spaces</option>
                  <option value={50}>50 × 50 Spaces</option>
                </select>
              </label>
            </div>
            <label><span>Player Narration (Shown when presented)</span><textarea rows={3} placeholder="Scene description read/pushed to players..." value={narration} onChange={(e) => setNarration(e.target.value)} /></label>
            <label><span>DM Secret Note (DM Eyes Only)</span><input type="text" placeholder="Hidden trap DC, twist, or condition..." value={dmSecret} onChange={(e) => setDmSecret(e.target.value)} /></label>

            <details className="sub-details">
              <summary>+ Attach Monster Encounters (Optional)</summary>
              <div className="stack-form mt-sm">
                <div className="list-stack">
                  {stagedMonsters.map((m, i) => (
                    <div key={`${m.name}-${i}`} className="item-card">
                      <div className="item-card-top">
                        <strong>{m.name} {m.floor ? <span className="tag tag-crimson">{m.floor}F</span> : null}</strong>
                        <span>HP {m.maxHp} • AC {m.ac} • DR {m.dr} • {m.damageFormula}</span>
                        <button type="button" className="btn btn-xs btn-danger-outline" onClick={() => setStagedMonsters((prev) => prev.filter((_, idx) => idx !== i))}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="btn-row" style={{ alignItems: 'flex-end', gap: '8px' }}>
                  <label style={{ flex: 1 }}>
                    <span>Bestiary Preset (Manhwa &amp; D&amp;D)</span>
                    <select
                      value={selectedPresetId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedPresetId(id);
                        const b = (state.bestiary || []).find((x) => x.id === id);
                        if (b) {
                          setMonName(b.name);
                          applyMonsterFloorScale(monFloor, id);
                        }
                      }}
                    >
                      <option value="">-- Custom Monster --</option>
                      {(state.bestiary || []).map((b) => (
                        <option key={b.id} value={b.id}>
                          [{b.category || 'Custom'}] {b.name} (1F: {b.maxHp} HP / AC {b.ac})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    id="btn-auto-generate-monsters"
                    className="btn btn-sm btn-cyan"
                    onClick={handleAutoGenerateMonsters}
                  >
                    Auto-Generate Monster(s)
                  </button>
                </div>
                <div className="grid-3">
                  <label><span>Monster Name</span><input type="text" placeholder="e.g. Goblin Gatekeeper" value={monName} onChange={(e) => setMonName(e.target.value)} /></label>
                  <label><span>Quantity</span><input type="number" min={1} max={20} value={monQty} onChange={(e) => setMonQty(Math.max(1, Math.min(20, Number(e.target.value || 1))))} /></label>
                  <label><span>Floor Level (Scales Stats)</span><input type="number" min={1} max={100} value={monFloor} onChange={(e) => applyMonsterFloorScale(Number(e.target.value || 1))} /></label>
                </div>
                <div className="grid-2">
                  <label><span>Attack Formula</span><input type="text" value={monAtk} onChange={(e) => setMonAtk(e.target.value)} /></label>
                  <label><span>Damage Dice</span><input type="text" value={monDmg} onChange={(e) => setMonDmg(e.target.value)} /></label>
                </div>
                <div className="grid-3">
                  <label><span>Max HP</span><input type="number" min={1} value={monHp} onChange={(e) => setMonHp(Number(e.target.value || 1))} /></label>
                  <label><span>Armor Class (AC)</span><input type="number" value={monAc} onChange={(e) => setMonAc(Number(e.target.value || 10))} /></label>
                  <label><span>Damage Red. (DR)</span><input type="number" value={monDr} onChange={(e) => setMonDr(Number(e.target.value || 0))} /></label>
                </div>
                <div className="grid-2">
                  <label><span>Start X (Col, optional)</span><input type="number" min={1} max={100} placeholder="Auto" value={monX} onChange={(e) => setMonX(e.target.value)} /></label>
                  <label><span>Start Y (Row, optional)</span><input type="number" min={1} max={100} placeholder="Auto" value={monY} onChange={(e) => setMonY(e.target.value)} /></label>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-crimson"
                  onClick={() => {
                    if (!monName.trim()) {
                      pushLocalToast({ title: 'MONSTER NAME NEEDED', message: 'Enter a monster name before adding.', category: 'warning' });
                      return;
                    }
                    setStagedMonsters((prev) => [...prev, ...buildMonsterBatch()]);
                    setMonName('');
                    setMonQty(1);
                    setMonX('');
                    setMonY('');
                  }}
                >
                  + Add Monster to Beat
                </button>
              </div>
            </details>

            <details className="sub-details">
              <summary>+ Attach NPCs (Optional)</summary>
              <div className="stack-form mt-sm">
                <div className="btn-row" style={{ alignItems: 'flex-end', gap: '8px' }}>
                  <label style={{ flex: 1 }}>
                    <span>NPC Roster Preset (Manhwa &amp; D&amp;D)</span>
                    <select
                      value=""
                      onChange={(e) => {
                        const found = (state.npcRoster || []).find((n) => n.id === e.target.value);
                        if (found) {
                          setNpcName(found.name);
                          setNpcRole(found.role);
                          setNpcDialogue(found.dialogue);
                        }
                      }}
                    >
                      <option value="">-- Select from NPC Roster --</option>
                      {(state.npcRoster || []).map((n) => (
                        <option key={n.id} value={n.id}>
                          [{n.origin || 'Custom'} • {n.firstAppearedFloor}F • Lv {n.level}] {n.name} ({n.role})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm btn-cyan"
                    onClick={() => {
                      const roster = state.npcRoster || [];
                      if (roster.length === 0) return;
                      const pick = roster[Math.floor(Math.random() * roster.length)];
                      setStagedNpcs((prev) => [
                        ...prev,
                        {
                          name: pick.name,
                          npcRole: pick.role,
                          startX: null,
                          startY: null,
                          dialogue: pick.dialogue,
                          rewardType: 'none',
                          rewardItemName: '',
                          rewardXp: 50,
                        },
                      ]);
                      pushLocalToast({
                        title: 'NPC ATTACHED',
                        message: `Added ${pick.name} (Lv ${pick.level}, First Seen: ${pick.firstAppearedFloor}F) to beat.`,
                        category: 'info',
                      });
                    }}
                  >
                    Auto-Attach NPC
                  </button>
                </div>
                <div className="list-stack">
                  {stagedNpcs.map((n, i) => (
                    <div key={`${n.name}-${i}`} className="item-card">
                      <div className="item-card-top">
                        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <TokenIconSvg type="npc" name={n.name} iconId={n.iconId} npcRole={n.npcRole} size={20} />
                          {n.name} <span className="tag tag-green">{n.npcRole}</span>
                        </strong>
                        <span>{n.startX && n.startY ? `Start (${n.startX}, ${n.startY})` : 'Auto Start'}</span>
                        <button type="button" className="btn btn-xs btn-danger-outline" onClick={() => setStagedNpcs((prev) => prev.filter((_, idx) => idx !== i))}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid-3">
                  <label><span>NPC Name</span><input type="text" placeholder="e.g. Tower Merchant" value={npcName} onChange={(e) => setNpcName(e.target.value)} /></label>
                  <label><span>Role / Title</span><input type="text" placeholder="e.g. Merchant, Ally, Guide" value={npcRole} onChange={(e) => setNpcRole(e.target.value)} /></label>
                  <label>
                    <span>NPC Icon (Optional)</span>
                    <select value={npcIconId} onChange={(e) => setNpcIconId(e.target.value as NpcIconId | '')}>
                      <option value="">Auto-Detect</option>
                      {NPC_ICON_IDS.map((id) => (
                        <option key={id} value={id}>
                          {TOKEN_ICON_META[id].label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid-2">
                  <label><span>Start X (Col, optional)</span><input type="number" min={1} max={100} placeholder="Auto" value={npcX} onChange={(e) => setNpcX(e.target.value)} /></label>
                  <label><span>Start Y (Row, optional)</span><input type="number" min={1} max={100} placeholder="Auto" value={npcY} onChange={(e) => setNpcY(e.target.value)} /></label>
                </div>
                <label><span>Dialogue (When Talked To)</span><input type="text" placeholder="e.g. Take this skill book for the 3rd Floor!" value={npcDialogue} onChange={(e) => setNpcDialogue(e.target.value)} /></label>
                <div className="grid-3">
                  <label>
                    <span>Talk Reward</span>
                    <select value={npcRewardType} onChange={(e) => setNpcRewardType(e.target.value)}>
                      <option value="none">Dialogue Only</option>
                      <option value="item">Give Item</option>
                      <option value="skill_book">Give Skill Book</option>
                      <option value="xp">Grant XP</option>
                    </select>
                  </label>
                  <label><span>Item / Skill Book Name</span><input type="text" placeholder="e.g. Shadow Step" value={npcRewardName} onChange={(e) => setNpcRewardName(e.target.value)} /></label>
                  <label><span>XP Amount</span><input type="number" min={0} value={npcRewardXp} onChange={(e) => setNpcRewardXp(Number(e.target.value || 0))} /></label>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  style={{ borderColor: 'rgba(16,185,129,0.7)', color: '#34d399' }}
                  onClick={() => {
                    if (!npcName.trim()) {
                      pushLocalToast({ title: 'NPC NAME NEEDED', message: 'Enter an NPC name before adding.', category: 'warning' });
                      return;
                    }
                    setStagedNpcs((prev) => [
                      ...prev,
                      {
                        name: npcName.trim(),
                        npcRole: npcRole.trim() || 'NPC',
                        ...(npcIconId ? { iconId: npcIconId } : {}),
                        startX: npcX ? Number(npcX) : null,
                        startY: npcY ? Number(npcY) : null,
                        dialogue: npcDialogue.trim(),
                        rewardType: npcRewardType,
                        rewardItemName: npcRewardName.trim(),
                        rewardXp: npcRewardXp,
                      },
                    ]);
                    setNpcName('');
                    setNpcRole('');
                    setNpcIconId('');
                    setNpcX('');
                    setNpcY('');
                    setNpcDialogue('');
                    setNpcRewardName('');
                  }}
                >
                  + Add NPC to Beat
                </button>
              </div>
            </details>

            <details className="sub-details">
              <summary>+ Attach Treasures / Loot (Optional)</summary>
              <div className="stack-form mt-sm">
                <div className="btn-row" style={{ alignItems: 'flex-end', gap: '8px' }}>
                  <label style={{ flex: 1 }}>
                    <span>Treasure Catalog Preset ({floor}F Scaled)</span>
                    <select
                      value=""
                      onChange={(e) => {
                        const found = (state.treasureCatalog || []).find((t) => t.id === e.target.value);
                        if (found) {
                          const sc = scaleTreasureForFloor(found, floor);
                          setTrName(sc.name);
                          setTrCat(sc.category);
                          setTrGold(sc.scaledGold);
                          setTrStones(sc.scaledManaStones);
                          setTrDmg(sc.damageDice || '');
                        }
                      }}
                    >
                      <option value="">-- Select Equipment or Skill Book --</option>
                      {(state.treasureCatalog || []).map((t) => (
                        <option key={t.id} value={t.id}>
                          [{t.origin || 'Custom'} • {t.category === 'skill_book' ? 'Skill Book' : t.category} • {t.floorLevel}F] {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm btn-gold"
                    onClick={() => {
                      const cat = state.treasureCatalog || [];
                      if (cat.length === 0) return;
                      const pick = cat[Math.floor(Math.random() * cat.length)];
                      const sc = scaleTreasureForFloor(pick, floor);
                      setStagedTreasures((prev) => [
                        ...prev,
                        {
                          id: `tr-${Date.now().toString(36)}`,
                          name: sc.name,
                          category: sc.category,
                          qty: 1,
                          gold: sc.scaledGold,
                          manaStones: sc.scaledManaStones,
                          slot: sc.slot || undefined,
                          attackBonus: sc.attackBonus,
                          damageDice: sc.damageDice || '',
                          acBonus: sc.acBonus,
                          drBonus: sc.drBonus,
                          notes: sc.notes,
                        },
                      ]);
                      pushLocalToast({
                        title: 'TREASURE ATTACHED',
                        message: `Added ${sc.name} (${floor}F scaled) to beat.`,
                        category: 'loot',
                      });
                    }}
                  >
                    Auto-Attach Treasure
                  </button>
                </div>
                <div className="list-stack">
                  {stagedTreasures.map((t, i) => (
                    <div key={`${t.name}-${i}`} className="item-card">
                      <div className="item-card-top">
                        <strong>{t.name} <span className="tag tag-cyan">{t.category}</span></strong>
                        <span>{t.gold ? `${t.gold}G ` : ''}{t.manaStones ? `${t.manaStones} Stones ` : ''}{t.damageDice || ''}</span>
                        <button type="button" className="btn btn-xs btn-danger-outline" onClick={() => setStagedTreasures((prev) => prev.filter((_, idx) => idx !== i))}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid-2">
                  <label><span>Item Name</span><input type="text" placeholder="e.g. Gate Key Blade" value={trName} onChange={(e) => setTrName(e.target.value)} /></label>
                  <label>
                    <span>Category</span>
                    <select value={trCat} onChange={(e) => setTrCat(e.target.value)}>
                      <option value="relic">Relic</option>
                      <option value="weapon">Weapon</option>
                      <option value="armor">Armor</option>
                      <option value="skill_book">Skill Book</option>
                      <option value="consumable">Consumable</option>
                    </select>
                  </label>
                </div>
                <div className="grid-3">
                  <label><span>Gold</span><input type="number" min={0} value={trGold} onChange={(e) => setTrGold(Number(e.target.value || 0))} /></label>
                  <label><span>Mana Stones</span><input type="number" min={0} value={trStones} onChange={(e) => setTrStones(Number(e.target.value || 0))} /></label>
                  <label><span>Weapon Dice</span><input type="text" placeholder="e.g. 2d6" value={trDmg} onChange={(e) => setTrDmg(e.target.value)} /></label>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-cyan"
                  onClick={() => {
                    if (!trName.trim() && trGold <= 0 && trStones <= 0) {
                      pushLocalToast({ title: 'TREASURE NEEDED', message: 'Enter an item name or gold.', category: 'warning' });
                      return;
                    }
                    setStagedTreasures((prev) => [
                      ...prev,
                      { id: `tr-${Date.now().toString(36)}`, name: trName.trim() || 'Gold Cache', category: trCat, qty: 1, gold: trGold, manaStones: trStones, damageDice: trDmg.trim() },
                    ]);
                    setTrName('');
                    setTrDmg('');
                  }}
                >
                  + Add Treasure to Beat
                </button>
              </div>
            </details>

            <details className="sub-details">
              <summary>+ Attach Treasure Chests (Optional)</summary>
              <div className="stack-form mt-sm">
                <div className="btn-row" style={{ alignItems: 'flex-end', gap: '8px' }}>
                  <label style={{ flex: 1 }}>
                    <span>Chest Tier (Scales Gold &amp; Mana Stones to {floor}F)</span>
                    <select
                      value={draftChestTier}
                      onChange={(e) => applyChestTierScale(e.target.value as ChestTier, floor)}
                    >
                      {CHEST_TIERS.map((ct) => {
                        const def = getChestDefaultsForFloor(ct, floor);
                        return (
                          <option key={ct} value={ct}>
                            {ct} Chest ({floor}F: {def.gold}G • {def.manaStones} Stones)
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm btn-gold"
                    onClick={() => {
                      const def = getChestDefaultsForFloor(draftChestTier, floor);
                      const cx = Math.max(1, Math.min(gridSize - 2, Math.floor(Math.random() * (gridSize - 4)) + 2));
                      const cy = Math.max(1, Math.min(gridSize - 5, Math.floor(Math.random() * (gridSize - 6)) + 2));
                      setDraftChests((prev) => [
                        ...prev,
                        { name: def.name, tier: draftChestTier, gold: def.gold, manaStones: def.manaStones, itemName: '', x: cx, y: cy },
                      ]);
                      pushLocalToast({
                        title: 'CHEST ATTACHED',
                        message: `Placed ${def.name} at (${cx + 1}, ${cy + 1}) with ${def.gold}G & ${def.manaStones} Mana Stones.`,
                        category: 'loot',
                      });
                    }}
                  >
                    Auto-Generate Chest
                  </button>
                </div>

                <div className="list-stack">
                  {draftChests.map((c, idx) => (
                    <div key={`${c.name}-${idx}`} className="item-card">
                      <div className="item-card-top">
                        <strong>
                          {c.name} <span className="tag tag-gold">{c.tier}</span>
                        </strong>
                        <span>
                          ({c.x + 1}, {c.y + 1}) • {c.gold}G • {c.manaStones} Stones{c.itemName ? ` • ${c.itemName}` : ''}
                        </span>
                        <button
                          type="button"
                          className="btn btn-xs btn-danger-outline"
                          onClick={() => setDraftChests((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid-2">
                  <label><span>Chest Name</span><input type="text" value={chestFormName} onChange={(e) => setChestFormName(e.target.value)} /></label>
                  <label><span>Bonus Item Name (opt.)</span><input type="text" placeholder="Auto-rolls from Tier table" value={chestFormItem} onChange={(e) => setChestFormItem(e.target.value)} /></label>
                </div>
                <div className="grid-4">
                  <label><span>Gold ({floor}F)</span><input type="number" min={0} value={chestFormGold} onChange={(e) => setChestFormGold(Math.max(0, Number(e.target.value || 0)))} /></label>
                  <label><span>Mana Stones</span><input type="number" min={0} value={chestFormStones} onChange={(e) => setChestFormStones(Math.max(0, Number(e.target.value || 0)))} /></label>
                  <label><span>Col X (1-{gridSize})</span><input type="number" min={1} max={gridSize} placeholder="Auto" value={chestFormX} onChange={(e) => setChestFormX(e.target.value)} /></label>
                  <label><span>Row Y (1-{gridSize})</span><input type="number" min={1} max={gridSize} placeholder="Auto" value={chestFormY} onChange={(e) => setChestFormY(e.target.value)} /></label>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-gold"
                  onClick={() => {
                    const cx = chestFormX ? Math.max(0, Math.min(gridSize - 1, Number(chestFormX) - 1)) : Math.floor(gridSize / 2);
                    const cy = chestFormY ? Math.max(0, Math.min(gridSize - 1, Number(chestFormY) - 1)) : Math.max(1, Math.floor(gridSize / 3));
                    setDraftChests((prev) => [
                      ...prev,
                      {
                        name: chestFormName.trim() || `${draftChestTier} Chest`,
                        tier: draftChestTier,
                        gold: chestFormGold,
                        manaStones: chestFormStones,
                        itemName: chestFormItem.trim(),
                        x: cx,
                        y: cy,
                      },
                    ]);
                    setChestFormItem('');
                    setChestFormX('');
                    setChestFormY('');
                  }}
                >
                  + Add Chest to Beat
                </button>
              </div>
            </details>

            <details id="beat-map-designer-details" className="sub-details">
              <summary>+ Design Arena Map, Start Positions &amp; Treasure Chests</summary>
              <div className="stack-form mt-sm">
                <div className="grid-3">
                  <label>
                    <span>Arena Theme / Biome</span>
                    <select
                      value={draftBiome}
                      onChange={(e) => {
                        setDraftBiome(e.target.value);
                        handleGenerateDraftTerrain(e.target.value, draftPrompt.trim());
                      }}
                    >
                      {FLOOR_THEMES.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ gridColumn: 'span 2' }}>
                    <span>Cryptic Arena Description (Auto-Generate Terrain)</span>
                    <div className="btn-row" style={{ gap: '6px' }}>
                      <input type="text" placeholder="e.g. misty forest split by a winding river and ancient boulders..." style={{ flex: 1 }} value={draftPrompt} onChange={(e) => setDraftPrompt(e.target.value)} />
                      <button type="button" className="btn btn-xs btn-cyan" onClick={() => handleGenerateDraftTerrain()}>Auto-Generate Map</button>
                    </div>
                  </label>
                </div>
                <div className="demo-chips">
                  {chars.map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      className={`chip-btn ${draftTool?.kind === 'player' && draftTool.id === ch.id ? 'active' : ''}`}
                      onClick={() => setDraftTool({ kind: 'player', id: ch.id })}
                    >
                      {ch.name.split(' ')[0]}
                    </button>
                  ))}
                  {stagedMonsters.map((m, idx) => (
                    <button
                      key={`${m.name}-${idx}`}
                      type="button"
                      className={`chip-btn ${draftTool?.kind === 'monster' && draftTool.index === idx ? 'active' : ''}`}
                      style={{ borderColor: 'rgba(239,68,68,0.6)' }}
                      onClick={() => setDraftTool({ kind: 'monster', index: idx })}
                    >
                      {m.name}
                    </button>
                  ))}
                  {stagedNpcs.map((n, idx) => (
                    <button
                      key={`${n.name}-${idx}`}
                      type="button"
                      className={`chip-btn ${draftTool?.kind === 'npc' && draftTool.index === idx ? 'active' : ''}`}
                      style={{ borderColor: 'rgba(16,185,129,0.7)', color: '#34d399' }}
                      onClick={() => setDraftTool({ kind: 'npc', index: idx })}
                    >
                      {n.name}
                    </button>
                  ))}
                  <button type="button" className={`chip-btn ${draftTool?.kind === 'chest' ? 'active' : ''}`} style={{ borderColor: 'rgba(251,191,36,0.7)', color: '#fbbf24' }} onClick={() => setDraftTool({ kind: 'chest' })}>+ Chest ({draftChestTier})</button>
                  <select
                    aria-label="Draft Chest Tier"
                    value={draftChestTier}
                    onChange={(e) => {
                      setDraftChestTier(e.target.value as ChestTier);
                      setDraftTool({ kind: 'chest' });
                    }}
                    style={{ width: 'auto', minHeight: '28px', padding: '2px 8px' }}
                  >
                    {CHEST_TIERS.map((ct) => (
                      <option key={ct} value={ct}>{ct} Chest</option>
                    ))}
                  </select>
                  {VALID_TERRAIN_TYPES.map((tt) => (
                    <button
                      key={tt}
                      type="button"
                      className={`chip-btn ${draftTool?.kind === tt ? 'active' : ''}`}
                      style={{ borderColor: TERRAIN_CHIP_STYLES[tt].border, color: TERRAIN_CHIP_STYLES[tt].color }}
                      onClick={() => setDraftTool({ kind: tt })}
                    >
                      {TERRAIN_CHIP_STYLES[tt].label}
                    </button>
                  ))}
                </div>
                <div className="muted small" id="beat-draft-hint">{draftHint}</div>
                <div className="arena-scroll-wrap" style={{ maxHeight: '360px' }}>
                  <canvas
                    ref={draftCanvasRef}
                    id="beat-draft-canvas"
                    className="beat-arena-canvas"
                    width={440}
                    height={440}
                    onClick={handleDraftCanvasClick}
                    onMouseMove={(ev) => {
                      const canvas = draftCanvasRef.current;
                      if (!canvas) return;
                      const cell = getScaledCanvasCell(canvas, ev.clientX, ev.clientY, 22, getArenaCellPx(gridSize, 'draft'));
                      if (cell.x >= 0 && cell.x < gridSize && cell.y >= 0 && cell.y < gridSize) {
                        setDraftHoverCell(cell);
                      } else {
                        setDraftHoverCell(null);
                      }
                    }}
                    onMouseLeave={() => setDraftHoverCell(null)}
                  />
                </div>
              </div>
            </details>

            <label className="checkbox-row">
              <input type="checkbox" checked={presentNow} onChange={(e) => setPresentNow(e.target.checked)} />
              <span>Present immediately to Players</span>
            </label>
            <button type="submit" className="btn btn-gold btn-lg btn-glow-gold">Add Combat Story Beat</button>
          </form>
        </div>
      </div>
    </div>
  );
}
