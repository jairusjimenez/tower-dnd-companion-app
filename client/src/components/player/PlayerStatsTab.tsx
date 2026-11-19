import { computeStatModifier, isStatsAndEquipmentLocked, type Character, type RollLogEntry } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { DiabloEquipmentGrid } from '../common/DiabloEquipmentGrid';

function tierClass(t: string): string {
  return `tag-tier-${String(t || 'Normal').toLowerCase().replace(/\s+/g, '-')}`;
}

export function PlayerStatsTab({
  ch,
  onOpenBeat,
  onOpenBeatMap,
}: {
  ch: Character;
  onOpenBeat: (beatId: string) => void;
  onOpenBeatMap: (beatId: string) => void;
}) {
  const {
    state,
    sendAction,
    pushLocalToast,
    setTradeItemId,
    setGachaModalOpen,
    setGachaSpinData,
  } = useVtt();

  if (!state) return null;

  const isBuildLocked = isStatsAndEquipmentLocked(state);
  const xpNext = ch.xpToNext || ch.level * 100;
  const canLevelUp = Number(ch.xp || 0) >= xpNext;
  const unspentPts = Number(ch.unspentStatPoints || 0);
  const milestones = state.mechanics?.statMilestones || [];

  const passiveTickets = Number(ch.passiveTickets || 0);
  const hasPendingDraw = Boolean(ch.pendingPassiveDraw);
  const ownedPassives = ch.passives || [];

  // Build combined passive summary
  const passiveTotals = new Map<string, { val: number; unit: string }>();
  const addTotal = (label: string, val: number, unit = '') => {
    if (!val) return;
    const prev = passiveTotals.get(label) || { val: 0, unit };
    prev.val += val;
    passiveTotals.set(label, prev);
  };
  const specialEffects = new Map<string, { text: string; count: number; multPct: number }>();

  for (const p of ownedPassives) {
    const mult = Number(p.multiplierPct || 100) / 100;
    if (p.bonusAc) addTotal('Armor Class', Math.round(Number(p.bonusAc) * mult));
    if (p.bonusDr) addTotal('Damage Reduction', Math.round(Number(p.bonusDr) * mult));
    if (p.bonusHp) addTotal('Max HP', Math.round(Number(p.bonusHp) * mult));
    if (p.bonusMp) addTotal('Max MP', Math.round(Number(p.bonusMp) * mult));
    if (p.bonusSpeedSpaces) addTotal('Movement', Math.round(Number(p.bonusSpeedSpaces) * mult), ' Spaces');

    const desc = String(p.description || '');
    let matchedNumeric = Boolean(p.bonusAc || p.bonusDr || p.bonusHp || p.bonusMp || p.bonusSpeedSpaces);
    const patterns: Array<[RegExp, string, string]> = [
      [/\+(\d+)\s+(?:to\s+)?Initiative/gi, 'Initiative', ''],
      [/\+(\d+)\s+(?:to\s+)?(?:Melee\s+|Ranged\s+|Spell\s+)?Attack\s+Hit/gi, 'Attack Hit', ''],
      [/\+(\d+)\s+(?:Weapon\s+Damage|Melee\s+Damage)/gi, 'Weapon Damage', ''],
      [/\+(\d+)\s+Spell\s+(?:Power|Damage)/gi, 'Spell Power', ''],
      [/\+(\d+)\s+Range\s+Spaces?/gi, 'Range', ' Spaces'],
      [/\+(\d+)%\s+(?:bonus\s+)?Gold/gi, 'Bonus Gold', '%'],
      [/Restore\s+(\d+)\s+HP\s+at\s+the\s+start/gi, 'HP Regen / Turn', ''],
      [/Restore\s+(\d+)\s+MP\s+at\s+the\s+start/gi, 'MP Regen / Turn', ''],
    ];
    for (const [rx, label, unit] of patterns) {
      let m: RegExpExecArray | null;
      while ((m = rx.exec(desc)) !== null) {
        addTotal(label, Math.round(Number(m[1]) * mult), unit);
        matchedNumeric = true;
      }
    }
    if (!matchedNumeric && desc) {
      const key = desc.trim();
      const prev = specialEffects.get(key) || { text: key, count: 0, multPct: 0 };
      prev.count += 1;
      prev.multPct = Math.max(prev.multPct, Number(p.multiplierPct || 100));
      specialEffects.set(key, prev);
    }
  }

  const tierOrder = ['Normal', 'Advanced', 'Rare', 'Super Rare', 'Super Super Rare', 'Legendary', 'Mythic'];
  const tierCounts: Record<string, number> = {};
  for (const p of ownedPassives) {
    const t = p.tier || 'Normal';
    tierCounts[t] = (tierCounts[t] || 0) + Number(p.stacks || 1);
  }

  const odds = state.passiveGacha?.odds || {
    Normal: 55,
    Advanced: 22,
    Rare: 12,
    'Super Rare': 6,
    'Super Super Rare': 3,
    Legendary: 1.5,
    Mythic: 0.5,
  };
  const pool = state.passiveGacha?.pool || [];
  const poolCounts = pool.reduce<Record<string, number>>((acc, p) => {
    acc[p.tier] = (acc[p.tier] || 0) + 1;
    return acc;
  }, {});

  const activeBeat =
    (state.storyBeats || []).slice().reverse().find((b) => b.presented && b.status === 'active')
    || (state.storyBeats || []).slice().reverse().find((b) => b.presented);

  const feedItems = [
    ...(state.systemMessages || []).slice(0, 6).map((m) => ({
      id: m.id,
      ts: m.timestamp,
      kind: 'sys',
      text: `[${m.title}] ${m.message}`,
    })),
    ...(state.combatLog || []).slice(0, 8).map((c) => ({
      id: c.id,
      ts: c.timestamp,
      kind: 'combat',
      text: c.summary,
    })),
  ]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 12);

  const handleDrawPassive = async () => {
    if (ch.pendingPassiveDraw) {
      setGachaSpinData({ ...ch.pendingPassiveDraw, skipSpin: true });
      setGachaModalOpen(true);
      return;
    }
    const res = await sendAction<Record<string, unknown>>('roll_passive_gacha', { characterId: ch.id });
    if (res?.skill) {
      setGachaSpinData(res);
      setGachaModalOpen(true);
    }
  };

  return (
    <div className="two-col">
      <div className="col stack">
        <div className="panel card-glow-cyan">
          <div className="panel-header">
            <h3>Status</h3>
          </div>

          <div className="vitals-editor">
            <div className="bar-card">
              <div className="bar-row">
                <span>HP</span>
                <strong id="p-hp-readout">
                  {ch.hp} / {ch.maxHp}
                  {ch.tempHp ? ` (+${ch.tempHp} Temp)` : ''}
                </strong>
              </div>
              <div className="progress">
                <div
                  id="p-hp-fill"
                  className="progress-fill hp"
                  style={{ width: `${Math.max(0, Math.min(100, (ch.hp / (ch.maxHp || 1)) * 100))}%` }}
                />
              </div>
            </div>
            <div className="bar-card">
              <div className="bar-row">
                <span id="p-mp-name">{state.mechanics?.resourceName || 'Mana (MP)'}</span>
                <strong id="p-mp-readout">
                  {ch.mp} / {ch.maxMp}
                </strong>
              </div>
              <div className="progress">
                <div
                  id="p-mp-fill"
                  className="progress-fill mp"
                  style={{ width: `${ch.maxMp ? Math.max(0, Math.min(100, (ch.mp / ch.maxMp) * 100)) : 0}%` }}
                />
              </div>
            </div>
          </div>

          <div className="bar-card mt-xs">
            <div className="bar-row">
              <span>Experience (XP)</span>
              <div className="btn-row" style={{ alignItems: 'center', gap: '8px' }}>
                <strong id="p-xp-readout">
                  Lv {ch.level} • {ch.xp || 0} / {xpNext} XP
                </strong>
                <button
                  type="button"
                  id="btn-p-level-up"
                  className="btn btn-xs btn-gold"
                  disabled={!canLevelUp}
                  title={
                    canLevelUp
                      ? 'XP bar full — click to Level Up!'
                      : `Need ${xpNext} XP to level up (${ch.xp || 0}/${xpNext})`
                  }
                  onClick={async () => {
                    const res = await sendAction<{ outcome?: { level: number } }>('level_up', { characterId: ch.id });
                    if (res?.outcome) {
                      pushLocalToast({
                        title: `LEVEL UP! LEVEL ${res.outcome.level}`,
                        message: `${ch.name} reached Level ${res.outcome.level}! (+2 Stat Points & +1 Passive Skill Ticket)`,
                        category: 'loot',
                      });
                    }
                  }}
                >
                  Level Up
                </button>
              </div>
            </div>
            <div className="progress">
              <div
                id="p-xp-fill"
                className="progress-fill xp"
                style={{ width: `${Math.max(0, Math.min(100, ((ch.xp || 0) / xpNext) * 100))}%` }}
              />
            </div>
          </div>

          <div className="mini-stats-strip">
            <div className="mini-box" title="Armor Class: target roll needed to hit you">
              <span>Armor Class</span>
              <strong id="p-ac-val">{ch.ac}</strong>
              <small className="muted">Hit Defense</small>
            </div>
            <div className="mini-box" title="Damage Reduction: flat damage subtracted from incoming hits">
              <span>Damage Reduction</span>
              <strong id="p-dr-val">{ch.dr}</strong>
              <small className="muted">Dmg Reduced</small>
            </div>
            <div className="mini-box" title="Movement: grid spaces you can move per turn">
              <span>Move</span>
              <strong id="p-speed-val">{ch.speedSpaces || 6} Spaces</strong>
              <small className="muted">Per Turn</small>
            </div>
            <div className="mini-box mini-box-locked" title="Favor system is not unlocked yet">
              <span>Favor</span>
              <strong id="p-favor-val">1</strong>
              <small className="muted">Locked</small>
            </div>
          </div>

          <div className="panel-subheader">
            <span>
              Attributes{' '}
              {(isBuildLocked || unspentPts > 0) && (
                <span id="p-stat-points-pill" className="tag tag-gold">
                  {isBuildLocked ? `Locked (Active Story Beat) • +${unspentPts} Pts` : `+${unspentPts} Pts Available`}
                </span>
              )}
            </span>
            <code id="p-formula-badge" className="formula-pill">
              {state.mechanics?.statFormula || 'floor((SCORE-10)/2)'}
            </code>
          </div>

          <div id="p-stats-grid" className="stats-grid">
            {(state.mechanics?.stats || []).map((st) => {
              const score = Number(ch.stats?.[st.key] ?? st.defaultValue ?? 10);
              const mod = computeStatModifier(score, state.mechanics, ch);
              const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
              const statMilestones = milestones
                .filter((m) => m.statKey === st.key)
                .sort((a, b) => Number(a.threshold || 0) - Number(b.threshold || 0));
              const unlockedList = statMilestones.filter((m) => score >= Number(m.threshold || 20));
              const nextMs = statMilestones.find((m) => score < Number(m.threshold || 20));
              const msUnlocked = unlockedList.length > 0;
              const latestUnlocked = unlockedList[unlockedList.length - 1];

              return (
                <div key={st.key} className={`stat-card ${msUnlocked ? 'card-glow-gold' : ''}`}>
                  <div className="stat-key">{st.key}</div>
                  <div className="stat-mod">{modStr}</div>
                  <div className="btn-row" style={{ justifyContent: 'center', alignItems: 'center', gap: '4px' }}>
                    {score > 1 && (
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        disabled={isBuildLocked}
                        title={isBuildLocked ? 'Locked while session and story beat are active' : 'Refund 1 point to Pts Available'}
                        onClick={() => sendAction('allocate_stat', { characterId: ch.id, statKey: st.key, amount: -1 })}
                      >
                        -1
                      </button>
                    )}
                    <input type="number" value={score} readOnly style={{ width: '62px', textAlign: 'center' }} />
                    {unspentPts > 0 && (
                      <button
                        type="button"
                        className="btn btn-xs btn-gold"
                        disabled={isBuildLocked}
                        title={isBuildLocked ? 'Locked while session and story beat are active' : 'Spend 1 point from Pts Available'}
                        onClick={() => sendAction('allocate_stat', { characterId: ch.id, statKey: st.key, amount: 1 })}
                      >
                        +1
                      </button>
                    )}
                  </div>
                  <div className="btn-row mt-xs" style={{ justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-xs btn-outline"
                      onClick={async () => {
                        const res = await sendAction<{ roll?: RollLogEntry }>('roll_dice', {
                          count: 1,
                          sides: 20,
                          modifier: mod,
                          label: `${st.key} Check`,
                          rollerName: ch.name,
                        });
                        if (res?.roll) {
                          pushLocalToast({
                            title: `${st.key} CHECK`,
                            message: `Rolled ${res.roll.total} (${res.roll.formula})`,
                            category: 'info',
                          });
                        }
                      }}
                    >
                      d20{modStr}
                    </button>
                  </div>
                  {statMilestones.length > 0 && (
                    <div
                      className="muted small"
                      style={{ marginTop: '4px', color: msUnlocked ? '#fbbf24' : '#94a3b8' }}
                      title={(latestUnlocked || nextMs)?.description || ''}
                    >
                      {latestUnlocked && (
                        <div>
                          AWAKENED ({latestUnlocked.threshold}): {latestUnlocked.abilityName}
                        </div>
                      )}
                      {nextMs && (
                        <div>
                          Next {nextMs.threshold}: {nextMs.abilityName}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <details className="sub-details mt-sm">
            <summary>Skills &amp; Proficiencies</summary>
            <div id="p-skills-list" className="list-stack mt-sm">
              {(ch.skills || []).map((sk, idx) => {
                const baseScore = Number(ch.stats?.[sk.stat || ''] ?? 10);
                const mod = computeStatModifier(baseScore, state.mechanics, ch) + Number(sk.bonus || 0);
                const sign = mod >= 0 ? `+${mod}` : `${mod}`;
                return (
                  <div key={sk.id || `${sk.name}-${idx}`} className="item-card">
                    <div className="item-card-top">
                      <strong>
                        {sk.name} {sk.stat ? <span className="muted small">({sk.stat})</span> : null}
                      </strong>
                      <button
                        type="button"
                        className="btn btn-xs btn-cyan"
                        onClick={async () => {
                          const res = await sendAction<{ roll?: RollLogEntry }>('roll_dice', {
                            count: 1,
                            sides: 20,
                            modifier: mod,
                            label: sk.name,
                            rollerName: ch.name,
                          });
                          if (res?.roll) {
                            pushLocalToast({
                              title: sk.name.toUpperCase(),
                              message: `Rolled ${res.roll.total} (${res.roll.formula})`,
                              category: 'info',
                            });
                          }
                        }}
                      >
                        Roll {sign}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>

          <div className="panel-subheader mt-sm">
            <span>
              Passive Skills{' '}
              <span id="p-passive-tickets-pill" className="tag tag-gold">
                {passiveTickets} Ticket{passiveTickets === 1 ? '' : 's'}
              </span>
            </span>
            <button
              type="button"
              id="btn-roll-passive-gacha"
              className="btn btn-xs btn-purple"
              disabled={!hasPendingDraw && passiveTickets < 1}
              title={
                hasPendingDraw
                  ? 'You have an unresolved Passive Skill Lottery draw — click to Acquire or Decline'
                  : passiveTickets < 1
                    ? 'Level up to earn a Passive Skill Ticket'
                    : 'Spend 1 Passive Skill Ticket to draw a passive skill'
              }
              onClick={handleDrawPassive}
            >
              {hasPendingDraw ? 'Resume Pending Draw' : 'Draw Passive (1 Ticket)'}
            </button>
          </div>

          {ownedPassives.length > 0 && (
            <div id="p-passives-summary" className="list-stack mt-xs">
              <div className="gacha-odds-bar" style={{ marginBottom: '6px' }}>
                <span className="small muted">Acquired Tiers:</span>
                {tierOrder
                  .filter((t) => tierCounts[t] > 0)
                  .map((t) => (
                    <span key={t} className={`tag ${tierClass(t)}`}>
                      {t} ×{tierCounts[t]}
                    </span>
                  ))}
              </div>
              <div className="item-card">
                <div className="small muted" style={{ marginBottom: '4px' }}>
                  <strong>Combined Passive Effects</strong>
                </div>
                <div className="gacha-odds-bar">
                  {Array.from(passiveTotals.entries()).map(([label, { val, unit }]) => (
                    <span key={label} className="tag tag-cyan">
                      +{val}
                      {unit} {label}
                    </span>
                  ))}
                  {Array.from(specialEffects.values()).map((s) => (
                    <span key={s.text} className="tag tag-purple">
                      {s.text}
                      {s.count > 1 ? ` (×${s.count})` : s.multPct > 100 ? ` (${s.multPct}%)` : ''}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div id="p-passives-list" className="list-stack mt-xs">
            {ownedPassives.length > 0 ? (
              ownedPassives.map((p) => {
                const stacks = Number(p.stacks || 1);
                const multPct = Number(p.multiplierPct || 100);
                return (
                  <div key={p.id} className="item-card">
                    <div className="item-card-top">
                      <strong>
                        {p.name} <span className={`tag ${tierClass(p.tier)}`}>{p.tier}</span>
                        {stacks > 1 && <span className="tag tag-gold">×{stacks} ({multPct}%)</span>}
                      </strong>
                    </div>
                    <div className="small muted">{p.description}</div>
                  </div>
                );
              })
            ) : (
              <div className="small muted">No passive skills acquired yet. Level up to earn tickets!</div>
            )}
          </div>

          <details className="sub-details mt-xs">
            <summary>Passive Skill Odds</summary>
            <div id="p-passive-pool-list" className="small muted mt-xs">
              <div className="gacha-odds-bar">
                {Object.entries(odds).map(([tier, pct]) => (
                  <span key={tier} className={`tag ${tierClass(tier)}`}>
                    {tier}: {pct}%{poolCounts[tier] ? ` (${poolCounts[tier]})` : ''}
                  </span>
                ))}
              </div>
              <div className="small muted mt-xs">
                Pool size: {pool.length} passive skills. Duplicate pulls multiply the passive's effect (+50%, +60%, +70%, +80%, ...). Declining a draw grants Gold &amp; XP scaled to your floor level.
              </div>
            </div>
          </details>
        </div>
      </div>

      <div className="col stack">
        {activeBeat && (
          <div id="p-active-story-card" className="panel card-glow-gold">
            <div className="panel-header">
              <h3>{activeBeat.title}</h3>
              <span className="tag tag-gold">{activeBeat.floor}F</span>
            </div>
            <div className="story-narration">{activeBeat.narration}</div>
            <div className="btn-row mt-xs">
              <button type="button" className="btn btn-xs btn-gold" onClick={() => onOpenBeat(activeBeat.id)}>
                View Beat
              </button>
              <button type="button" className="btn btn-xs btn-cyan" onClick={() => onOpenBeatMap(activeBeat.id)}>
                View Map ({activeBeat.arena?.cols || 20}×{activeBeat.arena?.rows || 20})
              </button>
            </div>
          </div>
        )}

        <div className="panel card-glow-cyan">
          <div className="panel-header">
            <h3>Equipment &amp; Inventory</h3>
            <span id="p-stats-currency" className="tag tag-gold">
              {ch.currency?.gold || 0} Gold • {ch.currency?.manaStones || 0} Mana Stones
            </span>
          </div>
          <div className="panel-subheader"><span>Equipped Gear</span></div>
          <div id="p-stats-equip-list" className="d2-equip-grid mt-xs">
            <DiabloEquipmentGrid equipment={ch.equipment} />
          </div>
          <div className="panel-subheader mt-sm"><span>Inventory</span></div>
          <div id="p-stats-inv-list" className="list-stack mt-xs" style={{ maxHeight: '260px', overflowY: 'auto' }}>
            {(ch.inventory || []).length > 0 ? (
              ch.inventory.map((it) => {
                const isEquippable = it.category !== 'consumable' && it.category !== 'skill_book';
                return (
                  <div key={it.id} className="item-card">
                    <div className="item-card-top">
                      <strong>
                        {it.name} <span className="tag tag-cyan">{it.category || 'item'}</span>
                      </strong>
                      <span>
                        Qty {it.qty || 1}
                        {it.damageDice ? ` • ${it.damageDice}` : ''}
                      </span>
                    </div>
                    {it.notes && <div className="muted small">{it.notes}</div>}
                    <div className="btn-row mt-xs">
                      {it.category === 'consumable' && (
                        <button
                          type="button"
                          className="btn btn-xs btn-cyan"
                          onClick={() => sendAction('inventory_action', { characterId: ch.id, subAction: 'use_consumable', itemId: it.id })}
                        >
                          Use
                        </button>
                      )}
                      {isEquippable && (
                        <button
                          type="button"
                          className="btn btn-xs btn-gold"
                          disabled={isBuildLocked}
                          title={isBuildLocked ? 'Locked while session and story beat are active' : undefined}
                          onClick={() => sendAction('equipment_action', { characterId: ch.id, subAction: 'equip', itemId: it.id })}
                        >
                          Equip
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        onClick={() => {
                          const others = Object.values(state.characters || {}).filter((o) => o.id !== ch.id);
                          if (!others.length) {
                            pushLocalToast({ title: 'NO PLAYERS', message: 'No other players available to trade with.', category: 'warning' });
                            return;
                          }
                          setTradeItemId(it.id);
                        }}
                      >
                        Trade
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="muted small">Your inventory is empty.</div>
            )}
          </div>
        </div>

        <details className="panel sub-details-panel">
          <summary>System &amp; Combat Feed</summary>
          <div id="p-system-feed" className="feed-list mt-sm">
            {feedItems.map((f) => (
              <div key={f.id} className={`feed-entry ${f.kind}`}>
                {f.text}
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
