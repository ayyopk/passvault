import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { APP_VERSION } from '../src/version.js';
import { normalizeVault, contentSnapshot, addDraft, updateItem, completeDraft, removeItem, convertLegacy } from '../src/model.js';
import { encryptVault, decryptVault, validatePayload } from '../src/crypto.js';
import { searchItems } from '../src/search.js';
import { prepareExport, acknowledgeExport, exportFilename } from '../src/export.js';
import { isReadonlyDevice, createBackgroundLock } from '../src/platform.js';
import { sampleVault, legacyData, TEST_PASSWORD, originalCrypto } from './fixtures.mjs';

test('正式 v2.0 原檔 SHA-256 未變', () => {
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../PassVault_2.0.html', import.meta.url))).digest('hex').toUpperCase(), 'A02ACEF826DFB6FD20314AB2E3000EAC1984D5998FA2AAE6E3491BC7C3E3CC6E');
});
test('v2.0 原加密器產生的檔案可解鎖，所有欄位完整保留', async () => {
  const sample = sampleVault(), old = await originalCrypto().encryptVault(sample, TEST_PASSWORD);
  assert.deepEqual(await decryptVault(old, TEST_PASSWORD), sample);
  const normalized = normalizeVault(await decryptVault(old, TEST_PASSWORD));
  assert.deepEqual(normalized.items, sample.items);
  assert.deepEqual(normalized.folders, sample.folders);
});
test('新版匯出可重新解密，也可由 v2.0 解密器讀取', async () => {
  const exported = prepareExport(sampleVault());
  const payload = await encryptVault(exported.data, TEST_PASSWORD);
  assert.deepEqual(await decryptVault(payload, TEST_PASSWORD), exported.data);
  const oldDecoded = await originalCrypto().decryptVault(payload, TEST_PASSWORD);
  assert.deepEqual(JSON.parse(JSON.stringify(oldDecoded)), exported.data);
  assert.equal(payload.appVersion, APP_VERSION);
});
test('錯密碼、竄改密文及不完整加密標頭遭拒絕', async () => {
  const p = await encryptVault(sampleVault(), TEST_PASSWORD);
  await assert.rejects(decryptVault(p, 'FAKE-WRONG-PASSWORD'));
  const cipher = Buffer.from(p.data, 'base64'); cipher[0] ^= 1;
  await assert.rejects(decryptVault({ ...p, data: cipher.toString('base64') }, TEST_PASSWORD));
  for (const invalid of [{ ...p, salt: '!' }, { ...p, iterations: 999999999 }, { ...p, schemaVersion: 2 }, { ...p, cipher: 'unknown' }, { ...p, iv: '' }]) assert.throws(() => validatePayload(invalid));
});
test('舊格式缺省 iterations 仍可讀取', async () => {
  const p = await originalCrypto().encryptVault(sampleVault(), TEST_PASSWORD); delete p.iterations;
  assert.deepEqual(await decryptVault(p, TEST_PASSWORD), sampleVault());
});
test('草稿不進入分類及搜尋，取消後恢復原來 dirty 狀態', () => {
  const v = sampleVault(), baseline = contentSnapshot(v), draft = addDraft(v, 'work');
  updateItem(v, draft, 'title', 'FAKE draft');
  assert.equal(searchItems(v, 'all', 'draft').length, 0);
  assert.equal(contentSnapshot(v), baseline);
  assert.throws(() => prepareExport(v));
  removeItem(v, draft.id); assert.equal(contentSnapshot(v), baseline);
  updateItem(v, v.items[0], 'account', 'FAKE edited');
  const dirty = contentSnapshot(v); const second = addDraft(v, 'work'); removeItem(v, second.id);
  assert.equal(contentSnapshot(v), dirty); assert.notEqual(dirty, baseline);
});
test('新增必須完成、黃色提示直到確認匯出、修改與刪除會 dirty', () => {
  const v = sampleVault(), baseline = contentSnapshot(v), draft = addDraft(v, 'work');
  assert.throws(() => completeDraft(v, draft));
  for (const [field, value] of Object.entries({ title: 'FAKE NEW', account: 'fake-new@example.invalid', password: 'FAKE-ONLY-new!' })) updateItem(v, draft, field, value);
  completeDraft(v, draft); assert.equal(draft.pendingBackup, true); assert.notEqual(contentSnapshot(v), baseline);
  const exported = prepareExport(v); assert.equal(draft.pendingBackup, true); assert.equal(exported.data.items[0].pendingBackup, false);
  assert.equal(acknowledgeExport(v, exported), false); assert.equal(draft.pendingBackup, false);
  updateItem(v, draft, 'account', 'fake-change@example.invalid'); assert.notEqual(contentSnapshot(v), exported.snapshot);
  removeItem(v, 'test-1'); assert.equal(v.items.some(i => i.id === 'test-1'), false);
});
test('匯出途中新增或修改不可被當成已備份', () => {
  const v = sampleVault(), i = addDraft(v, 'work'); Object.assign(i, { title: 'FAKE NEW', account: 'FAKE', password: 'FAKE' }); completeDraft(v, i);
  const exported = prepareExport(v); updateItem(v, i, 'account', 'FAKE CHANGED');
  assert.equal(acknowledgeExport(v, exported), true); assert.equal(i.pendingBackup, true);
  const j = addDraft(v, 'work'); Object.assign(j, { title: 'FAKE NEXT', account: 'FAKE', password: 'FAKE' }); completeDraft(v, j);
  acknowledgeExport(v, exported); assert.equal(j.pendingBackup, true);
});
test('中文包含搜尋跨分類涵蓋標題、帳號、備註及分類名', () => {
  const v = sampleVault(); assert.equal(searchItems(v, 'work', '銀')[0].id, 'test-1');
  for (const field of ['title', 'account', 'notes']) { const s = sampleVault(); s.items[1][field] = '虛構銀色'; assert.equal(searchItems(s, 'finance', '銀').length, 2); }
  assert.equal(searchItems(v, 'finance', ' 測試工作 ')[0].id, 'test-2');
});
test('HTML 匯入包含未排序分類和孤立帳密，不因 t.id 不一致重複資料', () => {
  const data = legacyData(), v = convertLegacy(data);
  assert.equal(v.items.length, 3); assert.equal(new Set(v.items.map(i => i.id)).size, 3);
  assert.equal(v.items.find(i => i.id === 'legacy-2').folderId, 'col-extra');
  assert.equal(v.items.find(i => i.id === 'legacy-orphan').folderId, 'uncategorized');
  for (const [id, item] of Object.entries(data.tasks)) for (const field of ['title', 'account', 'password', 'notes']) assert.equal(v.items.find(i => i.id === id)[field], item[field]);
  assert.equal(v.items[0].url, 'https://example.invalid');
});
test('破損 HTML 索引與密碼庫資料整體拒絕，不默默丟棄', () => {
  const missing = legacyData(); missing.columns['col-finance'].taskIds.push('missing'); assert.throws(() => convertLegacy(missing));
  const duplicate = legacyData(); duplicate.columns['col-extra'].taskIds.push('legacy-1'); assert.throws(() => convertLegacy(duplicate));
  for (const modify of [v => { delete v.items; }, v => { v.schemaVersion = 2; }, v => { v.items[0].password = 123; }, v => { v.items[0].folderId = 'missing'; }, v => { v.items[1].id = v.items[0].id; }]) { const v = sampleVault(); modify(v); assert.throws(() => normalizeVault(v)); }
});
test('唯讀政策不依視窗寬度，含 iPad 桌面 UA', () => {
  assert.equal(isReadonlyDevice({ userAgent: 'iPhone Safari', platform: 'iPhone', maxTouchPoints: 5 }), true);
  assert.equal(isReadonlyDevice({ userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isReadonlyDevice({ userAgent: 'Windows Chrome', platform: 'Win32', maxTouchPoints: 10 }), false);
});
test('背景計時器完全停擺仍於回前景檢查期限，短暫背景不鎖定', () => {
  let time = 100, locks = 0, callback; const clock = createBackgroundLock({ lock: () => locks++, active: () => true, now: () => time, schedule: fn => { callback = fn; return 1; }, cancel: () => {} });
  clock.hide(); time += 29999; clock.resume(); assert.equal(locks, 0);
  clock.hide(); time += 30000; clock.resume(); assert.equal(locks, 1);
  clock.hide(); time += 30000; callback(); assert.equal(locks, 2);
  clock.hide(); clock.reset(); time += 30000; clock.resume(); assert.equal(locks, 2);
});
test('同一毫秒匯出亦產生不同檔名', () => {
  const filenames = Array.from({ length: 100 }, () => exportFilename(new Date('2026-10-11T01:02:03Z')));
  assert.equal(new Set(filenames).size, 100); assert.ok(filenames.every(n => n.endsWith('.pvault')));
});
test('新版版本號僅由 version.js 提供，畫面沒有寫死號碼', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes(APP_VERSION)); assert.ok(!html.includes('PassVault 2.0'));
  for (const id of ['loginVersion', 'appVersion', 'releaseVersion']) assert.ok(html.includes(`id="${id}"`));
});
