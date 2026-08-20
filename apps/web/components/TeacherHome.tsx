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
import {
  projectTeacherCases,
  projectTeacherSchedule,
  type TeacherScheduleLessonView,
} from '../lib/projections';
import { TeacherRequestList } from './TeacherRequestList';

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

/** "8월 18일 화요일". 화면 제목이 날짜인 이유는 교사가 묻는 것이 "오늘"이기 때문이다. */
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
function dayTitle(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  if (Number.isNaN(value.valueOf())) return date;
  return `${value.getMonth() + 1}월 ${value.getDate()}일 ${DAY_NAMES[value.getDay()]}요일`;
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
  onWithdraw,
  resolutionPreview,
}: {
  state: WorkspaceState;
  teacherId: string;
  onSubmit(input: AbsenceComposerSubmission): { caseId?: string; error?: string };
  onExportDiagnostic(): void;
  onCandidateHandoff?(handoff: CandidateHandoff): void;
  /** 낸 사람이 요청을 스스로 거둘 때. 안 넘기면 취소 단추가 안 뜬다. */
  onWithdraw?(caseId: string): { error?: string };
  resolutionPreview?: TimetableResolutionPreview;
}) {
  const [focus, setFocus] = useState<ScheduleFocus>('today');
  const [composerOpen, setComposerOpen] = useState(false);
  const [initialLessonId, setInitialLessonId] = useState<string | undefined>();
  const [requestMessage, setRequestMessage] = useState('');
  const schedule = useMemo(() => projectTeacherSchedule(state, teacherId), [state, teacherId]);
  const myCases = useMemo(
    () => projectTeacherCases(state, teacherId)
      .map((item) => onWithdraw ? item : { ...item, withdrawable: false }),
    [state, teacherId, onWithdraw],
  );
  const dates = useMemo(() => [...new Set(schedule.lessons.map((lesson) => scheduleValue(lesson).date))]
    .sort(), [schedule.lessons]);
  const browserToday = currentDate();
  const today = selectTeacherToday(dates, browserToday);
  const todayDate = today.date;
  const todayLessons = useMemo(() => schedule.lessons.filter((lesson) =>
    scheduleValue(lesson).date === todayDate), [schedule.lessons, todayDate]);
  const todayChanges = todayLessons.filter((lesson) => lesson.status !== 'base').length;
  const label = teacherLabel(state, teacherId);
  /* 바뀐 교시를 번호로 부른다. "주홍 표시"라고 안내하면 색을 못 보는 분에게 쓸모가 없다. */
  const changedPeriods = useMemo(() => [...new Set(todayLessons
    .filter((lesson) => lesson.status !== 'base')
    .map((lesson) => Number(scheduleValue(lesson).period) || 0))]
    .sort((left, right) => left - right), [todayLessons]);
  /*
   * 하루를 교시 순서로 세운다. 수업이 없는 교시도 줄에 남긴다.
   *
   * 앞서는 수업이 있는 칸만 카드로 흩어 놓았다. 그러면 "3교시가 비었다"는 사실이 화면에서
   * 사라진다. 결강을 대신 맡을 자리를 찾는 사람에게는 빈 교시가 가장 중요한 정보다.
   */
  const rail = useMemo(() => {
    const byPeriod = new Map<number, TeacherScheduleLessonView[]>();
    for (const lesson of todayLessons) {
      const period = Number(scheduleValue(lesson).period) || 0;
      byPeriod.set(period, [...(byPeriod.get(period) ?? []), lesson]);
    }
    const last = Math.max(0, ...byPeriod.keys());
    return Array.from({ length: last }, (_, index) => ({
      period: index + 1,
      lessons: byPeriod.get(index + 1) ?? [],
    }));
  }, [todayLessons]);

  function openComposer(lessonId?: string) {
    setInitialLessonId(lessonId);
    setComposerOpen(true);
  }

  return (
    <main id="main-content" tabIndex={-1} className="teacher-command" data-teacher-home aria-labelledby="teacher-home-title">
      <section className="teacher-command-intro">
        <div>
          <span className="eyebrow">{state.workspace.name} · {label} 선생님</span>
          <h1 id="teacher-home-title">{dayTitle(todayDate)}</h1>
          {/* 표를 보여 주기 전에 물음에 먼저 답한다. 오늘 내 수업이 바뀌었는가. */}
          <p className="teacher-verdict" data-now-next data-today-change-count>
            {changedPeriods.length > 0
              ? <><b className="mark">{changedPeriods.join(', ')}교시</b>가 바뀌었습니다.</>
              : <>바뀐 수업이 없습니다.</>}
          </p>
        </div>
        <button className="btn primary teacher-request-button" onClick={() => openComposer()}>변경 요청</button>
      </section>

      <section className="teacher-today" aria-labelledby="teacher-today-title">
        <div className="teacher-today-head">
          <h2 id="teacher-today-title">{today.label === '오늘' ? '오늘' : dayTitle(todayDate)}</h2>
          <div className="teacher-focus-tabs" role="tablist" aria-label="시간표 범위">
            <button role="tab" aria-selected={focus === 'today'} className={focus === 'today' ? 'on' : ''}
              onClick={() => setFocus('today')}>하루</button>
            <button role="tab" aria-selected={focus === 'week'} className={focus === 'week' ? 'on' : ''}
              onClick={() => setFocus('week')}>주간</button>
          </div>
        </div>
        {focus === 'today' && (
          <ol className="period-rail" aria-label={`${todayDate} 수업`}>
            {rail.map((slot) => (
              <li key={slot.period} className="rail-row">
                <span className="rail-period num" aria-hidden>{slot.period}</span>
                {slot.lessons.length === 0 ? (
                  <span className="rail-free">수업 없음</span>
                ) : slot.lessons.map((lesson) => {
                  const value = scheduleValue(lesson);
                  const changed = lesson.status !== 'base';
                  return (
                    <button
                      key={lesson.lessonId}
                      className={`period-rail-lesson ${changed ? 'changed' : ''}`}
                      onClick={() => openComposer(lesson.lessonId)}
                    >
                      <b>{value.subject}</b>
                      <span className="rail-where">
                        {value.classIdentity.grade}-{value.classIdentity.className}
                        <i>{value.room}</i>
                      </span>
                      {changed && (
                        <span className="rail-from">
                          원래 {lesson.base.period}교시 {lesson.base.subject}
                          {lesson.status === '변경 예정' ? ' · 결재 중' : ''}
                        </span>
                      )}
                    </button>
                  );
                })}
              </li>
            ))}
          </ol>
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

      <TeacherRequestList
        cases={myCases}
        message={requestMessage}
        onWithdraw={(caseId) => {
          const result = onWithdraw?.(caseId);
          setRequestMessage(result?.error ?? '요청을 취소했습니다.');
        }}
      />
    </main>
  );
}
