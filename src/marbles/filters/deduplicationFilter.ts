/**
 * Deduplication filter — diagram node "time since last event".
 *
 * Drops events that arrive too soon after the previously *accepted* event, so a
 * burst of near-simultaneous `!play`s collapses to one pass through the chain.
 * Stamps `lastEventAt` only when it lets an event through, keeping the filter
 * self-contained (nothing else reads `lastEventAt`).
 */

import type { MarblesFilter, FilterContext, FilterOutcome } from './filter';
import { cont, drop } from './filter';
import type { DeduplicationFilterConfig } from '../types';

export class DeduplicationFilter implements MarblesFilter {
    readonly name = 'deduplication';
    enabled: boolean;
    private readonly windowMs: number;

    constructor(config: DeduplicationFilterConfig) {
        this.enabled = config.enabled;
        this.windowMs = config.windowMs;
    }

    evaluate(ctx: FilterContext): FilterOutcome {
        const last = ctx.state.lastEventAt;
        if (last !== null) {
            const elapsed = ctx.now - last;
            if (elapsed < this.windowMs) {
                return drop(`Duplicate within ${this.windowMs}ms (last event ${elapsed}ms ago)`);
            }
        }
        ctx.state.lastEventAt = ctx.now;
        return cont('Event accepted (outside dedup window)');
    }
}
