import * as fs from 'fs';
import * as path from 'path';

export interface ChannelHeuristics {
  channelId: string;
  
  // Screenshot efficiency metrics
  totalScreenshots: number;
  preparingScreenshots: number;
  successfulScreenshots: number;
  avgCaptureTimeMs: number;
  lastCaptureTimeMs: number;
  
  // Time between games
  gameStartTimestamps: number[];
  avgTimeBetweenGamesMs: number;
  minTimeBetweenGamesMs: number;
  maxTimeBetweenGamesMs: number;
  
  // Player joining patterns
  playerCountsPerGame: number[];
  avgPlayerCount: number;
  minPlayerCount: number;
  maxPlayerCount: number;
  lastKnownPlayerCount: number;
  
  // Join timing patterns
  gameJoinTimestamps: number[];
  myJoinTimestamp: number | null;
  
  // Confidence scores
  timePredictionConfidence: number; // 0-1
  playerCountConfidence: number; // 0-1
  
  // Last updated
  lastUpdated: number;
}

export interface HeuristicPrediction {
  shouldSendPlay: boolean;
  confidence: number;
  reason: string;
  predictedTimeToGame: number | null;
  predictedPlayerCount: number | null;
}

export class HeuristicsManager {
  private heuristics: Map<string, ChannelHeuristics> = new Map();
  private memoryDir: string;
  private saveInterval: NodeJS.Timeout | null = null;
  private recentPlayerJoins: Map<string, number[]> = new Map(); // Track recent joins per channel

  constructor(memoryDir: string = './memory') {
    this.memoryDir = memoryDir;
    this.ensureMemoryDirExists();
    this.loadAllHeuristics();
    this.startPeriodicSave();
  }

  private ensureMemoryDirExists(): void {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
      console.log(`[HeuristicsManager] Created memory directory: ${this.memoryDir}`);
    }
  }

  private getMemoryFilePath(channelId: string): string {
    return path.join(this.memoryDir, `${channelId}_heuristics.json`);
  }

  private loadAllHeuristics(): void {
    try {
      const files = fs.readdirSync(this.memoryDir);
      const heuristicsFiles = files.filter(f => f.endsWith('_heuristics.json'));
      
      console.log(`[HeuristicsManager] Found ${heuristicsFiles.length} memory files to load`);
      
      for (const file of heuristicsFiles) {
        const channelId = file.replace('_heuristics.json', '');
        this.loadHeuristics(channelId);
      }
    } catch (error) {
      console.log('[HeuristicsManager] No existing memory files found or error loading:', error);
    }
  }

  private loadHeuristics(channelId: string): void {
    const filePath = this.getMemoryFilePath(channelId);
    
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const heuristics: ChannelHeuristics = JSON.parse(data);
      
      // Validate and fix any missing arrays
      if (!heuristics.gameStartTimestamps) heuristics.gameStartTimestamps = [];
      if (!heuristics.playerCountsPerGame) heuristics.playerCountsPerGame = [];
      if (!heuristics.gameJoinTimestamps) heuristics.gameJoinTimestamps = [];
      
      this.heuristics.set(channelId, heuristics);
      console.log(`[HeuristicsManager] Loaded heuristics for ${channelId}:`, {
        totalScreenshots: heuristics.totalScreenshots || 0,
        avgTimeBetweenGames: Math.round((heuristics.avgTimeBetweenGamesMs || 0) / 1000),
        avgPlayerCount: heuristics.avgPlayerCount || 0,
        gamesRecorded: heuristics.gameStartTimestamps?.length || 0,
      });
    } catch (error) {
      console.error(`[HeuristicsManager] Error loading heuristics for ${channelId}:`, error);
    }
  }

  saveHeuristics(channelId: string): void {
    const heuristics = this.getOrCreateHeuristics(channelId);
    const filePath = this.getMemoryFilePath(channelId);
    
    try {
      fs.writeFileSync(filePath, JSON.stringify(heuristics, null, 2));
    } catch (error) {
      console.error(`[HeuristicsManager] Error saving heuristics for ${channelId}:`, error);
    }
  }

  saveAllHeuristics(): void {
    console.log(`[HeuristicsManager] Saving all heuristics (${this.heuristics.size} channels)...`);
    for (const channelId of this.heuristics.keys()) {
      this.saveHeuristics(channelId);
    }
  }

  private startPeriodicSave(): void {
    // Save every 5 minutes
    this.saveInterval = setInterval(() => {
      this.saveAllHeuristics();
    }, 300000);
  }

  stopPeriodicSave(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
  }

  getOrCreateHeuristics(channelId: string): ChannelHeuristics {
    if (!this.heuristics.has(channelId)) {
      const newHeuristics: ChannelHeuristics = {
        channelId,
        totalScreenshots: 0,
        preparingScreenshots: 0,
        successfulScreenshots: 0,
        avgCaptureTimeMs: 0,
        lastCaptureTimeMs: 0,
        gameStartTimestamps: [],
        avgTimeBetweenGamesMs: 300000, // Default: 5 minutes
        minTimeBetweenGamesMs: 120000, // Default: 2 minutes
        maxTimeBetweenGamesMs: 600000, // Default: 10 minutes
        playerCountsPerGame: [],
        avgPlayerCount: 50, // Default assumption
        minPlayerCount: 20,
        maxPlayerCount: 100,
        lastKnownPlayerCount: 0,
        gameJoinTimestamps: [],
        myJoinTimestamp: null,
        timePredictionConfidence: 0,
        playerCountConfidence: 0,
        lastUpdated: Date.now(),
      };
      this.heuristics.set(channelId, newHeuristics);
    }
    return this.heuristics.get(channelId)!;
  }

  // Record screenshot metrics
  recordScreenshotAttempt(channelId: string, wasPreparing: boolean, captureTimeMs: number): void {
    const h = this.getOrCreateHeuristics(channelId);
    h.totalScreenshots++;
    h.lastCaptureTimeMs = captureTimeMs;
    
    if (wasPreparing) {
      h.preparingScreenshots++;
    } else {
      h.successfulScreenshots++;
    }
    
    // Update average capture time
    if (h.avgCaptureTimeMs === 0) {
      h.avgCaptureTimeMs = captureTimeMs;
    } else {
      h.avgCaptureTimeMs = (h.avgCaptureTimeMs * 0.9) + (captureTimeMs * 0.1); // Exponential moving average
    }
    
    h.lastUpdated = Date.now();
    
    console.log(`[HeuristicsManager] ${channelId}: Screenshot recorded. Total: ${h.totalScreenshots}, Preparing: ${h.preparingScreenshots}, Success rate: ${((h.successfulScreenshots / h.totalScreenshots) * 100).toFixed(1)}%`);
  }

  // Record a game start
  recordGameStart(channelId: string): void {
    const h = this.getOrCreateHeuristics(channelId);
    const now = Date.now();
    
    h.gameStartTimestamps.push(now);
    
    // Keep only last 20 game starts
    if (h.gameStartTimestamps.length > 20) {
      h.gameStartTimestamps = h.gameStartTimestamps.slice(-20);
    }
    
    // Calculate time between games
    if (h.gameStartTimestamps.length >= 2) {
      let totalGap = 0;
      let minGap = Infinity;
      let maxGap = 0;
      
      for (let i = 1; i < h.gameStartTimestamps.length; i++) {
        const gap = h.gameStartTimestamps[i] - h.gameStartTimestamps[i - 1];
        totalGap += gap;
        minGap = Math.min(minGap, gap);
        maxGap = Math.max(maxGap, gap);
      }
      
      h.avgTimeBetweenGamesMs = totalGap / (h.gameStartTimestamps.length - 1);
      h.minTimeBetweenGamesMs = minGap;
      h.maxTimeBetweenGamesMs = maxGap;
      
      // Increase confidence as we get more data
      h.timePredictionConfidence = Math.min(0.95, h.gameStartTimestamps.length / 10);
    }
    
    // Reset player count tracking for new game
    h.lastKnownPlayerCount = 0;
    h.gameJoinTimestamps = [];
    h.myJoinTimestamp = null;
    
    h.lastUpdated = Date.now();
    
    console.log(`[HeuristicsManager] ${channelId}: Game start recorded. Avg time between games: ${Math.round(h.avgTimeBetweenGamesMs / 1000)}s, Confidence: ${(h.timePredictionConfidence * 100).toFixed(0)}%`);
  }

  // Record player joining (detected from chat)
  recordPlayerJoin(channelId: string, fromChatMessage: boolean = true): void {
    const h = this.getOrCreateHeuristics(channelId);
    const now = Date.now();
    
    if (fromChatMessage) {
      h.gameJoinTimestamps.push(now);
      h.lastKnownPlayerCount = h.gameJoinTimestamps.length;
      
      // Keep only last 50 joins
      if (h.gameJoinTimestamps.length > 50) {
        h.gameJoinTimestamps = h.gameJoinTimestamps.slice(-50);
      }
      
      // Update player count statistics
      h.playerCountsPerGame.push(h.lastKnownPlayerCount);
      if (h.playerCountsPerGame.length > 20) {
        h.playerCountsPerGame = h.playerCountsPerGame.slice(-20);
      }
      
      // Calculate average player count
      const total = h.playerCountsPerGame.reduce((a, b) => a + b, 0);
      h.avgPlayerCount = Math.round(total / h.playerCountsPerGame.length);
      h.minPlayerCount = Math.min(...h.playerCountsPerGame);
      h.maxPlayerCount = Math.max(...h.playerCountsPerGame);
      
      h.playerCountConfidence = Math.min(0.95, h.playerCountsPerGame.length / 10);
      
      console.log(`[HeuristicsManager] ${channelId}: Player join recorded. Count: ${h.lastKnownPlayerCount}, Avg: ${h.avgPlayerCount}, Confidence: ${(h.playerCountConfidence * 100).toFixed(0)}%`);
    }
    
    h.lastUpdated = Date.now();
  }

  // Record that we joined the game
  recordMyJoin(channelId: string): void {
    const h = this.getOrCreateHeuristics(channelId);
    h.myJoinTimestamp = Date.now();
    h.lastUpdated = Date.now();
    console.log(`[HeuristicsManager] ${channelId}: Recorded that we joined the game`);
  }

  // Make a prediction about whether to send !play
  predictShouldSendPlay(channelId: string, timeSinceLastGame: number): HeuristicPrediction {
    const h = this.getOrCreateHeuristics(channelId);
    const now = Date.now();
    
    // If we don't have enough data, don't make predictions
    if (h.gameStartTimestamps.length < 3) {
      return {
        shouldSendPlay: false,
        confidence: 0,
        reason: 'Insufficient game data (need at least 3 games recorded)',
        predictedTimeToGame: null,
        predictedPlayerCount: null,
      };
    }
    
    // Calculate time prediction
    const expectedTimeBetweenGames = h.avgTimeBetweenGamesMs;
    const timeWindow = expectedTimeBetweenGames * 0.3; // 30% variance allowed
    const timeUntilExpected = expectedTimeBetweenGames - timeSinceLastGame;
    const timeConfidence = h.timePredictionConfidence;
    
    // Calculate player count prediction
    const expectedPlayerCount = h.avgPlayerCount;
    const currentPlayerCount = h.lastKnownPlayerCount;
    const playerCountProgress = currentPlayerCount / expectedPlayerCount;
    const playerConfidence = h.playerCountConfidence;
    
    // Combined prediction
    let shouldSend = false;
    let confidence = 0;
    let reason = '';
    
    // Case 1: We're in the expected time window and players are joining
    if (Math.abs(timeUntilExpected) < timeWindow && playerCountProgress > 0.5) {
      shouldSend = true;
      confidence = (timeConfidence + playerConfidence) / 2;
      reason = `Time window match (${Math.round(timeUntilExpected / 1000)}s from expected) and player progress (${Math.round(playerCountProgress * 100)}%)`;
    }
    // Case 2: Players are nearly at expected count
    else if (playerCountProgress > 0.8 && timeSinceLastGame > h.minTimeBetweenGamesMs) {
      shouldSend = true;
      confidence = playerConfidence * 0.9;
      reason = `High player count progress (${Math.round(playerCountProgress * 100)}%)`;
    }
    // Case 3: We're past the minimum time and seeing activity
    else if (timeSinceLastGame > h.minTimeBetweenGamesMs && currentPlayerCount > 5) {
      shouldSend = true;
      confidence = timeConfidence * 0.7;
      reason = `Past minimum time (${Math.round(timeSinceLastGame / 1000)}s) with activity`;
    }
    else {
      reason = `No match: timeUntilExpected=${Math.round(timeUntilExpected / 1000)}s, playerProgress=${Math.round(playerCountProgress * 100)}%`;
    }
    
    return {
      shouldSendPlay: shouldSend,
      confidence: confidence,
      reason: reason,
      predictedTimeToGame: timeUntilExpected > 0 ? timeUntilExpected : 0,
      predictedPlayerCount: expectedPlayerCount - currentPlayerCount,
    };
  }

  // Get a summary of heuristics for a channel
  getHeuristicSummary(channelId: string): object {
    const h = this.getOrCreateHeuristics(channelId);
    const successRate = h.totalScreenshots > 0 ? (h.successfulScreenshots / h.totalScreenshots) : 0;
    
    return {
      channelId,
      screenshotSuccessRate: `${(successRate * 100).toFixed(1)}%`,
      avgCaptureTime: `${Math.round(h.avgCaptureTimeMs / 1000)}s`,
      gamesRecorded: h.gameStartTimestamps.length,
      avgTimeBetweenGames: `${Math.round(h.avgTimeBetweenGamesMs / 1000)}s`,
      timePredictionConfidence: `${(h.timePredictionConfidence * 100).toFixed(0)}%`,
      avgPlayerCount: h.avgPlayerCount,
      playerCountConfidence: `${(h.playerCountConfidence * 100).toFixed(0)}%`,
      lastKnownPlayerCount: h.lastKnownPlayerCount,
    };
  }

  // Shutdown - save all data
  shutdown(): void {
    console.log('[HeuristicsManager] Shutting down and saving all heuristics...');
    this.stopPeriodicSave();
    this.saveAllHeuristics();
  }
}