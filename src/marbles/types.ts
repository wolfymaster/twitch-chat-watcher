/**
 * Core Marbles types — modeled directly on the `marbles` page of
 * woofx3-marbles.drawio.png.
 *
 * The diagram's flow is:
 *   chat listener -> event filter (chain) -> [drop | bypass-ready | detect]
 *   detect -> DetectMarblesSession (vision) -> Session
 *   Session.state (stopped | running | ready) drives the outcome.
 */

// ============================================
// SESSION (output of DetectMarblesSession)
// ============================================

export type SessionState = 'ready' | 'running' | 'stopped';

export type GameLocation =
    | 'top_right'
    | 'top_left'
    | 'bottom_right'
    | 'bottom_left'
    | 'fullscreen';

/** Evidence gathered by the vision model when a game is present. */
export interface SessionEvidence {
    /** A "Play" call-to-action string is visible. */
    play_present: boolean;
    /** A countdown UI element is visible. */
    countdown_present: boolean;
    /** A timer is visible. */
    time_present: boolean;
}

/**
 * The structured result the vision provider returns. Mirrors the `Session`
 * type written on the diagram.
 */
export interface Session {
    state: SessionState;
    evidence: SessionEvidence;
    game_location: GameLocation;
}

// ============================================
// GAME MANAGER STATE OBJECT
// ============================================

/**
 * Per-channel state the Game Manager carries. Mirrors the "Game Manager State
 * Object" on the diagram. Timestamps are epoch-ms (diagram says `date`); null
 * means "never".
 */
export interface GameManagerState {
    channel: string;
    state: SessionState | 'idle';
    lastGamePlayedAt: number | null;
    lastEventAt: number | null;
    lastDetectAttemptAt: number | null;
    lastMessageSentAt: number | null;
}

// ============================================
// CONFIGURATION
// ============================================

export type VisionProviderName = 'ollama' | 'claude';

export interface OllamaVisionConfig {
    /** Base URL of the Ollama server, e.g. http://localhost:11434 */
    host: string;
    /** Model tag, e.g. llama3.2-vision */
    model: string;
}

export interface MarblesVisionConfig {
    provider: VisionProviderName;
    ollama: OllamaVisionConfig;
}

export interface MarblesPlayConfig {
    /** Base command name; the matcher becomes `^!<command>\d*$` (e.g. play1, play2). */
    command: string;
    /** Canonical reply sent to chat when we decide to join (e.g. "!play"). */
    response: string;
    /** RxJS throttle window (ms) for the send. */
    cooldown: number;
    /** Channels this trigger applies to; `["*"]` for all. */
    channels: string[];
}

interface FilterToggle {
    enabled: boolean;
}

export interface DeduplicationFilterConfig extends FilterToggle {
    /** Drop events that arrive within this window of the previous event. */
    windowMs: number;
}

export interface AggregateThresholdFilterConfig extends FilterToggle {
    /** Window over which events are counted. */
    windowMs: number;
    /** Minimum number of events in the window required to proceed. */
    threshold: number;
}

export interface TemperatureFilterConfig extends FilterToggle {
    /** age < hotCutoffMs since last game => too soon, drop. */
    hotCutoffMs: number;
    /** age < warmCutoffMs since last game => assume active, bypass to ready. */
    warmCutoffMs: number;
}

export interface DetectSpacingFilterConfig extends FilterToggle {
    /** Minimum spacing between vision detect attempts (cost control). */
    spacingMs: number;
}

export interface P90FilterConfig extends FilterToggle {}

export interface FrequentUsersFilterConfig extends FilterToggle {
    /** Minimum active frequent users required to proceed. */
    minActive: number;
}

export interface RateTrendFilterConfig extends FilterToggle {}

export interface MarblesFiltersConfig {
    deduplication: DeduplicationFilterConfig;
    aggregateThreshold: AggregateThresholdFilterConfig;
    temperature: TemperatureFilterConfig;
    detectSpacing: DetectSpacingFilterConfig;
    p90: P90FilterConfig;
    frequentUsers: FrequentUsersFilterConfig;
    rateTrend: RateTrendFilterConfig;
}

export interface MarblesConfig {
    play: MarblesPlayConfig;
    vision: MarblesVisionConfig;
    filters: MarblesFiltersConfig;
    /** Minimum time between !play messages we actually send. */
    sendCooldownMs: number;
}
