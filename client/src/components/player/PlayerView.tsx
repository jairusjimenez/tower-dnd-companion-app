import { useEffect, useState } from 'react';
import { useVtt } from '../../context/VttContext';
import { PlayerInventoryTab } from './PlayerInventoryTab';
import { PlayerSpellsTab } from './PlayerSpellsTab';
import { PlayerStatsTab } from './PlayerStatsTab';
import { PlayerTowerTab } from './PlayerTowerTab';

type PlayerTab = 'stats' | 'inventory' | 'magic' | 'map';

export function PlayerView() {
  const {
    session,
    state,
    showOnboarding,
    setShowOnboarding,
    logout,
    sendAction,
    pushLocalToast,
    setAccountModalOpen,
    setActiveBeatDetailId,
    lastAutoOpenedBeatId,
    setLastAutoOpenedBeatId,
    setActiveBeatMapId,
  } = useVtt();

  const [activeTab, setActiveTab] = useState<PlayerTab>('stats');

  const ch = session?.characterId ? state?.characters?.[session.characterId] : undefined;
  const isLive = state?.session?.status === 'active';

  const activeBeat = state
    ? (state.storyBeats || []).slice().reverse().find((b) => b.presented && b.status === 'active')
      || (state.storyBeats || []).slice().reverse().find((b) => b.presented)
    : undefined;

  useEffect(() => {
    if (isLive && !showOnboarding && activeBeat && lastAutoOpenedBeatId !== activeBeat.id) {
      setLastAutoOpenedBeatId(activeBeat.id);
      setActiveBeatDetailId(activeBeat.id);
      window.scrollTo(0, 0);
    }
  }, [isLive, showOnboarding, activeBeat?.id, lastAutoOpenedBeatId, setLastAutoOpenedBeatId, setActiveBeatDetailId]);

  if (!session || !state || !ch) return null;

  const pendingReaction = (state.pendingReactions || []).find((r) => r.targetCharacterId === ch.id);
  const affordableSpell =
    (ch.spells || []).find((s) => s.actionType === 'Reaction' && Number(ch.mp || 0) >= Number(s.mpCost || 0))
    || (ch.spells || []).find((s) => Number(ch.mp || 0) >= Number(s.mpCost || 0));

  const resolveReaction = async (choice: 'counter' | 'parry' | 'spell' | 'accept') => {
    if (!pendingReaction) return;
    const res = await sendAction<{ summary?: string }>('resolve_reaction', {
      reactionId: pendingReaction.id,
      choice,
      spellId: affordableSpell?.id,
    });
    if (res?.summary) {
      pushLocalToast({ title: 'REACTION RESOLVED', message: res.summary, category: 'combat' });
    }
  };

  const isDead = Number(ch.hp ?? 0) <= 0;

  return (
    <section id="player-view" className={`view active app-shell player-shell pview-shell${isDead ? ' is-dead-view' : ''}`}>
      {/* CONCEPT B HERO CARD */}
      <header className="phero-wrap">
        <div className="phero-card">
          <div className="phero-top">
            <div className="phero-avatar-ring">
              <img id="p-top-avatar" className="phero-avatar" src={ch.portraitUrl || ''} alt="Character Portrait" />
            </div>
            <div className="phero-identity">
              <strong id="p-top-name" className="phero-name">
                {ch.name}
              </strong>
              <div className="phero-meta">
                <span id="p-top-rank" className="tag tag-cyan">
                  {ch.rank} &bull; Lv {ch.level}
                </span>
                <span id="p-session-pill" className={`phero-live-pill ${isLive ? 'is-live' : 'is-paused'}`}>
                  <span className="phero-live-dot" aria-hidden="true" />
                  {isLive ? 'Live' : 'Paused'}
                </span>
              </div>
            </div>
            <div className="phero-actions">
              <button
                type="button"
                id="btn-open-account-modal"
                className="btn btn-xs btn-outline"
                onClick={() => setAccountModalOpen(true)}
              >
                Account
              </button>
              <button
                type="button"
                id="btn-p-logout"
                className="btn btn-xs btn-danger-outline"
                onClick={logout}
              >
                Exit
              </button>
            </div>
          </div>

          {activeBeat && isLive && (
            <button
              type="button"
              id="btn-p-goto-beat"
              className="phero-beat-cta"
              onClick={() => {
                setActiveBeatDetailId(activeBeat.id);
                window.scrollTo(0, 0);
              }}
            >
              <span>Enter Active Story Beat &mdash; {activeBeat.title}</span>
              <span aria-hidden="true">&rarr;</span>
            </button>
          )}
        </div>
      </header>

      {!isLive && (
        <div id="p-session-stopped-banner" className="alert-banner warning phero-alert">
          <div>
            <strong>SESSION PAUSED</strong>{' '}
            <span id="p-session-paused-msg">{state.session?.pausedMessage || 'Waiting for DM...'}</span>
          </div>
        </div>
      )}

      {ch.pendingCharacterResetOffer && (
        <div id="p-reset-offer-banner" className="alert-banner warning phero-alert" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <strong>CHARACTER RESET OFFERED</strong>{' '}
            <span>The Dungeon Master offered to reset your character back to Level 1 and restart onboarding.</span>
          </div>
          <div className="btn-row">
            <button
              type="button"
              id="btn-accept-char-reset"
              className="btn btn-sm btn-gold"
              onClick={async () => {
                if (!window.confirm('Reset your character back to Level 1 and restart onboarding? Your current stats, gear, and spells will be cleared.')) {
                  return;
                }
                const res = await sendAction<{ reset?: boolean }>('respond_character_reset_offer', {
                  characterId: ch.id,
                  decision: 'accept',
                });
                if (res?.reset) {
                  setActiveBeatDetailId(null);
                  setShowOnboarding(true);
                  window.scrollTo(0, 0);
                }
              }}
            >
              Accept &amp; Reset
            </button>
            <button
              type="button"
              id="btn-decline-char-reset"
              className="btn btn-sm btn-outline"
              onClick={() => sendAction('respond_character_reset_offer', { characterId: ch.id, decision: 'decline' })}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {pendingReaction && (
        <div id="p-reaction-banner" className="reaction-banner phero-alert">
          <div className="reaction-info">
            <span className="tag tag-crimson">REACTION</span>
            <strong id="p-reaction-text">
              {pendingReaction.monsterName} strikes you ({pendingReaction.attackTotal} to hit, {pendingReaction.incomingDamage} incoming dmg)!
            </strong>
          </div>
          <div className="reaction-actions">
            <button type="button" id="btn-react-counter" className="btn btn-sm btn-crimson" onClick={() => resolveReaction('counter')}>
              Counter
            </button>
            <button type="button" id="btn-react-parry" className="btn btn-sm btn-cyan" onClick={() => resolveReaction('parry')}>
              Parry
            </button>
            <button
              type="button"
              id="btn-react-spell"
              className="btn btn-sm btn-purple"
              disabled={!affordableSpell}
              onClick={() => resolveReaction('spell')}
            >
              Spell
            </button>
            <button type="button" id="btn-react-accept" className="btn btn-sm btn-outline" onClick={() => resolveReaction('accept')}>
              Take Hit
            </button>
          </div>
        </div>
      )}

      <div className={`app-content pview-content ${!isLive ? 'session-readonly' : ''}`} id="player-panels">
        {activeTab === 'stats' && (
          <PlayerStatsTab
            ch={ch}
            onOpenBeat={(id) => {
              setActiveBeatDetailId(id);
              window.scrollTo(0, 0);
            }}
            onOpenBeatMap={(id) => setActiveBeatMapId(id)}
          />
        )}
        {activeTab === 'inventory' && <PlayerInventoryTab ch={ch} />}
        {activeTab === 'magic' && <PlayerSpellsTab ch={ch} />}
        {activeTab === 'map' && (
          <PlayerTowerTab
            onOpenBeat={(id) => {
              setActiveBeatDetailId(id);
              window.scrollTo(0, 0);
            }}
          />
        )}
      </div>

      {/* CONCEPT C FIXED BOTTOM NAVIGATION BAR */}
      <nav className="pbottom-nav" id="player-nav" aria-label="Player sections">
        <button
          type="button"
          className={`pbottom-nav-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 20V10M18 20V4M6 20v-4" />
          </svg>
          <span>Stats</span>
        </button>
        <button
          type="button"
          className={`pbottom-nav-btn ${activeTab === 'inventory' ? 'active' : ''}`}
          onClick={() => setActiveTab('inventory')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M5 7h14l1 13H4L5 7z" />
            <path d="M9 7V5a3 3 0 0 1 6 0v2" />
            <path d="M12 11v5M9.5 13.5h5" />
          </svg>
          <span>Gear</span>
        </button>
        <button
          type="button"
          className={`pbottom-nav-btn ${activeTab === 'magic' ? 'active' : ''}`}
          onClick={() => setActiveTab('magic')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <path d="M12 7l1 2.5L15.5 10.5 13 11.5 12 14l-1-2.5L8.5 10.5 11 9.5 12 7z" />
          </svg>
          <span>Spells</span>
        </button>
        <button
          type="button"
          className={`pbottom-nav-btn ${activeTab === 'map' ? 'active' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 4l6 2 5-2v14l-5 2-6-2-5 2V6l5-2z" />
            <path d="M9 4v14M15 6v14" />
          </svg>
          <span>Tower</span>
        </button>
      </nav>
    </section>
  );
}
