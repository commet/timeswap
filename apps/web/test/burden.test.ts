import { describe, expect, it } from 'vitest';
import { loadDemoScenario } from '../lib/demo';
import { targetWeekInput } from '../lib/resolution';
import type { AbsenceCase, WorkspaceState } from '../lib/domain';

/**
 * 최근에 누가 얼마나 자리를 내어 주었는지가 엔진까지 가는지.
 *
 * 엔진은 이 값으로 교체 점수와 보강 순위를 깎는다. 그런데 화면에서 쓰는 길은
 * 이 값을 한 번도 넘기지 않았다. 그래서 세 번 연달아 맡은 분과 한 번도 안 맡은
 * 분이 같은 자리에 올랐고, "최근에 이미 맡으셨습니다" 경고는 한 번도 뜨지 않았다.
 */
function withCase<T extends WorkspaceState>(
  state: T,
  options: {
    status: AbsenceCase['status'];
    kind: 'cover' | 'swap2';
    helper: string;
    fromDate: string;
    requester?: string;
  },
): T {
  const seed = state.cases[0]!;
  const helperCase: AbsenceCase = {
    ...seed,
    id: `extra:${options.helper}:${options.fromDate}:${options.status}:${options.kind}`,
    requesterTeacherId: options.requester ?? 'teacher:requester',
    fromDate: options.fromDate,
    toDate: options.fromDate,
    status: options.status,
    resolutionItems: [{
      id: `extra-item:${options.helper}:${options.fromDate}:${options.status}:${options.kind}`,
      lessonId: seed.lessonIds[0]!,
      kind: options.kind,
      computedAgainstRevisionId: state.workspace.activeRevisionId,
      changes: [{
        lessonId: seed.lessonIds[0]!,
        toDate: options.fromDate,
        toPeriod: '1',
        teacher: { state: 'assigned', teacherId: options.helper },
      }],
    }],
  };
  return { ...state, cases: [...state.cases, helperCase] };
}

const burdenOf = (state: WorkspaceState): Record<string, number> =>
  targetWeekInput(state, '2026-08-18').input.recentBurden ?? {};

describe('부담 균형이 엔진까지 간다', () => {
  it('승인된 맞교환에서 자리를 내어 준 분을 센다', () => {
    const state = withCase(loadDemoScenario('full-day-absence'), {
      status: 'resolution_approved', kind: 'swap2', helper: 'teacher:helper', fromDate: '2026-08-18',
    });
    expect(burdenOf(state)['teacher:helper']).toBe(1);
  });

  it('보강은 두 번으로 센다', () => {
    // 보강은 한 시간을 그냥 더 맡는 일이라 교체보다 무거운 부탁이다.
    const state = withCase(loadDemoScenario('full-day-absence'), {
      status: 'published', kind: 'cover', helper: 'teacher:helper', fromDate: '2026-08-18',
    });
    expect(burdenOf(state)['teacher:helper']).toBe(2);
  });

  it('여러 번 맡으면 쌓인다', () => {
    let state = loadDemoScenario('full-day-absence');
    for (const date of ['2026-08-04', '2026-08-11', '2026-08-18']) {
      state = withCase(state, { status: 'published', kind: 'swap2', helper: 'teacher:helper', fromDate: date });
    }
    expect(burdenOf(state)['teacher:helper']).toBe(3);
  });

  it('승인 전 사건은 세지 않는다', () => {
    // 반려되거나 취소될 수 있고, 아직 아무도 실제로 자리를 내어 주지 않았다.
    for (const status of ['draft', 'submitted', 'in_review', 'rejected', 'cancelled'] as const) {
      const state = withCase(loadDemoScenario('full-day-absence'), {
        status, kind: 'swap2', helper: 'teacher:helper', fromDate: '2026-08-18',
      });
      expect(burdenOf(state)['teacher:helper']).toBeUndefined();
    }
  });

  it('네 주보다 오래된 것은 세지 않는다', () => {
    const old = withCase(loadDemoScenario('full-day-absence'), {
      status: 'published', kind: 'swap2', helper: 'teacher:helper', fromDate: '2026-07-14',
    });
    expect(burdenOf(old)['teacher:helper']).toBeUndefined();
    const recent = withCase(loadDemoScenario('full-day-absence'), {
      status: 'published', kind: 'swap2', helper: 'teacher:helper', fromDate: '2026-07-28',
    });
    expect(burdenOf(recent)['teacher:helper']).toBe(1);
  });

  it('결강 당사자는 세지 않는다', () => {
    // 자기 수업을 옮긴 것이지 남을 도운 것이 아니다.
    const state = withCase(loadDemoScenario('full-day-absence'), {
      status: 'published', kind: 'swap2', helper: 'teacher:self', requester: 'teacher:self',
      fromDate: '2026-08-18',
    });
    expect(burdenOf(state)['teacher:self']).toBeUndefined();
  });
});
