import { describe, expect, it } from 'vitest';
import { loadDemoScenario } from '../lib/demo';
import { targetWeekInput } from '../lib/resolution';
import type { AbsenceCase, WorkspaceState } from '../lib/domain';

/**
 * 결강으로 담긴 교시를 엔진이 "그 분이 못 맡는 자리"로 아는지.
 *
 * 부재를 낼 때 그 기간의 수업을 골라 담는다. 담긴 수업의 그 교시는 그분이 못
 * 맡는 자리다. 그런데 화면에서 쓰는 길은 이것을 엔진에 안 넘겼다. 그래서 결강난
 * 1교시 수업을 같은 분의 결강난 3교시 자리로 옮기라는 안이 나올 수 있었다.
 * 원래 있던 수업을 함께 옮기는 계획이면 자리가 비어 보여 충돌 검사에도 안 걸린다.
 *
 * 하루를 통째로 막지는 않는다. 회의처럼 두어 시간만 비우기도 해서, 자료가 확실히
 * 말해 주는 것은 담긴 수업의 그 교시뿐이다.
 */
const slotsFor = (state: WorkspaceState, teacherId: string): number[] =>
  targetWeekInput(state, '2026-08-18').input.unavailable?.[teacherId] ?? [];

const setStatus = (state: WorkspaceState, status: AbsenceCase['status']): WorkspaceState => ({
  ...state,
  cases: state.cases.map((item) => ({ ...item, status })),
});

describe('결강으로 담긴 교시를 근무 불가로 넘긴다', () => {
  it('담긴 수업의 교시를 넘긴다', () => {
    const state = loadDemoScenario('full-day-absence');
    const absenceCase = state.cases[0]!;
    const periods = targetWeekInput(state, '2026-08-18').input.config.periods;
    const expected = absenceCase.lessonIds
      .map((lessonId) => state.lessons.find((lesson) => lesson.id === lessonId)!)
      .map((lesson) => {
        const day = new Date(`${lesson.date}T00:00:00Z`).getUTCDay();
        return (day - 1) * periods + (Number(lesson.period) - 1);
      })
      .sort((left, right) => left - right);
    expect(slotsFor(state, absenceCase.requesterTeacherId)).toEqual(expected);
  });

  it('하루를 통째로 막지는 않는다', () => {
    // 회의처럼 두어 시간만 비우기도 한다. 자료는 담긴 교시까지만 말해 준다.
    const state = loadDemoScenario('full-day-absence');
    const slots = slotsFor(state, state.cases[0]!.requesterTeacherId);
    const periods = targetWeekInput(state, '2026-08-18').input.config.periods;
    expect(slots.length).toBeLessThan(periods);
  });

  it('없던 일이 된 부재는 자리를 막지 않는다', () => {
    for (const status of ['rejected', 'cancelled', 'superseded'] as const) {
      const state = setStatus(loadDemoScenario('full-day-absence'), status);
      expect(slotsFor(state, state.cases[0]!.requesterTeacherId)).toEqual([]);
    }
  });

  it('살아 있는 부재는 상태와 상관없이 막는다', () => {
    for (const status of ['draft', 'submitted', 'in_review', 'published'] as const) {
      const state = setStatus(loadDemoScenario('full-day-absence'), status);
      expect(slotsFor(state, state.cases[0]!.requesterTeacherId).length).toBeGreaterThan(0);
    }
  });

  it('결강난 자리로 그분의 다른 수업을 옮기라고 하지 않는다', () => {
    const state = loadDemoScenario('full-day-absence');
    const absenceCase = state.cases[0]!;
    const { input } = targetWeekInput(state, '2026-08-18');
    const blocked = new Set(input.unavailable?.[absenceCase.requesterTeacherId] ?? []);
    // 그분의 그 주 수업이 모두 막힌 자리 안에 있다. 서로 자리를 바꿔 봐야 소용이 없다.
    const mine = input.assignments.filter((item) => item.teacher === absenceCase.requesterTeacherId);
    expect(mine.length).toBeGreaterThan(0);
    for (const assignment of mine) expect(blocked.has(assignment.slot)).toBe(true);
  });
});
