/**
 * P90 filter — optional statistical gate carried over from the old decision
 * engine. Requires the current `!play` rate to be at/above the P90 threshold of
 * the channel's historical rate before the chain may continue.
 *
 * Disabled by default; toggle via config. Reuses
 * MarblesHeuristicsManager.isAtP90Threshold (the same math the old
 * MarblesDecisionEngine used).
 */

import type { MarblesFilter, FilterContext, FilterOutcome } from './filter';
import { cont, drop } from './filter';
import type { P90FilterConfig } from '../types';

export class P90Filter implements MarblesFilter {
    readonly name = 'p90';
    enabled: boolean;

    constructor(config: P90FilterConfig) {
        this.enabled = config.enabled;
    }

    evaluate(ctx: FilterContext): FilterOutcome {
        // Refresh the rate so the P90 comparison uses a current value.
        ctx.marblesHeuristics.calculateCurrentRate(ctx.channel, ctx.baseHeuristics);
        const atP90 = ctx.marblesHeuristics.isAtP90Threshold(ctx.channel, ctx.baseHeuristics);
        return atP90
            ? cont('Rate at/above P90 threshold')
            : drop('Rate below P90 threshold');
    }
}
