'use client';

import type { TeacherCaseView } from '../lib/projections';

/**
 * 교사가 자기 요청을 보는 목록.
 *
 * 이 화면이 없었다. 제출하면 "요청을 제출했습니다"가 한 번 뜨고 끝이라, 승인됐는지
 * 반려됐는지 알 길이 없었다. 반려 사유는 일과 담당이 반드시 적어야 하는 값인데
 * (안 적으면 반려 자체가 안 된다) 그것을 읽는 화면이 어디에도 없었다.
 */
export function TeacherRequestList({
  cases,
  onWithdraw,
  message,
}: {
  cases: TeacherCaseView[];
  onWithdraw: (caseId: string) => void;
  message?: string;
}) {
  if (cases.length === 0) return null;
  return (
    <section className="request-status-list" aria-labelledby="my-requests-title">
      <div className="section-heading">
        <span className="eyebrow">내 변경 요청</span>
        <h2 id="my-requests-title">낸 요청과 진행 상태</h2>
      </div>
      <div className="status-rows">
        {cases.map((item) => (
          <article key={item.caseId} data-teacher-case={item.caseId}>
            <time>{item.fromDate === item.toDate
              ? item.fromDate
              : `${item.fromDate} ~ ${item.toDate}`}</time>
            <div>
              <b>{item.reason} · 수업 {item.lessonCount}건</b>
              {item.rejectionNote
                ? <span className="request-reject-note">반려 사유: {item.rejectionNote}</span>
                : item.note ? <span>{item.note}</span> : null}
            </div>
            <strong className={`status-pill ${item.status}`}>{item.statusLabel}</strong>
            {item.withdrawable
              ? (
                <button className="btn ghost" onClick={() => onWithdraw(item.caseId)}>
                  요청 취소
                </button>
              )
              : <span />}
          </article>
        ))}
      </div>
      {message && <p className="ops-action-message" role="status">{message}</p>}
    </section>
  );
}
