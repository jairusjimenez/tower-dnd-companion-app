import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_STAT_MILESTONES,
  getDefaultSkillsForMonster,
  inferDefaultAttackAreaForMonster,
  scaleMonsterSkillForFloor,
  type GameState,
} from '../../../shared';
import { getInitialState } from './initialState';
import type { StateRepository } from './repository';

export function migrateGameState(raw: unknown): GameState {
  const fresh = getInitialState();
  if (!raw || typeof raw !== 'object') return fresh;
  const parsed = raw as Partial<GameState>;
  if (!parsed.characters || !parsed.map || !parsed.deities || !parsed.grimoire) {
    return fresh;
  }

  if (
    parsed.mechanics
    && (!Array.isArray(parsed.mechanics.statMilestones)
      || parsed.mechanics.statMilestones.length === 0
      || ((!parsed.schemaVersion || parsed.schemaVersion < 2) && parsed.mechanics.statMilestones.length <= 6))
  ) {
    parsed.mechanics.statMilestones = DEFAULT_STAT_MILESTONES.map((m) => ({ ...m }));
  }
  if (!Array.isArray(parsed.playerHistory)) parsed.playerHistory = [];
  if (!Array.isArray(parsed.rollLog)) parsed.rollLog = [];
  if (!Array.isArray(parsed.combatLog)) parsed.combatLog = [];
  if (!Array.isArray(parsed.systemMessages)) parsed.systemMessages = [];
  if (!Array.isArray(parsed.pendingReactions)) parsed.pendingReactions = [];
  if (!Array.isArray(parsed.recentMonsterDefeats)) parsed.recentMonsterDefeats = [];
  if (!Array.isArray(parsed.storyBeats)) {
    parsed.storyBeats = fresh.storyBeats;
  } else {
    // Deduplicate excess monster tokens that were spawned beyond attached encounter counts
    const removedMonsterIds = new Set<string>();
    for (const beat of parsed.storyBeats) {
      if (!beat?.arena?.tokens || !Array.isArray(beat.encounters)) continue;
      const allowedCounts = new Map<string, number>();
      for (const enc of beat.encounters) {
        const key = String(enc.name || '').trim().toLowerCase();
        allowedCounts.set(key, (allowedCounts.get(key) || 0) + 1);
      }
      const seenCounts = new Map<string, number>();
      beat.arena.tokens = beat.arena.tokens.filter((tok) => {
        if (tok.type !== 'monster') return true;
        const key = String(tok.name || '').trim().toLowerCase();
        if (!allowedCounts.has(key)) return true; // Keep manually added non-attached monsters
        const allowed = allowedCounts.get(key) || 0;
        const seen = seenCounts.get(key) || 0;
        if (seen < allowed) {
          seenCounts.set(key, seen + 1);
          return true;
        }
        removedMonsterIds.add(tok.id);
        return false;
      });
    }
    if (removedMonsterIds.size > 0) {
      if (Array.isArray(parsed.monsters)) {
        parsed.monsters = parsed.monsters.filter((m) => !removedMonsterIds.has(m.id));
      }
      if (parsed.combat && Array.isArray(parsed.combat.combatants)) {
        parsed.combat.combatants = parsed.combat.combatants.filter((c) => !removedMonsterIds.has(c.id));
      }
    }
  }
  if (!Array.isArray(parsed.npcRoster)) {
    parsed.npcRoster = fresh.npcRoster;
  } else {
    const existingNpcIds = new Set(parsed.npcRoster.map((n) => n.id));
    for (const def of fresh.npcRoster || []) {
      if (!existingNpcIds.has(def.id)) parsed.npcRoster.push({ ...def });
    }
  }
  if (!Array.isArray(parsed.treasureCatalog)) {
    parsed.treasureCatalog = fresh.treasureCatalog;
  } else {
    const existingTrIds = new Set(parsed.treasureCatalog.map((t) => t.id));
    for (const def of fresh.treasureCatalog || []) {
      if (!existingTrIds.has(def.id)) parsed.treasureCatalog.push({ ...def });
    }
  }
  if (!parsed.chestCatalog || typeof parsed.chestCatalog !== 'object') {
    parsed.chestCatalog = fresh.chestCatalog;
  } else if (fresh.chestCatalog) {
    for (const [tier, cfg] of Object.entries(fresh.chestCatalog)) {
      if (!parsed.chestCatalog[tier as keyof typeof parsed.chestCatalog]) {
        parsed.chestCatalog[tier as keyof typeof parsed.chestCatalog] = JSON.parse(JSON.stringify(cfg));
      }
    }
  }
  if (!Array.isArray(parsed.bestiary)) {
    parsed.bestiary = fresh.bestiary;
  } else {
    const freshById = new Map(fresh.bestiary.map((b) => [b.id, b]));
    parsed.bestiary = parsed.bestiary.map((b) => {
      const def = freshById.get(b.id);
      if (!def) return b;
      return {
        ...b,
        category: b.category || def.category,
        notes: b.notes || def.notes,
        lootTable: b.lootTable && b.lootTable.length > 0 ? b.lootTable : def.lootTable,
      };
    });
    const existingIds = new Set(parsed.bestiary.map((b) => b.id));
    for (const def of fresh.bestiary) {
      if (!existingIds.has(def.id)) parsed.bestiary.push({ ...def });
    }
    parsed.bestiary = parsed.bestiary.map((b) => ({
      ...b,
      attackArea: inferDefaultAttackAreaForMonster(b),
      skills: b.skills && b.skills.length > 0 ? b.skills : getDefaultSkillsForMonster(b),
    }));
  }
  if (Array.isArray(parsed.monsters)) {
    for (const m of parsed.monsters) {
      if (!m.attackArea) {
        const cleanBase = String(m.name || '').replace(/\s*#\d+$/, '').trim().toLowerCase();
        const matchedBest = (parsed.bestiary || []).find((b) => b.name.trim().toLowerCase() === cleanBase);
        m.attackArea = inferDefaultAttackAreaForMonster({
          name: m.name,
          maxHp: m.maxHp,
          rangeSpaces: m.rangeSpaces,
          category: matchedBest?.category,
          attackArea: matchedBest?.attackArea,
        });
      }
      if (!Array.isArray(m.skills) || m.skills.length === 0) {
        const cleanBase = String(m.name || '').replace(/\s*#\d+$/, '').trim().toLowerCase();
        const matchedBest = (parsed.bestiary || []).find((b) => b.name.trim().toLowerCase() === cleanBase);
        m.skills = getDefaultSkillsForMonster(matchedBest || { name: m.name, maxHp: m.maxHp || 30 })
          .map((s) => scaleMonsterSkillForFloor(s, m.floor || 1))
          .filter((s) => s.unlocked)
          .map(({ unlocked: _u, attackFormula: _af, ...rest }) => ({
            ...rest,
            usesRemaining: rest.maxUsesPerCombat,
          }));
      }
    }
  }
  if (!parsed.playerAccounts || typeof parsed.playerAccounts !== 'object') parsed.playerAccounts = {};
  if (!parsed.dmAccount) {
    parsed.dmAccount = {
      email: 'jairusjimenez@live.com',
      username: '',
      activated: false,
      salt: null,
      passwordHash: null,
    };
  }
  parsed.schemaVersion = 2;
  return parsed as GameState;
}

export class JsonStateRepository implements StateRepository {
  private state: GameState;
  private writesSinceBackup = 0;

  constructor(
    private readonly dataDir: string,
    private readonly stateFile: string,
    private readonly backupDir: string,
    private readonly maxBackups = 10,
  ) {
    this.state = this.loadFromDisk();
  }

  private loadFromDisk(): GameState {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (fs.existsSync(this.stateFile)) {
        const raw = fs.readFileSync(this.stateFile, 'utf8');
        return migrateGameState(JSON.parse(raw));
      }
    } catch {
      // Attempt latest backup recovery if state.json was corrupted
      try {
        if (fs.existsSync(this.backupDir)) {
          const backups = fs
            .readdirSync(this.backupDir)
            .filter((f) => f.endsWith('.json'))
            .sort()
            .reverse();
          for (const file of backups) {
            try {
              const raw = fs.readFileSync(path.join(this.backupDir, file), 'utf8');
              return migrateGameState(JSON.parse(raw));
            } catch {
              continue;
            }
          }
        }
      } catch {
        // Fall back to fresh state
      }
    }
    return getInitialState();
  }

  getState(): GameState {
    return this.state;
  }

  reset(): GameState {
    this.createBackupIfExists();
    this.state = getInitialState();
    this.save(this.state);
    return this.state;
  }

  save(nextState?: GameState): void {
    if (nextState) this.state = nextState;
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const payload = JSON.stringify(this.state, null, 2);
      const tmpFile = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpFile, payload, 'utf8');
      try {
        fs.renameSync(tmpFile, this.stateFile);
      } catch {
        fs.writeFileSync(this.stateFile, payload, 'utf8');
        try {
          if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        } catch {
          // Ignore temp cleanup error
        }
      }
      this.writesSinceBackup++;
      if (this.writesSinceBackup >= 25) {
        this.writesSinceBackup = 0;
        this.createBackupIfExists();
      }
    } catch {
      // Continue operating in-memory if storage is read-only
    }
  }

  createBackupIfExists(): string | null {
    try {
      if (!fs.existsSync(this.stateFile)) return null;
      fs.mkdirSync(this.backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `state-${stamp}-${process.pid}.json`);
      fs.copyFileSync(this.stateFile, backupFile);

      const files = fs
        .readdirSync(this.backupDir)
        .filter((f) => f.endsWith('.json'))
        .sort();
      while (files.length > this.maxBackups) {
        const oldest = files.shift();
        if (oldest) {
          try {
            fs.unlinkSync(path.join(this.backupDir, oldest));
          } catch {
            // Ignore unlink errors on locked files
          }
        }
      }
      return backupFile;
    } catch {
      return null;
    }
  }
}
