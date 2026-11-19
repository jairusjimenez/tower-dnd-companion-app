import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVtt } from '../../context/VttContext';
import { apiFetch } from '../../services/api';
import { compressPortraitFileToDataUrl } from '../../utils/imageUpload';

const ART_STYLES = [
  'Korean Manhwa Webtoon',
  'Dark Fantasy Concept',
  'Solo Glow Aura',
  'Arcane Tarot',
  'Retro Pixel Art',
];

const ART_CHIPS = [
  { label: 'Cyan Aura', prompt: 'glowing cyan shinsu aura' },
  { label: 'Crimson Blade', prompt: 'crimson fire greatsword' },
  { label: 'Shadow Daggers', prompt: 'purple shadow monarch daggers' },
  { label: 'Holy Armor', prompt: 'golden holy paladin armor' },
];

export function AccountModal() {
  const {
    accountModalOpen,
    setAccountModalOpen,
    session,
    state,
    sendAction,
    updateSessionIdentity,
    pushLocalToast,
  } = useVtt();

  const ch = session?.characterId ? state?.characters?.[session.characterId] : undefined;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState(session?.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [accMsg, setAccMsg] = useState('');

  const [artPrompt, setArtPrompt] = useState(ch?.portraitPrompt || '');
  const [artStyle, setArtStyle] = useState(ch?.portraitStyle || 'Korean Manhwa Webtoon');
  const [generatingArt, setGeneratingArt] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (accountModalOpen) {
      setNewUsername(session?.username || '');
      setCurrentPassword('');
      setNewPassword('');
      setAccMsg('');
      if (ch) {
        setArtPrompt(ch.portraitPrompt || '');
        setArtStyle(ch.portraitStyle || 'Korean Manhwa Webtoon');
      }
    }
  }, [accountModalOpen, session?.username, ch?.id]);

  const uniqueHistory = useMemo(() => {
    const seen = new Set<string>();
    return (ch?.artHistory || []).filter((a) => {
      if (!a?.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });
  }, [ch?.artHistory]);

  if (!accountModalOpen || !session || !ch) return null;

  const activeEntry = (ch.artHistory || []).find((a) => a.url === ch.portraitUrl);
  const isUploadedActive = activeEntry?.style === 'Custom Upload';

  const handleCredsSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setAccMsg('');
    try {
      const res = await apiFetch<{ ok: boolean; username: string; email: string; session?: typeof session }>(
        '/api/auth/update-credentials',
        {
          currentPassword,
          newUsername: newUsername.trim(),
          newPassword,
        },
      );
      if (res.session) {
        updateSessionIdentity(res.session);
      }
      setAccMsg('Account updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setAccMsg(err instanceof Error ? err.message : 'Failed to update credentials.');
    }
  };

  const handleSelectArtId = async (artId: string) => {
    await sendAction('generate_character_art', {
      characterId: ch.id,
      selectArtId: artId,
    });
  };

  const handleUseUploaded = async () => {
    const uploadedEntry = uniqueHistory.find((a) => a.style === 'Custom Upload');
    if (uploadedEntry) {
      await handleSelectArtId(uploadedEntry.id);
    } else {
      uploadInputRef.current?.click();
    }
  };

  const handleUseAi = async () => {
    const aiEntry = uniqueHistory.find((a) => a.style !== 'Custom Upload');
    if (aiEntry) {
      await handleSelectArtId(aiEntry.id);
    } else {
      await handleGenerateAi();
    }
  };

  const handleUploadChange = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressPortraitFileToDataUrl(file);
      await sendAction('generate_character_art', {
        characterId: ch.id,
        uploadedImageDataUrl: dataUrl,
        prompt: 'Uploaded Portrait',
        style: 'Custom Upload',
      });
      pushLocalToast({ title: 'PORTRAIT UPLOADED', message: 'Your uploaded portrait is now active!', category: 'loot' });
    } catch (err) {
      pushLocalToast({
        title: 'UPLOAD FAILED',
        message: err instanceof Error ? err.message : 'Could not process image.',
        category: 'warning',
      });
    } finally {
      ev.target.value = '';
    }
  };

  const handleGenerateAi = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    setGeneratingArt(true);
    try {
      const res = await sendAction<{ engine?: string }>('generate_character_art', {
        characterId: ch.id,
        prompt: artPrompt.trim() || ch.name,
        style: artStyle,
      });
      pushLocalToast({
        title: 'PORTRAIT UPDATED',
        message: `Generated character art via ${res?.engine || 'arcane-synth'}.`,
        category: 'loot',
      });
    } finally {
      setGeneratingArt(false);
    }
  };

  return (
    <div id="account-modal" className="modal-backdrop">
      <div className="modal-card modal-wide" style={{ width: '85vw', maxWidth: '85vw', maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="panel-header">
          <h3>Player Account Settings</h3>
          <button
            type="button"
            id="btn-close-account-modal"
            className="btn btn-xs btn-outline"
            onClick={() => setAccountModalOpen(false)}
          >
            Close
          </button>
        </div>

        <div className="two-col mt-xs">
          <form id="account-update-form" className="stack-form" onSubmit={handleCredsSubmit}>
            <div className="panel-subheader"><span>Credentials</span></div>
            <label>
              <span>Bound Email</span>
              <input id="acc-email" type="text" value={session.email || ''} disabled />
            </label>
            <label>
              <span>Current Password (required to apply changes)</span>
              <input
                id="acc-current-pw"
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>
            <label>
              <span>New Username</span>
              <input
                id="acc-new-username"
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
              />
            </label>
            <label>
              <span>New Password (optional — leave blank to keep current)</span>
              <input
                id="acc-new-pw"
                type="password"
                minLength={4}
                placeholder="Enter new password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <div id="acc-msg" className="muted small">{accMsg}</div>
            <button type="submit" className="btn btn-cyan">Update Username / Password</button>
          </form>

          <div className="stack-form">
            <div className="panel-subheader">
              <span>Character Art</span>
              <span className="tag tag-cyan">AI PROMPT</span>
            </div>
            <div className="portrait-stage mb-xs">
              <img id="p-art-preview" className="portrait-lg" src={ch.portraitUrl || ''} alt="Generated Character Art" />
            </div>

            <div id="p-art-history" className="art-thumbs mt-xs">
              {uniqueHistory.map((entry) => {
                const isCurrent = entry.url === ch.portraitUrl;
                return (
                  <img
                    key={entry.id}
                    className="art-thumb"
                    src={entry.url}
                    alt={entry.prompt || entry.style || 'Portrait'}
                    title={entry.prompt || entry.style || 'Portrait'}
                    style={isCurrent ? { border: '2px solid #38bdf8', boxShadow: '0 0 8px rgba(56,189,248,0.5)' } : undefined}
                    onClick={() => handleSelectArtId(entry.id)}
                  />
                );
              })}
            </div>

            <div className="btn-row mt-xs" style={{ gap: '8px' }}>
              <button
                type="button"
                id="btn-p-use-uploaded"
                className={`btn btn-xs ${isUploadedActive ? 'btn-cyan' : 'btn-outline'}`}
                onClick={handleUseUploaded}
              >
                Use Uploaded Image
              </button>
              <button
                type="button"
                id="btn-p-use-ai"
                className={`btn btn-xs ${!isUploadedActive ? 'btn-cyan' : 'btn-outline'}`}
                onClick={handleUseAi}
              >
                Use AI-Generated Art
              </button>
            </div>

            <label className="mt-xs">
              <span>Upload Your Own Image</span>
              <input
                ref={uploadInputRef}
                id="p-art-upload"
                type="file"
                accept="image/*"
                onChange={handleUploadChange}
              />
            </label>

            <form id="p-art-form" className="stack-form mt-xs" onSubmit={handleGenerateAi}>
              <label>
                <span>Prompt</span>
                <textarea
                  id="p-art-prompt"
                  rows={2}
                  placeholder="Describe race, weapon, armor, aura..."
                  value={artPrompt}
                  onChange={(e) => setArtPrompt(e.target.value)}
                />
              </label>
              <label>
                <span>Style</span>
                <select id="p-art-style" value={artStyle} onChange={(e) => setArtStyle(e.target.value)}>
                  {ART_STYLES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <div className="demo-chips">
                {ART_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    className="chip-btn"
                    onClick={() => setArtPrompt((prev) => (prev ? `${prev}, ${chip.prompt}` : chip.prompt))}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
              <button type="submit" className="btn btn-cyan btn-glow-cyan" disabled={generatingArt}>
                {generatingArt ? 'Generating...' : 'Generate Art'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
