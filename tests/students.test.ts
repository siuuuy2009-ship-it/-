import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand,
  compareMatching,
  demoState,
  DomainError,
  emptyState,
  parseStudentNumber,
  personLabel,
} from '../lib/domain.ts';

void test('all 288 school student numbers are valid and can register together', () => {
  let state = emptyState();
  for (let grade = 1; grade <= 3; grade++) {
    for (let classroom = 1; classroom <= 6; classroom++) {
      for (let number = 1; number <= 16; number++) {
        const studentNumber = `${grade}${classroom}${String(number).padStart(2, '0')}`;
        assert.deepEqual(parseStudentNumber(studentNumber), {
          studentNumber,
          label: `${grade}학년 ${classroom}반 ${number}번`,
        });
        state = applyCommand(state, {
          type: 'add-person',
          name: '동명이인',
          studentNumber,
          zone: '본관',
        });
      }
    }
  }
  assert.equal(state.people.length, 288);
  assert.equal(new Set(state.people.map((p) => p.studentNumber)).size, 288);
  assert.throws(
    () =>
      applyCommand(state, {
        type: 'add-person',
        name: '추가',
        studentNumber: '1101',
        zone: '본관',
      }),
    /288/,
  );
});

void test('invalid student numbers are rejected on the server without modifying data', () => {
  const state = emptyState();
  const original = structuredClone(state);
  const invalid = [
    undefined,
    null,
    2213,
    {},
    '',
    '213',
    '02213',
    '0213',
    '4213',
    '2013',
    '2713',
    '2200',
    '2217',
    '2299',
    '22a3',
    '２２１３',
    '22 13',
  ];
  for (const studentNumber of invalid) {
    assert.equal(parseStudentNumber(studentNumber), null);
    assert.throws(
      () =>
        applyCommand(state, {
          type: 'add-person',
          name: '학생',
          studentNumber,
          zone: '본관',
        }),
      DomainError,
    );
  }
  assert.deepEqual(state, original);
});

void test('student numbers identify namesakes and duplicates cannot bypass one-person matching', () => {
  let state = emptyState();
  state = applyCommand(state, {
    type: 'add-person',
    name: '김민수',
    studentNumber: ' 2213 ',
    zone: '본관',
  });
  state = applyCommand(state, {
    type: 'add-person',
    name: '김민수',
    studentNumber: '1101',
    zone: '본관',
  });
  assert.equal(personLabel(state.people[0]), '김민수 (2213)');
  assert.equal(personLabel(state.people[1]), '김민수 (1101)');
  assert.throws(
    () =>
      applyCommand(state, {
        type: 'add-person',
        name: '다른 이름',
        studentNumber: '2213',
        zone: '후관',
      }),
    /이미 등록된 학번/,
  );
  assert.equal(state.people.length, 2);
  const nextEvent = applyCommand(state, {
    type: 'new-event',
    title: '다음 행사',
  });
  assert.equal(
    applyCommand(nextEvent, {
      type: 'add-person',
      name: '김민수',
      studentNumber: '2213',
      zone: '본관',
    }).people.length,
    1,
  );
});

void test('previous participants without student numbers keep their existing matches', () => {
  const legacy = demoState();
  for (const person of legacy.people) delete person.studentNumber;
  const previous = structuredClone(legacy);
  const updated = applyCommand(legacy, {
    type: 'add-person',
    name: '민수',
    studentNumber: '2213',
    zone: '본관',
  });
  assert.deepEqual(updated.people.slice(0, 7), previous.people);
  assert.equal(personLabel(updated.people[0]), '민수');
  assert.equal(personLabel(updated.people[7]), '민수 (2213)');
  assert.equal(compareMatching(updated).maximum.pairs.length, 6);
  assert.deepEqual(legacy, previous);
});
