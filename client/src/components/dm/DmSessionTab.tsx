import React, { useState } from 'react';
import { useVtt } from '../../context/VttContext';

export function DmSessionTab() {
  const { state, sendAction, pushLocalToast, setDmCharModalId } = useVtt();

  const [email, setEmail] = useState('');
  const [characterId, setCharacterId] = useState('__new__');
  const [characterName, setCharacterName] = useState('');
  const [race, setRace] = useState('Human');
  const [className, setClassName] = useState('Tower Climber');

  const [toastTitle, setToastTitle] = useState('');
  const [toastCategory, setToastCategory] = useState<'info' | 'combat' | 'loot' | 'warning'>('info');
  const [toastTarget, setToastTarget] = useState('all');
  const [toastMessage, setToastMessage] = useState('');

  if (!state) return null;

  const chars = Object.values(state.characters || {});
  const invites = Object.values(state.playerAccounts || {});
  const history = (state.playerHistory || []).slice(0, 40);

  const handleAddInvite = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      pushLocalToast({ title: 'INVALID EMAIL', message: 'Please enter a valid player email address.', category: 'warning' });
      return;
    }
    const res = await sendAction<{ ok?: boolean }>('dm_manage_invites', {
      subAction: 'add',
      email: cleanEmail,
      characterId,
      characterName: characterName.trim() || cleanEmail.split('@')[0],
      race: race.trim() || 'Human',
      className: className.trim() || 'Tower Climber',
    });
    if (res?.ok) {
      setEmail('');
      setCharacterName('');
      pushLocalToast({ title: 'PLAYER INVITED', message: `Bound ${cleanEmail} to character roster.`, category: 'info' });
    }
  };

  const handleBroadcast = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const msg = toastMessage.trim();
    if (!msg) return;
    const res = await sendAction<{ ok?: boolean }>('broadcast_toast', {
      title: toastTitle.trim() || undefined,
      category: toastCategory,
      target: toastTarget,
      message: msg,
    });
    if (res?.ok) {
      setToastMessage('');
    }
  };

  return (
    <div className="two-col">
      <div className="col stack">
        <div className="panel card-glow-cyan">
          <div className="panel-header">
            <h3>Invite Player &amp; Bind Email</h3>
            <span className="tag tag-cyan">RBAC ROSTER</span>
          </div>
          <form id="dm-invite-form" className="stack-form" onSubmit={handleAddInvite}>
            <label>
              <span>Player Email</span>
              <input
                id="inv-email"
                type="email"
                required
                placeholder="climber@tower.gg"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              <span>Character Assignment</span>
              <select
                id="inv-char-select"
                value={characterId}
                onChange={(e) => setCharacterId(e.target.value)}
              >
                <option value="__new__">+ Create New Character</option>
                {chars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (Lv {c.level} {c.className})
                  </option>
                ))}
              </select>
            </label>
            {characterId === '__new__' && (
              <div className="two-col">
                <label>
                  <span>Character Name</span>
                  <input
                    id="inv-char-name"
                    type="text"
                    placeholder="Aria Vane"
                    value={characterName}
                    onChange={(e) => setCharacterName(e.target.value)}
                  />
                </label>
                <label>
                  <span>Race / Class</span>
                  <div className="btn-row">
                    <input
                      id="inv-char-race"
                      type="text"
                      placeholder="Race"
                      value={race}
                      onChange={(e) => setRace(e.target.value)}
                    />
                    <input
                      id="inv-char-class"
                      type="text"
                      placeholder="Class"
                      value={className}
                      onChange={(e) => setClassName(e.target.value)}
                    />
                  </div>
                </label>
              </div>
            )}
            <button type="submit" className="btn btn-cyan">Invite / Bind Player Email</button>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Registered Players ({invites.length})</h3>
          </div>
          <div id="dm-invites-list" className="list-stack">
            {invites.length === 0 ? (
              <p className="muted small">No invited players yet. Add a player email above so they can log in.</p>
            ) : (
              invites.map((acc) => {
                const boundChar = state.characters?.[acc.characterId];
                return (
                  <div key={acc.email} className="item-card">
                    <div className="item-card-top">
                      <strong>{acc.email}</strong>
                      <span className={`tag ${acc.activated ? 'tag-cyan' : 'tag-gold'}`}>
                        {acc.activated ? `Active (${acc.username})` : 'Pending Password Setup'}
                      </span>
                    </div>
                    <div className="muted small">
                      Character: {boundChar ? `${boundChar.name} (Lv ${boundChar.level} ${boundChar.className})` : 'Unassigned'}
                    </div>
                    <div className="btn-row mt-xs">
                      {boundChar && (
                        <button
                          type="button"
                          className="btn btn-xs btn-cyan"
                          onClick={() => setDmCharModalId(boundChar.id)}
                        >
                          View Character
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        onClick={() => sendAction('dm_manage_invites', { subAction: 'reset_activation', email: acc.email })}
                      >
                        Reset Password Setup
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-danger"
                        onClick={() => sendAction('dm_manage_invites', { subAction: 'remove', email: acc.email })}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="col stack">
        <div className="panel card-glow-gold">
          <div className="panel-header">
            <h3>System Broadcast Alert</h3>
            <span className="tag tag-gold">LIVE SSE TOAST</span>
          </div>
          <form id="dm-toast-form" className="stack-form" onSubmit={handleBroadcast}>
            <div className="two-col">
              <label>
                <span>Category</span>
                <select
                  value={toastCategory}
                  onChange={(e) => setToastCategory(e.target.value as 'info' | 'combat' | 'loot' | 'warning')}
                >
                  <option value="info">System Info (Cyan)</option>
                  <option value="warning">System Warning (Gold)</option>
                  <option value="combat">Boss / Combat Alert (Red)</option>
                  <option value="loot">Quest Reward / Loot (Gold)</option>
                </select>
              </label>
              <label>
                <span>Recipient</span>
                <select value={toastTarget} onChange={(e) => setToastTarget(e.target.value)}>
                  <option value="all">All Connected Players</option>
                  {chars.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} Only</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>Custom Title (optional)</span>
              <input
                type="text"
                placeholder="SYSTEM NOTIFICATION"
                value={toastTitle}
                onChange={(e) => setToastTitle(e.target.value)}
              />
            </label>
            <label>
              <span>Message</span>
              <textarea
                rows={2}
                required
                placeholder="Floor Guardian awakens across the stone hall..."
                value={toastMessage}
                onChange={(e) => setToastMessage(e.target.value)}
              />
            </label>
            <button type="submit" className="btn btn-gold">Broadcast System Toast</button>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Player Activity History Log</h3>
          </div>
          <div id="dm-player-history-log" className="feed-list">
            {history.length === 0 ? (
              <p className="muted small">No player actions recorded yet.</p>
            ) : (
              history.map((h) => (
                <div key={h.id} className="feed-entry">
                  <strong>{h.characterName}</strong> <span className="muted small">[{h.category}]</span>: {h.summary}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
