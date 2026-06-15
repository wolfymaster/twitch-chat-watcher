/**
 * Ollama vision adapter — the DEFAULT provider for "Detect Marbles Session".
 *
 * Talks to a self-hosted Ollama server (`/api/chat`) with a vision model
 * (default `llama3.2-vision`). Uses `format: 'json'` to coax strict JSON, then
 * validates into a `Session`. Never throws — returns a `stopped` session on
 * failure so the Game Manager can carry on.
 */

import type { Session, OllamaVisionConfig } from '../types';
import type { VisionProvider } from './visionProvider';
import { SESSION_PROMPT, parseSession, stoppedSession } from './visionProvider';

const REQUEST_TIMEOUT_MS = 60000;
const MAX_RETRIES = 2;

export class OllamaVisionProvider implements VisionProvider {
    readonly name = 'ollama';
    private readonly chatUrl: string;
    private readonly model: string;

    constructor(config: OllamaVisionConfig) {
        this.chatUrl = `${config.host.replace(/\/$/, '')}/api/chat`;
        this.model = config.model;
    }

    /** Lightweight reachability probe used by the factory at startup. */
    static async ping(host: string): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`, {
                signal: controller.signal,
            });
            clearTimeout(timer);
            return res.ok;
        } catch {
            return false;
        }
    }

    async detectSession(base64Image: string, channel: string): Promise<Session> {
        if (!base64Image || base64Image.length < 100) {
            console.warn(`[${channel}] [ollama] Empty/invalid screenshot, returning stopped session`);
            return stoppedSession();
        }

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            try {
                const start = Date.now();
                const res = await fetch(this.chatUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        model: this.model,
                        stream: false,
                        format: 'json',
                        messages: [
                            {
                                role: 'user',
                                content: SESSION_PROMPT,
                                images: [base64Image],
                            },
                        ],
                    }),
                });
                clearTimeout(timer);

                if (!res.ok) {
                    throw new Error(`Ollama responded ${res.status} ${res.statusText}`);
                }

                const data: any = await res.json();
                const content: string = data?.message?.content ?? '';
                const session = parseSession(content);
                console.log(
                    `[${channel}] [ollama] Detected session in ${Date.now() - start}ms:`,
                    { state: session.state, evidence: session.evidence, location: session.game_location },
                );
                return session;
            } catch (err) {
                clearTimeout(timer);
                console.error(`[${channel}] [ollama] detect attempt ${attempt}/${MAX_RETRIES} failed:`, err);
                if (attempt < MAX_RETRIES) {
                    await new Promise((r) => setTimeout(r, 1000 * attempt));
                }
            }
        }

        console.error(`[${channel}] [ollama] All attempts failed — returning stopped session`);
        return stoppedSession();
    }
}
