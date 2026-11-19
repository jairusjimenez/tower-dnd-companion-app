import type { ServerConfig } from '../config';
import type { SseHub } from '../realtime/sseHub';
import type { StateRepository } from '../store/repository';
import type { GameState, UserRole } from '../../../shared';

export interface ServerContext {
  config: ServerConfig;
  repo: StateRepository;
  sseHub: SseHub;
}

export interface ActionRequestContext extends ServerContext {
  role: UserRole;
  characterId: string | null;
  state: GameState;
}

export interface ActionResult {
  ok?: boolean;
  status?: number;
  error?: string;
  [key: string]: unknown;
}
