/**
 * Selects the configured vision provider, with graceful fallback.
 *
 * Default is Ollama (self-hosted, cheap). If the configured provider is
 * unavailable at startup, fall back to the other one when possible:
 *   - ollama unreachable  -> Claude (if ANTHROPIC_API_KEY present)
 *   - claude unavailable  -> Ollama (if its server is reachable)
 *
 * If neither path is viable we still return the configured provider; it will
 * degrade to `stopped` sessions rather than crash the bot.
 */

import type { MarblesVisionConfig } from '../types';
import type { VisionProvider } from './visionProvider';
import { OllamaVisionProvider } from './ollamaVisionProvider';
import { ClaudeVisionProvider } from './claudeVisionProvider';

export async function createVisionProvider(config: MarblesVisionConfig): Promise<VisionProvider> {
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

    if (config.provider === 'claude') {
        if (hasAnthropicKey) {
            console.log('[Vision] Using Claude vision provider');
            return new ClaudeVisionProvider(process.env.ANTHROPIC_API_KEY);
        }
        if (await OllamaVisionProvider.ping(config.ollama.host)) {
            console.warn('[Vision] provider=claude but ANTHROPIC_API_KEY missing — falling back to Ollama');
            return new OllamaVisionProvider(config.ollama);
        }
        console.warn('[Vision] provider=claude but no API key and Ollama unreachable — sessions will be "stopped"');
        return new ClaudeVisionProvider(process.env.ANTHROPIC_API_KEY);
    }

    // Default: ollama
    if (await OllamaVisionProvider.ping(config.ollama.host)) {
        console.log(`[Vision] Using Ollama vision provider (${config.ollama.model} @ ${config.ollama.host})`);
        return new OllamaVisionProvider(config.ollama);
    }
    if (hasAnthropicKey) {
        console.warn(`[Vision] Ollama unreachable at ${config.ollama.host} — falling back to Claude`);
        return new ClaudeVisionProvider(process.env.ANTHROPIC_API_KEY);
    }
    console.warn(`[Vision] Ollama unreachable at ${config.ollama.host} and no ANTHROPIC_API_KEY — sessions will be "stopped"`);
    return new OllamaVisionProvider(config.ollama);
}
