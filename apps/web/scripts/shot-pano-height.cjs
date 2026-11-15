// Check + screenshots: panorama height control (bottom-right square -> vertical slider).
// Changes the height with the keyboard and checks it reaches the store (URL `h`) and that the
// view direction survives the panorama rebuild.
// Usage (Playwright installed outside the repo):
//   NODE_PATH=~/.cache/lspe-pw/node_modules node apps/web/scripts/shot-pano-height.cjs [baseUrl] [outDir]
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = process.argv[3] || path.join(__dirname, '..', 'test-results');

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${BASE}#s=-89.45,222.69&m=pano`);
  const skip = page.locator('.warmup-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 3000, force: true }).catch(() => {});
  const ready = () => page.waitForFunction(() => !document.querySelector('.pano .loading') && document.querySelector('.pano-coords'), null, { timeout: 180000 });
  await ready();
  await page.waitForTimeout(1000);
  const pano = await page.locator('.pano').boundingBox();
  const corner = (name) =>
    page.screenshot({ path: path.join(OUT, `pano-height-${name}.png`), clip: { x: pano.x + pano.width - 220, y: pano.y + pano.height - 330, width: 220, height: 330 } });

  // turn the view so a reset to the default direction would be visible
  await page.mouse.move(pano.x + pano.width / 2, pano.y + pano.height / 2);
  await page.mouse.down();
  await page.mouse.move(pano.x + pano.width / 2 - 300, pano.y + pano.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const compass = () => page.locator('.compass').textContent();
  const headingBefore = await compass();

  await corner('closed');
  await page.locator('.ph-btn').click();
  await page.waitForTimeout(300);
  await corner('open');

  const hBefore = await page.evaluate(() => (location.hash.match(/[#&]h=([^&]*)/) || [])[1] || '2 (default)');
  const range = page.locator('.ph-range');
  await range.focus();
  await page.keyboard.press('PageUp'); // 2 -> 5 m
  await page.keyboard.press('PageUp'); // 5 -> 10 m
  await page.waitForTimeout(500);
  const shown = await page.locator('.ph-value').textContent();
  await corner('raised');
  // wait for the horizon recompute + panorama rebuild at the new height
  await page.waitForTimeout(1500);
  await ready();
  await page.waitForTimeout(1500);
  const hAfter = await page.evaluate(() => (location.hash.match(/[#&]h=([^&]*)/) || [])[1] || '2 (default)');
  const headingAfter = await compass();
  console.log(`height: ${hBefore} -> ${hAfter} (readout ${shown})`);
  console.log(`compass: ${headingBefore} -> ${headingAfter}`);
  await page.screenshot({ path: path.join(OUT, 'pano-height-after.png') });
  await browser.close();
})();
