import crypto from 'node:crypto';
import {
  buildCharacterVarScope,
  computeStatModifier,
  evaluateFormula,
  getEquippedTotals,
  getGridLineCells,
  getMaxAttacksForFloor,
  getWeaponAttackInfo,
  type Monster,
} from '../../../shared';
import { rollDiceServer, rollSingleDie } from '../services/dice';
import {
  commitState,
  getFloorCenterRow,
  logPlayerHistory,
  pushSystemToast,
  removeMonsterTokensFromMaps,
  resetArenaTurnFlags,
  syncCharacterDerived,
  syncMonsterDerived,
} from '../services/gameHelpers';
import { maskMonsterForRole } from '../store/filterState';
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
  const monster: Monster = {
    id,
    name,
    floor,
    hp: maxHp,
    maxHp,
    ac,
    dr,
    rangeSpaces,
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
      xp: Math.max(0, Number(lootSrc.xp ?? payload.lootXp ?? 0)),
      dropped: false,
    },
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

  const hitRoll = rollDiceServer({ formula: mon.attackFormula || '1d20+5' });
  const dmgRoll = payload.customDamage !== undefined && payload.customDamage !== ''
    ? { total: Math.max(1, Number(payload.customDamage)), formula: 'Direct' }
    : rollDiceServer({ formula: mon.damageFormula || '1d8+3' });

  if (ctx.state.mechanics.combatMode === 'reactive') {
    const reaction = {
      id: `react-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      createdAt: new Date().toISOString(),
      monsterId: mon.id,
      monsterName: mon.name,
      targetCharacterId: targetChar.id,
      targetCharacterName: targetChar.name,
      attackTotal: hitRoll.total,
      incomingDamage: Math.max(1, dmgRoll.total),
      formula: dmgRoll.formula,
    };
    ctx.state.pendingReactions.unshift(reaction);
    ctx.state.pendingReactions = ctx.state.pendingReactions.slice(0, 12);

    pushSystemToast(ctx, {
      title: 'REACTION TRIGGERED!',
      message: `${mon.name} attacks ${targetChar.name} (${hitRoll.total} to hit, ${reaction.incomingDamage} incoming dmg)! Counter-attack or Parry now!`,
      category: 'combat',
      target: targetChar.id,
    });
    ctx.state.combatLog.unshift({
      id: `cblog-${Date.now()}`,
      timestamp: new Date().toISOString(),
      attacker: mon.name,
      target: targetChar.name,
      rawDamage: reaction.incomingDamage,
      finalDamage: reaction.incomingDamage,
      damageType: 'Incoming Strike',
      remainingHp: targetChar.hp,
      summary: `${mon.name} lunges at ${targetChar.name} (Hit ${hitRoll.total}, ${reaction.incomingDamage} dmg) — Waiting for Player Reaction!`,
    });

    commitState(ctx);
    return { ok: true, reaction, reactive: true };
  }

  const dmgTaken = Math.max(1, dmgRoll.total - Number(targetChar.dr || 0));
  targetChar.hp = Math.max(0, targetChar.hp - dmgTaken);
  syncCharacterDerived(ctx, targetChar.id);
  pushSystemToast(ctx, {
    title: 'MONSTER HIT',
    message: `${mon.name} hit ${targetChar.name} for ${dmgTaken} damage!`,
    category: 'combat',
    target: targetChar.id,
  });
  ctx.state.combatLog.unshift({
    id: `cblog-${Date.now()}`,
    timestamp: new Date().toISOString(),
    attacker: mon.name,
    target: targetChar.name,
    rawDamage: dmgRoll.total,
    finalDamage: dmgTaken,
    damageType: 'Monster Strike',
    remainingHp: targetChar.hp,
    summary: `${mon.name} struck ${targetChar.name} for ${dmgTaken} damage (HP: ${targetChar.hp}/${targetChar.maxHp}).`,
  });
  commitState(ctx);
  return { ok: true, dmgTaken, reactive: false };
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
  const choice = String(payload.choice || 'counter');
  let dmgTaken = Math.max(0, reaction.incomingDamage - Number(ch.dr || 0));
  let counterDamageDealt = 0;
  let summary = '';

  const applyCounterFormula = (dmgTotal: number, statMod: number) => {
    if (!mon) return 0;
    const scope = buildCharacterVarScope(ch, ctx.state.mechanics, {
      RAW_DMG: dmgTotal,
      STAT_MOD: statMod,
      TARGET_DR: Number(mon.dr || 0),
      TARGET_AC: Number(mon.ac || 10),
      CRIT_MULT: 1,
    });
    const dealt = Math.max(1, Math.round(evaluateFormula(ctx.state.mechanics.damageFormula, scope)));
    mon.hp = Math.max(0, Number(mon.hp ?? 0) - dealt);
    syncMonsterDerived(ctx, mon.id);
    if (mon.hp <= 0) removeMonsterTokensFromMaps(ctx.state, mon.id);
    return dealt;
  };

  if (choice === 'counter') {
    const weapon = getEquippedTotals(ch).mainWeapon;
    const dmgFormula = String(payload.diceFormula || weapon?.damageDice || '1d8+3');
    const hitRoll = rollDiceServer({ formula: '1d20', modifier: getEquippedTotals(ch).attackBonus });
    const dmgRoll = rollDiceServer({ formula: dmgFormula });
    const agiOrStr = ch.stats?.STR ?? ch.stats?.AGI ?? 12;
    const statMod = computeStatModifier(agiOrStr, ctx.state.mechanics, ch);

    if (mon) {
      const scope = buildCharacterVarScope(ch, ctx.state.mechanics, {
        RAW_DMG: dmgRoll.total,
        STAT_MOD: statMod,
        TARGET_DR: Number(mon.dr || 0),
        TARGET_AC: Number(mon.ac || 10),
        CRIT_MULT: hitRoll.isCrit ? Number(ctx.state.mechanics.critMultiplier || 2) : 1,
      });
      counterDamageDealt = Math.max(1, Math.round(evaluateFormula(ctx.state.mechanics.damageFormula, scope)));
      mon.hp = Math.max(0, Number(mon.hp ?? 0) - counterDamageDealt);
      syncMonsterDerived(ctx, mon.id);
      if (mon.hp <= 0) removeMonsterTokensFromMaps(ctx.state, mon.id);
    }
    if (hitRoll.total >= 12) dmgTaken = Math.floor(dmgTaken / 2);
    ch.hp = Math.max(0, ch.hp - dmgTaken);
    syncCharacterDerived(ctx, ch.id);
    summary = `${ch.name} COUNTER-ATTACKED ${reaction.monsterName} (Roll ${hitRoll.total}) for ${counterDamageDealt} damage and took ${dmgTaken} dmg!`;
  } else if (choice === 'parry') {
    const agiScore = ch.stats?.AGI ?? ch.stats?.STR ?? 12;
    const parryMod = computeStatModifier(agiScore, ctx.state.mechanics, ch);
    const parryRoll = rollDiceServer({ formula: '1d20', modifier: parryMod });
    if (parryRoll.total >= reaction.attackTotal) {
      dmgTaken = 0;
      summary = `${ch.name} PARRIED ${reaction.monsterName}'s strike cleanly (Roll ${parryRoll.total} vs ${reaction.attackTotal}) — 0 damage taken!`;
    } else {
      dmgTaken = Math.max(1, Math.floor(dmgTaken / 2));
      ch.hp = Math.max(0, ch.hp - dmgTaken);
      syncCharacterDerived(ctx, ch.id);
      summary = `${ch.name} partially guarded ${reaction.monsterName}'s strike (${parryRoll.total}) — took halved ${dmgTaken} dmg.`;
    }
  } else if (choice === 'spell') {
    const spell = payload.spellId
      ? ((ch.spells || []).find((s) => s.id === payload.spellId) || ctx.state.grimoire.find((s) => s.id === payload.spellId))
      : (ch.spells || [])[0];
    if (!spell) {
      return { status: 400, error: 'No spell selected or learned for Reaction Spell.' };
    }
    const mpCost = Number(spell.mpCost || 0);
    if (ch.mp < mpCost) {
      return { status: 400, error: `Not enough ${ctx.state.mechanics.resourceName || 'Mana'} to cast ${spell.name} (needs ${mpCost} MP).` };
    }
    ch.mp = Math.max(0, ch.mp - mpCost);
    if (mon) {
      const spellRoll = rollDiceServer({ formula: spell.damageDice || '2d6' });
      const intMod = computeStatModifier(ch.stats?.INT ?? 12, ctx.state.mechanics, ch);
      counterDamageDealt = applyCounterFormula(spellRoll.total, intMod);
    }
    dmgTaken = Math.floor(dmgTaken / 2);
    ch.hp = Math.max(0, ch.hp - dmgTaken);
    syncCharacterDerived(ctx, ch.id);
    summary = `${ch.name} reacted with ${spell.name}, dealing ${counterDamageDealt} damage to ${reaction.monsterName} (took ${dmgTaken} dmg)!`;
  } else {
    ch.hp = Math.max(0, ch.hp - dmgTaken);
    syncCharacterDerived(ctx, ch.id);
    summary = `${ch.name} took ${dmgTaken} damage from ${reaction.monsterName}.`;
  }

  ctx.state.pendingReactions.splice(idx, 1);
  ctx.state.combatLog.unshift({
    id: `cblog-${Date.now()}`,
    timestamp: new Date().toISOString(),
    attacker: ch.name,
    target: reaction.monsterName,
    rawDamage: counterDamageDealt,
    finalDamage: counterDamageDealt,
    damageType: `Reaction (${choice})`,
    remainingHp: mon ? mon.hp : null,
    summary,
  });
  ctx.state.combatLog = ctx.state.combatLog.slice(0, 60);

  commitState(ctx);
  return {
    ok: true,
    counterDamageDealt,
    dmgTaken,
    monster: mon ? maskMonsterForRole(mon, ctx.state, ctx.role) : null,
    character: ch,
    summary,
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
  const isCrit = Boolean(payload.isCrit);

  let friendlyAlly = null;
  let atkTokForTurn = null;

  if (!isDm && payload.beatId && attackerChar) {
    const beat = (ctx.state.storyBeats || []).find((b) => b.id === payload.beatId);
    const atkTok = beat?.arena?.tokens?.find((t) => t.id === attackerChar.id);
    const monTok = beat?.arena?.tokens?.find((t) => t.id === monster.id);
    if (atkTok) {
      atkTokForTurn = atkTok;
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

  let finalDamage = rawDamage;
  if (!payload.ignoreFormula) {
    const primaryStatKey = ctx.state.mechanics.stats[0]?.key || 'STR';
    const statScore = attackerChar?.stats?.[String(payload.statKey || primaryStatKey)] ?? 10;
    const statMod = payload.includeStatMod ? computeStatModifier(statScore, ctx.state.mechanics, attackerChar) : 0;
    const scope = buildCharacterVarScope(attackerChar, ctx.state.mechanics, {
      RAW_DMG: rawDamage,
      STAT_MOD: statMod,
      TARGET_DR: Number(monster.dr || 0),
      TARGET_AC: Number(monster.ac || 10),
      CRIT_MULT: isCrit ? Number(ctx.state.mechanics.critMultiplier || 2) : 1,
    });
    finalDamage = Math.max(0, Math.round(evaluateFormula(ctx.state.mechanics.damageFormula, scope)));
  }

  const weakSpot = attackerChar?.observedWeakSpots?.[monster.id];
  let weakSpotBonusApplied = 0;
  if (weakSpot) {
    weakSpotBonusApplied = Number(weakSpot.bonusDamage || 0) + (isCrit ? Number(weakSpot.bonusCritDamage || 0) : 0);
    finalDamage += weakSpotBonusApplied;
  }

  if (atkTokForTurn) {
    atkTokForTurn.attacksUsedThisTurn = Number(atkTokForTurn.attacksUsedThisTurn || 0) + 1;
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
      monster: maskMonsterForRole(monster, ctx.state, ctx.role),
      logEntry: ffEntry,
    };
  }

  const prevHp = Number(monster.hp ?? 0);
  monster.hp = Math.max(0, prevHp - finalDamage);
  if (attackerChar) {
    logPlayerHistory(ctx.state, attackerChar.id, 'combat', `Dealt ${finalDamage} ${damageType} damage to ${monster.name} (${monster.hp}/${monster.maxHp} HP left)`);
  }
  syncMonsterDerived(ctx, monster.id);

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
      const isRangedKill = Boolean(payload.isRangedAttack) || getWeaponAttackInfo(attackerChar).isRanged;
      if (!isRangedKill) {
        attackerChar.currency = attackerChar.currency || { gold: 0, manaStones: 0 };
        attackerChar.currency.manaStones = Number(attackerChar.currency.manaStones || 0) + 1;
        logPlayerHistory(ctx.state, attackerChar.id, 'loot', `Claimed +1 Mana Stone from defeating ${monster.name}`);
        pushSystemToast(ctx, {
          title: 'MANA STONE CLAIMED!',
          message: `${attackerChar.name} slew ${monster.name} in melee and gained +1 Mana Stone!`,
          category: 'loot',
          target: attackerChar.id,
        });
      } else if (dropBeat?.arena && monTokPos) {
        dropBeat.arena.manaStones = dropBeat.arena.manaStones || [];
        const stone = {
          id: `ms-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
          x: monTokPos.x,
          y: monTokPos.y,
          qty: 1,
          droppedFrom: monster.name,
        };
        dropBeat.arena.manaStones.push(stone);
        pushSystemToast(ctx, {
          title: 'MANA STONE DROPPED!',
          message: `${monster.name} dropped a Mana Stone at (${stone.x + 1}, ${stone.y + 1})!`,
          category: 'loot',
        });
      }
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
    summary: `${attackerName} inflicted ${finalDamage} ${damageType} damage to ${monster.name}${weakSpotBonusApplied ? ` [Weak Spot +${weakSpotBonusApplied}]` : ''} (HP: ${prevHp} -> ${monster.hp}/${monster.maxHp})${monster.hp === 0 ? ' [DEFEATED!]' : ''}`,
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
    monster: maskMonsterForRole(monster, ctx.state, ctx.role),
    finalDamage,
    logEntry,
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
  const entry = {
    id: `roll-${Date.now()}-${crypto.randomInt(10, 99)}`,
    timestamp: new Date().toISOString(),
    rollerName: String(payload.rollerName || (isDm ? 'Dungeon Master' : 'Player')),
    rollerRole: ctx.role,
    label: String(payload.label || `${result.formula} Roll`),
    ...result,
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

export function initiativeAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const isDm = ctx.role === 'dm';
  const sub = String(payload.subAction || '');
  if (!isDm && sub !== 'player_roll_initiative' && sub !== 'end_turn') {
    return { status: 403, error: 'Only the DM can control turn progression.' };
  }

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
      if (ctx.state.combat.turnIndex === 0) ctx.state.combat.round += 1;
      const nextActive = combatants[ctx.state.combat.turnIndex];
      if (nextActive) resetArenaTurnFlags(ctx.state, [nextActive.id]);
    } else if (cid) {
      resetArenaTurnFlags(ctx.state, [cid]);
    }
  } else if (sub === 'next_turn') {
    if (ctx.state.combat.combatants.length > 0) {
      ctx.state.combat.turnIndex = (ctx.state.combat.turnIndex + 1) % ctx.state.combat.combatants.length;
      if (ctx.state.combat.turnIndex === 0) ctx.state.combat.round += 1;
      const active = ctx.state.combat.combatants[ctx.state.combat.turnIndex];
      if (active) resetArenaTurnFlags(ctx.state, [active.id]);
    }
  } else if (sub === 'prev_turn') {
    if (ctx.state.combat.combatants.length > 0) {
      ctx.state.combat.turnIndex -= 1;
      if (ctx.state.combat.turnIndex < 0) {
        ctx.state.combat.turnIndex = ctx.state.combat.combatants.length - 1;
        ctx.state.combat.round = Math.max(1, ctx.state.combat.round - 1);
      }
      const active = ctx.state.combat.combatants[ctx.state.combat.turnIndex];
      if (active) resetArenaTurnFlags(ctx.state, [active.id]);
    }
  } else if (sub === 'roll_all') {
    resetArenaTurnFlags(ctx.state, null);
    for (const c of ctx.state.combat.combatants) {
      let mod = 2;
      if (c.type === 'player' && ctx.state.characters[c.id]) {
        const ch = ctx.state.characters[c.id];
        const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
        mod = computeStatModifier(agiScore, ctx.state.mechanics, ch);
      } else if (c.type === 'monster') {
        const mon = ctx.state.monsters.find((m) => m.id === c.id);
        mod = mon ? Math.floor(((mon.agi ?? mon.ac ?? 12) - 10) / 2) : 2;
      }
      c.initMod = mod;
      c.initiative = rollSingleDie(20) + mod;
    }
    ctx.state.combat.combatants.sort((a, b) => b.initiative - a.initiative);
    ctx.state.combat.turnIndex = 0;
    ctx.state.combat.round = 1;
  } else if (sub === 'player_roll_initiative') {
    const targetId = isDm && payload.characterId ? String(payload.characterId) : String(ctx.characterId || payload.characterId || '');
    const ch = ctx.state.characters[targetId];
    if (ch) {
      const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
      const mod = computeStatModifier(agiScore, ctx.state.mechanics, ch);
      const init = rollSingleDie(20) + mod;
      const cb = ctx.state.combat.combatants.find((c) => c.id === ch.id);
      if (cb) {
        cb.initMod = mod;
        cb.initiative = init;
      }
      ctx.state.combat.combatants.sort((a, b) => b.initiative - a.initiative);
    }
  }

  commitState(ctx);
  return { ok: true, combat: ctx.state.combat };
}
