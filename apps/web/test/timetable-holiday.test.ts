import { describe, expect, it } from 'vitest';
import { fromNeis, normalizeNeisRows, type NeisRow } from '@timeswap/engine';
import { createWorkspaceFromNeis, type NeisLoadBundle } from '../components/SetupFlow';
import { mapKey } from '../lib/app';
import { emptyReason } from '../components/PublicClassTimetable';
import { projectOpsDashboard, projectPublicClassSchedule } from '../lib/projections';
import { DataHealthPanel } from '../components/DataHealthPanel';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { classIdentityKey } from '@timeswap/engine';

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

describe('쉬는 날에 왜 비었는지 적는다', () => {
  const closedDays = [{ date: '2026-08-17', note: '재량휴업일' }];

  it('오늘이 쉬는 날이면 사유를 적는다', () => {
    expect(emptyReason('today', closedDays, '2026-08-17', '2026-08-18'))
      .toBe('수업이 없는 날입니다: 재량휴업일');
  });

  it('내일이 쉬는 날이면 사유를 적는다', () => {
    expect(emptyReason('tomorrow', closedDays, '2026-08-16', '2026-08-17'))
      .toBe('수업이 없는 날입니다: 재량휴업일');
  });

  it('쉬는 날이 아니면 예전 문구 그대로다', () => {
    // 자료가 안 들어온 것과 쉬는 것을 가리는 것이 목적이다. 아무 때나 쉰다고 하면 안 된다.
    expect(emptyReason('today', closedDays, '2026-08-18', '2026-08-19'))
      .toBe('표시할 수업이 없습니다.');
  });

  it('이번 주 칸은 쉬는 날짜를 모아 적는다', () => {
    expect(emptyReason('week', closedDays, '2026-08-15', '2026-08-16'))
      .toBe('수업이 없는 날입니다: 2026-08-17 재량휴업일');
  });

  it('이번 주 밖의 쉬는 날은 안 적는다', () => {
    const far = [{ date: '2026-09-20', note: '개교기념일' }];
    expect(emptyReason('week', far, '2026-08-15', '2026-08-16'))
      .toBe('표시할 수업이 없습니다.');
  });
});

describe('공개 화면에 넘기는 쉬는 날', () => {
  it('이 학급에 해당하는 것만 넘긴다', () => {
    const state = build(rows());
    const view = projectPublicClassSchedule(
      state,
      classIdentityKey(state.lessons[0]!.classIdentity),
    );
    expect(view.closedDays).toEqual([{ date: '2026-08-17', note: '재량휴업일' }]);
  });
});

describe('자료 점검 화면이 쉬는 날 행을 밝힌다', () => {
  it('몇 행이 쉬는 날로 갔는지 적는다', () => {
    // 사용 가능 행 수와 실제 수업 수가 벌어진다. 어디로 갔는지 안 적으면 숫자가 안 맞는다.
    const source = rows();
    const bundle = {
      school: { code: '7010536', name: '예시중학교', office: 'J10', kind: '중학교' },
      rows: source,
      events: [],
      range: { from: '20260817', to: '20260821' },
      result: { complete: true, checksum: 'sha256:test', total: source.length, pageCount: 1 },
      report: fromNeis(source),
    } as unknown as Parameters<typeof DataHealthPanel>[0]['bundle'];
    const html = renderToStaticMarkup(
      createElement(DataHealthPanel, { bundle, now: new Date('2026-08-18T00:00:00.000Z') }),
    );
    expect(html).toContain('쉬는 날');
    // 월요일 두 학급 네 교시씩 여덟 행이 쉬는 날로 갔다.
    expect(html).toMatch(/쉬는 날<\/dt><dd>8행/);
  });
});

/**
 * 한 주가 통째로 쉬는 주.
 *
 * 방학이나 수능 휴업 주를 불러오면 이렇게 된다. 나이스는 닷새 모든 칸에 "재량휴업일"을
 * 넣어 돌려주고, 휴업 걸러 내기가 그것을 모두 빼므로 수업이 하나도 안 남는다.
 * 남은 것이 없으니 계산할 것도 없다. 그런데 화면이 무너지거나, 텅 빈 시간표를 정상인
 * 것처럼 보여 주면 안 된다.
 */
function closedWeekRows(): NeisRow[] {
  const out: NeisRow[] = [];
  for (const date of ['20260817', '20260818', '20260819', '20260820', '20260821']) {
    for (const className of ['1', '2']) {
      for (let period = 1; period <= 4; period += 1) {
        out.push(row(date, className, String(period), '재량휴업일'));
      }
    }
  }
  return out;
}

describe('한 주가 통째로 쉬는 주', () => {
  const state = build(closedWeekRows());

  it('수업이 하나도 안 남는다', () => {
    expect(state.lessons).toHaveLength(0);
  });

  it('닷새가 모두 쉬는 날로 남는다', () => {
    const closures = state.revisions[0]!.closures ?? [];
    expect([...new Set(closures.map((item) => item.date))].sort()).toEqual([
      '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21',
    ]);
  });

  /*
   * 수업이 하나도 없는 주를 "완전하게 불러왔다"고 적으면 안 된다. 그 표시를 보고
   * 검증이 개정판을 믿을 만한 것으로 다루고, 화면은 텅 빈 시간표를 정상으로 보여 준다.
   * 실제로는 사람이 주를 잘못 골랐을 가능성이 훨씬 높다.
   */
  it('쓸 수 있는 주가 아니라고 표시한다', () => {
    expect(state.revisions[0]!.complete).toBe(false);
  });

  it('관제판이 무너지지 않는다', () => {
    const view = projectOpsDashboard(state, '2026-08-18');
    expect(view.unresolvedLessons).toBe(0);
    expect(Number.isFinite(view.todayChanges)).toBe(true);
  });

  it('학급 공개 화면이 쉬는 날 사유를 보여 준다', () => {
    // 수업이 하나도 없으니 학급 식별자는 쉬는 날 기록에서 가져온다.
    const closure = (state.revisions[0]!.closures ?? [])
      .find((item) => item.date === '2026-08-18' && item.classIdentities?.length);
    const view = projectPublicClassSchedule(state, classIdentityKey(closure!.classIdentities![0]!));
    expect(view.closedDays.map((item) => item.date)).toContain('2026-08-18');
  });
});
