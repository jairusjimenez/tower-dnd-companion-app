import React, { useState } from 'react';
import {
  CHEST_TIERS,
  CHEST_TIER_LOOT_TABLES,
  buildChestLootPreview,
  formatItemCategory,
  getChestDefaultsForFloor,
  getItemCategoryTagClass,
  getItemTierTagClass,
  type BestiaryLootDrop,
  type ChestTier,
  type ChestTierConfig,
} from '@shared/index';
import { useVtt } from '../../context/VttContext';

const CHEST_SVG_COLORS: Record<ChestTier, { body: string; lid: string; accent: string }> = {
  Common: { body: '#78350f', lid: '#92400e', accent: '#f59e0b' },
  Uncommon: { body: '#065f46', lid: '#047857', accent: '#34d399' },
  Rare: { body: '#075985', lid: '#0369a1', accent: '#38bdf8' },
  Epic: { body: '#581c87', lid: '#6b21a8', accent: '#c084fc' },
  Legendary: { body: '#92400e', lid: '#b45309', accent: '#fbbf24' },
  Mythic: { body: '#881337', lid: '#9f1239', accent: '#fb7185' },
};

export function DmChestsTab() {
  const { state, sendAction, pushLocalToast, setChestReveal } = useVtt();

  const [previewFloor, setPreviewFloor] = useState(1);
  const [selectedTier, setSelectedTier] = useState<ChestTier>('Common');

  // Tier Loot Table Editor state
  const getTierCfg = (tier: ChestTier): ChestTierConfig => {
    const custom = state?.chestCatalog?.[tier];
    if (custom) return custom;
    const def = CHEST_TIER_LOOT_TABLES[tier];
    return {
      tier,
      minItems: def.minItems,
      maxItems: def.maxItems,
      baseGold: def.baseGold,
      baseManaStones: def.baseManaStones,
      pool: def.pool.map((d) => ({ ...d, tier: d.tier || tier })),
    };
  };

  const initialCfg = getTierCfg('Common');
  const [baseGold, setBaseGold] = useState(initialCfg.baseGold);
  const [baseManaStones, setBaseManaStones] = useState(initialCfg.baseManaStones);
  const [minItems, setMinItems] = useState(initialCfg.minItems);
  const [maxItems, setMaxItems] = useState(initialCfg.maxItems);
  const [pool, setPool] = useState<BestiaryLootDrop[]>(initialCfg.pool);

  const [newItemName, setNewItemName] = useState('');
  const [newItemCat, setNewItemCat] = useState<BestiaryLootDrop['category']>('weapon');
  const [newItemTier, setNewItemTier] = useState<ChestTier>('Common');
  const [newItemNotes, setNewItemNotes] = useState('');

  // Placed Beat Chest Editor state
  const [editingPlaced, setEditingPlaced] = useState<{
    beatId: string;
    beatTitle: string;
    chestId: string;
    name: string;
    tier: ChestTier;
    gold: number;
    manaStones: number;
    itemName: string;
    itemCategory: string;
  } | null>(null);

  if (!state) return null;

  const loadTierIntoEditor = (tier: ChestTier) => {
    setEditingPlaced(null);
    setSelectedTier(tier);
    const cfg = getTierCfg(tier);
    setBaseGold(cfg.baseGold);
    setBaseManaStones(cfg.baseManaStones);
    setMinItems(cfg.minItems);
    setMaxItems(cfg.maxItems);
    setPool(cfg.pool.map((d) => ({ ...d, tier: d.tier || tier })));
    setNewItemTier(tier);
  };

  const handleSaveTierTable = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const res = await sendAction<{ ok?: boolean }>('chest_catalog_action', {
      subAction: 'update_tier',
      tier: selectedTier,
      baseGold,
      baseManaStones,
      minItems,
      maxItems,
      pool,
    });
    if (res?.ok) {
      pushLocalToast({
        title: 'CHEST LOOT TABLE UPDATED',
        message: `Saved ${selectedTier} Chest loot table (${pool.length} items).`,
        category: 'loot',
      });
    }
  };

  const handleSavePlacedChest = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!editingPlaced) return;
    const res = await sendAction<{ ok?: boolean }>('story_action', {
      subAction: 'update_beat_chest',
      beatId: editingPlaced.beatId,
      chestId: editingPlaced.chestId,
      name: editingPlaced.name,
      tier: editingPlaced.tier,
      gold: editingPlaced.gold,
      manaStones: editingPlaced.manaStones,
      itemName: editingPlaced.itemName,
      itemCategory: editingPlaced.itemCategory,
    });
    if (res?.ok) {
      pushLocalToast({
        title: 'TREASURE CHEST UPDATED',
        message: `Updated ${editingPlaced.name} on ${editingPlaced.beatTitle}.`,
        category: 'loot',
      });
      setEditingPlaced(null);
    }
  };

  const placedChests = (state.storyBeats || []).flatMap((b) =>
    (b.arena?.chests || []).map((c) => ({
      beatId: b.id,
      beatTitle: b.title,
      floor: b.floor || 1,
      chest: c,
    })),
  );

  return (
    <div className="two-col">
      <div className="col stack">
        {editingPlaced ? (
          <div className="panel card-glow-gold">
            <div className="panel-header">
              <h3>Edit Placed Chest: {editingPlaced.name}</h3>
              <button type="button" className="btn btn-xs btn-outline" onClick={() => setEditingPlaced(null)}>
                Back to Tier Editor
              </button>
            </div>
            <form className="stack-form" onSubmit={handleSavePlacedChest}>
              <div className="small muted">Story Beat: <strong>{editingPlaced.beatTitle}</strong></div>
              <div className="grid-2">
                <label>
                  <span>Chest Name</span>
                  <input
                    type="text"
                    required
                    value={editingPlaced.name}
                    onChange={(e) => setEditingPlaced({ ...editingPlaced, name: e.target.value })}
                  />
                </label>
                <label>
                  <span>Chest Tier</span>
                  <select
                    value={editingPlaced.tier}
                    onChange={(e) => setEditingPlaced({ ...editingPlaced, tier: e.target.value as ChestTier })}
                  >
                    {CHEST_TIERS.map((ct) => (
                      <option key={ct} value={ct}>{ct} Tier</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid-2">
                <label>
                  <span>Gold Inside</span>
                  <input
                    type="number"
                    min={0}
                    value={editingPlaced.gold}
                    onChange={(e) => setEditingPlaced({ ...editingPlaced, gold: Math.max(0, Number(e.target.value || 0)) })}
                  />
                </label>
                <label>
                  <span>Mana Stones Inside</span>
                  <input
                    type="number"
                    min={0}
                    value={editingPlaced.manaStones}
                    onChange={(e) => setEditingPlaced({ ...editingPlaced, manaStones: Math.max(0, Number(e.target.value || 0)) })}
                  />
                </label>
              </div>
              <div className="grid-2">
                <label>
                  <span>Guaranteed Bonus Item Inside (opt.)</span>
                  <input
                    type="text"
                    placeholder="e.g. Black March Needle"
                    value={editingPlaced.itemName}
                    onChange={(e) => setEditingPlaced({ ...editingPlaced, itemName: e.target.value })}
                  />
                </label>
                <label>
                  <span>Bonus Item Category</span>
                  <select
                    value={editingPlaced.itemCategory}
                    onChange={(e) => setEditingPlaced({ ...editingPlaced, itemCategory: e.target.value })}
                  >
                    <option value="weapon">Weapon</option>
                    <option value="armor">Armor</option>
                    <option value="relic">Relic</option>
                    <option value="skill_book">Skill Book</option>
                    <option value="consumable">Consumable</option>
                    <option value="material">Material</option>
                  </select>
                </label>
              </div>
              <button type="submit" className="btn btn-gold btn-lg">
                Save Placed Chest Changes
              </button>
            </form>
          </div>
        ) : (
          <div className="panel card-glow-gold">
            <div className="panel-header">
              <h3>Edit {selectedTier} Chest Loot Table</h3>
              <button
                type="button"
                className="btn btn-xs btn-outline"
                onClick={async () => {
                  await sendAction('chest_catalog_action', { subAction: 'reset_tier', tier: selectedTier });
                  const def = CHEST_TIER_LOOT_TABLES[selectedTier];
                  setBaseGold(def.baseGold);
                  setBaseManaStones(def.baseManaStones);
                  setMinItems(def.minItems);
                  setMaxItems(def.maxItems);
                  setPool(def.pool.map((d) => ({ ...d, tier: d.tier || selectedTier })));
                }}
              >
                Reset Tier Defaults
              </button>
            </div>

            <form id="dm-chest-tier-edit-form" className="stack-form" onSubmit={handleSaveTierTable}>
              <label>
                <span>Select Chest Tier to Edit</span>
                <select value={selectedTier} onChange={(e) => loadTierIntoEditor(e.target.value as ChestTier)}>
                  {CHEST_TIERS.map((ct) => (
                    <option key={ct} value={ct}>{ct} Treasure Chest</option>
                  ))}
                </select>
              </label>

              <div className="grid-4">
                <label>
                  <span>1F Base Gold</span>
                  <input type="number" min={0} value={baseGold} onChange={(e) => setBaseGold(Math.max(0, Number(e.target.value || 0)))} />
                </label>
                <label>
                  <span>1F Stones</span>
                  <input type="number" min={0} value={baseManaStones} onChange={(e) => setBaseManaStones(Math.max(0, Number(e.target.value || 0)))} />
                </label>
                <label>
                  <span>Min Items</span>
                  <input type="number" min={1} max={10} value={minItems} onChange={(e) => setMinItems(Math.max(1, Number(e.target.value || 1)))} />
                </label>
                <label>
                  <span>Max Items</span>
                  <input type="number" min={1} max={10} value={maxItems} onChange={(e) => setMaxItems(Math.max(minItems, Number(e.target.value || 1)))} />
                </label>
              </div>

              <div className="small muted">
                <strong>Items Inside {selectedTier} Chest ({pool.length}):</strong>
              </div>
              <div className="list-stack" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                {pool.map((item, idx) => (
                  <div key={`${item.itemName}-${idx}`} className="item-card">
                    <div className="item-card-top">
                      <span>
                        <strong>{item.itemName}</strong>{' '}
                        <span className={`tag ${getItemTierTagClass(item.tier || selectedTier)}`}>{item.tier || selectedTier}</span>{' '}
                        <span className={`tag ${getItemCategoryTagClass(item.category)}`}>{formatItemCategory(item.category)}</span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-xs btn-danger-outline"
                        onClick={() => setPool((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </button>
                    </div>
                    {item.notes && <div className="small muted">{item.notes}</div>}
                  </div>
                ))}
              </div>

              <div className="grid-3">
                <label>
                  <span>Add Item Name</span>
                  <input type="text" placeholder="e.g. Sunfire Longsword" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} />
                </label>
                <label>
                  <span>Item Tier</span>
                  <select value={newItemTier} onChange={(e) => setNewItemTier(e.target.value as ChestTier)}>
                    {CHEST_TIERS.map((ct) => (
                      <option key={ct} value={ct}>{ct}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Category</span>
                  <select value={newItemCat} onChange={(e) => setNewItemCat(e.target.value as BestiaryLootDrop['category'])}>
                    <option value="weapon">Weapon</option>
                    <option value="armor">Armor</option>
                    <option value="relic">Relic</option>
                    <option value="consumable">Consumable</option>
                    <option value="material">Material</option>
                  </select>
                </label>
              </div>
              <div className="btn-row" style={{ alignItems: 'flex-end', gap: '8px' }}>
                <label style={{ flex: 1 }}>
                  <span>Item Effect / Notes (opt.)</span>
                  <input type="text" placeholder="e.g. 2d8+3 Radiant or +2 AC" value={newItemNotes} onChange={(e) => setNewItemNotes(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="btn btn-sm btn-cyan"
                  onClick={() => {
                    if (!newItemName.trim()) return;
                    setPool((prev) => [
                      ...prev,
                      {
                        itemName: newItemName.trim(),
                        category: newItemCat,
                        tier: newItemTier,
                        dropChancePct: 100,
                        baseGold: Math.round(baseGold * 0.4),
                        baseManaStones: baseManaStones,
                        notes: newItemNotes.trim(),
                      },
                    ]);
                    setNewItemName('');
                    setNewItemNotes('');
                  }}
                >
                  + Add Item to Chest
                </button>
              </div>

              <button type="submit" className="btn btn-gold btn-lg">
                Save {selectedTier} Chest Loot Table
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="col stack">
        <div className="panel">
          <div className="panel-header">
            <h3>Available Treasure Chests &amp; Loot Tables (6 Tiers)</h3>
            <label className="row-inline" style={{ width: 'auto', gap: '6px' }}>
              <span className="small muted">Scale Preview:</span>
              <input
                type="number"
                min={1}
                max={100}
                value={previewFloor}
                onChange={(e) => setPreviewFloor(Math.max(1, Math.min(100, Number(e.target.value || 1))))}
                style={{ width: '68px', minHeight: '28px', padding: '2px 6px' }}
              />
              <span className="small muted">F</span>
            </label>
          </div>

          <div id="dm-chest-catalog-list" className="list-stack" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            {CHEST_TIERS.map((tier) => {
              const cfg = getTierCfg(tier);
              const def = getChestDefaultsForFloor(tier, previewFloor, state.chestCatalog);
              const pal = CHEST_SVG_COLORS[tier];
              return (
                <div key={tier} className="item-card">
                  <div className="item-card-top">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                      <svg viewBox="0 0 32 28" width="24" height="20" aria-hidden="true">
                        <rect x="3" y="11" width="26" height="14" rx="2" fill={pal.body} stroke={pal.accent} strokeWidth="2" />
                        <path d="M4 11 C4 4, 28 4, 28 11 Z" fill={pal.lid} stroke={pal.accent} strokeWidth="2" />
                        <rect x="13" y="11" width="6" height="7" rx="1" fill={pal.accent} />
                      </svg>
                      <strong>{tier} Treasure Chest</strong>{' '}
                      <span className={`tag ${getItemTierTagClass(tier)}`}>{tier}</span>
                    </span>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn-xs btn-cyan"
                        onClick={() =>
                          setChestReveal(
                            buildChestLootPreview(
                              { id: `preview-${tier}`, name: `${tier} Chest`, tier, gold: 0, manaStones: 0 },
                              previewFloor,
                              null,
                              'DM',
                              state.chestCatalog,
                            ),
                          )
                        }
                      >
                        Preview Reveal
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-gold"
                        onClick={() => loadTierIntoEditor(tier)}
                      >
                        Edit Treasure Chest
                      </button>
                    </div>
                  </div>
                  <div className="small">
                    <strong>{previewFloor}F Scaled Rewards:</strong> <b>{def.gold}G</b> • <b>{def.manaStones} Mana Stones</b> • Rolls <b>{cfg.minItems === cfg.maxItems ? cfg.minItems : `${cfg.minItems}–${cfg.maxItems}`}</b> item(s)
                  </div>
                  <div className="mt-xs" style={{ borderTop: '1px solid rgba(148,163,184,0.16)', paddingTop: '6px' }}>
                    <div className="small muted" style={{ marginBottom: '4px' }}>
                      <strong>Loot Table ({cfg.pool.length} items):</strong>
                    </div>
                    <div className="list-stack" style={{ gap: '4px' }}>
                      {cfg.pool.map((item, idx) => (
                        <div key={`${tier}-item-${idx}`} className="small" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                          <span>
                            <strong>{item.itemName}</strong>{' '}
                            <span className={`tag ${getItemTierTagClass(item.tier || tier)}`}>{item.tier || tier}</span>{' '}
                            <span className={`tag ${getItemCategoryTagClass(item.category)}`}>{formatItemCategory(item.category)}</span>
                          </span>
                          {item.notes && <span className="muted">{item.notes}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Placed Chests on Story Beats ({placedChests.length})</h3>
          </div>
          <div className="list-stack" style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {placedChests.length > 0 ? (
              placedChests.map(({ beatId, beatTitle, floor, chest }) => (
                <div key={chest.id} className="item-card">
                  <div className="item-card-top">
                    <span>
                      <strong>{chest.name}</strong>{' '}
                      <span className={`tag ${getItemTierTagClass(chest.tier || 'Common')}`}>{chest.tier || 'Common'}</span>{' '}
                      <span className="tag tag-cyan">{floor}F • {beatTitle}</span>
                      {chest.opened && <span className="tag tag-crimson" style={{ marginLeft: '4px' }}>OPENED</span>}
                    </span>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn-xs btn-cyan"
                        onClick={() => setChestReveal(buildChestLootPreview(chest, floor, null, 'DM', state.chestCatalog))}
                      >
                        Preview Reveal
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-gold"
                        onClick={() =>
                          setEditingPlaced({
                            beatId,
                            beatTitle,
                            chestId: chest.id,
                            name: chest.name,
                            tier: (chest.tier || 'Common') as ChestTier,
                            gold: Number(chest.gold || 0),
                            manaStones: Number(chest.manaStones || 0),
                            itemName: chest.itemName || '',
                            itemCategory: chest.itemCategory || 'relic',
                          })
                        }
                      >
                        Edit Treasure Chest
                      </button>
                    </div>
                  </div>
                  <div className="small muted">
                    Grid ({chest.x + 1}, {chest.y + 1}) • {chest.gold}G • {chest.manaStones || 0} Stones
                    {chest.itemName ? ` • Bonus Item: ${chest.itemName}` : ''}
                  </div>
                </div>
              ))
            ) : (
              <div className="small muted">No chests placed on Story Beats yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
