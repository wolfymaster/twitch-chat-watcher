/// <reference types="bun" />
/**
 * Filter-chain branch tests. Run with `bun test`.
 *
 * Each diagram filter is exercised in isolation, then the whole chain is run to
 * confirm the drop / bypass-ready / detect branches and that disabling a filter
 * removes it from the chain.
 */

import { test, expect, describe } from 'bun:test';
import type { HeuristicsManager, ChannelHeuristics } from '../../heuristics';
import type { MarblesHeuristicsManager, PlayEvent } from '../../marblesHeuristics';
import type { GameManagerState } from '../types';
import { FilterChain, type FilterContext } from './filter';
import { DeduplicationFilter } from './deduplicationFilter';
import { AggregateThresholdFilter } from './aggregateThresholdFilter';
import { TemperatureFilter } from './temperatureFilter';
import { DetectSpacingFilter } from './detectSpacingFilter';

const NOW = 1_000_000_000;

interface CtxOverrides {
    state?: Partial<GameManagerState>;
    playEvents?: PlayEvent[];
    timePredictionConfidence?: number;
    avgTimeBetweenGamesMs?: number;
    now?: number;
}

function makeCtx(o: CtxOverrides = {}): FilterContext {
    const state: GameManagerState = {
        channel: 'c',
        state: 'idle',
        lastGamePlayedAt: null,
        lastEventAt: null,
        lastDetectAttemptAt: null,
        lastMessageSentAt: null,
        ...o.state,
    };

    const heuristics = {
        getOrCreateHeuristics: () => ({
            timePredictionConfidence: o.timePredictionConfidence ?? 0,
            avgTimeBetweenGamesMs: o.avgTimeBetweenGamesMs ?? 300_000,
        }),
    } as unknown as HeuristicsManager;

    const marblesHeuristics = {
        getOrCreateState: () => ({ playEvents: o.playEvents ?? [] }),
    } as unknown as MarblesHeuristicsManager;

    return {
        channel: 'c',
        user: 'u',
        now: o.now ?? NOW,
        state,
        heuristics,
        baseHeuristics: {} as ChannelHeuristics,
        marblesHeuristics,
    };
}

function events(count: number, within: number, now: number = NOW): PlayEvent[] {
    return Array.from({ length: count }, (_, i) => ({
        timestamp: now - Math.floor((i / Math.max(count, 1)) * within),
        username: `u${i}`,
    }));
}

describe('DeduplicationFilter', () => {
    const f = new DeduplicationFilter({ enabled: true, windowMs: 2000 });

    test('drops an event inside the window', () => {
        const ctx = makeCtx({ state: { lastEventAt: NOW - 1000 } });
        expect(f.evaluate(ctx).action).toBe('drop');
    });

    test('passes an event outside the window and stamps lastEventAt', () => {
        const ctx = makeCtx({ state: { lastEventAt: NOW - 5000 } });
        expect(f.evaluate(ctx).action).toBe('continue');
        expect(ctx.state.lastEventAt).toBe(NOW);
    });

    test('passes the first-ever event', () => {
        const ctx = makeCtx();
        expect(f.evaluate(ctx).action).toBe('continue');
    });
});

describe('AggregateThresholdFilter', () => {
    const f = new AggregateThresholdFilter({ enabled: true, windowMs: 5000, threshold: 3 });

    test('drops when below threshold', () => {
        const ctx = makeCtx({ playEvents: events(2, 5000) });
        expect(f.evaluate(ctx).action).toBe('drop');
    });

    test('continues when at/above threshold', () => {
        const ctx = makeCtx({ playEvents: events(4, 5000) });
        expect(f.evaluate(ctx).action).toBe('continue');
    });

    test('ignores events outside the window', () => {
        const old: PlayEvent[] = events(5, 1000, NOW - 60_000); // all ~1 min old
        const ctx = makeCtx({ playEvents: old });
        expect(f.evaluate(ctx).action).toBe('drop');
    });
});

describe('TemperatureFilter', () => {
    const f = new TemperatureFilter({ enabled: true, hotCutoffMs: 30_000, warmCutoffMs: 180_000 });

    test('hot -> drop', () => {
        const ctx = makeCtx({ state: { lastGamePlayedAt: NOW - 10_000 } });
        expect(f.evaluate(ctx).action).toBe('drop');
    });

    test('warm -> bypass-ready', () => {
        const ctx = makeCtx({ state: { lastGamePlayedAt: NOW - 60_000 } });
        expect(f.evaluate(ctx).action).toBe('bypass-ready');
    });

    test('cold -> continue', () => {
        const ctx = makeCtx({ state: { lastGamePlayedAt: NOW - 600_000 } });
        expect(f.evaluate(ctx).action).toBe('continue');
    });

    test('never played -> continue (cold)', () => {
        const ctx = makeCtx();
        expect(f.evaluate(ctx).action).toBe('continue');
    });

    test('uses learned cadence as warm cutoff when confident', () => {
        // avg between games 10 min, confident => warm window extends to 10 min,
        // so a 6-min-old game is still warm.
        const ctx = makeCtx({
            state: { lastGamePlayedAt: NOW - 360_000 },
            timePredictionConfidence: 0.9,
            avgTimeBetweenGamesMs: 600_000,
        });
        expect(f.evaluate(ctx).action).toBe('bypass-ready');
    });
});

describe('DetectSpacingFilter', () => {
    const f = new DetectSpacingFilter({ enabled: true, spacingMs: 45_000 });

    test('drops when detected too recently', () => {
        const ctx = makeCtx({ state: { lastDetectAttemptAt: NOW - 10_000 } });
        expect(f.evaluate(ctx).action).toBe('drop');
    });

    test('detects when spacing satisfied and stamps lastDetectAttemptAt', () => {
        const ctx = makeCtx({ state: { lastDetectAttemptAt: NOW - 60_000 } });
        expect(f.evaluate(ctx).action).toBe('detect');
        expect(ctx.state.lastDetectAttemptAt).toBe(NOW);
    });

    test('detects on the first attempt', () => {
        const ctx = makeCtx();
        expect(f.evaluate(ctx).action).toBe('detect');
    });
});

describe('FilterChain end-to-end', () => {
    function chain() {
        return new FilterChain([
            new DeduplicationFilter({ enabled: true, windowMs: 2000 }),
            new AggregateThresholdFilter({ enabled: true, windowMs: 5000, threshold: 3 }),
            new TemperatureFilter({ enabled: true, hotCutoffMs: 30_000, warmCutoffMs: 180_000 }),
            new DetectSpacingFilter({ enabled: true, spacingMs: 45_000 }),
        ]);
    }

    test('cold + enough events + spaced => detect', () => {
        const ctx = makeCtx({
            playEvents: events(5, 5000),
            state: { lastEventAt: NOW - 5000, lastGamePlayedAt: NOW - 600_000 },
        });
        const res = chain().run(ctx);
        expect(res.action).toBe('detect');
        expect(res.by).toBe('detectSpacing');
    });

    test('warm => bypass-ready (no detection)', () => {
        const ctx = makeCtx({
            playEvents: events(5, 5000),
            state: { lastEventAt: NOW - 5000, lastGamePlayedAt: NOW - 60_000 },
        });
        const res = chain().run(ctx);
        expect(res.action).toBe('bypass-ready');
        expect(res.by).toBe('temperature');
    });

    test('not enough events => drop at aggregate', () => {
        const ctx = makeCtx({
            playEvents: events(1, 5000),
            state: { lastEventAt: NOW - 5000, lastGamePlayedAt: NOW - 600_000 },
        });
        const res = chain().run(ctx);
        expect(res.action).toBe('drop');
        expect(res.by).toBe('aggregateThreshold');
    });

    test('duplicate => drop at deduplication', () => {
        const ctx = makeCtx({
            playEvents: events(5, 5000),
            state: { lastEventAt: NOW - 500 },
        });
        const res = chain().run(ctx);
        expect(res.action).toBe('drop');
        expect(res.by).toBe('deduplication');
    });

    test('detected too recently => drop at detectSpacing', () => {
        const ctx = makeCtx({
            playEvents: events(5, 5000),
            state: { lastEventAt: NOW - 5000, lastGamePlayedAt: NOW - 600_000, lastDetectAttemptAt: NOW - 10_000 },
        });
        const res = chain().run(ctx);
        expect(res.action).toBe('drop');
        expect(res.by).toBe('detectSpacing');
    });

    test('disabling a filter removes it from the chain', () => {
        const c = new FilterChain([
            new DeduplicationFilter({ enabled: false, windowMs: 2000 }),
            new AggregateThresholdFilter({ enabled: true, windowMs: 5000, threshold: 3 }),
        ]);
        expect(c.active.map((f) => f.name)).toEqual(['aggregateThreshold']);
        // Even a "duplicate" passes dedup since it is disabled.
        const ctx = makeCtx({ playEvents: events(5, 5000), state: { lastEventAt: NOW - 100 } });
        // aggregate passes (5 >= 3), chain ends with no terminal => drop.
        expect(c.run(ctx).by).toBe('chain-end');
    });
});
