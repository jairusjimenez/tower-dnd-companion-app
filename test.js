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

    // 2. DM & Player mock logins + role isolation
    const badDm = await req(baseUrl, '/api/auth/login', { identifier: 'admin', password: 'wrong' });
    assert.strictEqual(badDm.status, 401);
    const okDm = await req(baseUrl, '/api/auth/login', { identifier: 'admin', password: '123456' });
    assert.strictEqual(okDm.status, 200);
    assert.strictEqual(okDm.data.session.role, 'dm');
    const mockPlayer = await req(baseUrl, '/api/auth/login', { identifier: 'player', password: '123456' });
    assert.strictEqual(mockPlayer.status, 200);
    assert.strictEqual(mockPlayer.data.session.role, 'player');
    assert.strictEqual(mockPlayer.data.session.username, 'player');

    // Unified first-time login auto-activation via invited email
    await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'dm_manage_invites',
      payload: { subAction: 'add', email: 'first@tower.gg', characterName: 'First Climber', race: 'Elf', className: 'Mage' },
    });
    const unifiedFirst = await req(baseUrl, '/api/auth/login', { identifier: 'first@tower.gg', password: 'initpass' });
    assert.strictEqual(unifiedFirst.status, 200);
    assert.strictEqual(unifiedFirst.data.firstTimeActivated, true);
    assert.strictEqual(unifiedFirst.data.session.role, 'player');

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
      payload: { name: 'Blue Venom Kasaka', floor: 1, maxHp: 50, ac: 14, dr: 2, hiddenFromPlayers: false },
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

    // 8. Vertical Tower Map: DM adds higher floor (+5 rows) & applies themed tower
    const beforeMapState = await req(baseUrl, `/api/state?role=dm`);
    const prevTopFloor = beforeMapState.data.map.floors.reduce((m, f) => Math.max(m, f.number), 0);
    const prevRows = beforeMapState.data.map.rows;
    const addFloor = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'update_map',
      payload: { subAction: 'add_floor', title: `${prevTopFloor + 1}F • Shifting Dunes`, startFogged: true },
    });
    assert.strictEqual(addFloor.data.map.floors[0].number, prevTopFloor + 1);
    assert.strictEqual(addFloor.data.map.rows, prevRows + 5);

    const themeTower = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'update_map',
      payload: { subAction: 'apply_tower_themes', preset: 'classic', ensureFloors: 3 },
    });
    assert.strictEqual(themeTower.status, 200);
    assert.strictEqual(themeTower.data.map.floors.find((f) => f.number === 1).theme, 'forest');
    assert.strictEqual(themeTower.data.map.floors.find((f) => f.number === 2).theme, 'desert');
    assert.strictEqual(themeTower.data.map.floors.find((f) => f.number === 3).theme, 'underworld');

    const topToDelete = themeTower.data.map.floors[0].number;
    const rowsBeforeDel = themeTower.data.map.rows;
    const delFloorRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'update_map',
      payload: { subAction: 'delete_floor', floorNumber: topToDelete },
    });
    assert.strictEqual(delFloorRes.status, 200);
    assert.ok(!delFloorRes.data.map.floors.some((f) => f.number === topToDelete));
    assert.strictEqual(delFloorRes.data.map.rows, rowsBeforeDel - 5);

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

    // 11. Story Beats orchestration (add, present, spawn monsters, award treasure, player filtering)
    const addBeat = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'story_action',
      payload: {
        subAction: 'add_beat',
        title: '3F • Bridge Guardian',
        floor: 3,
        narration: 'A crystal sentinel blocks the bridge.',
        dmSecret: 'Weak to Fire.',
        encounters: [{ name: 'Bridge Sentinel', maxHp: 40, ac: 15, dr: 2, startX: 10, startY: 5 }],
        treasures: [{ name: 'Bridge Key', category: 'relic', gold: 75, manaStones: 2 }],
      },
    });
    assert.strictEqual(addBeat.status, 200);
    const beatId = addBeat.data.beat.id;

    // Unpresented beat should be hidden from player state
    const beforePresent = await req(baseUrl, `/api/state?role=player&characterId=${heroCharId}`);
    assert.ok(!beforePresent.data.storyBeats.some((b) => b.id === beatId));

    await req(baseUrl, '/api/action', { role: 'dm', type: 'story_action', payload: { subAction: 'present_beat', beatId } });
    const afterPresent = await req(baseUrl, `/api/state?role=player&characterId=${heroCharId}`);
    const playerBeat = afterPresent.data.storyBeats.find((b) => b.id === beatId);
    assert.ok(playerBeat);
    assert.strictEqual(playerBeat.dmSecret, null);

    const spawnBeat = await req(baseUrl, '/api/action', { role: 'dm', type: 'story_action', payload: { subAction: 'spawn_beat_monsters', beatId } });
    assert.strictEqual(spawnBeat.data.spawned.length, 1);

    // Story Beat Tactical Arena Map defaults to 20x20 and supports switching to 25x25 / custom sizes
    const beatArenaState = await req(baseUrl, `/api/state?role=player&characterId=${heroCharId}`);
    const arenaBeat = beatArenaState.data.storyBeats.find((b) => b.id === beatId);
    assert.strictEqual(arenaBeat.arena.cols, 20);
    assert.strictEqual(arenaBeat.arena.rows, 20);
    const spawnedTok = arenaBeat.arena.tokens.find((t) => t.id === spawnBeat.data.spawned[0].id);
    assert.ok(spawnedTok);
    assert.strictEqual(spawnedTok.x, 9); // 1-based startX 10 -> 0-based 9
    assert.strictEqual(spawnedTok.y, 4); // 1-based startY 5 -> 0-based 4

    // DM designates & saves starting positions and resets to them
    await req(baseUrl, '/api/action', { role: 'dm', type: 'story_action', payload: { subAction: 'move_beat_token', beatId, tokenId: heroCharId, x: 4, y: 15 } });
    await req(baseUrl, '/api/action', { role: 'dm', type: 'story_action', payload: { subAction: 'save_beat_starts', beatId } });
    await req(baseUrl, '/api/action', { role: 'dm', type: 'story_action', payload: { subAction: 'move_beat_token', beatId, tokenId: heroCharId, x: 1, y: 1 } });
    await req(baseUrl, '/api/action', { role: 'dm', type: 'story_action', payload: { subAction: 'reset_beat_starts', beatId } });
    const resetArenaState = await req(baseUrl, `/api/state?role=player&characterId=${heroCharId}`);
    const resetHeroTok = resetArenaState.data.storyBeats.find((b) => b.id === beatId).arena.tokens.find((t) => t.id === heroCharId);
    assert.strictEqual(resetHeroTok.x, 4);
    assert.strictEqual(resetHeroTok.y, 15);

    // Story Beat player start positions + Treasure Chests on map
    const chestRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'story_action',
      payload: { subAction: 'add_beat_chest', beatId, name: 'Golden Gate Chest', x: 5, y: 5, gold: 80, manaStones: 2, itemName: 'Gate Key' },
    });
    assert.strictEqual(chestRes.status, 200);
    const chestId = chestRes.data.beat.arena.chests[0].id;
    const openChestRes = await req(baseUrl, '/api/action', {
      role: 'player',
      characterId: heroCharId,
      type: 'story_action',
      payload: { subAction: 'open_beat_chest', beatId, chestId, characterId: heroCharId },
    });
    assert.strictEqual(openChestRes.status, 200);
    assert.strictEqual(openChestRes.data.beat.arena.chests[0].opened, true);

    await req(baseUrl, '/api/action', { role: 'dm', type: 'story_action', payload: { subAction: 'set_beat_grid', beatId, cols: 25, rows: 25 } });
    const resizedState = await req(baseUrl, `/api/state?role=player&characterId=${heroCharId}`);
    const resizedBeat = resizedState.data.storyBeats.find((b) => b.id === beatId);
    assert.strictEqual(resizedBeat.arena.cols, 25);
    assert.strictEqual(resizedBeat.arena.rows, 25);

    // Impassable terrain auto-generation from cryptic prompt, biome selection, and movement blocking
    const genTerrainRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'story_action',
      payload: { subAction: 'generate_beat_terrain', beatId, prompt: 'misty forest split by a winding river and ancient boulders', biome: 'obsidian' },
    });
    assert.strictEqual(genTerrainRes.status, 200);
    assert.strictEqual(genTerrainRes.data.beat.arena.biome, 'forest');
    assert.ok(Array.isArray(genTerrainRes.data.beat.arena.terrain) && genTerrainRes.data.beat.arena.terrain.length > 0);
    assert.ok(genTerrainRes.data.beat.arena.terrain.some((t) => t.type === 'water'));

    const setBiomeRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'story_action',
      payload: { subAction: 'set_beat_biome', beatId, biome: 'desert' },
    });
    assert.strictEqual(setBiomeRes.status, 200);
    assert.strictEqual(setBiomeRes.data.beat.arena.biome, 'desert');

    await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'story_action',
      payload: { subAction: 'toggle_beat_terrain', beatId, x: 7, y: 7, terrainType: 'rock' },
    });
    const blockedMove = await req(baseUrl, '/api/action', {
      role: 'player',
      characterId: heroCharId,
      type: 'story_action',
      payload: { subAction: 'move_beat_token', beatId, tokenId: heroCharId, x: 7, y: 7 },
    });
    assert.strictEqual(blockedMove.status, 400);

    // DM adds an NPC to the arena map and moves it
    const addNpcRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'story_action',
      payload: { subAction: 'add_beat_npc', beatId, name: 'Elder Lyra', npcRole: 'Quest Giver', x: 3, y: 3 },
    });
    assert.strictEqual(addNpcRes.status, 200);
    const npcTok = addNpcRes.data.beat.arena.tokens.find((t) => t.type === 'npc' && t.name === 'Elder Lyra');
    assert.ok(npcTok);
    assert.strictEqual(npcTok.npcRole, 'Quest Giver');
    assert.strictEqual(npcTok.x, 3);
    assert.strictEqual(npcTok.y, 3);
    const moveNpcRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'story_action',
      payload: { subAction: 'move_beat_token', beatId, tokenId: npcTok.id, x: 4, y: 4 },
    });
    assert.strictEqual(moveNpcRes.status, 200);

    // NPC dialogue + Skill Book gift when talked to by a player
    const sageRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'story_action',
      payload: {
        subAction: 'add_beat_npc',
        beatId,
        name: 'Master Jin',
        npcRole: 'Skill Master',
        dialogue: 'Learn the Shadow Step!',
        rewardType: 'skill_book',
        rewardItemName: 'Shadow Step',
        x: 6,
        y: 6,
      },
    });
    assert.strictEqual(sageRes.status, 200);
    const sageTok = sageRes.data.beat.arena.tokens.find((t) => t.name === 'Master Jin');
    const talkRes = await req(baseUrl, '/api/action', {
      role: 'player',
      characterId: heroCharId,
      type: 'story_action',
      payload: { subAction: 'talk_beat_npc', beatId, tokenId: sageTok.id, characterId: heroCharId },
    });
    assert.strictEqual(talkRes.status, 200);
    const afterTalkState = await req(baseUrl, `/api/state?role=player&characterId=${heroCharId}`);
    const heroAfterTalk = afterTalkState.data.characters[heroCharId];
    assert.ok(heroAfterTalk.skills.some((s) => s.name === 'Shadow Step'));
    assert.ok(heroAfterTalk.inventory.some((i) => i.name.includes('Shadow Step')));

    // Monster loot drop when defeated (HP -> 0)
    const lootMonRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'spawn_monster',
      payload: {
        name: 'Loot Goblin',
        floor: 2,
        maxHp: 10,
        loot: { itemName: 'Goblin Crown', gold: 45, manaStones: 1 },
      },
    });
    assert.strictEqual(lootMonRes.status, 200);
    const lootMonId = lootMonRes.data.monster.id;
    const goldBeforeDrop = heroAfterTalk.currency.gold;
    await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'update_monster',
      payload: { monsterId: lootMonId, hp: 0 },
    });
    const afterDropState = await req(baseUrl, `/api/state?role=player&characterId=${heroCharId}`);
    const heroAfterDrop = afterDropState.data.characters[heroCharId];
    assert.ok(heroAfterDrop.currency.gold >= goldBeforeDrop + 45);
    assert.ok(heroAfterDrop.inventory.some((i) => i.name === 'Goblin Crown'));

    // Edit existing story beat via update_beat
    const updBeatRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'story_action',
      payload: {
        subAction: 'update_beat',
        beatId,
        title: 'Updated Gate Trial',
        floor: 3,
        xpReward: 150,
        gridSize: 30,
        narration: 'Updated narration text.',
      },
    });
    assert.strictEqual(updBeatRes.status, 200);
    assert.strictEqual(updBeatRes.data.beat.title, 'Updated Gate Trial');
    assert.strictEqual(updBeatRes.data.beat.floor, 3);
    assert.strictEqual(updBeatRes.data.beat.xpReward, 150);
    assert.strictEqual(updBeatRes.data.beat.arena.cols, 30);

    // Toast always prefixes "SYSTEM: "
    const sysToastRes = await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'broadcast_toast',
      payload: { title: 'SYSTEM NOTICE', category: 'info', target: 'all', message: 'Gate opens!' },
    });
    assert.strictEqual(sysToastRes.status, 200);
    assert.strictEqual(sysToastRes.data.toast.message, 'SYSTEM: Gate opens!');

    const awardBeat = await req(baseUrl, '/api/action', { role: 'dm', type: 'story_action', payload: { subAction: 'award_beat_treasure', beatId, characterId: heroCharId } });
    assert.strictEqual(awardBeat.status, 200);

    // 12. Level 1 start, stat allocation, and Story Beat XP -> Level Up (+2 stat points)
    const beforeXpState = await req(baseUrl, `/api/state?role=player&characterId=${heroCharId}`);
    const heroBefore = beforeXpState.data.characters[heroCharId];
    assert.strictEqual(heroBefore.level, 1);
    const prevPts = heroBefore.unspentStatPoints;
    assert.ok(prevPts >= 10);
    const prevStr = heroBefore.stats.STR;

    const alloc = await req(baseUrl, '/api/action', {
      role: 'player',
      characterId: heroCharId,
      type: 'allocate_stat',
      payload: { statKey: 'STR', amount: 3 },
    });
    assert.strictEqual(alloc.data.character.stats.STR, prevStr + 3);
    assert.strictEqual(alloc.data.character.unspentStatPoints, prevPts - 3);

    // Award 120 XP from Story Beat -> Level 1 (100 XP) -> Level 2 with 20 XP leftover and +2 unspent stat points
    await req(baseUrl, '/api/action', {
      role: 'dm',
      type: 'story_action',
      payload: { subAction: 'award_beat_xp', beatId, characterId: heroCharId, xpReward: 120 },
    });
    const afterXpState = await req(baseUrl, `/api/state?role=player&characterId=${heroCharId}`);
    const heroAfter = afterXpState.data.characters[heroCharId];
    assert.strictEqual(heroAfter.level, 2);
    assert.strictEqual(heroAfter.xp, (heroBefore.xp || 0) + 20);
    assert.strictEqual(heroAfter.unspentStatPoints, prevPts - 1);

    // 13. Stat Milestone Awakening at STR 20
    const neededStr = Math.max(0, 20 - Number(heroAfter.stats.STR || 14));
    if (neededStr > 0) {
      await req(baseUrl, '/api/action', {
        role: 'player',
        characterId: heroCharId,
        type: 'allocate_stat',
        payload: { statKey: 'STR', amount: neededStr },
      });
    }
    const awkState = await req(baseUrl, `/api/state?role=player&characterId=${heroCharId}`);
    assert.ok(awkState.data.characters[heroCharId].skills.some((s) => s.name === 'Titan Cleave'));
    const strMilestones = (awkState.data.mechanics.statMilestones || []).filter((m) => m.statKey === 'STR').map((m) => m.threshold);
    assert.deepStrictEqual(strMilestones, [20, 40, 60, 80, 100]);
    assert.ok(Array.isArray(awkState.data.playerHistory) && awkState.data.playerHistory.length > 0);
    assert.ok(Array.isArray(awkState.data.characters[heroCharId].history) && awkState.data.characters[heroCharId].history.length > 0);

    // 14. Two-Step Login Check & DM Email First-Time Setup Flow (jairusjimenez@live.com)
    const unknownCheck = await req(baseUrl, '/api/auth/check-identifier', { identifier: 'not-invited@tower.gg' });
    assert.strictEqual(unknownCheck.status, 404);
    assert.strictEqual(unknownCheck.data.error, 'You are not allowed to enter the Tower');
    const invitedPlayerCheck = await req(baseUrl, '/api/auth/check-identifier', { identifier: 'thalindra@tower.gg' });
    assert.strictEqual(invitedPlayerCheck.status, 200);
    assert.strictEqual(invitedPlayerCheck.data.found, true);

    const dmFirstTry = await req(baseUrl, '/api/auth/login', { identifier: 'jairusjimenez@live.com', password: 'random-password-123' });
    assert.strictEqual(dmFirstTry.status, 200);
    assert.strictEqual(dmFirstTry.data.requiresDmSetup, true);
    const dmSetupRes = await req(baseUrl, '/api/auth/dm-setup', {
      email: 'jairusjimenez@live.com',
      newUsername: 'jairus_dm',
      newPassword: 'secret-dm-pass',
    });
    assert.strictEqual(dmSetupRes.status, 200);
    assert.strictEqual(dmSetupRes.data.session.role, 'dm');
    const dmBadLogin = await req(baseUrl, '/api/auth/login', { identifier: 'jairus_dm', password: 'wrong' });
    assert.strictEqual(dmBadLogin.status, 401);
    const dmGoodLogin = await req(baseUrl, '/api/auth/login', { identifier: 'jairus_dm', password: 'secret-dm-pass' });
    assert.strictEqual(dmGoodLogin.status, 200);
    assert.strictEqual(dmGoodLogin.data.session.role, 'dm');

    console.log('ALL 12 INTEGRATION TEST SUITES PASSED!');
  } finally {
    await req(baseUrl, '/api/action', { role: 'dm', type: 'reset_campaign' }).catch(() => {});
    server.close();
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
