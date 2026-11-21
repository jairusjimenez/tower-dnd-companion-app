import React, { useState } from 'react';
import {
  MONSTER_ATTACK_AREAS,
  MONSTER_ICON_IDS,
  TOKEN_ICON_META,
  UNIT_EFFECT_KINDS,
  UNIT_EFFECT_META,
  formatItemCategory,
  formatMonsterAttackArea,
  formatUnitEffectSpec,
  inferDefaultAttackAreaForMonster,
  getDefaultLootTableForMonster,
  getDefaultSkillsForMonster,
  getItemCategoryTagClass,
  getItemTierTagClass,
  getMonsterXpReward,
  scaleLootDropForFloor,
  scaleMonsterForFloor,
  scaleMonsterSkillForFloor,
  type BestiaryLootDrop,
  type MonsterAttackArea,
  type MonsterIconId,
  type MonsterSkill,
  type UnitEffectKind,
  type UnitEffectSpec,
} from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { TokenIconSvg } from '../common/TokenIconSvg';

type BestiaryFilter = 'All' | 'Manhwa' | 'D&D' | 'Boss' | 'Custom';

export function DmMonstersTab() {
  const { state, sendAction, pushLocalToast } = useVtt();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'Manhwa' | 'D&D' | 'Boss' | 'Custom'>('Custom');
  const [iconId, setIconId] = useState<MonsterIconId | ''>('');
  const [maxHp, setMaxHp] = useState(32);
  const [ac, setAc] = useState(14);
  const [dr, setDr] = useState(1);
  const [rangeSpaces, setRangeSpaces] = useState(2);
  const [attackArea, setAttackArea] = useState<MonsterAttackArea | ''>('');
  const [attackAreaModifier, setAttackAreaModifier] = useState(0);
  const [attackFormula, setAttackFormula] = useState('1d20+5');
  const [damageFormula, setDamageFormula] = useState('1d8+3');
  const [healFormula, setHealFormula] = useState('');
  const [effectKind, setEffectKind] = useState<UnitEffectKind | ''>('');
  const [effectPotency, setEffectPotency] = useState(3);
  const [effectDuration, setEffectDuration] = useState(2);
  const [notes, setNotes] = useState('');
  const [lootDrops, setLootDrops] = useState<BestiaryLootDrop[]>([]);
  const [dropName, setDropName] = useState('');
  const [dropCat, setDropCat] = useState<BestiaryLootDrop['category']>('material');
  const [dropChance, setDropChance] = useState(50);
  const [dropGold, setDropGold] = useState(20);
  const [dropStones, setDropStones] = useState(1);
  const [dropMinFloor, setDropMinFloor] = useState(1);

  const [monsterSkills, setMonsterSkills] = useState<MonsterSkill[]>([]);
  const [skName, setSkName] = useState('');
  const [skDmg, setSkDmg] = useState('2d6+3');
  const [skAtk, setSkAtk] = useState(6);
  const [skBaseUses, setSkBaseUses] = useState(1);
  const [skMinFloor, setSkMinFloor] = useState(1);
  const [skDesc, setSkDesc] = useState('');
  const [skAttackArea, setSkAttackArea] = useState<MonsterAttackArea | ''>('');
  const [skAreaMod, setSkAreaMod] = useState(0);
  const [skHealFormula, setSkHealFormula] = useState('');
  const [skEffectKind, setSkEffectKind] = useState<UnitEffectKind | ''>('');
  const [skEffectPotency, setSkEffectPotency] = useState(3);
  const [skEffectDuration, setSkEffectDuration] = useState(2);

  const [filterCat, setFilterCat] = useState<BestiaryFilter>('All');
  const [previewFloor, setPreviewFloor] = useState(1);

  if (!state) return null;

  const bestiary = state.bestiary || [];
  const filtered = bestiary.filter((b) => filterCat === 'All' || (b.category || 'Custom') === filterCat);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setCategory('Custom');
    setIconId('');
    setMaxHp(32);
    setAc(14);
    setDr(1);
    setRangeSpaces(2);
    setAttackArea('');
    setAttackAreaModifier(0);
    setAttackFormula('1d20+5');
    setDamageFormula('1d8+3');
    setHealFormula('');
    setEffectKind('');
    setEffectPotency(3);
    setEffectDuration(2);
    setNotes('');
    setLootDrops([]);
    setMonsterSkills([]);
  };

  const handleAddMonster = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) return;
    const isEdit = Boolean(editingId);
    const builtEffectSpec: UnitEffectSpec | null = effectKind
      ? {
          kind: effectKind,
          potency: Math.max(1, effectPotency),
          duration: Math.max(1, effectDuration),
          target: UNIT_EFFECT_META[effectKind].defaultTarget,
        }
      : null;
    const res = await sendAction<{ ok?: boolean }>('bestiary_action', {
      subAction: isEdit ? 'update' : 'add',
      id: editingId || undefined,
      name: name.trim(),
      category,
      ...(iconId ? { iconId } : {}),
      maxHp,
      ac,
      dr,
      rangeSpaces,
      ...(attackArea ? { attackArea } : {}),
      attackAreaModifier,
      attackFormula: attackFormula.trim() || '1d20+5',
      damageFormula: damageFormula.trim() || '1d8+3',
      healFormula: healFormula.trim() || undefined,
      effectSpec: builtEffectSpec,
      notes: notes.trim(),
      lootTable: lootDrops,
      skills: monsterSkills,
    });
    if (res?.ok) {
      pushLocalToast({
        title: isEdit ? 'MONSTER UPDATED' : 'MONSTER ADDED TO BESTIARY',
        message: `${name.trim()} (${category}) ${isEdit ? 'updated' : 'is now available in Story Beat Encounters'}.`,
        category: 'loot',
      });
      resetForm();
    }
  };

  return (
    <div className="two-col">
      <div className="col stack">
        <div className="panel card-glow-crimson">
          <div className="panel-header">
            <h3>{editingId ? 'Edit Monster' : '+ Add Monster to Bestiary'}</h3>
            <div className="btn-row">
              {editingId && (
                <button type="button" className="btn btn-xs btn-outline" onClick={resetForm}>
                  Cancel Edit
                </button>
              )}
              <span className="tag tag-crimson">FLOOR 1 BASELINE</span>
            </div>
          </div>
          <form id="dm-bestiary-add-form" className="stack-form" onSubmit={handleAddMonster}>
            <div className="grid-2">
              <label>
                <span>Monster Name</span>
                <input
                  type="text"
                  required
                  placeholder="e.g. Shadow Basilisk"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                <span>Origin / Category</span>
                <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                  <option value="Custom">Custom</option>
                  <option value="Manhwa">Manhwa</option>
                  <option value="D&amp;D">D&amp;D</option>
                  <option value="Boss">Boss</option>
                </select>
              </label>
            </div>
            <label>
              <span>Monster Icon (Optional — Auto-Detected)</span>
              <select value={iconId} onChange={(e) => setIconId(e.target.value as MonsterIconId | '')}>
                <option value="">Auto-Detect from Monster Name</option>
                {MONSTER_ICON_IDS.map((id) => (
                  <option key={id} value={id}>
                    {TOKEN_ICON_META[id].label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid-4">
              <label>
                <span>Base Max HP</span>
                <input type="number" min={1} value={maxHp} onChange={(e) => setMaxHp(Math.max(1, Number(e.target.value || 1)))} />
              </label>
              <label>
                <span>Base AC</span>
                <input type="number" min={1} value={ac} onChange={(e) => setAc(Number(e.target.value || 10))} />
              </label>
              <label>
                <span>Base DR</span>
                <input type="number" min={0} value={dr} onChange={(e) => setDr(Math.max(0, Number(e.target.value || 0)))} />
              </label>
              <label>
                <span>Range (Sp)</span>
                <input type="number" min={1} value={rangeSpaces} onChange={(e) => setRangeSpaces(Math.max(1, Number(e.target.value || 1)))} />
              </label>
            </div>
            <div className="grid-2">
              <label>
                <span>Attack Area (Spaces affected; hits ALL players inside)</span>
                <select value={attackArea} onChange={(e) => setAttackArea(e.target.value as MonsterAttackArea | '')}>
                  <option value="">Auto (inferred from monster type &amp; size)</option>
                  {MONSTER_ATTACK_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {formatMonsterAttackArea(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Area Size Modifier (Spaces)</span>
                <select value={attackAreaModifier} onChange={(e) => setAttackAreaModifier(Number(e.target.value))}>
                  {[-2, -1, 0, 1, 2, 3, 4].map((m) => (
                    <option key={m} value={m}>
                      {m > 0 ? `+${m}` : m} Space{Math.abs(m) === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid-2">
              <label>
                <span>Attack Formula</span>
                <input type="text" value={attackFormula} onChange={(e) => setAttackFormula(e.target.value)} />
              </label>
              <label>
                <span>Damage Formula</span>
                <input type="text" value={damageFormula} onChange={(e) => setDamageFormula(e.target.value)} />
              </label>
            </div>
            <div className="grid-2">
              <label>
                <span>Heal HP Formula (Optional)</span>
                <input type="text" placeholder="e.g. 2d6+4" value={healFormula} onChange={(e) => setHealFormula(e.target.value)} />
              </label>
              <label>
                <span>On-Hit Effect (Optional)</span>
                <select value={effectKind} onChange={(e) => setEffectKind(e.target.value as UnitEffectKind | '')}>
                  <option value="">None</option>
                  {UNIT_EFFECT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {UNIT_EFFECT_META[k].label} ({UNIT_EFFECT_META[k].category})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {effectKind && (
              <div className="grid-2">
                <label>
                  <span>Effect Potency</span>
                  <input type="number" min={1} max={50} value={effectPotency} onChange={(e) => setEffectPotency(Number(e.target.value || 1))} />
                </label>
                <label>
                  <span>Duration (Turns)</span>
                  <input type="number" min={1} max={10} value={effectDuration} onChange={(e) => setEffectDuration(Number(e.target.value || 1))} />
                </label>
              </div>
            )}
            <label>
              <span>Behavior / Lore Note (Optional)</span>
              <input
                type="text"
                placeholder="e.g. Packs hunt weak targets; vulnerable to Fire..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <details className="sub-details">
              <summary>+ Custom Loot Drops Table (Optional — auto-generates if empty)</summary>
              <div className="stack-form mt-xs">
                {lootDrops.map((d, idx) => (
                  <div key={`${d.itemName}-${idx}`} className="item-card">
                    <div className="item-card-top">
                      <strong>{d.itemName} <span className="tag tag-gold">{d.dropChancePct}%</span></strong>
                      <span className="small muted">{d.category} • {d.baseGold}G • {d.baseManaStones} Stones • {d.minFloor || 1}F+</span>
                      <button type="button" className="btn btn-xs btn-danger-outline" onClick={() => setLootDrops((prev) => prev.filter((_, i) => i !== idx))}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <div className="grid-2">
                  <label><span>Drop Item Name</span><input type="text" placeholder="e.g. Kasaka's Venom Fang" value={dropName} onChange={(e) => setDropName(e.target.value)} /></label>
                  <label>
                    <span>Item Category</span>
                    <select value={dropCat} onChange={(e) => setDropCat(e.target.value as BestiaryLootDrop['category'])}>
                      <option value="material">Material</option>
                      <option value="weapon">Weapon</option>
                      <option value="armor">Armor</option>
                      <option value="consumable">Consumable</option>
                      <option value="relic">Relic</option>
                    </select>
                  </label>
                </div>
                <div className="grid-4">
                  <label><span>Chance %</span><input type="number" min={1} max={100} value={dropChance} onChange={(e) => setDropChance(Number(e.target.value || 50))} /></label>
                  <label><span>1F Gold</span><input type="number" min={0} value={dropGold} onChange={(e) => setDropGold(Number(e.target.value || 0))} /></label>
                  <label><span>1F Stones</span><input type="number" min={0} value={dropStones} onChange={(e) => setDropStones(Number(e.target.value || 0))} /></label>
                  <label><span>Min Floor</span><input type="number" min={1} max={100} value={dropMinFloor} onChange={(e) => setDropMinFloor(Number(e.target.value || 1))} /></label>
                </div>
                <button
                  type="button"
                  className="btn btn-xs btn-gold"
                  onClick={() => {
                    if (!dropName.trim()) return;
                    setLootDrops((prev) => [
                      ...prev,
                      {
                        itemName: dropName.trim(),
                        category: dropCat,
                        dropChancePct: Math.max(1, Math.min(100, dropChance)),
                        baseGold: Math.max(0, dropGold),
                        baseManaStones: Math.max(0, dropStones),
                        minFloor: Math.max(1, dropMinFloor),
                      },
                    ]);
                    setDropName('');
                  }}
                >
                  + Add Loot Drop Row
                </button>
              </div>
            </details>

            <details className="sub-details">
              <summary>+ Monster Skills &amp; Floor-Scaled Uses/Combat (Optional — auto-generates if empty)</summary>
              <div className="stack-form mt-xs">
                {monsterSkills.map((sk, idx) => (
                  <div key={`${sk.name}-${idx}`} className="item-card">
                    <div className="item-card-top">
                      <strong>
                        {sk.name}{' '}
                        <span className="tag tag-purple">
                          1F: {sk.baseUsesPerCombat} Use{sk.baseUsesPerCombat === 1 ? '' : 's'}/Combat
                        </span>
                      </strong>
                      <span className="small muted">
                        Hit +{sk.attackBonus} • Dmg {sk.damageFormula} • Unlocks {sk.minFloor || 1}F+
                      </span>
                      <button
                        type="button"
                        className="btn btn-xs btn-danger-outline"
                        onClick={() => setMonsterSkills((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </button>
                    </div>
                    {sk.description && <div className="small muted">{sk.description}</div>}
                  </div>
                ))}

                <div className="grid-2">
                  <label>
                    <span>Skill Name</span>
                    <input
                      type="text"
                      placeholder="e.g. Paralyzing Venom Strike"
                      value={skName}
                      onChange={(e) => setSkName(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>1F Base Damage Formula</span>
                    <input
                      type="text"
                      placeholder="e.g. 2d6+3"
                      value={skDmg}
                      onChange={(e) => setSkDmg(e.target.value)}
                    />
                  </label>
                </div>

                <div className="grid-3">
                  <label>
                    <span>1F Attack Bonus</span>
                    <input
                      type="number"
                      value={skAtk}
                      onChange={(e) => setSkAtk(Number(e.target.value || 5))}
                    />
                  </label>
                  <label>
                    <span>1F Uses / Combat (+1 per 2F)</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={skBaseUses}
                      onChange={(e) => setSkBaseUses(Math.max(1, Math.min(10, Number(e.target.value || 1))))}
                    />
                  </label>
                  <label>
                    <span>Min Floor</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={skMinFloor}
                      onChange={(e) => setSkMinFloor(Math.max(1, Number(e.target.value || 1)))}
                    />
                  </label>
                </div>

                <div className="grid-2">
                  <label>
                    <span>Skill Attack Area (Optional)</span>
                    <select value={skAttackArea} onChange={(e) => setSkAttackArea(e.target.value as MonsterAttackArea | '')}>
                      <option value="">Inherit Monster Attack Area</option>
                      {MONSTER_ATTACK_AREAS.map((a) => (
                        <option key={a} value={a}>
                          {formatMonsterAttackArea(a)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Skill Area Size Modifier</span>
                    <select value={skAreaMod} onChange={(e) => setSkAreaMod(Number(e.target.value))}>
                      {[-2, -1, 0, 1, 2, 3, 4].map((m) => (
                        <option key={m} value={m}>
                          {m > 0 ? `+${m}` : m} Space{Math.abs(m) === 1 ? '' : 's'}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid-2">
                  <label>
                    <span>Skill Heal Formula (Optional)</span>
                    <input
                      type="text"
                      placeholder="e.g. 2d6+4"
                      value={skHealFormula}
                      onChange={(e) => setSkHealFormula(e.target.value)}
                    />
                  </label>
                  <label>
                    <span>Skill Effect (Optional)</span>
                    <select value={skEffectKind} onChange={(e) => setSkEffectKind(e.target.value as UnitEffectKind | '')}>
                      <option value="">None</option>
                      {UNIT_EFFECT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {UNIT_EFFECT_META[k].label} ({UNIT_EFFECT_META[k].category})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {skEffectKind && (
                  <div className="grid-2">
                    <label>
                      <span>Skill Effect Potency</span>
                      <input type="number" min={1} max={50} value={skEffectPotency} onChange={(e) => setSkEffectPotency(Number(e.target.value || 1))} />
                    </label>
                    <label>
                      <span>Skill Effect Duration (Turns)</span>
                      <input type="number" min={1} max={10} value={skEffectDuration} onChange={(e) => setSkEffectDuration(Number(e.target.value || 1))} />
                    </label>
                  </div>
                )}

                <label>
                  <span>Skill Effect / Description</span>
                  <input
                    type="text"
                    placeholder="e.g. Injects corrosive venom or unleashes AoE shockwave..."
                    value={skDesc}
                    onChange={(e) => setSkDesc(e.target.value)}
                  />
                </label>

                <button
                  type="button"
                  className="btn btn-xs btn-purple"
                  onClick={() => {
                    if (!skName.trim()) return;
                    setMonsterSkills((prev) => [
                      ...prev,
                      {
                        id: `msk-${Date.now().toString(36)}-${prev.length}`,
                        name: skName.trim(),
                        damageFormula: skDmg.trim() || '2d6+3',
                        attackBonus: skAtk,
                        baseUsesPerCombat: skBaseUses,
                        maxUsesPerCombat: skBaseUses,
                        usesRemaining: skBaseUses,
                        minFloor: skMinFloor,
                        description: skDesc.trim(),
                        ...(skAttackArea ? { attackArea: skAttackArea } : {}),
                        ...(skAreaMod !== 0 ? { attackAreaModifier: skAreaMod } : {}),
                        ...(skHealFormula.trim() ? { healFormula: skHealFormula.trim() } : {}),
                        ...(skEffectKind
                          ? {
                              effectSpec: {
                                kind: skEffectKind,
                                potency: Math.max(1, skEffectPotency),
                                duration: Math.max(1, skEffectDuration),
                                target: UNIT_EFFECT_META[skEffectKind].defaultTarget,
                              },
                            }
                          : {}),
                      },
                    ]);
                    setSkName('');
                    setSkDesc('');
                    setSkAttackArea('');
                    setSkAreaMod(0);
                    setSkHealFormula('');
                    setSkEffectKind('');
                  }}
                >
                  + Add Monster Skill
                </button>
              </div>
            </details>
            <button type="submit" className="btn btn-crimson btn-lg">
              {editingId ? 'Save Monster Changes' : 'Save Monster to Bestiary'}
            </button>
          </form>
        </div>
      </div>

      <div className="col stack">
        <div className="panel">
          <div className="panel-header">
            <h3>Manhwa &amp; D&amp;D Bestiary ({filtered.length})</h3>
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
            {(['All', 'Manhwa', 'D&D', 'Boss', 'Custom'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                className={`chip-btn ${filterCat === cat ? 'active' : ''}`}
                onClick={() => setFilterCat(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <div id="dm-bestiary-list" className="list-stack" style={{ maxHeight: '560px', overflowY: 'auto' }}>
            {filtered.map((b) => {
              const scaled = scaleMonsterForFloor(b, previewFloor);
              const xp = getMonsterXpReward(previewFloor);
              const rawLoot = getDefaultLootTableForMonster(b);
              const scaledLoot = rawLoot.map((d) => scaleLootDropForFloor(d, previewFloor));
              const rawSkills = getDefaultSkillsForMonster(b);
              const scaledSkills = rawSkills.map((s) => scaleMonsterSkillForFloor(s, previewFloor));
              return (
                <div key={b.id} className="item-card">
                  <div className="item-card-top">
                    <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <TokenIconSvg type="monster" name={b.name} iconId={b.iconId} category={b.category} size={22} />
                      {b.name}{' '}
                      <span className={`tag ${b.category === 'Boss' ? 'tag-crimson' : b.category === 'Manhwa' ? 'tag-purple' : 'tag-cyan'}`}>
                        {b.category || 'Custom'}
                      </span>
                    </strong>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        onClick={() => {
                          setEditingId(b.id);
                          setName(b.name);
                          setCategory(b.category || 'Custom');
                          setIconId((b.iconId as MonsterIconId) || '');
                          setMaxHp(b.maxHp);
                          setAc(b.ac);
                          setDr(b.dr);
                          setRangeSpaces(b.rangeSpaces);
                          setAttackArea(b.attackArea || '');
                          setAttackAreaModifier(Number(b.attackAreaModifier || 0));
                          setAttackFormula(b.attackFormula);
                          setDamageFormula(b.damageFormula);
                          setHealFormula(b.healFormula || '');
                          setEffectKind(b.effectSpec?.kind || '');
                          setEffectPotency(b.effectSpec?.potency || 3);
                          setEffectDuration(b.effectSpec?.duration || 2);
                          setNotes(b.notes || '');
                          setLootDrops(rawLoot.map((d) => ({ ...d })));
                          setMonsterSkills(rawSkills.map((s) => ({ ...s })));
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-danger-outline"
                        onClick={() => sendAction('bestiary_action', { subAction: 'remove', id: b.id })}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="small">
                    <strong>{previewFloor}F Stats:</strong> HP <b>{scaled.maxHp}</b> • AC <b>{scaled.ac}</b> • DR <b>{scaled.dr}</b> • Hit <code>{scaled.attackFormula}</code> • Dmg <code>{scaled.damageFormula}</code> • Range {b.rangeSpaces} Sp • +{xp} XP
                  </div>
                  <div className="small mt-xs" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    <span className="tag tag-crimson">Attack Area: {formatMonsterAttackArea(inferDefaultAttackAreaForMonster(b), b.attackAreaModifier || 0)}</span>
                    {b.healFormula && <span className="tag tag-green">Heal {b.healFormula}</span>}
                    {b.effectSpec && (
                      <span className={`tag ${UNIT_EFFECT_META[b.effectSpec.kind]?.category === 'buff' ? 'tag-green' : 'tag-crimson'}`}>
                        {formatUnitEffectSpec(b.effectSpec)}
                      </span>
                    )}
                  </div>
                  {b.notes && <div className="small muted">{b.notes}</div>}
                  <div className="mt-xs" style={{ borderTop: '1px solid rgba(148,163,184,0.16)', paddingTop: '6px' }}>
                    <div className="small muted" style={{ marginBottom: '4px' }}>
                      <strong>Monster Skills ({previewFloor}F Scaled • Limited Uses/Combat):</strong>
                    </div>
                    <div className="list-stack" style={{ gap: '4px' }}>
                      {scaledSkills.map((sk, idx) => (
                        <div
                          key={`${b.id}-sk-${idx}`}
                          className="small"
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px',
                            opacity: sk.unlocked ? 1 : 0.5,
                          }}
                        >
                          <span>
                            <span className="tag tag-purple">
                              {sk.maxUsesPerCombat} Use{sk.maxUsesPerCombat === 1 ? '' : 's'}/Combat
                            </span>{' '}
                            <strong>{sk.name}</strong>{' '}
                            <span className="tag tag-crimson">Dmg {sk.damageFormula}</span>{' '}
                            <span className="tag tag-cyan">Hit {sk.attackFormula}</span>
                            {sk.healFormula && (
                              <span className="tag tag-green" style={{ marginLeft: '4px' }}>
                                Heal {sk.healFormula}
                              </span>
                            )}
                            {sk.effectSpec && (
                              <span
                                className={`tag ${UNIT_EFFECT_META[sk.effectSpec.kind]?.category === 'buff' ? 'tag-green' : 'tag-crimson'}`}
                                style={{ marginLeft: '4px' }}
                              >
                                {formatUnitEffectSpec(sk.effectSpec)}
                              </span>
                            )}
                            {!sk.unlocked && (
                              <span className="tag tag-gold" style={{ marginLeft: '4px' }}>
                                Unlocks {sk.minFloor}F
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-xs" style={{ borderTop: '1px solid rgba(148,163,184,0.16)', paddingTop: '6px' }}>
                    <div className="small muted" style={{ marginBottom: '4px' }}>
                      <strong>Loot Drops ({previewFloor}F Scaled):</strong>
                    </div>
                    <div className="list-stack" style={{ gap: '4px' }}>
                      {scaledLoot.map((drop, idx) => (
                        <div
                          key={`${b.id}-loot-${idx}`}
                          className="small"
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px',
                            opacity: drop.unlocked ? 1 : 0.5,
                          }}
                        >
                          <span>
                            <span className="tag tag-gold">{drop.dropChancePct}%</span>{' '}
                            <strong>{drop.itemName}</strong>{' '}
                            <span className={`tag ${getItemTierTagClass(drop.tier)}`}>{drop.tier}</span>{' '}
                            <span className={`tag ${getItemCategoryTagClass(drop.category)}`}>
                              {formatItemCategory(drop.category)}
                            </span>
                            {!drop.unlocked && <span className="tag tag-crimson" style={{ marginLeft: '4px' }}>Unlocks {drop.minFloor}F</span>}
                          </span>
                          <span className="muted">
                            {drop.scaledGold}G{drop.scaledManaStones > 0 ? ` • ${drop.scaledManaStones} Stones` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
