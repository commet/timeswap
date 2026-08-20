import { describe, expect, it } from 'vitest';
import type { ClassIdentity } from '@timeswap/engine';
import { createAbsenceCase, transitionCase } from '../lib/case-service';
import { validateCasePlan } from '../lib/projections';
import { resolutionRowsForLesson } from '../lib/resolution';
import type { Lesson, WorkspaceState } from '../lib/domain';

/**
 * 주가 넘어갈 때 아직 안 끝난 사건.
 *
 * 이 도구는 한 번에 한 주치 시간표만 활성으로 둔다. 월요일 아침에 이번 주를 다시
 * 불러오면 활성 개정판이 바뀐다. 그런데 지난 금요일에 승인만 나고 게시를 못 한
 * 사건이 남아 있으면 어떻게 되는가.
 */
const W1 = 'school:revision:20260817-20260821';
const W2 = 'school:revision:20260824-20260828';

const identity = (className: string): ClassIdentity => ({
  schoolCode: '7010536', academicYear: '2026', dayCourse: '주간',
  affiliation: '일반계', major: '공통', grade: '1', className,
});

const lesson = (
  revisionId: string, id: string, className: string,
  date: string, period: string, teacherId: string,
): Lesson => ({
  id: `${revisionId}:lesson:${id}`, workspaceId: 'school', revisionId,
  date, period, classIdentity: identity(className),
  subject: `과목${period}`, room: `${className}실`,
  teacher: { state: 'assigned', teacherId },
});

function weekLessons(revisionId: string, monday: string): Lesson[] {
  const out: Lesson[] = [];
  const base = new Date(`${monday}T00:00:00Z`);
  for (let day = 0; day < 5; day += 1) {
    const at = new Date(base.getTime() + day * 86_400_000).toISOString().slice(0, 10);
    for (let period = 1; period <= 4; period += 1) {
      for (const className of ['1', '2']) {
        out.push(lesson(
          revisionId, `${day}-${period}-${className}`, className,
          at, String(period), `교사${(day + period + Number(className)) % 6}`,
        ));
      }
    }
  }
  return out;
}

/** 지난주 개정판 하나로 시작한다. 사건 하나가 승인까지 올라가 있다. */
function afterApproval(): WorkspaceState {
  const lessons = weekLessons(W1, '2026-08-17');
  const target = lessons.find((item) =>
    item.date === '2026-08-21' && item.period === '2' && item.classIdentity.className === '1')!;
  const free = lessons.find((item) =>
    item.date === '2026-08-21' && item.period === '4' && item.classIdentity.className === '1')!;
  const state: WorkspaceState = {
    schemaVersion: 2,
    workspace: {
      id: 'school', name: '주넘김중학교', activeRevisionId: W1,
      createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
    },
    revisions: [{
      id: W1, workspaceId: 'school', source: 'neis',
      loadedAt: '2026-08-17T00:00:00.000Z', complete: true, checksum: 'sha256:w1',
    }],
    lessons,
    cases: [], adminTasks: [], publications: [], audit: [],
  };
  let next = createAbsenceCase(state, {
    id: 'case-1', auditEventId: 'case-1:create', workspaceId: 'school',
    requesterTeacherId: target.teacher.state === 'assigned' ? target.teacher.teacherId : '',
    fromDate: '2026-08-21', toDate: '2026-08-21', reason: '연수·출장',
    lessonIds: [target.id], at: '2026-08-21T00:00:00.000Z',
  });
  for (const to of ['submitted', 'in_review'] as const) {
    next = transitionCase(next, {
      caseId: 'case-1', to, actorId: 'ops',
      at: '2026-08-21T00:00:00.000Z', auditEventId: `case-1:${to}`,
    });
  }
  next = {
    ...next,
    cases: next.cases.map((item) => item.id === 'case-1' ? {
      ...item,
      resolutionItems: [{
        id: 'case-1:swap', lessonId: target.id, kind: 'swap2' as const,
        computedAgainstRevisionId: W1,
        changes: [
          { lessonId: target.id, toDate: free.date, toPeriod: free.period, teacher: target.teacher },
          { lessonId: free.id, toDate: target.date, toPeriod: target.period, teacher: free.teacher },
        ],
      }],
    } : item),
  };
  return transitionCase(next, {
    caseId: 'case-1', to: 'resolution_approved', actorId: 'ops',
    at: '2026-08-21T09:00:00.000Z', auditEventId: 'case-1:approve',
  });
}

/** 월요일 아침에 이번 주를 불러온다. 지난주 수업은 한 주치라 그대로 남는다. */
function reloadNextWeek(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    workspace: { ...state.workspace, activeRevisionId: W2, updatedAt: '2026-08-24T07:00:00.000Z' },
    revisions: [
      { id: W2, workspaceId: 'school', source: 'neis', loadedAt: '2026-08-24T07:00:00.000Z', complete: true, checksum: 'sha256:w2' },
      ...state.revisions,
    ],
    lessons: [...weekLessons(W2, '2026-08-24'), ...state.lessons],
  };
}

describe('주가 넘어가도 진행 중인 사건이 살아 있다', () => {
  it('승인만 나고 게시 못 한 사건이 다시 불러온 뒤에도 게시까지 간다', () => {
    const before = afterApproval();
    expect(validateCasePlan(before, 'case-1').valid).toBe(true);

    const after = reloadNextWeek(before);
    const lessonId = after.cases[0]!.lessonIds[0]!;
    // 지난주 수업은 남아 있다. 남아 있는데 아무도 안 본다면 그것이 문제다.
    expect(after.lessons.some((item) => item.id === lessonId)).toBe(true);

    const validation = validateCasePlan(after, 'case-1');
    expect(validation.staleRevision).toBe(false);
    expect(validation.valid).toBe(true);
  });

  it('다시 불러와도 그 사건의 후보를 다시 셀 수 있다', () => {
    const after = reloadNextWeek(afterApproval());
    const lessonId = after.cases[0]!.lessonIds[0]!;
    expect(resolutionRowsForLesson(after, 'case-1', lessonId).length).toBeGreaterThan(0);
  });
});
