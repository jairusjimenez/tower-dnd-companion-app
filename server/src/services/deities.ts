import crypto from 'node:crypto';
import type { Deity } from '../../../shared';

export function extractGoogleDocId(url: string): string | null {
  const m = String(url || '').match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export function parseDeityTextIntoEntries(rawText: string, sourceDocUrl = ''): Deity[] {
  const blocks = String(rawText || '')
    .split(/\n{2,}|^---+$|^===+$/m)
    .map((b) => b.trim())
    .filter(Boolean);

  if (!blocks.length) return [];
  const parsed: Deity[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const name = lines[0].replace(/^#+\s*/, '').replace(/^Deity:\s*/i, '').trim();
    let domain = 'Cosmic / Tower Patron';
    let blessingName = 'Divine Resonance';
    let boonFormula = '+2 Damage';
    let rangeSpaces = 6;
    const descLines: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^domain:/i.test(line)) domain = line.replace(/^domain:/i, '').trim();
      else if (/^blessing:/i.test(line)) blessingName = line.replace(/^blessing:/i, '').trim();
      else if (/^boon:/i.test(line)) boonFormula = line.replace(/^boon:/i, '').trim();
      else if (/^range:/i.test(line)) rangeSpaces = Number(line.match(/\d+/)?.[0] || 6);
      else descLines.push(line);
    }

    parsed.push({
      id: `deity-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name: name.slice(0, 60),
      title: domain,
      domain,
      alignment: 'Constellation Patron',
      tenets: descLines.join(' ') || block,
      blessingName,
      blessingDescription: descLines.join(' ') || `Grants ${boonFormula} when invoked.`,
      boonFormula,
      miracleRangeSpaces: rangeSpaces,
      favorCost: 1,
      sourceDocUrl,
    });
  }
  return parsed.slice(0, 12);
}
