import type { EquipmentItem, EquipmentSlot } from '@shared/index';
import { EquipmentArtSvg } from './EquipmentIcons';

const SLOTS: Array<{ key: EquipmentSlot; label: string }> = [
  { key: 'head', label: 'Head' },
  { key: 'relic', label: 'Relic' },
  { key: 'mainHand', label: 'Main Hand' },
  { key: 'body', label: 'Body' },
  { key: 'offHand', label: 'Off-Hand' },
  { key: 'boots', label: 'Boots' },
];

export function DiabloEquipmentGrid({
  equipment,
  showActions = false,
  locked = false,
  onUnequip,
}: {
  equipment?: Partial<Record<EquipmentSlot, EquipmentItem | null>> | null;
  showActions?: boolean;
  locked?: boolean;
  onUnequip?: (slot: EquipmentSlot) => void;
}) {
  const eq = equipment || {};

  return (
    <>
      {SLOTS.map((s) => {
        const item = eq[s.key];
        const filled = Boolean(item);
        const itemName = filled ? (typeof item === 'string' ? item : item?.name || 'Equipped') : 'Available Slot';
        const metaParts: string[] = [];
        if (filled && item && typeof item === 'object') {
          if (item.damageDice) metaParts.push(item.damageDice);
          if (item.acBonus) metaParts.push(`+${item.acBonus} Armor Class`);
          if (item.drBonus) metaParts.push(`+${item.drBonus} Damage Reduction`);
          if (item.attackBonus) metaParts.push(`+${item.attackBonus} Hit`);
        }

        return (
          <div
            key={s.key}
            className={`d2-slot d2-slot-${s.key} ${filled ? 'filled' : 'empty'}`}
            title={`${s.label}: ${itemName}`}
          >
            <div className="d2-slot-label">{s.label}</div>
            <div className="d2-slot-art">
              {filled && item && typeof item === 'object' && item.artUrl ? (
                <img src={item.artUrl} alt={itemName} />
              ) : (
                <EquipmentArtSvg slot={s.key} item={item} />
              )}
            </div>
            <div className="d2-slot-name">{itemName}</div>
            {metaParts.length > 0 && <div className="d2-slot-meta">{metaParts.join(' • ')}</div>}
            {showActions && filled && (
              <div className="btn-row mt-xs" style={{ justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn btn-xs btn-outline"
                  disabled={locked}
                  title={locked ? 'Locked while session and story beat are active' : undefined}
                  onClick={() => onUnequip?.(s.key)}
                >
                  Unequip
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
