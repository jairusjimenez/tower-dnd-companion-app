import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  stateFile: string;
  backupDir: string;
  dmPasscode: string;
  sessionSecret: string;
  sessionCookieName: string;
  sessionMaxAgeSec: number;
  maxBackups: number;
  clientDistDir: string;
  isProduction: boolean;
}

function loadOrCreateSessionSecret(dataDir: string): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  const secretPath = path.join(dataDir, '.session-secret');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600 });
    return generated;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
}

function findProjectRoot(startDir: string): string {
  let current = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir, '..', '..');
}

export function resolveConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const rootDir = findProjectRoot(__dirname);
  const dataDir = overrides.dataDir || process.env.DATA_DIR || path.join(rootDir, 'data');
  const stateFile = overrides.stateFile || path.join(dataDir, 'state.json');
  const backupDir = overrides.backupDir || path.join(dataDir, 'backups');
  const clientDistDir = overrides.clientDistDir || path.join(rootDir, 'dist', 'client');
  const isProduction = overrides.isProduction ?? process.env.NODE_ENV === 'production';

  return {
    port: overrides.port ?? Number(process.env.PORT || 3456),
    host: overrides.host || process.env.HOST || '0.0.0.0',
    dataDir,
    stateFile,
    backupDir,
    dmPasscode:
      overrides.dmPasscode ||
      process.env.DM_PASSCODE ||
      (isProduction ? crypto.randomBytes(24).toString('hex') : 'dm123'),
    sessionSecret: overrides.sessionSecret || loadOrCreateSessionSecret(dataDir),
    sessionCookieName: overrides.sessionCookieName || 'tower_vtt_session',
    sessionMaxAgeSec: overrides.sessionMaxAgeSec ?? 60 * 60 * 24 * 7,
    maxBackups: overrides.maxBackups ?? 10,
    clientDistDir,
    isProduction,
  };
}
