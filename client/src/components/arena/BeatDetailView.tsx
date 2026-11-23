import React, { useState } from 'react';
import {
  CHEST_TIERS,
  DEFAULT_COMBAT_MAX_ROUNDS,
  PLAYER_ATTACK_AREAS,
  UNIT_EFFECT_KINDS,
  UNIT_EFFECT_META,
  buildChestLootPreview,
  computeActiveEffectModifiers,
  computeStatModifier,
  formatActiveUnitEffect,
  formatMonsterAttackArea,
  formatUnitEffectSpec,
  generateThemedStoryBeat,
  getChestDefaultsForFloor,
  getFloorThemeLabel,
  getMaxAttacksForFloor,
  inferDefaultAttackAreaForMonster,
  isPartyInCombat,
  normalizeSpellElement,
  scaleMonsterForFloor,
  scaleTreasureForFloor,
  type AttackArea,
  type BeatEncounterSpec,
  type BeatTreasureSpec,
  type ChestLootSummary,
  type ChestTier,
  type MapToken,
  type StoryPromptBranch,
  type UnitEffectKind,
  type UnitEffectSpec,
} from '@shared/index';
import type { BeatActionMode } from '../../canvas/drawBeatArena';
import { useVtt } from '../../context/VttContext';
import { findClosestNpcInteractCell } from '../../utils/npcInteraction';
import { StoryFlowchartView } from '../common/StoryFlowchartView';
import { TokenIconSvg } from '../common/TokenIconSvg';
import { BeatArenaCanvas, useBeatPlayerCellAction } from './BeatArenaCanvas';
import { PlayerCombatHud } from './PlayerCombatHud';

export function BeatDetailView() {
  const {
    activeBeatDetailId,
    setActiveBeatDetailId,
    setActiveBeatMapId,
    session,
    state,
    sendAction,
    pushLocalToast,
    latestStatus,
    requestAttackRoll,
    setDefeatedMonster,
    setChestReveal,
    setActivePromptModal,
    setActiveNpcDialogue,
    setPendingConsumableUse,
  } = useVtt();

  const handlePlayerBeatCell = useBeatPlayerCellAction();

  const [beatActionMode, setBeatActionMode] = useState<BeatActionMode>('move');
  const [playerHealBuffChoice, setPlayerHealBuffChoice] = useState<'none' | 'heal' | UnitEffectKind>('none');
  const [dmHealBuffChoice, setDmHealBuffChoice] = useState<'none' | 'heal' | UnitEffectKind>('none');

  const buildChoicePayload = (choice: 'none' | 'heal' | UnitEffectKind): { healFormula?: string; effectSpec?: UnitEffectSpec } => {
    if (choice === 'none') return {};
    if (choice === 'heal') return { healFormula: '2d6+2' };
    const meta = UNIT_EFFECT_META[choice];
    return {
      effectSpec: {
        kind: choice,
        potency: choice === 'stun' ? 1 : choice === 'burn' || choice === 'poison' || choice === 'regen' ? 4 : 2,
        duration: choice === 'stun' ? 1 : 2,
        target: meta.defaultTarget,
      },
    };
  };
  const [itemTrayOpen, setItemTrayOpen] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [mapHint, setMapHint] = useState('Tap a token or chest to interact.');

  // DM Edit Beat drawer state
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editFloor, setEditFloor] = useState(1);
  const [editXp, setEditXp] = useState(0);
  const [editMaxRounds, setEditMaxRounds] = useState(DEFAULT_COMBAT_MAX_ROUNDS);
  const [editGridSize, setEditGridSize] = useState('20');
  const [editStatus, setEditStatus] = useState('upcoming');
  const [editNarration, setEditNarration] = useState('');
  const [editSecret, setEditSecret] = useState('');
  const [editPresentNow, setEditPresentNow] = useState(false);
  const [editEncounters, setEditEncounters] = useState<BeatEncounterSpec[]>([]);
  const [editTreasures, setEditTreasures] = useState<BeatTreasureSpec[]>([]);

  // Staged inline add forms inside DM Beat Editor
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [monName, setMonName] = useState('');
  const [monQty, setMonQty] = useState(1);
  const [monFloor, setMonFloor] = useState(1);
  const [monAtk, setMonAtk] = useState('1d20+5');
  const [monDmg, setMonDmg] = useState('1d8+3');
  const [monHp, setMonHp] = useState(26);
  const [monAc, setMonAc] = useState(14);
  const [monDr, setMonDr] = useState(1);

  const [npcName, setNpcName] = useState('');
  const [npcRole, setNpcRole] = useState('');
  const [npcX, setNpcX] = useState(5);
  const [npcY, setNpcY] = useState(5);
  const [npcDialogue, setNpcDialogue] = useState('');
  const [npcRewardType, setNpcRewardType] = useState('none');
  const [npcRewardName, setNpcRewardName] = useState('');
  const [npcRewardXp, setNpcRewardXp] = useState(50);

  const [trName, setTrName] = useState('');
  const [trCat, setTrCat] = useState('relic');
  const [trGold, setTrGold] = useState(100);
  const [trStones, setTrStones] = useState(2);
  const [trDmg, setTrDmg] = useState('');

  const [editChestTier, setEditChestTier] = useState<ChestTier>('Common');
  const [editChestName, setEditChestName] = useState('Common Chest');
  const [editChestGold, setEditChestGold] = useState(25);
  const [editChestStones, setEditChestStones] = useState(0);
  const [editChestItem, setEditChestItem] = useState('');
  const [editChestX, setEditChestX] = useState(10);
  const [editChestY, setEditChestY] = useState(4);

  // DM toast form
  const [toastTarget, setToastTarget] = useState('all');
  const [toastCat, setToastCat] = useState('info');
  const [toastMsg, setToastMsg] = useState('');
  const [attackTargetByMonster, setAttackTargetByMonster] = useState<Record<string, string>>({});
  const [selectedMonsterSkillId, setSelectedMonsterSkillId] = useState<Record<string, string>>({});
  const [skillTrayOpenForMonster, setSkillTrayOpenForMonster] = useState<string | null>(null);
  const [playerAttackAreaOverride, setPlayerAttackAreaOverride] = useState<AttackArea | null>(null);
  const [playerAreaModOverride, setPlayerAreaModOverride] = useState<number | null>(null);
  const [playerSkillTrayOpen, setPlayerSkillTrayOpen] = useState(false);
  const [dmAreaOverrideByMonster, setDmAreaOverrideByMonster] = useState<Record<string, AttackArea>>({});
  const [dmModOverrideByMonster, setDmModOverrideByMonster] = useState<Record<string, number>>({});
  const [aimCell, setAimCell] = useState<{ x: number; y: number } | null>(null);

  // DM Question & Player Answer state
  const [askTarget, setAskTarget] = useState('all');
  const [askQuestion, setAskQuestion] = useState('');
  const [askOptionDraft, setAskOptionDraft] = useState('');
  const [askOptions, setAskOptions] = useState<string[]>([]);
  const [askBranches, setAskBranches] = useState<Record<string, { scenario: string; dmNote: string; nextQuestion: string }>>({});
  const [showFlowchart, setShowFlowchart] = useState(true);
  const [playerAnswers, setPlayerAnswers] = useState<Record<string, string>>({});
  const [pendingNpcMoveConfirm, setPendingNpcMoveConfirm] = useState<{
    npcTok: MapToken;
    targetX: number;
    targetY: number;
    steps: number;
    directDist: number;
  } | null>(null);
  const [movingToNpc, setMovingToNpc] = useState(false);

  if (!activeBeatDetailId || !state || !session) return null;
  const beat = (state.storyBeats || []).find((b) => b.id === activeBeatDetailId);
  if (!beat) return null;

  const isDm = session.role === 'dm';
  const arena = beat.arena || { cols: 20, rows: 20, biome: 'obsidian', terrain: [], tokens: [], chests: [] };
  const myArenaTok = !isDm && session.characterId ? (arena.tokens || []).find((t) => t.id === session.characterId) : null;
  const me = !isDm && session.characterId ? state.characters?.[session.characterId] : undefined;

  const floor = Math.max(1, Number(beat.floor || me?.currentFloor || 1));
  const maxAttacks = getMaxAttacksForFloor(floor);
  const usedAttacks = Number(myArenaTok?.attacksUsedThisTurn || 0);
  const attacksExhausted = usedAttacks >= maxAttacks;
  const movedDone = Boolean(myArenaTok?.hasMovedThisTurn);
  const observeDone = Boolean(myArenaTok?.hasObservedThisTurn);
  const spellCastDone = Boolean(myArenaTok?.hasCastSpellThisTurn);

  const effectiveMode: BeatActionMode = isDm
    ? beatActionMode === 'monster_move' || beatActionMode === 'monster_attack' || beatActionMode === 'monster_skill'
      ? beatActionMode
      : 'monster_move'
    : (beatActionMode === 'attack' && (attacksExhausted || spellCastDone))
      || (beatActionMode === 'spell' && (usedAttacks > 0 || spellCastDone))
      || (beatActionMode === 'observe' && observeDone)
      ? 'move'
      : beatActionMode;

  const unlockedFloors = [...(state.map?.floors || [])].sort((a, b) => a.number - b.number);

  const applyEditMonsterScale = (targetFloor: number, presetId = selectedPresetId) => {
    const f = Math.max(1, Math.min(100, Math.trunc(Number(targetFloor) || 1)));
    const preset = (state.bestiary || []).find((b) => b.id === presetId);
    const base = preset
      ? { maxHp: preset.maxHp, ac: preset.ac, dr: preset.dr, attackFormula: preset.attackFormula, damageFormula: preset.damageFormula }
      : { maxHp: 26, ac: 14, dr: 1, attackFormula: '1d20+5', damageFormula: '1d8+3' };
    const scaled = scaleMonsterForFloor(base, f);
    setMonFloor(f);
    setMonHp(scaled.maxHp);
    setMonAc(scaled.ac);
    setMonDr(scaled.dr);
    setMonAtk(scaled.attackFormula);
    setMonDmg(scaled.damageFormula);
  };

  const buildEditMonsterBatch = (): BeatEncounterSpec[] => {
    const qty = Math.max(1, Math.min(20, Math.trunc(Number(monQty) || 1)));
    const baseName = monName.trim();
    const list: BeatEncounterSpec[] = [];
    for (let i = 0; i < qty; i++) {
      list.push({
        name: qty > 1 ? `${baseName} #${i + 1}` : baseName,
        floor: Math.max(1, Math.trunc(Number(monFloor) || 1)),
        maxHp: monHp,
        ac: monAc,
        dr: monDr,
        attackFormula: monAtk.trim() || '1d20+5',
        damageFormula: monDmg.trim() || '1d8+3',
      });
    }
    return list;
  };

  const applyEditChestScale = (tier: ChestTier, targetFloor = editFloor) => {
    const def = getChestDefaultsForFloor(tier, targetFloor);
    setEditChestTier(tier);
    setEditChestName(def.name);
    setEditChestGold(def.gold);
    setEditChestStones(def.manaStones);
  };

  const openEditDrawer = () => {
    const f = beat.floor || 1;
    setEditTitle(beat.title || '');
    setEditFloor(f);
    applyEditMonsterScale(f, '');
    applyEditChestScale(editChestTier, f);
    setEditXp(beat.xpReward || 0);
    setEditMaxRounds(beat.maxRounds || DEFAULT_COMBAT_MAX_ROUNDS);
    setEditGridSize(String(beat.arena?.cols || 20));
    setEditStatus(beat.status || 'upcoming');
    setEditNarration(beat.narration || '');
    setEditSecret(beat.dmSecret || '');
    setEditPresentNow(Boolean(beat.presented));
    setEditEncounters(JSON.parse(JSON.stringify(beat.encounters || [])));
    setEditTreasures(JSON.parse(JSON.stringify(beat.treasures || [])));
    setEditOpen((v) => !v);
  };

  const handleSaveEdit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    await sendAction('story_action', {
      subAction: 'update_beat',
      beatId: beat.id,
      title: editTitle.trim(),
      floor: editFloor,
      xpReward: editXp,
      maxRounds: editMaxRounds,
      gridSize: Number(editGridSize || 20),
      status: editStatus,
      narration: editNarration.trim(),
      dmSecret: editSecret.trim(),
      presented: editPresentNow,
      encounters: editEncounters,
      treasures: editTreasures,
    });
    setEditOpen(false);
    pushLocalToast({ title: 'STORY BEAT UPDATED', message: 'Story beat changes saved!', category: 'info' });
  };

  const openNpcDialogue = (npcTok: MapToken) => {
    const hasUnclaimedReward =
      !npcTok.rewardClaimed &&
      ((Boolean(npcTok.rewardType) && npcTok.rewardType !== 'none') || Number(npcTok.rewardGold || 0) > 0);
    setActiveNpcDialogue({
      beatId: beat.id,
      tokenId: npcTok.id,
      npcName: npcTok.name,
      npcRole: npcTok.npcRole || 'NPC',
      iconId: npcTok.iconId,
      dialogue: npcTok.dialogue || 'Greetings, Climber.',
      rewardType: npcTok.rewardType,
      rewardXp: npcTok.rewardXp,
      rewardGold: npcTok.rewardGold,
      rewardItemName: npcTok.rewardItemName,
      rewardSkillDesc: npcTok.rewardSkillDesc,
      rewardClaimed: Boolean(npcTok.rewardClaimed),
    });
    if (!hasUnclaimedReward) {
      void sendAction('story_action', {
        subAction: 'talk_beat_npc',
        beatId: beat.id,
        tokenId: npcTok.id,
        characterId: session.characterId || null,
      });
    }
  };

  const handleNpcInteractRequest = (npcTok: MapToken) => {
    if (!myArenaTok || !me) return;
    const reach = findClosestNpcInteractCell({
      arena,
      myTok: myArenaTok,
      npcTok,
      me,
      combatRound: state.combat?.round ?? 1,
      beatFloor: beat.floor || 1,
    });
    if (reach.status === 'adjacent') {
      openNpcDialogue(npcTok);
      return;
    }
    if (!isMyCombatTurn) {
      pushLocalToast({
        title: 'WAIT TURN',
        message: `It is currently ${activeCombatant?.name}'s turn! Wait for your turn to move closer to ${npcTok.name}.`,
        category: 'warning',
      });
      return;
    }
    if (movedDone) {
      pushLocalToast({
        title: 'OUT OF REACH',
        message: `You must be within 1 Space of ${npcTok.name} to interact (you already moved this turn).`,
        category: 'warning',
      });
      return;
    }
    if (computeActiveEffectModifiers(me.activeEffects).stunned) {
      pushLocalToast({
        title: 'STUNNED',
        message: `${me.name} is Stunned and cannot move to ${npcTok.name}.`,
        category: 'warning',
      });
      return;
    }
    if (reach.status === 'reachable') {
      setPendingNpcMoveConfirm({
        npcTok,
        targetX: reach.x,
        targetY: reach.y,
        steps: reach.steps,
        directDist: reach.directDist,
      });
      return;
    }
    pushLocalToast({
      title: 'OUT OF REACH',
      message: `${npcTok.name} is ${reach.directDist} Spaces away — out of movement reach (max ${reach.maxSpaces} Spaces). Move within 1 Space to interact.`,
      category: 'warning',
    });
  };

  const handleConfirmMoveToNpc = async () => {
    if (!pendingNpcMoveConfirm || !session.characterId || movingToNpc) return;
    setMovingToNpc(true);
    try {
      const res = await sendAction<{ ok?: boolean }>('story_action', {
        subAction: 'move_beat_token',
        beatId: beat.id,
        tokenId: session.characterId,
        x: pendingNpcMoveConfirm.targetX,
        y: pendingNpcMoveConfirm.targetY,
      });
      if (res && res.ok !== false) {
        const npcTok = pendingNpcMoveConfirm.npcTok;
        setPendingNpcMoveConfirm(null);
        openNpcDialogue(npcTok);
      }
    } finally {
      setMovingToNpc(false);
    }
  };

  const handleArenaClick = async (x: number, y: number) => {
    const activePlayerArea: AttackArea = playerAttackAreaOverride ?? me?.equipment?.mainHand?.attackArea ?? 'single';
    const activePlayerMod = playerAreaModOverride ?? me?.equipment?.mainHand?.attackAreaModifier ?? 0;

    if (!isDm && session.characterId) {
      if (effectiveMode !== 'attack' && effectiveMode !== 'spell' && effectiveMode !== 'observe') {
        const tappedNpc = (arena.tokens || []).find((t) => t.x === x && t.y === y && t.type === 'npc');
        if (tappedNpc) {
          handleNpcInteractRequest(tappedNpc);
          return;
        }
      }
      if (!isMyCombatTurn) {
        pushLocalToast({
          title: 'WAIT TURN',
          message: `It is currently ${activeCombatant?.name}'s turn! Wait for your turn to act.`,
          category: 'warning',
        });
        return;
      }
      const playerChoiceExtra = buildChoicePayload(playerHealBuffChoice);
      const handled = await handlePlayerBeatCell({
        beat,
        x,
        y,
        mode: effectiveMode,
        attackArea: activePlayerArea,
        attackAreaModifier: activePlayerMod,
        ...playerChoiceExtra,
      });
      if (handled) return;
      if (effectiveMode === 'attack') {
        setAimCell({ x, y });
        setMapHint(`Aimed attack toward (${x + 1}, ${y + 1}). Tap a monster on the map to strike!`);
        return;
      }
    }

    const clickedRest = (arena.restSpots || []).find((r) => r.x === x && r.y === y);
    if (clickedRest && !isDm && session.characterId) {
      await sendAction('story_action', {
        subAction: 'use_beat_rest_spot',
        beatId: beat.id,
        restSpotId: clickedRest.id,
        characterId: session.characterId,
      });
      return;
    }

    const clickedChest = (arena.chests || []).find((c) => c.x === x && c.y === y && (isDm || !c.opened));
    const hitToken = (arena.tokens || []).find((t) => t.x === x && t.y === y);

    if (clickedChest && !hitToken) {
      setSelectedTokenId(null);
      if (isDm) {
        // DM clicking a chest previews the Chest Reveal Modal without marking the chest as opened!
        if (clickedChest.opened && Object.keys(state.characters || {}).length === 0) {
          void sendAction('story_action', { subAction: 'toggle_beat_chest_open', beatId: beat.id, chestId: clickedChest.id, opened: false });
        }
        setChestReveal(buildChestLootPreview(clickedChest, beat.floor || 1, null, 'DM', state.chestCatalog));
        return;
      }
      const res = await sendAction<{ chestLootSummary?: ChestLootSummary }>('story_action', {
        subAction: 'open_beat_chest',
        beatId: beat.id,
        chestId: clickedChest.id,
        characterId: session.characterId || null,
      });
      if (!res?.chestLootSummary) {
        setChestReveal(buildChestLootPreview(clickedChest, beat.floor || 1, me || null));
      }
      return;
    }

    const activeSelectedMonId = hasTurnOrder
      ? activeTurnMonsterId
      : ((selectedTokenId && arenaMonsterIds.has(selectedTokenId) ? selectedTokenId : null) || arenaMons[0]?.id || null);

    if (isDm && hasTurnOrder && isWaitingForMonsterTurn && hitToken?.type === 'monster') {
      pushLocalToast({
        title: 'WAIT TURN',
        message: `It is currently ${activeCombatant?.name}'s turn!`,
        category: 'warning',
      });
      return;
    }

    if (isDm && activeSelectedMonId && (effectiveMode === 'monster_attack' || effectiveMode === 'monster_skill')) {
      const selectedMonTok = (arena.tokens || []).find((t) => t.id === activeSelectedMonId && t.type === 'monster');
      const liveMon = selectedMonTok ? (state.monsters || []).find((m) => m.id === selectedMonTok.id) : undefined;
      if (selectedMonTok && liveMon) {
        if (hitToken?.type === 'player') {
          setAimCell({ x, y });
          if (effectiveMode === 'monster_attack') {
            const monArea = dmAreaOverrideByMonster[liveMon.id] ?? liveMon.attackArea ?? inferDefaultAttackAreaForMonster(liveMon);
            const monMod = dmModOverrideByMonster[liveMon.id] ?? liveMon.attackAreaModifier ?? 0;
            const dmChoiceExtra = buildChoicePayload(dmHealBuffChoice);
            const atkRes = await sendAction<{ targetsHit?: string[] }>('monster_attack', {
              monsterId: liveMon.id,
              targetCharacterId: hitToken.id,
              attackArea: monArea,
              attackAreaModifier: monMod,
              ...dmChoiceExtra,
            });
            if (atkRes?.targetsHit && atkRes.targetsHit.length > 1) {
              pushLocalToast({
                title: 'AREA ATTACK!',
                message: `${liveMon.name}'s ${formatMonsterAttackArea(monArea, monMod)} caught ${atkRes.targetsHit.length} climbers!`,
                category: 'combat',
              });
            }
            return;
          }
          const pickedId = selectedMonsterSkillId[liveMon.id];
          const availSkills = (liveMon.skills || []).filter(
            (s) => Number(s.usesRemaining ?? s.maxUsesPerCombat ?? 1) > 0
          );
          const skill = availSkills.find((s) => s.id === pickedId) || availSkills[0];
          if (!skill) {
            pushLocalToast({
              title: 'NO SKILL USES LEFT',
              message: `${liveMon.name} has no skill uses remaining this combat!`,
              category: 'warning',
            });
            return;
          }
          const skArea = dmAreaOverrideByMonster[liveMon.id] ?? skill.attackArea ?? liveMon.attackArea ?? inferDefaultAttackAreaForMonster(liveMon);
          const skMod = dmModOverrideByMonster[liveMon.id] ?? skill.attackAreaModifier ?? liveMon.attackAreaModifier ?? 0;
          const dmChoiceExtra = buildChoicePayload(dmHealBuffChoice);
          await sendAction('monster_attack', {
            monsterId: liveMon.id,
            targetCharacterId: hitToken.id,
            skillId: skill.id,
            attackArea: skArea,
            attackAreaModifier: skMod,
            ...dmChoiceExtra,
          });
          return;
        }
        if (hitToken?.type === 'monster' && hitToken.id !== activeSelectedMonId) {
          if (activeTurnMonsterId) {
            pushLocalToast({
              title: 'WAIT TURN',
              message: `It is currently ${activeCombatant?.name}'s turn! Only ${activeCombatant?.name} can act.`,
              category: 'warning',
            });
            return;
          }
          setSelectedTokenId(hitToken.id);
          setAimCell(null);
          setMapHint(`Selected ${hitToken.name}. Tap a direction or player to target.`);
          return;
        }
        // Clicked any direction / empty / terrain cell in Attack or Use Skills mode: aim instead of moving!
        setSelectedTokenId(activeSelectedMonId);
        setAimCell({ x, y });
        setMapHint(
          `Aimed ${effectiveMode === 'monster_skill' ? 'skill' : 'attack'} toward (${x + 1}, ${y + 1}). Tap a player or click Unleash to strike!`
        );
        return;
      }
    }

    const effectiveMoveTokenId = hasTurnOrder ? activeTurnMonsterId : selectedTokenId;
    const selectedIsMonster = Boolean(effectiveMoveTokenId && arenaMonsterIds.has(effectiveMoveTokenId));
    if (isDm && !hitToken && (!selectedIsMonster || effectiveMode === 'monster_move')) {
      if (hasTurnOrder && isWaitingForMonsterTurn && (!selectedTokenId || arenaMonsterIds.has(selectedTokenId))) {
        pushLocalToast({
          title: 'WAIT TURN',
          message: `It is currently ${activeCombatant?.name}'s turn! Only ${activeCombatant?.name} can move.`,
          category: 'warning',
        });
        return;
      }
      if (!effectiveMoveTokenId) return;
      await sendAction('story_action', {
        subAction: 'move_beat_token',
        beatId: beat.id,
        tokenId: effectiveMoveTokenId,
        x,
        y,
      });
      return;
    }

    const npcHit = hitToken && hitToken.type === 'npc' ? hitToken : undefined;
    if (npcHit && !isDm) {
      handleNpcInteractRequest(npcHit);
      return;
    }

    if (isDm) {
      if (hitToken) {
        if (activeTurnMonsterId && hitToken.type === 'monster' && hitToken.id !== activeTurnMonsterId) {
          pushLocalToast({
            title: 'WAIT TURN',
            message: `It is currently ${activeCombatant?.name}'s turn! Only ${activeCombatant?.name} can act.`,
            category: 'warning',
          });
          return;
        }
        if (
          hasTurnOrder &&
          beatHasMonsters &&
          hitToken.type === 'npc' &&
          relevantCombatants.some((c) => c.id === hitToken.id) &&
          activeCombatant?.id !== hitToken.id
        ) {
          pushLocalToast({
            title: 'WAIT TURN',
            message: `It is currently ${activeCombatant?.name}'s turn! Only ${activeCombatant?.name} can act.`,
            category: 'warning',
          });
          return;
        }
        setSelectedTokenId(hitToken.id);
        if (hitToken.type === 'monster') {
          if (
            beatActionMode !== 'monster_move' &&
            beatActionMode !== 'monster_attack' &&
            beatActionMode !== 'monster_skill'
          ) {
            setBeatActionMode('monster_move');
          }
          setMapHint(
            `Selected ${hitToken.name}. Choose Move (Red), Attack (Deeper Red), or Use Skills (Purple-Red) to act on the map.`
          );
        } else {
          setMapHint(`Selected ${hitToken.name}. Tap a destination space.`);
        }
      }
    } else if (session.characterId) {
      const myTok = (arena.tokens || []).find((t) => t.id === session.characterId);
      if (myTok && myTok.x === x && myTok.y === y) return;
      await sendAction('story_action', {
        subAction: 'move_beat_token',
        beatId: beat.id,
        tokenId: session.characterId,
        x,
        y,
      });
    }
  };

  const isLive = state.session?.status === 'active';
  const combat = state.combat || { round: 1, turnIndex: 0, combatants: [] };
  const activeCombatant = combat.combatants?.[combat.turnIndex];
  const arenaIds = new Set((arena.tokens || []).map((t) => t.id));
  const relevantCombatants = (combat.combatants || []).filter((c) => c.type === 'player' || arenaIds.has(c.id));

  const chars = Object.values(state.characters || {});
  const arenaMons = (arena.tokens || []).filter((t) => t.type === 'monster');
  const arenaMonsterIds = new Set(arenaMons.map((t) => t.id));
  const hasTurnOrder = relevantCombatants.length > 0 && Boolean(activeCombatant);
  const beatHasMonsters = arenaMons.length > 0;
  const activeTurnMonsterId = activeCombatant?.type === 'monster' && arenaMonsterIds.has(activeCombatant.id) ? activeCombatant.id : null;
  const isWaitingForMonsterTurn = hasTurnOrder && !activeTurnMonsterId;
  const isMyCombatTurn = !hasTurnOrder || !beatHasMonsters || activeCombatant?.id === session.characterId;
  const { unspawnedEncounterCount, hasDuplicateArenaMonsters } = (() => {
    const allowedCounts = new Map<string, number>();
    for (const enc of beat.encounters || []) {
      const k = String(enc.name || '').trim().toLowerCase();
      allowedCounts.set(k, (allowedCounts.get(k) || 0) + 1);
    }
    const existingCounts = new Map<string, number>();
    let hasDupes = false;
    for (const tok of arenaMons) {
      const k = String(tok.name || '').trim().toLowerCase();
      const next = (existingCounts.get(k) || 0) + 1;
      existingCounts.set(k, next);
      if (allowedCounts.has(k) && next > (allowedCounts.get(k) || 0)) {
        hasDupes = true;
      }
    }
    let remaining = 0;
    for (const enc of beat.encounters || []) {
      const k = String(enc.name || '').trim().toLowerCase();
      const count = existingCounts.get(k) || 0;
      if (count > 0) {
        existingCounts.set(k, count - 1);
      } else {
        remaining++;
      }
    }
    return { unspawnedEncounterCount: remaining, hasDuplicateArenaMonsters: hasDupes };
  })();
  const npcTokens = (arena.tokens || []).filter((t) => t.type === 'npc');
  const consumables = (me?.inventory || []).filter((i) => i.category === 'consumable');
  const pendingReactionObj = !isDm && me
    ? (state.pendingReactions || []).find((r) => r.targetCharacterId === me.id)
    : undefined;
  const pendingReact = Boolean(pendingReactionObj);
  const affordableReactSpell = me
    ? (me.spells || []).find((s) => s.actionType === 'Reaction' && Number(me.mp || 0) >= Number(s.mpCost || 0))
      || (me.spells || []).find((s) => Number(me.mp || 0) >= Number(s.mpCost || 0))
    : undefined;
  const livingMonsters = (state.monsters || []).filter((m) => m.hp === null || m.hp > 0);
  const defaultMonsterId =
    livingMonsters.find((m) => arenaMonsterIds.has(m.id))?.id || livingMonsters[0]?.id || '';

  const resolveBeatReaction = async (choice: 'counter' | 'parry' | 'spell' | 'accept') => {
    if (!pendingReactionObj) return;
    const res = await sendAction<{ summary?: string }>('resolve_reaction', {
      reactionId: pendingReactionObj.id,
      choice,
      spellId: affordableReactSpell?.id,
    });
    if (res?.summary) {
      pushLocalToast({ title: 'REACTION RESOLVED', message: res.summary, category: 'combat' });
    }
  };

  const isCombatBeat = beat.beatType !== 'narration';
  const maxRounds = beat.maxRounds || DEFAULT_COMBAT_MAX_ROUNDS;
  const currentRound = combat.round || 1;
  const isFinalRounds = isCombatBeat && currentRound >= Math.max(1, maxRounds - 2);

  const npcMoveConfirmModal = pendingNpcMoveConfirm ? (
    <div
      id="npc-move-confirm-modal"
      className="modal-backdrop open npc-dialog-backdrop"
      style={{ zIndex: 9055 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="npc-move-confirm-title"
      onClick={() => {
        if (!movingToNpc) setPendingNpcMoveConfirm(null);
      }}
    >
      <div className="modal-card npc-dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="npc-dialog-head">
          <div className="npc-dialog-avatar">
            <TokenIconSvg
              type="npc"
              name={pendingNpcMoveConfirm.npcTok.name}
              iconId={pendingNpcMoveConfirm.npcTok.iconId}
              size={46}
            />
          </div>
          <div className="npc-dialog-speaker">
            <span className="tag tag-green npc-dialog-role">
              {pendingNpcMoveConfirm.npcTok.npcRole || 'NPC'}
            </span>
            <h2 id="npc-move-confirm-title" className="npc-dialog-name">
              {pendingNpcMoveConfirm.npcTok.name}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-outline npc-dialog-x"
            aria-label="Cancel Move & Interact"
            disabled={movingToNpc}
            onClick={() => setPendingNpcMoveConfirm(null)}
          >
            &times;
          </button>
        </div>

        <div className="npc-dialog-box">
          <p className="npc-dialog-text">
            Move to ({pendingNpcMoveConfirm.targetX + 1}, {pendingNpcMoveConfirm.targetY + 1}) (
            {pendingNpcMoveConfirm.steps} Space{pendingNpcMoveConfirm.steps === 1 ? '' : 's'}) to
            interact with <strong>{pendingNpcMoveConfirm.npcTok.name}</strong>?
          </p>
        </div>

        <div className="npc-dialog-footer">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={movingToNpc}
            onClick={() => setPendingNpcMoveConfirm(null)}
          >
            No
          </button>
          <button
            type="button"
            id="btn-confirm-move-npc"
            className="btn btn-sm btn-gold"
            disabled={movingToNpc}
            onClick={() => void handleConfirmMoveToNpc()}
          >
            {movingToNpc ? 'Moving...' : 'Yes, Move & Interact'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (!isDm && isCombatBeat && session.characterId && me) {
    return (
      <>
        <PlayerCombatHud
          beat={beat}
          state={state}
          me={me}
          characterId={session.characterId}
          arena={arena}
          arenaMons={arenaMons}
          npcTokens={npcTokens}
          consumables={consumables}
          combat={combat}
          activeCombatant={activeCombatant}
          relevantCombatants={relevantCombatants}
          hasTurnOrder={hasTurnOrder}
          beatHasMonsters={beatHasMonsters}
          activeTurnMonsterId={activeTurnMonsterId}
          isMyCombatTurn={isMyCombatTurn}
          isLive={isLive}
          currentRound={currentRound}
          maxRounds={maxRounds}
          isFinalRounds={isFinalRounds}
          maxAttacks={maxAttacks}
          usedAttacks={usedAttacks}
          attacksExhausted={attacksExhausted}
          movedDone={movedDone}
          observeDone={observeDone}
          effectiveMode={effectiveMode}
          setBeatActionMode={setBeatActionMode}
          selectedTokenId={selectedTokenId}
          aimCell={aimCell}
          playerAttackAreaOverride={playerAttackAreaOverride}
          setPlayerAttackAreaOverride={setPlayerAttackAreaOverride}
          playerAreaModOverride={playerAreaModOverride}
          setPlayerAreaModOverride={setPlayerAreaModOverride}
          playerHealBuffChoice={playerHealBuffChoice}
          setPlayerHealBuffChoice={setPlayerHealBuffChoice}
          buildChoicePayload={buildChoicePayload}
          defaultMonsterId={defaultMonsterId}
          pendingReactionObj={pendingReactionObj}
          pendingReact={pendingReact}
          affordableReactSpell={affordableReactSpell}
          resolveBeatReaction={resolveBeatReaction}
          mapHint={mapHint}
          setMapHint={setMapHint}
          latestStatus={latestStatus}
          onCellClick={handleArenaClick}
          onInteractNpc={handleNpcInteractRequest}
          onClose={() => setActiveBeatDetailId(null)}
        />
        {npcMoveConfirmModal}
      </>
    );
  }

  return (
    <section id="beat-detail-view" className="view active app-shell">
      <header className="topbar">
        <div className="topbar-left" style={{ gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            id="btn-close-beat-detail"
            className="btn btn-sm btn-outline"
            onClick={() => setActiveBeatDetailId(null)}
          >
            &larr; Back
          </button>
          <h3 id="beat-detail-title" style={{ margin: 0 }}>{beat.title}</h3>
          <span id="beat-detail-floor" className="tag tag-gold">{beat.floor}F</span>
          <span id="beat-detail-status" className={`tag ${beat.status === 'failed' ? 'tag-crimson' : beat.presented ? 'tag-cyan' : 'tag-gold'}`}>
            {beat.status === 'failed' ? 'FAILED' : beat.presented ? 'PRESENTED' : String(beat.status || 'upcoming').toUpperCase()}
          </span>
          {isCombatBeat && (
            <span id="beat-detail-round-hud" className={`tag ${isFinalRounds ? 'tag-crimson' : 'tag-gold'}`}>
              ROUND {currentRound} / {maxRounds}
            </span>
          )}
          {beat.aiDmEnabled && (
            <span id="beat-detail-ai-dm-badge" className="tag tag-purple">
              AI DM ACTIVE
            </span>
          )}
          {Boolean(beat.xpReward) && (
            <span id="beat-detail-xp" className="tag tag-purple">+{beat.xpReward} XP</span>
          )}
        </div>
        <div className="topbar-right" style={{ gap: '8px' }}>
          {isDm && (
            <>
              <button
                type="button"
                id="btn-beat-detail-rest-spot"
                className="btn btn-sm btn-outline"
                disabled={isPartyInCombat(state)}
                title={isPartyInCombat(state) ? 'Available after combat (no active monsters)' : 'Grant a Sanctuary Rest Spot (+50% HP & MP to all climbers)'}
                onClick={() => sendAction('story_action', { subAction: 'grant_rest_spot', beatId: beat.id })}
              >
                Rest Spot (50% HP/MP)
              </button>
              <button type="button" id="btn-beat-detail-edit" className="btn btn-sm btn-gold" onClick={openEditDrawer}>
                Edit Beat
              </button>
              {beat.beatType !== 'narration' && (
                <button
                  type="button"
                  id="btn-beat-detail-open-map"
                  className="btn btn-sm btn-cyan"
                  onClick={() => setActiveBeatMapId(beat.id)}
                >
                  Open Map Editor
                </button>
              )}
            </>
          )}
        </div>
      </header>

      <main className="app-content">
        {!isDm && !isLive && (
          <div className="alert-banner warning mb-xs" style={{ margin: '0 0 10px' }}>
            <div>
              <strong>SESSION PAUSED</strong>{' '}
              <span>{state.session?.pausedMessage || 'Waiting for DM...'}</span>
            </div>
          </div>
        )}

        {!isDm && pendingReactionObj && (
          <div id="beat-reaction-banner" className="reaction-banner" style={{ margin: '0 0 12px' }}>
            <div className="reaction-info">
              <span className="tag tag-crimson">REACTION</span>
              <strong>
                {pendingReactionObj.monsterName} strikes you ({pendingReactionObj.attackTotal} to hit, {pendingReactionObj.incomingDamage} incoming dmg)! React immediately!
              </strong>
            </div>
            <div className="reaction-actions">
              <button type="button" className="btn btn-sm btn-crimson" onClick={() => resolveBeatReaction('counter')}>Counter</button>
              <button type="button" className="btn btn-sm btn-cyan" onClick={() => resolveBeatReaction('parry')}>Parry</button>
              <button
                type="button"
                className="btn btn-sm btn-purple"
                disabled={!affordableReactSpell}
                onClick={() => resolveBeatReaction('spell')}
              >
                Spell
              </button>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => resolveBeatReaction('accept')}>Take Hit</button>
            </div>
          </div>
        )}

        {beat.status === 'failed' && (
          <div id="beat-detail-defeat-banner" className="panel card-glow-crimson" style={{ margin: '0 0 12px', padding: '12px 14px' }}>
            <div className="panel-header" style={{ marginBottom: '6px' }}>
              <h4 style={{ margin: 0, color: '#fca5a5' }}>
                BATTLE LOST — ROUND LIMIT EXCEEDED ({beat.defeatSummary?.maxRounds || maxRounds} Rounds)
              </h4>
              {isDm && (
                <button
                  type="button"
                  id="btn-retry-beat-combat"
                  className="btn btn-sm btn-gold"
                  onClick={() => sendAction('story_action', { subAction: 'retry_beat_combat', beatId: beat.id })}
                >
                  Retry Battle (Reset to Round 1)
                </button>
              )}
            </div>
            {beat.defeatSummary?.penalties?.length ? (
              <div className="btn-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                {beat.defeatSummary.penalties.map((p) => (
                  <span key={p.characterId} className="tag tag-crimson">
                    {p.characterName}: -{p.hpLost} HP • -{p.mpLost} MP • -{p.goldLost}G • -{p.xpLost} XP
                  </span>
                ))}
              </div>
            ) : (
              <div className="small muted">The party failed to defeat the monsters within the round limit.</div>
            )}
          </div>
        )}

        {beat.narration && <div id="beat-detail-narration" className="story-narration">{beat.narration}</div>}
        {isDm && beat.dmSecret && (
          <div id="beat-detail-secret" className="story-secret mt-xs">
            <strong>DM Secret:</strong> {beat.dmSecret}
          </div>
        )}

        {(isDm || (beat.prompts || []).length > 0 || beat.beatType === 'narration') && (
          <div id="beat-detail-prompts-panel" className="panel card-glow-gold mt-sm">
            <div className="panel-header">
              <div className="btn-row" style={{ alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>DM Narration &amp; Player Questions</h3>
                <span className={`tag ${beat.beatType === 'narration' ? 'tag-purple' : 'tag-cyan'}`}>
                  {beat.beatType === 'narration' ? 'NARRATION BEAT (NO COMBAT)' : 'INTERACTIVE Q&A'}
                </span>
              </div>
              <div className="btn-row" style={{ alignItems: 'center' }}>
                {isDm && (beat.prompts || []).length > 0 && (
                  <button
                    type="button"
                    className={`btn btn-xs ${showFlowchart ? 'btn-gold' : 'btn-outline'}`}
                    onClick={() => setShowFlowchart((v) => !v)}
                  >
                    {showFlowchart ? 'Hide Flowchart' : 'Show Conversation Flowchart'}
                  </button>
                )}
                <span className="muted small">
                  {(beat.prompts || []).length} Question{(beat.prompts || []).length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            {isDm && showFlowchart && (beat.prompts || []).length > 0 && (
              <div className="mt-xs mb-xs">
                <StoryFlowchartView
                  title={beat.title}
                  floor={beat.floor}
                  narration={beat.narration}
                  prompts={beat.prompts!}
                  isDm={true}
                  onOpenBeat={(targetId) => setActiveBeatDetailId(targetId)}
                  onTriggerBranch={(promptId, option) =>
                    sendAction('story_action', {
                      subAction: 'trigger_prompt_branch',
                      beatId: beat.id,
                      promptId,
                      option,
                    })
                  }
                />
              </div>
            )}

            {isDm && (
              <form
                className="stack-form mt-xs"
                style={{ marginBottom: (beat.prompts || []).length > 0 ? '12px' : 0 }}
                onSubmit={async (ev) => {
                  ev.preventDefault();
                  if (!askQuestion.trim()) {
                    pushLocalToast({ title: 'QUESTION NEEDED', message: 'Enter a question for the player(s).', category: 'warning' });
                    return;
                  }
                  const pendingOpts = [...askOptions];
                  if (askOptionDraft.trim()) pendingOpts.push(askOptionDraft.trim());
                  const branches: StoryPromptBranch[] = [];
                  for (const opt of pendingOpts) {
                    const cfg = askBranches[opt];
                    if (cfg && cfg.scenario.trim()) {
                      branches.push({
                        option: opt,
                        scenario: cfg.scenario.trim(),
                        ...(cfg.dmNote.trim() ? { dmNote: cfg.dmNote.trim() } : {}),
                        ...(cfg.nextQuestion.trim() ? { nextQuestion: cfg.nextQuestion.trim() } : {}),
                      });
                    }
                  }
                  const res = await sendAction<{ beat?: { id: string; prompts?: Array<{ id: string }> } }>('story_action', {
                    subAction: 'ask_beat_prompt',
                    beatId: beat.id,
                    question: askQuestion.trim(),
                    target: askTarget,
                    options: pendingOpts,
                    branches,
                  });
                  setAskQuestion('');
                  setAskOptionDraft('');
                  setAskOptions([]);
                  setAskBranches({});
                  const latestPrompt = res?.beat?.prompts?.[res.beat.prompts.length - 1];
                  if (latestPrompt) {
                    setActivePromptModal({ beatId: beat.id, promptId: latestPrompt.id });
                  }
                }}
              >
                <div className="btn-row" style={{ gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <label style={{ minWidth: '210px' }}>
                    <span>Who to Ask</span>
                    <select value={askTarget} onChange={(e) => setAskTarget(e.target.value)}>
                      <option value="all">Ask the Group (All Players)</option>
                      {chars.map((c) => (
                        <option key={c.id} value={c.id}>
                          Ask {c.name} (Lv {c.level})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ flex: 1, minWidth: '240px' }}>
                    <span>Ask a Question / Decision Prompt</span>
                    <input
                      type="text"
                      placeholder="e.g. What does your character say to the Guardian, or which path do you take?"
                      value={askQuestion}
                      onChange={(e) => setAskQuestion(e.target.value)}
                    />
                  </label>
                  <button type="submit" className="btn btn-sm btn-gold">
                    Ask &amp; Open Poll Modal
                  </button>
                </div>

                <div className="btn-row" style={{ gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <label style={{ flex: 1, minWidth: '220px' }}>
                    <span>Answer Options for Poll / Choice (Optional)</span>
                    <div className="btn-row" style={{ gap: '6px' }}>
                      <input
                        type="text"
                        style={{ flex: 1 }}
                        placeholder="e.g. Step through the crimson gate"
                        value={askOptionDraft}
                        onChange={(e) => setAskOptionDraft(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        onClick={() => {
                          const clean = askOptionDraft.trim();
                          if (!clean) return;
                          setAskOptions((prev) => [...prev, clean]);
                          setAskOptionDraft('');
                        }}
                      >
                        + Add Option
                      </button>
                    </div>
                  </label>
                </div>

                {askOptions.length > 0 && (
                  <div className="stack-form mt-xs">
                    <div className="btn-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                      {askOptions.map((opt, oIdx) => (
                        <span key={`${opt}-${oIdx}`} className="tag tag-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          Option {oIdx + 1}: {opt}
                          <button
                            type="button"
                            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                            onClick={() => setAskOptions((prev) => prev.filter((_, i) => i !== oIdx))}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>

                    <div className="list-stack">
                      {askOptions.map((opt, oIdx) => {
                        const br = askBranches[opt] || { scenario: '', dmNote: '', nextQuestion: '' };
                        return (
                          <div key={`ask-br-${opt}-${oIdx}`} className="item-card" style={{ borderColor: 'rgba(168, 85, 247, 0.45)', padding: '8px 10px' }}>
                            <div className="small" style={{ color: '#fbbf24', fontWeight: 700, marginBottom: '4px' }}>
                              IF Answer = Option {oIdx + 1}: &ldquo;{opt}&rdquo; &rarr; THEN Scenario:
                            </div>
                            <input
                              type="text"
                              placeholder={`What happens if they choose "${opt}"?`}
                              value={br.scenario}
                              onChange={(e) =>
                                setAskBranches((prev) => ({
                                  ...prev,
                                  [opt]: { ...br, scenario: e.target.value },
                                }))
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </form>
            )}

            {(beat.prompts || []).length > 0 ? (
              <div className="list-stack mt-xs">
                {(beat.prompts || []).map((pr) => {
                  const canPlayerAnswer = !isDm && Boolean(session.characterId) && (pr.target === 'all' || pr.target === session.characterId);
                  const myExistingAnswer = !isDm && session.characterId
                    ? (pr.answers || []).find((a) => a.characterId === session.characterId)
                    : undefined;
                  const draftAnswer = playerAnswers[pr.id] !== undefined
                    ? playerAnswers[pr.id]
                    : (myExistingAnswer?.answer || '');
                  const totalGroup = pr.target === 'all' ? Math.max(1, chars.length) : 1;
                  const allDone =
                    pr.target === 'all'
                      ? chars.length > 0
                        ? (pr.answers || []).length >= chars.length
                        : (pr.answers || []).length > 0
                      : (pr.answers || []).length >= 1;

                  return (
                    <div key={pr.id} className="item-card" style={{ borderColor: 'rgba(168, 85, 247, 0.45)' }}>
                      <div className="item-card-top">
                        <strong>
                          <span className={`tag ${pr.target === 'all' ? 'tag-cyan' : 'tag-gold'}`}>
                            {pr.target === 'all' ? 'Asked to Group' : `Asked to ${pr.targetName}`}
                          </span>{' '}
                          &ldquo;{pr.question}&rdquo;
                        </strong>
                        <div className="btn-row">
                          <button
                            type="button"
                            className="btn btn-xs btn-gold"
                            onClick={() => setActivePromptModal({ beatId: beat.id, promptId: pr.id })}
                          >
                            {isDm
                              ? pr.target === 'all'
                                ? `Open Poll Modal (${(pr.answers || []).length}/${totalGroup})`
                                : 'Open Prompt Modal'
                              : myExistingAnswer
                                ? allDone
                                  ? 'View Poll Results'
                                  : 'View Waiting Status'
                                : 'Answer in Modal'}
                          </button>
                          {isDm && (
                            <button
                              type="button"
                              className="btn btn-xs btn-danger-outline"
                              onClick={() =>
                                sendAction('story_action', {
                                  subAction: 'remove_beat_prompt',
                                  beatId: beat.id,
                                  promptId: pr.id,
                                })
                              }
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

                      {(pr.options || []).length > 0 && (
                        <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '6px' }}>
                          {pr.options!.map((opt, oIdx) => (
                            <span key={`${opt}-${oIdx}`} className="tag tag-gold">
                              Option {oIdx + 1}: {opt}
                            </span>
                          ))}
                        </div>
                      )}

                      {pr.triggeredScenario && (
                        <div
                          className="small mt-xs"
                          style={{
                            padding: '8px 10px',
                            borderRadius: '6px',
                            background: 'rgba(6, 78, 59, 0.4)',
                            border: '1px solid #10b981',
                            color: '#ecfdf5',
                          }}
                        >
                          <div>
                            <span className="tag tag-green">SCENARIO: IF &ldquo;{pr.triggeredOption}&rdquo;</span>{' '}
                            {pr.triggeredScenario}
                          </div>
                          {(pr.triggeredStatCheckResults || []).map((r) => (
                            <div key={`${r.characterId}-${r.statKey}`} className="small mt-xs" style={{ color: r.passed ? '#6ee7b7' : '#fca5a5' }}>
                              • <b>{r.characterName}</b> {r.statKey} Check: d20({r.roll}) + Mod(
                              {r.statMod >= 0 ? `+${r.statMod}` : r.statMod}) + Floor(+{r.floorBonus}) = <b>{r.total}</b> vs DC {r.dc}{' '}
                              [{r.passed ? `PASSED: ${r.rewardSummary}` : 'FAILED'}]
                            </div>
                          ))}
                          {pr.triggeredRewardSummary && (
                            <div className="small mt-xs" style={{ color: '#fbbf24' }}>
                              • <b>Reward:</b> {pr.triggeredRewardSummary}
                            </div>
                          )}
                          {pr.spawnedCombatBeatId && (
                            <div className="mt-xs">
                              <button
                                type="button"
                                className="btn btn-xs btn-crimson"
                                onClick={() => setActiveBeatDetailId(pr.spawnedCombatBeatId!)}
                              >
                                Current Beat Resolved &rarr; Go to Generated Combat Beat ({pr.spawnedCombatBeatTitle || 'Combat'})
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {!isDm && myExistingAnswer && !allDone ? (
                        <div className="small mt-xs" style={{ color: '#fbbf24' }}>
                          Waiting on other players to make an answer ({(pr.answers || []).length}/{totalGroup} answered)...
                        </div>
                      ) : (pr.answers || []).length > 0 ? (
                        <div className="list-stack mt-xs">
                          {pr.answers.map((ans) => (
                            <div
                              key={ans.id}
                              className="small"
                              style={{
                                background: 'rgba(15, 23, 42, 0.65)',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                borderLeft: '3px solid #38bdf8',
                              }}
                            >
                              <b style={{ color: '#38bdf8' }}>{ans.characterName}:</b> &ldquo;{ans.answer}&rdquo;
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="muted small mt-xs">
                          Waiting for answer from {pr.target === 'all' ? 'the group' : pr.targetName}...
                        </div>
                      )}

                      {canPlayerAnswer && (
                        <div className="btn-row mt-xs" style={{ gap: '8px' }}>
                          <input
                            type="text"
                            style={{ flex: 1 }}
                            placeholder="Type your character's answer or action..."
                            value={draftAnswer}
                            onChange={(e) => setPlayerAnswers((prev) => ({ ...prev, [pr.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="btn btn-xs btn-gold"
                            onClick={async () => {
                              const text = (draftAnswer || '').trim();
                              if (!text) {
                                pushLocalToast({ title: 'ANSWER NEEDED', message: 'Type your response first.', category: 'warning' });
                                return;
                              }
                              const res = await sendAction('story_action', {
                                subAction: 'answer_beat_prompt',
                                beatId: beat.id,
                                promptId: pr.id,
                                characterId: session.characterId,
                                answer: text,
                              });
                              if (res) {
                                pushLocalToast({
                                  title: 'ANSWER SUBMITTED',
                                  message: 'Your response was sent to the DM and party!',
                                  category: 'info',
                                });
                              }
                            }}
                          >
                            {myExistingAnswer ? 'Update Answer' : 'Submit Answer'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="muted small mt-xs">
                {isDm
                  ? 'Ask a question above to prompt a specific player or the entire group.'
                  : 'Listening to the Dungeon Master’s narration...'}
              </div>
            )}
          </div>
        )}

        {isDm && editOpen && (
          <div id="beat-detail-edit-panel" className="panel mt-sm">
            <div className="panel-header">
              <h3>Edit Story Beat</h3>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-xs btn-cyan"
                  onClick={async () => {
                    const flObj = unlockedFloors.find((f) => Number(f.number) === Number(editFloor));
                    const themeId = flObj?.theme || arena.biome || 'forest';
                    const gen = generateThemedStoryBeat(editFloor, themeId);
                    setEditTitle(gen.title);
                    setEditNarration(gen.narration);
                    setEditSecret(gen.dmSecret);
                    setEditXp(gen.xpReward);
                    await sendAction('story_action', {
                      subAction: 'generate_beat_terrain',
                      beatId: beat.id,
                      prompt: gen.terrainPrompt,
                      biome: gen.biome,
                    });
                    pushLocalToast({
                      title: 'BEAT AUTO-GENERATED',
                      message: `Updated fields & arena terrain for ${editFloor}F (${getFloorThemeLabel(themeId)}).`,
                      category: 'info',
                    });
                  }}
                >
                  Auto-Generate Beat ({editFloor}F Theme)
                </button>
                <button type="button" id="btn-cancel-beat-edit" className="btn btn-xs btn-outline" onClick={() => setEditOpen(false)}>
                  Close Editor
                </button>
              </div>
            </div>
            <form id="beat-edit-form" className="stack-form" onSubmit={handleSaveEdit}>
              <div className="grid-2">
                <label><span>Beat Title</span><input type="text" required value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></label>
                <label>
                  <span>Unlocked Tower Floor</span>
                  <select
                    value={editFloor}
                    onChange={(e) => {
                      const nf = Number(e.target.value || 1);
                      setEditFloor(nf);
                      applyEditMonsterScale(nf);
                      applyEditChestScale(editChestTier, nf);
                    }}
                  >
                    {unlockedFloors.length > 0 ? (
                      unlockedFloors.map((fl) => (
                        <option key={fl.number} value={fl.number}>
                          {fl.number}F • {getFloorThemeLabel(fl.theme)}
                        </option>
                      ))
                    ) : (
                      <option value={editFloor}>{editFloor}F</option>
                    )}
                  </select>
                </label>
              </div>
              <div className="grid-4">
                <label><span>XP Reward</span><input type="number" min={0} value={editXp} onChange={(e) => setEditXp(Number(e.target.value || 0))} /></label>
                {beat.beatType !== 'narration' && (
                  <label><span>Max Combat Rounds</span><input type="number" min={1} max={100} value={editMaxRounds} onChange={(e) => setEditMaxRounds(Number(e.target.value || DEFAULT_COMBAT_MAX_ROUNDS))} /></label>
                )}
                <label>
                  <span>Arena Grid Size</span>
                  <select value={editGridSize} onChange={(e) => setEditGridSize(e.target.value)}>
                    <option value="20">20 × 20 Spaces</option>
                    <option value="25">25 × 25 Spaces</option>
                    <option value="30">30 × 30 Spaces</option>
                    <option value="40">40 × 40 Spaces</option>
                    <option value="50">50 × 50 Spaces</option>
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                    <option value="upcoming">Upcoming</option>
                    <option value="active">Active</option>
                    <option value="resolved">Resolved</option>
                    <option value="failed">Failed</option>
                  </select>
                </label>
              </div>
              <label><span>Player Narration</span><textarea rows={2} value={editNarration} onChange={(e) => setEditNarration(e.target.value)} /></label>
              <label><span>DM Secret Note</span><input type="text" value={editSecret} onChange={(e) => setEditSecret(e.target.value)} /></label>
              <label className="checkbox-row">
                <input type="checkbox" checked={editPresentNow} onChange={(e) => setEditPresentNow(e.target.checked)} />
                <span>Presented to Players</span>
              </label>

              <details className="sub-details">
                <summary>+ Edit Attached Monster Encounters</summary>
                <div className="stack-form mt-sm">
                  <div className="list-stack">
                    {editEncounters.map((m, i) => (
                      <div key={`${m.name}-${i}`} className="item-card">
                        <div className="item-card-top">
                          <strong>{m.name} {m.floor ? <span className="tag tag-crimson">{m.floor}F</span> : null}</strong>
                          <span>HP {m.maxHp} • AC {m.ac} • DR {m.dr} • {m.damageFormula}</span>
                          <button
                            type="button"
                            className="btn btn-xs btn-danger-outline"
                            onClick={() => setEditEncounters((prev) => prev.filter((_, idx) => idx !== i))}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="btn-row" style={{ alignItems: 'flex-end', gap: '8px' }}>
                    <label style={{ flex: 1 }}>
                      <span>Bestiary Preset (Manhwa &amp; D&amp;D)</span>
                      <select
                        value={selectedPresetId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setSelectedPresetId(id);
                          const b = (state.bestiary || []).find((x) => x.id === id);
                          if (b) {
                            setMonName(b.name);
                            applyEditMonsterScale(monFloor, id);
                          }
                        }}
                      >
                        <option value="">-- Custom Monster --</option>
                        {(state.bestiary || []).map((b) => (
                          <option key={b.id} value={b.id}>
                            [{b.category || 'Custom'}] {b.name} (1F: {b.maxHp} HP / AC {b.ac})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn btn-sm btn-cyan"
                      onClick={() => {
                        const pool = (state.bestiary || []).filter((b) => b.category !== 'Boss');
                        const src = pool.length > 0 ? pool : (state.bestiary || []);
                        if (src.length === 0) return;
                        const picked = src[Math.floor(Math.random() * src.length)];
                        const f = Math.max(1, Math.trunc(Number(monFloor) || editFloor || 1));
                        const scaled = scaleMonsterForFloor(picked, f);
                        const qty = Math.max(1, Math.min(20, Math.trunc(Number(monQty) || 1)));
                        const batch: BeatEncounterSpec[] = [];
                        for (let i = 0; i < qty; i++) {
                          batch.push({
                            name: qty > 1 ? `${picked.name} #${i + 1}` : picked.name,
                            floor: f,
                            maxHp: scaled.maxHp,
                            ac: scaled.ac,
                            dr: scaled.dr,
                            attackFormula: scaled.attackFormula,
                            damageFormula: scaled.damageFormula,
                          });
                        }
                        setEditEncounters((prev) => [...prev, ...batch]);
                      }}
                    >
                      Auto-Generate Monster(s)
                    </button>
                  </div>
                  <div className="grid-3">
                    <label><span>Monster Name</span><input type="text" placeholder="e.g. Goblin Gatekeeper" value={monName} onChange={(e) => setMonName(e.target.value)} /></label>
                    <label><span>Quantity</span><input type="number" min={1} max={20} value={monQty} onChange={(e) => setMonQty(Math.max(1, Math.min(20, Number(e.target.value || 1))))} /></label>
                    <label><span>Floor Level (Scales Stats)</span><input type="number" min={1} max={100} value={monFloor} onChange={(e) => applyEditMonsterScale(Number(e.target.value || 1))} /></label>
                  </div>
                  <div className="grid-2">
                    <label><span>Attack Formula</span><input type="text" value={monAtk} onChange={(e) => setMonAtk(e.target.value)} /></label>
                    <label><span>Damage Dice</span><input type="text" value={monDmg} onChange={(e) => setMonDmg(e.target.value)} /></label>
                  </div>
                  <div className="grid-3">
                    <label><span>Max HP</span><input type="number" min={1} value={monHp} onChange={(e) => setMonHp(Number(e.target.value || 1))} /></label>
                    <label><span>AC</span><input type="number" value={monAc} onChange={(e) => setMonAc(Number(e.target.value || 10))} /></label>
                    <label><span>DR</span><input type="number" value={monDr} onChange={(e) => setMonDr(Number(e.target.value || 0))} /></label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-crimson"
                    onClick={() => {
                      if (!monName.trim()) {
                        pushLocalToast({ title: 'MONSTER NAME NEEDED', message: 'Enter a monster name.', category: 'warning' });
                        return;
                      }
                      setEditEncounters((prev) => [...prev, ...buildEditMonsterBatch()]);
                      setMonName('');
                      setMonQty(1);
                    }}
                  >
                    + Add Monster Encounter
                  </button>
                </div>
              </details>

              <details className="sub-details">
                <summary>+ Add / Manage NPCs</summary>
                <div className="stack-form mt-sm">
                  <div className="list-stack">
                    {npcTokens.map((n) => (
                      <div key={n.id} className="item-card">
                        <div className="item-card-top">
                          <strong>{n.name} <span className="tag tag-green">{n.npcRole || 'NPC'}</span></strong>
                          <button
                            type="button"
                            className="btn btn-xs btn-danger-outline"
                            onClick={() => sendAction('story_action', { subAction: 'remove_beat_npc', beatId: beat.id, tokenId: n.id })}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="btn-row" style={{ alignItems: 'flex-end', gap: '8px' }}>
                    <label style={{ flex: 1 }}>
                      <span>NPC Roster Preset (Manhwa &amp; D&amp;D)</span>
                      <select
                        value=""
                        onChange={(e) => {
                          const found = (state.npcRoster || []).find((n) => n.id === e.target.value);
                          if (found) {
                            setNpcName(found.name);
                            setNpcRole(found.role);
                            setNpcDialogue(found.dialogue);
                          }
                        }}
                      >
                        <option value="">-- Select from NPC Roster --</option>
                        {(state.npcRoster || []).map((n) => (
                          <option key={n.id} value={n.id}>
                            [{n.origin || 'Custom'} • {n.firstAppearedFloor}F • Lv {n.level}] {n.name} ({n.role})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn btn-sm btn-cyan"
                      onClick={async () => {
                        const roster = state.npcRoster || [];
                        if (roster.length === 0) return;
                        const pick = roster[Math.floor(Math.random() * roster.length)];
                        await sendAction('story_action', {
                          subAction: 'add_beat_npc',
                          beatId: beat.id,
                          name: pick.name,
                          npcRole: pick.role,
                          x: Math.max(0, npcX - 1),
                          y: Math.max(0, npcY - 1),
                          dialogue: pick.dialogue,
                          rewardType: 'none',
                          rewardItemName: '',
                          rewardXp: 0,
                        });
                      }}
                    >
                      Auto-Attach NPC
                    </button>
                  </div>
                  <div className="grid-2">
                    <label><span>NPC Name</span><input type="text" placeholder="e.g. Tower Merchant" value={npcName} onChange={(e) => setNpcName(e.target.value)} /></label>
                    <label><span>Role / Title</span><input type="text" placeholder="e.g. Merchant, Ally" value={npcRole} onChange={(e) => setNpcRole(e.target.value)} /></label>
                  </div>
                  <div className="grid-2">
                    <label><span>Grid X (Col, 1-100)</span><input type="number" min={1} max={100} value={npcX} onChange={(e) => setNpcX(Number(e.target.value || 1))} /></label>
                    <label><span>Grid Y (Row, 1-100)</span><input type="number" min={1} max={100} value={npcY} onChange={(e) => setNpcY(Number(e.target.value || 1))} /></label>
                  </div>
                  <label><span>Dialogue</span><input type="text" placeholder="Greetings, Climber..." value={npcDialogue} onChange={(e) => setNpcDialogue(e.target.value)} /></label>
                  <div className="grid-3">
                    <label>
                      <span>Talk Reward</span>
                      <select value={npcRewardType} onChange={(e) => setNpcRewardType(e.target.value)}>
                        <option value="none">Dialogue Only</option>
                        <option value="item">Give Item</option>
                        <option value="skill_book">Give Skill Book</option>
                        <option value="xp">Grant XP</option>
                      </select>
                    </label>
                    <label><span>Item / Skill Book Name</span><input type="text" placeholder="e.g. Shadow Step" value={npcRewardName} onChange={(e) => setNpcRewardName(e.target.value)} /></label>
                    <label><span>XP Amount</span><input type="number" min={0} value={npcRewardXp} onChange={(e) => setNpcRewardXp(Number(e.target.value || 0))} /></label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    style={{ borderColor: 'rgba(16,185,129,0.7)', color: '#34d399' }}
                    onClick={async () => {
                      if (!npcName.trim()) {
                        pushLocalToast({ title: 'NPC NAME NEEDED', message: 'Enter an NPC name.', category: 'warning' });
                        return;
                      }
                      await sendAction('story_action', {
                        subAction: 'add_beat_npc',
                        beatId: beat.id,
                        name: npcName.trim(),
                        npcRole: npcRole.trim() || 'NPC',
                        x: Math.max(0, npcX - 1),
                        y: Math.max(0, npcY - 1),
                        dialogue: npcDialogue.trim(),
                        rewardType: npcRewardType,
                        rewardItemName: npcRewardName.trim(),
                        rewardXp: npcRewardXp,
                      });
                      setNpcName('');
                      setNpcRole('');
                      setNpcDialogue('');
                      setNpcRewardName('');
                    }}
                  >
                    + Add NPC to Beat Arena
                  </button>
                </div>
              </details>

              <details className="sub-details">
                <summary>+ Edit Attached Treasures / Loot</summary>
                <div className="stack-form mt-sm">
                  <div className="list-stack">
                    {editTreasures.map((t, i) => (
                      <div key={`${t.name}-${i}`} className="item-card">
                        <div className="item-card-top">
                          <strong>{t.name} <span className="tag tag-cyan">{t.category || 'relic'}</span></strong>
                          <span>{t.gold ? `${t.gold}G ` : ''}{t.manaStones ? `${t.manaStones} Stones` : ''}</span>
                          <button
                            type="button"
                            className="btn btn-xs btn-danger-outline"
                            onClick={() => setEditTreasures((prev) => prev.filter((_, idx) => idx !== i))}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="btn-row" style={{ alignItems: 'flex-end', gap: '8px' }}>
                    <label style={{ flex: 1 }}>
                      <span>Treasure Catalog Preset ({editFloor}F Scaled)</span>
                      <select
                        value=""
                        onChange={(e) => {
                          const found = (state.treasureCatalog || []).find((t) => t.id === e.target.value);
                          if (found) {
                            const sc = scaleTreasureForFloor(found, editFloor);
                            setTrName(sc.name);
                            setTrCat(sc.category);
                            setTrGold(sc.scaledGold);
                            setTrStones(sc.scaledManaStones);
                            setTrDmg(sc.damageDice || '');
                          }
                        }}
                      >
                        <option value="">-- Select Equipment or Skill Book --</option>
                        {(state.treasureCatalog || []).map((t) => (
                          <option key={t.id} value={t.id}>
                            [{t.origin || 'Custom'} • {t.category === 'skill_book' ? 'Skill Book' : t.category} • {t.floorLevel}F] {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn btn-sm btn-gold"
                      onClick={() => {
                        const cat = state.treasureCatalog || [];
                        if (cat.length === 0) return;
                        const pick = cat[Math.floor(Math.random() * cat.length)];
                        const sc = scaleTreasureForFloor(pick, editFloor);
                        setEditTreasures((prev) => [
                          ...prev,
                          {
                            id: `tr-${Date.now().toString(36)}`,
                            name: sc.name,
                            category: sc.category,
                            qty: 1,
                            gold: sc.scaledGold,
                            manaStones: sc.scaledManaStones,
                            slot: sc.slot || undefined,
                            attackBonus: sc.attackBonus,
                            damageDice: sc.damageDice || '',
                            acBonus: sc.acBonus,
                            drBonus: sc.drBonus,
                            notes: sc.notes,
                          },
                        ]);
                      }}
                    >
                      Auto-Attach Treasure
                    </button>
                  </div>
                  <div className="grid-2">
                    <label><span>Item Name</span><input type="text" placeholder="e.g. Gate Key Blade" value={trName} onChange={(e) => setTrName(e.target.value)} /></label>
                    <label>
                      <span>Category</span>
                      <select value={trCat} onChange={(e) => setTrCat(e.target.value)}>
                        <option value="relic">Relic</option>
                        <option value="weapon">Weapon</option>
                        <option value="armor">Armor</option>
                        <option value="skill_book">Skill Book</option>
                        <option value="consumable">Consumable</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid-3">
                    <label><span>Gold</span><input type="number" min={0} value={trGold} onChange={(e) => setTrGold(Number(e.target.value || 0))} /></label>
                    <label><span>Mana Stones</span><input type="number" min={0} value={trStones} onChange={(e) => setTrStones(Number(e.target.value || 0))} /></label>
                    <label><span>Weapon Dice</span><input type="text" placeholder="e.g. 2d6" value={trDmg} onChange={(e) => setTrDmg(e.target.value)} /></label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-cyan"
                    onClick={() => {
                      if (!trName.trim() && trGold <= 0 && trStones <= 0) {
                        pushLocalToast({ title: 'TREASURE NEEDED', message: 'Enter an item name, Gold, or Mana Stones.', category: 'warning' });
                        return;
                      }
                      setEditTreasures((prev) => [
                        ...prev,
                        {
                          id: `tr-${Date.now().toString(36)}`,
                          name: trName.trim() || 'Tower Gold Cache',
                          category: trCat,
                          qty: 1,
                          gold: trGold,
                          manaStones: trStones,
                          damageDice: trDmg.trim(),
                        },
                      ]);
                      setTrName('');
                      setTrDmg('');
                    }}
                  >
                    + Add Treasure
                  </button>
                </div>
              </details>

              <details className="sub-details">
                <summary>+ Add / Manage Treasure Chests</summary>
                <div className="stack-form mt-sm">
                  <div className="btn-row" style={{ alignItems: 'flex-end', gap: '8px' }}>
                    <label style={{ flex: 1 }}>
                      <span>Chest Tier (Scales Gold &amp; Mana Stones to {editFloor}F)</span>
                      <select
                        value={editChestTier}
                        onChange={(e) => applyEditChestScale(e.target.value as ChestTier, editFloor)}
                      >
                        {CHEST_TIERS.map((ct) => {
                          const def = getChestDefaultsForFloor(ct, editFloor);
                          return (
                            <option key={ct} value={ct}>
                              {ct} Chest ({editFloor}F: {def.gold}G • {def.manaStones} Stones)
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn btn-sm btn-gold"
                      onClick={async () => {
                        const def = getChestDefaultsForFloor(editChestTier, editFloor);
                        const cols = Number(arena.cols || 20);
                        const rows = Number(arena.rows || 20);
                        const cx = Math.max(1, Math.min(cols - 2, Math.floor(Math.random() * (cols - 4)) + 2));
                        const cy = Math.max(1, Math.min(rows - 5, Math.floor(Math.random() * (rows - 6)) + 2));
                        await sendAction('story_action', {
                          subAction: 'add_beat_chest',
                          beatId: beat.id,
                          name: def.name,
                          tier: editChestTier,
                          gold: def.gold,
                          manaStones: def.manaStones,
                          itemName: '',
                          x: cx,
                          y: cy,
                        });
                      }}
                    >
                      Auto-Generate Chest
                    </button>
                  </div>

                  <div className="list-stack">
                    {(arena.chests || []).map((c) => (
                      <div key={c.id} className="item-card">
                        <div className="item-card-top">
                          <strong>
                            {c.name}{' '}
                            <span className="tag tag-gold">{c.tier || 'Common'}</span>{' '}
                            {c.opened && <span className="tag tag-crimson">OPENED</span>}
                          </strong>
                          <span>
                            ({c.x + 1}, {c.y + 1}) • {c.gold}G • {c.manaStones || 0} Stones
                          </span>
                          <div className="btn-row">
                            <button
                              type="button"
                              className="btn btn-xs btn-outline"
                              onClick={() => sendAction('story_action', { subAction: 'toggle_beat_chest_open', beatId: beat.id, chestId: c.id })}
                            >
                              {c.opened ? 'Reset Closed' : 'Mark Opened'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs btn-danger-outline"
                              onClick={() => sendAction('story_action', { subAction: 'remove_beat_chest', beatId: beat.id, chestId: c.id })}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid-2">
                    <label><span>Chest Name</span><input type="text" value={editChestName} onChange={(e) => setEditChestName(e.target.value)} /></label>
                    <label><span>Bonus Item Name (opt.)</span><input type="text" placeholder="Auto-rolls from Tier table" value={editChestItem} onChange={(e) => setEditChestItem(e.target.value)} /></label>
                  </div>
                  <div className="grid-4">
                    <label><span>Gold ({editFloor}F)</span><input type="number" min={0} value={editChestGold} onChange={(e) => setEditChestGold(Math.max(0, Number(e.target.value || 0)))} /></label>
                    <label><span>Mana Stones</span><input type="number" min={0} value={editChestStones} onChange={(e) => setEditChestStones(Math.max(0, Number(e.target.value || 0)))} /></label>
                    <label><span>Col X</span><input type="number" min={1} max={100} value={editChestX} onChange={(e) => setEditChestX(Math.max(1, Number(e.target.value || 1)))} /></label>
                    <label><span>Row Y</span><input type="number" min={1} max={100} value={editChestY} onChange={(e) => setEditChestY(Math.max(1, Number(e.target.value || 1)))} /></label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-gold"
                    onClick={async () => {
                      await sendAction('story_action', {
                        subAction: 'add_beat_chest',
                        beatId: beat.id,
                        name: editChestName.trim() || `${editChestTier} Chest`,
                        tier: editChestTier,
                        gold: editChestGold,
                        manaStones: editChestStones,
                        itemName: editChestItem.trim(),
                        x: Math.max(0, editChestX - 1),
                        y: Math.max(0, editChestY - 1),
                      });
                      setEditChestItem('');
                    }}
                  >
                    + Add Chest to Beat Arena
                  </button>
                </div>
              </details>

              <div className="btn-row">
                <button type="submit" className="btn btn-gold btn-lg">Save Story Beat Changes</button>
              </div>
            </form>
          </div>
        )}

        <div className="beat-detail-grid mt-sm">
          {beat.beatType !== 'narration' && (
          <div className="panel beat-detail-map-col">
            <div className="panel-header">
              <h3>Real-Time Arena Map</h3>
              <span id="beat-detail-map-hint" className="muted small">{mapHint}</span>
            </div>

            {!isDm && session.characterId && (
              <div id="beat-detail-action-bar" className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '6px', marginBottom: '8px', alignItems: 'center' }}>
                {!isMyCombatTurn && (
                  <span className="tag tag-outline">
                    Waiting for Turn ({activeCombatant?.name}&apos;s turn)
                  </span>
                )}
                <button
                  type="button"
                  className={`btn btn-xs btn-crimson ${effectiveMode === 'attack' ? 'active' : ''}`}
                  disabled={!isMyCombatTurn || attacksExhausted || spellCastDone}
                  onClick={() => {
                    setBeatActionMode('attack');
                    setItemTrayOpen(false);
                    setPlayerSkillTrayOpen(false);
                    setMapHint('Attack mode: Tap a monster on the map to strike with your weapon.');
                  }}
                >
                  {attacksExhausted
                    ? 'Attacked (Wait Turn)'
                    : maxAttacks > 1
                      ? `Attack (${maxAttacks - usedAttacks}/${maxAttacks})`
                      : 'Attack'}
                </button>
                <button
                  type="button"
                  className={`btn btn-xs btn-cyan ${effectiveMode === 'move' ? 'active' : ''}`}
                  disabled={!isMyCombatTurn || movedDone}
                  onClick={() => {
                    setBeatActionMode('move');
                    setItemTrayOpen(false);
                    setPlayerSkillTrayOpen(false);
                    setMapHint('Move mode: Tap any space on the map to move your character.');
                  }}
                >
                  {movedDone ? 'Moved (Wait Turn)' : 'Move'}
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-purple"
                  disabled={!isMyCombatTurn}
                  onClick={() => {
                    setPlayerSkillTrayOpen((o) => !o);
                    setItemTrayOpen(false);
                  }}
                >
                  Skills ({(me?.skills || []).length})
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-gold"
                  onClick={() => {
                    setItemTrayOpen((o) => !o);
                    setPlayerSkillTrayOpen(false);
                  }}
                >
                  Use Item
                </button>
                <button
                  type="button"
                  className={`btn btn-xs btn-outline ${effectiveMode === 'observe' ? 'active' : ''}`}
                  disabled={!isMyCombatTurn || observeDone}
                  onClick={() => {
                    setBeatActionMode('observe');
                    setItemTrayOpen(false);
                    setPlayerSkillTrayOpen(false);
                    setMapHint('Observe mode: Tap a token, monster, NPC, or chest on the map to inspect it.');
                  }}
                >
                  {observeDone ? 'Observed (Wait Turn)' : 'Observe'}
                </button>
                <select
                  aria-label="Player Attack Area"
                  value={playerAttackAreaOverride ?? me?.equipment?.mainHand?.attackArea ?? 'single'}
                  onChange={(e) => {
                    setPlayerAttackAreaOverride(e.target.value as AttackArea);
                    setBeatActionMode('attack');
                  }}
                  style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                >
                  {PLAYER_ATTACK_AREAS.map((a) => (
                    <option key={a} value={a}>
                      Area: {formatMonsterAttackArea(a)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Player Attack Area Size Modifier"
                  value={playerAreaModOverride ?? me?.equipment?.mainHand?.attackAreaModifier ?? 0}
                  onChange={(e) => {
                    setPlayerAreaModOverride(Number(e.target.value));
                    setBeatActionMode('attack');
                  }}
                  style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                >
                  {[-2, -1, 0, 1, 2, 3, 4].map((m) => (
                    <option key={m} value={m}>
                      Mod: {m > 0 ? `+${m}` : m} Sp
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Player Heal or Effect"
                  value={playerHealBuffChoice}
                  onChange={(e) => setPlayerHealBuffChoice(e.target.value as 'none' | 'heal' | UnitEffectKind)}
                  style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                >
                  <option value="none">Effect: None</option>
                  <option value="heal">Heal HP (2d6+2)</option>
                  {UNIT_EFFECT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {UNIT_EFFECT_META[k].category === 'buff' ? 'Buff' : 'Debuff'}: {UNIT_EFFECT_META[k].label}
                    </option>
                  ))}
                </select>
                {playerHealBuffChoice !== 'none' && (playerHealBuffChoice === 'heal' || UNIT_EFFECT_META[playerHealBuffChoice].category === 'buff') && (
                  <button
                    type="button"
                    className="btn btn-xs btn-gold"
                    disabled={!isMyCombatTurn}
                    onClick={async () => {
                      if (!me) return;
                      await sendAction('unit_effect_action', {
                        subAction: 'apply',
                        targetType: 'player',
                        targetId: me.id,
                        ...buildChoicePayload(playerHealBuffChoice),
                        sourceName: 'Quick Action',
                      });
                    }}
                  >
                    Apply Heal/Buff
                  </button>
                )}
                <button
                  type="button"
                  id="btn-beat-end-turn"
                  className="btn btn-xs btn-outline"
                  disabled={!isMyCombatTurn}
                  style={{ marginLeft: 'auto' }}
                  onClick={async () => {
                    await sendAction('initiative_action', { subAction: 'end_turn', characterId: session.characterId });
                    pushLocalToast({ title: 'TURN ENDED', message: 'Passed turn to the next combatant.', category: 'info' });
                  }}
                >
                  End Turn
                </button>
              </div>
            )}

            {!isDm && playerSkillTrayOpen && me && (
              <div id="beat-detail-player-skill-tray" className="list-stack" style={{ marginBottom: '8px' }}>
                {(me.skills || []).length > 0 ? (
                  (me.skills || []).map((sk, idx) => {
                    const skArea: AttackArea = sk.attackArea || playerAttackAreaOverride || me.equipment?.mainHand?.attackArea || 'single';
                    const skMod = sk.attackAreaModifier ?? playerAreaModOverride ?? me.equipment?.mainHand?.attackAreaModifier ?? 0;
                    return (
                      <div key={sk.id || `${sk.name}-${idx}`} className="item-card">
                        <div className="item-card-top">
                          <strong>
                            {sk.name}{' '}
                            <span className="tag tag-purple">{formatMonsterAttackArea(skArea, skMod)}</span>
                          </strong>
                          <button
                            type="button"
                            className="btn btn-xs btn-crimson"
                            disabled={attacksExhausted || arenaMons.length === 0}
                            onClick={async () => {
                              const targetMonTok = arenaMons[0];
                              if (!targetMonTok) return;
                              setPlayerAttackAreaOverride(skArea);
                              setPlayerAreaModOverride(skMod);
                              const choiceExtra = buildChoicePayload(playerHealBuffChoice);
                              await requestAttackRoll({
                                monTok: targetMonTok,
                                me,
                                wep: me.equipment?.mainHand || null,
                                beatId: beat.id,
                                attackArea: skArea,
                                attackAreaModifier: skMod,
                                skillName: sk.name,
                                isSkill: true,
                                ...(choiceExtra.healFormula ? { healFormula: choiceExtra.healFormula } : {}),
                                ...(choiceExtra.effectSpec ? { effectSpec: choiceExtra.effectSpec } : {}),
                              });
                            }}
                          >
                            Use on {arenaMons[0]?.name || 'Monster'}
                          </button>
                        </div>
                        {sk.description && <div className="small muted">{sk.description}</div>}
                      </div>
                    );
                  })
                ) : (
                  <div className="item-card small muted">No combat skills learned yet.</div>
                )}
              </div>
            )}

            {!isDm && itemTrayOpen && (
              <div id="beat-detail-item-tray" className="list-stack" style={{ marginBottom: '8px' }}>
                {consumables.length > 0 ? (
                  consumables.map((it) => {
                    const myTok = (arena.tokens || []).find((t) => t.id === session.characterId);
                    const usedConsumableThisTurn = Boolean(myTok?.hasUsedConsumableThisTurn && beatHasMonsters);
                    return (
                      <div key={it.id} className="item-card">
                        <div className="item-card-top">
                          <strong>{it.name} <span className="tag tag-cyan">×{it.qty || 1}</span></strong>
                          <button
                            type="button"
                            className="btn btn-xs btn-cyan"
                            disabled={!isMyCombatTurn || usedConsumableThisTurn}
                            onClick={() => {
                              if (!session.characterId) return;
                              setPendingConsumableUse({ characterId: session.characterId, item: it });
                            }}
                          >
                            {usedConsumableThisTurn ? 'Used (Wait Turn)' : 'Use'}
                          </button>
                        </div>
                        {it.notes && <div className="small muted">{it.notes}</div>}
                      </div>
                    );
                  })
                ) : (
                  <div className="item-card small muted">No consumable items in your bag.</div>
                )}
              </div>
            )}

            {isDm && arenaMons.length > 0 && (() => {
              const activeMonId =
                activeTurnMonsterId ||
                (selectedTokenId && arenaMonsterIds.has(selectedTokenId) ? selectedTokenId : null) ||
                arenaMons[0]?.id;
              const activeMonTok = arenaMons.find((m) => m.id === activeMonId) || arenaMons[0];
              const activeLiveMon = activeMonTok ? (state.monsters || []).find((m) => m.id === activeMonTok.id) : undefined;
              const isShowingThisMon = Boolean(
                activeTurnMonsterId ? activeTurnMonsterId === activeMonTok?.id : (selectedTokenId && selectedTokenId === activeMonTok?.id),
              );
              const monMovedDone = Boolean(activeMonTok?.hasMovedThisTurn);
              const monSkills = activeLiveMon?.skills || [];
              const pickedSkillId =
                (activeMonTok && selectedMonsterSkillId[activeMonTok.id]) ||
                monSkills.find((s) => Number(s.usesRemaining ?? s.maxUsesPerCombat ?? 1) > 0)?.id ||
                monSkills[0]?.id ||
                '';

              return (
                <div
                  id="beat-detail-dm-monster-action-bar"
                  className="item-card mt-xs"
                  style={{
                    marginBottom: '8px',
                    borderColor:
                      effectiveMode === 'monster_skill'
                        ? 'rgba(244, 63, 94, 0.7)'
                        : effectiveMode === 'monster_attack'
                          ? 'rgba(220, 38, 38, 0.85)'
                          : 'rgba(248, 113, 113, 0.5)',
                    background:
                      effectiveMode === 'monster_skill'
                        ? 'linear-gradient(135deg, rgba(88, 28, 135, 0.3), rgba(159, 18, 57, 0.25))'
                        : effectiveMode === 'monster_attack'
                          ? 'rgba(127, 29, 29, 0.32)'
                          : 'rgba(69, 10, 10, 0.22)',
                  }}
                >
                  <div className="btn-row" style={{ flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    <span className="small" style={{ fontWeight: 700, color: '#fca5a5' }}>
                      Monster Actions:
                    </span>
                    {isWaitingForMonsterTurn ? (
                      <span className="tag tag-outline">
                        Waiting for Monster Turn{activeCombatant ? ` (${activeCombatant.name}'s turn)` : ''}
                      </span>
                    ) : activeMonTok ? (
                      <>
                        <strong className="small" style={{ color: '#fde68a' }}>
                          {activeMonTok.name} ({activeMonTok.hp ?? 0}/{activeMonTok.maxHp ?? 0} HP)
                        </strong>
                        {activeTurnMonsterId && <span className="tag tag-gold">ACTIVE TURN</span>}
                      </>
                    ) : null}

                    <button
                      type="button"
                      id="btn-monster-action-move"
                      className="btn btn-xs"
                      disabled={isWaitingForMonsterTurn || monMovedDone}
                      style={{
                        background:
                          isShowingThisMon && effectiveMode === 'monster_move' && !monMovedDone
                            ? 'rgba(248, 113, 113, 0.35)'
                            : 'rgba(248, 113, 113, 0.16)',
                        border:
                          isShowingThisMon && effectiveMode === 'monster_move' && !monMovedDone
                            ? '1.5px solid #f87171'
                            : '1px solid rgba(248, 113, 113, 0.55)',
                        color: monMovedDone ? '#94a3b8' : '#fecaca',
                        fontWeight: 700,
                      }}
                      onClick={() => {
                        if (activeMonTok) setSelectedTokenId(activeMonTok.id);
                        setBeatActionMode('monster_move');
                        setMapHint(
                          `Monster Move mode (Red): Tap an open red-highlighted space on the map to move ${activeMonTok?.name || 'the monster'}.`
                        );
                      }}
                    >
                      {monMovedDone ? 'Moved (Wait Turn)' : 'Move'}
                    </button>
                    {monMovedDone && activeMonTok && (
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        title="Allow this monster to move again this turn"
                        onClick={() =>
                          sendAction('story_action', {
                            subAction: 'reset_token_move',
                            beatId: beat.id,
                            tokenId: activeMonTok.id,
                          })
                        }
                      >
                        Reset Move
                      </button>
                    )}

                    <button
                      type="button"
                      id="btn-monster-action-attack"
                      className="btn btn-xs"
                      disabled={isWaitingForMonsterTurn}
                      style={{
                        background:
                          isShowingThisMon && effectiveMode === 'monster_attack'
                            ? 'linear-gradient(135deg, #dc2626, #991b1b)'
                            : 'rgba(220, 38, 38, 0.28)',
                        border:
                          isShowingThisMon && effectiveMode === 'monster_attack'
                            ? '1.5px solid #ef4444'
                            : '1px solid rgba(239, 68, 68, 0.75)',
                        color: '#ffffff',
                        fontWeight: 800,
                        boxShadow:
                          isShowingThisMon && effectiveMode === 'monster_attack'
                            ? '0 0 10px rgba(220, 38, 38, 0.55)'
                            : undefined,
                      }}
                      onClick={() => {
                        if (activeMonTok) setSelectedTokenId(activeMonTok.id);
                        setBeatActionMode('monster_attack');
                        setMapHint(
                          `Monster Attack mode (Deep Red): Tap a player inside the deep-red range on the map to attack with ${activeMonTok?.name || 'the monster'}!`
                        );
                      }}
                    >
                      Attack
                    </button>

                    <button
                      type="button"
                      id="btn-monster-action-skill"
                      className="btn btn-xs"
                      disabled={isWaitingForMonsterTurn}
                      style={{
                        background:
                          isShowingThisMon && effectiveMode === 'monster_skill'
                            ? 'linear-gradient(135deg, #c026d3, #e11d48)'
                            : 'linear-gradient(135deg, rgba(192, 38, 211, 0.28), rgba(225, 29, 72, 0.28))',
                        border:
                          isShowingThisMon && effectiveMode === 'monster_skill'
                            ? '1.5px solid #f43f5e'
                            : '1px solid rgba(217, 70, 239, 0.75)',
                        color: '#fdf4ff',
                        fontWeight: 800,
                        boxShadow:
                          isShowingThisMon && effectiveMode === 'monster_skill'
                            ? '0 0 10px rgba(192, 38, 211, 0.55)'
                            : undefined,
                      }}
                      onClick={() => {
                        if (activeMonTok) {
                          setSelectedTokenId(activeMonTok.id);
                          setSkillTrayOpenForMonster(activeMonTok.id);
                          if (!selectedMonsterSkillId[activeMonTok.id] && pickedSkillId) {
                            setSelectedMonsterSkillId((prev) => ({ ...prev, [activeMonTok.id]: pickedSkillId }));
                          }
                        }
                        setBeatActionMode('monster_skill');
                        setMapHint(
                          `Monster Use Skills mode (Purple-Red): Pick a skill and tap a player in the purple-red range on the map (or click Unleash Skill)!`
                        );
                      }}
                    >
                      Use Skills
                    </button>

                    {activeMonTok && (
                      <>
                        <select
                          aria-label="Monster Live Attack Area"
                          value={
                            dmAreaOverrideByMonster[activeMonTok.id] ??
                            (effectiveMode === 'monster_skill'
                              ? monSkills.find((s) => s.id === pickedSkillId)?.attackArea
                              : undefined) ??
                            activeLiveMon?.attackArea ??
                            inferDefaultAttackAreaForMonster(activeLiveMon || { name: activeMonTok.name, maxHp: activeMonTok.maxHp })
                          }
                          onChange={(e) => {
                            const areaVal = e.target.value as AttackArea;
                            setSelectedTokenId(activeMonTok.id);
                            setDmAreaOverrideByMonster((prev) => ({ ...prev, [activeMonTok.id]: areaVal }));
                            if (beatActionMode === 'monster_move') setBeatActionMode('monster_attack');
                          }}
                          style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                        >
                          {PLAYER_ATTACK_AREAS.map((a) => (
                            <option key={a} value={a}>
                              Area: {formatMonsterAttackArea(a)}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Monster Live Attack Area Modifier"
                          value={
                            dmModOverrideByMonster[activeMonTok.id] ??
                            (effectiveMode === 'monster_skill'
                              ? monSkills.find((s) => s.id === pickedSkillId)?.attackAreaModifier
                              : undefined) ??
                            activeLiveMon?.attackAreaModifier ??
                            0
                          }
                          onChange={(e) => {
                            const modVal = Number(e.target.value);
                            setSelectedTokenId(activeMonTok.id);
                            setDmModOverrideByMonster((prev) => ({ ...prev, [activeMonTok.id]: modVal }));
                            if (beatActionMode === 'monster_move') setBeatActionMode('monster_attack');
                          }}
                          style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                        >
                          {[-2, -1, 0, 1, 2, 3, 4].map((m) => (
                            <option key={m} value={m}>
                              Mod: {m > 0 ? `+${m}` : m} Sp
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    <select
                      aria-label="Monster Heal or Effect"
                      value={dmHealBuffChoice}
                      onChange={(e) => setDmHealBuffChoice(e.target.value as 'none' | 'heal' | UnitEffectKind)}
                      style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                    >
                      <option value="none">Effect: None</option>
                      <option value="heal">Heal HP (2d6+2)</option>
                      {UNIT_EFFECT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {UNIT_EFFECT_META[k].category === 'buff' ? 'Buff' : 'Debuff'}: {UNIT_EFFECT_META[k].label}
                        </option>
                      ))}
                    </select>
                    {activeMonTok && dmHealBuffChoice !== 'none' && (dmHealBuffChoice === 'heal' || UNIT_EFFECT_META[dmHealBuffChoice].category === 'buff') && (
                      <button
                        type="button"
                        className="btn btn-xs btn-gold"
                        onClick={async () => {
                          await sendAction('unit_effect_action', {
                            subAction: 'apply',
                            targetType: 'monster',
                            targetId: activeMonTok.id,
                            ...buildChoicePayload(dmHealBuffChoice),
                            sourceName: 'DM Action',
                          });
                        }}
                      >
                        Apply Heal/Buff
                      </button>
                    )}
                    <button
                      type="button"
                      id="btn-monster-end-turn"
                      className="btn btn-xs btn-gold"
                      style={{ marginLeft: 'auto' }}
                      onClick={async () => {
                        await sendAction('initiative_action', { subAction: 'next_turn' });
                        setAimCell(null);
                        setSelectedTokenId(null);
                        pushLocalToast({ title: 'TURN ENDED', message: 'Passed turn to the next combatant.', category: 'info' });
                      }}
                    >
                      End Turn
                    </button>
                  </div>

                  {isShowingThisMon && effectiveMode === 'monster_skill' && activeMonTok && (
                    <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                      {monSkills.length > 0 ? (
                        <>
                          {monSkills.map((sk) => {
                            const rem = Number(sk.usesRemaining ?? sk.maxUsesPerCombat ?? 1);
                            const maxU = Number(sk.maxUsesPerCombat || 1);
                            const exhausted = rem <= 0;
                            const isPicked = pickedSkillId === sk.id;
                            return (
                              <button
                                key={sk.id}
                                type="button"
                                disabled={exhausted}
                                className="btn btn-xs"
                                style={{
                                  background: isPicked
                                    ? 'linear-gradient(135deg, #a21caf, #be123c)'
                                    : 'rgba(88, 28, 135, 0.3)',
                                  border: isPicked ? '1.5px solid #fb7185' : '1px solid rgba(192, 38, 211, 0.5)',
                                  color: exhausted ? '#94a3b8' : '#fce7f3',
                                }}
                                onClick={() => {
                                  setSelectedMonsterSkillId((prev) => ({ ...prev, [activeMonTok.id]: sk.id }));
                                }}
                              >
                                {sk.name} ({rem}/{maxU}) • {sk.damageFormula}
                              </button>
                            );
                          })}
                          {chars.length > 0 && pickedSkillId && (
                            <button
                              type="button"
                              className="btn btn-xs btn-crimson"
                              onClick={() =>
                                sendAction('monster_attack', {
                                  monsterId: activeMonTok.id,
                                  targetCharacterId: attackTargetByMonster[activeMonTok.id] || chars[0]?.id,
                                  skillId: pickedSkillId,
                                  ...buildChoicePayload(dmHealBuffChoice),
                                })
                              }
                            >
                              Unleash on {(chars.find((c) => c.id === (attackTargetByMonster[activeMonTok.id] || chars[0]?.id)) || chars[0])?.name}
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="small muted">No skills configured for {activeMonTok.name}.</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            <div
              id="beat-detail-status-strip"
              className="small"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 10px',
                marginBottom: '8px',
                borderRadius: '8px',
                background: 'rgba(15, 23, 42, 0.72)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span
                className={`tag ${
                  latestStatus?.category === 'combat'
                    ? 'tag-crimson'
                    : latestStatus?.category === 'warning'
                      ? 'tag-gold'
                      : latestStatus?.category === 'loot'
                        ? 'tag-green'
                        : 'tag-cyan'
                }`}
                style={{ flexShrink: 0 }}
              >
                {latestStatus?.title || 'ARENA STATUS'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', color: '#e2e8f0' }}>
                {latestStatus?.message || mapHint}
              </span>
            </div>

            <div className="arena-scroll-wrap" style={{ maxHeight: '74vh' }}>
              <BeatArenaCanvas
                id="beat-detail-canvas"
                beat={beat}
                variant="detail"
                selectedTokenId={
                  !isDm
                    ? (selectedTokenId ?? session.characterId)
                    : hasTurnOrder
                      ? activeTurnMonsterId
                      : (selectedTokenId ?? arenaMons[0]?.id ?? null)
                }
                beatActionMode={effectiveMode}
                previewAimCell={aimCell}
                previewAttackArea={(() => {
                  if (!isDm) {
                    return playerAttackAreaOverride ?? me?.equipment?.mainHand?.attackArea ?? 'single';
                  }
                  const monId = activeTurnMonsterId || (selectedTokenId && arenaMonsterIds.has(selectedTokenId) ? selectedTokenId : arenaMons[0]?.id);
                  if (!monId) return null;
                  const monObj = (state.monsters || []).find((m) => m.id === monId);
                  const skId = selectedMonsterSkillId[monId];
                  const skObj = effectiveMode === 'monster_skill' ? monObj?.skills?.find((s) => s.id === skId) : undefined;
                  return dmAreaOverrideByMonster[monId] ?? skObj?.attackArea ?? monObj?.attackArea ?? null;
                })()}
                previewAttackAreaModifier={(() => {
                  if (!isDm) {
                    return playerAreaModOverride ?? me?.equipment?.mainHand?.attackAreaModifier ?? 0;
                  }
                  const monId = activeTurnMonsterId || (selectedTokenId && arenaMonsterIds.has(selectedTokenId) ? selectedTokenId : arenaMons[0]?.id);
                  if (!monId) return 0;
                  const monObj = (state.monsters || []).find((m) => m.id === monId);
                  const skId = selectedMonsterSkillId[monId];
                  const skObj = effectiveMode === 'monster_skill' ? monObj?.skills?.find((s) => s.id === skId) : undefined;
                  return dmModOverrideByMonster[monId] ?? skObj?.attackAreaModifier ?? monObj?.attackAreaModifier ?? 0;
                })()}
                centerOnCharacterId={!isDm ? session.characterId : null}
                onCellClick={handleArenaClick}
              />
            </div>

            <div id="beat-detail-initiative-panel" className="mt-sm" style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <div className="panel-header">
                <div className="btn-row" style={{ alignItems: 'center' }}>
                  <h4 style={{ margin: 0 }}>Initiative &amp; Turn Order (Stat-Based)</h4>
                  <span id="beat-detail-round-pill" className={`tag ${isFinalRounds ? 'tag-crimson' : 'tag-gold'}`}>
                    ROUND {currentRound}{isCombatBeat ? ` / ${maxRounds}` : ''}
                  </span>
                </div>
                <div className="btn-row">
                  {isDm ? (
                    <>
                      <button
                        type="button"
                        id="btn-beat-init-prev"
                        className="btn btn-xs btn-outline"
                        onClick={() => sendAction('initiative_action', { subAction: 'prev_turn' })}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        id="btn-beat-init-next"
                        className="btn btn-xs btn-cyan"
                        onClick={() => sendAction('initiative_action', { subAction: 'next_turn' })}
                      >
                        Next Turn
                      </button>
                      <button
                        type="button"
                        id="btn-beat-init-roll-all"
                        className="btn btn-xs btn-gold"
                        onClick={() => sendAction('initiative_action', { subAction: 'roll_all' })}
                      >
                        Roll All
                      </button>
                    </>
                  ) : session.characterId ? (
                    <>
                      {beat.aiDmEnabled && activeCombatant?.type === 'monster' && !pendingReactionObj && (
                        <button
                          type="button"
                          id="btn-beat-run-ai-dm"
                          className="btn btn-xs btn-purple"
                          onClick={() => sendAction('initiative_action', { subAction: 'run_ai_dm' })}
                        >
                          Run AI Monster Turn
                        </button>
                      )}
                      <button
                        type="button"
                        id="btn-beat-init-roll-self"
                        className="btn btn-xs btn-cyan"
                        onClick={() => sendAction('initiative_action', { subAction: 'player_roll_initiative', characterId: session.characterId })}
                      >
                        Roll Initiative
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div id="beat-detail-initiative-list" className="list-stack mt-xs">
                {relevantCombatants.length > 0 ? (
                  relevantCombatants.map((c) => {
                    const isCurrent = activeCombatant && activeCombatant.id === c.id;
                    let mod = 0;
                    let statLabel = 'Stat';
                    if (c.type === 'player' && state.characters?.[c.id]) {
                      const ch = state.characters[c.id];
                      const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
                      mod = computeStatModifier(Number(agiScore), state.mechanics, ch);
                      statLabel = `AGI ${agiScore}`;
                    } else if (c.type === 'monster') {
                      const mon = (state.monsters || []).find((m) => m.id === c.id);
                      const acVal = mon ? (mon.agi ?? mon.ac ?? 12) : 12;
                      mod = Math.floor((Number(acVal) - 10) / 2);
                      statLabel = mon ? `AC ${mon.ac}` : 'Monster';
                    }
                    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
                    const monObj = c.type === 'monster' ? (state.monsters || []).find((m) => m.id === c.id) : undefined;
                    return (
                      <div key={c.id} className={`item-card ${isCurrent ? 'card-glow-cyan' : ''}`}>
                        <div className="item-card-top">
                          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            {c.type === 'monster' && (
                              <TokenIconSvg type="monster" name={c.name} iconId={monObj?.iconId} size={20} />
                            )}
                            {c.name}{' '}
                            {c.type === 'monster' ? (
                              <span className="tag tag-crimson">MONSTER</span>
                            ) : !isDm && session.characterId === c.id ? (
                              <span className="tag tag-gold">YOU</span>
                            ) : (
                              <span className="tag tag-cyan">PARTY MEMBER</span>
                            )}
                            {isCurrent && <span className="tag tag-gold">ACTIVE TURN</span>}
                          </strong>
                          <span>
                            Init: <b>{c.initiative ?? '—'}</b>
                            {(isDm || c.type !== 'monster') && (
                              <span className="muted small"> ({statLabel} • {modStr})</span>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="muted small">No combatants in initiative order yet.</div>
                )}
              </div>
            </div>
          </div>
          )}

          <div className="beat-detail-side-col stack" style={beat.beatType === 'narration' ? { gridColumn: '1 / -1' } : undefined}>
            <div className="panel">
              <div className="panel-header">
                <h3 id="beat-detail-players-title">{isDm ? 'Players & Live Stats' : 'Your Vitals'}</h3>
              </div>
              <div id="beat-detail-players" className="list-stack mt-xs">
                {!isDm && me ? (
                  <div className="item-card">
                    <div className="item-card-top">
                      <strong>{me.name}</strong>
                      <span className="tag tag-cyan">Lv {me.level || 1}</span>
                    </div>
                    <div className="bar-row small mt-xs"><span>HP</span><b>{me.hp}/{me.maxHp}</b></div>
                    <div className="progress"><div className="progress-fill hp" style={{ width: `${me.maxHp ? Math.max(0, Math.min(100, (me.hp / me.maxHp) * 100)) : 0}%` }} /></div>
                    <div className="bar-row small mt-xs"><span>Mana (MP)</span><b>{me.mp}/{me.maxMp}</b></div>
                    <div className="progress"><div className="progress-fill mp" style={{ width: `${me.maxMp ? Math.max(0, Math.min(100, (me.mp / me.maxMp) * 100)) : 0}%` }} /></div>
                    <div className="bar-row small mt-xs"><span>Experience (XP)</span><b>{me.xp || 0}/{me.xpToNext || me.level * 100} XP</b></div>
                    <div className="progress"><div className="progress-fill xp" style={{ width: `${Math.max(0, Math.min(100, ((me.xp || 0) / (me.xpToNext || me.level * 100)) * 100))}%` }} /></div>
                    {(me.activeEffects || []).length > 0 && (
                      <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                        {(me.activeEffects || []).map((eff) => (
                          <span key={eff.id} className={`tag ${eff.category === 'buff' ? 'tag-green' : 'tag-crimson'}`}>
                            {formatActiveUnitEffect(eff)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : chars.length > 0 ? (
                  chars.map((ch) => (
                    <div key={ch.id} className="item-card">
                      <div className="item-card-top">
                        <strong>
                          {ch.name} <span className="tag tag-cyan">Lv {ch.level} {ch.className || ''}</span>
                          {!arenaIds.has(ch.id) && <span className="muted small"> (Off-map)</span>}
                        </strong>
                        <span>HP <b>{ch.hp}/{ch.maxHp}</b> • MP <b>{ch.mp}/{ch.maxMp}</b> • AC {ch.ac} • DR {ch.dr || 0}</span>
                      </div>
                      <div className="progress"><div className="progress-fill hp" style={{ width: `${ch.maxHp ? Math.max(0, Math.min(100, (ch.hp / ch.maxHp) * 100)) : 0}%` }} /></div>
                      {(ch.activeEffects || []).length > 0 && (
                        <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                          {(ch.activeEffects || []).map((eff) => (
                            <span key={eff.id} className={`tag ${eff.category === 'buff' ? 'tag-green' : 'tag-crimson'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              {formatActiveUnitEffect(eff)}
                              {isDm && (
                                <button
                                  type="button"
                                  aria-label={`Remove ${eff.name}`}
                                  onClick={() =>
                                    sendAction('unit_effect_action', {
                                      subAction: 'clear_effect',
                                      targetType: 'player',
                                      targetId: ch.id,
                                      effectId: eff.id,
                                    })
                                  }
                                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="stat-pills">
                        {Object.entries(ch.stats || {}).map(([k, v]) => (
                          <span key={k} className="stat-pill">{k}: <b>{v}</b></span>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted small">No players in session.</div>
                )}
              </div>
            </div>

            {!isDm && me && (
              <div id="beat-detail-spells-panel" className="panel">
                <div className="panel-header"><h3>Your Spells</h3></div>
                <div id="beat-detail-spells" className="list-stack mt-xs">
                  {(me.spells || []).length > 0 ? (
                    me.spells.map((sp) => {
                      const elName = normalizeSpellElement(sp.element || sp.damageType);
                      const isReaction = sp.actionType === 'Reaction';
                      return (
                        <div key={sp.id} className="item-card">
                          <div className="item-card-top">
                            <strong>
                              {sp.name} <span className={`tag tag-el-${elName.toLowerCase()}`}>{elName}</span>
                              {isReaction && <span className="tag tag-purple">Reaction</span>}
                              {sp.healFormula && <span className="tag tag-green">Heal {sp.healFormula}</span>}
                              {sp.effectSpec && (
                                <span className={`tag ${UNIT_EFFECT_META[sp.effectSpec.kind]?.category === 'buff' ? 'tag-green' : 'tag-crimson'}`}>
                                  {formatUnitEffectSpec(sp.effectSpec)}
                                </span>
                              )}
                            </strong>
                            <span className="tag tag-cyan">{sp.damageDice} • {sp.rangeSpaces} Sp • {sp.mpCost} MP</span>
                          </div>
                          <div className="btn-row mt-xs">
                            <button
                              type="button"
                              className="btn btn-xs btn-crimson"
                              disabled={isReaction ? !pendingReact : (!isMyCombatTurn || usedAttacks > 0 || spellCastDone)}
                              onClick={async () => {
                                if (isReaction && pendingReactionObj) {
                                  const res = await sendAction<{ summary?: string }>('resolve_reaction', {
                                    reactionId: pendingReactionObj.id,
                                    choice: 'spell',
                                    spellId: sp.id,
                                  });
                                  if (res?.summary) {
                                    pushLocalToast({ title: 'REACTION SPELL!', message: res.summary, category: 'combat' });
                                  }
                                  return;
                                }
                                const res = await sendAction<{
                                  ok?: boolean;
                                  summary?: string;
                                  defeatSummary?: import('@shared/index').MonsterDefeatSummary | null;
                                  logEntry?: { summary?: string };
                                }>('spell_action', {
                                  characterId: me.id,
                                  subAction: 'cast',
                                  spellId: sp.id,
                                  beatId: beat.id,
                                  attackArea: sp.attackArea || playerAttackAreaOverride || 'single',
                                  attackAreaModifier: sp.attackAreaModifier ?? playerAreaModOverride ?? 0,
                                  targetMonsterId: defaultMonsterId || undefined,
                                  ...(sp.healFormula ? { healFormula: sp.healFormula } : {}),
                                  ...(sp.effectSpec ? { effectSpec: sp.effectSpec } : {}),
                                });
                                if (res?.defeatSummary) {
                                  setDefeatedMonster(res.defeatSummary);
                                }
                                if (res?.ok) {
                                  pushLocalToast({
                                    title: 'SPELL CAST!',
                                    message: res.summary || res.logEntry?.summary || 'Spell unleashed!',
                                    category: 'combat',
                                  });
                                }
                              }}
                            >
                              {isReaction ? 'Reaction Cast' : 'Cast'}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="muted small">No spells learned yet.</div>
                  )}
                </div>
              </div>
            )}

            {beat.beatType !== 'narration' && (
            <div className="panel">
              <div className="panel-header">
                <h3>{isDm ? 'Spawned Monsters' : `Monsters (${arenaMons.length})`}</h3>
                {isDm && (beat.encounters || []).length > 0 && (
                  <button
                    type="button"
                    id="btn-beat-detail-spawn"
                    className={`btn btn-xs ${unspawnedEncounterCount > 0 || hasDuplicateArenaMonsters ? 'btn-crimson' : 'btn-outline'}`}
                    disabled={unspawnedEncounterCount === 0 && !hasDuplicateArenaMonsters}
                    title={
                      unspawnedEncounterCount === 0 && !hasDuplicateArenaMonsters
                        ? 'All attached monsters are already spawned on the arena map'
                        : `Spawn ${unspawnedEncounterCount} unattached monster(s) onto the arena map`
                    }
                    onClick={() => sendAction('story_action', { subAction: 'spawn_beat_monsters', beatId: beat.id })}
                  >
                    {unspawnedEncounterCount > 0
                      ? 'Spawn Attached'
                      : hasDuplicateArenaMonsters
                        ? 'Clean Duplicate Spawns'
                        : 'Attached Spawned'}
                  </button>
                )}
              </div>
              <div id="beat-detail-monsters" className="list-stack mt-xs">
                {arenaMons.length > 0 ? (
                  arenaMons.map((tok) => {
                    const liveMon = (state.monsters || []).find((m) => m.id === tok.id);
                    const hp = liveMon ? liveMon.hp : tok.hp;
                    const maxHp = liveMon ? liveMon.maxHp : tok.maxHp;
                    const pct = maxHp && hp !== null ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
                    const isActiveMonTurn = activeTurnMonsterId === tok.id;
                    const isLockedOutOfTurn = hasTurnOrder && tok.id !== activeTurnMonsterId;
                    return (
                      <div key={tok.id} className={`item-card ${isActiveMonTurn ? 'card-glow-crimson' : ''}`} style={isLockedOutOfTurn ? { opacity: 0.65 } : undefined}>
                        <div className="item-card-top">
                          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <TokenIconSvg type="monster" name={tok.name} iconId={liveMon?.iconId ?? tok.iconId} size={22} />
                            {tok.name}{' '}
                            {isActiveMonTurn && <span className="tag tag-gold">ACTIVE TURN</span>}
                            {isLockedOutOfTurn && <span className="tag tag-outline">WAIT TURN</span>}
                            {hp !== null && hp <= 0 && <span className="tag tag-gold">DEFEATED</span>}
                          </strong>
                          <span>
                            {isDm
                              ? `${hp !== null && maxHp ? `HP ${hp}/${maxHp}` : ''}${liveMon ? ` • AC ${liveMon.ac} • DR ${liveMon.dr}` : ''}`
                              : state.mechanics?.showExactMonsterHpToPlayers && hp !== null && maxHp
                                ? `HP ${hp}/${maxHp}`
                                : liveMon?.healthTier ||
                                  (hp !== null && maxHp
                                    ? hp <= 0
                                      ? 'Defeated'
                                      : hp >= maxHp
                                        ? 'Unharmed'
                                        : hp >= maxHp * 0.5
                                          ? 'Wounded'
                                          : hp >= maxHp * 0.25
                                            ? 'Bloodied'
                                            : 'Critical'
                                    : 'Active')}
                          </span>
                        </div>
                        {isDm && liveMon && (
                          <div className="small mt-xs">
                            <span className="tag tag-crimson">
                              Attack Area: {formatMonsterAttackArea(inferDefaultAttackAreaForMonster(liveMon))}
                            </span>
                          </div>
                        )}
                        {liveMon && (liveMon.activeEffects || []).length > 0 && (
                          <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                            {(liveMon.activeEffects || []).map((eff) => (
                              <span key={eff.id} className={`tag ${eff.category === 'buff' ? 'tag-green' : 'tag-crimson'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                {formatActiveUnitEffect(eff)}
                                {isDm && (
                                  <button
                                    type="button"
                                    aria-label={`Remove ${eff.name}`}
                                    onClick={() =>
                                      sendAction('unit_effect_action', {
                                        subAction: 'clear_effect',
                                        targetType: 'monster',
                                        targetId: liveMon.id,
                                        effectId: eff.id,
                                      })
                                    }
                                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                        {maxHp && (isDm || state.mechanics?.showExactMonsterHpToPlayers) ? (
                          <div className="progress"><div className="progress-fill monster" style={{ width: `${pct}%` }} /></div>
                        ) : null}
                        {isDm && liveMon && (
                          <div className="stack-form mt-xs" style={{ gap: '6px' }}>
                            <div className="btn-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                              <button
                                type="button"
                                className="btn btn-xs"
                                disabled={isLockedOutOfTurn || Boolean(tok.hasMovedThisTurn)}
                                style={{
                                  background:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_move' && !tok.hasMovedThisTurn
                                      ? 'rgba(248, 113, 113, 0.35)'
                                      : 'rgba(248, 113, 113, 0.16)',
                                  border:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_move' && !tok.hasMovedThisTurn
                                      ? '1.5px solid #f87171'
                                      : '1px solid rgba(248, 113, 113, 0.55)',
                                  color: tok.hasMovedThisTurn || isLockedOutOfTurn ? '#94a3b8' : '#fecaca',
                                  fontWeight: 700,
                                }}
                                onClick={() => {
                                  setSelectedTokenId(liveMon.id);
                                  setAimCell(null);
                                  setBeatActionMode('monster_move');
                                  setMapHint(
                                    `Monster Move mode (Red): Tap an open red-highlighted space on the map to move ${liveMon.name}.`
                                  );
                                }}
                              >
                                {tok.hasMovedThisTurn ? 'Moved' : 'Move'}
                              </button>
                              {tok.hasMovedThisTurn && !isLockedOutOfTurn && (
                                <button
                                  type="button"
                                  className="btn btn-xs btn-outline"
                                  title="Allow this monster to move again this turn"
                                  onClick={() =>
                                    sendAction('story_action', {
                                      subAction: 'reset_token_move',
                                      beatId: beat.id,
                                      tokenId: liveMon.id,
                                    })
                                  }
                                >
                                  Reset Move
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-xs"
                                disabled={isLockedOutOfTurn}
                                style={{
                                  background:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_attack'
                                      ? 'linear-gradient(135deg, #dc2626, #991b1b)'
                                      : 'rgba(220, 38, 38, 0.28)',
                                  border:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_attack'
                                      ? '1.5px solid #ef4444'
                                      : '1px solid rgba(239, 68, 68, 0.75)',
                                  color: '#ffffff',
                                  fontWeight: 800,
                                }}
                                onClick={() => {
                                  setSelectedTokenId(liveMon.id);
                                  setBeatActionMode('monster_attack');
                                  setMapHint(
                                    `Monster Attack mode (Deep Red): Tap a player inside the deep-red range on the map to attack with ${liveMon.name}!`
                                  );
                                }}
                              >
                                Attack
                              </button>
                              <button
                                type="button"
                                className="btn btn-xs"
                                disabled={isLockedOutOfTurn}
                                style={{
                                  background:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_skill'
                                      ? 'linear-gradient(135deg, #c026d3, #e11d48)'
                                      : 'linear-gradient(135deg, rgba(192, 38, 211, 0.28), rgba(225, 29, 72, 0.28))',
                                  border:
                                    selectedTokenId === liveMon.id && effectiveMode === 'monster_skill'
                                      ? '1.5px solid #f43f5e'
                                      : '1px solid rgba(217, 70, 239, 0.75)',
                                  color: '#fdf4ff',
                                  fontWeight: 800,
                                }}
                                onClick={() => {
                                  setSelectedTokenId(liveMon.id);
                                  setBeatActionMode('monster_skill');
                                  setSkillTrayOpenForMonster((prev) => (prev === liveMon.id ? null : liveMon.id));
                                  const firstAvail = (liveMon.skills || []).find(
                                    (s) => Number(s.usesRemaining ?? s.maxUsesPerCombat ?? 1) > 0
                                  );
                                  if (firstAvail && !selectedMonsterSkillId[liveMon.id]) {
                                    setSelectedMonsterSkillId((prev) => ({ ...prev, [liveMon.id]: firstAvail.id }));
                                  }
                                  setMapHint(
                                    `Monster Use Skills mode (Purple-Red): Tap a player inside the purple-red range on the map or pick a skill below!`
                                  );
                                }}
                              >
                                Use Skills
                              </button>
                              <button type="button" className="btn btn-xs btn-outline" onClick={() => sendAction('update_monster', { monsterId: liveMon.id, hpDelta: -5 })}>-5 HP</button>
                              <button type="button" className="btn btn-xs btn-outline" onClick={() => sendAction('update_monster', { monsterId: liveMon.id, hpDelta: 5 })}>+5 HP</button>
                              {chars.length > 0 && (
                                <>
                                  <select
                                    aria-label="Target Player"
                                    disabled={isLockedOutOfTurn}
                                    value={attackTargetByMonster[liveMon.id] || chars[0]?.id || ''}
                                    onChange={(e) =>
                                      setAttackTargetByMonster((prev) => ({ ...prev, [liveMon.id]: e.target.value }))
                                    }
                                    style={{ width: 'auto', minHeight: '26px', padding: '2px 6px', fontSize: '0.75rem' }}
                                  >
                                    {chars.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        Target: {c.name}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-crimson"
                                    disabled={isLockedOutOfTurn}
                                    onClick={() =>
                                      sendAction('monster_attack', {
                                        monsterId: liveMon.id,
                                        targetCharacterId: attackTargetByMonster[liveMon.id] || chars[0]?.id,
                                      })
                                    }
                                  >
                                    Roll Attack Player
                                  </button>
                                </>
                              )}
                            </div>

                            {chars.length > 0 &&
                              (liveMon.skills || []).length > 0 &&
                              (skillTrayOpenForMonster === liveMon.id ||
                                (selectedTokenId === liveMon.id && effectiveMode === 'monster_skill')) && (
                              <div className="btn-row" style={{ flexWrap: 'wrap', gap: '5px' }}>
                                {liveMon.skills!.map((sk) => {
                                  const rem = Number(sk.usesRemaining ?? sk.maxUsesPerCombat ?? 1);
                                  const maxU = Number(sk.maxUsesPerCombat || 1);
                                  const exhausted = rem <= 0;
                                  return (
                                    <button
                                      key={sk.id}
                                      type="button"
                                      className={`btn btn-xs ${exhausted ? 'btn-outline' : 'btn-purple'}`}
                                      disabled={exhausted}
                                      title={`${sk.name} (${sk.damageFormula}) — ${sk.description || 'Monster Skill'}`}
                                      onClick={() =>
                                        sendAction('monster_attack', {
                                          monsterId: liveMon.id,
                                          targetCharacterId: attackTargetByMonster[liveMon.id] || chars[0]?.id,
                                          skillId: sk.id,
                                        })
                                      }
                                    >
                                      {sk.name} ({rem}/{maxU}) • {sk.damageFormula}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (beat.encounters || []).length > 0 ? (
                  isDm ? (
                    beat.encounters.map((e, i) => (
                      <div key={`${e.name}-${i}`} className="item-card">
                        <div className="item-card-top">
                          <strong>{e.name} <span className="tag tag-crimson">READY TO SPAWN</span></strong>
                          <span>HP {e.maxHp} • AC {e.ac} • DR {e.dr} • {e.damageFormula || ''}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="item-card small muted">
                      {beat.encounters.length} Monster{beat.encounters.length === 1 ? '' : 's'} lurking in the area...
                    </div>
                  )
                ) : (
                  <div className="muted small">No monsters in this story beat.</div>
                )}
              </div>
            </div>
            )}

            {beat.beatType !== 'narration' && (
              <div id="beat-detail-combat-feed" className="panel">
                <div className="panel-header">
                  <h3>Live Combat Feed</h3>
                  <span className="tag tag-cyan">{(state.combatLog || []).length}</span>
                </div>
                <div className="list-stack mt-xs" style={{ maxHeight: '210px', overflowY: 'auto' }}>
                  {(state.combatLog || []).length > 0 ? (
                    (state.combatLog || []).slice(0, 15).map((log) => (
                      <div key={log.id} className="item-card" style={{ padding: '6px 8px' }}>
                        <div className="small" style={{ color: '#e2e8f0' }}>{log.summary}</div>
                      </div>
                    ))
                  ) : (
                    <div className="muted small">Combat actions will appear here.</div>
                  )}
                </div>
              </div>
            )}

            <div className="panel">
              <div className="panel-header"><h3>Treasure &amp; Loot Chests</h3></div>
              <div id="beat-detail-treasure" className="list-stack mt-xs">
                {isDm ? (
                  <>
                    {(beat.treasures || []).map((t) => (
                      <div key={t.id} className="item-card">
                        <div className="item-card-top">
                          <strong>{t.name} <span className="tag tag-gold">{t.category || 'treasure'}</span></strong>
                          <span>{[t.gold ? `${t.gold}G` : '', t.manaStones ? `${t.manaStones} Stones` : '', t.damageDice || ''].filter(Boolean).join(' • ') || 'Story Reward'}</span>
                        </div>
                      </div>
                    ))}
                    {(arena.chests || []).map((c) => (
                      <div key={c.id} className="item-card">
                        <div className="item-card-top">
                          <strong>{c.name} <span className={`tag ${c.opened ? 'tag-cyan' : 'tag-gold'}`}>{c.opened ? 'OPENED' : 'CHEST'}</span></strong>
                          <span>{[c.gold ? `${c.gold}G` : '', c.manaStones ? `${c.manaStones} Stones` : '', c.itemName || ''].filter(Boolean).join(', ') || 'Empty'}</span>
                        </div>
                      </div>
                    ))}
                    {(beat.treasures || []).length === 0 && (arena.chests || []).length === 0 && (
                      <div className="muted small">No treasure or chests attached.</div>
                    )}
                  </>
                ) : (
                  (() => {
                    const unopenedCount = (arena.chests || []).filter((c) => !c.opened).length;
                    const openedCount = (arena.chests || []).filter((c) => c.opened).length;
                    if (unopenedCount === 0 && openedCount === 0) {
                      return <div className="muted small">No visible chests in the area.</div>;
                    }
                    return (
                      <div className="item-card small">
                        {unopenedCount > 0 ? (
                          <span>
                            <span className="tag tag-gold">CHEST</span> {unopenedCount} Unopened Chest{unopenedCount === 1 ? '' : 's'} nearby
                          </span>
                        ) : (
                          <span className="muted">All chests in this area have been opened ({openedCount}).</span>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header"><h3>NPCs in Scene</h3></div>
              <div id="beat-detail-npcs" className="list-stack mt-xs">
                {npcTokens.length > 0 ? (
                  npcTokens.map((n) => (
                    <div key={n.id} className="item-card">
                      <div className="item-card-top">
                        <strong>{n.name} <span className="tag tag-green">{n.npcRole || 'NPC'}</span></strong>
                        <span>
                          {n.rewardType && n.rewardType !== 'none'
                            ? n.rewardClaimed
                              ? 'Reward Claimed'
                              : n.rewardType === 'xp'
                                ? `+${n.rewardXp} XP`
                                : n.rewardItemName || n.rewardType
                            : 'Dialogue'}
                        </span>
                      </div>
                      {n.dialogue && <div className="muted small">"{n.dialogue}"</div>}
                    </div>
                  ))
                ) : (
                  <div className="muted small">No NPCs placed in this scene.</div>
                )}
              </div>
            </div>

            {isDm && (
              <div id="beat-detail-toast-panel" className="panel">
                <div className="panel-header"><h3>Send Toast to Players</h3></div>
                <form
                  id="beat-toast-form"
                  className="stack-form mt-xs"
                  onSubmit={async (ev) => {
                    ev.preventDefault();
                    if (!toastMsg.trim()) return;
                    await sendAction('broadcast_toast', {
                      title: 'SYSTEM NOTICE',
                      category: toastCat,
                      target: toastTarget,
                      message: toastMsg.trim(),
                    });
                    setToastMsg('');
                  }}
                >
                  <div className="grid-2">
                    <select value={toastTarget} onChange={(e) => setToastTarget(e.target.value)} aria-label="Toast Target">
                      <option value="all">All Players</option>
                      {chars.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <select value={toastCat} onChange={(e) => setToastCat(e.target.value)} aria-label="Toast Category">
                      <option value="info">System Notice (Cyan)</option>
                      <option value="combat">Combat Alert (Crimson)</option>
                      <option value="warning">Warning / Trap (Amber)</option>
                      <option value="loot">Reward / Loot (Gold)</option>
                    </select>
                  </div>
                  <div className="btn-row" style={{ gap: '6px' }}>
                    <input type="text" placeholder="Message to players..." style={{ flex: 1 }} required value={toastMsg} onChange={(e) => setToastMsg(e.target.value)} />
                    <button type="submit" className="btn btn-sm btn-cyan">Send Toast</button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </main>
      {npcMoveConfirmModal}
    </section>
  );
}
