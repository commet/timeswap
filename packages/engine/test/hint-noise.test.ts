import { describe, expect, it } from 'vitest';
import { genSchool } from '../src/synthetic';
import { groupCandidate } from '../src/adapters/neis';

/**
 * 이동수업 알림이 얼마나 자주 뜨는지.
 *
 * **여기 적힌 값은 합성 학교의 값이다. 실제 학교와 열 배 다르다.**
 *
 * 처음에는 합성 학교 하나(학급 24개)에서 수업 768개 가운데 8개, 약 1%가 나왔고
 * 그것을 근거로 "백 개에 하나꼴"이라 적었다. 인증키를 받아 실제 학교 371곳으로
 * 재니 이렇게 나왔다.
 *
 * | 학교급 | 수업 | 알림 | 비율 | 학교별 최대 |
 * |---|---|---|---|---|
 * | 초등학교 (57곳) | 22,298 | 961 | 4.3% | 30% |
 * | 중학교 (65곳) | 32,637 | 2,319 | 7.1% | 64% |
 * | 고등학교 (217곳) | 138,862 | 14,784 | **10.6%** | 32% |
 * | 특수학교 (32곳) | 24,575 | 2,513 | **10.2%** | 26% |
 *
 * 이 저장소가 스스로 정한 실패선 10%를 371곳 가운데 122곳(33%)이 넘는다.
 * 합성 학교는 학급마다 과목을 흩뿌려 놓아 같은 교시에 같은 과목이 겹치는 일이 드물다.
 * 실제 학교는 한 학년이 같은 시간에 같은 과목을 함께 듣는 편성이 흔하다.
 *
 * **그래서 이 시험은 회귀만 잡는다.** 소음이 얼마인지를 말해 주지는 못한다.
 * 실제 값을 알고 싶으면 `invariants.test.ts` 처럼 학교 자료를 넣어 재야 한다.
 * 05장 10.4절에 실측이 있다.
 */
describe('이동수업 알림이 시끄럽지 않은지', () => {
  it('합성 학교에서는 거의 뜨지 않는다', () => {
    const school = genSchool({ classes: 24, seed: 7 });
    let fired = 0;
    for (const a of school.assignments) {
      if (groupCandidate(school, a.slot, a.subject, a.klass).length > 0) fired++;
    }
    const rate = fired / school.assignments.length;
    // 합성 학교의 값이다. 이 숫자를 실제 학교의 소음으로 읽으면 안 된다.
    expect(rate).toBeLessThan(0.1);
  });

  it('합성 학교의 값을 실제 학교의 값으로 읽지 않도록 남겨 둔다', () => {
    // 실측값이 문서와 코드 주석에 함께 적혀 있어야 다음 사람이 속지 않는다.
    const school = genSchool({ classes: 24, seed: 7 });
    let fired = 0;
    for (const a of school.assignments) {
      if (groupCandidate(school, a.slot, a.subject, a.klass).length > 0) fired++;
    }
    // 합성은 2% 아래인데 실제 고등학교는 10.6% 였다. 이 간격 자체를 잠근다.
    expect(fired / school.assignments.length).toBeLessThan(0.02);
  });
});
