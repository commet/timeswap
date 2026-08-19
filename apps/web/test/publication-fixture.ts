import type { ClassIdentity } from '@timeswap/engine';

import {
  completeAdminTask,
  createAbsenceCase,
  createPrototypeAdminTasks,
  replaceCaseResolution,
  transitionCase,
} from '../lib/case-service';
import type { Lesson, ResolutionItem, WorkspaceState } from '../lib/domain';

export const classIdentity: ClassIdentity = {
  schoolCode: 'school-1',
  academicYear: '2026',
  dayCourse: '주간',
  affiliation: '공업계',
  major: '정보통신과',
  grade: '2',
  className: '1',
};

export const lessons: Lesson[] = [1, 2, 3, 4].map((period) => ({
  id: `lesson-${period}`,
  workspaceId: 'workspace-1',
  revisionId: 'revision-1',
  date: '2026-08-24',
  period: String(period),
  classIdentity,
  subject: period === 1 ? '정보 통신' : '프로그래밍',
  room: '2-1',
  teacher: { state: 'assigned', teacherId: 'teacher-1' },
}));

export const initialState = (): WorkspaceState => ({
  schemaVersion: 2,
  workspace: {
    id: 'workspace-1',
    name: '조율고등학교',
    activeRevisionId: 'revision-1',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  },
  teacherLabels: { 'teacher-1': '김조율', 'teacher-2': '박보강' },
  revisions: [{
    id: 'revision-1',
    workspaceId: 'workspace-1',
    source: 'neis',
    loadedAt: '2026-08-18T00:00:00.000Z',
    complete: true,
    checksum: 'checksum-1',
  }],
  lessons: [...lessons],
  cases: [],
  adminTasks: [],
  publications: [],
  audit: [],
});

export const coverResolution = (
  lessonId = 'lesson-1',
  teacherId = 'teacher-2',
): ResolutionItem => ({
  id: `resolution-${lessonId}`,
  lessonId,
  kind: 'cover',
  computedAgainstRevisionId: 'revision-1',
  changes: [{
    lessonId,
    toDate: '2026-08-24',
    toPeriod: lessonId === 'lesson-1' ? '1' : '2',
    teacher: { state: 'assigned', teacherId },
  }],
});

/** Walks the canonical transitions so publication tests start from real state. */
export const readyToPublish = (options: {
  resolution?: ResolutionItem;
  completeTasks?: boolean;
  suffix?: string;
} = {}): WorkspaceState => {
  const suffix = options.suffix ?? 'a';
  const created = createAbsenceCase(initialState(), {
    id: 'case-1',
    auditEventId: `audit-created-${suffix}`,
    workspaceId: 'workspace-1',
    requesterTeacherId: 'teacher-1',
    fromDate: '2026-08-24',
    toDate: '2026-08-24',
    reason: '업무상 부재',
    lessonIds: ['lesson-1'],
    at: '2026-08-18T01:00:00.000Z',
  });
  const submitted = transitionCase(created, {
    caseId: 'case-1', to: 'submitted', actorId: 'teacher-1',
    at: '2026-08-18T01:01:00.000Z', auditEventId: `audit-submitted-${suffix}`,
  });
  const inReview = transitionCase(submitted, {
    caseId: 'case-1', to: 'in_review', actorId: 'operator-1',
    at: '2026-08-18T01:02:00.000Z', auditEventId: `audit-review-${suffix}`,
  });
  const resolved = replaceCaseResolution(inReview, {
    caseId: 'case-1', resolution: options.resolution ?? coverResolution(),
    actorId: 'operator-1', at: '2026-08-18T01:03:00.000Z',
    auditEventId: `audit-resolution-${suffix}`,
  });
  const approved = transitionCase(resolved, {
    caseId: 'case-1', to: 'resolution_approved', actorId: 'operator-1',
    at: '2026-08-18T01:04:00.000Z', auditEventId: `audit-approved-${suffix}`,
  });
  const withTasks = createPrototypeAdminTasks(approved, {
    caseId: 'case-1', actorId: 'operator-1', at: '2026-08-18T01:05:00.000Z',
    auditEventId: `audit-admin-${suffix}`, taskAuditEventId: `audit-tasks-${suffix}`,
    taskIds: {
      neis: 'task-neis',
      teacher_notice: 'task-notice',
      class_publication: 'task-class',
      internal_document: 'task-internal',
    },
  });
  if (options.completeTasks === false) return withTasks;

  return ['task-neis', 'task-notice', 'task-class'].reduce((state, taskId, index) =>
    completeAdminTask(state, {
      taskId, actorId: 'operator-1',
      at: `2026-08-18T01:1${index}:00.000Z`,
      auditEventId: `audit-task-${taskId}-${suffix}`,
    }), withTasks);
};
