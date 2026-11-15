// Check: "look at" target buttons on the Sun now / Earth now tiles. Hidden on the map; in the
// panorama a click turns the camera so the compass matches the body's azimuth (sky plot readout).
// Usage (Playwright installed outside the repo):
//   NODE_PATH=~/.cache/lspe-pw/node_modules node apps/web/scripts/check-pano-look-at.cjs [baseUrl] [outDir]
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = process.argv[3] || path.join(__dirname, '..', 'test-results');

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${BASE}#s=-89.45,222.69`);
  const skip = page.locator('.warmup-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 3000, force: true }).catch(() => {});
  await page.waitForSelector('.tiles');
  console.log('map mode: target buttons =', await page.locator('.look-at').count());

  await page.evaluate(() => (location.hash += '&m=pano'));
  await page.waitForFunction(() => !document.querySelector('.pano .loading') && document.querySelector('.pano-coords'), null, { timeout: 180000 });
  await page.waitForTimeout(1000);
  console.log('pano mode: target buttons =', await page.locator('.look-at').count());

  // Sun: sky plot readout "Sun az 246.7° el …"; Earth: the Earth now tile "elevation … · az 134°"
  const az = async (body) => {
    const t = body === 'Sun' ? await page.locator('.sky-readout').textContent() : await page.locator('.tile', { hasText: 'Earth now' }).textContent();
    const m = body === 'Sun' ? t.match(/Sun\s+az\s+(-?[\d.]+)/) : t.match(/az\s+(-?[\d.]+)°/);
    return m ? +m[1] : NaN;
  };
  const heading = async () => +((await page.locator('.compass').textContent()).match(/(\d+)°/) || [])[1];
  const diff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const pano = await page.locator('.pano').boundingBox();
  let ok = true;
  for (const [body, idx] of [['Sun', 0], ['Earth', 1]]) {
    // turn away first, so the button has to do the work
    await page.mouse.move(pano.x + pano.width / 2, pano.y + pano.height / 2);
    await page.mouse.down();
    await page.mouse.move(pano.x + pano.width / 2 + 400, pano.y + pano.height / 2 - 100, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const before = await heading();
    await page.locator('.look-at').nth(idx).click();
    await page.waitForTimeout(1500);
    const after = await heading();
    const want = await az(body);
    const d = diff(after, want);
    ok = ok && d <= 1.5;
    console.log(`${body}: compass ${before}° -> ${after}°, ${body} az ${want}° (off by ${d.toFixed(1)}°)`);
    await page.screenshot({ path: path.join(OUT, `pano-look-at-${body.toLowerCase()}.png`), clip: pano });
  }
  const tiles = await page.locator('.tiles').boundingBox();
  await page.screenshot({ path: path.join(OUT, 'pano-look-at-tiles.png'), clip: { x: tiles.x, y: tiles.y, width: tiles.width, height: 170 } });
  console.log(ok ? 'OK' : 'FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
