import { useEffect, useState } from 'react';
import { formatItemCategory, getItemCategoryTagClass, getItemTierTagClass } from '@shared/index';
import { useVtt } from '../../context/VttContext';

const TIER_COLORS: Record<string, { border: string; glow: string; tag: string; accent: string; body: string; lid: string }> = {
  Common: { border: '#d97706', glow: 'rgba(217, 119, 6, 0.45)', tag: 'tag-gold', accent: '#f59e0b', body: '#78350f', lid: '#92400e' },
  Uncommon: { border: '#34d399', glow: 'rgba(52, 211, 153, 0.45)', tag: 'tag-green', accent: '#34d399', body: '#065f46', lid: '#047857' },
  Rare: { border: '#38bdf8', glow: 'rgba(56, 189, 248, 0.5)', tag: 'tag-cyan', accent: '#38bdf8', body: '#075985', lid: '#0369a1' },
  Epic: { border: '#c084fc', glow: 'rgba(192, 132, 252, 0.55)', tag: 'tag-purple', accent: '#c084fc', body: '#581c87', lid: '#6b21a8' },
  Legendary: { border: '#fbbf24', glow: 'rgba(251, 191, 36, 0.65)', tag: 'tag-gold', accent: '#fbbf24', body: '#92400e', lid: '#b45309' },
  Mythic: { border: '#fb7185', glow: 'rgba(251, 113, 133, 0.7)', tag: 'tag-crimson', accent: '#fb7185', body: '#881337', lid: '#9f1239' },
};

export function ChestRevealModal() {
  const { chestReveal, setChestReveal } = useVtt();
  const [phase, setPhase] = useState<'shaking' | 'revealed'>('shaking');

  useEffect(() => {
    if (!chestReveal) return;
    setPhase('shaking');
    const timer = window.setTimeout(() => setPhase('revealed'), 1800);
    return () => window.clearTimeout(timer);
  }, [chestReveal]);

  if (!chestReveal) return null;

  const pal = TIER_COLORS[chestReveal.tier || 'Common'] || TIER_COLORS.Common;

  return (
    <div id="chest-reveal-modal" className="modal-backdrop" onClick={() => setChestReveal(null)}>
      <div
        className="modal-card"
        style={{
          maxWidth: '480px',
          borderColor: pal.border,
          boxShadow: `0 0 36px ${pal.glow}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <div>
            <div className="badge-tower mb-xs" style={{ color: pal.accent }}>
              {chestReveal.tier.toUpperCase()} TREASURE CHEST
            </div>
            <h3 style={{ margin: 0 }}>{phase === 'shaking' ? 'UNLOCKING CHEST...' : 'TREASURE REVEALED!'}</h3>
          </div>
          <button type="button" className="btn btn-xs btn-outline" onClick={() => setChestReveal(null)}>
            Close
          </button>
        </div>

        {phase === 'shaking' ? (
          <div className="stack-form" style={{ alignItems: 'center', padding: '24px 12px', textAlign: 'center' }}>
            <div
              className="chest-anim-stage"
              style={{
                filter: `drop-shadow(0 0 20px ${pal.glow})`,
              }}
            >
              <svg viewBox="0 0 80 68" width="112" height="96" aria-hidden="true">
                <rect x="10" y="28" width="60" height="32" rx="5" fill={pal.body} stroke={pal.accent} strokeWidth="3" />
                <path d="M12 28 C12 12, 68 12, 68 28 Z" fill={pal.lid} stroke={pal.accent} strokeWidth="3" />
                <rect x="10" y="34" width="60" height="6" fill={pal.accent} />
                <rect x="34" y="29" width="12" height="16" rx="2" fill={pal.accent} stroke="#0f172a" strokeWidth="2" />
              </svg>
            </div>
            <div className="small muted">
              Opening <strong>{chestReveal.chestName}</strong> for {chestReveal.openerName}...
            </div>
            <button type="button" className="btn btn-xs btn-outline" onClick={() => setPhase('revealed')}>
              Skip Animation
            </button>
          </div>
        ) : (
          <div className="stack-form chest-reveal-pop">
            <div className="item-card" style={{ borderColor: pal.border }}>
              <div className="item-card-top">
                <strong>
                  {chestReveal.chestName}{' '}
                  <span className={`tag ${pal.tag}`}>{chestReveal.tier}</span>
                </strong>
                <span className="small muted">Opened by {chestReveal.openerName}</span>
              </div>
            </div>

            <div className="grid-2">
              <div className="mini-box" style={{ textAlign: 'center' }}>
                <span>Gold</span>
                <strong style={{ color: '#fbbf24' }}>+{chestReveal.goldGained} G</strong>
                <small className="muted">
                  {(chestReveal.passiveBonusGold || 0) > 0
                    ? `Base ${chestReveal.baseGold ?? chestReveal.goldGained}G + ${chestReveal.passiveBonusGold}G Passive`
                    : 'Collected'}
                </small>
              </div>
              <div className="mini-box" style={{ textAlign: 'center' }}>
                <span>Mana Stones</span>
                <strong style={{ color: '#38bdf8' }}>+{chestReveal.manaStonesGained}</strong>
                <small className="muted">Claimed</small>
              </div>
            </div>

            {chestReveal.passiveTriggers && chestReveal.passiveTriggers.length > 0 && (
              <div className="item-card" style={{ borderColor: 'rgba(251, 191, 36, 0.45)' }}>
                <div className="small muted" style={{ marginBottom: '6px' }}>
                  <strong>Passive Chest Skills Triggered ({chestReveal.passiveTriggers.length})</strong>
                </div>
                <div className="list-stack" style={{ gap: '4px' }}>
                  {chestReveal.passiveTriggers.map((pt, idx) => (
                    <div key={`${pt.skillName}-${idx}`} className="item-card-top">
                      <span>
                        <strong>{pt.skillName}</strong>{' '}
                        <span className="tag tag-gold">{pt.tier}</span>{' '}
                        <span className="small muted">{pt.effectText}</span>
                      </span>
                      <span className="tag tag-cyan">+{pt.bonusGold} G</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="item-card">
              <div className="small muted" style={{ marginBottom: '6px' }}>
                <strong>Chest Loot ({chestReveal.items.length})</strong>
              </div>
              {chestReveal.items.length > 0 ? (
                <div className="list-stack" style={{ gap: '6px' }}>
                  {chestReveal.items.map((item, idx) => (
                    <div key={`${item.name}-${idx}`} className="item-card-top">
                      <span>
                        <strong>{item.name}</strong>{' '}
                        <span className={`tag ${getItemTierTagClass(item.tier || chestReveal.tier)}`}>
                          {item.tier || chestReveal.tier}
                        </span>{' '}
                        <span className={`tag ${getItemCategoryTagClass(item.category)}`}>
                          {formatItemCategory(item.category)}
                        </span>
                      </span>
                      {item.notes && <span className="small muted">{item.notes}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="small muted">Gold &amp; Mana Stones collected!</div>
              )}
            </div>

            <button type="button" className="btn btn-gold btn-lg" onClick={() => setChestReveal(null)}>
              Claim Chest Loot
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
