/**
 * Builds the ordered `event filter` chain from config.
 *
 * Order matters and mirrors the diagram's left-to-right flow:
 *   1. deduplication      — drop near-duplicate events
 *   2. aggregateThreshold — require enough events in the window
 *   3. [heuristic gates]   — p90 / rateTrend / frequentUsers (off by default)
 *   4. temperature        — hot=drop, warm=bypass-ready, cold=continue
 *   5. detectSpacing      — cold path: space out vision calls, else detect
 *
 * The heuristic gates sit before `temperature` so that, when enabled, they can
 * veto cheaply before any warm/cold branching. Adding a new filter is just:
 * implement MarblesFilter, add its config, and insert it here.
 */

import { FilterChain } from './filters/filter';
import type { MarblesFilter } from './filters/filter';
import { DeduplicationFilter } from './filters/deduplicationFilter';
import { AggregateThresholdFilter } from './filters/aggregateThresholdFilter';
import { TemperatureFilter } from './filters/temperatureFilter';
import { DetectSpacingFilter } from './filters/detectSpacingFilter';
import { P90Filter } from './filters/p90Filter';
import { FrequentUsersFilter } from './filters/frequentUsersFilter';
import { RateTrendFilter } from './filters/rateTrendFilter';
import type { MarblesFiltersConfig } from './types';

export function buildFilterChain(config: MarblesFiltersConfig): FilterChain {
    const filters: MarblesFilter[] = [
        new DeduplicationFilter(config.deduplication),
        new AggregateThresholdFilter(config.aggregateThreshold),
        new P90Filter(config.p90),
        new RateTrendFilter(config.rateTrend),
        new FrequentUsersFilter(config.frequentUsers),
        new TemperatureFilter(config.temperature),
        new DetectSpacingFilter(config.detectSpacing),
    ];

    const active = filters.filter((f) => f.enabled).map((f) => f.name);
    console.log(`[EventFilter] Active filters (in order): ${active.join(' -> ') || '(none)'}`);

    return new FilterChain(filters);
}
