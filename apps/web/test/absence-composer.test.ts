import { describe, expect, it } from 'vitest';
import type { ClassIdentity } from '@timeswap/engine';

import {
  atomicSelectionWarnings,
  composerReadiness,
  fullDayLessonIds,
  toggleLessonSelection,
} from '../components/AbsenceComposer';
import type { WorkspaceState } from '../lib/domain';

const klass: ClassIdentity = {
  schoolCode: 'school-1', academicYear: '2026', dayCourse: '주간',
  affiliation: '일반계', major: '공통', grade: '2', className: '1',
};

function stateForComposer(): WorkspaceState {
  return {
    schemaVersion: 2,
    workspace: {
      id: 'workspace-1', name: '조율고등학교', activeRevisionId: 'revision-1',
      createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
    },
    revisions: [{
      id: 'revision-1', workspaceId: 'workspace-1', source: 'neis',
      loadedAt: '2026-08-18T00:00:00.000Z', complete: false, checksum: 'fixture',
      query: { receivedRows: '4', expectedRows: '6' },
    }],
    teacherLabels: { 'member:teacher-1': '김서준' },
    lessons: [
      {
        id: 'lesson-1', workspaceId: 'workspace-1', revisionId: 'revision-1',
        date: '2026-08-24', period: '1', classIdentity: klass, subject: '수학', room: '2-1',
        teacher: { state: 'assigned', teacherId: 'member:teacher-1' }, parallelGroupId: 'practice',
      },
      {
        id: 'lesson-2', workspaceId: 'workspace-1', revisionId: 'revision-1',
        date: '2026-08-24', period: '2', classIdentity: klass, subject: '과학', room: '2-1',
        teacher: { state: 'assigned', teacherId: 'member:teacher-1' }, parallelGroupId: 'practice',
      },
      {
        id: 'lesson-3', workspaceId: 'workspace-1', revisionId: 'revision-1',
        date: '2026-08-24', period: '3', classIdentity: klass, subject: '국어', room: '2-1',
        teacher: { state: 'assigned', teacherId: 'member:teacher-2' },
      },
      {
        id: 'lesson-4', workspaceId: 'workspace-1', revisionId: 'revision-1',
        date: '2026-08-24', period: '4', classIdentity: klass, subject: '영어', room: '2-1',
        teacher: { state: 'unassigned' },
      },
    ],
    atomicLessonGroups: [{
      id: 'practice', workspaceId: 'workspace-1', revisionId: 'revision-1',
      kind: 'professional-practice-block', lessonIds: ['lesson-1', 'lesson-2'],
    }],
    cases: [], adminTasks: [], publications: [], audit: [],
  };
}

describe('absence composer helpers', () => {
  it('selects every assigned teacher lesson when a day is marked whole-day', () => {
    expect(fullDayLessonIds(stateForComposer(), 'member:teacher-1', '2026-08-24')).toEqual([
      'lesson-1', 'lesson-2',
    ]);
  });

  it('allows a teacher to explicitly deselect one lesson after whole-day selection', () => {
    const wholeDay = fullDayLessonIds(stateForComposer(), 'member:teacher-1', '2026-08-24');

    expect(toggleLessonSelection(wholeDay, 'lesson-2')).toEqual(['lesson-1']);
  });

  it('reports exact received and expected source counts while recommendation is unavailable', () => {
    expect(composerReadiness(stateForComposer())).toMatchObject({
      readyForCandidates: false,
      source: { known: 4, expected: 6, complete: false },
      mapping: { known: 1, expected: 2, complete: false },
    });
  });

  it('warns when an explicitly deselected lesson breaks an atomic block', () => {
    expect(atomicSelectionWarnings(stateForComposer(), ['lesson-1'])).toEqual([
      expect.stringContaining('실습 묶음 2개 중 1개 수업만 선택'),
    ]);
  });
});
