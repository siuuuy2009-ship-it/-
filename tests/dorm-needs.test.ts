import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, demoState, compareMatching } from '../lib/domain.ts';
import { authorizeSchoolCommand, type SchoolUser } from '../lib/school.ts';

void test('daily needs can be posted before matching, stay separate from allocation and preserve ownership', () => {
  let state = demoState();
  const student: SchoolUser = {
    id: 'p1',
    name: '가상 학생',
    loginId: '1101',
    role: 'student',
    schoolCode: 'test',
    schoolId: 'test',
  };
  const before = compareMatching(state).maximum.pairs;
  state = applyCommand(
    state,
    authorizeSchoolCommand(
      state,
      {
        type: 'add-need',
        requesterId: 'p2',
        title: '옷걸이 필요해요',
        category: '생활용품',
        description: '남는 옷걸이 부탁해요',
      },
      student,
    ),
  );
  assert.equal(state.needs![0].requesterId, 'p1');
  assert.deepEqual(compareMatching(state).maximum.pairs, before);
  const resolve = { type: 'resolve-need', needId: state.needs![0].id };
  assert.throws(() =>
    authorizeSchoolCommand(state, resolve, { ...student, id: 'p2' }),
  );
  state = applyCommand(state, authorizeSchoolCommand(state, resolve, student));
  assert.equal(state.needs![0].resolved, true);
  assert.throws(() =>
    applyCommand(state, {
      type: 'add-need',
      requesterId: 'p1',
      title: ' ',
      category: '생활용품',
    }),
  );
});

void test('next batch preserves unfilled needs and remaining items and blocks unfinished deliveries', () => {
  let state = demoState();
  state = applyCommand(state, {
    type: 'add-need',
    requesterId: 'p1',
    title: '옷걸이 구해요',
    category: '생활용품',
  });
  state = applyCommand(state, { type: 'close' });
  state = applyCommand(state, { type: 'confirm' });
  assert.throws(() => applyCommand(state, { type: 'next-round' }));
  state = applyCommand(state, {
    type: 'add-need',
    requesterId: 'p2',
    title: '공책 구해요',
    category: '학용품',
  });
  for (const match of state.matches)
    state = applyCommand(state, { type: 'deliver', itemId: match.itemId });
  const next = applyCommand(state, { type: 'next-round' });
  assert.equal(next.phase, 'open');
  assert.equal(next.round, 2);
  assert.equal(next.items.length, 0);
  assert.equal(next.matches.length, 0);
  assert.equal(next.applications.length, 0);
  assert.equal(next.needs!.length, 2);
  assert.equal(next.people.length, 7);
});
