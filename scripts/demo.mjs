import http from 'http';
import { readFile } from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'demo', 'dist');

await esbuild.build({
  entryPoints: [path.join(root, 'demo', 'app.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  sourcemap: 'inline',
  outdir: distDir,
  target: ['es2020']
});

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url || '/';
    if (url === '/' || url === '/index.html') {
      const html = await readFile(path.join(root, 'demo', 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (url.startsWith('/dist/')) {
      const filePath = path.join(root, 'demo', url);
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(err instanceof Error ? err.message : 'Server error');
  }
});

const port = process.env.DEMO_PORT ? Number(process.env.DEMO_PORT) : 5173;
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Demo running at http://localhost:${port}`);
});
