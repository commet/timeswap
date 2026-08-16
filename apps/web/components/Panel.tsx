'use client';

import { useState } from 'react';
import {
  slotName,
  type Candidate,
  type CoverCandidate,
  type RecommendResult,
  type ScheduleConfig,
} from '@timeswap/engine';

const TYPE_LABEL: Record<Candidate['type'], string> = {
  move: '빈 시간 옮기기',
  swap2: '맞바꾸기',
  cycle3: '연쇄 교환',
};

type Filter = 'all' | Candidate['type'];

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'swap2', label: '맞바꾸기' },
  { key: 'cycle3', label: '연쇄' },
  { key: 'move', label: '옮기기' },
];

export function Panel({
  cfg,
  result,
  queueLen,
  cover,
  hovered,
  onHover,
  onCopy,
  onApply,
  onSkip,
}: {
  cfg: ScheduleConfig;
  result: RecommendResult | null;
  /** 대기 중인 결강 수(지금 보는 것 포함) */
  queueLen: number;
  /** 교환이 없을 때 보여줄 보강 후보 */
  cover: CoverCandidate[] | null;
  hovered: Candidate | null;
  onHover: (c: Candidate | null) => void;
  onCopy: (c: Candidate) => void;
  onApply: (c: Candidate) => void;
  onSkip: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const list =
    result === null
      ? []
      : filter === 'all'
        ? result.candidates
        : result.candidates.filter((c) => c.type === filter);

  return (
    <aside className="card panel" aria-label="교환 추천">
      <div className="card-head">
        <h2>교환 추천</h2>
        {result && (
          <span className="sub">
            {result.target.klass} {result.target.subject}, {slotName(result.target.slot, cfg)}
            {queueLen > 1 ? ` | 대기 ${queueLen - 1}건` : ''}
          </span>
        )}
        {queueLen > 1 && (
          <button className="btn ghost head-skip" onClick={onSkip}>
            뒤로 미루기
          </button>
        )}
      </div>
      {!result ? (
        <div className="panel-empty">
          시간표에서 <b>바꿔야 할 수업</b>을 누르면
          <br />
          되는 방법을 여기에 정리합니다.
          <br />
          <span className="hint">요일 머리글을 누르면 그날 수업 전체가 결강으로 걸립니다.</span>
        </div>
      ) : result.candidates.length === 0 ? (
        <div className="panel-empty">
          <b>바꿀 방법을 찾지 못했습니다.</b>
          <br />
          {result.notes.length > 0 ? result.notes.join(' ') : '보강으로 처리해야 할 수 있습니다.'}
          {cover && cover.length > 0 && (
            <div className="cover">
              <p className="cover-title">이 교시에 비어 있는 선생님</p>
              <ul className="cover-list">
                {cover.map((c) => (
                  <li key={c.teacher}>
                    <span className="cover-name">{c.teacher}</span>
                    {c.sameSubject && <span className="cover-badge">같은 과목</span>}
                    <span className="cover-load">주 {c.weeklyLessons}시간</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="chips" role="group" aria-label="추천 유형 필터">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`chip${filter === f.key ? ' on' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="panel-body" onMouseLeave={() => onHover(null)}>
            {list.length === 0 && (
              <div className="panel-empty small-empty">이 유형으로는 방법이 없습니다.</div>
            )}
            {list.map((c, i) => (
              <div
                key={c.title + i}
                className={`cand${hovered === c ? ' hover' : ''}${i === 0 && filter === 'all' ? ' top' : ''}`}
                onMouseEnter={() => onHover(c)}
                onFocus={() => onHover(c)}
              >
                <div className="cand-head">
                  <span className="cand-rank">{i + 1}</span>
                  <span className="cand-type">{TYPE_LABEL[c.type]}</span>
                  <span className="cand-title">{c.title}</span>
                </div>
                <ul className="cand-trace">
                  {c.trace.map((t, j) => (
                    <li
                      key={j}
                      className={t.kind === '조건' ? 'ok' : t.kind === '감점' ? 'minus' : 'plus'}
                    >
                      {t.text}
                      {t.points !== undefined ? ` (${t.points > 0 ? '+' : ''}${t.points})` : ''}
                    </li>
                  ))}
                </ul>
                <div className="cand-foot">
                  <button className="btn primary" onClick={() => onApply(c)}>
                    이 방법으로 바꾸기
                  </button>
                  <button className="btn" onClick={() => onCopy(c)}>
                    요청 문구 복사
                  </button>
                  <span className="cand-score">
                    {c.unitCount !== undefined && c.unitCount !== c.changes.length
                      ? `묶음 ${c.unitCount}개 이동, 수업 ${c.changes.length}개`
                      : `수업 ${c.changes.length}개 이동`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
