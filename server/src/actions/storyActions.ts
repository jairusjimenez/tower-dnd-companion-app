import crypto from 'node:crypto';
import {
  BALANCE,
  CHEST_TIERS,
  DEFAULT_COMBAT_MAX_ROUNDS,
  PASSIVE_SKILL_POOL,
  TOKEN_ICON_META,
  VALID_FLOOR_THEME_IDS,
  VALID_TERRAIN_TYPES,
  clampCombatMaxRounds,
  computeActiveEffectModifiers,
  computeCharacterMoveSpaces,
  computePassiveModifiers,
  computeReachableMoveCells,
  computeStatModifier,
  generateArenaTerrainFromPrompt,
  generateThemedStoryBeat,
  getChestDefaultsForFloor,
  getPartyFloor,
  hasObserveLineOfSight,
  isPartyInCombat,
  restSpotRestore,
  rollChestLoot,
  scaleMonsterForFloor,
  scaleTreasureForFloor,
  spaceDistanceBetweenPoints,
  type BeatEncounterSpec,
  type BeatTreasureSpec,
  type Character,
  type ChestLootSummary,
  type ChestPassiveTrigger,
  type ChestTier,
  type EquipmentSlot,
  type GameState,
  type MapToken,
  type Monster,
  type StoryBeat,
  type StoryBeatPrompt,
  type StoryPromptBranch,
  type StoryPromptStatCheckResult,
  type TerrainType,
  type TokenIconId,
} from '../../../shared';
import { rollSingleDie } from '../services/dice';
import {
  applyGoldBonus,
  clampArenaEntitiesToBounds,
  commitState,
  createInventoryItem,
  grantXpToCharacter,
  logPlayerHistory,
  pushSystemToast,
  recordChronicleEvent,
  resetArenaTurnFlags,
  resetCombatPassiveFlags,
  syncCharacterDerived,
  syncMonsterDerived,
} from '../services/gameHelpers';
import { createDefaultBeatArena, ensureBeatArena } from '../store/initialState';
import { maskMonsterForRole } from '../store/filterState';
import { spawnMonsterAction } from './combatActions';
import type { ActionRequestContext, ActionResult } from './types';

function createNpcArenaToken(n: Record<string, unknown>, idx: number, gridCols: number, gridRows: number): MapToken {
  const npcName = String(n.name || 'NPC').trim().slice(0, 50) || 'NPC';
  const npcId = `npc-${Date.now().toString(36)}-${idx}-${crypto.randomInt(10, 99)}`;
  const nx = n.startX !== undefined && n.startX !== '' && n.startX !== null
    ? Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(n.startX)) - 1))
    : Math.min(gridCols - 1, 2 + idx * 2);
  const ny = n.startY !== undefined && n.startY !== '' && n.startY !== null
    ? Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(n.startY)) - 1))
    : Math.min(gridRows - 1, Math.floor(gridRows / 2));

  const rawNpcIcon = String(n.iconId || '').trim() as TokenIconId;
  return {
    id: npcId,
    name: npcName,
    ...(rawNpcIcon && TOKEN_ICON_META[rawNpcIcon] ? { iconId: rawNpcIcon } : {}),
    npcRole: String(n.npcRole || n.role || 'NPC').slice(0, 40),
    dialogue: String(n.dialogue || `Greetings, Climber. Speak with ${npcName}.`).slice(0, 300),
    rewardType: ['none', 'item', 'skill_book', 'xp'].includes(String(n.rewardType)) ? String(n.rewardType) : 'none',
    rewardItemName: String(n.rewardItemName || '').slice(0, 60),
    rewardItemCategory: String(n.rewardItemCategory || 'relic'),
    rewardSkillDesc: String(n.rewardSkillDesc || '').slice(0, 160),
    rewardXp: Math.max(0, Number(n.rewardXp || 0)),
    rewardGold: Math.max(0, Number(n.rewardGold || 0)),
    rewardClaimed: false,
    type: 'npc',
    x: nx,
    y: ny,
    color: '#10b981',
    hp: null,
    maxHp: null,
    hiddenFromPlayers: Boolean(n.hiddenFromPlayers),
    label: npcName.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'NP',
  };
}

function sanitizePromptBranches(rawBranches: unknown): StoryPromptBranch[] {
  if (!Array.isArray(rawBranches)) return [];
  const list: StoryPromptBranch[] = [];
  const validStats = new Set(['STR', 'AGI', 'VIT', 'INT', 'PER', 'LUCK']);
  for (const b of rawBranches as Array<Record<string, unknown>>) {
    const option = String(b?.option || '').trim().slice(0, 140);
    const scenario = String(b?.scenario || '').trim().slice(0, 800);
    if (!option || !scenario) continue;
    const dmNote = String(b?.dmNote || '').trim().slice(0, 400);
    const nextQuestion = String(b?.nextQuestion || '').trim().slice(0, 500);
    const rawNextOpts = Array.isArray(b?.nextOptions)
      ? b.nextOptions
      : typeof b?.nextOptions === 'string'
        ? String(b.nextOptions).split(',')
        : [];
    const nextOptions = rawNextOpts
      .map((o) => String(o || '').trim().slice(0, 140))
      .filter(Boolean)
      .slice(0, 8);

    const rawStat = String(b?.statCheckStat || '').trim().toUpperCase();
    const statCheckStat = validStats.has(rawStat) ? rawStat : undefined;
    const statCheckDc = statCheckStat
      ? Math.max(5, Math.min(40, Math.trunc(Number(b?.statCheckDc || 12))))
      : undefined;

    const rawRewardType = String(b?.rewardType || 'none');
    const rewardType = ['none', 'treasure', 'chest'].includes(rawRewardType)
      ? (rawRewardType as 'none' | 'treasure' | 'chest')
      : 'none';
    const rewardTreasureId = String(b?.rewardTreasureId || '').trim().slice(0, 60) || undefined;
    const rewardItemName = String(b?.rewardItemName || '').trim().slice(0, 60) || undefined;
    const rewardItemCategory = String(b?.rewardItemCategory || 'relic').trim().slice(0, 30) || 'relic';
    const rawChestTier = String(b?.rewardChestTier || 'Common');
    const rewardChestTier = (CHEST_TIERS.includes(rawChestTier as ChestTier) ? rawChestTier : 'Common') as ChestTier;
    const rewardGold = b?.rewardGold !== undefined ? Math.max(0, Math.trunc(Number(b.rewardGold || 0))) : undefined;
    const rewardManaStones = b?.rewardManaStones !== undefined ? Math.max(0, Math.trunc(Number(b.rewardManaStones || 0))) : undefined;

    const endsInCombat = Boolean(b?.endsInCombat);
    const combatMonsterPresetId = String(b?.combatMonsterPresetId || '').trim().slice(0, 60) || undefined;
    const combatMonsterQty = endsInCombat
      ? Math.max(1, Math.min(12, Math.trunc(Number(b?.combatMonsterQty || 2))))
      : undefined;

    list.push({
      option,
      scenario,
      ...(dmNote ? { dmNote } : {}),
      ...(nextQuestion ? { nextQuestion } : {}),
      ...(nextOptions.length > 0 ? { nextOptions } : {}),
      ...(statCheckStat ? { statCheckStat, statCheckDc } : {}),
      ...(rewardType !== 'none'
        ? {
            rewardType,
            rewardTreasureId,
            rewardItemName,
            rewardItemCategory,
            rewardChestTier,
            rewardGold,
            rewardManaStones,
          }
        : {}),
      ...(endsInCombat
        ? {
            endsInCombat: true,
            combatMonsterPresetId,
            combatMonsterQty,
          }
        : {}),
    });
  }
  return list.slice(0, 12);
}

function getActivePromptPartyIds(state: GameState): string[] {
  const allIds = Object.keys(state.characters || {});
  if (allIds.length <= 1) return allIds;
  const mockCharIds = new Set<string>(
    [
      state.playerAccounts?.['mock.player@tower.gg']?.characterId,
      state.playerAccounts?.['story.showcase@tower.gg']?.characterId,
    ].filter((id): id is string => Boolean(id)),
  );
  const nonMockIds = allIds.filter((id) => !mockCharIds.has(id));
  return nonMockIds.length > 0 ? nonMockIds : allIds;
}

function executePromptBranchSideEffects(
  ctx: ActionRequestContext,
  beat: StoryBeat,
  promptObj: StoryBeatPrompt,
  matchedBranch: StoryPromptBranch,
): void {
  const floor = Math.max(1, Number(beat.floor || 1));
  const targetIds =
    promptObj.target !== 'all' && ctx.state.characters?.[promptObj.target]
      ? [promptObj.target]
      : getActivePromptPartyIds(ctx.state);

  promptObj.triggeredOption = matchedBranch.option;
  promptObj.triggeredScenario = matchedBranch.scenario;

  pushSystemToast(ctx, {
    title: `IF "${matchedBranch.option.toUpperCase()}" -> SCENARIO TRIGGERED!`,
    message: matchedBranch.scenario,
    category: 'info',
  });

  // 1. Stat Check (uses player stats + floor-scaled bonus, grants floor-scaled XP & Gold on pass)
  if (matchedBranch.statCheckStat) {
    const statKey = matchedBranch.statCheckStat;
    const dc = Math.max(5, Number(matchedBranch.statCheckDc || 10 + Math.floor(floor * 1.2)));
    const floorBonus = Math.floor(floor / 2);
    const results: StoryPromptStatCheckResult[] = [];
    let anyPassed = false;

    for (const cid of targetIds) {
      const ch = ctx.state.characters?.[cid];
      if (!ch) continue;
      const statScore = Number(ch.stats?.[statKey] ?? 10);
      const statMod = computeStatModifier(statScore, ctx.state.mechanics, ch);
      const roll = crypto.randomInt(1, 21);
      const total = roll + statMod + floorBonus;
      const passed = total >= dc;
      if (passed) anyPassed = true;

      let rewardSummary = '';
      if (passed) {
        const bonusXp = 25 * floor;
        const baseGold = 20 * floor;
        const bonusGold = applyGoldBonus(ch, baseGold, false);
        grantXpToCharacter(ctx.state, ch, bonusXp);
        ch.currency = ch.currency || { gold: 0, manaStones: 0 };
        ch.currency.gold = Number(ch.currency.gold || 0) + bonusGold;
        rewardSummary = `+${bonusXp} XP, +${bonusGold}G (${floor}F Stat Bonus)`;
        logPlayerHistory(
          ctx.state,
          ch.id,
          'story',
          `Passed ${statKey} Check (${total} vs DC ${dc}) on ${floor}F: ${rewardSummary}`,
        );
      } else {
        logPlayerHistory(
          ctx.state,
          ch.id,
          'story',
          `Failed ${statKey} Check (${total} vs DC ${dc}) on ${floor}F`,
        );
      }

      results.push({
        characterId: ch.id,
        characterName: ch.name,
        statKey,
        statScore,
        statMod,
        floorBonus,
        roll,
        total,
        dc,
        passed,
        ...(rewardSummary ? { rewardSummary } : {}),
      });

      const totalMod = statMod + floorBonus;
      const modStr = totalMod >= 0 ? `+${totalMod}` : `${totalMod}`;
      ctx.state.rollLog = ctx.state.rollLog || [];
      ctx.state.rollLog.unshift({
        id: `roll-${Date.now()}-${crypto.randomInt(10, 99)}`,
        timestamp: new Date().toISOString(),
        rollerName: ch.name,
        rollerRole: 'player',
        label: `${statKey} Stat Check (${floor}F Scenario)`,
        formula: `1d20${modStr}`,
        count: 1,
        sides: 20,
        rolls: [roll],
        dropped: [],
        modifier: totalMod,
        diceTotal: roll,
        total,
        dc,
        passed,
        rewardSummary: rewardSummary || undefined,
        breakdown: `d20(${roll}) + ${statKey}(${statMod >= 0 ? `+${statMod}` : statMod}) + Floor(+${floorBonus}) = ${total} vs DC ${dc}`,
        mode: 'normal',
        isCrit: roll === 20,
        isFumble: roll === 1,
        isSecret: false,
      });
      ctx.state.rollLog = ctx.state.rollLog.slice(0, 50);
    }

    promptObj.triggeredStatCheckResults = results;
    if (results.length > 0) {
      const summaryText = results
        .map(
          (r) =>
            `${r.characterName}: d20(${r.roll}) + ${r.statKey}(${r.statMod >= 0 ? `+${r.statMod}` : r.statMod}) + Floor(+${r.floorBonus}) = ${r.total} vs DC ${r.dc} [${r.passed ? `PASS! ${r.rewardSummary}` : 'FAIL'}]`,
        )
        .join(' | ');
      pushSystemToast(ctx, {
        title: `${statKey} STAT CHECK (DC ${dc} • ${floor}F SCALED)`,
        message: summaryText,
        category: anyPassed ? 'loot' : 'warning',
      });
    }
  }

  // 2. Scenario Treasure or Treasure Chest Reward
  if (matchedBranch.rewardType === 'treasure') {
    const catalogEntry = matchedBranch.rewardTreasureId
      ? (ctx.state.treasureCatalog || []).find((t) => t.id === matchedBranch.rewardTreasureId)
      : undefined;
    const scaledCat = catalogEntry ? scaleTreasureForFloor(catalogEntry, floor) : null;
    const itemName = matchedBranch.rewardItemName || scaledCat?.name || `${floor}F Scenario Relic`;
    const itemCategory = matchedBranch.rewardItemCategory || scaledCat?.category || 'relic';
    const goldAmt = matchedBranch.rewardGold !== undefined ? matchedBranch.rewardGold : (scaledCat?.scaledGold ?? 35 * floor);
    const stonesAmt = matchedBranch.rewardManaStones !== undefined ? matchedBranch.rewardManaStones : (scaledCat?.scaledManaStones ?? Math.max(1, Math.floor(floor / 2)));

    for (const cid of targetIds) {
      const ch = ctx.state.characters?.[cid];
      if (!ch) continue;
      ch.currency = ch.currency || { gold: 0, manaStones: 0 };
      const finalG = applyGoldBonus(ch, goldAmt, false);
      ch.currency.gold = Number(ch.currency.gold || 0) + finalG;
      ch.currency.manaStones = Number(ch.currency.manaStones || 0) + stonesAmt;
      ch.inventory = ch.inventory || [];
      ch.inventory.push(
        createInventoryItem({
          name: itemName,
          category: itemCategory,
          slot: (scaledCat?.slot || undefined) as EquipmentSlot | '' | undefined,
          attackBonus: Number(scaledCat?.attackBonus || 0),
          damageDice: String(scaledCat?.damageDice || ''),
          acBonus: Number(scaledCat?.acBonus || 0),
          drBonus: Number(scaledCat?.drBonus || 0),
          notes: scaledCat?.notes || `Scenario Reward from "${beat.title}" (${floor}F)`,
        }),
      );
      logPlayerHistory(ctx.state, ch.id, 'loot', `Scenario Treasure: ${itemName} (+${finalG}G, +${stonesAmt} Stones)`);
    }

    const rewText = `Treasure: ${itemName} (${itemCategory}) + ${goldAmt}G + ${stonesAmt} Mana Stones`;
    promptObj.triggeredRewardSummary = rewText;
    pushSystemToast(ctx, {
      title: 'SCENARIO TREASURE AWARDED!',
      message: rewText,
      category: 'loot',
    });
  } else if (matchedBranch.rewardType === 'chest') {
    const chestTier = (matchedBranch.rewardChestTier && CHEST_TIERS.includes(matchedBranch.rewardChestTier)
      ? matchedBranch.rewardChestTier
      : 'Common') as ChestTier;
    const defaults = getChestDefaultsForFloor(chestTier, floor, ctx.state.chestCatalog);
    const rolled = rollChestLoot(chestTier, floor, () => crypto.randomInt(0, 1_000_000) / 1_000_000, ctx.state.chestCatalog);
    const goldAmt = matchedBranch.rewardGold !== undefined && matchedBranch.rewardGold > 0 ? matchedBranch.rewardGold : rolled.gold || defaults.gold;
    const stonesAmt = matchedBranch.rewardManaStones !== undefined && matchedBranch.rewardManaStones > 0 ? matchedBranch.rewardManaStones : rolled.manaStones || defaults.manaStones;

    const arena = ensureBeatArena(beat, ctx.state.characters);
    arena.chests = arena.chests || [];
    const chestId = `chest-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`;
    const droppedItems = [
      ...(matchedBranch.rewardItemName
        ? [{ name: matchedBranch.rewardItemName, category: matchedBranch.rewardItemCategory || 'relic', tier: chestTier, notes: `Scenario ${chestTier} Chest` }]
        : []),
      ...rolled.items.map((it) => ({
        name: it.itemName,
        category: it.category,
        tier: it.tier || chestTier,
        notes: it.notes || `${chestTier} Chest (${floor}F)`,
      })),
    ];

    for (const cid of targetIds) {
      const ch = ctx.state.characters?.[cid];
      if (!ch) continue;
      ch.currency = ch.currency || { gold: 0, manaStones: 0 };
      const finalG = applyGoldBonus(ch, goldAmt, true);
      ch.currency.gold = Number(ch.currency.gold || 0) + finalG;
      ch.currency.manaStones = Number(ch.currency.manaStones || 0) + stonesAmt;
      ch.inventory = ch.inventory || [];
      for (const item of droppedItems) {
        ch.inventory.push(
          createInventoryItem({
            name: item.name,
            category: item.category,
            notes: item.notes,
          }),
        );
      }
      logPlayerHistory(
        ctx.state,
        ch.id,
        'loot',
        `Scenario ${chestTier} Chest: +${finalG}G, +${stonesAmt} Stones${droppedItems.length ? `, ${droppedItems.map((i) => i.name).join(', ')}` : ''}`,
      );
    }

    const chestSummary: ChestLootSummary = {
      chestId,
      chestName: `${chestTier} Scenario Chest`,
      tier: chestTier,
      openerName: targetIds.length > 1 ? 'All Climbers' : (ctx.state.characters?.[targetIds[0]]?.name || 'Party'),
      baseGold: goldAmt,
      passiveBonusGold: 0,
      goldGained: goldAmt,
      manaStonesGained: stonesAmt,
      items: droppedItems,
      passiveTriggers: [],
    };

    arena.chests.push({
      id: chestId,
      name: `${chestTier} Scenario Chest`,
      tier: chestTier,
      x: Math.floor((arena.cols || 20) / 2),
      y: Math.max(1, Math.floor((arena.rows || 20) / 3)),
      gold: goldAmt,
      manaStones: stonesAmt,
      itemName: droppedItems[0]?.name || '',
      itemCategory: droppedItems[0]?.category || 'relic',
      opened: true,
      lastLootSummary: chestSummary,
    });

    const rewText = `${chestTier} Chest Opened: +${goldAmt}G, +${stonesAmt} Stones${droppedItems.length ? ` (${droppedItems.map((d) => d.name).join(', ')})` : ''}`;
    promptObj.triggeredRewardSummary = rewText;
    pushSystemToast(ctx, {
      title: `SCENARIO ${chestTier.toUpperCase()} CHEST GRANTED!`,
      message: rewText,
      category: 'loot',
    });
  }

  // 3. Ends in a Combat Story Beat -> Auto-generate Combat Story Beat & Resolve current Story Beat
  if (matchedBranch.endsInCombat && !promptObj.spawnedCombatBeatId) {
    const flObj = (ctx.state.map?.floors || []).find((f) => Number(f.number) === floor);
    const themeId = flObj?.theme || beat.arena?.biome || 'forest';
    const themed = generateThemedStoryBeat(floor, themeId);

    const bestiaryPool = ctx.state.bestiary || [];
    const chosenMon =
      (matchedBranch.combatMonsterPresetId
        ? bestiaryPool.find((b) => b.id === matchedBranch.combatMonsterPresetId)
        : undefined) ||
      bestiaryPool.find((b) => b.category !== 'Boss') ||
      bestiaryPool[0];

    const qty = Math.max(1, Math.min(12, Number(matchedBranch.combatMonsterQty || 2)));
    const encounters: BeatEncounterSpec[] = [];
    if (chosenMon) {
      const scaled = scaleMonsterForFloor(chosenMon, floor);
      for (let i = 0; i < qty; i++) {
        encounters.push({
          name: qty > 1 ? `${chosenMon.name} #${i + 1}` : chosenMon.name,
          floor,
          maxHp: scaled.maxHp,
          ac: scaled.ac,
          dr: scaled.dr,
          attackFormula: scaled.attackFormula,
          damageFormula: scaled.damageFormula,
          startX: Math.min(18, 8 + i * 2),
          startY: 4,
        });
      }
    }

    const combatPlayerIds = promptObj.target !== 'all' && ctx.state.characters?.[promptObj.target]
      ? [promptObj.target]
      : getActivePromptPartyIds(ctx.state);
    const combatChars: Record<string, Character> = {};
    for (const cid of combatPlayerIds) {
      const charRec = ctx.state.characters?.[cid];
      if (charRec) combatChars[cid] = charRec;
    }
    const combatArena = createDefaultBeatArena(20, 20, combatChars);
    combatArena.biome = themed.biome;
    const occ = new Set(combatArena.tokens.map((t) => `${t.x},${t.y}`));
    const genTerrain = generateArenaTerrainFromPrompt(
      `${matchedBranch.scenario} ${themed.terrainPrompt}`,
      20,
      20,
      themed.biome,
      occ,
    );
    combatArena.terrain = genTerrain.terrain;

    const chestDef = getChestDefaultsForFloor('Common', floor, ctx.state.chestCatalog);
    combatArena.chests = [
      {
        id: `chest-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
        name: chestDef.name,
        tier: 'Common',
        x: 10,
        y: 2,
        gold: chestDef.gold,
        manaStones: chestDef.manaStones,
        itemName: '',
        itemCategory: 'relic',
        opened: false,
      },
    ];

    const combatBeatId = `beat-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`;
    const combatTitle = `${floor}F • Combat: ${matchedBranch.option.slice(0, 42)}`;
    const combatBeat: StoryBeat = {
      id: combatBeatId,
      order: (ctx.state.storyBeats?.length || 0) + 1,
      floor,
      beatType: 'combat',
      title: combatTitle,
      narration: `${matchedBranch.scenario} — Hostiles emerge on ${floor}F!`,
      dmSecret: matchedBranch.dmNote || themed.dmSecret,
      presented: Boolean(beat.presented),
      status: beat.presented ? 'active' : 'upcoming',
      xpReward: Math.max(100, themed.xpReward),
      maxRounds: beat.maxRounds ?? DEFAULT_COMBAT_MAX_ROUNDS,
      aiDmEnabled: Boolean(beat.aiDmEnabled),
      arena: combatArena,
      encounters,
      treasures: [],
    };

    // Carry over any NPCs from the parent story beat into the generated combat arena
    for (const parentTok of beat.arena?.tokens || []) {
      if (parentTok.type === 'npc' && !combatArena.tokens.some((t) => t.id === parentTok.id)) {
        combatArena.tokens.push({ ...parentTok });
      }
    }

    // Spawn the attached monsters onto the new combat beat's arena map immediately
    const spawnedMonsters: Monster[] = [];
    for (let idx = 0; idx < encounters.length; idx++) {
      const enc = encounters[idx];
      const res = spawnMonsterAction({ ...ctx, role: 'dm' }, { ...enc, floor });
      const spawnedMon = res.monster as Monster | undefined;
      if (spawnedMon) {
        spawnedMonsters.push(spawnedMon);
        combatArena.tokens.push({
          id: spawnedMon.id,
          name: spawnedMon.name,
          type: 'monster',
          iconId: spawnedMon.iconId,
          x: enc.startX ? Math.max(0, Math.min(19, Number(enc.startX) - 1)) : Math.min(19, 7 + idx * 2),
          y: enc.startY ? Math.max(0, Math.min(19, Number(enc.startY) - 1)) : 3,
          color: '#ef4444',
          hp: spawnedMon.hp,
          maxHp: spawnedMon.maxHp,
          hiddenFromPlayers: false,
          label: spawnedMon.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'MN',
        });
      }
    }

    if (combatBeat.presented && spawnedMonsters.length > 0) {
      const combatPlayerIds = promptObj.target !== 'all' && ctx.state.characters?.[promptObj.target]
        ? [promptObj.target]
        : getActivePromptPartyIds(ctx.state);
      const combatants = [
        ...combatPlayerIds
          .map((cid) => ctx.state.characters?.[cid])
          .filter((c): c is Character => Boolean(c && Number(c.hp ?? 0) > 0))
          .map((c) => ({
            id: c.id,
            name: c.name,
            type: 'player' as const,
            hp: c.hp,
            maxHp: c.maxHp,
            ac: c.ac,
            initiative: 19,
            initMod: 3,
            hiddenFromPlayers: false,
          })),
        ...spawnedMonsters.map((m, idx) => ({
          id: m.id,
          name: m.name,
          type: 'monster' as const,
          hp: Number(m.hp ?? m.maxHp ?? 20),
          maxHp: Number(m.maxHp ?? 20),
          ac: m.ac,
          initiative: 14 - idx,
          initMod: 1,
          hiddenFromPlayers: false,
        })),
      ];
      combatants.sort((a, b) => {
        const diff = Number(b.initiative ?? 0) - Number(a.initiative ?? 0);
        if (diff !== 0) return diff;
        if (a.type !== b.type) return a.type === 'player' ? -1 : 1;
        return 0;
      });
      ctx.state.combat = {
        active: true,
        round: 1,
        turnIndex: 0,
        combatants,
      };
    }

    // Resolve the current story beat and transition to the newly generated Combat Story Beat
    beat.status = 'resolved';
    ctx.state.storyBeats.push(combatBeat);
    promptObj.spawnedCombatBeatId = combatBeat.id;
    promptObj.spawnedCombatBeatTitle = combatBeat.title;

    pushSystemToast(ctx, {
      title: 'COMBAT STORY BEAT GENERATED!',
      message: `"${beat.title}" resolved -> Transitioned to "${combatBeat.title}" (${encounters.length} monster(s) spawned)!`,
      category: 'combat',
    });
  }

  // 4. Optional Follow-up Question (if not ending in combat)
  if (matchedBranch.nextQuestion && !matchedBranch.endsInCombat) {
    beat.prompts = beat.prompts || [];
    const alreadySpawnedFollowUp = beat.prompts.some(
      (p) => p.question.toLowerCase() === matchedBranch.nextQuestion!.toLowerCase(),
    );
    if (!alreadySpawnedFollowUp) {
      beat.prompts.push({
        id: `prompt-${Date.now().toString(36)}-${beat.prompts.length}-${crypto.randomInt(10, 99)}`,
        question: matchedBranch.nextQuestion,
        target: promptObj.target,
        targetName: promptObj.targetName,
        ...(matchedBranch.nextOptions && matchedBranch.nextOptions.length > 0
          ? { options: matchedBranch.nextOptions }
          : {}),
        isFollowUp: true,
        askedAt: new Date().toISOString(),
        answers: [],
      });
    }
  } else if (beat.beatType === 'narration' && !matchedBranch.endsInCombat && !matchedBranch.nextQuestion) {
    beat.status = 'resolved';
    pushSystemToast(ctx, {
      title: 'STORY BEAT CONCLUDED',
      message: `"${beat.title}" has reached its conclusion!`,
      category: 'loot',
    });
  }
}

function tryEvaluatePromptBranches(ctx: ActionRequestContext, beat: StoryBeat, promptObj: StoryBeatPrompt): void {
  const branches = promptObj.branches || [];
  if (branches.length === 0) return;

  const partyIds = getActivePromptPartyIds(ctx.state);
  const totalExpected = promptObj.target === 'all' ? Math.max(1, partyIds.length) : 1;
  const answers = promptObj.answers || [];
  if (answers.length < totalExpected) return;

  // Determine winning option (majority vote for 'all', or the single answer)
  const counts = new Map<string, { raw: string; count: number }>();
  for (const ans of answers) {
    const raw = (ans.answer || '').trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const cur = counts.get(key);
    if (cur) cur.count += 1;
    else counts.set(key, { raw, count: 1 });
  }
  let winningRaw = '';
  let maxVotes = -1;
  for (const entry of counts.values()) {
    if (entry.count > maxVotes) {
      maxVotes = entry.count;
      winningRaw = entry.raw;
    }
  }
  if (!winningRaw) return;

  const matchedBranch = branches.find(
    (b) => b.option.trim().toLowerCase() === winningRaw.trim().toLowerCase(),
  );
  if (!matchedBranch) return;

  const alreadyTriggeredSame = promptObj.triggeredOption?.toLowerCase() === matchedBranch.option.toLowerCase();
  if (!alreadyTriggeredSame) {
    executePromptBranchSideEffects(ctx, beat, promptObj, matchedBranch);
  }
}

export function storyAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  const isDm = ctx.role === 'dm';
  ctx.state.storyBeats = ctx.state.storyBeats || [];
  const sub = String(payload.subAction || '');

  if (!isDm && !['move_beat_token', 'open_beat_chest', 'talk_beat_npc', 'observe_beat_cell', 'use_beat_rest_spot', 'answer_beat_prompt'].includes(sub)) {
    return { status: 403, error: 'Only the Dungeon Master can orchestrate story beats.' };
  }

  if (sub === 'add_beat') {
    const title = String(payload.title || '').trim();
    if (!title) return { status: 400, error: 'Story beat title is required.' };
    const beatType = payload.beatType === 'narration' ? 'narration' : 'combat';
    const encounters = beatType === 'narration' ? [] : Array.isArray(payload.encounters) ? (payload.encounters as BeatEncounterSpec[]) : [];
    const treasures = Array.isArray(payload.treasures) ? (payload.treasures as BeatTreasureSpec[]) : [];
    const npcs = Array.isArray(payload.npcs) ? (payload.npcs as Array<Record<string, unknown>>) : [];
    const rawPrompts = Array.isArray(payload.prompts) ? (payload.prompts as Array<Record<string, unknown>>) : [];
    const prompts: StoryBeatPrompt[] = [];
    for (const p of rawPrompts) {
      const q = String(p.question || '').trim().slice(0, 500);
      if (!q) continue;
      const target = String(p.target || 'all').trim() || 'all';
      const targetChar = target !== 'all' ? ctx.state.characters?.[target] : undefined;
      const targetName = target === 'all' ? 'All Players (Group)' : (targetChar?.name || String(p.targetName || 'Player'));
      const rawOpts = Array.isArray(p.options)
        ? p.options
        : typeof p.options === 'string'
          ? p.options.split(',')
          : [];
      const options = rawOpts
        .map((o) => String(o || '').trim().slice(0, 140))
        .filter(Boolean)
        .slice(0, 8);
      const branches = sanitizePromptBranches(p.branches);
      for (const br of branches) {
        if (!options.some((o) => o.toLowerCase() === br.option.toLowerCase())) {
          options.push(br.option);
        }
      }
      prompts.push({
        id: `prompt-${Date.now().toString(36)}-${prompts.length}-${crypto.randomInt(10, 99)}`,
        question: q,
        target,
        targetName,
        ...(options.length > 0 ? { options } : {}),
        ...(branches.length > 0 ? { branches } : {}),
        askedAt: new Date().toISOString(),
        answers: [],
      });
    }
    if (typeof payload.promptQuestion === 'string' && payload.promptQuestion.trim()) {
      const q = payload.promptQuestion.trim().slice(0, 500);
      const target = String(payload.promptTarget || 'all').trim() || 'all';
      const targetChar = target !== 'all' ? ctx.state.characters?.[target] : undefined;
      const targetName = target === 'all' ? 'All Players (Group)' : (targetChar?.name || 'Player');
      const rawOpts = Array.isArray(payload.promptOptions)
        ? payload.promptOptions
        : typeof payload.promptOptions === 'string'
          ? payload.promptOptions.split(',')
          : [];
      const options = rawOpts
        .map((o) => String(o || '').trim().slice(0, 140))
        .filter(Boolean)
        .slice(0, 8);
      const branches = sanitizePromptBranches(payload.promptBranches);
      for (const br of branches) {
        if (!options.some((o) => o.toLowerCase() === br.option.toLowerCase())) {
          options.push(br.option);
        }
      }
      prompts.push({
        id: `prompt-${Date.now().toString(36)}-${prompts.length}-${crypto.randomInt(10, 99)}`,
        question: q,
        target,
        targetName,
        ...(options.length > 0 ? { options } : {}),
        ...(branches.length > 0 ? { branches } : {}),
        askedAt: new Date().toISOString(),
        answers: [],
      });
    }
    const gridCols = Math.max(5, Math.min(100, Number(payload.gridCols || payload.gridSize || 20)));
    const gridRows = Math.max(5, Math.min(100, Number(payload.gridRows || payload.gridSize || 20)));
    const arena = createDefaultBeatArena(gridCols, gridRows, ctx.state.characters);

    if (typeof payload.biome === 'string' && VALID_FLOOR_THEME_IDS.includes(payload.biome)) {
      arena.biome = payload.biome;
    }
    if (payload.playerPositions && typeof payload.playerPositions === 'object') {
      const positions = payload.playerPositions as Record<string, { x?: number; y?: number }>;
      arena.startPositions = {};
      for (const tok of arena.tokens) {
        const pos = positions[tok.id];
        if (pos && pos.x !== undefined && pos.y !== undefined) {
          tok.x = Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(pos.x))));
          tok.y = Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(pos.y))));
        }
        arena.startPositions[tok.id] = { x: tok.x, y: tok.y };
      }
    }
    if (npcs.length > 0) {
      arena.startPositions = arena.startPositions || {};
      npcs.forEach((n, idx) => {
        const npcTok = createNpcArenaToken(n, idx, gridCols, gridRows);
        arena.tokens.push(npcTok);
        arena.startPositions![npcTok.id] = { x: npcTok.x, y: npcTok.y };
      });
    }
    if (Array.isArray(payload.chests)) {
      arena.chests = (payload.chests as Array<Record<string, unknown>>).map((c, i) => ({
        id: `chest-${Date.now().toString(36)}-${i}-${crypto.randomInt(10, 99)}`,
        name: String(c.name || `${CHEST_TIERS.includes(String(c.tier) as ChestTier) ? String(c.tier) : 'Common'} Chest`).slice(0, 50),
        tier: (CHEST_TIERS.includes(String(c.tier) as ChestTier) ? String(c.tier) : 'Common') as ChestTier,
        x: Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(c.x || 0)))),
        y: Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(c.y || 0)))),
        gold: Math.max(0, Number(c.gold || 0)),
        manaStones: Math.max(0, Number(c.manaStones || 0)),
        itemName: String(c.itemName || '').slice(0, 50),
        itemCategory: String(c.itemCategory || 'relic'),
        opened: false,
      }));
    }
    if (Array.isArray(payload.terrain) && payload.terrain.length > 0) {
      arena.terrain = (payload.terrain as Array<{ x?: number; y?: number; type?: string; w?: number; h?: number; featureId?: string; isAnchor?: boolean }>)
        .filter((t) => VALID_TERRAIN_TYPES.includes(String(t.type) as TerrainType))
        .map((t) => ({
          x: Math.max(0, Math.min(gridCols - 1, Math.trunc(Number(t.x || 0)))),
          y: Math.max(0, Math.min(gridRows - 1, Math.trunc(Number(t.y || 0)))),
          type: t.type as TerrainType,
          ...(t.w !== undefined ? { w: Math.max(1, Math.trunc(Number(t.w))) } : {}),
          ...(t.h !== undefined ? { h: Math.max(1, Math.trunc(Number(t.h))) } : {}),
          ...(t.featureId ? { featureId: String(t.featureId) } : {}),
          ...(t.isAnchor !== undefined ? { isAnchor: Boolean(t.isAnchor) } : {}),
        }));
    } else if (payload.arenaPrompt) {
      const occ = new Set([
        ...arena.tokens.map((t) => `${t.x},${t.y}`),
        ...arena.chests.map((c) => `${c.x},${c.y}`),
      ]);
      const gen = generateArenaTerrainFromPrompt(String(payload.arenaPrompt), gridCols, gridRows, arena.biome, occ);
      arena.biome = gen.biome;
      arena.terrain = gen.terrain;
    }

    const beat: StoryBeat = {
      id: `beat-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      order: ctx.state.storyBeats.length + 1,
      floor: Math.max(1, Number(payload.floor || 1)),
      beatType,
      title: title.slice(0, 80),
      narration: String(payload.narration || '').slice(0, 800),
      dmSecret: String(payload.dmSecret || '').slice(0, 500),
      presented: Boolean(payload.presentNow),
      status: payload.presentNow ? 'active' : 'upcoming',
      xpReward: Math.max(0, Number(payload.xpReward ?? 0)),
      ...(beatType === 'combat' ? { maxRounds: clampCombatMaxRounds(payload.maxRounds) } : {}),
      arena,
      encounters,
      treasures,
      prompts,
    };
    ctx.state.storyBeats.push(beat);
    for (const tok of arena.tokens) {
      if (tok.type !== 'npc') continue;
      for (const rosterNpc of ctx.state.npcRoster || []) {
        if (rosterNpc.name.toLowerCase() === tok.name.toLowerCase()) {
          rosterNpc.appearances = rosterNpc.appearances || [];
          if (!rosterNpc.appearances.some((a) => a.beatId === beat.id)) {
            rosterNpc.appearances.push({ floor: beat.floor, beatTitle: beat.title, beatId: beat.id });
          }
        }
      }
    }
    if (beat.presented) {
      pushSystemToast(ctx, {
        title: `STORY: ${beat.title}`,
        message: beat.narration || `New scene unlocked on ${beat.floor}F.`,
        category: 'info',
      });
    }
    commitState(ctx);
    return { ok: true, beat };
  }

  const beat = ctx.state.storyBeats.find((b) => b.id === payload.beatId);
  if (!beat) return { status: 404, error: 'Story beat not found.' };
  const arena = ensureBeatArena(beat, ctx.state.characters);

  if (sub === 'present_beat') {
    beat.presented = true;
    beat.status = 'active';
    pushSystemToast(ctx, {
      title: `STORY: ${beat.title}`,
      message: beat.narration || `The Dungeon Master revealed ${beat.title}.`,
      category: 'info',
    });
    recordChronicleEvent(ctx.state, {
      floor: beat.floor,
      beatId: beat.id,
      beatTitle: beat.title,
      category: 'story',
      actor: 'Dungeon Master',
      summary: `Beat revealed: "${beat.title}" (${beat.floor}F).`,
      details: beat.narration || undefined,
    });
  } else if (sub === 'hide_beat') {
    beat.presented = false;
  } else if (sub === 'set_status') {
    if (typeof payload.status === 'string' && ['upcoming', 'active', 'resolved', 'failed'].includes(payload.status)) {
      beat.status = payload.status;
      if (payload.status === 'resolved') {
        ctx.state.pendingReactions = [];
        ctx.state.lastResolvedClash = null;
      }
      if (payload.status === 'resolved' && beat.beatType !== 'narration' && !beat.victorySummary) {
        const log = beat.defeatedLog || [];
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
      }
    }
    if (payload.maxRounds !== undefined) {
      beat.maxRounds = clampCombatMaxRounds(payload.maxRounds);
    }
  } else if (sub === 'set_beat_grid') {
    const cols = Math.max(5, Math.min(100, Number(payload.cols || 20)));
    const rows = Math.max(5, Math.min(100, Number(payload.rows || cols)));
    clampArenaEntitiesToBounds(arena, cols, rows);
  } else if (sub === 'set_beat_biome') {
    if (typeof payload.biome === 'string' && VALID_FLOOR_THEME_IDS.includes(payload.biome)) {
      arena.biome = payload.biome;
    }
  } else if (sub === 'toggle_beat_terrain') {
    const tx = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x || 0))));
    const ty = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y || 0))));
    const tType = (VALID_TERRAIN_TYPES.includes(String(payload.terrainType) as TerrainType) ? String(payload.terrainType) : 'rock') as TerrainType;
    arena.terrain = arena.terrain || [];
    const existingIdx = arena.terrain.findIndex((t) => t.x === tx && t.y === ty);
    if (existingIdx >= 0 && arena.terrain[existingIdx].type === tType) {
      const fId = arena.terrain[existingIdx].featureId;
      if (fId) arena.terrain = arena.terrain.filter((t) => t.featureId !== fId);
      else arena.terrain.splice(existingIdx, 1);
    } else if (existingIdx >= 0) {
      arena.terrain[existingIdx].type = tType;
    } else {
      arena.terrain.push({ x: tx, y: ty, type: tType });
    }
  } else if (sub === 'generate_beat_terrain') {
    const occ = new Set([
      ...(arena.tokens || []).map((t) => `${t.x},${t.y}`),
      ...(arena.chests || []).map((c) => `${c.x},${c.y}`),
    ]);
    const gen = generateArenaTerrainFromPrompt(
      String(payload.prompt || beat.narration || beat.title),
      arena.cols,
      arena.rows,
      String(payload.biome || ''),
      occ,
      String(payload.seedSalt ?? `${Date.now()}-${crypto.randomInt(100, 999)}`),
    );
    arena.biome = gen.biome;
    arena.terrain = gen.terrain;
  } else if (sub === 'add_beat_chest') {
    const chestTier = (CHEST_TIERS.includes(String(payload.tier) as ChestTier) ? String(payload.tier) : 'Common') as ChestTier;
    arena.chests.push({
      id: `chest-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name: String(payload.name || `${chestTier} Chest`).slice(0, 50),
      tier: chestTier,
      x: Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x || 0)))),
      y: Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y || 0)))),
      gold: Math.max(0, payload.gold !== undefined && payload.gold !== '' ? Number(payload.gold) : 50),
      manaStones: Math.max(0, payload.manaStones !== undefined && payload.manaStones !== '' ? Number(payload.manaStones) : 1),
      itemName: String(payload.itemName || '').slice(0, 50),
      itemCategory: String(payload.itemCategory || 'relic'),
      opened: false,
    });
  } else if (sub === 'remove_beat_chest') {
    arena.chests = arena.chests.filter((c) => c.id !== payload.chestId);
  } else if (sub === 'toggle_beat_chest_open') {
    const chest = (arena.chests || []).find((c) => c.id === payload.chestId);
    if (!chest) return { status: 404, error: 'Treasure chest not found.' };
    chest.opened = payload.opened !== undefined ? Boolean(payload.opened) : !chest.opened;
  } else if (sub === 'update_beat_chest') {
    const chest = (arena.chests || []).find((c) => c.id === payload.chestId);
    if (!chest) return { status: 404, error: 'Treasure chest not found.' };
    if (payload.name !== undefined) chest.name = String(payload.name || 'Treasure Chest').trim().slice(0, 50);
    if (payload.tier !== undefined && CHEST_TIERS.includes(String(payload.tier) as ChestTier)) {
      chest.tier = String(payload.tier) as ChestTier;
    }
    if (payload.gold !== undefined) chest.gold = Math.max(0, Math.trunc(Number(payload.gold || 0)));
    if (payload.manaStones !== undefined) chest.manaStones = Math.max(0, Math.trunc(Number(payload.manaStones || 0)));
    if (payload.itemName !== undefined) chest.itemName = String(payload.itemName || '').trim().slice(0, 50);
    if (payload.itemCategory !== undefined) chest.itemCategory = String(payload.itemCategory || 'relic');
    chest.lastLootSummary = undefined;
  } else if (sub === 'add_beat_rest_spot') {
    arena.restSpots = arena.restSpots || [];
    const rx = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x || 0))));
    const ry = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y || 0))));
    const spot = {
      id: `rest-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      name: String(payload.name || BALANCE.restSpot.name).slice(0, 50),
      x: rx,
      y: ry,
      hpPct: BALANCE.restSpot.hpPct,
      mpPct: BALANCE.restSpot.mpPct,
      usedBy: [],
    };
    arena.restSpots.push(spot);
    pushSystemToast(ctx, {
      title: 'REST SPOT OPENED',
      message: `DM placed ${spot.name} at (${rx + 1}, ${ry + 1}) — Rest after combat to recover HP & MP!`,
      category: 'info',
    });
  } else if (sub === 'remove_beat_rest_spot') {
    arena.restSpots = (arena.restSpots || []).filter((r) => r.id !== payload.restSpotId);
  } else if (sub === 'use_beat_rest_spot') {
    if (isPartyInCombat(ctx.state)) {
      return { status: 400, error: 'Cannot rest while monsters are still active in combat!' };
    }
    const spot = (arena.restSpots || []).find((r) => r.id === payload.restSpotId);
    if (!spot) return { status: 404, error: 'Rest Spot not found.' };
    const cid = isDm && payload.characterId ? String(payload.characterId) : String(ctx.characterId || payload.characterId || '');
    const ch = ctx.state.characters[cid];
    if (!ch) return { status: 404, error: 'Character not found.' };
    spot.usedBy = spot.usedBy || [];
    if (spot.usedBy.includes(ch.id)) {
      return { status: 400, error: `${ch.name} has already rested at ${spot.name}.` };
    }
    const pMods = computePassiveModifiers(ch);
    const gain = restSpotRestore(ch.maxHp, ch.maxMp);
    const prevHp = ch.hp;
    const prevMp = ch.mp;
    ch.hp = Math.min(ch.maxHp, ch.hp + gain.hp + pMods.restSpotBonusHp + pMods.healingReceivedBonus);
    ch.mp = Math.min(ch.maxMp, ch.mp + gain.mp + pMods.restSpotBonusMp);
    if (pMods.restSpotTempHp > 0) ch.tempHp = Number(ch.tempHp || 0) + pMods.restSpotTempHp;
    spot.usedBy.push(ch.id);
    syncCharacterDerived(ctx, ch.id);
    logPlayerHistory(ctx.state, ch.id, 'rest', `Rested at ${spot.name}: HP ${prevHp}->${ch.hp}/${ch.maxHp}, MP ${prevMp}->${ch.mp}/${ch.maxMp}`);
    pushSystemToast(ctx, {
      title: 'REST SPOT USED',
      message: `${ch.name} rested at ${spot.name} (+${ch.hp - prevHp} HP, +${ch.mp - prevMp} MP).`,
      category: 'loot',
      target: ch.id,
    });
  } else if (sub === 'grant_rest_spot') {
    if (isPartyInCombat(ctx.state)) {
      return { status: 400, error: 'Cannot grant a Rest Spot while monsters are still active in combat!' };
    }
    const targets = Object.values(ctx.state.characters);
    for (const ch of targets) {
      const pMods = computePassiveModifiers(ch);
      const gain = restSpotRestore(ch.maxHp, ch.maxMp);
      ch.hp = Math.min(ch.maxHp, ch.hp + gain.hp + pMods.restSpotBonusHp + pMods.healingReceivedBonus);
      ch.mp = Math.min(ch.maxMp, ch.mp + gain.mp + pMods.restSpotBonusMp);
      if (pMods.restSpotTempHp > 0) ch.tempHp = Number(ch.tempHp || 0) + pMods.restSpotTempHp;
      syncCharacterDerived(ctx, ch.id);
      logPlayerHistory(ctx.state, ch.id, 'rest', `Party rested at DM Sanctuary (+${gain.hp} HP, +${gain.mp} MP cap)`);
    }
    pushSystemToast(ctx, {
      title: 'POST-COMBAT REST SPOT',
      message: 'DM opened a Sanctuary Rest Spot! All climbers recovered 50% Max HP & MP.',
      category: 'loot',
    });
  } else if (sub === 'add_beat_npc') {
    const nx = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x || 0))));
    const ny = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y || 0))));
    const npcTok = createNpcArenaToken(payload, 0, arena.cols, arena.rows);
    npcTok.x = nx;
    npcTok.y = ny;
    arena.tokens.push(npcTok);
    arena.startPositions = arena.startPositions || {};
    arena.startPositions[npcTok.id] = { x: nx, y: ny };
    for (const rosterNpc of ctx.state.npcRoster || []) {
      if (rosterNpc.name.toLowerCase() === npcTok.name.toLowerCase()) {
        rosterNpc.appearances = rosterNpc.appearances || [];
        if (!rosterNpc.appearances.some((a) => a.beatId === beat.id)) {
          rosterNpc.appearances.push({ floor: beat.floor, beatTitle: beat.title, beatId: beat.id });
        }
      }
    }
  } else if (sub === 'talk_beat_npc') {
    const tok = (arena.tokens || []).find((t) => t.id === payload.tokenId && t.type === 'npc');
    if (!tok) return { status: 404, error: 'NPC not found in this arena.' };
    const cid = isDm && payload.characterId && ctx.state.characters[String(payload.characterId)]
      ? String(payload.characterId)
      : (ctx.characterId && ctx.state.characters[ctx.characterId] ? ctx.characterId : Object.keys(ctx.state.characters)[0]);
    if (!isDm && cid) {
      const playerTok = (arena.tokens || []).find((t) => t.id === cid && t.type === 'player');
      if (
        playerTok &&
        spaceDistanceBetweenPoints(Number(playerTok.x || 0), Number(playerTok.y || 0), Number(tok.x || 0), Number(tok.y || 0)) > 1
      ) {
        return { status: 400, error: `Move within 1 Space of ${tok.name} to interact.` };
      }
    }
    const ch = cid ? ctx.state.characters[cid] : null;
    const rewardNotes: string[] = [];

    if (ch && !tok.rewardClaimed && tok.rewardType && tok.rewardType !== 'none') {
      tok.rewardClaimed = true;
      if (tok.rewardType === 'xp' && (tok.rewardXp || 0) > 0) {
        grantXpToCharacter(ctx.state, ch, Number(tok.rewardXp || 0));
        rewardNotes.push(`+${tok.rewardXp} XP`);
      } else if (tok.rewardType === 'item' && tok.rewardItemName) {
        ch.inventory = ch.inventory || [];
        ch.inventory.push(
          createInventoryItem({
            name: tok.rewardItemName,
            category: tok.rewardItemCategory || 'relic',
            notes: `Gifted by ${tok.name}`,
          }),
        );
        rewardNotes.push(`Item: ${tok.rewardItemName}`);
      } else if (tok.rewardType === 'skill_book' && tok.rewardItemName) {
        const cleanSkillName = tok.rewardItemName.replace(/^skill\s*book:\s*/i, '').trim() || tok.rewardItemName;
        ch.inventory = ch.inventory || [];
        ch.inventory.push(
          createInventoryItem({
            name: `Skill Book: ${cleanSkillName}`,
            category: 'skill_book',
            slot: 'relic',
            notes: tok.rewardSkillDesc || `Skill Book gifted by ${tok.name}`,
          }),
        );
        ch.skills = ch.skills || [];
        if (!ch.skills.some((s) => s.name.toLowerCase() === cleanSkillName.toLowerCase())) {
          ch.skills.push({
            id: `sk-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
            name: cleanSkillName,
            rank: 'E',
            mpCost: 5,
            cooldown: '1 turn',
            description: tok.rewardSkillDesc || `Learned from ${tok.name}'s Skill Book.`,
          });
        }
        rewardNotes.push(`Skill Book: ${cleanSkillName}`);
      }
      if ((tok.rewardGold || 0) > 0) {
        ch.currency = ch.currency || { gold: 0, manaStones: 0 };
        ch.currency.gold = Number(ch.currency.gold || 0) + Number(tok.rewardGold || 0);
        rewardNotes.push(`${tok.rewardGold}G`);
      }
    }

    const dialogue = tok.dialogue || `Greetings, Climber.`;
    const rewardSummary = rewardNotes.join(', ');
    pushSystemToast(ctx, {
      title: `${tok.name.toUpperCase()} (${tok.npcRole || 'NPC'})`,
      message: rewardSummary ? `"${dialogue}" — Received: ${rewardSummary}` : `"${dialogue}"`,
      category: rewardSummary ? 'loot' : 'info',
      target: ch ? ch.id : 'all',
    });
    if (ch) {
      logPlayerHistory(ctx.state, ch.id, 'npc', `Spoke with ${tok.name}${rewardSummary ? ` (Received: ${rewardSummary})` : ''}`);
      recordChronicleEvent(ctx.state, {
        floor: beat.floor,
        beatId: beat.id,
        beatTitle: beat.title,
        category: 'npc',
        actor: ch.name,
        target: tok.name,
        summary: `${ch.name} spoke with ${tok.name}${rewardSummary ? ` and received ${rewardSummary}` : ''}.`,
        details: dialogue,
      });
    }
    commitState(ctx);
    return {
      ok: true,
      beat,
      storyBeats: ctx.state.storyBeats,
      npcDialogue: {
        tokenId: tok.id,
        npcName: tok.name,
        npcRole: tok.npcRole || 'NPC',
        iconId: tok.iconId,
        dialogue,
        rewardNotes,
        rewardClaimed: Boolean(tok.rewardClaimed),
      },
    };
  } else if (sub === 'remove_beat_npc') {
    arena.tokens = arena.tokens.filter((t) => !(t.type === 'npc' && t.id === payload.tokenId));
  } else if (sub === 'open_beat_chest') {
    const chest = (arena.chests || []).find((c) => c.id === payload.chestId);
    if (!chest) return { status: 404, error: 'Treasure chest not found.' };
    const chestTier = (chest.tier && CHEST_TIERS.includes(chest.tier) ? chest.tier : 'Common') as ChestTier;

    // When the DM clicks a chest on the arena map (without forceOpen), show the Chest Reveal Modal
    // without changing the chest's opened state!
    if (isDm && !payload.forceOpen) {
      if (Object.keys(ctx.state.characters || {}).length === 0 && chest.opened) {
        chest.opened = false;
      }
      const previewRoll = rollChestLoot(chestTier, beat.floor || 1, () => crypto.randomInt(0, 1_000_000) / 1_000_000, ctx.state.chestCatalog);
      const previewSummary: ChestLootSummary = chest.lastLootSummary
        ? {
            ...chest.lastLootSummary,
            openerName: 'DM',
            items: (chest.lastLootSummary.items || []).map((it) => ({ ...it, tier: it.tier || chestTier })),
          }
        : {
            chestId: chest.id,
            chestName: chest.name,
            tier: chestTier,
            openerName: 'DM',
            baseGold: Number(chest.gold || 0) > 0 ? Number(chest.gold) : previewRoll.gold,
            passiveBonusGold: 0,
            goldGained: Number(chest.gold || 0) > 0 ? Number(chest.gold) : previewRoll.gold,
            manaStonesGained: Number(chest.manaStones || 0) > 0 ? Number(chest.manaStones) : previewRoll.manaStones,
            items: [
              ...(chest.itemName ? [{ name: chest.itemName, category: chest.itemCategory || 'relic', tier: chestTier, notes: `Found in ${chest.name}` }] : []),
              ...previewRoll.items.map((r) => ({ name: r.itemName, category: r.category, tier: r.tier || chestTier, notes: r.notes || `${chestTier} Chest (${beat.floor || 1}F)` })),
            ],
            passiveTriggers: [],
          };
      commitState(ctx);
      return { ok: true, beat, storyBeats: ctx.state.storyBeats, chestLootSummary: previewSummary };
    }

    if (chest.opened) return { status: 400, error: 'Treasure chest already opened.' };

    chest.opened = true;
    const rolled = rollChestLoot(chestTier, beat.floor || 1, () => crypto.randomInt(0, 1_000_000) / 1_000_000, ctx.state.chestCatalog);
    const baseGold = Number(chest.gold || 0) > 0 ? Number(chest.gold) : rolled.gold;
    const baseManaStones = Number(chest.manaStones || 0) > 0 ? Number(chest.manaStones) : rolled.manaStones;
    const rewardItems: ChestLootSummary['items'] = [];
    if (chest.itemName) {
      rewardItems.push({ name: chest.itemName, category: chest.itemCategory || 'relic', tier: chestTier, notes: `Found in ${chest.name}` });
    }
    for (const r of rolled.items) {
      rewardItems.push({ name: r.itemName, category: r.category, tier: r.tier || chestTier, notes: r.notes || `${chestTier} Chest (${beat.floor || 1}F)` });
    }

    const recipientIds = isDm && payload.characterId && ctx.state.characters[String(payload.characterId)]
      ? [String(payload.characterId)]
      : (ctx.characterId && ctx.state.characters[ctx.characterId] ? [ctx.characterId] : Object.keys(ctx.state.characters));

    const passiveById = new Map(PASSIVE_SKILL_POOL.map((p) => [p.id, p]));
    let finalGoldForSummary = baseGold;
    let openerName = isDm ? 'DM' : 'Party';
    const passiveTriggers: ChestPassiveTrigger[] = [];

    for (const cid of recipientIds) {
      const ch = ctx.state.characters[cid];
      if (!ch) continue;
      openerName = ch.name;
      ch.currency = ch.currency || { gold: 0, manaStones: 0 };
      const goldGain = applyGoldBonus(ch, baseGold, true);
      finalGoldForSummary = goldGain;
      ch.currency.gold = Number(ch.currency.gold || 0) + goldGain;
      ch.currency.manaStones = Number(ch.currency.manaStones || 0) + baseManaStones;
      ch.inventory = ch.inventory || [];
      for (const item of rewardItems) {
        ch.inventory.push(
          createInventoryItem({
            name: item.name,
            category: item.category,
            notes: item.notes || `Found in ${chest.name}`,
          }),
        );
      }

      for (const rawP of ch.passives || []) {
        const canonical = passiveById.get(rawP.id);
        const fx = canonical?.effects || rawP.effects;
        if (!fx) continue;
        const mult = Number(rawP.multiplierPct || 100) / 100;
        const pct = fx.bonusGoldPct ? Math.round(fx.bonusGoldPct * mult) : 0;
        const flat = fx.chestBonusGold ? Math.round(fx.chestBonusGold * mult) : 0;
        if (pct > 0 || flat > 0) {
          const added = Math.round((baseGold * pct) / 100) + flat;
          passiveTriggers.push({
            skillName: canonical?.name || rawP.name,
            tier: String(canonical?.tier || rawP.tier || 'Normal'),
            effectText: canonical?.description || rawP.description,
            bonusGold: added,
          });
        }
      }
    }
    const chestLootSummary: ChestLootSummary = {
      chestId: chest.id,
      chestName: chest.name,
      tier: chestTier,
      openerName: recipientIds.length > 1 ? 'All Climbers' : openerName,
      baseGold,
      passiveBonusGold: Math.max(0, finalGoldForSummary - baseGold),
      goldGained: finalGoldForSummary,
      manaStonesGained: baseManaStones,
      items: rewardItems,
      passiveTriggers,
    };
    chest.lastLootSummary = chestLootSummary;
    const rewards = [
      finalGoldForSummary ? `${finalGoldForSummary}G` : '',
      baseManaStones ? `${baseManaStones} Stones` : '',
      ...rewardItems.map((i) => i.name),
    ].filter(Boolean).join(', ');
    pushSystemToast(ctx, {
      title: `${chestTier.toUpperCase()} CHEST OPENED!`,
      message: `${chest.name} opened! Rewards: ${rewards || 'Empty'}`,
      category: 'loot',
    });
    for (const cid of recipientIds) {
      logPlayerHistory(ctx.state, cid, 'loot', `Opened ${chest.name} [${chestTier}]${rewards ? `: ${rewards}` : ''}`);
    }
    commitState(ctx);
    return { ok: true, beat, storyBeats: ctx.state.storyBeats, chestLootSummary };
  } else if (sub === 'toggle_beat_player') {
    const cid = String(payload.characterId || '');
    const ch = ctx.state.characters[cid];
    if (!ch) return { status: 404, error: 'Player character not found.' };
    const existingIdx = arena.tokens.findIndex((t) => t.id === cid);
    if (existingIdx >= 0) {
      arena.tokens.splice(existingIdx, 1);
    } else {
      arena.tokens.push({
        id: ch.id,
        name: ch.name.split(' ')[0],
        type: 'player',
        x: Math.floor(arena.cols / 2),
        y: Math.max(0, arena.rows - 4),
        color: '#38bdf8',
        hp: ch.hp,
        maxHp: ch.maxHp,
        hiddenFromPlayers: false,
        label: ch.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'PL',
      });
    }
  } else if (sub === 'move_beat_token') {
    const tok = arena.tokens.find((t) => t.id === payload.tokenId);
    if (!tok) return { status: 404, error: 'Arena token not found.' };
    if (!isDm && tok.type !== 'player') return { status: 403, error: 'Players cannot move monster tokens.' };
    if (!isDm && ctx.characterId && tok.id !== ctx.characterId) {
      return { status: 403, error: 'Players can only move their own token.' };
    }
    const nx = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x))));
    const ny = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y))));
    const blocked = (arena.terrain || []).find((t) => t.x === nx && t.y === ny);
    if (blocked) {
      return { status: 400, error: `Impassable terrain (${blocked.type}) blocks that space!` };
    }
    const blockerAtDest = tok.type === 'player'
      ? (arena.tokens || []).find((t) => t.id !== tok.id && (t.type === 'monster' || t.type === 'npc') && t.x === nx && t.y === ny)
      : undefined;
    if (blockerAtDest) {
      return { status: 400, error: `${blockerAtDest.name} occupies that space!` };
    }
    if (!isDm) {
      const beatHasLiveMonsters = arena.tokens.some((t) => t.type === 'monster');
      const activeComb = ctx.state.combat?.combatants?.[ctx.state.combat?.turnIndex ?? 0];
      const hasBeatCombatants = (ctx.state.combat?.combatants || []).some((c) => arena.tokens.some((t) => t.id === c.id));
      if (beatHasLiveMonsters && hasBeatCombatants && activeComb && activeComb.id !== tok.id) {
        return {
          status: 400,
          error: `It is currently ${activeComb.name}'s turn! Wait for your turn to move.`,
        };
      }
      if (tok.hasMovedThisTurn) {
        return { status: 400, error: 'You have already moved this turn! Wait until your next turn.' };
      }
      const ch = ctx.state.characters[tok.id];
      const pMods = ch ? computePassiveModifiers(ch) : null;
      const effMods = computeActiveEffectModifiers(ch?.activeEffects);
      if (effMods.stunned) {
        return { status: 400, error: `${tok.name} is Stunned and cannot move this turn!` };
      }
      const r1Bonus = ctx.state.combat.round <= 1 ? (pMods?.round1MoveBonus || 0) : 0;
      const maxSpaces = computeCharacterMoveSpaces({
        agi: ch?.stats?.AGI ?? ch?.stats?.DEX ?? 10,
        floor: beat.floor || getPartyFloor(ctx.state),
        passiveSpeedBonus: pMods?.bonusSpeedSpaces,
        round1Bonus: r1Bonus,
        effectSpeedDelta: effMods.speedDelta,
      }).total;
      if (nx === Number(tok.x || 0) && ny === Number(tok.y || 0)) {
        return { status: 400, error: 'You are already on that space.' };
      }
      const monsterBlockers = (arena.tokens || [])
        .filter((t) => t.id !== tok.id && (t.type === 'monster' || t.type === 'npc'))
        .map((t) => ({ x: t.x, y: t.y }));
      const reachable = computeReachableMoveCells({
        startX: Number(tok.x || 0),
        startY: Number(tok.y || 0),
        maxSpaces,
        cols: arena.cols,
        rows: arena.rows,
        terrain: [...(arena.terrain || []), ...monsterBlockers],
      });
      if (!reachable.distByKey.has(`${nx},${ny}`)) {
        return {
          status: 400,
          error: `Path blocked by impassable terrain or out of movement range (max ${maxSpaces} Spaces around obstacles)!`,
        };
      }
    } else if (tok.type === 'monster' && !payload.forceMove) {
      const activeComb = ctx.state.combat?.combatants?.[ctx.state.combat?.turnIndex ?? 0];
      const hasBeatCombatants = (ctx.state.combat?.combatants || []).some((c) => arena.tokens.some((t) => t.id === c.id));
      if (hasBeatCombatants && activeComb) {
        if (activeComb.type !== 'monster') {
          return {
            status: 400,
            error: `It is currently ${activeComb.name}'s turn! Wait for a monster's turn.`,
          };
        }
        if (tok.id !== activeComb.id) {
          return {
            status: 400,
            error: `It is currently ${activeComb.name}'s turn! Only ${activeComb.name} can move right now.`,
          };
        }
      }
      if (tok.hasMovedThisTurn) {
        return { status: 400, error: `${tok.name} has already moved this turn! Wait until its next turn (or use Reset Move).` };
      }
      if (nx === Number(tok.x || 0) && ny === Number(tok.y || 0)) {
        return { status: 400, error: `${tok.name} is already on that space.` };
      }
      const monObj = (ctx.state.monsters || []).find((m) => m.id === tok.id);
      const monEffMods = computeActiveEffectModifiers(monObj?.activeEffects);
      if (monEffMods.stunned) {
        return { status: 400, error: `${tok.name} is Stunned and cannot move this turn!` };
      }
      const monMaxSpaces = Math.max(1, 6 + monEffMods.speedDelta);
      const reachable = computeReachableMoveCells({
        startX: Number(tok.x || 0),
        startY: Number(tok.y || 0),
        maxSpaces: monMaxSpaces,
        cols: arena.cols,
        rows: arena.rows,
        terrain: arena.terrain,
      });
      if (!reachable.distByKey.has(`${nx},${ny}`)) {
        return {
          status: 400,
          error: `Path blocked by impassable terrain or out of movement range (${tok.name} can move up to ${monMaxSpaces} Spaces around obstacles)!`,
        };
      }
    } else if (tok.type === 'npc' && !payload.forceMove) {
      const beatHasLiveMonsters = arena.tokens.some((t) => t.type === 'monster');
      const activeComb = ctx.state.combat?.combatants?.[ctx.state.combat?.turnIndex ?? 0];
      const npcInCombat = (ctx.state.combat?.combatants || []).some((c) => c.id === tok.id);
      if (beatHasLiveMonsters && npcInCombat && activeComb && activeComb.id !== tok.id) {
        return {
          status: 400,
          error: `It is currently ${activeComb.name}'s turn! Wait until ${tok.name}'s turn.`,
        };
      }
      if (tok.hasMovedThisTurn) {
        return { status: 400, error: `${tok.name} has already moved this turn! Wait until its next turn (or use Reset Move).` };
      }
      if (nx === Number(tok.x || 0) && ny === Number(tok.y || 0)) {
        return { status: 400, error: `${tok.name} is already on that space.` };
      }
      const monObj = (ctx.state.monsters || []).find((m) => m.id === tok.id);
      const monEffMods = computeActiveEffectModifiers(monObj?.activeEffects);
      if (monEffMods.stunned) {
        return { status: 400, error: `${tok.name} is Stunned and cannot move this turn!` };
      }
      const monMaxSpaces = Math.max(1, 6 + monEffMods.speedDelta);
      const reachable = computeReachableMoveCells({
        startX: Number(tok.x || 0),
        startY: Number(tok.y || 0),
        maxSpaces: monMaxSpaces,
        cols: arena.cols,
        rows: arena.rows,
        terrain: arena.terrain,
      });
      if (!reachable.distByKey.has(`${nx},${ny}`)) {
        return {
          status: 400,
          error: `Path blocked by impassable terrain or out of movement range (${tok.name} can move up to ${monMaxSpaces} Spaces around obstacles)!`,
        };
      }
    }
    tok.x = nx;
    tok.y = ny;
    if (!isDm || ((tok.type === 'monster' || tok.type === 'npc') && !payload.forceMove)) tok.hasMovedThisTurn = true;
    if (tok.type === 'player' && Array.isArray(arena.manaStones) && arena.manaStones.length > 0) {
      const pickedIdx = arena.manaStones.findIndex((s) => s.x === nx && s.y === ny);
      if (pickedIdx !== -1) {
        const [stone] = arena.manaStones.splice(pickedIdx, 1);
        const ch = ctx.state.characters[tok.id];
        if (ch) {
          const qty = Number(stone.qty || 1);
          ch.currency = ch.currency || { gold: 0, manaStones: 0 };
          ch.currency.manaStones = Number(ch.currency.manaStones || 0) + qty;
          logPlayerHistory(ctx.state, ch.id, 'loot', `Picked up +${qty} Mana Stone from the arena`);
          pushSystemToast(ctx, {
            title: 'MANA STONE PICKED UP!',
            message: `${ch.name} collected +${qty} Mana Stone!`,
            category: 'loot',
            target: ch.id,
          });
        }
      }
    }
  } else if (sub === 'reset_token_move') {
    const tok = arena.tokens.find((t) => t.id === payload.tokenId);
    if (!tok) return { status: 404, error: 'Arena token not found.' };
    tok.hasMovedThisTurn = false;
  } else if (sub === 'observe_beat_cell') {
    const targetTokId = isDm && payload.tokenId ? String(payload.tokenId) : String(ctx.characterId || payload.tokenId || '');
    const tok = arena.tokens.find((t) => t.id === targetTokId);
    if (!tok) return { status: 404, error: 'Arena token not found.' };
    if (!isDm) {
      const beatHasLiveMonsters = arena.tokens.some((t) => t.type === 'monster');
      const activeComb = ctx.state.combat?.combatants?.[ctx.state.combat?.turnIndex ?? 0];
      const hasBeatCombatants = (ctx.state.combat?.combatants || []).some((c) => arena.tokens.some((t) => t.id === c.id));
      if (beatHasLiveMonsters && hasBeatCombatants && activeComb && activeComb.id !== tok.id) {
        return {
          status: 400,
          error: `It is currently ${activeComb.name}'s turn! Wait for your turn to observe.`,
        };
      }
    }
    if (!isDm && tok.hasObservedThisTurn) {
      return { status: 400, error: 'You have already used Observe this turn! Wait until your next turn.' };
    }
    const ox = Math.max(0, Math.min(arena.cols - 1, Math.trunc(Number(payload.x))));
    const oy = Math.max(0, Math.min(arena.rows - 1, Math.trunc(Number(payload.y))));
    const dist = Math.max(Math.abs(ox - Number(tok.x || 0)), Math.abs(oy - Number(tok.y || 0)));
    const obsChar = ctx.state.characters[tok.id];
    const obsMods = obsChar ? computePassiveModifiers(obsChar) : null;
    const maxObsRange = 3 + (obsMods?.bonusObserveRangeSpaces || 0);
    if (!isDm && dist > maxObsRange) {
      return { status: 400, error: `Out of Observe range! Max ${maxObsRange} Spaces (selected ${dist}).` };
    }
    if (!isDm) {
      const terrainSet = new Set((arena.terrain || []).map((t) => `${t.x},${t.y}`));
      if (terrainSet.has(`${ox},${oy}`)) {
        return { status: 400, error: 'Cannot observe impassable terrain.' };
      }
      const obsBlockers = new Set<string>([
        ...terrainSet,
        ...(arena.tokens || []).filter((t) => t.type === 'monster').map((t) => `${t.x},${t.y}`),
      ]);
      if (
        !hasObserveLineOfSight({
          startX: Number(tok.x || 0),
          startY: Number(tok.y || 0),
          targetX: ox,
          targetY: oy,
          blockers: obsBlockers,
        })
      ) {
        return { status: 400, error: 'Line of sight is obstructed by impassable terrain or a monster.' };
      }
    }
    if (!isDm) tok.hasObservedThisTurn = true;
    const monTok = arena.tokens.find((t) => t.x === ox && t.y === oy && t.type === 'monster');
    if (monTok) {
      const ch = obsChar;
      const mon = ctx.state.monsters.find((m) => m.id === monTok.id);
      if (ch) {
        ch.observedMonsterIds = ch.observedMonsterIds || [];
        if (!ch.observedMonsterIds.includes(monTok.id)) {
          ch.observedMonsterIds.push(monTok.id);
        }
      }
      const floor = Math.max(1, Number(beat.floor || ch?.currentFloor || ctx.state.map?.currentFloor || 1));
      const perScore = Number(ch?.stats?.PER ?? 10);
      const perMod = computeStatModifier(perScore, ctx.state.mechanics, ch) + (obsMods?.perCheckBonus || 0);
      const successChancePct = Math.max(15, Math.min(90, 35 + perMod * 8 - (floor - 1) * 3));
      const rollPct = crypto.randomInt(1, 101);
      const weakSpotFound = rollPct <= successChancePct;
      const bonusDamage = 2 + Math.floor(floor * 1.5);
      const bonusCritDamage = 4 + floor * 2;
      if (weakSpotFound && ch) {
        ch.observedWeakSpots = ch.observedWeakSpots || {};
        ch.observedWeakSpots[monTok.id] = {
          monsterId: monTok.id,
          monsterName: monTok.name,
          floor,
          bonusDamage,
          bonusCritDamage,
          discoveredAt: new Date().toISOString(),
        };
        logPlayerHistory(ctx.state, ch.id, 'combat', `Observed weak spot on ${monTok.name} (Floor ${floor}F): +${bonusDamage} dmg, +${bonusCritDamage} crit dmg`);
        pushSystemToast(ctx, {
          title: `WEAK SPOT FOUND: ${monTok.name}!`,
          message: `${ch.name} spotted a weak point (+${bonusDamage} Damage, +${bonusCritDamage} Crit Damage)!`,
          category: 'combat',
          target: ch.id,
        });
      }
      const d20Equiv = Math.max(1, Math.min(20, Math.ceil((101 - rollPct) / 5)));
      const dcEquiv = Math.max(2, Math.min(20, Math.ceil((100 - successChancePct) / 5) + 1));
      const obsEntry = {
        id: `roll-${Date.now()}-${crypto.randomInt(10, 99)}`,
        timestamp: new Date().toISOString(),
        rollerName: ch?.name || 'Climber',
        rollerRole: ctx.role,
        label: `PER Observe Check vs ${monTok.name}`,
        formula: `1d20${perMod >= 0 ? `+${perMod}` : perMod}`,
        count: 1,
        sides: 20,
        rolls: [d20Equiv],
        dropped: [],
        modifier: perMod,
        diceTotal: d20Equiv,
        total: d20Equiv + perMod,
        dc: dcEquiv + perMod,
        passed: weakSpotFound,
        rewardSummary: weakSpotFound ? `Weak Spot Found! (+${bonusDamage} Dmg, +${bonusCritDamage} Crit Dmg)` : undefined,
        breakdown: `Observe Roll (${100 - rollPct + 1}% vs ${100 - successChancePct + 1}% needed • PER ${perMod >= 0 ? `+${perMod}` : perMod})`,
        mode: 'normal',
        isCrit: d20Equiv === 20,
        isFumble: d20Equiv === 1,
        isSecret: false,
      };
      ctx.state.rollLog = ctx.state.rollLog || [];
      ctx.state.rollLog.unshift(obsEntry);
      ctx.state.rollLog = ctx.state.rollLog.slice(0, 50);
      commitState(ctx);
      return {
        ok: true,
        observedMonster: true,
        weakSpotFound,
        successChancePct,
        rollPct,
        floor,
        bonusDamage,
        bonusCritDamage,
        monster: mon ? maskMonsterForRole(mon, ctx.state, ctx.role, ctx.characterId) : null,
        beat,
        roll: obsEntry,
      };
    }
  } else if (sub === 'save_beat_starts') {
    arena.startPositions = arena.startPositions || {};
    for (const tok of arena.tokens) {
      arena.startPositions[tok.id] = { x: tok.x, y: tok.y };
    }
  } else if (sub === 'reset_beat_starts') {
    const starts = arena.startPositions || {};
    for (const tok of arena.tokens) {
      if (starts[tok.id]) {
        tok.x = Math.max(0, Math.min(arena.cols - 1, starts[tok.id].x));
        tok.y = Math.max(0, Math.min(arena.rows - 1, starts[tok.id].y));
      }
    }
  } else if (sub === 'spawn_beat_monsters') {
    if (!beat.encounters?.length) return { status: 400, error: 'No monsters attached to this story beat.' };
    // First remove any excess duplicate monster tokens if the arena had more than the attached encounters
    const allowedCounts = new Map<string, number>();
    for (const enc of beat.encounters) {
      const key = String(enc.name || '').trim().toLowerCase();
      allowedCounts.set(key, (allowedCounts.get(key) || 0) + 1);
    }
    const seenCounts = new Map<string, number>();
    const prunedMonsterIds = new Set<string>();
    arena.tokens = (arena.tokens || []).filter((tok) => {
      if (tok.type !== 'monster') return true;
      const key = String(tok.name || '').trim().toLowerCase();
      if (!allowedCounts.has(key)) return true;
      const allowed = allowedCounts.get(key) || 0;
      const seen = seenCounts.get(key) || 0;
      if (seen < allowed) {
        seenCounts.set(key, seen + 1);
        return true;
      }
      prunedMonsterIds.add(tok.id);
      return false;
    });
    if (prunedMonsterIds.size > 0) {
      ctx.state.monsters = (ctx.state.monsters || []).filter((m) => !prunedMonsterIds.has(m.id));
      if (ctx.state.combat?.combatants) {
        ctx.state.combat.combatants = ctx.state.combat.combatants.filter((c) => !prunedMonsterIds.has(c.id));
      }
    }

    // Count how many tokens of each monster name are already attached to the arena map
    const existingNameCounts = new Map<string, number>();
    for (const tok of arena.tokens || []) {
      if (tok.type === 'monster') {
        const key = String(tok.name || '').trim().toLowerCase();
        existingNameCounts.set(key, (existingNameCounts.get(key) || 0) + 1);
      }
    }

    const spawned: Monster[] = [];
    const startX = Math.max(0, Math.floor(arena.cols / 2) - Math.floor(beat.encounters.length / 2));
    for (let idx = 0; idx < beat.encounters.length; idx++) {
      const enc = beat.encounters[idx];
      const key = String(enc.name || '').trim().toLowerCase();
      const alreadyCount = existingNameCounts.get(key) || 0;
      if (alreadyCount > 0) {
        existingNameCounts.set(key, alreadyCount - 1);
        continue;
      }
      const res = spawnMonsterAction(ctx, {
        ...enc,
        floor: enc.floor || beat.floor || 2,
      });
      const spawnedMon = res.monster as Monster | undefined;
      if (spawnedMon) {
        spawned.push(spawnedMon);
        const mx = enc.startX !== undefined && enc.startX !== '' && enc.startX !== null
          ? Math.max(0, Math.min(arena.cols - 1, Number(enc.startX) - 1))
          : Math.min(arena.cols - 1, startX + idx * 2);
        const my = enc.startY !== undefined && enc.startY !== '' && enc.startY !== null
          ? Math.max(0, Math.min(arena.rows - 1, Number(enc.startY) - 1))
          : Math.min(arena.rows - 1, 3);
        arena.tokens.push({
          id: spawnedMon.id,
          name: spawnedMon.name,
          type: 'monster',
          x: mx,
          y: my,
          color: '#ef4444',
          hp: spawnedMon.hp,
          maxHp: spawnedMon.maxHp,
          hiddenFromPlayers: Boolean(spawnedMon.hiddenFromPlayers),
          label: spawnedMon.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || 'MN',
          ...(spawnedMon.iconId ? { iconId: spawnedMon.iconId } : {}),
        });
      }
    }
    if (spawned.length === 0 && prunedMonsterIds.size === 0) {
      return { status: 400, error: 'All attached monsters are already spawned on the arena map.' };
    }
    commitState(ctx);
    return { ok: true, spawned };
  } else if (sub === 'award_beat_treasure') {
    if (!beat.treasures?.length) return { status: 400, error: 'No treasures attached to this story beat.' };
    const targetIds = payload.characterId && payload.characterId !== 'all'
      ? [String(payload.characterId)]
      : Object.keys(ctx.state.characters);
    for (const cid of targetIds) {
      const ch = ctx.state.characters[cid];
      if (!ch) continue;
      ch.currency = ch.currency || { gold: 0, manaStones: 0 };
      ch.inventory = ch.inventory || [];
      for (const tr of beat.treasures) {
        ch.currency.gold = Number(ch.currency.gold || 0) + applyGoldBonus(ch, Number(tr.gold || 0), false);
        ch.currency.manaStones = Number(ch.currency.manaStones || 0) + Number(tr.manaStones || 0);
        if (tr.name) {
          ch.inventory.push(
            createInventoryItem({
              name: tr.name,
              category: tr.category || 'relic',
              qty: Math.max(1, Number(tr.qty || 1)),
              healHp: Number(tr.healHp || 0),
              healMp: Number(tr.healMp || 0),
              slot: (tr.slot || undefined) as EquipmentSlot | '' | undefined,
              attackBonus: Number(tr.attackBonus || 0),
              damageDice: String(tr.damageDice || ''),
              damageType: String(tr.damageType || 'Physical'),
              rangeSpaces: Number(tr.rangeSpaces || 2),
              drBonus: Number(tr.drBonus || 0),
              acBonus: Number(tr.acBonus || 0),
              notes: String(tr.notes || `Reward from ${beat.title}`),
            }),
          );
        }
      }
    }
    const lootSummary = beat.treasures.map((t) => `${t.name}${t.gold ? ` + ${t.gold}G` : ''}`).join(', ');
    pushSystemToast(ctx, {
      title: 'TREASURE AWARDED!',
      message: `From "${beat.title}": ${lootSummary}`,
      category: 'loot',
      target: payload.characterId && payload.characterId !== 'all' ? String(payload.characterId) : 'all',
    });
  } else if (sub === 'award_beat_xp') {
    const xpAmt = Math.max(0, Number(payload.xpReward ?? beat.xpReward ?? 0));
    if (!xpAmt) return { status: 400, error: 'This story beat has no XP reward.' };
    const targetIds = payload.characterId && payload.characterId !== 'all'
      ? [String(payload.characterId)]
      : Object.keys(ctx.state.characters);
    for (const cid of targetIds) {
      const ch = ctx.state.characters[cid];
      if (!ch) continue;
      grantXpToCharacter(ctx.state, ch, xpAmt);
    }
    pushSystemToast(ctx, {
      title: 'XP AWARDED!',
      message: `+${xpAmt} XP awarded from "${beat.title}"!`,
      category: 'loot',
      target: payload.characterId && payload.characterId !== 'all' ? String(payload.characterId) : 'all',
    });
  } else if (sub === 'update_beat') {
    if (payload.title !== undefined && String(payload.title).trim()) {
      beat.title = String(payload.title).trim().slice(0, 80);
    }
    if (payload.floor !== undefined) beat.floor = Math.max(1, Number(payload.floor || 1));
    if (payload.xpReward !== undefined) beat.xpReward = Math.max(0, Number(payload.xpReward || 0));
    if (payload.narration !== undefined) beat.narration = String(payload.narration || '').slice(0, 800);
    if (payload.dmSecret !== undefined) beat.dmSecret = String(payload.dmSecret || '').slice(0, 500);
    if (payload.presented !== undefined) {
      beat.presented = Boolean(payload.presented);
      if (beat.presented && beat.status === 'upcoming') beat.status = 'active';
    }
    if (typeof payload.status === 'string' && ['upcoming', 'active', 'resolved', 'failed'].includes(payload.status)) {
      beat.status = payload.status;
      if (payload.status === 'resolved') {
        ctx.state.pendingReactions = [];
        ctx.state.lastResolvedClash = null;
      }
      if (payload.status === 'resolved' && beat.beatType !== 'narration' && !beat.victorySummary) {
        const log = beat.defeatedLog || [];
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
      }
    }
    if (payload.maxRounds !== undefined) {
      beat.maxRounds = clampCombatMaxRounds(payload.maxRounds);
    }
    if (payload.gridSize || payload.gridCols || payload.gridRows) {
      const cols = Math.max(5, Math.min(100, Number(payload.gridCols || payload.gridSize || arena.cols)));
      const rows = Math.max(5, Math.min(100, Number(payload.gridRows || payload.gridSize || arena.rows)));
      clampArenaEntitiesToBounds(arena, cols, rows);
    }
    if (Array.isArray(payload.encounters)) beat.encounters = payload.encounters as BeatEncounterSpec[];
    if (Array.isArray(payload.treasures)) beat.treasures = payload.treasures as BeatTreasureSpec[];
    if (payload.beatType === 'narration' || payload.beatType === 'combat') {
      beat.beatType = payload.beatType;
    }
  } else if (sub === 'retry_beat_combat') {
    beat.status = 'active';
    beat.defeatSummary = null;
    resetArenaTurnFlags(ctx.state, null);
    resetCombatPassiveFlags(ctx.state);

    const beatMonIds = new Set<string>();
    for (const tok of arena.tokens) {
      if (tok.type === 'monster') {
        beatMonIds.add(tok.id);
        const mon = ctx.state.monsters.find((m) => m.id === tok.id);
        if (mon) {
          mon.hp = mon.maxHp;
          mon.activeEffects = [];
          for (const sk of mon.skills || []) {
            sk.usesRemaining = sk.maxUsesPerCombat;
          }
          tok.hp = mon.maxHp;
          tok.maxHp = mon.maxHp;
          syncMonsterDerived(ctx, mon.id);
        }
      }
      tok.hasMovedThisTurn = false;
      tok.attacksUsedThisTurn = 0;
      tok.hasObservedThisTurn = false;
      tok.hasUsedConsumableThisTurn = false;
      tok.hasCastSpellThisTurn = false;
    }

    const nextCombatants: typeof ctx.state.combat.combatants = [];
    for (const ch of Object.values(ctx.state.characters || {})) {
      const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
      const pMods = computePassiveModifiers(ch);
      const mod = computeStatModifier(agiScore, ctx.state.mechanics, ch) + pMods.bonusInitiative;
      const init = pMods.actFirstInInitiative ? 99 + mod : rollSingleDie(20) + mod;
      nextCombatants.push({
        id: ch.id,
        name: ch.name,
        type: 'player',
        hp: ch.hp,
        maxHp: ch.maxHp,
        ac: ch.ac,
        initiative: init,
        initMod: mod,
      });
    }
    for (const mId of beatMonIds) {
      const mon = ctx.state.monsters.find((m) => m.id === mId);
      if (!mon || Number(mon.hp ?? 0) <= 0) continue;
      const mod = Math.floor(((mon.agi ?? mon.ac ?? 12) - 10) / 2);
      nextCombatants.push({
        id: mon.id,
        name: mon.name,
        type: 'monster',
        hp: Number(mon.hp ?? mon.maxHp ?? 0),
        maxHp: Number(mon.maxHp ?? 0),
        ac: mon.ac,
        initiative: rollSingleDie(20) + mod,
        initMod: mod,
      });
    }
    nextCombatants.sort((a, b) => b.initiative - a.initiative);
    ctx.state.combat.combatants = nextCombatants;
    ctx.state.combat.turnIndex = 0;
    ctx.state.combat.round = 1;

    pushSystemToast(ctx, {
      title: `BATTLE RETRY: ${beat.title}`,
      message: `Round 1 / ${clampCombatMaxRounds(beat.maxRounds)} — Monsters restored, fight again!`,
      category: 'info',
    });
  } else if (sub === 'ask_beat_prompt') {
    const question = String(payload.question || '').trim().slice(0, 500);
    if (!question) return { status: 400, error: 'Prompt question is required.' };
    const target = String(payload.target || 'all').trim() || 'all';
    const targetChar = target !== 'all' ? ctx.state.characters?.[target] : undefined;
    const targetName = target === 'all' ? 'All Players (Group)' : (targetChar?.name || 'Player');
    const rawOpts = Array.isArray(payload.options)
      ? payload.options
      : typeof payload.options === 'string'
        ? payload.options.split(',')
        : [];
    const options = rawOpts
      .map((o) => String(o || '').trim().slice(0, 140))
      .filter(Boolean)
      .slice(0, 8);
    const branches = sanitizePromptBranches(payload.branches);
    for (const br of branches) {
      if (!options.some((o) => o.toLowerCase() === br.option.toLowerCase())) {
        options.push(br.option);
      }
    }
    beat.prompts = beat.prompts || [];
    const promptObj: StoryBeatPrompt = {
      id: `prompt-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      question,
      target,
      targetName,
      ...(options.length > 0 ? { options } : {}),
      ...(branches.length > 0 ? { branches } : {}),
      askedAt: new Date().toISOString(),
      answers: [],
    };
    beat.prompts.push(promptObj);
    pushSystemToast(ctx, {
      title: target === 'all' ? `DM ASKS THE PARTY (${beat.title})` : `DM ASKS ${targetName.toUpperCase()} (${beat.title})`,
      message: `"${question}"`,
      category: 'info',
      target: target === 'all' ? 'all' : target,
    });
  } else if (sub === 'remove_beat_prompt') {
    const promptId = String(payload.promptId || '');
    beat.prompts = (beat.prompts || []).filter((p) => p.id !== promptId);
  } else if (sub === 'answer_beat_prompt') {
    const promptId = String(payload.promptId || '');
    const answerText = String(payload.answer || '').trim().slice(0, 600);
    if (!answerText) return { status: 400, error: 'Please enter an answer.' };
    beat.prompts = beat.prompts || [];
    const promptObj = beat.prompts.find((p) => p.id === promptId);
    if (!promptObj) return { status: 404, error: 'Question not found.' };
    const cid = isDm && payload.characterId
      ? String(payload.characterId)
      : String(ctx.characterId || payload.characterId || Object.keys(ctx.state.characters || {})[0] || 'dm');
    const ch = ctx.state.characters?.[cid];
    if (!isDm && promptObj.target !== 'all' && promptObj.target !== cid) {
      return { status: 403, error: `This question is directed to ${promptObj.targetName}.` };
    }
    const characterName = ch ? ch.name : (isDm ? 'DM' : String(payload.characterName || 'Climber'));
    promptObj.answers = promptObj.answers || [];
    const existingIdx = promptObj.answers.findIndex((a) => a.characterId === cid);
    const answerEntry = {
      id: `ans-${Date.now().toString(36)}-${crypto.randomInt(10, 99)}`,
      characterId: cid,
      characterName,
      answer: answerText,
      answeredAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      promptObj.answers[existingIdx] = answerEntry;
    } else {
      promptObj.answers.push(answerEntry);
    }
    if (ch) {
      logPlayerHistory(ctx.state, ch.id, 'story', `Answered DM in "${beat.title}": "${answerText}"`);
    }
    recordChronicleEvent(ctx.state, {
      floor: beat.floor,
      beatId: beat.id,
      beatTitle: beat.title,
      category: 'prompt',
      actor: characterName,
      summary: `${characterName} answered "${promptObj.question}": "${answerText}".`,
    });
    pushSystemToast(ctx, {
      title: `${characterName.toUpperCase()} ANSWERED`,
      message: `Re: "${promptObj.question}" — "${answerText}"`,
      category: 'info',
    });
    tryEvaluatePromptBranches(ctx, beat, promptObj);
    if (beat.beatType === 'narration' && promptObj.isFollowUp && beat.status !== 'resolved') {
      const expectedCount =
        promptObj.target === 'all' ? Math.max(1, getActivePromptPartyIds(ctx.state).length) : 1;
      if ((promptObj.answers || []).length >= expectedCount) {
        beat.status = 'resolved';
        pushSystemToast(ctx, {
          title: 'STORY BEAT CONCLUDED',
          message: `"${beat.title}" has reached its conclusion!`,
          category: 'loot',
        });
      }
    }
  } else if (sub === 'trigger_prompt_branch') {
    const promptId = String(payload.promptId || '');
    const optionName = String(payload.option || '').trim();
    beat.prompts = beat.prompts || [];
    const promptObj = beat.prompts.find((p) => p.id === promptId);
    if (!promptObj) return { status: 404, error: 'Question not found.' };
    const matchedBranch = (promptObj.branches || []).find(
      (b) => b.option.trim().toLowerCase() === optionName.toLowerCase(),
    );
    if (!matchedBranch) return { status: 404, error: 'Conditional scenario branch not found.' };
    executePromptBranchSideEffects(ctx, beat, promptObj, matchedBranch);
  } else if (sub === 'delete_beat') {
    ctx.state.storyBeats = ctx.state.storyBeats.filter((b) => b.id !== beat.id);
  }

  commitState(ctx);
  return { ok: true, beat, storyBeats: ctx.state.storyBeats };
}
