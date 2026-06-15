/**
 * Claude vision adapter — the FALLBACK provider for "Detect Marbles Session".
 *
 * Ports the Anthropic call from the legacy `visualAIService.ts`, but prompts for
 * the new `Session` schema instead of the old `GameAnalysisResult`. Retains the
 * retry + JSON-extraction behavior. Never throws — returns a `stopped` session
 * on failure.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Session } from '../types';
import type { VisionProvider } from './visionProvider';
import { SESSION_PROMPT, parseSession, stoppedSession } from './visionProvider';

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_RETRIES = 3;

export class ClaudeVisionProvider implements VisionProvider {
    readonly name = 'claude';
    private readonly client: Anthropic;

    constructor(apiKey?: string) {
        this.client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY || '' });
    }

    async detectSession(base64Image: string, channel: string): Promise<Session> {
        if (!base64Image || base64Image.length < 100) {
            console.warn(`[${channel}] [claude] Empty/invalid screenshot, returning stopped session`);
            return stoppedSession();
        }

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const start = Date.now();
                const response = await this.client.messages.create({
                    model: MODEL,
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
                                        data: base64Image,
                                    },
                                },
                                { type: 'text', text: SESSION_PROMPT },
                            ],
                        },
                    ],
                });

                const content = response.content[0];
                const text = content.type === 'text' ? content.text : '';
                const session = parseSession(text);
                console.log(
                    `[${channel}] [claude] Detected session in ${Date.now() - start}ms:`,
                    { state: session.state, evidence: session.evidence, location: session.game_location },
                );
                return session;
            } catch (err) {
                console.error(`[${channel}] [claude] detect attempt ${attempt}/${MAX_RETRIES} failed:`, err);
                if (attempt < MAX_RETRIES) {
                    await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
                }
            }
        }

        console.error(`[${channel}] [claude] All attempts failed — returning stopped session`);
        return stoppedSession();
    }
}
