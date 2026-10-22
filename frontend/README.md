# SM64 Replay Viewer

Plays Super Mario 64 input replays in the browser with the WASM build from
[sm64-binds](https://github.com/Gumbo64/sm64-binds). You supply your own US
ROM once (it's cached in IndexedDB).

## Using it

- **Load a replay**: drop a file, pick a bundled example, or paste a URL.
  Links like `/sm64-viewer/?m64=<url>&start=<frame>` open a replay directly at
  a frame.
- **Formats**: raw input files (4 bytes per frame: big-endian buttons, stick
  x, stick y, as written by sm64-AI-binds) and Mupen64 `.m64`
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

`public/replays/index.json` is the start screen's timeline, shown oldest
first and grouped by day. Each entry has a `title` and a `date`, an ISO
timestamp in UTC (`"2026-10-18T10:04:00Z"`) that the page shows in the
viewer's own time zone, or a plain date (`"2026-01-29"`) for an entry with no
known time of day, plus any of:

- `file`, `start`: a replay in `public/replays/`, opened at frame `start`
- `description`: a line of text
- `table`: `{ "columns": [...], "rows": [[...]], "highlight": [rowIndex], "note": "..." }`
  (a row is an array of cells, or `{ "cells": [...], "file", "start" }` to make
  the row open that replay: it gets a ▶ Play button and the whole row is clickable)
- `links`: `[{ "label", "url" }]`; `video` adds a "Watch the video" link
- `image`, `alt`: a path under `public/` or a URL
- `important`: `true` marks the entry with ★ and keeps it under "Important only"
- `regions`: annotated frame ranges of the replay (on an entry or a table row
  with a `file`), e.g. where a search script hands over to the next phase:
  `[{ "from": 1690, "to": 2904, "label": "Route to BoB", "note": "...", "color": "#f59e0b" }]`.
  `to` defaults to the next region's `from` (or the end), `note` and `color`
  are optional. They show as a labelled track above the timeline (click one to
  jump to its start), a chip over the picture naming the current one (hidden
  with the HUD), and a list in the side panel. Links to the file
  (`?m64=...`) get them too.

Entries without `file` (results, notes) get a hollow dot on the timeline.

## Development

```
npm install
npm run dev      # http://localhost:5173/sm64-viewer/
npm run build    # dist/, deployed to GitHub Pages by .github/workflows
```

The game comes from the npm package `sm64-binds-frontend`. To use a local
checkout of it instead (and so its game build), set `SM64_BINDS_FRONTEND` to
its path, e.g. `SM64_BINDS_FRONTEND=../../sm64-binds/javascript npm run dev`.

### TAS tests

`npm run test:tas` plays the four TASVideos runs from `sm64-binds/tas` to the
end in the viewer (Chromium, driven by Playwright) and checks they end where
the headless build ends them: stars, course, area and Mario's position. It
uses the local `sm64-binds/javascript` and a ROM at
`sm64-binds/baserom.us.z64` (`SM64_ROM`, `SM64_TAS_DIR` and
`SM64_BINDS_FRONTEND` override them; `TAS=2016M` picks runs). The game needs
WebGL, which headless Chromium lacks, so it runs under `xvfb-run`. It takes
about 20 minutes, mostly the two 120-star runs.

Code: `src/lib/player.js` drives the emulator (timing, seeking, events),
`src/lib/m64.js` parses replays, `src/components/` is the UI.
