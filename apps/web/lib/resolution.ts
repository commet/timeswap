import type {
  AbsenceCase,
  Lesson,
  ResolutionChange,
  ResolutionItem,
  WorkspaceState,
} from './domain';
import { validateCasePlan } from './projections';

export interface ResolutionRow {
  id: string;
  method: '빈 교시 이동' | '맞교환' | '연쇄 교환' | '보강';
  collaborators: string[];
  movedUnitCount: number;
  studentImpact: string;
  burden: string;
  state: 'recommended' | 'valid' | 'warning';
  disabledReason?: string;
  /** Canonical facts used by the selected detail and repository action. */
  resolution: ResolutionItem;
  warningReasons: string[];
}

export interface ResolutionDetail {
  groupedUnitCount: number;
  collaborators: string[];
  warningReasons: string[];
  changes: Array<{
    lessonId: string;
    original: {
      date: string;
      period: string;
      subject: string;
      className: string;
      room: string;
    };
    next: {
      date: string;
      period: string;
      subject: string;
      className: string;
      room: string;
      teacher: string;
    };
  }>;
}

export interface ResolutionSelection {
  state: WorkspaceState;
  validation: ReturnType<typeof validateCasePlan>;
}

export interface ResolutionHandoff {
  lessonIds: string[];
  fromDate: string;
  toDate: string;
  reason: AbsenceCase['reason'];
  note?: string;
  atomicWarnings: string[];
}

export interface ResolutionPreview {
  state: WorkspaceState;
  caseId: string;
}

export interface ResolutionProgress {
  lessonId: string;
  label: string;
  state: '해결' | '주의' | '미해결';
}

const METHOD: Record<Exclude<ResolutionItem['kind'], 'unresolved' | 'manual'>, ResolutionRow['method']> = {
  move: '빈 교시 이동',
  swap2: '맞교환',
  cycle3: '연쇄 교환',
  cover: '보강',
};

function activeLessons(state: WorkspaceState): Lesson[] {
  return state.lessons.filter((lesson) => lesson.revisionId === state.workspace.activeRevisionId);
}

function teacherLabel(state: WorkspaceState, teacherId: string): string {
  const label = state.teacherLabels?.[teacherId]?.trim();
  return label || '담당 교사';
}

function isAssigned(change: ResolutionChange): change is ResolutionChange & { teacher: { state: 'assigned'; teacherId: string } } {
  return change.teacher.state === 'assigned';
}

function candidateLessonIds(state: WorkspaceState, item: ResolutionItem): string[] {
  const changed = new Set(item.changes.map((change) => change.lessonId));
  const atomic = (state.atomicLessonGroups ?? []).find((group) =>
    group.workspaceId === state.workspace.id
    && group.revisionId === state.workspace.activeRevisionId
    && group.lessonIds.some((lessonId) => changed.has(lessonId)));
  return atomic ? [...atomic.lessonIds] : [item.lessonId];
}

function expandedAtomicLessonIds(state: WorkspaceState, lessonIds: readonly string[]): string[] {
  const expanded = new Set(lessonIds);
  for (const group of state.atomicLessonGroups ?? []) {
    if (group.workspaceId !== state.workspace.id || group.revisionId !== state.workspace.activeRevisionId) continue;
    if (group.lessonIds.some((lessonId) => expanded.has(lessonId))) {
      for (const lessonId of group.lessonIds) expanded.add(lessonId);
    }
  }
  return [...expanded].sort();
}

function hardInvalid(state: WorkspaceState, absenceCase: AbsenceCase, item: ResolutionItem): boolean {
  const candidateCase: AbsenceCase = {
    ...absenceCase,
    lessonIds: candidateLessonIds(state, item),
    resolutionItems: [item],
  };
  const candidateState: WorkspaceState = {
    ...state,
    cases: state.cases.map((current) => current.id === absenceCase.id ? candidateCase : current),
  };
  return !validateCasePlan(candidateState, absenceCase.id).valid;
}

function coverCandidates(
  state: WorkspaceState,
  absenceCase: AbsenceCase,
  lesson: Lesson,
): ResolutionItem[] {
  const lessons = activeLessons(state);
  const lessonById = new Map(lessons.map((current) => [current.id, current]));
  const atomicGroup = (state.atomicLessonGroups ?? []).find((group) =>
    group.workspaceId === state.workspace.id
    && group.revisionId === state.workspace.activeRevisionId
    && group.lessonIds.includes(lesson.id));
  const groupedLessons = atomicGroup
    ? atomicGroup.lessonIds.flatMap((lessonId) => lessonById.get(lessonId) ?? [])
    : lesson.parallelGroupId
      ? lessons.filter((current) => current.parallelGroupId === lesson.parallelGroupId)
      : [lesson];
  const unavailable = new Set(lessons
    .filter((current) => current.date === lesson.date && current.period === lesson.period)
    .flatMap((current) => current.teacher.state === 'assigned' ? [current.teacher.teacherId] : []));
  const teacherIds = [...new Set(lessons.flatMap((current) =>
    current.teacher.state === 'assigned' ? [current.teacher.teacherId] : []))]
    .filter((teacherId) => teacherId !== absenceCase.requesterTeacherId && !unavailable.has(teacherId));

  return teacherIds.map((teacherId) => ({
    id: `candidate:cover:${lesson.id}:${teacherId}`,
    lessonId: lesson.id,
    kind: 'cover' as const,
    computedAgainstRevisionId: state.workspace.activeRevisionId,
    changes: groupedLessons.map((grouped) => ({
      lessonId: grouped.id,
      toDate: grouped.date,
      toPeriod: grouped.period,
      teacher: grouped.id === lesson.id || atomicGroup
        ? { state: 'assigned' as const, teacherId }
        : grouped.teacher,
    })),
  }));
}

function exchangeCandidates(
  state: WorkspaceState,
  lesson: Lesson,
): ResolutionItem[] {
  const owner = lesson.teacher;
  if (owner.state !== 'assigned' || lesson.parallelGroupId) return [];
  const lessons = activeLessons(state);
  const sameDate = lessons.filter((current) => current.date === lesson.date);
  const maxPeriod = Math.max(...sameDate.map((current) => Number(current.period)), Number(lesson.period));
  const move = Array.from({ length: maxPeriod }, (_, index) => String(index + 1))
    .filter((period) => period !== lesson.period)
    .map((period) => ({
      id: `candidate:move:${lesson.id}:${period}`,
      lessonId: lesson.id,
      kind: 'move' as const,
      computedAgainstRevisionId: state.workspace.activeRevisionId,
      changes: [{
        lessonId: lesson.id,
        toDate: lesson.date,
        toPeriod: period,
        teacher: owner,
      }],
    }));
  const counterparts = sameDate.filter((current) => current.id !== lesson.id
    && current.teacher.state === 'assigned'
    && current.teacher.teacherId !== owner.teacherId
    && current.period !== lesson.period);
  const swaps = counterparts.map((counterpart) => ({
    id: `candidate:swap:${lesson.id}:${counterpart.id}`,
    lessonId: lesson.id,
    kind: 'swap2' as const,
    computedAgainstRevisionId: state.workspace.activeRevisionId,
    changes: [{
      lessonId: lesson.id,
      toDate: lesson.date,
      toPeriod: counterpart.period,
      teacher: owner,
    }, {
      lessonId: counterpart.id,
      toDate: counterpart.date,
      toPeriod: lesson.period,
      teacher: counterpart.teacher,
    }],
  }));
  const cycles = counterparts.flatMap((first, firstIndex) => counterparts
    .slice(firstIndex + 1)
    .filter((second) => second.teacher.state === 'assigned'
      && first.teacher.state === 'assigned'
      && second.teacher.teacherId !== first.teacher.teacherId)
    .map((second) => ({
      id: `candidate:cycle:${lesson.id}:${first.id}:${second.id}`,
      lessonId: lesson.id,
      kind: 'cycle3' as const,
      computedAgainstRevisionId: state.workspace.activeRevisionId,
      changes: [{
        lessonId: lesson.id,
        toDate: lesson.date,
        toPeriod: first.period,
        teacher: owner,
      }, {
        lessonId: first.id,
        toDate: first.date,
        toPeriod: second.period,
        teacher: first.teacher,
      }, {
        lessonId: second.id,
        toDate: second.date,
        toPeriod: lesson.period,
        teacher: second.teacher,
      }],
    })));
  return [...move, ...swaps, ...cycles];
}

function warningReasons(state: WorkspaceState, lesson: Lesson, item: ResolutionItem): string[] {
  const reasons: string[] = [];
  if (item.kind === 'cover') {
    const teacherId = item.changes.find(isAssigned)?.teacher.teacherId;
    const dayLessons = teacherId
      ? activeLessons(state).filter((current) => current.date === lesson.date
        && current.teacher.state === 'assigned'
        && current.teacher.teacherId === teacherId).length
      : 0;
    if (dayLessons >= 4) reasons.push('협조 교사의 당일 수업량이 많습니다.');
  }
  if (item.changes.some((change) => Number(change.toPeriod) > Number(lesson.period) + 2)) {
    reasons.push('학생 수업 시간이 늦어질 수 있습니다.');
  }
  return reasons;
}

function studentImpact(lesson: Lesson, item: ResolutionItem): string {
  if (item.kind === 'cover') return '시간표 유지';
  if (item.changes.some((change) => change.toDate !== lesson.date)) return '다른 날 수업';
  if (item.changes.some((change) => change.toPeriod !== lesson.period)) return '같은 날 교시 변경';
  return '수업 묶음 유지';
}

function burden(state: WorkspaceState, lesson: Lesson, item: ResolutionItem): string {
  const ownerId = lesson.teacher.state === 'assigned' ? lesson.teacher.teacherId : null;
  const collaborator = item.changes.filter(isAssigned)
    .find((change) => change.teacher.teacherId !== ownerId);
  if (!collaborator) return '추가 부담이 적습니다';
  const dayLessons = activeLessons(state).filter((current) => current.date === lesson.date
    && current.teacher.state === 'assigned'
    && current.teacher.teacherId === collaborator.teacher.teacherId).length;
  return `당일 수업 ${dayLessons}시간`;
}

function toRow(state: WorkspaceState, lesson: Lesson, item: ResolutionItem): ResolutionRow {
  const collaborators = [...new Set(item.changes
    .filter(isAssigned)
    .map((change) => change.teacher.teacherId)
    .filter((teacherId) => lesson.teacher.state !== 'assigned' || teacherId !== lesson.teacher.teacherId))]
    .map((teacherId) => teacherLabel(state, teacherId));
  const warnings = warningReasons(state, lesson, item);
  return {
    id: item.id,
    method: METHOD[item.kind as Exclude<ResolutionItem['kind'], 'unresolved' | 'manual'>],
    collaborators: collaborators.length ? collaborators : ['협조 교사 없음'],
    movedUnitCount: item.changes.length,
    studentImpact: studentImpact(lesson, item),
    burden: burden(state, lesson, item),
    state: warnings.length ? 'warning' : 'valid',
    resolution: item,
    warningReasons: warnings,
  };
}

/**
 * Builds a display-ready comparison list directly from canonical resolutions.
 * Invalid plans are deliberately excluded so no display text needs to be
 * parsed back into a domain action later.
 */
export function resolutionRowsForLesson(
  state: WorkspaceState,
  caseId: string,
  lessonId: string,
): ResolutionRow[] {
  const absenceCase = state.cases.find((item) => item.id === caseId);
  const lesson = activeLessons(state).find((item) => item.id === lessonId);
  if (!absenceCase || !lesson) return [];

  const existingExchange = absenceCase.resolutionItems.filter((item) => item.lessonId === lessonId
    && (item.kind === 'move' || item.kind === 'swap2' || item.kind === 'cycle3'));
  const generatedExchange = existingExchange.length ? [] : exchangeCandidates(state, lesson);
  const cover = absenceCase.resolutionItems.filter((item) => item.lessonId === lessonId && item.kind === 'cover');
  const validExchange = [...existingExchange, ...generatedExchange]
    .filter((item) => !hardInvalid(state, absenceCase, item));
  const preferredExchange = (['move', 'swap2', 'cycle3'] as const).flatMap((kind) =>
    validExchange.filter((item) => item.kind === kind).slice(0, 1));
  const candidates = [...preferredExchange, ...cover, ...coverCandidates(state, absenceCase, lesson)];
  const unique = new Map<string, ResolutionItem>();
  for (const item of candidates) {
    const key = JSON.stringify([item.kind, item.changes]);
    if (!unique.has(key)) unique.set(key, item);
  }
  const rows = [...unique.values()]
    .filter((item) => !hardInvalid(state, absenceCase, item))
    .map((item) => toRow(state, lesson, item))
    .sort((left, right) => {
      const rank = (row: ResolutionRow) => ['빈 교시 이동', '맞교환', '연쇄 교환', '보강'].indexOf(row.method);
      return rank(left) - rank(right) || left.id.localeCompare(right.id);
    })
    .slice(0, 5);
  if (rows[0] && rows[0].state === 'valid') rows[0] = { ...rows[0], state: 'recommended' };
  return rows;
}

/** Explains why a grouped lesson offers cover instead of a partial exchange. */
export function resolutionConstraintForLesson(
  state: WorkspaceState,
  lessonId: string,
  rows: readonly ResolutionRow[],
): string | undefined {
  const lesson = activeLessons(state).find((item) => item.id === lessonId);
  if (!lesson || rows.some((row) => row.method !== '보강')) return undefined;
  if (lesson.parallelGroupId) {
    const count = activeLessons(state).filter((item) => item.parallelGroupId === lesson.parallelGroupId).length;
    return `선택과목 묶음 ${count}개 수업은 함께 운영해야 합니다. 부분 교환 대신 묶음 전체 보강안을 확인하십시오.`;
  }
  const atomic = (state.atomicLessonGroups ?? []).find((group) => group.lessonIds.includes(lessonId));
  if (atomic) return `연속 실습 묶음 ${atomic.lessonIds.length}개 수업은 함께 유지해야 합니다. 묶음 전체 보강안을 확인하십시오.`;
  return undefined;
}

/** Returns the selected timetable diff from canonical lessons, never display text. */
export function resolutionDetailForRow(state: WorkspaceState, row: ResolutionRow): ResolutionDetail {
  const lessonsById = new Map(activeLessons(state).map((lesson) => [lesson.id, lesson]));
  return {
    groupedUnitCount: row.resolution.changes.length,
    collaborators: row.collaborators,
    warningReasons: row.warningReasons,
    changes: row.resolution.changes.flatMap((change) => {
      const lesson = lessonsById.get(change.lessonId);
      if (!lesson) return [];
      return [{
        lessonId: lesson.id,
        original: {
          date: lesson.date,
          period: lesson.period,
          subject: lesson.subject,
          className: `${lesson.classIdentity.grade}-${lesson.classIdentity.className}`,
          room: lesson.room,
        },
        next: {
          date: change.toDate,
          period: change.toPeriod,
          subject: lesson.subject,
          className: `${lesson.classIdentity.grade}-${lesson.classIdentity.className}`,
          room: lesson.room,
          teacher: change.teacher.state === 'assigned'
            ? teacherLabel(state, change.teacher.teacherId)
            : '담당 미정',
        },
      }];
    }),
  };
}

/** Replaces one item's canonical facts, then validates the full case immediately. */
export function selectResolutionForCase(
  state: WorkspaceState,
  caseId: string,
  row: ResolutionRow,
): ResolutionSelection {
  const currentCase = state.cases.find((item) => item.id === caseId);
  if (!currentCase) throw new Error(`Case does not exist: ${caseId}`);
  let replaced = false;
  const resolutionItems = currentCase.resolutionItems.map((item) => {
    if (item.lessonId !== row.resolution.lessonId || replaced) return item;
    replaced = true;
    return row.resolution;
  });
  if (!replaced) resolutionItems.push(row.resolution);
  const next: WorkspaceState = {
    ...state,
    cases: state.cases.map((item) => item.id === caseId ? {
      ...item,
      resolutionItems,
    } : item),
  };
  return { state: next, validation: validateCasePlan(next, caseId) };
}

/**
 * Creates an in-memory canonical case used only to calculate and compare rows.
 * The caller owns the one later repository save after the primary action.
 */
export function resolutionPreviewForHandoff(
  state: WorkspaceState,
  requesterTeacherId: string,
  handoff: ResolutionHandoff,
): ResolutionPreview {
  const lessonIds = expandedAtomicLessonIds(state, handoff.lessonIds);
  const caseId = `preview:resolution:${lessonIds.join(':')}`;
  const previewCase: AbsenceCase = {
    id: caseId,
    workspaceId: state.workspace.id,
    requesterTeacherId,
    fromDate: handoff.fromDate,
    toDate: handoff.toDate,
    reason: handoff.reason,
    ...(handoff.note ? { note: handoff.note } : {}),
    lessonIds,
    resolutionItems: [],
    status: 'draft',
    createdAt: state.workspace.updatedAt,
    updatedAt: state.workspace.updatedAt,
  };
  return {
    caseId,
    state: { ...state, cases: [...state.cases, previewCase] },
  };
}

/** Projects one whole-case rail from the same canonical plan used by validation. */
export function resolutionProgressForCase(state: WorkspaceState, caseId: string): ResolutionProgress[] {
  const absenceCase = state.cases.find((item) => item.id === caseId);
  if (!absenceCase) return [];
  const lessonsById = new Map(activeLessons(state).map((lesson) => [lesson.id, lesson]));
  const validation = validateCasePlan(state, caseId);
  return absenceCase.lessonIds.map((lessonId) => {
    const lesson = lessonsById.get(lessonId);
    const covered = absenceCase.resolutionItems.some((item) => item.kind !== 'unresolved'
      && item.changes.some((change) => change.lessonId === lessonId));
    const conflicted = validation.conflicts.some((conflict) => conflict.lessonId === lessonId);
    return {
      lessonId,
      label: lesson ? `${lesson.period}교시 ${lesson.subject}` : '확인할 수업',
      state: !covered ? '미해결' : conflicted ? '주의' : '해결',
    };
  });
}
