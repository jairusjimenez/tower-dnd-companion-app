import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SessionIdentity } from '../../../shared';
import type { ServerContext } from '../actions/types';
import { hashPassword, verifyPassword } from '../auth/password';
import { clearSessionCookie, resolveRequestSession, setSessionCookie } from '../auth/session';
import { createNewCharacterRecord } from '../services/gameHelpers';

const RESERVED_USERNAMES = new Set(['admin', 'dm', 'dungeonmaster', 'dm@tower.gg']);

function isReservedOrDmUsername(
  candidate: string,
  dmUsername?: string | null,
  { allowDmOwn = false } = {},
): boolean {
  const lower = candidate.trim().toLowerCase();
  if (!lower) return true;
  if (RESERVED_USERNAMES.has(lower)) return true;
  if (!allowDmOwn && dmUsername && lower === dmUsername.toLowerCase()) return true;
  return false;
}

const EmailSchema = z.object({ email: z.string().email() });
const IdentifierSchema = z.object({
  identifier: z.string().optional(),
  email: z.string().optional(),
  username: z.string().optional(),
});

export function registerAuthRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const { config, repo, sseHub } = ctx;

  app.get('/api/auth/me', async (req, reply) => {
    const session = resolveRequestSession(req, config);
    if (!session) {
      return reply.code(401).send({ ok: false, session: null });
    }
    const state = repo.getState();
    if (session.role === 'player') {
      if (!session.characterId || !state.characters[session.characterId]) {
        clearSessionCookie(req, reply, config);
        return reply.code(401).send({ ok: false, session: null });
      }
      session.name = state.characters[session.characterId]?.name || session.username;
    }
    return reply.code(200).send({ ok: true, session });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    clearSessionCookie(req, reply, config);
    return reply.code(200).send({ ok: true });
  });

  app.post('/api/auth/check-email', async (req, reply) => {
    const parsed = EmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid request.' });
    }
    const email = parsed.data.email.trim().toLowerCase();
    const state = repo.getState();
    const account = state.playerAccounts[email];
    if (!account) {
      return reply.code(404).send({
        ok: false,
        error: 'This email is not registered by the Dungeon Master yet. Send your email to your DM first!',
      });
    }
    return reply.code(200).send({
      ok: true,
      email: account.email,
      activated: Boolean(account.activated),
      username: account.username,
      characterId: account.characterId,
      characterName: state.characters[account.characterId]?.name || '',
    });
  });

  app.post('/api/auth/activate', async (req, reply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const desiredUsername = String(body.username || '').trim();
    const state = repo.getState();
    const account = state.playerAccounts[email];

    if (!account) return reply.code(404).send({ ok: false, error: 'Email is not whitelisted by the Dungeon Master.' });
    if (account.activated) {
      return reply.code(409).send({ ok: false, error: 'Account already activated. Log in with your username/email and password.' });
    }
    if (password.length < 4) return reply.code(400).send({ ok: false, error: 'Password must be at least 4 characters.' });

    if (desiredUsername) {
      if (isReservedOrDmUsername(desiredUsername, state.dmAccount?.username)) {
        return reply.code(409).send({ ok: false, error: 'That username is reserved.' });
      }
      const conflict = Object.values(state.playerAccounts).find(
        (a) => a.email !== email && a.username.toLowerCase() === desiredUsername.toLowerCase(),
      );
      if (conflict) return reply.code(409).send({ ok: false, error: 'That username is already taken.' });
      account.username = desiredUsername.slice(0, 30);
    }

    if (body.createNewCharacter && body.characterName) {
      const created = createNewCharacterRecord(state, {
        name: String(body.characterName),
        race: String(body.race || 'Human'),
        className: String(body.className || 'Tower Climber'),
      });
      account.characterId = created.id;
    } else if (body.characterId && state.characters[String(body.characterId)]) {
      account.characterId = String(body.characterId);
    }

    const { salt, hash } = hashPassword(password);
    account.salt = salt;
    account.passwordHash = hash;
    account.activated = true;
    account.lastLoginAt = new Date().toISOString();

    state.version++;
    repo.save(state);
    sseHub.broadcast('state');

    const session: SessionIdentity = {
      role: 'player',
      email: account.email,
      username: account.username,
      characterId: account.characterId,
      name: state.characters[account.characterId]?.name || account.username,
    };
    setSessionCookie(req, reply, session, config);
    return reply.code(200).send({ ok: true, session });
  });

  app.post('/api/auth/check-identifier', async (req, reply) => {
    const parsed = IdentifierSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid identifier check request.' });
    }
    const { identifier: idRaw, email: emailRaw, username: userRaw } = parsed.data;
    const identifier = String(idRaw || emailRaw || userRaw || '').trim().toLowerCase();
    if (!identifier) {
      return reply.code(400).send({ ok: false, error: 'Please enter your username or email.' });
    }
    if (identifier === 'admin' || ['dm', 'dungeonmaster', 'dm@tower.gg'].includes(identifier)) {
      return reply.code(200).send({ ok: true, found: true, activated: true, role: 'dm' });
    }

    const state = repo.getState();
    const dmAcc = state.dmAccount;
    if (
      dmAcc
      && (identifier === dmAcc.email.toLowerCase()
        || (dmAcc.activated && dmAcc.username && identifier === dmAcc.username.toLowerCase()))
    ) {
      if (!dmAcc.activated) {
        return reply.code(200).send({
          ok: true,
          found: true,
          requiresDmSetup: true,
          email: dmAcc.email,
          role: 'dm',
        });
      }
      return reply.code(200).send({ ok: true, found: true, activated: true, role: 'dm', email: dmAcc.email });
    }

    const account = Object.values(state.playerAccounts).find(
      (a) => a.email.toLowerCase() === identifier || a.username.toLowerCase() === identifier,
    );
    if (!account) {
      return reply.code(404).send({ ok: false, error: 'You are not allowed to enter the Tower' });
    }
    return reply.code(200).send({
      ok: true,
      found: true,
      activated: Boolean(account.activated),
      role: 'player',
      email: account.email,
    });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const identifier = String(body.identifier || body.email || body.username || '').trim().toLowerCase();
    const password = String(body.password || body.passcode || '');
    const state = repo.getState();

    if (identifier === 'admin' || ['dm', 'dungeonmaster', 'dm@tower.gg'].includes(identifier)) {
      if (password !== config.dmPasscode) {
        return reply.code(401).send({ ok: false, error: 'Invalid Dungeon Master password.' });
      }
      const session: SessionIdentity = {
        role: 'dm',
        email: state.dmAccount?.email || 'dm@tower.gg',
        username: 'admin',
        characterId: null,
        name: 'Dungeon Master',
      };
      setSessionCookie(req, reply, session, config);
      return reply.code(200).send({ ok: true, session });
    }

    const dmAcc = state.dmAccount;
    if (
      dmAcc
      && (identifier === dmAcc.email.toLowerCase()
        || (dmAcc.activated && dmAcc.username && identifier === dmAcc.username.toLowerCase()))
    ) {
      if (!dmAcc.activated) {
        return reply.code(200).send({
          ok: true,
          requiresDmSetup: true,
          email: dmAcc.email,
        });
      }
      if (!verifyPassword(password, dmAcc.salt, dmAcc.passwordHash)) {
        return reply.code(401).send({ ok: false, error: 'Invalid Dungeon Master password.' });
      }
      const session: SessionIdentity = {
        role: 'dm',
        email: dmAcc.email,
        username: dmAcc.username,
        characterId: null,
        name: 'Dungeon Master',
      };
      setSessionCookie(req, reply, session, config);
      return reply.code(200).send({ ok: true, session });
    }

    const account = Object.values(state.playerAccounts).find(
      (a) => a.email.toLowerCase() === identifier || a.username.toLowerCase() === identifier,
    );
    if (!account) return reply.code(401).send({ ok: false, error: 'Invalid username/email or password.' });

    let firstTimeActivated = false;
    if (!account.activated) {
      if (password.length < 4) {
        return reply.code(400).send({
          ok: false,
          requiresActivation: true,
          email: account.email,
          error: 'First-time login: enter a password of at least 4 characters to activate your account.',
        });
      }
      const { salt, hash } = hashPassword(password);
      account.salt = salt;
      account.passwordHash = hash;
      account.activated = true;
      firstTimeActivated = true;
    } else if (!verifyPassword(password, account.salt, account.passwordHash)) {
      return reply.code(401).send({ ok: false, error: 'Incorrect password.' });
    }

    account.lastLoginAt = new Date().toISOString();
    if (firstTimeActivated) state.version++;
    repo.save(state);
    sseHub.broadcast('state');

    const session: SessionIdentity = {
      role: 'player',
      email: account.email,
      username: account.username,
      characterId: account.characterId,
      name: state.characters[account.characterId]?.name || account.username,
    };
    setSessionCookie(req, reply, session, config);
    return reply.code(200).send({ ok: true, firstTimeActivated, session });
  });

  app.post('/api/auth/dm-setup', async (req, reply) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const email = String(body.email || '').trim().toLowerCase();
    const newUsername = String(body.newUsername || '').trim().replace(/\s+/g, '');
    const newPassword = String(body.newPassword || '');

    if (newUsername.length < 2) {
      return reply.code(400).send({ ok: false, error: 'New DM login username must be at least 2 characters.' });
    }
    if (RESERVED_USERNAMES.has(newUsername.toLowerCase())) {
      return reply.code(409).send({ ok: false, error: 'Choose a custom DM username other than admin/dm.' });
    }
    if (newPassword.length < 4) {
      return reply.code(400).send({ ok: false, error: 'New DM password must be at least 4 characters.' });
    }

    const state = repo.getState();
    const playerConflict = Object.values(state.playerAccounts).find(
      (a) => a.username.toLowerCase() === newUsername.toLowerCase(),
    );
    if (playerConflict) {
      return reply.code(409).send({ ok: false, error: 'That username is already in use by a player.' });
    }
    const dmAcc = state.dmAccount;
    if (!dmAcc || dmAcc.email.toLowerCase() !== email) {
      return reply.code(404).send({ ok: false, error: 'DM email account not found.' });
    }
    if (dmAcc.activated) {
      return reply.code(400).send({ ok: false, error: 'DM account is already activated. Please log in normally.' });
    }

    const { salt, hash } = hashPassword(newPassword);
    dmAcc.username = newUsername.slice(0, 32);
    dmAcc.salt = salt;
    dmAcc.passwordHash = hash;
    dmAcc.activated = true;
    state.version++;
    repo.save(state);
    sseHub.broadcast('state');

    const session: SessionIdentity = {
      role: 'dm',
      email: dmAcc.email,
      username: dmAcc.username,
      characterId: null,
      name: 'Dungeon Master',
    };
    setSessionCookie(req, reply, session, config);
    return reply.code(200).send({ ok: true, session });
  });

  app.post('/api/auth/update-credentials', async (req, reply) => {
    const session = resolveRequestSession(req, config);
    if (!session) {
      return reply.code(401).send({ ok: false, error: 'Authentication required.' });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const state = repo.getState();

    // Never trust spoofed body.email from an authenticated user — resolve target from signed session
    const targetEmail = session.role === 'dm' && body.email
      ? String(body.email).trim().toLowerCase()
      : session.email.trim().toLowerCase();

    const account = state.playerAccounts[targetEmail];
    if (!account || !account.activated) {
      return reply.code(404).send({ ok: false, error: 'Active player account not found.' });
    }
    if (!verifyPassword(String(body.currentPassword || ''), account.salt, account.passwordHash)) {
      return reply.code(401).send({ ok: false, error: 'Current password is incorrect.' });
    }

    const newUsername = String(body.newUsername || '').trim();
    if (newUsername && newUsername.toLowerCase() !== account.username.toLowerCase()) {
      if (isReservedOrDmUsername(newUsername, state.dmAccount?.username)) {
        return reply.code(409).send({ ok: false, error: 'That username is reserved.' });
      }
      const taken = Object.values(state.playerAccounts).find(
        (a) => a.email !== targetEmail && a.username.toLowerCase() === newUsername.toLowerCase(),
      );
      if (taken) return reply.code(409).send({ ok: false, error: 'Username already taken.' });
      account.username = newUsername.slice(0, 30);
    }

    const newPassword = String(body.newPassword || '');
    if (newPassword) {
      if (newPassword.length < 4) {
        return reply.code(400).send({ ok: false, error: 'New password must be at least 4 characters.' });
      }
      const { salt, hash } = hashPassword(newPassword);
      account.salt = salt;
      account.passwordHash = hash;
    }

    state.version++;
    repo.save(state);
    sseHub.broadcast('state');

    let updatedSession: SessionIdentity | null = null;
    if (session.role === 'player' && session.email.toLowerCase() === targetEmail) {
      updatedSession = {
        role: 'player',
        email: account.email,
        username: account.username,
        characterId: account.characterId,
        name: state.characters[account.characterId]?.name || account.username,
      };
      setSessionCookie(req, reply, updatedSession, config);
    }

    return reply.code(200).send({
      ok: true,
      username: account.username,
      email: account.email,
      ...(updatedSession ? { session: updatedSession } : {}),
    });
  });
}
