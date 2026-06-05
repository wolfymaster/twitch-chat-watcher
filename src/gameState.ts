export type GameState = 'idle' | 'playing' | 'ended';

export interface ChannelGameState {
  channelId: string;
  currentState: GameState;
  lastActivityTimestamp: number;
  lastScreenshotTimestamp: number;
  lastPlayCommandTimestamp: number;
  consecutiveGamesCount: number;
  inGameDetectionCount: number;
}

export class GameStateManager {
  private channelStates: Map<string, ChannelGameState> = new Map();

  constructor() {}

  getOrCreateChannelState(channelId: string): ChannelGameState {
    if (!this.channelStates.has(channelId)) {
      const initialState: ChannelGameState = {
        channelId: channelId,
        currentState: 'idle',
        lastActivityTimestamp: Date.now(),
        lastScreenshotTimestamp: 0,
        lastPlayCommandTimestamp: 0,
        consecutiveGamesCount: 0,
        inGameDetectionCount: 0
      };
      this.channelStates.set(channelId, initialState);
      return initialState;
    }
    return this.channelStates.get(channelId)!;
  }

  updateState(channelId: string, newState: GameState): void {
    const state = this.getOrCreateChannelState(channelId);
    state.currentState = newState;
    state.lastActivityTimestamp = Date.now();
  }

  recordPlayCommand(channelId: string): void {
    const state = this.getOrCreateChannelState(channelId);
    state.lastPlayCommandTimestamp = Date.now();
  }

  recordScreenshot(channelId: string): void {
    const state = this.getOrCreateChannelState(channelId);
    state.lastScreenshotTimestamp = Date.now();
  }

  incrementGameCount(channelId: string): void {
    const state = this.getOrCreateChannelState(channelId);
    state.consecutiveGamesCount++;
  }

  resetGameCount(channelId: string): void {
    const state = this.getOrCreateChannelState(channelId);
    state.consecutiveGamesCount = 0;
  }

  shouldTakeScreenshot(channelId: string, activityThreshold: number = 30000): boolean {
    const state = this.getOrCreateChannelState(channelId);
    const now = Date.now();
    return (now - state.lastActivityTimestamp) > activityThreshold;
  }

  isInCooldownPeriod(channelId: string, cooldownMs: number = 180000): boolean {
    const state = this.getOrCreateChannelState(channelId);
    const now = Date.now();
    return (now - state.lastPlayCommandTimestamp) < cooldownMs;
  }
}