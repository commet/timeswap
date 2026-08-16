'use client';

import type { ScheduleConfig } from '@timeswap/engine';
import type { AppliedEntry } from '../lib/app';

const TYPE_LABEL: Record<AppliedEntry['type'], string> = {
  move: '빈 시간 옮기기',
  swap2: '맞바꾸기',
  cycle3: '연쇄 교환',
};

export function Changes({
  entries,
  helpers,
  onUndoLast,
  onUndoAll,
  onCopyNotice,
  onPrint,
}: {
  cfg: ScheduleConfig;
  entries: AppliedEntry[];
  /** 자리를 내어 준 교사와 횟수. 품앗이 균형의 근거를 보여준다. */
  helpers: Array<{ name: string; n: number }>;
  onUndoLast: () => void;
  onUndoAll: () => void;
  onCopyNotice: () => void;
  onPrint: () => void;
}) {
  return (
    <section className="card changes" aria-label="오늘의 변경">
      <div className="card-head">
        <h2>오늘의 변경</h2>
        <span className="sub">{entries.length === 0 ? '아직 없음' : `${entries.length}건 반영`}</span>
      </div>
      {entries.length === 0 ? (
        <div className="panel-empty small-empty">
          추천안에서 <b>이 방법으로 바꾸기</b>를 누르면
          <br />
          여기에 기록되고 시간표에 반영됩니다.
        </div>
      ) : (
        <>
          <ol className="chg-list">
            {entries.map((e, i) => (
              <li key={e.id}>
                <span className="chg-no">{i + 1}</span>
                <span className="chg-type">{TYPE_LABEL[e.type]}</span>
                <span className="chg-title">{e.title}</span>
                {i === entries.length - 1 && (
                  <button className="btn ghost chg-undo" onClick={onUndoLast}>
                    되돌리기
                  </button>
                )}
              </li>
            ))}
          </ol>
          {helpers.length > 0 && (
            <p className="chg-helpers">
              품앗이 기록: {helpers.map((h) => `${h.name} ${h.n}회`).join(', ')}
              <span className="chg-helpers-hint">여러 번 도와준 분은 다음 추천에서 뒤로 밀립니다</span>
            </p>
          )}
          <div className="chg-foot">
            <button className="btn" onClick={onCopyNotice}>
              변경 공지 복사
            </button>
            <button className="btn" onClick={onPrint}>
              수업 교체 계획서 인쇄
            </button>
            <button className="btn ghost" onClick={onUndoAll}>
              전체 되돌리기
            </button>
          </div>
        </>
      )}
    </section>
  );
}
