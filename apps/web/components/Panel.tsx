'use client';

import { useState } from 'react';
import {
  slotName,
  type Assignment,
  type Candidate,
  type CoverCandidate,
  type RecommendResult,
  type ScheduleConfig,
} from '@timeswap/engine';

const TYPE_LABEL: Record<Candidate['type'], string> = {
  move: '빈 시간으로 이동',
  swap2: '맞바꾸기',
  cycle3: '연쇄 교체',
};

type Filter = 'all' | Candidate['type'];

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'swap2', label: '맞바꾸기' },
  { key: 'cycle3', label: '연쇄' },
  { key: 'move', label: '이동' },
];

export function Panel({
  cfg,
  result,
  queueLen,
  cover,
  hovered,
  peers,
  grouped,
  onGroup,
  onUngroup,
  onHover,
  onCopy,
  onCopyCover,
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
  /** 같은 교시에 같은 과목을 듣는 다른 학급. 이동수업일 수 있다 */
  peers: Assignment[];
  /** 손으로 묶어 둔 자리인지. 자동으로 묶인 것은 풀 수 없다 */
  grouped: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  onHover: (c: Candidate | null) => void;
  onCopy: (c: Candidate) => void;
  onCopyCover: (teacher: string) => void;
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
    <aside className="card panel" aria-label="교체 방법">
      <div className="card-head">
        <h2>교체 방법</h2>
        {result && (
          <span className="sub">
            {result.target.klass} {result.target.subject}, {slotName(result.target.slot, cfg)}
            {queueLen > 1 ? ` | 대기 ${queueLen - 1}건` : ''}
          </span>
        )}
        {queueLen > 1 && (
          <button className="btn ghost head-skip" onClick={onSkip}>
            나중에
          </button>
        )}
      </div>
      {result && peers.length > 0 && (
        <div className="peers" role="status">
          <p>
            같은 교시에 <b>{peers.map((a) => a.klass).join(', ')}</b>도 {result.target.subject}{' '}
            수업입니다. 이동수업이라면 함께 움직여야 하므로 묶어 주십시오.
          </p>
          <button className="btn" onClick={onGroup}>
            이동수업으로 묶기
          </button>
        </div>
      )}
      {result && grouped && (
        <div className="peers undo" role="status">
          <p>이 수업은 이동수업으로 묶여 있어 같은 묶음이 함께 움직입니다.</p>
          <button className="btn" onClick={onUngroup}>
            묶음 해제
          </button>
        </div>
      )}
      {!result ? (
        <div className="panel-empty">
          왼쪽 시간표에서 <b>비울 수업</b>을 누르십시오.
          <br />
          가능한 교체 방법을 이 자리에 정리해 드립니다.
          <br />
          <span className="hint">요일 이름을 누르면 그날 수업이 한 번에 선택됩니다.</span>
        </div>
      ) : result.candidates.length === 0 ? (
        <div className="panel-empty">
          <b>맞바꿀 수 있는 수업이 없습니다.</b>
          <br />
          {result.notes.length > 0 ? result.notes.join(' ') : '보강으로 처리하셔야 합니다.'}
          {cover && cover.length > 0 && (
            <div className="cover">
              <p className="cover-title">보강을 부탁드릴 수 있는 분</p>
              <ul className="cover-list">
                {cover.map((c, i) => (
                  <li key={c.teacher}>
                    <div className="cover-head">
                      <span className="cover-rank">{i + 1}</span>
                      <span className="cover-name">{c.teacher}</span>
                      {c.sameSubject && <span className="cover-badge">같은 과목</span>}
                      <span className="cover-load">주 {c.weeklyLessons}시간</span>
                    </div>
                    <ul className="cover-why">
                      {c.notes.map((n, j) => (
                        <li key={j}>{n}</li>
                      ))}
                    </ul>
                    <button className="btn cover-copy" onClick={() => onCopyCover(c.teacher)}>
                      보강 요청 문구 복사
                    </button>
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
              <div className="panel-empty small-empty">이 방식으로는 가능한 교체가 없습니다.</div>
            )}
            {cover && cover.length > 0 && (
              <div className="cover inline">
                <p className="cover-title">교체가 어려운 자리입니다. 보강도 함께 살펴보십시오</p>
                <ul className="cover-list">
                  {cover.slice(0, 3).map((c, i) => (
                    <li key={c.teacher}>
                      <div className="cover-head">
                        <span className="cover-rank">{i + 1}</span>
                        <span className="cover-name">{c.teacher}</span>
                        {c.sameSubject && <span className="cover-badge">같은 과목</span>}
                        <span className="cover-load">주 {c.weeklyLessons}시간</span>
                      </div>
                      <button className="btn cover-copy" onClick={() => onCopyCover(c.teacher)}>
                        보강 요청 문구 복사
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {list.map((c, i) => {
              const best = i === 0 && filter === 'all';
              return (
                // 카드 자체는 초점을 받지 않는다. 초점을 받는 div 는 화면 낭독기가
                // 무엇으로 읽어야 할지 알 수 없다. 안의 단추로 탭하면 초점이 위로
                // 올라오므로 onFocus 만으로 키보드 미리보기가 된다.
                // 손가락으로 쓰는 화면에는 마우스 올림이 없어 눌러도 뜨게 둔다.
                <div
                  key={c.title + i}
                  className={`cand${hovered === c ? ' hover' : ''}${best ? ' top' : ''}`}
                  onMouseEnter={() => onHover(c)}
                  onFocus={() => onHover(c)}
                  onClick={() => onHover(c)}
                >
                  <div className="cand-head">
                    <span className="cand-rank">{i + 1}</span>
                    <span className="cand-type">{TYPE_LABEL[c.type]}</span>
                    {best && <span className="cand-best">가장 무난함</span>}
                    <span className="cand-title">{c.title}</span>
                  </div>
                  <ul className="cand-trace">
                    {c.trace.map((t, j) => (
                      <li
                        key={j}
                        className={t.kind === '조건' ? 'ok' : t.kind === '감점' ? 'minus' : 'plus'}
                      >
                        {t.text}
                      </li>
                    ))}
                  </ul>
                  <div className="cand-foot">
                    <button className="btn primary" onClick={() => onApply(c)}>
                      이 방법으로 반영
                    </button>
                    <button className="btn" onClick={() => onCopy(c)}>
                      요청 문구 복사
                    </button>
                    <span className="cand-score">
                      {c.unitCount !== undefined && c.unitCount !== c.changes.length
                        ? `묶음 ${c.unitCount}개, 수업 ${c.changes.length}개`
                        : `수업 ${c.changes.length}개`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}
