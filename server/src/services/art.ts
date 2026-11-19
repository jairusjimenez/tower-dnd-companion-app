import crypto from 'node:crypto';
import type { Character } from '../../../shared';

interface ArtPalette {
  bg1: string;
  bg2: string;
  accent: string;
  glow: string;
  skin: string;
  armor: string;
  trim: string;
}

export function analyzeArtPrompt(promptText: string, style?: string, character?: Partial<Character> | null): {
  palette: ArtPalette;
  raceTraits: string;
  weapon: string;
  hairColor: string;
  style: string;
} {
  const lower = `${promptText || ''} ${character?.race || ''} ${character?.className || ''}`.toLowerCase();

  let palette: ArtPalette = { bg1: '#091529', bg2: '#1e1b4b', accent: '#38bdf8', glow: '#00e5ff', skin: '#f1c29b', armor: '#334155', trim: '#94a3b8' };
  if (/fire|crimson|red|flame|inferno|dragon|blood/.test(lower)) {
    palette = { bg1: '#1a080c', bg2: '#450a0a', accent: '#f97316', glow: '#ef4444', skin: '#eac09d', armor: '#292524', trim: '#fbbf24' };
  } else if (/shadow|void|necromancer|dark|purple|violet|solo|assassin|monarch/.test(lower)) {
    palette = { bg1: '#070612', bg2: '#2e1065', accent: '#a855f7', glow: '#c084fc', skin: '#e2d5e8', armor: '#18181b', trim: '#38bdf8' };
  } else if (/emerald|nature|forest|poison|jade|druid|ranger|elf/.test(lower)) {
    palette = { bg1: '#041b15', bg2: '#064e3b', accent: '#34d399', glow: '#10b981', skin: '#f5d0b5', armor: '#1e293b', trim: '#a7f3d0' };
  } else if (/gold|holy|paladin|sun|light|cleric|angel/.test(lower)) {
    palette = { bg1: '#1c1507', bg2: '#422006', accent: '#fbbf24', glow: '#fde047', skin: '#f3c6a5', armor: '#475569', trim: '#fef08a' };
  } else if (/ice|frost|blue|shinsu|mana|wizard|mage|arcane/.test(lower)) {
    palette = { bg1: '#041225', bg2: '#0c4a6e', accent: '#38bdf8', glow: '#67e8f9', skin: '#f2d3be', armor: '#1e293b', trim: '#7dd3fc' };
  }

  let raceTraits = 'human';
  if (/tiefling|demon|horn/.test(lower)) {
    raceTraits = 'tiefling';
    palette.skin = '#c08497';
  } else if (/elf|elven|high elf/.test(lower)) {
    raceTraits = 'elf';
  } else if (/dwarf|bearded/.test(lower)) {
    raceTraits = 'dwarf';
  } else if (/dragonborn|reptile|draconic/.test(lower)) {
    raceTraits = 'dragonborn';
    palette.skin = '#b91c1c';
  }

  let weapon = 'sword';
  if (/dagger|twin|rogue|assassin|kunai/.test(lower)) weapon = 'daggers';
  else if (/staff|wand|orb|mage|wizard|caster/.test(lower)) weapon = 'staff';
  else if (/hammer|mace|axe|paladin|warrior/.test(lower)) weapon = 'hammer';
  else if (/bow|archer|spear/.test(lower)) weapon = 'bow';

  let hairColor = '#1e293b';
  if (/silver|white|snow/.test(lower)) hairColor = '#e2e8f0';
  else if (/red|crimson|ginger/.test(lower)) hairColor = '#dc2626';
  else if (/blonde|gold/.test(lower)) hairColor = '#facc15';
  else if (/blue|cyan/.test(lower)) hairColor = '#0284c7';
  else if (/purple|violet/.test(lower)) hairColor = '#7e22ce';

  return { palette, raceTraits, weapon, hairColor, style: style || 'Korean Manhwa Webtoon' };
}

function escXml(s: string): string {
  return String(s || '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

export function generateSvgPortraitDataUri(promptText: string, style?: string, character?: Partial<Character> | null): string {
  const { palette, raceTraits, weapon, hairColor, style: artStyle } = analyzeArtPrompt(promptText, style, character);
  const hash = crypto.createHash('md5').update(`${promptText}|${artStyle}|${character?.name || ''}`).digest('hex');
  const seedNum = parseInt(hash.slice(0, 6), 16);
  const runeRotation = seedNum % 360;
  const starOffset = (seedNum % 25) + 10;

  const hornSvg = raceTraits === 'tiefling'
    ? `<path d="M105 92 C86 64, 88 38, 102 28 C98 48, 104 70, 118 85 Z" fill="#18181b" stroke="${palette.accent}" stroke-width="2"/>
       <path d="M195 92 C214 64, 212 38, 198 28 C202 48, 196 70, 182 85 Z" fill="#18181b" stroke="${palette.accent}" stroke-width="2"/>`
    : '';
  const earSvg = raceTraits === 'elf'
    ? `<polygon points="103,115 78,104 103,130" fill="${palette.skin}"/>
       <polygon points="197,115 222,104 197,130" fill="${palette.skin}"/>`
    : '';
  const beardSvg = raceTraits === 'dwarf'
    ? `<path d="M116 142 Q150 202 184 142 L176 184 Q150 206 124 184 Z" fill="${hairColor}" stroke="#0f172a" stroke-width="2"/>`
    : '';

  let weaponSvg = '';
  if (weapon === 'daggers') {
    weaponSvg = `
      <path d="M62 245 L38 148 L56 172 L74 240 Z" fill="#e2e8f0" stroke="${palette.glow}" stroke-width="2.5"/>
      <path d="M238 245 L262 148 L244 172 L226 240 Z" fill="#e2e8f0" stroke="${palette.glow}" stroke-width="2.5"/>`;
  } else if (weapon === 'staff') {
    weaponSvg = `
      <line x1="238" y1="305" x2="238" y2="75" stroke="#78350f" stroke-width="7" stroke-linecap="round"/>
      <circle cx="238" cy="66" r="18" fill="${palette.glow}" opacity="0.28"/>
      <circle cx="238" cy="66" r="11" fill="${palette.accent}" stroke="#fff" stroke-width="2"/>`;
  } else if (weapon === 'hammer') {
    weaponSvg = `
      <line x1="236" y1="305" x2="226" y2="115" stroke="#78350f" stroke-width="8" stroke-linecap="round"/>
      <rect x="195" y="92" width="62" height="32" rx="5" fill="#64748b" stroke="${palette.trim}" stroke-width="3"/>`;
  } else if (weapon === 'bow') {
    weaponSvg = `
      <path d="M228 85 Q272 180 228 280" fill="none" stroke="${palette.trim}" stroke-width="6"/>
      <line x1="228" y1="85" x2="228" y2="280" stroke="${palette.glow}" stroke-width="1.5"/>`;
  } else {
    weaponSvg = `
      <polygon points="238,72 248,225 228,225" fill="#e2e8f0" stroke="${palette.glow}" stroke-width="2.5"/>
      <rect x="218" y="225" width="40" height="8" rx="3" fill="${palette.trim}"/>
      <rect x="233" y="233" width="10" height="28" fill="#451a03"/>`;
  }

  const pixelOverlay = artStyle.toLowerCase().includes('pixel')
    ? `<pattern id="px" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="1"/></pattern><rect width="300" height="340" fill="url(#px)"/>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 340" width="300" height="340">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%" stop-color="${palette.bg1}"/>
        <stop offset="100%" stop-color="${palette.bg2}"/>
      </linearGradient>
      <radialGradient id="aura" cx="50%" cy="42%" r="52%">
        <stop offset="0%" stop-color="${palette.glow}" stop-opacity="0.48"/>
        <stop offset="70%" stop-color="${palette.accent}" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="${palette.bg1}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="cloak" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${palette.armor}"/>
        <stop offset="100%" stop-color="#090d16"/>
      </linearGradient>
    </defs>
    <rect width="300" height="340" rx="18" fill="url(#bg)"/>
    <rect width="300" height="340" rx="18" fill="url(#aura)"/>
    <polygon points="150,18 192,160 108,160" fill="${palette.accent}" opacity="0.1"/>
    <g transform="translate(150 125) rotate(${runeRotation})">
      <circle r="86" fill="none" stroke="${palette.accent}" stroke-width="1.5" stroke-dasharray="10 6" opacity="0.5"/>
      <circle r="72" fill="none" stroke="${palette.glow}" stroke-width="1" stroke-dasharray="3 8" opacity="0.6"/>
    </g>
    <circle cx="${40 + starOffset}" cy="64" r="2.5" fill="${palette.glow}"/>
    <circle cx="${250 - starOffset}" cy="92" r="3" fill="${palette.accent}"/>
    <circle cx="58" cy="212" r="2" fill="#fff" opacity="0.7"/>
    <circle cx="248" cy="238" r="2.5" fill="${palette.glow}" opacity="0.8"/>
    <path d="M52 340 L72 215 Q150 178 228 215 L248 340 Z" fill="url(#cloak)" stroke="${palette.trim}" stroke-width="2.5"/>
    <path d="M84 220 L150 258 L216 220" fill="none" stroke="${palette.accent}" stroke-width="3"/>
    <polygon points="150,242 162,258 150,274 138,258" fill="${palette.glow}" stroke="#fff" stroke-width="1.5"/>
    <rect x="134" y="160" width="32" height="36" rx="10" fill="${palette.skin}"/>
    ${earSvg}
    <ellipse cx="150" cy="122" rx="45" ry="52" fill="${palette.skin}" stroke="#0f172a" stroke-width="2"/>
    <path d="M100 122 C96 72, 128 54, 150 56 C176 54, 204 72, 200 122 C192 94, 174 84, 150 86 C126 84, 108 94, 100 122 Z" fill="${hairColor}"/>
    ${hornSvg}
    <ellipse cx="132" cy="122" rx="7" ry="4.5" fill="#0f172a"/>
    <ellipse cx="168" cy="122" rx="7" ry="4.5" fill="#0f172a"/>
    <circle cx="133" cy="122" r="3.2" fill="${palette.glow}"/>
    <circle cx="167" cy="122" r="3.2" fill="${palette.glow}"/>
    <path d="M140 144 Q150 149 160 144" fill="none" stroke="#7c2d12" stroke-width="2" stroke-linecap="round"/>
    ${beardSvg}
    ${weaponSvg}
    ${pixelOverlay}
    <rect x="8" y="8" width="284" height="324" rx="14" fill="none" stroke="${palette.accent}" stroke-opacity="0.55" stroke-width="2"/>
    <rect x="14" y="294" width="272" height="30" rx="6" fill="#020617" fill-opacity="0.82" stroke="${palette.accent}" stroke-opacity="0.5"/>
    <text x="150" y="313" text-anchor="middle" fill="${palette.glow}" font-family="Segoe UI, sans-serif" font-size="11" font-weight="700" letter-spacing="1.2">${escXml((character?.name || 'CHALLENGER').toUpperCase().slice(0, 22))} • ${escXml(artStyle.toUpperCase().slice(0, 14))}</text>
  </svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export async function generateCharacterArt(
  promptText: string,
  style?: string,
  character?: Partial<Character> | null,
): Promise<{ url: string; engine: string }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey && typeof fetch === 'function') {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: `${style || 'Korean manhwa webtoon character portrait'}, ${promptText}` }],
            parameters: { sampleCount: 1, aspectRatio: '3:4' },
          }),
        },
      );
      if (resp.ok) {
        const json = (await resp.json()) as { predictions?: Array<{ bytesBase64Encoded?: string }> };
        const b64 = json?.predictions?.[0]?.bytesBase64Encoded;
        if (b64) {
          return { url: `data:image/png;base64,${b64}`, engine: 'gemini-imagen-3' };
        }
      }
    } catch {
      // Fallback cleanly to deterministic SVG fantasy synthesis
    }
  }
  return {
    url: generateSvgPortraitDataUri(promptText, style, character),
    engine: 'arcane-vector-synth',
  };
}
