import React, { useEffect, useState } from 'react';
import { useVtt } from '../../context/VttContext';
import { InventoryItemSvg } from '../common/EquipmentIcons';

export function TradeModal() {
  const { tradeItemId, setTradeItemId, session, state, sendAction } = useVtt();
  const [targetCharId, setTargetCharId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);

  const ch = session?.characterId ? state?.characters?.[session.characterId] : undefined;
  const item = ch?.inventory?.find((i) => i.id === tradeItemId);
  const maxQty = Math.max(1, Number(item?.qty || 1));

  useEffect(() => {
    if (tradeItemId) {
      setTargetCharId(null);
      setQty(1);
    }
  }, [tradeItemId]);

  if (!tradeItemId || !ch || !item) return null;

  const recipients = Object.values(state?.characters || {}).filter((c) => c.id !== ch.id);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!targetCharId || qty <= 0) return;
    await sendAction('inventory_action', {
      subAction: 'trade',
      characterId: ch.id,
      targetCharacterId: targetCharId,
      itemId: item.id,
      qty,
    });
    setTradeItemId(null);
  };

  return (
    <div id="p-trade-modal" className="modal-backdrop">
      <div className="modal-card card-glow-cyan">
        <div className="panel-header">
          <h3>Trade Item</h3>
          <button
            type="button"
            id="btn-close-trade-modal"
            className="btn btn-xs btn-outline"
            onClick={() => setTradeItemId(null)}
          >
            &times;
          </button>
        </div>

        <div id="p-trade-item-info" className="trade-item-preview mt-xs">
          <div className="d2-inv-icon">
            <InventoryItemSvg item={item} />
          </div>
          <div>
            <strong>{item.name}</strong>
            <div className="small muted">
              {item.category || 'item'} • Available: {maxQty}
            </div>
          </div>
        </div>

        <form id="p-trade-form" className="stack-form mt-sm" onSubmit={handleSubmit}>
          <div>
            <span className="small muted">Trade To Player</span>
            <div id="p-trade-players" className="trade-player-grid mt-xs">
              {recipients.length === 0 ? (
                <div className="muted small">No other players are registered yet.</div>
              ) : (
                recipients.map((rec) => {
                  const initials = rec.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);
                  return (
                    <button
                      key={rec.id}
                      type="button"
                      className={`trade-player-card ${targetCharId === rec.id ? 'active' : ''}`}
                      onClick={() => setTargetCharId(rec.id)}
                    >
                      {rec.portraitUrl ? (
                        <img src={rec.portraitUrl} alt={rec.name} />
                      ) : (
                        <div className="trade-player-avatar">{initials || 'PL'}</div>
                      )}
                      <span className="trade-player-name">{rec.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <span className="small muted">Quantity</span>
            <div className="trade-qty-bar mt-xs">
              <button
                type="button"
                id="btn-trade-qty-minus"
                className="btn btn-sm btn-outline"
                disabled={qty <= 0}
                onClick={() => setQty((q) => Math.max(0, q - 1))}
              >
                -
              </button>
              <strong id="p-trade-qty-readout">{qty}/{maxQty}</strong>
              <button
                type="button"
                id="btn-trade-qty-plus"
                className="btn btn-sm btn-outline"
                disabled={qty >= maxQty}
                onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
              >
                +
              </button>
            </div>
          </div>

          <button type="submit" id="btn-trade-send" className="btn btn-cyan btn-lg" disabled={qty <= 0 || !targetCharId}>
            Send Item
          </button>
        </form>
      </div>
    </div>
  );
}
