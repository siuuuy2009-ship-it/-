import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '다시, 나눔 | 기숙사 생활 나눔',
  icons: { icon: '/favicon.svg' },
  description:
    '기숙사에서 필요한 물건은 부탁하고 여유 있는 물건은 나누는 학생 생활 앱.',
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
