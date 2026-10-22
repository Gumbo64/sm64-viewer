// The TASVideos runs, played to the end in the viewer, must end where the
// headless build (sm64-binds' Rust tests and N64 oracle) ends them: the same
// stars, course, area and Mario position.
//
//   npm run test:tas                  # all four; TAS=2016M picks by name
//
// Needs:
// - SM64_ROM: a US .z64 ROM (default ../../sm64-binds/baserom.us.z64);
// - SM64_TAS_DIR: the .m64 files (default ../../sm64-binds/tas);
// - SM64_BINDS_FRONTEND (vite.config.js; the npm script sets it to the local
//   sm64-binds/javascript) to test that game build rather than the npm one;
// - WebGL, so a real (not headless) Chromium and a display: the npm script
//   runs under xvfb-run. Playwright's Chromium (`npx playwright install
//   chromium`).
// A run whose file is missing is skipped. A 120-star run takes ~9 minutes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROM = process.env.SM64_ROM ?? path.join(here, '../../../sm64-binds/baserom.us.z64');
const TAS_DIR = process.env.SM64_TAS_DIR ?? path.join(here, '../../../sm64-binds/tas');

// Final states from the headless build (all four end in Bowser in the Sky).
const RUNS = [
  { file: 'tasvideos-2016M-0star.m64', stars: 0, pos: '-178.1, 327.0, -413.5' },
  { file: 'tasvideos-6943M-16star.m64', stars: 16, pos: '-284.7, 343.0, -105.9' },
  { file: 'tasvideos-7310M-120star.m64', stars: 120, pos: '0.0, 307.0, 0.0' },
  { file: 'tasvideos-2208M-120star.m64', stars: 120, pos: '-167.2, 327.0, -371.7' },
];

let server;
let browser;
let base;

before(async () => {
  server = await createServer({ root: path.join(here, '..'), server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  base = server.resolvedUrls.local[0].replace(/\/?$/, '/'); // .../sm64-viewer/
  browser = await chromium.launch({ headless: false });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

for (const run of RUNS.filter((r) => !process.env.TAS || r.file.includes(process.env.TAS))) {
  const file = path.join(TAS_DIR, run.file);
  const skip = !fs.existsSync(ROM) ? `no ROM at ${ROM}` : !fs.existsSync(file) ? `no ${file}` : false;

  test(run.file, { skip, timeout: 30 * 60 * 1000 }, async () => {
    const frames = fs.readFileSync(file).readUInt32LE(0x18);
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    try {
      // Serve the run from disk (matched on the path: the page's own URL has
      // it in its query).
      await page.route((url) => url.pathname.includes('/test-tas/'), (route) =>
        route.fulfill({ body: fs.readFileSync(file) }),
      );

      // The ROM (kept in IndexedDB for the browser's lifetime).
      await page.goto(base);
      // Either the ROM prompt or, once a ROM is cached, the replay picker.
      await page.waitForFunction(
        () => document.querySelector('input[type=file][accept=".z64"]') || /Load a replay/.test(document.body.innerText),
        null,
        { timeout: 120 * 1000 },
      );
      const romInput = page.locator('input[type=file][accept=".z64"]');
      if (await romInput.count()) await romInput.setInputFiles(ROM);
      await page.getByText('Load a replay').waitFor({ timeout: 120 * 1000 });

      // Open the run at its last frame: the viewer fast-forwards there.
      await page.goto(`${base}?m64=${new URL(base).pathname}test-tas/${run.file}&start=${frames}`, {
        waitUntil: 'commit',
      });
      const done = `frame ${frames} / ${frames}`;
      await page.waitForFunction(
        (text) => document.querySelector('.hud')?.innerText.includes(text) || /Couldn't|rror/.test(document.body.innerText),
        done,
        { timeout: 25 * 60 * 1000, polling: 1000 },
      );
      const hud = await page.evaluate(() => document.querySelector('.hud')?.innerText ?? document.body.innerText);
      assert.ok(hud.includes(done), `didn't reach the end: ${hud}`);
      assert.ok(hud.includes(`★ ${run.stars}`), `stars: ${hud}`);
      assert.ok(hud.includes('Bowser in the Sky'), `course: ${hud}`);
      assert.ok(hud.includes('area 1'), `area: ${hud}`);
      assert.ok(hud.includes(`pos ${run.pos}`), `position: ${hud}`);
    } finally {
      await page.close();
    }
  });
}
