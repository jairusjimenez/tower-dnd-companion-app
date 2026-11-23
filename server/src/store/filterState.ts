import {
  PASSIVE_SKILL_POOL,
  getPartyFloor,
  getPassiveOddsForFloor,
  type FilteredGameState,
  type GameState,
  type Monster,
  type PlayerAccountRecord,
  type SanitizedPlayerAccount,
  type UserRole,
} from '../../../shared';

export function computeMonsterHealthTier(hp: number | null, maxHp: number | null): string {
  const cur = Number(hp ?? 0);
  const max = Number(maxHp ?? 0);
  const pct = max > 0 ? cur / max : 0;
  if (cur <= 0) return 'Defeated';
  if (pct <= 0.3) return 'Critical';
  if (pct <= 0.65) return 'Bloodied';
  return 'Healthy';
}

export function maskMonsterForRole(
  mon: Monster,
  state: GameState,
  role: UserRole,
  characterId: string | null = null,
): Monster {
  const healthTier = computeMonsterHealthTier(mon.hp, mon.maxHp);
  const hpPct =
    mon.maxHp && mon.maxHp > 0
      ? Math.max(0, Math.min(100, Math.round((Number(mon.hp ?? 0) / Number(mon.maxHp)) * 100)))
      : 0;
  if (role === 'dm') {
    return { ...mon, healthTier, hpPct, observedByViewer: true };
  }
  const hasObserved = Boolean(
    characterId && state.characters?.[characterId]?.observedMonsterIds?.includes(mon.id),
  );
  if (hasObserved) {
    return { ...mon, healthTier, hpPct, observedByViewer: true };
  }
  return {
    ...mon,
    hp: null,
    maxHp: null,
    ac: 0,
    dr: 0,
    attackFormula: '',
    damageFormula: '',
    skills: [],
    healthTier: 'Unknown',
    hpPct,
    observedByViewer: false,
  };
}

export function sanitizeAccounts(
  accountsMap: Record<string, PlayerAccountRecord> | undefined,
): Record<string, SanitizedPlayerAccount> {
  const clean: Record<string, SanitizedPlayerAccount> = {};
  for (const [email, acc] of Object.entries(accountsMap || {})) {
    clean[email] = {
      id: acc.id,
      email: acc.email,
      username: acc.username,
      characterId: acc.characterId,
      activated: Boolean(acc.activated),
      invitedAt: acc.invitedAt,
      lastLoginAt: acc.lastLoginAt,
    };
  }
  return clean;
}

export function filterStateForRole(
  srcState: GameState,
  role: UserRole,
  characterId: string | null = null,
): FilteredGameState {
  const isDm = role === 'dm';
  const fogSet = new Set(srcState.map?.fog || []);
  const observedSet = new Set(
    !isDm && characterId ? srcState.characters?.[characterId]?.observedMonsterIds || [] : [],
  );
  const deadMonsterIds = new Set(
    (srcState.monsters || []).filter((m) => Number(m.hp) <= 0).map((m) => m.id),
  );

  const filteredTokens = (srcState.map?.tokens || [])
    .filter((tok) => {
      if (tok.type === 'monster' && deadMonsterIds.has(tok.id)) return false;
      if (isDm) return true;
      if (tok.hiddenFromPlayers) return false;
      if (tok.type !== 'player' && fogSet.has(`${tok.x},${tok.y}`)) return false;
      return true;
    })
    .map((tok) => (!isDm && tok.type === 'monster' && !observedSet.has(tok.id) ? { ...tok, hp: null, maxHp: null } : tok));

  const filteredMonsters = (srcState.monsters || [])
    .filter((m) => {
      if (isDm) return true;
      if (m.hiddenFromPlayers) return false;
      const tok = (srcState.map?.tokens || []).find((t) => t.id === m.id);
      if (tok && fogSet.has(`${tok.x},${tok.y}`)) return false;
      return true;
    })
    .map((m) => maskMonsterForRole(m, srcState, role, characterId));

  const filteredCombatants = (srcState.combat?.combatants || []).filter(
    (c) => isDm || !c.hiddenFromPlayers,
  );
  const filteredMessages = (srcState.systemMessages || []).filter(
    (m) => isDm || m.target === 'all' || !m.target || m.target === characterId,
  );
  const filteredReactions = (srcState.pendingReactions || []).filter(
    (r) => isDm || !characterId || r.targetCharacterId === characterId,
  );
  const lastResolvedClash =
    srcState.lastResolvedClash &&
    (isDm || !characterId || srcState.lastResolvedClash.targetCharacterId === characterId)
      ? srcState.lastResolvedClash
      : null;
  const recentMonsterDefeats = (srcState.recentMonsterDefeats || []).filter(
    (d) => isDm || (Boolean(characterId) && d.killerCharacterId === characterId),
  );

  return {
    version: srcState.version,
    schemaVersion: srcState.schemaVersion,
    session: srcState.session,
    mechanics: srcState.mechanics,
    passiveGacha: {
      odds: getPassiveOddsForFloor(
        Number(characterId ? srcState.characters?.[characterId]?.currentFloor : 0) || getPartyFloor(srcState),
      ),
      pool: PASSIVE_SKILL_POOL,
    },
    grimoire: srcState.grimoire || [],
    deities: srcState.deities || [],
    characters: srcState.characters,
    playerAccounts: sanitizeAccounts(srcState.playerAccounts),
    dmAccount: {
      email: srcState.dmAccount?.email || 'jairusjimenez@live.com',
      username: srcState.dmAccount?.username || '',
      activated: Boolean(srcState.dmAccount?.activated),
    },
    monsters: filteredMonsters,
    pendingReactions: filteredReactions,
    lastResolvedClash,
    recentMonsterDefeats,
    bestiary: isDm ? srcState.bestiary : [],
    npcRoster: isDm ? srcState.npcRoster || [] : [],
    treasureCatalog: isDm ? srcState.treasureCatalog || [] : [],
    chestCatalog: isDm ? srcState.chestCatalog : undefined,
    map: {
      ...srcState.map,
      tokens: filteredTokens,
    },
    combat: {
      ...srcState.combat,
      combatants: filteredCombatants,
    },
    notes: {
      dmPrivate: isDm ? srcState.notes?.dmPrivate : null,
      sharedQuests: srcState.notes?.sharedQuests || '',
    },
    storyBeats: (srcState.storyBeats || [])
      .filter((b) => isDm || b.presented)
      .map((b) => {
        const arena = b.arena || { cols: 20, rows: 20, biome: 'obsidian', terrain: [], tokens: [], chests: [] };
        const arenaTokens = (arena.tokens || [])
          .filter((t) => {
            if (t.type === 'monster' && deadMonsterIds.has(t.id)) return false;
            return isDm || !t.hiddenFromPlayers;
          })
          .map((t) => (!isDm && t.type === 'monster' && !observedSet.has(t.id) ? { ...t, hp: null, maxHp: null } : t));
        const mapped = { ...b, arena: { ...arena, tokens: arenaTokens } };
        return isDm ? mapped : { ...mapped, dmSecret: null };
      }),
    systemMessages: filteredMessages,
    combatLog: srcState.combatLog || [],
    playerHistory: srcState.playerHistory || [],
    rollLog: (srcState.rollLog || []).filter((r) => isDm || !r.isSecret),
  };
}
