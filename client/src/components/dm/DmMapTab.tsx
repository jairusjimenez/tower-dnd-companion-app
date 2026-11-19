import React, { useEffect, useRef, useState } from 'react';
import { getTowerGridCellFromClient } from '../../canvas/coordinates';
import { drawTowerCanvas } from '../../canvas/drawTowerMap';
import { useVtt } from '../../context/VttContext';
import { TowerOverviewList } from '../common/TowerOverviewList';

const FLOOR_THEMES = ['forest', 'desert', 'underworld', 'plains', 'frost', 'obsidian'];

export function DmMapTab() {
  const { state, sendAction, setActiveBeatDetailId } = useVtt();

  const [newFloorTheme, setNewFloorTheme] = useState('auto');
  const [towerPreset, setTowerPreset] = useState('classic');
  const [mapTool, setMapTool] = useState<'move' | 'reveal' | 'fog' | 'ping' | 'measure'>('move');
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number } | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{ x: number; y: number } | null>(null);
  const [portraitRev, setPortraitRev] = useState(0);
  const towerCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Bestiary & Monster Spawner state
  const bestiary = state?.bestiary || [];
  const [bestiaryId, setBestiaryId] = useState('');
  const [monName, setMonName] = useState('');
  const [monFloor, setMonFloor] = useState(2);
  const [monHp, setMonHp] = useState(30);
  const [monAc, setMonAc] = useState(14);
  const [monDr, setMonDr] = useState(1);
  const [monRange, setMonRange] = useState(2);
  const [monAtk, setMonAtk] = useState('1d20+5');
  const [monDmg, setMonDmg] = useState('1d8+3');
  const [monLootItem, setMonLootItem] = useState('');
  const [monLootGold, setMonLootGold] = useState(0);
  const [monLootXp, setMonLootXp] = useState(0);
  const [monHidden, setMonHidden] = useState(false);

  const [atkMonsterId, setAtkMonsterId] = useState('');
  const [atkPlayerId, setAtkPlayerId] = useState('');
  const [customDmg, setCustomDmg] = useState('');

  useEffect(() => {
    if (!bestiaryId && bestiary[0]) {
      const b0 = bestiary[0];
      setBestiaryId(b0.id);
      setMonName(b0.name);
      setMonHp(b0.maxHp);
      setMonAc(b0.ac);
      setMonDr(b0.dr);
      setMonRange(b0.rangeSpaces || 2);
      setMonAtk(b0.attackFormula);
      setMonDmg(b0.damageFormula);
    }
  }, [bestiary.length]);

  useEffect(() => {
    const living = (state?.monsters || []).filter((m) => m.hp === null || m.hp > 0);
    const chars = Object.values(state?.characters || {});
    if (living.length === 0) {
      if (atkMonsterId) setAtkMonsterId('');
    } else if (!living.some((m) => m.id === atkMonsterId)) {
      setAtkMonsterId(living[0].id);
    }
    if (chars.length > 0 && !chars.some((c) => c.id === atkPlayerId)) {
      setAtkPlayerId(chars[0].id);
    }
  }, [atkMonsterId, atkPlayerId, state?.monsters, state?.characters]);

  useEffect(() => {
    const canvas = towerCanvasRef.current;
    if (!canvas || !state) return;
    drawTowerCanvas({
      canvas,
      state,
      isDmView: true,
      selectedTokenId,
      measureStart,
      measureEnd,
      onPortraitLoaded: () => setPortraitRev((r) => r + 1),
    });
  }, [state, selectedTokenId, measureStart, measureEnd, portraitRev]);

  if (!state) return null;

  const floors = [...(state.map?.floors || [])].sort((a, b) => a.number - b.number);
  const mons = state.monsters || [];
  const chars = Object.values(state.characters || {});
  const turnIdx = state.combat?.turnIndex || 0;

  const handleTowerClick = async (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = towerCanvasRef.current;
    if (!canvas) return;
    const cell = getTowerGridCellFromClient(canvas, ev.clientX, ev.clientY, state);
    if (!cell) return;

    if (mapTool === 'move') {
      const hit = (state.map.tokens || []).find((t) => t.x === cell.x && t.y === cell.y);
      if (hit) {
        setSelectedTokenId(hit.id);
      } else if (selectedTokenId) {
        await sendAction('move_token', { tokenId: selectedTokenId, x: cell.x, y: cell.y });
      }
    } else if (mapTool === 'reveal') {
      await sendAction('update_map', { subAction: 'toggle_fog_cell', x: cell.x, y: cell.y, covered: false });
    } else if (mapTool === 'fog') {
      await sendAction('update_map', { subAction: 'toggle_fog_cell', x: cell.x, y: cell.y, covered: true });
    } else if (mapTool === 'ping') {
      await sendAction('update_map', { subAction: 'ping', x: cell.x, y: cell.y });
    } else if (mapTool === 'measure') {
      if (!measureStart || measureEnd !== null) {
        setMeasureStart(cell);
        setMeasureEnd(null);
      } else {
        setMeasureEnd(cell);
      }
    }
  };

  const handleSpawnMonster = async (ev: React.FormEvent) => {
    ev.preventDefault();
    await sendAction('spawn_monster', {
      name: monName.trim(),
      floor: monFloor,
      maxHp: monHp,
      ac: monAc,
      dr: monDr,
      rangeSpaces: monRange,
      attackFormula: monAtk.trim(),
      damageFormula: monDmg.trim(),
      hiddenFromPlayers: monHidden,
      loot: { itemName: monLootItem.trim(), gold: monLootGold, xp: monLootXp },
    });
  };

  return (
    <div className="stack">
      <div className="panel map-panel">
        <div className="panel-header">
          <h3>DM Vertical Tower Controller</h3>
        </div>
        <div className="dm-map-controls">
          <select
            value={newFloorTheme}
            onChange={(e) => setNewFloorTheme(e.target.value)}
            aria-label="New Floor Theme"
            style={{ width: 'auto', minHeight: '32px', padding: '4px 8px' }}
          >
            <option value="auto">Auto Theme (1F Forest, 2F Desert, 3F Underworld)</option>
            {FLOOR_THEMES.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
          <button
            type="button"
            id="btn-dm-add-floor"
            className="btn btn-sm btn-gold"
            onClick={() =>
              sendAction('update_map', {
                subAction: 'add_floor',
                theme: newFloorTheme === 'auto' ? '' : newFloorTheme,
                startFogged: true,
              })
            }
          >
            + Add Higher Tower Floor
          </button>
          <button
            type="button"
            id="btn-dm-reveal-all"
            className="btn btn-sm btn-cyan"
            onClick={() => sendAction('update_map', { subAction: 'set_fog_bulk', mode: 'reveal_all' })}
          >
            Reveal Entire Tower
          </button>
          <button
            type="button"
            id="btn-dm-cover-all"
            className="btn btn-sm btn-outline"
            onClick={() => sendAction('update_map', { subAction: 'set_fog_bulk', mode: 'cover_all' })}
          >
            Fog All
          </button>
        </div>

        <div id="dm-tower-theme-designer" className="arena-controls mt-xs">
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <strong className="small" style={{ color: 'var(--gold)' }}>Design Entire Tower by Themes:</strong>
            <select
              value={towerPreset}
              onChange={(e) => setTowerPreset(e.target.value)}
              aria-label="Tower Theme Preset"
              style={{ width: 'auto', minHeight: '32px', padding: '4px 8px' }}
            >
              <option value="classic">1F Forest -&gt; 2F Desert -&gt; 3F Underworld (3+ Floors)</option>
              <option value="all_forest">All Floors: Forest</option>
              <option value="all_desert">All Floors: Desert</option>
              <option value="all_underworld">All Floors: Underworld</option>
              <option value="all_obsidian">All Floors: Obsidian</option>
            </select>
            <button
              type="button"
              id="btn-dm-apply-tower-preset"
              className="btn btn-xs btn-cyan"
              onClick={() =>
                sendAction('update_map', {
                  subAction: 'apply_tower_themes',
                  preset: towerPreset,
                  ensureFloors: towerPreset === 'classic' ? 3 : undefined,
                })
              }
            >
              Apply Tower Theme
            </button>
          </div>
          <div id="dm-floor-theme-rows" className="demo-chips mt-xs">
            {floors.map((fl) => (
              <label key={fl.number} className="chip-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <span>{fl.number}F:</span>
                <select
                  value={fl.theme}
                  style={{ width: 'auto', minHeight: '26px', padding: '2px 6px' }}
                  onChange={(e) =>
                    sendAction('update_map', { subAction: 'set_floor_theme', floorNumber: fl.number, theme: e.target.value })
                  }
                >
                  {FLOOR_THEMES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div id="dm-floor-fog-buttons" className="btn-row mt-xs">
            {floors.map((f) => (
              <React.Fragment key={f.number}>
                <button
                  type="button"
                  className="btn btn-xs btn-outline"
                  onClick={() => sendAction('update_map', { subAction: 'floor_fog', floorNumber: f.number, covered: false })}
                >
                  Reveal {f.number}F
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-outline"
                  onClick={() => sendAction('update_map', { subAction: 'floor_fog', floorNumber: f.number, covered: true })}
                >
                  Fog {f.number}F
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="btn-row mt-xs">
          {(
            [
              { k: 'move', label: 'Move Token' },
              { k: 'reveal', label: 'Reveal Cell' },
              { k: 'fog', label: 'Fog Cell' },
              { k: 'ping', label: 'Ping Cell' },
              { k: 'measure', label: 'Measure' },
            ] as const
          ).map((t) => (
            <button
              key={t.k}
              type="button"
              className={`btn btn-xs btn-outline ${mapTool === t.k ? 'active' : ''}`}
              onClick={() => setMapTool(t.k)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="tower-scroll-wrap mt-xs">
          <canvas ref={towerCanvasRef} id="dm-tower-canvas" onClick={handleTowerClick} />
        </div>

        <div id="dm-tower-floors-beats">
          <TowerOverviewList isDmView onOpenBeat={(id) => setActiveBeatDetailId(id)} />
        </div>
      </div>

      <div className="two-col">
        <div className="col stack">
          <div className="panel">
            <div className="panel-header"><h3>Add / Summon Monster</h3></div>
            <form id="dm-spawn-monster-form" className="stack-form" onSubmit={handleSpawnMonster}>
              <label>
                <span>Bestiary Preset</span>
                <select
                  value={bestiaryId}
                  onChange={(e) => {
                    const b = bestiary.find((x) => x.id === e.target.value);
                    setBestiaryId(e.target.value);
                    if (b) {
                      setMonName(b.name);
                      setMonHp(b.maxHp);
                      setMonAc(b.ac);
                      setMonDr(b.dr);
                      setMonRange(b.rangeSpaces || 2);
                      setMonAtk(b.attackFormula);
                      setMonDmg(b.damageFormula);
                    }
                  }}
                >
                  {bestiary.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} (HP {b.maxHp} / AC {b.ac} / DR {b.dr})
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid-2">
                <label><span>Monster Name</span><input type="text" required value={monName} onChange={(e) => setMonName(e.target.value)} /></label>
                <label><span>Tower Floor</span><input type="number" min={1} max={100} value={monFloor} onChange={(e) => setMonFloor(Number(e.target.value || 1))} /></label>
              </div>
              <div className="grid-4">
                <label><span>Max HP</span><input type="number" min={1} value={monHp} onChange={(e) => setMonHp(Number(e.target.value || 1))} /></label>
                <label><span>AC</span><input type="number" value={monAc} onChange={(e) => setMonAc(Number(e.target.value || 10))} /></label>
                <label><span>DR</span><input type="number" value={monDr} onChange={(e) => setMonDr(Number(e.target.value || 0))} /></label>
                <label><span>Range (Sp)</span><input type="number" value={monRange} onChange={(e) => setMonRange(Number(e.target.value || 1))} /></label>
              </div>
              <div className="grid-2">
                <label><span>Attack Roll</span><input type="text" value={monAtk} onChange={(e) => setMonAtk(e.target.value)} /></label>
                <label><span>Damage Dice</span><input type="text" value={monDmg} onChange={(e) => setMonDmg(e.target.value)} /></label>
              </div>
              <div className="grid-3">
                <label><span>Loot Drop Item (opt.)</span><input type="text" placeholder="e.g. Core Shard" value={monLootItem} onChange={(e) => setMonLootItem(e.target.value)} /></label>
                <label><span>Drop Gold</span><input type="number" min={0} value={monLootGold} onChange={(e) => setMonLootGold(Number(e.target.value || 0))} /></label>
                <label><span>Drop XP</span><input type="number" min={0} value={monLootXp} onChange={(e) => setMonLootXp(Number(e.target.value || 0))} /></label>
              </div>
              <label className="checkbox-row">
                <input type="checkbox" checked={monHidden} onChange={(e) => setMonHidden(e.target.checked)} />
                <span>Spawn Hidden in Fog of War (DM Eyes Only)</span>
              </label>
              <button type="submit" className="btn btn-crimson btn-lg">Add Monster to Floor &amp; Tracker</button>
            </form>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h3>Initiative &amp; Turns</h3>
              <div className="btn-row">
                <button type="button" className="btn btn-xs btn-outline" onClick={() => sendAction('initiative_action', { subAction: 'prev_turn' })}>Prev</button>
                <button type="button" className="btn btn-xs btn-cyan" onClick={() => sendAction('initiative_action', { subAction: 'next_turn' })}>Next Turn</button>
                <button type="button" className="btn btn-xs btn-gold" onClick={() => sendAction('initiative_action', { subAction: 'roll_all' })}>Roll All</button>
              </div>
            </div>
            <div id="dm-initiative-list" className="list-stack">
              {(state.combat?.combatants || []).map((c, idx) => (
                <div key={c.id} className="item-card" style={idx === turnIdx ? { borderColor: 'var(--gold)' } : undefined}>
                  <div className="item-card-top">
                    <strong>{idx === turnIdx ? '▶ ' : ''}{c.name}</strong>
                    <span>Init: <b>{c.initiative}</b> • HP {c.hp}/{c.maxHp}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col stack">
          <div className="panel card-glow-crimson">
            <div className="panel-header">
              <h3>Live Monster HP &amp; Reactive Attacks</h3>
              <span className="tag tag-crimson">REAL-TIME HP</span>
            </div>
            <div className="attack-trigger-bar">
              <select value={atkMonsterId} onChange={(e) => setAtkMonsterId(e.target.value)}>
                {mons.filter((m) => m.hp === null || m.hp > 0).map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.hp}/{m.maxHp} HP)</option>
                ))}
              </select>
              <select value={atkPlayerId} onChange={(e) => setAtkPlayerId(e.target.value)}>
                {chars.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} (HP {c.hp}/{c.maxHp})</option>
                ))}
              </select>
              <input type="number" placeholder="Auto dmg" value={customDmg} onChange={(e) => setCustomDmg(e.target.value)} />
              <button
                type="button"
                className="btn btn-crimson"
                onClick={() => {
                  if (!atkMonsterId || !atkPlayerId) return;
                  sendAction('monster_attack', { monsterId: atkMonsterId, targetCharacterId: atkPlayerId, customDamage: customDmg });
                }}
              >
                Trigger Monster Attack
              </button>
            </div>
            <div id="dm-monsters-list" className="list-stack mt-sm">
              {mons.map((m) => {
                const hp = Number(m.hp ?? 0);
                const maxHp = Number(m.maxHp ?? 1);
                const pct = maxHp ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
                return (
                  <div key={m.id} className="item-card">
                    <div className="item-card-top">
                      <strong>
                        {m.name} <span className="tag tag-crimson">{m.floor}F</span>
                        {m.hiddenFromPlayers && <span className="tag tag-gold">HIDDEN</span>}
                      </strong>
                      <span>HP: <b>{hp}/{maxHp}</b> • AC {m.ac} • DR {m.dr}</span>
                    </div>
                    <div className="progress"><div className="progress-fill monster" style={{ width: `${pct}%` }} /></div>
                    <div className="btn-row">
                      <button type="button" className="btn btn-xs btn-outline" onClick={() => sendAction('update_monster', { monsterId: m.id, hpDelta: -5 })}>-5 HP</button>
                      <button type="button" className="btn btn-xs btn-outline" onClick={() => sendAction('update_monster', { monsterId: m.id, hpDelta: -1 })}>-1</button>
                      <button type="button" className="btn btn-xs btn-outline" onClick={() => sendAction('update_monster', { monsterId: m.id, hpDelta: 5 })}>+5</button>
                      <button type="button" className="btn btn-xs btn-cyan" onClick={() => sendAction('update_monster', { monsterId: m.id, hiddenFromPlayers: !m.hiddenFromPlayers })}>
                        {m.hiddenFromPlayers ? 'Reveal' : 'Hide'}
                      </button>
                      <button type="button" className="btn btn-xs btn-danger-outline" onClick={() => sendAction('update_monster', { monsterId: m.id, remove: true })}>Remove</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><h3>Real-Time Combat &amp; Damage Feed</h3></div>
            <div id="dm-combat-log" className="feed-list">
              {(state.combatLog || []).map((c) => (
                <div key={c.id} className="feed-entry combat">{c.summary}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
