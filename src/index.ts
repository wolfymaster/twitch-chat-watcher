import * as dotenv from 'dotenv';
import * as path from 'path';
import TwitchBootstrap from './twitchBootstrap';
import { Commands } from './commands';
import { Subject } from 'rxjs';
import { throttleTime } from 'rxjs/operators';

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

const commander = new Commands();
const subjectMap = new Map();

function sleep(seconds: number) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Imporovments - 
 *  - If the user has already !play then consider it as if the bot had done it
 *  - How to figure out the emote drop people use instead of !play
 */

function getOrCreateSubject(command: string, channel: string, timeout?: number) {
    const key = `${command}-${channel}`;

    if (!subjectMap.has(key)) {
        const subject = new Subject<{ msg: string, send: (msg: string) => Promise<void> }>();

        // Set up throttling for this specific pair
        const throttled = subject.pipe(
            throttleTime(timeout || THREE_MINUTES)
        );

        throttled.subscribe((obj: { msg: string, send: (msg: string) => Promise<void> }) => {
            const sleepTime = Math.floor((Math.random() * 10));
            console.log(`sleeping for: ${sleepTime} seconds`);
            sleep(1 + sleepTime) // add artificial jitter
            .then(() => obj.send(obj.msg));
        });

        subjectMap.set(key, subject);
    }

    return subjectMap.get(key);
}

// bootstrap twitch auth provider
const channels = ['cyburdial', 'tinktv', 'gingrbredbeauty', 'sreme'];
for(const channel of channels) {
    await TwitchBootstrap(channel, commander, {
        databaseURL: process.env.DATABASE_PROXY_URL || "",
    });
}

const THREE_MINUTES = 180000;
const TWELVE_HOURS = 43200000;

// commands
commander.add('play', async (msg: string, user: string, channel: string, send: (msg: string) => Promise<void>) => {
    getOrCreateSubject('play', channel, THREE_MINUTES).next({
        msg: '!play',
        send
    });
    return '';
});

commander.add('join', async (msg: string, user: string, channel: string, send: (msg: string) => Promise<void>) => {
    getOrCreateSubject('join', channel, THREE_MINUTES).next({
        msg: '!join',
        send
    });
    return '';
});

commander.every(async (msg: string, user: string, channel: string, send: (msg: string) => Promise<void>) => {
    if (channel.toLowerCase() === 'novarockafeller' && user.toLowerCase() === 'sery_bot' && msg.toLowerCase() === 'sery_bot is here seryboarrive') {
        getOrCreateSubject('serybot', channel, TWELVE_HOURS).next({
            msg: 'NOVAAAAAA',
            send
        });
    }

    if (channel.toLowerCase() === 'closureclub' && user.toLowerCase() === 'theclosureclub' && msg.toLowerCase().startsWith('!go')) {
        getOrCreateSubject('go', channel, TWELVE_HOURS).next({
            msg: '!first',
            send
        })
    }

    if (channel.toLowerCase() === 'kayla_shay_' && user.toLowerCase() === 'streamelements' && msg.toLowerCase().startsWith('kayla_shay_ is now live!')) {
        getOrCreateSubject('greeting', channel, TWELVE_HOURS).next({
            msg: 'KAYLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            send
        });
    }
});
