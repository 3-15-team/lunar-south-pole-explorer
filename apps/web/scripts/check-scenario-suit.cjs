// Check + screenshot: scenario cards are coloured by the point's Suitability score. Pins a few
// PGDA sites, prints each card's score label, and compares the card's max slope with the map's
// Suitability-layer readout at the same site (map centred on it, zoomed in).
// Usage (Playwright installed outside the repo):
//   NODE_PATH=~/.cache/lspe-pw/node_modules node apps/web/scripts/check-scenario-suit.cjs [baseUrl] [outDir]
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = process.argv[3] || path.join(__dirname, '..', 'test-results');
const SITES = ['Connecting ridge', 'Shackleton rim', 'Nobile rim 1', 'Malapert massif'];

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(BASE);
  await page.evaluate(() => localStorage.removeItem('lspe.sites.collapsed'));
  await page.reload();
  const skip = page.locator('.warmup-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 3000, force: true }).catch(() => {});
  const pin = page.locator('.scenarios button.btn.primary');
  await pin.waitFor();
  for (const name of SITES) {
    await page.locator('.site-item', { hasText: name }).first().click();
    await page.waitForTimeout(400);
    await pin.click();
  }
  // wait until every card has a score (or a definite "no data / excluded" label)
  await page.waitForFunction(
    (n) => {
      const chips = [...document.querySelectorAll('.scenarios .card .chip')];
      return chips.length === n && chips.every((c) => !/computing/.test(c.getAttribute('title') || ''));
    },
    SITES.length,
    { timeout: 180000 },
  );
  const labels = await page.locator('.scenarios .card').evaluateAll((els) =>
    els.map((e) => `${e.querySelector('.card-title').textContent.trim()} | ${e.querySelector('.chip').getAttribute('title')} | ${e.style.getPropertyValue('--c')}`),
  );
  console.log(labels.join('\n'));
  const box = await page.locator('aside.left').boundingBox();
  await page.screenshot({ path: path.join(OUT, 'scenario-suit-cards.png'), clip: box });

  // map Suitability layer at the last pinned site: read "max slope" under the map centre
  await page.locator('label', { hasText: 'Suitability' }).first().click();
  await page.waitForTimeout(500);
  const view = await page.evaluate(() => (location.hash.match(/[#&]v=([^&]*)/) || [])[1]);
  if (view) {
    const [x, y] = view.split(',');
    await page.evaluate(([x, y]) => (location.hash = location.hash.replace(/v=[^&]*/, `v=${x},${y},4`)), [x, y]);
  }
  const map = await page.locator('.map').boundingBox();
  let readout = '';
  for (let t = 0; t < 60 && !/max slope/.test(readout); t++) {
    await page.mouse.move(map.x + map.width / 2 + (t % 2), map.y + map.height / 2);
    await page.waitForTimeout(1000);
    readout = (await page.locator('.map-ui.bottom-left .readout').first().textContent()) || '';
  }
  console.log('map readout at site centre:', readout);
  await page.screenshot({ path: path.join(OUT, 'scenario-suit-map.png') });
  await browser.close();
})();
