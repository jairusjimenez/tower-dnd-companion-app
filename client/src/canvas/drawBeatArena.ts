import {
  computeActiveEffectModifiers,
  computeAttackAreaCells,
  computeCharacterMoveSpaces,
  computeMonsterAttackCells,
  computePassiveModifiers,
  computeReachableMoveCells,
  computeSegmentedBarTicks,
  inferDefaultAttackAreaForMonster,
  type AttackArea,
  type MonsterAttackArea,
  getMaxAttacksForFloor,
  getWeaponAttackInfo,
  hasObserveLineOfSight,
  type FilteredGameState,
  type SessionIdentity,
  type Spell,
  type StoryBeat,
} from '@shared/index';
import {
  drawArenaBackground,
  drawArenaTerrainLayer,
  drawChestIcon,
  drawManaStoneCrystal,
  drawTokenAvatar,
} from './drawPrimitives';

export type BeatActionMode =
  | 'move'
  | 'attack'
  | 'spell'
  | 'observe'
  | 'chest'
  | 'npc'
  | 'select'
  | 'monster_move'
  | 'monster_attack'
  | 'monster_skill'
  | string;

export interface DrawBeatArenaOptions {
  canvas: HTMLCanvasElement;
  beat: StoryBeat;
  cellPx: number;
  selectedTokenId?: string | null;
  beatActionMode?: BeatActionMode;
  previewAttackArea?: AttackArea | null;
  previewAttackAreaModifier?: number;
  previewAimCell?: { x: number; y: number } | null;
  previewSpell?: Spell | null;
  session?: SessionIdentity | null;
  state?: FilteredGameState | null;
  hideAxisLabels?: boolean;
  onPortraitLoaded?: () => void;
}

export function drawBeatArenaCanvas({
  canvas,
  beat,
  cellPx,
  selectedTokenId = null,
  beatActionMode = 'select',
  previewAttackArea = null,
  previewAttackAreaModifier = undefined,
  previewAimCell = null,
  previewSpell = null,
  session = null,
  state = null,
  hideAxisLabels = false,
  onPortraitLoaded,
}: DrawBeatArenaOptions): void {
  const arena = beat.arena || { cols: 20, rows: 20, biome: 'obsidian', terrain: [], tokens: [], chests: [] };
  const cols = arena.cols || 20;
  const rows = arena.rows || 20;
  const axisPad = hideAxisLabels ? 0 : 24;
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
  const terrainSet = new Set((arena.terrain || []).map((t) => `${t.x},${t.y}`));

  const beatHasMonsters = (arena.tokens || []).some((t) => t.type === 'monster');
  const combatList = state?.combat?.combatants || [];
  const activeComb = combatList[state?.combat?.turnIndex ?? 0];
  const arenaTokIds = new Set((arena.tokens || []).map((t) => t.id));
  const hasBeatCombatOrder = beatHasMonsters && combatList.some((c) => arenaTokIds.has(c.id));
  const isPlayerTurnOnCanvas = !hasBeatCombatOrder || (activeComb?.id === session?.characterId);

  if (
    session?.role !== 'dm'
    && session?.characterId
    && isPlayerTurnOnCanvas
    && (beatActionMode === 'move' || beatActionMode === 'attack' || beatActionMode === 'spell' || beatActionMode === 'observe')
  ) {
    const myTok = (arena.tokens || []).find((t) => t.id === session.characterId);
    const me = state?.characters?.[session.characterId];
    const meEff = computeActiveEffectModifiers(me?.activeEffects);

    if (myTok && me && !meEff.stunned && beatActionMode === 'move' && !myTok.hasMovedThisTurn) {
      const pMods = computePassiveModifiers(me);
      const r1Bonus = (state?.combat?.round ?? 1) <= 1 ? (pMods.round1MoveBonus || 0) : 0;
      const maxSpaces = computeCharacterMoveSpaces({
        agi: me.stats?.AGI ?? me.stats?.DEX ?? 10,
        floor: beat.floor || 1,
        passiveSpeedBonus: pMods.bonusSpeedSpaces,
        round1Bonus: r1Bonus,
        effectSpeedDelta: meEff.speedDelta,
      }).total;
      const monsterBlockers = (arena.tokens || [])
        .filter((t) => t.id !== myTok.id && (t.type === 'monster' || t.type === 'npc'))
        .map((t) => ({ x: t.x, y: t.y }));
      const { cells } = computeReachableMoveCells({
        startX: myTok.x,
        startY: myTok.y,
        maxSpaces,
        cols,
        rows,
        terrain: [...(arena.terrain || []), ...monsterBlockers],
      });
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1;
      for (const c of cells) {
        const px = axisPad + c.x * cellPx;
        const py = axisPad + c.y * cellPx;
        ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
      }
      ctx.restore();
    } else if (myTok && me && !meEff.stunned && beatActionMode === 'attack') {
      const floor = Math.max(1, Number(beat.floor || me.currentFloor || 1));
      const maxAttacks = getMaxAttacksForFloor(floor);
      if (Number(myTok.attacksUsedThisTurn || 0) < maxAttacks) {
        const { maxRange } = getWeaponAttackInfo(me);
        const pArea: AttackArea = previewAttackArea || me.equipment?.mainHand?.attackArea || 'single';
        const pMod = previewAttackAreaModifier ?? me.equipment?.mainHand?.attackAreaModifier ?? 0;
        let nearestMon: { x: number; y: number } | null = null;
        let bestD = Infinity;
        for (const t of arena.tokens || []) {
          if (t.type !== 'monster') continue;
          const d = Math.max(Math.abs(t.x - myTok.x), Math.abs(t.y - myTok.y));
          if (d < bestD) {
            bestD = d;
            nearestMon = { x: t.x, y: t.y };
          }
        }
        const aimTarget = previewAimCell ?? nearestMon;
        const { allReachableCells, affectedCells } = computeAttackAreaCells({
          monsterX: myTok.x,
          monsterY: myTok.y,
          targetX: aimTarget?.x ?? null,
          targetY: aimTarget?.y ?? null,
          attackArea: pArea,
          areaModifier: pMod,
          rangeSpaces: maxRange,
          cols,
          rows,
        });
        const affSet = new Set(affectedCells.map((c) => `${c.x},${c.y}`));
        ctx.save();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.42)';
        ctx.lineWidth = 1;
        for (const c of allReachableCells) {
          const key = `${c.x},${c.y}`;
          if (affSet.has(key) || terrainSet.has(key)) continue;
          const px = axisPad + c.x * cellPx;
          const py = axisPad + c.y * cellPx;
          ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
          ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        }
        ctx.fillStyle = 'rgba(239, 68, 68, 0.44)';
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.95)';
        ctx.lineWidth = 1.6;
        for (const c of affectedCells) {
          if (terrainSet.has(`${c.x},${c.y}`)) continue;
          const px = axisPad + c.x * cellPx;
          const py = axisPad + c.y * cellPx;
          ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
          ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        }
        ctx.restore();
      }
    } else if (myTok && me && !meEff.stunned && beatActionMode === 'spell' && previewSpell) {
      const spRange = Math.max(1, Number(previewSpell.rangeSpaces || 3));
      const spArea: AttackArea = previewSpell.attackArea || 'single';
      const spMod = previewSpell.attackAreaModifier ?? 0;
      let nearestMon: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const t of arena.tokens || []) {
        if (t.type !== 'monster') continue;
        const d = Math.max(Math.abs(t.x - myTok.x), Math.abs(t.y - myTok.y));
        if (d < bestD) {
          bestD = d;
          nearestMon = { x: t.x, y: t.y };
        }
      }
      const aimTarget = previewAimCell ?? nearestMon;
      const { allReachableCells, affectedCells } = computeAttackAreaCells({
        monsterX: myTok.x,
        monsterY: myTok.y,
        targetX: aimTarget?.x ?? null,
        targetY: aimTarget?.y ?? null,
        attackArea: spArea,
        areaModifier: spMod,
        rangeSpaces: spRange,
        cols,
        rows,
      });
      const affSet = new Set(affectedCells.map((c) => `${c.x},${c.y}`));
      ctx.save();
      ctx.fillStyle = 'rgba(168, 85, 247, 0.16)';
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.5)';
      ctx.lineWidth = 1;
      for (const c of allReachableCells) {
        const key = `${c.x},${c.y}`;
        if (affSet.has(key) || terrainSet.has(key)) continue;
        const px = axisPad + c.x * cellPx;
        const py = axisPad + c.y * cellPx;
        ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
      }
      ctx.fillStyle = 'rgba(168, 85, 247, 0.45)';
      ctx.strokeStyle = '#d8b4fe';
      ctx.lineWidth = 1.6;
      for (const c of affectedCells) {
        if (terrainSet.has(`${c.x},${c.y}`)) continue;
        const px = axisPad + c.x * cellPx;
        const py = axisPad + c.y * cellPx;
        ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
      }
      const canSelfCast = Boolean(previewSpell.healFormula)
        || previewSpell.effectSpec?.target === 'self'
        || previewSpell.effectSpec?.target === 'all_allies';
      if (canSelfCast) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1.8;
        const px = axisPad + myTok.x * cellPx;
        const py = axisPad + myTok.y * cellPx;
        ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
      }
      ctx.restore();
    } else if (myTok && me && beatActionMode === 'observe' && !myTok.hasObservedThisTurn) {
      const pMods = computePassiveModifiers(me);
      const obsRange = 3 + (pMods.bonusObserveRangeSpaces || 0);
      const obsBlockers = new Set<string>([
        ...terrainSet,
        ...(arena.tokens || []).filter((t) => t.type === 'monster').map((t) => `${t.x},${t.y}`),
      ]);
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
          if (terrainSet.has(`${gx},${gy}`)) continue;
          if (!hasObserveLineOfSight({ startX: myTok.x, startY: myTok.y, targetX: gx, targetY: gy, blockers: obsBlockers })) {
            continue;
          }
          const px = axisPad + gx * cellPx;
          const py = axisPad + gy * cellPx;
          ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
          ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        }
      }
      ctx.restore();
    }
  } else if (
    session?.role === 'dm'
    && selectedTokenId
    && (beatActionMode === 'monster_move' || beatActionMode === 'monster_attack' || beatActionMode === 'monster_skill')
  ) {
    const monTok = (arena.tokens || []).find((t) => t.id === selectedTokenId && t.type === 'monster');
    const liveMon = (state?.monsters || []).find((m) => m.id === selectedTokenId);
    const monEff = computeActiveEffectModifiers(liveMon?.activeEffects);

    if (monTok && !monEff.stunned && beatActionMode === 'monster_move' && !monTok.hasMovedThisTurn) {
      // Red display for Monster Move (BFS pathfinding around impassable terrain)
      const { cells } = computeReachableMoveCells({
        startX: monTok.x,
        startY: monTok.y,
        maxSpaces: Math.max(1, 6 + monEff.speedDelta),
        cols,
        rows,
        terrain: arena.terrain,
      });
      ctx.save();
      ctx.fillStyle = 'rgba(248, 113, 113, 0.22)';
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.55)';
      ctx.lineWidth = 1.25;
      for (const c of cells) {
        const px = axisPad + c.x * cellPx;
        const py = axisPad + c.y * cellPx;
        ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
      }
      ctx.restore();
    } else if (monTok && !monEff.stunned && (beatActionMode === 'monster_attack' || beatActionMode === 'monster_skill')) {
      const isSkill = beatActionMode === 'monster_skill';
      const area: MonsterAttackArea = previewAttackArea || inferDefaultAttackAreaForMonster({
        name: monTok.name,
        maxHp: liveMon?.maxHp ?? monTok.maxHp,
        rangeSpaces: liveMon?.rangeSpaces,
        attackArea: liveMon?.attackArea,
      });
      const areaMod = previewAttackAreaModifier ?? liveMon?.attackAreaModifier ?? 0;
      // Preview aim toward the nearest player token
      let nearest: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (const t of arena.tokens || []) {
        if (t.type !== 'player') continue;
        const d = Math.max(Math.abs(t.x - monTok.x), Math.abs(t.y - monTok.y));
        if (d < bestD) {
          bestD = d;
          nearest = { x: t.x, y: t.y };
        }
      }
      const aimTarget = previewAimCell ?? nearest;
      const { allReachableCells, affectedCells } = computeMonsterAttackCells({
        monsterX: monTok.x,
        monsterY: monTok.y,
        targetX: aimTarget?.x ?? null,
        targetY: aimTarget?.y ?? null,
        attackArea: area,
        areaModifier: areaMod,
        rangeSpaces: liveMon?.rangeSpaces,
        cols,
        rows,
        isSkill,
      });
      const affSet = new Set(affectedCells.map((c) => `${c.x},${c.y}`));
      ctx.save();
      // Reachable area (all facings) - lighter tint
      ctx.fillStyle = isSkill ? 'rgba(192, 38, 211, 0.16)' : 'rgba(220, 38, 38, 0.18)';
      ctx.strokeStyle = isSkill ? 'rgba(244, 63, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)';
      ctx.lineWidth = 1;
      for (const c of allReachableCells) {
        const key = `${c.x},${c.y}`;
        if (affSet.has(key) || terrainSet.has(key)) continue;
        const px = axisPad + c.x * cellPx;
        const py = axisPad + c.y * cellPx;
        ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
      }
      // Affected strike area (aimed at nearest player) - strong tint
      ctx.fillStyle = isSkill ? 'rgba(192, 38, 211, 0.42)' : 'rgba(220, 38, 38, 0.48)';
      ctx.strokeStyle = isSkill ? 'rgba(244, 63, 94, 0.95)' : 'rgba(239, 68, 68, 0.95)';
      ctx.lineWidth = 1.8;
      for (const c of affectedCells) {
        if (terrainSet.has(`${c.x},${c.y}`)) continue;
        const px = axisPad + c.x * cellPx;
        const py = axisPad + c.y * cellPx;
        ctx.fillRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
        ctx.strokeRect(px + 1, py + 1, cellPx - 2, cellPx - 2);
      }
      ctx.restore();
    }
  }

  drawArenaTerrainLayer(ctx, arena.terrain || [], axisPad, cellPx, biome, cols, rows);

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

  for (const spot of arena.restSpots || []) {
    const cx = axisPad + spot.x * cellPx + cellPx / 2;
    const cy = axisPad + spot.y * cellPx + cellPx / 2;
    const usedByMe = Boolean(session?.characterId && spot.usedBy?.includes(session.characterId));
    const r = Math.max(7, cellPx * 0.34);
    ctx.save();
    ctx.globalAlpha = usedByMe ? 0.38 : 0.95;
    ctx.fillStyle = usedByMe ? '#334155' : 'rgba(16, 185, 129, 0.25)';
    ctx.strokeStyle = usedByMe ? '#64748b' : '#34d399';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = usedByMe ? '#94a3b8' : '#6ee7b7';
    ctx.font = `bold ${Math.max(9, Math.round(cellPx * 0.42))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', cx, cy + 0.5);
    ctx.restore();
  }

  for (const tok of arena.tokens || []) {
    const liveMon = tok.type === 'monster' ? (state?.monsters || []).find((m) => m.id === tok.id) : undefined;
    if (liveMon && ((liveMon.hp !== null && liveMon.hp <= 0) || liveMon.healthTier === 'Defeated')) continue;
    const cx = axisPad + tok.x * cellPx + cellPx / 2;
    const cy = axisPad + tok.y * cellPx + cellPx / 2;
    const r = Math.max(9, Math.floor(cellPx * 0.4));

    const drawTok = liveMon?.iconId && !tok.iconId ? { ...tok, iconId: liveMon.iconId } : tok;
    drawTokenAvatar(ctx, drawTok, cx, cy, r, selectedTokenId === tok.id, state?.characters, onPortraitLoaded);

    const showHpBar = session?.role === 'dm' || (tok.type === 'monster' && Boolean(liveMon?.observedByViewer));
    const barHp = liveMon?.hp !== undefined ? liveMon.hp : tok.hp;
    const barMaxHp = liveMon?.maxHp !== undefined ? liveMon.maxHp : tok.maxHp;
    if (showHpBar && barMaxHp && barMaxHp > 0 && barHp !== null && barHp !== undefined) {
      const bw = cellPx - 6;
      const bh = 5;
      const bx = cx - bw / 2;
      const by = cy + r + 2;
      const pct = Math.max(0, Math.min(1, barHp / barMaxHp));
      ctx.fillStyle = '#060a14';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = tok.type === 'monster' ? '#ef4444' : '#22c55e';
      ctx.fillRect(bx, by, bw * pct, bh);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(bx, by, bw, 2);
      const ticks =
        liveMon?.hpBarTicks ??
        computeSegmentedBarTicks(barMaxHp, tok.type === 'monster' ? 'monster' : 'hp');
      for (const tick of ticks) {
        const tx = Math.round(bx + (bw * tick.pct) / 100);
        const tw = tick.major ? 2 : 1;
        ctx.fillStyle = 'rgba(6, 10, 20, 0.92)';
        ctx.fillRect(tx - Math.floor(tw / 2), by, tw, bh);
      }
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(bx, by, bw, bh);
    }
  }
}
