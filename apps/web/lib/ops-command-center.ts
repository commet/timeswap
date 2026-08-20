import {
  DEMO_SCENARIOS,
  type DemoScenarioDefinition,
} from './demo';
import type { AbsenceCase, Lesson, WorkspaceState } from './domain';
import {
  effectiveLessons,
  projectOpsDashboard,
  validateCasePlan,
  type OpsDashboardView,
  type PlanValidation,
} from './projections';

export type OpsCasePriority =
  | 'same-day-unresolved'
  | 'stale-or-invalid'
  | 'submitted'
  | 'administrative-delay'
  | 'future';

export interface OpsCaseView {
  caseId: string;
  requesterLabel: string;
  status: AbsenceCase['status'];
  fromDate: string;
  toDate: string;
  affectedLessonCount: number;
  solvedLessonCount: number;
  priority: OpsCasePriority;
  priorityReason: string;
  validation: PlanValidation;
  intersectingCaseIds: string[];
  dataWarnings: string[];
}

export interface OpsTimelineMarker {
  id: string;
  caseId: string;
  period: string;
  state: 'unresolved' | 'invalid' | 'review' | 'admin' | 'future';
  stateLabel: string;
  affectedTeacherCount: number;
  affectedClassCount: number;
}

export interface OpsCommandCenterView {
  dashboard: OpsDashboardView;
  cases: OpsCaseView[];
  timeline: OpsTimelineMarker[];
}

const ACTIVE_CASE_STATUSES = new Set<AbsenceCase['status']>([
  'draft', 'submitted', 'in_review', 'resolution_approved', 'admin_in_progress', 'ready_to_publish',
]);

function safeTeacherLabel(state: WorkspaceState, teacherId: string): string {
  const label = state.teacherLabels?.[teacherId]?.trim();
  return label && !/^(?:member|teacher):/i.test(label) ? label : '요청 교사';
}

/*
 * 게시된 변경을 얹은 표를 쓴다. 오늘 막대를 원래 날짜로 그리면 게시로 오늘 옮겨 온
 * 수업이 안 보이고, 오늘에서 떠난 수업이 그대로 남는다. 일과 담당이 오늘 무슨 일이
 * 있는지 보려고 여는 화면이 바로 이것이다. 이유는 `projections.ts` 의
 * `effectiveLessons` 옆에 적었다.
 */
const activeLessons = effectiveLessons;

function lessonIsSolved(absenceCase: AbsenceCase, lessonId: string): boolean {
  return absenceCase.resolutionItems.some((item) => item.kind !== 'unresolved'
    && (item.changes.some((change) => change.lessonId === lessonId)
      || (item.kind === 'manual' && item.lessonId === lessonId && Boolean(item.manualAction?.trim()))));
}

function statusLabel(priority: OpsCasePriority): string {
  switch (priority) {
    case 'same-day-unresolved': return '미해결';
    case 'stale-or-invalid': return '재검증 필요';
    case 'submitted': return '검토 대기';
    case 'administrative-delay': return '행정 대기';
    case 'future': return '예정';
  }
}

function priorityFor(
  absenceCase: AbsenceCase,
  today: string,
  validation: PlanValidation,
): Pick<OpsCaseView, 'priority' | 'priorityReason'> {
  const unresolved = absenceCase.lessonIds.some((lessonId) => !lessonIsSolved(absenceCase, lessonId));
  if (absenceCase.fromDate <= today && today <= absenceCase.toDate && unresolved) {
    return { priority: 'same-day-unresolved', priorityReason: '오늘 해결되지 않은 수업이 있습니다.' };
  }
  if ((absenceCase.status === 'submitted' || absenceCase.status === 'in_review')
    && absenceCase.resolutionItems.length > 0 && !validation.valid) {
    return { priority: 'stale-or-invalid', priorityReason: '현재 시간표에서 해결안을 다시 검증해야 합니다.' };
  }
  if (absenceCase.status === 'submitted' || absenceCase.status === 'in_review') {
    return { priority: 'submitted', priorityReason: '담당자의 검토와 결정이 필요합니다.' };
  }
  if (absenceCase.status === 'resolution_approved'
    || absenceCase.status === 'admin_in_progress'
    || absenceCase.status === 'ready_to_publish') {
    return { priority: 'administrative-delay', priorityReason: '승인 뒤 행정 마감이 남아 있습니다.' };
  }
  return { priority: 'future', priorityReason: '다음 변경 시점 전에 확인할 사건입니다.' };
}

function warningMessages(
  state: WorkspaceState,
  absenceCase: AbsenceCase,
  validation: PlanValidation,
): string[] {
  const revision = state.revisions.find((item) => item.id === state.workspace.activeRevisionId);
  const affected = new Set(absenceCase.lessonIds);
  const warnings = [
    ...(revision?.complete ? [] : ['공식 시간표 완전성이 확인되지 않았습니다.']),
    ...(activeLessons(state).some((lesson) => affected.has(lesson.id) && lesson.teacher.state === 'unassigned')
      ? ['담당 교사가 확정되지 않은 수업이 있습니다.'] : []),
    ...validation.conflicts.map((conflict) => conflict.message),
  ];
  return [...new Set(warnings)];
}

function intersections(absenceCase: AbsenceCase, cases: readonly AbsenceCase[]): string[] {
  const lessonIds = new Set(absenceCase.lessonIds);
  return cases
    .filter((other) => other.id !== absenceCase.id)
    .filter((other) => other.lessonIds.some((lessonId) => lessonIds.has(lessonId))
      || (other.fromDate <= absenceCase.toDate && absenceCase.fromDate <= other.toDate))
    .map((other) => other.id)
    .sort();
}

function periodSort(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber - rightNumber
    : left.localeCompare(right);
}

export function projectOpsCommandCenter(state: WorkspaceState, today: string): OpsCommandCenterView {
  const dashboard = projectOpsDashboard(state, today);
  const lessonsById = new Map(activeLessons(state).map((lesson) => [lesson.id, lesson]));
  const activeCases = state.cases.filter((absenceCase) => ACTIVE_CASE_STATUSES.has(absenceCase.status));
  const cases = activeCases.map((absenceCase) => {
    const validation = validateCasePlan(state, absenceCase.id);
    const priority = priorityFor(absenceCase, today, validation);
    return {
      caseId: absenceCase.id,
      requesterLabel: safeTeacherLabel(state, absenceCase.requesterTeacherId),
      status: absenceCase.status,
      fromDate: absenceCase.fromDate,
      toDate: absenceCase.toDate,
      affectedLessonCount: absenceCase.lessonIds.length,
      solvedLessonCount: absenceCase.lessonIds.filter((lessonId) => lessonIsSolved(absenceCase, lessonId)).length,
      ...priority,
      validation,
      intersectingCaseIds: intersections(absenceCase, activeCases),
      dataWarnings: warningMessages(state, absenceCase, validation),
    } satisfies OpsCaseView;
  }).sort((left, right) => {
    const priorityOrder: Record<OpsCasePriority, number> = {
      'same-day-unresolved': 0,
      'stale-or-invalid': 1,
      submitted: 2,
      'administrative-delay': 3,
      future: 4,
    };
    return priorityOrder[left.priority] - priorityOrder[right.priority]
      || left.fromDate.localeCompare(right.fromDate)
      || left.caseId.localeCompare(right.caseId);
  });

  const byCase = new Map(cases.map((item) => [item.caseId, item]));
  const timeline = activeCases.flatMap((absenceCase) => {
    const item = byCase.get(absenceCase.id);
    if (!item) return [];
    const changedToday = absenceCase.lessonIds.flatMap((lessonId) => {
      const lesson = lessonsById.get(lessonId);
      return lesson?.date === today ? [lesson] : [];
    });
    const byPeriod = new Map<string, Lesson[]>();
    for (const lesson of changedToday) {
      byPeriod.set(lesson.period, [...(byPeriod.get(lesson.period) ?? []), lesson]);
    }
    return [...byPeriod.entries()].map(([period, affectedLessons]) => {
      const affectedTeacherIds = new Set(affectedLessons.map((lesson) =>
        lesson.teacher.state === 'assigned' ? lesson.teacher.teacherId : absenceCase.requesterTeacherId));
      const affectedClassIds = new Set(affectedLessons.map((lesson) => JSON.stringify(lesson.classIdentity)));
      return {
        id: `${absenceCase.id}:${period}`,
        caseId: absenceCase.id,
        period,
        state: item.priority === 'same-day-unresolved' ? 'unresolved'
          : item.priority === 'stale-or-invalid' ? 'invalid'
            : item.priority === 'administrative-delay' ? 'admin'
              : item.priority === 'future' ? 'future' : 'review',
        stateLabel: statusLabel(item.priority),
        affectedTeacherCount: affectedTeacherIds.size,
        affectedClassCount: affectedClassIds.size,
      } satisfies OpsTimelineMarker;
    });
  }).sort((left, right) => periodSort(left.period, right.period)
    || left.caseId.localeCompare(right.caseId)
    || left.id.localeCompare(right.id));

  return { dashboard, cases, timeline };
}

export function operationalDemoScenarios(): readonly DemoScenarioDefinition[] {
  return DEMO_SCENARIOS.filter((scenario) => scenario.surface === 'command-center'
    && scenario.id !== 'simple-swap');
}

export function canResetDemoWorkspace(state: WorkspaceState): boolean {
  return state.revisions.some((revision) => revision.id === state.workspace.activeRevisionId
    && revision.source === 'demo')
    && 'demo' in state;
}
