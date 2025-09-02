# Twitch Chat Watcher

A Twitch chat bot that monitors multiple channels and responds to commands and messages based on configurable rules.

## Features

- Monitor multiple Twitch channels simultaneously
- Respond to chat commands with customizable responses
- Set per-command cooldowns to prevent spam
- Target specific channels or use wildcard (`*`) for all channels
- Respond to messages from specific users with prefix matching
- Built with Bun for fast performance

## Prerequisites

- [Bun](https://bun.sh/) installed on your system
- Twitch Developer Application credentials

## Setup

### 1. Get Twitch API Credentials

1. Visit [dev.twitch.tv](https://dev.twitch.tv/)
2. Create a new application or use an existing one
3. Note down your:
   - Client ID
   - Client Secret
   - Redirect URL (can be `http://localhost:3000` for local development)
4. Generate a broadcaster token with the necessary scopes

### 2. Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
TWITCH_CLIENT_ID=your_client_id_here
TWITCH_CLIENT_SECRET=your_client_secret_here
TWITCH_REDIRECT_URL=your_redirect_url_here
TWITCH_BROADCASTER_TOKEN=your_broadcaster_token_here
```

### 3. Configuration

Create a `config.json` file in the root directory (see Configuration section below for details).

## Installation & Running

### Local Development

```bash
# Install dependencies
bun install

# Start the application
bun run src/index.ts
```

### Docker

```bash
# Pull and run the Docker image
docker run -d \
  --name twitch-watcher \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/.env:/app/.env \
  wolfymaster/twitch-watcher
```

## Configuration

The bot is configured using a `config.json` file with three main sections:

### Channels

List of Twitch channels to monitor:

```json
{
  "channels": [
    "cyburdial",
    "tinktv",
    "gingrbredbeauty",
    "sreme",
    "wolfymaster"
  ]
}
```

### Commands

Define chat commands that trigger bot responses:

```json
{
  "commands": [
    {
      "command": "join",
      "response": "!join",
      "cooldown": 180000,
      "channels": ["*"]
    },
    {
      "command": "play",
      "response": "!play",
      "cooldown": 180000,
      "channels": ["*"]
    },
    {
      "command": "specific_channel",
      "response": "Will only run on specified channels",
      "cooldown": 2000,
      "channels": ["wolfymaster"]
    }
  ]
}
```

**Command Properties:**
- `command`: The trigger word (without prefix like `!`)
- `response`: The message the bot will send
- `cooldown`: Time in milliseconds before the command can be used again
- `channels`: Array of channel names or `["*"]` for all channels

### Messages

Respond to messages from specific users with prefix matching:

```json
{
  "messages": [
    {
      "channel": "wolfymaster",
      "cooldown": 2000,
      "prefix": "message must start with this prefix",
      "response": "return response for message from specific user",
      "user": "wolfynovice"
    }
  ]
}
```

**Message Properties:**
- `channel`: Specific channel to monitor
- `cooldown`: Time in milliseconds before responding to the user again
- `prefix`: Required prefix for messages to trigger response
- `response`: The bot's response message
- `user`: Specific username to respond to

## Example Configuration

```json
{
  "channels": [
    "cyburdial",
    "tinktv",
    "gingrbredbeauty",
    "sreme",
    "wolfymaster"
  ],
  "commands": [
    {
      "command": "join",
      "response": "!join",
      "cooldown": 180000,
      "channels": ["*"]
    },
    {
      "command": "play",
      "response": "!play",
      "cooldown": 180000,
      "channels": ["*"]
    },
    {
      "command": "specific_channel",
      "response": "Will only run on specified channels",
      "cooldown": 2000,
      "channels": ["wolfymaster"]
    }
  ],
  "messages": [
    {
      "channel": "wolfymaster",
      "cooldown": 2000,
      "prefix": "message must start with this prefix",
      "response": "return response for message from specific user",
      "user": "wolfynovice"
    }
  ]
}
```

## Docker Hub

Pre-built Docker image available at: `wolfymaster/twitch-watcher`

## Contributing

Feel free to submit issues and pull requests to improve the bot.
