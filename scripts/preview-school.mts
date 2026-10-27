import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createSchoolStore } from '../db/school-store.ts';
import { createPostgresWorkspaces } from '../db/postgres-workspaces.ts';
import { createSchoolHandlers } from '../lib/server/school.ts';
import { createWorkspaceHandlers } from '../lib/server/workspace.ts';

const root = resolve('vercel-build');
await mkdir('work/school-preview', { recursive: true });
const db = new PGlite('work/school-preview/database');
const query = async (sql: string, parameters?: unknown[]) =>
  (await db.query<Record<string, unknown>>(sql, parameters)).rows;
const store = createSchoolStore(query);
const school = createSchoolHandlers(() => store);
const legacyStore = createPostgresWorkspaces(query);
const legacy = createWorkspaceHandlers(() => legacyStore);
const server = createServer(async (req, res) => {
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;
  if (req.headers.host !== `127.0.0.1:${port}`) {
    res.writeHead(403).end();
    return;
  }
  const url = new URL(req.url ?? '/', origin);
  try {
    if (['/api/school', '/api/workspace'].includes(url.pathname)) {
      const handlers = url.pathname === '/api/school' ? school : legacy;
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 64000) {
          res.writeHead(413).end();
          return;
        }
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const response = await handlers[req.method](
        new Request(url, {
          method: req.method,
          headers,
          ...(req.method === 'POST' ? { body: raw } : {}),
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    const path = resolve(
      root,
      url.pathname === '/'
        ? 'index.html'
        : '.' + decodeURIComponent(url.pathname),
    );
    if (!path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const content = await readFile(path);
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
    };
    res.writeHead(200, {
      'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(content);
  } catch {
    res.writeHead(500).end('Preview request failed');
  }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object')
    console.log(`School preview: http://127.0.0.1:${address.port}`);
});
process.on('SIGTERM', () =>
  server.close(() => {
    void db.close().then(() => process.exit(0));
  }),
);
