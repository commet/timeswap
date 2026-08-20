import { classIdentityKey } from '@timeswap/engine';

import type {
  AbsenceCase,
  ClassIdentity,
  Lesson,
  Publication,
  ResolutionChange,
  TeacherAssignment,
  WorkspaceState,
} from './domain';

export interface TeacherLessonValue {
  date: string;
  period: string;
  teacherId: string | null;
  subject: string;
  room: string;
  classIdentity: ClassIdentity;
  caseId?: string;
  publicationId?: string;
  publishedAt?: string;
}

export interface TeacherScheduleLessonView {
  lessonId: string;
  subject: string;
  room: string;
  classIdentity: ClassIdentity;
  status: 'base' | '변경 예정' | 'published';
  base: TeacherLessonValue;
  pending?: TeacherLessonValue;
  published?: TeacherLessonValue;
}

export interface TeacherScheduleView {
  teacherId: string;
  lessons: TeacherScheduleLessonView[];
}

export interface OpsSourceHealthView {
  activeRevisionId: string;
  source: 'neis' | 'school_file' | 'demo' | null;
  loadedAt: string | null;
  complete: boolean;
  lessonCount: number;
  unassignedLessons: number;
}

export interface TeacherBurdenView {
  teacherId: string;
  acceptedChanges: number;
}

export interface OpsDashboardView {
  today: string;
  todayChanges: number;
  unresolvedLessons: number;
  pendingCases: number;
  neisTasks: number;
  publicationTasks: number;
  burdenAlerts: number;
  burden: TeacherBurdenView[];
  sourceHealth: OpsSourceHealthView;
}

export interface PlanValidation {
  valid: boolean;
  staleRevision: boolean;
  conflicts: Array<{
    lessonId: string;
    kind:
      | 'teacher'
      | 'class'
      | 'closure'
      | 'unknown-occupancy'
      | 'parallel-group'
      | 'atomic-group';
    message: string;
  }>;
}

export interface PublicClassLessonView {
  lessonId: string;
  date: string;
  period: string;
  subject: string;
  room: string;
  changed: boolean;
  originalDate?: string;
  originalPeriod?: string;
  originalSubject?: string;
  publicationId?: string;
  publishedAt?: string;
}

export interface PublicClassView {
  workspaceId: string;
  schoolName: string;
  classKey: string;
  lessons: PublicClassLessonView[];
  lastPublishedAt?: string;
  /**
   * 이 학급이 수업하지 않는 날과 그 안내 문구.
   *
   * 학사일정과 시간표에서 온 쉬는 날이다. 여름방학, 개교기념일, 재량휴업일처럼 학교가
   * 이미 공개한 사실만 들어온다. 누가 왜 빠졌는지는 여기 오지 않는다.
   *
   * 공개 화면이 사건 자료를 직접 뒤지지 않게 하려고 여기서 만들어 넘긴다. 무엇을
   * 내보내도 되는지 정하는 자리를 한 곳에 둔다.
   */
  closedDays: Array<{ date: string; note: string }>;
}

interface PublishedChange {
  change: ResolutionChange;
  publication: Publication;
}

interface PendingChange {
  change: ResolutionChange;
  absenceCase: AbsenceCase;
}

const RESERVING_STATUSES = new Set<AbsenceCase['status']>([
  'resolution_approved',
  'admin_in_progress',
  'ready_to_publish',
  'published',
]);

const PENDING_STATUSES = new Set<AbsenceCase['status']>([
  'resolution_approved',
  'admin_in_progress',
  'ready_to_publish',
]);

const ACTIONABLE_STATUSES = new Set<AbsenceCase['status']>([
  'submitted',
  'in_review',
  'resolution_approved',
  'admin_in_progress',
  'ready_to_publish',
]);

function resolutionCoversLesson(absenceCase: AbsenceCase, lessonId: string): boolean {
  return absenceCase.resolutionItems.some((item) => {
    if (item.kind === 'unresolved') return false;
    if (item.changes.some((change) => change.lessonId === lessonId)) return true;
    return item.kind === 'manual'
      && item.lessonId === lessonId
      && Boolean(item.manualAction?.trim());
  });
}

export function publishedChanges(state: WorkspaceState): Map<string, PublishedChange> {
  const byLesson = new Map<string, PublishedChange>();
  const publications = [...state.publications]
    .filter((publication) => publication.revisionId === state.workspace.activeRevisionId)
    .sort((left, right) => left.publishedAt.localeCompare(right.publishedAt));

  for (const publication of publications) {
    const absenceCase = state.cases.find((item) =>
      item.id === publication.caseId && item.status === 'published');
    if (!absenceCase) continue;
    const allowedLessonIds = new Set(publication.changedLessonIds);
    for (const resolution of absenceCase.resolutionItems) {
      for (const change of resolution.changes) {
        if (allowedLessonIds.has(change.lessonId)) {
          byLesson.set(change.lessonId, { change, publication });
        }
      }
    }
  }

  return byLesson;
}

function pendingChanges(state: WorkspaceState): Map<string, PendingChange> {
  const byLesson = new Map<string, PendingChange>();
  const cases = [...state.cases]
    .filter((absenceCase) => PENDING_STATUSES.has(absenceCase.status))
    .filter((absenceCase) => absenceCase.resolutionItems.every((item) =>
      item.computedAgainstRevisionId === state.workspace.activeRevisionId))
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

  for (const absenceCase of cases) {
    for (const resolution of absenceCase.resolutionItems) {
      if (resolution.kind === 'unresolved') continue;
      for (const change of resolution.changes) {
        byLesson.set(change.lessonId, { change, absenceCase });
      }
    }
  }

  return byLesson;
}

function teacherId(lesson: Lesson): string | null {
  return lesson.teacher.state === 'assigned' ? lesson.teacher.teacherId : null;
}

function changeTeacherId(change: ResolutionChange): string | null {
  return change.teacher.state === 'assigned' ? change.teacher.teacherId : null;
}

function comparePeriod(left: string, right: string): number {
  const leftPeriod = Number(left);
  const rightPeriod = Number(right);
  if (Number.isFinite(leftPeriod) && Number.isFinite(rightPeriod)) return leftPeriod - rightPeriod;
  return left.localeCompare(right);
}

export function projectTeacherSchedule(
  state: WorkspaceState,
  requestedTeacherId: string,
): TeacherScheduleView {
  const pending = pendingChanges(state);
  const published = publishedChanges(state);
  const lessons = state.lessons
    .filter((lesson) => lesson.revisionId === state.workspace.activeRevisionId)
    .flatMap((lesson): TeacherScheduleLessonView[] => {
      const pendingChange = pending.get(lesson.id);
      const publishedChange = published.get(lesson.id);
      const baseValue: TeacherLessonValue = {
        date: lesson.date,
        period: lesson.period,
        teacherId: teacherId(lesson),
        subject: lesson.subject,
        room: lesson.room,
        classIdentity: { ...lesson.classIdentity },
      };
      const pendingValue: TeacherLessonValue | undefined = pendingChange ? {
        date: pendingChange.change.toDate,
        period: pendingChange.change.toPeriod,
        teacherId: changeTeacherId(pendingChange.change),
        subject: lesson.subject,
        room: lesson.room,
        classIdentity: { ...lesson.classIdentity },
        caseId: pendingChange.absenceCase.id,
      } : undefined;
      const publishedValue: TeacherLessonValue | undefined = publishedChange ? {
        date: publishedChange.change.toDate,
        period: publishedChange.change.toPeriod,
        teacherId: changeTeacherId(publishedChange.change),
        subject: lesson.subject,
        room: lesson.room,
        classIdentity: { ...lesson.classIdentity },
        publicationId: publishedChange.publication.id,
        publishedAt: publishedChange.publication.publishedAt,
      } : undefined;
      if (![baseValue, pendingValue, publishedValue]
        .some((value) => value?.teacherId === requestedTeacherId)) return [];

      return [{
        lessonId: lesson.id,
        subject: lesson.subject,
        room: lesson.room,
        classIdentity: { ...lesson.classIdentity },
        status: pendingValue ? '변경 예정' : publishedValue ? 'published' : 'base',
        base: baseValue,
        pending: pendingValue,
        published: publishedValue,
      }];
    })
    .sort((left, right) => {
      const leftValue = left.pending ?? left.published ?? left.base;
      const rightValue = right.pending ?? right.published ?? right.base;
      return leftValue.date.localeCompare(rightValue.date)
        || comparePeriod(leftValue.period, rightValue.period)
        || left.lessonId.localeCompare(right.lessonId);
    });

  return { teacherId: requestedTeacherId, lessons };
}

function unresolvedLessonCount(state: WorkspaceState): number {
  let count = 0;
  for (const absenceCase of state.cases) {
    if (!ACTIONABLE_STATUSES.has(absenceCase.status)) continue;
    for (const lessonId of absenceCase.lessonIds) {
      if (!resolutionCoversLesson(absenceCase, lessonId)) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * 최근에 자리를 내어 준 분과 그 횟수. 관제판의 부담 경고에 쓴다.
 *
 * 결강 당사자는 세지 않는다. 자기 수업을 옮긴 것이지 남을 도운 것이 아니다.
 * 그런데 세고 있었다. 빈 교시 이동은 바뀌는 수업이 당사자 것 하나뿐이라, 부재를
 * 세 번 낸 분이 "협조 3건"으로 잡혀 부담 경고에 올랐다. 도움을 받은 쪽이 도와준
 * 쪽으로 뒤집혀 보이던 셈이다.
 *
 * 한 해결안에서 같은 분의 수업이 둘 움직이면 둘로 센다. 이 값의 이름이 "협조 건수"
 * 이고 화면도 건수로 읽는다. 수업 셋을 옮기는 것은 하나를 옮기는 것보다 무겁다.
 */
function deriveBurden(state: WorkspaceState): TeacherBurdenView[] {
  const counts = new Map<string, number>();
  for (const absenceCase of state.cases) {
    if (!RESERVING_STATUSES.has(absenceCase.status)) continue;
    for (const resolution of absenceCase.resolutionItems) {
      if (resolution.computedAgainstRevisionId !== state.workspace.activeRevisionId) continue;
      for (const change of resolution.changes) {
        if (change.teacher.state !== 'assigned') continue;
        if (change.teacher.teacherId === absenceCase.requesterTeacherId) continue;
        counts.set(change.teacher.teacherId, (counts.get(change.teacher.teacherId) ?? 0) + 1);
      }
    }
  }
  return [...counts]
    .map(([burdenTeacherId, acceptedChanges]) => ({
      teacherId: burdenTeacherId,
      acceptedChanges,
    }))
    .filter((item) => item.acceptedChanges >= 3)
    .sort((left, right) => right.acceptedChanges - left.acceptedChanges
      || left.teacherId.localeCompare(right.teacherId));
}

export function projectOpsDashboard(state: WorkspaceState, today: string): OpsDashboardView {
  const activeRevision = state.revisions.find((revision) =>
    revision.id === state.workspace.activeRevisionId);
  const activeLessons = state.lessons.filter((lesson) =>
    lesson.revisionId === state.workspace.activeRevisionId);
  const burden = deriveBurden(state);

  return {
    today,
    todayChanges: [...publishedChanges(state).values()]
      .filter(({ change }) => change.toDate === today).length,
    unresolvedLessons: unresolvedLessonCount(state),
    pendingCases: state.cases.filter((absenceCase) =>
      absenceCase.status === 'submitted' || absenceCase.status === 'in_review').length,
    neisTasks: state.adminTasks.filter((task) =>
      task.kind === 'neis' && task.status === 'pending').length,
    publicationTasks: state.adminTasks.filter((task) =>
      task.kind === 'class_publication' && task.status === 'pending').length,
    burdenAlerts: burden.length,
    burden,
    sourceHealth: {
      activeRevisionId: state.workspace.activeRevisionId,
      source: activeRevision?.source ?? null,
      loadedAt: activeRevision?.loadedAt ?? null,
      complete: activeRevision?.complete ?? false,
      lessonCount: activeLessons.length,
      unassignedLessons: activeLessons.filter((lesson) =>
        lesson.teacher.state === 'unassigned').length,
    },
  };
}

export function validateCasePlan(state: WorkspaceState, caseId: string): PlanValidation {
  const absenceCase = state.cases.find((item) => item.id === caseId);
  if (!absenceCase) throw new Error(`Case does not exist: ${caseId}`);
  const activeRevision = state.revisions.find((revision) =>
    revision.id === state.workspace.activeRevisionId);
  const activeLessons = state.lessons.filter((lesson) =>
    lesson.revisionId === state.workspace.activeRevisionId);
  const lessonsById = new Map(activeLessons.map((lesson) => [lesson.id, lesson]));
  const staleRevision = absenceCase.resolutionItems.some((item) =>
    !item.computedAgainstRevisionId
    || item.computedAgainstRevisionId !== state.workspace.activeRevisionId);
  const conflicts: PlanValidation['conflicts'] = [];
  const conflictKeys = new Set<string>();

  const addConflict = (
    lessonId: string,
    kind: PlanValidation['conflicts'][number]['kind'],
    message: string,
  ): void => {
    const key = JSON.stringify([lessonId, kind, message]);
    if (conflictKeys.has(key)) return;
    conflictKeys.add(key);
    conflicts.push({ lessonId, kind, message });
  };

  for (const lessonId of absenceCase.lessonIds) {
    if (!resolutionCoversLesson(absenceCase, lessonId)) {
      addConflict(
        lessonId,
        'unknown-occupancy',
        '선택된 해결안이 없어 점유 상태를 확정할 수 없습니다.',
      );
    }
  }

  if (!activeRevision?.complete) {
    for (const lessonId of absenceCase.lessonIds) {
      addConflict(
        lessonId,
        'unknown-occupancy',
        '활성 시간표 버전의 완전성이 확인되지 않았습니다.',
      );
    }
  }

  interface PlannedMovement {
    change: ResolutionChange;
    lesson?: Lesson;
  }
  interface Occupancy {
    lessonId: string;
    date: string;
    period: string;
    classIdentity?: ClassIdentity;
    teacher: TeacherAssignment;
    parallelGroupId?: string;
    known: boolean;
  }

  const identityEquals = (left: ClassIdentity, right: ClassIdentity): boolean =>
    left.schoolCode === right.schoolCode
    && left.academicYear === right.academicYear
    && left.dayCourse === right.dayCourse
    && left.affiliation === right.affiliation
    && left.major === right.major
    && left.grade === right.grade
    && left.className === right.className;

  const movementKey = (movement: PlannedMovement): string => JSON.stringify([
    movement.change.lessonId,
    movement.change.toDate,
    movement.change.toPeriod,
    movement.change.teacher.state,
    movement.change.teacher.state === 'assigned'
      ? movement.change.teacher.teacherId
      : null,
  ]);
  const caseMovements = (itemCase: AbsenceCase): PlannedMovement[] => {
    const unique = new Map<string, PlannedMovement>();
    for (const item of itemCase.resolutionItems) {
      if (item.kind === 'unresolved') continue;
      for (const change of item.changes) {
        const movement = { change, lesson: lessonsById.get(change.lessonId) };
        unique.set(movementKey(movement), movement);
      }
    }
    return [...unique.values()];
  };
  const activeAtomicGroups = (state.atomicLessonGroups ?? []).filter((group) =>
    group.workspaceId === state.workspace.id
    && group.revisionId === state.workspace.activeRevisionId);
  const atomicViolations = (itemCase: AbsenceCase): Array<{
    lessonId: string;
    message: string;
  }> => {
    const violations: Array<{ lessonId: string; message: string }> = [];
    const selectedLessonIds = new Set(itemCase.lessonIds);
    for (const group of activeAtomicGroups) {
      const selectedMembers = group.lessonIds.filter((lessonId) => selectedLessonIds.has(lessonId));
      if (selectedMembers.length > 0 && selectedMembers.length !== group.lessonIds.length) {
        violations.push({
          lessonId: selectedMembers[0]!,
          message: '연속 실습 묶음 전체를 한 사건에서 함께 선택해야 합니다.',
        });
      }

      const groupLessonIds = new Set(group.lessonIds);
      const sourceLessons = group.lessonIds
        .map((lessonId) => lessonsById.get(lessonId))
        .filter((item): item is Lesson => Boolean(item))
        .sort((left, right) => left.date.localeCompare(right.date)
          || Number(left.period) - Number(right.period)
          || left.id.localeCompare(right.id));
      for (const item of itemCase.resolutionItems) {
        const changedLessonIds = new Set(item.changes.map((change) => change.lessonId));
        const touchesGroup = groupLessonIds.has(item.lessonId)
          || group.lessonIds.some((lessonId) => changedLessonIds.has(lessonId));
        if (!touchesGroup) continue;

        if (group.lessonIds.some((lessonId) => !changedLessonIds.has(lessonId))) {
          violations.push({
            lessonId: item.lessonId,
            message: '연속 실습 묶음 전체를 하나의 해결안으로 선택해야 합니다.',
          });
          continue;
        }

        const changesByLessonId = new Map(item.changes.map((change) => [change.lessonId, change]));
        const destinations = sourceLessons.map((source) => changesByLessonId.get(source.id)!);
        const destinationDate = destinations[0]?.toDate;
        const consecutive = sourceLessons.length === group.lessonIds.length
          && destinations.every((change) => change?.toDate === destinationDate)
          && destinations.every((change, index) => {
            const period = Number(change?.toPeriod);
            return Number.isInteger(period)
              && (index === 0 || period === Number(destinations[index - 1]?.toPeriod) + 1);
          });
        const manualStaysAtOriginalSlots = item.kind !== 'manual'
          || sourceLessons.every((source) => {
            const change = changesByLessonId.get(source.id);
            return change?.toDate === source.date && change.toPeriod === source.period;
          });
        if (!consecutive || !manualStaysAtOriginalSlots) {
          violations.push({
            lessonId: item.lessonId,
            message: item.kind === 'manual'
              ? '수동 처리도 연속 실습 묶음 전체를 원래 연속 교시에 유지해야 합니다.'
              : '연속 실습 묶음은 같은 날짜의 이어지는 교시 순서를 유지해야 합니다.',
          });
        }
      }
    }
    return violations;
  };
  for (const violation of atomicViolations(absenceCase)) {
    addConflict(violation.lessonId, 'atomic-group', violation.message);
  }
  const planIsProven = (itemCase: AbsenceCase): boolean =>
    Boolean(activeRevision?.complete)
    && itemCase.resolutionItems.every((item) =>
      item.computedAgainstRevisionId === state.workspace.activeRevisionId)
    && itemCase.lessonIds.every((lessonId) => resolutionCoversLesson(itemCase, lessonId))
    && atomicViolations(itemCase).length === 0
    && caseMovements(itemCase).every((movement) =>
      movement.lesson && movement.change.teacher.state === 'assigned');

  const candidateMovements = caseMovements(absenceCase);
  const changedLessonDestinations = new Map<string, string>();
  for (const movement of candidateMovements) {
    const priorDestination = changedLessonDestinations.get(movement.change.lessonId);
    const destination = JSON.stringify([
      movement.change.toDate,
      movement.change.toPeriod,
      movement.change.teacher,
    ]);
    if (priorDestination && priorDestination !== destination) {
      addConflict(
        movement.change.lessonId,
        'unknown-occupancy',
        '하나의 수업에 서로 다른 이동이 선택되었습니다.',
      );
    }
    changedLessonDestinations.set(movement.change.lessonId, destination);
    if (!movement.lesson) {
      addConflict(
        movement.change.lessonId,
        'unknown-occupancy',
        '활성 시간표 버전에서 이동할 수업을 확인할 수 없습니다.',
      );
    }
    if (movement.change.teacher.state === 'unassigned') {
      addConflict(
        movement.change.lessonId,
        'unknown-occupancy',
        '담당 교사가 확정되지 않아 점유 상태를 판정할 수 없습니다.',
      );
    }
  }

  const acceptedCases = state.cases.filter((item) =>
    item.id !== absenceCase.id
    && item.id !== absenceCase.supersedesCaseId
    && RESERVING_STATUSES.has(item.status));
  const acceptedPlans = acceptedCases.map((itemCase) => ({
    itemCase,
    movements: caseMovements(itemCase),
    proven: planIsProven(itemCase),
  }));
  for (const movement of candidateMovements) {
    const accepted = acceptedPlans.find((plan) => plan.movements.some((item) =>
      item.change.lessonId === movement.change.lessonId));
    if (!accepted) continue;
    addConflict(
      movement.change.lessonId,
      accepted.proven ? 'class' : 'unknown-occupancy',
      accepted.proven
        ? '해당 수업은 다른 사건의 승인된 해결안에 이미 포함되었습니다.'
        : '해당 수업은 점유 상태가 확정되지 않은 승인 사건에 포함되었습니다.',
    );
  }
  const removedLessonIds = new Set(candidateMovements
    .flatMap((movement) => movement.lesson ? [movement.lesson.id] : []));
  for (const accepted of acceptedPlans) {
    if (!accepted.proven) continue;
    for (const movement of accepted.movements) {
      if (movement.lesson) removedLessonIds.add(movement.lesson.id);
    }
  }

  const occupancyByDate = new Map<string, Map<string, Occupancy[]>>();
  const addOccupancy = (occupancy: Occupancy): void => {
    let byPeriod = occupancyByDate.get(occupancy.date);
    if (!byPeriod) {
      byPeriod = new Map<string, Occupancy[]>();
      occupancyByDate.set(occupancy.date, byPeriod);
    }
    byPeriod.set(occupancy.period, [...(byPeriod.get(occupancy.period) ?? []), occupancy]);
  };
  const occupanciesAt = (date: string, period: string): Occupancy[] =>
    occupancyByDate.get(date)?.get(period) ?? [];

  for (const lesson of activeLessons) {
    if (removedLessonIds.has(lesson.id)) continue;
    addOccupancy({
      lessonId: lesson.id,
      date: lesson.date,
      period: lesson.period,
      classIdentity: lesson.classIdentity,
      teacher: lesson.teacher,
      ...(lesson.parallelGroupId ? { parallelGroupId: lesson.parallelGroupId } : {}),
      known: true,
    });
  }
  for (const accepted of acceptedPlans) {
    for (const movement of accepted.movements) {
      addOccupancy({
        lessonId: movement.change.lessonId,
        date: movement.change.toDate,
        period: movement.change.toPeriod,
        ...(movement.lesson ? { classIdentity: movement.lesson.classIdentity } : {}),
        teacher: movement.change.teacher,
        ...(movement.lesson?.parallelGroupId
          ? { parallelGroupId: movement.lesson.parallelGroupId }
          : {}),
        known: accepted.proven,
      });
    }
  }

  for (const movement of candidateMovements) {
    const { change, lesson } = movement;
    if (!lesson) continue;

    if (lesson.parallelGroupId) {
      const groupMembers = activeLessons.filter((item) =>
        item.parallelGroupId === lesson.parallelGroupId);
      const groupMovements = candidateMovements.filter((item) =>
        item.lesson?.parallelGroupId === lesson.parallelGroupId);
      const movedMemberIds = new Set(groupMovements.map((item) => item.change.lessonId));
      const sameDestination = groupMovements.every((item) =>
        item.change.toDate === change.toDate && item.change.toPeriod === change.toPeriod);
      if (groupMembers.some((member) => !movedMemberIds.has(member.id)) || !sameDestination) {
        addConflict(
          change.lessonId,
          'parallel-group',
          '병렬 수업 묶음 전체를 같은 시간으로 이동해야 합니다.',
        );
      }
    }

    const closure = activeRevision?.closures?.find((item) =>
      item.date === change.toDate
      && (!item.classIdentities?.length
        || item.classIdentities.some((identity) => identityEquals(identity, lesson.classIdentity))));
    if (closure) {
      addConflict(
        change.lessonId,
        'closure',
        `${change.toDate}은 수업 운영 제외일입니다: ${closure.reason}`,
      );
    }

    for (const occupied of occupanciesAt(change.toDate, change.toPeriod)) {
      if (!occupied.known || occupied.teacher.state === 'unassigned') {
        addConflict(
          change.lessonId,
          'unknown-occupancy',
          `${change.toDate} ${change.toPeriod}교시에 담당이 확정되지 않은 수업이 있습니다.`,
        );
      }
      if (change.teacher.state === 'assigned'
        && occupied.teacher.state === 'assigned'
        && change.teacher.teacherId === occupied.teacher.teacherId) {
        addConflict(
          change.lessonId,
          'teacher',
          `${change.toDate} ${change.toPeriod}교시에 해당 교사의 수업이 있습니다.`,
        );
      }
      const sameParallelGroup = Boolean(lesson.parallelGroupId)
        && lesson.parallelGroupId === occupied.parallelGroupId;
      if (occupied.classIdentity
        && identityEquals(lesson.classIdentity, occupied.classIdentity)
        && !sameParallelGroup) {
        addConflict(
          change.lessonId,
          'class',
          `${change.toDate} ${change.toPeriod}교시에 해당 학급의 수업이 있습니다.`,
        );
      }
    }

    addOccupancy({
      lessonId: change.lessonId,
      date: change.toDate,
      period: change.toPeriod,
      classIdentity: lesson.classIdentity,
      teacher: change.teacher,
      ...(lesson.parallelGroupId ? { parallelGroupId: lesson.parallelGroupId } : {}),
      known: change.teacher.state === 'assigned',
    });
  }

  return {
    valid: !staleRevision && conflicts.length === 0,
    staleRevision,
    conflicts,
  };
}

function publicLesson(lesson: Lesson, published?: PublishedChange): PublicClassLessonView {
  if (!published) {
    return {
      lessonId: lesson.id,
      date: lesson.date,
      period: lesson.period,
      subject: lesson.subject,
      room: lesson.room,
      changed: false,
    };
  }

  return {
    lessonId: lesson.id,
    date: published.change.toDate,
    period: published.change.toPeriod,
    subject: lesson.subject,
    room: lesson.room,
    changed: true,
    originalDate: lesson.date,
    originalPeriod: lesson.period,
    originalSubject: lesson.subject,
    publicationId: published.publication.id,
    publishedAt: published.publication.publishedAt,
  };
}

export function projectPublicClassSchedule(
  state: WorkspaceState,
  classKey: string,
): PublicClassView {
  const changes = publishedChanges(state);
  const lessons = state.lessons
    .filter((lesson) => lesson.revisionId === state.workspace.activeRevisionId
      && classIdentityKey(lesson.classIdentity) === classKey)
    .map((lesson) => publicLesson(lesson, changes.get(lesson.id)))
    .sort((left, right) => left.date.localeCompare(right.date)
      || left.period.localeCompare(right.period)
      || left.lessonId.localeCompare(right.lessonId));
  const publishedAt = lessons
    .flatMap((lesson) => lesson.publishedAt ? [lesson.publishedAt] : [])
    .sort()
    .at(-1);

  const activeRevision = state.revisions.find(
    (revision) => revision.id === state.workspace.activeRevisionId,
  );
  const closedDays = (activeRevision?.closures ?? [])
    .filter((closure) => !closure.classIdentities?.length
      || closure.classIdentities.some((identity) => classIdentityKey(identity) === classKey))
    .map((closure) => ({ date: closure.date, note: closure.reason }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    workspaceId: state.workspace.id,
    schoolName: state.workspace.name,
    classKey,
    lessons,
    closedDays,
    ...(publishedAt ? { lastPublishedAt: publishedAt } : {}),
  };
}
