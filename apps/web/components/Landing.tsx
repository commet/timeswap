'use client';

import { useRef, useState } from 'react';

const ART_COLS = [8, 76, 144];
const ART_ROWS = [8, 48, 88, 128];

/** 두 수업이 자리를 맞바꾸는 모습 */
function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 220 168" aria-hidden="true">
      <defs>
        <marker
          id="ah-a"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill="var(--accent)" />
        </marker>
        <marker
          id="ah-w"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill="var(--warn)" />
        </marker>
      </defs>
      {ART_ROWS.map((y, r) =>
        ART_COLS.map((x, c) => {
          const isA = r === 1 && c === 0;
          const isB = r === 3 && c === 2;
          return (
            <rect
              key={`${r}-${c}`}
              x={x}
              y={y}
              width="60"
              height="32"
              rx="7"
              fill={isA ? 'var(--accent-soft)' : isB ? 'var(--warn-soft)' : 'var(--surface-2)'}
              stroke={isA ? 'var(--accent)' : isB ? 'var(--warn)' : 'var(--line)'}
              strokeWidth={isA || isB ? 2 : 1}
            />
          );
        }),
      )}
      <path
        d="M74 60 C 120 48, 158 76, 168 120"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
        markerEnd="url(#ah-a)"
      />
      <path
        d="M138 148 C 92 160, 44 132, 34 92"
        fill="none"
        stroke="var(--warn)"
        strokeWidth="3"
        strokeLinecap="round"
        markerEnd="url(#ah-w)"
      />
    </svg>
  );
}

export function Landing({
  onNeis,
  onSample,
  onFile,
  onResume,
  hasSaved,
  savedName,
  busy,
}: {
  onNeis: () => void;
  onSample: () => void;
  onFile: (file: File) => void;
  onResume: () => void;
  hasSaved: boolean;
  savedName: string;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <main className="landing">
      <div className="landing-card">
        <div className="hero">
          <div className="hero-copy">
            <h1>
              바꿔야 할 수업이 생기면,
              <br />
              <em>시간표에서 바로 요청하세요</em>
            </h1>
            <p className="lede">
              가능한 교체와 보강을 한 표에서 비교하고, 일과 담당자의 승인과 나이스·공지·결재
              마무리까지 한 흐름으로 이어집니다.
            </p>
          </div>
          <HeroArt />
        </div>

        {hasSaved && (
          <button className="resume" onClick={onResume}>
            <span className="resume-label">이어서 작업하기</span>
            <span className="resume-name">{savedName}</span>
            <span className="resume-go" aria-hidden>
              →
            </span>
          </button>
        )}

        <div
          className={`dropzone${over ? ' on' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
        >
          <p className="dropzone-title">어떻게 시작하시나요?</p>
          <div className="entry-paths">
            <button className="entry-path primary" onClick={() => inputRef.current?.click()} disabled={busy}>
              <span className="entry-role">교사</span>
              <b>받은 시간표 열기</b>
              <small>학교에서 공유한 파일 하나면 바로 시작</small>
              <i aria-hidden>→</i>
            </button>
            <button className="entry-path" onClick={onNeis} disabled={busy}>
              <span className="entry-role">일과 담당</span>
              <b>학교 시간표 처음 준비하기</b>
              <small>공식 나이스 자료로 한 번만 설정</small>
              <i aria-hidden>→</i>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = '';
              }}
            />
          </div>
          <div className="landing-minor">
            <span>아직 파일이 없나요?</span>
            <button onClick={onSample} disabled={busy}>{busy ? '불러오는 중' : '예시로 1분 체험'}</button>
            <span>· 파일을 이 자리에 끌어다 놓아도 됩니다.</span>
          </div>
        </div>

        <ol className="steps">
          <li>
            <b>교사는 수업만 선택</b>
            <span>시간표에서 바꿀 수업을 누릅니다</span>
          </li>
          <li>
            <b>차이를 보고 요청</b>
            <span>협조 교사와 영향이 한 표에 보입니다</span>
          </li>
          <li>
            <b>담당자는 끝까지 마무리</b>
            <span>승인, 나이스, 공지, 결재를 빠짐없이 확인합니다</span>
          </li>
        </ol>

        <p className="privacy">
          불러온 시간표는 이 기기에만 저장하며 외부로 보내지 않습니다. 회원 가입도 없습니다.
        </p>
      </div>
    </main>
  );
}
