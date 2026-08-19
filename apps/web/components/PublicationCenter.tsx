'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { ChangePulse, type ChangePulseDestination } from './ChangePulse';
import { completeAdminTask, createCorrectionCase } from '../lib/case-service';
import type { AdminTaskKind, WorkspaceState } from '../lib/domain';
import { projectPublicationCenter } from '../lib/publication-center';
import { publishCase, publishedTimeLabel } from '../lib/publication';
import type { SaveResult } from '../lib/repository';

const OPERATOR_ID = 'operator:demo';

function auditId(action: string, caseId: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `audit:publication:${action}:${caseId}:${suffix}`;
}

/** The class key is a stable identity tuple, not something to show as is. */
function classKeyLabel(classKey: string): string {
  try {
    const parts: unknown = JSON.parse(classKey);
    if (!Array.isArray(parts) || parts.length < 7) return '해당 학급';
    return `${String(parts[5])}학년 ${String(parts[6])}반`;
  } catch {
    return '해당 학급';
  }
}

function saveFailureMessage(result: SaveResult): string {
  if (result.ok) return '';
  return result.reason === 'quota'
    ? '저장 공간이 부족해 기록하지 않았습니다. 아래 진단 보고서를 내보내 공간을 확보한 뒤 다시 시도하십시오.'
    : '이 브라우저에 기록할 수 없어 변경하지 않았습니다. 아래 진단 보고서를 내보낸 뒤 저장 설정을 확인하십시오.';
}

export type PublicationCenterProps = {
  state: WorkspaceState;
  caseId: string;
  onChange(next: WorkspaceState): SaveResult;
  onBackToCase(): void;
  onBackToList(): void;
  onExportDiagnostic(): void;
  onOpenClassTimetable(grade: string, className: string): void;
  onOpenCase(caseId: string): void;
};

export function PublicationCenter({
  state,
  caseId,
  onChange,
  onBackToCase,
  onBackToList,
  onExportDiagnostic,
  onOpenClassTimetable,
  onOpenCase,
}: PublicationCenterProps) {
  const [message, setMessage] = useState('');
  const [needsExport, setNeedsExport] = useState(false);
  const [fallbackText, setFallbackText] = useState<Record<string, string>>({});
  const [pulse, setPulse] = useState<ChangePulseDestination[] | null>(null);
  const resultRef = useRef<HTMLParagraphElement | null>(null);

  /**
   * 게시하면 눌렀던 단추가 사라진다. 초점을 그대로 두면 본문 바깥으로 떨어져
   * 키보드로 온 사람이 길을 잃는다. 방금 생긴 결과 문장으로 초점을 옮긴다.
   */
  useEffect(() => {
    if (pulse) resultRef.current?.focus();
  }, [pulse]);
  const view = useMemo(() => projectPublicationCenter(state, caseId), [state, caseId]);

  const commit = (next: WorkspaceState, success: string): boolean => {
    const result = onChange(next);
    if (result.ok) {
      setMessage(success);
      setNeedsExport(false);
      return true;
    }
    setMessage(saveFailureMessage(result));
    setNeedsExport(true);
    return false;
  };

  const completeTask = (taskId: string, label: string): boolean => commit(
    completeAdminTask(state, {
      taskId,
      actorId: OPERATOR_ID,
      at: new Date().toISOString(),
      auditEventId: auditId('task', caseId),
    }),
    `${label}을 완료로 기록했습니다.`,
  );

  /**
   * A denied clipboard must not look like a finished task.  The text stays on
   * screen and selectable, and the task is only completed by the copy that
   * actually succeeded or by the operator saying so.
   */
  const copyThenComplete = (
    kind: AdminTaskKind,
    taskId: string,
    label: string,
    text: string,
  ): void => {
    const offerFallback = () => {
      setFallbackText((current) => ({ ...current, [kind]: text }));
      setMessage(`클립보드를 쓸 수 없습니다. ${label} 문구를 직접 선택해 복사한 뒤 완료로 표시하십시오.`);
    };
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      offerFallback();
      return;
    }
    navigator.clipboard.writeText(text)
      .then(() => { completeTask(taskId, label); })
      .catch(offerFallback);
  };


  /**
   * 잘못 나간 게시는 지우지 않는다. 원본을 대체하는 새 사건을 열어 다시 결정하고,
   * 두 기록을 모두 감사 이력에 남긴다.
   */
  const startCorrection = () => {
    const at = new Date().toISOString();
    const correctionId = `${caseId}:correction:${at}`;
    let next: WorkspaceState;
    try {
      next = createCorrectionCase(state, {
        sourceCaseId: caseId,
        id: correctionId,
        actorId: OPERATOR_ID,
        at,
        auditEventId: auditId('correction', caseId),
      });
    } catch {
      setMessage('이 사건에서는 정정을 시작할 수 없습니다. 게시된 사건만 정정할 수 있습니다.');
      return;
    }
    if (commit(next, '정정 사건을 열었습니다. 새 해결안을 선택한 뒤 다시 게시하십시오.')) {
      onOpenCase(correctionId);
    }
  };

  const publish = () => {
    let next: WorkspaceState;
    try {
      next = publishCase(state, caseId, OPERATOR_ID, new Date().toISOString());
    } catch {
      setMessage('지금 상태로는 게시할 수 없습니다. 남은 과업과 충돌 검사를 확인한 뒤 다시 시도하십시오.');
      return;
    }
    if (!commit(next, '게시했습니다. 교사 시간표와 학급 시간표에 반영했습니다.')) return;
    setPulse([
      { id: 'case', label: '변경 사건', detail: `${view.changedLessonCount}개 수업 확정` },
      { id: 'teacher', label: '교사 시간표', detail: view.affectedTeacherLabels.join(', ') || '담당 교사' },
      { id: 'class', label: '학급 시간표', detail: view.affectedClassLabels.join(', ') || '해당 학급' },
    ]);
  };

  return (
    <section className="publication-center" aria-labelledby="publication-title" data-publication-center={caseId}>
      <button className="btn ghost ops-mobile-back" onClick={onBackToList}>← 사건 목록으로</button>
      <header>
        <span className="eyebrow">행정 마감과 게시</span>
        <h3 id="publication-title" tabIndex={-1}>{view.requesterLabel} 사건 마감</h3>
        <p data-publication-stage={view.stage}>{view.stageLabel}</p>
        {view.supersedesCaseId && <p className="publication-correction">이전 게시를 대체하는 정정 사건입니다.</p>}
      </header>

      <dl className="publication-facts">
        <div><dt>승인</dt><dd>{view.approved ? '완료' : '대기'}</dd></div>
        <div><dt>게시</dt><dd>{view.stage === 'published' ? '완료' : '대기'}</dd></div>
        <div><dt>변경 수업</dt><dd>{view.changedLessonCount}건</dd></div>
        <div><dt>영향 학급</dt><dd>{view.affectedClassLabels.join(', ') || '없음'}</dd></div>
      </dl>

      <ol className="publication-tasks" aria-label="행정 과업">
        {view.tasks.map((task) => (
          <li key={task.id} className={task.completed ? 'done' : ''} data-publication-task={task.kind}>
            <div className="publication-task-head">
              <b>{task.label}</b>
              <span>{task.required ? '필수' : '선택'} · {task.completed ? '완료' : '대기'}</span>
            </div>
            <p>{task.instruction}</p>

            {task.kind === 'neis' && (
              <>
                <pre className="publication-document" aria-label="나이스 입력 목록">{view.neisInputList}</pre>
                <div className="publication-task-actions">
                  <button
                    className="btn"
                    disabled={task.completed}
                    onClick={() => copyThenComplete('neis', task.id, task.label, view.neisInputList)}
                  >복사하고 완료</button>
                  <button
                    className="btn ghost"
                    disabled={task.completed}
                    onClick={() => completeTask(task.id, task.label)}
                  >직접 입력했음</button>
                </div>
              </>
            )}

            {task.kind === 'teacher_notice' && (
              <>
                <pre className="publication-document" aria-label="교사 안내 문구">{view.teacherNotice}</pre>
                <div className="publication-task-actions">
                  <button
                    className="btn"
                    disabled={task.completed}
                    onClick={() => copyThenComplete('teacher_notice', task.id, task.label, view.teacherNotice)}
                  >복사하고 완료</button>
                  <button
                    className="btn ghost"
                    disabled={task.completed}
                    onClick={() => completeTask(task.id, task.label)}
                  >이미 안내했음</button>
                </div>
              </>
            )}

            {task.kind === 'class_publication' && (
              <>
                <div className="publication-preview" aria-label="학급 게시 미리보기">
                  {view.classPreview.map((preview) => (
                    <article key={preview.classKey}>
                      <b>{classKeyLabel(preview.classKey)}</b>
                      <ol>
                        {preview.lessons.filter((lesson) => lesson.changed).map((lesson) => (
                          <li key={lesson.lessonId}>
                            {lesson.date} {lesson.period}교시 {lesson.subject}
                            <small>원래 {lesson.originalDate} {lesson.originalPeriod}교시</small>
                          </li>
                        ))}
                        {preview.lessons.every((lesson) => !lesson.changed)
                          && <li>학급 시간표에 나갈 변경이 없습니다.</li>}
                      </ol>
                    </article>
                  ))}
                </div>
                <div className="publication-task-actions">
                  <button
                    className="btn"
                    disabled={task.completed}
                    onClick={() => completeTask(task.id, task.label)}
                  >미리보기 확인했음</button>
                </div>
              </>
            )}

            {task.kind === 'internal_document' && (
              <div className="publication-task-actions">
                <button
                  className="btn ghost"
                  onClick={() => { if (typeof window !== 'undefined') window.print(); }}
                >내부 기록 출력</button>
                <button
                  className="btn ghost"
                  disabled={task.completed}
                  onClick={() => completeTask(task.id, task.label)}
                >출력을 마쳤음</button>
              </div>
            )}

            {fallbackText[task.kind] && !task.completed && (
              <label className="publication-fallback">
                <span>직접 선택해 복사할 문구</span>
                <textarea readOnly value={fallbackText[task.kind]} rows={4} />
              </label>
            )}
          </li>
        ))}
        {view.tasks.length === 0 && <li className="publication-empty">해결안 승인 후에 행정 과업이 생깁니다.</li>}
      </ol>

      <section className="publication-decision" aria-label="게시 결정">
        {/* 이미 끝난 일을 잠긴 행동으로 남겨 두면 아직 할 일이 있는 것처럼 읽힌다. */}
        {view.stage !== 'published' && (
          <button
            className="btn primary"
            disabled={!view.canPublish}
            onClick={publish}
            data-publish-action
          >학급과 교사 시간표에 게시</button>
        )}
        {view.blockedReason && <p className="publication-blocked">{view.blockedReason}</p>}
        {view.stage === 'published' && view.publication && (
          <p className="publication-done" ref={resultRef} tabIndex={-1}>게시 시각 {publishedTimeLabel(view.publication.publishedAt)} · 변경 {view.publication.changedLessonIds.length}건</p>
        )}
        {view.stage === 'published' && (
          <button className="btn" onClick={startCorrection} data-correction-action>이 게시를 정정하기</button>
        )}
        <div className="publication-links">
          {view.affectedClassLabels.map((label) => {
            const matched = /^(\d+)학년 (.+)반$/.exec(label);
            if (!matched) return null;
            return (
              <button
                key={label}
                className="btn ghost"
                onClick={() => onOpenClassTimetable(matched[1]!, matched[2]!)}
              >{label} 공개 시간표 열기</button>
            );
          })}
          <button className="btn ghost" onClick={onBackToCase}>사건 상세로 돌아가기</button>
        </div>
        {message && <p className="publication-message" role="status">{message}</p>}
        {needsExport && (
          <button className="btn" onClick={onExportDiagnostic}>진단 보고서 내보내기</button>
        )}
      </section>

      {pulse && <ChangePulse destinations={pulse} publishedAt={view.publication?.publishedAt} />}
    </section>
  );
}
