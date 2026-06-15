/// <reference types="bun" />
/**
 * Command-router matching tests, focused on the regex matcher used for the
 * `!play` family. Run with `bun test`.
 */

import { test, expect, describe } from 'bun:test';
import { Commands } from './commands';

const noopSend = async () => {};
const PLAY = /^!play\d*$/i;

async function matched(c: Commands, text: string): Promise<boolean> {
    const [, hit] = await c.process(text, 'user', 'chan', noopSend);
    return hit;
}

function playRouter(): Commands {
    const c = new Commands();
    c.add('join', '!join'); // exact-match command, no matcher
    c.add('play', 'CANON', PLAY); // play family via regex
    return c;
}

describe('Commands regex matcher (play family)', () => {
    test('matches !play and numbered variants', async () => {
        const c = playRouter();
        for (const t of ['!play', '!play1', '!play2', '!play12', '!PLAY3']) {
            expect(await matched(c, t)).toBe(true);
        }
    });

    test('matches with trailing args', async () => {
        expect(await matched(playRouter(), '!play2 lets go')).toBe(true);
    });

    test('returns the canonical response, not the variant', async () => {
        const [msg, hit] = await playRouter().process('!play7', 'u', 'c', noopSend);
        expect(hit).toBe(true);
        expect(msg).toBe('CANON');
    });

    test('does not match look-alikes', async () => {
        const c = playRouter();
        for (const t of ['!players', '!play1x', '!plays', '!pla', '!playy']) {
            expect(await matched(c, t)).toBe(false);
        }
    });

    test('non-command text does not match', async () => {
        expect(await matched(playRouter(), 'play')).toBe(false);
        expect(await matched(playRouter(), 'hello !play')).toBe(false);
    });
});

describe('Commands exact match (unchanged)', () => {
    test('exact command still matches without a matcher', async () => {
        expect(await matched(playRouter(), '!join')).toBe(true);
    });

    test('exact command does not match numbered variant', async () => {
        expect(await matched(playRouter(), '!join1')).toBe(false);
    });
});

describe('add() with matcher', () => {
    test('updates response and matcher of an existing command in place', () => {
        const c = new Commands();
        c.add('play', 'A');
        c.add('play', 'B', PLAY);
        const cmd = c.commands.find((x) => x.command === 'play');
        expect(c.commands.filter((x) => x.command === 'play').length).toBe(1);
        expect(cmd?.response).toBe('B');
        expect(cmd?.match).toBe(PLAY);
    });
});
