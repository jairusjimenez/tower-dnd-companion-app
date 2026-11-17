const assert = require('assert');
const { createServer, evaluateFormula, rollDiceServer, parseDeityTextIntoEntries } = require('./server');

async function req(baseUrl, path, body = null) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function runTests() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Safe formula evaluator & d100 dice coverage
    assert.strictEqual(evaluateFormula('floor((SCORE - 10) / 2)', { SCORE: 18 }), 4);
    assert.strictEqual(evaluateFormula('max(1, RAW_DMG + STAT_MOD - TARGET_DR)', { RAW_DMG: 14, STAT_MOD: 3, TARGET_DR: 2 }), 15);
    const d100 = rollDiceServer({ count: 2, sides: 100, modifier: 5 });
    assert.strictEqual(d100.rolls.length, 2);
    assert.ok(d100.rolls.every((n) => n >= 1 && n <= 100));

    // 2. DM login & role isolation
    const badDm = await req(baseUrl, '/api/auth/login', { role: 'dm', passcode: 'wrong' });
    assert.strictEqual(badDm.status, 401);
    const okDm = await req(baseUrl, '/api/auth/login', { role: 'dm', passcode: 'dm123' });
    assert.strictEqual(okDm.status, 200);
    assert.strictEqual(okDm.data.session.role, 'dm');

    // 3. DM whitelists player email -> first-time login creates password -> change username & password -> re-login
    const invite = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'dm_manage_invites',
      payload: { subAction: 'add', email: 'hero@test.gg', characterName: 'Sung Jin-Test', race: 'Human', className: 'Monarch' },
    });
    assert.strictEqual(invite.status, 200);

    const check = await req(baseUrl, '/api/auth/check-email', { email: 'hero@test.gg' });
    assert.strictEqual(check.status, 200);
    assert.strictEqual(check.data.activated, false);

    const activate = await req(baseUrl, '/api/auth/activate', {
      email: 'hero@test.gg',
      username: 'jinwoo_init',
      password: 'secret123',
    });
    assert.strictEqual(activate.status, 200);
    assert.strictEqual(activate.data.session.username, 'jinwoo_init');
    const heroCharId = activate.data.session.characterId;

    const updateCreds = await req(baseUrl, '/api/auth/update-credentials', {
      email: 'hero@test.gg',
      currentPassword: 'secret123',
      newUsername: 'shadow_monarch',
      newPassword: 'newpass456',
    });
    assert.strictEqual(updateCreds.status, 200);
    assert.strictEqual(updateCreds.data.username, 'shadow_monarch');

    const loginNew = await req(baseUrl, '/api/auth/login', {
      role: 'player',
      identifier: 'shadow_monarch',
      password: 'newpass456',
    });
    assert.strictEqual(loginNew.status, 200);
    assert.strictEqual(loginNew.data.session.characterId, heroCharId);

    // 4. DM Start/Stop session & System Toast broadcast
    const stopRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'session_control',
      payload: { action: 'stop', pausedMessage: 'Break time!' },
    });
    assert.strictEqual(stopRes.data.session.status, 'stopped');

    const startRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'session_control',
      payload: { action: 'start' },
    });
    assert.strictEqual(startRes.data.session.status, 'active');

    const toastRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'broadcast_toast',
      payload: { title: 'SYSTEM ALERT', message: 'A Boss Gate opened on 3F!', category: 'combat', target: 'all' },
    });
    assert.strictEqual(toastRes.status, 200);

    // 5. DM adds monster -> Player inflicts real-time damage -> check monster HP drops accurately
    const spawn = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'spawn_monster',
      payload: { name: 'Blue Venom Kasaka', floor: 2, maxHp: 50, ac: 14, dr: 2, hiddenFromPlayers: false },
    });
    assert.strictEqual(spawn.status, 200);
    const monId = spawn.data.monster.id;

    const dmgRes = await req(baseUrl, '/api/action', {
      role: 'player',
      characterId: heroCharId,
      type: 'inflict_damage',
      payload: { monsterId: monId, attackerId: heroCharId, rawDamage: 17, damageType: 'Slashing', includeStatMod: false },
    });
    // Damage formula: max(1, (17 * 1) + 0 - 2 DR) = 15 -> 50 - 15 = 35 HP
    assert.strictEqual(dmgRes.data.finalDamage, 15);
    assert.strictEqual(dmgRes.data.monster.hp, 35);

    const playerState = await req(baseUrl, `/api/state?role=player&characterId=${heroCharId}`);
    assert.strictEqual(playerState.data.notes.dmPrivate, null);
    const playerSeenMonster = playerState.data.monsters.find((m) => m.id === monId);
    assert.strictEqual(playerSeenMonster.hp, 35);

    // 6. Reactive Combat: DM triggers monster attack -> Player Counter-Attacks
    const monAtk = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'monster_attack',
      payload: { monsterId: monId, targetCharacterId: heroCharId, customDamage: 8 },
    });
    assert.strictEqual(monAtk.data.reactive, true);
    const reactRes = await req(baseUrl, '/api/action', {
      role: 'player',
      characterId: heroCharId,
      type: 'resolve_reaction',
      payload: { reactionId: monAtk.data.reaction.id, choice: 'counter', diceFormula: '1d8+4' },
    });
    assert.ok(reactRes.data.counterDamageDealt >= 1);
    assert.ok(reactRes.data.monster.hp < 35);

    // 7. DM Custom Mechanics & Custom Stats
    const mechRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'update_mechanics',
      payload: {
        presetName: 'Homebrew Aura System',
        stats: [{ key: 'STR', name: 'Strength', defaultValue: 15 }, { key: 'AURA', name: 'Aura Power', defaultValue: 20 }],
        statFormula: 'floor(SCORE / 5)',
      },
    });
    assert.strictEqual(mechRes.data.mechanics.stats.length, 2);

    // 8. Vertical Tower Map: DM adds 6F & checks grid dimensions
    const addFloor = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'update_map',
      payload: { subAction: 'add_floor', title: '6F • Celestial Observatory', startFogged: true },
    });
    assert.strictEqual(addFloor.data.map.floors[0].number, 6);
    assert.strictEqual(addFloor.data.map.rows, 30);

    // 9. Free-Flow Magic (detailed explanation + damage + range in Spaces) & Equipment/Inventory
    const spellRes = await req(baseUrl, '/api/action', {
      role: 'player',
      characterId: heroCharId,
      type: 'spell_action',
      payload: {
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
      },
    });
    assert.strictEqual(spellRes.status, 200);
    assert.strictEqual(spellRes.data.spell.rangeSpaces, 4);

    // 10. AI Character Art prompt push & Deity Google Doc parser
    const artRes = await req(baseUrl, '/api/action', {
      role: 'player',
      characterId: heroCharId,
      type: 'generate_character_art',
      payload: { prompt: 'Shadow monarch knight with purple aura and twin daggers', style: 'Korean Manhwa Webtoon' },
    });
    assert.ok(artRes.data.portraitUrl.startsWith('data:image/svg+xml;base64,'));

    const deityParsed = parseDeityTextIntoEntries('Solarix\nDomain: Sun\nBlessing: Dawn\nBoon: +5 Radiant\nRange: 6 Spaces', 'https://docs.google.com/document/d/demo');
    assert.strictEqual(deityParsed.length, 1);
    assert.strictEqual(deityParsed[0].name, 'Solarix');

    const gdocImport = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'deity_action',
      payload: { subAction: 'import_google_doc', rawText: 'Noxar, God of Gates\nDomain: Portals\nBlessing: Gate Warp\nBoon: +4 Arcane\nRange: 8 Spaces' },
    });
    assert.ok(gdocImport.data.deities.some((d) => d.name.includes('Noxar')));

    console.log('ALL 10 INTEGRATION TEST SUITES PASSED!');
  } finally {
    await req(baseUrl, '/api/action', { role: 'dm', type: 'reset_campaign' }).catch(() => {});
    server.close();
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
