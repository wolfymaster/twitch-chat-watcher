/**
 * Vision provider abstraction for the diagram's "Detect Marbles Session" step.
 *
 * A provider takes a base64 PNG of the stream and returns a structured
 * `Session`. Two implementations exist — a self-hosted Ollama adapter (default)
 * and the Anthropic Claude adapter (fallback) — so the model backend is
 * swappable via config without touching the detection flow.
 */

import type { Session, SessionState, GameLocation, SessionEvidence } from '../types';

export interface VisionProvider {
    /** Stable identifier, used in logs/config (e.g. 'ollama', 'claude'). */
    readonly name: string;
    /**
     * Analyze a screenshot and return the detected session. Implementations
     * should never throw on a bad model response — return a safe `stopped`
     * session instead (see `stoppedSession`).
     */
    detectSession(base64Image: string, channel: string): Promise<Session>;
}

/** The single instruction both providers send the model, kept identical so
 * results are comparable across backends. */
export const SESSION_PROMPT = `You are analyzing a single frame from a Twitch stream that may be running the "Marbles on Stream" game. Decide whether a marbles game session is present and what state it is in.

Definitions:
- "ready": a pre-game lobby is shown — viewers can join now (e.g. a "!play" call-to-action, a join/lobby screen, or a visible countdown before the race starts).
- "running": the marbles race is actively in progress (marbles rolling down a track/course).
- "stopped": no marbles game is visible (just-chatting, a different game, desktop, etc.).

Look for this evidence:
- play_present: the literal text "Play" or "!play" (a call to join) is visible.
- countdown_present: a countdown/lobby UI (numbers ticking down, "starting in", join bar) is visible.
- time_present: a timer/clock element is visible.

Also report game_location: where the marbles game UI sits in the frame — one of "top_right", "top_left", "bottom_right", "bottom_left", or "fullscreen". Use "fullscreen" if it fills the frame or you cannot localize it.

Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "state": "ready" | "running" | "stopped",
  "evidence": {
    "play_present": boolean,
    "countdown_present": boolean,
    "time_present": boolean
  },
  "game_location": "top_right" | "top_left" | "bottom_right" | "bottom_left" | "fullscreen"
}`;

const VALID_STATES: SessionState[] = ['ready', 'running', 'stopped'];
const VALID_LOCATIONS: GameLocation[] = [
    'top_right',
    'top_left',
    'bottom_right',
    'bottom_left',
    'fullscreen',
];

/** A safe default when detection fails or the model returns garbage. */
export function stoppedSession(): Session {
    return {
        state: 'stopped',
        evidence: { play_present: false, countdown_present: false, time_present: false },
        game_location: 'fullscreen',
    };
}

/**
 * Extract and validate a `Session` from raw model text. Tolerates markdown
 * fences and surrounding prose by grabbing the first JSON object. Returns a
 * `stopped` session if parsing/validation fails.
 */
export function parseSession(text: string): Session {
    try {
        const match = text.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(match ? match[0] : text);

        const state: SessionState = VALID_STATES.includes(parsed.state) ? parsed.state : 'stopped';
        const ev = parsed.evidence ?? {};
        const evidence: SessionEvidence = {
            play_present: !!ev.play_present,
            countdown_present: !!ev.countdown_present,
            time_present: !!ev.time_present,
        };
        const game_location: GameLocation = VALID_LOCATIONS.includes(parsed.game_location)
            ? parsed.game_location
            : 'fullscreen';

        return { state, evidence, game_location };
    } catch {
        return stoppedSession();
    }
}
