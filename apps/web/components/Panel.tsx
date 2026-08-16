'use client';

import { slotName, type Candidate, type RecommendResult, type ScheduleConfig } from '@timeswap/engine';

const TYPE_LABEL: Record<Candidate['type'], string> = {
  move: '빈 교시 이동',
  swap2: '맞교환',
  cycle3: '3자 순환',
};

export function Panel({
  cfg,
  result,
  hovered,
  onHover,
  onCopy,
}: {
  cfg: ScheduleConfig;
  result: RecommendResult | null;
  hovered: Candidate | null;
  onHover: (c: Candidate | null) => void;
  onCopy: (c: Candidate) => void;
}) {
  return (
    <aside className="card panel panel-wrap" aria-label="교환 추천">
      <div className="card-head">
        <h2>교환 추천</h2>
        {result && (
          <span className="sub">
            {result.target.klass} {result.target.subject}, {slotName(result.target.slot, cfg)}
          </span>
        )}
      </div>
      {!result ? (
        <div className="panel-empty">
          격자에서 <b>못 들어가는 수업 칸</b>을 누르면
          <br />
          성립하는 교환안을 이 자리에서 제시합니다.
        </div>
      ) : result.candidates.length === 0 ? (
        <div className="panel-empty">
          <b>성립하는 교환안이 없습니다.</b>
          <br />
          {result.notes.length > 0 ? result.notes.join(' ') : '보강 배정을 검토하십시오.'}
        </div>
      ) : (
        <div className="panel-body" onMouseLeave={() => onHover(null)}>
          {result.candidates.map((c, i) => (
            <div
              key={c.title + i}
              className={`cand${hovered === c ? ' hover' : ''}`}
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
                <button className="btn primary" onClick={() => onCopy(c)}>
                  요청 문구 복사
                </button>
                <span className="cand-score">수업 {c.changes.length}개 이동</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
