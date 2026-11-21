import React, { useEffect, useState } from 'react';
import { computeStatModifier, type RollLogEntry } from '@shared/index';
import { useVtt } from '../../context/VttContext';
import { DiceTrayStage } from '../common/DiceTrayStage';

export function DmPartyTab() {
  const { state, sendAction, pushLocalToast, setDmCharModalId } = useVtt();

  const [diceCount, setDiceCount] = useState(1);
  const [diceSides, setDiceSides] = useState(20);
  const [diceMod, setDiceMod] = useState(0);
  const [diceDc, setDiceDc] = useState(12);
  const [diceLabel, setDiceLabel] = useState('');
  const [diceSecret, setDiceSecret] = useState(true);
  const [lastRoll, setLastRoll] = useState<RollLogEntry | null>(null);

  const [dmPrivateNotes, setDmPrivateNotes] = useState(state?.notes?.dmPrivate || '');
  const [sharedQuests, setSharedQuests] = useState(state?.notes?.sharedQuests || '');
  const [notesDirty, setNotesDirty] = useState(false);

  useEffect(() => {
    if (!notesDirty && state?.notes) {
      setDmPrivateNotes(state.notes.dmPrivate || '');
      setSharedQuests(state.notes.sharedQuests || '');
    }
  }, [notesDirty, state?.notes?.dmPrivate, state?.notes?.sharedQuests]);

  if (!state) return null;

  const chars = Object.values(state.characters || {});

  const rollDmDice = async (sides: number) => {
    const res = await sendAction<{ roll?: RollLogEntry }>('roll_dice', {
      count: diceCount,
      sides,
      modifier: diceMod,
      dc: diceDc > 0 ? diceDc : undefined,
      label: diceLabel.trim() || `DM d${sides} Roll`,
      rollerName: 'Dungeon Master',
      isSecret: diceSecret,
    });
    if (res?.roll) {
      setLastRoll(res.roll);
      pushLocalToast({
        title: res.roll.isSecret ? 'SECRET DM ROLL' : 'DM ROLL',
        message: `${res.roll.formula} = ${res.roll.total}`,
        category: 'warning',
      });
    }
  };

  return (
    <div className="two-col">
      <div className="col stack">
        <div className="panel">
          <div className="panel-header"><h3>Party Characters Inspector</h3></div>
          <div id="dm-party-list" className="list-stack">
            {chars.map((c) => {
              const equipEntries = Object.entries(c.equipment || {}).filter(([, item]) => Boolean(item));
              const invList = c.inventory || [];
              return (
                <div key={c.id} className="item-card">
                  <div className="item-card-top">
                    <strong>
                      {c.name} (Lv {c.level}
                      {c.className ? ` ${c.className}` : ''})
                    </strong>
                    <span>
                      HP {c.hp}/{c.maxHp} • MP {c.mp}/{c.maxMp} • AC {c.ac} • DR {c.dr || 0}
                    </span>
                  </div>
                  <div className="muted small">
                    XP {c.xp || 0}/{c.xpToNext || c.level * 100} • Pts {c.unspentStatPoints || 0} • Favor {c.favor || 0} • {c.currency?.gold || 0}G • {c.currency?.manaStones || 0} Stones
                  </div>
                  <div className="stat-pills">
                    {Object.entries(c.stats || {}).map(([k, v]) => {
                      const mod = computeStatModifier(Number(v), state.mechanics, c);
                      return (
                        <span key={k} className="stat-pill">
                          {k}: <b>{v}</b> ({mod >= 0 ? `+${mod}` : mod})
                        </span>
                      );
                    })}
                  </div>
                  <div className="small mt-xs"><b>Equipment:</b></div>
                  <div className="stat-pills">
                    {equipEntries.length > 0 ? (
                      equipEntries.map(([slot, item]) => (
                        <span key={slot} className="stat-pill">
                          <b>{slot}:</b> {typeof item === 'string' ? item : item?.name || 'Equipped'}
                        </span>
                      ))
                    ) : (
                      <span className="muted small">None equipped</span>
                    )}
                  </div>
                  <details className="sub-details mt-xs">
                    <summary className="small">Inventory ({invList.length})</summary>
                    <ul className="small" style={{ margin: '4px 0 0 16px', padding: 0 }}>
                      {invList.length > 0 ? (
                        invList.map((it) => (
                          <li key={it.id}>
                            <b>{it.name}</b>{' '}
                            <span className="muted small">
                              ({it.category || 'item'}
                              {it.qty > 1 ? ` ×${it.qty}` : ''}
                              {it.damageDice ? ` • ${it.damageDice}` : ''})
                            </span>
                          </li>
                        ))
                      ) : (
                        <li className="muted small">Empty inventory</li>
                      )}
                    </ul>
                  </details>
                  <div className="btn-row mt-xs">
                    <button type="button" className="btn btn-xs btn-outline" onClick={() => setDmCharModalId(c.id)}>
                      View Character
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs btn-purple"
                      onClick={() => sendAction('grant_xp', { characterId: c.id, xp: 50 })}
                    >
                      +50 XP
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs btn-gold"
                      onClick={() => sendAction('deity_action', { subAction: 'grant_favor', characterId: c.id, delta: 1 })}
                    >
                      +1 Favor
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs btn-cyan"
                      onClick={() => sendAction('update_character', { characterId: c.id, updates: { hpDelta: 10 } })}
                    >
                      +10 HP
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h3>DM &amp; Party Notes</h3></div>
          <form
            id="dm-notes-form"
            className="stack-form"
            onSubmit={async (ev) => {
              ev.preventDefault();
              const res = await sendAction('update_notes', { dmPrivate: dmPrivateNotes, sharedQuests });
              if (res) {
                setNotesDirty(false);
                pushLocalToast({ title: 'NOTES SAVED', message: 'DM & Shared Quest notes saved.', category: 'info' });
              }
            }}
          >
            <label>
              <span>Shared Party Objectives</span>
              <textarea
                rows={3}
                value={sharedQuests}
                onChange={(e) => {
                  setNotesDirty(true);
                  setSharedQuests(e.target.value);
                }}
              />
            </label>
            <label>
              <span>DM Private Secrets (Hidden from Players)</span>
              <textarea
                rows={3}
                value={dmPrivateNotes}
                onChange={(e) => {
                  setNotesDirty(true);
                  setDmPrivateNotes(e.target.value);
                }}
              />
            </label>
            <button type="submit" className="btn btn-cyan btn-sm">Save Notes</button>
          </form>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>DM Dice Tray (Public or Secret up to d100)</h3>
          <span className="tag tag-gold">D&amp;D Set + d100</span>
        </div>
        <div className="dice-grid" id="dm-dice-buttons">
          {[4, 6, 8, 10, 12, 20, 100].map((s) => (
            <button
              key={s}
              type="button"
              className={`die-btn ${s === 100 ? 'die-d100' : ''}`}
              onClick={() => {
                setDiceSides(s);
                rollDmDice(s);
              }}
            >
              d{s}
            </button>
          ))}
        </div>

        <DiceTrayStage
          id="dm-dice-sim-stage"
          roll={lastRoll}
          placeholder="Tap a quick die above or roll custom dice below."
        />

        <form
          id="dm-dice-form"
          className="stack-form mt-sm"
          onSubmit={(ev) => {
            ev.preventDefault();
            rollDmDice(Math.max(1, Math.min(100, diceSides)));
          }}
        >
          <div className="grid-4">
            <label><span>Count</span><input type="number" min={1} max={30} value={diceCount} onChange={(e) => setDiceCount(Number(e.target.value || 1))} /></label>
            <label><span>Sides (1–100)</span><input type="number" min={1} max={100} value={diceSides} onChange={(e) => setDiceSides(Number(e.target.value || 20))} /></label>
            <label><span>Modifier</span><input type="number" value={diceMod} onChange={(e) => setDiceMod(Number(e.target.value || 0))} /></label>
            <label><span>Target DC</span><input type="number" min={0} max={100} value={diceDc} onChange={(e) => setDiceDc(Number(e.target.value || 0))} /></label>
          </div>
          <input type="text" placeholder="Roll Label (e.g. Secret Ambush Check)" value={diceLabel} onChange={(e) => setDiceLabel(e.target.value)} />
          <label className="checkbox-row">
            <input type="checkbox" checked={diceSecret} onChange={(e) => setDiceSecret(e.target.checked)} />
            <span>Secret DM Roll (DM Eyes Only — hidden from Players)</span>
          </label>
          <button type="submit" className="btn btn-gold">Roll DM Dice</button>
        </form>

        <div className="panel-subheader mt-md"><span>All Dice Rolls (Incl. Secret)</span></div>
        <div id="dm-roll-log" className="feed-list">
          {(state.rollLog || []).map((r) => (
            <div key={r.id} className={`feed-entry ${r.isSecret ? 'secret' : ''}`}>
              {r.isSecret && <span className="tag tag-gold">SECRET </span>}
              <strong>{r.rollerName}</strong> rolled <b>{r.formula}</b> ({r.label}) = <b>{r.total}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
