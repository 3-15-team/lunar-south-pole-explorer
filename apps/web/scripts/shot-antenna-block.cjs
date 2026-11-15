// Screenshot the right-panel "Earth link vs antenna height" block (antenna slider placement).
// Usage (Playwright installed outside the repo):
//   NODE_PATH=~/.cache/lspe-pw/node_modules node apps/web/scripts/shot-antenna-block.cjs [baseUrl] [outDir]
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = process.argv[3] || path.join(__dirname, '..', 'test-results');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${BASE}#s=-89.45,222.69`);
  const skip = page.locator('.warmup-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 3000, force: true }).catch(() => {});
  const block = page.locator('section.antenna');
  await block.waitFor({ timeout: 120000 });
  await page.waitForSelector('section.antenna .ant-canvas', { timeout: 120000 });
  await block.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const file = path.join(OUT, 'antenna-block.png');
  await block.screenshot({ path: file });
  console.log(file);
  console.log('left panel antenna sliders:', await page.locator('aside.left input#antenna, aside.left [list="antenna-ticks"]').count());
  console.log('right panel antenna sliders:', await page.locator('section.antenna [list="antenna-ticks"]').count());
  await browser.close();
})();
