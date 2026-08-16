import { describe, expect, it } from 'vitest';
import { fromNeis, type NeisRow } from '../src/adapters/neis';

/**
 * 휴업일 판정.
 *
 * "그 학급 그날의 관측 칸이 모두 같은 값이면 휴업"이라는 규칙이 실제 특성화고 자료에서
 * 크게 어긋났다. 전공 실습을 하루 종일 편성하는 학급이 흔해서, 학교 한 곳에서
 * 41개 학급일이 휴업으로 잡혔다. 관측 칸의 18%가 수업이 아닌 것으로 버려졌다.
 *
 * 그 41건은 모두 한 학급짜리였다. 휴업일과 학년 행사는 학년이나 학교 전체를 덮는다.
 * 그래서 몇 학급에 걸쳐 있는지를 함께 본다.
 */

const YMD = ['20260601', '20260602', '20260603'];

function row(date: string, grade: string, klass: string, perio: number, text: string): NeisRow {
  return {
    SCHUL_NM: '휴업시험고등학교',
    ALL_TI_YMD: date,
    GRADE: grade,
    CLASS_NM: klass,
    PERIO: String(perio),
    ITRT_CNTNT: text,
  };
}

/** 그 학급 그날을 다섯 교시 모두 같은 값으로 채운다 */
function wholeDay(date: string, grade: string, klass: string, text: string): NeisRow[] {
  return [1, 2, 3, 4, 5].map((p) => row(date, grade, klass, p, text));
}

/** 그 학급 그날을 서로 다른 과목으로 채운다 */
function normalDay(date: string, grade: string, klass: string): NeisRow[] {
  return ['국어', '수학', '영어', '사회', '과학'].map((s, i) => row(date, grade, klass, i + 1, s));
}

describe('휴업일 판정', () => {
  it('학년 전체가 같은 값이면 휴업일이다', () => {
    const rows = [
      ...['1', '2', '3'].flatMap((k) => wholeDay(YMD[0]!, '1', k, '지방선거')),
      ...['1', '2', '3'].flatMap((k) => normalDay(YMD[1]!, '1', k)),
    ];
    const report = fromNeis(rows);
    expect(report.holidays).toEqual([YMD[0]]);
    expect(report.cells.filter((c) => c.kind === '휴업')).toHaveLength(15);
  });

  it('한 학급만 하루 종일 같은 과목이면 실습으로 본다', () => {
    // 2반만 종일 실습이고 나머지는 평범한 날이다
    const rows = [
      ...wholeDay(YMD[0]!, '2', '2', '도면해독(선반가공)'),
      ...normalDay(YMD[0]!, '2', '1'),
      ...normalDay(YMD[0]!, '2', '3'),
    ];
    const report = fromNeis(rows);
    expect(report.holidays).toEqual([]);
    expect(report.cells.every((c) => c.kind === '수업')).toBe(true);
    expect(report.base.get('2-2|0|0')).toEqual(['도면해독(선반가공)']);
  });

  it('전문교과 표시가 붙어 있으면 학년이 다 같아도 실습으로 본다', () => {
    const rows = ['1', '2'].flatMap((k) => wholeDay(YMD[0]!, '2', k, '* 용접 작업'));
    const report = fromNeis(rows);
    expect(report.holidays).toEqual([]);
    expect(report.cells.every((c) => c.kind === '수업')).toBe(true);
  });

  it('한 학년만 쉬는 날도 그 학년에서는 휴업으로 잡는다', () => {
    // 2학년만 수학여행이다. 1학년은 평소대로 수업한다.
    const rows = [
      ...['1', '2'].flatMap((k) => wholeDay(YMD[0]!, '2', k, '수학여행')),
      ...['1', '2'].flatMap((k) => normalDay(YMD[0]!, '1', k)),
    ];
    const report = fromNeis(rows);
    expect(report.holidays).toEqual([YMD[0]]);
    const off = report.cells.filter((c) => c.kind === '휴업');
    expect(new Set(off.map((c) => c.klass))).toEqual(new Set(['2-1', '2-2']));
  });

  it('한 학급만 받아 온 자료에서도 휴업일을 가른다', () => {
    // 학교 전체를 못 받아 오는 경우가 있다. 그때는 관측된 학급이 전부라 통과한다.
    const rows = [...wholeDay(YMD[0]!, '1', '1', '재량휴업일'), ...normalDay(YMD[1]!, '1', '1')];
    const report = fromNeis(rows);
    expect(report.holidays).toEqual([YMD[0]]);
  });

  it('관측 칸이 하나뿐이면 휴업으로 보지 않는다', () => {
    const rows = [row(YMD[0]!, '1', '1', 1, '국어'), ...normalDay(YMD[1]!, '1', '1')];
    expect(fromNeis(rows).holidays).toEqual([]);
  });
});
