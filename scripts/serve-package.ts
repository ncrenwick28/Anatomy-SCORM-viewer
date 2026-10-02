/**
 * Serves an unzipped SCORM package (or a .zip, which is extracted to a temporary folder) over HTTP so it
 * can be previewed outside an LMS. Usage: npm run serve:package -- path/to/package[.zip] [port]
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { readZip } from '../src/shared/zip';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.xml': 'application/xml',
};

export async function prepareRoot(input: string): Promise<string> {
  if (!existsSync(input)) throw new Error(`Not found: ${input}`);
  if (statSync(input).isDirectory()) return resolve(input);
  const dir = mkdtempSync(join(tmpdir(), 'scorm-pkg-'));
  const files = await readZip(new Blob([readFileSync(input)]), { maxTotalBytes: 4e9, maxEntries: 50000 });
  for (const [path, data] of files) {
    const target = resolve(dir, path);
    if (!target.startsWith(dir + sep)) throw new Error(`Unsafe path in zip: ${path}`);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, data);
  }
  return dir;
}

export function serveDirectory(root: string, port = 0, extra?: (url: URL) => { body: string | Buffer; type: string } | null) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const special = extra?.(url);
    if (special) {
      res.writeHead(200, { 'Content-Type': special.type, 'Cache-Control': 'no-store' });
      res.end(special.body);
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise<{ server: typeof server; port: number; close: () => Promise<void> }>((resolveP) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      resolveP({ server, port: p, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (process.argv[1]?.endsWith('serve-package.ts')) {
  const [, , input, portArg] = process.argv;
  if (!input) {
    console.error('Usage: npm run serve:package -- <package folder or .zip> [port]');
    process.exit(1);
  }
  const root = await prepareRoot(input);
  const { port } = await serveDirectory(root, Number(portArg ?? 8080));
  console.log(`Serving ${root}\nOpen http://127.0.0.1:${port}/index.html  (standalone preview; no LMS)`);
}
