import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { classIdentityKey, fromNeis, normalizeNeisRows, type NeisRow } from '@timeswap/engine';
import { createWorkspaceFromNeis, type NeisLoadBundle } from '../components/SetupFlow';
import { resolutionRowsForLesson, selectResolutionForCase } from '../lib/resolution';
import {
  completeAdminTask,
  createAbsenceCase,
  createPrototypeAdminTasks,
  transitionCase,
} from '../lib/case-service';
import { publishCase } from '../lib/publication';
import { createCorrectionCase } from '../lib/case-service';
import { effectiveLessons, projectPublicClassSchedule, validateCasePlan } from '../lib/projections';
import { createWorkspaceRepository, WORKSPACE_KEY_PREFIX } from '../lib/repository';
import { mapKey } from '../lib/app';
import type { Lesson, WorkspaceState } from '../lib/domain';

const PATH = process.env.FIELD_SAMPLE ?? '';
const SCHOOLS = Number(process.env.SIM_SCHOOLS ?? '12');
const ROUNDS = Number(process.env.SIM_ROUNDS ?? '6');
const SPECIAL = ['영어', '체육', '음악', '미술', '과학', '실과', '정보', '보건', '창의적'];

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

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
      out[key] = `담임 ${grade} ${key.split('|')[0]?.slice(-3) ?? ''}`;
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
    result: { complete: true, checksum: 'sha256:sim', total: rows.length, pageCount: 1 },
    report,
  } as unknown as NeisLoadBundle;
  return createWorkspaceFromNeis(bundle, teacherMap(rows, kind), '2026-08-18T00:00:00.000Z');
}

/** 게시된 변경을 얹은 지금의 시간표. 학교가 실제로 보는 것이다. */
function effective(state: WorkspaceState): Array<{
  lessonId: string; klass: string; subject: string; date: string; period: string;
  group: string | null; teacherId: string | null;
}> {
  const moved = new Map<string, { toDate: string; toPeriod: string; teacherId: string | null }>();
  for (const publication of state.publications) {
    if (publication.revisionId !== state.workspace.activeRevisionId) continue;
    const absenceCase = state.cases.find((item) =>
      item.id === publication.caseId && item.status === 'published');
    if (!absenceCase) continue;
    const allowed = new Set(publication.changedLessonIds);
    for (const item of absenceCase.resolutionItems) {
      for (const change of item.changes) {
        if (!allowed.has(change.lessonId)) continue;
        moved.set(change.lessonId, {
          toDate: change.toDate,
          toPeriod: change.toPeriod,
          teacherId: change.teacher.state === 'assigned' ? change.teacher.teacherId : null,
        });
      }
    }
  }
  return state.lessons
    .filter((lesson) => lesson.revisionId === state.workspace.activeRevisionId)
    .map((lesson) => {
      const change = moved.get(lesson.id);
      return {
        lessonId: lesson.id,
        klass: classIdentityKey(lesson.classIdentity),
        subject: lesson.subject,
        date: change?.toDate ?? lesson.date,
        period: change?.toPeriod ?? lesson.period,
        group: lesson.parallelGroupId ?? null,
        teacherId: change
          ? change.teacherId
          : lesson.teacher.state === 'assigned' ? lesson.teacher.teacherId : null,
      };
    });
}

/** 지금 시간표가 성립하는가. 성립하지 않으면 학교가 못 쓴다. */
function violations(state: WorkspaceState): string[] {
  const out: string[] = [];
  const now = effective(state);
  /*
   * 한 자리에 수업이 둘이어도 **분반 묶음이면 정상**이다. 선택과목이나 수준별 분반은
   * 같은 학급의 같은 교시에 여러 강좌가 함께 열리고, 나이스도 그렇게 준다. 엔진도
   * 묶음을 한 몸으로 다룬다. 묶음이 다르거나 없는 둘이 겹칠 때만 중복이다.
   */
  const atKlass = new Map<string, { lessonId: string; group: string | null }>();
  const atTeacher = new Map<string, { lessonId: string; group: string | null }>();
  for (const lesson of now) {
    const klassKey = `${lesson.klass}|${lesson.date}|${lesson.period}`;
    const seen = atKlass.get(klassKey);
    if (seen && seen.lessonId !== lesson.lessonId
      && !(seen.group !== null && seen.group === lesson.group)) {
      out.push(`학급 중복 ${lesson.klass} ${lesson.date} ${lesson.period}교시`);
    }
    atKlass.set(klassKey, { lessonId: lesson.lessonId, group: lesson.group });
    if (lesson.teacherId) {
      const teacherKey = `${lesson.teacherId}|${lesson.date}|${lesson.period}`;
      const seenTeacher = atTeacher.get(teacherKey);
      if (seenTeacher && seenTeacher.lessonId !== lesson.lessonId
        && !(seenTeacher.group !== null && seenTeacher.group === lesson.group)) {
        out.push(`교사 중복 ${lesson.teacherId} ${lesson.date} ${lesson.period}교시`);
      }
      atTeacher.set(teacherKey, { lessonId: lesson.lessonId, group: lesson.group });
    }
  }
  const revision = state.revisions.find((item) => item.id === state.workspace.activeRevisionId);
  for (const closure of revision?.closures ?? []) {
    for (const lesson of now) {
      if (lesson.date !== closure.date) continue;
      if (closure.classIdentities?.length
        && !closure.classIdentities.some((identity) => classIdentityKey(identity) === lesson.klass)) continue;
      out.push(`쉬는 날 수업 ${lesson.date} (${closure.reason})`);
    }
  }
  return [...new Set(out)];
}

/** (학급, 과목) 묶음. 수업이 사라지거나 늘어나면 안 된다. */
function bag(state: WorkspaceState): string {
  const counts = new Map<string, number>();
  for (const lesson of effective(state)) {
    const key = `${lesson.klass}|${lesson.subject}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return JSON.stringify([...counts].sort());
}

interface Round { teacherId: string; date: string; lessons: Lesson[] }

/** 아직 부재를 낸 적 없는 교사 가운데 그날 수업이 둘 이상인 사람. */
function nextRound(state: WorkspaceState, used: Set<string>): Round | null {
  const groups = new Map<string, Round>();
  /*
   * 화면과 같은 표를 본다. 게시된 변경을 얹은 것이다.
   *
   * 앞서는 원래 표를 봤다. 그래서 이미 남에게 넘어간 수업을 원래 담당의 것으로 골랐고,
   * 날짜가 바뀐 수업을 옛 날짜로 골랐다. 화면이 고르는 방식과 다르면 시뮬레이션이
   * 실제로 일어나지 않는 상황을 재게 된다.
   */
  for (const lesson of effectiveLessons(state)) {
    if (lesson.teacher.state !== 'assigned') continue;
    if (used.has(lesson.teacher.teacherId)) continue;
    const key = JSON.stringify([lesson.teacher.teacherId, lesson.date]);
    const found = groups.get(key)
      ?? groups.set(key, { teacherId: lesson.teacher.teacherId, date: lesson.date, lessons: [] }).get(key)!;
    found.lessons.push(lesson);
  }
  const sorted = [...groups.values()]
    .filter((group) => group.lessons.length >= 2)
    .sort((left, right) => right.lessons.length - left.lessons.length
      || left.teacherId.localeCompare(right.teacherId));
  return sorted[0] ?? null;
}

/**
 * 한 학교를 여러 사건에 걸쳐 실제로 운영해 본다.
 *
 * 지금까지의 검사는 사건 하나만 봤다. 실제 학교는 한 주에도 여러 건이 나고, 앞 건이
 * 게시된 위에서 다음 건을 푼다. 쌓였을 때 시간표가 여전히 성립하는지는 한 번도
 * 안 봤다.
 *
 * 부재 접수부터 게시까지 화면이 부르는 그 함수들로 그대로 돌린다. 매 회마다 지금
 * 시간표가 성립하는지, 수업이 사라지거나 늘지 않았는지, 저장했다 열어도 같은지 본다.
 */
describe.skipIf(!PATH || !existsSync(PATH))('한 학교를 여러 사건에 걸쳐 운영해 본다', () => {
  it('사건이 쌓여도 시간표가 성립한다', () => {
    const data = (JSON.parse(readFileSync(PATH, 'utf8')) as Array<{
      school: Record<string, string>; kind?: string; rows?: NeisRow[];
    }>).filter((entry) => (entry.rows ?? []).length > 0).slice(0, SCHOOLS);

    const fails: string[] = [];
    const gateReasons = new Map<string, number>();
    const stats = {
      schools: 0, published: 0, unresolved: 0, rejectedByGate: 0,
      /** 게시 뒤 시간표가 안 성립한 경우 */
      broken: 0,
      /** 수업이 사라지거나 늘어난 경우 */
      lost: 0,
      /** 저장했다 열었더니 달라진 경우 */
      roundTrip: 0,
      /** 게시했는데 결강 당사자가 그 자리에 그대로 남은 경우 */
      notFreed: 0,
      /** 학급 공개 화면에 같은 자리가 둘인 경우 */
      publicDuplicate: 0,
    };

    for (const entry of data) {
      const built = buildWorkspace(entry);
      if (!built) continue;
      const name = entry.school.SCHUL_NM ?? '?';
      stats.schools += 1;

      let state = built;
      const startBag = bag(state);
      const startViolations = new Set(violations(state));
      const usedTeachers = new Set<string>();

      for (let round = 0; round < ROUNDS; round += 1) {
        const pick = nextRound(state, usedTeachers);
        if (!pick) break;
        usedTeachers.add(pick.teacherId);
        const tag = `r${round}`;
        const caseId = `sim:${tag}:case`;
        const at = `2026-08-18T${String(round % 24).padStart(2, '0')}:${String(Math.floor(round / 24)).padStart(2, '0')}:00.000Z`;

        state = createAbsenceCase(state, {
          id: caseId,
          auditEventId: `sim:${tag}:create`,
          workspaceId: state.workspace.id,
          requesterTeacherId: pick.teacherId,
          fromDate: pick.date,
          toDate: pick.date,
          reason: '업무상 부재',
          lessonIds: pick.lessons.map((lesson) => lesson.id),
          at,
        });
        state = transitionCase(state, {
          caseId, to: 'submitted', actorId: pick.teacherId, at, auditEventId: `sim:${tag}:submit`,
        });
        state = transitionCase(state, {
          caseId, to: 'in_review', actorId: 'ops', at, auditEventId: `sim:${tag}:review`,
        });

        // 일과 담당이 각 결강에 안을 하나씩 고른다. 맨 위에 온 것을 고른다.
        let solved = 0;
        for (const lesson of pick.lessons) {
          const rows = resolutionRowsForLesson(state, caseId, lesson.id);
          const chosen = rows.find((row) => row.state !== 'warning') ?? rows[0];
          if (!chosen) { stats.unresolved += 1; continue; }
          state = selectResolutionForCase(state, caseId, chosen).state;
          solved += 1;
        }
        if (solved === 0) break;

        try {
          state = transitionCase(state, {
            caseId, to: 'resolution_approved', actorId: 'ops', at, auditEventId: `sim:${tag}:approve`,
          });
        } catch (error) {
          // 관문이 막았다. 왜 막혔는지 모아 둔다. 자주 막히면 학교가 못 쓴다.
          stats.rejectedByGate += 1;
          const validation = validateCasePlan(state, caseId);
          for (const conflict of validation.conflicts) {
            gateReasons.set(conflict.kind, (gateReasons.get(conflict.kind) ?? 0) + 1);
          }
          if (validation.conflicts.length === 0) {
            const message = error instanceof Error ? error.message : String(error);
            gateReasons.set(message, (gateReasons.get(message) ?? 0) + 1);
          }
          if (validation.staleRevision) {
            gateReasons.set('stale-revision', (gateReasons.get('stale-revision') ?? 0) + 1);
          }
          continue;
        }

        state = createPrototypeAdminTasks(state, {
          caseId, actorId: 'ops', at, auditEventId: `sim:${tag}:tasks`,
          taskAuditEventId: `sim:${tag}:tasks2`,
          taskIds: {
            neis: `sim:${tag}:task:neis`,
            teacher_notice: `sim:${tag}:task:notice`,
            class_publication: `sim:${tag}:task:publication`,
            internal_document: `sim:${tag}:task:document`,
          },
        });
        // createPrototypeAdminTasks 가 이미 admin_in_progress 로 옮긴다.
        for (const task of state.adminTasks.filter((item) => item.caseId === caseId && item.required)) {
          state = completeAdminTask(state, {
            taskId: task.id, actorId: 'ops', at, auditEventId: `sim:${tag}:done:${task.kind}`,
          });
        }
        // 필수 행정 항목을 다 마치면 completeAdminTask 가 ready_to_publish 로 옮긴다.
        state = publishCase(state, caseId, 'ops', at);
        stats.published += 1;

        // 매 회마다 지금 시간표가 성립하는지 본다.
        const fresh = violations(state).filter((item) => !startViolations.has(item));
        if (fresh.length > 0) {
          stats.broken += 1;
          if (fails.length < 10) fails.push(`${name} ${round}회: ${fresh[0]}`);
          if (process.env.SIM_DEBUG && stats.broken === 1) {
            const now = effective(state);
            const at = new Map<string, string[]>();
            for (const item of now) {
              const key = `${item.klass}|${item.date}|${item.period}`;
              (at.get(key) ?? at.set(key, []).get(key)!).push(item.lessonId);
            }
            for (const [key, ids] of at) {
              if (ids.length < 2) continue;
              console.log('겹친 자리', key.slice(-24), ids);
              for (const id of ids) {
                const base = state.lessons.find((lesson) => lesson.id === id)!;
                console.log(`   ${id}: 원래 ${base.date} ${base.period}교시`);
                for (const item of state.cases.flatMap((current) =>
                  current.status === 'published'
                    ? current.resolutionItems.map((r) => ({ caseId: current.id, r }))
                    : [])) {
                  for (const change of item.r.changes) {
                    if (change.lessonId !== id) continue;
                    console.log(`     사건 ${item.caseId} ${item.r.kind} → ${change.toDate} ${change.toPeriod}교시`);
                  }
                }
              }
            }
          }
        }
        if (bag(state) !== startBag) {
          stats.lost += 1;
          if (fails.length < 10) fails.push(`${name} ${round}회: 수업이 사라지거나 늘어남`);
        }
        // 게시했으면 그분은 그 자리에서 빠져야 한다.
        const stillThere = effective(state).filter((lesson) =>
          lesson.teacherId === pick.teacherId
          && pick.lessons.some((item) => item.date === lesson.date && item.period === lesson.period));
        if (stillThere.length > 0) {
          stats.notFreed += 1;
          if (fails.length < 10) {
            fails.push(`${name} ${round}회: 게시 뒤에도 결강 자리에 그대로 있음`);
          }
        }
      }

      // 저장했다 열어도 같아야 한다. 학교는 브라우저를 껐다 켠다.
      const storage = new MemoryStorage();
      const repository = createWorkspaceRepository(storage);
      const saved = repository.save(state);
      if (saved.ok) {
        const loaded = repository.load(state.workspace.id);
        if (!loaded || JSON.stringify(loaded) !== JSON.stringify(state)) {
          stats.roundTrip += 1;
          if (fails.length < 10) fails.push(`${name}: 저장했다 열었더니 달라짐`);
        }
      }
      expect(storage.getItem(`${WORKSPACE_KEY_PREFIX}${state.workspace.id}`)).not.toBeNull();

      // 학급 공개 화면에 같은 자리가 둘이면 학생이 어느 것을 믿어야 할지 모른다.
      const klasses = [...new Set(state.lessons
        .filter((lesson) => lesson.revisionId === state.workspace.activeRevisionId)
        .map((lesson) => classIdentityKey(lesson.classIdentity)))].slice(0, 6);
      for (const klass of klasses) {
        const view = projectPublicClassSchedule(state, klass);
        // 분반 묶음은 한 자리에 여럿이 정상이다. 묶음 밖의 겹침만 본다.
        const groupOf = new Map(state.lessons.map((lesson) =>
          [lesson.id, lesson.parallelGroupId ?? null]));
        const seen = new Map<string, string | null>();
        for (const lesson of view.lessons) {
          const key = `${lesson.date}|${lesson.period}`;
          const group = groupOf.get(lesson.lessonId) ?? null;
          const before = seen.get(key);
          if (before !== undefined && !(before !== null && before === group)) {
            stats.publicDuplicate += 1;
            if (fails.length < 10) fails.push(`${name}: 학급 공개 화면에 ${key} 가 둘`);
            break;
          }
          seen.set(key, group);
        }
      }
    }

    console.log('시뮬레이션', JSON.stringify(stats));
    console.log('승인이 막힌 이유', JSON.stringify([...gateReasons].sort((a, b) => b[1] - a[1])));
    expect({ fails: fails.slice(0, 5), ...stats }).toMatchObject({
      fails: [],
      broken: 0,
      lost: 0,
      roundTrip: 0,
      notFreed: 0,
      publicDuplicate: 0,
    });
    // 실제로 여러 건을 게시했는지. 안 했으면 검사한 척만 한 것이다.
    expect(stats.published).toBeGreaterThan(stats.schools);
  }, 1_800_000);
});

/** 사건 하나를 접수부터 게시까지 민다. 화면이 부르는 그 함수들만 쓴다. */
function runCase(
  start: WorkspaceState,
  options: {
    caseId: string; tag: string; teacherId: string; fromDate: string; toDate: string;
    lessonIds: string[]; at: string;
  },
): { state: WorkspaceState; published: boolean; reason?: string } {
  const { caseId, tag, teacherId, fromDate, toDate, lessonIds, at } = options;
  let state = createAbsenceCase(start, {
    id: caseId,
    auditEventId: `${tag}:create`,
    workspaceId: start.workspace.id,
    requesterTeacherId: teacherId,
    fromDate,
    toDate,
    reason: '업무상 부재',
    lessonIds,
    at,
  });
  state = transitionCase(state, {
    caseId, to: 'submitted', actorId: teacherId, at, auditEventId: `${tag}:submit`,
  });
  state = transitionCase(state, {
    caseId, to: 'in_review', actorId: 'ops', at, auditEventId: `${tag}:review`,
  });
  let solved = 0;
  for (const lessonId of lessonIds) {
    const rows = resolutionRowsForLesson(state, caseId, lessonId);
    const chosen = rows.find((row) => row.state !== 'warning') ?? rows[0];
    if (!chosen) continue;
    state = selectResolutionForCase(state, caseId, chosen).state;
    solved += 1;
  }
  if (solved === 0) return { state, published: false, reason: '안 없음' };
  try {
    state = transitionCase(state, {
      caseId, to: 'resolution_approved', actorId: 'ops', at, auditEventId: `${tag}:approve`,
    });
  } catch {
    return { state, published: false, reason: '승인 관문' };
  }
  state = createPrototypeAdminTasks(state, {
    caseId, actorId: 'ops', at, auditEventId: `${tag}:tasks`,
    taskAuditEventId: `${tag}:tasks2`,
    taskIds: {
      neis: `${tag}:task:neis`,
      teacher_notice: `${tag}:task:notice`,
      class_publication: `${tag}:task:publication`,
      internal_document: `${tag}:task:document`,
    },
  });
  for (const task of state.adminTasks.filter((item) => item.caseId === caseId && item.required)) {
    state = completeAdminTask(state, {
      taskId: task.id, actorId: 'ops', at, auditEventId: `${tag}:done:${task.kind}`,
    });
  }
  state = publishCase(state, caseId, 'ops', at);
  return { state, published: true };
}

/**
 * 게시한 뒤 정정하고 다시 게시하는 흐름.
 *
 * 실제로 자주 있는 일이다. 게시한 다음에 그 시간에 회의가 잡히거나 협조 교사가
 * 못 하게 된다. 게시본 위에 정정을 얹는 자리라 격자 계산이 가장 얽히는 곳이다.
 */
describe.skipIf(!PATH || !existsSync(PATH))('게시한 뒤 정정하고 다시 게시한다', () => {
  it('정정을 얹어도 시간표가 성립한다', () => {
    const data = (JSON.parse(readFileSync(PATH, 'utf8')) as Array<{
      school: Record<string, string>; kind?: string; rows?: NeisRow[];
    }>).filter((entry) => (entry.rows ?? []).length > 0).slice(0, SCHOOLS);

    const fails: string[] = [];
    const stats = {
      schools: 0, firstPublished: 0, corrected: 0, correctionPublished: 0,
      broken: 0, lost: 0,
    };

    for (const entry of data) {
      const built = buildWorkspace(entry);
      if (!built) continue;
      const name = entry.school.SCHUL_NM ?? '?';
      stats.schools += 1;
      const startBag = bag(built);
      const startViolations = new Set(violations(built));

      const first = nextRound(built, new Set());
      if (!first) continue;
      const round1 = runCase(built, {
        caseId: 'sim:c1', tag: 'sim:c1', teacherId: first.teacherId,
        fromDate: first.date, toDate: first.date,
        lessonIds: first.lessons.map((lesson) => lesson.id),
        at: '2026-08-18T01:00:00.000Z',
      });
      if (!round1.published) continue;
      stats.firstPublished += 1;
      let state = round1.state;

      // 게시본을 정정한다.
      state = createCorrectionCase(state, {
        sourceCaseId: 'sim:c1', id: 'sim:c1:fix', actorId: 'ops',
        at: '2026-08-18T02:00:00.000Z', auditEventId: 'sim:c1:fix:create',
      });
      stats.corrected += 1;
      const correction = state.cases.find((item) => item.id === 'sim:c1:fix')!;
      state = transitionCase(state, {
        caseId: correction.id, to: 'submitted', actorId: 'ops',
        at: '2026-08-18T02:00:00.000Z', auditEventId: 'sim:c1:fix:submit',
      });
      state = transitionCase(state, {
        caseId: correction.id, to: 'in_review', actorId: 'ops',
        at: '2026-08-18T02:00:00.000Z', auditEventId: 'sim:c1:fix:review',
      });
      let solved = 0;
      for (const lessonId of correction.lessonIds) {
        const rows = resolutionRowsForLesson(state, correction.id, lessonId);
        const chosen = rows.find((row) => row.state !== 'warning') ?? rows[0];
        if (!chosen) continue;
        state = selectResolutionForCase(state, correction.id, chosen).state;
        solved += 1;
      }
      if (solved === 0) {
        fails.push(`${name}: 정정 사건에 후보가 하나도 없음`);
        continue;
      }
      try {
        state = transitionCase(state, {
          caseId: correction.id, to: 'resolution_approved', actorId: 'ops',
          at: '2026-08-18T02:00:00.000Z', auditEventId: 'sim:c1:fix:approve',
        });
      } catch {
        continue;
      }
      state = createPrototypeAdminTasks(state, {
        caseId: correction.id, actorId: 'ops', at: '2026-08-18T02:00:00.000Z',
        auditEventId: 'sim:c1:fix:tasks', taskAuditEventId: 'sim:c1:fix:tasks2',
        taskIds: {
          neis: 'sim:c1:fix:task:neis', teacher_notice: 'sim:c1:fix:task:notice',
          class_publication: 'sim:c1:fix:task:publication',
          internal_document: 'sim:c1:fix:task:document',
        },
      });
      for (const task of state.adminTasks.filter((item) => item.caseId === correction.id && item.required)) {
        state = completeAdminTask(state, {
          taskId: task.id, actorId: 'ops', at: '2026-08-18T02:00:00.000Z',
          auditEventId: `sim:c1:fix:done:${task.kind}`,
        });
      }
      state = publishCase(state, correction.id, 'ops', '2026-08-18T02:00:00.000Z');
      stats.correctionPublished += 1;

      const fresh = violations(state).filter((item) => !startViolations.has(item));
      if (fresh.length > 0) {
        stats.broken += 1;
        if (fails.length < 10) fails.push(`${name}: 정정 뒤 ${fresh[0]}`);
      }
      if (bag(state) !== startBag) {
        stats.lost += 1;
        if (fails.length < 10) fails.push(`${name}: 정정 뒤 수업이 사라지거나 늘어남`);
      }
    }

    console.log('정정 시뮬레이션', JSON.stringify(stats));
    expect({ fails: fails.slice(0, 5), ...stats }).toMatchObject({ fails: [], broken: 0, lost: 0 });
    expect(stats.correctionPublished).toBeGreaterThan(0);
  }, 1_800_000);
});

/**
 * 여러 날에 걸친 부재. 연수는 대개 이삼일이다.
 *
 * 결강이 여러 날에 흩어지면 그 주 격자를 날짜마다 다시 만든다. 하루짜리만 재고
 * 넘어가면 그 길이 안 밟힌다.
 */
describe.skipIf(!PATH || !existsSync(PATH))('여러 날에 걸친 부재', () => {
  it('사흘을 비워도 시간표가 성립한다', () => {
    const data = (JSON.parse(readFileSync(PATH, 'utf8')) as Array<{
      school: Record<string, string>; kind?: string; rows?: NeisRow[];
    }>).filter((entry) => (entry.rows ?? []).length > 0).slice(0, SCHOOLS);

    const fails: string[] = [];
    const stats = { schools: 0, cases: 0, published: 0, broken: 0, lost: 0, days: 0 };

    for (const entry of data) {
      const built = buildWorkspace(entry);
      if (!built) continue;
      const name = entry.school.SCHUL_NM ?? '?';
      stats.schools += 1;
      const startBag = bag(built);
      const startViolations = new Set(violations(built));

      // 그 주에 수업이 가장 많은 교사를 잡아 앞에서 사흘을 통째로 비운다.
      const byTeacher = new Map<string, Lesson[]>();
      for (const lesson of built.lessons) {
        if (lesson.teacher.state !== 'assigned') continue;
        (byTeacher.get(lesson.teacher.teacherId)
          ?? byTeacher.set(lesson.teacher.teacherId, []).get(lesson.teacher.teacherId)!).push(lesson);
      }
      const busiest = [...byTeacher].sort((left, right) =>
        right[1].length - left[1].length || left[0].localeCompare(right[0]))[0];
      if (!busiest) continue;
      const dates = [...new Set(busiest[1].map((lesson) => lesson.date))].sort().slice(0, 3);
      if (dates.length < 2) continue;
      const lessons = busiest[1].filter((lesson) => dates.includes(lesson.date));
      stats.days += dates.length;
      stats.cases += 1;

      const run = runCase(built, {
        caseId: 'sim:multi', tag: 'sim:multi', teacherId: busiest[0],
        fromDate: dates[0]!, toDate: dates.at(-1)!,
        lessonIds: lessons.map((lesson) => lesson.id),
        at: '2026-08-18T03:00:00.000Z',
      });
      if (!run.published) continue;
      stats.published += 1;

      const fresh = violations(run.state).filter((item) => !startViolations.has(item));
      if (fresh.length > 0) {
        stats.broken += 1;
        if (fails.length < 10) fails.push(`${name}: 여러 날 부재 뒤 ${fresh[0]}`);
      }
      if (bag(run.state) !== startBag) {
        stats.lost += 1;
        if (fails.length < 10) fails.push(`${name}: 여러 날 부재 뒤 수업이 사라지거나 늘어남`);
      }
    }

    console.log('여러 날 시뮬레이션', JSON.stringify(stats));
    expect({ fails: fails.slice(0, 5), ...stats }).toMatchObject({ fails: [], broken: 0, lost: 0 });
    expect(stats.published).toBeGreaterThan(0);
  }, 1_800_000);
});

/**
 * 가장 큰 학교에서 화면이 얼마나 멎는가.
 *
 * 일과 담당 화면은 사건에 걸린 결강마다 후보를 센다. 예전에는 목록을 그리면서 한 번,
 * 고른 것을 찾으면서 또 한 번 불렀고 그리기마다 다시 셌다. 결강 열여섯 건인 학교에서
 * 한 건이 240ms 라 그리기 한 번에 7초 넘게 멎었다. 사유를 한 글자 칠 때마다 그만큼이다.
 *
 * 이 검사는 한 사건의 결강 전부를 한 번 세는 데 걸리는 시간을 잰다. 그리기마다가
 * 아니라 상태가 바뀔 때만 이만큼 든다.
 */
describe.skipIf(!PATH || !existsSync(PATH))('가장 큰 학교 응답 시간', () => {
  it('한 사건을 여는 데 드는 시간이 한도 안이다', () => {
    const data = (JSON.parse(readFileSync(PATH, 'utf8')) as Array<{
      school: Record<string, string>; kind?: string; rows?: NeisRow[];
    }>).filter((entry) => (entry.rows ?? []).length > 0)
      .sort((left, right) => (right.rows?.length ?? 0) - (left.rows?.length ?? 0))
      .slice(0, 3);

    const measured: Array<{ name: string; lessons: number; ms: number }> = [];
    for (const entry of data) {
      const built = buildWorkspace(entry);
      if (!built) continue;
      const pick = nextRound(built, new Set());
      if (!pick) continue;
      const lessonIds = pick.lessons.map((lesson) => lesson.id);
      let state = createAbsenceCase(built, {
        id: 'perf:case', auditEventId: 'perf:create', workspaceId: built.workspace.id,
        requesterTeacherId: pick.teacherId, fromDate: pick.date, toDate: pick.date,
        reason: '업무상 부재', lessonIds, at: '2026-08-18T00:00:00.000Z',
      });
      state = transitionCase(state, {
        caseId: 'perf:case', to: 'submitted', actorId: pick.teacherId,
        at: '2026-08-18T00:00:00.000Z', auditEventId: 'perf:submit',
      });
      state = transitionCase(state, {
        caseId: 'perf:case', to: 'in_review', actorId: 'ops',
        at: '2026-08-18T00:00:00.000Z', auditEventId: 'perf:review',
      });
      const started = performance.now();
      for (const lessonId of lessonIds) {
        resolutionRowsForLesson(state, 'perf:case', lessonId);
      }
      measured.push({
        name: entry.school.SCHUL_NM ?? '?',
        lessons: lessonIds.length,
        ms: performance.now() - started,
      });
    }

    console.log('응답 시간', JSON.stringify(measured));
    expect(measured.length).toBeGreaterThan(0);
    for (const item of measured) {
      // 결강 하나당 1초를 넘으면 화면이 멎는 것으로 본다. 실측은 그 4분의 1 언저리다.
      expect(item.ms / item.lessons).toBeLessThan(1000);
    }
  }, 600_000);
});
