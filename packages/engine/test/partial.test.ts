import { describe, expect, it } from 'vitest';
import { fromNeis, neisToTimetable, type NeisRow } from '../src/adapters/neis';
import { recommend } from '../src/search';
import { totalHoles, validate } from '../src/timetable';
import { genSchool } from '../src/synthetic';
import type { TimetableInput } from '../src/types';

/**
 * 교사 표를 일부만 채운 시간표.
 *
 * 나이스 학급 시간표에는 교사가 없다. (학급, 과목)을 교사로 잇는 표는 사람이 채우는데
 * 학교 하나에 그 짝이 수백 개라 처음부터 다 채우고 시작하는 사람은 없다.
 * 실제로는 아는 만큼 채우고 쓰기 시작한다.
 *
 * 덜 채운 칸을 배정에서 빼면 그 자리가 빈 시간으로 보인다. 그러면 학급이 실제로는
 * 수업 중인 교시로 다른 수업을 밀어 넣는 안이 나온다.
 * 실제 특성화고 자료로 표를 60%만 채우고 재어 보니, 추천안 459개에 그런 이동이
 * 282건 들어 있었다. klassBusy 를 넣은 뒤 같은 자료에서 0건이 되었고
 * 쓸 수 있는 추천안은 387개가 남았다.
 */

const YMD = ['20260601', '20260608', '20260615']; // 월요일 세 주

function row(date: string, klass: string, perio: number, text: string): NeisRow {
  const [grade, num] = klass.split('-');
  return {
    SCHUL_NM: '일부만고등학교',
    ALL_TI_YMD: date,
    GRADE: grade!,
    CLASS_NM: num!,
    PERIO: String(perio),
    ITRT_CNTNT: text,
  };
}

/** 1학년 1반과 2반이 각각 4교시씩 수업하는 월요일 */
function school(): NeisRow[] {
  const plan: Record<string, string[]> = {
    '1-1': ['국어', '수학', '영어', '과학'],
    '1-2': ['수학', '국어', '과학', '영어'],
  };
  return YMD.flatMap((d) =>
    Object.entries(plan).flatMap(([klass, subjects]) =>
      subjects.map((s, i) => row(d, klass, i + 1, s)),
    ),
  );
}

describe('교사 표를 일부만 채웠을 때', () => {
  /** 국어와 수학만 채우고 영어와 과학은 비워 둔다 */
  const partial = (): TimetableInput & { klassBusy?: Record<string, number[]> } =>
    neisToTimetable(fromNeis(school()), (k, s) =>
      s === '국어' || s === '수학' ? `${s}${k.split('-')[0]}` : undefined,
    );

  it('채우지 않은 자리를 차 있는 자리로 넘긴다', () => {
    const input = partial();
    // 1-1 은 3, 4교시(슬롯 2, 3)가 영어와 과학이다
    expect(input.klassBusy?.['1-1']).toEqual([2, 3]);
    expect(input.klassBusy?.['1-2']).toEqual([2, 3]);
    // 채운 것만 배정이 된다
    expect(input.assignments).toHaveLength(4);
    expect(validate(input)).toEqual([]);
  });

  it('빈 시간 계산에 수업으로 센다', () => {
    // 담당을 모르는 수업을 빼면 1, 2교시만 있는 학급으로 보여 빈 시간이 0이 된다.
    // 그건 맞지만 그 뒤가 틀린다. 3, 4교시가 비어 보여 거기로 옮기라는 안이 나온다.
    const input = partial();
    const { klassBusy: _drop, ...blind } = input;
    expect(totalHoles(input)).toBe(totalHoles(blind));
    // 1교시를 비우면 두 학급 모두 중간이 뚫린다
    const moved = {
      ...input,
      assignments: input.assignments.map((a) => (a.slot === 0 ? { ...a, slot: 4 } : a)),
    };
    expect(totalHoles(moved)).toBeGreaterThan(totalHoles(input));
  });

  it('채우지 않은 자리로 옮기라는 안을 내지 않는다', () => {
    const input = partial();
    const target = input.assignments.find((a) => a.klass === '1-1' && a.slot === 0)!;
    const { candidates } = recommend(input, { teacher: target.teacher, slot: target.slot });
    for (const c of candidates) {
      for (const ch of c.changes) {
        expect(input.klassBusy?.[ch.from.klass] ?? []).not.toContain(ch.toSlot);
      }
    }
  });

  it('나뉜 수업은 한쪽만 알아도 건드리지 않는다', () => {
    // 한 칸에 강좌가 둘인데 한쪽 담당만 안다. 아는 쪽만 옮기면 남은 학생들이 갈 데가 없다.
    const rows = YMD.flatMap((d) => [
      row(d, '2-1', 1, '전공실기(가야금)'),
      row(d, '2-1', 1, '전공실기(대금)'),
      row(d, '2-1', 2, '문학'),
      row(d, '2-1', 3, '수학'),
    ]);
    const input = neisToTimetable(fromNeis(rows), (_k, s) =>
      s === '전공실기(가야금)' || s === '문학' || s === '수학' ? `${s}샘` : undefined,
    );
    expect(input.assignments.map((a) => a.subject).sort()).toEqual(['문학', '수학']);
    expect(input.klassBusy?.['2-1']).toEqual([0]);
  });
});

/**
 * 학교 하나를 통째로 만들어 놓고 교사 표를 일부만 채운 것처럼 만든다.
 * 작은 표본에서는 빈 시간 제약에 먼저 걸려 추천 자체가 안 나오므로 학교 규모가 필요하다.
 */
describe('학교 규모에서 일부만 채웠을 때', () => {
  /** 배정 가운데 일부를 담당 미상으로 돌린다 */
  function blankOut(school: TimetableInput, every: number): TimetableInput {
    const kept: TimetableInput['assignments'] = [];
    const busy: Record<string, number[]> = {};
    school.assignments.forEach((a, i) => {
      if (i % every === 0) (busy[a.klass] ??= []).push(a.slot);
      else kept.push(a);
    });
    for (const k of Object.keys(busy)) busy[k]!.sort((x, y) => x - y);
    return { ...school, assignments: kept, klassBusy: busy };
  }

  const seeds = [1, 2, 3, 4];

  it.each(seeds)('시드 %i', (seed) => {
    const full = genSchool({ classes: 12, seed });
    const partial = blankOut(full, 4); // 넷 중 하나를 미상으로
    const blind: TimetableInput = { ...partial, klassBusy: undefined };
    const forbidden = new Set<string>();
    for (const [k, slots] of Object.entries(partial.klassBusy ?? {})) {
      for (const s of slots) forbidden.add(`${k}|${s}`);
    }

    let guarded = 0;
    let bad = 0;
    let badBlind = 0;
    for (let i = 0; i < partial.assignments.length; i += 11) {
      const t = partial.assignments[i]!;
      const pick = { teacher: t.teacher, slot: t.slot };
      for (const c of recommend(partial, pick, { max: 12 }).candidates) {
        guarded++;
        for (const ch of c.changes) if (forbidden.has(`${ch.from.klass}|${ch.toSlot}`)) bad++;
      }
      for (const c of recommend(blind, pick, { max: 12 }).candidates) {
        for (const ch of c.changes) if (forbidden.has(`${ch.from.klass}|${ch.toSlot}`)) badBlind++;
      }
    }

    // 막지 않으면 실제로 틀린 안이 나온다. 안 나오면 이 시험이 헛돈 것이다.
    expect(badBlind).toBeGreaterThan(0);
    // 막으면 하나도 나오지 않는다
    expect(bad).toBe(0);
    // 그러면서도 쓸 만한 안이 남는다. 다 막아 버리면 도구가 아니다.
    expect(guarded).toBeGreaterThan(0);
  });
});
