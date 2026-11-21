import { useEffect, useState } from 'react';
import { useVtt } from '../../context/VttContext';
import { PolyhedralDieSvg } from '../common/DiceTrayStage';

export function DiceRollModal() {
  const { diceRollModal, setDiceRollModal } = useVtt();
  const [rolling, setRolling] = useState(true);
  const [flickerVal, setFlickerVal] = useState<number>(10);

  const sidesMatch = String(diceRollModal?.formula || '').match(/d(\d+)/i);
  const sides = Number(diceRollModal?.sides || (sidesMatch ? Number(sidesMatch[1]) : 20));
  const rawDie = diceRollModal?.rolls?.[0] ?? diceRollModal?.diceTotal ?? diceRollModal?.total ?? 10;
  const total = diceRollModal?.total ?? rawDie;
  const mod = Number(diceRollModal?.modifier || 0);
  const dc = diceRollModal?.dc;

  useEffect(() => {
    if (!diceRollModal) return;
    setRolling(true);
    setFlickerVal(Math.floor(Math.random() * Math.max(2, sides)) + 1);

    const tick = window.setInterval(() => {
      setFlickerVal(Math.floor(Math.random() * Math.max(2, sides)) + 1);
    }, 70);

    const timer = window.setTimeout(() => {
      window.clearInterval(tick);
      setRolling(false);
    }, 850);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(timer);
    };
  }, [diceRollModal?.id, sides]);

  if (!diceRollModal) return null;

  const isCrit = Boolean(diceRollModal.isCrit || (sides >= 4 && Number(rawDie) === sides));
  const isFumble = Boolean(diceRollModal.isFumble || (sides >= 4 && Number(rawDie) === 1));

  const isSuccess =
    diceRollModal.passed !== undefined
      ? Boolean(diceRollModal.passed)
      : dc !== undefined && dc > 0
        ? isCrit || (!isFumble && total >= dc)
        : isCrit || (!isFumble && total >= Math.max(10, Math.ceil(sides / 2)));

  const statusColor = rolling
    ? '#38bdf8'
    : isSuccess
      ? '#10b981'
      : '#ef4444';

  const statusLabel = isCrit
    ? 'CRITICAL SUCCESS!'
    : isFumble
      ? 'CRITICAL FAILURE!'
      : isSuccess
        ? 'SUCCESS!'
        : 'FAILED!';

  const modStr = mod > 0 ? `+ ${mod}` : mod < 0 ? `- ${Math.abs(mod)}` : '';

  return (
    <div id="dice-roll-modal" className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          maxWidth: '460px',
          width: '92%',
          border: `1.5px solid ${statusColor}`,
          boxShadow: `0 0 38px ${rolling ? 'rgba(56, 189, 248, 0.3)' : isSuccess ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
          textAlign: 'center',
        }}
      >
        <div className="panel-header">
          <div style={{ textAlign: 'left' }}>
            <div className="btn-row" style={{ alignItems: 'center', marginBottom: '2px' }}>
              <span className={`tag ${diceRollModal.isSecret ? 'tag-gold' : 'tag-cyan'}`}>
                {diceRollModal.isSecret ? 'SECRET DM ROLL' : `${diceRollModal.rollerName.toUpperCase()} ROLL`}
              </span>
              <span className="tag tag-purple">{diceRollModal.formula}</span>
              {dc !== undefined && dc > 0 && (
                <span className="tag tag-gold">DC {dc}</span>
              )}
            </div>
            <h3 style={{ margin: 0 }}>{diceRollModal.label || 'Dice Roll'}</h3>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            onClick={() => setDiceRollModal(null)}
          >
            Close
          </button>
        </div>

        {/* Animated Polyhedral Die Stage */}
        <div
          className="attack-die-stage mt-sm"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '18px 10px',
          }}
        >
          <div
            className={`attack-die-cube ${rolling ? 'rolling' : 'landed'}`}
            style={{
              position: 'relative',
              width: '108px',
              height: '108px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '20px',
              border: `2px solid ${statusColor}`,
              background: 'radial-gradient(circle, rgba(15, 23, 42, 0.95), rgba(2, 6, 23, 0.98))',
              boxShadow: `0 0 28px ${statusColor}55`,
            }}
          >
            <div style={{ position: 'absolute', inset: '8px', opacity: 0.45 }}>
              <PolyhedralDieSvg sides={sides} />
            </div>
            <span
              style={{
                position: 'relative',
                zIndex: 2,
                fontSize: '2.1rem',
                fontWeight: 900,
                color: rolling ? '#38bdf8' : isCrit ? '#fbbf24' : isFumble ? '#f87171' : '#f8fafc',
              }}
            >
              {rolling ? flickerVal : total}
            </span>
          </div>

          <div className="small muted mt-xs">
            {rolling
              ? `Rolling ${diceRollModal.formula}...`
              : diceRollModal.rolls && diceRollModal.rolls.length > 0
                ? `Natural d${sides}: [${diceRollModal.rolls.join(', ')}] ${modStr ? `${modStr} = ${total}` : `= ${total}`}`
                : `${diceRollModal.formula} = ${total}`}
          </div>
        </div>

        {/* Result Banner: SUCCESS or FAILED */}
        {!rolling && (
          <div
            className="panel mt-xs"
            style={{
              padding: '12px 14px',
              background: isSuccess ? 'rgba(6, 78, 59, 0.42)' : 'rgba(127, 29, 29, 0.42)',
              border: `1.5px solid ${statusColor}`,
              borderRadius: '10px',
            }}
          >
            <div
              style={{
                fontSize: '1.25rem',
                fontWeight: 900,
                letterSpacing: '0.06em',
                color: isCrit ? '#fbbf24' : isSuccess ? '#34d399' : '#f87171',
              }}
            >
              {statusLabel}
            </div>

            <div className="small mt-xs" style={{ color: '#e2e8f0' }}>
              {diceRollModal.breakdown
                ? diceRollModal.breakdown
                : dc !== undefined && dc > 0
                  ? `Rolled ${total} vs Target DC ${dc} (${isSuccess ? 'Passed!' : 'Failed'})`
                  : `Rolled ${total} on ${diceRollModal.formula} (${isSuccess ? 'Success!' : 'Failed'})`}
            </div>

            {diceRollModal.rewardSummary && (
              <div
                className="small mt-xs"
                style={{
                  color: '#fbbf24',
                  fontWeight: 700,
                  background: 'rgba(251, 191, 36, 0.12)',
                  padding: '5px 8px',
                  borderRadius: '6px',
                }}
              >
                Bonus Triggered: {diceRollModal.rewardSummary}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className={`btn ${!rolling && isSuccess ? 'btn-gold' : 'btn-outline'} btn-lg mt-sm`}
          style={{ width: '100%', fontWeight: 800 }}
          disabled={rolling}
          onClick={() => setDiceRollModal(null)}
        >
          {rolling ? 'Rolling Dice...' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
