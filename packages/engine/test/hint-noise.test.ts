import { describe, expect, it } from 'vitest';
import { genSchool } from '../src/synthetic';
import { groupCandidate } from '../src/adapters/neis';

describe('이동수업 알림이 시끄럽지 않은지', () => {
  it('묶음이 없는 보통 학교에서는 거의 뜨지 않는다', () => {
    const school = genSchool({ classes: 24, seed: 7 });
    let fired = 0;
    for (const a of school.assignments) {
      if (groupCandidate(school, a.slot, a.subject, a.klass).length > 0) fired++;
    }
    const rate = fired / school.assignments.length;
    console.log(`수업 ${school.assignments.length}개 중 ${fired}개에서 알림 (${(rate * 100).toFixed(1)}%)`);
    // 열 개 중 하나꼴을 넘으면 알림이 곧 무시당한다
    expect(rate).toBeLessThan(0.1);
  });
});
