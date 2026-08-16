import { describe, expect, it } from 'vitest';
import type { TimetableInput } from '../src/types';
import { recommend } from '../src/search';
import { dayOf } from '../src/slots';
import { buildIndexes, closedReason } from '../src/timetable';
import { buildUnits, checkMoves } from '../src/units';

// 3일 x 3교시. 슬롯: 월1=0 월2=1 월3=2 화1=3 화2=4 화3=5 수1=6 수2=7 수3=8
const cfg = { days: 3, periods: 3, dayNames: ['월', '화', '수'] };

// 두 학급이 월요일 3교시, 화요일 2교시, 수요일 2교시를 듣는다.
// 각 요일의 마지막 교시 뒤에 한 칸씩 남아 있어 옮길 자리가 있다.
const school: TimetableInput = {
  config: cfg,
  assignments: [
    // 2-1
    { teacher: 'A', klass: '2-1', subject: '수학', slot: 0 },
    { teacher: 'B', klass: '2-1', subject: '영어', slot: 1 },
    { teacher: 'C', klass: '2-1', subject: '과학', slot: 2 },
    { teacher: 'D', klass: '2-1', subject: '국어', slot: 3 },
    { teacher: 'A', klass: '2-1', subject: '수학', slot: 4 },
    { teacher: 'B', klass: '2-1', subject: '영어', slot: 6 },
    { teacher: 'D', klass: '2-1', subject: '국어', slot: 7 },
    // 2-2
    { teacher: 'B', klass: '2-2', subject: '영어', slot: 0 },
    { teacher: 'A', klass: '2-2', subject: '수학', slot: 1 },
    { teacher: 'D', klass: '2-2', subject: '국어', slot: 2 },
    { teacher: 'C', klass: '2-2', subject: '과학', slot: 3 },
    { teacher: 'B', klass: '2-2', subject: '영어', slot: 4 },
    { teacher: 'A', klass: '2-2', subject: '수학', slot: 6 },
    { teacher: 'C', klass: '2-2', subject: '과학', slot: 7 },
  ],
};

/** 수요일(요일 2)이 통째로 쉬는 학교 */
const closedWed: TimetableInput = {
  ...school,
  closures: [{ day: 2, reason: '개교기념일' }],
};

/** 결강 대상은 2-1 월3 과학(C 선생님). 옮겨도 월요일에 빈틈이 안 생긴다. */
const target = { teacher: 'C', slot: 2 };

describe('학사일정: 쉬는 날로는 옮기지 않는다', () => {
  it('휴업일이 없으면 수요일로 가는 안이 나온다', () => {
    const r = recommend(school, target, { max: 50 });
    const toWed = r.candidates.filter((c) => c.changes.some((ch) => dayOf(ch.toSlot, cfg) === 2));
    expect(toWed.length).toBeGreaterThan(0);
  });

  it('휴업일이 있으면 그 요일로 가는 안이 하나도 없다', () => {
    const r = recommend(closedWed, target, { max: 50 });
    for (const c of r.candidates) {
      for (const ch of c.changes) {
        expect(dayOf(ch.toSlot, cfg)).not.toBe(2);
      }
    }
  });

  it('휴업일을 걸어도 다른 요일 교체는 그대로 남는다', () => {
    const r = recommend(closedWed, target, { max: 50 });
    expect(r.candidates.length).toBeGreaterThan(0);
  });

  it('막힌 이유를 사람이 읽을 문장으로 돌려준다', () => {
    const idx = buildIndexes(closedWed);
    const units = buildUnits(closedWed);
    const unit = [...units.values()].find((u) => u.slot === 2 && u.teachers.includes('C'));
    expect(unit).toBeDefined();
    const v = checkMoves(idx, cfg, [{ unit: unit!, toSlot: 8 }]);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('수요일은 개교기념일이라 수업이 없습니다');
  });

  it('학년 행사는 해당 학급만 막는다', () => {
    const onlyOne: TimetableInput = {
      ...school,
      closures: [{ day: 2, reason: '수학여행', klasses: ['2-2'] }],
    };
    const idx = buildIndexes(onlyOne);
    expect(closedReason(idx, '2-2', 2)).toBe('수학여행');
    expect(closedReason(idx, '2-1', 2)).toBeUndefined();

    const units = buildUnits(onlyOne);
    // 2-1 수업은 수요일로 갈 수 있다
    const u21 = [...units.values()].find((u) => u.slot === 2 && u.klasses.includes('2-1'));
    expect(checkMoves(idx, cfg, [{ unit: u21!, toSlot: 8 }]).ok).toBe(true);
    // 2-2 수업은 막힌다
    const u22 = [...units.values()].find((u) => u.slot === 2 && u.klasses.includes('2-2'));
    expect(checkMoves(idx, cfg, [{ unit: u22!, toSlot: 8 }]).ok).toBe(false);
  });

  it('쉬는 날에서 빠져나오는 이동은 막지 않는다', () => {
    // 수요일이 휴업일이어도 수요일 수업을 다른 날로 빼는 것은 되어야 한다
    const idx = buildIndexes(closedWed);
    const units = buildUnits(closedWed);
    const wed = [...units.values()].find((u) => u.slot === 7 && u.teachers.includes('D'));
    expect(wed).toBeDefined();
    expect(checkMoves(idx, cfg, [{ unit: wed!, toSlot: 5 }]).ok).toBe(true);
  });
});

describe('요일마다 교시 수가 다른 학교', () => {
  // 수요일은 2교시까지만 하는 학교. 단축수업이 흔하다.
  const short: TimetableInput = {
    ...school,
    config: { ...cfg, periodsPerDay: [3, 3, 2] },
  };

  it('없는 교시로 옮기라는 안이 나오지 않는다', () => {
    const r = recommend(short, target, { max: 50 });
    for (const c of r.candidates) {
      for (const ch of c.changes) {
        const d = dayOf(ch.toSlot, cfg);
        const p = ch.toSlot - d * cfg.periods;
        expect(p).toBeLessThan(short.config.periodsPerDay![d]!);
      }
    }
  });

  it('막힌 이유를 사람이 읽을 문장으로 돌려준다', () => {
    const idx = buildIndexes(short);
    const units = buildUnits(short);
    const unit = [...units.values()].find((u) => u.slot === 2 && u.teachers.includes('C'));
    // 설정을 그대로 넘겨야 한다. 교시 수는 config 에 실려 오는 값이다.
    const v = checkMoves(idx, short.config, [{ unit: unit!, toSlot: 8 }]);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('수요일은 2교시까지입니다');
  });

  it('알려 주지 않으면 막지 않는다', () => {
    // 작은 학교에서는 그저 비어 있는 칸과 없는 교시를 가릴 수 없다. 짐작하지 않는다.
    const idx = buildIndexes(school);
    const units = buildUnits(school);
    const unit = [...units.values()].find((u) => u.slot === 2 && u.teachers.includes('C'));
    expect(checkMoves(idx, cfg, [{ unit: unit!, toSlot: 8 }]).ok).toBe(true);
  });
});
