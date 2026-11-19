import React, { useRef, useState } from 'react';
import type { SessionIdentity } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { apiFetch } from '../../services/api';

interface CheckIdentifierResponse {
  ok: boolean;
  found: boolean;
  activated?: boolean;
  requiresDmSetup?: boolean;
  email?: string;
  role?: 'dm' | 'player';
}

interface LoginResponse {
  ok: boolean;
  requiresDmSetup?: boolean;
  email?: string;
  firstTimeActivated?: boolean;
  session?: SessionIdentity;
}

export function LoginView() {
  const { enterSession, pushLocalToast } = useVtt();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [step2Ready, setStep2Ready] = useState(false);
  const [passwordLabel, setPasswordLabel] = useState('Password');
  const [errorMsg, setErrorMsg] = useState('');
  const [denied, setDenied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // First-time DM setup modal state
  const [dmSetupOpen, setDmSetupOpen] = useState(false);
  const [dmSetupEmail, setDmSetupEmail] = useState('jairusjimenez@live.com');
  const [dmSetupUsername, setDmSetupUsername] = useState('');
  const [dmSetupPassword, setDmSetupPassword] = useState('');
  const [dmSetupConfirm, setDmSetupConfirm] = useState('');
  const [dmSetupError, setDmSetupError] = useState('');

  const identifierRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  const resetStep = () => {
    setStep2Ready(false);
    setPassword('');
    setDenied(false);
    setErrorMsg('');
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErrorMsg('');
    setDenied(false);
    const trimmedId = identifier.trim();
    if (!trimmedId) return;

    setSubmitting(true);
    try {
      if (!step2Ready) {
        const check = await apiFetch<CheckIdentifierResponse>('/api/auth/check-identifier', {
          identifier: trimmedId,
        });
        if (check.requiresDmSetup) {
          setDmSetupEmail(check.email || 'jairusjimenez@live.com');
          setDmSetupError('');
          setDmSetupOpen(true);
          return;
        }
        setStep2Ready(true);
        setPasswordLabel(check.activated === false ? 'Create Password (First-Time Setup)' : 'Password');
        window.setTimeout(() => passwordRef.current?.focus(), 0);
        return;
      }

      const res = await apiFetch<LoginResponse>('/api/auth/login', {
        identifier: trimmedId,
        password,
      });
      if (res.requiresDmSetup) {
        setDmSetupEmail(res.email || 'jairusjimenez@live.com');
        setDmSetupError('');
        setDmSetupOpen(true);
        return;
      }
      if (res.session) {
        resetStep();
        await enterSession(res.session, { showOnboarding: Boolean(res.firstTimeActivated) });
        if (res.firstTimeActivated) {
          pushLocalToast({
            title: 'ACCOUNT ACTIVATED',
            message: 'Password saved! Customize your portrait and review your Tower objective before entering.',
            category: 'info',
          });
        }
      }
    } catch (err) {
      setDenied(true);
      setErrorMsg(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDmSetupSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setDmSetupError('');
    if (dmSetupPassword !== dmSetupConfirm) {
      setDmSetupError('Passwords do not match.');
      return;
    }
    try {
      const res = await apiFetch<{ ok: boolean; session: SessionIdentity }>('/api/auth/dm-setup', {
        email: dmSetupEmail,
        newUsername: dmSetupUsername.trim(),
        newPassword: dmSetupPassword,
      });
      setDmSetupOpen(false);
      setDmSetupUsername('');
      setDmSetupPassword('');
      setDmSetupConfirm('');
      await enterSession(res.session);
      pushLocalToast({
        title: 'DM ACCOUNT CREATED',
        message: `Welcome, ${res.session.username}! Your Dungeon Master credentials are now active.`,
        category: 'info',
      });
    } catch (err) {
      setDmSetupError(err instanceof Error ? err.message : 'Failed to activate DM account.');
    }
  };

  return (
    <>
      <main id="login-view" className={`view active ${denied ? 'login-denied' : ''}`}>
        <div className="login-stage">
          <svg className="tower-bg-art" viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <radialGradient id="towerAura" cx="50%" cy="32%" r="55%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
                <stop offset="45%" stopColor="#6366f1" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#070b14" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="spireBeam" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.7" />
                <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#070b14" stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect width="800" height="900" fill="url(#towerAura)" />
            <polygon points="400,45 480,860 320,860" fill="url(#spireBeam)" opacity="0.22" />
            <polygon points="400,90 432,860 368,860" fill="#0b1426" stroke="#38bdf8" strokeOpacity="0.28" strokeWidth="1.2" />
            <line x1="400" y1="30" x2="400" y2="880" stroke="#7dd3fc" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="6 8" />
            <g className="rune-ring" transform="translate(400 280)">
              <circle r="210" fill="none" stroke="#38bdf8" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="12 8" />
              <circle r="155" fill="none" stroke="#a855f7" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="4 10" />
            </g>
            <circle className="mote mote-1" cx="220" cy="240" r="2.5" fill="#7dd3fc" />
            <circle className="mote mote-2" cx="585" cy="210" r="2" fill="#c084fc" />
            <circle className="mote mote-3" cx="290" cy="540" r="2" fill="#38bdf8" />
            <circle className="mote mote-4" cx="520" cy="590" r="2.5" fill="#fbbf24" />
          </svg>

          <div className="login-shell">
            <header className="brand-banner">
              <div className="tower-crest" aria-hidden="true">
                <svg viewBox="0 0 64 64" width="46" height="46">
                  <defs>
                    <linearGradient id="crestGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e0f2fe" />
                      <stop offset="50%" stopColor="#38bdf8" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                  </defs>
                  <polygon points="32,4 44,54 20,54" fill="rgba(56,189,248,0.14)" stroke="url(#crestGrad)" strokeWidth="2" />
                  <line x1="32" y1="10" x2="32" y2="58" stroke="#7dd3fc" strokeWidth="1.6" />
                  <polygon points="32,18 39,27 32,36 25,27" fill="#38bdf8" fillOpacity="0.4" stroke="#e0f2fe" strokeWidth="1.2" />
                  <line x1="14" y1="54" x2="50" y2="54" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h1>The Tower</h1>
              <p className="brand-subtitle">DnD Companion App</p>
            </header>

            <section id="login-card" className="login-monolith">
              <form id="player-login-form" className="stack-form" onSubmit={handleSubmit}>
                <label htmlFor="login-identifier">
                  <span>Username or Email</span>
                  <input
                    ref={identifierRef}
                    id="login-identifier"
                    type="text"
                    autoComplete="username"
                    placeholder="Username or email"
                    readOnly={step2Ready}
                    required
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      if (denied || errorMsg || step2Ready) resetStep();
                    }}
                  />
                </label>

                {step2Ready && (
                  <div id="login-password-group" className="stack-form">
                    <label htmlFor="login-password">
                      <span id="login-password-label">{passwordLabel}</span>
                      <input
                        ref={passwordRef}
                        id="login-password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="Password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      id="btn-login-change-user"
                      className="btn btn-xs btn-outline"
                      style={{ alignSelf: 'flex-start' }}
                      onClick={() => {
                        resetStep();
                        window.setTimeout(() => identifierRef.current?.focus(), 0);
                      }}
                    >
                      Change Username / Email
                    </button>
                  </div>
                )}

                <button type="submit" id="btn-login-submit" className="btn btn-cyan btn-lg btn-glow-cyan" disabled={submitting}>
                  {submitting ? 'Entering...' : 'Enter The Tower'}
                </button>
              </form>

              {errorMsg && (
                <div id="player-login-error" className="error-box" role="alert">
                  {errorMsg}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      {dmSetupOpen && (
        <div id="dm-setup-modal" className="modal-backdrop">
          <div className="modal-card card-glow-gold" style={{ maxWidth: '460px' }}>
            <div className="panel-header">
              <h3>Dungeon Master First-Time Setup</h3>
              <button type="button" id="btn-close-dm-setup" className="btn btn-xs btn-outline" onClick={() => setDmSetupOpen(false)}>
                Close
              </button>
            </div>
            <p className="muted small">
              Welcome! Create your permanent Dungeon Master username and password for <strong id="dm-setup-email-label">{dmSetupEmail}</strong>.
            </p>
            <form id="dm-setup-form" className="stack-form mt-sm" onSubmit={handleDmSetupSubmit}>
              <label>
                <span>New DM Username</span>
                <input
                  id="dm-setup-username"
                  type="text"
                  minLength={2}
                  maxLength={32}
                  placeholder="e.g. SovereignDM"
                  required
                  value={dmSetupUsername}
                  onChange={(e) => setDmSetupUsername(e.target.value)}
                />
              </label>
              <label>
                <span>New DM Password</span>
                <input
                  id="dm-setup-password"
                  type="password"
                  minLength={4}
                  placeholder="At least 4 characters"
                  required
                  value={dmSetupPassword}
                  onChange={(e) => setDmSetupPassword(e.target.value)}
                />
              </label>
              <label>
                <span>Confirm Password</span>
                <input
                  id="dm-setup-confirm"
                  type="password"
                  minLength={4}
                  placeholder="Repeat password"
                  required
                  value={dmSetupConfirm}
                  onChange={(e) => setDmSetupConfirm(e.target.value)}
                />
              </label>
              {dmSetupError && (
                <div id="dm-setup-error" className="error-box">
                  {dmSetupError}
                </div>
              )}
              <button type="submit" className="btn btn-gold btn-lg btn-glow-gold">
                Activate &amp; Enter DM Command Center
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
