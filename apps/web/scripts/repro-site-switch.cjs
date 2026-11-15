// Debug repro: switch the selected site via the URL hash (same path as a panorama double-click
// move: siteRef changes) and sample the right panel for the transient "Playhead outside the
// interval" note. Usage (Playwright installed outside the repo):
//   NODE_PATH=~/.cache/lspe-pw/node_modules node apps/web/scripts/repro-site-switch.cjs [baseUrl]
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:5173/';
const A = '-89.45,222.69';
const B = '-89.44,223.10';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const logs = [];
  const t0 = Date.now();
  page.on('console', (m) => {
    const s = m.text();
    if (s.startsWith('[skydbg]')) logs.push(`${Date.now() - t0} ${s}`);
  });
  await page.goto(`${BASE}#s=${A}`);
  await page.evaluate(() => localStorage.setItem('lspe.warmup', '1'));
  const skip = page.locator('.warmup-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 3000, force: true }).catch(() => {});
  // wait until metrics for site A are on screen (verdict box needs interval metrics)
  await page.waitForSelector('.verdict-box', { timeout: 120000 });
  await page.waitForTimeout(1500);
  logs.length = 0;
  const switchAt = Date.now() - t0;
  if (process.argv[3] === 'pano') {
    // real flow: panorama double-click on the ground below the horizon
    await page.evaluate(() => (location.hash = location.hash.replace(/(&m=[^&]*)?$/, '&m=pano')));
    await page.waitForFunction(() => !document.querySelector('.pano .loading') && document.querySelector('.pano-coords'), null, { timeout: 180000 });
    await page.waitForTimeout(1000);
    logs.length = 0;
    const box = await page.locator('.pano canvas').boundingBox();
    await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.8);
  } else await page.evaluate((b) => (location.hash = location.hash.replace(/s=[^&]*/, 's=' + b)), B);
  const samples = [];
  const until = Date.now() + (process.argv[3] === 'pano' ? 90000 : 5000);
  while (Date.now() < until) {
    const r = await page.evaluate(() => ({
      note: !!document.querySelector('.sky-note'),
      h: document.querySelector('.skyplot')?.getBoundingClientRect().height ?? 0,
    }));
    samples.push(`${Date.now() - t0} note=${r.note} skyplotH=${Math.round(r.h)}`);
    await page.waitForTimeout(40);
  }
  console.log('switch at', switchAt, 'final hash', await page.evaluate(() => location.hash));
  console.log(samples.filter((s, i, a) => i === 0 || s.split(' ').slice(1).join() !== a[i - 1].split(' ').slice(1).join()).join('\n'));
  console.log('--- debug log ---');
  console.log(logs.filter((s, i, a) => i === 0 || s.split(' ').slice(1).join() !== a[i - 1].split(' ').slice(1).join()).join('\n'));
  await browser.close();
})();
