# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Meeting Bot** is a demo Electron desktop application showcasing the Recall.ai Desktop Recording SDK (DSDK 2.0.0). It records meetings from Zoom, Google Meet, Slack, and Microsoft Teams with real-time transcription via AssemblyAI and AI-generated summaries via OpenRouter.

## Development Commands

```bash
npm ci                  # Install dependencies
npm start               # Run Express server + Electron app concurrently
npm run start:server    # Run token server only (port 13373)
npm run start:electron  # Run Electron app only
npm run package         # Create distributable package
npm run make            # Build platform installers (macOS DMG)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron App                            │
├─────────────────────┬───────────────────────────────────────┤
│   Main Process      │        Renderer Process               │
│   (src/main.js)     │        (src/renderer.js)              │
│                     │                                       │
│ - SDK init          │  - UI/views                           │
│ - IPC handlers      │  - Meeting management                 │
│ - File operations   │  - Recording controls                 │
│ - AI summaries      │  - Debug panel                        │
│                     │                                       │
├─────────────────────┴───────────────────────────────────────┤
│              preload.js (IPC Bridge)                        │
└─────────────────────────────────────────────────────────────┘
           ↑
           │ HTTP (port 13373)
┌──────────┴──────────┐       ┌───────────────────────────────┐
│  Express Server     │       │    Recall.ai API              │
│  (src/server.js)    │──────→│    (SDK upload tokens)        │
│  /start-recording   │       │                               │
└─────────────────────┘       └───────────────────────────────┘
```

**Data Storage:** `~/Library/Application Support/Meeting Bot/`
- `meetings.json` - Meeting notes and metadata
- `recordings/` - Video files

## Key Files

| File | Purpose |
|------|---------|
| `src/main.js` | Main Electron process - SDK initialization, event handling, IPC handlers, file ops |
| `src/renderer.js` | Renderer process - UI logic, views, recording controls, debug panel |
| `src/server.js` | Express server - generates SDK upload tokens with real-time event config |
| `src/preload.js` | IPC bridge - secure main↔renderer communication |
| `forge.config.js` | Electron Forge build config with webpack, code signing, makers |

## Environment Configuration

Copy `.env.example` to `.env` and configure:
```
RECALLAI_API_URL=https://us-west-2.recall.ai   # Your Recall region
RECALLAI_API_KEY=<key>                          # Recall.ai API key
OPENROUTER_KEY=<key>                            # Optional: for AI summaries
```

**Required:** Configure AssemblyAI credentials on Recall.ai dashboard for real-time transcription.

## Recall.ai SDK Documentation (Context7)

Use Context7 MCP to query Recall.ai docs with library ID: `/websites/recall_ai`

**Key Documentation Links:**
- Desktop SDK Overview: https://docs.recall.ai/docs/desktop-sdk
- Real-time Transcription: https://docs.recall.ai/docs/dsdk-realtime-transcription
- SDK Upload API: https://docs.recall.ai/reference/sdk_upload_list
- Regions: https://docs.recall.ai/docs/regions

## SDK Real-Time Events Reference

Events configured in `server.js` for `realtime_endpoints`:

| Event | Description |
|-------|-------------|
| `participant_events.join` | Participant joined meeting |
| `participant_events.update` | Participant details updated |
| `participant_events.speech_on/off` | Speaking status changed |
| `participant_events.screenshare_on/off` | Screen sharing status changed |
| `transcript.data` | Complete transcript utterance |
| `transcript.partial_data` | Partial transcript (in-progress) |
| `transcript.provider_data` | Raw provider format |
| `video_separate_png.data` | Video frame as base64 PNG |
| `audio_mixed_raw.data` | Mixed audio buffer |

## SDK Event Flow

1. **Meeting Detection:** SDK emits `meeting-detected` → app shows notification
2. **Recording Start:** Request token from `/start-recording` → call `sdk.startRecording(token)`
3. **Real-time Events:** SDK emits `realtime-event` with transcript/participant/video data
4. **Recording End:** SDK emits `recording-ended` → app uploads video, generates AI summary
