import type {
  AbsenceCase,
  Lesson,
  ResolutionChange,
  ResolutionItem,
  WorkspaceState,
} from './domain';
import {
  coverCandidates as rankedCoverCandidates,
  recommend,
  type Assignment,
  type CoverCandidate,
  type TimetableInput,
  type TraceEntry,
} from '@timeswap/engine';
import { publishedChanges, validateCasePlan } from './projections';

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
  /** Engine ordering evidence for generated exchange or cover rows. */
  engineScore?: number;
  engineTrace?: TraceEntry[];
}

export interface ResolutionDetail {
  groupedUnitCount: number;
  collaborators: string[];
  warningReasons: string[];
  engineScore?: number;
  engineTrace: TraceEntry[];
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
  return label && !/^(?:member|teacher):/i.test(label) ? label : '협조 교사';
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

interface CoverGroup {
  lessons: Lesson[];
  atomic: boolean;
}

function coverGroup(
  state: WorkspaceState,
  lesson: Lesson,
): CoverGroup {
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
  return { lessons: groupedLessons, atomic: Boolean(atomicGroup) };
}

interface EngineCandidateFacts {
  item: ResolutionItem;
  engineScore: number;
  engineTrace: TraceEntry[];
  warningReasons?: string[];
}

interface ResolutionCandidate {
  item: ResolutionItem;
  engineScore?: number;
  engineTrace?: TraceEntry[];
  warningReasons?: string[];
}

interface TargetWeekInput {
  input: TimetableInput;
  lessonByAssignment: Map<Assignment, Lesson>;
  assignmentByLessonId: Map<string, Assignment>;
  monday: string;
}

function dateAtUtcOffset(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDay();
  return dateAtUtcOffset(date, day === 0 ? -6 : 1 - day);
}

function dayIndex(date: string, monday: string): number {
  return Math.round((Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${monday}T00:00:00.000Z`)) / 86_400_000);
}

function classKey(lesson: Pick<Lesson, 'classIdentity'>): string {
  const identity = lesson.classIdentity;
  return [
    identity.schoolCode,
    identity.academicYear,
    identity.dayCourse,
    identity.affiliation,
    identity.major,
    identity.grade,
    identity.className,
  ].join('\u0001');
}

/** Unifies parallel and atomic relationships into engine-recognized unit ids. */
function engineGroupIds(state: WorkspaceState, lessons: readonly Lesson[]): Map<string, string> {
  const lessonIds = new Set(lessons.map((lesson) => lesson.id));
  const parent = new Map([...lessonIds].map((lessonId) => [lessonId, lessonId]));
  const grouped = new Set<string>();
  const rootOf = (lessonId: string): string => {
    const parentId = parent.get(lessonId);
    if (!parentId || parentId === lessonId) return lessonId;
    const root = rootOf(parentId);
    parent.set(lessonId, root);
    return root;
  };
  const join = (lessonIdsToJoin: readonly string[]) => {
    const visible = lessonIdsToJoin.filter((lessonId) => lessonIds.has(lessonId));
    if (!visible.length) return;
    for (const lessonId of visible) grouped.add(lessonId);
    for (const lessonId of visible.slice(1)) parent.set(rootOf(lessonId), rootOf(visible[0]!));
  };
  for (const lesson of lessons) {
    if (!lesson.parallelGroupId) continue;
    join(lessons.filter((item) => item.parallelGroupId === lesson.parallelGroupId).map((item) => item.id));
  }
  for (const group of state.atomicLessonGroups ?? []) {
    if (group.workspaceId === state.workspace.id && group.revisionId === state.workspace.activeRevisionId) {
      join(group.lessonIds);
    }
  }
  return new Map([...grouped].map((lessonId) => [lessonId, `canonical:${rootOf(lessonId)}`]));
}

/**
 * 그 주에 못 오시는 분과 그 시간.
 *
 * 부재를 낼 때 그 기간의 수업을 골라 담는다. 하루를 통째로 비우기도 하고 회의처럼
 * 두어 시간만 비우기도 한다. 그래서 "그날은 온종일 못 오신다"고 단정할 수 없다.
 * 자료가 확실히 말해 주는 것은 담긴 수업의 그 교시뿐이다. 딱 거기까지만 막는다.
 *
 * 이것을 엔진에 안 넘기고 있었다. 그래서 결강난 1교시 수업을 같은 분의 결강난
 * 3교시 자리로 옮기라는 안이 나올 수 있었다. 두 자리 다 그분이 못 맡는 자리다.
 * 원래 있던 수업을 함께 옮기는 계획이면 자리가 비어 보여서 충돌 검사에도 안 걸린다.
 *
 * 반려, 취소, 대체된 사건은 세지 않는다. 그 부재는 없던 일이 되었다.
 */
function unavailableOf(
  state: WorkspaceState,
  monday: string,
  periods: number,
): Record<string, number[]> {
  const ignored = new Set<AbsenceCase['status']>(['rejected', 'cancelled', 'superseded']);
  const lessonById = new Map(activeLessons(state).map((lesson) => [lesson.id, lesson]));
  const slots = new Map<string, Set<number>>();
  for (const absenceCase of state.cases) {
    if (ignored.has(absenceCase.status)) continue;
    for (const lessonId of absenceCase.lessonIds) {
      const lesson = lessonById.get(lessonId);
      if (!lesson) continue;
      const day = dayIndex(lesson.date, monday);
      const period = Number(lesson.period) - 1;
      if (day < 0 || day >= 5 || period < 0 || period >= periods) continue;
      const own =
        slots.get(absenceCase.requesterTeacherId) ??
        slots.set(absenceCase.requesterTeacherId, new Set()).get(absenceCase.requesterTeacherId)!;
      own.add(day * periods + period);
    }
  }
  return Object.fromEntries(
    [...slots].map(([teacherId, own]) => [teacherId, [...own].sort((left, right) => left - right)]),
  );
}

/** 부담을 세는 기간. 이 주와 앞의 세 주다. */
const BURDEN_WEEKS = 4;

/**
 * 최근에 누가 얼마나 자리를 내어 주었는지.
 *
 * 엔진은 이 값으로 교체 점수와 보강 순위를 깎는다. 세 번 연달아 부탁받은 분이
 * 한 번도 안 받은 분과 같은 자리에 오르면 도구를 오래 쓸 수 없다. 그런데 화면에서
 * 쓰는 길은 이 값을 한 번도 넘기지 않아, 부담 균형이 늘 0으로 계산되고 있었다.
 * "최근에 이미 맡으셨습니다" 경고도 그래서 한 번도 뜨지 않았다.
 *
 * 무게는 옛 화면이 쓰던 것을 그대로 옮겼다. 보강은 한 시간을 그냥 더 맡는 일이라
 * 교체보다 무거운 부탁이므로 두 번으로 센다. 결강 당사자는 세지 않는다. 자기
 * 수업을 옮긴 것이지 남을 도운 것이 아니다.
 *
 * 승인 전 사건은 세지 않는다. 반려되거나 취소될 수 있고, 아직 아무도 실제로
 * 자리를 내어 주지 않았다.
 */
function recentBurdenOf(state: WorkspaceState, monday: string): Record<string, number> {
  const counted = new Set<AbsenceCase['status']>([
    'resolution_approved',
    'admin_in_progress',
    'ready_to_publish',
    'published',
  ]);
  const from = dateAtUtcOffset(monday, -7 * (BURDEN_WEEKS - 1));
  const to = dateAtUtcOffset(monday, 6);
  const burden: Record<string, number> = {};
  const add = (teacherId: string, weight: number): void => {
    burden[teacherId] = (burden[teacherId] ?? 0) + weight;
  };
  for (const absenceCase of state.cases) {
    if (!counted.has(absenceCase.status)) continue;
    if (absenceCase.toDate < from || absenceCase.fromDate > to) continue;
    for (const item of absenceCase.resolutionItems) {
      if (item.kind === 'cover') {
        for (const teacherId of new Set(item.changes.filter(isAssigned)
          .map((change) => change.teacher.teacherId))) {
          if (teacherId !== absenceCase.requesterTeacherId) add(teacherId, 2);
        }
        continue;
      }
      if (item.kind !== 'move' && item.kind !== 'swap2' && item.kind !== 'cycle3') continue;
      for (const teacherId of new Set(item.changes.filter(isAssigned)
        .map((change) => change.teacher.teacherId))) {
        if (teacherId !== absenceCase.requesterTeacherId) add(teacherId, 1);
      }
    }
  }
  return burden;
}

/** Builds the active calendar week without turning unknown teacher rows into free class time. */
export function targetWeekInput(state: WorkspaceState, targetDate: string): TargetWeekInput {
  const monday = mondayOf(targetDate);
  /*
   * 이미 게시된 변경을 격자에 얹는다.
   *
   * `activeLessons` 는 학교가 준 원래 시간표다. 지난주에 낸 변경이 게시되어 3교시
   * 수업이 4교시로 옮겨 갔어도 여기서는 그대로 3교시다. 그 격자로 다음 안을 찾으면
   * 이미 비어 있는 3교시는 차 있다고 보고, 이미 찬 4교시는 비었다고 본다.
   *
   * 뒤의 충돌 검사가 잘못된 안을 걸러 내기는 한다. 그러나 엔진은 그 전에 다섯 개를
   * 골라 순위를 매긴다. 틀린 격자로 고른 다섯이라 좋은 자리를 아예 못 보고 지나간다.
   *
   * 게시된 것만 얹는다. 결재 중인 변경은 아직 확정이 아니고, 지금 풀고 있는 사건
   * 자신의 변경까지 얹으면 두 번 적용된다. 그쪽은 충돌 검사가 맡는다.
   */
  const published = publishedChanges(state);
  const lessons = activeLessons(state)
    .map((lesson) => {
      const moved = published.get(lesson.id);
      if (!moved) return lesson;
      return {
        ...lesson,
        date: moved.change.toDate,
        period: moved.change.toPeriod,
        teacher: moved.change.teacher,
      };
    })
    .filter((lesson) => {
      const day = dayIndex(lesson.date, monday);
      return day >= 0 && day < 5;
    });
  const periods = Math.max(7, ...lessons.map((lesson) => Number(lesson.period) || 1));
  const input: TimetableInput = {
    config: { days: 5, periods, dayNames: ['월', '화', '수', '목', '금'] },
    assignments: [],
  };
  const groups = engineGroupIds(state, lessons);
  const lessonByAssignment = new Map<Assignment, Lesson>();
  const assignmentByLessonId = new Map<string, Assignment>();
  const busy = new Map<string, Set<number>>();
  for (const lesson of lessons) {
    const day = dayIndex(lesson.date, monday);
    const period = Number(lesson.period) - 1;
    if (period < 0 || period >= periods) continue;
    const slot = day * periods + period;
    const klass = classKey(lesson);
    if (lesson.teacher.state === 'unassigned') {
      const slots = busy.get(klass) ?? new Set<number>();
      slots.add(slot);
      busy.set(klass, slots);
      continue;
    }
    const assignment: Assignment = {
      teacher: lesson.teacher.teacherId,
      klass,
      subject: lesson.subject,
      slot,
      ...(groups.has(lesson.id) ? { group: groups.get(lesson.id) } : {}),
    };
    input.assignments.push(assignment);
    lessonByAssignment.set(assignment, lesson);
    assignmentByLessonId.set(lesson.id, assignment);
  }
  if (busy.size) {
    input.klassBusy = Object.fromEntries([...busy].map(([klass, slots]) => [klass, [...slots]]));
  }

  /*
   * 자료에 없는 날과 교시는 빈 자리가 아니다.
   *
   * 나이스가 한 주를 다 주지 않거나 그날이 휴업일이면 그 요일이 통째로 비어 온다.
   * 그것을 빈 자리로 세면 도구는 자료가 없는 날로 옮기라는 안을 내고, 재어 보니
   * 그 안이 맨 위에 왔다. 모르는 자리를 빈 자리로 세는 잘못이며 이 저장소에서
   * 되풀이되는 모양이다.
   *
   * 담당 교사를 모르는 수업도 함께 센다. 누가 맡는지 몰라도 그 교시가 있다는 사실은
   * 그 줄이 증명한다.
   */
  const lastOfDay = new Array<number>(5).fill(0);
  const gradeLast = new Map<string, number[]>();
  const gradeKlasses = new Map<string, Set<string>>();
  for (const lesson of lessons) {
    const day = dayIndex(lesson.date, monday);
    const period = Number(lesson.period);
    if (day < 0 || day >= 5 || !Number.isInteger(period) || period < 1 || period > periods) continue;
    if (period > lastOfDay[day]!) lastOfDay[day] = period;
    const grade = lesson.classIdentity.grade;
    const arr = gradeLast.get(grade) ?? gradeLast.set(grade, new Array<number>(5).fill(0)).get(grade)!;
    if (period > arr[day]!) arr[day] = period;
    (gradeKlasses.get(grade) ?? gradeKlasses.set(grade, new Set()).get(grade)!).add(classKey(lesson));
  }
  if (lastOfDay.some((last) => last < periods)) input.config.periodsPerDay = lastOfDay;

  /*
   * 학년으로 재고 학급에 붙인다. 엔진이 나이스 자료에 쓰는 것과 같은 규칙이다.
   * 학급 하나만 보면 그저 비어 있는 칸과 그 학년에 없는 교시를 가릴 수 없다.
   * 그래서 학급이 하나뿐인 학년에는 안 붙인다.
   */
  const klassPeriodsPerDay: Record<string, number[]> = {};
  for (const [grade, arr] of gradeLast) {
    const klasses = gradeKlasses.get(grade);
    if (!klasses || klasses.size < 2) continue;
    if (arr.every((last, day) => last === (input.config.periodsPerDay?.[day] ?? periods))) continue;
    for (const klass of klasses) klassPeriodsPerDay[klass] = arr;
  }
  if (Object.keys(klassPeriodsPerDay).length > 0) input.klassPeriodsPerDay = klassPeriodsPerDay;
  const activeRevision = state.revisions.find((revision) => revision.id === state.workspace.activeRevisionId);
  const closures = (activeRevision?.closures ?? []).flatMap((closure) => {
    const day = dayIndex(closure.date, monday);
    if (day < 0 || day >= 5) return [];
    const klasses = closure.classIdentities?.map((identity) => classKey({ classIdentity: identity }));
    return [{ day, reason: closure.reason, ...(klasses?.length ? { klasses } : {}) }];
  });
  if (closures.length) input.closures = closures;
  const unavailable = unavailableOf(state, monday, periods);
  if (Object.keys(unavailable).length > 0) input.unavailable = unavailable;

  const recentBurden = recentBurdenOf(state, monday);
  if (Object.keys(recentBurden).length > 0) input.recentBurden = recentBurden;

  return { input, lessonByAssignment, assignmentByLessonId, monday };
}

function redactedTrace(state: WorkspaceState, trace: readonly TraceEntry[]): TraceEntry[] {
  const teachers = [...new Set(activeLessons(state).flatMap((lesson) =>
    lesson.teacher.state === 'assigned' ? [lesson.teacher.teacherId] : []))]
    .sort((left, right) => right.length - left.length);
  return trace.map((entry) => ({
    ...entry,
    text: teachers.reduce((text, teacherId) => text.replaceAll(teacherId, teacherLabel(state, teacherId)), entry.text),
  }));
}

function engineExchangeCandidates(state: WorkspaceState, lesson: Lesson): EngineCandidateFacts[] {
  if (lesson.teacher.state !== 'assigned') return [];
  const week = targetWeekInput(state, lesson.date);
  const target = week.assignmentByLessonId.get(lesson.id);
  if (!target) return [];
  try {
    return recommend(week.input, { teacher: target.teacher, slot: target.slot }, { max: 5 }).candidates.flatMap((candidate) => {
      const changes = candidate.changes.flatMap((change) => {
        const source = week.lessonByAssignment.get(change.from);
        const day = Math.floor(change.toSlot / week.input.config.periods);
        if (!source || day < 0 || day >= 5) return [];
        return [{
          lessonId: source.id,
          toDate: dateAtUtcOffset(week.monday, day),
          toPeriod: String((change.toSlot % week.input.config.periods) + 1),
          teacher: source.teacher,
        }];
      });
      if (changes.length !== candidate.changes.length) return [];
      const fingerprint = changes.map((change) =>
        `${change.lessonId}:${change.toDate}:${change.toPeriod}`).join('|');
      return [{
        item: {
          id: `candidate:engine:${lesson.id}:${candidate.type}:${fingerprint}`,
          lessonId: lesson.id,
          kind: candidate.type,
          computedAgainstRevisionId: state.workspace.activeRevisionId,
          changes,
        },
        engineScore: candidate.score,
        engineTrace: redactedTrace(state, candidate.trace),
      }];
    });
  } catch {
    return [];
  }
}

function coverWarningReasons(candidates: readonly CoverCandidate[]): string[] {
  return [...new Set(candidates.flatMap((candidate) => candidate.notes.filter((note) =>
    (candidate.dayLessons > 4 && note.includes('이미'))
    || (candidate.runAfter >= 3 && note.includes('내리'))
    || (candidate.recentBurden > 0 && note.includes('최근'))
    || (!candidate.proTeacher && note.includes('어렵')),
  )))];
}

function coverTrace(state: WorkspaceState, candidates: readonly CoverCandidate[]): TraceEntry[] {
  const notes = new Map<string, TraceEntry>();
  for (const candidate of candidates) {
    for (const text of candidate.notes) {
      if (notes.has(text)) continue;
      const warning = coverWarningReasons([candidate]).includes(text);
      notes.set(text, {
        kind: warning ? '감점' : candidate.sameSubject ? '가점' : '조건',
        text,
      });
    }
  }
  return redactedTrace(state, [...notes.values()]);
}

/** Uses the same target-week engine input as exchanges so cover ranking stays canonical. */
function engineCoverCandidates(
  state: WorkspaceState,
  absenceCase: AbsenceCase,
  lesson: Lesson,
): EngineCandidateFacts[] {
  const week = targetWeekInput(state, lesson.date);
  const group = coverGroup(state, lesson);
  const candidateLists = group.lessons.map((grouped) => {
    const assignment = week.assignmentByLessonId.get(grouped.id);
    if (!assignment) return [];
    return rankedCoverCandidates(
      week.input,
      assignment.slot,
      grouped.subject,
      Math.max(8, week.input.assignments.length),
      absenceCase.requesterTeacherId,
    );
  });
  if (!candidateLists.length || candidateLists.some((candidates) => !candidates.length)) return [];

  const candidatesByTeacher = candidateLists.map((candidates) =>
    new Map(candidates.map((candidate) => [candidate.teacher, candidate])));
  const sharedTeachers = candidateLists[0]!
    .map((candidate) => candidate.teacher)
    .filter((teacherId) => candidatesByTeacher.every((candidates) => candidates.has(teacherId)));

  return sharedTeachers.map((teacherId) => {
    const ranked = candidatesByTeacher.map((candidates) => candidates.get(teacherId)!);
    return {
      item: {
        id: `candidate:engine-cover:${lesson.id}:${teacherId}`,
        lessonId: lesson.id,
        kind: 'cover' as const,
        computedAgainstRevisionId: state.workspace.activeRevisionId,
        changes: group.lessons.map((grouped) => ({
          lessonId: grouped.id,
          toDate: grouped.date,
          toPeriod: grouped.period,
          teacher: grouped.id === lesson.id || group.atomic
            ? { state: 'assigned' as const, teacherId }
            : grouped.teacher,
        })),
      },
      engineScore: ranked.reduce((score, candidate) => score + candidate.score, 0),
      engineTrace: coverTrace(state, ranked),
      warningReasons: coverWarningReasons(ranked),
    };
  }).sort((left, right) => right.engineScore - left.engineScore
    || left.item.id.localeCompare(right.item.id, 'ko'));
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

function toRow(
  state: WorkspaceState,
  lesson: Lesson,
  candidate: ResolutionCandidate,
): ResolutionRow {
  const { item } = candidate;
  const collaborators = [...new Set(item.changes
    .filter(isAssigned)
    .map((change) => change.teacher.teacherId)
    .filter((teacherId) => lesson.teacher.state !== 'assigned' || teacherId !== lesson.teacher.teacherId))]
    .map((teacherId) => teacherLabel(state, teacherId));
  const warnings = [...new Set([
    ...warningReasons(state, lesson, item),
    ...(candidate.warningReasons ?? []),
  ])];
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
    ...(candidate.engineScore === undefined ? {} : {
      engineScore: candidate.engineScore,
      engineTrace: candidate.engineTrace ?? [],
    }),
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

  const generatedExchange = engineExchangeCandidates(state, lesson);
  const existingExchange = absenceCase.resolutionItems
    .filter((item) => item.lessonId === lessonId
      && (item.kind === 'move' || item.kind === 'swap2' || item.kind === 'cycle3'))
    .map((item) => ({ item }));
  const existingCover = absenceCase.resolutionItems
    .filter((item) => item.lessonId === lessonId && item.kind === 'cover')
    .map((item) => ({ item }));
  const validExchanges = [...existingExchange, ...generatedExchange]
    .filter((candidate) => !hardInvalid(state, absenceCase, candidate.item));
  const generatedCover = validExchanges.length < 3
    ? engineCoverCandidates(state, absenceCase, lesson)
    : [];
  const retainedExistingCover = validExchanges.length < 3 ? existingCover : [];
  const candidates: ResolutionCandidate[] = [
    ...validExchanges,
    ...generatedCover,
    ...retainedExistingCover,
  ];
  const unique = new Map<string, ResolutionCandidate>();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.item.kind, candidate.item.changes]);
    if (!unique.has(key)) unique.set(key, candidate);
  }
  const rows = [...unique.values()]
    .filter((candidate) => !hardInvalid(state, absenceCase, candidate.item))
    .map((candidate) => toRow(state, lesson, candidate))
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
    engineTrace: row.engineTrace ?? [],
    ...(row.engineScore === undefined ? {} : { engineScore: row.engineScore }),
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
