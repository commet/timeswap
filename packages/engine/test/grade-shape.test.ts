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
    // 실측 24곳에서 1학년 중앙값은 1.5, 3사분위는 1.9 였다
    const input: TimetableInput = { config: cfg, assignments: grade(1, 10, 15) };
    const [shape] = gradeShapes(input);
    expect(shape?.klasses).toBe(10);
    expect(shape?.ratio).toBeCloseTo(1.5, 1);
    expect(shape?.elective).toBe(false);
  });

  it('1학년 3사분위(1.9)도 선택과목 구간으로 보지 않는다', () => {
    // 기준을 1.5로 두었을 때 1학년의 절반을 잘못 잡던 자리다
    const input: TimetableInput = { config: cfg, assignments: grade(1, 10, 19) };
    expect(gradeShapes(input)[0]?.elective).toBe(false);
  });

  it('3학년 중앙값(2.7)은 선택과목 구간으로 본다', () => {
    const input: TimetableInput = { config: cfg, assignments: grade(3, 10, 27) };
    const [shape] = gradeShapes(input);
    expect(shape?.ratio).toBeCloseTo(2.7, 1);
    expect(shape?.elective).toBe(true);
  });

  it('학년을 나눠 각각 판정한다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [...grade(1, 10, 13), ...grade(3, 10, 30)],
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

  it('기준값이 실측 분포 사이에 있다', () => {
    // 24곳 실측에서 1학년 3사분위 1.9, 3학년 1사분위 2.4 였다. 그 사이여야 한다.
    expect(ELECTIVE_RATIO).toBeGreaterThan(1.9);
    expect(ELECTIVE_RATIO).toBeLessThan(2.4);
  });
});
