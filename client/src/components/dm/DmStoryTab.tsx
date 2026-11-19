import React, { useEffect, useRef, useState } from 'react';
import {
  generateArenaTerrainFromPrompt,
  getArenaCellPx,
  type ArenaTerrainTile,
  type BeatEncounterSpec,
  type BeatTreasureSpec,
} from '@shared/index';
import { getScaledCanvasCell } from '../../canvas/coordinates';
import {
  drawArenaBackground,
  drawChestIcon,
  drawTerrainTile,
  drawTokenAvatar,
} from '../../canvas/drawPrimitives';
import { useVtt } from '../../context/VttContext';

interface StagedNpc {
  name: string;
  npcRole: string;
  startX: number | null;
  startY: number | null;
  dialogue: string;
  rewardType: string;
  rewardItemName: string;
  rewardXp: number;
}

interface DraftChest {
  name: string;
  gold: number;
  manaStones: number;
  itemName: string;
  x: number;
  y: number;
}

type DraftTool =
  | { kind: 'player'; id: string }
  | { kind: 'monster'; index: number }
  | { kind: 'npc'; index: number }
  | { kind: 'chest' | 'tree' | 'rock' | 'water' };

export function DmStoryTab() {
  const { state, sendAction, pushLocalToast, setActiveBeatDetailId, setActiveBeatMapId } = useVtt();

  const [lootTarget, setLootTarget] = useState('all');

  // Add Beat Form
  const [title, setTitle] = useState('');
  const [floor, setFloor] = useState(3);
  const [xpReward, setXpReward] = useState(100);
  const [gridSize, setGridSize] = useState(20);
  const [narration, setNarration] = useState('');
  const [dmSecret, setDmSecret] = useState('');
  const [presentNow, setPresentNow] = useState(false);

  // Staged monsters
  const [stagedMonsters, setStagedMonsters] = useState<BeatEncounterSpec[]>([]);
  const [monName, setMonName] = useState('');
  const [monDmg, setMonDmg] = useState('2d6+3');
  const [monHp, setMonHp] = useState(35);
  const [monAc, setMonAc] = useState(14);
  const [monDr, setMonDr] = useState(1);
  const [monX, setMonX] = useState('');
  const [monY, setMonY] = useState('');

  // Staged NPCs
  const [stagedNpcs, setStagedNpcs] = useState<StagedNpc[]>([]);
  const [npcName, setNpcName] = useState('');
  const [npcRole, setNpcRole] = useState('');
  const [npcX, setNpcX] = useState('');
  const [npcY, setNpcY] = useState('');
  const [npcDialogue, setNpcDialogue] = useState('');
  const [npcRewardType, setNpcRewardType] = useState('none');
  const [npcRewardName, setNpcRewardName] = useState('');
  const [npcRewardXp, setNpcRewardXp] = useState(50);

  // Staged Treasures
  const [stagedTreasures, setStagedTreasures] = useState<BeatTreasureSpec[]>([]);
  const [trName, setTrName] = useState('');
  const [trCat, setTrCat] = useState('relic');
  const [trGold, setTrGold] = useState(100);
  const [trStones, setTrStones] = useState(2);
  const [trDmg, setTrDmg] = useState('');

  // Draft Arena Designer
  const [draftBiome, setDraftBiome] = useState('obsidian');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftTerrain, setDraftTerrain] = useState<ArenaTerrainTile[]>([]);
  const [draftChests, setDraftChests] = useState<DraftChest[]>([]);
  const [draftPlayerPositions, setDraftPlayerPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draftTool, setDraftTool] = useState<DraftTool | null>(null);
  const [draftHoverCell, setDraftHoverCell] = useState<{ x: number; y: number } | null>(null);
  const [draftHint, setDraftHint] = useState('Select a player, attached monster, or Treasure Chest above, then tap a grid space below.');
  const draftCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const chars = Object.values(state?.characters || {});

  useEffect(() => {
    if (!draftTool && chars[0]) {
      setDraftTool({ kind: 'player', id: chars[0].id });
    }
    if (chars.length > 0) {
      setDraftPlayerPositions((prev) => {
        const next = { ...prev };
        let changed = false;
        const startX = Math.max(0, Math.floor(gridSize / 2) - Math.floor(chars.length / 2));
        const startY = Math.max(0, gridSize - 4);
        chars.forEach((ch, idx) => {
          if (!next[ch.id]) {
            next[ch.id] = { x: Math.min(gridSize - 1, startX + idx * 2), y: startY };
            changed = true;
          } else {
            const cx = Math.min(gridSize - 1, next[ch.id].x);
            const cy = Math.min(gridSize - 1, next[ch.id].y);
            if (cx !== next[ch.id].x || cy !== next[ch.id].y) {
              next[ch.id] = { x: cx, y: cy };
              changed = true;
            }
          }
        });
        return changed ? next : prev;
      });
    }
  }, [chars.length, gridSize]);

  useEffect(() => {
    const canvas = draftCanvasRef.current;
    if (!canvas || !state?.characters) return;
    const cellPx = getArenaCellPx(gridSize, 'draft');
    const axisPad = 22;
    const w = axisPad + gridSize * cellPx;
    const h = axisPad + gridSize * cellPx;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawArenaBackground(ctx, draftBiome, axisPad, gridSize, gridSize, cellPx, w, h);

    if (draftHoverCell && draftHoverCell.x >= 0 && draftHoverCell.x < gridSize && draftHoverCell.y >= 0 && draftHoverCell.y < gridSize) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
      ctx.fillRect(axisPad + draftHoverCell.x * cellPx, axisPad + draftHoverCell.y * cellPx, cellPx, cellPx);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(axisPad + draftHoverCell.x * cellPx + 0.5, axisPad + draftHoverCell.y * cellPx + 0.5, cellPx - 1, cellPx - 1);
    }

    for (const tile of draftTerrain) {
      if (tile.x >= gridSize || tile.y >= gridSize) continue;
      drawTerrainTile(ctx, tile, axisPad + tile.x * cellPx + cellPx / 2, axisPad + tile.y * cellPx + cellPx / 2, cellPx, draftBiome);
    }

    for (const c of draftChests) {
      drawChestIcon(ctx, { opened: false }, axisPad + c.x * cellPx + cellPx / 2, axisPad + c.y * cellPx + cellPx / 2, cellPx);
    }

    const r = Math.max(7, Math.floor(cellPx * 0.4));
    for (const ch of chars) {
      const pos = draftPlayerPositions[ch.id];
      if (!pos) continue;
      drawTokenAvatar(
        ctx,
        { id: ch.id, name: ch.name, type: 'player', label: ch.name.slice(0, 2).toUpperCase(), color: '#38bdf8' },
        axisPad + pos.x * cellPx + cellPx / 2,
        axisPad + pos.y * cellPx + cellPx / 2,
        r,
        draftTool?.kind === 'player' && draftTool.id === ch.id,
        state.characters,
      );
    }

    const startX = Math.max(0, Math.floor(gridSize / 2) - Math.floor(chars.length / 2));
    stagedMonsters.forEach((m, idx) => {
      const mx = m.startX ? Number(m.startX) - 1 : Math.min(gridSize - 1, startX + idx * 2);
      const my = m.startY ? Number(m.startY) - 1 : Math.min(gridSize - 1, 3);
      drawTokenAvatar(
        ctx,
        { id: `draft-mon-${idx}`, name: m.name, type: 'monster', label: m.name.slice(0, 2).toUpperCase(), color: '#ef4444' },
        axisPad + mx * cellPx + cellPx / 2,
        axisPad + my * cellPx + cellPx / 2,
        r,
        draftTool?.kind === 'monster' && draftTool.index === idx,
        state.characters,
      );
    });

    stagedNpcs.forEach((n, idx) => {
      const nx = n.startX ? Number(n.startX) - 1 : Math.min(gridSize - 1, 2 + idx * 2);
      const ny = n.startY ? Number(n.startY) - 1 : Math.min(gridSize - 1, Math.floor(gridSize / 2));
      drawTokenAvatar(
        ctx,
        { id: `draft-npc-${idx}`, name: n.name, type: 'npc', label: n.name.slice(0, 2).toUpperCase(), color: '#10b981' },
        axisPad + nx * cellPx + cellPx / 2,
        axisPad + ny * cellPx + cellPx / 2,
        r,
        draftTool?.kind === 'npc' && draftTool.index === idx,
        state.characters,
      );
    });
  }, [state?.characters, gridSize, draftBiome, draftTerrain, draftChests, draftPlayerPositions, draftTool, draftHoverCell, stagedMonsters, stagedNpcs]);

  if (!state) return null;

  const handleGenerateDraftTerrain = () => {
    const occ = new Set<string>();
    Object.values(draftPlayerPositions).forEach((p) => {
      if (p) occ.add(`${p.x},${p.y}`);
    });
    stagedMonsters.forEach((m) => {
      if (m.startX && m.startY) occ.add(`${Number(m.startX) - 1},${Number(m.startY) - 1}`);
    });
    draftChests.forEach((c) => occ.add(`${c.x},${c.y}`));
    const gen = generateArenaTerrainFromPrompt(draftPrompt.trim(), gridSize, gridSize, draftBiome, occ);
    setDraftBiome(gen.biome);
    setDraftTerrain(gen.terrain);
    setDraftHint(`Generated ${gen.terrain.length} terrain tiles (${gen.biome}).`);
  };

  const handleDraftCanvasClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = draftCanvasRef.current;
    if (!canvas || !draftTool) return;
    const cellPx = getArenaCellPx(gridSize, 'draft');
    const { x, y } = getScaledCanvasCell(canvas, ev.clientX, ev.clientY, 22, cellPx);
    if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) return;

    if (draftTool.kind === 'player') {
      setDraftPlayerPositions((prev) => ({ ...prev, [draftTool.id]: { x, y } }));
      setDraftHint(`Set player start to (${x + 1}, ${y + 1}).`);
    } else if (draftTool.kind === 'monster') {
      setStagedMonsters((prev) =>
        prev.map((m, i) => (i === draftTool.index ? { ...m, startX: x + 1, startY: y + 1 } : m)),
      );
      setDraftHint(`Set monster start to (${x + 1}, ${y + 1}).`);
    } else if (draftTool.kind === 'npc') {
      setStagedNpcs((prev) =>
        prev.map((n, i) => (i === draftTool.index ? { ...n, startX: x + 1, startY: y + 1 } : n)),
      );
      setDraftHint(`Set NPC start to (${x + 1}, ${y + 1}).`);
    } else if (draftTool.kind === 'tree' || draftTool.kind === 'rock' || draftTool.kind === 'water') {
      const tileType: ArenaTerrainTile['type'] = draftTool.kind;
      setDraftTerrain((prev) => {
        const idx = prev.findIndex((t) => t.x === x && t.y === y);
        if (idx >= 0 && prev[idx].type === tileType) {
          setDraftHint(`Cleared ${tileType} at (${x + 1}, ${y + 1}).`);
          return prev.filter((_, i) => i !== idx);
        }
        if (idx >= 0) {
          setDraftHint(`Set ${tileType} at (${x + 1}, ${y + 1}).`);
          return prev.map((t, i) => (i === idx ? { ...t, type: tileType } : t));
        }
        setDraftHint(`Placed ${tileType} at (${x + 1}, ${y + 1}).`);
        return [...prev, { x, y, type: tileType }];
      });
    } else if (draftTool.kind === 'chest') {
      setDraftChests((prev) => {
        const idx = prev.findIndex((c) => c.x === x && c.y === y);
        if (idx >= 0) {
          setDraftHint(`Removed chest at (${x + 1}, ${y + 1}).`);
          return prev.filter((_, i) => i !== idx);
        }
        setDraftHint(`Placed Treasure Chest at (${x + 1}, ${y + 1}). Click again to remove.`);
        return [
          ...prev,
          { name: 'Treasure Chest', gold: 100, manaStones: 1, itemName: '', x, y },
        ];
      });
    }
  };

  const handleCreateBeat = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const encounters = [...stagedMonsters];
    if (monName.trim()) {
      encounters.push({
        name: monName.trim(),
        maxHp: monHp,
        ac: monAc,
        dr: monDr,
        attackFormula: '1d20+5',
        damageFormula: monDmg || '2d6+3',
        startX: monX ? Number(monX) : null,
        startY: monY ? Number(monY) : null,
      });
    }

    const npcs = [...stagedNpcs];
    if (npcName.trim()) {
      npcs.push({
        name: npcName.trim(),
        npcRole: npcRole.trim() || 'NPC',
        startX: npcX ? Number(npcX) : null,
        startY: npcY ? Number(npcY) : null,
        dialogue: npcDialogue.trim(),
        rewardType: npcRewardType,
        rewardItemName: npcRewardName.trim(),
        rewardXp: npcRewardXp,
      });
    }

    const treasures = [...stagedTreasures];
    if (trName.trim()) {
      treasures.push({
        id: `tr-${Date.now().toString(36)}`,
        name: trName.trim(),
        category: trCat,
        qty: 1,
        gold: trGold,
        manaStones: trStones,
        damageDice: trDmg.trim(),
      });
    }

    const res = await sendAction('story_action', {
      subAction: 'add_beat',
      title: title.trim(),
      floor,
      xpReward,
      gridSize,
      narration: narration.trim(),
      dmSecret: dmSecret.trim(),
      presentNow,
      encounters,
      npcs,
      treasures,
      playerPositions: draftPlayerPositions,
      chests: draftChests,
      biome: draftBiome,
      ...(draftTerrain.length > 0 ? { terrain: draftTerrain } : {}),
      arenaPrompt: draftPrompt.trim(),
    });
    if (!res) return;

    setTitle('');
    setNarration('');
    setDmSecret('');
    setPresentNow(false);
    setStagedMonsters([]);
    setStagedNpcs([]);
    setStagedTreasures([]);
    setMonName('');
    setNpcName('');
    setTrName('');
    const nextPositions: Record<string, { x: number; y: number }> = {};
    const startX = Math.max(0, Math.floor(gridSize / 2) - Math.floor(chars.length / 2));
    const startY = Math.max(0, gridSize - 4);
    chars.forEach((c, idx) => {
      nextPositions[c.id] = { x: Math.min(gridSize - 1, startX + idx * 2), y: startY };
    });
    setDraftPlayerPositions(nextPositions);
    setDraftChests([]);
    setDraftBiome('obsidian');
    setDraftTerrain([]);
    setDraftPrompt('');
  };

  return (
    <div className="two-col">
      <div className="col stack">
        <div className="panel card-glow-gold">
          <div className="panel-header">
            <h3>Story Beats</h3>
            <div className="row-inline" style={{ maxWidth: '240px' }}>
              <select id="dm-story-loot-target" title="Treasure Recipient" value={lootTarget} onChange={(e) => setLootTarget(e.target.value)}>
                <option value="all">Treasure -&gt; All Players</option>
                {chars.map((c) => (
                  <option key={c.id} value={c.id}>Treasure -&gt; {c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div id="dm-story-list" className="list-stack">
            {(state.storyBeats || []).length > 0 ? (
              state.storyBeats.map((b) => {
                const monSummary = (b.encounters || []).map((e) => `${e.name} (${e.maxHp} HP)`).join(', ');
                const trSummary = (b.treasures || []).map((t) => `${t.name}${t.gold ? ` + ${t.gold}G` : ''}`).join(', ');
                return (
                  <div
                    key={b.id}
                    className={`story-beat-card ${b.status === 'active' ? 'beat-active' : ''} ${b.presented ? 'beat-presented' : ''}`}
                  >
                    <div className="item-card-top">
                      <strong>{b.title}</strong>
                      <div className="btn-row">
                        <span className={`tag ${b.presented ? 'tag-cyan' : 'tag-gold'}`}>
                          {b.presented ? 'PRESENTED' : String(b.status || 'upcoming').toUpperCase()}
                        </span>
                      </div>
                    </div>
                    {b.narration && <div className="story-narration">{b.narration}</div>}
                    {b.dmSecret && (
                      <div className="story-secret">
                        <strong>DM Secret:</strong> {b.dmSecret}
                      </div>
                    )}
                    {Boolean(b.xpReward) && (
                      <div className="small">
                        <span className="tag tag-purple">XP REWARD</span> +{b.xpReward} XP
                      </div>
                    )}
                    {monSummary && (
                      <div className="small">
                        <span className="tag tag-crimson">MONSTERS</span> {monSummary}
                      </div>
                    )}
                    {trSummary && (
                      <div className="small">
                        <span className="tag tag-gold">TREASURE</span> {trSummary}
                      </div>
                    )}
                    <div className="btn-row mt-xs">
                      <button type="button" className="btn btn-xs btn-gold" onClick={() => setActiveBeatDetailId(b.id)}>
                        View Beat
                      </button>
                      <button type="button" className="btn btn-xs btn-outline" onClick={() => setActiveBeatMapId(b.id)}>
                        View Map ({b.arena?.cols || 20}×{b.arena?.rows || 20})
                      </button>
                      <button
                        type="button"
                        className={`btn btn-xs ${b.presented ? 'btn-outline' : 'btn-cyan'}`}
                        onClick={() =>
                          sendAction('story_action', {
                            subAction: b.presented ? 'hide_beat' : 'present_beat',
                            beatId: b.id,
                          })
                        }
                      >
                        {b.presented ? 'Hide from Players' : 'Present to Players'}
                      </button>
                      {Boolean(b.xpReward) && (
                        <button
                          type="button"
                          className="btn btn-xs btn-purple"
                          onClick={() =>
                            sendAction('story_action', {
                              subAction: 'award_beat_xp',
                              beatId: b.id,
                              characterId: lootTarget || 'all',
                            })
                          }
                        >
                          Award XP (+{b.xpReward})
                        </button>
                      )}
                      {(b.encounters || []).length > 0 && (
                        <button
                          type="button"
                          className="btn btn-xs btn-crimson"
                          onClick={async () => {
                            const res = await sendAction<{ spawned?: unknown[] }>('story_action', {
                              subAction: 'spawn_beat_monsters',
                              beatId: b.id,
                            });
                            pushLocalToast({
                              title: 'ENCOUNTER SPAWNED',
                              message: `Spawned ${res?.spawned?.length || 0} monster(s) from Story Beat.`,
                              category: 'combat',
                            });
                          }}
                        >
                          Spawn Monsters
                        </button>
                      )}
                      {(b.treasures || []).length > 0 && (
                        <button
                          type="button"
                          className="btn btn-xs btn-gold"
                          onClick={() =>
                            sendAction('story_action', {
                              subAction: 'award_beat_treasure',
                              beatId: b.id,
                              characterId: lootTarget || 'all',
                            })
                          }
                        >
                          Award Treasure
                        </button>
                      )}
                      {b.status !== 'resolved' && (
                        <button
                          type="button"
                          className="btn btn-xs btn-outline"
                          onClick={() =>
                            sendAction('story_action', { subAction: 'set_status', beatId: b.id, status: 'resolved' })
                          }
                        >
                          Resolve
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-xs btn-danger-outline"
                        onClick={() => sendAction('story_action', { subAction: 'delete_beat', beatId: b.id })}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="muted small">No story beats yet. Create one on the right!</div>
            )}
          </div>
        </div>
      </div>

      <div className="col stack">
        <div className="panel card-glow-cyan">
          <div className="panel-header">
            <h3>+ New Story Beat</h3>
            <span className="tag tag-cyan">ORCHESTRATOR</span>
          </div>
          <form id="dm-add-beat-form" className="stack-form" onSubmit={handleCreateBeat}>
            <div className="grid-2">
              <label><span>Beat Title</span><input type="text" placeholder="e.g. 3F • Shinsu Bridge" required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
              <label><span>Floor</span><input type="number" min={1} max={100} value={floor} onChange={(e) => setFloor(Number(e.target.value || 1))} /></label>
            </div>
            <div className="grid-2">
              <label><span>XP Reward</span><input type="number" min={0} value={xpReward} onChange={(e) => setXpReward(Number(e.target.value || 0))} /></label>
              <label>
                <span>Arena Grid Size</span>
                <select value={gridSize} onChange={(e) => setGridSize(Number(e.target.value || 20))}>
                  <option value={20}>20 × 20 Spaces (Default)</option>
                  <option value={25}>25 × 25 Spaces</option>
                  <option value={30}>30 × 30 Spaces</option>
                  <option value={40}>40 × 40 Spaces</option>
                  <option value={50}>50 × 50 Spaces</option>
                </select>
              </label>
            </div>
            <label><span>Player Narration (Shown when presented)</span><textarea rows={3} placeholder="Scene description read/pushed to players..." value={narration} onChange={(e) => setNarration(e.target.value)} /></label>
            <label><span>DM Secret Note (DM Eyes Only)</span><input type="text" placeholder="Hidden trap DC, twist, or condition..." value={dmSecret} onChange={(e) => setDmSecret(e.target.value)} /></label>

            <details className="sub-details">
              <summary>+ Attach Monster Encounters (Optional)</summary>
              <div className="stack-form mt-sm">
                <div className="list-stack">
                  {stagedMonsters.map((m, i) => (
                    <div key={`${m.name}-${i}`} className="item-card">
                      <div className="item-card-top">
                        <strong>{m.name}</strong>
                        <span>HP {m.maxHp} • AC {m.ac} • DR {m.dr} • {m.damageFormula}</span>
                        <button type="button" className="btn btn-xs btn-danger-outline" onClick={() => setStagedMonsters((prev) => prev.filter((_, idx) => idx !== i))}>
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
                  <label><span>Armor Class (AC)</span><input type="number" value={monAc} onChange={(e) => setMonAc(Number(e.target.value || 10))} /></label>
                  <label><span>Damage Red. (DR)</span><input type="number" value={monDr} onChange={(e) => setMonDr(Number(e.target.value || 0))} /></label>
                </div>
                <div className="grid-2">
                  <label><span>Start X (Col, optional)</span><input type="number" min={1} max={100} placeholder="Auto" value={monX} onChange={(e) => setMonX(e.target.value)} /></label>
                  <label><span>Start Y (Row, optional)</span><input type="number" min={1} max={100} placeholder="Auto" value={monY} onChange={(e) => setMonY(e.target.value)} /></label>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-crimson"
                  onClick={() => {
                    if (!monName.trim()) {
                      pushLocalToast({ title: 'MONSTER NAME NEEDED', message: 'Enter a monster name before adding.', category: 'warning' });
                      return;
                    }
                    setStagedMonsters((prev) => [
                      ...prev,
                      {
                        name: monName.trim(),
                        maxHp: monHp,
                        ac: monAc,
                        dr: monDr,
                        attackFormula: '1d20+5',
                        damageFormula: monDmg || '2d6+3',
                        startX: monX ? Number(monX) : null,
                        startY: monY ? Number(monY) : null,
                      },
                    ]);
                    setMonName('');
                    setMonX('');
                    setMonY('');
                  }}
                >
                  + Add Monster to Beat
                </button>
              </div>
            </details>

            <details className="sub-details">
              <summary>+ Attach NPCs (Optional)</summary>
              <div className="stack-form mt-sm">
                <div className="list-stack">
                  {stagedNpcs.map((n, i) => (
                    <div key={`${n.name}-${i}`} className="item-card">
                      <div className="item-card-top">
                        <strong>{n.name} <span className="tag tag-green">{n.npcRole}</span></strong>
                        <span>{n.startX && n.startY ? `Start (${n.startX}, ${n.startY})` : 'Auto Start'}</span>
                        <button type="button" className="btn btn-xs btn-danger-outline" onClick={() => setStagedNpcs((prev) => prev.filter((_, idx) => idx !== i))}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid-2">
                  <label><span>NPC Name</span><input type="text" placeholder="e.g. Tower Merchant" value={npcName} onChange={(e) => setNpcName(e.target.value)} /></label>
                  <label><span>Role / Title</span><input type="text" placeholder="e.g. Merchant, Ally, Guide" value={npcRole} onChange={(e) => setNpcRole(e.target.value)} /></label>
                </div>
                <div className="grid-2">
                  <label><span>Start X (Col, optional)</span><input type="number" min={1} max={100} placeholder="Auto" value={npcX} onChange={(e) => setNpcX(e.target.value)} /></label>
                  <label><span>Start Y (Row, optional)</span><input type="number" min={1} max={100} placeholder="Auto" value={npcY} onChange={(e) => setNpcY(e.target.value)} /></label>
                </div>
                <label><span>Dialogue (When Talked To)</span><input type="text" placeholder="e.g. Take this skill book for the 3rd Floor!" value={npcDialogue} onChange={(e) => setNpcDialogue(e.target.value)} /></label>
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
                  onClick={() => {
                    if (!npcName.trim()) {
                      pushLocalToast({ title: 'NPC NAME NEEDED', message: 'Enter an NPC name before adding.', category: 'warning' });
                      return;
                    }
                    setStagedNpcs((prev) => [
                      ...prev,
                      {
                        name: npcName.trim(),
                        npcRole: npcRole.trim() || 'NPC',
                        startX: npcX ? Number(npcX) : null,
                        startY: npcY ? Number(npcY) : null,
                        dialogue: npcDialogue.trim(),
                        rewardType: npcRewardType,
                        rewardItemName: npcRewardName.trim(),
                        rewardXp: npcRewardXp,
                      },
                    ]);
                    setNpcName('');
                    setNpcRole('');
                    setNpcX('');
                    setNpcY('');
                    setNpcDialogue('');
                    setNpcRewardName('');
                  }}
                >
                  + Add NPC to Beat
                </button>
              </div>
            </details>

            <details className="sub-details">
              <summary>+ Attach Treasures / Loot (Optional)</summary>
              <div className="stack-form mt-sm">
                <div className="list-stack">
                  {stagedTreasures.map((t, i) => (
                    <div key={`${t.name}-${i}`} className="item-card">
                      <div className="item-card-top">
                        <strong>{t.name} <span className="tag tag-cyan">{t.category}</span></strong>
                        <span>{t.gold ? `${t.gold}G ` : ''}{t.manaStones ? `${t.manaStones} Stones ` : ''}{t.damageDice || ''}</span>
                        <button type="button" className="btn btn-xs btn-danger-outline" onClick={() => setStagedTreasures((prev) => prev.filter((_, idx) => idx !== i))}>
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
                      pushLocalToast({ title: 'TREASURE NEEDED', message: 'Enter an item name or gold.', category: 'warning' });
                      return;
                    }
                    setStagedTreasures((prev) => [
                      ...prev,
                      { id: `tr-${Date.now().toString(36)}`, name: trName.trim() || 'Gold Cache', category: trCat, qty: 1, gold: trGold, manaStones: trStones, damageDice: trDmg.trim() },
                    ]);
                    setTrName('');
                    setTrDmg('');
                  }}
                >
                  + Add Treasure to Beat
                </button>
              </div>
            </details>

            <details id="beat-map-designer-details" className="sub-details">
              <summary>+ Design Arena Map, Start Positions &amp; Treasure Chests</summary>
              <div className="stack-form mt-sm">
                <div className="grid-3">
                  <label>
                    <span>Arena Background</span>
                    <select value={draftBiome} onChange={(e) => setDraftBiome(e.target.value)}>
                      <option value="obsidian">Obsidian Tower (Default)</option>
                      <option value="forest">Forest</option>
                      <option value="plains">Plains</option>
                      <option value="desert">Desert</option>
                    </select>
                  </label>
                  <label style={{ gridColumn: 'span 2' }}>
                    <span>Cryptic Arena Description (Auto-Generate Terrain)</span>
                    <div className="btn-row" style={{ gap: '6px' }}>
                      <input type="text" placeholder="e.g. misty forest split by a winding river and ancient boulders..." style={{ flex: 1 }} value={draftPrompt} onChange={(e) => setDraftPrompt(e.target.value)} />
                      <button type="button" className="btn btn-xs btn-cyan" onClick={handleGenerateDraftTerrain}>Auto-Generate Map</button>
                    </div>
                  </label>
                </div>
                <div className="demo-chips">
                  {chars.map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      className={`chip-btn ${draftTool?.kind === 'player' && draftTool.id === ch.id ? 'active' : ''}`}
                      onClick={() => setDraftTool({ kind: 'player', id: ch.id })}
                    >
                      {ch.name.split(' ')[0]}
                    </button>
                  ))}
                  {stagedMonsters.map((m, idx) => (
                    <button
                      key={`${m.name}-${idx}`}
                      type="button"
                      className={`chip-btn ${draftTool?.kind === 'monster' && draftTool.index === idx ? 'active' : ''}`}
                      style={{ borderColor: 'rgba(239,68,68,0.6)' }}
                      onClick={() => setDraftTool({ kind: 'monster', index: idx })}
                    >
                      {m.name}
                    </button>
                  ))}
                  {stagedNpcs.map((n, idx) => (
                    <button
                      key={`${n.name}-${idx}`}
                      type="button"
                      className={`chip-btn ${draftTool?.kind === 'npc' && draftTool.index === idx ? 'active' : ''}`}
                      style={{ borderColor: 'rgba(16,185,129,0.7)', color: '#34d399' }}
                      onClick={() => setDraftTool({ kind: 'npc', index: idx })}
                    >
                      {n.name}
                    </button>
                  ))}
                  <button type="button" className={`chip-btn ${draftTool?.kind === 'chest' ? 'active' : ''}`} style={{ borderColor: 'rgba(251,191,36,0.7)', color: '#fbbf24' }} onClick={() => setDraftTool({ kind: 'chest' })}>+ Treasure Chest</button>
                  <button type="button" className={`chip-btn ${draftTool?.kind === 'tree' ? 'active' : ''}`} style={{ borderColor: 'rgba(34,197,94,0.6)', color: '#4ade80' }} onClick={() => setDraftTool({ kind: 'tree' })}>Tree</button>
                  <button type="button" className={`chip-btn ${draftTool?.kind === 'rock' ? 'active' : ''}`} style={{ borderColor: 'rgba(148,163,184,0.6)', color: '#cbd5e1' }} onClick={() => setDraftTool({ kind: 'rock' })}>Rock</button>
                  <button type="button" className={`chip-btn ${draftTool?.kind === 'water' ? 'active' : ''}`} style={{ borderColor: 'rgba(56,189,248,0.6)', color: '#38bdf8' }} onClick={() => setDraftTool({ kind: 'water' })}>Water</button>
                </div>
                <div className="muted small" id="beat-draft-hint">{draftHint}</div>
                <div className="arena-scroll-wrap" style={{ maxHeight: '360px' }}>
                  <canvas
                    ref={draftCanvasRef}
                    id="beat-draft-canvas"
                    className="beat-arena-canvas"
                    width={440}
                    height={440}
                    onClick={handleDraftCanvasClick}
                    onMouseMove={(ev) => {
                      const canvas = draftCanvasRef.current;
                      if (!canvas) return;
                      const cell = getScaledCanvasCell(canvas, ev.clientX, ev.clientY, 22, getArenaCellPx(gridSize, 'draft'));
                      if (cell.x >= 0 && cell.x < gridSize && cell.y >= 0 && cell.y < gridSize) {
                        setDraftHoverCell(cell);
                      } else {
                        setDraftHoverCell(null);
                      }
                    }}
                    onMouseLeave={() => setDraftHoverCell(null)}
                  />
                </div>
              </div>
            </details>

            <label className="checkbox-row">
              <input type="checkbox" checked={presentNow} onChange={(e) => setPresentNow(e.target.checked)} />
              <span>Present immediately to Players</span>
            </label>
            <button type="submit" className="btn btn-gold btn-lg btn-glow-gold">Add Story Beat</button>
          </form>
        </div>
      </div>
    </div>
  );
}
