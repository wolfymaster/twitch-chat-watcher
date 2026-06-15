### Stream Capture for Visual AI

The bot uses **FFmpeg** to directly capture frames from Twitch streams, which is more efficient than browser-based screenshots:

**How it works:**
1. Uses `yt-dlp` or `streamlink` to get the direct stream URL
2. FFmpeg captures a single frame from the live stream
3. Frame is saved to disk and sent to Anthropic Claude for analysis

**Advantages over browser screenshots:**
- No browser overhead or rendering delays
- Direct access to video stream
- Faster capture (typically 3-10 seconds)
- Lower resource usage

### Screenshot Storage

For debugging purposes, all captured frames are automatically saved to disk:

- **Location**: `./screenshots/{channel-name}/`
- **Filename format**: `{channel-name}_{timestamp}.png`
- **Auto-cleanup**: Only the last 50 screenshots per channel are kept (older ones are automatically deleted)
- **Disk space**: Screenshots are typically 500KB-2MB each

Example directory structure:
```
screenshots/
├── cyburdial/
│   ├── cyburdial_2026-01-31T10-30-00-000Z.png
│   └── cyburdial_2026-01-31T10-31-00-000Z.png
├── tinktv/
│   ├── tinktv_2026-01-31T10-30-00-000Z.png
│   └── tinktv_2026-01-31T10-31-00-000Z.png
└── wolfymaster/
    └── wolfymaster_2026-01-31T10-30-00-000Z.png
```

**Note**: The `screenshots/` directory is automatically added to `.gitignore` to prevent screenshots from being committed to version control.