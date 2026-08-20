'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CASE_STATUS_LABEL,
  findDuplicateAbsenceCase,
  findOverlappingAbsenceCases,
  lessonsAffectedByAbsence,
} from '../lib/case-service';
import type { AbsenceCase, Lesson, WorkspaceState } from '../lib/domain';
import { effectiveLessons } from '../lib/projections';

export interface ComposerReadiness {
  readyForCandidates: boolean;
  source: { known: number; expected: number; complete: boolean };
  mapping: { known: number; expected: number; complete: boolean; unassignedLessons: number };
}

export interface AbsenceComposerSubmission {
  fromDate: string;
  toDate: string;
  reason: AbsenceCase['reason'];
  note?: string;
  lessonIds: string[];
}

export interface CandidateHandoff extends AbsenceComposerSubmission {
  atomicWarnings: string[];
}

export function candidateHandoffData(
  submission: AbsenceComposerSubmission,
  atomicWarnings: string[],
): CandidateHandoff {
  return { ...submission, atomicWarnings };
}

export interface TeacherDiagnosticProjection {
  kind: 'teacher-absence-diagnostic';
  source: { receivedRows: number; expectedRows: number; complete: boolean };
  mapping: { knownTeachers: number; expectedTeachers: number; unassignedLessons: number; complete: boolean };
  revision: { source: WorkspaceState['revisions'][number]['source'] | null; loadedAt: string | null; complete: boolean };
  issues: string[];
}

/*
 * 게시된 변경을 얹은 표를 쓴다. 이유는 `projections.ts` 의 `effectiveLessons` 옆에
 * 적었다. 같은 셈을 여기에 또 적지 않는다.
 */
const activeLessons = effectiveLessons;

function countFromQuery(query: Record<string, string> | undefined, key: string): number | null {
  const value = Number(query?.[key]);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function composerReadiness(state: WorkspaceState): ComposerReadiness {
  const revision = state.revisions.find((item) => item.id === state.workspace.activeRevisionId);
  const lessons = activeLessons(state);
  const sourceKnown = countFromQuery(revision?.query, 'receivedRows');
  const sourceExpected = countFromQuery(revision?.query, 'expectedRows');
  const assignedTeachers = new Set(lessons.flatMap((lesson) =>
    lesson.teacher.state === 'assigned' ? [lesson.teacher.teacherId] : []));
  const knownTeacherLabels = [...assignedTeachers].filter((teacherId) =>
    Boolean(state.teacherLabels?.[teacherId]?.trim())).length;
  const unassignedLessons = lessons.filter((lesson) => lesson.teacher.state === 'unassigned').length;
  const sourceComplete = Boolean(revision?.complete)
    && sourceKnown !== null
    && sourceExpected !== null
    && sourceKnown === sourceExpected;
  const mappingComplete = knownTeacherLabels === assignedTeachers.size && unassignedLessons === 0;

  return {
    readyForCandidates: sourceComplete && mappingComplete,
    source: { known: sourceKnown ?? 0, expected: sourceExpected ?? 0, complete: sourceComplete },
    mapping: {
      known: knownTeacherLabels,
      expected: assignedTeachers.size,
      complete: mappingComplete,
      unassignedLessons,
    },
  };
}

/** Deliberately redacted: this is safe to hand to support without timetable or case data. */
export function projectTeacherDiagnostic(state: WorkspaceState): TeacherDiagnosticProjection {
  const revision = state.revisions.find((item) => item.id === state.workspace.activeRevisionId);
  const readiness = composerReadiness(state);
  const issues: string[] = [];
  if (!readiness.source.complete) {
    issues.push(`공식 시간표 행이 완전하지 않습니다 (${readiness.source.known}/${readiness.source.expected}건).`);
  }
  if (!readiness.mapping.complete) {
    issues.push(`교사 연결이 완전하지 않습니다 (${readiness.mapping.known}/${readiness.mapping.expected}명, 담당 미확정 수업 ${readiness.mapping.unassignedLessons}건).`);
  }

  return {
    kind: 'teacher-absence-diagnostic',
    source: {
      receivedRows: readiness.source.known,
      expectedRows: readiness.source.expected,
      complete: readiness.source.complete,
    },
    mapping: {
      knownTeachers: readiness.mapping.known,
      expectedTeachers: readiness.mapping.expected,
      unassignedLessons: readiness.mapping.unassignedLessons,
      complete: readiness.mapping.complete,
    },
    revision: {
      source: revision?.source ?? null,
      loadedAt: revision?.loadedAt ?? null,
      complete: Boolean(revision?.complete),
    },
    issues,
  };
}

export function fullDayLessonIds(
  state: WorkspaceState,
  teacherId: string,
  date: string,
): string[] {
  return lessonsAffectedByAbsence(activeLessons(state), teacherId, date, date)
    .map((lesson) => lesson.id);
}

export function toggleLessonSelection(lessonIds: readonly string[], lessonId: string): string[] {
  return lessonIds.includes(lessonId)
    ? lessonIds.filter((id) => id !== lessonId)
    : [...lessonIds, lessonId];
}

export function atomicSelectionWarnings(
  state: WorkspaceState,
  lessonIds: readonly string[],
): string[] {
  const selected = new Set(lessonIds);
  return (state.atomicLessonGroups ?? [])
    .filter((group) => group.workspaceId === state.workspace.id
      && group.revisionId === state.workspace.activeRevisionId)
    .flatMap((group) => {
      const selectedCount = group.lessonIds.filter((lessonId) => selected.has(lessonId)).length;
      if (selectedCount === 0 || selectedCount === group.lessonIds.length) return [];
      return [`실습 묶음 ${group.lessonIds.length}개 중 ${selectedCount}개 수업만 선택되었습니다. 후보 검토에서 묶음 제약을 함께 확인합니다.`];
    });
}

function collaborationTeacherCount(
  state: WorkspaceState,
  selectedLessons: readonly Lesson[],
  requesterTeacherId: string,
): number {
  const selectedSlots = new Set(selectedLessons.map((lesson) => `${lesson.date}\u0000${lesson.period}`));
  return new Set(activeLessons(state).flatMap((lesson) => {
    if (lesson.teacher.state !== 'assigned' || lesson.teacher.teacherId === requesterTeacherId) return [];
    return selectedSlots.has(`${lesson.date}\u0000${lesson.period}`) ? [lesson.teacher.teacherId] : [];
  })).size;
}

export function messageForUnavailableSource(readiness: ComposerReadiness): string {
  const parts: string[] = [];
  if (!readiness.source.complete) {
    parts.push(`공식 시간표 ${readiness.source.known}/${readiness.source.expected}건`);
  }
  if (!readiness.mapping.complete) {
    const unassigned = readiness.mapping.unassignedLessons
      ? ` · 담당 미확정 수업 ${readiness.mapping.unassignedLessons}건`
      : '';
    parts.push(`교사 연결 ${readiness.mapping.known}/${readiness.mapping.expected}명${unassigned}`);
  }
  return `${parts.join(', ')}을 확인한 뒤 후보 추천을 시작할 수 있습니다.`;
}

export function AbsenceComposer({
  state,
  teacherId,
  initialLessonId,
  onSubmit,
  onCandidateHandoff,
  onExportDiagnostic,
  onDismiss,
}: {
  state: WorkspaceState;
  teacherId: string;
  initialLessonId?: string;
  onSubmit(input: AbsenceComposerSubmission): { caseId?: string; error?: string };
  onCandidateHandoff?(handoff: CandidateHandoff): void;
  onExportDiagnostic(): void;
  onDismiss(): void;
}) {
  const initialLesson = activeLessons(state).find((lesson) => lesson.id === initialLessonId);
  const defaultDate = initialLesson?.date ?? activeLessons(state)[0]?.date ?? '';
  const [fromDate, setFromDate] = useState(defaultDate);
  const [toDate, setToDate] = useState(defaultDate);
  const [wholeDay, setWholeDay] = useState(false);
  const [selectedLessonIds, setSelectedLessonIds] = useState<string[]>(
    initialLesson ? [initialLesson.id] : [],
  );
  const [reason, setReason] = useState<AbsenceCase['reason']>('업무상 부재');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [submittedCaseId, setSubmittedCaseId] = useState<string | null>(null);
  const statusRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!wholeDay) return;
    setSelectedLessonIds(lessonsAffectedByAbsence(activeLessons(state), teacherId, fromDate, toDate)
      .map((lesson) => lesson.id));
  }, [fromDate, state, teacherId, toDate, wholeDay]);

  useEffect(() => {
    if (submittedCaseId) statusRef.current?.focus();
  }, [submittedCaseId]);

  const selectableLessons = useMemo(() => lessonsAffectedByAbsence(
    activeLessons(state), teacherId, fromDate, toDate,
  ), [fromDate, state, teacherId, toDate]);
  const selected = useMemo(() => {
    const selectedIds = new Set(selectedLessonIds);
    return selectableLessons.filter((lesson) => selectedIds.has(lesson.id));
  }, [selectableLessons, selectedLessonIds]);
  const readiness = useMemo(() => composerReadiness(state), [state]);
  const atomicWarnings = useMemo(() => atomicSelectionWarnings(state, selectedLessonIds), [state, selectedLessonIds]);
  const collaborators = useMemo(() => collaborationTeacherCount(state, selected, teacherId), [selected, state, teacherId]);

  function toggleLesson(lessonId: string) {
    setSelectedLessonIds((current) => toggleLessonSelection(current, lessonId));
    setMessage('');
  }

  function submit() {
    if (!selected.length) {
      setMessage('영향받는 수업을 하나 이상 선택하십시오.');
      return;
    }
    const duplicate = findDuplicateAbsenceCase(state, {
      requesterTeacherId: teacherId, fromDate, toDate, lessonIds: selected.map((lesson) => lesson.id),
    });
    if (duplicate) {
      setMessage(`같은 기간과 수업으로 ${CASE_STATUS_LABEL[duplicate.status]} 상태의 요청이 이미 있습니다. 기존 요청을 확인하거나 날짜 또는 수업 선택을 바꾸십시오.`);
      return;
    }
    const overlapping = findOverlappingAbsenceCases(state, {
      requesterTeacherId: teacherId, lessonIds: selected.map((lesson) => lesson.id),
    });
    if (overlapping.length > 0) {
      const dates = [...new Set(overlapping.flatMap((item) => item.lessonIds)
        .map((lessonId) => effectiveLessons(state).find((lesson) => lesson.id === lessonId)?.date)
        .filter((date): date is string => Boolean(date)))].sort();
      setMessage(`${dates.join(', ')} 수업은 이미 낸 요청에 들어 있습니다. 그 요청을 취소하거나 겹치지 않는 날짜를 고르십시오.`);
      return;
    }
    const result = onSubmit({
      fromDate,
      toDate,
      reason,
      ...(note.trim() ? { note: note.trim() } : {}),
      lessonIds: selected.map((lesson) => lesson.id),
    });
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setSubmittedCaseId(result.caseId ?? 'submitted');
    setSelectedLessonIds([]);
  }

  if (submittedCaseId) return (
    <section className="absence-composer case-submitted" aria-labelledby="case-status-heading">
      <span className="eyebrow">변경 요청</span>
      <h2 id="case-status-heading" ref={statusRef} tabIndex={-1}>요청을 제출했습니다</h2>
      <p>일과 담당자가 영향 수업과 협조 필요 사항을 검토합니다.</p>
      <button className="btn ghost" onClick={onDismiss}>시간표로 돌아가기</button>
    </section>
  );

  return (
    <section className="absence-composer" aria-labelledby="absence-composer-title">
      <header>
        <div>
          <span className="eyebrow">변경 요청</span>
          <h2 id="absence-composer-title">부재와 영향 수업</h2>
          <p>필요한 운영 정보만 요청합니다. 진단, 병력, 전화번호 등 민감한 개인정보는 적지 마십시오.</p>
        </div>
        <button className="btn ghost" onClick={onDismiss}>닫기</button>
      </header>

      <div className="absence-dates">
        <label>시작일<input className="input" type="date" value={fromDate}
          onChange={(event) => setFromDate(event.target.value)} /></label>
        <label>종료일<input className="input" type="date" min={fromDate} value={toDate}
          onChange={(event) => setToDate(event.target.value)} /></label>
        <label className="whole-day"><input type="checkbox" checked={wholeDay}
          onChange={(event) => {
            setWholeDay(event.target.checked);
            if (event.target.checked) setSelectedLessonIds(lessonsAffectedByAbsence(
              activeLessons(state), teacherId, fromDate, toDate,
            ).map((lesson) => lesson.id));
          }} /> 하루 전체</label>
      </div>

      <fieldset className="affected-lessons">
        <legend>영향받는 수업</legend>
        {selectableLessons.length ? selectableLessons.map((lesson) => (
          <label key={lesson.id}>
            <input type="checkbox" checked={selectedLessonIds.includes(lesson.id)}
              onChange={() => toggleLesson(lesson.id)} />
            <span>{lesson.date} {lesson.period}교시 · {lesson.classIdentity.grade}-{lesson.classIdentity.className} {lesson.subject}</span>
          </label>
        )) : <p>선택한 기간에 담당 수업이 없습니다.</p>}
      </fieldset>

      <div className="absence-facts" aria-live="polite">
        <span><b>{selected.length}</b>개 영향 수업</span>
        <span><b>{collaborators}</b>명 협조 교사</span>
      </div>
      {atomicWarnings.map((warning) => <p className="atomic-warning" key={warning}>{warning}</p>)}

      <fieldset className="absence-reason">
        <legend>부재 사유</legend>
        {(['업무상 부재', '연수·출장', '학교 행사', '기타'] as const).map((category) => (
          <label key={category}><input type="radio" name="absence-reason" value={category}
            checked={reason === category} onChange={() => setReason(category)} /> {category}</label>
        ))}
        <label className="coordination-note">협조 메모 (선택)<textarea className="input" maxLength={240}
          value={note} onChange={(event) => setNote(event.target.value)}
          placeholder="수업 운영에 필요한 짧은 전달 사항만 적으십시오." /></label>
      </fieldset>

      {!readiness.readyForCandidates && (
        <aside className="source-unavailable" role="status">
          <b>후보 추천을 시작할 수 없습니다</b>
          <p>{messageForUnavailableSource(readiness)}</p>
          <p>공식 자료를 다시 확인하고 교사 연결을 완료하십시오. 진단 보고서는 지금 내보낼 수 있습니다.</p>
        </aside>
      )}

      {message && <p className="composer-message" role="alert">{message}</p>}
      <footer>
        <button className="btn primary" onClick={submit}>변경 요청 제출</button>
        <button className="btn ghost" disabled={!readiness.readyForCandidates || !selected.length}
          onClick={() => onCandidateHandoff?.({
            ...candidateHandoffData({
              lessonIds: selected.map((lesson) => lesson.id), fromDate, toDate, reason,
              ...(note.trim() ? { note: note.trim() } : {}),
            }, atomicWarnings),
          })}>후보 계산으로 전달</button>
        <button className="btn ghost" onClick={onExportDiagnostic}>진단 보고서 내보내기</button>
      </footer>
    </section>
  );
}
