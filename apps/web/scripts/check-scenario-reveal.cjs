// Check: pinning a scenario scrolls the left panel to the new card; pinning a duplicate scrolls to
// (and flashes) the existing one. Pins 8 scenarios with different intervals so the list overflows.
// Usage (Playwright installed outside the repo):
//   NODE_PATH=~/.cache/lspe-pw/node_modules node apps/web/scripts/check-scenario-reveal.cjs [baseUrl]
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:5173/';
const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 16) + 'Z';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${BASE}#s=-89.45,222.69`);
  const pin = page.locator('.scenarios button.btn.primary');
  await pin.waitFor();
  // is the card fully inside the left panel's visible area?
  const inView = (id) =>
    page.evaluate((id) => {
      const aside = document.querySelector('aside.left');
      const card = document.querySelector(`.scenarios .card[data-id="${id}"]`);
      if (!aside || !card) return false;
      const a = aside.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      return c.top >= a.top - 1 && c.bottom <= a.bottom + 1;
    }, id);
  const lastId = () => page.locator('.scenarios .card').last().getAttribute('data-id');
  // smooth scroll + metrics loading take a moment: poll up to 3 s
  const settlesInView = async (id) => {
    for (let t = 0; t < 3000; t += 100) {
      if (await inView(id)) return true;
      await page.waitForTimeout(100);
    }
    return false;
  };
  let ok = true;
  const t0 = Date.UTC(2027, 0, 1);
  for (let k = 0; k < 8; k++) {
    // a different interval each time, so every pin is a new scenario
    await page.evaluate((h) => (location.hash = h), `s=-89.45,222.69&i=${iso(t0 + k * 3 * DAY)}~${iso(t0 + (k * 3 + 14) * DAY)}`);
    await page.waitForTimeout(300);
    await pin.click();
    const id = await lastId();
    const v = await settlesInView(id);
    ok = ok && v;
    console.log(`pin ${k + 1}: cards=${await page.locator('.scenarios .card').count()} new card in view=${v}`);
  }
  // duplicate of the first scenario: scroll back up to it and flash it
  const firstId = await page.locator('.scenarios .card').first().getAttribute('data-id');
  await page.evaluate((h) => (location.hash = h), `s=-89.45,222.69&i=${iso(t0)}~${iso(t0 + 14 * DAY)}`);
  await page.waitForTimeout(300);
  await pin.click();
  const dupView = await settlesInView(firstId);
  const flashing = await page.locator(`.scenarios .card.flash[data-id="${firstId}"]`).count();
  console.log(`duplicate: cards=${await page.locator('.scenarios .card').count()} first card in view=${dupView} flashing=${flashing}`);
  ok = ok && dupView && flashing === 1;
  console.log(ok ? 'OK' : 'FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
