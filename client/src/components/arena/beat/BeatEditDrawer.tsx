import React, { useState } from 'react';
import {
  CHEST_TIERS,
  DEFAULT_COMBAT_MAX_ROUNDS,
  generateThemedStoryBeat,
  getChestDefaultsForFloor,
  getFloorThemeLabel,
  scaleMonsterForFloor,
  scaleTreasureForFloor,
  type BeatEncounterSpec,
  type BeatTreasureSpec,
  type ChestTier,
  type StoryBeat,
} from '@shared/index';
import { useVtt } from '../../../context/VttContext';
export interface BeatEditDrawerProps {
  beat: StoryBeat;
  onClose: () => void;
}

export function BeatEditDrawer({ beat, onClose }: BeatEditDrawerProps) {
  const { state, sendAction, pushLocalToast } = useVtt();

  const initialFloor = beat.floor || 1;
  const initialMonster = scaleMonsterForFloor(
    { maxHp: 26, ac: 14, dr: 1, attackFormula: '1d20+5', damageFormula: '1d8+3' },
    initialFloor
  );
  const initialChest = getChestDefaultsForFloor('Common', initialFloor);

  const [editTitle, setEditTitle] = useState(beat.title || '');
  const [editFloor, setEditFloor] = useState(initialFloor);
  const [editXp, setEditXp] = useState(beat.xpReward || 0);
  const [editMaxRounds, setEditMaxRounds] = useState(beat.maxRounds || DEFAULT_COMBAT_MAX_ROUNDS);
  const [editGridSize, setEditGridSize] = useState(String(beat.arena?.cols || 20));
  const [editStatus, setEditStatus] = useState(beat.status || 'upcoming');
  const [editNarration, setEditNarration] = useState(beat.narration || '');
  const [editSecret, setEditSecret] = useState(beat.dmSecret || '');
  const [editPresentNow, setEditPresentNow] = useState(Boolean(beat.presented));
  const [editEncounters, setEditEncounters] = useState<BeatEncounterSpec[]>(() =>
    JSON.parse(JSON.stringify(beat.encounters || []))
  );
  const [editTreasures, setEditTreasures] = useState<BeatTreasureSpec[]>(() =>
    JSON.parse(JSON.stringify(beat.treasures || []))
  );

  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [monName, setMonName] = useState('');
  const [monQty, setMonQty] = useState(1);
  const [monFloor, setMonFloor] = useState(initialFloor);
  const [monAtk, setMonAtk] = useState(initialMonster.attackFormula);
  const [monDmg, setMonDmg] = useState(initialMonster.damageFormula);
  const [monHp, setMonHp] = useState(initialMonster.maxHp);
  const [monAc, setMonAc] = useState(initialMonster.ac);
  const [monDr, setMonDr] = useState(initialMonster.dr);
  const [monRange, setMonRange] = useState(1);

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
  const [editChestName, setEditChestName] = useState(initialChest.name);
  const [editChestGold, setEditChestGold] = useState(initialChest.gold);
  const [editChestStones, setEditChestStones] = useState(initialChest.manaStones);
  const [editChestItem, setEditChestItem] = useState('');
  const [editChestX, setEditChestX] = useState(10);
  const [editChestY, setEditChestY] = useState(4);

  if (!state) return null;

  const arena = beat.arena || { cols: 20, rows: 20, biome: 'obsidian', terrain: [], tokens: [], chests: [] };
  const npcTokens = (arena.tokens || []).filter((t) => t.type === 'npc');
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
    setMonRange(Math.max(1, Number(preset?.rangeSpaces || 1)));
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
        rangeSpaces: Math.max(1, Math.min(12, Math.trunc(Number(monRange) || 1))),
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
    onClose();
    pushLocalToast({ title: 'STORY BEAT UPDATED', message: 'Story beat changes saved!', category: 'info' });
  };

  return (
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
                <button type="button" id="btn-cancel-beat-edit" className="btn btn-xs btn-outline" onClick={() => onClose()}>
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
                  <div className="grid-4">
                    <label><span>Max HP</span><input type="number" min={1} value={monHp} onChange={(e) => setMonHp(Number(e.target.value || 1))} /></label>
                    <label><span>AC</span><input type="number" value={monAc} onChange={(e) => setMonAc(Number(e.target.value || 10))} /></label>
                    <label><span>DR</span><input type="number" value={monDr} onChange={(e) => setMonDr(Number(e.target.value || 0))} /></label>
                    <label><span>Range (Sp)</span><input type="number" min={1} max={12} value={monRange} onChange={(e) => setMonRange(Math.max(1, Math.min(12, Number(e.target.value || 1))))} /></label>
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
  );
}
