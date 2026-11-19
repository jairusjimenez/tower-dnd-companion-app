import React, { useState } from 'react';
import {
  computeStatModifier,
  getMaxAttacksForFloor,
  normalizeSpellElement,
  type BeatEncounterSpec,
  type BeatTreasureSpec,
} from '@shared/index';
import type { BeatActionMode } from '../../canvas/drawBeatArena';
import { useVtt } from '../../context/VttContext';
import { BeatArenaCanvas, useBeatPlayerCellAction } from './BeatArenaCanvas';

export function BeatDetailView() {
  const {
    activeBeatDetailId,
    setActiveBeatDetailId,
    setActiveBeatMapId,
    session,
    state,
    sendAction,
    pushLocalToast,
  } = useVtt();

  const handlePlayerBeatCell = useBeatPlayerCellAction();

  const [beatActionMode, setBeatActionMode] = useState<BeatActionMode>('move');
  const [itemTrayOpen, setItemTrayOpen] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [mapHint, setMapHint] = useState('Tap a token or chest to interact.');

  // DM Edit Beat drawer state
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editFloor, setEditFloor] = useState(1);
  const [editXp, setEditXp] = useState(0);
  const [editGridSize, setEditGridSize] = useState('20');
  const [editStatus, setEditStatus] = useState('upcoming');
  const [editNarration, setEditNarration] = useState('');
  const [editSecret, setEditSecret] = useState('');
  const [editPresentNow, setEditPresentNow] = useState(false);
  const [editEncounters, setEditEncounters] = useState<BeatEncounterSpec[]>([]);
  const [editTreasures, setEditTreasures] = useState<BeatTreasureSpec[]>([]);

  // Staged inline add forms inside DM Beat Editor
  const [monName, setMonName] = useState('');
  const [monDmg, setMonDmg] = useState('2d6+3');
  const [monHp, setMonHp] = useState(35);
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

  // DM toast form
  const [toastTarget, setToastTarget] = useState('all');
  const [toastCat, setToastCat] = useState('info');
  const [toastMsg, setToastMsg] = useState('');

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

  const effectiveMode: BeatActionMode =
    (beatActionMode === 'attack' && attacksExhausted) || (beatActionMode === 'observe' && observeDone)
      ? 'move'
      : beatActionMode;

  const openEditDrawer = () => {
    setEditTitle(beat.title || '');
    setEditFloor(beat.floor || 1);
    setEditXp(beat.xpReward || 0);
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

  const handleArenaClick = async (x: number, y: number) => {
    if (!isDm && session.characterId) {
      const handled = await handlePlayerBeatCell({ beat, x, y, mode: effectiveMode });
      if (handled) return;
    }

    const clickedChest = (arena.chests || []).find((c) => c.x === x && c.y === y && !c.opened);
    const hitToken = (arena.tokens || []).find((t) => t.x === x && t.y === y);

    // For DM: selecting or moving a token takes priority over auto-opening a chest underneath
    if (isDm && selectedTokenId && !hitToken) {
      await sendAction('story_action', {
        subAction: 'move_beat_token',
        beatId: beat.id,
        tokenId: selectedTokenId,
        x,
        y,
      });
      return;
    }

    if (clickedChest && (!isDm || !selectedTokenId)) {
      await sendAction('story_action', {
        subAction: 'open_beat_chest',
        beatId: beat.id,
        chestId: clickedChest.id,
        characterId: session.characterId || null,
      });
      return;
    }

    const npcHit = hitToken && hitToken.type === 'npc' ? hitToken : undefined;
    if (npcHit && !isDm) {
      await sendAction('story_action', {
        subAction: 'talk_beat_npc',
        beatId: beat.id,
        tokenId: npcHit.id,
        characterId: session.characterId || null,
      });
      return;
    }

    if (isDm) {
      if (hitToken) {
        setSelectedTokenId(hitToken.id);
        setMapHint(`Selected ${hitToken.name}. Tap a destination space.`);
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
          <span id="beat-detail-status" className={`tag ${beat.presented ? 'tag-cyan' : 'tag-gold'}`}>
            {beat.presented ? 'PRESENTED' : String(beat.status || 'upcoming').toUpperCase()}
          </span>
          {Boolean(beat.xpReward) && (
            <span id="beat-detail-xp" className="tag tag-purple">+{beat.xpReward} XP</span>
          )}
        </div>
        <div className="topbar-right" style={{ gap: '8px' }}>
          {isDm && (
            <>
              <button type="button" id="btn-beat-detail-edit" className="btn btn-sm btn-gold" onClick={openEditDrawer}>
                Edit Beat
              </button>
              <button
                type="button"
                id="btn-beat-detail-open-map"
                className="btn btn-sm btn-cyan"
                onClick={() => setActiveBeatMapId(beat.id)}
              >
                Open Map Editor
              </button>
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

        {beat.narration && <div id="beat-detail-narration" className="story-narration">{beat.narration}</div>}
        {isDm && beat.dmSecret && (
          <div id="beat-detail-secret" className="story-secret mt-xs">
            <strong>DM Secret:</strong> {beat.dmSecret}
          </div>
        )}

        {isDm && editOpen && (
          <div id="beat-detail-edit-panel" className="panel mt-sm">
            <div className="panel-header">
              <h3>Edit Story Beat</h3>
              <button type="button" id="btn-cancel-beat-edit" className="btn btn-xs btn-outline" onClick={() => setEditOpen(false)}>
                Close Editor
              </button>
            </div>
            <form id="beat-edit-form" className="stack-form" onSubmit={handleSaveEdit}>
              <div className="grid-2">
                <label><span>Beat Title</span><input type="text" required value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></label>
                <label><span>Floor</span><input type="number" min={1} max={100} value={editFloor} onChange={(e) => setEditFloor(Number(e.target.value || 1))} /></label>
              </div>
              <div className="grid-3">
                <label><span>XP Reward</span><input type="number" min={0} value={editXp} onChange={(e) => setEditXp(Number(e.target.value || 0))} /></label>
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
                          <strong>{m.name}</strong>
                          <span>HP {m.maxHp} • AC {m.ac} • DR {m.dr}</span>
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
                  <div className="grid-2">
                    <label><span>Monster Name</span><input type="text" placeholder="e.g. Goblin Gatekeeper" value={monName} onChange={(e) => setMonName(e.target.value)} /></label>
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
                      setEditEncounters((prev) => [
                        ...prev,
                        { name: monName.trim(), maxHp: monHp, ac: monAc, dr: monDr, attackFormula: '1d20+5', damageFormula: monDmg || '2d6+3' },
                      ]);
                      setMonName('');
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
                  <div className="grid-2">
                    <label><span>Item Name</span><input type="text" placeholder="e.g. Gate Key Blade" value={trName} onChange={(e) => setTrName(e.target.value)} /></label>
                    <label>
                      <span>Category</span>
                      <select value={trCat} onChange={(e) => setTrCat(e.target.value)}>
                        <option value="relic">Relic</option>
                        <option value="weapon">Weapon</option>
                        <option value="armor">Armor</option>
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

              <div className="btn-row">
                <button type="submit" className="btn btn-gold btn-lg">Save Story Beat Changes</button>
              </div>
            </form>
          </div>
        )}

        <div className="beat-detail-grid mt-sm">
          <div className="panel beat-detail-map-col">
            <div className="panel-header">
              <h3>Real-Time Arena Map</h3>
              <span id="beat-detail-map-hint" className="muted small">{mapHint}</span>
            </div>

            {!isDm && session.characterId && (
              <div id="beat-detail-action-bar" className="btn-row mt-xs" style={{ flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                <button
                  type="button"
                  className={`btn btn-xs btn-crimson ${effectiveMode === 'attack' ? 'active' : ''}`}
                  disabled={attacksExhausted}
                  onClick={() => {
                    setBeatActionMode('attack');
                    setItemTrayOpen(false);
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
                  disabled={movedDone}
                  onClick={() => {
                    setBeatActionMode('move');
                    setItemTrayOpen(false);
                    setMapHint('Move mode: Tap any space on the map to move your character.');
                  }}
                >
                  {movedDone ? 'Moved (Wait Turn)' : 'Move'}
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-gold"
                  onClick={() => setItemTrayOpen((o) => !o)}
                >
                  Use Item
                </button>
                <button
                  type="button"
                  className={`btn btn-xs btn-outline ${effectiveMode === 'observe' ? 'active' : ''}`}
                  disabled={observeDone}
                  onClick={() => {
                    setBeatActionMode('observe');
                    setItemTrayOpen(false);
                    setMapHint('Observe mode: Tap a token, monster, NPC, or chest on the map to inspect it.');
                  }}
                >
                  {observeDone ? 'Observed (Wait Turn)' : 'Observe'}
                </button>
                <button
                  type="button"
                  id="btn-beat-end-turn"
                  className="btn btn-xs btn-outline"
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

            {!isDm && itemTrayOpen && (
              <div id="beat-detail-item-tray" className="list-stack" style={{ marginBottom: '8px' }}>
                {consumables.length > 0 ? (
                  consumables.map((it) => (
                    <div key={it.id} className="item-card">
                      <div className="item-card-top">
                        <strong>{it.name} <span className="tag tag-cyan">×{it.qty || 1}</span></strong>
                        <button
                          type="button"
                          className="btn btn-xs btn-cyan"
                          onClick={async () => {
                            await sendAction('inventory_action', {
                              characterId: session.characterId,
                              subAction: 'use_consumable',
                              itemId: it.id,
                            });
                            pushLocalToast({ title: 'ITEM USED', message: 'Consumable item applied!', category: 'info' });
                          }}
                        >
                          Use
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

            <div className="arena-scroll-wrap" style={{ maxHeight: '74vh' }}>
              <BeatArenaCanvas
                id="beat-detail-canvas"
                beat={beat}
                variant="detail"
                selectedTokenId={selectedTokenId ?? (!isDm ? session.characterId : null)}
                beatActionMode={effectiveMode}
                centerOnCharacterId={!isDm ? session.characterId : null}
                onCellClick={handleArenaClick}
              />
            </div>

            <div id="beat-detail-initiative-panel" className="mt-sm" style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <div className="panel-header">
                <div className="btn-row" style={{ alignItems: 'center' }}>
                  <h4 style={{ margin: 0 }}>Initiative &amp; Turn Order (Stat-Based)</h4>
                  <span id="beat-detail-round-pill" className="tag tag-gold">ROUND {combat.round || 1}</span>
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
                    <button
                      type="button"
                      id="btn-beat-init-roll-self"
                      className="btn btn-xs btn-cyan"
                      onClick={() => sendAction('initiative_action', { subAction: 'player_roll_initiative', characterId: session.characterId })}
                    >
                      Roll Initiative
                    </button>
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
                    return (
                      <div key={c.id} className={`item-card ${isCurrent ? 'card-glow-cyan' : ''}`}>
                        <div className="item-card-top">
                          <strong>
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
                            Init: <b>{c.initiative ?? '—'}</b> <span className="muted small">({statLabel} • {modStr})</span>
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

          <div className="beat-detail-side-col stack">
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
                            </strong>
                            <span className="tag tag-cyan">{sp.damageDice} • {sp.rangeSpaces} Sp • {sp.mpCost} MP</span>
                          </div>
                          <div className="btn-row mt-xs">
                            <button
                              type="button"
                              className="btn btn-xs btn-crimson"
                              disabled={isReaction && !pendingReact}
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
                                  logEntry?: { summary?: string };
                                }>('spell_action', {
                                  characterId: me.id,
                                  subAction: 'cast',
                                  spellId: sp.id,
                                  targetMonsterId: defaultMonsterId || undefined,
                                });
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

            <div className="panel">
              <div className="panel-header">
                <h3>Spawned Monsters</h3>
                {isDm && (beat.encounters || []).length > 0 && (
                  <button
                    type="button"
                    id="btn-beat-detail-spawn"
                    className="btn btn-xs btn-crimson"
                    onClick={() => sendAction('story_action', { subAction: 'spawn_beat_monsters', beatId: beat.id })}
                  >
                    Spawn Attached
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
                    return (
                      <div key={tok.id} className="item-card">
                        <div className="item-card-top">
                          <strong>{tok.name} {hp !== null && hp <= 0 && <span className="tag tag-gold">DEFEATED</span>}</strong>
                          <span>{hp !== null && maxHp ? `HP ${hp}/${maxHp}` : ''}{liveMon ? ` • AC ${liveMon.ac} • DR ${liveMon.dr}` : ''}</span>
                        </div>
                        {maxHp ? <div className="progress"><div className="progress-fill monster" style={{ width: `${pct}%` }} /></div> : null}
                        {isDm && liveMon && (
                          <div className="btn-row mt-xs">
                            <button type="button" className="btn btn-xs btn-outline" onClick={() => sendAction('update_monster', { monsterId: liveMon.id, hpDelta: -5 })}>-5 HP</button>
                            <button type="button" className="btn btn-xs btn-outline" onClick={() => sendAction('update_monster', { monsterId: liveMon.id, hpDelta: 5 })}>+5 HP</button>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (beat.encounters || []).length > 0 ? (
                  beat.encounters.map((e, i) => (
                    <div key={`${e.name}-${i}`} className="item-card">
                      <div className="item-card-top">
                        <strong>{e.name} <span className="tag tag-crimson">READY TO SPAWN</span></strong>
                        <span>HP {e.maxHp} • AC {e.ac} • DR {e.dr} • {e.damageFormula || ''}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted small">No monsters in this story beat.</div>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header"><h3>Treasure &amp; Loot Chests</h3></div>
              <div id="beat-detail-treasure" className="list-stack mt-xs">
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
    </section>
  );
}
