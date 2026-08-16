import { describe, expect, it } from 'vitest';
import { genSchool } from '../src/synthetic';
import { recommend } from '../src/search';
import { applyChanges, totalHoles, validate } from '../src/timetable';

/**
 * 실제 학교 규모에서 생성기와 탐색이 함께 버티는지 본다.
 * 학급 41개는 대도시 일반계 고등학교의 큰 축에 해당하는 규모다.
 * 자료는 전부 우리가 만든 것이고 외부에서 가져온 것이 없다.
 */
describe('실제 규모: 학급 41개 학교', () => {
  const input = genSchool({ classes: 41, seed: 7 });

  it('구성적 생성기가 규모에 상관없이 완전한 시간표를 만든다', () => {
    const teachers = new Set(input.assignments.map((a) => a.teacher));
    const klasses = new Set(input.assignments.map((a) => a.klass));
    expect(klasses.size).toBe(41);
    expect(teachers.size).toBeGreaterThan(50);
    // 학급마다 주 32시간이 빠짐없이 채워져야 한다
    expect(input.assignments).toHaveLength(41 * 32);
    console.log(
      `생성 규모: 수업 ${input.assignments.length}개, 교사 ${teachers.size}명, ` +
        `학급 ${klasses.size}개, 중간 공강 ${totalHoles(input)}개`,
    );
  });

  it('생성 결과가 하드 불변식을 지킨다', () => {
    expect(validate(input)).toEqual([]);
  });

  it('학급별 하루 수업이 앞 교시부터 빈틈 없이 이어진다', () => {
    expect(totalHoles(input)).toBe(0);
  });

  it('시드가 같으면 같은 학교가 나온다', () => {
    const again = genSchool({ classes: 41, seed: 7 });
    expect(again.assignments).toEqual(input.assignments);
  });

  it('학급 60개까지 늘려도 교착 없이 끝난다', () => {
    const big = genSchool({ classes: 60, seed: 3 });
    expect(validate(big)).toEqual([]);
    expect(big.assignments).toHaveLength(60 * 32);
  });

  it('결강 10건의 전수 탐색이 각각 1초 예산 안에 끝난다', () => {
    const targets = new Map<string, (typeof input.assignments)[number]>();
    for (const a of input.assignments) {
      if (!targets.has(a.teacher)) targets.set(a.teacher, a);
      if (targets.size >= 10) break;
    }
    expect(targets.size).toBe(10);

    const holesBefore = totalHoles(input);
    let total = 0;
    let candidateTotal = 0;
    for (const target of targets.values()) {
      const t0 = performance.now();
      const { candidates } = recommend(
        input,
        { teacher: target.teacher, slot: target.slot },
        { max: 100 },
      );
      total += performance.now() - t0;
      candidateTotal += candidates.length;
      expect(performance.now() - t0).toBeLessThan(1000);
      for (const cand of candidates) {
        const applied = applyChanges(input, cand.changes);
        expect(validate(applied)).toEqual([]);
        expect(totalHoles(applied)).toBeLessThanOrEqual(holesBefore);
      }
    }
    expect(candidateTotal).toBeGreaterThan(0);
    console.log(
      `결강 10건 탐색 합계 ${total.toFixed(1)}ms (평균 ${(total / 10).toFixed(1)}ms), 후보 합계 ${candidateTotal}개`,
    );
  });
});
