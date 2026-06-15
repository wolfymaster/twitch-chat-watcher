/**
 * Temperature filter — diagram node "time since last game played" with its
 * hot / warm / cold branches.
 *
 *   age = now - lastGamePlayedAt   (Infinity if never)
 *   - hot  (age < hotCutoff)   => too soon, wait for another event  -> drop
 *   - warm (age < warmCutoff)  => assume session still active        -> bypass-ready
 *   - cold (age >= warmCutoff) => long time / never                  -> continue (to detection)
 *
 * Heuristics drive the warm cutoff: once the base HeuristicsManager has a
 * confident `avgTimeBetweenGamesMs`, that learned cadence is used as the warm
 * boundary (a game seen within roughly one cycle implies the session is still
 * live). The static config value is the fallback when confidence is low.
 */

import type { MarblesFilter, FilterContext, FilterOutcome } from './filter';
import { cont, drop, bypassReady } from './filter';
import type { TemperatureFilterConfig } from '../types';

/** Minimum prediction confidence before we trust the learned cadence. */
const DYNAMIC_CUTOFF_MIN_CONFIDENCE = 0.5;

export class TemperatureFilter implements MarblesFilter {
    readonly name = 'temperature';
    enabled: boolean;
    private readonly hotCutoffMs: number;
    private readonly warmCutoffMs: number;

    constructor(config: TemperatureFilterConfig) {
        this.enabled = config.enabled;
        this.hotCutoffMs = config.hotCutoffMs;
        this.warmCutoffMs = config.warmCutoffMs;
    }

    private effectiveWarmCutoff(ctx: FilterContext): number {
        const h = ctx.heuristics.getOrCreateHeuristics(ctx.channel);
        if (h.timePredictionConfidence >= DYNAMIC_CUTOFF_MIN_CONFIDENCE && h.avgTimeBetweenGamesMs > 0) {
            return Math.max(this.warmCutoffMs, h.avgTimeBetweenGamesMs);
        }
        return this.warmCutoffMs;
    }

    evaluate(ctx: FilterContext): FilterOutcome {
        const last = ctx.state.lastGamePlayedAt;
        const age = last === null ? Infinity : ctx.now - last;
        const warmCutoff = this.effectiveWarmCutoff(ctx);

        if (age < this.hotCutoffMs) {
            return drop(`Hot: only ${age}ms since last game (< ${this.hotCutoffMs}ms)`);
        }
        if (age < warmCutoff) {
            return bypassReady(`Warm: ${age}ms since last game (< ${warmCutoff}ms) — assume session active`);
        }
        return cont(
            last === null
                ? 'Cold: no game played yet'
                : `Cold: ${age}ms since last game (>= ${warmCutoff}ms)`,
        );
    }
}
