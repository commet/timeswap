import { describe, expect, it } from 'vitest';
import type { ClassIdentity } from '@timeswap/engine';

import * as Composer from '../components/AbsenceComposer';
import type { WorkspaceState } from '../lib/domain';

const klass: ClassIdentity = {
  schoolCode: 'school-1', academicYear: '2026', dayCourse: '주간',
  affiliation: '일반계', major: '공통', grade: '2', className: '1',
};

function diagnosticState(): WorkspaceState {
  return {
    schemaVersion: 2,
    workspace: {
      id: 'workspace-secret', name: '조율고등학교', activeRevisionId: 'revision-1',
      createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
    },
    revisions: [{
      id: 'revision-1', workspaceId: 'workspace-secret', source: 'neis',
      loadedAt: '2026-08-18T00:00:00.000Z', complete: false, checksum: 'secret-checksum',
      query: { receivedRows: '5', expectedRows: '6' },
    }],
    teacherLabels: { 'member:teacher-1': '김서준' },
    lessons: [{
      id: 'lesson-secret', workspaceId: 'workspace-secret', revisionId: 'revision-1',
      date: '2026-08-24', period: '10', classIdentity: klass, subject: '비밀 과목', room: '비밀 교실',
      teacher: { state: 'assigned', teacherId: 'member:teacher-1' },
    }, {
      id: 'lesson-unassigned', workspaceId: 'workspace-secret', revisionId: 'revision-1',
      date: '2026-08-24', period: '11', classIdentity: klass, subject: '다른 과목', room: '다른 교실',
      teacher: { state: 'unassigned' },
    }],
    cases: [{
      id: 'case-secret', workspaceId: 'workspace-secret', requesterTeacherId: 'member:teacher-1',
      fromDate: '2026-08-24', toDate: '2026-08-24', reason: '기타', note: '민감한 협조 메모',
      lessonIds: ['lesson-secret'], resolutionItems: [], status: 'submitted',
      createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
    }],
    adminTasks: [{
      id: 'task-secret', workspaceId: 'workspace-secret', caseId: 'case-secret', kind: 'neis', required: true,
      status: 'pending', createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
    }],
    publications: [{
      id: 'publication-secret', workspaceId: 'workspace-secret', caseId: 'case-secret', revisionId: 'revision-1',
      changedLessonIds: ['lesson-secret'], publishedAt: '2026-08-18T00:00:00.000Z', publishedBy: 'ops-secret',
    }],
    audit: [{
      id: 'audit-secret', workspaceId: 'workspace-secret', caseId: 'case-secret', actorId: 'audit-secret',
      type: 'case.created', at: '2026-08-18T00:00:00.000Z', details: {},
    }],
  };
}

describe('teacher diagnostic projection', () => {
  it('exports only redacted counts, safe revision metadata, and non-identifying issues', () => {
    const project = (Composer as unknown as {
      projectTeacherDiagnostic?: (state: WorkspaceState) => unknown;
    }).projectTeacherDiagnostic;

    expect(project).toBeTypeOf('function');
    if (typeof project !== 'function') return;

    const diagnostic = project(diagnosticState());

    expect(diagnostic).toEqual({
      kind: 'teacher-absence-diagnostic',
      source: { receivedRows: 5, expectedRows: 6, complete: false },
      mapping: { knownTeachers: 1, expectedTeachers: 1, unassignedLessons: 1, complete: false },
      revision: { source: 'neis', loadedAt: '2026-08-18T00:00:00.000Z', complete: false },
      issues: [
        '공식 시간표 행이 완전하지 않습니다 (5/6건).',
        '교사 연결이 완전하지 않습니다 (1/1명, 담당 미확정 수업 1건).',
      ],
    });

    const serialized = JSON.stringify(diagnostic);
    for (const secret of [
      'workspace-secret', '조율고등학교', 'lesson-secret', '비밀 과목', '비밀 교실',
      '김서준', 'member:teacher-1', 'case-secret', '민감한 협조 메모', 'task-secret',
      'publication-secret', 'ops-secret', 'audit-secret', 'secret-checksum',
    ]) expect(serialized).not.toContain(secret);
    for (const forbiddenKey of ['lessons', 'teacherLabels', 'cases', 'adminTasks', 'publications', 'audit']) {
      expect(serialized).not.toContain(`\"${forbiddenKey}\"`);
    }
  });
});
