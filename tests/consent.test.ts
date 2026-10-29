import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createSchoolStore } from '../db/school-store.ts';
import { createSchoolHandlers } from '../lib/server/school.ts';
import { CONSENT_VERSION } from '../lib/consent.ts';
import { tokenHash } from '../lib/server/passwords.ts';
import type { SchoolUser } from '../lib/school.ts';
import type { State } from '../lib/domain.ts';

const origin = 'https://consent.example';
const endpoint = `${origin}/api/school`;
function request(body: unknown, cookie = '') {
  return new Request(endpoint, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}

void test('missing, false, string-valued and outdated consent cannot reach storage', async () => {
  let accesses = 0;
  const handlers = createSchoolHandlers(() => {
    accesses++;
    throw new Error('Storage must not be accessed');
  });
  for (const action of ['activate', 'create-school']) {
    for (const extra of [
      {},
      { consentAccepted: false, consentVersion: CONSENT_VERSION },
      { consentAccepted: 'true', consentVersion: CONSENT_VERSION },
      { consentAccepted: true, consentVersion: 'old-version' },
    ]) {
      const response = await handlers.POST(
        request({ action, name: '가상 학생', loginId: '1101', ...extra }),
      );
      assert.equal(response.status, 400);
      assert.match(
        String(((await response.json()) as { error: string }).error),
        /동의/,
      );
    }
  }
  assert.equal(accesses, 0);
});

void test('anonymous invitations enroll only after consent, record it and support actual deletion', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const query = async (sql: string, parameters?: unknown[]) =>
    (await db.query<Record<string, unknown>>(sql, parameters)).rows;
  const store = createSchoolStore(query);
  const handlers = createSchoolHandlers(() => store);
  const password = 'consent-test-password';
  async function post(
    body: Record<string, unknown>,
    cookie = '',
    status = 200,
  ) {
    const response = await handlers.POST(request(body, cookie));
    const data = (await response.json()) as {
      user: SchoolUser;
      invitations: { code: string }[];
      error?: string;
      state: State;
      revision: number;
    };
    assert.equal(response.status, status, data.error);
    return {
      data,
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  }
  async function snapshot(cookie: string) {
    const response = await handlers.GET(
      new Request(`${endpoint}?action=workspace`, {
        headers: { Cookie: cookie },
      }),
    );
    assert.equal(response.status, 200);
    return (await response.json()) as { state: State; revision: number };
  }
  const admin = await post({
    action: 'create-school',
    title: '동의 검증 학교',
    loginId: 'admin',
    password,
    consentAccepted: true,
    consentVersion: CONSENT_VERSION,
  });
  const issued = await post(
    { action: 'issue-invites', count: 3 },
    admin.cookie,
  );
  assert.equal(issued.data.invitations.length, 3);
  assert.deepEqual((await snapshot(admin.cookie)).state.people, []);
  assert.equal((await store.roster(admin.data.user)).length, 0);
  const before = await query('SELECT * FROM nanum_private.signup_invitations');
  assert.equal(before.length, 3);
  assert.ok(!JSON.stringify(before).includes(issued.data.invitations[0].code));
  assert.ok(before.every((row) => row.used_at === null));
  const signup = (i: number) => ({
    action: 'activate',
    loginId: ['1101', '1102', '1103'][i],
    name: ['가상 학생가', '가상 학생나', '가상 학생다'][i],
    code: issued.data.invitations[i].code,
    password,
    consentAccepted: true,
    consentVersion: CONSENT_VERSION,
  });
  await post({ ...signup(0), consentAccepted: false }, '', 400);
  assert.equal((await store.roster(admin.data.user)).length, 0);
  assert.equal(
    (
      await query(
        'SELECT used_at FROM nanum_private.signup_invitations WHERE token_hash = $1',
        [tokenHash(issued.data.invitations[0].code)],
      )
    )[0].used_at,
    null,
  );
  const donor = await post(signup(0));
  const recipient = await post(signup(1));
  const rows = await query(
    'SELECT consent_version, consented_at FROM nanum_private.accounts WHERE id = $1',
    [donor.data.user.id],
  );
  assert.equal(rows[0].consent_version, CONSENT_VERSION);
  assert.ok(Number(rows[0].consented_at) > 0);
  await post(signup(0), '', 400);
  await post({ ...signup(2), loginId: '1101' }, '', 400);
  const unused = (
    await query(
      'SELECT used_at FROM nanum_private.signup_invitations WHERE token_hash = $1',
      [tokenHash(issued.data.invitations[2].code)],
    )
  )[0];
  assert.equal(unused.used_at, null);
  const concurrent = await Promise.all(
    [1, 2].map(() => handlers.POST(request(signup(2)))),
  );
  assert.equal(
    concurrent.filter((response) => response.status === 200).length,
    1,
  );
  async function command(cookie: string, cmd: Record<string, unknown>) {
    const current = await snapshot(cookie);
    return post(
      { action: 'command', revision: current.revision, command: cmd },
      cookie,
    );
  }
  await command(donor.cookie, {
    type: 'add-item',
    title: '가상 참고서',
    ownerId: recipient.data.user.id,
    category: '도서·참고서',
    condition: 2,
    zone: '본관',
  });
  const item = (await snapshot(admin.cookie)).state.items[0];
  await command(donor.cookie, {
    type: 'add-need',
    requesterId: recipient.data.user.id,
    title: '여분의 옷걸이 부탁해요',
    category: '생활용품',
  });
  assert.equal(
    (await snapshot(admin.cookie)).state.needs![0].requesterId,
    donor.data.user.id,
  );
  await command(recipient.cookie, {
    type: 'apply',
    itemIds: [item.id],
    minCondition: 1,
  });
  await command(admin.cookie, { type: 'close' });
  await command(admin.cookie, { type: 'confirm' });
  assert.equal((await snapshot(admin.cookie)).state.matches.length, 1);
  await post({ action: 'withdraw', password }, donor.cookie, 400);
  await post(
    { action: 'withdraw', password: 'wrong', deleteConfirmed: true },
    donor.cookie,
    401,
  );
  assert.equal((await snapshot(admin.cookie)).state.people.length, 3);
  await post(
    { action: 'withdraw', password, deleteConfirmed: true },
    donor.cookie,
  );
  const after = await snapshot(admin.cookie);
  assert.equal(after.state.items.length, 0);
  assert.equal(after.state.matches.length, 0);
  assert.equal(after.state.applications.length, 0);
  assert.equal(after.state.needs!.length, 0);
  assert.ok(!JSON.stringify(after).includes('가상 학생가'));
  assert.equal(
    (
      await query('SELECT id FROM nanum_private.accounts WHERE id = $1', [
        donor.data.user.id,
      ])
    ).length,
    0,
  );
  assert.equal(
    (
      await query(
        'SELECT token_hash FROM nanum_private.school_sessions WHERE account_id = $1',
        [donor.data.user.id],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await query(
        'SELECT token_hash FROM nanum_private.signup_invitations WHERE used_by = $1',
        [donor.data.user.id],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await handlers.GET(
        new Request(`${endpoint}?action=workspace`, {
          headers: { Cookie: donor.cookie },
        }),
      )
    ).status,
    401,
  );
  await post(signup(0), '', 400);
});
