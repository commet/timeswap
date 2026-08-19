import { describe, expect, it } from 'vitest';
import type { ClassIdentity } from '@timeswap/engine';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Composer from '../components/AbsenceComposer';

import {
  atomicSelectionWarnings,
  candidateHandoffData,
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
  it('keeps the selected reason and coordination note in the canonical candidate handoff', () => {
    expect(candidateHandoffData({
      fromDate: '2026-08-24',
      toDate: '2026-08-24',
      lessonIds: ['lesson-1'],
      reason: '학교 행사',
      note: '실습실 점검 전까지 이동이 어렵습니다.',
    }, ['실습 묶음을 함께 확인합니다.'])).toEqual({
      fromDate: '2026-08-24',
      toDate: '2026-08-24',
      lessonIds: ['lesson-1'],
      reason: '학교 행사',
      note: '실습실 점검 전까지 이동이 어렵습니다.',
      atomicWarnings: ['실습 묶음을 함께 확인합니다.'],
    });
  });

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

  it.each([
    ['partial official rows', '5', '6'],
    ['mismatched official rows', '7', '6'],
  ])('blocks candidate handoff for %s even when the revision says complete', (_label, receivedRows, expectedRows) => {
    const state = stateForComposer();
    state.revisions[0] = {
      ...state.revisions[0]!,
      complete: true,
      query: { receivedRows, expectedRows },
    };

    expect(composerReadiness(state)).toMatchObject({
      readyForCandidates: false,
      source: { known: Number(receivedRows), expected: Number(expectedRows), complete: false },
    });
  });

  it.each([
    ['5', '6', '공식 시간표 5/6건'],
    ['7', '6', '공식 시간표 7/6건'],
  ])('shows exact received and expected rows for blocked source %s/%s', (receivedRows, expectedRows, expectedCopy) => {
    const messageForUnavailableSource = (Composer as unknown as {
      messageForUnavailableSource?: (readiness: ReturnType<typeof composerReadiness>) => string;
    }).messageForUnavailableSource;
    const state = stateForComposer();
    state.revisions[0] = {
      ...state.revisions[0]!,
      complete: true,
      query: { receivedRows, expectedRows },
    };

    expect(messageForUnavailableSource).toBeTypeOf('function');
    if (typeof messageForUnavailableSource !== 'function') return;
    expect(messageForUnavailableSource(composerReadiness(state))).toContain(expectedCopy);
  });

  it('warns when an explicitly deselected lesson breaks an atomic block', () => {
    expect(atomicSelectionWarnings(stateForComposer(), ['lesson-1'])).toEqual([
      expect.stringContaining('실습 묶음 2개 중 1개 수업만 선택'),
    ]);
  });

  it('keeps the redacted diagnostic export reachable when candidates are ready', () => {
    const state = stateForComposer();
    state.revisions[0] = {
      ...state.revisions[0]!, complete: true,
      query: { receivedRows: '3', expectedRows: '3' },
    };
    state.lessons = state.lessons.filter((lesson) => lesson.teacher.state !== 'unassigned');
    state.teacherLabels = { 'member:teacher-1': '김서준', 'member:teacher-2': '이하늘' };

    const html = renderToStaticMarkup(createElement(Composer.AbsenceComposer, {
      state,
      teacherId: 'member:teacher-1',
      onSubmit: () => ({}),
      onExportDiagnostic: () => undefined,
      onDismiss: () => undefined,
    }));

    expect(composerReadiness(state).readyForCandidates).toBe(true);
    expect(html).toContain('진단 보고서 내보내기');
  });
});
