import crypto from 'node:crypto';
import {
  CHEST_TIERS,
  CHEST_TIER_LOOT_TABLES,
  MONSTER_ATTACK_AREAS,
  TOKEN_ICON_META,
  UNIT_EFFECT_META,
  clampAttackAreaModifier,
  computePassiveModifiers,
  inferDefaultAttackAreaForMonster,
  getDefaultLootTableForMonster,
  getDefaultSkillsForMonster,
  type AttackArea,
  type Character,
  type ChestTier,
  type Monster,
  type MonsterAttackArea,
  type MonsterSkill,
  type TokenIconId,
  type UnitEffectKind,
  type UnitEffectSpec,
} from '../../../../shared';
import { rollDiceServer } from '../../services/dice';
import {
  applyUnitEffect,
  commitState,
  pushSystemToast,
  syncCharacterDerived,
  syncMonsterDerived,
} from '../../services/gameHelpers';
import {
  type ActionRequestContext,
  type ActionResult,
} from '../types';

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
