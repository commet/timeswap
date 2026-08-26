import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fromNeis, neisToTimetable, type NeisRow } from '../src/adapters/neis';
import { coverCandidates } from '../src/cover';
import { recommend } from '../src/search';
import { totalHoles } from '../src/timetable';
import type { TimetableInput } from '../src/types';
import { apply, lessonBag, pairKey, sameBag, teacherTable, violations } from './lib/invariants';

const PATH = process.env.FIELD_SAMPLE ?? '';

describe.skipIf(!PATH || !existsSync(PATH))('실제 학교에서 지켜야 할 것', () => {
  it('추천안을 적용해도 시간표가 성립한다', () => {
    const data = JSON.parse(readFileSync(PATH, 'utf8')) as Array<{
      school: Record<string, string>;
      kind?: string;
      rows?: NeisRow[];
    }>;
    const fails: string[] = [];
    const stats = {
      schools: 0,
      picks: 0,
      candidates: 0,
      broken: 0,
      unmatched: 0,
      lost: 0,
      moreHoles: 0,
      nondeterministic: 0,
      /** 적용해도 그 교사가 그 시간에서 안 빠진 추천안. 결강을 못 푼 안이다. */
      notFreed: 0,
      /** 말한 종류와 실제 바뀐 수가 안 맞는 추천안 */
      wrongShape: 0,
      /** 옮긴 자리가 원래 자리와 같은 추천안 */
      noop: 0,
      /** 보강 후보 검사 */
      covers: 0,
      coverBusy: 0,
      coverAbsent: 0,
      coverUnavail: 0,
      coverNoReason: 0,
      coverOnClosed: 0,
      startDirty: 0,
      /** 시작 위반이 하나라도 있던 시나리오. 0 이면 조건이 안 걸린 것이라 검사가 헛돈다. */
      scenarios: 0,
    };

    for (const entry of data) {
      const rows = entry.rows ?? [];
      if (rows.length === 0) continue;
      const kind = entry.kind ?? '고등학교';
      const name = entry.school.SCHUL_NM ?? '?';
      const report = fromNeis(rows);
      const table = teacherTable(report, kind);
      const input = neisToTimetable(report, (k, s) => table.get(pairKey(k, s)));
      stats.schools += 1;

      /*
       * 실제 나이스 자료에는 휴업일도 근무 불가도 없다. 그대로 돌리면 그 규칙들이
       * 한 번도 발동하지 않아 검사한 척만 하게 된다. 학교가 쓰는 모양으로 조건을
       * 얹어 여러 번 돌린다.
       */
      const klasses = [...new Set(input.assignments.map((x) => x.klass))].sort();
      const teachers = [...new Set(input.assignments.map((x) => x.teacher))].sort();
      const cfg = input.config;
      const scenarios: Array<{ tag: string; make: () => TimetableInput }> = [
        { tag: '그대로', make: () => input },
        {
          tag: '학교 휴업일',
          make: () => ({ ...input, closures: [{ day: cfg.days - 1, reason: '개교기념일' }] }),
        },
        {
          tag: '학년 행사',
          make: () => ({
            ...input,
            closures: [{ day: 1, reason: '수학여행', klasses: klasses.slice(0, Math.ceil(klasses.length / 3)) }],
          }),
        },
        {
          tag: '근무 불가',
          make: () => ({
            ...input,
            unavailable: Object.fromEntries(
              teachers.slice(0, Math.ceil(teachers.length / 4)).map((t, i) => [
                t,
                [i % cfg.periods, cfg.periods + ((i * 3) % cfg.periods)],
              ]),
            ),
          }),
        },
        {
          tag: '표를 절반만 채움',
          make: () => {
            const half = new Map([...table].filter((_, i) => i % 2 === 0));
            return neisToTimetable(report, (k, sub) => half.get(pairKey(k, sub)));
          },
        },
        {
          tag: '겹쳐서',
          make: () => {
            const half = new Map([...table].filter((_, i) => i % 3 !== 0));
            const base = neisToTimetable(report, (k, sub) => half.get(pairKey(k, sub)));
            return {
              ...base,
              closures: [{ day: cfg.days - 1, reason: '개교기념일' }],
              unavailable: Object.fromEntries(
                [...new Set(base.assignments.map((x) => x.teacher))]
                  .sort()
                  .slice(0, 10)
                  .map((t, i) => [t, [i % cfg.periods]]),
              ),
            };
          },
        },
      ];

      for (const { tag, make } of scenarios) {
        const t = make();
        // 시작부터 어긋나 있는 것이 정상이다. 무엇이 이미 어긋나 있었는지만 기억한다.
        const before = violations(t);
        stats.scenarios += 1;
        if (before.length > 0) stats.startDirty += 1;
        const bag0 = lessonBag(t);
        const holes0 = totalHoles(t);
        const had = new Set(before);
        const step = Math.max(1, Math.floor(t.assignments.length / 6));
        for (let i = 0; i < t.assignments.length; i += step) {
          const a = t.assignments[i]!;
          const pick = { teacher: a.teacher, slot: a.slot };
          const r = recommend(t, pick, { max: 6 });
          stats.picks += 1;

          if (tag === '그대로') {
            const again = recommend(t, pick, { max: 6 });
            if (JSON.stringify(again.candidates) !== JSON.stringify(r.candidates)) {
              stats.nondeterministic += 1;
              if (fails.length < 10) fails.push(`${name}: 같은 입력에 다른 답`);
            }
          }

          /*
           * 보강. 교체가 안 되는 자리에서 실제로 쓰이는 길이고, 초등학교에서는
           * 결강의 62%가 여기로 온다. 그런데 실제 자료로 재어 본 적이 없었다.
           */
          if (r.candidates.length === 0) {
            const target = t.assignments.find(
              (x) => x.teacher === pick.teacher && x.slot === pick.slot,
            );
            if (target) {
              const day = Math.floor(pick.slot / cfg.periods);
              const closedHere =
                (t.closures ?? []).some(
                  (cl) =>
                    cl.day === day &&
                    (!cl.klasses || cl.klasses.length === 0 || cl.klasses.includes(target.klass)),
                );
              const list = coverCandidates(t, pick.slot, target.subject, 8, undefined, target.klass);
              if (closedHere && list.length > 0) {
                stats.coverOnClosed += 1;
                if (fails.length < 10) fails.push(`${name} [${tag}]: 쉬는 날에 보강 후보를 냄`);
              }
              const atSlot = new Map<string, number>();
              for (const x of t.assignments) {
                if (x.slot === pick.slot) atSlot.set(x.teacher, 1);
              }
              const unav = new Map(
                Object.entries(t.unavailable ?? {}).map(([k, v]) => [k, new Set(v)] as const),
              );
              for (const cc of list) {
                stats.covers += 1;
                if (atSlot.has(cc.teacher)) {
                  stats.coverBusy += 1;
                  if (fails.length < 10) fails.push(`${name} [${tag}]: 그 시간에 수업 있는 분을 보강 후보로 냄`);
                }
                if (cc.teacher === pick.teacher) {
                  stats.coverAbsent += 1;
                  if (fails.length < 10) fails.push(`${name} [${tag}]: 결강 당사자를 보강 후보로 냄`);
                }
                if (unav.get(cc.teacher)?.has(pick.slot)) {
                  stats.coverUnavail += 1;
                  if (fails.length < 10) fails.push(`${name} [${tag}]: 근무 불가인 분을 보강 후보로 냄`);
                }
                if (!cc.notes || cc.notes.length === 0) {
                  stats.coverNoReason += 1;
                  if (fails.length < 10) fails.push(`${name} [${tag}]: 근거 없는 보강 후보`);
                }
              }
            }
          }

          for (const c of r.candidates) {
            stats.candidates += 1;
            const { next, unmatched } = apply(t, c.changes);
            if (unmatched > 0) {
              stats.unmatched += unmatched;
              if (fails.length < 10) fails.push(`${name} [${tag}]: 추천안이 가리킨 수업이 없음`);
            }
            // 새로 생긴 위반만 결함이다
            const fresh = violations(next).filter((v) => !had.has(v));
            if (fresh.length > 0) {
              stats.broken += 1;
              if (fails.length < 10) fails.push(`${name} [${tag}] ${c.type}: 새 위반 ${fresh[0]}`);
            }
            if (!sameBag(bag0, lessonBag(next))) {
              stats.lost += 1;
              if (fails.length < 10) fails.push(`${name} [${tag}]: 수업이 사라지거나 늘어남`);
            }
            if (totalHoles(next) > holes0) {
              stats.moreHoles += 1;
              if (fails.length < 10) fails.push(`${name} [${tag}]: 적용 후 빈 시간이 늘어남`);
            }

            // 이 도구가 하는 일 자체다. 적용한 뒤 그 선생님이 그 시간에서 빠져야 한다.
            const stillThere = next.assignments.some(
              (x) => x.teacher === pick.teacher && x.slot === pick.slot,
            );
            if (stillThere) {
              stats.notFreed += 1;
              if (fails.length < 10) {
                fails.push(`${name} [${tag}] ${c.type}: 적용해도 그 시간이 안 비었음`);
              }
            }

            // 말한 종류와 실제로 움직인 자리 수가 맞아야 한다.
            // 배정 수가 아니라 자리 수로 센다. 분반과 합반은 여러 배정이 한 몸이라
            // 자리 둘을 맞바꿔도 배정은 셋 이상이 움직인다.
            const moved = new Set(c.changes.map((x) => x.from.slot)).size;
            const want = c.type === 'move' ? 1 : c.type === 'swap2' ? 2 : 3;
            if (moved !== want) {
              stats.wrongShape += 1;
              if (fails.length < 10) {
                fails.push(`${name} [${tag}] ${c.type}: 바뀐 수 ${moved}, 기대 ${want}`);
              }
            }
            for (const ch of c.changes) {
              if (ch.toSlot === ch.from.slot) {
                stats.noop += 1;
                if (fails.length < 10) fails.push(`${name} [${tag}] ${c.type}: 제자리 이동`);
              }
            }
          }
        }
      }
    }

    if (process.env.FIELD_OUT) {
      writeFileSync(process.env.FIELD_OUT, JSON.stringify({ fails, stats }, null, 1));
    }
    expect({ fails: fails.slice(0, 5), ...stats }).toMatchObject({
      fails: [],
      broken: 0,
      unmatched: 0,
      lost: 0,
      moreHoles: 0,
      nondeterministic: 0,
      notFreed: 0,
      wrongShape: 0,
      noop: 0,
      coverBusy: 0,
      coverAbsent: 0,
      coverUnavail: 0,
      coverNoReason: 0,
      coverOnClosed: 0,
    });
    expect(stats.covers).toBeGreaterThan(0);
    // 조건이 실제로 걸렸는지. 안 걸렸으면 검사한 척만 한 것이다.
    expect(stats.startDirty).toBeGreaterThan(0);
  }, 1_800_000);
});
