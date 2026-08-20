import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classIdentityKey,
  normalizeNeisRows,
  type NeisRow,
} from '../src/adapters/neis-normalize';
import { fromNeis, neisToTimetable } from '../src/adapters/neis';

const here = dirname(fileURLToPath(import.meta.url));
const dataQualityFixture = JSON.parse(
  readFileSync(join(here, 'fixtures/neis-data-quality.json'), 'utf-8'),
) as { metadata: { source: string; retrievedAt: string }; rows: NeisRow[] };

const row = (overrides: Partial<NeisRow> = {}): NeisRow => ({
  ATPT_OFCDC_SC_CODE: 'B10',
  SD_SCHUL_CODE: '7010536',
  AY: '2026',
  DGHT_CRSE_SC_NM: '주간',
  ORD_SC_NM: '공업계',
  DDDEP_NM: '기계과',
  ALL_TI_YMD: '20260622',
  GRADE: '2',
  CLASS_NM: '1',
  PERIO: '1',
  ITRT_CNTNT: '기계일반',
  CLRM_NM: '실습실',
  ...overrides,
});

describe('NEIS normalization', () => {
  it('keeps same-named vocational classes separate by affiliation and major', () => {
    const report = normalizeNeisRows([
      row({ ORD_SC_NM: '공업계', DDDEP_NM: '기계과', GRADE: '2', CLASS_NM: '1' }),
      row({ ORD_SC_NM: '공업계', DDDEP_NM: '건축과', GRADE: '2', CLASS_NM: '1' }),
    ]);

    expect(new Set(report.accepted.map((item) => item.classKey)).size).toBe(2);
    expect(
      classIdentityKey({
        schoolCode: '7010536',
        academicYear: '2026',
        schoolCourse: '',
        dayCourse: '주간',
        affiliation: '공업계',
        major: '기계과',
        grade: '2',
        className: '1',
      }),
    ).not.toBe(
      classIdentityKey({
        schoolCode: '7010536',
        academicYear: '2026',
        schoolCourse: '',
        dayCourse: '주간',
        affiliation: '공업계',
        major: '건축과',
        grade: '2',
        className: '1',
      }),
    );
  });

  it('quarantines rows missing a required lesson fact field', () => {
    const report = normalizeNeisRows([row({ PERIO: '' })]);

    expect(report.quarantined[0]?.missing).toContain('PERIO');
  });

  it('collapses byte-equivalent lesson facts', () => {
    const report = normalizeNeisRows([row(), row()]);

    expect(report.accepted).toHaveLength(1);
    expect(report.duplicateCount).toBe(1);
  });

  it('retains true parallel lessons and reports their source rows', () => {
    const report = normalizeNeisRows([
      row({ ITRT_CNTNT: '기계일반' }),
      row({ ITRT_CNTNT: '기계제도' }),
    ]);

    expect(report.accepted).toHaveLength(2);
    expect(report.parallelGroups).toHaveLength(1);
    expect(report.parallelGroups[0]?.rowIds).toEqual(
      report.accepted.map((item) => item.id),
    );
  });

  it('feeds normalized class keys and diagnostics into the existing NEIS report', () => {
    const rows = [
      row({ DDDEP_NM: '기계과', ITRT_CNTNT: '기계일반' }),
      row({ DDDEP_NM: '건축과', ITRT_CNTNT: '건축일반' }),
      row({ PERIO: '' }),
    ];
    const report = fromNeis(rows);

    expect(new Set(report.cells.map((cell) => cell.klass)).size).toBe(2);
    expect(report.normalization.accepted).toHaveLength(2);
    expect(report.normalization.quarantined).toHaveLength(1);
  });

  it('keeps canonical engine identities distinct across separate imports', () => {
    const mechanics = fromNeis([row({ DDDEP_NM: '기계과' })]);
    const architecture = fromNeis([row({ DDDEP_NM: '건축과' })]);

    expect(mechanics.cells[0]?.klass).not.toBe(architecture.cells[0]?.klass);
    expect(mechanics.cells[0]?.classLabel).toBe('2-1');
    expect(architecture.cells[0]?.classLabel).toBe('2-1');
  });

  it('uses canonical identities when resolving teachers for colliding classes', () => {
    const report = fromNeis([
      row({ DDDEP_NM: '기계과', ITRT_CNTNT: '기계일반' }),
      row({ DDDEP_NM: '건축과', ITRT_CNTNT: '건축일반' }),
    ]);
    const teacherOf = new Map(report.cells.map((cell, index) => [cell.klass, `교사${index}`]));

    const input = neisToTimetable(report, (klass) => teacherOf.get(klass));

    expect(input.assignments).toHaveLength(2);
    expect(new Set(input.assignments.map((assignment) => assignment.teacher))).toEqual(
      new Set(['교사0', '교사1']),
    );
  });

  it('regresses public data quality cases without needing an API credential', () => {
    const report = normalizeNeisRows(dataQualityFixture.rows);

    expect(dataQualityFixture.metadata.source).toBeTruthy();
    expect(dataQualityFixture.metadata.retrievedAt).toBe('2026-08-18');
    expect(report.accepted).toHaveLength(6);
    expect(report.duplicateCount).toBe(1);
    expect(report.parallelGroups).toHaveLength(1);
    expect(new Set(report.accepted.slice(0, 2).map((item) => item.classKey)).size).toBe(2);
  });
});

/**
 * 특수학교는 초등부와 중학부, 고등부를 한 학교에서 운영하고 학년이 과정마다 1부터
 * 다시 센다. 과정을 학급 열쇠에 안 넣으면 세 학급이 하나로 합쳐진다.
 *
 * 실제 특수학교 32곳 가운데 31곳에서 (학년, 반)이 여러 과정에 걸쳤고, 한 칸에 서로
 * 다른 과목이 겹치는 자리가 6,028곳이었다. 합쳐지면 학급 13개에 배정 626개가 되는데
 * 한 주가 5일 곱하기 7교시로 35칸이라 있을 수 없는 시간표다. 그런데도 엔진은 그
 * 겹침을 분반으로 읽어 유효하다고 통과시켰다. 오류가 아니라 조용히 틀린 시간표였다.
 */
describe('특수학교의 학교 과정', () => {
  it('과정이 다르면 같은 학년 같은 반이라도 다른 학급이다', () => {
    const report = normalizeNeisRows([
      row({ SCHUL_CRSE_SC_NM: '초등학교', GRADE: '1', CLASS_NM: '1', ITRT_CNTNT: '국어' }),
      row({ SCHUL_CRSE_SC_NM: '중학교', GRADE: '1', CLASS_NM: '1', ITRT_CNTNT: '수학' }),
      row({ SCHUL_CRSE_SC_NM: '고등학교', GRADE: '1', CLASS_NM: '1', ITRT_CNTNT: '영어' }),
    ]);
    expect(new Set(report.accepted.map((item) => item.classKey)).size).toBe(3);
    // 셋이 같은 칸을 나눠 쓰는 분반으로 읽히면 안 된다
    expect(report.parallelGroups).toEqual([]);
  });

  it('과정이 없는 학교급에서는 값이 달라지지 않는다', () => {
    const withoutCourse = normalizeNeisRows([row({ GRADE: '1', CLASS_NM: '1' })]);
    expect(withoutCourse.accepted[0]?.classIdentity.schoolCourse).toBe('');
  });
});

/**
 * 학급에 매이지 않는 강좌.
 *
 * 고교학점제 선택과목은 수강생이 여러 학급에서 모여 반 번호를 붙일 자리가 없다.
 * 나이스는 `CLASS_NM` 을 비운 채로 그 수업을 준다. 강의실은 `3탐구` 같은 교과교실이다.
 *
 * 이것을 결손으로 보고 격리하고 있었고, 완전성 관문이 격리 0을 요구했다.
 * 그래서 고등학교 217곳 가운데 127곳(59%)이 설정을 끝낼 수 없었다.
 * 한 학교는 행의 77%가 이것이라 시간표의 4분의 1만 보였다.
 * 3학년 8,576행, 2학년 5,648행으로 고교학점제 학년에 몰려 있다.
 */
describe('학급에 매이지 않는 강좌', () => {
  it('반 번호만 없으면 결손이 아니라 강좌로 본다', () => {
    const report = normalizeNeisRows([
      row({ GRADE: '3', CLASS_NM: null as unknown as string, ITRT_CNTNT: '미적분', CLRM_NM: '3탐구' }),
    ]);
    expect(report.quarantined).toEqual([]);
    expect(report.courseOnly).toHaveLength(1);
    expect(report.accepted).toEqual([]);
  });

  it('과목까지 없으면 그대로 격리한다', () => {
    const report = normalizeNeisRows([
      row({ GRADE: '3', CLASS_NM: null as unknown as string, ITRT_CNTNT: '' }),
    ]);
    expect(report.courseOnly).toEqual([]);
    expect(report.quarantined).toHaveLength(1);
    expect(report.quarantined[0]?.missing).toContain('ITRT_CNTNT');
  });

  it('교시나 날짜가 없으면 그대로 격리한다', () => {
    const report = normalizeNeisRows([
      row({ GRADE: '3', CLASS_NM: null as unknown as string, PERIO: '' }),
      row({ GRADE: '3', CLASS_NM: '1', ALL_TI_YMD: '' }),
    ]);
    expect(report.courseOnly).toEqual([]);
    expect(report.quarantined).toHaveLength(2);
  });

  it('보통 수업은 그대로 받는다', () => {
    const report = normalizeNeisRows([row({ GRADE: '1', CLASS_NM: '3', ITRT_CNTNT: '국어' })]);
    expect(report.courseOnly).toEqual([]);
    expect(report.accepted).toHaveLength(1);
  });
});
