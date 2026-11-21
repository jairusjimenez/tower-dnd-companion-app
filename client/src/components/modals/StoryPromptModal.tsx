import { useEffect, useRef, useState } from 'react';
import type { StoryBeat, StoryBeatPrompt } from '@shared/index';
import { useVtt } from '../../context/VttContext';

interface PollBucket {
  label: string;
  count: number;
  pct: number;
  voters: string[];
}

export function buildPromptPollBuckets(prompt: StoryBeatPrompt): PollBucket[] {
  const answers = prompt.answers || [];
  const totalAnswers = answers.length;
  const options = prompt.options || [];

  const buckets = new Map<string, { label: string; count: number; voters: string[] }>();
  for (const opt of options) {
    const clean = opt.trim();
    if (clean) {
      buckets.set(clean.toLowerCase(), { label: clean, count: 0, voters: [] });
    }
  }

  for (const ans of answers) {
    const raw = (ans.answer || '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.voters.push(ans.characterName);
    } else {
      buckets.set(key, {
        label: raw,
        count: 1,
        voters: [ans.characterName],
      });
    }
  }

  return Array.from(buckets.values()).map((b) => ({
    label: b.label,
    count: b.count,
    pct: totalAnswers > 0 ? Math.round((b.count / totalAnswers) * 100) : 0,
    voters: b.voters,
  }));
}

export function StoryPromptModal() {
  const {
    session,
    state,
    sendAction,
    pushLocalToast,
    activePromptModal,
    setActivePromptModal,
    setActiveBeatDetailId,
  } = useVtt();

  const [selectedOption, setSelectedOption] = useState('');
  const [customAnswer, setCustomAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const dismissedPromptIdsRef = useRef<Set<string>>(new Set());

  const isDm = session?.role === 'dm';
  const myCharId = session?.characterId || null;

  // Auto-open for Players when a presented Story Beat has an unanswered prompt targeting 'all' or their characterId
  useEffect(() => {
    if (!state || !session || isDm || !myCharId) return;
    if (activePromptModal) return;

    const presentedBeats = (state.storyBeats || []).filter((b) => b.presented);
    for (let i = presentedBeats.length - 1; i >= 0; i--) {
      const beat = presentedBeats[i];
      const prompts = beat.prompts || [];
      for (let j = prompts.length - 1; j >= 0; j--) {
        const pr = prompts[j];
        const isTargeted = pr.target === 'all' || pr.target === myCharId;
        if (!isTargeted) continue;
        const alreadyAnswered = (pr.answers || []).some((a) => a.characterId === myCharId);
        if (!alreadyAnswered && !dismissedPromptIdsRef.current.has(pr.id)) {
          setActivePromptModal({ beatId: beat.id, promptId: pr.id });
          return;
        }
      }
    }
  }, [state, session, isDm, myCharId, activePromptModal, setActivePromptModal]);

  if (!activePromptModal || !state || !session) return null;

  const beat: StoryBeat | undefined = (state.storyBeats || []).find((b) => b.id === activePromptModal.beatId);
  const prompt: StoryBeatPrompt | undefined = (beat?.prompts || []).find((p) => p.id === activePromptModal.promptId);

  if (!beat || !prompt) return null;

  const partyCharacters = Object.values(state.characters || {});
  const totalGroupSize = prompt.target === 'all' ? Math.max(1, partyCharacters.length) : 1;
  const answers = prompt.answers || [];
  const answeredIds = new Set(answers.map((a) => a.characterId));
  const pendingCharacters = prompt.target === 'all'
    ? partyCharacters.filter((c) => !answeredIds.has(c.id))
    : partyCharacters.filter((c) => c.id === prompt.target && !answeredIds.has(c.id));

  const allGroupAnswered =
    prompt.target === 'all'
      ? partyCharacters.length > 0
        ? pendingCharacters.length === 0 && answers.length >= partyCharacters.length
        : answers.length > 0
      : answers.length >= 1;

  const myAnswer = myCharId ? answers.find((a) => a.characterId === myCharId) : undefined;
  const hasOptions = Array.isArray(prompt.options) && prompt.options.length > 0;
  const pollBuckets = buildPromptPollBuckets(prompt);

  const handleClose = () => {
    dismissedPromptIdsRef.current.add(prompt.id);
    setSelectedOption('');
    setCustomAnswer('');
    setActivePromptModal(null);
  };

  const handleSubmitAnswer = async (answerValue: string) => {
    const clean = answerValue.trim();
    if (!clean) {
      pushLocalToast({ title: 'ANSWER NEEDED', message: 'Please choose an option or type your answer.', category: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      await sendAction('story_action', {
        subAction: 'answer_beat_prompt',
        beatId: beat.id,
        promptId: prompt.id,
        characterId: myCharId,
        answer: clean,
      });
      setSelectedOption('');
      setCustomAnswer('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id="story-prompt-modal" className="modal-backdrop">
      <div
        className="modal-card"
        style={{
          maxWidth: '580px',
          width: '94%',
          border: '1.5px solid rgba(168, 85, 247, 0.7)',
          boxShadow: '0 0 36px rgba(168, 85, 247, 0.28)',
        }}
      >
        <div className="panel-header">
          <div>
            <div className="btn-row" style={{ alignItems: 'center', marginBottom: '4px' }}>
              <span className="tag tag-purple">
                {prompt.target === 'all' ? 'GROUP QUESTION & POLL' : `QUESTION FOR ${prompt.targetName.toUpperCase()}`}
              </span>
              <span className="tag tag-gold">{beat.floor}F • {beat.title}</span>
            </div>
            <h3 style={{ margin: 0 }}>
              {isDm
                ? prompt.target === 'all'
                  ? 'Live Group Poll & Player Responses'
                  : `Player Prompt: ${prompt.targetName}`
                : myAnswer && !allGroupAnswered
                  ? 'Response Recorded'
                  : allGroupAnswered
                    ? 'Party Poll & Answer Summary'
                    : 'The Dungeon Master Asks...'}
            </h3>
          </div>
          <button type="button" className="btn btn-xs btn-outline" onClick={handleClose}>
            Close
          </button>
        </div>

        <div className="stack" style={{ padding: '6px 2px' }}>
          {beat.narration && (
            <div className="story-narration" style={{ fontSize: '0.9rem' }}>
              {beat.narration}
            </div>
          )}

          {/* Question Callout */}
          <div
            className="item-card"
            style={{
              background: 'rgba(15, 23, 42, 0.85)',
              borderColor: 'rgba(56, 189, 248, 0.5)',
              padding: '12px 14px',
            }}
          >
            <div className="small muted" style={{ marginBottom: '4px' }}>
              DM QUESTION ({prompt.target === 'all' ? 'Asked to the Group' : `Asked to ${prompt.targetName}`}):
            </div>
            <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>
              &ldquo;{prompt.question}&rdquo;
            </div>
          </div>

          {/* PLAYER VIEW: 1. Input form if player hasn't answered yet */}
          {!isDm && !myAnswer && (
            <div className="panel" style={{ padding: '12px', background: 'rgba(15, 23, 42, 0.6)' }}>
              {hasOptions && (
                <div className="stack" style={{ gap: '8px', marginBottom: '12px' }}>
                  <div className="small" style={{ fontWeight: 600, color: '#cbd5e1' }}>
                    Choose an Option:
                  </div>
                  {prompt.options!.map((opt, idx) => {
                    const isSelected = selectedOption === opt;
                    return (
                      <button
                        key={`${opt}-${idx}`}
                        type="button"
                        className={`btn ${isSelected ? 'btn-gold' : 'btn-outline'}`}
                        style={{
                          justifyContent: 'flex-start',
                          textAlign: 'left',
                          padding: '10px 14px',
                          borderColor: isSelected ? '#fbbf24' : 'rgba(148, 163, 184, 0.35)',
                        }}
                        onClick={() => {
                          setSelectedOption(opt);
                          setCustomAnswer('');
                        }}
                      >
                        <span className="tag tag-cyan" style={{ marginRight: '8px' }}>
                          Option {idx + 1}
                        </span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <label className="stack" style={{ gap: '4px' }}>
                <span className="small muted">
                  {hasOptions ? 'Or write your own custom response:' : 'Your Answer:'}
                </span>
                <textarea
                  rows={2}
                  placeholder="Type your character's answer or decision..."
                  value={customAnswer}
                  onChange={(e) => {
                    setCustomAnswer(e.target.value);
                    if (e.target.value.trim()) setSelectedOption('');
                  }}
                />
              </label>

              <button
                type="button"
                className="btn btn-gold btn-lg mt-sm"
                style={{ width: '100%', fontWeight: 800 }}
                disabled={submitting || (!selectedOption && !customAnswer.trim())}
                onClick={() => handleSubmitAnswer(customAnswer.trim() || selectedOption)}
              >
                {submitting ? 'Submitting Answer...' : 'Submit Answer'}
              </button>
            </div>
          )}

          {/* PLAYER VIEW: 2. Waiting on other players in the group */}
          {!isDm && myAnswer && !allGroupAnswered && (
            <div
              className="panel"
              style={{
                padding: '16px',
                textAlign: 'center',
                background: 'rgba(15, 23, 42, 0.72)',
                border: '1px solid rgba(251, 191, 36, 0.45)',
              }}
            >
              <span className="tag tag-gold" style={{ marginBottom: '8px', display: 'inline-block' }}>
                ANSWER SUBMITTED ({answers.length}/{totalGroupSize})
              </span>
              <h4 style={{ margin: '4px 0 6px', color: '#f8fafc' }}>
                Waiting on other players to make an answer...
              </h4>
              <div className="small muted" style={{ marginBottom: '10px' }}>
                Your Answer: <b style={{ color: '#38bdf8' }}>&ldquo;{myAnswer.answer}&rdquo;</b>
              </div>
              {pendingCharacters.length > 0 && (
                <div className="small muted">
                  Waiting for:{' '}
                  <b>{pendingCharacters.map((c) => c.name).join(', ')}</b>
                </div>
              )}
            </div>
          )}

          {/* DM VIEW (Always shows live Poll & Percentages) OR PLAYER VIEW once ALL players answered */}
          {(isDm || allGroupAnswered) && (
            <div className="panel" style={{ padding: '12px 14px', background: 'rgba(15, 23, 42, 0.68)' }}>
              <div className="item-card-top" style={{ marginBottom: '10px' }}>
                <strong>
                  {prompt.target === 'all' ? 'Group Poll & Answer Percentages' : 'Answer Summary'}
                </strong>
                <span className={`tag ${allGroupAnswered ? 'tag-green' : 'tag-gold'}`}>
                  {allGroupAnswered
                    ? `All Answered (${answers.length}/${totalGroupSize})`
                    : `${answers.length}/${totalGroupSize} Answered • Waiting on ${pendingCharacters.map((c) => c.name).join(', ') || 'Players'}`}
                </span>
              </div>

              {pollBuckets.length > 0 ? (
                <div className="list-stack">
                  {pollBuckets.map((b, idx) => {
                    const matchedBr = (prompt.branches || []).find(
                      (br) => br.option.trim().toLowerCase() === b.label.trim().toLowerCase(),
                    );
                    const isTriggered =
                      prompt.triggeredOption &&
                      prompt.triggeredOption.trim().toLowerCase() === b.label.trim().toLowerCase();
                    return (
                      <div
                        key={`${b.label}-${idx}`}
                        className="item-card"
                        style={{
                          padding: '8px 10px',
                          borderColor: isTriggered ? '#10b981' : undefined,
                        }}
                      >
                        <div className="item-card-top" style={{ marginBottom: '4px' }}>
                          <strong>
                            {b.label}{' '}
                            {isTriggered && <span className="tag tag-green">TRIGGERED SCENARIO</span>}
                          </strong>
                          <div className="btn-row" style={{ alignItems: 'center' }}>
                            <span className="tag tag-cyan">
                              {b.pct}% ({b.count} {b.count === 1 ? 'vote' : 'votes'})
                            </span>
                            {isDm && matchedBr && (
                              <button
                                type="button"
                                className={`btn btn-xs ${isTriggered ? 'btn-outline' : 'btn-gold'}`}
                                onClick={() =>
                                  sendAction('story_action', {
                                    subAction: 'trigger_prompt_branch',
                                    beatId: beat.id,
                                    promptId: prompt.id,
                                    option: matchedBr.option,
                                  })
                                }
                              >
                                {isTriggered ? 'Re-Trigger Scenario' : 'Trigger Scenario'}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="progress" style={{ height: '9px' }}>
                          <div
                            className="progress-fill xp"
                            style={{
                              width: `${b.pct}%`,
                              background: isTriggered
                                ? 'linear-gradient(90deg, #10b981, #38bdf8)'
                                : 'linear-gradient(90deg, #38bdf8, #a855f7)',
                            }}
                          />
                        </div>
                        {b.voters.length > 0 && (
                          <div className="small muted mt-xs">
                            Answered by: <b style={{ color: '#e2e8f0' }}>{b.voters.join(', ')}</b>
                          </div>
                        )}
                        {isDm && matchedBr && (
                          <div className="small mt-xs" style={{ color: '#cbd5e1' }}>
                            <span className="tag tag-purple">IF CHOSEN</span> {matchedBr.scenario}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="muted small">
                  No player answers submitted yet. Waiting for climbers to respond...
                </div>
              )}

              {prompt.triggeredScenario && (
                <div
                  className="panel mt-sm"
                  style={{
                    padding: '10px 12px',
                    background: 'rgba(6, 78, 59, 0.4)',
                    border: '1.5px solid #10b981',
                  }}
                >
                  <div className="item-card-top" style={{ marginBottom: '4px' }}>
                    <span className="tag tag-green">
                      SCENARIO UNLOCKED (IF &ldquo;{prompt.triggeredOption}&rdquo;)
                    </span>
                  </div>
                  <div style={{ color: '#f8fafc', fontSize: '0.96rem', fontWeight: 600 }}>
                    {prompt.triggeredScenario}
                  </div>

                  {(prompt.triggeredStatCheckResults || []).length > 0 && (
                    <div className="list-stack mt-xs">
                      {prompt.triggeredStatCheckResults!.map((r) => (
                        <div
                          key={`${r.characterId}-${r.statKey}`}
                          className="small"
                          style={{
                            padding: '5px 8px',
                            borderRadius: '6px',
                            background: 'rgba(15, 23, 42, 0.72)',
                            borderLeft: `3px solid ${r.passed ? '#10b981' : '#f87171'}`,
                          }}
                        >
                          <b>{r.characterName}</b> • {r.statKey} Check: d20({r.roll}) + Mod(
                          {r.statMod >= 0 ? `+${r.statMod}` : r.statMod}) + Floor(+{r.floorBonus}) ={' '}
                          <b>{r.total}</b> vs DC {r.dc}{' '}
                          <span className={`tag ${r.passed ? 'tag-green' : 'tag-crimson'}`}>
                            {r.passed ? `PASSED (${r.rewardSummary})` : 'FAILED'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {prompt.triggeredRewardSummary && (
                    <div className="small mt-xs" style={{ color: '#fbbf24', fontWeight: 700 }}>
                      <span className="tag tag-gold">REWARD</span> {prompt.triggeredRewardSummary}
                    </div>
                  )}

                  {prompt.spawnedCombatBeatId && (
                    <div className="mt-xs">
                      <button
                        type="button"
                        className="btn btn-sm btn-crimson"
                        style={{ width: '100%', fontWeight: 700 }}
                        onClick={() => {
                          const targetBeatId = prompt.spawnedCombatBeatId!;
                          handleClose();
                          setActiveBeatDetailId(targetBeatId);
                        }}
                      >
                        Current Beat Resolved &rarr; Go to Generated Combat Story Beat ({prompt.spawnedCombatBeatTitle || 'Combat'})
                      </button>
                    </div>
                  )}
                </div>
              )}

              {answers.length > 0 && (
                <div className="mt-sm" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', paddingTop: '8px' }}>
                  <div className="small muted" style={{ marginBottom: '6px' }}>
                    Individual Player Responses ({answers.length}):
                  </div>
                  <div className="list-stack">
                    {answers.map((ans) => (
                      <div
                        key={ans.id}
                        className="small"
                        style={{
                          padding: '6px 10px',
                          borderRadius: '6px',
                          background: 'rgba(2, 6, 23, 0.55)',
                          borderLeft: '3px solid #38bdf8',
                        }}
                      >
                        <b style={{ color: '#38bdf8' }}>{ans.characterName}:</b> &ldquo;{ans.answer}&rdquo;
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={handleClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
