import React from 'react';
import {
  UNIT_EFFECT_META,
  formatActiveUnitEffect,
  formatUnitEffectSpec,
  normalizeSpellElement,
  type AttackArea,
  type Character,
  type Combatant,
  type PendingReaction,
  type StoryBeat,
} from '@shared/index';
import { useVtt } from '../../../context/VttContext';
import { SegmentedBar } from '../../common/SegmentedBar';
export interface BeatSideVitalsAndSpellsProps {
  beat: StoryBeat;
  isDm: boolean;
  me: Character | undefined;
  chars: Character[];
  combat: { round: number; turnIndex: number; combatants: Combatant[] };
  arenaIds: Set<string>;
  isMyCombatTurn: boolean;
  usedAttacks: number;
  spellCastDone: boolean;
  pendingReactionObj: PendingReaction | undefined;
  pendingReact: boolean;
  defaultMonsterId: string;
  playerAttackAreaOverride: AttackArea | null;
  playerAreaModOverride: number | null;
}

export function BeatSideVitalsAndSpells({
  beat,
  isDm,
  me,
  chars,
  combat,
  arenaIds,
  isMyCombatTurn,
  usedAttacks,
  spellCastDone,
  pendingReactionObj,
  pendingReact,
  defaultMonsterId,
  playerAttackAreaOverride,
  playerAreaModOverride,
}: BeatSideVitalsAndSpellsProps) {
  const { session, sendAction, pushLocalToast, setDefeatedMonster } = useVtt();
  if (!session) return null;

  return (
    <>
            <div className="panel">
              <div className="panel-header">
                <h3 id="beat-detail-players-title">{isDm ? 'Players & Live Stats' : 'Your Vitals'}</h3>
              </div>
              <div id="beat-detail-players" className="list-stack mt-xs">
                {!isDm && me ? (
                  <div className="item-card">
                    <div className="item-card-top">
                      <strong>{me.name}</strong>
                      <span className="tag tag-cyan">Lv {me.level || 1}</span>
                    </div>
                    <div className="bar-row small mt-xs"><span>HP</span><b>{me.hp}/{me.maxHp}</b></div>
                    <SegmentedBar
                      pct={me.maxHp ? Math.max(0, Math.min(100, (me.hp / me.maxHp) * 100)) : 0}
                      maxValue={me.maxHp}
                      kind="hp"
                      fillKind="hp"
                      critical={me.maxHp > 0 && me.hp > 0 && (me.hp / me.maxHp) * 100 <= 20}
                    />
                    <div className="bar-row small mt-xs"><span>Mana (MP)</span><b>{me.mp}/{me.maxMp}</b></div>
                    <SegmentedBar
                      pct={me.maxMp ? Math.max(0, Math.min(100, (me.mp / me.maxMp) * 100)) : 0}
                      maxValue={me.maxMp}
                      kind="mp"
                      fillKind="mp"
                    />
                    <div className="bar-row small mt-xs"><span>Experience (XP)</span><b>{me.xp || 0}/{me.xpToNext || me.level * 100} XP</b></div>
                    <SegmentedBar
                      pct={Math.max(0, Math.min(100, ((me.xp || 0) / (me.xpToNext || me.level * 100)) * 100))}
                      maxValue={me.xpToNext || me.level * 100}
                      kind="xp"
                      fillKind="xp"
                    />
                    {(me.activeEffects || []).length > 0 && (
                      <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                        {(me.activeEffects || []).map((eff) => (
                          <span key={eff.id} className={`tag ${eff.category === 'buff' ? 'tag-green' : 'tag-crimson'}`}>
                            {formatActiveUnitEffect(eff)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : chars.length > 0 ? (
                  chars.map((ch) => (
                    <div key={ch.id} className="item-card">
                      <div className="item-card-top">
                        <strong>
                          {ch.name} <span className="tag tag-cyan">Lv {ch.level} {ch.className || ''}</span>
                          {!arenaIds.has(ch.id) && <span className="muted small"> (Off-map)</span>}
                        </strong>
                        <span>HP <b>{ch.hp}/{ch.maxHp}</b> • MP <b>{ch.mp}/{ch.maxMp}</b> • AC {ch.ac} • DR {ch.dr || 0}</span>
                      </div>
                      <SegmentedBar
                        pct={ch.maxHp ? Math.max(0, Math.min(100, (ch.hp / ch.maxHp) * 100)) : 0}
                        maxValue={ch.maxHp}
                        kind="hp"
                        fillKind="hp"
                        critical={ch.maxHp > 0 && ch.hp > 0 && (ch.hp / ch.maxHp) * 100 <= 20}
                      />
                      {(ch.activeEffects || []).length > 0 && (
                        <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                          {(ch.activeEffects || []).map((eff) => (
                            <span key={eff.id} className={`tag ${eff.category === 'buff' ? 'tag-green' : 'tag-crimson'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              {formatActiveUnitEffect(eff)}
                              {isDm && (
                                <button
                                  type="button"
                                  aria-label={`Remove ${eff.name}`}
                                  onClick={() =>
                                    sendAction('unit_effect_action', {
                                      subAction: 'clear_effect',
                                      targetType: 'player',
                                      targetId: ch.id,
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
                      <div className="stat-pills">
                        {Object.entries(ch.stats || {}).map(([k, v]) => (
                          <span key={k} className="stat-pill">{k}: <b>{v}</b></span>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted small">No players in session.</div>
                )}
              </div>
            </div>

            {!isDm && me && (
              <div id="beat-detail-spells-panel" className="panel">
                <div className="panel-header"><h3>Your Spells</h3></div>
                <div id="beat-detail-spells" className="list-stack mt-xs">
                  {(me.spells || []).length > 0 ? (
                    me.spells.map((sp) => {
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
                            <span className="tag tag-cyan">{sp.damageDice} • {sp.rangeSpaces} Sp • {sp.mpCost} MP</span>
                          </div>
                          <div className="btn-row mt-xs">
                            <button
                              type="button"
                              className="btn btn-xs btn-crimson"
                              disabled={isReaction ? !pendingReact : (!isMyCombatTurn || usedAttacks > 0 || spellCastDone)}
                              onClick={async () => {
                                if (isReaction && pendingReactionObj) {
                                  const res = await sendAction<{ summary?: string }>('resolve_reaction', {
                                    reactionId: pendingReactionObj.id,
                                    choice: 'spell',
                                    spellId: sp.id,
                                  });
                                  if (res?.summary) {
                                    pushLocalToast({ title: 'REACTION SPELL!', message: res.summary, category: 'combat' });
                                  }
                                  return;
                                }
                                const res = await sendAction<{
                                  ok?: boolean;
                                  summary?: string;
                                  defeatSummary?: import('@shared/index').MonsterDefeatSummary | null;
                                  logEntry?: { summary?: string };
                                }>('spell_action', {
                                  characterId: me.id,
                                  subAction: 'cast',
                                  spellId: sp.id,
                                  beatId: beat.id,
                                  attackArea: sp.attackArea || playerAttackAreaOverride || 'single',
                                  attackAreaModifier: sp.attackAreaModifier ?? playerAreaModOverride ?? 0,
                                  targetMonsterId: defaultMonsterId || undefined,
                                  ...(sp.healFormula ? { healFormula: sp.healFormula } : {}),
                                  ...(sp.effectSpec ? { effectSpec: sp.effectSpec } : {}),
                                });
                                if (res?.defeatSummary) {
                                  setDefeatedMonster(res.defeatSummary);
                                }
                                if (res?.ok) {
                                  pushLocalToast({
                                    title: 'SPELL CAST!',
                                    message: res.summary || res.logEntry?.summary || 'Spell unleashed!',
                                    category: 'combat',
                                  });
                                }
                              }}
                            >
                              {isReaction ? 'Reaction Cast' : 'Cast'}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="muted small">No spells learned yet.</div>
                  )}
                </div>
              </div>
            )}
    </>
  );
}
