import type { StoryBeatPrompt, StoryPromptBranch } from '@shared/index';

export interface FlowchartPromptInput {
  id?: string;
  question: string;
  target: string;
  targetName: string;
  options?: string[];
  branches?: StoryPromptBranch[];
  triggeredOption?: string;
  triggeredScenario?: string;
  spawnedCombatBeatId?: string;
  spawnedCombatBeatTitle?: string;
  answers?: Array<{ characterName: string; answer: string }>;
}

export function StoryFlowchartView({
  title,
  floor,
  narration,
  prompts,
  isDm = true,
  onTriggerBranch,
  onOpenBeat,
}: {
  title: string;
  floor: number;
  narration?: string;
  prompts: FlowchartPromptInput[] | StoryBeatPrompt[];
  isDm?: boolean;
  onTriggerBranch?: (promptId: string, option: string) => void;
  onOpenBeat?: (beatId: string) => void;
}) {
  return (
    <div
      className="panel"
      style={{
        padding: '14px',
        background: 'radial-gradient(circle at top, rgba(30, 41, 59, 0.92), rgba(2, 6, 23, 0.95))',
        border: '1px solid rgba(56, 189, 248, 0.4)',
        borderRadius: '10px',
      }}
    >
      <div className="panel-header" style={{ marginBottom: '10px' }}>
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <h4 style={{ margin: 0, color: '#38bdf8' }}>Conversation &amp; Branching Scenario Flowchart</h4>
          <span className="tag tag-purple">{floor}F FLOWCHART</span>
        </div>
        <span className="muted small">
          {prompts.length} Decision Node{prompts.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* ROOT NODE: Opening Narration */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            width: '100%',
            maxWidth: '540px',
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1.5px solid #fbbf24',
            borderRadius: '10px',
            padding: '10px 14px',
            boxShadow: '0 0 18px rgba(251, 191, 36, 0.18)',
          }}
        >
          <div className="item-card-top" style={{ marginBottom: '4px' }}>
            <span className="tag tag-gold">START • DM NARRATION</span>
            <strong className="small">{title || `${floor}F Story Beat`}</strong>
          </div>
          <div className="small" style={{ color: '#e2e8f0' }}>
            {narration || 'Opening scene narration presented to the climbers...'}
          </div>
        </div>

        {prompts.map((pr, pIdx) => {
          const allOptions = Array.from(
            new Set([
              ...(pr.options || []),
              ...(pr.branches || []).map((b) => b.option),
            ]),
          );
          const branchByOpt = new Map<string, StoryPromptBranch>();
          for (const b of pr.branches || []) {
            branchByOpt.set(b.option.trim().toLowerCase(), b);
          }

          return (
            <div
              key={pr.id || `flow-prompt-${pIdx}`}
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              {/* Vertical Connector Arrow */}
              <div
                style={{
                  width: '2px',
                  height: '22px',
                  background: 'linear-gradient(180deg, #fbbf24, #38bdf8)',
                }}
              />
              <div style={{ color: '#38bdf8', fontSize: '12px', lineHeight: '10px', marginBottom: '2px' }}>▼</div>

              {/* QUESTION NODE */}
              <div
                style={{
                  width: '100%',
                  maxWidth: '520px',
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: '1.5px solid #38bdf8',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  boxShadow: '0 0 16px rgba(56, 189, 248, 0.18)',
                }}
              >
                <div className="item-card-top" style={{ marginBottom: '4px' }}>
                  <span className="tag tag-cyan">
                    QUESTION #{pIdx + 1} • {pr.target === 'all' ? 'ASK GROUP (POLL)' : `ASK ${pr.targetName.toUpperCase()}`}
                  </span>
                  {pr.triggeredOption && (
                    <span className="tag tag-green">ACTIVE PATH: {pr.triggeredOption}</span>
                  )}
                </div>
                <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.95rem' }}>
                  &ldquo;{pr.question}&rdquo;
                </div>
              </div>

              {/* IF CONDITION BRANCHES */}
              {allOptions.length > 0 && (
                <>
                  <div
                    style={{
                      width: '2px',
                      height: '18px',
                      background: '#38bdf8',
                    }}
                  />
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, allOptions.length))}, minmax(0, 1fr))`,
                      gap: '10px',
                      width: '100%',
                      borderTop: allOptions.length > 1 ? '2px solid rgba(56, 189, 248, 0.45)' : 'none',
                      paddingTop: '10px',
                    }}
                  >
                    {allOptions.map((opt, oIdx) => {
                      const branch = branchByOpt.get(opt.trim().toLowerCase());
                      const isTriggered =
                        pr.triggeredOption && pr.triggeredOption.trim().toLowerCase() === opt.trim().toLowerCase();
                      const votesForOpt = (pr.answers || []).filter(
                        (a) => a.answer.trim().toLowerCase() === opt.trim().toLowerCase(),
                      );

                      return (
                        <div
                          key={`${opt}-${oIdx}`}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                          }}
                        >
                          {/* Diamond / Pill Condition Header */}
                          <div
                            style={{
                              background: isTriggered ? 'rgba(16, 185, 129, 0.22)' : 'rgba(168, 85, 247, 0.18)',
                              border: `1.5px solid ${isTriggered ? '#10b981' : '#a855f7'}`,
                              borderRadius: '20px',
                              padding: '4px 12px',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              color: isTriggered ? '#34d399' : '#e9d5ff',
                              textAlign: 'center',
                              maxWidth: '100%',
                            }}
                          >
                            IF ANSWER = &ldquo;{opt}&rdquo;
                            {votesForOpt.length > 0 ? ` (${votesForOpt.length})` : ''}
                          </div>

                          <div
                            style={{
                              width: '2px',
                              height: '12px',
                              background: isTriggered ? '#10b981' : '#a855f7',
                            }}
                          />
                          <div style={{ color: isTriggered ? '#10b981' : '#a855f7', fontSize: '10px', lineHeight: '8px' }}>
                            ▼
                          </div>

                          {/* THEN SCENARIO OUTCOME BOX */}
                          <div
                            style={{
                              width: '100%',
                              background: isTriggered ? 'rgba(6, 78, 59, 0.35)' : 'rgba(15, 23, 42, 0.85)',
                              border: `1.5px solid ${isTriggered ? '#10b981' : 'rgba(148, 163, 184, 0.35)'}`,
                              borderRadius: '8px',
                              padding: '9px 10px',
                              boxShadow: isTriggered ? '0 0 16px rgba(16, 185, 129, 0.25)' : undefined,
                            }}
                          >
                            <div className="item-card-top" style={{ marginBottom: '4px' }}>
                              <span className={`tag ${isTriggered ? 'tag-green' : 'tag-purple'}`}>
                                {isTriggered ? 'TRIGGERED SCENARIO' : `THEN SCENARIO #${oIdx + 1}`}
                              </span>
                              {isDm && pr.id && branch && onTriggerBranch && (
                                <button
                                  type="button"
                                  className={`btn btn-xs ${isTriggered ? 'btn-outline' : 'btn-gold'}`}
                                  onClick={() => onTriggerBranch(pr.id!, opt)}
                                >
                                  {isTriggered ? 'Re-Trigger' : 'Trigger'}
                                </button>
                              )}
                            </div>

                            {branch?.scenario ? (
                              <div className="small" style={{ color: '#f1f5f9' }}>
                                {branch.scenario}
                              </div>
                            ) : (
                              <div className="small muted">
                                No custom scenario text set for this option yet.
                              </div>
                            )}

                            {isDm && branch?.dmNote && (
                              <div
                                className="small mt-xs"
                                style={{
                                  color: '#fbbf24',
                                  background: 'rgba(251, 191, 36, 0.08)',
                                  padding: '4px 6px',
                                  borderRadius: '4px',
                                }}
                              >
                                <b>DM Note:</b> {branch.dmNote}
                              </div>
                            )}

                            {(branch?.statCheckStat ||
                              (branch?.rewardType && branch.rewardType !== 'none') ||
                              branch?.endsInCombat) && (
                              <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                                {branch?.statCheckStat && (
                                  <span className="tag tag-cyan">
                                    STAT CHECK: {branch.statCheckStat} DC {branch.statCheckDc || 12} (+{25 * floor} XP / +{20 * floor}G)
                                  </span>
                                )}
                                {branch?.rewardType === 'treasure' && (
                                  <span className="tag tag-gold">
                                    REWARD: {branch.rewardItemName || `${floor}F Treasure`}
                                  </span>
                                )}
                                {branch?.rewardType === 'chest' && (
                                  <span className="tag tag-gold">
                                    CHEST: {branch.rewardChestTier || 'Common'} Chest
                                  </span>
                                )}
                                {branch?.endsInCombat && (
                                  <span className="tag tag-crimson">
                                    &rarr; ENDS IN COMBAT BEAT ({branch.combatMonsterQty || 2}× Monster)
                                  </span>
                                )}
                              </div>
                            )}

                            {isTriggered && pr.spawnedCombatBeatId && onOpenBeat && (
                              <button
                                type="button"
                                className="btn btn-xs btn-crimson mt-xs"
                                style={{ width: '100%' }}
                                onClick={() => onOpenBeat(pr.spawnedCombatBeatId!)}
                              >
                                Go to Generated Combat Beat ({pr.spawnedCombatBeatTitle || 'Combat'}) &rarr;
                              </button>
                            )}

                            {branch?.nextQuestion && !branch?.endsInCombat && (
                              <div
                                className="small mt-xs"
                                style={{
                                  color: '#38bdf8',
                                  borderTop: '1px dashed rgba(56, 189, 248, 0.35)',
                                  paddingTop: '4px',
                                }}
                              >
                                <b>&rarr; Next Question:</b> &ldquo;{branch.nextQuestion}&rdquo;
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
