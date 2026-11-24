import { useEffect } from 'react';
import { formatActiveUnitEffect } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { SegmentedBar } from '../common/SegmentedBar';
import { TokenIconSvg } from '../common/TokenIconSvg';

export function ObserveModal() {
  const { activeObserveResult, setActiveObserveResult } = useVtt();

  useEffect(() => {
    if (!activeObserveResult) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveObserveResult(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeObserveResult, setActiveObserveResult]);

  if (!activeObserveResult) return null;

  const r = activeObserveResult;
  const mon = r.monster;
  const pl = r.player;

  const hpPct =
    mon && mon.maxHp && mon.hp !== null
      ? Math.max(0, Math.min(100, (Number(mon.hp) / Number(mon.maxHp)) * 100))
      : 0;
  const plHpPct =
    pl && pl.maxHp ? Math.max(0, Math.min(100, (Number(pl.hp) / Number(pl.maxHp)) * 100)) : 0;

  return (
    <div
      id="observe-result-modal"
      className="modal-backdrop open observe-modal-backdrop"
      style={{ zIndex: 9065 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="observe-modal-title"
      onClick={() => setActiveObserveResult(null)}
    >
      <div className="modal-card observe-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="observe-modal-head">
          <div className={`observe-modal-avatar is-${r.kind}`}>
            {r.kind === 'monster' || r.kind === 'npc' ? (
              <TokenIconSvg
                type={r.kind}
                name={r.title}
                iconId={mon?.iconId ?? r.iconId}
                size={42}
              />
            ) : r.kind === 'player' && pl?.portraitUrl ? (
              <img
                src={pl.portraitUrl}
                alt={r.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '12px' }}
              />
            ) : (
              <span className="observe-modal-glyph" aria-hidden="true">
                {r.kind === 'chest' ? '📦' : r.kind === 'player' ? '🛡️' : '🧭'}
              </span>
            )}
          </div>
          <div className="observe-modal-title-wrap">
            <div className="observe-modal-badges">
              <span className="tag tag-cyan">OBSERVED</span>
              <span className="tag tag-outline">
                ({r.x + 1}, {r.y + 1})
              </span>
              {r.subtitle && <span className="tag tag-gold">{r.subtitle}</span>}
            </div>
            <h2 id="observe-modal-title" className="observe-modal-title">
              {r.title}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-outline observe-modal-x"
            aria-label="Close Observe Details"
            onClick={() => setActiveObserveResult(null)}
          >
            &times;
          </button>
        </div>

        {r.kind === 'monster' && mon && (
          <>
            <div className={`observe-weakspot-banner ${r.weakSpotFound ? 'is-found' : 'is-missed'}`}>
              {r.weakSpotFound ? (
                <>
                  <strong>WEAK SPOT UNCOVERED!</strong>
                  <span>
                    PER check succeeded ({r.rollPct}/{r.successChancePct}%): +{r.bonusDamage} Damage
                    &amp; +{r.bonusCritDamage} Crit Damage (Floor {r.floor}F).
                  </span>
                </>
              ) : (
                <>
                  <strong>INTEL GATHERED</strong>
                  <span>
                    Stats &amp; HP revealed to you. Weak spot missed ({r.rollPct ?? '?'}/
                    {r.successChancePct ?? '?'}% via PER).
                  </span>
                </>
              )}
            </div>

            {mon.maxHp && mon.hp !== null && (
              <div className="observe-hp-card">
                <div className="observe-hp-top">
                  <span className="observe-hp-label">MONSTER HP</span>
                  <span className="observe-hp-nums">
                    <strong>
                      {mon.hp}/{mon.maxHp}
                    </strong>{' '}
                    {mon.healthTier && (
                      <span className="tag tag-crimson small">{mon.healthTier}</span>
                    )}
                  </span>
                </div>
                <SegmentedBar
                  pct={hpPct}
                  maxValue={mon.maxHp ?? 0}
                  ticks={mon.hpBarTicks}
                  kind="monster"
                  fillKind="monster"
                />
              </div>
            )}

            <div className="observe-stat-grid">
              <div className="observe-stat-tile">
                <span className="observe-stat-k">AC</span>
                <strong className="observe-stat-v">{mon.ac}</strong>
              </div>
              <div className="observe-stat-tile">
                <span className="observe-stat-k">DR</span>
                <strong className="observe-stat-v">{mon.dr}</strong>
              </div>
              <div className="observe-stat-tile">
                <span className="observe-stat-k">ATTACK</span>
                <strong className="observe-stat-v">{mon.attackFormula || '—'}</strong>
              </div>
              <div className="observe-stat-tile">
                <span className="observe-stat-k">DAMAGE</span>
                <strong className="observe-stat-v">{mon.damageFormula || '—'}</strong>
              </div>
            </div>

            <div className="btn-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
              <span className="tag tag-outline small">
                Range: {mon.rangeSpaces || 1} Sp
              </span>
              {mon.floor && (
                <span className="tag tag-gold small">{mon.floor}F Monster</span>
              )}
              {(mon.activeEffects || []).map((eff) => (
                <span
                  key={eff.id}
                  className={`tag small ${eff.category === 'buff' ? 'tag-green' : 'tag-crimson'}`}
                >
                  {formatActiveUnitEffect(eff)}
                </span>
              ))}
            </div>

            {Array.isArray(mon.skills) && mon.skills.length > 0 && (
              <div className="observe-skills-box">
                <div className="observe-skills-label">KNOWN SKILLS</div>
                <div className="list-stack" style={{ gap: '6px' }}>
                  {mon.skills.map((sk) => (
                    <div key={sk.id} className="item-card small" style={{ padding: '6px 10px' }}>
                      <div className="item-card-top">
                        <strong>{sk.name}</strong>
                        <span className="tag tag-crimson small">{sk.damageFormula}</span>
                      </div>
                      {sk.description && (
                        <div className="small muted" style={{ marginTop: '2px' }}>
                          {sk.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {r.kind === 'player' && (
          <div className="stack" style={{ gap: '10px' }}>
            {pl ? (
              <>
                <div className="observe-hp-card">
                  <div className="observe-hp-top">
                    <span className="observe-hp-label">ALLY VITALITY</span>
                    <span className="observe-hp-nums">
                      <strong>
                        {pl.hp}/{pl.maxHp} HP
                      </strong>
                    </span>
                  </div>
                  <SegmentedBar
                    pct={plHpPct}
                    maxValue={pl.maxHp}
                    kind="hp"
                    fillKind="hp"
                    critical={plHpPct > 0 && plHpPct <= 20}
                  />
                </div>
                <div className="observe-stat-grid">
                  <div className="observe-stat-tile">
                    <span className="observe-stat-k">LEVEL</span>
                    <strong className="observe-stat-v">Lv {pl.level}</strong>
                  </div>
                  <div className="observe-stat-tile">
                    <span className="observe-stat-k">AC / DR</span>
                    <strong className="observe-stat-v">
                      {pl.ac} / {pl.dr || 0}
                    </strong>
                  </div>
                </div>
                {pl.equipment?.mainHand && (
                  <div className="observe-detail-box">
                    Weapon: <strong>{pl.equipment.mainHand.name}</strong>
                  </div>
                )}
              </>
            ) : (
              <div className="observe-detail-box">{r.description}</div>
            )}
          </div>
        )}

        {(r.kind === 'npc' || r.kind === 'chest' || r.kind === 'terrain') && (
          <div className="observe-detail-box">
            <p style={{ margin: 0 }}>{r.description}</p>
            {r.rollTotal !== undefined && (
              <div className="small muted" style={{ marginTop: '8px' }}>
                PER Check: <strong style={{ color: '#7dd3fc' }}>{r.rollTotal}</strong> (
                {r.rollFormula || '1d20'})
              </div>
            )}
          </div>
        )}

        <div className="observe-modal-footer">
          <button
            type="button"
            id="btn-close-observe-modal"
            className="btn btn-sm btn-cyan"
            onClick={() => setActiveObserveResult(null)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
