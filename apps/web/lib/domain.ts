import type { ClassIdentity } from '@timeswap/engine';

export type { ClassIdentity } from '@timeswap/engine';

export type ISODate = string;
export type ISOTimestamp = string;

export interface SchoolWorkspace {
  id: string;
  name: string;
  activeRevisionId: string;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface BaseScheduleRevision {
  id: string;
  workspaceId: string;
  source: 'neis' | 'school_file' | 'demo';
  query?: Record<string, string>;
  loadedAt: ISOTimestamp;
  complete: boolean;
  checksum: string;
  closures?: ScheduleClosure[];
}

export interface ScheduleClosure {
  date: ISODate;
  reason: string;
  classIdentities?: ClassIdentity[];
}

export type TeacherAssignment =
  | { state: 'assigned'; teacherId: string }
  | { state: 'unassigned' };

export interface Lesson {
  id: string;
  workspaceId: string;
  revisionId: string;
  date: ISODate;
  period: string;
  classIdentity: ClassIdentity;
  subject: string;
  room: string;
  teacher: TeacherAssignment;
  parallelGroupId?: string;
}

export interface ParallelLessonGroup {
  id: string;
  workspaceId: string;
  revisionId: string;
  lessonIds: string[];
}

/** Lessons that must be selected and resolved as one operational unit. */
export interface AtomicLessonGroup {
  id: string;
  workspaceId: string;
  revisionId: string;
  kind: 'professional-practice-block';
  lessonIds: string[];
}

export interface ResolutionChange {
  lessonId: string;
  toDate: ISODate;
  toPeriod: string;
  teacher: TeacherAssignment;
}

export interface ResolutionItem {
  id: string;
  lessonId: string;
  kind: 'unresolved' | 'move' | 'swap2' | 'cycle3' | 'cover' | 'manual';
  manualAction?: string;
  computedAgainstRevisionId: string;
  changes: ResolutionChange[];
}

export type CaseStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'resolution_approved'
  | 'admin_in_progress'
  | 'ready_to_publish'
  | 'published'
  | 'rejected'
  | 'cancelled'
  | 'superseded';

export interface AbsenceCase {
  id: string;
  workspaceId: string;
  requesterTeacherId: string;
  fromDate: ISODate;
  toDate: ISODate;
  reason: '업무상 부재' | '연수·출장' | '학교 행사' | '기타';
  note?: string;
  lessonIds: string[];
  resolutionItems: ResolutionItem[];
  status: CaseStatus;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  supersedesCaseId?: string;
  rejectionNote?: string;
}

export type AdminTaskKind =
  | 'neis'
  | 'teacher_notice'
  | 'class_publication'
  | 'internal_document';

export interface AdminTask {
  id: string;
  workspaceId: string;
  caseId: string;
  kind: AdminTaskKind;
  required: boolean;
  status: 'pending' | 'completed';
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  completedAt?: ISOTimestamp;
  completedBy?: string;
}

export interface Publication {
  id: string;
  workspaceId: string;
  caseId: string;
  revisionId: string;
  changedLessonIds: string[];
  publishedAt: ISOTimestamp;
  publishedBy: string;
  supersedesPublicationId?: string;
}

export type AuditValue = string | number | boolean | null;

export interface AuditEvent {
  id: string;
  workspaceId: string;
  caseId?: string;
  actorId: string;
  type:
    | 'case.created'
    | 'case.status_changed'
    | 'case.superseded'
    | 'case.deleted'
    | 'case.correction_created'
    | 'case.resolution_changed'
    | 'case.recomputation_requested'
    | 'admin.tasks_created'
    | 'admin.task_completed'
    | 'migration.v1';
  at: ISOTimestamp;
  details: Record<string, AuditValue>;
}

export interface WorkspaceState {
  schemaVersion: 2;
  workspace: SchoolWorkspace;
  /** Display-only names are intentionally separate from stable invitation ids. */
  teacherLabels?: Record<string, string>;
  revisions: BaseScheduleRevision[];
  lessons: Lesson[];
  atomicLessonGroups?: AtomicLessonGroup[];
  cases: AbsenceCase[];
  adminTasks: AdminTask[];
  publications: Publication[];
  audit: AuditEvent[];
}
