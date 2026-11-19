import { useVtt } from '../../context/VttContext';

export function TokenTooltip() {
  const { tooltip } = useVtt();
  if (!tooltip) {
    return <div id="map-token-tooltip" className="token-tooltip hidden" role="tooltip" />;
  }
  const { tok, x, y } = tooltip;
  const hpText = tok.hp !== null && tok.hp !== undefined && tok.maxHp
    ? `${tok.hp}/${tok.maxHp} HP`
    : 'Token';
  const subLabel = tok.npcRole
    ? ` • ${tok.npcRole}`
    : tok.type === 'monster'
      ? ` • ${hpText}`
      : tok.type === 'player'
        ? ` • ${hpText}`
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
