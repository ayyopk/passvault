import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { appContext, v20Context, sampleVault, legacyVault, TEST_MASTER, plain } from './fixtures.mjs';
test('v2.0 原加密器產生的密碼庫可讀取，全部帳密欄位完整保留', async () => {
  const old = v20Context(), app = appContext(), data = sampleVault();
  const p = await old.encryptVault(data, TEST_MASTER), decoded = app.normalize(await app.decrypt(p, TEST_MASTER));
  assert.deepEqual(plain(decoded.items), data.items);
  for (const folder of data.folders) assert.equal(decoded.folders.find(f => f.id === folder.id).name, folder.name);
});
test('v2.1 加密匯出可由 v2.0 解密，salt、IV、cipher、KDF 格式不變', async () => {
  const app = appContext(), old = v20Context(), data = app.normalize(sampleVault());
  const p = await app.encrypt(data, TEST_MASTER);
  assert.deepEqual(plain(await old.decryptVault(p, TEST_MASTER)), plain(data));
  assert.equal(p.schemaVersion, 1); assert.equal(p.iterations, 250000);
  assert.equal(Buffer.from(p.salt, 'base64').length, 16); assert.equal(Buffer.from(p.iv, 'base64').length, 12);
});
test('錯密碼、竄改密文及損毀加密標頭均拒絕', async () => {
  const app = appContext(), p = await app.encrypt(sampleVault(), TEST_MASTER);
  await assert.rejects(app.decrypt(p, 'FAKE-WRONG'));
  const cipher = Buffer.from(p.data, 'base64'); cipher[0] ^= 1;
  await assert.rejects(app.decrypt({ ...p, data: cipher.toString('base64') }, TEST_MASTER));
  for (const bad of [{ ...p, iterations: 0 }, { ...p, iterations: 999999999 }, { ...p, schemaVersion: 2 }, { ...p, iv: '' }, { ...p, salt: '!' }]) assert.throws(() => app.validatePayload(bad));
});
test('原 v2.0 缺省 iterations 的相容性保留', async () => {
  const app = appContext(), p = await v20Context().encryptVault(sampleVault(), TEST_MASTER); delete p.iterations;
  assert.deepEqual(plain(await app.decrypt(p, TEST_MASTER)), sampleVault());
});
test('重複分類、帳密 ID、未知 schema、非文字密碼及孤立分類均拒絕', () => {
  const app = appContext();
  for (const mutate of [d => { d.folders[1].id = d.folders[0].id; }, d => { d.items[1].id = d.items[0].id; }, d => { d.schemaVersion = 3; }, d => { d.items[0].password = {}; }, d => { d.items[0].folderId = 'missing'; }, d => { d.items[0].isDraft = true; }]) { const data = sampleVault(); mutate(data); assert.throws(() => app.normalize(data)); }
});
test('未知額外欄位及既有內容不丟棄，非法分類顏色不寫入 CSS', () => {
  const app = appContext(), data = sampleVault(); data.items[0].url = 'https://example.invalid'; data.folders[0].color = 'url(https://example.invalid)';
  const normalized = app.normalize(data); assert.equal(normalized.items[0].url, data.items[0].url); assert.notEqual(normalized.folders[0].color, data.folders[0].color);
});
test('v7 HTML 转換保留未排序資料夾、孤立帳密及 url', () => {
  const app = appContext(), data = legacyVault(), decoded = app.migrateV7(data);
  assert.equal(decoded.items.length, 3); assert.equal(decoded.items.find(i => i.id === 'legacy-bank').folderId, 'col-finance');
  assert.equal(decoded.items.find(i => i.id === 'legacy-orphan').folderId, 'uncategorized');
  assert.equal(decoded.items.find(i => i.id === 'legacy-twitter').url, 'https://example.invalid');
  for (const item of decoded.items) for (const field of ['title', 'account', 'password', 'notes']) assert.equal(item[field], data.tasks[item.id][field]);
});
test('v7 缺省順序及空分類索引相容，遺失或重複參照拒絕', () => {
  const app = appContext(), data = legacyVault(); delete data.columnOrder; data.columns['col-empty'] = { title: '虛構空分類' };
  assert.equal(app.migrateV7(data).items.length, 3);
  const missing = legacyVault(); missing.columns['col-social'].taskIds.push('missing'); assert.throws(() => app.migrateV7(missing));
  const duplicate = legacyVault(); duplicate.columns['col-finance'].taskIds.push('legacy-twitter'); assert.throws(() => app.migrateV7(duplicate));
});
test('搜尋標示安全處理中文、字面正則符號與 HTML', () => {
  const app = appContext(); assert.equal(app.highlight('銀行', '銀'), '<mark>銀</mark>行');
  assert.equal(app.highlight('a.b', '.'), 'a<mark>.</mark>b');
  assert.ok(!app.highlight('<img src=x onerror=alert(1)>', 'img').includes('<img'));
});
test('內容快照包含帳密、分類順序與顏色，不受提示及時間戳影響', () => {
  const app = appContext(), data = sampleVault(), before = app.contentSnapshot(data);
  data.items[0].pendingBackup = true; data.items[0].updatedAt = '2026-02-02'; assert.equal(app.contentSnapshot(data), before);
  data.items[0].account = 'FAKE changed'; assert.notEqual(app.contentSnapshot(data), before);
});
test('同一秒重複匯出檔名不重複', () => {
  const app = appContext(); const names = Array.from({ length: 100 }, () => app.fileStamp()); assert.equal(new Set(names).size, 100);
});
test('帳號、備註、標題與分類名稱均採包含搜尋', () => {
  const app = appContext(); app.fixture = sampleVault(); vm.runInContext('vault=normalize(fixture)', app);
  for (const field of ['title', 'account', 'notes']) { const item = { title: 'FAKE', account: 'FAKE', notes: 'FAKE', folderId: 'social', [field]: '中文銀色測試' }; assert.equal(app.matchesQuery(item, '銀'), true); }
  assert.equal(app.matchesQuery({ title: 'FAKE', account: 'FAKE', notes: 'FAKE', folderId: 'finance' }, '銀'), true);
  assert.equal(app.matchesQuery({ title: 'FAKE', account: 'FAKE', notes: 'FAKE', folderId: 'work' }, '銀'), false);
});
test('Unicode、換行及首尾空白密碼加密往返保持逐字一致', async () => {
  const app = appContext(), data = sampleVault(); data.items[0].password = '  FAKE-ONLY-銀🙂\n</script>  '; data.items[0].account = '  fake-unicode@example.invalid  ';
  const p = await app.encrypt(app.normalize(data), TEST_MASTER); const decoded = await app.decrypt(p, TEST_MASTER);
  assert.equal(decoded.items[0].password, data.items[0].password); assert.equal(decoded.items[0].account, data.items[0].account);
});
