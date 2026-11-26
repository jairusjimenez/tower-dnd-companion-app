import { useState } from 'react';
import { useVtt } from '../../context/VttContext';
import { DmChestsTab } from './DmChestsTab';
import { DmMapTab } from './DmMapTab';
import { DmMonstersTab } from './DmMonstersTab';
import { DmNpcsTab } from './DmNpcsTab';
import { DmPartyTab } from './DmPartyTab';
import { DmRulesTab } from './DmRulesTab';
import { DmSessionTab } from './DmSessionTab';
import { DmStoryTab } from './DmStoryTab';
import { DmTreasuresTab } from './DmTreasuresTab';

type DmTab = 'story' | 'map' | 'monsters' | 'npcs' | 'treasures' | 'chests' | 'rules' | 'party' | 'session';

const SECONDARY_DM_TABS: Array<{ id: DmTab; label: string; sub: string }> = [
  { id: 'map', label: 'Tower Map', sub: 'Floors & tokens' },
  { id: 'npcs', label: 'NPCs', sub: 'Roster & gifts' },
  { id: 'treasures', label: 'Treasures', sub: 'Loot catalog' },
  { id: 'chests', label: 'Chests', sub: 'Tier rewards' },
  { id: 'rules', label: 'Rules & Deities', sub: 'Formulas & gods' },
  { id: 'session', label: 'Invites & Log', sub: 'Chronicle & export' },
];

export function DmView() {
  const { state, logout, sendAction, setDmSessionModalOpen, setActiveBeatDetailId, pushLocalToast } = useVtt();
  const [activeTab, setActiveTab] = useState<DmTab>('story');
  const [moreOpen, setMoreOpen] = useState(false);

  if (!state) return null;

  const isLive = state.session?.status === 'active';
  const activePresentedBeat =
    (state.storyBeats || []).find((b) => b.presented && b.status !== 'completed') ||
    (state.storyBeats || []).find((b) => b.presented);
  const isSecondaryActive = SECONDARY_DM_TABS.some((t) => t.id === activeTab);

  const selectTab = (tab: DmTab) => {
    setActiveTab(tab);
    setMoreOpen(false);
  };

  const handleResetCampaign = async () => {
    if (!window.confirm('Reset the entire campaign back to initial Floor 1 state?')) return;
    await sendAction('reset_campaign', {});
    pushLocalToast({
      title: 'CAMPAIGN RESET',
      message: 'Campaign state reset to Floor 1 defaults.',
      category: 'warning',
    });
  };

  return (
    <section id="dm-view" className="view active app-shell dm-shell">
      <header className="topbar topbar-dm">
        <div className="topbar-left">
          <div>
            <div className="topbar-title-row">
              <strong>DM SANCTUM</strong>
              <span className="tag tag-gold">{state.session?.title || 'Tower Campaign'}</span>
            </div>
            <div className="topbar-sub">
              <span id="dm-session-pill" className={`status-pill ${isLive ? 'live' : 'stopped'}`}>
                {isLive ? 'SESSION LIVE' : 'SESSION STOPPED'}
              </span>
              <span id="dm-round-pill" className="status-pill">
                ROUND {state.combat?.round || 1}
              </span>
            </div>
          </div>
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            id="btn-dm-toggle-session"
            className={`btn btn-sm ${isLive ? 'btn-gold' : 'btn-cyan'}`}
            onClick={() => setDmSessionModalOpen(true)}
          >
            {isLive ? 'Stop Session' : 'Start Session'}
          </button>
          <button
            type="button"
            id="btn-dm-reset"
            className="btn btn-sm btn-outline dm-desktop-only"
            onClick={handleResetCampaign}
          >
            Reset
          </button>
          <button
            type="button"
            id="btn-dm-logout"
            className="btn btn-sm btn-danger dm-desktop-only"
            onClick={logout}
          >
            Exit
          </button>
        </div>
      </header>

      {activePresentedBeat && (
        <div className="dm-mobile-active-beat">
          <div className="dm-mobile-active-info">
            <span className="tag tag-gold">{activePresentedBeat.floor}F</span>
            <strong className="dm-mobile-active-title">{activePresentedBeat.title}</strong>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-gold"
            onClick={() => setActiveBeatDetailId(activePresentedBeat.id)}
          >
            Open Beat
          </button>
        </div>
      )}

      <nav id="dm-nav" className="subnav dm-nav">
        <button
          type="button"
          className={`nav-btn ${activeTab === 'story' ? 'active' : ''}`}
          data-dmtab="story"
          onClick={() => setActiveTab('story')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <span>Story Beats</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'map' ? 'active' : ''}`}
          data-dmtab="map"
          onClick={() => setActiveTab('map')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 4l6 2 5-2v14l-5 2-6-2-5 2V6l5-2z" />
          </svg>
          <span>Tower Map</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'monsters' ? 'active' : ''}`}
          data-dmtab="monsters"
          onClick={() => setActiveTab('monsters')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="10" r="6" />
            <path d="M9 16v3h6v-3" />
            <circle cx="10" cy="9.5" r="1" />
            <circle cx="14" cy="9.5" r="1" />
          </svg>
          <span>Monsters</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'npcs' ? 'active' : ''}`}
          data-dmtab="npcs"
          onClick={() => setActiveTab('npcs')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M5 20a7 7 0 0 1 14 0" />
          </svg>
          <span>NPCs</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'treasures' ? 'active' : ''}`}
          data-dmtab="treasures"
          onClick={() => setActiveTab('treasures')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="8" width="18" height="12" rx="2" />
            <path d="M3 12h18" />
            <path d="M12 10v4" />
            <path d="M7 8V6a5 5 0 0 1 10 0v2" />
          </svg>
          <span>Treasures</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'chests' ? 'active' : ''}`}
          data-dmtab="chests"
          onClick={() => setActiveTab('chests')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="2" y="9" width="20" height="11" rx="2" />
            <path d="M4 9C4 5 20 5 20 9" />
            <rect x="10" y="11" width="4" height="5" rx="1" />
          </svg>
          <span>Chests</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'rules' ? 'active' : ''}`}
          data-dmtab="rules"
          onClick={() => setActiveTab('rules')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>Rules &amp; Deities</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'party' ? 'active' : ''}`}
          data-dmtab="party"
          onClick={() => setActiveTab('party')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          </svg>
          <span>Party &amp; Dice</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'session' ? 'active' : ''}`}
          data-dmtab="session"
          onClick={() => setActiveTab('session')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          <span>Invites</span>
        </button>
      </nav>

      <main className="app-content">
        {activeTab === 'story' && <DmStoryTab />}
        {activeTab === 'map' && <DmMapTab />}
        {activeTab === 'monsters' && <DmMonstersTab />}
        {activeTab === 'npcs' && <DmNpcsTab />}
        {activeTab === 'treasures' && <DmTreasuresTab />}
        {activeTab === 'chests' && <DmChestsTab />}
        {activeTab === 'rules' && <DmRulesTab />}
        {activeTab === 'party' && <DmPartyTab />}
        {activeTab === 'session' && <DmSessionTab />}
      </main>

      {moreOpen && (
        <div className="dm-more-backdrop" role="dialog" aria-modal="true" aria-label="DM Tools Menu" onClick={() => setMoreOpen(false)}>
          <div className="dm-more-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="dm-more-head">
              <strong>DM Tools &amp; Setup</strong>
              <button type="button" className="btn btn-xs btn-outline" onClick={() => setMoreOpen(false)}>
                Close
              </button>
            </div>
            <div className="dm-more-grid">
              {SECONDARY_DM_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`dm-more-tile ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => selectTab(tab.id)}
                >
                  <strong>{tab.label}</strong>
                  <span>{tab.sub}</span>
                </button>
              ))}
            </div>
            <div className="dm-more-footer">
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={async () => {
                  setMoreOpen(false);
                  await handleResetCampaign();
                }}
              >
                Reset Campaign
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => {
                  setMoreOpen(false);
                  logout();
                }}
              >
                Exit / Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      <nav className="dm-mobile-dock" aria-label="DM Mobile Navigation">
        <button
          type="button"
          className={`dm-dock-btn ${activeTab === 'story' && !moreOpen ? 'active' : ''}`}
          onClick={() => selectTab('story')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <span>Beats</span>
        </button>
        <button
          type="button"
          className={`dm-dock-btn ${activeTab === 'party' && !moreOpen ? 'active' : ''}`}
          onClick={() => selectTab('party')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          </svg>
          <span>Party</span>
        </button>
        <button
          type="button"
          className={`dm-dock-btn ${activeTab === 'monsters' && !moreOpen ? 'active' : ''}`}
          onClick={() => selectTab('monsters')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="10" r="6" />
            <path d="M9 16v3h6v-3" />
            <circle cx="10" cy="9.5" r="1" />
            <circle cx="14" cy="9.5" r="1" />
          </svg>
          <span>Monsters</span>
        </button>
        <button
          type="button"
          className={`dm-dock-btn ${moreOpen || isSecondaryActive ? 'active' : ''}`}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <span>More</span>
        </button>
      </nav>
    </section>
  );
}
