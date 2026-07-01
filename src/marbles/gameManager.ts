/**
 * Game Manager — owns the per-channel "Game Manager State Object" and turns a
 * filter-chain resolution into an outcome, exactly as drawn on the diagram:
 *
 *   event filter -> drop          : do nothing
 *                -> bypass-ready   : treat as ready (warm path, no vision)
 *                -> detect         : run DetectMarblesSession -> Session
 *
 *   Session.state -> stopped : update state, do nothing
 *                 -> running : update state, set lastGamePlayedAt = now
 *                 -> ready   : set lastGamePlayedAt, verify send-cooldown, send
 *
 * `handlePlay` returns whether the caller should actually emit `!play`. The
 * randomized send delay ("randomize the delay" node) is handled by the existing
 * RxJS throttle subject in index.ts.
 */

import chalk from 'chalk';
import type { HeuristicsManager } from '../heuristics';
import type { MarblesHeuristicsManager } from '../marblesHeuristics';
import type { FilterChain, FilterContext } from './filters/filter';
import type { SessionDetector } from './sessionDetector';
import type { GameManagerState } from './types';

function colorizeFilterLine(channel: string, action: string, by: string, reason: string): string {
    const prefix = `[${channel}] [filter] ${action} via ${by}: `;
    const lowerReason = reason.toLowerCase();
    if (lowerReason.startsWith('hot:')) {
        return chalk.bgRed.white(prefix + reason);
    }
    if (lowerReason.startsWith('warm:')) {
        return chalk.bgHex('#FF8C00').white(prefix + reason);
    }
    if (lowerReason.startsWith('cold:')) {
        return chalk.bgBlue.white(prefix + reason);
    }
    return prefix + reason;
}

export class GameManager {
    private states: Map<string, GameManagerState> = new Map();

    constructor(
        private readonly heuristics: HeuristicsManager,
        private readonly marblesHeuristics: MarblesHeuristicsManager,
        private readonly chain: FilterChain,
        private readonly detector: SessionDetector,
        private readonly sendCooldownMs: number,
    ) {}

    private getOrCreateState(channel: string): GameManagerState {
        let state = this.states.get(channel);
        if (!state) {
            state = {
                channel,
                state: 'idle',
                lastGamePlayedAt: null,
                lastEventAt: null,
                lastDetectAttemptAt: null,
                lastMessageSentAt: null,
            };
            this.states.set(channel, state);
        }
        return state;
    }

    /** Test/diagnostic accessor. */
    getState(channel: string): GameManagerState {
        return this.getOrCreateState(channel);
    }

    /**
     * Process a `!play` event end-to-end. Returns true if the caller should send
     * `!play` to chat.
     */
    async handlePlay(channel: string, user: string, now: number = Date.now()): Promise<boolean> {
        const state = this.getOrCreateState(channel);
        const baseHeuristics = this.heuristics.getOrCreateHeuristics(channel);

        // Always record the event so the aggregate/rate filters have data.
        this.marblesHeuristics.recordPlayEvent(channel, user, baseHeuristics);

        const ctx: FilterContext = {
            channel,
            user,
            now,
            state,
            heuristics: this.heuristics,
            baseHeuristics,
            marblesHeuristics: this.marblesHeuristics,
        };

        const resolution = this.chain.run(ctx);
        console.log(colorizeFilterLine(channel, resolution.action, resolution.by, resolution.reason));

        switch (resolution.action) {
            case 'drop':
                return false;

            case 'bypass-ready':
                return this.handleReady(channel, state, now);

            case 'detect': {
                const session = await this.detector.detect(channel, now);
                console.log(`[${channel}] [session] state=${session.state} location=${session.game_location}`);

                switch (session.state) {
                    case 'stopped':
                        state.state = 'stopped';
                        return false;
                    case 'running':
                        state.state = 'running';
                        state.lastGamePlayedAt = now;
                        return false;
                    case 'ready':
                        return this.handleReady(channel, state, now);
                }
            }
        }
    }

    /**
     * "ready" outcome: record the game time, verify we are out of the send
     * cooldown, and commit to sending if so.
     */
    private handleReady(channel: string, state: GameManagerState, now: number): boolean {
        state.state = 'ready';
        state.lastGamePlayedAt = now;

        if (state.lastMessageSentAt !== null && now - state.lastMessageSentAt < this.sendCooldownMs) {
            const remaining = this.sendCooldownMs - (now - state.lastMessageSentAt);
            console.log(`[${channel}] [ready] In send-cooldown (${Math.round(remaining / 1000)}s left) — not sending`);
            return false;
        }

        // Commit to sending: bookkeeping mirrors the old sendPlayCommand path.
        state.lastMessageSentAt = now;
        const baseHeuristics = this.heuristics.getOrCreateHeuristics(channel);
        this.marblesHeuristics.recordSentPlay(channel, baseHeuristics);
        this.heuristics.recordGameStart(channel);
        this.heuristics.recordMyJoin(channel);
        console.log(chalk.bgGreen.white(`[${channel}] [ready] Sending !play`));
        return true;
    }
}
