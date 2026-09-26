import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};

// Serves the renderer (page + node_modules) from `root` at `/`, and the user's repository from
// `workspace` at `/assets/` so scenes can load their models and textures. Listens on loopback only.
export function startServer({ root, workspace }) {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const [base, rel] = url.startsWith('/assets/') ? [workspace, url.slice('/assets/'.length)] : [root, url];
      const path = normalize(join(base, rel));
      if (path !== base && !path.startsWith(base + sep)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream' }).end(body);
    } catch (err) {
      res.writeHead(err instanceof URIError ? 400 : 404).end();
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}
