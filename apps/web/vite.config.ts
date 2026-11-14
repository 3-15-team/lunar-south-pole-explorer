import { defineConfig, type Connect, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

// Static products (data/web) are NOT bundled: they are served at /data by this
// middleware in dev/preview, by nginx in docker compose, and copied next to the
// SPA by `make dist` for static hosting.
const DATA_WEB = resolve(process.env.DATA_DIR ?? resolve(__dirname, '../../data'), 'web');
const COMPUTE = process.env.COMPUTE_URL ?? `http://localhost:${process.env.COMPUTE_PORT ?? 8000}`;

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function serveData(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? '').split('?')[0];
    if (!url.startsWith('/data/')) return next();
    const rel = normalize(decodeURIComponent(url.slice('/data/'.length)));
    const file = join(DATA_WEB, rel);
    if (!file.startsWith(DATA_WEB) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'serve-data-web',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [preact(), serveData()],
  server: {
    port: 5173,
    proxy: { '/api': { target: COMPUTE, changeOrigin: true } },
  },
  preview: {
    proxy: { '/api': { target: COMPUTE, changeOrigin: true } },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
