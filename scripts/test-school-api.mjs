import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CONSENT_VERSION } from '../lib/consent.ts';
import { MANNER_NOTICE_VERSION } from '../lib/manners.ts';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000';
const password = randomBytes(24).toString('base64url');
async function send(body, cookie = '', expected = 200) {
  const response = await fetch(`${base}/api/school`, {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    expected,
    data.error ?? `Unexpected status ${response.status}`,
  );
  return {
    data,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
  };
}
const admin = await send({
  action: 'create-school',
  title: '자동 검증용 나눔함',
  loginId: 'test-admin',
  password,
  consentAccepted: true,
  consentVersion: CONSENT_VERSION,
});
const imported = await send(
  { action: 'issue-invites', count: 2 },
  admin.cookie,
);
const activate = async (i) =>
  send({
    action: 'activate',
    loginId: ['1101', '1102'][i],
    name: ['검증학생가', '검증학생나'][i],
    code: imported.data.invitations[i].code,
    password,
    consentAccepted: true,
    consentVersion: CONSENT_VERSION,
  });
const donor = await activate(0);
const recipient = await activate(1);
await send(
  {
    action: 'activate',
    loginId: '1101',
    name: '검증학생가',
    code: imported.data.invitations[0].code,
    password,
    consentAccepted: true,
    consentVersion: CONSENT_VERSION,
  },
  '',
  400,
);
async function snapshot(cookie) {
  const response = await fetch(`${base}/api/school?action=workspace`, {
    headers: { Cookie: cookie },
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function command(cookie, command, expected = 200) {
  const state = await snapshot(cookie);
  return send(
    { action: 'command', revision: state.revision, command },
    cookie,
    expected,
  );
}
await command(donor.cookie, {
  type: 'add-item',
  ownerId: recipient.data.user.id,
  title: '검증용 참고서',
  category: '도서·참고서',
  condition: 2,
  zone: '본관',
});
const item = (await snapshot(admin.cookie)).state.items[0];
assert.equal(item.ownerId, donor.data.user.id);
await command(recipient.cookie, {
  type: 'apply',
  participantId: donor.data.user.id,
  itemIds: [item.id],
  minCondition: 1,
  maxDistance: 500,
});
await command(recipient.cookie, { type: 'close' }, 400);
await command(recipient.cookie, { type: 'delete-item', itemId: item.id }, 400);
const review = {
  type: 'rate-manners',
  itemId: item.id,
  rating: 1,
  reviewConsent: true,
  noticeVersion: MANNER_NOTICE_VERSION,
};
await command(recipient.cookie, review, 400);
await command(admin.cookie, { type: 'close' });
await command(admin.cookie, { type: 'confirm' });
const result = await snapshot(recipient.cookie);
assert.equal(result.state.matches[0].participantId, recipient.data.user.id);
assert.equal(result.state.matches[0].itemId, item.id);
await command(admin.cookie, { type: 'deliver', itemId: item.id });
assert.equal(
  (await snapshot(donor.cookie)).state.matches[0].status,
  'delivered',
);
await command(recipient.cookie, review);
assert.equal(
  (await snapshot(donor.cookie)).state.people.find(
    (person) => person.id === donor.data.user.id,
  ).manners.score,
  52,
);
await command(recipient.cookie, review, 400);
await command(donor.cookie, { ...review, rating: 0 });
await send({ action: 'logout' }, recipient.cookie);
assert.equal(
  (
    await fetch(`${base}/api/school?action=workspace`, {
      headers: { Cookie: recipient.cookie },
    })
  ).status,
  401,
);
await send(
  { action: 'withdraw', password, deleteConfirmed: true },
  donor.cookie,
);
assert.equal(
  (
    await fetch(`${base}/api/school?action=workspace`, {
      headers: { Cookie: donor.cookie },
    })
  ).status,
  401,
);
assert.ok(
  !(await snapshot(admin.cookie)).state.people.some(
    (person) => person.id === donor.data.user.id,
  ),
);
console.log(
  'School API checks passed: consent-first invitations, login, sharing, ownership, maximum matching, delivery, logout and withdrawal deletion.',
);
