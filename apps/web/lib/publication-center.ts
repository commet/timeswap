import { classIdentityKey } from '@timeswap/engine';

import type {
  AbsenceCase,
  AdminTask,
  AdminTaskKind,
  Lesson,
  Publication,
  WorkspaceState,
} from './domain';
import {
  caseRevisionId,
  effectiveLessons,
  projectPublicClassSchedule,
  validateCasePlan,
  type PublicClassView,
} from './projections';
import {
  buildClassPublicationPreview,
  buildNeisInputList,
  buildTeacherNotice,
  changedLessonIdsOf,
  documentTeacherLabel,
} from './publication';

export type PublicationStage =
  | 'awaiting_approval'
  | 'administration'
  | 'ready'
  | 'published'
  | 'closed';

export interface PublicationTaskView {
  id: string;
  kind: AdminTaskKind;
  label: string;
  instruction: string;
  required: boolean;
  completed: boolean;
  completedAt?: string;
}

export interface PublicationCenterView {
  caseId: string;
  requesterLabel: string;
  stage: PublicationStage;
  stageLabel: string;
  /** Approval and publication are separate facts and are reported separately. */
  approved: boolean;
  canPublish: boolean;
  blockedReason?: string;
  tasks: PublicationTaskView[];
  neisInputList: string;
  teacherNotice: string;
  classPreview: PublicClassView[];
  changedLessonCount: number;
  affectedClassLabels: string[];
  affectedTeacherLabels: string[];
  publication?: Publication;
  supersedesCaseId?: string;
}

const TASK_COPY: Record<AdminTaskKind, { label: string; instruction: string }> = {
  neis: {
    label: '나이스 입력',
    instruction: '아래 목록을 나이스 시간표 변경 화면에 그대로 입력한 뒤 완료로 표시하십시오.',
  },
  teacher_notice: {
    label: '교사 안내',
    instruction: '안내 문구를 복사해 교무실 공지 통로로 보낸 뒤 완료로 표시하십시오.',
  },
  class_publication: {
    label: '학급 게시 확인',
    instruction: '게시 후 학급 시간표에 나갈 내용을 미리 확인하십시오.',
  },
  internal_document: {
    label: '내부 기록 출력',
    instruction: '결재 기록이 필요하면 출력한 뒤 직접 완료로 표시하십시오. 필수는 아닙니다.',
  },
};

const STAGE_LABEL: Record<PublicationStage, string> = {
  awaiting_approval: '승인 전',
  administration: '승인 완료 · 행정 마감 진행 중',
  ready: '행정 마감 완료 · 게시 대기',
  published: '게시 완료',
  closed: '종료된 사건',
};

const TASK_ORDER: readonly AdminTaskKind[] = [
  'neis',
  'teacher_notice',
  'class_publication',
  'internal_document',
];

function stageOf(absenceCase: AbsenceCase): PublicationStage {
  switch (absenceCase.status) {
    case 'draft':
    case 'submitted':
    case 'in_review':
      return 'awaiting_approval';
    case 'resolution_approved':
    case 'admin_in_progress':
      return 'administration';
    case 'ready_to_publish':
      return 'ready';
    case 'published':
      return 'published';
    default:
      return 'closed';
  }
}

function safeTeacherLabel(state: WorkspaceState, teacherId: string): string {
  return documentTeacherLabel(state, teacherId);
}

function taskViews(state: WorkspaceState, caseId: string): PublicationTaskView[] {
  const byKind = new Map<AdminTaskKind, AdminTask>();
  for (const task of state.adminTasks) {
    if (task.caseId === caseId) byKind.set(task.kind, task);
  }
  return TASK_ORDER.flatMap((kind) => {
    const task = byKind.get(kind);
    if (!task) return [];
    return [{
      id: task.id,
      kind,
      label: TASK_COPY[kind].label,
      instruction: TASK_COPY[kind].instruction,
      required: task.required,
      completed: task.status === 'completed',
      ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    }];
  });
}

function activePublicationOf(state: WorkspaceState, caseId: string): Publication | undefined {
  return [...state.publications]
    .filter((publication) => publication.caseId === caseId)
    .sort((left, right) => left.publishedAt.localeCompare(right.publishedAt))
    .at(-1);
}

/**
 * One read model for the publication step.  The publish control reads
 * `canPublish` only, so a screen can never offer publication that the domain
 * would refuse.
 */
export function projectPublicationCenter(
  state: WorkspaceState,
  caseId: string,
): PublicationCenterView {
  const absenceCase = state.cases.find((item) => item.id === caseId);
  if (!absenceCase) throw new Error(`Case does not exist: ${caseId}`);
  const stage = stageOf(absenceCase);
  const tasks = taskViews(state, caseId);
  const validation = validateCasePlan(state, caseId);
  // 그 사건의 주를 게시된 채로 본다. 이유는 `publication.ts` 의 `caseLessons` 옆에 적었다.
  const lessons = new Map(effectiveLessons(state, caseRevisionId(state, absenceCase))
    .map((lesson) => [lesson.id, lesson] as const));
  const changedLessonIds = changedLessonIdsOf(absenceCase);
  const changedLessons = changedLessonIds
    .flatMap((lessonId): Lesson[] => {
      const lesson = lessons.get(lessonId);
      return lesson ? [lesson] : [];
    });

  const pendingRequired = tasks.filter((task) => task.required && !task.completed);
  const blockedReason = stage === 'published' || stage === 'closed'
    ? undefined
    : stage === 'awaiting_approval'
      ? '해결안 승인 전에는 게시할 수 없습니다.'
      : pendingRequired.length > 0
        ? `필수 행정 과업 ${pendingRequired.length}건이 남았습니다.`
        : validation.staleRevision
          ? '시간표 버전이 바뀌어 다시 계산해야 합니다.'
          : !validation.valid
            ? validation.conflicts[0]?.message ?? '게시 전에 충돌을 해소해야 합니다.'
            : undefined;

  const affectedTeacherLabels = [...new Set(absenceCase.resolutionItems
    .filter((item) => item.kind !== 'unresolved')
    .flatMap((item) => item.changes)
    .flatMap((change) => change.teacher.state === 'assigned'
      ? [safeTeacherLabel(state, change.teacher.teacherId)]
      : []))].sort();
  const affectedClassLabels = [...new Set(changedLessons
    .map((lesson) => `${lesson.classIdentity.grade}학년 ${lesson.classIdentity.className}반`))]
    .sort();

  return {
    caseId,
    requesterLabel: safeTeacherLabel(state, absenceCase.requesterTeacherId),
    stage,
    stageLabel: STAGE_LABEL[stage],
    approved: stage !== 'awaiting_approval',
    canPublish: stage === 'ready' && !blockedReason,
    ...(blockedReason ? { blockedReason } : {}),
    tasks,
    neisInputList: buildNeisInputList(state, caseId),
    teacherNotice: buildTeacherNotice(state, caseId),
    classPreview: stage === 'published'
      ? [...new Set(changedLessons.map((lesson) => classIdentityKey(lesson.classIdentity)))]
        .sort()
        .map((classKey) => projectPublicClassSchedule(state, classKey))
      : buildClassPublicationPreview(state, caseId),
    changedLessonCount: changedLessonIds.length,
    affectedClassLabels,
    affectedTeacherLabels,
    ...(activePublicationOf(state, caseId)
      ? { publication: activePublicationOf(state, caseId)! }
      : {}),
    ...(absenceCase.supersedesCaseId ? { supersedesCaseId: absenceCase.supersedesCaseId } : {}),
  };
}

