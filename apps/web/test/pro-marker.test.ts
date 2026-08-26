import { describe, expect, it } from 'vitest';
import { fromNeis, normalizeNeisRows, type NeisRow } from '@timeswap/engine';
import { createWorkspaceFromNeis, type NeisLoadBundle } from '../components/SetupFlow';
import { targetWeekInput } from '../lib/resolution';
import { mapKey } from '../lib/app';

/**
 * 전문교과 실습 표시가 나이스에서 엔진까지 가는지.
 *
 * 나이스는 전문교과 실습 과목명 앞에 별표를 붙여 준다. 학과 전용 실습실에서 그 학과
 * 교사만 맡는 수업이라 아무나 대신 들어갈 수 없고, 엔진은 이 표시로 보강 후보에서
 * 전공 교사를 가린다.
 *
 * 그런데 작업 공간의 `Lesson` 에 이 항목이 없어서 설정 단계에서 표시가 버려졌다.
 * 엔진까지 못 가니 `proTeachers` 가 늘 비었고, 특성화고에서 전공이 아닌 분이 실습
 * 보강 후보로 나왔다. 실측에서 특성화고 10곳은 수업 칸의 14~34%가 이 표시였다.
 */
const row = (period: string, subject: string): NeisRow => ({
  ALL_TI_YMD: '20260818',
  GRADE: '2',
  CLASS_NM: '1',
  PERIO: period,
  ITRT_CNTNT: subject,
  SD_SCHUL_CODE: '7010536',
  AY: '2026',
  DGHT_CRSE_SC_NM: '주간',
  ORD_SC_NM: '공업계',
  DDDEP_NM: '기계과',
  CLRM_NM: '실습실-1',
} as unknown as NeisRow);

function build(rows: NeisRow[]): ReturnType<typeof createWorkspaceFromNeis> {
  const bundle = {
    school: { code: '7010536', name: '예시공업고등학교', office: 'J10', kind: '고등학교' },
    rows,
    events: [],
    range: { from: '20260817', to: '20260821' },
    result: { complete: true, checksum: 'sha256:test' },
    report: fromNeis(rows),
  } as unknown as NeisLoadBundle;
  const map = Object.fromEntries(
    normalizeNeisRows(rows).accepted.map((accepted) => [mapKey(accepted.classKey, accepted.subject), '김실습']),
  );
  return createWorkspaceFromNeis(bundle, map, '2026-08-18T00:00:00.000Z');
}

describe('전문교과 실습 표시', () => {
  it('별표가 붙은 수업만 표시를 단다', () => {
    const state = build([row('1', '*기계실습'), row('2', '국어')]);
    const marked = state.lessons.filter((lesson) => lesson.pro).map((lesson) => lesson.subject);
    expect(marked).toEqual(['기계실습']);
  });

  it('과목명에는 별표를 남기지 않는다', () => {
    const state = build([row('1', '*기계실습')]);
    // 화면에 별표가 그대로 보이면 안 된다. 표시는 항목으로 옮기고 이름은 깨끗이 둔다.
    expect(state.lessons[0]?.subject).toBe('기계실습');
  });

  it('엔진에 넘기는 시간표까지 표시가 간다', () => {
    const state = build([row('1', '*기계실습'), row('2', '국어')]);
    const { input } = targetWeekInput(state, '2026-08-18');
    const pro = input.assignments.filter((assignment) => assignment.pro).map((x) => x.subject);
    expect(pro).toEqual(['기계실습']);
  });

  it('표시가 없는 학교는 아무것도 달지 않는다', () => {
    const state = build([row('1', '국어'), row('2', '수학')]);
    expect(state.lessons.some((lesson) => lesson.pro)).toBe(false);
    const { input } = targetWeekInput(state, '2026-08-18');
    expect(input.assignments.some((assignment) => assignment.pro)).toBe(false);
  });
});
