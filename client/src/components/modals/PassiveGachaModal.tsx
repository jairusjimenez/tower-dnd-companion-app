import { useEffect, useMemo, useRef, useState } from 'react';
import { sampleWeightedPassive, type PassiveSkill, type PassiveTier } from '@shared/index';
import { useVtt } from '../../context/VttContext';

interface GachaRollPayload {
  skill: PassiveSkill;
  tier: PassiveTier;
  duplicate?: boolean;
  nextStacks?: number;
  extraPct?: number;
  multiplierPct?: number;
  floorLevel?: number;
  declineGold?: number;
  declineXp?: number;
  skipSpin?: boolean;
}

const TOTAL_CARDS = 40;
const WIN_IDX = 32;

function tierTagClass(tier: string): string {
  return `tag-tier-${String(tier || 'Normal').toLowerCase().replace(/\s+/g, '-')}`;
}

export function PassiveGachaModal() {
  const {
    gachaModalOpen,
    setGachaModalOpen,
    gachaSpinData,
    setGachaSpinData,
    session,
    state,
    sendAction,
  } = useVtt();

  const data = gachaSpinData as GachaRollPayload | null;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [resolvedSummary, setResolvedSummary] = useState<{ title: string; detail: string; tier: string } | null>(null);

  const cards = useMemo(() => {
    if (!data?.skill) return [];
    const pool = state?.passiveGacha?.pool || [];
    return Array.from({ length: TOTAL_CARDS }, (_, idx) => (idx === WIN_IDX ? data.skill : sampleWeightedPassive(pool)));
  }, [data?.skill?.id, data?.skipSpin, state?.passiveGacha?.pool]);

  useEffect(() => {
    if (!gachaModalOpen || !data?.skill) return;
    setResolvedSummary(null);
    setRevealed(Boolean(data.skipSpin));

    const track = trackRef.current;
    if (!track) return;

    track.style.transition = 'none';
    track.style.transform = 'translateX(0px)';

    const viewportW = track.parentElement?.clientWidth || 560;
    const cardStep = 142;
    const padLeft = 12;
    const jitter = data.skipSpin ? 0 : Math.floor((Math.random() - 0.5) * 44);
    const targetX = Math.max(0, padLeft + WIN_IDX * cardStep + 66 - viewportW / 2 + jitter);

    if (data.skipSpin) {
      track.style.transform = `translateX(-${targetX}px)`;
      setRevealed(true);
      return;
    }

    const raf = window.requestAnimationFrame(() => {
      void track.offsetWidth;
      track.style.transition = 'transform 3.5s cubic-bezier(0.12, 0.86, 0.18, 1)';
      track.style.transform = `translateX(-${targetX}px)`;
    });

    const timer = window.setTimeout(() => {
      setRevealed(true);
    }, 3550);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [gachaModalOpen, data]);

  if (!gachaModalOpen || !data?.skill) return null;

  const chId = session?.characterId;
  const ch = chId ? state?.characters?.[chId] : undefined;
  const ticketsLeft = Number(ch?.passiveTickets ?? 0);
  const tier = data.tier || data.skill.tier || 'Normal';

  const handleFinalize = async (decision: 'accept' | 'decline') => {
    if (!chId) return;
    const res = await sendAction<{
      decision?: string;
      tier?: string;
      skill?: PassiveSkill;
      goldGained?: number;
      xpGained?: number;
      duplicate?: boolean;
      extraPct?: number;
      multiplierPct?: number;
    }>('resolve_passive_gacha', { characterId: chId, decision });

    if (!res) return;
    const resTier = res.tier || res.skill?.tier || tier;
    if (res.decision === 'decline') {
      setResolvedSummary({
        tier: resTier,
        title: `Declined [${resTier}] ${res.skill?.name || data.skill.name}`,
        detail: `Gained +${res.goldGained ?? data.declineGold} Gold & +${res.xpGained ?? data.declineXp} XP!`,
      });
    } else if (res.duplicate) {
      setResolvedSummary({
        tier: resTier,
        title: `[${resTier}] Upgraded: ${res.skill?.name || data.skill.name} (×${res.skill?.stacks || 2})`,
        detail: `Effect multiplied to ${res.multiplierPct || 150}% (+${res.extraPct || 50}%)! ${res.skill?.description || ''}`,
      });
    } else {
      setResolvedSummary({
        tier: resTier,
        title: `[${resTier}] Acquired: ${res.skill?.name || data.skill.name}!`,
        detail: res.skill?.description || data.skill.description,
      });
    }
  };

  const handleDrawAgain = async () => {
    if (!chId) return;
    const res = await sendAction<Record<string, unknown>>('roll_passive_gacha', { characterId: chId });
    if (res?.skill) {
      setGachaSpinData(res);
    }
  };

  return (
    <div id="p-gacha-modal" className="modal-backdrop">
      <div className="modal-card modal-wide card-glow-purple">
        <div className="panel-header">
          <h3>Passive Skill Lottery</h3>
          <button
            type="button"
            id="btn-close-gacha-modal"
            className="btn btn-xs btn-outline"
            disabled={!revealed && !resolvedSummary}
            onClick={() => setGachaModalOpen(false)}
          >
            &times;
          </button>
        </div>

        <div className="gacha-odds-bar small muted">
          <span className="tag tag-tier-normal">Normal 55%</span>
          <span className="tag tag-tier-advanced">Advanced 22%</span>
          <span className="tag tag-tier-rare">Rare 12%</span>
          <span className="tag tag-tier-super-rare">SR 6%</span>
          <span className="tag tag-tier-super-super-rare">SSR 3%</span>
          <span className="tag tag-tier-legendary">Legendary 1.5%</span>
          <span className="tag tag-tier-mythic">Mythic 0.5%</span>
        </div>

        <div className="gacha-reel-viewport mt-sm">
          <div className="gacha-reel-marker" aria-hidden="true" />
          <div ref={trackRef} id="p-gacha-reel-track" className="gacha-reel-track">
            {cards.map((sk, idx) => (
              <div
                key={`${sk.id}-${idx}`}
                className={`gacha-reel-card ${idx === WIN_IDX ? 'gacha-win-slot' : ''} ${revealed && idx === WIN_IDX ? 'winner' : ''}`}
              >
                <span className={`tag ${tierTagClass(sk.tier)}`}>{sk.tier}</span>
                <div className="gacha-reel-card-name">{sk.name}</div>
              </div>
            ))}
          </div>
        </div>

        {(revealed || resolvedSummary) && (
          <div
            id="p-gacha-modal-result"
            className={`gacha-result-banner mt-sm ${
              (resolvedSummary?.tier || tier) === 'Rare'
                ? 'tier-rare'
                : (resolvedSummary?.tier || tier) === 'Advanced'
                  ? 'tier-advanced'
                  : ''
            }`}
          >
            {resolvedSummary ? (
              <>
                <strong>{resolvedSummary.title}</strong>
                <div className="small muted">{resolvedSummary.detail}</div>
              </>
            ) : data.duplicate ? (
              <>
                <strong>[{tier}] Duplicate: {data.skill.name} (×{data.nextStacks || 2})</strong>
                <div className="small muted">
                  Acquire to multiply effect to {data.multiplierPct || 150}% (+{data.extraPct || 50}%), or decline for +{data.declineGold} Gold &amp; +{data.declineXp} XP (Floor {data.floorLevel || 1}).
                </div>
              </>
            ) : (
              <>
                <strong>[{tier}] {data.skill.name}</strong>
                <div className="small muted">{data.skill.description}</div>
                <div className="small muted mt-xs">
                  Acquire this passive skill or decline for +{data.declineGold} Gold &amp; +{data.declineXp} XP (Floor {data.floorLevel || 1}).
                </div>
              </>
            )}
          </div>
        )}

        <div className="btn-row mt-sm" style={{ justifyContent: 'flex-end' }}>
          {revealed && !resolvedSummary && (
            <>
              <button type="button" id="btn-gacha-decline" className="btn btn-sm btn-outline" onClick={() => handleFinalize('decline')}>
                Decline (+{data.declineGold}G, +{data.declineXp} XP)
              </button>
              <button type="button" id="btn-gacha-accept" className="btn btn-sm btn-gold" onClick={() => handleFinalize('accept')}>
                {data.duplicate ? `Upgrade (×${data.nextStacks || 2})` : 'Acquire Skill'}
              </button>
            </>
          )}
          {resolvedSummary && (
            <>
              {ticketsLeft > 0 && (
                <button type="button" id="btn-gacha-again" className="btn btn-sm btn-purple" onClick={handleDrawAgain}>
                  Draw Again ({ticketsLeft} left)
                </button>
              )}
              <button type="button" id="btn-gacha-done" className="btn btn-sm btn-cyan" onClick={() => setGachaModalOpen(false)}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
