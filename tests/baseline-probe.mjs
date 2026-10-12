import { chromium, devices } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { sampleVault, TEST_MASTER } from './fixtures.mjs';
const browser = await chromium.launch();
const results = [];
try {
  const pc = await browser.newContext(); const page = await pc.newPage(); page.on('dialog', d => d.accept());
  await page.goto(pathToFileURL(path.resolve('tests/reference-v2.1.html')).href);
  const payload = await page.evaluate(async ({ data, password }) => encrypt(data, password), { data: sampleVault(), password: TEST_MASTER });
  const file = { name: 'FAKE-ONLY-test.pvault', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) };
  async function unlock(p) { await p.locator('#vaultInput').setInputFiles(file); await p.locator('#masterInput').fill(TEST_MASTER); await p.locator('#unlockBtn').click(); await p.locator('#app').waitFor({ state: 'visible' }); }
  await unlock(page);
  await page.locator('#search').fill('tw'); const first = await page.locator('.entry-card').count(); await page.locator('#search').fill('twi');
  results.push({ check: 'tw→twi', passes: first === 1 && await page.locator('.entry-card').count() === 1 }); await page.locator('#search').fill('');
  await page.locator('#addItem').click(); await page.locator('#d-title').fill('FAKE completed'); await page.locator('#d-account').fill('fake-new@example.invalid'); await page.locator('#d-password').fill('FAKE-ONLY-new!'); await page.locator('#d-complete').click();
  results.push({ check: '完成新增清除草稿', passes: await page.evaluate(() => draft === null && pendingCheck()) });
  await page.evaluate(() => { const original = crypto.subtle.encrypt.bind(crypto.subtle); crypto.subtle.encrypt = async (...args) => { await new Promise(resolve => { window.releaseEncrypt = resolve; }); return original(...args); }; });
  await page.locator('#exportBtn').click(); await page.waitForFunction(() => typeof window.releaseEncrypt === 'function');
  await page.locator('[data-item-id="fake-twitter"] [data-field="account"]').fill('fake-during-export@example.invalid');
  const download = page.waitForEvent('download'); await page.evaluate(() => window.releaseEncrypt()); await download;
  results.push({ check: '匯出期間修改保留', passes: await page.evaluate(() => vault.items.find(i => i.id === 'fake-twitter').account === 'fake-during-export@example.invalid' && dirty) });
  await page.evaluate(() => handleTxt([{ name: 'FAKE-ONLY.txt', text: async () => 'FAKE spaced TXT\nfake-spaces@example.invalid\n  FAKE-ONLY-spaces!  ' }]));
  results.push({ check: 'TXT 密碼首尾空白保留', passes: await page.evaluate(() => vault.items.find(i => i.title === 'FAKE spaced TXT').password === '  FAKE-ONLY-spaces!  ') });
  await page.locator('#lockBtn').click();
  results.push({ check: '鎖定移除明文 DOM', passes: await page.locator('.entry-card input').count() === 0 });
  const mobile = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 1100, height: 700 } }); const phone = await mobile.newPage();
  await phone.goto(pathToFileURL(path.resolve('tests/reference-v2.1.html')).href); await unlock(phone);
  results.push({ check: '手機寬視窗仍分類且無可編輯看板', passes: await phone.locator('.workspace').isVisible() === false && await phone.locator('.mobile-folders').isVisible() });
  await phone.evaluate(() => { Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true }); });
  console.log(JSON.stringify(results, null, 2)); await fs.mkdir('.maintenance', { recursive: true }); await fs.writeFile('.maintenance/baseline-probe.json', JSON.stringify(results, null, 2));
  await pc.close(); await mobile.close();
} finally { await browser.close(); }
