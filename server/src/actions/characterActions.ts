import crypto from 'node:crypto';
import {
  DEFAULT_STAT_MILESTONES,
  PASSIVE_SKILL_POOL,
  isStatsAndEquipmentLocked,
  type CharacterSkill,
  type PassiveTier,
} from '../../../shared';
import { generateCharacterArt } from '../services/art';
import {
  commitState,
  grantXpToCharacter,
  logPlayerHistory,
  pushSystemToast,
  recalculateCharacterAcAndDr,
  resolveAuthorizedCharacter,
  syncCharacterDerived,
} from '../services/gameHelpers';
import type { ActionRequestContext, ActionResult } from './types';

export function updateCharacterAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const { ch, error } = resolveAuthorizedCharacter(
    ctx,
    payload.characterId ? String(payload.characterId) : null,
    'edit',
  );
  if (error || !ch) return error!;

  const p = (payload.updates && typeof payload.updates === 'object' ? payload.updates : {}) as Record<string, unknown>;
  if (p.name !== undefined) ch.name = String(p.name).slice(0, 50);
  if (p.race !== undefined) ch.race = String(p.race).slice(0, 30);
  if (p.className !== undefined) ch.className = String(p.className).slice(0, 40);
  if (p.rank !== undefined) ch.rank = String(p.rank).slice(0, 20);
  if (p.level !== undefined) ch.level = Math.max(1, Math.min(99, Number(p.level) || 1));
  if (p.maxHp !== undefined) ch.maxHp = Math.max(1, Number(p.maxHp));
  if (p.hp !== undefined) ch.hp = Math.max(0, Math.min(ch.maxHp, Number(p.hp)));
  if (p.hpDelta !== undefined) ch.hp = Math.max(0, Math.min(ch.maxHp, ch.hp + Number(p.hpDelta)));
  if (p.tempHp !== undefined) ch.tempHp = Math.max(0, Number(p.tempHp));
  if (p.maxMp !== undefined) ch.maxMp = Math.max(0, Number(p.maxMp));
  if (p.mp !== undefined) ch.mp = Math.max(0, Math.min(ch.maxMp, Number(p.mp)));
  if (p.mpDelta !== undefined) ch.mp = Math.max(0, Math.min(ch.maxMp, ch.mp + Number(p.mpDelta)));
  if (p.ac !== undefined) ch.ac = Math.max(0, Number(p.ac));
  if (p.dr !== undefined) ch.dr = Math.max(0, Number(p.dr));
  if (p.speed !== undefined) ch.speed = Math.max(0, Number(p.speed));
  if (p.favor !== undefined) ch.favor = Math.max(0, Number(p.favor));
  if (p.inspiration !== undefined) ch.inspiration = Boolean(p.inspiration);
  if (p.stats && typeof p.stats === 'object') {
    ch.stats = { ...ch.stats };
    for (const [k, v] of Object.entries(p.stats as Record<string, unknown>)) {
      ch.stats[k.toUpperCase()] = Number(v || 0);
    }
  }
  if (Array.isArray(p.skills)) ch.skills = p.skills as CharacterSkill[];
  if (p.currency && typeof p.currency === 'object') ch.currency = { ...ch.currency, ...(p.currency as { gold?: number; manaStones?: number }) };
  if (Array.isArray(p.conditions)) ch.conditions = p.conditions as string[];
  if (p.notes !== undefined) ch.notes = String(p.notes);

  syncCharacterDerived(ctx, ch.id);
  commitState(ctx);
  return { ok: true, character: ch };
}

export function updateCharacterProfileAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const { ch, error } = resolveAuthorizedCharacter(
    ctx,
    payload.characterId ? String(payload.characterId) : null,
    'customize',
  );
  if (error || !ch) return error!;

  if (payload.name && String(payload.name).trim()) {
    ch.name = String(payload.name).trim().slice(0, 48);
  }
  if (payload.race !== undefined && String(payload.race).trim()) {
    ch.race = String(payload.race).trim().slice(0, 32);
  }
  if (payload.className !== undefined && String(payload.className).trim()) {
    ch.className = String(payload.className).trim().slice(0, 40);
  }
  logPlayerHistory(ctx.state, ch.id, 'character', `Created character: ${ch.name} (${ch.race} ${ch.className})`);
  syncCharacterDerived(ctx, ch.id);
  commitState(ctx);
  return { ok: true, character: ch };
}

export async function generateCharacterArtAction(
  ctx: ActionRequestContext,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  const { ch, error } = resolveAuthorizedCharacter(
    ctx,
    payload.characterId ? String(payload.characterId) : null,
    'generate art for',
  );
  if (error || !ch) return error!;

  if (payload.selectArtId) {
    const chosen = (ch.artHistory || []).find((a) => a.id === payload.selectArtId);
    if (!chosen) return { status: 404, error: 'Portrait entry not found.' };
    ch.portraitUrl = chosen.url;
    commitState(ctx);
    return { ok: true, portraitUrl: ch.portraitUrl, engine: chosen.engine || 'Selected', character: ch };
  }

  const uploadedRaw = payload.uploadedImageDataUrl;
  const hasUploadPayload = uploadedRaw !== undefined && uploadedRaw !== '';
  const isUpload =
    typeof uploadedRaw === 'string'
    && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(uploadedRaw)
    && uploadedRaw.length <= 450000;
  if (hasUploadPayload && !isUpload) {
    return {
      status: 400,
      error: 'Invalid or oversized portrait image (max ~330KB PNG, JPG, WebP, or GIF data URL).',
    };
  }

  const prompt = isUpload
    ? (ch.portraitPrompt || ch.name)
    : String(payload.prompt || ch.portraitPrompt || ch.name).trim().slice(0, 400);
  const style = isUpload
    ? 'Custom Upload'
    : String(payload.style || ch.portraitStyle || 'Korean Manhwa Webtoon');

  const generated = isUpload
    ? { url: uploadedRaw, engine: 'Uploaded Portrait' }
    : await generateCharacterArt(prompt, style, ch);

  if (!isUpload) {
    ch.portraitPrompt = prompt;
    ch.portraitStyle = style;
  }
  ch.portraitUrl = generated.url;
  ch.artHistory = (ch.artHistory || []).filter((a) => a.url !== generated.url);
  ch.artHistory.unshift({
    id: `art-${Date.now()}`,
    prompt: isUpload ? 'Uploaded Portrait' : prompt,
    style,
    engine: generated.engine,
    url: generated.url,
    createdAt: new Date().toISOString(),
  });
  ch.artHistory = ch.artHistory.slice(0, 8);
  logPlayerHistory(ctx.state, ch.id, 'art', `Updated character portrait (${generated.engine})`);

  commitState(ctx);
  return { ok: true, portraitUrl: ch.portraitUrl, engine: generated.engine, character: ch };
}

export function allocateStatAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const { ch, error } = resolveAuthorizedCharacter(
    ctx,
    payload.characterId ? String(payload.characterId) : null,
    'allocate points',
  );
  if (error || !ch) return error!;

  if (ctx.role !== 'dm' && isStatsAndEquipmentLocked(ctx.state)) {
    return { status: 403, error: 'Stats are locked while a session and story beat are active.' };
  }

  const statKey = String(payload.statKey || '').trim().toUpperCase();
  const rawAmount = Math.trunc(Number(payload.amount || 1));
  if (!statKey || rawAmount === 0) return { status: 400, error: 'Stat key and non-zero amount are required.' };

  const available = Number(ch.unspentStatPoints || 0);
  ch.stats = ch.stats || {};
  const currentVal = Number(ch.stats[statKey] || 0);

  if (rawAmount > 0) {
    if (available < rawAmount) return { status: 400, error: 'Not enough unspent stat points.' };
    ch.stats[statKey] = currentVal + rawAmount;
    ch.unspentStatPoints = available - rawAmount;
    logPlayerHistory(ctx.state, ch.id, 'stat', `Allocated +${rawAmount} ${statKey} (now ${ch.stats[statKey]})`);
  } else {
    const refund = Math.abs(rawAmount);
    if (currentVal - refund < 1) return { status: 400, error: `${statKey} cannot go below 1.` };
    const milestones = ctx.state.mechanics?.statMilestones || DEFAULT_STAT_MILESTONES;
    const awakeningSet = new Set(ch.awakenings || []);
    const lockedThreshold = milestones
      .filter((ms) => awakeningSet.has(ms.id) && ms.statKey === statKey)
      .reduce((maxT, ms) => Math.max(maxT, Number(ms.threshold || 0)), 0);
    if (lockedThreshold > 0 && currentVal - refund < lockedThreshold) {
      return {
        status: 400,
        error: `Cannot reduce ${statKey} below ${lockedThreshold} after unlocking its Stat Awakening.`,
      };
    }
    ch.stats[statKey] = currentVal - refund;
    ch.unspentStatPoints = available + refund;
    logPlayerHistory(ctx.state, ch.id, 'stat', `Removed -${refund} ${statKey} (now ${ch.stats[statKey]})`);
  }

  recalculateCharacterAcAndDr(ctx.state, ch);
  syncCharacterDerived(ctx, ch.id);
  commitState(ctx);
  return { ok: true, character: ch };
}

export function rollPassiveGachaAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const { ch, error } = resolveAuthorizedCharacter(
    ctx,
    payload.characterId ? String(payload.characterId) : null,
    'draw passives',
  );
  if (error || !ch) return error!;

  const tickets = Number(ch.passiveTickets || 0);
  if (tickets < 1) {
    return { status: 400, error: 'No Passive Skill Tickets available. Level up to earn a ticket!' };
  }
  if (ch.pendingPassiveDraw) {
    return { status: 400, error: 'Resolve your current Passive Skill Lottery draw first.' };
  }

  ch.passiveTickets = tickets - 1;
  ch.passives = ch.passives || [];

  const roll = crypto.randomInt(0, 1000);
  const tier: PassiveTier =
    roll < 5
      ? 'Mythic'
      : roll < 20
        ? 'Legendary'
        : roll < 50
          ? 'Super Super Rare'
          : roll < 110
            ? 'Super Rare'
            : roll < 230
              ? 'Rare'
              : roll < 450
                ? 'Advanced'
                : 'Normal';

  const tierPool = PASSIVE_SKILL_POOL.filter((p) => p.tier === tier);
  const picked = tierPool[crypto.randomInt(0, tierPool.length)];
  const existing = ch.passives.find((p) => p.id === picked.id);

  const floorLevel = Math.max(1, Number(ch.currentFloor || ctx.state.map?.currentFloor || 1));
  const tierMult = ({ Normal: 1, Advanced: 1.5, Rare: 2.2, 'Super Rare': 3, 'Super Super Rare': 4, Legendary: 6, Mythic: 10 } as Record<string, number>)[tier] || 1;
  const declineGold = Math.round(25 * floorLevel * tierMult);
  const declineXp = Math.round(20 * floorLevel * tierMult);

  const nextStacks = existing ? Number(existing.stacks || 1) + 1 : 1;
  const extraPct = existing ? 40 + (nextStacks - 1) * 10 : 0;
  const multiplierPct = existing ? 100 + extraPct : 100;

  ch.pendingPassiveDraw = {
    id: `pdraw-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
    tier,
    skill: picked,
    duplicate: Boolean(existing),
    nextStacks,
    extraPct,
    multiplierPct,
    floorLevel,
    declineGold,
    declineXp,
  };

  commitState(ctx);
  return {
    ok: true,
    pending: true,
    tier,
    skill: picked,
    duplicate: Boolean(existing),
    nextStacks,
    extraPct,
    multiplierPct,
    floorLevel,
    declineGold,
    declineXp,
    character: ch,
  };
}

export function resolvePassiveGachaAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const { ch, error } = resolveAuthorizedCharacter(
    ctx,
    payload.characterId ? String(payload.characterId) : null,
    'resolve a passive draw',
  );
  if (error || !ch) return error!;

  const draw = ch.pendingPassiveDraw;
  if (!draw) return { status: 400, error: 'No pending passive skill draw to resolve.' };
  ch.pendingPassiveDraw = null;

  if (payload.decision === 'decline') {
    ch.currency = ch.currency || { gold: 0, manaStones: 0 };
    ch.currency.gold = Number(ch.currency.gold || 0) + Number(draw.declineGold || 0);
    const xpOutcome = grantXpToCharacter(ctx.state, ch, Number(draw.declineXp || 0));
    logPlayerHistory(
      ctx.state,
      ch.id,
      'passive_gacha',
      `Declined ${draw.tier} Passive (${draw.skill.name}) -> +${draw.declineGold} Gold & +${draw.declineXp} XP (Floor ${draw.floorLevel})`,
    );
    commitState(ctx);
    return {
      ok: true,
      decision: 'decline',
      tier: draw.tier,
      skill: draw.skill,
      goldGained: draw.declineGold,
      xpGained: draw.declineXp,
      xpOutcome,
      character: ch,
    };
  }

  ch.passives = ch.passives || [];
  const picked = draw.skill;
  const tier = draw.tier;
  const existing = ch.passives.find((p) => p.id === picked.id);

  const bonusFields: Array<[keyof typeof picked, keyof typeof ch, (keyof typeof ch) | null]> = [
    ['bonusHp', 'maxHp', 'hp'],
    ['bonusMp', 'maxMp', 'mp'],
    ['bonusAc', 'ac', null],
    ['bonusDr', 'dr', null],
    ['bonusSpeedSpaces', 'speedSpaces', null],
  ];

  if (existing) {
    const prevMult = Number(existing.multiplierPct || 100);
    existing.stacks = Number(existing.stacks || 1) + 1;
    const extraPct = 40 + (existing.stacks - 1) * 10;
    const nextMult = 100 + extraPct;
    existing.multiplierPct = nextMult;
    existing.lastUpgradedAt = new Date().toISOString();

    for (const [field, statProp, currentProp] of bonusFields) {
      const base = Number(picked[field] || 0);
      if (!base) continue;
      const prevVal = Math.round(base * (prevMult / 100));
      const nextVal = Math.round(base * (nextMult / 100));
      const diff = nextVal - prevVal;
      if (diff !== 0) {
        (ch[statProp] as number) = Number(ch[statProp] || 0) + diff;
        if (currentProp) (ch[currentProp] as number) = Number(ch[currentProp] || 0) + diff;
      }
    }

    logPlayerHistory(ctx.state, ch.id, 'passive_gacha', `Upgraded ${tier} Passive ${picked.name} to ×${existing.stacks} (${nextMult}% effect, +${extraPct}%)`);
    pushSystemToast(ctx, {
      title: `PASSIVE UPGRADED (×${existing.stacks})!`,
      message: `${ch.name} drew duplicate ${picked.name} [${tier}] -> ${nextMult}% effect (+${extraPct}%)!`,
      category: ['Mythic', 'Legendary', 'Super Super Rare', 'Super Rare'].includes(tier) ? 'loot' : 'system',
      target: ch.id,
    });
    syncCharacterDerived(ctx, ch.id);
    commitState(ctx);
    return { ok: true, decision: 'accept', duplicate: true, tier, skill: existing, extraPct, multiplierPct: nextMult, character: ch };
  }

  const acquired = {
    ...picked,
    stacks: 1,
    multiplierPct: 100,
    acquiredAt: new Date().toISOString(),
    levelAcquired: ch.level,
  };
  ch.passives.push(acquired);
  for (const [field, statProp, currentProp] of bonusFields) {
    const base = Number(picked[field] || 0);
    if (!base) continue;
    (ch[statProp] as number) = Number(ch[statProp] || 0) + base;
    if (currentProp) (ch[currentProp] as number) = Number(ch[currentProp] || 0) + base;
  }

  logPlayerHistory(ctx.state, ch.id, 'passive_gacha', `Unlocked ${tier} Passive: ${picked.name} (${picked.description})`);
  pushSystemToast(ctx, {
    title: `${tier.toUpperCase()} PASSIVE UNLOCKED!`,
    message: `${ch.name} drew ${picked.name} [${tier}]: ${picked.description}`,
    category: ['Mythic', 'Legendary', 'Super Super Rare', 'Super Rare'].includes(tier) ? 'loot' : 'system',
    target: ch.id,
  });
  syncCharacterDerived(ctx, ch.id);
  commitState(ctx);
  return { ok: true, decision: 'accept', duplicate: false, tier, skill: acquired, multiplierPct: 100, character: ch };
}

export function levelUpAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const { ch, error } = resolveAuthorizedCharacter(
    ctx,
    payload.characterId ? String(payload.characterId) : null,
    'level up',
  );
  if (error || !ch) return error!;

  ch.level = Math.max(1, Number(ch.level || 1));
  ch.xp = Number(ch.xp || 0);
  const xpToNext = Number(ch.xpToNext || ch.level * 100);
  if (ch.xp < xpToNext) {
    return { status: 400, error: `Not enough XP to level up (${ch.xp}/${xpToNext} XP).` };
  }

  ch.xp -= xpToNext;
  ch.level += 1;
  ch.xpToNext = ch.level * 100;
  ch.unspentStatPoints = Number(ch.unspentStatPoints || 0) + 2;
  ch.passiveTickets = Number(ch.passiveTickets || 0) + 1;
  logPlayerHistory(ctx.state, ch.id, 'xp', `Leveled up to Level ${ch.level} (+2 Stat Pts, +1 Passive Ticket)!`);
  commitState(ctx);

  return {
    ok: true,
    outcome: {
      level: ch.level,
      xp: ch.xp,
      xpToNext: ch.xpToNext,
      unspentStatPoints: ch.unspentStatPoints,
      passiveTickets: ch.passiveTickets,
    },
    character: ch,
  };
}

export function grantXpAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can grant XP.' };
  const targetIds = payload.characterId && payload.characterId !== 'all'
    ? [String(payload.characterId)]
    : Object.keys(ctx.state.characters);
  const xpAmt = Math.max(1, Math.round(Number(payload.xp || 50)));
  const outcomes: Record<string, unknown> = {};
  for (const cid of targetIds) {
    const ch = ctx.state.characters[cid];
    if (!ch) continue;
    outcomes[cid] = grantXpToCharacter(ctx.state, ch, xpAmt);
  }
  commitState(ctx);
  return { ok: true, outcomes };
}
