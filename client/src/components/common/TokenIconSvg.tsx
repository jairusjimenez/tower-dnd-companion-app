import React from 'react';
import {
  TOKEN_ICON_META,
  inferMonsterIconId,
  inferNpcIconId,
  isBossToken,
  type TokenIconId,
} from '@shared/index';

interface TokenIconSvgProps {
  type: 'monster' | 'npc';
  name: string;
  iconId?: TokenIconId;
  npcRole?: string;
  category?: string;
  isBoss?: boolean;
  size?: number;
}

export function TokenIconSvg({
  type,
  name,
  iconId,
  npcRole,
  category,
  isBoss,
  size = 24,
}: TokenIconSvgProps) {
  const resolved: TokenIconId =
    iconId || (type === 'monster' ? inferMonsterIconId(name, category) : inferNpcIconId(name, npcRole));
  const meta = TOKEN_ICON_META[resolved] || TOKEN_ICON_META.goblin;
  const boss = type === 'monster' && (isBoss ?? isBossToken(name, iconId, category));
  const stroke = boss ? '#fbbf24' : type === 'monster' ? '#fca5a5' : '#6ee7b7';

  return (
    <span
      title={meta.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 30% 30%, ${meta.bg}, #090d16)`,
        border: `1.5px solid ${stroke}`,
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {boss && (
        <svg
          width={Math.round(size * 0.52)}
          height={Math.round(size * 0.32)}
          viewBox="0 0 16 10"
          style={{ position: 'absolute', top: -Math.round(size * 0.24), left: '50%', transform: 'translateX(-50%)' }}
        >
          <polygon points="1,9 1,2 5,6 8,1 11,6 15,2 15,9" fill="#fbbf24" stroke="#0f172a" strokeWidth="1.2" />
        </svg>
      )}
      <svg width={Math.round(size * 0.68)} height={Math.round(size * 0.68)} viewBox="-12 -12 24 24" fill={meta.accent} stroke={meta.accent}>
        {resolved === 'goblin' && (
          <>
            <polygon points="-4,-2 -11,-5 -4,2" stroke="none" />
            <polygon points="4,-2 11,-5 4,2" stroke="none" />
            <circle cx="0" cy="1" r="5.5" stroke="none" />
            <polygon points="-3,-1 -1,0 -3,1" fill="#0f172a" stroke="none" />
            <polygon points="3,-1 1,0 3,1" fill="#0f172a" stroke="none" />
          </>
        )}
        {resolved === 'orc' && (
          <>
            <rect x="-6" y="-6" width="12" height="11" rx="3" stroke="none" />
            <polygon points="-4,5 -2.5,0 -1,5" fill="#fef3c7" stroke="none" />
            <polygon points="4,5 2.5,0 1,5" fill="#fef3c7" stroke="none" />
            <rect x="-3.5" y="-3" width="2" height="1.5" fill="#0f172a" stroke="none" />
            <rect x="1.5" y="-3" width="2" height="1.5" fill="#0f172a" stroke="none" />
          </>
        )}
        {resolved === 'dragon' && (
          <>
            <polygon points="-3,-3 -9,-9 -1,-5" stroke="none" />
            <polygon points="3,-3 9,-9 1,-5" stroke="none" />
            <polygon points="0,-6 6,0 3,7 -3,7 -6,0" stroke="none" />
            <rect x="-2.8" y="-1" width="1.8" height="1.6" fill="#7f1d1d" stroke="none" />
            <rect x="1" y="-1" width="1.8" height="1.6" fill="#7f1d1d" stroke="none" />
          </>
        )}
        {resolved === 'serpent' && (
          <>
            <path d="M-6,7 C6,7 -6,0 2,-5" fill="none" strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="3" cy="-5.5" r="2.6" stroke="none" />
            <path d="M5.5,-5.5 L9,-5.5 L10.5,-7 M9,-5.5 L10.5,-4" fill="none" stroke="#fb7185" strokeWidth="1.2" />
          </>
        )}
        {resolved === 'spider' && (
          <>
            <circle cx="0" cy="2.5" r="3.8" stroke="none" />
            <circle cx="0" cy="-3" r="2.4" stroke="none" />
            <path d="M-2,-3 L-7,-5 L-9,-2 M-2,-1 L-7,-2 L-9,1 M-2,1 L-7,1 L-9,4 M-2,3 L-7,4 L-9,7" fill="none" strokeWidth="1.3" />
            <path d="M2,-3 L7,-5 L9,-2 M2,-1 L7,-2 L9,1 M2,1 L7,1 L9,4 M2,3 L7,4 L9,7" fill="none" strokeWidth="1.3" />
          </>
        )}
        {resolved === 'undead' && (
          <>
            <circle cx="0" cy="-1.5" r="5.5" stroke="none" />
            <rect x="-3.5" y="2" width="7" height="4.5" rx="1" stroke="none" />
            <circle cx="-2.2" cy="-1" r="1.5" fill="#0f172a" stroke="none" />
            <circle cx="2.2" cy="-1" r="1.5" fill="#0f172a" stroke="none" />
            <rect x="-2" y="4" width="1" height="2" fill="#0f172a" stroke="none" />
            <rect x="1" y="4" width="1" height="2" fill="#0f172a" stroke="none" />
          </>
        )}
        {resolved === 'knight' && (
          <>
            <path d="M0,-9 Q5,-7 3.5,-4 L-2,-4.5 Z" stroke="none" />
            <rect x="-5" y="-5" width="10" height="11" rx="3" stroke="none" />
            <rect x="-3.5" y="-1.5" width="7" height="1.8" fill="#0f172a" stroke="none" />
            <rect x="-0.8" y="-1.5" width="1.6" height="5.5" fill="#0f172a" stroke="none" />
          </>
        )}
        {resolved === 'beast' && (
          <>
            <polygon points="-5,-1 -7,-9 -1,-4.5" stroke="none" />
            <polygon points="5,-1 7,-9 1,-4.5" stroke="none" />
            <circle cx="0" cy="1.5" r="5.5" stroke="none" />
            <circle cx="-2" cy="0" r="1.1" fill="#0f172a" stroke="none" />
            <circle cx="2" cy="0" r="1.1" fill="#0f172a" stroke="none" />
            <polygon points="-1.5,2.5 1.5,2.5 0,4.2" fill="#0f172a" stroke="none" />
          </>
        )}
        {resolved === 'slime' && (
          <>
            <path d="M-7.5,5.5 Q-8,-6 0,-6.5 Q8,-6 7.5,5.5 Z" stroke="none" />
            <circle cx="-2.3" cy="0.5" r="1.2" fill="#0f172a" stroke="none" />
            <circle cx="2.3" cy="0.5" r="1.2" fill="#0f172a" stroke="none" />
          </>
        )}
        {resolved === 'demon' && (
          <>
            <path d="M-3.5,-2 Q-9,-6 -5.5,-9.5 Q-4.5,-5 -1.5,-4 Z" stroke="none" />
            <path d="M3.5,-2 Q9,-6 5.5,-9.5 Q4.5,-5 1.5,-4 Z" stroke="none" />
            <circle cx="0" cy="1" r="5" stroke="none" />
            <rect x="-2.8" y="-0.3" width="2" height="1.3" fill="#0f172a" stroke="none" />
            <rect x="0.8" y="-0.3" width="2" height="1.3" fill="#0f172a" stroke="none" />
          </>
        )}
        {resolved === 'golem' && (
          <>
            <polygon points="-5,-7 5,-7 6.8,1.5 3.8,7 -3.8,7 -6.8,1.5" stroke="none" />
            <rect x="-4" y="-1.5" width="8" height="2" fill="#0f172a" stroke="none" />
          </>
        )}
        {resolved === 'insect' && (
          <>
            <polygon points="-2,4 -6,9 -0.5,6.5" stroke="none" />
            <polygon points="2,4 6,9 0.5,6.5" stroke="none" />
            <ellipse cx="0" cy="-0.5" rx="5" ry="6" stroke="none" />
            <ellipse cx="-2.5" cy="-1" rx="1.5" ry="2.4" fill="#0f172a" stroke="none" />
            <ellipse cx="2.5" cy="-1" rx="1.5" ry="2.4" fill="#0f172a" stroke="none" />
          </>
        )}
        {resolved === 'boss' && (
          <>
            <circle cx="0" cy="1.5" r="5" stroke="none" />
            <polygon points="-5.5,-3 -5.5,-8.5 -2,-5 0,-9.5 2,-5 5.5,-8.5 5.5,-3" stroke="none" />
            <circle cx="-1.8" cy="1" r="1.2" fill="#0f172a" stroke="none" />
            <circle cx="1.8" cy="1" r="1.2" fill="#0f172a" stroke="none" />
          </>
        )}
        {resolved === 'merchant' && (
          <>
            <path d="M-3,-7 L3,-7 L1.5,-3.5 L6,1.5 Q6,7.5 0,7.5 Q-6,7.5 -6,1.5 L-1.5,-3.5 Z" stroke="none" />
            <text x="0" y="4" textAnchor="middle" fontSize="7.5" fontWeight="bold" fill="#064e3b" stroke="none">$</text>
          </>
        )}
        {resolved === 'quest_giver' && (
          <>
            <rect x="-2.2" y="-8" width="4.4" height="9.5" rx="1.5" stroke="none" />
            <circle cx="0" cy="5.8" r="2.2" stroke="none" />
          </>
        )}
        {resolved === 'skill_master' && (
          <>
            <path d="M-7,7 L7,-7 M-5.5,2.5 L-2.5,5.5 M7,7 L-7,-7 M5.5,2.5 L2.5,5.5" fill="none" strokeWidth="2.2" strokeLinecap="round" />
          </>
        )}
        {resolved === 'guard' && (
          <>
            <path d="M-6,-7 L6,-7 L6,0.5 Q0,8.5 0,8.5 Q0,8.5 -6,0.5 Z" stroke="none" />
            <path d="M0,-4.5 L0,5 M-3.5,-1 L3.5,-1" stroke="#1e3a8a" strokeWidth="1.6" />
          </>
        )}
        {resolved === 'healer' && (
          <>
            <rect x="-2.2" y="-7.5" width="4.4" height="15" stroke="none" />
            <rect x="-7.5" y="-2.2" width="15" height="4.4" stroke="none" />
          </>
        )}
        {resolved === 'blacksmith' && (
          <>
            <rect x="-6.5" y="-7" width="13" height="4.8" stroke="none" />
            <rect x="-1.6" y="-2.2" width="3.2" height="9.5" stroke="none" />
          </>
        )}
        {resolved === 'sage' && (
          <polygon points="0,-8.5 2.4,-2.4 8.5,0 2.4,2.4 0,8.5 -2.4,2.4 -8.5,0 -2.4,-2.4" stroke="none" />
        )}
        {resolved === 'villager' && (
          <>
            <circle cx="0" cy="-3" r="3.5" stroke="none" />
            <path d="M-6,7.5 Q0,-0.5 6,7.5 Z" stroke="none" />
          </>
        )}
      </svg>
    </span>
  );
}
