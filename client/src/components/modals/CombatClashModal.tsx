import { useEffect, useRef, useState } from 'react';
import type { PendingReaction } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { PolyhedralDieSvg } from '../common/DiceTrayStage';

export function CombatClashModal() {
  const { session, state, sendAction, pushLocalToast } = useVtt();

  const [dmRolling, setDmRolling] = useState(false);
  const [dmFlicker, setDmFlicker] = useState(12);
  const [playerRolling, setPlayerRolling] = useState(false);
  const [playerFlicker, setPlayerFlicker] = useState(14);
  const [selectedSpellId, setSelectedSpellId] = useState('');
  const [dismissedIds, setDismissedIds] = useState<Record<string, boolean>>({});

  const lastSeenReactionIdRef = useRef<string | null>(null);
  const lastSeenResolvedIdRef = useRef<string | null>(null);

  const isDm = session?.role === 'dm';
  const myCharId = session?.characterId || null;

  // Find active pending reaction relevant to this user (or latest resolved clash if not dismissed)
  const pendingReaction: PendingReaction | undefined = (state?.pendingReactions || []).find(
    (r) => isDm || !myCharId || r.targetCharacterId === myCharId,
  );
  const resolvedClash: PendingReaction | null | undefined =
    state?.lastResolvedClash &&
    (isDm || !myCharId || state.lastResolvedClash.targetCharacterId === myCharId)
      ? state.lastResolvedClash
      : null;

  const activeClash: PendingReaction | null =
    pendingReaction && !dismissedIds[`pending-${pendingReaction.id}`]
      ? pendingReaction
      : resolvedClash && !dismissedIds[`resolved-${resolvedClash.id}`]
        ? resolvedClash
        : null;

  // Trigger DM Die Roll animation whenever a new PendingReaction arrives
  useEffect(() => {
    if (!session || !state || !pendingReaction) return;
    if (lastSeenReactionIdRef.current === pendingReaction.id) return;
    lastSeenReactionIdRef.current = pendingReaction.id;

    setDmRolling(true);
    setDmFlicker(Math.floor(Math.random() * 20) + 1);
    const tick = window.setInterval(() => {
      setDmFlicker(Math.floor(Math.random() * 20) + 1);
    }, 65);
    const stop = window.setTimeout(() => {
      window.clearInterval(tick);
      setDmRolling(false);
    }, 750);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(stop);
    };
  }, [session, state, pendingReaction?.id]);

  // Trigger Player Die Roll animation whenever a clash transitions to resolved
  useEffect(() => {
    if (!session || !state || !resolvedClash || !resolvedClash.resolved) return;
    const key = `${resolvedClash.id}-${resolvedClash.resolvedAt || ''}`;
    if (lastSeenResolvedIdRef.current === key) return;
    lastSeenResolvedIdRef.current = key;

    setPlayerRolling(true);
    setPlayerFlicker(Math.floor(Math.random() * 20) + 1);
    const tick = window.setInterval(() => {
      setPlayerFlicker(Math.floor(Math.random() * 20) + 1);
    }, 65);
    const stop = window.setTimeout(() => {
      window.clearInterval(tick);
      setPlayerRolling(false);
    }, 800);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(stop);
    };
  }, [session, state, resolvedClash?.id, resolvedClash?.resolvedAt]);

  if (!session || !state || !activeClash) return null;

  const targetChar = state.characters?.[activeClash.targetCharacterId];
  const monster = (state.monsters || []).find((m) => m.id === activeClash.monsterId);
  const isResolved = Boolean(activeClash.resolved);

  const playerSpells = targetChar?.spells || [];
  const affordableSpells = playerSpells.filter((s) => Number(targetChar?.mp || 0) >= Number(s.mpCost || 0));
  const defaultSpell =
    affordableSpells.find((s) => s.actionType === 'Reaction') || affordableSpells[0];
  const activeSpellId = selectedSpellId || defaultSpell?.id || '';

  const handleClose = () => {
    const key = isResolved ? `resolved-${activeClash.id}` : `pending-${activeClash.id}`;
    setDismissedIds((prev) => ({ ...prev, [key]: true }));
  };

  const handlePlayerReactionRoll = async (choice: 'parry' | 'counter' | 'spell' | 'accept') => {
    setPlayerRolling(true);
    try {
      const res = await sendAction<{ summary?: string }>('resolve_reaction', {
        reactionId: activeClash.id,
        choice,
        spellId: choice === 'spell' ? activeSpellId : undefined,
      });
      if (res?.summary) {
        pushLocalToast({
          title: 'CLASH RESOLVED!',
          message: res.summary,
          category: 'combat',
        });
      }
    } catch {
      setPlayerRolling(false);
    }
  };

  const dmSuccess = activeClash.attackHit !== false;
  const playerSuccess = Boolean(activeClash.playerSuccess);

  return (
    <div id="combat-clash-modal" className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          maxWidth: '640px',
          width: '95%',
          border: `1.5px solid ${isResolved ? (playerSuccess ? '#10b981' : '#f59e0b') : '#ef4444'}`,
          boxShadow: '0 0 42px rgba(239, 68, 68, 0.32)',
        }}
      >
        <div className="panel-header">
          <div>
            <div className="btn-row" style={{ alignItems: 'center', marginBottom: '3px' }}>
              <span className="tag tag-crimson">OPPOSED DICE CLASH</span>
              <span className="tag tag-gold">
                {activeClash.monsterName} vs {activeClash.targetCharacterName}
              </span>
              {activeClash.skillName && (
                <span className="tag tag-purple">SKILL: {activeClash.skillName.toUpperCase()}</span>
              )}
              <span className={`tag ${isResolved ? 'tag-green' : 'tag-cyan'}`}>
                {isResolved ? 'BOTH ROLLED • RESOLVED' : 'STEP 2: PLAYER REACTION ROLL'}
              </span>
            </div>
            <h3 style={{ margin: 0 }}>
              {isResolved
                ? 'Clash Resolved — Dice Roll Summary'
                : activeClash.skillName
                  ? `${activeClash.monsterName} Unleashes "${activeClash.skillName}" on ${activeClash.targetCharacterName}!`
                  : `${activeClash.monsterName} Attacks ${activeClash.targetCharacterName}!`}
            </h3>
          </div>
          <button type="button" className="btn btn-xs btn-outline" onClick={handleClose}>
            Close
          </button>
        </div>

        {/* Two-Column Opposed Dice Stage: DM / Monster Roll vs Player Reaction Roll */}
        <div className="grid-2 mt-sm" style={{ gap: '12px' }}>
          {/* LEFT: DM / Monster Attack Roll */}
          <div
            className="panel"
            style={{
              padding: '12px',
              textAlign: 'center',
              background: 'rgba(15, 23, 42, 0.82)',
              border: '1px solid rgba(239, 68, 68, 0.5)',
            }}
          >
            <div className="small" style={{ fontWeight: 700, color: '#fca5a5', marginBottom: '6px' }}>
              1. DM / MONSTER ATTACK ROLL
            </div>
            <div className="small muted" style={{ marginBottom: '8px' }}>
              {activeClash.monsterName} ({activeClash.attackFormula || '1d20+5'}) vs AC {activeClash.targetAc ?? targetChar?.ac ?? 12}
            </div>

            <div
              className={`attack-die-cube ${dmRolling ? 'rolling' : 'landed'}`}
              style={{
                position: 'relative',
                width: '88px',
                height: '88px',
                margin: '0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '18px',
                border: '2px solid #ef4444',
                background: 'radial-gradient(circle, rgba(30, 41, 59, 0.95), rgba(2, 6, 23, 0.98))',
                boxShadow: '0 0 22px rgba(239, 68, 68, 0.35)',
              }}
            >
              <div style={{ position: 'absolute', inset: '6px', opacity: 0.4 }}>
                <PolyhedralDieSvg sides={20} />
              </div>
              <span style={{ position: 'relative', zIndex: 2, fontSize: '1.8rem', fontWeight: 900, color: '#f8fafc' }}>
                {dmRolling ? dmFlicker : activeClash.attackTotal}
              </span>
            </div>

            {!dmRolling && (
              <div className="mt-xs">
                <span className={`tag ${dmSuccess ? 'tag-crimson' : 'tag-cyan'}`}>
                  {dmSuccess ? 'ATTACK HIT' : 'GRAZING STRIKE'} • {activeClash.incomingDamage} INCOMING DMG
                </span>
                <div className="small muted mt-xs">
                  To-Hit Total: <b>{activeClash.attackTotal}</b> • Damage Roll ({activeClash.formula}):{' '}
                  <b style={{ color: '#f87171' }}>{activeClash.incomingDamage}</b>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Player Defense / Reaction Roll */}
          <div
            className="panel"
            style={{
              padding: '12px',
              textAlign: 'center',
              background: 'rgba(15, 23, 42, 0.82)',
              border: `1px solid ${isResolved ? (playerSuccess ? '#10b981' : '#f59e0b') : 'rgba(56, 189, 248, 0.5)'}`,
            }}
          >
            <div className="small" style={{ fontWeight: 700, color: '#7dd3fc', marginBottom: '6px' }}>
              2. PLAYER DEFENSE / REACTION ROLL
            </div>
            <div className="small muted" style={{ marginBottom: '8px' }}>
              {activeClash.targetCharacterName} •{' '}
              {isResolved
                ? `Chose: ${String(activeClash.playerChoice || 'Reaction').toUpperCase()}`
                : 'Roll to Block, Counter, or Cast Reaction Spell'}
            </div>

            <div
              className={`attack-die-cube ${playerRolling ? 'rolling' : isResolved ? 'landed' : ''}`}
              style={{
                position: 'relative',
                width: '88px',
                height: '88px',
                margin: '0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '18px',
                border: `2px solid ${isResolved ? (playerSuccess ? '#10b981' : '#f59e0b') : '#38bdf8'}`,
                background: 'radial-gradient(circle, rgba(30, 41, 59, 0.95), rgba(2, 6, 23, 0.98))',
                boxShadow: `0 0 22px ${isResolved ? (playerSuccess ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)') : 'rgba(56,189,248,0.3)'}`,
              }}
            >
              <div style={{ position: 'absolute', inset: '6px', opacity: 0.4 }}>
                <PolyhedralDieSvg sides={20} />
              </div>
              <span
                style={{
                  position: 'relative',
                  zIndex: 2,
                  fontSize: '1.8rem',
                  fontWeight: 900,
                  color: playerRolling ? '#38bdf8' : isResolved ? (playerSuccess ? '#34d399' : '#fbbf24') : '#94a3b8',
                }}
              >
                {playerRolling ? playerFlicker : isResolved ? activeClash.playerRollTotal ?? '—' : '?'}
              </span>
            </div>

            {!isResolved && !playerRolling && (
              <div className="small muted mt-xs">
                {isDm
                  ? `Waiting for ${activeClash.targetCharacterName} to roll reaction (or roll below as DM)...`
                  : `Choose your reaction below to roll your defense die against DC ${activeClash.attackTotal}!`}
              </div>
            )}

            {isResolved && !playerRolling && (
              <div className="mt-xs">
                <span className={`tag ${playerSuccess ? 'tag-green' : 'tag-gold'}`}>
                  {playerSuccess ? 'SUCCESS!' : 'PARTIAL / FAILED'} • ROLLED {activeClash.playerRollTotal}
                </span>
                <div className="small muted mt-xs">
                  Formula: <b>{activeClash.playerRollFormula || '1d20'}</b> (Natural {activeClash.playerRollNatural ?? '?'}) vs Monster Hit{' '}
                  <b>{activeClash.attackTotal}</b>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons when waiting for Player Reaction Roll */}
        {!isResolved && (
          <div
            className="panel mt-sm"
            style={{
              padding: '12px',
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
            }}
          >
            <div className="small" style={{ fontWeight: 700, marginBottom: '8px', color: '#e2e8f0' }}>
              {isDm
                ? `DM Override — Roll Reaction for ${activeClash.targetCharacterName}:`
                : 'Roll Your Reaction Die:'}
            </div>

            {affordableSpells.length > 0 && (
              <div className="mb-xs">
                <label className="small muted">
                  <span>Reaction Spell Selection:</span>
                  <select
                    value={activeSpellId}
                    onChange={(e) => setSelectedSpellId(e.target.value)}
                    style={{ marginTop: '3px' }}
                  >
                    {affordableSpells.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name} ({sp.damageDice} • {sp.mpCost} MP)
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div className="grid-2" style={{ gap: '8px' }}>
              <button
                type="button"
                className="btn btn-sm btn-cyan"
                disabled={playerRolling}
                onClick={() => handlePlayerReactionRoll('parry')}
              >
                Roll to Parry / Block (d20 + AGI vs {activeClash.attackTotal})
              </button>
              <button
                type="button"
                className="btn btn-sm btn-crimson"
                disabled={playerRolling}
                onClick={() => handlePlayerReactionRoll('counter')}
              >
                Roll Counter-Attack (d20 + Weapon Strike)
              </button>
              <button
                type="button"
                className="btn btn-sm btn-purple"
                disabled={playerRolling || affordableSpells.length === 0}
                title={affordableSpells.length === 0 ? 'No known spell with enough MP' : undefined}
                onClick={() => handlePlayerReactionRoll('spell')}
              >
                Roll Reaction Spell ({defaultSpell ? defaultSpell.name : 'No Spell'})
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                disabled={playerRolling}
                onClick={() => handlePlayerReactionRoll('accept')}
              >
                Take Hit ({activeClash.incomingDamage} Raw Dmg)
              </button>
            </div>
          </div>
        )}

        {/* Final Resolution Summary Banner once both DM and Player have rolled */}
        {isResolved && !playerRolling && (
          <div
            className="panel mt-sm"
            style={{
              padding: '14px',
              background: playerSuccess ? 'rgba(6, 78, 59, 0.45)' : 'rgba(120, 53, 15, 0.42)',
              border: `1.5px solid ${playerSuccess ? '#10b981' : '#f59e0b'}`,
              borderRadius: '10px',
            }}
          >
            <div className="item-card-top" style={{ marginBottom: '6px' }}>
              <strong
                style={{
                  fontSize: '1.1rem',
                  color: playerSuccess ? '#34d399' : '#fbbf24',
                }}
              >
                {playerSuccess ? 'DEFENSE / REACTION SUCCEEDED!' : 'CLASH RESOLVED!'}
              </strong>
              <div className="btn-row">
                <span className="tag tag-crimson">
                  Damage Taken: {activeClash.dmgTaken ?? 0} HP
                </span>
                {(activeClash.counterDamageDealt || 0) > 0 && (
                  <span className="tag tag-gold">
                    Counter Damage Dealt: {activeClash.counterDamageDealt} HP
                  </span>
                )}
              </div>
            </div>

            <div style={{ color: '#f8fafc', fontSize: '0.96rem', fontWeight: 600 }}>
              {activeClash.resolutionSummary}
            </div>

            <div className="btn-row mt-xs small muted" style={{ justifyContent: 'space-between' }}>
              {targetChar && (
                <span>
                  {targetChar.name} HP: <b style={{ color: '#38bdf8' }}>{targetChar.hp}/{targetChar.maxHp}</b>
                </span>
              )}
              {monster && (
                <span>
                  {monster.name} HP:{' '}
                  <b style={{ color: '#f87171' }}>
                    {monster.hp !== null ? `${monster.hp}/${monster.maxHp}` : monster.healthTier || 'Active'}
                  </b>
                </span>
              )}
            </div>
          </div>
        )}

        <div className="btn-row mt-sm" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className={`btn ${isResolved ? 'btn-gold' : 'btn-outline'} btn-sm`}
            onClick={handleClose}
          >
            {isResolved ? 'Done' : 'Minimize'}
          </button>
        </div>
      </div>
    </div>
  );
}
