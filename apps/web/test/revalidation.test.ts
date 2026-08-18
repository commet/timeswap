import { describe, expect, it } from 'vitest';

import { transitionCase } from '../lib/case-service';
import type { CaseStatus, ClassIdentity, WorkspaceState } from '../lib/domain';
import { validateCasePlan } from '../lib/projections';

const klass: ClassIdentity = {
  schoolCode: 'school-1',
  academicYear: '2026',
  dayCourse: '주간',
  affiliation: '일반계',
  major: '공통',
  grade: '2',
  className: '1',
};

function reviewState(): WorkspaceState {
  return {
    schemaVersion: 2,
    workspace: {
      id: 'workspace-1',
      name: '조율고등학교',
      activeRevisionId: 'r2',
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T02:00:00.000Z',
    },
    revisions: [{
      id: 'r1',
      workspaceId: 'workspace-1',
      source: 'neis',
      loadedAt: '2026-08-18T00:00:00.000Z',
      complete: true,
      checksum: 'checksum-r1',
    }, {
      id: 'r2',
      workspaceId: 'workspace-1',
      source: 'neis',
      loadedAt: '2026-08-18T02:00:00.000Z',
      complete: true,
      checksum: 'checksum-r2',
    }],
    lessons: [{
      id: 'lesson-1',
      workspaceId: 'workspace-1',
      revisionId: 'r2',
      date: '2026-08-24',
      period: '2',
      classIdentity: klass,
      subject: '수학',
      room: '2-1',
      teacher: { state: 'assigned', teacherId: 'teacher-1' },
    }],
    cases: [{
      id: 'case-1',
      workspaceId: 'workspace-1',
      requesterTeacherId: 'teacher-1',
      fromDate: '2026-08-24',
      toDate: '2026-08-24',
      reason: '연수·출장',
      lessonIds: ['lesson-1'],
      resolutionItems: [{
        id: 'resolution-1',
        lessonId: 'lesson-1',
        kind: 'move',
        computedAgainstRevisionId: 'r1',
        changes: [{
          lessonId: 'lesson-1',
          toDate: '2026-08-24',
          toPeriod: '4',
          teacher: { state: 'assigned', teacherId: 'teacher-1' },
        }],
      }],
      status: 'in_review',
      createdAt: '2026-08-18T01:00:00.000Z',
      updatedAt: '2026-08-18T01:30:00.000Z',
    }],
    adminTasks: [],
    publications: [],
    audit: [],
  };
}

function currentPlan(): WorkspaceState {
  const state = reviewState();
  state.cases[0] = {
    ...state.cases[0]!,
    resolutionItems: [{
      ...state.cases[0]!.resolutionItems[0]!,
      computedAgainstRevisionId: 'r2',
    }],
  };
  return state;
}

function scaleState(): WorkspaceState {
  const state = currentPlan();
  state.lessons = Array.from({ length: 41 }, (_, index) => ({
    id: `scale-lesson-${index + 1}`,
    workspaceId: 'workspace-1',
    revisionId: 'r2',
    date: '2026-08-24',
    period: '1',
    classIdentity: { ...klass, className: String(index + 1) },
    subject: `subject-${index + 1}`,
    room: `room-${index + 1}`,
    teacher: { state: 'assigned' as const, teacherId: `teacher-${index + 1}` },
  }));
  state.cases = Array.from({ length: 10 }, (_, index) => ({
    id: `scale-case-${index + 1}`,
    workspaceId: 'workspace-1',
    requesterTeacherId: `teacher-${index + 1}`,
    fromDate: '2026-08-24',
    toDate: '2026-08-24',
    reason: '연수·출장' as const,
    lessonIds: [`scale-lesson-${index + 1}`],
    resolutionItems: [{
      id: `scale-resolution-${index + 1}`,
      lessonId: `scale-lesson-${index + 1}`,
      kind: 'move' as const,
      computedAgainstRevisionId: 'r2',
      changes: [{
        lessonId: `scale-lesson-${index + 1}`,
        toDate: '2026-08-24',
        toPeriod: '2',
        teacher: { state: 'assigned' as const, teacherId: `teacher-${index + 1}` },
      }],
    }],
    status: 'in_review' as const,
    createdAt: '2026-08-18T01:00:00.000Z',
    updatedAt: '2026-08-18T01:30:00.000Z',
  }));
  state.audit = [];
  return state;
}

describe('approval revalidation', () => {
  it('does not cover an affected lesson with an unrelated movement', () => {
    const state = currentPlan();
    state.lessons.push({
      ...state.lessons[0]!,
      id: 'lesson-unrelated',
      period: '3',
      classIdentity: { ...klass, className: '2' },
      teacher: { state: 'assigned', teacherId: 'teacher-2' },
    });
    state.cases[0] = {
      ...state.cases[0]!,
      resolutionItems: [{
        id: 'resolution-unrelated',
        lessonId: 'lesson-1',
        kind: 'move',
        computedAgainstRevisionId: 'r2',
        changes: [{
          lessonId: 'lesson-unrelated',
          toDate: '2026-08-24',
          toPeriod: '5',
          teacher: { state: 'assigned', teacherId: 'teacher-2' },
        }],
      }],
    };

    expect(validateCasePlan(state, 'case-1')).toMatchObject({
      valid: false,
      conflicts: [expect.objectContaining({
        lessonId: 'lesson-1',
        kind: 'unknown-occupancy',
      })],
    });
    expect(() => transitionCase(state, {
      caseId: 'case-1',
      to: 'resolution_approved',
      actorId: 'ops-1',
      at: '2026-08-18T03:00:00.000Z',
      auditEventId: 'audit-unrelated-approval',
    })).toThrow(/conflict/i);
  });

  it('does not approve an empty manual resolution', () => {
    const state = currentPlan();
    state.cases[0] = {
      ...state.cases[0]!,
      resolutionItems: [{
        id: 'resolution-empty-manual',
        lessonId: 'lesson-1',
        kind: 'manual',
        computedAgainstRevisionId: 'r2',
        changes: [],
      }],
    };

    expect(validateCasePlan(state, 'case-1').valid).toBe(false);
    expect(() => transitionCase(state, {
      caseId: 'case-1',
      to: 'resolution_approved',
      actorId: 'ops-1',
      at: '2026-08-18T03:00:00.000Z',
      auditEventId: 'audit-empty-manual-approval',
    })).toThrow(/conflict/i);
  });

  it('accepts a manual resolution with an explicit safe action', () => {
    const state = currentPlan();
    state.cases[0] = {
      ...state.cases[0]!,
      resolutionItems: [{
        id: 'resolution-safe-manual',
        lessonId: 'lesson-1',
        kind: 'manual',
        manualAction: '담임교사가 자율학습을 감독합니다.',
        computedAgainstRevisionId: 'r2',
        changes: [],
      }],
    };

    expect(validateCasePlan(state, 'case-1')).toMatchObject({
      valid: true,
      conflicts: [],
    });
  });

  it('blocks a candidate computed against an inactive revision', () => {
    const before = reviewState();

    expect(validateCasePlan(before, 'case-1')).toMatchObject({
      valid: false,
      staleRevision: true,
    });
    expect(() => transitionCase(before, {
      caseId: 'case-1',
      to: 'resolution_approved',
      actorId: 'ops-1',
      at: '2026-08-18T03:00:00.000Z',
      auditEventId: 'audit-approval',
    })).toThrow(/recomputed/i);
    expect(before.cases[0]?.status).toBe('in_review');
    expect(before.adminTasks).toEqual([]);
    expect(before.audit).toEqual([]);
  });

  it('blocks a teacher slot reserved by a concurrently approved case', () => {
    const before = reviewState();
    before.cases[0] = {
      ...before.cases[0]!,
      id: 'case-first',
      resolutionItems: [{
        ...before.cases[0]!.resolutionItems[0]!,
        id: 'resolution-first',
        computedAgainstRevisionId: 'r2',
        changes: [{
          lessonId: 'lesson-1',
          toDate: '2026-08-24',
          toPeriod: '4',
          teacher: { state: 'assigned', teacherId: 'teacher-shared' },
        }],
      }],
    };
    before.lessons.push({
      ...before.lessons[0]!,
      id: 'lesson-2',
      period: '3',
      classIdentity: { ...klass, className: '2' },
      teacher: { state: 'assigned', teacherId: 'teacher-2' },
    });
    before.cases.push({
      ...before.cases[0]!,
      id: 'case-second',
      requesterTeacherId: 'teacher-2',
      lessonIds: ['lesson-2'],
      resolutionItems: [{
        id: 'resolution-second',
        lessonId: 'lesson-2',
        kind: 'cover',
        computedAgainstRevisionId: 'r2',
        changes: [{
          lessonId: 'lesson-2',
          toDate: '2026-08-24',
          toPeriod: '4',
          teacher: { state: 'assigned', teacherId: 'teacher-shared' },
        }],
      }],
    });

    expect(validateCasePlan(before, 'case-second')).toMatchObject({
      valid: true,
      staleRevision: false,
      conflicts: [],
    });
    const firstApproved = transitionCase(before, {
      caseId: 'case-first',
      to: 'resolution_approved',
      actorId: 'ops-1',
      at: '2026-08-18T03:00:00.000Z',
      auditEventId: 'audit-first-approval',
    });

    expect(validateCasePlan(firstApproved, 'case-second')).toMatchObject({
      valid: false,
      staleRevision: false,
      conflicts: [expect.objectContaining({
        lessonId: 'lesson-2',
        kind: 'teacher',
      })],
    });
    expect(() => transitionCase(firstApproved, {
      caseId: 'case-second',
      to: 'resolution_approved',
      actorId: 'ops-1',
      at: '2026-08-18T03:01:00.000Z',
      auditEventId: 'audit-second-approval',
    })).toThrow(/conflict/i);
    expect(firstApproved.cases.find((item) => item.id === 'case-second')?.status)
      .toBe('in_review');
  });

  it.each<[CaseStatus, boolean]>([
    ['draft', true],
    ['submitted', true],
    ['in_review', true],
    ['resolution_approved', false],
    ['admin_in_progress', false],
    ['ready_to_publish', false],
    ['published', false],
  ])('applies the occupancy reservation policy for %s', (status, valid) => {
    const state = currentPlan();
    state.lessons.push({
      ...state.lessons[0]!,
      id: 'lesson-other',
      period: '3',
      classIdentity: { ...klass, className: '2' },
      teacher: { state: 'assigned', teacherId: 'teacher-2' },
    });
    state.cases.push({
      ...state.cases[0]!,
      id: 'case-other',
      requesterTeacherId: 'teacher-2',
      lessonIds: ['lesson-other'],
      status,
      resolutionItems: [{
        id: 'resolution-other',
        lessonId: 'lesson-other',
        kind: 'cover',
        computedAgainstRevisionId: 'r2',
        changes: [{
          lessonId: 'lesson-other',
          toDate: '2026-08-24',
          toPeriod: '4',
          teacher: { state: 'assigned', teacherId: 'teacher-1' },
        }],
      }],
    });

    expect(validateCasePlan(state, 'case-1').valid).toBe(valid);
  });

  it('blocks a source lesson already moved by an approved case', () => {
    const state = currentPlan();
    state.cases.push({
      ...state.cases[0]!,
      id: 'case-approved',
      status: 'resolution_approved',
      resolutionItems: [{
        id: 'resolution-approved',
        lessonId: 'lesson-1',
        kind: 'cover',
        computedAgainstRevisionId: 'r2',
        changes: [{
          lessonId: 'lesson-1',
          toDate: '2026-08-24',
          toPeriod: '5',
          teacher: { state: 'assigned', teacherId: 'teacher-2' },
        }],
      }],
    });

    expect(validateCasePlan(state, 'case-1')).toMatchObject({
      valid: false,
      conflicts: [expect.objectContaining({
        lessonId: 'lesson-1',
        kind: 'class',
      })],
    });
  });

  it('checks base teacher and complete class occupancy at the destination', () => {
    const teacherConflict = currentPlan();
    teacherConflict.lessons.push({
      ...teacherConflict.lessons[0]!,
      id: 'teacher-occupied',
      period: '4',
      classIdentity: { ...klass, className: '2' },
    });
    const classConflict = currentPlan();
    classConflict.lessons.push({
      ...classConflict.lessons[0]!,
      id: 'class-occupied',
      period: '4',
      teacher: { state: 'assigned', teacherId: 'teacher-2' },
    });

    expect(validateCasePlan(teacherConflict, 'case-1').conflicts)
      .toContainEqual(expect.objectContaining({ kind: 'teacher', lessonId: 'lesson-1' }));
    expect(validateCasePlan(classConflict, 'case-1').conflicts)
      .toContainEqual(expect.objectContaining({ kind: 'class', lessonId: 'lesson-1' }));
  });

  it('uses every class identity field instead of grade and class alone', () => {
    const state = currentPlan();
    state.lessons.push({
      ...state.lessons[0]!,
      id: 'same-label-different-major',
      period: '4',
      classIdentity: { ...klass, major: '기계과' },
      teacher: { state: 'assigned', teacherId: 'teacher-2' },
    });

    expect(validateCasePlan(state, 'case-1')).toMatchObject({
      valid: true,
      staleRevision: false,
      conflicts: [],
    });
  });

  it('never treats unassigned or unresolved occupancy as free', () => {
    const unassignedDestination = currentPlan();
    unassignedDestination.lessons.push({
      ...unassignedDestination.lessons[0]!,
      id: 'unknown-teacher',
      period: '4',
      classIdentity: { ...klass, className: '2' },
      teacher: { state: 'unassigned' },
    });
    const unresolvedPlan = currentPlan();
    unresolvedPlan.cases[0] = {
      ...unresolvedPlan.cases[0]!,
      resolutionItems: [{
        id: 'resolution-unresolved',
        lessonId: 'lesson-1',
        kind: 'unresolved',
        computedAgainstRevisionId: 'r2',
        changes: [],
      }],
    };

    expect(validateCasePlan(unassignedDestination, 'case-1').conflicts)
      .toContainEqual(expect.objectContaining({
        kind: 'unknown-occupancy',
        lessonId: 'lesson-1',
      }));
    expect(validateCasePlan(unresolvedPlan, 'case-1').conflicts)
      .toContainEqual(expect.objectContaining({
        kind: 'unknown-occupancy',
        lessonId: 'lesson-1',
      }));
  });

  it('blocks approval when the active revision is incomplete', () => {
    const state = currentPlan();
    state.revisions[1] = { ...state.revisions[1]!, complete: false };

    expect(validateCasePlan(state, 'case-1')).toMatchObject({
      valid: false,
      staleRevision: false,
      conflicts: [expect.objectContaining({ kind: 'unknown-occupancy' })],
    });
  });

  it('blocks a move into a closure recorded by the active revision', () => {
    const state = currentPlan();
    state.revisions[1] = {
      ...state.revisions[1]!,
      closures: [{ date: '2026-08-24', reason: '재량휴업일' }],
    };

    expect(validateCasePlan(state, 'case-1').conflicts).toContainEqual(
      expect.objectContaining({ kind: 'closure', lessonId: 'lesson-1' }),
    );
  });

  it('blocks moving only part of a parallel lesson group', () => {
    const state = currentPlan();
    state.lessons[0] = { ...state.lessons[0]!, parallelGroupId: 'parallel-1' };
    state.lessons.push({
      ...state.lessons[0]!,
      id: 'lesson-parallel',
      subject: '물리',
      teacher: { state: 'assigned', teacherId: 'teacher-2' },
    });

    expect(validateCasePlan(state, 'case-1').conflicts).toContainEqual(
      expect.objectContaining({ kind: 'parallel-group', lessonId: 'lesson-1' }),
    );
  });

  it('accepts a complete parallel group moved to one destination', () => {
    const state = currentPlan();
    state.lessons[0] = { ...state.lessons[0]!, parallelGroupId: 'parallel-1' };
    state.lessons.push({
      ...state.lessons[0]!,
      id: 'lesson-parallel',
      subject: '물리',
      teacher: { state: 'assigned', teacherId: 'teacher-2' },
    });
    state.cases[0] = {
      ...state.cases[0]!,
      lessonIds: ['lesson-1', 'lesson-parallel'],
      resolutionItems: [{
        id: 'resolution-parallel',
        lessonId: 'lesson-1',
        kind: 'move',
        computedAgainstRevisionId: 'r2',
        changes: [{
          lessonId: 'lesson-1',
          toDate: '2026-08-24',
          toPeriod: '4',
          teacher: { state: 'assigned', teacherId: 'teacher-1' },
        }, {
          lessonId: 'lesson-parallel',
          toDate: '2026-08-24',
          toPeriod: '4',
          teacher: { state: 'assigned', teacherId: 'teacher-2' },
        }],
      }],
    };

    expect(validateCasePlan(state, 'case-1')).toMatchObject({
      valid: true,
      conflicts: [],
    });
  });

  it('removes every changed source slot before validating a whole-case swap', () => {
    const state = currentPlan();
    state.lessons.push({
      ...state.lessons[0]!,
      id: 'lesson-2',
      period: '4',
      classIdentity: { ...klass, className: '2' },
      teacher: { state: 'assigned', teacherId: 'teacher-2' },
    });
    state.cases[0] = {
      ...state.cases[0]!,
      lessonIds: ['lesson-1', 'lesson-2'],
      resolutionItems: [{
        id: 'resolution-swap',
        lessonId: 'lesson-1',
        kind: 'swap2',
        computedAgainstRevisionId: 'r2',
        changes: [{
          lessonId: 'lesson-1',
          toDate: '2026-08-24',
          toPeriod: '4',
          teacher: { state: 'assigned', teacherId: 'teacher-2' },
        }, {
          lessonId: 'lesson-2',
          toDate: '2026-08-24',
          toPeriod: '2',
          teacher: { state: 'assigned', teacherId: 'teacher-1' },
        }],
      }],
    };

    expect(validateCasePlan(state, 'case-1')).toMatchObject({
      valid: true,
      staleRevision: false,
      conflicts: [],
    });
  });

  it('validates ten plans in a deterministic 41-class fixture within one second', () => {
    const state = scaleState();
    const startedAt = performance.now();

    const validations = state.cases.map((item) => validateCasePlan(state, item.id));
    const elapsed = performance.now() - startedAt;

    expect(validations.filter((validation) => !validation.valid)).toHaveLength(0);
    expect(elapsed).toBeLessThan(1_000);

    const approved = state.cases.reduce((current, item, index) => transitionCase(current, {
      caseId: item.id,
      to: 'resolution_approved',
      actorId: 'ops-1',
      at: `2026-08-18T03:${String(index).padStart(2, '0')}:00.000Z`,
      auditEventId: `scale-audit-${index + 1}`,
    }), state);
    expect(approved.cases.filter((item) => item.status !== 'resolution_approved'))
      .toHaveLength(0);
  });
});
