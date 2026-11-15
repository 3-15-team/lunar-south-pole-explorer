// Check: double-click on the timeline (inside the interval band, where a single press drags the
// interval) moves the playhead there and leaves the interval unchanged.
// Usage (Playwright installed outside the repo):
//   NODE_PATH=~/.cache/lspe-pw/node_modules node apps/web/scripts/check-timeline-dblclick.cjs [baseUrl]
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:5173/';
const state = (page) =>
  page.evaluate(() => ({
    t: decodeURIComponent((location.hash.match(/[#&]t=([^&]*)/) || [])[1] || ''),
    i: decodeURIComponent((location.hash.match(/[#&]i=([^&]*)/) || [])[1] || ''),
  }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${BASE}#s=-89.45,222.69`);
  const skip = page.locator('.warmup-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 3000, force: true }).catch(() => {});
  await page.waitForSelector('.tl-range');
  await page.waitForTimeout(1000);
  const before = await state(page);
  const band = await page.locator('.tl-range').boundingBox();
  await page.mouse.dblclick(band.x + band.width * 0.6, band.y + band.height / 2);
  await page.waitForTimeout(500);
  const after = await state(page);
  console.log('before', before);
  console.log('after ', after);
  let ok = after.t !== before.t && after.i === before.i;
  console.log(ok ? 'OK: playhead moved, interval unchanged' : 'FAIL: timeline double-click');

  // Time / From / To blocks: a double-click on the label text must open that field's picker.
  // The native popup isn't observable headless, so record which input showPicker() ran on.
  await page.evaluate(() => {
    window.__pickers = [];
    HTMLInputElement.prototype.showPicker = function () {
      window.__pickers.push(this.closest('.tl-field').querySelector('span').textContent);
    };
  });
  const fields = page.locator('.tl-field');
  for (let i = 0; i < (await fields.count()); i++) await fields.nth(i).locator('span').dblclick();
  const opened = await page.evaluate(() => window.__pickers);
  const want = ['Time (UTC)', 'From', 'To'];
  const pickOk = JSON.stringify(opened) === JSON.stringify(want);
  console.log(pickOk ? `OK: pickers opened for ${opened.join(', ')}` : `FAIL: pickers ${JSON.stringify(opened)}`);
  ok = ok && pickOk;

  // interval handles: double-click opens From / To and does not move the playhead
  await page.evaluate(() => (window.__pickers = []));
  const t0 = (await state(page)).t;
  await page.locator('.tl-handle.start').dblclick();
  await page.locator('.tl-handle.end').dblclick();
  const fromHandles = await page.evaluate(() => window.__pickers);
  const handlesOk = JSON.stringify(fromHandles) === JSON.stringify(['From', 'To']) && (await state(page)).t === t0;
  console.log(handlesOk ? 'OK: handles open From, To; playhead unchanged' : `FAIL: handles ${JSON.stringify(fromHandles)}, t ${t0} -> ${(await state(page)).t}`);
  ok = ok && handlesOk;
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
