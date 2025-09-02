export interface Configuration {
    channels: string[],
    commands: CommandConfig[],
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
