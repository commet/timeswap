import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fromNeis, neisToTimetable, gradeShapes, type NeisRow } from '../src/adapters/neis';
import { recommend } from '../src/search';
import { validate, totalHoles } from '../src/timetable';

/**
 * 실제 학교 자료를 통째로 엔진에 넣어 보는 검사.
 *
 * 분포를 재는 것과 자료를 통과시키는 것은 다른 일이다. 이 검사를 붙이기 전까지
 * `gradeShapes` 는 실제 나이스 자료 217곳 전부에서 빈 배열을 돌려주고 있었다.
 * 학급 키에서 첫 숫자를 학년으로 읽었는데 그 자리가 학교 코드였기 때문이다.
 * 합성 자료 시험은 학급 이름을 `1-3` 으로 쓰므로 그것을 잡을 수 없었다.
 *
 * 학교 자료는 저장소에 두지 않는다. 인증키로 받아 파일에 담고 환경 변수로 가리킨다.
 *
 * ```
 * FIELD_SAMPLE=/어딘가/sample.json npx vitest run packages/engine/test/field-run.test.ts
 * ```
 *
 * 파일 형식은 `[{ school: {...나이스 schoolInfo 행}, rows: [...나이스 시간표 행] }]` 이다.
 * 자료가 없으면 통과가 아니라 건너뜀으로 표시된다. 아무것도 안 재고 초록으로
 * 보이는 것이 가장 나쁘다.
 */
const PATH = process.env.FIELD_SAMPLE ?? '';
const pairKey = (klass: string, subject: string): string => JSON.stringify([klass, subject]);

/**
 * 학교가 채웠을 법한 교사 표를 만든다.
 *
 * (학년, 과목)마다 교사를 여러 분 두고, 같은 교시에 겹치지 않도록 나눠 맡긴다.
 * 실제 학교가 그렇게 돌아간다. 한 학년 국어를 한 사람이 다 맡을 수 없다.
 */
function teacherTable(report: ReturnType<typeof fromNeis>): Map<string, string> {
  const grade = new Map<string, string>();
  for (const c of report.cells) grade.set(c.klass, c.classLabel.split('-')[0] ?? '?');
  const wantedSlots = new Map<string, { klass: string; subject: string; slots: Set<number> }>();
  for (const c of report.cells) {
    if (c.kind !== '수업') continue;
    const key = pairKey(c.klass, c.subject);
    const cur =
      wantedSlots.get(key) ??
      wantedSlots.set(key, { klass: c.klass, subject: c.subject, slots: new Set() }).get(key)!;
    cur.slots.add(c.day * report.config.periods + c.period);
  }
  // 이동수업과 합반을 되살린다.
  // 같은 교시 같은 과목을 듣는 학급 무리가 그 과목의 모든 교시에서 똑같으면
  // 한 사람이 한자리에 모아 가르치는 것으로 본다. 그 자리에 교사를 하나만 둔다.
  const parallel = new Map<string, string>();
  const bySubjectSlot = new Map<string, Set<string>>();
  for (const c of report.cells) {
    if (c.kind !== '수업') continue;
    const k = `${grade.get(c.klass)}|${c.subject}|${c.day * report.config.periods + c.period}`;
    (bySubjectSlot.get(k) ?? bySubjectSlot.set(k, new Set()).get(k)!).add(c.klass);
  }
  const setsOf = new Map<string, string[][]>();
  for (const [k, members] of bySubjectSlot) {
    const owner = k.split('|').slice(0, 2).join('|');
    (setsOf.get(owner) ?? setsOf.set(owner, []).get(owner)!).push([...members].sort());
  }
  for (const [owner, sets] of setsOf) {
    if (sets.length < 2 || sets[0]!.length < 2) continue;
    const first = sets[0]!.join(',');
    if (!sets.every((x) => x.join(',') === first)) continue;
    for (const klass of sets[0]!) parallel.set(`${owner}|${klass}`, `${owner}/모임`);
  }

  const used = new Map<string, Array<Set<number>>>();
  const out = new Map<string, string>();
  for (const [key, { klass, subject, slots }] of [...wantedSlots].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const owner = `${grade.get(klass)}|${subject}`;
    const shared = parallel.get(`${owner}|${klass}`);
    if (shared !== undefined) {
      out.set(key, shared);
      continue;
    }
    const pool = used.get(owner) ?? used.set(owner, []).get(owner)!;
    let idx = pool.findIndex((taken) => [...slots].every((s) => !taken.has(s)));
    if (idx < 0) {
      pool.push(new Set());
      idx = pool.length - 1;
    }
    for (const s of slots) pool[idx]!.add(s);
    out.set(key, `${owner}/${idx}`);
  }
  return out;
}

describe.skipIf(!PATH || !existsSync(PATH))('전국 표본 통과', () => {
  it('학교마다 엔진을 통과한다', () => {
    const data = JSON.parse(readFileSync(PATH, 'utf8')) as Array<{
      school: Record<string, string>;
      rows?: NeisRow[];
    }>;
    const fails: string[] = [];
    const stats: Array<Record<string, unknown>> = [];
    for (const entry of data) {
      const rows = entry.rows ?? [];
      if (rows.length === 0) continue;
      const name = entry.school.SCHUL_NM ?? '?';
      try {
        const t0 = Date.now();
        const report = fromNeis(rows);
        const table = teacherTable(report);
        const input = neisToTimetable(report, (k, s) => table.get(pairKey(k, s)));
        const errs = validate(input);
        if (errs.length > 0) {
          fails.push(`${name}: validate ${errs.length}건 ${errs[0]}`);
          continue;
        }
        const shapes = gradeShapes(input);
        if (shapes.length === 0) {
          fails.push(`${name}: gradeShapes 가 비었다`);
          continue;
        }
        let picks = 0;
        let cands = 0;
        let empty = 0;
        let worse = 0;
        const holes0 = totalHoles(input);
        const step = Math.max(1, Math.floor(input.assignments.length / 15));
        for (let i = 0; i < input.assignments.length; i += step) {
          const a = input.assignments[i]!;
          const r = recommend(input, { teacher: a.teacher, slot: a.slot }, { max: 8 });
          picks++;
          cands += r.candidates.length;
          if (r.candidates.length === 0) empty++;
          for (const c of r.candidates.slice(0, 2)) {
            const moved = input.assignments.map((x) => {
              const ch = c.changes.find(
                (y) =>
                  y.from.teacher === x.teacher &&
                  y.from.klass === x.klass &&
                  y.from.slot === x.slot &&
                  y.from.subject === x.subject,
              );
              return ch ? { ...x, slot: ch.toSlot } : x;
            });
            const after = { ...input, assignments: moved };
            const e2 = validate(after);
            if (e2.length > 0) {
              fails.push(`${name}: 추천안 적용 후 무효 ${e2[0]}`);
              break;
            }
            if (totalHoles(after) > holes0) worse++;
          }
        }
        stats.push({
          name,
          kind: entry.school.HS_SC_NM,
          gnrl: entry.school.HS_GNRL_BUSNS_SC_NM,
          klasses: new Set(input.assignments.map((a) => a.klass)).size,
          assigns: input.assignments.length,
          teachers: new Set(input.assignments.map((a) => a.teacher)).size,
          busy: Object.keys(input.klassBusy ?? {}).length,
          groups: new Set(input.assignments.map((a) => a.group).filter(Boolean)).size,
          inGroup: input.assignments.filter((a) => a.group).length,
          conflicts: input.conflicts.length,
          picks,
          cands,
          empty,
          worse,
          ms: Date.now() - t0,
          shapes: shapes.map((s) => `${s.grade}:${s.kind}:${s.sharedRate.toFixed(2)}`).join(' '),
          days: report.config.days,
          periods: report.config.periods,
        });
      } catch (e) {
        fails.push(`${name}: 예외 ${(e as Error).message}`);
      }
    }
    writeFileSync(process.env.FIELD_OUT ?? '/dev/null', JSON.stringify({ fails, stats }));
    expect(fails.slice(0, 10)).toEqual([]);
  }, 1_800_000);
});
