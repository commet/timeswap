import { describe, expect, it } from 'vitest';
import { loadDemoScenario } from '../lib/demo';
import { resolutionRowsForLesson } from '../lib/resolution';
import type { WorkspaceState } from '../lib/domain';

/**
 * 그 학급만 쉬는 날에 그 학급 보강 후보를 내지 않는지.
 *
 * 엔진의 `coverCandidates` 는 학급을 받아 그 학급만 쉬는 날인지 본다. 그런데
 * 화면에서 쓰는 길이 학급을 안 넘겼다. 그래서 학교 전체 휴업일만 보았고,
 * 1학년이 수학여행으로 빠진 날에도 1학년 보강 후보가 나왔다.
 *
 * 교체 쪽은 이미 학급 단위 휴업을 보고 있었다. 보강 쪽만 안 보고 있어서 두 경로가
 * 서로 다른 말을 했다. 엔진에는 고침이 들어가 있었는데 화면이 그 값을 안 넘겼다.
 */
function withClassClosure(state: WorkspaceState, date: string): WorkspaceState {
  const absenceCase = state.cases[0]!;
  const lesson = state.lessons.find((item) => item.id === absenceCase.lessonIds[0]!)!;
  return {
    ...state,
    revisions: state.revisions.map((revision) =>
      revision.id === state.workspace.activeRevisionId
        ? {
            ...revision,
            closures: [
              ...(revision.closures ?? []),
              { date, reason: '수학여행', classIdentities: [lesson.classIdentity] },
            ],
          }
        : revision),
  };
}

describe('그 학급만 쉬는 날', () => {
  it('그 학급 보강 후보를 내지 않는다', () => {
    const base = loadDemoScenario('full-day-absence');
    const absenceCase = base.cases[0]!;
    const lessonId = absenceCase.lessonIds[0]!;
    const lesson = base.lessons.find((item) => item.id === lessonId)!;

    // 휴업을 걸기 전에는 보강 후보가 나온다. 안 나오면 검사한 척만 하게 된다.
    const before = resolutionRowsForLesson(base, absenceCase.id, lessonId);
    expect(before.filter((row) => row.method === '보강').length).toBeGreaterThan(0);

    const closed = withClassClosure(base, lesson.date);
    const after = resolutionRowsForLesson(closed, absenceCase.id, lessonId);
    expect(after.filter((row) => row.method === '보강')).toEqual([]);
  });
});
