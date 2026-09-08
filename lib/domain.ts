import { maximumMatching, sequentialMatching, type Edge } from './matching.ts';

export const CATEGORIES = [
  '도서·참고서',
  '교복·의류',
  '학용품',
  '생활용품',
] as const;
export const ZONES = ['본관', '후관', '기숙사'] as const;
export const CONDITIONS = ['사용감 있음', '상태 좋음', '거의 새것'] as const;
export type Zone = (typeof ZONES)[number];
export type Person = { id: string; name: string; zone: Zone };
export type Item = {
  id: string;
  title: string;
  ownerId: string;
  category: (typeof CATEGORIES)[number];
  condition: number;
  zone: Zone;
  description: string;
};
export type Application = {
  participantId: string;
  itemIds: string[];
  minCondition: number;
  maxDistance: number;
};
export type Pair = Edge & { status: 'confirmed' | 'delivered' };
export type State = {
  title: string;
  round: number;
  isDemo: boolean;
  phase: 'open' | 'closed';
  people: Person[];
  items: Item[];
  applications: Application[];
  matches: Pair[];
};
export type Command = { type: string; [key: string]: unknown };
export class DomainError extends Error {}

export function distance(a: Zone, b: Zone): number {
  const meters = [
    [0, 200, 500],
    [200, 0, 400],
    [500, 400, 0],
  ];
  return meters[ZONES.indexOf(a)]?.[ZONES.indexOf(b)] ?? Infinity;
}
export function emptyState(round = 1, title = '우리 학교 나눔 행사'): State {
  return {
    title,
    round,
    isDemo: false,
    phase: 'open',
    people: [],
    items: [],
    applications: [],
    matches: [],
  };
}
export function demoState(): State {
  const people: Person[] = [
    '민수',
    '지수',
    '하은',
    '도윤',
    '서연',
    '준호',
    '나눔부',
  ].map((name, i) => ({ id: `p${i + 1}`, name, zone: '본관' }));
  const titles = [
    '수학 개념 참고서 A',
    '수학 유형 참고서 B',
    '깨끗한 하복 셔츠',
    '접이식 독서대',
    '과학 실험 길잡이',
    '튼튼한 실내화',
  ];
  const categories = [0, 0, 1, 2, 0, 3];
  const items: Item[] = titles.map((title, i) => ({
    id: `i${i + 1}`,
    title,
    ownerId: 'p7',
    category: CATEGORIES[categories[i]],
    condition: (i % 2) + 2,
    zone: '본관',
    description: [
      '필기 없이 깨끗해요. 개념 공부에 도움이 되었으면 좋겠어요.',
      '문제 풀이 연습용이에요. 앞부분에 연필 필기가 조금 있어요.',
      '하복 셔츠 95 사이즈입니다. 세탁을 마쳤어요.',
      '각도 조절이 가능하고 접어서 보관할 수 있어요.',
      '중등 과학 탐구 활동을 정리한 책이에요.',
      '250mm 실내화예요. 사이즈를 확인해 주세요.',
    ][i],
  }));
  const choices = [
    ['i1', 'i2'],
    ['i1'],
    ['i3', 'i4'],
    ['i3'],
    ['i5', 'i6'],
    ['i5'],
  ];
  return {
    ...emptyState(1, '학기 말 함께 나눔'),
    isDemo: true,
    people,
    items,
    applications: choices.map((itemIds, i) => ({
      participantId: `p${i + 1}`,
      itemIds,
      minCondition: 1,
      maxDistance: 500,
    })),
  };
}
export function eligibleEdges(state: State): Edge[] {
  const lockedItems = new Set(state.matches.map((p) => p.itemId));
  const lockedPeople = new Set(state.matches.map((p) => p.participantId));
  const edges: Edge[] = [];
  for (const item of state.items) {
    if (lockedItems.has(item.id)) continue;
    for (const request of state.applications) {
      const person = state.people.find((p) => p.id === request.participantId);
      if (!person || lockedPeople.has(person.id) || person.id === item.ownerId)
        continue;
      if (
        request.itemIds.includes(item.id) &&
        item.condition >= request.minCondition &&
        distance(person.zone, item.zone) <= request.maxDistance
      ) {
        edges.push({ itemId: item.id, participantId: person.id });
      }
    }
  }
  return edges;
}
export function compareMatching(state: State) {
  const edges = eligibleEdges(state);
  const locked = new Set(state.matches.map((p) => p.itemId));
  const itemIds = state.items.filter((i) => !locked.has(i.id)).map((i) => i.id);
  return {
    edges,
    maximum: maximumMatching(itemIds, edges),
    sequential: sequentialMatching(itemIds, edges),
  };
}
function text(value: unknown, label: string, max = 50): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new DomainError(`${label}: 1~${max}자로 입력해 주세요.`);
  return value.trim();
}
function choice<T extends string>(
  value: unknown,
  options: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !options.includes(value as T))
    throw new DomainError(`${label}을 확인해 주세요.`);
  return value as T;
}
function number(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new DomainError(`${label}을 확인해 주세요.`);
  return value;
}

/** Pure command handler: identical invariants in local and hosted environments. */
export function applyCommand(
  original: State,
  cmd: Command,
  id: () => string = () => crypto.randomUUID(),
): State {
  const state = structuredClone(original);
  const open = () => {
    if (state.phase !== 'open')
      throw new DomainError('신청이 마감되었습니다. 접수를 다시 열어 주세요.');
  };
  switch (cmd.type) {
    case 'add-person': {
      open();
      if (state.people.length >= 80)
        throw new DomainError('한 행사에는 최대 80명까지 등록할 수 있어요.');
      const name = text(cmd.name, '참여자 이름', 20);
      if (
        state.people.some(
          (p) => p.name.normalize('NFC') === name.normalize('NFC'),
        )
      )
        throw new DomainError(
          '이미 등록된 이름입니다. 동명이인은 구분 이름을 붙여 주세요.',
        );
      state.people.push({
        id: id(),
        name,
        zone: choice(cmd.zone, ZONES, '활동 구역'),
      });
      break;
    }
    case 'add-item': {
      open();
      if (state.items.length >= 80)
        throw new DomainError('한 행사에는 최대 80개까지 등록할 수 있어요.');
      const ownerId = text(cmd.ownerId, '나눔자');
      if (!state.people.some((p) => p.id === ownerId))
        throw new DomainError('나눔자를 먼저 등록해 주세요.');
      const description =
        typeof cmd.description === 'string' ? cmd.description.trim() : '';
      if (description.length > 500)
        throw new DomainError('물품 설명은 500자 이내로 입력해 주세요.');
      state.items.push({
        id: id(),
        title: text(cmd.title, '물품 이름', 60),
        ownerId,
        category: choice(cmd.category, CATEGORIES, '종류'),
        condition: number(cmd.condition, 1, 3, '물품 상태'),
        zone: choice(cmd.zone, ZONES, '수령 구역'),
        description,
      });
      break;
    }
    case 'delete-item': {
      open();
      const itemId = text(cmd.itemId, '물품');
      if (state.matches.some((p) => p.itemId === itemId))
        throw new DomainError('확정된 물품은 삭제할 수 없어요.');
      if (!state.items.some((i) => i.id === itemId))
        throw new DomainError('물품을 찾을 수 없어요.');
      state.items = state.items.filter((i) => i.id !== itemId);
      state.applications = state.applications
        .map((a) => ({ ...a, itemIds: a.itemIds.filter((i) => i !== itemId) }))
        .filter((a) => a.itemIds.length);
      break;
    }
    case 'apply': {
      open();
      const participantId = text(cmd.participantId, '신청자');
      if (!state.people.some((p) => p.id === participantId))
        throw new DomainError('신청자를 먼저 등록해 주세요.');
      if (
        !Array.isArray(cmd.itemIds) ||
        cmd.itemIds.length > 80 ||
        cmd.itemIds.some((x) => typeof x !== 'string')
      )
        throw new DomainError('신청 물품을 확인해 주세요.');
      const itemIds = [...new Set(cmd.itemIds)] as string[];
      if (
        itemIds.some(
          (key) =>
            !state.items.some(
              (i) => i.id === key && i.ownerId !== participantId,
            ),
        )
      )
        throw new DomainError(
          '자신의 물품이나 삭제된 물품에는 신청할 수 없어요.',
        );
      const minCondition = number(cmd.minCondition, 1, 3, '최소 상태');
      const maxDistance = number(cmd.maxDistance, 0, 500, '최대 이동 거리');
      const existing = state.applications.findIndex(
        (a) => a.participantId === participantId,
      );
      const application = { participantId, itemIds, minCondition, maxDistance };
      if (existing !== -1)
        state.applications.splice(
          existing,
          1,
          ...(itemIds.length ? [application] : []),
        );
      else if (itemIds.length) state.applications.push(application);
      break;
    }
    case 'close':
      open();
      state.phase = 'closed';
      break;
    case 'reopen':
      if (state.matches.length)
        throw new DomainError(
          '확정된 배정이 있어요. 전달 전 배정을 취소한 뒤 다시 열 수 있습니다.',
        );
      state.phase = 'open';
      break;
    case 'confirm': {
      if (state.phase !== 'closed')
        throw new DomainError('신청을 마감한 뒤 배정을 확정해 주세요.');
      const { maximum } = compareMatching(state);
      if (!maximum.pairs.length)
        throw new DomainError('새로 배정할 수 있는 신청이 없어요.');
      state.matches.push(
        ...maximum.pairs.map((p) => ({ ...p, status: 'confirmed' as const })),
      );
      break;
    }
    case 'deliver': {
      const match = state.matches.find((p) => p.itemId === cmd.itemId);
      if (!match || match.status !== 'confirmed')
        throw new DomainError('전달 대기 중인 배정만 완료할 수 있어요.');
      match.status = 'delivered';
      break;
    }
    case 'cancel-match': {
      const match = state.matches.find((p) => p.itemId === cmd.itemId);
      if (!match || match.status === 'delivered')
        throw new DomainError('전달이 끝난 물품은 취소할 수 없어요.');
      state.matches = state.matches.filter((p) => p.itemId !== cmd.itemId);
      // Remove the declined edge so the next run does not reassign the same pair.
      state.applications = state.applications
        .map((a) =>
          a.participantId === match.participantId
            ? { ...a, itemIds: a.itemIds.filter((i) => i !== match.itemId) }
            : a,
        )
        .filter((a) => a.itemIds.length);
      break;
    }
    case 'new-event':
      return emptyState(1, text(cmd.title, '행사 이름', 50));
    case 'load-demo':
      return demoState();
    default:
      throw new DomainError('지원하지 않는 작업입니다.');
  }
  return state;
}
