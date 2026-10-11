export function searchItems(vault, folderId, query) {
  const q = query.trim().toLowerCase();
  const names = new Map(vault.folders.map(f => [f.id, f.name]));
  return vault.items.filter(i => !i.isDraft && (q
    ? [i.title, i.account, i.notes, names.get(i.folderId)].some(s => (s || '').toLowerCase().includes(q))
    : folderId === 'all' || i.folderId === folderId))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant'));
}
