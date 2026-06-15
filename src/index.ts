import * as dotenv from 'dotenv';
import * as path from 'path';
import TwitchBootstrap from './twitchBootstrap';
import { Commands } from './commands';
import { Subject } from 'rxjs';
import { throttleTime } from 'rxjs/operators';
import config from '../config.json';
import { FFmpegStreamCapture } from './ffmpegStreamCapture';
import { HeuristicsManager } from './heuristics';
import { MarblesHeuristicsManager } from './marblesHeuristics';
import { MarblesListener } from './marbles';
import type { MarblesConfig } from './marbles';

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

// ============================================
// INITIALIZATION
// ============================================

const commander = new Commands();
const subjectMap = new Map();
const streamCapture = new FFmpegStreamCapture('./screenshots');
const heuristicsManager = new HeuristicsManager('./memory');
const marblesHeuristicsManager = new MarblesHeuristicsManager('./memory');

const marblesConfig = config.marbles as unknown as MarblesConfig;

// Initialize the Marbles Listener (event filter chain + vision-based session
// detection). Vision provider is chosen from config (Ollama default, Claude
// fallback) inside init().
const marblesListener = new MarblesListener({
    heuristics: heuristicsManager,
    marblesHeuristics: marblesHeuristicsManager,
    config: marblesConfig,
    capture: (channel: string) => streamCapture.captureFrame(channel, { quality: 2 }),
});

await marblesListener.init();
console.log('[Main] Marbles Listener initialized');

const THREE_MINUTES = 180000;

function sleep(seconds: number) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

const lastGameEndTime: Map<string, number> = new Map();

function getOrCreateSubject(command: string, channel: string, timeout?: number) {
    const key = `${command}-${channel}`;

    if (!subjectMap.has(key)) {
        const subject = new Subject<{ msg: string, send: (msg: string) => Promise<void> }>();

        const throttled = subject.pipe(
            throttleTime(timeout || THREE_MINUTES)
        );

        throttled.subscribe((obj: { msg: string, send: (msg: string) => Promise<void> }) => {
            const sleepTime = Math.floor((Math.random() * 10));
            console.log(`[${channel}] sleeping for: ${sleepTime} seconds before sending command`);
            sleep(1 + sleepTime)
            .then(() => obj.send(obj.msg));
        });

        subjectMap.set(key, subject);
    }

    return subjectMap.get(key);
}

// ============================================
// DEPENDENCY CHECK
// ============================================

console.log('[Main] Checking FFmpeg dependencies...');
const deps = await FFmpegStreamCapture.checkDependencies();
console.log('[Main] Dependencies:', deps);

if (!deps.ffmpeg) {
    console.error('[Main] ERROR: FFmpeg is required but not installed!');
    process.exit(1);
}

// ============================================
// CHANNEL SETUP
// ============================================

console.log('[Main] Bootstrapping Twitch connections...');
for(const channel of config.channels) {
    console.log(`[Main] Connecting to channel: ${channel}`);
    await TwitchBootstrap(channel, commander, {
        databaseURL: process.env.DATABASE_PROXY_URL || "",
    });

    lastGameEndTime.set(channel, Date.now());
}

console.log(`[Main] Successfully connected to ${config.channels.length} channels`);

// ============================================
// COMMAND HANDLERS
// ============================================

// The Marbles Listener owns the !play family (!play, !play1, !play2, …); it
// registers its own matcher and routes through handlePlay. The throttled+jittered
// send stays here via getOrCreateSubject.
marblesListener.register(commander, (channel, send) => {
    getOrCreateSubject(`${channel}.${marblesConfig.play.command}`, channel, marblesConfig.play.cooldown).next({
        msg: marblesConfig.play.response,
        send,
    });
});

for(const command of config.commands) {
    commander.add(command.command, async (msg: string, user: string, channel: string, send: (msg: string) => Promise<void>) => {

        // Handle commands normally
        if ((command.channels.length == 1 && command.channels[0] === "*") || command.channels.includes(channel)) {
            getOrCreateSubject(`${channel}.${command.command}`, channel, command.cooldown).next({
                msg: command.response,
                send
            });
        }

        return '';
    });
}

// ============================================
// MESSAGE HANDLERS
// ============================================

for(const message of config.messages) {
    commander.every(async (msg: string, user: string, channel: string, send: (msg: string) => Promise<void>) => {
        if(channel.toLowerCase() !== message.channel.toLowerCase()) {
            return;
        }

        if(message.user && (user.toLowerCase() !== message.user.toLowerCase())) {
            return;
        }

        if(message.prefix && !msg.toLowerCase().startsWith(message.prefix)) {
            return;
        }

        getOrCreateSubject(`${channel}.${message.user}`, channel, message.cooldown).next({
            msg: message.response,
            send
        });
    });
}

// ============================================
// CLEANUP
// ============================================

process.on('SIGINT', async () => {
    console.log('\n[Main] Shutting down...');
    
    // Shutdown marbles listener
    marblesListener.shutdown();

    // Shutdown heuristics managers
    heuristicsManager.shutdown();
    marblesHeuristicsManager.shutdown();
    
    // Save timing data and close captures
    streamCapture.saveTimingData();
    await streamCapture.closeAll();
    
    console.log('[Main] Shutdown complete');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[Main] Shutting down...');
    
    // Shutdown marbles listener
    marblesListener.shutdown();

    // Shutdown heuristics managers
    heuristicsManager.shutdown();
    marblesHeuristicsManager.shutdown();
    
    // Save timing data and close captures
    streamCapture.saveTimingData();
    await streamCapture.closeAll();
    
    console.log('[Main] Shutdown complete');
    process.exit(0);
});

console.log('[Main] Bot is now running and monitoring for triggers');
