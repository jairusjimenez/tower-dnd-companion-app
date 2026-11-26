import crypto from 'node:crypto';
import {
  CHEST_TIERS,
  getDefaultLootTableForMonster,
  getFloorLootProfile,
  getMonsterXpReward,
  getChestDefaultsForFloor,
  isBossToken,
  scaleLootDropForFloor,
  shouldMonsterDropChest,
  type Character,
  type ChestTier,
  type Monster,
  type MonsterDefeatSummary,
  type StoryBeat,
} from '../../../../shared';
import {
  advanceSettlementConstructionOnBeatResolved,
  applyGoldBonus,
  createInventoryItem,
  grantXpToCharacter,
  logPlayerHistory,
  pushSystemToast,
  removeMonsterTokensFromMaps,
  syncCharacterDerived,
} from '../../services/gameHelpers';
import { type ActionRequestContext } from '../types';

export function checkAndTriggerBeatVictory(ctx: ActionRequestContext, beat: StoryBeat | null | undefined): boolean {
  if (!beat || beat.beatType === 'narration' || beat.status === 'resolved' || beat.status === 'failed') {
    return false;
  }
  const remainingLiving = (beat.arena?.tokens || []).filter((t) => {
    if (t.type !== 'monster') return false;
    const m = ctx.state.monsters.find((mon) => mon.id === t.id);
    return Boolean(m && Number(m.hp ?? 0) > 0);
  });
  if (remainingLiving.length > 0) return false;

  const log = beat.defeatedLog || [];
  beat.status = 'resolved';
  beat.victorySummary = {
    timestamp: new Date().toISOString(),
    roundsTaken: Math.max(1, Number(ctx.state.combat?.round || 1)),
    monstersDefeated: log.length,
    defeatedMonsterNames: log.map((d) => d.monsterName),
    totalXpGained: log.reduce((acc, d) => acc + Number(d.xpGained || 0), 0),
    totalGoldGained: log.reduce((acc, d) => acc + Number(d.goldGained || 0), 0),
    totalManaStonesGained: log.reduce((acc, d) => acc + Number(d.manaStonesGained || 0), 0),
    itemsLooted: log.flatMap((d) => d.items || []),
  };
  ctx.state.combat.active = false;
  ctx.state.pendingReactions = [];
  ctx.state.lastResolvedClash = null;
  pushSystemToast(ctx, {
    title: 'VICTORY!',
    message: `All ${log.length} monster${log.length === 1 ? '' : 's'} defeated in "${beat.title}"!`,
    category: 'loot',
  });
  advanceSettlementConstructionOnBeatResolved(ctx, beat.title);
  return true;
}

export function recordNonPlayerMonsterDefeat(
  ctx: ActionRequestContext,
  monster: Monster,
  beat: StoryBeat | null | undefined,
  killerName: string,
): void {
  const summary: MonsterDefeatSummary = {
    id: `defeat-${Date.now().toString(36)}-${crypto.randomInt(100, 999)}`,
    monsterId: monster.id,
    monsterName: monster.name,
    floor: Math.max(1, Number(monster.floor || 1)),
    killerName,
    xpGained: 0,
    goldGained: 0,
    manaStonesGained: 0,
    items: [],
  };
  ctx.state.recentMonsterDefeats = [summary, ...(ctx.state.recentMonsterDefeats || [])].slice(0, 20);
  if (beat) {
    beat.defeatedLog = [...(beat.defeatedLog || []), summary];
  }
}

export function awardMonsterDefeatLoot(
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
  if (opts?.dropBeat) {
    const beat = opts.dropBeat;
    beat.defeatedLog = [...(beat.defeatedLog || []), summary];
    checkAndTriggerBeatVictory(ctx, beat);
  }
  return summary;
}
