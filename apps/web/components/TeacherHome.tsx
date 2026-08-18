'use client';

import type { Assignment, ScheduleConfig } from '@timeswap/engine';
import { dayOf, periodOf } from '@timeswap/engine';
import type { ChangeRequest } from '../lib/requests';
import { requestStatusLabel } from '../lib/requests';

export type ScheduleFocus = 'today' | 'week';

export function TeacherHome({
  schoolName,
  teacher,
  cfg,
  lessons,
  todayIdx,
  requests,
  focus,
  onFocus,
}: {
  schoolName: string;
  teacher: string;
  cfg: ScheduleConfig;
  lessons: Assignment[];
  todayIdx: number | null;
  requests: ChangeRequest[];
  focus: ScheduleFocus;
  onFocus: (focus: ScheduleFocus) => void;
}) {
  const day = todayIdx ?? 0;
  const today = lessons
    .filter((lesson) => dayOf(lesson.slot, cfg) === day)
    .sort((a, b) => a.slot - b.slot);
  const mine = requests.filter((request) => request.teacher === teacher);
  const pending = mine.filter((request) => request.status === 'pending').length;
  const latest = mine[0];
  const schoolDay = todayIdx !== null;

  return (
    <section className="teacher-overview" aria-labelledby="teacher-home-title">
      <div className="teacher-welcome">
        <p className="eyebrow">{schoolName}</p>
        <h1 id="teacher-home-title">{teacher} 선생님, {schoolDay ? '오늘' : '다음'} 수업부터 확인하세요</h1>
        <p>
          {cfg.dayNames[day]}요일 {today.length}교시
          {pending > 0 ? ' · 검토 중인 변경 ' + pending + '건' : ' · 기다리는 변경 없음'}
        </p>
      </div>
      <div className="home-actions">
        <div className="view-switch" role="tablist" aria-label="시간표 범위">
          <button
            role="tab"
            aria-selected={focus === 'today'}
            className={focus === 'today' ? 'on' : ''}
            onClick={() => onFocus('today')}
          >
            {schoolDay ? '오늘' : '다음 수업'}
          </button>
          <button
            role="tab"
            aria-selected={focus === 'week'}
            className={focus === 'week' ? 'on' : ''}
            onClick={() => onFocus('week')}
          >
            주간
          </button>
        </div>
        <button className="btn primary request-start" onClick={() => onFocus('week')}>
          변경 요청
        </button>
      </div>

      {focus === 'today' && (
        <div className="today-strip" aria-label={cfg.dayNames[day] + '요일 수업'}>
          {today.length === 0 ? (
            <p className="today-empty">오늘 예정된 수업이 없습니다.</p>
          ) : (
            today.map((lesson) => (
              <button
                key={[lesson.slot, lesson.klass, lesson.subject].join('-')}
                className="today-lesson"
                onClick={() => onFocus('week')}
                title="주간 시간표에서 변경할 수업 선택"
              >
                <span>{periodOf(lesson.slot, cfg) + 1}교시</span>
                <b>{lesson.subject}</b>
                <small>{lesson.klass}</small>
              </button>
            ))
          )}
        </div>
      )}

      {latest && (
        <div className={'latest-request status-' + latest.status}>
          <span>최근 요청</span>
          <b>{latest.date} · {latest.target.klass} {latest.target.subject}</b>
          <em>{requestStatusLabel(latest.status)}</em>
        </div>
      )}
    </section>
  );
}
