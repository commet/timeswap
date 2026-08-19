import type {
  AbsenceCase,
  AdminTask,
  AdminTaskKind,
  CaseStatus,
  Lesson,
  ResolutionItem,
  WorkspaceState,
} from './domain';
import type { SaveResult } from './repository';
import { validateCasePlan } from './projections';

export interface CreateAbsenceCaseInput {
  id: string;
  auditEventId: string;
  workspaceId: string;
  requesterTeacherId: string;
  fromDate: string;
  toDate: string;
  reason: AbsenceCase['reason'];
  note?: string;
  lessonIds: string[];
  resolutionItems?: ResolutionItem[];
  at: string;
}

export interface CaseOperationContext {
  caseId: string;
  actorId: string;
  at: string;
  auditEventId: string;
}

export interface TransitionCaseInput extends CaseOperationContext {
  to: CaseStatus;
  rejectionNote?: string;
  supersessionAuditEventId?: string;
}

export type DeleteCaseInput = CaseOperationContext;

export const PROTOTYPE_REQUIRED_ADMIN_TASKS = [
  'neis',
  'teacher_notice',
  'class_publication',
] as const satisfies readonly AdminTaskKind[];

const PROTOTYPE_ADMIN_TASKS = [
  ...PROTOTYPE_REQUIRED_ADMIN_TASKS,
  'internal_document',
] as const satisfies readonly AdminTaskKind[];

export interface CreatePrototypeAdminTasksInput extends CaseOperationContext {
  taskAuditEventId: string;
  taskIds: Record<AdminTaskKind, string>;
}

export interface CompleteAdminTaskInput {
  taskId: string;
  actorId: string;
  at: string;
  auditEventId: string;
}

export interface CreateCorrectionCaseInput {
  sourceCaseId: string;
  id: string;
  actorId: string;
  at: string;
  auditEventId: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The canonical base schedule owns absence selection.  Publication and
 * approval projections may change what a teacher sees, but they must never
 * make an unassigned or another teacher's lesson claimable in a new case.
 */
export function lessonsAffectedByAbsence(
  lessons: Lesson[],
  teacherId: string,
  fromDate: string,
  toDate: string,
): Lesson[] {
  return lessons
    .filter((lesson) => lesson.teacher.state === 'assigned'
      && lesson.teacher.teacherId === teacherId
      && lesson.date >= fromDate
      && lesson.date <= toDate)
    .sort((left, right) => left.date.localeCompare(right.date)
      || Number(left.period) - Number(right.period)
      || left.id.localeCompare(right.id));
}

export function findDuplicateAbsenceCase(
  state: WorkspaceState,
  input: Pick<CreateAbsenceCaseInput, 'requesterTeacherId' | 'fromDate' | 'toDate' | 'lessonIds'>,
): AbsenceCase | undefined {
  const selected = [...input.lessonIds].sort();
  return state.cases.find((item) => item.requesterTeacherId === input.requesterTeacherId
    && item.fromDate === input.fromDate
    && item.toDate === input.toDate
    && item.lessonIds.length === selected.length
    && [...item.lessonIds].sort().every((lessonId, index) => lessonId === selected[index]));
}

function isISODate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function assertTimestamp(value: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error('A canonical ISO timestamp is required.');
  }
}

function validateContext(state: WorkspaceState, input: CaseOperationContext): void {
  if (!input.actorId.trim()) throw new Error('An actor id is required.');
  assertTimestamp(input.at);
  if (state.audit.some((item) => item.id === input.auditEventId)) {
    throw new Error('Audit event id already exists.');
  }
}

function findCase(state: WorkspaceState, caseId: string): AbsenceCase {
  const absenceCase = state.cases.find((item) => item.id === caseId);
  if (!absenceCase) throw new Error(`Case does not exist: ${caseId}`);
  return absenceCase;
}

function validateCreation(state: WorkspaceState, input: CreateAbsenceCaseInput): void {
  if (input.workspaceId !== state.workspace.id) {
    throw new Error('The case must belong to the active workspace.');
  }
  if (!input.requesterTeacherId.trim()) throw new Error('A requester teacher is required.');
  if (!isISODate(input.fromDate) || !isISODate(input.toDate) || input.fromDate > input.toDate) {
    throw new Error('A valid ordered ISO date range is required.');
  }
  assertTimestamp(input.at);
  if (input.lessonIds.length === 0) throw new Error('At least one affected lesson is required.');
  if (new Set(input.lessonIds).size !== input.lessonIds.length) {
    throw new Error('Affected lesson ids must be unique.');
  }
  if (state.cases.some((item) => item.id === input.id)) throw new Error('Case id already exists.');
  if (state.audit.some((item) => item.id === input.auditEventId)) {
    throw new Error('Audit event id already exists.');
  }

  for (const lessonId of input.lessonIds) {
    const lesson = state.lessons.find((item) => item.id === lessonId);
    if (!lesson) throw new Error(`Affected lesson does not exist: ${lessonId}`);
    if (lesson.workspaceId !== input.workspaceId) {
      throw new Error('All affected lessons must belong to one workspace.');
    }
    if (lesson.date < input.fromDate || lesson.date > input.toDate) {
      throw new Error('Every affected lesson must fall inside the absence date range.');
    }
    if (lesson.teacher.state !== 'assigned'
      || lesson.teacher.teacherId !== input.requesterTeacherId) {
      throw new Error('The requester must be assigned to every affected lesson.');
    }
  }
}

export function createAbsenceCase(
  state: WorkspaceState,
  input: CreateAbsenceCaseInput,
): WorkspaceState {
  validateCreation(state, input);
  const absenceCase: AbsenceCase = {
    id: input.id,
    workspaceId: input.workspaceId,
    requesterTeacherId: input.requesterTeacherId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    reason: input.reason,
    ...(input.note === undefined ? {} : { note: input.note }),
    lessonIds: [...input.lessonIds],
    resolutionItems: input.resolutionItems?.map((item) => ({
      ...item,
      changes: item.changes.map((change) => ({ ...change, teacher: { ...change.teacher } })),
    })) ?? [],
    status: 'draft',
    createdAt: input.at,
    updatedAt: input.at,
  };

  return {
    ...state,
    cases: [...state.cases, absenceCase],
    audit: [
      ...state.audit,
      {
        id: input.auditEventId,
        workspaceId: input.workspaceId,
        caseId: input.id,
        actorId: input.requesterTeacherId,
        type: 'case.created',
        at: input.at,
        details: { lessonCount: input.lessonIds.length },
      },
    ],
  };
}

const NEXT_STATUS: Partial<Record<CaseStatus, readonly CaseStatus[]>> = {
  draft: ['submitted'],
  submitted: ['in_review'],
  in_review: ['resolution_approved', 'rejected'],
  resolution_approved: ['admin_in_progress'],
  admin_in_progress: ['ready_to_publish'],
  ready_to_publish: ['published'],
};

const TERMINAL_STATUSES = new Set<CaseStatus>([
  'published',
  'rejected',
  'cancelled',
  'superseded',
]);

function requiredAdminTasksComplete(state: WorkspaceState, caseId: string): boolean {
  return PROTOTYPE_REQUIRED_ADMIN_TASKS.every((kind) =>
    state.adminTasks.some((item) => item.caseId === caseId
      && item.kind === kind
      && item.status === 'completed'));
}

export function transitionCase(
  state: WorkspaceState,
  input: TransitionCaseInput,
): WorkspaceState {
  validateContext(state, input);
  const current = findCase(state, input.caseId);
  if (TERMINAL_STATUSES.has(current.status)) {
    throw new Error('Terminal cases cannot be transitioned.');
  }
  if (!NEXT_STATUS[current.status]?.includes(input.to)) {
    throw new Error(`Invalid case transition: ${current.status} → ${input.to}`);
  }
  if (current.status === 'in_review' && input.to === 'resolution_approved') {
    const validation = validateCasePlan(state, current.id);
    if (!validation.valid) {
      if (validation.staleRevision) {
        throw new Error('The resolution must be recomputed against the active revision.');
      }
      throw new Error('The resolution plan has unresolved conflicts.');
    }
  }
  if (current.status === 'admin_in_progress'
    && input.to === 'ready_to_publish'
    && !requiredAdminTasksComplete(state, current.id)) {
    throw new Error('Required administrative tasks are incomplete.');
  }
  if (input.to === 'rejected' && !input.rejectionNote?.trim()) {
    throw new Error('A rejection note is required.');
  }

  const superseded = input.to === 'published' && current.supersedesCaseId
    ? findCase(state, current.supersedesCaseId)
    : undefined;
  if (superseded && superseded.status !== 'published') {
    throw new Error('A correction can supersede only its currently published source.');
  }
  if (superseded && (!input.supersessionAuditEventId?.trim()
    || input.supersessionAuditEventId === input.auditEventId
    || state.audit.some((event) => event.id === input.supersessionAuditEventId))) {
    throw new Error('A unique source supersession audit event id is required.');
  }

  const details = {
    previousStatus: current.status,
    nextStatus: input.to,
    ...(superseded ? { supersededCaseId: superseded.id } : {}),
  };
  const updated: AbsenceCase = {
    ...current,
    status: input.to,
    updatedAt: input.at,
    ...(input.to === 'rejected' ? { rejectionNote: input.rejectionNote!.trim() } : {}),
  };

  return {
    ...state,
    cases: state.cases.map((item) => {
      if (item.id === current.id) return updated;
      if (item.id === superseded?.id) {
        return { ...item, status: 'superseded', updatedAt: input.at };
      }
      return item;
    }),
    audit: [
      ...state.audit,
      {
        id: input.auditEventId,
        workspaceId: current.workspaceId,
        caseId: current.id,
        actorId: input.actorId,
        type: 'case.status_changed',
        at: input.at,
        details,
      },
      ...(superseded ? [{
        id: input.supersessionAuditEventId!,
        workspaceId: superseded.workspaceId,
        caseId: superseded.id,
        actorId: input.actorId,
        type: 'case.superseded' as const,
        at: input.at,
        details: {
          previousStatus: 'published',
          nextStatus: 'superseded',
          correctionCaseId: current.id,
        },
      }] : []),
    ],
  };
}

export interface PersistSubmittedAbsenceCaseInput extends CreateAbsenceCaseInput {
  submissionAuditEventId: string;
}

export type PersistSubmittedAbsenceCaseResult = { caseId: string } | { error: string };

export function persistSubmittedAbsenceCase(
  state: WorkspaceState,
  input: PersistSubmittedAbsenceCaseInput,
  save: (next: WorkspaceState) => SaveResult,
): PersistSubmittedAbsenceCaseResult {
  const created = createAbsenceCase(state, input);
  const submitted = transitionCase(created, {
    caseId: input.id,
    to: 'submitted',
    actorId: input.requesterTeacherId,
    at: input.at,
    auditEventId: input.submissionAuditEventId,
  });
  const result = save(submitted);
  if (result.ok) return { caseId: input.id };
  return {
    error: result.reason === 'quota'
      ? '브라우저 저장 공간이 부족하여 요청을 저장하지 않았습니다. 진단 보고서를 내보내고 저장 공간을 확보한 뒤 다시 시도하십시오.'
      : '이 브라우저에서 요청을 저장하지 않았습니다. 진단 보고서를 내보내고 저장 가능 여부를 확인한 뒤 다시 시도하십시오.',
  };
}

export function deleteCase(state: WorkspaceState, input: DeleteCaseInput): WorkspaceState {
  validateContext(state, input);
  const current = findCase(state, input.caseId);
  if (current.status === 'published' || current.status === 'superseded') {
    throw new Error('Published cases cannot be deleted.');
  }
  if (current.status !== 'draft') throw new Error('Only draft cases can be deleted.');

  return {
    ...state,
    cases: state.cases.filter((item) => item.id !== current.id),
    audit: [
      ...state.audit,
      {
        id: input.auditEventId,
        workspaceId: current.workspaceId,
        caseId: current.id,
        actorId: input.actorId,
        type: 'case.deleted',
        at: input.at,
        details: {},
      },
    ],
  };
}

export function createPrototypeAdminTasks(
  state: WorkspaceState,
  input: CreatePrototypeAdminTasksInput,
): WorkspaceState {
  validateContext(state, input);
  const current = findCase(state, input.caseId);
  if (current.status !== 'resolution_approved') {
    throw new Error('Administrative tasks require an approved resolution.');
  }
  if (state.adminTasks.some((task) => task.caseId === current.id)) {
    throw new Error('Administrative tasks already exist for this case.');
  }
  if (!input.taskAuditEventId.trim()
    || input.taskAuditEventId === input.auditEventId
    || state.audit.some((event) => event.id === input.taskAuditEventId)) {
    throw new Error('A unique task-creation audit event id is required.');
  }
  const taskIds = PROTOTYPE_ADMIN_TASKS.map((kind) => input.taskIds[kind]);
  if (taskIds.some((id) => !id.trim()) || new Set(taskIds).size !== taskIds.length) {
    throw new Error('Unique task ids are required.');
  }
  if (taskIds.some((id) => state.adminTasks.some((task) => task.id === id))) {
    throw new Error('Administrative task id already exists.');
  }

  const transitioned = transitionCase(state, {
    caseId: input.caseId,
    to: 'admin_in_progress',
    actorId: input.actorId,
    at: input.at,
    auditEventId: input.auditEventId,
  });
  const adminTasks: AdminTask[] = PROTOTYPE_ADMIN_TASKS.map((kind) => ({
    id: input.taskIds[kind],
    workspaceId: current.workspaceId,
    caseId: current.id,
    kind,
    required: PROTOTYPE_REQUIRED_ADMIN_TASKS.includes(
      kind as (typeof PROTOTYPE_REQUIRED_ADMIN_TASKS)[number],
    ),
    status: 'pending',
    createdAt: input.at,
    updatedAt: input.at,
  }));

  return {
    ...transitioned,
    adminTasks: [...transitioned.adminTasks, ...adminTasks],
    audit: [
      ...transitioned.audit,
      {
        id: input.taskAuditEventId,
        workspaceId: current.workspaceId,
        caseId: current.id,
        actorId: input.actorId,
        type: 'admin.tasks_created',
        at: input.at,
        details: {
          neisTaskId: input.taskIds.neis,
          teacherNoticeTaskId: input.taskIds.teacher_notice,
          classPublicationTaskId: input.taskIds.class_publication,
          internalDocumentTaskId: input.taskIds.internal_document,
        },
      },
    ],
  };
}

export function completeAdminTask(
  state: WorkspaceState,
  input: CompleteAdminTaskInput,
): WorkspaceState {
  validateContext(state, { ...input, caseId: '' });
  const task = state.adminTasks.find((item) => item.id === input.taskId);
  if (!task) throw new Error(`Administrative task does not exist: ${input.taskId}`);
  if (task.status === 'completed') throw new Error('Administrative task is already complete.');
  const current = findCase(state, task.caseId);
  if (current.status !== 'admin_in_progress' && current.status !== 'ready_to_publish') {
    throw new Error('The case is not in its administrative phase.');
  }

  const completedTask: AdminTask = {
    ...task,
    status: 'completed',
    updatedAt: input.at,
    completedAt: input.at,
    completedBy: input.actorId,
  };
  const adminTasks = state.adminTasks.map((item) => item.id === task.id ? completedTask : item);
  const requiredComplete = requiredAdminTasksComplete({ ...state, adminTasks }, current.id);
  const nextStatus = current.status === 'admin_in_progress' && requiredComplete
    ? 'ready_to_publish'
    : current.status;
  const updatedCase: AbsenceCase = {
    ...current,
    status: nextStatus,
    updatedAt: input.at,
  };

  return {
    ...state,
    cases: state.cases.map((item) => item.id === current.id ? updatedCase : item),
    adminTasks,
    audit: [
      ...state.audit,
      {
        id: input.auditEventId,
        workspaceId: current.workspaceId,
        caseId: current.id,
        actorId: input.actorId,
        type: 'admin.task_completed',
        at: input.at,
        details: {
          taskId: task.id,
          taskKind: task.kind,
          previousStatus: current.status,
          nextStatus,
        },
      },
    ],
  };
}

export function createCorrectionCase(
  state: WorkspaceState,
  input: CreateCorrectionCaseInput,
): WorkspaceState {
  validateContext(state, { ...input, caseId: input.sourceCaseId });
  const source = findCase(state, input.sourceCaseId);
  if (source.status !== 'published') {
    throw new Error('A correction requires a published source case.');
  }
  if (!input.id.trim() || state.cases.some((item) => item.id === input.id)) {
    throw new Error('A unique correction case id is required.');
  }

  const correction: AbsenceCase = {
    id: input.id,
    workspaceId: source.workspaceId,
    requesterTeacherId: source.requesterTeacherId,
    fromDate: source.fromDate,
    toDate: source.toDate,
    reason: source.reason,
    ...(source.note === undefined ? {} : { note: source.note }),
    lessonIds: [...source.lessonIds],
    resolutionItems: [],
    status: 'draft',
    createdAt: input.at,
    updatedAt: input.at,
    supersedesCaseId: source.id,
  };

  return {
    ...state,
    cases: [...state.cases, correction],
    audit: [
      ...state.audit,
      {
        id: input.auditEventId,
        workspaceId: source.workspaceId,
        caseId: correction.id,
        actorId: input.actorId,
        type: 'case.correction_created',
        at: input.at,
        details: { supersedesCaseId: source.id },
      },
    ],
  };
}
