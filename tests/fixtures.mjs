import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
export const TEST_PASSWORD = 'Fictional-Master-Only-2026!';
export const sampleVault = () => ({
  schemaVersion: 1, appVersion: '2.0', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  folders: [{ id: 'finance', name: '虛構銀行' }, { id: 'work', name: '測試工作' }],
  items: [
    { id: 'test-1', title: '虛構銀行登入', account: 'fake-bank@example.invalid', password: 'FAKE-ONLY-bank-123!', notes: '完全虛構，銀色測試', folderId: 'finance', isDraft: false, pendingBackup: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'test-2', title: '虛構工作', account: 'fake-work@example.invalid', password: 'FAKE-ONLY-work-456!', notes: '測試備註', folderId: 'work', isDraft: false, pendingBackup: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  ]
});
export const legacyData = () => ({
  columnOrder: ['col-finance'],
  columns: { 'col-finance': { title: '虛構銀行', taskIds: ['legacy-1'] }, 'col-extra': { title: '未列入順序', taskIds: ['legacy-2'] } },
  tasks: {
    'legacy-1': { id: 'different-id', title: '虛構銀行', account: 'fake-legacy@example.invalid', password: 'FAKE-ONLY-legacy!', notes: '測試備註', url: 'https://example.invalid' },
    'legacy-2': { title: '其他虛構帳號', account: 'fake-extra@example.invalid', password: 'FAKE-ONLY-extra!', notes: '完整性測試' },
    'legacy-orphan': { id: 'legacy-orphan', title: '未分類虛構帳號', account: 'fake-orphan@example.invalid', password: 'FAKE-ONLY-orphan!', notes: '' }
  }
});
// 直接執行保留的 v2.0 加密器；相容性測試不使用新版加密器製造「舊檔」。
export function originalCrypto() {
  const source = fs.readFileSync(new URL('../PassVault_2.0.html', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function bytesToB64'), source.indexOf('function normalizeVault'));
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, btoa, atob });
  vm.runInContext('const APP_VERSION="2.0",encoder=new TextEncoder(),decoder=new TextDecoder();' + code, context);
  return context;
}
