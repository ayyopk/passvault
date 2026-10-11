import { APP_VERSION, SCHEMA_VERSION } from './version.js';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const bytesToB64 = bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
export const b64ToBytes = s => {
  if (typeof s !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s)) throw new Error('無效的 Base64');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
};
export function validatePayload(p) {
  if (!p || p.format !== 'passvault' || p.schemaVersion !== SCHEMA_VERSION || p.kdf !== 'PBKDF2-SHA256' || p.cipher !== 'AES-GCM') throw new Error('不支援的密碼庫格式');
  // v2.0 解密器容許缺省 iterations；延續此既有相容性。
  const iterations = p.iterations === undefined ? 250000 : p.iterations;
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 2000000) throw new Error('無效的 KDF 參數');
  if (b64ToBytes(p.salt).length !== 16 || b64ToBytes(p.iv).length !== 12 || b64ToBytes(p.data).length < 16) throw new Error('加密資料長度錯誤');
  return p;
}
export async function deriveKey(password, salt, iterations = 250000) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptVault(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 250000;
  const key = await deriveKey(password, salt, iterations);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(data))));
  return { format: 'passvault', schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, kdf: 'PBKDF2-SHA256', iterations, cipher: 'AES-GCM', salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(cipher) };
}
export async function decryptVault(payload, password) {
  validatePayload(payload);
  const key = await deriveKey(password, b64ToBytes(payload.salt), payload.iterations ?? 250000);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(payload.iv) }, key, b64ToBytes(payload.data));
  return JSON.parse(decoder.decode(plain));
}
