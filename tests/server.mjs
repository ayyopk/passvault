import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export function createServer() {
  return http.createServer(async (req, res) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/') { res.writeHead(404).end(); return; }
    try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(await fs.readFile(new URL('../index.html', import.meta.url))); }
    catch { res.writeHead(500).end(); }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) createServer().listen(8080, '127.0.0.1', () => console.log('http://127.0.0.1:8080'));
