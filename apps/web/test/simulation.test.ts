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
import { projectPublicClassSchedule, validateCasePlan } from '../lib/projections';
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
  for (const lesson of state.lessons) {
    if (lesson.revisionId !== state.workspace.activeRevisionId) continue;
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
