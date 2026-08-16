import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '수업품앗이',
  description:
    '학기 중 수업 교환 추천 도구. 결강이 생겼을 때 성립하는 교환안을 근거와 함께 제시합니다. 시간표는 브라우저 안에만 저장됩니다.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F7F4' },
    { media: '(prefers-color-scheme: dark)', color: '#141814' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        {/* 저장된 테마를 그리기 전에 적용해 첫 화면 색이 튀지 않게 한다 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('timeswap:v0:theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
