import { useEffect, useRef, useState } from 'react';
import {
  resolvePlayerReactionStyle,
  spaceDistanceBetweenPoints,
  type MonsterDefeatSummary,
  type PendingReaction,
} from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { PolyhedralDieSvg } from '../common/DiceTrayStage';

interface ResolutionReport {
  clash: PendingReaction;
  summary: string;
  dmgTaken: number;
  counterDamageDealt: number;
}

export function CombatClashModal() {
  const { session, state, sendAction, setDefeatedMonster } = useVtt();

  const [dmRolling, setDmRolling] = useState(false);
  const [dmFlicker, setDmFlicker] = useState(12);
  const [playerRolling, setPlayerRolling] = useState(false);
  const [playerFlicker, setPlayerFlicker] = useState(14);
  const [spellDmgFlicker, setSpellDmgFlicker] = useState(8);
  const [spellPickerOpen, setSpellPickerOpen] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Record<string, boolean>>({});
  const [resolutionReport, setResolutionReport] = useState<ResolutionReport | null>(null);

  const lastSeenReactionIdRef = useRef<string | null>(null);
  const lastSeenResolvedIdRef = useRef<string | null>(null);

  const isDm = session?.role === 'dm';
  const myCharId = session?.characterId || null;

  const pendingReaction: PendingReaction | undefined = (state?.pendingReactions || []).find(
    (r) => isDm || !myCharId || r.targetCharacterId === myCharId,
  );
  const resolvedClash: PendingReaction | null | undefined =
    state?.lastResolvedClash &&
    (isDm || !myCharId || state.lastResolvedClash.targetCharacterId === myCharId)
      ? state.lastResolvedClash
      : null;

  const pendingOrResolvedClash: PendingReaction | null =
    pendingReaction && !dismissedIds[`pending-${pendingReaction.id}`]
      ? pendingReaction
      : resolvedClash && !dismissedIds[`resolved-${resolvedClash.id}`]
        ? resolvedClash
        : null;

  useEffect(() => {
    if (!pendingReaction?.id) return;
    if (lastSeenReactionIdRef.current === pendingReaction.id) return;
    lastSeenReactionIdRef.current = pendingReaction.id;

    setPlayerRolling(false);
    setSpellPickerOpen(false);
    setDmRolling(true);
    setDmFlicker(Math.floor(Math.random() * 20) + 1);
    const tick = window.setInterval(() => {
      setDmFlicker(Math.floor(Math.random() * 20) + 1);
    }, 65);
    const stop = window.setTimeout(() => {
      window.clearInterval(tick);
      setDmRolling(false);
    }, 650);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(stop);
    };
  }, [pendingReaction?.id]);

  useEffect(() => {
    if (!resolvedClash || !resolvedClash.resolved) return;
    const key = `${resolvedClash.id}-${resolvedClash.resolvedAt || ''}`;
    if (lastSeenResolvedIdRef.current === key) return;
    lastSeenResolvedIdRef.current = key;

    setPlayerRolling(true);
    setPlayerFlicker(Math.floor(Math.random() * 20) + 1);
    setSpellDmgFlicker(Math.floor(Math.random() * 12) + 1);
    const tick = window.setInterval(() => {
      setPlayerFlicker(Math.floor(Math.random() * 20) + 1);
      setSpellDmgFlicker(Math.floor(Math.random() * 12) + 1);
    }, 65);
    const stop = window.setTimeout(() => {
      window.clearInterval(tick);
      setPlayerRolling(false);
    }, 650);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(stop);
    };
  }, [resolvedClash?.id, resolvedClash?.resolvedAt]);

  if (!session || !state) return null;

  const activeClash = resolutionReport ? resolutionReport.clash : pendingOrResolvedClash;
  if (!activeClash) return null;

  const targetChar = state.characters?.[activeClash.targetCharacterId];
  const monster = (state.monsters || []).find((m) => m.id === activeClash.monsterId);
  const isResolved = Boolean(resolutionReport || activeClash.resolved);

  const activeBeat = (state.storyBeats || []).find(
    (b) =>
      b.beatType !== 'narration' &&
      b.status !== 'resolved' &&
      b.status !== 'failed' &&
      (b.arena?.tokens || []).some((t) => t.id === activeClash.monsterId),
  );
  const playerTok = activeBeat?.arena?.tokens?.find((t) => t.id === activeClash.targetCharacterId);
  const monTok = activeBeat?.arena?.tokens?.find((t) => t.id === activeClash.monsterId);
  const monsterDist =
    playerTok && monTok
      ? spaceDistanceBetweenPoints(playerTok.x, playerTok.y, monTok.x, monTok.y)
      : null;

  const playerSpells = targetChar?.spells || [];
  const reactionSpells = playerSpells.filter((sp) => sp.actionType === 'Reaction');
  const usableReactionSpells = reactionSpells.filter((sp) => {
    if (Number(targetChar?.mp || 0) < Number(sp.mpCost || 0)) return false;
    const isSelfOnly = Boolean(sp.effectSpec?.target === 'self' && !sp.damageDice);
    if (!isSelfOnly && monsterDist !== null) {
      const range = Math.max(1, Number(sp.rangeSpaces || 3));
      if (monsterDist > range) return false;
    }
    return true;
  });

  const styleInfo = resolvePlayerReactionStyle(targetChar);

  const handleContinue = () => {
    if (!isResolved || playerRolling) return;
    setDismissedIds((prev) => ({
      ...prev,
      [`pending-${activeClash.id}`]: true,
      [`resolved-${activeClash.id}`]: true,
    }));
    setResolutionReport(null);
  };

  const handlePlayerReactionRoll = async (choice: 'react' | 'spell' | 'dodge', spellIdOverride?: string) => {
    if (playerRolling) return;
    const clashSnapshot = activeClash;
    setPlayerRolling(true);
    setPlayerFlicker(Math.floor(Math.random() * 20) + 1);
    setSpellDmgFlicker(Math.floor(Math.random() * 12) + 1);
    const tick = window.setInterval(() => {
      setPlayerFlicker(Math.floor(Math.random() * 20) + 1);
      setSpellDmgFlicker(Math.floor(Math.random() * 12) + 1);
    }, 65);
    try {
      const res = await sendAction<{
        summary?: string;
        dmgTaken?: number;
        counterDamageDealt?: number;
        resolvedClash?: PendingReaction;
        defeatSummary?: MonsterDefeatSummary | null;
      }>('resolve_reaction', {
        reactionId: clashSnapshot.id,
        choice,
        spellId: choice === 'spell' ? spellIdOverride : undefined,
      });
      window.clearInterval(tick);
      setPlayerRolling(false);
      if (res?.defeatSummary && res.defeatSummary.monsterId === clashSnapshot.monsterId) {
        setDismissedIds((prev) => ({
          ...prev,
          [`pending-${clashSnapshot.id}`]: true,
          [`resolved-${clashSnapshot.id}`]: true,
        }));
        setResolutionReport(null);
        setDefeatedMonster(res.defeatSummary);
        return;
      }
      if (res) {
        const mergedClash: PendingReaction = {
          ...(res.resolvedClash || clashSnapshot),
          resolved: true,
          playerChoice: res.resolvedClash?.playerChoice ?? choice,
          dmgTaken: Number(res.dmgTaken ?? res.resolvedClash?.dmgTaken ?? 0),
          counterDamageDealt: Number(res.counterDamageDealt ?? res.resolvedClash?.counterDamageDealt ?? 0),
          resolutionSummary: res.summary || res.resolvedClash?.resolutionSummary || 'Reaction resolved.',
        };
        setResolutionReport({
          clash: mergedClash,
          summary: mergedClash.resolutionSummary || 'Reaction resolved.',
          dmgTaken: Number(mergedClash.dmgTaken ?? 0),
          counterDamageDealt: Number(mergedClash.counterDamageDealt ?? 0),
        });
      }
    } catch {
      window.clearInterval(tick);
      setPlayerRolling(false);
    }
  };

  const dmSuccess = activeClash.attackHit !== false;
  const playerSuccess = Boolean(activeClash.playerSuccess);
  const canSeeMonsterHp = isDm || Boolean(monster?.observedByViewer);

  const spellAcc = activeClash.spellAccuracyRoll;
  const spellDmg = activeClash.spellDamageRoll;
  const isSpellClash = activeClash.playerChoice === 'spell' && Boolean(spellAcc);

  const outcomeTitle = (() => {
    if (!playerSuccess) {
      if (activeClash.playerChoice === 'spell') return 'SPELL MISSED!';
      if (activeClash.playerChoice === 'dodge') return 'DODGE FAILED!';
      return 'HIT TAKEN';
    }
    if (activeClash.playerChoice === 'dodge') return 'DODGED!';
    if (activeClash.playerChoice === 'spell') return 'SPELL HIT!';
    if (activeClash.reactionStyle === 'block') return 'BLOCKED!';
    if (activeClash.reactionStyle === 'counter' || activeClash.playerChoice === 'counter') return 'COUNTER-ATTACK!';
    return 'PARRIED!';
  })();

  const responseMod = Number(activeClash.playerRollMod ?? 0);
  const responseModText = responseMod >= 0 ? `+${responseMod}` : String(responseMod);

  return (
    <div id="combat-clash-modal" className="modal-backdrop open clash-modal-backdrop">
      <div
        className={`modal-card clash-modal-card ${
          isResolved ? (playerSuccess ? 'is-win' : 'is-loss') : 'is-pending'
        }`}
      >
        <div className="clash-modal-head">
          <div className="clash-modal-badges">
            <span className="tag tag-crimson">OPPOSED DICE CLASH</span>
            {activeClash.skillName && (
              <span className="tag tag-purple">{activeClash.skillName}</span>
            )}
            <span className={`tag ${isResolved ? 'tag-green' : 'tag-cyan'}`}>
              {isResolved ? 'RESOLVED' : 'YOUR REACTION'}
            </span>
          </div>
          <h2 className="clash-modal-title">
            {activeClash.monsterName} attacks {activeClash.targetCharacterName}!
          </h2>
        </div>

        {/* Two-Column Opposed Dice Stage */}
        <div className="clash-stage">
          {/* LEFT: Monster Attack */}
          <div className="clash-side-card is-monster">
            <div className="clash-side-label">MONSTER ATTACK</div>
            <div className="clash-side-sub">{activeClash.monsterName}</div>

            <div className={`clash-die-box is-monster ${dmRolling ? 'rolling' : 'landed'}`}>
              <div className="clash-die-bg">
                <PolyhedralDieSvg sides={20} />
              </div>
              <span className="clash-die-num">
                {dmRolling ? dmFlicker : activeClash.attackTotal}
              </span>
            </div>

            {!dmRolling && (
              <div className="clash-side-meta">
                <span className={`tag ${dmSuccess ? 'tag-crimson' : 'tag-cyan'}`}>
                  {dmSuccess ? 'HIT' : 'GRAZE'} &bull; {activeClash.incomingDamage} DMG
                </span>
              </div>
            )}
          </div>

          {/* RIGHT: Player Response */}
          <div
            className={`clash-side-card is-player ${
              isResolved ? (playerSuccess ? 'is-win' : 'is-loss') : ''
            }`}
          >
            <div className="clash-side-label">YOUR RESPONSE</div>
            <div className="clash-side-sub">
              {isResolved
                ? activeClash.spellName || String(activeClash.reactionStyle || activeClash.playerChoice || 'Reaction').toUpperCase()
                : activeClash.targetCharacterName}
            </div>

            {isSpellClash && spellAcc && isResolved ? (
              <div className="clash-spell-dice-row">
                <div className="clash-spell-die-col">
                  <span className="clash-spell-die-tag">Acc [1d20]</span>
                  <div
                    className={`clash-die-box is-compact ${
                      playerRolling ? 'rolling' : spellAcc.hit ? 'is-win' : 'is-loss'
                    }`}
                  >
                    <div className="clash-die-bg">
                      <PolyhedralDieSvg sides={20} />
                    </div>
                    <span className="clash-die-num">
                      {playerRolling ? playerFlicker : spellAcc.total}
                    </span>
                  </div>
                  {!playerRolling && (
                    <span className={`tag small ${spellAcc.hit ? 'tag-green' : 'tag-crimson'}`}>
                      {spellAcc.hit ? 'HIT' : 'MISS'}
                    </span>
                  )}
                </div>

                {spellAcc.hit && spellDmg && (
                  <div className="clash-spell-die-col">
                    <span className="clash-spell-die-tag">Dmg [{spellDmg.formula}]</span>
                    <div className={`clash-die-box is-compact is-dmg ${playerRolling ? 'rolling' : 'is-win'}`}>
                      <div className="clash-die-bg">
                        <PolyhedralDieSvg sides={8} />
                      </div>
                      <span className="clash-die-num">
                        {playerRolling ? spellDmgFlicker : activeClash.counterDamageDealt ?? spellDmg.total}
                      </span>
                    </div>
                    {!playerRolling && (
                      <span className="tag small tag-gold">
                        [{spellDmg.rolls.join('+')}]
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div
                  className={`clash-die-box is-player ${
                    playerRolling ? 'rolling' : isResolved ? (playerSuccess ? 'is-win' : 'is-loss') : ''
                  }`}
                >
                  <div className="clash-die-bg">
                    <PolyhedralDieSvg sides={20} />
                  </div>
                  <span className="clash-die-num">
                    {playerRolling
                      ? playerFlicker
                      : isResolved
                        ? activeClash.playerRollTotal ?? '—'
                        : '?'}
                  </span>
                </div>

                {!isResolved && !playerRolling && (
                  <div className="clash-side-meta">
                    <span className="small muted">Choose 1 of 3 reactions below</span>
                  </div>
                )}

                {isResolved && !playerRolling && (
                  <div className="clash-side-meta">
                    <span className={`tag ${playerSuccess ? 'tag-green' : 'tag-gold'}`}>
                      {playerSuccess ? 'SUCCESS' : 'FAILED'}
                    </span>
                    <div className="small muted">
                      d20: <b>{activeClash.playerRollNatural ?? '?'}</b> ({responseModText})
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Exactly 3 Player Options (or inline Reaction Spell Picker) when unresolved */}
        {!isResolved && (
          <div className="clash-actions-wrap">
            {!spellPickerOpen ? (
              <div className="clash-actions-3">
                <button
                  type="button"
                  id="btn-clash-react"
                  className="clash-action-btn is-react"
                  disabled={playerRolling}
                  onClick={() => void handlePlayerReactionRoll('react')}
                >
                  <div className="clash-action-top">
                    <strong>React: {styleInfo.label}</strong>
                    <span className="tag tag-cyan">{styleInfo.statTag}</span>
                  </div>
                  <span className="clash-action-sub">{styleInfo.shortDesc}</span>
                </button>

                <button
                  type="button"
                  id="btn-clash-spell"
                  className="clash-action-btn is-spell"
                  disabled={playerRolling || usableReactionSpells.length === 0}
                  onClick={() => setSpellPickerOpen(true)}
                >
                  <div className="clash-action-top">
                    <strong>Use Spell</strong>
                    <span className="tag tag-purple">
                      {usableReactionSpells.length > 0 ? `${usableReactionSpells.length} Ready` : 'NONE'}
                    </span>
                  </div>
                  <span className="clash-action-sub">
                    {usableReactionSpells.length > 0
                      ? 'Select a reaction spell'
                      : reactionSpells.length > 0
                        ? 'Low MP or out of range'
                        : 'No reaction spell'}
                  </span>
                </button>

                <button
                  type="button"
                  id="btn-clash-dodge"
                  className="clash-action-btn is-dodge"
                  disabled={playerRolling}
                  onClick={() => void handlePlayerReactionRoll('dodge')}
                >
                  <div className="clash-action-top">
                    <strong>Dodge</strong>
                    <span className="tag tag-gold">AGI</span>
                  </div>
                  <span className="clash-action-sub">0 dmg on win, full on fail</span>
                </button>
              </div>
            ) : (
              <div className="clash-spell-list-panel">
                <div className="clash-spell-list-head">
                  <strong className="small" style={{ color: '#e9d5ff' }}>
                    SELECT REACTION SPELL
                  </strong>
                  <button
                    type="button"
                    className="btn btn-xs btn-outline"
                    disabled={playerRolling}
                    onClick={() => setSpellPickerOpen(false)}
                  >
                    &larr; Back
                  </button>
                </div>
                <div className="clash-spell-list">
                  {usableReactionSpells.map((sp) => (
                    <button
                      key={sp.id}
                      type="button"
                      className="clash-spell-choice-btn"
                      disabled={playerRolling}
                      onClick={() => {
                        setSpellPickerOpen(false);
                        void handlePlayerReactionRoll('spell', sp.id);
                      }}
                    >
                      <div className="clash-action-top">
                        <strong>{sp.name}</strong>
                        <span className="tag tag-purple">{sp.mpCost} MP</span>
                      </div>
                      <span className="clash-action-sub">
                        {sp.damageDice || 'Support'} &bull; {sp.rangeSpaces || 3} Sp &bull; INT Accuracy
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Clear Resolution Summary Banner */}
        {isResolved && !playerRolling && (
          <div className={`clash-result-banner ${playerSuccess ? 'is-win' : 'is-loss'}`}>
            <div className="clash-result-top">
              <strong className="clash-result-title">{outcomeTitle}</strong>
              <div className="btn-row" style={{ gap: '6px', flexWrap: 'wrap' }}>
                <span className="tag tag-crimson">Taken: {activeClash.dmgTaken ?? 0} HP</span>
                {(activeClash.counterDamageDealt || 0) > 0 && (
                  <span className="tag tag-gold">Dealt: {activeClash.counterDamageDealt} HP</span>
                )}
              </div>
            </div>

            <div className="clash-result-summary">{activeClash.resolutionSummary}</div>

            <div className="clash-hp-bars">
              {targetChar && (
                <div className="clash-hp-item">
                  <div className="clash-hp-top small">
                    <span style={{ fontWeight: 700, color: '#7dd3fc' }}>{targetChar.name}</span>
                    <b style={{ color: '#f8fafc' }}>
                      {targetChar.hp}/{targetChar.maxHp} HP
                    </b>
                  </div>
                  <div className="progress">
                    <div
                      className="progress-fill hp"
                      style={{
                        width: `${
                          targetChar.maxHp > 0
                            ? Math.max(0, Math.min(100, (targetChar.hp / targetChar.maxHp) * 100))
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {monster && (
                <div className="clash-hp-item">
                  <div className="clash-hp-top small">
                    <span style={{ fontWeight: 700, color: '#fca5a5' }}>{monster.name}</span>
                    {canSeeMonsterHp && monster.hp !== null && monster.maxHp ? (
                      <b style={{ color: '#f87171' }}>
                        {monster.hp}/{monster.maxHp} HP
                      </b>
                    ) : null}
                  </div>
                  <div className="progress">
                    <div
                      className="progress-fill monster"
                      style={{
                        width: `${
                          monster.hp !== null && monster.maxHp
                            ? Math.max(0, Math.min(100, (monster.hp / monster.maxHp) * 100))
                            : Math.max(0, Math.min(100, Number(monster.hpPct ?? 100)))
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Continue button only shown once resolved */}
        {isResolved && !playerRolling && (
          <div className="clash-modal-footer">
            <button
              type="button"
              id="btn-close-combat-resolution"
              className="btn btn-sm btn-cyan"
              onClick={handleContinue}
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
