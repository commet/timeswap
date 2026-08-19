import { describe, expect, it } from 'vitest';
import { fromNeis, neisToTimetable, stripMarks, type NeisRow } from '../src/adapters/neis';
import { buildUnits } from '../src/units';
import { recommend } from '../src/search';
import { validate } from '../src/timetable';

/**
 * 나이스 자료의 과목명에 붙어 오는 표시를 다룬다.
 *
 * 학교 37곳을 받아 보고 알게 된 두 가지를 잠근다.
 *
 * 1. 별표는 전문교과 실습이다. 일반고 12곳은 0%, 특성화고 10곳은 칸의 14~34%였다.
 *    떼지 않으면 화면에 별표가 그대로 나오고, 교사 배정표가 과목명을 열쇠로 쓰므로
 *    같은 과목이 표시 유무로 갈릴 수 있다.
 * 2. 한 칸에 과목이 둘 오는 학교가 있다. 예술 계열에서 전공 실기를 나눠 편성한 자리다.
 *    국립전통예술고 15%, 울산예술고 5%였고 나머지 학교는 0%였다.
 *    많이 나온 하나만 남기면 그 학급 시간표의 절반이 사라진다.
 */

const YMD = ['20260601', '20260608', '20260615']; // 월요일 세 주

function row(date: string, grade: string, klass: string, perio: number, text: string): NeisRow {
  return {
    SCHUL_NM: '표시시험고등학교',
    ALL_TI_YMD: date,
    GRADE: grade,
    CLASS_NM: klass,
    PERIO: String(perio),
    ITRT_CNTNT: text,
  };
}

const classKey = (report: ReturnType<typeof fromNeis>, label: string): string =>
  report.cells.find((cell) => cell.classLabel === label)?.klass ?? label;

describe('과목명 앞 표시 떼기', () => {
  it('별표를 떼고 전문교과로 표시한다', () => {
    expect(stripMarks('* 도면해독(선반가공)')).toEqual({
      subject: '도면해독(선반가공)',
      cover: false,
      pro: true,
    });
  });

  it('보강과 별표가 겹쳐 와도 둘 다 뗀다', () => {
    // 실제 자료의 형태다. 보강 표시가 앞, 전문교과 표시가 뒤에 온다.
    expect(stripMarks('[보강]* 실내건축설계 기획')).toEqual({
      subject: '실내건축설계 기획',
      cover: true,
      pro: true,
    });
  });

  it('표시가 없으면 그대로 둔다', () => {
    expect(stripMarks(' 공통국어1 ')).toEqual({ subject: '공통국어1', cover: false, pro: false });
  });

  it('별표를 뗀 이름으로 기준 시간표를 잡는다', () => {
    const rows = YMD.flatMap((d) => [
      row(d, '2', '1', 1, '* 용접 작업'),
      row(d, '2', '1', 2, '문학'),
    ]);
    const report = fromNeis(rows);
    const key = classKey(report, '2-1');
    expect(report.base.get(`${key}|0|0`)).toEqual(['용접 작업']);
    expect(report.proKeys.has(`${key}|0|0`)).toBe(true);
    expect(report.proKeys.has(`${key}|0|1`)).toBe(false);
    expect(report.proRate).toBeCloseTo(0.5, 5);
  });

  it('전문교과 표시가 배정까지 따라간다', () => {
    const rows = YMD.flatMap((d) => [
      row(d, '2', '1', 1, '* 용접 작업'),
      row(d, '2', '1', 2, '문학'),
    ]);
    const input = neisToTimetable(fromNeis(rows), (_k, s) => `${s}교사`);
    const weld = input.assignments.find((a) => a.subject === '용접 작업');
    const lit = input.assignments.find((a) => a.subject === '문학');
    expect(weld?.pro).toBe(true);
    expect(lit?.pro).toBeUndefined();
  });
});

describe('한 칸에 과목이 둘인 학교', () => {
  /** 2학년 1반 1교시가 실기 둘로 나뉘고, 2교시는 학급 전체가 함께 듣는다 */
  const split = (): NeisRow[] =>
    YMD.flatMap((d) => [
      row(d, '2', '1', 1, '전공실기(가야금)'),
      row(d, '2', '1', 1, '전공실기(대금)'),
      row(d, '2', '1', 2, '문학'),
    ]);

  it('둘 다 기준 시간표에 남긴다', () => {
    const report = fromNeis(split());
    const key = classKey(report, '2-1');
    expect(report.base.get(`${key}|0|0`)).toEqual(['전공실기(가야금)', '전공실기(대금)']);
    expect(report.base.get(`${key}|0|1`)).toEqual(['문학']);
  });

  it('나뉜 두 수업을 한 묶음으로 묶는다', () => {
    const input = neisToTimetable(fromNeis(split()), (_k, s) => `${s}교사`);
    const first = input.assignments.filter((a) => a.slot === 0);
    expect(first).toHaveLength(2);
    expect(first[0]!.group).toBeDefined();
    expect(first[0]!.group).toBe(first[1]!.group);
    // 같은 학급 같은 교시라도 한 묶음이면 시간표가 성립한다
    expect(validate(input)).toEqual([]);
    const units = buildUnits(input);
    const unit = [...units.values()].find((u) => u.slot === 0);
    expect(unit?.assignments).toHaveLength(2);
    expect(unit?.grouped).toBe(true);
  });

  it('나뉜 수업은 한쪽만 옮기는 안이 나오지 않는다', () => {
    const rows = [
      ...split(),
      ...YMD.flatMap((d) => [row(d, '2', '1', 3, '수학'), row(d, '2', '1', 4, '영어')]),
    ];
    const input = neisToTimetable(fromNeis(rows), (_k, s) => `${s}교사`);
    const target = input.assignments.find((a) => a.subject === '전공실기(가야금)')!;
    const { candidates } = recommend(input, { teacher: target.teacher, slot: target.slot });
    for (const c of candidates) {
      const moved = c.changes.filter((ch) => ch.from.slot === 0);
      // 그 교시를 건드리는 안이면 나뉜 둘을 함께 옮겨야 한다
      expect(moved.length === 0 || moved.length === 2).toBe(true);
    }
  });

  it('분반과 합반이 한 자리에서 만나도 한 덩어리로 묶는다', () => {
    // 실제 특성화고 자료에서 나온 모양이다.
    // 3-6 이 두 강좌로 나뉘는데, 그중 한 강좌를 맡는 분이 같은 교시에 3-5 도 맡고 있었다.
    // 따로 묶으면 두 조각으로 갈리고 학급 중복과 교사 중복 검사에 걸린다.
    const rows = YMD.flatMap((d) => [
      row(d, '3', '6', 1, '건축설계 도서작성'),
      row(d, '3', '6', 1, '실내건축설계 기획'),
      row(d, '3', '5', 1, '건축설계 도서작성'),
      row(d, '3', '5', 2, '문학'),
      row(d, '3', '6', 2, '문학'),
    ]);
    const input = neisToTimetable(fromNeis(rows), (_k, s) =>
      s === '실내건축설계 기획' ? '실샘' : s === '건축설계 도서작성' ? '건샘' : '문샘',
    );
    const first = input.assignments.filter((a) => a.slot === 0);
    expect(first).toHaveLength(3);
    expect(new Set(first.map((a) => a.group)).size).toBe(1);
    expect(first[0]!.group).toBeDefined();
    expect(validate(input)).toEqual([]);
    // 한 사람이 두 자리에 있지만 한 덩어리라 동명이인이 아니다
    expect(input.conflicts).toEqual([]);
  });

  it('한 번 스친 과목은 분반이 아니라 변경으로 본다', () => {
    // 세 주 가운데 한 주만 다른 과목이 왔다. 시간표가 그날 바뀐 것이다.
    const rows = [
      row(YMD[0]!, '2', '1', 1, '문학'),
      row(YMD[1]!, '2', '1', 1, '문학'),
      row(YMD[2]!, '2', '1', 1, '체육'),
      ...YMD.map((d) => row(d, '2', '1', 2, '수학')),
    ];
    const report = fromNeis(rows);
    expect(report.base.get(`${classKey(report, '2-1')}|0|0`)).toEqual(['문학']);
    expect(report.changes.map((c) => c.actual)).toEqual(['체육']);
  });
});
