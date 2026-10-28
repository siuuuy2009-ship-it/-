import { DomainError } from './domain.ts';

export const CONSENT_VERSION = '2026-10-28-v1';
export const CONSENT_NOTICE = [
  [
    '수집 항목',
    '학생의 이름·학번, 운영자 아이디·행사 이름, 비밀번호 해시, 등록한 물품과 신청·배정 내역, 동의 시각·안내 버전',
  ],
  ['이용 목적', '계정 관리, 학교 나눔 행사 운영, 물품 매칭과 전달 확인'],
  [
    '저장·처리',
    '이 앱이 사용하는 Vercel 및 Supabase 서버에서 저장·처리합니다. 이름·학번은 운영자와 배정 확정 후 본인에게 연결된 상대에게 표시됩니다.',
  ],
  [
    '보유 기간',
    '학생은 계정·정보 삭제로 동의를 철회할 수 있습니다. 철회하면 계정, 이름·학번 및 연결된 물품·신청·배정 자료를 삭제합니다.',
  ],
  [
    '거부 권리',
    '동의를 거부할 수 있습니다. 동의하지 않으면 실제 계정 가입은 할 수 없지만 예시 행사는 둘러볼 수 있습니다.',
  ],
] as const;

export function requireConsent(value: unknown, version: unknown) {
  if (value !== true || version !== CONSENT_VERSION)
    throw new DomainError(
      '개인정보 수집·이용 안내를 읽고 필수 동의에 체크해 주세요.',
    );
}

export type SignupConsent = { accepted: true; version: string; name: string };
