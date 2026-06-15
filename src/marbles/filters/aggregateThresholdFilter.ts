/**
 * Aggregate-threshold filter — diagram nodes "aggregate - events seen within
 * timeframe" -> "do not continue if we don't meet aggregate threshold".
 *
 * Requires a minimum number of `!play` events within a recent window before the
 * chain may continue. Reuses the play-event history already tracked by
 * MarblesHeuristicsManager (every event is recorded by the Game Manager before
 * the chain runs).
 */

import type { MarblesFilter, FilterContext, FilterOutcome } from './filter';
import { cont, drop } from './filter';
import type { AggregateThresholdFilterConfig } from '../types';

export class AggregateThresholdFilter implements MarblesFilter {
    readonly name = 'aggregateThreshold';
    enabled: boolean;
    private readonly windowMs: number;
    private readonly threshold: number;

    constructor(config: AggregateThresholdFilterConfig) {
        this.enabled = config.enabled;
        this.windowMs = config.windowMs;
        this.threshold = config.threshold;
    }

    evaluate(ctx: FilterContext): FilterOutcome {
        const state = ctx.marblesHeuristics.getOrCreateState(ctx.channel, ctx.baseHeuristics);
        const windowStart = ctx.now - this.windowMs;
        const count = state.playEvents.filter((e) => e.timestamp >= windowStart).length;

        if (count < this.threshold) {
            return drop(
                `Aggregate below threshold (${count}/${this.threshold} events in ${this.windowMs}ms)`,
            );
        }
        return cont(`Aggregate threshold met (${count}/${this.threshold} events)`);
    }
}
