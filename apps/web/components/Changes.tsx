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
  onUndoLast,
  onPrint,
}: {
  cfg: ScheduleConfig;
  entries: AppliedEntry[];
  onUndoLast: () => void;
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
          <div className="chg-foot">
            <button className="btn" onClick={onPrint}>
              수업 교체 계획서 인쇄
            </button>
          </div>
        </>
      )}
    </section>
  );
}
