import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fromNeis, normalizeNeisRows, classIdentityKey, type NeisRow } from '@timeswap/engine';
import { createWorkspaceFromNeis, type NeisLoadBundle } from '../components/SetupFlow';
import { resolutionRowsForLesson } from '../lib/resolution';
import { mapKey } from '../lib/app';
import type { AbsenceCase, Lesson, WorkspaceState } from '../lib/domain';

const PATH = process.env.FIELD_SAMPLE ?? '';
const LIMIT = Number(process.env.FIELD_LIMIT ?? '40');
/**
 * 실제 학교 자료를 **화면이 쓰는 길 그대로** 흘려 보낸다.
 *
 * 지금까지의 실제 자료 검사는 엔진 어댑터(neisToTimetable)로만 들어갔다. 그런데
 * 화면은 다른 길로 돈다. createWorkspaceFromNeis 로 작업 공간을 만들고
 * resolutionRowsForLesson 으로 안을 받는다. 그 길로는 실제 자료를 한 번도 안 넣어
 * 보았고, 그래서 다음이 전부 눈으로 하나씩 찾을 때까지 남아 있었다.
 *
 * - 자료가 없는 요일로 옮기라는 안이 맨 위에 왔다
 * - 그 학년에 없는 교시가 빈 자리로 보였다
 * - 결강난 교시가 비어 보였다
 * - "재량휴업일"이 과목이 되어 설정을 끝낼 수 없었다
 *
 * 넷 다 이 검사 하나면 걸린다. 앞으로 같은 종류가 생겨도 여기서 걸린다.
 * 한 건씩 눈으로 찾는 대신 그물을 둔다.
 */
const SPECIAL = ['영어', '체육', '음악', '미술', '과학', '실과', '정보', '보건', '창의적'];

/** 학교가 채웠을 법한 교사 표. 같은 시간에 두 곳에 있지 않도록 나눠 붙인다. */
function teacherMap(rows: NeisRow[], kind: string): Record<string, string> {
  const normalization = normalizeNeisRows(rows);
  const want = new Map<string, { grade: string; subject: string; slots: Set<string> }>();
  for (const row of normalization.accepted) {
    const key = mapKey(row.classKey, row.subject);
    const cur = want.get(key)
      ?? want.set(key, { grade: row.classIdentity.grade, subject: row.subject, slots: new Set() }).get(key)!;
    cur.slots.add(`${row.date}-${row.period}`);
  }
  const out: Record<string, string> = {};
  const used = new Map<string, Array<Set<string>>>();
  for (const [key, { grade, subject, slots }] of [...want].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (kind === '초등학교' && !SPECIAL.some((special) => subject.includes(special))) {
      out[key] = `담임 ${grade}`;
      continue;
    }
    const owner = `${grade}-${subject}`;
    const pool = used.get(owner) ?? used.set(owner, []).get(owner)!;
    let index = pool.findIndex((taken) => [...slots].every((slot) => !taken.has(slot)));
    if (index < 0) {
      pool.push(new Set());
      index = pool.length - 1;
    }
    for (const slot of slots) pool[index]!.add(slot);
    out[key] = `${owner} ${index}`;
  }
  return out;
}

function buildWorkspace(
  entry: { school: Record<string, string>; kind?: string; rows?: NeisRow[] },
): WorkspaceState | null {
  const rows = entry.rows ?? [];
  if (rows.length === 0) return null;
  const kind = entry.kind ?? '고등학교';
  const report = fromNeis(rows);
  const dates = [...new Set(report.normalization.accepted.map((row) => row.date))].sort();
  if (dates.length === 0) return null;
  const bundle = {
    school: {
      code: entry.school.SD_SCHUL_CODE ?? 'school',
      name: entry.school.SCHUL_NM ?? '이름 없는 학교',
      office: entry.school.ATPT_OFCDC_SC_CODE ?? '',
      kind,
    },
    rows,
    events: [],
    range: { from: dates[0]!, to: dates.at(-1)! },
    result: { complete: true, checksum: 'sha256:field', total: rows.length, pageCount: 1 },
    report,
  } as unknown as NeisLoadBundle;
  return createWorkspaceFromNeis(bundle, teacherMap(rows, kind), '2026-08-18T00:00:00.000Z');
}

/** 그 주에 수업이 가장 많은 교사와 그날. 하루를 통째로 비우는 상황을 만든다. */
function busiestDay(
  state: WorkspaceState,
): { teacherId: string; date: string; lessons: Lesson[] } | null {
  const groups = new Map<string, { teacherId: string; date: string; lessons: Lesson[] }>();
  for (const lesson of state.lessons) {
    if (lesson.teacher.state !== 'assigned') continue;
    const key = JSON.stringify([lesson.teacher.teacherId, lesson.date]);
    const found = groups.get(key)
      ?? groups.set(key, { teacherId: lesson.teacher.teacherId, date: lesson.date, lessons: [] }).get(key)!;
    found.lessons.push(lesson);
  }
  let best: { teacherId: string; date: string; lessons: Lesson[] } | null = null;
  for (const [, group] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!best || group.lessons.length > best.lessons.length) best = group;
  }
  return best && best.lessons.length >= 2 ? best : null;
}

function withCase(
  state: WorkspaceState,
  pick: { teacherId: string; date: string; lessons: Lesson[] },
): { state: WorkspaceState; absenceCase: AbsenceCase } {
  const absenceCase: AbsenceCase = {
    id: 'field:case',
    workspaceId: state.workspace.id,
    requesterTeacherId: pick.teacherId,
    fromDate: pick.date,
    toDate: pick.date,
    reason: '업무상 부재',
    lessonIds: pick.lessons.map((lesson) => lesson.id),
    resolutionItems: [],
    status: 'submitted',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  };
  return { state: { ...state, cases: [...state.cases, absenceCase] }, absenceCase };
}

describe.skipIf(!PATH || !existsSync(PATH))('실제 학교 자료를 화면이 쓰는 길로 흘려 본다', () => {
  it('없는 자리로 옮기라고 하지 않는다', () => {
    const data = (JSON.parse(readFileSync(PATH, 'utf8')) as Array<{
      school: Record<string, string>; kind?: string; rows?: NeisRow[];
    }>).filter((entry) => (entry.rows ?? []).length > 0).slice(0, LIMIT);

    const fails: string[] = [];
    const stats = {
      schools: 0, cases: 0, rows: 0, changes: 0,
      /** 그 주 자료에 없는 날로 보낸 안 */
      offWeek: 0,
      /** 그날 아무 학급도 안 쓰는 교시로 보낸 안 */
      offPeriod: 0,
      /** 그 학급이 쉬는 날로 보낸 안 */
      onClosure: 0,
      /** 그 학급이 이미 수업 중인 자리로 보낸 안 */
      klassBusy: 0,
      /** 결강으로 담긴 교시로 그분 수업을 되돌린 안 */
      backIntoAbsence: 0,
      /** 휴업 문구가 과목으로 남은 학교 */
      holidayAsSubject: 0,
    };

    for (const entry of data) {
      const built = buildWorkspace(entry);
      if (!built) continue;
      const name = entry.school.SCHUL_NM ?? '?';
      stats.schools += 1;

      // 휴업 문구가 과목으로 남으면 설정 화면이 그 담당 교사를 채우라고 한다.
      for (const lesson of built.lessons) {
        if (/휴업|방학|재량/.test(lesson.subject)) {
          stats.holidayAsSubject += 1;
          if (fails.length < 10) fails.push(`${name}: 휴업 문구가 과목으로 남음 "${lesson.subject}"`);
          break;
        }
      }

      const pick = busiestDay(built);
      if (!pick) continue;
      const { state, absenceCase } = withCase(built, pick);
      stats.cases += 1;

      const exists = new Set(state.lessons.map((lesson) =>
        `${classIdentityKey(lesson.classIdentity)}|${lesson.date}|${lesson.period}`));
      const periodsOn = new Map<string, Set<string>>();
      for (const lesson of state.lessons) {
        (periodsOn.get(lesson.date) ?? periodsOn.set(lesson.date, new Set()).get(lesson.date)!)
          .add(lesson.period);
      }
      const closures = state.revisions[0]?.closures ?? [];
      const lessonById = new Map(state.lessons.map((lesson) => [lesson.id, lesson]));
      const absentSlots = new Set(pick.lessons.map((lesson) => `${lesson.date}|${lesson.period}`));

      for (const lessonId of absenceCase.lessonIds) {
        for (const row of resolutionRowsForLesson(state, absenceCase.id, lessonId)) {
          stats.rows += 1;
          /*
           * 그 안이 스스로 비우는 자리. 맞교환은 상대 수업을 같은 계획에서 옮기므로
           * 그 자리는 비어 있는 것이 맞다. 엔진의 checkMoves 도 같은 계산을 한다.
           * 이것을 안 빼면 정상인 맞교환이 전부 걸린다.
           */
          const vacated = new Set((row.resolution.changes ?? []).flatMap((item) => {
            const source = lessonById.get(item.lessonId);
            return source
              ? [`${classIdentityKey(source.classIdentity)}|${source.date}|${source.period}`]
              : [];
          }));
          for (const change of row.resolution.changes ?? []) {
            stats.changes += 1;
            const moved = lessonById.get(change.lessonId);
            if (!moved) continue;
            const klass = classIdentityKey(moved.classIdentity);
            // 제자리 유지(보강)는 원래 차 있는 것이 맞다. 옮기는 경우만 본다.
            const stays = change.toDate === moved.date && change.toPeriod === moved.period;

            if (!periodsOn.has(change.toDate)) {
              stats.offWeek += 1;
              if (fails.length < 10) fails.push(`${name}: 자료에 없는 날 ${change.toDate} 로 보냄`);
              continue;
            }
            if (!periodsOn.get(change.toDate)!.has(change.toPeriod)) {
              stats.offPeriod += 1;
              if (fails.length < 10) {
                fails.push(`${name}: ${change.toDate} 에 없는 ${change.toPeriod}교시로 보냄`);
              }
            }
            const closed = closures.find((closure) => closure.date === change.toDate
              && (!closure.classIdentities?.length
                || closure.classIdentities.some((identity) => classIdentityKey(identity) === klass)));
            if (closed) {
              stats.onClosure += 1;
              if (fails.length < 10) {
                fails.push(`${name}: 쉬는 날 ${change.toDate}(${closed.reason}) 로 보냄`);
              }
            }
            const destination = `${klass}|${change.toDate}|${change.toPeriod}`;
            if (!stays && exists.has(destination) && !vacated.has(destination)) {
              stats.klassBusy += 1;
              if (fails.length < 10) {
                fails.push(`${name}: 그 학급이 이미 수업 중인 ${change.toDate} ${change.toPeriod}교시로 보냄`);
              }
            }
            if (!stays
              && moved.teacher.state === 'assigned'
              && moved.teacher.teacherId === pick.teacherId
              && absentSlots.has(`${change.toDate}|${change.toPeriod}`)) {
              stats.backIntoAbsence += 1;
              if (fails.length < 10) {
                fails.push(`${name}: 결강난 자리 ${change.toDate} ${change.toPeriod}교시로 되돌림`);
              }
            }
          }
        }
      }
    }

    expect({ fails: fails.slice(0, 5), ...stats }).toMatchObject({
      fails: [],
      offWeek: 0,
      offPeriod: 0,
      onClosure: 0,
      klassBusy: 0,
      backIntoAbsence: 0,
      holidayAsSubject: 0,
    });
    // 조건이 실제로 걸렸는지. 안 걸렸으면 검사한 척만 한 것이다.
    expect(stats.changes).toBeGreaterThan(0);
  }, 1_800_000);
});
