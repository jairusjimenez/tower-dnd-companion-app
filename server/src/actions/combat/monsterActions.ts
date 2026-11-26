import crypto from 'node:crypto';
import {
  CHEST_TIERS,
  MONSTER_ATTACK_AREAS,
  TOKEN_ICON_META,
  UNIT_EFFECT_META,
  clampAttackAreaModifier,
  computeActiveEffectModifiers,
  computePassiveModifiers,
  computeMonsterAttackCells,
  evaluateRangedShot,
  formatMonsterAttackArea,
  inferDefaultAttackAreaForMonster,
  getDefaultSkillsForMonster,
  getMonsterXpReward,
  scaleMonsterSkillForFloor,
  spaceDistanceBetweenPoints,
  type AttackArea,
  type ChestTier,
  type Monster,
  type MonsterAttackArea,
  type MonsterSkill,
  type RangedShotEvaluation,
  type TokenIconId,
  type UnitEffectSpec,
} from '../../../../shared';
import {
  rollDiceServer,
  rollSingleDie,
} from '../../services/dice';
import {
  applyIncomingDamageToCharacter,
  applyUnitEffect,
  commitState,
  getFloorCenterRow,
  pushArenaFx,
  pushSystemToast,
  recordChronicleEvent,
  removeMonsterTokensFromMaps,
  syncCharacterDerived,
  syncMonsterDerived,
} from '../../services/gameHelpers';
import {
  type ActionRequestContext,
  type ActionResult,
} from '../types';
import { checkAndTriggerBeatVictory, recordNonPlayerMonsterDefeat } from './combatVictory';

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
  const hidden = Boolean(payload.hiddenFromPlayers);
  const name = String(payload.name || 'Tower Monster').trim().slice(0, 50);

  const lootSrc = (payload.loot && typeof payload.loot === 'object' ? payload.loot : {}) as Record<string, unknown>;
  const cleanBaseName = name.replace(/\s*#\d+$/, '').trim().toLowerCase();
  const matchedBestiary = (ctx.state.bestiary || []).find(
    (b) => b.name.trim().toLowerCase() === cleanBaseName || name.toLowerCase().includes(b.name.trim().toLowerCase()),
  );
  const rangeSpaces = Math.max(1, Number(payload.rangeSpaces || matchedBestiary?.rangeSpaces || 1));
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

  const prevHp = Number(mon.hp ?? mon.maxHp ?? 0);
  const affectedBeats = (ctx.state.storyBeats || []).filter(
    (b) =>
      b.beatType !== 'narration' &&
      b.status !== 'resolved' &&
      b.status !== 'failed' &&
      (b.arena?.tokens || []).some((t) => t.type === 'monster' && t.id === mon.id),
  );

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
    for (const beat of affectedBeats) {
      checkAndTriggerBeatVictory(ctx, beat);
    }
  } else {
    const maxHp = payload.maxHp !== undefined ? Math.max(1, Number(payload.maxHp)) : Number(mon.maxHp || 1);
    mon.maxHp = maxHp;
    const curHp = Number(mon.hp ?? maxHp);
    if (payload.hpDelta !== undefined) mon.hp = Math.max(0, Math.min(maxHp, curHp + Number(payload.hpDelta)));
    if (payload.hp !== undefined) mon.hp = Math.max(0, Math.min(maxHp, Number(payload.hp)));
    if (payload.ac !== undefined) mon.ac = Number(payload.ac);
    if (payload.dr !== undefined) mon.dr = Number(payload.dr);
    if (payload.rangeSpaces !== undefined) {
      mon.rangeSpaces = Math.max(1, Math.min(12, Math.trunc(Number(payload.rangeSpaces) || 1)));
    }
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
    if (Number(mon.hp ?? 0) <= 0) {
      removeMonsterTokensFromMaps(ctx.state, mon.id);
      if (prevHp > 0) {
        for (const beat of affectedBeats) {
          recordNonPlayerMonsterDefeat(ctx, mon, beat, 'Dungeon Master');
          checkAndTriggerBeatVictory(ctx, beat);
        }
      }
    }
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
  let monRangedEval: RangedShotEvaluation | null = null;
  let fxMonPos: { x: number; y: number } | null = null;
  let fxTgtPos: { x: number; y: number } | null = null;
  const effectiveRange = Math.max(1, Number(mon.rangeSpaces || 1));
  if (hostBeat?.arena) {
    const monTok = hostBeat.arena.tokens.find((t) => t.id === mon.id);
    const tgtTok = hostBeat.arena.tokens.find((t) => t.id === targetChar.id);
    if (monTok && tgtTok) {
      fxMonPos = { x: monTok.x, y: monTok.y };
      fxTgtPos = { x: tgtTok.x, y: tgtTok.y };
      const dist = spaceDistanceBetweenPoints(monTok.x, monTok.y, tgtTok.x, tgtTok.y);
      if (dist > effectiveRange) {
        return {
          status: 400,
          error: `${mon.name} is out of range! (Max ${effectiveRange} Space${effectiveRange > 1 ? 's' : ''}, target is ${dist} away).`,
        };
      }
      if (effectiveRange >= 2) {
        monRangedEval = evaluateRangedShot({
          startX: monTok.x,
          startY: monTok.y,
          targetX: tgtTok.x,
          targetY: tgtTok.y,
          maxRange: effectiveRange,
          isRanged: true,
          terrain: hostBeat.arena.terrain,
          tokens: hostBeat.arena.tokens,
          attackerId: mon.id,
          attackerType: 'monster',
          targetId: targetChar.id,
        });
        if (monRangedEval.blockedByTerrain) {
          return {
            status: 400,
            error: `${mon.name}'s ranged attack is blocked by impassable terrain!`,
          };
        }
      }
      const area = computeMonsterAttackCells({
        monsterX: monTok.x,
        monsterY: monTok.y,
        targetX: tgtTok.x,
        targetY: tgtTok.y,
        attackArea: effectiveArea,
        areaModifier: effectiveMod,
        rangeSpaces: effectiveRange,
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

  const rangedPenaltyParts: string[] = [];
  if (monRangedEval?.coverPenalty) rangedPenaltyParts.push(`Cover -${monRangedEval.coverPenalty}`);
  if (monRangedEval?.pointBlankPenalty) rangedPenaltyParts.push(`Point-Blank -${monRangedEval.pointBlankPenalty}`);
  const rangedPenaltySuffix = rangedPenaltyParts.length ? ` [${rangedPenaltyParts.join(', ')}]` : '';

  const rollHitVs = (tc: typeof targetChar) => {
    const tMods = computePassiveModifiers(tc);
    const tEffMods = computeActiveEffectModifiers(tc.activeEffects);
    const hitPenalty = (tMods.auraEnemyHitPenalty || 0) + (monRangedEval?.totalHitPenalty || 0);
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
      attackFumble: hitRoll.isFumble,
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
      const ffMon = h.attackFumble && monRangedEval?.frontFriendlyId
        ? ctx.state.monsters.find((m) => m.id === monRangedEval.frontFriendlyId && Number(m.hp ?? 0) > 0)
        : undefined;
      if (ffMon) {
        const ffDmg = Math.max(1, effectiveMonDmg - Math.max(0, Number(ffMon.dr || 0)));
        const prevFfHp = Number(ffMon.hp ?? 0);
        ffMon.hp = Math.max(0, prevFfHp - ffDmg);
        syncMonsterDerived(ctx, ffMon.id, { skipAutoLoot: true });
        if (ffMon.hp <= 0) {
          removeMonsterTokensFromMaps(ctx.state, ffMon.id);
          if (hostBeat) {
            recordNonPlayerMonsterDefeat(ctx, ffMon, hostBeat, `${mon.name} (Friendly Fire)`);
            checkAndTriggerBeatVictory(ctx, hostBeat);
          }
        }
        const ffSummary = `MONSTER FRIENDLY FIRE (NAT 1)! ${strikeLabel}'s fumbled ranged shot struck ${ffMon.name} for ${ffDmg} damage (${ffMon.hp}/${ffMon.maxHp} HP left)!`;
        if (hostBeat && fxMonPos) {
          const ffMonTok = (hostBeat.arena?.tokens || []).find((t) => t.id === ffMon.id);
          pushArenaFx(ctx.state, {
            beatId: hostBeat.id,
            kind: 'ranged',
            attackerId: mon.id,
            targetId: ffMon.id,
            from: fxMonPos,
            to: ffMonTok ? { x: ffMonTok.x, y: ffMonTok.y } : (fxTgtPos || fxMonPos),
            damage: ffDmg,
            friendlyFire: true,
            label: 'FRIENDLY FIRE!',
          });
        }
        pushSystemToast(ctx, {
          title: 'MONSTER FRIENDLY FIRE!',
          message: ffSummary,
          category: 'warning',
        });
        ctx.state.combatLog.unshift({
          id: `cblog-${Date.now()}-${i}`,
          timestamp: new Date().toISOString(),
          attacker: strikeLabel,
          target: ffMon.name,
          rawDamage: effectiveMonDmg,
          finalDamage: ffDmg,
          damageType: 'Friendly Fire (Nat 1)',
          remainingHp: ffMon.hp,
          summary: ffSummary,
        });
        return null;
      }
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
        message: `${strikeLabel} attacks ${tc.name} (${h.effectiveHitTotal} to hit, ${reaction.incomingDamage} incoming dmg)${rangedPenaltySuffix}${aoeSuffix}! Counter-attack or Parry now!`,
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
        summary: `${strikeLabel} unleashes ${usedSkill ? usedSkill.name : 'an attack'} on ${tc.name} (Hit ${h.effectiveHitTotal}, ${reaction.incomingDamage} dmg)${rangedPenaltySuffix}${aoeSuffix} — Waiting for Player Reaction!`,
      });
      return reaction;
    }).filter((r): r is NonNullable<typeof r> => r !== null);
    ctx.state.pendingReactions = ctx.state.pendingReactions.slice(0, 12);
    if (hostBeat && fxMonPos && fxTgtPos && reactions.length > 0) {
      pushArenaFx(ctx.state, {
        beatId: hostBeat.id,
        kind: effectiveRange >= 2 ? 'ranged' : 'melee',
        attackerId: mon.id,
        targetId: targetChar.id,
        from: fxMonPos,
        to: fxTgtPos,
        affectedCells: affectedCells.length ? affectedCells : undefined,
        damage: effectiveMonDmg,
      });
      recordChronicleEvent(ctx.state, {
        beatId: hostBeat.id,
        beatTitle: hostBeat.title,
        floor: hostBeat.floor,
        category: 'combat',
        actor: strikeLabel,
        target: targetChar.name,
        summary: `${strikeLabel} attacked ${targetChar.name} (${effectiveMonDmg} incoming dmg)${rangedPenaltySuffix}${aoeSuffix}.`,
      });
    }

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
      rangedEval: monRangedEval,
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
  if (hostBeat && fxMonPos && fxTgtPos) {
    pushArenaFx(ctx.state, {
      beatId: hostBeat.id,
      kind: effectiveRange >= 2 ? 'ranged' : 'melee',
      attackerId: mon.id,
      targetId: targetChar.id,
      from: fxMonPos,
      to: fxTgtPos,
      affectedCells: affectedCells.length ? affectedCells : undefined,
      damage: results[0]?.dmgTaken ?? effectiveMonDmg,
      miss: results[0]?.evaded,
    });
    recordChronicleEvent(ctx.state, {
      beatId: hostBeat.id,
      beatTitle: hostBeat.title,
      floor: hostBeat.floor,
      category: 'combat',
      actor: strikeLabel,
      target: targetChar.name,
      summary: results[0]?.evaded
        ? `${targetChar.name} evaded ${strikeLabel}'s attack.`
        : `${strikeLabel} hit ${targetChar.name} for ${results[0]?.dmgTaken ?? effectiveMonDmg} damage${rangedPenaltySuffix}.`,
    });
  }
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
