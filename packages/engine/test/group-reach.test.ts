import { describe, expect, it } from 'vitest';
import { genSchool } from '../src/synthetic';
import { recommend } from '../src/search';
import { coverCandidates } from '../src/cover';
import { dayOf } from '../src/slots';
import type { TimetableInput } from '../src/types';

/**
 * 이동수업 담당 교사가 결강하면 도구가 무엇을 주는가.
 *
 * 이 도구에서 가장 어려운 자리다. 묶음은 통째로만 움직이므로 학급 전원과 교사 전원이
 * 같은 시간에 비어 있어야 한다. 그게 얼마나 되는지 숫자로 재어 둔다.
 *
 * 재고 나서 짐작이 틀린 것을 알았다. 학년 전체가 걸리는 블록형 이동수업이라면
 * 블록끼리 짝이 되어 바꾸기 쉬울 줄 알았는데 오히려 0% 였다.
 * 묶음이 클수록 옮길 자리를 찾기가 급격히 어려워진다. 학급 다섯이 동시에 비어 있고
 * 교사 다섯이 동시에 비어 있는 교시는 빽빽한 시간표에 거의 없다.
 *
 * 그래서 이 시험이 지키는 것은 "이동수업도 교체가 된다"가 아니다.
 * **교체가 안 될 때 보강 후보라도 반드시 나온다**는 것이다.
 * 아무것도 못 주는 화면이 나오면 그 선생님에게 이 도구는 없는 것과 같다.
 */

/** 교시마다 따로 묶는다. 짝이 잘 안 생기는 형태다. */
function scattered(input: TimetableInput): TimetableInput {
  const subjects = [...new Set(input.assignments.map((a) => a.subject))].sort();
  const moving = new Set(subjects.filter((_, i) => i % 4 === 0));
  const cnt = new Map<string, number>();
  for (const a of input.assignments) {
    if (moving.has(a.subject)) cnt.set(`${a.slot}|${a.subject}`, (cnt.get(`${a.slot}|${a.subject}`) ?? 0) + 1);
  }
  return {
    ...input,
    assignments: input.assignments.map((a) => {
      const k = `${a.slot}|${a.subject}`;
      return moving.has(a.subject) && (cnt.get(k) ?? 0) >= 2 ? { ...a, group: `흩어짐:${k}` } : a;
    }),
  };
}

/** 한 학년이 몇 개 교시에 통째로 이동수업을 하는 형태. 실제 편성에 가깝다. */
function blocks(input: TimetableInput): TimetableInput {
  const cfg = input.config;
  const grade = '2';
  const slots = new Set<number>();
  // 그 학년 학급이 모두 수업 중인 교시 가운데 앞의 셋을 블록으로 잡는다
  const byslot = new Map<number, Set<string>>();
  for (const a of input.assignments) {
    if (!a.klass.startsWith(grade)) continue;
    const s = byslot.get(a.slot) ?? new Set<string>();
    s.add(a.klass);
    byslot.set(a.slot, s);
  }
  const gradeKlasses = new Set(
    input.assignments.filter((a) => a.klass.startsWith(grade)).map((a) => a.klass),
  );
  const days = new Set<number>();
  for (const [sl, ks] of [...byslot.entries()].sort((x, y) => x[0] - y[0])) {
    if (ks.size !== gradeKlasses.size) continue;
    const d = dayOf(sl, cfg);
    if (days.has(d)) continue; // 하루에 하나씩만
    days.add(d);
    slots.add(sl);
    if (slots.size >= 3) break;
  }
  return {
    ...input,
    assignments: input.assignments.map((a) =>
      a.klass.startsWith(grade) && slots.has(a.slot) ? { ...a, group: `블록:${a.slot}` } : a,
    ),
  };
}

function measure(make: (i: TimetableInput) => TimetableInput): {
  reach: number;
  avg: number;
  coverAll: boolean;
} {
  let targets = 0, withCand = 0, cands = 0, coverOk = 0, noCand = 0;
  for (const seed of [1, 2]) {
    const school = make(genSchool({ classes: 14, seed }));
    const done = new Set<string>();
    for (const a of school.assignments) {
      if (!a.group || done.has(`${a.group}|${a.teacher}`)) continue;
      done.add(`${a.group}|${a.teacher}`);
      targets++;
      const r = recommend(school, { teacher: a.teacher, slot: a.slot }, { max: 20 });
      cands += r.candidates.length;
      if (r.candidates.length > 0) withCand++;
      else {
        noCand++;
        if (coverCandidates(school, a.slot, a.subject, 8, a.teacher).length > 0) coverOk++;
      }
    }
  }
  return { reach: withCand / targets, avg: cands / targets, coverAll: noCand === 0 || coverOk === noCand };
}

describe('이동수업 담당 교사가 결강하면', () => {
  it('편성 형태에 따라 교체 도달률이 크게 갈린다', { timeout: 30_000 }, () => {
    const s = measure(scattered);
    const b = measure(blocks);
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    console.log(`교시마다 흩어진 묶음: 교체안 있음 ${pct(s.reach)}, 평균 ${s.avg.toFixed(1)}개`);
    console.log(`학년 블록형 묶음:     교체안 있음 ${pct(b.reach)}, 평균 ${b.avg.toFixed(1)}개`);

    // 어느 형태든, 교체안이 없으면 보강 후보라도 반드시 나와야 한다. 이것이 이 시험의 핵심이다.
    expect(s.coverAll).toBe(true);
    expect(b.coverAll).toBe(true);
    // 묶음이 클수록 어렵다. 학년 전체가 걸리는 블록형은 사실상 교체가 안 된다.
    expect(b.reach).toBeLessThanOrEqual(s.reach);
    // 흩어진 형태에서도 열에 여덟은 교체안이 없다. 이 숫자가 크게 좋아지면
    // 하드 제약이 느슨해진 것은 아닌지 의심할 자리다.
    expect(s.reach).toBeLessThan(0.5);
  });
});
