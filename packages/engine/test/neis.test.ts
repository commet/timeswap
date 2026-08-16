import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fromNeis, neisToTimetable, dayOfYmd, type NeisRow } from '../src/adapters/neis';
import { recommend } from '../src/search';
import { validate } from '../src/timetable';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures/neis-himetable.json'), 'utf-8'),
) as { rows: NeisRow[] };

/**
 * 나이스 교육정보 개방 포털에서 실제로 받은 응답이다.
 * 수지고 1학년 1반 2026학년도 1학기에서 기준 월요일 4주, 재량휴업일 1일,
 * 보강 1건, 3교시와 4교시 맞교환 1건을 골라 담았다.
 */
describe('나이스 개방 자료 어댑터', () => {
  const report = fromNeis(fixture.rows);

  it('일자 문자열에서 요일을 센다', () => {
    expect(dayOfYmd('20260622')).toBe(0); // 월요일
    expect(dayOfYmd('20260317')).toBe(1); // 화요일
  });

  it('학교명과 교시 수를 읽는다', () => {
    expect(report.schoolName).toBe('수지고등학교');
    expect(report.config.periods).toBe(5);
    expect(report.config.days).toBe(5);
  });

  it('하루 전체가 같은 값이면 휴업일로 가른다', () => {
    expect(report.holidays).toEqual(['20260504']);
    const holidayCells = report.cells.filter((c) => c.date === '20260504');
    expect(holidayCells).toHaveLength(5);
    expect(holidayCells.every((c) => c.kind === '휴업')).toBe(true);
  });

  it('보강 표기를 떼어 내고 종류로 구분한다', () => {
    expect(report.covers).toHaveLength(1);
    const cover = report.covers[0]!;
    expect(cover.date).toBe('20260511');
    expect(cover.period).toBe(2); // 3교시
    expect(cover.subject).toBe('공통국어1'); // 표기를 뗀 실제 과목
    expect(cover.kind).toBe('보강');
  });

  it('기준 시간표를 최빈 과목으로 잡는다', () => {
    // 월요일 1교시부터 5교시까지. 한 칸에 과목 하나인 보통의 학교라 목록 길이가 모두 1이다.
    const mon = [0, 1, 2, 3, 4].map((p) => report.base.get(`1-1|0|${p}`));
    expect(mon).toEqual([['한국사1'], ['공통영어1'], ['공통국어1'], ['기술·가정'], ['과학탐구실험1']]);
  });

  it('맞교환을 찾아낸다', () => {
    expect(report.swaps).toHaveLength(1);
    const swap = report.swaps[0]!;
    expect(swap.date).toBe('20260622');
    expect(swap.klass).toBe('1-1');
    expect([swap.periodA, swap.periodB].sort()).toEqual([2, 3]); // 3교시와 4교시
    expect([swap.subjectA, swap.subjectB].sort()).toEqual(['공통국어1', '기술·가정'].sort());
  });

  it('보강은 변경 목록에 넣지 않는다', () => {
    // 보강 칸은 기준과 과목이 같으므로 교환으로 오해하면 안 된다
    const coverDayChanges = report.changes.filter((c) => c.date === '20260511');
    expect(coverDayChanges).toHaveLength(0);
  });

  it('교사 표를 주면 엔진 입력으로 바뀐다', () => {
    const teacherOf = (klass: string, subject: string): string | undefined => {
      const table: Record<string, string> = {
        한국사1: '김한국',
        공통영어1: '이영어',
        공통국어1: '박국어',
        '기술·가정': '최기가',
        과학탐구실험1: '정과학',
      };
      return klass === '1-1' ? table[subject] : undefined;
    };
    const input = neisToTimetable(report, teacherOf);
    expect(input.assignments).toHaveLength(5);
    expect(validate(input)).toEqual([]);
    expect(input.assignments.map((a) => a.teacher)).toContain('박국어');
  });

  it('되살린 시간표로 교환 탐색이 돈다', () => {
    const teacherOf = (klass: string, subject: string): string | undefined =>
      klass === '1-1' ? `${subject}교사` : undefined;
    const input = neisToTimetable(report, teacherOf);
    // 월요일 3교시 공통국어1 을 바꿀 방법을 찾는다
    const target = input.assignments.find((a) => a.subject === '공통국어1');
    expect(target).toBeDefined();
    const result = recommend(input, { teacher: target!.teacher, slot: target!.slot });
    expect(result.candidates.length).toBeGreaterThan(0);
    // 실제로 학교가 택했던 4교시 기술·가정과의 맞바꾸기가 후보에 있어야 한다
    const asSchoolDid = result.candidates.find(
      (c) => c.type === 'swap2' && c.changes.some((ch) => ch.from.subject === '기술·가정'),
    );
    expect(asSchoolDid).toBeDefined();
  });
});
