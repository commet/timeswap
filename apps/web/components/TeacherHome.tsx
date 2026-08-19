'use client';

import { useMemo, useState } from 'react';

import {
  AbsenceComposer,
  type AbsenceComposerSubmission,
  type CandidateHandoff,
} from './AbsenceComposer';
import { TeacherScheduleGrid } from './Grid';
import type { WorkspaceState } from '../lib/domain';
import { projectTeacherSchedule, type TeacherScheduleLessonView } from '../lib/projections';

export type ScheduleFocus = 'today' | 'week';

function scheduleValue(lesson: TeacherScheduleLessonView) {
  return lesson.pending ?? lesson.published ?? lesson.base;
}

function currentDate(): string {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')]
    .join('-');
}

function teacherLabel(state: WorkspaceState, teacherId: string): string {
  return state.teacherLabels?.[teacherId]?.trim() || '담당 교사';
}

export function TeacherHome({
  state,
  teacherId,
  onSubmit,
  onExportDiagnostic,
  onCandidateHandoff,
}: {
  state: WorkspaceState;
  teacherId: string;
  onSubmit(input: AbsenceComposerSubmission): { caseId?: string; error?: string };
  onExportDiagnostic(): void;
  onCandidateHandoff?(handoff: CandidateHandoff): void;
}) {
  const [focus, setFocus] = useState<ScheduleFocus>('today');
  const [composerOpen, setComposerOpen] = useState(false);
  const [initialLessonId, setInitialLessonId] = useState<string | undefined>();
  const schedule = useMemo(() => projectTeacherSchedule(state, teacherId), [state, teacherId]);
  const dates = useMemo(() => [...new Set(schedule.lessons.map((lesson) => scheduleValue(lesson).date))]
    .sort(), [schedule.lessons]);
  const browserToday = currentDate();
  const todayDate = dates.includes(browserToday) ? browserToday : dates[0] ?? browserToday;
  const todayLessons = useMemo(() => schedule.lessons.filter((lesson) =>
    scheduleValue(lesson).date === todayDate), [schedule.lessons, todayDate]);
  const todayChanges = todayLessons.filter((lesson) => lesson.status !== 'base').length;
  const nowLesson = todayLessons[0];
  const nextLesson = todayLessons[1];
  const label = teacherLabel(state, teacherId);

  function openComposer(lessonId?: string) {
    setInitialLessonId(lessonId);
    setComposerOpen(true);
  }

  return (
    <main className="teacher-command" data-teacher-home aria-labelledby="teacher-home-title">
      <section className="teacher-command-intro">
        <div>
          <span className="eyebrow">{state.workspace.name}</span>
          <h1 id="teacher-home-title">{label} 선생님의 오늘 시간표</h1>
          <p>수업을 먼저 확인하고, 필요한 경우 영향 수업을 골라 하나의 변경 사건으로 요청합니다.</p>
        </div>
        <button className="btn primary teacher-request-button" onClick={() => openComposer()}>변경 요청</button>
      </section>

      <section className="teacher-today" aria-labelledby="teacher-today-title">
        <div className="teacher-today-head">
          <div>
            <span className="eyebrow">오늘 · {todayDate}</span>
            <h2 id="teacher-today-title">수업 흐름</h2>
          </div>
          <p data-today-change-count><b>{todayChanges}</b>건 변경</p>
        </div>
        <div className="teacher-focus-tabs" role="tablist" aria-label="시간표 범위">
          <button role="tab" aria-selected={focus === 'today'} className={focus === 'today' ? 'on' : ''}
            onClick={() => setFocus('today')}>오늘</button>
          <button role="tab" aria-selected={focus === 'week'} className={focus === 'week' ? 'on' : ''}
            onClick={() => setFocus('week')}>주간</button>
        </div>
        {focus === 'today' && (
          <div className="period-rail" aria-label={`${todayDate} 수업`}>
            <article className="now-next" data-now-next>
              <span>지금</span>
              {nowLesson ? <b>{scheduleValue(nowLesson).period}교시 · {nowLesson.subject}</b> : <b>오늘 예정된 수업이 없습니다</b>}
            </article>
            <article className="now-next">
              <span>다음</span>
              {nextLesson ? <b>{scheduleValue(nextLesson).period}교시 · {nextLesson.subject}</b> : <b>다음 수업은 없습니다</b>}
            </article>
            {todayLessons.map((lesson) => {
              const value = scheduleValue(lesson);
              return (
                <button key={lesson.lessonId} className={`period-rail-lesson ${lesson.status === '변경 예정' ? 'planned' : lesson.status}`}
                  onClick={() => openComposer(lesson.lessonId)}>
                  <span>{value.period}교시</span>
                  <b>{lesson.subject}</b>
                  {lesson.status === '변경 예정' && <em>변경 예정</em>}
                  {lesson.status === 'published' && <small>원래 {lesson.subject}</small>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {composerOpen && (
        <AbsenceComposer
          key={initialLessonId ?? 'new-request'}
          state={state}
          teacherId={teacherId}
          initialLessonId={initialLessonId}
          onSubmit={onSubmit}
          onCandidateHandoff={onCandidateHandoff}
          onExportDiagnostic={onExportDiagnostic}
          onDismiss={() => {
            setInitialLessonId(undefined);
            setComposerOpen(false);
          }}
        />
      )}

      {focus === 'week' && (
        <TeacherScheduleGrid lessons={schedule.lessons} onSelectLesson={openComposer} />
      )}
    </main>
  );
}
