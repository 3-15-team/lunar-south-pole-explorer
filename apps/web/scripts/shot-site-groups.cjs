// Check + screenshot: the site catalogue group disclosure (collapse "LOLA 5 m sites (PGDA)").
// Usage (Playwright installed outside the repo):
//   NODE_PATH=~/.cache/lspe-pw/node_modules node apps/web/scripts/shot-site-groups.cjs [baseUrl] [outDir]
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = process.argv[3] || path.join(__dirname, '..', 'test-results');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(BASE);
  await page.evaluate(() => localStorage.removeItem('lspe.sites.collapsed'));
  await page.reload();
  const skip = page.locator('.warmup-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 3000, force: true }).catch(() => {});
  await page.waitForSelector('.site-group-title');
  await page.waitForTimeout(800);
  const count = () => page.locator('.site-item').count();
  const before = await count();
  const shot = async (name) => {
    const box = await page.locator('.panel.sites').boundingBox();
    const file = path.join(OUT, `site-groups-${name}.png`);
    await page.screenshot({ path: file, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 420) } });
    return file;
  };
  console.log('expanded', before, 'items', await shot('expanded'));
  const title = page.locator('.site-group-title', { hasText: 'PGDA' });
  await title.click();
  const after = await count();
  console.log('collapsed', after, 'items, aria-expanded', await title.getAttribute('aria-expanded'), await shot('collapsed'));
  await page.reload();
  await page.waitForSelector('.site-group-title');
  const persisted = await page.locator('.site-group-title', { hasText: 'PGDA' }).getAttribute('aria-expanded');
  console.log('after reload aria-expanded', persisted);
  await page.locator('input.search').fill('shackleton');
  console.log('search shows', await count(), 'items while PGDA is collapsed');
  await browser.close();
})();
