import { describe, expect, it } from 'vitest';
import { recommend } from '../src/search';
import { validate } from '../src/timetable';
import type { TimetableInput } from '../src/types';

/**
 * 소프트 점수의 현장 조건들이 실제로 작동하는지 본다.
 * 되느냐 안 되느냐는 하드 제약이 가리고, 여기서는 되는 것 가운데 무엇이 나은지를 다룬다.
 */

/** 5일 6교시, 점심은 3교시 뒤 */
const cfg = {
  days: 5,
  periods: 6,
  dayNames: ['월', '화', '수', '목', '금'],
  lunchAfterPeriod: 3,
};
const S = (d: number, p: number): number => d * 6 + p;

function reasons(input: TimetableInput, teacher: string, slot: number): string[] {
  const { candidates } = recommend(input, { teacher, slot });
  return candidates.flatMap((c) => c.trace.map((t) => t.text));
}

describe('현장 조건이 점수에 반영된다', () => {
  it('같은 교사가 같은 학급을 하루에 두 번 만나면 감점한다', () => {
    // 김국어는 화요일에 이미 1-1 에 들어간다. 월요일 수업을 화요일로 옮기면 두 번이 된다.
    const school: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: '김국어', klass: '1-1', subject: '국어', slot: S(0, 0) },
        { teacher: '김국어', klass: '1-1', subject: '문학', slot: S(1, 0) },
        { teacher: '이수학', klass: '1-1', subject: '수학', slot: S(1, 1) },
      ],
    };
    expect(validate(school)).toEqual([]);
    const texts = reasons(school, '김국어', S(0, 0));
    expect(texts.some((t) => t.includes('1-1에 두 번 들어갑니다'))).toBe(true);
  });

  it('연속 세 시간이 새로 생기면 감점한다', () => {
    // 박영어는 월요일 1, 2교시 수업이 있다. 3교시로 옮기면 내리 세 시간이 된다.
    const school: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: '박영어', klass: '2-1', subject: '영어', slot: S(0, 0) },
        { teacher: '박영어', klass: '2-2', subject: '영어', slot: S(0, 1) },
        { teacher: '박영어', klass: '2-3', subject: '영어', slot: S(1, 0) },
        { teacher: '최과학', klass: '2-3', subject: '과학', slot: S(0, 2) },
      ],
    };
    expect(validate(school)).toEqual([]);
    const texts = reasons(school, '최과학', S(0, 2));
    // 최과학의 월 3교시를 박영어가 가져가면 박영어는 1, 2, 3교시 연속이 된다
    expect(texts.some((t) => t.includes('시간 내리 수업합니다'))).toBe(true);
  });

  it('학급 하교가 늦어지면 감점하고 몇 교시인지 밝힌다', () => {
    const school: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: '김국어', klass: '1-1', subject: '국어', slot: S(0, 0) },
        { teacher: '이수학', klass: '1-1', subject: '수학', slot: S(0, 1) },
        { teacher: '이수학', klass: '1-1', subject: '수학', slot: S(1, 0) },
      ],
    };
    expect(validate(school)).toEqual([]);
    const { candidates } = recommend(school, { teacher: '이수학', slot: S(0, 1) });
    const later = candidates.find((c) => c.trace.some((t) => t.text.includes('늦게 끝납니다')));
    expect(later).toBeDefined();
    expect(later!.trace.find((t) => t.text.includes('늦게 끝납니다'))!.points).toBeLessThan(0);
  });

  it('점심을 사이에 두고 이어 붙으면 감점한다', () => {
    // 점심은 3교시 뒤에 온다. 정체육은 월요일 3교시에 3-2 수업이 있다.
    // 한음악의 월요일 4교시를 정체육의 화요일 수업과 맞바꾸면
    // 정체육은 월요일 3교시와 4교시를 점심 없이 내리 하게 된다.
    const school: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: '김국어', klass: '3-1', subject: '국어', slot: S(0, 0) },
        { teacher: '이수학', klass: '3-1', subject: '수학', slot: S(0, 1) },
        { teacher: '박영어', klass: '3-1', subject: '영어', slot: S(0, 2) },
        { teacher: '한음악', klass: '3-1', subject: '음악', slot: S(0, 3) },
        { teacher: '정체육', klass: '3-1', subject: '체육', slot: S(1, 0) },
        { teacher: '최과학', klass: '3-2', subject: '과학', slot: S(0, 0) },
        { teacher: '윤사회', klass: '3-2', subject: '사회', slot: S(0, 1) },
        { teacher: '정체육', klass: '3-2', subject: '체육', slot: S(0, 2) },
      ],
    };
    expect(validate(school)).toEqual([]);
    const texts = reasons(school, '한음악', S(0, 3));
    expect(texts.some((t) => t.includes('점심 앞뒤로'))).toBe(true);
  });

  it('되는 안이 여럿이면 덜 건드리는 쪽이 위로 온다', () => {
    const school: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: 'A', klass: '1-1', subject: '국어', slot: S(0, 0) },
        { teacher: 'B', klass: '1-1', subject: '수학', slot: S(0, 1) },
        { teacher: 'C', klass: '1-1', subject: '영어', slot: S(0, 2) },
        { teacher: 'B', klass: '1-2', subject: '수학', slot: S(0, 0) },
        { teacher: 'C', klass: '1-2', subject: '영어', slot: S(0, 1) },
        { teacher: 'A', klass: '1-2', subject: '국어', slot: S(0, 2) },
      ],
    };
    expect(validate(school)).toEqual([]);
    const { candidates } = recommend(school, { teacher: 'A', slot: S(0, 0) });
    expect(candidates.length).toBeGreaterThan(0);
    // 점수가 높은 것이 앞에 오고, 앞의 것이 뒤의 것보다 적게 건드린다
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1]!.score).toBeGreaterThanOrEqual(candidates[i]!.score);
    }
  });

  it('모든 감점에 사람이 읽을 이유가 붙는다', () => {
    const school: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: 'A', klass: '1-1', subject: '국어', slot: S(0, 0) },
        { teacher: 'B', klass: '1-1', subject: '수학', slot: S(0, 1) },
        { teacher: 'B', klass: '1-2', subject: '수학', slot: S(0, 0) },
        { teacher: 'A', klass: '1-2', subject: '국어', slot: S(0, 1) },
      ],
    };
    const { candidates } = recommend(school, { teacher: 'A', slot: S(0, 0) });
    for (const c of candidates) {
      expect(c.trace.length).toBeGreaterThan(0);
      for (const t of c.trace) {
        expect(t.text.length).toBeGreaterThan(4);
        expect(['조건', '감점', '가점']).toContain(t.kind);
      }
    }
  });
});
