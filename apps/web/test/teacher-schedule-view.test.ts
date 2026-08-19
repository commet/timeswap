import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ClassIdentity } from '@timeswap/engine';

import * as Grid from '../components/Grid';
import * as TeacherHomeModule from '../components/TeacherHome';
import { createDemoWorkspace } from '../lib/demo';
import type { TeacherScheduleLessonView } from '../lib/projections';

const klass: ClassIdentity = {
  schoolCode: 'school-1', academicYear: '2026', dayCourse: '주간',
  affiliation: '일반계', major: '공통', grade: '2', className: '1',
};

function view(lessonId: string, period: string, subject: string, status: TeacherScheduleLessonView['status'] = 'base'): TeacherScheduleLessonView {
  const base = { date: '2026-08-24', period, teacherId: 'member:teacher', subject, room: `${subject}실`, classIdentity: klass };
  return {
    lessonId, subject, room: base.room, classIdentity: klass, status, base,
    ...(status === '변경 예정' ? {
      pending: { ...base, period: '10', subject: `${subject} 변경`, room: `${subject} 새교실`, classIdentity: { ...klass, className: '2' }, caseId: 'case-1' },
    } : {}),
    ...(status === 'published' ? {
      published: { ...base, period: '11', subject: `${subject} 게시`, room: `${subject} 게시교실`, classIdentity: { ...klass, className: '3' }, publicationId: 'publication-1', publishedAt: '2026-08-18T00:00:00.000Z' },
    } : {}),
  };
}

describe('teacher schedule view helpers', () => {
  it('labels an available browser date as today and a missing browser date as a loaded date', () => {
    const selectToday = (TeacherHomeModule as unknown as {
      selectTeacherToday?: (dates: readonly string[], browserDate: string) => { date: string; label: string };
    }).selectTeacherToday;

    expect(selectToday).toBeTypeOf('function');
    if (typeof selectToday !== 'function') return;

    expect(selectToday(['2026-08-24', '2026-08-25'], '2026-08-24')).toEqual({ date: '2026-08-24', label: '오늘' });
    expect(selectToday(['2026-08-24', '2026-08-25'], '2026-08-19')).toEqual({ date: '2026-08-24', label: '불러온 수업일' });
  });

  it('uses ordered lesson labels instead of ungrounded wall-clock semantics', () => {
    const state = createDemoWorkspace();
    const teacher = state.lessons[0]?.teacher;
    if (!teacher || teacher.state !== 'assigned') throw new Error('fixture requires an assigned teacher');

    const html = renderToStaticMarkup(createElement(TeacherHomeModule.TeacherHome, {
      state,
      teacherId: teacher.teacherId,
      onSubmit: () => ({}),
      onExportDiagnostic: () => undefined,
    }));

    expect(html).toContain('오늘 첫 수업');
    expect(html).toContain('그다음 수업');
    expect(html).not.toContain('>지금<');
    expect(html).not.toContain('>다음<');
  });

  it('keeps every lesson that shares one date and period and renders changed original/new details', () => {
    const teacherWeekSlots = (Grid as unknown as {
      teacherWeekSlots?: (lessons: TeacherScheduleLessonView[]) => Map<string, TeacherScheduleLessonView[]>;
    }).teacherWeekSlots;
    const lessons = [view('lesson-a', '2', '수학'), view('lesson-b', '2', '과학'), view('lesson-pending', '3', '영어', '변경 예정'), view('lesson-published', '4', '국어', 'published')];

    expect(teacherWeekSlots).toBeTypeOf('function');
    if (typeof teacherWeekSlots !== 'function') return;

    expect(teacherWeekSlots(lessons).get('2026-08-24\u00002')?.map((lesson) => lesson.lessonId)).toEqual(['lesson-a', 'lesson-b']);

    const html = renderToStaticMarkup(createElement(Grid.TeacherScheduleGrid, {
      lessons,
      onSelectLesson: () => undefined,
    }));
    for (const detail of ['영어 변경', '영어 새교실', '원래 영어 · 2-1 · 3교시 · 영어실', '국어 게시', '국어 게시교실', '원래 국어 · 2-1 · 4교시 · 국어실']) {
      expect(html).toContain(detail);
    }
    expect(html).toContain('수학');
    expect(html).toContain('과학');
  });

  it('marks the selected resolution source and destination slots in the timetable', () => {
    const lessons = [view('lesson-source', '2', '수학'), view('lesson-destination', '5', '과학')];
    const html = renderToStaticMarkup(createElement(Grid.TeacherScheduleGrid, {
      lessons,
      onSelectLesson: () => undefined,
      resolutionPreview: {
        changes: [{
          lessonId: 'lesson-source',
          original: { date: '2026-08-24', period: '2', subject: '수학', className: '2-1', room: '수학실' },
          next: { date: '2026-08-24', period: '5', subject: '수학', className: '2-1', room: '수학실', teacher: '담당 교사' },
        }],
      },
    }));

    expect(html).toContain('data-resolution-from="true"');
    expect(html).toContain('data-resolution-to="true"');
  });

  it('adds an empty preview destination period to the teacher grid axes', () => {
    const html = renderToStaticMarkup(createElement(Grid.TeacherScheduleGrid, {
      lessons: [view('lesson-source', '3', '수학')],
      onSelectLesson: () => undefined,
      resolutionPreview: {
        changes: [{
          lessonId: 'lesson-source',
          next: { date: '2026-08-24', period: '1', subject: '수학', className: '2-1', room: '수학실', teacher: '담당 교사' },
        }],
      },
    }));

    expect(html).toContain('1교시');
    expect(html).toContain('data-resolution-to="true"');
    expect(html).toContain('2026-08-24 1교시 공강');
  });
});
