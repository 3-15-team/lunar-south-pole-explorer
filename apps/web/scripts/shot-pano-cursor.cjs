// Screenshot the panorama with the mouse over the ground (cursor marker check).
// Usage (Playwright installed outside the repo):
//   NODE_PATH=~/.cache/lspe-pw/node_modules node apps/web/scripts/shot-pano-cursor.cjs [baseUrl] [outDir]
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
  await page.waitForFunction(() => !document.querySelector('.pano .loading') && document.querySelector('.pano-coords'), null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  const box = await page.locator('.pano canvas').boundingBox();
  for (const [name, fy] of [['near', 0.85], ['far', 0.6]]) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * fy, { steps: 5 });
    await page.waitForTimeout(1500);
    const file = path.join(OUT, `pano-cursor-${name}.png`);
    await page.screenshot({ path: file, clip: { x: box.x + box.width * 0.5 - 200, y: box.y + box.height * fy - 200, width: 400, height: 300 } });
    console.log(name, file, await page.locator('.pano-coords .readout').nth(1).textContent());
  }
  // double-click: the marker must disappear before the move
  const fy = 0.6;
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * fy);
  await page.waitForTimeout(150);
  const file = path.join(OUT, 'pano-cursor-dblclick.png');
  await page.screenshot({ path: file, clip: { x: box.x + box.width * 0.5 - 200, y: box.y + box.height * fy - 200, width: 400, height: 300 } });
  console.log('dblclick', file);
  await browser.close();
})();
