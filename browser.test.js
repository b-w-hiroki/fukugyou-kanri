const { chromium } = require('playwright');
const assert = require('node:assert/strict');
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
    await page.getByRole('button', { name: '登録・一覧', exact: true }).click();
    const backupDownload = page.waitForEvent('download');
    await page.locator('#export-backup').click();
    const backup = JSON.parse(fs.readFileSync(await (await backupDownload).path(), 'utf8'));
    assert.equal(backup.app, 'fukugyou-kanri');
    assert.equal(backup.entries.length, 1);
    const before = await page.evaluate(() => localStorage.getItem('fukugyou'));
    const replacement = { ...backup, entries: [{ ...backup.entries[0], id: 999, amount: 7654, category: '__proto__' }] };
    const choose = data => page.locator('#backup-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    page.once('dialog', dialog => dialog.dismiss());
    await choose(replacement);
    await page.waitForFunction(() => document.getElementById('backup-status').textContent.includes('キャンセル'));
    assert.equal(await page.evaluate(() => localStorage.getItem('fukugyou')), before);

    page.once('dialog', dialog => dialog.accept());
    await choose(replacement);
    await page.waitForFunction(() => document.getElementById('backup-status').textContent.includes('1 件を復元'));
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('fukugyou'))), replacement.entries);
    assert.equal(await page.locator('#table-body img').count(), 0);
    assert.equal(await page.locator('#table-body tr').count(), 1);
    await page.reload();
    assert.equal(await page.locator('#table-body tr td').nth(4).textContent(), '¥7,654');
    await page.getByRole('button', { name: '登録・一覧', exact: true }).click();

    const restored = await page.evaluate(() => localStorage.getItem('fukugyou'));
    await choose({ ...backup, entries: [{ ...backup.entries[0], date: '2026-02-30' }] });
    await page.waitForFunction(() => document.getElementById('backup-status').textContent.includes('復元できません'));
    assert.equal(await page.evaluate(() => localStorage.getItem('fukugyou')), restored);

    await page.evaluate(() => {
      window.realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
    });
    page.once('dialog', dialog => dialog.accept());
    await choose(backup);
    await page.waitForFunction(() => document.getElementById('backup-status').textContent.includes('復元できません'));
    assert.equal(await page.evaluate(() => localStorage.getItem('fukugyou')), restored);
    assert.deepEqual(await page.evaluate(() => entries), replacement.entries);
    page.once('dialog', dialog => dialog.accept());
    await page.evaluate(() => {
      document.getElementById('f-desc').value = '保存失敗テスト';
      document.getElementById('f-amount').value = '100';
      addEntry();
    });
    assert.equal(await page.locator('#f-desc').inputValue(), '保存失敗テスト');
    assert.deepEqual(await page.evaluate(() => entries), replacement.entries);
    await page.evaluate(() => { Storage.prototype.setItem = window.realSetItem; localStorage.setItem('fukugyou', '{broken'); });
    await page.reload();
    await page.getByRole('button', { name: '登録・一覧', exact: true }).click();
    assert.ok((await page.locator('#backup-status').textContent()).includes('元データを保持'));
    assert.equal(await page.evaluate(() => localStorage.getItem('fukugyou')), '{broken');
    const recoveryDownload = page.waitForEvent('download');
    await page.locator('#export-backup').click();
    assert.equal(fs.readFileSync(await (await recoveryDownload).path(), 'utf8'), '{broken');
    page.once('dialog', dialog => dialog.accept());
    await choose(backup);
    await page.waitForFunction(() => document.getElementById('backup-status').textContent.includes('1 件を復元'));
    await page.setViewportSize({ width: 375, height: 812 });
    const box = await page.locator('#backup-status').evaluate(el => { const box = el.parentElement.getBoundingClientRect(); return { left: box.left, right: box.right, viewport: innerWidth }; });
    assert.ok(box.left >= 0 && box.right <= box.viewport, 'backup panel fits narrow screen');
    console.log('Chromium: literal rendering, CSV, JSON round trip, cancellation, invalid data, quota failure, corrupt-data recovery and narrow backup panel passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
