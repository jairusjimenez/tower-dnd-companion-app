import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  computeStatModifier,
  getArenaCellPx,
  spaceDistanceBetweenPoints,
  type ArenaCanvasVariant,
  type AttackArea,
  type StoryBeat,
} from '@shared/index';
import { findBeatTokenAt, getScaledCanvasCell } from '../../canvas/coordinates';
import { drawBeatArenaCanvas, type BeatActionMode } from '../../canvas/drawBeatArena';
import { useVtt } from '../../context/VttContext';

export function useBeatPlayerCellAction() {
  const { session, state, sendAction, pushLocalToast, requestAttackRoll } = useVtt();

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
          const dist = spaceDistanceBetweenPoints(x, y, myTok.x, myTok.y);
          if (dist > 3) {
            pushLocalToast({
              title: 'OUT OF OBSERVE RANGE',
              message: `Observe reaches 3 Spaces around you (selected ${dist} Spaces away).`,
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
        }>('story_action', {
          subAction: 'observe_beat_cell',
          beatId: beat.id,
          tokenId: session.characterId,
          x,
          y,
        });

        const tok = (arena.tokens || []).find((t) => t.x === x && t.y === y);
        const chest = (arena.chests || []).find((c) => c.x === x && c.y === y);
        const terrain = (arena.terrain || []).find((t) => t.x === x && t.y === y);

        if (tok?.type === 'monster') {
          const mon = (state.monsters || []).find((m) => m.id === tok.id);
          const hpRatio = mon && mon.maxHp ? Number(mon.hp || 0) / Number(mon.maxHp) : 1;
          const computedTier = mon?.healthTier || (hpRatio <= 0 ? 'Defeated' : hpRatio <= 0.3 ? 'Critical' : hpRatio <= 0.65 ? 'Bloodied' : 'Healthy');
          if (obsRes?.weakSpotFound) {
            pushLocalToast({
              title: `WEAK SPOT FOUND: ${tok.name}!`,
              message: `PER (${obsRes.successChancePct}% chance, rolled ${obsRes.rollPct}) uncovered a weak point! +${obsRes.bonusDamage} Damage & +${obsRes.bonusCritDamage} Crit Damage (Floor ${obsRes.floor}F).`,
              category: 'combat',
            });
          } else {
            pushLocalToast({
              title: `OBSERVE MONSTER: ${tok.name}`,
              message: mon
                ? `Condition: ${computedTier} • AC ${mon.ac} • DR ${mon.dr}${mon.damageFormula ? ` • Atk ${mon.damageFormula}` : ''} • Weak spot missed (${obsRes?.rollPct ?? '?'}/${obsRes?.successChancePct ?? '?'}% via PER)`
                : `Hostile monster. Weak spot missed (${obsRes?.rollPct ?? '?'}/${obsRes?.successChancePct ?? '?'}% via PER).`,
              category: 'info',
            });
          }
          return true;
        }
        if (tok?.type === 'player') {
          const unit = state.characters?.[tok.id];
          pushLocalToast({
            title: `OBSERVE UNIT: ${tok.name}`,
            message: unit
              ? `Lv ${unit.level} ${unit.className || 'Climber'} • HP ${unit.hp}/${unit.maxHp} • AC ${unit.ac} • DR ${unit.dr || 0}${unit.equipment?.mainHand ? ` • Weapon: ${unit.equipment.mainHand.name}` : ''}`
              : `Allied unit at (${x + 1}, ${y + 1}).`,
            category: 'info',
          });
          return true;
        }
        if (tok) {
          pushLocalToast({
            title: `OBSERVE NPC: ${tok.name}`,
            message: `${tok.npcRole || tok.type.toUpperCase()} at (${x + 1}, ${y + 1})${tok.dialogue ? ` — "${tok.dialogue}"` : '.'}`,
            category: 'info',
          });
          return true;
        }
        if (chest) {
          pushLocalToast({
            title: `OBSERVE CHEST: ${chest.name}`,
            message: chest.opened ? 'Already opened.' : 'Unopened chest — tap in Move mode to open.',
            category: 'info',
          });
          return true;
        }
        if (terrain) {
          pushLocalToast({
            title: `OBSERVE TERRAIN: ${String(terrain.type || 'Obstacle').toUpperCase()}`,
            message: `Impassable ${terrain.type || 'obstacle'} at (${x + 1}, ${y + 1}). Blocks movement.`,
            category: 'info',
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
        pushLocalToast({
          title: 'OBSERVE TERRAIN',
          message: `Open ${arena.biome || 'obsidian'} floor at (${x + 1}, ${y + 1}). PER Check: ${rollRes?.roll?.total ?? '?'} (${rollRes?.roll?.formula || '1d20'}).`,
          category: 'info',
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
        const wep = me.equipment?.mainHand || null;
        await requestAttackRoll({
          monTok,
          me,
          wep,
          beatId: beat.id,
          attackArea: attackArea ?? wep?.attackArea ?? 'single',
          attackAreaModifier: attackAreaModifier ?? wep?.attackAreaModifier ?? 0,
          ...(healFormula ?? wep?.healFormula ? { healFormula: healFormula ?? wep?.healFormula } : {}),
          ...(effectSpec ?? wep?.effectSpec ? { effectSpec: effectSpec ?? wep?.effectSpec } : {}),
        });
        return true;
      }

      return false;
    },
    [pushLocalToast, requestAttackRoll, sendAction, session, state],
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
  measureStart = null,
  measureEnd = null,
  centerOnCharacterId = null,
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
  measureStart?: { x: number; y: number } | null;
  measureEnd?: { x: number; y: number } | null;
  centerOnCharacterId?: string | null;
  onCellClick?: (x: number, y: number) => void;
  onMeasuredLabel?: (dist: number) => void;
}) {
  const { session, state, showTooltip, hideTooltip } = useVtt();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const [portraitRev, setPortraitRev] = useState(0);

  const cols = beat.arena?.cols || 20;
  const rows = beat.arena?.rows || 20;
  const cellPx = cellPxOverride ?? getArenaCellPx(cols, variant);
  const axisPad = 24;

  useEffect(() => {
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
      session,
      state,
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
  }, [beat, cellPx, selectedTokenId, beatActionMode, previewAttackArea, previewAttackAreaModifier, previewAimCell, session, state, measureStart, measureEnd, portraitRev, onMeasuredLabel]);

  // Center scroll viewport on player's token when opening Beat Detail
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !centerOnCharacterId) return;
    const tok = (beat.arena?.tokens || []).find((t) => t.id === centerOnCharacterId);
    const wrap = canvas.parentElement;
    if (!tok || !wrap) return;
    const raf = window.requestAnimationFrame(() => {
      const cx = (Number(tok.x || 0) + 0.5) * cellPx;
      const cy = (Number(tok.y || 0) + 0.5) * cellPx;
      wrap.scrollLeft = Math.max(0, cx - wrap.clientWidth / 2);
      wrap.scrollTop = Math.max(0, cy - wrap.clientHeight / 2);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [beat.id, centerOnCharacterId]);

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
    const tok = findBeatTokenAt(canvas, ev.clientX, ev.clientY, beat, cellPx, session?.role);
    if (tok) showTooltip(tok, ev.clientX, ev.clientY);
    else hideTooltip();
  };

  const handleTouchStart = (ev: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const touch = ev.touches[0];
    if (!canvas || !touch) return;
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    const tok = findBeatTokenAt(canvas, touch.clientX, touch.clientY, beat, cellPx, session?.role);
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
