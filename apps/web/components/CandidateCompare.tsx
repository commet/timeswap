'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Candidate, ScheduleConfig } from '@timeswap/engine';
import type { RequestReason } from '../lib/request-workflow';

const TYPE_LABEL: Record<Candidate['type'], string> = {
  move: '빈 시간 이동',
  swap2: '맞바꾸기',
  cycle3: '연쇄 교체',
};

function helperNames(candidate: Candidate, owner: string): string {
  const names = [...new Set(candidate.changes.map((change) => change.from.teacher))]
    .filter((name) => name !== owner);
  return names.length > 0 ? names.join(', ') : '협조 교사 없음';
}

export function CandidateCompare({
  candidates,
  cfg,
  owner,
  defaultDate,
  onPreview,
  onRequest,
}: {
  candidates: Candidate[];
  cfg: ScheduleConfig;
  owner: string;
  defaultDate: string;
  onPreview: (candidate: Candidate | null) => void;
  onRequest: (candidate: Candidate, date: string, reason: RequestReason, note: string, alternatives: Candidate[]) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [date, setDate] = useState(defaultDate);
  const [reason, setReason] = useState<RequestReason>('업무상 부재');
  const [note, setNote] = useState('');
  const [showAll, setShowAll] = useState(false);
  const selected = candidates[selectedIndex] ?? null;

  useEffect(() => {
    setSelectedIndex(0);
    setDate(defaultDate);
    setShowAll(false);
  }, [candidates, defaultDate]);

  useEffect(() => {
    onPreview(selected);
    return () => onPreview(null);
  }, [selected, onPreview]);

  const details = useMemo(() => selected?.trace ?? [], [selected]);
  if (!selected) return null;

  return (
    <div className="candidate-compare">
      <div className="compare-head">
        <div>
          <span className="eyebrow">가능한 방법 {candidates.length}개</span>
          <h3>설명 대신 차이를 비교하세요</h3>
        </div>
        <span className="compare-hint">행을 고르면 시간표가 바뀔 자리를 보여 줍니다</span>
      </div>

      <div className="compare-table" aria-label="교체 후보 비교">
        <div className="compare-columns" aria-hidden>
          <span>방법</span><span>협조</span><span>변경</span><span>영향</span>
        </div>
        {candidates.slice(0, showAll ? 12 : 5).map((candidate, index) => {
          const impact = candidate.trace.find((trace) => trace.kind === '감점')?.text ?? '추가 부담이 적습니다';
          return (
            <button
              key={[candidate.type, candidate.title, index].join('-')}
              className={'cand compare-row' + (index === selectedIndex ? ' selected' : '')}
              aria-pressed={index === selectedIndex}
              onClick={() => setSelectedIndex(index)}
              onMouseEnter={() => onPreview(candidate)}
              onFocus={() => onPreview(candidate)}
            >
              <span className="compare-method">
                <i>{index === 0 ? '추천' : index + 1}</i>
                <b>{TYPE_LABEL[candidate.type]}</b>
                <small>{candidate.title}</small>
              </span>
              <span>{helperNames(candidate, owner)}</span>
              <span>{candidate.unitCount ?? candidate.changes.length}개 수업</span>
              <span>{impact}</span>
            </button>
          );
        })}
      </div>
      {candidates.length > 5 && (
        <button className="compare-more" onClick={() => setShowAll((current) => !current)}>
          {showAll ? '상위 5개만 보기' : '나머지 ' + (Math.min(candidates.length, 12) - 5) + '개 더 보기'}
        </button>
      )}

      <div className="compare-detail">
        <div className="route-summary">
          <span className="eyebrow">선택한 교체 경로</span>
          <strong>{selected.title}</strong>
          <ol>
            {selected.changes.map((change, index) => (
              <li key={[change.from.teacher, change.from.slot, index].join('-')}>
                <b>{change.from.teacher}</b>
                <span>{change.from.klass} {change.from.subject}</span>
                <em>
                  {Math.floor(change.toSlot / cfg.periods) === Math.floor(change.from.slot / cfg.periods)
                    ? '같은 날 이동'
                    : '다른 날 이동'}
                </em>
              </li>
            ))}
          </ol>
          <ul className="compare-reasons">
            {details.map((trace, index) => (
              <li key={trace.text + index} className={trace.kind === '감점' ? 'minus' : 'plus'}>
                {trace.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="request-fields">
          <label>
            <span>변경 날짜</span>
            <input className="input" type="date" min={defaultDate} value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            <span>업무상 사유</span>
            <select className="select" value={reason} onChange={(event) => setReason(event.target.value as RequestReason)}>
              <option>업무상 부재</option>
              <option>연수·출장</option>
              <option>기타</option>
            </select>
          </label>
          <label className="request-note">
            <span>담당자에게 남길 말 <small>선택</small></span>
            <input
              className="input"
              value={note}
              maxLength={80}
              placeholder="시간 조정에 꼭 필요한 내용만 적어 주세요"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <button
            className="btn primary request-submit"
            disabled={!date}
            onClick={() => onRequest(selected, date, reason, note, candidates)}
          >
            이 안으로 요청
          </button>
        </div>
      </div>
    </div>
  );
}
