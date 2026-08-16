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

/**
 * 전문교과 실습의 보강.
 *
 * 특성화고와 마이스터고에서 결강한 자리가 전공 실습이면 아무나 대신 들어갈 수 없다.
 * 학과 전용 실습실에서 기계를 다루는 시간이라, 그 학과 교사가 아니면
 * 진도를 잇는 것이 아니라 안전을 지키는 것부터 어렵다.
 * 실측한 특성화고 13곳에서 3학년 과목의 중앙 73%가 전문교과였다. 드문 경우가 아니다.
 */
describe('전문교과 실습의 보강 후보', () => {
  const shop: TimetableInput = {
    config: cfg,
    assignments: [
      // 결강 자리: 월4(슬롯 3) 3-1 용접 작업, 전문교과
      { teacher: '결강', klass: '3-1', subject: '용접 작업', slot: 3, pro: true },
      // 다른 전문교과를 맡는 분. 과목은 다르다
      { teacher: '실습왕', klass: '3-2', subject: '선반 가공', slot: 0, pro: true },
      // 일반교과만 맡는 분. 그날이 훨씬 가볍다
      { teacher: '국어샘', klass: '3-3', subject: '문학', slot: 0 },
    ],
  };
  const list = coverCandidates(shop, 3, '용접 작업', 8, '결강');

  it('전문교과를 맡는 분을 앞에 둔다', () => {
    expect(list[0]?.teacher).toBe('실습왕');
    expect(list[0]?.proTeacher).toBe(true);
  });

  it('일반교과만 맡는 분께는 어렵다고 밝힌다', () => {
    const 국어샘 = list.find((c) => c.teacher === '국어샘');
    expect(국어샘?.proTeacher).toBe(false);
    expect(국어샘?.notes.join(' ')).toContain('전문교과 실습이라');
  });

  it('그래도 후보에서 빼지는 않는다', () => {
    // 아무도 없으면 자습 감독이 현실의 답이다. 감추면 그 사실을 알 길이 없다.
    expect(list.map((c) => c.teacher)).toContain('국어샘');
  });

  it('일반교과 결강에는 이 규칙이 걸리지 않는다', () => {
    const normal = coverCandidates(shop, 3, '문학', 8, '결강');
    for (const c of normal) expect(c.notes.join(' ')).not.toContain('전문교과 실습이라');
  });
});
