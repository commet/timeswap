import type { Metadata, Viewport } from 'next';
import './globals.css';
import { BRAND_FULL, TAGLINE } from '../lib/brand';
import { SkipLink } from '../components/SkipLink';

export const metadata: Metadata = {
  title: BRAND_FULL,
  description: TAGLINE,
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
      <body>
        {/* 키보드로 들어온 사람이 머리말 전체를 지나지 않고 본문에 닿게 한다. */}
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
