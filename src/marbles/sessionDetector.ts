/**
 * DetectMarblesSession — the orange subroutine on the diagram.
 *
 *   Get Screenshot of stream -> Identify objects -> (game present?) ->
 *   evidence (play/countdown/timer) -> Determine state -> Session
 *
 * Here it is thin orchestration: capture a frame (reusing FFmpegStreamCapture),
 * hand it to the configured VisionProvider, and return the `Session`. A short
 * screenshot cache avoids duplicate captures within a burst.
 */

import type { Session } from './types';
import type { VisionProvider } from './vision/visionProvider';
import { MARBLES_CONFIG } from '../marblesConfig';

export type CaptureFn = (channel: string) => Promise<string>;

interface CacheEntry {
    session: Session;
    timestamp: number;
}

export class SessionDetector {
    private cache: Map<string, CacheEntry> = new Map();

    constructor(
        private readonly provider: VisionProvider,
        private readonly capture: CaptureFn,
        private readonly cacheDurationMs: number = MARBLES_CONFIG.SCREENSHOT_CACHE_DURATION_MS,
    ) {}

    /** Provider name, for logging/diagnostics. */
    get providerName(): string {
        return this.provider.name;
    }

    async detect(channel: string, now: number = Date.now()): Promise<Session> {
        const cached = this.cache.get(channel);
        if (cached && now - cached.timestamp <= this.cacheDurationMs) {
            console.log(`[${channel}] [detect] Using cached session (${now - cached.timestamp}ms old)`);
            return cached.session;
        }

        const base64 = await this.capture(channel);
        if (!base64 || base64.length < 100) {
            console.warn(`[${channel}] [detect] Capture returned no frame — stopped session`);
            const session: Session = {
                state: 'stopped',
                evidence: { play_present: false, countdown_present: false, time_present: false },
                game_location: 'fullscreen',
            };
            this.cache.set(channel, { session, timestamp: now });
            return session;
        }

        const session = await this.provider.detectSession(base64, channel);
        this.cache.set(channel, { session, timestamp: now });
        return session;
    }
}
