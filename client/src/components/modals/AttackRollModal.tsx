import { useEffect, useRef, useState } from 'react';
import { scaleSpellForLevel, type MonsterDefeatSummary } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { SegmentedBar } from '../common/SegmentedBar';

interface AttackRollInfo {
  natural: number;
  total: number;
  targetAc: number;
  hit: boolean;
  crit: boolean;
  fumble: boolean;
  breakdown: string;
}

interface DamageRollInfo {
  formula: string;
  rolls: number[];
  diceTotal: number;
  modifier: number;
  rawTotal: number;
  statMod: number;
  levelBonus: number;
  passiveBonus: number;
  weakSpotBonus: number;
  targetDr: number | null;
  critMult: number;
}

interface DamageRes {
  ok?: boolean;
  miss?: boolean;
  hit?: boolean;
  summary?: string;
  finalDamage?: number;
  friendlyFire?: boolean;
  targetsHit?: string[];
  attackRoll?: AttackRollInfo | null;
  damageRoll?: DamageRollInfo | null;
  ally?: { name: string; hp: number; maxHp: number };
  monster?: { hp: number | null; maxHp: number | null; healthTier?: string; observedByViewer?: boolean };
  defeatSummary?: MonsterDefeatSummary | null;
  logEntry?: { summary?: string; rollDetails?: { breakdown?: string } };
}

interface ResultPill {
  label: string;
  tone: 'crimson' | 'gold' | 'cyan' | 'green' | 'purple';
}

interface TrioBreakdown {
  accSub: string;
  dmgSub: string;
  finalSub: string;
}

function buildDamageSubText(dmg: DamageRollInfo | null | undefined): string {
  if (!dmg) return 'Weapon / Skill';
  const diceStr = dmg.rolls.length > 0 ? `[${dmg.rolls.join('+')}]` : String(dmg.diceTotal);
  if (dmg.modifier > 0) return `Dice ${diceStr} + ${dmg.modifier}`;
  if (dmg.modifier < 0) return `Dice ${diceStr} - ${Math.abs(dmg.modifier)}`;
  return `Dice ${diceStr}`;
}

function buildFinalSubText(dmg: DamageRollInfo | null | undefined): string {
  if (!dmg) return 'Total dealt';
  const parts: string[] = [];
  if (dmg.critMult > 1) parts.push(`×${dmg.critMult} Crit`);
  if (dmg.statMod !== 0) parts.push(`Stat ${dmg.statMod > 0 ? `+${dmg.statMod}` : dmg.statMod}`);
  if (dmg.levelBonus > 0) parts.push(`Lv +${dmg.levelBonus}`);
  if (dmg.passiveBonus !== 0) parts.push(`Bonus ${dmg.passiveBonus > 0 ? `+${dmg.passiveBonus}` : dmg.passiveBonus}`);
  if (dmg.weakSpotBonus > 0) parts.push(`Weak +${dmg.weakSpotBonus}`);
  if (dmg.targetDr !== null && dmg.targetDr > 0) parts.push(`-${dmg.targetDr} DR`);
  return parts.length > 0 ? parts.join(' • ') : 'Direct hit';
}

export function AttackRollModal() {
  const { attackRollRequest, sendAction, session, setDefeatedMonster } = useVtt();
  const [rolling, setRolling] = useState(true);
  const [accCubeText, setAccCubeText] = useState('?');
  const [dmgCubeText, setDmgCubeText] = useState('?');
  const [finalCubeText, setFinalCubeText] = useState('?');
  const [landed, setLanded] = useState(false);
  const [missed, setMissed] = useState(false);
  const [isCritHit, setIsCritHit] = useState(false);
  const [trioSub, setTrioSub] = useState<TrioBreakdown>({
    accSub: 'Rolling 1d20...',
    dmgSub: 'Rolling...',
    finalSub: 'Calculating...',
  });
  const [pendingDefeat, setPendingDefeat] = useState<MonsterDefeatSummary | null>(null);
  const [resultInfo, setResultInfo] = useState<{
    tierClass?: string;
    title: string;
    pills: ResultPill[];
    monsterBar?: {
      name: string;
      beforeHp: number | null;
      afterHp: number | null;
      maxHp: number | null;
      label: string;
    };
    note?: string;
  } | null>(null);

  const sendActionRef = useRef(sendAction);
  sendActionRef.current = sendAction;

  useEffect(() => {
    if (!attackRollRequest) return;
    let cancelled = false;
    setRolling(true);
    setLanded(false);
    setMissed(false);
    setIsCritHit(false);
    setResultInfo(null);
    setPendingDefeat(null);
    setAccCubeText(String(Math.floor(Math.random() * 20) + 1));
    setDmgCubeText(String(Math.floor(Math.random() * 8) + 1));
    setFinalCubeText('?');
    setTrioSub({
      accSub: 'Rolling 1d20...',
      dmgSub: 'Rolling...',
      finalSub: 'Calculating...',
    });

    const tick = window.setInterval(() => {
      setAccCubeText(String(Math.floor(Math.random() * 20) + 1));
      setDmgCubeText(String(Math.floor(Math.random() * 12) + 1));
    }, 85);

    const beforeMonHp = attackRollRequest.monTok.hp ?? null;
    const beforeMonMaxHp = attackRollRequest.monTok.maxHp ?? null;

    const timer = window.setTimeout(async () => {
      try {
        const sp = attackRollRequest.spell
          ? scaleSpellForLevel(attackRollRequest.spell, attackRollRequest.me.level)
          : undefined;
        const res = sp
          ? await sendActionRef.current<DamageRes>(
              'spell_action',
              {
                characterId: attackRollRequest.me.id,
                subAction: 'cast',
                spellId: sp.id,
                beatId: attackRollRequest.beatId,
                attackArea: attackRollRequest.attackArea ?? sp.attackArea ?? 'single',
                attackAreaModifier: attackRollRequest.attackAreaModifier ?? sp.attackAreaModifier ?? 0,
                ...(attackRollRequest.isSelfSpell ? {} : { targetMonsterId: attackRollRequest.monTok.id }),
                ...(sp.healFormula ? { healFormula: sp.healFormula } : {}),
                ...(sp.effectSpec ? { effectSpec: sp.effectSpec } : {}),
              },
              { throwOnError: true },
            )
          : await sendActionRef.current<DamageRes>(
              'inflict_damage',
              {
                monsterId: attackRollRequest.monTok.id,
                attackerId: attackRollRequest.me.id,
                beatId: attackRollRequest.beatId,
                diceFormula: attackRollRequest.diceFormulaOverride || attackRollRequest.wep?.damageDice || '1d6',
                damageType: attackRollRequest.damageTypeOverride || attackRollRequest.wep?.damageType || 'Physical',
                includeStatMod: true,
                attackRoll: true,
                ...(attackRollRequest.attackArea ? { attackArea: attackRollRequest.attackArea } : {}),
                ...(attackRollRequest.attackAreaModifier !== undefined
                  ? { attackAreaModifier: attackRollRequest.attackAreaModifier }
                  : {}),
                ...(attackRollRequest.isSkill ? { isSkill: true } : {}),
                ...(attackRollRequest.healFormula ? { healFormula: attackRollRequest.healFormula } : {}),
                ...(attackRollRequest.effectSpec ? { effectSpec: attackRollRequest.effectSpec } : {}),
              },
              { throwOnError: true },
            );
        if (cancelled) return;
        window.clearInterval(tick);
        setRolling(false);

        if (sp && attackRollRequest.isSelfSpell) {
          setLanded(true);
          setAccCubeText('✓');
          const pills: ResultPill[] = [{ label: `${sp.mpCost} MP`, tone: 'cyan' }];
          if (sp.healFormula) pills.push({ label: `Heal ${sp.healFormula}`, tone: 'green' });
          if (sp.effectSpec) pills.push({ label: sp.effectSpec.kind.replace(/_/g, ' '), tone: 'purple' });
          setResultInfo({
            tierClass: 'tier-rare',
            title: `${sp.name} Cast!`,
            pills,
            note: res?.summary || res?.logEntry?.summary || 'Spell effect applied.',
          });
          return;
        }

        const atk = res?.attackRoll;
        const accMod = atk ? atk.total - atk.natural : 0;
        const accBonusLabel = accMod >= 0 ? `+ ${accMod}` : `- ${Math.abs(accMod)}`;
        const accSubText = atk
          ? `Total ${atk.total} (${atk.natural} ${accBonusLabel})${atk.crit ? ' • CRIT!' : ''}`
          : 'Auto-hit';

        if (res?.miss) {
          setLanded(false);
          setMissed(true);
          setAccCubeText(String(atk?.natural ?? 'MISS'));
          setDmgCubeText('—');
          setFinalCubeText('0');
          setTrioSub({
            accSub: atk ? `Total ${atk.total} (${atk.natural} ${accBonusLabel}) • MISS` : 'Missed',
            dmgSub: 'No damage',
            finalSub: atk?.fumble ? 'Natural 1!' : 'Strike missed',
          });
          const pills: ResultPill[] = [];
          if (atk) {
            pills.push({ label: `Roll ${atk.total} (d20: ${atk.natural})`, tone: 'cyan' });
          }
          setResultInfo({
            tierClass: 'tier-normal',
            title: atk?.fumble ? 'CRITICAL MISS!' : 'MISSED!',
            pills,
            note: 'Your strike failed to connect.',
          });
          return;
        }

        setLanded(true);
        setMissed(false);
        setIsCritHit(Boolean(atk?.crit));
        setAccCubeText(String(atk?.natural ?? '✓'));
        setDmgCubeText(String(res?.damageRoll?.rawTotal ?? res?.finalDamage ?? 0));
        setFinalCubeText(String(res?.finalDamage ?? 0));
        setTrioSub({
          accSub: accSubText,
          dmgSub: buildDamageSubText(res?.damageRoll),
          finalSub: buildFinalSubText(res?.damageRoll),
        });

        if (res?.friendlyFire && res.ally) {
          setResultInfo({
            tierClass: 'tier-rare',
            title: 'FRIENDLY FIRE!',
            pills: [{ label: `${res.finalDamage ?? 0} Damage`, tone: 'crimson' }],
            note: `Struck ally ${res.ally.name} (HP: ${res.ally.hp}/${res.ally.maxHp}).`,
          });
        } else {
          const dmgType = attackRollRequest.damageTypeOverride || attackRollRequest.wep?.damageType || 'Physical';
          const showExact = session?.role === 'dm' || Boolean(res?.monster?.observedByViewer);
          const pills: ResultPill[] = [];
          if (atk) {
            pills.push({ label: `Roll ${atk.total} (d20: ${atk.natural})`, tone: 'cyan' });
          }
          pills.push({ label: `${res?.finalDamage ?? 0} ${dmgType}`, tone: 'crimson' });
          if (res?.targetsHit && res.targetsHit.length > 1) {
            pills.push({ label: `AoE: ${res.targetsHit.length} Targets`, tone: 'purple' });
          }
          let monsterBar: {
            name: string;
            beforeHp: number | null;
            afterHp: number | null;
            maxHp: number | null;
            label: string;
          } | undefined;
          if (res?.monster) {
            const m = res.monster;
            const maxHp = m.maxHp ?? beforeMonMaxHp;
            const statusText =
              showExact && m.hp !== null
                ? `${m.hp}/${maxHp} HP`
                : m.healthTier && m.healthTier !== 'Unknown'
                  ? m.healthTier
                  : 'Hit';
            const barLabel =
              showExact && m.hp !== null && maxHp
                ? beforeMonHp !== null && beforeMonHp !== m.hp
                  ? `${beforeMonHp} → ${m.hp}/${maxHp} HP`
                  : `${m.hp}/${maxHp} HP`
                : statusText;
            monsterBar = {
              name: attackRollRequest.monTok.name,
              beforeHp: beforeMonHp,
              afterHp: m.hp,
              maxHp,
              label: barLabel,
            };
          }
          if (res?.defeatSummary) {
            attackRollRequest.onComplete(null);
            setDefeatedMonster(res.defeatSummary);
            return;
          }
          setResultInfo({
            tierClass: atk?.crit ? 'tier-legendary' : undefined,
            title: `${atk?.crit ? 'CRITICAL HIT! ' : 'HIT! '}Dealt ${res?.finalDamage ?? 0} Damage`,
            pills,
            monsterBar,
          });
        }
      } catch (err) {
        if (cancelled) return;
        window.clearInterval(tick);
        setRolling(false);
        setLanded(false);
        setAccCubeText('!');
        setDmgCubeText('!');
        setFinalCubeText('!');
        setResultInfo({
          title: 'Attack Failed',
          pills: [],
          note: err instanceof Error ? err.message : 'Out of range or unable to attack.',
        });
      }
    }, 950);

    return () => {
      cancelled = true;
      window.clearInterval(tick);
      window.clearTimeout(timer);
    };
  }, [attackRollRequest]);

  if (!attackRollRequest) return null;

  const { monTok, me, wep, skillName, spell: rawSpell, isSelfSpell, onComplete } = attackRollRequest;
  const spell = rawSpell ? scaleSpellForLevel(rawSpell, me?.level || 1) : undefined;
  const formula = spell ? (spell.damageDice && spell.damageDice !== '0' ? spell.damageDice : 'Support') : (attackRollRequest.diceFormulaOverride || wep?.damageDice || '1d6');
  const dmgType = attackRollRequest.damageTypeOverride || wep?.damageType || 'Physical';
  const wepName = spell
    ? `${spell.element || spell.damageType || 'Arcane'} • ${spell.mpCost} MP`
    : skillName
      ? `${skillName} (${wep?.name || 'Strike'})`
      : (wep?.name || 'Unarmed Strike');
  const hasWeakSpot = Boolean(!isSelfSpell && me?.observedWeakSpots?.[monTok.id]);

  const handleClose = () => {
    const defeat = pendingDefeat;
    setPendingDefeat(null);
    onComplete(null);
    if (defeat) {
      setDefeatedMonster(defeat);
    }
  };

  return (
    <div id="p-attack-roll-modal" className="modal-backdrop">
      <div className="modal-card card-glow-crimson" style={{ maxWidth: '540px', width: 'calc(100% - 24px)' }}>
        <div className="panel-header">
          <h3 id="p-attack-modal-title">
            {spell ? (isSelfSpell ? `Casting ${spell.name}` : `Casting ${spell.name} → ${monTok.name}`) : `Attacking ${monTok.name}`}
          </h3>
          <button
            type="button"
            id="btn-close-attack-modal"
            className="btn btn-xs btn-outline"
            disabled={rolling}
            onClick={handleClose}
          >
            &times;
          </button>
        </div>

        <div id="p-attack-modal-meta" className="small muted mt-xs">
          {wepName} • <code>{formula}</code>
          {hasWeakSpot && (
            <>
              {' '}
              <span className="tag tag-gold">WEAK SPOT</span>
            </>
          )}
        </div>

        {isSelfSpell ? (
          <div className="attack-die-stage mt-sm">
            <div
              id="p-attack-die-cube"
              className={`attack-die-cube ${rolling ? 'rolling' : ''} ${landed ? 'landed' : ''}`}
            >
              {accCubeText}
            </div>
          </div>
        ) : (
          <div className="attack-roll-trio mt-sm">
            <div className="attack-roll-col">
              <div className="attack-roll-col-head">
                <span className="attack-roll-col-label">Accuracy Roll</span>
                <span className="attack-roll-col-tag">[1d20]</span>
              </div>
              <div
                id="p-attack-die-cube"
                className={`attack-die-cube is-compact is-acc ${rolling ? 'rolling' : ''} ${landed ? 'landed' : ''} ${missed ? 'is-miss' : ''}`}
              >
                {accCubeText}
              </div>
              <div className="attack-roll-col-sub">{trioSub.accSub}</div>
            </div>

            <div className="attack-roll-col">
              <div className="attack-roll-col-head">
                <span className="attack-roll-col-label">Damage Roll</span>
                <span className="attack-roll-col-tag">[{formula}]</span>
              </div>
              <div
                className={`attack-die-cube is-compact is-dmg ${rolling ? 'rolling' : ''} ${landed ? 'landed' : ''} ${missed ? 'is-miss' : ''}`}
              >
                {dmgCubeText}
              </div>
              <div className="attack-roll-col-sub">{trioSub.dmgSub}</div>
            </div>

            <div className="attack-roll-col">
              <div className="attack-roll-col-head">
                <span className="attack-roll-col-label">Final Damage</span>
                <span className="attack-roll-col-tag">[{dmgType}]</span>
              </div>
              <div
                className={`attack-die-cube is-compact is-final ${landed ? 'landed' : ''} ${isCritHit ? 'is-crit' : ''} ${missed ? 'is-miss' : ''}`}
              >
                {finalCubeText}
              </div>
              <div className="attack-roll-col-sub">{trioSub.finalSub}</div>
            </div>
          </div>
        )}

        {resultInfo && (
          <div id="p-attack-roll-result" className={`gacha-result-banner mt-sm ${resultInfo.tierClass || ''}`}>
            <strong style={{ fontSize: '1.05rem' }}>{resultInfo.title}</strong>
            {resultInfo.pills.length > 0 && (
              <div className="btn-row mt-xs" style={{ justifyContent: 'center', flexWrap: 'wrap', gap: '6px' }}>
                {resultInfo.pills.map((p, idx) => (
                  <span key={`${p.label}-${idx}`} className={`tag tag-${p.tone}`}>
                    {p.label}
                  </span>
                ))}
              </div>
            )}
            {resultInfo.monsterBar && (
              <div className="mt-xs" style={{ textAlign: 'left' }}>
                <div className="bar-row small" style={{ marginBottom: '4px' }}>
                  <span style={{ fontWeight: 700, color: '#fca5a5' }}>{resultInfo.monsterBar.name}</span>
                  <span style={{ fontWeight: 700, color: '#f8fafc' }}>{resultInfo.monsterBar.label}</span>
                </div>
                {resultInfo.monsterBar.maxHp && resultInfo.monsterBar.afterHp !== null ? (
                  <SegmentedBar
                    pct={Math.max(0, Math.min(100, (resultInfo.monsterBar.afterHp / resultInfo.monsterBar.maxHp) * 100))}
                    ghostPct={
                      resultInfo.monsterBar.beforeHp !== null &&
                      resultInfo.monsterBar.beforeHp > resultInfo.monsterBar.afterHp
                        ? Math.max(0, Math.min(100, (resultInfo.monsterBar.beforeHp / resultInfo.monsterBar.maxHp) * 100))
                        : undefined
                    }
                    maxValue={resultInfo.monsterBar.maxHp}
                    kind="monster"
                    fillKind="monster"
                  />
                ) : null}
              </div>
            )}
            {resultInfo.note && (
              <div className="small muted" style={{ marginTop: '4px' }}>{resultInfo.note}</div>
            )}
          </div>
        )}

        <div className="btn-row mt-sm" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            id="btn-attack-roll-done"
            className="btn btn-sm btn-crimson"
            disabled={rolling}
            onClick={handleClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
