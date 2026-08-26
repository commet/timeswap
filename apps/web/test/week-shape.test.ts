import { describe, expect, it } from 'vitest';
import { loadDemoScenario } from '../lib/demo';
import { resolutionRowsForLesson, targetWeekInput } from '../lib/resolution';
import type { Lesson, WorkspaceState } from '../lib/domain';

const DATES = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];

/**
 * 자료에 없는 날과 교시를 빈 자리로 세지 않는지.
 *
 * 화면에서 쓰는 길은 `targetWeekInput` 이 만든 시간표를 엔진에 넘긴다. 이 길은
 * 그 주에 며칠치 자료가 왔는지, 그 요일이 몇 교시까지인지를 엔진에 알려 주지
 * 않았다. 그래서 나이스가 한 주를 다 주지 않은 주에 도구는 자료가 없는 날로
 * 수업을 옮기라고 했고, 재어 보니 그 안이 맨 위에 왔다.
 *
 * 나이스 자료를 직접 읽는 길에는 같은 보호가 있었다. 화면에서 쓰는 길에만 없었다.
 * 같은 규칙을 두 곳에 따로 적어 둔 탓이라, 검사도 두 곳 모두에 건다.
 */
function build(options: {
  /** 요일별 마지막 교시. 0 이면 그날 자료가 통째로 없다. */
  lastOfDay: readonly number[];
  /** 결강난 학급 말고 다른 학급도 채울지. 안 채우면 맞교환 상대가 없어 빈 교시 이동만 남는다. */
  fillEveryClass?: boolean;
}): WorkspaceState {
  const { lastOfDay, fillEveryClass = true } = options;
  const state = loadDemoScenario('full-day-absence');
  const absent = state.lessons.filter((lesson) => state.cases[0]!.lessonIds.includes(lesson.id));
  const seed = absent[0]!;
  const identities = [...new Set(absent.map((lesson) => JSON.stringify(lesson.classIdentity)))];
  const fill = fillEveryClass ? identities : identities.slice(0, 1);
  // 결강난 분에게 그 주 다른 수업을 남기지 않는다. 남기면 그 수업이 맞교환 상대가 된다.
  const lessons: Lesson[] = [
    ...absent,
    ...state.lessons
      .filter((lesson) => !state.cases[0]!.lessonIds.includes(lesson.id))
      .map((lesson, index) => ({
        ...lesson,
        teacher: { state: 'assigned' as const, teacherId: `teacher:other-${index}` },
      })),
  ];
  for (let day = 0; day < 5; day += 1) {
    for (let period = 1; period <= lastOfDay[day]!; period += 1) {
      for (const [index, identity] of fill.entries()) {
        const taken = lessons.some(
          (lesson) =>
            lesson.date === DATES[day] &&
            lesson.period === String(period) &&
            JSON.stringify(lesson.classIdentity) === identity,
        );
        if (taken) continue;
        lessons.push({
          ...seed,
          id: `filler:${day}:${period}:${index}`,
          date: DATES[day]!,
          period: String(period),
          classIdentity: JSON.parse(identity) as Lesson['classIdentity'],
          subject: `채움${day}${period}`,
          teacher: { state: 'assigned', teacherId: `teacher:filler-${day}-${period}-${index}` },
        });
      }
    }
  }
  return { ...state, lessons };
}

/**
 * 2학년은 금요일에 5교시까지, 3학년은 7교시까지인 학교. 학년마다 두 학급씩 둔다.
 * 학급이 하나뿐인 학년에는 제한을 안 붙이는 규칙 때문에 둘씩 있어야 잰다.
 */
function twoGrades(): WorkspaceState {
  const state = loadDemoScenario('full-day-absence');
  const absent = state.lessons.filter((lesson) => state.cases[0]!.lessonIds.includes(lesson.id));
  const seed = absent[0]!;
  const lessons: Lesson[] = [...absent];
  const last = (grade: string, day: number): number => (grade === '2' && day === 4 ? 5 : 7);
  for (const grade of ['2', '3']) {
    for (const className of ['1', '2']) {
      for (let day = 0; day < 5; day += 1) {
        for (let period = 1; period <= last(grade, day); period += 1) {
          const identity = { ...seed.classIdentity, grade, className };
          if (lessons.some((lesson) =>
            lesson.date === DATES[day] && lesson.period === String(period)
            && lesson.classIdentity.grade === grade && lesson.classIdentity.className === className)) continue;
          lessons.push({
            ...seed,
            id: `two:${grade}:${className}:${day}:${period}`,
            date: DATES[day]!,
            period: String(period),
            classIdentity: identity,
            subject: `채움${day}${period}`,
            teacher: { state: 'assigned', teacherId: `teacher:two-${grade}-${className}-${day}-${period}` },
          });
        }
      }
    }
  }
  return { ...state, lessons };
}

/** 그 사건의 모든 결강에 대해 도구가 내놓은 이동 자리. */
function proposedSlots(state: WorkspaceState): Array<{ date: string; period: number }> {
  const absenceCase = state.cases[0]!;
  return absenceCase.lessonIds.flatMap((lessonId) =>
    resolutionRowsForLesson(state, absenceCase.id, lessonId).flatMap((row) =>
      (row.resolution.changes ?? []).map((change) => ({
        date: change.toDate ?? '',
        period: Number(change.toPeriod),
      })),
    ),
  );
}

describe('그 주에 실제로 있는 자리를 엔진에 알려 준다', () => {
  it('자료가 통째로 없는 요일은 0교시로 넘긴다', () => {
    const { input } = targetWeekInput(build({ lastOfDay: [7, 7, 7, 7, 0] }), '2026-08-18');
    expect(input.config.periodsPerDay).toEqual([7, 7, 7, 7, 0]);
  });

  it('요일마다 마지막 교시가 다르면 그대로 넘긴다', () => {
    const { input } = targetWeekInput(build({ lastOfDay: [7, 7, 6, 7, 4] }), '2026-08-18');
    expect(input.config.periodsPerDay).toEqual([7, 7, 6, 7, 4]);
  });

  it('닷새가 다 같으면 굳이 넘기지 않는다', () => {
    const { input } = targetWeekInput(build({ lastOfDay: [7, 7, 7, 7, 7] }), '2026-08-18');
    expect(input.config.periodsPerDay).toBeUndefined();
  });

  /*
   * 학급이 하나뿐인 학년에는 안 붙인다. 학급 하나만 보면 그저 비어 있는 칸과
   * 그 학년에 없는 교시를 가릴 수 없다. 엔진이 나이스 자료에 쓰는 규칙과 같다.
   */
  /*
   * 학년마다 하루 교시 수가 다르다. 학교 전체 값 하나로는 짧게 끝나는 학년의
   * 뒷 교시가 빈 시간으로 보인다. 그래서 학년으로 재고 그 학년 학급에 붙인다.
   */
  it('짧게 끝나는 학년에는 그 학년 값을 붙인다', () => {
    const state = twoGrades();
    const { input } = targetWeekInput(state, '2026-08-18');
    // 학교 전체로는 금요일도 7교시까지다. 3학년이 그때까지 하기 때문이다.
    expect(input.config.periodsPerDay).toBeUndefined();
    const gradeOfKey = (klass: string): string => klass.split('\u0001')[5] ?? '';
    const limits = Object.entries(input.klassPeriodsPerDay ?? {});
    const second = limits.filter(([klass]) => gradeOfKey(klass) === '2');
    // 예시 자료가 이미 갖고 있던 2학년 학급도 함께 붙는다.
    expect(second.length).toBeGreaterThanOrEqual(2);
    for (const [, perDay] of second) expect(perDay).toEqual([7, 7, 7, 7, 5]);
    // 3학년은 학교 전체 값과 같으므로 굳이 들고 다니지 않는다.
    expect(limits.some(([klass]) => gradeOfKey(klass) === '3')).toBe(false);
  });

  it('학급이 하나뿐인 학년에는 학급별 교시 제한을 안 붙인다', () => {
    const state = build({ lastOfDay: [7, 7, 7, 7, 4], fillEveryClass: false });
    const single = { ...state, lessons: state.lessons.filter((lesson) => lesson.classIdentity.className === '1') };
    const { input } = targetWeekInput(single, '2026-08-18');
    expect(input.klassPeriodsPerDay).toBeUndefined();
  });
});

describe('없는 자리로 옮기라고 하지 않는다', () => {
  it('자료가 통째로 없는 요일로 옮기라고 하지 않는다', () => {
    // 다른 학급을 안 채우면 맞교환 상대가 없어 빈 교시 이동만 남는다.
    // 그 자리가 자료 없는 금요일뿐이면 도구는 거기로 보내려 한다.
    const state = build({ lastOfDay: [7, 7, 7, 7, 0], fillEveryClass: false });
    expect(proposedSlots(state).filter((slot) => slot.date === '2026-08-21')).toEqual([]);
  });

  /*
   * 반대쪽도 재야 한다. 없는 자리를 막는 규칙이 멀쩡한 자리까지 막으면
   * 도구가 아무 안도 못 내고, 그것은 더 나쁜 고장이다.
   */
  it('그 요일에 있는 자리로는 여전히 옮긴다', () => {
    const proposed = proposedSlots(build({ lastOfDay: [7, 7, 7, 7, 4], fillEveryClass: false }));
    expect(proposed.length).toBeGreaterThan(0);
    for (const slot of proposed) {
      const day = DATES.indexOf(slot.date);
      expect(day).toBeGreaterThanOrEqual(0);
      expect(slot.period).toBeLessThanOrEqual([7, 7, 7, 7, 4][day]!);
    }
  });
});
