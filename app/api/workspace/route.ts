import { database } from '@/db/storage';
import {
  applyCommand,
  demoState,
  DomainError,
  type State,
  type Command,
} from '@/lib/domain';
const COOKIE = 'nanum_workspace';
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function session(request: Request) {
  const raw = request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return raw && uuid.test(raw) ? raw : null;
}
function reply(data: unknown, status = 200, cookie?: string) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });
}
export async function GET(request: Request) {
  try {
    const db = database();
    let id = session(request);
    if (id) {
      const row = await db
        .prepare('SELECT state, revision FROM workspaces WHERE id = ?')
        .bind(id)
        .first<{ state: string; revision: number }>();
      if (row)
        return reply({ state: JSON.parse(row.state), revision: row.revision });
    }
    id = crypto.randomUUID();
    const state = demoState();
    await db
      .prepare(
        'INSERT INTO workspaces (id, state, revision, updated_at) VALUES (?, ?, 0, ?)',
      )
      .bind(id, JSON.stringify(state), Date.now())
      .run();
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return reply(
      { state, revision: 0 },
      200,
      `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`,
    );
  } catch (e) {
    console.error('workspace load failed', e);
    return reply(
      { error: '자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      503,
    );
  }
}
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return reply({ error: '허용되지 않은 요청입니다.' }, 403);
  try {
    const id = session(request);
    if (!id) return reply({ error: '작업 공간을 먼저 불러와 주세요.' }, 401);
    const raw = await request.text();
    if (raw.length > 20000)
      return reply({ error: '요청 크기가 너무 큽니다.' }, 413);
    let body: { revision: number; command: Command };
    try {
      body = JSON.parse(raw);
    } catch {
      return reply({ error: '잘못된 요청 형식입니다.' }, 400);
    }
    if (
      !body ||
      !Number.isInteger(body.revision) ||
      !body.command ||
      typeof body.command.type !== 'string'
    )
      return reply({ error: '작업 정보를 확인해 주세요.' }, 400);
    const db = database();
    const row = await db
      .prepare('SELECT state, revision FROM workspaces WHERE id = ?')
      .bind(id)
      .first<{ state: string; revision: number }>();
    if (!row)
      return reply(
        { error: '작업 공간을 찾을 수 없습니다. 새로고침해 주세요.' },
        401,
      );
    if (row.revision !== body.revision)
      return reply(
        {
          error:
            '다른 창에서 자료가 바뀌었어요. 최신 자료를 불러온 뒤 다시 시도해 주세요.',
        },
        409,
      );
    const state = applyCommand(JSON.parse(row.state) as State, body.command);
    const result = await db
      .prepare(
        'UPDATE workspaces SET state = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
      )
      .bind(JSON.stringify(state), Date.now(), id, body.revision)
      .run();
    if (result.meta.changes !== 1)
      return reply(
        {
          error:
            '동시에 자료가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
        },
        409,
      );
    return reply({ state, revision: row.revision + 1 });
  } catch (e) {
    if (e instanceof DomainError) return reply({ error: e.message }, 400);
    console.error('workspace update failed', e);
    return reply(
      { error: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      503,
    );
  }
}
