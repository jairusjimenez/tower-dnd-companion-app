import React, { useState } from 'react';
import {
  DEFAULT_COMBAT_MAX_ROUNDS,
  UNIT_EFFECT_META,
  buildChestLootPreview,
  computeActiveEffectModifiers,
  formatMonsterAttackArea,
  getMaxAttacksForFloor,
  inferDefaultAttackAreaForMonster,
  isPartyInCombat,
  type AttackArea,
  type ChestLootSummary,
  type MapToken,
  type UnitEffectKind,
  type UnitEffectSpec,
} from '@shared/index';
import type { BeatActionMode } from '../../canvas/drawBeatArena';
import { useVtt } from '../../context/VttContext';
import { findClosestNpcInteractCell } from '../../utils/npcInteraction';
import { TokenIconSvg } from '../common/TokenIconSvg';
import { BeatArenaCanvas, useBeatPlayerCellAction } from './BeatArenaCanvas';
import { PlayerCombatHud } from './PlayerCombatHud';
import { BeatPromptsPanel } from './beat/BeatPromptsPanel';
import { BeatEditDrawer } from './beat/BeatEditDrawer';
import { BeatActionTrays } from './beat/BeatActionTrays';
import { BeatInitiativePanel } from './beat/BeatInitiativePanel';
import { BeatSideVitalsAndSpells } from './beat/BeatSideVitalsAndSpells';
import { BeatSideEntitiesPanel } from './beat/BeatSideEntitiesPanel';

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
  const [attackTargetByMonster, setAttackTargetByMonster] = useState<Record<string, string>>({});
  const [selectedMonsterSkillId, setSelectedMonsterSkillId] = useState<Record<string, string>>({});
  const [skillTrayOpenForMonster, setSkillTrayOpenForMonster] = useState<string | null>(null);
  const [playerAttackAreaOverride, setPlayerAttackAreaOverride] = useState<AttackArea | null>(null);
  const [playerAreaModOverride, setPlayerAreaModOverride] = useState<number | null>(null);
  const [playerSkillTrayOpen, setPlayerSkillTrayOpen] = useState(false);
  const [dmAreaOverrideByMonster, setDmAreaOverrideByMonster] = useState<Record<string, AttackArea>>({});
  const [dmModOverrideByMonster, setDmModOverrideByMonster] = useState<Record<string, number>>({});
  const [aimCell, setAimCell] = useState<{ x: number; y: number } | null>(null);

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
              <button type="button" id="btn-beat-detail-edit" className="btn btn-sm btn-gold" onClick={() => setEditOpen((v) => !v)}>
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


        <BeatPromptsPanel beat={beat} isDm={isDm} />

        {isDm && editOpen && (
          <BeatEditDrawer key={beat.id} beat={beat} onClose={() => setEditOpen(false)} />
        )}

        <div className="beat-detail-grid mt-sm">
          {beat.beatType !== 'narration' && (
          <div className="panel beat-detail-map-col">
            <div className="panel-header">
              <h3>Real-Time Arena Map</h3>
              <span id="beat-detail-map-hint" className="muted small">{mapHint}</span>
            </div>

            <BeatActionTrays
              beat={beat}
              isDm={isDm}
              arena={arena}
              me={me}
              chars={chars}
              arenaMons={arenaMons}
              arenaMonsterIds={arenaMonsterIds}
              consumables={consumables}
              combat={combat}
              activeCombatant={activeCombatant}
              beatHasMonsters={beatHasMonsters}
              activeTurnMonsterId={activeTurnMonsterId}
              isWaitingForMonsterTurn={isWaitingForMonsterTurn}
              isMyCombatTurn={isMyCombatTurn}
              maxAttacks={maxAttacks}
              usedAttacks={usedAttacks}
              attacksExhausted={attacksExhausted}
              movedDone={movedDone}
              observeDone={observeDone}
              spellCastDone={spellCastDone}
              beatActionMode={beatActionMode}
              effectiveMode={effectiveMode}
              setBeatActionMode={setBeatActionMode}
              selectedTokenId={selectedTokenId}
              setSelectedTokenId={setSelectedTokenId}
              mapHint={mapHint}
              setMapHint={setMapHint}
              setAimCell={setAimCell}
              itemTrayOpen={itemTrayOpen}
              setItemTrayOpen={setItemTrayOpen}
              playerSkillTrayOpen={playerSkillTrayOpen}
              setPlayerSkillTrayOpen={setPlayerSkillTrayOpen}
              playerAttackAreaOverride={playerAttackAreaOverride}
              setPlayerAttackAreaOverride={setPlayerAttackAreaOverride}
              playerAreaModOverride={playerAreaModOverride}
              setPlayerAreaModOverride={setPlayerAreaModOverride}
              playerHealBuffChoice={playerHealBuffChoice}
              setPlayerHealBuffChoice={setPlayerHealBuffChoice}
              dmHealBuffChoice={dmHealBuffChoice}
              setDmHealBuffChoice={setDmHealBuffChoice}
              buildChoicePayload={buildChoicePayload}
              attackTargetByMonster={attackTargetByMonster}
              selectedMonsterSkillId={selectedMonsterSkillId}
              setSelectedMonsterSkillId={setSelectedMonsterSkillId}
              setSkillTrayOpenForMonster={setSkillTrayOpenForMonster}
              dmAreaOverrideByMonster={dmAreaOverrideByMonster}
              setDmAreaOverrideByMonster={setDmAreaOverrideByMonster}
              dmModOverrideByMonster={dmModOverrideByMonster}
              setDmModOverrideByMonster={setDmModOverrideByMonster}
            />

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

            <BeatInitiativePanel
              beat={beat}
              isDm={isDm}
              currentRound={currentRound}
              maxRounds={maxRounds}
              isFinalRounds={isFinalRounds}
              activeCombatant={activeCombatant}
              relevantCombatants={relevantCombatants}
              pendingReactionObj={pendingReactionObj}
              isCombatBeat={isCombatBeat}
            />
          </div>
          )}

          <div className="beat-detail-side-col stack" style={beat.beatType === 'narration' ? { gridColumn: '1 / -1' } : undefined}>
            <BeatSideVitalsAndSpells
              beat={beat}
              isDm={isDm}
              me={me}
              chars={chars}
              combat={combat}
              arenaIds={arenaIds}
              isMyCombatTurn={isMyCombatTurn}
              usedAttacks={usedAttacks}
              spellCastDone={spellCastDone}
              pendingReactionObj={pendingReactionObj}
              pendingReact={pendingReact}
              defaultMonsterId={defaultMonsterId}
              playerAttackAreaOverride={playerAttackAreaOverride}
              playerAreaModOverride={playerAreaModOverride}
            />

            <BeatSideEntitiesPanel
              beat={beat}
              isDm={isDm}
              arena={arena}
              arenaMons={arenaMons}
              npcTokens={npcTokens}
              chars={chars}
              combat={combat}
              hasTurnOrder={hasTurnOrder}
              activeTurnMonsterId={activeTurnMonsterId}
              unspawnedEncounterCount={unspawnedEncounterCount}
              hasDuplicateArenaMonsters={hasDuplicateArenaMonsters}
              selectedTokenId={selectedTokenId}
              setSelectedTokenId={setSelectedTokenId}
              effectiveMode={effectiveMode}
              setBeatActionMode={setBeatActionMode}
              setMapHint={setMapHint}
              setAimCell={setAimCell}
              attackTargetByMonster={attackTargetByMonster}
              setAttackTargetByMonster={setAttackTargetByMonster}
              selectedMonsterSkillId={selectedMonsterSkillId}
              setSelectedMonsterSkillId={setSelectedMonsterSkillId}
              skillTrayOpenForMonster={skillTrayOpenForMonster}
              setSkillTrayOpenForMonster={setSkillTrayOpenForMonster}
            />
          </div>
        </div>
      </main>
      {npcMoveConfirmModal}
    </section>
  );
}
