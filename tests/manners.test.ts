import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createSchoolStore, SchoolConflict } from '../db/school-store.ts';
import { hashPassword } from '../lib/server/passwords.ts';
import { CONSENT_VERSION } from '../lib/consent.ts';
import {
  mannerSummary,
  mannerTarget,
  MANNER_NOTICE_VERSION,
} from '../lib/manners.ts';
import { compareMatching, demoState, type Command } from '../lib/domain.ts';
import type { SchoolUser } from '../lib/school.ts';

void test('manner scores start at 50, stay within 0–100 and do not change matching', () => {
  assert.deepEqual(mannerSummary(), { score: 50, reviewCount: 0 });
  assert.deepEqual(mannerSummary(1, 1), { score: 52, reviewCount: 1 });
  assert.equal(mannerSummary(-1, 1).score, 48);
  assert.equal(mannerSummary(200, 200).score, 100);
  assert.equal(mannerSummary(-200, 200).score, 0);
  const state = demoState();
  const before = compareMatching(state).maximum.pairs;
  state.people[0].manners = mannerSummary(-200, 200);
  state.people[1].manners = mannerSummary(200, 200);
  assert.deepEqual(compareMatching(state).maximum.pairs, before);
  assert.throws(() => mannerTarget(state, 'p1', 'i1'));
});

void test('only delivered counterparties can rate once; ratings persist and withdraw with the account', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const query = async (sql: string, parameters?: unknown[]) =>
    (await db.query<Record<string, unknown>>(sql, parameters)).rows;
  const store = createSchoolStore(query);
  const hash = await hashPassword('test-manners-password');
  const admin = await store.createSchool('매너 검증', 'admin', hash);
  const invitations = await store.issueInvitations(admin, 3);
  const people: SchoolUser[] = [];
  for (let i = 0; i < 3; i++) {
    const person = await store.enroll(
      invitations[i].code,
      `110${i + 1}`,
      hash,
      { accepted: true, version: CONSENT_VERSION, name: `가상 학생${i}` },
    );
    assert.ok(person);
    people.push(person);
  }
  const [donor, recipient, outsider] = people;
  const command = async (user: SchoolUser, cmd: Command) =>
    store.command(user, cmd, (await store.snapshot(user)).revision);
  await command(donor, {
    type: 'add-item',
    title: '테스트 참고서',
    category: '도서·참고서',
    condition: 2,
    zone: '본관',
  });
  const item = (await store.snapshot(admin)).state.items[0];
  const rate = (rating: unknown): Command => ({
    type: 'rate-manners',
    itemId: item.id,
    rating,
    reviewConsent: true,
    noticeVersion: MANNER_NOTICE_VERSION,
  });
  await assert.rejects(command(donor, rate(1)), /전달/);
  await command(recipient, {
    type: 'apply',
    itemIds: [item.id],
    minCondition: 1,
  });
  await command(admin, { type: 'close' });
  await command(admin, { type: 'confirm' });
  await assert.rejects(command(donor, rate(1)), /전달/);
  await command(admin, { type: 'deliver', itemId: item.id });
  await assert.rejects(command(outsider, rate(1)), /직접/);
  await assert.rejects(command(admin, rate(1)), /학생/);
  await assert.rejects(
    command(donor, { ...rate(1), reviewConsent: false }),
    /안내/,
  );
  for (const invalid of [2, -2, '1', null])
    await assert.rejects(command(donor, rate(invalid)), /선택/);
  const before = (await store.snapshot(donor)).revision;
  const duplicate = await Promise.allSettled([
    store.command(
      donor,
      { ...rate(1), targetId: outsider.id, raterId: outsider.id },
      before,
    ),
    store.command(donor, rate(-1), before),
  ]);
  assert.equal(duplicate.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(
    duplicate.some(
      (r) => r.status === 'rejected' && r.reason instanceof SchoolConflict,
    ),
  );
  const rows = await query(
    'SELECT rater_id,target_id,rating,notice_version FROM nanum_private.manner_reviews',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rater_id, donor.id);
  assert.equal(rows[0].target_id, recipient.id);
  assert.equal(rows[0].notice_version, MANNER_NOTICE_VERSION);
  await assert.rejects(command(donor, rate(1)), /이미 평가/);
  await command(recipient, rate(0));
  const visible = await store.snapshot(recipient);
  assert.equal(visible.mannerRatings[item.id], 0);
  assert.equal(
    visible.state.people.find((p) => p.id === recipient.id)?.manners
      ?.reviewCount,
    1,
  );
  assert.equal(
    (await store.snapshot(outsider)).mannerRatings[item.id],
    undefined,
  );
  assert.ok(!JSON.stringify(visible).includes('rater_id'));
  await command(admin, { type: 'new-event', title: '다음 나눔' });
  const next = await store.snapshot(admin);
  assert.equal(
    next.state.people.find((p) => p.id === recipient.id)?.manners?.reviewCount,
    1,
  );
  assert.equal(
    next.state.people.find((p) => p.id === donor.id)?.manners?.score,
    50,
  );
  await store.withdraw(donor);
  assert.equal(
    (await query('SELECT * FROM nanum_private.manner_reviews')).length,
    0,
  );
  assert.deepEqual(
    (await store.snapshot(recipient)).state.people.find(
      (p) => p.id === recipient.id,
    )?.manners,
    mannerSummary(),
  );
});
