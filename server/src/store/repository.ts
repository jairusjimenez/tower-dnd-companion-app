import type { GameState } from '../../../shared';

export interface StateRepository {
  getState(): GameState;
  save(state?: GameState): void;
  reset(): GameState;
}
