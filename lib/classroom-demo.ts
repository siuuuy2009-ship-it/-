import {
  applyCommand,
  demoState,
  DomainError,
  type Command,
  type State,
} from './domain.ts';
import { authorizeSchoolCommand, type SchoolUser } from './school.ts';
import {
  mannerSummary,
  mannerTarget,
  MANNER_NOTICE_VERSION,
} from './manners.ts';
import type { WorkspaceClient, WorkspaceSnapshot } from './workspace-client.ts';

export type DemoStage = 'open' | 'confirmed' | 'delivered';
export const DEMO_STAGES: {
  value: DemoStage;
  label: string;
  description: string;
}[] = [
  {
    value: 'open',
    label: '1. 신청 접수',
    description:
      '6명의 물품과 신청을 살펴보고 순차 배정 3명과 최대 매칭 6명을 비교해 보세요.',
  },
  {
    value: 'confirmed',
    label: '2. 배정 확정',
    description:
      '6건의 배정을 확정한 장면입니다. 학생 화면에서 본인과 연결된 상대를 확인해 보세요.',
  },
  {
    value: 'delivered',
    label: '3. 전달·매너 평가',
    description:
      '전달을 마친 장면입니다. 학생으로 전환해 자동 매칭 탭에서 상대 평가를 남겨 보세요.',
  },
];

export class ClassroomDemo {
  private state: State;
  private revision = 0;
  private reviews: {
    itemId: string;
    rater: string;
    target: string;
    rating: number;
  }[] = [];
  readonly users: SchoolUser[];

  constructor(stage: DemoStage = 'open') {
    this.state = demoState();
    this.state.title = '함께 나누는 학교 · 가상 시연';
    this.state.people = this.state.people
      .slice(0, 6)
      .map((p) => ({ ...p, name: `가상 ${p.name}` }));
    // Every example item belongs to a student, without excluding a desired edge.
    const owners = ['p3', 'p3', 'p5', 'p1', 'p2', 'p4'];
    this.state.items = this.state.items.map((item, i) => ({
      ...item,
      ownerId: owners[i],
    }));
    const common = { schoolId: 'classroom-demo', schoolCode: 'DEMO' };
    this.users = [
      {
        ...common,
        id: 'demo-admin',
        name: '가상 운영자',
        loginId: 'demo-admin',
        role: 'admin',
      },
      ...this.state.people.map((p) => ({
        ...common,
        id: p.id,
        name: p.name,
        loginId: p.studentNumber!,
        role: 'student' as const,
      })),
    ];
    if (stage !== 'open') {
      this.state = applyCommand(this.state, { type: 'close' });
      this.state = applyCommand(this.state, { type: 'confirm' });
    }
    if (stage === 'delivered') {
      for (const match of this.state.matches)
        this.state = applyCommand(this.state, {
          type: 'deliver',
          itemId: match.itemId,
        });
    }
  }

  snapshot(user: SchoolUser): WorkspaceSnapshot {
    this.checkUser(user);
    const state = structuredClone(this.state);
    // The six names are explicitly fictional and can all appear in report captures.
    state.people = state.people.map((p) => {
      const reviews = this.reviews.filter((r) => r.target === p.id);
      return {
        ...p,
        manners: mannerSummary(
          reviews.reduce((sum, r) => sum + r.rating, 0),
          reviews.length,
        ),
      };
    });
    return {
      state,
      revision: this.revision,
      mannerRatings: Object.fromEntries(
        this.reviews
          .filter((r) => r.rater === user.id)
          .map((r) => [r.itemId, r.rating]),
      ),
    };
  }

  command(
    user: SchoolUser,
    command: Command,
    revision: number,
  ): WorkspaceSnapshot {
    this.checkUser(user);
    if (revision !== this.revision)
      throw new DomainError(
        '시연 자료가 바뀌었어요. 다시 불러온 뒤 시도해 주세요.',
      );
    if (command.type === 'rate-manners') {
      if (user.role !== 'student')
        throw new DomainError('학생 화면에서 평가해 주세요.');
      if (
        command.reviewConsent !== true ||
        command.noticeVersion !== MANNER_NOTICE_VERSION
      )
        throw new DomainError('평가 저장 안내를 확인해 주세요.');
      if (![1, 0, -1].includes(command.rating as number))
        throw new DomainError('평가를 선택해 주세요.');
      const target = mannerTarget(this.state, user.id, command.itemId);
      if (
        this.reviews.some(
          (r) => r.rater === user.id && r.itemId === command.itemId,
        )
      )
        throw new DomainError('이미 평가한 나눔이에요.');
      this.reviews.push({
        itemId: command.itemId as string,
        rater: user.id,
        target,
        rating: command.rating as number,
      });
    } else {
      const next = applyCommand(
        this.state,
        authorizeSchoolCommand(this.state, command, user),
      );
      // A new event keeps demo identities available, as in the real school workspace.
      if (command.type === 'new-event') next.people = this.state.people;
      next.isDemo = true;
      this.state = next;
    }
    this.revision++;
    return this.snapshot(user);
  }

  client(user: SchoolUser): WorkspaceClient {
    return {
      load: async () => this.snapshot(user),
      save: async (command, revision) => this.command(user, command, revision),
    };
  }

  private checkUser(user: SchoolUser) {
    if (!this.users.some((p) => p.id === user.id && p.role === user.role))
      throw new DomainError('가상 학생을 다시 선택해 주세요.');
  }
}
