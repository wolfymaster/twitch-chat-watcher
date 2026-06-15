/**
 * Frequent-users filter — optional statistical gate carried over from the old
 * decision engine. Requires a minimum number of *active* frequent users (users
 * with >= FREQUENT_USER_MIN_PLAYS who also played in the current rate window)
 * before the chain may continue.
 *
 * Disabled by default; toggle via config. Reuses
 * MarblesHeuristicsManager.getActiveFrequentUserCount.
 */

import type { MarblesFilter, FilterContext, FilterOutcome } from './filter';
import { cont, drop } from './filter';
import type { FrequentUsersFilterConfig } from '../types';

export class FrequentUsersFilter implements MarblesFilter {
    readonly name = 'frequentUsers';
    enabled: boolean;
    private readonly minActive: number;

    constructor(config: FrequentUsersFilterConfig) {
        this.enabled = config.enabled;
        this.minActive = config.minActive;
    }

    evaluate(ctx: FilterContext): FilterOutcome {
        const active = ctx.marblesHeuristics.getActiveFrequentUserCount(ctx.channel, ctx.baseHeuristics);
        return active >= this.minActive
            ? cont(`${active} active frequent users (>= ${this.minActive})`)
            : drop(`Only ${active} active frequent users (< ${this.minActive})`);
    }
}
