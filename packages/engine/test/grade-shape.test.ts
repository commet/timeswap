import { describe, expect, it } from 'vitest';
import { ELECTIVE_RATIO, PRO_SHARE, gradeShapes } from '../src/adapters/neis';
import type { TimetableInput } from '../src/types';

const cfg = { days: 1, periods: 6, dayNames: ['월'] };

/**
 * 학급 n개가 과목 m종을 나눠 갖는 학년을 만든다.
 * proEvery 를 주면 그 배수째 과목을 전문교과로 표시한다.
 */
function grade(
  g: number,
  klasses: number,
  subjects: number,
  proEvery = 0,
): TimetableInput['assignments'] {
  const out: TimetableInput['assignments'] = [];
  for (let k = 1; k <= klasses; k++) {
    for (let p = 0; p < 6; p++) {
      const s = (k * 6 + p) % subjects;
      out.push({
        teacher: `T${g}${k}${p}`,
        klass: `${g}-${k}`,
        subject: `과목${g}_${s}`,
        slot: p,
        ...(proEvery > 0 && s % proEvery === 0 ? { pro: true } : {}),
      });
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

describe('과목이 많은 까닭을 가른다', () => {
  it('전문교과 표시가 없으면 선택과목으로 본다', () => {
    const input: TimetableInput = { config: cfg, assignments: grade(3, 10, 27) };
    expect(gradeShapes(input)[0]?.kind).toBe('선택과목');
    expect(gradeShapes(input)[0]?.proSubjects).toBe(0);
  });

  it('전문교과가 많으면 전공실습으로 본다', () => {
    // 세 과목에 하나씩 전문교과. 몫이 0.33 이라 기준을 넘는다.
    const input: TimetableInput = { config: cfg, assignments: grade(3, 10, 27, 3) };
    const [shape] = gradeShapes(input);
    expect(shape?.kind).toBe('전공실습');
    expect(shape!.proSubjects / shape!.subjects).toBeGreaterThan(PRO_SHARE);
  });

  it('과목이 많지 않으면 표시가 있어도 보통으로 둔다', () => {
    // 교체가 어렵다는 안내 자체가 안 나가는 자리다. 까닭을 물을 일도 없다.
    const input: TimetableInput = { config: cfg, assignments: grade(1, 10, 13, 2) };
    const [shape] = gradeShapes(input);
    expect(shape?.elective).toBe(false);
    expect(shape?.kind).toBe('보통');
  });

  it('전문교과가 드문드문이면 선택과목으로 남는다', () => {
    // 열두 과목에 하나. 일반고에 실습 과목 몇 개가 섞인 모양이다.
    const input: TimetableInput = { config: cfg, assignments: grade(3, 10, 27, 12) };
    expect(gradeShapes(input)[0]?.kind).toBe('선택과목');
  });

  it('전문교과가 없는 1학년도 학교를 보고 전공실습으로 읽는다', () => {
    // 실측에서 특성화고 1학년의 전문교과 몫 중앙값은 0.00 이었다.
    // 그 학년만 떼어 보면 일반고와 구분되지 않는다. 학교 전체를 봐야 갈린다.
    const input: TimetableInput = {
      config: cfg,
      assignments: [...grade(1, 10, 27), ...grade(2, 10, 27, 2), ...grade(3, 10, 27, 2)],
    };
    const shapes = gradeShapes(input);
    expect(shapes[0]?.proSubjects).toBe(0);
    expect(shapes[0]?.kind).toBe('전공실습');
  });

  it('전문교과 기준이 실측한 두 무리 사이에 있다', () => {
    // 학교 25곳에서 과학고와 외국어고, 예술고, 체육고는 모두 0.00 이었고
    // 특성화고와 마이스터고는 0.31 아래로 내려간 곳이 없었다. 그 사이가 비어 있다.
    expect(PRO_SHARE).toBeGreaterThan(0);
    expect(PRO_SHARE).toBeLessThan(0.31);
  });
});
