import crypto from 'node:crypto';
import {
  MONSTER_ATTACK_AREAS,
  UNIT_EFFECT_META,
  buildCharacterVarScope,
  clampAttackAreaModifier,
  computeActiveEffectModifiers,
  computeAttackAreaCells,
  computeBlockMitigationPct,
  computeCounterBleedChancePct,
  computeParryStunChancePct,
  computePassiveModifiers,
  computeStatModifier,
  evaluateFormula,
  evaluateRangedShot,
  formatMonsterAttackArea,
  getEquippedTotals,
  getFloorLootProfile,
  getMaxAttacksForFloor,
  getWeaponAttackInfo,
  hasObserveLineOfSight,
  isBossToken,
  type RangedShotEvaluation,
  resolvePlayerDefenseReaction,
  resolvePlayerReactionStyle,
  scaleSpellForLevel,
  spaceDistanceBetweenPoints,
  type AttackArea,
  type Character,
  type Monster,
  type MonsterDefeatSummary,
  type StoryBeat,
  type UnitEffectSpec,
} from '../../../../shared';
import { rollDiceServer } from '../../services/dice';
import {
  applyIncomingDamageToCharacter,
  applyUnitEffect,
  commitState,
  getAllyAuraBonuses,
  logPlayerHistory,
  pushArenaFx,
  pushSystemToast,
  recordChronicleEvent,
  removeMonsterTokensFromMaps,
  syncCharacterDerived,
  syncMonsterDerived,
} from '../../services/gameHelpers';
import { maskMonsterForRole } from '../../store/filterState';
import { runAiDmTurns } from '../../services/aiDm';
import {
  type ActionRequestContext,
  type ActionResult,
} from '../types';
import { awardMonsterDefeatLoot, checkAndTriggerBeatVictory, recordNonPlayerMonsterDefeat } from './combatVictory';
import { initiativeAction } from './initiativeAndDice';
import { monsterAttackAction } from './monsterActions';

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
    const rawSpell = payload.spellId
      ? ((ch.spells || []).find((s) => s.id === payload.spellId) || ctx.state.grimoire.find((s) => s.id === payload.spellId))
      : (ch.spells || []).find((s) => s.actionType === 'Reaction');
    if (!rawSpell) {
      return { status: 400, error: 'No reaction spell selected or learned.' };
    }
    const spell = scaleSpellForLevel(rawSpell, ch.level);
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

  let rangedEval: RangedShotEvaluation | null = null;
  let atkTokForTurn = null;
  let fxBeatId: string | null = null;
  let fxFromPos: { x: number; y: number } | null = null;
  let fxToPos: { x: number; y: number } | null = null;
  const isSpellAttack = Boolean(payload.isSpell);

  if (payload.beatId) {
    const beatForFx = (ctx.state.storyBeats || []).find((b) => b.id === payload.beatId);
    if (beatForFx?.arena) {
      const aTok = attackerChar ? (beatForFx.arena.tokens || []).find((t) => t.id === attackerChar.id) : undefined;
      const mTok = (beatForFx.arena.tokens || []).find((t) => t.id === monster.id);
      if (aTok && mTok) {
        fxBeatId = beatForFx.id;
        fxFromPos = { x: aTok.x, y: aTok.y };
        fxToPos = { x: mTok.x, y: mTok.y };
      }
    }
  }

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
      if (!isSpellAttack && atkTok.hasCastSpellThisTurn) {
        return { status: 400, error: 'You have already cast a spell this turn! Wait until your next turn.' };
      }
      const floor = Math.max(1, Number(beat?.floor || attackerChar?.currentFloor || ctx.state.map?.currentFloor || 1));
      const maxAttacks = getMaxAttacksForFloor(floor);
      const used = Number(atkTok.attacksUsedThisTurn || 0);
      if (!isSpellAttack && used >= maxAttacks) {
        return { status: 400, error: `You have already used your attack (${used}/${maxAttacks}) this turn! Wait until your next turn.` };
      }
    }
    if (atkTok && monTok && beat) {
      const dist = Math.max(Math.abs(monTok.x - atkTok.x), Math.abs(monTok.y - atkTok.y));
      const { isRanged, maxRange } = getWeaponAttackInfo(attackerChar);
      if (!isSpellAttack && dist > maxRange) {
        return {
          status: 400,
          error: `Out of attack range! (${isRanged ? 'Ranged' : 'Melee'} max ${maxRange} Space${maxRange > 1 ? 's' : ''}, target is ${dist} away).`,
        };
      }
      if (!isSpellAttack && isRanged) {
        rangedEval = evaluateRangedShot({
          startX: atkTok.x,
          startY: atkTok.y,
          targetX: monTok.x,
          targetY: monTok.y,
          maxRange,
          isRanged: true,
          terrain: beat.arena.terrain,
          tokens: beat.arena.tokens,
          attackerId: attackerChar.id,
          attackerType: 'player',
          targetId: monster.id,
        });
        if (rangedEval.blockedByTerrain) {
          return {
            status: 400,
            error: 'Line of sight blocked by impassable terrain! Reposition for a clear shot.',
          };
        }
      } else if (isSpellAttack && (beat.arena.terrain || []).length > 0) {
        const terrainSet = new Set((beat.arena.terrain || []).map((t) => `${t.x},${t.y}`));
        if (!hasObserveLineOfSight({ startX: atkTok.x, startY: atkTok.y, targetX: monTok.x, targetY: monTok.y, blockers: terrainSet })) {
          return {
            status: 400,
            error: 'Spell line of sight is blocked by impassable terrain!',
          };
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
      : isRanged && attackerChar.stats?.PER !== undefined
        ? 'PER'
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
    const rangedPenalty = !isSpellAttack && rangedEval ? rangedEval.totalHitPenalty : 0;
    let total = natural + hitStatMod + passiveHitBonus - rangedPenalty;
    try {
      total = Math.round(evaluateFormula(ctx.state.mechanics.hitFormula, hitScope)) + passiveHitBonus - rangedPenalty;
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
    const penaltyParts: string[] = [];
    if (!isSpellAttack && rangedEval?.coverPenalty) penaltyParts.push(`Cover -${rangedEval.coverPenalty}`);
    if (!isSpellAttack && rangedEval?.pointBlankPenalty) penaltyParts.push(`Point-Blank -${rangedEval.pointBlankPenalty}`);
    const penaltyNote = penaltyParts.length ? ` (${penaltyParts.join(', ')})` : '';
    attackRoll = {
      natural,
      total,
      targetAc,
      hit,
      crit,
      fumble: fumble && !hit,
      breakdown: `d20 [${natural}] → ${total} vs AC ${targetAc} [${hitStatKey}]${penaltyNote}${luckyStarNote}`,
    };
    isCrit = crit;

    if (!hit) {
      if (atkTokForTurn) atkTokForTurn.attacksUsedThisTurn = Number(atkTokForTurn.attacksUsedThisTurn || 0) + 1;
      const ffAlly = fumble && !isSpellAttack && rangedEval?.frontFriendlyId ? ctx.state.characters[rangedEval.frontFriendlyId] : null;
      if (ffAlly && Number(ffAlly.hp ?? 0) > 0) {
        const ffRoll = payload.diceFormula
          ? rollDiceServer({ formula: String(payload.diceFormula), mode: 'normal' }).total
          : Math.max(1, Number(payload.rawDamage ?? 4));
        const ffDamage = Math.max(1, Math.round(ffRoll) - Math.max(0, Number(ffAlly.dr || 0)));
        const prevAllyHp = ffAlly.hp;
        ffAlly.hp = Math.max(0, ffAlly.hp - ffDamage);
        syncCharacterDerived(ctx, ffAlly.id);
        logPlayerHistory(ctx.state, attackerChar.id, 'combat', `FRIENDLY FIRE (NAT 1)! Stray shot struck ${ffAlly.name} for ${ffDamage} ${damageType} damage!`);
        const ffEntry = {
          id: `cblog-${Date.now()}-${crypto.randomInt(10, 99)}`,
          timestamp: new Date().toISOString(),
          attacker: attackerName,
          target: ffAlly.name,
          targetId: ffAlly.id,
          rawDamage: ffRoll,
          finalDamage: ffDamage,
          damageType,
          isCrit: false,
          remainingHp: ffAlly.hp,
          maxHp: ffAlly.maxHp,
          summary: `FRIENDLY FIRE (NAT 1)! ${attackerName}'s fumbled ranged shot struck ${ffAlly.name} for ${ffDamage} ${damageType} damage (HP: ${prevAllyHp} -> ${ffAlly.hp}/${ffAlly.maxHp})!`,
        };
        ctx.state.combatLog.unshift(ffEntry);
        ctx.state.combatLog = ctx.state.combatLog.slice(0, 60);
        pushSystemToast(ctx, {
          title: 'FRIENDLY FIRE (NAT 1)!',
          message: ffEntry.summary,
          category: 'warning',
        });
        if (fxBeatId && fxFromPos) {
          const ffBeat = (ctx.state.storyBeats || []).find((b) => b.id === fxBeatId);
          const ffTok = (ffBeat?.arena?.tokens || []).find((t) => t.id === ffAlly.id);
          pushArenaFx(ctx.state, {
            beatId: fxBeatId,
            kind: 'ranged',
            attackerId: attackerChar.id,
            targetId: ffAlly.id,
            from: fxFromPos,
            to: ffTok ? { x: ffTok.x, y: ffTok.y } : (fxToPos || fxFromPos),
            damage: ffDamage,
            friendlyFire: true,
            label: 'FRIENDLY FIRE!',
          });
        }
        recordChronicleEvent(ctx.state, {
          beatId: fxBeatId || undefined,
          category: 'combat',
          actor: attackerName,
          target: ffAlly.name,
          summary: ffEntry.summary,
        });
        commitState(ctx);
        return {
          ok: true,
          miss: true,
          hit: false,
          friendlyFire: true,
          finalDamage: ffDamage,
          attackRoll,
          ally: ffAlly,
          monster: maskMonsterForRole(monster, ctx.state, ctx.role, ctx.characterId),
          logEntry: ffEntry,
        };
      }
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
      if (fxBeatId && fxFromPos && fxToPos) {
        pushArenaFx(ctx.state, {
          beatId: fxBeatId,
          kind: isSpellAttack ? 'spell' : isRanged ? 'ranged' : 'melee',
          attackerId: attackerChar.id,
          targetId: monster.id,
          from: fxFromPos,
          to: fxToPos,
          element: isSpellAttack ? damageType : undefined,
          miss: true,
        });
      }
      recordChronicleEvent(ctx.state, {
        beatId: fxBeatId || undefined,
        category: isSpellAttack ? 'spell' : 'combat',
        actor: attackerName,
        target: monster.name,
        summary: missEntry.summary,
      });
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
    const defaultDmgStatKey = isSpellAttack ? 'INT' : isRanged ? 'PER' : primaryStatKey;
    const statScore = attackerChar?.stats?.[String(payload.statKey || defaultDmgStatKey)] ?? 10;
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
          const prevOtherHp = Number(otherMon.hp ?? 0);
          const otherTokPos = { x: otherTok.x, y: otherTok.y };
          otherMon.hp = Math.max(0, prevOtherHp - finalDamage);
          syncMonsterDerived(ctx, otherMon.id, { skipAutoLoot: true });
          if (prevOtherHp > 0 && otherMon.hp <= 0) {
            removeMonsterTokensFromMaps(ctx.state, otherMon.id);
            awardMonsterDefeatLoot(ctx, otherMon, attackerChar, {
              dropBeat: activeBeat,
              monTokPos: otherTokPos,
            });
          }
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
        const prevOtherHp = Number(otherMon.hp ?? 0);
        const otherTokPos = { x: otherTok.x, y: otherTok.y };
        otherMon.hp = Math.max(0, prevOtherHp - secDmg);
        syncMonsterDerived(ctx, otherMon.id, { skipAutoLoot: true });
        if (prevOtherHp > 0 && otherMon.hp <= 0) {
          removeMonsterTokensFromMaps(ctx.state, otherMon.id);
          awardMonsterDefeatLoot(ctx, otherMon, attackerChar, {
            dropBeat: aoeBeat,
            monTokPos: otherTokPos,
          });
        }
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
    } else if (dropBeat) {
      recordNonPlayerMonsterDefeat(ctx, monster, dropBeat, attackerName);
      checkAndTriggerBeatVictory(ctx, dropBeat);
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
  recordChronicleEvent(ctx.state, {
    beatId: fxBeatId || undefined,
    category: isSpellAttack ? 'spell' : 'combat',
    actor: attackerName,
    target: monster.name,
    summary: logEntry.summary,
  });

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

  if (fxBeatId && fxFromPos && fxToPos) {
    pushArenaFx(ctx.state, {
      beatId: fxBeatId,
      kind: isSpellAttack ? 'spell' : isRanged ? 'ranged' : 'melee',
      attackerId: attackerChar?.id,
      targetId: monster.id,
      from: fxFromPos,
      to: fxToPos,
      affectedCells: playerAffectedCells.length ? playerAffectedCells : undefined,
      element: isSpellAttack ? damageType : undefined,
      damage: finalDamage,
      crit: isCrit,
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
