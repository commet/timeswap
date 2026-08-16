import { describe, expect, it } from 'vitest';
import type { TimetableInput } from '../src/types';
import { recommend } from '../src/search';
import { applyChanges, buildIndexes, tsKey, validate } from '../src/timetable';

// 손으로 만든 2일 x 3교시 학교. 정답 교환안을 수작업으로 검증해 두었다.
// 슬롯: 월1=0 월2=1 월3=2 화1=3 화2=4 화3=5
const cfg = { days: 2, periods: 3, dayNames: ['월', '화'] };

const school: TimetableInput = {
  config: cfg,
  assignments: [
    { teacher: 'A', klass: '2-3', subject: '수학', slot: 0 },
    { teacher: 'B', klass: '2-3', subject: '영어', slot: 1 },
    { teacher: 'C', klass: '2-3', subject: '과학', slot: 2 },
    { teacher: 'D', klass: '2-3', subject: '국어', slot: 3 },
    { teacher: 'A', klass: '2-3', subject: '수학', slot: 4 },
    { teacher: 'B', klass: '2-3', subject: '영어', slot: 5 },
    { teacher: 'B', klass: '2-4', subject: '영어', slot: 0 },
    { teacher: 'A', klass: '2-4', subject: '수학', slot: 1 },
    { teacher: 'D', klass: '2-4', subject: '국어', slot: 2 },
    { teacher: 'A', klass: '2-4', subject: '수학', slot: 3 },
    { teacher: 'C', klass: '2-4', subject: '과학', slot: 4 },
    { teacher: 'D', klass: '2-4', subject: '국어', slot: 5 },
  ],
};

describe('골든: 맞교환이 유일한 최선인 학교', () => {
  it('입력 자체가 불변식을 지킨다', () => {
    expect(validate(school)).toEqual([]);
  });

  it('A 선생님 월요일 1교시 결강의 1위는 C 선생님과의 같은 날 맞교환이다', () => {
    const { candidates } = recommend(school, { teacher: 'A', slot: 0 });
    expect(candidates.length).toBeGreaterThan(0);
    const top = candidates[0]!;
    expect(top.type).toBe('swap2');
    expect(top.title).toContain('C 선생님');
    // 변경 2건(-20) + 당일 해결(+5)
    expect(top.score).toBe(-15);
    // 유일한 2자 교환이어야 한다 (수작업 검증 결과)
    expect(candidates.filter((c) => c.type === 'swap2')).toHaveLength(1);
  });

  it('모든 후보는 적용 후에도 불변식을 지키고 결강 슬롯을 해소한다', () => {
    const { candidates } = recommend(school, { teacher: 'A', slot: 0 });
    for (const cand of candidates) {
      const applied = applyChanges(school, cand.changes);
      expect(validate(applied)).toEqual([]);
      const idx = buildIndexes(applied);
      expect(idx.byTeacherSlot.get(tsKey('A', 0))).toBeUndefined();
      // 이동이 없는 유형이면 학급의 해당 교시는 다른 교사가 채운다
      if (cand.type !== 'move') {
        expect(idx.byKlassSlot.get('2-3|0')).toBeDefined();
      }
    }
  });
});

describe('골든: 빈 교시 이동이 최선인 학교', () => {
  const mini: TimetableInput = {
    config: cfg,
    assignments: [
      { teacher: 'A', klass: '1-1', subject: '국어', slot: 0 },
      { teacher: 'B', klass: '1-1', subject: '수학', slot: 1 },
      { teacher: 'A', klass: '1-1', subject: '국어', slot: 3 },
    ],
  };

  it('그날 마지막 교시 수업은 다른 날 빈 교시로 옮기는 안이 1위다', () => {
    expect(validate(mini)).toEqual([]);
    const { candidates } = recommend(mini, { teacher: 'B', slot: 1 });
    const top = candidates[0]!;
    expect(top.type).toBe('move');
    expect(top.changes[0]!.toSlot).toBe(4); // 화요일 2교시
    expect(top.score).toBe(-10);
    // 맞교환(A 선생님)도 후보로는 존재하되 순위가 밀린다
    expect(candidates.some((c) => c.type === 'swap2')).toBe(true);
  });

  it('마지막 교시가 없는 결강(중간 교시)은 이동 후보를 만들지 않는다', () => {
    const { candidates } = recommend(mini, { teacher: 'A', slot: 0 });
    expect(candidates.every((c) => c.type !== 'move')).toBe(true);
  });
});

describe('분반 묶음의 정직한 제외', () => {
  const grouped: TimetableInput = {
    config: cfg,
    assignments: [
      { teacher: 'A', klass: '1-1', subject: '체육', slot: 0, group: 'PE-1' },
      { teacher: 'B', klass: '1-1', subject: '수학', slot: 1 },
    ],
  };

  it('묶음 수업은 자동 추천을 하지 않고 사유를 남긴다', () => {
    const { candidates, notes } = recommend(grouped, { teacher: 'A', slot: 0 });
    expect(candidates).toEqual([]);
    expect(notes.join(' ')).toContain('분반');
  });
});
