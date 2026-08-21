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
  /**
   * 전문교과 실습인지. 나이스가 과목명 앞에 별표를 붙여 알려 준다.
   *
   * 학과 전용 실습실에서 그 학과 교사만 맡는 수업이라 아무나 대신 들어갈 수 없다.
   * 엔진은 이 표시로 보강 후보를 고른다. 그런데 나이스에서 받은 표시를 여기 안 담아
   * 두어서 엔진까지 못 갔고, 특성화고에서 전공이 아닌 분이 실습 보강 후보로 나왔다.
   * 실측에서 특성화고 10곳은 수업 칸의 14~34%가 이 표시였다. 일반고 12곳은 0%다.
   */
  pro?: boolean;
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

/** 화면에 보이는 사건 상태 이름. */
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  draft: '작성 중',
  submitted: '제출됨',
  in_review: '검토 중',
  resolution_approved: '승인됨',
  admin_in_progress: '행정 마감 중',
  ready_to_publish: '게시 대기',
  published: '게시됨',
  rejected: '반려됨',
  cancelled: '취소됨',
  superseded: '정정으로 대체됨',
};

/**
 * 신청한 사람이 스스로 거둘 수 있는 자리.
 *
 * `cancelled` 는 상태 목록과 종결 목록에 들어 있는데 여기로 가는 길이 없었다. 옛
 * 화면에는 "요청 취소" 단추가 있었고, 사건 방식으로 옮기면서 그 길만 빠졌다. 그래서
 * 잘못 낸 요청을 거둘 방법이 없었다. 일과 담당이 반려해 주는 수밖에 없는데, 남의
 * 실수에 반려 사유를 대신 적어 주는 일이 된다.
 *
 * 승인 뒤로는 안 연다. 그때부터 나이스 입력과 통지가 나가 있어서, 되돌리는 것은
 * 취소가 아니라 정정이다.
 */
export function canWithdrawCase(status: CaseStatus): boolean {
  return status === 'submitted' || status === 'in_review';
}

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
