import React, { useMemo } from 'react';
import { computeSegmentedBarTicks, type BarTick } from '@shared/index';

export interface SegmentedBarTicksProps {
  /** Maximum value used to compute proportional Dota 2-style ticks when `ticks` is not provided */
  maxValue?: number;
  /** Bar category for step-ladder scaling */
  kind?: 'hp' | 'mp' | 'xp' | 'monster';
  /** Optional precomputed ticks (e.g. server-masked monster hpBarTicks) */
  ticks?: BarTick[];
}

export function SegmentedBarTicks({
  maxValue = 0,
  kind = 'hp',
  ticks,
}: SegmentedBarTicksProps) {
  const resolvedTicks = useMemo(() => {
    if (Array.isArray(ticks)) return ticks;
    return computeSegmentedBarTicks(maxValue, kind);
  }, [ticks, maxValue, kind]);

  if (resolvedTicks.length === 0) return null;

  return (
    <div className="bar-seg-ticks" aria-hidden="true">
      {resolvedTicks.map((tick, idx) => (
        <span
          key={idx}
          className={`bar-seg-tick${tick.major ? ' is-major' : ''}`}
          style={{ left: `${tick.pct}%` }}
        />
      ))}
    </div>
  );
}

export interface SegmentedBarProps extends SegmentedBarTicksProps {
  /** Current percentage width (0-100) */
  pct: number;
  /** Optional ghost percentage (e.g. pre-damage HP) rendered behind the active fill */
  ghostPct?: number;
  /** Optional background color for the ghost bar */
  ghostColor?: string;
  /** Additional classes on the outer track (e.g. "progress pstatus-progress" or "pcombat-bar-track") */
  trackClassName?: string;
  /** Inline style on the outer track */
  trackStyle?: React.CSSProperties;
  /** Fill class (e.g. "hp", "mp", "xp", "monster") */
  fillKind: 'hp' | 'mp' | 'xp' | 'monster';
  /** Optional DOM id on the inner fill element */
  fillId?: string;
  /** Optional critical low-HP pulse state */
  critical?: boolean;
}

export function SegmentedBar({
  pct,
  ghostPct,
  ghostColor,
  maxValue = 0,
  kind = 'hp',
  ticks,
  trackClassName = 'progress',
  trackStyle,
  fillKind,
  fillId,
  critical = false,
}: SegmentedBarProps) {
  const clampedPct = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const clampedGhostPct =
    ghostPct !== undefined && Number.isFinite(ghostPct)
      ? Math.max(0, Math.min(100, ghostPct))
      : undefined;

  return (
    <div
      className={`${trackClassName} bar-seg${critical ? ' is-critical' : ''}`.trim()}
      style={trackStyle}
    >
      {clampedGhostPct !== undefined && clampedGhostPct > clampedPct && (
        <div
          className="bar-seg-ghost"
          style={{
            width: `${clampedGhostPct}%`,
            background: ghostColor || 'rgba(248, 113, 113, 0.35)',
          }}
        />
      )}
      <div
        id={fillId}
        className={`progress-fill ${fillKind}`}
        style={{ width: `${clampedPct}%` }}
      />
      <SegmentedBarTicks maxValue={maxValue} kind={kind} ticks={ticks} />
    </div>
  );
}
