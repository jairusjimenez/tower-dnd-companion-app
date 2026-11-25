import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  computePassiveModifiers,
  computeStatModifier,
  evaluateRangedShot,
  getArenaCellPx,
  getWeaponAttackInfo,
  hasObserveLineOfSight,
  spaceDistanceBetweenPoints,
  type ArenaCanvasVariant,
  type AttackArea,
  type Monster,
  type Spell,
  type StoryBeat,
} from '@shared/index';
import { findBeatTokenAt, getScaledCanvasCell } from '../../canvas/coordinates';
import { ArenaFxManager, type ArenaFxFrame } from '../../canvas/arenaFx';
import { drawBeatArenaCanvas, type BeatActionMode } from '../../canvas/drawBeatArena';
import { useVtt } from '../../context/VttContext';

export function useBeatPlayerCellAction() {
  const { session, state, sendAction, pushLocalToast, requestAttackRoll, setActiveObserveResult } = useVtt();

  return useCallback(
    async ({
      beat,
      x,
      y,
      mode,
      attackArea,
      attackAreaModifier,
      healFormula,
      effectSpec,
    }: {
      beat: StoryBeat;
      x: number;
      y: number;
      mode: BeatActionMode;
      attackArea?: AttackArea;
      attackAreaModifier?: number;
      healFormula?: string;
      effectSpec?: import('@shared/index').UnitEffectSpec | null;
    }): Promise<boolean> => {
      if (!session || session.role === 'dm' || !session.characterId || !state) return false;
      const arena = beat.arena;
      if (!arena) return false;

      if (mode === 'observe') {
        const myTok = (arena.tokens || []).find((t) => t.id === session.characterId);
        if (myTok?.hasObservedThisTurn) {
          pushLocalToast({
            title: 'OBSERVE USED',
            message: 'You have already used Observe this turn. Wait until your next turn.',
            category: 'warning',
          });
          return true;
        }
        if (myTok) {
          const meObs = state.characters?.[session.characterId];
          const maxObsRange = 3 + (meObs ? computePassiveModifiers(meObs).bonusObserveRangeSpaces || 0 : 0);
          const dist = spaceDistanceBetweenPoints(x, y, myTok.x, myTok.y);
          if (dist > maxObsRange) {
            pushLocalToast({
              title: 'OUT OF OBSERVE RANGE',
              message: `Observe reaches ${maxObsRange} Spaces around you (selected ${dist} Spaces away).`,
              category: 'warning',
            });
            return true;
          }
          const terrainSet = new Set((arena.terrain || []).map((t) => `${t.x},${t.y}`));
          if (terrainSet.has(`${x},${y}`)) {
            pushLocalToast({
              title: 'OBSTRUCTED',
              message: 'Cannot observe impassable terrain.',
              category: 'warning',
            });
            return true;
          }
          const obsBlockers = new Set<string>([
            ...terrainSet,
            ...(arena.tokens || []).filter((t) => t.type === 'monster').map((t) => `${t.x},${t.y}`),
          ]);
          if (
            !hasObserveLineOfSight({
              startX: myTok.x,
              startY: myTok.y,
              targetX: x,
              targetY: y,
              blockers: obsBlockers,
            })
          ) {
            pushLocalToast({
              title: 'LINE OF SIGHT BLOCKED',
              message: 'Observe is obstructed by impassable terrain or a monster.',
              category: 'warning',
            });
            return true;
          }
        }
        const obsRes = await sendAction<{
          weakSpotFound?: boolean;
          successChancePct?: number;
          rollPct?: number;
          bonusDamage?: number;
          bonusCritDamage?: number;
          floor?: number;
          monster?: Monster | null;
        }>('story_action', {
          subAction: 'observe_beat_cell',
          beatId: beat.id,
          tokenId: session.characterId,
          x,
          y,
        });
        if (!obsRes) return true;

        const tok = (arena.tokens || []).find((t) => t.x === x && t.y === y);
        const chest = (arena.chests || []).find((c) => c.x === x && c.y === y);
        const terrain = (arena.terrain || []).find((t) => t.x === x && t.y === y);

        if (tok?.type === 'monster') {
          const mon = obsRes.monster || (state.monsters || []).find((m) => m.id === tok.id) || null;
          setActiveObserveResult({
            kind: 'monster',
            title: tok.name,
            subtitle: mon?.floor ? `${mon.floor}F Monster` : 'Monster',
            x,
            y,
            iconId: mon?.iconId ?? tok.iconId,
            monster: mon,
            weakSpotFound: Boolean(obsRes.weakSpotFound),
            successChancePct: obsRes.successChancePct,
            rollPct: obsRes.rollPct,
            bonusDamage: obsRes.bonusDamage,
            bonusCritDamage: obsRes.bonusCritDamage,
            floor: obsRes.floor,
          });
          return true;
        }
        if (tok?.type === 'player') {
          const unit = state.characters?.[tok.id] || null;
          setActiveObserveResult({
            kind: 'player',
            title: tok.name,
            subtitle: unit ? `Lv ${unit.level} ${unit.className || 'Climber'}` : 'Allied Unit',
            x,
            y,
            iconId: tok.iconId,
            player: unit,
            description: `Allied unit at (${x + 1}, ${y + 1}).`,
          });
          return true;
        }
        if (tok) {
          setActiveObserveResult({
            kind: 'npc',
            title: tok.name,
            subtitle: tok.npcRole || 'NPC',
            x,
            y,
            iconId: tok.iconId,
            npcRole: tok.npcRole || 'NPC',
            dialogue: tok.dialogue,
            description: `${tok.npcRole || tok.type.toUpperCase()} at (${x + 1}, ${y + 1})${tok.dialogue ? ` — "${tok.dialogue}"` : '.'}`,
          });
          return true;
        }
        if (chest) {
          setActiveObserveResult({
            kind: 'chest',
            title: chest.name,
            subtitle: `${chest.tier || 'Common'} Chest`,
            x,
            y,
            chestName: chest.name,
            chestTier: chest.tier || 'Common',
            chestOpened: Boolean(chest.opened),
            description: chest.opened
              ? 'Already opened.'
              : 'Unopened chest — tap in Move mode to open.',
          });
          return true;
        }
        if (terrain) {
          setActiveObserveResult({
            kind: 'terrain',
            title: String(terrain.type || 'Obstacle').toUpperCase(),
            subtitle: 'Impassable Terrain',
            x,
            y,
            terrainType: String(terrain.type || 'obstacle'),
            description: `Impassable ${terrain.type || 'obstacle'} at (${x + 1}, ${y + 1}). Blocks movement.`,
          });
          return true;
        }

        const me = state.characters?.[session.characterId];
        const perMod = computeStatModifier(Number(me?.stats?.PER ?? 10), state.mechanics, me);
        const rollRes = await sendAction<{ roll?: { total: number; formula: string } }>('roll_dice', {
          rollerName: me?.name || 'Climber',
          formula: '1d20',
          modifier: perMod,
          label: 'Observe (PER)',
        });
        setActiveObserveResult({
          kind: 'terrain',
          title: 'Open Floor',
          subtitle: `${String(arena.biome || 'obsidian').toUpperCase()} Arena`,
          x,
          y,
          description: `Open ${arena.biome || 'obsidian'} floor at (${x + 1}, ${y + 1}).`,
          rollTotal: rollRes?.roll?.total,
          rollFormula: rollRes?.roll?.formula || '1d20',
        });
        return true;
      }

      if (mode === 'attack') {
        const monTok = (arena.tokens || []).find((t) => t.x === x && t.y === y && t.type === 'monster');
        if (!monTok) {
          return false;
        }
        const me = state.characters?.[session.characterId];
        if (!me) return true;
        const myTok = (arena.tokens || []).find((t) => t.id === session.characterId);
        if (myTok) {
          const { isRanged, maxRange } = getWeaponAttackInfo(me);
          const dist = spaceDistanceBetweenPoints(myTok.x, myTok.y, monTok.x, monTok.y);
          if (dist > maxRange) {
            pushLocalToast({
              title: 'OUT OF ATTACK RANGE',
              message: `You cannot attack ${monTok.name} — it is ${dist} Spaces away (${isRanged ? 'Ranged' : 'Melee'} max ${maxRange} Space${maxRange > 1 ? 's' : ''}).`,
              category: 'warning',
            });
            return true;
          }
          if (isRanged) {
            const shotEval = evaluateRangedShot({
              startX: myTok.x,
              startY: myTok.y,
              targetX: monTok.x,
              targetY: monTok.y,
              maxRange,
              isRanged: true,
              terrain: arena.terrain,
              tokens: arena.tokens,
              attackerId: me.id,
              attackerType: 'player',
              targetId: monTok.id,
            });
            if (shotEval.blockedByTerrain) {
              pushLocalToast({
                title: 'LINE OF SIGHT BLOCKED',
                message: `Impassable terrain blocks your ranged shot at ${monTok.name}. Reposition first!`,
                category: 'warning',
              });
              return true;
            }
          }
        }
        const wep = me.equipment?.mainHand || null;
        const atkHeal = healFormula ?? wep?.healFormula;
        const atkEff = effectSpec ?? wep?.effectSpec;
        await requestAttackRoll({
          monTok,
          me,
          wep,
          beatId: beat.id,
          attackArea: attackArea ?? wep?.attackArea ?? 'single',
          attackAreaModifier: attackAreaModifier ?? wep?.attackAreaModifier ?? 0,
          ...(atkHeal ? { healFormula: atkHeal } : {}),
          ...(atkEff ? { effectSpec: atkEff } : {}),
        });
        return true;
      }

      return false;
    },
    [pushLocalToast, requestAttackRoll, sendAction, session, setActiveObserveResult, state],
  );
}

export function BeatArenaCanvas({
  id,
  beat,
  variant = 'detail',
  cellPxOverride = null,
  selectedTokenId = null,
  beatActionMode = 'move',
  previewAttackArea = null,
  previewAttackAreaModifier = undefined,
  previewAimCell = null,
  previewSpell = null,
  measureStart = null,
  measureEnd = null,
  centerOnCharacterId = null,
  centerTriggerKey = null,
  hideAxisLabels = false,
  onCellClick,
  onMeasuredLabel,
}: {
  id?: string;
  beat: StoryBeat;
  variant?: ArenaCanvasVariant;
  cellPxOverride?: number | null;
  selectedTokenId?: string | null;
  beatActionMode?: BeatActionMode;
  previewAttackArea?: AttackArea | null;
  previewAttackAreaModifier?: number;
  previewAimCell?: { x: number; y: number } | null;
  previewSpell?: Spell | null;
  measureStart?: { x: number; y: number } | null;
  measureEnd?: { x: number; y: number } | null;
  centerOnCharacterId?: string | null;
  centerTriggerKey?: string | number | null;
  hideAxisLabels?: boolean;
  onCellClick?: (x: number, y: number) => void;
  onMeasuredLabel?: (dist: number) => void;
}) {
  const { session, state, showTooltip, hideTooltip } = useVtt();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const [portraitRev, setPortraitRev] = useState(0);
  const fxManagerRef = useRef<ArenaFxManager>(new ArenaFxManager());
  const prevTokenPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const prevBeatIdRef = useRef<string | null>(null);
  const fxRafRef = useRef<number | null>(null);

  const cols = beat.arena?.cols || 20;
  const rows = beat.arena?.rows || 20;
  const cellPx = cellPxOverride ?? getArenaCellPx(cols, variant);
  const axisPad = hideAxisLabels ? 0 : 24;
  const cellPxRef = useRef(cellPx);
  cellPxRef.current = cellPx;
  const axisPadRef = useRef(axisPad);
  axisPadRef.current = axisPad;

  const drawFrame = useCallback(
    (fxFrame: ArenaFxFrame | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      drawBeatArenaCanvas({
        canvas,
        beat,
        cellPx,
        selectedTokenId,
        beatActionMode,
        previewAttackArea,
        previewAttackAreaModifier,
        previewAimCell,
        previewSpell,
        session,
        state,
        hideAxisLabels,
        fxFrame,
        onPortraitLoaded: () => setPortraitRev((r) => r + 1),
      });

      if (measureStart && measureEnd) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const sx = axisPad + measureStart.x * cellPx + cellPx / 2;
          const sy = axisPad + measureStart.y * cellPx + cellPx / 2;
          const ex = axisPad + measureEnd.x * cellPx + cellPx / 2;
          const ey = axisPad + measureEnd.y * cellPx + cellPx / 2;
          ctx.save();
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.restore();
          const dist = spaceDistanceBetweenPoints(measureStart.x, measureStart.y, measureEnd.x, measureEnd.y);
          onMeasuredLabel?.(dist);
        }
      }
    },
    [beat, cellPx, axisPad, selectedTokenId, beatActionMode, previewAttackArea, previewAttackAreaModifier, previewAimCell, previewSpell, session, state, hideAxisLabels, measureStart, measureEnd, onMeasuredLabel],
  );
  const drawFrameRef = useRef(drawFrame);
  drawFrameRef.current = drawFrame;

  const ensureFxLoop = useCallback(() => {
    if (fxRafRef.current !== null) return;
    const tick = (now: number) => {
      const mgr = fxManagerRef.current;
      if (!mgr.hasActive(now)) {
        fxRafRef.current = null;
        drawFrameRef.current(null);
        return;
      }
      drawFrameRef.current(mgr.sample(now, cellPxRef.current));
      fxRafRef.current = window.requestAnimationFrame(tick);
    };
    fxRafRef.current = window.requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    return () => {
      if (fxRafRef.current !== null) {
        window.cancelAnimationFrame(fxRafRef.current);
        fxRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const mgr = fxManagerRef.current;
    const now = performance.now();
    const tokens = beat.arena?.tokens || [];
    const terrainSet = new Set((beat.arena?.terrain || []).map((t) => `${t.x},${t.y}`));

    if (prevBeatIdRef.current !== beat.id) {
      prevBeatIdRef.current = beat.id;
      mgr.clear();
      mgr.seedSeenFx(state?.recentArenaFx || []);
      const initMap = new Map<string, { x: number; y: number }>();
      for (const t of tokens) initMap.set(t.id, { x: t.x, y: t.y });
      prevTokenPosRef.current = initMap;
    } else {
      const nextMap = new Map<string, { x: number; y: number }>();
      for (const t of tokens) {
        const prev = prevTokenPosRef.current.get(t.id);
        if (prev && (prev.x !== t.x || prev.y !== t.y)) {
          mgr.queueWalk(t.id, prev, { x: t.x, y: t.y }, cols, rows, terrainSet, now);
        }
        nextMap.set(t.id, { x: t.x, y: t.y });
      }
      prevTokenPosRef.current = nextMap;

      for (const fx of [...(state?.recentArenaFx || [])].reverse()) {
        if (fx.beatId === beat.id) {
          mgr.queueFx(fx, now);
        }
      }
    }

    if (mgr.hasActive(now)) {
      ensureFxLoop();
    }
  }, [beat.id, beat.arena?.tokens, beat.arena?.terrain, cols, rows, state?.recentArenaFx, ensureFxLoop]);

  useEffect(() => {
    const mgr = fxManagerRef.current;
    const now = performance.now();
    drawFrame(mgr.hasActive(now) ? mgr.sample(now, cellPx) : null);
  }, [drawFrame, portraitRev, cellPx]);

  // Center scroll viewport on the active/target unit token
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !centerOnCharacterId) return;
    const tok = (beat.arena?.tokens || []).find((t) => t.id === centerOnCharacterId);
    const wrap = (canvas.closest('.pcombat-map-scroll, .arena-scroll-wrap') as HTMLElement | null) || canvas.parentElement;
    if (!tok || !wrap) return;
    const raf = window.requestAnimationFrame(() => {
      const cPx = cellPxRef.current;
      const aPad = axisPadRef.current;
      const wrapRect = wrap.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const scaleX = canvasRect.width / (canvas.width || 1);
      const scaleY = canvasRect.height / (canvas.height || 1);
      const tokCanvasX = aPad + (Number(tok.x || 0) + 0.5) * cPx;
      const tokCanvasY = aPad + (Number(tok.y || 0) + 0.5) * cPx;
      const cx = wrap.scrollLeft + (canvasRect.left - wrapRect.left) + tokCanvasX * scaleX;
      const cy = wrap.scrollTop + (canvasRect.top - wrapRect.top) + tokCanvasY * scaleY;
      wrap.scrollTo({
        left: Math.max(0, cx - wrap.clientWidth / 2),
        top: Math.max(0, cy - wrap.clientHeight / 2),
        behavior: 'smooth',
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [beat.id, centerOnCharacterId, centerTriggerKey]);

  const handleClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onCellClick) return;
    const { x, y } = getScaledCanvasCell(canvas, ev.clientX, ev.clientY, axisPad, cellPx);
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    onCellClick(x, y);
  };

  const handleMouseMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const tok = findBeatTokenAt(canvas, ev.clientX, ev.clientY, beat, cellPx, session?.role, axisPad);
    if (tok) showTooltip(tok, ev.clientX, ev.clientY);
    else hideTooltip();
  };

  const handleTouchStart = (ev: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const touch = ev.touches[0];
    if (!canvas || !touch) return;
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    const tok = findBeatTokenAt(canvas, touch.clientX, touch.clientY, beat, cellPx, session?.role, axisPad);
    if (tok) {
      holdTimerRef.current = window.setTimeout(() => showTooltip(tok, touch.clientX, touch.clientY), 260);
    }
  };

  const clearTouchTooltip = () => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    hideTooltip();
  };

  return (
    <canvas
      ref={canvasRef}
      id={id}
      className="beat-arena-canvas"
      width={axisPad + cols * cellPx}
      height={axisPad + rows * cellPx}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={hideTooltip}
      onTouchStart={handleTouchStart}
      onTouchEnd={clearTouchTooltip}
      onTouchCancel={clearTouchTooltip}
      onTouchMove={clearTouchTooltip}
    />
  );
}
