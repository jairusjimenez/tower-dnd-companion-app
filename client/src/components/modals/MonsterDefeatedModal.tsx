import { formatItemCategory, getItemCategoryTagClass, getItemTierTagClass } from '@shared/index';
import { useVtt } from '../../context/VttContext';

export function MonsterDefeatedModal() {
  const { defeatedMonster, setDefeatedMonster } = useVtt();

  if (!defeatedMonster) return null;

  return (
    <div id="monster-defeated-modal" className="modal-backdrop" onClick={() => setDefeatedMonster(null)}>
      <div
        className="modal-card card-glow-gold"
        style={{ maxWidth: '480px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <div>
            <div className="badge-tower mb-xs" style={{ color: '#fbbf24' }}>
              VICTORY SPOILS • {defeatedMonster.floor}F
            </div>
            <h3 style={{ margin: 0 }}>MONSTER DEFEATED</h3>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            onClick={() => setDefeatedMonster(null)}
          >
            Close
          </button>
        </div>

        <div className="stack-form">
          <div className="item-card" style={{ borderColor: 'rgba(251, 191, 36, 0.45)' }}>
            <div className="item-card-top">
              <strong>{defeatedMonster.monsterName}</strong>
              <span className="tag tag-crimson">SLAIN BY {defeatedMonster.killerName.toUpperCase()}</span>
            </div>
            {defeatedMonster.leveledUp && (
              <div className="small mt-xs" style={{ color: '#4ade80' }}>
                <strong>LEVEL UP!</strong> Reached Level {defeatedMonster.newLevel}! (+Stat Points &amp; +1 Passive Ticket)
              </div>
            )}
          </div>

          <div className="grid-3">
            <div className="mini-box" style={{ textAlign: 'center' }}>
              <span>Experience</span>
              <strong style={{ color: '#c084fc' }}>+{defeatedMonster.xpGained} XP</strong>
              <small className="muted">Awarded</small>
            </div>
            <div className="mini-box" style={{ textAlign: 'center' }}>
              <span>Gold</span>
              <strong style={{ color: '#fbbf24' }}>+{defeatedMonster.goldGained} G</strong>
              <small className="muted">Collected</small>
            </div>
            <div className="mini-box" style={{ textAlign: 'center' }}>
              <span>Mana Stones</span>
              <strong style={{ color: '#38bdf8' }}>
                {defeatedMonster.manaStonesGained > 0
                  ? `+${defeatedMonster.manaStonesGained}`
                  : defeatedMonster.manaStoneDroppedOnMap
                    ? 'On Map'
                    : '0'}
              </strong>
              <small className="muted">
                {defeatedMonster.manaStoneDroppedOnMap ? 'Walk to pick up' : 'Claimed'}
              </small>
            </div>
          </div>

          <div className="item-card">
            <div className="small muted" style={{ marginBottom: '6px' }}>
              <strong>Loot Drops ({defeatedMonster.items.length})</strong>
            </div>
            {defeatedMonster.items.length > 0 ? (
              <div className="list-stack" style={{ gap: '6px' }}>
                {defeatedMonster.items.map((item, idx) => (
                  <div key={`${item.name}-${idx}`} className="item-card-top">
                    <span>
                      <strong>{item.name}</strong>{' '}
                      <span className={`tag ${getItemTierTagClass(item.tier)}`}>
                        {item.tier || 'Common'}
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
              <div className="small muted">No item drops this time — Gold &amp; XP awarded!</div>
            )}
          </div>

          <button
            type="button"
            className="btn btn-gold btn-lg"
            onClick={() => setDefeatedMonster(null)}
          >
            Claim Rewards &amp; Continue
          </button>
        </div>
      </div>
    </div>
  );
}
