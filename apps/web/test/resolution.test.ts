import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ResolutionMatrix } from '../components/ResolutionMatrix';
import { loadDemoScenario } from '../lib/demo';
import {
  selectResolutionForCase,
  resolutionConstraintForLesson,
  resolutionProgressForCase,
  resolutionPreviewForHandoff,
  resolutionDetailForRow,
  resolutionRowsForLesson,
} from '../lib/resolution';

describe('resolution rows', () => {
  it('merges exchange and cover resolutions into ranked rows with populated comparison facts', () => {
    const state = loadDemoScenario('full-day-absence');
    const absenceCase = state.cases[0]!;
    const targetLessonId = absenceCase.lessonIds[0]!;
    state.lessons.push({
      id: 'available-cover-teacher',
      workspaceId: state.workspace.id,
      revisionId: state.workspace.activeRevisionId,
      date: '2026-08-18',
      period: '7',
      classIdentity: {
        schoolCode: '7240454', academicYear: '2026', dayCourse: '주간',
        affiliation: '일반계', major: '공통', grade: '1', className: '1',
      },
      subject: '기계일반', room: '1-1',
      teacher: { state: 'assigned', teacherId: 'member:cover' },
    });
    state.teacherLabels = { ...state.teacherLabels, 'member:cover': '윤보강' };

    const rows = resolutionRowsForLesson(state, absenceCase.id, targetLessonId);

    expect(rows.map((row) => row.method)).toEqual(['맞교환', '보강', '보강', '보강']);
    expect(rows[0]).toMatchObject({
      collaborators: ['맞교환 협조 교사'],
      movedUnitCount: 2,
      studentImpact: expect.any(String),
      burden: expect.any(String),
      state: 'warning',
    });
    expect(rows.slice(1)).toEqual(expect.arrayContaining([expect.objectContaining({
      collaborators: ['윤보강'],
      movedUnitCount: 1,
      studentImpact: expect.any(String),
      burden: expect.any(String),
      state: expect.stringMatching(/^(valid|warning)$/),
    })]));
  });

  it('derives selected preview facts from canonical lessons without exposing a member id', () => {
    const state = loadDemoScenario('simple-swap');
    const absenceCase = state.cases[0]!;
    const row = resolutionRowsForLesson(state, absenceCase.id, absenceCase.lessonIds[0]!)[0]!;

    const detail = resolutionDetailForRow(state, row);

    expect(detail).toMatchObject({
      groupedUnitCount: 2,
      collaborators: ['한솔'],
      warningReasons: [],
      changes: expect.arrayContaining([
        expect.objectContaining({
          original: expect.objectContaining({ subject: '기계일반', period: '3', room: '기계실습실' }),
          next: expect.objectContaining({ subject: '기계일반', period: '4', room: '기계실습실' }),
        }),
      ]),
    });
    expect(JSON.stringify(detail)).not.toContain('teacher:han-sol');
  });

  it('uses a neutral collaborator label when stored display text is an opaque id', () => {
    const state = loadDemoScenario('simple-swap');
    const absenceCase = state.cases[0]!;
    state.teacherLabels = { ...state.teacherLabels, 'teacher:han-sol': '  MEMBER:han-sol  ' };

    const row = resolutionRowsForLesson(state, absenceCase.id, absenceCase.lessonIds[0]!)[0]!;
    const detail = resolutionDetailForRow(state, row);

    expect(row.collaborators).toEqual(['협조 교사']);
    expect(detail.collaborators).toEqual(['협조 교사']);
    expect(JSON.stringify({ row, detail }).toLowerCase()).not.toContain('member:han-sol');
  });

  it('replaces one case item and immediately validates the combined multi-lesson plan', () => {
    const state = loadDemoScenario('full-day-absence');
    const absenceCase = state.cases[0]!;
    const row = resolutionRowsForLesson(state, absenceCase.id, absenceCase.lessonIds[0]!)[0]!;

    const selection = selectResolutionForCase(state, absenceCase.id, row);

    expect(selection.state.cases[0]?.resolutionItems.map((item) => item.id)).toEqual([
      row.resolution.id,
      'full-day-absence:resolution:swap-2',
      'full-day-absence:resolution:cover',
      'full-day-absence:resolution:unresolved',
    ]);
    expect(selection.validation.valid).toBe(false);
    expect(selection.validation.conflicts).toContainEqual(expect.objectContaining({
      lessonId: 'full-day-absence:lesson:absent-4',
    }));
  });

  it('builds a transient canonical preview case from the teacher handoff without saving it', () => {
    const state = loadDemoScenario('simple-swap');
    state.cases = [];
    const preview = resolutionPreviewForHandoff(state, 'teacher:seo-jun', {
      lessonIds: ['simple-swap:lesson:math-3'],
      fromDate: '2026-08-18',
      toDate: '2026-08-18',
      reason: '연수·출장',
      note: '공개 일정입니다.',
      atomicWarnings: [],
    });

    expect(state.cases).toEqual([]);
    expect(preview.state.cases).toEqual([expect.objectContaining({
      id: preview.caseId,
      requesterTeacherId: 'teacher:seo-jun',
      lessonIds: ['simple-swap:lesson:math-3'],
      reason: '연수·출장',
      note: '공개 일정입니다.',
      resolutionItems: [],
      status: 'draft',
    })]);
  });

  it('reports each affected lesson as solved, warning, or unresolved from the combined canonical plan', () => {
    const state = loadDemoScenario('full-day-absence');
    const absenceCase = state.cases[0]!;

    expect(resolutionProgressForCase(state, absenceCase.id).map((item) => item.state)).toEqual([
      '해결', '해결', '해결', '미해결',
    ]);
    expect(resolutionProgressForCase(state, absenceCase.id)[0]).toMatchObject({
      lessonId: absenceCase.lessonIds[0],
      label: '1교시 기계일반',
    });
  });

  it('offers one valid whole-group cover when an elective block has no exchange candidate', () => {
    const state = loadDemoScenario('elective-block');
    const absenceCase = state.cases[0]!;
    const targetLessonId = absenceCase.lessonIds[0]!;
    state.cases[0] = { ...absenceCase, resolutionItems: [] };
    state.lessons.push({
      id: 'elective-cover-availability', workspaceId: state.workspace.id,
      revisionId: state.workspace.activeRevisionId, date: '2026-08-18', period: '6',
      classIdentity: {
        schoolCode: '7240454', academicYear: '2026', dayCourse: '주간',
        affiliation: '일반계', major: '공통', grade: '1', className: '1',
      },
      subject: '데이터과학', room: '1-1',
      teacher: { state: 'assigned', teacherId: 'member:elective-cover' },
    });
    state.teacherLabels = { ...state.teacherLabels, 'member:elective-cover': '선택과목 보강 교사' };
    const { parallelGroupId: _parallelGroupId, ...ungrouped } = state.lessons[0]!;
    for (const period of ['1', '2', '3', '4', '6', '7']) {
      state.lessons.push({
        ...ungrouped,
        id: `elective-known-busy-${period}`,
        period,
        teacher: { state: 'unassigned' },
      });
    }
    state.revisions[0] = {
      ...state.revisions[0]!,
      closures: [
        { date: '2026-08-17', reason: '휴업일' },
        { date: '2026-08-19', reason: '휴업일' },
        { date: '2026-08-20', reason: '휴업일' },
        { date: '2026-08-21', reason: '휴업일' },
      ],
    };

    const rows = resolutionRowsForLesson(state, absenceCase.id, targetLessonId);
    const cover = rows.find((row) => row.method === '보강');

    expect(rows.filter((row) => row.method !== '보강')).toEqual([]);
    expect(cover).toMatchObject({ movedUnitCount: 3, collaborators: expect.arrayContaining(['선택과목 보강 교사']) });
    expect(cover && selectResolutionForCase(state, absenceCase.id, cover).validation.valid).toBe(true);
    expect(resolutionConstraintForLesson(state, targetLessonId, rows)).toContain('선택과목 묶음 3개 수업');
  });

  it('preserves engine-ranked exchange facts from the canonical target week', () => {
    const state = loadDemoScenario('full-day-absence');
    const absenceCase = state.cases[0]!;
    const targetLessonId = absenceCase.lessonIds[0]!;
    state.cases[0] = { ...absenceCase, resolutionItems: [] };
    state.lessons.push({
      id: 'free-period-boundary', workspaceId: state.workspace.id,
      revisionId: state.workspace.activeRevisionId, date: '2026-08-18', period: '7',
      classIdentity: {
        schoolCode: '7240454', academicYear: '2026', dayCourse: '주간',
        affiliation: '일반계', major: '공통', grade: '1', className: '1',
      },
      subject: '진로', room: '1-1',
      teacher: { state: 'assigned', teacherId: 'member:available' },
    });
    state.teacherLabels = { ...state.teacherLabels, 'member:available': '윤지원' };

    const rows = resolutionRowsForLesson(state, absenceCase.id, targetLessonId);
    const generated = rows.filter((row) => 'engineScore' in row) as Array<typeof rows[number] & {
      engineScore: number;
      engineTrace: unknown[];
    }>;

    expect(generated.length).toBeGreaterThan(0);
    expect(generated.map((row) => row.engineScore)).toEqual(
      [...generated.map((row) => row.engineScore)].sort((left, right) => right - left),
    );
    expect(generated[0]?.engineTrace.length).toBeGreaterThan(0);
  });

  it('does not invent a swap or cycle with an unrelated class', () => {
    const state = loadDemoScenario('simple-swap');
    const absenceCase = state.cases[0]!;
    const targetLessonId = absenceCase.lessonIds[0]!;
    state.cases[0] = { ...absenceCase, resolutionItems: [] };
    state.lessons[1] = {
      ...state.lessons[1]!,
      classIdentity: { ...state.lessons[1]!.classIdentity, className: '2' },
    };

    const methods = resolutionRowsForLesson(state, absenceCase.id, targetLessonId)
      .map((row) => row.method);

    expect(methods).not.toContain('맞교환');
    expect(methods).not.toContain('연쇄 교환');
  });

  it('renders a semantic comparison matrix with one resolution action below its selected detail', () => {
    const state = loadDemoScenario('simple-swap');
    const absenceCase = state.cases[0]!;
    const rows = resolutionRowsForLesson(state, absenceCase.id, absenceCase.lessonIds[0]!);
    const selected = rows.find((row) => 'engineScore' in row) ?? rows[0]!;
    const html = renderToStaticMarkup(createElement(ResolutionMatrix, {
      state,
      rows,
      selectedId: selected.id,
      onSelect: () => undefined,
      onConfirm: () => undefined,
    }));

    for (const heading of ['방법', '협조', '변경', '학생 영향', '부담', '상태']) {
      expect(html).toContain(heading);
    }
    expect(html.match(/이 해결안 선택/g)).toHaveLength(1);
    expect(html).toContain('type="radio"');
    expect(html).toContain('변경 전과 후');
    expect(html).toContain('엔진 검토 근거');
  });
});
