'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  LogIn,
  LogOut,
  KeyRound,
  Users,
  Download,
  Upload,
  ArrowLeft,
  Recycle,
  LoaderCircle,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import NanumApp from './nanum-app';
import {
  parseRoster,
  type SchoolUser,
  type RosterMember,
  type Invitation,
} from '@/lib/school';

async function schoolRequest<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/school', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? '요청을 처리하지 못했어요.');
  return data;
}

export default function SchoolApp() {
  const [initial] = useState(() => {
    if (typeof window === 'undefined') return { schoolCode: '', invite: '' };
    const url = new URL(window.location.href);
    let schoolCode = url.searchParams.get('school') ?? '';
    try {
      schoolCode ||= localStorage.getItem('nanum-school-code') ?? '';
    } catch {
      /* Optional preference. */
    }
    return {
      schoolCode,
      invite: new URLSearchParams(url.hash.slice(1)).get('invite') ?? '',
    };
  });
  const [user, setUser] = useState<SchoolUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'login' | 'activate' | 'create'>(
    initial.invite ? 'activate' : 'login',
  );
  const [demo, setDemo] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [schoolCode, setSchoolCode] = useState(initial.schoolCode);
  const [loginId, setLoginId] = useState('');
  const [code, setCode] = useState(initial.invite);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [title, setTitle] = useState('우리 학교 나눔 행사');

  useEffect(() => {
    const url = new URL(window.location.href);
    if (initial.invite) {
      window.history.replaceState(null, '', url.pathname + url.search);
    }
    void fetch('/api/school', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as {
          user: SchoolUser | null;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error);
        setUser(initial.invite ? null : data.user);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [initial.invite]);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (mode !== 'login' && password !== repeat) {
      setError('비밀번호가 서로 달라요.');
      return;
    }
    setBusy(true);
    try {
      const data = await schoolRequest<{ user: SchoolUser }>({
        action: mode === 'create' ? 'create-school' : mode,
        schoolCode,
        loginId,
        code,
        password,
        title,
      });
      setUser(data.user);
      setPassword('');
      setRepeat('');
      setCode('');
      setSchoolCode(data.user.schoolCode);
      try {
        localStorage.setItem('nanum-school-code', data.user.schoolCode);
      } catch {
        /* Optional preference. */
      }
      setAdminOpen(mode === 'create');
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그인하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError('');
    try {
      await schoolRequest({ action: 'logout' });
      setUser(null);
      setAdminOpen(false);
      setMode('login');
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그아웃하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  if (demo)
    return (
      <>
        <div className="account-toolbar">
          <span>가상 자료 시연</span>
          <Button variant="ghost" onClick={() => setDemo(false)}>
            <ArrowLeft size={16} /> 로그인으로
          </Button>
        </div>
        <NanumApp />
      </>
    );
  if (loading)
    return (
      <main className="auth-loading">
        <LoaderCircle className="spin" /> 로그인 상태 확인 중
      </main>
    );
  if (user)
    return (
      <>
        <div className="account-toolbar">
          <span>
            <strong>{user.name}</strong> ·{' '}
            {user.role === 'admin' ? '운영자' : user.loginId}
          </span>
          <span>
            학교코드 <strong>{user.schoolCode}</strong>
          </span>
          <div className="button-row">
            {user.role === 'admin' && (
              <Button
                variant="outline"
                onClick={() => setAdminOpen(!adminOpen)}
              >
                <Users size={16} />
                {adminOpen ? '나눔함으로' : '명단 관리'}
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void logout()}
            >
              <LogOut size={16} /> 로그아웃
            </Button>
          </div>
        </div>
        {error && (
          <p className="form-error auth-notice" role="alert">
            {error}
          </p>
        )}
        {adminOpen && user.role === 'admin' ? (
          <SchoolAdmin user={user} />
        ) : (
          <NanumApp
            key={user.id}
            user={user}
            onSessionExpired={() => {
              setUser(null);
              setMode('login');
            }}
          />
        )}
      </>
    );

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark">
          <Recycle />
        </span>
        <h1>다시, 나눔.</h1>
      </div>
      <div className="auth-modes" role="tablist" aria-label="계정">
        <button
          role="tab"
          aria-selected={mode === 'login'}
          onClick={() => {
            setMode('login');
            setError('');
          }}
        >
          로그인
        </button>
        <button
          role="tab"
          aria-selected={mode === 'activate'}
          onClick={() => {
            setMode('activate');
            setError('');
          }}
        >
          초대코드로 가입
        </button>
      </div>
      <h2>
        {mode === 'create'
          ? '운영자 나눔함 만들기'
          : mode === 'activate'
            ? '학생 계정 활성화'
            : '학교 나눔함 로그인'}
      </h2>
      <form className="nanum-form" onSubmit={submit}>
        {mode === 'create' && (
          <label className="field" htmlFor="auth-title">
            <span>나눔함 이름</span>
            <Input
              id="auth-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={50}
              required
            />
          </label>
        )}
        {mode === 'login' && (
          <label className="field" htmlFor="auth-school-code">
            <span>학교코드</span>
            <Input
              id="auth-school-code"
              value={schoolCode}
              onChange={(e) => setSchoolCode(e.target.value.toLowerCase())}
              placeholder="운영자가 알려준 학교코드"
              maxLength={8}
              pattern="[a-f0-9]{8}"
              autoComplete="organization"
              required
            />
          </label>
        )}
        <label className="field" htmlFor="auth-login-id">
          <span>
            {mode === 'create'
              ? '운영자 아이디'
              : mode === 'activate'
                ? '학번'
                : '학번 또는 운영자 아이디'}
          </span>
          <Input
            id="auth-login-id"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder={mode === 'create' ? '예: admin' : '예: 1101'}
            inputMode={mode === 'activate' ? 'numeric' : 'text'}
            maxLength={20}
            autoComplete="username"
            required
          />
        </label>
        {mode === 'activate' && (
          <label className="field" htmlFor="auth-invite-code">
            <span>초대코드</span>
            <Input
              id="auth-invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
              maxLength={48}
              autoComplete="off"
              required
            />
          </label>
        )}
        <label className="field" htmlFor="auth-password">
          <span>
            {mode === 'login' ? '비밀번호' : '새 비밀번호 (10자 이상)'}
          </span>
          <Input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={mode === 'login' ? 1 : 10}
            maxLength={128}
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            required
          />
        </label>
        {mode !== 'login' && (
          <label className="field" htmlFor="auth-repeat-password">
            <span>비밀번호 확인</span>
            <Input
              id="auth-repeat-password"
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="form-submit">
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : mode === 'activate' ? (
            <KeyRound size={18} />
          ) : (
            <LogIn size={18} />
          )}
          {mode === 'create'
            ? '나눔함 만들기'
            : mode === 'activate'
              ? '계정 활성화'
              : '로그인'}
        </Button>
      </form>
      <div className="auth-links">
        <Button
          variant="ghost"
          onClick={() => {
            setMode(mode === 'create' ? 'login' : 'create');
            setError('');
          }}
        >
          {mode === 'create' ? <ArrowLeft size={16} /> : <Plus size={16} />}
          {mode === 'create' ? '로그인으로' : '처음 운영하는 나눔함 만들기'}
        </Button>
        <Button variant="ghost" onClick={() => setDemo(true)}>
          예시 행사 둘러보기
        </Button>
      </div>
    </main>
  );
}

function SchoolAdmin({ user }: { user: SchoolUser }) {
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [roster, setRoster] = useState('');
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetId, setResetId] = useState('');
  async function load() {
    const response = await fetch('/api/school?action=roster', {
      cache: 'no-store',
    });
    const data = (await response.json()) as {
      members: RosterMember[];
      error?: string;
    };
    if (!response.ok) throw new Error(data.error);
    setMembers(data.members);
  }
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, []);
  async function importRoster(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      parseRoster(roster);
      const data = await schoolRequest<{ invitations: Invitation[] }>({
        action: 'import-roster',
        roster,
      });
      setInvitations(data.invitations);
      setNotice(
        `${data.invitations.length}명의 새 초대코드를 발급했어요. 기존 학생은 유지됩니다.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '명단을 등록하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  async function reissue() {
    setBusy(true);
    setError('');
    try {
      const data = await schoolRequest<{ invitations: Invitation[] }>({
        action: 'reissue',
        accountId: resetId,
      });
      setInvitations(data.invitations);
      setResetId('');
      await load();
      setNotice(
        '이전 초대코드와 로그인은 해제됐어요. 새 코드를 학생에게 전달해 주세요.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '재발급하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const rows = [
      ['학번', '이름', '초대코드', '학교코드', '가입링크'],
      ...invitations.map((entry) => [
        entry.studentNumber,
        entry.name,
        entry.code,
        user.schoolCode,
        `${window.location.origin}/?school=${user.schoolCode}#invite=${entry.code}`,
      ]),
    ];
    const csv =
      '\uFEFF' +
      rows
        .map((row) =>
          row
            .map(
              (value) =>
                `"${(/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`,
            )
            .join(','),
        )
        .join('\r\n');
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = '다시나눔-학생별초대코드.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="workspace school-admin">
      <div className="section-top">
        <h1>
          학생 명단 관리 <span className="count-badge">{members.length}명</span>
        </h1>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          <RefreshCw size={16} /> 새로고침
        </Button>
      </div>
      <p className="subtle">
        학교코드 <strong>{user.schoolCode}</strong> · 가입 완료{' '}
        {members.filter((m) => m.active).length}명
      </p>
      <form className="roster-import nanum-form" onSubmit={importRoster}>
        <label className="field">
          <span>학생 명단 (학번,이름)</span>
          <textarea
            value={roster}
            onChange={(e) => setRoster(e.target.value)}
            placeholder={'학번,이름\n1101,학생이름\n1102,학생이름'}
            rows={6}
            maxLength={30000}
            required
          />
        </label>
        <div className="button-row">
          <label className="roster-upload">
            <Upload size={16} /> 명단 파일 선택
            <input
              type="file"
              accept=".csv,.txt"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 100000) {
                  setError('명단 파일은 100KB 이내로 선택해 주세요.');
                  return;
                }
                void file
                  .text()
                  .then(setRoster)
                  .catch(() => setError('파일을 읽지 못했어요.'));
              }}
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Users size={16} />
            )}{' '}
            명단 등록·초대코드 발급
          </Button>
        </div>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="school-notice">{notice}</output>}
      {!!invitations.length && (
        <section className="issued-invitations">
          <div className="section-top">
            <h2>이번에 발급한 초대코드 {invitations.length}개</h2>
            <Button onClick={download}>
              <Download size={16} /> 초대코드 CSV 내려받기
            </Button>
          </div>
          <p>
            학생별 코드는 해당 학생에게만 전달해 주세요. 이 화면을 떠나면 원래
            코드는 다시 볼 수 없고 재발급해야 해요.
          </p>
          <details>
            <summary>발급한 코드 확인</summary>
            <ul>
              {invitations.map((entry) => (
                <li key={entry.studentNumber}>
                  {entry.studentNumber} {entry.name} <code>{entry.code}</code>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
      {resetId && (
        <section className="reset-invitation" role="alert">
          <p>
            초대코드를 재발급하면 해당 학생의 기존 로그인과 비밀번호가
            해제됩니다. 학생이 새 코드로 비밀번호를 다시 정해야 해요.
          </p>
          <div className="button-row">
            <Button disabled={busy} onClick={() => void reissue()}>
              <KeyRound size={16} /> 재발급 확인
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setResetId('')}
            >
              돌아가기
            </Button>
          </div>
        </section>
      )}
      <div className="roster-table">
        <table>
          <thead>
            <tr>
              <th>학번</th>
              <th>이름</th>
              <th>가입 상태</th>
              <th>초대코드</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>{member.studentNumber}</td>
                <td>{member.name}</td>
                <td>{member.active ? '가입 완료' : '초대 중'}</td>
                <td>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setResetId(member.id)}
                  >
                    <KeyRound size={15} /> 재발급
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!members.length && <p className="subtle">등록된 학생이 없습니다.</p>}
    </main>
  );
}
