import { useEffect, useRef, useState } from 'react';
import { useVtt } from '../../context/VttContext';

interface TurnNotice {
  key: string;
  combatantName: string;
  combatantType: 'player' | 'monster' | string;
  round: number;
  beatTitle: string;
  floor: number;
}

export function TurnNotificationModal() {
  const { session, state, activeBeatDetailId } = useVtt();
  const [notice, setNotice] = useState<TurnNotice | null>(null);
  const lastTurnKeyRef = useRef<string | null>(null);

  const isDm = session?.role === 'dm';
  const myCharId = session?.characterId || null;

  // Determine the current combat story beat (either the beat currently open in View Beat, or the active presented combat beat)
  const currentBeat = state
    ? (activeBeatDetailId ? (state.storyBeats || []).find((b) => b.id === activeBeatDetailId) : undefined) ||
      (state.storyBeats || []).slice().reverse().find((b) => b.presented && b.status === 'active' && b.beatType !== 'narration') ||
      (state.storyBeats || []).slice().reverse().find((b) => b.presented && b.beatType !== 'narration')
    : undefined;

  const isCombatBeat = Boolean(
    currentBeat &&
      currentBeat.beatType !== 'narration' &&
      ((currentBeat.arena?.tokens || []).some((t) => t.type === 'monster') || (currentBeat.encounters || []).length > 0),
  );

  const combat = state?.combat;
  const activeCombatant =
    combat && Array.isArray(combat.combatants) && combat.combatants.length > 0
      ? combat.combatants[combat.turnIndex] || combat.combatants[0]
      : undefined;

  const turnKey =
    activeCombatant && combat
      ? `${combat.round || 1}-${combat.turnIndex || 0}-${activeCombatant.id}`
      : null;

  useEffect(() => {
    if (!session || !state || !isCombatBeat || !activeCombatant || !turnKey || !currentBeat) return;

    if (lastTurnKeyRef.current === turnKey) return;
    lastTurnKeyRef.current = turnKey;

    // Player's turn is up -> Show modal on that Player's screen: "It is now your turn"
    if (!isDm && activeCombatant.type === 'player' && myCharId && activeCombatant.id === myCharId) {
      setNotice({
        key: turnKey,
        combatantName: activeCombatant.name,
        combatantType: 'player',
        round: combat?.round || 1,
        beatTitle: currentBeat.title,
        floor: currentBeat.floor || 1,
      });
      return;
    }

    // Monster's turn is up -> Show modal on the DM's screen: "It's your turn to act"
    if (isDm && activeCombatant.type === 'monster') {
      setNotice({
        key: turnKey,
        combatantName: activeCombatant.name,
        combatantType: 'monster',
        round: combat?.round || 1,
        beatTitle: currentBeat.title,
        floor: currentBeat.floor || 1,
      });
    }
  }, [session, state, isCombatBeat, activeCombatant, turnKey, currentBeat, isDm, myCharId, combat?.round]);

  if (!session || !state || !notice) return null;

  const isMonsterTurn = notice.combatantType === 'monster';
  const borderColor = isMonsterTurn ? '#ef4444' : '#38bdf8';
  const glowColor = isMonsterTurn ? 'rgba(239, 68, 68, 0.35)' : 'rgba(56, 189, 248, 0.35)';

  return (
    <div id="turn-notification-modal" className="modal-backdrop" onClick={() => setNotice(null)}>
      <div
        className="modal-card"
        style={{
          maxWidth: '440px',
          width: '92%',
          border: `1.5px solid ${borderColor}`,
          boxShadow: `0 0 38px ${glowColor}`,
          textAlign: 'center',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <div style={{ textAlign: 'left' }}>
            <div className="btn-row" style={{ alignItems: 'center', marginBottom: '2px' }}>
              <span className={`tag ${isMonsterTurn ? 'tag-crimson' : 'tag-cyan'}`}>
                {isMonsterTurn ? 'MONSTER TURN • DM ACT' : 'PLAYER TURN'}
              </span>
              <span className="tag tag-gold">ROUND {notice.round}</span>
              <span className="tag tag-purple">{notice.floor}F</span>
            </div>
            <h3 style={{ margin: 0 }}>{notice.beatTitle}</h3>
          </div>
          <button type="button" className="btn btn-xs btn-outline" onClick={() => setNotice(null)}>
            Close
          </button>
        </div>

        <div
          className="panel mt-sm"
          style={{
            padding: '20px 14px',
            background: isMonsterTurn ? 'rgba(127, 29, 29, 0.35)' : 'rgba(12, 74, 110, 0.35)',
            border: `1.5px solid ${borderColor}`,
            borderRadius: '12px',
          }}
        >
          <div
            className="small"
            style={{
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: isMonsterTurn ? '#fca5a5' : '#7dd3fc',
              marginBottom: '6px',
            }}
          >
            ACTIVE COMBATANT: {notice.combatantName.toUpperCase()}
          </div>

          <div
            style={{
              fontSize: '1.45rem',
              fontWeight: 900,
              color: '#f8fafc',
              margin: '6px 0',
            }}
          >
            {isMonsterTurn ? "It's your turn to act" : 'It is now your turn'}
          </div>

          <div className="small muted mt-xs">
            {isMonsterTurn
              ? `Command ${notice.combatantName} on the Arena Map or use its Monster Attack / Skills in the Spawned Monsters panel.`
              : 'Use your Move, Attack, Cast Spell, Use Item, or Observe actions, then click End Turn when finished.'}
          </div>
        </div>

        <button
          type="button"
          className={`btn ${isMonsterTurn ? 'btn-crimson' : 'btn-gold'} btn-lg mt-sm`}
          style={{ width: '100%', fontWeight: 800 }}
          onClick={() => setNotice(null)}
        >
          {isMonsterTurn ? 'Act with Monster' : 'Start My Turn'}
        </button>
      </div>
    </div>
  );
}
