const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
      contentType: 'text/javascript',
      body: 'window.Chart = class { constructor() {} destroy() {} };'
    }));
    await page.goto('file://' + path.join(__dirname, 'index.html').replace(/\\/g, '/'));
    const result = await page.evaluate(() => {
      const desc = '<img src=x onerror=alert(1)>';
      document.getElementById('f-date').value = '2026-04-05';
      document.getElementById('f-desc').value = desc;
      document.getElementById('f-amount').value = '100';
      addEntry();
      const cell = document.querySelector('#table-body tr td:nth-child(3)');
      return { literal: cell?.textContent === desc, injected: !!cell?.querySelector('img') };
    });
    if (!result.literal || result.injected) throw new Error('description was not rendered literally');
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => exportCSV());
    const download = await downloadPromise;
    const csv = fs.readFileSync(await download.path(), 'utf8');
    if (!csv.includes('"<img src=x onerror=alert(1)>"')) throw new Error('CSV download missing literal description');
    console.log('Chromium: description rendered literally');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
