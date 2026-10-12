import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const git = (...args) => execFileSync('git', ['-c', 'safe.directory=' + process.cwd().replaceAll('\\', '/'), ...args], { encoding: 'utf8' });
const problems = [], objects = new Set(), records = [];
for (const commit of git('rev-list', 'origin/main', 'v2.0').trim().split(/\s+/)) {
  for (const line of git('ls-tree', '-r', commit).trim().split('\n')) {
    const match = line.match(/^\d+ blob ([a-f0-9]+)\t(.+)$/); if (!match || objects.has(match[1])) continue;
    objects.add(match[1]); records.push({ path: match[2], content: git('cat-file', 'blob', match[1]), scope: commit });
  }
}
const current = git('ls-files').trim().split('\n').filter(Boolean);
for (const filename of [...new Set([...current, 'index.html', 'tests/reference-v2.1.html'])]) records.push({ path: filename, content: await fs.readFile(filename, 'utf8'), scope: 'candidate' });
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); const requests = []; page.on('request', request => requests.push(request.url()));
  for (const record of records) {
    if (/\.(pvault|csv|tsv|txt|zip|log)$/i.test(record.path) || /(?:^|\/)(?:\.env[^/]*|private|downloads|artifacts|node_modules|test-results)(?:\/|$)/.test(record.path)) problems.push({ path: record.path, scope: record.scope, reason: 'data or private file tracked' });
    if (/\.html$/i.test(record.path)) {
      const result = await page.evaluate(source => {
        const template = document.createElement('template'); template.innerHTML = source;
        return [...template.content.querySelectorAll('#embedded-data,#embedded-vault')].filter(node => node.textContent.trim() && node.textContent.trim() !== 'null').length;
      }, record.content);
      if (result) problems.push({ path: record.path, scope: record.scope, reason: 'embedded vault data' });
      const literals = [...record.content.matchAll(/[,{]\s*(["']?)(password|account)\1\s*:\s*(["'])(.*?)\3/g)].map(m=>m[4])
        .concat([...record.content.matchAll(/(?<![\w-])(?:masterPassword|password|account)\s*=\s*(["'])(.*?)\1/g)].map(m=>m[2]))
        .filter(value=>value && !value.includes('FAKE-ONLY') && !value.includes('example.invalid'));
      if (literals.length) problems.push({ path: record.path, scope: record.scope, reason: 'nonempty account/password literal' });
    }
    if (/(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(record.content)) problems.push({ path: record.path, scope: record.scope, reason: 'credential/private-key pattern' });
  }
  assert.deepEqual(requests, [], '安全掃描不應載入外部資源');
} finally { await browser.close(); }
const result = { scope: 'origin/main and v2.0 reachable history plus candidate tracked files', historyBlobs: objects.size, candidateFiles: current.length, inspectedRecords: records.length, problems };
console.log(JSON.stringify(result, null, 2));
await fs.mkdir('.maintenance', { recursive: true }); await fs.writeFile('.maintenance/security-scan.json', JSON.stringify(result, null, 2));
assert.deepEqual(problems, [], '敏感資料檢查未通過：只顯示路徑與風險類別，不顯示資料值');
