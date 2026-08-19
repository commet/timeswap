'use client';

import type {
  Assignment,
  Candidate,
  CoverCandidate,
  RecommendResult,
  ScheduleConfig,
} from '@timeswap/engine';
import { slotName } from '@timeswap/engine';
import type { RequestReason } from '../lib/request-workflow';

export function Panel({
  cfg,
  result,
  queueLen,
  cover,
  peers,
  electiveGrade,
  grouped,
  defaultDate,
  owner,
  onGroup,
  onUngroup,
  onHover,
  onCopyCover,
  onApplyCover,
  onCoverRequest,
  onRequest,
  onSkip,
  onClear,
}: {
  cfg: ScheduleConfig;
  result: RecommendResult | null;
  queueLen: number;
  cover: CoverCandidate[] | null;
  hovered: Candidate | null;
  peers: Assignment[];
  electiveGrade: {
    grade: number;
    klasses: number;
    subjects: number;
    sharedRate: number;
    kind: '보통' | '선택과목' | '전공실습';
  } | null;
  grouped: boolean;
  defaultDate: string;
  owner: string;
  onGroup: () => void;
  onUngroup: () => void;
  onHover: (candidate: Candidate | null) => void;
  onCopy: (candidate: Candidate) => void;
  onCopyCover: (teacher: string) => void;
  onApplyCover: (teacher: string) => void;
  onApply: (candidate: Candidate) => void;
  onRequest: (candidate: Candidate, date: string, reason: RequestReason, note: string, alternatives: Candidate[]) => void;
  onCoverRequest: (candidate: CoverCandidate, date: string, reason: RequestReason, note: string) => void;
  onSkip: () => void;
  onClear: () => void;
}) {
  const hasChange = (result?.candidates.length ?? 0) > 0;
  const hasCover = (cover?.length ?? 0) > 0;
  return (
    <aside className="panel" aria-label="교체 방법">
      <div className="panel-titlebar">
        <div>
          <span className="eyebrow">변경 요청</span>
          <h2>
            {result
              ? result.target.klass + ' ' + result.target.subject
              : '주간 시간표에서 수업을 고르세요'}
          </h2>
          {result && <p>{slotName(result.target.slot, cfg)} 수업의 가능한 방법입니다.</p>}
        </div>
        {result && (
          <div className="panel-title-actions">
            {queueLen > 1 && <button className="btn ghost" onClick={onSkip}>다음 결강</button>}
            <button className="btn ghost" onClick={onClear}>다른 수업</button>
          </div>
        )}
      </div>

      {!result && (
        <div className="panel-empty">
          <span className="empty-cursor" aria-hidden>↖</span>
          <b>변경이 필요한 수업을 누르세요</b>
          <span>하루 전체라면 요일 이름을 누르면 됩니다.</span>
        </div>
      )}

      {result && electiveGrade && (
        <div className="context-note">
          <b>{electiveGrade.grade}학년 {electiveGrade.kind === '전공실습' ? '전공 편성' : '선택과목 구간'}</b>
          <span>
            한 과목을 함께 듣는 학급이 학년 {electiveGrade.klasses}개 가운데 평균{' '}
            {Math.max(1, Math.round(electiveGrade.sharedRate * electiveGrade.klasses))}개입니다.
            교체 상대가 적어 교체보다 보강이 현실적인 자리일 수 있습니다.
          </span>
        </div>
      )}

      {result && peers.length > 0 && !grouped && (
        <div className="context-note action">
          <span>같은 시간에 같은 과목을 듣는 학급이 있습니다. 함께 움직이는 수업입니까?</span>
          <button className="btn" onClick={onGroup}>함께 묶기</button>
        </div>
      )}
      {result && grouped && (
        <div className="context-note action">
          <span>이 수업들을 한 묶음으로 비교하고 있습니다.</span>
          <button className="btn ghost" onClick={onUngroup}>묶음 해제</button>
        </div>
      )}

      {result && (hasChange || hasCover) && (
        <div className="panel-empty" role="status">
          <b>이전 비교 화면은 종료했습니다</b>
          <span>교사 초대 링크에서 시간표 기반 해결안 비교를 사용하십시오.</span>
        </div>
      )}

      {result && !hasChange && !hasCover && (
        <div className="panel-empty"><b>지금 조건에서는 가능한 변경이 없습니다</b><span>근무 불가 시간과 묶음 수업을 확인해 주세요.</span></div>
      )}
    </aside>
  );
}
