import type {
  AbsenceCase,
  AdminTask,
  AdminTaskKind,
  AuditEvent,
  BaseScheduleRevision,
  Lesson,
  Publication,
  ResolutionItem,
  WorkspaceState,
} from './domain';

export const WORKSPACE_KEY_PREFIX = 'joyul:v2:workspace:';
const LEGACY_REQUESTS_KEY = 'joyul:v1:requests';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface WorkspaceRepository {
  load(workspaceId: string): WorkspaceState | null;
  save(state: WorkspaceState): { ok: true } | { ok: false; reason: 'quota' | 'unavailable' };
  export(state: WorkspaceState): string;
}

type LegacyStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'published';
type LegacyReason = AbsenceCase['reason'];

interface LegacyAssignment {
  teacher: string;
  klass: string;
  subject: string;
  slot: number;
}

interface LegacyCandidate {
  type: 'move' | 'swap2' | 'cycle3';
  changes: Array<{ from: LegacyAssignment; toSlot: number }>;
}

interface LegacyRequest {
  id: string;
  createdAt: string;
  date: string;
  teacher: string;
  reason: LegacyReason;
  note?: string;
  target: LegacyAssignment;
  candidate: LegacyCandidate;
  kind: 'change' | 'cover';
  status: LegacyStatus;
  adminNote?: string;
  checklist: { neis: boolean; notice: boolean; document: boolean };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isISODate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isISOTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isLegacyAssignment(value: unknown): value is LegacyAssignment {
  if (!isRecord(value)) return false;
  return typeof value.teacher === 'string' && value.teacher.trim().length > 0
    && typeof value.klass === 'string' && value.klass.trim().length > 0
    && typeof value.subject === 'string' && value.subject.trim().length > 0
    && typeof value.slot === 'number' && Number.isInteger(value.slot);
}

function isLegacyRequest(value: unknown): value is LegacyRequest {
  if (!isRecord(value) || !isRecord(value.candidate) || !isRecord(value.checklist)) return false;
  const candidate = value.candidate;
  const checklist = value.checklist;
  return typeof value.id === 'string' && value.id.trim().length > 0
    && typeof value.createdAt === 'string' && isISOTimestamp(value.createdAt)
    && typeof value.date === 'string' && isISODate(value.date)
    && typeof value.teacher === 'string' && value.teacher.trim().length > 0
    && (value.reason === '업무상 부재' || value.reason === '연수·출장' || value.reason === '기타')
    && (value.note === undefined || typeof value.note === 'string')
    && isLegacyAssignment(value.target)
    && (candidate.type === 'move' || candidate.type === 'swap2' || candidate.type === 'cycle3')
    && Array.isArray(candidate.changes)
    && candidate.changes.length > 0
    && candidate.changes.every((change) => isRecord(change)
      && isLegacyAssignment(change.from) && typeof change.toSlot === 'number'
      && Number.isInteger(change.toSlot))
    && (value.kind === 'change' || value.kind === 'cover')
    && (value.status === 'pending' || value.status === 'approved' || value.status === 'rejected'
      || value.status === 'cancelled' || value.status === 'published')
    && (value.adminNote === undefined || typeof value.adminNote === 'string')
    && typeof checklist.neis === 'boolean'
    && typeof checklist.notice === 'boolean'
    && typeof checklist.document === 'boolean';
}

function decodeLegacyRequests(raw: string): { requests: LegacyRequest[]; skippedEntries: number } | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.requests)) return null;
    const requests = data.requests.filter(isLegacyRequest);
    return { requests, skippedEntries: data.requests.length - requests.length };
  } catch {
    return null;
  }
}

function legacyStatus(status: LegacyStatus): AbsenceCase['status'] {
  const statuses: Record<LegacyStatus, AbsenceCase['status']> = {
    pending: 'submitted',
    approved: 'admin_in_progress',
    rejected: 'rejected',
    cancelled: 'cancelled',
    published: 'published',
  };
  return statuses[status];
}

function lessonId(requestId: string, index: number): string {
  return `legacy-v1-${requestId}-lesson-${index}`;
}

function assignmentKey(assignment: LegacyAssignment): string {
  return [assignment.teacher, assignment.klass, assignment.subject, assignment.slot].join('\u0000');
}

function classIdentity(workspaceId: string, klass: string) {
  const [grade = '', className = ''] = klass.split('-', 2);
  return {
    schoolCode: workspaceId,
    academicYear: '',
    dayCourse: '',
    affiliation: '',
    major: '',
    grade,
    className,
  };
}

function migrateRequest(request: LegacyRequest, workspaceId: string, revisionId: string): {
  absenceCase: AbsenceCase;
  lessons: Lesson[];
  adminTasks: AdminTask[];
  publication?: Publication;
  audit: AuditEvent;
} {
  const assignments = [request.target, ...request.candidate.changes.map((change) => change.from)];
  const uniqueAssignments = assignments.filter((assignment, index) =>
    assignments.findIndex((candidate) => assignmentKey(candidate) === assignmentKey(assignment)) === index);
  const ids = new Map(uniqueAssignments.map((assignment, index) => [assignmentKey(assignment), lessonId(request.id, index + 1)]));
  const lessons = uniqueAssignments.map((assignment, index): Lesson => ({
    id: lessonId(request.id, index + 1),
    workspaceId,
    revisionId,
    date: request.date,
    period: String(assignment.slot),
    classIdentity: classIdentity(workspaceId, assignment.klass),
    subject: assignment.subject,
    room: assignment.klass,
    teacher: { state: 'assigned', teacherId: assignment.teacher },
  }));
  const targetLessonId = ids.get(assignmentKey(request.target))!;
  const resolution: ResolutionItem = {
    id: `legacy-v1-${request.id}-resolution-1`,
    lessonId: targetLessonId,
    kind: request.candidate.type,
    computedAgainstRevisionId: revisionId,
    changes: request.candidate.changes.map((change) => ({
      lessonId: ids.get(assignmentKey(change.from))!,
      toDate: request.date,
      toPeriod: String(change.toSlot),
      teacher: { state: 'assigned', teacherId: change.from.teacher },
    })),
  };
  const absenceCase: AbsenceCase = {
    id: request.id,
    workspaceId,
    requesterTeacherId: request.teacher,
    fromDate: request.date,
    toDate: request.date,
    reason: request.reason,
    ...(request.note?.trim() ? { note: request.note } : {}),
    lessonIds: [targetLessonId],
    resolutionItems: [resolution],
    status: legacyStatus(request.status),
    createdAt: request.createdAt,
    updatedAt: request.createdAt,
    ...(request.status === 'rejected' && request.adminNote?.trim()
      ? { rejectionNote: request.adminNote } : {}),
  };
  const taskKinds: Array<[AdminTaskKind, boolean]> = [
    ['neis', request.checklist.neis],
    ['teacher_notice', request.checklist.notice],
    ['internal_document', request.checklist.document],
  ];
  const adminTasks = taskKinds.map(([kind, completed]): AdminTask => ({
    id: `legacy-v1-${request.id}-task-${kind}`,
    workspaceId,
    caseId: request.id,
    kind,
    required: true,
    status: completed ? 'completed' : 'pending',
    createdAt: request.createdAt,
    updatedAt: request.createdAt,
    ...(completed ? { completedAt: request.createdAt, completedBy: request.teacher } : {}),
  }));
  const publication = request.status === 'published' ? {
    id: `legacy-v1-${request.id}-publication-1`,
    workspaceId,
    caseId: request.id,
    revisionId,
    changedLessonIds: [targetLessonId],
    publishedAt: request.createdAt,
    publishedBy: request.teacher,
  } satisfies Publication : undefined;
  return {
    absenceCase,
    lessons,
    adminTasks,
    publication,
    audit: {
      id: `legacy-v1-${request.id}-audit-1`, workspaceId, caseId: request.id,
      actorId: request.teacher, type: 'migration.v1', at: request.createdAt,
      details: { legacyStatus: request.status },
    },
  };
}

function migrateV1(workspaceId: string, decoded: { requests: LegacyRequest[]; skippedEntries: number }): WorkspaceState {
  const timestamp = decoded.requests[0]?.createdAt ?? '1970-01-01T00:00:00.000Z';
  const revisionId = `legacy-v1-${workspaceId}-revision-1`;
  const revision: BaseScheduleRevision = {
    id: revisionId, workspaceId, source: 'school_file', loadedAt: timestamp,
    complete: false, checksum: 'legacy-v1',
  };
  const migrated = decoded.requests.reduce<ReturnType<typeof migrateRequest>[]>((all, request) => {
    if (all.some((item) => item.absenceCase.id === request.id)) return all;
    return [...all, migrateRequest(request, workspaceId, revisionId)];
  }, []);
  const skippedEntries = decoded.skippedEntries + decoded.requests.length - migrated.length;
  return {
    schemaVersion: 2,
    workspace: {
      id: workspaceId, name: workspaceId, activeRevisionId: revisionId,
      createdAt: timestamp, updatedAt: timestamp,
    },
    revisions: [revision],
    lessons: migrated.flatMap((item) => item.lessons),
    cases: migrated.map((item) => item.absenceCase),
    adminTasks: migrated.flatMap((item) => item.adminTasks),
    publications: migrated.flatMap((item) => item.publication ? [item.publication] : []),
    audit: [
      ...migrated.map((item) => item.audit),
      {
        id: `migration-v1-${workspaceId}-audit-1`, workspaceId, actorId: 'system',
        type: 'migration.v1', at: timestamp, details: { skippedEntries },
      },
    ],
  };
}

function isWorkspaceState(value: unknown, workspaceId: string): value is WorkspaceState {
  return isRecord(value)
    && value.schemaVersion === 2
    && isRecord(value.workspace)
    && value.workspace.id === workspaceId
    && Array.isArray(value.revisions)
    && Array.isArray(value.lessons)
    && Array.isArray(value.cases)
    && Array.isArray(value.adminTasks)
    && Array.isArray(value.publications)
    && Array.isArray(value.audit);
}

function storageFailure(error: unknown): 'quota' | 'unavailable' {
  return error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota' : 'unavailable';
}

export function createWorkspaceRepository(storage: Storage): WorkspaceRepository {
  return {
    load(workspaceId) {
      try {
        const stored = storage.getItem(`${WORKSPACE_KEY_PREFIX}${workspaceId}`);
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          return isWorkspaceState(parsed, workspaceId) ? parsed : null;
        }
        const legacy = storage.getItem(LEGACY_REQUESTS_KEY);
        if (!legacy) return null;
        const decoded = decodeLegacyRequests(legacy);
        if (!decoded) return null;
        const migrated = migrateV1(workspaceId, decoded);
        try {
          storage.setItem(`${WORKSPACE_KEY_PREFIX}${workspaceId}`, JSON.stringify(migrated));
        } catch {
          // The recovered state remains usable and exportable even when persistence is unavailable.
        }
        return migrated;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        storage.setItem(`${WORKSPACE_KEY_PREFIX}${state.workspace.id}`, JSON.stringify(state));
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: storageFailure(error) };
      }
    },
    export(state) {
      return JSON.stringify(state);
    },
  };
}
