'use client';

import { useMemo } from 'react';
import { classIdentityKey } from '@timeswap/engine';

import type { WorkspaceState } from '../lib/domain';
import { projectPublicClassSchedule } from '../lib/projections';
import { publishedTimeLabel } from '../lib/publication';

export type PublicClassTimetableProps = {
  state: WorkspaceState;
  grade: string;
  className: string;
  /** 특수학교의 학교 과정. 초중고에는 없다 */
  course?: string;
  today: string;
};

function dayOffset(from: string, days: number): string {
  const parsed = new Date(`${from}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * The public class timetable is the only screen a student or parent could
 * reach, so it carries lesson facts and publication time and nothing about
 * who was absent, why, or what it cost anyone.
 */
/**
 * 수업이 없는 칸에 적을 말.
 *
 * "표시할 수업이 없습니다" 하나로 끝내면 자료가 안 들어온 것과 학교가 쉬는 것을
 * 가릴 수 없다. 쉬는 날이면 투영이 골라 준 안내 문구를 그대로 적는다.
 *
 * 이 화면은 사건 자료를 직접 뒤지지 않는다. 무엇을 내보내도 되는지 정하는 자리는
 * `projectPublicClassSchedule` 한 곳이다.
 */
/** "8/21". 이번 주 칸에서만 쓴다. 오늘과 내일 칸은 절 제목이 이미 날짜를 말한다. */
function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

export function emptyReason(
  sectionId: string,
  closedDays: ReadonlyArray<{ date: string; note: string }>,
  today: string,
  tomorrow: string,
): string {
  const noteOn = (date: string): string | undefined =>
    closedDays.find((closed) => closed.date === date)?.note;
  if (sectionId === 'today' || sectionId === 'tomorrow') {
    const note = noteOn(sectionId === 'today' ? today : tomorrow);
    return note ? `수업이 없는 날입니다: ${note}` : '표시할 수업이 없습니다.';
  }
  const closed = closedDays
    .filter((day) => day.date > tomorrow && day.date <= dayOffset(today, 7))
    .map((day) => `${day.date} ${day.note}`);
  if (closed.length === 0) return '표시할 수업이 없습니다.';
  return `수업이 없는 날입니다: ${closed.join(', ')}`;
}

export function PublicClassTimetable({
  state,
  grade,
  className,
  course,
  today,
}: PublicClassTimetableProps) {
  /*
   * 학급을 찾을 때 과정까지 본다.
   *
   * 특수학교는 초등부와 중학부, 고등부를 함께 운영하고 학년이 과정마다 1부터 다시
   * 센다. 한 학교에 1학년 1반이 셋 있고 실측한 32곳 가운데 31곳이 그렇다.
   * 과정을 안 보면 먼저 걸린 하나만 열리고 나머지 둘은 주소로 갈 방법이 없다.
   *
   * 과정을 안 넘겨 준 옛 주소는 예전처럼 먼저 걸린 것을 연다.
   */
  const classKey = useMemo(() => {
    const lesson = state.lessons.find((item) =>
      item.revisionId === state.workspace.activeRevisionId
      && item.classIdentity.grade === grade
      && item.classIdentity.className === className
      && (!course || (item.classIdentity.schoolCourse ?? '') === course));
    return lesson ? classIdentityKey(lesson.classIdentity) : null;
  }, [state, grade, className, course]);
  const view = useMemo(
    () => classKey ? projectPublicClassSchedule(state, classKey) : null,
    [state, classKey],
  );

  if (!view) return (
    <main id="main-content" tabIndex={-1} className="public-class empty" aria-labelledby="public-class-title">
      <span className="eyebrow">{state.workspace.name}</span>
      <h2 id="public-class-title" tabIndex={-1}>{grade}학년 {className}반 시간표를 찾을 수 없습니다</h2>
      <p>이 학교의 활성 시간표에 해당 학급이 없습니다. 학급을 다시 확인하십시오.</p>
    </main>
  );

  const tomorrow = dayOffset(today, 1);
  const sections: Array<{ id: string; title: string; dates: (date: string) => boolean }> = [
    { id: 'today', title: '오늘', dates: (date) => date === today },
    { id: 'tomorrow', title: '내일', dates: (date) => date === tomorrow },
    { id: 'week', title: '이번 주', dates: (date) => date > tomorrow && date <= dayOffset(today, 7) },
  ];
  const changedCount = view.lessons.filter((lesson) => lesson.changed).length;


  return (
    <main id="main-content" tabIndex={-1} className="public-class" aria-labelledby="public-class-title" data-public-class={classKey}>
      <header className="public-class-heading">
        <span className="eyebrow">{view.schoolName}</span>
        <h2 id="public-class-title" tabIndex={-1}>{grade}학년 {className}반 시간표</h2>
        <p>
          {changedCount > 0
            ? `게시된 변경 ${changedCount}건이 반영되어 있습니다.`
            : '게시된 변경이 없습니다.'}
          {view.lastPublishedAt ? ` 마지막 게시 ${publishedTimeLabel(view.lastPublishedAt)}.` : ''}
        </p>
      </header>

      {sections.map((section) => {
        const lessons = view.lessons.filter((lesson) => section.dates(lesson.date));
        return (
          <section key={section.id} className="public-class-section" aria-labelledby={`public-class-${section.id}`}>
            <h3 id={`public-class-${section.id}`}>{section.title}</h3>
            {lessons.length === 0
              ? <p className="public-class-empty">{emptyReason(section.id, view.closedDays, today, tomorrow)}</p>
              : (
                /*
                 * 교사 화면과 같은 교시 레일을 쓴다. 이 화면은 교실 뒤에 붙거나 학생이
                 * 폰으로 여는 자리라 셋 가운데 가장 또렷해야 한다.
                 *
                 * 앞서는 교시가 과목명보다 작고 옅었고, 절 제목이 "오늘"인데 행마다 날짜를
                 * 또 적었다. 그 날짜가 좁은 화면에서 `2026-08-` 과 `18` 로 갈라졌다.
                 */
                <ol className="period-rail public-class-lessons">
                  {lessons.map((lesson) => (
                    <li key={lesson.lessonId} className="rail-row">
                      <span className="rail-period num" aria-hidden>{lesson.period}</span>
                      <div className={`public-class-lesson ${lesson.changed ? 'changed' : ''}`}>
                        <b>{lesson.subject}</b>
                        <span className="rail-where">
                          <span className="visually-hidden">{lesson.period}교시</span>
                          <i>{lesson.room}</i>
                          {section.id === 'week' && <i className="num">{shortDate(lesson.date)}</i>}
                        </span>
                        {lesson.changed && (
                          <span className="rail-from">
                            원래 {lesson.originalPeriod}교시 {lesson.originalSubject}
                            {lesson.publishedAt ? ` · ${publishedTimeLabel(lesson.publishedAt)} 게시` : ''}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
          </section>
        );
      })}
    </main>
  );
}
