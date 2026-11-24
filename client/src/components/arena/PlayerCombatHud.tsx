import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SegmentedBar } from '../common/SegmentedBar';
import {
  DEFAULT_COMBAT_MAX_ROUNDS,
  UNIT_EFFECT_META,
  formatActiveUnitEffect,
  formatMonsterAttackArea,
  formatUnitEffectSpec,
  normalizeSpellElement,
  spaceDistanceBetweenPoints,
  type AttackArea,
  type Character,
  type Combatant,
  type FilteredGameState,
  type InventoryItem,
  type MapToken,
  type PendingReaction,
  type Spell,
  type StoryBeat,
  type ToastMessage,
  type UnitEffectKind,
  type UnitEffectSpec,
} from '@shared/index';
import type { BeatActionMode } from '../../canvas/drawBeatArena';
import { useVtt } from '../../context/VttContext';
import { findClosestNpcInteractCell } from '../../utils/npcInteraction';
import { TokenIconSvg } from '../common/TokenIconSvg';
import { BeatArenaCanvas } from './BeatArenaCanvas';

export interface PlayerCombatHudProps {
  beat: StoryBeat;
  state: FilteredGameState;
  me: Character;
  characterId: string;
  arena: NonNullable<StoryBeat['arena']>;
  arenaMons: MapToken[];
  npcTokens: MapToken[];
  consumables: InventoryItem[];
  combat: FilteredGameState['combat'];
  activeCombatant?: Combatant;
  relevantCombatants: Combatant[];
  hasTurnOrder: boolean;
  beatHasMonsters: boolean;
  activeTurnMonsterId: string | null;
  isMyCombatTurn: boolean;
  isLive: boolean;
  currentRound: number;
  maxRounds: number;
  isFinalRounds: boolean;
  maxAttacks: number;
  usedAttacks: number;
  attacksExhausted: boolean;
  movedDone: boolean;
  observeDone: boolean;
  effectiveMode: BeatActionMode;
  setBeatActionMode: (mode: BeatActionMode) => void;
  selectedTokenId: string | null;
  aimCell: { x: number; y: number } | null;
  playerAttackAreaOverride: AttackArea | null;
  setPlayerAttackAreaOverride: (area: AttackArea | null) => void;
  playerAreaModOverride: number | null;
  setPlayerAreaModOverride: (mod: number | null) => void;
  playerHealBuffChoice: 'none' | 'heal' | UnitEffectKind;
  setPlayerHealBuffChoice: (choice: 'none' | 'heal' | UnitEffectKind) => void;
  buildChoicePayload: (choice: 'none' | 'heal' | UnitEffectKind) => { healFormula?: string; effectSpec?: UnitEffectSpec };
  defaultMonsterId: string;
  pendingReactionObj?: PendingReaction;
  pendingReact: boolean;
  affordableReactSpell?: Character['spells'][number];
  resolveBeatReaction: (choice: 'counter' | 'parry' | 'spell' | 'accept') => Promise<void>;
  mapHint: string;
  setMapHint: (hint: string) => void;
  latestStatus: { title: string; message: string; category: ToastMessage['category']; timestamp: string } | null;
  onCellClick: (x: number, y: number) => void;
  onInteractNpc: (npcTok: MapToken) => void;
  onClose: () => void;
}

type ActiveSheet = 'none' | 'spells' | 'items' | 'info';
type InfoTab = 'monsters' | 'turns' | 'feed' | 'scene';

const DEFAULT_PLAYER_ZOOM = 1.5;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.75;

export function PlayerCombatHud({
  beat,
  state,
  me,
  characterId,
  arena,
  arenaMons,
  npcTokens,
  consumables,
  combat,
  activeCombatant,
  relevantCombatants,
  hasTurnOrder,
  beatHasMonsters,
  activeTurnMonsterId,
  isMyCombatTurn,
  isLive,
  currentRound,
  maxRounds,
  isFinalRounds,
  maxAttacks,
  usedAttacks,
  attacksExhausted,
  movedDone,
  observeDone,
  effectiveMode,
  setBeatActionMode,
  selectedTokenId,
  aimCell,
  playerAttackAreaOverride,
  setPlayerAttackAreaOverride,
  playerAreaModOverride,
  setPlayerAreaModOverride,
  playerHealBuffChoice,
  buildChoicePayload,
  pendingReactionObj,
  pendingReact,
  affordableReactSpell,
  resolveBeatReaction,
  mapHint,
  setMapHint,
  latestStatus,
  onCellClick,
  onInteractNpc,
  onClose,
}: PlayerCombatHudProps) {
  const { sendAction, pushLocalToast, requestAttackRoll, setPendingConsumableUse, setActivePromptModal } = useVtt();
  const [sheet, setSheet] = useState<ActiveSheet>('none');
  const [infoTab, setInfoTab] = useState<InfoTab>('monsters');
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(null);
  const [pendingSpellConfirm, setPendingSpellConfirm] = useState<{ spell: Spell; targetMonTok: MapToken | null } | null>(null);
  const mapScrollRef = useRef<HTMLDivElement | null>(null);
  const [fitCellPx, setFitCellPx] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number>(DEFAULT_PLAYER_ZOOM);
  const zoomRef = useRef<number>(DEFAULT_PLAYER_ZOOM);
  zoomRef.current = zoom;
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const suppressClickUntilRef = useRef<number>(0);

  const applyZoom = useCallback((nextRaw: number, focalClientX?: number, focalClientY?: number) => {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(nextRaw.toFixed(3))));
    const prevZoom = zoomRef.current;
    if (Math.abs(nextZoom - prevZoom) < 0.005) return;
    const el = mapScrollRef.current;
    let targetLeft = 0;
    let targetTop = 0;
    if (el) {
      const rect = el.getBoundingClientRect();
      const focalX = focalClientX !== undefined ? focalClientX - rect.left : el.clientWidth / 2;
      const focalY = focalClientY !== undefined ? focalClientY - rect.top : el.clientHeight / 2;
      const ratio = nextZoom / prevZoom;
      targetLeft = Math.max(0, (el.scrollLeft + focalX) * ratio - focalX);
      targetTop = Math.max(0, (el.scrollTop + focalY) * ratio - focalY);
    }
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    if (el) {
      window.requestAnimationFrame(() => {
        el.scrollLeft = targetLeft;
        el.scrollTop = targetTop;
      });
    }
  }, []);

  useEffect(() => {
    const el = mapScrollRef.current;
    if (!el) return;
    let pinchStartDist = 0;
    let pinchStartZoom = DEFAULT_PLAYER_ZOOM;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        pinchStartZoom = zoomRef.current;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault();
        const curDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        applyZoom(pinchStartZoom * (curDist / pinchStartDist), midX, midY);
        suppressClickUntilRef.current = Date.now() + 250;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchStartDist = 0;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        applyZoom(zoomRef.current * factor, e.clientX, e.clientY);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, [applyZoom]);

  const handleMapMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = mapScrollRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = el.scrollLeft;
    const startTop = el.scrollTop;
    let moved = false;

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 6) {
        moved = true;
        setIsDraggingMap(true);
      }
      if (moved) {
        el.scrollLeft = startLeft - dx;
        el.scrollTop = startTop - dy;
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (moved) {
        setIsDraggingMap(false);
        suppressClickUntilRef.current = Date.now() + 200;
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  useEffect(() => {
    const el = mapScrollRef.current;
    if (!el) return;
    const cols = Math.max(1, Number(arena.cols || 20));
    const rows = Math.max(1, Number(arena.rows || 20));
    const updateFit = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      const availW = Math.max(120, el.clientWidth - 16);
      const availH = Math.max(120, el.clientHeight - 16);
      const rawCell = Math.floor(Math.min(availW / cols, availH / rows));
      const clamped = Math.max(16, Math.min(36, rawCell));
      setFitCellPx((prev) => (prev === clamped ? prev : clamped));
    };
    updateFit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateFit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [arena.cols, arena.rows]);

  const hpPct = me.maxHp ? Math.max(0, Math.min(100, (me.hp / me.maxHp) * 100)) : 0;
  const mpPct = me.maxMp ? Math.max(0, Math.min(100, (me.mp / me.maxMp) * 100)) : 0;
  const xpTarget = me.xpToNext || (me.level || 1) * 100;
  const xpPct = Math.max(0, Math.min(100, ((me.xp || 0) / xpTarget) * 100));

  const myTok = (arena.tokens || []).find((t) => t.id === characterId);
  const usedConsumableThisTurn = Boolean(myTok?.hasUsedConsumableThisTurn && beatHasMonsters);
  const hasCastSpellThisTurn = Boolean(myTok?.hasCastSpellThisTurn && beatHasMonsters);
  const hasAttackedThisTurn = usedAttacks > 0 && beatHasMonsters;
  const spellsLockedThisTurn = hasAttackedThisTurn || hasCastSpellThisTurn;
  const nonBasicSkills = (me.skills || []).filter((sk) => sk.name.trim().toLowerCase() !== 'basic combat');
  const spellsAndSkillsCount = (me.spells || []).length + nonBasicSkills.length;
  const activeFocusUnitId = hasTurnOrder && activeCombatant?.id ? activeCombatant.id : characterId;
  const initialFitReady = fitCellPx !== null;
  const centerTriggerKey = `${beat.id}-${initialFitReady ? 'fit' : 'init'}-${combat.round || 1}-${combat.turnIndex || 0}-${activeFocusUnitId}-${isMyCombatTurn ? 'mine' : 'other'}`;
  const activePrompts = (beat.prompts || []).filter((pr) => pr.target === 'all' || pr.target === characterId);
  const unansweredPromptCount = activePrompts.filter(
    (pr) => !(pr.answers || []).some((a) => a.characterId === characterId),
  ).length;

  const [statusBanner, setStatusBanner] = useState<{ title: string; message: string; tagClass: string } | null>(null);
  const [statusPhase, setStatusPhase] = useState<'hidden' | 'visible' | 'fading'>('hidden');
  const statusTimersRef = useRef<{ fade?: number; hide?: number }>({});
  const lastStatusKeyRef = useRef<string | null>(
    latestStatus ? `${latestStatus.timestamp}|${latestStatus.title}|${latestStatus.message}` : null,
  );
  const lastHintRef = useRef<string>(mapHint);

  const showTransientStatus = useCallback((title: string, message: string, tagClass: string) => {
    if (statusTimersRef.current.fade) window.clearTimeout(statusTimersRef.current.fade);
    if (statusTimersRef.current.hide) window.clearTimeout(statusTimersRef.current.hide);
    setStatusBanner({ title, message, tagClass });
    setStatusPhase('visible');
    statusTimersRef.current.fade = window.setTimeout(() => {
      setStatusPhase('fading');
    }, 3000);
    statusTimersRef.current.hide = window.setTimeout(() => {
      setStatusPhase('hidden');
    }, 4200);
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimersRef.current.fade) window.clearTimeout(statusTimersRef.current.fade);
      if (statusTimersRef.current.hide) window.clearTimeout(statusTimersRef.current.hide);
    };
  }, []);

  useEffect(() => {
    if (!latestStatus) return;
    const key = `${latestStatus.timestamp}|${latestStatus.title}|${latestStatus.message}`;
    if (key === lastStatusKeyRef.current) return;
    lastStatusKeyRef.current = key;
    const cls =
      latestStatus.category === 'combat'
        ? 'tag-crimson'
        : latestStatus.category === 'warning'
          ? 'tag-gold'
          : latestStatus.category === 'loot'
            ? 'tag-green'
            : 'tag-cyan';
    showTransientStatus(latestStatus.title || 'SYSTEM NOTICE', latestStatus.message, cls);
  }, [latestStatus, showTransientStatus]);

  useEffect(() => {
    if (mapHint === lastHintRef.current) return;
    lastHintRef.current = mapHint;
    const modeTitle = effectiveMode === 'attack' ? 'ATTACK' : effectiveMode === 'observe' ? 'OBSERVE' : 'MOVE';
    showTransientStatus(modeTitle, mapHint, 'tag-cyan');
  }, [effectiveMode, mapHint, showTransientStatus]);

  const effectiveCellPx = fitCellPx ? Math.max(14, Math.min(72, Math.round(fitCellPx * zoom))) : null;

  const handleGuardedCellClick = (x: number, y: number) => {
    if (Date.now() < suppressClickUntilRef.current) return;
    if (effectiveMode === 'spell' && selectedSpell) {
      if (!isMyCombatTurn) {
        showTransientStatus('WAIT TURN', `It is currently ${activeCombatant?.name || 'another unit'}'s turn.`, 'tag-gold');
        return;
      }
      const hitMonTok = (arena.tokens || []).find((t) => t.type === 'monster' && t.x === x && t.y === y);
      const canSelfCast =
        Boolean(selectedSpell.healFormula) ||
        selectedSpell.effectSpec?.target === 'self' ||
        selectedSpell.effectSpec?.target === 'all_allies';
      if (hitMonTok) {
        const range = Math.max(1, Number(selectedSpell.rangeSpaces || 3));
        const dist = myTok ? spaceDistanceBetweenPoints(myTok.x, myTok.y, x, y) : 1;
        if (dist > range) {
          showTransientStatus(
            'OUT OF RANGE',
            `${selectedSpell.name} reaches ${range} Spaces (target is ${dist} Spaces away).`,
            'tag-gold',
          );
          return;
        }
        setPendingSpellConfirm({ spell: selectedSpell, targetMonTok: hitMonTok });
        return;
      }
      if (canSelfCast && myTok && myTok.x === x && myTok.y === y) {
        setPendingSpellConfirm({ spell: selectedSpell, targetMonTok: null });
        return;
      }
      showTransientStatus(
        'SELECT TARGET',
        `Tap a monster in ${selectedSpell.name}'s range${canSelfCast ? ' (or your own token)' : ''}.`,
        'tag-cyan',
      );
      return;
    }
    onCellClick(x, y);
  };

  const toggleSheet = (next: ActiveSheet) => {
    setSheet((cur) => (cur === next ? 'none' : next));
  };

  return (
    <section id="beat-detail-view" className="view active pcombat-shell">
      {/* TOP HUD: Compact header + HP / MP / EXP bars */}
      <header className="pcombat-top">
        <div className="pcombat-header-row">
          <button
            type="button"
            id="btn-close-beat-detail"
            className="btn btn-xs btn-outline pcombat-back-btn"
            onClick={onClose}
          >
            &larr; Back
          </button>

          <div className="pcombat-title-wrap">
            <span id="beat-detail-title" className="pcombat-title">
              {beat.title}
            </span>
            <div className="pcombat-meta-pills">
              <span id="beat-detail-floor" className="tag tag-gold">
                {beat.floor}F
              </span>
              <span
                id="beat-detail-round-hud"
                className={`tag ${isFinalRounds ? 'tag-crimson' : 'tag-cyan'}`}
              >
                R{currentRound}/{maxRounds}
              </span>
              {hasTurnOrder && beatHasMonsters && (
                <span className={`tag ${isMyCombatTurn ? 'tag-green' : 'tag-crimson'}`}>
                  {isMyCombatTurn ? 'YOUR TURN' : `${activeCombatant?.name || 'Enemy'}`}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            id="btn-pcombat-info"
            className={`btn btn-xs ${sheet === 'info' ? 'btn-cyan' : 'btn-outline'} pcombat-info-btn`}
            onClick={() => toggleSheet('info')}
            aria-label="Battle Info"
          >
            <span>Info</span>
            {(arenaMons.length > 0 || unansweredPromptCount > 0) && (
              <span className="pcombat-info-badge">
                {unansweredPromptCount > 0 ? `!${unansweredPromptCount}` : arenaMons.length}
              </span>
            )}
          </button>
        </div>

        <div className="pcombat-vitals">
          <div className="pcombat-char-row">
            <strong className="pcombat-char-name">{me.name}</strong>
            <span className="tag tag-cyan">Lv {me.level || 1}</span>
            {(me.activeEffects || []).slice(0, 3).map((eff) => (
              <span
                key={eff.id}
                className={`tag ${eff.category === 'buff' ? 'tag-green' : 'tag-crimson'}`}
                style={{ fontSize: '0.62rem', padding: '1px 5px' }}
              >
                {formatActiveUnitEffect(eff)}
              </span>
            ))}
          </div>

          <div className="pcombat-bars">
            <div className="pcombat-bar-item">
              <div className="pcombat-bar-label">
                <span>HP</span>
                <b>
                  {me.hp}/{me.maxHp}
                </b>
              </div>
              <SegmentedBar
                pct={hpPct}
                maxValue={me.maxHp}
                kind="hp"
                trackClassName="pcombat-bar-track pcombat-bar-hp"
                fillKind="hp"
                critical={hpPct > 0 && hpPct <= 20}
              />
            </div>

            <div className="pcombat-bar-item">
              <div className="pcombat-bar-label">
                <span>MP</span>
                <b>
                  {me.mp}/{me.maxMp}
                </b>
              </div>
              <SegmentedBar
                pct={mpPct}
                maxValue={me.maxMp}
                kind="mp"
                trackClassName="pcombat-bar-track pcombat-bar-mp"
                fillKind="mp"
              />
            </div>

            <div className="pcombat-bar-item">
              <div className="pcombat-bar-label">
                <span>EXP</span>
                <b>
                  {me.xp || 0}/{xpTarget}
                </b>
              </div>
              <SegmentedBar
                pct={xpPct}
                maxValue={xpTarget}
                kind="xp"
                trackClassName="pcombat-bar-track pcombat-bar-xp"
                fillKind="xp"
              />
            </div>
          </div>
        </div>

        {!isLive && (
          <div className="alert-banner warning pcombat-compact-banner">
            <strong>PAUSED</strong>
            <span>{state.session?.pausedMessage || 'Waiting for DM...'}</span>
          </div>
        )}

        {pendingReactionObj && (
          <div id="beat-reaction-banner" className="reaction-banner pcombat-compact-banner">
            <div className="reaction-info">
              <span className="tag tag-crimson">REACTION</span>
              <span>
                <strong>{pendingReactionObj.monsterName}</strong> ({pendingReactionObj.attackTotal} hit,{' '}
                {pendingReactionObj.incomingDamage} dmg)
              </span>
            </div>
            <div className="reaction-actions">
              <button type="button" className="btn btn-xs btn-crimson" onClick={() => resolveBeatReaction('counter')}>
                Counter
              </button>
              <button type="button" className="btn btn-xs btn-cyan" onClick={() => resolveBeatReaction('parry')}>
                Parry
              </button>
              <button
                type="button"
                className="btn btn-xs btn-purple"
                disabled={!affordableReactSpell}
                onClick={() => resolveBeatReaction('spell')}
              >
                Spell
              </button>
              <button type="button" className="btn btn-xs btn-outline" onClick={() => resolveBeatReaction('accept')}>
                Take Hit
              </button>
            </div>
          </div>
        )}

        {beat.status === 'failed' && (
          <div id="beat-detail-defeat-banner" className="pcombat-compact-banner pcombat-defeat-banner">
            <strong>BATTLE LOST ({beat.defeatSummary?.maxRounds || maxRounds} Rounds)</strong>
          </div>
        )}
      </header>

      {/* CENTER STAGE: Full-bleed pannable Arena Map + floating status & turn pill */}
      <main className="pcombat-map-stage">
        {statusBanner && statusPhase !== 'hidden' && (
          <div id="beat-detail-status-strip" className={`pcombat-floating-status is-${statusPhase}`}>
            <span className={`tag ${statusBanner.tagClass}`} style={{ flexShrink: 0 }}>
              {statusBanner.title}
            </span>
            <span className="pcombat-floating-status-msg">{statusBanner.message}</span>
          </div>
        )}

        <div
          ref={mapScrollRef}
          className={`pcombat-map-scroll${isDraggingMap ? ' is-dragging' : ''}`}
          onMouseDown={handleMapMouseDown}
        >
          <div className="pcombat-map-inner">
            <BeatArenaCanvas
              id="beat-detail-canvas"
              beat={beat}
              variant="detail"
              cellPxOverride={effectiveCellPx}
              selectedTokenId={selectedTokenId ?? characterId}
              beatActionMode={effectiveMode}
              previewAimCell={aimCell}
              previewAttackArea={playerAttackAreaOverride ?? me?.equipment?.mainHand?.attackArea ?? 'single'}
              previewAttackAreaModifier={playerAreaModOverride ?? me?.equipment?.mainHand?.attackAreaModifier ?? 0}
              previewSpell={selectedSpell}
              centerOnCharacterId={activeFocusUnitId}
              centerTriggerKey={centerTriggerKey}
              hideAxisLabels={true}
              onCellClick={handleGuardedCellClick}
            />
          </div>
        </div>

        {effectiveMode === 'spell' && selectedSpell && (
          <div className="pcombat-spell-aim-bar">
            <span className="tag tag-purple" style={{ flexShrink: 0 }}>
              {selectedSpell.name} ({selectedSpell.mpCost} MP)
            </span>
            <span className="small" style={{ color: '#e2e8f0', flex: 1, minWidth: 0 }}>
              Tap target in purple range
            </span>
            {(Boolean(selectedSpell.healFormula) ||
              selectedSpell.effectSpec?.target === 'self' ||
              selectedSpell.effectSpec?.target === 'all_allies') && (
              <button
                type="button"
                className="btn btn-xs btn-green"
                onClick={() => setPendingSpellConfirm({ spell: selectedSpell, targetMonTok: null })}
              >
                Self
              </button>
            )}
            <button
              type="button"
              className="btn btn-xs btn-outline"
              onClick={() => {
                setSelectedSpell(null);
                setBeatActionMode('move');
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Floating Zoom Controls */}
        <div className="pcombat-zoom-controls" aria-label="Map Zoom Controls">
          <button
            type="button"
            className="pcombat-zoom-btn"
            aria-label="Zoom Out"
            disabled={zoom <= MIN_ZOOM + 0.01}
            onClick={() => applyZoom(zoom - 0.25)}
          >
            &minus;
          </button>
          <button
            type="button"
            className="pcombat-zoom-btn pcombat-zoom-pct"
            aria-label="Reset Map Zoom"
            title="Tap to reset zoom (150% / 100%)"
            onClick={() => applyZoom(Math.abs(zoom - DEFAULT_PLAYER_ZOOM) < 0.05 ? 1 : DEFAULT_PLAYER_ZOOM)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="pcombat-zoom-btn"
            aria-label="Zoom In"
            disabled={zoom >= MAX_ZOOM - 0.01}
            onClick={() => applyZoom(zoom + 0.25)}
          >
            +
          </button>
        </div>

        {/* Floating End Turn / AI Turn action */}
        <div className="pcombat-endturn-wrap">
          {beat.aiDmEnabled && activeCombatant?.type === 'monster' && !pendingReactionObj ? (
            <button
              type="button"
              id="btn-beat-run-ai-dm"
              className="btn btn-sm btn-purple pcombat-endturn-fab"
              onClick={() => sendAction('initiative_action', { subAction: 'run_ai_dm' })}
            >
              Run AI Turn
            </button>
          ) : (
            <button
              type="button"
              id="btn-beat-end-turn"
              className={`btn btn-sm ${isMyCombatTurn ? 'btn-gold' : 'btn-outline'} pcombat-endturn-fab`}
              disabled={!isMyCombatTurn}
              onClick={async () => {
                setSheet('none');
                setSelectedSpell(null);
                await sendAction('initiative_action', { subAction: 'end_turn', characterId });
                pushLocalToast({ title: 'TURN ENDED', message: 'Passed turn to the next combatant.', category: 'info' });
              }}
            >
              {isMyCombatTurn ? 'End Turn' : `Wait (${activeCombatant?.name || 'Turn'})`}
            </button>
          )}
        </div>

        {/* SLIDE-UP SHEETS ABOVE BOTTOM DOCK */}
        {sheet !== 'none' && (
          <div className="pcombat-sheet-backdrop" onClick={() => setSheet('none')}>
            <div className="pcombat-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="pcombat-sheet-head">
                <div className="pcombat-sheet-handle" />
                <div className="pcombat-sheet-title-row">
                  <strong>
                    {sheet === 'spells'
                      ? 'Spells & Combat Skills'
                      : sheet === 'items'
                        ? 'Consumable Items'
                        : 'Battle Info & Scene'}
                  </strong>
                  <button
                    type="button"
                    className="btn btn-xs btn-outline"
                    onClick={() => setSheet('none')}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="pcombat-sheet-body">
                {sheet === 'spells' && (
                  <div className="stack-form" style={{ gap: '10px' }}>
                    <div id="beat-detail-spells" className="list-stack">
                      {(me.spells || []).length > 0 ? (
                        me.spells.map((sp) => {
                          const elName = normalizeSpellElement(sp.element || sp.damageType);
                          const isReaction = sp.actionType === 'Reaction';
                          return (
                            <div key={sp.id} className="item-card">
                              <div className="item-card-top">
                                <strong>
                                  {sp.name}{' '}
                                  <span className={`tag tag-el-${elName.toLowerCase()}`}>{elName}</span>
                                  {isReaction && <span className="tag tag-purple">Reaction</span>}
                                </strong>
                                <span className="tag tag-cyan">
                                  {sp.damageDice} • {sp.mpCost} MP
                                </span>
                              </div>
                              <div className="btn-row mt-xs" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: '8px' }}>
                                <div className="btn-row" style={{ flexWrap: 'wrap', gap: '4px', flex: 1, minWidth: 0 }}>
                                  <span className="muted small">{sp.rangeSpaces} Sp</span>
                                  {sp.healFormula && <span className="tag tag-green">Heal {sp.healFormula}</span>}
                                  {sp.effectSpec && (
                                    <span
                                      className={`tag ${
                                        UNIT_EFFECT_META[sp.effectSpec.kind]?.category === 'buff'
                                          ? 'tag-green'
                                          : 'tag-crimson'
                                      }`}
                                    >
                                      {formatUnitEffectSpec(sp.effectSpec)}
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-xs btn-crimson"
                                  style={{ flexShrink: 0 }}
                                  disabled={isReaction ? !pendingReact : (!isMyCombatTurn || spellsLockedThisTurn || Number(me.mp || 0) < Number(sp.mpCost || 0))}
                                  onClick={async () => {
                                    setSheet('none');
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
                                    setSelectedSpell(sp);
                                    setBeatActionMode('spell');
                                    setMapHint(`Spell aim: Tap a target within ${sp.rangeSpaces} Spaces to cast ${sp.name}.`);
                                  }}
                                >
                                  {isReaction ? 'Reaction Cast' : Number(me.mp || 0) < Number(sp.mpCost || 0) ? 'Low MP' : 'Select'}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="item-card small muted">No spells learned yet.</div>
                      )}
                    </div>

                    {nonBasicSkills.length > 0 && (
                      <div id="beat-detail-player-skill-tray" className="list-stack">
                        <div className="small muted" style={{ fontWeight: 700 }}>
                          COMBAT SKILLS
                        </div>
                        {nonBasicSkills.map((sk, idx) => {
                          const skArea: AttackArea =
                            sk.attackArea || playerAttackAreaOverride || me.equipment?.mainHand?.attackArea || 'single';
                          const skMod =
                            sk.attackAreaModifier ?? playerAreaModOverride ?? me.equipment?.mainHand?.attackAreaModifier ?? 0;
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
                                  disabled={!isMyCombatTurn || attacksExhausted || arenaMons.length === 0}
                                  onClick={async () => {
                                    const targetMonTok = arenaMons[0];
                                    if (!targetMonTok) return;
                                    setSheet('none');
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
                        })}
                      </div>
                    )}
                  </div>
                )}

                {sheet === 'items' && (
                  <div id="beat-detail-item-tray" className="list-stack">
                    {consumables.length > 0 ? (
                      consumables.map((it) => (
                        <div key={it.id} className="item-card">
                          <div className="item-card-top">
                            <strong>
                              {it.name} <span className="tag tag-cyan">×{it.qty || 1}</span>
                            </strong>
                            <button
                              type="button"
                              className="btn btn-xs btn-gold"
                              disabled={!isMyCombatTurn || usedConsumableThisTurn}
                              onClick={() => {
                                setSheet('none');
                                setPendingConsumableUse({ characterId, item: it });
                              }}
                            >
                              {usedConsumableThisTurn ? 'Used (Wait Turn)' : 'Use'}
                            </button>
                          </div>
                          {it.notes && <div className="small muted">{it.notes}</div>}
                        </div>
                      ))
                    ) : (
                      <div className="item-card small muted">No consumable items in your bag.</div>
                    )}
                  </div>
                )}

                {sheet === 'info' && (
                  <div className="stack-form" style={{ gap: '10px' }}>
                    <div className="pcombat-info-tabs">
                      {(['monsters', 'turns', 'feed', 'scene'] as InfoTab[]).map((tabKey) => (
                        <button
                          key={tabKey}
                          type="button"
                          className={`btn btn-xs ${infoTab === tabKey ? 'btn-cyan' : 'btn-outline'}`}
                          onClick={() => setInfoTab(tabKey)}
                        >
                          {tabKey === 'monsters'
                            ? `Monsters (${arenaMons.length})`
                            : tabKey === 'turns'
                              ? 'Turns'
                              : tabKey === 'feed'
                                ? 'Feed'
                                : `Scene${unansweredPromptCount > 0 ? ` (!${unansweredPromptCount})` : ''}`}
                        </button>
                      ))}
                    </div>

                    {infoTab === 'monsters' && (
                      <div id="beat-detail-monsters" className="list-stack">
                        {arenaMons.length > 0 ? (
                          arenaMons.map((tok) => {
                            const liveMon = (state.monsters || []).find((m) => m.id === tok.id);
                            const isObserved = Boolean(liveMon?.observedByViewer);
                            const hp = isObserved && liveMon ? liveMon.hp : null;
                            const maxHp = isObserved && liveMon ? liveMon.maxHp : null;
                            const pct = maxHp && hp !== null ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
                            const isActiveMonTurn = activeTurnMonsterId === tok.id;
                            return (
                              <div key={tok.id} className={`item-card ${isActiveMonTurn ? 'card-glow-crimson' : ''}`}>
                                <div className="item-card-top">
                                  <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <TokenIconSvg type="monster" name={tok.name} iconId={liveMon?.iconId ?? tok.iconId} size={20} />
                                    {tok.name}
                                    {isActiveMonTurn && <span className="tag tag-gold">ACTIVE</span>}
                                    {isObserved && <span className="tag tag-cyan">OBSERVED</span>}
                                  </strong>
                                  <span>
                                    {isObserved && hp !== null && maxHp ? (
                                      `HP ${hp}/${maxHp}`
                                    ) : (
                                      <span className="tag tag-outline small muted">Unobserved</span>
                                    )}
                                  </span>
                                </div>
                                {isObserved && liveMon && (
                                  <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                                    <span className="tag tag-outline small">AC {liveMon.ac}</span>
                                    <span className="tag tag-outline small">DR {liveMon.dr}</span>
                                    {liveMon.attackFormula && (
                                      <span className="tag tag-outline small">Atk {liveMon.attackFormula}</span>
                                    )}
                                    {liveMon.damageFormula && (
                                      <span className="tag tag-outline small">Dmg {liveMon.damageFormula}</span>
                                    )}
                                  </div>
                                )}
                                {liveMon && (liveMon.activeEffects || []).length > 0 && (
                                  <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                                    {(liveMon.activeEffects || []).map((eff) => (
                                      <span
                                        key={eff.id}
                                        className={`tag ${eff.category === 'buff' ? 'tag-green' : 'tag-crimson'}`}
                                      >
                                        {formatActiveUnitEffect(eff)}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {isObserved && maxHp ? (
                                  <SegmentedBar
                                    pct={pct}
                                    maxValue={maxHp}
                                    ticks={liveMon?.hpBarTicks}
                                    kind="monster"
                                    trackClassName="progress mt-xs"
                                    fillKind="monster"
                                  />
                                ) : null}
                              </div>
                            );
                          })
                        ) : (
                          <div className="item-card small muted">No active monsters on the map.</div>
                        )}
                      </div>
                    )}

                    {infoTab === 'turns' && (
                      <div id="beat-detail-initiative-list" className="list-stack">
                        <div className="btn-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="small muted">
                            Round {currentRound} / {maxRounds || DEFAULT_COMBAT_MAX_ROUNDS}
                          </span>
                          <button
                            type="button"
                            id="btn-beat-init-roll-self"
                            className="btn btn-xs btn-cyan"
                            onClick={() =>
                              sendAction('initiative_action', { subAction: 'player_roll_initiative', characterId })
                            }
                          >
                            Roll Initiative
                          </button>
                        </div>
                        {relevantCombatants.length > 0 ? (
                          relevantCombatants.map((c) => {
                            const isCurrent = activeCombatant && activeCombatant.id === c.id;
                            return (
                              <div key={c.id} className={`item-card ${isCurrent ? 'card-glow-cyan' : ''}`}>
                                <div className="item-card-top">
                                  <strong>
                                    {c.name}{' '}
                                    {c.type === 'monster' ? (
                                      <span className="tag tag-crimson">MONSTER</span>
                                    ) : c.id === characterId ? (
                                      <span className="tag tag-gold">YOU</span>
                                    ) : (
                                      <span className="tag tag-cyan">ALLY</span>
                                    )}
                                    {isCurrent && <span className="tag tag-gold">TURN</span>}
                                  </strong>
                                  <span className="small">Init: {c.initiative ?? '—'}</span>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="item-card small muted">No combatants in initiative order yet.</div>
                        )}
                      </div>
                    )}

                    {infoTab === 'feed' && (
                      <div className="list-stack">
                        {(state.combatLog || []).length > 0 ? (
                          (state.combatLog || []).slice(0, 15).map((entry) => (
                            <div key={entry.id} className="item-card small">
                              {entry.summary}
                            </div>
                          ))
                        ) : (
                          <div className="item-card small muted">No combat events yet.</div>
                        )}
                      </div>
                    )}

                    {infoTab === 'scene' && (
                      <div className="list-stack">
                        {beat.narration && (
                          <div id="beat-detail-narration" className="story-narration">
                            {beat.narration}
                          </div>
                        )}
                        {activePrompts.map((pr) => {
                          const answered = (pr.answers || []).some((a) => a.characterId === characterId);
                          return (
                            <div key={pr.id} className="item-card">
                              <div className="item-card-top">
                                <strong>{pr.question}</strong>
                                <button
                                  type="button"
                                  className="btn btn-xs btn-gold"
                                  onClick={() => {
                                    setSheet('none');
                                    setActivePromptModal({ beatId: beat.id, promptId: pr.id });
                                  }}
                                >
                                  {answered ? 'View' : 'Answer'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {npcTokens.map((n) => {
                          const hasUnclaimedGift =
                            !n.rewardClaimed &&
                            ((Boolean(n.rewardType) && n.rewardType !== 'none') || Number(n.rewardGold || 0) > 0);
                          const reach = myTok
                            ? findClosestNpcInteractCell({
                                arena,
                                myTok,
                                npcTok: n,
                                me,
                                combatRound: currentRound,
                                beatFloor: beat.floor || 1,
                              })
                            : null;
                          const canTalkNow = reach?.status === 'adjacent';
                          const canMoveAndTalk = reach?.status === 'reachable' && isMyCombatTurn && !movedDone;
                          return (
                            <div key={n.id} className="item-card small">
                              <div className="item-card-top" style={{ alignItems: 'center', gap: '8px' }}>
                                <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0, flexWrap: 'wrap' }}>
                                  <TokenIconSvg type="npc" name={n.name} iconId={n.iconId} size={22} />
                                  <span>{n.name}</span>
                                  <span className="tag tag-green">{n.npcRole || 'NPC'}</span>
                                  {hasUnclaimedGift && <span className="tag tag-gold">Gift</span>}
                                  {reach && (
                                    <span className={`tag ${canTalkNow ? 'tag-green' : 'tag-outline muted'}`}>
                                      {canTalkNow ? 'Adjacent' : `${reach.directDist} Sp`}
                                    </span>
                                  )}
                                </strong>
                                <button
                                  type="button"
                                  className={`btn btn-xs ${canTalkNow ? 'btn-green' : canMoveAndTalk ? 'btn-cyan' : 'btn-outline'}`}
                                  disabled={!canTalkNow && !canMoveAndTalk}
                                  onClick={() => {
                                    setSheet('none');
                                    onInteractNpc(n);
                                  }}
                                >
                                  {canTalkNow ? 'Talk' : canMoveAndTalk ? 'Move & Talk' : 'Too Far'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* BOTTOM ACTION DOCK: Move, Attack, Spells, Observe, Items */}
      <nav id="beat-detail-action-bar" className="pcombat-dock" aria-label="Combat Actions">
        <button
          type="button"
          className={`pcombat-dock-btn is-cyan ${effectiveMode === 'move' && sheet === 'none' ? 'is-active' : ''}`}
          disabled={!isMyCombatTurn || movedDone}
          onClick={() => {
            setSheet('none');
            setSelectedSpell(null);
            setBeatActionMode('move');
            setMapHint('Move mode: Tap a highlighted space on the map to move.');
          }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="m13 6 6 6-6 6" />
          </svg>
          <span>{movedDone ? 'Moved' : 'Move'}</span>
        </button>

        <button
          type="button"
          className={`pcombat-dock-btn is-crimson ${effectiveMode === 'attack' && sheet === 'none' ? 'is-active' : ''}`}
          disabled={!isMyCombatTurn || attacksExhausted || hasCastSpellThisTurn}
          onClick={() => {
            setSheet('none');
            setSelectedSpell(null);
            setBeatActionMode('attack');
            setMapHint('Attack mode: Tap a monster on the map to strike.');
          }}
        >
          {maxAttacks > 1 && !attacksExhausted && !hasCastSpellThisTurn && (
            <span className="pcombat-dock-badge">{maxAttacks - usedAttacks}</span>
          )}
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
            <path d="M13 19l6-6" />
            <path d="M16 16l4 4" />
            <path d="M19 21l2-2" />
          </svg>
          <span>{hasCastSpellThisTurn ? 'Spell Used' : attacksExhausted ? 'Attacked' : 'Attack'}</span>
        </button>

        <button
          type="button"
          className={`pcombat-dock-btn is-purple ${sheet === 'spells' || effectiveMode === 'spell' ? 'is-active' : ''}`}
          disabled={!pendingReact && (!isMyCombatTurn || spellsLockedThisTurn)}
          onClick={() => toggleSheet('spells')}
        >
          {spellsAndSkillsCount > 0 && <span className="pcombat-dock-badge">{spellsAndSkillsCount}</span>}
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
          </svg>
          <span>Spells</span>
        </button>

        <button
          type="button"
          className={`pcombat-dock-btn is-sky ${effectiveMode === 'observe' && sheet === 'none' ? 'is-active' : ''}`}
          disabled={!isMyCombatTurn || observeDone}
          onClick={() => {
            setSheet('none');
            setSelectedSpell(null);
            setBeatActionMode('observe');
            setMapHint('Observe mode: Tap a monster, NPC, or chest within 3 spaces.');
          }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>{observeDone ? 'Observed' : 'Observe'}</span>
        </button>

        <button
          type="button"
          className={`pcombat-dock-btn is-gold ${sheet === 'items' ? 'is-active' : ''}`}
          onClick={() => toggleSheet('items')}
        >
          {consumables.length > 0 && <span className="pcombat-dock-badge">{consumables.length}</span>}
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 2v7.31" />
            <path d="M14 9.31V2" />
            <path d="M8.5 2h7" />
            <path d="M14 9.3a6.5 6.5 0 1 1-4 0" />
            <path d="M5.52 16h12.96" />
          </svg>
          <span>Items</span>
        </button>
      </nav>

      {pendingSpellConfirm && (
        <div
          id="spell-confirm-modal"
          className="modal-backdrop"
          style={{ zIndex: 9050 }}
          onClick={() => setPendingSpellConfirm(null)}
        >
          <div
            className="modal-card"
            style={{ maxWidth: '420px', border: '1.5px solid rgba(168, 85, 247, 0.7)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-header">
              <div>
                <div className="badge-tower mb-xs" style={{ color: '#c084fc' }}>
                  CONFIRM SPELL CAST
                </div>
                <h3 style={{ margin: 0 }}>{pendingSpellConfirm.spell.name}</h3>
              </div>
              <button
                type="button"
                className="btn btn-xs btn-outline"
                onClick={() => setPendingSpellConfirm(null)}
              >
                &times;
              </button>
            </div>
            <div className="stack-form mt-xs">
              <div className="item-card">
                <div className="item-card-top">
                  <span>Target</span>
                  <strong>{pendingSpellConfirm.targetMonTok ? pendingSpellConfirm.targetMonTok.name : `${me.name} (Self)`}</strong>
                </div>
                <div className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '4px' }}>
                  <span className={`tag tag-el-${normalizeSpellElement(pendingSpellConfirm.spell.element || pendingSpellConfirm.spell.damageType).toLowerCase()}`}>
                    {normalizeSpellElement(pendingSpellConfirm.spell.element || pendingSpellConfirm.spell.damageType)}
                  </span>
                  {pendingSpellConfirm.spell.damageDice && (
                    <span className="tag tag-crimson">{pendingSpellConfirm.spell.damageDice}</span>
                  )}
                  {pendingSpellConfirm.spell.healFormula && (
                    <span className="tag tag-green">Heal {pendingSpellConfirm.spell.healFormula}</span>
                  )}
                  {pendingSpellConfirm.spell.effectSpec && (
                    <span className="tag tag-purple">{formatUnitEffectSpec(pendingSpellConfirm.spell.effectSpec)}</span>
                  )}
                </div>
              </div>
              <div className="item-card">
                <div className="bar-row small">
                  <span>Mana (MP)</span>
                  <b>
                    {me.mp}/{me.maxMp} &rarr; {Math.max(0, Number(me.mp || 0) - Number(pendingSpellConfirm.spell.mpCost || 0))}/{me.maxMp} MP
                  </b>
                </div>
                <SegmentedBar
                  pct={
                    me.maxMp
                      ? Math.max(
                          0,
                          Math.min(
                            100,
                            (Math.max(0, Number(me.mp || 0) - Number(pendingSpellConfirm.spell.mpCost || 0)) /
                              me.maxMp) *
                              100,
                          ),
                        )
                      : 0
                  }
                  maxValue={me.maxMp}
                  kind="mp"
                  trackClassName="progress mt-xs"
                  fillKind="mp"
                />
              </div>
              <div className="btn-row" style={{ justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => setPendingSpellConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="btn-confirm-spell-cast"
                  className="btn btn-sm btn-purple"
                  onClick={async () => {
                    const { spell, targetMonTok } = pendingSpellConfirm;
                    setPendingSpellConfirm(null);
                    setSelectedSpell(null);
                    setBeatActionMode('move');
                    const fallbackTok = targetMonTok || myTok;
                    if (!fallbackTok) return;
                    await requestAttackRoll({
                      monTok: fallbackTok,
                      me,
                      wep: me.equipment?.mainHand || null,
                      beatId: beat.id,
                      attackArea: spell.attackArea || playerAttackAreaOverride || 'single',
                      attackAreaModifier: spell.attackAreaModifier ?? playerAreaModOverride ?? 0,
                      spell,
                      isSelfSpell: !targetMonTok,
                    });
                  }}
                >
                  Yes, Cast Spell
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
