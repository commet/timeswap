import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fromNeis, neisToTimetable, type NeisRow } from '../src/adapters/neis';
import { recommend } from '../src/search';
import { totalHoles } from '../src/timetable';
import type { TimetableInput } from '../src/types';
import { apply, lessonBag, pairKey, sameBag, teacherTable, violations } from './lib/invariants';

const PATH = process.env.FIELD_SAMPLE ?? '';
/** 그 사람이 그날 맡은 교시를 이른 것부터. 일과 담당이 처리하는 순서다. */
function dayLessons(input: TimetableInput, teacher: string, day: number): number[] {
  const p = input.config.periods;
  return [
    ...new Set(
      input.assignments
        .filter((a) => a.teacher === teacher && Math.floor(a.slot / p) === day)
        .map((a) => a.slot),
    ),
  ].sort((x, y) => x - y);
}

/** 그날 수업이 가장 많은 (교사, 요일). 하루를 통째로 비우는 상황을 만든다. */
function busiestDay(input: TimetableInput): { teacher: string; day: number; slots: number[] } | undefined {
  const p = input.config.periods;
  const count = new Map<string, Set<number>>();
  for (const a of input.assignments) {
    const k = `${a.teacher}|${Math.floor(a.slot / p)}`;
    (count.get(k) ?? count.set(k, new Set()).get(k)!).add(a.slot);
  }
  let best: { teacher: string; day: number; slots: number[] } | undefined;
  for (const [k, slots] of [...count].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cut = k.lastIndexOf('|');
    const teacher = k.slice(0, cut);
    const day = Number(k.slice(cut + 1));
    if (best === undefined || slots.size > best.slots.length) {
      best = { teacher, day, slots: [...slots].sort((x, y) => x - y) };
    }
  }
  return best && best.slots.length >= 3 ? best : undefined;
}

/**
 * 하루치 부재를 한 교시씩 이어서 푼다.
 *
 * 지금까지의 검사는 매번 원본에서 다시 시작해 한 건만 풀었다. 그런데 실제로 쓰는
 * 모양은 다르다. 연수로 하루를 비우면 그날 수업이 대여섯 개고, 일과 담당은 그것을
 * 하나씩 처리한다. 앞에서 적용한 결과 위에서 다음을 찾는다.
 *
 * 한 건씩 볼 때 멀쩡해도 이어 붙이면 깨질 수 있다. 첫 수업을 3교시로 옮겼는데
 * 그 자리가 두 번째 수업을 옮길 유일한 자리였다면 두 번째는 답이 없다. 그것은
 * 결함이 아니다. 그러나 이미 옮긴 수업 위에 다른 수업을 겹쳐 놓거나, 부재 중인
 * 그 사람의 다른 교시로 밀어 넣으면 결함이다.
 */
describe.skipIf(!PATH || !existsSync(PATH))('하루치 부재를 이어서 푼다', () => {
  it('앞의 결정 위에 다음을 얹어도 시간표가 성립한다', () => {
    const data = JSON.parse(readFileSync(PATH, 'utf8')) as Array<{
      school: Record<string, string>;
      kind?: string;
      rows?: NeisRow[];
    }>;
    const fails: string[] = [];
    const stats = {
      schools: 0,
      chains: 0,
      steps: 0,
      applied: 0,
      /** 이어 붙였더니 새 위반이 생긴 경우 */
      broken: 0,
      unmatched: 0,
      lost: 0,
      moreHoles: 0,
      /** 다 풀고 나서도 그 사람이 그날 남아 있는 교시 */
      leftover: 0,
      /** 한 건도 못 푼 사슬. 결함은 아니고 보강으로 가야 하는 자리다. */
      dead: 0,
    };

    for (const entry of data) {
      const rows = entry.rows ?? [];
      if (rows.length === 0) continue;
      const kind = entry.kind ?? '고등학교';
      const name = entry.school.SCHUL_NM ?? '?';
      const report = fromNeis(rows);
      const table = teacherTable(report, kind);
      const base = neisToTimetable(report, (k, s) => table.get(pairKey(k, s)));
      if (base.assignments.length === 0) continue;
      stats.schools += 1;

      const pickA = busiestDay(base);
      if (!pickA) continue;

      // 두 사람이 같은 날 함께 빠지는 경우도 본다. 출장은 대개 여럿이 간다.
      const others = [...new Set(base.assignments.map((a) => a.teacher))]
        .filter((t) => t !== pickA.teacher)
        .sort();
      const pickB = others.find(
        (t) => dayLessons(base, t, pickA.day).length >= 2,
      );

      const runs: Array<{ tag: string; absent: string[] }> = [
        { tag: '한 사람 하루', absent: [pickA.teacher] },
        ...(pickB ? [{ tag: '두 사람 같은 날', absent: [pickA.teacher, pickB] }] : []),
      ];

      for (const run of runs) {
        const day = pickA.day;
        const p = base.config.periods;
        // 부재는 그날 전체다. 한 교시만 막고 푸는 것은 실제와 다르다.
        const wholeDay = Array.from({ length: p }, (_, i) => day * p + i);
        const start: TimetableInput = {
          ...base,
          unavailable: {
            ...(base.unavailable ?? {}),
            ...Object.fromEntries(run.absent.map((t) => [t, wholeDay])),
          },
        };
        const had = new Set(violations(start));
        const bag0 = lessonBag(start);
        const holes0 = totalHoles(start);
        stats.chains += 1;

        let current = start;
        let solved = 0;
        // 이른 교시부터. 매번 지금 상태에서 남은 자리를 다시 센다.
        // 앞의 이동으로 자리가 달라질 수 있어 처음에 뽑아 둔 목록을 쓰면 틀린다.
        for (let guard = 0; guard < 40; guard += 1) {
          const remaining = run.absent
            .flatMap((t) => dayLessons(current, t, day).map((slot) => ({ teacher: t, slot })))
            .sort((x, y) => x.slot - y.slot || x.teacher.localeCompare(y.teacher));
          if (remaining.length === 0) break;
          const pick = remaining[0]!;
          const r = recommend(current, pick, { max: 4 });
          stats.steps += 1;
          const best = r.candidates[0];
          if (!best) break; // 남은 자리가 없으면 보강으로 간다. 사슬은 여기서 끝난다.

          const { next, unmatched } = apply(current, best.changes);
          stats.applied += 1;
          if (unmatched > 0) {
            stats.unmatched += unmatched;
            if (fails.length < 10) fails.push(`${name} [${run.tag}]: 추천안이 가리킨 수업이 없음`);
          }
          const fresh = violations(next).filter((v) => !had.has(v));
          if (fresh.length > 0) {
            stats.broken += 1;
            if (fails.length < 10) {
              fails.push(`${name} [${run.tag}] ${solved + 1}번째 ${best.type}: 새 위반 ${fresh[0]}`);
            }
          }
          if (!sameBag(bag0, lessonBag(next))) {
            stats.lost += 1;
            if (fails.length < 10) fails.push(`${name} [${run.tag}]: 수업이 사라지거나 늘어남`);
          }
          if (totalHoles(next) > holes0) {
            stats.moreHoles += 1;
            if (fails.length < 10) fails.push(`${name} [${run.tag}]: 빈 시간이 늘어남`);
          }
          current = next;
          solved += 1;
        }

        if (solved === 0) stats.dead += 1;
        // 다 풀었다고 나왔는데 그 사람이 그날 아직 있으면 안 된다.
        const left = run.absent.flatMap((t) => dayLessons(current, t, day));
        if (solved > 0 && left.length > 0) {
          const r = recommend(current, { teacher: run.absent[0]!, slot: left[0]! }, { max: 1 });
          // 후보가 남아 있는데 안 빠진 것이면 결함이다. 후보가 없으면 보강 자리다.
          if (r.candidates.length > 0) {
            stats.leftover += 1;
            if (fails.length < 10) fails.push(`${name} [${run.tag}]: 풀 수 있는데 남겨 둠`);
          }
        }
      }
    }

    expect({ fails: fails.slice(0, 5), ...stats }).toMatchObject({
      fails: [],
      broken: 0,
      unmatched: 0,
      lost: 0,
      moreHoles: 0,
      leftover: 0,
    });
    // 사슬이 실제로 여러 단계를 밟았는지. 한 단계에서 다 멈췄으면 검사한 척만 한 것이다.
    expect(stats.applied).toBeGreaterThan(stats.chains);
  }, 1_800_000);
});
