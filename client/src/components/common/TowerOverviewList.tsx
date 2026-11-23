import { useVtt } from '../../context/VttContext';

export function TowerOverviewList({
  isDmView = false,
  onOpenBeat,
}: {
  isDmView?: boolean;
  onOpenBeat: (beatId: string) => void;
}) {
  const { state, sendAction } = useVtt();
  if (!state?.map?.floors) return null;

  const floors = [...state.map.floors].sort((a, b) => a.number - b.number);
  const mapTokens = state.map.tokens || [];
  const charsMap = state.characters || {};

  const handleDeleteFloor = async (floorNumber: number, floorTitle: string) => {
    if (!window.confirm(`Delete ${floorTitle}? Story beats and monsters on this floor will also be removed.`)) return;
    await sendAction('update_map', { subAction: 'delete_floor', floorNumber });
  };

  return (
    <div className="list-stack mt-sm">
      {floors.map((fl) => {
        const theme = (fl.theme || 'obsidian').toUpperCase();
        const beats = (state.storyBeats || []).filter(
          (b) => Number(b.floor) === Number(fl.number) && (isDmView || b.presented),
        );
        const activeBeats = beats.filter((b) => b.presented || b.status === 'active');
        const resolvedBeats = beats.filter((b) => b.status === 'resolved');

        const floorPlayerTokens = mapTokens.filter(
          (t) => t.type === 'player' && t.y >= fl.rowStart && t.y <= fl.rowEnd,
        );

        const openedChests = beats.reduce(
          (n, b) => n + (b.arena?.chests || []).filter((c) => c.opened).length,
          0,
        );
        const talkedNpcs = beats.reduce(
          (n, b) => n + (b.arena?.tokens || []).filter((t) => t.type === 'npc' && t.rewardClaimed).length,
          0,
        );
        const defeatedMons = (state.monsters || []).filter(
          (m) => Number(m.floor) === Number(fl.number) && ((m.hp !== null && m.hp <= 0) || m.healthTier === 'Defeated'),
        ).length;
        const livingMonsCount = beats.reduce((sum, b) => {
          const monTokens = (b.arena?.tokens || []).filter((t) => {
            if (t.type !== 'monster') return false;
            const liveMon = (state.monsters || []).find((m) => m.id === t.id);
            return liveMon ? (liveMon.hp === null || liveMon.hp > 0) : (t.hp === null || t.hp > 0);
          });
          return sum + monTokens.length;
        }, 0);
        const floorLogs = (state.combatLog || [])
          .filter((l) => (l.summary || '').includes(`${fl.number}F`))
          .slice(0, 3);

        const summaryParts = isDmView
          ? [
              `${beats.length} Story Beat${beats.length === 1 ? '' : 's'} (${activeBeats.length} active, ${resolvedBeats.length} resolved)`,
              defeatedMons ? `${defeatedMons} monster${defeatedMons === 1 ? '' : 's'} defeated` : '',
              openedChests ? `${openedChests} chest${openedChests === 1 ? '' : 's'} opened` : '',
              talkedNpcs ? `${talkedNpcs} NPC reward${talkedNpcs === 1 ? '' : 's'} claimed` : '',
            ]
              .filter(Boolean)
              .join(' • ')
          : [
              `${beats.length} Active Scene${beats.length === 1 ? '' : 's'}`,
              livingMonsCount > 0
                ? `${livingMonsCount} Monster${livingMonsCount === 1 ? '' : 's'} detected`
                : 'No active monsters detected',
            ].join(' • ');

        return (
          <div key={fl.number} className="panel" style={{ padding: '10px 12px' }}>
            <div className="panel-header">
              <strong>{fl.title}</strong>
              <div className="btn-row" style={{ alignItems: 'center' }}>
                <span className="tag tag-green">{theme}</span>
                {isDmView && floors.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-xs btn-danger-outline"
                    onClick={() => handleDeleteFloor(fl.number, fl.title)}
                  >
                    Delete Floor
                  </button>
                )}
              </div>
            </div>

            {fl.description && (
              <div className="muted small" style={{ marginTop: '2px' }}>
                {fl.description}
              </div>
            )}
            <div className="small" style={{ marginTop: '6px' }}>
              <b>Overview:</b> {summaryParts}
            </div>
            {isDmView && floorLogs.length > 0 && (
              <div className="muted small" style={{ marginTop: '3px' }}>
                Recent: {floorLogs.map((l) => l.summary).join(' | ')}
              </div>
            )}

            {isDmView && (
              <>
                <div className="small" style={{ marginTop: '6px' }}>
                  <b>Players on {fl.number}F:</b>
                </div>
                {floorPlayerTokens.length > 0 ? (
                  <div className="stat-pills" style={{ marginTop: '6px' }}>
                    {floorPlayerTokens.map((pt) => {
                      const ch = charsMap[pt.id];
                      const hp = ch ? ch.hp : pt.hp ?? 0;
                      const maxHp = ch ? ch.maxHp : pt.maxHp ?? 0;
                      const mp = ch ? ch.mp : null;
                      const maxMp = ch ? ch.maxMp : null;
                      const statusText = hp <= 0 ? 'Downed' : maxHp && hp <= maxHp * 0.5 ? 'Wounded' : 'Healthy';
                      const condText = ch?.conditions?.length ? ` • ${ch.conditions.join(', ')}` : '';
                      return (
                        <span key={pt.id} className="stat-pill">
                          <b>{ch?.name || pt.name}</b> (Lv {ch?.level || 1}) • HP {hp}/{maxHp}
                          {mp !== null ? ` • MP ${mp}/${maxMp}` : ''} • <i>{statusText}{condText}</i>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <div className="muted small" style={{ marginTop: '6px' }}>
                    No players currently on this floor.
                  </div>
                )}
              </>
            )}

            <div className="small" style={{ marginTop: '8px' }}>
              <b>Story Beats on {fl.number}F:</b>
            </div>
            {beats.length > 0 ? (
              beats.map((b) => {
                const isCurrent = Boolean(b.presented) || b.status === 'active';
                const beatMonCount = (b.arena?.tokens || []).filter((t) => {
                  if (t.type !== 'monster') return false;
                  const liveMon = (state.monsters || []).find((m) => m.id === t.id);
                  return liveMon ? (liveMon.hp === null || liveMon.hp > 0) : (t.hp === null || t.hp > 0);
                }).length;
                return (
                  <div key={b.id} className={`item-card ${isCurrent ? 'card-glow-cyan' : ''}`} style={{ marginTop: '6px' }}>
                    <div className="item-card-top">
                      <strong>
                        {b.title}{' '}
                        {isCurrent ? (
                          <span className="tag tag-cyan">CURRENT BEAT</span>
                        ) : (
                          <span className="tag tag-gold">{String(b.status || 'upcoming').toUpperCase()}</span>
                        )}
                        {!isDmView && beatMonCount > 0 && (
                          <span className="tag tag-crimson" style={{ marginLeft: '6px' }}>
                            {beatMonCount} Monster{beatMonCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </strong>
                      <button type="button" className="btn btn-xs btn-gold" onClick={() => onOpenBeat(b.id)}>
                        View Beat
                      </button>
                    </div>
                    {b.narration && <div className="muted small">{b.narration}</div>}
                  </div>
                );
              })
            ) : (
              <div className="muted small" style={{ marginTop: '4px' }}>
                No story beats on this floor yet.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
