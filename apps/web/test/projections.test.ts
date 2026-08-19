import { classIdentityKey, type ClassIdentity } from '@timeswap/engine';
import { describe, expect, it } from 'vitest';

import type { CaseStatus, WorkspaceState } from '../lib/domain';
import {
  projectOpsDashboard,
  projectPublicClassSchedule,
  projectTeacherSchedule,
} from '../lib/projections';

const klass: ClassIdentity = {
  schoolCode: 'school-1',
  academicYear: '2026',
  dayCourse: '주간',
  affiliation: '일반계',
  major: '공통',
  grade: '2',
  className: '3',
};

function stateAt(status: CaseStatus): WorkspaceState {
  return {
    schemaVersion: 2,
    workspace: {
      id: 'workspace-1',
      name: '조율고등학교',
      activeRevisionId: 'revision-1',
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T01:00:00.000Z',
    },
    revisions: [{
      id: 'revision-1',
      workspaceId: 'workspace-1',
      source: 'neis',
      loadedAt: '2026-08-18T00:00:00.000Z',
      complete: true,
      checksum: 'checksum-1',
    }],
    lessons: [{
      id: 'lesson-1',
      workspaceId: 'workspace-1',
      revisionId: 'revision-1',
      date: '2026-08-24',
      period: '2',
      classIdentity: klass,
      subject: '수학',
      room: '2-3',
      teacher: { state: 'assigned', teacherId: '김수학' },
    }],
    cases: [{
      id: 'case-1',
      workspaceId: 'workspace-1',
      requesterTeacherId: '김수학',
      fromDate: '2026-08-24',
      toDate: '2026-08-24',
      reason: '연수·출장',
      note: '공개하면 안 되는 관리자 메모',
      lessonIds: ['lesson-1'],
      resolutionItems: [{
        id: 'resolution-1',
        lessonId: 'lesson-1',
        kind: 'move',
        computedAgainstRevisionId: 'revision-1',
        changes: [{
          lessonId: 'lesson-1',
          toDate: '2026-08-24',
          toPeriod: '4',
          teacher: { state: 'assigned', teacherId: '이수학' },
        }],
      }],
      status,
      createdAt: '2026-08-18T00:30:00.000Z',
      updatedAt: '2026-08-18T01:00:00.000Z',
    }],
    adminTasks: [],
    publications: [{
      id: 'publication-1',
      workspaceId: 'workspace-1',
      caseId: 'case-1',
      revisionId: 'revision-1',
      changedLessonIds: ['lesson-1'],
      publishedAt: '2026-08-18T01:00:00.000Z',
      publishedBy: 'ops-secret',
    }],
    audit: [{
      id: 'audit-1',
      workspaceId: 'workspace-1',
      caseId: 'case-1',
      actorId: 'audit-secret',
      type: 'case.status_changed',
      at: '2026-08-18T01:00:00.000Z',
      details: { nextStatus: status },
    }],
  };
}

describe('projectPublicClassSchedule', () => {
  it.each<CaseStatus>(['resolution_approved', 'ready_to_publish'])(
    'keeps the base lesson private while the case is %s',
    (status) => {
      const before = stateAt(status);

      const view = projectPublicClassSchedule(before, classIdentityKey(klass));

      expect(view.lessons).toEqual([expect.objectContaining({
        lessonId: 'lesson-1',
        period: '2',
        subject: '수학',
        changed: false,
      })]);
      expect(before.lessons[0]?.period).toBe('2');
    },
  );

  it('applies the changed lesson only after publication', () => {
    const view = projectPublicClassSchedule(stateAt('published'), classIdentityKey(klass));

    expect(view.lessons).toEqual([expect.objectContaining({
      lessonId: 'lesson-1',
      period: '4',
      subject: '수학',
      changed: true,
      originalPeriod: '2',
      publicationId: 'publication-1',
    })]);
    expect(JSON.stringify(view)).not.toContain('공개하면 안 되는 관리자 메모');
    expect(JSON.stringify(view)).not.toContain('ops-secret');
    expect(JSON.stringify(view)).not.toContain('audit-secret');
    for (const privateField of [
      'requesterTeacherId',
      'reason',
      'note',
      'burden',
      'score',
      'actorId',
      'publishedBy',
    ]) {
      expect(JSON.stringify(view)).not.toContain(privateField);
    }
  });
});

describe('projectTeacherSchedule', () => {
  it('keeps an approved value planned until a matching publication exists', () => {
    const approved = stateAt('resolution_approved');
    const published = stateAt('published');

    expect(projectTeacherSchedule(approved, '김수학').lessons).toEqual([
      expect.objectContaining({
        lessonId: 'lesson-1',
        status: '변경 예정',
        base: expect.objectContaining({
          period: '2', teacherId: '김수학', subject: '수학', room: '2-3', classIdentity: klass,
        }),
        pending: expect.objectContaining({
          period: '4', teacherId: '이수학', subject: '수학', room: '2-3', classIdentity: klass,
        }),
        published: undefined,
      }),
    ]);
    expect(projectTeacherSchedule(published, '김수학').lessons).toEqual([
      expect.objectContaining({
        lessonId: 'lesson-1',
        status: 'published',
        base: expect.objectContaining({
          period: '2', teacherId: '김수학', subject: '수학', room: '2-3', classIdentity: klass,
        }),
        pending: undefined,
        published: expect.objectContaining({
          period: '4',
          teacherId: '이수학',
          subject: '수학',
          room: '2-3',
          classIdentity: klass,
          publicationId: 'publication-1',
        }),
      }),
    ]);
  });

  it('omits a pending value computed against an inactive revision', () => {
    const state = stateAt('resolution_approved');
    state.workspace = { ...state.workspace, activeRevisionId: 'revision-2' };
    state.revisions.push({
      ...state.revisions[0]!,
      id: 'revision-2',
      loadedAt: '2026-08-18T02:00:00.000Z',
      checksum: 'checksum-2',
    });
    state.lessons[0] = { ...state.lessons[0]!, revisionId: 'revision-2' };

    expect(projectTeacherSchedule(state, '김수학').lessons).toEqual([
      expect.objectContaining({
        lessonId: 'lesson-1',
        status: 'base',
        pending: undefined,
        published: undefined,
      }),
    ]);
  });

  it('shows a pending correction over its older published value', () => {
    const state = stateAt('published');
    state.cases.push({
      ...state.cases[0]!,
      id: 'case-correction',
      status: 'resolution_approved',
      supersedesCaseId: 'case-1',
      updatedAt: '2026-08-18T02:00:00.000Z',
      resolutionItems: [{
        id: 'resolution-correction',
        lessonId: 'lesson-1',
        kind: 'cover',
        computedAgainstRevisionId: 'revision-1',
        changes: [{
          lessonId: 'lesson-1',
          toDate: '2026-08-24',
          toPeriod: '6',
          teacher: { state: 'assigned', teacherId: '박수학' },
        }],
      }],
    });

    expect(projectTeacherSchedule(state, '김수학').lessons).toEqual([
      expect.objectContaining({
        lessonId: 'lesson-1',
        status: '변경 예정',
        pending: expect.objectContaining({
          period: '6',
          teacherId: '박수학',
          caseId: 'case-correction',
        }),
        published: expect.objectContaining({
          period: '4',
          teacherId: '이수학',
          publicationId: 'publication-1',
        }),
      }),
    ]);
  });

  it('orders multi-digit teaching periods numerically in the teacher projection', () => {
    const state = stateAt('submitted');
    state.lessons.push({
      ...state.lessons[0]!,
      id: 'lesson-10',
      period: '10',
      subject: '과학',
    });

    expect(projectTeacherSchedule(state, '김수학').lessons.map((lesson) => lesson.base.period)).toEqual(['2', '10']);
  });
});

describe('projectOpsDashboard', () => {
  it('derives every count and source warning without changing canonical state', () => {
    const before = stateAt('published');
    before.revisions[0] = { ...before.revisions[0]!, complete: false };
    before.lessons.push({
      ...before.lessons[0]!,
      id: 'lesson-unassigned',
      period: '5',
      teacher: { state: 'unassigned' },
    });
    before.cases.push({
      ...before.cases[0]!,
      id: 'case-review',
      status: 'in_review',
      lessonIds: ['lesson-unassigned'],
      resolutionItems: [{
        id: 'resolution-unresolved',
        lessonId: 'lesson-unassigned',
        kind: 'unresolved',
        computedAgainstRevisionId: 'revision-1',
        changes: [],
      }],
    });
    before.adminTasks.push({
      id: 'task-neis',
      workspaceId: 'workspace-1',
      caseId: 'case-1',
      kind: 'neis',
      required: true,
      status: 'pending',
      createdAt: '2026-08-18T01:00:00.000Z',
      updatedAt: '2026-08-18T01:00:00.000Z',
    }, {
      id: 'task-publication',
      workspaceId: 'workspace-1',
      caseId: 'case-1',
      kind: 'class_publication',
      required: true,
      status: 'pending',
      createdAt: '2026-08-18T01:00:00.000Z',
      updatedAt: '2026-08-18T01:00:00.000Z',
    });
    const snapshot = structuredClone(before);

    const view = projectOpsDashboard(before, '2026-08-24');

    expect(view).toMatchObject({
      today: '2026-08-24',
      todayChanges: 1,
      unresolvedLessons: 1,
      pendingCases: 1,
      neisTasks: 1,
      publicationTasks: 1,
      burdenAlerts: 0,
      sourceHealth: {
        activeRevisionId: 'revision-1',
        complete: false,
        lessonCount: 2,
        unassignedLessons: 1,
      },
    });
    expect(before).toEqual(snapshot);
  });

  it.each([
    ['swap2', 2, false],
    ['cycle3', 3, false],
    ['move', 2, true],
  ] as const)('counts every lesson moved by one %s resolution as resolved', (kind, count, grouped) => {
    const state = stateAt('in_review');
    state.lessons = Array.from({ length: count }, (_, index) => ({
      ...state.lessons[0]!,
      id: `lesson-${index + 1}`,
      period: String(index + 1),
      classIdentity: { ...klass, className: String(index + 3) },
      ...(grouped ? { parallelGroupId: 'parallel-1' } : {}),
    }));
    state.cases[0] = {
      ...state.cases[0]!,
      lessonIds: state.lessons.map((lesson) => lesson.id),
      resolutionItems: [{
        id: 'resolution-multi',
        lessonId: 'lesson-1',
        kind,
        computedAgainstRevisionId: 'revision-1',
        changes: state.lessons.map((lesson, index) => ({
          lessonId: lesson.id,
          toDate: '2026-08-25',
          toPeriod: String(index + 1),
          teacher: lesson.teacher,
        })),
      }],
    };

    expect(projectOpsDashboard(state, '2026-08-24').unresolvedLessons).toBe(0);
  });

  it('counts an affected lesson as unresolved when only an unrelated lesson moves', () => {
    const state = stateAt('in_review');
    state.lessons.push({
      ...state.lessons[0]!,
      id: 'lesson-unrelated',
      period: '3',
      classIdentity: { ...klass, className: '4' },
    });
    state.cases[0] = {
      ...state.cases[0]!,
      resolutionItems: [{
        id: 'resolution-unrelated',
        lessonId: 'lesson-1',
        kind: 'move',
        computedAgainstRevisionId: 'revision-1',
        changes: [{
          lessonId: 'lesson-unrelated',
          toDate: '2026-08-25',
          toPeriod: '3',
          teacher: state.lessons[1]!.teacher,
        }],
      }],
    };

    expect(projectOpsDashboard(state, '2026-08-24').unresolvedLessons).toBe(1);
  });

  it('reports a burden alert after three accepted assignments to one teacher', () => {
    const state = stateAt('resolution_approved');
    state.lessons.push({
      ...state.lessons[0]!,
      id: 'lesson-2',
      period: '3',
      classIdentity: { ...klass, className: '4' },
    }, {
      ...state.lessons[0]!,
      id: 'lesson-3',
      period: '5',
      classIdentity: { ...klass, className: '5' },
    });
    state.cases[0]!.resolutionItems[0]!.changes.push({
      lessonId: 'lesson-2',
      toDate: '2026-08-24',
      toPeriod: '6',
      teacher: { state: 'assigned', teacherId: '이수학' },
    }, {
      lessonId: 'lesson-3',
      toDate: '2026-08-24',
      toPeriod: '7',
      teacher: { state: 'assigned', teacherId: '이수학' },
    });

    expect(projectOpsDashboard(state, '2026-08-24')).toMatchObject({
      burdenAlerts: 1,
      burden: [{ teacherId: '이수학', acceptedChanges: 3 }],
    });
  });
});
