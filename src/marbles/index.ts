/**
 * MarblesListener — diagram node "Marbles Listener":
 *   - registers '!play'
 *   - sets up a Game Manager (per channel, lazily)
 *   - loads configuration values (filters + vision) into the manager
 *
 * Setup happens once at startup (`init`). After that, `handlePlay` is the single
 * entry point invoked by the chat command handler for every `!play`.
 */

import type { HeuristicsManager } from '../heuristics';
import type { MarblesHeuristicsManager } from '../marblesHeuristics';
import type { Commands } from '../commands';
import type { MarblesConfig } from './types';
import { buildFilterChain } from './eventFilter';
import { GameManager } from './gameManager';
import { SessionDetector } from './sessionDetector';
import type { CaptureFn } from './sessionDetector';
import { createVisionProvider } from './vision/visionProviderFactory';

/** Sender supplied by the chat layer (e.g. ChatClient.say bound to a channel). */
export type SendFn = (msg: string) => Promise<void>;

/** Escape regex metacharacters in the (config-controlled) base command. */
function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appliesToChannel(channels: string[], channel: string): boolean {
    if (channels.length === 1 && channels[0] === '*') {
        return true;
    }
    return channels.map((c) => c.toLowerCase()).includes(channel.toLowerCase());
}

export interface MarblesListenerDeps {
    heuristics: HeuristicsManager;
    marblesHeuristics: MarblesHeuristicsManager;
    config: MarblesConfig;
    /** Capture a base64 PNG frame for a channel (FFmpegStreamCapture.captureFrame). */
    capture: CaptureFn;
}

export class MarblesListener {
    private gameManager: GameManager | null = null;

    constructor(private readonly deps: MarblesListenerDeps) {}

    /** Build the vision provider, detector, filter chain and game manager. */
    async init(): Promise<void> {
        const { heuristics, marblesHeuristics, config, capture } = this.deps;

        const provider = await createVisionProvider(config.vision);
        const detector = new SessionDetector(provider, capture);
        const chain = buildFilterChain(config.filters);

        this.gameManager = new GameManager(
            heuristics,
            marblesHeuristics,
            chain,
            detector,
            config.sendCooldownMs,
        );

        console.log(`[MarblesListener] Initialized (vision: ${detector.providerName})`);
    }

    /**
     * Register the play-command family (`!play`, `!play1`, `!play2`, …) on the
     * chat command router. The listener owns matching + routing; the actual
     * (throttled, jittered) send stays with the caller via `triggerSend`.
     */
    register(commander: Commands, triggerSend: (channel: string, send: SendFn) => void): void {
        const { command, channels } = this.deps.config.play;
        const pattern = new RegExp(`^!${escapeRegExp(command)}\\d*$`, 'i');

        commander.add(
            command,
            async (_msg: string, user: string, channel: string, send: SendFn) => {
                if (!appliesToChannel(channels, channel)) {
                    return '';
                }
                try {
                    if (await this.handlePlay(channel, user)) {
                        triggerSend(channel, send);
                    }
                } catch (err) {
                    console.error(`[${channel}] play handler error:`, err);
                }
                return '';
            },
            pattern,
        );

        console.log(`[MarblesListener] Registered play matcher ${pattern} on ${channels.join(',')}`);
    }

    /** Handle a `!play` event. Returns true if `!play` should be sent to chat. */
    async handlePlay(channel: string, user: string): Promise<boolean> {
        if (!this.gameManager) {
            throw new Error('MarblesListener.handlePlay called before init()');
        }
        return this.gameManager.handlePlay(channel, user);
    }

    shutdown(): void {
        // Heuristics managers own their own persistence; nothing channel-specific
        // to flush here. Present for symmetry with the old manager's lifecycle.
        console.log('[MarblesListener] Shutdown');
    }
}

export { GameManager } from './gameManager';
export { SessionDetector } from './sessionDetector';
export * from './types';
