import { useEffect, useState } from 'react';
import { computePassiveModifiers, formatUnitEffectSpec, resolveConsumableEffects } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { InventoryItemSvg } from '../common/EquipmentIcons';

interface ConfirmedSnapshot {
  beforeHp: number;
  afterHp: number;
  maxHp: number;
  beforeMp: number;
  afterMp: number;
  maxMp: number;
  beforeXp: number;
  afterXp: number;
  xpTarget: number;
  actualHpGain: number;
  actualMpGain: number;
  actualXpGain: number;
  leveledUp: boolean;
  remainingQty: number;
}

export function ConsumableConfirmModal() {
  const { session, state, pendingConsumableUse, setPendingConsumableUse, sendAction } = useVtt();
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedSnapshot | null>(null);

  useEffect(() => {
    setConfirmed(null);
    setSubmitting(false);
  }, [pendingConsumableUse?.item.id]);

  useEffect(() => {
    if (!pendingConsumableUse) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        setConfirmed(null);
        setPendingConsumableUse(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingConsumableUse, setPendingConsumableUse, submitting]);

  if (!state || !pendingConsumableUse) return null;

  const { characterId, item } = pendingConsumableUse;
  const ch = state.characters?.[characterId];
  if (!ch) return null;

  const pMods = computePassiveModifiers(ch);
  const resolved = resolveConsumableEffects(item);
  const baseHp = resolved.healHp;
  const baseMp = resolved.healMp;
  const xpGain = resolved.grantXp;
  const hpGain = baseHp > 0 ? baseHp + pMods.consumableBonusHp + pMods.healingReceivedBonus : 0;
  const mpGain = baseMp > 0 ? baseMp + pMods.consumableBonusMp : 0;

  const beforeHp = confirmed ? confirmed.beforeHp : ch.hp;
  const maxHp = confirmed ? confirmed.maxHp : ch.maxHp;
  const afterHp = confirmed ? confirmed.afterHp : Math.min(ch.maxHp, ch.hp + hpGain);
  const actualHpGain = confirmed ? confirmed.actualHpGain : Math.max(0, afterHp - beforeHp);

  const beforeMp = confirmed ? confirmed.beforeMp : ch.mp;
  const maxMp = confirmed ? confirmed.maxMp : ch.maxMp;
  const afterMp = confirmed ? confirmed.afterMp : Math.min(ch.maxMp, ch.mp + mpGain);
  const actualMpGain = confirmed ? confirmed.actualMpGain : Math.max(0, afterMp - beforeMp);

  const xpTarget = confirmed ? confirmed.xpTarget : Math.max(1, Number(ch.xpToNext || (ch.level || 1) * 100));
  const beforeXp = confirmed ? confirmed.beforeXp : Number(ch.xp || 0);
  const afterXp = confirmed ? confirmed.afterXp : beforeXp + xpGain;
  const actualXpGain = confirmed ? confirmed.actualXpGain : xpGain;
  const leveledUp = confirmed ? confirmed.leveledUp : xpGain > 0 && beforeXp + xpGain >= xpTarget;

  const curQty = Number(item.qty || 1);
  const afterQty = confirmed ? confirmed.remainingQty : Math.max(0, curQty - 1);

  const activeCombatBeat = (state.storyBeats || []).find(
    (b) =>
      b.beatType !== 'narration' &&
      b.status !== 'resolved' &&
      b.status !== 'failed' &&
      (b.arena?.tokens || []).some((t) => t.id === characterId) &&
      (b.arena?.tokens || []).some((t) => {
        if (t.type !== 'monster') return false;
        const mon = state.monsters.find((m) => m.id === t.id);
        return mon ? (mon.hp === null || mon.hp > 0) && mon.healthTier !== 'Defeated' : true;
      }),
  );
  const playerTok = activeCombatBeat?.arena?.tokens?.find((t) => t.id === characterId);
  const lockedByTurn = Boolean(session?.role !== 'dm' && playerTok?.hasUsedConsumableThisTurn && !confirmed);

  const close = () => {
    if (submitting) return;
    setConfirmed(null);
    setPendingConsumableUse(null);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    const snap: ConfirmedSnapshot = {
      beforeHp: ch.hp,
      afterHp: Math.min(ch.maxHp, ch.hp + hpGain),
      maxHp: ch.maxHp,
      beforeMp: ch.mp,
      afterMp: Math.min(ch.maxMp, ch.mp + mpGain),
      maxMp: ch.maxMp,
      beforeXp: Number(ch.xp || 0),
      afterXp: Number(ch.xp || 0) + xpGain,
      xpTarget: Math.max(1, Number(ch.xpToNext || (ch.level || 1) * 100)),
      actualHpGain: Math.max(0, Math.min(ch.maxHp, ch.hp + hpGain) - ch.hp),
      actualMpGain: Math.max(0, Math.min(ch.maxMp, ch.mp + mpGain) - ch.mp),
      actualXpGain: xpGain,
      leveledUp: xpGain > 0 && Number(ch.xp || 0) + xpGain >= Math.max(1, Number(ch.xpToNext || (ch.level || 1) * 100)),
      remainingQty: Math.max(0, curQty - 1),
    };
    const res = await sendAction<{ ok?: boolean }>('inventory_action', {
      characterId,
      subAction: 'use_consumable',
      itemId: item.id,
    });
    setSubmitting(false);
    if (res?.ok) {
      setConfirmed(snap);
    }
  };

  const hpPctBefore = maxHp > 0 ? Math.max(0, Math.min(100, (beforeHp / maxHp) * 100)) : 0;
  const hpPctAfter = maxHp > 0 ? Math.max(0, Math.min(100, (afterHp / maxHp) * 100)) : 0;
  const mpPctBefore = maxMp > 0 ? Math.max(0, Math.min(100, (beforeMp / maxMp) * 100)) : 0;
  const mpPctAfter = maxMp > 0 ? Math.max(0, Math.min(100, (afterMp / maxMp) * 100)) : 0;
  const xpPctBefore = xpTarget > 0 ? Math.max(0, Math.min(100, (beforeXp / xpTarget) * 100)) : 0;
  const xpPctAfter = xpTarget > 0 ? Math.max(0, Math.min(100, (afterXp / xpTarget) * 100)) : 0;

  const themeClass =
    hpGain > 0 ? 'is-hp' : mpGain > 0 ? 'is-mp' : xpGain > 0 ? 'is-xp' : 'is-buff';

  const showHpBar = hpGain > 0 || Boolean(confirmed && confirmed.actualHpGain > 0);
  const showMpBar = mpGain > 0 || Boolean(confirmed && confirmed.actualMpGain > 0);
  const showXpBar = xpGain > 0 || Boolean(confirmed && confirmed.actualXpGain > 0);

  return (
    <div
      id="consumable-confirm-modal"
      className="modal-backdrop open consumable-modal-backdrop"
      style={{ zIndex: 9070 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="consumable-modal-title"
      onClick={close}
    >
      <div
        className={`modal-card consumable-modal-card ${confirmed ? 'card-glow-gold' : 'card-glow-cyan'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="consumable-modal-head">
          <div className={`consumable-modal-icon ${themeClass}`}>
            <InventoryItemSvg item={item} />
          </div>
          <div className="consumable-modal-title-wrap">
            <div className="consumable-modal-badges">
              <span className={`tag ${confirmed ? 'tag-green' : 'tag-cyan'}`}>
                {confirmed ? 'ITEM APPLIED' : 'CONFIRM USE'}
              </span>
              <span className="tag tag-outline">
                Qty: &times;{curQty} &rarr; &times;{afterQty}
              </span>
            </div>
            <h2 id="consumable-modal-title" className="consumable-modal-title">
              {item.name}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-outline consumable-modal-x"
            aria-label="Close Consumable Preview"
            onClick={close}
          >
            &times;
          </button>
        </div>

        {item.notes && <p className="consumable-modal-notes">{item.notes}</p>}

        {item.effectSpec && (
          <div className="consumable-effect-pill-box">
            <span className="consumable-effect-label">STATUS EFFECT</span>
            <span className="tag tag-purple">{formatUnitEffectSpec(item.effectSpec)}</span>
          </div>
        )}

        {(showHpBar || showMpBar || showXpBar) && (
          <div className="consumable-previews">
            {showHpBar && (
              <div className="consumable-preview-card">
                <div className="consumable-preview-top">
                  <span className="consumable-preview-stat is-hp">HP</span>
                  <span className="consumable-preview-nums">
                    <span>
                      {beforeHp}/{maxHp}
                    </span>
                    <span className="muted">&rarr;</span>
                    <strong className="is-hp">
                      {afterHp}/{maxHp}
                    </strong>
                  </span>
                  <span className={`tag ${actualHpGain > 0 ? 'tag-green' : 'tag-outline'}`}>
                    {actualHpGain > 0 ? `+${actualHpGain} HP` : 'FULL (+0)'}
                  </span>
                </div>
                <div className="consumable-bar-track" role="progressbar" aria-valuenow={afterHp} aria-valuemax={maxHp}>
                  <div className="consumable-bar-base is-hp" style={{ width: `${hpPctBefore}%` }} />
                  {hpPctAfter > hpPctBefore && (
                    <div
                      className="consumable-bar-gain is-hp"
                      style={{
                        left: `${hpPctBefore}%`,
                        width: `${Math.max(0, hpPctAfter - hpPctBefore)}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            {showMpBar && (
              <div className="consumable-preview-card">
                <div className="consumable-preview-top">
                  <span className="consumable-preview-stat is-mp">MP</span>
                  <span className="consumable-preview-nums">
                    <span>
                      {beforeMp}/{maxMp}
                    </span>
                    <span className="muted">&rarr;</span>
                    <strong className="is-mp">
                      {afterMp}/{maxMp}
                    </strong>
                  </span>
                  <span className={`tag ${actualMpGain > 0 ? 'tag-cyan' : 'tag-outline'}`}>
                    {actualMpGain > 0 ? `+${actualMpGain} MP` : 'FULL (+0)'}
                  </span>
                </div>
                <div className="consumable-bar-track" role="progressbar" aria-valuenow={afterMp} aria-valuemax={maxMp}>
                  <div className="consumable-bar-base is-mp" style={{ width: `${mpPctBefore}%` }} />
                  {mpPctAfter > mpPctBefore && (
                    <div
                      className="consumable-bar-gain is-mp"
                      style={{
                        left: `${mpPctBefore}%`,
                        width: `${Math.max(0, mpPctAfter - mpPctBefore)}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            {showXpBar && (
              <div className="consumable-preview-card">
                <div className="consumable-preview-top">
                  <span className="consumable-preview-stat is-xp">EXP</span>
                  <span className="consumable-preview-nums">
                    <span>
                      {beforeXp}/{xpTarget}
                    </span>
                    <span className="muted">&rarr;</span>
                    <strong className="is-xp">
                      {afterXp}/{xpTarget}
                    </strong>
                  </span>
                  <span className="tag tag-gold">
                    +{actualXpGain} XP{leveledUp ? ' • LVL UP!' : ''}
                  </span>
                </div>
                <div
                  className="consumable-bar-track"
                  role="progressbar"
                  aria-valuenow={Math.min(xpTarget, afterXp)}
                  aria-valuemax={xpTarget}
                >
                  <div className="consumable-bar-base is-xp" style={{ width: `${xpPctBefore}%` }} />
                  {xpPctAfter > xpPctBefore && (
                    <div
                      className="consumable-bar-gain is-xp"
                      style={{
                        left: `${xpPctBefore}%`,
                        width: `${Math.max(0, xpPctAfter - xpPctBefore)}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="consumable-modal-footer">
          {!confirmed ? (
            <>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={close}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-use-consumable"
                className="btn btn-sm btn-cyan"
                disabled={submitting || lockedByTurn}
                onClick={() => void handleConfirm()}
              >
                {submitting ? 'Using...' : lockedByTurn ? 'Used This Turn' : 'Confirm Use'}
              </button>
            </>
          ) : (
            <button
              type="button"
              id="btn-done-use-consumable"
              className="btn btn-sm btn-gold"
              onClick={close}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
