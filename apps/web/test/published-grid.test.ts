import { describe, expect, it } from 'vitest';
import { loadDemoScenario } from '../lib/demo';
import { resolutionRowsForLesson, targetWeekInput } from '../lib/resolution';
import type { WorkspaceState } from '../lib/domain';

/**
 * 이미 게시된 변경이 엔진 격자에 얹혀 있는지.
 *
 * `activeLessons` 는 학교가 준 원래 시간표다. 지난주에 낸 변경이 게시되어 3교시
 * 수업이 4교시로 옮겨 갔어도 거기서는 그대로 3교시다. 그 격자로 다음 안을 찾으면
 * 이미 비어 있는 3교시는 차 있다고 보고, 이미 찬 4교시는 비었다고 본다.
 *
 * 뒤의 충돌 검사가 잘못된 안을 걸러 내기는 한다. 그러나 엔진은 그 전에 다섯 개를
 * 골라 순위를 매긴다. 틀린 격자로 고른 다섯이라 좋은 자리를 못 보고 지나간다.
 */
function placement(state: WorkspaceState, lessonId: string): { day: number; period: number } | null {
  const lesson = state.lessons.find((item) => item.id === lessonId);
  if (!lesson) return null;
  const { input, assignmentByLessonId } = targetWeekInput(state, lesson.date);
  const assignment = assignmentByLessonId.get(lessonId);
  if (!assignment) return null;
  return {
    day: Math.floor(assignment.slot / input.config.periods),
    period: (assignment.slot % input.config.periods) + 1,
  };
}

describe('게시된 변경을 엔진 격자에 얹는다', () => {
  it('게시된 자리로 본다', () => {
    const state = loadDemoScenario('published-correction');
    const publication = state.publications[0]!;
    const lessonId = publication.changedLessonIds[0]!;
    const absenceCase = state.cases.find((item) => item.id === publication.caseId)!;
    const change = absenceCase.resolutionItems
      .flatMap((item) => item.changes)
      .find((item) => item.lessonId === lessonId)!;
    const original = state.lessons.find((item) => item.id === lessonId)!;

    // 예시가 실제로 자리를 옮겨 놓았는지 먼저 본다. 안 옮겼으면 검사한 척만 하게 된다.
    expect(change.toPeriod).not.toBe(original.period);
    expect(placement(state, lessonId)?.period).toBe(Number(change.toPeriod));
  });

  it('게시가 없으면 원래 자리 그대로다', () => {
    const state = loadDemoScenario('full-day-absence');
    expect(state.publications).toEqual([]);
    const lesson = state.lessons[0]!;
    expect(placement(state, lesson.id)?.period).toBe(Number(lesson.period));
  });

  it('사건이 게시 상태가 아니면 얹지 않는다', () => {
    // 되돌려진 게시다. 사건이 다시 열렸으면 그 변경은 더 이상 사실이 아니다.
    const base = loadDemoScenario('published-correction');
    const publication = base.publications[0]!;
    const state: WorkspaceState = {
      ...base,
      cases: base.cases.map((item) =>
        item.id === publication.caseId ? { ...item, status: 'in_review' as const } : item),
    };
    const lessonId = publication.changedLessonIds[0]!;
    const original = base.lessons.find((item) => item.id === lessonId)!;
    expect(placement(state, lessonId)?.period).toBe(Number(original.period));
  });
});

/**
 * 게시된 변경으로 비게 된 교시를 "그날 없는 교시"로 읽지 않는지.
 *
 * 그날 어떤 교시가 있는가는 학교 편성의 성질이고, 우리가 낸 변경으로 달라지지 않는다.
 * 그런데 게시된 자리를 얹은 뒤의 격자로 교시 구조를 세고 있었다. 3교시 수업을 4교시로
 * 옮겨 게시한 예시에서 3교시가 통째로 비었고, 그것을 없는 교시로 막는 바람에 **그
 * 사건을 정정할 후보가 하나도 안 나왔다.** 브라우저 검사가 잡았다.
 */
describe('게시로 비게 된 교시', () => {
  it('없는 교시로 막지 않는다', () => {
    const state = loadDemoScenario('published-correction');
    const publication = state.publications[0]!;
    const lessonId = publication.changedLessonIds[0]!;
    const original = state.lessons.find((item) => item.id === lessonId)!;
    const { input } = targetWeekInput(state, original.date);

    const day = new Date(`${original.date}T00:00:00.000Z`).getUTCDay() - 1;
    const slot = day * input.config.periods + (Number(original.period) - 1);
    // 원래 자리가 klassBusy 로 막혀 있으면 그 자리로 되돌리는 정정을 못 낸다.
    for (const [, slots] of Object.entries(input.klassBusy ?? {})) {
      expect(slots).not.toContain(slot);
    }
    // 그날 마지막 교시도 원래 자리로 세므로 게시 전후가 같다.
    expect(input.config.periodsPerDay?.[day]).toBeGreaterThanOrEqual(Number(original.period));
  });

  it('정정 사건에 후보가 남는다', () => {
    const state = loadDemoScenario('published-correction');
    const target = state.cases.find((item) => item.status !== 'published');
    if (!target) return;
    const rows = target.lessonIds.flatMap((lessonId) =>
      resolutionRowsForLesson(state, target.id, lessonId));
    expect(rows.length).toBeGreaterThan(0);
  });
});
