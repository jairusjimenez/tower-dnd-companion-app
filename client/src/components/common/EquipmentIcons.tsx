import type { EquipmentItem, EquipmentSlot, InventoryItem } from '@shared/index';

function resolveAccentAndGlow(name: string, empty: boolean): { accent: string; glow: string } {
  if (empty) return { accent: '#475569', glow: 'rgba(71, 85, 105, 0.12)' };
  if (/obsidian|shadow|dark|void|night/.test(name)) return { accent: '#a855f7', glow: 'rgba(168, 85, 247, 0.32)' };
  if (/azure|mana|shinsu|frost|ice|clear|prism/.test(name)) return { accent: '#38bdf8', glow: 'rgba(56, 189, 248, 0.32)' };
  if (/crimson|blood|fire|flame|ruby/.test(name)) return { accent: '#ef4444', glow: 'rgba(239, 68, 68, 0.32)' };
  if (/iron|steel|plate|oak|emerald/.test(name)) return { accent: '#94a3b8', glow: 'rgba(148, 163, 184, 0.28)' };
  return { accent: '#fbbf24', glow: 'rgba(251, 191, 36, 0.25)' };
}

export function EquipmentArtSvg({
  slot,
  item,
}: {
  slot: EquipmentSlot | string;
  item?: EquipmentItem | InventoryItem | string | null;
}) {
  const name = String(typeof item === 'string' ? item : item?.name || '').toLowerCase();
  const { accent, glow } = resolveAccentAndGlow(name, !item);

  if (slot === 'mainHand') {
    if (/staff|wand|rod/.test(name)) {
      return (
        <svg viewBox="0 0 64 64">
          <circle cx="44" cy="18" r="8" fill={glow} stroke={accent} strokeWidth="2.5" />
          <line x1="16" y1="52" x2="40" y2="23" stroke={accent} strokeWidth="4" strokeLinecap="round" />
          <circle cx="44" cy="18" r="3" fill="#fff" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 64 64">
        <polygon points="48,10 54,16 28,44 20,36" fill={glow} stroke={accent} strokeWidth="2.2" strokeLinejoin="round" />
        <line x1="16" y1="32" x2="32" y2="48" stroke="#fbbf24" strokeWidth="3.5" strokeLinecap="round" />
        <line x1="22" y1="42" x2="12" y2="52" stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }

  if (slot === 'offHand') {
    if (/orb|tome|book|prism/.test(name)) {
      return (
        <svg viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="18" fill={glow} stroke={accent} strokeWidth="2.5" />
          <circle cx="27" cy="26" r="5" fill="#fff" opacity="0.45" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 64 64">
        <path
          d="M16 14 L48 14 L48 32 C48 45 32 54 32 54 C32 54 16 45 16 32 Z"
          fill={glow}
          stroke={accent}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <line x1="32" y1="18" x2="32" y2="48" stroke={accent} strokeWidth="1.6" opacity="0.7" />
      </svg>
    );
  }

  if (slot === 'head') {
    return (
      <svg viewBox="0 0 64 64">
        <path
          d="M16 38 C16 20 24 14 32 14 C40 14 48 20 48 38 L44 46 L36 42 L32 34 L28 42 L20 46 Z"
          fill={glow}
          stroke={accent}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="22" r="3" fill={accent} />
      </svg>
    );
  }

  if (slot === 'body') {
    return (
      <svg viewBox="0 0 64 64">
        <path
          d="M18 14 L26 12 L32 18 L38 12 L46 14 L52 24 L45 29 L43 52 L21 52 L19 29 L12 24 Z"
          fill={glow}
          stroke={accent}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <line x1="32" y1="20" x2="32" y2="48" stroke={accent} strokeWidth="1.5" opacity="0.65" />
      </svg>
    );
  }

  if (slot === 'boots') {
    return (
      <svg viewBox="0 0 64 64">
        <path
          d="M18 14 L30 14 L30 38 L46 42 L46 50 L18 50 Z"
          fill={glow}
          stroke={accent}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M34 22 L44 22 L44 36 L52 39 L52 46" fill="none" stroke={accent} strokeWidth="2" opacity="0.55" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64">
      <polygon points="32,10 50,28 32,54 14,28" fill={glow} stroke={accent} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="32" cy="28" r="5" fill={accent} />
    </svg>
  );
}

export function InventoryItemSvg({ item }: { item: InventoryItem }) {
  const cat = String(item?.category || 'relic').toLowerCase();
  const name = String(item?.name || '').toLowerCase();
  if (cat === 'consumable') {
    const isMana = /mana|mp|azure|blue|elixir/.test(name);
    const color = isMana ? '#38bdf8' : '#ef4444';
    const fill = isMana ? 'rgba(56, 189, 248, 0.35)' : 'rgba(239, 68, 68, 0.35)';
    return (
      <svg viewBox="0 0 64 64">
        <rect x="26" y="10" width="12" height="6" rx="2" fill="#fbbf24" />
        <path
          d="M27 16 L37 16 L39 24 L48 34 C51 39 48 52 38 54 L26 54 C16 52 13 39 16 34 L25 24 Z"
          fill={fill}
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <circle cx="27" cy="40" r="3" fill="#fff" opacity="0.5" />
      </svg>
    );
  }
  if (cat === 'skill_book' || /book|scroll|tome|manual/.test(name)) {
    return (
      <svg viewBox="0 0 64 64">
        <rect x="14" y="12" width="36" height="40" rx="4" fill="rgba(168, 85, 247, 0.25)" stroke="#c084fc" strokeWidth="2.5" />
        <line x1="22" y1="12" x2="22" y2="52" stroke="#c084fc" strokeWidth="2" />
        <polygon points="35,24 38,31 45,32 39,37 41,44 35,40 29,44 31,37 25,32 32,31" fill="#fde047" />
      </svg>
    );
  }
  const inferredSlot =
    item?.slot ||
    (cat === 'weapon'
      ? 'mainHand'
      : cat === 'armor'
        ? /helm|circlet|hood/.test(name)
          ? 'head'
          : /boot|greave/.test(name)
            ? 'boots'
            : /shield|buckler|orb/.test(name)
              ? 'offHand'
              : 'body'
        : 'relic');
  return <EquipmentArtSvg slot={inferredSlot} item={item} />;
}
