import React, { useMemo, useState } from 'react';
import {
  BUILDING_BLUEPRINTS,
  CRAFTING_RECIPES,
  isStatsAndEquipmentLocked,
  type Character,
  type EquipmentSlot,
  type SettlementBuildingType,
} from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { TokenIconSvg } from '../common/TokenIconSvg';

const BUILDING_ORDER: SettlementBuildingType[] = ['forge', 'alchemy_lab', 'arcane_study', 'inn', 'shrine'];

export function PlayerSettlementTab({ ch }: { ch: Character }) {
  const { state, sendAction, pushLocalToast } = useVtt();
  const settlements = state?.settlements || [];
  const [selectedId, setSelectedId] = useState<string>(settlements[0]?.id || 'settlement-primary');
  const [activeWorkshop, setActiveWorkshop] = useState<SettlementBuildingType | null>(null);
  const [enchantSlot, setEnchantSlot] = useState<EquipmentSlot>('mainHand');

  const settlement = settlements.find((s) => s.id === selectedId) || settlements[0];
  const isLocked = state ? isStatsAndEquipmentLocked(state) : false;
  const gold = Number(ch.currency?.gold || 0);
  const stones = Number(ch.currency?.manaStones || 0);

  const inventoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of ch.inventory || []) {
      const k = item.name.trim().toLowerCase();
      map.set(k, (map.get(k) || 0) + Number(item.qty || 0));
    }
    return map;
  }, [ch.inventory]);

  if (!state || !settlement) {
    return (
      <div className="panel">
        <div className="muted small">No settlement established yet.</div>
      </div>
    );
  }

  const isVisitor = settlements[0]?.id !== settlement.id;
  const buildings = settlement.buildings || [];
  const residents = settlement.residents || [];

  const getBuilding = (type: SettlementBuildingType) => buildings.find((b) => b.type === type);
  const getResident = (role: string) => residents.find((r) => r.role === role);

  const handleFund = async (type: SettlementBuildingType, addGold: number, addStones: number) => {
    const res = await sendAction<{ ok?: boolean }>('settlement_action', {
      subAction: 'start_or_fund_building',
      settlementId: settlement.id,
      buildingType: type,
      gold: addGold,
      manaStones: addStones,
    });
    if (res?.ok) {
      pushLocalToast({ title: 'SETTLEMENT FUNDED', message: `Contributed to ${BUILDING_BLUEPRINTS[type].name}.`, category: 'info' });
    }
  };

  return (
    <div className="pstats-shell">
      {/* SETTLEMENT HEADER & MULTI-PARTY VISITING */}
      <section className="pstatus-vitals-card" aria-label="Settlement Header">
        <div className="panel-header" style={{ marginBottom: '6px' }}>
          <div>
            <div className="btn-row" style={{ alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '1.02rem' }}>{settlement.name}</strong>
              {isVisitor && <span className="tag tag-cyan">VISITING</span>}
              <span className="tag tag-gold">{buildings.filter((b) => b.level >= 1).length} Active Buildings</span>
            </div>
            <div className="muted small">
              Founded by <strong>{settlement.ownerPartyName}</strong> • {residents.length} Resident{residents.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="tag tag-outline">
            {gold}G • {stones} Stones
          </div>
        </div>

        {settlements.length > 1 && (
          <label className="mt-xs">
            <span className="small muted">Visit Settlement</span>
            <select
              className="readonly-allow"
              value={settlement.id}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {settlements.map((s, idx) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({idx === 0 ? 'Home' : `By ${s.ownerPartyName}`})
                </option>
              ))}
            </select>
          </label>
        )}

        {isLocked && (
          <div className="alert-banner warning mt-xs" style={{ marginBottom: 0 }}>
            <span>Workshop crafting &amp; building are locked during an active beat.</span>
          </div>
        )}
      </section>

      {/* CAMPFIRE RESIDENTS */}
      <section className="pstats-panel">
        <div className="pstats-section-head">
          <span className="pstats-section-label">SETTLEMENT RESIDENTS ({residents.length})</span>
        </div>
        {residents.length === 0 ? (
          <div className="muted small">
            Campfire is empty. Meet recruitable NPCs during story or combat beats and invite them here!
          </div>
        ) : (
          <div className="list-stack">
            {residents.map((r) => (
              <div key={r.id} className="item-card" style={{ padding: '8px 10px' }}>
                <div className="item-card-top">
                  <div className="btn-row" style={{ alignItems: 'center', gap: '8px' }}>
                    <TokenIconSvg type="npc" name={r.name} iconId={r.iconId} size={28} />
                    <div>
                      <strong>{r.name}</strong>
                      <div className="small muted">Role: {r.role.toUpperCase()}</div>
                    </div>
                  </div>
                  <span className="tag tag-green">{r.recruitedFloor ? `${r.recruitedFloor}F` : 'Resident'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 0-BUILDING NOTICE */}
      {buildings.length === 0 && (
        <div className="panel card-glow-gold">
          <strong>Empty Tower Clearing (0 Buildings)</strong>
          <div className="small muted mt-xs">
            Start funding your first workshop below. Once funded, complete <strong>1 Story or Combat Beat</strong> for construction to finish!
          </div>
        </div>
      )}

      {/* WORKSHOPS & BLUEPRINTS */}
      <section className="pstats-panel">
        <div className="pstats-section-head">
          <span className="pstats-section-label">WORKSHOPS &amp; CONSTRUCTION</span>
        </div>
        <div className="list-stack">
          {BUILDING_ORDER.map((bType) => {
            const bp = BUILDING_BLUEPRINTS[bType];
            if (bType === 'shrine' && !settlement.shrineUnlocked) {
              return (
                <div key={bType} className="item-card" style={{ opacity: 0.72, borderStyle: 'dashed' }}>
                  <div className="item-card-top">
                    <div>
                      <strong>🔒 Ancient Spire Altar — ???</strong>
                      <div className="small muted">Locked • The Spire has not yet answered. (Unlocks later in campaign)</div>
                    </div>
                    <span className="tag tag-outline">LOCKED</span>
                  </div>
                </div>
              );
            }

            const b = getBuilding(bType);
            const resident = getResident(bp.roleRequired);
            const curLevel = b?.level || 0;
            const nextSpec = curLevel < 3 ? bp.levels[curLevel] : null;
            const isConstructing = b?.status === 'under_construction' || b?.status === 'upgrading';
            const isFunding = b?.status === 'funding';
            const isActive = curLevel >= 1;
            const openPanel = activeWorkshop === bType;

            return (
              <div key={bType} className="item-card">
                <div className="item-card-top">
                  <div>
                    <strong>
                      {bp.name} {curLevel > 0 ? `(Lv ${curLevel})` : '(Not Built)'}
                    </strong>
                    <div className="small muted">{bp.summary}</div>
                    <div className="small" style={{ marginTop: '3px' }}>
                      {resident ? (
                        <span className="tag tag-green">{bp.roleLabel}: {resident.name}</span>
                      ) : (
                        <span className="tag tag-outline">Needs {bp.roleLabel} NPC</span>
                      )}
                    </div>
                  </div>
                  {isActive && (
                    <button
                      type="button"
                      className={`btn btn-xs ${openPanel ? 'btn-gold' : 'btn-cyan'} readonly-allow`}
                      onClick={() => setActiveWorkshop(openPanel ? null : bType)}
                    >
                      {openPanel ? 'Hide' : 'Open'}
                    </button>
                  )}
                </div>

                {/* Construction / Funding Progress */}
                {isConstructing && b && (
                  <div className="mt-xs" style={{ padding: '6px 8px', borderRadius: '8px', background: 'rgba(251, 191, 36, 0.08)' }}>
                    <div className="small">
                      <strong>Under Construction (Lv {b.targetLevel}):</strong> {b.beatsCompleted} / {b.beatsRequired} Beat(s) completed
                    </div>
                  </div>
                )}

                {(!b || isFunding || (b.status === 'active' && nextSpec)) && nextSpec && (
                  <div className="mt-xs" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div className="small muted">
                      {isFunding && b
                        ? `Funding Lv ${b.targetLevel}: ${b.fundedGold}/${b.requiredGold}G • ${b.fundedManaStones}/${b.requiredManaStones} Stones (${b.beatsRequired} Beat${b.beatsRequired > 1 ? 's' : ''})`
                        : `${curLevel === 0 ? 'Build Lv 1' : `Upgrade to Lv ${nextSpec.level}`}: ${nextSpec.requiredGold}G • ${nextSpec.requiredManaStones} Stones • ${nextSpec.beatsRequired} Beat${nextSpec.beatsRequired > 1 ? 's' : ''}`}
                    </div>
                    <div className="btn-row" style={{ gap: '6px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-xs btn-gold"
                        disabled={isLocked || gold < 10}
                        onClick={() => handleFund(bType, 10, 0)}
                      >
                        +10G
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-gold"
                        disabled={isLocked || gold < 50}
                        onClick={() => handleFund(bType, 50, 0)}
                      >
                        +50G
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-cyan"
                        disabled={isLocked || stones < 1}
                        onClick={() => handleFund(bType, 0, 1)}
                      >
                        +1 Stone
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        disabled={isLocked}
                        onClick={() => {
                          const remG = (b?.status === 'funding' ? b.requiredGold - b.fundedGold : nextSpec.requiredGold);
                          const remS = (b?.status === 'funding' ? b.requiredManaStones - b.fundedManaStones : nextSpec.requiredManaStones);
                          void handleFund(bType, Math.min(gold, Math.max(0, remG)), Math.min(stones, Math.max(0, remS)));
                        }}
                      >
                        Fund Max
                      </button>
                    </div>
                  </div>
                )}

                {/* Active Workshop Services */}
                {isActive && openPanel && (
                  <div className="mt-sm" style={{ borderTop: '1px solid rgba(148,163,184,0.2)', paddingTop: '8px' }}>
                    {!resident ? (
                      <div className="small muted">
                        Recruit a <strong>{bp.roleLabel}</strong> NPC during a story or combat beat to operate this workshop.
                      </div>
                    ) : bType === 'forge' || bType === 'alchemy_lab' ? (
                      <div className="list-stack">
                        {CRAFTING_RECIPES.filter((r) => r.buildingType === bType).map((rec) => {
                          const unlocked = curLevel >= rec.minBuildingLevel;
                          const hasMats = rec.materials.every(
                            (m) => (inventoryCounts.get(m.name.trim().toLowerCase()) || 0) >= m.qty,
                          );
                          const canAfford = gold >= rec.goldCost && stones >= rec.manaStoneCost && hasMats;
                          return (
                            <div key={rec.id} className="item-card" style={{ padding: '8px 10px' }}>
                              <div className="item-card-top">
                                <div>
                                  <strong>{rec.name}</strong>
                                  <div className="small muted">{rec.notes}</div>
                                  <div className="small" style={{ marginTop: '2px' }}>
                                    Cost: {rec.goldCost}G{rec.manaStoneCost > 0 ? ` • ${rec.manaStoneCost} Stones` : ''}
                                    {rec.materials.map((m) => {
                                      const owned = inventoryCounts.get(m.name.trim().toLowerCase()) || 0;
                                      return ` • ${m.qty}× ${m.name} (${owned})`;
                                    })}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-xs btn-gold"
                                  disabled={isLocked || !unlocked || !canAfford}
                                  onClick={async () => {
                                    const res = await sendAction<{ ok?: boolean }>('settlement_action', {
                                      subAction: 'craft_item',
                                      settlementId: settlement.id,
                                      recipeId: rec.id,
                                    });
                                    if (res?.ok) {
                                      pushLocalToast({ title: 'CRAFTED!', message: `${resident.name} crafted ${rec.name}!`, category: 'loot' });
                                    }
                                  }}
                                >
                                  {unlocked ? 'Craft' : `Lv ${rec.minBuildingLevel}`}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : bType === 'arcane_study' ? (
                      <div className="stack-form">
                        <label>
                          <span>Equipped Slot to Enchant (+1 Hit/AC per tier, max +{curLevel})</span>
                          <select value={enchantSlot} onChange={(e) => setEnchantSlot(e.target.value as EquipmentSlot)}>
                            <option value="mainHand">Main Hand ({ch.equipment?.mainHand?.name || 'Empty'})</option>
                            <option value="offHand">Off-Hand ({ch.equipment?.offHand?.name || 'Empty'})</option>
                            <option value="body">Body ({ch.equipment?.body?.name || 'Empty'})</option>
                            <option value="head">Head ({ch.equipment?.head?.name || 'Empty'})</option>
                            <option value="boots">Boots ({ch.equipment?.boots?.name || 'Empty'})</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          className="btn btn-sm btn-cyan"
                          disabled={isLocked || !ch.equipment?.[enchantSlot]}
                          onClick={async () => {
                            const res = await sendAction<{ ok?: boolean }>('settlement_action', {
                              subAction: 'enchant_equipment',
                              settlementId: settlement.id,
                              slot: enchantSlot,
                            });
                            if (res?.ok) {
                              pushLocalToast({ title: 'ENCHANTED!', message: `Upgraded ${enchantSlot} gear!`, category: 'loot' });
                            }
                          }}
                        >
                          Enchant Equipped Item (30G+ &amp; 1+ Stone)
                        </button>
                      </div>
                    ) : bType === 'inn' ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-gold"
                        disabled={isLocked}
                        onClick={async () => {
                          const res = await sendAction<{ ok?: boolean }>('settlement_action', {
                            subAction: 'rest_at_inn',
                            settlementId: settlement.id,
                          });
                          if (res?.ok) {
                            pushLocalToast({
                              title: 'WELL RESTED!',
                              message: `Full HP/MP restored + ${curLevel * 5} Temp HP!`,
                              category: 'loot',
                            });
                          }
                        }}
                      >
                        Rest &amp; Feast (Full HP/MP + {curLevel * 5} Temp HP)
                      </button>
                    ) : bType === 'shrine' ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-gold"
                        disabled={isLocked || stones < 1 || !ch.patronDeityId}
                        onClick={async () => {
                          const res = await sendAction<{ ok?: boolean }>('settlement_action', {
                            subAction: 'pray_at_shrine',
                            settlementId: settlement.id,
                          });
                          if (res?.ok) {
                            pushLocalToast({ title: 'FAVOR INCREASED!', message: 'Offered 1 Mana Stone at the Shrine.', category: 'loot' });
                          }
                        }}
                      >
                        Offer 1 Mana Stone (+{curLevel >= 2 ? 2 : 1} Deity Favor)
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
