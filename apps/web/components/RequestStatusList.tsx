'use client';

import type { ScheduleConfig } from '@timeswap/engine';
import { slotName } from '@timeswap/engine';
import type { ChangeRequest } from '../lib/request-workflow';
import { requestStatusLabel } from '../lib/request-workflow';

export function RequestStatusList({
  requests,
  cfg,
  onCancel,
}: {
  requests: ChangeRequest[];
  cfg: ScheduleConfig;
  onCancel: (id: string) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <section className="request-status-list" aria-labelledby="my-requests-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">내 변경 요청</span>
          <h2 id="my-requests-title" tabIndex={-1}>담당자가 확인할 내용을 한눈에 봅니다</h2>
        </div>
      </div>
      <div className="status-rows">
        {requests.map((request) => (
          <article key={request.id}>
            <time>{request.date}</time>
            <div>
              <b>{request.target.klass} {request.target.subject}</b>
              <span>{slotName(request.target.slot, cfg)} · {request.candidate.title}</span>
            </div>
            <strong className={'status-pill ' + request.status}>{requestStatusLabel(request.status)}</strong>
            {request.status === 'pending' && (
              <button className="btn ghost" onClick={() => onCancel(request.id)}>요청 취소</button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
