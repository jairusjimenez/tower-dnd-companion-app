import { TowerOverviewList } from '../common/TowerOverviewList';

export function PlayerTowerTab({ onOpenBeat }: { onOpenBeat: (beatId: string) => void }) {
  return (
    <div className="panel map-panel card-glow-cyan">
      <div className="panel-header">
        <h3>Tower Overview</h3>
      </div>
      <div id="p-tower-floors-beats">
        <TowerOverviewList isDmView={false} onOpenBeat={onOpenBeat} />
      </div>
    </div>
  );
}
