import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresWorkspaces,
  type Query,
} from '../db/postgres-workspaces.ts';
import {
  createWorkspaceHandlers,
  StorageNotConfigured,
} from '../lib/server/workspace.ts';
import { compareMatching, type State, type Command } from '../lib/domain.ts';

const origin = 'https://dasi-nanum.example';
const endpoint = `${origin}/api/workspace`;
type Snapshot = { state: State; revision: number };

void test('PostgreSQL workspace: persistence, isolation, matching and atomic revisions', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const query: Query = async (sql, parameters) =>
    (await db.query<Record<string, unknown>>(sql, parameters)).rows;
  const store = createPostgresWorkspaces(query);
  const handlers = createWorkspaceHandlers(() => store);
  const first = await handlers.GET(new Request(endpoint));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.match(
    first.headers.get('set-cookie')!,
    /HttpOnly; SameSite=Strict;.*; Secure$/,
  );
  const cookie = first.headers.get('set-cookie')!.split(';')[0];
  let snapshot = (await first.json()) as Snapshot;
  assert.equal(snapshot.state.items.length, 6);
  const send = (command: Command, revision = snapshot.revision) =>
    handlers.POST(
      new Request(endpoint, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: origin },
        body: JSON.stringify({ command, revision }),
      }),
    );

  await t.test(
    'maximum matching and delivery persist across server instances',
    async () => {
      let response = await send({ type: 'close' });
      assert.equal(response.status, 200);
      snapshot = (await response.json()) as Snapshot;
      const expected = compareMatching(snapshot.state).maximum.pairs.length;
      response = await send({ type: 'confirm' });
      assert.equal(response.status, 200);
      snapshot = (await response.json()) as Snapshot;
      assert.equal(snapshot.state.matches.length, expected);
      assert.equal(expected, 6);
      response = await send({
        type: 'deliver',
        itemId: snapshot.state.matches[0].itemId,
      });
      assert.equal(response.status, 200);
      snapshot = (await response.json()) as Snapshot;
      const otherServer = createWorkspaceHandlers(() =>
        createPostgresWorkspaces(query),
      );
      const loaded = await otherServer.GET(
        new Request(endpoint, { headers: { Cookie: cookie } }),
      );
      assert.deepEqual(await loaded.json(), snapshot);
      const isolated = await handlers.GET(new Request(endpoint));
      assert.notEqual(
        isolated.headers.get('set-cookie')!.split(';')[0],
        cookie,
      );
      assert.equal(((await isolated.json()) as Snapshot).revision, 0);
    },
  );

  await t.test('concurrent writes cannot overwrite one another', async () => {
    const revision = snapshot.revision;
    const responses = await Promise.all([
      send({ type: 'new-event', title: '행사 A' }, revision),
      send({ type: 'new-event', title: '행사 B' }, revision),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort((a, b) => a - b), [200, 409]);
    snapshot = (await responses
      .find((r) => r.status === 200)!
      .json()) as Snapshot;
    const persisted = await handlers.GET(
      new Request(endpoint, { headers: { Cookie: cookie } }),
    );
    assert.deepEqual(await persisted.json(), snapshot);
  });

  await t.test(
    'user text is stored literally, with no SQL interpolation',
    async () => {
      const title = "나눔 '); DROP TABLE workspaces; --";
      const response = await send({ type: 'new-event', title });
      assert.equal(response.status, 200);
      snapshot = (await response.json()) as Snapshot;
      assert.equal(snapshot.state.title, title);
      const loaded = await handlers.GET(
        new Request(endpoint, { headers: { Cookie: cookie } }),
      );
      assert.deepEqual(await loaded.json(), snapshot);
    },
  );

  await t.test(
    'invalid origins, sessions, JSON and oversized bodies are rejected',
    async () => {
      const cases: {
        headers: Record<string, string>;
        body: string;
        status: number;
      }[] = [
        {
          headers: { Cookie: cookie, Origin: 'https://elsewhere.example' },
          body: '{}',
          status: 403,
        },
        { headers: { Origin: origin }, body: '{}', status: 401 },
        {
          headers: { Cookie: cookie, Origin: origin },
          body: 'invalid',
          status: 400,
        },
        {
          headers: { Cookie: cookie, Origin: origin },
          body: 'x'.repeat(20001),
          status: 413,
        },
      ];
      for (const entry of cases) {
        const response = await handlers.POST(
          new Request(endpoint, {
            method: 'POST',
            headers: entry.headers,
            body: entry.body,
          }),
        );
        assert.equal(response.status, entry.status);
      }
    },
  );

  await t.test(
    'database table is private and row-level security is enabled',
    async () => {
      const rls = await query(
        "SELECT relrowsecurity FROM pg_class WHERE oid = 'nanum_private.workspaces'::regclass",
      );
      assert.equal(rls[0].relrowsecurity, true);
      await query('CREATE ROLE nanum_test_visitor');
      await query('SET ROLE nanum_test_visitor');
      try {
        await assert.rejects(
          query('SELECT * FROM nanum_private.workspaces'),
          /permission denied/,
        );
      } finally {
        await query('RESET ROLE');
      }
    },
  );
});

void test('missing database returns a clear 503 without pretending to save', async () => {
  const handlers = createWorkspaceHandlers(() => {
    throw new StorageNotConfigured();
  });
  const response = await handlers.GET(new Request(endpoint));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    'STORAGE_NOT_CONFIGURED',
  );
});

void test('failed initialization can recover on a later request', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  let first = true;
  const store = createPostgresWorkspaces(async (sql, parameters) => {
    if (first) {
      first = false;
      throw new Error('temporary outage');
    }
    return (await db.query<Record<string, unknown>>(sql, parameters)).rows;
  });
  const id = crypto.randomUUID();
  await assert.rejects(store.find(id), /temporary outage/);
  assert.equal(await store.find(id), null);
});
