import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maximumMatching,
  sequentialMatching,
  type Edge,
} from '../lib/matching.ts';
import {
  applyCommand,
  compareMatching,
  demoState,
  eligibleEdges,
  emptyState,
  type State,
} from '../lib/domain.ts';

function brute(
  items: string[],
  edges: Edge[],
  index = 0,
  used = new Set<string>(),
): number {
  if (index === items.length) return 0;
  let best = brute(items, edges, index + 1, used);
  for (const edge of edges.filter(
    (e) => e.itemId === items[index] && !used.has(e.participantId),
  )) {
    const next = new Set(used);
    next.add(edge.participantId);
    best = Math.max(best, 1 + brute(items, edges, index + 1, next));
  }
  return best;
}
void test('all bipartite graphs up to 4 by 4 agree with independent exhaustive search', () => {
  let graphs = 0;
  for (let left = 0; left <= 4; left++)
    for (let right = 0; right <= 4; right++) {
      const items = Array.from({ length: left }, (_, i) => `i${i}`);
      for (let mask = 0; mask < 2 ** (left * right); mask++) {
        const edges: Edge[] = [];
        for (let i = 0; i < left; i++)
          for (let j = 0; j < right; j++)
            if (mask & (1 << (i * right + j)))
              edges.push({ itemId: `i${i}`, participantId: `p${j}` });
        const { pairs } = maximumMatching(items, edges);
        assert.equal(pairs.length, brute(items, edges));
        assert.equal(new Set(pairs.map((p) => p.itemId)).size, pairs.length);
        assert.equal(
          new Set(pairs.map((p) => p.participantId)).size,
          pairs.length,
        );
        assert.ok(
          pairs.every((p) =>
            edges.some(
              (e) =>
                e.itemId === p.itemId && e.participantId === p.participantId,
            ),
          ),
        );
        assert.ok(pairs.length >= sequentialMatching(items, edges).length);
        graphs++;
      }
    }
  assert.equal(graphs, 74963);
});
void test('reassignment example and longer augmenting paths', () => {
  const e = (itemId: string, participantId: string) => ({
    itemId,
    participantId,
  });
  const edges = [
    e('A', '1'),
    e('A', '2'),
    e('B', '2'),
    e('B', '3'),
    e('C', '1'),
  ];
  assert.equal(maximumMatching(['A', 'B', 'C'], edges).pairs.length, 3);
  assert.equal(
    maximumMatching(['C', 'B', 'A'], edges.toReversed()).pairs.length,
    3,
  );
  const demo = compareMatching(demoState());
  assert.equal(demo.sequential.length, 3);
  assert.equal(demo.maximum.pairs.length, 6);
});
void test('own items, state and distance are hard eligibility conditions', () => {
  const state = demoState();
  state.items[0].ownerId = 'p1';
  state.items[1].condition = 1;
  state.applications[0].minCondition = 2;
  assert.equal(
    eligibleEdges(state).filter((e) => e.participantId === 'p1').length,
    0,
  );
  state.people[1].zone = '기숙사';
  state.applications[1].maxDistance = 400;
  assert.equal(
    eligibleEdges(state).filter((e) => e.participantId === 'p2').length,
    0,
  );
});
void test('confirmation, delivery and cancellation preserve locked vertices', () => {
  let state = demoState();
  assert.throws(() => applyCommand(state, { type: 'confirm' }));
  state = applyCommand(state, { type: 'close' });
  state = applyCommand(state, { type: 'confirm' });
  assert.equal(state.matches.length, 6);
  assert.equal(compareMatching(state).maximum.pairs.length, 0);
  assert.throws(() => applyCommand(state, { type: 'reopen' }));
  const first = state.matches[0];
  state = applyCommand(state, { type: 'deliver', itemId: first.itemId });
  assert.throws(() =>
    applyCommand(state, { type: 'cancel-match', itemId: first.itemId }),
  );
  assert.throws(() =>
    applyCommand(state, { type: 'deliver', itemId: first.itemId }),
  );
  const second = state.matches[1];
  state = applyCommand(state, { type: 'cancel-match', itemId: second.itemId });
  assert.ok(
    !eligibleEdges(state).some(
      (e) =>
        e.itemId === first.itemId || e.participantId === first.participantId,
    ),
  );
  assert.ok(
    !eligibleEdges(state).some(
      (e) =>
        e.itemId === second.itemId && e.participantId === second.participantId,
    ),
  );
});
void test('duplicate requests merge, deleting items removes obsolete requests', () => {
  let state = demoState();
  state = applyCommand(state, {
    type: 'apply',
    participantId: 'p1',
    itemIds: ['i1', 'i1', 'i2'],
    minCondition: 1,
    maxDistance: 500,
  });
  assert.equal(
    state.applications.filter((a) => a.participantId === 'p1').length,
    1,
  );
  assert.equal(state.applications[0].itemIds.length, 2);
  state = applyCommand(state, { type: 'delete-item', itemId: 'i1' });
  assert.ok(state.applications.every((a) => !a.itemIds.includes('i1')));
  assert.ok(!state.applications.some((a) => a.participantId === 'p2'));
  state = applyCommand(state, {
    type: 'apply',
    participantId: 'p1',
    itemIds: [],
    minCondition: 1,
    maxDistance: 500,
  });
  assert.ok(!state.applications.some((a) => a.participantId === 'p1'));
});
void test('validation rejects malformed input and never mutates the input state', () => {
  const state = demoState();
  const copy = structuredClone(state);
  const commands = [
    { type: 'add-person', name: '민수', zone: '본관' },
    { type: 'add-person', name: ' ', zone: '본관' },
    { type: 'add-person', name: '수현', zone: '없는 장소' },
    { type: 'add-item', ownerId: 'missing' },
    {
      type: 'apply',
      participantId: 'p7',
      itemIds: ['i1'],
      minCondition: 1,
      maxDistance: 500,
    },
    {
      type: 'apply',
      participantId: 'p1',
      itemIds: ['missing'],
      minCondition: 1,
      maxDistance: 500,
    },
    {
      type: 'apply',
      participantId: 'p1',
      itemIds: ['i1'],
      minCondition: 4,
      maxDistance: 500,
    },
    {
      type: 'apply',
      participantId: 'p1',
      itemIds: ['i1'],
      minCondition: 1,
      maxDistance: NaN,
    },
    { type: 'unknown' },
  ];
  for (const cmd of commands) assert.throws(() => applyCommand(state, cmd));
  assert.deepEqual(state, copy);
  const result = applyCommand(state, { type: 'new-event', title: '새 행사' });
  assert.equal(result.isDemo, false);
  assert.equal(result.items.length, 0);
  assert.deepEqual(state, copy);
});
void test('a partial fixed assignment reserves both endpoints', () => {
  const state: State = demoState();
  state.matches = [{ itemId: 'i1', participantId: 'p1', status: 'confirmed' }];
  const result = compareMatching(state);
  assert.ok(
    result.maximum.pairs.every(
      (p) => p.itemId !== 'i1' && p.participantId !== 'p1',
    ),
  );
  assert.equal(result.maximum.pairs.length, 4);
  assert.equal(compareMatching(emptyState()).maximum.pairs.length, 0);
});
