# SM64 Replay Viewer

Plays Super Mario 64 input replays in the browser with the WASM build from
[sm64-binds](https://github.com/Gumbo64/sm64-binds). You supply your own US
ROM once (it's cached in IndexedDB).

## Using it

- **Load a replay**: drop a file, pick a bundled example, or paste a URL.
  Links like `/sm64-viewer/?m64=<url>&start=<frame>` open a replay directly at
  a frame.
- **Formats**: raw input files (4 bytes per frame: big-endian buttons, stick
  x, stick y, as written by sm64-AI-binds and sm64-twin) and Mupen64 `.m64`
  files (0x400-byte `M64\x1A` header) are detected automatically.
- **Playback**: play/pause, single frames, 0.25×–16× or max speed, timeline
  scrubbing, jump to a frame. Sound plays at 1× only.
- **Going backwards** reloads the page and fast-forwards to the target frame:
  the emulator can't rewind, and a fresh page is the reliable way to free the
  old instance (640 MB of WASM memory).
- **Panels**: HUD (frame, time, stars, course/area, position, speeds), the
  current controller input, a timeline strip of stick and A/B/Z activity, and
  an event list (stars, course/area changes) with click-to-seek.

| Key | Action |
|---|---|
| Space / k | play / pause |
| → / . | next frame |
| ← / , | previous frame (reloads) |
| Shift + ←/→ | ±10 s |
| + / − (or ] / [) | speed |
| Home / End | start / end |
| f · h · p | fullscreen · HUD · side panel |

## Examples

`public/replays/index.json` lists the bundled replays:
`{ "file", "title", "description", "start" }`.

## Development

```
npm install
npm run dev      # http://localhost:5173/sm64-viewer/
npm run build    # dist/, deployed to GitHub Pages by .github/workflows
```

Code: `src/lib/player.js` drives the emulator (timing, seeking, events),
`src/lib/m64.js` parses replays, `src/components/` is the UI.
