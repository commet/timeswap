'use client';

import type { ScheduleConfig } from '@timeswap/engine';
import type { AppliedEntry } from '../lib/app';

const TYPE_LABEL: Record<AppliedEntry['type'], string> = {
  move: '빈 시간으로 이동',
  swap2: '맞바꾸기',
  cycle3: '연쇄 교체',
};

export function Changes({
  entries,
  helpers,
  onUndoLast,
  onUndoAll,
  onCopyNotice,
  onCopyNeisList,
  onPrint,
}: {
  cfg: ScheduleConfig;
  entries: AppliedEntry[];
  /** 자리를 내어 준 교사와 횟수. 부담 균형의 근거로 보여 준다. */
  helpers: Array<{ name: string; n: number }>;
  onUndoLast: () => void;
  onUndoAll: () => void;
  onCopyNotice: () => void;
  onCopyNeisList: () => void;
  onPrint: () => void;
}) {
  return (
    <section className="card changes" aria-label="반영한 변경">
      <div className="card-head">
        <h2>반영한 변경</h2>
        <span className="sub">{entries.length === 0 ? '없음' : `${entries.length}건 반영`}</span>
      </div>
      {entries.length === 0 ? (
        <div className="panel-empty small-empty">
          교체 방법을 선택해 <b>반영</b>하면
          <br />
          이곳에 기록됩니다.
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
              협조해 주신 분: {helpers.map((h) => `${h.name} ${h.n}회`).join(', ')}
              <span className="chg-helpers-hint">같은 분께 부담이 몰리지 않도록 순서에 반영합니다</span>
            </p>
          )}
          <div className="chg-foot">
            <button className="btn" onClick={onCopyNotice}>
              변경 공지 복사
            </button>
            <button className="btn" onClick={onCopyNeisList}>
              나이스 입력 목록
            </button>
            <button className="btn" onClick={onPrint}>
              교체 계획서 인쇄
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
