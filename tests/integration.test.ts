import assert from 'node:assert';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  buildStarterEquipment,
  clampSpellToFloor,
  evaluateFormula,
  generateArenaTerrainFromPrompt,
  getArenaCellPx,
  PASSIVE_SKILL_POOL,
  summarizePassiveBonuses,
} from '../shared';
import { buildApp } from '../server/src/app';
import { rollDiceServer } from '../server/src/services/dice';
import { parseDeityTextIntoEntries } from '../server/src/services/deities';
import { recalculateCharacterAcAndDr } from '../server/src/services/gameHelpers';
import { JsonStateRepository, migrateGameState } from '../server/src/store/jsonStore';
import { getInitialState } from '../server/src/store/initialState';

interface ApiResponse<T = any> {
  status: number;
  headers: Headers;
  data: T;
  text: string;
}

class CookieClient {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  private absorbSetCookies(headers: Headers): void {
    const rawList: string[] =
      typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : headers.get('set-cookie')
          ? [headers.get('set-cookie') as string]
          : [];

    for (const raw of rawList) {
      const semiIdx = raw.indexOf(';');
      const pair = (semiIdx >= 0 ? raw.slice(0, semiIdx) : raw).trim();
      const eqIdx = pair.indexOf('=');
      if (eqIdx <= 0) continue;
      const name = pair.slice(0, eqIdx).trim();
      const val = pair.slice(eqIdx + 1).trim();
      const lower = raw.toLowerCase();
      if (!val || lower.includes('max-age=0')) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, val);
      }
    }
  }

  rawCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  hasCookie(name: string): boolean {
    return this.cookies.has(name);
  }

  async request<T = any>(
    urlPath: string,
    opts: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse<T>> {
    const method = opts.method || (opts.body !== undefined ? 'POST' : 'GET');
    const hdrs: Record<string, string> = { ...(opts.headers || {}) };
    const cookieHeader = this.rawCookieHeader();
    if (cookieHeader) hdrs.cookie = cookieHeader;
    if (opts.body !== undefined) hdrs['content-type'] = 'application/json';

    const res = await fetch(`${this.baseUrl}${urlPath}`, {
      method,
      headers: hdrs,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    this.absorbSetCookies(res.headers);
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      // keep raw text when response is not JSON
    }
    return { status: res.status, headers: res.headers, data, text };
  }

  get<T = any>(urlPath: string): Promise<ApiResponse<T>> {
    return this.request<T>(urlPath, { method: 'GET' });
  }

  post<T = any>(urlPath: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(urlPath, { method: 'POST', body });
  }

  action<T = any>(type: string, payload: Record<string, unknown> = {}, extraBody: Record<string, unknown> = {}): Promise<ApiResponse<T>> {
    return this.post<T>('/api/action', { ...extraBody, type, payload });
  }
}

async function runTests(): Promise<void> {
  // =========================================================================
  // Suite 1: Shared Formulas, Rules, Terrain Determinism & Server Services
  // =========================================================================
  assert.strictEqual(evaluateFormula('floor((SCORE - 10) / 2)', { SCORE: 18 }), 4);
  assert.strictEqual(
    evaluateFormula('max(1, (RAW_DMG * CRIT_MULT) + STAT_MOD - TARGET_DR)', {
      RAW_DMG: 12,
      CRIT_MULT: 2,
      STAT_MOD: 3,
      TARGET_DR: 4,
    }),
    23,
  );
  assert.strictEqual(evaluateFormula('min(5, max(1, 0 - 3))', {}), 1);

  const floor1Spell = clampSpellToFloor({ damageDice: '6d12+20', rangeSpaces: 16, mpCost: 1 }, 1);
  assert.strictEqual(floor1Spell.damageDice, '2d8+2');
  assert.strictEqual(floor1Spell.rangeSpaces, 4);
  assert.ok(floor1Spell.mpCost >= floor1Spell.minMp);

  const floor20Spell = clampSpellToFloor({ damageDice: '8d12+40', rangeSpaces: 16, mpCost: 1 }, 20);
  assert.strictEqual(floor20Spell.damageDice, '8d12+40');
  assert.strictEqual(floor20Spell.rangeSpaces, 16);

  const terrainA = generateArenaTerrainFromPrompt('misty forest with a winding river and ancient boulders', 20, 20, 'obsidian');
  const terrainB = generateArenaTerrainFromPrompt('misty forest with a winding river and ancient boulders', 20, 20, 'obsidian');
  assert.strictEqual(terrainA.biome, 'forest');
  assert.deepStrictEqual(terrainA, terrainB);
  assert.ok(terrainA.terrain.some((t) => t.type === 'water'));
  assert.ok(terrainA.terrain.some((t) => t.type === 'rock'));
  assert.ok(terrainA.terrain.some((t) => t.type === 'tree'));

  const customStarter = buildStarterEquipment('custom', 'char-test', 'ranged', 'wood-shortbow');
  assert.strictEqual(customStarter.equipment.mainHand?.name, 'Wooden Shortbow');
  assert.strictEqual(customStarter.equipment.body?.name, 'Scout Leather Tunic');
  assert.strictEqual(customStarter.equipment.boots?.name, 'Agile Scout Boots');

  const archerStarter = buildStarterEquipment('archer', 'char-test');
  assert.ok(archerStarter.equipment.mainHand?.name);

  for (const variant of ['draft', 'modal', 'detail'] as const) {
    const px = getArenaCellPx(20, variant);
    assert.ok(Number.isFinite(px) && px >= 16 && px <= 40);
  }

  const passiveTotals = summarizePassiveBonuses([
    { id: 'p1', name: 'Aegis', tier: 'Normal', description: '', bonusAc: 2, bonusDr: 1, bonusHp: 10 },
    { id: 'p2', name: 'Stride', tier: 'Rare', description: '', bonusMp: 5, bonusSpeedSpaces: 2 },
  ]);
  assert.deepStrictEqual(passiveTotals, {
    bonusAc: 2,
    bonusDr: 1,
    bonusHp: 10,
    bonusMp: 5,
    bonusSpeedSpaces: 2,
  });

  const diceRoll = rollDiceServer({ formula: '2d6+3' });
  assert.strictEqual(diceRoll.rolls.length, 2);
  assert.ok(diceRoll.total >= 5 && diceRoll.total <= 15);
  assert.ok(diceRoll.breakdown.includes('='));

  const modPreservedRoll = rollDiceServer({ formula: '1d20', modifier: 5 });
  assert.strictEqual(modPreservedRoll.formula, '1d20+5');
  assert.strictEqual(modPreservedRoll.modifier, 5);
  assert.strictEqual(modPreservedRoll.total, modPreservedRoll.diceTotal + 5);
  assert.ok(modPreservedRoll.breakdown.includes('+ 5'));

  // recalculateCharacterAcAndDr preserves passive & awakening AC/DR alongside armor + AGI
  const acState = getInitialState();
  const acChar: any = {
    id: 'c-ac-test',
    stats: { AGI: 14 },
    equipment: {
      mainHand: null,
      offHand: null,
      head: null,
      body: { id: 'b1', name: 'Test Plate', slot: 'body', type: 'armor', attackBonus: 0, damageDice: '', damageType: '', rangeSpaces: 0, acBonus: 3, drBonus: 2 },
      boots: null,
      relic: null,
    },
    passives: [{ id: 'p-ac', name: 'Iron Skin', tier: 'Normal', description: '', bonusAc: 2, bonusDr: 3, multiplierPct: 150 }],
    awakenings: ['ms-vit-20'], // VIT 20 milestone grants +2 DR
  };
  recalculateCharacterAcAndDr(acState, acChar);
  // Base 10 + AGI mod (+2) + Armor AC (3) + Passive AC (round(2 * 1.5)=3) = 18
  assert.strictEqual(acChar.ac, 18);
  // Armor DR (2) + Passive DR (round(3 * 1.5)=5) + Awakening VIT20 DR (2) = 9
  assert.strictEqual(acChar.dr, 9);

  assert.strictEqual(PASSIVE_SKILL_POOL.length, 200);

  const deityParsed = parseDeityTextIntoEntries(
    'Solarix\nDomain: Sun\nBlessing: Dawn\nBoon: +5 Radiant\nRange: 6 Spaces',
    'https://docs.google.com/document/d/demo',
  );
  assert.strictEqual(deityParsed.length, 1);
  assert.strictEqual(deityParsed[0].name, 'Solarix');

  // =========================================================================
  // Suite 2: JsonStateRepository Atomic Save, Backup Rotation & Migration
  // =========================================================================
  const repoTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-vtt-repo-'));
  try {
    const repoStateFile = path.join(repoTempDir, 'state.json');
    const repoBackupDir = path.join(repoTempDir, 'backups');
    const repo = new JsonStateRepository(repoTempDir, repoStateFile, repoBackupDir, 3);
    const s1 = repo.getState();
    s1.session.title = 'Persisted Tower Campaign';
    repo.save(s1);
    assert.ok(fs.existsSync(repoStateFile));
    assert.strictEqual(JSON.parse(fs.readFileSync(repoStateFile, 'utf8')).schemaVersion, 2);

    // Create 5 sequential backups and verify rotation caps at maxBackups=3
    for (let i = 0; i < 5; i++) {
      s1.session.title = `Backup Iteration ${i}`;
      repo.save(s1);
      repo.createBackupIfExists();
      await new Promise((r) => setTimeout(r, 5));
    }
    const backupFiles = fs.readdirSync(repoBackupDir).filter((f) => f.endsWith('.json'));
    assert.ok(backupFiles.length <= 3 && backupFiles.length >= 1, `Expected 1..3 backups, got ${backupFiles.length}`);

    // Corrupt state.json and verify reload recovers from latest backup
    fs.writeFileSync(repoStateFile, '{corrupted json!!!', 'utf8');
    const recoveredRepo = new JsonStateRepository(repoTempDir, repoStateFile, repoBackupDir, 3);
    assert.strictEqual(recoveredRepo.getState().session.title, 'Backup Iteration 4');

    // Legacy v1 state migration checks
    const minimalLegacy = getInitialState();
    delete minimalLegacy.schemaVersion;
    (minimalLegacy as unknown as Record<string, unknown>).playerHistory = undefined;
    minimalLegacy.mechanics.statMilestones = minimalLegacy.mechanics.statMilestones.slice(0, 2);
    const migrated = migrateGameState(minimalLegacy);
    assert.strictEqual(migrated.schemaVersion, 2);
    assert.ok(Array.isArray(migrated.playerHistory));
    assert.ok(migrated.mechanics.statMilestones.length > 6);
  } finally {
    fs.rmSync(repoTempDir, { recursive: true, force: true });
  }

  // =========================================================================
  // Suite 3–15: Fastify HttpOnly Cookie Auth, RBAC & Full Campaign Integration
  // =========================================================================
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-vtt-int-'));
  const { app, config } = await buildApp({
    port: 0,
    host: '127.0.0.1',
    dataDir: tempDir,
    stateFile: path.join(tempDir, 'state.json'),
    backupDir: path.join(tempDir, 'backups'),
    dmPasscode: 'dm123',
    sessionSecret: 'integration-test-session-secret-32chars!',
    isProduction: false,
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const unauth = new CookieClient(baseUrl);
  const dm = new CookieClient(baseUrl);
  const firstPlayer = new CookieClient(baseUrl);
  const heroPlayer = new CookieClient(baseUrl);

  try {
    // --- Suite 3: Security Headers, Unauthenticated Gates & Cookie RBAC ---
    const health = await unauth.get('/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.ok, true);
    assert.strictEqual(health.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(health.headers.get('content-security-policy'), 'Expected Helmet CSP header');

    for (const p of ['/api/auth/me', '/api/state', '/api/events']) {
      const r = await unauth.get(p);
      assert.strictEqual(r.status, 401, `Expected 401 on GET ${p}, got ${r.status}`);
    }
    assert.strictEqual((await unauth.post('/api/action', { type: 'roll_dice', payload: {} })).status, 401);
    assert.strictEqual((await unauth.post('/api/auth/update-credentials', {})).status, 401);

    // Ensure no mock / dummy demo accounts exist in production seed state
    assert.strictEqual((await unauth.post('/api/auth/login', { identifier: 'player', password: 'player123' })).status, 401);
    assert.strictEqual((await unauth.post('/api/auth/check-identifier', { identifier: 'demo.dm@tower.gg' })).status, 404);

    // Ensure hardcoded '123456' DM fallback is removed (only configured dmPasscode 'dm123' succeeds)
    assert.strictEqual((await unauth.post('/api/auth/login', { identifier: 'admin', password: '123456' })).status, 401);

    // DM logs in and receives signed HttpOnly cookie
    const dmLogin = await dm.post('/api/auth/login', { identifier: 'admin', password: 'dm123' });
    assert.strictEqual(dmLogin.status, 200);
    assert.strictEqual(dmLogin.data.session.role, 'dm');
    const dmSetCookie = dmLogin.headers.get('set-cookie') || '';
    assert.ok(dmSetCookie.includes(`${config.sessionCookieName}=`), 'Missing signed session cookie');
    assert.ok(/httponly/i.test(dmSetCookie), 'Session cookie must be HttpOnly');
    assert.ok(/samesite=lax/i.test(dmSetCookie), 'Session cookie must have SameSite=Lax');

    const dmMe = await dm.get('/api/auth/me');
    assert.strictEqual(dmMe.status, 200);
    assert.strictEqual(dmMe.data.session.role, 'dm');

    // DM invites first@tower.gg and hero@test.gg
    const invFirst = await dm.action('dm_manage_invites', {
      subAction: 'add',
      email: 'first@tower.gg',
      characterId: '__new__',
      characterName: 'First Climber',
      race: 'Elf',
      className: 'Scout',
    });
    assert.strictEqual(invFirst.status, 200);
    const invHero = await dm.action('dm_manage_invites', {
      subAction: 'add',
      email: 'hero@test.gg',
      characterId: '__new__',
      characterName: 'Aria Vane',
      race: 'Elf',
      className: 'Ranger',
    });
    assert.strictEqual(invHero.status, 200);

    const dmState0 = await dm.get('/api/state');
    const firstCharId = dmState0.data.playerAccounts['first@tower.gg'].characterId;
    const heroCharId = dmState0.data.playerAccounts['hero@test.gg'].characterId;
    assert.ok(firstCharId && heroCharId && firstCharId !== heroCharId);
    // Newly invited players automatically receive arena tokens on existing non-resolved beats (beat-1)
    assert.ok(dmState0.data.storyBeats[0].arena.tokens.some((t: any) => t.id === heroCharId));
    assert.ok(dmState0.data.storyBeats[0].arena.tokens.some((t: any) => t.id === firstCharId));

    // First-time player auto-activation on /api/auth/login
    const firstTooShort = await firstPlayer.post('/api/auth/login', { identifier: 'first@tower.gg', password: 'abc' });
    assert.strictEqual(firstTooShort.status, 400);
    const firstActivate = await firstPlayer.post('/api/auth/login', { identifier: 'first@tower.gg', password: 'firstpass123' });
    assert.strictEqual(firstActivate.status, 200);
    assert.strictEqual(firstActivate.data.firstTimeActivated, true);
    assert.strictEqual(firstActivate.data.session.characterId, firstCharId);

    // RBAC spoofing checks: spoofed role/characterId in body or query is ignored
    const spoofDmAction = await firstPlayer.action('session_control', { action: 'stop' }, { role: 'dm' });
    assert.strictEqual(spoofDmAction.status, 403);

    const spoofOtherChar = await firstPlayer.action('update_character', {
      characterId: heroCharId,
      updates: { hp: 1 },
    });
    assert.strictEqual(spoofOtherChar.status, 403);

    const spoofStateQuery = await firstPlayer.get('/api/state?role=dm');
    assert.strictEqual(spoofStateQuery.status, 200);
    assert.strictEqual(spoofStateQuery.data.notes.dmPrivate, null);

    // Logout clears session cookie
    const logoutRes = await firstPlayer.post('/api/auth/logout', {});
    assert.strictEqual(logoutRes.status, 200);
    assert.strictEqual((await firstPlayer.get('/api/auth/me')).status, 401);
    const firstRelogin = await firstPlayer.post('/api/auth/login', { identifier: 'first@tower.gg', password: 'firstpass123' });
    assert.strictEqual(firstRelogin.status, 200);

    // --- Suite 4: Account Activation, Onboarding, Credentials Update & Session Control ---
    const heroCheck = await heroPlayer.post('/api/auth/check-email', { email: 'hero@test.gg' });
    assert.strictEqual(heroCheck.status, 200);
    assert.strictEqual(heroCheck.data.activated, false);

    const heroAct = await heroPlayer.post('/api/auth/activate', {
      email: 'hero@test.gg',
      username: 'hero_tester',
      password: 'secret123',
      characterId: heroCharId,
    });
    assert.strictEqual(heroAct.status, 200);
    assert.strictEqual(heroAct.data.session.characterId, heroCharId);

    const updProfile = await heroPlayer.action('update_character_profile', {
      characterId: heroCharId,
      name: 'Lyra Stormwind',
      race: 'High Elf',
      className: 'Shinsu Archer',
    });
    assert.strictEqual(updProfile.status, 200);
    assert.strictEqual(updProfile.data.character.name, 'Lyra Stormwind');

    // First-time starter kit selection succeeds even while session + beat-1 are active, and second swap while locked is blocked
    const equipStarter = await heroPlayer.action('equipment_action', {
      characterId: heroCharId,
      subAction: 'choose_starter',
      kit: 'archer',
    });
    assert.strictEqual(equipStarter.status, 200);
    assert.strictEqual(equipStarter.data.character.equipment.mainHand?.name, 'Oak Shortbow');

    const secondStarterWhileLocked = await heroPlayer.action('equipment_action', {
      characterId: heroCharId,
      subAction: 'choose_starter',
      kit: 'swordsman',
    });
    assert.strictEqual(secondStarterWhileLocked.status, 403);

    // Reserved usernames ('admin', 'dm') are rejected in credential updates
    const reservedCred = await heroPlayer.post('/api/auth/update-credentials', {
      currentPassword: 'secret123',
      newUsername: 'admin',
      newPassword: '',
    });
    assert.strictEqual(reservedCred.status, 409);

    // Update credentials without passing spoofed email; server resolves from signed cookie
    const credUpd = await heroPlayer.post('/api/auth/update-credentials', {
      currentPassword: 'secret123',
      newUsername: 'lyra_vtt',
      newPassword: 'newpassword99',
    });
    assert.strictEqual(credUpd.status, 200);
    assert.strictEqual(credUpd.data.username, 'lyra_vtt');

    // Re-login using newly updated username & password
    const reloginClient = new CookieClient(baseUrl);
    const badLogin = await reloginClient.post('/api/auth/login', { identifier: 'lyra_vtt', password: 'secret123' });
    assert.strictEqual(badLogin.status, 401);
    const goodLogin = await reloginClient.post('/api/auth/login', { identifier: 'lyra_vtt', password: 'newpassword99' });
    assert.strictEqual(goodLogin.status, 200);

    const stopRes = await dm.action('session_control', {
      action: 'stop',
      pausedMessage: 'Intermission — Shop Closed',
    });
    assert.strictEqual(stopRes.data.session.status, 'stopped');

    const startRes = await dm.action('session_control', { action: 'start' });
    assert.strictEqual(startRes.data.session.status, 'active');

    const toastRes = await dm.action('broadcast_toast', {
      title: 'SYSTEM ALERT',
      message: 'A Boss Gate opened on 3F!',
      category: 'combat',
      target: 'all',
    });
    assert.strictEqual(toastRes.status, 200);

    // --- Suite 5: Monster Spawn & Real-Time Formula Damage ---
    const spawn = await dm.action('spawn_monster', {
      name: 'Blue Venom Kasaka',
      floor: 1,
      maxHp: 50,
      ac: 14,
      dr: 2,
      hiddenFromPlayers: false,
    });
    assert.strictEqual(spawn.status, 200);
    const monId = spawn.data.monster.id;

    const dmgRes = await heroPlayer.action('inflict_damage', {
      monsterId: monId,
      attackerId: heroCharId,
      rawDamage: 17,
      damageType: 'Slashing',
      includeStatMod: false,
    });
    // max(1, (17 * 1) + 0 - 2 DR) = 15 -> 50 - 15 = 35 HP
    assert.strictEqual(dmgRes.data.finalDamage, 15);
    assert.strictEqual(dmgRes.data.monster.hp, 35);

    const playerState = await heroPlayer.get('/api/state');
    assert.strictEqual(playerState.data.notes.dmPrivate, null);
    const playerSeenMonster = playerState.data.monsters.find((m: any) => m.id === monId);
    assert.strictEqual(playerSeenMonster.hp, 35);

    // --- Suite 6: Reactive Combat Counter-Attack ---
    const monAtk = await dm.action('monster_attack', {
      monsterId: monId,
      targetCharacterId: heroCharId,
      customDamage: 8,
    });
    assert.strictEqual(monAtk.data.reactive, true);

    const reactRes = await heroPlayer.action('resolve_reaction', {
      reactionId: monAtk.data.reaction.id,
      choice: 'counter',
      diceFormula: '1d8+4',
    });
    assert.strictEqual(reactRes.status, 200);
    assert.ok(reactRes.data.counterDamageDealt >= 1);
    assert.ok(reactRes.data.monster.hp < 35);

    // --- Suite 7: DM Custom Mechanics & Stats ---
    const mechRes = await dm.action('update_mechanics', {
      presetName: 'Homebrew Aura System',
      stats: [
        { key: 'STR', name: 'Strength', defaultValue: 15 },
        { key: 'AURA', name: 'Aura Power', defaultValue: 20 },
      ],
      statFormula: 'floor(SCORE / 5)',
    });
    assert.strictEqual(mechRes.status, 200);
    assert.strictEqual(mechRes.data.mechanics.stats.length, 2);

    // --- Suite 8: Vertical Tower Map Floor Management & Themes ---
    const beforeMapState = await dm.get('/api/state');
    const prevTopFloor = beforeMapState.data.map.floors.reduce((m: number, f: any) => Math.max(m, f.number), 0);
    const prevRows = beforeMapState.data.map.rows;

    const addFloor = await dm.action('update_map', {
      subAction: 'add_floor',
      title: `${prevTopFloor + 1}F • Shifting Dunes`,
      startFogged: true,
    });
    assert.strictEqual(addFloor.status, 200);
    assert.strictEqual(addFloor.data.map.floors[0].number, prevTopFloor + 1);
    assert.strictEqual(addFloor.data.map.rows, prevRows + 5);

    const themeTower = await dm.action('update_map', {
      subAction: 'apply_tower_themes',
      preset: 'classic',
      ensureFloors: 3,
    });
    assert.strictEqual(themeTower.status, 200);
    assert.strictEqual(themeTower.data.map.floors.find((f: any) => f.number === 1).theme, 'forest');
    assert.strictEqual(themeTower.data.map.floors.find((f: any) => f.number === 2).theme, 'desert');
    assert.strictEqual(themeTower.data.map.floors.find((f: any) => f.number === 3).theme, 'underworld');

    const topToDelete = themeTower.data.map.floors[0].number;
    const rowsBeforeDel = themeTower.data.map.rows;
    const delFloorRes = await dm.action('update_map', {
      subAction: 'delete_floor',
      floorNumber: topToDelete,
    });
    assert.strictEqual(delFloorRes.status, 200);
    assert.ok(!delFloorRes.data.map.floors.some((f: any) => f.number === topToDelete));
    assert.strictEqual(delFloorRes.data.map.rows, rowsBeforeDel - 5);

    // --- Suite 9: Free-Flow Magic & Spell Slot Cap ---
    const spellRes = await heroPlayer.action('spell_action', {
      subAction: 'learn_custom',
      spell: {
        name: 'Abyssal Slash',
        element: 'Shadow',
        damageDice: '3d6+2',
        rangeSpaces: 4,
        mpCost: 4,
        actionType: 'Reaction',
        explanation: 'Slices space up to 4 spaces away as a counter-attack.',
      },
    });
    assert.strictEqual(spellRes.status, 200);
    assert.strictEqual(spellRes.data.spell.rangeSpaces, 4);

    // Level 1 character capped at 1 spell (next unlocks at Level 3)
    const secondSpellRes = await heroPlayer.action('spell_action', {
      subAction: 'learn_custom',
      spell: { name: 'Second Spell Blocked', element: 'Fire', damageDice: '2d6', rangeSpaces: 6, mpCost: 3 },
    });
    assert.strictEqual(secondSpellRes.status, 400);

    // --- Suite 10: AI Character Art Generation & Deity Import ---
    const artRes = await heroPlayer.action('generate_character_art', {
      prompt: 'Shadow monarch knight with purple aura and twin daggers',
      style: 'Korean Manhwa Webtoon',
    });
    assert.strictEqual(artRes.status, 200);
    assert.ok(artRes.data.portraitUrl.startsWith('data:image/svg+xml;base64,'));

    const gdocImport = await dm.action('deity_action', {
      subAction: 'import_google_doc',
      rawText: 'Noxar, God of Gates\nDomain: Portals\nBlessing: Gate Warp\nBoon: +4 Arcane\nRange: 8 Spaces',
    });
    assert.strictEqual(gdocImport.status, 200);
    assert.ok(gdocImport.data.deities.some((d: any) => d.name.includes('Noxar')));

    // --- Suite 11: Story Beats, Tactical Arena, Terrain, Manhattan Movement, NPC & Loot ---
    const addBeat = await dm.action('story_action', {
      subAction: 'add_beat',
      title: '3F • Bridge Guardian',
      floor: 3,
      narration: 'A crystal sentinel blocks the bridge.',
      dmSecret: 'Weak to Fire.',
      encounters: [{ name: 'Bridge Sentinel', maxHp: 40, ac: 15, dr: 2, startX: 10, startY: 5 }],
      treasures: [{ name: 'Bridge Key', category: 'relic', gold: 75, manaStones: 2 }],
    });
    assert.strictEqual(addBeat.status, 200);
    const beatId = addBeat.data.beat.id;

    // Unpresented beat hidden from players
    const beforePresent = await heroPlayer.get('/api/state');
    assert.ok(!beforePresent.data.storyBeats.some((b: any) => b.id === beatId));

    await dm.action('story_action', { subAction: 'present_beat', beatId });
    const afterPresent = await heroPlayer.get('/api/state');
    const playerBeat = afterPresent.data.storyBeats.find((b: any) => b.id === beatId);
    assert.ok(playerBeat);
    assert.strictEqual(playerBeat.dmSecret, null);

    const spawnBeat = await dm.action('story_action', { subAction: 'spawn_beat_monsters', beatId });
    assert.strictEqual(spawnBeat.data.spawned.length, 1);

    const beatArenaState = await heroPlayer.get('/api/state');
    const arenaBeat = beatArenaState.data.storyBeats.find((b: any) => b.id === beatId);
    assert.strictEqual(arenaBeat.arena.cols, 20);
    assert.strictEqual(arenaBeat.arena.rows, 20);
    const spawnedTok = arenaBeat.arena.tokens.find((t: any) => t.id === spawnBeat.data.spawned[0].id);
    assert.ok(spawnedTok);
    assert.strictEqual(spawnedTok.x, 9);
    assert.strictEqual(spawnedTok.y, 4);

    // DM designates & saves starting positions, then resets to them
    await dm.action('story_action', { subAction: 'move_beat_token', beatId, tokenId: heroCharId, x: 4, y: 15 });
    await dm.action('story_action', { subAction: 'save_beat_starts', beatId });
    await dm.action('story_action', { subAction: 'move_beat_token', beatId, tokenId: heroCharId, x: 1, y: 1 });
    await dm.action('story_action', { subAction: 'reset_beat_starts', beatId });
    const resetArenaState = await heroPlayer.get('/api/state');
    const resetHeroTok = resetArenaState.data.storyBeats
      .find((b: any) => b.id === beatId)
      .arena.tokens.find((t: any) => t.id === heroCharId);
    assert.strictEqual(resetHeroTok.x, 4);
    assert.strictEqual(resetHeroTok.y, 15);

    // Chests
    const chestRes = await dm.action('story_action', {
      subAction: 'add_beat_chest',
      beatId,
      name: 'Golden Gate Chest',
      x: 5,
      y: 5,
      gold: 80,
      manaStones: 2,
      itemName: 'Gate Key',
    });
    assert.strictEqual(chestRes.status, 200);
    const chestId = chestRes.data.beat.arena.chests[0].id;
    const openChestRes = await heroPlayer.action('story_action', {
      subAction: 'open_beat_chest',
      beatId,
      chestId,
      characterId: heroCharId,
    });
    assert.strictEqual(openChestRes.status, 200);
    assert.strictEqual(openChestRes.data.beat.arena.chests[0].opened, true);

    await dm.action('story_action', { subAction: 'set_beat_grid', beatId, cols: 25, rows: 25 });
    const resizedState = await heroPlayer.get('/api/state');
    const resizedBeat = resizedState.data.storyBeats.find((b: any) => b.id === beatId);
    assert.strictEqual(resizedBeat.arena.cols, 25);
    assert.strictEqual(resizedBeat.arena.rows, 25);

    const genTerrainRes = await dm.action('story_action', {
      subAction: 'generate_beat_terrain',
      beatId,
      prompt: 'misty forest split by a winding river and ancient boulders',
      biome: 'obsidian',
    });
    assert.strictEqual(genTerrainRes.status, 200);
    assert.strictEqual(genTerrainRes.data.beat.arena.biome, 'forest');
    assert.ok(genTerrainRes.data.beat.arena.terrain.some((t: any) => t.type === 'water'));

    const setBiomeRes = await dm.action('story_action', {
      subAction: 'set_beat_biome',
      beatId,
      biome: 'desert',
    });
    assert.strictEqual(setBiomeRes.status, 200);
    assert.strictEqual(setBiomeRes.data.beat.arena.biome, 'desert');

    // Terrain block test within player's Manhattan movement range (6 spaces from hero at (4,15))
    const arenaStateNow = setBiomeRes.data.beat.arena;
    const heroTokNow = arenaStateNow.tokens.find((t: any) => t.id === heroCharId);
    const blockedSet = new Set<string>((arenaStateNow.terrain || []).map((t: any) => `${t.x},${t.y}`));

    let rockCell = { x: heroTokNow.x + 1, y: heroTokNow.y };
    if (!blockedSet.has(`${rockCell.x},${rockCell.y}`)) {
      await dm.action('story_action', {
        subAction: 'toggle_beat_terrain',
        beatId,
        x: rockCell.x,
        y: rockCell.y,
        terrainType: 'rock',
      });
      blockedSet.add(`${rockCell.x},${rockCell.y}`);
    }
    const blockedMove = await heroPlayer.action('story_action', {
      subAction: 'move_beat_token',
      beatId,
      tokenId: heroCharId,
      x: rockCell.x,
      y: rockCell.y,
    });
    assert.strictEqual(blockedMove.status, 400);
    assert.match(String(blockedMove.data.error), /terrain/i);

    // Over-range Manhattan move (>6 spaces) blocked
    const farX = Math.min(arenaStateNow.cols - 1, heroTokNow.x + 7);
    const overMove = await heroPlayer.action('story_action', {
      subAction: 'move_beat_token',
      beatId,
      tokenId: heroCharId,
      x: farX,
      y: heroTokNow.y,
    });
    assert.strictEqual(overMove.status, 400);

    // Valid open cell within Manhattan distance 1..6 succeeds once, second move same turn fails
    let openCell: { x: number; y: number } | null = null;
    for (let dy = -3; dy <= 3 && !openCell; dy++) {
      for (let dx = -3; dx <= 3 && !openCell; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d < 1 || d > 6) continue;
        const cx = heroTokNow.x + dx;
        const cy = heroTokNow.y + dy;
        if (cx >= 0 && cy >= 0 && cx < arenaStateNow.cols && cy < arenaStateNow.rows && !blockedSet.has(`${cx},${cy}`)) {
          openCell = { x: cx, y: cy };
        }
      }
    }
    assert.ok(openCell, 'Expected open cell within Manhattan range');
    const validDiagMove = await heroPlayer.action('story_action', {
      subAction: 'move_beat_token',
      beatId,
      tokenId: heroCharId,
      x: openCell.x,
      y: openCell.y,
    });
    assert.strictEqual(validDiagMove.status, 200);

    const secondMoveSameTurn = await heroPlayer.action('story_action', {
      subAction: 'move_beat_token',
      beatId,
      tokenId: heroCharId,
      x: heroTokNow.x,
      y: heroTokNow.y,
    });
    assert.strictEqual(secondMoveSameTurn.status, 400);

    // NPC dialogue & skill book gift
    const addNpcRes = await dm.action('story_action', {
      subAction: 'add_beat_npc',
      beatId,
      name: 'Elder Lyra',
      npcRole: 'Quest Giver',
      x: 3,
      y: 3,
    });
    assert.strictEqual(addNpcRes.status, 200);
    const npcTok = addNpcRes.data.beat.arena.tokens.find((t: any) => t.type === 'npc' && t.name === 'Elder Lyra');
    assert.ok(npcTok);
    assert.strictEqual(npcTok.npcRole, 'Quest Giver');

    const moveNpcRes = await dm.action('story_action', {
      subAction: 'move_beat_token',
      beatId,
      tokenId: npcTok.id,
      x: 4,
      y: 4,
    });
    assert.strictEqual(moveNpcRes.status, 200);

    const sageRes = await dm.action('story_action', {
      subAction: 'add_beat_npc',
      beatId,
      name: 'Master Jin',
      npcRole: 'Skill Master',
      dialogue: 'Learn the Shadow Step!',
      rewardType: 'skill_book',
      rewardItemName: 'Shadow Step',
      x: 6,
      y: 6,
    });
    assert.strictEqual(sageRes.status, 200);
    const sageTok = sageRes.data.beat.arena.tokens.find((t: any) => t.name === 'Master Jin');
    const talkRes = await heroPlayer.action('story_action', {
      subAction: 'talk_beat_npc',
      beatId,
      tokenId: sageTok.id,
      characterId: heroCharId,
    });
    assert.strictEqual(talkRes.status, 200);
    const afterTalkState = await heroPlayer.get('/api/state');
    const heroAfterTalk = afterTalkState.data.characters[heroCharId];
    assert.ok(heroAfterTalk.skills.some((s: any) => s.name === 'Shadow Step'));
    assert.ok(heroAfterTalk.inventory.some((i: any) => i.name.includes('Shadow Step')));

    // Monster loot drop on defeat (HP -> 0)
    const lootMonRes = await dm.action('spawn_monster', {
      name: 'Loot Goblin',
      floor: 2,
      maxHp: 10,
      loot: { itemName: 'Goblin Crown', gold: 45, manaStones: 1 },
    });
    assert.strictEqual(lootMonRes.status, 200);
    const lootMonId = lootMonRes.data.monster.id;
    const goldBeforeDrop = heroAfterTalk.currency.gold;
    await dm.action('update_monster', { monsterId: lootMonId, hp: 0 });
    const afterDropState = await heroPlayer.get('/api/state');
    const heroAfterDrop = afterDropState.data.characters[heroCharId];
    assert.ok(heroAfterDrop.currency.gold >= goldBeforeDrop + 45);
    assert.ok(heroAfterDrop.inventory.some((i: any) => i.name === 'Goblin Crown'));

    // Edit existing beat via update_beat
    const updBeatRes = await dm.action('story_action', {
      subAction: 'update_beat',
      beatId,
      title: 'Updated Gate Trial',
      floor: 3,
      xpReward: 150,
      gridSize: 30,
      narration: 'Updated narration text.',
    });
    assert.strictEqual(updBeatRes.status, 200);
    assert.strictEqual(updBeatRes.data.beat.title, 'Updated Gate Trial');
    assert.strictEqual(updBeatRes.data.beat.floor, 3);
    assert.strictEqual(updBeatRes.data.beat.xpReward, 150);
    assert.strictEqual(updBeatRes.data.beat.arena.cols, 30);

    const sysToastRes = await dm.action('broadcast_toast', {
      title: 'SYSTEM NOTICE',
      category: 'info',
      target: 'all',
      message: 'Gate opens!',
    });
    assert.strictEqual(sysToastRes.status, 200);
    assert.strictEqual(sysToastRes.data.toast.message, 'SYSTEM: Gate opens!');

    const awardBeat = await dm.action('story_action', {
      subAction: 'award_beat_treasure',
      beatId,
      characterId: heroCharId,
    });
    assert.strictEqual(awardBeat.status, 200);

    // --- Suite 11b: Stats & Equipment Locked During Active Session + Active Beat ---
    const lockedStat = await heroPlayer.action('allocate_stat', { statKey: 'STR', amount: 1 });
    assert.strictEqual(lockedStat.status, 403);
    const lockedEquip = await heroPlayer.action('equipment_action', { subAction: 'unequip', slot: 'mainHand' });
    assert.strictEqual(lockedEquip.status, 403);

    // Stop session to unlock build modifications
    await dm.action('session_control', { action: 'stop' });

    // --- Suite 12 & 12b: Stat Allocation, Level Up & Passive Skill Gacha ---
    const beforeXpState = await heroPlayer.get('/api/state');
    const heroBefore = beforeXpState.data.characters[heroCharId];
    assert.strictEqual(heroBefore.level, 1);
    const prevPts = heroBefore.unspentStatPoints;
    assert.ok(prevPts >= 10);
    const prevStr = heroBefore.stats.STR;

    const alloc = await heroPlayer.action('allocate_stat', { statKey: 'STR', amount: 3 });
    assert.strictEqual(alloc.status, 200);
    assert.strictEqual(alloc.data.character.stats.STR, prevStr + 3);
    assert.strictEqual(alloc.data.character.unspentStatPoints, prevPts - 3);

    await dm.action('story_action', {
      subAction: 'award_beat_xp',
      beatId,
      characterId: heroCharId,
      xpReward: 120,
    });
    const lvlUpRes = await heroPlayer.action('level_up', {});
    assert.strictEqual(lvlUpRes.status, 200);
    const afterXpState = await heroPlayer.get('/api/state');
    const heroAfter = afterXpState.data.characters[heroCharId];
    assert.strictEqual(heroAfter.level, 2);
    assert.strictEqual(heroAfter.xp, (heroBefore.xp || 0) + 20);
    assert.strictEqual(heroAfter.unspentStatPoints, prevPts - 1);
    assert.strictEqual(heroAfter.passiveTickets, 1);

    const gachaDraw = await heroPlayer.action('roll_passive_gacha', {});
    assert.strictEqual(gachaDraw.status, 200);
    assert.ok(
      ['Normal', 'Advanced', 'Rare', 'Super Rare', 'Super Super Rare', 'Legendary', 'Mythic'].includes(gachaDraw.data.tier),
    );
    assert.strictEqual(gachaDraw.data.character.passiveTickets, 0);
    assert.ok(gachaDraw.data.declineGold > 0 && gachaDraw.data.declineXp > 0);

    const acceptDraw = await heroPlayer.action('resolve_passive_gacha', { decision: 'accept' });
    assert.strictEqual(acceptDraw.status, 200);
    assert.strictEqual(acceptDraw.data.character.passives.length, 1);

    const blockedLvlUp = await heroPlayer.action('level_up', {});
    assert.strictEqual(blockedLvlUp.status, 400);

    await dm.action('grant_xp', { characterId: heroCharId, xp: 200 });
    const lvlUp2 = await heroPlayer.action('level_up', {});
    assert.strictEqual(lvlUp2.status, 200);

    const gachaDraw2 = await heroPlayer.action('roll_passive_gacha', {});
    assert.strictEqual(gachaDraw2.status, 200);
    const goldBeforeDecline = Number(gachaDraw2.data.character.currency?.gold || 0);
    const declineDraw = await heroPlayer.action('resolve_passive_gacha', { decision: 'decline' });
    assert.strictEqual(declineDraw.status, 200);
    assert.ok(declineDraw.data.character.currency.gold > goldBeforeDecline);
    assert.strictEqual(declineDraw.data.character.passives.length, 1);

    const poolState = await heroPlayer.get('/api/state');
    assert.strictEqual(poolState.data.passiveGacha.pool.length, 200);

    const gachaEmpty = await heroPlayer.action('roll_passive_gacha', {});
    assert.strictEqual(gachaEmpty.status, 400);

    // --- Suite 13: Stat Milestone Awakening at STR 20 ---
    const neededStr = Math.max(0, 20 - Number(heroAfter.stats.STR || 14));
    if (neededStr > 0) {
      const awkAlloc = await heroPlayer.action('allocate_stat', { statKey: 'STR', amount: neededStr });
      assert.strictEqual(awkAlloc.status, 200);
    }
    const awkState = await heroPlayer.get('/api/state');
    assert.ok(awkState.data.characters[heroCharId].skills.some((s: any) => s.name === 'Titan Cleave'));
    const strMilestones = (awkState.data.mechanics.statMilestones || [])
      .filter((m: any) => m.statKey === 'STR')
      .map((m: any) => m.threshold);
    assert.deepStrictEqual(strMilestones, [20, 40, 60, 80, 100]);
    assert.ok(Array.isArray(awkState.data.playerHistory) && awkState.data.playerHistory.length > 0);
    assert.ok(Array.isArray(awkState.data.characters[heroCharId].history) && awkState.data.characters[heroCharId].history.length > 0);

    // --- Suite 14: Two-Step Identifier Check & DM First-Time Email Setup ---
    const unknownCheck = await unauth.post('/api/auth/check-identifier', { identifier: 'not-invited@tower.gg' });
    assert.strictEqual(unknownCheck.status, 404);
    assert.strictEqual(unknownCheck.data.error, 'You are not allowed to enter the Tower');

    const invitedPlayerCheck = await unauth.post('/api/auth/check-identifier', { identifier: 'hero@test.gg' });
    assert.strictEqual(invitedPlayerCheck.status, 200);
    assert.strictEqual(invitedPlayerCheck.data.found, true);

    const dmCheckClient = new CookieClient(baseUrl);
    const dmFirstTry = await dmCheckClient.post('/api/auth/login', {
      identifier: 'jairusjimenez@live.com',
      password: 'random-password-123',
    });
    assert.strictEqual(dmFirstTry.status, 200);
    assert.strictEqual(dmFirstTry.data.requiresDmSetup, true);

    const dmSetupRes = await dmCheckClient.post('/api/auth/dm-setup', {
      email: 'jairusjimenez@live.com',
      newUsername: 'jairus_dm',
      newPassword: 'secret-dm-pass',
    });
    assert.strictEqual(dmSetupRes.status, 200);
    assert.strictEqual(dmSetupRes.data.session.role, 'dm');
    assert.strictEqual((await dmCheckClient.post('/api/auth/login', { identifier: 'jairus_dm', password: 'wrong' })).status, 401);
    const dmGoodLogin = await dmCheckClient.post('/api/auth/login', {
      identifier: 'jairus_dm',
      password: 'secret-dm-pass',
    });
    assert.strictEqual(dmGoodLogin.status, 200);
    assert.strictEqual(dmGoodLogin.data.session.role, 'dm');

    // --- Suite 15: Player-to-Player Item Trade ---
    const addTradeItemRes = await heroPlayer.action('inventory_action', {
      subAction: 'add',
      characterId: heroCharId,
      item: { name: 'Trade Potion', category: 'consumable', qty: 3 },
    });
    assert.strictEqual(addTradeItemRes.status, 200);
    const tradeItemId = addTradeItemRes.data.character.inventory.find((i: any) => i.name === 'Trade Potion').id;
    const tradeRes = await heroPlayer.action('inventory_action', {
      subAction: 'trade',
      characterId: heroCharId,
      targetCharacterId: firstCharId,
      itemId: tradeItemId,
      qty: 2,
    });
    assert.strictEqual(tradeRes.status, 200);
    const postTradeState = await dm.get('/api/state');
    assert.strictEqual(postTradeState.data.characters[heroCharId].inventory.find((i: any) => i.name === 'Trade Potion').qty, 1);
    assert.strictEqual(postTradeState.data.characters[firstCharId].inventory.find((i: any) => i.name === 'Trade Potion').qty, 2);

    // --- Suite 16: Regression Coverage (Stat Refunds, AGI AC, Turn Isolation, Formulas, Upload Validation, Zero Chests, HP Masking) ---
    // 16a. Cannot refund STR below unlocked awakening threshold (20)
    const blockRefundAwk = await heroPlayer.action('allocate_stat', { statKey: 'STR', amount: -1 });
    assert.strictEqual(blockRefundAwk.status, 400);

    // 16b. Invalid custom formula rejected before mutating state
    const badMech = await dm.action('update_mechanics', { statFormula: 'SCORE + (' });
    assert.strictEqual(badMech.status, 400);

    // 16c. Invalid image upload rejected instead of falling back to SVG synth
    const badArt = await heroPlayer.action('generate_character_art', {
      uploadedImageDataUrl: 'data:text/plain;base64,aGVsbG8=',
    });
    assert.strictEqual(badArt.status, 400);

    // 16d. Explicit gold: 0 / manaStones: 0 preserved in add_beat_chest
    const zeroChestRes = await dm.action('story_action', {
      subAction: 'add_beat_chest',
      beatId,
      name: 'Empty Coin Chest',
      x: 1,
      y: 2,
      gold: 0,
      manaStones: 0,
      itemName: 'Mystery Key',
    });
    assert.strictEqual(zeroChestRes.status, 200);
    const addedZeroChest = zeroChestRes.data.beat.arena.chests.find((c: any) => c.name === 'Empty Coin Chest');
    assert.strictEqual(addedZeroChest.gold, 0);
    assert.strictEqual(addedZeroChest.manaStones, 0);

    // 16e. End turn blocks spoofing another player's characterId and enforces active turn order
    const spoofEndTurn = await firstPlayer.action('initiative_action', {
      subAction: 'end_turn',
      characterId: heroCharId,
    });
    assert.strictEqual(spoofEndTurn.status, 403);

    // 16f. Monster exact HP masked in inflict_damage response when showExactMonsterHpToPlayers=false
    await dm.action('update_mechanics', { showExactMonsterHpToPlayers: false });
    const maskedMonSpawn = await dm.action('spawn_monster', {
      name: 'Veiled Golem',
      floor: 1,
      maxHp: 40,
      ac: 10,
      dr: 0,
      hiddenFromPlayers: false,
    });
    assert.strictEqual(maskedMonSpawn.status, 200);
    const maskedDmg = await heroPlayer.action('inflict_damage', {
      monsterId: maskedMonSpawn.data.monster.id,
      diceFormula: '2d6+1',
      damageType: 'Physical',
      includeStatMod: false,
    });
    assert.strictEqual(maskedDmg.status, 200);
    assert.strictEqual(maskedDmg.data.monster.hp, null);
    assert.strictEqual(maskedDmg.data.monster.maxHp, null);
    assert.ok(maskedDmg.data.monster.healthTier);
    assert.ok(maskedDmg.data.logEntry?.rollDetails?.breakdown);

    console.log('ALL 16 PRODUCTION TEST SUITES PASSED!');
  } finally {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
