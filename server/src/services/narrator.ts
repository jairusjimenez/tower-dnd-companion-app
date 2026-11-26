import { GoogleGenAI } from '@google/genai';
import type { GameState, SessionChronicleEntry } from '../../../shared';

export const TOWER_DRIVE_FOLDER_URL =
  'https://drive.google.com/drive/folders/1fY8URu1zmJKB6sKNtDza-V0fNsGdFRNW?usp=sharing';
export const TOWER_CHRONICLE_DOC_ID = '1uBWEitKlPfFP_Z5tmSYKqRzuForlwv1tgnnS6lyAK6U';
export const TOWER_CHRONICLE_DOC_URL =
  'https://docs.google.com/document/d/1uBWEitKlPfFP_Z5tmSYKqRzuForlwv1tgnnS6lyAK6U/edit';
export const DEFAULT_CHRONICLE_MODEL = 'gemini-4-hydrogen';

const DCC_SYSTEM_INSTRUCTION = `You are the Tower System AI and Literary LitRPG Narrator chronicling a live tabletop session of "The Tower" (D&D + Korean Manhwa Tower RPG).

STYLE & VOICE:
- Write like an unhinged, darkly hilarious, razor-sharp LitRPG novel chapter in the spirit of *Dungeon Crawler Carl* — vivid ensemble 3rd-person action prose punctuated by theatrical, unhinged, sarcastic Tower System AI callouts.
- Always refer to players as **Adventurers** (never "Climbers").
- Keep prose punchy, cinematic, and deeply readable (1,200–2,400 words). Use short scene headers (\`## Scene Title\`) to pace the chapter cleanly.
- Format every Tower System AI interruption as a Markdown blockquote starting with \`> \` so the Google Doc exporter turns it into a shaded System Box, e.g.:
  > **[NEW ACHIEVEMENT! Friendly Fire Enthusiast!]**
  > Congratulations on shooting your own teammate in the back of the head! That takes a special kind of situational blindness. Reward: Eternal shame and a slightly damp quiver.
  or \`> **[SYSTEM ANNOUNCEMENT]**\` / \`> **[LOOT ACQUIRED]**\`.

STRICT FACTUAL FIDELITY:
- ONLY narrate events, rolls, crits, misses, fumbles, spells, NPCs, loot, choices, and table notes present in the Session Chronicle or DM Director's Notes.
- NEVER invent character deaths, fake loot, fake spells, or made-up plot twists that did not happen.
- Dramatize the real numbers and moments (Nat 20s, Nat 1s, friendly fire, cover penalties, Parry/Block/Dodge clashes, Q&A decisions) faithfully and hilariously.`;

export function getSessionEntries(state: GameState, sessionNumber: number): SessionChronicleEntry[] {
  return (state.sessionChronicle || []).filter((e) => e.sessionNumber === sessionNumber);
}

export function formatSessionChronicleMarkdown(
  state: GameState,
  sessionNumber: number,
  directorNotes?: string,
): string {
  const entries = getSessionEntries(state, sessionNumber);
  const chars = Object.values(state.characters || {});
  const recap = (state.sessionRecaps || []).find((r) => r.sessionNumber === sessionNumber);
  const title = recap?.title || `Session #${sessionNumber}`;

  const lines: string[] = [
    `# ${title}`,
    `- **Campaign:** ${state.session?.title || 'Tower Campaign'}`,
    `- **Date:** ${(recap?.startedAt || new Date().toISOString()).slice(0, 10)}`,
    `- **Party:** ${chars.map((c) => `${c.name} (Lv ${c.level})`).join(', ') || 'No Adventurers'}`,
    '',
  ];

  if (directorNotes && directorNotes.trim()) {
    lines.push('## DM Director Notes', directorNotes.trim(), '');
  }

  lines.push('## Chronological Events');
  if (entries.length === 0) {
    lines.push('_No events recorded yet for this session._');
  } else {
    for (const e of entries) {
      const time = e.timestamp.slice(11, 19);
      const ctxTag = e.beatTitle ? `[${e.floor}F • ${e.beatTitle}]` : `[${e.floor}F]`;
      lines.push(`- \`${time}\` ${ctxTag} **(${e.category.toUpperCase()})** ${e.summary}`);
      if (e.details) lines.push(`  > ${e.details.replace(/\r?\n/g, ' ')}`);
    }
  }
  return lines.join('\n');
}

export async function generateLitRpgChapter({
  state,
  sessionNumber,
  directorNotes,
  model,
  mockGenerator,
}: {
  state: GameState;
  sessionNumber: number;
  directorNotes?: string;
  model?: string;
  mockGenerator?: (prompt: string, selectedModel: string) => Promise<string>;
}): Promise<{ narrative: string; modelUsed: string }> {
  const entries = getSessionEntries(state, sessionNumber);
  if (entries.length === 0 && !(directorNotes && directorNotes.trim())) {
    throw new Error(`Session #${sessionNumber} has no recorded events or DM notes yet.`);
  }

  const chars = Object.values(state.characters || {});
  const partyDossier = chars
    .map((c) => {
      const wep = c.equipment?.mainHand?.name || 'Unarmed';
      const passives = (c.passives || []).map((p) => p.name).slice(0, 5).join(', ') || 'None';
      return `- ${c.name}: Lv ${c.level} ${c.race || 'Human'} ${c.className || 'Adventurer'} | HP ${c.hp}/${c.maxHp} | Weapon: ${wep} | Passives: ${passives}`;
    })
    .join('\n');

  const logMd = formatSessionChronicleMarkdown(state, sessionNumber, directorNotes);
  const prompt = [
    'Write the LitRPG novel chapter for this Tower session.',
    '',
    '### Party Dossier',
    partyDossier || 'No registered Adventurers.',
    '',
    '### Session Chronicle Log',
    logMd,
  ].join('\n');

  const selectedModel = String(model || process.env.GEMINI_CHRONICLE_MODEL || DEFAULT_CHRONICLE_MODEL).trim();

  if (mockGenerator) {
    const narrative = await mockGenerator(prompt, selectedModel);
    return { narrative, modelUsed: selectedModel };
  }

  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const interaction = await ai.interactions.create({
    model: selectedModel,
    system_instruction: DCC_SYSTEM_INSTRUCTION,
    input: prompt,
    store: false,
  });

  const text = (interaction.output_text || '').trim();
  if (!text) {
    throw new Error('Gemini returned an empty narrative.');
  }
  return { narrative: text, modelUsed: selectedModel };
}

export async function exportChapterToGoogleDoc({
  sessionNumber,
  title,
  markdown,
  partyNames,
  date,
}: {
  sessionNumber: number;
  title: string;
  markdown: string;
  partyNames: string[];
  date?: string;
}): Promise<{ ok: boolean; docUrl: string; appendedBlocks?: number }> {
  const webhookUrl = (process.env.GOOGLE_DOC_WEBHOOK_URL || '').trim();
  const secret = (process.env.GOOGLE_DOC_WEBHOOK_SECRET || '').trim();
  if (!webhookUrl) {
    throw new Error('GOOGLE_DOC_WEBHOOK_URL is not configured on the server.');
  }
  if (!secret) {
    throw new Error('GOOGLE_DOC_WEBHOOK_SECRET is not configured on the server.');
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'follow',
    body: JSON.stringify({
      secret,
      docId: TOWER_CHRONICLE_DOC_ID,
      folderId: '1fY8URu1zmJKB6sKNtDza-V0fNsGdFRNW',
      sessionNumber,
      title,
      date: date || new Date().toISOString().slice(0, 10),
      partyNames,
      markdown,
    }),
  });

  const rawText = await res.text();
  let parsed: { ok?: boolean; error?: string; docUrl?: string; appendedBlocks?: number } = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Webhook returned non-JSON (${res.status}): ${rawText.slice(0, 140)}`);
  }

  if (!res.ok || !parsed.ok) {
    throw new Error(parsed.error || `Google Doc webhook failed with HTTP ${res.status}.`);
  }

  return {
    ok: true,
    docUrl: parsed.docUrl || TOWER_CHRONICLE_DOC_URL,
    appendedBlocks: parsed.appendedBlocks,
  };
}
