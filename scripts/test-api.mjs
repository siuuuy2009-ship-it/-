import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const first = await fetch(`${base}/api/workspace`);
assert.equal(first.status, 200);
const cookie = first.headers.get('set-cookie').split(';')[0];
let snapshot = await first.json();
assert.equal(snapshot.state.items.length, 6);
async function send(command, status = 200, revision = snapshot.revision) {
  const r = await fetch(`${base}/api/workspace`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: base,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ revision, command }),
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  if (status === 200) snapshot = data;
  return data;
}
await send({ type: 'new-event', title: 'API 검증 행사' });
await send({ type: 'add-person', name: '신청자', zone: '본관' });
await send({ type: 'add-person', name: '나눔자', zone: '후관' });
const [person, donor] = snapshot.state.people;
await send({
  type: 'add-item',
  title: '검증 참고서',
  ownerId: donor.id,
  category: '도서·참고서',
  condition: 2,
  zone: '후관',
  description: '실제 테스트 자료',
});
const item = snapshot.state.items[0];
await send({
  type: 'apply',
  participantId: person.id,
  itemIds: [item.id],
  minCondition: 1,
  maxDistance: 200,
});
await send(
  {
    type: 'apply',
    participantId: donor.id,
    itemIds: [item.id],
    minCondition: 1,
    maxDistance: 500,
  },
  400,
);
await send({ type: 'close' }, 409, 0);
await send({ type: 'confirm' }, 400);
await send({ type: 'close' });
await send({ type: 'confirm' });
assert.equal(snapshot.state.matches.length, 1);
await send({ type: 'deliver', itemId: item.id });
await send({ type: 'cancel-match', itemId: item.id }, 400);
const persisted = await (
  await fetch(`${base}/api/workspace`, { headers: { Cookie: cookie } })
).json();
assert.equal(persisted.state.matches[0].status, 'delivered');
const isolated = await (await fetch(`${base}/api/workspace`)).json();
assert.equal(isolated.state.items.length, 6);
const forbidden = await fetch(`${base}/api/workspace`, {
  method: 'POST',
  headers: { Cookie: cookie, Origin: 'https://example.invalid' },
  body: '{}',
});
assert.equal(forbidden.status, 403);
const noSession = await fetch(`${base}/api/workspace`, {
  method: 'POST',
  headers: { Origin: base },
  body: '{}',
});
assert.equal(noSession.status, 401);
const malformed = await fetch(`${base}/api/workspace`, {
  method: 'POST',
  headers: { Cookie: cookie, Origin: base },
  body: 'not-json',
});
assert.equal(malformed.status, 400);
console.log(
  'API checks passed: persistence, session isolation, request validation, concurrency, matching, delivery and origin checks.',
);
