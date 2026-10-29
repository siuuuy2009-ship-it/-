import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassroomDemo } from '../lib/classroom-demo.ts';
import { compareMatching } from '../lib/domain.ts';
import { MANNER_NOTICE_VERSION } from '../lib/manners.ts';

void test('six fictional students demonstrate the same maximum matching with student-owned items', () => {
  const demo = new ClassroomDemo();
  const snapshot = demo.snapshot(demo.users[0]);
  assert.equal(snapshot.state.people.length, 6);
  assert.ok(snapshot.state.people.every((p) => p.name.startsWith('가상 ')));
  assert.equal(snapshot.state.items.length, 6);
  assert.equal(snapshot.state.applications.length, 6);
  assert.equal(compareMatching(snapshot.state).maximum.pairs.length, 6);
  assert.equal(compareMatching(snapshot.state).sequential.length, 3);
  snapshot.state.people.splice(0);
  assert.equal(demo.snapshot(demo.users[0]).state.people.length, 6);
});

void test('switching demo roles shares edits and keeps student command permissions', async () => {
  const demo = new ClassroomDemo();
  const [admin, student, other] = demo.users;
  const client = demo.client(student);
  const result = await client.save(
    {
      type: 'add-item',
      ownerId: other.id,
      title: '가상 노트',
      category: '학용품',
      condition: 2,
      zone: '본관',
    },
    0,
  );
  assert.equal(result.state.items.at(-1)?.ownerId, student.id);
  assert.equal(demo.snapshot(admin).state.items.length, 7);
  assert.throws(() => demo.command(student, { type: 'close' }, 1));
  assert.throws(() =>
    demo.command(student, { type: 'delete-item', itemId: 'i1' }, 1),
  );
  assert.throws(() => demo.command(admin, { type: 'close' }, 0));
  assert.throws(() => demo.snapshot({ ...admin, role: 'student' }));
  assert.equal(new ClassroomDemo().snapshot(admin).state.items.length, 6);
});

void test('capture stages use real matching rules and permit only delivered-counterparty reviews', () => {
  const confirmed = new ClassroomDemo('confirmed');
  const admin = confirmed.users[0];
  assert.equal(confirmed.snapshot(admin).state.matches.length, 6);
  assert.ok(
    confirmed
      .snapshot(admin)
      .state.matches.every((m) => m.status === 'confirmed'),
  );
  const demo = new ClassroomDemo('delivered');
  const snapshot = demo.snapshot(demo.users[0]);
  assert.ok(snapshot.state.matches.every((m) => m.status === 'delivered'));
  const match = snapshot.state.matches[0];
  const recipient = demo.users.find((p) => p.id === match.participantId)!;
  const ownerId = snapshot.state.items.find(
    (i) => i.id === match.itemId,
  )!.ownerId;
  const rate = {
    type: 'rate-manners',
    itemId: match.itemId,
    rating: 1,
    reviewConsent: true,
    noticeVersion: MANNER_NOTICE_VERSION,
  };
  assert.throws(() => confirmed.command(recipient, rate, 0));
  assert.throws(() => demo.command(demo.users[0], rate, 0));
  assert.throws(() =>
    demo.command(recipient, { ...rate, reviewConsent: false }, 0),
  );
  demo.command(recipient, rate, 0);
  assert.equal(
    demo.snapshot(admin).state.people.find((p) => p.id === ownerId)!.manners!
      .score,
    52,
  );
  assert.equal(demo.snapshot(recipient).mannerRatings![match.itemId], 1);
  assert.deepEqual(demo.snapshot(admin).mannerRatings, {});
  assert.throws(() => demo.command(recipient, rate, 1));
});
