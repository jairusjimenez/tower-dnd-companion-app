import { evaluateFormula, type StatMilestone } from '../../../shared';
import {
  commitState,
  createNewCharacterRecord,
  pushSystemToast,
  recordChronicleEvent,
  syncCharacterDerived,
} from '../services/gameHelpers';
import { sanitizeAccounts } from '../store/filterState';
import type { ActionRequestContext, ActionResult } from './types';

export function sessionControlAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can start or stop the session.' };
  const action = payload.action;
  ctx.state.session.status = action === 'start' ? 'active' : 'stopped';
  if (payload.title !== undefined) ctx.state.session.title = String(payload.title).slice(0, 100);
  if (payload.pausedMessage !== undefined) ctx.state.session.pausedMessage = String(payload.pausedMessage).slice(0, 200);

  if (action === 'start') {
    ctx.state.session.startedAt = new Date().toISOString();
    if (payload.incrementSession) {
      ctx.state.session.sessionNumber = Number(ctx.state.session.sessionNumber || 1) + 1;
    }
    pushSystemToast(ctx, {
      title: `SESSION #${ctx.state.session.sessionNumber} STARTED`,
      message: `The Dungeon Master has started the session: "${ctx.state.session.title}". Roll initiative and prepare to climb!`,
      category: 'info',
    });
    recordChronicleEvent(ctx.state, {
      category: 'session',
      actor: 'Dungeon Master',
      summary: `Session started: "${ctx.state.session.title || 'Tower Campaign'}".`,
    });
  } else {
    pushSystemToast(ctx, {
      title: 'SESSION STOPPED / PAUSED',
      message: ctx.state.session.pausedMessage || 'The Dungeon Master has paused the session.',
      category: 'warning',
    });
    recordChronicleEvent(ctx.state, {
      category: 'session',
      actor: 'Dungeon Master',
      summary: `Session paused: ${ctx.state.session.pausedMessage || 'DM paused the session.'}`,
    });
  }
  commitState(ctx);
  return { ok: true, session: ctx.state.session };
}

export function broadcastToastAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can broadcast system messages.' };
  const message = String(payload.message || '').trim();
  if (!message) return { status: 400, error: 'Message text is required.' };
  const category = String(payload.category || 'info');
  const defaultTitle =
    category === 'combat'
      ? 'BOSS / COMBAT ALERT'
      : category === 'loot'
        ? 'QUEST REWARD'
        : category === 'warning'
          ? 'SYSTEM WARNING'
          : 'SYSTEM MESSAGE';

  const toast = pushSystemToast(ctx, {
    title: payload.title ? String(payload.title) : defaultTitle,
    message,
    category,
    target: payload.target ? String(payload.target) : 'all',
    sender: 'SYSTEM / DM',
    isDmBroadcast: true,
  });
  commitState(ctx);
  return { ok: true, toast };
}

export function dmManageInvitesAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can manage player email invites.' };
  const sub = String(payload.subAction || '');
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return { status: 400, error: 'Valid email address is required.' };

  if (sub === 'add') {
    let assignedCharId = String(payload.characterId || '');
    if (!assignedCharId || assignedCharId === '__new__' || !ctx.state.characters[assignedCharId]) {
      const created = createNewCharacterRecord(ctx.state, {
        name: String(payload.characterName || email.split('@')[0]),
        race: String(payload.race || 'Human'),
        className: String(payload.className || 'Tower Climber'),
      });
      assignedCharId = created.id;
    }
    const baseUser = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'climber';
    const reserved = new Set(['admin', 'dm', 'dungeonmaster', 'dm@tower.gg']);
    if (ctx.state.dmAccount?.username) reserved.add(ctx.state.dmAccount.username.toLowerCase());
    const usedUsernames = new Set(
      Object.values(ctx.state.playerAccounts)
        .filter((a) => a.email !== email)
        .map((a) => a.username.toLowerCase()),
    );
    let defaultUser = reserved.has(baseUser) ? `${baseUser}_player` : baseUser;
    let suffix = 2;
    while (reserved.has(defaultUser) || usedUsernames.has(defaultUser)) {
      defaultUser = `${baseUser}${suffix++}`;
    }
    ctx.state.playerAccounts[email] = {
      id: `acc-${Date.now().toString(36)}`,
      email,
      username: ctx.state.playerAccounts[email]?.username || defaultUser,
      characterId: assignedCharId,
      activated: false,
      salt: null,
      passwordHash: null,
      invitedAt: new Date().toISOString(),
      lastLoginAt: null,
    };
  } else if (sub === 'reset_activation') {
    if (!ctx.state.playerAccounts[email]) return { status: 404, error: 'Player email not found.' };
    ctx.state.playerAccounts[email].activated = false;
    ctx.state.playerAccounts[email].salt = null;
    ctx.state.playerAccounts[email].passwordHash = null;
  } else if (sub === 'offer_character_reset') {
    const acc = ctx.state.playerAccounts[email];
    if (!acc) return { status: 404, error: 'Player email not found.' };
    const ch = ctx.state.characters[acc.characterId];
    if (!ch) return { status: 404, error: 'Bound player character not found.' };
    ch.pendingCharacterResetOffer = {
      offeredAt: new Date().toISOString(),
    };
    pushSystemToast(ctx, {
      title: 'CHARACTER RESET OFFERED',
      message: 'The Dungeon Master has offered you a full Character Reset. Accept or decline on your Dashboard.',
      category: 'warning',
      target: ch.id,
    });
  } else if (sub === 'cancel_character_reset') {
    const acc = ctx.state.playerAccounts[email];
    if (!acc) return { status: 404, error: 'Player email not found.' };
    const ch = ctx.state.characters[acc.characterId];
    if (!ch) return { status: 404, error: 'Bound player character not found.' };
    ch.pendingCharacterResetOffer = null;
  } else if (sub === 'remove') {
    delete ctx.state.playerAccounts[email];
  } else {
    return { status: 400, error: `Unknown invite subAction: ${sub}` };
  }

  commitState(ctx);
  return { ok: true, playerAccounts: sanitizeAccounts(ctx.state.playerAccounts) };
}

export function updateMechanicsAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can modify custom game mechanics.' };
  const m = payload || {};

  // Validate any supplied formulas before mutating state
  const formulaVars = {
    SCORE: 14,
    LEVEL: 1,
    ROLL: 10,
    STAT_MOD: 2,
    WEAPON_BONUS: 2,
    RAW_DMG: 8,
    CRIT_MULT: 2,
    TARGET_DR: 1,
    TARGET_AC: 14,
    STR: 14,
    AGI: 14,
    VIT: 14,
    INT: 12,
    PER: 12,
    LUCK: 10,
  };
  for (const [label, val] of [
    ['statFormula', m.statFormula],
    ['hitFormula', m.hitFormula],
    ['damageFormula', m.damageFormula],
  ] as const) {
    if (val !== undefined) {
      const expr = String(val).trim();
      if (!expr) return { status: 400, error: `${label} cannot be empty.` };
      try {
        evaluateFormula(expr, formulaVars);
      } catch (err) {
        return {
          status: 400,
          error: `Invalid ${label}: ${err instanceof Error ? err.message : 'syntax error'}`,
        };
      }
    }
  }

  if (Array.isArray(m.stats) && m.stats.length > 0) {
    const cleanStats: Array<{ key: string; name: string; defaultValue: number }> = [];
    for (const s of m.stats as Array<{ key?: unknown; name?: unknown; defaultValue?: unknown }>) {
      const key = String(s.key || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 12);
      if (!key) continue;
      cleanStats.push({
        key,
        name: String(s.name || key).trim().slice(0, 32),
        defaultValue: Number(s.defaultValue ?? 10),
      });
    }
    if (cleanStats.length > 0) {
      ctx.state.mechanics.stats = cleanStats;
      for (const ch of Object.values(ctx.state.characters)) {
        ch.stats = ch.stats || {};
        for (const st of cleanStats) {
          if (ch.stats[st.key] === undefined) ch.stats[st.key] = st.defaultValue;
        }
      }
    }
  }

  if (m.presetName !== undefined) ctx.state.mechanics.presetName = String(m.presetName).slice(0, 60);
  if (m.combatMode !== undefined) ctx.state.mechanics.combatMode = m.combatMode === 'turn_based' ? 'turn_based' : 'reactive';
  if (m.reactionRule !== undefined) ctx.state.mechanics.reactionRule = String(m.reactionRule).slice(0, 140);
  if (m.distanceUnit !== undefined) ctx.state.mechanics.distanceUnit = String(m.distanceUnit).slice(0, 24);
  if (m.statFormula !== undefined) ctx.state.mechanics.statFormula = String(m.statFormula).slice(0, 160);
  if (Array.isArray(m.statMilestones)) {
    ctx.state.mechanics.statMilestones = (m.statMilestones as Array<Partial<StatMilestone>>).map((ms, i) => ({
      id: String(ms.id || `ms-${i}`),
      statKey: String(ms.statKey || 'STR').toUpperCase().slice(0, 12),
      threshold: Math.max(1, Number(ms.threshold || 20)),
      abilityName: String(ms.abilityName || 'Awakened Power').slice(0, 50),
      bonusHp: Number(ms.bonusHp || 0),
      bonusMp: Number(ms.bonusMp || 0),
      bonusAc: Number(ms.bonusAc || 0),
      bonusDr: Number(ms.bonusDr || 0),
      description: String(ms.description || '').slice(0, 160),
    }));
  }

  for (const cid of Object.keys(ctx.state.characters)) {
    syncCharacterDerived(ctx, cid);
  }

  if (m.hitFormula !== undefined) ctx.state.mechanics.hitFormula = String(m.hitFormula).slice(0, 160);
  if (m.damageFormula !== undefined) ctx.state.mechanics.damageFormula = String(m.damageFormula).slice(0, 160);
  if (m.critMultiplier !== undefined) ctx.state.mechanics.critMultiplier = Math.max(1, Number(m.critMultiplier) || 2);
  if (m.critThreshold !== undefined) ctx.state.mechanics.critThreshold = Math.max(2, Math.min(100, Number(m.critThreshold) || 20));
  if (m.resourceName !== undefined) ctx.state.mechanics.resourceName = String(m.resourceName).slice(0, 30);
  if (m.showExactMonsterHpToPlayers !== undefined) {
    ctx.state.mechanics.showExactMonsterHpToPlayers = Boolean(m.showExactMonsterHpToPlayers);
  }

  pushSystemToast(ctx, {
    title: 'SYSTEM RULESET UPDATED',
    message: `DM updated mechanics (${ctx.state.mechanics.presetName} • ${ctx.state.mechanics.combatMode === 'reactive' ? 'Reactive Combat' : 'Turn-Based'}).`,
    category: 'info',
  });
  commitState(ctx);
  return { ok: true, mechanics: ctx.state.mechanics };
}

export function updateNotesAction(ctx: ActionRequestContext, payload: Record<string, unknown>): ActionResult {
  if (payload.sharedQuests !== undefined) ctx.state.notes.sharedQuests = String(payload.sharedQuests);
  if (payload.dmPrivate !== undefined) {
    if (ctx.role !== 'dm') return { status: 403, error: 'Only the DM can edit private DM notes.' };
    ctx.state.notes.dmPrivate = String(payload.dmPrivate);
  }
  commitState(ctx);
  return { ok: true };
}

export function resetCampaignAction(ctx: ActionRequestContext): ActionResult {
  if (ctx.role !== 'dm') return { status: 403, error: 'Only the Dungeon Master can reset campaign state.' };
  ctx.repo.reset();
  ctx.sseHub.broadcast('state');
  return { ok: true };
}
