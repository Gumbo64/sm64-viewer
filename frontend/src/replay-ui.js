// The replay viewer as a library: the SM64Coin web app (sm64-crypto3/web) imports
// these through a bundler alias (see its vite.config.js), so there is one copy
// of the viewer's player UI, controls, timeline, resolution options, and MP4
// export. Styles come with the component (replay.css, scoped to .sm64-replay).
export { default as Viewer } from './components/Viewer';
export { Player, SPEEDS } from './lib/player';
export { formatTime, FPS } from './lib/m64';
export { Trail } from './lib/trail';
