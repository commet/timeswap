'use client';

import { useEffect, useState } from 'react';
import type { CoverCandidate } from '@timeswap/engine';
import type { RequestReason } from '../lib/request-workflow';

export function CoverCompare({
  candidates,
  defaultDate,
  onRequest,
}: {
  candidates: CoverCandidate[];
  defaultDate: string;
  onRequest: (candidate: CoverCandidate, date: string, reason: RequestReason, note: string) => void;
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

  if (!selected) return null;
  return (
    <div className="candidate-compare cover-candidates">
      <div className="compare-head">
        <div><span className="eyebrow">교체가 어려운 자리</span><h3>보강 가능한 분을 비교하세요</h3></div>
        <span className="compare-hint">최근 협조와 당일 수업 부담을 함께 봅니다</span>
      </div>
      <div className="compare-table" aria-label="보강 후보 비교">
        <div className="compare-columns cover-columns" aria-hidden>
          <span>교사</span><span>과목</span><span>당일 수업</span><span>최근 협조</span>
        </div>
        {candidates.slice(0, showAll ? 8 : 5).map((candidate, index) => (
          <button
            key={candidate.teacher}
            className={'cand compare-row cover-choice' + (index === selectedIndex ? ' selected' : '')}
            aria-pressed={index === selectedIndex}
            onClick={() => setSelectedIndex(index)}
          >
            <span className="compare-method">
              <i>{index === 0 ? '추천' : index + 1}</i>
              <b>{candidate.teacher} 선생님</b>
              <small>{candidate.notes[0]}</small>
            </span>
            <span>{candidate.sameSubject ? '같은 과목' : '다른 과목'}</span>
            <span>{candidate.dayLessons}시간</span>
            <span>{candidate.recentBurden === 0 ? '없음' : candidate.recentBurden + '회'}</span>
          </button>
        ))}
      </div>
      {candidates.length > 5 && (
        <button className="compare-more" onClick={() => setShowAll((current) => !current)}>
          {showAll ? '상위 5명만 보기' : '나머지 ' + (Math.min(candidates.length, 8) - 5) + '명 더 보기'}
        </button>
      )}
      <div className="compare-detail">
        <div className="route-summary">
          <span className="eyebrow">선택한 보강 후보</span>
          <strong>{selected.teacher} 선생님</strong>
          <ul className="compare-reasons">
            {selected.notes.map((text) => <li key={text}>{text}</li>)}
          </ul>
        </div>
        <div className="request-fields">
          <label><span>변경 날짜</span><input className="input" type="date" min={defaultDate} value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>
            <span>업무상 사유</span>
            <select className="select" value={reason} onChange={(event) => setReason(event.target.value as RequestReason)}>
              <option>업무상 부재</option><option>연수·출장</option><option>기타</option>
            </select>
          </label>
          <label className="request-note">
            <span>담당자에게 남길 말 <small>선택</small></span>
            <input className="input" value={note} maxLength={80} placeholder="보강에 필요한 내용을 적어 주세요" onChange={(event) => setNote(event.target.value)} />
          </label>
          <button className="btn primary request-submit" disabled={!date} onClick={() => onRequest(selected, date, reason, note)}>
            이 분으로 보강 요청
          </button>
        </div>
      </div>
    </div>
  );
}
