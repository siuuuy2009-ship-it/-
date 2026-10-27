import { DomainError, parseStudentNumber, type Command } from '../domain.ts';
import { parseRoster, type SchoolUser } from '../school.ts';
import { hashPassword, checkPassword } from './passwords.ts';
import {
  SchoolConflict,
  SchoolRateLimit,
  type SchoolStore,
} from '../../db/school-store.ts';
import { storageErrorCode } from './storage-diagnostics.ts';

const cookieName = 'nanum_school_session';
function token(request: Request): string {
  const raw = request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  return raw && /^[a-f0-9]{48}$/.test(raw) ? raw : '';
}
function reply(data: unknown, status = 200, cookie?: string) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });
}
function sessionCookie(request: Request, value: string) {
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value ? 604800 : 0}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function failure(error: unknown) {
  if (error instanceof SchoolConflict)
    return reply(
      {
        error:
          '다른 학생이 자료를 바꿨어요. 최신 자료를 불러온 뒤 다시 시도해 주세요.',
      },
      409,
    );
  if (error instanceof SchoolRateLimit)
    return reply(
      { error: '시도가 너무 많아요. 15분 뒤 다시 시도해 주세요.' },
      429,
    );
  if (error instanceof DomainError) return reply({ error: error.message }, 400);
  console.error(`school storage operation failed [${storageErrorCode(error)}]`);
  return reply(
    { error: '학교 자료에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' },
    503,
  );
}
export function createSchoolHandlers(getStore: () => SchoolStore) {
  const loggedIn = async (store: SchoolStore, request: Request) => {
    const raw = token(request);
    return raw ? store.session(raw) : null;
  };
  const signedIn = async (
    store: SchoolStore,
    request: Request,
    account: SchoolUser & { sessionVersion: number },
  ) => {
    const previous = token(request);
    if (previous) await store.logout(previous);
    const value = await store.startSession(account.id, account.sessionVersion);
    const { id, schoolId, schoolCode, loginId, name, role } = account;
    const user: SchoolUser = { id, schoolId, schoolCode, loginId, name, role };
    return reply({ user }, 200, sessionCookie(request, value));
  };
  return {
    async GET(request: Request) {
      try {
        const action = new URL(request.url).searchParams.get('action') ?? 'me';
        if (!token(request))
          return action === 'me'
            ? reply({ user: null })
            : reply({ error: '먼저 로그인해 주세요.' }, 401);
        const store = getStore();
        const user = await loggedIn(store, request);
        if (action === 'me') return reply({ user });
        if (!user) return reply({ error: '다시 로그인해 주세요.' }, 401);
        if (action === 'workspace') return reply(await store.snapshot(user));
        if (action === 'roster' && user.role === 'admin')
          return reply({ members: await store.roster(user) });
        return reply({ error: '허용되지 않은 요청입니다.' }, 403);
      } catch (error) {
        return failure(error);
      }
    },
    async POST(request: Request) {
      if (
        request.headers.get('origin') !== new URL(request.url).origin ||
        !request.headers.get('content-type')?.startsWith('application/json')
      )
        return reply({ error: '허용되지 않은 요청입니다.' }, 403);
      try {
        const raw = await request.text();
        if (raw.length > 64000)
          return reply({ error: '요청 크기가 너무 커요.' }, 413);
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(raw);
        } catch {
          return reply({ error: '요청 형식이 올바르지 않아요.' }, 400);
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
          return reply({ error: '요청을 확인해 주세요.' }, 400);
        const store = getStore();
        const ip = request.headers.get('x-real-ip') ?? 'unknown';
        if (
          ['create-school', 'login', 'activate'].includes(String(body.action))
        ) {
          await store.limit(`auth-ip:${ip}`, 120);
          if (body.action === 'create-school') {
            await store.limit(`school-create:${ip}`, 5);
            const name =
              typeof body.title === 'string' ? body.title.trim() : '';
            const loginId =
              typeof body.loginId === 'string'
                ? body.loginId.trim().toLowerCase()
                : '';
            if (
              !name ||
              name.length > 50 ||
              !/^[a-z][a-z0-9_-]{2,19}$/.test(loginId)
            )
              throw new DomainError(
                '나눔함 이름과 운영자 아이디(영문 시작, 영문·숫자 3~20자)를 확인해 주세요.',
              );
            return await signedIn(
              store,
              request,
              await store.createSchool(
                name,
                loginId,
                await hashPassword(body.password),
              ),
            );
          }
          if (body.action === 'activate') {
            const student = parseStudentNumber(body.loginId);
            const code = typeof body.code === 'string' ? body.code.trim() : '';
            await store.limit(`activate:${code.slice(0, 48)}`, 12);
            if (!student || !/^[a-f0-9]{48}$/.test(code))
              throw new DomainError('학번과 초대코드를 확인해 주세요.');
            const user = await store.activate(
              code,
              student.studentNumber,
              await hashPassword(body.password),
            );
            if (!user)
              throw new DomainError(
                '초대코드가 올바르지 않거나 만료·사용되었습니다. 운영자에게 재발급을 요청해 주세요.',
              );
            return await signedIn(store, request, user);
          }
          const schoolCode =
            typeof body.schoolCode === 'string'
              ? body.schoolCode.trim().toLowerCase()
              : '';
          const loginId =
            typeof body.loginId === 'string'
              ? body.loginId.trim().toLowerCase()
              : '';
          if (
            !/^[a-f0-9]{8}$/.test(schoolCode) ||
            !/^[a-z0-9_-]{3,20}$/.test(loginId)
          )
            throw new DomainError(
              '학교코드, 학번 또는 아이디, 비밀번호를 확인해 주세요.',
            );
          await store.limit(`login:${schoolCode}:${loginId}`, 12);
          const account = await store.findAccount(schoolCode, loginId);
          if (
            !(await checkPassword(
              body.password,
              account?.passwordHash ?? null,
            )) ||
            !account
          )
            return reply(
              {
                error: '학교코드, 학번 또는 아이디, 비밀번호를 확인해 주세요.',
              },
              401,
            );
          const { passwordHash: _, ...user } = account;
          return await signedIn(store, request, user);
        }
        const user = await loggedIn(store, request);
        if (!user) return reply({ error: '먼저 로그인해 주세요.' }, 401);
        if (body.action === 'logout') {
          await store.logout(token(request));
          return reply({ user: null }, 200, sessionCookie(request, ''));
        }
        if (body.action === 'command') {
          if (
            !Number.isInteger(body.revision) ||
            !body.command ||
            typeof body.command !== 'object' ||
            Array.isArray(body.command) ||
            typeof (body.command as Command).type !== 'string'
          )
            throw new DomainError('작업 정보를 확인해 주세요.');
          return reply(
            await store.command(
              user,
              body.command as Command,
              body.revision as number,
            ),
          );
        }
        if (user.role !== 'admin')
          return reply({ error: '운영자만 할 수 있어요.' }, 403);
        if (body.action === 'import-roster')
          return reply({
            invitations: await store.importRoster(
              user,
              parseRoster(body.roster),
            ),
          });
        if (
          body.action === 'reissue' &&
          typeof body.accountId === 'string' &&
          /^[a-f0-9-]{36}$/.test(body.accountId)
        )
          return reply({
            invitations: [await store.reissue(user, body.accountId)],
          });
        throw new DomainError('지원하지 않는 작업입니다.');
      } catch (error) {
        return failure(error);
      }
    },
  };
}
