import { computePassiveModifiers, computeStatModifier, isStatsAndEquipmentLocked, type Character, type RollLogEntry } from '@shared/index';
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
    setActivePromptModal,
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

  // Build combined passive summary from structured PassiveModifiers
  const pMods = computePassiveModifiers(ch);
  const passiveTotals = new Map<string, { val: number; unit: string }>();
  const addTotal = (label: string, val: number, unit = '') => {
    if (!val) return;
    passiveTotals.set(label, { val, unit });
  };

  addTotal('Max HP', pMods.bonusHp);
  addTotal('Max MP', pMods.bonusMp);
  addTotal('Armor Class', pMods.bonusAc);
  addTotal('Damage Reduction', pMods.bonusDr);
  addTotal('Movement', pMods.bonusSpeedSpaces, ' Spaces');
  addTotal('Initiative', pMods.bonusInitiative);
  addTotal('Attack Hit', pMods.bonusAttackHit);
  addTotal('Melee Hit', pMods.bonusMeleeHit);
  addTotal('Ranged Hit', pMods.bonusRangedHit);
  addTotal('Spell Hit', pMods.bonusSpellHit);
  addTotal('Weapon Damage', pMods.bonusWeaponDamage);
  addTotal('Melee Damage', pMods.bonusMeleeDamage);
  addTotal('Ranged Damage', pMods.bonusRangedDamage);
  addTotal('Spell Power', pMods.bonusSpellPower);
  addTotal('Elemental Spell Dmg', pMods.bonusElementalSpellDamage);
  addTotal('Crit Damage', pMods.bonusCritDamage);
  addTotal('Ignore Enemy DR', pMods.ignoreEnemyDr);
  addTotal('Ranged Range', pMods.bonusRangedRangeSpaces, ' Spaces');
  addTotal('Spell Range', pMods.bonusSpellRangeSpaces, ' Spaces');
  addTotal('HP Regen / Turn', pMods.hpRegenPerTurn);
  addTotal('MP Regen / Turn', pMods.mpRegenPerTurn);
  addTotal('Rest Spot HP', pMods.restSpotBonusHp);
  addTotal('Rest Spot MP', pMods.restSpotBonusMp);
  addTotal('Consumable HP', pMods.consumableBonusHp);
  addTotal('Consumable MP', pMods.consumableBonusMp);
  addTotal('Healing Received', pMods.healingReceivedBonus);
  addTotal('Bonus Gold', pMods.bonusGoldPct, '%');
  addTotal('Parry Roll', pMods.bonusParryRoll);
  addTotal('Counter Damage', pMods.bonusCounterDamage);
  addTotal('Evasion', pMods.evasionPct, '%');
  addTotal('Spell MP Discount', pMods.spellMpDiscount);

  const specialEffects = new Map<string, { text: string; count: number; multPct: number }>();
  const addSpecial = (text: string) => {
    if (!text) return;
    specialEffects.set(text, { text, count: 1, multPct: 100 });
  };
  if (pMods.critThreshold !== null) addSpecial(`Crit on ${pMods.critThreshold}-20`);
  if (pMods.critMultiplier !== null) addSpecial(`Crit ×${pMods.critMultiplier}`);
  if (pMods.ignoreAllEnemyDr) addSpecial('Ignore All Enemy DR');
  if (pMods.actFirstInInitiative) addSpecial('Act First in Initiative');
  if (pMods.allAttributesInCombat > 0) addSpecial(`+${pMods.allAttributesInCombat} All Stat Mods in Combat`);
  if (pMods.zeroCostAllSpells) addSpecial('All Spells Cost 0 MP');
  else if (pMods.zeroCostFirstSpell) addSpecial('First Spell Costs 0 MP');
  if (pMods.revivePerCombatPct > 0) addSpecial(`Revive ${pMods.revivePerCombatPct}% HP${pMods.reviveMpAlso ? ' & MP' : ''} (1/combat)`);
  if (pMods.surviveFatalPerCombat) addSpecial('Survive Lethal Hit at 1 HP (1/combat)');
  if (pMods.undyingLegendPerCombat) addSpecial('1 HP Floor for 1 Round (1/combat)');
  if (pMods.damageBonusVsLowLevel > 0) addSpecial(`+${pMods.damageBonusVsLowLevel} Dmg vs Lv 1-10`);
  if (pMods.damageBonusVsBossPct > 0) addSpecial(`+${pMods.damageBonusVsBossPct}% Dmg vs Boss/Elite`);
  if (pMods.aoeAllEnemiesWithin4Spaces) addSpecial('Spells Hit All Foes Within 4 Spaces');
  if (pMods.hitAdditionalNearbyFoe) addSpecial('Weapon Strike Hits +1 Nearby Foe');
  for (const note of pMods.specialNotes) addSpecial(note);

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
                        const floorNum = Math.max(1, Number(ch.currentFloor || state.map?.currentFloor || 1));
                        const dc = 10 + Math.floor(floorNum * 1.2);
                        const res = await sendAction<{ roll?: RollLogEntry }>('roll_dice', {
                          count: 1,
                          sides: 20,
                          modifier: mod,
                          dc,
                          label: `${st.key} Check (DC ${dc})`,
                          rollerName: ch.name,
                        });
                        if (res?.roll) {
                          pushLocalToast({
                            title: `${st.key} CHECK`,
                            message: `Rolled ${res.roll.total} vs DC ${dc} (${res.roll.passed ? 'SUCCESS' : 'FAILED'})`,
                            category: res.roll.passed ? 'loot' : 'warning',
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
                          const floorNum = Math.max(1, Number(ch.currentFloor || state.map?.currentFloor || 1));
                          const dc = 10 + Math.floor(floorNum * 1.2);
                          const res = await sendAction<{ roll?: RollLogEntry }>('roll_dice', {
                            count: 1,
                            sides: 20,
                            modifier: mod,
                            dc,
                            label: `${sk.name} Check (DC ${dc})`,
                            rollerName: ch.name,
                          });
                          if (res?.roll) {
                            pushLocalToast({
                              title: sk.name.toUpperCase(),
                              message: `Rolled ${res.roll.total} vs DC ${dc} (${res.roll.passed ? 'SUCCESS' : 'FAILED'})`,
                              category: res.roll.passed ? 'loot' : 'warning',
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
              <div className="btn-row">
                <span className={`tag ${activeBeat.beatType === 'narration' ? 'tag-purple' : 'tag-crimson'}`}>
                  {activeBeat.beatType === 'narration' ? 'NARRATION' : 'COMBAT'}
                </span>
                <span className="tag tag-gold">{activeBeat.floor}F</span>
              </div>
            </div>
            <div className="story-narration">{activeBeat.narration}</div>
            {(activeBeat.prompts || []).length > 0 && (
              <div className="list-stack mt-xs">
                {activeBeat.prompts!.map((pr) => {
                  const isForMe = pr.target === 'all' || pr.target === ch.id;
                  const myAns = (pr.answers || []).find((a) => a.characterId === ch.id);
                  const partyCount = Object.keys(state.characters || {}).length;
                  const allGroupDone =
                    pr.target === 'all'
                      ? partyCount > 0 && (pr.answers || []).length >= partyCount
                      : (pr.answers || []).length >= 1;
                  return (
                    <div key={pr.id} className="item-card" style={{ borderColor: 'rgba(168, 85, 247, 0.45)' }}>
                      <div className="item-card-top">
                        <strong className="small">
                          <span className={`tag ${pr.target === 'all' ? 'tag-cyan' : 'tag-gold'}`}>
                            {pr.target === 'all' ? 'DM Asks Group' : `DM Asks ${pr.targetName}`}
                          </span>{' '}
                          &ldquo;{pr.question}&rdquo;
                        </strong>
                        {isForMe && (
                          <button
                            type="button"
                            className="btn btn-xs btn-gold"
                            onClick={() => setActivePromptModal({ beatId: activeBeat.id, promptId: pr.id })}
                          >
                            {myAns ? (allGroupDone ? 'View Poll' : 'Waiting Status') : 'Answer in Modal'}
                          </button>
                        )}
                      </div>
                      {myAns && !allGroupDone ? (
                        <div className="small mt-xs" style={{ color: '#fbbf24' }}>
                          Waiting on other players to make an answer...
                        </div>
                      ) : (
                        (pr.answers || []).map((ans) => (
                          <div key={ans.id} className="small mt-xs" style={{ paddingLeft: '6px', borderLeft: '2px solid #38bdf8' }}>
                            <b style={{ color: '#38bdf8' }}>{ans.characterName}:</b> &ldquo;{ans.answer}&rdquo;
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="btn-row mt-xs">
              <button type="button" className="btn btn-xs btn-gold" onClick={() => onOpenBeat(activeBeat.id)}>
                View Beat{(activeBeat.prompts || []).length > 0 ? ' & Answer DM' : ''}
              </button>
              {activeBeat.beatType !== 'narration' && (
                <button type="button" className="btn btn-xs btn-cyan" onClick={() => onOpenBeatMap(activeBeat.id)}>
                  View Map ({activeBeat.arena?.cols || 20}×{activeBeat.arena?.rows || 20})
                </button>
              )}
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
