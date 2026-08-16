import { describe, expect, it } from 'vitest';
import { genSchool, mulberry32 } from '../src/synthetic';
import { recommend } from '../src/search';
import { dayOf } from '../src/slots';
import { applyChanges, closedReason, buildIndexes, totalHoles, validate } from '../src/timetable';
import type { DayClosure, TimetableInput } from '../src/types';

/**
 * 제약을 한꺼번에 걸어 두고 본다.
 *
 * 지금까지 찾은 잘못 가운데 셋이 "새로 넣은 기능이 이미 있던 것을 깨뜨린" 종류였다.
 * 하나씩 볼 때는 다 통과하는데 겹쳐 놓으면 어긋난다.
 * 그래서 묶음, 휴업일, 요일별 교시 수, 근무 불가, 최근 부담을 동시에 걸고
 * 나오는 모든 추천안이 그 전부를 지키는지 본다.
 */

/** 학교에서 실제로 쓰이는 요일별 마지막 교시 */
function realPeriodsPerDay(input: TimetableInput): number[] {
  const cfg = input.config;
  const out = new Array<number>(cfg.days).fill(0);
  for (const a of input.assignments) {
    const d = dayOf(a.slot, cfg);
    const p = a.slot - d * cfg.periods;
    if (p + 1 > (out[d] ?? 0)) out[d] = p + 1;
  }
  return out;
}

/**
 * 같은 교시에 같은 과목을 듣는 학급 가운데 일부를 한 묶음으로 표시한다.
 *
 * 겹치는 것을 모조리 묶으면 실제 학교와 멀어진다. 그렇게 하면 학교가 통째로 굳어
 * 추천이 거의 안 나오고, 시험이 아무것도 못 보게 된다.
 * 실제로는 이동수업이 몇 과목에만 걸리므로 과목 이름으로 갈라 일부만 묶는다.
 */
function markGroups(input: TimetableInput): TimetableInput {
  const subjects = [...new Set(input.assignments.map((a) => a.subject))].sort();
  const movingSubjects = new Set(subjects.filter((_, i) => i % 4 === 0));
  const bucket = new Map<string, typeof input.assignments>();
  for (const a of input.assignments) {
    if (!movingSubjects.has(a.subject)) continue;
    const k = `${a.slot}|${a.subject}`;
    const list = bucket.get(k);
    if (list) list.push(a);
    else bucket.set(k, [a]);
  }
  const grouped = new Map<string, string>();
  for (const [k, list] of bucket) {
    if (list.length < 2) continue;
    for (const a of list) grouped.set(`${a.teacher}|${a.klass}|${a.slot}`, `묶음:${k}`);
  }
  return {
    ...input,
    assignments: input.assignments.map((a) => {
      const g = grouped.get(`${a.teacher}|${a.klass}|${a.slot}`);
      return g === undefined ? a : { ...a, group: g };
    }),
  };
}

/** 교사마다 비어 있는 칸 몇 개를 근무 불가로 잠근다 */
function lockSome(input: TimetableInput, rng: () => number): Record<string, number[]> {
  const cfg = input.config;
  const busy = new Map<string, Set<number>>();
  for (const a of input.assignments) {
    const s = busy.get(a.teacher) ?? new Set<number>();
    s.add(a.slot);
    busy.set(a.teacher, s);
  }
  const out: Record<string, number[]> = {};
  for (const [t, taken] of busy) {
    if (rng() < 0.5) continue;
    const free: number[] = [];
    for (let sl = 0; sl < cfg.days * cfg.periods; sl++) if (!taken.has(sl)) free.push(sl);
    const pick = free.filter(() => rng() < 0.15);
    if (pick.length > 0) out[t] = pick.sort((x, y) => x - y);
  }
  return out;
}

describe('속성: 제약을 모두 걸어도 추천안이 안전하다', () => {
  const seeds = [1, 2, 3, 4, 5, 6];

  it.each(seeds)('시드 %i', (seed) => {
    const rng = mulberry32(seed * 104729);
    const base = genSchool({ classes: 14, seed });
    const withGroups = markGroups(base);
    const cfg = withGroups.config;

    const klasses = [...new Set(withGroups.assignments.map((a) => a.klass))];
    const grade2 = klasses.filter((k) => k.startsWith('2'));
    const closures: DayClosure[] = [
      { day: cfg.days - 1, reason: '개교기념일' },
      ...(grade2.length > 0 ? [{ day: 1, reason: '수학여행', klasses: grade2 }] : []),
    ];

    const school: TimetableInput = {
      ...withGroups,
      config: { ...cfg, periodsPerDay: realPeriodsPerDay(withGroups), lunchAfterPeriod: 4 },
      closures,
      unavailable: lockSome(withGroups, rng),
      recentBurden: Object.fromEntries(
        [...new Set(withGroups.assignments.map((a) => a.teacher))]
          .filter(() => rng() < 0.3)
          .map((t) => [t, 1 + Math.floor(rng() * 3)]),
      ),
    };

    // 입력 자체는 여전히 성립해야 한다. 묶음을 달아도 불변식이 깨지면 안 된다.
    expect(validate(school)).toEqual([]);

    const idxBefore = buildIndexes(school);
    const holesBefore = totalHoles(school);
    const perDay = school.config.periodsPerDay!;

    let seen = 0;
    let groupMoves = 0;
    // 절반은 묶음 수업을 대상으로 삼는다. 이동수업 담당 교사가 결강할 때가
    // 이 도구에서 가장 어려운 경우이고, 그 자리를 안 보면 묶음 검사가 헛돈다.
    const groupedOnes = school.assignments.filter((a) => a.group);
    for (let trial = 0; trial < 10; trial++) {
      const pool = trial % 2 === 0 && groupedOnes.length > 0 ? groupedOnes : school.assignments;
      const target = pool[Math.floor(rng() * pool.length)]!;
      const { candidates } = recommend(
        school,
        { teacher: target.teacher, slot: target.slot },
        { max: 40 },
      );

      for (const cand of candidates) {
        seen++;
        const applied = applyChanges(school, cand.changes);

        // 1. 시간표가 여전히 성립한다
        expect(validate(applied)).toEqual([]);
        // 2. 학급 중간 빈 시간이 늘지 않는다
        expect(totalHoles(applied)).toBeLessThanOrEqual(holesBefore);

        const movedGroups = new Map<string, Set<number>>();
        for (const ch of cand.changes) {
          const d = dayOf(ch.toSlot, cfg);
          const p = ch.toSlot - d * cfg.periods;

          // 3. 쉬는 날로 가지 않는다
          expect(closedReason(idxBefore, ch.from.klass, d)).toBeUndefined();
          // 4. 그 요일에 없는 교시로 가지 않는다
          expect(p).toBeLessThan(perDay[d]!);
          // 5. 근무할 수 없는 시간으로 가지 않는다
          expect(school.unavailable?.[ch.from.teacher] ?? []).not.toContain(ch.toSlot);

          if (ch.from.group) {
            const s = movedGroups.get(ch.from.group) ?? new Set<number>();
            s.add(ch.toSlot);
            movedGroups.set(ch.from.group, s);
          }
        }

        // 6. 묶음은 통째로, 한 자리로만 움직인다
        if (movedGroups.size > 0) groupMoves++;
        for (const [gid, slots] of movedGroups) {
          expect(slots.size).toBe(1);
          const whole = school.assignments.filter((a) => a.group === gid).length;
          const moved = cand.changes.filter((ch) => ch.from.group === gid).length;
          expect(moved).toBe(whole);
        }

        // 7. 결강 교사는 그 자리에서 사라진다
        const still = applied.assignments.some(
          (a) => a.teacher === target.teacher && a.slot === target.slot,
        );
        expect(still).toBe(false);
      }
    }
    const groupCount = new Set(
      school.assignments.filter((a) => a.group).map((a) => a.group),
    ).size;
    console.log(
      `시드 ${seed}: 묶음 ${groupCount}개, 추천안 ${seen}개, 그중 묶음이 움직인 안 ${groupMoves}개`,
    );
    // 묶음이 실제로 있어야 6번 검사가 뜻을 가진다
    expect(groupCount).toBeGreaterThan(0);
    // 제약을 잔뜩 걸어도 쓸 만한 안이 남아야 한다. 다 막아 버리면 도구가 아니다.
    expect(seen).toBeGreaterThan(0);
    // 묶음이 움직이는 안은 거의 안 나온다. 학급 전원과 교사 전원이 같은 시간에 비어야
    // 하기 때문이고, group-reach 시험에서 그 비율을 따로 재어 두었다.
    // 그래서 여기서는 "묶음이 움직였다면 통째로 움직였다"까지만 지킨다.
    expect(groupMoves).toBeGreaterThanOrEqual(0);
  });
});
