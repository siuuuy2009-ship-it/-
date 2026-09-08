import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '다시, 나눔 | 우리 학교 나눔 매칭',
  icons: { icon: '/favicon.svg' },
  description:
    '최대 이분 매칭으로 더 많은 학생에게 물품을 연결하는 학교 나눔 앱.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
