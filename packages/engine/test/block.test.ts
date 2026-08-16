import { describe, expect, it } from 'vitest';
import type { TimetableInput } from '../src/types';
import { recommend } from '../src/search';
import { WEIGHTS } from '../src/score';

/**
 * 이어 붙은 같은 과목 덩어리를 쪼개는 안을 뒤로 민다.
 *
 * 학교 14곳을 재어 넣은 규칙이다. 학급 하루 안에서 같은 과목이 이어진 길이를 셌다.
 *
 * | 무리 | 학교 | 덩어리 안 수업 칸 | 길이 3 이상인 덩어리 |
 * |---|---|---|---|
 * | 일반고 | 10곳 | 3.5% | 0개 |
 * | 마이스터고와 예술고 | 4곳 | 23~58% | 164개 |
 *
 * 일반고에서는 길이 3 이상이 하나도 나오지 않았다. 직업계에서는 절반 가까이가
 * 덩어리 안에 있다. 실습은 앞 시간에 준비하고 뒤 시간에 만들기 때문이다.
 * 그 가운데 한 교시만 다른 날로 보내는 안은 표 위에서만 성립한다.
 */

// 2일 x 6교시. 월1=0 … 월6=5, 화1=6 … 화6=11
const cfg = { days: 2, periods: 6, dayNames: ['월', '화'] };

/**
 * 3-1 은 월요일 1~3교시가 실습 덩어리이고 4교시는 문학이다.
 * 화요일은 1~4교시가 각각 다른 과목이라 옮길 자리가 넉넉하다.
 */
function school(): TimetableInput {
  return {
    config: cfg,
    assignments: [
      { teacher: '실습샘', klass: '3-1', subject: '용접 작업', slot: 0, pro: true },
      { teacher: '실습샘', klass: '3-1', subject: '용접 작업', slot: 1, pro: true },
      { teacher: '실습샘', klass: '3-1', subject: '용접 작업', slot: 2, pro: true },
      { teacher: '문학샘', klass: '3-1', subject: '문학', slot: 3 },
      { teacher: '수학샘', klass: '3-1', subject: '수학', slot: 6 },
      { teacher: '영어샘', klass: '3-1', subject: '영어', slot: 7 },
      { teacher: '사회샘', klass: '3-1', subject: '사회', slot: 8 },
      { teacher: '과학샘', klass: '3-1', subject: '과학', slot: 9 },
    ],
  };
}

/** 그 후보의 감점 항목 가운데 덩어리를 쪼갠다는 것 */
function splitNote(trace: Array<{ text: string }>): string | undefined {
  return trace.find((t) => t.text.includes('이어진 수업인데'))?.text;
}

describe('이어 붙은 덩어리', () => {
  it('가운데 교시를 떼어 내면 그 사실을 근거에 적는다', () => {
    // 월2교시(슬롯 1)는 3교시 덩어리의 한가운데다
    const { candidates } = recommend(school(), { teacher: '실습샘', slot: 1 });
    const away = candidates.filter((c) => c.changes.some((ch) => ch.from.slot === 1 && ch.toSlot >= 6));
    expect(away.length).toBeGreaterThan(0);
    for (const c of away) {
      expect(splitNote(c.trace)).toContain('3교시가 이어진 수업');
    }
  });

  it('전문교과이면 과목명 대신 실습이라 적는다', () => {
    const { candidates } = recommend(school(), { teacher: '실습샘', slot: 1 });
    const note = candidates.map((c) => splitNote(c.trace)).find(Boolean);
    expect(note).toContain('전문교과 실습');
  });

  it('덩어리 길이만큼 무겁게 깎는다', () => {
    const { candidates } = recommend(school(), { teacher: '실습샘', slot: 1 });
    const hit = candidates.find((c) => splitNote(c.trace) !== undefined)!;
    const entry = hit.trace.find((t) => t.text.includes('이어진 수업인데'))!;
    // 길이 3 이면 남는 교시가 2개다
    expect(entry.points).toBe(WEIGHTS.blockSplit * 2);
  });

  it('같은 날 덩어리 끝에 다시 붙는 이동은 쪼개는 것으로 보지 않는다', () => {
    // 1, 2, 3교시 실습에서 1교시를 4교시로 보내면 2, 3, 4교시가 된다. 길이가 그대로다.
    const { candidates } = recommend(school(), { teacher: '실습샘', slot: 0 });
    const toFourth = candidates.find((c) =>
      c.changes.some((ch) => ch.from.slot === 0 && ch.toSlot === 3),
    );
    expect(toFourth).toBeDefined();
    expect(splitNote(toFourth!.trace)).toBeUndefined();
  });

  it('덩어리가 아닌 수업은 이 감점을 받지 않는다', () => {
    const { candidates } = recommend(school(), { teacher: '문학샘', slot: 3 });
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) expect(splitNote(c.trace)).toBeUndefined();
  });

  it('쪼개는 안이 있어도 아예 빼지는 않는다', () => {
    // 정말 방법이 없을 때는 쪼개서라도 메우는 것이 결손보다 낫다. 판단은 선생님 몫이다.
    const { candidates } = recommend(school(), { teacher: '실습샘', slot: 1 });
    expect(candidates.some((c) => splitNote(c.trace) !== undefined)).toBe(true);
  });

  it('쪼개지 않는 안이 있으면 그쪽이 앞에 온다', () => {
    const { candidates } = recommend(school(), { teacher: '실습샘', slot: 0 });
    const firstSplit = candidates.findIndex((c) => splitNote(c.trace) !== undefined);
    const firstWhole = candidates.findIndex((c) => splitNote(c.trace) === undefined);
    expect(firstWhole).toBeGreaterThanOrEqual(0);
    if (firstSplit >= 0) expect(firstWhole).toBeLessThan(firstSplit);
  });
});
