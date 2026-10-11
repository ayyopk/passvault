import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const allowed = pathname === '/' || pathname === '/index.html' || pathname === '/styles/app.css' || /^\/src\/[a-z]+\.js$/.test(pathname);
      if (!allowed) { res.writeHead(404).end(); return; }
      const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!filename.startsWith(root) || filename.includes(`${path.sep}.git${path.sep}`) || /\.(pvault|csv|tsv)$/i.test(filename)) { res.writeHead(403).end(); return; }
      const body = await fs.readFile(filename);
      res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(8080, '127.0.0.1', () => console.log('PassVault preview: http://127.0.0.1:8080'));
}
