/**
 * Filter pattern for the diagram's `event filter` stage.
 *
 * Every gate in the event filter — and every statistical heuristic carried over
 * from the old decision engine — is a `MarblesFilter`. Filters are registered in
 * an ordered chain and can be toggled on/off via config, so new gates can be
 * added (or removed) without touching the chain logic.
 *
 * Each filter returns a `FilterOutcome`:
 *   - continue:     pass to the next filter
 *   - drop:         halt the chain, do nothing
 *   - bypass-ready: halt the chain, treat session as ready and send (skip vision)
 *   - detect:       halt the chain, run DetectMarblesSession (vision)
 *
 * If the chain runs to the end without a terminal `detect`/`bypass-ready`, the
 * default resolution is `drop` (nothing positively asked us to act).
 *
 * Filters are synchronous; the (async) vision call happens AFTER the chain
 * resolves, in the Game Manager. Filters may stamp their own timestamp fields on
 * `ctx.state` (e.g. dedup updates `lastEventAt`) so each filter stays
 * self-contained and independently removable.
 */

import type { HeuristicsManager, ChannelHeuristics } from '../../heuristics';
import type { MarblesHeuristicsManager } from '../../marblesHeuristics';
import type { GameManagerState } from '../types';

export type FilterAction = 'continue' | 'drop' | 'bypass-ready' | 'detect';

export interface FilterOutcome {
    action: FilterAction;
    /** Human-readable explanation, surfaced in logs. */
    reason: string;
}

export interface FilterContext {
    channel: string;
    user: string;
    now: number;
    /** Mutable per-channel state; filters may stamp their own timestamps. */
    state: GameManagerState;
    /** Base timing/player heuristics (drives dynamic thresholds). */
    heuristics: HeuristicsManager;
    /** Per-channel base heuristics record for the marbles managers' APIs. */
    baseHeuristics: ChannelHeuristics;
    /** !play event + rate/user tracking. */
    marblesHeuristics: MarblesHeuristicsManager;
}

export interface MarblesFilter {
    /** Stable identifier, used in logs and config. */
    readonly name: string;
    /** Whether this filter participates in the chain. */
    enabled: boolean;
    evaluate(ctx: FilterContext): FilterOutcome;
}

/** Convenience constructors for outcomes. */
export const cont = (reason: string): FilterOutcome => ({ action: 'continue', reason });
export const drop = (reason: string): FilterOutcome => ({ action: 'drop', reason });
export const bypassReady = (reason: string): FilterOutcome => ({ action: 'bypass-ready', reason });
export const detect = (reason: string): FilterOutcome => ({ action: 'detect', reason });

export interface ChainResolution {
    action: Exclude<FilterAction, 'continue'>;
    reason: string;
    /** Name of the filter that produced the terminal outcome (or 'chain-end'). */
    by: string;
}

/**
 * An ordered set of filters. Runs enabled filters in order, returning the first
 * non-`continue` outcome. Disabled filters are skipped entirely.
 */
export class FilterChain {
    constructor(private readonly filters: MarblesFilter[]) {}

    /** The enabled filters, in order. */
    get active(): MarblesFilter[] {
        return this.filters.filter((f) => f.enabled);
    }

    run(ctx: FilterContext): ChainResolution {
        for (const filter of this.active) {
            const outcome = filter.evaluate(ctx);
            if (outcome.action !== 'continue') {
                return { action: outcome.action, reason: outcome.reason, by: filter.name };
            }
        }
        return {
            action: 'drop',
            reason: 'No filter asked to act (chain ran to end)',
            by: 'chain-end',
        };
    }
}
