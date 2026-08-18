import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classIdentityKey,
  normalizeNeisRows,
  type NeisRow,
} from '../src/adapters/neis-normalize';
import { fromNeis } from '../src/adapters/neis';

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
