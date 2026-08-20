'use client';

import { useMemo, useState } from 'react';

import {
  AbsenceComposer,
  type AbsenceComposerSubmission,
  type CandidateHandoff,
} from './AbsenceComposer';
import { TeacherScheduleGrid, type TimetableResolutionPreview } from './Grid';
import type { WorkspaceState } from '../lib/domain';
import { localDate } from '../lib/today';
import { projectTeacherSchedule, type TeacherScheduleLessonView } from '../lib/projections';

export type ScheduleFocus = 'today' | 'week';

function scheduleValue(lesson: TeacherScheduleLessonView) {
  return lesson.pending ?? lesson.published ?? lesson.base;
}

// 오늘을 정하는 곳은 lib/today.ts 하나다. 화면마다 따로 구하면 서로 다른 날이 된다.
const currentDate = (): string => localDate();

export function selectTeacherToday(
  dates: readonly string[],
  browserDate: string,
): { date: string; label: '오늘' | '불러온 수업일' | '불러온 수업일 없음' } {
  if (dates.includes(browserDate)) return { date: browserDate, label: '오늘' };
  const loadedDate = [...dates].sort()[0];
  return loadedDate
    ? { date: loadedDate, label: '불러온 수업일' }
    : { date: browserDate, label: '불러온 수업일 없음' };
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
  resolutionPreview,
}: {
  state: WorkspaceState;
  teacherId: string;
  onSubmit(input: AbsenceComposerSubmission): { caseId?: string; error?: string };
  onExportDiagnostic(): void;
  onCandidateHandoff?(handoff: CandidateHandoff): void;
  resolutionPreview?: TimetableResolutionPreview;
}) {
  const [focus, setFocus] = useState<ScheduleFocus>('today');
  const [composerOpen, setComposerOpen] = useState(false);
  const [initialLessonId, setInitialLessonId] = useState<string | undefined>();
  const schedule = useMemo(() => projectTeacherSchedule(state, teacherId), [state, teacherId]);
  const dates = useMemo(() => [...new Set(schedule.lessons.map((lesson) => scheduleValue(lesson).date))]
    .sort(), [schedule.lessons]);
  const browserToday = currentDate();
  const today = selectTeacherToday(dates, browserToday);
  const todayDate = today.date;
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
    <main id="main-content" tabIndex={-1} className="teacher-command" data-teacher-home aria-labelledby="teacher-home-title">
      <section className="teacher-command-intro">
        <div>
          <span className="eyebrow">{state.workspace.name}</span>
          <h1 id="teacher-home-title">{label} 선생님의 시간표</h1>
          <p>수업을 먼저 확인하고, 필요한 경우 영향 수업을 골라 하나의 변경 사건으로 요청합니다.</p>
        </div>
        <button className="btn primary teacher-request-button" onClick={() => openComposer()}>변경 요청</button>
      </section>

      <section className="teacher-today" aria-labelledby="teacher-today-title">
        <div className="teacher-today-head">
          <div>
            <span className="eyebrow">{today.label} · {todayDate}</span>
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
              <span>오늘 첫 수업</span>
              {nowLesson ? <b>{scheduleValue(nowLesson).period}교시 · {scheduleValue(nowLesson).subject}</b> : <b>표시할 수업이 없습니다</b>}
            </article>
            <article className="now-next">
              <span>그다음 수업</span>
              {nextLesson ? <b>{scheduleValue(nextLesson).period}교시 · {scheduleValue(nextLesson).subject}</b> : <b>다음 수업은 없습니다</b>}
            </article>
            {todayLessons.map((lesson) => {
              const value = scheduleValue(lesson);
              return (
                <button key={lesson.lessonId} className={`period-rail-lesson ${lesson.status === '변경 예정' ? 'planned' : lesson.status}`}
                  onClick={() => openComposer(lesson.lessonId)}>
                  <span>{value.period}교시</span>
                  <b>{value.subject}</b>
                  {lesson.status === '변경 예정' && <em>변경 예정</em>}
                  {lesson.status !== 'base' && <small>원래 {lesson.base.subject} · {lesson.base.classIdentity.grade}-{lesson.base.classIdentity.className} · {lesson.base.period}교시 · {lesson.base.room}</small>}
                  <small>{value.classIdentity.grade}-{value.classIdentity.className} · {value.room}</small>
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
          onCandidateHandoff={(handoff) => {
            setInitialLessonId(undefined);
            setComposerOpen(false);
            onCandidateHandoff?.(handoff);
          }}
          onExportDiagnostic={onExportDiagnostic}
          onDismiss={() => {
            setInitialLessonId(undefined);
            setComposerOpen(false);
          }}
        />
      )}

      {focus === 'week' && (
        <TeacherScheduleGrid lessons={schedule.lessons} onSelectLesson={openComposer}
          resolutionPreview={resolutionPreview} />
      )}
    </main>
  );
}
