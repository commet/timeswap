import { describe, expect, it } from 'vitest';
import { loadDemoScenario } from '../lib/demo';
import { targetWeekInput } from '../lib/resolution';
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
