import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createServer } from '../scripts/serve.mjs';
import { sampleVault, TEST_PASSWORD, originalCrypto, legacyData } from './fixtures.mjs';
import { decryptVault } from '../src/crypto.js';
import { APP_VERSION } from '../src/version.js';
import { standaloneName } from '../scripts/build.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require('playwright');
const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}`;
const payload = await originalCrypto().encryptVault(sampleVault(), TEST_PASSWORD);
const fixture = { name: 'fictional-test.pvault', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) };
let passed = 0;
async function check(name, task) { await task(); passed++; console.log(`PASS ${name}`); }
async function unlock(page) {
  await page.locator('#vaultFile').setInputFiles(fixture);
  await page.locator('#masterPassword').fill(TEST_PASSWORD);
  await page.locator('#unlockBtn').click();
  await page.locator('#app').waitFor({ state: 'visible' });
}
async function fillDraft(page, title = '虛構新增') {
  await page.locator('#addBtn').click();
  await page.locator('[data-field="title"]').fill(title);
  await page.locator('[data-field="account"]').fill('fake-new@example.invalid');
  await page.locator('[data-field="password"]').fill('FAKE-ONLY-new-789!');
}
const errors = [];
await fs.mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
async function makePage(browser, options = {}) {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  const page = await context.newPage();
  if (options.isMobile) await page.clock.install();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await context.route('**/*', route => {
    assert.ok(route.request().url().startsWith(url), '程式不應連線到外部服務');
    return route.continue();
  });
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await page.goto(url);
  return { page, context };
}
try {
  const browser = await chromium.launch({ headless: true });
  console.log(`Desktop Chrome for Testing ${browser.version()}`);
  try {
    const { page, context } = await makePage(browser, { viewport: { width: 1280, height: 900 } });
    await check('Chrome 舊版解鎖與版本顯示', async () => {
      await unlock(page); assert.equal(await page.locator('#items .item').count(), 2);
      assert.equal(await page.title(), `PassVault ${APP_VERSION}`);
      for (const id of ['loginVersion', 'appVersion']) assert.equal(await page.locator('#' + id).textContent(), 'v' + APP_VERSION);
      assert.equal(await page.locator('#releaseVersion').textContent(), 'PassVault v' + APP_VERSION);
      assert.equal(await page.locator('#masterPassword').inputValue(), '');
      await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
    });
    await check('Chrome 草稿取消與尚未完成不進分類', async () => {
      await fillDraft(page); assert.equal(await page.locator('#items .item').count(), 2);
      assert.equal(await page.locator('#backupState').textContent(), '有未完成草稿');
      await page.locator('#cancelDraftBtn').click();
      assert.equal(await page.locator('#backupState').getAttribute('class'), 'saved');
    });
    await check('Chrome 完成新增及分類黃色提示', async () => {
      await fillDraft(page); await page.locator('[data-field="folderId"]').selectOption('work');
      await page.locator('#completeBtn').click();
      assert.equal(await page.locator('#items .is-new-unsaved').count(), 1);
      assert.equal(await page.locator('[data-folder="work"]').getAttribute('class'), 'folder active has-new');
    });
    await check('Chrome 加密下載未確認時保留 dirty，確認後重新解密', async () => {
      const downloadPromise = page.waitForEvent('download'); await page.locator('#saveBtn').click();
      const download = await downloadPromise;
      const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
      const decoded = await decryptVault(exported, TEST_PASSWORD);
      assert.equal(decoded.items.length, 3); assert.equal(decoded.items.find(i => i.title === '虛構新增').password, 'FAKE-ONLY-new-789!');
      assert.equal(await page.locator('#backupState').textContent(), '尚未匯出');
      assert.equal(await page.locator('#items .is-new-unsaved').count(), 1);
      await page.locator('#downloadSaved').click();
      assert.equal(await page.locator('#items .is-new-unsaved').count(), 0);
      assert.equal(await page.locator('#backupState').getAttribute('class'), 'saved');
      const again = page.waitForEvent('download'); await page.locator('#saveBtn').click(); const second = await again;
      assert.notEqual(download.suggestedFilename(), second.suggestedFilename()); await page.locator('#downloadFailed').click();
    });
    await check('Chrome 修改立即更新狀態、取消草稿保留既有 dirty、刪除帳密', async () => {
      await page.locator('#allFilter').click(); await page.locator('[data-id="test-1"]').click();
      await page.locator('[data-field="account"]').fill('fake-edited@example.invalid');
      assert.equal(await page.locator('#backupState').textContent(), '尚未匯出');
      await fillDraft(page, '虛構取消'); await page.locator('#cancelDraftBtn').click();
      assert.equal(await page.locator('#backupState').textContent(), '尚未匯出');
      await page.locator('[data-id="test-2"]').click(); await page.locator('#deleteBtn').click();
      assert.equal(await page.locator('[data-id="test-2"]').count(), 0);
    });
    await check('Chrome 寫檔失敗及成功，黃色提示保留到成功 close', async () => {
      await fillDraft(page, '虛構寫檔'); await page.locator('#completeBtn').click();
      await page.evaluate(() => { window.showSaveFilePicker = async () => ({ name: 'FAKE-failed.pvault', createWritable: async () => ({ write: async () => { throw new Error('FAKE failure'); }, close: async () => {}, abort: async () => {} }) }); });
      await page.locator('#saveBtn').click(); await page.waitForFunction(() => !document.querySelector('#saveBtn').disabled);
      assert.equal(await page.locator('#items .is-new-unsaved').count(), 1);
      assert.equal(await page.locator('#backupState').textContent(), '尚未匯出');
      await page.evaluate(() => { window.showSaveFilePicker = async () => ({ name: 'FAKE-written.pvault', createWritable: async () => ({ write: async blob => { window.fakeWritten = await blob.text(); }, close: async () => { window.fakeClosed = true; }, abort: async () => {} }) }); });
      await page.locator('#saveBtn').click(); await page.waitForFunction(() => window.fakeClosed && !document.querySelector('#saveBtn').disabled);
      assert.equal(await page.locator('#backupState').getAttribute('class'), 'saved');
      assert.equal(await page.locator('#items .is-new-unsaved').count(), 0);
      assert.ok((await decryptVault(JSON.parse(await page.evaluate(() => window.fakeWritten)), TEST_PASSWORD)).items.some(i => i.title === '虛構寫檔'));
    });
    await check('Chrome 匯出途中修改不被錯誤標成已備份', async () => {
      await page.locator('#allFilter').click();
      await page.locator('[data-id="test-1"]').click();
      await page.evaluate(() => {
        window.fakeClosed = false;
        window.showSaveFilePicker = async () => ({ name: 'FAKE-snapshot.pvault', createWritable: async () => ({
          write: async blob => { window.fakeWritten = await blob.text(); await new Promise(resolve => { window.finishFakeWrite = resolve; }); },
          close: async () => { window.fakeClosed = true; }, abort: async () => {}
        }) });
      });
      await page.locator('#saveBtn').click();
      await page.waitForFunction(() => typeof window.finishFakeWrite === 'function');
      await page.locator('[data-field="account"]').fill('fake-during-export@example.invalid');
      await page.evaluate(() => window.finishFakeWrite());
      await page.waitForFunction(() => window.fakeClosed && !document.querySelector('#saveBtn').disabled);
      assert.equal(await page.locator('#backupState').textContent(), '尚未匯出');
      const saved = await decryptVault(JSON.parse(await page.evaluate(() => window.fakeWritten)), TEST_PASSWORD);
      assert.equal(saved.items.find(i => i.id === 'test-1').account, 'fake-edited@example.invalid');
    });
    await check('Chrome 鎖定清除明文 DOM', async () => {
      await page.locator('#lockBtn').click(); await page.locator('#login').waitFor({ state: 'visible' });
      for (const id of ['detailBody', 'items', 'folders', 'modalCard']) assert.equal(await page.locator('#' + id).textContent(), '');
      assert.equal(await page.locator('[data-field="password"]').count(), 0);
    });
    await check('Chrome 舊 HTML 匯入完整性与損毀拒絕', async () => {
      const legacy = legacyData();
      await page.locator('#legacyFile').setInputFiles({ name: 'fictional-legacy.html', mimeType: 'text/html', buffer: Buffer.from(`<script id="embedded-data" type="application/json">${JSON.stringify(legacy)}</script>`) });
      await page.locator('#acceptLegacy').click(); assert.equal(await page.locator('#items .item').count(), 3);
      await page.locator('#lockBtn').click();
      legacy.columns['col-finance'].taskIds.push('missing');
      await page.locator('#legacyFile').setInputFiles({ name: 'fictional-broken.html', mimeType: 'text/html', buffer: Buffer.from(`<script id="embedded-data" type="application/json">${JSON.stringify(legacy)}</script>`) });
      await page.waitForFunction(() => document.querySelector('#loginMsg').textContent.includes('未匯入任何資料'));
      assert.equal(await page.locator('#acceptLegacy').count(), 0);
    });
    await context.close();
  } finally { await browser.close(); }

  for (const [engineName, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
    const browser = await engine.launch({ headless: true });
    try {
      const { page, context } = await makePage(browser, devices['iPhone 13']);
      await check(`${engineName} 手機解鎖先顯示分類，無帳號清單`, async () => {
        await unlock(page); assert.equal(await page.locator('.sidebar').isVisible(), true);
        assert.equal(await page.locator('.list-panel').isVisible(), false);
        assert.equal(await page.locator('.detail').isVisible(), false);
        assert.equal(await page.locator('#addBtn').isVisible(), false);
        assert.equal(await page.locator('#saveBtn').isVisible(), false);
        assert.equal(await page.locator('#newVaultBtn').isVisible(), false);
        await page.screenshot({ path: `test-results/${engineName}-categories.png`, fullPage: true });
        await page.evaluate(() => { document.querySelector('#addBtn').click(); document.querySelector('#saveBtn').click(); });
        assert.equal(await page.locator('[data-field]').count(), 0);
      });
      await check(`${engineName} 跨分類搜尋「銀」、查閱、顯示及複製`, async () => {
        await page.locator('[data-folder="work"]').click(); await page.locator('#searchInput').fill('銀');
        assert.equal(await page.locator('#items .item').count(), 1);
        await page.locator('#items .item').click();
        assert.equal(await page.locator('#val-account').textContent(), 'fake-bank@example.invalid');
        assert.equal(await page.locator('[data-field]').count(), 0);
        await page.locator('[data-action="reveal"]').click(); assert.equal(await page.locator('#val-password').textContent(), 'FAKE-ONLY-bank-123!');
        await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.fakeCopied = value; } } }); });
        await page.locator('[data-copy="password"]').click();
        assert.equal(await page.evaluate(() => window.fakeCopied), 'FAKE-ONLY-bank-123!');
        await page.locator('#backToFoldersBtn').click(); assert.equal(await page.locator('.list-panel').isVisible(), false);
      });
      await check(`${engineName} 手機寬視窗仍唯讀及先顯示分類`, async () => {
        await page.setViewportSize({ width: 1100, height: 500 });
        assert.equal(await page.locator('.list-panel').isVisible(), false);
        assert.equal(await page.locator('.sidebar').isVisible(), true);
        assert.equal(await page.locator('#saveBtn').isVisible(), false);
      });
      await check(`${engineName} 背景計時器暫停，回前景立即自動鎖定`, async () => {
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.clock.setSystemTime(await page.evaluate(() => Date.now() + 20000));
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
        assert.equal(await page.locator('#app').isVisible(), true);
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.clock.setSystemTime(await page.evaluate(() => Date.now() + 31000));
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.locator('#login').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#detailBody').textContent(), '');
        await unlock(page); assert.equal(await page.locator('.list-panel').isVisible(), false);
      });
      await context.close();
    } finally { await browser.close(); }
  }
  assert.deepEqual(errors, []);
  const standaloneBrowser = await chromium.launch({ headless: true });
  try {
    const context = await standaloneBrowser.newContext();
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => errors.push(error.message));
    await check('直接開啟 index.html 顯示未載入提示', async () => {
      await page.goto(pathToFileURL(path.resolve('index.html')).href);
      assert.equal(await page.locator('#startupNotice').isVisible(), true);
    });
    await check('單檔 file:// 顯示版本號並成功匯入旧 HTML', async () => {
      await page.goto(pathToFileURL(path.resolve(standaloneName)).href);
      assert.equal(await page.locator('#loginVersion').textContent(), 'v' + APP_VERSION);
      assert.equal(await page.locator('#startupNotice').isVisible(), false);
      const legacy = legacyData(); delete legacy.columnOrder;
      await page.locator('#legacyFile').setInputFiles({ name: 'fake-legacy.html', mimeType: 'text/html', buffer: Buffer.from(`<script id="embedded-data" type="application/json">${JSON.stringify(legacy)}</script>`) });
      await page.locator('#acceptLegacy').click(); assert.equal(await page.locator('#items .item').count(), 3);
      await page.locator('[data-id="legacy-1"]').click();
      assert.equal(await page.locator('[data-field="password"]').inputValue(), 'FAKE-ONLY-legacy!');
      await page.locator('#lockBtn').click();
    });
    await check('沒有 embedded-data 的 HTML 顯示原因，同一檔可重新選取', async () => {
      const file = { name: 'fake-app.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><title>FAKE App only</title>') };
      await page.locator('#legacyFile').setInputFiles(file);
      await page.waitForFunction(() => document.querySelector('#loginMsg').textContent.includes('沒有舊版內嵌資料'));
      assert.equal(await page.locator('#loginMsg').isVisible(), true);
      assert.equal(await page.locator('#unlockBox').isVisible(), false);
      await page.evaluate(() => { document.querySelector('#loginMsg').textContent = ''; });
      await page.locator('#legacyFile').setInputFiles(file);
      await page.waitForFunction(() => document.querySelector('#loginMsg').textContent.includes('沒有舊版內嵌資料'));
      assert.equal(await page.locator('#legacyFile').inputValue(), '');
    });
    await check('單檔 file:// 解鎖舊版加密密碼庫', async () => {
      await unlock(page);
      assert.equal(await page.locator('#items .item').count(), 2);
      await page.locator('[data-id="test-1"]').click();
      assert.equal(await page.locator('[data-field="password"]').inputValue(), 'FAKE-ONLY-bank-123!');
    });
    assert.deepEqual(errors, []); await context.close();
  } finally { await standaloneBrowser.close(); }
  console.log(`Browser checks passed: ${passed}; page errors: 0`);
} finally { server.close(); }
