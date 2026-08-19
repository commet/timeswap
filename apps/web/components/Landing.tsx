'use client';

import { useState } from 'react';

import type { WorkspaceState } from '../lib/domain';

function ScheduleWindow() {
  return (
    <div className="schedule-window" aria-hidden="true">
      <div className="schedule-ruler"><span>08:40</span><span>12:30</span><span>16:10</span></div>
      <div className="schedule-board">
        <span className="schedule-now">지금</span>
        <div className="schedule-line" />
        <article className="schedule-block first"><b>3교시</b><span>기계일반</span><small>2학년 1반</small></article>
        <article className="schedule-block moved"><b>4교시</b><span>건축일반</span><small>변경 확인</small></article>
        <div className="schedule-swap">↕</div>
      </div>
    </div>
  );
}

export function Landing({
  state,
  onOpen,
  onSetup,
  onDemo,
}: {
  state: WorkspaceState | null;
  onOpen(input: string): void;
  onSetup(): void;
  onDemo(): void;
}) {
  const [entry, setEntry] = useState('');

  return (
    <main className="landing school-entry" aria-labelledby="landing-title">
      <div className="landing-card">
        <header className="entry-hero">
          <div className="entry-copy">
            <span className="eyebrow">학교 시간표 변경을 한 흐름으로</span>
            <h1 id="landing-title" tabIndex={-1}>
              내 학교의 오늘을<br /><em>바로 여십시오</em>
            </h1>
            <p>
              교사는 바꿀 수업을 고르고, 일과 담당자는 승인부터 게시까지 같은 시간표에서 마무리합니다.
            </p>
          </div>
          <ScheduleWindow />
        </header>

        <section className="school-entry-panel" aria-label="학교 진입">
          <label htmlFor="school-entry-input">학교 이름 또는 받은 링크</label>
          <div className="school-entry-row">
            <input
              id="school-entry-input"
              className="input"
              value={entry}
              placeholder="학교명을 검색하거나 초대 링크를 붙여 넣으십시오"
              onChange={(event) => setEntry(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') onOpen(entry); }}
            />
            <button className="btn primary" onClick={() => onOpen(entry)}>
              우리 학교 시간표 열기
            </button>
          </div>
          {state && (
            <button className="saved-school" onClick={() => onOpen(state.workspace.id)}>
              <span>이 기기에 저장됨</span><b>{state.workspace.name}</b><i aria-hidden>→</i>
            </button>
          )}
        </section>

        <div className="entry-actions">
          <button className="entry-secondary" onClick={onSetup}>
            <span>학교에서 한 번만 설정</span>
            <b>일과 담당자로 시작</b>
            <i aria-hidden>→</i>
          </button>
          <button className="entry-demo" onClick={onDemo}>
            <span>입력 없이 바로 확인</span>
            <b>예시 학교 둘러보기</b>
            <i aria-hidden>→</i>
          </button>
        </div>

        <p className="entry-trust">
          <span aria-hidden>✓</span> 공식 나이스 공개 자료와 학교가 권한을 갖고 제공한 자료만 사용합니다.
        </p>
      </div>
    </main>
  );
}
