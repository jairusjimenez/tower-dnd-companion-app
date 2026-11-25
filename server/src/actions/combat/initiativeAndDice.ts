import crypto from 'node:crypto';
import {
  COMBAT_DEFEAT_PENALTIES,
  clampCombatMaxRounds,
  computePassiveModifiers,
  computeStatModifier,
  type CombatDefeatPenaltyEntry,
  type GameState,
  type Monster,
  type StoryBeat,
} from '../../../../shared';
import {
  rollDiceServer,
  rollSingleDie,
} from '../../services/dice';
import {
  commitState,
  logPlayerHistory,
  pushSystemToast,
  recalculateCharacterAcAndDr,
  resetArenaTurnFlags,
  resetCombatPassiveFlags,
  syncCharacterDerived,
  tickBleedEffectsOnRoundStart,
  tickUnitEffectsOnTurnStart,
  triggerStartOfTurnPassives,
} from '../../services/gameHelpers';
import { runAiDmTurns } from '../../services/aiDm';
import {
  type ActionRequestContext,
  type ActionResult,
} from '../types';
import { awardMonsterDefeatLoot } from './combatVictory';
import { inflictDamageAction } from './damageAndReactions';
import { monsterAttackAction } from './monsterActions';

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
