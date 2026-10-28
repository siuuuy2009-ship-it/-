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
import {
  CONSENT_VERSION,
  requireConsent,
  type SignupConsent,
} from '../lib/consent.ts';
import { parseStudentNumber } from '../lib/domain.ts';
import {
  mannerSummary,
  mannerTarget,
  MANNER_NOTICE_VERSION,
} from '../lib/manners.ts';

type Account = SchoolUser & {
  passwordHash: string | null;
  sessionVersion: number;
  consentVersion: string | null;
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
      ALTER TABLE nanum_private.accounts ADD COLUMN IF NOT EXISTS consent_version TEXT;
      ALTER TABLE nanum_private.accounts ADD COLUMN IF NOT EXISTS consented_at BIGINT;
      CREATE TABLE IF NOT EXISTS nanum_private.signup_invitations (
        token_hash TEXT PRIMARY KEY, school_id UUID NOT NULL REFERENCES nanum_private.schools(id),
        expires BIGINT NOT NULL, used_at BIGINT, used_by UUID
      );
      CREATE TABLE IF NOT EXISTS nanum_private.manner_reviews (
        school_id UUID NOT NULL REFERENCES nanum_private.schools(id), item_id TEXT NOT NULL,
        rater_id UUID NOT NULL REFERENCES nanum_private.accounts(id), target_id UUID NOT NULL REFERENCES nanum_private.accounts(id),
        rating INTEGER NOT NULL CHECK (rating IN (-1, 0, 1)), notice_version TEXT NOT NULL, created_at BIGINT NOT NULL,
        PRIMARY KEY (school_id, item_id, rater_id), CHECK (rater_id <> target_id)
      );
      ALTER TABLE nanum_private.schools ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nanum_private.accounts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nanum_private.school_sessions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nanum_private.school_limits ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nanum_private.signup_invitations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nanum_private.manner_reviews ENABLE ROW LEVEL SECURITY;
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
    consentVersion: row.consent_version as string | null,
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
      ) INSERT INTO nanum_private.accounts (id, school_id, login_id, name, role, password_hash, consent_version, consented_at)
        SELECT $5, id, $6, $7, 'admin', $8, $9, $4 FROM school`,
        [
          schoolId,
          schoolCode,
          JSON.stringify(state),
          Date.now(),
          id,
          loginId,
          '운영자',
          passwordHash,
          CONSENT_VERSION,
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
        consentVersion: CONSENT_VERSION,
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
      consent: SignupConsent,
    ): Promise<Account | null> {
      requireConsent(consent.accepted, consent.version);
      await initialize();
      const [row] = await query(
        `WITH activated AS (
        UPDATE nanum_private.accounts SET password_hash = $1, invite_hash = NULL, invite_expires = NULL, session_version = session_version + 1,
          consent_version = $5, consented_at = $3
        WHERE invite_hash = $2 AND invite_expires > $3 AND login_id = $4 AND name = $6 RETURNING *
      ) SELECT a.*, s.code FROM activated a JOIN nanum_private.schools s ON s.id = a.school_id`,
        [
          passwordHash,
          tokenHash(code),
          Date.now(),
          loginId,
          consent.version,
          consent.name,
        ],
      );
      if (!row) return null;
      return account(row);
    },
    async issueInvitations(
      user: SchoolUser,
      count: number,
    ): Promise<{ code: string }[]> {
      if (user.role !== 'admin')
        throw new DomainError('운영자만 초대코드를 발급할 수 있어요.');
      if (!Number.isInteger(count) || count < 1 || count > 288)
        throw new DomainError('초대코드는 1~288개까지 발급할 수 있어요.');
      await initialize();
      const codes = Array.from({ length: count }, () => ({
        code: secretToken(),
      }));
      await query(
        `INSERT INTO nanum_private.signup_invitations (token_hash, school_id, expires)
        SELECT value, $1, $2 FROM jsonb_array_elements_text($3::jsonb)`,
        [
          user.schoolId,
          Date.now() + 2592000000,
          JSON.stringify(codes.map((entry) => tokenHash(entry.code))),
        ],
      );
      return codes;
    },
    async enroll(
      code: string,
      loginId: string,
      passwordHash: string,
      consent: SignupConsent,
    ): Promise<Account | null> {
      requireConsent(consent.accepted, consent.version);
      if (
        !parseStudentNumber(loginId) ||
        !consent.name.trim() ||
        consent.name.trim().length > 20
      )
        throw new DomainError('이름과 네 자리 학번을 확인해 주세요.');
      await initialize();
      const [invitation] = await query(
        'SELECT school_id FROM nanum_private.signup_invitations WHERE token_hash = $1 AND expires > $2 AND used_at IS NULL',
        [tokenHash(code), Date.now()],
      );
      if (!invitation)
        return this.activate(code, loginId, passwordHash, consent);
      const schoolId = String(invitation.school_id);
      const existing = await this.findAccount(
        (
          await query('SELECT code FROM nanum_private.schools WHERE id = $1', [
            schoolId,
          ])
        )[0].code as string,
        loginId,
      );
      if (existing)
        throw new DomainError(
          '이미 등록된 학번입니다. 로그인하거나 운영자에게 문의해 주세요.',
        );
      const snapshot = await find(schoolId);
      if (snapshot.state.people.length >= 288)
        throw new DomainError('이 학교는 등록 가능한 학생 수를 초과했어요.');
      const id = randomUUID();
      const now = Date.now();
      const name = consent.name.trim();
      const state: State = {
        ...snapshot.state,
        people: [
          ...snapshot.state.people,
          { id, name, studentNumber: loginId, zone: '본관' },
        ],
      };
      const [row] = await query(
        `WITH changed AS (
        UPDATE nanum_private.schools SET state = $1, revision = revision + 1
        WHERE id = $2 AND revision = $3
          AND EXISTS (SELECT 1 FROM nanum_private.signup_invitations WHERE token_hash = $4 AND school_id = $2 AND used_at IS NULL AND expires > $5)
          AND NOT EXISTS (SELECT 1 FROM nanum_private.accounts WHERE school_id = $2 AND login_id = $6)
        RETURNING id, code
      ), used AS (
        UPDATE nanum_private.signup_invitations SET used_at = $5, used_by = $7
        FROM changed WHERE token_hash = $4 AND school_id = changed.id AND used_at IS NULL RETURNING school_id
      ), added AS (
        INSERT INTO nanum_private.accounts (id, school_id, login_id, name, role, password_hash, consent_version, consented_at)
        SELECT $7, school_id, $6, $8, 'student', $9, $10, $5 FROM used RETURNING *
      ) SELECT a.*, c.code FROM added a JOIN changed c ON a.school_id = c.id`,
        [
          JSON.stringify(state),
          schoolId,
          snapshot.revision,
          tokenHash(code),
          now,
          loginId,
          id,
          name,
          passwordHash,
          consent.version,
        ],
      );
      if (!row) throw new SchoolConflict();
      return account(row);
    },
    async session(token: string): Promise<SchoolUser | null> {
      await initialize();
      const [row] = await query(
        `SELECT a.*, s.code FROM nanum_private.school_sessions t
        JOIN nanum_private.accounts a ON a.id = t.account_id JOIN nanum_private.schools s ON s.id = a.school_id
        WHERE t.token_hash = $1 AND t.expires > $2 AND t.session_version = a.session_version
        AND (a.role = 'admin' OR a.consent_version = $3)`,
        [tokenHash(token), Date.now(), CONSENT_VERSION],
      );
      if (!row) return null;
      const {
        passwordHash: _,
        sessionVersion: __,
        consentVersion: ___,
        ...user
      } = account(row);
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
      const totals = await query(
        'SELECT target_id, SUM(rating) AS total, COUNT(*) AS count FROM nanum_private.manner_reviews WHERE school_id = $1 GROUP BY target_id',
        [user.schoolId],
      );
      const own = await query(
        'SELECT item_id, rating FROM nanum_private.manner_reviews WHERE school_id = $1 AND rater_id = $2',
        [user.schoolId, user.id],
      );
      const state: State = {
        ...snapshot.state,
        people: snapshot.state.people.map((person) => {
          const total = totals.find((row) => row.target_id === person.id);
          return {
            ...person,
            manners: mannerSummary(
              Number(total?.total ?? 0),
              Number(total?.count ?? 0),
            ),
          };
        }),
      };
      return {
        ...snapshot,
        state: schoolStateForUser(state, user),
        mannerRatings: Object.fromEntries(
          own.map((row) => [String(row.item_id), Number(row.rating)]),
        ) as Record<string, number>,
      };
    },
    async command(user: SchoolUser, command: Command, revision: number) {
      const snapshot = await find(user.schoolId);
      if (snapshot.revision !== revision) throw new SchoolConflict();
      if (command.type === 'rate-manners') {
        if (user.role !== 'student')
          throw new DomainError('직접 나눔에 참여한 학생만 평가할 수 있어요.');
        if (
          command.reviewConsent !== true ||
          command.noticeVersion !== MANNER_NOTICE_VERSION
        )
          throw new DomainError('매너 평가 저장 안내를 확인해 주세요.');
        if (![1, 0, -1].includes(command.rating as number))
          throw new DomainError('매너 평가를 선택해 주세요.');
        const target = mannerTarget(snapshot.state, user.id, command.itemId);
        const existing = await query(
          'SELECT rating FROM nanum_private.manner_reviews WHERE school_id = $1 AND item_id = $2 AND rater_id = $3',
          [user.schoolId, command.itemId, user.id],
        );
        if (existing.length)
          throw new DomainError('이 나눔은 이미 평가했어요.');
        const rows = await query(
          `WITH changed AS (
          UPDATE nanum_private.schools SET revision = revision + 1 WHERE id = $1 AND revision = $2
          AND NOT EXISTS (SELECT 1 FROM nanum_private.manner_reviews WHERE school_id = $1 AND item_id = $3 AND rater_id = $4) RETURNING id
        ) INSERT INTO nanum_private.manner_reviews (school_id, item_id, rater_id, target_id, rating, notice_version, created_at)
          SELECT id, $3, $4, $5, $6, $7, $8 FROM changed RETURNING item_id`,
          [
            user.schoolId,
            revision,
            command.itemId,
            user.id,
            target,
            command.rating,
            MANNER_NOTICE_VERSION,
            Date.now(),
          ],
        );
        if (!rows.length) throw new SchoolConflict();
        return this.snapshot(user);
      }
      const authorized = authorizeSchoolCommand(snapshot.state, command, user);
      let state = applyCommand(snapshot.state, authorized);
      if (command.type === 'new-event')
        state = { ...state, people: snapshot.state.people };
      await update(user.schoolId, revision, state);
      return this.snapshot(user);
    },
    async roster(user: SchoolUser): Promise<RosterMember[]> {
      await initialize();
      if (user.role !== 'admin')
        throw new DomainError('운영자만 명단을 볼 수 있어요.');
      const rows = await query(
        `SELECT id, login_id, name, password_hash IS NOT NULL AS active, consented_at FROM nanum_private.accounts WHERE school_id = $1 AND role = 'student' ORDER BY login_id`,
        [user.schoolId],
      );
      return rows.map((row) => ({
        id: String(row.id),
        studentNumber: String(row.login_id),
        name: String(row.name),
        active: Boolean(row.active),
        consentedAt: row.consented_at ? Number(row.consented_at) : null,
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
    async withdraw(user: SchoolUser) {
      if (user.role !== 'student')
        throw new DomainError('학생 계정에서 사용할 수 있어요.');
      const snapshot = await find(user.schoolId);
      const removedItems = new Set(
        snapshot.state.items
          .filter((i) => i.ownerId === user.id)
          .map((i) => i.id),
      );
      const state: State = {
        ...snapshot.state,
        people: snapshot.state.people.filter((p) => p.id !== user.id),
        items: snapshot.state.items.filter((i) => !removedItems.has(i.id)),
        applications: snapshot.state.applications
          .filter((a) => a.participantId !== user.id)
          .map((a) => ({
            ...a,
            itemIds: a.itemIds.filter((id) => !removedItems.has(id)),
          }))
          .filter((a) => a.itemIds.length),
        matches: snapshot.state.matches.filter(
          (m) => m.participantId !== user.id && !removedItems.has(m.itemId),
        ),
      };
      const rows = await query(
        `WITH changed AS (
        UPDATE nanum_private.schools SET state = $1, revision = revision + 1 WHERE id = $2 AND revision = $3 RETURNING id
      ), sessions AS (
        DELETE FROM nanum_private.school_sessions WHERE account_id = $4 AND EXISTS (SELECT 1 FROM changed)
      ), invitations AS (
        DELETE FROM nanum_private.signup_invitations WHERE used_by = $4 AND EXISTS (SELECT 1 FROM changed)
      ), reviews AS (
        DELETE FROM nanum_private.manner_reviews WHERE (rater_id = $4 OR target_id = $4) AND EXISTS (SELECT 1 FROM changed)
      ) DELETE FROM nanum_private.accounts WHERE id = $4 AND school_id IN (SELECT id FROM changed) AND role = 'student' RETURNING id`,
        [JSON.stringify(state), user.schoolId, snapshot.revision, user.id],
      );
      if (!rows.length) throw new SchoolConflict();
    },
  };
}
export type SchoolStore = ReturnType<typeof createSchoolStore>;
