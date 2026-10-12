import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { chromium, webkit, devices } from 'playwright';
import { createServer } from './server.mjs';
import { v20Context, appContext, sampleVault, legacyVault, TEST_MASTER, plain } from './fixtures.mjs';
const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const payload = await v20Context().encryptVault(sampleVault(), TEST_MASTER);
const fixture = { name: 'FAKE-ONLY-test.pvault', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) };
const errors = [], network = []; let passed = 0;
let encryptedHTML;
await fs.mkdir('test-results', { recursive: true });
async function check(name, task) { await task(); passed++; console.log('PASS ' + name); }
async function createPage(browser, options = {}, url = base, platformOverride = 'MacIntel') {
  const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'Asia/Tokyo', ...options });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', d => d.accept());
  await context.route('**/*', route => {
    const url = route.request().url();
    if (!url.startsWith(base) && !url.startsWith('file://')) { network.push(url); return route.abort(); }
    return route.continue();
  });
  if (options.isMobile) await page.clock.install();
  if (options.hasTouch && options.userAgent?.includes('Macintosh')) await page.addInitScript(platform => { Object.defineProperty(navigator, 'platform', { value: platform }); Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 }); }, platformOverride);
  await page.goto(url); return { page, context };
}
async function unlock(page, file = fixture, password = TEST_MASTER) {
  await page.locator('#vaultInput').setInputFiles(file); await page.locator('#masterInput').fill(password);
  await page.locator('#unlockBtn').click(); await page.locator('#app').waitFor({ state: 'visible' });
}
async function addItem(page, title = '虛構新增帳號', folder = 'finance') {
  await page.locator('#addItem').click(); await page.locator('#d-title').fill(title);
  await page.locator('#d-account').fill('fake-new@example.invalid'); await page.locator('#d-password').fill('FAKE-ONLY-new!');
  await page.locator('#d-notes').fill('虚構多行備註\n中文'); await page.locator('#d-folder').selectOption(folder);
  await page.locator('#d-complete').click(); return page.evaluate(title => vault.items.find(i => i.title === title).id, title);
}
const card = (page, id) => page.locator(`[data-item-id="${id}"]`);
const column = (page, id) => page.locator(`.column[data-folder-id="${id}"]`);
async function downloadBackup(page, html = false) {
  const promise = page.waitForEvent('download'); await page.locator(html ? '#htmlExportBtn' : '#exportBtn').click();
  const download = await promise; await page.locator('#backupConfirm').waitFor();
  return { download, body: await fs.readFile(await download.path(), 'utf8') };
}
try {
  const browser = await chromium.launch(); console.log('Chrome for Testing ' + browser.version());
  try {
    const { page, context } = await createPage(browser, { viewport: { width: 1440, height: 1000 } });
    await check('PC 讀取 v2.0 .pvault 與版本號一致', async () => {
      await unlock(page); assert.equal(await page.locator('.entry-card').count(), 3);
      assert.equal(await page.locator('#loginVersion').textContent(), 'v2.1'); assert.equal(await page.locator('#appVersion').textContent(), 'v2.1');
      assert.equal(await page.locator('#masterInput').inputValue(), '');
      assert.deepEqual(await page.evaluate(() => vault.items), sampleVault().items);
    });
    await check('PC 原提供版與修正版初始介面像素一致', async () => {
      const reference = await createPage(browser, { viewport: { width: 1440, height: 1000 } }, pathToFileURL(path.resolve('tests/reference-v2.1.html')).href);
      await unlock(reference.page);
      const original = await reference.page.screenshot({ path: 'test-results/pc-original.png', caret: 'hide', animations: 'disabled' });
      const current = await page.screenshot({ path: 'test-results/pc-review.png', caret: 'hide', animations: 'disabled' });
      assert.equal(current.equals(original), true, 'PC 原版樣式發生差異'); await reference.context.close();
    });
    await check('草稿取消不新增、不改 dirty，完成新增清除草稿並標黃', async () => {
      await page.locator('#addItem').click(); await page.locator('#d-title').fill('FAKE cancel'); await page.locator('#d-cancel').click();
      assert.equal(await page.evaluate(() => draft === null && !dirty && vault.items.length === 3), true);
      const id = await addItem(page); assert.equal(await page.evaluate(() => draft === null && pendingCheck()), true);
      assert.equal(await card(page, id).getAttribute('class'), 'entry-card pending'); assert.equal(await column(page, 'finance').locator('.folder-count').textContent(), '2');
    });
    const newId = await page.evaluate(() => vault.items.find(i => i.title === '虛構新增帳號').id);
    await check('修改標題、帳號、密碼、備註及分類即時保存', async () => {
      await card(page, newId).locator('.entry-title').fill('虛構修改帳號');
      await card(page, newId).locator('[data-field="account"]').fill('fake-edited@example.invalid');
      await card(page, newId).locator('[data-field="password"]').fill('FAKE-ONLY-edited!');
      await card(page, newId).locator('[data-field="notes"]').fill('虛構更新備註\n下一行');
      await card(page, newId).locator('select').selectOption('social');
      const value = await page.evaluate(id => vault.items.find(i => i.id === id), newId);
      assert.equal(value.folderId, 'social'); assert.equal(value.password, 'FAKE-ONLY-edited!');
      assert.equal(await page.locator('#saveState').textContent(), '尚未匯出'); assert.equal(await column(page, 'social').locator('.folder-count').textContent(), '2');
      assert.ok((await column(page, 'social').getAttribute('class')).includes('pending'));
      assert.ok(!(await column(page, 'finance').getAttribute('class')).includes('pending'));
    });
    let folderId;
    await check('新增資料夾、修改名稱、變色、收合與展開', async () => {
      await page.locator('#addFolder').click(); await page.locator('#f-name').fill('虛構測試資料夾'); await page.locator('#f-confirm').click();
      folderId = await page.evaluate(() => vault.folders.find(f => f.name === '虛構測試資料夾').id);
      await column(page, folderId).locator('.folder-title').fill('虛構改名'); await column(page, folderId).locator('.folder-title').press('Tab');
      const color = await page.evaluate(id => vault.folders.find(f => f.id === id).color, folderId);
      await column(page, folderId).locator('.folder-color').click(); assert.notEqual(await page.evaluate(id => vault.folders.find(f => f.id === id).color, folderId), color);
      await column(page, folderId).getByRole('button', { name: '展開或收合' }).click(); assert.ok((await column(page, folderId).getAttribute('class')).includes('collapsed'));
      await column(page, folderId).getByRole('button', { name: '展開或收合' }).click(); assert.equal(await column(page, folderId).locator('.column-cards').isVisible(), true);
    });
    await check('真正滑鼠拖曳帳密跨資料夾與資料夾排序', async () => {
      await card(page, newId).dragTo(column(page, folderId).locator('.column-head'), { sourcePosition: { x: 8, y: 8 }, targetPosition: { x: 20, y: 20 } });
      assert.equal(await page.evaluate(id => vault.items.find(i => i.id === id).folderId, newId), folderId);
      await column(page, folderId).dragTo(column(page, 'social').locator('.column-head'), { sourcePosition: { x: 100, y: 6 }, targetPosition: { x: 20, y: 20 } });
      const ids = await page.evaluate(() => vault.folders.map(f => f.id)); assert.ok(ids.indexOf(folderId) < ids.indexOf('social'));
    });
    await check('刪除資料夾保留其中帳密，移到未分類；刪除帳密不影響其他資料', async () => {
      await column(page, folderId).getByRole('button', { name: '刪除資料夾' }).click();
      assert.equal(await page.evaluate(id => vault.items.find(i => i.id === id).folderId, newId), 'uncategorized');
      assert.equal(await page.locator('#uncatCount').textContent(), '1');
      await card(page, 'fake-work').getByRole('button', { name: '刪除帳密' }).click(); assert.equal(await card(page, 'fake-work').count(), 0);
      assert.equal(await page.evaluate(() => vault.items.length), 3);
    });
    await check('tw→twi→twitter 逐字搜尋與中文包含搜尋', async () => {
      for (const query of ['tw', 'twi', 'twitter']) { await page.locator('#search').fill(query); assert.equal(await page.locator('.entry-card').count(), 1); assert.equal(await card(page, 'fake-twitter').count(), 1); }
      await page.locator('#search').fill('銀'); assert.equal(await card(page, 'fake-bank').count(), 1);
      await page.locator('#search').fill('未分類'); assert.equal(await card(page, newId).count(), 1);
      await page.locator('#search').fill('fake-bank'); assert.equal(await card(page, 'fake-bank').count(), 1); await page.locator('#search').fill('');
    });
    await check('單獨檢視資料夾時搜尋仍涵蓋其他分類', async () => {
      await column(page, 'social').locator('.folder-count').dblclick(); assert.equal(await page.evaluate(() => focusedFolder), 'social');
      await page.locator('#search').fill('銀'); assert.equal(await card(page, 'fake-bank').count(), 1);
      await page.locator('#search').fill(''); await page.getByRole('button', { name: '← 返回總覽' }).click();
    });
    await check('.pvault 真實下載、逐欄核對、確認前保留 dirty 與黃色', async () => {
      const expected = await page.evaluate(() => { const v = structuredClone(vault); for (const i of v.items) { i.pendingBackup = false; i.isDraft = false; } return v; });
      const exported = await downloadBackup(page); const decoded = await appContext().decrypt(JSON.parse(exported.body), TEST_MASTER);
      assert.deepEqual(plain(decoded), expected); assert.equal(await page.evaluate(() => dirty), true);
      assert.equal(await card(page, newId).getAttribute('class'), 'entry-card pending'); await page.locator('#backupConfirm').click();
      assert.equal(await page.evaluate(() => dirty), false); assert.equal(await page.locator('.entry-card.pending').count(), 0);
      const second = await downloadBackup(page); assert.notEqual(exported.download.suggestedFilename(), second.download.suggestedFilename()); await page.locator('#backupCancel').click();
    });
    await check('取消下載確認及加密失敗不清除未備份狀態', async () => {
      await card(page, 'fake-twitter').locator('[data-field="account"]').fill('fake-before-race@example.invalid');
      await downloadBackup(page); await page.locator('#backupCancel').click(); assert.equal(await page.evaluate(() => dirty), true);
      await page.evaluate(() => { window.savedEncrypt = crypto.subtle.encrypt.bind(crypto.subtle); crypto.subtle.encrypt = async () => { throw new Error('FAKE failure'); }; });
      await page.locator('#exportBtn').click(); await page.waitForFunction(() => !document.querySelector('#exportBtn').disabled);
      assert.equal(await page.evaluate(() => dirty), true); assert.equal(await page.locator('#backupConfirm').count(), 0);
      await page.evaluate(() => { crypto.subtle.encrypt = window.savedEncrypt; });
    });
    await check('加密匯出途中修改不被覆蓋，也不被標成已備份', async () => {
      await page.evaluate(() => { const actual = crypto.subtle.encrypt.bind(crypto.subtle); window.savedEncrypt = actual; crypto.subtle.encrypt = async (...args) => { await new Promise(resolve => { window.releaseEncrypt = resolve; }); return actual(...args); }; });
      await page.locator('#exportBtn').click(); await page.waitForFunction(() => !!window.releaseEncrypt);
      await card(page, 'fake-twitter').locator('[data-field="account"]').fill('fake-during-race@example.invalid');
      const download = page.waitForEvent('download'); await page.evaluate(() => window.releaseEncrypt()); const result = await download;
      const decoded = await appContext().decrypt(JSON.parse(await fs.readFile(await result.path(), 'utf8')), TEST_MASTER);
      assert.equal(decoded.items.find(i => i.id === 'fake-twitter').account, 'fake-before-race@example.invalid');
      assert.equal(await card(page, 'fake-twitter').locator('[data-field="account"]').inputValue(), 'fake-during-race@example.invalid');
      await page.locator('#backupConfirm').click(); assert.equal(await page.evaluate(() => dirty), true); await page.evaluate(() => { crypto.subtle.encrypt = window.savedEncrypt; });
    });
    await check('加密 HTML 不含明文帳密或主密碼，内嵌密文可解密', async () => {
      const result = await downloadBackup(page, true); encryptedHTML = result.body;
      for (const sensitive of [TEST_MASTER, 'fake-during-race@example.invalid', 'FAKE-ONLY-edited!', '虛構修改帳號']) assert.ok(!encryptedHTML.includes(sensitive));
      const embedded = encryptedHTML.match(/<script id="embedded-vault" type="application\/json">([\s\S]*?)<\/script>/)[1];
      assert.equal((await appContext().decrypt(JSON.parse(embedded), TEST_MASTER)).items.length, 3);
      await fs.writeFile('test-results/FAKE-ONLY-encrypted.html', encryptedHTML); await page.locator('#backupConfirm').click();
    });
    await check('加密 HTML 直接双擊解鎖，二次匯出仍無明文', async () => {
      const backup = await createPage(browser, {}, pathToFileURL(path.resolve('test-results/FAKE-ONLY-encrypted.html')).href);
      await backup.page.locator('#masterInput').fill(TEST_MASTER); await backup.page.locator('#unlockBtn').click(); await backup.page.locator('#app').waitFor({ state: 'visible' });
      assert.equal(await backup.page.locator('.entry-card').count(), 3);
      const twice = await downloadBackup(backup.page, true); assert.ok(!twice.body.includes('FAKE-ONLY-edited!')); assert.ok(!twice.body.includes(TEST_MASTER));
      await backup.page.locator('#backupCancel').click(); await backup.context.close();
    });
    await check('加密 HTML 與 .pvault 重新匯入後逐欄一致', async () => {
      const expected = await page.evaluate(() => vault.items); await page.locator('#lockBtn').click();
      await page.locator('#htmlInput').setInputFiles({ name: 'FAKE-ONLY-backup.html', mimeType: 'text/html', buffer: Buffer.from(encryptedHTML) });
      await page.locator('#masterInput').fill(TEST_MASTER); await page.locator('#unlockBtn').click(); await page.locator('#app').waitFor({ state: 'visible' });
      assert.deepEqual(await page.evaluate(() => vault.items), expected);
      const p = await downloadBackup(page); await page.locator('#backupConfirm').click(); await page.locator('#lockBtn').click();
      await unlock(page, { name: 'FAKE-ONLY-roundtrip.pvault', mimeType: 'application/json', buffer: Buffer.from(p.body) });
      assert.deepEqual(await page.evaluate(() => vault.items), expected);
    });
    await check('CSV 預設不含密碼，明確勾選才含密碼，公式注入有防護', async () => {
      await card(page, 'fake-twitter').locator('[data-field="account"]').fill('=FAKE_FORMULA()');
      await page.locator('#csvBtn').click(); assert.equal(await page.locator('#csvPasswords').isChecked(), false);
      let promise = page.waitForEvent('download'); await page.locator('#csvConfirm').click(); let csv = await fs.readFile(await (await promise).path(), 'utf8');
      assert.ok(!csv.includes('FAKE-ONLY-twitter!')); assert.ok(csv.includes("'=FAKE_FORMULA()"));
      await page.locator('#csvBtn').click(); await page.locator('#csvPasswords').check(); promise = page.waitForEvent('download'); await page.locator('#csvConfirm').click(); csv = await fs.readFile(await (await promise).path(), 'utf8');
      assert.ok(csv.includes('FAKE-ONLY-twitter!')); assert.equal(await page.evaluate(() => dirty), true);
    });
    await check('TXT 新增與確認後進未分類，不清除既有 dirty', async () => {
      await page.locator('#txtInput').setInputFiles({ name: 'FAKE-ONLY.txt', mimeType: 'text/plain', buffer: Buffer.from('虛構 TXT\nfake-txt@example.invalid\nFAKE-ONLY-txt!\n中文備註\n\n虛構第二筆\nfake-second@example.invalid\nFAKE-ONLY-second!\n\n虛構 TXT 空白\n  fake-spaces@example.invalid  \n  FAKE-ONLY-spaces!  ') });
      await page.waitForFunction(() => vault.items.some(i => i.title === '虛構 TXT'));
      assert.equal(await page.evaluate(() => vault.items.find(i => i.title === '虛構 TXT').folderId), 'uncategorized'); assert.equal(await page.evaluate(() => dirty), true);
      assert.equal(await page.evaluate(() => vault.items.find(i => i.title === '虛構 TXT 空白').password), '  FAKE-ONLY-spaces!  ');
      assert.equal(await page.evaluate(() => vault.items.find(i => i.title === '虛構 TXT 空白').account), '  fake-spaces@example.invalid  ');
    });
    await check('鎖定清除主密碼、明文看板、詳細及草稿 DOM', async () => {
      await page.locator('#addItem').click(); await page.locator('#d-password').fill('FAKE-ONLY-draft!');
      await page.evaluate(() => lockForced());
      for (const id of ['desktopBoard', 'uncatItems', 'mobileItems', 'mobileDetail', 'modalBody']) assert.equal(await page.locator('#' + id).textContent(), '');
      assert.equal(await page.locator('#masterInput').inputValue(), ''); assert.equal(await page.evaluate(() => vault === null && draft === null && masterPassword === ''), true);
    });
    await check('不完整 JSON 不把帳密片段印在錯誤訊息，同檔可重選', async () => {
      const malformed = { name: 'FAKE-ONLY-broken.pvault', mimeType: 'application/json', buffer: Buffer.from('{"password":"FAKE-ONLY-DO-NOT-ECHO" invalid') };
      await page.locator('#vaultInput').setInputFiles(malformed); await page.waitForFunction(() => document.querySelector('#loginStatus').textContent.includes('讀取失敗'));
      assert.ok(!(await page.locator('#loginStatus').textContent()).includes('FAKE-ONLY-DO-NOT-ECHO'));
      await page.evaluate(() => document.querySelector('#loginStatus').textContent = ''); await page.locator('#vaultInput').setInputFiles(malformed);
      await page.waitForFunction(() => document.querySelector('#loginStatus').textContent.includes('讀取失敗'));
    });
    await check('v7 HTML 完整匯入與惡意脚本／圖片保持惰性', async () => {
      const data = legacyVault(); const html = `<img src="https://example.invalid/FAKE-ONLY" onerror="window.fakeExecuted=true"><script>window.fakeExecuted=true</script><script id="embedded-data" type="application/json">${JSON.stringify(data)}</script>`;
      await page.locator('#htmlInput').setInputFiles({ name: 'FAKE-ONLY-legacy.html', mimeType: 'text/html', buffer: Buffer.from(html) });
      await page.locator('#legacyOK').click(); assert.equal(await page.locator('.entry-card').count(), 3);
      assert.equal(await page.evaluate(() => !!window.fakeExecuted), false); assert.equal(network.length, 0);
      assert.equal(await page.evaluate(() => vault.items.find(i => i.id === 'legacy-bank').folderId), 'col-finance');
    });
    await check('讀取損毀 HTML 不取代目前資料，重複備份節點拒絕', async () => {
      const before = await page.evaluate(() => contentSnapshot(vault)); const d = legacyVault(); d.columns['col-social'].taskIds.push('missing');
      await page.locator('#htmlInputPC').setInputFiles({ name: 'FAKE-ONLY-bad.html', mimeType: 'text/html', buffer: Buffer.from(`<script id="embedded-data">${JSON.stringify(d)}</script>`) });
      await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('匯入失敗')); assert.equal(await page.evaluate(() => contentSnapshot(vault)), before);
      const duplicate = `<script id="embedded-vault">${JSON.stringify(payload)}</script><script id="embedded-vault">${JSON.stringify(payload)}</script>`;
      await page.locator('#htmlInputPC').setInputFiles({ name: 'FAKE-ONLY-duplicate.html', mimeType: 'text/html', buffer: Buffer.from(duplicate) });
      await page.waitForFunction(() => document.querySelector('#loginStatus').textContent.includes('匯入失敗')); assert.equal(await page.evaluate(() => contentSnapshot(vault)), before);
    });
    await check('窄視窗 Windows 仍可管理，不被誤判手機唯讀', async () => {
      await page.setViewportSize({ width: 700, height: 900 }); assert.equal(await page.locator('#addItem').isVisible(), true);
      assert.equal(await page.evaluate(() => modeMobile()), false); await page.locator('#addItem').click(); await page.locator('#d-cancel').click();
    });
    await context.close();
    await check('正常 index.html 可直接双擊，建立空庫並設定主密碼匯出', async () => {
      const local = await createPage(browser, {}, pathToFileURL(path.resolve('index.html')).href);
      await local.page.locator('#newVault').click(); await addItem(local.page, '虛構新增帳號', 'personal');
      await local.page.locator('#exportBtn').click(); await local.page.locator('#p1').fill(TEST_MASTER); await local.page.locator('#p2').fill(TEST_MASTER);
      const download = local.page.waitForEvent('download'); await local.page.locator('#p-confirm').click(); const saved = await download;
      assert.equal((await appContext().decrypt(JSON.parse(await fs.readFile(await saved.path(), 'utf8')), TEST_MASTER)).items.length, 1);
      await local.page.locator('#backupConfirm').click(); assert.equal(await local.page.evaluate(() => draft === null && !dirty), true); await local.context.close();
    });
    await check('解密途中開空庫不被舊結果取代；匯出途中鎖定無延遲下載', async () => {
      const fresh = await createPage(browser); const p = fresh.page;
      await p.evaluate(() => { window.nativeDecrypt = crypto.subtle.decrypt.bind(crypto.subtle); crypto.subtle.decrypt = async (...args) => { await new Promise(resolve => { window.releaseDecrypt = resolve; }); const result = await window.nativeDecrypt(...args); window.decryptSettled = true; return result; }; });
      await p.locator('#vaultInput').setInputFiles(fixture); await p.locator('#masterInput').fill(TEST_MASTER); await p.locator('#unlockBtn').click();
      await p.waitForFunction(() => !!window.releaseDecrypt); await p.locator('#newVault').click(); await p.evaluate(() => window.releaseDecrypt()); await p.waitForFunction(() => window.decryptSettled);
      assert.equal(await p.evaluate(() => vault.items.length), 0); assert.equal(await p.locator('#masterInput').inputValue(), '');
      await p.locator('#lockBtn').click(); await p.evaluate(() => { crypto.subtle.decrypt = window.nativeDecrypt; }); await unlock(p);
      let downloads = 0; p.on('download', () => downloads++);
      await p.evaluate(() => { const original = crypto.subtle.encrypt.bind(crypto.subtle); crypto.subtle.encrypt = async (...args) => { await new Promise(resolve => { window.releaseEncrypt = resolve; }); return original(...args); }; });
      await p.locator('#exportBtn').click(); await p.waitForFunction(() => !!window.releaseEncrypt); await p.locator('#lockBtn').click(); await p.evaluate(() => window.releaseEncrypt());
      await p.waitForFunction(() => !document.querySelector('#exportBtn').disabled);
      assert.equal(downloads, 0); assert.equal(await p.evaluate(() => vault === null && pendingSave === null), true); await fresh.context.close();
    });
    await check('主密碼視窗按背景取消後可再次匯出，不殘留等待狀態', async () => {
      const fresh = await createPage(browser); const p = fresh.page;
      await p.locator('#newVault').click(); await addItem(p, '虛構主密碼取消', 'personal'); await p.locator('#exportBtn').click(); await p.locator('#p1').waitFor();
      await p.locator('#modal').click({ position: { x: 2, y: 2 } }); await p.waitForFunction(() => !exportBusy);
      await p.locator('#exportBtn').click(); await p.locator('#p1').waitFor(); await p.locator('#p-cancel').click(); await p.waitForFunction(() => !exportBusy);
      assert.equal(await p.evaluate(() => dirty && draft === null), true); await fresh.context.close();
    });
  } finally { await browser.close(); }
  for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
    const browser = await engine.launch();
    try {
      const { page, context } = await createPage(browser, devices['iPhone 13']);
      await check(`${name} 手機先顯示分類，無帳號或可編輯看板`, async () => {
        await unlock(page); assert.equal(await page.locator('.mobile-folders').isVisible(), true); assert.equal(await page.locator('.mobile-list').isVisible(), false);
        assert.equal(await page.locator('.workspace').isVisible(), false); assert.equal(await page.locator('.entry-card').count(), 0);
        for (const id of ['addItem', 'addFolder', 'exportBtn', 'htmlExportBtn', 'csvBtn']) assert.equal(await page.locator('#' + id).isVisible(), false);
        assert.equal(await page.locator('#newVault').getAttribute('class'), 'btn hidden');
        await page.screenshot({ path: `test-results/${name}-phone-categories.png`, fullPage: true });
      });
      await check(`${name} 唯讀入口無法變更資料或匯出`, async () => {
        const before = await page.evaluate(() => contentSnapshot(vault));
        await page.evaluate(() => { showNewItem(); showNewFolder(); moveItem('fake-twitter', 'finance'); document.querySelector('#newVault').click(); exportCSV(); exportBackup(false); });
        assert.equal(await page.evaluate(() => contentSnapshot(vault)), before); assert.equal(await page.locator('#d-title').count(), 0);
      });
      await check(`${name} 跨分類逐字 Twitter 與「銀」搜尋、查閱、複製`, async () => {
        await page.locator('.mfolder').filter({ hasText: '虛構工作' }).click();
        for (const q of ['tw', 'twi', 'twitter']) { await page.locator('#search').fill(q); assert.equal(await page.locator('.mitem').count(), 1); }
        await page.locator('#search').fill('銀'); await page.locator('.mitem').click();
        assert.equal(await page.locator('.mobile-val').first().textContent(), 'fake-bank@example.invalid');
        await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.fakeCopied = value; } } }));
        await page.getByTitle('複製密碼', { exact: true }).click(); assert.equal(await page.evaluate(() => window.fakeCopied), 'FAKE-ONLY-bank!');
        await page.getByTitle('顯示密碼 12 秒').click(); assert.equal(await page.locator('#mobilePassword').textContent(), 'FAKE-ONLY-bank!');
        await page.clock.fastForward(12001); assert.equal(await page.locator('#mobilePassword').textContent(), '••••••••••••');
        await page.locator('#backBtn').click(); assert.equal(await page.locator('.mobile-folders').isVisible(), true); assert.equal(await page.locator('#search').inputValue(), '');
      });
      await check(`${name} 手機 1100px 橫向仍唯讀分類`, async () => {
        await page.setViewportSize({ width: 1100, height: 700 }); assert.equal(await page.locator('.mobile-folders').isVisible(), true);
        assert.equal(await page.locator('.workspace').isVisible(), false); assert.equal(await page.locator('#addItem').isVisible(), false);
      });
      await check(`${name} 背景短暫保留、計時器停擺後回前景鎖定`, async () => {
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.clock.setSystemTime(await page.evaluate(() => Date.now() + 20000));
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
        assert.equal(await page.locator('#app').isVisible(), true);
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.clock.setSystemTime(await page.evaluate(() => Date.now() + 30000));
        await page.evaluate(() => window.dispatchEvent(new Event('pageshow'))); assert.equal(await page.locator('#login').isVisible(), true);
        assert.equal(await page.locator('#mobileDetail').textContent(), ''); await unlock(page); assert.equal(await page.locator('.mobile-folders').isVisible(), true);
      });
      await check(`${name} 手機匯入加密 HTML 仍先看分類且唯讀`, async () => {
        await page.locator('#lockBtn').click(); await page.locator('#htmlInput').setInputFiles({ name: 'FAKE-ONLY-mobile.html', mimeType: 'text/html', buffer: Buffer.from(encryptedHTML) });
        await page.locator('#masterInput').fill(TEST_MASTER); await page.locator('#unlockBtn').click(); await page.locator('#app').waitFor({ state: 'visible' });
        assert.equal(await page.locator('.mobile-folders').isVisible(), true); assert.equal(await page.locator('.entry-card').count(), 0);
        assert.equal(await page.evaluate(() => vault.items.find(i => i.title === '虛構修改帳號').password), 'FAKE-ONLY-edited!');
      });
      await context.close();
      const ipad = await createPage(browser, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15', viewport: { width: 1200, height: 900 }, hasTouch: true });
      await check(`${name} iPad 桌面 UA 與觸控仍是唯讀`, async () => { await unlock(ipad.page); assert.equal(await ipad.page.evaluate(() => modeMobile()), true); assert.equal(await ipad.page.locator('.workspace').isVisible(), false); });
      await ipad.context.close();
      const phoneDesktop = await createPage(browser, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15', viewport: { width: 1000, height: 700 }, hasTouch: true }, base, 'iPhone');
      await check(`${name} iPhone 桌面 UA 仍依装置資訊唯讀`, async () => { await unlock(phoneDesktop.page); assert.equal(await phoneDesktop.page.evaluate(() => modeMobile()), true); assert.equal(await phoneDesktop.page.locator('.mobile-folders').isVisible(), true); });
      await phoneDesktop.context.close();
    } finally { await browser.close(); }
  }
  assert.deepEqual(errors, []); assert.deepEqual(network, []); console.log(`Browser checks passed: ${passed}; page errors: 0; external requests: 0`);
} finally { server.close(); }
