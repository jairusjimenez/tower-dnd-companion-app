import { useEffect, useState } from 'react';
import { useVtt } from '../../context/VttContext';

export function DmSessionModal() {
  const { dmSessionModalOpen, setDmSessionModalOpen, state, sendAction } = useVtt();
  const [title, setTitle] = useState(state?.session?.title || '');
  const [pausedMessage, setPausedMessage] = useState(state?.session?.pausedMessage || '');
  const [incrementSession, setIncrementSession] = useState(false);

  useEffect(() => {
    if (dmSessionModalOpen && state?.session) {
      setTitle(state.session.title || '');
      setPausedMessage(state.session.pausedMessage || '');
      setIncrementSession(false);
    }
  }, [dmSessionModalOpen, state?.session?.title, state?.session?.pausedMessage]);

  if (!dmSessionModalOpen || !state) return null;

  const isLive = state.session?.status === 'active';

  const handleControl = async (action: 'start' | 'stop') => {
    await sendAction('session_control', {
      action,
      title: title.trim() || state.session.title,
      pausedMessage: pausedMessage.trim() || state.session.pausedMessage,
      incrementSession: action === 'start' ? incrementSession : false,
    });
    setDmSessionModalOpen(false);
  };

  return (
    <div
      id="dm-session-modal"
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) setDmSessionModalOpen(false);
      }}
    >
      <div className="modal-card">
        <div className="panel-header">
          <h3>Session Gateway Control</h3>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            onClick={() => setDmSessionModalOpen(false)}
          >
            &times;
          </button>
        </div>

        <div className="stack-form mt-xs">
          <p className="muted small">
            Current Status: <b>{isLive ? 'SESSION LIVE' : 'SESSION STOPPED / VIEW ONLY'}</b> (Session #{state.session?.sessionNumber || 1})
          </p>
          <label>
            <span>Session Title</span>
            <input
              id="dm-sess-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            <span>Paused / Stopped Banner Message</span>
            <textarea
              id="dm-sess-pause-msg"
              rows={2}
              value={pausedMessage}
              onChange={(e) => setPausedMessage(e.target.value)}
            />
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={incrementSession}
              onChange={(e) => setIncrementSession(e.target.checked)}
            />
            <span>Increment Session Number when starting</span>
          </label>
          <div className="btn-row mt-xs">
            <button
              type="button"
              id="btn-sess-start"
              className="btn btn-cyan"
              onClick={() => handleControl('start')}
            >
              Start Session
            </button>
            <button
              type="button"
              id="btn-sess-stop"
              className="btn btn-danger"
              onClick={() => handleControl('stop')}
            >
              Stop / Pause Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
