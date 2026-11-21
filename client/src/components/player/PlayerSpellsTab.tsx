import React, { useEffect, useState } from 'react';
import {
  PLAYER_ATTACK_AREAS,
  SPELL_ELEMENTS,
  UNIT_EFFECT_KINDS,
  UNIT_EFFECT_META,
  formatMonsterAttackArea,
  formatUnitEffectSpec,
  getMaxSpellsForLevel,
  getSpellCraftLimits,
  normalizeSpellElement,
  type AttackArea,
  type Character,
  type UnitEffectKind,
} from '@shared/index';
import { useVtt } from '../../context/VttContext';

const DICE_TIERS = [
  { val: '1d4+1', dice: 1, sides: 4, minFloor: 1 },
  { val: '1d6+2', dice: 1, sides: 6, minFloor: 1 },
  { val: '1d8+2', dice: 1, sides: 8, minFloor: 1 },
  { val: '2d6+2', dice: 2, sides: 6, minFloor: 1 },
  { val: '2d8+2', dice: 2, sides: 8, minFloor: 1 },
  { val: '2d10+4', dice: 2, sides: 10, minFloor: 3 },
  { val: '3d8+4', dice: 3, sides: 8, minFloor: 3 },
  { val: '3d10+6', dice: 3, sides: 10, minFloor: 5 },
  { val: '3d12+6', dice: 3, sides: 12, minFloor: 5 },
  { val: '4d12+8', dice: 4, sides: 12, minFloor: 7 },
  { val: '6d12+12', dice: 6, sides: 12, minFloor: 11 },
  { val: '8d12+16', dice: 8, sides: 12, minFloor: 15 },
];

export function PlayerSpellsTab({ ch }: { ch: Character }) {
  const { state, sendAction, pushLocalToast } = useVtt();
  const [spName, setSpName] = useState('');
  const [spElement, setSpElement] = useState('Fire');
  const [spActionType, setSpActionType] = useState<'Action' | 'Reaction'>('Action');
  const [spDmg, setSpDmg] = useState('1d8+2');
  const [spRange, setSpRange] = useState(4);
  const [spMp, setSpMp] = useState(3);
  const [spExpl, setSpExpl] = useState('');
  const [spAttackArea, setSpAttackArea] = useState<AttackArea>('single');
  const [spAreaMod, setSpAreaMod] = useState(0);
  const [spHealFormula, setSpHealFormula] = useState('');
  const [spEffectKind, setSpEffectKind] = useState<UnitEffectKind | ''>('');
  const [spEffectPotency, setSpEffectPotency] = useState(3);
  const [spEffectDuration, setSpEffectDuration] = useState(2);
  const [targetMonsterId, setTargetMonsterId] = useState('');

  const livingMonsters = (state?.monsters || []).filter((m) => m.hp === null || m.hp > 0);

  useEffect(() => {
    if (livingMonsters.length === 0) {
      if (targetMonsterId) setTargetMonsterId('');
    } else if (!livingMonsters.some((m) => m.id === targetMonsterId)) {
      setTargetMonsterId(livingMonsters[0].id);
    }
  }, [state?.monsters, targetMonsterId]);

  if (!state) return null;

  const pendingReaction = (state.pendingReactions || []).find((r) => r.targetCharacterId === ch.id);
  const maxSpells = getMaxSpellsForLevel(ch.level);
  const spellCount = (ch.spells || []).length;
  const atSpellCap = spellCount >= maxSpells;
  const nextSpellLevel = (Math.floor(Math.max(1, Number(ch.level || 1)) / 3) + 1) * 3;
  const capSuffix = maxSpells >= 10 ? 'MAX 10' : `NEXT LV ${nextSpellLevel}`;

  const craftFloor = Math.max(1, Number(ch.currentFloor || state.map?.currentFloor || 1));
  const craftLimits = getSpellCraftLimits(craftFloor);

  const defaultMonsterId = targetMonsterId || livingMonsters[0]?.id || '';

  const handleCraftSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    await sendAction('spell_action', {
      characterId: ch.id,
      subAction: 'learn_custom',
      spell: {
        name: spName.trim(),
        element: spElement,
        actionType: spActionType,
        damageDice: spDmg,
        rangeSpaces: spRange,
        mpCost: spMp,
        attackArea: spAttackArea,
        attackAreaModifier: spAreaMod,
        ...(spHealFormula.trim() ? { healFormula: spHealFormula.trim() } : {}),
        ...(spEffectKind
          ? {
              effectSpec: {
                kind: spEffectKind,
                potency: Math.max(1, spEffectPotency),
                duration: Math.max(1, spEffectDuration),
                target: UNIT_EFFECT_META[spEffectKind].defaultTarget,
              },
            }
          : {}),
        explanation: spExpl.trim(),
      },
    });
    setSpName('');
    setSpExpl('');
    setSpAttackArea('single');
    setSpAreaMod(0);
    setSpHealFormula('');
    setSpEffectKind('');
  };

  return (
    <div className="two-col">
      <div className="panel card-glow-purple">
        <div className="panel-header">
          <h3>Spells</h3>
          <span id="p-spell-slots-badge" className="tag tag-purple">
            {spellCount} / {maxSpells} SPELLS{atSpellCap ? ` • ${capSuffix}` : ''}
          </span>
        </div>

        {livingMonsters.length > 0 && (
          <label className="mb-xs" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="small muted">Target Monster:</span>
            <select value={defaultMonsterId} onChange={(e) => setTargetMonsterId(e.target.value)} style={{ maxWidth: '240px' }}>
              {livingMonsters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.hp !== null ? `${m.hp}/${m.maxHp} HP` : m.healthTier || 'Active'})
                </option>
              ))}
            </select>
          </label>
        )}

        <div id="p-my-spells" className="list-stack">
          {(ch.spells || []).map((sp) => {
            const elName = normalizeSpellElement(sp.element || sp.damageType);
            const isReaction = sp.actionType === 'Reaction';
            return (
              <div key={sp.id} className="item-card">
                <div className="item-card-top">
                  <strong>
                    {sp.name} <span className={`tag tag-el-${elName.toLowerCase()}`}>{elName}</span>
                    {isReaction && <span className="tag tag-purple">Reaction</span>}
                    {sp.healFormula && <span className="tag tag-green">Heal {sp.healFormula}</span>}
                    {sp.effectSpec && (
                      <span className={`tag ${UNIT_EFFECT_META[sp.effectSpec.kind]?.category === 'buff' ? 'tag-green' : 'tag-crimson'}`}>
                        {formatUnitEffectSpec(sp.effectSpec)}
                      </span>
                    )}
                  </strong>
                  <span className="tag tag-cyan">
                    {sp.damageDice} • {sp.rangeSpaces} Sp • {sp.mpCost} MP
                  </span>
                </div>
                <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                  <select
                    aria-label={`${sp.name} Attack Area`}
                    value={sp.attackArea || 'single'}
                    onChange={(e) =>
                      sendAction('spell_action', {
                        characterId: ch.id,
                        subAction: 'update_area',
                        spellId: sp.id,
                        attackArea: e.target.value,
                      })
                    }
                    style={{ width: 'auto', minHeight: '24px', padding: '2px 6px', fontSize: '0.75rem' }}
                  >
                    {PLAYER_ATTACK_AREAS.map((a) => (
                      <option key={a} value={a}>
                        Area: {formatMonsterAttackArea(a)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`${sp.name} Area Modifier`}
                    value={sp.attackAreaModifier ?? 0}
                    onChange={(e) =>
                      sendAction('spell_action', {
                        characterId: ch.id,
                        subAction: 'update_area',
                        spellId: sp.id,
                        attackAreaModifier: Number(e.target.value),
                      })
                    }
                    style={{ width: 'auto', minHeight: '24px', padding: '2px 6px', fontSize: '0.75rem' }}
                  >
                    {[-2, -1, 0, 1, 2, 3, 4].map((m) => (
                      <option key={m} value={m}>
                        Mod: {m > 0 ? `+${m}` : m} Sp
                      </option>
                    ))}
                  </select>
                </div>
                <details className="small muted">
                  <summary>
                    Details ({elName}
                    {isReaction ? ' • Reaction (When Monster Attacks You)' : ''} • {sp.areaText || `${sp.rangeSpaces} Spaces`})
                  </summary>
                  <div className="mt-xs">{sp.explanation}</div>
                </details>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn btn-xs btn-crimson"
                    disabled={isReaction && !pendingReaction}
                    title={isReaction && !pendingReaction ? 'Reaction spells are only used when a monster attacks you' : undefined}
                    onClick={async () => {
                      if (isReaction && pendingReaction) {
                        const res = await sendAction<{ summary?: string }>('resolve_reaction', {
                          reactionId: pendingReaction.id,
                          choice: 'spell',
                          spellId: sp.id,
                        });
                        if (res?.summary) {
                          pushLocalToast({ title: 'REACTION SPELL CAST!', message: res.summary, category: 'combat' });
                        }
                        return;
                      }
                      const res = await sendAction<{
                        summary?: string;
                        monster?: { name: string; hp: number | null; maxHp: number | null; healthTier?: string };
                      }>('spell_action', {
                        characterId: ch.id,
                        subAction: 'cast',
                        spellId: sp.id,
                        targetMonsterId: defaultMonsterId || undefined,
                      });
                      if (res?.monster) {
                        const hpLabel = res.monster.hp !== null
                          ? `HP: ${res.monster.hp}/${res.monster.maxHp}`
                          : res.monster.healthTier || 'Hit';
                        pushLocalToast({
                          title: 'SPELL CAST!',
                          message: `Inflicted dmg to ${res.monster.name} (${hpLabel})`,
                          category: 'combat',
                        });
                      } else if (res?.summary) {
                        pushLocalToast({ title: 'SPELL CAST!', message: res.summary, category: 'combat' });
                      }
                    }}
                  >
                    {isReaction ? 'Reaction Cast' : 'Cast'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-outline"
                    onClick={() => sendAction('spell_action', { characterId: ch.id, subAction: 'forget', spellId: sp.id })}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <details className="sub-details mt-sm">
          <summary>Tower Grimoire</summary>
          <div id="p-grimoire-list" className="list-stack mt-sm">
            {(state.grimoire || []).map((sp) => {
              const known = (ch.spells || []).some((s) => s.id === sp.id);
              const elName = normalizeSpellElement(sp.element || sp.damageType);
              const isReaction = sp.actionType === 'Reaction';
              return (
                <div key={sp.id} className="item-card">
                  <div className="item-card-top">
                    <strong>
                      {sp.name} <span className={`tag tag-el-${elName.toLowerCase()}`}>{elName}</span>
                      {isReaction && <span className="tag tag-purple">Reaction</span>}
                    </strong>
                    <span className="small">
                      {sp.damageDice} • Range: {sp.rangeSpaces} Spaces • {sp.mpCost} MP
                    </span>
                  </div>
                  <div className="muted small">{sp.explanation}</div>
                  <div className="btn-row">
                    <button
                      type="button"
                      className={`btn btn-xs ${known || atSpellCap ? 'btn-outline' : 'btn-cyan'}`}
                      disabled={known || atSpellCap}
                      onClick={() =>
                        sendAction('spell_action', {
                          characterId: ch.id,
                          subAction: 'learn_from_grimoire',
                          spellId: sp.id,
                        })
                      }
                    >
                      {known
                        ? 'Known'
                        : atSpellCap
                          ? maxSpells >= 10
                            ? 'Max 10 Reached'
                            : `Slot Full (Lv ${nextSpellLevel})`
                          : 'Learn Spell'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </details>

        <details className="sub-details mt-sm">
          <summary>+ Craft Custom Spell</summary>
          <form id="p-craft-spell-form" className="stack-form mt-sm" onSubmit={handleCraftSubmit}>
            <label>
              <span>Spell Name</span>
              <input id="sp-name" type="text" placeholder="Spell Name" required value={spName} onChange={(e) => setSpName(e.target.value)} />
            </label>
            <div className="grid-2">
              <label>
                <span>Element</span>
                <select id="sp-element" value={spElement} onChange={(e) => setSpElement(e.target.value)}>
                  {SPELL_ELEMENTS.map((el) => (
                    <option key={el} value={el}>{el}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Subtype</span>
                <select id="sp-action-type" value={spActionType} onChange={(e) => setSpActionType(e.target.value === 'Reaction' ? 'Reaction' : 'Action')}>
                  <option value="Action">Standard (Action)</option>
                  <option value="Reaction">Reaction (When Monster Attacks You)</option>
                </select>
              </label>
            </div>
            <div id="p-craft-floor-cap" className="small muted">
              Floor {craftFloor} Cap: max {craftLimits.maxDice}d{craftLimits.maxSides}+{craftLimits.maxBonus} • max {craftLimits.maxRange} Spaces • MP scales with power
            </div>
            <div className="grid-3">
              <label>
                <span>Damage Dice</span>
                <select id="sp-dmg" value={spDmg} onChange={(e) => setSpDmg(e.target.value)}>
                  {DICE_TIERS.map((d) => {
                    const locked = d.dice > craftLimits.maxDice || d.sides > craftLimits.maxSides || craftFloor < d.minFloor;
                    return (
                      <option key={d.val} value={d.val} disabled={locked}>
                        {d.val}
                        {locked ? ` (Locked — Floor ${d.minFloor}+)` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label>
                <span>Range (Spaces)</span>
                <input
                  id="sp-range"
                  type="number"
                  min={1}
                  max={craftLimits.maxRange}
                  value={spRange}
                  onChange={(e) => setSpRange(Number(e.target.value || 1))}
                />
              </label>
              <label>
                <span>MP Cost</span>
                <input
                  id="sp-mp"
                  type="number"
                  min={2}
                  value={spMp}
                  onChange={(e) => setSpMp(Number(e.target.value || 2))}
                />
              </label>
            </div>
            <div className="grid-2">
              <label>
                <span>Attack Area</span>
                <select value={spAttackArea} onChange={(e) => setSpAttackArea(e.target.value as AttackArea)}>
                  {PLAYER_ATTACK_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {formatMonsterAttackArea(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Area Size Modifier (Spaces)</span>
                <select value={spAreaMod} onChange={(e) => setSpAreaMod(Number(e.target.value))}>
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
                <span>Heal HP Formula (Optional)</span>
                <input
                  type="text"
                  placeholder="e.g. 2d6+3"
                  value={spHealFormula}
                  onChange={(e) => setSpHealFormula(e.target.value)}
                />
              </label>
              <label>
                <span>Buff / Debuff Effect (Optional)</span>
                <select value={spEffectKind} onChange={(e) => setSpEffectKind(e.target.value as UnitEffectKind | '')}>
                  <option value="">None</option>
                  {UNIT_EFFECT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {UNIT_EFFECT_META[k].label} ({UNIT_EFFECT_META[k].category})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {spEffectKind && (
              <div className="grid-2">
                <label>
                  <span>Effect Potency</span>
                  <input type="number" min={1} max={50} value={spEffectPotency} onChange={(e) => setSpEffectPotency(Number(e.target.value || 1))} />
                </label>
                <label>
                  <span>Duration (Turns)</span>
                  <input type="number" min={1} max={10} value={spEffectDuration} onChange={(e) => setSpEffectDuration(Number(e.target.value || 1))} />
                </label>
              </div>
            )}
            <label>
              <span>Explanation</span>
              <textarea id="sp-expl" rows={2} placeholder="Spell effect & range details..." value={spExpl} onChange={(e) => setSpExpl(e.target.value)} />
            </label>
            <button type="submit" id="btn-unlock-custom-spell" className="btn btn-purple" disabled={atSpellCap}>
              {atSpellCap ? (maxSpells >= 10 ? 'Max Spells Reached (10/10)' : `Spell Limit Reached (Next at Lv ${nextSpellLevel})`) : 'Unlock Spell'}
            </button>
          </form>
        </details>
      </div>

      <div className="panel card-glow-gold deity-panel-locked">
        <div className="panel-header">
          <h3>Patron Deity</h3>
          <div className="btn-row">
            <span className="tag tag-tier-normal">LOCKED • FLOOR 1</span>
            <span className="tag tag-tier-normal">
              FAVOR: <b id="p-deity-favor">1</b>
            </span>
          </div>
        </div>
        <div className="deity-locked-stage">
          <div className="deity-obscured-wrap" aria-hidden="true">
            <div id="p-deity-active-card" className="system-callout">
              Patron Deity Locked on Floor 1
            </div>
            <div id="p-deity-list" className="list-stack mt-sm">
              {(state.deities || []).map((d) => (
                <div key={d.id} className="item-card">
                  <div className="item-card-top">
                    <strong>{d.name}</strong>
                    <span className="tag tag-gold">{d.domain}</span>
                  </div>
                  <div className="small">{d.blessingName}: {d.blessingDescription}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="deity-locked-overlay">
            <strong>Patron Deity System Locked</strong>
            <span className="small muted">Not available on Floor 1 of the Tower yet.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
