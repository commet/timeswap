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
    <div className="landing">
      <div className="landing-card">
        <div className="hero">
          <div className="hero-copy">
            <h1>
              들어가지 못하는 수업이 생겼을 때,
              <br />
              <em>바꿀 수 있는 방법</em>을 모두 찾습니다
            </h1>
            <p className="lede">
              비울 수업을 고르면 맞바꾸기와 연쇄 교체, 빈 시간 이동까지 가능한 경우를 모두 세어
              좋은 순서로 보여 드립니다. 동료 교사께 보낼 요청 문구와 결재용 계획서도 함께
              만듭니다.
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
          <p className="dropzone-title">시간표 불러오기</p>
          {/*
           * 세 길이 무엇을 요구하는지 누르기 전에 밝힌다.
           *
           * 전에는 단추 셋이 나란히 있고 설명이 없었다. 그래서 나이스 쪽을 눌러 학교를
           * 찾고 고른 뒤에야 인증키가 필요하다는 것을 알았다. 들인 수고가 헛되고
           * 그 자리에서 도구를 접을 만한 순간이다.
           */}
          <div className="actions">
            <button className="btn primary" onClick={onNeis} disabled={busy}>
              학교 이름으로 찾기
              <span className="btn-sub">무료 인증키 필요</span>
            </button>
            <button className="btn" onClick={() => inputRef.current?.click()} disabled={busy}>
              저장한 파일 열기
              <span className="btn-sub">동료가 준 파일</span>
            </button>
            <button className="btn" onClick={onSample} disabled={busy}>
              {busy ? '불러오는 중' : '예시로 살펴보기'}
              {!busy && <span className="btn-sub">준비 없이 바로</span>}
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
          <p className="dropzone-hint">저장해 둔 파일은 이 자리에 끌어다 놓아도 열립니다.</p>
        </div>

        <ol className="steps">
          <li>
            <b>시간표 불러오기</b>
            <span>학교 이름으로 찾거나 저장해 둔 파일을 엽니다</span>
          </li>
          <li>
            <b>비울 수업 고르기</b>
            <span>하루 전체는 요일 이름을, 회의 시간은 빈칸을 누릅니다</span>
          </li>
          <li>
            <b>방법 고르고 반영하기</b>
            <span>근거를 보고 고르면 요청 문구와 계획서까지 만듭니다</span>
          </li>
        </ol>

        <p className="privacy">
          불러온 시간표는 이 기기에만 저장하며 외부로 보내지 않습니다. 회원 가입도 없습니다.
        </p>
      </div>
    </div>
  );
}
