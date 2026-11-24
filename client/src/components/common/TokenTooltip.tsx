import { UNIT_EFFECT_META, type ActiveUnitEffect, type UnitEffectKind } from '@shared/index';
import { useVtt } from '../../context/VttContext';

interface GroupedEffect {
  kind: UnitEffectKind;
  name: string;
  count: number;
  totalPotency: number;
  maxTurns: number;
}

function groupEffectsByKind(list: ActiveUnitEffect[]): GroupedEffect[] {
  const map = new Map<UnitEffectKind, GroupedEffect>();
  for (const eff of list) {
    const meta = UNIT_EFFECT_META[eff.kind];
    const baseName = meta ? meta.label.split(' (')[0] : eff.name;
    const pot = Math.max(0, Number(eff.potency || 0));
    const turns = Math.max(0, Number(eff.turnsRemaining || 0));
    const existing = map.get(eff.kind);
    if (existing) {
      existing.count += 1;
      existing.totalPotency += pot;
      existing.maxTurns = Math.max(existing.maxTurns, turns);
    } else {
      map.set(eff.kind, {
        kind: eff.kind,
        name: baseName,
        count: 1,
        totalPotency: pot,
        maxTurns: turns,
      });
    }
  }
  return Array.from(map.values());
}

function renderGroupedPillLabel(g: GroupedEffect) {
  const potText =
    g.kind === 'stun' ? '' : g.kind === 'bleed' ? ` • ${g.totalPotency}%` : ` • ${g.totalPotency}`;
  return (
    <>
      <span>{g.name}</span>
      <span className="token-tooltip-stack">&times;{g.count}</span>
      <span>
        {potText} ({g.maxTurns}t)
      </span>
    </>
  );
}

export function TokenTooltip() {
  const { tooltip, session, state } = useVtt();
  if (!tooltip) {
    return <div id="map-token-tooltip" className="token-tooltip hidden" role="tooltip" />;
  }
  const { tok, x, y } = tooltip;
  const isDm = session?.role === 'dm';
  const liveMon = tok.type === 'monster' ? state?.monsters?.find((m) => m.id === tok.id) : undefined;
  const liveChar = tok.type === 'player' && tok.id ? state?.characters?.[tok.id] : undefined;

  const hpText = tok.hp !== null && tok.hp !== undefined && tok.maxHp
    ? `${tok.hp}/${tok.maxHp} HP`
    : 'Token';
  const monObservedHpText = liveMon?.observedByViewer && liveMon.hp !== null && liveMon.maxHp
    ? ` • ${liveMon.hp}/${liveMon.maxHp} HP`
    : '';
  const subLabel = tok.npcRole
    ? ` • ${tok.npcRole}`
    : tok.type === 'monster'
      ? isDm
        ? ` • ${hpText}`
        : monObservedHpText
      : tok.type === 'player'
        ? isDm
          ? ` • ${hpText}`
          : liveChar
            ? ` • Lv ${liveChar.level}`
            : ''
        : '';

  const effects: ActiveUnitEffect[] =
    tok.type === 'monster'
      ? liveMon?.activeEffects || tok.activeEffects || []
      : tok.type === 'player'
        ? liveChar?.activeEffects || tok.activeEffects || []
        : tok.activeEffects || [];

  const buffs = effects.filter((e) => e.category === 'buff');
  const debuffs = effects.filter((e) => e.category === 'debuff');
  const groupedBuffs = groupEffectsByKind(buffs);
  const groupedDebuffs = groupEffectsByKind(debuffs);

  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const clampedX = Math.max(136, Math.min(viewportW - 136, x));
  const flipBelow = y < 115;

  const typeClass = tok.type === 'monster' ? 'monster' : tok.type === 'npc' ? 'npc' : '';

  return (
    <div
      id="map-token-tooltip"
      className={`token-tooltip ${typeClass} ${flipBelow ? 'is-below' : ''}`.trim()}
      style={{ left: `${clampedX}px`, top: `${y}px` }}
      role="tooltip"
    >
      <div className="token-tooltip-head">
        <strong>{tok.name}</strong>
        {subLabel && <span className="token-tooltip-sub">{subLabel}</span>}
      </div>

      {groupedBuffs.length > 0 && (
        <div className="token-tooltip-group">
          <span className="token-tooltip-group-label is-buff">BUFFS ({buffs.length})</span>
          <div className="token-tooltip-pills">
            {groupedBuffs.map((g) => (
              <span key={g.kind} className="tag tag-green small">
                {renderGroupedPillLabel(g)}
              </span>
            ))}
          </div>
        </div>
      )}

      {groupedDebuffs.length > 0 && (
        <div className="token-tooltip-group">
          <span className="token-tooltip-group-label is-debuff">DEBUFFS ({debuffs.length})</span>
          <div className="token-tooltip-pills">
            {groupedDebuffs.map((g) => (
              <span key={g.kind} className="tag tag-crimson small">
                {renderGroupedPillLabel(g)}
              </span>
            ))}
          </div>
        </div>
      )}

      {buffs.length === 0 && debuffs.length === 0 && (
        <div className="token-tooltip-empty">No active buffs or debuffs</div>
      )}
    </div>
  );
}
