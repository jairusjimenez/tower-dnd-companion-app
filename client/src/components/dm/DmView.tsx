import { useState } from 'react';
import { useVtt } from '../../context/VttContext';
import { DmMapTab } from './DmMapTab';
import { DmPartyTab } from './DmPartyTab';
import { DmRulesTab } from './DmRulesTab';
import { DmSessionTab } from './DmSessionTab';
import { DmStoryTab } from './DmStoryTab';

type DmTab = 'story' | 'map' | 'rules' | 'party' | 'session';

export function DmView() {
  const { state, logout, sendAction, setDmSessionModalOpen, pushLocalToast } = useVtt();
  const [activeTab, setActiveTab] = useState<DmTab>('story');

  if (!state) return null;

  const isLive = state.session?.status === 'active';

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
            className="btn btn-sm btn-outline"
            onClick={handleResetCampaign}
          >
            Reset
          </button>
          <button
            type="button"
            id="btn-dm-logout"
            className="btn btn-sm btn-danger"
            onClick={logout}
          >
            Exit
          </button>
        </div>
      </header>

      <nav id="dm-nav" className="subnav dm-nav">
        <button
          type="button"
          className={`nav-btn ${activeTab === 'story' ? 'active' : ''}`}
          data-dmtab="story"
          onClick={() => setActiveTab('story')}
        >
          Story Beats
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'map' ? 'active' : ''}`}
          data-dmtab="map"
          onClick={() => setActiveTab('map')}
        >
          Tower Map
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'rules' ? 'active' : ''}`}
          data-dmtab="rules"
          onClick={() => setActiveTab('rules')}
        >
          Rules &amp; Deities
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'party' ? 'active' : ''}`}
          data-dmtab="party"
          onClick={() => setActiveTab('party')}
        >
          Party &amp; Dice
        </button>
        <button
          type="button"
          className={`nav-btn ${activeTab === 'session' ? 'active' : ''}`}
          data-dmtab="session"
          onClick={() => setActiveTab('session')}
        >
          Invites
        </button>
      </nav>

      <main className="app-content">
        {activeTab === 'story' && <DmStoryTab />}
        {activeTab === 'map' && <DmMapTab />}
        {activeTab === 'rules' && <DmRulesTab />}
        {activeTab === 'party' && <DmPartyTab />}
        {activeTab === 'session' && <DmSessionTab />}
      </main>
    </section>
  );
}
