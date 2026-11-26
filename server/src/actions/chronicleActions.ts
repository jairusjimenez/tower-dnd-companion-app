import type { SessionRecapRecord } from '../../../shared';
import { commitState, recordChronicleEvent } from '../services/gameHelpers';
import { exportChapterToGoogleDoc, generateLitRpgChapter } from '../services/narrator';
import type { ActionRequestContext, ActionResult } from './types';

function getOrCreateRecap(ctx: ActionRequestContext, sessionNumber: number): SessionRecapRecord {
  if (!Array.isArray(ctx.state.sessionRecaps)) ctx.state.sessionRecaps = [];
  let recap = ctx.state.sessionRecaps.find((r) => r.sessionNumber === sessionNumber);
  if (!recap) {
    recap = {
      sessionNumber,
      title: `Session #${sessionNumber}`,
      startedAt: new Date().toISOString(),
    };
    ctx.state.sessionRecaps.push(recap);
  }
  return recap;
}

export async function chronicleAction(
  ctx: ActionRequestContext,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  if (ctx.role !== 'dm') {
    return { status: 403, error: 'Only the Dungeon Master can manage the Session Chronicle.' };
  }

  const sub = String(payload.subAction || '');
  const activeSessionNum = Math.max(1, Number(ctx.state.currentSessionNumber || 1));
  const targetSessionNum = Math.max(1, Number(payload.sessionNumber || activeSessionNum));

  if (sub === 'add_note') {
    const text = String(payload.text || '').trim().slice(0, 600);
    if (!text) return { status: 400, error: 'Note text is required.' };
    const entry = recordChronicleEvent(ctx.state, {
      sessionNumber: targetSessionNum,
      category: 'dm_note',
      actor: 'DM Table Note',
      summary: text,
    });
    commitState(ctx);
    return { ok: true, entry };
  }

  if (sub === 'start_new_session') {
    const prevRecap = getOrCreateRecap(ctx, activeSessionNum);
    prevRecap.endedAt = new Date().toISOString();
    const nextNum = activeSessionNum + 1;
    ctx.state.currentSessionNumber = nextNum;
    const customTitle = String(payload.title || '').trim().slice(0, 120);
    const nextRecap: SessionRecapRecord = {
      sessionNumber: nextNum,
      title: customTitle || `Session #${nextNum}`,
      startedAt: new Date().toISOString(),
    };
    if (!Array.isArray(ctx.state.sessionRecaps)) ctx.state.sessionRecaps = [];
    ctx.state.sessionRecaps.push(nextRecap);
    recordChronicleEvent(ctx.state, {
      sessionNumber: nextNum,
      category: 'session',
      actor: 'Dungeon Master',
      summary: `Opened ${nextRecap.title}.`,
    });
    commitState(ctx);
    return { ok: true, currentSessionNumber: nextNum, recap: nextRecap };
  }

  if (sub === 'save_narrative') {
    const recap = getOrCreateRecap(ctx, targetSessionNum);
    if (payload.title !== undefined) {
      recap.title = String(payload.title).trim().slice(0, 120) || `Session #${targetSessionNum}`;
    }
    if (payload.directorNotes !== undefined) {
      recap.directorNotes = String(payload.directorNotes).slice(0, 4000);
    }
    if (payload.generatedNarrative !== undefined) {
      recap.generatedNarrative = String(payload.generatedNarrative).slice(0, 40000);
    }
    commitState(ctx);
    return { ok: true, recap };
  }

  if (sub === 'generate_narrative') {
    const recap = getOrCreateRecap(ctx, targetSessionNum);
    if (payload.title !== undefined) {
      recap.title = String(payload.title).trim().slice(0, 120) || recap.title;
    }
    const directorNotes =
      payload.directorNotes !== undefined ? String(payload.directorNotes).slice(0, 4000) : recap.directorNotes;
    recap.directorNotes = directorNotes;

    try {
      const { narrative, modelUsed } = await generateLitRpgChapter({
        state: ctx.state,
        sessionNumber: targetSessionNum,
        directorNotes,
        model: payload.model ? String(payload.model) : undefined,
      });
      recap.generatedNarrative = narrative;
      recap.modelUsed = modelUsed;
      recap.generatedAt = new Date().toISOString();
      commitState(ctx);
      return { ok: true, recap };
    } catch (err) {
      return {
        status: 400,
        error: err instanceof Error ? err.message : 'Failed to generate LitRPG narrative.',
      };
    }
  }

  if (sub === 'export_google_doc') {
    const recap = getOrCreateRecap(ctx, targetSessionNum);
    if (payload.title !== undefined) {
      recap.title = String(payload.title).trim().slice(0, 120) || recap.title;
    }
    const markdown = String(payload.markdown ?? recap.generatedNarrative ?? '').trim();
    if (!markdown) {
      return { status: 400, error: 'Generate or write a narrative chapter before exporting.' };
    }
    recap.generatedNarrative = markdown;

    const partyNames = Object.values(ctx.state.characters || {}).map((c) => c.name);
    try {
      const result = await exportChapterToGoogleDoc({
        sessionNumber: targetSessionNum,
        title: recap.title,
        markdown,
        partyNames,
      });
      recap.exportedAt = new Date().toISOString();
      recap.exportedDocUrl = result.docUrl;
      commitState(ctx);
      return { ok: true, recap, docUrl: result.docUrl, appendedBlocks: result.appendedBlocks };
    } catch (err) {
      return {
        status: 400,
        error: err instanceof Error ? err.message : 'Failed to export chapter to Google Doc.',
      };
    }
  }

  return { status: 400, error: `Unknown chronicle subAction: ${sub}` };
}
