import { useEffect, useState } from 'react';
import type { RollLogEntry } from '@shared/index';

export function PolyhedralDieSvg({ sides }: { sides: number }) {
  const s = Number(sides || 20);
  if (s === 4) {
    return (
      <svg viewBox="0 0 64 64">
        <polygon points="32,6 58,54 6,54" fill="rgba(56,189,248,0.16)" stroke="#38bdf8" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
    );
  }
  if (s === 6) {
    return (
      <svg viewBox="0 0 64 64">
        <rect x="10" y="10" width="44" height="44" rx="8" fill="rgba(56,189,248,0.16)" stroke="#38bdf8" strokeWidth="2.5" />
      </svg>
    );
  }
  if (s === 8) {
    return (
      <svg viewBox="0 0 64 64">
        <polygon points="32,5 57,32 32,59 7,32" fill="rgba(56,189,248,0.16)" stroke="#38bdf8" strokeWidth="2.5" strokeLinejoin="round" />
        <line x1="7" y1="32" x2="57" y2="32" stroke="rgba(56,189,248,0.35)" strokeWidth="1.5" />
      </svg>
    );
  }
  if (s === 10 || s === 100) {
    return (
      <svg viewBox="0 0 64 64">
        <polygon points="32,5 56,28 32,59 8,28" fill="rgba(168,85,247,0.18)" stroke="#a855f7" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
    );
  }
  if (s === 12) {
    return (
      <svg viewBox="0 0 64 64">
        <polygon points="32,6 56,24 47,54 17,54 8,24" fill="rgba(56,189,248,0.16)" stroke="#38bdf8" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64">
      <polygon points="32,5 55,18 55,46 32,59 9,46 9,18" fill="rgba(56,189,248,0.16)" stroke="#38bdf8" strokeWidth="2.5" strokeLinejoin="round" />
      <polygon points="32,14 48,42 16,42" fill="none" stroke="rgba(56,189,248,0.35)" strokeWidth="1.3" />
    </svg>
  );
}

export function DiceTrayStage({
  id,
  roll,
  placeholder = 'Select any die below to animate roll...',
}: {
  id?: string;
  roll: RollLogEntry | null;
  placeholder?: string;
}) {
  const [rolling, setRolling] = useState(false);
  const [flickerVals, setFlickerVals] = useState<number[]>([]);

  const sidesMatch = String(roll?.formula || '').match(/d(\d+)/i);
  const sides = sidesMatch ? Number(sidesMatch[1]) : 20;
  const rolls = roll?.rolls?.length ? roll.rolls : roll ? [roll.total] : [];

  useEffect(() => {
    if (!roll) return;
    setRolling(true);
    setFlickerVals(rolls.map(() => Math.floor(Math.random() * sides) + 1));

    const tick = window.setInterval(() => {
      setFlickerVals(rolls.map(() => Math.floor(Math.random() * sides) + 1));
    }, 65);

    const stop = window.setTimeout(() => {
      window.clearInterval(tick);
      setRolling(false);
    }, 460);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(stop);
    };
  }, [roll?.id, sides]);

  if (!roll) {
    return (
      <div id={id} className="dice-sim-stage muted small">
        {placeholder}
      </div>
    );
  }

  return (
    <div id={id} className="dice-sim-stage">
      {rolls.map((val, idx) => {
        const displayVal = rolling ? (flickerVals[idx] ?? val) : val;
        const isCrit = !rolling && sides >= 4 && Number(val) === sides;
        const isFumble = !rolling && sides >= 4 && Number(val) === 1;
        return (
          <div
            key={`${roll.id}-${idx}`}
            className={`dice-sim-die ${rolling ? 'rolling' : ''} ${isCrit ? 'crit' : ''} ${isFumble ? 'fumble' : ''}`}
          >
            <PolyhedralDieSvg sides={sides} />
            <span className="dice-sim-val">{displayVal}</span>
          </div>
        );
      })}
      <div className="dice-sim-total">
        {rolling ? (
          <>
            Rolling <b>{roll.formula}</b>...
          </>
        ) : (
          <>
            <b>{roll.formula}</b> ({roll.label || 'Roll'}) = <strong className="tag tag-gold">{roll.total}</strong>
          </>
        )}
      </div>
    </div>
  );
}
