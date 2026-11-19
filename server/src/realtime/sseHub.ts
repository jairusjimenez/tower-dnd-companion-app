import type { ServerResponse } from 'node:http';
import type { GameState, ToastMessage, UserRole } from '../../../shared';
import { filterStateForRole } from '../store/filterState';

export interface SseClient {
  raw: ServerResponse;
  role: UserRole;
  characterId: string | null;
}

export class SseHub {
  private readonly clients = new Set<SseClient>();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly getState: () => GameState) {}

  startHeartbeat(intervalMs = 20000): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        try {
          client.raw.write(': heartbeat\n\n');
        } catch {
          this.clients.delete(client);
        }
      }
    }, intervalMs);
    this.heartbeatTimer.unref();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clients.clear();
  }

  addClient(client: SseClient): () => void {
    this.clients.add(client);
    const snapshot = filterStateForRole(this.getState(), client.role, client.characterId);
    try {
      client.raw.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
    } catch {
      this.clients.delete(client);
    }
    return () => {
      this.clients.delete(client);
    };
  }

  broadcast(eventName: 'state' | 'toast' = 'state', extraPayload: ToastMessage | null = null): void {
    const state = this.getState();
    for (const client of this.clients) {
      try {
        if (
          eventName === 'toast'
          && client.role !== 'dm'
          && extraPayload?.target
          && extraPayload.target !== 'all'
          && extraPayload.target !== client.characterId
        ) {
          continue;
        }
        const data = eventName === 'state'
          ? filterStateForRole(state, client.role, client.characterId)
          : extraPayload;
        client.raw.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
