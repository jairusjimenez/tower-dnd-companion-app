import React, { useEffect, useMemo, useState } from 'react';
import { useVtt } from '../../context/VttContext';

const DEFAULT_DOC_URL = 'https://docs.google.com/document/d/1uBWEitKlPfFP_Z5tmSYKqRzuForlwv1tgnnS6lyAK6U/edit';
const DEFAULT_FOLDER_URL = 'https://drive.google.com/drive/folders/1fY8URu1zmJKB6sKNtDza-V0fNsGdFRNW?usp=sharing';

export function DmChroniclePanel() {
  const { state, sendAction, pushLocalToast } = useVtt();
  const currentNum = Math.max(1, Number(state?.currentSessionNumber || 1));
  const [selectedSession, setSelectedSession] = useState<number>(currentNum);
  const [noteInput, setNoteInput] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [directorNotes, setDirectorNotes] = useState('');
  const [narrativeDraft, setNarrativeDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const recaps = state?.sessionRecaps || [];
  const allEntries = state?.sessionChronicle || [];

  const sessionNumbers = useMemo(() => {
    const nums = new Set<number>([currentNum]);
    for (const r of recaps) nums.add(r.sessionNumber);
    for (const e of allEntries) nums.add(e.sessionNumber);
    return [...nums].sort((a, b) => b - a);
  }, [currentNum, recaps, allEntries]);

  const activeRecap = recaps.find((r) => r.sessionNumber === selectedSession);
  const sessionEntries = useMemo(
    () => allEntries.filter((e) => e.sessionNumber === selectedSession),
    [allEntries, selectedSession],
  );

  useEffect(() => {
    setTitleDraft(activeRecap?.title || `Session #${selectedSession}`);
    setDirectorNotes(activeRecap?.directorNotes || '');
    setNarrativeDraft(activeRecap?.generatedNarrative || '');
  }, [selectedSession, activeRecap?.title, activeRecap?.directorNotes, activeRecap?.generatedNarrative]);

  if (!state) return null;

  const integrations = state.chronicleIntegrations;
  const targetDocUrl = integrations?.targetDocUrl || DEFAULT_DOC_URL;
  const targetFolderUrl = integrations?.targetFolderUrl || DEFAULT_FOLDER_URL;

  const downloadFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadJson = () => {
    const payload = {
      sessionNumber: selectedSession,
      title: titleDraft || `Session #${selectedSession}`,
      exportedAt: new Date().toISOString(),
      directorNotes,
      party: Object.values(state.characters || {}).map((c) => ({
        name: c.name,
        level: c.level,
        race: c.race,
        className: c.className,
        hp: `${c.hp}/${c.maxHp}`,
        weapon: c.equipment?.mainHand?.name || 'Unarmed',
      })),
      events: sessionEntries,
    };
    downloadFile(`tower-session-${selectedSession}.json`, JSON.stringify(payload, null, 2), 'application/json');
  };

  const handleDownloadMarkdown = () => {
    const lines = [
      `# ${titleDraft || `Session #${selectedSession}`}`,
      `- **Events:** ${sessionEntries.length}`,
      directorNotes.trim() ? `\n## DM Director Notes\n${directorNotes.trim()}\n` : '',
      '## Chronological Log',
      ...sessionEntries.map((e) => `- \`${e.timestamp.slice(11, 19)}\` [${e.floor}F] **(${e.category.toUpperCase()})** ${e.summary}${e.details ? `\n  > ${e.details}` : ''}`),
    ];
    downloadFile(`tower-session-${selectedSession}.md`, lines.filter(Boolean).join('\n'), 'text/markdown');
  };

  const handleAddNote = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const text = noteInput.trim();
    if (!text) return;
    const res = await sendAction<{ ok?: boolean }>('chronicle_action', {
      subAction: 'add_note',
      sessionNumber: selectedSession,
      text,
    });
    if (res?.ok) {
      setNoteInput('');
      pushLocalToast({ title: 'TABLE NOTE LOGGED', message: 'Added note to Session Chronicle.', category: 'info' });
    }
  };

  const handleNewSession = async () => {
    const res = await sendAction<{ ok?: boolean; currentSessionNumber?: number }>('chronicle_action', {
      subAction: 'start_new_session',
    });
    if (res?.ok && res.currentSessionNumber) {
      setSelectedSession(res.currentSessionNumber);
      pushLocalToast({
        title: `SESSION #${res.currentSessionNumber} OPENED`,
        message: 'Chronicle rolled over to a fresh session.',
        category: 'loot',
      });
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await sendAction<{ ok?: boolean; recap?: { generatedNarrative?: string; modelUsed?: string } }>(
        'chronicle_action',
        {
          subAction: 'generate_narrative',
          sessionNumber: selectedSession,
          title: titleDraft.trim() || `Session #${selectedSession}`,
          directorNotes,
        },
      );
      if (res?.ok && res.recap?.generatedNarrative) {
        setNarrativeDraft(res.recap.generatedNarrative);
        pushLocalToast({
          title: 'LITRPG CHAPTER READY',
          message: `Narrated with ${res.recap.modelUsed || 'Gemini'} (Dungeon Crawler Carl AI).`,
          category: 'loot',
        });
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    const res = await sendAction<{ ok?: boolean }>('chronicle_action', {
      subAction: 'save_narrative',
      sessionNumber: selectedSession,
      title: titleDraft.trim() || `Session #${selectedSession}`,
      directorNotes,
      generatedNarrative: narrativeDraft,
    });
    if (res?.ok) {
      pushLocalToast({ title: 'CHAPTER SAVED', message: 'Saved narrative draft to server state.', category: 'info' });
    }
  };

  const handleExportDoc = async () => {
    if (!narrativeDraft.trim()) {
      pushLocalToast({ title: 'NO CHAPTER YET', message: 'Generate or paste a chapter first.', category: 'warning' });
      return;
    }
    setExporting(true);
    try {
      const res = await sendAction<{ ok?: boolean; docUrl?: string; appendedBlocks?: number }>('chronicle_action', {
        subAction: 'export_google_doc',
        sessionNumber: selectedSession,
        title: titleDraft.trim() || `Session #${selectedSession}`,
        markdown: narrativeDraft,
      });
      if (res?.ok) {
        pushLocalToast({
          title: 'EXPORTED TO GOOGLE DOC',
          message: `Appended ${res.appendedBlocks ?? ''} blocks to Tower Chronicle Doc!`,
          category: 'loot',
        });
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div id="dm-chronicle-panel" className="panel card-glow-gold mb-md">
      <div className="panel-header">
        <div className="btn-row" style={{ alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Session Chronicle &amp; LitRPG Narrator</h3>
          <span className="tag tag-gold">{sessionEntries.length} Events</span>
          <span className={`tag ${integrations?.geminiConfigured ? 'tag-green' : 'tag-outline'}`}>
            Gemini: {integrations?.geminiConfigured ? 'Ready' : 'No Key'}
          </span>
          <span className={`tag ${integrations?.webhookConfigured ? 'tag-cyan' : 'tag-outline'}`}>
            Google Doc Webhook: {integrations?.webhookConfigured ? 'Ready' : 'Not Set'}
          </span>
        </div>
        <div className="btn-row" style={{ gap: '6px', flexWrap: 'wrap' }}>
          <a href={targetFolderUrl} target="_blank" rel="noreferrer" className="btn btn-xs btn-outline">
            Tower DnD Folder
          </a>
          <a href={targetDocUrl} target="_blank" rel="noreferrer" className="btn btn-xs btn-cyan">
            Open Google Doc
          </a>
          <button type="button" id="btn-chronicle-new-session" className="btn btn-xs btn-gold" onClick={handleNewSession}>
            + New Session #{currentNum + 1}
          </button>
        </div>
      </div>

      <div className="grid-2" style={{ gap: '12px', marginTop: '8px' }}>
        <div className="stack">
          <div className="btn-row" style={{ gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 160px' }}>
              <span>Session</span>
              <select
                id="chronicle-session-select"
                value={selectedSession}
                onChange={(e) => setSelectedSession(Number(e.target.value || currentNum))}
              >
                {sessionNumbers.map((num) => (
                  <option key={num} value={num}>
                    Session #{num} {num === currentNum ? '(Current)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-sm btn-outline" onClick={handleDownloadJson}>
              Download JSON
            </button>
            <button type="button" className="btn btn-sm btn-outline" onClick={handleDownloadMarkdown}>
              Download .MD
            </button>
          </div>

          <form onSubmit={handleAddNote} className="btn-row" style={{ gap: '6px', alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              <span>Quick Table-Talk Note (Jokes / Spoken RP)</span>
              <input
                id="chronicle-note-input"
                type="text"
                placeholder="e.g. Party spent 10 minutes arguing with a locked door..."
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
              />
            </label>
            <button type="submit" id="btn-chronicle-add-note" className="btn btn-sm btn-cyan">
              + Add Note
            </button>
          </form>

          <label>
            <span>Chapter Title</span>
            <input
              id="chronicle-title-input"
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder={`Session #${selectedSession} — Into The Tower`}
            />
          </label>

          <label>
            <span>DM Director&apos;s Notes (Optional context for the Narrator)</span>
            <textarea
              id="chronicle-director-notes"
              rows={3}
              placeholder="Spoken banter, character voice moments, MVP shoutouts..."
              value={directorNotes}
              onChange={(e) => setDirectorNotes(e.target.value)}
            />
          </label>

          <div className="btn-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              id="btn-chronicle-generate"
              className="btn btn-gold"
              disabled={generating}
              onClick={handleGenerate}
            >
              {generating ? 'Narrating (Tower AI)...' : 'Narrate Chapter (Dungeon Crawler Carl AI)'}
            </button>
          </div>

          <details className="sub-details">
            <summary>Recent Session Events ({sessionEntries.length})</summary>
            <div className="list-stack mt-xs" style={{ maxHeight: '220px', overflowY: 'auto' }}>
              {sessionEntries.length === 0 ? (
                <div className="muted small">No events captured in Session #{selectedSession} yet.</div>
              ) : (
                [...sessionEntries].reverse().slice(0, 25).map((ev) => (
                  <div key={ev.id} className="item-card" style={{ padding: '6px 10px' }}>
                    <div className="item-card-top">
                      <span className="tag tag-outline">{ev.category.toUpperCase()}</span>
                      <span className="muted small">{ev.floor}F • {ev.timestamp.slice(11, 19)}</span>
                    </div>
                    <div className="small">{ev.summary}</div>
                  </div>
                ))
              )}
            </div>
          </details>
        </div>

        <div className="stack">
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <span>LitRPG Chapter Draft (Editable Markdown • &ldquo;&gt; &rdquo; blocks become System Boxes in Google Docs)</span>
            <textarea
              id="chronicle-narrative-draft"
              rows={15}
              placeholder="Click 'Narrate Chapter' to generate your Dungeon Crawler Carl style recap, or paste a chapter from Antigravity here..."
              value={narrativeDraft}
              onChange={(e) => setNarrativeDraft(e.target.value)}
            />
          </label>
          <div className="btn-row" style={{ gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" id="btn-chronicle-save" className="btn btn-sm btn-outline" onClick={handleSaveDraft}>
              Save Draft
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={!narrativeDraft.trim()}
              onClick={async () => {
                await navigator.clipboard.writeText(narrativeDraft);
                pushLocalToast({ title: 'COPIED', message: 'Chapter Markdown copied to clipboard.', category: 'info' });
              }}
            >
              Copy Text
            </button>
            <button
              type="button"
              id="btn-chronicle-export-doc"
              className="btn btn-sm btn-cyan"
              disabled={exporting || !narrativeDraft.trim()}
              onClick={handleExportDoc}
            >
              {exporting ? 'Exporting to Doc...' : 'Export to Google Doc'}
            </button>
            {activeRecap?.exportedAt && (
              <span className="muted small">Last exported: {new Date(activeRecap.exportedAt).toLocaleString()}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
