import {
  applyCommand,
  demoState,
  DomainError,
  type State,
  type Command,
} from '../domain.ts';
import { storageErrorCode } from './storage-diagnostics.ts';

export type WorkspaceRow = { state: string; revision: number };
export interface WorkspaceStore {
  find(id: string): Promise<WorkspaceRow | null>;
  create(id: string, state: State): Promise<void>;
  update(id: string, revision: number, state: State): Promise<boolean>;
}
export class StorageNotConfigured extends Error {}

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
      'X-Content-Type-Options': 'nosniff',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });
}
function unavailable(error: unknown, message: string) {
  if (error instanceof StorageNotConfigured)
    return reply(
      {
        code: 'STORAGE_NOT_CONFIGURED',
        error:
          '아직 자료 저장소가 연결되지 않았어요. 운영자가 저장소를 연결하면 나눔을 시작할 수 있어요.',
      },
      503,
    );
  // Driver errors may contain connection details. Never log credentials or state.
  console.error(
    `workspace storage operation failed [${storageErrorCode(error)}]`,
  );
  return reply({ error: message }, 503);
}

export function createWorkspaceHandlers(getStore: () => WorkspaceStore) {
  return {
    async GET(request: Request) {
      try {
        const store = getStore();
        let id = session(request);
        if (id) {
          const row = await store.find(id);
          if (row)
            return reply({
              state: JSON.parse(row.state),
              revision: row.revision,
            });
        }
        id = crypto.randomUUID();
        const state = demoState();
        await store.create(id, state);
        const secure =
          new URL(request.url).protocol === 'https:' ? '; Secure' : '';
        return reply(
          { state, revision: 0 },
          200,
          `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`,
        );
      } catch (error) {
        return unavailable(
          error,
          '자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
    },
    async POST(request: Request) {
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin)
        return reply({ error: '허용되지 않은 요청입니다.' }, 403);
      try {
        const id = session(request);
        if (!id)
          return reply({ error: '작업 공간을 먼저 불러와 주세요.' }, 401);
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
        const store = getStore();
        const row = await store.find(id);
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
        const state = applyCommand(
          JSON.parse(row.state) as State,
          body.command,
        );
        if (!(await store.update(id, body.revision, state)))
          return reply(
            {
              error:
                '동시에 자료가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
            },
            409,
          );
        return reply({ state, revision: row.revision + 1 });
      } catch (error) {
        if (error instanceof DomainError)
          return reply({ error: error.message }, 400);
        return unavailable(
          error,
          '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
    },
  };
}
