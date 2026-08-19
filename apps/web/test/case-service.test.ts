import { describe, expect, it } from 'vitest';
import * as CaseService from '../lib/case-service';

import {
  completeAdminTask,
  createAbsenceCase,
  createCorrectionCase,
  createPrototypeAdminTasks,
  deleteCase,
  findDuplicateAbsenceCase,
  lessonsAffectedByAbsence,
  transitionCase,
} from '../lib/case-service';
import type { ClassIdentity } from '@timeswap/engine';
import type { CaseStatus, Lesson, WorkspaceState } from '../lib/domain';

const classIdentity: ClassIdentity = {
  schoolCode: 'school-1',
  academicYear: '2026',
  dayCourse: '주간',
  affiliation: '공업계',
  major: '정보통신과',
  grade: '2',
  className: '1',
};

const lessons: Lesson[] = [1, 2, 3, 4].map((period) => ({
  id: `lesson-${period}`,
  workspaceId: 'workspace-1',
  revisionId: 'revision-1',
  date: '2026-08-24',
  period: String(period),
  classIdentity,
  subject: '정보 통신',
  room: '2-1',
  teacher: { state: 'assigned', teacherId: 'teacher-1' },
}));

const initialState = (): WorkspaceState => ({
  schemaVersion: 2,
  workspace: {
    id: 'workspace-1',
    name: '조율고등학교',
    activeRevisionId: 'revision-1',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  },
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

const caseAtStatus = (status: CaseStatus): WorkspaceState => {
  const created = createAbsenceCase(initialState(), {
    id: 'case-1',
    auditEventId: 'audit-created',
    workspaceId: 'workspace-1',
    requesterTeacherId: 'teacher-1',
    fromDate: '2026-08-24',
    toDate: '2026-08-24',
    reason: '업무상 부재',
    lessonIds: ['lesson-1'],
    at: '2026-08-18T01:00:00.000Z',
  });
  return { ...created, cases: [{ ...created.cases[0]!, status }] };
};

describe('createAbsenceCase', () => {
  it('stores one shared reason and note around all affected lessons', () => {
    const state = createAbsenceCase(initialState(), {
      id: 'case-1',
      auditEventId: 'audit-1',
      workspaceId: 'workspace-1',
      requesterTeacherId: 'teacher-1',
      fromDate: '2026-08-24',
      toDate: '2026-08-24',
      reason: '연수·출장',
      note: '오전 직무 연수',
      lessonIds: lessons.map((lesson) => lesson.id),
      at: '2026-08-18T01:00:00.000Z',
    });

    expect(state.cases).toHaveLength(1);
    expect(state.cases[0]).toMatchObject({
      reason: '연수·출장',
      note: '오전 직무 연수',
      lessonIds: ['lesson-1', 'lesson-2', 'lesson-3', 'lesson-4'],
    });
    expect(state.audit).toEqual([
      expect.objectContaining({
        id: 'audit-1',
        type: 'case.created',
        details: { lessonCount: 4 },
      }),
    ]);
    expect(JSON.stringify(state.audit)).not.toContain('오전 직무 연수');
  });

  it.each([
    ['a reversed date range', { fromDate: '2026-08-25', toDate: '2026-08-24' }],
    ['a blank requester', { requesterTeacherId: '   ' }],
    ['no affected lessons', { lessonIds: [] }],
    ['a lesson not owned by the requester', { requesterTeacherId: 'teacher-2' }],
  ])('rejects %s', (_label, override) => {
    expect(() => createAbsenceCase(initialState(), {
      id: 'case-invalid',
      auditEventId: 'audit-invalid',
      workspaceId: 'workspace-1',
      requesterTeacherId: 'teacher-1',
      fromDate: '2026-08-24',
      toDate: '2026-08-24',
      reason: '업무상 부재',
      lessonIds: ['lesson-1'],
      at: '2026-08-18T01:00:00.000Z',
      ...override,
    })).toThrow();
  });

  it('rejects lessons that cross workspace boundaries', () => {
    const state = initialState();
    state.lessons.push({ ...lessons[0]!, id: 'foreign-lesson', workspaceId: 'workspace-2' });

    expect(() => createAbsenceCase(state, {
      id: 'case-invalid',
      auditEventId: 'audit-invalid',
      workspaceId: 'workspace-1',
      requesterTeacherId: 'teacher-1',
      fromDate: '2026-08-24',
      toDate: '2026-08-24',
      reason: '업무상 부재',
      lessonIds: ['lesson-1', 'foreign-lesson'],
      at: '2026-08-18T01:00:00.000Z',
    })).toThrow(/workspace/i);
  });

  it('appends without mutating the prior state or its audit array', () => {
    const before = initialState();
    const after = createAbsenceCase(before, {
      id: 'case-1',
      auditEventId: 'audit-1',
      workspaceId: 'workspace-1',
      requesterTeacherId: 'teacher-1',
      fromDate: '2026-08-24',
      toDate: '2026-08-24',
      reason: '학교 행사',
      lessonIds: ['lesson-1'],
      at: '2026-08-18T01:00:00.000Z',
    });

    expect(before.cases).toEqual([]);
    expect(before.audit).toEqual([]);
    expect(after.cases).not.toBe(before.cases);
    expect(after.audit).not.toBe(before.audit);
  });
});

describe('persistSubmittedAbsenceCase', () => {
  it.each(['quota', 'unavailable'] as const)('does not report a case id when repository saving fails with %s', (reason) => {
    const persist = (CaseService as unknown as {
      persistSubmittedAbsenceCase?: (
        state: WorkspaceState,
        input: {
          id: string; auditEventId: string; submissionAuditEventId: string; workspaceId: string;
          requesterTeacherId: string; fromDate: string; toDate: string; reason: '업무상 부재';
          lessonIds: string[]; at: string;
        },
        save: (next: WorkspaceState) => { ok: true } | { ok: false; reason: 'quota' | 'unavailable' },
      ) => { caseId?: string; error?: string };
    }).persistSubmittedAbsenceCase;
    const before = initialState();

    expect(persist).toBeTypeOf('function');
    if (typeof persist !== 'function') return;

    const result = persist(before, {
      id: 'case-unsaved', auditEventId: 'audit-created-unsaved', submissionAuditEventId: 'audit-submitted-unsaved',
      workspaceId: 'workspace-1', requesterTeacherId: 'teacher-1',
      fromDate: '2026-08-24', toDate: '2026-08-24', reason: '업무상 부재', lessonIds: ['lesson-1'],
      at: '2026-08-18T01:00:00.000Z',
    }, () => ({ ok: false, reason }));

    expect(result.caseId).toBeUndefined();
    expect(result.error).toContain('저장하지 않았습니다');
    expect(result.error).toContain('진단 보고서');
    expect(before.cases).toEqual([]);
    expect(before.audit).toEqual([]);
  });

  it('reports a case id only after the submitted canonical state is saved', () => {
    const persist = (CaseService as unknown as {
      persistSubmittedAbsenceCase?: (
        state: WorkspaceState,
        input: {
          id: string; auditEventId: string; submissionAuditEventId: string; workspaceId: string;
          requesterTeacherId: string; fromDate: string; toDate: string; reason: '업무상 부재';
          lessonIds: string[]; at: string;
        },
        save: (next: WorkspaceState) => { ok: true } | { ok: false; reason: 'quota' | 'unavailable' },
      ) => { caseId?: string; error?: string };
    }).persistSubmittedAbsenceCase;
    const saves: WorkspaceState[] = [];

    expect(persist).toBeTypeOf('function');
    if (typeof persist !== 'function') return;

    const result = persist(initialState(), {
      id: 'case-saved', auditEventId: 'audit-created-saved', submissionAuditEventId: 'audit-submitted-saved',
      workspaceId: 'workspace-1', requesterTeacherId: 'teacher-1',
      fromDate: '2026-08-24', toDate: '2026-08-24', reason: '업무상 부재', lessonIds: ['lesson-1'],
      at: '2026-08-18T01:00:00.000Z',
    }, (next) => {
      saves.push(next);
      return { ok: true };
    });

    expect(result).toEqual({ caseId: 'case-saved' });
    expect(saves[0]?.cases).toEqual([expect.objectContaining({ id: 'case-saved', status: 'submitted' })]);
  });
});

describe('lessonsAffectedByAbsence', () => {
  const selectorLessons: Lesson[] = [
    { ...lessons[2]!, id: 'day-two-period-3', date: '2026-08-25', period: '3' },
    { ...lessons[0]!, id: 'day-one-period-1', date: '2026-08-24', period: '1' },
    { ...lessons[1]!, id: 'day-one-period-2', date: '2026-08-24', period: '2' },
    { ...lessons[3]!, id: 'day-one-period-4', date: '2026-08-24', period: '4', parallelGroupId: 'practice-block' },
    { ...lessons[0]!, id: 'day-one-period-3', date: '2026-08-24', period: '3' },
    { ...lessons[0]!, id: 'published-substitute', date: '2026-08-24', period: '5', teacher: { state: 'assigned', teacherId: 'teacher-cover' } },
    { ...lessons[0]!, id: 'unassigned-period-6', date: '2026-08-24', period: '6', teacher: { state: 'unassigned' } },
  ];

  it('selects one assigned period and keeps its stable id', () => {
    expect(lessonsAffectedByAbsence(selectorLessons, 'teacher-1', '2026-08-25', '2026-08-25')
      .map((lesson) => lesson.id)).toEqual(['day-two-period-3']);
  });

  it('selects and orders every assigned lesson across one day', () => {
    expect(lessonsAffectedByAbsence(selectorLessons, 'teacher-1', '2026-08-24', '2026-08-24')
      .map((lesson) => [lesson.id, lesson.parallelGroupId ?? null])).toEqual([
      ['day-one-period-1', null],
      ['day-one-period-2', null],
      ['day-one-period-3', null],
      ['day-one-period-4', 'practice-block'],
    ]);
  });

  it('includes both bounds of a multi-day absence', () => {
    expect(lessonsAffectedByAbsence(selectorLessons, 'teacher-1', '2026-08-24', '2026-08-25')
      .map((lesson) => lesson.id)).toEqual([
      'day-one-period-1', 'day-one-period-2', 'day-one-period-3', 'day-one-period-4', 'day-two-period-3',
    ]);
  });

  it('does not claim a lesson whose published replacement belongs to another teacher', () => {
    expect(lessonsAffectedByAbsence(selectorLessons, 'teacher-1', '2026-08-24', '2026-08-24')
      .map((lesson) => lesson.id)).not.toContain('published-substitute');
  });

  it('does not claim an unassigned lesson', () => {
    expect(lessonsAffectedByAbsence(selectorLessons, 'teacher-1', '2026-08-24', '2026-08-24')
      .map((lesson) => lesson.id)).not.toContain('unassigned-period-6');
  });
});

describe('findDuplicateAbsenceCase', () => {
  it('finds an existing request only when teacher, date range, and lesson set all match', () => {
    const state = createAbsenceCase(initialState(), {
      id: 'case-existing',
      auditEventId: 'audit-existing',
      workspaceId: 'workspace-1',
      requesterTeacherId: 'teacher-1',
      fromDate: '2026-08-24',
      toDate: '2026-08-24',
      reason: '업무상 부재',
      lessonIds: ['lesson-1', 'lesson-2'],
      at: '2026-08-18T01:00:00.000Z',
    });

    expect(findDuplicateAbsenceCase(state, {
      requesterTeacherId: 'teacher-1',
      fromDate: '2026-08-24',
      toDate: '2026-08-24',
      lessonIds: ['lesson-2', 'lesson-1'],
    })?.id).toBe('case-existing');
    expect(findDuplicateAbsenceCase(state, {
      requesterTeacherId: 'teacher-1',
      fromDate: '2026-08-24',
      toDate: '2026-08-25',
      lessonIds: ['lesson-1', 'lesson-2'],
    })).toBeUndefined();
  });
});

describe('transitionCase', () => {
  const allowed: Array<[CaseStatus, CaseStatus]> = [
    ['draft', 'submitted'],
    ['submitted', 'in_review'],
    ['in_review', 'resolution_approved'],
    ['resolution_approved', 'admin_in_progress'],
    ['admin_in_progress', 'ready_to_publish'],
    ['ready_to_publish', 'published'],
  ];

  it.each(allowed)('allows %s → %s and audits both states', (from, to) => {
    const original = caseAtStatus(from);
    const base = from === 'in_review'
      ? {
          ...original,
          cases: [{
            ...original.cases[0]!,
            resolutionItems: [{
              id: 'resolution-manual',
              lessonId: 'lesson-1',
              kind: 'manual' as const,
              manualAction: '담임교사가 자율학습을 감독합니다.',
              computedAgainstRevisionId: 'revision-1',
              changes: [],
            }],
          }],
        }
      : original;
    const before = from === 'admin_in_progress'
      ? {
          ...base,
          adminTasks: ['neis', 'teacher_notice', 'class_publication'].map((kind, index) => ({
            id: `task-${index}`,
            workspaceId: 'workspace-1',
            caseId: 'case-1',
            kind: kind as 'neis' | 'teacher_notice' | 'class_publication',
            required: true,
            status: 'completed' as const,
            createdAt: '2026-08-18T01:30:00.000Z',
            updatedAt: '2026-08-18T01:30:00.000Z',
            completedAt: '2026-08-18T01:30:00.000Z',
            completedBy: 'ops-1',
          })),
        }
      : base;
    const after = transitionCase(before, {
      caseId: 'case-1',
      to,
      actorId: 'ops-1',
      at: '2026-08-18T02:00:00.000Z',
      auditEventId: `audit-${from}-${to}`,
    });

    expect(after.cases[0]).toMatchObject({ status: to, updatedAt: '2026-08-18T02:00:00.000Z' });
    expect(after.audit.at(-1)).toMatchObject({
      actorId: 'ops-1',
      type: 'case.status_changed',
      details: { previousStatus: from, nextStatus: to },
    });
    expect(before.cases[0]!.status).toBe(from);
  });

  it('rejects a skipped submitted → published edge', () => {
    expect(() => transitionCase(caseAtStatus('submitted'), {
      caseId: 'case-1',
      to: 'published',
      actorId: 'ops-1',
      at: '2026-08-18T02:00:00.000Z',
      auditEventId: 'audit-skipped',
    })).toThrow(/Invalid case transition/);
  });

  it('does not bypass required administrative tasks', () => {
    expect(() => transitionCase(caseAtStatus('admin_in_progress'), {
      caseId: 'case-1',
      to: 'ready_to_publish',
      actorId: 'ops-1',
      at: '2026-08-18T02:00:00.000Z',
      auditEventId: 'audit-bypass-admin',
    })).toThrow(/Required administrative tasks are incomplete/);
  });

  it.each<CaseStatus>(['published', 'rejected', 'cancelled', 'superseded'])(
    'does not reopen terminal state %s',
    (terminal) => {
      expect(() => transitionCase(caseAtStatus(terminal), {
        caseId: 'case-1',
        to: 'draft',
        actorId: 'ops-1',
        at: '2026-08-18T02:00:00.000Z',
        auditEventId: `audit-terminal-${terminal}`,
      })).toThrow(/Terminal cases cannot be transitioned/);
    },
  );

  it('requires an actor id and canonical timestamp', () => {
    const before = caseAtStatus('draft');
    expect(() => transitionCase(before, {
      caseId: 'case-1',
      to: 'submitted',
      actorId: '',
      at: '2026-08-18T02:00:00.000Z',
      auditEventId: 'audit-no-actor',
    })).toThrow(/actor/i);
    expect(() => transitionCase(before, {
      caseId: 'case-1',
      to: 'submitted',
      actorId: 'teacher-1',
      at: 'not-a-timestamp',
      auditEventId: 'audit-no-time',
    })).toThrow(/timestamp/i);
  });

  it('stores the note when an in-review case is rejected', () => {
    const rejectionNote = '해결안의 충돌이 해소되지 않음';
    const after = transitionCase(caseAtStatus('in_review'), {
      caseId: 'case-1',
      to: 'rejected',
      actorId: 'ops-1',
      at: '2026-08-18T02:00:00.000Z',
      auditEventId: 'audit-rejected',
      rejectionNote,
    });

    expect(after.cases[0]).toMatchObject({
      status: 'rejected',
      rejectionNote,
    });
    expect(after.audit.at(-1)?.details).toEqual({
      previousStatus: 'in_review',
      nextStatus: 'rejected',
    });
    expect(JSON.stringify(after.audit)).not.toContain(rejectionNote);
  });
});

describe('deleteCase', () => {
  it('rejects deletion of a published record', () => {
    expect(() => deleteCase(caseAtStatus('published'), {
      caseId: 'case-1',
      actorId: 'teacher-1',
      at: '2026-08-18T02:00:00.000Z',
      auditEventId: 'audit-delete',
    })).toThrow(/Published cases cannot be deleted/);
  });

  it('allows an auditable draft deletion without mutating prior state', () => {
    const before = caseAtStatus('draft');
    const after = deleteCase(before, {
      caseId: 'case-1',
      actorId: 'teacher-1',
      at: '2026-08-18T02:00:00.000Z',
      auditEventId: 'audit-delete',
    });

    expect(after.cases).toEqual([]);
    expect(after.audit.at(-1)).toMatchObject({ type: 'case.deleted', caseId: 'case-1' });
    expect(before.cases).toHaveLength(1);
  });
});

describe('prototype administrative policy', () => {
  it('becomes ready when all required tasks finish while the optional document stays open', () => {
    const withTasks = createPrototypeAdminTasks(caseAtStatus('resolution_approved'), {
      caseId: 'case-1',
      actorId: 'ops-1',
      at: '2026-08-18T02:00:00.000Z',
      auditEventId: 'audit-admin-start',
      taskAuditEventId: 'audit-admin-tasks-created',
      taskIds: {
        neis: 'task-neis',
        teacher_notice: 'task-teacher-notice',
        class_publication: 'task-class-publication',
        internal_document: 'task-internal-document',
      },
    });

    expect(withTasks.adminTasks.map(({ kind, required }) => ({ kind, required }))).toEqual([
      { kind: 'neis', required: true },
      { kind: 'teacher_notice', required: true },
      { kind: 'class_publication', required: true },
      { kind: 'internal_document', required: false },
    ]);
    expect(withTasks.cases[0]!.status).toBe('admin_in_progress');
    expect(withTasks.audit.slice(-2)).toEqual([
      expect.objectContaining({
        id: 'audit-admin-start',
        type: 'case.status_changed',
        details: {
          previousStatus: 'resolution_approved',
          nextStatus: 'admin_in_progress',
        },
      }),
      expect.objectContaining({
        id: 'audit-admin-tasks-created',
        caseId: 'case-1',
        type: 'admin.tasks_created',
        details: {
          neisTaskId: 'task-neis',
          teacherNoticeTaskId: 'task-teacher-notice',
          classPublicationTaskId: 'task-class-publication',
          internalDocumentTaskId: 'task-internal-document',
        },
      }),
    ]);

    const neisDone = completeAdminTask(withTasks, {
      taskId: 'task-neis',
      actorId: 'ops-1',
      at: '2026-08-18T02:10:00.000Z',
      auditEventId: 'audit-neis',
    });
    const noticeDone = completeAdminTask(neisDone, {
      taskId: 'task-teacher-notice',
      actorId: 'ops-1',
      at: '2026-08-18T02:20:00.000Z',
      auditEventId: 'audit-notice',
    });
    expect(noticeDone.cases[0]!.status).toBe('admin_in_progress');

    const requiredDone = completeAdminTask(noticeDone, {
      taskId: 'task-class-publication',
      actorId: 'ops-1',
      at: '2026-08-18T02:30:00.000Z',
      auditEventId: 'audit-publication',
    });

    expect(requiredDone.cases[0]).toMatchObject({
      status: 'ready_to_publish',
      updatedAt: '2026-08-18T02:30:00.000Z',
    });
    expect(requiredDone.adminTasks.find((task) => task.kind === 'internal_document')).toMatchObject({
      status: 'pending',
      required: false,
    });
    expect(requiredDone.audit.at(-1)?.details).toMatchObject({
      taskId: 'task-class-publication',
      taskKind: 'class_publication',
      previousStatus: 'admin_in_progress',
      nextStatus: 'ready_to_publish',
    });
    expect(withTasks.adminTasks.every((task) => task.status === 'pending')).toBe(true);
  });
});

describe('correction supersession', () => {
  it('keeps the published source immutable and creates a linked draft', () => {
    const before = caseAtStatus('published');
    const publishedSource = before.cases[0]!;
    const after = createCorrectionCase(before, {
      sourceCaseId: 'case-1',
      id: 'case-correction',
      actorId: 'ops-1',
      at: '2026-08-18T03:00:00.000Z',
      auditEventId: 'audit-correction',
    });

    expect(after.cases[0]).toBe(publishedSource);
    expect(after.cases[0]!.status).toBe('published');
    expect(after.cases[1]).toMatchObject({
      id: 'case-correction',
      status: 'draft',
      supersedesCaseId: 'case-1',
      resolutionItems: [],
      createdAt: '2026-08-18T03:00:00.000Z',
      updatedAt: '2026-08-18T03:00:00.000Z',
    });
    expect(after.cases[1]!.lessonIds).not.toBe(publishedSource.lessonIds);
    expect(after.audit.at(-1)).toMatchObject({
      type: 'case.correction_created',
      details: { supersedesCaseId: 'case-1' },
    });
  });

  it('supersedes the old case only when the correction reaches published', () => {
    const correctionCreated = createCorrectionCase(caseAtStatus('published'), {
      sourceCaseId: 'case-1',
      id: 'case-correction',
      actorId: 'ops-1',
      at: '2026-08-18T03:00:00.000Z',
      auditEventId: 'audit-correction',
    });
    expect(correctionCreated.cases[0]!.status).toBe('published');

    const ready = {
      ...correctionCreated,
      cases: correctionCreated.cases.map((item) => item.id === 'case-correction'
        ? { ...item, status: 'ready_to_publish' as const }
        : item),
    };
    const published = transitionCase(ready, {
      caseId: 'case-correction',
      to: 'published',
      actorId: 'ops-1',
      at: '2026-08-18T04:00:00.000Z',
      auditEventId: 'audit-correction-published',
      supersessionAuditEventId: 'audit-source-superseded',
    });

    expect(published.cases.find((item) => item.id === 'case-1')).toMatchObject({
      status: 'superseded',
      updatedAt: '2026-08-18T04:00:00.000Z',
    });
    expect(published.cases.find((item) => item.id === 'case-correction')!.status).toBe('published');
    expect(published.audit.slice(-2)).toEqual([
      expect.objectContaining({
        id: 'audit-correction-published',
        caseId: 'case-correction',
        type: 'case.status_changed',
        details: {
          previousStatus: 'ready_to_publish',
          nextStatus: 'published',
          supersededCaseId: 'case-1',
        },
      }),
      expect.objectContaining({
        id: 'audit-source-superseded',
        caseId: 'case-1',
        type: 'case.superseded',
        details: {
          previousStatus: 'published',
          nextStatus: 'superseded',
          correctionCaseId: 'case-correction',
        },
      }),
    ]);
  });
});
