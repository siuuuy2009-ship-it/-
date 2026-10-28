'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  LogIn,
  LogOut,
  KeyRound,
  Users,
  ArrowLeft,
  Recycle,
  LoaderCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { CONSENT_NOTICE, CONSENT_VERSION } from '@/lib/consent';
import type { SchoolUser } from '@/lib/school';
import NanumApp from './nanum-app';
import SchoolAdmin from './school-admin';

export async function schoolRequest<T>(
  body: Record<string, unknown>,
): Promise<T> {
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
  const [name, setName] = useState('');
  const [code, setCode] = useState(initial.invite);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [title, setTitle] = useState('우리 학교 나눔 행사');
  const [consent, setConsent] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (initial.invite)
      window.history.replaceState(null, '', url.pathname + url.search);
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

  function switchMode(next: typeof mode) {
    setMode(next);
    setConsent(false);
    setError('');
  }
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (mode !== 'login' && !consent) {
      setError('개인정보 수집·이용에 동의해야 가입할 수 있어요.');
      return;
    }
    if (mode !== 'login' && password !== repeat) {
      setError('비밀번호가 서로 달라요.');
      return;
    }
    setBusy(true);
    try {
      const body =
        mode === 'login'
          ? { action: 'login', schoolCode, loginId, password }
          : {
              action: mode === 'create' ? 'create-school' : 'activate',
              loginId,
              password,
              ...(mode === 'create' ? { title } : { name, code }),
              consentAccepted: consent,
              consentVersion: CONSENT_VERSION,
            };
      const data = await schoolRequest<{ user: SchoolUser }>(body);
      setUser(data.user);
      setPassword('');
      setRepeat('');
      setCode('');
      setConsent(false);
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
      switchMode('login');
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그아웃하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  async function withdraw(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteConfirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      await schoolRequest({
        action: 'withdraw',
        password: deletePassword,
        deleteConfirmed,
      });
      setUser(null);
      setDeleting(false);
      setDeletePassword('');
      setDeleteConfirmed(false);
      switchMode('login');
    } catch (e) {
      setError(e instanceof Error ? e.message : '정보를 삭제하지 못했어요.');
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
            {user.role === 'admin' ? (
              <Button
                variant="outline"
                onClick={() => setAdminOpen(!adminOpen)}
              >
                <Users size={16} />
                {adminOpen ? '나눔함으로' : '동의·가입 관리'}
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => {
                  setDeleting(!deleting);
                  setDeleteConfirmed(false);
                  setDeletePassword('');
                }}
              >
                <Trash2 size={16} /> 계정·정보 삭제
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
        {deleting && (
          <form className="withdraw-form nanum-form" onSubmit={withdraw}>
            <h2>동의 철회 및 계정·정보 삭제</h2>
            <p>
              이름·학번, 계정과 로그인, 본인의 물품·신청·매너 평가 및 연결된
              배정 자료를 삭제합니다. 다른 학생이 신청한 본인 물품의 배정도
              취소됩니다. 삭제 후 복구할 수 없습니다.
            </p>
            <label className="field" htmlFor="delete-password">
              <span>현재 비밀번호</span>
              <Input
                id="delete-password"
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label className="consent-check" htmlFor="delete-confirmed">
              <Checkbox
                id="delete-confirmed"
                checked={deleteConfirmed}
                onCheckedChange={(value) => setDeleteConfirmed(value === true)}
              />
              <span>
                삭제되는 내용을 확인했으며 계정·정보 삭제를 요청합니다.
              </span>
            </label>
            <div className="button-row">
              <Button type="submit" disabled={busy || !deleteConfirmed}>
                <Trash2 size={16} /> 동의 철회·삭제 실행
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleting(false)}
              >
                돌아가기
              </Button>
            </div>
          </form>
        )}
        {adminOpen && user.role === 'admin' ? (
          <SchoolAdmin user={user} />
        ) : (
          <NanumApp
            key={user.id}
            user={user}
            onSessionExpired={() => {
              setUser(null);
              switchMode('login');
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
          onClick={() => switchMode('login')}
        >
          로그인
        </button>
        <button
          role="tab"
          aria-selected={mode === 'activate'}
          onClick={() => switchMode('activate')}
        >
          초대코드로 가입
        </button>
      </div>
      <h2>
        {mode === 'create'
          ? '운영자 나눔함 만들기'
          : mode === 'activate'
            ? '학생 계정 가입'
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
        {mode === 'activate' && (
          <label className="field" htmlFor="auth-name">
            <span>본인 이름</span>
            <Input
              id="auth-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              autoComplete="name"
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
          <>
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
            <section
              className="consent-notice"
              aria-label="개인정보 수집·이용 안내"
            >
              <details>
                <summary>개인정보 수집·이용 안내 보기</summary>
                <dl>
                  {CONSENT_NOTICE.map(([label, description]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{description}</dd>
                    </div>
                  ))}
                </dl>
                <p className="field-hint">안내 버전: {CONSENT_VERSION}</p>
              </details>
              <label className="consent-check" htmlFor="signup-consent">
                <Checkbox
                  id="signup-consent"
                  checked={consent}
                  onCheckedChange={(value) => setConsent(value === true)}
                />
                <span>
                  [필수] 안내를 읽었으며 개인정보 수집·이용과 Vercel/Supabase
                  서버 저장에 동의합니다.
                </span>
              </label>
            </section>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          disabled={busy || (mode !== 'login' && !consent)}
          className="form-submit"
        >
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : mode === 'activate' ? (
            <KeyRound size={18} />
          ) : (
            <LogIn size={18} />
          )}
          {mode === 'create'
            ? '동의하고 나눔함 만들기'
            : mode === 'activate'
              ? '동의하고 가입'
              : '로그인'}
        </Button>
      </form>
      <div className="auth-links">
        <Button
          variant="ghost"
          onClick={() => switchMode(mode === 'create' ? 'login' : 'create')}
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
