export interface Command {
    action: string;
    command: string;
    response: CommandResponse;
    /** Optional matcher. When set, the parsed command token is tested against
     * this regex instead of being exact-compared to `action`. */
    match?: RegExp;
};

export type ChatWatcherFunction = (msg: string, user: string, channel: string, send: (msg: string) => Promise<void>) => Promise<void>

export type CommandResponse = string | ((msg: string, user: string, channel: string, send: (msg: string) => Promise<void>) => Promise<string>)

export class Commands {
    commands: Command[] = [];
    watchers: ChatWatcherFunction[] = [];

    constructor() {}

    add(command: string, response: CommandResponse, match?: RegExp) {
        const cmd = this.commands.find(cmd => cmd.command === command);

        if(cmd) {
            cmd.response = response;
            if(match) {
                cmd.match = match;
            }
            return;
        }

        this.commands.push({
            action: `!${command}`,
            command,
            response,
            match,
        });
    }

    every(cb: ChatWatcherFunction) {
        this.watchers.push(cb);
    }

    async process(text: string, user: string, channel: string, send: (msg: string) => Promise<void>): Promise<[string, boolean]> {
        const chatMsg = text.trim();

        this.watchers.forEach(w => this.try(() => w(chatMsg, user, channel, send)));

        for(let i = 0; i < this.commands.length; ++i) {
            const { action, response, match } = this.commands[i];
            if(!text.length || text[0] != '!') {
                return ['', false];
            }

            let msg = this.parseAction(text);

            const hit = match ? match.test(msg.cmd) : msg.cmd === action;

            if(hit) {
                if(typeof response === 'string') {
                    return [response, true];
                }
                if(typeof response === 'function') {
                    const res = await response(msg.text, user.trim(), channel, send);
                    return [res, true];
                }
            }
        }
        return ['', false];
    }

    parseAction(text: string) {
        const spaceidx = text.indexOf(' ');
        if(spaceidx === -1) {
            return {
                cmd: text.trim().toLowerCase(),
                text: '',
            }
        } 

        return {
            cmd: text.slice(0, spaceidx).trim().toLowerCase(),
            text: text.slice(spaceidx + 1).trim(),
        };
    }

    try(f: any) {
        try {
            f();
        } catch(err) {}
    }
}
