import { useMemo } from 'react';
import { computeStatModifier } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { DiabloEquipmentGrid } from '../common/DiabloEquipmentGrid';

export function DmCharModal() {
  const { dmCharModalId, setDmCharModalId, state } = useVtt();
  const ch = dmCharModalId && state?.characters ? state.characters[dmCharModalId] : undefined;

  const uniqueHistory = useMemo(() => {
    const seen = new Set<string>();
    return (ch?.artHistory || []).filter((entry) => {
      if (!entry?.url || seen.has(entry.url)) return false;
      seen.add(entry.url);
      return true;
    });
  }, [ch?.artHistory]);

  if (!dmCharModalId || !state || !ch) return null;

  const charHistory = (
    ch.history && ch.history.length > 0
      ? ch.history
      : (state.playerHistory || []).filter((entry) => entry.characterId === ch.id)
  ).slice(0, 20);

  return (
    <div
      id="dm-char-modal"
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) setDmCharModalId(null);
      }}
    >
      <div className="modal-card modal-char-profile">
        <div className="panel-header">
          <div>
            <h3 id="dm-char-modal-title">{ch.name}</h3>
            <p id="dm-char-modal-sub" className="muted small">
              Lv {ch.level} {ch.race} {ch.className} • HP {ch.hp}/{ch.maxHp} • MP {ch.mp}/{ch.maxMp} • AC {ch.ac} • DR {ch.dr || 0}
            </p>
          </div>
          <button
            type="button"
            id="btn-close-dm-char"
            className="btn btn-xs btn-outline"
            onClick={() => setDmCharModalId(null)}
          >
            &times;
          </button>
        </div>

        <div id="dm-char-modal-body" className="two-col mt-xs">
          <div className="col stack">
            <div className="panel">
              <div className="panel-subheader">
                <span>Portrait &amp; Core Stats</span>
                <span className="tag tag-cyan">{ch.rank || 'E-Rank'}</span>
              </div>
              <div className="portrait-stage mb-xs">
                <img className="portrait-lg" src={ch.portraitUrl || ''} alt={ch.name} />
              </div>

              {uniqueHistory.length > 0 && (
                <div className="art-thumbs mt-xs">
                  {uniqueHistory.map((entry) => {
                    const isCurrent = entry.url === ch.portraitUrl;
                    return (
                      <img
                        key={entry.id}
                        className="art-thumb"
                        src={entry.url}
                        alt={entry.prompt || entry.style || 'Portrait'}
                        title={entry.prompt || entry.style || 'Portrait'}
                        style={isCurrent ? { border: '2px solid #38bdf8', boxShadow: '0 0 8px rgba(56,189,248,0.5)' } : undefined}
                      />
                    );
                  })}
                </div>
              )}

              <div className="stat-pills mt-xs">
                {Object.entries(ch.stats || {}).map(([k, v]) => {
                  const mod = computeStatModifier(Number(v), state.mechanics, ch);
                  return (
                    <span key={k} className="stat-pill">
                      {k}: <b>{v}</b> ({mod >= 0 ? `+${mod}` : mod})
                    </span>
                  );
                })}
              </div>

              <div className="currency-pills mt-xs">
                <span className="pill-gold">Gold: <b>{ch.currency?.gold ?? 0}</b></span>
                <span className="pill-cyan">Mana Stones: <b>{ch.currency?.manaStones ?? 0}</b></span>
                <span className="tag tag-purple">Favor: {ch.favor ?? 0}</span>
              </div>
            </div>

            <div className="panel">
              <div className="panel-subheader">
                <span>Passives ({ch.passives?.length || 0})</span>
              </div>
              {ch.passives && ch.passives.length > 0 ? (
                <div className="list-stack">
                  {ch.passives.map((p) => (
                    <div key={p.id} className="item-card">
                      <div className="item-card-top">
                        <strong>{p.name}</strong>
                        <span className="tag tag-cyan">{p.tier}{(p.stacks || 1) > 1 ? ` x${p.stacks}` : ''}</span>
                      </div>
                      <p className="muted small" style={{ margin: '2px 0 0' }}>{p.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted small">No passives unlocked yet.</p>
              )}
            </div>
          </div>

          <div className="col stack">
            <div className="panel">
              <div className="panel-subheader"><span>Equipped Gear</span></div>
              <div className="d2-equip-grid">
                <DiabloEquipmentGrid equipment={ch.equipment} />
              </div>
            </div>

            <div className="panel">
              <div className="panel-subheader"><span>Inventory ({ch.inventory?.length || 0})</span></div>
              {ch.inventory && ch.inventory.length > 0 ? (
                <div className="list-stack">
                  {ch.inventory.map((it) => (
                    <div key={it.id} className="item-card">
                      <div className="item-card-top">
                        <strong>{it.name}</strong>
                        <span className="tag">x{it.qty || 1} • {it.category}</span>
                      </div>
                      {it.notes && <p className="muted small" style={{ margin: '2px 0 0' }}>{it.notes}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted small">Inventory is empty.</p>
              )}
            </div>

            <div className="panel">
              <div className="panel-subheader"><span>Recent Activity Log</span></div>
              <div className="feed-list">
                {charHistory.length > 0 ? (
                  charHistory.map((h) => (
                    <div key={h.id} className="feed-entry">
                      <span className="muted small">[{h.category}]</span> {h.summary}
                    </div>
                  ))
                ) : (
                  <p className="muted small">No recorded activity for this character yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
