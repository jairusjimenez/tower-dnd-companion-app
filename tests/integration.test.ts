import assert from 'node:assert';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  BALANCE,
  PASSIVE_GACHA_ODDS,
  TOWER_DAMAGE_FORMULA,
  TOWER_STAT_FORMULA,
  computeCharacterMoveSpaces,
  buildStarterEquipment,
  clampSpellToFloor,
  computePassiveModifiers,
  computeReachableMoveCells,
  computeStatModifier,
  evaluateFormula,
  evaluateRangedShot,
  generateArenaTerrainFromPrompt,
  getArenaCellPx,
  getMonsterXpReward,
  getPassiveOddsForFloor,
  levelUpGrowth,
  pickPassiveTier,
  PASSIVE_SKILL_POOL,
  scaleMonsterForFloor,
  statPointsForLevelUp,
  summarizePassiveBonuses,
  xpToNextForLevel,
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
  // Base 10 + AGI mod (floor((14-10)/3)+floor(14/30) = +1) + Armor AC (3) + Passive AC (round(2 * 1.5)=3) = 17
  assert.strictEqual(acChar.ac, 17);
  // Armor DR (2) + Passive DR (round(3 * 1.5)=5) + Awakening VIT20 DR (2) = 9
  assert.strictEqual(acChar.dr, 9);

  assert.strictEqual(PASSIVE_SKILL_POOL.length, 200);

  // --- Tower-Hard balance curve (shared/balance.ts) ---
  const towerMechanics = { statFormula: TOWER_STAT_FORMULA };
  assert.strictEqual(computeStatModifier(10, towerMechanics), 0);
  assert.strictEqual(computeStatModifier(13, towerMechanics), 1);
  assert.strictEqual(computeStatModifier(16, towerMechanics), 2);
  assert.strictEqual(computeStatModifier(20, towerMechanics), 3);
  assert.strictEqual(computeStatModifier(100, towerMechanics), 33); // flat early, big swings late
  assert.strictEqual(
    evaluateFormula(TOWER_DAMAGE_FORMULA, { RAW_DMG: 10, CRIT_MULT: 1, STAT_MOD: 1, LEVEL: 6, TARGET_DR: 2 }),
    11, // 10 + 1 + floor(6/3)=2 - 2
  );
  assert.strictEqual(xpToNextForLevel(1), 100);
  assert.strictEqual(xpToNextForLevel(5), 340);
  assert.strictEqual(statPointsForLevelUp(2), 2);
  assert.strictEqual(statPointsForLevelUp(3), 3); // bonus point every 3rd level
  assert.deepStrictEqual(levelUpGrowth(0, 0), { hp: 5, mp: 2 });
  assert.deepStrictEqual(levelUpGrowth(4, 6), { hp: 9, mp: 5 });

  assert.deepStrictEqual(getPassiveOddsForFloor(1), PASSIVE_GACHA_ODDS);
  const deepOdds = getPassiveOddsForFloor(11);
  assert.strictEqual(deepOdds.Normal, 46);
  assert.ok(deepOdds.Mythic > PASSIVE_GACHA_ODDS.Mythic);
  assert.ok(Math.abs(Object.values(deepOdds).reduce((a, b) => a + b, 0) - 100) < 0.1);
  assert.strictEqual(pickPassiveTier(PASSIVE_GACHA_ODDS, 0), 'Mythic');
  assert.strictEqual(pickPassiveTier(PASSIVE_GACHA_ODDS, 0.999), 'Normal');

  const goblinBase = { maxHp: 26, ac: 14, dr: 1, attackFormula: '1d20+5', damageFormula: '1d8+3' };
  assert.deepStrictEqual(scaleMonsterForFloor(goblinBase, 1), goblinBase);
  assert.deepStrictEqual(scaleMonsterForFloor(goblinBase, 4), {
    maxHp: 43,
    ac: 15,
    dr: 2,
    attackFormula: '1d20+7',
    damageFormula: '1d8+7',
  });
  assert.ok(getMonsterXpReward(10) > getMonsterXpReward(1));

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
    assert.ok(Array.isArray(spawn.data.monster.skills) && spawn.data.monster.skills.length > 0);
    const kasakaSkill = spawn.data.monster.skills[0];
    assert.strictEqual(kasakaSkill.maxUsesPerCombat, 2);
    assert.strictEqual(kasakaSkill.usesRemaining, 2);

    const dmgRes = await heroPlayer.action('inflict_damage', {
      monsterId: monId,
      attackerId: heroCharId,
      rawDamage: 17,
      damageType: 'Slashing',
      includeStatMod: false,
    });
    // max(1, (17 * 1) + 0 - 2 DR) = 15 -> 50 - 15 = 35 HP (masked for unobserved player, visible to DM)
    assert.strictEqual(dmgRes.data.finalDamage, 15);
    assert.strictEqual(dmgRes.data.monster.hp, null);

    const playerState = await heroPlayer.get('/api/state');
    assert.strictEqual(playerState.data.notes.dmPrivate, null);
    const playerSeenMonster = playerState.data.monsters.find((m: any) => m.id === monId);
    assert.strictEqual(playerSeenMonster.hp, null);
    assert.strictEqual(playerSeenMonster.observedByViewer, false);

    const dmAfterDmgState = await dm.get('/api/state');
    const dmSeenMonster = dmAfterDmgState.data.monsters.find((m: any) => m.id === monId);
    assert.strictEqual(dmSeenMonster.hp, 35);

    // --- Suite 6: Reactive Combat Counter-Attack & Shared DM/Player Clash Summary ---
    const monAtk = await dm.action('monster_attack', {
      monsterId: monId,
      targetCharacterId: heroCharId,
      skillId: kasakaSkill.id,
      customDamage: 8,
    });
    assert.strictEqual(monAtk.data.reactive, true);
    assert.ok(monAtk.data.reaction.attackTotal >= 1);
    assert.ok(monAtk.data.reaction.targetAc >= 10);
    assert.strictEqual(monAtk.data.reaction.skillName, kasakaSkill.name);
    assert.strictEqual(monAtk.data.skill.usesRemaining, 1);

    const reactRes = await heroPlayer.action('resolve_reaction', {
      reactionId: monAtk.data.reaction.id,
      choice: 'counter',
      diceFormula: '1d8+4',
    });
    assert.strictEqual(reactRes.status, 200);
    assert.ok(reactRes.data.counterDamageDealt >= 1);
    assert.ok(reactRes.data.monster.hp < 35);
    assert.ok(reactRes.data.resolvedClash);
    assert.strictEqual(reactRes.data.resolvedClash.resolved, true);
    assert.strictEqual(reactRes.data.resolvedClash.playerChoice, 'counter');
    assert.ok(typeof reactRes.data.resolvedClash.playerRollTotal === 'number');
    assert.ok(reactRes.data.resolvedClash.resolutionSummary.includes('COUNTER-ATTACKED'));

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

    // Calling spawn_beat_monsters again when already attached must not duplicate monsters
    const dupSpawnBeat = await dm.action('story_action', { subAction: 'spawn_beat_monsters', beatId });
    assert.strictEqual(dupSpawnBeat.status, 400);

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

    // Valid open cell within BFS movement range succeeds once, second move same turn fails
    assert.strictEqual(computeCharacterMoveSpaces({ agi: 10, floor: 1 }).total, 3);
    assert.strictEqual(computeCharacterMoveSpaces({ agi: 18, floor: 15 }).total, 7);
    const reachableNow = computeReachableMoveCells({
      startX: heroTokNow.x,
      startY: heroTokNow.y,
      maxSpaces: 3,
      cols: arenaStateNow.cols,
      rows: arenaStateNow.rows,
      terrain: arenaStateNow.terrain,
    });
    const openCell: { x: number; y: number } | null = reachableNow.cells.find((c) => !blockedSet.has(`${c.x},${c.y}`)) || null;
    assert.ok(openCell, 'Expected open cell within BFS movement range');
    // Ensure initiative is on heroCharId's turn before testing player movement
    let initCheckState = await dm.get('/api/state');
    const maxTurns = (initCheckState.data.combat?.combatants || []).length || 1;
    for (let step = 0; step < maxTurns; step++) {
      const curComb = initCheckState.data.combat?.combatants?.[initCheckState.data.combat?.turnIndex ?? 0];
      if (!curComb || curComb.id === heroCharId) break;
      await dm.action('initiative_action', { subAction: 'next_turn' });
      initCheckState = await dm.get('/api/state');
    }
    const validDiagMove = await heroPlayer.action('story_action', {
      subAction: 'move_beat_token',
      beatId,
      tokenId: heroCharId,
      x: openCell.x,
      y: openCell.y,
    });
    assert.strictEqual(validDiagMove.status, 200, `Expected 200 for validDiagMove, got ${validDiagMove.status}: ${validDiagMove.data?.error}`);

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

    const npcReachable = computeReachableMoveCells({
      startX: npcTok.x,
      startY: npcTok.y,
      maxSpaces: 6,
      cols: addNpcRes.data.beat.arena.cols,
      rows: addNpcRes.data.beat.arena.rows,
      terrain: addNpcRes.data.beat.arena.terrain,
    });
    const npcDest = npcReachable.cells[0] || { x: npcTok.x, y: npcTok.y };
    const moveNpcRes = await dm.action('story_action', {
      subAction: 'move_beat_token',
      beatId,
      tokenId: npcTok.id,
      x: npcDest.x,
      y: npcDest.y,
    });
    assert.strictEqual(moveNpcRes.status, 200, `Expected 200 for moveNpcRes, got ${moveNpcRes.status}: ${moveNpcRes.data?.error}`);

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
    // Out-of-range (> 1 Space) player talk_beat_npc is rejected
    const farTalkRes = await heroPlayer.action('story_action', {
      subAction: 'talk_beat_npc',
      beatId,
      tokenId: sageTok.id,
      characterId: heroCharId,
    });
    assert.strictEqual(farTalkRes.status, 400);

    // Move Master Jin adjacent to heroTok, then interact
    const heroTok = sageRes.data.beat.arena.tokens.find((t: any) => t.id === heroCharId && t.type === 'player');
    const adjX = Math.min(sageRes.data.beat.arena.cols - 1, Number(heroTok?.x || 0) + 1);
    const adjY = Number(heroTok?.y || 0);
    const moveSageRes = await dm.action('story_action', {
      subAction: 'move_beat_token',
      beatId,
      tokenId: sageTok.id,
      x: adjX,
      y: adjY,
      forceMove: true,
    });
    assert.strictEqual(moveSageRes.status, 200);

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

    // Narration Story Beat (no combat) + DM Question to Player/Group with Options + Player Answer
    const addNarBeatRes = await dm.action('story_action', {
      subAction: 'add_beat',
      beatType: 'narration',
      title: '3F • Voice of the Administrator',
      floor: 3,
      xpReward: 50,
      narration: 'The Administrator asks why you climb the Tower.',
      presentNow: true,
      prompts: [
        {
          question: 'Why do you climb the Tower?',
          target: 'all',
          options: ['For power & glory', 'To protect my companions', 'To uncover the truth of the 100th Floor'],
        },
      ],
    });
    assert.strictEqual(addNarBeatRes.status, 200);
    const narBeat = addNarBeatRes.data.beat;
    assert.strictEqual(narBeat.beatType, 'narration');
    assert.strictEqual(narBeat.encounters.length, 0);
    assert.strictEqual(narBeat.prompts.length, 1);
    assert.strictEqual(narBeat.prompts[0].options.length, 3);

    const askPlayerRes = await dm.action('story_action', {
      subAction: 'ask_beat_prompt',
      beatId: narBeat.id,
      question: 'Do you accept the trial?',
      target: heroCharId,
      options: ['Accept the trial', 'Demand to know the reward first'],
      branches: [
        {
          option: 'Accept the trial',
          scenario: 'The crimson seal parts and the Floor Guardian grants you safe passage!',
          dmNote: 'Grant +50 XP',
          statCheckStat: 'STR',
          statCheckDc: 5,
          rewardType: 'treasure',
          rewardItemName: 'Trial Seal Amulet',
          rewardItemCategory: 'relic',
          rewardGold: 40,
          rewardManaStones: 1,
          endsInCombat: true,
          combatMonsterQty: 2,
        },
        {
          option: 'Demand to know the reward first',
          scenario: 'The Administrator chuckles and reveals a Rare Chest hidden behind the throne.',
          rewardType: 'chest',
          rewardChestTier: 'Rare',
        },
      ],
    });
    assert.strictEqual(askPlayerRes.status, 200);
    assert.strictEqual(askPlayerRes.data.beat.prompts.length, 2);
    assert.strictEqual(askPlayerRes.data.beat.prompts[1].options.length, 2);
    assert.strictEqual(askPlayerRes.data.beat.prompts[1].branches.length, 2);
    const targetedPromptId = askPlayerRes.data.beat.prompts[1].id;

    const ansPromptRes = await heroPlayer.action('story_action', {
      subAction: 'answer_beat_prompt',
      beatId: narBeat.id,
      promptId: targetedPromptId,
      answer: 'Accept the trial',
    });
    assert.strictEqual(ansPromptRes.status, 200);
    const updatedPrompt = ansPromptRes.data.beat.prompts.find((p: any) => p.id === targetedPromptId);
    assert.strictEqual(updatedPrompt.answers.length, 1);
    assert.strictEqual(updatedPrompt.answers[0].characterId, heroCharId);
    assert.strictEqual(updatedPrompt.triggeredOption, 'Accept the trial');
    assert.match(updatedPrompt.triggeredScenario, /Floor Guardian grants you safe passage/i);
    assert.strictEqual(updatedPrompt.triggeredStatCheckResults.length, 1);
    assert.strictEqual(updatedPrompt.triggeredStatCheckResults[0].passed, true);
    assert.ok(updatedPrompt.triggeredRewardSummary.includes('Trial Seal Amulet'));
    assert.strictEqual(ansPromptRes.data.beat.status, 'resolved');
    assert.ok(updatedPrompt.spawnedCombatBeatId);
    const spawnedCombatBeat = ansPromptRes.data.storyBeats.find((b: any) => b.id === updatedPrompt.spawnedCombatBeatId);
    assert.ok(spawnedCombatBeat);
    assert.strictEqual(spawnedCombatBeat.beatType, 'combat');
    assert.strictEqual(spawnedCombatBeat.encounters.length, 2);

    // Clear the narration beat's auto-spawned monsters so Suite 12 level-up & gacha checks start from baseline XP
    for (const tok of spawnedCombatBeat.arena.tokens.filter((t: any) => t.type === 'monster')) {
      await dm.action('remove_monster', { monsterId: tok.id });
    }
    const resetHeroAfterNar = await dm.get('/api/state');
    const heroAfterNar = resetHeroAfterNar.data.characters[heroCharId];
    if (heroAfterNar.xp > 0) {
      await dm.action('update_character', { characterId: heroCharId, xp: 0 });
    }

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
    // Difficult start: fragile Level 1 character with default 10s and limited starting points
    assert.strictEqual(heroBefore.maxHp, BALANCE.start.maxHp);
    assert.strictEqual(heroBefore.maxMp, BALANCE.start.maxMp);
    assert.strictEqual(heroBefore.stats.STR, BALANCE.start.defaultStat);
    const prevPts = heroBefore.unspentStatPoints;
    assert.strictEqual(prevPts, BALANCE.start.unspentStatPoints);
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
    // Power compounds on level-up: at least +5 Max HP and +2 Max MP (more with VIT/INT modifiers;
    // Suite 7 swapped in a custom stat formula, so modifiers are positive here)
    assert.ok(heroAfter.maxHp >= heroBefore.maxHp + BALANCE.levelUp.baseHp);
    assert.ok(heroAfter.maxMp >= heroBefore.maxMp + BALANCE.levelUp.baseMp);
    assert.strictEqual(heroAfter.xpToNext, xpToNextForLevel(2));

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
    assert.strictEqual(maskedDmg.data.monster.ac, 0);
    assert.strictEqual(maskedDmg.data.monster.observedByViewer, false);
    assert.ok(maskedDmg.data.monster.healthTier);
    assert.ok(maskedDmg.data.logEntry?.rollDetails?.breakdown);

    // 16g. Per-player Observe reveals monster HP & stats only to that player, limited to once per turn
    const preObsPlayerState = await heroPlayer.get('/api/state');
    const preObsMon = preObsPlayerState.data.monsters.find((m: any) => m.id === maskedMonSpawn.data.monster.id);
    assert.strictEqual(preObsMon.hp, null);
    assert.strictEqual(preObsMon.ac, 0);
    assert.strictEqual(preObsMon.observedByViewer, false);

    const obsBeatRes = await dm.action('story_action', {
      subAction: 'add_beat',
      title: 'Observe Trial',
      floor: 1,
      beatType: 'combat',
      presentNow: true,
      encounters: [{ name: 'Scout Hound', floor: 1, maxHp: 30, ac: 13, dr: 2, attackFormula: '1d20+4', damageFormula: '1d6+2' }],
    });
    assert.strictEqual(obsBeatRes.status, 200);
    const obsSpawnRes = await dm.action('story_action', {
      subAction: 'spawn_beat_monsters',
      beatId: obsBeatRes.data.beat.id,
    });
    assert.strictEqual(obsSpawnRes.status, 200);
    const obsBeatState = await dm.get('/api/state');
    const obsBeat = obsBeatState.data.storyBeats.find((b: any) => b.id === obsBeatRes.data.beat.id);
    const obsHeroTok = obsBeat.arena.tokens.find((t: any) => t.id === heroCharId && t.type === 'player');
    const obsMonTok = obsBeat.arena.tokens.find((t: any) => t.type === 'monster');
    assert.ok(obsHeroTok && obsMonTok);
    const adjMonX = Math.min(obsBeat.arena.cols - 1, Number(obsHeroTok.x || 0) + 1);
    const adjMonY = Number(obsHeroTok.y || 0);
    await dm.action('story_action', {
      subAction: 'move_beat_token',
      beatId: obsBeat.id,
      tokenId: obsMonTok.id,
      x: adjMonX,
      y: adjMonY,
      forceMove: true,
    });
    // Ensure heroCharId's turn in initiative
    let obsInitState = await dm.get('/api/state');
    const obsMaxTurns = (obsInitState.data.combat?.combatants || []).length || 1;
    for (let s = 0; s < obsMaxTurns; s++) {
      const curComb = obsInitState.data.combat?.combatants?.[obsInitState.data.combat?.turnIndex ?? 0];
      if (!curComb || curComb.id === heroCharId) break;
      await dm.action('initiative_action', { subAction: 'next_turn' });
      obsInitState = await dm.get('/api/state');
    }
    const obsActionRes = await heroPlayer.action('story_action', {
      subAction: 'observe_beat_cell',
      beatId: obsBeat.id,
      tokenId: heroCharId,
      x: adjMonX,
      y: adjMonY,
    });
    assert.strictEqual(obsActionRes.status, 200, `Expected 200 for observe_beat_cell, got ${obsActionRes.status}: ${obsActionRes.data?.error}`);
    assert.strictEqual(obsActionRes.data.observedMonster, true);
    assert.strictEqual(obsActionRes.data.monster.observedByViewer, true);
    assert.strictEqual(obsActionRes.data.monster.maxHp, 30);
    assert.strictEqual(obsActionRes.data.monster.ac, 13);
    assert.strictEqual(obsActionRes.data.monster.dr, 2);

    const postObsPlayerState = await heroPlayer.get('/api/state');
    const postObsMon = postObsPlayerState.data.monsters.find((m: any) => m.id === obsMonTok.id);
    assert.strictEqual(postObsMon.observedByViewer, true);
    assert.strictEqual(postObsMon.hp, 30);
    assert.strictEqual(postObsMon.ac, 13);

    // Second Observe on the same turn is rejected
    const secondObsRes = await heroPlayer.action('story_action', {
      subAction: 'observe_beat_cell',
      beatId: obsBeat.id,
      tokenId: heroCharId,
      x: adjMonX,
      y: adjMonY,
    });
    assert.strictEqual(secondObsRes.status, 400);

    await dm.action('story_action', { subAction: 'delete_beat', beatId: obsBeat.id });

    // --- Suite 17: Attack Roll vs Monster AC & Post-Combat Rest Spots ---
    await dm.action('update_mechanics', { showExactMonsterHpToPlayers: true });
    // 17a. Attack roll vs AC (hit or miss matches d20 + modifiers vs target AC)
    const highAcMon = await dm.action('spawn_monster', {
      name: 'Adamantite Statue',
      floor: 1,
      maxHp: 50,
      ac: 60,
      dr: 0,
      hiddenFromPlayers: false,
    });
    assert.strictEqual(highAcMon.status, 200);
    const highAcAtk = await heroPlayer.action('inflict_damage', {
      monsterId: highAcMon.data.monster.id,
      diceFormula: '1d8+2',
      damageType: 'Physical',
      includeStatMod: true,
      attackRoll: true,
    });
    assert.strictEqual(highAcAtk.status, 200);
    assert.ok(highAcAtk.data.attackRoll);
    if (highAcAtk.data.attackRoll.crit) {
      assert.strictEqual(highAcAtk.data.hit, true);
    } else {
      assert.strictEqual(highAcAtk.data.miss, true);
      assert.strictEqual(highAcAtk.data.finalDamage, 0);
      assert.strictEqual(highAcAtk.data.monster.hp, null);
      const dmHighAcState = await dm.get('/api/state');
      assert.strictEqual(dmHighAcState.data.monsters.find((m: any) => m.id === highAcMon.data.monster.id).hp, 50);
    }

    const lowAcMon = await dm.action('spawn_monster', {
      name: 'Target Dummy',
      floor: 1,
      maxHp: 50,
      ac: 1,
      dr: 0,
      hiddenFromPlayers: false,
    });
    assert.strictEqual(lowAcMon.status, 200);
    const lowAcAtk = await heroPlayer.action('inflict_damage', {
      monsterId: lowAcMon.data.monster.id,
      diceFormula: '1d8+2',
      damageType: 'Physical',
      includeStatMod: true,
      attackRoll: true,
    });
    assert.strictEqual(lowAcAtk.status, 200);
    assert.ok(lowAcAtk.data.attackRoll);
    if (lowAcAtk.data.attackRoll.fumble) {
      assert.strictEqual(lowAcAtk.data.miss, true);
      assert.strictEqual(lowAcAtk.data.finalDamage, 0);
    } else {
      assert.strictEqual(lowAcAtk.data.hit, true);
      assert.ok(lowAcAtk.data.finalDamage >= 1);
      assert.strictEqual(lowAcAtk.data.monster.hp, null);
      const dmLowAcState = await dm.get('/api/state');
      assert.ok(dmLowAcState.data.monsters.find((m: any) => m.id === lowAcMon.data.monster.id).hp < 50);
    }

    // 17b. Rest Spots are blocked while active beat still has living monsters, allowed after combat
    const restSpotBeatRes = await dm.action('story_action', {
      subAction: 'add_beat_rest_spot',
      beatId,
      x: 2,
      y: 2,
    });
    assert.strictEqual(restSpotBeatRes.status, 200);
    const restSpotId = restSpotBeatRes.data.beat.arena.restSpots[0].id;

    // Beat `beatId` has an active Bridge Sentinel on its arena -> resting must fail with 400
    const blockedRestUse = await heroPlayer.action('story_action', {
      subAction: 'use_beat_rest_spot',
      beatId,
      restSpotId,
      characterId: heroCharId,
    });
    assert.strictEqual(blockedRestUse.status, 400);
    const blockedDmRest = await dm.action('story_action', { subAction: 'grant_rest_spot', beatId });
    assert.strictEqual(blockedDmRest.status, 400);

    // Defeat all monsters remaining on active arenas so combat ends
    const stateBeforeRest = await dm.get('/api/state');
    for (const m of stateBeforeRest.data.monsters || []) {
      if (Number(m.hp ?? 0) > 0) {
        await dm.action('update_monster', { monsterId: m.id, hp: 0 });
      }
    }
    // Clear any leftover pending reactions so party is out of combat
    for (const r of stateBeforeRest.data.pendingReactions || []) {
      await dm.action('resolve_reaction', { reactionId: r.id, choice: 'accept' });
    }

    // Lower hero's HP/MP and verify Rest Spot restores +50% Max HP & MP once
    const heroMaxHpNow = stateBeforeRest.data.characters[heroCharId].maxHp;
    const heroMaxMpNow = stateBeforeRest.data.characters[heroCharId].maxMp;
    await dm.action('update_character', { characterId: heroCharId, updates: { hp: 1, mp: 0 } });

    const useRestRes = await heroPlayer.action('story_action', {
      subAction: 'use_beat_rest_spot',
      beatId,
      restSpotId,
      characterId: heroCharId,
    });
    assert.strictEqual(useRestRes.status, 200);
    const afterRestState = await heroPlayer.get('/api/state');
    assert.strictEqual(
      afterRestState.data.characters[heroCharId].hp,
      Math.min(heroMaxHpNow, 1 + Math.ceil(heroMaxHpNow * BALANCE.restSpot.hpPct)),
    );
    assert.strictEqual(
      afterRestState.data.characters[heroCharId].mp,
      Math.min(heroMaxMpNow, Math.ceil(heroMaxMpNow * BALANCE.restSpot.mpPct)),
    );

    // Cannot rest at the same Rest Spot a second time
    const repeatRestRes = await heroPlayer.action('story_action', {
      subAction: 'use_beat_rest_spot',
      beatId,
      restSpotId,
      characterId: heroCharId,
    });
    assert.strictEqual(repeatRestRes.status, 400);

    // DM can also grant a post-combat Rest Spot directly
    const dmGrantRest = await dm.action('story_action', { subAction: 'grant_rest_spot', beatId });
    assert.strictEqual(dmGrantRest.status, 200);

    // ── SUITE 18: 200 Passive Skills Tier Rebalance, Sheet & Combat Integration ─
    console.log('Running Suite 18: Passive Skills Tier Rebalance & Combat Integration...');
    assert.strictEqual(PASSIVE_SKILL_POOL.length, 200);
    const sparring = PASSIVE_SKILL_POOL.find((p) => p.name === 'Sparring Habit');
    const eternalMonarch = PASSIVE_SKILL_POOL.find((p) => p.name === 'Eternal Monarch');
    const unarmoredGrace = PASSIVE_SKILL_POOL.find((p) => p.name === 'Unarmored Grace');
    const irregularAuth = PASSIVE_SKILL_POOL.find((p) => p.name === 'Irregular Authority');
    const quickRecovery = PASSIVE_SKILL_POOL.find((p) => p.name === 'Quick Recovery');
    assert.ok(sparring && sparring.description.includes('lvl 1-10 monsters'));
    assert.ok(eternalMonarch && eternalMonarch.description.includes('Revive 100% HP & MP (1/combat)'));
    assert.ok(unarmoredGrace && irregularAuth && quickRecovery);

    // Grant Sparring Habit + Irregular Authority + Eternal Monarch + Quick Recovery to hero via DM update
    await dm.action('update_character', {
      characterId: heroCharId,
      updates: {
        passives: [sparring, irregularAuth, eternalMonarch, quickRecovery, unarmoredGrace],
      },
    });
    const pStateRes = await heroPlayer.get('/api/state');
    const pHero = pStateRes.data.characters[heroCharId];
    const pMods = computePassiveModifiers(pHero);
    assert.strictEqual(pMods.damageBonusVsLowLevel, 1);
    assert.strictEqual(pMods.ignoreAllEnemyDr, true);
    assert.strictEqual(pMods.revivePerCombatPct, 100);
    assert.strictEqual(pMods.reviveMpAlso, true);
    assert.strictEqual(pMods.restSpotBonusHp, 3);

    // Verify Irregular Authority ignores enemy DR + Sparring Habit adds +1 vs Floor 1-10 monster
    const drDummy = await dm.action('spawn_monster', {
      name: 'Armored Dummy',
      floor: 2,
      maxHp: 50,
      ac: 5,
      dr: 10,
    });
    assert.strictEqual(drDummy.status, 200);
    const dummyId = drDummy.data.monster.id;
    const hitDummy = await heroPlayer.action('inflict_damage', {
      monsterId: dummyId,
      rawDamage: 5,
      damageType: 'Physical',
      includeStatMod: false,
    });
    assert.strictEqual(hitDummy.status, 200);
    // 5 raw + 1 Sparring Habit (floor 2 <= 10) + floor(WEAPON_BONUS/2), 10 DR ignored by Irregular Authority
    const expectedWeaponBonus = Math.floor(Number(pHero.equipment?.mainHand?.attackBonus || 0) / 2);
    assert.strictEqual(hitDummy.data.finalDamage, 5 + 1 + expectedWeaponBonus);

    // Verify Eternal Monarch revives at 100% HP & MP once per combat on fatal hit
    await dm.action('update_character', { characterId: heroCharId, updates: { hp: 5, mp: 1 } });
    const fatalHit = await dm.action('monster_attack', {
      monsterId: dummyId,
      targetCharacterId: heroCharId,
      customDamage: 999,
    });
    assert.strictEqual(fatalHit.status, 200);
    if (fatalHit.data.reactive && fatalHit.data.reaction?.id) {
      const reactRes = await heroPlayer.action('resolve_reaction', {
        reactionId: fatalHit.data.reaction.id,
        choice: 'accept',
      });
      assert.strictEqual(reactRes.status, 200);
    }
    const postReviveState = await heroPlayer.get('/api/state');
    const revivedHero = postReviveState.data.characters[heroCharId];
    assert.strictEqual(revivedHero.hp, revivedHero.maxHp);
    assert.strictEqual(revivedHero.mp, revivedHero.maxMp);

    // Defeat dummyId and verify defeatSummary is returned for the MONSTER DEFEATED modal
    const killDummy = await heroPlayer.action('inflict_damage', {
      monsterId: dummyId,
      rawDamage: 999,
      damageType: 'Physical',
      includeStatMod: false,
    });
    assert.strictEqual(killDummy.status, 200);
    assert.ok(killDummy.data.defeatSummary);
    assert.strictEqual(killDummy.data.defeatSummary.monsterName, 'Armored Dummy');
    assert.ok(killDummy.data.defeatSummary.xpGained > 0);
    assert.ok(killDummy.data.defeatSummary.goldGained >= 0);

    // ------------------------------------------------------------------
    // Suite 19: Tactical Ranged Combat (PER, Wall LoS, Cover & Point-Blank)
    // ------------------------------------------------------------------
    console.log('Running Suite 19: Tactical Ranged Combat...');

    // Unit checks on evaluateRangedShot
    const clearShot = evaluateRangedShot({
      startX: 1,
      startY: 5,
      targetX: 4,
      targetY: 5,
      maxRange: 4,
      isRanged: true,
      terrain: [],
      tokens: [],
    });
    assert.strictEqual(clearShot.blockedByTerrain, false);
    assert.strictEqual(clearShot.totalHitPenalty, 0);

    const wallShot = evaluateRangedShot({
      startX: 1,
      startY: 5,
      targetX: 4,
      targetY: 5,
      maxRange: 4,
      isRanged: true,
      terrain: [{ x: 2, y: 5, kind: 'rock', label: 'Wall' } as { x: number; y: number }],
      tokens: [],
    });
    assert.strictEqual(wallShot.blockedByTerrain, true);

    const coverAndPbShot = evaluateRangedShot({
      startX: 1,
      startY: 5,
      targetX: 5,
      targetY: 5,
      maxRange: 4,
      isRanged: true,
      terrain: [],
      tokens: [
        { id: 'ally-1', type: 'player', x: 2, y: 5 },
        { id: 'mon-2', type: 'monster', x: 3, y: 5 },
        { id: 'npc-1', type: 'npc', x: 4, y: 5 },
      ],
      attackerId: 'p1',
      attackerType: 'player',
      targetId: 'mon-target',
    });
    assert.strictEqual(coverAndPbShot.coverPenalty, 4); // capped at -4
    assert.strictEqual(coverAndPbShot.frontFriendlyId, 'ally-1');

    const pointBlankShot = evaluateRangedShot({
      startX: 1,
      startY: 5,
      targetX: 2,
      targetY: 5,
      maxRange: 4,
      isRanged: true,
      terrain: [],
      tokens: [],
    });
    assert.strictEqual(pointBlankShot.pointBlankPenalty, 2);
    assert.strictEqual(pointBlankShot.totalHitPenalty, 2);

    // Equip hero with a ranged bow BEFORE presenting beat (equipment is locked during active beat)
    const addBow = await dm.action('inventory_action', {
      characterId: heroCharId,
      subAction: 'add',
      item: {
        name: 'Test Shortbow',
        category: 'weapon',
        slot: 'mainHand',
        qty: 1,
        damageDice: '1d6+1',
        damageType: 'Piercing (Ranged)',
        rangeSpaces: 4,
        attackBonus: 3,
      },
    });
    assert.strictEqual(addBow.status, 200);
    const bowItem = (addBow.data.character?.inventory || []).find((i: { name: string }) => i.name === 'Test Shortbow');
    assert.ok(bowItem?.id);
    const equipBow = await dm.action('equipment_action', {
      characterId: heroCharId,
      subAction: 'equip',
      itemId: bowItem.id,
    });
    assert.strictEqual(equipBow.status, 200);

    // Server integration: Create a beat with wall + melee & ranged monsters
    const rangedBeatRes = await dm.action('story_action', {
      subAction: 'add_beat',
      title: 'Ranged LoS Test Beat',
      floor: 1,
      beatType: 'combat',
      encounters: [
        { name: 'Melee Slime', maxHp: 50, ac: 10, dr: 0, startX: 6, startY: 6, attackFormula: '1d20+5', damageFormula: '1d6+2' },
        { name: 'Goblin Archer', maxHp: 40, ac: 10, dr: 0, rangeSpaces: 4, startX: 7, startY: 9, attackFormula: '1d20+5', damageFormula: '1d6+2' },
      ],
    });
    assert.strictEqual(rangedBeatRes.status, 200);
    const rBeatId = rangedBeatRes.data.beat.id as string;
    await dm.action('story_action', { subAction: 'present_beat', beatId: rBeatId });
    const spawnBeatMons = await dm.action('story_action', { subAction: 'spawn_beat_monsters', beatId: rBeatId });
    assert.strictEqual(spawnBeatMons.status, 200);

    // Place wall at (4, 5)
    const wallPlace = await dm.action('story_action', {
      subAction: 'toggle_beat_terrain',
      beatId: rBeatId,
      x: 4,
      y: 5,
      kind: 'rock',
      label: 'Stone Pillar',
    });
    assert.strictEqual(wallPlace.status, 200);

    const rStateRes = await dm.get('/api/state');
    const rBeat = (rStateRes.data.storyBeats || []).find((b: { id: string }) => b.id === rBeatId);
    assert.ok(rBeat);
    const meleeMon = (rStateRes.data.monsters || []).find((m: { name: string }) => m.name === 'Melee Slime');
    const archerMon = (rStateRes.data.monsters || []).find((m: { name: string }) => m.name === 'Goblin Archer');
    assert.ok(meleeMon && archerMon);
    assert.strictEqual(meleeMon.rangeSpaces, 1);
    assert.strictEqual(archerMon.rangeSpaces, 4);

    const advanceTurnTo = async (targetId: string) => {
      for (let step = 0; step < 20; step++) {
        const st = await dm.get('/api/state');
        const comb = st.data.combat?.combatants?.[st.data.combat?.turnIndex ?? 0];
        if (!comb || comb.id === targetId) return;
        await dm.action('initiative_action', { subAction: 'next_turn' });
      }
    };

    const moveHero = await dm.action('story_action', { subAction: 'move_beat_token', beatId: rBeatId, tokenId: heroCharId, x: 2, y: 5 });
    assert.strictEqual(moveHero.status, 200);

    await advanceTurnTo(heroCharId);
    const wallBlockedPlayer = await heroPlayer.action('inflict_damage', {
      monsterId: meleeMon.id,
      beatId: rBeatId,
      diceFormula: '1d6+1',
      damageType: 'Piercing (Ranged)',
      includeStatMod: true,
      attackRoll: true,
    });
    assert.strictEqual(wallBlockedPlayer.status, 400);
    assert.ok(String(wallBlockedPlayer.data.error || '').toLowerCase().includes('impassable terrain'), wallBlockedPlayer.data.error);

    // Melee Slime at (5,5) cannot attack hero at (2,5) (1 Sp max)
    await advanceTurnTo(meleeMon.id);
    const meleeOutOfRange = await dm.action('monster_attack', {
      monsterId: meleeMon.id,
      targetCharacterId: heroCharId,
    });
    assert.strictEqual(meleeOutOfRange.status, 400);
    assert.ok(String(meleeOutOfRange.data.error || '').toLowerCase().includes('out of range'), meleeOutOfRange.data.error);

    // Goblin Archer at (6,8) can attack hero at (6,5) (3 Sp away) when hero moves to (6,5), and uses PER for player shots
    await advanceTurnTo(heroCharId);
    await dm.action('story_action', { subAction: 'move_beat_token', beatId: rBeatId, tokenId: heroCharId, x: 6, y: 5 });
    await advanceTurnTo(archerMon.id);
    const archerHit = await dm.action('monster_attack', {
      monsterId: archerMon.id,
      targetCharacterId: heroCharId,
    });
    assert.strictEqual(archerHit.status, 200);
    if (archerHit.data.reactive && archerHit.data.reaction?.id) {
      await heroPlayer.action('resolve_reaction', { reactionId: archerHit.data.reaction.id, choice: 'accept' });
    }

    await advanceTurnTo(heroCharId);
    const playerPerShot = await heroPlayer.action('inflict_damage', {
      monsterId: archerMon.id,
      beatId: rBeatId,
      diceFormula: '1d6+1',
      damageType: 'Piercing (Ranged)',
      includeStatMod: true,
      attackRoll: true,
    });
    assert.strictEqual(playerPerShot.status, 200);
    if (playerPerShot.data.attackRoll) {
      assert.ok(String(playerPerShot.data.attackRoll.breakdown).includes('[PER]'));
    }

    console.log('ALL 19 PRODUCTION TEST SUITES PASSED!');
  } finally {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
