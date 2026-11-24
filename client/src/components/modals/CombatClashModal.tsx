import { useEffect, useRef, useState } from 'react';
import {
  UNIT_EFFECT_META,
  buildCharacterVarScope,
  computeCounterBleedChancePct,
  computeParryStunChancePct,
  computePassiveModifiers,
  computeStatModifier,
  evaluateFormula,
  getEquippedTotals,
  resolvePlayerDefenseReaction,
  resolvePlayerReactionStyle,
  scaleSpellForLevel,
  spaceDistanceBetweenPoints,
  type MonsterDefeatSummary,
  type PendingReaction,
  type Spell,
} from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { PolyhedralDieSvg } from '../common/DiceTrayStage';
import { SegmentedBar } from '../common/SegmentedBar';

interface ResolutionReport {
  clash: PendingReaction;
  summary: string;
  dmgTaken: number;
  counterDamageDealt: number;
}

function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function parseSides(formula?: string, fallback = 8): 4 | 6 | 8 | 10 | 12 | 20 {
  const m = String(formula || '').match(/d(\d+)/i);
  const raw = m ? Number(m[1]) : fallback;
  if (raw === 4 || raw === 6 || raw === 8 || raw === 10 || raw === 12 || raw === 20) return raw;
  return 8;
}

function estimateAverageDice(formula: string): number {
  const clean = String(formula || '').replace(/\s+/g, '');
  const m = clean.match(/^(\d+)?d(\d+)([+-]\d+)?$/i);
  if (m) {
    const count = Math.max(1, Number(m[1] || 1));
    const sides = Math.max(1, Number(m[2] || 8));
    const mod = Number(m[3] || 0);
    return count * ((sides + 1) / 2) + mod;
  }
  const flat = Number(clean);
  return Number.isFinite(flat) ? flat : 7.5;
}

export function CombatClashModal() {
  const { session, state, sendAction, setDefeatedMonster, activeBeatDetailId } = useVtt();

  const [dmRolling, setDmRolling] = useState(false);
  const [dmFlicker, setDmFlicker] = useState(12);
  const [dmDmgFlicker, setDmDmgFlicker] = useState(6);
  const [playerRolling, setPlayerRolling] = useState(false);
  const [playerFlicker, setPlayerFlicker] = useState(14);
  const [spellDmgFlicker, setSpellDmgFlicker] = useState(8);
  const [spellPickerOpen, setSpellPickerOpen] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Record<string, boolean>>({});
  const [resolutionReport, setResolutionReport] = useState<ResolutionReport | null>(null);

  const lastSeenReactionIdRef = useRef<string | null>(null);
  const lastSeenResolvedIdRef = useRef<string | null>(null);

  const isDm = session?.role === 'dm';
  const myCharId = session?.characterId || null;

  const pendingReaction: PendingReaction | undefined = (state?.pendingReactions || []).find(
    (r) => isDm || !myCharId || r.targetCharacterId === myCharId,
  );
  const resolvedClash: PendingReaction | null | undefined =
    state?.lastResolvedClash &&
    (isDm || !myCharId || state.lastResolvedClash.targetCharacterId === myCharId)
      ? state.lastResolvedClash
      : null;

  const pendingOrResolvedClash: PendingReaction | null =
    pendingReaction && !dismissedIds[`pending-${pendingReaction.id}`]
      ? pendingReaction
      : resolvedClash && !dismissedIds[`resolved-${resolvedClash.id}`]
        ? resolvedClash
        : null;

  useEffect(() => {
    if (!pendingReaction?.id) return;
    if (lastSeenReactionIdRef.current === pendingReaction.id) return;
    lastSeenReactionIdRef.current = pendingReaction.id;

    setPlayerRolling(false);
    setSpellPickerOpen(false);
    setDmRolling(true);
    setDmFlicker(Math.floor(Math.random() * 20) + 1);
    setDmDmgFlicker(Math.floor(Math.random() * 8) + 1);
    const tick = window.setInterval(() => {
      setDmFlicker(Math.floor(Math.random() * 20) + 1);
      setDmDmgFlicker(Math.floor(Math.random() * 8) + 1);
    }, 65);
    const stop = window.setTimeout(() => {
      window.clearInterval(tick);
      setDmRolling(false);
    }, 650);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(stop);
    };
  }, [pendingReaction?.id]);

  useEffect(() => {
    if (!resolvedClash || !resolvedClash.resolved) return;
    const key = `${resolvedClash.id}-${resolvedClash.resolvedAt || ''}`;
    if (lastSeenResolvedIdRef.current === key) return;
    lastSeenResolvedIdRef.current = key;

    setPlayerRolling(true);
    setPlayerFlicker(Math.floor(Math.random() * 20) + 1);
    setSpellDmgFlicker(Math.floor(Math.random() * 12) + 1);
    const tick = window.setInterval(() => {
      setPlayerFlicker(Math.floor(Math.random() * 20) + 1);
      setSpellDmgFlicker(Math.floor(Math.random() * 12) + 1);
    }, 65);
    const stop = window.setTimeout(() => {
      window.clearInterval(tick);
      setPlayerRolling(false);
    }, 650);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(stop);
    };
  }, [resolvedClash?.id, resolvedClash?.resolvedAt]);

  const activeClash = resolutionReport ? resolutionReport.clash : pendingOrResolvedClash;
  const hostBeatForClash =
    activeClash && state
      ? (state.storyBeats || []).find((b) => b.arena?.tokens?.some((t) => t.id === activeClash.monsterId))
      : undefined;
  const viewedBeat =
    state && activeBeatDetailId
      ? (state.storyBeats || []).find((b) => b.id === activeBeatDetailId)
      : undefined;
  const clashEventEnded = Boolean(
    (viewedBeat && (viewedBeat.status === 'resolved' || viewedBeat.status === 'failed')) ||
      (hostBeatForClash && (hostBeatForClash.status === 'resolved' || hostBeatForClash.status === 'failed')) ||
      (state && !state.combat?.active && !pendingReaction),
  );

  useEffect(() => {
    if (clashEventEnded && resolutionReport) {
      setResolutionReport(null);
    }
  }, [clashEventEnded, resolutionReport]);

  if (!session || !state) return null;
  if (!activeClash || clashEventEnded) return null;

  const targetChar = state.characters?.[activeClash.targetCharacterId];
  const monster = (state.monsters || []).find((m) => m.id === activeClash.monsterId);
  const isResolved = Boolean(resolutionReport || activeClash.resolved);

  const activeBeat = (state.storyBeats || []).find(
    (b) =>
      b.beatType !== 'narration' &&
      b.status !== 'resolved' &&
      b.status !== 'failed' &&
      (b.arena?.tokens || []).some((t) => t.id === activeClash.monsterId),
  );
  const playerTok = activeBeat?.arena?.tokens?.find((t) => t.id === activeClash.targetCharacterId);
  const monTok = activeBeat?.arena?.tokens?.find((t) => t.id === activeClash.monsterId);
  const monsterDist =
    playerTok && monTok
      ? spaceDistanceBetweenPoints(playerTok.x, playerTok.y, monTok.x, monTok.y)
      : null;

  const playerSpells = targetChar?.spells || [];
  const reactionSpells = playerSpells.filter((sp) => sp.actionType === 'Reaction');
  const usableReactionSpells = reactionSpells.filter((sp) => {
    if (Number(targetChar?.mp || 0) < Number(sp.mpCost || 0)) return false;
    const isSelfOnly = Boolean(sp.effectSpec?.target === 'self' && !sp.damageDice);
    if (!isSelfOnly && monsterDist !== null) {
      const range = Math.max(1, Number(sp.rangeSpaces || 3));
      if (monsterDist > range) return false;
    }
    return true;
  });

  const styleInfo = resolvePlayerReactionStyle(targetChar);
  const defenseInfo = resolvePlayerDefenseReaction(targetChar);

  const expectedCounterDmg = (() => {
    if (!targetChar) return 0;
    const mods = computePassiveModifiers(targetChar);
    const weapon = getEquippedTotals(targetChar).mainWeapon;
    const dmgFormula = weapon?.damageDice || '1d8+3';
    const avgRaw = estimateAverageDice(dmgFormula) + mods.bonusCounterDamage + mods.bonusWeaponDamage + mods.bonusMeleeDamage;
    const agiScore = targetChar.stats?.AGI ?? targetChar.stats?.STR ?? 12;
    const statMod = computeStatModifier(agiScore, state.mechanics, targetChar);
    const targetDr =
      monster && monster.hp !== null
        ? mods.ignoreAllEnemyDr
          ? 0
          : Math.max(0, Number(monster.dr || 0) - mods.ignoreEnemyDr)
        : 0;
    const scope = buildCharacterVarScope(targetChar, state.mechanics, {
      RAW_DMG: avgRaw,
      STAT_MOD: statMod,
      TARGET_DR: targetDr,
      TARGET_AC: Number(monster?.ac || 10),
      CRIT_MULT: 1,
    });
    return Math.max(1, Math.round(evaluateFormula(state.mechanics.damageFormula, scope)));
  })();

  const bleedChancePct = computeCounterBleedChancePct(Number(targetChar?.stats?.AGI ?? 10));
  const stunChancePct = computeParryStunChancePct(
    Number(targetChar?.stats?.STR ?? 10),
    Number(targetChar?.stats?.PER ?? 10),
  );
  const expectedFailDmg = Math.max(1, Math.round(activeClash.incomingDamage) - Number(targetChar?.dr || 0));
  const expectedBlockWinDmg = Math.max(
    0,
    Math.round(expectedFailDmg * (1 - (defenseInfo.mitigationPct || 25) / 100)),
  );

  const computeSpellPreview = (sp: Spell): { mode: 'heal' | 'support' | 'damage'; amount: number } => {
    if (sp.healFormula) {
      return {
        mode: 'heal',
        amount: Math.max(1, Math.round(estimateAverageDice(sp.healFormula))),
      };
    }
    const isSelfOnly = Boolean(
      sp.effectSpec &&
        (sp.effectSpec.target === 'self' || UNIT_EFFECT_META[sp.effectSpec.kind]?.defaultTarget === 'self') &&
        !sp.damageDice,
    );
    if (isSelfOnly) {
      return {
        mode: 'support',
        amount: Math.max(1, Math.floor(expectedFailDmg / 2)),
      };
    }
    if (!targetChar) return { mode: 'damage', amount: 0 };
    const mods = computePassiveModifiers(targetChar);
    const bonusDiceAvg = mods.bonusReactionSpellDice.reduce((sum, d) => sum + estimateAverageDice(d), 0);
    const rawAvg = estimateAverageDice(sp.damageDice || '2d6') + bonusDiceAvg + mods.bonusSpellPower;
    const intMod = computeStatModifier(targetChar.stats?.INT ?? 12, state.mechanics, targetChar);
    const targetDr =
      monster && monster.hp !== null
        ? mods.ignoreAllEnemyDr
          ? 0
          : Math.max(0, Number(monster.dr || 0) - mods.ignoreEnemyDr)
        : 0;
    const scope = buildCharacterVarScope(targetChar, state.mechanics, {
      RAW_DMG: rawAvg,
      STAT_MOD: intMod,
      TARGET_DR: targetDr,
      TARGET_AC: Number(monster?.ac || 10),
      CRIT_MULT: 1,
    });
    return {
      mode: 'damage',
      amount: Math.max(1, Math.round(evaluateFormula(state.mechanics.damageFormula, scope))),
    };
  };

  const renderSpellPreviewBar = (sp: Spell) => {
    const preview = computeSpellPreview(sp);
    if (preview.mode === 'heal') {
      const curHp = Number(targetChar?.hp ?? 0);
      const maxHp = Number(targetChar?.maxHp ?? 0);
      const afterHp = maxHp > 0 ? Math.min(maxHp, curHp + preview.amount) : curHp + preview.amount;
      const curPct = maxHp > 0 ? Math.max(0, Math.min(100, (curHp / maxHp) * 100)) : 0;
      const afterPct = maxHp > 0 ? Math.max(0, Math.min(100, (afterHp / maxHp) * 100)) : 0;
      return (
        <div className="clash-btn-stats">
          <div className="clash-btn-stat-line">
            Expected Heal: <b className="clash-btn-heal-delta">+{preview.amount} HP</b>
          </div>
          {targetChar && maxHp > 0 && (
            <>
              <SegmentedBar
                pct={curPct}
                ghostPct={afterPct}
                ghostColor="rgba(34, 197, 94, 0.55)"
                maxValue={maxHp}
                kind="hp"
                trackClassName="progress clash-btn-bar"
                fillKind="hp"
                critical={curPct > 0 && curPct <= 20}
              />
              <div className="clash-btn-hp-note">
                {curHp} &rarr; {afterHp}/{maxHp} HP
              </div>
            </>
          )}
        </div>
      );
    }
    if (preview.mode === 'support') {
      const curHp = Number(targetChar?.hp ?? 0);
      const maxHp = Number(targetChar?.maxHp ?? 0);
      const afterHp = Math.max(0, curHp - preview.amount);
      const curPct = maxHp > 0 ? Math.max(0, Math.min(100, (curHp / maxHp) * 100)) : 0;
      const afterPct = maxHp > 0 ? Math.max(0, Math.min(100, (afterHp / maxHp) * 100)) : 0;
      return (
        <div className="clash-btn-stats">
          <div className="clash-btn-stat-line">
            Support &bull; Halves Hit <span className="clash-btn-dmg-delta">(-{preview.amount} HP)</span>
          </div>
          {targetChar && maxHp > 0 && (
            <>
              <SegmentedBar
                pct={afterPct}
                ghostPct={curPct}
                ghostColor="rgba(248, 113, 113, 0.55)"
                maxValue={maxHp}
                kind="hp"
                trackClassName="progress clash-btn-bar"
                fillKind="hp"
                critical={afterPct > 0 && afterPct <= 20}
              />
              <div className="clash-btn-hp-note">
                {curHp} &rarr; {afterHp}/{maxHp} HP
              </div>
            </>
          )}
        </div>
      );
    }
    return (
      <div className="clash-btn-stats">
        <div className="clash-btn-stat-line">
          Expected Damage: <b>{preview.amount}</b>
        </div>
        {monster && (
          <SegmentedBar
            pct={
              monster.hp !== null && monster.maxHp
                ? Math.max(0, Math.min(100, (Math.max(0, monster.hp - preview.amount) / monster.maxHp) * 100))
                : Math.max(0, Math.min(100, Number(monster.hpPct ?? 100)))
            }
            ghostPct={
              monster.hp !== null && monster.maxHp
                ? Math.max(0, Math.min(100, (monster.hp / monster.maxHp) * 100))
                : undefined
            }
            ghostColor="rgba(251, 191, 36, 0.55)"
            maxValue={monster.maxHp ?? 0}
            ticks={monster.hpBarTicks}
            kind="monster"
            trackClassName="progress clash-btn-bar"
            fillKind="monster"
          />
        )}
      </div>
    );
  };

  const handleContinue = () => {
    if (!isResolved || playerRolling) return;
    setDismissedIds((prev) => ({
      ...prev,
      [`pending-${activeClash.id}`]: true,
      [`resolved-${activeClash.id}`]: true,
    }));
    setResolutionReport(null);
  };

  const handlePlayerReactionRoll = async (choice: 'react' | 'spell' | 'dodge' | 'block', spellIdOverride?: string) => {
    if (playerRolling) return;
    const clashSnapshot = activeClash;
    setPlayerRolling(true);
    setPlayerFlicker(Math.floor(Math.random() * 20) + 1);
    setSpellDmgFlicker(Math.floor(Math.random() * 12) + 1);
    const tick = window.setInterval(() => {
      setPlayerFlicker(Math.floor(Math.random() * 20) + 1);
      setSpellDmgFlicker(Math.floor(Math.random() * 12) + 1);
    }, 65);
    try {
      const res = await sendAction<{
        summary?: string;
        dmgTaken?: number;
        counterDamageDealt?: number;
        resolvedClash?: PendingReaction;
        defeatSummary?: MonsterDefeatSummary | null;
      }>('resolve_reaction', {
        reactionId: clashSnapshot.id,
        choice,
        spellId: choice === 'spell' ? spellIdOverride : undefined,
      });
      window.clearInterval(tick);
      setPlayerRolling(false);
      if (res?.defeatSummary && res.defeatSummary.monsterId === clashSnapshot.monsterId) {
        setDismissedIds((prev) => ({
          ...prev,
          [`pending-${clashSnapshot.id}`]: true,
          [`resolved-${clashSnapshot.id}`]: true,
        }));
        setResolutionReport(null);
        setDefeatedMonster(res.defeatSummary);
        return;
      }
      if (res) {
        const mergedClash: PendingReaction = {
          ...(res.resolvedClash || clashSnapshot),
          resolved: true,
          playerChoice: res.resolvedClash?.playerChoice ?? choice,
          dmgTaken: Number(res.dmgTaken ?? res.resolvedClash?.dmgTaken ?? 0),
          counterDamageDealt: Number(res.counterDamageDealt ?? res.resolvedClash?.counterDamageDealt ?? 0),
          resolutionSummary: res.summary || res.resolvedClash?.resolutionSummary || 'Reaction resolved.',
        };
        setResolutionReport({
          clash: mergedClash,
          summary: mergedClash.resolutionSummary || 'Reaction resolved.',
          dmgTaken: Number(mergedClash.dmgTaken ?? 0),
          counterDamageDealt: Number(mergedClash.counterDamageDealt ?? 0),
        });
      }
    } catch {
      window.clearInterval(tick);
      setPlayerRolling(false);
    }
  };

  const dmSuccess = activeClash.attackHit !== false;
  const playerSuccess = Boolean(activeClash.playerSuccess);
  const canSeeMonsterHp = isDm || Boolean(monster?.observedByViewer);

  const spellAcc = activeClash.spellAccuracyRoll;
  const spellDmg = activeClash.spellDamageRoll;
  const isSpellClash = activeClash.playerChoice === 'spell' && Boolean(spellAcc);

  const outcomeTitle = (() => {
    if (!playerSuccess) {
      if (activeClash.playerChoice === 'spell') return 'SPELL MISSED!';
      if (activeClash.playerChoice === 'dodge') return 'DODGE FAILED!';
      if (activeClash.playerChoice === 'block' || activeClash.reactionStyle === 'block') return 'PARTIAL BLOCK';
      return 'HIT TAKEN';
    }
    if (activeClash.playerChoice === 'dodge') return 'DODGED!';
    if (activeClash.playerChoice === 'spell') return 'SPELL HIT!';
    if (activeClash.playerChoice === 'block' || activeClash.reactionStyle === 'block') return 'BLOCKED!';
    if (activeClash.reactionStyle === 'counter' || activeClash.playerChoice === 'counter') return 'COUNTER-ATTACK!';
    return 'PARRIED!';
  })();

  const responseMod = Number(activeClash.playerRollMod ?? 0);
  const responseModText = responseMod >= 0 ? `+${responseMod}` : String(responseMod);

  return (
    <div id="combat-clash-modal" className="modal-backdrop open clash-modal-backdrop">
      <div
        className={`modal-card clash-modal-card ${
          isResolved ? (playerSuccess ? 'is-win' : 'is-loss') : 'is-pending'
        }`}
      >
        <div className="clash-modal-head">
          <div className="clash-modal-badges">
            <span className="tag tag-crimson">OPPOSED DICE CLASH</span>
            {activeClash.skillName && (
              <span className="tag tag-purple">{activeClash.skillName}</span>
            )}
            <span className={`tag ${isResolved ? 'tag-green' : 'tag-cyan'}`}>
              {isResolved ? 'RESOLVED' : 'YOUR REACTION'}
            </span>
          </div>
          <h2 className="clash-modal-title">
            {activeClash.monsterName} attacks {activeClash.targetCharacterName}!
          </h2>
        </div>

        {/* Two-Column Opposed Dice Stage */}
        <div className="clash-stage">
          {/* LEFT: Monster Attack */}
          <div className="clash-side-card is-monster">
            <div className="clash-side-label">MONSTER ATTACK</div>
            <div className="clash-side-sub">{activeClash.monsterName}</div>

            {(() => {
              const monDmgSides =
                activeClash.damageSides === 4 ||
                activeClash.damageSides === 6 ||
                activeClash.damageSides === 8 ||
                activeClash.damageSides === 10 ||
                activeClash.damageSides === 12 ||
                activeClash.damageSides === 20
                  ? activeClash.damageSides
                  : parseSides(activeClash.formula, 8);
              const atkNat = activeClash.attackNatural;
              const atkMod = activeClash.attackModifier;
              const atkEffDelta = Number(activeClash.attackEffectDelta ?? 0);
              const atkAuraPen = Number(activeClash.attackAuraPenalty ?? 0);
              const dmgRolls = activeClash.damageRolls;
              const dmgMod = Number(activeClash.damageModifier ?? 0);
              const dmgEffDelta = Number(activeClash.damageEffectDelta ?? 0);

              return (
                <>
                  <div className="clash-spell-dice-row">
                    <div className="clash-spell-die-col">
                      <span className="clash-spell-die-tag">Acc [1d20]</span>
                      <div className={`clash-die-box is-compact is-monster ${dmRolling ? 'rolling' : 'landed'}`}>
                        <div className="clash-die-bg">
                          <PolyhedralDieSvg sides={20} />
                        </div>
                        <span className="clash-die-num">
                          {dmRolling ? dmFlicker : activeClash.attackTotal}
                        </span>
                      </div>
                      {!dmRolling && (
                        <span className={`tag small ${dmSuccess ? 'tag-crimson' : 'tag-cyan'}`}>
                          {dmSuccess ? (activeClash.attackCrit ? 'CRIT HIT' : 'HIT') : 'GRAZE'} vs AC {activeClash.targetAc ?? '?'}
                        </span>
                      )}
                    </div>

                    <div className="clash-spell-die-col">
                      <span className="clash-spell-die-tag">Dmg [{activeClash.formula || '1d8'}]</span>
                      <div className={`clash-die-box is-compact is-dmg ${dmRolling ? 'rolling' : 'landed'}`}>
                        <div className="clash-die-bg">
                          <PolyhedralDieSvg sides={monDmgSides} />
                        </div>
                        <span className="clash-die-num">
                          {dmRolling ? dmDmgFlicker : activeClash.incomingDamage}
                        </span>
                      </div>
                      {!dmRolling && (
                        <span className="tag small tag-gold">
                          {activeClash.incomingDamage} DMG
                        </span>
                      )}
                    </div>
                  </div>

                  {!dmRolling && (
                    <div className="clash-calc-box">
                      <div className="clash-calc-line">
                        <b>Hit:</b>{' '}
                        {atkNat !== undefined && atkMod !== undefined ? (
                          <>
                            d20(<b>{atkNat}</b>) {fmtSigned(atkMod)}
                            {atkEffDelta !== 0 ? ` ${fmtSigned(atkEffDelta)} eff` : ''}
                            {atkAuraPen > 0 ? ` -${atkAuraPen} aura` : ''} = <b>{activeClash.attackTotal}</b> vs AC {activeClash.targetAc ?? '?'}
                          </>
                        ) : (
                          <>
                            <b>{activeClash.attackTotal}</b> vs AC {activeClash.targetAc ?? '?'}
                          </>
                        )}
                      </div>
                      <div className="clash-calc-line">
                        <b>Dmg:</b>{' '}
                        {dmgRolls && dmgRolls.length > 0 ? (
                          <>
                            {activeClash.formula} [{dmgRolls.join('+')}]
                            {dmgMod !== 0 ? ` ${fmtSigned(dmgMod)}` : ''}
                            {dmgEffDelta !== 0 ? ` ${fmtSigned(dmgEffDelta)} eff` : ''} = <b>{activeClash.incomingDamage}</b>
                          </>
                        ) : (
                          <>
                            {activeClash.formula || '1d8'} = <b>{activeClash.incomingDamage}</b>
                          </>
                        )}
                        {!isResolved && targetChar && Number(targetChar.dr || 0) > 0 && (
                          <span className="muted"> &bull; Your DR {targetChar.dr}</span>
                        )}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* RIGHT: Player Response */}
          <div
            className={`clash-side-card is-player ${
              isResolved ? (playerSuccess ? 'is-win' : 'is-loss') : ''
            }`}
          >
            <div className="clash-side-label">YOUR RESPONSE</div>
            <div className="clash-side-sub">
              {isResolved
                ? activeClash.spellName || String(activeClash.reactionStyle || activeClash.playerChoice || 'Reaction').toUpperCase()
                : activeClash.targetCharacterName}
            </div>

            {isSpellClash && spellAcc && isResolved ? (
              <div className="clash-spell-dice-row">
                <div className="clash-spell-die-col">
                  <span className="clash-spell-die-tag">Acc [1d20]</span>
                  <div
                    className={`clash-die-box is-compact ${
                      playerRolling ? 'rolling' : spellAcc.hit ? 'is-win' : 'is-loss'
                    }`}
                  >
                    <div className="clash-die-bg">
                      <PolyhedralDieSvg sides={20} />
                    </div>
                    <span className="clash-die-num">
                      {playerRolling ? playerFlicker : spellAcc.total}
                    </span>
                  </div>
                  {!playerRolling && (
                    <span className={`tag small ${spellAcc.hit ? 'tag-green' : 'tag-crimson'}`}>
                      {spellAcc.hit ? 'HIT' : 'MISS'}
                    </span>
                  )}
                </div>

                {spellAcc.hit && spellDmg && (
                  <div className="clash-spell-die-col">
                    <span className="clash-spell-die-tag">Dmg [{spellDmg.formula}]</span>
                    <div className={`clash-die-box is-compact is-dmg ${playerRolling ? 'rolling' : 'is-win'}`}>
                      <div className="clash-die-bg">
                        <PolyhedralDieSvg sides={8} />
                      </div>
                      <span className="clash-die-num">
                        {playerRolling ? spellDmgFlicker : activeClash.counterDamageDealt ?? spellDmg.total}
                      </span>
                    </div>
                    {!playerRolling && (
                      <span className="tag small tag-gold">
                        [{spellDmg.rolls.join('+')}]
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : !isSpellClash && isResolved && activeClash.counterDamageRoll ? (
              <div className="clash-spell-dice-row">
                <div className="clash-spell-die-col">
                  <span className="clash-spell-die-tag">Acc [1d20]</span>
                  <div
                    className={`clash-die-box is-compact ${
                      playerRolling ? 'rolling' : playerSuccess ? 'is-win' : 'is-loss'
                    }`}
                  >
                    <div className="clash-die-bg">
                      <PolyhedralDieSvg sides={20} />
                    </div>
                    <span className="clash-die-num">
                      {playerRolling ? playerFlicker : activeClash.playerRollTotal ?? '—'}
                    </span>
                  </div>
                  {!playerRolling && (
                    <span className={`tag small ${playerSuccess ? 'tag-green' : 'tag-gold'}`}>
                      d20: {activeClash.playerRollNatural ?? '?'} ({responseModText})
                    </span>
                  )}
                </div>

                <div className="clash-spell-die-col">
                  <span className="clash-spell-die-tag">Dmg [{activeClash.counterDamageRoll.formula}]</span>
                  <div className={`clash-die-box is-compact is-dmg ${playerRolling ? 'rolling' : 'is-win'}`}>
                    <div className="clash-die-bg">
                      <PolyhedralDieSvg sides={parseSides(activeClash.counterDamageRoll.formula, activeClash.counterDamageRoll.sides || 8)} />
                    </div>
                    <span className="clash-die-num">
                      {playerRolling ? spellDmgFlicker : activeClash.counterDamageDealt ?? activeClash.counterDamageRoll.total}
                    </span>
                  </div>
                  {!playerRolling && (
                    <span className="tag small tag-gold">
                      [{activeClash.counterDamageRoll.rolls.join('+')}]
                      {activeClash.counterDamageRoll.modifier !== 0 ? ` ${fmtSigned(activeClash.counterDamageRoll.modifier)}` : ''} &rarr; {activeClash.counterDamageDealt ?? activeClash.counterDamageRoll.total}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div
                  className={`clash-die-box is-player ${
                    playerRolling ? 'rolling' : isResolved ? (playerSuccess ? 'is-win' : 'is-loss') : ''
                  }`}
                >
                  <div className="clash-die-bg">
                    <PolyhedralDieSvg sides={20} />
                  </div>
                  <span className="clash-die-num">
                    {playerRolling
                      ? playerFlicker
                      : isResolved
                        ? activeClash.playerRollTotal ?? '—'
                        : '?'}
                  </span>
                </div>

                {!isResolved && !playerRolling && (
                  <div className="clash-side-meta">
                    <span className="small muted">Choose 1 of 3 reactions below</span>
                  </div>
                )}

                {isResolved && !playerRolling && (
                  <div className="clash-side-meta">
                    <span className={`tag ${playerSuccess ? 'tag-green' : 'tag-gold'}`}>
                      {playerSuccess ? 'SUCCESS' : 'FAILED'}
                    </span>
                    <div className="small muted">
                      d20: <b>{activeClash.playerRollNatural ?? '?'}</b> ({responseModText})
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Exactly 3 Player Options (or inline Reaction Spell Picker) when unresolved */}
        {!isResolved && (
          <div className="clash-actions-wrap">
            {!spellPickerOpen ? (
              <div className="clash-actions-3">
                <button
                  type="button"
                  id="btn-clash-react"
                  className="clash-action-btn is-react"
                  disabled={playerRolling}
                  onClick={() => void handlePlayerReactionRoll('react')}
                >
                  <div className="clash-action-top">
                    <strong className="clash-action-title">{styleInfo.label}</strong>
                    <span className="tag tag-cyan">{styleInfo.statTag}</span>
                  </div>
                  {styleInfo.style === 'counter' ? (
                    <div className="clash-btn-stats">
                      <div className="clash-btn-stat-line">
                        Expected Damage: <b>{expectedCounterDmg}</b>
                      </div>
                      {monster && (
                        <SegmentedBar
                          pct={
                            monster.hp !== null && monster.maxHp
                              ? Math.max(0, Math.min(100, (Math.max(0, monster.hp - expectedCounterDmg) / monster.maxHp) * 100))
                              : Math.max(0, Math.min(100, Number(monster.hpPct ?? 100)))
                          }
                          ghostPct={
                            monster.hp !== null && monster.maxHp
                              ? Math.max(0, Math.min(100, (monster.hp / monster.maxHp) * 100))
                              : undefined
                          }
                          ghostColor="rgba(251, 191, 36, 0.55)"
                          maxValue={monster.maxHp ?? 0}
                          ticks={monster.hpBarTicks}
                          kind="monster"
                          trackClassName="progress clash-btn-bar"
                          fillKind="monster"
                        />
                      )}
                      <div className="clash-btn-stat-line">
                        Bleed Chance: <b>{bleedChancePct}%</b>
                      </div>
                    </div>
                  ) : (
                    <div className="clash-btn-stats">
                      <div className="clash-btn-stat-line">
                        <b>0 Damage</b> on Win (&frac12; on Fail)
                      </div>
                      <div className="clash-btn-stat-line">
                        Stun Chance: <b>{stunChancePct}%</b>
                      </div>
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  id="btn-clash-spell"
                  className="clash-action-btn is-spell"
                  disabled={playerRolling || usableReactionSpells.length === 0}
                  onClick={() => setSpellPickerOpen(true)}
                >
                  <div className="clash-action-top">
                    <strong className="clash-action-title">Cast Spell</strong>
                    <span className="tag tag-purple">
                      {usableReactionSpells.length > 0 ? `${usableReactionSpells.length} Ready` : 'NONE'}
                    </span>
                  </div>
                  {usableReactionSpells.length > 0 ? (
                    <>
                      {renderSpellPreviewBar(usableReactionSpells[0])}
                      <span className="clash-action-perk is-spell">
                        {usableReactionSpells.length > 1
                          ? `${usableReactionSpells[0].name} +${usableReactionSpells.length - 1} more`
                          : 'INT Roll • Halves Hit'}
                      </span>
                    </>
                  ) : (
                    <span className="clash-action-sub">
                      {reactionSpells.length > 0
                        ? 'Low MP or target out of spell range.'
                        : 'No reaction-speed spell in your grimoire.'}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  id="btn-clash-dodge"
                  className="clash-action-btn is-dodge"
                  disabled={playerRolling}
                  onClick={() => void handlePlayerReactionRoll(defenseInfo.choice)}
                >
                  <div className="clash-action-top">
                    <strong className="clash-action-title">{defenseInfo.label}</strong>
                    <span className="tag tag-gold">{defenseInfo.statTag}</span>
                  </div>
                  {defenseInfo.choice === 'dodge' ? (
                    <div className="clash-btn-stats">
                      <div className="clash-btn-stat-line">
                        <b>0 Damage</b> on Win
                      </div>
                      <div className="clash-btn-stat-line">
                        <b>Full Damage</b> on Fail{' '}
                        <span className="clash-btn-dmg-delta">(-{expectedFailDmg} HP)</span>
                      </div>
                      {targetChar && targetChar.maxHp > 0 && (() => {
                        const plAfterHp = Math.max(0, targetChar.hp - expectedFailDmg);
                        const plAfterPct = Math.max(0, Math.min(100, (plAfterHp / targetChar.maxHp) * 100));
                        const plCurPct = Math.max(0, Math.min(100, (targetChar.hp / targetChar.maxHp) * 100));
                        return (
                          <>
                            <SegmentedBar
                              pct={plAfterPct}
                              ghostPct={plCurPct}
                              ghostColor="rgba(248, 113, 113, 0.55)"
                              maxValue={targetChar.maxHp}
                              kind="hp"
                              trackClassName="progress clash-btn-bar"
                              fillKind="hp"
                              critical={plAfterPct > 0 && plAfterPct <= 20}
                            />
                            <div className="clash-btn-hp-note">
                              {targetChar.hp} &rarr; {plAfterHp}/{targetChar.maxHp} HP
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="clash-btn-stats">
                      <div className="clash-btn-stat-line">
                        Mitigate <b>{defenseInfo.mitigationPct}%</b> on Win{' '}
                        <span className="clash-btn-dmg-delta">(-{expectedBlockWinDmg} HP)</span>
                      </div>
                      {targetChar && targetChar.maxHp > 0 && (() => {
                        const plAfterHp = Math.max(0, targetChar.hp - expectedBlockWinDmg);
                        const plAfterPct = Math.max(0, Math.min(100, (plAfterHp / targetChar.maxHp) * 100));
                        const plCurPct = Math.max(0, Math.min(100, (targetChar.hp / targetChar.maxHp) * 100));
                        return (
                          <>
                            <SegmentedBar
                              pct={plAfterPct}
                              ghostPct={plCurPct}
                              ghostColor="rgba(248, 113, 113, 0.55)"
                              maxValue={targetChar.maxHp}
                              kind="hp"
                              trackClassName="progress clash-btn-bar"
                              fillKind="hp"
                              critical={plAfterPct > 0 && plAfterPct <= 20}
                            />
                            <div className="clash-btn-hp-note">
                              {targetChar.hp} &rarr; {plAfterHp}/{targetChar.maxHp} HP
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </button>
              </div>
            ) : (
              <div className="clash-spell-list-panel">
                <div className="clash-spell-list-head">
                  <strong className="small" style={{ color: '#e9d5ff' }}>
                    SELECT REACTION SPELL
                  </strong>
                  <button
                    type="button"
                    className="btn btn-xs btn-outline"
                    disabled={playerRolling}
                    onClick={() => setSpellPickerOpen(false)}
                  >
                    &larr; Back
                  </button>
                </div>
                <div className="clash-spell-list">
                  {usableReactionSpells.map((rawSp) => {
                    const sp = scaleSpellForLevel(rawSp, targetChar?.level || 1);
                    return (
                    <button
                      key={sp.id}
                      type="button"
                      className="clash-spell-choice-btn"
                      disabled={playerRolling}
                      onClick={() => {
                        setSpellPickerOpen(false);
                        void handlePlayerReactionRoll('spell', sp.id);
                      }}
                    >
                      <div className="clash-action-top">
                        <strong>{sp.name}</strong>
                        <span className="tag tag-purple">{sp.mpCost} MP</span>
                      </div>
                      <span className="clash-action-sub">
                        {sp.healFormula ? `Heal ${sp.healFormula}` : (sp.damageDice && sp.damageDice !== '0' ? sp.damageDice : 'Support')} &bull; {sp.rangeSpaces || 3} Sp &bull; INT Accuracy
                      </span>
                      {renderSpellPreviewBar(sp)}
                    </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Clear Resolution Summary Banner */}
        {isResolved && !playerRolling && (
          <div className={`clash-result-banner ${playerSuccess ? 'is-win' : 'is-loss'}`}>
            <div className="clash-result-top">
              <strong className="clash-result-title">{outcomeTitle}</strong>
              <div className="btn-row" style={{ gap: '6px', flexWrap: 'wrap' }}>
                <span className="tag tag-crimson">Taken: {activeClash.dmgTaken ?? 0} HP</span>
                {(activeClash.counterDamageDealt || 0) > 0 && (
                  <span className="tag tag-gold">Dealt: {activeClash.counterDamageDealt} HP</span>
                )}
                {activeClash.mitigationPct !== undefined && activeClash.mitigationPct > 0 && (
                  <span className="tag tag-cyan">-{activeClash.mitigationPct}% Mitigated</span>
                )}
                {activeClash.stunnedEnemy && (
                  <span className="tag tag-purple">STUNNED!</span>
                )}
                {activeClash.bleedApplied && (
                  <span className="tag tag-crimson">BLEED APPLIED!</span>
                )}
              </div>
            </div>

            <div className="clash-result-summary">{activeClash.resolutionSummary}</div>

            <div className="clash-hp-bars">
              {targetChar && (
                <div className="clash-hp-item">
                  <div className="clash-hp-top small">
                    <span style={{ fontWeight: 700, color: '#7dd3fc' }}>{targetChar.name}</span>
                    <b style={{ color: '#f8fafc' }}>
                      {targetChar.hp}/{targetChar.maxHp} HP
                    </b>
                  </div>
                  <SegmentedBar
                    pct={
                      targetChar.maxHp > 0
                        ? Math.max(0, Math.min(100, (targetChar.hp / targetChar.maxHp) * 100))
                        : 0
                    }
                    maxValue={targetChar.maxHp}
                    kind="hp"
                    trackClassName="progress"
                    fillKind="hp"
                    critical={
                      targetChar.maxHp > 0 &&
                      targetChar.hp > 0 &&
                      (targetChar.hp / targetChar.maxHp) * 100 <= 20
                    }
                  />
                </div>
              )}

              {monster && (
                <div className="clash-hp-item">
                  <div className="clash-hp-top small">
                    <span style={{ fontWeight: 700, color: '#fca5a5' }}>{monster.name}</span>
                    {canSeeMonsterHp && monster.hp !== null && monster.maxHp ? (
                      <b style={{ color: '#f87171' }}>
                        {monster.hp}/{monster.maxHp} HP
                      </b>
                    ) : null}
                  </div>
                  <SegmentedBar
                    pct={
                      monster.hp !== null && monster.maxHp
                        ? Math.max(0, Math.min(100, (monster.hp / monster.maxHp) * 100))
                        : Math.max(0, Math.min(100, Number(monster.hpPct ?? 100)))
                    }
                    maxValue={monster.maxHp ?? 0}
                    ticks={monster.hpBarTicks}
                    kind="monster"
                    trackClassName="progress"
                    fillKind="monster"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Continue button only shown once resolved */}
        {isResolved && !playerRolling && (
          <div className="clash-modal-footer">
            <button
              type="button"
              id="btn-close-combat-resolution"
              className="btn btn-sm btn-cyan"
              onClick={handleContinue}
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
