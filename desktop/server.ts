import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  applyCommand,
  demoState,
  DomainError,
  type State,
  type Command,
} from '../lib/domain';

const root = resolve(process.argv[2] ?? join(import.meta.dirname, 'static'));
const dataDir = resolve(process.argv[3] ?? join(import.meta.dirname, 'data'));
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'nanum.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec(
  'CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)',
);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
function json(
  res: ServerResponse,
  status: number,
  value: unknown,
  cookie?: string,
) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(cookie ? { 'Set-Cookie': cookie } : {}),
  });
  res.end(JSON.stringify(value));
}
function session(req: IncomingMessage) {
  const raw = req.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('nanum_workspace='))
    ?.slice(16);
  return raw && uuid.test(raw) ? raw : null;
}
const server = createServer(async (req, res) => {
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;
  if (req.headers.host !== `127.0.0.1:${port}`) {
    json(res, 403, { error: '허용되지 않은 호스트입니다.' });
    return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url ?? '/', origin);
  try {
    if (url.pathname === '/api/workspace') {
      let id = session(req);
      if (req.method === 'GET') {
        if (id) {
          const row = db
            .prepare('SELECT state, revision FROM workspaces WHERE id = ?')
            .get(id) as { state: string; revision: number } | undefined;
          if (row) {
            json(res, 200, {
              state: JSON.parse(row.state),
              revision: row.revision,
            });
            return;
          }
        }
        id = randomUUID();
        const state = demoState();
        db.prepare(
          'INSERT INTO workspaces (id, state, revision, updated_at) VALUES (?, ?, 0, ?)',
        ).run(id, JSON.stringify(state), Date.now());
        json(
          res,
          200,
          { state, revision: 0 },
          `nanum_workspace=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
        );
        return;
      }
      if (req.method !== 'POST') {
        json(res, 405, { error: '지원하지 않는 요청입니다.' });
        return;
      }
      if (req.headers.origin && req.headers.origin !== origin) {
        json(res, 403, { error: '허용되지 않은 요청입니다.' });
        return;
      }
      if (!id) {
        json(res, 401, { error: '작업 공간을 먼저 불러와 주세요.' });
        return;
      }
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 20000) {
          json(res, 413, { error: '요청 크기가 너무 큽니다.' });
          return;
        }
      }
      let body: { revision: number; command: Command };
      try {
        body = JSON.parse(raw);
      } catch {
        json(res, 400, { error: '잘못된 요청 형식입니다.' });
        return;
      }
      if (
        !body ||
        !Number.isInteger(body.revision) ||
        !body.command ||
        typeof body.command.type !== 'string'
      ) {
        json(res, 400, { error: '작업 정보를 확인해 주세요.' });
        return;
      }
      const row = db
        .prepare('SELECT state, revision FROM workspaces WHERE id = ?')
        .get(id) as { state: string; revision: number } | undefined;
      if (!row) {
        json(res, 401, {
          error: '작업 공간을 찾을 수 없습니다. 새로고침해 주세요.',
        });
        return;
      }
      if (row.revision !== body.revision) {
        json(res, 409, {
          error:
            '다른 창에서 자료가 바뀌었어요. 최신 자료를 불러온 뒤 다시 시도해 주세요.',
        });
        return;
      }
      const state = applyCommand(JSON.parse(row.state) as State, body.command);
      const result = db
        .prepare(
          'UPDATE workspaces SET state = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
        )
        .run(JSON.stringify(state), Date.now(), id, body.revision);
      if (result.changes !== 1) {
        json(res, 409, {
          error: '동시에 자료가 변경되었습니다. 다시 시도해 주세요.',
        });
        return;
      }
      json(res, 200, { state, revision: row.revision + 1 });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    const name =
      url.pathname === '/'
        ? 'index.html'
        : decodeURIComponent(url.pathname).replace(/^\//, '');
    const file = resolve(root, name);
    if (
      !file.startsWith(root + sep) ||
      !existsSync(file) ||
      !statSync(file).isFile()
    ) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Cache-Control':
        extname(file) === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  } catch (e) {
    json(res, e instanceof DomainError ? 400 : 500, {
      error:
        e instanceof DomainError ? e.message : '자료를 처리하지 못했습니다.',
    });
  }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object')
    console.log(JSON.stringify({ url: `http://127.0.0.1:${address.port}` }));
});
process.on('SIGTERM', () =>
  server.close(() => {
    db.close();
    process.exit(0);
  }),
);
