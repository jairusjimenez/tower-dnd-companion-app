import React, { useState } from 'react';
import {
  type StoryBeat,
  type StoryPromptBranch,
} from '@shared/index';
import { useVtt } from '../../../context/VttContext';
import { StoryFlowchartView } from '../../common/StoryFlowchartView';
export interface BeatPromptsPanelProps {
  beat: StoryBeat;
  isDm: boolean;
}

export function BeatPromptsPanel({ beat, isDm }: BeatPromptsPanelProps) {
  const {
    state,
    session,
    sendAction,
    pushLocalToast,
    setActiveBeatDetailId,
    setActivePromptModal,
  } = useVtt();

  const [askTarget, setAskTarget] = useState('all');
  const [askQuestion, setAskQuestion] = useState('');
  const [askOptionDraft, setAskOptionDraft] = useState('');
  const [askOptions, setAskOptions] = useState<string[]>([]);
  const [askBranches, setAskBranches] = useState<Record<string, { scenario: string; dmNote: string; nextQuestion: string }>>({});
  const [showFlowchart, setShowFlowchart] = useState(true);

  if (!state || !session) return null;
  const floor = Math.max(1, Number(beat.floor || 1));
  const chars = Object.values(state.characters || {});

  return (
    <>
        {(isDm || (beat.prompts || []).length > 0 || beat.beatType === 'narration') && (
          <div id="beat-detail-prompts-panel" className="panel card-glow-gold mt-sm">
            <div className="panel-header">
              <div className="btn-row" style={{ alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>DM Narration &amp; Player Questions</h3>
                <span className={`tag ${beat.beatType === 'narration' ? 'tag-purple' : 'tag-cyan'}`}>
                  {beat.beatType === 'narration' ? 'NARRATION BEAT (NO COMBAT)' : 'INTERACTIVE Q&A'}
                </span>
              </div>
              <div className="btn-row" style={{ alignItems: 'center' }}>
                {isDm && (beat.prompts || []).length > 0 && (
                  <button
                    type="button"
                    className={`btn btn-xs ${showFlowchart ? 'btn-gold' : 'btn-outline'}`}
                    onClick={() => setShowFlowchart((v) => !v)}
                  >
                    {showFlowchart ? 'Hide Flowchart' : 'Show Conversation Flowchart'}
                  </button>
                )}
                <span className="muted small">
                  {(beat.prompts || []).length} Question{(beat.prompts || []).length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            {isDm && showFlowchart && (beat.prompts || []).length > 0 && (
              <div className="mt-xs mb-xs">
                <StoryFlowchartView
                  title={beat.title}
                  floor={beat.floor}
                  narration={beat.narration}
                  prompts={beat.prompts!}
                  isDm={true}
                  onOpenBeat={(targetId) => setActiveBeatDetailId(targetId)}
                  onTriggerBranch={(promptId, option) =>
                    sendAction('story_action', {
                      subAction: 'trigger_prompt_branch',
                      beatId: beat.id,
                      promptId,
                      option,
                    })
                  }
                />
              </div>
            )}

            {isDm && (
              <form
                className="stack-form mt-xs"
                style={{ marginBottom: (beat.prompts || []).length > 0 ? '12px' : 0 }}
                onSubmit={async (ev) => {
                  ev.preventDefault();
                  if (!askQuestion.trim()) {
                    pushLocalToast({ title: 'QUESTION NEEDED', message: 'Enter a question for the player(s).', category: 'warning' });
                    return;
                  }
                  const pendingOpts = [...askOptions];
                  if (askOptionDraft.trim()) pendingOpts.push(askOptionDraft.trim());
                  const branches: StoryPromptBranch[] = [];
                  for (const opt of pendingOpts) {
                    const cfg = askBranches[opt];
                    if (cfg && cfg.scenario.trim()) {
                      branches.push({
                        option: opt,
                        scenario: cfg.scenario.trim(),
                        ...(cfg.dmNote.trim() ? { dmNote: cfg.dmNote.trim() } : {}),
                        ...(cfg.nextQuestion.trim() ? { nextQuestion: cfg.nextQuestion.trim() } : {}),
                      });
                    }
                  }
                  const res = await sendAction<{ beat?: { id: string; prompts?: Array<{ id: string }> } }>('story_action', {
                    subAction: 'ask_beat_prompt',
                    beatId: beat.id,
                    question: askQuestion.trim(),
                    target: askTarget,
                    options: pendingOpts,
                    branches,
                  });
                  setAskQuestion('');
                  setAskOptionDraft('');
                  setAskOptions([]);
                  setAskBranches({});
                  const latestPrompt = res?.beat?.prompts?.[res.beat.prompts.length - 1];
                  if (latestPrompt) {
                    setActivePromptModal({ beatId: beat.id, promptId: latestPrompt.id });
                  }
                }}
              >
                <div className="btn-row" style={{ gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <label style={{ minWidth: '210px' }}>
                    <span>Who to Ask</span>
                    <select value={askTarget} onChange={(e) => setAskTarget(e.target.value)}>
                      <option value="all">Ask the Group (All Players)</option>
                      {chars.map((c) => (
                        <option key={c.id} value={c.id}>
                          Ask {c.name} (Lv {c.level})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ flex: 1, minWidth: '240px' }}>
                    <span>Ask a Question / Decision Prompt</span>
                    <input
                      type="text"
                      placeholder="e.g. What does your character say to the Guardian, or which path do you take?"
                      value={askQuestion}
                      onChange={(e) => setAskQuestion(e.target.value)}
                    />
                  </label>
                  <button type="submit" className="btn btn-sm btn-gold">
                    Ask &amp; Open Poll Modal
                  </button>
                </div>

                <div className="btn-row" style={{ gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <label style={{ flex: 1, minWidth: '220px' }}>
                    <span>Answer Options for Poll / Choice (Optional)</span>
                    <div className="btn-row" style={{ gap: '6px' }}>
                      <input
                        type="text"
                        style={{ flex: 1 }}
                        placeholder="e.g. Step through the crimson gate"
                        value={askOptionDraft}
                        onChange={(e) => setAskOptionDraft(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        onClick={() => {
                          const clean = askOptionDraft.trim();
                          if (!clean) return;
                          setAskOptions((prev) => [...prev, clean]);
                          setAskOptionDraft('');
                        }}
                      >
                        + Add Option
                      </button>
                    </div>
                  </label>
                </div>

                {askOptions.length > 0 && (
                  <div className="stack-form mt-xs">
                    <div className="btn-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                      {askOptions.map((opt, oIdx) => (
                        <span key={`${opt}-${oIdx}`} className="tag tag-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          Option {oIdx + 1}: {opt}
                          <button
                            type="button"
                            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                            onClick={() => setAskOptions((prev) => prev.filter((_, i) => i !== oIdx))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>

                    <div className="list-stack">
                      {askOptions.map((opt, oIdx) => {
                        const br = askBranches[opt] || { scenario: '', dmNote: '', nextQuestion: '' };
                        return (
                          <div key={`ask-br-${opt}-${oIdx}`} className="item-card" style={{ borderColor: 'rgba(168, 85, 247, 0.45)', padding: '8px 10px' }}>
                            <div className="small" style={{ color: '#fbbf24', fontWeight: 700, marginBottom: '4px' }}>
                              IF Answer = Option {oIdx + 1}: &ldquo;{opt}&rdquo; &rarr; THEN Scenario:
                            </div>
                            <input
                              type="text"
                              placeholder={`What happens if they choose "${opt}"?`}
                              value={br.scenario}
                              onChange={(e) =>
                                setAskBranches((prev) => ({
                                  ...prev,
                                  [opt]: { ...br, scenario: e.target.value },
                                }))
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </form>
            )}

            {(beat.prompts || []).length > 0 ? (
              <div className="list-stack mt-xs">
                {(beat.prompts || []).map((pr) => {
                  const myExistingAnswer = !isDm && session.characterId
                    ? (pr.answers || []).find((a) => a.characterId === session.characterId)
                    : undefined;
                  const totalGroup = pr.target === 'all' ? Math.max(1, chars.length) : 1;
                  const allDone =
                    pr.target === 'all'
                      ? chars.length > 0
                        ? (pr.answers || []).length >= chars.length
                        : (pr.answers || []).length > 0
                      : (pr.answers || []).length >= 1;

                  return (
                    <div key={pr.id} className="item-card" style={{ borderColor: 'rgba(168, 85, 247, 0.45)' }}>
                      <div className="item-card-top">
                        <strong>
                          <span className={`tag ${pr.target === 'all' ? 'tag-cyan' : 'tag-gold'}`}>
                            {pr.target === 'all' ? 'Asked to Group' : `Asked to ${pr.targetName}`}
                          </span>{' '}
                          &ldquo;{pr.question}&rdquo;
                        </strong>
                        <div className="btn-row">
                          <button
                            type="button"
                            className="btn btn-xs btn-gold"
                            onClick={() => setActivePromptModal({ beatId: beat.id, promptId: pr.id })}
                          >
                            {isDm
                              ? pr.target === 'all'
                                ? `Open Poll Modal (${(pr.answers || []).length}/${totalGroup})`
                                : 'Open Prompt Modal'
                              : myExistingAnswer
                                ? allDone
                                  ? 'View Poll Results'
                                  : 'View Waiting Status'
                                : 'Answer in Modal'}
                          </button>
                          {isDm && (
                            <button
                              type="button"
                              className="btn btn-xs btn-danger-outline"
                              onClick={() =>
                                sendAction('story_action', {
                                  subAction: 'remove_beat_prompt',
                                  beatId: beat.id,
                                  promptId: pr.id,
                                })
                              }
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

                      {(pr.options || []).length > 0 && (
                        <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '6px' }}>
                          {pr.options!.map((opt, oIdx) => (
                            <span key={`${opt}-${oIdx}`} className="tag tag-gold">
                              Option {oIdx + 1}: {opt}
                            </span>
                          ))}
                        </div>
                      )}

                      {pr.triggeredScenario && (
                        <div
                          className="small mt-xs"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '6px',
                            background: 'rgba(6, 78, 59, 0.4)',
                            border: '1px solid #10b981',
                            color: '#ecfdf5',
                          }}
                        >
                          <div>
                            <span className="tag tag-green">SCENARIO: IF &ldquo;{pr.triggeredOption}&rdquo;</span>{' '}
                            {pr.triggeredScenario}
                          </div>
                          {(pr.triggeredStatCheckResults || []).map((r) => (
                            <div key={`${r.characterId}-${r.statKey}`} className="small mt-xs" style={{ color: r.passed ? '#6ee7b7' : '#fca5a5' }}>
                              • <b>{r.characterName}</b> {r.statKey} Check: d20({r.roll}) + Mod(
                              {r.statMod >= 0 ? `+${r.statMod}` : r.statMod}) + Floor(+{r.floorBonus}) = <b>{r.total}</b> vs DC {r.dc}{' '}
                              [{r.passed ? `PASSED: ${r.rewardSummary}` : 'FAILED'}]
                            </div>
                          ))}
                          {pr.triggeredRewardSummary && (
                            <div className="small mt-xs" style={{ color: '#fbbf24' }}>
                              • <b>Reward:</b> {pr.triggeredRewardSummary}
                            </div>
                          )}
                          {pr.spawnedCombatBeatId && (
                            <div className="mt-xs">
                              <button
                                type="button"
                                className="btn btn-xs btn-crimson"
                                onClick={() => setActiveBeatDetailId(pr.spawnedCombatBeatId!)}
                              >
                                Current Beat Resolved &rarr; Go to Generated Combat Beat ({pr.spawnedCombatBeatTitle || 'Combat'})
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {!isDm && myExistingAnswer && !allDone ? (
                        <div className="small mt-xs" style={{ color: '#fbbf24' }}>
                          Waiting on other players to make an answer ({(pr.answers || []).length}/{totalGroup} answered)...
                        </div>
                      ) : (pr.answers || []).length > 0 ? (
                        <div className="list-stack mt-xs">
                          {pr.answers.map((ans) => (
                            <div
                              key={ans.id}
                              className="small"
                              style={{
                                background: 'rgba(15, 23, 42, 0.65)',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                borderLeft: '3px solid #38bdf8',
                              }}
                            >
                              <b style={{ color: '#38bdf8' }}>{ans.characterName}:</b> &ldquo;{ans.answer}&rdquo;
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="muted small mt-xs">
                          Waiting for answer from {pr.target === 'all' ? 'the group' : pr.targetName}...
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="muted small mt-xs">
                {isDm
                  ? 'Ask a question above to prompt a specific player or the entire group.'
                  : 'Listening to the Dungeon Master’s narration...'}
              </div>
            )}
          </div>
        )}
    </>
  );
}
