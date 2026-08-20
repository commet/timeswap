import { classIdentityKey } from '@timeswap/engine';

import { transitionCase } from './case-service';
import type {
  AbsenceCase,
  Lesson,
  Publication,
  ResolutionChange,
  WorkspaceState,
} from './domain';
import {
  caseRevisionId,
  effectiveLessons,
  projectPublicClassSchedule,
  validateCasePlan,
  type PublicClassView,
} from './projections';

/**
 * Publication ids are derived rather than random so the same publish action
 * can never be recorded twice under two identities, and so a repeated attempt
 * collides on its audit id instead of silently duplicating public truth.
 */
function publicationId(caseId: string, at: string): string {
  return `publication:${caseId}:${at}`;
}

function auditId(kind: string, caseId: string, at: string): string {
  return `audit:${kind}:${caseId}:${at}`;
}

function findCase(state: WorkspaceState, caseId: string): AbsenceCase {
  const absenceCase = state.cases.find((item) => item.id === caseId);
  if (!absenceCase) throw new Error(`Case does not exist: ${caseId}`);
  return absenceCase;
}

/**
 * 그 사건의 주를, 게시된 변경을 얹은 채로.
 *
 * 활성 개정판으로 걸렀다. 금요일에 승인과 행정 마감이 끝나고 게시 단추만 남았는데
 * 주말이 지나 월요일 아침에 새 주를 불러오면, 그 사건의 수업이 하나도 안 잡혀 나이스
 * 입력 목록과 교사 통지가 통째로 비었다. 가장 흔한 모양인데 그때 게시를 못 했다.
 */
function caseLessons(state: WorkspaceState, absenceCase: AbsenceCase): Map<string, Lesson> {
  return new Map(effectiveLessons(state, caseRevisionId(state, absenceCase))
    .map((lesson) => [lesson.id, lesson]));
}

function caseChanges(absenceCase: AbsenceCase): ResolutionChange[] {
  return absenceCase.resolutionItems
    .filter((item) => item.kind !== 'unresolved')
    .flatMap((item) => item.changes);
}

/** Every lesson the publication is allowed to move, in one stable order. */
export function changedLessonIdsOf(absenceCase: AbsenceCase): string[] {
  return [...new Set(caseChanges(absenceCase).map((change) => change.lessonId))].sort();
}

function activePublicationOf(
  state: WorkspaceState,
  caseId: string,
): Publication | undefined {
  return [...state.publications]
    .filter((publication) => publication.caseId === caseId)
    .sort((left, right) => left.publishedAt.localeCompare(right.publishedAt))
    .at(-1);
}

function buildPublicationRecord(
  state: WorkspaceState,
  absenceCase: AbsenceCase,
  id: string,
  actorId: string,
  at: string,
): Publication {
  const superseded = absenceCase.supersedesCaseId
    ? activePublicationOf(state, absenceCase.supersedesCaseId)
    : undefined;
  return {
    id,
    workspaceId: absenceCase.workspaceId,
    caseId: absenceCase.id,
    // 그 사건이 딛고 선 주다. 활성 개정판으로 찍으면, 주가 넘어간 뒤 게시한 기록이
    // 지난주 수업을 바꿔 놓고 이번 주 것이라고 적힌다. 되짚을 때 어긋난다.
    revisionId: caseRevisionId(state, absenceCase),
    changedLessonIds: changedLessonIdsOf(absenceCase),
    publishedAt: at,
    publishedBy: actorId,
    ...(superseded ? { supersedesPublicationId: superseded.id } : {}),
  };
}

/**
 * Publishing is the only step that changes what students and other teachers
 * see, so it re-proves the whole plan against the active revision instead of
 * trusting the approval that happened before the administrative tasks.
 */
export function publishCase(
  state: WorkspaceState,
  caseId: string,
  actorId: string,
  at: string,
): WorkspaceState {
  const absenceCase = findCase(state, caseId);
  if (absenceCase.status !== 'ready_to_publish') {
    throw new Error('Only a case whose administrative tasks are complete can publish.');
  }
  const validation = validateCasePlan(state, caseId);
  if (validation.staleRevision) {
    throw new Error('The resolution must be recomputed against the active revision.');
  }
  if (!validation.valid) {
    throw new Error('The resolution plan has unresolved conflicts.');
  }
  const changedLessonIds = changedLessonIdsOf(absenceCase);
  if (changedLessonIds.length === 0) {
    throw new Error('A publication must change at least one lesson.');
  }

  const transitioned = transitionCase(state, {
    caseId,
    to: 'published',
    actorId,
    at,
    auditEventId: auditId('publication', caseId, at),
    ...(absenceCase.supersedesCaseId
      ? { supersessionAuditEventId: auditId('supersession', caseId, at) }
      : {}),
  });
  const publication = buildPublicationRecord(
    state,
    absenceCase,
    publicationId(caseId, at),
    actorId,
    at,
  );
  if (state.publications.some((item) => item.id === publication.id)) {
    throw new Error('Publication id already exists.');
  }

  return { ...transitioned, publications: [...transitioned.publications, publication] };
}

/**
 * Projects the state the publication would create without storing it, so the
 * operator can check the public result before it becomes public.
 */
function simulatePublication(state: WorkspaceState, absenceCase: AbsenceCase): WorkspaceState {
  const publication = buildPublicationRecord(
    state,
    absenceCase,
    `${publicationId(absenceCase.id, absenceCase.updatedAt)}:preview`,
    'preview',
    absenceCase.updatedAt,
  );
  return {
    ...state,
    cases: state.cases.map((item) => {
      if (item.id === absenceCase.id) return { ...item, status: 'published' as const };
      if (item.id === absenceCase.supersedesCaseId) {
        return { ...item, status: 'superseded' as const };
      }
      return item;
    }),
    publications: [...state.publications, publication],
  };
}

/**
 * 게시 시각은 사람이 읽는 값이다. 저장은 UTC 로 하되 화면에서는 보는 사람의
 * 시간대로 분 단위까지만 보여 준다.
 */
export function publishedTimeLabel(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.valueOf())) return timestamp;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
    + ` ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function classLabel(lesson: Lesson): string {
  return `${lesson.classIdentity.grade}학년 ${lesson.classIdentity.className}반`;
}

/**
 * A stable invitation id is not a name.  Printing it on an administrative
 * document would look like a person and read as one, so an unnamed teacher is
 * reported as unnamed instead.
 */
export function documentTeacherLabel(state: WorkspaceState, teacherId: string | null): string {
  if (!teacherId) return '미배정';
  const label = state.teacherLabels?.[teacherId]?.trim();
  return label && !/^(?:member|teacher):/i.test(label) ? label : '이름 확인 필요';
}

function changeTeacherId(change: ResolutionChange): string | null {
  return change.teacher.state === 'assigned' ? change.teacher.teacherId : null;
}

interface DocumentRow {
  change: ResolutionChange;
  lesson: Lesson;
}

/** Both documents read the same rows so a notice can never drift from NEIS. */
function documentRows(state: WorkspaceState, caseId: string): DocumentRow[] {
  const absenceCase = findCase(state, caseId);
  const lessons = caseLessons(state, absenceCase);
  return caseChanges(absenceCase)
    .flatMap((change) => {
      const lesson = lessons.get(change.lessonId);
      return lesson ? [{ change, lesson }] : [];
    })
    .sort((left, right) => left.change.toDate.localeCompare(right.change.toDate)
      || Number(left.change.toPeriod) - Number(right.change.toPeriod)
      || left.change.lessonId.localeCompare(right.change.lessonId));
}

export function buildNeisInputList(state: WorkspaceState, caseId: string): string {
  const rows = documentRows(state, caseId);
  if (rows.length === 0) return '입력할 변경이 없습니다.';

  const lines = rows.map(({ change, lesson }) => {
    const moved = change.toDate !== lesson.date || change.toPeriod !== lesson.period;
    const origin = moved ? ` (원래 ${lesson.date} ${lesson.period}교시)` : '';
    return [
      change.toDate,
      `${change.toPeriod}교시`,
      classLabel(lesson),
      lesson.subject,
      documentTeacherLabel(state, changeTeacherId(change)),
      lesson.room,
    ].join(' | ') + origin;
  });

  return [
    `${state.workspace.name} 시간표 변경 입력 목록`,
    '날짜 | 교시 | 학급 | 과목 | 담당 | 교실',
    ...lines,
  ].join('\n');
}

export function buildTeacherNotice(state: WorkspaceState, caseId: string): string {
  const rows = documentRows(state, caseId);
  if (rows.length === 0) return '안내할 변경이 없습니다.';

  const lines = rows.map(({ change, lesson }) => {
    const moved = change.toDate !== lesson.date || change.toPeriod !== lesson.period;
    const where = moved
      ? `${lesson.date} ${lesson.period}교시 수업을 ${change.toDate} ${change.toPeriod}교시로 옮깁니다.`
      : `${change.toDate} ${change.toPeriod}교시 수업을 그대로 진행합니다.`;
    return `- ${classLabel(lesson)} ${lesson.subject}: ${where} 담당은 ${documentTeacherLabel(state, changeTeacherId(change))} 선생님입니다.`;
  });

  return [
    `${state.workspace.name} 시간표 변경 안내`,
    ...lines,
    '변경 내용을 확인하시고 해당 시간에 들어가 주십시오.',
  ].join('\n');
}

export function buildClassPublicationPreview(
  state: WorkspaceState,
  caseId: string,
): PublicClassView[] {
  const absenceCase = findCase(state, caseId);
  const lessons = caseLessons(state, absenceCase);
  const classKeys = [...new Set(caseChanges(absenceCase)
    .flatMap((change) => {
      const lesson = lessons.get(change.lessonId);
      return lesson ? [classIdentityKey(lesson.classIdentity)] : [];
    }))].sort();
  const simulated = simulatePublication(state, absenceCase);

  return classKeys.map((classKey) => projectPublicClassSchedule(simulated, classKey));
}
