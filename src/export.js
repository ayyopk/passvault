import { APP_VERSION } from './version.js';
import { contentSnapshot } from './model.js';
let sequence = 0;
export function exportFilename(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${String(date.getMilliseconds()).padStart(3, '0')}`;
  return `PassVault_${stamp}_${++sequence}_${crypto.randomUUID().slice(0, 8)}.pvault`;
}
export function prepareExport(vault) {
  if (vault.items.some(i => i.isDraft)) throw new Error('尚有未按 ✓ 完成的新增資料，請先完成或取消草稿。');
  const data = structuredClone(vault);
  data.appVersion = APP_VERSION;
  data.items.forEach(i => { i.pendingBackup = false; });
  return { data, snapshot: contentSnapshot(vault) };
}
export function acknowledgeExport(vault, exported) {
  for (const i of vault.items) {
    const saved = exported.data.items.find(s => s.id === i.id);
    if (saved && contentSnapshot({ folders: [], items: [saved] }) === contentSnapshot({ folders: [], items: [i] })) i.pendingBackup = false;
  }
  return contentSnapshot(vault) !== exported.snapshot;
}
