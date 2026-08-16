'use client';

import { useRef, useState } from 'react';

const ART_COLS = [8, 76, 144];
const ART_ROWS = [8, 48, 88, 128];

/** 랜딩 장식용 미니 시간표. 두 수업이 자리를 맞바꾸는 모습을 그린다. */
function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 220 168" aria-hidden="true">
      <defs>
        <marker
          id="tsw-ah-a"
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
          id="tsw-ah-w"
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
        markerEnd="url(#tsw-ah-a)"
      />
      <path
        d="M138 148 C 92 160, 44 132, 34 92"
        fill="none"
        stroke="var(--warn)"
        strokeWidth="3"
        strokeLinecap="round"
        markerEnd="url(#tsw-ah-w)"
      />
    </svg>
  );
}

export function Landing({
  onSample,
  onFile,
  busy,
}: {
  onSample: () => void;
  onFile: (file: File) => void;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="landing">
      <div className="landing-card">
        <div className="hero">
          <div className="hero-copy">
            <h1>
              수업을 바꿔야 할 때,
              <br />
              경우의 수는 <em>수업품앗이</em>가 셉니다
            </h1>
            <p className="lede">
              시간표를 불러온 다음, 바꿔야 할 수업을 누르십시오. 맞바꾸기, 연쇄 교환,
              빈 시간 옮기기까지 되는 방법을 전부 찾아 이유를 함께 답니다.
            </p>
          </div>
          <HeroArt />
        </div>
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
          <p>컴시간 뷰어 JSON 파일을 끌어다 놓거나, 샘플 학교로 바로 체험하십시오.</p>
          <div className="actions">
            <button className="btn primary" onClick={onSample} disabled={busy}>
              {busy ? '불러오는 중' : '샘플 학교로 체험'}
            </button>
            <button className="btn" onClick={() => inputRef.current?.click()} disabled={busy}>
              JSON 파일 선택
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
        </div>
        <ol className="steps">
          <li>
            <b>시간표 불러오기</b>
            <span>컴시간 뷰어 JSON 파일 또는 샘플 학교</span>
          </li>
          <li>
            <b>결강 수업 선택</b>
            <span>하루 전체는 요일 머리글, 회의 시간은 빈 교시 잠금</span>
          </li>
          <li>
            <b>추천 확인과 반영</b>
            <span>근거를 읽고 한 번에 반영, 공지와 계획서까지</span>
          </li>
        </ol>
        <p className="privacy">
          시간표는 이 브라우저 안에만 저장됩니다. 서버로 보내지 않습니다.
        </p>
      </div>
    </div>
  );
}
