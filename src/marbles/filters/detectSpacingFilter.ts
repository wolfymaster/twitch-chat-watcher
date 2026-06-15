/**
 * Detect-spacing filter — diagram nodes "time since last detect attempt" ->
 * "too soon, we should abort so as to reduce model costs" -> "Detect Marbles
 * Session".
 *
 * Reached only on the cold path. If we ran a vision detection too recently, drop
 * the event to avoid burning model calls; otherwise request detection and stamp
 * `lastDetectAttemptAt` (so spacing holds even if detection itself fails).
 */

import type { MarblesFilter, FilterContext, FilterOutcome } from './filter';
import { drop, detect } from './filter';
import type { DetectSpacingFilterConfig } from '../types';

export class DetectSpacingFilter implements MarblesFilter {
    readonly name = 'detectSpacing';
    enabled: boolean;
    private readonly spacingMs: number;

    constructor(config: DetectSpacingFilterConfig) {
        this.enabled = config.enabled;
        this.spacingMs = config.spacingMs;
    }

    evaluate(ctx: FilterContext): FilterOutcome {
        const last = ctx.state.lastDetectAttemptAt;
        if (last !== null) {
            const elapsed = ctx.now - last;
            if (elapsed < this.spacingMs) {
                return drop(`Detect too soon (${elapsed}ms < ${this.spacingMs}ms) — abort to reduce model cost`);
            }
        }
        ctx.state.lastDetectAttemptAt = ctx.now;
        return detect('Spacing satisfied — run vision detection');
    }
}
