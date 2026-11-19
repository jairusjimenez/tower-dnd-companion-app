import {
  PASSIVE_GACHA_ODDS,
  PASSIVE_SKILL_POOL,
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

export function maskMonsterForRole(mon: Monster, state: GameState, role: UserRole): Monster {
  const healthTier = computeMonsterHealthTier(mon.hp, mon.maxHp);
  const showExactHp = role === 'dm' || state.mechanics?.showExactMonsterHpToPlayers !== false;
  if (showExactHp) {
    return { ...mon, healthTier };
  }
  return {
    ...mon,
    hp: null,
    maxHp: null,
    healthTier,
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
  const showExactHp = srcState.mechanics?.showExactMonsterHpToPlayers !== false;
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
    .map((tok) => (!isDm && !showExactHp && tok.type === 'monster' ? { ...tok, hp: null, maxHp: null } : tok));

  const filteredMonsters = (srcState.monsters || [])
    .filter((m) => {
      if (isDm) return true;
      if (m.hiddenFromPlayers) return false;
      const tok = (srcState.map?.tokens || []).find((t) => t.id === m.id);
      if (tok && fogSet.has(`${tok.x},${tok.y}`)) return false;
      return true;
    })
    .map((m) => maskMonsterForRole(m, srcState, role));

  const filteredCombatants = (srcState.combat?.combatants || []).filter(
    (c) => isDm || !c.hiddenFromPlayers,
  );
  const filteredMessages = (srcState.systemMessages || []).filter(
    (m) => isDm || m.target === 'all' || !m.target || m.target === characterId,
  );
  const filteredReactions = (srcState.pendingReactions || []).filter(
    (r) => isDm || !characterId || r.targetCharacterId === characterId,
  );

  return {
    version: srcState.version,
    schemaVersion: srcState.schemaVersion,
    session: srcState.session,
    mechanics: srcState.mechanics,
    passiveGacha: { odds: PASSIVE_GACHA_ODDS, pool: PASSIVE_SKILL_POOL },
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
    bestiary: isDm ? srcState.bestiary : [],
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
          .map((t) => (!isDm && !showExactHp && t.type === 'monster' ? { ...t, hp: null, maxHp: null } : t));
        const mapped = { ...b, arena: { ...arena, tokens: arenaTokens } };
        return isDm ? mapped : { ...mapped, dmSecret: null };
      }),
    systemMessages: filteredMessages,
    combatLog: srcState.combatLog || [],
    playerHistory: srcState.playerHistory || [],
    rollLog: (srcState.rollLog || []).filter((r) => isDm || !r.isSecret),
  };
}
