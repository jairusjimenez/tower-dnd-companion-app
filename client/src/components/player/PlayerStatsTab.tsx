import { useState } from 'react';
import {
  computeCharacterMoveSpaces,
  computePassiveModifiers,
  computeStatModifier,
  getPartyFloor,
  isStatsAndEquipmentLocked,
  type Character,
  type RollLogEntry,
} from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { SegmentedBar } from '../common/SegmentedBar';

type StatsSubTab = 'attributes' | 'passives' | 'history';

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
    setGachaModalOpen,
    setGachaSpinData,
    setActivePromptModal,
  } = useVtt();

  const [subTab, setSubTab] = useState<StatsSubTab>('attributes');
  const [showFormula, setShowFormula] = useState(false);

  if (!state) return null;

  const xpNext = ch.xpToNext || ch.level * 100;
  const unspentPts = Number(ch.unspentStatPoints || 0);
  const canLevelUp = (ch.xp || 0) >= xpNext;
  const milestones = state.mechanics?.statMilestones || [];
  const isBuildLocked = isStatsAndEquipmentLocked(state);
  const passiveTickets = Number(ch.passiveTickets || 0);
  const hasPendingDraw = Boolean(ch.pendingPassiveDraw);
  const ownedPassives = ch.passives || [];

  const pMods = computePassiveModifiers(ch);
  const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
  const partyFloor = state ? getPartyFloor(state) : 1;
  const moveInfo = computeCharacterMoveSpaces({
    agi: agiScore,
    floor: partyFloor,
    passiveSpeedBonus: pMods.bonusSpeedSpaces,
  });

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

  const unansweredPrompts = (activeBeat?.prompts || []).filter((pr) => {
    const isForMe = pr.target === 'all' || pr.target === ch.id;
    const answered = (pr.answers || []).some((a) => a.characterId === ch.id);
    return isForMe && !answered;
  });

  const feedItems = [
    ...(state.systemMessages || []).slice(0, 8).map((m) => ({
      id: m.id,
      ts: m.timestamp,
      kind: 'sys',
      text: `[${m.title}] ${m.message}`,
    })),
    ...(state.combatLog || []).slice(0, 10).map((c) => ({
      id: c.id,
      ts: c.timestamp,
      kind: 'combat',
      text: c.summary,
    })),
  ]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 14);

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

  const hpPct = Math.max(0, Math.min(100, (ch.hp / (ch.maxHp || 1)) * 100));
  const mpPct = ch.maxMp ? Math.max(0, Math.min(100, (ch.mp / ch.maxMp) * 100)) : 0;
  const xpPct = Math.max(0, Math.min(100, ((ch.xp || 0) / xpNext) * 100));

  return (
    <div className="pstats-shell">
      {/* CONCEPT A: UNIFIED VITALS CARD */}
      <section className="pstatus-vitals-card" aria-label="Character Vitals">
        <div className="pstatus-vital-row">
          <div className="pstatus-vital-top">
            <span className="pstatus-vital-label is-hp">HP</span>
            <strong id="p-hp-readout" className="pstatus-vital-val">
              {ch.hp} / {ch.maxHp}
              {ch.tempHp ? ` (+${ch.tempHp} Temp)` : ''}
            </strong>
          </div>
          <SegmentedBar
            pct={hpPct}
            maxValue={ch.maxHp}
            kind="hp"
            trackClassName="progress pstatus-progress"
            fillKind="hp"
            fillId="p-hp-fill"
            critical={hpPct > 0 && hpPct <= 20}
          />
        </div>

        <div className="pstatus-vital-row">
          <div className="pstatus-vital-top">
            <span id="p-mp-name" className="pstatus-vital-label is-mp">
              {state.mechanics?.resourceName || 'MP'}
            </span>
            <strong id="p-mp-readout" className="pstatus-vital-val">
              {ch.mp} / {ch.maxMp}
            </strong>
          </div>
          <SegmentedBar
            pct={mpPct}
            maxValue={ch.maxMp}
            kind="mp"
            trackClassName="progress pstatus-progress"
            fillKind="mp"
            fillId="p-mp-fill"
          />
        </div>

        <div className="pstatus-vital-row">
          <div className="pstatus-vital-top">
            <span className="pstatus-vital-label is-xp">EXP</span>
            <strong id="p-xp-readout" className="pstatus-vital-val">
              {ch.xp || 0} / {xpNext} XP
            </strong>
          </div>
          <div className="pstatus-xp-bar-row">
            <SegmentedBar
              pct={xpPct}
              maxValue={xpNext}
              kind="xp"
              trackClassName="progress pstatus-progress"
              trackStyle={{ flex: 1 }}
              fillKind="xp"
              fillId="p-xp-fill"
            />
            <button
              type="button"
              id="btn-p-level-up"
              className="btn btn-xs btn-gold pstatus-lvlup-btn"
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
      </section>

      {/* CONCEPT B: 3-COLUMN COMBAT STAT BENTO (AC, DR, MOVE) */}
      <section className="pcombat-stat-bento" aria-label="Combat Stats">
        <div className="pcombat-bento-tile" title="Armor Class: target roll needed to hit you">
          <div className="pcombat-bento-head">
            <svg viewBox="0 0 24 24" width="24" height="24" style={{ flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>AC</span>
          </div>
          <strong id="p-ac-val" className="pcombat-bento-val">{ch.ac}</strong>
          <small className="pcombat-bento-sub">Hit Defense</small>
        </div>

        <div className="pcombat-bento-tile" title="Damage Reduction: flat damage subtracted from incoming hits">
          <div className="pcombat-bento-head">
            <svg viewBox="0 0 24 24" width="24" height="24" style={{ flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M20 7l-8-4-8 4v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V7z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            <span>DR</span>
          </div>
          <strong id="p-dr-val" className="pcombat-bento-val">{ch.dr}</strong>
          <small className="pcombat-bento-sub">Dmg Reduced</small>
        </div>

        <div className="pcombat-bento-tile" title="Movement: Base 3 + AGI (+1 per 4 AGI > 10) + Floor scaling">
          <div className="pcombat-bento-head">
            <svg viewBox="0 0 24 24" width="24" height="24" style={{ flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M13 4v6l5 3M5 20h14" />
              <circle cx="13" cy="4" r="1" />
            </svg>
            <span>MOVE</span>
          </div>
          <strong id="p-speed-val" className="pcombat-bento-val">{moveInfo.total} Sp</strong>
          <small className="pcombat-bento-sub">
            Base {moveInfo.base}
            {moveInfo.agiBonus > 0 ? ` • AGI +${moveInfo.agiBonus}` : ''}
            {moveInfo.floorBonus > 0 ? ` • ${partyFloor}F +${moveInfo.floorBonus}` : ''}
          </small>
        </div>
      </section>

      {/* UNANSWERED DM QUESTION ALERT (ONLY WHEN NEEDED) */}
      {activeBeat && unansweredPrompts.length > 0 && (
        <div className="pstats-prompt-callout">
          <div className="pstats-prompt-text">
            <span className="tag tag-gold">DM QUESTION</span>
            <strong>{unansweredPrompts[0].question}</strong>
          </div>
          <div className="btn-row" style={{ gap: '6px' }}>
            <button
              type="button"
              className="btn btn-xs btn-gold"
              onClick={() => setActivePromptModal({ beatId: activeBeat.id, promptId: unansweredPrompts[0].id })}
            >
              Answer
            </button>
            <button type="button" className="btn btn-xs btn-outline" onClick={() => onOpenBeat(activeBeat.id)}>
              Open Beat
            </button>
          </div>
        </div>
      )}

      {/* CONCEPT C: SEGMENTED SUB-TAB BAR */}
      <div className="pstats-segmented" role="tablist" aria-label="Character Sheet Sections">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'attributes'}
          className={`pstats-seg-btn ${subTab === 'attributes' ? 'active' : ''}`}
          onClick={() => setSubTab('attributes')}
        >
          Attributes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'passives'}
          className={`pstats-seg-btn ${subTab === 'passives' ? 'active' : ''}`}
          onClick={() => setSubTab('passives')}
        >
          Passives ({ownedPassives.length})
          {(passiveTickets > 0 || hasPendingDraw) && <span className="pstats-seg-dot" aria-hidden="true" />}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'history'}
          className={`pstats-seg-btn ${subTab === 'history' ? 'active' : ''}`}
          onClick={() => setSubTab('history')}
        >
          History
        </button>
      </div>

      {/* TAB 1: CONCEPT C ATTRIBUTE ROWS */}
      {subTab === 'attributes' && (
        <section className="pstats-panel">
          <div className="pstats-section-head">
            <div className="pstats-section-title-row">
              <span className="pstats-section-label">ATTRIBUTES</span>
              {(isBuildLocked || unspentPts > 0) && (
                <span id="p-stat-points-pill" className="tag tag-gold">
                  {isBuildLocked ? 'Locked in Combat' : `+${unspentPts} Pts`}
                </span>
              )}
              {!isBuildLocked && Boolean(ch.statsConfirmed) && unspentPts === 0 && (
                <span className="tag tag-green">Confirmed</span>
              )}
            </div>
            <button
              type="button"
              className="pstats-info-btn"
              aria-label="Toggle Stat Formula"
              title="View Stat Modifier Formula"
              onClick={() => setShowFormula((v) => !v)}
            >
              i
            </button>
          </div>

          {showFormula && (
            <div className="pstats-formula-drawer">
              <code id="p-formula-badge" className="formula-pill">
                {state.mechanics?.statFormula || 'floor((SCORE-10)/2)'}
              </code>
            </div>
          )}

          <div id="p-stats-grid" className="pattr-list">
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
              const targetThreshold = Number((nextMs || latestUnlocked)?.threshold || 20);
              const msPct = Math.max(0, Math.min(100, (score / targetThreshold) * 100));
              const msLabel = nextMs
                ? `${score}/${nextMs.threshold} ${nextMs.abilityName}`
                : latestUnlocked
                  ? `Awakened: ${latestUnlocked.abilityName}`
                  : '';

              return (
                <div key={st.key} className={`pattr-row ${msUnlocked ? 'is-awakened' : ''}`}>
                  <div className="pattr-left">
                    <span className="pattr-key">{st.key}</span>
                    <strong className="pattr-score">{score}</strong>
                    <span className="pattr-mod">{modStr}</span>
                  </div>

                  <div className="pattr-mid" title={(latestUnlocked || nextMs)?.description || ''}>
                    {msLabel && (
                      <>
                        <div className="pattr-ms-label">{msLabel}</div>
                        <div className="pattr-ms-track">
                          <div
                            className={`pattr-ms-fill ${msUnlocked ? 'is-gold' : ''}`}
                            style={{ width: `${msPct}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>

                  <div className="pattr-actions">
                    {!isBuildLocked && !(Boolean(ch.statsConfirmed) && unspentPts === 0) && score > 1 && (
                      <button
                        type="button"
                        className="btn btn-xs btn-outline pattr-step-btn readonly-allow"
                        title="Refund 1 point"
                        onClick={() => sendAction('allocate_stat', { characterId: ch.id, statKey: st.key, amount: -1 })}
                      >
                        -
                      </button>
                    )}
                    {!isBuildLocked && unspentPts > 0 && (
                      <button
                        type="button"
                        className="btn btn-xs btn-gold pattr-step-btn readonly-allow"
                        title="Spend 1 point"
                        onClick={() => sendAction('allocate_stat', { characterId: ch.id, statKey: st.key, amount: 1 })}
                      >
                        +
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-xs btn-outline pattr-roll-btn"
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
                </div>
              );
            })}
          </div>

          {!isBuildLocked && unspentPts === 0 && !ch.statsConfirmed && (
            <button
              type="button"
              id="btn-confirm-stats"
              className="btn btn-cyan btn-glow-cyan readonly-allow mt-sm"
              style={{ width: '100%' }}
              onClick={async () => {
                const res = await sendAction('allocate_stat', { characterId: ch.id, subAction: 'confirm' });
                if (res) {
                  pushLocalToast({
                    title: 'STATS CONFIRMED',
                    message: 'Your stat allocation is locked in until your next level up.',
                    category: 'info',
                  });
                }
              }}
            >
              Confirm Stats
            </button>
          )}

          {(ch.skills || []).length > 0 && (
            <details className="sub-details mt-sm">
              <summary>Skills &amp; Proficiencies ({(ch.skills || []).length})</summary>
              <div id="p-skills-list" className="list-stack mt-xs">
                {(ch.skills || []).map((sk, idx) => {
                  const baseScore = Number(ch.stats?.[sk.stat || ''] ?? 10);
                  const mod = computeStatModifier(baseScore, state.mechanics, ch) + Number(sk.bonus || 0);
                  const sign = mod >= 0 ? `+${mod}` : `${mod}`;
                  return (
                    <div key={sk.id || `${sk.name}-${idx}`} className="item-card small">
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
          )}
        </section>
      )}

      {/* TAB 2: PASSIVES */}
      {subTab === 'passives' && (
        <section className="pstats-panel">
          <div className="pstats-section-head">
            <span id="p-passive-tickets-pill" className="tag tag-gold">
              {passiveTickets} Ticket{passiveTickets === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              id="btn-roll-passive-gacha"
              className="btn btn-xs btn-purple"
              disabled={!hasPendingDraw && passiveTickets < 1}
              onClick={handleDrawPassive}
            >
              {hasPendingDraw ? 'Resume Pending Draw' : 'Draw Passive (1 Ticket)'}
            </button>
          </div>

          {ownedPassives.length > 0 && (
            <div id="p-passives-summary" className="list-stack mt-xs">
              <div className="gacha-odds-bar">
                {tierOrder
                  .filter((t) => tierCounts[t] > 0)
                  .map((t) => (
                    <span key={t} className={`tag ${tierClass(t)}`}>
                      {t} &times;{tierCounts[t]}
                    </span>
                  ))}
              </div>
              {(passiveTotals.size > 0 || specialEffects.size > 0) && (
                <div className="item-card small">
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
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div id="p-passives-list" className="list-stack mt-xs">
            {ownedPassives.length > 0 ? (
              ownedPassives.map((p) => {
                const stacks = Number(p.stacks || 1);
                const multPct = Number(p.multiplierPct || 100);
                return (
                  <div key={p.id} className="item-card small">
                    <div className="item-card-top">
                      <strong>
                        {p.name} <span className={`tag ${tierClass(p.tier)}`}>{p.tier}</span>
                        {stacks > 1 && <span className="tag tag-gold">&times;{stacks} ({multPct}%)</span>}
                      </strong>
                    </div>
                    <div className="small muted">{p.description}</div>
                  </div>
                );
              })
            ) : (
              <div className="item-card small muted">No passive skills acquired yet. Level up to earn tickets!</div>
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
                Pool size: {pool.length} passive skills. Duplicate pulls multiply the passive&apos;s effect (+50%, +60%, +70%, ...).
              </div>
            </div>
          </details>
        </section>
      )}

      {/* TAB 3: HISTORY */}
      {subTab === 'history' && (
        <section className="pstats-panel">
          {activeBeat && (
            <div className="item-card small mb-xs" style={{ borderColor: 'rgba(251, 191, 36, 0.4)' }}>
              <div className="item-card-top">
                <strong>
                  {activeBeat.title} <span className="tag tag-gold">{activeBeat.floor}F</span>
                </strong>
                <div className="btn-row" style={{ gap: '6px' }}>
                  <button type="button" className="btn btn-xs btn-gold" onClick={() => onOpenBeat(activeBeat.id)}>
                    Open
                  </button>
                  {activeBeat.beatType !== 'narration' && (
                    <button type="button" className="btn btn-xs btn-cyan" onClick={() => onOpenBeatMap(activeBeat.id)}>
                      Map
                    </button>
                  )}
                </div>
              </div>
              {activeBeat.narration && <div className="small muted mt-xs">{activeBeat.narration}</div>}
            </div>
          )}

          <div id="p-system-feed" className="feed-list">
            {feedItems.length > 0 ? (
              feedItems.map((f) => (
                <div key={f.id} className={`feed-entry ${f.kind}`}>
                  {f.text}
                </div>
              ))
            ) : (
              <div className="item-card small muted">No recent combat or system events yet.</div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
