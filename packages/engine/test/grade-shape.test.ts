import { describe, expect, it } from 'vitest';
import { ELECTIVE_RATIO, gradeShapes } from '../src/adapters/neis';
import type { TimetableInput } from '../src/types';

const cfg = { days: 1, periods: 6, dayNames: ['월'] };

/** 학급 n개가 과목 m종을 나눠 갖는 학년을 만든다 */
function grade(g: number, klasses: number, subjects: number): TimetableInput['assignments'] {
  const out: TimetableInput['assignments'] = [];
  for (let k = 1; k <= klasses; k++) {
    for (let p = 0; p < 6; p++) {
      const s = (k * 6 + p) % subjects;
      out.push({ teacher: `T${g}${k}${p}`, klass: `${g}-${k}`, subject: `과목${g}_${s}`, slot: p });
    }
  }
  return out;
}

describe('학년별 과목 다양성', () => {
  it('공통과목만 도는 학년은 선택과목 구간으로 보지 않는다', () => {
    // 실측에서 일반고 1학년은 학급 13개에 과목 13종으로 비율 1.0 이었다
    const input: TimetableInput = { config: cfg, assignments: grade(1, 13, 13) };
    const [shape] = gradeShapes(input);
    expect(shape?.klasses).toBe(13);
    expect(shape?.ratio).toBeCloseTo(1.0, 1);
    expect(shape?.elective).toBe(false);
  });

  it('과목이 학급 수의 두 배면 선택과목 구간으로 본다', () => {
    // 실측에서 일반고 3학년은 학급 13개에 과목 26종으로 비율 2.0 이었다
    const input: TimetableInput = { config: cfg, assignments: grade(3, 13, 26) };
    const [shape] = gradeShapes(input);
    expect(shape?.ratio).toBeCloseTo(2.0, 1);
    expect(shape?.elective).toBe(true);
  });

  it('학년을 나눠 각각 판정한다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [...grade(1, 10, 10), ...grade(3, 10, 25)],
    };
    const shapes = gradeShapes(input);
    expect(shapes.map((s) => s.grade)).toEqual([1, 3]);
    expect(shapes[0]?.elective).toBe(false);
    expect(shapes[1]?.elective).toBe(true);
  });

  it('학년을 못 읽는 학급 이름은 세지 않는다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [{ teacher: 'A', klass: '과학중점', subject: '국어', slot: 0 }],
    };
    expect(gradeShapes(input)).toEqual([]);
  });

  it('기준값이 실측 사이에 있다', () => {
    // 공통과목 학년 1.0~1.1, 선택과목 학년 2.0~2.5 사이를 갈라야 한다
    expect(ELECTIVE_RATIO).toBeGreaterThan(1.1);
    expect(ELECTIVE_RATIO).toBeLessThan(2.0);
  });
});
