import React, { useEffect, useState } from 'react';
import type { MechanicsStatDef, StatMilestone } from '@shared/index';
import { useVtt } from '../../context/VttContext';

export function DmRulesTab() {
  const { state, sendAction } = useVtt();
  const mech = state?.mechanics;

  const [presetName, setPresetName] = useState(mech?.presetName || '');
  const [combatMode, setCombatMode] = useState<'reactive' | 'turn_based'>(mech?.combatMode || 'reactive');
  const [statFormula, setStatFormula] = useState(mech?.statFormula || '');
  const [damageFormula, setDamageFormula] = useState(mech?.damageFormula || '');
  const [hitFormula, setHitFormula] = useState(mech?.hitFormula || '');
  const [critMult, setCritMult] = useState(mech?.critMultiplier || 2);
  const [resourceName, setResourceName] = useState(mech?.resourceName || 'Mana (MP)');
  const [showExactHp, setShowExactHp] = useState(mech?.showExactMonsterHpToPlayers !== false);
  const [statsList, setStatsList] = useState<MechanicsStatDef[]>(mech?.stats || []);
  const [milestones, setMilestones] = useState<StatMilestone[]>(mech?.statMilestones || []);

  const [gdocUrl, setGdocUrl] = useState('');
  const [gdocText, setGdocText] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!mech || dirty) return;
    setPresetName(mech.presetName || '');
    setCombatMode(mech.combatMode || 'reactive');
    setStatFormula(mech.statFormula || '');
    setDamageFormula(mech.damageFormula || '');
    setHitFormula(mech.hitFormula || '');
    setCritMult(mech.critMultiplier || 2);
    setResourceName(mech.resourceName || 'Mana (MP)');
    setShowExactHp(mech.showExactMonsterHpToPlayers !== false);
    setStatsList(mech.stats || []);
    setMilestones(mech.statMilestones || []);
  }, [dirty, mech, state?.version]);

  if (!state) return null;

  const groupedMilestones = new Map<string, StatMilestone[]>();
  for (const ms of milestones) {
    const k = ms.statKey || 'OTHER';
    const arr = groupedMilestones.get(k) || [];
    arr.push(ms);
    groupedMilestones.set(k, arr);
  }

  const handleSaveMechanics = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const res = await sendAction('update_mechanics', {
      presetName: presetName.trim(),
      combatMode,
      statFormula: statFormula.trim(),
      damageFormula: damageFormula.trim(),
      hitFormula: hitFormula.trim(),
      critMultiplier: critMult,
      resourceName: resourceName.trim(),
      showExactMonsterHpToPlayers: showExactHp,
      stats: statsList,
      statMilestones: milestones,
    });
    if (res) setDirty(false);
  };

  const handleImportGoogleDoc = async (ev: React.FormEvent) => {
    ev.preventDefault();
    await sendAction('deity_action', {
      subAction: 'import_google_doc',
      docUrl: gdocUrl.trim(),
      rawText: gdocText.trim(),
    });
    setGdocText('');
  };

  return (
    <div className="two-col">
      <div className="panel">
        <div className="panel-header">
          <h3>Custom Game Mechanics &amp; Formulas Builder</h3>
        </div>
        <form id="dm-mechanics-form" className="stack-form" onChange={() => setDirty(true)} onSubmit={handleSaveMechanics}>
          <div className="grid-2">
            <label><span>Ruleset Name</span><input type="text" value={presetName} onChange={(e) => setPresetName(e.target.value)} /></label>
            <label>
              <span>Combat Flow Mode</span>
              <select value={combatMode} onChange={(e) => setCombatMode(e.target.value === 'turn_based' ? 'turn_based' : 'reactive')}>
                <option value="reactive">Reactive Counter-Combat (Players react when hit!)</option>
                <option value="turn_based">Turn-Based Initiative Only</option>
              </select>
            </label>
          </div>
          <div className="grid-2">
            <label><span>Stat Modifier Formula</span><input type="text" value={statFormula} onChange={(e) => setStatFormula(e.target.value)} /></label>
            <label><span>Damage Inflicted Formula</span><input type="text" value={damageFormula} onChange={(e) => setDamageFormula(e.target.value)} /></label>
          </div>
          <div className="grid-3">
            <label><span>Hit Check Formula</span><input type="text" value={hitFormula} onChange={(e) => setHitFormula(e.target.value)} /></label>
            <label><span>Crit Multiplier</span><input type="number" step="0.5" min={1} value={critMult} onChange={(e) => setCritMult(Number(e.target.value || 1))} /></label>
            <label><span>Resource Name</span><input type="text" value={resourceName} onChange={(e) => setResourceName(e.target.value)} /></label>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={showExactHp} onChange={(e) => setShowExactHp(e.target.checked)} />
            <span>Show exact Monster HP numbers to Players (real-time HP check)</span>
          </label>

          <div className="panel-subheader">
            <span>Custom Stats Definitions</span>
            <button
              type="button"
              id="btn-add-custom-stat"
              className="btn btn-xs btn-cyan"
              onClick={() => {
                setDirty(true);
                setStatsList((prev) => [...prev, { key: 'MANA', name: 'Custom Stat', defaultValue: 10 }]);
              }}
            >
              + Add Stat
            </button>
          </div>
          <div className="grid-4 muted small" style={{ padding: '0 2px' }}>
            <span>Stat Key</span><span>Stat Name</span><span>Starting Value</span><span>Action</span>
          </div>
          <div id="mech-stats-editor" className="list-stack">
            {statsList.map((s, idx) => (
              <div key={`${s.key}-${idx}`} className="grid-4 mech-stat-row">
                <input
                  type="text"
                  value={s.key}
                  placeholder="KEY"
                  onChange={(e) =>
                    setStatsList((prev) => prev.map((it, i) => (i === idx ? { ...it, key: e.target.value } : it)))
                  }
                />
                <input
                  type="text"
                  value={s.name}
                  placeholder="Full Name"
                  onChange={(e) =>
                    setStatsList((prev) => prev.map((it, i) => (i === idx ? { ...it, name: e.target.value } : it)))
                  }
                />
                <input
                  type="number"
                  value={s.defaultValue}
                  onChange={(e) =>
                    setStatsList((prev) =>
                      prev.map((it, i) => (i === idx ? { ...it, defaultValue: Number(e.target.value || 10) } : it)),
                    )
                  }
                />
                <button
                  type="button"
                  className="btn btn-xs btn-danger-outline"
                  onClick={() => {
                    setDirty(true);
                    setStatsList((prev) => prev.filter((_, i) => i !== idx));
                  }}
                >
                  Del
                </button>
              </div>
            ))}
          </div>

          <div className="panel-subheader mt-sm">
            <span>Stat Milestone Abilities (Awakenings by Stat)</span>
          </div>
          <div id="mech-milestones-editor" className="list-stack">
            {Array.from(groupedMilestones.entries()).map(([statKey, list], gIdx) => {
              const statObj = statsList.find((s) => s.key === statKey);
              const statName = statObj ? `${statKey} — ${statObj.name}` : statKey;
              const tiersSummary = list.map((m) => m.threshold).join(' / ');
              return (
                <details key={statKey} className="sub-details" open={gIdx === 0}>
                  <summary>
                    {statName} <span className="muted small">({tiersSummary})</span>
                  </summary>
                  <div className="mt-xs">
                    {list.map((ms) => (
                      <div key={ms.id} className="mech-ms-row" style={{ padding: '6px 0', borderTop: '1px solid rgba(148,163,184,0.12)' }}>
                        <div className="btn-row" style={{ gap: '8px', alignItems: 'center' }}>
                          <span className="tag tag-gold" style={{ minWidth: '44px', textAlign: 'center' }}>Lv/Stat</span>
                          <input
                            type="number"
                            min={1}
                            value={ms.threshold}
                            style={{ width: '72px', minHeight: '30px', padding: '4px 8px' }}
                            onChange={(e) =>
                              setMilestones((prev) =>
                                prev.map((x) => (x.id === ms.id ? { ...x, threshold: Number(e.target.value || 20) } : x)),
                              )
                            }
                          />
                          <input
                            type="text"
                            value={ms.abilityName}
                            placeholder="Ability Name"
                            style={{ flex: 1, minWidth: '160px', minHeight: '30px', padding: '4px 8px' }}
                            onChange={(e) =>
                              setMilestones((prev) =>
                                prev.map((x) => (x.id === ms.id ? { ...x, abilityName: e.target.value } : x)),
                              )
                            }
                          />
                        </div>
                        <input
                          type="text"
                          className="mt-xs"
                          value={ms.description}
                          placeholder="Ability effect description..."
                          style={{ minHeight: '30px', padding: '4px 8px', fontSize: '0.84rem' }}
                          onChange={(e) =>
                            setMilestones((prev) =>
                              prev.map((x) => (x.id === ms.id ? { ...x, description: e.target.value } : x)),
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>

          <div className="btn-row mt-sm">
            <button type="submit" className="btn btn-gold btn-lg">Save &amp; Sync Mechanics to All Players</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Deity System &amp; Google Docs Importer</h3>
        </div>
        <form id="dm-gdoc-import-form" className="stack-form" onSubmit={handleImportGoogleDoc}>
          <label>
            <span>Google Docs Link (optional public "Anyone with link")</span>
            <input type="url" placeholder="https://docs.google.com/document/d/..." value={gdocUrl} onChange={(e) => setGdocUrl(e.target.value)} />
          </label>
          <label>
            <span>Or Paste Deity Lore Text directly from your Google Doc</span>
            <textarea
              rows={4}
              placeholder={'Example format:\nSolarix, Keeper of Dawn\nDomain: Sun & Justice\nBlessing: Solar Smite\nBoon: +8 Radiant Damage\nRange: 6 Spaces'}
              value={gdocText}
              onChange={(e) => setGdocText(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-cyan">Import Deities from Google Doc</button>
        </form>

        <div className="panel-subheader mt-md"><span>Registered Deities</span></div>
        <div id="dm-deities-list" className="list-stack">
          {(state.deities || []).map((d) => (
            <div key={d.id} className="item-card">
              <div className="item-card-top">
                <strong>{d.name}</strong>
                <button
                  type="button"
                  className="btn btn-xs btn-danger-outline"
                  onClick={() => sendAction('deity_action', { subAction: 'remove_deity', deityId: d.id })}
                >
                  Delete
                </button>
              </div>
              <div className="small">
                {d.domain} — {d.blessingName} ({d.boonFormula})
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
