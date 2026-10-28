import { DomainError, type State } from './domain.ts';

export const MANNER_NOTICE_VERSION = '2026-10-28-manners-v1';
export const MANNER_OPTIONS = [
  {
    value: 1,
    label: '좋았어요',
    description: '약속을 지키고 친절했어요',
    change: '+2점',
  },
  {
    value: 0,
    label: '보통이에요',
    description: '무난하게 나눔을 마쳤어요',
    change: '변동 없음',
  },
  {
    value: -1,
    label: '아쉬웠어요',
    description: '약속이나 소통이 아쉬웠어요',
    change: '−2점',
  },
] as const;
export type MannerSummary = { score: number; reviewCount: number };
export const mannerSummary = (total = 0, count = 0): MannerSummary => ({
  score: Math.max(0, Math.min(100, 50 + total * 2)),
  reviewCount: count,
});
export function mannerTarget(
  state: State,
  actorId: string,
  itemId: unknown,
): string {
  const match = state.matches.find(
    (m) => m.itemId === itemId && m.status === 'delivered',
  );
  const item = state.items.find((i) => i.id === itemId);
  if (!match || !item)
    throw new DomainError('전달이 완료된 나눔만 평가할 수 있어요.');
  if (item.ownerId === match.participantId)
    throw new DomainError('자기 자신은 평가할 수 없어요.');
  if (actorId === item.ownerId) return match.participantId;
  if (actorId === match.participantId) return item.ownerId;
  throw new DomainError('직접 나눔한 상대만 평가할 수 있어요.');
}
