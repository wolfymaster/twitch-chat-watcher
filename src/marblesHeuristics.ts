import * as fs from 'fs';
import * as path from 'path';
import { MARBLES_CONFIG } from './marblesConfig';
import type { ChannelHeuristics } from './heuristics';

// ============================================
// TYPES
// ============================================

export interface PlayEvent {
    timestamp: number;
    username: string;
}

export interface RatePoint {
    timestamp: number;
    rate: number; // !plays per second
}

export interface UserPattern {
    username: string;
    totalPlays: number;
    lastSeen: number;
    firstSeen: number;
    isFrequentUser: boolean;
}

export interface ScreenshotCache {
    isInGame: boolean;
    isPreGameLobby: boolean;
    timestamp: number;
}

export interface MarblesChannelState {
    channelId: string;
    
    // Event tracking
    playEvents: PlayEvent[];
    
    // Rate tracking
    rateHistory: RatePoint[];
    currentRate: number;
    
    // User patterns
    userPatterns: Map<string, UserPattern>;
    frequentUsers: Set<string>;
    
    // Timing
    lastVisualInspection: number;
    lastSentPlay: number;
    gameStartTime: number | null;
    
    // Caching
    screenshotCache: ScreenshotCache | null;
    
    // Statistics
    totalPlayCommandsSeen: number;
    uniqueUsersSeen: Set<string>;
    
    // Heuristics reference
    baseHeuristics: ChannelHeuristics;
}

// ============================================
// MARBLES HEURISTICS MANAGER
// ============================================

export class MarblesHeuristicsManager {
    private states: Map<string, MarblesChannelState> = new Map();
    private memoryDir: string;
    private saveInterval: NodeJS.Timeout | null = null;
    
    constructor(memoryDir: string = './memory') {
        this.memoryDir = memoryDir;
        this.ensureMemoryDirExists();
        this.loadAllStates();
        this.startPeriodicSave();
    }
    
    // ============================================
    // INITIALIZATION
    // ============================================
    
    private ensureMemoryDirExists(): void {
        if (!fs.existsSync(this.memoryDir)) {
            fs.mkdirSync(this.memoryDir, { recursive: true });
            console.log(`[MarblesHeuristics] Created memory directory: ${this.memoryDir}`);
        }
    }
    
    private getMemoryFilePath(channelId: string): string {
        return path.join(this.memoryDir, `${channelId}_marbles_heuristics.json`);
    }
    
    // ============================================
    // STATE MANAGEMENT
    // ============================================
    
    getOrCreateState(channelId: string, baseHeuristics: ChannelHeuristics): MarblesChannelState {
        if (!this.states.has(channelId)) {
            const newState: MarblesChannelState = {
                channelId,
                playEvents: [],
                rateHistory: [],
                currentRate: 0,
                userPatterns: new Map(),
                frequentUsers: new Set(),
                lastVisualInspection: 0,
                lastSentPlay: 0,
                gameStartTime: null,
                screenshotCache: null,
                totalPlayCommandsSeen: 0,
                uniqueUsersSeen: new Set(),
                baseHeuristics,
            };
            this.states.set(channelId, newState);
        }
        return this.states.get(channelId)!;
    }
    
    getState(channelId: string): MarblesChannelState | undefined {
        return this.states.get(channelId);
    }
    
    // ============================================
    // EVENT TRACKING
    // ============================================
    
    recordPlayEvent(channelId: string, username: string, baseHeuristics: ChannelHeuristics): void {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        const now = Date.now();
        
        // Add event
        const event: PlayEvent = {
            timestamp: now,
            username,
        };
        state.playEvents.push(event);
        state.totalPlayCommandsSeen++;
        state.uniqueUsersSeen.add(username);
        
        // Trim old events
        if (state.playEvents.length > MARBLES_CONFIG.MAX_STORED_EVENTS) {
            state.playEvents = state.playEvents.slice(-MARBLES_CONFIG.MAX_STORED_EVENTS);
        }
        
        // Update user patterns
        this.updateUserPattern(state, username, now);
        
        console.log(`[MarblesHeuristics] ${channelId}: Recorded !play from ${username}. Total events: ${state.totalPlayCommandsSeen}, Unique users: ${state.uniqueUsersSeen.size}`);
    }
    
    private updateUserPattern(state: MarblesChannelState, username: string, now: number): void {
        let pattern = state.userPatterns.get(username);
        
        if (!pattern) {
            pattern = {
                username,
                totalPlays: 0,
                lastSeen: now,
                firstSeen: now,
                isFrequentUser: false,
            };
            state.userPatterns.set(username, pattern);
        }
        
        pattern.totalPlays++;
        pattern.lastSeen = now;
        pattern.isFrequentUser = pattern.totalPlays >= MARBLES_CONFIG.FREQUENT_USER_MIN_PLAYS;
        
        if (pattern.isFrequentUser) {
            state.frequentUsers.add(username);
        }
        
        // Limit tracked users
        if (state.userPatterns.size > MARBLES_CONFIG.MAX_TRACKED_USERS) {
            // Remove oldest/least active user
            const sorted = Array.from(state.userPatterns.entries())
                .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
            const toRemove = sorted[0][0];
            state.userPatterns.delete(toRemove);
            state.frequentUsers.delete(toRemove);
        }
    }
    
    // ============================================
    // RATE CALCULATION
    // ============================================
    
    calculateCurrentRate(channelId: string, baseHeuristics: ChannelHeuristics): number {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        const now = Date.now();
        const windowStart = now - MARBLES_CONFIG.WINDOW_SIZE_MS;
        
        // Count events in the last window
        const recentEvents = state.playEvents.filter(e => e.timestamp >= windowStart);
        const rate = recentEvents.length / (MARBLES_CONFIG.WINDOW_SIZE_MS / 1000);
        
        state.currentRate = rate;
        
        // Add to history
        state.rateHistory.push({
            timestamp: now,
            rate,
        });
        
        // Trim history
        if (state.rateHistory.length > MARBLES_CONFIG.MAX_RATE_HISTORY) {
            state.rateHistory = state.rateHistory.slice(-MARBLES_CONFIG.MAX_RATE_HISTORY);
        }
        
        return rate;
    }
    
    getAverageRate(channelId: string, baseHeuristics: ChannelHeuristics): number {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        
        if (state.rateHistory.length === 0) {
            return 0;
        }
        
        const sum = state.rateHistory.reduce((acc, point) => acc + point.rate, 0);
        return sum / state.rateHistory.length;
    }
    
    getRateTrend(channelId: string, baseHeuristics: ChannelHeuristics): 'increasing' | 'decreasing' | 'stable' {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        
        if (state.rateHistory.length < 2) {
            return 'stable';
        }
        
        // Compare recent rate to average
        const recent = state.rateHistory.slice(-MARBLES_CONFIG.RATE_AVERAGE_WINDOWS);
        const recentAvg = recent.reduce((acc, p) => acc + p.rate, 0) / recent.length;
        const overallAvg = this.getAverageRate(channelId, baseHeuristics);
        
        const ratio = recentAvg / overallAvg;
        
        if (ratio > MARBLES_CONFIG.RATE_INCREASE_THRESHOLD) {
            return 'increasing';
        } else if (ratio < 0.8) {
            return 'decreasing';
        }
        
        return 'stable';
    }
    
    // ============================================
    // P90 CALCULATION
    // ============================================
    
    isAtP90Threshold(channelId: string, baseHeuristics: ChannelHeuristics): boolean {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        const avgRate = this.getAverageRate(channelId, baseHeuristics);
        
        if (avgRate === 0) {
            return false;
        }
        
        const ratio = state.currentRate / avgRate;
        return ratio >= MARBLES_CONFIG.P90_THRESHOLD;
    }
    
    // ============================================
    // USER ANALYSIS
    // ============================================
    
    getActiveFrequentUsers(channelId: string, baseHeuristics: ChannelHeuristics): string[] {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        const now = Date.now();
        const windowStart = now - MARBLES_CONFIG.WINDOW_SIZE_MS;
        
        // Get users who sent !play in the last window AND are frequent users
        const activeUsers = new Set<string>();
        state.playEvents
            .filter(e => e.timestamp >= windowStart)
            .forEach(e => activeUsers.add(e.username));
        
        return Array.from(activeUsers).filter(u => state.frequentUsers.has(u));
    }
    
    getActiveFrequentUserCount(channelId: string, baseHeuristics: ChannelHeuristics): number {
        return this.getActiveFrequentUsers(channelId, baseHeuristics).length;
    }
    
    // ============================================
    // COOLDOWN & TIMING
    // ============================================
    
    isInCooldownPeriod(channelId: string, baseHeuristics: ChannelHeuristics): boolean {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        
        if (state.lastSentPlay === 0) {
            return false;
        }
        
        const timeSinceLastPlay = Date.now() - state.lastSentPlay;
        return timeSinceLastPlay < MARBLES_CONFIG.MIN_COOLDOWN_MS;
    }
    
    getCooldownRemainingMs(channelId: string, baseHeuristics: ChannelHeuristics): number {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        
        if (state.lastSentPlay === 0) {
            return 0;
        }
        
        const elapsed = Date.now() - state.lastSentPlay;
        const remaining = MARBLES_CONFIG.MIN_COOLDOWN_MS - elapsed;
        
        return Math.max(0, remaining);
    }
    
    recordSentPlay(channelId: string, baseHeuristics: ChannelHeuristics): void {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        state.lastSentPlay = Date.now();
        
        if (!state.gameStartTime) {
            state.gameStartTime = Date.now();
        }
        
        console.log(`[MarblesHeuristics] ${channelId}: Recorded that we sent !play. Cooldown started.`);
    }
    
    recordVisualInspection(channelId: string, baseHeuristics: ChannelHeuristics, result: ScreenshotCache): void {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        state.lastVisualInspection = Date.now();
        state.screenshotCache = {
            ...result,
            timestamp: Date.now(),
        };
        
        console.log(`[MarblesHeuristics] ${channelId}: Recorded visual inspection. In game: ${result.isInGame}, Lobby: ${result.isPreGameLobby}`);
    }
    
    getScreenshotCache(channelId: string, baseHeuristics: ChannelHeuristics): ScreenshotCache | null {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        
        if (!state.screenshotCache) {
            return null;
        }
        
        const age = Date.now() - state.screenshotCache.timestamp;
        
        if (age > MARBLES_CONFIG.SCREENSHOT_CACHE_DURATION_MS) {
            state.screenshotCache = null;
            return null;
        }
        
        return state.screenshotCache;
    }
    
    isVisualInspectionRequired(channelId: string, baseHeuristics: ChannelHeuristics): { required: boolean; mandatory: boolean } {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        
        if (state.lastVisualInspection === 0) {
            return { required: true, mandatory: true };
        }
        
        const age = Date.now() - state.lastVisualInspection;
        
        if (age > MARBLES_CONFIG.MAX_VISUAL_INSPECTION_AGE_MS) {
            return { required: true, mandatory: true };
        }
        
        // Check if we have cached result
        if (state.screenshotCache) {
            const cacheAge = Date.now() - state.screenshotCache.timestamp;
            if (cacheAge <= MARBLES_CONFIG.SCREENSHOT_CACHE_DURATION_MS) {
                return { required: false, mandatory: false };
            }
        }
        
        return { required: true, mandatory: false };
    }
    
    // ============================================
    // GAME STATE CHECKS
    // ============================================
    
    shouldExitGame(channelId: string, baseHeuristics: ChannelHeuristics): { shouldExit: boolean; reason: string } {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        
        // If in cooldown, don't exit - game is still active
        if (this.isInCooldownPeriod(channelId, baseHeuristics)) {
            return { shouldExit: false, reason: 'In cooldown period - game assumed active' };
        }
        
        // Check rate
        if (state.currentRate > MARBLES_CONFIG.ENDED_RATE_THRESHOLD) {
            return { shouldExit: false, reason: `Rate still positive: ${state.currentRate.toFixed(2)}/s` };
        }
        
        // Check if grace period has passed
        const lastEvent = state.playEvents[state.playEvents.length - 1];
        if (!lastEvent) {
            return { shouldExit: true, reason: 'No events recorded' };
        }
        
        const timeSinceLastEvent = Date.now() - lastEvent.timestamp;
        if (timeSinceLastEvent < MARBLES_CONFIG.GRACE_PERIOD_MS) {
            return { shouldExit: false, reason: `In grace period (${Math.round(timeSinceLastEvent / 1000)}s elapsed)` };
        }
        
        return { shouldExit: true, reason: 'Rate near 0 and grace period expired' };
    }
    
    // ============================================
    // PERSISTENCE
    // ============================================
    
    private loadAllStates(): void {
        try {
            const files = fs.readdirSync(this.memoryDir);
            const marblesFiles = files.filter(f => f.endsWith('_marbles_heuristics.json'));
            
            console.log(`[MarblesHeuristics] Found ${marblesFiles.length} marbles heuristics files to load`);
            
            for (const file of marblesFiles) {
                const channelId = file.replace('_marbles_heuristics.json', '');
                this.loadState(channelId);
            }
        } catch (error) {
            console.log('[MarblesHeuristics] No existing marbles memory files found');
        }
    }
    
    private loadState(channelId: string): void {
        const filePath = this.getMemoryFilePath(channelId);
        
        if (!fs.existsSync(filePath)) {
            return;
        }
        
        try {
            const data = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(data);
            
            // Convert plain objects back to Maps and Sets
            const state: Partial<MarblesChannelState> = {
                ...parsed,
                userPatterns: new Map(Object.entries(parsed.userPatterns || {})),
                frequentUsers: new Set(parsed.frequentUsers || []),
                uniqueUsersSeen: new Set(parsed.uniqueUsersSeen || []),
            };
            
            this.states.set(channelId, state as MarblesChannelState);
            
            console.log(`[MarblesHeuristics] Loaded state for ${channelId}:`, {
                totalEvents: parsed.totalPlayCommandsSeen,
                uniqueUsers: parsed.uniqueUsersSeen?.length || 0,
                frequentUsers: parsed.frequentUsers?.length || 0,
            });
        } catch (error) {
            console.error(`[MarblesHeuristics] Error loading state for ${channelId}:`, error);
        }
    }
    
    saveState(channelId: string): void {
        const state = this.states.get(channelId);
        if (!state) return;
        
        const filePath = this.getMemoryFilePath(channelId);
        
        try {
            // Convert Maps and Sets to plain objects/arrays for JSON
            const serialized = {
                ...state,
                userPatterns: Object.fromEntries(state.userPatterns),
                frequentUsers: Array.from(state.frequentUsers),
                uniqueUsersSeen: Array.from(state.uniqueUsersSeen),
            };
            
            fs.writeFileSync(filePath, JSON.stringify(serialized, null, 2));
        } catch (error) {
            console.error(`[MarblesHeuristics] Error saving state for ${channelId}:`, error);
        }
    }
    
    saveAllStates(): void {
        console.log(`[MarblesHeuristics] Saving all states (${this.states.size} channels)...`);
        for (const channelId of this.states.keys()) {
            this.saveState(channelId);
        }
    }
    
    private startPeriodicSave(): void {
        this.saveInterval = setInterval(() => {
            this.saveAllStates();
        }, MARBLES_CONFIG.HEURISTICS_SAVE_INTERVAL_MS);
    }
    
    stopPeriodicSave(): void {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = null;
        }
    }
    
    // ============================================
    // SUMMARY
    // ============================================
    
    getSummary(channelId: string, baseHeuristics: ChannelHeuristics): object {
        const state = this.getOrCreateState(channelId, baseHeuristics);
        const avgRate = this.getAverageRate(channelId, baseHeuristics);
        const trend = this.getRateTrend(channelId, baseHeuristics);
        const isCooldown = this.isInCooldownPeriod(channelId, baseHeuristics);
        
        return {
            channelId,
            totalEvents: state.totalPlayCommandsSeen,
            uniqueUsers: state.uniqueUsersSeen.size,
            frequentUsers: state.frequentUsers.size,
            currentRate: state.currentRate.toFixed(2),
            averageRate: avgRate.toFixed(2),
            rateTrend: trend,
            inCooldown: isCooldown,
            cooldownRemaining: isCooldown ? Math.round(this.getCooldownRemainingMs(channelId, baseHeuristics) / 1000) : 0,
            lastSentPlay: state.lastSentPlay ? new Date(state.lastSentPlay).toISOString() : null,
            lastVisualInspection: state.lastVisualInspection ? new Date(state.lastVisualInspection).toISOString() : null,
        };
    }
    
    // ============================================
    // SHUTDOWN
    // ============================================
    
    shutdown(): void {
        console.log('[MarblesHeuristics] Shutting down and saving all states...');
        this.stopPeriodicSave();
        this.saveAllStates();
    }
}
