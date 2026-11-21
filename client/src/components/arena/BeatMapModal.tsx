import { useEffect, useState } from 'react';
import {
  CHEST_TIERS,
  FLOOR_THEMES,
  VALID_TERRAIN_TYPES,
  buildChestLootPreview,
  getArenaCellPx,
  type ChestLootSummary,
  type ChestTier,
  type TerrainType,
} from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { BeatArenaCanvas, useBeatPlayerCellAction } from './BeatArenaCanvas';

type ArenaTool = 'move' | 'measure' | TerrainType | 'chest' | 'npc' | 'talk' | 'rest';

export function BeatMapModal() {
  const { activeBeatMapId, setActiveBeatMapId, session, state, sendAction, pushLocalToast, setChestReveal } = useVtt();
  const handlePlayerBeatCell = useBeatPlayerCellAction();

  const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatMapId);
  const cols = beat?.arena?.cols || 20;
  const rows = beat?.arena?.rows || 20;

  const [tool, setTool] = useState<ArenaTool>('move');
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [cellOverride, setCellOverride] = useState<number | null>(null);
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number } | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{ x: number; y: number } | null>(null);
  const [infoText, setInfoText] = useState('Tap a token, then tap a space to move.');

  const [customCols, setCustomCols] = useState(cols);
  const [customRows, setCustomRows] = useState(rows);
  const [biome, setBiome] = useState(String(beat?.arena?.biome || 'obsidian'));
  const [genPrompt, setGenPrompt] = useState('');

  const [chestName, setChestName] = useState('');
  const [chestTier, setChestTier] = useState<ChestTier>('Common');
  const [chestGold, setChestGold] = useState(0);
  const [chestItem, setChestItem] = useState('');

  const [npcName, setNpcName] = useState('Tower Guide');
  const [npcRole, setNpcRole] = useState('');
  const [npcDialogue, setNpcDialogue] = useState('');
  const [npcRewardType, setNpcRewardType] = useState('none');
  const [npcRewardValue, setNpcRewardValue] = useState('');

  useEffect(() => {
    if (beat) {
      setCustomCols(beat.arena?.cols || 20);
      setCustomRows(beat.arena?.rows || 20);
      setBiome(String(beat.arena?.biome || 'obsidian'));
      setSelectedTokenId(session?.role === 'player' ? session.characterId : null);
      setMeasureStart(null);
      setMeasureEnd(null);
      setCellOverride(null);
    }
  }, [activeBeatMapId]);

  if (!activeBeatMapId || !beat || !state || !session) return null;

  const isDm = session.role === 'dm';
  const arena = beat.arena || { cols: 20, rows: 20, biome: 'obsidian', terrain: [], tokens: [], chests: [] };
  const activeCellPx = cellOverride ?? getArenaCellPx(cols, 'modal');
  const presentIds = new Set((arena.tokens || []).map((t) => t.id));

  const handleCellClick = async (x: number, y: number) => {
    if (tool === 'measure') {
      if (!measureStart || measureEnd !== null) {
        setMeasureStart({ x, y });
        setMeasureEnd(null);
      } else {
        setMeasureEnd({ x, y });
      }
      return;
    }

    if (isDm && tool === 'chest') {
      const existingChest = (arena.chests || []).find((c) => c.x === x && c.y === y);
      if (existingChest) {
        await sendAction('story_action', { subAction: 'remove_beat_chest', beatId: beat.id, chestId: existingChest.id });
      } else {
        await sendAction('story_action', {
          subAction: 'add_beat_chest',
          beatId: beat.id,
          name: chestName.trim() || `${chestTier} Chest`,
          tier: chestTier,
          gold: chestGold,
          itemName: chestItem.trim(),
          x,
          y,
        });
      }
      return;
    }

    if (isDm && tool === 'rest') {
      const existingRest = (arena.restSpots || []).find((r) => r.x === x && r.y === y);
      if (existingRest) {
        await sendAction('story_action', { subAction: 'remove_beat_rest_spot', beatId: beat.id, restSpotId: existingRest.id });
      } else {
        await sendAction('story_action', { subAction: 'add_beat_rest_spot', beatId: beat.id, x, y });
      }
      return;
    }

    if (isDm && tool === 'npc') {
      await sendAction('story_action', {
        subAction: 'add_beat_npc',
        beatId: beat.id,
        name: npcName.trim() || 'Tower Guide',
        npcRole: npcRole.trim() || 'NPC',
        dialogue: npcDialogue.trim(),
        rewardType: npcRewardType,
        rewardItemName: npcRewardType === 'item' || npcRewardType === 'skill_book' ? npcRewardValue.trim() : '',
        rewardXp: npcRewardType === 'xp' ? Number(npcRewardValue || 50) : 0,
        x,
        y,
      });
      return;
    }

    if (isDm && tool === 'talk') {
      const npcHit = (arena.tokens || []).find((t) => t.x === x && t.y === y && t.type === 'npc');
      if (npcHit) {
        await sendAction('story_action', { subAction: 'talk_beat_npc', beatId: beat.id, tokenId: npcHit.id });
      }
      return;
    }

    if (isDm && VALID_TERRAIN_TYPES.includes(tool as TerrainType)) {
      await sendAction('story_action', {
        subAction: 'toggle_beat_terrain',
        beatId: beat.id,
        x,
        y,
        terrainType: tool,
      });
      return;
    }

    if (!isDm && session.characterId) {
      const handled = await handlePlayerBeatCell({ beat, x, y, mode: 'move' });
      if (handled) return;
    }

    const clickedChest = (arena.chests || []).find((c) => c.x === x && c.y === y && (isDm || !c.opened));
    if (clickedChest && !(arena.tokens || []).some((t) => t.x === x && t.y === y)) {
      if (isDm) {
        setChestReveal(buildChestLootPreview(clickedChest, beat.floor || 1, null, 'DM', state.chestCatalog));
        return;
      }
      const me = session.characterId ? state.characters?.[session.characterId] : null;
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

    if (isDm) {
      const hit = (arena.tokens || []).find((t) => t.x === x && t.y === y);
      if (hit) {
        setSelectedTokenId(hit.id);
        setInfoText(`Selected ${hit.name}. Tap a destination space.`);
      } else if (selectedTokenId) {
        await sendAction('story_action', {
          subAction: 'move_beat_token',
          beatId: beat.id,
          tokenId: selectedTokenId,
          x,
          y,
        });
      }
    } else if (session.characterId) {
      const npcHit = (arena.tokens || []).find((t) => t.x === x && t.y === y && t.type === 'npc');
      if (npcHit) {
        await sendAction('story_action', {
          subAction: 'talk_beat_npc',
          beatId: beat.id,
          tokenId: npcHit.id,
          characterId: session.characterId,
        });
        return;
      }
      await sendAction('story_action', {
        subAction: 'move_beat_token',
        beatId: beat.id,
        tokenId: session.characterId,
        x,
        y,
      });
    }
  };

  return (
    <div id="beat-map-modal" className="modal-backdrop">
      <div className="modal-card modal-arena">
        <div className="panel-header">
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <h3 id="beat-map-title">{beat.title}</h3>
            <span id="beat-map-size-badge" className="tag tag-cyan">
              {cols} × {rows} Spaces
            </span>
          </div>
          <button
            type="button"
            id="btn-close-beat-map"
            className="btn btn-xs btn-outline"
            onClick={() => setActiveBeatMapId(null)}
          >
            Close Map
          </button>
        </div>

        {isDm && (
          <div id="beat-map-dm-controls" className="arena-controls">
            <div className="btn-row" style={{ alignItems: 'center' }}>
              <span className="muted small">Grid:</span>
              {[20, 25, 30, 40, 50].map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`btn btn-xs btn-outline ${cols === size && rows === size ? 'active' : ''}`}
                  onClick={() => {
                    setCellOverride(null);
                    sendAction('story_action', { subAction: 'set_beat_grid', beatId: beat.id, cols: size, rows: size });
                  }}
                >
                  {size}×{size}
                </button>
              ))}
              <input
                type="number"
                min={5}
                max={100}
                value={customCols}
                onChange={(e) => setCustomCols(Number(e.target.value || 20))}
                style={{ width: '64px', minHeight: '32px', padding: '4px 6px' }}
                aria-label="Custom columns"
              />
              <span className="muted small">×</span>
              <input
                type="number"
                min={5}
                max={100}
                value={customRows}
                onChange={(e) => setCustomRows(Number(e.target.value || 20))}
                style={{ width: '64px', minHeight: '32px', padding: '4px 6px' }}
                aria-label="Custom rows"
              />
              <button
                type="button"
                className="btn btn-xs btn-cyan"
                onClick={() => {
                  setCellOverride(null);
                  sendAction('story_action', {
                    subAction: 'set_beat_grid',
                    beatId: beat.id,
                    cols: Math.max(5, Math.min(100, customCols)),
                    rows: Math.max(5, Math.min(100, customRows)),
                  });
                }}
              >
                Apply
              </button>
            </div>

            <div id="beat-map-players-bar" className="demo-chips mt-xs">
              <span className="muted small">Fighters:</span>
              {Object.values(state.characters || {}).map((ch) => {
                const active = presentIds.has(ch.id);
                return (
                  <button
                    key={ch.id}
                    type="button"
                    className={`chip-btn ${active ? 'active' : ''}`}
                    onClick={() =>
                      sendAction('story_action', {
                        subAction: 'toggle_beat_player',
                        beatId: beat.id,
                        characterId: ch.id,
                      })
                    }
                  >
                    {ch.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>

            <div className="btn-row mt-xs" style={{ alignItems: 'center' }}>
              <select
                value={biome}
                aria-label="Arena Background"
                style={{ width: 'auto', minHeight: '32px', padding: '4px 8px' }}
                onChange={(e) => {
                  setBiome(e.target.value);
                  sendAction('story_action', { subAction: 'set_beat_biome', beatId: beat.id, biome: e.target.value });
                }}
              >
                {FLOOR_THEMES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Cryptic arena description (e.g. shattered boulders by a river)..."
                style={{ flex: 1, minWidth: '180px', minHeight: '32px', padding: '4px 8px' }}
                aria-label="Cryptic Arena Description"
                value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-xs btn-cyan"
                onClick={() =>
                  sendAction('story_action', {
                    subAction: 'generate_beat_terrain',
                    beatId: beat.id,
                    prompt: genPrompt.trim(),
                    biome,
                  })
                }
              >
                Auto-Generate
              </button>
              {VALID_TERRAIN_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`btn btn-xs btn-outline ${tool === t ? 'active' : ''}`}
                  onClick={() => setTool(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            <div className="btn-row mt-xs" style={{ alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-xs btn-gold"
                onClick={async () => {
                  await sendAction('story_action', { subAction: 'save_beat_starts', beatId: beat.id });
                  pushLocalToast({
                    title: 'START POSITIONS SAVED',
                    message: 'Designated starting positions saved for this Story Beat.',
                    category: 'info',
                  });
                }}
              >
                Save Start Positions
              </button>
              <button
                type="button"
                className="btn btn-xs btn-outline"
                onClick={() => sendAction('story_action', { subAction: 'reset_beat_starts', beatId: beat.id })}
              >
                Reset to Start
              </button>
              <button
                type="button"
                className={`btn btn-xs btn-outline ${tool === 'rest' ? 'active' : ''}`}
                style={{ borderColor: 'rgba(16,185,129,0.7)', color: '#6ee7b7' }}
                onClick={() => setTool('rest')}
              >
                + Rest Spot
              </button>
              <button
                type="button"
                className={`btn btn-xs btn-outline ${tool === 'chest' ? 'active' : ''}`}
                onClick={() => setTool('chest')}
              >
                + Place Chest
              </button>
              <select
                value={chestTier}
                aria-label="Chest Tier"
                onChange={(e) => setChestTier(e.target.value as ChestTier)}
                style={{ width: 'auto', minHeight: '32px', padding: '4px 8px' }}
              >
                {CHEST_TIERS.map((ct) => (
                  <option key={ct} value={ct}>{ct} Tier</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Chest Name (auto)"
                value={chestName}
                onChange={(e) => setChestName(e.target.value)}
                style={{ width: '130px', minHeight: '32px', padding: '4px 8px' }}
                aria-label="Chest Name"
              />
              <input
                type="number"
                min={0}
                value={chestGold}
                onChange={(e) => setChestGold(Number(e.target.value || 0))}
                style={{ width: '76px', minHeight: '32px', padding: '4px 6px' }}
                aria-label="Chest Gold"
              />
              <input
                type="text"
                placeholder="Item (opt.)"
                value={chestItem}
                onChange={(e) => setChestItem(e.target.value)}
                style={{ width: '120px', minHeight: '32px', padding: '4px 8px' }}
                aria-label="Chest Item"
              />
            </div>

            <div className="btn-row mt-xs" style={{ alignItems: 'center' }}>
              <button
                type="button"
                className={`btn btn-xs btn-outline ${tool === 'npc' ? 'active' : ''}`}
                style={{ borderColor: 'rgba(16,185,129,0.7)', color: '#34d399' }}
                onClick={() => setTool('npc')}
              >
                + Place NPC
              </button>
              <input
                type="text"
                value={npcName}
                onChange={(e) => setNpcName(e.target.value)}
                style={{ width: '120px', minHeight: '32px', padding: '4px 8px' }}
                aria-label="NPC Name"
              />
              <input
                type="text"
                placeholder="Role (Merchant)"
                value={npcRole}
                onChange={(e) => setNpcRole(e.target.value)}
                style={{ width: '110px', minHeight: '32px', padding: '4px 8px' }}
                aria-label="NPC Role"
              />
              <input
                type="text"
                placeholder="Dialogue..."
                value={npcDialogue}
                onChange={(e) => setNpcDialogue(e.target.value)}
                style={{ width: '150px', minHeight: '32px', padding: '4px 8px' }}
                aria-label="NPC Dialogue"
              />
              <select
                value={npcRewardType}
                onChange={(e) => setNpcRewardType(e.target.value)}
                aria-label="NPC Reward Type"
                style={{ width: 'auto', minHeight: '32px', padding: '4px 6px' }}
              >
                <option value="none">No Gift</option>
                <option value="item">Item</option>
                <option value="skill_book">Skill Book</option>
                <option value="xp">XP</option>
              </select>
              <input
                type="text"
                placeholder="Item/Book or XP"
                value={npcRewardValue}
                onChange={(e) => setNpcRewardValue(e.target.value)}
                style={{ width: '120px', minHeight: '32px', padding: '4px 8px' }}
                aria-label="NPC Reward Value"
              />
              <button
                type="button"
                className={`btn btn-xs btn-outline ${tool === 'talk' ? 'active' : ''}`}
                onClick={() => setTool('talk')}
              >
                Talk NPC
              </button>
            </div>
          </div>
        )}

        <div className="btn-row mt-xs" style={{ alignItems: 'center' }}>
          <button
            type="button"
            className={`btn btn-xs btn-outline ${tool === 'move' ? 'active' : ''}`}
            onClick={() => {
              setTool('move');
              setMeasureStart(null);
              setMeasureEnd(null);
            }}
          >
            Move Token
          </button>
          <button
            type="button"
            className={`btn btn-xs btn-outline ${tool === 'measure' ? 'active' : ''}`}
            onClick={() => {
              setTool('measure');
              setMeasureStart(null);
              setMeasureEnd(null);
            }}
          >
            Measure Spaces
          </button>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            title="Narrow spaces"
            onClick={() => setCellOverride(Math.max(24, activeCellPx - 8))}
          >
            Space -
          </button>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            title="Widen spaces"
            onClick={() => setCellOverride(Math.min(84, activeCellPx + 8))}
          >
            Space +
          </button>
          <span id="beat-map-info" className="muted small">{infoText}</span>
        </div>

        <div className="arena-scroll-wrap mt-sm">
          <BeatArenaCanvas
            id="beat-map-canvas"
            beat={beat}
            variant="modal"
            cellPxOverride={cellOverride}
            selectedTokenId={selectedTokenId}
            measureStart={measureStart}
            measureEnd={measureEnd}
            onCellClick={handleCellClick}
            onMeasuredLabel={(dist) => setInfoText(`Measured: ${dist} Spaces`)}
          />
        </div>
      </div>
    </div>
  );
}
