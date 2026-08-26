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
        {/*
          * Pretendard 를 안 쓴다. 한국 서비스의 기본값이라 어느 화면에나 있는 얼굴이다.
          *
          * IBM Plex 는 기관이 자기 일에 쓰려고 만든 얼굴이다. 이 물건의 성격에 맞고,
          * 작은 크기에서 획이 또렷하다. 숫자는 고정폭(Mono)으로 둔다. 교시와 날짜가
          * 세로로 쌓이는 화면이라 자릿수가 맞아야 읽힌다. 장식이 아니라 기능이다.
          */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-kr@5.2.5/400.css"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-kr@5.2.5/500.css"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-kr@5.2.5/600.css"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-kr@5.2.5/700.css"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.2.5/400.css"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.2.5/600.css"
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
