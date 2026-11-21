import React, { useState } from 'react';
import { getFloorThemeLabel } from '@shared/index';
import { useVtt } from '../../context/VttContext';

type NpcFilter = 'All' | 'Manhwa' | 'D&D' | 'Custom';

const GENERATED_NPC_TEMPLATES = [
  {
    name: 'Kaelen the Ash-Scout',
    role: 'Dungeon Pathfiner',
    origin: 'D&D' as const,
    level: 5,
    stats: { STR: 12, AGI: 17, VIT: 13, INT: 13, PER: 18, LUCK: 14 },
    maxHp: 46,
    ac: 15,
    story: 'A scarred frontier ranger who survived three Red Gate collapses and charts hidden safe rooms for climbing parties.',
    dialogue: 'Keep your torch lit and check the rubble—there is a Rest Spot just past this ambush.',
  },
  {
    name: 'Sora of the White Shinsu',
    role: 'Wave Controller Mentor',
    origin: 'Manhwa' as const,
    level: 12,
    stats: { STR: 9, AGI: 15, VIT: 13, INT: 20, PER: 17, LUCK: 14 },
    maxHp: 74,
    ac: 15,
    story: 'A retired Ranker who teaches promising climbers how to compress Shinsu into piercing ranged spells.',
    dialogue: 'Do not force the flow. Breathe with the Tower, and your spell will cut twice as deep.',
  },
  {
    name: 'Aldric the Oathkeeper',
    role: 'Sanctuary Paladin',
    origin: 'D&D' as const,
    level: 8,
    stats: { STR: 17, AGI: 11, VIT: 16, INT: 12, PER: 14, LUCK: 13 },
    maxHp: 78,
    ac: 18,
    story: 'A silver-armored paladin sworn to guard Tower safe zones and bless climbers before boss chambers.',
    dialogue: 'Stand behind my shield if you need a breath. Evil shall not pass this threshold.',
  },
  {
    name: 'Yuri the Black-Blade',
    role: 'High-Ranker Guide',
    origin: 'Manhwa' as const,
    level: 20,
    stats: { STR: 20, AGI: 20, VIT: 18, INT: 14, PER: 17, LUCK: 16 },
    maxHp: 150,
    ac: 18,
    story: 'An eccentric, fiercely loyal High-Ranker who occasionally drops rare weapons on lower-floor Irregulars.',
    dialogue: 'You actually cleared that? Not bad, rookie! Take this and show me how far up you can climb!',
  },
];

export function DmNpcsTab() {
  const { state, sendAction, pushLocalToast } = useVtt();

  const unlockedFloors = [...(state?.map?.floors || [])].sort((a, b) => a.number - b.number);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('Tower Ally');
  const [origin, setOrigin] = useState<'Manhwa' | 'D&D' | 'Custom'>('Custom');
  const [level, setLevel] = useState(1);
  const [firstAppearedFloor, setFirstAppearedFloor] = useState(1);
  const [maxHp, setMaxHp] = useState(35);
  const [ac, setAc] = useState(13);
  const [stats, setStats] = useState({ STR: 10, AGI: 12, VIT: 11, INT: 12, PER: 12, LUCK: 10 });
  const [story, setStory] = useState('');
  const [dialogue, setDialogue] = useState('');

  const [filterOrigin, setFilterOrigin] = useState<NpcFilter>('All');

  if (!state) return null;

  const npcRoster = state.npcRoster || [];
  const filtered = npcRoster.filter((n) => filterOrigin === 'All' || (n.origin || 'Custom') === filterOrigin);

  const handleAutoFillNpc = () => {
    const pick = GENERATED_NPC_TEMPLATES[Math.floor(Math.random() * GENERATED_NPC_TEMPLATES.length)];
    setName(pick.name);
    setRole(pick.role);
    setOrigin(pick.origin);
    setLevel(pick.level);
    setFirstAppearedFloor(unlockedFloors[0]?.number || 1);
    setMaxHp(pick.maxHp);
    setAc(pick.ac);
    setStats({ ...pick.stats });
    setStory(pick.story);
    setDialogue(pick.dialogue);
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setRole('Tower Ally');
    setOrigin('Custom');
    setLevel(1);
    setFirstAppearedFloor(1);
    setMaxHp(35);
    setAc(13);
    setStats({ STR: 10, AGI: 12, VIT: 11, INT: 12, PER: 12, LUCK: 10 });
    setStory('');
    setDialogue('');
  };

  const handleCreateNpc = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) return;
    const isEdit = Boolean(editingId);
    const res = await sendAction<{ ok?: boolean }>('npc_action', {
      subAction: isEdit ? 'update' : 'add',
      id: editingId || undefined,
      name: name.trim(),
      role: role.trim() || 'Ally',
      origin,
      level,
      firstAppearedFloor,
      maxHp,
      ac,
      stats,
      story: story.trim(),
      dialogue: dialogue.trim(),
    });
    if (res?.ok) {
      pushLocalToast({
        title: isEdit ? 'NPC UPDATED' : 'NPC CREATED',
        message: `${name.trim()} (Lv ${level}, ${firstAppearedFloor}F) ${isEdit ? 'updated' : 'added to NPC Roster'}.`,
        category: 'loot',
      });
      resetForm();
    }
  };

  return (
    <div className="two-col">
      <div className="col stack">
        <div className="panel card-glow-cyan">
          <div className="panel-header">
            <h3>{editingId ? 'Edit NPC' : '+ Create NPC'}</h3>
            <div className="btn-row">
              {editingId && (
                <button type="button" className="btn btn-xs btn-outline" onClick={resetForm}>
                  Cancel Edit
                </button>
              )}
              <button type="button" className="btn btn-xs btn-cyan" onClick={handleAutoFillNpc}>
                Auto-Generate Manhwa / D&amp;D NPC
              </button>
            </div>
          </div>
          <form id="dm-npc-add-form" className="stack-form" onSubmit={handleCreateNpc}>
            <div className="grid-2">
              <label>
                <span>NPC Name</span>
                <input type="text" required placeholder="e.g. Headon the Gatekeeper" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                <span>Role / Title</span>
                <input type="text" placeholder="e.g. Floor 1 Guide, Blacksmith" value={role} onChange={(e) => setRole(e.target.value)} />
              </label>
            </div>
            <div className="grid-3">
              <label>
                <span>Origin</span>
                <select value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)}>
                  <option value="Custom">Custom</option>
                  <option value="Manhwa">Manhwa</option>
                  <option value="D&amp;D">D&amp;D</option>
                </select>
              </label>
              <label>
                <span>Level</span>
                <input type="number" min={1} max={100} value={level} onChange={(e) => setLevel(Math.max(1, Number(e.target.value || 1)))} />
              </label>
              <label>
                <span>First Appeared Floor</span>
                <select value={firstAppearedFloor} onChange={(e) => setFirstAppearedFloor(Number(e.target.value || 1))}>
                  {unlockedFloors.length > 0 ? (
                    unlockedFloors.map((fl) => (
                      <option key={fl.number} value={fl.number}>
                        {fl.number}F • {getFloorThemeLabel(fl.theme)}
                      </option>
                    ))
                  ) : (
                    <option value={1}>1F • Forest (Gate of Trials)</option>
                  )}
                </select>
              </label>
            </div>
            <div className="grid-2">
              <label><span>Max HP</span><input type="number" min={1} value={maxHp} onChange={(e) => setMaxHp(Math.max(1, Number(e.target.value || 1)))} /></label>
              <label><span>Armor Class (AC)</span><input type="number" min={1} value={ac} onChange={(e) => setAc(Math.max(1, Number(e.target.value || 10)))} /></label>
            </div>
            <div className="grid-3">
              {(['STR', 'AGI', 'VIT', 'INT', 'PER', 'LUCK'] as const).map((k) => (
                <label key={k}>
                  <span>{k}</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={stats[k]}
                    onChange={(e) => setStats((prev) => ({ ...prev, [k]: Math.max(1, Number(e.target.value || 10)) }))}
                  />
                </label>
              ))}
            </div>
            <label>
              <span>NPC Story / Backstory</span>
              <textarea rows={3} placeholder="Who is this NPC, what are their motives, and how do they help/challenge climbers?" value={story} onChange={(e) => setStory(e.target.value)} />
            </label>
            <label>
              <span>Default Dialogue</span>
              <input type="text" placeholder="What they say when players talk to them..." value={dialogue} onChange={(e) => setDialogue(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-cyan btn-lg">
              {editingId ? 'Save NPC Changes' : 'Save NPC to Roster'}
            </button>
          </form>
        </div>
      </div>

      <div className="col stack">
        <div className="panel">
          <div className="panel-header">
            <h3>NPC Roster &amp; Floor Appearances ({filtered.length})</h3>
          </div>
          <div className="demo-chips mb-xs">
            {(['All', 'Manhwa', 'D&D', 'Custom'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                className={`chip-btn ${filterOrigin === cat ? 'active' : ''}`}
                onClick={() => setFilterOrigin(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <div id="dm-npc-roster-list" className="list-stack" style={{ maxHeight: '580px', overflowY: 'auto' }}>
            {filtered.map((npc) => {
              // Merge recorded appearances + live Story Beats containing this NPC token
              const liveMatches = (state.storyBeats || [])
                .filter((b) => (b.arena?.tokens || []).some((t) => t.type === 'npc' && t.name.toLowerCase() === npc.name.toLowerCase()))
                .map((b) => ({ floor: b.floor, beatTitle: b.title, beatId: b.id }));
              const combined = [...(npc.appearances || [])];
              for (const lm of liveMatches) {
                if (!combined.some((a) => a.beatId === lm.beatId || (a.floor === lm.floor && a.beatTitle === lm.beatTitle))) {
                  combined.push(lm);
                }
              }

              return (
                <div key={npc.id} className="item-card">
                  <div className="item-card-top">
                    <strong>
                      {npc.name}{' '}
                      <span className={`tag ${npc.origin === 'Manhwa' ? 'tag-purple' : npc.origin === 'D&D' ? 'tag-cyan' : 'tag-gold'}`}>
                        {npc.origin || 'Custom'}
                      </span>{' '}
                      <span className="tag tag-green">Lv {npc.level}</span>{' '}
                      <span className="tag tag-gold">First Seen: {npc.firstAppearedFloor}F</span>
                    </strong>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        onClick={() => {
                          setEditingId(npc.id);
                          setName(npc.name);
                          setRole(npc.role);
                          setOrigin(npc.origin || 'Custom');
                          setLevel(npc.level);
                          setFirstAppearedFloor(npc.firstAppearedFloor);
                          setMaxHp(npc.maxHp);
                          setAc(npc.ac);
                          setStats({
                            STR: npc.stats?.STR ?? 10,
                            AGI: npc.stats?.AGI ?? 10,
                            VIT: npc.stats?.VIT ?? 10,
                            INT: npc.stats?.INT ?? 10,
                            PER: npc.stats?.PER ?? 10,
                            LUCK: npc.stats?.LUCK ?? 10,
                          });
                          setStory(npc.story || '');
                          setDialogue(npc.dialogue || '');
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-danger-outline"
                        onClick={() => sendAction('npc_action', { subAction: 'remove', id: npc.id })}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="small">
                    <strong>{npc.role}</strong> • HP <b>{npc.maxHp}</b> • AC <b>{npc.ac}</b>
                  </div>
                  <div className="small muted">
                    STR {npc.stats?.STR ?? 10} • AGI {npc.stats?.AGI ?? 10} • VIT {npc.stats?.VIT ?? 10} • INT {npc.stats?.INT ?? 10} • PER {npc.stats?.PER ?? 10} • LUCK {npc.stats?.LUCK ?? 10}
                  </div>
                  {npc.story && <div className="small mt-xs">{npc.story}</div>}
                  {npc.dialogue && <div className="small muted"><em>&ldquo;{npc.dialogue}&rdquo;</em></div>}
                  {combined.length > 0 && (
                    <div className="gacha-odds-bar mt-xs">
                      <span className="small muted">Showed Up On:</span>
                      {combined.map((a, idx) => (
                        <span key={`${npc.id}-app-${idx}`} className="tag tag-cyan">
                          {a.floor}F • {a.beatTitle}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
