import { VisualAIService } from './visualAIService';
import { HeuristicsManager, ChannelHeuristics } from './heuristics';
import { MarblesHeuristicsManager, MarblesChannelState } from './marblesHeuristics';
import { MarblesDecisionEngine, DecisionResult } from './marblesDecisionEngine';
import { MARBLES_CONFIG } from './marblesConfig';

// ============================================
// TYPES
// ============================================

export interface SendFunction {
    (msg: string): Promise<void>;
}

export type GameState = 'collecting' | 'cooldown' | 'checking_exit' | 'ended';

// ============================================
// MARBLES GAME CLASS
// ============================================

export class MarblesGame {
    public readonly channelId: string;
    private state: GameState = 'collecting';
    
    // Services
    private visualAIService: VisualAIService | null;
    private baseHeuristicsManager: HeuristicsManager;
    private marblesHeuristicsManager: MarblesHeuristicsManager;
    private decisionEngine: MarblesDecisionEngine;
    
    // State
    private baseHeuristics: ChannelHeuristics;
    private marblesState: MarblesChannelState;
    
    // Tasks
    private heuristicsInterval: NodeJS.Timeout | null = null;
    private exitCheckInterval: NodeJS.Timeout | null = null;
    
    // Screenshot capture callback
    private captureScreenshot: () => Promise<string>;
    private sendMessage: SendFunction;
    
    // Debounce and mutex
    private lastDecisionTime: number = 0;
    private readonly DEBOUNCE_MS = 2000; // 2 second debounce
    private decisionLock: boolean = false; // Simple mutex
    
    constructor(
        channelId: string,
        baseHeuristicsManager: HeuristicsManager,
        marblesHeuristicsManager: MarblesHeuristicsManager,
        visualAIService: VisualAIService | null,
        captureScreenshot: () => Promise<string>,
        sendMessage: SendFunction
    ) {
        this.channelId = channelId;
        this.baseHeuristicsManager = baseHeuristicsManager;
        this.marblesHeuristicsManager = marblesHeuristicsManager;
        this.visualAIService = visualAIService;
        this.captureScreenshot = captureScreenshot;
        this.sendMessage = sendMessage;
        
        // Initialize heuristics
        this.baseHeuristics = baseHeuristicsManager.getOrCreateHeuristics(channelId);
        this.marblesState = marblesHeuristicsManager.getOrCreateState(channelId, this.baseHeuristics);
        
        // Initialize decision engine
        this.decisionEngine = new MarblesDecisionEngine(marblesHeuristicsManager);
        
        // Start background tasks
        this.startHeuristicsCollection();
        this.startExitCheck();
        
        console.log(`[MarblesGame] ${channelId}: Game instance created`);
        this.logState();
    }
    
    // ============================================
    // MAIN PROCESSING
    // ============================================
    
    /**
     * Process an incoming !play command
     * Returns true if we should send !play, false otherwise
     */
    async processPlayCommand(username: string): Promise<boolean> {
        console.log(`[MarblesGame] ${this.channelId}: Processing !play from ${username}`);
        
        // ALWAYS record heuristics (not debounced)
        this.marblesHeuristicsManager.recordPlayEvent(this.channelId, username, this.baseHeuristics);
        this.baseHeuristicsManager.recordPlayerJoin(this.channelId, true);
        this.marblesHeuristicsManager.calculateCurrentRate(this.channelId, this.baseHeuristics);
        
        // Check debounce - if we recently made a decision, skip this one
        const now = Date.now();
        const timeSinceLastDecision = now - this.lastDecisionTime;
        if (timeSinceLastDecision < this.DEBOUNCE_MS) {
            console.log(`[MarblesGame] ${this.channelId}: Debounced - last decision was ${timeSinceLastDecision}ms ago (debounce: ${this.DEBOUNCE_MS}ms)`);
            return false;
        }
        
        // Try to acquire lock - if already locked, another decision is in progress
        if (this.decisionLock) {
            console.log(`[MarblesGame] ${this.channelId}: Decision already in progress, skipping`);
            return false;
        }
        
        // Acquire lock
        this.decisionLock = true;
        this.lastDecisionTime = now;
        
        try {
            // NOW check cooldown (inside the lock)
            if (this.state === 'cooldown') {
                const cooldownRemaining = this.marblesHeuristicsManager.getCooldownRemainingMs(this.channelId, this.baseHeuristics);
                if (cooldownRemaining > 0) {
                    console.log(`[MarblesGame] ${this.channelId}: In cooldown (${Math.round(cooldownRemaining / 1000)}s remaining) - skipping`);
                    return false;
                }
            }
            
            // Evaluate decision
            const decision = this.decisionEngine.evaluate(this.channelId, this.baseHeuristics);
            
            console.log(`[MarblesGame] ${this.channelId}: Initial decision:`, {
                shouldSend: decision.shouldSend,
                confidence: decision.confidence.toFixed(2),
                reason: decision.reason,
                requiresVisual: decision.requiresVisualInspection,
                mandatory: decision.visualInspectionMandatory,
            });
            
            // If decision requires visual inspection, perform it
            if (decision.requiresVisualInspection && this.visualAIService) {
                const visualResult = await this.performVisualInspection();
                
                // Re-evaluate with visual result
                const finalDecision = this.decisionEngine.evaluate(
                    this.channelId,
                    this.baseHeuristics,
                    visualResult
                );
                
                console.log(`[MarblesGame] ${this.channelId}: Final decision after visual:`, {
                    shouldSend: finalDecision.shouldSend,
                    reason: finalDecision.reason,
                });
                
                if (finalDecision.shouldSend) {
                    // Double-check we're still not in cooldown (in case another decision happened during visual inspection)
                    if (this.state === 'cooldown') {
                        console.log(`[MarblesGame] ${this.channelId}: State changed to cooldown during visual inspection, aborting`);
                        return false;
                    }
                    await this.sendPlayCommand();
                    return true;
                }
                
                return false;
            }
            
            // Decision didn't require visual inspection
            if (decision.shouldSend) {
                await this.sendPlayCommand();
                return true;
            }
            
            return false;
        } finally {
            // Always release lock
            this.decisionLock = false;
        }
    }
    
    // ============================================
    // SEND PLAY COMMAND
    // ============================================
    
    private async sendPlayCommand(): Promise<void> {
        console.log(`[MarblesGame] ${this.channelId}: SENDING !play command`);
        
        // Record that we sent it
        this.marblesHeuristicsManager.recordSentPlay(this.channelId, this.baseHeuristics);
        this.baseHeuristicsManager.recordMyJoin(this.channelId);
        
        // Record game start for heuristics
        this.baseHeuristicsManager.recordGameStart(this.channelId);
        
        // Enter cooldown state
        this.enterCooldown();
        
        // Send the message
        try {
            await this.sendMessage('!play');
            console.log(`[MarblesGame] ${this.channelId}: !play sent successfully`);
        } catch (error) {
            console.error(`[MarblesGame] ${this.channelId}: Failed to send !play:`, error);
        }
    }
    
    // ============================================
    // VISUAL INSPECTION
    // ============================================
    
    private async performVisualInspection(): Promise<{ isInGame: boolean; isPreGameLobby: boolean }> {
        console.log(`[MarblesGame] ${this.channelId}: Performing visual inspection...`);
        
        // Check cache first
        const cached = this.marblesHeuristicsManager.getScreenshotCache(this.channelId, this.baseHeuristics);
        if (cached) {
            console.log(`[MarblesGame] ${this.channelId}: Using cached screenshot result`);
            return {
                isInGame: cached.isInGame,
                isPreGameLobby: cached.isPreGameLobby,
            };
        }
        
        if (!this.visualAIService) {
            console.warn(`[MarblesGame] ${this.channelId}: No Visual AI service available`);
            return { isInGame: false, isPreGameLobby: false };
        }
        
        // Wait for capture delay
        await this.sleep(MARBLES_CONFIG.CAPTURE_DELAY_SECONDS);
        
        try {
            // Capture screenshot
            const screenshot = await this.captureScreenshot();
            
            if (!screenshot || screenshot.length < 100) {
                console.warn(`[MarblesGame] ${this.channelId}: Invalid screenshot received`);
                return { isInGame: false, isPreGameLobby: false };
            }
            
            // Analyze with AI
            const analysis = await this.visualAIService.analyzeScreenshot(screenshot, this.channelId);
            
            const result = {
                isInGame: analysis.isInGame && analysis.confidence >= MARBLES_CONFIG.MIN_AI_CONFIDENCE,
                isPreGameLobby: analysis.isInGame && !analysis.gameHasStarted && analysis.confidence >= MARBLES_CONFIG.MIN_AI_CONFIDENCE,
            };
            
            // Record and cache the result
            this.marblesHeuristicsManager.recordVisualInspection(this.channelId, this.baseHeuristics, {
                isInGame: result.isInGame,
                isPreGameLobby: result.isPreGameLobby,
                timestamp: Date.now(),
            });
            
            // Update game state in visual AI
            this.visualAIService.handleGameStateTransition(this.channelId, analysis);
            
            console.log(`[MarblesGame] ${this.channelId}: Visual inspection complete:`, {
                isInGame: result.isInGame,
                isPreGameLobby: result.isPreGameLobby,
                confidence: analysis.confidence.toFixed(2),
            });
            
            return result;
            
        } catch (error) {
            console.error(`[MarblesGame] ${this.channelId}: Visual inspection failed:`, error);
            return { isInGame: false, isPreGameLobby: false };
        }
    }
    
    // ============================================
    // BACKGROUND TASKS
    // ============================================
    
    private startHeuristicsCollection(): void {
        this.heuristicsInterval = setInterval(() => {
            // Recalculate rate periodically
            this.marblesHeuristicsManager.calculateCurrentRate(this.channelId, this.baseHeuristics);
            
            // Update base heuristics with our data
            this.syncHeuristics();
            
        }, MARBLES_CONFIG.RATE_CALCULATION_INTERVAL_MS);
        
        console.log(`[MarblesGame] ${this.channelId}: Started heuristics collection`);
    }
    
    private startExitCheck(): void {
        this.exitCheckInterval = setInterval(() => {
            this.checkGameExit();
        }, MARBLES_CONFIG.RATE_CALCULATION_INTERVAL_MS);
        
        console.log(`[MarblesGame] ${this.channelId}: Started exit check monitoring`);
    }
    
    private checkGameExit(): void {
        // Only check if we're in collecting state (not cooldown)
        if (this.state === 'cooldown') {
            // In cooldown - check if we should exit cooldown
            const exitCheck = this.marblesHeuristicsManager.shouldExitGame(this.channelId, this.baseHeuristics);
            
            if (!exitCheck.shouldExit) {
                // Rate is increasing - stay in cooldown
                const trend = this.marblesHeuristicsManager.getRateTrend(this.channelId, this.baseHeuristics);
                if (trend === 'increasing') {
                    console.log(`[MarblesGame] ${this.channelId}: Rate increasing during cooldown - staying in cooldown`);
                }
            }
            
            return;
        }
        
        if (this.state !== 'collecting') {
            return;
        }
        
        // Check if game has ended
        const exitCheck = this.marblesHeuristicsManager.shouldExitGame(this.channelId, this.baseHeuristics);
        
        if (exitCheck.shouldExit) {
            console.log(`[MarblesGame] ${this.channelId}: Exit condition met - ${exitCheck.reason}`);
            this.enterCheckingExit();
        }
    }
    
    // ============================================
    // STATE MANAGEMENT
    // ============================================
    
    private enterCooldown(): void {
        this.state = 'cooldown';
        console.log(`[MarblesGame] ${this.channelId}: Entered COOLDOWN state`);
    }
    
    private enterCheckingExit(): void {
        this.state = 'checking_exit';
        console.log(`[MarblesGame] ${this.channelId}: Entered CHECKING_EXIT state - performing final visual check`);
        
        // Perform visual inspection to confirm game ended
        this.performVisualInspection().then(result => {
            if (!result.isInGame && !result.isPreGameLobby) {
                console.log(`[MarblesGame] ${this.channelId}: Visual check confirms no game - ending`);
                this.endGame();
            } else {
                console.log(`[MarblesGame] ${this.channelId}: Visual check shows game still active - continuing`);
                this.state = 'collecting';
            }
        }).catch(error => {
            console.error(`[MarblesGame] ${this.channelId}: Error during exit visual check:`, error);
            // Default to ending if we can't verify
            this.endGame();
        });
    }
    
    private endGame(): void {
        this.state = 'ended';
        console.log(`[MarblesGame] ${this.channelId}: Game ENDED`);
        this.logState();
    }
    
    // ============================================
    // HEURISTICS SYNC
    // ============================================
    
    private syncHeuristics(): void {
        // Sync our marbles-specific data with base heuristics
        const currentRate = this.marblesState.currentRate;
        
        // Update base heuristics player count based on our tracking
        if (this.marblesState.totalPlayCommandsSeen > 0) {
            this.baseHeuristics.lastKnownPlayerCount = this.marblesState.uniqueUsersSeen.size;
        }
    }
    
    // ============================================
    // UTILITY
    // ============================================
    
    private sleep(seconds: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
    
    private logState(): void {
        const summary = this.marblesHeuristicsManager.getSummary(this.channelId, this.baseHeuristics);
        console.log(`[MarblesGame] ${this.channelId}: Current state:`, summary);
    }
    
    // ============================================
    // PUBLIC API
    // ============================================
    
    getState(): GameState {
        return this.state;
    }
    
    isEnded(): boolean {
        return this.state === 'ended';
    }
    
    getSummary(): object {
        return {
            channelId: this.channelId,
            state: this.state,
            ...this.marblesHeuristicsManager.getSummary(this.channelId, this.baseHeuristics),
        };
    }
    
    /**
     * Destroy the game instance and clean up resources
     */
    destroy(): void {
        console.log(`[MarblesGame] ${this.channelId}: Destroying game instance`);
        
        // Stop intervals
        if (this.heuristicsInterval) {
            clearInterval(this.heuristicsInterval);
            this.heuristicsInterval = null;
        }
        
        if (this.exitCheckInterval) {
            clearInterval(this.exitCheckInterval);
            this.exitCheckInterval = null;
        }
        
        // Save state
        this.marblesHeuristicsManager.saveState(this.channelId);
        this.baseHeuristicsManager.saveHeuristics(this.channelId);
        
        console.log(`[MarblesGame] ${this.channelId}: Game instance destroyed`);
    }
}

// ============================================
// MARBLES GAME MANAGER
// ============================================

export class MarblesGameManager {
    private games: Map<string, MarblesGame> = new Map();
    private baseHeuristicsManager: HeuristicsManager;
    private marblesHeuristicsManager: MarblesHeuristicsManager;
    private visualAIService: VisualAIService | null;
    private captureScreenshot: (channel: string) => Promise<string>;
    private cleanupInterval: NodeJS.Timeout | null = null;
    
    constructor(
        baseHeuristicsManager: HeuristicsManager,
        marblesHeuristicsManager: MarblesHeuristicsManager,
        visualAIService: VisualAIService | null,
        captureScreenshot: (channel: string) => Promise<string>
    ) {
        this.baseHeuristicsManager = baseHeuristicsManager;
        this.marblesHeuristicsManager = marblesHeuristicsManager;
        this.visualAIService = visualAIService;
        this.captureScreenshot = captureScreenshot;
        
        // Start cleanup of ended games
        this.startCleanupTask();
    }
    
    /**
     * Get or create a MarblesGame for a channel
     */
    getOrCreateGame(channelId: string, sendMessage: SendFunction): MarblesGame {
        let game = this.games.get(channelId);
        
        if (!game || game.isEnded()) {
            // Create new game instance
            game = new MarblesGame(
                channelId,
                this.baseHeuristicsManager,
                this.marblesHeuristicsManager,
                this.visualAIService,
                () => this.captureScreenshot(channelId),
                sendMessage
            );
            
            this.games.set(channelId, game);
            console.log(`[MarblesGameManager] Created new game for ${channelId}`);
        }
        
        return game;
    }
    
    /**
     * Process a !play command for a channel
     */
    async processPlayCommand(
        channelId: string,
        username: string,
        sendMessage: SendFunction
    ): Promise<boolean> {
        const game = this.getOrCreateGame(channelId, sendMessage);
        return game.processPlayCommand(username);
    }
    
    /**
     * Get game summary for a channel
     */
    getGameSummary(channelId: string): object | null {
        const game = this.games.get(channelId);
        if (!game) return null;
        return game.getSummary();
    }
    
    /**
     * Get all active games
     */
    getAllGames(): Map<string, MarblesGame> {
        return this.games;
    }
    
    private startCleanupTask(): void {
        // Clean up ended games every minute
        this.cleanupInterval = setInterval(() => {
            for (const [channelId, game] of this.games) {
                if (game.isEnded()) {
                    console.log(`[MarblesGameManager] Cleaning up ended game for ${channelId}`);
                    game.destroy();
                    this.games.delete(channelId);
                }
            }
        }, 60000);
    }
    
    /**
     * Shutdown and cleanup all games
     */
    shutdown(): void {
        console.log('[MarblesGameManager] Shutting down...');
        
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        
        // Destroy all games
        for (const [channelId, game] of this.games) {
            console.log(`[MarblesGameManager] Destroying game for ${channelId}`);
            game.destroy();
        }
        
        this.games.clear();
        console.log('[MarblesGameManager] Shutdown complete');
    }
}
