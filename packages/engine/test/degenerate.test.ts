import { describe, expect, it } from 'vitest';
import { recommend } from '../src/search';
import { coverCandidates } from '../src/cover';
import { fromNeis, gradeShapes, neisToTimetable, type NeisRow } from '../src/adapters/neis';
import { totalHoles, validate } from '../src/timetable';
import type { TimetableInput } from '../src/types';

/**
 * 퇴화한 입력.
 *
 * 실제 학교 371곳은 다 통과했지만 그것은 잘 생긴 자료다. 나이스가 항상 그렇게 주는
 * 것은 아니다. 실측에서 나온 것만 적어도 반 이름이 `4(자유학기, 동아리)` 처럼 열두
 * 글자짜리가 있고, 과목명이 35자까지 가고, 교시가 11까지 간다.
 *
 * 여기서는 그 끝과 그보다 더 나쁜 것을 넣는다. 답이 안 나와도 좋다. 다만 터지거나
 * 성립하지 않는 시간표를 내면 안 된다.
 */
const cfg = { days: 5, periods: 7, dayNames: ['월', '화', '수', '목', '금'] };

describe('퇴화한 입력', () => {
  it('배정이 없으면 빈 결과를 준다', () => {
    const input: TimetableInput = { config: cfg, assignments: [] };
    expect(validate(input)).toEqual([]);
    expect(gradeShapes(input)).toEqual([]);
    expect(totalHoles(input)).toBe(0);
    expect(coverCandidates(input, 0, '국어')).toEqual([]);
  });

  it('없는 수업을 고르면 사람이 읽을 말로 막는다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [{ teacher: '김국어', klass: '1-1', subject: '국어', slot: 0 }],
    };
    expect(() => recommend(input, { teacher: '없는분', slot: 0 })).toThrow(/찾을 수 없습니다/);
    expect(() => recommend(input, { teacher: '김국어', slot: 34 })).toThrow(/찾을 수 없습니다/);
  });

  it('수업이 하나뿐이면 옮길 곳이 없어도 터지지 않는다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [{ teacher: '김국어', klass: '1-1', subject: '국어', slot: 0 }],
    };
    const r = recommend(input, { teacher: '김국어', slot: 0 });
    expect(Array.isArray(r.candidates)).toBe(true);
  });

  it('교시가 열하나인 학교도 다룬다', () => {
    // 실측에서 교시 11까지 나왔다
    const wide = { days: 5, periods: 11, dayNames: ['월', '화', '수', '목', '금'] };
    const assignments: TimetableInput['assignments'] = [];
    for (let k = 1; k <= 3; k++) {
      for (let p = 0; p < 9; p++) {
        assignments.push({ teacher: `T${p % 4}`, klass: `1-${k}`, subject: `과목${p}`, slot: p + (k - 1) * 11 });
      }
    }
    const input: TimetableInput = { config: wide, assignments };
    expect(validate(input)).toEqual([]);
    expect(() => recommend(input, { teacher: 'T0', slot: 0 })).not.toThrow();
  });

  it('반 이름과 과목명이 아주 길어도 다룬다', () => {
    // 실측 최장값이다. 반 이름 12자, 과목명 35자
    const input: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: '김', klass: '1-4(자유학기, 동아리)', subject: 'Critical Thinking and Argumentation', slot: 0 },
        { teacher: '박', klass: '1-4(자유학기, 동아리)', subject: '현장체험학습-[선]동아시아 역사 기행', slot: 1 },
      ],
    };
    expect(validate(input)).toEqual([]);
    expect(() => recommend(input, { teacher: '김', slot: 0 })).not.toThrow();
    expect(gradeShapes(input).map((s) => s.grade)).toEqual([1]);
  });

  it('모든 교사가 모든 시간에 근무 불가여도 터지지 않는다', () => {
    const all = Array.from({ length: 35 }, (_, i) => i);
    const input: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: 'A', klass: '1-1', subject: '국어', slot: 0 },
        { teacher: 'B', klass: '1-2', subject: '수학', slot: 1 },
      ],
      unavailable: { A: all, B: all },
    };
    const r = recommend(input, { teacher: 'A', slot: 0 });
    expect(r.candidates).toEqual([]);
    expect(coverCandidates(input, 0, '국어', 8, 'A')).toEqual([]);
  });

  it('모든 요일이 쉬는 날이어도 터지지 않는다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: 'A', klass: '1-1', subject: '국어', slot: 0 },
        { teacher: 'B', klass: '1-1', subject: '수학', slot: 1 },
      ],
      closures: [0, 1, 2, 3, 4].map((day) => ({ day, reason: '재량휴업일' })),
    };
    expect(recommend(input, { teacher: 'A', slot: 0 }).candidates).toEqual([]);
    expect(coverCandidates(input, 0, '국어', 8, 'A')).toEqual([]);
  });

  it('학급 전체가 담당 미상이어도 터지지 않는다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [{ teacher: 'A', klass: '1-1', subject: '국어', slot: 0 }],
      klassBusy: { '1-2': Array.from({ length: 35 }, (_, i) => i) },
    };
    expect(validate(input)).toEqual([]);
    expect(() => recommend(input, { teacher: 'A', slot: 0 })).not.toThrow();
  });

  it('나이스 행이 하나뿐이어도 시간표가 나온다', () => {
    const rows: NeisRow[] = [{
      SCHUL_NM: '한줄고', SD_SCHUL_CODE: '1', AY: '2026',
      ALL_TI_YMD: '20260608', GRADE: '1', CLASS_NM: '1', PERIO: '1', ITRT_CNTNT: '국어',
    } as NeisRow];
    const report = fromNeis(rows);
    const input = neisToTimetable(report, () => '김국어');
    expect(validate(input)).toEqual([]);
    expect(input.assignments).toHaveLength(1);
  });

  it('나이스 행이 하나도 없으면 빈 시간표다', () => {
    const report = fromNeis([]);
    const input = neisToTimetable(report, () => '김국어');
    expect(input.assignments).toEqual([]);
    expect(validate(input)).toEqual([]);
  });
});
