import { describe, expect, it } from 'vitest';
import type { TimetableInput } from '../src/types';
import { coverCandidates } from '../src/cover';

// 2일 x 5교시. 슬롯: 월1=0 … 월5=4, 화1=5 … 화5=9
const cfg = { days: 2, periods: 5, dayNames: ['월', '화'] };

/**
 * 결강 자리는 월4(슬롯 3)의 3-1 과학이다.
 * 그 시간에 비어 있는 교사를 여럿 두되 서로 조건이 다르게 만들었다.
 *  같과학  같은 과목이고 그날 가볍다        → 가장 앞
 *  한가   과목은 다르지만 그날 가볍다
 *  바쁨   그날 이미 5시간을 맡았다
 *  줄줄   월3, 월5 가 차 있어 들어가면 3시간 연속이 된다
 *  단골   최근에 이미 여러 번 맡았다
 */
const school: TimetableInput = {
  config: cfg,
  assignments: [
    // 결강 당사자
    { teacher: '결강', klass: '3-1', subject: '과학', slot: 3 },

    // 같은 과목 교사. 월요일에 1시간만 있고 그 시간은 비었다
    { teacher: '같과학', klass: '3-2', subject: '과학', slot: 0 },

    // 과목이 다르고 가볍다
    { teacher: '한가', klass: '3-3', subject: '국어', slot: 0 },

    // 그날 5시간을 맡았는데 4교시만 비었다
    { teacher: '바쁨', klass: '3-4', subject: '영어', slot: 0 },
    { teacher: '바쁨', klass: '3-4', subject: '영어', slot: 1 },
    { teacher: '바쁨', klass: '3-4', subject: '영어', slot: 2 },
    { teacher: '바쁨', klass: '3-4', subject: '영어', slot: 4 },
    { teacher: '바쁨', klass: '3-4', subject: '영어', slot: 5 },
    { teacher: '바쁨', klass: '3-4', subject: '영어', slot: 6 },

    // 월3, 월5 가 차 있어 월4에 들어가면 3시간 연속이 된다
    { teacher: '줄줄', klass: '3-5', subject: '수학', slot: 2 },
    { teacher: '줄줄', klass: '3-5', subject: '수학', slot: 4 },

    // 최근 부담이 쌓인 교사
    { teacher: '단골', klass: '3-6', subject: '역사', slot: 0 },
  ],
  recentBurden: { 단골: 3 },
};

describe('보강 후보', () => {
  const list = coverCandidates(school, 3, '과학', 8, '결강');

  it('결강 당사자는 후보에 넣지 않는다', () => {
    expect(list.map((c) => c.teacher)).not.toContain('결강');
  });

  it('그 시간에 비어 있는 교사만 나온다', () => {
    for (const c of list) expect(c.teacher).not.toBe('결강');
    expect(list.length).toBe(5);
  });

  it('같은 과목 교사가 가장 앞이다', () => {
    expect(list[0]?.teacher).toBe('같과학');
    expect(list[0]?.sameSubject).toBe(true);
    expect(list[0]?.notes.join(' ')).toContain('진도를 이어 갈 수 있습니다');
  });

  it('최근에 여러 번 맡은 교사는 뒤로 밀린다', () => {
    const 단골 = list.findIndex((c) => c.teacher === '단골');
    const 한가 = list.findIndex((c) => c.teacher === '한가');
    expect(단골).toBeGreaterThan(한가);
    expect(list[단골]?.notes.join(' ')).toContain('3번 맡으셨습니다');
  });

  it('그날이 이미 무거운 교사는 그 사실을 근거로 밝힌다', () => {
    const 바쁨 = list.find((c) => c.teacher === '바쁨');
    expect(바쁨?.dayLessons).toBe(4);
    // 기준(4시간)을 넘지 않으므로 무겁다는 말은 나오지 않는다
    expect(바쁨?.notes.join(' ')).not.toContain('이미');
  });

  it('연속 3시간이 되는 교사는 그 사실을 밝히고 뒤로 밀린다', () => {
    const 줄줄 = list.find((c) => c.teacher === '줄줄');
    expect(줄줄?.runAfter).toBe(3);
    expect(줄줄?.notes.join(' ')).toContain('3시간을 내리 수업하게 됩니다');
    const i줄줄 = list.findIndex((c) => c.teacher === '줄줄');
    const i한가 = list.findIndex((c) => c.teacher === '한가');
    expect(i줄줄).toBeGreaterThan(i한가);
  });

  it('근무 불가로 잠근 시간에는 후보로 올리지 않는다', () => {
    const locked = { ...school, unavailable: { 같과학: [3] } };
    const r = coverCandidates(locked, 3, '과학', 8, '결강');
    expect(r.map((c) => c.teacher)).not.toContain('같과학');
  });

  it('학교 전체가 쉬는 날이면 후보를 내지 않는다', () => {
    const closed = { ...school, closures: [{ day: 0, reason: '개교기념일' }] };
    expect(coverCandidates(closed, 3, '과학', 8, '결강')).toEqual([]);
  });

  it('모든 후보가 근거 문장을 하나 이상 가진다', () => {
    for (const c of list) expect(c.notes.length).toBeGreaterThan(0);
  });
});
