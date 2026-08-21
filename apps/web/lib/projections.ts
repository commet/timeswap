import { classIdentityKey } from '@timeswap/engine';

import {
  CASE_STATUS_LABEL,
  canWithdrawCase,
} from './domain';
import type {
  AbsenceCase,
  CaseStatus,
  ClassIdentity,
  Lesson,
  Publication,
  ResolutionChange,
  TeacherAssignment,
  WorkspaceState,
} from './domain';
import { BURDEN_WEEKS, dateAtUtcOffset, mondayOf } from './week';

/**
 * 교사가 자기 요청을 보는 줄.
 *
 * 낸 사람 것만 뽑는다. 다른 사람 사건의 내부 값은 한 자도 안 들어간다.
 */
export interface TeacherCaseView {
  caseId: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: CaseStatus;
  statusLabel: string;
  /** 낸 사람이 스스로 적은 전달 사항. */
  note?: string;
  /** 반려 사유. 일과 담당이 적고 낸 사람이 읽는다. */
  rejectionNote?: string;
  lessonCount: number;
  withdrawable: boolean;
  updatedAt: string;
}

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

/**
 * 게시된 변경을 수업 번호로 찾는 표.
 *
 * 개정판을 안 가린다. 수업 번호에 개정판이 들어 있어 다른 주의 게시가 이 주 수업에
 * 걸릴 수 없다. 앞서는 활성 개정판만 봤는데, 그러면 주가 넘어가는 순간 지난주 게시가
 * 통째로 안 보인다. 지난주 격자가 게시 전 모습으로 되돌아가고, 그 위에서 정정 후보를
 * 고르면 이미 비운 자리를 차 있다고 보고 이미 찬 자리를 비었다고 본다.
 *
 * 같은 주를 다시 불러오면 개정판 번호가 같아 그 주 게시는 그대로 남는다.
 */
export function publishedChanges(state: WorkspaceState): Map<string, PublishedChange> {
  const byLesson = new Map<string, PublishedChange>();
  const publications = [...state.publications]
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

/**
 * 게시된 변경을 얹은 수업.
 *
 * 부재로 영향받는 수업을 고를 때 이것을 봐야 한다. 학교가 준 원래 표만 보면 두 가지가
 * 어긋난다.
 *
 * 보강을 맡은 사람이 그날 결강을 내면 그 보강 수업이 목록에 안 뜬다. 원래 표에서는
 * 그 수업의 담당이 여전히 남이기 때문이다. 아무도 다시 안 맡고, 그날 그 학급에 들어갈
 * 사람이 없어진다. 게시까지 끝난 뒤라 아무도 눈치채지 못한다.
 *
 * 반대로 이미 남에게 넘어간 수업이 원래 담당의 목록에 그대로 뜬다. 이미 해결된 수업을
 * 한 번 더 푸는 일이 된다.
 */
export function effectiveLessons(
  state: WorkspaceState,
  revisionId: string = state.workspace.activeRevisionId,
): Lesson[] {
  const published = publishedChanges(state);
  return state.lessons
    .filter((lesson) => lesson.revisionId === revisionId)
    .map((lesson) => {
      const moved = published.get(lesson.id);
      if (!moved) return lesson;
      return {
        ...lesson,
        date: moved.change.toDate,
        period: moved.change.toPeriod,
        teacher: moved.change.teacher,
      };
    });
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

/**
 * 그 교사가 낸 요청 목록.
 *
 * 교사 화면에 자기 요청이 하나도 안 보이고 있었다. 제출하면 "요청을 제출했습니다"가
 * 한 번 뜨고 끝이다. 승인됐는지 반려됐는지 알 길이 없고, 반려 사유는 일과 담당이
 * 반드시 적어야 하는 값인데 읽는 화면이 없었다. 적으라고 해 놓고 아무도 안 읽었다.
 *
 * 최근 것이 위로 온다. 끝난 요청도 남긴다. 반려 사유를 나중에 읽으러 오는 자리다.
 */
export function projectTeacherCases(
  state: WorkspaceState,
  teacherId: string,
): TeacherCaseView[] {
  return state.cases
    .filter((item) => item.requesterTeacherId === teacherId)
    .map((item) => ({
      caseId: item.id,
      fromDate: item.fromDate,
      toDate: item.toDate,
      reason: item.reason,
      status: item.status,
      statusLabel: CASE_STATUS_LABEL[item.status],
      ...(item.note ? { note: item.note } : {}),
      ...(item.rejectionNote ? { rejectionNote: item.rejectionNote } : {}),
      lessonCount: item.lessonIds.length,
      withdrawable: canWithdrawCase(item.status),
      updatedAt: item.updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)
      || right.fromDate.localeCompare(left.fromDate));
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
 *
 * 세는 기간은 이 주와 앞의 세 주다. 앞서는 기간 대신 활성 개정판으로 걸렀는데,
 * 개정판이 한 주씩 오므로 그것은 "이번 주만"과 같은 말이었다. 월요일 아침에 새 주를
 * 불러오면 모두의 협조 건수가 0으로 돌아갔다. 경고 문턱이 3건이라 한 주 안에 세 번
 * 도운 사람만 잡혔고, 세 주에 걸쳐 다섯 번 도운 사람은 한 번도 안 잡혔다.
 */
function deriveBurden(state: WorkspaceState, today: string): TeacherBurdenView[] {
  const from = dateAtUtcOffset(mondayOf(today), -7 * (BURDEN_WEEKS - 1));
  const counts = new Map<string, number>();
  for (const absenceCase of state.cases) {
    if (!RESERVING_STATUSES.has(absenceCase.status)) continue;
    if (absenceCase.toDate < from) continue;
    for (const resolution of absenceCase.resolutionItems) {
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
  const burden = deriveBurden(state, today);

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

/**
 * 사건이 딛고 선 개정판.
 *
 * 개정판은 한 주씩 온다. 사건은 그 주의 수업을 가리키므로, 사건을 재는 기준은 지금
 * 화면에 띄운 주가 아니라 그 사건의 수업이 온 주다.
 *
 * 기준을 활성 개정판으로 두면 이렇게 된다. 금요일 오후에 부재가 올라와 승인까지 났고
 * 행정 마감이 남아 주말을 넘긴다. 월요일 아침에 이번 주 시간표를 불러오면 활성
 * 개정판이 바뀐다. 그 순간 지난 금요일 사건은 옛 개정판을 가리키는 것이 되어
 * `staleRevision` 이 서고, 게시가 막힌다. 다시 계산하면 되는가 하면 그것도 안 된다.
 * 후보를 만들 때 보는 수업이 이번 주 것뿐이라 그 사건의 결강 수업이 아예 안 보이고,
 * 후보가 0개로 나온다. 승인까지 갔던 사건을 되살릴 길이 없어진다.
 *
 * 수업은 지난주 것까지 남겨 두고 있다. 남아 있는데 아무도 안 보는 것이 문제였다.
 */
export function caseRevisionId(state: WorkspaceState, absenceCase: AbsenceCase): string {
  const revisionByLesson = new Map(state.lessons.map((lesson) => [lesson.id, lesson.revisionId]));
  for (const lessonId of absenceCase.lessonIds) {
    const revisionId = revisionByLesson.get(lessonId);
    if (revisionId) return revisionId;
  }
  // 수업이 이미 지워졌으면 해결안이 계산된 개정판을 쓴다. 그것도 없으면 활성판이다.
  return absenceCase.resolutionItems.find((item) => item.computedAgainstRevisionId)
    ?.computedAgainstRevisionId
    ?? state.workspace.activeRevisionId;
}

export function validateCasePlan(state: WorkspaceState, caseId: string): PlanValidation {
  const absenceCase = state.cases.find((item) => item.id === caseId);
  if (!absenceCase) throw new Error(`Case does not exist: ${caseId}`);
  const revisionId = caseRevisionId(state, absenceCase);
  const activeRevision = state.revisions.find((revision) => revision.id === revisionId);
  const activeLessons = state.lessons.filter((lesson) => lesson.revisionId === revisionId);
  /*
   * 수업 찾기는 개정판을 안 가린다. 수업 번호에 개정판이 들어 있어 겹치지 않고,
   * 다른 주 사건이 잡아 둔 자리도 그 학급과 병렬 묶음까지 읽어야 제대로 판정한다.
   */
  const lessonsById = new Map(state.lessons.map((lesson) => [lesson.id, lesson]));
  const staleRevision = absenceCase.resolutionItems.some((item) =>
    !item.computedAgainstRevisionId
    || item.computedAgainstRevisionId !== revisionId);
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
    && group.revisionId === revisionId);
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
  // 다른 사건은 그 사건의 개정판으로 잰다. 지난주 사건이 이번 주를 불러왔다는
  // 이유만으로 "점유 상태 미확정"이 되면, 그 사건이 잡은 자리가 빈 자리로 보인다.
  const planIsProven = (itemCase: AbsenceCase): boolean => {
    const itemRevisionId = caseRevisionId(state, itemCase);
    return Boolean(state.revisions.find((revision) => revision.id === itemRevisionId)?.complete)
      && itemCase.resolutionItems.every((item) =>
        item.computedAgainstRevisionId === itemRevisionId)
      && itemCase.lessonIds.every((lessonId) => resolutionCoversLesson(itemCase, lessonId))
      && atomicViolations(itemCase).length === 0
      && caseMovements(itemCase).every((movement) =>
        movement.lesson && movement.change.teacher.state === 'assigned');
  };

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
  /*
   * 이 사건이 손대는 수업.
   *
   * 게시된 사건이 이미 옮겨 놓은 수업을 이 사건이 다시 옮긴다면, 그 수업의 자리는
   * 이 사건이 새로 정한다. 게시는 **이미 일어난 일**이지 앞으로 잡아 둔 자리가 아니다.
   *
   * 그러지 않으면 한 번 게시된 수업은 그 주 내내 못 움직인다. 월요일에 낸 변경이
   * 게시된 뒤 수요일에 다른 사람이 결강을 내면서 그 수업을 또 옮겨야 하는 일이
   * 흔한데, "다른 사건의 승인된 해결안에 이미 포함되었습니다"로 막혔다. 보강을 맡은
   * 사람이 그날 결강을 내는 경우도 여기로 온다.
   *
   * 승인만 나고 아직 게시 전인 사건은 그대로 막는다. 그쪽은 아직 안 일어난 계획이라
   * 두 계획이 한 수업을 두고 다투는 것이 맞다.
   */
  const candidateLessonIds = new Set(candidateMovements.map((movement) =>
    movement.change.lessonId));
  const acceptedPlans = acceptedCases.map((itemCase) => ({
    itemCase,
    movements: caseMovements(itemCase).filter((movement) =>
      !(itemCase.status === 'published' && candidateLessonIds.has(movement.change.lessonId))),
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
