import { describe, expect, it } from 'vitest';
import { fromNeis, normalizeNeisRows, type NeisRow } from '@timeswap/engine';
import { createWorkspaceFromNeis, type NeisLoadBundle } from '../components/SetupFlow';
import { mapKey } from '../lib/app';

/**
 * 시간표에 온 휴업일을 수업으로 만들지 않는지.
 *
 * 학교가 쉬는 날에도 나이스는 그 교시 자리에 "재량휴업일", "기타활동" 같은 문구를
 * 넣어 돌려준다. 그대로 수업으로 만들면 설정 화면이 "재량휴업일"의 담당 교사를
 * 채우라고 하고, 학급 공개 시간표에도 과목처럼 뜬다. 실측한 154곳 가운데 한 곳은
 * 고른 주 닷새 가운데 나흘이 그런 날이었다.
 *
 * 엔진의 휴업 판정은 그 학급 그날의 칸이 모두 같은 값이고 같은 학년의 다른 학급도
 * 모두 그럴 때만 걸린다. 실측 51건이 모두 그 학급의 하루 전체였고 일부만 걸린 경우는
 * 하나도 없었다. 그래서 빼도 멀쩡한 수업이 함께 날아가지 않는다.
 */
const row = (date: string, className: string, period: string, subject: string): NeisRow => ({
  ALL_TI_YMD: date,
  GRADE: '1',
  CLASS_NM: className,
  PERIO: period,
  ITRT_CNTNT: subject,
  SD_SCHUL_CODE: '7010536',
  AY: '2026',
  DGHT_CRSE_SC_NM: '주간',
  ORD_SC_NM: '',
  DDDEP_NM: '',
  CLRM_NM: '',
} as unknown as NeisRow);

/** 월요일은 두 학급 모두 하루 종일 재량휴업일, 화요일은 보통 수업. */
function rows(): NeisRow[] {
  const out: NeisRow[] = [];
  for (const className of ['1', '2']) {
    for (let period = 1; period <= 4; period += 1) {
      out.push(row('20260817', className, String(period), '재량휴업일'));
    }
    for (const [index, subject] of ['국어', '수학', '영어', '과학'].entries()) {
      out.push(row('20260818', className, String(index + 1), subject));
    }
  }
  return out;
}

function build(source: NeisRow[]): ReturnType<typeof createWorkspaceFromNeis> {
  const normalization = normalizeNeisRows(source);
  const bundle = {
    school: { code: '7010536', name: '예시중학교', office: 'J10', kind: '중학교' },
    rows: source,
    events: [],
    range: { from: '20260817', to: '20260821' },
    result: { complete: true, checksum: 'sha256:test' },
    report: fromNeis(source),
  } as unknown as NeisLoadBundle;
  const map = Object.fromEntries(
    normalization.accepted.map((accepted) => [mapKey(accepted.classKey, accepted.subject), '김교사']),
  );
  return createWorkspaceFromNeis(bundle, map, '2026-08-18T00:00:00.000Z');
}

describe('시간표에 온 휴업일', () => {
  it('수업으로 만들지 않는다', () => {
    const state = build(rows());
    expect(state.lessons.some((lesson) => lesson.subject === '재량휴업일')).toBe(false);
    expect(state.lessons.map((lesson) => lesson.date)).not.toContain('2026-08-17');
  });

  it('그날 수업은 그대로 남는다', () => {
    const state = build(rows());
    // 빼는 규칙이 멀쩡한 수업까지 걷어 가면 안 된다.
    expect(state.lessons).toHaveLength(8);
    expect([...new Set(state.lessons.map((lesson) => lesson.subject))].sort())
      .toEqual(['과학', '국어', '수학', '영어']);
  });

  it('쉬는 날로 남긴다', () => {
    const closures = build(rows()).revisions[0]?.closures ?? [];
    const holiday = closures.find((closure) => closure.date === '2026-08-17');
    expect(holiday?.reason).toBe('재량휴업일');
    expect(holiday?.classIdentities?.map((identity) => identity.className).sort()).toEqual(['1', '2']);
  });

  it('휴업일이 없는 학교는 아무것도 달라지지 않는다', () => {
    const only = rows().filter((item) => item.ALL_TI_YMD === '20260818');
    const state = build(only);
    expect(state.lessons).toHaveLength(8);
    expect(state.revisions[0]?.closures ?? []).toEqual([]);
  });
});
