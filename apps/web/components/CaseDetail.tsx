'use client';

import { useMemo, useState } from 'react';

import {
  replaceCaseResolution,
  returnCaseForRecomputation,
  transitionCase,
} from '../lib/case-service';
import type { WorkspaceState } from '../lib/domain';
import { projectOpsCommandCenter } from '../lib/ops-command-center';
import { resolutionRowsForLesson } from '../lib/resolution';
import type { SaveResult } from '../lib/repository';

const OPERATOR_ID = 'operator:demo';

function auditId(action: string, caseId: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `audit:ops:${action}:${caseId}:${suffix}`;
}

function resolutionLabel(kind: string): string {
  return ({
    move: '빈 교시 이동', swap2: '맞교환', cycle3: '연쇄 교환', cover: '보강', manual: '수동 처리', unresolved: '미해결',
  } as Record<string, string>)[kind] ?? '해결안';
}

function saveFailureMessage(result: SaveResult): string {
  if (result.ok) return '';
  return result.reason === 'quota'
    ? '저장 공간이 부족해 변경하지 않았습니다. 공간을 확보한 뒤 다시 시도하십시오.'
    : '이 브라우저에 저장할 수 없어 변경하지 않았습니다. 저장 설정을 확인한 뒤 다시 시도하십시오.';
}

export type CaseDetailProps = {
  state: WorkspaceState;
  caseId: string;
  today: string;
  onChange(next: WorkspaceState): SaveResult;
  onBack?(): void;
  onOpenAdministrativeStep?(): void;
};

export function CaseDetail({
  state,
  caseId,
  today,
  onChange,
  onBack,
  onOpenAdministrativeStep,
}: CaseDetailProps) {
  const [rejectReason, setRejectReason] = useState('');
  const [chosenRows, setChosenRows] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const model = useMemo(() => projectOpsCommandCenter(state, today), [state, today]);
  const item = model.cases.find((candidate) => candidate.caseId === caseId);
  const absenceCase = state.cases.find((candidate) => candidate.id === caseId);
  const lessons = useMemo(() => new Map(state.lessons
    .filter((lesson) => lesson.revisionId === state.workspace.activeRevisionId)
    .map((lesson) => [lesson.id, lesson])), [state]);

  if (!item || !absenceCase) return (
    <section className="ops-case-detail empty" aria-live="polite">
      <h2>선택한 사건을 찾을 수 없습니다</h2>
      {onBack && <button className="btn" onClick={onBack}>사건 목록으로</button>}
    </section>
  );

  const commit = (next: WorkspaceState, success: string) => {
    const result = onChange(next);
    setMessage(result.ok ? success : saveFailureMessage(result));
  };

  const chooseRow = (lessonId: string) => {
    const rows = resolutionRowsForLesson(state, caseId, lessonId);
    const currentResolution = absenceCase.resolutionItems.find((resolution) => resolution.lessonId === lessonId);
    return rows.find((row) => row.id === chosenRows[lessonId])
      ?? rows.find((row) => row.id === currentResolution?.id)
      ?? rows[0];
  };

  return (
    <section className="ops-case-detail" aria-labelledby="ops-case-detail-title" data-case-detail={caseId}>
      {onBack && <button className="btn ghost ops-mobile-back" onClick={onBack}>← 사건 목록으로</button>}
      <header>
        <span className="eyebrow">선택한 변경 사건</span>
        <h2 id="ops-case-detail-title" tabIndex={-1}>{item.requesterLabel} · {item.fromDate} {item.fromDate === item.toDate ? '' : `~ ${item.toDate}`}</h2>
        <p>{item.priorityReason}</p>
      </header>

      <dl className="ops-case-facts">
        <div><dt>영향 수업</dt><dd>{item.affectedLessonCount}건</dd></div>
        <div><dt>해결됨</dt><dd>{item.solvedLessonCount}건</dd></div>
        <div><dt>긴급도</dt><dd>{item.priority === 'same-day-unresolved' ? '오늘 처리' : item.priorityReason}</dd></div>
        <div><dt>겹치는 사건</dt><dd>{item.intersectingCaseIds.length ? `${item.intersectingCaseIds.length}건` : '없음'}</dd></div>
      </dl>

      <section className={'ops-plan-validation ' + (item.validation.valid ? 'valid' : 'invalid')} aria-live="polite">
        <b>사건 전체 충돌 검사</b>
        <span>{item.validation.valid
          ? '현재 시간표 기준으로 승인할 수 있습니다.'
          : item.validation.conflicts[0]?.message ?? '승인 전에 해결안을 확인해야 합니다.'}</span>
      </section>

      {item.dataWarnings.length > 0 && (
        <section className="ops-data-warnings" aria-label="자료 주의">
          <b>자료 주의</b>
          <ul>{item.dataWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </section>
      )}

      <section className="ops-resolution-list" aria-label="수업별 선택 해결안">
        <h3>수업별 선택 해결안</h3>
        {absenceCase.lessonIds.map((lessonId) => {
          const lesson = lessons.get(lessonId);
          const rows = resolutionRowsForLesson(state, caseId, lessonId);
          const row = chooseRow(lessonId);
          const cover = rows.find((candidate) => candidate.method === '보강');
          const selected = absenceCase.resolutionItems.find((resolution) => resolution.lessonId === lessonId);
          return (
            <article key={lessonId}>
              <div>
                <b>{lesson ? `${lesson.period}교시 ${lesson.subject}` : '확인할 수업'}</b>
                <span>{selected ? resolutionLabel(selected.kind) : '아직 선택하지 않음'}</span>
              </div>
              {absenceCase.status === 'in_review' && rows.length > 0 ? (
                <div className="ops-resolution-controls">
                  <label>
                    <span>대안</span>
                    <select
                      aria-label={`${lesson?.period ?? ''}교시 대안 선택`}
                      value={row?.id ?? ''}
                      onChange={(event) => setChosenRows((current) => ({ ...current, [lessonId]: event.target.value }))}
                    >
                      {rows.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.method} · {candidate.collaborators.join(', ')}</option>)}
                    </select>
                  </label>
                  <button
                    className="btn ghost"
                    disabled={!row}
                    onClick={() => row && commit(replaceCaseResolution(state, {
                      caseId, resolution: row.resolution, actorId: OPERATOR_ID,
                      at: new Date().toISOString(), auditEventId: auditId('resolution', caseId),
                    }), '선택한 대안을 감사 기록과 함께 저장했습니다.')}
                  >대안 적용</button>
                  {cover && (
                    <button
                      className="btn ghost"
                      onClick={() => commit(replaceCaseResolution(state, {
                        caseId, resolution: cover.resolution, actorId: OPERATOR_ID,
                        at: new Date().toISOString(), auditEventId: auditId('cover', caseId),
                      }), '보강 해결안을 감사 기록과 함께 저장했습니다.')}
                    >보강으로 바꾸기</button>
                  )}
                </div>
              ) : selected ? <small>{selected.changes.length}개 수업 변경</small> : <small>후보 재계산이 필요합니다.</small>}
            </article>
          );
        })}
      </section>

      <section className="ops-accountable-actions" aria-label="담당자 결정">
        <h3>담당자 결정</h3>
        {absenceCase.status === 'submitted' && (
          <button className="btn primary" onClick={() => commit(transitionCase(state, {
            caseId, to: 'in_review', actorId: OPERATOR_ID,
            at: new Date().toISOString(), auditEventId: auditId('review', caseId),
          }), '검토를 시작했습니다.')}>검토 시작</button>
        )}
        {absenceCase.status === 'in_review' && (
          <>
            <button
              className="btn primary"
              disabled={!item.validation.valid}
              onClick={() => commit(transitionCase(state, {
                caseId, to: 'resolution_approved', actorId: OPERATOR_ID,
                at: new Date().toISOString(), auditEventId: auditId('approve', caseId),
              }), '해결안을 승인했습니다. 게시 전 행정 마감이 남아 있습니다.')}
            >해결안 승인</button>
            <label className="ops-reject-reason">
              <span>반려 사유</span>
              <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="다시 조정해야 하는 이유" />
            </label>
            <button
              className="btn"
              disabled={!rejectReason.trim()}
              onClick={() => commit(transitionCase(state, {
                caseId, to: 'rejected', rejectionNote: rejectReason, actorId: OPERATOR_ID,
                at: new Date().toISOString(), auditEventId: auditId('reject', caseId),
              }), '반려 사유를 남기고 사건을 종료했습니다.')}
            >사유와 함께 반려</button>
            <button
              className="btn ghost"
              onClick={() => commit(returnCaseForRecomputation(state, {
                caseId, actorId: OPERATOR_ID,
                at: new Date().toISOString(), auditEventId: auditId('recompute', caseId),
              }), '현재 해결안을 지우고 재계산이 필요하다고 기록했습니다.')}
            >재계산으로 돌려보내기</button>
          </>
        )}
        {(absenceCase.status === 'resolution_approved' || absenceCase.status === 'admin_in_progress' || absenceCase.status === 'ready_to_publish') && (
          <button className="btn primary" onClick={onOpenAdministrativeStep}>행정 마감 현황</button>
        )}
        {message && <p className="ops-action-message" role="status">{message}</p>}
      </section>
    </section>
  );
}
