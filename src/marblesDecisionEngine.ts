import { MARBLES_CONFIG } from './marblesConfig';
import { MarblesHeuristicsManager, MarblesChannelState } from './marblesHeuristics';
import { ChannelHeuristics } from './heuristics';

// ============================================
// DECISION RESULT TYPE
// ============================================

export interface DecisionResult {
    shouldSend: boolean;
    confidence: number;
    reason: string;
    requiresVisualInspection: boolean;
    visualInspectionMandatory: boolean;
    details: {
        inCooldown: boolean;
        cooldownRemainingMs: number;
        atP90: boolean;
        currentRate: number;
        averageRate: number;
        rateTrend: 'increasing' | 'decreasing' | 'stable';
        activeFrequentUsers: number;
        totalFrequentUsers: number;
        hasHeuristics: boolean;
        visualInspectionAge: number;
        cachedResult: boolean;
        singlePlayerWithHeuristics: boolean;
    };
}

// ============================================
// DECISION ENGINE
// ============================================

export class MarblesDecisionEngine {
    private heuristicsManager: MarblesHeuristicsManager;
    
    constructor(heuristicsManager: MarblesHeuristicsManager) {
        this.heuristicsManager = heuristicsManager;
    }
    
    /**
     * Main decision function - evaluates all criteria and determines if we should send !play
     */
    evaluate(
        channelId: string,
        baseHeuristics: ChannelHeuristics,
        visualInspectionResult?: { isInGame: boolean; isPreGameLobby: boolean }
    ): DecisionResult {
        const marblesState = this.heuristicsManager.getOrCreateState(channelId, baseHeuristics);
        
        // Gather all metrics
        const metrics = this.gatherMetrics(channelId, baseHeuristics, marblesState);
        
        // Priority 1: Cooldown check
        if (metrics.inCooldown) {
            // In cooldown - only exit if rate has increased significantly
            if (metrics.rateTrend === 'increasing' && metrics.currentRate > metrics.averageRate * MARBLES_CONFIG.RATE_INCREASE_THRESHOLD) {
                return this.buildResult(false, 0.1, 'In cooldown but rate increasing significantly - waiting for cooldown to expire', metrics, false, false);
            }
            
            return this.buildResult(false, 0, `In cooldown period (${Math.round(metrics.cooldownRemainingMs / 1000)}s remaining)`, metrics, false, false);
        }
        
        // Priority 2: Heuristics evaluation
        const heuristicsEvaluation = this.evaluateHeuristics(metrics, baseHeuristics, marblesState);
        
        if (heuristicsEvaluation.conclusive) {
            // Heuristics are conclusive - decide based on them (no visual inspection needed)
            if (heuristicsEvaluation.shouldSend) {
                return this.buildResult(true, heuristicsEvaluation.confidence, heuristicsEvaluation.reason, metrics, false, false);
            } else {
                return this.buildResult(false, heuristicsEvaluation.confidence, heuristicsEvaluation.reason, metrics, false, false);
            }
        }
        
        // Priority 3: Visual inspection decision
        // Heuristics are inconclusive or don't exist - may need visual inspection
        const visualDecision = this.heuristicsManager.isVisualInspectionRequired(channelId, baseHeuristics);
        
        if (visualDecision.mandatory) {
            // First time or >1 hour - must do visual inspection
            return this.buildResult(false, 0, `Visual inspection mandatory (${metrics.visualInspectionAge > MARBLES_CONFIG.MAX_VISUAL_INSPECTION_AGE_MS ? '>1hr since last' : 'no prior inspection'})`, metrics, true, true);
        }
        
        // Heuristics inconclusive - check if we have cached result first
        if (metrics.cachedResult) {
            // We have recent cached data (<30s) - use it instead of doing new visual inspection
            const cache = this.heuristicsManager.getScreenshotCache(channelId, baseHeuristics);
            if (cache && (cache.isInGame || cache.isPreGameLobby)) {
                return this.buildResult(true, 0.85, 'Using cached visual inspection (<30s old) - game/lobby detected, sending !play', metrics, false, false);
            } else if (cache) {
                return this.buildResult(false, 0.85, 'Using cached visual inspection (<30s old) - no game detected, not sending', metrics, false, false);
            }
        }
        
        // No cache available - visual inspection required
        return this.buildResult(false, 0, 'Heuristics inconclusive and no recent cache - visual inspection required', metrics, true, false);
        
        // Shouldn't reach here, but default to not sending
        return this.buildResult(false, 0, 'Unable to make decision - defaulting to not sending', metrics, true, false);
    }
    
    /**
     * Evaluate heuristics to determine if we should send !play
     */
    private evaluateHeuristics(
        metrics: DecisionMetrics,
        baseHeuristics: ChannelHeuristics,
        marblesState: MarblesChannelState
    ): { conclusive: boolean; shouldSend: boolean; confidence: number; reason: string } {
        
        // Check if we have enough data (with null checks)
        const gameCount = baseHeuristics?.gameStartTimestamps?.length || 0;
        const observedEvents = marblesState?.totalPlayCommandsSeen || 0;
        
        const hasEnoughData = (gameCount >= MARBLES_CONFIG.MIN_GAMES_FOR_TIME_PREDICTION ||
                               observedEvents >= 50) && // Also consider observed events
                              (baseHeuristics?.avgPlayerCount || 0) > 0;
        
        if (!hasEnoughData) {
            return { conclusive: false, shouldSend: false, confidence: 0, reason: 'Insufficient historical data' };
        }
        
        // Calculate confidence score
        let confidence = 0;
        const reasons: string[] = [];
        
        // Factor 1: Base confidence from having historical data
        // More games = more confident in our heuristics
        const dataConfidence = Math.min(0.4, gameCount / 20); // Up to 0.4 for 20+ games
        confidence += dataConfidence;
        if (dataConfidence > 0.1) {
            reasons.push(`${gameCount} games recorded`);
        }
        
        // Factor 1b: Confidence from observed events (even if we haven't sent many !plays)
        const observedConfidence = Math.min(0.3, observedEvents / 200); // Up to 0.3 for 200+ observed events
        confidence += observedConfidence;
        if (observedConfidence > 0.1) {
            reasons.push(`${observedEvents} events observed`);
        }
        
        // Factor 2: P90 threshold check
        if (metrics.atP90) {
            confidence += 0.25;
            reasons.push('At P90 threshold');
        }
        
        // Factor 3: Frequent users active
        if (metrics.activeFrequentUsers >= 2) {
            confidence += 0.25;
            reasons.push(`${metrics.activeFrequentUsers} frequent users active`);
        } else if (metrics.activeFrequentUsers === 1) {
            confidence += 0.15;
            reasons.push('1 frequent user active');
        }
        
        // Factor 4: Rate trend
        if (metrics.rateTrend === 'increasing') {
            confidence += 0.2;
            reasons.push('Rate increasing');
        } else if (metrics.rateTrend === 'stable' && metrics.currentRate > 0) {
            confidence += 0.1;
            reasons.push('Rate stable with activity');
        }
        
        // Factor 5: Single player scenario with heuristics
        if (metrics.singlePlayerWithHeuristics) {
            confidence += 0.2;
            reasons.push('Low player count scenario');
        }
        
        // Adjust thresholds based on data quality
        // With lots of data (games recorded OR observed events), we can be conclusive with lower confidence
        const hasLotsOfData = gameCount >= 10 || observedEvents >= 100;
        const adjustedConclusiveThreshold = hasLotsOfData ? 0.35 : MARBLES_CONFIG.CONCLUSIVE_CONFIDENCE_THRESHOLD;
        const adjustedSendThreshold = hasLotsOfData ? 0.45 : MARBLES_CONFIG.MIN_CONFIDENCE_WITHOUT_VISUAL;
        
        const isConclusive = confidence >= adjustedConclusiveThreshold;
        const shouldSend = confidence >= adjustedSendThreshold;
        
        return {
            conclusive: isConclusive,
            shouldSend,
            confidence,
            reason: reasons.join(', ') || 'No strong indicators',
        };
    }
    
    /**
     * Gather all metrics needed for decision making
     */
    private gatherMetrics(
        channelId: string,
        baseHeuristics: ChannelHeuristics,
        marblesState: MarblesChannelState
    ): DecisionMetrics {
        const inCooldown = this.heuristicsManager.isInCooldownPeriod(channelId, baseHeuristics);
        const cooldownRemainingMs = this.heuristicsManager.getCooldownRemainingMs(channelId, baseHeuristics);
        const atP90 = this.heuristicsManager.isAtP90Threshold(channelId, baseHeuristics);
        const currentRate = marblesState.currentRate;
        const averageRate = this.heuristicsManager.getAverageRate(channelId, baseHeuristics);
        const rateTrend = this.heuristicsManager.getRateTrend(channelId, baseHeuristics);
        const activeFrequentUsers = this.heuristicsManager.getActiveFrequentUserCount(channelId, baseHeuristics);
        const totalFrequentUsers = marblesState.frequentUsers.size;
        
        const gameCount = baseHeuristics?.gameStartTimestamps?.length || 0;
        const hasHeuristics = gameCount >= MARBLES_CONFIG.MIN_GAMES_FOR_TIME_PREDICTION &&
                             (baseHeuristics?.avgPlayerCount || 0) > 0;
        
        const visualInspectionAge = marblesState.lastVisualInspection > 0
            ? Date.now() - marblesState.lastVisualInspection
            : Infinity;
        
        const cachedResult = this.heuristicsManager.getScreenshotCache(channelId, baseHeuristics) !== null;
        
        // Single player with heuristics check
        const singlePlayerWithHeuristics = hasHeuristics &&
                                          baseHeuristics.avgPlayerCount <= MARBLES_CONFIG.LOW_PLAYER_THRESHOLD &&
                                          currentRate > 0;
        
        return {
            inCooldown,
            cooldownRemainingMs,
            atP90,
            currentRate,
            averageRate,
            rateTrend,
            activeFrequentUsers,
            totalFrequentUsers,
            hasHeuristics,
            visualInspectionAge,
            cachedResult,
            singlePlayerWithHeuristics,
        };
    }
    
    /**
     * Build the final decision result object
     */
    private buildResult(
        shouldSend: boolean,
        confidence: number,
        reason: string,
        metrics: DecisionMetrics,
        requiresVisualInspection: boolean,
        visualInspectionMandatory: boolean
    ): DecisionResult {
        return {
            shouldSend,
            confidence,
            reason,
            requiresVisualInspection,
            visualInspectionMandatory,
            details: { ...metrics },
        };
    }
    
    /**
     * Get a summary of the decision factors for a channel
     */
    getDecisionSummary(channelId: string, baseHeuristics: ChannelHeuristics): object {
        const marblesState = this.heuristicsManager.getOrCreateState(channelId, baseHeuristics);
        const metrics = this.gatherMetrics(channelId, baseHeuristics, marblesState);
        
        return {
            channelId,
            decisionFactors: {
                cooldown: {
                    inCooldown: metrics.inCooldown,
                    remainingSeconds: Math.round(metrics.cooldownRemainingMs / 1000),
                },
                rate: {
                    current: metrics.currentRate.toFixed(2),
                    average: metrics.averageRate.toFixed(2),
                    trend: metrics.rateTrend,
                    atP90: metrics.atP90,
                },
                users: {
                    activeFrequent: metrics.activeFrequentUsers,
                    totalFrequent: metrics.totalFrequentUsers,
                },
                heuristics: {
                    hasData: metrics.hasHeuristics,
                    gamesRecorded: baseHeuristics?.gameStartTimestamps?.length || 0,
                    avgPlayerCount: baseHeuristics?.avgPlayerCount || 0,
                },
                visual: {
                    inspectionAge: metrics.visualInspectionAge === Infinity ? 'never' : `${Math.round(metrics.visualInspectionAge / 1000)}s`,
                    cachedResult: metrics.cachedResult,
                },
            },
        };
    }
}

// ============================================
// DECISION METRICS TYPE
// ============================================

interface DecisionMetrics {
    inCooldown: boolean;
    cooldownRemainingMs: number;
    atP90: boolean;
    currentRate: number;
    averageRate: number;
    rateTrend: 'increasing' | 'decreasing' | 'stable';
    activeFrequentUsers: number;
    totalFrequentUsers: number;
    hasHeuristics: boolean;
    visualInspectionAge: number;
    cachedResult: boolean;
    singlePlayerWithHeuristics: boolean;
}
