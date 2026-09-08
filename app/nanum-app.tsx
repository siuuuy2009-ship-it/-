'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Boxes,
  Check,
  CheckCheck,
  Coffee,
  Download,
  Info,
  LoaderCircle,
  MapPin,
  Network,
  PencilRuler,
  Plus,
  Recycle,
  RefreshCw,
  Search,
  Shirt,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  CATEGORIES,
  CONDITIONS,
  ZONES,
  compareMatching,
  distance,
  emptyState,
  type Command,
  type State,
  type Item,
} from '@/lib/domain';
import { maximumMatching, sequentialMatching, type Edge } from '@/lib/matching';

type Snapshot = { state: State; revision: number };
type Confirm = { title: string; description: string; command: Command };
type Modal = 'item' | 'person' | 'request' | 'detail' | 'event' | null;
const categoryIcons = [BookOpen, Shirt, PencilRuler, Coffee];
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <Select
        value={value}
        onValueChange={(v) => onChange(v ?? '')}
        items={options}
      >
        <SelectTrigger className="form-select" aria-label={label}>
          <SelectValue placeholder="선택해 주세요" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
const opts = (values: readonly string[]) =>
  values.map((value) => ({ value, label: value }));

export default function NanumApp() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    state: emptyState(),
    revision: 0,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('items');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('전체');
  const [modal, setModal] = useState<Modal>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const current = useRef(snapshot);
  const mutation = useRef(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store' });
      const data = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw new Error(data.error);
      setSnapshot(data);
      current.current = data;
    } catch (e) {
      setError(e instanceof Error ? e.message : '자료를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  const act = useCallback(
    async (command: Command, message = '저장했습니다.') => {
      if (mutation.current)
        throw new Error('이전 작업이 끝날 때까지 기다려 주세요.');
      mutation.current = true;
      setBusy(true);
      setError('');
      setFormError('');
      setNotice('');
      try {
        const response = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: current.current.revision, command }),
        });
        const data = (await response.json()) as Snapshot & { error?: string };
        if (!response.ok) {
          if (response.status === 409) {
            setConfirm(null);
            setModal(null);
            await load();
          }
          throw new Error(data.error || '저장하지 못했어요.');
        }
        current.current = data;
        setSnapshot(data);
        setNotice(message);
        return data as Snapshot;
      } catch (e) {
        const message = e instanceof Error ? e.message : '저장하지 못했어요.';
        setError(message);
        setFormError(message);
        throw e;
      } finally {
        mutation.current = false;
        setBusy(false);
      }
    },
    [load],
  );
  const perform = (command: Command, message?: string) => {
    void act(command, message).catch(() => {});
  };
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      {
        name: 'get_nanum_workspace',
        description: '현재 행사, 물품, 참여자, 신청과 확정 배정을 읽습니다.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => current.current,
      },
      {
        name: 'preview_maximum_matching',
        description:
          '최대 이분 매칭과 순차 배정의 현재 결과를 계산하고 자동 매칭 화면을 엽니다. 배정은 확정하지 않습니다.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input: unknown) => {
          if (!input || typeof input !== 'object' || Object.keys(input).length)
            throw new Error('빈 객체를 입력해 주세요.');
          setTab('matching');
          return compareMatching(current.current.state);
        },
      },
      {
        name: 'save_nanum_application',
        description:
          '기존 참여자의 신청을 교체합니다. itemIds가 빈 배열이면 신청을 취소합니다. 접수 중에만 가능합니다.',
        inputSchema: {
          type: 'object',
          properties: {
            participantId: { type: 'string' },
            itemIds: { type: 'array', items: { type: 'string' }, maxItems: 80 },
            minCondition: { type: 'integer', minimum: 1, maximum: 3 },
            maxDistance: { type: 'integer', minimum: 0, maximum: 500 },
          },
          required: ['participantId', 'itemIds', 'minCondition', 'maxDistance'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: async (input: unknown) => {
          if (!input || typeof input !== 'object' || Array.isArray(input))
            throw new Error('신청 정보를 입력해 주세요.');
          const result = await act({ ...input, type: 'apply' });
          setTab('requests');
          return {
            revision: result.revision,
            applications: result.state.applications,
          };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Optional browser API. */
      }
    }
    return () => lifecycle.abort();
  }, [act]);

  const state = snapshot.state;
  const comparison = useMemo(() => compareMatching(state), [state]);
  const personName = (id: string) =>
    state.people.find((p) => p.id === id)?.name ?? '알 수 없음';
  const itemName = (id: string) =>
    state.items.find((i) => i.id === id)?.title ?? '삭제된 물품';
  const filtered = state.items.filter(
    (i) =>
      (filter === '전체' || i.category === filter) &&
      `${i.title} ${i.description} ${personName(i.ownerId)}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const maxCount = comparison.maximum.pairs.length + state.matches.length;
  const open = state.phase === 'open';
  const isDisabled = busy || loading;
  const values = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  function choosePerson(id: string) {
    const existing = state.applications.find((a) => a.participantId === id);
    setForm((f) => ({
      ...f,
      participantId: id,
      minCondition: String(existing?.minCondition ?? 1),
      maxDistance: String(existing?.maxDistance ?? 500),
    }));
    setSelected(existing?.itemIds ?? []);
  }
  function show(kind: Modal, item?: Item, participantId?: string) {
    setFormError('');
    setSelected([]);
    setForm({
      zone: ZONES[0],
      category: CATEGORIES[0],
      condition: '2',
      minCondition: '1',
      maxDistance: '500',
      ownerId: state.people[0]?.id ?? '',
      participantId: participantId ?? state.people[0]?.id ?? '',
      title: '새 학기 나눔 행사',
    });
    if (kind === 'request') {
      const id = participantId ?? state.people[0]?.id ?? '';
      const existing = state.applications.find((a) => a.participantId === id);
      setForm((f) => ({
        ...f,
        minCondition: String(existing?.minCondition ?? 1),
        maxDistance: String(existing?.maxDistance ?? 500),
      }));
      setSelected(existing?.itemIds ?? []);
    }
    if (kind === 'item') setForm((f) => ({ ...f, title: '' }));
    if (item) setDetail(item);
    setModal(kind);
  }
  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    let command: Command;
    if (modal === 'person')
      command = { type: 'add-person', name: form.name, zone: form.zone };
    else if (modal === 'item')
      command = {
        ...form,
        type: 'add-item',
        condition: Number(form.condition),
      };
    else if (modal === 'request')
      command = {
        type: 'apply',
        participantId: form.participantId,
        itemIds: selected,
        minCondition: Number(form.minCondition),
        maxDistance: Number(form.maxDistance),
      };
    else if (modal === 'event') {
      setModal(null);
      setConfirm({
        title: '새 행사를 시작할까요?',
        description:
          '현재 화면의 물품, 참여자, 신청과 배정이 비워집니다. 필요한 배정 결과는 먼저 내려받아 주세요.',
        command: { type: 'new-event', title: form.title },
      });
      return;
    } else return;
    try {
      await act(command);
      setModal(null);
    } catch {
      /* Keep the form and its input. */
    }
  }
  function exportResults() {
    const rows = [
      ['물품', '나눔자', '신청자', '수령 구역', '상태'],
      ...state.matches.map((m) => {
        const item = state.items.find((i) => i.id === m.itemId)!;
        return [
          item.title,
          personName(item.ownerId),
          personName(m.participantId),
          item.zone,
          m.status === 'delivered' ? '전달 완료' : '배정 확정',
        ];
      }),
    ];
    const cell = (s: string) =>
      '"' + (/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
    const url = URL.createObjectURL(
      new Blob(
        ['\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n')],
        { type: 'text/csv;charset=utf-8' },
      ),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = '다시나눔-배정결과.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const empty = (title: string, description: string) => (
    <div className="empty-state">
      <Boxes size={32} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );

  return (
    <>
      <header className="site-header">
        <button type="button" className="brand" onClick={() => setTab('items')}>
          <span className="brand-mark">
            <Recycle />
          </span>
          다시, 나눔<span className="brand-dot">.</span>
        </button>
        <span className="header-label">우리 학교 자원 순환 프로젝트</span>
        <span className="mode-badge">학교 나눔 · 운영자</span>
      </header>
      <main className="workspace" aria-busy={isDisabled}>
        <div className="page-heading">
          <div>
            <div className="eyebrow">SCHOOL SHARING CLUB</div>
            <h1>우리 학교 나눔함</h1>
            <p>쓰임이 남은 물건, 다음 주인을 만나도록.</p>
          </div>
          <Button
            className="action-button"
            onClick={() => show(state.people.length ? 'item' : 'person')}
            disabled={isDisabled || !open}
          >
            <Plus size={18} />
            {state.people.length ? '물품 등록' : '참여자 등록'}
          </Button>
        </div>
        {error && (
          <div className="message error" role="alert">
            <Info size={18} />
            <span>{error}</span>
            <Button
              variant="ghost"
              onClick={() => void load()}
              disabled={isDisabled}
            >
              다시 불러오기
            </Button>
          </div>
        )}
        {notice && (
          <output className="message success">
            <Check size={18} />
            {notice}
            <button aria-label="알림 닫기" onClick={() => setNotice('')}>
              <X size={17} />
            </button>
          </output>
        )}
        {loading ? (
          <output className="loading-state">
            <LoaderCircle className="spin" /> 나눔함을 불러오는 중입니다.
          </output>
        ) : (
          <>
            <div className="summary-grid">
              <div className="summary">
                <span>등록된 물품</span>
                <strong>
                  {state.items.length} <small>개</small>
                </strong>
                <Boxes />
              </div>
              <div className="summary">
                <span>나눔 신청자</span>
                <strong>
                  {state.applications.length} <small>명</small>
                </strong>
                <Users />
              </div>
              <div className="summary accent">
                <span>현재 조건으로 배정 가능</span>
                <strong>
                  {maxCount} <small>명</small>
                </strong>
                <Sparkles />
              </div>
            </div>
            <div className="event-bar">
              <span>
                <span className={'status-dot ' + (open ? '' : 'closed')} />
                <strong>{state.title}</strong> · {state.round}회차{' '}
                <span className="event-status">
                  {open ? '신청 접수 중' : '신청 마감'}
                </span>
              </span>
              <div>
                <span className="demo-label">
                  {state.isDemo ? '예시 자료' : '내 행사'}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => show('event')}
                  disabled={isDisabled}
                >
                  새 행사
                </Button>
              </div>
            </div>
            {state.isDemo && (
              <p className="demo-note">
                가상 학생과 물품으로 시작하는 시연입니다. 실제 자료는 ‘새
                행사’에서 등록해 주세요.
              </p>
            )}
            <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
              <TabsList className="main-tabs" variant="line">
                <TabsTrigger value="items">나눔 물품</TabsTrigger>
                <TabsTrigger value="requests">참여자·신청</TabsTrigger>
                <TabsTrigger value="matching">자동 매칭</TabsTrigger>
                <TabsTrigger value="about">알고리즘 이야기</TabsTrigger>
              </TabsList>
              <TabsContent value="items">
                <div className="content-grid">
                  <section>
                    <div className="section-top">
                      <h2>
                        새로운 쓰임을 기다려요 <span>{state.items.length}</span>
                      </h2>
                    </div>
                    <div className="filters">
                      <label className="search-field">
                        <Search size={18} />
                        <input
                          aria-label="물품 검색"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="물품 이름, 설명, 나눔자 검색"
                        />
                      </label>
                      <Choice
                        label="물품 종류"
                        value={filter}
                        options={opts(['전체', ...CATEGORIES])}
                        onChange={setFilter}
                      />
                    </div>
                    <div className="item-grid">
                      {filtered.map((item) => {
                        const index = CATEGORIES.indexOf(item.category);
                        const Icon = categoryIcons[index];
                        const match = state.matches.find(
                          (m) => m.itemId === item.id,
                        );
                        const applicants = state.applications.filter((a) =>
                          a.itemIds.includes(item.id),
                        ).length;
                        return (
                          <article className="item-card" key={item.id}>
                            <button
                              className="item-open"
                              onClick={() => show('detail', item)}
                              aria-label={`${item.title} 상세 보기`}
                            >
                              <div className={'item-symbol color-' + index}>
                                <Icon size={37} />
                                <span>
                                  {match
                                    ? match.status === 'delivered'
                                      ? '전달 완료'
                                      : '배정 확정'
                                    : '나눔 가능'}
                                </span>
                              </div>
                              <div className="item-body">
                                <span className="category">
                                  {item.category}
                                </span>
                                <h3>{item.title}</h3>
                                <p>
                                  {CONDITIONS[item.condition - 1]} · {item.zone}
                                </p>
                                <div className="item-bottom">
                                  <span>{personName(item.ownerId)}</span>
                                  <span>
                                    신청 {applicants}명{' '}
                                    <ArrowUpRight size={15} />
                                  </span>
                                </div>
                              </div>
                            </button>
                          </article>
                        );
                      })}
                    </div>
                    {!filtered.length &&
                      empty(
                        state.items.length
                          ? '검색 결과가 없어요'
                          : '첫 나눔을 등록해 보세요',
                        state.items.length
                          ? '검색어나 물품 종류를 바꿔 보세요.'
                          : '참여자를 등록한 다음 쓰임이 남은 물품을 올려 주세요.',
                      )}
                  </section>
                  <aside>
                    <div className="round-card">
                      <span className="round-chip">
                        {state.round}회차 ·{' '}
                        {open ? '함께 모으는 중' : '배정할 준비 완료'}
                      </span>
                      <h2>
                        작은 나눔이
                        <br />더 많이 이어지게.
                      </h2>
                      <p>
                        받을 수 있는 물품을 모두 신청하면, 전체 조건을 살펴
                        최대한 많은 사람에게 배정해요.
                      </p>
                      {[
                        '물품과 신청 모으기',
                        '신청 마감 후 자동 매칭',
                        '배정 확정과 물품 전달',
                      ].map((t, i) => (
                        <div className="round-step" key={t}>
                          <span>0{i + 1}</span>
                          {t}
                        </div>
                      ))}
                      <Button
                        className="round-button"
                        onClick={() => setTab('matching')}
                      >
                        자동 매칭 살펴보기 <ArrowRight size={17} />
                      </Button>
                    </div>
                    <div className="rule-note">
                      <Network size={22} />
                      <div>
                        <strong>한 회차에 한 사람당 하나</strong>
                        <p>
                          이미 확정한 배정은 유지하며, 남은 물품과 신청자를
                          연결합니다.
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="wide-button"
                      onClick={() => show('request')}
                      disabled={
                        isDisabled ||
                        !open ||
                        !state.people.length ||
                        !state.items.length
                      }
                    >
                      <Plus size={17} />
                      나눔 신청 입력
                    </Button>
                  </aside>
                </div>
              </TabsContent>
              <TabsContent value="requests">
                <div className="section-top">
                  <div>
                    <h2>
                      함께 나누는 사람들 <span>{state.people.length}</span>
                    </h2>
                    <p className="subtle">
                      운영자가 참여자의 이름과 받을 수 있는 물품을 등록합니다.
                    </p>
                  </div>
                  <Button
                    onClick={() => show('person')}
                    disabled={isDisabled || !open}
                  >
                    <Plus size={17} /> 참여자 등록
                  </Button>
                </div>
                {!state.people.length ? (
                  empty(
                    '아직 참여자가 없어요',
                    '나눔하는 사람과 신청할 사람을 먼저 등록해 주세요.',
                  )
                ) : (
                  <div className="people-grid">
                    {state.people.map((person, i) => {
                      const application = state.applications.find(
                        (a) => a.participantId === person.id,
                      );
                      const valid = comparison.edges.filter(
                        (e) => e.participantId === person.id,
                      ).length;
                      const match = state.matches.find(
                        (m) => m.participantId === person.id,
                      );
                      return (
                        <article className="person-card" key={person.id}>
                          <div className="person-heading">
                            <span className={'avatar color-' + (i % 4)}>
                              {person.name.slice(0, 1)}
                            </span>
                            <div>
                              <h3>{person.name}</h3>
                              <p>
                                <MapPin size={13} />
                                {person.zone}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              onClick={() =>
                                show('request', undefined, person.id)
                              }
                              disabled={
                                isDisabled || !open || !state.items.length
                              }
                            >
                              {application ? '신청 수정' : '신청 입력'}
                            </Button>
                          </div>
                          <div className="application-list">
                            {application?.itemIds.length ? (
                              application.itemIds.map((id) => (
                                <span key={id}>{itemName(id)}</span>
                              ))
                            ) : (
                              <p className="subtle">신청한 물품이 없습니다.</p>
                            )}
                          </div>
                          <div className="person-footer">
                            {match ? (
                              <span className="text-primary">
                                {match.status === 'delivered'
                                  ? '수령 완료'
                                  : '배정 확정'}{' '}
                                · {itemName(match.itemId)}
                              </span>
                            ) : application ? (
                              <>
                                <span>조건에 맞는 물품 {valid}개</span>
                                <span>최대 {application.maxDistance}m</span>
                              </>
                            ) : (
                              <span>
                                나눔 물품{' '}
                                {
                                  state.items.filter(
                                    (item) => item.ownerId === person.id,
                                  ).length
                                }
                                개
                              </span>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
                <div className="info-note">
                  <Info size={18} />
                  <p>
                    물품은 여러 개 신청할 수 있지만 받을 수 있는 물품은 회차당
                    한 개입니다. 상태와 거리 조건에 맞지 않는 신청은 배정에서
                    제외됩니다.
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="matching">
                <div className="section-top">
                  <div>
                    <h2>전체를 살펴, 더 많이 연결해요</h2>
                    <p className="subtle">
                      현재 물품과 신청을 기준으로 계산한 결과입니다.
                    </p>
                  </div>
                  <div className="button-row">
                    {open ? (
                      <Button
                        variant="outline"
                        disabled={isDisabled}
                        onClick={() =>
                          setConfirm({
                            title: '신청을 마감할까요?',
                            description:
                              '마감 후에는 물품과 신청을 수정할 수 없어요. 배정을 확정하기 전에는 다시 열 수 있습니다.',
                            command: { type: 'close' },
                          })
                        }
                      >
                        신청 마감
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={isDisabled || !!state.matches.length}
                        onClick={() =>
                          perform(
                            { type: 'reopen' },
                            '신청 접수를 다시 열었습니다.',
                          )
                        }
                      >
                        접수 다시 열기
                      </Button>
                    )}
                    <Button
                      disabled={
                        isDisabled || open || !comparison.maximum.pairs.length
                      }
                      onClick={() =>
                        setConfirm({
                          title: `새 배정 ${comparison.maximum.pairs.length}건을 확정할까요?`,
                          description:
                            '확정한 배정은 다음 계산에서도 유지됩니다. 실제 전달 여부는 별도로 확인해 주세요.',
                          command: { type: 'confirm' },
                        })
                      }
                    >
                      <CheckCheck size={18} />
                      배정 확정
                    </Button>
                  </div>
                </div>
                <div className="comparison-grid">
                  <div className="comparison-card">
                    <span>먼저 가능한 순서대로</span>
                    <strong>
                      {comparison.sequential.length + state.matches.length}
                      <small>명 배정</small>
                    </strong>
                    <div className="bar-track">
                      <div
                        style={{
                          width: `${state.applications.length ? ((comparison.sequential.length + state.matches.length) / state.applications.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <p>등록 순서대로 가능한 신청자에게 배정</p>
                  </div>
                  <div className="comparison-card best">
                    <span>
                      <Sparkles size={17} /> 최대 이분 매칭
                    </span>
                    <strong>
                      {maxCount}
                      <small>명 배정</small>
                    </strong>
                    <div className="bar-track">
                      <div
                        style={{
                          width: `${state.applications.length ? (maxCount / state.applications.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <p>
                      {comparison.maximum.pairs.length >
                      comparison.sequential.length
                        ? `${comparison.maximum.pairs.length - comparison.sequential.length}명이 더 받을 수 있어요.`
                        : '현재 조건에서는 두 방식의 배정 건수가 같아요.'}
                    </p>
                  </div>
                </div>
                <div className="match-layout">
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        배정 미리보기{' '}
                        <span className="count-badge">
                          {comparison.maximum.pairs.length}
                        </span>
                      </h2>
                      <span className="subtle">
                        {open ? '신청 중 · 결과가 바뀔 수 있어요' : '확정 전'}
                      </span>
                    </div>
                    {comparison.maximum.pairs.length ? (
                      <div className="pair-list">
                        {comparison.maximum.pairs.map((pair) => (
                          <div className="pair-row" key={pair.itemId}>
                            <div>
                              <BookOpen size={18} />
                              <span>{itemName(pair.itemId)}</span>
                            </div>
                            <ArrowRight size={18} />
                            <strong>{personName(pair.participantId)}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      empty(
                        '새로 배정할 물품이 없어요',
                        '신청 조건이나 이미 확정된 배정을 확인해 주세요.',
                      )
                    )}
                    <p className="panel-footnote">
                      확정 {state.matches.length}건을 유지한 상태에서, 남은
                      신청을 최대한 연결한 결과입니다.
                    </p>
                  </section>
                  <section className="panel waiting">
                    <h2>배정을 기다리는 사람</h2>
                    <p className="subtle">
                      조건에 맞는 물품이 부족하면 배정되지 않을 수 있어요.
                    </p>
                    {state.applications
                      .filter(
                        (a) =>
                          !state.matches.some(
                            (m) => m.participantId === a.participantId,
                          ) &&
                          !comparison.maximum.pairs.some(
                            (m) => m.participantId === a.participantId,
                          ),
                      )
                      .map((a) => (
                        <div className="waiting-person" key={a.participantId}>
                          <strong>{personName(a.participantId)}</strong>
                          <span>
                            {comparison.edges.some(
                              (e) => e.participantId === a.participantId,
                            )
                              ? '같은 물품에 신청이 모였어요'
                              : '남은 물품 중 조건에 맞는 물품이 없어요'}
                          </span>
                        </div>
                      ))}
                    {state.applications.length > 0 &&
                      maxCount === state.applications.length && (
                        <div className="all-matched">
                          <CheckCheck size={27} />
                          <strong>모든 신청자를 연결할 수 있어요.</strong>
                        </div>
                      )}
                    {!state.applications.length && (
                      <p className="subtle waiting-person">
                        등록된 신청이 없습니다.
                      </p>
                    )}
                  </section>
                </div>
                <section className="panel confirmed-panel">
                  <div className="panel-heading">
                    <h2>
                      확정된 배정{' '}
                      <span className="count-badge">
                        {state.matches.length}
                      </span>
                    </h2>
                    <Button
                      variant="outline"
                      onClick={exportResults}
                      disabled={!state.matches.length}
                    >
                      <Download size={17} />
                      결과 내려받기
                    </Button>
                  </div>
                  {state.matches.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>물품</TableHead>
                          <TableHead>나눔자 → 받는 사람</TableHead>
                          <TableHead>상태</TableHead>
                          <TableHead>전달 확인</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {state.matches.map((m) => (
                          <TableRow key={m.itemId}>
                            <TableCell>{itemName(m.itemId)}</TableCell>
                            <TableCell>
                              {personName(
                                state.items.find((i) => i.id === m.itemId)!
                                  .ownerId,
                              )}{' '}
                              → {personName(m.participantId)}
                            </TableCell>
                            <TableCell>
                              <span
                                className={
                                  'status-pill ' +
                                  (m.status === 'delivered' ? 'done' : '')
                                }
                              >
                                {m.status === 'delivered'
                                  ? '전달 완료'
                                  : '전달 대기'}
                              </span>
                            </TableCell>
                            <TableCell>
                              {m.status === 'confirmed' ? (
                                <div className="button-row">
                                  <Button
                                    variant="outline"
                                    disabled={isDisabled}
                                    onClick={() =>
                                      setConfirm({
                                        title: '물품 전달을 완료했나요?',
                                        description: `${itemName(m.itemId)}을(를) ${personName(m.participantId)}님이 받았는지 확인해 주세요. 완료 후에는 이 회차에서 다시 배정하지 않습니다.`,
                                        command: {
                                          type: 'deliver',
                                          itemId: m.itemId,
                                        },
                                      })
                                    }
                                  >
                                    전달 완료
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    disabled={isDisabled}
                                    onClick={() =>
                                      setConfirm({
                                        title: '이 배정을 취소할까요?',
                                        description:
                                          '물품과 신청자의 배정이 해제됩니다. 같은 물품에 대한 이 신청은 취소되어 재배정되지 않습니다.',
                                        command: {
                                          type: 'cancel-match',
                                          itemId: m.itemId,
                                        },
                                      })
                                    }
                                  >
                                    취소
                                  </Button>
                                </div>
                              ) : (
                                <CheckCheck
                                  size={19}
                                  className="text-primary"
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="empty-line">
                      신청을 마감하고 배정을 확정하면 여기에 표시됩니다.
                    </p>
                  )}
                </section>
                <div className="info-note">
                  <Info size={18} />
                  <p>
                    최대 매칭은 배정 건수를 최대화합니다. 선호 순위, 공정성,
                    이동 거리의 최소화를 보장하는 알고리즘은 아닙니다. 거리는
                    신청 가능 여부를 판단하는 조건으로 사용합니다.
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="about">
                <AlgorithmStory />
                <div className="panel about-project">
                  <h2>이 앱이 해결하려는 문제</h2>
                  <p>
                    여러 물품 중 아무거나 받을 수 있는 학생과 특정 물품만 필요한
                    학생이 함께 신청하면, 개별 배정 순서에 따라 물품이 남을 수
                    있습니다. 학교 행사 전체를 한 번에 배정해 이런 낭비를 줄이는
                    것이 목표입니다.
                  </p>
                  <div className="about-columns">
                    <div>
                      <h3>이분 그래프</h3>
                      <p>
                        왼쪽은 물품 한 개, 오른쪽은 신청자 한 명. 신청
                        목록·상태·수령 거리 조건이 맞을 때만 연결합니다.
                      </p>
                    </div>
                    <div>
                      <h3>최대 이분 매칭</h3>
                      <p>
                        증가 경로를 찾아 임시 배정을 조정합니다. 더 늘릴 경로가
                        없을 때 가능한 최대 배정에 도달합니다.
                      </p>
                    </div>
                    <div>
                      <h3>학교 행사에 맞춘 규칙</h3>
                      <p>
                        회차당 1인 1개, 자기 물품 신청 제외, 확정·전달 배정
                        보존. 실제 전달은 운영자가 확인합니다.
                      </p>
                    </div>
                  </div>
                  <div className="button-row">
                    <Button
                      variant="outline"
                      disabled={isDisabled}
                      onClick={() =>
                        setConfirm({
                          title: '예시 자료로 바꿀까요?',
                          description:
                            '현재 행사 자료를 가상 물품 6개와 참여자 7명으로 바꿉니다. 예시에서는 신청자 6명에 대해 순차 배정 3건, 최대 매칭 6건이 나옵니다.',
                          command: { type: 'load-demo' },
                        })
                      }
                    >
                      <RefreshCw size={16} />
                      예시 행사 불러오기
                    </Button>
                    <a
                      className="source-link"
                      href="https://github.com/siuuuy2009-ship-it/-"
                      target="_blank"
                      rel="noreferrer"
                    >
                      프로젝트 코드 <ArrowUpRight size={16} />
                    </a>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
        <footer>
          <span>
            행사 자료는 서버에 저장됩니다. 이 브라우저의 쿠키로 내 작업 공간에
            접근합니다.
          </span>
          <span>다시, 나눔 · 운영자용 MVP</span>
        </footer>
      </main>
      <Dialog
        open={modal !== null}
        onOpenChange={(v) => {
          if (!v && !busy) setModal(null);
        }}
      >
        <DialogContent className="nanum-dialog">
          <DialogHeader>
            <DialogTitle>
              {modal === 'person'
                ? '참여자 등록'
                : modal === 'item'
                  ? '나눔 물품 등록'
                  : modal === 'request'
                    ? '나눔 신청'
                    : modal === 'event'
                      ? '새 행사 시작'
                      : detail?.title}
            </DialogTitle>
            <DialogDescription>
              {modal === 'request'
                ? '실제로 받을 수 있는 물품을 모두 선택해 주세요. 한 회차에 최대 한 개를 받습니다.'
                : modal === 'person'
                  ? '같은 사람은 하나의 이름으로 등록해 주세요.'
                  : modal === 'item'
                    ? '수령 가능한 구역과 상태를 정확히 알려 주세요.'
                    : modal === 'event'
                      ? '새 행사의 이름을 정해 주세요.'
                      : detail
                        ? `${detail.category} · ${CONDITIONS[detail.condition - 1]} · ${detail.zone}`
                        : ''}
            </DialogDescription>
          </DialogHeader>
          {modal === 'detail' && detail ? (
            <div className="detail-content">
              <p>{detail.description || '별도 설명이 없습니다.'}</p>
              <div className="detail-meta">
                <span>나눔자</span>
                <strong>{personName(detail.ownerId)}</strong>
                <span>수령 구역</span>
                <strong>{detail.zone}</strong>
                <span>신청자</span>
                <strong>
                  {
                    state.applications.filter((a) =>
                      a.itemIds.includes(detail.id),
                    ).length
                  }
                  명
                </strong>
              </div>
              <div className="button-row">
                <Button
                  disabled={isDisabled || !open || !state.people.length}
                  onClick={() => show('request')}
                >
                  나눔 신청 입력
                </Button>
                <Button
                  variant="ghost"
                  disabled={isDisabled || !open}
                  onClick={() => {
                    setModal(null);
                    setConfirm({
                      title: '물품을 삭제할까요?',
                      description:
                        '물품과 연결된 신청에서 이 물품을 제외합니다.',
                      command: { type: 'delete-item', itemId: detail.id },
                    });
                  }}
                >
                  <Trash2 size={16} />
                  삭제
                </Button>
              </div>
            </div>
          ) : (
            <form className="nanum-form" onSubmit={submit}>
              {modal === 'person' && (
                <>
                  <label className="field" htmlFor="person-name">
                    <span>참여자 이름</span>
                    <Input
                      id="person-name"
                      value={form.name ?? ''}
                      onChange={(e) => values('name', e.target.value)}
                      placeholder="예: 김민수 · 2학년 1반"
                      maxLength={20}
                      required
                    />
                  </label>
                  <Choice
                    label="활동 구역"
                    value={form.zone}
                    options={opts(ZONES)}
                    onChange={(v) => values('zone', v)}
                  />
                </>
              )}
              {modal === 'item' && (
                <>
                  <label className="field" htmlFor="item-title">
                    <span>물품 이름</span>
                    <Input
                      id="item-title"
                      value={form.title ?? ''}
                      onChange={(e) => values('title', e.target.value)}
                      placeholder="예: 수학 참고서 · 고1"
                      maxLength={60}
                      required
                    />
                  </label>
                  <Choice
                    label="나눔하는 사람"
                    value={form.ownerId}
                    options={state.people.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                    onChange={(v) => values('ownerId', v)}
                  />
                  <div className="form-columns">
                    <Choice
                      label="물품 종류"
                      value={form.category}
                      options={opts(CATEGORIES)}
                      onChange={(v) => values('category', v)}
                    />
                    <Choice
                      label="물품 상태"
                      value={form.condition}
                      options={CONDITIONS.map((label, i) => ({
                        value: String(i + 1),
                        label,
                      }))}
                      onChange={(v) => values('condition', v)}
                    />
                  </div>
                  <Choice
                    label="수령 구역"
                    value={form.zone}
                    options={opts(ZONES)}
                    onChange={(v) => values('zone', v)}
                  />
                  <label className="field">
                    <span>물품 설명</span>
                    <textarea
                      value={form.description ?? ''}
                      onChange={(e) => values('description', e.target.value)}
                      placeholder="사이즈, 사용 흔적, 수령 시 참고할 내용을 적어 주세요."
                      maxLength={500}
                      rows={3}
                    />
                  </label>
                </>
              )}
              {modal === 'request' && (
                <>
                  <Choice
                    label="신청하는 사람"
                    value={form.participantId}
                    options={state.people.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                    onChange={choosePerson}
                  />
                  <div className="form-columns">
                    <Choice
                      label="받을 수 있는 최소 상태"
                      value={form.minCondition}
                      options={CONDITIONS.map((label, i) => ({
                        value: String(i + 1),
                        label,
                      }))}
                      onChange={(v) => values('minCondition', v)}
                    />
                    <Choice
                      label="이동 가능한 거리"
                      value={form.maxDistance}
                      options={[
                        { value: '0', label: '같은 구역만' },
                        { value: '200', label: '200m 이내' },
                        { value: '400', label: '400m 이내' },
                        { value: '500', label: '500m 이내' },
                      ]}
                      onChange={(v) => values('maxDistance', v)}
                    />
                  </div>
                  <p className="field-hint">
                    교내 기준 거리: 본관↔후관 200m, 본관↔기숙사 500m,
                    후관↔기숙사 400m. 실제 GPS 거리가 아닙니다.
                  </p>
                  <fieldset className="item-choices">
                    <legend>받을 수 있는 물품 · 복수 선택</legend>
                    {state.items
                      .filter((i) => i.ownerId !== form.participantId)
                      .map((item) => {
                        const person = state.people.find(
                          (p) => p.id === form.participantId,
                        );
                        const fits =
                          item.condition >= Number(form.minCondition) &&
                          !!person &&
                          distance(person.zone, item.zone) <=
                            Number(form.maxDistance);
                        return (
                          <label
                            className="item-choice"
                            key={item.id}
                            htmlFor={`request-${item.id}`}
                          >
                            <Checkbox
                              id={`request-${item.id}`}
                              checked={selected.includes(item.id)}
                              onCheckedChange={(v) =>
                                setSelected((s) =>
                                  v
                                    ? [...s, item.id]
                                    : s.filter((id) => id !== item.id),
                                )
                              }
                            />
                            <span>
                              <strong>{item.title}</strong>
                              <small>
                                {CONDITIONS[item.condition - 1]} · {item.zone}
                                {!fits ? ' · 현재 조건으로 배정 불가' : ''}
                              </small>
                            </span>
                          </label>
                        );
                      })}
                    {!state.items.some(
                      (i) => i.ownerId !== form.participantId,
                    ) && (
                      <p className="subtle">
                        신청할 수 있는 다른 사람의 물품이 없습니다.
                      </p>
                    )}
                  </fieldset>
                  <p className="field-hint">
                    선택을 모두 해제하고 저장하면 기존 신청이 취소됩니다.
                  </p>
                </>
              )}
              {modal === 'event' && (
                <label className="field" htmlFor="event-title">
                  <span>행사 이름</span>
                  <Input
                    id="event-title"
                    value={form.title ?? ''}
                    onChange={(e) => values('title', e.target.value)}
                    maxLength={50}
                    required
                  />
                </label>
              )}
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
              <Button
                type="submit"
                className="form-submit"
                disabled={isDisabled}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Check size={18} />
                )}{' '}
                {modal === 'event'
                  ? '계속'
                  : modal === 'request'
                    ? '신청 저장'
                    : '등록하기'}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!confirm}
        onOpenChange={(v) => {
          if (!v && !busy) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>돌아가기</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (confirm)
                  void act(confirm.command, '행사 자료를 업데이트했습니다.')
                    .then(() => setConfirm(null))
                    .catch(() => {});
              }}
            >
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AlgorithmStory() {
  const [step, setStep] = useState(0);
  const edges: Edge[] = [
    { itemId: 'A', participantId: '민수' },
    { itemId: 'A', participantId: '지수' },
    { itemId: 'B', participantId: '민수' },
  ];
  const maximum = maximumMatching(['A', 'B'], edges);
  const pairs =
    step === 0
      ? []
      : step === 1
        ? sequentialMatching(['A', 'B'], edges)
        : maximum.pairs;
  const descriptions = [
    '민수는 A와 B 모두 괜찮고, 지수는 A만 필요해요.',
    'A를 먼저 민수에게 주면 지수는 받지 못하고 B가 남아요.',
    'A를 지수에게, B를 민수에게 배정하면 두 명 모두 받을 수 있어요.',
  ];
  return (
    <section className="story-panel">
      <div className="story-heading">
        <div>
          <span className="eyebrow">2권의 책, 2명의 학생</span>
          <h2>배정 순서가 결과를 바꿀까요?</h2>
          <p>아래 단계를 눌러 연결이 어떻게 바뀌는지 살펴보세요.</p>
        </div>
        <span className="story-result">
          {pairs.length}
          <small>명 연결</small>
        </span>
      </div>
      <div className="graph-wrap">
        <svg viewBox="0 0 720 210" aria-labelledby="matching-graph-title">
          <title id="matching-graph-title">{`참고서 A와 B, 신청자 민수와 지수의 연결. 현재 ${pairs.length}명 배정.`}</title>
          <text x="110" y="25" textAnchor="middle" className="graph-label">
            나눔 물품
          </text>
          <text x="605" y="25" textAnchor="middle" className="graph-label">
            신청자
          </text>
          {edges.map((e) => {
            const sy = e.itemId === 'A' ? 83 : 158;
            const ty = e.participantId === '민수' ? 83 : 158;
            const active = pairs.some(
              (p) =>
                p.itemId === e.itemId && p.participantId === e.participantId,
            );
            return (
              <path
                key={e.itemId + e.participantId}
                d={`M 215 ${sy} C 345 ${sy} 375 ${ty} 505 ${ty}`}
                className={active ? 'graph-edge active' : 'graph-edge'}
              />
            );
          })}
          {['A', 'B'].map((id, i) => (
            <g key={id}>
              <rect
                x="10"
                y={55 + i * 75}
                width="205"
                height="55"
                rx="12"
                className="graph-node"
              />
              <text x="110" y={88 + i * 75} textAnchor="middle">
                참고서 {id}
              </text>
            </g>
          ))}
          {['민수', '지수'].map((name, i) => (
            <g key={name}>
              <rect
                x="505"
                y={55 + i * 75}
                width="205"
                height="55"
                rx="12"
                className="graph-node person"
              />
              <text x="608" y={88 + i * 75} textAnchor="middle">
                {name} · {i === 0 ? 'A 또는 B' : 'A만 필요'}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="story-controls">
        {['① 신청 조건', '② 순차 배정', '③ 최대 이분 매칭'].map((label, i) => (
          <Button
            key={label}
            variant={step === i ? 'default' : 'outline'}
            onClick={() => setStep(i)}
            aria-pressed={step === i}
          >
            {label}
          </Button>
        ))}
      </div>
      <output className="story-description">{descriptions[step]}</output>
      <p className="field-hint">
        굵은 보라색 선은 선택된 배정입니다. 이미 전달한 물품이 아니라, 확정 전
        임시 배정을 조정합니다.
      </p>
    </section>
  );
}
