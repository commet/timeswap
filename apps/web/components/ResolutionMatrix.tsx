'use client';

import { useRef } from 'react';

import {
  crossingForResolution,
  resolutionDetailForRow,
  type ResolutionRow,
} from '../lib/resolution';
import type { WorkspaceState } from '../lib/domain';
import { CrossingCheck } from './CrossingCheck';

const STATUS_LABEL: Record<ResolutionRow['state'], string> = {
  recommended: '추천',
  valid: '유효',
  warning: '주의 필요',
};

export interface ResolutionProgressItem {
  lessonId: string;
  label: string;
  state: '해결' | '주의' | '미해결';
}

export function ResolutionMatrix({
  state,
  rows,
  selectedId,
  onSelect,
  onConfirm,
  progress = [],
  validationMessage,
  atomicMessage,
}: {
  state: WorkspaceState;
  rows: ResolutionRow[];
  selectedId: string | null;
  onSelect(id: string): void;
  onConfirm(row: ResolutionRow): void;
  progress?: ResolutionProgressItem[];
  validationMessage?: string;
  atomicMessage?: string;
}) {
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const radioRefs = useRef<Array<HTMLInputElement | null>>([]);
  const detail = selected ? resolutionDetailForRow(state, selected) : null;

  function moveSelection(index: number, direction: -1 | 1) {
    if (!rows.length) return;
    const next = (index + direction + rows.length) % rows.length;
    onSelect(rows[next]!.id);
    radioRefs.current[next]?.focus();
  }

  if (!selected || !detail) return (
    <section className="resolution-matrix empty" data-resolution-matrix aria-label="해결안 비교">
      <h2>비교할 해결안이 없습니다</h2>
      <p>현재 자료로는 안전한 해결안을 만들 수 없습니다.</p>
      {atomicMessage && <p className="resolution-atomic-note">{atomicMessage}</p>}
    </section>
  );

  return (
    <section className="resolution-matrix" data-resolution-matrix aria-labelledby="resolution-matrix-title">
      <header className="resolution-matrix-head">
        <div>
          <span className="eyebrow">해결안 비교</span>
          <h2 id="resolution-matrix-title">같은 기준으로 해결안을 고르십시오</h2>
        </div>
        <p>{rows.length}개 안을 비교합니다. 행을 선택하면 미리보기가 바뀝니다.</p>
      </header>

      {progress.length > 1 && (
        <ol className="resolution-progress" aria-label="사건 해결 현황">
          {progress.map((item) => <li className={item.state} key={item.lessonId}>
            <span>{item.label}</span><b>{item.state}</b>
          </li>)}
        </ol>
      )}

      {atomicMessage && <p className="resolution-atomic-note">{atomicMessage}</p>}

      <table className="resolution-table">
        <thead>
          <tr>
            <th scope="col">방법</th>
            <th scope="col">협조</th>
            <th scope="col">변경</th>
            <th scope="col">학생 영향</th>
            <th scope="col">부담</th>
            <th scope="col">상태</th>
          </tr>
        </thead>
        <tbody role="radiogroup" aria-label="해결안 선택">
          {rows.map((row, index) => {
            const checked = row.id === selected.id;
            return (
              <tr className={checked ? 'selected' : undefined} key={row.id}>
                <td data-label="방법">
                  <label className="resolution-choice">
                    <input
                      ref={(element) => { radioRefs.current[index] = element; }}
                      type="radio"
                      name="resolution"
                      value={row.id}
                      checked={checked}
                      onChange={() => onSelect(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          moveSelection(index, -1);
                        }
                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          moveSelection(index, 1);
                        }
                        if (event.key === ' ') {
                          event.preventDefault();
                          onSelect(row.id);
                        }
                      }}
                    />
                    <span>{row.method}</span>
                  </label>
                </td>
                <td data-label="협조">{row.collaborators.join(', ')}</td>
                <td data-label="변경">{row.movedUnitCount}개 수업</td>
                <td data-label="학생 영향">{row.studentImpact}</td>
                <td data-label="부담">{row.burden}</td>
                <td data-label="상태"><span className={`resolution-state ${row.state}`}>{STATUS_LABEL[row.state]}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section className="resolution-detail" aria-live="polite" aria-labelledby="resolution-detail-title">
        <div className="resolution-detail-head">
          <span className="eyebrow">선택한 안</span>
          <h3 id="resolution-detail-title">{selected.method} 변경 전과 후</h3>
          <p>{detail.groupedUnitCount}개 수업 단위를 함께 확인합니다.</p>
        </div>
        {/* 왜 되는지를 먼저 보여 준다. 자세한 값은 그 아래에 있다. */}
        <CrossingCheck views={crossingForResolution(state, selected.resolution)} />
        <dl className="resolution-detail-list">
          {detail.changes.map((change) => <div key={change.lessonId}>
            <dt>{change.original.date} {change.original.period}교시</dt>
            <dd>
              <span>{change.original.subject} · {change.original.className} · {change.original.room}</span>
              <b>→</b>
              <span>{change.next.date} {change.next.period}교시 · {change.next.subject} · {change.next.className} · {change.next.room} · {change.next.teacher}</span>
            </dd>
          </div>)}
        </dl>
        <p className="resolution-collaborators"><b>협조</b> {detail.collaborators.join(', ')}</p>
        {detail.warningReasons.length > 0 && (
          <ul className="resolution-warnings">
            {detail.warningReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        {detail.engineScore !== undefined && (
          <section className="resolution-engine-trace" aria-label="엔진 검토 근거">
            <b>엔진 검토 근거</b>
            <p>추천 점수 {detail.engineScore}</p>
            <ul>
              {detail.engineTrace.map((entry, index) => <li key={`${entry.kind}:${index}`}>{entry.text}</li>)}
            </ul>
          </section>
        )}
        {validationMessage && <p className="resolution-validation" role="status">{validationMessage}</p>}
      </section>

      <footer className="resolution-action">
        <button className="btn primary" onClick={() => onConfirm(selected)}>이 해결안 선택</button>
      </footer>
    </section>
  );
}
