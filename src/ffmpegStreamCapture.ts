import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import Anthropic from '@anthropic-ai/sdk';

const exec = util.promisify(require('child_process').exec);

export interface StreamCaptureOptions {
  quality?: number;
  maxRetries?: number;
  retryDelay?: number;
  saveToDisk?: boolean;
  screenshotsDir?: string;
  maxScreenshotsPerChannel?: number;
  skipPreparingCheck?: boolean;
}

interface ChannelTiming {
  currentSkipTime: number; // seconds to skip into stream
  minSkipTime: number;
  maxSkipTime: number;
  successfulCaptures: number;
  preparingCaptures: number;
  totalAttempts: number;
  lastSuccessfulSkipTime: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export class FFmpegStreamCapture {
  private defaultScreenshotsDir: string;
  private savedScreenshots: Map<string, string[]> = new Map();
  private channelProcesses: Map<string, any> = new Map();
  private anthropicClient: Anthropic | null = null;
  private channelTimings: Map<string, ChannelTiming> = new Map();
  private readonly INITIAL_SKIP_TIME = 15; // Start with 15 seconds for live streams
  private readonly MAX_SKIP_TIME = 30; // Max 30 seconds
  private readonly MIN_SKIP_TIME = 5; // Min 5 seconds
  private readonly ADJUSTMENT_STEP = 3; // Adjust by 3 seconds at a time
  private readonly FRAME_INTERVAL = 3; // Capture frame every 3 seconds while checking
  private readonly MAX_PREPARING_CHECKS = 10; // Max times to check for preparing screen

  constructor(screenshotsDir: string = './screenshots') {
    this.defaultScreenshotsDir = screenshotsDir;
    this.ensureScreenshotsDirExists();
    
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropicClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
    
    this.loadTimingData();
  }

  private getTimingFilePath(): string {
    return path.join(this.defaultScreenshotsDir, '.timing_data.json');
  }

  private loadTimingData(): void {
    const filePath = this.getTimingFilePath();
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        for (const [channel, timing] of Object.entries(data)) {
          this.channelTimings.set(channel, timing as ChannelTiming);
        }
        console.log(`[FFmpegStreamCapture] Loaded timing data for ${this.channelTimings.size} channels`);
      } catch (e) {
        console.warn('[FFmpegStreamCapture] Failed to load timing data');
      }
    }
  }

  saveTimingData(): void {
    const filePath = this.getTimingFilePath();
    const data: Record<string, ChannelTiming> = {};
    for (const [channel, timing] of this.channelTimings.entries()) {
      data[channel] = timing;
    }
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn('[FFmpegStreamCapture] Failed to save timing data');
    }
  }

  private getOrCreateTiming(channelName: string): ChannelTiming {
    if (!this.channelTimings.has(channelName)) {
      this.channelTimings.set(channelName, {
        currentSkipTime: this.INITIAL_SKIP_TIME,
        minSkipTime: this.MIN_SKIP_TIME,
        maxSkipTime: this.MAX_SKIP_TIME,
        successfulCaptures: 0,
        preparingCaptures: 0,
        totalAttempts: 0,
        lastSuccessfulSkipTime: this.INITIAL_SKIP_TIME,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      });
    }
    return this.channelTimings.get(channelName)!;
  }

  private adjustTiming(channelName: string, wasPreparing: boolean): void {
    const timing = this.getOrCreateTiming(channelName);
    timing.totalAttempts++;
    
    if (wasPreparing) {
      // We got a preparing screen - need to wait longer
      timing.preparingCaptures++;
      timing.consecutiveFailures++;
      timing.consecutiveSuccesses = 0;
      
      // Increase skip time
      const oldSkipTime = timing.currentSkipTime;
      timing.currentSkipTime = Math.min(
        timing.currentSkipTime + this.ADJUSTMENT_STEP,
        timing.maxSkipTime
      );
      
      console.log(`[FFmpegStreamCapture] ${channelName}: Preparing screen detected. Adjusting skip time: ${oldSkipTime}s -> ${timing.currentSkipTime}s (failure #${timing.consecutiveFailures})`);
      
      // If we've failed many times in a row, consider increasing more aggressively
      if (timing.consecutiveFailures >= 3) {
        const extraAdjustment = Math.floor(timing.consecutiveFailures / 3) * 2;
        timing.currentSkipTime = Math.min(
          timing.currentSkipTime + extraAdjustment,
          timing.maxSkipTime
        );
        console.log(`[FFmpegStreamCapture] ${channelName}: Multiple consecutive failures, extra adjustment applied: ${timing.currentSkipTime}s`);
      }
    } else {
      // Success - we got actual content
      timing.successfulCaptures++;
      timing.lastSuccessfulSkipTime = timing.currentSkipTime;
      timing.consecutiveSuccesses++;
      timing.consecutiveFailures = 0;
      
      // If we've had multiple consecutive successes, we might be waiting too long
      // Try to optimize by reducing slightly
      if (timing.consecutiveSuccesses >= 5 && timing.currentSkipTime > timing.minSkipTime) {
        const oldSkipTime = timing.currentSkipTime;
        timing.currentSkipTime = Math.max(
          timing.currentSkipTime - 1, // Reduce by 1s
          timing.minSkipTime
        );
        console.log(`[FFmpegStreamCapture] ${channelName}: Multiple consecutive successes. Optimizing skip time: ${oldSkipTime}s -> ${timing.currentSkipTime}s`);
      }
      
      console.log(`[FFmpegStreamCapture] ${channelName}: Successful capture at ${timing.currentSkipTime}s (success rate: ${((timing.successfulCaptures / timing.totalAttempts) * 100).toFixed(1)}%)`);
    }
    
    // Save timing data periodically
    if (timing.totalAttempts % 10 === 0) {
      this.saveTimingData();
    }
  }

  getTimingStats(channelName: string): object {
    const timing = this.getOrCreateTiming(channelName);
    return {
      currentSkipTime: timing.currentSkipTime,
      successfulCaptures: timing.successfulCaptures,
      preparingCaptures: timing.preparingCaptures,
      totalAttempts: timing.totalAttempts,
      successRate: timing.totalAttempts > 0 ? (timing.successfulCaptures / timing.totalAttempts * 100).toFixed(1) + '%' : 'N/A',
      consecutiveFailures: timing.consecutiveFailures,
      consecutiveSuccesses: timing.consecutiveSuccesses,
    };
  }

  private ensureScreenshotsDirExists(): void {
    if (!fs.existsSync(this.defaultScreenshotsDir)) {
      fs.mkdirSync(this.defaultScreenshotsDir, { recursive: true });
      console.log(`[FFmpegStreamCapture] Created screenshots directory: ${this.defaultScreenshotsDir}`);
    }
  }

  private getChannelDir(channelName: string): string {
    const channelDir = path.join(this.defaultScreenshotsDir, channelName);
    if (!fs.existsSync(channelDir)) {
      fs.mkdirSync(channelDir, { recursive: true });
    }
    return channelDir;
  }

  async captureFrame(channelName: string, options: StreamCaptureOptions = {}): Promise<string> {
    const maxRetries = options.maxRetries || 10;
    const timing = this.getOrCreateTiming(channelName);
    
    console.log(`[FFmpegStreamCapture] Starting frame capture for ${channelName} (max ${maxRetries} retries, initial skip: ${timing.currentSkipTime}s)`);
    
    // Get stream URL
    const streamUrl = await this.getTwitchStreamUrl(channelName);
    if (!streamUrl) {
      throw new Error(`Could not get stream URL for ${channelName}`);
    }
    
    // Try capturing with current timing settings
    for (let retryAttempt = 0; retryAttempt < maxRetries; retryAttempt++) {
      try {
        // Capture multiple frames from the same stream connection
        const result = await this.captureFramesWithRetry(
          channelName, 
          streamUrl, 
          options.quality || 2, 
          timing.currentSkipTime
        );
        
        if (result.success) {
          // Good frame captured
          this.adjustTiming(channelName, false);
          console.log(`[FFmpegStreamCapture] ${channelName}: Successfully captured valid frame after ${retryAttempt + 1} attempt(s)`);
          
          // Save and return
          return this.saveAndReturnFrame(channelName, result.framePath, options);
        } else {
          // Got preparing screen - adjust timing for next attempt
          this.adjustTiming(channelName, true);
          console.log(`[FFmpegStreamCapture] ${channelName}: All frames showed preparing screen, adjusting timing to ${timing.currentSkipTime}s for retry ${retryAttempt + 1}/${maxRetries}`);
        }
        
      } catch (error) {
        console.error(`[FFmpegStreamCapture] ${channelName}: Capture attempt ${retryAttempt + 1} failed:`, error);
        
        if (retryAttempt < maxRetries - 1) {
          console.log(`[FFmpegStreamCapture] ${channelName}: Retrying with adjusted timing...`);
          // Wait a bit before retry
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    throw new Error(`Failed to capture valid frame for ${channelName} after ${maxRetries} attempts`);
  }

  private async captureFramesWithRetry(
    channelName: string, 
    streamUrl: string, 
    quality: number, 
    skipTime: number
  ): Promise<{ success: boolean; framePath: string }> {
    const channelDir = this.getChannelDir(channelName);
    const baseTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Create output pattern for multiple frames
    const outputPattern = path.join(channelDir, `${channelName}_${baseTimestamp}_frame_%03d.png`);
    
    console.log(`[FFmpegStreamCapture] ${channelName}: Opening stream connection and capturing frames every ${this.FRAME_INTERVAL}s (skip: ${skipTime}s)...`);
    
    return new Promise((resolve, reject) => {
      // Convert seconds to HH:MM:SS format for FFmpeg
      const hours = Math.floor(skipTime / 3600);
      const minutes = Math.floor((skipTime % 3600) / 60);
      const seconds = Math.floor(skipTime % 60);
      const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      
      // FFmpeg args to capture frames at intervals while keeping stream open
      const args = [
        '-ss', timeString,
        '-i', streamUrl,
        '-vf', `fps=1/${this.FRAME_INTERVAL}`, // Output 1 frame every FRAME_INTERVAL seconds
        '-q:v', quality.toString(),
        '-an',
        '-y',
        '-timeout', '30000000', // 30 seconds in microseconds
        '-rw_timeout', '30000000',
        outputPattern,
      ];

      console.log(`[FFmpegStreamCapture] ${channelName}: Running FFmpeg with continuous frame capture...`);

      const ffmpeg = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      let frameIndex = 0;
      let checkInterval: NodeJS.Timeout | null = null;
      let timeout: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        // Kill FFmpeg process
        try {
          ffmpeg.kill('SIGTERM');
        } catch (e) {
          // Process might already be dead
        }
      };

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        // Check if frames are being output
        const frameMatch = stderr.match(/frame=\s*(\d+)/);
        if (frameMatch) {
          const newFrameIndex = parseInt(frameMatch[1]);
          if (newFrameIndex > frameIndex) {
            frameIndex = newFrameIndex;
          }
        }
      });

      // Start checking for frames after initial delay
      setTimeout(() => {
        let checkCount = 0;
        const maxChecks = this.MAX_PREPARING_CHECKS;
        
        checkInterval = setInterval(async () => {
          checkCount++;
          
          // Look for the most recent frame file
          const expectedFramePath = outputPattern.replace('%03d', String(checkCount).padStart(3, '0'));
          
          if (fs.existsSync(expectedFramePath)) {
            console.log(`[FFmpegStreamCapture] ${channelName}: Frame ${checkCount} captured, checking for preparing screen...`);
            
            // Read and check if preparing
            const buffer = fs.readFileSync(expectedFramePath);
            const base64 = buffer.toString('base64');
            
            if (this.anthropicClient) {
              try {
                const isPreparing = await this.isPreparingScreen(base64, channelName);
                
                if (!isPreparing) {
                  // Found a good frame!
                  console.log(`[FFmpegStreamCapture] ${channelName}: Frame ${checkCount} is valid (not preparing)`);
                  cleanup();
                  resolve({ success: true, framePath: expectedFramePath });
                  return;
                } else {
                  console.log(`[FFmpegStreamCapture] ${channelName}: Frame ${checkCount} shows preparing screen, waiting for next frame...`);
                }
              } catch (error) {
                console.error(`[FFmpegStreamCapture] ${channelName}: Error checking frame ${checkCount}:`, error);
              }
            } else {
              // No anthropic client, assume frame is good
              cleanup();
              resolve({ success: true, framePath: expectedFramePath });
              return;
            }
          }
          
          // Check if we've exceeded max checks
          if (checkCount >= maxChecks) {
            console.log(`[FFmpegStreamCapture] ${channelName}: Exceeded max preparing checks (${maxChecks}), all frames showed preparing screen`);
            cleanup();
            resolve({ success: false, framePath: '' });
            return;
          }
        }, this.FRAME_INTERVAL * 1000 + 500); // Check every frame interval + small buffer
        
      }, skipTime * 1000 + 2000); // Wait for skip time + buffer before checking

      // Overall timeout
      timeout = setTimeout(() => {
        console.warn(`[FFmpegStreamCapture] ${channelName}: Overall timeout reached`);
        cleanup();
        reject(new Error('FFmpeg capture timeout'));
      }, 60000); // 60 second overall timeout

      ffmpeg.on('close', (code) => {
        // If FFmpeg closes unexpectedly
        if (checkInterval) {
          console.warn(`[FFmpegStreamCapture] ${channelName}: FFmpeg closed unexpectedly with code ${code}`);
          cleanup();
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        cleanup();
        reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
      });
    });
  }

  private async saveAndReturnFrame(
    channelName: string, 
    framePath: string, 
    options: StreamCaptureOptions
  ): Promise<string> {
    // Read the frame
    const buffer = fs.readFileSync(framePath);
    const base64 = buffer.toString('base64');

    // Track saved screenshot
    if (!this.savedScreenshots.has(channelName)) {
      this.savedScreenshots.set(channelName, []);
    }
    this.savedScreenshots.get(channelName)!.push(framePath);

    // Cleanup old screenshots
    const maxScreenshots = options.maxScreenshotsPerChannel || 50;
    await this.cleanupOldScreenshots(channelName, maxScreenshots);

    return base64;
  }

  private async isPreparingScreen(base64Screenshot: string, channelName: string): Promise<boolean> {
    if (!this.anthropicClient) {
      console.warn(`[FFmpegStreamCapture] ${channelName}: No Anthropic client, skipping preparing check`);
      return false;
    }

    try {
      console.log(`[FFmpegStreamCapture] ${channelName}: Checking if frame shows "preparing" screen...`);
      
      const response = await this.anthropicClient.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
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
                text: `Quickly analyze this screenshot. Is this a "preparing your stream", "loading", "buffering", or similar startup/waiting screen? 

Only respond with one word: "YES" if it's a preparing/loading screen, or "NO" if it shows actual stream content or gameplay.`,
              },
            ],
          },
        ],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const answer = content.text.trim().toUpperCase();
        const isPreparing = answer.includes('YES');
        
        console.log(`[FFmpegStreamCapture] ${channelName}: Preparing check result: ${isPreparing ? 'YES (preparing screen)' : 'NO (valid content)'}`);
        return isPreparing;
      }

      return false;
    } catch (error) {
      console.error(`[FFmpegStreamCapture] ${channelName}: Error checking preparing screen:`, error);
      return false;
    }
  }

  private async getTwitchStreamUrl(channelName: string): Promise<string | null> {
    try {
      const { stdout } = await exec(`streamlink --stream-url https://www.twitch.tv/${channelName} best 2>/dev/null || echo ""`, {
        timeout: 15000,
      });
      const url = stdout.trim();
      if (url && url.startsWith('http')) {
        console.log(`[FFmpegStreamCapture] Got stream URL via streamlink for ${channelName}`);
        return url;
      }
    } catch (e) {}

    try {
      const { stdout } = await exec(`yt-dlp -g https://www.twitch.tv/${channelName} 2>/dev/null || echo ""`, {
        timeout: 15000,
      });
      const url = stdout.trim();
      if (url && url.startsWith('http')) {
        console.log(`[FFmpegStreamCapture] Got stream URL via yt-dlp for ${channelName}`);
        return url;
      }
    } catch (e) {}

    console.warn(`[FFmpegStreamCapture] Could not get stream URL for ${channelName}`);
    return null;
  }

  private async cleanupOldScreenshots(channelName: string, maxScreenshots: number): Promise<void> {
    const screenshots = this.savedScreenshots.get(channelName) || [];
    
    if (screenshots.length > maxScreenshots) {
      const sortedScreenshots = screenshots
        .map(filepath => ({
          path: filepath,
          mtime: fs.statSync(filepath).mtime.getTime(),
        }))
        .sort((a, b) => a.mtime - b.mtime);

      const toDelete = sortedScreenshots.slice(0, screenshots.length - maxScreenshots);
      
      for (const file of toDelete) {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {}
      }

      const remaining = sortedScreenshots
        .slice(screenshots.length - maxScreenshots)
        .map(f => f.path);
      this.savedScreenshots.set(channelName, remaining);
    }
  }

  getSavedScreenshots(channelName?: string): string[] | Map<string, string[]> {
    if (channelName) {
      return this.savedScreenshots.get(channelName) || [];
    }
    return this.savedScreenshots;
  }

  async closeAll(): Promise<void> {
    // Kill any running FFmpeg processes
    for (const [channel, process] of this.channelProcesses) {
      try {
        process.kill('SIGTERM');
        console.log(`[FFmpegStreamCapture] Killed FFmpeg process for ${channel}`);
      } catch (e) {
        // Process might already be dead
      }
    }
    this.channelProcesses.clear();
    this.saveTimingData();
    console.log('[FFmpegStreamCapture] All captures closed');
  }

  static async checkDependencies(): Promise<{ ffmpeg: boolean; ytDlp: boolean; streamlink: boolean }> {
    const checks = {
      ffmpeg: false,
      ytDlp: false,
      streamlink: false,
    };

    try {
      await exec('ffmpeg -version');
      checks.ffmpeg = true;
    } catch (e) {
      console.warn('[FFmpegStreamCapture] FFmpeg not found');
    }

    try {
      await exec('yt-dlp --version');
      checks.ytDlp = true;
    } catch (e) {
      console.warn('[FFmpegStreamCapture] yt-dlp not found');
    }

    try {
      await exec('streamlink --version');
      checks.streamlink = true;
    } catch (e) {
      console.warn('[FFmpegStreamCapture] streamlink not found');
    }

    return checks;
  }
}
