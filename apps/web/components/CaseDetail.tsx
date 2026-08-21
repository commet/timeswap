'use client';

import { useMemo, useState } from 'react';

import {
  createPrototypeAdminTasks,
  replaceCaseResolution,
  returnCaseForRecomputation,
  transitionCase,
} from '../lib/case-service';
import type { Lesson, WorkspaceState } from '../lib/domain';
import { caseRevisionId, effectiveLessons } from '../lib/projections';
import { projectOpsCommandCenter } from '../lib/ops-command-center';
import { crossingForResolution, resolutionRowsForLesson } from '../lib/resolution';
import { CrossingCheck } from './CrossingCheck';
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

/**
 * Approval and the administrative closure it creates are one decision, so the
 * tasks are generated in the same save.  A case can never sit approved with no
 * work attached to it.
 */
function approveWithAdministrativeTasks(
  approved: WorkspaceState,
  caseId: string,
  at: string,
): WorkspaceState {
  const suffix = auditId('tasks', caseId);
  return createPrototypeAdminTasks(approved, {
    caseId,
    actorId: OPERATOR_ID,
    at,
    auditEventId: `${suffix}:transition`,
    taskAuditEventId: `${suffix}:created`,
    taskIds: {
      neis: `task:neis:${suffix}`,
      teacher_notice: `task:teacher_notice:${suffix}`,
      class_publication: `task:class_publication:${suffix}`,
      internal_document: `task:internal_document:${suffix}`,
    },
  });
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
  /*
   * 그 사건의 주를, 게시된 변경을 얹은 채로 본다.
   *
   * 활성 개정판으로 거르면 주가 넘어간 뒤 지난주 사건의 수업이 하나도 안 잡혀 "확인할
   * 수업"만 늘어선다. 원래 표로 보면 게시로 옮겨 간 수업의 교시를 옛 교시로 적는다.
   */
  const lessons = useMemo(() => {
    if (!absenceCase) return new Map<string, Lesson>();
    return new Map(effectiveLessons(state, caseRevisionId(state, absenceCase))
      .map((lesson) => [lesson.id, lesson]));
  }, [state, absenceCase]);
  /*
   * 결강마다 후보를 한 번만 센다.
   *
   * 예전에는 목록을 그리면서 한 번, `chooseRow` 에서 또 한 번 불렀고 그리기마다 다시
   * 셌다. 결강 열여섯 건인 학교(안양예술고)에서 한 건이 240ms 라 그리기 한 번에
   * 7초 넘게 화면이 멎었다. 사유를 한 글자 칠 때마다 그만큼 멎는다.
   *
   * 이제 상태가 바뀔 때만 센다. 열여섯 건이면 4초에서 한 번으로 줄고, 글자를 칠 때는
   * 다시 세지 않는다.
   */
  const rowsByLesson = useMemo(
    () => new Map((absenceCase?.lessonIds ?? []).map((lessonId) =>
      [lessonId, resolutionRowsForLesson(state, caseId, lessonId)])),
    [state, caseId, absenceCase?.lessonIds],
  );

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
    const rows = rowsByLesson.get(lessonId) ?? [];
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
        <h2 id="ops-case-detail-title" tabIndex={-1}>{item.requesterLabel} {item.fromDate} {item.fromDate === item.toDate ? '' : `~ ${item.toDate}`}</h2>
        <p>{item.priorityReason}</p>
      </header>

      {/*
        * 네 값을 담으려고 2×2 표를 만들었다. 그중 "긴급도"는 문장이라 칸 안에서 줄이
        * 바뀌었고, "겹치는 사건 없음"은 없다는 사실에 칸 하나를 썼다. 셀 것은 세고,
        * 없는 것은 안 적는다.
        */}
      <p className="ops-case-facts">
        <span>영향 수업 <b className="num">{item.affectedLessonCount}</b></span>
        <span>해결됨 <b className="num">{item.solvedLessonCount}</b></span>
        {item.intersectingCaseIds.length > 0 && (
          <span className="mark">겹치는 사건 <b className="num">{item.intersectingCaseIds.length}</b></span>
        )}
      </p>

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
          const rows = rowsByLesson.get(lessonId) ?? [];
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
                    <span>다른 대안으로 바꾸기</span>
                    <select
                      aria-label={`${lesson?.period ?? ''}교시를 다른 대안으로 바꾸기`}
                      value={row?.id ?? ''}
                      onChange={(event) => setChosenRows((current) => ({ ...current, [lessonId]: event.target.value }))}
                    >
                      {rows.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.method} | {candidate.collaborators.join(', ')}</option>)}
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
                  {/*
                    * 고른 안이 왜 되는지 보여 준다. 목록에서 이름만 고르고 승인하면
                    * 무엇을 승인하는지 모른 채 누르는 것이 된다.
                    */}
                  {row && <CrossingCheck views={crossingForResolution(state, row.resolution)} />}
                </div>
              ) : selected ? <small>{selected.changes.length}개 수업 변경</small> : (
                <small className="ops-no-candidate">
                  {absenceCase.status === 'in_review'
                    ? `${item.validation.conflicts.find((conflict) => conflict.lessonId === lessonId)?.message
                        ?? '지금 시간표에서 옮길 자리를 찾지 못했습니다.'} 이 수업으로는 계획을 세울 수 없으니 사유와 함께 반려하십시오.`
                    : '후보 재계산이 필요합니다.'}
                </small>
              )}
            </article>
          );
        })}
      </section>

      <section className="ops-accountable-actions" aria-label="담당자 결정">
        <h3>담당자 결정</h3>
        {/* 정정 사건은 담당자가 직접 연 것이라 제출을 기다릴 상대가 없다.
            교사의 미제출 초안에는 이 길을 열지 않는다. */}
        {absenceCase.status === 'draft' && absenceCase.supersedesCaseId && (
          <button className="btn primary" data-start-correction-review onClick={() => {
            const at = new Date().toISOString();
            const submitted = transitionCase(state, {
              caseId, to: 'submitted', actorId: OPERATOR_ID,
              at, auditEventId: auditId('correction-submit', caseId),
            });
            commit(transitionCase(submitted, {
              caseId, to: 'in_review', actorId: OPERATOR_ID,
              at, auditEventId: auditId('correction-review', caseId),
            }), '정정 사건 검토를 시작했습니다. 새 해결안을 선택하십시오.');
          }}>정정 검토 시작</button>
        )}
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
              onClick={() => {
                const at = new Date().toISOString();
                const approved = transitionCase(state, {
                  caseId, to: 'resolution_approved', actorId: OPERATOR_ID,
                  at, auditEventId: auditId('approve', caseId),
                });
                commit(
                  approveWithAdministrativeTasks(approved, caseId, at),
                  '해결안을 승인했습니다. 게시 전 행정 마감이 남아 있습니다.',
                );
                onOpenAdministrativeStep?.();
              }}
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
