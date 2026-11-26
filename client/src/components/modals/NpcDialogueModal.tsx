import React, { useEffect, useState } from 'react';
import { useVtt } from '../../context/VttContext';
import { TokenIconSvg } from '../common/TokenIconSvg';

export function NpcDialogueModal() {
  const { activeNpcDialogue, setActiveNpcDialogue, state, session, sendAction } = useVtt();
  const [claiming, setClaiming] = useState(false);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (!activeNpcDialogue) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveNpcDialogue(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeNpcDialogue, setActiveNpcDialogue]);

  if (!activeNpcDialogue) return null;

  const beat = state?.storyBeats?.find((b) => b.id === activeNpcDialogue.beatId);
  const liveTok = beat?.arena?.tokens?.find(
    (t) => t.id === activeNpcDialogue.tokenId && t.type === 'npc',
  );

  const npcName = liveTok?.name || activeNpcDialogue.npcName;
  const npcRole = liveTok?.npcRole || activeNpcDialogue.npcRole || 'NPC';
  const iconId = liveTok?.iconId ?? activeNpcDialogue.iconId;
  const dialogue = liveTok?.dialogue || activeNpcDialogue.dialogue || 'Greetings, Climber.';

  const rewardType = liveTok?.rewardType ?? activeNpcDialogue.rewardType;
  const rewardXp = liveTok?.rewardXp ?? activeNpcDialogue.rewardXp ?? 0;
  const rewardGold = liveTok?.rewardGold ?? activeNpcDialogue.rewardGold ?? 0;
  const rewardItemName = liveTok?.rewardItemName ?? activeNpcDialogue.rewardItemName;
  const rewardSkillDesc = liveTok?.rewardSkillDesc ?? activeNpcDialogue.rewardSkillDesc;

  const hasReward =
    (Boolean(rewardType) && rewardType !== 'none') || Number(rewardGold || 0) > 0;
  const isClaimed = Boolean(liveTok?.rewardClaimed ?? activeNpcDialogue.rewardClaimed);
  const hasUnclaimedReward = hasReward && !isClaimed;

  const previewChips: string[] = [];
  if (rewardType === 'xp' && Number(rewardXp) > 0) {
    previewChips.push(`+${rewardXp} XP`);
  } else if (rewardType === 'item' && rewardItemName) {
    previewChips.push(`Item: ${rewardItemName}`);
  } else if (rewardType === 'skill_book' && rewardItemName) {
    const cleanSkill = rewardItemName.replace(/^skill\s*book:\s*/i, '').trim() || rewardItemName;
    previewChips.push(`Skill Book: ${cleanSkill}`);
  }
  if (Number(rewardGold) > 0) {
    previewChips.push(`${rewardGold}G`);
  }

  const claimedNotes = activeNpcDialogue.claimedNotes;

  const handleAcceptGift = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      const res = await sendAction<{
        npcDialogue?: {
          dialogue?: string;
          rewardNotes?: string[];
          rewardClaimed?: boolean;
        };
      }>('story_action', {
        subAction: 'talk_beat_npc',
        beatId: activeNpcDialogue.beatId,
        tokenId: activeNpcDialogue.tokenId,
        characterId: session?.characterId || null,
      });
      const notes =
        res?.npcDialogue?.rewardNotes && res.npcDialogue.rewardNotes.length > 0
          ? res.npcDialogue.rewardNotes
          : previewChips;
      setActiveNpcDialogue({
        ...activeNpcDialogue,
        dialogue: res?.npcDialogue?.dialogue || dialogue,
        rewardClaimed: true,
        claimedNotes: notes,
      });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div
      id="npc-dialogue-modal"
      className="modal-backdrop open npc-dialog-backdrop"
      style={{ zIndex: 9060 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="npc-dialog-speaker-name"
      onClick={() => setActiveNpcDialogue(null)}
    >
      <div className="modal-card npc-dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="npc-dialog-head">
          <div className="npc-dialog-avatar">
            <TokenIconSvg type="npc" name={npcName} iconId={iconId} size={46} />
          </div>
          <div className="npc-dialog-speaker">
            <span className="tag tag-green npc-dialog-role">{npcRole}</span>
            <h2 id="npc-dialog-speaker-name" className="npc-dialog-name">
              {npcName}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-outline npc-dialog-x"
            aria-label="Close NPC Dialogue"
            onClick={() => setActiveNpcDialogue(null)}
          >
            &times;
          </button>
        </div>

        <div className="npc-dialog-box">
          <span className="npc-dialog-quote" aria-hidden="true">
            &ldquo;
          </span>
          <p className="npc-dialog-text">{dialogue}</p>
        </div>

        {claimedNotes && claimedNotes.length > 0 ? (
          <div className="npc-dialog-reward is-claimed">
            <div className="npc-dialog-reward-label">GIFT RECEIVED</div>
            <div className="npc-dialog-chips">
              {claimedNotes.map((note, idx) => (
                <span key={`${note}-${idx}`} className="tag tag-gold">
                  {note}
                </span>
              ))}
            </div>
          </div>
        ) : hasUnclaimedReward ? (
          <div className="npc-dialog-reward is-offer">
            <div className="npc-dialog-reward-label">OFFERS A GIFT</div>
            <div className="npc-dialog-chips">
              {previewChips.map((chip, idx) => (
                <span key={`${chip}-${idx}`} className="tag tag-gold">
                  {chip}
                </span>
              ))}
            </div>
            {rewardSkillDesc && rewardType === 'skill_book' && (
              <div className="small muted" style={{ marginTop: '6px' }}>
                {rewardSkillDesc}
              </div>
            )}
          </div>
        ) : hasReward && isClaimed ? (
          <div className="npc-dialog-reward-muted">
            <span className="tag tag-outline small muted">Gift already claimed</span>
          </div>
        ) : null}

        {liveTok?.recruitable && (
          <div className="npc-dialog-reward is-offer" style={{ marginTop: '8px' }}>
            <div className="npc-dialog-reward-label">SETTLEMENT RECRUITMENT</div>
            {liveTok.recruitedToSettlementId ? (
              <span className="tag tag-green">Resident of Settlement ✓</span>
            ) : (
              <div className="btn-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span className="small muted">
                  Role: <strong>{(liveTok.settlementRole || 'villager').toUpperCase()}</strong>
                </span>
                <button
                  type="button"
                  id="btn-npc-invite-settlement"
                  className="btn btn-sm btn-gold"
                  disabled={inviting}
                  onClick={async () => {
                    setInviting(true);
                    try {
                      await sendAction('settlement_action', {
                        subAction: 'invite_npc',
                        beatId: activeNpcDialogue.beatId,
                        tokenId: activeNpcDialogue.tokenId,
                      });
                    } finally {
                      setInviting(false);
                    }
                  }}
                >
                  {inviting ? 'Inviting...' : 'Invite to Settlement'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="npc-dialog-footer">
          {hasUnclaimedReward ? (
            <>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setActiveNpcDialogue(null)}
              >
                Close
              </button>
              <button
                type="button"
                id="btn-npc-accept-gift"
                className="btn btn-sm btn-gold"
                disabled={claiming}
                onClick={() => void handleAcceptGift()}
              >
                {claiming ? 'Claiming...' : 'Accept Gift'}
              </button>
            </>
          ) : (
            <button
              type="button"
              id="btn-npc-farewell"
              className="btn btn-sm btn-cyan npc-dialog-close-cta"
              onClick={() => setActiveNpcDialogue(null)}
            >
              Farewell
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
