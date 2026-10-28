'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, KeyRound, LoaderCircle, RefreshCw } from 'lucide-react';
import type { SchoolUser, RosterMember } from '@/lib/school';
import { schoolRequest } from './school-app';

type IssuedCode = { code: string; name?: string; studentNumber?: string };
export default function SchoolAdmin({ user }: { user: SchoolUser }) {
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [count, setCount] = useState('1');
  const [invitations, setInvitations] = useState<IssuedCode[]>([]);
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
  async function issue(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await schoolRequest<{ invitations: IssuedCode[] }>({
        action: 'issue-invites',
        count: Number(count),
      });
      setInvitations(data.invitations);
      setNotice(
        `${data.invitations.length}개의 초대코드를 발급했어요. 아직 학생 정보는 등록되지 않았습니다.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '초대코드를 만들지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  async function reissue() {
    setBusy(true);
    setError('');
    try {
      const data = await schoolRequest<{ invitations: IssuedCode[] }>({
        action: 'reissue',
        accountId: resetId,
      });
      setInvitations(data.invitations);
      setResetId('');
      await load();
      setNotice(
        '이전 로그인은 해제됐어요. 학생이 새 코드로 다시 동의하고 가입해야 합니다.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '재발급하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const rows = [
      ['대상', '초대코드', '학교코드', '가입링크'],
      ...invitations.map((entry, i) => [
        entry.studentNumber
          ? `${entry.studentNumber} ${entry.name}`
          : `초대 ${i + 1}`,
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
    link.download = '다시나눔-초대코드.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="workspace school-admin">
      <div className="section-top">
        <h1>
          동의·가입 관리 <span className="count-badge">{members.length}명</span>
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
        학교코드 <strong>{user.schoolCode}</strong> · 학생이 직접 동의하고
        가입하면 아래 명단에 표시됩니다.
      </p>
      <form className="roster-import nanum-form" onSubmit={issue}>
        <label className="field" htmlFor="invite-count">
          <span>개인정보 없는 초대코드 발급 수</span>
          <Input
            id="invite-count"
            type="number"
            min={1}
            max={288}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            required
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <KeyRound size={16} />
          )}{' '}
          초대코드 발급
        </Button>
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
            <h2>발급한 초대코드 {invitations.length}개</h2>
            <Button onClick={download}>
              <Download size={16} /> 초대코드 CSV 내려받기
            </Button>
          </div>
          <p>
            코드는 한 학생에게 하나씩 전달해 주세요. 화면을 떠나면 원래 코드를
            다시 볼 수 없습니다.
          </p>
          <details>
            <summary>발급한 코드 확인</summary>
            <ul>
              {invitations.map((entry, i) => (
                <li key={entry.code}>
                  {entry.studentNumber ?? `초대 ${i + 1}`}{' '}
                  <code>{entry.code}</code>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
      {resetId && (
        <section className="reset-invitation" role="alert">
          <p>
            이 학생의 기존 로그인과 비밀번호를 해제하고 재가입 코드를
            발급합니다.
          </p>
          <div className="button-row">
            <Button disabled={busy} onClick={() => void reissue()}>
              재발급 확인
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
              <th>동의 시각</th>
              <th>로그인</th>
              <th>재발급</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>{member.studentNumber}</td>
                <td>{member.name}</td>
                <td>
                  {member.consentedAt
                    ? new Date(member.consentedAt).toLocaleString('ko-KR', {
                        timeZone: 'Asia/Seoul',
                      })
                    : '동의 전'}
                </td>
                <td>{member.active ? '사용 중' : '재가입 대기'}</td>
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
      {!members.length && (
        <p className="subtle">동의하고 가입한 학생이 없습니다.</p>
      )}
    </main>
  );
}
