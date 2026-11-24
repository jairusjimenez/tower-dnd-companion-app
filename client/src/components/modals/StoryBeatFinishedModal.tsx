import { useEffect, useState } from 'react';
import type { Character, StoryBeat } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { SegmentedBar } from '../common/SegmentedBar';

export function StoryBeatFinishedModal() {
  const {
    session,
    state,
    activeBeatDetailId,
    setActiveBeatDetailId,
    activePromptModal,
    defeatedMonster,
    closeAllGameplayModals,
  } = useVtt();
  const [dismissedIds, setDismissedIds] = useState<Record<string, boolean>>({});

  const beat: StoryBeat | undefined =
    state && activeBeatDetailId
      ? (state.storyBeats || []).find((b) => b.id === activeBeatDetailId)
      : undefined;
  const isShowing = Boolean(
    session &&
      state &&
      activeBeatDetailId &&
      beat &&
      beat.status === 'resolved' &&
      !dismissedIds[beat.id] &&
      !activePromptModal &&
      !defeatedMonster,
  );

  useEffect(() => {
    if (isShowing) {
      closeAllGameplayModals();
    }
  }, [isShowing, closeAllGameplayModals]);

  if (!isShowing || !session || !state || !beat) return null;

  const prompts = beat.prompts || [];
  const spawnedCombatPrompt = prompts.find((p) => Boolean(p.spawnedCombatBeatId));
  const isCombatVictory = beat.beatType !== 'narration' || Boolean(beat.victorySummary);
  const victory = beat.victorySummary;

  // Collect loot & rewards across combat victory drops, prompts, stat checks, opened chests, and beat XP
  const lootEntries: Array<{ label: string; tone: 'gold' | 'green' | 'cyan' }> = [];
  if (victory) {
    const groupedItems = new Map<string, { name: string; category: string; tier?: string; qty: number }>();
    for (const it of victory.itemsLooted || []) {
      const key = `${it.name}|${it.category}|${it.tier || ''}`;
      const existing = groupedItems.get(key);
      if (existing) {
        existing.qty += 1;
      } else {
        groupedItems.set(key, { name: it.name, category: it.category, tier: it.tier, qty: 1 });
      }
    }
    for (const item of groupedItems.values()) {
      lootEntries.push({
        label: `${item.qty}x ${item.name} (${item.category}${item.tier ? ` • ${item.tier}` : ''})`,
        tone: 'gold',
      });
    }
  }
  if (beat.xpReward > 0 && !isCombatVictory) {
    lootEntries.push({ label: `Beat Completion: +${beat.xpReward} XP`, tone: 'cyan' });
  }
  for (const pr of prompts) {
    if (pr.triggeredRewardSummary) {
      lootEntries.push({ label: pr.triggeredRewardSummary, tone: 'gold' });
    }
    for (const r of pr.triggeredStatCheckResults || []) {
      if (r.passed && r.rewardSummary) {
        lootEntries.push({ label: `${r.characterName}: ${r.rewardSummary}`, tone: 'green' });
      }
    }
  }
  for (const ch of beat.arena?.chests || []) {
    if (ch.opened && ch.lastLootSummary) {
      const s = ch.lastLootSummary;
      const itemNames = (s.items || []).map((it) => it.name).filter(Boolean).join(', ');
      lootEntries.push({
        label: `${ch.name}: +${s.goldGained}G, +${s.manaStonesGained} Stones${itemNames ? ` (${itemNames})` : ''}`,
        tone: 'gold',
      });
    }
  }

  // Build party vitals list (prioritize current player; filter out unused mock characters when real players exist)
  const allChars = Object.values(state.characters || {}) as Character[];
  const mockIds = new Set(
    [
      state.playerAccounts?.['mock.player@tower.gg']?.characterId,
      state.playerAccounts?.['story.showcase@tower.gg']?.characterId,
      state.playerAccounts?.['new.climber@tower.gg']?.characterId,
    ].filter((id): id is string => Boolean(id)),
  );
  const nonMockChars = allChars.filter((c) => !mockIds.has(c.id));
  let partyChars: Character[];
  if (session.characterId && mockIds.has(session.characterId)) {
    const meChar = state.characters?.[session.characterId];
    partyChars = meChar ? [meChar] : allChars;
  } else {
    partyChars = nonMockChars.length > 0 ? nonMockChars : allChars;
  }
  if (session.characterId) {
    partyChars = [...partyChars].sort((a, b) =>
      a.id === session.characterId ? -1 : b.id === session.characterId ? 1 : 0,
    );
  }

  const dismiss = () => setDismissedIds((prev) => ({ ...prev, [beat.id]: true }));

  return (
    <div id="story-beat-finished-modal" className="modal-backdrop open beat-finish-backdrop">
      <div className={`modal-card beat-finish-card${isCombatVictory ? ' is-victory' : ''}`}>
        {/* Hero Crest Graphic */}
        <div className="beat-finish-hero">
          <div className="beat-finish-crest" aria-hidden="true">
            {isCombatVictory ? (
              <svg viewBox="0 0 64 64" width="56" height="56" fill="none">
                <defs>
                  <linearGradient id="beatVictoryGrad" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#fde047" />
                    <stop offset="55%" stopColor="#fbbf24" />
                    <stop offset="100%" stopColor="#34d399" />
                  </linearGradient>
                </defs>
                <polygon
                  points="32,3 57,17 57,47 32,61 7,47 7,17"
                  fill="rgba(251, 191, 36, 0.14)"
                  stroke="url(#beatVictoryGrad)"
                  strokeWidth="2.5"
                />
                <path
                  d="M20 44L44 20M44 44L20 20"
                  stroke="#fde047"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                />
                <path
                  d="M17 38l5 5M47 38l-5 5"
                  stroke="#34d399"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <path
                  d="M24 17l8-5 8 5-2 6H26l-2-6z"
                  fill="rgba(251, 191, 36, 0.35)"
                  stroke="#fde047"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 64 64" width="54" height="54" fill="none">
                <defs>
                  <linearGradient id="beatFinishGrad" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#fde047" />
                    <stop offset="55%" stopColor="#fbbf24" />
                    <stop offset="100%" stopColor="#38bdf8" />
                  </linearGradient>
                </defs>
                <polygon
                  points="32,4 56,18 56,46 32,60 8,46 8,18"
                  fill="rgba(251, 191, 36, 0.12)"
                  stroke="url(#beatFinishGrad)"
                  strokeWidth="2.5"
                />
                <path
                  d="M18 39l4-15 10 8 10-8 4 15H18z"
                  fill="rgba(251, 191, 36, 0.28)"
                  stroke="#fde047"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <circle cx="32" cy="18" r="3" fill="#38bdf8" />
              </svg>
            )}
          </div>

          {isCombatVictory && <div className="beat-finish-victory-word">VICTORY</div>}

          <div className="beat-finish-badges">
            <span className={`tag ${isCombatVictory ? 'tag-green' : 'tag-gold'}`}>
              {isCombatVictory ? 'OBJECTIVES CLEARED' : 'STORY BEAT CONCLUDED'}
            </span>
            <span className="tag tag-cyan">{beat.floor}F</span>
            {victory && (
              <span className="tag tag-gold">
                {victory.roundsTaken} Round{victory.roundsTaken === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <h2 className="beat-finish-title">{beat.title}</h2>
          {beat.narration && <p className="beat-finish-narration">{beat.narration}</p>}
        </div>

        {/* Combat Victory Battle Summary Bento */}
        {isCombatVictory && (
          <div className="beat-finish-section">
            <div className="beat-finish-sec-head">
              <span>BATTLE SUMMARY</span>
            </div>
            <div className="beat-finish-victory-bento">
              <div className="beat-finish-victory-tile">
                <span className="beat-finish-victory-k">Monsters Defeated</span>
                <strong className="beat-finish-victory-v is-crimson">
                  {victory?.monstersDefeated ?? (beat.defeatedLog?.length || 0)}
                </strong>
              </div>
              <div className="beat-finish-victory-tile">
                <span className="beat-finish-victory-k">Total XP</span>
                <strong className="beat-finish-victory-v is-cyan">
                  +{victory?.totalXpGained ?? 0}
                </strong>
              </div>
              <div className="beat-finish-victory-tile">
                <span className="beat-finish-victory-k">Total Gold</span>
                <strong className="beat-finish-victory-v is-gold">
                  +{victory?.totalGoldGained ?? 0}G
                </strong>
              </div>
              <div className="beat-finish-victory-tile">
                <span className="beat-finish-victory-k">Mana Stones</span>
                <strong className="beat-finish-victory-v is-purple">
                  +{victory?.totalManaStonesGained ?? 0}
                </strong>
              </div>
            </div>
            {victory && victory.defeatedMonsterNames.length > 0 && (
              <div className="small muted" style={{ marginTop: '2px' }}>
                Slain: <b style={{ color: '#fca5a5' }}>{victory.defeatedMonsterNames.join(', ')}</b>
              </div>
            )}
          </div>
        )}

        {/* Story Choices Overview (shown when prompts exist or non-combat) */}
        {(prompts.length > 0 || !isCombatVictory) && (
          <div className="beat-finish-section">
            <div className="beat-finish-sec-head">
              <span>STORY OVERVIEW &amp; CHOICES</span>
            </div>
            {prompts.length > 0 ? (
              <div className="beat-finish-choices">
                {prompts.map((pr, idx) => (
                  <div key={pr.id} className="beat-finish-choice">
                    <div className="beat-finish-q">
                      <span className="tag tag-purple small">Step {idx + 1}</span>
                      <strong>{pr.question}</strong>
                    </div>
                    {(pr.answers || []).length > 0 && (
                      <div className="beat-finish-ans-list">
                        {pr.answers.map((ans) => (
                          <div key={ans.id} className="beat-finish-ans">
                            <b>{ans.characterName}:</b> &ldquo;{ans.answer}&rdquo;
                          </div>
                        ))}
                      </div>
                    )}
                    {pr.triggeredScenario && (
                      <div className="beat-finish-outcome">
                        {pr.triggeredOption && (
                          <span className="tag tag-green small" style={{ marginRight: '6px' }}>
                            {pr.triggeredOption}
                          </span>
                        )}
                        <span>{pr.triggeredScenario}</span>
                      </div>
                    )}
                    {(pr.triggeredStatCheckResults || []).map((r) => (
                      <div
                        key={`${r.characterId}-${r.statKey}`}
                        className={`beat-finish-check ${r.passed ? 'is-pass' : 'is-fail'}`}
                      >
                        <b>{r.characterName}</b> &bull; {r.statKey} Check: d20({r.roll}) +{' '}
                        {r.statMod >= 0 ? `+${r.statMod}` : r.statMod} + {r.floorBonus}F ={' '}
                        <b>{r.total}</b> vs DC {r.dc} &rarr;{' '}
                        <b>{r.passed ? 'PASSED' : 'FAILED'}</b>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="small muted">Chapter completed.</div>
            )}
          </div>
        )}

        {/* Loot & Rewards Summary */}
        <div className="beat-finish-section">
          <div className="beat-finish-sec-head">
            <span>LOOT &amp; REWARDS SUMMARY</span>
          </div>
          {lootEntries.length > 0 ? (
            <div className="beat-finish-loot-list">
              {lootEntries.map((entry, idx) => (
                <div key={idx} className={`beat-finish-loot-item is-${entry.tone}`}>
                  <span>{entry.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="small muted">
              {isCombatVictory ? 'All hostiles cleared from the arena.' : 'Story milestone completed.'}
            </div>
          )}
        </div>

        {/* Party Vitals (HP, MP, EXP) */}
        {partyChars.length > 0 && (
          <div className="beat-finish-section">
            <div className="beat-finish-sec-head">
              <span>PARTY VITALS</span>
            </div>
            <div className="beat-finish-party-grid">
              {partyChars.map((ch) => {
                const hpPct = ch.maxHp > 0 ? Math.max(0, Math.min(100, (ch.hp / ch.maxHp) * 100)) : 0;
                const mpPct = ch.maxMp > 0 ? Math.max(0, Math.min(100, (ch.mp / ch.maxMp) * 100)) : 0;
                const xpTarget = Math.max(1, Number(ch.xpToNext || ch.level * 100 || 100));
                const xpPct = Math.max(0, Math.min(100, ((ch.xp || 0) / xpTarget) * 100));
                return (
                  <div key={ch.id} className="beat-finish-member-card">
                    <div className="beat-finish-member-head">
                      <strong>{ch.name}</strong>
                      <span className="tag tag-cyan small">Lv {ch.level}</span>
                    </div>

                    <div className="beat-finish-bar-row">
                      <div className="beat-finish-bar-label">
                        <span>HP</span>
                        <b>
                          {ch.hp}/{ch.maxHp}
                        </b>
                      </div>
                      <SegmentedBar
                        pct={hpPct}
                        maxValue={ch.maxHp}
                        kind="hp"
                        fillKind="hp"
                        critical={hpPct > 0 && hpPct <= 20}
                      />
                    </div>

                    <div className="beat-finish-bar-row">
                      <div className="beat-finish-bar-label">
                        <span>MP</span>
                        <b>
                          {ch.mp}/{ch.maxMp}
                        </b>
                      </div>
                      <SegmentedBar pct={mpPct} maxValue={ch.maxMp} kind="mp" fillKind="mp" />
                    </div>

                    <div className="beat-finish-bar-row">
                      <div className="beat-finish-bar-label">
                        <span>EXP</span>
                        <b>
                          {ch.xp || 0}/{xpTarget} XP
                        </b>
                      </div>
                      <SegmentedBar pct={xpPct} maxValue={xpTarget} kind="xp" fillKind="xp" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="beat-finish-footer">
          {spawnedCombatPrompt?.spawnedCombatBeatId && (
            <button
              type="button"
              id="btn-beat-finish-combat"
              className="btn btn-crimson"
              onClick={() => {
                dismiss();
                setActiveBeatDetailId(spawnedCombatPrompt.spawnedCombatBeatId!);
              }}
            >
              Proceed to Combat: {spawnedCombatPrompt.spawnedCombatBeatTitle || 'Encounter'} &rarr;
            </button>
          )}
          <button
            type="button"
            id="btn-beat-finish-dashboard"
            className="btn btn-outline"
            onClick={() => {
              dismiss();
              setActiveBeatDetailId(null);
            }}
          >
            Return to Dashboard
          </button>
          <button
            type="button"
            id="btn-beat-finish-continue"
            className="btn btn-gold"
            onClick={dismiss}
          >
            {isCombatVictory ? 'Stay on Map' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
