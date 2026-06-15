/**
 * Rate-trend filter — optional statistical gate carried over from the old
 * decision engine. Requires the `!play` rate trend to be `increasing` or
 * `stable` (i.e. not `decreasing`) before the chain may continue.
 *
 * Disabled by default; toggle via config. Reuses
 * MarblesHeuristicsManager.getRateTrend.
 */

import type { MarblesFilter, FilterContext, FilterOutcome } from './filter';
import { cont, drop } from './filter';
import type { RateTrendFilterConfig } from '../types';

export class RateTrendFilter implements MarblesFilter {
    readonly name = 'rateTrend';
    enabled: boolean;

    constructor(config: RateTrendFilterConfig) {
        this.enabled = config.enabled;
    }

    evaluate(ctx: FilterContext): FilterOutcome {
        ctx.marblesHeuristics.calculateCurrentRate(ctx.channel, ctx.baseHeuristics);
        const trend = ctx.marblesHeuristics.getRateTrend(ctx.channel, ctx.baseHeuristics);
        return trend === 'decreasing'
            ? drop('Rate trend decreasing')
            : cont(`Rate trend ${trend}`);
    }
}
