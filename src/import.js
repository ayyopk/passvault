import { validatePayload } from './crypto.js';
import { convertLegacy } from './model.js';
export async function readEncryptedFile(file) {
  return validatePayload(JSON.parse(await file.text()));
}
export async function readLegacyFile(file) {
  const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
  const nodes = doc.querySelectorAll('#embedded-data');
  if (nodes.length === 0) { const error = new Error(); error.code = 'NO_EMBEDDED_DATA'; throw error; }
  if (nodes.length !== 1) throw new Error('舊檔必須包含唯一的 embedded-data');
  const legacy = JSON.parse(nodes[0].textContent);
  return { converted: convertLegacy(legacy), oldCount: Object.keys(legacy.tasks).length };
}
export function legacyImportMessage(error) {
  return error.code === 'NO_EMBEDDED_DATA'
    ? '此 HTML 沒有舊版內嵌資料，未匯入任何資料。如果選的是 PassVault 程式檔，請改開 .pvault 密碼庫；HTML 匯入需要含 embedded-data 的舊資料檔。'
    : '讀取舊版失敗：資料結構或索引不完整，未匯入任何資料。';
}
