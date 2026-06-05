export type TriggerType = '!play' | 'activity_burst';

export interface TriggerConfig {
  type: TriggerType;
  cooldownMs: number;
  threshold?: number;
}

export interface TriggerState {
  lastTriggerTime: number;
  triggerCount: number;
  isActive: boolean;
  consecutiveNoTriggerCount: number;
}

export class TriggerManager {
  private triggers: Map<string, TriggerConfig[]> = new Map();
  private states: Map<string, TriggerState> = new Map();
  private readonly INACTIVITY_TIMEOUT = 300000; // 5 minutes of no triggers = stop capturing
  private readonly CHECK_INTERVAL = 30000; // Check every 30 seconds
  private checkIntervalId: NodeJS.Timeout | null = null;
  private onTriggerCallback: ((channel: string) => void) | null = null;
  private onInactivityCallback: ((channel: string) => void) | null = null;

  constructor() {}

  registerChannel(channel: string, configs: TriggerConfig[]): void {
    this.triggers.set(channel, configs);
    this.states.set(channel, {
      lastTriggerTime: 0,
      triggerCount: 0,
      isActive: false,
      consecutiveNoTriggerCount: 0,
    });
    console.log(`[TriggerManager] Registered ${configs.length} triggers for ${channel}`);
  }

  setCallbacks(
    onTrigger: (channel: string) => void,
    onInactivity: (channel: string) => void
  ): void {
    this.onTriggerCallback = onTrigger;
    this.onInactivityCallback = onInactivity;
  }

  startMonitoring(): void {
    if (this.checkIntervalId) {
      return;
    }

    this.checkIntervalId = setInterval(() => {
      this.checkInactivity();
    }, this.CHECK_INTERVAL);

    console.log('[TriggerManager] Started monitoring for triggers');
  }

  stopMonitoring(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      console.log('[TriggerManager] Stopped monitoring');
    }
  }

  private checkInactivity(): void {
    const now = Date.now();

    for (const [channel, state] of this.states) {
      if (!state.isActive) {
        continue;
      }

      const timeSinceLastTrigger = now - state.lastTriggerTime;

      if (timeSinceLastTrigger > this.INACTIVITY_TIMEOUT) {
        state.isActive = false;
        state.consecutiveNoTriggerCount = 0;
        console.log(`[TriggerManager] ${channel}: Inactivity timeout reached (${Math.round(timeSinceLastTrigger / 1000)}s), stopping captures`);
        
        if (this.onInactivityCallback) {
          this.onInactivityCallback(channel);
        }
      } else {
        console.log(`[TriggerManager] ${channel}: Still active, ${Math.round((this.INACTIVITY_TIMEOUT - timeSinceLastTrigger) / 1000)}s until timeout`);
      }
    }
  }

  recordTrigger(channel: string, triggerType: TriggerType): boolean {
    const state = this.states.get(channel);
    const configs = this.triggers.get(channel);

    if (!state || !configs) {
      return false;
    }

    const config = configs.find(c => c.type === triggerType);
    if (!config) {
      return false;
    }

    const now = Date.now();
    const timeSinceLastTrigger = now - state.lastTriggerTime;

    // Check cooldown
    if (timeSinceLastTrigger < config.cooldownMs) {
      console.log(`[TriggerManager] ${channel}: Trigger ${triggerType} ignored (cooldown: ${Math.round((config.cooldownMs - timeSinceLastTrigger) / 1000)}s remaining)`);
      return false;
    }

    // Valid trigger
    state.lastTriggerTime = now;
    state.triggerCount++;
    state.consecutiveNoTriggerCount = 0;

    const wasInactive = !state.isActive;
    state.isActive = true;

    console.log(`[TriggerManager] ${channel}: Trigger ${triggerType} activated (total: ${state.triggerCount})`);

    if (wasInactive && this.onTriggerCallback) {
      this.onTriggerCallback(channel);
    }

    return true;
  }

  recordActivity(channel: string): void {
    const state = this.states.get(channel);
    if (!state) return;

    // Check for activity burst trigger
    const configs = this.triggers.get(channel);
    const burstConfig = configs?.find(c => c.type === 'activity_burst');

    if (burstConfig && burstConfig.threshold) {
      // This would be called from the chat message handler
      // Implementation depends on how we track activity bursts
    }
  }

  isActive(channel: string): boolean {
    const state = this.states.get(channel);
    return state?.isActive || false;
  }

  getState(channel: string): TriggerState | undefined {
    return this.states.get(channel);
  }

  getAllStates(): Map<string, TriggerState> {
    return this.states;
  }

  resetChannel(channel: string): void {
    const state = this.states.get(channel);
    if (state) {
      state.isActive = false;
      state.lastTriggerTime = 0;
      state.consecutiveNoTriggerCount = 0;
      console.log(`[TriggerManager] ${channel}: State reset`);
    }
  }
}