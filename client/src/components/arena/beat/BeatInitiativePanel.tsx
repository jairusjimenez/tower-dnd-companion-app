import React from 'react';
import {
  computeStatModifier,
  type Combatant,
  type PendingReaction,
  type StoryBeat,
} from '@shared/index';
import { useVtt } from '../../../context/VttContext';
import { TokenIconSvg } from '../../common/TokenIconSvg';
export interface BeatInitiativePanelProps {
  beat: StoryBeat;
  isDm: boolean;
  currentRound: number;
  maxRounds: number;
  isFinalRounds: boolean;
  activeCombatant: Combatant | undefined;
  relevantCombatants: Combatant[];
  pendingReactionObj: PendingReaction | undefined;
  isCombatBeat: boolean;
}

export function BeatInitiativePanel({
  beat,
  isDm,
  currentRound,
  maxRounds,
  isFinalRounds,
  activeCombatant,
  relevantCombatants,
  pendingReactionObj,
  isCombatBeat,
}: BeatInitiativePanelProps) {
  const { state, session, sendAction } = useVtt();
  if (!state || !session) return null;
  const floor = Math.max(1, Number(beat.floor || 1));

  return (
            <div id="beat-detail-initiative-panel" className="mt-sm" style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <div className="panel-header">
                <div className="btn-row" style={{ alignItems: 'center' }}>
                  <h4 style={{ margin: 0 }}>Initiative &amp; Turn Order (Stat-Based)</h4>
                  <span id="beat-detail-round-pill" className={`tag ${isFinalRounds ? 'tag-crimson' : 'tag-gold'}`}>
                    ROUND {currentRound}{isCombatBeat ? ` / ${maxRounds}` : ''}
                  </span>
                </div>
                <div className="btn-row">
                  {isDm ? (
                    <>
                      <button
                        type="button"
                        id="btn-beat-init-prev"
                        className="btn btn-xs btn-outline"
                        onClick={() => sendAction('initiative_action', { subAction: 'prev_turn' })}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        id="btn-beat-init-next"
                        className="btn btn-xs btn-cyan"
                        onClick={() => sendAction('initiative_action', { subAction: 'next_turn' })}
                      >
                        Next Turn
                      </button>
                      <button
                        type="button"
                        id="btn-beat-init-roll-all"
                        className="btn btn-xs btn-gold"
                        onClick={() => sendAction('initiative_action', { subAction: 'roll_all' })}
                      >
                        Roll All
                      </button>
                    </>
                  ) : session.characterId ? (
                    <>
                      {beat.aiDmEnabled && activeCombatant?.type === 'monster' && !pendingReactionObj && (
                        <button
                          type="button"
                          id="btn-beat-run-ai-dm"
                          className="btn btn-xs btn-purple"
                          onClick={() => sendAction('initiative_action', { subAction: 'run_ai_dm' })}
                        >
                          Run AI Monster Turn
                        </button>
                      )}
                      <button
                        type="button"
                        id="btn-beat-init-roll-self"
                        className="btn btn-xs btn-cyan"
                        onClick={() => sendAction('initiative_action', { subAction: 'player_roll_initiative', characterId: session.characterId })}
                      >
                        Roll Initiative
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div id="beat-detail-initiative-list" className="list-stack mt-xs">
                {relevantCombatants.length > 0 ? (
                  relevantCombatants.map((c) => {
                    const isCurrent = activeCombatant && activeCombatant.id === c.id;
                    let mod = 0;
                    let statLabel = 'Stat';
                    if (c.type === 'player' && state.characters?.[c.id]) {
                      const ch = state.characters[c.id];
                      const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
                      mod = computeStatModifier(Number(agiScore), state.mechanics, ch);
                      statLabel = `AGI ${agiScore}`;
                    } else if (c.type === 'monster') {
                      const mon = (state.monsters || []).find((m) => m.id === c.id);
                      const acVal = mon ? (mon.agi ?? mon.ac ?? 12) : 12;
                      mod = Math.floor((Number(acVal) - 10) / 2);
                      statLabel = mon ? `AC ${mon.ac}` : 'Monster';
                    }
                    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
                    const monObj = c.type === 'monster' ? (state.monsters || []).find((m) => m.id === c.id) : undefined;
                    return (
                      <div key={c.id} className={`item-card ${isCurrent ? 'card-glow-cyan' : ''}`}>
                        <div className="item-card-top">
                          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            {c.type === 'monster' && (
                              <TokenIconSvg type="monster" name={c.name} iconId={monObj?.iconId} size={20} />
                            )}
                            {c.name}{' '}
                            {c.type === 'monster' ? (
                              <span className="tag tag-crimson">MONSTER</span>
                            ) : !isDm && session.characterId === c.id ? (
                              <span className="tag tag-gold">YOU</span>
                            ) : (
                              <span className="tag tag-cyan">PARTY MEMBER</span>
                            )}
                            {isCurrent && <span className="tag tag-gold">ACTIVE TURN</span>}
                          </strong>
                          <span>
                            Init: <b>{c.initiative ?? '—'}</b>
                            {(isDm || c.type !== 'monster') && (
                              <span className="muted small"> ({statLabel} • {modStr})</span>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="muted small">No combatants in initiative order yet.</div>
                )}
              </div>
            </div>
  );
}
