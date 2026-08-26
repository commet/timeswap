import { describe, expect, it } from 'vitest';
import type { ClassIdentity } from '@timeswap/engine';
import { crossingForResolution } from '../lib/resolution';
import type { Lesson, ResolutionItem, WorkspaceState } from '../lib/domain';

/**
 * 교차 확인이 무엇을 말하는지.
 *
 * 이 도구가 하는 일은 교사와 학급이 동시에 비는 칸을 찾는 것이다. 화면은 그 사실을 두 줄로
 * 그린다. 그리려면 그날 그 교사의 자리와 그 학급의 자리를 정확히 알아야 한다.
 *
 * 옮기는 수업 자신은 빼고 센다. 그 수업은 이 안이 비우고 갈 자리라, 차 있다고 세면 자기
 * 자리 때문에 자기가 못 가는 것으로 보인다.
 */
const identity = (className: string): ClassIdentity => ({
  schoolCode: '7010536', academicYear: '2026', dayCourse: '주간',
  affiliation: '일반계', major: '공통', grade: '1', className,
});

const lesson = (id: string, className: string, period: string, teacherId: string): Lesson => ({
  id, workspaceId: 'school', revisionId: 'rev',
  date: '2026-08-18', period, classIdentity: identity(className),
  subject: `과목${period}`, room: `${className}실`,
  teacher: { state: 'assigned', teacherId },
});

function school(): WorkspaceState {
  return {
    schemaVersion: 2,
    workspace: {
      id: 'school', name: '교차중학교', activeRevisionId: 'rev',
      createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
    },
    revisions: [{
      id: 'rev', workspaceId: 'school', source: 'neis',
      loadedAt: '2026-08-18T00:00:00.000Z', complete: true, checksum: 'sha256:x',
    }],
    lessons: [
      lesson('a1', '1', '1', '김하나'),
      lesson('a2', '1', '2', '이두리'),
      lesson('a4', '1', '4', '김하나'),
      lesson('b3', '2', '3', '김하나'),
    ],
    cases: [], adminTasks: [], publications: [], audit: [],
    teacherLabels: { 김하나: '김하나', 이두리: '이두리' },
  };
}

/** 1학년 1반 1교시(김하나)를 3교시로 옮긴다. */
const move: ResolutionItem = {
  id: 'r1', lessonId: 'a1', kind: 'move', computedAgainstRevisionId: 'rev',
  changes: [{
    lessonId: 'a1', toDate: '2026-08-18', toPeriod: '3',
    teacher: { state: 'assigned', teacherId: '김하나' },
  }],
};

describe('교차 확인', () => {
  const [view] = crossingForResolution(school(), move);

  it('가려는 교시와 그날 교시 수를 짚는다', () => {
    expect(view).toMatchObject({ target: 3, periods: 4, date: '2026-08-18' });
  });

  it('교사 줄과 학급 줄을 함께 낸다', () => {
    expect(view!.tracks.map((track) => track.kind)).toEqual(['teacher', 'klass']);
    expect(view!.tracks[1]!.label).toBe('1-1');
  });

  /*
   * 김하나 선생님은 1, 4교시(1학년 1반)와 3교시(1학년 2반)에 수업이 있다. 그중 1교시는
   * 이 안이 비우고 가는 자리라 빼야 한다. 3교시는 남으므로 이 이동은 교사 중복이다.
   */
  it('옮기는 수업 자신은 차 있다고 안 센다', () => {
    expect(view!.tracks[0]!.busy).toEqual([3, 4]);
  });

  it('학급 줄은 그 학급의 자리만 센다', () => {
    // 1학년 1반은 1, 2, 4교시. 1교시는 옮기는 수업이라 빠진다.
    expect(view!.tracks[1]!.busy).toEqual([2, 4]);
  });
});
