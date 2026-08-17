import { describe, expect, it } from 'vitest';
import { recommend } from '../src/search';
import { totalHoles, validate } from '../src/timetable';
import { coverCandidates } from '../src/cover';
import type { ScheduleConfig, TimetableInput } from '../src/types';

/**
 * 새로 넣은 장치들이 서로 부딪히는 자리.
 *
 * 담당 미상 자리(klassBusy), 자료 없는 요일(closures), 묶음(group) 셋을 따로 시험했다.
 * 함께 걸렸을 때 무엇이 되는지는 재어 본 적이 없다. 학교 자료는 이 셋이 한꺼번에 온다.
 */
const cfg: ScheduleConfig = { days: 5, periods: 4, dayNames: ['월', '화', '수', '목', '금'] };
const S = (t: string, k: string, s: number, extra = {}) =>
  ({ teacher: t, klass: k, subject: '과목', slot: s, ...extra });

describe('장치가 겹칠 때', () => {
  it('요일 하나만 자료가 있어도 그 안에서 찾는다', () => {
    // 나이스에서 하루치만 받아 온 경우다. 나머지 나흘은 자료가 없어 막힌다.
    // 김과 이가 각각 한 학급만 맡는다. 서로 다른 학급이라 자리를 맞바꿀 수 있다.
    const input: TimetableInput = {
      config: cfg,
      assignments: [S('김', '1-1', 0), S('이', '1-1', 1), S('박', '1-2', 0), S('최', '1-2', 1)],
      closures: [1, 2, 3, 4].map((day) => ({ day, reason: '자료를 받지 못한 요일' })),
    };
    expect(validate(input)).toEqual([]);
    const { candidates } = recommend(input, { teacher: '김', slot: 0 });
    // 월요일 안에서 1교시와 2교시를 맞바꾸는 안이 있어야 한다
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      for (const ch of c.changes) expect(ch.toSlot).toBeLessThan(cfg.periods);
    }
  });

  it('담당 미상 자리와 자료 없는 요일이 함께 있어도 성립하는 안만 낸다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [S('김', '1-1', 0), S('이', '1-1', 1), S('이', '1-2', 0), S('김', '1-2', 1)],
      klassBusy: { '1-1': [2, 3], '1-2': [2, 3] },
      closures: [{ day: 2, reason: '자료를 받지 못한 요일' }],
    };
    const { candidates } = recommend(input, { teacher: '김', slot: 0 });
    const forbidden = new Set(['1-1|2', '1-1|3', '1-2|2', '1-2|3']);
    for (const c of candidates) {
      for (const ch of c.changes) {
        expect(forbidden.has(`${ch.from.klass}|${ch.toSlot}`)).toBe(false);
        expect(Math.floor(ch.toSlot / cfg.periods)).not.toBe(2);
      }
    }
  });

  it('묶음이 담당 미상 자리로는 옮겨지지 않는다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [
        S('김', '1-1', 0, { group: 'g' }),
        S('이', '1-2', 0, { group: 'g' }),
        S('박', '1-1', 1),
        S('최', '1-2', 1),
      ],
      klassBusy: { '1-1': [2], '1-2': [2] },
    };
    expect(validate(input)).toEqual([]);
    const { candidates } = recommend(input, { teacher: '김', slot: 0 });
    for (const c of candidates) {
      for (const ch of c.changes) expect(ch.toSlot).not.toBe(2);
    }
  });

  it('학급이 하나뿐인 학교에서도 돌아간다', () => {
    // 한 학급만 받아 온 자료다. 맞바꿀 상대가 사실상 없지만 죽지는 않아야 한다.
    const input: TimetableInput = {
      config: cfg,
      assignments: [S('김', '1-1', 0), S('이', '1-1', 1)],
    };
    expect(validate(input)).toEqual([]);
    expect(() => recommend(input, { teacher: '김', slot: 0 })).not.toThrow();
    expect(() => coverCandidates(input, 0, '과목', 8, '김')).not.toThrow();
  });

  it('모든 수업이 한 묶음이어도 죽지 않는다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: ['1-1', '1-2', '1-3'].map((k, i) => S(`교사${i}`, k, 0, { group: 'g' })),
    };
    expect(validate(input)).toEqual([]);
    const { candidates } = recommend(input, { teacher: '교사0', slot: 0 });
    /*
     * 묶음도 통째로는 옮겨진다. 여기서 잠글 것은 "안이 없다" 가 아니라
     * "한 조각만 떨어져 나가지 않는다" 다. 처음에 0 을 기대했는데 4개가 나왔고,
     * 확인해 보니 다섯 요일 가운데 나머지 나흘이 비어 있어 통째로 옮길 자리가 있었다.
     * 도구가 맞고 시험이 틀렸던 자리다.
     */
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      // 묶음의 세 수업이 늘 함께 움직이고 도착 교시도 하나여야 한다
      expect(c.changes.length).toBe(3);
      expect(new Set(c.changes.map((ch) => ch.toSlot)).size).toBe(1);
      expect(new Set(c.changes.map((ch) => ch.from.klass)).size).toBe(3);
    }
    const covers = coverCandidates(input, 0, '과목', 8, '교사0');
    expect(Array.isArray(covers)).toBe(true);
  });

  it('담당 미상 자리만 있고 배정이 하나도 없으면 빈 시간 계산이 죽지 않는다', () => {
    const input: TimetableInput = {
      config: cfg,
      assignments: [],
      klassBusy: { '1-1': [0, 1, 2, 3] },
    };
    expect(validate(input)).toEqual([]);
    expect(totalHoles(input)).toBe(0);
  });

  it('요일마다 교시 수가 다르고 담당 미상 자리가 섞여도 없는 교시로 옮기지 않는다', () => {
    const short: ScheduleConfig = { ...cfg, periodsPerDay: [4, 4, 2, 4, 4] };
    const input: TimetableInput = {
      config: short,
      assignments: [S('김', '1-1', 0), S('이', '1-1', 1), S('이', '1-2', 0), S('김', '1-2', 1)],
      klassBusy: { '1-1': [3] },
    };
    const { candidates } = recommend(input, { teacher: '김', slot: 0 });
    for (const c of candidates) {
      for (const ch of c.changes) {
        const day = Math.floor(ch.toSlot / short.periods);
        const period = ch.toSlot - day * short.periods;
        expect(period).toBeLessThan(short.periodsPerDay![day]!);
      }
    }
  });
});
