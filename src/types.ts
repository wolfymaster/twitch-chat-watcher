export interface Configuration {
    channels: string[],
    commands: CommandConfig[],
    visualAI?: VisualAIConfig;
}

export interface CommandConfig {
    command: string;
    response: string;
    cooldown: number;
    channels: string[];
}

export interface ChannelMessage {
    channel: string;
    cooldown: number;
    user: string;
    prefix: string;
    response: string;
}

export interface VisualAIConfig {
    apiKey?: string;
    screenshotInterval?: number;
    activityThreshold?: number;
    cooldownPeriod?: number;
    minGameDuration?: number;
}
