import React, { useState } from 'react';
import {
  formatActiveUnitEffect,
  formatMonsterAttackArea,
  inferDefaultAttackAreaForMonster,
  type BeatArena,
  type Character,
  type Combatant,
  type MapToken,
  type StoryBeat,
} from '@shared/index';
import type { BeatActionMode } from '../../../canvas/drawBeatArena';
import { useVtt } from '../../../context/VttContext';
import { SegmentedBar } from '../../common/SegmentedBar';
import { TokenIconSvg } from '../../common/TokenIconSvg';
export interface BeatSideEntitiesPanelProps {
  beat: StoryBeat;
  isDm: boolean;
  arena: BeatArena;
  arenaMons: MapToken[];
  npcTokens: MapToken[];
  chars: Character[];
  combat: { round: number; turnIndex: number; combatants: Combatant[] };
  hasTurnOrder: boolean;
  activeTurnMonsterId: string | null;
  unspawnedEncounterCount: number;
  hasDuplicateArenaMonsters: boolean;
  selectedTokenId: string | null;
  setSelectedTokenId: (id: string | null) => void;
  effectiveMode: BeatActionMode;
  setBeatActionMode: (mode: BeatActionMode) => void;
  setMapHint: (hint: string) => void;
  setAimCell: (cell: { x: number; y: number } | null) => void;
  attackTargetByMonster: Record<string, string>;
  setAttackTargetByMonster: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  selectedMonsterSkillId: Record<string, string>;
  setSelectedMonsterSkillId: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  skillTrayOpenForMonster: string | null;
  setSkillTrayOpenForMonster: React.Dispatch<React.SetStateAction<string | null>>;
}

export function BeatSideEntitiesPanel({
  beat,
  isDm,
  arena,
  arenaMons,
  npcTokens,
  chars,
  combat,
  hasTurnOrder,
  activeTurnMonsterId,
  unspawnedEncounterCount,
  hasDuplicateArenaMonsters,
  selectedTokenId,
  setSelectedTokenId,
  effectiveMode,
  setBeatActionMode,
  setMapHint,
  setAimCell,
  attackTargetByMonster,
  setAttackTargetByMonster,
  selectedMonsterSkillId,
  setSelectedMonsterSkillId,
  skillTrayOpenForMonster,
  setSkillTrayOpenForMonster,
}: BeatSideEntitiesPanelProps) {
  const { state, sendAction } = useVtt();
  const [toastTarget, setToastTarget] = useState('all');
  const [toastCat, setToastCat] = useState('info');
  const [toastMsg, setToastMsg] = useState('');

  if (!state) return null;

  return (
    <>
            {beat.beatType !== 'narration' && (
            <div className="panel">
              <div className="panel-header">
                <h3>{isDm ? 'Spawned Monsters' : `Monsters (${arenaMons.length})`}</h3>
                {isDm && (beat.encounters || []).length > 0 && (
                  <button
                    type="button"
                    id="btn-beat-detail-spawn"
                    className={`btn btn-xs ${unspawnedEncounterCount > 0 || hasDuplicateArenaMonsters ? 'btn-crimson' : 'btn-outline'}`}
                    disabled={unspawnedEncounterCount === 0 && !hasDuplicateArenaMonsters}
                    title={
                      unspawnedEncounterCount === 0 && !hasDuplicateArenaMonsters
                        ? 'All attached monsters are already spawned on the arena map'
                        : `Spawn ${unspawnedEncounterCount} unattached monster(s) onto the arena map`
                    }
                    onClick={() => sendAction('story_action', { subAction: 'spawn_beat_monsters', beatId: beat.id })}
                  >
                    {unspawnedEncounterCount > 0
                      ? 'Spawn Attached'
                      : hasDuplicateArenaMonsters
                        ? 'Clean Duplicate Spawns'
                        : 'Attached Spawned'}
                  </button>
                )}
              </div>
              <div id="beat-detail-monsters" className="list-stack mt-xs">
                {arenaMons.length > 0 ? (
                  arenaMons.map((tok) => {
                    const liveMon = (state.monsters || []).find((m) => m.id === tok.id);
                    const hp = liveMon ? liveMon.hp : tok.hp;
                    const maxHp = liveMon ? liveMon.maxHp : tok.maxHp;
                    const pct = maxHp && hp !== null ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
                    const isActiveMonTurn = activeTurnMonsterId === tok.id;
                    const isLockedOutOfTurn = hasTurnOrder && tok.id !== activeTurnMonsterId;
                    return (
                      <div key={tok.id} className={`item-card ${isActiveMonTurn ? 'card-glow-crimson' : ''}`} style={isLockedOutOfTurn ? { opacity: 0.65 } : undefined}>
                        <div className="item-card-top">
                          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <TokenIconSvg type="monster" name={tok.name} iconId={liveMon?.iconId ?? tok.iconId} size={22} />
                            {tok.name}{' '}
                            {isActiveMonTurn && <span className="tag tag-gold">ACTIVE TURN</span>}
                            {isLockedOutOfTurn && <span className="tag tag-outline">WAIT TURN</span>}
                            {hp !== null && hp <= 0 && <span className="tag tag-gold">DEFEATED</span>}
                          </strong>
                          <span>
                            {isDm
                              ? `${hp !== null && maxHp ? `HP ${hp}/${maxHp}` : ''}${liveMon ? ` • AC ${liveMon.ac} • DR ${liveMon.dr}` : ''}`
                              : state.mechanics?.showExactMonsterHpToPlayers && hp !== null && maxHp
                                ? `HP ${hp}/${maxHp}`
                                : liveMon?.healthTier ||
                                  (hp !== null && maxHp
                                    ? hp <= 0
                                      ? 'Defeated'
                                      : hp >= maxHp
                                        ? 'Unharmed'
                                        : hp >= maxHp * 0.5
                                          ? 'Wounded'
                                          : hp >= maxHp * 0.25
                                            ? 'Bloodied'
                                            : 'Critical'
                                    : 'Active')}
                          </span>
                        </div>
                        {isDm && liveMon && (
                          <div className="small mt-xs">
                            <span className="tag tag-crimson">
                              Attack Area: {formatMonsterAttackArea(inferDefaultAttackAreaForMonster(liveMon))}
                            </span>
                          </div>
                        )}
                        {liveMon && (liveMon.activeEffects || []).length > 0 && (
                          <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                            {(liveMon.activeEffects || []).map((eff) => (
                              <span key={eff.id} className={`tag ${eff.category === 'buff' ? 'tag-green' : 'tag-crimson'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                {formatActiveUnitEffect(eff)}
                                {isDm && (
                                  <button
                                    type="button"
                                    aria-label={`Remove ${eff.name}`}
                                    onClick={() =>
                                      sendAction('unit_effect_action', {
                                        subAction: 'clear_effect',
                                        targetType: 'monster',
                                        targetId: liveMon.id,
                                        effectId: eff.id,
                                      })
                                    }
                                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                        {maxHp && (isDm || state.mechanics?.showExactMonsterHpToPlayers) ? (
                          <SegmentedBar
                            pct={pct}
                            maxValue={maxHp}
                            ticks={liveMon?.hpBarTicks}
                            kind="monster"
                            fillKind="monster"
                          />
                        ) : null}
                        {isDm && liveMon && (
                          <div className="stack-form mt-xs" style={{ gap: '6px' }}>
                            <div className="btn-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                              <button
                                type="button"
                                className="btn btn-xs"
                                disabled={isLockedOutOfTurn || Boolean(tok.hasMovedThisTurn)}
                                style={{
                                  background:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_move' && !tok.hasMovedThisTurn
                                      ? 'rgba(248, 113, 113, 0.35)'
                                      : 'rgba(248, 113, 113, 0.16)',
                                  border:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_move' && !tok.hasMovedThisTurn
                                      ? '1.5px solid #f87171'
                                      : '1px solid rgba(248, 113, 113, 0.55)',
                                  color: tok.hasMovedThisTurn || isLockedOutOfTurn ? '#94a3b8' : '#fecaca',
                                  fontWeight: 700,
                                }}
                                onClick={() => {
                                  setSelectedTokenId(liveMon.id);
                                  setAimCell(null);
                                  setBeatActionMode('monster_move');
                                  setMapHint(
                                    `Monster Move mode (Red): Tap an open red-highlighted space on the map to move ${liveMon.name}.`
                                  );
                                }}
                              >
                                {tok.hasMovedThisTurn ? 'Moved' : 'Move'}
                              </button>
                              {tok.hasMovedThisTurn && !isLockedOutOfTurn && (
                                <button
                                  type="button"
                                  className="btn btn-xs btn-outline"
                                  title="Allow this monster to move again this turn"
                                  onClick={() =>
                                    sendAction('story_action', {
                                      subAction: 'reset_token_move',
                                      beatId: beat.id,
                                      tokenId: liveMon.id,
                                    })
                                  }
                                >
                                  Reset Move
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-xs"
                                disabled={isLockedOutOfTurn}
                                style={{
                                  background:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_attack'
                                      ? 'linear-gradient(135deg, #dc2626, #991b1b)'
                                      : 'rgba(220, 38, 38, 0.28)',
                                  border:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_attack'
                                      ? '1.5px solid #ef4444'
                                      : '1px solid rgba(239, 68, 68, 0.75)',
                                  color: '#ffffff',
                                  fontWeight: 800,
                                }}
                                onClick={() => {
                                  setSelectedTokenId(liveMon.id);
                                  setBeatActionMode('monster_attack');
                                  setMapHint(
                                    `Monster Attack mode (Deep Red): Tap a player inside the deep-red range on the map to attack with ${liveMon.name}!`
                                  );
                                }}
                              >
                                Attack
                              </button>
                              <button
                                type="button"
                                className="btn btn-xs"
                                disabled={isLockedOutOfTurn}
                                style={{
                                  background:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_skill'
                                      ? 'linear-gradient(135deg, #c026d3, #e11d48)'
                                      : 'linear-gradient(135deg, rgba(192, 38, 211, 0.28), rgba(225, 29, 72, 0.28))',
                                  border:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_skill'
                                      ? '1.5px solid #f43f5e'
                                      : '1px solid rgba(217, 70, 239, 0.75)',
                                  color: '#fdf4ff',
                                  fontWeight: 800,
                                }}
                                onClick={() => {
                                  setSelectedTokenId(liveMon.id);
                                  setBeatActionMode('monster_skill');
                                  setSkillTrayOpenForMonster((prev) => (prev === liveMon.id ? null : liveMon.id));
                                  const firstAvail = (liveMon.skills || []).find(
                                    (s) => Number(s.usesRemaining ?? s.maxUsesPerCombat ?? 1) > 0
                                  );
                                  if (firstAvail && !selectedMonsterSkillId[liveMon.id]) {
                                    setSelectedMonsterSkillId((prev) => ({ ...prev, [liveMon.id]: firstAvail.id }));
                                  }
                                  setMapHint(
                                    `Monster Use Skills mode (Purple-Red): Tap a player inside the purple-red range on the map or pick a skill below!`
                                  );
                                }}
                              >
                                Use Skills
                              </button>
                              <button type="button" className="btn btn-xs btn-outline" onClick={() => sendAction('update_monster', { monsterId: liveMon.id, hpDelta: -5 })}>-5 HP</button>
                              <button type="button" className="btn btn-xs btn-outline" onClick={() => sendAction('update_monster', { monsterId: liveMon.id, hpDelta: 5 })}>+5 HP</button>
                              {chars.length > 0 && (
                                <>
                                  <select
                                    aria-label="Target Player"
                                    disabled={isLockedOutOfTurn}
                                    value={attackTargetByMonster[liveMon.id] || chars[0]?.id || ''}
                                    onChange={(e) =>
                                      setAttackTargetByMonster((prev) => ({ ...prev, [liveMon.id]: e.target.value }))
                                    }
                                    style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                                  >
                                    {chars.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        Target: {c.name}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-crimson"
                                    disabled={isLockedOutOfTurn}
                                    onClick={() =>
                                      sendAction('monster_attack', {
                                        monsterId: liveMon.id,
                                        targetCharacterId: attackTargetByMonster[liveMon.id] || chars[0]?.id,
                                      })
                                    }
                                  >
                                    Roll Attack Player
                                  </button>
                                </>
                              )}
                            </div>

                            {chars.length > 0 &&
                              (liveMon.skills || []).length > 0 &&
                              (skillTrayOpenForMonster === liveMon.id ||
                                (selectedTokenId === liveMon.id && effectiveMode === 'monster_skill')) && (
                              <div className="btn-row" style={{ flexWrap: 'wrap', gap: '5px' }}>
                                {liveMon.skills!.map((sk) => {
                                  const rem = Number(sk.usesRemaining ?? sk.maxUsesPerCombat ?? 1);
                                  const maxU = Number(sk.maxUsesPerCombat || 1);
                                  const exhausted = rem <= 0;
                                  return (
                                    <button
                                      key={sk.id}
                                      type="button"
                                      className={`btn btn-xs ${exhausted ? 'btn-outline' : 'btn-purple'}`}
                                      disabled={exhausted}
                                      title={`${sk.name} (${sk.damageFormula}) — ${sk.description || 'Monster Skill'}`}
                                      onClick={() =>
                                        sendAction('monster_attack', {
                                          monsterId: liveMon.id,
                                          targetCharacterId: attackTargetByMonster[liveMon.id] || chars[0]?.id,
                                          skillId: sk.id,
                                        })
                                      }
                                    >
                                      {sk.name} ({rem}/{maxU}) • {sk.damageFormula}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (beat.encounters || []).length > 0 ? (
                  isDm ? (
                    beat.encounters.map((e, i) => (
                      <div key={`${e.name}-${i}`} className="item-card">
                        <div className="item-card-top">
                          <strong>{e.name} <span className="tag tag-crimson">READY TO SPAWN</span></strong>
                          <span>HP {e.maxHp} • AC {e.ac} • DR {e.dr} • {e.damageFormula || ''}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="item-card small muted">
                      {beat.encounters.length} Monster{beat.encounters.length === 1 ? '' : 's'} lurking in the area...
                    </div>
                  )
                ) : (
                  <div className="muted small">No monsters in this story beat.</div>
                )}
              </div>
            </div>
            )}

            {beat.beatType !== 'narration' && (
              <div id="beat-detail-combat-feed" className="panel">
                <div className="panel-header">
                  <h3>Live Combat Feed</h3>
                  <span className="tag tag-cyan">{(state.combatLog || []).length}</span>
                </div>
                <div className="list-stack mt-xs" style={{ maxHeight: '210px', overflowY: 'auto' }}>
                  {(state.combatLog || []).length > 0 ? (
                    (state.combatLog || []).slice(0, 15).map((log) => (
                      <div key={log.id} className="item-card" style={{ padding: '6px 8px' }}>
                        <div className="small" style={{ color: '#e2e8f0' }}>{log.summary}</div>
                      </div>
                    ))
                  ) : (
                    <div className="muted small">Combat actions will appear here.</div>
                  )}
                </div>
              </div>
            )}

            <div className="panel">
              <div className="panel-header"><h3>Treasure &amp; Loot Chests</h3></div>
              <div id="beat-detail-treasure" className="list-stack mt-xs">
                {isDm ? (
                  <>
                    {(beat.treasures || []).map((t) => (
                      <div key={t.id} className="item-card">
                        <div className="item-card-top">
                          <strong>{t.name} <span className="tag tag-gold">{t.category || 'treasure'}</span></strong>
                          <span>{[t.gold ? `${t.gold}G` : '', t.manaStones ? `${t.manaStones} Stones` : '', t.damageDice || ''].filter(Boolean).join(' • ') || 'Story Reward'}</span>
                        </div>
                      </div>
                    ))}
                    {(arena.chests || []).map((c) => (
                      <div key={c.id} className="item-card">
                        <div className="item-card-top">
                          <strong>{c.name} <span className={`tag ${c.opened ? 'tag-cyan' : 'tag-gold'}`}>{c.opened ? 'OPENED' : 'CHEST'}</span></strong>
                          <span>{[c.gold ? `${c.gold}G` : '', c.manaStones ? `${c.manaStones} Stones` : '', c.itemName || ''].filter(Boolean).join(', ') || 'Empty'}</span>
                        </div>
                      </div>
                    ))}
                    {(beat.treasures || []).length === 0 && (arena.chests || []).length === 0 && (
                      <div className="muted small">No treasure or chests attached.</div>
                    )}
                  </>
                ) : (
                  (() => {
                    const unopenedCount = (arena.chests || []).filter((c) => !c.opened).length;
                    const openedCount = (arena.chests || []).filter((c) => c.opened).length;
                    if (unopenedCount === 0 && openedCount === 0) {
                      return <div className="muted small">No visible chests in the area.</div>;
                    }
                    return (
                      <div className="item-card small">
                        {unopenedCount > 0 ? (
                          <span>
                            <span className="tag tag-gold">CHEST</span> {unopenedCount} Unopened Chest{unopenedCount === 1 ? '' : 's'} nearby
                          </span>
                        ) : (
                          <span className="muted">All chests in this area have been opened ({openedCount}).</span>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header"><h3>NPCs in Scene</h3></div>
              <div id="beat-detail-npcs" className="list-stack mt-xs">
                {npcTokens.length > 0 ? (
                  npcTokens.map((n) => (
                    <div key={n.id} className="item-card">
                      <div className="item-card-top">
                        <strong>{n.name} <span className="tag tag-green">{n.npcRole || 'NPC'}</span></strong>
                        <span>
                          {n.rewardType && n.rewardType !== 'none'
                            ? n.rewardClaimed
                              ? 'Reward Claimed'
                              : n.rewardType === 'xp'
                                ? `+${n.rewardXp} XP`
                                : n.rewardItemName || n.rewardType
                            : 'Dialogue'}
                        </span>
                      </div>
                      {n.dialogue && <div className="muted small">"{n.dialogue}"</div>}
                    </div>
                  ))
                ) : (
                  <div className="muted small">No NPCs placed in this scene.</div>
                )}
              </div>
            </div>

            {isDm && (
              <div id="beat-detail-toast-panel" className="panel">
                <div className="panel-header"><h3>Send Toast to Players</h3></div>
                <form
                  id="beat-toast-form"
                  className="stack-form mt-xs"
                  onSubmit={async (ev) => {
                    ev.preventDefault();
                    if (!toastMsg.trim()) return;
                    await sendAction('broadcast_toast', {
                      title: 'SYSTEM NOTICE',
                      category: toastCat,
                      target: toastTarget,
                      message: toastMsg.trim(),
                    });
                    setToastMsg('');
                  }}
                >
                  <div className="grid-2">
                    <select value={toastTarget} onChange={(e) => setToastTarget(e.target.value)} aria-label="Toast Target">
                      <option value="all">All Players</option>
                      {chars.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <select value={toastCat} onChange={(e) => setToastCat(e.target.value)} aria-label="Toast Category">
                      <option value="info">System Notice (Cyan)</option>
                      <option value="combat">Combat Alert (Crimson)</option>
                      <option value="warning">Warning / Trap (Amber)</option>
                      <option value="loot">Reward / Loot (Gold)</option>
                    </select>
                  </div>
                  <div className="btn-row" style={{ gap: '6px' }}>
                    <input type="text" placeholder="Message to players..." style={{ flex: 1 }} required value={toastMsg} onChange={(e) => setToastMsg(e.target.value)} />
                    <button type="submit" className="btn btn-sm btn-cyan">Send Toast</button>
                  </div>
                </form>
              </div>
            )}
    </>
  );
}
