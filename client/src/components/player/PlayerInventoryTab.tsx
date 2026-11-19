import { useState } from 'react';
import { getEquippedTotals, isStatsAndEquipmentLocked, type Character } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { DiabloEquipmentGrid } from '../common/DiabloEquipmentGrid';
import { InventoryItemSvg } from '../common/EquipmentIcons';

export function PlayerInventoryTab({ ch }: { ch: Character }) {
  const { state, sendAction, pushLocalToast, setTradeItemId } = useVtt();
  const [invFilter, setInvFilter] = useState<'all' | 'weapon' | 'armor' | 'consumable' | 'relic'>('all');

  if (!state) return null;

  const isBuildLocked = isStatsAndEquipmentLocked(state);
  const totals = getEquippedTotals(ch);
  const eqTotalsParts = [
    isBuildLocked ? 'Locked (Active Story Beat)' : '',
    `+${totals.armorAc} Armor Class`,
    `+${totals.armorDr} Damage Reduction`,
    totals.attackBonus ? `+${totals.attackBonus} Attack` : '',
  ].filter(Boolean);

  const invItems = (ch.inventory || []).filter((i) => invFilter === 'all' || i.category === invFilter);
  const minCells = Math.max(8, Math.ceil(invItems.length / 4) * 4);
  const emptyCellsCount = Math.max(0, minCells - invItems.length);

  return (
    <div className="two-col">
      <div className="panel card-glow-gold">
        <div className="panel-header">
          <h3>Equipped Gear</h3>
          <span id="p-bag-equip-totals" className="tag tag-gold">
            {eqTotalsParts.join(' • ')}
          </span>
        </div>
        <div id="p-bag-equip-grid" className="d2-equip-grid">
          <DiabloEquipmentGrid
            equipment={ch.equipment}
            showActions
            locked={isBuildLocked}
            onUnequip={(slot) => sendAction('equipment_action', { characterId: ch.id, subAction: 'unequip', slot })}
          />
        </div>
      </div>

      <div className="panel card-glow-cyan">
        <div className="panel-header">
          <h3>Inventory</h3>
          <div className="currency-pills">
            <span className="pill-gold">
              Gold: <b id="p-gold-val">{ch.currency?.gold ?? 0}</b>
            </span>
            <span className="pill-cyan" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <defs>
                  <linearGradient id="msGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="50%" stopColor="#bae6fd" />
                    <stop offset="100%" stopColor="#0284c7" />
                  </linearGradient>
                </defs>
                <polygon points="12,2 19,8 17,17 12,22 7,17 5,8" fill="url(#msGrad)" stroke="#e0f2fe" strokeWidth="1.5" />
                <polygon points="12,3 6.5,8.5 12,13" fill="#ffffff" fillOpacity="0.7" />
              </svg>
              Mana Stones: <b id="p-stones-val">{ch.currency?.manaStones ?? 0}</b>
            </span>
          </div>
        </div>

        <div className="filter-pills" id="inv-filter-pills">
          {(
            [
              { key: 'all', label: 'All' },
              { key: 'weapon', label: 'Weapons' },
              { key: 'armor', label: 'Armor' },
              { key: 'consumable', label: 'Potions' },
              { key: 'relic', label: 'Relics' },
            ] as const
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip-btn readonly-allow ${invFilter === f.key ? 'active' : ''}`}
              onClick={() => setInvFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div id="p-inventory-list" className="d2-inv-grid mt-sm">
          {invItems.map((it) => {
            const isEquippable = it.category !== 'consumable' && it.category !== 'skill_book';
            return (
              <div
                key={it.id}
                className="d2-inv-cell filled"
                title={`${it.name}${it.notes ? ` — ${it.notes}` : ''}`}
              >
                <span className="d2-inv-qty">×{it.qty || 1}</span>
                <div className="d2-inv-icon">
                  <InventoryItemSvg item={it} />
                </div>
                <div className="d2-slot-name">{it.name}</div>
                <div className="d2-slot-meta">
                  {it.category || 'item'}
                  {it.damageDice ? ` • ${it.damageDice}` : ''}
                  {it.drBonus ? ` • +${it.drBonus} DR` : ''}
                </div>
                <div className="btn-row mt-xs" style={{ justifyContent: 'center' }}>
                  {it.category === 'consumable' && (
                    <button
                      type="button"
                      className="btn btn-xs btn-cyan"
                      onClick={() => sendAction('inventory_action', { characterId: ch.id, subAction: 'use_consumable', itemId: it.id })}
                    >
                      Use
                    </button>
                  )}
                  {isEquippable && (
                    <button
                      type="button"
                      className="btn btn-xs btn-gold"
                      disabled={isBuildLocked}
                      title={isBuildLocked ? 'Locked while session and story beat are active' : undefined}
                      onClick={() => sendAction('equipment_action', { characterId: ch.id, subAction: 'equip', itemId: it.id })}
                    >
                      Equip
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-xs btn-outline"
                    onClick={() => {
                      const others = Object.values(state.characters || {}).filter((o) => o.id !== ch.id);
                      if (!others.length) {
                        pushLocalToast({ title: 'NO PLAYERS', message: 'No other players available to trade with.', category: 'warning' });
                        return;
                      }
                      setTradeItemId(it.id);
                    }}
                  >
                    Trade
                  </button>
                </div>
              </div>
            );
          })}
          {Array.from({ length: emptyCellsCount }, (_, i) => (
            <div key={`empty-${i}`} className="d2-inv-cell empty" />
          ))}
        </div>
      </div>
    </div>
  );
}
