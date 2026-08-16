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
    // 수업 1개 이동(-10) + 화요일 하교가 1교시 늦어짐(-2)
    expect(top.score).toBe(-12);
    expect(top.trace.some((t) => t.text.includes('늦게 끝납니다'))).toBe(true);
    // 맞교환(A 선생님)도 후보로는 존재하되 순위가 밀린다
    expect(candidates.some((c) => c.type === 'swap2')).toBe(true);
  });

  it('마지막 교시가 없는 결강(중간 교시)은 이동 후보를 만들지 않는다', () => {
    const { candidates } = recommend(mini, { teacher: 'A', slot: 0 });
    expect(candidates.every((c) => c.type !== 'move')).toBe(true);
  });
});

describe('분반 이동수업: 묶음 통째 교환', () => {
  // 1학년 세 반이 수학과 과학에서 수준별로 갈라져 세 교사가 동시에 들어간다.
  // 국어와 영어는 반별 수업이라 묶이지 않는다.
  const moving: TimetableInput = {
    config: cfg,
    assignments: [
      // 월1: 수학 이동수업 묶음
      { teacher: 'M1', klass: '1-1', subject: '수학', slot: 0, group: '수학이동' },
      { teacher: 'M2', klass: '1-2', subject: '수학', slot: 0, group: '수학이동' },
      { teacher: 'M3', klass: '1-3', subject: '수학', slot: 0, group: '수학이동' },
      // 월2, 월3: 반별 수업
      { teacher: 'K1', klass: '1-1', subject: '국어', slot: 1 },
      { teacher: 'K2', klass: '1-2', subject: '국어', slot: 1 },
      { teacher: 'K3', klass: '1-3', subject: '국어', slot: 1 },
      { teacher: 'E1', klass: '1-1', subject: '영어', slot: 2 },
      { teacher: 'E2', klass: '1-2', subject: '영어', slot: 2 },
      { teacher: 'E3', klass: '1-3', subject: '영어', slot: 2 },
      // 화1: 과학 이동수업 묶음
      { teacher: 'S1', klass: '1-1', subject: '과학', slot: 3, group: '과학이동' },
      { teacher: 'S2', klass: '1-2', subject: '과학', slot: 3, group: '과학이동' },
      { teacher: 'S3', klass: '1-3', subject: '과학', slot: 3, group: '과학이동' },
      // 화2, 화3: 교사를 돌려 반별 수업
      { teacher: 'K3', klass: '1-1', subject: '국어', slot: 4 },
      { teacher: 'K1', klass: '1-2', subject: '국어', slot: 4 },
      { teacher: 'K2', klass: '1-3', subject: '국어', slot: 4 },
      { teacher: 'E3', klass: '1-1', subject: '영어', slot: 5 },
      { teacher: 'E1', klass: '1-2', subject: '영어', slot: 5 },
      { teacher: 'E2', klass: '1-3', subject: '영어', slot: 5 },
    ],
  };

  it('입력 자체가 불변식을 지킨다', () => {
    expect(validate(moving)).toEqual([]);
  });

  it('같은 교시 같은 묶음이 하나의 단위로 묶인다', async () => {
    const { buildUnits, unitKey } = await import('../src/units');
    const units = buildUnits(moving);
    const u = units.get(unitKey(moving.assignments[0]!))!;
    expect(u.grouped).toBe(true);
    expect(u.teachers.sort()).toEqual(['M1', 'M2', 'M3']);
    expect(u.klasses.sort()).toEqual(['1-1', '1-2', '1-3']);
    expect(u.assignments).toHaveLength(3);
  });

  it('이동수업 결강에도 교환안을 찾는다', () => {
    const { candidates, notes } = recommend(moving, { teacher: 'M1', slot: 0 });
    expect(candidates.length).toBeGreaterThan(0);
    expect(notes.join(' ')).toContain('통째로');
  });

  it('묶음은 절대 쪼개지지 않는다', () => {
    const { candidates } = recommend(moving, { teacher: 'M1', slot: 0 });
    for (const cand of candidates) {
      const byGroup = new Map<string, Set<number>>();
      for (const c of cand.changes) {
        if (!c.from.group) continue;
        const key = `${c.from.group}|${c.from.slot}`;
        byGroup.set(key, (byGroup.get(key) ?? new Set()).add(c.toSlot));
      }
      for (const [key, slots] of byGroup) {
        expect(`${key}:${slots.size}`).toBe(`${key}:1`);
      }
    }
  });

  it('묶음끼리 자리를 통째로 맞바꾼다', () => {
    const { candidates } = recommend(moving, { teacher: 'M1', slot: 0 });
    const both = candidates.find(
      (c) => c.type === 'swap2' && c.changes.some((x) => x.from.group === '과학이동'),
    );
    expect(both).toBeDefined();
    // 묶음 두 개가 움직이므로 결정은 2건, 실제 수업은 6개가 자리를 옮긴다
    expect(both!.unitCount).toBe(2);
    expect(both!.changes).toHaveLength(6);
    expect(both!.title).toContain('이동수업');
  });

  it('학급 하나짜리 수업과는 맞바꾸지 않는다', () => {
    // 수학 이동수업을 1-1 국어 한 칸과 바꾸면 1-2 와 1-3 이 그 시간에 빈다
    const { candidates } = recommend(moving, { teacher: 'M1', slot: 0 });
    const bad = candidates.find(
      (c) =>
        c.type === 'swap2' &&
        c.changes.filter((x) => x.from.group === undefined).length > 0 &&
        c.changes.filter((x) => x.from.group === undefined).length < 3,
    );
    expect(bad).toBeUndefined();
  });

  it('모든 후보가 적용 후에도 불변식을 지킨다', () => {
    const { candidates } = recommend(moving, { teacher: 'M1', slot: 0 });
    for (const cand of candidates) {
      const applied = applyChanges(moving, cand.changes);
      expect(validate(applied)).toEqual([]);
      // 결강 교사는 원래 교시에서 빠져야 한다
      expect(buildIndexes(applied).byTeacherSlot.get(tsKey('M1', 0))).toBeUndefined();
    }
  });

  it('함께 끌려가는 교사를 근거에 밝힌다', () => {
    const { candidates } = recommend(moving, { teacher: 'M1', slot: 0 });
    const withDrag = candidates.find((c) =>
      c.trace.some((t) => t.text.includes('함께 움직입니다')),
    );
    expect(withDrag).toBeDefined();
    expect(withDrag!.trace.find((t) => t.text.includes('함께 움직입니다'))!.text).toContain('M2');
  });
});

describe('묶음의 다른 형태: 복수교사와 합반', () => {
  it('한 학급에 두 교사가 드는 복수교사 수업도 함께 움직인다', async () => {
    const { buildUnits, unitKey } = await import('../src/units');
    const team: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: 'T1', klass: '1-1', subject: '과학', slot: 0, group: '팀티칭' },
        { teacher: 'T2', klass: '1-1', subject: '과학', slot: 0, group: '팀티칭' },
        { teacher: 'X', klass: '1-1', subject: '국어', slot: 1 },
      ],
    };
    expect(validate(team)).toEqual([]);
    const u = buildUnits(team).get(unitKey(team.assignments[0]!))!;
    expect(u.teachers.sort()).toEqual(['T1', 'T2']);
    expect(u.klasses).toEqual(['1-1']);

    const { candidates } = recommend(team, { teacher: 'T1', slot: 0 });
    for (const c of candidates) {
      const moved = c.changes.filter((x) => x.from.group === '팀티칭');
      // 둘 다 가거나 둘 다 남는다
      expect(moved.length === 0 || moved.length === 2).toBe(true);
    }
  });

  it('한 교사가 두 학급을 함께 맡는 합반 수업은 교사를 한 번만 센다', async () => {
    const { buildUnits, unitKey } = await import('../src/units');
    const merged: TimetableInput = {
      config: cfg,
      assignments: [
        { teacher: 'P', klass: '1-1', subject: '체육', slot: 0, group: '합반' },
        { teacher: 'P', klass: '1-2', subject: '체육', slot: 0, group: '합반' },
      ],
    };
    expect(validate(merged)).toEqual([]);
    const u = buildUnits(merged).get(unitKey(merged.assignments[0]!))!;
    expect(u.teachers).toEqual(['P']);
    expect(u.klasses.sort()).toEqual(['1-1', '1-2']);
  });
});

describe('보강 후보: 비어 있는 교사 우선순위', () => {
  it('결강 교시에 비어 있는 교사를 같은 과목, 적은 시수 순으로 돌려준다', async () => {
    const { coverCandidates } = await import('../src/cover');
    // 메인 골든 학교의 월요일 1교시(슬롯 0): A 는 결강 당사자(수업 중), B 는 2-4 수업 중
    const list = coverCandidates(school, 0, '수학');
    expect(list.map((c) => c.teacher)).toEqual(['C', 'D']);
    expect(list[0]!.weeklyLessons).toBe(2);
  });
});
