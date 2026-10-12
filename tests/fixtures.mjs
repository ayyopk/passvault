import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
export const TEST_MASTER = 'FAKE-ONLY-Master-2026!';
export function sampleVault() {
  const time = '2026-01-01T00:00:00.000Z';
  return { schemaVersion: 1, appVersion: '2.0', createdAt: time, updatedAt: time,
    folders: [{ id: 'finance', name: '虛構銀行' }, { id: 'social', name: '虛構社群' }, { id: 'work', name: '虛構工作' }],
    items: [
      { id: 'fake-twitter', title: 'Twitter 虛構', account: 'fake-twitter@example.invalid', password: 'FAKE-ONLY-twitter!', notes: '測試社群', folderId: 'social' },
      { id: 'fake-bank', title: '虛構銀行', account: 'fake-bank@example.invalid', password: 'FAKE-ONLY-bank!', notes: '銀色虛構備註', folderId: 'finance' },
      { id: 'fake-work', title: '虛構工作', account: 'fake-work@example.invalid', password: 'FAKE-ONLY-work!', notes: '中文測試', folderId: 'work' }
    ].map(i => ({ ...i, isDraft: false, pendingBackup: false, createdAt: time, updatedAt: time })) };
}
export function legacyVault() {
  return { columnOrder: ['col-social'], columns: { 'col-social': { title: '虛構社群', taskIds: ['legacy-twitter'] }, 'col-finance': { title: '虛構銀行', taskIds: ['legacy-bank'] } }, tasks: {
    'legacy-twitter': { id: 'legacy-twitter', title: 'Twitter 虛構', account: 'fake-legacy@example.invalid', password: 'FAKE-ONLY-legacy!', notes: '虚構舊資料', url: 'https://example.invalid' },
    'legacy-bank': { id: 'legacy-bank', title: '虛構銀行', account: 'fake-bank@example.invalid', password: 'FAKE-ONLY-bank!', notes: '測試' },
    'legacy-orphan': { id: 'legacy-orphan', title: '虛構未分類', account: 'fake-orphan@example.invalid', password: 'FAKE-ONLY-orphan!', notes: '' }
  } };
}
export function appContext() {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/\ninstall\(\);\s*$/, '\n');
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, btoa, atob, structuredClone, setTimeout, clearTimeout, navigator: { userAgent: 'Windows Chrome', platform: 'Win32', maxTouchPoints: 0 }, document: { documentElement: { outerHTML: '<html></html>' } }, window: { matchMedia: () => ({ matches: false }) } });
  vm.runInContext(source, context); return context;
}
export const plain = value => JSON.parse(JSON.stringify(value));
export function v20Context() {
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, btoa, atob });
  vm.runInContext(fs.readFileSync(new URL('./v20-crypto.js', import.meta.url), 'utf8'), context); return context;
}
