import { randomUUID, randomBytes } from 'node:crypto';
import {
  applyCommand,
  DomainError,
  emptyState,
  type State,
  type Command,
} from '../lib/domain.ts';
import {
  authorizeSchoolCommand,
  schoolStateForUser,
  type SchoolUser,
  type RosterEntry,
  type Invitation,
  type RosterMember,
} from '../lib/school.ts';
import { secretToken, tokenHash } from '../lib/server/passwords.ts';
import type { Query } from './postgres-workspaces.ts';

type Account = SchoolUser & {
  passwordHash: string | null;
  sessionVersion: number;
};
type Snapshot = { state: State; revision: number };
export class SchoolConflict extends Error {}
export class SchoolRateLimit extends Error {}

export function createSchoolStore(query: Query) {
  let ready: Promise<unknown> | undefined;
  const initialize = () => {
    ready ??= query(`DO $school_setup$ BEGIN
      PERFORM pg_advisory_xact_lock(48129, 2026);
      CREATE SCHEMA IF NOT EXISTS nanum_private;
      REVOKE ALL ON SCHEMA nanum_private FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS nanum_private.schools (
        id UUID PRIMARY KEY, code TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS nanum_private.accounts (
        id UUID PRIMARY KEY, school_id UUID NOT NULL REFERENCES nanum_private.schools(id),
        login_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','student')),
        password_hash TEXT, invite_hash TEXT UNIQUE, invite_expires BIGINT, session_version INTEGER NOT NULL DEFAULT 0,
        UNIQUE(school_id, login_id)
      );
      CREATE TABLE IF NOT EXISTS nanum_private.school_sessions (
        token_hash TEXT PRIMARY KEY, account_id UUID NOT NULL REFERENCES nanum_private.accounts(id), expires BIGINT NOT NULL, session_version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS nanum_private.school_limits (
        key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires BIGINT NOT NULL
      );
      ALTER TABLE nanum_private.schools ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nanum_private.accounts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nanum_private.school_sessions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nanum_private.school_limits ENABLE ROW LEVEL SECURITY;
    END $school_setup$`).catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };
  const account = (row: Record<string, unknown>): Account => ({
    id: String(row.id),
    schoolId: String(row.school_id),
    schoolCode: String(row.code),
    loginId: String(row.login_id),
    name: String(row.name),
    role: row.role as 'admin' | 'student',
    passwordHash: row.password_hash as string | null,
    sessionVersion: Number(row.session_version),
  });
  const find = async (schoolId: string): Promise<Snapshot> => {
    await initialize();
    const [row] = await query(
      'SELECT state, revision FROM nanum_private.schools WHERE id = $1',
      [schoolId],
    );
    if (!row) throw new DomainError('학교 나눔함을 찾을 수 없어요.');
    return {
      state: JSON.parse(String(row.state)) as State,
      revision: Number(row.revision),
    };
  };
  const update = async (schoolId: string, revision: number, state: State) => {
    const rows = await query(
      'UPDATE nanum_private.schools SET state = $1, revision = revision + 1 WHERE id = $2 AND revision = $3 RETURNING id',
      [JSON.stringify(state), schoolId, revision],
    );
    if (!rows.length) throw new SchoolConflict();
  };
  return {
    async limit(key: string, maximum: number, windowMs = 900000) {
      await initialize();
      const now = Date.now();
      const [row] = await query(
        `INSERT INTO nanum_private.school_limits (key, count, expires) VALUES ($1, 1, $2)
        ON CONFLICT (key) DO UPDATE SET count = CASE WHEN school_limits.expires < $3 THEN 1 ELSE school_limits.count + 1 END,
        expires = CASE WHEN school_limits.expires < $3 THEN $2 ELSE school_limits.expires END RETURNING count`,
        [tokenHash(key), now + windowMs, now],
      );
      if (Number(row.count) > maximum) throw new SchoolRateLimit();
    },
    async createSchool(
      name: string,
      loginId: string,
      passwordHash: string,
    ): Promise<Account> {
      await initialize();
      const schoolId = randomUUID();
      const id = randomUUID();
      const schoolCode = randomBytes(4).toString('hex');
      const state = emptyState(1, name);
      await query(
        `WITH school AS (
        INSERT INTO nanum_private.schools (id, code, state, created_at) VALUES ($1, $2, $3, $4) RETURNING id
      ) INSERT INTO nanum_private.accounts (id, school_id, login_id, name, role, password_hash)
        SELECT $5, id, $6, $7, 'admin', $8 FROM school`,
        [
          schoolId,
          schoolCode,
          JSON.stringify(state),
          Date.now(),
          id,
          loginId,
          '운영자',
          passwordHash,
        ],
      );
      return {
        id,
        schoolId,
        schoolCode,
        loginId,
        name: '운영자',
        role: 'admin',
        passwordHash,
        sessionVersion: 0,
      };
    },
    async findAccount(
      schoolCode: string,
      loginId: string,
    ): Promise<Account | null> {
      await initialize();
      const [row] = await query(
        `SELECT a.*, s.code FROM nanum_private.accounts a JOIN nanum_private.schools s ON s.id = a.school_id WHERE s.code = $1 AND a.login_id = $2`,
        [schoolCode, loginId],
      );
      return row ? account(row) : null;
    },
    async activate(
      code: string,
      loginId: string,
      passwordHash: string,
    ): Promise<Account | null> {
      await initialize();
      const [row] = await query(
        `WITH activated AS (
        UPDATE nanum_private.accounts SET password_hash = $1, invite_hash = NULL, invite_expires = NULL, session_version = session_version + 1
        WHERE invite_hash = $2 AND invite_expires > $3 AND login_id = $4 RETURNING *
      ) SELECT a.*, s.code FROM activated a JOIN nanum_private.schools s ON s.id = a.school_id`,
        [passwordHash, tokenHash(code), Date.now(), loginId],
      );
      if (!row) return null;
      return account(row);
    },
    async session(token: string): Promise<SchoolUser | null> {
      await initialize();
      const [row] = await query(
        `SELECT a.*, s.code FROM nanum_private.school_sessions t
        JOIN nanum_private.accounts a ON a.id = t.account_id JOIN nanum_private.schools s ON s.id = a.school_id
        WHERE t.token_hash = $1 AND t.expires > $2 AND t.session_version = a.session_version`,
        [tokenHash(token), Date.now()],
      );
      if (!row) return null;
      const { passwordHash: _, sessionVersion: __, ...user } = account(row);
      return user;
    },
    async startSession(
      userId: string,
      sessionVersion: number,
    ): Promise<string> {
      await initialize();
      const token = secretToken();
      await query(
        'DELETE FROM nanum_private.school_sessions WHERE expires < $1',
        [Date.now()],
      );
      const rows = await query(
        'INSERT INTO nanum_private.school_sessions (token_hash, account_id, expires, session_version) SELECT $1, id, $3, session_version FROM nanum_private.accounts WHERE id = $2 AND session_version = $4 AND password_hash IS NOT NULL RETURNING token_hash',
        [tokenHash(token), userId, Date.now() + 604800000, sessionVersion],
      );
      if (!rows.length)
        throw new DomainError('계정 정보가 바뀌었어요. 다시 로그인해 주세요.');
      return token;
    },
    async logout(token: string) {
      await initialize();
      await query(
        'DELETE FROM nanum_private.school_sessions WHERE token_hash = $1',
        [tokenHash(token)],
      );
    },
    async snapshot(user: SchoolUser) {
      const snapshot = await find(user.schoolId);
      return { ...snapshot, state: schoolStateForUser(snapshot.state, user) };
    },
    async command(user: SchoolUser, command: Command, revision: number) {
      const snapshot = await find(user.schoolId);
      if (snapshot.revision !== revision) throw new SchoolConflict();
      const authorized = authorizeSchoolCommand(snapshot.state, command, user);
      let state = applyCommand(snapshot.state, authorized);
      if (command.type === 'new-event')
        state = { ...state, people: snapshot.state.people };
      await update(user.schoolId, revision, state);
      return { state: schoolStateForUser(state, user), revision: revision + 1 };
    },
    async roster(user: SchoolUser): Promise<RosterMember[]> {
      await initialize();
      if (user.role !== 'admin')
        throw new DomainError('운영자만 명단을 볼 수 있어요.');
      const rows = await query(
        `SELECT id, login_id, name, password_hash IS NOT NULL AS active FROM nanum_private.accounts WHERE school_id = $1 AND role = 'student' ORDER BY login_id`,
        [user.schoolId],
      );
      return rows.map((row) => ({
        id: String(row.id),
        studentNumber: String(row.login_id),
        name: String(row.name),
        active: Boolean(row.active),
      }));
    },
    async importRoster(
      user: SchoolUser,
      entries: RosterEntry[],
    ): Promise<Invitation[]> {
      if (user.role !== 'admin')
        throw new DomainError('운영자만 명단을 등록할 수 있어요.');
      const snapshot = await find(user.schoolId);
      const existing = await this.roster(user);
      const newEntries = entries.filter(
        (entry) =>
          !existing.some((m) => m.studentNumber === entry.studentNumber),
      );
      if (existing.length + newEntries.length > 288)
        throw new DomainError('학생은 최대 288명까지 등록할 수 있어요.');
      if (
        entries.some((entry) =>
          existing.some(
            (m) =>
              m.studentNumber === entry.studentNumber && m.name !== entry.name,
          ),
        )
      )
        throw new DomainError(
          '이미 등록된 학번의 이름이 달라요. 기존 명단을 확인해 주세요.',
        );
      if (!newEntries.length) return [];
      const accounts = newEntries.map((entry) => ({
        ...entry,
        id: randomUUID(),
        code: secretToken(),
      }));
      const state = {
        ...snapshot.state,
        people: [
          ...snapshot.state.people,
          ...accounts.map((entry) => ({
            id: entry.id,
            studentNumber: entry.studentNumber,
            name: entry.name,
            zone: '본관' as const,
          })),
        ],
      };
      // One statement makes roster creation and workspace changes atomic in transaction pooling.
      const rows = await query(
        `WITH changed AS (
        UPDATE nanum_private.schools SET state = $1, revision = revision + 1 WHERE id = $2 AND revision = $3 RETURNING id
      ), added AS (
        INSERT INTO nanum_private.accounts (id, school_id, login_id, name, role, invite_hash, invite_expires)
        SELECT (a->>'id')::uuid, changed.id, a->>'studentNumber', a->>'name', 'student', a->>'hash', $4
        FROM changed CROSS JOIN jsonb_array_elements($5::jsonb) a RETURNING id
      ) SELECT id FROM added`,
        [
          JSON.stringify(state),
          user.schoolId,
          snapshot.revision,
          Date.now() + 2592000000,
          JSON.stringify(
            accounts.map((entry) => ({
              ...entry,
              code: undefined,
              hash: tokenHash(entry.code),
            })),
          ),
        ],
      );
      if (!rows.length) throw new SchoolConflict();
      return accounts.map(({ studentNumber, name, code }) => ({
        studentNumber,
        name,
        code,
      }));
    },
    async reissue(user: SchoolUser, accountId: string): Promise<Invitation> {
      if (user.role !== 'admin')
        throw new DomainError('운영자만 초대코드를 발급할 수 있어요.');
      await initialize();
      const code = secretToken();
      const [row] = await query(
        `WITH changed AS (
        UPDATE nanum_private.accounts SET password_hash = NULL, invite_hash = $1, invite_expires = $2, session_version = session_version + 1
        WHERE id = $3 AND school_id = $4 AND role = 'student' RETURNING id, login_id, name
      ), revoked AS (
        DELETE FROM nanum_private.school_sessions WHERE account_id IN (SELECT id FROM changed)
      ) SELECT login_id, name FROM changed`,
        [tokenHash(code), Date.now() + 2592000000, accountId, user.schoolId],
      );
      if (!row) throw new DomainError('학생을 찾을 수 없어요.');
      return {
        studentNumber: String(row.login_id),
        name: String(row.name),
        code,
      };
    },
  };
}
export type SchoolStore = ReturnType<typeof createSchoolStore>;
