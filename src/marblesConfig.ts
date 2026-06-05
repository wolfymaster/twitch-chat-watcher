/**
 * Marbles Game Configuration
 * 
 * All tunable parameters for the Marbles game detection and response system.
 * Modify these values to adjust behavior without changing code logic.
 */

export const MARBLES_CONFIG = {
    // ============================================
    // TIMING CONFIGURATION
    // ============================================
    
    /** Size of the sliding window for rate calculations (5 seconds) */
    WINDOW_SIZE_MS: 5000,
    
    /** Minimum cooldown period after sending !play (3 minutes) */
    MIN_COOLDOWN_MS: 180000,
    
    /** Maximum age of visual inspection before forcing a new one (1 hour) */
    MAX_VISUAL_INSPECTION_AGE_MS: 3600000,
    
    /** How long to cache screenshot results (30 seconds) */
    SCREENSHOT_CACHE_DURATION_MS: 30000,
    
    /** Grace period before destroying game when rate drops to 0 (30 seconds) */
    GRACE_PERIOD_MS: 30000,
    
    /** How often to calculate and update rate metrics (5 seconds) */
    RATE_CALCULATION_INTERVAL_MS: 5000,
    
    /** How often to save heuristics to disk (5 minutes) */
    HEURISTICS_SAVE_INTERVAL_MS: 300000,
    
    // ============================================
    // THRESHOLDS
    // ============================================
    
    /** P90 threshold - current usage must be >= 90% of average to trigger */
    P90_THRESHOLD: 0.90,
    
    /** Rate increase threshold to exit cooldown (20% increase) */
    RATE_INCREASE_THRESHOLD: 1.20,
    
    /** Minimum rate to consider a game still active */
    MIN_RATE_FOR_ACTIVE_GAME: 0.5,
    
    /** Rate threshold below which we consider the game "ended" */
    ENDED_RATE_THRESHOLD: 0.1,
    
    /** Minimum number of !play events to have meaningful heuristics */
    MIN_EVENTS_FOR_HEURISTICS: 10,
    
    /** Minimum number of games recorded to trust time predictions */
    MIN_GAMES_FOR_TIME_PREDICTION: 3,
    
    // ============================================
    // PLAYER COUNT CLASSIFICATION
    // ============================================
    
    /** Threshold for "low" player count (1-3 players typical) */
    LOW_PLAYER_THRESHOLD: 3,
    
    /** Threshold for "high" player count (20+ players) */
    HIGH_PLAYER_THRESHOLD: 20,
    
    // ============================================
    // USER TRACKING
    // ============================================
    
    /** Minimum number of !plays to be considered a "frequent user" */
    FREQUENT_USER_MIN_PLAYS: 5,
    
    /** How many recent !play events to store per channel */
    MAX_STORED_EVENTS: 100,
    
    /** How many rate history points to keep for trend analysis */
    MAX_RATE_HISTORY: 20,
    
    /** How many users to track per channel */
    MAX_TRACKED_USERS: 50,
    
    // ============================================
    // DECISION CONFIDENCE
    // ============================================
    
    /** Minimum confidence to send !play without visual inspection */
    MIN_CONFIDENCE_WITHOUT_VISUAL: 0.70,
    
    /** Minimum confidence to consider heuristics "conclusive" */
    CONCLUSIVE_CONFIDENCE_THRESHOLD: 0.60,
    
    // ============================================
    // VISUAL AI
    // ============================================
    
    /** Minimum confidence from AI to consider screenshot valid */
    MIN_AI_CONFIDENCE: 0.70,
    
    /** Wait time after trigger before capturing (seconds) */
    CAPTURE_DELAY_SECONDS: 2,
    
    // ============================================
    // RATE CALCULATION
    // ============================================
    
    /** Number of windows to average for "stable" rate calculation */
    RATE_AVERAGE_WINDOWS: 3,
} as const;

// Type export for type safety
export type MarblesConfig = typeof MARBLES_CONFIG;
