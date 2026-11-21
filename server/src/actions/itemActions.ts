import crypto from 'node:crypto';
import {
  PLAYER_ATTACK_AREAS,
  UNIT_EFFECT_META,
  buildStarterEquipment,
  clampAttackAreaModifier,
  clampSpellToFloor,
  computePassiveModifiers,
  getMaxSpellsForLevel,
  getPartyFloor,
  isStatsAndEquipmentLocked,
  normalizeSpellElement,
  type AttackArea,
  type EquipmentItem,
  type EquipmentSlot,
  type Spell,
  type UnitEffectKind,
  type UnitEffectSpec,
} from '../../../shared';
import { extractGoogleDocId, parseDeityTextIntoEntries } from '../services/deities';
import { rollDiceServer } from '../services/dice';
import {
  applyUnitEffect,
  commitState,
  createInventoryItem,
  logPlayerHistory,
  pushSystemToast,
  recalculateCharacterAcAndDr,
  resolveAuthorizedCharacter,
  syncCharacterDerived,
} from '../services/gameHelpers';
import { inflictDamageAction } from './combatActions';
import type { ActionRequestContext, ActionResult } from './types';

export function spellAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const isDm = ctx.role === 'dm';
  const targetId = isDm && payload.characterId ? String(payload.characterId) : (ctx.characterId || (payload.characterId ? String(payload.characterId) : ''));
  const ch = targetId ? ctx.state.characters[targetId] : undefined;
  const sub = String(payload.subAction || '');

  if (sub === 'add_to_grimoire' || sub === 'learn_custom') {
    const sp = (payload.spell && typeof payload.spell === 'object' ? payload.spell : {}) as Partial<Spell> & { name?: string };
    if (!sp.name) return { status: 400, error: 'Spell name is required.' };
    if (!isDm && payload.characterId && ctx.characterId && payload.characterId !== ctx.characterId) {
      return { status: 403, error: 'Cannot modify another player spells.' };
    }
    if (ch && !isDm) {
      const maxSpells = getMaxSpellsForLevel(ch.level);
      if ((ch.spells || []).length >= maxSpells) {
        const nextLv = (Math.floor(Math.max(1, Number(ch.level || 1)) / 3) + 1) * 3;
        const msg = maxSpells >= 10
          ? `Maximum spell limit reached (${ch.spells.length}/10).`
          : `Spell limit reached (${ch.spells.length}/${maxSpells}). Next spell slot unlocks at Level ${nextLv}.`;
        return { status: 400, error: msg };
      }
    }

    const normElement = normalizeSpellElement(sp.element);
    const floorLevel = Math.max(1, Number(ch?.currentFloor) || getPartyFloor(ctx.state));
    const balanced = !isDm
      ? clampSpellToFloor(sp, floorLevel)
      : {
          damageDice: String(sp.damageDice || '2d6'),
          rangeSpaces: Math.max(0, Number(sp.rangeSpaces || 6)),
          mpCost: Math.max(0, Number(sp.mpCost || 0)),
        };

    const rawArea = String(sp.attackArea || 'single');
    const spellArea: AttackArea = PLAYER_ATTACK_AREAS.includes(rawArea as AttackArea) ? (rawArea as AttackArea) : 'single';
    const spellAreaMod = clampAttackAreaModifier(sp.attackAreaModifier);
    const spHeal = typeof sp.healFormula === 'string' && sp.healFormula.trim() ? sp.healFormula.trim().slice(0, 24) : undefined;
    const rawEff = sp.effectSpec && typeof sp.effectSpec === 'object' ? (sp.effectSpec as UnitEffectSpec) : null;
    const spEffect: UnitEffectSpec | undefined = rawEff && rawEff.kind && UNIT_EFFECT_META[rawEff.kind as UnitEffectKind]
      ? {
          kind: rawEff.kind as UnitEffectKind,
          potency: Math.max(1, Math.min(50, Math.round(Number(rawEff.potency) || 2))),
          duration: Math.max(1, Math.min(10, Math.round(Number(rawEff.duration) || 2))),
          target: rawEff.target === 'self' || rawEff.target === 'enemy' || rawEff.target === 'all_allies' ? rawEff.target : undefined,
        }
      : undefined;
    const newSpell: Spell = {
      id: `sp-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name: String(sp.name).trim().slice(0, 50),
      element: normElement,
      mpCost: balanced.mpCost,
      damageDice: balanced.damageDice,
      damageType: normElement,
      rangeSpaces: balanced.rangeSpaces,
      areaText: String(sp.areaText || `${balanced.rangeSpaces} Spaces`).slice(0, 80),
      attackArea: spellArea,
      attackAreaModifier: spellAreaMod,
      ...(spHeal ? { healFormula: spHeal } : {}),
      ...(spEffect ? { effectSpec: spEffect } : {}),
      actionType: sp.actionType === 'Reaction' ? 'Reaction' : 'Action',
      explanation: String(sp.explanation || 'Custom free-flow magic manifestation.').slice(0, 400),
    };
    ctx.state.grimoire.unshift(newSpell);
    if (ch) {
      ch.spells = ch.spells || [];
      ch.spells.unshift(newSpell);
    }
    commitState(ctx);
    return { ok: true, spell: newSpell };
  }

  const { ch: authChar, error } = resolveAuthorizedCharacter(
    ctx,
    payload.characterId ? String(payload.characterId) : null,
    'modify spells',
  );
  if (error || !authChar) return error!;
  authChar.spells = authChar.spells || [];

  if (sub === 'learn_from_grimoire') {
    const sp = ctx.state.grimoire.find((g) => g.id === payload.spellId);
    if (!sp) return { status: 404, error: 'Grimoire spell not found.' };
    if (!authChar.spells.some((s) => s.id === sp.id)) {
      const maxSpells = getMaxSpellsForLevel(authChar.level);
      if (!isDm && authChar.spells.length >= maxSpells) {
        const nextLv = (Math.floor(Math.max(1, Number(authChar.level || 1)) / 3) + 1) * 3;
        const msg = maxSpells >= 10
          ? `Maximum spell limit reached (${authChar.spells.length}/10).`
          : `Spell limit reached (${authChar.spells.length}/${maxSpells}). Next spell slot unlocks at Level ${nextLv}.`;
        return { status: 400, error: msg };
      }
      authChar.spells.push({ ...sp });
    }
  } else if (sub === 'forget') {
    authChar.spells = authChar.spells.filter((s) => s.id !== payload.spellId);
  } else if (sub === 'update_area') {
    const sp = authChar.spells.find((s) => s.id === payload.spellId);
    if (!sp) return { status: 404, error: 'Spell not found.' };
    if (payload.attackArea !== undefined && PLAYER_ATTACK_AREAS.includes(String(payload.attackArea) as AttackArea)) {
      sp.attackArea = String(payload.attackArea) as AttackArea;
    }
    if (payload.attackAreaModifier !== undefined) {
      sp.attackAreaModifier = clampAttackAreaModifier(payload.attackAreaModifier);
    }
  } else if (sub === 'cast') {
    const sp = authChar.spells.find((s) => s.id === payload.spellId) || ctx.state.grimoire.find((g) => g.id === payload.spellId);
    if (!sp) return { status: 404, error: 'Spell not found.' };
    const hasPendingReaction = (ctx.state.pendingReactions || []).some((r) => r.targetCharacterId === authChar.id);
    if (sp.actionType === 'Reaction' && !payload.reactionId && !hasPendingReaction) {
      return { status: 400, error: 'Reaction spells can only be used when a monster attacks you.' };
    }
    const pMods = computePassiveModifiers(authChar);
    authChar.combatPassiveFlags = authChar.combatPassiveFlags || {};
    const rawCost = Number(sp.mpCost || 0);
    const isFirstSpell = Number(authChar.combatPassiveFlags.spellsCastThisCombat || 0) === 0;
    const cost = pMods.zeroCostAllSpells || (pMods.zeroCostFirstSpell && isFirstSpell)
      ? 0
      : rawCost > 0
        ? Math.max(1, rawCost - pMods.spellMpDiscount)
        : 0;
    if (authChar.mp < cost) return { status: 400, error: `Not enough ${ctx.state.mechanics.resourceName || 'Mana'} (needs ${cost}).` };

    const applyCastSideEffects = () => {
      authChar.combatPassiveFlags = authChar.combatPassiveFlags || {};
      authChar.combatPassiveFlags.spellsCastThisCombat = Number(authChar.combatPassiveFlags.spellsCastThisCombat || 0) + 1;
      if (cost > 0 && pMods.spellEchoPct > 0 && crypto.randomInt(1, 101) <= pMods.spellEchoPct) {
        const refund = Math.max(1, Math.floor(cost / 2));
        authChar.mp = Math.min(authChar.maxMp, authChar.mp + refund);
      }
      const healOnCast = pMods.spellHealOnCast[sp.element] || 0;
      if (healOnCast > 0) authChar.hp = Math.min(authChar.maxHp, authChar.hp + healOnCast);
      const tempDr = pMods.spellTempDrOnCast[sp.element] || 0;
      if (tempDr > 0) {
        authChar.combatPassiveFlags.tempDrBonus = Number(authChar.combatPassiveFlags.tempDrBonus || 0) + tempDr;
        recalculateCharacterAcAndDr(ctx.state, authChar);
      }
    };

    if (payload.targetMonsterId) {
      const targetMon = ctx.state.monsters.find((m) => m.id === payload.targetMonsterId);
      if (!targetMon) return { status: 404, error: 'Target monster not found.' };
      if (Number(targetMon.hp ?? 0) <= 0) return { status: 400, error: `${targetMon.name} is already defeated.` };
      authChar.mp = Math.max(0, authChar.mp - cost);
      applyCastSideEffects();
      syncCharacterDerived(ctx, authChar.id);
      const castHealFormula = typeof payload.healFormula === 'string' && payload.healFormula.trim()
        ? payload.healFormula.trim()
        : sp.healFormula;
      const castEffectSpec = payload.effectSpec !== undefined ? payload.effectSpec : sp.effectSpec;
      const dmgRes = inflictDamageAction(ctx, {
        monsterId: payload.targetMonsterId,
        attackerId: authChar.id,
        beatId: payload.beatId,
        diceFormula: sp.damageDice,
        damageType: sp.damageType || sp.element,
        includeStatMod: true,
        statKey: 'INT',
        isSpell: true,
        rangeSpaces: sp.rangeSpaces,
        attackArea: payload.attackArea ?? sp.attackArea ?? 'single',
        attackAreaModifier: payload.attackAreaModifier ?? sp.attackAreaModifier ?? 0,
        ...(castHealFormula ? { healFormula: castHealFormula } : {}),
        ...(castEffectSpec ? { effectSpec: castEffectSpec } : {}),
      });
      if (dmgRes.error) return dmgRes;
      const summary =
        typeof (dmgRes.logEntry as { summary?: unknown } | undefined)?.summary === 'string'
          ? String((dmgRes.logEntry as { summary: string }).summary)
          : `${authChar.name} cast ${sp.name} on ${targetMon.name} (${cost} MP).`;
      return { ...dmgRes, summary };
    }

    authChar.mp = Math.max(0, authChar.mp - cost);
    applyCastSideEffects();

    const castHealFormula = typeof payload.healFormula === 'string' && payload.healFormula.trim()
      ? payload.healFormula.trim()
      : sp.healFormula;
    const castEffectSpec = (payload.effectSpec !== undefined ? payload.effectSpec : sp.effectSpec) as UnitEffectSpec | null | undefined;
    const effectNotes: string[] = [];

    if (castHealFormula) {
      const hRoll = rollDiceServer({ formula: castHealFormula });
      const healAmt = Math.max(1, hRoll.total);
      if (castEffectSpec?.target === 'all_allies') {
        const allies = Object.values(ctx.state.characters).filter((c) => Number(c.hp || 0) > 0);
        for (const ally of allies) {
          ally.hp = Math.min(ally.maxHp, ally.hp + healAmt);
          syncCharacterDerived(ctx, ally.id);
        }
        effectNotes.push(`Healed party +${healAmt} HP (${castHealFormula})`);
      } else {
        authChar.hp = Math.min(authChar.maxHp, authChar.hp + healAmt);
        effectNotes.push(`Healed +${healAmt} HP (${castHealFormula})`);
      }
    }

    if (castEffectSpec && castEffectSpec.kind && UNIT_EFFECT_META[castEffectSpec.kind]) {
      const meta = UNIT_EFFECT_META[castEffectSpec.kind];
      if (castEffectSpec.target === 'all_allies') {
        const allies = Object.values(ctx.state.characters).filter((c) => Number(c.hp || 0) > 0);
        for (const ally of allies) {
          applyUnitEffect(ally, castEffectSpec, sp.name);
          syncCharacterDerived(ctx, ally.id);
        }
        effectNotes.push(`Party ${meta.label} (${castEffectSpec.duration}t)`);
      } else {
        applyUnitEffect(authChar, castEffectSpec, sp.name);
        effectNotes.push(`${meta.label} (${castEffectSpec.duration}t)`);
      }
    }

    syncCharacterDerived(ctx, authChar.id);
    const castSummary = `${authChar.name} cast ${sp.name} (${sp.areaText}, Cost ${cost} MP)${effectNotes.length ? ` • ${effectNotes.join(', ')}` : ''}.`;
    ctx.state.combatLog.unshift({
      id: `cblog-${Date.now()}`,
      timestamp: new Date().toISOString(),
      attacker: authChar.name,
      target: `${sp.rangeSpaces} Spaces`,
      rawDamage: 0,
      finalDamage: 0,
      damageType: sp.damageType,
      remainingHp: null,
      summary: castSummary,
    });
    commitState(ctx);
    return { ok: true, character: authChar, summary: castSummary };
  }

  commitState(ctx);
  return { ok: true, character: authChar };
}

export async function deityAction(ctx: ActionRequestContext, payload: Record<string, unknown>): Promise<ActionResult> {
  const isDm = ctx.role === 'dm';
  const sub = String(payload.subAction || '');

  if (sub === 'pledge') {
    const { ch, error } = resolveAuthorizedCharacter(
      ctx,
      payload.characterId ? String(payload.characterId) : null,
      'pledge a patron deity',
    );
    if (error || !ch) return error!;
    const deity = ctx.state.deities.find((d) => d.id === payload.deityId);
    if (!deity) return { status: 404, error: 'Deity not found.' };
    ch.patronDeityId = deity.id;
    ch.favor = Math.max(1, Number(ch.favor || 1));
    commitState(ctx);
    return { ok: true, character: ch };
  }

  if (sub === 'invoke_miracle') {
    const { ch, error } = resolveAuthorizedCharacter(
      ctx,
      payload.characterId ? String(payload.characterId) : null,
      'invoke a miracle',
    );
    if (error || !ch) return error!;
    const deity = ctx.state.deities.find((d) => d.id === (payload.deityId || ch.patronDeityId));
    if (!deity) return { status: 404, error: 'Select a Patron Deity first.' };
    const pMods = computePassiveModifiers(ch);
    const cost = Math.max(1, Number(deity.favorCost || 1) - pMods.deityFavorDiscount);
    if (Number(ch.favor || 0) < cost) return { status: 400, error: 'Not enough Divine Favor.' };
    ch.favor -= cost;

    if (/heal/i.test(deity.boonFormula)) {
      ch.hp = Math.min(ch.maxHp, ch.hp + 18);
      ch.mp = Math.min(ch.maxMp, ch.mp + 12);
    } else if (/temp hp/i.test(deity.boonFormula)) {
      ch.tempHp = Number(ch.tempHp || 0) + 10;
    }
    syncCharacterDerived(ctx, ch.id);

    let monsterResult = null;
    if (payload.targetMonsterId && /\+\d+/.test(deity.boonFormula)) {
      const bonusNum = Number(deity.boonFormula.match(/\+(\d+)/)?.[1] || 6);
      monsterResult = inflictDamageAction(ctx, {
        monsterId: payload.targetMonsterId,
        attackerId: ch.id,
        rawDamage: bonusNum,
        damageType: 'Divine Miracle',
        ignoreFormula: true,
      });
    }
    pushSystemToast(ctx, {
      title: `MIRACLE: ${deity.blessingName.toUpperCase()}`,
      message: `${ch.name} invoked ${deity.name}! (${deity.blessingDescription})`,
      category: 'loot',
    });
    commitState(ctx);
    return { ok: true, character: ch, monsterResult };
  }

  if (!isDm) return { status: 403, error: 'Only the DM can add, edit, or import Deities.' };

  if (sub === 'add_deity') {
    const d = (payload.deity && typeof payload.deity === 'object' ? payload.deity : {}) as Record<string, unknown>;
    if (!d.name) return { status: 400, error: 'Deity name is required.' };
    ctx.state.deities.push({
      id: `deity-${Date.now().toString(36)}`,
      name: String(d.name).slice(0, 60),
      title: String(d.title || 'Tower Constellation').slice(0, 60),
      domain: String(d.domain || 'Fate & Power').slice(0, 60),
      alignment: String(d.alignment || 'Neutral').slice(0, 30),
      tenets: String(d.tenets || '').slice(0, 300),
      blessingName: String(d.blessingName || 'Patron Blessing').slice(0, 60),
      blessingDescription: String(d.blessingDescription || 'Grants divine aid to faithful climbers.').slice(0, 300),
      boonFormula: String(d.boonFormula || '+6 Divine Damage').slice(0, 60),
      miracleRangeSpaces: Math.max(1, Number(d.miracleRangeSpaces || 6)),
      favorCost: Math.max(1, Number(d.favorCost || 1)),
      sourceDocUrl: String(d.sourceDocUrl || ''),
    });
  } else if (sub === 'import_google_doc') {
    let rawText = String(payload.rawText || '').trim();
    const docUrl = String(payload.docUrl || '').trim();
    if (!rawText && docUrl) {
      const docId = extractGoogleDocId(docUrl);
      if (!docId) return { status: 400, error: 'Provide a valid Google Docs link (/document/d/<ID>) or paste the doc text directly.' };
      const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
      let resp: Response;
      try {
        resp = await fetch(exportUrl);
      } catch {
        return {
          status: 400,
          error: 'Could not reach Google Docs to download that document. Check the link or paste the doc text directly.',
        };
      }
      if (!resp.ok) {
        return {
          status: 400,
          error: 'Could not read that Google Doc publicly (make sure "Anyone with the link can view" is enabled, or paste the Google Doc text below).',
        };
      }
      rawText = await resp.text();
    }
    const imported = parseDeityTextIntoEntries(rawText, docUrl);
    if (!imported.length) return { status: 400, error: 'No deity entries found to import.' };
    ctx.state.deities.push(...imported);
    pushSystemToast(ctx, {
      title: 'DEITY LORE IMPORTED',
      message: `DM imported ${imported.length} patron deity record(s) from Google Docs!`,
      category: 'info',
    });
  } else if (sub === 'grant_favor') {
    const ch = ctx.state.characters[String(payload.characterId || ctx.characterId || '')];
    if (ch) ch.favor = Math.max(0, Number(ch.favor || 0) + Number(payload.delta || 1));
  } else if (sub === 'remove_deity') {
    ctx.state.deities = ctx.state.deities.filter((d) => d.id !== payload.deityId);
  }

  commitState(ctx);
  return { ok: true, deities: ctx.state.deities };
}

export function equipmentAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const { ch, error } = resolveAuthorizedCharacter(
    ctx,
    payload.characterId ? String(payload.characterId) : null,
    'modify equipment',
  );
  if (error || !ch) return error!;

  const subAction = String(payload.subAction || '');
  const isFirstTimeStarter = subAction === 'choose_starter' && !ch.starterEquipmentChosen;
  if (ctx.role !== 'dm' && !isFirstTimeStarter && isStatsAndEquipmentLocked(ctx.state)) {
    return { status: 403, error: 'Equipment is locked while a session and story beat are active.' };
  }

  const slot = payload.slot ? (String(payload.slot) as EquipmentSlot) : undefined;
  const itemId = payload.itemId ? String(payload.itemId) : undefined;
  ch.equipment = ch.equipment || { mainHand: null, offHand: null, head: null, body: null, boots: null, relic: null };
  ch.inventory = ch.inventory || [];

  if (subAction === 'choose_starter') {
    const kitKey = String(payload.kit || 'swordsman');
    const built = buildStarterEquipment(
      kitKey,
      ch.id,
      payload.customCategory === 'ranged' ? 'ranged' : 'melee',
      payload.customWeaponId ? String(payload.customWeaponId) : undefined,
    );
    ch.equipment = built.equipment;
    ch.starterEquipmentChosen = true;
    logPlayerHistory(
      ctx.state,
      ch.id,
      'equipment',
      kitKey === 'custom'
        ? `Selected custom starter weapon: ${built.label} with fitted armor`
        : `Selected ${kitKey} starter equipment`,
    );
  } else if (subAction === 'unequip' && slot && ch.equipment[slot]) {
    const old = ch.equipment[slot]!;
    ch.equipment[slot] = null;
    ch.inventory.push({
      ...(typeof old === 'object' ? old : { name: String(old), slot, type: slot === 'mainHand' ? 'weapon' : slot === 'relic' ? 'relic' : 'armor' }),
      id: typeof old === 'object' && old.id ? old.id : `inv-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      category: old.type === 'weapon' ? 'weapon' : old.type === 'armor' ? 'armor' : 'relic',
      qty: 1,
    });
  } else if (subAction === 'equip' && itemId) {
    const idx = ch.inventory.findIndex((i) => i.id === itemId);
    if (idx === -1) return { status: 404, error: 'Item not in inventory.' };
    const item = ch.inventory[idx];
    const targetSlot = (slot || item.slot || (item.category === 'weapon' ? 'mainHand' : item.category === 'armor' ? 'body' : 'relic')) as EquipmentSlot;
    if (ch.equipment[targetSlot]) {
      const prev = ch.equipment[targetSlot]!;
      ch.inventory.push({
        ...(typeof prev === 'object' ? prev : { name: String(prev), slot: targetSlot, type: targetSlot === 'mainHand' ? 'weapon' : targetSlot === 'relic' ? 'relic' : 'armor' }),
        id: typeof prev === 'object' && prev.id ? prev.id : `inv-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
        category: prev.type || 'relic',
        qty: 1,
      });
    }
    const equippedItem: EquipmentItem = {
      id: item.id,
      name: item.name,
      slot: targetSlot,
      type: item.category === 'weapon' ? 'weapon' : item.category === 'armor' ? 'armor' : 'relic',
      attackBonus: Number(item.attackBonus || 0),
      damageDice: item.damageDice || (item.category === 'weapon' ? '1d8' : ''),
      damageType: item.damageType || 'Physical',
      rangeSpaces: Number(item.rangeSpaces || (item.category === 'weapon' ? 2 : 0)),
      ...(item.attackArea ? { attackArea: item.attackArea } : {}),
      ...(item.attackAreaModifier !== undefined ? { attackAreaModifier: clampAttackAreaModifier(item.attackAreaModifier) } : {}),
      ...(item.healFormula ? { healFormula: item.healFormula } : {}),
      ...(item.effectSpec ? { effectSpec: item.effectSpec } : {}),
      drBonus: Number(item.drBonus || 0),
      acBonus: Number(item.acBonus || 0),
      ...(item.artUrl ? { artUrl: item.artUrl } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
    };
    ch.equipment[targetSlot] = equippedItem;
    if (item.qty > 1) item.qty -= 1;
    else ch.inventory.splice(idx, 1);
  } else if (subAction === 'update_area') {
    const targetSlot = (slot || 'mainHand') as EquipmentSlot;
    const eq = ch.equipment[targetSlot];
    if (!eq) return { status: 404, error: `No item equipped in ${targetSlot}.` };
    if (payload.attackArea !== undefined && PLAYER_ATTACK_AREAS.includes(String(payload.attackArea) as AttackArea)) {
      eq.attackArea = String(payload.attackArea) as AttackArea;
    }
    if (payload.attackAreaModifier !== undefined) {
      eq.attackAreaModifier = clampAttackAreaModifier(payload.attackAreaModifier);
    }
    if (payload.healFormula !== undefined) {
      eq.healFormula = typeof payload.healFormula === 'string' && payload.healFormula.trim() ? payload.healFormula.trim().slice(0, 24) : undefined;
    }
    if (payload.effectSpec !== undefined) {
      const rawEff = payload.effectSpec && typeof payload.effectSpec === 'object' ? (payload.effectSpec as UnitEffectSpec) : null;
      eq.effectSpec = rawEff && rawEff.kind && UNIT_EFFECT_META[rawEff.kind as UnitEffectKind]
        ? {
            kind: rawEff.kind as UnitEffectKind,
            potency: Math.max(1, Math.min(50, Math.round(Number(rawEff.potency) || 2))),
            duration: Math.max(1, Math.min(10, Math.round(Number(rawEff.duration) || 2))),
            target: rawEff.target === 'self' || rawEff.target === 'enemy' || rawEff.target === 'all_allies' ? rawEff.target : undefined,
          }
        : null;
    }
  }

  recalculateCharacterAcAndDr(ctx.state, ch);
  syncCharacterDerived(ctx, ch.id);
  commitState(ctx);
  return { ok: true, character: ch };
}

export function inventoryAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const { ch, error } = resolveAuthorizedCharacter(
    ctx,
    payload.characterId ? String(payload.characterId) : null,
    'modify inventory',
  );
  if (error || !ch) return error!;
  ch.inventory = ch.inventory || [];

  const subAction = String(payload.subAction || '');
  const itemId = payload.itemId ? String(payload.itemId) : undefined;
  const item = (payload.item && typeof payload.item === 'object' ? payload.item : undefined) as Record<string, unknown> | undefined;

  if (subAction === 'add' && item?.name) {
    ch.inventory.push(
      createInventoryItem({
        name: String(item.name).slice(0, 60),
        category: String(item.category || 'relic'),
        qty: Math.max(1, Number(item.qty || 1)),
        healHp: Number(item.healHp || 0),
        healMp: Number(item.healMp || 0),
        slot: (item.slot ? String(item.slot) : undefined) as EquipmentSlot | '' | undefined,
        attackBonus: Number(item.attackBonus || 0),
        damageDice: String(item.damageDice || ''),
        damageType: String(item.damageType || 'Physical'),
        rangeSpaces: Number(item.rangeSpaces || 2),
        drBonus: Number(item.drBonus || 0),
        acBonus: Number(item.acBonus || 0),
        notes: String(item.notes || ''),
      }),
    );
  } else if (subAction === 'adjust_qty' && itemId) {
    const found = ch.inventory.find((i) => i.id === itemId);
    if (found) {
      found.qty = Math.max(0, found.qty + Number(payload.delta || 0));
      if (found.qty <= 0) ch.inventory = ch.inventory.filter((i) => i.id !== itemId);
    }
  } else if (subAction === 'use_consumable' && itemId) {
    const found = ch.inventory.find((i) => i.id === itemId);
    if (!found) return { status: 404, error: 'Item not found.' };
    const pMods = computePassiveModifiers(ch);
    const baseHp = Number(found.healHp || 0);
    const baseMp = Number(found.healMp || 0);
    const hpGain = baseHp > 0 ? baseHp + pMods.consumableBonusHp + pMods.healingReceivedBonus : 0;
    const mpGain = baseMp > 0 ? baseMp + pMods.consumableBonusMp : 0;
    ch.hp = Math.min(ch.maxHp, ch.hp + hpGain);
    ch.mp = Math.min(ch.maxMp, ch.mp + mpGain);
    found.qty -= 1;
    if (found.qty <= 0) ch.inventory = ch.inventory.filter((i) => i.id !== itemId);
    syncCharacterDerived(ctx, ch.id);
    ctx.state.combatLog.unshift({
      id: `cblog-${Date.now()}`,
      timestamp: new Date().toISOString(),
      attacker: ch.name,
      target: ch.name,
      rawDamage: 0,
      finalDamage: 0,
      damageType: 'Item',
      remainingHp: ch.hp,
      summary: `${ch.name} used ${found.name}${hpGain ? ` (+${hpGain} HP)` : ''}${mpGain ? ` (+${mpGain} MP)` : ''}.`,
    });
  } else if (subAction === 'trade' && itemId) {
    const found = ch.inventory.find((i) => i.id === itemId);
    if (!found) return { status: 404, error: 'Item not found in your inventory.' };
    const toChar = ctx.state.characters[String(payload.targetCharacterId || '')];
    if (!toChar) return { status: 404, error: 'Recipient player not found.' };
    if (toChar.id === ch.id) return { status: 400, error: 'Cannot trade an item to yourself.' };
    const qty = Math.max(1, Math.min(Number(found.qty || 1), Math.trunc(Number(payload.qty || 1))));
    found.qty = Number(found.qty || 1) - qty;
    if (found.qty <= 0) ch.inventory = ch.inventory.filter((i) => i.id !== itemId);
    toChar.inventory = toChar.inventory || [];
    const existingTarget = toChar.inventory.find((i) => i.name === found.name && i.category === found.category);
    if (existingTarget) {
      existingTarget.qty = Number(existingTarget.qty || 1) + qty;
    } else {
      toChar.inventory.push({
        ...found,
        id: `inv-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
        qty,
      });
    }
    logPlayerHistory(ctx.state, ch.id, 'trade', `Traded ${qty}× ${found.name} to ${toChar.name}`);
    logPlayerHistory(ctx.state, toChar.id, 'trade', `Received ${qty}× ${found.name} from ${ch.name}`);
    pushSystemToast(ctx, {
      title: 'ITEM TRADED!',
      message: `${ch.name} traded ${qty}× ${found.name} to ${toChar.name}!`,
      category: 'loot',
      target: toChar.id,
    });
  } else if (subAction === 'remove' && itemId) {
    ch.inventory = ch.inventory.filter((i) => i.id !== itemId);
  }

  commitState(ctx);
  return { ok: true, character: ch };
}
