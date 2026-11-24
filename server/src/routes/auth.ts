import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_COMBAT_MAX_ROUNDS,
  buildStarterEquipment,
  generateArenaTerrainFromPrompt,
  getDefaultSkillsForMonster,
  type Monster,
  type SessionIdentity,
  type StoryBeat,
} from '../../../shared';
import type { ServerContext } from '../actions/types';
import { hashPassword, verifyPassword } from '../auth/password';
import { clearSessionCookie, resolveRequestSession, setSessionCookie } from '../auth/session';
import { createInventoryItem, createNewCharacterRecord, recalculateCharacterAcAndDr } from '../services/gameHelpers';
import { createDefaultBeatArena } from '../store/initialState';

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

  app.post('/api/auth/mock-player', async (req, reply) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      joinBeat?: boolean;
      storyShowcase?: boolean;
      firstTimeOnboarding?: boolean;
    };
    const joinBeat = Boolean(body.joinBeat);
    const storyShowcase = Boolean(body.storyShowcase);
    const firstTimeOnboarding = Boolean(body.firstTimeOnboarding);
    const state = repo.getState();

    if (firstTimeOnboarding) {
      state.session.status = 'stopped';
      const mockEmail = 'new.climber@tower.gg';
      const mockUsername = 'new_climber';
      const prevAccount = state.playerAccounts[mockEmail];
      if (prevAccount?.characterId) {
        const oldCharId = prevAccount.characterId;
        delete state.characters[oldCharId];
        if (state.map?.tokens) {
          state.map.tokens = state.map.tokens.filter((t) => t.id !== oldCharId);
        }
        for (const beat of state.storyBeats || []) {
          if (beat.arena?.tokens) {
            beat.arena.tokens = beat.arena.tokens.filter((t) => t.id !== oldCharId);
          }
        }
      }

      const freshCh = createNewCharacterRecord(state, {
        name: 'New Adventurer',
        race: 'Human',
        className: 'Adventurer',
      });
      state.characters[freshCh.id] = freshCh;
      recalculateCharacterAcAndDr(state, freshCh);

      const { salt, hash } = hashPassword('mockpass');
      const nowIso = new Date().toISOString();
      const account = {
        id: prevAccount?.id || `acc-onb-${Date.now().toString(36)}`,
        email: mockEmail,
        username: mockUsername,
        characterId: freshCh.id,
        activated: true,
        invitedAt: prevAccount?.invitedAt || nowIso,
        salt,
        passwordHash: hash,
        lastLoginAt: nowIso,
      };
      state.playerAccounts[mockEmail] = account;
      state.version++;
      repo.save(state);
      sseHub.broadcast('state');

      const session: SessionIdentity = {
        role: 'player',
        email: account.email,
        username: account.username,
        characterId: account.characterId,
        name: freshCh.name,
      };
      setSessionCookie(req, reply, session, config);
      return reply.code(200).send({ ok: true, firstTimeActivated: true, session });
    }

    const mockEmail = storyShowcase ? 'story.showcase@tower.gg' : 'mock.player@tower.gg';
    const mockUsername = storyShowcase ? 'kaelen_showcase' : 'mock_climber';

    let account = state.playerAccounts[mockEmail];
    if (!account || !state.characters[account.characterId]) {
      const ch = storyShowcase
        ? createNewCharacterRecord(state, {
            name: 'Kaelen Vance (Showcase)',
            race: 'Elf',
            className: 'Spellblade',
          })
        : createNewCharacterRecord(state, {
            name: 'Sung Jin-Woo (Mock)',
            race: 'Human',
            className: 'Assassin',
          });
      if (storyShowcase) {
        ch.level = 4;
        ch.xp = 180;
        ch.xpToNext = 320;
        ch.hp = 58;
        ch.maxHp = 58;
        ch.mp = 36;
        ch.maxMp = 36;
        ch.stats = { STR: 14, AGI: 16, VIT: 15, INT: 16, PER: 15, LUCK: 12 };
        ch.currency = { gold: 240, manaStones: 5 };
        ch.equipment = buildStarterEquipment('sword', 'Iron').equipment;
        ch.spells = [
          {
            id: `sp-showcase-riposte-${Date.now().toString(36)}`,
            name: 'Arcane Riposte',
            element: 'Light',
            mpCost: 3,
            damageDice: '2d6+2',
            damageType: 'Light',
            rangeSpaces: 3,
            areaText: '3 Spaces',
            attackArea: 'single',
            attackAreaModifier: 0,
            actionType: 'Reaction',
            explanation: 'Instant counter-bolt triggered when a foe strikes.',
          },
          {
            id: `sp-showcase-pulse-${Date.now().toString(36)}`,
            name: 'Mending Pulse',
            element: 'Water',
            mpCost: 4,
            damageDice: '',
            damageType: 'Water',
            rangeSpaces: 1,
            areaText: 'Self',
            attackArea: 'single',
            attackAreaModifier: 0,
            actionType: 'Reaction',
            healFormula: '2d6+4',
            effectSpec: { kind: 'shield', potency: 2, duration: 2, target: 'self' },
            explanation: 'Emergency reaction mend that restores HP and raises a barrier.',
          },
        ];
      } else {
        ch.level = 3;
        ch.xp = 80;
        ch.xpToNext = 220;
        ch.hp = 42;
        ch.maxHp = 42;
        ch.mp = 24;
        ch.maxMp = 24;
        ch.currency = { gold: 150, manaStones: 3 };
        ch.equipment = buildStarterEquipment('dagger', 'Iron').equipment;
        ch.spells = [
          {
            id: `sp-mock-slash-${Date.now().toString(36)}`,
            name: 'Shadow Slash',
            element: 'Dark',
            mpCost: 3,
            damageDice: '2d6+3',
            damageType: 'Dark',
            rangeSpaces: 2,
            areaText: '2 Spaces',
            attackArea: 'single',
            attackAreaModifier: 0,
            actionType: 'Action',
            effectSpec: { kind: 'burn', potency: 4, duration: 2, target: 'enemy' },
            explanation: 'Dark-infused blade strike that inflicts Burn.',
          },
          {
            id: `sp-mock-mend-${Date.now().toString(36)}`,
            name: 'Mending Light',
            element: 'Light',
            mpCost: 3,
            damageDice: '1d4',
            damageType: 'Light',
            rangeSpaces: 4,
            areaText: '4 Spaces',
            attackArea: 'single',
            attackAreaModifier: 0,
            actionType: 'Action',
            healFormula: '2d6+3',
            effectSpec: { kind: 'shield', potency: 2, duration: 2, target: 'self' },
            explanation: 'Restores HP and raises a protective Light barrier.',
          },
        ];
      }
      ch.inventory = [
        createInventoryItem({
          name: 'Healing Vial',
          category: 'consumable',
          qty: 2,
          healHp: 12,
          notes: 'Restores 12 HP.',
        }),
      ];
      recalculateCharacterAcAndDr(state, ch);

      const nowIso = new Date().toISOString();
      const { salt, hash } = hashPassword('mockpass123');
      account = {
        id: `acc-mock-${Date.now().toString(36)}`,
        email: mockEmail,
        username: mockUsername,
        characterId: ch.id,
        salt,
        passwordHash: hash,
        activated: true,
        invitedAt: nowIso,
        lastLoginAt: nowIso,
      };
      state.playerAccounts[mockEmail] = account;
    } else {
      account.lastLoginAt = new Date().toISOString();
    }

    const ch = state.characters[account.characterId];
    if (ch) {
      for (const beat of state.storyBeats || []) {
        if (!beat.arena) continue;
        if (storyShowcase && beat.id.startsWith('beat-mock-combat')) continue;
        if (!storyShowcase && beat.id.startsWith('beat-mock-story-')) continue;
        beat.arena.tokens = beat.arena.tokens || [];
        if (!beat.arena.tokens.some((t) => t.id === ch.id)) {
          const cols = Number(beat.arena.cols || 20);
          const rows = Number(beat.arena.rows || 20);
          beat.arena.tokens.push({
            id: ch.id,
            name: ch.name.split(' ')[0],
            type: 'player',
            x: Math.floor(cols / 2),
            y: Math.max(0, rows - 3),
            color: '#38bdf8',
            hp: ch.hp,
            maxHp: ch.maxHp,
            hiddenFromPlayers: false,
            label: storyShowcase ? 'KV' : 'SJ',
          });
        }
      }
    }

    let joinedBeatId: string | undefined;
    if (storyShowcase && ch) {
      state.session.status = 'active';
      if (!state.session.startedAt) state.session.startedAt = new Date().toISOString();

      ch.hp = ch.maxHp;
      ch.mp = ch.maxMp;
      ch.activeEffects = [];
      ch.combatPassiveFlags = {};
      recalculateCharacterAcAndDr(state, ch);
      state.pendingReactions = [];
      state.lastResolvedClash = null;
      const priorShowcaseCombatIds = new Set(
        (state.storyBeats || [])
          .filter((b) => b.id.startsWith('beat-mock-story-'))
          .flatMap((b) => (b.prompts || []).map((p) => p.spawnedCombatBeatId).filter((id): id is string => Boolean(id))),
      );
      state.storyBeats = (state.storyBeats || []).filter(
        (b) => !b.id.startsWith('beat-mock-story-') && !priorShowcaseCombatIds.has(b.id),
      );

      const showcaseArena = createDefaultBeatArena(20, 20);
      const reserved = new Set<string>(['9,13', '9,8', '6,11', '12,10']);
      const gen = generateArenaTerrainFromPrompt(
        'ancient ice crystal sanctum with pillars and frozen altar',
        20,
        20,
        'ice',
        reserved,
      );
      showcaseArena.biome = gen.biome;
      showcaseArena.terrain = gen.terrain;
      showcaseArena.tokens = [
        {
          id: ch.id,
          name: ch.name.split(' ')[0],
          type: 'player',
          x: 9,
          y: 13,
          color: '#38bdf8',
          hp: ch.hp,
          maxHp: ch.maxHp,
          hiddenFromPlayers: false,
          label: 'KV',
        },
        {
          id: `npc-showcase-orin-${Date.now().toString(36)}`,
          name: 'Archivist Orin',
          npcRole: 'Lorekeeper',
          iconId: 'merchant',
          dialogue:
            'The Astral Seal fractures by the hour. Read the runes carefully—or shatter the vault if you seek battle.',
          rewardType: 'xp',
          rewardItemName: '',
          rewardItemCategory: 'relic',
          rewardSkillDesc: '',
          rewardXp: 60,
          rewardGold: 25,
          rewardClaimed: false,
          type: 'npc',
          x: 6,
          y: 11,
          color: '#10b981',
          hp: null,
          maxHp: null,
          hiddenFromPlayers: false,
          label: 'AO',
        },
      ];
      showcaseArena.chests = [
        {
          id: `chest-showcase-${Date.now().toString(36)}`,
          name: 'Sanctum Relic Casket',
          tier: 'Rare',
          x: 12,
          y: 10,
          gold: 85,
          manaStones: 2,
          itemName: 'Runed Ward Charm',
          itemCategory: 'relic',
          opened: false,
        },
      ];

      const nowIso = new Date().toISOString();
      const showcaseBeat: StoryBeat = {
        id: `beat-mock-story-${Date.now().toString(36)}`,
        order: (state.storyBeats || []).length + 1,
        floor: 3,
        beatType: 'narration',
        title: 'The Shattered Spire of Aethelgard',
        narration:
          'Floating sapphire shards hum above a fractured Runic Altar in the 3F Astral Sanctum. Beside a frost-locked vault, Archivist Orin gestures toward three glowing glyphs—each promising a different fate for your climb.',
        dmSecret: null,
        presented: true,
        status: 'active',
        xpReward: 150,
        maxRounds: DEFAULT_COMBAT_MAX_ROUNDS,
        aiDmEnabled: true,
        arena: showcaseArena,
        encounters: [],
        treasures: [],
        prompts: [
          {
            id: `prompt-showcase-${Date.now().toString(36)}`,
            question: 'How do you approach the fractured Runic Altar?',
            target: ch.id,
            targetName: ch.name,
            options: [
              'Decipher the Astral Seal',
              'Shatter the Frost Vault & Engage',
              'Parley with Archivist Orin',
            ],
            branches: [
              {
                option: 'Decipher the Astral Seal',
                scenario:
                  'You trace the starlight sigils in reverse order. The seal parts smoothly, revealing an Aethelgard Signet!',
                statCheckStat: 'PER',
                statCheckDc: 11,
                rewardType: 'treasure',
                rewardItemName: 'Aethelgard Signet',
                rewardItemCategory: 'relic',
                rewardGold: 120,
                rewardManaStones: 2,
                nextQuestion: 'With the Astral Seal unlocked, where do you head next?',
                nextOptions: ['Ascend the Sapphire Stairway', 'Rest at the Sanctum Brazier'],
              },
              {
                option: 'Shatter the Frost Vault & Engage',
                scenario:
                  'Your blade splits the frost lock in a thunderous crack—waking two Spire Sentinels from their slumber!',
                statCheckStat: 'STR',
                statCheckDc: 12,
                rewardType: 'chest',
                rewardChestTier: 'Rare',
                rewardGold: 150,
                rewardManaStones: 2,
                endsInCombat: true,
                combatMonsterQty: 2,
              },
              {
                option: 'Parley with Archivist Orin',
                scenario:
                  'Impressed by your grasp of Old Tower script, Orin hands over a Frostward Elixir and marks the safe path.',
                statCheckStat: 'INT',
                statCheckDc: 10,
                rewardType: 'treasure',
                rewardItemName: 'Frostward Elixir',
                rewardItemCategory: 'consumable',
                rewardGold: 90,
                rewardManaStones: 1,
                nextQuestion: 'Orin opens a hidden passage behind the archives. Do you step through?',
                nextOptions: ['Enter the Hidden Passage', 'Thank Orin & Inspect the Altar'],
              },
            ],
            askedAt: nowIso,
            answers: [],
          },
        ],
      } as StoryBeat;

      state.storyBeats.push(showcaseBeat);
      joinedBeatId = showcaseBeat.id;
    } else if (joinBeat && ch) {
      state.session.status = 'active';
      if (!state.session.startedAt) state.session.startedAt = new Date().toISOString();

      // Always reset mock player vitals, effects, pending reactions & previous mock combat state
      ch.hp = ch.maxHp;
      ch.mp = ch.maxMp;
      ch.activeEffects = [];
      ch.combatPassiveFlags = {};
      recalculateCharacterAcAndDr(state, ch);
      state.pendingReactions = [];
      state.lastResolvedClash = null;
      state.recentMonsterDefeats = [];
      state.storyBeats = (state.storyBeats || []).filter((b) => !b.id.startsWith('beat-mock-combat'));
      state.monsters = (state.monsters || []).filter((m) => !m.id.startsWith('mon-mock-'));

      let targetBeat =
        (state.storyBeats || []).find(
          (b) =>
            !b.id.startsWith('beat-mock-story-') &&
            b.beatType !== 'narration' &&
            b.presented &&
            b.status !== 'resolved',
        ) ||
        (state.storyBeats || []).find(
          (b) => !b.id.startsWith('beat-mock-story-') && b.presented && b.status !== 'resolved',
        );

      if (!targetBeat) {
        const arena = createDefaultBeatArena(20, 20);
        const reserved = new Set<string>(['9,12', '8,9', '11,9', '5,13', '14,12']);
        const gen = generateArenaTerrainFromPrompt(
          'misty forest with boulders and a stream',
          20,
          20,
          'forest',
          reserved,
        );
        arena.biome = gen.biome;
        arena.terrain = gen.terrain;

        const mon1Id = `mon-mock-1-${Date.now().toString(36)}`;
        const mon2Id = `mon-mock-2-${Date.now().toString(36)}`;
        const makeMockGoblin = (id: string, name: string): Monster => ({
          id,
          name,
          floor: 1,
          hp: 26,
          maxHp: 26,
          ac: 14,
          dr: 1,
          rangeSpaces: 2,
          iconId: 'goblin',
          attackArea: 'around_1',
          attackAreaModifier: 0,
          activeEffects: [],
          attackFormula: '1d20+4',
          damageFormula: '1d6+2',
          hiddenFromPlayers: false,
          conditions: [],
          notes: 'Gatekeeper guarding the forest clearing.',
          loot: { itemName: 'Goblin Ear', itemCategory: 'material', gold: 25, manaStones: 1, xp: 20, dropped: false },
          skills: getDefaultSkillsForMonster({ name, maxHp: 26 }).map((s) => ({
            ...s,
            maxUsesPerCombat: s.baseUsesPerCombat,
            usesRemaining: s.baseUsesPerCombat,
          })),
        });
        const mon1 = makeMockGoblin(mon1Id, 'Goblin Gatekeeper #1');
        const mon2 = makeMockGoblin(mon2Id, 'Goblin Gatekeeper #2');
        state.monsters.push(mon1, mon2);

        arena.tokens = [
          {
            id: ch.id,
            name: ch.name.split(' ')[0],
            type: 'player',
            x: 9,
            y: 12,
            color: '#38bdf8',
            hp: ch.hp,
            maxHp: ch.maxHp,
            hiddenFromPlayers: false,
            hasMovedThisTurn: false,
            attacksUsedThisTurn: 0,
            label: 'SJ',
          },
          {
            id: mon1.id,
            name: mon1.name,
            type: 'monster',
            iconId: 'goblin',
            x: 8,
            y: 9,
            color: '#ef4444',
            hp: mon1.hp,
            maxHp: mon1.maxHp,
            hiddenFromPlayers: false,
            label: 'GG',
          },
          {
            id: mon2.id,
            name: mon2.name,
            type: 'monster',
            iconId: 'goblin',
            x: 11,
            y: 9,
            color: '#ef4444',
            hp: mon2.hp,
            maxHp: mon2.maxHp,
            hiddenFromPlayers: false,
            label: 'GG',
          },
          {
            id: `npc-mock-${Date.now().toString(36)}`,
            name: 'Elder Lyra',
            npcRole: 'Quest Giver',
            iconId: 'quest_giver',
            dialogue: 'Defeat the Goblin Gatekeepers before 20 rounds elapse!',
            rewardType: 'xp',
            rewardItemName: '',
            rewardItemCategory: 'relic',
            rewardSkillDesc: '',
            rewardXp: 40,
            rewardGold: 0,
            rewardClaimed: false,
            type: 'npc',
            x: 5,
            y: 13,
            color: '#10b981',
            hp: null,
            maxHp: null,
            hiddenFromPlayers: false,
            label: 'EL',
          },
        ];
        arena.chests = [
          {
            id: `chest-mock-${Date.now().toString(36)}`,
            name: 'Clearing Supply Chest',
            tier: 'Common',
            x: 14,
            y: 12,
            gold: 50,
            manaStones: 1,
            itemName: '',
            itemCategory: 'relic',
            opened: false,
          },
        ];

        targetBeat = {
          id: `beat-mock-combat-${Date.now().toString(36)}`,
          order: (state.storyBeats || []).length + 1,
          floor: 1,
          beatType: 'combat',
          title: 'Gate of Trials — Goblin Ambush',
          narration: 'Mist swirls through the ancient forest clearing as Goblin Gatekeepers step from behind the boulders!',
          dmSecret: null,
          presented: true,
          status: 'active',
          xpReward: 120,
          maxRounds: DEFAULT_COMBAT_MAX_ROUNDS,
          aiDmEnabled: true,
          arena,
          encounters: [],
          treasures: [],
        } as StoryBeat;
        state.storyBeats.push(targetBeat);
      }

      if (targetBeat) {
        if (targetBeat.beatType !== 'narration') {
          targetBeat.aiDmEnabled = true;
        }
        joinedBeatId = targetBeat.id;
        const otherMockCharId = state.playerAccounts?.['story.showcase@tower.gg']?.characterId;
        targetBeat.arena.tokens = (targetBeat.arena.tokens || []).filter(
          (t) => !(otherMockCharId && otherMockCharId !== ch.id && t.id === otherMockCharId),
        );
        const pTok = targetBeat.arena.tokens.find((t) => t.id === ch.id);
        if (pTok) {
          pTok.hasMovedThisTurn = false;
          pTok.hasUsedConsumableThisTurn = false;
          pTok.attacksUsedThisTurn = 0;
        }
        const beatMons = targetBeat.arena.tokens
          .filter((t) => t.type === 'monster')
          .map((t) => state.monsters.find((m) => m.id === t.id))
          .filter((m): m is Monster => Boolean(m && Number(m.hp ?? 0) > 0));

        for (const m of beatMons) {
          m.hiddenFromPlayers = false;
          const mTok = targetBeat.arena.tokens.find((t) => t.id === m.id);
          if (mTok) mTok.hiddenFromPlayers = false;
        }

        const livingMonIds = new Set(beatMons.map((m) => m.id));
        const syncedCombatants = (state.combat.combatants || [])
          .filter(
            (c) =>
              (c.type === 'player' && !(otherMockCharId && otherMockCharId !== ch.id && c.id === otherMockCharId)) ||
              livingMonIds.has(c.id),
          )
          .map((c) => ({ ...c, hiddenFromPlayers: false }));

        if (!syncedCombatants.some((c) => c.id === ch.id)) {
          syncedCombatants.unshift({
            id: ch.id,
            name: ch.name,
            type: 'player',
            hp: ch.hp,
            maxHp: ch.maxHp,
            ac: ch.ac,
            initiative: 19,
            initMod: 3,
            hiddenFromPlayers: false,
          });
        }
        beatMons.forEach((m, idx) => {
          if (!syncedCombatants.some((c) => c.id === m.id)) {
            syncedCombatants.push({
              id: m.id,
              name: m.name,
              type: 'monster' as const,
              hp: Number(m.hp ?? m.maxHp ?? 20),
              maxHp: Number(m.maxHp ?? 20),
              ac: m.ac,
              initiative: 14 - idx,
              initMod: 1,
              hiddenFromPlayers: false,
            });
          }
        });
        syncedCombatants.sort((a, b) => Number(b.initiative ?? 0) - Number(a.initiative ?? 0));
        const playerIdx = syncedCombatants.findIndex((c) => c.id === ch.id);
        state.combat = {
          active: true,
          round: 1,
          turnIndex: playerIdx >= 0 ? playerIdx : 0,
          combatants: syncedCombatants,
        };
      }
    }

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
    return reply.code(200).send({ ok: true, session, ...(joinedBeatId ? { beatId: joinedBeatId } : {}) });
  });
}
