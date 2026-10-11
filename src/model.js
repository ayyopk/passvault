import { APP_VERSION, SCHEMA_VERSION } from './version.js';
export const nowIso = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x, key, fallback = '') => {
  if (x[key] === undefined) return fallback;
  if (typeof x[key] !== 'string') throw new Error(`欄位 ${key} 必須是文字`);
  return x[key];
};
export function emptyVault() {
  return { schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, createdAt: nowIso(), updatedAt: nowIso(), folders: [{ id: 'personal', name: '個人帳號' }, { id: 'work', name: '工作帳號' }, { id: 'finance', name: '金融服務' }], items: [] };
}
export function normalizeVault(v) {
  if (!record(v) || v.schemaVersion !== SCHEMA_VERSION || !Array.isArray(v.folders) || !Array.isArray(v.items)) throw new Error('密碼庫結構或版本錯誤');
  const folderIds = new Set(), itemIds = new Set();
  const folders = v.folders.map(f => {
    if (!record(f) || !text(f, 'id') || f.id === 'all' || folderIds.has(f.id)) throw new Error('分類 ID 缺少、重複或保留');
    folderIds.add(f.id);
    return { ...f, id: f.id, name: text(f, 'name') };
  });
  const items = v.items.map(x => {
    if (!record(x) || !text(x, 'id') || itemIds.has(x.id)) throw new Error('帳密 ID 缺少或重複');
    itemIds.add(x.id);
    const folderId = text(x, 'folderId');
    if (!folderIds.has(folderId)) throw new Error('帳密指向不存在的分類');
    if (x.isDraft === true) throw new Error('匯入檔案含未完成草稿');
    return { ...x, id: x.id, title: text(x, 'title'), account: text(x, 'account'), password: text(x, 'password'), notes: text(x, 'notes'), folderId, isDraft: false, pendingBackup: false, createdAt: text(x, 'createdAt', nowIso()), updatedAt: text(x, 'updatedAt', nowIso()) };
  });
  return { ...v, schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, folders, items };
}
// 比較正式資料；草稿、提示及時間戳不是已完成帳密的內容。
export function contentSnapshot(v) {
  return JSON.stringify({ folders: v.folders, items: v.items.filter(i => !i.isDraft).map(({ isDraft, pendingBackup, createdAt, updatedAt, ...i }) => i) });
}
export function addDraft(v, folderId) {
  const i = { id: uid(), title: '', account: '', password: '', notes: '', folderId, isDraft: true, pendingBackup: false, createdAt: nowIso(), updatedAt: nowIso() };
  v.items.unshift(i);
  return i;
}
export function updateItem(v, i, field, value) {
  if (!['title', 'account', 'password', 'notes', 'folderId'].includes(field)) throw new Error('不支援的欄位');
  if (field === 'folderId' && !v.folders.some(f => f.id === value)) throw new Error('分類不存在');
  if (i[field] === value) return;
  i[field] = value;
  i.updatedAt = nowIso();
  if (!i.isDraft) v.updatedAt = i.updatedAt;
}
export function completeDraft(v, i) {
  if (!i.isDraft || !i.title.trim() || !i.account.trim() || !i.password || !v.folders.some(f => f.id === i.folderId)) throw new Error('請填寫標題、帳號、密碼並選擇分類');
  i.isDraft = false;
  i.pendingBackup = true;
  i.updatedAt = v.updatedAt = nowIso();
}
export function removeItem(v, id) {
  const item = v.items.find(i => i.id === id);
  v.items = v.items.filter(i => i.id !== id);
  if (item && !item.isDraft) v.updatedAt = nowIso();
}
export function convertLegacy(appData) {
  if (!record(appData) || !record(appData.columns) || !record(appData.tasks) || (appData.columnOrder !== undefined && !Array.isArray(appData.columnOrder))) throw new Error('舊資料結構不完整');
  const tasks = appData.tasks, folders = [], items = [], seen = new Set();
  const order = [...new Set(['col-uncategorized', ...(appData.columnOrder || []), ...Object.keys(appData.columns)])];
  for (const cid of order) {
    if (typeof cid !== 'string') throw new Error('分類順序格式錯誤');
    const c = appData.columns[cid];
    if (c === undefined && cid === 'col-uncategorized') continue;
    if (!record(c) || (c.taskIds !== undefined && !Array.isArray(c.taskIds))) throw new Error('分類或帳密索引錯誤');
    const fid = cid === 'col-uncategorized' ? 'uncategorized' : cid;
    folders.push({ id: fid, name: text(c, 'title', '未命名分類') });
    for (const key of c.taskIds || []) {
      if (typeof key !== 'string' || !Object.hasOwn(tasks, key) || seen.has(key)) throw new Error('舊帳密索引遺失或重複');
      seen.add(key);
      items.push(convertTask(tasks[key], key, fid));
    }
  }
  for (const [key, t] of Object.entries(tasks)) {
    if (!seen.has(key)) items.push(convertTask(t, key, 'uncategorized'));
  }
  if (!folders.some(f => f.id === 'uncategorized')) folders.unshift({ id: 'uncategorized', name: '未分類' });
  const converted = normalizeVault({ schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, createdAt: nowIso(), updatedAt: nowIso(), folders, items });
  if (converted.items.length !== Object.keys(tasks).length) throw new Error('帳密筆數不一致');
  return converted;
}
function convertTask(t, key, folderId) {
  if (!record(t)) throw new Error('舊帳密格式錯誤');
  // task map 的鍵是舊格式的索引，不能以可能不一致的 t.id 再次去重。
  return { ...t, id: key, title: text(t, 'title'), account: text(t, 'account'), password: text(t, 'password'), notes: text(t, 'notes'), folderId, createdAt: text(t, 'createdAt', nowIso()), updatedAt: text(t, 'updatedAt', nowIso()) };
}
