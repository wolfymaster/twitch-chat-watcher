import * as dotenv from 'dotenv';
import * as path from 'path';
import TwitchBootstrap from './twitchBootstrap';
import { Commands } from './commands';
import { Subject } from 'rxjs';
import { throttleTime } from 'rxjs/operators';
import config from '../config.json';

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

const commander = new Commands();
const subjectMap = new Map();

const THREE_MINUTES = 180000;

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
for(const channel of config.channels) {
    await TwitchBootstrap(channel, commander, {
        databaseURL: process.env.DATABASE_PROXY_URL || "",
    });
}

// interate over commands - only add each command once. Single commander shared across all channels
for(const command of config.commands) {
    commander.add(command.command, async (msg: string, user: string, channel: string, send: (msg: string) => Promise<void>) => {
        if((command.channels.length == 1 && command.channels[0] === "*") || command.channels.includes(channel)) {
            getOrCreateSubject(`${channel}.${command.command}`, channel, command.cooldown).next({
                msg: command.response,
                send
            });
        }
        return '';
    });
}

// iterate over messages
for(const message of config.messages) {
    commander.every(async (msg: string, user: string, channel: string, send: (msg: string) => Promise<void>) => {
        // verify correct channel
        if(channel.toLowerCase() !== message.channel.toLowerCase()) {
            return;
        }

        // verify correct user (if exists)
        if(message.user && (user.toLowerCase() !== message.user.toLowerCase())) {
            return;
        }

        // verify trigger message (if exists)
        if(message.prefix && !msg.toLowerCase().startsWith(message.prefix)) {
            return;
        }

        // should be good to send message
        getOrCreateSubject(`${channel}.${message.user}`, channel, message.cooldown).next({
            msg: message.response,
            send
        });
    });
}
