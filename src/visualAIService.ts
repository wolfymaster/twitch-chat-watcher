import Anthropic from '@anthropic-ai/sdk';
import { GameStateManager, GameState } from './gameState';
import { HeuristicsManager } from './heuristics';

export interface GameAnalysisResult {
  isInGame: boolean;
  gameType?: string;
  confidence: number;
  textElements: string[];
  timestamp: number;
  gameHasStarted: boolean;
}

export interface VisualAIConfig {
  apiKey?: string;
  screenshotInterval?: number;
  activityThreshold?: number;
  cooldownPeriod?: number;
  minGameDuration?: number;
  minTimeBetweenScreenshots?: number;
  base64Screenshot?: string;
}

export class VisualAIService {
  private client: Anthropic;
  private gameStateManager: GameStateManager;
  private config: VisualAIConfig;
  private channelIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastScreenshotTime: Map<string, number> = new Map();
  private screenshotCount: Map<string, number> = new Map();
  private apiCallCount: Map<string, number> = new Map();

  constructor(config: VisualAIConfig = {}) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || '',
    });
    this.gameStateManager = new GameStateManager();
    
    console.log('[VisualAIService] Initialized with config:', {
      screenshotInterval: config.screenshotInterval || 60000,
      activityThreshold: config.activityThreshold || 5,
      cooldownPeriod: config.cooldownPeriod || 180000,
      minGameDuration: config.minGameDuration || 120000,
      minTimeBetweenScreenshots: config.minTimeBetweenScreenshots || 45000,
    });
  }

  private logState(channelId: string, context: string): void {
    const state = this.gameStateManager.getOrCreateChannelState(channelId);
    const now = Date.now();
    const timeSinceLastScreenshot = now - (this.lastScreenshotTime.get(channelId) || 0);
    const screenshotCount = this.screenshotCount.get(channelId) || 0;
    const apiCalls = this.apiCallCount.get(channelId) || 0;
    
    console.log(`[${channelId}] ${context}`, {
      currentState: state.currentState,
      lastActivity: new Date(state.lastActivityTimestamp).toISOString(),
      lastScreenshot: new Date(state.lastScreenshotTimestamp).toISOString(),
      lastPlayCommand: new Date(state.lastPlayCommandTimestamp).toISOString(),
      consecutiveGames: state.consecutiveGamesCount,
      timeSinceLastScreenshot: `${Math.round(timeSinceLastScreenshot / 1000)}s`,
      totalScreenshots: screenshotCount,
      totalApiCalls: apiCalls,
    });
  }

  async analyzeScreenshot(base64Screenshot: string, channelId: string, maxRetries: number = 3): Promise<GameAnalysisResult> {
    // Check for empty or invalid screenshot
    if (!base64Screenshot || base64Screenshot.length < 100) {
      console.warn(`[${channelId}] Empty or invalid screenshot provided (${base64Screenshot?.length || 0} chars), skipping analysis`);
      return {
        isInGame: false,
        confidence: 0,
        textElements: [],
        timestamp: Date.now(),
        gameHasStarted: false,
      };
    }

    // Increment screenshot count
    const currentCount = (this.screenshotCount.get(channelId) || 0) + 1;
    this.screenshotCount.set(channelId, currentCount);
    this.lastScreenshotTime.set(channelId, Date.now());
    
    console.log(`[${channelId}] Starting Anthropic API analysis (screenshot #${currentCount}, size: ${Math.round(base64Screenshot.length / 1024)}KB)`);
    this.logState(channelId, 'Pre-analysis state');

    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Increment API call count
        const apiCalls = (this.apiCallCount.get(channelId) || 0) + 1;
        this.apiCallCount.set(channelId, apiCalls);
        
        console.log(`[${channelId}] Calling Anthropic API (attempt ${attempt}/${maxRetries}, total API calls: ${apiCalls})`);
        const startTime = Date.now();
        
        const response = await this.client.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: base64Screenshot,
                  },
                },
                {
                  type: 'text',
                  text: `Analyze this Twitch stream screenshot carefully. Determine:
1. Is a game currently being played or about to start? Look for game UI elements, scoreboards, timers, or gameplay action.
2. What is the confidence level (0-1)? Be conservative - only high confidence if you clearly see game elements.
3. What text elements are visible that indicate a game state? Look for text like "GAME", "PLAY", "SCORE", "WIN", "ROUND", etc.
4. Does this appear to be the start of a new game vs in-game action? New games often show lobby screens, countdown timers, or "START" buttons.

Provide a JSON response in this exact format:
{
  "isInGame": boolean,
  "confidence": number,
  "textElements": ["text1", "text2"],
  "gameHasStarted": boolean
}`,
                },
              ],
            },
          ],
        });

        const apiCallDuration = Date.now() - startTime;
        console.log(`[${channelId}] Anthropic API call completed in ${apiCallDuration}ms`);

        // Parse the response
        const content = response.content[0];
        if (content.type === 'text') {
          try {
            // Try to extract JSON from the response (Claude might wrap it in markdown)
            const text = content.text;
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : text;
            const parsed = JSON.parse(jsonStr);
            
            const result = {
              isInGame: parsed.isInGame || false,
              gameType: parsed.gameType,
              confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
              textElements: Array.isArray(parsed.textElements) ? parsed.textElements : [],
              timestamp: Date.now(),
              gameHasStarted: parsed.gameHasStarted || false,
            };
            
            console.log(`[${channelId}] Anthropic API analysis successful on attempt ${attempt}:`, {
              isInGame: result.isInGame,
              confidence: result.confidence,
              gameHasStarted: result.gameHasStarted,
              textElements: result.textElements,
              apiCallDuration: `${apiCallDuration}ms`,
            });
            
            // Store the result for later reference
            this.lastAnalysisResults.set(channelId, result);
            
            return result;
          } catch (e) {
            console.error(`[${channelId}] Failed to parse AI response:`, content.text);
            return {
              isInGame: false,
              confidence: 0,
              textElements: [],
              timestamp: Date.now(),
              gameHasStarted: false,
            };
          }
        }

        return {
          isInGame: false,
          confidence: 0,
          textElements: [],
          timestamp: Date.now(),
          gameHasStarted: false,
        };
      } catch (error) {
        lastError = error;
        console.error(`[${channelId}] Error analyzing screenshot with Claude (attempt ${attempt}/${maxRetries}):`, error);
        
        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`[${channelId}] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    console.error(`[${channelId}] All retry attempts failed for Anthropic API call`);
    return {
      isInGame: false,
      confidence: 0,
      textElements: [],
      timestamp: Date.now(),
      gameHasStarted: false,
    };
  }

  private shouldCaptureScreenshot(channelId: string): boolean {
    const now = Date.now();
    const lastCapture = this.lastScreenshotTime.get(channelId) || 0;
    const minTimeBetween = this.config.minTimeBetweenScreenshots || 45000; // 45 seconds default
    const timeSinceLastCapture = now - lastCapture;
    
    const state = this.gameStateManager.getOrCreateChannelState(channelId);
    
    // Log the decision factors
    console.log(`[${channelId}] Screenshot decision check:`, {
      timeSinceLastCapture: `${Math.round(timeSinceLastCapture / 1000)}s`,
      minTimeRequired: `${Math.round(minTimeBetween / 1000)}s`,
      currentState: state.currentState,
      canCapture: timeSinceLastCapture >= minTimeBetween,
    });
    
    return timeSinceLastCapture >= minTimeBetween;
  }

  startPeriodicScreenshotAnalysis(channelId: string, screenshotProvider: () => Promise<string>) {
    // Clear existing interval for this channel if any
    this.stopPeriodicScreenshotAnalysis(channelId);
    
    const interval = this.config.screenshotInterval || 60000; // Default to 60 seconds
    
    console.log(`[${channelId}] Starting periodic screenshot analysis (interval: ${interval}ms, ${Math.round(interval / 1000)}s)`);
    this.logState(channelId, 'Initial state');
    
    const intervalId = setInterval(async () => {
      try {
        // Check if enough time has passed since last screenshot
        if (!this.shouldCaptureScreenshot(channelId)) {
          console.log(`[${channelId}] Skipping periodic screenshot - too soon since last capture`);
          return;
        }
        
        console.log(`[${channelId}] Capturing periodic screenshot...`);
        const base64Screenshot = await screenshotProvider();
        
        // Only analyze if we got a valid screenshot
        if (base64Screenshot && base64Screenshot.length > 100) {
          const analysis = await this.analyzeScreenshot(base64Screenshot, channelId);
          this.handleGameStateTransition(channelId, analysis);
        } else {
          console.warn(`[${channelId}] Invalid screenshot received (${base64Screenshot?.length || 0} chars)`);
        }
      } catch (error) {
        console.error(`[${channelId}] Error in periodic screenshot analysis:`, error);
      }
    }, interval);
    
    this.channelIntervals.set(channelId, intervalId);
  }

  stopPeriodicScreenshotAnalysis(channelId?: string) {
    if (channelId) {
      // Stop specific channel
      const intervalId = this.channelIntervals.get(channelId);
      if (intervalId) {
        clearInterval(intervalId);
        this.channelIntervals.delete(channelId);
        console.log(`[${channelId}] Stopped periodic screenshot analysis`);
        console.log(`[${channelId}] Final stats:`, {
          totalScreenshots: this.screenshotCount.get(channelId) || 0,
          totalApiCalls: this.apiCallCount.get(channelId) || 0,
        });
      }
    } else {
      // Stop all channels
      console.log('Stopping all periodic screenshot analysis');
      for (const [channel, intervalId] of this.channelIntervals) {
        clearInterval(intervalId);
        console.log(`[${channel}] Stopped. Final stats:`, {
          totalScreenshots: this.screenshotCount.get(channel) || 0,
          totalApiCalls: this.apiCallCount.get(channel) || 0,
        });
      }
      this.channelIntervals.clear();
    }
  }

  private isPreGameLobbyState(analysis: GameAnalysisResult): boolean {
    // Check for pre-game lobby indicators
    const preGameKeywords = [
      'waiting', 'lobby', 'starting', 'countdown', 'prepare',
      'waiting to start', 'game setup', 'queue', 'matchmaking'
    ];
    
    const hasPreGameText = analysis.textElements.some(text => 
      preGameKeywords.some(keyword => text.toLowerCase().includes(keyword))
    );
    
    // Consider it a pre-game lobby if:
    // 1. Claude says isInGame is true but gameHasStarted is false
    // 2. OR confidence is high and we see pre-game keywords
    return (analysis.isInGame && !analysis.gameHasStarted && analysis.confidence > 0.6) ||
           (analysis.confidence > 0.7 && hasPreGameText);
  }

  handleGameStateTransition(channelId: string, analysis: GameAnalysisResult) {
    const state = this.gameStateManager.getOrCreateChannelState(channelId);
    const now = Date.now();
    const isLobby = this.isPreGameLobbyState(analysis);
    
    console.log(`[${channelId}] Processing state transition with analysis:`, {
      isInGame: analysis.isInGame,
      confidence: analysis.confidence,
      gameHasStarted: analysis.gameHasStarted,
      textElements: analysis.textElements,
      isPreGameLobby: isLobby,
      currentState: state.currentState,
    });
    
    switch (state.currentState) {
      case 'idle':
        // Detect new game starting (including lobby/waiting states)
        if (analysis.isInGame && analysis.confidence > 0.7 && (analysis.gameHasStarted || isLobby)) {
          console.log(`[${channelId}] STATE TRANSITION: idle -> playing (${isLobby ? 'lobby detected' : 'game started'})`);
          this.gameStateManager.updateState(channelId, 'playing');
          this.gameStateManager.recordScreenshot(channelId);
          this.logState(channelId, 'Post-transition state (idle->playing)');
        } else {
          console.log(`[${channelId}] Remaining in idle state (game not detected or confidence too low)`);
        }
        break;
        
      case 'playing':
        // Verify still in game or detect game ended
        if (!analysis.isInGame && analysis.confidence > 0.7) {
          console.log(`[${channelId}] STATE TRANSITION: playing -> ended (game no longer detected)`);
          this.gameStateManager.updateState(channelId, 'ended');
          this.gameStateManager.resetGameCount(channelId);
          this.logState(channelId, 'Post-transition state (playing->ended)');
        } else if (analysis.isInGame) {
          // Still playing, increment counter
          this.gameStateManager.incrementGameCount(channelId);
          this.gameStateManager.recordScreenshot(channelId);
          console.log(`[${channelId}] Still in playing state (consecutive games: ${state.consecutiveGamesCount + 1})`);
        } else {
          console.log(`[${channelId}] Unclear game state - confidence too low to transition (confidence: ${analysis.confidence})`);
        }
        break;
        
      case 'ended':
        // Check if enough time has passed to consider as idle again
        const minGameDuration = this.config.minGameDuration || 120000;
        const timeSinceLastGame = now - state.lastPlayCommandTimestamp;
        
        console.log(`[${channelId}] In ended state - time since last game: ${Math.round(timeSinceLastGame / 1000)}s, min required: ${Math.round(minGameDuration / 1000)}s`);
        
        if (timeSinceLastGame > minGameDuration && analysis.isInGame && (analysis.gameHasStarted || isLobby)) {
          console.log(`[${channelId}] STATE TRANSITION: ended -> playing (${isLobby ? 'lobby detected after cooldown' : 'game detected after cooldown'})`);
          this.gameStateManager.updateState(channelId, 'playing');
          this.gameStateManager.recordScreenshot(channelId);
          this.logState(channelId, 'Post-transition state (ended->playing)');
        } else if (timeSinceLastGame > minGameDuration && !analysis.isInGame) {
          console.log(`[${channelId}] STATE TRANSITION: ended -> idle (no game detected after cooldown)`);
          this.gameStateManager.updateState(channelId, 'idle');
          this.logState(channelId, 'Post-transition state (ended->idle)');
        } else {
          console.log(`[${channelId}] Remaining in ended state (cooldown not complete or no new game)`);
        }
        break;
    }
  }

  private lastAnalysisResults: Map<string, GameAnalysisResult> = new Map();

  shouldSendPlayCommand(channelId: string): boolean {
    const state = this.gameStateManager.getOrCreateChannelState(channelId);
    const cooldownPeriod = this.config.cooldownPeriod || 180000;
    const inCooldown = this.gameStateManager.isInCooldownPeriod(channelId, cooldownPeriod);
    const lastAnalysis = this.lastAnalysisResults.get(channelId);
    const isInLobby = lastAnalysis ? this.isPreGameLobbyState(lastAnalysis) : false;
    const timeSinceLastPlay = state.lastPlayCommandTimestamp > 0 
      ? Date.now() - state.lastPlayCommandTimestamp 
      : null;
    const timeSinceLastPlayStr = timeSinceLastPlay 
      ? `${Math.round(timeSinceLastPlay / 1000)}s` 
      : 'never';
    
    // Decision breakdown
    const isPlaying = state.currentState === 'playing';
    const cooldownRemaining = inCooldown && timeSinceLastPlay 
      ? `${Math.round((cooldownPeriod - timeSinceLastPlay) / 1000)}s` 
      : '0s';
    
    // Allow sending if:
    // 1. We're in 'playing' state (which now includes lobby/waiting states)
    // 2. OR we're in cooldown but the last analysis showed a lobby state
    const condition1 = isPlaying && !inCooldown;
    const condition2 = isInLobby && !inCooldown;
    const shouldSend = condition1 || condition2;
    
    console.log(`[${channelId}] shouldSendPlayCommand check:`, {
      decision: shouldSend ? 'SEND' : 'BLOCK',
      reason: shouldSend 
        ? (condition1 ? 'In playing state and not in cooldown' : 'In lobby and not in cooldown')
        : inCooldown 
          ? `In cooldown (${cooldownRemaining} remaining)` 
          : 'Not in playing state and not in lobby',
      currentState: state.currentState,
      isInCooldown: inCooldown,
      cooldownRemaining: cooldownRemaining,
      isInLobby: isInLobby,
      isPlaying: isPlaying,
      timeSinceLastPlay: timeSinceLastPlayStr,
    });
    
    return shouldSend;
  }

  isInPreGameLobby(channelId: string): boolean {
    const lastAnalysis = this.lastAnalysisResults.get(channelId);
    if (!lastAnalysis) return false;
    return this.isPreGameLobbyState(lastAnalysis);
  }

  getGameState(channelId: string): GameState {
    return this.gameStateManager.getOrCreateChannelState(channelId).currentState;
  }

  recordPlayCommand(channelId: string): void {
    console.log(`[${channelId}] Recording play command`);
    this.gameStateManager.recordPlayCommand(channelId);
    this.logState(channelId, 'After recording play command');
  }

  getStats(channelId: string): object {
    return {
      totalScreenshots: this.screenshotCount.get(channelId) || 0,
      totalApiCalls: this.apiCallCount.get(channelId) || 0,
      lastScreenshotTime: this.lastScreenshotTime.get(channelId) || 0,
    };
  }
}