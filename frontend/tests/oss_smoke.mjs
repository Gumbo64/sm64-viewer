// Smoke test of the objective-scattershot view in a real browser:
//   node tests/oss_smoke.mjs <run> <rom.z64> <screenshot dir> [url, default http://localhost:5173/sm64-viewer/]
// Needs the dev server (npm run dev) and the scattershot data server
// (objective-scattershot/tools/serve.py). Loads the ROM, opens ?oss=<run>,
// goes through the tabs and colour modes, clicks a cell, and fails on console
// errors or a missing canvas. NOT YET RUN: Chromium crashed on launch in the
// sandbox it was written in (even on about:blank), so this is untested.
// Screenshots: map-<colour>.png, table.png, objectives.png.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [run, rom, outDir, base = 'http://localhost:5173/sm64-viewer/'] = process.argv.slice(2);
if (!run || !rom || !outDir) throw new Error('usage: oss_smoke.mjs <run> <rom.z64> <screenshot dir> [url]');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${base}?oss=${run}`);
if (await page.locator('input[type=file]').count()) {
  await page.locator('input[type=file]').first().setInputFiles(rom);
}
await page.waitForSelector('.oss-app', { timeout: 120000 });
await page.waitForSelector('.oss-status', { timeout: 120000 });
await page.waitForSelector('.oss-map-view canvas', { timeout: 120000 });
await page.waitForTimeout(4000);
console.log('status:', (await page.locator('.oss-status').innerText()).replace(/\s+/g, ' '));
console.log('areas on the map:', await page.locator('.oss-nav svg g.z').count(), '| transitions rows:', await page.locator('.oss-nav table tbody tr').count());
console.log('map labels:', (await page.locator('.oss-nav svg g.z text').allInnerTexts()).join(', '));

for (const mode of ['Objective', 'Game time', 'Times expanded', 'Success rate', 'Stars & keys']) {
  await page.getByRole('button', { name: mode, exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/map-${mode.replace(/\W+/g, '_')}.png` });
}
// Click in the middle of the map: selects a cell if one is there.
const box = await page.locator('.oss-map-view').boundingBox();
for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.4, 0.4]]) {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  if (await page.locator('.oss-kv').count()) break;
}
console.log('a cell got selected:', (await page.locator('.oss-kv').count()) > 0);
await page.screenshot({ path: `${outDir}/map-selected.png` });
await page.getByRole('button', { name: 'Objectives', exact: true }).click();
await page.waitForSelector('.oss-node');
await page.screenshot({ path: `${outDir}/objectives.png` });
await page.getByRole('button', { name: 'Table', exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/table.png` });
await browser.close();

console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
process.exit(errors.length ? 1 : 0);
