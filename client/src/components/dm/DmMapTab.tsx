import React, { useState } from 'react';
import { FLOOR_THEMES, type FloorThemeOption } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { TowerOverviewList } from '../common/TowerOverviewList';

const THEME_GROUPS: FloorThemeOption['group'][] = ['Core Biomes', 'Manhwa Tower Floors', 'D&D Realms & Dungeons'];

function renderThemeOptions() {
  return THEME_GROUPS.map((group) => (
    <optgroup key={group} label={group}>
      {FLOOR_THEMES.filter((t) => t.group === group).map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </optgroup>
  ));
}

export function DmMapTab() {
  const { state, sendAction, setActiveBeatDetailId } = useVtt();

  const [newFloorTheme, setNewFloorTheme] = useState('auto');
  const [towerPreset, setTowerPreset] = useState('classic');

  if (!state) return null;

  const floors = [...(state.map?.floors || [])].sort((a, b) => a.number - b.number);

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
            {renderThemeOptions()}
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
              <option value="manhwa_climb">Manhwa Climb (Floor of Tests -&gt; Red Gate -&gt; Demon Castle)</option>
              <option value="dnd_planes">D&amp;D Realms (Feywild -&gt; Underdark -&gt; Nine Hells)</option>
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
                  ensureFloors: towerPreset === 'classic' || towerPreset === 'manhwa_climb' || towerPreset === 'dnd_planes' ? 3 : undefined,
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
                  {renderThemeOptions()}
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

        <div id="dm-tower-floors-beats">
          <TowerOverviewList isDmView onOpenBeat={(id) => setActiveBeatDetailId(id)} />
        </div>
      </div>
    </div>
  );
}
