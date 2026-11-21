import { useEffect, useState } from 'react';
import { useVtt } from '../../context/VttContext';

interface AttackRollInfo {
  natural: number;
  total: number;
  targetAc: number;
  hit: boolean;
  crit: boolean;
  fumble: boolean;
  breakdown: string;
}

interface DamageRes {
  ok?: boolean;
  miss?: boolean;
  hit?: boolean;
  finalDamage?: number;
  friendlyFire?: boolean;
  targetsHit?: string[];
  attackRoll?: AttackRollInfo | null;
  ally?: { name: string; hp: number; maxHp: number };
  monster?: { hp: number | null; maxHp: number | null; healthTier?: string };
  logEntry?: { rollDetails?: { breakdown?: string } };
}

export function AttackRollModal() {
  const { attackRollRequest, sendAction } = useVtt();
  const [rolling, setRolling] = useState(true);
  const [cubeText, setCubeText] = useState('?');
  const [landed, setLanded] = useState(false);
  const [resultInfo, setResultInfo] = useState<{
    tierClass?: string;
    title: string;
    detail: string;
  } | null>(null);

  useEffect(() => {
    if (!attackRollRequest) return;
    let cancelled = false;
    setRolling(true);
    setLanded(false);
    setResultInfo(null);
    setCubeText(String(Math.floor(Math.random() * 12) + 1));

    const tick = window.setInterval(() => {
      setCubeText(String(Math.floor(Math.random() * 18) + 1));
    }, 85);

    const timer = window.setTimeout(async () => {
      try {
        const res = await sendAction<DamageRes>(
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

        if (res?.miss) {
          setLanded(false);
          setCubeText(String(res.attackRoll?.natural ?? 'MISS'));
          setResultInfo({
            tierClass: 'tier-normal',
            title: res.attackRoll?.fumble ? 'FAILED — Critical Miss (Natural 1)!' : 'FAILED — Attack Missed!',
            detail: res.attackRoll?.breakdown || 'Your attack failed to beat monster AC.',
          });
          return;
        }

        setLanded(true);
        setCubeText(String(res?.finalDamage ?? 0));

        if (res?.friendlyFire && res.ally) {
          setResultInfo({
            tierClass: 'tier-rare',
            title: 'FAILED — FRIENDLY FIRE!',
            detail: `Your shot struck ally ${res.ally.name} for ${res.finalDamage} damage! (HP: ${res.ally.hp}/${res.ally.maxHp})`,
          });
        } else {
          const monHpText = res?.monster
            ? res.monster.hp !== null
              ? ` • ${attackRollRequest.monTok.name}: ${res.monster.hp}/${res.monster.maxHp} HP`
              : res.monster.healthTier
                ? ` • ${attackRollRequest.monTok.name}: ${res.monster.healthTier}`
                : ''
            : '';
          const formula = attackRollRequest.diceFormulaOverride || attackRollRequest.wep?.damageDice || '1d6';
          const atkPrefix = res?.attackRoll?.breakdown ? `${res.attackRoll.breakdown} • ` : '';
          const aoeText = res?.targetsHit && res.targetsHit.length > 1
            ? ` • AoE hit ${res.targetsHit.length} monsters!`
            : '';
          setResultInfo({
            tierClass: res?.attackRoll?.crit ? 'tier-legendary' : undefined,
            title: `${res?.attackRoll?.crit ? 'CRITICAL SUCCESS! ' : 'SUCCESS — '}Dealt ${res?.finalDamage ?? 0} Damage!`,
            detail: `${atkPrefix}${res?.logEntry?.rollDetails?.breakdown || formula}${monHpText}${aoeText}`,
          });
        }
      } catch (err) {
        if (cancelled) return;
        window.clearInterval(tick);
        setRolling(false);
        setLanded(false);
        setCubeText('!');
        setResultInfo({
          title: 'Attack Failed',
          detail: err instanceof Error ? err.message : 'Out of range or unable to attack.',
        });
      }
    }, 1100);

    return () => {
      cancelled = true;
      window.clearInterval(tick);
      window.clearTimeout(timer);
    };
  }, [attackRollRequest, sendAction]);

  if (!attackRollRequest) return null;

  const { monTok, me, wep, onComplete } = attackRollRequest;
  const formula = wep?.damageDice || '1d6';
  const wepName = wep?.name || 'Unarmed Strike';
  const hasWeakSpot = Boolean(me?.observedWeakSpots?.[monTok.id]);

  return (
    <div id="p-attack-roll-modal" className="modal-backdrop">
      <div className="modal-card card-glow-crimson">
        <div className="panel-header">
          <h3 id="p-attack-modal-title">Attacking {monTok.name}</h3>
          <button
            type="button"
            id="btn-close-attack-modal"
            className="btn btn-xs btn-outline"
            disabled={rolling}
            onClick={() => onComplete(null)}
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

        <div className="attack-die-stage mt-sm">
          <div
            id="p-attack-die-cube"
            className={`attack-die-cube ${rolling ? 'rolling' : ''} ${landed ? 'landed' : ''}`}
          >
            {cubeText}
          </div>
        </div>

        {resultInfo && (
          <div id="p-attack-roll-result" className={`gacha-result-banner mt-sm ${resultInfo.tierClass || ''}`}>
            <strong>{resultInfo.title}</strong>
            <div className="small muted">{resultInfo.detail}</div>
          </div>
        )}

        <div className="btn-row mt-sm" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            id="btn-attack-roll-done"
            className="btn btn-sm btn-crimson"
            disabled={rolling}
            onClick={() => onComplete(null)}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
