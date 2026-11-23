import { useVtt } from '../../context/VttContext';

export function TokenTooltip() {
  const { tooltip, session, state } = useVtt();
  if (!tooltip) {
    return <div id="map-token-tooltip" className="token-tooltip hidden" role="tooltip" />;
  }
  const { tok, x, y } = tooltip;
  const isDm = session?.role === 'dm';
  const liveMon = tok.type === 'monster' ? state?.monsters?.find((m) => m.id === tok.id) : undefined;
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
          : ''
        : '';

  return (
    <div
      id="map-token-tooltip"
      className={`token-tooltip ${tok.type === 'monster' ? 'monster' : ''}`}
      style={{ left: `${x}px`, top: `${y}px` }}
      role="tooltip"
    >
      <strong>{tok.name}</strong>
      {subLabel}
    </div>
  );
}
