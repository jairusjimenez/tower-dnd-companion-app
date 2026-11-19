import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_STAT_MILESTONES, type GameState } from '../../../shared';
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
  if (!Array.isArray(parsed.storyBeats)) parsed.storyBeats = fresh.storyBeats;
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
