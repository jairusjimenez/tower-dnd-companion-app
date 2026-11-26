import React, { useState } from 'react';
import { BUILDING_BLUEPRINTS, type SettlementNpcRole } from '@shared/index';
import { useVtt } from '../../context/VttContext';

export function DmSettlementTab() {
  const { state, sendAction, pushLocalToast } = useVtt();
  const settlements = state?.settlements || [];
  const [selectedId, setSelectedId] = useState(settlements[0]?.id || 'settlement-primary');
  const [newName, setNewName] = useState('');
  const [newParty, setNewParty] = useState('');
  const [resName, setResName] = useState('');
  const [resRole, setResRole] = useState<SettlementNpcRole>('blacksmith');

  if (!state) return null;
  const active = settlements.find((s) => s.id === selectedId) || settlements[0];

  return (
    <div className="two-col">
      <div className="col stack">
        <div className="panel card-glow-gold">
          <div className="panel-header">
            <h3>Settlements &amp; Multi-Party Access</h3>
            <span className="tag tag-gold">{settlements.length} Total</span>
          </div>

          {active && (
            <div className="stack-form">
              <label>
                <span>Select Settlement</span>
                <select value={active.id} onChange={(e) => setSelectedId(e.target.value)}>
                  {settlements.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.ownerPartyName})
                    </option>
                  ))}
                </select>
              </label>

              <div className="btn-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${active.allowVisitors ? 'btn-cyan' : 'btn-outline'}`}
                  onClick={() =>
                    sendAction('settlement_action', {
                      subAction: 'dm_update_settlement',
                      settlementId: active.id,
                      allowVisitors: !active.allowVisitors,
                    })
                  }
                >
                  {active.allowVisitors ? 'Visitors Allowed ✓' : 'Visitors Blocked'}
                </button>
                <button
                  type="button"
                  id="btn-dm-toggle-shrine"
                  className={`btn btn-sm ${active.shrineUnlocked ? 'btn-gold' : 'btn-outline'}`}
                  onClick={() =>
                    sendAction('settlement_action', {
                      subAction: 'dm_update_settlement',
                      settlementId: active.id,
                      shrineUnlocked: !active.shrineUnlocked,
                    })
                  }
                >
                  {active.shrineUnlocked ? 'Deity Shrine: UNLOCKED' : 'Deity Shrine: LOCKED'}
                </button>
              </div>
            </div>
          )}

          <form
            className="stack-form mt-md"
            style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}
            onSubmit={async (ev) => {
              ev.preventDefault();
              if (!newName.trim()) return;
              const res = await sendAction<{ ok?: boolean; settlement?: { id: string } }>('settlement_action', {
                subAction: 'dm_create_settlement',
                name: newName.trim(),
                ownerPartyName: newParty.trim() || 'Second Party',
                allowVisitors: true,
              });
              if (res?.ok && res.settlement?.id) {
                setSelectedId(res.settlement.id);
                setNewName('');
                setNewParty('');
                pushLocalToast({ title: 'SETTLEMENT CREATED', message: 'Created new party settlement.', category: 'loot' });
              }
            }}
          >
            <div className="grid-2">
              <label>
                <span>New Settlement Name</span>
                <input type="text" placeholder="e.g. Bastion Two" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </label>
              <label>
                <span>Owner Party Name</span>
                <input type="text" placeholder="e.g. Party Bravo" value={newParty} onChange={(e) => setNewParty(e.target.value)} />
              </label>
            </div>
            <button type="submit" className="btn btn-sm btn-outline">+ Create Settlement for Another Party</button>
          </form>
        </div>
      </div>

      <div className="col stack">
        {active && (
          <div className="panel">
            <div className="panel-header">
              <h3>Buildings &amp; Residents — {active.name}</h3>
            </div>
            <div className="list-stack">
              {(active.buildings || []).length === 0 ? (
                <div className="muted small">0 buildings constructed yet.</div>
              ) : (
                active.buildings.map((b) => {
                  const bp = BUILDING_BLUEPRINTS[b.type];
                  const constructing = b.status === 'under_construction' || b.status === 'upgrading';
                  return (
                    <div key={b.id} className="item-card">
                      <div className="item-card-top">
                        <div>
                          <strong>{bp?.name || b.type} (Lv {b.level} → {b.targetLevel})</strong>
                          <div className="small muted">
                            Status: {b.status} • {b.beatsCompleted}/{b.beatsRequired} Beats
                          </div>
                        </div>
                        {constructing && (
                          <div className="btn-row" style={{ gap: '6px' }}>
                            <button
                              type="button"
                              className="btn btn-xs btn-outline"
                              onClick={() =>
                                sendAction('settlement_action', {
                                  subAction: 'dm_advance_building',
                                  settlementId: active.id,
                                  buildingType: b.type,
                                })
                              }
                            >
                              +1 Beat
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs btn-gold"
                              onClick={() =>
                                sendAction('settlement_action', {
                                  subAction: 'dm_advance_building',
                                  settlementId: active.id,
                                  buildingType: b.type,
                                  completeNow: true,
                                })
                              }
                            >
                              Finish Now
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form
              className="stack-form mt-md"
              style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}
              onSubmit={async (ev) => {
                ev.preventDefault();
                if (!resName.trim()) return;
                const res = await sendAction<{ ok?: boolean }>('settlement_action', {
                  subAction: 'dm_add_resident',
                  settlementId: active.id,
                  name: resName.trim(),
                  role: resRole,
                });
                if (res?.ok) {
                  setResName('');
                  pushLocalToast({ title: 'RESIDENT ADDED', message: `Added ${resName.trim()} to ${active.name}.`, category: 'info' });
                }
              }}
            >
              <div className="grid-2">
                <label>
                  <span>Direct Resident NPC Name</span>
                  <input type="text" placeholder="e.g. Master Orin" value={resName} onChange={(e) => setResName(e.target.value)} />
                </label>
                <label>
                  <span>Workshop Role</span>
                  <select value={resRole} onChange={(e) => setResRole(e.target.value as SettlementNpcRole)}>
                    <option value="blacksmith">Blacksmith (Forge)</option>
                    <option value="alchemist">Alchemist (Lab)</option>
                    <option value="enchanter">Enchanter (Arcane Study)</option>
                    <option value="innkeeper">Innkeeper (Sanctuary Inn)</option>
                    <option value="oracle">Oracle (Deity Shrine)</option>
                    <option value="villager">Villager</option>
                  </select>
                </label>
              </div>
              <button type="submit" className="btn btn-sm btn-cyan">+ Add Resident Directly</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
