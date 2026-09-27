import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import esbuild from 'esbuild';
const root = path.resolve(import.meta.dirname, '..');
await esbuild.build({ entryPoints: [path.join(root, 'tests/browser/harness.ts')], bundle: true, format: 'esm', target: 'es2022', outfile: path.join(root, 'tests/browser/harness.js'), alias: { obsidian: path.join(root, 'tests/browser/obsidian-stub.ts') }, logLevel: 'warning' });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.woff': 'font/woff' };
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/__shutdown') { res.writeHead(200).end(); server.close(); server.closeAllConnections(); return; }
  const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'tests/browser/index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try { const data = await fs.readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404).end(); }
}).listen(4178, '127.0.0.1', () => console.log('Component test server ready on 127.0.0.1:4178'));
