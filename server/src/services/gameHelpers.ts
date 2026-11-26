import crypto from 'node:crypto';
import {
  BALANCE,
  DEFAULT_STAT_MILESTONES,
  BUILDING_BLUEPRINTS,
  UNIT_EFFECT_META,
  VALID_FLOOR_THEME_IDS,
  computeActiveEffectModifiers,
  computeCharacterMoveSpaces,
  computePassiveModifiers,
  getFloorThemeLabel,
  getPartyFloor,
  xpToNextForLevel,
  computeStatModifier,
  getEquippedTotals,
  type ActiveUnitEffect,
  type ArenaFxEvent,
  type BeatArena,
  type Character,
  type EquipmentSlot,
  type FloorConfig,
  type GameState,
  type InventoryItem,
  type Monster,
  type SessionChronicleEntry,
  type StoryBeat,
  type ToastMessage,
  type UnitEffectSpec,
} from '../../../shared';
import type { ActionRequestContext } from '../actions/types';
import { generateSvgPortraitDataUri } from './art';
import { rollSingleDie } from './dice';

const VALID_BIOME_THEMES = VALID_FLOOR_THEME_IDS;

export function defaultThemeForFloor(n: number): string {
  return n === 1 ? 'forest' : n === 2 ? 'desert' : n === 3 ? 'underworld' : n === 4 ? 'frost' : 'obsidian';
}

export function getFloorCenterRow(state: GameState, floorNum: number): number {
  const floor = state.map.floors.find((f) => Number(f.number) === Number(floorNum));
  if (!floor) return Math.max(0, state.map.rows - 3);
  return Math.floor((floor.rowStart + floor.rowEnd) / 2);
}

export function pushSystemToast(
  ctx: { state: GameState; sseHub: ActionRequestContext['sseHub'] },
  {
    title,
    message,
    category = 'info',
    target = 'all',
    sender = 'SYSTEM / DM',
    isDmBroadcast = false,
  }: { title?: string; message: string; category?: string; target?: string; sender?: string; isDmBroadcast?: boolean },
): ToastMessage {
  const rawMsg = String(message || '').trim();
  const formattedMsg = /^SYSTEM:/i.test(rawMsg) ? rawMsg : `SYSTEM: ${rawMsg}`;
  const entry: ToastMessage = {
    id: `sys-${Date.now()}-${crypto.randomInt(100, 999)}`,
    timestamp: new Date().toISOString(),
    category,
    title: String(title || 'SYSTEM NOTICE').slice(0, 80),
    message: formattedMsg.slice(0, 500),
    target: target || 'all',
    sender,
    ...(isDmBroadcast ? { isDmBroadcast: true } : {}),
  };
  ctx.state.systemMessages.unshift(entry);
  ctx.state.systemMessages = ctx.state.systemMessages.slice(0, 40);
  ctx.sseHub.broadcast('toast', entry);
  return entry;
}

export function logPlayerHistory(state: GameState, charId: string | null, category: string, summary: string) {
  state.playerHistory = state.playerHistory || [];
  const ch = charId ? state.characters[charId] : null;
  const entry = {
    id: `ph-${Date.now()}-${crypto.randomInt(100, 999)}`,
    timestamp: new Date().toISOString(),
    characterId: charId || null,
    characterName: ch ? ch.name : 'Party',
    category: String(category || 'event'),
    summary: String(summary || '').slice(0, 260),
  };
  state.playerHistory.unshift(entry);
  state.playerHistory = state.playerHistory.slice(0, 200);
  if (ch) {
    ch.history = ch.history || [];
    ch.history.unshift(entry);
    ch.history = ch.history.slice(0, 60);
  }
  return entry;
}

export function commitState(ctx: ActionRequestContext): void {
  ctx.state.version = Number(ctx.state.version || 0) + 1;
  ctx.repo.save(ctx.state);
  ctx.sseHub.broadcast('state');
}

export function resolveAuthorizedCharacter(
  ctx: ActionRequestContext,
  requestedCharId?: string | null,
  actionLabel = 'perform this action',
): { ch?: Character; error?: { status: number; error: string } } {
  const targetId = requestedCharId || ctx.characterId;
  const ch = targetId ? ctx.state.characters[targetId] : undefined;
  if (!ch) return { error: { status: 404, error: 'Character not found.' } };
  if (ctx.role !== 'dm' && ctx.characterId && ctx.characterId !== ch.id) {
    return { error: { status: 403, error: `Players can only ${actionLabel} on their own character.` } };
  }
  return { ch };
}

export function createInventoryItem(spec: Partial<InventoryItem> & { name: string }): InventoryItem {
  const category = String(spec.category || 'relic');
  const defaultSlot: EquipmentSlot = category === 'weapon' ? 'mainHand' : category === 'armor' ? 'body' : 'relic';
  return {
    id: `inv-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
    name: String(spec.name).slice(0, 80),
    category,
    qty: Math.max(1, Number(spec.qty || 1)),
    healHp: Number(spec.healHp || 0),
    healMp: Number(spec.healMp || 0),
    ...(Number(spec.grantXp || 0) > 0 ? { grantXp: Math.max(0, Number(spec.grantXp)) } : {}),
    slot: (spec.slot ?? defaultSlot) as EquipmentSlot | '',
    attackBonus: Number(spec.attackBonus || 0),
    damageDice: String(spec.damageDice || ''),
    damageType: String(spec.damageType || 'Physical'),
    rangeSpaces: Number(spec.rangeSpaces || 2),
    drBonus: Number(spec.drBonus || 0),
    acBonus: Number(spec.acBonus || 0),
    ...(spec.artUrl ? { artUrl: spec.artUrl } : {}),
    notes: String(spec.notes || ''),
  };
}

export function grantXpToCharacter(state: GameState, ch: Character, xpAmount: number) {
  const gained = Math.max(0, Math.round(Number(xpAmount || 0)));
  ch.level = Math.max(1, Number(ch.level || 1));
  ch.xp = Number(ch.xp || 0) + gained;
  ch.xpToNext = Number(ch.xpToNext || xpToNextForLevel(ch.level));
  ch.unspentStatPoints = Number(ch.unspentStatPoints || 0);
  ch.passiveTickets = Number(ch.passiveTickets || 0);

  if (gained > 0) {
    logPlayerHistory(state, ch.id, 'xp', `Gained +${gained} XP (${ch.xp}/${ch.xpToNext} XP)`);
  }
  return {
    gained,
    levelsGained: 0,
    level: ch.level,
    xp: ch.xp,
    xpToNext: ch.xpToNext,
    unspentStatPoints: ch.unspentStatPoints,
    passiveTickets: ch.passiveTickets,
  };
}

export function removeMonsterTokensFromMaps(state: GameState, monsterId: string): void {
  if (!monsterId) return;
  if (state.map?.tokens) {
    state.map.tokens = state.map.tokens.filter((t) => t.id !== monsterId);
  }
  for (const b of state.storyBeats || []) {
    if (b.arena?.tokens) {
      b.arena.tokens = b.arena.tokens.filter((t) => t.id !== monsterId);
    }
  }
}

export function resetArenaTurnFlags(state: GameState, targetIds?: string[] | null): void {
  const idSet = targetIds && targetIds.length ? new Set(targetIds.filter(Boolean)) : null;
  for (const b of state.storyBeats || []) {
    for (const t of b.arena?.tokens || []) {
      if (!idSet || idSet.has(t.id)) {
        t.hasMovedThisTurn = false;
        t.hasObservedThisTurn = false;
        t.hasUsedConsumableThisTurn = false;
        t.hasCastSpellThisTurn = false;
        t.attacksUsedThisTurn = 0;
      }
    }
  }
}

export function clampArenaEntitiesToBounds(arena: BeatArena, cols: number, rows: number): void {
  arena.cols = cols;
  arena.rows = rows;
  for (const tok of arena.tokens || []) {
    tok.x = Math.max(0, Math.min(cols - 1, tok.x));
    tok.y = Math.max(0, Math.min(rows - 1, tok.y));
  }
  for (const ch of arena.chests || []) {
    ch.x = Math.max(0, Math.min(cols - 1, ch.x));
    ch.y = Math.max(0, Math.min(rows - 1, ch.y));
  }
  arena.terrain = (arena.terrain || []).filter((t) => t.x < cols && t.y < rows);
}

export function pushNewFloorToTowerMap(
  state: GameState,
  opts: { title?: string; theme?: string; safeZone?: boolean; description?: string; startFogged?: boolean } = {},
): FloorConfig {
  const nextNum = state.map.floors.reduce((m, f) => Math.max(m, f.number), 0) + 1;
  for (const f of state.map.floors) {
    f.rowStart += 5;
    f.rowEnd += 5;
    f.portalRow += 5;
  }
  for (const t of state.map.tokens) t.y += 5;
  state.map.fog = state.map.fog.map((k) => {
    const [x, y] = k.split(',').map(Number);
    return `${x},${y + 5}`;
  });
  state.map.rows += 5;
  const floorTheme = opts.theme && VALID_BIOME_THEMES.includes(opts.theme) ? opts.theme : defaultThemeForFloor(nextNum);
  const newFloor: FloorConfig = {
    number: nextNum,
    title: String(opts.title || `${nextNum}F • ${getFloorThemeLabel(floorTheme)}`).slice(0, 60),
    theme: floorTheme,
    rowStart: 0,
    rowEnd: 4,
    safeZone: Boolean(opts.safeZone),
    portalRow: 4,
    portalCol: 5,
    description: String(opts.description || `Floor ${nextNum} of the Tower.`),
  };
  state.map.floors.unshift(newFloor);
  if (opts.startFogged) {
    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x < state.map.cols; x++) state.map.fog.push(`${x},${y}`);
    }
  }
  return newFloor;
}

export function recalculateCharacterAcAndDr(state: GameState, ch: Character): void {
  const totals = getEquippedTotals(ch);
  const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
  const pMods = computePassiveModifiers(ch);

  const milestones = state.mechanics?.statMilestones || DEFAULT_STAT_MILESTONES;
  const awakeningSet = new Set(ch.awakenings || []);
  let awkAc = 0;
  let awkDr = 0;
  for (const ms of milestones) {
    if (awakeningSet.has(ms.id)) {
      awkAc += Number(ms.bonusAc || 0);
      awkDr += Number(ms.bonusDr || 0);
    }
  }

  const tempDr = Number(ch.combatPassiveFlags?.tempDrBonus || 0);
  const effMods = computeActiveEffectModifiers(ch.activeEffects);
  ch.ac = Math.max(1, 10 + Math.max(0, computeStatModifier(agiScore, state.mechanics, ch)) + totals.armorAc + pMods.bonusAc + awkAc + effMods.acDelta);
  ch.dr = Math.max(0, totals.armorDr + pMods.bonusDr + awkDr + tempDr + effMods.drDelta);
  const moveInfo = computeCharacterMoveSpaces({
    agi: agiScore,
    floor: getPartyFloor(state),
    passiveSpeedBonus: pMods.bonusSpeedSpaces,
    effectSpeedDelta: effMods.speedDelta,
  });
  ch.speedSpaces = moveInfo.total;
  ch.speed = moveInfo.total * 5;
}

export function applyGoldBonus(ch: Character, baseGold: number, isChest = false): number {
  if (baseGold <= 0) return 0;
  const mods = computePassiveModifiers(ch);
  const pct = Number(mods.bonusGoldPct || 0);
  const extraChest = isChest ? Number(mods.chestBonusGold || 0) : 0;
  return Math.max(0, Math.round(baseGold * (1 + pct / 100)) + extraChest);
}

export function resetCombatPassiveFlags(state: GameState): void {
  for (const ch of Object.values(state.characters || {})) {
    ch.combatPassiveFlags = {};
    recalculateCharacterAcAndDr(state, ch);
  }
}

export function triggerStartOfTurnPassives(ctx: ActionRequestContext, charId: string): void {
  const ch = ctx.state.characters[charId];
  if (!ch) return;
  ch.combatPassiveFlags = ch.combatPassiveFlags || {};
  ch.combatPassiveFlags.hitsTakenThisRound = 0;
  ch.combatPassiveFlags.tempDrBonus = 0;
  if ((ch.combatPassiveFlags.undyingLegendRounds || 0) > 0) {
    ch.combatPassiveFlags.undyingLegendRounds = Math.max(0, (ch.combatPassiveFlags.undyingLegendRounds || 0) - 1);
  }
  recalculateCharacterAcAndDr(ctx.state, ch);

  if (ch.hp <= 0) return;
  const mods = computePassiveModifiers(ch);
  const hpGain = Number(mods.hpRegenPerTurn || 0);
  const mpGain = Number(mods.mpRegenPerTurn || 0);
  if (hpGain > 0 || mpGain > 0) {
    const prevHp = ch.hp;
    const prevMp = ch.mp;
    if (hpGain > 0) ch.hp = Math.min(ch.maxHp, ch.hp + hpGain);
    if (mpGain > 0) ch.mp = Math.min(ch.maxMp, ch.mp + mpGain);
    const dHp = ch.hp - prevHp;
    const dMp = ch.mp - prevMp;
    if (dHp > 0 || dMp > 0) {
      syncCharacterDerived(ctx, ch.id);
      pushSystemToast(ctx, {
        title: 'PASSIVE REGENERATION',
        message: `${ch.name} regenerated${dHp > 0 ? ` +${dHp} HP` : ''}${dMp > 0 ? ` +${dMp} MP` : ''} at turn start.`,
        category: 'info',
        target: ch.id,
      });
    }
  }
}

export function getAllyAuraBonuses(state: GameState, targetChar: Character): { hitBonus: number; dmgBonus: number; acBonus: number; drBonus: number } {
  let hitBonus = 0;
  let dmgBonus = 0;
  let acBonus = 0;
  let drBonus = 0;
  const activeBeat = (state.storyBeats || []).find((b) => b.presented && b.status === 'active');
  const tokens = activeBeat?.arena?.tokens || [];
  const myTok = tokens.find((t) => t.id === targetChar.id);
  if (!myTok) return { hitBonus, dmgBonus, acBonus, drBonus };

  for (const ally of Object.values(state.characters || {})) {
    if (ally.id === targetChar.id || ally.hp <= 0) continue;
    const allyTok = tokens.find((t) => t.id === ally.id);
    if (!allyTok) continue;
    const dist = Math.max(Math.abs(allyTok.x - myTok.x), Math.abs(allyTok.y - myTok.y));
    const allyMods = computePassiveModifiers(ally);
    if (dist <= 3) {
      hitBonus += allyMods.auraAllyHitBonus;
      dmgBonus += allyMods.auraAllyDmgBonus;
    }
    if (dist <= 2 && allyMods.auraAllyAcDr > 0) {
      acBonus += allyMods.auraAllyAcDr;
      drBonus += allyMods.auraAllyAcDr;
    }
  }
  return { hitBonus, dmgBonus, acBonus, drBonus };
}

export function applyIncomingDamageToCharacter(
  ctx: ActionRequestContext,
  ch: Character,
  rawIncoming: number,
  opts: { attackerMonster?: Monster | null; damageType?: string; isCrit?: boolean; isSpell?: boolean; halveAfterDr?: boolean; mitigationPct?: number } = {},
): { dmgTaken: number; reflectedDamage: number; evaded: boolean; notes: string[] } {
  const mods = computePassiveModifiers(ch);
  ch.combatPassiveFlags = ch.combatPassiveFlags || {};
  const notes: string[] = [];
  let reflectedDamage = 0;

  if (!opts.isSpell && mods.evasionPct > 0 && crypto.randomInt(1, 101) <= mods.evasionPct) {
    notes.push(`Evaded (${mods.evasionPct}% Evasion)`);
    return { dmgTaken: 0, reflectedDamage: 0, evaded: true, notes };
  }

  if (mods.reflectOneAttackPerCombat && !ch.combatPassiveFlags.divineMirrorUsedThisCombat) {
    ch.combatPassiveFlags.divineMirrorUsedThisCombat = true;
    reflectedDamage = Math.max(1, Math.round(rawIncoming));
    if (opts.attackerMonster) {
      opts.attackerMonster.hp = Math.max(0, Number(opts.attackerMonster.hp ?? 0) - reflectedDamage);
      syncMonsterDerived(ctx, opts.attackerMonster.id);
      if (opts.attackerMonster.hp <= 0) removeMonsterTokensFromMaps(ctx.state, opts.attackerMonster.id);
    }
    notes.push(`Divine Mirror reflected ${reflectedDamage} dmg!`);
    return { dmgTaken: 0, reflectedDamage, evaded: false, notes };
  }

  const dmgType = opts.damageType || 'Physical';
  const aura = getAllyAuraBonuses(ctx.state, ch);
  let effectiveDr = Number(ch.dr || 0) + aura.drBonus;
  if (mods.adaptiveWardDr > 0 && ch.combatPassiveFlags.lastDamageType === dmgType) {
    effectiveDr += mods.adaptiveWardDr;
    notes.push(`Adaptive Ward +${mods.adaptiveWardDr} DR`);
  }
  if (opts.isCrit && mods.critDamageReduction > 0) effectiveDr += mods.critDamageReduction;
  if (opts.isSpell && mods.spellDmgResist > 0) effectiveDr += mods.spellDmgResist;
  if (/slash/i.test(dmgType) && mods.slashingResist > 0) effectiveDr += mods.slashingResist;
  for (const [el, val] of Object.entries(mods.elementalResists)) {
    if (dmgType.toLowerCase().includes(el.toLowerCase())) effectiveDr += val;
  }
  if (/fire|water|ice|earth|wind|light|dark/i.test(dmgType) && mods.allElementalResist > 0) {
    effectiveDr += mods.allElementalResist;
  }

  let dmgTaken = Math.max(1, Math.round(rawIncoming) - effectiveDr);
  if (opts.mitigationPct && opts.mitigationPct > 0) {
    const clampedMit = Math.max(0, Math.min(95, opts.mitigationPct));
    dmgTaken = Math.max(0, Math.round(dmgTaken * (1 - clampedMit / 100)));
  } else if (opts.halveAfterDr) {
    dmgTaken = Math.max(1, Math.floor(dmgTaken / 2));
  }

  const hitCount = Number(ch.combatPassiveFlags.hitsTakenThisRound || 0);
  ch.combatPassiveFlags.hitsTakenThisRound = hitCount + 1;
  if (hitCount === 0 && mods.firstHitHalved) {
    dmgTaken = Math.max(1, Math.floor(dmgTaken / 2));
    notes.push('Absolute Defense (50% halved)');
  }
  ch.combatPassiveFlags.lastDamageType = dmgType;

  if (mods.reflectDamageOnHit > 0 && opts.attackerMonster) {
    reflectedDamage += mods.reflectDamageOnHit;
    opts.attackerMonster.hp = Math.max(0, Number(opts.attackerMonster.hp ?? 0) - mods.reflectDamageOnHit);
    syncMonsterDerived(ctx, opts.attackerMonster.id);
    if (opts.attackerMonster.hp <= 0) removeMonsterTokensFromMaps(ctx.state, opts.attackerMonster.id);
    notes.push(`Reflective Carapace (${mods.reflectDamageOnHit} dmg)`);
  }

  let nextHp = ch.hp - dmgTaken;
  if ((ch.combatPassiveFlags.undyingLegendRounds || 0) > 0 && nextHp < 1) {
    nextHp = 1;
    notes.push('Undying Legend (1 HP floor)');
  } else if (nextHp <= 0) {
    if (mods.undyingLegendPerCombat && !ch.combatPassiveFlags.undyingLegendUsedThisCombat) {
      ch.combatPassiveFlags.undyingLegendUsedThisCombat = true;
      ch.combatPassiveFlags.undyingLegendRounds = 1;
      nextHp = 1;
      notes.push('Undying Legend triggered! (1 HP for 1 round)');
    } else if (mods.surviveFatalPerCombat && !ch.combatPassiveFlags.survivedFatalThisCombat) {
      ch.combatPassiveFlags.survivedFatalThisCombat = true;
      nextHp = 1;
      notes.push('Undying Will survived at 1 HP!');
    } else if (mods.revivePerCombatPct > 0 && !ch.combatPassiveFlags.revivedThisCombat) {
      ch.combatPassiveFlags.revivedThisCombat = true;
      nextHp = Math.max(1, Math.round((ch.maxHp * mods.revivePerCombatPct) / 100));
      if (mods.reviveMpAlso) {
        ch.mp = ch.maxMp;
      }
      notes.push(`Revived at ${mods.revivePerCombatPct}% HP${mods.reviveMpAlso ? ' & 100% MP' : ''}!`);
      pushSystemToast(ctx, {
        title: 'PASSIVE REVIVAL!',
        message: `${ch.name} revived with ${nextHp} HP${mods.reviveMpAlso ? ` & ${ch.mp} MP` : ''}!`,
        category: 'loot',
        target: ch.id,
      });
    }
  }

  ch.hp = Math.max(0, nextHp);
  syncCharacterDerived(ctx, ch.id);
  return { dmgTaken, reflectedDamage, evaded: false, notes };
}

export function syncCharacterDerived(ctx: ActionRequestContext, charId: string): void {
  const ch = ctx.state.characters[charId];
  if (!ch) return;
  const milestones = ctx.state.mechanics?.statMilestones || DEFAULT_STAT_MILESTONES;
  ch.awakenings = ch.awakenings || [];
  ch.skills = ch.skills || [];

  for (const ms of milestones) {
    const score = Number(ch.stats?.[ms.statKey] || 0);
    if (score >= Number(ms.threshold || 20) && !ch.awakenings.includes(ms.id)) {
      ch.awakenings.push(ms.id);
      if (ms.bonusHp) {
        ch.maxHp = Number(ch.maxHp || 0) + Number(ms.bonusHp);
        ch.hp = Number(ch.hp || 0) + Number(ms.bonusHp);
      }
      if (ms.bonusMp) {
        ch.maxMp = Number(ch.maxMp || 0) + Number(ms.bonusMp);
        ch.mp = Number(ch.mp || 0) + Number(ms.bonusMp);
      }
      if (ms.bonusAc) ch.ac = Number(ch.ac || 10) + Number(ms.bonusAc);
      if (ms.bonusDr) ch.dr = Number(ch.dr || 0) + Number(ms.bonusDr);
      if (!ch.skills.some((s) => s.name === ms.abilityName)) {
        ch.skills.push({
          id: `awk-${ms.id}`,
          name: ms.abilityName,
          rank: 'Awakened',
          mpCost: 0,
          cooldown: 'Passive / 1/Turn',
          description: ms.description,
          unlockedByStat: `${ms.statKey} ${ms.threshold}`,
        });
      }
      pushSystemToast(ctx, {
        title: `STAT AWAKENING: ${ms.abilityName.toUpperCase()}`,
        message: `${ch.name} reached ${ms.statKey} ${ms.threshold} and unlocked ${ms.abilityName}! (${ms.description})`,
        category: 'loot',
        target: ch.id,
      });
      logPlayerHistory(ctx.state, ch.id, 'awakening', `Unlocked ${ms.abilityName} (${ms.statKey} ${ms.threshold})`);
    }
  }

  const tok = ctx.state.map.tokens.find((t) => t.id === charId);
  if (tok) {
    tok.name = ch.name.split(' ')[0];
    tok.hp = ch.hp;
    tok.maxHp = ch.maxHp;
  }
  for (const beat of ctx.state.storyBeats || []) {
    const btok = beat.arena?.tokens?.find((t) => t.id === charId);
    if (btok) {
      btok.name = ch.name.split(' ')[0];
      btok.hp = ch.hp;
      btok.maxHp = ch.maxHp;
    }
  }
  const cbIdx = ctx.state.combat.combatants.findIndex((c) => c.id === charId);
  if (ch.hp <= 0) {
    if (cbIdx >= 0) {
      ctx.state.combat.combatants.splice(cbIdx, 1);
      if (ctx.state.combat.combatants.length === 0) {
        ctx.state.combat.turnIndex = 0;
      } else if (cbIdx < ctx.state.combat.turnIndex) {
        ctx.state.combat.turnIndex = Math.max(0, ctx.state.combat.turnIndex - 1);
      } else if (ctx.state.combat.turnIndex >= ctx.state.combat.combatants.length) {
        ctx.state.combat.turnIndex = 0;
      }
      pushSystemToast(ctx, {
        title: 'YOU HAVE DIED',
        message: `${ch.name} has fallen and was removed from turn order.`,
        category: 'combat',
        target: ch.id,
      });
    }
    ctx.state.pendingReactions = (ctx.state.pendingReactions || []).filter(
      (r) => r.targetCharacterId !== charId,
    );
  } else if (cbIdx >= 0) {
    const cb = ctx.state.combat.combatants[cbIdx];
    cb.name = ch.name;
    cb.hp = ch.hp;
    cb.maxHp = ch.maxHp;
    cb.ac = ch.ac;
  }
}

export function syncMonsterDerived(
  ctx: ActionRequestContext,
  monsterId: string,
  opts?: { skipAutoLoot?: boolean },
): void {
  const mon: Monster | undefined = ctx.state.monsters.find((m) => m.id === monsterId);
  if (!mon) return;
  const monHp = Number(mon.hp ?? 0);
  const monMaxHp = Number(mon.maxHp ?? 0);

  const tok = ctx.state.map.tokens.find((t) => t.id === monsterId);
  if (tok) {
    tok.name = mon.name;
    tok.hp = monHp;
    tok.maxHp = monMaxHp;
    tok.hiddenFromPlayers = Boolean(mon.hiddenFromPlayers);
  }
  for (const beat of ctx.state.storyBeats || []) {
    const btok = beat.arena?.tokens?.find((t) => t.id === monsterId);
    if (btok) {
      btok.name = mon.name;
      btok.hp = monHp;
      btok.maxHp = monMaxHp;
      btok.hiddenFromPlayers = Boolean(mon.hiddenFromPlayers);
    }
  }
  const cb = ctx.state.combat.combatants.find((c) => c.id === monsterId);
  if (cb) {
    cb.name = mon.name;
    cb.hp = monHp;
    cb.maxHp = monMaxHp;
    cb.ac = mon.ac;
    cb.hiddenFromPlayers = Boolean(mon.hiddenFromPlayers);
  }

  if (!opts?.skipAutoLoot && monHp <= 0 && mon.loot && !mon.loot.dropped) {
    const hasDrop = Boolean(mon.loot.itemName || mon.loot.gold > 0 || mon.loot.manaStones > 0 || mon.loot.xp > 0);
    if (hasDrop) {
      mon.loot.dropped = true;
      if (mon.loot.xp > 0) {
        for (const ch of Object.values(ctx.state.characters)) {
          grantXpToCharacter(ctx.state, ch, mon.loot.xp);
        }
      }
      if (mon.loot.itemName || mon.loot.gold > 0 || mon.loot.manaStones > 0) {
        for (const ch of Object.values(ctx.state.characters)) {
          ch.currency = ch.currency || { gold: 0, manaStones: 0 };
          ch.currency.gold = Number(ch.currency.gold || 0) + Number(mon.loot.gold || 0);
          ch.currency.manaStones = Number(ch.currency.manaStones || 0) + Number(mon.loot.manaStones || 0);
          if (mon.loot.itemName) {
            ch.inventory = ch.inventory || [];
            ch.inventory.push(
              createInventoryItem({
                name: mon.loot.itemName,
                category: mon.loot.itemCategory || 'relic',
                notes: `Dropped by ${mon.name}`,
              }),
            );
          }
        }
      }
      const dropParts = [
        mon.loot.itemName || '',
        mon.loot.gold ? `${mon.loot.gold}G` : '',
        mon.loot.manaStones ? `${mon.loot.manaStones} Stones` : '',
        mon.loot.xp ? `+${mon.loot.xp} XP` : '',
      ].filter(Boolean).join(', ');
      pushSystemToast(ctx, {
        title: 'MONSTER LOOT DROPPED!',
        message: `${mon.name} was defeated and dropped: ${dropParts}`,
        category: 'loot',
      });
    }
  }
}

export function createNewCharacterRecord(
  state: GameState,
  { name, race, className, level = 1 }: { name: string; race?: string; className?: string; level?: number },
): Character {
  const id = `char-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`;
  const stats: Record<string, number> = {};
  for (const s of state.mechanics.stats) {
    stats[s.key] = Number(s.defaultValue ?? 12);
  }
  const cleanName = String(name || 'New Climber').trim().slice(0, 50);
  const prompt = `${race || 'Human'} ${className || 'Tower Climber'} named ${cleanName} in dark fantasy gear, Korean manhwa webtoon style`;
  const char: Character = {
    id,
    name: cleanName,
    race: String(race || 'Human').trim(),
    className: String(className || 'Challenger').trim(),
    rank: 'E-Rank',
    level: Math.max(1, Number(level) || 1),
    xp: 0,
    xpToNext: xpToNextForLevel(Math.max(1, Number(level) || 1)),
    unspentStatPoints: BALANCE.start.unspentStatPoints,
    passiveTickets: 0,
    passives: [],
    hp: BALANCE.start.maxHp,
    maxHp: BALANCE.start.maxHp,
    tempHp: 0,
    mp: BALANCE.start.maxMp,
    maxMp: BALANCE.start.maxMp,
    ac: 12,
    dr: 1,
    speed: 30,
    speedSpaces: BALANCE.start.speedSpaces,
    patronDeityId: state.deities[0]?.id || '',
    favor: 2,
    inspiration: false,
    stats,
    skills: [{ name: 'Basic Combat', stat: state.mechanics.stats[0]?.key || 'STR', bonus: 2 }],
    spells: [],
    equipment: {
      mainHand: { id: `eq-${id}-1`, name: 'Iron Climber Blade', slot: 'mainHand', type: 'weapon', attackBonus: 4, damageDice: '1d8+2', damageType: 'Slashing', rangeSpaces: 1, drBonus: 0, acBonus: 0 },
      offHand: null,
      head: null,
      body: { id: `eq-${id}-2`, name: 'Initiate Leather Coat', slot: 'body', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, drBonus: 1, acBonus: 2 },
      boots: null,
      relic: null,
    },
    inventory: [
      { id: `inv-${id}-1`, name: 'Starter Healing Vial', category: 'consumable', qty: BALANCE.start.potionQty, healHp: BALANCE.start.potionHeal, healMp: 0, slot: '', attackBonus: 0, damageDice: '', drBonus: 0, acBonus: 0, notes: `Restores ${BALANCE.start.potionHeal} HP` },
    ],
    currency: { gold: BALANCE.start.gold, manaStones: BALANCE.start.manaStones },
    conditions: [],
    notes: 'Newly entered the Tower.',
    portraitPrompt: prompt,
    portraitStyle: 'Korean Manhwa Webtoon',
    portraitUrl: '',
    artHistory: [],
  };
  char.portraitUrl = generateSvgPortraitDataUri(prompt, char.portraitStyle, char);
  char.artHistory = [{ id: `art-${id}-init`, prompt, style: char.portraitStyle, url: char.portraitUrl, createdAt: new Date().toISOString() }];

  state.characters[id] = char;
  const startRow = getFloorCenterRow(state, 1);
  const initials = cleanName.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'PL';
  state.map.tokens.push({
    id,
    name: cleanName.split(' ')[0],
    x: crypto.randomInt(2, 8),
    y: startRow,
    color: '#22d3ee',
    type: 'player',
    hp: char.hp,
    maxHp: char.maxHp,
    hiddenFromPlayers: false,
    label: initials,
  });
  state.combat.combatants.push({
    id,
    name: cleanName,
    type: 'player',
    initiative: rollSingleDie(20) + 2,
    hp: char.hp,
    maxHp: char.maxHp,
    ac: char.ac,
    hiddenFromPlayers: false,
  });
  state.combat.combatants.sort((a, b) => b.initiative - a.initiative);

  // Add player arena token to all non-resolved story beats so newly invited players can immediately act on the grid
  for (const beat of state.storyBeats || []) {
    if (beat.status === 'resolved' || !beat.arena) continue;
    beat.arena.tokens = beat.arena.tokens || [];
    if (beat.arena.tokens.some((t) => t.id === id)) continue;
    const cols = Math.max(5, Number(beat.arena.cols || 20));
    const rows = Math.max(5, Number(beat.arena.rows || 20));
    const occupied = new Set([
      ...(beat.arena.tokens || []).map((t) => `${t.x},${t.y}`),
      ...(beat.arena.terrain || []).map((t) => `${t.x},${t.y}`),
    ]);
    const preferredY = Math.max(0, rows - 4);
    const centerCol = Math.floor(cols / 2);
    let placeX = Math.min(cols - 1, Math.max(0, centerCol));
    let placeY = preferredY;
    let placed = false;
    for (let radius = 0; radius < Math.max(cols, rows) && !placed; radius++) {
      const candidates = [
        { x: centerCol + radius, y: preferredY },
        { x: centerCol - radius, y: preferredY },
        { x: centerCol + radius, y: Math.max(0, preferredY - 1) },
        { x: centerCol - radius, y: Math.max(0, preferredY - 1) },
      ];
      for (const c of candidates) {
        if (c.x >= 0 && c.x < cols && c.y >= 0 && c.y < rows && !occupied.has(`${c.x},${c.y}`)) {
          placeX = c.x;
          placeY = c.y;
          placed = true;
          break;
        }
      }
    }
    beat.arena.tokens.push({
      id,
      name: cleanName.split(' ')[0],
      type: 'player',
      x: placeX,
      y: placeY,
      color: '#38bdf8',
      hp: char.hp,
      maxHp: char.maxHp,
      hiddenFromPlayers: false,
      label: initials,
    });
  }

  return char;
}

export function applyUnitEffect(
  target: { name: string; activeEffects?: ActiveUnitEffect[] },
  spec: UnitEffectSpec,
  sourceName: string,
  sourceCharacterId?: string,
): ActiveUnitEffect {
  const meta = UNIT_EFFECT_META[spec.kind];
  const potency = Math.max(1, Math.trunc(Number(spec.potency ?? meta.defaultPotency)));
  const duration = Math.max(1, Math.min(10, Math.trunc(Number(spec.duration ?? meta.defaultDuration))));
  const next: ActiveUnitEffect = {
    id: `eff-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
    kind: spec.kind,
    category: meta.category,
    name: meta.label.split(' (')[0],
    potency,
    turnsRemaining: duration,
    sourceName,
    ...(sourceCharacterId ? { sourceCharacterId } : {}),
  };
  target.activeEffects = target.activeEffects || [];
  if (spec.kind === 'bleed') {
    target.activeEffects.push(next);
    return next;
  }
  const existingIdx = target.activeEffects.findIndex((e) => e.kind === spec.kind);
  if (existingIdx >= 0) {
    const prev = target.activeEffects[existingIdx];
    next.potency = Math.max(prev.potency, next.potency);
    next.turnsRemaining = Math.max(prev.turnsRemaining, next.turnsRemaining);
    if (!next.sourceCharacterId && prev.sourceCharacterId) {
      next.sourceCharacterId = prev.sourceCharacterId;
    }
    target.activeEffects[existingIdx] = next;
  } else {
    target.activeEffects.push(next);
  }
  return next;
}

export interface TickUnitEffectsResult {
  dotKilledMonster?: {
    monster: Monster;
    killerCharacterId?: string;
    effectNames: string[];
    dropBeat: StoryBeat | null;
    monTokPos: { x: number; y: number } | null;
  };
}

export function tickUnitEffectsOnTurnStart(
  ctx: ActionRequestContext,
  unitId: string,
  unitType: 'player' | 'monster',
): TickUnitEffectsResult {
  const unit = unitType === 'player'
    ? ctx.state.characters[unitId]
    : (ctx.state.monsters || []).find((m) => m.id === unitId);
  if (!unit || !Array.isArray(unit.activeEffects) || unit.activeEffects.length === 0) return {};

  const mods = computeActiveEffectModifiers(unit.activeEffects);
  const notes: string[] = [];
  let dotKilledMonster: TickUnitEffectsResult['dotKilledMonster'];

  if (mods.regenPerTurn > 0 && Number(unit.hp ?? 0) > 0 && unit.maxHp) {
    const prevHp = Number(unit.hp ?? 0);
    unit.hp = Math.min(unit.maxHp, prevHp + mods.regenPerTurn);
    const gained = unit.hp - prevHp;
    if (gained > 0) notes.push(`+${gained} HP Regen`);
  }

  if (mods.dotPerTurn > 0 && Number(unit.hp ?? 0) > 0) {
    const prevHp = Number(unit.hp ?? 0);
    unit.hp = Math.max(0, prevHp - mods.dotPerTurn);
    notes.push(`-${mods.dotPerTurn} HP (Burn/Poison)`);
    if (unitType === 'monster' && prevHp > 0 && unit.hp <= 0) {
      let dropBeat: StoryBeat | null = null;
      let monTokPos: { x: number; y: number } | null = null;
      for (const b of ctx.state.storyBeats || []) {
        const foundTok = b.arena?.tokens?.find((t) => t.id === unit.id);
        if (foundTok) {
          dropBeat = b;
          monTokPos = { x: foundTok.x, y: foundTok.y };
          break;
        }
      }
      const dotEffects = unit.activeEffects.filter((e) => e.kind === 'burn' || e.kind === 'poison');
      const sortedDots = [...dotEffects].sort((a, b) => Number(b.potency || 0) - Number(a.potency || 0));
      let killerCharacterId = sortedDots.find(
        (e) => e.sourceCharacterId && Boolean(ctx.state.characters[e.sourceCharacterId]),
      )?.sourceCharacterId;
      if (!killerCharacterId) {
        for (const eff of sortedDots) {
          if (!eff.sourceName) continue;
          const matchedChar = Object.values(ctx.state.characters || {}).find(
            (c) => c.name.toLowerCase() === eff.sourceName!.trim().toLowerCase(),
          );
          if (matchedChar) {
            killerCharacterId = matchedChar.id;
            break;
          }
        }
      }
      const effectNames = Array.from(new Set(dotEffects.map((e) => e.name)));
      dotKilledMonster = {
        monster: unit as Monster,
        killerCharacterId,
        effectNames,
        dropBeat,
        monTokPos,
      };
      removeMonsterTokensFromMaps(ctx.state, unit.id);
    }
  }

  if (mods.stunned) {
    notes.push('STUNNED (Cannot Move or Attack this turn)');
  }

  // Decrement turnsRemaining and expire finished effects (bleed ticks at start-of-round instead)
  const expiredNames: string[] = [];
  const remaining: ActiveUnitEffect[] = [];
  for (const eff of unit.activeEffects) {
    if (eff.kind === 'bleed') {
      remaining.push(eff);
      continue;
    }
    const nextTurns = Number(eff.turnsRemaining || 1) - 1;
    if (nextTurns > 0) {
      remaining.push({ ...eff, turnsRemaining: nextTurns });
    } else {
      expiredNames.push(eff.name);
    }
  }
  unit.activeEffects = remaining;

  if (unitType === 'player') {
    recalculateCharacterAcAndDr(ctx.state, unit as Character);
    syncCharacterDerived(ctx, unit.id);
  } else {
    syncMonsterDerived(ctx, unit.id, { skipAutoLoot: true });
  }

  if (notes.length > 0 || expiredNames.length > 0) {
    const summaryParts = [
      ...notes,
      ...(expiredNames.length ? [`Expired: ${expiredNames.join(', ')}`] : []),
    ];
    pushSystemToast(ctx, {
      title: `EFFECTS: ${unit.name.toUpperCase()}`,
      message: summaryParts.join(' • '),
      category: mods.dotPerTurn > 0 || mods.stunned ? 'combat' : 'info',
      target: unitType === 'player' ? unit.id : 'all',
    });
    ctx.state.combatLog.unshift({
      id: `cblog-${Date.now()}-${crypto.randomInt(10, 99)}`,
      timestamp: new Date().toISOString(),
      attacker: 'Status Effects',
      target: unit.name,
      rawDamage: mods.dotPerTurn,
      finalDamage: mods.dotPerTurn,
      damageType: 'Effect Tick',
      remainingHp: unit.hp,
      summary: `${unit.name} turn start: ${summaryParts.join(' • ')}.`,
    });
    ctx.state.combatLog = ctx.state.combatLog.slice(0, 60);
  }

  return {
    ...(dotKilledMonster ? { dotKilledMonster } : {}),
  };
}

export function tickBleedEffectsOnRoundStart(ctx: ActionRequestContext): TickUnitEffectsResult[] {
  const results: TickUnitEffectsResult[] = [];
  const units: Array<{ unit: Monster | Character; unitType: 'monster' | 'player' }> = [
    ...(ctx.state.monsters || []).map((m) => ({ unit: m, unitType: 'monster' as const })),
    ...Object.values(ctx.state.characters || {}).map((c) => ({ unit: c, unitType: 'player' as const })),
  ];

  for (const { unit, unitType } of units) {
    if (!Array.isArray(unit.activeEffects) || unit.activeEffects.length === 0) continue;
    const bleedEffects = unit.activeEffects.filter((e) => e.kind === 'bleed');
    if (bleedEffects.length === 0) continue;

    const maxHp = Number(unit.maxHp ?? 0);
    const prevHp = Number(unit.hp ?? 0);
    let totalBleedDmg = 0;

    if (prevHp > 0 && maxHp > 0) {
      for (const eff of bleedEffects) {
        totalBleedDmg += Math.max(1, Math.round((maxHp * Number(eff.potency || 3)) / 100));
      }
      unit.hp = Math.max(0, prevHp - totalBleedDmg);
    }

    let expiredBleeds = 0;
    const nextEffects: ActiveUnitEffect[] = [];
    for (const eff of unit.activeEffects) {
      if (eff.kind !== 'bleed') {
        nextEffects.push(eff);
        continue;
      }
      const nextTurns = Number(eff.turnsRemaining || 1) - 1;
      if (nextTurns > 0) {
        nextEffects.push({ ...eff, turnsRemaining: nextTurns });
      } else {
        expiredBleeds += 1;
      }
    }
    unit.activeEffects = nextEffects;

    if (unitType === 'monster' && prevHp > 0 && Number(unit.hp ?? 0) <= 0) {
      const mon = unit as Monster;
      let dropBeat: StoryBeat | null = null;
      let monTokPos: { x: number; y: number } | null = null;
      for (const b of ctx.state.storyBeats || []) {
        const foundTok = b.arena?.tokens?.find((t) => t.id === mon.id);
        if (foundTok) {
          dropBeat = b;
          monTokPos = { x: foundTok.x, y: foundTok.y };
          break;
        }
      }
      const sortedBleeds = [...bleedEffects].sort((a, b) => Number(b.potency || 0) - Number(a.potency || 0));
      const killerCharacterId = sortedBleeds.find(
        (e) => e.sourceCharacterId && Boolean(ctx.state.characters[e.sourceCharacterId]),
      )?.sourceCharacterId;
      removeMonsterTokensFromMaps(ctx.state, mon.id);
      results.push({
        dotKilledMonster: {
          monster: mon,
          killerCharacterId,
          effectNames: ['Bleed'],
          dropBeat,
          monTokPos,
        },
      });
    }

    if (unitType === 'player') {
      recalculateCharacterAcAndDr(ctx.state, unit as Character);
      syncCharacterDerived(ctx, unit.id);
    } else {
      syncMonsterDerived(ctx, unit.id, { skipAutoLoot: true });
    }

    if (totalBleedDmg > 0 || expiredBleeds > 0) {
      const stackLabel = bleedEffects.length > 1 ? ` (${bleedEffects.length} stacks)` : '';
      const msgParts = [
        ...(totalBleedDmg > 0 ? [`-${totalBleedDmg} HP Bleed${stackLabel}`] : []),
        ...(expiredBleeds > 0 ? [`${expiredBleeds} Bleed expired`] : []),
      ];
      pushSystemToast(ctx, {
        title: `BLEED: ${unit.name.toUpperCase()}`,
        message: msgParts.join(' • '),
        category: 'combat',
        target: unitType === 'player' ? unit.id : 'all',
      });
      ctx.state.combatLog.unshift({
        id: `cblog-${Date.now()}-${crypto.randomInt(10, 99)}`,
        timestamp: new Date().toISOString(),
        attacker: 'Bleed',
        target: unit.name,
        rawDamage: totalBleedDmg,
        finalDamage: totalBleedDmg,
        damageType: 'Bleed Tick',
        remainingHp: unit.hp,
        summary: `${unit.name} round start: ${msgParts.join(' • ')}.`,
      });
      ctx.state.combatLog = ctx.state.combatLog.slice(0, 60);
    }
  }

  return results;
}

export function pushArenaFx(
  state: GameState,
  fx: Omit<ArenaFxEvent, 'id' | 'createdAt'>,
): ArenaFxEvent {
  const entry: ArenaFxEvent = {
    id: `fx-${Date.now().toString(36)}-${crypto.randomInt(100, 999)}`,
    createdAt: new Date().toISOString(),
    ...fx,
  };
  if (!Array.isArray(state.recentArenaFx)) state.recentArenaFx = [];
  state.recentArenaFx.unshift(entry);
  state.recentArenaFx = state.recentArenaFx.slice(0, 6);
  return entry;
}

export function recordChronicleEvent(
  state: GameState,
  input: Omit<SessionChronicleEntry, 'id' | 'timestamp' | 'sessionNumber' | 'floor'> & {
    floor?: number;
    sessionNumber?: number;
  },
): SessionChronicleEntry {
  const sessionNumber = Math.max(1, Number(input.sessionNumber ?? state.currentSessionNumber ?? 1));
  state.currentSessionNumber = sessionNumber;
  if (!Array.isArray(state.sessionChronicle)) state.sessionChronicle = [];
  if (!Array.isArray(state.sessionRecaps)) state.sessionRecaps = [];

  if (!state.sessionRecaps.some((r) => r.sessionNumber === sessionNumber)) {
    state.sessionRecaps.push({
      sessionNumber,
      title: `Session #${sessionNumber}`,
      startedAt: new Date().toISOString(),
    });
  }

  const entry: SessionChronicleEntry = {
    id: `chr-${Date.now().toString(36)}-${crypto.randomInt(100, 999)}`,
    sessionNumber,
    timestamp: new Date().toISOString(),
    floor: Math.max(1, Number(input.floor ?? getPartyFloor(state) ?? 1)),
    ...input,
  };
  state.sessionChronicle.push(entry);
  if (state.sessionChronicle.length > 2000) {
    state.sessionChronicle = state.sessionChronicle.slice(-2000);
  }
  return entry;
}

export function advanceSettlementConstructionOnBeatResolved(
  ctx: ActionRequestContext,
  beatTitle?: string,
): string[] {
  const completed: string[] = [];
  for (const settlement of ctx.state.settlements || []) {
    for (const b of settlement.buildings || []) {
      if (b.status !== 'under_construction' && b.status !== 'upgrading') continue;
      b.beatsCompleted = Math.min(b.beatsRequired, Number(b.beatsCompleted || 0) + 1);
      if (b.beatsCompleted >= b.beatsRequired) {
        b.level = b.targetLevel;
        b.status = 'active';
        b.completedAt = new Date().toISOString();
        const bpName = BUILDING_BLUEPRINTS[b.type]?.name || b.type;
        const msg = `${bpName} (Lv ${b.level}) is now complete in ${settlement.name}!`;
        completed.push(msg);
        pushSystemToast(ctx, {
          title: 'CONSTRUCTION COMPLETE!',
          message: msg,
          category: 'loot',
        });
        recordChronicleEvent(ctx.state, {
          category: 'story',
          actor: settlement.name,
          summary: `${msg}${beatTitle ? ` (Finished after "${beatTitle}")` : ''}`,
        });
      }
    }
  }
  return completed;
}

export { VALID_BIOME_THEMES };
