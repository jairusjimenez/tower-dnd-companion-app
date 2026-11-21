import React, { useState } from 'react';
import {
  CHEST_TIERS,
  formatItemCategory,
  getFloorThemeLabel,
  getItemCategoryTagClass,
  getItemTierTagClass,
  scaleTreasureForFloor,
  type ChestTier,
  type EquipmentSlot,
  type TreasureEntry,
} from '@shared/index';
import { useVtt } from '../../context/VttContext';

type TreasureFilter = 'All' | 'Manhwa' | 'D&D' | 'Custom' | 'skill_book';

export function DmTreasuresTab() {
  const { state, sendAction, pushLocalToast } = useVtt();
  const unlockedFloors = [...(state?.map?.floors || [])].sort((a, b) => a.number - b.number);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TreasureEntry['category']>('weapon');
  const [tier, setTier] = useState<ChestTier>('Common');
  const [origin, setOrigin] = useState<'Manhwa' | 'D&D' | 'Custom'>('Custom');
  const [floorLevel, setFloorLevel] = useState(1);
  const [slot, setSlot] = useState<EquipmentSlot | ''>('mainHand');
  const [attackBonus, setAttackBonus] = useState(1);
  const [damageDice, setDamageDice] = useState('1d8+2');
  const [acBonus, setAcBonus] = useState(0);
  const [drBonus, setDrBonus] = useState(0);
  const [baseGold, setBaseGold] = useState(80);
  const [baseManaStones, setBaseManaStones] = useState(2);
  const [notes, setNotes] = useState('');

  const [filterMode, setFilterMode] = useState<TreasureFilter>('All');
  const [previewFloor, setPreviewFloor] = useState(1);

  if (!state) return null;

  const catalog = state.treasureCatalog || [];
  const filtered = catalog.filter((t) => {
    if (filterMode === 'All') return true;
    if (filterMode === 'skill_book') return t.category === 'skill_book';
    return (t.origin || 'Custom') === filterMode;
  });

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setCategory('weapon');
    setOrigin('Custom');
    setFloorLevel(1);
    setSlot('mainHand');
    setAttackBonus(1);
    setDamageDice('1d8+2');
    setAcBonus(0);
    setDrBonus(0);
    setBaseGold(80);
    setBaseManaStones(2);
    setNotes('');
  };

  const handleAddTreasure = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) return;
    const isEdit = Boolean(editingId);
    const res = await sendAction<{ ok?: boolean }>('treasure_action', {
      subAction: isEdit ? 'update' : 'add',
      id: editingId || undefined,
      name: name.trim(),
      category,
      tier,
      origin,
      floorLevel,
      slot: category === 'skill_book' || category === 'consumable' ? '' : slot,
      attackBonus,
      damageDice: damageDice.trim(),
      acBonus,
      drBonus,
      baseGold,
      baseManaStones,
      notes: notes.trim(),
    });
    if (res?.ok) {
      pushLocalToast({
        title: isEdit ? 'TREASURE UPDATED' : 'TREASURE SAVED',
        message: `${name.trim()} (${floorLevel}F) ${isEdit ? 'updated' : 'added to Treasure Catalog'}.`,
        category: 'loot',
      });
      resetForm();
    }
  };

  return (
    <div className="two-col">
      <div className="col stack">
        <div className="panel card-glow-gold">
          <div className="panel-header">
            <h3>{editingId ? 'Edit Treasure' : '+ Add Equipment / Skill Book'}</h3>
            <div className="btn-row">
              {editingId && (
                <button type="button" className="btn btn-xs btn-outline" onClick={resetForm}>
                  Cancel Edit
                </button>
              )}
              <span className="tag tag-gold">FLOOR-SCALED</span>
            </div>
          </div>
          <form id="dm-treasure-add-form" className="stack-form" onSubmit={handleAddTreasure}>
            <div className="grid-2">
              <label>
                <span>Item / Skill Book Name</span>
                <input type="text" required placeholder="e.g. Black March Needle" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                <span>Category</span>
                <select
                  value={category}
                  onChange={(e) => {
                    const c = e.target.value as TreasureEntry['category'];
                    setCategory(c);
                    if (c === 'weapon') setSlot('mainHand');
                    else if (c === 'armor') setSlot('body');
                    else if (c === 'relic') setSlot('relic');
                    else setSlot('');
                  }}
                >
                  <option value="weapon">Weapon (Equipment)</option>
                  <option value="armor">Armor / Shield (Equipment)</option>
                  <option value="relic">Relic / Accessory (Equipment)</option>
                  <option value="skill_book">Skill Book</option>
                  <option value="consumable">Consumable</option>
                </select>
              </label>
            </div>

            <div className="grid-4">
              <label>
                <span>Item Tier</span>
                <select value={tier} onChange={(e) => setTier(e.target.value as ChestTier)}>
                  {CHEST_TIERS.map((ct) => (
                    <option key={ct} value={ct}>{ct} Tier</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Origin</span>
                <select value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)}>
                  <option value="Custom">Custom</option>
                  <option value="Manhwa">Manhwa</option>
                  <option value="D&amp;D">D&amp;D</option>
                </select>
              </label>
              <label>
                <span>Base Floor Level</span>
                <select value={floorLevel} onChange={(e) => setFloorLevel(Number(e.target.value || 1))}>
                  {unlockedFloors.length > 0 ? (
                    unlockedFloors.map((fl) => (
                      <option key={fl.number} value={fl.number}>
                        {fl.number}F • {getFloorThemeLabel(fl.theme)}
                      </option>
                    ))
                  ) : (
                    <option value={1}>1F</option>
                  )}
                </select>
              </label>
              <label>
                <span>Equip Slot</span>
                <select value={slot} onChange={(e) => setSlot(e.target.value as EquipmentSlot | '')} disabled={category === 'skill_book' || category === 'consumable'}>
                  <option value="">None</option>
                  <option value="mainHand">Main Hand</option>
                  <option value="offHand">Off Hand</option>
                  <option value="head">Head</option>
                  <option value="body">Body</option>
                  <option value="boots">Boots</option>
                  <option value="relic">Relic</option>
                </select>
              </label>
            </div>

            <div className="grid-4">
              <label><span>Atk Bonus</span><input type="number" min={0} value={attackBonus} onChange={(e) => setAttackBonus(Number(e.target.value || 0))} /></label>
              <label><span>Damage Dice</span><input type="text" placeholder="e.g. 2d6+2" value={damageDice} onChange={(e) => setDamageDice(e.target.value)} /></label>
              <label><span>AC Bonus</span><input type="number" min={0} value={acBonus} onChange={(e) => setAcBonus(Number(e.target.value || 0))} /></label>
              <label><span>DR Bonus</span><input type="number" min={0} value={drBonus} onChange={(e) => setDrBonus(Number(e.target.value || 0))} /></label>
            </div>

            <div className="grid-2">
              <label><span>Base Gold Value</span><input type="number" min={0} value={baseGold} onChange={(e) => setBaseGold(Number(e.target.value || 0))} /></label>
              <label><span>Base Mana Stones</span><input type="number" min={0} value={baseManaStones} onChange={(e) => setBaseManaStones(Number(e.target.value || 0))} /></label>
            </div>

            <label>
              <span>Lore / Skill Book Effect Note</span>
              <input type="text" placeholder="e.g. Teaches Shadow Step or pierces armor..." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>

            <button type="submit" className="btn btn-gold btn-lg">
              {editingId ? 'Save Treasure Changes' : 'Save Treasure to Catalog'}
            </button>
          </form>
        </div>
      </div>

      <div className="col stack">
        <div className="panel">
          <div className="panel-header">
            <h3>Manhwa &amp; D&amp;D Treasures ({filtered.length})</h3>
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

          <div className="demo-chips mb-xs">
            {(
              [
                { k: 'All', label: 'All' },
                { k: 'Manhwa', label: 'Manhwa' },
                { k: 'D&D', label: 'D&D' },
                { k: 'skill_book', label: 'Skill Books' },
                { k: 'Custom', label: 'Custom' },
              ] as const
            ).map((f) => (
              <button
                key={f.k}
                type="button"
                className={`chip-btn ${filterMode === f.k ? 'active' : ''}`}
                onClick={() => setFilterMode(f.k)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div id="dm-treasure-catalog-list" className="list-stack" style={{ maxHeight: '580px', overflowY: 'auto' }}>
            {filtered.map((t) => {
              const sc = scaleTreasureForFloor(t, previewFloor);
              return (
                <div key={t.id} className="item-card">
                  <div className="item-card-top">
                    <strong>
                      {t.name}{' '}
                      <span className={`tag ${getItemTierTagClass(sc.tier)}`}>{sc.tier}</span>{' '}
                      <span className={`tag ${getItemCategoryTagClass(t.category)}`}>
                        {formatItemCategory(t.category)}
                      </span>{' '}
                      <span className={`tag ${t.origin === 'Manhwa' ? 'tag-purple' : t.origin === 'D&D' ? 'tag-cyan' : 'tag-gold'}`}>
                        {t.origin || 'Custom'}
                      </span>{' '}
                      <span className="tag tag-cyan">Base {t.floorLevel}F</span>
                    </strong>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        onClick={() => {
                          setEditingId(t.id);
                          setName(t.name);
                          setCategory(t.category);
                          setTier(sc.tier);
                          setOrigin(t.origin || 'Custom');
                          setFloorLevel(t.floorLevel || 1);
                          setSlot(t.slot || '');
                          setAttackBonus(t.attackBonus || 0);
                          setDamageDice(t.damageDice || '');
                          setAcBonus(t.acBonus || 0);
                          setDrBonus(t.drBonus || 0);
                          setBaseGold(t.baseGold || 0);
                          setBaseManaStones(t.baseManaStones || 0);
                          setNotes(t.notes || '');
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-danger-outline"
                        onClick={() => sendAction('treasure_action', { subAction: 'remove', id: t.id })}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="small">
                    <strong>{previewFloor}F Scaled:</strong>{' '}
                    {sc.damageDice ? <>Dmg <code>{sc.damageDice}</code> • </> : null}
                    {sc.attackBonus > 0 ? <>+{sc.attackBonus} Hit • </> : null}
                    {sc.acBonus > 0 ? <>+{sc.acBonus} AC • </> : null}
                    {sc.drBonus > 0 ? <>+{sc.drBonus} DR • </> : null}
                    {sc.scaledGold}G • {sc.scaledManaStones} Stones
                  </div>
                  {t.notes && <div className="small muted">{t.notes}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
