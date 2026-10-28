import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createSchoolStore } from '../db/school-store.ts';
import { createSchoolHandlers } from '../lib/server/school.ts';
import {
  hashPassword,
  checkPassword,
  tokenHash,
} from '../lib/server/passwords.ts';
import {
  parseRoster,
  type SchoolUser,
  type Invitation,
} from '../lib/school.ts';
import type { State, Command } from '../lib/domain.ts';
import { CONSENT_VERSION } from '../lib/consent.ts';

void test('passwords use independent salts and never store the original value', async () => {
  const password = 'test-password-strong';
  const one = await hashPassword(password);
  const two = await hashPassword(password);
  assert.notEqual(one, two);
  assert.ok(!one.includes(password));
  assert.equal(await checkPassword(password, one), true);
  assert.equal(await checkPassword('wrong-password', one), false);
  assert.equal(await checkPassword(password, null), false);
  assert.equal(await checkPassword(password, 'corrupt'), false);
  await assert.rejects(hashPassword('1101'));
});

void test('roster import accepts namesakes but rejects duplicate and invalid numbers', () => {
  assert.deepEqual(
    parseRoster('\uFEFF학번,이름\r\n1101,학생가\r\n2213 학생가'),
    [
      { studentNumber: '1101', name: '학생가' },
      { studentNumber: '2213', name: '학생가' },
    ],
  );
  for (const raw of [
    '',
    '학번,이름',
    '1101,학생\n1101,학생',
    '1117,학생',
    '1311,',
    '1101,학생,다른칸',
  ])
    assert.throws(() => parseRoster(raw));
});

void test('school accounts: one-time invitation, shared data, server permissions and revocation', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const query = async (sql: string, parameters?: unknown[]) =>
    (await db.query<Record<string, unknown>>(sql, parameters)).rows;
  const store = createSchoolStore(query);
  const handlers = createSchoolHandlers(() => store);
  const origin = 'https://nanum.example';
  const endpoint = `${origin}/api/school`;
  const password = 'test-only-student-password';
  async function post(body: unknown, cookie = '', expected = 200) {
    const response = await handlers.POST(
      new Request(endpoint, {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          ...(['activate', 'create-school'].includes(
            String((body as Record<string, unknown>).action),
          )
            ? {
                consentAccepted: true,
                consentVersion: CONSENT_VERSION,
                name: (
                  {
                    '1101': '학생가',
                    '1102': '학생나',
                    '1103': '학생다',
                  } as Record<string, string>
                )[String((body as Record<string, unknown>).loginId)],
              }
            : {}),
          ...(body as Record<string, unknown>),
        }),
      }),
    );
    assert.equal(
      response.status,
      expected,
      JSON.stringify(await response.clone().json()),
    );
    return {
      data: (await response.json()) as Record<string, unknown>,
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
      response,
    };
  }
  const get = (action: string, cookie = '') =>
    handlers.GET(
      new Request(`${endpoint}?action=${action}`, {
        headers: { Cookie: cookie },
      }),
    );
  assert.equal((await get('workspace')).status, 401);
  assert.deepEqual(await (await get('me')).json(), { user: null });
  const created = await post({
    action: 'create-school',
    title: '검증용 학교',
    loginId: 'admin',
    password,
  });
  const admin = created.data.user as SchoolUser;
  assert.equal(admin.role, 'admin');
  assert.ok(!('passwordHash' in admin));
  assert.ok(!('sessionVersion' in admin));
  assert.match(
    created.response.headers.get('set-cookie')!,
    /HttpOnly; SameSite=Strict;.*; Secure$/,
  );
  await post(
    {
      action: 'import-roster',
      roster: '1101,학생가\n1102,학생나\n1103,학생다',
    },
    created.cookie,
    400,
  );
  // Legacy fixture verifies that pre-consent deployments can still activate existing invitations.
  const invitations = await store.importRoster(
    admin,
    parseRoster('1101,학생가\n1102,학생나\n1103,학생다'),
  );
  assert.equal(invitations.length, 3);
  assert.notEqual(invitations[0].code, invitations[1].code);
  const stored = await query(
    'SELECT * FROM nanum_private.accounts WHERE login_id = $1',
    ['1101'],
  );
  assert.equal(stored[0].invite_hash, tokenHash(invitations[0].code));
  assert.ok(!JSON.stringify(stored).includes(invitations[0].code));
  await post(
    {
      action: 'activate',
      loginId: '1102',
      code: invitations[0].code,
      password,
    },
    '',
    400,
  );
  const first = await post({
    action: 'activate',
    loginId: '1101',
    code: invitations[0].code,
    password,
  });
  const firstUser = first.data.user as SchoolUser;
  assert.equal(firstUser.role, 'student');
  await post(
    {
      action: 'activate',
      loginId: '1101',
      code: invitations[0].code,
      password,
    },
    '',
    400,
  );
  const second = await post({
    action: 'activate',
    loginId: '1102',
    code: invitations[1].code,
    password,
  });
  const secondUser = second.data.user as SchoolUser;

  const snapshot = async (cookie: string) =>
    (await (await get('workspace', cookie)).json()) as {
      state: State;
      revision: number;
    };
  const command = async (cookie: string, command: Command, expected = 200) => {
    const state = await snapshot(cookie);
    return post(
      { action: 'command', revision: state.revision, command },
      cookie,
      expected,
    );
  };
  await command(first.cookie, {
    type: 'add-item',
    ownerId: secondUser.id,
    title: '공유 참고서',
    category: '도서·참고서',
    condition: 2,
    zone: '본관',
  });
  let full = await snapshot(created.cookie);
  const item = full.state.items[0];
  assert.equal(item.ownerId, firstUser.id);
  const studentView = await snapshot(second.cookie);
  assert.equal(studentView.state.items[0].id, item.id);
  assert.ok(!JSON.stringify(studentView).includes('학생가'));
  assert.equal(
    studentView.state.people.find((p) => p.id === firstUser.id)?.studentNumber,
    undefined,
  );
  await command(second.cookie, {
    type: 'apply',
    participantId: firstUser.id,
    itemIds: [item.id],
    minCondition: 1,
    maxDistance: 500,
  });
  full = await snapshot(created.cookie);
  assert.equal(full.state.applications[0].participantId, secondUser.id);
  for (const cmd of [
    { type: 'delete-item', itemId: item.id },
    { type: 'confirm' },
    { type: 'close' },
    { type: 'new-event', title: '악의적 변경' },
    { type: 'load-demo' },
    { type: 'add-person' },
  ])
    await command(second.cookie, cmd, 400);
  assert.equal((await get('roster', second.cookie)).status, 403);
  await post(
    { action: 'import-roster', roster: '2213,추가학생' },
    second.cookie,
    403,
  );
  await command(created.cookie, { type: 'close' });
  await command(created.cookie, { type: 'confirm' });
  const matched = await snapshot(second.cookie);
  assert.equal(matched.state.matches.length, 1);
  assert.equal(
    matched.state.people.find((p) => p.id === firstUser.id)?.name,
    '학생가',
  );
  await command(created.cookie, { type: 'deliver', itemId: item.id });
  await command(created.cookie, { type: 'new-event', title: '두 번째 행사' });
  full = await snapshot(created.cookie);
  assert.equal(full.state.people.length, 3);
  assert.equal(full.state.items.length, 0);

  await t.test(
    'concurrent revisions and invitation consumption are atomic',
    async () => {
      const before = await snapshot(first.cookie);
      const commands = await Promise.all(
        [1, 2].map((i) =>
          handlers.POST(
            new Request(endpoint, {
              method: 'POST',
              headers: {
                Origin: origin,
                'Content-Type': 'application/json',
                Cookie: created.cookie,
              },
              body: JSON.stringify({
                action: 'command',
                revision: before.revision,
                command: { type: 'new-event', title: `동시 행사 ${i}` },
              }),
            }),
          ),
        ),
      );
      assert.deepEqual(
        commands.map((r) => r.status).sort((a, b) => a - b),
        [200, 409],
      );
      const hash = await hashPassword(password);
      const activated = await Promise.all(
        [1, 2].map(() =>
          store.activate(invitations[2].code, '1103', hash, {
            accepted: true,
            version: CONSENT_VERSION,
            name: '학생다',
          }),
        ),
      );
      assert.equal(activated.filter(Boolean).length, 1);
    },
  );

  await t.test(
    'cross-school data and roster reset cannot escape their school',
    async () => {
      const other = await post({
        action: 'create-school',
        title: '별도 검증 학교',
        loginId: 'admin',
        password,
      });
      const otherUser = other.data.user as SchoolUser;
      assert.notEqual(otherUser.schoolId, admin.schoolId);
      assert.equal((await snapshot(other.cookie)).state.people.length, 0);
      await post(
        { action: 'reissue', accountId: firstUser.id },
        other.cookie,
        400,
      );
      await post(
        {
          action: 'login',
          schoolCode: otherUser.schoolCode,
          loginId: '1101',
          password,
        },
        '',
        401,
      );
    },
  );

  await t.test(
    'reset invalidates old sessions and stale credential checks',
    async () => {
      const oldAccount = await store.findAccount(admin.schoolCode, '1101');
      const reset = await post(
        { action: 'reissue', accountId: firstUser.id },
        created.cookie,
      );
      assert.equal((await get('workspace', first.cookie)).status, 401);
      await assert.rejects(
        store.startSession(firstUser.id, oldAccount!.sessionVersion),
      );
      const invitation = (reset.data.invitations as Invitation[])[0];
      const renewed = await post({
        action: 'activate',
        loginId: '1101',
        code: invitation.code,
        password: 'different-password-strong',
      });
      assert.equal((await get('workspace', renewed.cookie)).status, 200);
      await post(
        {
          action: 'login',
          schoolCode: admin.schoolCode,
          loginId: '1101',
          password,
        },
        '',
        401,
      );
      const login = await post({
        action: 'login',
        schoolCode: admin.schoolCode,
        loginId: '1101',
        password: 'different-password-strong',
      });
      await post({ action: 'logout' }, login.cookie);
      assert.equal((await get('workspace', login.cookie)).status, 401);
      const active = await query('SELECT * FROM nanum_private.school_sessions');
      assert.ok(!JSON.stringify(active).includes(renewed.cookie.split('=')[1]));
      await query('UPDATE nanum_private.school_sessions SET expires = 0');
      assert.equal((await get('workspace', renewed.cookie)).status, 401);
      const loggedOut = await post({ action: 'logout' }, renewed.cookie);
      assert.match(loggedOut.response.headers.get('set-cookie')!, /Max-Age=0/);
      await post({ action: 'logout' });
    },
  );

  await t.test(
    'origins, invalid JSON, oversized requests and private tables are enforced',
    async () => {
      const request = (body: string, headers: Record<string, string>) =>
        handlers.POST(new Request(endpoint, { method: 'POST', headers, body }));
      assert.equal(
        (
          await request('{}', {
            Origin: 'https://evil.example',
            'Content-Type': 'application/json',
          })
        ).status,
        403,
      );
      assert.equal(
        (await request('{}', { 'Content-Type': 'application/json' })).status,
        403,
      );
      assert.equal(
        (
          await request('{', {
            Origin: origin,
            'Content-Type': 'application/json',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request('x'.repeat(64001), {
            Origin: origin,
            'Content-Type': 'application/json',
          })
        ).status,
        413,
      );
      await query('CREATE ROLE school_test_visitor');
      await query('SET ROLE school_test_visitor');
      try {
        await assert.rejects(
          query('SELECT * FROM nanum_private.accounts'),
          /permission denied/,
        );
      } finally {
        await query('RESET ROLE');
      }
    },
  );

  await t.test(
    'persistent throttling applies to account and address attempts',
    async () => {
      await store.limit('test-key', 1);
      await assert.rejects(store.limit('test-key', 1));
      await query('UPDATE nanum_private.school_limits SET expires = 0');
      await store.limit('test-key', 1);
    },
  );
});
