import crypto from 'node:crypto';
import {
  BUILDING_BLUEPRINTS,
  CRAFTING_RECIPES,
  inferSettlementRoleFromLabel,
  isStatsAndEquipmentLocked,
  type Settlement,
  type SettlementBuilding,
  type SettlementBuildingType,
  type SettlementNpcRole,
} from '../../../shared';
import {
  advanceSettlementConstructionOnBeatResolved,
  commitState,
  createInventoryItem,
  logPlayerHistory,
  pushSystemToast,
  recalculateCharacterAcAndDr,
  recordChronicleEvent,
  resolveAuthorizedCharacter,
  syncCharacterDerived,
} from '../services/gameHelpers';
import type { ActionRequestContext, ActionResult } from './types';

const VALID_BUILDING_TYPES: SettlementBuildingType[] = ['forge', 'alchemy_lab', 'arcane_study', 'inn', 'shrine'];
const VALID_ROLES: SettlementNpcRole[] = ['blacksmith', 'alchemist', 'enchanter', 'innkeeper', 'oracle', 'villager'];

function findSettlement(ctx: ActionRequestContext, settlementId?: unknown): Settlement | undefined {
  const list = ctx.state.settlements || [];
  if (settlementId) {
    const found = list.find((s) => s.id === String(settlementId));
    if (found) return found;
  }
  return list[0];
}

function findResidentForRole(settlement: Settlement, role: SettlementNpcRole) {
  return (settlement.residents || []).find((r) => r.role === role);
}

export function settlementAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const sub = String(payload.subAction || '');
  const isDm = ctx.role === 'dm';

  // --- DM-ONLY MANAGEMENT ---
  if (sub === 'dm_create_settlement') {
    if (!isDm) return { status: 403, error: 'Only the Dungeon Master can create settlements.' };
    const name = String(payload.name || '').trim().slice(0, 60) || 'New Sanctuary';
    const ownerPartyName = String(payload.ownerPartyName || '').trim().slice(0, 60) || 'Visiting Party';
    const allowVisitors = payload.allowVisitors !== undefined ? Boolean(payload.allowVisitors) : true;
    const settlement: Settlement = {
      id: `settle-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name,
      ownerPartyName,
      allowVisitors,
      shrineUnlocked: false,
      buildings: [],
      residents: [],
      restedCharacterIdsByBeat: {},
      createdAt: new Date().toISOString(),
    };
    if (!Array.isArray(ctx.state.settlements)) ctx.state.settlements = [];
    ctx.state.settlements.push(settlement);
    commitState(ctx);
    return { ok: true, settlement };
  }

  const settlement = findSettlement(ctx, payload.settlementId);
  if (!settlement) return { status: 404, error: 'Settlement not found.' };

  if (!isDm && !settlement.allowVisitors && ctx.state.settlements?.[0]?.id !== settlement.id) {
    return { status: 403, error: 'This settlement is not currently open to visiting parties.' };
  }

  if (sub === 'dm_update_settlement') {
    if (!isDm) return { status: 403, error: 'Only the Dungeon Master can update settlement settings.' };
    if (payload.name !== undefined) settlement.name = String(payload.name).trim().slice(0, 60) || settlement.name;
    if (payload.ownerPartyName !== undefined) {
      settlement.ownerPartyName = String(payload.ownerPartyName).trim().slice(0, 60) || settlement.ownerPartyName;
    }
    if (payload.allowVisitors !== undefined) settlement.allowVisitors = Boolean(payload.allowVisitors);
    if (payload.shrineUnlocked !== undefined) {
      const prev = settlement.shrineUnlocked;
      settlement.shrineUnlocked = Boolean(payload.shrineUnlocked);
      if (!prev && settlement.shrineUnlocked) {
        pushSystemToast(ctx, {
          title: 'ANCIENT SHRINE AWAKENED!',
          message: `The Shrine of the Spire is now unlocked for construction in ${settlement.name}!`,
          category: 'loot',
        });
      }
    }
    commitState(ctx);
    return { ok: true, settlement };
  }

  if (sub === 'dm_advance_building') {
    if (!isDm) return { status: 403, error: 'Only the Dungeon Master can advance construction.' };
    const bType = String(payload.buildingType || '') as SettlementBuildingType;
    const b = (settlement.buildings || []).find((item) => item.type === bType);
    if (!b) return { status: 404, error: 'Building not found in this settlement.' };
    if (b.status !== 'under_construction' && b.status !== 'upgrading') {
      return { status: 400, error: 'Building is not currently under construction.' };
    }
    if (payload.completeNow) {
      b.beatsCompleted = b.beatsRequired;
      b.level = b.targetLevel;
      b.status = 'active';
      b.completedAt = new Date().toISOString();
      const bpName = BUILDING_BLUEPRINTS[b.type]?.name || b.type;
      pushSystemToast(ctx, {
        title: 'CONSTRUCTION COMPLETE!',
        message: `${bpName} (Lv ${b.level}) is now open in ${settlement.name}!`,
        category: 'loot',
      });
    } else {
      advanceSettlementConstructionOnBeatResolved(ctx, 'DM Downtime');
    }
    commitState(ctx);
    return { ok: true, settlement };
  }

  if (sub === 'dm_add_resident') {
    if (!isDm) return { status: 403, error: 'Only the Dungeon Master can add residents directly.' };
    const name = String(payload.name || '').trim().slice(0, 50);
    if (!name) return { status: 400, error: 'Resident name is required.' };
    const rawRole = String(payload.role || '').toLowerCase() as SettlementNpcRole;
    const role = VALID_ROLES.includes(rawRole) ? rawRole : inferSettlementRoleFromLabel(String(payload.role || ''));
    const resObj = {
      id: `res-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name,
      role,
      iconId: (payload.iconId ? String(payload.iconId) : undefined) as Settlement['residents'][number]['iconId'],
      dialogue: payload.dialogue ? String(payload.dialogue).slice(0, 240) : undefined,
      recruitedBy: 'Dungeon Master',
      recruitedAt: new Date().toISOString(),
    };
    settlement.residents.push(resObj);
    commitState(ctx);
    return { ok: true, resident: resObj, settlement };
  }

  // --- PLAYER & BEAT ACTIONS ---
  if (sub === 'invite_npc') {
    const beatId = String(payload.beatId || '');
    const tokenId = String(payload.tokenId || '');
    const beat = (ctx.state.storyBeats || []).find((b) => b.id === beatId);
    if (!beat?.arena) return { status: 404, error: 'Story beat arena not found.' };
    const npcTok = (beat.arena.tokens || []).find((t) => t.id === tokenId && t.type === 'npc');
    if (!npcTok) return { status: 404, error: 'NPC token not found.' };
    if (!npcTok.recruitable) {
      return { status: 400, error: `${npcTok.name} is not looking to join a settlement.` };
    }
    if (npcTok.recruitedToSettlementId) {
      return { status: 400, error: `${npcTok.name} has already joined a settlement!` };
    }

    const actorName =
      ctx.characterId && ctx.state.characters[ctx.characterId]
        ? ctx.state.characters[ctx.characterId].name
        : 'Dungeon Master';
    const role = npcTok.settlementRole || inferSettlementRoleFromLabel(npcTok.npcRole);
    const resident = {
      id: `res-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name: npcTok.name,
      role,
      iconId: npcTok.iconId,
      dialogue: npcTok.dialogue,
      recruitedBy: actorName,
      recruitedFloor: beat.floor || 1,
      recruitedAt: new Date().toISOString(),
      sourceBeatId: beat.id,
      sourceTokenId: npcTok.id,
    };
    settlement.residents.push(resident);
    npcTok.recruitedToSettlementId = settlement.id;

    pushSystemToast(ctx, {
      title: 'NEW SETTLEMENT RESIDENT!',
      message: `${npcTok.name} (${role.toUpperCase()}) joined ${settlement.name}!`,
      category: 'loot',
    });
    recordChronicleEvent(ctx.state, {
      floor: beat.floor,
      beatId: beat.id,
      beatTitle: beat.title,
      category: 'npc',
      actor: actorName,
      target: npcTok.name,
      summary: `${actorName} recruited ${npcTok.name} (${role}) to live in ${settlement.name}.`,
    });
    commitState(ctx);
    return { ok: true, resident, settlement, beat };
  }

  // All remaining settlement actions require authorized character & non-combat downtime
  if (!isDm && isStatsAndEquipmentLocked(ctx.state)) {
    return { status: 403, error: 'Settlement workshops cannot be used while a combat/story beat is active!' };
  }

  const { ch, error } = resolveAuthorizedCharacter(
    ctx,
    payload.characterId ? String(payload.characterId) : null,
    'use settlement services',
  );
  if (error || !ch) return error!;
  ch.currency = ch.currency || { gold: 0, manaStones: 0 };

  if (sub === 'start_or_fund_building') {
    const bType = String(payload.buildingType || '') as SettlementBuildingType;
    if (!VALID_BUILDING_TYPES.includes(bType)) {
      return { status: 400, error: 'Unknown settlement building type.' };
    }
    if (bType === 'shrine' && !settlement.shrineUnlocked) {
      return { status: 403, error: 'The Shrine of the Spire is still locked by the Dungeon Master.' };
    }
    const blueprint = BUILDING_BLUEPRINTS[bType];
    let existing = (settlement.buildings || []).find((b) => b.type === bType);

    if (!existing) {
      const spec = blueprint.levels[0];
      existing = {
        id: `bld-${bType}-${Date.now().toString(36)}`,
        type: bType,
        level: 0,
        targetLevel: 1,
        status: 'funding',
        fundedGold: 0,
        requiredGold: spec.requiredGold,
        fundedManaStones: 0,
        requiredManaStones: spec.requiredManaStones,
        beatsCompleted: 0,
        beatsRequired: spec.beatsRequired,
        startedAt: new Date().toISOString(),
      };
      settlement.buildings.push(existing);
    } else if (existing.status === 'active') {
      if (existing.level >= 3) {
        return { status: 400, error: `${blueprint.name} is already at maximum Level 3!` };
      }
      const nextSpec = blueprint.levels[existing.level];
      existing.targetLevel = nextSpec.level;
      existing.status = 'funding';
      existing.fundedGold = 0;
      existing.requiredGold = nextSpec.requiredGold;
      existing.fundedManaStones = 0;
      existing.requiredManaStones = nextSpec.requiredManaStones;
      existing.beatsCompleted = 0;
      existing.beatsRequired = nextSpec.beatsRequired;
    } else if (existing.status !== 'funding') {
      return {
        status: 400,
        error: `${blueprint.name} is already under construction (${existing.beatsCompleted}/${existing.beatsRequired} Beat(s) completed).`,
      };
    }

    const remainingGold = Math.max(0, existing.requiredGold - existing.fundedGold);
    const remainingStones = Math.max(0, existing.requiredManaStones - existing.fundedManaStones);
    const addGold = Math.min(remainingGold, Math.max(0, Math.trunc(Number(payload.gold || 0))));
    const addStones = Math.min(remainingStones, Math.max(0, Math.trunc(Number(payload.manaStones || 0))));

    if (addGold > Number(ch.currency.gold || 0)) {
      return { status: 400, error: `Not enough Gold (need ${addGold}G, have ${ch.currency.gold}G).` };
    }
    if (addStones > Number(ch.currency.manaStones || 0)) {
      return { status: 400, error: `Not enough Mana Stones (need ${addStones}, have ${ch.currency.manaStones}).` };
    }

    ch.currency.gold = Number(ch.currency.gold || 0) - addGold;
    ch.currency.manaStones = Number(ch.currency.manaStones || 0) - addStones;
    existing.fundedGold += addGold;
    existing.fundedManaStones += addStones;

    if (existing.fundedGold >= existing.requiredGold && existing.fundedManaStones >= existing.requiredManaStones) {
      existing.status = existing.level > 0 ? 'upgrading' : 'under_construction';
      existing.beatsCompleted = 0;
      pushSystemToast(ctx, {
        title: 'CONSTRUCTION STARTED!',
        message: `${blueprint.name} (Lv ${existing.targetLevel}) is now building in ${settlement.name} — complete ${existing.beatsRequired} Beat(s) to finish!`,
        category: 'info',
      });
      recordChronicleEvent(ctx.state, {
        category: 'story',
        actor: ch.name,
        summary: `Funded ${blueprint.name} Lv ${existing.targetLevel} in ${settlement.name} (${existing.beatsRequired} beat(s) remaining).`,
      });
    }

    commitState(ctx);
    return { ok: true, building: existing, settlement, character: ch };
  }

  if (sub === 'craft_item') {
    const recipe = CRAFTING_RECIPES.find((r) => r.id === String(payload.recipeId || ''));
    if (!recipe) return { status: 404, error: 'Crafting recipe not found.' };

    const b = (settlement.buildings || []).find((item) => item.type === recipe.buildingType);
    const bp = BUILDING_BLUEPRINTS[recipe.buildingType];
    if (!b || b.level < recipe.minBuildingLevel) {
      return {
        status: 400,
        error: `${bp.name} Level ${recipe.minBuildingLevel} is required to craft ${recipe.name}!`,
      };
    }
    const resident = findResidentForRole(settlement, bp.roleRequired);
    if (!resident) {
      return {
        status: 400,
        error: `Recruit a ${bp.roleLabel} NPC during a beat to operate ${bp.name}!`,
      };
    }

    if (Number(ch.currency.gold || 0) < recipe.goldCost) {
      return { status: 400, error: `Not enough Gold (need ${recipe.goldCost}G, have ${ch.currency.gold}G).` };
    }
    if (Number(ch.currency.manaStones || 0) < recipe.manaStoneCost) {
      return { status: 400, error: `Not enough Mana Stones (need ${recipe.manaStoneCost}).` };
    }

    // Verify all required materials in player inventory
    for (const mat of recipe.materials) {
      const totalQty = (ch.inventory || [])
        .filter((i) => i.name.trim().toLowerCase() === mat.name.trim().toLowerCase())
        .reduce((sum, i) => sum + Number(i.qty || 0), 0);
      if (totalQty < mat.qty) {
        return { status: 400, error: `Missing crafting material: ${mat.qty}× ${mat.name} (have ${totalQty}).` };
      }
    }

    // Deduct Gold, Mana Stones, and materials
    ch.currency.gold -= recipe.goldCost;
    ch.currency.manaStones -= recipe.manaStoneCost;
    for (const mat of recipe.materials) {
      let remaining = mat.qty;
      for (const item of ch.inventory || []) {
        if (remaining <= 0) break;
        if (item.name.trim().toLowerCase() !== mat.name.trim().toLowerCase()) continue;
        const take = Math.min(remaining, Number(item.qty || 0));
        item.qty = Number(item.qty || 0) - take;
        remaining -= take;
      }
      ch.inventory = (ch.inventory || []).filter((i) => Number(i.qty || 0) > 0);
    }

    const crafted = createInventoryItem({
      name: recipe.name,
      category: recipe.category,
      slot: recipe.slot || '',
      qty: 1,
      attackBonus: recipe.attackBonus || 0,
      damageDice: recipe.damageDice || '',
      damageType: recipe.damageType || 'Physical',
      rangeSpaces: recipe.rangeSpaces ?? (recipe.category === 'weapon' ? 1 : 0),
      acBonus: recipe.acBonus || 0,
      drBonus: recipe.drBonus || 0,
      healHp: recipe.healHp || 0,
      healMp: recipe.healMp || 0,
      notes: `${recipe.notes} • Crafted by ${resident.name}`,
    });
    ch.inventory.push(crafted);
    logPlayerHistory(ctx.state, ch.id, 'loot', `Crafted ${crafted.name} at ${bp.name} (${resident.name})`);
    recordChronicleEvent(ctx.state, {
      category: 'loot',
      actor: ch.name,
      target: resident.name,
      summary: `${ch.name} had ${resident.name} craft ${crafted.name} at ${settlement.name}.`,
    });
    commitState(ctx);
    return { ok: true, item: crafted, character: ch, settlement };
  }

  if (sub === 'enchant_equipment') {
    const study = (settlement.buildings || []).find((b) => b.type === 'arcane_study');
    if (!study || study.level < 1) {
      return { status: 400, error: 'An active Arcane Study (Lv 1+) is required to enchant gear.' };
    }
    const enchanter = findResidentForRole(settlement, 'enchanter');
    if (!enchanter) {
      return { status: 400, error: 'Recruit an Enchanter NPC to operate the Arcane Study.' };
    }
    const slot = String(payload.slot || '') as keyof typeof ch.equipment;
    const eqItem = ch.equipment?.[slot];
    if (!eqItem) return { status: 400, error: 'No item equipped in that slot.' };

    const curEnchant = Number((eqItem as { enchantLevel?: number }).enchantLevel || 0);
    if (curEnchant >= study.level) {
      return { status: 400, error: `${eqItem.name} is already enchanted to +${curEnchant} (max for Arcane Study Lv ${study.level}).` };
    }
    const nextTier = curEnchant + 1;
    const goldCost = 30 * nextTier;
    const stoneCost = nextTier;
    if (Number(ch.currency.gold || 0) < goldCost) {
      return { status: 400, error: `Not enough Gold (need ${goldCost}G).` };
    }
    if (Number(ch.currency.manaStones || 0) < stoneCost) {
      return { status: 400, error: `Not enough Mana Stones (need ${stoneCost}).` };
    }

    ch.currency.gold -= goldCost;
    ch.currency.manaStones -= stoneCost;
    if (eqItem.type === 'weapon') {
      eqItem.attackBonus = Number(eqItem.attackBonus || 0) + 1;
    } else {
      eqItem.acBonus = Number(eqItem.acBonus || 0) + 1;
    }
    (eqItem as { enchantLevel?: number }).enchantLevel = nextTier;
    eqItem.name = `${eqItem.name.replace(/\s+\+\d+$/, '')} +${nextTier}`;
    recalculateCharacterAcAndDr(ctx.state, ch);
    syncCharacterDerived(ctx, ch.id);
    logPlayerHistory(ctx.state, ch.id, 'loot', `Enchanted ${eqItem.name} at Arcane Study (${enchanter.name})`);
    commitState(ctx);
    return { ok: true, character: ch, settlement };
  }

  if (sub === 'rest_at_inn') {
    const inn = (settlement.buildings || []).find((b) => b.type === 'inn');
    if (!inn || inn.level < 1) {
      return { status: 400, error: 'An active Sanctuary Inn is required to rest.' };
    }
    const innkeeper = findResidentForRole(settlement, 'innkeeper');
    if (!innkeeper) {
      return { status: 400, error: 'Recruit an Innkeeper NPC to run the Sanctuary Inn.' };
    }
    const restKey = `round-${ctx.state.combat?.round || 1}-beats-${(ctx.state.storyBeats || []).filter((b) => b.status === 'resolved').length}`;
    settlement.restedCharacterIdsByBeat = settlement.restedCharacterIdsByBeat || {};
    const already = settlement.restedCharacterIdsByBeat[restKey] || [];
    if (already.includes(ch.id)) {
      return { status: 400, error: 'You already rested at the Sanctuary Inn since the last resolved beat!' };
    }
    ch.hp = ch.maxHp;
    ch.mp = ch.maxMp;
    const tempBonus = inn.level * 5;
    ch.tempHp = Math.max(Number(ch.tempHp || 0), tempBonus);
    settlement.restedCharacterIdsByBeat[restKey] = [...already, ch.id];
    syncCharacterDerived(ctx, ch.id);
    logPlayerHistory(ctx.state, ch.id, 'system', `Rested at ${settlement.name} Sanctuary Inn (Full HP/MP + ${tempBonus} Temp HP)`);
    commitState(ctx);
    return { ok: true, character: ch, settlement };
  }

  if (sub === 'pray_at_shrine') {
    if (!settlement.shrineUnlocked) {
      return { status: 403, error: 'The Shrine of the Spire is still locked by the Dungeon Master.' };
    }
    const shrine = (settlement.buildings || []).find((b) => b.type === 'shrine');
    if (!shrine || shrine.level < 1) {
      return { status: 400, error: 'Build the Shrine of the Spire first.' };
    }
    const oracle = findResidentForRole(settlement, 'oracle');
    if (!oracle) {
      return { status: 400, error: 'Recruit an Oracle NPC to tend the Shrine.' };
    }
    if (!ch.patronDeityId) {
      return { status: 400, error: 'Pledge to a Patron Deity first before making an offering.' };
    }
    const stoneCost = 1;
    if (Number(ch.currency.manaStones || 0) < stoneCost) {
      return { status: 400, error: 'Need 1 Mana Stone to offer at the Shrine.' };
    }
    ch.currency.manaStones -= stoneCost;
    const favorGain = shrine.level >= 2 ? 2 : 1;
    ch.favor = Number(ch.favor || 0) + favorGain;
    logPlayerHistory(ctx.state, ch.id, 'system', `Offered 1 Mana Stone at Shrine of the Spire (+${favorGain} Favor)`);
    recordChronicleEvent(ctx.state, {
      category: 'story',
      actor: ch.name,
      summary: `${ch.name} prayed at the Shrine of the Spire (+${favorGain} Deity Favor).`,
    });
    commitState(ctx);
    return { ok: true, character: ch, settlement };
  }

  return { status: 400, error: `Unknown settlement subAction: ${sub}` };
}
