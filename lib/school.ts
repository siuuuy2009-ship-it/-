import {
  DomainError,
  parseStudentNumber,
  type State,
  type Command,
} from './domain.ts';

export type SchoolUser = {
  id: string;
  schoolId: string;
  schoolCode: string;
  loginId: string;
  name: string;
  role: 'admin' | 'student';
};
export type RosterEntry = { studentNumber: string; name: string };
export type RosterMember = RosterEntry & {
  id: string;
  active: boolean;
  consentedAt?: number | null;
};
export type Invitation = RosterEntry & { code: string };

export function parseRoster(value: unknown): RosterEntry[] {
  if (typeof value !== 'string' || value.length > 30000)
    throw new DomainError('학번과 이름이 있는 명단을 입력해 주세요.');
  const rows = value
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (/^학번[\s,\t]+이름$/.test(rows[0] ?? '')) rows.shift();
  if (!rows.length || rows.length > 288)
    throw new DomainError('명단은 1~288명까지 등록할 수 있어요.');
  const seen = new Set<string>();
  return rows.map((row, i) => {
    const match = /^(\d{4})[\s,\t]+(.+)$/.exec(row);
    const student = parseStudentNumber(match?.[1]);
    const name = match?.[2].trim();
    if (
      !student ||
      !name ||
      name.length > 20 ||
      name.includes(',') ||
      Array.from(name).some((char) => char.charCodeAt(0) < 32)
    )
      throw new DomainError(`${i + 1}번째 줄의 학번과 이름을 확인해 주세요.`);
    if (seen.has(student.studentNumber))
      throw new DomainError(
        `명단에 ${student.studentNumber} 학번이 중복되어 있어요.`,
      );
    seen.add(student.studentNumber);
    return { studentNumber: student.studentNumber, name };
  });
}

export function authorizeSchoolCommand(
  state: State,
  command: Command,
  user: SchoolUser,
): Command {
  if (command.type === 'add-person' || command.type === 'load-demo')
    throw new DomainError('학생은 명단 관리에서 등록해 주세요.');
  if (user.role === 'admin') return command;
  if (command.type === 'add-item') return { ...command, ownerId: user.id };
  if (command.type === 'apply') return { ...command, participantId: user.id };
  if (
    command.type === 'delete-item' &&
    state.items.some((i) => i.id === command.itemId && i.ownerId === user.id)
  )
    return command;
  throw new DomainError('이 작업은 운영자만 할 수 있어요.');
}

export function schoolStateForUser(state: State, user: SchoolUser): State {
  if (user.role === 'admin') return state;
  const visible = new Set([user.id]);
  for (const match of state.matches) {
    const owner = state.items.find((i) => i.id === match.itemId)?.ownerId;
    if (owner && (owner === user.id || match.participantId === user.id)) {
      visible.add(owner);
      visible.add(match.participantId);
    }
  }
  return {
    ...state,
    people: state.people.map((person, i) =>
      visible.has(person.id)
        ? person
        : {
            id: person.id,
            name: `학생 ${i + 1}`,
            zone: person.zone,
            ...(person.manners ? { manners: person.manners } : {}),
          },
    ),
  };
}
