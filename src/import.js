import { validatePayload } from './crypto.js';
import { convertLegacy } from './model.js';
export async function readEncryptedFile(file) {
  return validatePayload(JSON.parse(await file.text()));
}
export async function readLegacyFile(file) {
  const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
  const nodes = doc.querySelectorAll('#embedded-data');
  if (nodes.length !== 1) throw new Error('舊檔必須包含唯一的 embedded-data');
  const legacy = JSON.parse(nodes[0].textContent);
  return { converted: convertLegacy(legacy), oldCount: Object.keys(legacy.tasks).length };
}
