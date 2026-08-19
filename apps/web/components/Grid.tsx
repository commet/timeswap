"use client";

import {
  slotName,
  slotOf,
  type Assignment,
  type Candidate,
  type DayClosure,
  type ScheduleConfig,
} from "@timeswap/engine";
import { subjectHue } from "../lib/app";
import type { TeacherScheduleLessonView } from '../lib/projections';
import type { CSSProperties } from "react";

interface Props {
  cfg: ScheduleConfig;
  mode: "teacher" | "klass";
  /** 교사 뷰에서는 교사 이름, 학급 뷰에서는 학급 이름 */
  owner: string;
  lessons: Assignment[];
  /** 결강 대기열. 첫 항목이 지금 처리 중인 결강이다. */
  absentSlots: number[];
  /** 현재 교사의 근무 불가 슬롯. 빈 교시를 눌러 잠근다. */
  lockedSlots: number[];
  /** 오늘 요일 열 강조 (0 = 월). 주말이면 null */
  todayIdx: number | null;
  /** 이번 주 휴업일. 그 요일은 교체 대상에서 빠진다 */
  closures: DayClosure[];
  preview: Candidate | null;
  onToggleSlot: (slot: number) => void;
  onToggleDay: (day: number) => void;
  onToggleLock: (slot: number) => void;
  /** 손으로 지정한 수업 없는 요일 */
  offDays: number[];
  onToggleOffDay: (day: number) => void;
  /** 이 교사가 학교에 오지 않는 요일. 시간강사와 육아시간처럼 근무일이 갈릴 때 쓴다 */
  myOffDays: number[];
  onToggleMyOffDay: (day: number) => void;
  /** 학급 뷰에서, 수업은 있는데 담당 교사를 아직 안 채운 교시 */
  busySlots?: number[];
}

export function Grid({
  cfg,
  mode,
  owner,
  lessons,
  absentSlots,
  lockedSlots,
  todayIdx,
  closures,
  preview,
  onToggleSlot,
  onToggleDay,
  onToggleLock,
  offDays,
  onToggleOffDay,
  myOffDays,
  onToggleMyOffDay,
  busySlots = [],
}: Props) {
  // 학급별로 갈리는 휴업일도 있지만 머리글은 한 줄이라 학교 전체 휴업일만 표시한다.
  const closedDay = new Map<number, string>();
  for (const c of closures) {
    if (c.klasses === undefined || c.klasses.length === 0)
      closedDay.set(c.day, c.reason);
  }
  const bySlot = new Map<number, Assignment>();
  for (const a of lessons) bySlot.set(a.slot, a);
  const busy = new Set(busySlots);

  const teacherMode = mode === "teacher";
  const active = teacherMode ? (absentSlots[0] ?? null) : null;
  const queued = teacherMode ? new Set(absentSlots) : new Set<number>();
  const locked = teacherMode ? new Set(lockedSlots) : new Set<number>();
  const own = teacherMode
    ? preview?.changes.find((c) => c.from.teacher === owner)
    : undefined;
  const incoming = teacherMode
    ? preview?.changes.find(
        (c) => c.from.teacher !== owner && c.toSlot === active,
      )
    : undefined;

  /*
   * 한 칸의 최소 폭을 CSS 에 맡긴다.
   *
   * 92px 을 여기 박아 두면 폰에서 5일이 368px 에 안 들어가 격자를 옆으로 끌어야 했다.
   * 추천안의 절반 넘게가 다른 요일로 넘어가므로(실측 41~49%가 같은 날, 1순위도 65~80%),
   * 다른 요일이 안 보이면 그 안들을 볼 방법이 없어진다. 주 전체가 한눈에 들어와야 한다.
   * 좁은 화면에서는 --col-min 을 0 으로 두어 남은 폭을 요일끼리 나눈다.
   */
  const cols = `40px repeat(${cfg.days}, minmax(var(--col-min, 92px), 1fr))`;

  return (
    <section className="card grid-wrap" aria-label="주간 시간표">
      <div className="card-head">
        <h2>
          {teacherMode ? `${owner} 선생님의 한 주` : `${owner} 반의 한 주`}
        </h2>
        <span className="sub">
          {!teacherMode
            ? "변경이 반영된 학급 시간표"
            : active === null
              ? "바꿀 수업을 선택하십시오. 요일 이름을 누르면 그날 전체가 선택됩니다"
              : `${slotName(active, cfg)} 수업의 교체 방법`}
        </span>
      </div>
      <div className="grid-scroll">
        {/* 좁은 화면에서 칸에 무엇을 적을지가 보기에 따라 갈린다. CSS 가 알아야 한다 */}
        <div
          className={`tt-grid ${teacherMode ? 'by-teacher' : 'by-klass'}`}
          style={{ gridTemplateColumns: cols }}
        >
          <div className="tt-head corner" aria-hidden />
          {cfg.dayNames.map((d, di) => {
            const why = closedDay.get(di);
            const mark =
              why !== undefined ? (
                <span className="day-closed">{why}</span>
              ) : null;
            return teacherMode ? (
              <button
                key={d}
                className={`tt-head day-btn${todayIdx === di ? " today" : ""}${why !== undefined ? " closed" : ""}`}
                title={
                  // 사유가 휴업일일 수도, 자료를 못 받은 요일일 수도 있다.
                  // 어느 쪽이든 문장이 되도록 사유를 그대로 두고 뒤를 붙인다.
                  why !== undefined
                    ? `${why}. 이 요일로는 옮기지 않습니다`
                    : "그날 수업 전체 선택"
                }
                onClick={() => onToggleDay(di)}
              >
                {d}
                {mark}
              </button>
            ) : (
              <div
                key={d}
                className={`tt-head${todayIdx === di ? " today" : ""}${why !== undefined ? " closed" : ""}`}
              >
                {d}
                {mark}
              </div>
            );
          })}
          {Array.from({ length: cfg.periods }, (_, p) => (
            <Row
              key={p}
              p={p}
              cfg={cfg}
              teacherMode={teacherMode}
              bySlot={bySlot}
              active={active}
              queued={queued}
              locked={locked}
              todayIdx={todayIdx}
              closedDay={closedDay}
              own={own}
              busySlots={busy}
              incoming={incoming}
              onToggleSlot={onToggleSlot}
              onToggleLock={onToggleLock}
            />
          ))}
        </div>
      </div>
      {teacherMode && (
        <div className="offdays">
          <span className="offdays-label">수업 없는 날</span>
          {cfg.dayNames.map((d, di) => (
            <button
              key={d}
              className={`offday${offDays.includes(di) ? " on" : ""}`}
              aria-pressed={offDays.includes(di)}
              title="정기고사나 학교 행사처럼 그날 수업이 없으면 눌러 두십시오"
              onClick={() => onToggleOffDay(di)}
            >
              {d}
            </button>
          ))}
          <span className="offdays-hint">
            정기고사나 학교 행사처럼 학교 전체가 쉬는 날입니다
          </span>
        </div>
      )}
      {teacherMode && (
        <div className="offdays">
          <span className="offdays-label">못 오는 날</span>
          {cfg.dayNames.map((d, di) => (
            <button
              key={d}
              className={`offday mine${myOffDays.includes(di) ? " on" : ""}`}
              aria-pressed={myOffDays.includes(di)}
              title="이 요일에는 새 수업을 받지 않습니다. 이미 있는 수업은 그대로 둡니다"
              onClick={() => onToggleMyOffDay(di)}
            >
              {d}
            </button>
          ))}
          <span className="offdays-hint">
            {owner} 선생님께 새 수업을 넣지 않습니다
          </span>
        </div>
      )}
      {teacherMode && (
        <div className="grid-legend">
          <span>
            <i style={{ background: "var(--warn)" }} /> 선택한 수업
          </span>
          <span>
            <i style={{ background: "var(--accent)" }} /> 이동할 자리
          </span>
          <span>
            <i
              style={{
                background: "var(--accent-soft)",
                outline: "1.5px dashed var(--accent)",
              }}
            />{" "}
            들어오는 수업
          </span>
          <span>
            <i
              style={{
                background: "var(--surface-2)",
                outline: "1.5px dashed var(--muted)",
              }}
            />{" "}
            수업 불가 시간
          </span>
        </div>
      )}
    </section>
  );
}

function Row({
  p,
  cfg,
  teacherMode,
  bySlot,
  active,
  queued,
  locked,
  todayIdx,
  closedDay,
  own,
  incoming,
  busySlots,
  onToggleSlot,
  onToggleLock,
}: {
  p: number;
  cfg: ScheduleConfig;
  teacherMode: boolean;
  bySlot: Map<number, Assignment>;
  active: number | null;
  queued: Set<number>;
  locked: Set<number>;
  todayIdx: number | null;
  closedDay: Map<number, string>;
  own?: { from: Assignment; toSlot: number };
  incoming?: { from: Assignment; toSlot: number };
  busySlots: Set<number>;
  onToggleSlot: (slot: number) => void;
  onToggleLock: (slot: number) => void;
}) {
  return (
    <>
      <div className="tt-period">{p + 1}</div>
      {Array.from({ length: cfg.days }, (_, d) => {
        const s = slotOf(d, p, cfg);
        const a = bySlot.get(s);
        const isActive = active === s;
        const isQueued = queued.has(s) && !isActive;
        const today = `${todayIdx === d ? " today-col" : ""}${closedDay.has(d) ? " closed-col" : ""}`;
        const leaving =
          own !== undefined && own.from.slot === s && own.toSlot !== s;
        const arriving = own !== undefined && own.toSlot === s;
        const showIncoming = isActive && incoming !== undefined;

        if (!a && arriving && own) {
          return (
            <div
              key={s}
              className={`cell lesson arriving${today}`}
              aria-label={`${slotName(s, cfg)}로 옮기기`}
            >
              <span className="k">{own.from.klass}</span>
              <span className="s">{own.from.subject} 이동</span>
            </div>
          );
        }
        if (!a) {
          if (!teacherMode) {
            // 담당을 아직 안 채운 자리. 빈 칸으로 두면 왜 그리로 못 옮기는지 알 길이 없다.
            // 수업은 있고 담당만 모른다는 사실을 그 자리에 적는다.
            if (busySlots.has(s)) {
              return (
                <div
                  key={s}
                  className={`cell unknown${today}`}
                  title="수업이 있지만 담당 교사를 아직 안 채운 자리입니다"
                  aria-label={`${slotName(s, cfg)} 담당 미상`}
                >
                  <span className="s">담당 미상</span>
                </div>
              );
            }
            return (
              <div
                key={s}
                className={`cell empty${today}`}
                aria-label={`${slotName(s, cfg)} 공강`}
              />
            );
          }
          const isLocked = locked.has(s);
          return (
            <button
              key={s}
              className={`cell empty${isLocked ? " locked" : ""}${today}`}
              title={
                isLocked
                  ? "수업 불가 시간입니다. 다시 누르면 해제됩니다"
                  : "회의나 출장 등으로 수업이 불가능한 시간으로 지정합니다"
              }
              aria-label={`${slotName(s, cfg)} ${isLocked ? "근무 불가" : "공강"}`}
              aria-pressed={isLocked}
              onClick={() => onToggleLock(s)}
            >
              {isLocked && <span className="lock-mark">불가</span>}
            </button>
          );
        }
        if (showIncoming && incoming) {
          return (
            <div
              key={s}
              className={`cell incoming${today}`}
              aria-label="이 시간에 들어올 수업"
            >
              <span className="k">{incoming.from.teacher}</span>
              <span className="s">{incoming.from.subject}</span>
            </div>
          );
        }
        const cls = ["cell", "lesson"];
        if (isActive) cls.push("absent");
        if (isQueued) cls.push("absent", "queued");
        if (leaving) cls.push("leaving");
        const style = { "--hue": subjectHue(a.subject) } as CSSProperties;
        if (!teacherMode) {
          return (
            <div
              key={s}
              className={`${cls.join(" ")}${today}`}
              style={style}
              aria-label={`${slotName(s, cfg)} ${a.subject} ${a.teacher}`}
            >
              <span className="k">{a.subject}</span>
              <span className="s">
                {a.teacher}
                {a.group && <span className="gmark">이동</span>}
              </span>
            </div>
          );
        }
        return (
          <button
            key={s}
            className={`${cls.join(" ")}${today}`}
            style={style}
            title={
              a.group
                ? "이동수업입니다. 묶음 전체가 함께 움직입니다"
                : undefined
            }
            aria-label={`${slotName(s, cfg)} ${a.klass} ${a.subject}`}
            aria-pressed={isActive || isQueued}
            onClick={() => onToggleSlot(s)}
          >
            {isActive && <span className="badge-absent">선택</span>}
            {isQueued && <span className="badge-absent queued">대기</span>}
            <span className="k">{a.klass}</span>
            <span className="s">
              {a.subject}
              {a.group && <span className="gmark">이동</span>}
            </span>
          </button>
        );
      })}
    </>
  );
}

function koreanDay(date: string): string {
  return new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00.000Z`));
}

function teacherScheduleValue(lesson: TeacherScheduleLessonView) {
  return lesson.pending ?? lesson.published ?? lesson.base;
}

/** Keeps concurrent projected lessons in their shared timetable cell. */
export function teacherWeekSlots(lessons: TeacherScheduleLessonView[]): Map<string, TeacherScheduleLessonView[]> {
  const bySlot = new Map<string, TeacherScheduleLessonView[]>();
  for (const lesson of lessons) {
    const value = teacherScheduleValue(lesson);
    const key = `${value.date}\u0000${value.period}`;
    const current = bySlot.get(key) ?? [];
    current.push(lesson);
    bySlot.set(key, current);
  }
  for (const slotLessons of bySlot.values()) {
    slotLessons.sort((left, right) => left.lessonId.localeCompare(right.lessonId));
  }
  return bySlot;
}

/** Canonical teacher projection grid.  The legacy interaction grid above stays for ops until Task 10. */
export function TeacherScheduleGrid({
  lessons,
  onSelectLesson,
}: {
  lessons: TeacherScheduleLessonView[];
  onSelectLesson(lessonId: string): void;
}) {
  const dates = [...new Set(lessons.map((lesson) => {
    const value = teacherScheduleValue(lesson);
    return value.date;
  }))].sort();
  const periods = [...new Set(lessons.map((lesson) => {
    const value = teacherScheduleValue(lesson);
    return value.period;
  }))].sort((left, right) => Number(left) - Number(right));
  const bySlot = teacherWeekSlots(lessons);

  return (
    <section className="teacher-projection-grid" data-teacher-week aria-labelledby="teacher-week-title">
      <header>
        <div>
          <span className="eyebrow">주간 시간표</span>
          <h2 id="teacher-week-title">이번 주 수업</h2>
        </div>
        <p>수업을 누르면 해당 날짜와 교시로 변경 요청을 시작합니다.</p>
      </header>
      {!dates.length ? <p className="teacher-grid-empty">표시할 수업이 없습니다.</p> : (
        <div className="teacher-grid-scroll">
          <div className="teacher-grid" style={{ gridTemplateColumns: `54px repeat(${dates.length}, minmax(128px, 1fr))` }}>
            <span className="teacher-grid-corner" aria-hidden />
            {dates.map((date) => <span className="teacher-grid-day" key={date}>{koreanDay(date)}<small>{date.slice(5)}</small></span>)}
            {periods.map((period) => (
              <div className="teacher-grid-row" key={period}>
                <span className="teacher-grid-period">{period}교시</span>
                {dates.map((date) => {
                  const slotLessons = bySlot.get(`${date}\u0000${period}`);
                  if (!slotLessons) return <span className="teacher-grid-empty-cell" key={date} aria-label={`${date} ${period}교시 공강`} />;
                  return (
                    <div className="teacher-grid-slot" key={date}>
                      {slotLessons.map((lesson) => {
                        const value = teacherScheduleValue(lesson);
                        const changed = lesson.status !== 'base';
                        return (
                          <button
                            key={lesson.lessonId}
                            className={`teacher-grid-lesson${changed ? ` ${lesson.status === 'published' ? 'published' : 'planned'}` : ''}`}
                            onClick={() => onSelectLesson(lesson.lessonId)}
                            aria-label={`${date} ${period}교시 ${value.subject} 변경 요청`}
                          >
                            {lesson.status === '변경 예정' && <em>변경 예정</em>}
                            {lesson.status === 'published' && <em>게시됨</em>}
                            <b>{value.subject}</b>
                            {lesson.status !== 'base' && <small>원래 {lesson.base.subject} · {lesson.base.classIdentity.grade}-{lesson.base.classIdentity.className} · {lesson.base.period}교시 · {lesson.base.room}</small>}
                            <span>{value.classIdentity.grade}-{value.classIdentity.className} · {value.period}교시 · {value.room}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
