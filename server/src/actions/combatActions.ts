import crypto from 'node:crypto';
import {
  CHEST_TIERS,
  CHEST_TIER_LOOT_TABLES,
  COMBAT_DEFEAT_PENALTIES,
  MONSTER_ATTACK_AREAS,
  TOKEN_ICON_META,
  UNIT_EFFECT_META,
  buildCharacterVarScope,
  clampAttackAreaModifier,
  clampCombatMaxRounds,
  computeActiveEffectModifiers,
  computeAttackAreaCells,
  computeBlockMitigationPct,
  computeCounterBleedChancePct,
  computeParryStunChancePct,
  computePassiveModifiers,
  computeMonsterAttackCells,
  computeStatModifier,
  evaluateFormula,
  formatMonsterAttackArea,
  inferDefaultAttackAreaForMonster,
  getDefaultLootTableForMonster,
  getDefaultSkillsForMonster,
  getEquippedTotals,
  getFloorLootProfile,
  getGridLineCells,
  getMaxAttacksForFloor,
  getMonsterXpReward,
  getWeaponAttackInfo,
  getChestDefaultsForFloor,
  isBossToken,
  resolvePlayerDefenseReaction,
  resolvePlayerReactionStyle,
  scaleLootDropForFloor,
  scaleMonsterSkillForFloor,
  shouldMonsterDropChest,
  spaceDistanceBetweenPoints,
  type AttackArea,
  type Character,
  type ChestTier,
  type CombatDefeatPenaltyEntry,
  type GameState,
  type Monster,
  type MonsterAttackArea,
  type MonsterDefeatSummary,
  type MonsterSkill,
  type StoryBeat,
  type TokenIconId,
  type UnitEffectKind,
  type UnitEffectSpec,
} from '../../../shared';
import { rollDiceServer, rollSingleDie } from '../services/dice';
import {
  applyGoldBonus,
  applyIncomingDamageToCharacter,
  applyUnitEffect,
  commitState,
  createInventoryItem,
  getAllyAuraBonuses,
  getFloorCenterRow,
  grantXpToCharacter,
  logPlayerHistory,
  pushSystemToast,
  recalculateCharacterAcAndDr,
  removeMonsterTokensFromMaps,
  resetArenaTurnFlags,
  resetCombatPassiveFlags,
  syncCharacterDerived,
  syncMonsterDerived,
  tickBleedEffectsOnRoundStart,
  tickUnitEffectsOnTurnStart,
  triggerStartOfTurnPassives,
} from '../services/gameHelpers';
import { maskMonsterForRole } from '../store/filterState';
import { runAiDmTurns } from '../services/aiDm';
import type { ActionRequestContext, ActionResult } from './types';

export function spawnMonsterAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can add monsters.' };
  const id = `mon-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`;
  const validFloors = (ctx.state.map.floors || []).map((f) => Number(f.number));
  const requestedFloor = Math.trunc(Number(payload.floor || validFloors[validFloors.length - 1] || 1));
  const maxFloorNum = validFloors.length ? Math.max(...validFloors) : 1;
  const minFloorNum = validFloors.length ? Math.min(...validFloors) : 1;
  const floor = validFloors.includes(requestedFloor)
    ? requestedFloor
    : requestedFloor > maxFloorNum
      ? maxFloorNum
      : minFloorNum;
  const maxHp = Math.max(1, Number(payload.maxHp || 30));
  const ac = Number(payload.ac || 14);
  const dr = Number(payload.dr || 0);
  const rangeSpaces = Math.max(1, Number(payload.rangeSpaces || 2));
  const hidden = Boolean(payload.hiddenFromPlayers);
  const name = String(payload.name || 'Tower Monster').trim().slice(0, 50);

  const lootSrc = (payload.loot && typeof payload.loot === 'object' ? payload.loot : {}) as Record<string, unknown>;
  const cleanBaseName = name.replace(/\s*#\d+$/, '').trim().toLowerCase();
  const matchedBestiary = (ctx.state.bestiary || []).find(
    (b) => b.name.trim().toLowerCase() === cleanBaseName || name.toLowerCase().includes(b.name.trim().toLowerCase()),
  );
  const rawSkillsSource: Array<Partial<MonsterSkill> & { name: string }> = Array.isArray(payload.skills) && payload.skills.length > 0
    ? (payload.skills as Array<Partial<MonsterSkill> & { name: string }>)
    : getDefaultSkillsForMonster(matchedBestiary || { name, maxHp });
  const scaledSkills: MonsterSkill[] = rawSkillsSource
    .map((s) => scaleMonsterSkillForFloor(s, floor))
    .filter((s) => s.unlocked)
    .map(({ unlocked: _u, attackFormula: _af, ...rest }) => ({
      ...rest,
      usesRemaining: rest.maxUsesPerCombat,
    }));

  const rawIcon = String(payload.iconId || matchedBestiary?.iconId || '').trim() as TokenIconId;
  const resolvedIconId = rawIcon && TOKEN_ICON_META[rawIcon] ? rawIcon : undefined;

  const rawChestTier = String(payload.chestTier ?? matchedBestiary?.chestTier ?? '').trim() as ChestTier;
  const resolvedChestTier = CHEST_TIERS.includes(rawChestTier) ? rawChestTier : undefined;
  const resolvedDropsChest = typeof payload.dropsChest === 'boolean'
    ? payload.dropsChest
    : typeof matchedBestiary?.dropsChest === 'boolean'
      ? matchedBestiary.dropsChest
      : undefined;

  const monster: Monster = {
    id,
    name,
    floor,
    hp: maxHp,
    maxHp,
    ac,
    dr,
    rangeSpaces,
    ...(resolvedIconId ? { iconId: resolvedIconId } : {}),
    ...(typeof resolvedDropsChest === 'boolean' ? { dropsChest: resolvedDropsChest } : {}),
    ...(resolvedChestTier ? { chestTier: resolvedChestTier } : {}),
    attackArea: inferDefaultAttackAreaForMonster({
      name,
      maxHp,
      rangeSpaces,
      category: matchedBestiary?.category,
      attackArea: (payload.attackArea as MonsterAttackArea | undefined) || matchedBestiary?.attackArea,
    }),
    attackAreaModifier: clampAttackAreaModifier(payload.attackAreaModifier ?? matchedBestiary?.attackAreaModifier),
    ...(payload.healFormula || matchedBestiary?.healFormula
      ? { healFormula: String(payload.healFormula || matchedBestiary?.healFormula) }
      : {}),
    ...(payload.effectSpec || matchedBestiary?.effectSpec
      ? { effectSpec: (payload.effectSpec || matchedBestiary?.effectSpec) as UnitEffectSpec }
      : {}),
    activeEffects: [],
    attackFormula: String(payload.attackFormula || '1d20+5'),
    damageFormula: String(payload.damageFormula || '1d8+3'),
    hiddenFromPlayers: hidden,
    conditions: [],
    notes: String(payload.notes || ''),
    loot: {
      itemName: String(lootSrc.itemName ?? payload.lootItemName ?? '').slice(0, 50),
      itemCategory: String(lootSrc.itemCategory ?? payload.lootCategory ?? 'relic'),
      gold: Math.max(0, Number(lootSrc.gold ?? payload.lootGold ?? 0)),
      manaStones: Math.max(0, Number(lootSrc.manaStones ?? payload.lootManaStones ?? 0)),
      xp: Math.max(0, Number(lootSrc.xp ?? payload.lootXp ?? getMonsterXpReward(floor))),
      dropped: false,
    },
    skills: scaledSkills,
  };
  ctx.state.monsters.push(monster);

  const row = getFloorCenterRow(ctx.state, floor);
  const col = Math.max(0, Math.min(ctx.state.map.cols - 1, Number(payload.x ?? crypto.randomInt(2, 8))));
  ctx.state.map.tokens.push({
    id,
    name,
    x: col,
    y: row,
    color: '#ef4444',
    type: 'monster',
    hp: maxHp,
    maxHp,
    hiddenFromPlayers: hidden,
    label: name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'MN',
  });
  ctx.state.combat.combatants.push({
    id,
    name,
    type: 'monster',
    initiative: rollSingleDie(20) + 2,
    hp: maxHp,
    maxHp,
    ac,
    hiddenFromPlayers: hidden,
  });
  ctx.state.combat.combatants.sort((a, b) => b.initiative - a.initiative);

  ctx.state.combatLog.unshift({
    id: `cblog-${Date.now()}`,
    timestamp: new Date().toISOString(),
    attacker: 'DM',
    target: name,
    rawDamage: 0,
    finalDamage: 0,
    damageType: 'Spawn',
    remainingHp: maxHp,
    summary: `DM summoned ${name} on ${floor}F (HP: ${maxHp}/${maxHp}, AC: ${ac}, DR: ${dr})${hidden ? ' [HIDDEN]' : ''}.`,
  });
  ctx.state.combatLog = ctx.state.combatLog.slice(0, 50);

  if (!hidden) {
    pushSystemToast(ctx, {
      title: 'MONSTER APPEARED!',
      message: `${name} emerged on Floor ${floor}F (${maxHp} HP)!`,
      category: 'combat',
    });
  }

  commitState(ctx);
  return { ok: true, monster };
}

export function updateMonsterAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can edit or delete monsters.' };
  const mon = ctx.state.monsters.find((m) => m.id === payload.monsterId);
  if (!mon) return { status: 404, error: 'Monster not found.' };

  if (payload.remove) {
    ctx.state.monsters = ctx.state.monsters.filter((m) => m.id !== mon.id);
    removeMonsterTokensFromMaps(ctx.state, mon.id);
    ctx.state.combat.combatants = ctx.state.combat.combatants.filter((c) => c.id !== mon.id);
    ctx.state.pendingReactions = (ctx.state.pendingReactions || []).filter((r) => r.monsterId !== mon.id);
    if (ctx.state.combat.combatants.length === 0) {
      ctx.state.combat.turnIndex = 0;
    } else if (ctx.state.combat.turnIndex >= ctx.state.combat.combatants.length) {
      ctx.state.combat.turnIndex = ctx.state.combat.turnIndex % ctx.state.combat.combatants.length;
    }
  } else {
    const maxHp = payload.maxHp !== undefined ? Math.max(1, Number(payload.maxHp)) : Number(mon.maxHp || 1);
    mon.maxHp = maxHp;
    const curHp = Number(mon.hp ?? maxHp);
    if (payload.hpDelta !== undefined) mon.hp = Math.max(0, Math.min(maxHp, curHp + Number(payload.hpDelta)));
    if (payload.hp !== undefined) mon.hp = Math.max(0, Math.min(maxHp, Number(payload.hp)));
    if (payload.ac !== undefined) mon.ac = Number(payload.ac);
    if (payload.dr !== undefined) mon.dr = Number(payload.dr);
    if (payload.attackArea !== undefined && MONSTER_ATTACK_AREAS.includes(String(payload.attackArea) as AttackArea)) {
      mon.attackArea = String(payload.attackArea) as AttackArea;
    }
    if (payload.attackAreaModifier !== undefined) {
      mon.attackAreaModifier = clampAttackAreaModifier(payload.attackAreaModifier);
    }
    if (payload.skillId && Array.isArray(mon.skills)) {
      const sk = mon.skills.find((s) => s.id === String(payload.skillId));
      if (sk) {
        if (payload.skillAttackArea !== undefined && MONSTER_ATTACK_AREAS.includes(String(payload.skillAttackArea) as AttackArea)) {
          sk.attackArea = String(payload.skillAttackArea) as AttackArea;
        }
        if (payload.skillAttackAreaModifier !== undefined) {
          sk.attackAreaModifier = clampAttackAreaModifier(payload.skillAttackAreaModifier);
        }
      }
    }
    if (payload.hiddenFromPlayers !== undefined) mon.hiddenFromPlayers = Boolean(payload.hiddenFromPlayers);
    if (payload.floor !== undefined) {
      mon.floor = Number(payload.floor);
      const tok = ctx.state.map.tokens.find((t) => t.id === mon.id);
      if (tok) tok.y = getFloorCenterRow(ctx.state, mon.floor);
    }
    syncMonsterDerived(ctx, mon.id);
    if (Number(mon.hp ?? 0) <= 0) removeMonsterTokensFromMaps(ctx.state, mon.id);
  }

  commitState(ctx);
  return { ok: true };
}

export function monsterAttackAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can trigger monster attacks.' };
  const mon = ctx.state.monsters.find((m) => m.id === payload.monsterId);
  const targetChar = ctx.state.characters[String(payload.targetCharacterId || '')];
  if (!mon || !targetChar) return { status: 404, error: 'Monster or target player character not found.' };

  // Ensure monster has floor-scaled skills initialized
  if (!Array.isArray(mon.skills) || mon.skills.length === 0) {
    const cleanBase = mon.name.replace(/\s*#\d+$/, '').trim().toLowerCase();
    const matchedBest = (ctx.state.bestiary || []).find((b) => b.name.trim().toLowerCase() === cleanBase);
    mon.skills = getDefaultSkillsForMonster(matchedBest || { name: mon.name, maxHp: mon.maxHp || 30 })
      .map((s) => scaleMonsterSkillForFloor(s, mon.floor || 1))
      .filter((s) => s.unlocked)
      .map(({ unlocked: _u, attackFormula: _af, ...rest }) => ({
        ...rest,
        usesRemaining: rest.maxUsesPerCombat,
      }));
  }

  const monEffMods = computeActiveEffectModifiers(mon.activeEffects);
  if (monEffMods.stunned) {
    return { status: 400, error: `${mon.name} is Stunned and cannot attack this turn!` };
  }

  let usedSkill: MonsterSkill | undefined;
  if (payload.skillId) {
    const skillId = String(payload.skillId);
    usedSkill = (mon.skills || []).find((s) => s.id === skillId || s.name.toLowerCase() === skillId.toLowerCase());
    if (!usedSkill) return { status: 404, error: 'Monster skill not found.' };
    if (Number(usedSkill.usesRemaining ?? 0) <= 0) {
      return {
        status: 400,
        error: `${mon.name} has no uses remaining for ${usedSkill.name} (0/${usedSkill.maxUsesPerCombat} uses left this combat)!`,
      };
    }
    usedSkill.usesRemaining = Math.max(0, Number(usedSkill.usesRemaining) - 1);
  }

  const atkFormula = usedSkill
    ? `1d20${usedSkill.attackBonus >= 0 ? `+${usedSkill.attackBonus}` : usedSkill.attackBonus}`
    : (mon.attackFormula || '1d20+5');
  const dmgFormulaToRoll = usedSkill ? usedSkill.damageFormula : (mon.damageFormula || '1d8+3');

  // ---- Attack Area (AoE): every player standing inside the affected spaces is hit ----
  if (!mon.attackArea) mon.attackArea = inferDefaultAttackAreaForMonster(mon);
  const rawPayloadArea = payload.attackArea ? String(payload.attackArea) : '';
  const effectiveArea: AttackArea = MONSTER_ATTACK_AREAS.includes(rawPayloadArea as AttackArea)
    ? (rawPayloadArea as AttackArea)
    : (usedSkill?.attackArea || mon.attackArea);
  const effectiveMod = clampAttackAreaModifier(
    payload.attackAreaModifier !== undefined
      ? payload.attackAreaModifier
      : (usedSkill?.attackAreaModifier ?? mon.attackAreaModifier ?? 0),
  );
  const targetChars: typeof targetChar[] = [targetChar];
  let affectedCells: Array<{ x: number; y: number }> = [];
  const hostBeat = (ctx.state.storyBeats || []).find(
    (b) => b.status !== 'resolved'
      && (b.arena?.tokens || []).some((t) => t.id === mon.id)
      && (b.arena?.tokens || []).some((t) => t.id === targetChar.id),
  ) || (ctx.state.storyBeats || []).find(
    (b) => (b.arena?.tokens || []).some((t) => t.id === mon.id)
      && (b.arena?.tokens || []).some((t) => t.id === targetChar.id),
  );
  const activeComb = ctx.state.combat?.combatants?.[ctx.state.combat?.turnIndex ?? 0];
  const hasBeatCombatants = hostBeat?.arena
    ? (ctx.state.combat?.combatants || []).some((c) => hostBeat.arena.tokens.some((t) => t.id === c.id))
    : false;
  if (hasBeatCombatants && activeComb && !payload.forceAction) {
    if (activeComb.type !== 'monster') {
      return {
        status: 400,
        error: `It is currently ${activeComb.name}'s turn! Wait for a monster's turn.`,
      };
    }
    if (mon.id !== activeComb.id) {
      return {
        status: 400,
        error: `It is currently ${activeComb.name}'s turn! Only ${activeComb.name} can act right now.`,
      };
    }
  }
  if (hostBeat?.arena) {
    const monTok = hostBeat.arena.tokens.find((t) => t.id === mon.id);
    const tgtTok = hostBeat.arena.tokens.find((t) => t.id === targetChar.id);
    if (monTok && tgtTok) {
      const area = computeMonsterAttackCells({
        monsterX: monTok.x,
        monsterY: monTok.y,
        targetX: tgtTok.x,
        targetY: tgtTok.y,
        attackArea: effectiveArea,
        areaModifier: effectiveMod,
        rangeSpaces: mon.rangeSpaces,
        cols: hostBeat.arena.cols || 20,
        rows: hostBeat.arena.rows || 20,
        isSkill: Boolean(usedSkill),
      });
      affectedCells = area.affectedCells;
      const cellSet = new Set(affectedCells.map((c) => `${c.x},${c.y}`));
      for (const tok of hostBeat.arena.tokens) {
        if (tok.type !== 'player' || tok.id === targetChar.id) continue;
        if (!cellSet.has(`${tok.x},${tok.y}`)) continue;
        const extra = ctx.state.characters[tok.id];
        if (extra && Number(extra.hp ?? 0) > 0) targetChars.push(extra);
      }
    }
  }
  const areaLabel = formatMonsterAttackArea(effectiveArea, effectiveMod);

  const dmgRoll = payload.customDamage !== undefined && payload.customDamage !== ''
    ? {
        total: Math.max(1, Number(payload.customDamage)),
        formula: 'Direct',
        rolls: [Math.max(1, Number(payload.customDamage))],
        sides: 8,
        modifier: 0,
        diceTotal: Math.max(1, Number(payload.customDamage)),
      }
    : rollDiceServer({ formula: dmgFormulaToRoll });
  const effectiveMonDmg = Math.max(1, dmgRoll.total + monEffMods.dmgDelta);

  const strikeLabel = usedSkill ? `${mon.name} [${usedSkill.name}]` : mon.name;
  const isAoe = targetChars.length > 1;
  const aoeSuffix = isAoe ? ` [AoE: ${areaLabel} • ${targetChars.length} climbers caught]` : '';

  const rollHitVs = (tc: typeof targetChar) => {
    const tMods = computePassiveModifiers(tc);
    const tEffMods = computeActiveEffectModifiers(tc.activeEffects);
    const hitPenalty = tMods.auraEnemyHitPenalty || 0;
    const hitRoll = rollDiceServer({ formula: atkFormula });
    const effectiveHitTotal = hitRoll.total + monEffMods.hitDelta - hitPenalty;
    const targetAc = Math.max(1, Number(tc.ac || 12) + tEffMods.acDelta);
    const attackNatural = hitRoll.rolls?.[0] ?? hitRoll.diceTotal ?? 10;
    const attackHit = hitRoll.isCrit || (!hitRoll.isFumble && effectiveHitTotal >= targetAc);
    return {
      effectiveHitTotal,
      targetAc,
      attackNatural,
      attackHit,
      attackModifier: hitRoll.modifier,
      attackEffectDelta: monEffMods.hitDelta,
      attackAuraPenalty: hitPenalty,
      attackCrit: hitRoll.isCrit,
    };
  };

  // Monster self-heal & buff/debuff application
  const monHealFormula = String(payload.healFormula || usedSkill?.healFormula || mon.healFormula || '').trim();
  if (monHealFormula && mon.maxHp) {
    const hRoll = rollDiceServer({ formula: monHealFormula });
    const prevM = Number(mon.hp ?? 0);
    mon.hp = Math.min(mon.maxHp, prevM + Math.max(1, hRoll.total));
    syncMonsterDerived(ctx, mon.id);
    if (mon.hp - prevM > 0) {
      pushSystemToast(ctx, {
        title: `${mon.name.toUpperCase()} HEALED!`,
        message: `${mon.name} recovered +${mon.hp - prevM} HP (${monHealFormula})!`,
        category: 'combat',
      });
    }
  }
  const monEffSpec = (payload.effectSpec || usedSkill?.effectSpec || mon.effectSpec) as UnitEffectSpec | undefined | null;
  if (monEffSpec && UNIT_EFFECT_META[monEffSpec.kind]) {
    const isSelfEff = monEffSpec.target === 'self' || UNIT_EFFECT_META[monEffSpec.kind].defaultTarget === 'self';
    if (isSelfEff) {
      applyUnitEffect(mon, monEffSpec, strikeLabel);
      syncMonsterDerived(ctx, mon.id);
    } else {
      for (const tc of targetChars) {
        applyUnitEffect(tc, monEffSpec, strikeLabel);
        syncCharacterDerived(ctx, tc.id);
      }
    }
  }

  if (ctx.state.mechanics.combatMode === 'reactive') {
    const reactions = targetChars.map((tc, i) => {
      const h = rollHitVs(tc);
      const reaction = {
        id: `react-${Date.now().toString(36)}-${i}-${crypto.randomInt(10, 99)}`,
        createdAt: new Date().toISOString(),
        monsterId: mon.id,
        monsterName: mon.name,
        ...(usedSkill ? { skillName: usedSkill.name } : {}),
        targetCharacterId: tc.id,
        targetCharacterName: tc.name,
        targetAc: h.targetAc,
        attackNatural: h.attackNatural,
        attackTotal: h.effectiveHitTotal,
        attackFormula: atkFormula,
        attackHit: h.attackHit,
        attackModifier: h.attackModifier,
        attackEffectDelta: h.attackEffectDelta,
        attackAuraPenalty: h.attackAuraPenalty,
        attackCrit: h.attackCrit,
        incomingDamage: effectiveMonDmg,
        formula: dmgRoll.formula,
        damageRolls: dmgRoll.rolls || [],
        damageSides: dmgRoll.sides || 8,
        damageModifier: dmgRoll.modifier || 0,
        damageEffectDelta: monEffMods.dmgDelta || 0,
      };
      ctx.state.pendingReactions.unshift(reaction);

      pushSystemToast(ctx, {
        title: usedSkill ? `MONSTER SKILL: ${usedSkill.name.toUpperCase()}!` : isAoe ? 'AREA ATTACK INCOMING!' : 'REACTION TRIGGERED!',
        message: `${strikeLabel} attacks ${tc.name} (${h.effectiveHitTotal} to hit, ${reaction.incomingDamage} incoming dmg)${aoeSuffix}! Counter-attack or Parry now!`,
        category: 'combat',
        target: tc.id,
      });
      ctx.state.combatLog.unshift({
        id: `cblog-${Date.now()}-${i}`,
        timestamp: new Date().toISOString(),
        attacker: strikeLabel,
        target: tc.name,
        rawDamage: reaction.incomingDamage,
        finalDamage: reaction.incomingDamage,
        damageType: usedSkill ? `Skill: ${usedSkill.name}` : 'Incoming Strike',
        remainingHp: tc.hp,
        summary: `${strikeLabel} unleashes ${usedSkill ? usedSkill.name : 'an attack'} on ${tc.name} (Hit ${h.effectiveHitTotal}, ${reaction.incomingDamage} dmg)${aoeSuffix} — Waiting for Player Reaction!`,
      });
      return reaction;
    });
    ctx.state.pendingReactions = ctx.state.pendingReactions.slice(0, 12);

    commitState(ctx);
    return {
      ok: true,
      reaction: reactions[0],
      reactions,
      reactive: true,
      skill: usedSkill,
      attackArea: effectiveArea,
      attackAreaModifier: effectiveMod,
      affectedCells,
      targetsHit: targetChars.map((t) => t.id),
    };
  }

  const results = targetChars.map((tc, i) => {
    const incomingRes = applyIncomingDamageToCharacter(ctx, tc, effectiveMonDmg, {
      attackerMonster: mon,
      damageType: usedSkill ? usedSkill.name : 'Monster Strike',
    });
    const dmgTaken = incomingRes.dmgTaken;
    const noteSuffix = incomingRes.notes.length ? ` [${incomingRes.notes.join(', ')}]` : '';
    pushSystemToast(ctx, {
      title: incomingRes.evaded ? 'ATTACK EVADED!' : usedSkill ? `SKILL HIT: ${usedSkill.name.toUpperCase()}` : isAoe ? 'AREA ATTACK HIT' : 'MONSTER HIT',
      message: incomingRes.evaded
        ? `${tc.name} evaded ${strikeLabel}'s strike!${noteSuffix}${aoeSuffix}`
        : `${strikeLabel} hit ${tc.name} for ${dmgTaken} damage!${noteSuffix}${aoeSuffix}`,
      category: 'combat',
      target: tc.id,
    });
    ctx.state.combatLog.unshift({
      id: `cblog-${Date.now()}-${i}`,
      timestamp: new Date().toISOString(),
      attacker: strikeLabel,
      target: tc.name,
      rawDamage: dmgRoll.total,
      finalDamage: dmgTaken,
      damageType: usedSkill ? `Skill: ${usedSkill.name}` : 'Monster Strike',
      remainingHp: tc.hp,
      summary: incomingRes.evaded
        ? `${tc.name} evaded ${strikeLabel}'s strike${noteSuffix}${aoeSuffix} (HP: ${tc.hp}/${tc.maxHp}).`
        : `${strikeLabel} struck ${tc.name} for ${dmgTaken} damage${noteSuffix}${aoeSuffix} (HP: ${tc.hp}/${tc.maxHp}).`,
    });
    return { characterId: tc.id, dmgTaken, evaded: incomingRes.evaded };
  });
  ctx.state.combatLog = ctx.state.combatLog.slice(0, 50);
  commitState(ctx);
  return {
    ok: true,
    dmgTaken: results[0].dmgTaken,
    evaded: results[0].evaded,
    results,
    reactive: false,
    skill: usedSkill,
    attackArea: effectiveArea,
    attackAreaModifier: effectiveMod,
    affectedCells,
    targetsHit: targetChars.map((t) => t.id),
  };
}

function awardMonsterDefeatLoot(
  ctx: ActionRequestContext,
  monster: Monster,
  killerChar: Character,
  opts?: {
    manaStoneDroppedOnMap?: boolean;
    manaStonesGained?: number;
    dropBeat?: StoryBeat | null;
    monTokPos?: { x: number; y: number } | null;
    defeatCause?: string;
  },
): MonsterDefeatSummary {
  const monFloor = Math.max(1, Number(monster.floor || 1));
  const baseName = monster.name.replace(/\s*#\d+$/, '').trim().toLowerCase();
  const bestiaryMatch = (ctx.state.bestiary || []).find((b) => b.name.toLowerCase() === baseName)
    || { name: monster.name, maxHp: Number(monster.maxHp || 30) };
  const bestiaryCat = (bestiaryMatch as { category?: string })?.category;
  const isBoss = isBossToken(monster.name, monster.iconId, bestiaryCat) || Number(monster.maxHp || 0) >= 90;
  const profile = getFloorLootProfile(monFloor, isBoss);
  const table = getDefaultLootTableForMonster(bestiaryMatch).map((d) => scaleLootDropForFloor(d, monFloor, isBoss));
  const passedDrops = table.filter((d) => d.unlocked && crypto.randomInt(1, 101) <= d.scaledDropChancePct);
  const rolledDrops = [
    ...passedDrops.filter((d) => d.category !== 'material'),
    ...passedDrops.filter((d) => d.category === 'material'),
  ].slice(0, profile.maxItems);

  const xpGained = Math.max(0, Number(monster.loot?.xp || getMonsterXpReward(monFloor)));
  const xpRes = xpGained > 0 ? grantXpToCharacter(ctx.state, killerChar, xpGained) : { levelsGained: 0, level: killerChar.level };

  const explicitGold = Number(monster.loot?.gold || 0);
  const dropGold = rolledDrops.reduce((s, d) => s + d.scaledGold, 0);
  const baseGold = explicitGold > 0
    ? Math.round(explicitGold * profile.goldMult) + dropGold
    : profile.baseKillGold + dropGold;
  const goldGained = applyGoldBonus(killerChar, baseGold, false);
  killerChar.currency = killerChar.currency || { gold: 0, manaStones: 0 };
  killerChar.currency.gold = Number(killerChar.currency.gold || 0) + goldGained;

  let manaStonesGained = Number(opts?.manaStonesGained || 0);
  const rawExtraStones = rolledDrops.reduce((s, d) => s + d.scaledManaStones, 0) + Number(monster.loot?.manaStones || 0);
  const extraStones = !isBoss && monFloor <= 2 ? Math.min(1, rawExtraStones) : rawExtraStones;
  if (extraStones > 0) {
    killerChar.currency.manaStones = Number(killerChar.currency.manaStones || 0) + extraStones;
    manaStonesGained += extraStones;
  }

  const items: MonsterDefeatSummary['items'] = [];
  killerChar.inventory = killerChar.inventory || [];
  if (monster.loot?.itemName && !monster.loot.dropped) {
    killerChar.inventory.push(
      createInventoryItem({
        name: monster.loot.itemName,
        category: monster.loot.itemCategory || 'relic',
        notes: `Dropped by ${monster.name} (${monFloor}F)`,
      }),
    );
    items.push({ name: monster.loot.itemName, category: monster.loot.itemCategory || 'relic' });
  }
  for (const drop of rolledDrops) {
    killerChar.inventory.push(
      createInventoryItem({
        name: drop.itemName,
        category: drop.category,
        notes: drop.notes || `Dropped by ${monster.name} (${monFloor}F)`,
      }),
    );
    items.push({ name: drop.itemName, category: drop.category, tier: drop.tier, notes: drop.notes });
  }
  if (monster.loot) monster.loot.dropped = true;
  removeMonsterTokensFromMaps(ctx.state, monster.id);
  syncCharacterDerived(ctx, killerChar.id);

  let chestDropped: MonsterDefeatSummary['chestDropped'] = null;
  const bestiaryDropsChest = (bestiaryMatch as { dropsChest?: boolean })?.dropsChest;
  const bestiaryChestTier = (bestiaryMatch as { chestTier?: ChestTier })?.chestTier;
  const canDropChest = shouldMonsterDropChest({
    name: monster.name,
    iconId: monster.iconId,
    category: bestiaryCat,
    dropsChest: monster.dropsChest ?? bestiaryDropsChest,
  });
  if (canDropChest && opts?.dropBeat?.arena && opts?.monTokPos) {
    const tier: ChestTier = monster.chestTier && CHEST_TIERS.includes(monster.chestTier)
      ? monster.chestTier
      : bestiaryChestTier && CHEST_TIERS.includes(bestiaryChestTier)
        ? bestiaryChestTier
        : isBossToken(monster.name, monster.iconId, bestiaryCat)
          ? 'Epic'
          : 'Rare';
    const defaults = getChestDefaultsForFloor(tier, monFloor);
    const chest = {
      ...defaults,
      id: `chest-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name: `${monster.name}'s ${tier} Chest`,
      tier,
      x: opts.monTokPos.x,
      y: opts.monTokPos.y,
      itemName: '',
      itemCategory: 'treasure',
      opened: false,
    };
    opts.dropBeat.arena.chests = opts.dropBeat.arena.chests || [];
    opts.dropBeat.arena.chests.push(chest);
    chestDropped = { name: chest.name, tier: chest.tier, x: chest.x, y: chest.y };
  }

  const summary: MonsterDefeatSummary = {
    id: `defeat-${Date.now().toString(36)}-${crypto.randomInt(100, 999)}`,
    monsterId: monster.id,
    monsterName: monster.name,
    floor: monFloor,
    killerName: killerChar.name,
    killerCharacterId: killerChar.id,
    ...(opts?.defeatCause ? { defeatCause: opts.defeatCause } : {}),
    xpGained,
    goldGained,
    manaStonesGained,
    manaStoneDroppedOnMap: Boolean(opts?.manaStoneDroppedOnMap),
    chestDropped,
    items,
    leveledUp: xpRes.levelsGained > 0,
    newLevel: xpRes.level,
  };
  ctx.state.recentMonsterDefeats = [summary, ...(ctx.state.recentMonsterDefeats || [])].slice(0, 20);
  if (opts?.defeatCause) {
    logPlayerHistory(
      ctx.state,
      killerChar.id,
      'combat',
      `Defeated ${monster.name} via ${opts.defeatCause} (+${xpGained} XP, +${goldGained}g)`,
    );
  }
  return summary;
}

export function resolveReactionAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const idx = ctx.state.pendingReactions.findIndex((r) => r.id === payload.reactionId);
  if (idx === -1) return { status: 404, error: 'Reaction window expired or already resolved.' };
  const reaction = ctx.state.pendingReactions[idx];
  const ch = ctx.state.characters[reaction.targetCharacterId];
  if (!ch) return { status: 404, error: 'Character not found.' };
  if (ctx.role !== 'dm' && ctx.characterId && ctx.characterId !== ch.id) {
    return { status: 403, error: 'Players can only resolve reactions targeting their own character.' };
  }

  const mon = ctx.state.monsters.find((m) => m.id === reaction.monsterId);
  const prevMonHp = mon ? Number(mon.hp ?? 0) : 0;
  let reactionDropBeat: StoryBeat | null = null;
  let reactionMonTokPos: { x: number; y: number } | null = null;
  if (mon) {
    for (const b of ctx.state.storyBeats || []) {
      const foundTok = b.arena?.tokens?.find((t) => t.id === mon.id);
      if (foundTok) {
        reactionDropBeat = b;
        reactionMonTokPos = { x: foundTok.x, y: foundTok.y };
        break;
      }
    }
  }
  const rawChoice = String(payload.choice || 'react');
  const effectiveChoice =
    rawChoice === 'react'
      ? resolvePlayerReactionStyle(ch).style
      : rawChoice === 'defense'
        ? resolvePlayerDefenseReaction(ch).choice
        : rawChoice;
  const reactionStyle: 'parry' | 'block' | 'counter' | undefined =
    effectiveChoice === 'parry' || effectiveChoice === 'block' || effectiveChoice === 'counter'
      ? effectiveChoice
      : undefined;
  const mods = computePassiveModifiers(ch);
  let dmgTaken = 0;
  let counterDamageDealt = 0;
  let stunnedEnemy = false;
  let bleedApplied = false;
  let mitigationPctApplied: number | undefined;
  let summary = '';

  const effectiveTargetDr = (m: Monster) => (mods.ignoreAllEnemyDr ? 0 : Math.max(0, Number(m.dr || 0) - mods.ignoreEnemyDr));

  const applyCounterFormula = (dmgTotal: number, statMod: number) => {
    if (!mon) return 0;
    const scope = buildCharacterVarScope(ch, ctx.state.mechanics, {
      RAW_DMG: dmgTotal,
      STAT_MOD: statMod,
      TARGET_DR: effectiveTargetDr(mon),
      TARGET_AC: Number(mon.ac || 10),
      CRIT_MULT: 1,
    });
    const dealt = Math.max(1, Math.round(evaluateFormula(ctx.state.mechanics.damageFormula, scope)));
    mon.hp = Math.max(0, Number(mon.hp ?? 0) - dealt);
    syncMonsterDerived(ctx, mon.id, { skipAutoLoot: true });
    if (mon.hp <= 0) removeMonsterTokensFromMaps(ctx.state, mon.id);
    return dealt;
  };

  let playerRollNatural = 10;
  let playerRollMod = 0;
  let playerRollTotal = 10;
  let playerRollFormula = '1d20';
  let playerSuccess = false;
  let spellName: string | undefined;
  let spellAccuracyRoll: {
    natural: number;
    mod: number;
    total: number;
    targetAc: number;
    hit: boolean;
    crit: boolean;
  } | null = null;
  let spellDamageRoll: {
    formula: string;
    rolls: number[];
    total: number;
  } | null = null;
  let counterDamageRoll: {
    formula: string;
    rolls: number[];
    sides: number;
    modifier: number;
    total: number;
  } | null = null;

  if (effectiveChoice === 'counter') {
    const weapon = getEquippedTotals(ch).mainWeapon;
    const dmgFormula = String(payload.diceFormula || weapon?.damageDice || '1d8+3');
    const hitBonus = getEquippedTotals(ch).attackBonus + mods.bonusAttackHit + mods.bonusMeleeHit;
    const hitRoll = rollDiceServer({ formula: '1d20', modifier: hitBonus });
    const dmgRoll = rollDiceServer({ formula: dmgFormula });
    counterDamageRoll = {
      formula: dmgRoll.formula,
      rolls: dmgRoll.rolls || [],
      sides: dmgRoll.sides || 8,
      modifier: dmgRoll.modifier || 0,
      total: dmgRoll.total,
    };
    const agiScore = ch.stats?.AGI ?? ch.stats?.STR ?? 12;
    const statMod = computeStatModifier(agiScore, ctx.state.mechanics, ch);

    playerRollNatural = hitRoll.rolls?.[0] ?? hitRoll.diceTotal ?? 10;
    playerRollMod = hitBonus;
    playerRollTotal = hitRoll.total;
    playerRollFormula = hitRoll.formula;
    playerSuccess = hitRoll.total >= 12;

    if (mon) {
      const scope = buildCharacterVarScope(ch, ctx.state.mechanics, {
        RAW_DMG: dmgRoll.total + mods.bonusCounterDamage + mods.bonusWeaponDamage + mods.bonusMeleeDamage,
        STAT_MOD: statMod,
        TARGET_DR: effectiveTargetDr(mon),
        TARGET_AC: Number(mon.ac || 10),
        CRIT_MULT: hitRoll.isCrit ? Math.max(Number(ctx.state.mechanics.critMultiplier || 2), mods.critMultiplier || 0) : 1,
      });
      counterDamageDealt = Math.max(1, Math.round(evaluateFormula(ctx.state.mechanics.damageFormula, scope)));
      mon.hp = Math.max(0, Number(mon.hp ?? 0) - counterDamageDealt);
      syncMonsterDerived(ctx, mon.id, { skipAutoLoot: true });
      if (mon.hp <= 0) removeMonsterTokensFromMaps(ctx.state, mon.id);
    }
    let bleedNote = '';
    if (mon && Number(mon.hp ?? 0) > 0) {
      const bleedChance = computeCounterBleedChancePct(agiScore);
      if (hitRoll.isCrit || crypto.randomInt(1, 101) <= bleedChance) {
        applyUnitEffect(mon, { kind: 'bleed', potency: 3, duration: 3, target: 'enemy' }, 'Counter Bleed', ch.id);
        syncMonsterDerived(ctx, mon.id, { skipAutoLoot: true });
        bleedApplied = true;
        bleedNote = ' & inflicted BLEED (3% max HP/round, 3r)';
      }
    }
    const incomingRes = applyIncomingDamageToCharacter(ctx, ch, reaction.incomingDamage, {
      attackerMonster: mon,
      damageType: 'Monster Strike',
      halveAfterDr: hitRoll.total >= 12,
    });
    dmgTaken = incomingRes.dmgTaken;
    summary = `${ch.name} COUNTER-ATTACKED ${reaction.monsterName} (Roll ${hitRoll.total}) for ${counterDamageDealt} damage${bleedNote} and took ${dmgTaken} dmg!`;
  } else if (effectiveChoice === 'parry') {
    const strPerScore = Math.round((Number(ch.stats?.STR ?? 10) + Number(ch.stats?.PER ?? 10)) / 2);
    const parryMod = computeStatModifier(strPerScore, ctx.state.mechanics, ch) + mods.bonusParryRoll;
    const parryRoll = rollDiceServer({ formula: '1d20', modifier: parryMod });
    playerRollNatural = parryRoll.rolls?.[0] ?? parryRoll.diceTotal ?? 10;
    playerRollMod = parryMod;
    playerRollTotal = parryRoll.total;
    playerRollFormula = parryRoll.formula;
    playerSuccess = parryRoll.total >= reaction.attackTotal;

    if (parryRoll.total >= reaction.attackTotal) {
      dmgTaken = 0;
      let reflectNote = '';
      if (mods.parryReflectPct > 0 && mon) {
        counterDamageDealt = Math.max(1, Math.round((reaction.incomingDamage * mods.parryReflectPct) / 100));
        mon.hp = Math.max(0, Number(mon.hp ?? 0) - counterDamageDealt);
        syncMonsterDerived(ctx, mon.id, { skipAutoLoot: true });
        if (mon.hp <= 0) removeMonsterTokensFromMaps(ctx.state, mon.id);
        reflectNote = ` & reflected ${counterDamageDealt} dmg`;
      }
      let stunNote = '';
      const stunChance = computeParryStunChancePct(Number(ch.stats?.STR ?? 10), Number(ch.stats?.PER ?? 10));
      if (mon && Number(mon.hp ?? 0) > 0 && (parryRoll.isCrit || crypto.randomInt(1, 101) <= stunChance)) {
        applyUnitEffect(mon, { kind: 'stun', potency: 1, duration: 1, target: 'enemy' }, 'Parry Stun', ch.id);
        syncMonsterDerived(ctx, mon.id, { skipAutoLoot: true });
        stunnedEnemy = true;
        stunNote = ` & STUNNED ${reaction.monsterName} (1 turn)`;
      }
      summary = `${ch.name} PARRIED ${reaction.monsterName}'s strike cleanly (Roll ${parryRoll.total} vs ${reaction.attackTotal}) — 0 damage taken${reflectNote}${stunNote}!`;
    } else {
      const incomingRes = applyIncomingDamageToCharacter(ctx, ch, reaction.incomingDamage, {
        attackerMonster: mon,
        damageType: 'Monster Strike',
        halveAfterDr: true,
      });
      dmgTaken = incomingRes.dmgTaken;
      summary = `${ch.name} partially parried ${reaction.monsterName}'s strike (${parryRoll.total}) — took halved ${dmgTaken} dmg.`;
    }
  } else if (effectiveChoice === 'block') {
    const vitScore = Number(ch.stats?.VIT ?? 10);
    const blockMod = computeStatModifier(vitScore, ctx.state.mechanics, ch) + mods.bonusParryRoll;
    const blockRoll = rollDiceServer({ formula: '1d20', modifier: blockMod });
    playerRollNatural = blockRoll.rolls?.[0] ?? blockRoll.diceTotal ?? 10;
    playerRollMod = blockMod;
    playerRollTotal = blockRoll.total;
    playerRollFormula = blockRoll.formula;
    const blocked = blockRoll.isCrit || (!blockRoll.isFumble && blockRoll.total >= reaction.attackTotal);
    playerSuccess = blocked;
    const fullMitPct = computeBlockMitigationPct(vitScore);

    if (blocked) {
      mitigationPctApplied = fullMitPct;
      const incomingRes = applyIncomingDamageToCharacter(ctx, ch, reaction.incomingDamage, {
        attackerMonster: mon,
        damageType: 'Monster Strike',
        mitigationPct: fullMitPct,
      });
      dmgTaken = incomingRes.dmgTaken;
      summary = `${ch.name} BLOCKED ${reaction.monsterName}'s strike (Roll ${blockRoll.total} vs ${reaction.attackTotal}) — mitigated ${fullMitPct}% (${dmgTaken} dmg taken)!`;
    } else {
      const partialMitPct = Math.max(10, Math.round(fullMitPct / 2));
      mitigationPctApplied = partialMitPct;
      const incomingRes = applyIncomingDamageToCharacter(ctx, ch, reaction.incomingDamage, {
        attackerMonster: mon,
        damageType: 'Monster Strike',
        mitigationPct: partialMitPct,
      });
      dmgTaken = incomingRes.dmgTaken;
      summary = `${ch.name} partially blocked ${reaction.monsterName}'s strike (Roll ${blockRoll.total}) — mitigated ${partialMitPct}% (${dmgTaken} dmg taken).`;
    }
  } else if (effectiveChoice === 'dodge') {
    const agiScore = Number(ch.stats?.AGI ?? 10);
    const dodgeMod = computeStatModifier(agiScore, ctx.state.mechanics, ch);
    const dodgeRoll = rollDiceServer({ formula: '1d20', modifier: dodgeMod });
    playerRollNatural = dodgeRoll.rolls?.[0] ?? dodgeRoll.diceTotal ?? 10;
    playerRollMod = dodgeMod;
    playerRollTotal = dodgeRoll.total;
    playerRollFormula = dodgeRoll.formula;
    const dodged = dodgeRoll.isCrit || (!dodgeRoll.isFumble && dodgeRoll.total >= reaction.attackTotal);
    playerSuccess = dodged;

    if (dodged) {
      dmgTaken = 0;
      summary = `${ch.name} DODGED ${reaction.monsterName}'s strike (Roll ${dodgeRoll.total} vs ${reaction.attackTotal}) — 0 damage taken!`;
    } else {
      const incomingRes = applyIncomingDamageToCharacter(ctx, ch, reaction.incomingDamage, {
        attackerMonster: mon,
        damageType: 'Monster Strike',
      });
      dmgTaken = incomingRes.dmgTaken;
      summary = `${ch.name} failed to dodge ${reaction.monsterName}'s strike (Roll ${dodgeRoll.total} vs ${reaction.attackTotal}) — took ${dmgTaken} dmg!`;
    }
  } else if (effectiveChoice === 'spell') {
    const spell = payload.spellId
      ? ((ch.spells || []).find((s) => s.id === payload.spellId) || ctx.state.grimoire.find((s) => s.id === payload.spellId))
      : (ch.spells || []).find((s) => s.actionType === 'Reaction');
    if (!spell) {
      return { status: 400, error: 'No reaction spell selected or learned.' };
    }
    if (spell.actionType !== 'Reaction') {
      return { status: 400, error: 'Only Reaction spells can be cast during an opposed clash.' };
    }
    const isSelfOnly = Boolean(
      spell.effectSpec &&
      (spell.effectSpec.target === 'self' || UNIT_EFFECT_META[spell.effectSpec.kind]?.defaultTarget === 'self') &&
      !spell.damageDice,
    );
    if (!isSelfOnly && reactionDropBeat?.arena && reactionMonTokPos) {
      const playerTok = reactionDropBeat.arena.tokens?.find((t) => t.id === ch.id);
      if (playerTok) {
        const dist = spaceDistanceBetweenPoints(playerTok.x, playerTok.y, reactionMonTokPos.x, reactionMonTokPos.y);
        const spellRange = Math.max(1, Number(spell.rangeSpaces || 3));
        if (dist > spellRange) {
          return {
            status: 400,
            error: `${spell.name} is out of range (max ${spellRange} Spaces, target is ${dist} away).`,
          };
        }
      }
    }
    ch.combatPassiveFlags = ch.combatPassiveFlags || {};
    const rawCost = Number(spell.mpCost || 0);
    const isFirstSpell = Number(ch.combatPassiveFlags.spellsCastThisCombat || 0) === 0;
    const mpCost = mods.zeroCostAllSpells || (mods.zeroCostFirstSpell && isFirstSpell)
      ? 0
      : rawCost > 0
        ? Math.max(1, rawCost - mods.spellMpDiscount)
        : 0;
    if (ch.mp < mpCost) {
      return { status: 400, error: `Not enough ${ctx.state.mechanics.resourceName || 'Mana'} to cast ${spell.name} (needs ${mpCost} MP).` };
    }
    ch.mp = Math.max(0, ch.mp - mpCost);
    ch.combatPassiveFlags.spellsCastThisCombat = Number(ch.combatPassiveFlags.spellsCastThisCombat || 0) + 1;
    spellName = spell.name;

    const intMod = computeStatModifier(ch.stats?.INT ?? 12, ctx.state.mechanics, ch);
    const accMod = intMod + mods.bonusAttackHit + mods.bonusSpellHit + mods.bonusReactionSpellHit;
    const accRoll = rollDiceServer({ formula: '1d20', modifier: accMod });
    const targetAc = Math.max(1, Number(mon?.ac || 10));
    const spellHit = isSelfOnly || accRoll.isCrit || (!accRoll.isFumble && accRoll.total >= targetAc);

    playerRollNatural = accRoll.rolls?.[0] ?? accRoll.diceTotal ?? 10;
    playerRollMod = accMod;
    playerRollTotal = accRoll.total;
    playerRollFormula = accRoll.formula;
    spellAccuracyRoll = {
      natural: playerRollNatural,
      mod: accMod,
      total: accRoll.total,
      targetAc,
      hit: spellHit,
      crit: accRoll.isCrit,
    };

    if (spellHit) {
      playerSuccess = true;
      if (!isSelfOnly) {
        const dmgFormula = spell.damageDice || '2d6';
        const spellRoll = rollDiceServer({ formula: dmgFormula });
        spellDamageRoll = {
          formula: dmgFormula,
          rolls: spellRoll.rolls || [],
          total: spellRoll.total,
        };
        if (mon) {
          let bonusDiceTotal = 0;
          for (const d of mods.bonusReactionSpellDice) {
            bonusDiceTotal += rollDiceServer({ formula: d }).total;
          }
          counterDamageDealt = applyCounterFormula(spellRoll.total + bonusDiceTotal + mods.bonusSpellPower, intMod);
        }
      }
      if (spell.effectSpec && UNIT_EFFECT_META[spell.effectSpec.kind]) {
        const isSelfBuff =
          spell.effectSpec.target === 'self' ||
          UNIT_EFFECT_META[spell.effectSpec.kind].defaultTarget === 'self';
        if (isSelfBuff) {
          applyUnitEffect(ch, spell.effectSpec, spell.name, ch.id);
          syncCharacterDerived(ctx, ch.id);
        } else if (mon && Number(mon.hp ?? 0) > 0) {
          applyUnitEffect(mon, spell.effectSpec, spell.name, ch.id);
          syncMonsterDerived(ctx, mon.id);
        }
      }
      const incomingRes = applyIncomingDamageToCharacter(ctx, ch, reaction.incomingDamage, {
        attackerMonster: mon,
        damageType: 'Monster Strike',
        halveAfterDr: true,
      });
      dmgTaken = incomingRes.dmgTaken;
      summary = `${ch.name}'s ${spell.name} HIT (Roll ${accRoll.total}), dealing ${counterDamageDealt} damage to ${reaction.monsterName} (took ${dmgTaken} dmg)!`;
    } else {
      playerSuccess = false;
      const incomingRes = applyIncomingDamageToCharacter(ctx, ch, reaction.incomingDamage, {
        attackerMonster: mon,
        damageType: 'Monster Strike',
      });
      dmgTaken = incomingRes.dmgTaken;
      summary = `${ch.name}'s ${spell.name} MISSED (Roll ${accRoll.total}) — took ${dmgTaken} dmg!`;
    }
  } else {
    playerRollNatural = 1;
    playerRollMod = 0;
    playerRollTotal = 1;
    playerRollFormula = 'Direct Hit';
    playerSuccess = false;
    const incomingRes = applyIncomingDamageToCharacter(ctx, ch, reaction.incomingDamage, {
      attackerMonster: mon,
      damageType: 'Monster Strike',
    });
    dmgTaken = incomingRes.dmgTaken;
    summary = `${ch.name} took ${dmgTaken} damage from ${reaction.monsterName}.`;
  }

  const resolvedClash = {
    ...reaction,
    resolved: true,
    resolvedAt: new Date().toISOString(),
    playerChoice: effectiveChoice,
    ...(reactionStyle ? { reactionStyle } : {}),
    ...(spellName ? { spellName } : {}),
    ...(spellAccuracyRoll ? { spellAccuracyRoll } : {}),
    ...(spellDamageRoll ? { spellDamageRoll } : {}),
    ...(counterDamageRoll ? { counterDamageRoll } : {}),
    playerRollNatural,
    playerRollMod,
    playerRollTotal,
    playerRollFormula,
    playerSuccess,
    dmgTaken,
    counterDamageDealt,
    ...(stunnedEnemy ? { stunnedEnemy } : {}),
    ...(bleedApplied ? { bleedApplied } : {}),
    ...(mitigationPctApplied !== undefined ? { mitigationPct: mitigationPctApplied } : {}),
    resolutionSummary: summary,
  };
  ctx.state.lastResolvedClash = resolvedClash;
  ctx.state.pendingReactions.splice(idx, 1);
  ctx.state.combatLog.unshift({
    id: `cblog-${Date.now()}`,
    timestamp: new Date().toISOString(),
    attacker: ch.name,
    target: reaction.monsterName,
    rawDamage: counterDamageDealt,
    finalDamage: counterDamageDealt,
    damageType: `Reaction (${effectiveChoice})`,
    remainingHp: mon ? mon.hp : null,
    summary,
  });
  ctx.state.combatLog = ctx.state.combatLog.slice(0, 60);

  let defeatSummary: MonsterDefeatSummary | null = null;
  if (mon && prevMonHp > 0 && Number(mon.hp ?? 0) <= 0) {
    defeatSummary = awardMonsterDefeatLoot(ctx, mon, ch, {
      dropBeat: reactionDropBeat,
      monTokPos: reactionMonTokPos,
    });
  }

  const prevDefeatIds = new Set((ctx.state.recentMonsterDefeats || []).map((d) => d.id).filter(Boolean));
  commitState(ctx);
  runAiDmTurns(
    ctx,
    { initiativeAction, monsterAttackAction },
    { advanceCurrentMonsterFirst: true },
  );
  const postRunDefeats = (ctx.state.recentMonsterDefeats || []).filter(
    (d) => d.id && !prevDefeatIds.has(d.id) && d.killerCharacterId === ch.id,
  );
  const allDefeats: MonsterDefeatSummary[] = [
    ...(defeatSummary ? [defeatSummary] : []),
    ...postRunDefeats,
  ];
  return {
    ok: true,
    counterDamageDealt,
    dmgTaken,
    monster: mon ? maskMonsterForRole(mon, ctx.state, ctx.role, ctx.characterId) : null,
    character: ch,
    summary,
    resolvedClash,
    ...(allDefeats[0] ? { defeatSummary: allDefeats[0] } : {}),
    ...(allDefeats.length > 0 ? { defeatSummaries: allDefeats } : {}),
  };
}

export function inflictDamageAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const isDm = ctx.role === 'dm';
  const monster = ctx.state.monsters.find((m) => m.id === payload.monsterId);
  if (!monster) return { status: 404, error: 'Target monster not found.' };

  const attackerId = isDm && payload.attackerId ? String(payload.attackerId) : ctx.characterId;
  const attackerChar = attackerId ? ctx.state.characters[attackerId] : (payload.attackerId && isDm ? ctx.state.characters[String(payload.attackerId)] : null);
  const attackerName = attackerChar?.name || (payload.attackerName ? String(payload.attackerName) : (isDm ? 'Dungeon Master' : 'Player'));
  const damageType = String(payload.damageType || 'Physical').slice(0, 24);
  let isCrit = Boolean(payload.isCrit);

  let friendlyAlly = null;
  let atkTokForTurn = null;

  if (!isDm && payload.beatId && attackerChar) {
    const beat = (ctx.state.storyBeats || []).find((b) => b.id === payload.beatId);
    if (beat?.arena) {
      const beatHasLiveMonsters = (beat.arena.tokens || []).some((t) => t.type === 'monster');
      const activeComb = ctx.state.combat?.combatants?.[ctx.state.combat?.turnIndex ?? 0];
      const hasBeatCombatants = (ctx.state.combat?.combatants || []).some((c) => (beat.arena?.tokens || []).some((t) => t.id === c.id));
      if (beatHasLiveMonsters && hasBeatCombatants && activeComb && activeComb.id !== attackerChar.id && !payload.isReaction) {
        return {
          status: 400,
          error: `It is currently ${activeComb.name}'s turn! Wait for your turn to act.`,
        };
      }
    }
    const atkTok = beat?.arena?.tokens?.find((t) => t.id === attackerChar.id);
    const monTok = beat?.arena?.tokens?.find((t) => t.id === monster.id);
    if (atkTok) {
      atkTokForTurn = atkTok;
      if (!payload.isSpell && atkTok.hasCastSpellThisTurn) {
        return { status: 400, error: 'You have already cast a spell this turn! Wait until your next turn.' };
      }
      const floor = Math.max(1, Number(beat?.floor || attackerChar?.currentFloor || ctx.state.map?.currentFloor || 1));
      const maxAttacks = getMaxAttacksForFloor(floor);
      const used = Number(atkTok.attacksUsedThisTurn || 0);
      if (used >= maxAttacks) {
        return { status: 400, error: `You have already used your attack (${used}/${maxAttacks}) this turn! Wait until your next turn.` };
      }
    }
    if (atkTok && monTok && beat) {
      const dist = Math.max(Math.abs(monTok.x - atkTok.x), Math.abs(monTok.y - atkTok.y));
      const { isRanged, maxRange } = getWeaponAttackInfo(attackerChar);
      if (dist > maxRange) {
        return {
          status: 400,
          error: `Out of attack range! (${isRanged ? 'Ranged' : 'Melee'} max ${maxRange} Space${maxRange > 1 ? 's' : ''}, target is ${dist} away).`,
        };
      }
      if (isRanged) {
        const lineCells = getGridLineCells(atkTok.x, atkTok.y, monTok.x, monTok.y);
        const friendlyTok = lineCells
          .map((c) => (beat.arena.tokens || []).find((t) => t.type === 'player' && t.id !== attackerChar.id && t.x === c.x && t.y === c.y))
          .find(Boolean);
        if (friendlyTok && ctx.state.characters[friendlyTok.id]) {
          friendlyAlly = ctx.state.characters[friendlyTok.id];
        }
      }
    }
  }

  const attackerMods = attackerChar ? computePassiveModifiers(attackerChar) : null;
  const attackerEffMods = attackerChar ? computeActiveEffectModifiers(attackerChar.activeEffects) : computeActiveEffectModifiers(undefined);
  if (attackerChar && attackerEffMods.stunned) {
    return { status: 400, error: `${attackerName} is Stunned and cannot attack this turn!` };
  }
  const monEffMods = computeActiveEffectModifiers(monster.activeEffects);
  const auraMods = attackerChar ? getAllyAuraBonuses(ctx.state, attackerChar) : { hitBonus: 0, dmgBonus: 0, acBonus: 0, drBonus: 0 };
  const isSpellAttack = Boolean(payload.isSpell);
  const { isRanged } = attackerChar ? getWeaponAttackInfo(attackerChar) : { isRanged: false };

  let attackRoll: {
    natural: number;
    total: number;
    targetAc: number;
    hit: boolean;
    crit: boolean;
    fumble: boolean;
    breakdown: string;
  } | null = null;
  if (payload.attackRoll && attackerChar && attackerMods) {
    attackerChar.combatPassiveFlags = attackerChar.combatPassiveFlags || {};
    const targetAc = Math.max(1, (Number.isFinite(Number(monster.ac)) ? Number(monster.ac) : 10) + monEffMods.acDelta);
    let natural = rollDiceServer({ formula: '1d20' }).rolls[0];
    if (natural === 1 && attackerMods.rerollNat1PerCombat && !attackerChar.combatPassiveFlags.rerolledNat1ThisCombat) {
      attackerChar.combatPassiveFlags.rerolledNat1ThisCombat = true;
      natural = rollDiceServer({ formula: '1d20' }).rolls[0];
    }
    const mechanicsStats = ctx.state.mechanics.stats;
    const hitStatKey = isSpellAttack && attackerChar.stats?.INT !== undefined
      ? 'INT'
      : isRanged && attackerChar.stats?.AGI !== undefined
        ? 'AGI'
        : attackerChar.stats?.STR !== undefined
          ? 'STR'
          : mechanicsStats[0]?.key || 'STR';
    const hitStatMod = computeStatModifier(Number(attackerChar.stats?.[hitStatKey] ?? 10), ctx.state.mechanics, attackerChar);
    const passiveHitBonus =
      attackerMods.bonusAttackHit
      + (isSpellAttack ? attackerMods.bonusSpellHit : isRanged ? attackerMods.bonusRangedHit : attackerMods.bonusMeleeHit)
      + (ctx.state.combat.round <= 1 ? attackerMods.round1HitBonus : 0)
      + auraMods.hitBonus
      + attackerEffMods.hitDelta;
    const hitScope = buildCharacterVarScope(attackerChar, ctx.state.mechanics, {
      ROLL: natural,
      STAT_MOD: hitStatMod,
      TARGET_AC: targetAc,
    });
    let total = natural + hitStatMod + passiveHitBonus;
    try {
      total = Math.round(evaluateFormula(ctx.state.mechanics.hitFormula, hitScope)) + passiveHitBonus;
    } catch {
      // Fall back to d20 + stat modifier if a custom hit formula is malformed
    }
    const baseCritThreshold = Math.max(2, Number(ctx.state.mechanics.critThreshold || 20));
    const critThreshold = attackerMods.critThreshold !== null ? Math.min(baseCritThreshold, attackerMods.critThreshold) : baseCritThreshold;
    const crit = natural >= critThreshold;
    const fumble = natural === 1;
    let hit = crit || (!fumble && total >= targetAc);
    let luckyStarNote = '';
    if (!hit && attackerMods.turnMissToHitPerCombat && !attackerChar.combatPassiveFlags.luckyStarUsedThisCombat) {
      attackerChar.combatPassiveFlags.luckyStarUsedThisCombat = true;
      hit = true;
      luckyStarNote = ' [Lucky Star!]';
    }
    attackRoll = {
      natural,
      total,
      targetAc,
      hit,
      crit,
      fumble: fumble && !hit,
      breakdown: `d20 [${natural}] → ${total} vs AC ${targetAc}${luckyStarNote}`,
    };
    isCrit = crit;

    if (!hit) {
      if (atkTokForTurn) atkTokForTurn.attacksUsedThisTurn = Number(atkTokForTurn.attacksUsedThisTurn || 0) + 1;
      logPlayerHistory(ctx.state, attackerChar.id, 'combat', `Missed ${monster.name} (${attackRoll.breakdown})`);
      const missEntry = {
        id: `cblog-${Date.now()}-${crypto.randomInt(10, 99)}`,
        timestamp: new Date().toISOString(),
        attacker: attackerName,
        target: monster.name,
        targetId: monster.id,
        rawDamage: 0,
        finalDamage: 0,
        damageType,
        isCrit: false,
        remainingHp: monster.hp,
        maxHp: monster.maxHp,
        summary: `${attackerName} attacked ${monster.name} and MISSED (${attackRoll.breakdown})${fumble ? ' [Natural 1!]' : ''}.`,
      };
      ctx.state.combatLog.unshift(missEntry);
      ctx.state.combatLog = ctx.state.combatLog.slice(0, 60);
      commitState(ctx);
      return {
        ok: true,
        miss: true,
        hit: false,
        finalDamage: 0,
        attackRoll,
        monster: maskMonsterForRole(monster, ctx.state, ctx.role, ctx.characterId),
        logEntry: missEntry,
      };
    }
  }

  let rawDamage = Number(payload.rawDamage ?? 0);
  let rollDetails = null;
  if (payload.diceFormula) {
    rollDetails = rollDiceServer({
      formula: String(payload.diceFormula),
      mode: String(payload.mode || 'normal'),
    });
    rawDamage = rollDetails.total;
  }
  rawDamage = Math.max(0, Math.round(rawDamage));

  let passiveFlatBonus = 0;
  let passiveDiceBonus = 0;
  const passiveNotes: string[] = [];

  if (attackerChar && attackerMods) {
    if (isSpellAttack) {
      passiveFlatBonus += attackerMods.bonusSpellPower;
      if (/fire|earth|wind|water|light|dark/i.test(damageType)) {
        passiveFlatBonus += attackerMods.bonusElementalSpellDamage;
        for (const [el, val] of Object.entries(attackerMods.elementalBonusDamage)) {
          if (damageType.toLowerCase().includes(el.toLowerCase())) passiveFlatBonus += val;
        }
        for (const [el, diceArr] of Object.entries(attackerMods.elementalBonusDice)) {
          if (damageType.toLowerCase().includes(el.toLowerCase())) {
            for (const d of diceArr) passiveDiceBonus += rollDiceServer({ formula: d }).total;
          }
        }
      }
      for (const d of attackerMods.bonusSpellDice) passiveDiceBonus += rollDiceServer({ formula: d }).total;
    } else {
      passiveFlatBonus += attackerMods.bonusWeaponDamage + (isRanged ? attackerMods.bonusRangedDamage : attackerMods.bonusMeleeDamage) + auraMods.dmgBonus;
      for (const d of attackerMods.bonusWeaponDice) passiveDiceBonus += rollDiceServer({ formula: d }).total;
      if (atkTokForTurn?.hasMovedThisTurn) {
        for (const d of attackerMods.moveChargeBonusDice) passiveDiceBonus += rollDiceServer({ formula: d }).total;
      }
    }

    if ((atkTokForTurn?.attacksUsedThisTurn || 0) >= 1 && attackerMods.secondAttackBonusDamage > 0) {
      passiveFlatBonus += attackerMods.secondAttackBonusDamage;
    }
    if (ctx.state.combat.round <= 1 && attackerMods.round1DamageBonus > 0) {
      passiveFlatBonus += attackerMods.round1DamageBonus;
    }
    if (attackerMods.lowHpDamageBonus > 0 && attackerChar.maxHp > 0 && (attackerChar.hp / attackerChar.maxHp) * 100 <= attackerMods.lowHpThresholdPct) {
      passiveFlatBonus += attackerMods.lowHpDamageBonus;
    }
    if (attackerMods.damageBonusVsLowLevel > 0 && Number(monster.floor || 1) <= 10) {
      passiveFlatBonus += attackerMods.damageBonusVsLowLevel;
    }
    if (attackerMods.damageBonusVsHighDr > 0 && Number(monster.dr || 0) >= 2) {
      passiveFlatBonus += attackerMods.damageBonusVsHighDr;
    }
    if (isCrit) {
      passiveFlatBonus += attackerMods.bonusCritDamage;
      for (const d of attackerMods.bonusCritDice) passiveDiceBonus += rollDiceServer({ formula: d }).total;
    }
    if (monster.maxHp && Number(monster.hp ?? 0) <= monster.maxHp * 0.5) {
      for (const d of attackerMods.executeBonusDice) passiveDiceBonus += rollDiceServer({ formula: d }).total;
    }
  }

  let appliedStatMod = 0;
  let appliedTargetDr = 0;
  let appliedCritMult = 1;
  let finalDamage = Math.max(0, rawDamage + passiveFlatBonus + passiveDiceBonus + attackerEffMods.dmgDelta);
  if (!payload.ignoreFormula) {
    const primaryStatKey = ctx.state.mechanics.stats[0]?.key || 'STR';
    const statScore = attackerChar?.stats?.[String(payload.statKey || primaryStatKey)] ?? 10;
    const statMod = payload.includeStatMod ? computeStatModifier(statScore, ctx.state.mechanics, attackerChar) : 0;
    const effectiveTargetDr = Math.max(
      0,
      (attackerMods
        ? (attackerMods.ignoreAllEnemyDr ? 0 : Math.max(0, Number(monster.dr || 0) - attackerMods.ignoreEnemyDr))
        : Number(monster.dr || 0)) + monEffMods.drDelta,
    );
    const critMult = isCrit
      ? Math.max(Number(ctx.state.mechanics.critMultiplier || 2), attackerMods?.critMultiplier || 0)
      : 1;
    appliedStatMod = statMod;
    appliedTargetDr = effectiveTargetDr;
    appliedCritMult = critMult;
    const scope = buildCharacterVarScope(attackerChar, ctx.state.mechanics, {
      RAW_DMG: rawDamage + passiveFlatBonus + passiveDiceBonus + attackerEffMods.dmgDelta,
      STAT_MOD: statMod,
      TARGET_DR: effectiveTargetDr,
      TARGET_AC: Math.max(1, Number(monster.ac || 10) + monEffMods.acDelta),
      CRIT_MULT: critMult,
    });
    finalDamage = Math.max(0, Math.round(evaluateFormula(ctx.state.mechanics.damageFormula, scope)));
  }

  if (attackerMods && attackerMods.damageBonusVsBossPct > 0 && (/boss|elite|dragon|monarch|lord|king|titan|guardian/i.test(monster.name) || Number(monster.maxHp || 0) >= 100)) {
    finalDamage = Math.round(finalDamage * (1 + attackerMods.damageBonusVsBossPct / 100));
    passiveNotes.push(`Apex Predator +${attackerMods.damageBonusVsBossPct}%`);
  }

  const weakSpot = attackerChar?.observedWeakSpots?.[monster.id];
  let weakSpotBonusApplied = 0;
  if (weakSpot) {
    weakSpotBonusApplied = Number(weakSpot.bonusDamage || 0) + (isCrit ? Number(weakSpot.bonusCritDamage || 0) : 0);
    finalDamage += weakSpotBonusApplied;
  }

  if (atkTokForTurn) {
    if (isCrit && attackerMods?.bonusWeaponAttackOnCrit && !isSpellAttack) {
      passiveNotes.push('Relentless Assault: Bonus Strike!');
    } else {
      atkTokForTurn.attacksUsedThisTurn = Number(atkTokForTurn.attacksUsedThisTurn || 0) + 1;
    }
  }

  if (friendlyAlly && attackerChar) {
    const prevAllyHp = friendlyAlly.hp;
    friendlyAlly.hp = Math.max(0, friendlyAlly.hp - finalDamage);
    syncCharacterDerived(ctx, friendlyAlly.id);
    logPlayerHistory(ctx.state, attackerChar.id, 'combat', `FRIENDLY FIRE! Arrow struck ${friendlyAlly.name} for ${finalDamage} ${damageType} damage!`);
    const ffEntry = {
      id: `cblog-${Date.now()}-${crypto.randomInt(10, 99)}`,
      timestamp: new Date().toISOString(),
      attacker: attackerName,
      target: friendlyAlly.name,
      targetId: friendlyAlly.id,
      rawDamage,
      finalDamage,
      damageType,
      isCrit,
      rollDetails,
      remainingHp: friendlyAlly.hp,
      maxHp: friendlyAlly.maxHp,
      summary: `FRIENDLY FIRE! ${attackerName}'s ranged shot hit ${friendlyAlly.name} for ${finalDamage} ${damageType} damage (HP: ${prevAllyHp} -> ${friendlyAlly.hp}/${friendlyAlly.maxHp})!`,
    };
    ctx.state.combatLog.unshift(ffEntry);
    ctx.state.combatLog = ctx.state.combatLog.slice(0, 60);
    pushSystemToast(ctx, {
      title: 'FRIENDLY FIRE!',
      message: ffEntry.summary,
      category: 'combat',
    });
    commitState(ctx);
    return {
      ok: true,
      friendlyFire: true,
      finalDamage,
      ally: friendlyAlly,
      monster: maskMonsterForRole(monster, ctx.state, ctx.role, ctx.characterId),
      logEntry: ffEntry,
    };
  }

  const prevHp = Number(monster.hp ?? 0);
  monster.hp = Math.max(0, prevHp - finalDamage);
  if (attackerChar && attackerMods && attackerMods.shredEnemyDr > 0 && finalDamage > 0) {
    monster.dr = Math.max(0, Number(monster.dr || 0) - attackerMods.shredEnemyDr);
    passiveNotes.push(`Armor Shred -${attackerMods.shredEnemyDr} DR`);
  }
  if (attackerChar) {
    logPlayerHistory(ctx.state, attackerChar.id, 'combat', `Dealt ${finalDamage} ${damageType} damage to ${monster.name} (${monster.hp}/${monster.maxHp} HP left)`);
  }
  syncMonsterDerived(ctx, monster.id, { skipAutoLoot: true });

  // Lifesteal & on-hit MP restore
  if (attackerChar && attackerMods && finalDamage > 0) {
    let healGain = 0;
    if (isSpellAttack) {
      if (attackerMods.spellLifestealPct > 0) {
        healGain += Math.max(1, Math.round((finalDamage * attackerMods.spellLifestealPct) / 100));
      }
      for (const [el, amt] of Object.entries(attackerMods.spellLifestealHp)) {
        if (damageType.toLowerCase().includes(el.toLowerCase())) healGain += amt;
      }
      for (const [el, mpAmt] of Object.entries(attackerMods.spellMpOnHit)) {
        if (damageType.toLowerCase().includes(el.toLowerCase())) {
          attackerChar.mp = Math.min(attackerChar.maxMp, attackerChar.mp + mpAmt);
          passiveNotes.push(`+${mpAmt} MP`);
        }
      }
    } else {
      const lsPct = attackerMods.lifestealAllPct > 0
        ? attackerMods.lifestealAllPct
        : (!isRanged ? attackerMods.lifestealMeleePct : 0);
      if (lsPct > 0) {
        healGain += Math.max(2, Math.round((finalDamage * lsPct) / 100));
      }
    }
    if (healGain > 0) {
      attackerChar.hp = Math.min(attackerChar.maxHp, attackerChar.hp + healGain);
      syncCharacterDerived(ctx, attackerChar.id);
      passiveNotes.push(`+${healGain} HP Lifesteal`);
    }
  }

  // Multi-target passives (Omnislash / Cosmic Singularity)
  if (attackerChar && attackerMods && (attackerMods.hitAdditionalNearbyFoe || (isSpellAttack && attackerMods.aoeAllEnemiesWithin4Spaces))) {
    const activeBeat = (ctx.state.storyBeats || []).find((b) => b.presented && b.status === 'active');
    const monTok = activeBeat?.arena?.tokens?.find((t) => t.id === monster.id);
    if (activeBeat && monTok) {
      const maxDist = isSpellAttack && attackerMods.aoeAllEnemiesWithin4Spaces ? 4 : 2;
      const maxTargets = isSpellAttack && attackerMods.aoeAllEnemiesWithin4Spaces ? 99 : 1;
      let hitExtras = 0;
      for (const otherTok of activeBeat.arena.tokens || []) {
        if (hitExtras >= maxTargets) break;
        if (otherTok.type !== 'monster' || otherTok.id === monster.id) continue;
        const otherMon = ctx.state.monsters.find((m) => m.id === otherTok.id && Number(m.hp ?? 0) > 0);
        if (!otherMon) continue;
        const dist = Math.max(Math.abs(otherTok.x - monTok.x), Math.abs(otherTok.y - monTok.y));
        if (dist <= maxDist) {
          otherMon.hp = Math.max(0, Number(otherMon.hp ?? 0) - finalDamage);
          syncMonsterDerived(ctx, otherMon.id, { skipAutoLoot: true });
          if (otherMon.hp <= 0) removeMonsterTokensFromMaps(ctx.state, otherMon.id);
          hitExtras += 1;
        }
      }
      if (hitExtras > 0) passiveNotes.push(`Splash hit ${hitExtras} nearby foe${hitExtras > 1 ? 's' : ''}`);
    }
  }

  // Player / Skill / Spell Attack Area + Size Modifier (AoE)
  const rawPlayerArea = payload.attackArea ? String(payload.attackArea) : '';
  const effectivePlayerArea: AttackArea = MONSTER_ATTACK_AREAS.includes(rawPlayerArea as AttackArea)
    ? (rawPlayerArea as AttackArea)
    : (attackerChar?.equipment?.mainHand?.attackArea || 'single');
  const effectivePlayerMod = clampAttackAreaModifier(
    payload.attackAreaModifier !== undefined
      ? payload.attackAreaModifier
      : (attackerChar?.equipment?.mainHand?.attackAreaModifier ?? 0),
  );
  const targetsHit: string[] = [monster.id];
  let playerAffectedCells: Array<{ x: number; y: number }> = [];
  if (attackerChar && (effectivePlayerArea !== 'single' || effectivePlayerMod > 0)) {
    const aoeBeat = (payload.beatId
      ? (ctx.state.storyBeats || []).find((b) => b.id === payload.beatId)
      : undefined)
      || (ctx.state.storyBeats || []).find(
        (b) => b.status !== 'resolved'
          && (b.arena?.tokens || []).some((t) => t.id === attackerChar.id)
          && (b.arena?.tokens || []).some((t) => t.id === monster.id),
      );
    const atkTok = aoeBeat?.arena?.tokens?.find((t) => t.id === attackerChar.id);
    const monTok = aoeBeat?.arena?.tokens?.find((t) => t.id === monster.id);
    if (aoeBeat?.arena && atkTok && monTok) {
      const { maxRange } = getWeaponAttackInfo(attackerChar);
      const areaRes = computeAttackAreaCells({
        monsterX: atkTok.x,
        monsterY: atkTok.y,
        targetX: monTok.x,
        targetY: monTok.y,
        attackArea: effectivePlayerArea,
        areaModifier: effectivePlayerMod,
        rangeSpaces: Number(payload.rangeSpaces || maxRange || 1),
        cols: aoeBeat.arena.cols || 20,
        rows: aoeBeat.arena.rows || 20,
        isSkill: Boolean(payload.isSkill || isSpellAttack),
      });
      playerAffectedCells = areaRes.affectedCells;
      const cellSet = new Set(playerAffectedCells.map((c) => `${c.x},${c.y}`));
      const extraHitNames: string[] = [];
      for (const otherTok of aoeBeat.arena.tokens || []) {
        if (otherTok.type !== 'monster' || otherTok.id === monster.id) continue;
        if (!cellSet.has(`${otherTok.x},${otherTok.y}`)) continue;
        const otherMon = ctx.state.monsters.find((m) => m.id === otherTok.id && Number(m.hp ?? 0) > 0);
        if (!otherMon) continue;
        const secDmg = Math.max(0, finalDamage);
        otherMon.hp = Math.max(0, Number(otherMon.hp ?? 0) - secDmg);
        syncMonsterDerived(ctx, otherMon.id, { skipAutoLoot: true });
        if (otherMon.hp <= 0) removeMonsterTokensFromMaps(ctx.state, otherMon.id);
        targetsHit.push(otherMon.id);
        extraHitNames.push(`${otherMon.name} (${otherMon.hp}/${otherMon.maxHp} HP)`);
      }
      if (extraHitNames.length > 0) {
        const areaStr = formatMonsterAttackArea(effectivePlayerArea, effectivePlayerMod);
        passiveNotes.push(`AoE ${areaStr} also hit ${extraHitNames.join(', ')}`);
        pushSystemToast(ctx, {
          title: 'AREA ATTACK!',
          message: `${attackerName}'s ${areaStr} struck ${targetsHit.length} monsters!`,
          category: 'combat',
        });
      }
    }
  }

  // Player attack / skill / spell Heal HP & Buff/Debuff effect application
  const pHealFormula = String(payload.healFormula || attackerChar?.equipment?.mainHand?.healFormula || '').trim();
  if (pHealFormula && attackerChar) {
    const hRoll = rollDiceServer({ formula: pHealFormula });
    const prevChHp = attackerChar.hp;
    const bonusHeal = attackerMods?.healingReceivedBonus || 0;
    attackerChar.hp = Math.min(attackerChar.maxHp, prevChHp + Math.max(1, hRoll.total) + bonusHeal);
    syncCharacterDerived(ctx, attackerChar.id);
    if (attackerChar.hp - prevChHp > 0) {
      passiveNotes.push(`+${attackerChar.hp - prevChHp} HP Heal`);
    }
  }
  const pEffSpec = (payload.effectSpec || attackerChar?.equipment?.mainHand?.effectSpec) as UnitEffectSpec | undefined | null;
  if (pEffSpec && UNIT_EFFECT_META[pEffSpec.kind]) {
    const isSelfBuff = pEffSpec.target === 'self' || UNIT_EFFECT_META[pEffSpec.kind].defaultTarget === 'self';
    if (isSelfBuff && attackerChar) {
      const applied = applyUnitEffect(attackerChar, pEffSpec, attackerName, attackerChar.id);
      syncCharacterDerived(ctx, attackerChar.id);
      passiveNotes.push(`Buff: ${applied.name} (${applied.turnsRemaining}t)`);
    } else {
      for (const hitId of targetsHit) {
        const hitMon = ctx.state.monsters.find((m) => m.id === hitId && Number(m.hp ?? 0) > 0);
        if (!hitMon) continue;
        const applied = applyUnitEffect(hitMon, pEffSpec, attackerName, attackerChar?.id);
        syncMonsterDerived(ctx, hitMon.id);
        passiveNotes.push(`Debuff: ${applied.name} -> ${hitMon.name}`);
      }
    }
  }

  let defeatSummary: MonsterDefeatSummary | null = null;
  if (prevHp > 0 && monster.hp <= 0) {
    let dropBeat = payload.beatId ? (ctx.state.storyBeats || []).find((b) => b.id === payload.beatId) : null;
    let monTokPos = dropBeat?.arena?.tokens?.find((t) => t.id === monster.id);
    if (!monTokPos) {
      for (const b of ctx.state.storyBeats || []) {
        const foundTok = b.arena?.tokens?.find((t) => t.id === monster.id);
        if (foundTok) {
          dropBeat = b;
          monTokPos = foundTok;
          break;
        }
      }
    }
    removeMonsterTokensFromMaps(ctx.state, monster.id);
    if (attackerChar) {
      if (attackerMods) {
        if (attackerMods.hpOnKill > 0) attackerChar.hp = Math.min(attackerChar.maxHp, attackerChar.hp + attackerMods.hpOnKill);
        if (attackerMods.mpOnKill > 0) attackerChar.mp = Math.min(attackerChar.maxMp, attackerChar.mp + attackerMods.mpOnKill);
        if (attackerMods.tempHpOnKill > 0) attackerChar.tempHp = Number(attackerChar.tempHp || 0) + attackerMods.tempHpOnKill;
        if (attackerMods.hpOnKill > 0 || attackerMods.mpOnKill > 0 || attackerMods.tempHpOnKill > 0) {
          syncCharacterDerived(ctx, attackerChar.id);
          passiveNotes.push(`Kill Harvest`);
        }
      }
      const isRangedKill = Boolean(payload.isRangedAttack) || isRanged;
      const killFloor = Math.max(1, Number(monster.floor || 1));
      const killIsBoss = isBossToken(monster.name, monster.iconId) || Number(monster.maxHp || 0) >= 90;
      const killProfile = getFloorLootProfile(killFloor, killIsBoss);
      const shouldDropKillManaStone = crypto.randomInt(1, 101) <= killProfile.manaStoneDropChancePct;
      let manaStonesGained = 0;
      let manaStoneDroppedOnMap = false;
      if (shouldDropKillManaStone && !isRangedKill) {
        attackerChar.currency = attackerChar.currency || { gold: 0, manaStones: 0 };
        attackerChar.currency.manaStones = Number(attackerChar.currency.manaStones || 0) + 1;
        manaStonesGained += 1;
        logPlayerHistory(ctx.state, attackerChar.id, 'loot', `Claimed +1 Mana Stone from defeating ${monster.name}`);
        pushSystemToast(ctx, {
          title: 'MANA STONE CLAIMED!',
          message: `${attackerChar.name} slew ${monster.name} in melee and gained +1 Mana Stone!`,
          category: 'loot',
          target: attackerChar.id,
        });
      } else if (shouldDropKillManaStone && dropBeat?.arena && monTokPos) {
        dropBeat.arena.manaStones = dropBeat.arena.manaStones || [];
        const stone = {
          id: `ms-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
          x: monTokPos.x,
          y: monTokPos.y,
          qty: 1,
          droppedFrom: monster.name,
        };
        dropBeat.arena.manaStones.push(stone);
        manaStoneDroppedOnMap = true;
        pushSystemToast(ctx, {
          title: 'MANA STONE DROPPED!',
          message: `${monster.name} dropped a Mana Stone at (${stone.x + 1}, ${stone.y + 1})!`,
          category: 'loot',
        });
      }

      defeatSummary = awardMonsterDefeatLoot(ctx, monster, attackerChar, {
        manaStoneDroppedOnMap,
        manaStonesGained,
        dropBeat,
        monTokPos: monTokPos ? { x: monTokPos.x, y: monTokPos.y } : null,
      });
    }
  }

  const logEntry = {
    id: `cblog-${Date.now()}-${crypto.randomInt(10, 99)}`,
    timestamp: new Date().toISOString(),
    attacker: attackerName,
    target: monster.name,
    targetId: monster.id,
    rawDamage,
    finalDamage,
    damageType,
    isCrit,
    rollDetails,
    remainingHp: monster.hp,
    maxHp: monster.maxHp,
    summary: `${attackRoll ? `[${attackRoll.crit ? 'CRIT! ' : 'HIT '}${attackRoll.breakdown}] ` : ''}${attackerName} inflicted ${finalDamage} ${damageType} damage to ${monster.name}${weakSpotBonusApplied ? ` [Weak Spot +${weakSpotBonusApplied}]` : ''}${passiveNotes.length ? ` [${passiveNotes.join(', ')}]` : ''} (HP: ${prevHp} -> ${monster.hp}/${monster.maxHp})${monster.hp === 0 ? ' [DEFEATED!]' : ''}`,
  };
  ctx.state.combatLog.unshift(logEntry);
  ctx.state.combatLog = ctx.state.combatLog.slice(0, 60);

  if (rollDetails) {
    ctx.state.rollLog.unshift({
      id: `roll-${Date.now()}-${crypto.randomInt(10, 99)}`,
      timestamp: new Date().toISOString(),
      rollerName: attackerName,
      rollerRole: ctx.role,
      label: `Damage vs ${monster.name} (${damageType})`,
      formula: rollDetails.formula,
      rolls: rollDetails.rolls,
      dropped: rollDetails.dropped,
      modifier: rollDetails.modifier,
      total: finalDamage,
      mode: rollDetails.mode,
      isCrit: isCrit || rollDetails.isCrit,
      isFumble: rollDetails.isFumble,
      isSecret: false,
    });
    ctx.state.rollLog = ctx.state.rollLog.slice(0, 50);
  }

  if (monster.hp === 0 && prevHp > 0) {
    pushSystemToast(ctx, {
      title: 'MONSTER DEFEATED!',
      message: `${attackerName} dealt the finishing blow to ${monster.name}!`,
      category: 'loot',
    });
  }

  commitState(ctx);
  return {
    ok: true,
    hit: true,
    attackRoll,
    damageRoll: rollDetails
      ? {
          formula: rollDetails.formula,
          rolls: rollDetails.rolls,
          diceTotal: rollDetails.rolls.reduce((s, r) => s + r, 0),
          modifier: rollDetails.modifier,
          rawTotal: rawDamage,
          statMod: appliedStatMod,
          levelBonus: Math.floor(Number(attackerChar?.level || 1) / 3),
          passiveBonus: passiveFlatBonus + passiveDiceBonus + attackerEffMods.dmgDelta,
          weakSpotBonus: weakSpotBonusApplied,
          targetDr: isDm || attackerChar?.observedMonsterIds?.includes(monster.id) ? appliedTargetDr : null,
          critMult: isCrit ? appliedCritMult : 1,
        }
      : null,
    monster: maskMonsterForRole(monster, ctx.state, ctx.role, ctx.characterId),
    finalDamage,
    logEntry,
    defeatSummary,
    targetsHit,
    attackArea: effectivePlayerArea,
    attackAreaModifier: effectivePlayerMod,
    affectedCells: playerAffectedCells,
  };
}

export function rollDiceAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const isDm = ctx.role === 'dm';
  const result = rollDiceServer({
    count: payload.count !== undefined ? Number(payload.count) : undefined,
    sides: payload.sides !== undefined ? Number(payload.sides) : undefined,
    modifier: payload.modifier !== undefined ? Number(payload.modifier) : undefined,
    mode: String(payload.mode || 'normal'),
    formula: payload.formula ? String(payload.formula) : undefined,
  });
  const isSecret = Boolean(isDm && payload.isSecret);
  const dc = payload.dc !== undefined && payload.dc !== '' && Number(payload.dc) > 0
    ? Math.trunc(Number(payload.dc))
    : undefined;
  const passed = dc !== undefined
    ? result.isCrit || (!result.isFumble && result.total >= dc)
    : !result.isFumble && (result.sides ? result.total >= Math.ceil(Number(result.sides) / 2) : true);
  const entry = {
    id: `roll-${Date.now()}-${crypto.randomInt(10, 99)}`,
    timestamp: new Date().toISOString(),
    rollerName: String(payload.rollerName || (isDm ? 'Dungeon Master' : 'Player')),
    rollerRole: ctx.role,
    label: String(payload.label || `${result.formula} Roll`),
    ...result,
    ...(dc !== undefined ? { dc } : {}),
    passed,
    isSecret,
  };
  ctx.state.rollLog.unshift(entry);
  ctx.state.rollLog = ctx.state.rollLog.slice(0, 50);

  let damageOutcome = null;
  if (payload.targetMonsterId) {
    damageOutcome = inflictDamageAction(ctx, {
      monsterId: payload.targetMonsterId,
      attackerId: ctx.characterId,
      attackerName: entry.rollerName,
      rawDamage: entry.total,
      damageType: payload.damageType || 'Roll Damage',
      isCrit: entry.isCrit,
      includeStatMod: false,
    });
  } else {
    commitState(ctx);
  }
  return { ok: true, roll: entry, damageOutcome };
}

function findActiveTimedCombatBeat(state: GameState): StoryBeat | undefined {
  const hasLivingMonster = (b: StoryBeat) =>
    (b.arena?.tokens || []).some(
      (t) => t.type === 'monster' && Number(state.monsters.find((m) => m.id === t.id)?.hp ?? 0) > 0,
    );
  const candidates = (state.storyBeats || []).filter(
    (b) => b.beatType !== 'narration' && b.status !== 'resolved' && b.status !== 'failed' && hasLivingMonster(b),
  );
  return candidates.find((b) => b.presented && b.status === 'active') || candidates[0];
}

function handleCombatRoundAdvance(ctx: ActionRequestContext): boolean {
  const beat = findActiveTimedCombatBeat(ctx.state);
  if (!beat) return false;
  const maxRounds = clampCombatMaxRounds(beat.maxRounds);
  const round = Number(ctx.state.combat.round || 1);

  if (round > maxRounds) {
    beat.status = 'failed';
    const penalties: CombatDefeatPenaltyEntry[] = [];
    for (const ch of Object.values(ctx.state.characters || {})) {
      const hpLost =
        ch.hp > 1 ? Math.min(ch.hp - 1, Math.max(1, Math.floor(ch.hp * COMBAT_DEFEAT_PENALTIES.hpPct))) : 0;
      ch.hp = Math.max(ch.hp > 0 ? 1 : 0, ch.hp - hpLost);

      const mpLost =
        ch.mp > 0 ? Math.min(ch.mp, Math.max(1, Math.floor(ch.mp * COMBAT_DEFEAT_PENALTIES.mpPct))) : 0;
      ch.mp = Math.max(0, ch.mp - mpLost);

      const curGold = Number(ch.currency?.gold || 0);
      const goldLost =
        curGold > 0 ? Math.min(curGold, Math.max(1, Math.floor(curGold * COMBAT_DEFEAT_PENALTIES.goldPct))) : 0;
      ch.currency = { gold: Math.max(0, curGold - goldLost), manaStones: Number(ch.currency?.manaStones || 0) };

      const xpLost =
        ch.xp > 0 ? Math.min(ch.xp, Math.max(1, Math.floor(ch.xp * COMBAT_DEFEAT_PENALTIES.xpPct))) : 0;
      ch.xp = Math.max(0, ch.xp - xpLost);

      ch.activeEffects = [];
      recalculateCharacterAcAndDr(ctx.state, ch);
      syncCharacterDerived(ctx, ch.id);
      logPlayerHistory(
        ctx.state,
        ch.id,
        'combat',
        `Battle Lost (${beat.title} • ${maxRounds} rounds expired): -${hpLost} HP, -${mpLost} MP, -${goldLost} Gold, -${xpLost} XP.`,
      );
      penalties.push({
        characterId: ch.id,
        characterName: ch.name,
        hpLost,
        mpLost,
        goldLost,
        xpLost,
      });
    }

    beat.defeatSummary = {
      roundExceeded: round,
      maxRounds,
      timestamp: new Date().toISOString(),
      penalties,
    };
    ctx.state.combat.combatants = [];
    ctx.state.combat.turnIndex = 0;
    ctx.state.combat.round = 1;

    const penaltySummary = penalties.length
      ? penalties.map((p) => `${p.characterName}: -${p.hpLost} HP, -${p.mpLost} MP, -${p.goldLost}G, -${p.xpLost} XP`).join(' | ')
      : 'Party failed to clear the encounter in time.';
    pushSystemToast(ctx, {
      title: 'BATTLE LOST — TIME EXPIRED',
      message: `${beat.title} exceeded ${maxRounds} rounds! ${penaltySummary}`,
      category: 'combat',
    });
    ctx.state.combatLog.unshift({
      id: `cblog-${Date.now()}-${crypto.randomInt(10, 99)}`,
      timestamp: new Date().toISOString(),
      attacker: 'Tower Time Limit',
      target: beat.title,
      rawDamage: 0,
      finalDamage: 0,
      damageType: 'Penalty',
      remainingHp: null,
      summary: `BATTLE LOST: ${beat.title} exceeded ${maxRounds} rounds. ${penaltySummary}`,
    });
    return true;
  }

  if (round >= Math.max(1, maxRounds - 2)) {
    const remaining = maxRounds - round;
    pushSystemToast(ctx, {
      title: remaining === 0 ? 'FINAL ROUND!' : 'ROUND LIMIT WARNING',
      message:
        remaining === 0
          ? `Round ${round}/${maxRounds} — Final round to defeat the monsters before defeat penalties trigger!`
          : `Round ${round}/${maxRounds} — ${remaining} round${remaining === 1 ? '' : 's'} remaining!`,
      category: 'warning',
    });
  }
  return false;
}

export function initiativeAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const isDm = ctx.role === 'dm';
  const sub = String(payload.subAction || '');
  if (!isDm && sub !== 'player_roll_initiative' && sub !== 'end_turn' && sub !== 'run_ai_dm') {
    return { status: 403, error: 'Only the DM can control turn progression.' };
  }

  const prevDefeatIds = new Set((ctx.state.recentMonsterDefeats || []).map((d) => d.id).filter(Boolean));

  if (sub === 'run_ai_dm') {
    runAiDmTurns(ctx, { initiativeAction, monsterAttackAction });
    const newDefeatsForCaller = ctx.characterId
      ? (ctx.state.recentMonsterDefeats || []).filter(
          (d) => d.id && !prevDefeatIds.has(d.id) && d.killerCharacterId === ctx.characterId,
        )
      : [];
    return {
      ok: true,
      combat: ctx.state.combat,
      ...(newDefeatsForCaller[0] ? { defeatSummary: newDefeatsForCaller[0] } : {}),
      ...(newDefeatsForCaller.length > 0 ? { defeatSummaries: newDefeatsForCaller } : {}),
    };
  }

  const handleDotKill = (tickRes: ReturnType<typeof tickUnitEffectsOnTurnStart>) => {
    const killed = tickRes.dotKilledMonster;
    if (!killed) return;
    const killerChar = killed.killerCharacterId ? ctx.state.characters[killed.killerCharacterId] : null;
    if (!killerChar) return;
    const killerMods = computePassiveModifiers(killerChar);
    if (killerMods.hpOnKill > 0) killerChar.hp = Math.min(killerChar.maxHp, killerChar.hp + killerMods.hpOnKill);
    if (killerMods.mpOnKill > 0) killerChar.mp = Math.min(killerChar.maxMp, killerChar.mp + killerMods.mpOnKill);
    if (killerMods.tempHpOnKill > 0) killerChar.tempHp = Number(killerChar.tempHp || 0) + killerMods.tempHpOnKill;
    if (killerMods.hpOnKill > 0 || killerMods.mpOnKill > 0 || killerMods.tempHpOnKill > 0) {
      syncCharacterDerived(ctx, killerChar.id);
    }
    awardMonsterDefeatLoot(ctx, killed.monster, killerChar, {
      dropBeat: killed.dropBeat,
      monTokPos: killed.monTokPos,
      defeatCause: killed.effectNames.join(' / ') || 'Debuff',
    });
  };

  let initiativeRollEntry: Record<string, unknown> | undefined;
  if (sub === 'end_turn') {
    const cid = isDm ? String(payload.characterId || ctx.characterId || '') : String(ctx.characterId || '');
    if (!isDm && payload.characterId && payload.characterId !== ctx.characterId) {
      return { status: 403, error: 'Players can only end their own turn.' };
    }
    const combatants = ctx.state.combat.combatants;
    if (combatants.length > 0) {
      const curActive = combatants[ctx.state.combat.turnIndex];
      if (!isDm && combatants.length > 1 && curActive && cid && curActive.id !== cid) {
        return { status: 403, error: `It is not your turn (currently ${curActive.name}'s turn).` };
      }
      ctx.state.combat.turnIndex = (ctx.state.combat.turnIndex + 1) % combatants.length;
      let defeatedByRoundLimit = false;
      if (ctx.state.combat.turnIndex === 0) {
        ctx.state.combat.round += 1;
        defeatedByRoundLimit = handleCombatRoundAdvance(ctx);
        if (!defeatedByRoundLimit) {
          for (const bleedRes of tickBleedEffectsOnRoundStart(ctx)) {
            handleDotKill(bleedRes);
          }
        }
      }
      if (!defeatedByRoundLimit) {
        const nextActive = combatants[ctx.state.combat.turnIndex];
        if (nextActive) {
          resetArenaTurnFlags(ctx.state, [nextActive.id]);
          if (nextActive.type === 'player') triggerStartOfTurnPassives(ctx, nextActive.id);
          handleDotKill(tickUnitEffectsOnTurnStart(ctx, nextActive.id, nextActive.type === 'monster' ? 'monster' : 'player'));
        }
      }
    } else if (cid) {
      resetArenaTurnFlags(ctx.state, [cid]);
    }
  } else if (sub === 'next_turn') {
    if (ctx.state.combat.combatants.length > 0) {
      ctx.state.combat.turnIndex = (ctx.state.combat.turnIndex + 1) % ctx.state.combat.combatants.length;
      let defeatedByRoundLimit = false;
      if (ctx.state.combat.turnIndex === 0) {
        ctx.state.combat.round += 1;
        defeatedByRoundLimit = handleCombatRoundAdvance(ctx);
        if (!defeatedByRoundLimit) {
          for (const bleedRes of tickBleedEffectsOnRoundStart(ctx)) {
            handleDotKill(bleedRes);
          }
        }
      }
      if (!defeatedByRoundLimit) {
        const active = ctx.state.combat.combatants[ctx.state.combat.turnIndex];
        if (active) {
          resetArenaTurnFlags(ctx.state, [active.id]);
          if (active.type === 'player') triggerStartOfTurnPassives(ctx, active.id);
          handleDotKill(tickUnitEffectsOnTurnStart(ctx, active.id, active.type === 'monster' ? 'monster' : 'player'));
        }
      }
    }
  } else if (sub === 'prev_turn') {
    if (ctx.state.combat.combatants.length > 0) {
      ctx.state.combat.turnIndex -= 1;
      if (ctx.state.combat.turnIndex < 0) {
        ctx.state.combat.turnIndex = ctx.state.combat.combatants.length - 1;
        ctx.state.combat.round = Math.max(1, ctx.state.combat.round - 1);
      }
      const active = ctx.state.combat.combatants[ctx.state.combat.turnIndex];
      if (active) {
        resetArenaTurnFlags(ctx.state, [active.id]);
        if (active.type === 'player') triggerStartOfTurnPassives(ctx, active.id);
      }
    }
  } else if (sub === 'roll_all') {
    resetArenaTurnFlags(ctx.state, null);
    resetCombatPassiveFlags(ctx.state);
    for (const ch of Object.values(ctx.state.characters || {})) {
      ch.activeEffects = [];
    }
    for (const m of ctx.state.monsters || []) {
      m.activeEffects = [];
      for (const sk of m.skills || []) {
        sk.usesRemaining = sk.maxUsesPerCombat;
      }
    }
    for (const c of ctx.state.combat.combatants) {
      let mod = 2;
      let actFirst = false;
      if (c.type === 'player' && ctx.state.characters[c.id]) {
        const ch = ctx.state.characters[c.id];
        const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
        const pMods = computePassiveModifiers(ch);
        mod = computeStatModifier(agiScore, ctx.state.mechanics, ch) + pMods.bonusInitiative;
        actFirst = pMods.actFirstInInitiative;
      } else if (c.type === 'monster') {
        const mon = ctx.state.monsters.find((m) => m.id === c.id);
        mod = mon ? Math.floor(((mon.agi ?? mon.ac ?? 12) - 10) / 2) : 2;
      }
      c.initMod = mod;
      c.initiative = actFirst ? 99 + mod : rollSingleDie(20) + mod;
    }
    ctx.state.combat.combatants.sort((a, b) => b.initiative - a.initiative);
    ctx.state.combat.turnIndex = 0;
    ctx.state.combat.round = 1;
    const d20Roll = rollSingleDie(20);
    initiativeRollEntry = {
      id: `roll-${Date.now()}-${crypto.randomInt(10, 99)}`,
      timestamp: new Date().toISOString(),
      rollerName: 'Dungeon Master',
      rollerRole: ctx.role,
      label: 'Party & Monster Initiative Roll',
      formula: '1d20',
      count: 1,
      sides: 20,
      rolls: [d20Roll],
      dropped: [],
      modifier: 0,
      diceTotal: d20Roll,
      total: ctx.state.combat.combatants[0]?.initiative ?? d20Roll,
      passed: true,
      breakdown: ctx.state.combat.combatants
        .slice(0, 4)
        .map((c) => `${c.name}: ${c.initiative}`)
        .join(' • ') || `d20 = ${d20Roll}`,
      mode: 'normal',
      isCrit: d20Roll === 20,
      isFumble: d20Roll === 1,
      isSecret: false,
    };
  } else if (sub === 'player_roll_initiative') {
    const targetId = isDm && payload.characterId ? String(payload.characterId) : String(ctx.characterId || payload.characterId || '');
    const ch = ctx.state.characters[targetId];
    if (ch) {
      const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
      const pMods = computePassiveModifiers(ch);
      const mod = computeStatModifier(agiScore, ctx.state.mechanics, ch) + pMods.bonusInitiative;
      const rawD20 = rollSingleDie(20);
      const init = pMods.actFirstInInitiative ? 99 + mod : rawD20 + mod;
      const cb = ctx.state.combat.combatants.find((c) => c.id === ch.id);
      if (cb) {
        cb.initMod = mod;
        cb.initiative = init;
      }
      ctx.state.combat.combatants.sort((a, b) => b.initiative - a.initiative);
      const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
      initiativeRollEntry = {
        id: `roll-${Date.now()}-${crypto.randomInt(10, 99)}`,
        timestamp: new Date().toISOString(),
        rollerName: ch.name,
        rollerRole: ctx.role,
        label: 'Initiative Roll (AGI)',
        formula: `1d20${modStr}`,
        count: 1,
        sides: 20,
        rolls: [rawD20],
        dropped: [],
        modifier: mod,
        diceTotal: rawD20,
        total: init,
        dc: 10,
        passed: init >= 10,
        breakdown: `d20(${rawD20}) ${mod >= 0 ? `+ ${mod}` : `- ${Math.abs(mod)}`} = ${init}`,
        mode: 'normal',
        isCrit: rawD20 === 20,
        isFumble: rawD20 === 1,
        isSecret: false,
      };
    }
  }

  commitState(ctx);
  if (!payload._fromAiDm && (sub === 'end_turn' || sub === 'next_turn')) {
    runAiDmTurns(ctx, { initiativeAction, monsterAttackAction });
  }
  const newDefeatsForCaller = ctx.characterId
    ? (ctx.state.recentMonsterDefeats || []).filter(
        (d) => d.id && !prevDefeatIds.has(d.id) && d.killerCharacterId === ctx.characterId,
      )
    : [];
  return {
    ok: true,
    combat: ctx.state.combat,
    ...(initiativeRollEntry ? { roll: initiativeRollEntry } : {}),
    ...(newDefeatsForCaller[0] ? { defeatSummary: newDefeatsForCaller[0] } : {}),
    ...(newDefeatsForCaller.length > 0 ? { defeatSummaries: newDefeatsForCaller } : {}),
  };
}

export function bestiaryAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can edit the Monster Bestiary.' };
  const sub = String(payload.subAction || '');
  ctx.state.bestiary = ctx.state.bestiary || [];

  if (sub === 'add' || sub === 'update') {
    const name = String(payload.name || '').trim().slice(0, 60);
    if (!name) return { status: 400, error: 'Monster name is required.' };
    const existingIdx = sub === 'update' ? ctx.state.bestiary.findIndex((b) => b.id === String(payload.id || '')) : -1;
    if (sub === 'update' && existingIdx === -1) return { status: 404, error: 'Monster entry not found.' };

    const rawCat = String(payload.category || 'Custom');
    const category = (['Manhwa', 'D&D', 'Boss', 'Custom'].includes(rawCat) ? rawCat : 'Custom') as 'Manhwa' | 'D&D' | 'Boss' | 'Custom';
    const maxHp = Math.max(1, Math.trunc(Number(payload.maxHp || 26)));
    const rawLoot = Array.isArray(payload.lootTable) ? payload.lootTable : [];
    const lootTable = rawLoot.length > 0
      ? rawLoot
          .filter((l): l is Record<string, unknown> => Boolean(l && typeof l === 'object' && (l as Record<string, unknown>).itemName))
          .map((l) => ({
            itemName: String(l.itemName || '').trim().slice(0, 60),
            category: (['weapon', 'armor', 'consumable', 'relic', 'material'].includes(String(l.category)) ? String(l.category) : 'material') as 'weapon' | 'armor' | 'consumable' | 'relic' | 'material',
            dropChancePct: Math.max(1, Math.min(100, Number(l.dropChancePct || 50))),
            baseGold: Math.max(0, Math.trunc(Number(l.baseGold || 0))),
            baseManaStones: Math.max(0, Math.trunc(Number(l.baseManaStones || 0))),
            minFloor: Math.max(1, Math.trunc(Number(l.minFloor || 1))),
          }))
      : getDefaultLootTableForMonster({ id: sub === 'update' ? String(payload.id) : undefined, name, category, maxHp });
    const rawSkills = Array.isArray(payload.skills) ? payload.skills : [];
    const skills: MonsterSkill[] = rawSkills.length > 0
      ? rawSkills
          .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object' && (s as Record<string, unknown>).name))
          .map((s, idx) => {
            const baseUses = Math.max(1, Math.min(10, Math.trunc(Number(s.baseUsesPerCombat ?? s.maxUsesPerCombat ?? 1))));
            return {
              id: String(s.id || `msk-${Date.now().toString(36)}-${idx}`),
              name: String(s.name || '').trim().slice(0, 60),
              damageFormula: String(s.damageFormula || '2d6+3').trim().slice(0, 30),
              attackBonus: Math.trunc(Number(s.attackBonus ?? 6)),
              baseUsesPerCombat: baseUses,
              maxUsesPerCombat: baseUses,
              usesRemaining: baseUses,
              minFloor: Math.max(1, Math.trunc(Number(s.minFloor || 1))),
              description: String(s.description || '').trim().slice(0, 160),
              ...(s.attackArea && MONSTER_ATTACK_AREAS.includes(String(s.attackArea) as AttackArea)
                ? { attackArea: String(s.attackArea) as AttackArea }
                : {}),
              ...(s.attackAreaModifier !== undefined && Number(s.attackAreaModifier) !== 0
                ? { attackAreaModifier: clampAttackAreaModifier(s.attackAreaModifier) }
                : {}),
              ...(s.healFormula ? { healFormula: String(s.healFormula).trim().slice(0, 30) } : {}),
              ...(s.effectSpec && typeof s.effectSpec === 'object' ? { effectSpec: s.effectSpec as UnitEffectSpec } : {}),
            };
          })
      : getDefaultSkillsForMonster({ id: sub === 'update' ? String(payload.id) : undefined, name, category, maxHp });
    const rawBestiaryIcon = String(payload.iconId || '').trim() as TokenIconId;
    const rawBestiaryChestTier = String(payload.chestTier || '').trim() as ChestTier;
    const entry = {
      id: sub === 'update' ? String(payload.id) : `best-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name,
      category,
      maxHp,
      ac: Math.max(1, Math.trunc(Number(payload.ac || 14))),
      dr: Math.max(0, Math.trunc(Number(payload.dr || 0))),
      rangeSpaces: Math.max(1, Math.trunc(Number(payload.rangeSpaces || 2))),
      ...(rawBestiaryIcon && TOKEN_ICON_META[rawBestiaryIcon] ? { iconId: rawBestiaryIcon } : {}),
      ...(typeof payload.dropsChest === 'boolean' ? { dropsChest: payload.dropsChest } : {}),
      ...(CHEST_TIERS.includes(rawBestiaryChestTier) ? { chestTier: rawBestiaryChestTier } : {}),
      attackArea: inferDefaultAttackAreaForMonster({
        name,
        category,
        maxHp,
        rangeSpaces: Math.max(1, Math.trunc(Number(payload.rangeSpaces || 2))),
        attackArea: payload.attackArea ? (String(payload.attackArea) as MonsterAttackArea) : undefined,
      }),
      attackAreaModifier: clampAttackAreaModifier(payload.attackAreaModifier),
      ...(payload.healFormula ? { healFormula: String(payload.healFormula).trim().slice(0, 30) } : {}),
      ...(payload.effectSpec && typeof payload.effectSpec === 'object' ? { effectSpec: payload.effectSpec as UnitEffectSpec } : {}),
      attackFormula: String(payload.attackFormula || '1d20+5').trim().slice(0, 30),
      damageFormula: String(payload.damageFormula || '1d8+3').trim().slice(0, 30),
      notes: String(payload.notes || '').trim().slice(0, 160),
      lootTable,
      skills,
    };
    if (sub === 'update') ctx.state.bestiary[existingIdx] = entry;
    else ctx.state.bestiary.unshift(entry);
    commitState(ctx);
    return { ok: true, entry, bestiary: ctx.state.bestiary };
  }

  if (sub === 'remove') {
    const id = String(payload.monsterId || payload.id || '');
    ctx.state.bestiary = ctx.state.bestiary.filter((b) => b.id !== id);
    commitState(ctx);
    return { ok: true, bestiary: ctx.state.bestiary };
  }

  return { status: 400, error: `Unknown bestiary subAction: ${sub}` };
}

export function npcAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can edit the NPC Roster.' };
  const sub = String(payload.subAction || '');
  ctx.state.npcRoster = ctx.state.npcRoster || [];

  if (sub === 'add' || sub === 'update') {
    const name = String(payload.name || '').trim().slice(0, 60);
    if (!name) return { status: 400, error: 'NPC name is required.' };
    const existingIdx = sub === 'update' ? ctx.state.npcRoster.findIndex((n) => n.id === String(payload.id || '')) : -1;
    if (sub === 'update' && existingIdx === -1) return { status: 404, error: 'NPC entry not found.' };

    const rawOrigin = String(payload.origin || 'Custom');
    const origin = (['Manhwa', 'D&D', 'Custom'].includes(rawOrigin) ? rawOrigin : 'Custom') as 'Manhwa' | 'D&D' | 'Custom';
    const rawStats = (payload.stats && typeof payload.stats === 'object' ? payload.stats : {}) as Record<string, unknown>;
    const stats = {
      STR: Math.max(1, Math.trunc(Number(rawStats.STR ?? 10))),
      AGI: Math.max(1, Math.trunc(Number(rawStats.AGI ?? 10))),
      VIT: Math.max(1, Math.trunc(Number(rawStats.VIT ?? 10))),
      INT: Math.max(1, Math.trunc(Number(rawStats.INT ?? 10))),
      PER: Math.max(1, Math.trunc(Number(rawStats.PER ?? 10))),
      LUCK: Math.max(1, Math.trunc(Number(rawStats.LUCK ?? 10))),
    };
    const firstAppearedFloor = Math.max(1, Math.trunc(Number(payload.firstAppearedFloor || 1)));
    const prevAppearances = sub === 'update' ? (ctx.state.npcRoster[existingIdx].appearances || []) : [];
    const entry = {
      id: sub === 'update' ? String(payload.id) : `npc-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name,
      role: String(payload.role || 'Ally').trim().slice(0, 60),
      origin,
      level: Math.max(1, Math.trunc(Number(payload.level || 1))),
      firstAppearedFloor,
      stats,
      maxHp: Math.max(1, Math.trunc(Number(payload.maxHp || 35))),
      ac: Math.max(1, Math.trunc(Number(payload.ac || 13))),
      story: String(payload.story || '').trim().slice(0, 400),
      dialogue: String(payload.dialogue || '').trim().slice(0, 240),
      appearances: prevAppearances.length > 0 ? prevAppearances : [{ floor: firstAppearedFloor, beatTitle: `${firstAppearedFloor}F Roster Entry` }],
    };
    if (sub === 'update') ctx.state.npcRoster[existingIdx] = entry;
    else ctx.state.npcRoster.unshift(entry);
    commitState(ctx);
    return { ok: true, entry, npcRoster: ctx.state.npcRoster };
  }

  if (sub === 'remove') {
    const id = String(payload.id || '');
    ctx.state.npcRoster = ctx.state.npcRoster.filter((n) => n.id !== id);
    commitState(ctx);
    return { ok: true, npcRoster: ctx.state.npcRoster };
  }

  return { status: 400, error: `Unknown npc_action subAction: ${sub}` };
}

export function treasureAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can edit the Treasure Catalog.' };
  const sub = String(payload.subAction || '');
  ctx.state.treasureCatalog = ctx.state.treasureCatalog || [];

  if (sub === 'add' || sub === 'update') {
    const name = String(payload.name || '').trim().slice(0, 60);
    if (!name) return { status: 400, error: 'Treasure name is required.' };
    const existingIdx = sub === 'update' ? ctx.state.treasureCatalog.findIndex((t) => t.id === String(payload.id || '')) : -1;
    if (sub === 'update' && existingIdx === -1) return { status: 404, error: 'Treasure entry not found.' };

    const rawCat = String(payload.category || 'relic');
    const category = (['weapon', 'armor', 'relic', 'skill_book', 'consumable'].includes(rawCat) ? rawCat : 'relic') as 'weapon' | 'armor' | 'relic' | 'skill_book' | 'consumable';
    const rawOrigin = String(payload.origin || 'Custom');
    const origin = (['Manhwa', 'D&D', 'Custom'].includes(rawOrigin) ? rawOrigin : 'Custom') as 'Manhwa' | 'D&D' | 'Custom';
    const rawTier = String(payload.tier || '');
    const tier = (['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'].includes(rawTier) ? rawTier : undefined) as 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic' | undefined;
    const entry = {
      id: sub === 'update' ? String(payload.id) : `tr-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name,
      category,
      ...(tier ? { tier } : {}),
      origin,
      floorLevel: Math.max(1, Math.trunc(Number(payload.floorLevel || 1))),
      slot: (payload.slot ? String(payload.slot) : '') as '' | 'mainHand' | 'offHand' | 'head' | 'body' | 'boots' | 'relic',
      attackBonus: Math.max(0, Math.trunc(Number(payload.attackBonus || 0))),
      damageDice: String(payload.damageDice || '').trim().slice(0, 30),
      acBonus: Math.max(0, Math.trunc(Number(payload.acBonus || 0))),
      drBonus: Math.max(0, Math.trunc(Number(payload.drBonus || 0))),
      baseGold: Math.max(0, Math.trunc(Number(payload.baseGold || 0))),
      baseManaStones: Math.max(0, Math.trunc(Number(payload.baseManaStones || 0))),
      notes: String(payload.notes || '').trim().slice(0, 200),
    };
    if (sub === 'update') ctx.state.treasureCatalog[existingIdx] = entry;
    else ctx.state.treasureCatalog.unshift(entry);
    commitState(ctx);
    return { ok: true, entry, treasureCatalog: ctx.state.treasureCatalog };
  }

  if (sub === 'remove') {
    const id = String(payload.id || '');
    ctx.state.treasureCatalog = ctx.state.treasureCatalog.filter((t) => t.id !== id);
    commitState(ctx);
    return { ok: true, treasureCatalog: ctx.state.treasureCatalog };
  }

  return { status: 400, error: `Unknown treasure_action subAction: ${sub}` };
}

export function chestCatalogAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can edit the Chest Catalog.' };
  const sub = String(payload.subAction || 'update_tier');
  const rawTier = String(payload.tier || 'Common');
  if (!CHEST_TIERS.includes(rawTier as ChestTier)) {
    return { status: 400, error: `Invalid chest tier: ${rawTier}` };
  }
  const tier = rawTier as ChestTier;

  if (sub === 'reset_tier') {
    const def = CHEST_TIER_LOOT_TABLES[tier];
    if (ctx.state.chestCatalog) {
      ctx.state.chestCatalog[tier] = {
        tier,
        minItems: def.minItems,
        maxItems: def.maxItems,
        baseGold: def.baseGold,
        baseManaStones: def.baseManaStones,
        pool: def.pool.map((d) => ({ ...d, tier: d.tier || tier })),
      };
    }
    commitState(ctx);
    return { ok: true, chestCatalog: ctx.state.chestCatalog };
  }

  if (sub === 'update_tier') {
    const def = CHEST_TIER_LOOT_TABLES[tier];
    const minItems = Math.max(1, Math.min(10, Math.trunc(Number(payload.minItems ?? def.minItems))));
    const maxItems = Math.max(minItems, Math.min(10, Math.trunc(Number(payload.maxItems ?? def.maxItems))));
    const baseGold = Math.max(0, Math.trunc(Number(payload.baseGold ?? def.baseGold)));
    const baseManaStones = Math.max(0, Math.trunc(Number(payload.baseManaStones ?? def.baseManaStones)));
    const rawPool = Array.isArray(payload.pool) ? payload.pool : [];
    const pool = rawPool
      .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object' && (p as Record<string, unknown>).itemName))
      .map((p) => {
        const rawItemTier = String(p.tier || tier);
        const itemTier = (CHEST_TIERS.includes(rawItemTier as ChestTier) ? rawItemTier : tier) as ChestTier;
        const rawCat = String(p.category || 'relic');
        const category = (['weapon', 'armor', 'consumable', 'relic', 'material'].includes(rawCat) ? rawCat : 'relic') as 'weapon' | 'armor' | 'consumable' | 'relic' | 'material';
        return {
          itemName: String(p.itemName || '').trim().slice(0, 60),
          category,
          tier: itemTier,
          dropChancePct: Math.max(1, Math.min(100, Number(p.dropChancePct || 100))),
          baseGold: Math.max(0, Math.trunc(Number(p.baseGold || 0))),
          baseManaStones: Math.max(0, Math.trunc(Number(p.baseManaStones || 0))),
          notes: String(p.notes || '').trim().slice(0, 120),
        };
      });

    if (ctx.state.chestCatalog) {
      ctx.state.chestCatalog[tier] = {
        tier,
        minItems,
        maxItems,
        baseGold,
        baseManaStones,
        pool: pool.length > 0 ? pool : def.pool.map((d) => ({ ...d, tier: d.tier || tier })),
      };
    }
    commitState(ctx);
    return { ok: true, chestCatalog: ctx.state.chestCatalog };
  }

  return { status: 400, error: `Unknown chest_catalog_action subAction: ${sub}` };
}

export function unitEffectAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const isDm = ctx.role === 'dm';
  const sub = String(payload.subAction || 'apply');

  if (sub === 'clear_effect') {
    if (!isDm) return { status: 403, error: 'Only the Dungeon Master can manually clear effects.' };
    const unitType = payload.targetType === 'monster' ? 'monster' : 'player';
    const targetId = String(payload.targetId || '');
    const effectId = String(payload.effectId || '');
    if (unitType === 'monster') {
      const m = (ctx.state.monsters || []).find((x) => x.id === targetId);
      if (!m) return { status: 404, error: 'Monster not found.' };
      m.activeEffects = (m.activeEffects || []).filter((e) => e.id !== effectId);
      syncMonsterDerived(ctx, m.id);
    } else {
      const ch = ctx.state.characters[targetId];
      if (!ch) return { status: 404, error: 'Character not found.' };
      ch.activeEffects = (ch.activeEffects || []).filter((e) => e.id !== effectId);
      syncCharacterDerived(ctx, ch.id);
    }
    commitState(ctx);
    return { ok: true };
  }

  const targetType = payload.targetType === 'monster' ? 'monster' : 'player';
  const targetId = String(payload.targetId || ctx.characterId || '');
  const sourceName = String(
    payload.sourceName || (isDm ? 'Dungeon Master' : (ctx.characterId && ctx.state.characters[ctx.characterId]?.name) || 'Climber'),
  );
  const healFormula = payload.healFormula ? String(payload.healFormula).trim() : '';
  const rawSpec = (payload.effectSpec && typeof payload.effectSpec === 'object' ? payload.effectSpec : null) as UnitEffectSpec | null;

  if (!healFormula && !rawSpec) {
    return { status: 400, error: 'Provide a healFormula or effectSpec.' };
  }

  if (!isDm && targetType === 'monster' && rawSpec && UNIT_EFFECT_META[rawSpec.kind]?.category === 'buff') {
    return { status: 403, error: 'Players cannot buff monsters.' };
  }

  const isAllAllies = rawSpec?.target === 'all_allies';
  const targets: Array<{ id: string; type: 'player' | 'monster' }> = [];
  if (isAllAllies) {
    if (targetType === 'player') {
      for (const ch of Object.values(ctx.state.characters || {})) {
        if (Number(ch.hp ?? 0) > 0) targets.push({ id: ch.id, type: 'player' });
      }
    } else {
      for (const m of ctx.state.monsters || []) {
        if (Number(m.hp ?? 0) > 0) targets.push({ id: m.id, type: 'monster' });
      }
    }
  } else {
    targets.push({ id: targetId, type: targetType });
  }

  if (targets.length === 0) return { status: 404, error: 'No valid target unit found.' };

  let totalHealed = 0;
  const appliedLabels: string[] = [];

  const sourceCharacterId = !isDm
    ? (ctx.characterId || undefined)
    : (payload.sourceCharacterId ? String(payload.sourceCharacterId) : undefined);

  for (const t of targets) {
    if (t.type === 'player') {
      const ch = ctx.state.characters[t.id];
      if (!ch) continue;
      if (healFormula) {
        const roll = rollDiceServer({ formula: healFormula });
        const pMods = computePassiveModifiers(ch);
        const prev = ch.hp;
        ch.hp = Math.min(ch.maxHp, ch.hp + Math.max(1, roll.total) + (pMods.healingReceivedBonus || 0));
        totalHealed += ch.hp - prev;
      }
      if (rawSpec && UNIT_EFFECT_META[rawSpec.kind as UnitEffectKind]) {
        const eff = applyUnitEffect(ch, rawSpec, sourceName, sourceCharacterId);
        appliedLabels.push(`${eff.name} (${eff.turnsRemaining}t) -> ${ch.name}`);
      }
      syncCharacterDerived(ctx, ch.id);
    } else {
      const m = (ctx.state.monsters || []).find((x) => x.id === t.id);
      if (!m) continue;
      if (healFormula && m.maxHp) {
        const roll = rollDiceServer({ formula: healFormula });
        const prev = Number(m.hp ?? 0);
        m.hp = Math.min(m.maxHp, prev + Math.max(1, roll.total));
        totalHealed += m.hp - prev;
      }
      if (rawSpec && UNIT_EFFECT_META[rawSpec.kind as UnitEffectKind]) {
        const eff = applyUnitEffect(m, rawSpec, sourceName, sourceCharacterId);
        appliedLabels.push(`${eff.name} (${eff.turnsRemaining}t) -> ${m.name}`);
      }
      syncMonsterDerived(ctx, m.id);
    }
  }

  const summaryParts = [
    ...(totalHealed > 0 ? [`Healed +${totalHealed} HP (${healFormula})`] : []),
    ...appliedLabels,
  ];
  if (summaryParts.length > 0) {
    pushSystemToast(ctx, {
      title: totalHealed > 0 ? 'HEAL / BUFF APPLIED!' : 'STATUS EFFECT APPLIED!',
      message: `${sourceName}: ${summaryParts.join(' • ')}`,
      category: totalHealed > 0 ? 'loot' : 'info',
    });
    ctx.state.combatLog.unshift({
      id: `cblog-${Date.now()}-${crypto.randomInt(10, 99)}`,
      timestamp: new Date().toISOString(),
      attacker: sourceName,
      target: targets.length > 1 ? 'All Allies' : targets[0].id,
      rawDamage: 0,
      finalDamage: 0,
      damageType: totalHealed > 0 ? 'Heal' : 'Effect',
      remainingHp: null,
      summary: `${sourceName}: ${summaryParts.join(' • ')}.`,
    });
    ctx.state.combatLog = ctx.state.combatLog.slice(0, 60);
  }

  commitState(ctx);
  return { ok: true, totalHealed, appliedLabels };
}
