import React from 'react';
import {
  PLAYER_ATTACK_AREAS,
  UNIT_EFFECT_KINDS,
  UNIT_EFFECT_META,
  formatMonsterAttackArea,
  inferDefaultAttackAreaForMonster,
  type AttackArea,
  type BeatArena,
  type Character,
  type Combatant,
  type InventoryItem,
  type MapToken,
  type StoryBeat,
  type UnitEffectKind,
  type UnitEffectSpec,
} from '@shared/index';
import type { BeatActionMode } from '../../../canvas/drawBeatArena';
import { useVtt } from '../../../context/VttContext';
export interface BeatActionTraysProps {
  beat: StoryBeat;
  isDm: boolean;
  arena: BeatArena;
  me: Character | undefined;
  chars: Character[];
  arenaMons: MapToken[];
  arenaMonsterIds: Set<string>;
  consumables: InventoryItem[];
  combat: { round: number; turnIndex: number; combatants: Combatant[] };
  activeCombatant: Combatant | undefined;
  beatHasMonsters: boolean;
  activeTurnMonsterId: string | null;
  isWaitingForMonsterTurn: boolean;
  isMyCombatTurn: boolean;
  maxAttacks: number;
  usedAttacks: number;
  attacksExhausted: boolean;
  movedDone: boolean;
  observeDone: boolean;
  spellCastDone: boolean;
  beatActionMode: BeatActionMode;
  effectiveMode: BeatActionMode;
  setBeatActionMode: (mode: BeatActionMode) => void;
  selectedTokenId: string | null;
  setSelectedTokenId: (id: string | null) => void;
  mapHint: string;
  setMapHint: (hint: string) => void;
  setAimCell: (cell: { x: number; y: number } | null) => void;
  itemTrayOpen: boolean;
  setItemTrayOpen: React.Dispatch<React.SetStateAction<boolean>>;
  playerSkillTrayOpen: boolean;
  setPlayerSkillTrayOpen: React.Dispatch<React.SetStateAction<boolean>>;
  playerAttackAreaOverride: AttackArea | null;
  setPlayerAttackAreaOverride: (area: AttackArea | null) => void;
  playerAreaModOverride: number | null;
  setPlayerAreaModOverride: (mod: number | null) => void;
  playerHealBuffChoice: 'none' | 'heal' | UnitEffectKind;
  setPlayerHealBuffChoice: (choice: 'none' | 'heal' | UnitEffectKind) => void;
  dmHealBuffChoice: 'none' | 'heal' | UnitEffectKind;
  setDmHealBuffChoice: (choice: 'none' | 'heal' | UnitEffectKind) => void;
  buildChoicePayload: (choice: 'none' | 'heal' | UnitEffectKind) => { healFormula?: string; effectSpec?: UnitEffectSpec };
  attackTargetByMonster: Record<string, string>;
  selectedMonsterSkillId: Record<string, string>;
  setSelectedMonsterSkillId: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSkillTrayOpenForMonster: React.Dispatch<React.SetStateAction<string | null>>;
  dmAreaOverrideByMonster: Record<string, AttackArea>;
  setDmAreaOverrideByMonster: React.Dispatch<React.SetStateAction<Record<string, AttackArea>>>;
  dmModOverrideByMonster: Record<string, number>;
  setDmModOverrideByMonster: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}

export function BeatActionTrays({
  beat,
  isDm,
  arena,
  me,
  chars,
  arenaMons,
  arenaMonsterIds,
  consumables,
  combat,
  activeCombatant,
  beatHasMonsters,
  activeTurnMonsterId,
  isWaitingForMonsterTurn,
  isMyCombatTurn,
  maxAttacks,
  usedAttacks,
  attacksExhausted,
  movedDone,
  observeDone,
  spellCastDone,
  beatActionMode,
  effectiveMode,
  setBeatActionMode,
  selectedTokenId,
  setSelectedTokenId,
  mapHint,
  setMapHint,
  setAimCell,
  itemTrayOpen,
  setItemTrayOpen,
  playerSkillTrayOpen,
  setPlayerSkillTrayOpen,
  playerAttackAreaOverride,
  setPlayerAttackAreaOverride,
  playerAreaModOverride,
  setPlayerAreaModOverride,
  playerHealBuffChoice,
  setPlayerHealBuffChoice,
  dmHealBuffChoice,
  setDmHealBuffChoice,
  buildChoicePayload,
  attackTargetByMonster,
  selectedMonsterSkillId,
  setSelectedMonsterSkillId,
  setSkillTrayOpenForMonster,
  dmAreaOverrideByMonster,
  setDmAreaOverrideByMonster,
  dmModOverrideByMonster,
  setDmModOverrideByMonster,
}: BeatActionTraysProps) {
  const {
    session,
    state,
    sendAction,
    pushLocalToast,
    latestStatus,
    requestAttackRoll,
    setPendingConsumableUse,
  } = useVtt();

  if (!state || !session) return null;

  return (
    <>
            {!isDm && session.characterId && (
              <div id="beat-detail-action-bar" className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '6px', marginBottom: '8px', alignItems: 'center' }}>
                {!isMyCombatTurn && (
                  <span className="tag tag-outline">
                    Waiting for Turn ({activeCombatant?.name}&apos;s turn)
                  </span>
                )}
                <button
                  type="button"
                  className={`btn btn-xs btn-crimson ${effectiveMode === 'attack' ? 'active' : ''}`}
                  disabled={!isMyCombatTurn || attacksExhausted || spellCastDone}
                  onClick={() => {
                    setBeatActionMode('attack');
                    setItemTrayOpen(false);
                    setPlayerSkillTrayOpen(false);
                    setMapHint('Attack mode: Tap a monster on the map to strike with your weapon.');
                  }}
                >
                  {attacksExhausted
                    ? 'Attacked (Wait Turn)'
                    : maxAttacks > 1
                      ? `Attack (${maxAttacks - usedAttacks}/${maxAttacks})`
                      : 'Attack'}
                </button>
                <button
                  type="button"
                  className={`btn btn-xs btn-cyan ${effectiveMode === 'move' ? 'active' : ''}`}
                  disabled={!isMyCombatTurn || movedDone}
                  onClick={() => {
                    setBeatActionMode('move');
                    setItemTrayOpen(false);
                    setPlayerSkillTrayOpen(false);
                    setMapHint('Move mode: Tap any space on the map to move your character.');
                  }}
                >
                  {movedDone ? 'Moved (Wait Turn)' : 'Move'}
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-purple"
                  disabled={!isMyCombatTurn}
                  onClick={() => {
                    setPlayerSkillTrayOpen((o) => !o);
                    setItemTrayOpen(false);
                  }}
                >
                  Skills ({(me?.skills || []).length})
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-gold"
                  onClick={() => {
                    setItemTrayOpen((o) => !o);
                    setPlayerSkillTrayOpen(false);
                  }}
                >
                  Use Item
                </button>
                <button
                  type="button"
                  className={`btn btn-xs btn-outline ${effectiveMode === 'observe' ? 'active' : ''}`}
                  disabled={!isMyCombatTurn || observeDone}
                  onClick={() => {
                    setBeatActionMode('observe');
                    setItemTrayOpen(false);
                    setPlayerSkillTrayOpen(false);
                    setMapHint('Observe mode: Tap a token, monster, NPC, or chest on the map to inspect it.');
                  }}
                >
                  {observeDone ? 'Observed (Wait Turn)' : 'Observe'}
                </button>
                <select
                  aria-label="Player Attack Area"
                  value={playerAttackAreaOverride ?? me?.equipment?.mainHand?.attackArea ?? 'single'}
                  onChange={(e) => {
                    setPlayerAttackAreaOverride(e.target.value as AttackArea);
                    setBeatActionMode('attack');
                  }}
                  style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                >
                  {PLAYER_ATTACK_AREAS.map((a) => (
                    <option key={a} value={a}>
                      Area: {formatMonsterAttackArea(a)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Player Attack Area Size Modifier"
                  value={playerAreaModOverride ?? me?.equipment?.mainHand?.attackAreaModifier ?? 0}
                  onChange={(e) => {
                    setPlayerAreaModOverride(Number(e.target.value));
                    setBeatActionMode('attack');
                  }}
                  style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                >
                  {[-2, -1, 0, 1, 2, 3, 4].map((m) => (
                    <option key={m} value={m}>
                      Mod: {m > 0 ? `+${m}` : m} Sp
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Player Heal or Effect"
                  value={playerHealBuffChoice}
                  onChange={(e) => setPlayerHealBuffChoice(e.target.value as 'none' | 'heal' | UnitEffectKind)}
                  style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                >
                  <option value="none">Effect: None</option>
                  <option value="heal">Heal HP (2d6+2)</option>
                  {UNIT_EFFECT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {UNIT_EFFECT_META[k].category === 'buff' ? 'Buff' : 'Debuff'}: {UNIT_EFFECT_META[k].label}
                    </option>
                  ))}
                </select>
                {playerHealBuffChoice !== 'none' && (playerHealBuffChoice === 'heal' || UNIT_EFFECT_META[playerHealBuffChoice].category === 'buff') && (
                  <button
                    type="button"
                    className="btn btn-xs btn-gold"
                    disabled={!isMyCombatTurn}
                    onClick={async () => {
                      if (!me) return;
                      await sendAction('unit_effect_action', {
                        subAction: 'apply',
                        targetType: 'player',
                        targetId: me.id,
                        ...buildChoicePayload(playerHealBuffChoice),
                        sourceName: 'Quick Action',
                      });
                    }}
                  >
                    Apply Heal/Buff
                  </button>
                )}
                <button
                  type="button"
                  id="btn-beat-end-turn"
                  className="btn btn-xs btn-outline"
                  disabled={!isMyCombatTurn}
                  style={{ marginLeft: 'auto' }}
                  onClick={async () => {
                    await sendAction('initiative_action', { subAction: 'end_turn', characterId: session.characterId });
                    pushLocalToast({ title: 'TURN ENDED', message: 'Passed turn to the next combatant.', category: 'info' });
                  }}
                >
                  End Turn
                </button>
              </div>
            )}

            {!isDm && playerSkillTrayOpen && me && (
              <div id="beat-detail-player-skill-tray" className="list-stack" style={{ marginBottom: '8px' }}>
                {(me.skills || []).length > 0 ? (
                  (me.skills || []).map((sk, idx) => {
                    const skArea: AttackArea = sk.attackArea || playerAttackAreaOverride || me.equipment?.mainHand?.attackArea || 'single';
                    const skMod = sk.attackAreaModifier ?? playerAreaModOverride ?? me.equipment?.mainHand?.attackAreaModifier ?? 0;
                    return (
                      <div key={sk.id || `${sk.name}-${idx}`} className="item-card">
                        <div className="item-card-top">
                          <strong>
                            {sk.name}{' '}
                            <span className="tag tag-purple">{formatMonsterAttackArea(skArea, skMod)}</span>
                          </strong>
                          <button
                            type="button"
                            className="btn btn-xs btn-crimson"
                            disabled={attacksExhausted || arenaMons.length === 0}
                            onClick={async () => {
                              const targetMonTok = arenaMons[0];
                              if (!targetMonTok) return;
                              setPlayerAttackAreaOverride(skArea);
                              setPlayerAreaModOverride(skMod);
                              const choiceExtra = buildChoicePayload(playerHealBuffChoice);
                              await requestAttackRoll({
                                monTok: targetMonTok,
                                me,
                                wep: me.equipment?.mainHand || null,
                                beatId: beat.id,
                                attackArea: skArea,
                                attackAreaModifier: skMod,
                                skillName: sk.name,
                                isSkill: true,
                                ...(choiceExtra.healFormula ? { healFormula: choiceExtra.healFormula } : {}),
                                ...(choiceExtra.effectSpec ? { effectSpec: choiceExtra.effectSpec } : {}),
                              });
                            }}
                          >
                            Use on {arenaMons[0]?.name || 'Monster'}
                          </button>
                        </div>
                        {sk.description && <div className="small muted">{sk.description}</div>}
                      </div>
                    );
                  })
                ) : (
                  <div className="item-card small muted">No combat skills learned yet.</div>
                )}
              </div>
            )}

            {!isDm && itemTrayOpen && (
              <div id="beat-detail-item-tray" className="list-stack" style={{ marginBottom: '8px' }}>
                {consumables.length > 0 ? (
                  consumables.map((it) => {
                    const myTok = (arena.tokens || []).find((t) => t.id === session.characterId);
                    const usedConsumableThisTurn = Boolean(myTok?.hasUsedConsumableThisTurn && beatHasMonsters);
                    return (
                      <div key={it.id} className="item-card">
                        <div className="item-card-top">
                          <strong>{it.name} <span className="tag tag-cyan">×{it.qty || 1}</span></strong>
                          <button
                            type="button"
                            className="btn btn-xs btn-cyan"
                            disabled={!isMyCombatTurn || usedConsumableThisTurn}
                            onClick={() => {
                              if (!session.characterId) return;
                              setPendingConsumableUse({ characterId: session.characterId, item: it });
                            }}
                          >
                            {usedConsumableThisTurn ? 'Used (Wait Turn)' : 'Use'}
                          </button>
                        </div>
                        {it.notes && <div className="small muted">{it.notes}</div>}
                      </div>
                    );
                  })
                ) : (
                  <div className="item-card small muted">No consumable items in your bag.</div>
                )}
              </div>
            )}

            {isDm && arenaMons.length > 0 && (() => {
              const activeMonId =
                activeTurnMonsterId ||
                (selectedTokenId && arenaMonsterIds.has(selectedTokenId) ? selectedTokenId : null) ||
                arenaMons[0]?.id;
              const activeMonTok = arenaMons.find((m) => m.id === activeMonId) || arenaMons[0];
              const activeLiveMon = activeMonTok ? (state.monsters || []).find((m) => m.id === activeMonTok.id) : undefined;
              const isShowingThisMon = Boolean(
                activeTurnMonsterId ? activeTurnMonsterId === activeMonTok?.id : (selectedTokenId && selectedTokenId === activeMonTok?.id),
              );
              const monMovedDone = Boolean(activeMonTok?.hasMovedThisTurn);
              const monSkills = activeLiveMon?.skills || [];
              const pickedSkillId =
                (activeMonTok && selectedMonsterSkillId[activeMonTok.id]) ||
                monSkills.find((s) => Number(s.usesRemaining ?? s.maxUsesPerCombat ?? 1) > 0)?.id ||
                monSkills[0]?.id ||
                '';

              return (
                <div
                  id="beat-detail-dm-monster-action-bar"
                  className="item-card mt-xs"
                  style={{
                    marginBottom: '8px',
                    borderColor:
                      effectiveMode === 'monster_skill'
                        ? 'rgba(244, 63, 94, 0.7)'
                        : effectiveMode === 'monster_attack'
                          ? 'rgba(220, 38, 38, 0.85)'
                          : 'rgba(248, 113, 113, 0.5)',
                    background:
                      effectiveMode === 'monster_skill'
                        ? 'linear-gradient(135deg, rgba(88, 28, 135, 0.3), rgba(159, 18, 57, 0.25))'
                        : effectiveMode === 'monster_attack'
                          ? 'rgba(127, 29, 29, 0.32)'
                          : 'rgba(69, 10, 10, 0.22)',
                  }}
                >
                  <div className="btn-row" style={{ flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    <span className="small" style={{ fontWeight: 700, color: '#fca5a5' }}>
                      Monster Actions:
                    </span>
                    {isWaitingForMonsterTurn ? (
                      <span className="tag tag-outline">
                        Waiting for Monster Turn{activeCombatant ? ` (${activeCombatant.name}'s turn)` : ''}
                      </span>
                    ) : activeMonTok ? (
                      <>
                        <strong className="small" style={{ color: '#fde68a' }}>
                          {activeMonTok.name} ({activeMonTok.hp ?? 0}/{activeMonTok.maxHp ?? 0} HP)
                        </strong>
                        {activeTurnMonsterId && <span className="tag tag-gold">ACTIVE TURN</span>}
                      </>
                    ) : null}

                    <button
                      type="button"
                      id="btn-monster-action-move"
                      className="btn btn-xs"
                      disabled={isWaitingForMonsterTurn || monMovedDone}
                      style={{
                        background:
                          isShowingThisMon && effectiveMode === 'monster_move' && !monMovedDone
                            ? 'rgba(248, 113, 113, 0.35)'
                            : 'rgba(248, 113, 113, 0.16)',
                        border:
                          isShowingThisMon && effectiveMode === 'monster_move' && !monMovedDone
                            ? '1.5px solid #f87171'
                            : '1px solid rgba(248, 113, 113, 0.55)',
                        color: monMovedDone ? '#94a3b8' : '#fecaca',
                        fontWeight: 700,
                      }}
                      onClick={() => {
                        if (activeMonTok) setSelectedTokenId(activeMonTok.id);
                        setBeatActionMode('monster_move');
                        setMapHint(
                          `Monster Move mode (Red): Tap an open red-highlighted space on the map to move ${activeMonTok?.name || 'the monster'}.`
                        );
                      }}
                    >
                      {monMovedDone ? 'Moved (Wait Turn)' : 'Move'}
                    </button>
                    {monMovedDone && activeMonTok && (
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        title="Allow this monster to move again this turn"
                        onClick={() =>
                          sendAction('story_action', {
                            subAction: 'reset_token_move',
                            beatId: beat.id,
                            tokenId: activeMonTok.id,
                          })
                        }
                      >
                        Reset Move
                      </button>
                    )}

                    <button
                      type="button"
                      id="btn-monster-action-attack"
                      className="btn btn-xs"
                      disabled={isWaitingForMonsterTurn}
                      style={{
                        background:
                          isShowingThisMon && effectiveMode === 'monster_attack'
                            ? 'linear-gradient(135deg, #dc2626, #991b1b)'
                            : 'rgba(220, 38, 38, 0.28)',
                        border:
                          isShowingThisMon && effectiveMode === 'monster_attack'
                            ? '1.5px solid #ef4444'
                            : '1px solid rgba(239, 68, 68, 0.75)',
                        color: '#ffffff',
                        fontWeight: 800,
                        boxShadow:
                          isShowingThisMon && effectiveMode === 'monster_attack'
                            ? '0 0 10px rgba(220, 38, 38, 0.55)'
                            : undefined,
                      }}
                      onClick={() => {
                        if (activeMonTok) setSelectedTokenId(activeMonTok.id);
                        setBeatActionMode('monster_attack');
                        setMapHint(
                          `Monster Attack mode (Deep Red): Tap a player inside the deep-red range on the map to attack with ${activeMonTok?.name || 'the monster'}!`
                        );
                      }}
                    >
                      Attack
                    </button>

                    <button
                      type="button"
                      id="btn-monster-action-skill"
                      className="btn btn-xs"
                      disabled={isWaitingForMonsterTurn}
                      style={{
                        background:
                          isShowingThisMon && effectiveMode === 'monster_skill'
                            ? 'linear-gradient(135deg, #c026d3, #e11d48)'
                            : 'linear-gradient(135deg, rgba(192, 38, 211, 0.28), rgba(225, 29, 72, 0.28))',
                        border:
                          isShowingThisMon && effectiveMode === 'monster_skill'
                            ? '1.5px solid #f43f5e'
                            : '1px solid rgba(217, 70, 239, 0.75)',
                        color: '#fdf4ff',
                        fontWeight: 800,
                        boxShadow:
                          isShowingThisMon && effectiveMode === 'monster_skill'
                            ? '0 0 10px rgba(192, 38, 211, 0.55)'
                            : undefined,
                      }}
                      onClick={() => {
                        if (activeMonTok) {
                          setSelectedTokenId(activeMonTok.id);
                          setSkillTrayOpenForMonster(activeMonTok.id);
                          if (!selectedMonsterSkillId[activeMonTok.id] && pickedSkillId) {
                            setSelectedMonsterSkillId((prev) => ({ ...prev, [activeMonTok.id]: pickedSkillId }));
                          }
                        }
                        setBeatActionMode('monster_skill');
                        setMapHint(
                          `Monster Use Skills mode (Purple-Red): Pick a skill and tap a player in the purple-red range on the map (or click Unleash Skill)!`
                        );
                      }}
                    >
                      Use Skills
                    </button>

                    {activeMonTok && (
                      <>
                        <select
                          aria-label="Monster Live Attack Area"
                          value={
                            dmAreaOverrideByMonster[activeMonTok.id] ??
                            (effectiveMode === 'monster_skill'
                              ? monSkills.find((s) => s.id === pickedSkillId)?.attackArea
                              : undefined) ??
                            activeLiveMon?.attackArea ??
                            inferDefaultAttackAreaForMonster(activeLiveMon || { name: activeMonTok.name, maxHp: activeMonTok.maxHp })
                          }
                          onChange={(e) => {
                            const areaVal = e.target.value as AttackArea;
                            setSelectedTokenId(activeMonTok.id);
                            setDmAreaOverrideByMonster((prev) => ({ ...prev, [activeMonTok.id]: areaVal }));
                            if (beatActionMode === 'monster_move') setBeatActionMode('monster_attack');
                          }}
                          style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                        >
                          {PLAYER_ATTACK_AREAS.map((a) => (
                            <option key={a} value={a}>
                              Area: {formatMonsterAttackArea(a)}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Monster Live Attack Area Modifier"
                          value={
                            dmModOverrideByMonster[activeMonTok.id] ??
                            (effectiveMode === 'monster_skill'
                              ? monSkills.find((s) => s.id === pickedSkillId)?.attackAreaModifier
                              : undefined) ??
                            activeLiveMon?.attackAreaModifier ??
                            0
                          }
                          onChange={(e) => {
                            const modVal = Number(e.target.value);
                            setSelectedTokenId(activeMonTok.id);
                            setDmModOverrideByMonster((prev) => ({ ...prev, [activeMonTok.id]: modVal }));
                            if (beatActionMode === 'monster_move') setBeatActionMode('monster_attack');
                          }}
                          style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                        >
                          {[-2, -1, 0, 1, 2, 3, 4].map((m) => (
                            <option key={m} value={m}>
                              Mod: {m > 0 ? `+${m}` : m} Sp
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    <select
                      aria-label="Monster Heal or Effect"
                      value={dmHealBuffChoice}
                      onChange={(e) => setDmHealBuffChoice(e.target.value as 'none' | 'heal' | UnitEffectKind)}
                      style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                    >
                      <option value="none">Effect: None</option>
                      <option value="heal">Heal HP (2d6+2)</option>
                      {UNIT_EFFECT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {UNIT_EFFECT_META[k].category === 'buff' ? 'Buff' : 'Debuff'}: {UNIT_EFFECT_META[k].label}
                        </option>
                      ))}
                    </select>
                    {activeMonTok && dmHealBuffChoice !== 'none' && (dmHealBuffChoice === 'heal' || UNIT_EFFECT_META[dmHealBuffChoice].category === 'buff') && (
                      <button
                        type="button"
                        className="btn btn-xs btn-gold"
                        onClick={async () => {
                          await sendAction('unit_effect_action', {
                            subAction: 'apply',
                            targetType: 'monster',
                            targetId: activeMonTok.id,
                            ...buildChoicePayload(dmHealBuffChoice),
                            sourceName: 'DM Action',
                          });
                        }}
                      >
                        Apply Heal/Buff
                      </button>
                    )}
                    <button
                      type="button"
                      id="btn-monster-end-turn"
                      className="btn btn-xs btn-gold"
                      style={{ marginLeft: 'auto' }}
                      onClick={async () => {
                        await sendAction('initiative_action', { subAction: 'next_turn' });
                        setAimCell(null);
                        setSelectedTokenId(null);
                        pushLocalToast({ title: 'TURN ENDED', message: 'Passed turn to the next combatant.', category: 'info' });
                      }}
                    >
                      End Turn
                    </button>
                  </div>

                  {isShowingThisMon && effectiveMode === 'monster_skill' && activeMonTok && (
                    <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                      {monSkills.length > 0 ? (
                        <>
                          {monSkills.map((sk) => {
                            const rem = Number(sk.usesRemaining ?? sk.maxUsesPerCombat ?? 1);
                            const maxU = Number(sk.maxUsesPerCombat || 1);
                            const exhausted = rem <= 0;
                            const isPicked = pickedSkillId === sk.id;
                            return (
                              <button
                                key={sk.id}
                                type="button"
                                disabled={exhausted}
                                className="btn btn-xs"
                                style={{
                                  background: isPicked
                                    ? 'linear-gradient(135deg, #a21caf, #be123c)'
                                    : 'rgba(88, 28, 135, 0.3)',
                                  border: isPicked ? '1.5px solid #fb7185' : '1px solid rgba(192, 38, 211, 0.5)',
                                  color: exhausted ? '#94a3b8' : '#fce7f3',
                                }}
                                onClick={() => {
                                  setSelectedMonsterSkillId((prev) => ({ ...prev, [activeMonTok.id]: sk.id }));
                                }}
                              >
                                {sk.name} ({rem}/{maxU}) • {sk.damageFormula}
                              </button>
                            );
                          })}
                          {chars.length > 0 && pickedSkillId && (
                            <button
                              type="button"
                              className="btn btn-xs btn-crimson"
                              onClick={() =>
                                sendAction('monster_attack', {
                                  monsterId: activeMonTok.id,
                                  targetCharacterId: attackTargetByMonster[activeMonTok.id] || chars[0]?.id,
                                  skillId: pickedSkillId,
                                  ...buildChoicePayload(dmHealBuffChoice),
                                })
                              }
                            >
                              Unleash on {(chars.find((c) => c.id === (attackTargetByMonster[activeMonTok.id] || chars[0]?.id)) || chars[0])?.name}
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="small muted">No skills configured for {activeMonTok.name}.</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            <div
              id="beat-detail-status-strip"
              className="small"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 10px',
                marginBottom: '8px',
                borderRadius: '8px',
                background: 'rgba(15, 23, 42, 0.72)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span
                className={`tag ${
                  latestStatus?.category === 'combat'
                    ? 'tag-crimson'
                    : latestStatus?.category === 'warning'
                      ? 'tag-gold'
                      : latestStatus?.category === 'loot'
                        ? 'tag-green'
                        : 'tag-cyan'
                }`}
                style={{ flexShrink: 0 }}
              >
                {latestStatus?.title || 'ARENA STATUS'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: '#e2e8f0' }}>
                {latestStatus?.message || mapHint}
              </span>
            </div>
    </>
  );
}
